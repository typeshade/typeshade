// === Function lowering: two-pass signatures then bodies ===

import ts from 'typescript'
import type {
  BindingDecl,
  FuncDecl,
  Stmt,
  Expr,
  OverrideDecl,
  ModuleVarDecl,
} from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import type { SourceSpan } from '../../../core/ir/span.js'
import { voidT, typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import { LoweringScope } from '../context.js'
import type { CollectedStruct } from '../structs.js'
import { recordDeclaration, type DeclaredSymbolSink } from '../symbols.js'
import { mapTsTypeToShaderType } from '../type-map.js'
import { refuseAtomicDeclaration } from './atomics.js'
import { lowerStatements } from './statement.js'
import { eachExpr, eachStmtExpr } from '../../../core/ir/visit.js'
import { makeDiagnostic } from '../diagnostic.js'
import { spanOf } from '../span.js'
import { TS_CODES, type TsCode } from '../codes.js'
import { checkRecursion } from '../recursion.js'
import {
  SELF_IN,
  collectClassFunctions,
  ctorPrologue,
  selfRef,
  type Receiver,
} from './class-methods.js'
import {
  builtinDecoratorArg,
  checkAttributeName,
  checkBuiltinName,
  checkBuiltinStage,
  type BuiltinStage,
} from '../builtin-check.js'

export function lowerSourceFunctions(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  consts: readonly ScopedConst[] = [],
  bindings: readonly BindingDecl[] = [],
  structs: readonly CollectedStruct[] = [],
  symbols?: DeclaredSymbolSink,
  overrides: readonly OverrideDecl[] = [],
  vars: readonly ModuleVarDecl[] = [],
): FuncDecl[] {
  const decls = sourceFile.statements.filter(ts.isFunctionDeclaration)
  const callees = new Map<string, FuncDecl>()
  const ready: ts.FunctionDeclaration[] = []
  for (const stmt of decls) {
    const stub = parseSignature(stmt, sourceFile, diagnostics, structs)
    if (!stub) continue
    if (callees.has(stub.name)) {
      pushDiag(
        diagnostics,
        sourceFile,
        stmt,
        `Duplicate function "${stub.name}".`,
        TS_CODES.DUPLICATE_SYMBOL,
      )
      continue
    }
    callees.set(stub.name, stub)
    ready.push(stmt)
  }
  // A class's methods, static functions and constructor are functions of the module (#86),
  // registered before any body is lowered so a call in either direction resolves. The emitted
  // name is `Struct_member`; a top-level function of that name is a clash, said on both.
  const classFns = collectClassFunctions(structs, sourceFile, diagnostics).filter((cf) => {
    const taken = callees.get(cf.stub.name)
    if (taken !== undefined) {
      const at = cf.node ?? cf.struct.members?.node ?? sourceFile
      pushDiag(
        diagnostics,
        sourceFile,
        at,
        `"${cf.stub.name}" is both the function "${taken.name}" and the emitted name of ` +
          `"${cf.shown}"; rename one of them.`,
        TS_CODES.DUPLICATE_SYMBOL,
      )
      return false
    }
    callees.set(cf.stub.name, cf.stub)
    return true
  })
  const funcs: FuncDecl[] = []
  const nodeByName = new Map<string, FunctionNode>()
  for (const cf of classFns) {
    if (cf.node !== undefined) {
      fillFunctionBody(
        cf.node,
        cf.stub,
        sourceFile,
        diagnostics,
        callees,
        consts,
        bindings,
        structs,
        symbols,
        overrides,
        vars,
        cf.receiver,
        cf.shown,
      )
      nodeByName.set(cf.stub.name, cf.node)
    } else if (cf.receiver !== undefined) {
      // A class with no constructor still answers `new P()`: the zero struct with its field
      // initializers, and nothing else.
      const scope = functionScope(
        cf.stub,
        callees,
        consts,
        bindings,
        structs,
        symbols,
        overrides,
        vars,
      )
      ;(cf.stub as { body: readonly Stmt[] }).body = [
        ...ctorPrologue(cf.receiver, scope, sourceFile, diagnostics),
        { s: 'return', expr: selfRef(cf.receiver.type) },
      ]
    }
    funcs.push(cf.stub)
  }
  for (const stmt of ready) {
    const stub = callees.get(stmt.name!.text)!
    fillFunctionBody(
      stmt,
      stub,
      sourceFile,
      diagnostics,
      callees,
      consts,
      bindings,
      structs,
      symbols,
      overrides,
      vars,
    )
    funcs.push(stub)
    nodeByName.set(stub.name, stmt)
  }
  // Before the bodies are handed on: a call cycle emits WGSL Tint refuses (#48), and no gate
  // downstream of here was looking for one. In a single file a function is called by the name
  // it is declared under, so the graph key and the resolver are both just `callees`. A method
  // called through its object (`r.at(t)`) is not an identifier call and is not in this graph
  // yet; Tint still refuses the cycle, as a backend diagnostic (#86).
  checkRecursion(
    [
      ...ready.map((stmt) => ({
        name: stmt.name!.text,
        decl: stmt,
        sourceFile,
        resolve: (callee: string) => (callees.has(callee) ? callee : undefined),
      })),
      ...classFns.flatMap((cf) =>
        cf.node === undefined
          ? []
          : [
              {
                name: cf.stub.name,
                decl: cf.node,
                sourceFile,
                resolve: (callee: string) => (callees.has(callee) ? callee : undefined),
              },
            ],
      ),
    ],
    diagnostics,
  )
  checkFragmentOnlyOps(funcs, nodeByName, sourceFile, diagnostics)
  return funcs
}

/** The ops WGSL and GLSL ES 3.00 allow only in the fragment stage: the kill, and the three
 *  screen-space derivatives, which need the neighbouring invocations of a quad. */
const FRAGMENT_ONLY_CALLS: ReadonlySet<string> = new Set([
  'fwidth',
  'dpdx',
  'dpdy',
  'fwidthCoarse',
  'fwidthFine',
  'dpdxCoarse',
  'dpdxFine',
  'dpdyCoarse',
  'dpdyFine',
])

/** Whether a function's OWN body uses a fragment-only op, by the name to report it under. */
function fragmentOnlyOpsOf(body: readonly Stmt[]): Set<string> {
  const found = new Set<string>()
  const walkStmt = (s: Stmt): void => {
    if (s.s === 'discard') found.add('discard')
    eachStmtExpr(
      s,
      (e) => {
        eachExpr(e, (x) => {
          if (x.op === 'call' && FRAGMENT_ONLY_CALLS.has(x.fn)) found.add(x.fn)
        })
      },
      walkStmt,
    )
  }
  for (const s of body) walkStmt(s)
  return found
}

/** The functions a function's body calls, by name. */
function calleeNamesOf(body: readonly Stmt[]): Set<string> {
  const names = new Set<string>()
  const walkStmt = (s: Stmt): void => {
    eachStmtExpr(
      s,
      (e) => {
        eachExpr(e, (x) => {
          if (x.op === 'call') names.add(x.fn)
        })
      },
      walkStmt,
    )
  }
  for (const s of body) walkStmt(s)
  return names
}

/** `discard` and the screen-space derivatives are fragment-only, and an entry is as illegal
 *  for using one through a helper as for using one itself: Tint rejects a vertex entry whose
 *  call graph reaches a `discard` ("cannot be used in vertex pipeline stage … called by entry
 *  point 'vs'"), and ANGLE rejects the GLSL. Checking an entry's own body was not enough, so
 *  this closes over the call graph once every body is lowered — which is also the first point
 *  at which the graph is known. A helper is still never rejected on its own: it is legal
 *  until something calls it from the wrong stage. */
function checkFragmentOnlyOps(
  funcs: readonly FuncDecl[],
  nodeByName: ReadonlyMap<string, FunctionNode>,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  const own = new Map<string, Set<string>>()
  const calls = new Map<string, Set<string>>()
  for (const f of funcs) {
    own.set(f.name, fragmentOnlyOpsOf(f.body))
    calls.set(f.name, calleeNamesOf(f.body))
  }
  for (const entry of funcs) {
    if (entry.stage !== 'vertex' && entry.stage !== 'compute') continue
    const node = nodeByName.get(entry.name)
    if (!node?.name) continue
    // Breadth-first over the call graph, reporting each op once at the nearest function that
    // uses it, so a shared helper does not report the same thing twice for one entry.
    const seen = new Set<string>([entry.name])
    const queue: string[] = [entry.name]
    const reported = new Set<string>()
    while (queue.length > 0) {
      const name = queue.shift()!
      for (const op of own.get(name) ?? []) {
        if (reported.has(op)) continue
        reported.add(op)
        const where =
          name === entry.name
            ? `"${entry.name}" is a ${entry.stage} entry`
            : `"${name}" is reachable from the ${entry.stage} entry "${entry.name}"`
        pushDiag(
          diagnostics,
          sourceFile,
          node.name,
          `"${op}" is only valid in a fragment shader; ${where}.`,
          TS_CODES.UNSUPPORTED,
        )
      }
      for (const callee of calls.get(name) ?? []) {
        if (seen.has(callee) || !own.has(callee)) continue
        seen.add(callee)
        queue.push(callee)
      }
    }
  }
}

export function lowerFunctionDeclaration(
  node: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  callees?: Map<string, FuncDecl>,
): FuncDecl | undefined {
  const stub = parseSignature(node, sourceFile, diagnostics)
  if (!stub) return undefined
  const table = callees ?? new Map<string, FuncDecl>()
  if (!table.has(stub.name)) table.set(stub.name, stub)
  fillFunctionBody(node, stub, sourceFile, diagnostics, table)
  return stub
}

/** The declarations a body is lowered from: a top-level function, a class method or a class
 *  constructor (#86). All three carry `parameters`, an optional `type` and a `body`. */
export type FunctionNode = ts.FunctionDeclaration | ts.MethodDeclaration | ts.ConstructorDeclaration

/** The parameters of a signature, each with its type, `@builtin` and `@location`, checked
 *  against `stage` when the function is an entry. Returns `undefined` after the first
 *  parameter it cannot accept, having said why. `owner` names the function in messages;
 *  `forbidSelf` refuses a parameter named `self_`, the name a method's object takes in the
 *  emitted function (#86). */
export function parseParams(
  parameters: readonly ts.ParameterDeclaration[],
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structs: readonly CollectedStruct[],
  stage: FuncDecl['stage'] | undefined,
  opts: { readonly owner?: string; readonly forbidSelf?: boolean } = {},
): FuncDecl['params'][number][] | undefined {
  const params: FuncDecl['params'][number][] = []
  for (const p of parameters) {
    for (const d of decoratorsOf(p)) checkAttributeName(diagnostics, sourceFile, d)
    if (!ts.isIdentifier(p.name)) {
      pushDiag(
        diagnostics,
        sourceFile,
        p,
        'Parameter must be a simple identifier.',
        TS_CODES.FUNCTION_SHAPE,
      )
      return undefined
    }
    if (p.questionToken) {
      pushDiag(
        diagnostics,
        sourceFile,
        p,
        `Optional parameter "${p.name.text}" is not supported.`,
        TS_CODES.FUNCTION_SHAPE,
      )
      return undefined
    }
    if (p.dotDotDotToken) {
      pushDiag(
        diagnostics,
        sourceFile,
        p,
        `Rest parameter "${p.name.text}" is not supported.`,
        TS_CODES.FUNCTION_SHAPE,
      )
      return undefined
    }
    if (opts.forbidSelf && (p.name.text === 'self_' || p.name.text === SELF_IN)) {
      pushDiag(
        diagnostics,
        sourceFile,
        p,
        `"${p.name.text}" is a name ${opts.owner ?? 'the method'} gives its object in the ` +
          `emitted function; rename the parameter.`,
        TS_CODES.CLASS_MEMBER,
      )
      return undefined
    }
    const pType = mapTsTypeToShaderType(p.type, sourceFile, diagnostics)
    if (refuseAtomicDeclaration(pType, p.type ?? p, sourceFile, diagnostics, 'a parameter'))
      return undefined
    if (!pType) {
      pushDiag(
        diagnostics,
        sourceFile,
        p,
        `Parameter "${p.name.text}" requires a TypeShade type annotation.`,
        TS_CODES.UNKNOWN_TYPE,
      )
      return undefined
    }
    const builtinArg = builtinDecoratorArg(decoratorsOf(p))
    let builtin: string | undefined
    if (builtinArg) {
      const validName = checkBuiltinName(
        diagnostics,
        sourceFile,
        builtinArg.argNode,
        builtinArg.name,
      )
      if (validName) {
        builtin = builtinArg.name
        if (stage) {
          checkBuiltinStage(
            diagnostics,
            sourceFile,
            builtinArg.argNode,
            builtinArg.name,
            stage,
            'input',
          )
        }
      }
    }
    if (stage && pType.kind === 'struct') {
      checkStructBuiltinFields(diagnostics, sourceFile, p, pType.name, structs, stage, 'input')
    }
    const location = numberDecorator(p, sourceFile, 'location')
    params.push({
      name: p.name.text,
      type: pType,
      ...(builtin ? { builtin } : {}),
      ...(location !== undefined ? { location } : {}),
    })
  }
  return params
}

/** The return type a signature declares: `void` for none, the mapped type otherwise, checked
 *  against `stage` for an entry's output struct. A helper with no annotation gets the
 *  "defaulting to void" warning at `node`; an entry does not, since its body decides. Returns
 *  `undefined` after saying what it could not map. */
export function parseReturnType(
  typeNode: ts.TypeNode | undefined,
  name: string,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structs: readonly CollectedStruct[],
  stage: FuncDecl['stage'] | undefined,
): ShaderType | undefined {
  let ret: ShaderType = voidT
  if (typeNode) {
    if (typeNode.kind === ts.SyntaxKind.VoidKeyword) ret = voidT
    else {
      const mapped = mapTsTypeToShaderType(typeNode, sourceFile, diagnostics)
      if (refuseAtomicDeclaration(mapped, typeNode, sourceFile, diagnostics, 'a return type'))
        return undefined
      if (!mapped) {
        pushDiag(
          diagnostics,
          sourceFile,
          typeNode,
          `Unsupported return type for "${name}".`,
          TS_CODES.UNKNOWN_TYPE,
        )
        return undefined
      }
      ret = mapped
    }
    if (stage && ret.kind === 'struct') {
      checkStructBuiltinFields(
        diagnostics,
        sourceFile,
        typeNode,
        ret.name,
        structs,
        stage,
        'output',
      )
    }
  } else if (!stage) {
    // Only a helper function gets this warning up front: an entry function's body has not been
    // lowered yet, so whether "no annotation" is actually a problem (it returns a value) is
    // decided in `fillFunctionBody`, which can also name the inferred type in the error.
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        node,
        `Function "${name}" has no return type annotation; defaulting to void.`,
        TS_CODES.RETURN_SHAPE,
        'warning',
      ),
    )
  }
  return ret
}

export function parseSignature(
  node: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structs: readonly CollectedStruct[] = [],
): FuncDecl | undefined {
  if (!node.name || !ts.isIdentifier(node.name)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'Function declaration must have a name.',
      TS_CODES.FUNCTION_SHAPE,
    )
    return undefined
  }
  if (!node.body) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Function "${node.name.text}" needs a body (no ambient declarations).`,
      TS_CODES.FUNCTION_SHAPE,
    )
    return undefined
  }
  const name = node.name.text
  // Computed up front (rather than after the return type, as before) so the builtin/stage
  // checks below, for both a direct parameter builtin and a struct-typed parameter's fields,
  // know the entry stage they are validating against.
  const stageInfo = parseStage(node, sourceFile, diagnostics)
  const params = parseParams(node.parameters, sourceFile, diagnostics, structs, stageInfo.stage)
  if (!params) return undefined
  const ret = parseReturnType(
    node.type,
    name,
    node,
    sourceFile,
    diagnostics,
    structs,
    stageInfo.stage,
  )
  if (!ret) return undefined
  const decl: FuncDecl = { name, params, ret, body: [] }
  // `node.getStart(sourceFile)` is the first decorator or the `export` keyword, so an entry
  // function's span covers its `@fragment` line; `nameSpan` is just the identifier, for a
  // stack frame that highlights the name rather than the whole body.
  ;(decl as { span?: SourceSpan }).span = spanOf(sourceFile, node)
  ;(decl as { nameSpan?: SourceSpan }).nameSpan = spanOf(sourceFile, node.name)
  if (stageInfo.stage) (decl as { stage?: FuncDecl['stage'] }).stage = stageInfo.stage
  if (stageInfo.workgroupSize !== undefined) {
    ;(decl as { workgroupSize?: number }).workgroupSize = stageInfo.workgroupSize
  }
  const attrs: string[] = []
  if (stageInfo.stage === 'vertex') attrs.push('@vertex')
  if (stageInfo.stage === 'fragment') attrs.push('@fragment')
  if (stageInfo.stage === 'compute')
    attrs.push(`@compute @workgroup_size(${stageInfo.workgroupSize ?? 64})`)
  if (attrs.length) (decl as { attrs?: string[] }).attrs = attrs
  if (stageInfo.stage === 'vertex' && typeKey(ret).startsWith('vec4')) {
    ;(decl as { retAttr?: string }).retAttr = '@builtin(position)'
    ;(decl as { retBuiltin?: string }).retBuiltin = 'position'
  }
  if (stageInfo.stage === 'fragment' && typeKey(ret).startsWith('vec4')) {
    ;(decl as { retAttr?: string }).retAttr = '@location(0)'
  }
  return decl
}

/** What a function's scope needs of a module const: its name and type, its CPU value when it
 *  is a scalar, and its initializer when it is not. A `ConstDecl` is one; the fields it does
 *  not have here (`wgslValue`) are the emitter's. */
export interface ScopedConst {
  readonly name: string
  readonly type: ShaderType
  readonly cpuValue?: number | boolean
  readonly valueExpr?: Expr
}

/** The scope a function body is lowered in: the module's consts, bindings, overrides and
 *  variables defined once each, the struct table, the stage and the return type. Shared by
 *  {@link fillFunctionBody} and the constructor a class without one gets (#86). */
export function functionScope(
  stub: FuncDecl,
  callees: Map<string, FuncDecl>,
  consts: readonly ScopedConst[],
  bindings: readonly BindingDecl[],
  structs: readonly CollectedStruct[],
  symbols: DeclaredSymbolSink | undefined,
  overrides: readonly OverrideDecl[],
  vars: readonly ModuleVarDecl[],
): LoweringScope {
  const scope = new LoweringScope(callees, symbols)
  scope.setStructs(structs.map((s) => s.decl))
  scope.setStage(stub.stage)
  // `return 0` in a function declared i32/u32 types the literal from the signature (#8 A3),
  // and `return { … }` knows which struct it builds (#8 A11). One field, two readers.
  scope.setReturnType(stub.ret)

  // Every module-scope define is guarded, because `scope.define` THROWS on a repeat and this
  // is the last place a collision between two collectors can land. Each collector reports its
  // own duplicates, so a name arriving twice here has already been diagnosed — an override
  // beside a module const of the same name, say — and the second define would turn that
  // diagnostic into an exception out of `compile()` and out of the language service's
  // `getDiagnostics()`, where a squiggle belongs.
  const defineOnce = (b: Parameters<LoweringScope['define']>[0]): void => {
    if (!scope.hasInCurrent(b.name)) scope.define(b)
  }
  for (const c of consts) {
    defineOnce({
      kind: 'module',
      name: c.name,
      type: c.type,
      mutable: false,
      // A non-scalar const's `cpuValue` is the 0 the collector writes as a placeholder beside
      // its `valueExpr`, not a value; taking it as one made `v / Z` for any vector const `Z`
      // a division by zero to the constant folder (#68). The initializer rides along instead.
      constValue: c.type.kind === 'scalar' ? c.cpuValue : undefined,
      ...(c.type.kind !== 'scalar' && c.valueExpr !== undefined ? { valueExpr: c.valueExpr } : {}),
    })
  }
  for (const b of bindings) {
    defineOnce({
      kind: 'binding',
      name: b.name,
      type: b.type,
      mutable: b.access === 'read_write',
      space: b.space,
    })
  }
  // An override reads as an `overrideref`, which no pass folds: its value arrives when the
  // pipeline is built, not when the module is compiled (#8 A7).
  for (const o of overrides) {
    defineOnce({ kind: 'override', name: o.name, type: o.type, mutable: false })
  }
  // A module variable (§24) reads and writes as a `varref`, like a binding; its space decides
  // what may hold an atomic and which stage may reach it.
  for (const v of vars) {
    defineOnce({ kind: 'modvar', name: v.name, type: v.type, mutable: true, space: v.space })
  }
  return scope
}

/** Lower `node`'s body into `stub`. For a class method or constructor (#86) `receiver` says
 *  what `this` is: the struct-typed first parameter of a method, read as `self_`, or the local
 *  `self_` a constructor starts from the zero struct and returns. */
export function fillFunctionBody(
  node: FunctionNode,
  stub: FuncDecl,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  callees: Map<string, FuncDecl>,
  consts: readonly ScopedConst[] = [],
  bindings: readonly BindingDecl[] = [],
  structs: readonly CollectedStruct[] = [],
  symbols?: DeclaredSymbolSink,
  overrides: readonly OverrideDecl[] = [],
  vars: readonly ModuleVarDecl[] = [],
  receiver?: Receiver,
  shown?: string,
): void {
  const scope = functionScope(stub, callees, consts, bindings, structs, symbols, overrides, vars)
  // `this` is defined first, so the IR name `self_` is free for it: the stub's own parameter
  // and the receiver read the same name. A user parameter called `self_` was refused at the
  // signature (TS8035), and a local called `self_` is renamed as any shadowing local is.
  const prologue: Stmt[] = []
  if (receiver !== undefined) {
    if (receiver.mode === 'param') {
      scope.define({
        kind: 'param',
        name: 'this',
        type: receiver.type,
        mutable: false,
        irName: 'self_',
      })
    } else {
      // A method that changes its object arrives as `self_in` and works on the copy `self_`;
      // the parameter is bound so the name stays its own in the body.
      if (receiver.mode === 'copy') {
        scope.define({ kind: 'param', name: SELF_IN, type: receiver.type, mutable: false })
      }
      prologue.push(...ctorPrologue(receiver, scope, sourceFile, diagnostics))
    }
  }
  // A method's stub carries `self_` ahead of the declared parameters; a constructor's carries
  // exactly the declared ones.
  const offset = stub.params.length - node.parameters.length
  // A parameter that repeats a module const, a binding or an override is refused the way a
  // `let` at the top of the body is (TS8023), on the parameter, instead of the scope's throw
  // escaping `compileTsSource` (#68). The parameter is not defined, so the body's uses of the
  // name resolve to the module-level declaration; the module is refused anyway.
  stub.params.forEach((p, i) => {
    if (i < offset) return
    if (scope.hasInCurrent(p.name)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node.parameters[i - offset]?.name ?? node,
        `Parameter "${p.name}" repeats the name of a module-level declaration; rename one of them.`,
        TS_CODES.DUPLICATE_SYMBOL,
      )
      return
    }
    scope.define({ kind: 'param', name: p.name, type: p.type, mutable: true })
  })
  if (node.name !== undefined && ts.isIdentifier(node.name)) {
    recordDeclaration(symbols, sourceFile, node.name, {
      name: shown ?? stub.name,
      kind: 'function',
      type: stub.ret,
      params: stub.params.slice(offset).map((p) => ({ name: p.name, type: p.type })),
    })
  }
  // The stub's parameters and the declaration's are one to one and in order: `parseSignature`
  // pushes one entry per parameter and bails out on the first it cannot accept, so it returns a
  // stub only when it accepted them all.
  stub.params.forEach((p, i) => {
    if (i < offset) return
    const nameNode = node.parameters[i - offset]?.name
    if (nameNode === undefined || !ts.isIdentifier(nameNode)) return
    recordDeclaration(symbols, sourceFile, nameNode, { name: p.name, kind: 'param', type: p.type })
  })
  let body = lowerStatements(node.body!.statements, sourceFile, scope, diagnostics)
  if (receiver !== undefined && receiver.mode !== 'param') {
    // A constructor returns the struct it built, and a method that changes its object returns
    // the copy: a bare `return` inside either returns `self_`, and one more closes the body.
    const self = selfRef(receiver.type)
    for (const r of collectReturns(body)) if (!r.expr) (r as { expr?: Expr }).expr = self
    body = [...prologue, ...body, { s: 'return', expr: self }]
  }
  ;(stub as { body: readonly Stmt[] }).body = body
  if (typeKey(stub.ret) === 'void') {
    // An entry function (`stub.stage` set) with no return type annotation was left at the
    // tentative `void` from `parseSignature` above; now that the body is lowered, a `return`
    // carrying a value means that tentative void was wrong, and the front end can name the
    // real (inferred) type — this is now an error, not the warning `parseSignature` gives a
    // helper function, because it emits invalid WGSL (the design doc's Stage 3 check).
    if (node.type === undefined && stub.stage) {
      const valued = collectReturns(body).find((r) => r.expr)
      if (valued?.expr) {
        pushDiag(
          diagnostics,
          sourceFile,
          node.name ?? node,
          `Entry function "${stub.name}" returns a value (inferred type ${typeKey(valued.expr.type)}) but has no return type annotation; add ": ${typeKey(valued.expr.type)}" to the signature.`,
          TS_CODES.RETURN_SHAPE,
        )
      }
    }
    return
  }
  for (const r of collectReturns(body)) {
    if (!r.expr) {
      pushDiag(
        diagnostics,
        sourceFile,
        node.name ?? node,
        `Function "${stub.name}" returns ${typeKey(stub.ret)} but has a bare "return".`,
        TS_CODES.RETURN_SHAPE,
      )
      continue
    }
    if (typeKey(r.expr.type) !== typeKey(stub.ret)) {
      if (
        r.expr.op === 'construct' &&
        stub.ret.kind === 'struct' &&
        r.expr.type.kind === 'struct'
      ) {
        ;(r.expr as { type: ShaderType }).type = stub.ret
        continue
      }
      pushDiag(
        diagnostics,
        sourceFile,
        node.name ?? node,
        `Function "${shown ?? stub.name}" return type mismatch: declared ${typeKey(stub.ret)}, got ${typeKey(r.expr.type)}.`,
        TS_CODES.TYPE_MISMATCH,
      )
    }
  }
}

function parseStage(
  node: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): { stage?: FuncDecl['stage']; workgroupSize?: number } {
  const decos = decoratorsOf(node)
  let stage: FuncDecl['stage'] | undefined
  let workgroupSize: number | undefined
  for (const d of decos) {
    checkAttributeName(diagnostics, sourceFile, d)
    const text = d.getText(sourceFile)
    if (/^@vertex\b/.test(text)) stage = 'vertex'
    else if (/^@fragment\b/.test(text)) stage = 'fragment'
    else if (/^@compute\b/.test(text)) {
      stage = 'compute'
      const m = text.match(/@compute\(\s*\[\s*(\d+)\s*(?:,\s*(\d+))?\s*(?:,\s*(\d+))?\s*\]/)
      workgroupSize = m ? Number(m[1]) : 64
      const y = m?.[2] !== undefined ? Number(m[2]) : undefined
      const z = m?.[3] !== undefined ? Number(m[3]) : undefined
      if ((y !== undefined && y !== 1) || (z !== undefined && z !== 1)) {
        const shape = [m![1], m![2], m![3]].filter((v) => v !== undefined).join(', ')
        pushDiag(
          diagnostics,
          sourceFile,
          d,
          `@compute workgroup shape [${shape}] must have y and z equal to 1: the backend only ` +
            `carries the x workgroup size today, and would silently drop the rest.`,
          TS_CODES.WORKGROUP_SHAPE,
        )
      }
    }
  }
  return { stage, workgroupSize }
}

function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  if (ts.canHaveDecorators(node)) return ts.getDecorators(node) ?? []
  const mods = (node as { modifiers?: readonly ts.ModifierLike[] }).modifiers ?? []
  return mods.filter(ts.isDecorator)
}

/** Validates every field of the struct named `structName` (a parameter's or a return type's
 *  struct) against `stage`/`direction`: a `@builtin(...)` field is checked with
 *  `checkBuiltinStage`, and a field with neither `@builtin(...)` nor `@location(...)` is a
 *  `STRUCT_FIELD_MISSING_ATTR` error — WGSL requires every entry-IO struct member to carry one,
 *  and the compiler otherwise emits that struct's WGSL text with a member neither backend nor
 *  Tint accepts, silently. Every diagnostic anchors at `node` (the parameter or the return type
 *  annotation) since a `StructField` carries no source position of its own — see `structs.ts`'s
 *  `collectStructs`, which already validated each field's builtin *name* independently of how
 *  the struct ends up used. */
function checkStructBuiltinFields(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  structName: string,
  structs: readonly CollectedStruct[],
  stage: BuiltinStage,
  direction: 'input' | 'output',
): void {
  const collected = structs.find((s) => s.decl.name === structName)
  if (!collected) return
  // Only a class can carry the decorator the message asks for: writing `@location(0)` on an
  // interface or type-literal member is a TypeScript syntax error, so telling that author to
  // add one names a fix they cannot apply. Say what they can do instead.
  const remedy =
    collected.spelling === 'class'
      ? `WGSL requires every entry ${direction} struct member to declare one.`
      : `WGSL requires every entry ${direction} struct member to declare one, and ` +
        `${collected.spelling === 'interface' ? 'an interface' : 'a type alias'} member cannot ` +
        `carry a decorator — declare "${structName}" as a class.`
  for (const field of collected.decl.fields) {
    if (!field.builtin && field.location === undefined) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Struct "${structName}" field "${field.name}" is used as a ${stage} ${direction} but ` +
          `has neither @builtin(...) nor @location(...): ${remedy}`,
        TS_CODES.STRUCT_FIELD_MISSING_ATTR,
      )
      continue
    }
    if (!field.builtin) continue
    checkBuiltinStage(diagnostics, sourceFile, node, field.builtin, stage, direction)
  }
}

function numberDecorator(node: ts.Node, _sf: ts.SourceFile, name: string): number | undefined {
  for (const d of decoratorsOf(node)) {
    if (!ts.isCallExpression(d.expression)) continue
    if (!ts.isIdentifier(d.expression.expression) || d.expression.expression.text !== name) continue
    const a = d.expression.arguments[0]
    if (a && ts.isNumericLiteral(a)) return Number(a.text)
  }
  return undefined
}

function collectReturns(stmts: readonly Stmt[]): { expr?: Expr }[] {
  const out: { expr?: Expr }[] = []
  const walk = (list: readonly Stmt[]) => {
    for (const s of list) {
      if (s.s === 'return') out.push(s)
      else if (s.s === 'if') {
        for (const arm of s.arms) walk(arm.body)
        if (s.elseBody) walk(s.elseBody)
      } else if (s.s === 'for') walk(s.body)
      else if (s.s === 'switch') {
        for (const c of s.cases) walk(c.body)
        if (s.defaultBody) walk(s.defaultBody)
      }
    }
  }
  walk(stmts)
  return out
}

function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code))
}
