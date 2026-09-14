// === Function lowering: two-pass signatures then bodies ===

import ts from 'typescript'
import type { BindingDecl, FuncDecl, Stmt, Expr, OverrideDecl } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import type { SourceSpan } from '../../../core/ir/span.js'
import { voidT, typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import { LoweringScope } from '../context.js'
import type { CollectedStruct } from '../structs.js'
import { recordDeclaration, type DeclaredSymbolSink } from '../symbols.js'
import { mapTsTypeToShaderType } from '../type-map.js'
import { lowerStatements } from './statement.js'
import { makeDiagnostic } from '../diagnostic.js'
import { spanOf } from '../span.js'
import { TS_CODES, type TsCode } from '../codes.js'
import { checkRecursion } from '../recursion.js'
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
  consts: readonly { name: string; type: ShaderType }[] = [],
  bindings: readonly BindingDecl[] = [],
  structs: readonly CollectedStruct[] = [],
  symbols?: DeclaredSymbolSink,
  overrides: readonly OverrideDecl[] = [],
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
  const funcs: FuncDecl[] = []
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
    )
    funcs.push(stub)
  }
  // Before the bodies are handed on: a call cycle emits WGSL Tint refuses (#48), and no gate
  // downstream of here was looking for one. In a single file a function is called by the name
  // it is declared under, so the graph key and the resolver are both just `callees`.
  checkRecursion(
    ready.map((stmt) => ({
      name: stmt.name!.text,
      decl: stmt,
      sourceFile,
      resolve: (callee: string) => (callees.has(callee) ? callee : undefined),
    })),
    diagnostics,
  )
  return funcs
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
  const params: FuncDecl['params'][number][] = []
  for (const p of node.parameters) {
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
    const pType = mapTsTypeToShaderType(p.type, sourceFile, diagnostics)
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
        if (stageInfo.stage) {
          checkBuiltinStage(
            diagnostics,
            sourceFile,
            builtinArg.argNode,
            builtinArg.name,
            stageInfo.stage,
            'input',
          )
        }
      }
    }
    if (stageInfo.stage && pType.kind === 'struct') {
      checkStructBuiltinFields(
        diagnostics,
        sourceFile,
        p,
        pType.name,
        structs,
        stageInfo.stage,
        'input',
      )
    }
    const location = numberDecorator(p, sourceFile, 'location')
    params.push({
      name: p.name.text,
      type: pType,
      ...(builtin ? { builtin } : {}),
      ...(location !== undefined ? { location } : {}),
    })
  }
  let ret: ShaderType = voidT
  if (node.type) {
    if (node.type.kind === ts.SyntaxKind.VoidKeyword) ret = voidT
    else {
      const mapped = mapTsTypeToShaderType(node.type, sourceFile, diagnostics)
      if (!mapped) {
        pushDiag(
          diagnostics,
          sourceFile,
          node.type,
          `Unsupported return type for "${name}".`,
          TS_CODES.UNKNOWN_TYPE,
        )
        return undefined
      }
      ret = mapped
    }
    if (stageInfo.stage && ret.kind === 'struct') {
      checkStructBuiltinFields(
        diagnostics,
        sourceFile,
        node.type,
        ret.name,
        structs,
        stageInfo.stage,
        'output',
      )
    }
  } else if (!stageInfo.stage) {
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

export function fillFunctionBody(
  node: ts.FunctionDeclaration,
  stub: FuncDecl,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  callees: Map<string, FuncDecl>,
  consts: readonly { name: string; type: ShaderType }[] = [],
  bindings: readonly BindingDecl[] = [],
  structs: readonly CollectedStruct[] = [],
  symbols?: DeclaredSymbolSink,
  overrides: readonly OverrideDecl[] = [],
): void {
  const scope = new LoweringScope(callees, symbols)
  scope.setStructs(structs.map((s) => s.decl))
  for (const c of consts) {
    scope.define({
      kind: 'module',
      name: c.name,
      type: c.type,
      mutable: false,
      constValue: 'cpuValue' in c ? (c as { cpuValue?: number | boolean }).cpuValue : undefined,
    })
  }
  for (const b of bindings) {
    scope.define({
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
    scope.define({ kind: 'override', name: o.name, type: o.type, mutable: false })
  }
  for (const p of stub.params) {
    scope.define({ kind: 'param', name: p.name, type: p.type, mutable: true })
  }
  if (node.name !== undefined) {
    recordDeclaration(symbols, sourceFile, node.name, {
      name: stub.name,
      kind: 'function',
      type: stub.ret,
      params: stub.params.map((p) => ({ name: p.name, type: p.type })),
    })
  }
  // The stub's parameters and the declaration's are one to one and in order: `parseSignature`
  // pushes one entry per parameter and bails out on the first it cannot accept, so it returns a
  // stub only when it accepted them all.
  stub.params.forEach((p, i) => {
    const nameNode = node.parameters[i]?.name
    if (nameNode === undefined || !ts.isIdentifier(nameNode)) return
    recordDeclaration(symbols, sourceFile, nameNode, { name: p.name, kind: 'param', type: p.type })
  })
  const body = lowerStatements(node.body!.statements, sourceFile, scope, diagnostics)
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
          node.name!,
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
        node.name!,
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
        node.name!,
        `Function "${stub.name}" return type mismatch: declared ${typeKey(stub.ret)}, got ${typeKey(r.expr.type)}.`,
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
