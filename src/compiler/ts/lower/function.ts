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
import {
  LoweringScope,
  fileFunctionsOf,
  privateFieldTableOf,
  readonlyFieldTableOf,
  restrictedFieldTableOf,
  withheldTableOf,
} from '../context.js'
import type { CollectedStruct } from '../structs.js'
import { recordDeclaration, type DeclaredSymbolSink } from '../symbols.js'
import { mapTsTypeToShaderType } from '../type-map.js'
import { isMixinDeclaration } from '../mixins.js'
import { inferFrom, instanceName, typeSuffix, withTypeArguments } from '../generics.js'
import { refuseAtomicDeclaration } from './atomics.js'
import {
  boundNamesOf,
  collectLocalFunctions,
  declarationsIn,
  type LocalFunction,
} from './local-functions.js'
import {
  filledCallsOf,
  paramDefaultNodes,
  recordParamDefaults,
  setParamDefault,
} from './param-defaults.js'
import { lowerStatements } from './statement.js'
import { lowerExpression } from './expression.js'
import { retargetIntLitCtx } from '../lit-coerce.js'
import { eachExpr, eachStmtExpr } from '../../../core/ir/visit.js'
import { ATOMIC_INTRINSICS } from '../../../core/intrinsics.js'
import { makeDiagnostic } from '../diagnostic.js'
import { spanOf, withSpan } from '../span.js'
import { TS_CODES, type TsCode } from '../codes.js'
import { checkLoweredRecursion, checkRecursion, type RecursionNode } from '../recursion.js'
import {
  eachNamespaceStatement,
  namespaceMemberName,
  refuseNamespaceStatement,
} from '../namespaces.js'
import {
  collectClassFunctions,
  ctorParts,
  ctorPrologue,
  selfRef,
  type ClassFunction,
  type Receiver,
} from './class-methods.js'
import {
  builtinDecoratorArg,
  checkAttributeName,
  checkBuiltinName,
  checkBuiltinStage,
  checkBuiltinType,
  checkLocationType,
  interpolateDecoratorArg,
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
  // Every function the file declares, at the top level and inside a namespace, with the
  // emitted name each takes (T4, #92): a top-level `warm` is `warm`, and the same function
  // inside `namespace Palette` is `Palette_warm`.
  const decls: { node: ts.FunctionDeclaration; irName: string | undefined; prefix: string }[] = []
  eachNamespaceStatement(sourceFile.statements, sourceFile, diagnostics, (stmt, prefix) => {
    if (!ts.isFunctionDeclaration(stmt)) {
      // A namespace holds functions, constants, classes and namespaces. The consts are
      // module-const.ts's and the classes are structs.ts's, under the same flattened name
      // (#107); the rest has no flattened form. Only the namespace's own statements are refused
      // here, since a top-level statement of any kind is semantic.ts's to judge.
      if (prefix !== '' && !isNamespaceConst(stmt) && !ts.isClassDeclaration(stmt)) {
        refuseNamespaceStatement(stmt, prefix, sourceFile, diagnostics)
      }
      return
    }
    // A mixin is a function whose body is one `return class … { … }` (T8, #92). It runs when
    // the file is compiled, in structs.ts, and emits no function of its own: a class
    // expression is no GPU value, and there is nothing for a call to it to mean at run time.
    if (isMixinDeclaration(stmt)) return
    decls.push({
      node: stmt,
      irName: prefix === '' ? undefined : namespaceMemberName(prefix, stmt.name?.text ?? ''),
      prefix,
    })
  })
  // An overload signature is a declaration of the same function with no body, above the one
  // that has it (roadmap 0.3 item T6, #92). WGSL has no overloading and TypeScript's own rule
  // makes the implementation signature the one every call is checked against, so the
  // signatures are skipped and the implementation is lowered. A body-less declaration with no
  // implementation, and an ambient `declare function`, keep the error they had: neither names
  // a function this module can emit.
  const implemented = new Set<string>()
  for (const { node, irName } of decls) {
    if (node.body && node.name) implemented.add(irName ?? node.name.text)
  }
  const isAmbient = (node: ts.FunctionDeclaration): boolean =>
    node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword) ?? false
  const callees = new Map<string, FuncDecl>()
  // What this file knows about its own functions beside the callee table: the names it could
  // not lower, so a call to one says nothing instead of "Unknown function" (T10, #92), and the
  // generic ones with the hook that makes an instance (T9, #92).
  const fns = fileFunctionsOf(callees)
  const refused = fns.refused
  const generics = new Map<string, { node: ts.FunctionDeclaration; prefix: string }>()
  const ready: { node: ts.FunctionDeclaration; stub: FuncDecl; prefix: string }[] = []
  for (const { node: stmt, irName, prefix } of decls) {
    if (
      !stmt.body &&
      stmt.name !== undefined &&
      !isAmbient(stmt) &&
      implemented.has(irName ?? stmt.name.text)
    ) {
      continue
    }
    // A generic function is compiled once per set of argument types the file calls it with
    // (roadmap 0.3 item T9, #92), so it has no signature of its own: `pick<T>` is not a
    // function the module emits, `pick_f32` and `pick_vec3` are. Held aside for the
    // instantiator below, which a call site reaches through the scope.
    if ((stmt.typeParameters?.length ?? 0) > 0 && stmt.body && stmt.name !== undefined) {
      const base = irName ?? stmt.name.text
      generics.set(base, { node: stmt, prefix })
      fns.generics.add(base)
      continue
    }
    const stub = parseSignature(stmt, sourceFile, diagnostics, structs, irName)
    if (!stub) {
      refused.add(irName ?? stmt.name?.text ?? '')
      if (stmt.name !== undefined) refused.add(stmt.name.text)
      continue
    }
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
    ready.push({ node: stmt, stub, prefix })
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
  // A local function is a function of the module, named after the body that declares it
  // (roadmap 0.3 item T7, #92). Collected before any body is lowered, so a call to one
  // resolves; the alias from the written name to the emitted one rides on the scope, which is
  // what lets two bodies each declare an `f`.
  const localFns: LocalFunction[] = []
  const aliasesOf = new Map<string, Map<string, string>>()
  const seeLocals = (
    decls: readonly ts.VariableDeclaration[],
    ownerName: string,
    bound: ReadonlySet<string>,
  ): void => {
    const found = collectLocalFunctions(
      decls,
      ownerName,
      bound,
      sourceFile,
      diagnostics,
      structs,
      refused,
    )
    if (found.length === 0) return
    let alias = aliasesOf.get(ownerName)
    if (!alias) {
      alias = new Map<string, string>()
      aliasesOf.set(ownerName, alias)
    }
    for (const fn of found) {
      if (callees.has(fn.stub.name)) {
        pushDiag(
          diagnostics,
          sourceFile,
          fn.decl,
          `"${fn.stub.name}" is both a function of this module and the emitted name of the ` +
            `local "${fn.localName}"; rename one of them.`,
          TS_CODES.DUPLICATE_SYMBOL,
        )
        continue
      }
      callees.set(fn.stub.name, fn.stub)
      alias.set(fn.localName, fn.stub.name)
      localFns.push(fn)
      // A local function's own body is an owner in turn, so a helper inside a helper works.
      seeLocals(
        declarationsIn(fn.node.body),
        fn.stub.name,
        boundNamesOf(
          fn.node,
          fn.stub.params.map((p) => p.name),
        ),
      )
    }
  }
  // The module top level, and each namespace body, where a `const f = (…) => …` is already a
  // module function: it takes the namespace's flattened name (`N_f`), which is how a call to it
  // inside that namespace resolves with no alias at all (T4, #92).
  const topDecls = new Map<string, ts.VariableDeclaration[]>()
  eachNamespaceStatement(sourceFile.statements, sourceFile, [], (stmt, prefix) => {
    if (!ts.isVariableStatement(stmt)) return
    const into = topDecls.get(prefix) ?? []
    into.push(...stmt.declarationList.declarations)
    topDecls.set(prefix, into)
  })
  for (const [prefix, decls] of topDecls) seeLocals(decls, prefix, new Set())
  for (const { node, stub } of ready) {
    if (node.body)
      seeLocals(
        declarationsIn(node.body),
        stub.name,
        boundNamesOf(
          node,
          stub.params.map((p) => p.name),
        ),
      )
  }
  for (const cf of classFns) {
    if (cf.node?.body) {
      seeLocals(
        declarationsIn(cf.node.body),
        cf.stub.name,
        boundNamesOf(
          cf.node,
          cf.stub.params.map((p) => p.name),
        ),
      )
    }
  }
  // Every default, lowered before any body, since a body may call a function declared after it
  // and the call needs the default already in hand (roadmap 0.3 item T7, #92). The scope is the
  // module's, with no parameters in it, which is why a default that reads one was refused at
  // the signature.
  //
  // To a fixed point, because one default may be `g()` where `g` itself has a default to fill
  // in, in either declaration order. Every pass but the last writes its diagnostics to a
  // scratch list and throws them away: a default that could not be lowered yet is not yet an
  // error. The pass that adds nothing runs once more into the real list, this time saying so.
  const defaulted = [...ready, ...classFns.map((cf) => ({ stub: cf.stub, prefix: '' }))]
  const lowerAll = (into: TsCompilerDiagnostic[], final: boolean): boolean => {
    let progressed = false
    for (const { stub, prefix } of defaulted) {
      const moved = lowerParamDefaults(
        stub,
        sourceFile,
        into,
        callees,
        consts,
        bindings,
        structs,
        final ? symbols : undefined,
        overrides,
        vars,
        prefix === '' ? undefined : prefix,
        final,
      )
      progressed ||= moved
    }
    return progressed
  }
  while (lowerAll([], false));
  lowerAll(diagnostics, true)
  const funcs: FuncDecl[] = []
  const nodeByName = new Map<string, FunctionNode>()
  // One instance of a generic function per set of argument types (roadmap 0.3 item T9, #92).
  // Made where a call asks for it rather than in a pass of its own, because a call is the only
  // thing that says which types: `pick(1., 2.)` is what decides that `pick_f32` exists.
  //
  // The instance is pushed into `funcs` as it is made, which puts it ahead of the body that
  // asked for it — WGSL wants a function declared before it is called, and the bodies below
  // push themselves only after they are filled.
  const instances = new Map<string, FuncDecl>()
  // The name each instance's author wrote: `pick` for `pick_f32`.
  const writtenAs = new Map<string, string>()
  fns.instantiate = (name, node, argTypes, sf, diags): FuncDecl | undefined => {
    const generic = generics.get(name)
    if (generic === undefined) return undefined
    const order = (generic.node.typeParameters ?? []).map((p) => p.name.text)
    const bound = typeArgumentsFor(generic.node, order, node, argTypes, sf, diags)
    if (bound === undefined) return undefined
    const emitted = instanceName(
      name,
      order.map((n) => bound.get(n)!),
    )
    const had = instances.get(emitted)
    if (had !== undefined) return had
    const stub = withTypeArguments(bound, () =>
      parseSignature(generic.node, sf, diags, structs, emitted),
    )
    if (!stub) {
      refused.add(name)
      return undefined
    }
    // Registered BEFORE the body is lowered, so a generic that calls itself at the same types
    // finds this instance rather than making another one forever.
    instances.set(emitted, stub)
    callees.set(emitted, stub)
    writtenAs.set(emitted, name)
    withTypeArguments(bound, () => {
      fillFunctionBody(
        generic.node,
        stub,
        sf,
        diags,
        callees,
        consts,
        bindings,
        structs,
        symbols,
        overrides,
        vars,
        undefined,
        name,
        generic.prefix === '' ? undefined : generic.prefix,
      )
    })
    funcs.push(stub)
    nodeByName.set(emitted, generic.node)
    return stub
  }
  // A body lowered for a class that inherits it says what it says into a list of its own. What
  // it shares with the body the declaring class lowered was said there, once (Rule 12.4); a
  // static that fails only for the inheriting class, where `this` is that class, is an error
  // where something calls it and nothing where nothing does (Rule 8.13), which is decided once
  // every body is lowered and the calls are known.
  const inheritedSaid: { cf: ClassFunction; said: TsCompilerDiagnostic[] }[] = []
  for (const cf of classFns) {
    if (cf.node !== undefined) {
      const said = cf.inherited === true ? [] : diagnostics
      if (said !== diagnostics) inheritedSaid.push({ cf, said })
      fillFunctionBody(
        cf.node,
        cf.stub,
        sourceFile,
        said,
        callees,
        consts,
        bindings,
        structs,
        symbols,
        overrides,
        vars,
        cf.receiver,
        cf.shown,
        undefined,
        undefined,
        cf.staticOwner,
        cf.staticSuper,
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
        sourceFile,
      )
      ;(cf.stub as { body: readonly Stmt[] }).body = [
        ...ctorPrologue(cf.receiver, scope, sourceFile, diagnostics),
        { s: 'return', expr: selfRef(cf.receiver.type) },
      ]
    }
    funcs.push(cf.stub)
  }
  for (const { node: stmt, stub, prefix } of ready) {
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
      undefined,
      undefined,
      prefix === '' ? undefined : prefix,
      aliasesOf.get(stub.name),
    )
    funcs.push(stub)
    nodeByName.set(stub.name, stmt)
  }
  for (const fn of localFns) {
    fillFunctionBody(
      fn.node,
      fn.stub,
      sourceFile,
      diagnostics,
      callees,
      consts,
      bindings,
      structs,
      symbols,
      overrides,
      vars,
      undefined,
      undefined,
      undefined,
      aliasesOf.get(fn.stub.name),
    )
    funcs.push(fn.stub)
    nodeByName.set(fn.stub.name, fn.node)
  }
  sayInherited(inheritedSaid, funcs, new Set(classFns.map((cf) => cf.stub)), diagnostics)
  // Before the bodies are handed on: a call cycle emits WGSL Tint refuses (#48), and no gate
  // downstream of here was looking for one. In a single file a function is called by the name
  // it is declared under, so the graph key and the resolver are both just `callees`. A method
  // called through its object (`r.at(t)`) is not an identifier call and is not in this graph;
  // the lowered calls below are where its cycle shows.
  const graph: RecursionNode[] = [
    ...ready.map(({ node, stub }) => ({
      // The EMITTED name, which for a namespace's function is the flattened one (T4, #92):
      // the graph's keys and the call resolver are both `callees`, which is keyed by it.
      name: stub.name,
      decl: node,
      sourceFile,
      resolve: (callee: string) => (callees.has(callee) ? callee : undefined),
      filled: filledCallsOf(stub),
    })),
    ...classFns.flatMap((cf) =>
      cf.node === undefined
        ? []
        : [
            {
              name: cf.stub.name,
              shown: cf.shown,
              decl: cf.node,
              sourceFile,
              resolve: (callee: string) => (callees.has(callee) ? callee : undefined),
              filled: filledCallsOf(cf.stub),
            },
          ],
    ),
  ]
  checkRecursion(graph, diagnostics)
  // A cycle through a call on a value (`this.g(n)`, `o.m()`), a getter, a setter or `new`, none
  // of which names a function in its text: read off the calls the bodies lowered to (Rule 8.4).
  checkLoweredRecursion(
    graph,
    funcs,
    new Map([...writtenAs, ...classFns.map((cf) => [cf.stub.name, cf.shown] as const)]),
    nodeByName,
    sourceFile,
    diagnostics,
  )
  checkFragmentOnlyOps(funcs, nodeByName, sourceFile, diagnostics)
  return funcs
}

/** The ops WGSL and GLSL ES 3.00 allow only in the fragment stage: the kill, the three
 *  screen-space derivatives, which need the neighbouring invocations of a quad, and the depth
 *  comparison with an IMPLICIT level of detail, which needs the same derivatives to pick its
 *  level (roadmap 0.4 item 11; Tint: "built-in cannot be used by compute pipeline stage").
 *  `textureSampleCompareLevel` samples level 0 and is legal in any stage, so it is not here. */
/** The name the author wrote for a fragment-only call. The set below holds NEUTRAL ids, and the
 *  array and cube forms of a texture read are ids of their own (`textureSampleCompareArray`,
 *  `textureSampleBiasArray`, `textureSampleCompareCube`) that no author writes: the surface
 *  spells every form with the one name and the texture's dim picks the id. So the suffix comes
 *  off before the message, which otherwise names a function the file does not contain. */
const writtenName = (op: string): string =>
  op.replace(/^(texture\w+?)(CubeArray|Array|Cube)$/, '$1')

/** The stage-restricted calls, EXPORTED so a later pass can seed its own walk from the same
 *  rows rather than keep a second copy (#145). */
export const FRAGMENT_ONLY_CALLS: ReadonlySet<string> = new Set([
  // The implicit level of detail of a plain sample needs the derivatives. The plain, array and
  // cube-array ids are here AND in the core lint (fragment-only-builtin), which is the EDSL's
  // only gate; the front end says it first, at the entry, with the call chain in the sentence.
  // A cube samples under the plain id, since `arraySuffix` gives a cube no suffix.
  //
  // `textureSample` and `textureSampleArray` were in the LINT alone until #145, so a vertex
  // entry sampling a `texture_2d` was answered by an SD0109 from the backend rather than by a
  // sentence about the author's own file. Keeping the two tables equal is what the test does.
  'textureSample',
  'textureSampleArray',
  'textureSampleCubeArray',
  'textureSampleCompare',
  'textureSampleCompareArray',
  'textureSampleCompareCube',
  // A bias shifts the IMPLICIT level of detail, so it needs the derivatives too; Tint and a
  // WebGL2 driver both refuse it outside a fragment stage (roadmap 0.4 item 12).
  'textureSampleBias',
  'textureSampleBiasArray',
  'textureSampleBiasCubeArray',
  'textureSampleCompareCubeArray',
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

/** The calls WGSL admits in a fragment or a compute stage but not in a vertex one, EXPORTED
 *  beside the set above (#145): a texture write (`textureStore` is `@stage("fragment",
 *  "compute")` in Tint's table, core.def:1484-1522) and every atomic built-in
 *  ("Atomic built-in functions must not be used in a vertex shader stage", wgsl.txt:25422).
 *  The atomics are read off the intrinsic catalogue rather than listed again, so one added
 *  there is refused in a vertex entry by existing.
 *
 *  Any call that TOUCHES a writable storage texture belongs to this group too. That rule is
 *  about the RESOURCE, not the builtin — "a resource with write or read_write access must not
 *  be statically accessed by a vertex shader" — so it cannot be a name: `textureLoad` and
 *  `textureDimensions` are the same ids a sampled texture uses. It is recognised by the
 *  argument's own type in {@link stageRestrictedOpsOf}. Reported the way the fragment-only set
 *  is, over the call graph, but only for a vertex entry. */
export const FRAGMENT_OR_COMPUTE_CALLS: ReadonlySet<string> = new Set([
  'textureStore',
  ...Object.keys(ATOMIC_INTRINSICS),
])

/** Why a call of {@link FRAGMENT_OR_COMPUTE_CALLS} is not in a vertex shader, by family. The
 *  rule is one of two in the spec: a resource with write access is not reachable from a vertex
 *  stage (wgsl.txt:7741-7743, 15343-15347), or the built-in itself is stage-restricted. */
const whyNotVertex = (op: string): string =>
  op === 'textureStore'
    ? `WGSL allows a texture write in a fragment or compute stage only.`
    : ATOMIC_NAMES.has(op)
      ? `WGSL allows an atomic built-in in a fragment or compute stage only.`
      : `A storage texture declared "read_write" must not be reached from a vertex stage at ` +
        `all, so reading or measuring one there is refused with writing it. (A "write" one ` +
        `refuses the read itself, whatever the stage.)`

const ATOMIC_NAMES: ReadonlySet<string> = new Set(Object.keys(ATOMIC_INTRINSICS))

/** Whether a call TOUCHES a writable storage texture — the member of the fragment-or-compute
 *  group that no name distinguishes, because the rule is about the resource. `textureLoad`,
 *  `textureDimensions` and `textureNumLayers` are the ids a sampled texture uses too, so the
 *  argument's type is what decides. `textureStore` is in the set by name and needs no help: a
 *  storage texture is the only thing it takes. */
const touchesWritableStorage = (e: Extract<Expr, { op: 'call' }>): boolean =>
  e.args.some((a) => a.type.kind === 'storage-texture' && a.type.access !== 'read')

/** Whether a function's OWN body uses a stage-restricted op, by the name to report it under. */
function stageRestrictedOpsOf(body: readonly Stmt[]): Set<string> {
  const found = new Set<string>()
  const walkStmt = (s: Stmt): void => {
    if (s.s === 'discard') found.add('discard')
    eachStmtExpr(
      s,
      (e) => {
        eachExpr(e, (x) => {
          if (x.op !== 'call') return
          if (
            FRAGMENT_ONLY_CALLS.has(x.fn) ||
            FRAGMENT_OR_COMPUTE_CALLS.has(x.fn) ||
            touchesWritableStorage(x)
          )
            found.add(x.fn)
        })
      },
      walkStmt,
    )
  }
  for (const s of body) walkStmt(s)
  return found
}

/** What the bodies lowered for an inheriting class said, now that every call is known. A
 *  diagnostic the file already carries at the same place is left out (Rule 12.4).
 *
 *  A body lowered again for a class that inherits it can fail for that class alone: `this.#k`
 *  in a static `Derived` inherits, `weigh(this)` where `weigh` takes the base. Such a copy is
 *  refused where a call reaches it and dropped where none does, as TypeScript, which lowers
 *  nothing per class, has nothing to say about a body no one runs that way. What reaches it is
 *  a function that is not a class's own (an entry, a top-level function), through any chain of
 *  calls; a class's function that nothing so reaches and that calls a dropped copy is dropped
 *  with it, so no call is left without its function. A copy of an `abstract` class's method is
 *  the only lowering its body gets, so what it says is said whether or not anything calls it. */
function sayInherited(
  inherited: readonly { cf: ClassFunction; said: readonly TsCompilerDiagnostic[] }[],
  funcs: FuncDecl[],
  classStubs: ReadonlySet<FuncDecl>,
  diagnostics: TsCompilerDiagnostic[],
): void {
  const onlyLowering = (cf: ClassFunction): boolean =>
    cf.kind !== 'static' &&
    cf.node !== undefined &&
    ts.isClassLike(cf.node.parent) &&
    (cf.node.parent.modifiers?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false)
  const byName = new Map(funcs.map((f) => [f.name, f]))
  const live = new Set<string>()
  const visit = (names: Iterable<string>): void => {
    for (const name of names) {
      if (live.has(name)) continue
      live.add(name)
      const f = byName.get(name)
      if (f !== undefined) visit(calleeNamesOf(f.body))
    }
  }
  for (const f of funcs) if (!classStubs.has(f)) visit([f.name])
  const dropped = new Set(
    inherited
      .filter(
        ({ cf, said }) =>
          !onlyLowering(cf) && !live.has(cf.stub.name) && said.some((d) => d.category === 'error'),
      )
      .map(({ cf }) => cf.stub.name),
  )
  for (let grew = dropped.size > 0; grew;) {
    grew = false
    for (const f of funcs) {
      if (dropped.has(f.name) || live.has(f.name)) continue
      if ([...calleeNamesOf(f.body)].some((n) => dropped.has(n))) {
        dropped.add(f.name)
        grew = true
      }
    }
  }
  for (let i = funcs.length - 1; i >= 0; i--) if (dropped.has(funcs[i]!.name)) funcs.splice(i, 1)
  const key = (d: TsCompilerDiagnostic): string =>
    `${d.start}:${d.length}:${d.code ?? ''}:${d.message}`
  const said = new Set(diagnostics.map(key))
  for (const { cf, said: own } of inherited) {
    if (dropped.has(cf.stub.name)) continue
    for (const d of own) {
      if (said.has(key(d))) continue
      said.add(key(d))
      diagnostics.push(d)
    }
  }
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
    own.set(f.name, stageRestrictedOpsOf(f.body))
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
        // Everything in `found` that is not fragment-only is a vertex rule: the two sets are
        // disjoint, and a name that reached `found` through the writable-storage test is in
        // neither. `discard` and the fragment-only set take the other arm.
        const vertexOnlyRule = !FRAGMENT_ONLY_CALLS.has(op) && op !== 'discard'
        // A texture write, a writable-storage read and an atomic are legal in a compute entry;
        // only a vertex entry is refused them.
        if (vertexOnlyRule && entry.stage !== 'vertex') continue
        reported.add(op)
        const where =
          name === entry.name
            ? `"${entry.name}" is a ${entry.stage} entry`
            : `"${name}" is reachable from the ${entry.stage} entry "${entry.name}"`
        pushDiag(
          diagnostics,
          sourceFile,
          node.name,
          vertexOnlyRule
            ? `"${op}" is only valid in a fragment or compute shader; ${where}. ` + whyNotVertex(op)
            : `"${writtenName(op)}" is only valid in a fragment shader; ${where}.`,
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
export type FunctionNode =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  /** A getter or a setter, which is a method of its class once lowered (Rule 8.11). */
  | ts.AccessorDeclaration
  | ts.ConstructorDeclaration
  /** A local function: `const f = (x: f32): f32 => ...` and the `function (x) { ... }` spelling
   *  of it (roadmap 0.3 item T7, #92). Both carry `parameters`, an optional `type` and a
   *  `body`, and an arrow's body may be an expression rather than a block. */
  | ts.ArrowFunction
  | ts.FunctionExpression

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
  opts: { readonly owner?: string; readonly forbidSelf?: boolean; readonly fnName?: string } = {},
): FuncDecl['params'][number][] | undefined {
  const params: FuncDecl['params'][number][] = []
  // `@location` slot → the parameter already holding it, for the collision rule below.
  const paramLocations = new Map<number, string>()
  const fnName = opts.fnName ?? opts.owner ?? 'this entry'
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
        `Optional parameter "${p.name.text}" is not supported: a shader value is always ` +
          `present, so there is no "absent" for the body to test. Give it a default instead, ` +
          `"${p.name.text}: T = ...", which a call that omits it fills in.`,
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
    // A default is filled in where the function is called (roadmap 0.3 item T7, #92), so the
    // two shapes that have nothing to fill in from are refused here rather than at a call.
    if (p.initializer !== undefined) {
      if (stage) {
        pushDiag(
          diagnostics,
          sourceFile,
          p.initializer,
          `An entry's parameters come from the pipeline, not from a call, so "${p.name.text}" ` +
            `cannot have a default.`,
          TS_CODES.FUNCTION_SHAPE,
        )
        return undefined
      }
      if (refuseDefaultReadingAParameter(p, parameters, sourceFile, diagnostics)) return undefined
    }
    // `self_` only: `self_in` was the second name a method that changed its object used, for
    // the copy it worked on, and there is no copy now — the object is written through.
    if (opts.forbidSelf && p.name.text === 'self_') {
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
    // The annotation is read first so that a missing one, which has no span of its own to
    // point at, is the parameter's complaint and everything else is the annotation's. Before,
    // both were pushed: a parameter written `x: f32 | vec3` said why the union names no type
    // AND that the parameter "requires a TypeShade type annotation", which it has (T10, #92).
    if (p.type === undefined) {
      pushDiag(
        diagnostics,
        sourceFile,
        p,
        `Parameter "${p.name.text}" requires a TypeShade type annotation.`,
        TS_CODES.UNKNOWN_TYPE,
      )
      return undefined
    }
    const pType = mapTsTypeToShaderType(p.type, sourceFile, diagnostics)
    if (refuseAtomicDeclaration(pType, p.type, sourceFile, diagnostics, 'a parameter'))
      return undefined
    if (!pType) return undefined
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
        checkBuiltinType(diagnostics, sourceFile, builtinArg.argNode, builtinArg.name, pType)
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
    // An emulated double on the entry's IO boundary (#151 F64-09). A FRAGMENT @location input
    // is interpolated; a VERTEX one is a buffer read, which carries a scalar f64's pair in one
    // slot but cannot carry a vec64's two.
    if (
      stage !== undefined &&
      location !== undefined &&
      refuseF64EntryIo(
        pType,
        `Parameter "${p.name.text}"`,
        stage === 'vertex' ? 'attribute' : 'varying',
        p,
        sourceFile,
        diagnostics,
      )
    ) {
      return undefined
    }
    // `@interpolate` on a BARE parameter, the spelling a fragment entry uses when it takes one
    // varying and declares no struct. It was read on a struct field and nowhere else, so the
    // attribute an author wrote here was dropped with no diagnostic and reached neither
    // target (§53). The whole argument list is kept, as the struct path keeps it: the GLSL
    // writer needs the sampling as well as the type.
    const interpolateAttr = interpolateDecoratorArg(diagnostics, sourceFile, decoratorsOf(p))
    if (interpolateAttr !== undefined && location === undefined) {
      pushDiag(
        diagnostics,
        sourceFile,
        p,
        `@interpolate belongs on a @location parameter: it says how a VARYING is interpolated, ` +
          `and a @builtin carries its own rule.`,
        TS_CODES.ATTRIBUTE_NAME,
      )
    }
    const interpolate =
      interpolateAttr !== undefined && location !== undefined
        ? interpolateAttr.slice('@interpolate('.length, -1)
        : undefined
    if (location !== undefined) {
      // WGSL: a compute entry point has no user-defined IO at all — its inputs are the
      // builtin invocation ids and its resources. `@location(0) x: f32` on one was emitted
      // and refused at the driver (§53).
      if (stage === 'compute') {
        pushDiag(
          diagnostics,
          sourceFile,
          p,
          `"${p.name.text}" is at a @location on a compute entry, which has no user IO: a ` +
            `compute shader reads its work from resources and the @builtin invocation ids.`,
          TS_CODES.STRUCT_FIELD_MISSING_ATTR,
        )
      }
      checkLocationType(diagnostics, sourceFile, p, p.name.text, pType, interpolate)
      // The slot rule the struct path has, for the parameter list: two parameters at one
      // `@location` is `'@location(0)' appears multiple times` on Tint, and was emitted here
      // with no diagnostic.
      const prior = paramLocations.get(location)
      if (prior !== undefined) {
        pushDiag(
          diagnostics,
          sourceFile,
          p,
          `"${fnName}" puts "${prior}" and "${p.name.text}" both at @location(` +
            `${String(location)}); each slot carries one value.`,
          TS_CODES.STRUCT_FIELD,
        )
      } else paramLocations.set(location, p.name.text)
    }
    params.push({
      name: p.name.text,
      type: pType,
      ...(builtin ? { builtin } : {}),
      ...(location !== undefined ? { location } : {}),
      ...(interpolate !== undefined
        ? { interpolate, attr: `@location(${String(location)}) ${interpolateAttr!}` }
        : {}),
    })
  }
  return params
}

/** Refuse a default that reads one of the function's own parameters, or `this`, and say why
 *  (roadmap 0.3 item T7, #92). A default is filled in at the call site, where the argument for
 *  an earlier parameter is an expression and not a value; splicing it in would emit that
 *  expression a second time and run whatever it calls twice. TypeScript's own meaning needs a
 *  binding for the argument, and a call is an expression with nowhere to put one.
 *
 *  Returns true when it reported. The walk skips a name in a position where it is a field and
 *  not a read: `p.k`, `{ k: 1. }`, so a parameter called `k` does not match either. */
function refuseDefaultReadingAParameter(
  p: ts.ParameterDeclaration,
  parameters: readonly ts.ParameterDeclaration[],
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  const names = new Set<string>()
  for (const other of parameters) if (ts.isIdentifier(other.name)) names.add(other.name.text)
  let found: { at: ts.Node; what: string } | undefined
  const walk = (node: ts.Node): void => {
    if (found) return
    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      found = { at: node, what: 'this' }
      return
    }
    if (ts.isPropertyAccessExpression(node)) {
      walk(node.expression)
      return
    }
    if (ts.isPropertyAssignment(node)) {
      walk(node.initializer)
      return
    }
    if (ts.isIdentifier(node) && names.has(node.text)) {
      found = { at: node, what: node.text }
      return
    }
    ts.forEachChild(node, walk)
  }
  walk(p.initializer!)
  if (!found) return false
  const own = found.what === 'this'
  pushDiag(
    diagnostics,
    sourceFile,
    found.at,
    `A default cannot read ${own ? '"this"' : `the parameter "${found.what}"`}: the default is ` +
      `filled in where the function is called, and ${own ? '"this"' : `"${found.what}"`} is an ` +
      `expression there, which would then run a second time. Give "${ts.isIdentifier(p.name) ? p.name.text : 'the parameter'}" a ` +
      `default that stands on its own and compute from ${own ? '"this"' : `"${found.what}"`} in the body.`,
    TS_CODES.FUNCTION_SHAPE,
  )
  return true
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
      // The annotation said why it names no type, on its own span. "Unsupported return type
      // for f" repeated that on the same span and named nothing the first one had not (T10).
      if (!mapped) return undefined
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

/** Whether a statement inside a namespace is a `const`, which `module-const.ts` collects as
 *  the flattened constant `Ns_NAME` and this walk therefore leaves alone. */
function isNamespaceConst(stmt: ts.Statement): boolean {
  return ts.isVariableStatement(stmt) && (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0
}

/** Every namespace name the file declares, flattened: `namespace A { export namespace B {} }`
 *  yields `A` and `A_B`, which is what `A.f()` and `A.B.f()` resolve against. */
function namespaceNamesOf(sourceFile: ts.SourceFile): string[] {
  const out: string[] = []
  const walk = (statements: readonly ts.Statement[], prefix: string): void => {
    for (const stmt of statements) {
      if (!ts.isModuleDeclaration(stmt) || !ts.isIdentifier(stmt.name)) continue
      if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) continue
      const name = prefix === '' ? stmt.name.text : namespaceMemberName(prefix, stmt.name.text)
      out.push(name)
      const body = stmt.body
      if (body === undefined) continue
      if (ts.isModuleBlock(body)) walk(body.statements, name)
      else if (ts.isModuleDeclaration(body)) walk([body], name)
    }
  }
  walk(sourceFile.statements, '')
  return out
}

export function parseSignature(
  node: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structs: readonly CollectedStruct[] = [],
  /** The name the function takes in the IR when it is not the one it was written under: a
   *  function inside `namespace Palette` is `Palette_warm` (roadmap 0.3 item T4, #92). */
  irName?: string,
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
  const name = irName ?? node.name.text
  // Computed up front (rather than after the return type, as before) so the builtin/stage
  // checks below, for both a direct parameter builtin and a struct-typed parameter's fields,
  // know the entry stage they are validating against.
  const stageInfo = parseStage(node, sourceFile, diagnostics)
  const params = parseParams(node.parameters, sourceFile, diagnostics, structs, stageInfo.stage, {
    fnName: name,
  })
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
  // A stage output of an emulated double is a varying or a render-target write (#151 F64-09).
  if (
    stageInfo.stage !== undefined &&
    refuseF64EntryIo(
      ret,
      `The return of entry "${name}"`,
      'varying',
      node.type ?? node,
      sourceFile,
      diagnostics,
    )
  ) {
    return undefined
  }
  const decl: FuncDecl = { name, params, ret, body: [] }
  recordParamDefaults(decl, node.parameters)
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
  // A fragment entry's output takes `@location(0)` whatever its width: `f32`, `vec2` and
  // `vec3` are as valid a draw-buffer format as `vec4`, and only the `vec4` case used to get
  // the attribute, so the other three emitted WGSL Tint refuses ("missing entry point IO
  // attribute on return type") with nothing said here.
  if (
    stageInfo.stage === 'fragment' &&
    (ret.kind === 'scalar' || ret.kind === 'vec') &&
    ret.kind !== undefined
  ) {
    ;(decl as { retAttr?: string }).retAttr = '@location(0)'
  }
  // A vertex entry has to produce a position, and nothing here can invent one: WGSL says "a
  // vertex shader must include the 'position' builtin in its return type", and before this the
  // three ways to leave it out compiled clean and were refused by Tint instead.
  if (stageInfo.stage === 'vertex') {
    refuseVertexWithoutPosition(ret, node, name, sourceFile, diagnostics, structs)
  }
  return decl
}

/** True, having reported it, when an emulated double sits on an entry's IO boundary.
 *
 *  A `@location` varying is INTERPOLATED, and interpolating a (hi, lo) pair word by word is
 *  not the interpolation of the double it encodes: the low word is the part f32 could not
 *  hold, and a hardware blend of it carries no meaning. The fp64 pass refuses it as SD0044,
 *  and a `vec64` vertex ATTRIBUTE as SD0041 (it would need two slots), both at emit, with no
 *  source span. Said here instead, at the parameter, the field or the return type that has
 *  it, naming the bridge an author can write (#151 F64-09).
 *
 *  A SCALAR `f64` vertex attribute is not refused: a vertex `@location` input is a buffer
 *  read, not a varying, and one `vec2<f32>` slot carries the pair exactly — which is what the
 *  pass accepts. */
type F64IoPlace =
  /** A `@location` that is INTERPOLATED between the stages: a fragment input, any entry
   *  output. The pair's two words would be blended one at a time. */
  | 'varying'
  /** A bare vertex `@location` parameter, which is a buffer read. A scalar double's pair
   *  rides the one slot it already has; anything wider needs more than one. */
  | 'attribute'
  /** A `@location` field of an IO struct, which the fp64 pass refuses whichever direction it
   *  faces — its struct rule keys on `f.location !== undefined` alone. */
  | 'io-struct-field'

function refuseF64EntryIo(
  type: ShaderType,
  what: string,
  place: F64IoPlace,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  if (!containsF64Type(type)) return false
  // The one f64 an entry CAN carry, and the only place it can: see 'attribute' above.
  if (place === 'attribute' && type.kind === 'f64') return false
  // The remedy is an ORDINARY one, deliberately: there is no author-facing helper for
  // splitting a double into its words and no plan for one, because the words are the
  // emulation's business and not the language's (§39). A uniform or storage binding carries
  // an f64 and is visible from every stage, so a double that two stages need is read where
  // it is needed rather than handed across.
  const bridge =
    `Narrow it with f32(x), or compute the double in the stage that needs it — a uniform or ` +
    `storage binding carries an f64 and every stage can read one.`
  const reason =
    place === 'varying'
      ? `an emulated double is a pair of f32 words, and a @location varying interpolates ` +
        `each word on its own, which is not the interpolation of the double`
      : place === 'attribute'
        ? `a vertex attribute is one slot per @location, and only a scalar f64 fits one — ` +
          `this shape needs more`
        : `the fp64 pass carries no emulated double in an entry IO struct, whichever ` +
          `direction it faces` +
          (type.kind === 'f64'
            ? ` — a scalar one rides a bare @location parameter, if that is what you meant`
            : '')
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `${what} carries ${typeKey(type)}: ${reason}. ${bridge}`,
    TS_CODES.F64_ENTRY_IO,
  )
  return true
}

/** Whether `t` carries an emulated double anywhere — the scalar, a vector of them, a matrix of
 *  them, or an array or struct field of any of those. The fp64 pass's own `containsF64`, in
 *  the front end's terms; a struct is taken by NAME there and its fields are checked where the
 *  struct is validated, so the recursion here stops at one. */
function containsF64Type(t: ShaderType): boolean {
  if (t.kind === 'f64' || t.kind === 'vec64') return true
  if (t.kind === 'mat') return t.elem === 'f64'
  if (t.kind === 'array') return containsF64Type(t.elem)
  return false
}

/** True, having reported it, when a `@vertex` entry's return carries no `@builtin(position)`:
 *  a struct without such a field, or any bare type that is not the `vec4` the position is. */
function refuseVertexWithoutPosition(
  ret: ShaderType,
  node: ts.Node,
  name: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structs: readonly CollectedStruct[],
): void {
  if (typeKey(ret).startsWith('vec4')) return
  if (ret.kind === 'struct') {
    const decl = structs.find((s) => s.decl.name === ret.name)
    // An unknown struct was reported where it was named; do not pile on.
    if (decl === undefined) return
    if (decl.decl.fields.some((f) => f.builtin === 'position')) return
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${name}" is a @vertex entry, so what it returns has to carry the position: give ` +
        `"${ret.name}" a field with @builtin("position"), typed vec4.`,
      TS_CODES.FUNCTION_SHAPE,
    )
    return
  }
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `"${name}" is a @vertex entry, so it returns the position: a vec4, which takes ` +
      `@builtin("position") on its own, or a struct with a vec4 field that carries it. ` +
      `${typeKey(ret) === 'void' ? 'It returns nothing' : `It returns ${typeKey(ret)}`}.`,
    TS_CODES.FUNCTION_SHAPE,
  )
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
  sourceFile?: ts.SourceFile,
  /** The namespace whose body this function belongs to, flattened (T4, #92). */
  nsPrefix?: string,
): LoweringScope {
  const scope = new LoweringScope(callees, symbols)
  scope.setNamespacePrefix(nsPrefix)
  scope.setStructs(structs.map((s) => s.decl))
  scope.setPrivateFields(privateFieldTableOf(structs))
  scope.setWithheldFields(withheldTableOf(structs))
  scope.setReadonlyFields(readonlyFieldTableOf(structs))
  scope.setRestrictedFields(restrictedFieldTableOf(structs))
  scope.setBases(new Map(structs.filter((s) => s.bases).map((s) => [s.decl.name, s.bases!])))
  scope.setAbstractStructs(new Set(structs.filter((s) => s.abstract).map((s) => s.decl.name)))
  scope.setStaticHolders(
    new Map(
      structs
        .filter((s) => s.staticHolder !== undefined)
        .map((s) => [s.decl.name, s.staticHolder!] as const),
    ),
  )
  // The enum names, so a mistyped member reads as one rather than as an unknown identifier
  // (T1, #92); the members themselves are module constants and resolve through the scope.
  if (sourceFile) {
    scope.setEnums(sourceFile.statements.filter(ts.isEnumDeclaration).map((e) => e.name.text))
    scope.setNamespaces(namespaceNamesOf(sourceFile))
  }
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

/** `(x: f32): f32 => x * 2.`: the single return an expression-bodied arrow stands for. */
function lowerArrowValue(
  expr: ts.Expression,
  stub: FuncDecl,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] {
  const lowered = lowerExpression(expr, sourceFile, scope, diagnostics, stub.ret)
  if (!lowered) return []
  return [
    withSpan({ s: 'return', expr: retargetIntLitCtx(lowered, expr, stub.ret) }, sourceFile, expr),
  ]
}

/** Lower every default `stub`'s signature writes, in the module's scope (roadmap 0.3 item T7,
 *  #92). The result is spliced at each call that omits the argument, so it is lowered here,
 *  once, rather than at every call site: the two would be the same expression, and one
 *  diagnostic about a default belongs where the default is written.
 *
 *  A default that does not lower, or whose type is not its parameter's, keeps none; the call
 *  site then reports the arity it always did, after the reason has been said here. */
export function lowerParamDefaults(
  stub: FuncDecl,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  callees: Map<string, FuncDecl>,
  consts: readonly ScopedConst[],
  bindings: readonly BindingDecl[],
  structs: readonly CollectedStruct[],
  symbols: DeclaredSymbolSink | undefined,
  overrides: readonly OverrideDecl[],
  vars: readonly ModuleVarDecl[],
  nsPrefix?: string,
  /** The last pass: report a default that still has no value, rather than leave it for the
   *  next one. */
  final = false,
): boolean {
  const nodes = paramDefaultNodes(stub)
  if (nodes.length === 0) return false
  let progressed = false
  const scope = functionScope(
    stub,
    callees,
    consts,
    bindings,
    structs,
    symbols,
    overrides,
    vars,
    sourceFile,
    nsPrefix,
  )
  for (const [i, node] of nodes) {
    const want = stub.params[i]!.type
    const before = diagnostics.length
    const lowered = lowerExpression(node, sourceFile, scope, diagnostics, want)
    if (!lowered) {
      // A call that omits an argument whose default has no value yet lowers to nothing and
      // says nothing, because on an earlier pass that is not an error. On the last pass it is
      // the one shape this cannot fill: a default that waits on itself.
      if (final && diagnostics.length === before) {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `The default for "${stub.params[i]!.name}" calls a function whose own default waits ` +
            `on this one, so neither has a value. Write the value out here.`,
          TS_CODES.FUNCTION_SHAPE,
        )
      }
      continue
    }
    const fixed = retargetIntLitCtx(lowered, node, want)
    if (typeKey(fixed.type) !== typeKey(want)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `The default for "${stub.params[i]!.name}" is ${typeKey(fixed.type)}, and the ` +
          `parameter is ${typeKey(want)}.`,
        TS_CODES.TYPE_MISMATCH,
      )
      continue
    }
    setParamDefault(stub, i, fixed)
    progressed = true
  }
  return progressed
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
  nsPrefix?: string,
  /** The local functions this body declares, from the written name to the emitted one
   *  (roadmap 0.3 item T7, #92). */
  localFunctions?: ReadonlyMap<string, string>,
  /** For a static member, the class it is emitted for: what `this` names (Rule 8.13). */
  staticOwner?: string,
  /** For a static member, what `super` names in its body (Rule 8.13). */
  staticSuper?: ReadonlyMap<string, string>,
): void {
  const scope = functionScope(
    stub,
    callees,
    consts,
    bindings,
    structs,
    symbols,
    overrides,
    vars,
    sourceFile,
    nsPrefix,
  )
  // The body's calls are this function's, including any a filled-in default brings in
  // (roadmap 0.3 item T7, #92).
  scope.setOwner(stub)
  // What `super.m(...)` names in this body (roadmap 0.3 item T5, #92).
  scope.setSuperMethods(receiver?.superMethods ?? staticSuper)
  scope.setLocalFunctions(localFunctions)
  scope.setStaticClass(staticOwner)
  // `this` is defined first, so the IR name `self_` is free for it: the stub's own parameter
  // and the receiver read the same name. A user parameter called `self_` was refused at the
  // signature (TS8035), and a local called `self_` is renamed as any shadowing local is.
  const prologue: Stmt[] = []
  // A constructor a class inherits runs the initializers of the classes below the one that
  // declared it when its body returns (Rule 8.14).
  const afterBody: Stmt[] = []
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
      // `super(...)` is a statement of this body and nowhere else (roadmap 0.3 item T5, #92).
      if (receiver.mode === 'ctor') scope.setSuperCtor(receiver.superCtor)
      const parts = ctorParts(receiver, scope, sourceFile, diagnostics)
      prologue.push(...parts.prologue)
      scope.setAfterSuper(parts.afterSuper)
      afterBody.push(...parts.afterBody)
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
  // An arrow with an expression body is the one return it stands for (T7, #92); every other
  // shape carries a block.
  let body =
    ts.isArrowFunction(node) && !ts.isBlock(node.body)
      ? lowerArrowValue(node.body, stub, sourceFile, scope, diagnostics)
      : lowerStatements((node.body as ts.Block).statements, sourceFile, scope, diagnostics)
  if (receiver !== undefined && receiver.mode === 'ctor') {
    // A constructor returns the struct it built: a bare `return` inside it returns `self_`,
    // and one more closes the body. A method that CHANGES its object returns nothing — it
    // writes through its receiver — so its bare returns stay bare.
    const self = selfRef(receiver.type)
    const early = collectReturns(body)
    if (afterBody.length > 0 && early.length > 0) {
      pushDiag(
        diagnostics,
        sourceFile,
        node.name ?? node,
        `"${shown ?? stub.name}" runs a constructor it inherits, and the initializers of the ` +
          `classes below the one that declared it run when that body returns; a "return" ` +
          `inside it would skip them. Declare a constructor on the class, or end the body ` +
          `without "return".`,
        TS_CODES.CLASS_MEMBER,
      )
    }
    for (const r of early) if (!r.expr) (r as { expr?: Expr }).expr = self
    // A body whose `super(...)` did not lower still runs what follows it, first.
    const pending = scope.afterSuperPending() ? scope.takeAfterSuper() : []
    body = [...prologue, ...pending, ...body, ...afterBody, { s: 'return', expr: self }]
  } else if (receiver !== undefined && receiver.mode === 'inout') {
    body = [...prologue, ...body]
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
      workgroupSize = 64
      // Read the decorator's AST, not its text (#118). `@compute` and `@compute()` take the
      // default; `@compute([x, y, z])` is a call whose one argument is an array literal of one
      // to three whole numbers, written across lines or through `as const` if the author likes.
      // Anything else used to fall through to 64 with no diagnostic — `@compute({ workgroup:
      // [8, 8, 1] })`, `@compute(128)`, `@compute(SIZE)` — so the author asked for one size and
      // dispatched against another. It is reported now, at the argument.
      const call = ts.isCallExpression(d.expression) ? d.expression : undefined
      if (call !== undefined && call.arguments.length > 0) {
        const written = call.arguments.map((a) => a.getText(sourceFile)).join(', ')
        let arg: ts.Expression = call.arguments[0]!
        while (
          ts.isParenthesizedExpression(arg) ||
          ts.isAsExpression(arg) ||
          ts.isSatisfiesExpression(arg)
        )
          arg = arg.expression
        const shape =
          call.arguments.length === 1 && ts.isArrayLiteralExpression(arg) ? arg : undefined
        const sizes = shape?.elements.map((e) => (ts.isNumericLiteral(e) ? Number(e.text) : NaN))
        if (
          sizes === undefined ||
          sizes.length === 0 ||
          sizes.length > 3 ||
          sizes.some((n) => !Number.isInteger(n) || n < 1)
        ) {
          pushDiag(
            diagnostics,
            sourceFile,
            call.arguments[0]!,
            `@compute takes an array of one to three whole numbers, "@compute([64, 1, 1])", or ` +
              `no argument for the default of 64; "${written}" is not a workgroup shape.`,
            TS_CODES.WORKGROUP_ARG,
          )
        } else {
          workgroupSize = sizes[0]!
          const [, y, z] = sizes
          if ((y !== undefined && y !== 1) || (z !== undefined && z !== 1)) {
            pushDiag(
              diagnostics,
              sourceFile,
              d,
              `@compute workgroup shape [${sizes.join(', ')}] must have y and z equal to 1: the ` +
                `backend only carries the x workgroup size today, and would silently drop the rest.`,
              TS_CODES.WORKGROUP_SHAPE,
            )
          }
        }
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
  // The slot-collision and varying-type rules read the struct alone and live in `structs.ts`,
  // which sees each declaration once: raised here they printed one mistake twice, because a
  // vertex output and a fragment input are the SAME struct. What is left below reads the
  // stage, which is genuinely different between the two uses.
  for (const field of collected.decl.fields) {
    // A `@location` on a COMPUTE entry, reached through a struct parameter. The bare-parameter
    // spelling was refused where it is parsed, and this one walked past it: Tint answers
    // `'@location' cannot be used by compute shaders`. Stage-dependent, so it belongs here
    // rather than in the struct collector, which sees no stage.
    if (stage === 'compute' && field.location !== undefined) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Struct "${structName}" field "${field.name}" is at a @location and "${structName}" is ` +
          `a compute entry ${direction}, which has no user IO: a compute shader reads its work ` +
          `from resources and the @builtin invocation ids.`,
        TS_CODES.STRUCT_FIELD_MISSING_ATTR,
      )
      continue
    }
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
    if (
      field.location !== undefined &&
      refuseF64EntryIo(
        field.type,
        `Struct "${structName}" field "${field.name}", a ${stage} ${direction},`,
        'io-struct-field',
        node,
        sourceFile,
        diagnostics,
      )
    ) {
      continue
    }
    if (!field.builtin) continue
    checkBuiltinStage(diagnostics, sourceFile, node, field.builtin, stage, direction)
    checkBuiltinType(diagnostics, sourceFile, node, field.builtin, field.type)
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

/** The type arguments one call settles: the ones it writes, or the ones its arguments show.
 *  Reports and returns undefined for a type parameter neither reaches (roadmap 0.3 item T9,
 *  #92). */
function typeArgumentsFor(
  decl: ts.FunctionDeclaration,
  order: readonly string[],
  node: ts.CallExpression,
  argTypes: readonly ShaderType[],
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Map<string, ShaderType> | undefined {
  const shown = decl.name?.text ?? 'this function'
  const out = new Map<string, ShaderType>()
  const written = node.typeArguments ?? []
  if (written.length > 0) {
    if (written.length !== order.length) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"${shown}" takes ${String(order.length)} type argument(s), got ${String(written.length)}.`,
        TS_CODES.ARITY_MISMATCH,
      )
      return undefined
    }
    for (const [i, typeNode] of written.entries()) {
      // Mapped in the CALLER's scope, whose own type arguments are still bound: a generic
      // calling `pick<T>(…)` passes its own T through.
      const mapped = mapTsTypeToShaderType(typeNode, sourceFile, diagnostics)
      if (!mapped) return undefined
      out.set(order[i]!, mapped)
    }
    return out
  }
  const names = new Set(order)
  for (const [i, p] of decl.parameters.entries()) {
    const actual = argTypes[i]
    if (p.type === undefined || actual === undefined) continue
    inferFrom(p.type, actual, names, out)
  }
  const missing = order.filter((n) => !out.has(n))
  if (missing.length > 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `This call does not say what ${missing.map((n) => `"${n}"`).join(' and ')} ` +
        `${missing.length === 1 ? 'is' : 'are'} in "${shown}". A type argument is read off an ` +
        `argument whose parameter is written as it, or as array<it, N>; write it instead, as ` +
        `"${shown}<${order.map((n) => (out.get(n) === undefined ? 'f32' : typeSuffix(out.get(n)!))).join(', ')}>(…)".`,
      TS_CODES.UNKNOWN_TYPE,
    )
    return undefined
  }
  return out
}
