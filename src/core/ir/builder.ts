// ═══ Shader DSL — function/statement builder ═══
//
// The imperative authoring surface: Builder (collects Stmt nodes via
// let/var/assign/if/for/switch/ret/…), the IfChain helper, and the fn /
// computeFn / entryFn / module assemblers. Imports types + nodes + node.

import { type ShaderType, type KeyOf, type ScalarKey, voidT } from './types.js'
import {
  type Stmt,
  type Expr,
  type BinOp,
  type FuncDecl,
  type ModuleDecl,
  type ConstDecl,
  type OverrideDecl,
  type ExternVarDecl,
  type StructDecl,
  type BindingDecl,
  type RawStmt,
  type RawPayload,
  ASSEMBLED_AS,
} from './nodes.js'
import {
  Node,
  ReadonlyNode,
  isNodeValue,
  type ArithArg,
  type NodeLike,
  lift,
  f32,
  i32,
  u32,
  overrideRef,
  externRef,
  installStmtSink,
} from './node.js'
import { callFn } from './call-fn.js'
import { eachExpr, eachStmtExpr } from './visit.js'
import { dslError } from '../diagnostics/error.js'
import { captureLoc, recordLoc } from '../diagnostics/loc.js'

/** The parameter record {@link externFn} takes: a plain map from parameter name to
 *  {@link ShaderType}, in declaration order. An extern function is only ever called, never
 *  used as a pipeline entry point, so its record carries no stage attribute and no struct
 *  handle. {@link FnParamSpec} is the richer record `fn()` accepts.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { externFn, f32T, vec2fT, type ParamSpec } from '@xgis/shader-dsl'
 *
 *  const WARP_PARAMS = { x: f32T, y: f32T, scale: f32T } satisfies ParamSpec
 *  export const warp = externFn('warp', WARP_PARAMS, vec2fT)
 *  ```
 */
export type ParamSpec = Record<string, ShaderType>
/** An entry-point param carrying a stage attribute — `builtin('vertex_index', u32T)` /
 *  `location(0, vec4fT)` (the SAME FieldSpec the ioStruct fields use). A plain ShaderType value is
 *  an ordinary param. Lets one `fn()` author both helpers and `@vertex`/`@fragment`/`@compute`
 *  entries from a single param record. */
type ParamAttr = {
  readonly type: ShaderType
  readonly attr: string
  // Structured IO fields (#740 R3 / #763 S5) — sot's builtin()/location() set these;
  // fn() threads them into FuncDecl.params so reflect() sees vertex attributes
  // WITHOUT re-parsing the attr string.
  readonly location?: number
  readonly builtin?: string
  readonly interpolate?: string
}
/** A structDecl / ioStruct HANDLE used directly as a param spec value (#740 R6):
 *  `fn({ in: PointOut }, ({ in }) => in.uv…)` — the body receives the TYPED field
 *  proxy, retiring the `PointOut.of(p.in)` re-assertion at every consumer. */
type StructParamHandle = { readonly type: ShaderType; of(node: ReadonlyNode): object }
/** The parameter record `fn()` accepts. Each key is a parameter name and each value is one
 *  of three things: a plain {@link ShaderType} for an ordinary parameter; a {@link builtin}
 *  or {@link location} spec for an entry-point parameter that carries a stage attribute; or
 *  a {@link structDecl} / {@link ioStruct} handle, in which case the body receives that
 *  struct's typed field proxy. One record shape covers plain helpers and `@vertex`,
 *  `@fragment` and `@compute` entries alike. See {@link FnHandle} for the call surface a
 *  record produces.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, builtin, toF32, vec4, u32T, vec4fT, type FnParamSpec } from '@xgis/shader-dsl'
 *
 *  const vs = fn(
 *    'vs_main',
 *    { idx: builtin('vertex_index', u32T) } satisfies FnParamSpec,
 *    ({ idx }) => vec4(toF32(idx), 0, 0, 1),
 *    { stage: 'vertex', retAttr: builtin('position', vec4fT) },
 *  )
 *  ```
 */
export type FnParamSpec = Record<string, ShaderType | ParamAttr | StructParamHandle>
type ParamTypeOf<E> = E extends ParamAttr
  ? E['type']
  : E extends StructParamHandle
    ? E['type']
    : E extends ShaderType
      ? E
      : never
/** Body-side param values. Params are READ-ONLY in WGSL — the node type is
 *  `ReadonlyNode`, so `p.a.assign(…)` is a tsc error (#763 G3; the runtime
 *  never guarded this: auto-vars skips param roots and the emitted assign
 *  died in the driver). Struct-handle params receive the handle's READ view. */
type ParamNodes<P extends FnParamSpec> = {
  [K in keyof P]: P[K] extends StructParamHandle
    ? ReturnType<P[K]['of']>
    : ReadonlyNode<KeyOf<ParamTypeOf<P[K]>>>
}

/** The statement collector every `fn()` body writes into. `let`, `var`, `assign`, `if`,
 *  `forRange`, `switch`, `ret`, `break`, `continue`, `discard` and `raw` each push one
 *  statement onto `.stmts` in authored order. `fn()` hands its body the Builder as the second
 *  argument, and the ambient free functions ({@link Let}, {@link Var}, {@link If},
 *  {@link Loop}, {@link Return} and the rest) resolve the innermost active Builder and
 *  forward to it, so `b.let(...)` and `Let(...)` emit the same statement. Use the Builder
 *  directly when a statement is authored outside an active `fn()`, `If` or `Loop` scope, for
 *  example when assembling a `Stmt[]` fragment by hand to splice into a body later; there
 *  the ambient functions throw `SD0013` (no active scope).
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  // Outside an active fn() scope, assembling a Stmt[] to splice in later.
 *  const b = new Builder()
 *  const base = b.let('base', fillExpr)
 *  b.assign(out.color, vec4(base.swizzle('xyz'), base.w))
 *  return b.stmts
 *  ```
 */
export class Builder {
  readonly stmts: Stmt[] = []

  // The auto-name counter is SHARED across a function's nested sub-builders (see
  // child()), so an omitted binding name gets a function-unique `_v{n}`. A per-block
  // counter would restart at _v0 inside each If/Loop body, letting an inner _v0 shadow
  // an outer one — and the outer binding's varref (captured at author time) would then
  // mis-resolve to the inner shadow. Function-scoped uniqueness rules that out. The
  // counter is per-function (reset on each root Builder), so the emit stays deterministic
  // across rebuilds — required by the byte-identical WGSL snapshot gates.
  constructor(private readonly autoNames: { n: number } = { n: 0 }) {}

  /** A builder for a nested scope (an `if`, loop or `switch` body) that shares this
   *  builder's auto-name counter, so generated `_v{n}` names stay unique across the whole
   *  function. */
  child(): Builder {
    return new Builder(this.autoNames)
  }

  private autoName(): string {
    return `_v${this.autoNames.n++}`
  }

  private push(s: Stmt): void {
    recordLoc(s, captureLoc())
    this.stmts.push(s)
  }

  /** Immutable binding, `let name = expr;`. The name is optional: omit it and the binding
   *  takes a function-unique generated name (`_v0`, `_v1`, and so on), which suits a value
   *  whose JavaScript `const` already carries the meaning, at the cost of an opaque name in
   *  the emitted source. Returns a read-only node of the bound value's type. */
  let<K extends string>(value: ReadonlyNode<K>): ReadonlyNode<K>
  let<K extends string>(name: string, value: ReadonlyNode<K>): ReadonlyNode<K>
  let<K extends string>(
    nameOrValue: string | ReadonlyNode<K>,
    maybeValue?: ReadonlyNode<K>,
  ): ReadonlyNode<K> {
    const named = typeof nameOrValue === 'string'
    const name = named ? nameOrValue : this.autoName()
    const value = (named ? maybeValue : nameOrValue) as ReadonlyNode<K>
    this.push({ s: 'let', name, expr: value.expr })
    return new Node<K>({ op: 'varref', type: value.type, name })
  }

  /** Mutable binding, `var name: T = init;`. The name is optional, as for `let`. Returns a
   *  mutable node whose `.assign` writes the variable. */
  var<T extends ShaderType>(type: T, init?: ReadonlyNode<KeyOf<T>>): Node<KeyOf<T>>
  var<T extends ShaderType>(name: string, type: T, init?: ReadonlyNode<KeyOf<T>>): Node<KeyOf<T>>
  var<T extends ShaderType>(
    nameOrType: string | T,
    typeOrInit?: T | ReadonlyNode<KeyOf<T>>,
    maybeInit?: ReadonlyNode<KeyOf<T>>,
  ): Node<KeyOf<T>> {
    const named = typeof nameOrType === 'string'
    const name = named ? nameOrType : this.autoName()
    const type = (named ? typeOrInit : nameOrType) as T
    const init = (named ? maybeInit : typeOrInit) as ReadonlyNode<KeyOf<T>> | undefined
    this.push({ s: 'var', name, type, init: init?.expr })
    return new Node<KeyOf<T>>({ op: 'varref', type, name })
  }

  /** A `var` whose type is filled in after its branch assignments are authored, for a value
   *  chosen by a branch ({@link when} uses it). The declaration is pushed now, ahead of the
   *  branches; `ref(type)` makes a node reading the variable once the type is known,
   *  `commit(type)` patches the declaration with it, and `cancel()` removes the declaration
   *  when no branch assigned a value. The build completes synchronously, so the emitter
   *  always sees a fully typed declaration. */
  inferredVar(): {
    ref: (type: ShaderType) => Node
    commit: (type: ShaderType) => void
    cancel: () => void
  } {
    const name = this.autoName()
    const stmt = {
      s: 'var' as const,
      name,
      type: undefined as unknown as ShaderType,
      init: undefined,
    }
    this.push(stmt as Stmt)
    return {
      ref: (type) => new Node({ op: 'varref', type, name }),
      commit: (type) => {
        stmt.type = type
      },
      // Drop the pushed decl — for a Switch used as a STATEMENT (no case returned a value), the
      // reserved var is unused; removing it keeps the emit free of a stray typeless `var`.
      cancel: () => {
        const i = this.stmts.indexOf(stmt as Stmt)
        if (i >= 0) this.stmts.splice(i, 1)
      },
    }
  }

  assign<K extends string>(target: ReadonlyNode<K>, value: ReadonlyNode<K>): void {
    this.push({ s: 'assign', target: target.expr, expr: value.expr })
  }
  assignOp<K extends string>(target: ReadonlyNode<K>, bop: BinOp, value: ArithArg<K>): void {
    this.push({ s: 'assignOp', target: target.expr, bop, expr: lift(value).expr })
  }
  addAssign<K extends string>(target: Node<K>, value: ArithArg<K>): void {
    this.assignOp(target, '+', value)
  }

  ret(value?: ReadonlyNode): void {
    this.push({ s: 'return', expr: value?.expr })
  }
  break(): void {
    this.push({ s: 'break' })
  }
  continue(): void {
    this.push({ s: 'continue' })
  }
  discard(): void {
    this.push({ s: 'discard' })
  }
  /** Push a placeholder statement carrying `tag`. A host that post-processes the module
   *  can walk the body and replace each tagged placeholder with statements of its own. A
   *  placeholder left in place emits as the comment `// __placeholder: <tag>`. */
  placeholder(tag: string): void {
    this.push({ s: 'placeholder', tag })
  }

  /** Push a raw statement, one verbatim spelling per target; the builder form of the free
   *  {@link rawStmt} factory. Use `b.raw()` inside a `fn()` body: a bare `rawStmt(...)` call
   *  there is a discarded expression, since the returned statement is never pushed and
   *  nothing is emitted. Use `rawStmt()` when assembling a `Stmt[]` body array by hand. The
   *  statement records its source location like every other statement. */
  raw(payload: RawPayload): void {
    this.push(rawStmt(payload))
  }

  /** if / else-if / else chain. Returns a chainer so `.elif().else()` reads
   *  top-to-bottom. The If stmt is pushed on the first call and mutated in
   *  place by subsequent .elif/.else. */
  if(cond: ReadonlyNode<'bool'>, body: (b: Builder) => ReadonlyNode | void): IfChain {
    const arms: Array<{ cond: Expr; body: Stmt[] }> = [
      { cond: cond.expr, body: subBody(this, body, 'If body') },
    ]
    const stmt = { s: 'if' as const, arms, elseBody: undefined as Stmt[] | undefined }
    // Push a mutable-shaped object; the readonly Stmt typing is a compile-time
    // view only — the builder owns construction.
    this.push(stmt)
    return new IfChain(this, arms, (e) => {
      stmt.elseBody = e
    })
  }

  /** C-style `for` loop: `for (var name = init; cond; name = name + step)`. A numeric or
   *  omitted step takes the loop variable's scalar type, so a `u32` or `i32` counter emits
   *  `i + 1u` or `i + 1`; a float step on an integer counter would be rejected by both GPU
   *  compilers. */
  forRange<K extends string>(
    init: ReadonlyNode<K>,
    cond: (i: Node<K>) => ReadonlyNode<'bool'>,
    body: (b: Builder, i: Node<K>) => ReadonlyNode | void,
    step?: ReadonlyNode<ScalarKey> | number,
  ): void
  forRange<K extends string>(
    name: string,
    init: ReadonlyNode<K>,
    cond: (i: Node<K>) => ReadonlyNode<'bool'>,
    body: (b: Builder, i: Node<K>) => ReadonlyNode | void,
    step?: ReadonlyNode<ScalarKey> | number,
  ): void
  forRange<K extends string>(
    a: string | ReadonlyNode<K>,
    b: ReadonlyNode<K> | ((i: Node<K>) => ReadonlyNode<'bool'>),
    c: ((i: Node<K>) => ReadonlyNode<'bool'>) | ((b: Builder, i: Node<K>) => ReadonlyNode | void),
    d?: ((b: Builder, i: Node<K>) => ReadonlyNode | void) | ReadonlyNode<ScalarKey> | number,
    e?: ReadonlyNode<ScalarKey> | number,
  ): void {
    const named = typeof a === 'string'
    const name = named ? a : this.autoName()
    const init = (named ? b : a) as ReadonlyNode<K>
    const cond = (named ? c : b) as (i: Node<K>) => ReadonlyNode<'bool'>
    const body = (named ? d : c) as (b: Builder, i: Node<K>) => ReadonlyNode | void
    const step = (named ? e : d) as ReadonlyNode<ScalarKey> | number | undefined
    const i = new Node<K>({ op: 'varref', type: init.type, name })
    const litOf = (v: number): Node => {
      if (init.type.kind === 'scalar' && init.type.scalar === 'u32') return u32(v)
      if (init.type.kind === 'scalar' && init.type.scalar === 'i32') return i32(v)
      return f32(v)
    }
    const stepNode = step === undefined ? litOf(1) : typeof step === 'number' ? litOf(step) : step
    const initStmt: Stmt = { s: 'var', name, type: init.type, init: init.expr }
    const updateStmt: Stmt = {
      s: 'assign',
      target: i.expr,
      // stepNode's exact scalar-vs-K match is enforced at AUTHOR-RUN time (SD0004
      // from binResultType), not by tsc — K is abstract at this generic call site.
      expr: i.add(stepNode as unknown as ArithArg<K>).expr,
    }
    this.push({
      s: 'for',
      init: initStmt,
      cond: cond(i).expr,
      update: updateStmt,
      body: subBody(this, (b) => body(b, i), 'Loop body'),
    })
  }

  switch(
    // Integer keys only: WGSL and GLSL ES 3.00 both type `switch` over i32/u32 — an
    // f32 scrutinee used to type-check (ScalarKey) and die at BOTH GPU compilers.
    scrut: ReadonlyNode<'i32' | 'u32'>,
    cases: Array<[number, (b: Builder) => ReadonlyNode | void]>,
    defaultBody?: (b: Builder) => ReadonlyNode | void,
  ): void {
    this.push({
      s: 'switch',
      scrut: scrut.expr,
      cases: cases.map(([value, fn]) => ({ value, body: subBody(this, fn, 'Switch case body') })),
      defaultBody: defaultBody ? subBody(this, defaultBody, 'Switch default body') : undefined,
    })
  }
}

/** The chain object {@link Builder.if} and {@link If} return, so `.elif(...)` and
 *  `.else(...)` read top to bottom in authored order. It is reached only through the call
 *  that starts a chain. Its methods extend the same `if` statement in place, pushed once on
 *  the first arm, so a chain without a trailing `.else` still emits a valid `if` / `else if`
 *  with no `else` block.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  If(p.idx.eq(1), () => {
 *    pos.assign(vec2(3, -1))
 *  }).elif(p.idx.eq(2), () => {
 *    pos.assign(vec2(-1, 3))
 *  })
 *  ```
 */
export class IfChain {
  constructor(
    private readonly parent: Builder,
    private readonly arms: Array<{ cond: Expr; body: Stmt[] }>,
    private readonly setElse: (body: Stmt[]) => void,
  ) {}
  /** Add an `else if (cond) { body }` arm. Returns the chain. */
  elif(cond: ReadonlyNode<'bool'>, body: (b: Builder) => ReadonlyNode | void): IfChain {
    this.arms.push({ cond: cond.expr, body: subBody(this.parent, body, 'elif body') })
    return this
  }
  /** Add the `else { body }` block and end the chain. */
  else(body: (b: Builder) => ReadonlyNode | void): void {
    this.setElse(subBody(this.parent, body, 'else body'))
  }
}

// ── Ambient current-builder stack (C2) ──
// The free functions below (Let / Var / If / Loop / assign / …) push onto the
// INNERMOST active scope, so authoring no longer threads a `Builder` param per
// nesting level (the cb→d→cb2→e proliferation that caused the documented
// line.ts:721-726 shadowing bug). push/pop is exception-safe (try/finally) — a
// throw mid-body must not leak the stack into the next shader. This is a pure
// authoring-surface change: it emits the same Stmt[] as the passed-builder API.
// globalThis-backed (#763 D2): a dual-loaded package copy used to get its OWN
// empty stack — `Let` imported from copy B inside a body authored by copy A's
// `fn` threw SD0013 at module load. Sharing the ambient state across copies
// makes the duplication harmless (same pattern as map's __XGIS_PROJECTIONS__).
const scopeStack: Builder[] = ((globalThis as Record<symbol, unknown>)[
  Symbol.for('xgis.shader-dsl.scopeStack')
] ??= []) as Builder[]

// Loud (once) when a second copy loads — the state above makes it SAFE, but a
// duplicated package still doubles load cost and usually means a bundler
// dedupe/config problem worth seeing.
{
  const g = globalThis as Record<symbol, unknown>
  const key = Symbol.for('xgis.shader-dsl.instanceLoaded')
  if (g[key])
    console.warn(
      '[shader-dsl] a second copy of @xgis/shader-dsl was loaded (dual-instance). Ambient state is globalThis-backed so this is safe, but check the bundler/dedupe config — see #763 D2.',
    )
  else g[key] = true
}

function currentBuilder(): Builder {
  const b = scopeStack[scopeStack.length - 1]
  if (b === undefined) {
    throw dslError('SD0013')
  }
  return b
}

function withScope<T>(b: Builder, run: () => T): T {
  scopeStack.push(b)
  try {
    return run()
  } finally {
    scopeStack.pop()
  }
}

// Wire the Node lvalue method (`x.assign(v)`) to the current scope — installed here so node.ts stays free
// of a builder import.
installStmtSink({
  assign: (target, value) => currentBuilder().assign(target, value),
})

// ═══ #843 — authoring-error context ═══
// When an author's callback throws (a JS ReferenceError, a sot field typo, …) the
// stack leads with builder internals and the failing fn / statement is invisible.
// Each callback boundary prefixes the SAME error object's message once — symbol-
// tagged so nested scopes don't stack a prefix per level — preserving the error's
// class (instanceof, coded SD#### diagnostics, substring-matching tests all hold).
const AUTHOR_KIND_TAGGED = Symbol('shader-dsl authoring kind tagged')
const AUTHOR_FN_TAGGED = Symbol('shader-dsl authoring fn tagged')

function tagAuthoringError(e: unknown, tag: symbol, prefix: string): void {
  if (e instanceof Error && !(tag in e)) {
    ;(e as unknown as Record<symbol, boolean>)[tag] = true
    e.message = `${prefix}: ${e.message}`
  }
}

function subBody(parent: Builder, fn: (b: Builder) => ReadonlyNode | void, kind?: string): Stmt[] {
  // child() shares the parent's auto-name counter, so an omitted binding name inside this
  // nested scope keeps incrementing the same `_v{n}` sequence (no inner-shadows-outer).
  const b = parent.child()
  // A control-flow body does NOT capture a native `return value`: `If(c, () => x)` would
  // then be an INVISIBLE early return that reads as fall-through. Early returns are
  // explicit — `ReturnIf(cond, value)` (a guard clause) or `Return()` inside the branch.
  withScope(b, () => {
    try {
      return fn(b)
    } catch (e) {
      // innermost statement kind wins (the tag blocks outer scopes' re-prefixing)
      if (kind !== undefined) tagAuthoringError(e, AUTHOR_KIND_TAGGED, `in ${kind}`)
      throw e
    }
  })
  return b.stmts
}

/** A function authored with fn() is a typed callable that also carries the FuncDecl shape
 *  (name/params/ret/body), so it drops straight into `module({ funcs: [foo] })` and `foo.decl`
 *  is the plain FuncDecl. This is the three.js TSL `Fn` shape (callable and function node in
 *  one value): a shader calls the handle itself, with no separate call-by-name step. Two call
 *  forms:
 *   - typed object-param `foo({ a, b })`: TypeScript checks argument names, types and
 *     completeness, and autocompletes the params (positional args cannot be typed: an object
 *     spec is not an ordered tuple in TS). The args are mapped to positional order at the call.
 *   - positional `foo(a, b)`: loose (NodeLike), deprecated in favour of the object form. */
// R is the RETURN KEY (e.g. 'f32', 'vec2<f32>') — inferred from the body's return Node, so a fn declares
// no return type. The args mapped-type's own K is the PARAM key (unrelated).
/** A forwardable struct field proxy (a handle param / `.of()` view) — accepted
 *  anywhere a struct-typed argument is, via its raw-node `$` accessor. */
// #2456 — keyed: a sot field proxy's `$` now carries `struct:${Name}`, so a body that
// returns the proxy (`return o`) infers the fn's return key instead of collapsing to
// `string`. Defaulted, so the loose ARGUMENT positions below stay unchanged.
type StructArg<R extends string = string> = { readonly $: ReadonlyNode<R> }

/** The type `fn()` returns: a typed, callable handle that is also a `FuncDecl`. The same
 *  value makes calls (`foo({ a, b })`), drops into `module({ funcs: [foo] })`, and exposes
 *  the plain declaration as `foo.decl`. Use `FnHandle<P, R>` as a type annotation when a
 *  handle built in one place crosses a module boundary as a value other code calls: the
 *  params and return key are pinned in the type, so the caller gets the same object-param
 *  checking `fn()`'s own return value gives.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  export type FilterFn = FnHandle<{ v: typeof f32T; level: typeof f32T }, 'bool'>
 *  ```
 */
export type FnHandle<P extends FnParamSpec, R extends string> = FuncDecl & {
  /** Typed object-param call. TypeScript checks the argument names, types and
   *  completeness. A raw number lifts to the declared parameter type, so a `u32`
   *  parameter gets a `u32` literal. A struct-handle parameter accepts a forwarded
   *  field proxy. Arguments are read-only nodes: a call only reads them, so `Let`
   *  results and expressions are accepted. */
  (args: {
    readonly [K in keyof P]:
      | ReadonlyNode<KeyOf<ParamTypeOf<P[K]>>>
      | number
      | (P[K] extends StructParamHandle ? StructArg : never)
  }): Node<R>
  /** @deprecated Use the object-param call `foo({ a, b })`. The positional form checks
   *  neither arity nor argument types nor order at the TypeScript level, so two arguments
   *  of the same type can be swapped without an error; the object form catches all of
   *  that. A struct field proxy is accepted and unwraps to its struct-value node. */
  (...args: (NodeLike | StructArg)[]): Node<R>
} & { readonly decl: FuncDecl }

/** The call-node factory shared by fn()'s handle and externFn(): maps the typed
 *  object-param form `f({ a, b })` to positional arguments (names → declared order), else
 *  passes positional args straight through. One implementation guarantees that an extern call
 *  and the real fn's call emit the identical call-by-name node. */
function makeCallFactory<R extends ShaderType>(
  name: string,
  ret: R,
  paramList: ReadonlyArray<{ name: string; type: ShaderType }>,
  // The callee's decl, when the factory belongs to a real fn() handle (externFn has
  // none). Stamped onto every call node as `declRef` so module() can auto-collect
  // transitive callees and key-naming can re-spell calls. Note the call spells
  // `declRef.name` at BUILD time (not the closed-over `name`): a key-named module
  // may rename the decl AFTER call sites were authored in other fns' bodies —
  // reading through the decl keeps handle-made calls rename-consistent, and the
  // assembly-time rewrite covers nodes built before a rename.
  declRef?: FuncDecl,
): (...args: NodeLike[]) => Node<KeyOf<R>> {
  const mk = (args: NodeLike[]): Node<KeyOf<R>> => {
    const n = callFn(declRef?.name ?? name, ret, ...args)
    if (declRef) (n.expr as { declRef?: FuncDecl }).declRef = declRef
    return n
  }
  // A struct FIELD PROXY (a handle param / a `.of()` view) forwards as its raw
  // struct-value Node via its `$` accessor (#740 R6) — so `helper(p.input)` just
  // works when p.input arrived as a typed handle param.
  // isNodeValue, NOT instanceof (#763 D1): a dual-loaded package splits the
  // prototype identity, and a cross-instance node falling through instanceof
  // was misrouted into the named-args parse (TypeError at load, or a silent
  // mis-swizzle when a param name collides with a component getter).
  const unwrap = (v: unknown): unknown =>
    v !== null && typeof v === 'object' && !isNodeValue(v) && '$' in (v as object)
      ? (v as { $: ReadonlyNode }).$
      : v
  return (...rawArgs: NodeLike[]): Node<KeyOf<R>> => {
    const args = rawArgs.map(unwrap) as NodeLike[]
    // Typed object-param call `f({ lon, lat })` — map the named args to positional order.
    // Distinguished from a single positional Node arg: a params object is a plain object, a
    // Node is a class instance, and a struct field proxy unwraps to one above.
    const a0 = args[0]
    if (
      args.length === 1 &&
      a0 != null &&
      !isNodeValue(a0) &&
      typeof a0 === 'object' &&
      !Array.isArray(a0)
    ) {
      // Principled cast: the preceding typeof / isNodeValue / Array.isArray guards prove
      // a0 is a plain named-args record here; TS can't recover that through the `unwrap`
      // map (args is pinned to NodeLike[]) without widening the public call signature.
      const obj = a0 as unknown as Record<string, NodeLike>
      // A raw number in the object form lifts to the DECLARED param type — the
      // caller named the parameter, so its type is known (unlike the positional
      // form, whose bare numbers can only default-lift). Struct proxies unwrap.
      return mk(
        paramList.map((p) => {
          const v = unwrap(obj[p.name]) as NodeLike
          return typeof v === 'number' ? new Node({ op: 'lit', type: p.type, value: v }) : v
        }),
      )
    }
    return mk(args)
  }
}

type FnOpts = {
  /** Record a deliberate deviation from the `single-exit` lint rule, for a body whose early
   *  {@link Return} skips work. */
  allowEarlyReturn?: boolean
  /** Rule ids whose diagnostics are dropped for this function; the general form of
   *  `allowEarlyReturn`. */
  lintDisable?: readonly string[]
  /** Stage: makes this a pipeline entry point (`@vertex`, `@fragment` or
   *  `@compute @workgroup_size(...)`). Omit it for an ordinary helper. */
  stage?: 'vertex' | 'fragment' | 'compute'
  /** Workgroup size for a `stage: 'compute'` entry (defaults to 64). */
  workgroupSize?: number
  /** Declare this compute entry a portable kernel; compute-only, `SD0110` otherwise.
   *
   *  A portable kernel emits on both backends: natively as `@compute` on WGSL, where
   *  `portable` changes no bytes since it is not a WGSL attribute, and on GLSL ES 3.00
   *  through a compute-to-fragment translation, which WebGL2 dispatches as a fullscreen
   *  draw into an R32UI target. In exchange the kernel stays inside the gather-only tier,
   *  `out[gid.x] = f(reads)`: a `global_invocation_id` read only as `.x`, exactly one
   *  `read_write` storage binding of `array<u32>` written exactly once at the invocation
   *  index, a first `uniform` binding of `vec4<u32>` (the dispatch uniform: `.x` is the
   *  invocation count, `.y` the output-grid width), and no `raw` statements anywhere the
   *  entry can reach. Anything outside that shape fails validation at every emit on both
   *  writers with `SD0111` and a per-violation remedy. Omit it to keep a compute kernel
   *  WebGPU-only. */
  portable?: boolean
  /** Return-value attribute for a bare (non-struct) stage output, giving
   *  `-> @location(0) vec4<f32>`. A typed `location(0, T)` spec is accepted and its `.attr`
   *  is used. A bare non-struct fragment return defaults to `@location(0)`. */
  retAttr?: string | { readonly attr: string; readonly builtin?: string }
}
// A body may return the raw node OR a struct field proxy (`return o` — #763 X14):
// the proxy forwards `.expr`/`.type` to its base var, so `bld.ret` reads it like
// a node. StructArg is the `{ $: ReadonlyNode }` shape every sot proxy carries.
type FnBody<P extends FnParamSpec, R extends string> = (
  p: ParamNodes<P>,
  b: Builder,
) => ReadonlyNode<R> | StructArg<R> | void
// #2458 — the body shape the RET-INFERRING overloads accept. A body that returns nothing at
// the TS level cannot tell tsc what it returns: `inferReturnType` walks the recorded
// statements and finds `f32` for a guard-style body, but TS sees `void` and falls back to
// `R = string`, which puts every call site outside the phantom-key checker. Such a body must
// name its return type (or `voidT`) through the explicit-`ret` overloads.
type FnBodyValue<P extends FnParamSpec, R extends string> = (
  p: ParamNodes<P>,
  b: Builder,
) => ReadonlyNode<R> | StructArg<R>

/** Infer a fn's WGSL return type from its body — the type of the value it returns. Used when the author
 *  omits the explicit return-type token. Walks into nested if/for/switch for a body that returns only via
 *  an early `Return(value)` (a guard). voidT when nothing is returned (statement / compute entry). */
function inferReturnType(result: ReadonlyNode | void, stmts: readonly Stmt[]): ShaderType {
  if (result !== undefined) return result.type
  const scan = (ss: readonly Stmt[]): ShaderType | undefined => {
    for (const s of ss) {
      if (s.s === 'return' && s.expr) return s.expr.type
      if (s.s === 'if') {
        for (const arm of s.arms) {
          const t = scan(arm.body)
          if (t) return t
        }
        if (s.elseBody) {
          const t = scan(s.elseBody)
          if (t) return t
        }
      } else if (s.s === 'for') {
        const t = scan(s.body)
        if (t) return t
      } else if (s.s === 'switch') {
        for (const c of s.cases) {
          const t = scan(c.body)
          if (t) return t
        }
        if (s.defaultBody) {
          const t = scan(s.defaultBody)
          if (t) return t
        }
      }
    }
    return undefined
  }
  return scan(stmts) ?? voidT
}

// Auto-name counter for fn() calls that omit the name. Advanced ONLY on omission (explicit
// names never consume it). It is process-global + advanced in fn()-call order — deterministic
// for fns authored at module load (fixed ES evaluation order), which is the safe case.
// ⚠️ The caveat is about a BARE `_fn{n}` reaching emitted WGSL: the byte-identical snapshots
// are baked in one process and checked in another, and a fn referenced by a STRING name
// (externFn('project', …) / a callFn('…') / a placeholder-swap funcs[] lookup) must keep a
// stable explicit name. Two ways to have one (#763 H9): pass the name to fn(), OR list the
// anonymous handle in a `funcs:` KEY-RECORD — the record key deterministically RENAMES the
// decl (and every handle-made call site, via declRef + the assembly rewrite), so fnAutoId
// never reaches the output. Only an anonymous fn used in an ARRAY-form module emits `_fn{n}`.
// globalThis-backed counter (#763 D2) — two copies each starting at `_fn0`
// would collide in the name-keyed module dedup and silently mis-link
// DIFFERENT anonymous fns as one.
const fnAutoState = ((globalThis as Record<symbol, unknown>)[
  Symbol.for('xgis.shader-dsl.fnAutoId')
] ??= { n: 0 }) as { n: number }

/** Author a function. One call covers a plain helper and a `@vertex`, `@fragment` or
 *  `@compute` entry point. The returned {@link FnHandle} is both the callable and the
 *  declaration: call it directly, list it in `module({ funcs })`, or read its `.decl`.
 *
 *  The leading name is optional. An anonymous handle carries a placeholder name (`_fn0`,
 *  `_fn1`, and so on) that a `funcs` key record renames when {@link module} assembles, so no
 *  generated name reaches the emitted source. Keep an explicit name when something refers to
 *  the function by its string name and no record renames it, such as an {@link externFn}
 *  declaration whose body this function provides.
 *
 *  `params` is a record whose keys are the parameter names, in declaration order. A value is
 *  one of three things. A plain {@link ShaderType} declares an ordinary parameter. A
 *  {@link builtin} or {@link location} spec declares a stage-attributed entry-point
 *  parameter, emitting `@builtin(...)` or `@location(...)` on it; these are the same two
 *  helpers an {@link ioStruct} field uses, so an entry parameter and a struct field are
 *  authored alike. A struct handle ({@link structDecl} or {@link ioStruct}) hands the body
 *  that struct's typed field proxy, so the body reads `p.vo.uv` with no `VsOut.of(p.vo)`
 *  step. Params are read-only, so `p.uv.assign(...)` is a tsc error; declare a {@link Var}
 *  where the body has to mutate.
 *
 *  A parameter may be named `in`, or any other word GLSL reserves. The IR carries the name
 *  and the GLSL backend renames it at emit. JavaScript cannot bind that name in a
 *  destructuring pattern, so give it a local name there: `({ in: inp }) => inp.uv`.
 *
 *  The return-type token `ret` is optional when the body returns a value TypeScript can see,
 *  `(p) => expr` or a struct field proxy, since the handle takes that value's key. Pass the
 *  token when the body sends its value out through an ambient {@link Return} inside a nested
 *  closure: TypeScript reads such a body as returning nothing, and without the token the
 *  handle widens to `FnHandle<P, string>`, which puts every call site outside the key check.
 *  A function that returns nothing passes `voidT` and lands on `'void'`.
 *
 *  The body is `(p, b) => …`: the typed param nodes first, the {@link Builder} second. Most
 *  bodies need only `p` and the ambient statement surface ({@link Let}, {@link Var},
 *  {@link If}, {@link Loop}, {@link Return}) plus a final native `return`, which is
 *  type-checked against the return type. Reach for `b` when a statement is authored outside
 *  an active scope, and for `b.raw(...)`.
 *
 *  `opts` carries six fields:
 *
 *  - `stage: 'vertex' | 'fragment' | 'compute'` makes the function a pipeline entry point.
 *    Omit it for an ordinary helper.
 *  - `workgroupSize` sizes a compute entry, emitting `@compute @workgroup_size(N)`. It
 *    defaults to 64.
 *  - `retAttr` attaches an attribute to a bare, non-struct stage return, giving
 *    `-> @location(0) vec4<f32>`. A typed `location(0, T)` spec is accepted and its `.attr`
 *    is used. A bare non-struct fragment return defaults to `@location(0)`. A struct return
 *    carries its attributes in the struct instead.
 *  - `allowEarlyReturn` records a deliberate deviation from the `single-exit` lint rule, for
 *    a body whose early {@link Return} skips work, such as a guard in front of a bounded
 *    loop.
 *  - `portable` declares a compute entry a portable kernel; see below.
 *  - `lintDisable` lists rule ids whose diagnostics are dropped for this function, the
 *    general form of `allowEarlyReturn`. Use either with a comment saying why.
 *
 *  A portable kernel emits on both backends: natively as `@compute` on WGSL, and on GLSL ES
 *  3.00 through a compute-to-fragment translation, which WebGL2 dispatches as a fullscreen
 *  draw into an R32UI target. In exchange the kernel stays inside the gather-only tier: a
 *  `global_invocation_id` read only as `.x`, exactly one `read_write` storage binding of
 *  `array<u32>` written exactly once at the invocation index, a first `uniform` binding of
 *  `vec4<u32>` whose `.x` is the invocation count and `.y` the output-grid width, and no raw
 *  statements anywhere the entry can reach. Anything outside that shape fails validation on
 *  both writers with `SD0111` and a per-violation remedy.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @param name - the emitted function name. Omit it to let a `funcs` key record name the
 *    function at module assembly.
 *  @param params - the parameter record, in declaration order, as described above.
 *  @param ret - the return type to pin. Omit it when the body's own `return` carries the type.
 *  @param body - the function body, receiving the typed params and the builder.
 *  @param opts - the stage, the workgroup size, the return attribute, and the lint deviations
 *    listed above.
 *  @returns a callable handle that is also the function declaration.
 *  @throws `SD0110` when `portable` is declared without `stage: 'compute'`.
 *
 *  @example
 *  ```ts
 *  import { fn, location, vec4, length, vec2fT } from '@xgis/shader-dsl'
 *
 *  const dist = fn('dist', { p: vec2fT, q: vec2fT }, ({ p, q }) => length(p.sub(q)))
 *
 *  const fs = fn('fs_main', { uv: location(0, vec2fT) }, ({ uv }) => vec4(uv, 0, 1), {
 *    stage: 'fragment',
 *  })
 *  ```
 *
 *  @see {@link module} for assembling handles into a module.
 *  @see {@link externFn} for calling a function whose body is linked in later.
 *  @see {@link FnParamSpec} for the param record's type.
 */
export function fn<P extends FnParamSpec, R extends string>(
  params: P,
  body: FnBodyValue<P, R>,
  opts?: FnOpts,
): FnHandle<P, R>
export function fn<P extends FnParamSpec, R extends string>(
  name: string,
  params: P,
  body: FnBodyValue<P, R>,
  opts?: FnOpts,
): FnHandle<P, R>
export function fn<P extends FnParamSpec, T extends ShaderType>(
  params: P,
  ret: T,
  body: FnBody<P, KeyOf<T>>,
  opts?: FnOpts,
): FnHandle<P, KeyOf<T>>
export function fn<P extends FnParamSpec, T extends ShaderType>(
  name: string,
  params: P,
  ret: T,
  body: FnBody<P, KeyOf<T>>,
  opts?: FnOpts,
): FnHandle<P, KeyOf<T>>
export function fn(
  a: string | FnParamSpec,
  b: FnParamSpec | ShaderType | FnBody<FnParamSpec, string>,
  c?: ShaderType | FnBody<FnParamSpec, string> | FnOpts,
  d?: FnBody<FnParamSpec, string> | FnOpts,
  e?: FnOpts,
): FnHandle<FnParamSpec, string> {
  const named = typeof a === 'string'
  const name = named ? (a as string) : `_fn${fnAutoState.n++}`
  const params = (named ? b : a) as FnParamSpec
  // The slot after params is either the EXPLICIT return type (a ShaderType) or the BODY (a function) when
  // the return type is inferred. A ShaderType is a plain object; the body is a function — that tells them apart.
  const retOrBody = named ? c : b
  const explicitRet = typeof retOrBody === 'function' ? undefined : (retOrBody as ShaderType)
  const inferred = explicitRet === undefined
  const body = (inferred ? retOrBody : named ? d : c) as FnBody<FnParamSpec, string>
  const opts = (named ? (inferred ? d : e) : inferred ? c : d) as FnOpts | undefined
  // The portable kernel tier is a COMPUTE declaration (#1812) — the two-layer pattern's
  // runtime half, checked here (before the body runs) because `FnOpts` is one flat bag and
  // TS cannot make the pairing unrepresentable without splitting the overload set.
  if (opts?.portable === true && opts.stage !== 'compute')
    throw dslError(
      'SD0110',
      `fn '${name}' declares portable with ${opts.stage ? `stage: '${opts.stage}'` : 'no stage (an ordinary helper fn)'}`,
    )
  // A param value is a plain ShaderType, a FieldSpec `{ type, attr }` (builtin/location)
  // for an entry-point param — the `attr` flows straight to the emitted `@builtin(…)`/
  // `@location(…)` — or a structDecl/ioStruct HANDLE (#740 R6), whose param arrives in
  // the body as the TYPED field proxy (no `X.of(p.in)` re-assertion).
  const entries = Object.entries(params).map(([n, spec]) => {
    const isHandle = 'of' in spec && typeof (spec as StructParamHandle).of === 'function'
    const fieldSpec = !isHandle && 'attr' in spec ? (spec as ParamAttr) : undefined
    return {
      name: n,
      type: (isHandle || 'attr' in spec
        ? (spec as ParamAttr | StructParamHandle).type
        : spec) as ShaderType,
      attr: fieldSpec?.attr,
      // #763 S5 — thread the structured IO fields through to FuncDecl.params;
      // dropping them here made reflect() see ZERO vertex attributes for
      // location()-authored entry params (the string fallback was load-bearing).
      location: fieldSpec?.location,
      builtin: fieldSpec?.builtin,
      interpolate: fieldSpec?.interpolate,
      handle: isHandle ? (spec as StructParamHandle) : undefined,
    }
  })
  const paramList = entries.map((p) => ({
    name: p.name,
    type: p.type,
    ...(p.attr !== undefined ? { attr: p.attr } : {}),
    ...(p.location !== undefined ? { location: p.location } : {}),
    ...(p.builtin !== undefined ? { builtin: p.builtin } : {}),
    ...(p.interpolate !== undefined ? { interpolate: p.interpolate } : {}),
  }))
  const paramNodes = Object.fromEntries(
    entries.map((p) => {
      const node = new Node({ op: 'param', type: p.type, name: p.name })
      return [p.name, p.handle ? p.handle.of(node) : node]
    }),
  ) as ParamNodes<FnParamSpec>
  const bld = new Builder()
  // A body may `return value` (native TS) for its FINAL return — fn appends the
  // ret Stmt, so authoring reads like a normal function. Early returns inside
  // control flow still use Return() (a native return there only exits the closure).
  const rawResult = withScope(bld, () => {
    try {
      return body(paramNodes, bld)
    } catch (e) {
      // #843 — outermost authoring context: name the fn whose body threw, once
      // (a nested subBody has already tagged the statement kind by this point).
      tagAuthoringError(e, AUTHOR_FN_TAGGED, `while building fn '${name}'`)
      throw e
    }
  })
  // A struct field proxy returned directly (`return o` — #763 X14) forwards
  // `.expr`/`.type` to its base var, so it reads like a node from here on.
  const result = rawResult as ReadonlyNode | void
  if (result !== undefined) bld.ret(result)
  // Return type: explicit token if given, else inferred from what the body returns.
  const ret = explicitRet ?? inferReturnType(result, bld.stmts)
  // stage → pipeline attrs (@vertex / @fragment / @compute @workgroup_size(N)).
  const attrs =
    opts?.stage === 'compute'
      ? ['@compute', `@workgroup_size(${opts.workgroupSize ?? 64})`]
      : opts?.stage
        ? [`@${opts.stage}`]
        : undefined
  // retAttr: string | FieldSpec, with the fragment default (#763 X3).
  const retAttrRaw = opts?.retAttr
  const retAttr =
    (typeof retAttrRaw === 'string' ? retAttrRaw : retAttrRaw?.attr) ??
    (opts?.stage === 'fragment' && ret.kind !== 'struct' && ret.kind !== 'void'
      ? '@location(0)'
      : undefined)
  // The FieldSpec form carries the STRUCTURED builtin id — preserve it (#1672): dropping
  // it here made `retAttr: builtin('point_size', …)` invisible to assertBuiltins, the
  // one authoring path where an absent builtin could still reach WGSL text silently.
  const retBuiltin = typeof retAttrRaw === 'string' ? undefined : retAttrRaw?.builtin
  const decl: FuncDecl = {
    name,
    params: paramList,
    ret,
    body: bld.stmts,
    attrs,
    // Structured stage (#740 R3) — reflect/backends read these; `attrs` stays the emit spelling.
    stage: opts?.stage,
    workgroupSize: opts?.stage === 'compute' ? (opts.workgroupSize ?? 64) : undefined,
    // Structured-only, no attrs spelling (#740 R3 / #1812) — see FuncDecl.portable.
    portable: opts?.portable,
    retAttr,
    retBuiltin,
    allowEarlyReturn: opts?.allowEarlyReturn,
    lintDisable: opts?.lintDisable,
  }
  // The handle IS the call node factory (shared with externFn); the FuncDecl fields are mixed
  // onto it so it still duck-types as a FuncDecl in a module's funcs[]. `name` is a non-writable
  // function prop, so it is set via defineProperty (Object.assign would throw on it under strict).
  const handle = makeCallFactory(name, ret, paramList, decl) as FnHandle<FnParamSpec, string>
  // enumerable so `{ ...handle }` (e.g. the projection-fn spread) carries the name; a
  // function's own `name` is non-enumerable by default, which would drop it from a spread.
  Object.defineProperty(handle, 'name', { value: name, configurable: true, enumerable: true })
  Object.assign(handle, {
    params: paramList,
    ret,
    body: decl.body,
    attrs: decl.attrs,
    // #1812 — `portable` has NO attrs spelling by design, so unlike `stage`/`workgroupSize`
    // it has no fallback to recover it from: a handle that did not mirror it would drop the
    // declaration the moment module() put the handle (not the decl) into funcs[], and the
    // whole tier would be silently dead on the only path that can author it — fn().
    portable: decl.portable,
    retAttr: decl.retAttr,
    retBuiltin: decl.retBuiltin,
    allowEarlyReturn: decl.allowEarlyReturn,
    lintDisable: decl.lintDisable,
    decl,
  })
  // Stamp the handle (the object that lands in a module's funcs[] and that the lint
  // engine iterates) with its authored location, so Func-level diagnostics can resolve
  // a file:line:col. No-op unless source tracing is on.
  recordLoc(handle, captureLoc())
  return handle
}

/** A typed call-only handle for a function whose definition is provided elsewhere: the
 *  forward-declaration counterpart to `fn()`. Use it when the callee cannot be an importable
 *  {@link FnHandle} at the caller's module-load time, for instance a function a host builds
 *  from configuration after the calling module has already authored its body. The handle
 *  carries only the signature (name, parameter types and return type), so the caller makes a
 *  typed call now, object-param `f({ a, b })` or positional `f(a, b)`, and the host links the
 *  body in at emit. The emitted node is a call by name. */
export type ExternFn<P extends ParamSpec, R extends ShaderType> = {
  /** Typed object-param call, with the same argument union as {@link FnHandle}: arguments
   *  are read, so read-only nodes (`Let` results, parameters) and raw numbers, lifted to the
   *  declared parameter type, are accepted. */
  (args: { readonly [K in keyof P]: ReadonlyNode<KeyOf<P[K]>> | number }): Node<KeyOf<R>>
  /** Positional call. Arguments are matched to the parameters in declaration order. */
  (...args: NodeLike[]): Node<KeyOf<R>>
}
/** Forward-declare a callable whose real definition (`fn(...)`) is authored somewhere else,
 *  or built later than the caller's own module-load time (see {@link ExternFn}). Prefer a
 *  real `fn()` and its {@link FnHandle} whenever the callee is importable at the call site.
 *  `externFn` buys a typed call for the genuine forward-reference case, at a cost: the
 *  caller has no declaration to list in `module({ funcs })`, so the host that owns the body
 *  links it in at emit.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @param name - the callee's emitted name, which the linked-in definition must match.
 *  @param params - the parameter record, in declaration order.
 *  @param ret - the return type.
 *  @returns a callable handle carrying only the signature.
 *
 *  @example
 *  ```ts
 *  import { externFn, f32T, vec2fT } from '@xgis/shader-dsl'
 *
 *  // Callable now; the real fn() body is linked in later, at emit, by the host.
 *  export const warp = externFn('warp', { x: f32T, y: f32T, scale: f32T }, vec2fT)
 *  ```
 */
export function externFn<P extends ParamSpec, R extends ShaderType>(
  name: string,
  params: P,
  ret: R,
): ExternFn<P, R> {
  const paramList = Object.entries(params).map(([n, type]) => ({ name: n, type }))
  return makeCallFactory(name, ret, paramList) as ExternFn<P, R>
}

// ── module assembly: transitive fn collection + key-naming (#740 R1) ──

/** A declarator handle accepted by `module({ uses })`: anything that carries its own
 *  declaration or binding. {@link uniformStruct} returns `{ struct, binding }`;
 *  {@link ioStruct}, {@link structDecl} and {@link constDecl} return `{ decl }`;
 *  {@link storageBuffer} returns `{ binding }` plus an `elementDecl` for a struct element;
 *  {@link resource} returns `{ binding }`. */
export type UsesHandle =
  | { readonly struct: StructDecl; readonly binding: BindingDecl }
  | { readonly decl: StructDecl | ConstDecl }
  | { readonly binding: BindingDecl; readonly elementDecl?: StructDecl }

/** The input shape {@link module} accepts: a `Partial<ModuleDecl>` whose `funcs` also takes a
 *  key-named record (`{ vs, fs }`) as an alternative to the array, and whose `uses` derives
 *  structs, bindings and consts from declarator handles. Prefer the record `funcs` form when
 *  the module's function names are its own variable names; an anonymous `fn(params, body)`
 *  is named by its key, with no separate `name` string to keep in sync. Prefer the array form
 *  when order matters and the functions already carry explicit names.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  export const SPRITE_MODULE: ModuleDecl = module({
 *    structs: [U.struct, VsOut.decl],
 *    bindings: [U.binding, atlasTex.binding, atlasSmp.binding],
 *    funcs: [vs, fs],
 *  })
 *  ```
 */
export interface ModuleParts extends Omit<Partial<ModuleDecl>, 'funcs'> {
  /** The functions, as an array in emit order or as a record whose keys name them. */
  readonly funcs?: readonly FuncDecl[] | Readonly<Record<string, FuncDecl>>
  /** Declarator handles; the module's structs, bindings and consts are derived from them. */
  readonly uses?: readonly UsesHandle[]
}

/** The decl behind a funcs[] item — FnHandle carries `.decl`; a plain FuncDecl is itself. */
const declOf = (f: FuncDecl): FuncDecl => (f as { decl?: FuncDecl }).decl ?? f

/** Visit every call Expr in a body (the collector's only interest — full walk). */
function walkCalls(
  stmts: readonly Stmt[],
  onCall: (e: Extract<Expr, { op: 'call' }>) => void,
): void {
  const onExpr = (e: Expr): void =>
    eachExpr(e, (x) => {
      if (x.op === 'call') onCall(x)
    })
  for (const s of stmts) eachStmtExpr(s, onExpr)
}

/** Normalize `funcs` (array or key-named record) into the ModuleDecl array:
 *  1. Record form: each key names its decl (anonymous fns get their real name;
 *     a differing name is a rename — every handle-made call re-spells via declRef).
 *  2. Transitive collection: fns reached through handle calls (`declRef`) but not
 *     listed are PREPENDED in callee-first (post-order) discovery order — the
 *     authored list keeps its exact order, so existing full lists emit
 *     byte-identically and an entries-only list still satisfies GLSL's
 *     define-before-use. A call made by name through externFn carries no declRef and
 *     is linked at emit. */
function normalizeFuncs(input: ModuleParts['funcs']): FuncDecl[] {
  const record = input !== undefined && !Array.isArray(input)
  let renamed = false
  const authored: FuncDecl[] = record
    ? Object.entries(input as Readonly<Record<string, FuncDecl>>).map(([key, f]) => {
        const d = declOf(f)
        // #763 D4 — a record-form rename mutates the SHARED FuncDecl in place.
        // If this decl already participated in another assembly under a
        // DIFFERENT name, renaming it now silently corrupts that module's
        // re-emit (`fn old` definition vs `new(...)` calls). Fail loud.
        const prev = d[ASSEMBLED_AS]
        if (prev !== undefined && prev !== key) {
          throw new Error(
            `shader-dsl: fn was already assembled as '${prev}' — renaming the shared decl to '${key}' would corrupt the earlier module's re-emit (#763 D4). Author a separate fn (or reuse the key '${prev}').`,
          )
        }
        if (d.name !== key) {
          ;(d as { name: string }).name = key
          // Keep the handle's own (defineProperty'd, enumerable) name in step for spreads.
          if (d !== f)
            Object.defineProperty(f, 'name', { value: key, configurable: true, enumerable: true })
          renamed = true
        }
        // Non-enumerable — the optimizer's fixpoint compares modules via JSON;
        // an enumerable marker would perturb it.
        Object.defineProperty(d, ASSEMBLED_AS, { value: key, configurable: true })
        return f
      })
    : (input ?? []).map((f) => {
        // Array-form assembly pins the CURRENT name for the same reason — a later
        // record-form rename of this decl would corrupt THIS module's re-emit.
        const d = declOf(f)
        Object.defineProperty(d, ASSEMBLED_AS, { value: d.name, configurable: true })
        return f
      })

  // Transitive collection (post-order DFS over declRef edges), skipping listed decls.
  // Dedup is by IDENTITY **and NAME**: module semantics are name-keyed (dup-func is a
  // validation error), and a pass-transformed fn (e.g. the polygon composer's
  // placeholder-swapped copies) is a NEW object whose body still carries declRefs to
  // the ORIGINALS — identity alone would re-collect a fn the module already lists
  // under the same name.
  const listed = new Set(authored.map(declOf))
  const listedNames = new Set(authored.map((f) => declOf(f).name))
  const collected: FuncDecl[] = []
  const visit = (d: FuncDecl): void => {
    walkCalls(d.body, (e) => {
      const callee = e.declRef
      if (!callee || listed.has(callee) || listedNames.has(callee.name)) return
      listed.add(callee)
      listedNames.add(callee.name)
      visit(callee) // callee's own callees first…
      collected.push(callee) // …then the callee (post-order = define-before-use)
    })
  }
  authored.forEach((f) => visit(declOf(f)))
  const funcs = collected.length ? [...collected, ...authored] : authored

  // A rename can postdate call nodes authored in OTHER fn bodies — re-spell them.
  if (renamed) {
    for (const f of funcs) {
      walkCalls(declOf(f).body, (e) => {
        if (e.declRef && e.fn !== e.declRef.name) (e as { fn: string }).fn = e.declRef.name
      })
    }
  }
  return funcs
}

/** Assemble a module from its declarations. `consts`, `structs`, `bindings` and `funcs` are
 *  the four arrays a module is made of, and each defaults to empty; `overrides`, `externs`,
 *  `enables` and `uses` are the optional rest. The result is a plain {@link ModuleDecl}, the
 *  value {@link emitModule}, {@link emitGlslModule}, {@link reflect} and {@link compileModule}
 *  all take.
 *
 *  The order of `funcs` is the emit order, and two things depend on it. GLSL ES 3.00 requires
 *  declare-before-use: the backend topologically sorts its own function section and emits a
 *  forward prototype where the call graph forces one, and a callee-first list keeps working
 *  without them. A fixed order also keeps the emitted bytes deterministic across rebuilds. A
 *  function reached only through a handle call is collected transitively and prepended
 *  callee-first, so listing the entry points is usually enough.
 *
 *  `funcs` also accepts a record. Each key renames the handle it holds, an anonymous
 *  `fn(params, body)` handle included, and key order is the emit order, since JavaScript
 *  preserves string-key insertion order. The record therefore names every function
 *  deterministically and no auto-generated `_fn0` name reaches the output, which matters when
 *  a snapshot test compares the output or another declaration refers to a function by name.
 *  Keep the array form when the list is spread across sources or post-processed as data.
 *
 *  `uses` takes declarator handles, {@link uniformStruct}, {@link storageBuffer},
 *  {@link resource}, {@link ioStruct}, {@link structDecl}, {@link constDecl} and
 *  {@link fp64Guard} among them, and derives the struct, binding and const entries from what
 *  each handle already knows. Explicit arrays still work and merge with the derived ones.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @param parts - the declaration arrays, the optional `funcs` record, and `uses`.
 *  @returns the assembled module.
 *  @throws `Error` when a `funcs` record key renames a declaration that was already assembled
 *    under a different name, which would corrupt the earlier module's re-emit.
 *
 *  @example
 *  ```ts
 *  import { module } from '@xgis/shader-dsl'
 *
 *  // Array form: the order is the emit order, callees first.
 *  const m = module({ structs: [VsOut.decl], bindings: [U.binding], funcs: [wrap, vs, fs] })
 *
 *  // Record form: each key is the emitted name, and key order is the emit order.
 *  const n = module({ uses: [U, VsOut], funcs: { wrap, vs_main: vs, fs_main: fs } })
 *  ```
 *
 *  @see {@link fn} for the handles this collects.
 *  @see {@link ModuleParts} for the input shape.
 *  @see {@link reflect} for reading the assembled module's pipeline metadata.
 */
export function module(parts: ModuleParts): ModuleDecl {
  // #763 X1 — `uses:` derives structs/bindings/consts from the HANDLES, which
  // already know their own decls; every module used to restate them by hand,
  // and a forgotten `U.binding` was green through tsc AND validate, dying at
  // pipeline creation. Explicit arrays still work and merge (name-deduped —
  // the dup-struct/dup-func validate rules would reject the overlap).
  // Explicit arrays pass through UNTOUCHED — validate's dup-struct/dup-func
  // rules must still see an author's accidental duplicates. Only the
  // uses-DERIVED decls dedupe against what is already present (an explicit
  // entry + the same handle in `uses` is the legal merge case).
  const consts: ConstDecl[] = [...(parts.consts ?? [])]
  const structs: StructDecl[] = [...(parts.structs ?? [])]
  const bindings: BindingDecl[] = [...(parts.bindings ?? [])]
  const structNames = new Set(structs.map((s) => s.name))
  const constNames = new Set(consts.map((c) => c.name))
  const bindingKeys = new Set(bindings.map((b) => `${b.group}:${b.binding}:${b.name}`))
  const addStruct = (s: StructDecl): void => {
    if (!structNames.has(s.name)) {
      structNames.add(s.name)
      structs.push(s)
    }
  }
  const addConst = (c: ConstDecl): void => {
    if (!constNames.has(c.name)) {
      constNames.add(c.name)
      consts.push(c)
    }
  }
  const addBinding = (b: BindingDecl): void => {
    const k = `${b.group}:${b.binding}:${b.name}`
    if (!bindingKeys.has(k)) {
      bindingKeys.add(k)
      bindings.push(b)
    }
  }
  for (const h of parts.uses ?? []) {
    if ('struct' in h && h.struct)
      addStruct(h.struct) // uniformStruct
    else if ('decl' in h && h.decl && 'fields' in h.decl)
      addStruct(h.decl) // ioStruct / structDecl
    else if ('decl' in h && h.decl) addConst(h.decl as ConstDecl) // constDecl handle
    if ('elementDecl' in h && h.elementDecl) addStruct(h.elementDecl) // storageBuffer's struct element
    if ('binding' in h && h.binding) addBinding(h.binding) // uniformStruct / storageBuffer / resource
  }
  const decl: ModuleDecl = {
    consts,
    structs,
    bindings,
    funcs: normalizeFuncs(parts.funcs),
    // #923 — carry the specialization-constant declarators through (absent ⇒ omit the
    // key, so an override-free module object stays byte-identical to before).
    ...(parts.overrides ? { overrides: parts.overrides } : {}),
    // #1713 — same carry-through for host-provided globals. Passed EXPLICITLY rather than
    // through `uses:`: an ExternVarHandle is `{ node, decl }`, which the `uses` dispatch's
    // `'decl' in h` branch would route to addConst and silently emit as a module constant.
    ...(parts.externs ? { externs: parts.externs } : {}),
  }
  // #628 — carry the opt-in language-feature caps through (absent ⇒ omit the key, so an
  // enables-free module object stays byte-identical to before).
  return parts.enables ? { ...decl, enables: parts.enables } : decl
}

/** Author a module-level constant from an IR value expression: the form for a constant that
 *  is not a plain scalar. `value` is any constant-foldable literal node, a `vec4(...)`, an
 *  `arrayLit(...)`, a struct constructor. It emits `const <name>: <type> = <value>;` on both
 *  WGSL and GLSL ES 3.00, and the CPU oracle, the same module run in double precision on the
 *  CPU, evaluates the same expression, so all three agree on the value.
 *
 *  A scalar constant is the other form. {@link constDecl} takes a `{ wgsl, cpu }` pair and
 *  writes them into a `ConstDecl`'s `wgslValue` and `cpuValue`: the shader gets the spelling
 *  you want in the source, often a truncated one such as `3.14159265`, while the oracle
 *  evaluates the full double. `constExpr` has no such split, because a folded literal node
 *  carries one value for both.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @param name - the emitted constant name, and the name every reference spells.
 *  @param type - the constant's shader type, emitted as its declared type.
 *  @param value - a constant-foldable literal node holding the value.
 *  @returns the `ConstDecl` to put in `module({ consts })`.
 *
 *  @example
 *  ```ts
 *  import { constExpr, arrayLit, arrayT, vec4, vec4fT } from '@xgis/shader-dsl'
 *
 *  const SKY = constExpr('SKY', vec4fT, vec4(0.4, 0.6, 0.9, 1))
 *  const PALETTE = constExpr('PALETTE', arrayT(vec4fT, 2), arrayLit(vec4fT, c0, c1))
 *  ```
 *
 *  @see {@link constDecl} for a scalar constant with a separate CPU value.
 *  @see {@link module} for where the returned declaration goes.
 */
export function constExpr(name: string, type: ShaderType, value: Node): ConstDecl {
  return { name, type, wgslValue: 0, cpuValue: 0, valueExpr: value.expr }
}

/** Author a raw statement, the escape hatch that splices verbatim text into a function body.
 *  Reach for it when a statement has to be hand-written: a string from another generator, or
 *  a construct the IR does not model.
 *
 *  The payload carries one spelling per target, `{ wgsl, glsl }`. The meaning is fixed, only
 *  the spelling differs, and each backend splices its own side. One side may be omitted, and
 *  the other backend then throws `SD0030` naming the missing side and quoting the side you
 *  did give, so leaving a side out states that the module does not build for that target. At
 *  least one side is required at the type level: `rawStmt({})` does not compile.
 *
 *  Only the first line receives the enclosing body's indent. The emitter prepends that indent
 *  to the payload as a whole, so line two onward of a multi-line payload lands at column
 *  zero. Indent the continuation lines yourself when the output shape matters.
 *
 *  Identifiers inside the payload are yours to keep valid. Nothing reads into raw text, so
 *  nothing rewrites it, and the GLSL backend renames params and locals that collide with GLSL
 *  reserved words (`in`, `sample`, `filter`, `texture`, and the rest); a `glsl` payload naming
 *  the pre-rename identifier references a variable the renamed text does not have. Only the GLSL
 *  backend renames, so the risk is one-sided even though the contract is the same on both.
 *  For the same reason a module holding a raw statement makes {@link mangle} a no-op
 *  module-wide, and the CPU oracle, the same module run in double precision on the CPU,
 *  throws when it reaches raw text it cannot evaluate.
 *
 *  This factory returns the `Stmt`, which is what you want when assembling a `Stmt[]` body by
 *  hand. Inside a fluent {@link fn} body use `b.raw(payload)` instead: a bare `rawStmt(...)`
 *  call there is a discarded expression, since the returned statement is never pushed and
 *  nothing is emitted.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @param payload - the per-target spellings, at least one of `wgsl` and `glsl`.
 *  @returns the raw statement node, ready to place in a body array.
 *
 *  @example
 *  ```ts
 *  import { fn, rawStmt, vec4fT } from '@xgis/shader-dsl'
 *
 *  // Inside a fn body, through the builder:
 *  const fs = fn('fs_main', {}, vec4fT, (_p, b) => {
 *    b.raw({ wgsl: 'return vec4<f32>(1.0, 0.0, 0.0, 1.0);', glsl: 'return vec4(1.0, 0.0, 0.0, 1.0);' })
 *  }, { stage: 'fragment' })
 *
 *  // Assembling a Stmt[] by hand:
 *  const stmt = rawStmt({ wgsl: 'discard;', glsl: 'discard;' })
 *  ```
 *
 *  @see {@link RawPayload} for the payload type.
 *  @see {@link mangle} for what a raw statement costs a production emit.
 */
export function rawStmt(payload: RawPayload): RawStmt {
  return { s: 'raw', ...payload }
}

/** The pair {@link overrideConst} returns for a pipeline specialization constant: `.node`
 *  reads the value, opaque to the optimizer, in any expression or branch condition, and
 *  `.decl` goes into `module({ overrides: [...] })`. */
export interface OverrideHandle<K extends string> {
  readonly node: ReadonlyNode<K>
  readonly decl: OverrideDecl
}

/** Declare a pipeline specialization constant: one value that is fixed when a pipeline is
 *  created, later than module build and earlier than the draw.
 *
 *  WGSL emits a module-scope `override name: type = default;`, and the host pins it through
 *  pipeline constants, `createRenderPipeline({ constants: { name } })`. GLSL ES 3.00 has no
 *  driver-side equivalent, so a specialized variant is a re-emit: pass
 *  `emitGlslModule(m, stage, { overrideValues })` and the backend writes a generated
 *  `#define NAME <value>` placed after the `#version` line, which is where GLSL will accept
 *  it. An override the caller does not name keeps its default. The values a host passes on
 *  either target come from `reflect(m).overrides`, which reports each name, type and default.
 *
 *  The read stays opaque to the optimizer, so a branch guarded by `q.node` survives every DSL
 *  pass and the driver eliminates it per variant. That is the ubershader mechanism: one
 *  module, one emit, N specialized pipelines.
 *
 *  WGSL allows scalar overrides only, so `type` must be `bool`, `i32`, `u32` or `f32`.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @param name - the override's name, as the host spells it in `constants` or in a define.
 *  @param type - the scalar shader type of the value.
 *  @param defaultValue - the value used when the host pins nothing.
 *  @returns an {@link OverrideHandle}: `.node` reads the value, `.decl` goes into
 *    `module({ overrides })`.
 *  @throws `SD0014` when `type` is not a scalar.
 *
 *  @example
 *  ```ts
 *  import { overrideConst, module, reflect, u32T } from '@xgis/shader-dsl'
 *
 *  const quality = overrideConst('QUALITY', u32T, 1)
 *  const m = module({ overrides: [quality.decl], funcs: [fs] })
 *  reflect(m).overrides // [{ name: 'QUALITY', type: u32T, default: 1 }]
 *  ```
 *
 *  @see {@link reflect} for the values a host pins.
 *  @see {@link variantFamily} when the variants differ in shape and not only in a value.
 */
export function overrideConst<T extends ShaderType>(
  name: string,
  type: T,
  defaultValue: number | boolean,
): OverrideHandle<KeyOf<T>> {
  if (type.kind !== 'scalar') {
    throw dslError('SD0014', `override '${name}': ${type.kind}`)
  }
  return { node: overrideRef(name, type), decl: { name, type, default: defaultValue } }
}

/** The pair `externVar` returns: the read node, and the declaration to hand `module()`. */
export interface ExternVarHandle<K extends string> {
  readonly node: ReadonlyNode<K>
  readonly decl: ExternVarDecl
}

/** Declare a host-provided global: the variable counterpart of {@link externFn}.
 *
 *  A host prelude may hand a shader values such as a view matrix or a frame time as
 *  loose globals the module does not declare. `externVar` declares such a value abstractly.
 *  It emits nothing on either backend; what it provides is everything around the reference:
 *  type checking at each use site, a name that survives {@link mangle}, and an entry in
 *  `reflect().requires` (and in a fragment's `requires`) so a host can check the module's
 *  expectations against what its prelude provides.
 *
 *  `spelling` maps the logical name onto each target. When another host exposes the same
 *  value differently, as a WGSL struct member or a bound uniform in place of a GLSL prelude
 *  global, the change is confined to the spelling map.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @param name - the logical symbol name, and the default spelling on both targets.
 *  @param type - its shader type, for checking every read.
 *  @param opts - per-target `spelling`, and an advisory `stage`.
 *  @returns an {@link ExternVarHandle}: `.node` reads the value, `.decl` goes into
 *    `module({ externs })`.
 *
 *  @example
 *  ```ts
 *  import { externVar, mat4fT } from '@xgis/shader-dsl'
 *
 *  const uMatrix = externVar('u_matrix', mat4fT, { stage: 'vertex' })
 *  const clip = uMatrix.node.mul(worldPos) // type-checked; emits `u_matrix * …`
 *  ```
 */
export function externVar<T extends ShaderType>(
  name: string,
  type: T,
  opts?: { spelling?: { wgsl?: string; glsl?: string }; stage?: ExternVarDecl['stage'] },
): ExternVarHandle<KeyOf<T>> {
  return {
    node: externRef(name, type),
    decl: {
      name,
      type,
      ...(opts?.spelling ? { spelling: opts.spelling } : {}),
      ...(opts?.stage ? { stage: opts.stage } : {}),
    },
  }
}

// ── Ambient free-function authoring surface (C2) ──
// Capitalised to avoid JS keyword clashes (If/Loop/Let/Var/Return/Switch); each
// routes to the INNERMOST active scope (currentBuilder), so no `Builder` param is
// threaded per nesting level. The old `cb.let(...)` / `(b) => …` callback API still
// works (both push the same Stmt[]), so shaders migrate function-by-function and the
// emit stays byte-identical. IfChain.elif/.else accept a zero-arg `() => …` body
// (a 0-arg fn is assignable where `(b) => void` is wanted), so chains read clean too.

/** Bind a value to an immutable local, emitting `let name = expr;` into the innermost active
 *  scope. It is the ambient counterpart of `Builder.let`, resolving the innermost active
 *  builder itself so a body reads plainly without threading `b` through every nested
 *  {@link If} or {@link Loop} callback.
 *
 *  It returns the read-only node type, so `binding.assign(...)` is a tsc error. To mutate,
 *  declare with {@link Var}. Read APIs take the read-only type too, so a `Let` result flows
 *  everywhere a value is read.
 *
 *  Most intermediates need no wrapper at all: author a plain `const` and the emit decides
 *  between inlining, a shared `let` and a `var`. The case where a `Let` is load-bearing is a
 *  loop that mutates a var. Common-subexpression elimination cannot cache a subexpression
 *  that reads a mutated var, because its value differs per read site, so a value derived from
 *  that var re-emits at every read unless it is materialised. Inside such a loop, wrap
 *  anything derived from the mutated var that you read more than once.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @param name - the emitted binding name. Omit it and the builder generates one.
 *  @param value - the expression to bind.
 *  @returns a read-only node reading the binding.
 *
 *  @example
 *  ```ts
 *  import { fn, Loop, Let, If, Break, length, f32, u32, f32T, vec3fT } from '@xgis/shader-dsl'
 *
 *  const march = fn('march', { ro: vec3fT, rd: vec3fT }, f32T, ({ ro, rd }) => {
 *    const t = f32(0) // mutated below, so the emit materialises it as a var
 *    Loop(u32(0), (i) => i.lt(u32(72)), () => {
 *      const p = ro.add(rd.mul(t))
 *      const d = Let(length(p).sub(1)) // computed once; without Let it re-emits per read
 *      If(d.lt(0.001), () => Break())
 *      t.assign(t.add(d))
 *    })
 *    return t
 *  })
 *  ```
 *
 *  @see {@link Var} for a binding you can assign to.
 */
export function Let<K extends string>(value: ReadonlyNode<K>): ReadonlyNode<K>
export function Let<K extends string>(name: string, value: ReadonlyNode<K>): ReadonlyNode<K>
export function Let<K extends string>(
  nameOrValue: string | ReadonlyNode<K>,
  maybeValue?: ReadonlyNode<K>,
): ReadonlyNode<K> {
  return typeof nameOrValue === 'string'
    ? currentBuilder().let(nameOrValue, maybeValue!)
    : currentBuilder().let(nameOrValue)
}
/** Declare a mutable local and return the node that reads and writes it. `Var` is the one
 *  declarator whose result carries `.assign`, so it is what a body reaches for when a value
 *  changes: an accumulator, a counter, a value a {@link Switch} chain fills in per case.
 *
 *  Four shapes are accepted: `Var(init)` infers the type from the initialiser, `Var(type)` and
 *  `Var(type, init)` state it, and `Var(name, init)` or `Var(name, type, init)` also pin the
 *  emitted identifier, which keeps the bytes stable across rebuilds.
 *
 *  A plain `const` usually needs no `Var`. Author the intermediate as a JavaScript `const` and
 *  the emit decides between an inlined expression, a shared `let` and a `var`; if the value is
 *  later assigned to, the auto-var pass materialises it as a real `var` with no marker from
 *  you. Reach for `Var` when you want the binding named, or when the declaration and the first
 *  assignment are far apart.
 *
 *  The read-only bindings are the other half of the rule. A {@link Let} result, an {@link fn}
 *  parameter and a module constant all return the read-only node type, which has no `.assign`,
 *  so mutating one is a tsc error at the authoring line.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @param name - the emitted identifier. Omit it and the builder generates one.
 *  @param type - the declared type. Omit it when an initialiser carries the type.
 *  @param init - the initial value.
 *  @returns a mutable node reading the binding, and the target of `.assign`.
 *
 *  @example
 *  ```ts
 *  import { Var, Switch, f32 } from '@xgis/shader-dsl'
 *
 *  const radiusPx = Var('radius_px', rawRadius)
 *  Switch(sizeMode)
 *    .case(1, () => radiusPx.assign(rawRadius.div(viewport.z)))
 *    .default(() => {})
 *  ```
 *
 *  @see {@link Let} for an immutable binding.
 */
export function Var<K extends string>(init: ReadonlyNode<K>): Node<K>
export function Var<T extends ShaderType>(type: T, init?: ReadonlyNode<KeyOf<T>>): Node<KeyOf<T>>
export function Var<T extends ShaderType>(
  name: string,
  type: T,
  init?: ReadonlyNode<KeyOf<T>>,
): Node<KeyOf<T>>
/** Named and type-inferred: `Var('n', init)` mirrors `Let('n', init)`, taking the type from
 *  the initialiser. */
export function Var<K extends string>(name: string, init: ReadonlyNode<K>): Node<K>
export function Var<T extends ShaderType>(
  nameOrTypeOrInit: string | T | ReadonlyNode,
  typeOrInit?: T | ReadonlyNode<KeyOf<T>>,
  maybeInit?: ReadonlyNode<KeyOf<T>>,
): Node<KeyOf<T>> {
  // Var(init) — a mutable var seeded from a value infers its WGSL type from that value.
  // Brand probe, not instanceof (#763 D1) — a cross-instance init node must not
  // fall through to the ShaderType arm and declare a garbage-typed var.
  if (isNodeValue(nameOrTypeOrInit))
    return currentBuilder().var(nameOrTypeOrInit.type, nameOrTypeOrInit) as Node<KeyOf<T>>
  if (typeof nameOrTypeOrInit === 'string') {
    // Var(name, init) — the second slot is a NODE, not a ShaderType (#763 X9).
    if (isNodeValue(typeOrInit))
      return currentBuilder().var(nameOrTypeOrInit, typeOrInit.type, typeOrInit) as Node<KeyOf<T>>
    return currentBuilder().var(nameOrTypeOrInit, typeOrInit as T, maybeInit)
  }
  return currentBuilder().var(nameOrTypeOrInit, typeOrInit as Node<KeyOf<T>> | undefined)
}
/** Push an explicit `return value;` (or a bare `return;`) onto the innermost scope. Use it
 *  for any return from inside `If`, `Loop` or `Switch` control flow: a native JavaScript
 *  `return` inside a nested body callback only exits that closure and emits nothing, so what
 *  reads as an early exit falls through. The one place a native `return value` works is a
 *  body's own final, top-level return, which `fn()` appends for you. For the common "return
 *  early if a condition holds" shape, {@link ReturnIf} is the more readable guard-clause
 *  spelling.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  If(winding.ne(0), () => {
 *    Return(f32(1).sub(min_dist))
 *  })
 *  Return(f32(1).add(min_dist))
 *  ```
 */
export const Return = (value?: ReadonlyNode): void => currentBuilder().ret(value)
/** Guard clause: `if (cond) { return value; }`, the explicit early return that reads as
 *  "return value if cond". It emits the same statements as `If(cond, () => Return(value))`.
 *  A native `return` inside an `If` body emits nothing, so an early return from a branch is
 *  written in one of these two forms.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @param cond - the guard condition.
 *  @param value - the value to return; omit it for a bare `return;`.
 *
 *  @example
 *  ```ts
 *  ReturnIf(winding.ne(0), f32(1).sub(min_dist))
 *  Return(f32(1).add(min_dist))
 *  ```
 */
export const ReturnIf = (cond: ReadonlyNode<'bool'>, value?: ReadonlyNode): void => {
  currentBuilder().if(cond, (b) => b.ret(value))
}
/** Push a `continue;` onto the innermost scope, skipping to the next iteration of the nearest
 *  enclosing loop. An `If` or `Switch` body nested inside a `Loop` is not itself a loop
 *  boundary, so `Continue()` written inside a guard in a loop still targets that loop.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  If(outsideRange(arcOnSeg, halfS.mul(-2), segLen.add(halfS.mul(2))), () => Continue())
 *  ```
 */
export const Continue = (): void => currentBuilder().continue()
/** Push a `break;` onto the innermost scope, exiting the nearest enclosing `Loop` (or the
 *  current `Switch` case) outright, under the same nesting rule as {@link Continue}: an `If`
 *  nested inside the loop is not itself a break boundary.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  Loop(u32(0), (i) => i.lt(u32(72)), () => {
 *    const d = Let(length(p).sub(1))
 *    If(d.lt(0.001), () => Break()) // hit: stop marching
 *  })
 *  ```
 */
export const Break = (): void => currentBuilder().break()
/** Push a `discard;` onto the innermost scope. It ends the current fragment invocation with
 *  no color or depth write, the fragment-only terminator of both WGSL and GLSL. It is
 *  typically guarded by an `If` for a cull test: a backface, an alpha clip, an out-of-bounds
 *  sample.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  If(cosC.lt(0), () => {
 *    Discard()
 *  })
 *  ```
 */
export const Discard = (): void => currentBuilder().discard()

/** Author `if (cond) { body }` over the innermost active scope. Chain `.elif(c, () => …)` and
 *  `.else(() => …)` on the returned {@link IfChain}. A native `return` inside the body
 *  callback only exits that closure; for an early return from the branch write
 *  {@link Return} or {@link ReturnIf}.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @param cond - the branch condition.
 *  @param body - the statements of the branch, authored through the ambient functions.
 *  @returns the chain, for `.elif` and `.else`.
 *
 *  @example
 *  ```ts
 *  If(d.lt(0.001), () => {
 *    Break()
 *  }).else(() => {
 *    t.assign(t.add(d))
 *  })
 *  ```
 */
export const If = (cond: ReadonlyNode<'bool'>, body: () => ReadonlyNode | void): IfChain =>
  currentBuilder().if(cond, () => body())

/** Author a C-style `for` loop over the innermost active scope. The counter starts at `init`,
 *  runs while `cond` holds, and advances by `step` after each iteration.
 *
 *  The leading name is optional and pins the emitted counter identifier; omit it and the
 *  builder generates one. `step` is optional too and defaults to `+1`, so an ascending loop
 *  passes nothing. The counter is a mutable node, since reassigning a loop variable is legal
 *  on both targets.
 *
 *  Both callbacks receive the counter: `cond` as `(i) => i.lt(...)`, and the body as
 *  `(i) => { ... }`. Declaring the parameter on the condition and omitting it on the body is
 *  the mistake worth knowing. A body written `() => { ... }` that mentions `i` is still valid
 *  JavaScript closure syntax, so nothing is wrong at the call site, but `i` is not in scope:
 *  tsc reports `Cannot find name 'i'`, and a transpile-only runner reports it while the module
 *  is being built, as `while building fn '…': in Loop body: i is not defined`.
 *
 *  {@link Break} and {@link Continue} are the loop terminators. For a loop whose only job is
 *  to fold a value, {@link reduce} returns the accumulator and needs no `Var`.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @param name - the emitted counter identifier. Omit it and one is generated.
 *  @param init - the counter's initial value, which also fixes its type.
 *  @param cond - the continue test, receiving the counter.
 *  @param body - the loop body, receiving the counter.
 *  @param step - the per-iteration increment. Defaults to `+1`.
 *
 *  @example
 *  ```ts
 *  import { Loop, toF32, u32 } from '@xgis/shader-dsl'
 *
 *  Loop(
 *    u32(0),
 *    (i) => i.lt(u32(64)),
 *    (i) => {
 *      acc.assign(acc.add(toF32(i)))
 *    },
 *  )
 *  ```
 *
 *  @see {@link reduce} for the value-returning fold.
 *  @see {@link Break} and {@link Continue} for the terminators.
 */
export function Loop<K extends string>(
  init: ReadonlyNode<K>,
  cond: (i: Node<K>) => ReadonlyNode<'bool'>,
  body: (i: Node<K>) => ReadonlyNode | void,
  step?: ReadonlyNode<ScalarKey> | number,
): void
export function Loop<K extends string>(
  name: string,
  init: ReadonlyNode<K>,
  cond: (i: Node<K>) => ReadonlyNode<'bool'>,
  body: (i: Node<K>) => ReadonlyNode | void,
  step?: ReadonlyNode<ScalarKey> | number,
): void
export function Loop<K extends string>(
  a: string | ReadonlyNode<K>,
  b: ReadonlyNode<K> | ((i: Node<K>) => ReadonlyNode<'bool'>),
  c: ((i: Node<K>) => ReadonlyNode<'bool'>) | ((i: Node<K>) => ReadonlyNode | void),
  d?: ((i: Node<K>) => ReadonlyNode | void) | ReadonlyNode<ScalarKey> | number,
  e?: ReadonlyNode<ScalarKey> | number,
): void {
  const named = typeof a === 'string'
  const init = (named ? b : a) as ReadonlyNode<K>
  const cond = (named ? c : b) as (i: Node<K>) => ReadonlyNode<'bool'>
  const body = (named ? d : c) as (i: Node<K>) => ReadonlyNode | void
  const step = (named ? e : d) as ReadonlyNode<ScalarKey> | number | undefined
  if (named) currentBuilder().forRange(a as string, init, cond, (_b, i) => body(i), step)
  else currentBuilder().forRange(init, cond, (_b, i) => body(i), step)
}

/** Fold a value over a C-style loop: the value-returning spelling of the `var acc = init;
 *  for (...) { acc = f(acc, i) }` accumulator. The body returns the next accumulator value,
 *  so the call site declares no `Var` and writes no `assign`; `reduce` materialises the
 *  variable, the loop and the assignment internally, and the emitted statements are the same
 *  as the hand-written form. Returns the accumulator node for use after the loop.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @param init - the accumulator's initial value, which also fixes its type.
 *  @param loopInit - the counter's initial value.
 *  @param cond - the continue test, receiving the counter.
 *  @param body - receives the accumulator and the counter, and returns the next accumulator.
 *  @param step - the per-iteration increment. Defaults to `+1`.
 *  @returns a node reading the accumulator after the loop.
 *
 *  @example
 *  ```ts
 *  import { reduce, toF32, f32, u32 } from '@xgis/shader-dsl'
 *
 *  const sum = reduce(f32(0), u32(0), (i) => i.lt(u32(8)), (acc, i) => acc.add(toF32(i)))
 *  ```
 *
 *  @see {@link Loop} for the statement form.
 */
export function reduce<K extends string, J extends string>(
  init: ReadonlyNode<K>,
  loopInit: ReadonlyNode<J>,
  cond: (i: Node<J>) => ReadonlyNode<'bool'>,
  body: (acc: Node<K>, i: Node<J>) => ReadonlyNode<K>,
  step?: ReadonlyNode<ScalarKey> | number,
): Node<K> {
  const acc = currentBuilder().var(init.type, init) as Node<K>
  currentBuilder().forRange(
    loopInit,
    cond,
    (_b, i) => {
      currentBuilder().assign(acc, body(acc, i))
    },
    step,
  )
  return acc
}

/** Dispatch a value on a condition, returning the value instead of mutating a var. Two shapes
 *  are accepted: `when(cond, () => a, () => b)` for two arms, and
 *  `when([[c0, () => e0], [c1, () => e1]], () => eN)` for N arms, where the first true
 *  condition wins.
 *
 *  Each arm returns its value; `when` materialises the var and the if/elif/else chain
 *  internally, so the emit is identical to the hand-written `var v; if (c) v = …` form. The
 *  arms take values only, with no var name and no type token: the result type comes from the
 *  arms.
 *
 *  Choosing between the three dispatch surfaces is a question about the subject. `when` is for
 *  condition and range dispatch, where each arm tests something different and there is no
 *  single subject: a threshold ladder, a pair of unrelated flags. {@link Switch} and
 *  `matchExpr` are for dispatch on one integer scrutinee, the value that decides which arm
 *  runs; `matchEnum` is the same with an exhaustiveness check. {@link select} is the eager
 *  two-way form, which evaluates both arms.
 *
 *  `ifExpr` and `condExpr` are deprecated aliases of the two-arm and N-arm shapes. They
 *  forward here unchanged.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @param cond - the test, for the two-arm shape.
 *  @param arms - condition and value pairs, for the N-arm shape, evaluated in order.
 *  @param thenVal - the value when `cond` holds.
 *  @param elseVal - the value when no condition holds.
 *  @returns a node reading the chosen value.
 *
 *  @example
 *  ```ts
 *  import { when, vec2 } from '@xgis/shader-dsl'
 *
 *  const dir = when(
 *    segLen.lt(1e-6),
 *    () => vec2(1, 0),
 *    () => segVec.div(segLen),
 *  )
 *
 *  const band = when(
 *    [
 *      [level.lt(4), () => coarse],
 *      [level.lt(9), () => medium],
 *    ],
 *    () => fine,
 *  )
 *  ```
 *
 *  @see {@link Switch} for dispatch on one integer scrutinee.
 *  @see {@link reduce} for the loop-fold counterpart.
 */
export function when<K extends string>(
  cond: ReadonlyNode<'bool'>,
  thenVal: () => ReadonlyNode<K>,
  elseVal: () => ReadonlyNode<K>,
): Node<K>
export function when<K extends string>(
  arms: ReadonlyArray<readonly [ReadonlyNode<'bool'>, () => ReadonlyNode<K>]>,
  elseVal: () => ReadonlyNode<K>,
): Node<K>
export function when<K extends string>(
  a: ReadonlyNode<'bool'> | ReadonlyArray<readonly [ReadonlyNode<'bool'>, () => ReadonlyNode<K>]>,
  b: () => ReadonlyNode<K>,
  c?: () => ReadonlyNode<K>,
): Node<K> {
  const arms: ReadonlyArray<readonly [ReadonlyNode<'bool'>, () => ReadonlyNode<K>]> = Array.isArray(
    a,
  )
    ? a
    : [[a as ReadonlyNode<'bool'>, b]]
  const elseVal = (Array.isArray(a) ? b : c) as () => ReadonlyNode<K>
  const bld = currentBuilder()
  const iv = bld.inferredVar()
  let vt: ShaderType | undefined
  const arm = (v: () => ReadonlyNode<K>) => () => {
    const val = v()
    vt ??= val.type
    currentBuilder().assign(iv.ref(val.type) as Node<K>, val)
  }
  let chain = bld.if(arms[0][0], arm(arms[0][1]))
  for (let k = 1; k < arms.length; k++) chain = chain.elif(arms[k][0], arm(arms[k][1]))
  chain.else(arm(elseVal))
  iv.commit(vt!)
  return iv.ref(vt!) as Node<K>
}

/** Two-arm value dispatch on a condition: `ifExpr(cond, () => a, () => b)`.
 *
 *  @deprecated Use `when(cond, then, else)`. {@link when} covers this two-arm shape and the
 *  N-arm shape under one name; this alias forwards to it unchanged.
 */
export function ifExpr<K extends string>(
  cond: ReadonlyNode<'bool'>,
  thenVal: () => ReadonlyNode<K>,
  elseVal: () => ReadonlyNode<K>,
): Node<K> {
  return when(cond, thenVal, elseVal)
}

/** N-arm value dispatch on conditions, the first true condition winning:
 *  `condExpr([[c0, () => e0], [c1, () => e1]], () => eN)`.
 *
 *  @deprecated Use `when(arms, else)`. {@link when} covers this N-arm shape and the two-arm
 *  shape under one name; this alias forwards to it unchanged.
 */
export function condExpr<K extends string>(
  arms: ReadonlyArray<readonly [ReadonlyNode<'bool'>, () => ReadonlyNode<K>]>,
  elseVal: () => ReadonlyNode<K>,
): Node<K> {
  return when(arms, elseVal)
}

/** `switch (scrut) { case n: …; default: … }` as a chainable statement builder, mirroring the
 *  `If(…).elif(…).else(…)` surface so integer dispatch reads the familiar imperative way:
 *  declare a {@link Var} holding the default, then assign it inside the case arms. Emits a
 *  real `switch` on both targets. `.case(n, body)` adds a case label; `.default(body?)` adds
 *  the optional default arm and ends the chain, pushing the statement.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  const radiusPx = Var(rawRadius)
 *  Switch(sizeMode)
 *    .case(1, () => radiusPx.assign(rawRadius.div(viewport.z)))
 *    .case(2, () => radiusPx.assign(rawRadius.mul(2)))
 *    .default(() => {})
 *  ```
 */
export class SwitchChain {
  private readonly cases: Array<[number, () => void]> = []
  constructor(private readonly scrut: ReadonlyNode<'i32' | 'u32'>) {}
  /** Add a `case value:` arm. Returns the chain. */
  case(value: number, body: () => void): SwitchChain {
    this.cases.push([value, body])
    return this
  }
  /** Add the optional `default:` arm and end the chain. The `switch` statement is pushed
   *  onto the innermost scope here, so a chain without `.default()` emits nothing. */
  default(body?: () => void): void {
    currentBuilder().switch(
      this.scrut,
      this.cases.map(
        ([v, f]) => [v, (_b: Builder) => f()] as [number, (bb: Builder) => ReadonlyNode | void],
      ),
      body ? (_b: Builder) => body() : undefined,
    )
  }
}

/** Open a `switch (scrut)` chain: `Switch(scrut).case(n, body)….default(body)`. The
 *  scrutinee is a read position, so a read-only node is accepted, and it must be `i32` or
 *  `u32`: WGSL and GLSL ES 3.00 both type `switch` over integers only.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @param scrut - the integer value dispatched on.
 *  @returns the chain, for `.case` and `.default`.
 *
 *  @see {@link SwitchChain} for the chain's methods.
 *  @see {@link when} for dispatch on conditions.
 */
export function Switch(scrut: ReadonlyNode<'i32' | 'u32'>): SwitchChain {
  return new SwitchChain(scrut)
}
