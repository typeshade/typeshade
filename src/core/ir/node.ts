// ═══ Shader DSL — Node<K> authoring wrapper + builtins ═══
//
// The TSL-style chaining wrapper over an Expr (Node<K>, phantom-typed for the
// compile-time gate), the literal/ref constructors, and the free-function
// builtins. Imports types.ts + nodes.ts.

import {
  type ShaderType,
  type Scalar,
  type KeyOf,
  type ElemKey,
  type ScalarKey,
  typeKey,
  typeEq,
  isVec,
  isScalar,
  isMat,
  isMat64,
  isF64,
  isVec64,
  f32T,
  f64T,
  vec2f64T,
  vec3f64T,
  vec4f64T,
  mat2f64T,
  mat3f64T,
  mat4f64T,
  i32T,
  u32T,
  boolT,
  vec2fT,
  vec3fT,
  vec4fT,
  vec2uT,
  vec2iT,
  vec4uT,
  vec4iT,
  arrayT,
} from './types.js'
import type { Expr, BinOp, CmpOp } from './nodes.js'
import { dslError } from '../diagnostics/error.js'

// Re-export ScalarKey so consumers importing the matchExpr signature can refer
// to its generic bound without a separate types import (mirrors the existing
// `KeyOf` / `ElemKey` re-export pattern in the barrel).
export type { ScalarKey } from './types.js'

/** Anything accepted where a node is read: any node, mutable or read-only, or a JS number,
 *  which lifts to an f32 literal. Reading takes the {@link ReadonlyNode} supertype, so a
 *  `Let()`, parameter or constant operand is accepted everywhere a value is consumed; only
 *  `.assign()` needs the mutable {@link Node} subtype. */
export type NodeLike = ReadonlyNode<any> | number

/** The scalar keys a binary op may pair with element kind `E` — the SAME kind only,
 *  except f64's blessed exact widen from f32. This is `binResultType`'s law made static:
 *  WGSL and GLSL ES 3.00 have NO implicit scalar conversions, so a mixed pair
 *  (f32∘i32, i32∘u32, vec<f32>∘i32-scalar) emits code neither target compiles — and for
 *  non-f64 pairs `binResultType`'s C-like promotion ranking never rejected it, so the
 *  first diagnostic used to be the emit-time `mixed-scalar` lint (or the GPU compiler,
 *  on a raw-IR path). For the WIDENED `K = string` (unparameterised helper params) both
 *  aliases below fall back to `ReadonlyNode<string>`, which every kind-matched branch is
 *  a SUBSET of — that ⊆ direction is what keeps `Node<'f64'>` (and every other specific
 *  key) assignable to `ReadonlyNode<string>` under method bivariance. (The previous
 *  design got the same assignability from the OPPOSITE direction — every branch a
 *  SUPERSET of a `ScalarKey` fallback — which is exactly what admitted the mixed-kind
 *  operands this replaces.) */
type KindScalar<E extends string> = E extends 'f64' ? 'f64' | 'f32' : E

/** The operand a binary arithmetic method accepts for a receiver of key `K`. For a vector
 *  receiver: the same vector key, or a scalar of the vector's element kind (WGSL's
 *  vector-scalar broadcast). For a scalar receiver: the same scalar kind. A `vec2` against a
 *  `vec3`, an integer against a float, or an i32 against a u32 is a type error. An f64
 *  receiver (and the scalar broadcast of an f64 vector) also accepts f32, which widens
 *  exactly. A JS `number` is accepted everywhere and lifts to the receiver's own scalar kind. */
export type ArithArg<K extends string> = K extends `vec${number}<${infer E}>`
  ? ReadonlyNode<K> | ReadonlyNode<KindScalar<E>> | number
  : ReadonlyNode<KindScalar<K>> | number

/** The operand a comparison method accepts for a receiver of key `K`: the receiver's own
 *  scalar kind, since both targets compare matching operands only, plus f32 for an f64
 *  receiver, which widens before the compare. A mixed pair (f32 against i32, f64 against an
 *  integer) is a type error. A JS `number` lifts to the receiver's scalar kind. */
export type CmpArg<K extends string> = ReadonlyNode<KindScalar<K>> | number

/** Maps a composite key (`vec…` or `mat…`) to `never` and passes every other key through.
 *  Used as the `this:` bound of the scalar-only methods, so a vector receiver is rejected
 *  while a scalar receiver, and the widened `ReadonlyNode<string>`, stay usable. `string` is
 *  not a union, so the conditional does not distribute and passes it through unchanged. */
export type NonComposite<K extends string> = K extends `vec${string}` | `mat${string}` ? never : K

// NB — the `.and`/`.or` RECEIVER is deliberately NOT `this:`-bounded. A
// `this: ReadonlyNode<K extends 'bool' ? K : never>`-style bound was tried and
// broke `Node<'vec4<f32>'> → ReadonlyNode<string>` / `Node<'u32'> →
// ReadonlyNode<ScalarKey>` assignability ACROSS the d.ts boundary (the compiler
// package went red while shader-dsl's own build stayed green) — the same
// never-`this` shape the comparisons' NonComposite bound survives, tipped over
// by one more such member. The receiver is guarded at AUTHOR-RUN time instead
// (SD0004 below, the bitwise SD0005 precedent), which still fails long before a
// GPU compiler would.

// Returns ReadonlyNode<string>, not <any> (#763 X12): `<any>` was assignable to
// EVERY ReadonlyNode<K>, so `const b: ReadonlyNode<'bool'> = lift(3)` type-checked.
/** Normalizes a {@link NodeLike} operand to a {@link ReadonlyNode}: a JS number becomes an f32
 *  literal, and an existing node passes through unchanged. Every free-function builtin (`sin`,
 *  `min`, `construct`, …) sends its operands through this, which is why `sin(1)` works without
 *  an explicit `f32(1)`. Call it directly only when writing a new builtin wrapper that needs a
 *  plain node from a `NodeLike` argument. Method operands take a different path: a bare number
 *  passed to a method lifts to the receiver's own scalar kind (u32, i32 or f64), so
 *  `u32node.add(1)` emits an unsigned literal.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { lift, f32 } from '@xgis/shader-dsl'
 *
 *  lift(2)       // Node<'f32'>: 2 lifted to an f32 literal
 *  lift(f32(2))  // the same node, passed through unchanged
 *  ```
 */
export function lift(x: NodeLike): ReadonlyNode<string> {
  return typeof x === 'number' ? new Node({ op: 'lit', type: f32T, value: litNum(x, 'lift') }) : x
}

/** The symbol every node carries as a brand, installed once on the {@link ReadonlyNode}
 *  prototype. It is created with `Symbol.for`, which resolves through the global symbol
 *  registry, so when a bundler loads two copies of this package a node built by one copy still
 *  carries the brand the other copy checks for. `instanceof Node` gives no such guarantee,
 *  because prototype identity differs per copy. {@link isNodeValue} reads this slot. */
export const NODE_BRAND: unique symbol = Symbol.for('xgis.shader-dsl.node') as never
/** Runtime type guard for "is this value a node". It reads the {@link NODE_BRAND} slot instead
 *  of using `instanceof Node`, so it also recognizes a node built by a different loaded copy of
 *  this package, which `instanceof` would miss because a dual-loaded dependency splits
 *  prototype identity. Use it over `instanceof` anywhere a value may come from another copy.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { isNodeValue, f32 } from '@xgis/shader-dsl'
 *
 *  isNodeValue(f32(1))  // true
 *  isNodeValue(42)      // false: a bare number is not a node
 *  ```
 */
export const isNodeValue = (v: unknown): v is ReadonlyNode =>
  v !== null && typeof v === 'object' && (v as Record<symbol, unknown>)[NODE_BRAND] === true

/** Statement sink — the builder installs how `node.assign(v)` pushes its Stmt to the
 *  current scope. Injected (not imported) so the Node lvalue methods can route to the builder without a
 *  node ↔ builder import cycle. (Reads only `.expr`, so a ReadonlyNode value is fine.) */
type StmtSink = { assign(target: ReadonlyNode<any>, value: ReadonlyNode<any>): void }
let _stmtSink: StmtSink | undefined
/** Installs the statement sink that `Node.assign()` writes through. The node module cannot
 *  import the builder (the two would import each other), so the builder registers its own
 *  `{ assign }` implementation here once, when it loads. Authoring code calls `.assign()` on a
 *  node and never calls this directly; a host that supplies its own statement builder is the
 *  only other caller.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { installStmtSink, typeKey } from '@xgis/shader-dsl'
 *
 *  // Record every `.assign()` instead of building a statement.
 *  const log: string[] = []
 *  installStmtSink({
 *    assign: (target, value) => {
 *      log.push(`${typeKey(target.type)} = ${typeKey(value.type)}`)
 *    },
 *  })
 *  ```
 */
export const installStmtSink = (s: StmtSink): void => {
  _stmtSink = s
}
const stmtSink = (): StmtSink => {
  if (!_stmtSink) throw dslError('SD0012')
  return _stmtSink
}

/** Result type of a binary arithmetic op given operand types. vec op scalar
 *  (or vec op same-vec) → vec; scalar op scalar → f32>i32>u32 promotion. A
 *  vec op a different vec is a type error (returned as a poisoned mismatch
 *  that the WGSL/CPU backend never sees because typecheck fails first). */
function binResultType(a: ShaderType, b: ShaderType, ctx: string): ShaderType {
  // mat64 (emulated-double matrices): the ONLY binary op is `*` — M*v → vecN<f64>
  // (matvec) and M*M → matNxN<f64> (matmul). Decided before the native mat arms
  // since `isMat` also matches mat64. A left mat64 with any other op / operand is
  // rejected here at author time (no df64 mat add/sub helpers exist).
  if (isMat64(a)) {
    if (ctx !== '*') throw dslError('SD0041', `${ctx}: '${ctx}' on ${typeKey(a)}`)
    if (isMat64(b)) {
      if (a.n !== b.n) throw dslError('SD0002', `${ctx}: ${typeKey(a)} vs ${typeKey(b)}`)
      return a
    }
    if (isVec64(b)) {
      if (a.n !== b.n) throw dslError('SD0001', `${ctx}: mat${a.n} * vec${b.n}`)
      return b
    }
    throw dslError('SD0004', `${ctx}: ${typeKey(a)} / ${typeKey(b)}`)
  }
  // mat * vec → vec (matN x vecN); mat * mat → mat.
  if (isMat(a) && isVec(b)) {
    if (a.n !== b.n) throw dslError('SD0001', `${ctx}: mat${a.n} * vec${b.n}`)
    return b
  }
  if (isMat(a) && isMat(b)) return a
  if (isVec(a) && isVec(b)) {
    if (!typeEq(a, b)) throw dslError('SD0002', `${ctx}: ${typeKey(a)} vs ${typeKey(b)}`)
    return a
  }
  if (isVec(a) && isScalar(b)) return a
  if (isScalar(a) && isVec(b)) return b
  // vec64 (emulated-double vectors): vec64∘same-vec64 → vec64; vec64∘(f64|f32)
  // scalar broadcasts. Everything else (ints, mixed widths, f32 vecs) rejects.
  // `%` has no emulation; `/` lowers to the vectorized NR division.
  if (isVec64(a) || isVec64(b)) {
    if (ctx === '%') throw dslError('SD0041', `binary op '%' on ${typeKey(a)} / ${typeKey(b)}`)
    if (isVec64(a) && isVec64(b)) {
      if (a.n !== b.n) throw dslError('SD0002', `${ctx}: ${typeKey(a)} vs ${typeKey(b)}`)
      return a
    }
    const [v, other] = isVec64(a) ? [a, b] : [b, a]
    if (isF64(other) || (isScalar(other) && other.scalar === 'f32')) return v
    throw dslError('SD0004', `${ctx}: ${typeKey(a)} / ${typeKey(b)}`)
  }
  // f64 (emulated double): f64∘f64 → f64; f64∘f32 → f64 (implicit EXACT widen —
  // the fp64-lower pass wraps the f32 side as vec2<f32>(x, 0.0)). Anything else
  // (int/bool/vec/mat) is rejected — no implicit narrowing, no int promotion.
  // `%` has no df64 emulation; fail at author time, not at lowering.
  if (isF64(a) || isF64(b)) {
    const other = isF64(a) ? b : a
    if (isF64(other) || (isScalar(other) && other.scalar === 'f32')) {
      if (ctx === '%') throw dslError('SD0041', `binary op '%' on ${typeKey(a)} / ${typeKey(b)}`)
      return f64T
    }
    throw dslError('SD0004', `${ctx}: ${typeKey(a)} / ${typeKey(b)}`)
  }
  if (isScalar(a) && isScalar(b)) {
    const order: Scalar[] = ['f32', 'i32', 'u32']
    const as = a.scalar,
      bs = b.scalar
    if (as === 'bool' || bs === 'bool') throw dslError('SD0003', ctx)
    return order.indexOf(as) <= order.indexOf(bs) ? a : b
  }
  throw dslError('SD0004', `${ctx}: ${typeKey(a)} / ${typeKey(b)}`)
}

const VEC_FIELD_INDEX: Record<string, number> = { x: 0, y: 1, z: 2, w: 3 }
// Colour-alias components map onto the same lanes (WGSL allows either set).
const SWIZZLE_ALIAS: Record<string, string> = { r: 'x', g: 'y', b: 'z', a: 'w' }

// ── Swizzle result-key inference (#740 R9) ──
type StrLen<S extends string, A extends readonly unknown[] = []> = S extends `${string}${infer R}`
  ? StrLen<R, [...A, 1]>
  : A['length']
/** The key of `v.swizzle(S)` for a vector key `K`: the element scalar when `S` has one
 *  character, otherwise `vecN<elem>` with `N` the length of `S`. */
export type SwizzleKey<K extends string, S extends string> =
  StrLen<S> extends 1 ? ElemKey<K> : `vec${StrLen<S> & number}<${ElemKey<K>}>`

/** The read-only base of every value node: every literal, parameter, `constRef` and `Let()`
 *  binding is a `ReadonlyNode`. It carries the full chainable API, arithmetic (`.add`, `.sub`,
 *  …), comparison, swizzles, `.at()` and `.select()`, and no `.assign()`; that method lives only
 *  on the mutable {@link Node} subtype. Write a helper's operand type as `ReadonlyNode<K>`
 *  whenever the value is only read: it then accepts a `Let`, a parameter and a `Var` alike,
 *  since `Node` is a subtype of this class.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @throws {ShaderDslError} `SD0004` from an arithmetic or comparison method whose two operands
 *    have incompatible types (`vec3<f32>` against `vec2<f32>`, say). The `Node<K>` phantom key
 *    catches most of these at `tsc` time; this is the runtime check for an operand typed
 *    `ReadonlyNode<string>` or built dynamically.
 */
export class ReadonlyNode<K extends string = string> {
  /** Phantom type key. Optional and never assigned, so it carries `K` covariantly at the type
   *  level (a `Node<'vec3<f32>'>` is not assignable where a `Node<'vec2<f32>'>` is wanted) at
   *  no runtime cost. It is a plain optional field and must stay one: Babel's TypeScript
   *  transform rejects `declare` class fields. */
  readonly __k?: K
  constructor(readonly expr: Expr) {}
  get type(): ShaderType {
    return this.expr.type
  }

  /** Typed lift of a bare-number operand against this node's scalar kind: a number against a
   *  u32 or i32 scalar receiver lifts to that scalar (`u32node.add(1)` emits `+ 1u`), a number
   *  against an f64 receiver lifts to an f64 literal, and a vector receiver keeps the f32 lift
   *  (WGSL broadcasts `vec + scalar`). The author can therefore drop the `f32()`, `u32()` and
   *  `i32()` wrappers in every arithmetic, comparison and bitwise method; the receiver types
   *  the literal. */
  protected liftArg(o: NodeLike): ReadonlyNode {
    const t = this.type
    if (
      typeof o === 'number' &&
      t.kind === 'scalar' &&
      (t.scalar === 'u32' || t.scalar === 'i32')
    ) {
      return t.scalar === 'u32' ? u32(o) : i32(o)
    }
    // An f64 context lifts a bare number to an f64 LITERAL carrying the full
    // JS-double value — the fp64-lower pass splits it into (hi, lo) f32 halves
    // at build time, so `x.add(0.1)` on an f64 x loses nothing.
    if (typeof o === 'number' && (isF64(t) || isVec64(t))) return f64(o)
    return lift(o)
  }

  private bin(bop: BinOp, o: NodeLike): Node {
    const b = this.liftArg(o)
    return new Node({
      op: 'binop',
      type: binResultType(this.type, b.type, bop),
      bop,
      a: this.expr,
      b: b.expr,
    })
  }
  // Scalar-node × vec-node BROADCASTS (#740 R9): `t.add(phases)` where t is f32
  // and phases vec3<f32> types as vec3<f32> — the runtime (binResultType) always
  // supported it; only the signature forced authors to unroll per component.
  // The `vec${number}<${K}>` constraint self-limits these overloads to a SCALAR
  // LHS (for K = 'vec3<f32>' no vec key can contain it), so vec LHS keeps its
  // exact-K arithmetic unchanged.
  // The `this:` bound (#763 X8) removes these overloads from a VECTOR LHS's
  // candidate set entirely — a vec2+vec3 mismatch now rejects with the readable
  // ArithArg diagnostic instead of leaking a self-nested `vec${n}<vec3<f32>>`
  // template-literal key from a dead broadcast candidate. NonComposite keeps
  // widened `ReadonlyNode<string>` (unparameterised helper params) working.
  add<K2 extends `vec${number}<${K}>`>(
    this: ReadonlyNode<NonComposite<K>>,
    o: ReadonlyNode<K2>,
  ): Node<K2>
  // f32 LHS ∘ f64 RHS widens to f64 (binResultType is symmetric; without this
  // overload only the f64-LHS order type-checked, and the phantom key must be
  // truthful — the runtime result IS f64). The `this:` bound keeps it out of
  // every other receiver's candidate set.
  add(this: ReadonlyNode<'f32'>, o: ReadonlyNode<'f64'>): Node<'f64'>
  add(o: ArithArg<K>): Node<K>
  add(o: NodeLike): Node {
    return this.bin('+', o)
  }
  sub<K2 extends `vec${number}<${K}>`>(
    this: ReadonlyNode<NonComposite<K>>,
    o: ReadonlyNode<K2>,
  ): Node<K2>
  // f32 LHS ∘ f64 RHS widens to f64 (binResultType is symmetric; without this
  // overload only the f64-LHS order type-checked, and the phantom key must be
  // truthful — the runtime result IS f64). The `this:` bound keeps it out of
  // every other receiver's candidate set.
  sub(this: ReadonlyNode<'f32'>, o: ReadonlyNode<'f64'>): Node<'f64'>
  sub(o: ArithArg<K>): Node<K>
  sub(o: NodeLike): Node {
    return this.bin('-', o)
  }
  mul<K2 extends `vec${number}<${K}>`>(
    this: ReadonlyNode<NonComposite<K>>,
    o: ReadonlyNode<K2>,
  ): Node<K2>
  // f32 LHS ∘ f64 RHS widens to f64 (binResultType is symmetric; without this
  // overload only the f64-LHS order type-checked, and the phantom key must be
  // truthful — the runtime result IS f64). The `this:` bound keeps it out of
  // every other receiver's candidate set.
  mul(this: ReadonlyNode<'f32'>, o: ReadonlyNode<'f64'>): Node<'f64'>
  mul(o: ArithArg<K>): Node<K>
  mul(o: NodeLike): Node {
    return this.bin('*', o)
  }
  div<K2 extends `vec${number}<${K}>`>(
    this: ReadonlyNode<NonComposite<K>>,
    o: ReadonlyNode<K2>,
  ): Node<K2>
  // f32 LHS ∘ f64 RHS widens to f64 (binResultType is symmetric; without this
  // overload only the f64-LHS order type-checked, and the phantom key must be
  // truthful — the runtime result IS f64). The `this:` bound keeps it out of
  // every other receiver's candidate set.
  div(this: ReadonlyNode<'f32'>, o: ReadonlyNode<'f64'>): Node<'f64'>
  div(o: ArithArg<K>): Node<K>
  div(o: NodeLike): Node {
    return this.bin('/', o)
  }
  // mod joins the broadcast family (#763 X5) — the runtime (binResultType)
  // always supported scalar%vec; only the signature forced an unroll.
  mod<K2 extends `vec${number}<${K}>`>(
    this: ReadonlyNode<NonComposite<K>>,
    o: ReadonlyNode<K2>,
  ): Node<K2>
  mod(o: ArithArg<K>): Node<K>
  mod(o: NodeLike): Node {
    return this.bin('%', o)
  }
  neg(): Node<K> {
    return new Node<K>({ op: 'unop', type: this.type, a: this.expr })
  }

  private cmp(cop: CmpOp, o: NodeLike): Node<'bool'> {
    // Runtime backstop (#763 X8): these comparisons return Node<'bool'> — a
    // VECTOR comparison in WGSL yields vecN<bool>, so a vec LHS here would emit
    // invalid-typed WGSL with no earlier check (mixed-scalar lint reads binops
    // only). The `this:` bounds below reject it at tsc; hand-built calls land here.
    // An f64 LHS is a legal scalar comparison (lowered lexicographically).
    if (this.type.kind !== 'scalar' && !isF64(this.type))
      throw dslError('SD0002', `compare '${cop}' needs scalar operands, got ${typeKey(this.type)}`)
    const b = this.liftArg(o)
    // f64 operand-compatibility gate (the arithmetic methods get this from
    // binResultType inside bin(); comparisons build their Expr directly).
    if (isF64(this.type) || isF64(b.type)) binResultType(this.type, b.type, cop)
    return new Node<'bool'>({
      op: 'compare',
      type: boolT,
      cop,
      a: this.expr,
      b: b.expr,
    })
  }
  lt(this: ReadonlyNode<NonComposite<K>>, o: CmpArg<K>): Node<'bool'> {
    return this.cmp('<', o)
  }
  gt(this: ReadonlyNode<NonComposite<K>>, o: CmpArg<K>): Node<'bool'> {
    return this.cmp('>', o)
  }
  le(this: ReadonlyNode<NonComposite<K>>, o: CmpArg<K>): Node<'bool'> {
    return this.cmp('<=', o)
  }
  ge(this: ReadonlyNode<NonComposite<K>>, o: CmpArg<K>): Node<'bool'> {
    return this.cmp('>=', o)
  }
  eq(this: ReadonlyNode<NonComposite<K>>, o: CmpArg<K>): Node<'bool'> {
    return this.cmp('==', o)
  }
  ne(this: ReadonlyNode<NonComposite<K>>, o: CmpArg<K>): Node<'bool'> {
    return this.cmp('!=', o)
  }

  // `&&`/`||` are bool-only on BOTH targets. The receiver check is a runtime
  // guard (author-run, like the bitwise SD0005) rather than a `this:` bound —
  // see the note beside NonComposite for why the type-level form is off the
  // table. The operand side is typed `ReadonlyNode<'bool'>` as before.
  private logical(lop: '&&' | '||', o: ReadonlyNode<'bool'>): Node<'bool'> {
    if (this.type.kind !== 'scalar' || this.type.scalar !== 'bool') {
      throw dslError('SD0004', `logical '${lop}' needs bool operands, got ${typeKey(this.type)}`)
    }
    return new Node<'bool'>({ op: 'logical', type: boolT, lop, a: this.expr, b: o.expr })
  }
  and(o: ReadonlyNode<'bool'>): Node<'bool'> {
    return this.logical('&&', o)
  }
  or(o: ReadonlyNode<'bool'>): Node<'bool'> {
    return this.logical('||', o)
  }

  /** Bitwise ops on u32 / i32. Number literals auto-lift to the LHS's scalar
   *  type so `flags.bitAnd(1)` emits `flags & 1u` for a u32 flags (the WGSL
   *  rejects mixed-scalar bitwise — typed lifting keeps emit correct). */
  private bitBin(bop: BinOp, o: NodeLike): Node {
    const t = this.type
    if (t.kind !== 'scalar' || (t.scalar !== 'u32' && t.scalar !== 'i32')) {
      throw dslError('SD0005', `${bop}, got ${typeKey(t)}`)
    }
    const bn: ReadonlyNode = typeof o === 'number' ? (t.scalar === 'u32' ? u32(o) : i32(o)) : o
    return new Node({ op: 'binop', type: t, bop, a: this.expr, b: bn.expr })
  }
  // `& | ^` need BOTH sides the same int kind on both targets, so the node operand
  // is kind-matched to the receiver (`K & ('i32'|'u32')` is `never` for a float LHS
  // — the SD0005 author-run throw already owns that case, numbers aside). Shifts are
  // the deliberate exception, mirroring the mixed-scalar lint's SHIFT_OPS carve-out:
  // WGSL types EVERY shift amount as u32 regardless of the LHS's kind.
  bitAnd(o: ReadonlyNode<K & ('i32' | 'u32')> | number): Node<K> {
    return this.bitBin('&', o) as Node<K>
  }
  bitOr(o: ReadonlyNode<K & ('i32' | 'u32')> | number): Node<K> {
    return this.bitBin('|', o) as Node<K>
  }
  bitXor(o: ReadonlyNode<K & ('i32' | 'u32')> | number): Node<K> {
    return this.bitBin('^', o) as Node<K>
  }
  shl(o: ReadonlyNode<'u32'> | number): Node<K> {
    return this.bitBin('<<', o) as Node<K>
  }
  shr(o: ReadonlyNode<'u32'> | number): Node<K> {
    return this.bitBin('>>', o) as Node<K>
  }

  /** Vector component access: `.x`, `.y`, `.z` or `.w`, returning the element scalar. */
  comp(field: 'x' | 'y' | 'z' | 'w'): Node<ElemKey<K>> {
    const t = this.type
    // A vec64 component is an f64 scalar (fp64-lower reassembles the lane's
    // hi/lo pair from the struct planes).
    if (isVec64(t)) {
      if (VEC_FIELD_INDEX[field] >= t.n) throw dslError('SD0007', `.${field} on ${typeKey(t)}`)
      return new Node<ElemKey<K>>({ op: 'member', type: f64T, base: this.expr, field })
    }
    if (!isVec(t)) throw dslError('SD0006', `.${field} on ${typeKey(t)}`)
    if (VEC_FIELD_INDEX[field] >= t.n) throw dslError('SD0007', `.${field} on ${typeKey(t)}`)
    return new Node<ElemKey<K>>({
      op: 'member',
      type: { kind: 'scalar', scalar: t.elem },
      base: this.expr,
      field,
    })
  }
  get x(): Node<ElemKey<K>> {
    return this.comp('x')
  }
  get y(): Node<ElemKey<K>> {
    return this.comp('y')
  }
  get z(): Node<ElemKey<K>> {
    return this.comp('z')
  }
  get w(): Node<ElemKey<K>> {
    return this.comp('w')
  }

  /** Vector swizzle: `.rgb`, `.xy`, `.a`, and so on. One component gives a scalar; `N`
   *  components give a `vecN` of the same element type. The result key is inferred from the
   *  components string, so `v4.swizzle('yxz')` is `Node<'vec3<f32>'>` for an f32 source and
   *  element-typed for u32 and i32 vectors too. The components are validated: `xyzw` or
   *  `rgba`, one set per swizzle, each within the source's component count. */
  swizzle<S extends string>(comps: S): Node<SwizzleKey<K, S>>
  swizzle(comps: string): Node {
    const t = this.type
    if (!isVec(t) && !isVec64(t)) throw dslError('SD0008', `.${comps} on ${typeKey(t)}`)
    const n = comps.length
    if (n < 1 || n > 4) throw dslError('SD0008', `.${comps} — a swizzle takes 1-4 components`)
    let family: 'xyzw' | 'rgba' | undefined
    for (const c of comps) {
      const fam: 'xyzw' | 'rgba' = SWIZZLE_ALIAS[c] !== undefined ? 'rgba' : 'xyzw'
      // WGSL forbids mixing the xyzw and rgba component sets in one swizzle
      // ('xg' is invalid) — reject at author time (#763 X15).
      if (family !== undefined && fam !== family)
        throw dslError('SD0008', `.${comps} — mixes xyzw and rgba component sets (WGSL forbids)`)
      family = fam
      const idx = VEC_FIELD_INDEX[(SWIZZLE_ALIAS[c] ?? c) as 'x' | 'y' | 'z' | 'w']
      if (idx === undefined)
        throw dslError('SD0008', `.${comps} — '${c}' is not a component (xyzw/rgba)`)
      if (idx >= t.n) throw dslError('SD0007', `.${comps} on ${typeKey(t)}`)
    }
    const type: ShaderType = isVec64(t)
      ? n === 1
        ? f64T
        : { kind: 'vec64', n: n as 2 | 3 | 4 }
      : n === 1
        ? { kind: 'scalar', scalar: t.elem }
        : { kind: 'vec', n: n as 2 | 3 | 4, elem: t.elem }
    return new Node({ op: 'member', type, base: this.expr, field: comps })
  }
  get r(): Node<ElemKey<K>> {
    return this.comp('x')
  }
  get g(): Node<ElemKey<K>> {
    return this.comp('y')
  }
  get b(): Node<ElemKey<K>> {
    return this.comp('z')
  }
  get a(): Node<ElemKey<K>> {
    return this.comp('w')
  }

  get rgb(): Node<SwizzleKey<K, 'rgb'>> {
    return this.swizzle('rgb')
  }

  // Common multi-component swizzle getters — `w.zxy` instead of vec3(w.z, w.x, w.y).
  // For any other component order (u32/i32 vectors included) use the inferred
  // `.swizzle('...')` — the result key derives from the components string (#740 R9).
  get xy(): Node<SwizzleKey<K, 'xy'>> {
    return this.swizzle('xy')
  }
  get xyz(): Node<SwizzleKey<K, 'xyz'>> {
    return this.swizzle('xyz')
  }
  get zyx(): Node<SwizzleKey<K, 'zyx'>> {
    return this.swizzle('zyx')
  }
  get zxy(): Node<SwizzleKey<K, 'zxy'>> {
    return this.swizzle('zxy')
  }
  get yzx(): Node<SwizzleKey<K, 'yzx'>> {
    return this.swizzle('yzx')
  }
  get bgr(): Node<SwizzleKey<K, 'bgr'>> {
    return this.swizzle('bgr')
  }
  get bgra(): Node<SwizzleKey<K, 'bgra'>> {
    return this.swizzle('bgra')
  }

  /** Array index, `base[idx]`. The result key is inferred from the element `ShaderType`. A JS
   *  number index lifts to a u32 literal, since WGSL indices are integers. */
  at<T extends ShaderType>(idx: ReadonlyNode<ScalarKey> | number, elem: T): Node<KeyOf<T>> {
    const idxNode = typeof idx === 'number' ? u32(idx) : idx
    return new Node<KeyOf<T>>({ op: 'index', type: elem, base: this.expr, idx: idxNode.expr })
  }

  /** `this ? a : b`, valid only on a bool node (enforced through the `this:` bound). Both
   *  branches must share a key. Emits WGSL `select(b, a, this)`. */
  // Number-number branches PIN R to 'f32' (the runtime lift). Without this
  // overload the unconstrained R is open to CONTEXTUAL inference: an inline
  // `x.sub(cond.select(0.0, 1.0))` lets the scalar×vec broadcast overload of
  // `sub` infer R = `vec${'${number}'}<f32>` and mistype the whole chain.
  select(this: ReadonlyNode<'bool'>, a: number, b: number): Node<'f32'>
  select<R extends string>(
    this: ReadonlyNode<'bool'>,
    a: ReadonlyNode<R> | number,
    b: ReadonlyNode<R> | number,
  ): Node<R>
  select<R extends string = 'f32'>(
    this: ReadonlyNode<'bool'>,
    a: ReadonlyNode<R> | number,
    b: ReadonlyNode<R> | number,
  ): Node<R> {
    if (!typeEq(this.type, boolT)) throw dslError('SD0009')
    const ta = lift(a),
      tb = lift(b)
    if (!typeEq(ta.type, tb.type))
      throw dslError('SD0010', `${typeKey(ta.type)} vs ${typeKey(tb.type)}`)
    return new Node<R>({
      op: 'select',
      type: ta.type,
      cond: this.expr,
      ifTrue: ta.expr,
      ifFalse: tb.expr,
    })
  }
}

/** A node that also carries the WRITE capability. `Var()` and the auto-var value bindings
 *  (`const x = <expr>` later `.assign`-ed) are `Node`; `Let()` / a function param / a module
 *  const are the read-only `ReadonlyNode` SUPERTYPE — so `someLet.assign(…)` is a compile error
 *  (the no-assign-to-let footgun, caught by `tsc` instead of only by the lint rule). Every
 *  value-producing method/builtin returns `Node`, so the auto-var sugar keeps working for any
 *  produced value; only named immutable bindings are narrowed to `ReadonlyNode`.
 *
 *  This is a TYPE-LEVEL distinction only — the runtime is one class, so emitted WGSL/GLSL is
 *  byte-identical. (Mirrors RxJS `Observable` (read) vs `Subject` (read+write).) */
// One prototype slot — every ReadonlyNode/Node instance (any package copy)
// answers the cross-instance brand probe (#763 D1).
Object.defineProperty(ReadonlyNode.prototype, NODE_BRAND, { value: true })

/** The write-capable node. Every value-producing method and builtin, and `Var()`, return this
 *  subtype, which adds one method, `.assign()`, over the read-only {@link ReadonlyNode} base.
 *  `Let()`, a function parameter and a module constant are the `ReadonlyNode` supertype, so
 *  `someLet.assign(…)` is a `tsc` error. The split is type-level only: the runtime is one
 *  class, and the emitted WGSL and GLSL do not depend on which type a value carried.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 */
export class Node<K extends string = string> extends ReadonlyNode<K> {
  /** `this = value;`, the one mutation method (the same shape as three.js TSL's `.assign()`). JS
   *  cannot overload `=`: `x = v` would rebind the JS variable and emit nothing, so mutation is
   *  a method. For a compound update write `x.assign(x.add(v))`; `add` is the pure expression.
   *  The value lifts to this node's scalar kind. */
  assign(value: ArithArg<K>): void {
    stmtSink().assign(this, this.liftArg(value))
  }
}

// ── Literal / ref constructors ──

// A scalar-literal ctor takes a JS NUMBER/BOOLEAN. Passing a Node (a common slip when you
// mean to CAST — `f32(intNode)`) would silently bake the object into the lit (emitting
// `[object Object]`), so guard it with a message that points at the cast helpers.
const litNum = (v: number, fn: string): number => {
  if (typeof v !== 'number') {
    throw new TypeError(
      `shader-dsl: ${fn}() takes a numeric literal, got ${typeof v} — to CONVERT a Node use a cast (toF32/toI32/toU32), not ${fn}(node)`,
    )
  }
  // Neither WGSL nor GLSL has an Infinity/NaN literal, so a non-finite value here
  // (a host-side 1/0, an uninitialised NaN) would bake the JS spelling verbatim
  // into the module and die at the GPU compiler with no line back to the
  // authoring site — fail loud at construction instead.
  if (!Number.isFinite(v)) {
    throw new TypeError(
      `shader-dsl: ${fn}(${v}) — a shader literal must be finite (no Infinity/NaN spelling exists on either target); clamp or guard the host-side value first`,
    )
  }
  return v
}
/** An f32 literal node. Most bare-number operands lift to f32 on their own (`x.add(1)` emits
 *  `+ 1.0` for an f32 `x`), so this is needed only where a standalone f32 value is wanted
 *  outside an operand position: a module-level `const`, a default argument.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @throws {TypeError} `v` is not a JS number. A common slip is passing a node when you meant
 *    to convert one; use {@link toF32} for that.
 *
 *  @example
 *  ```ts
 *  import { f32 } from '@xgis/shader-dsl'
 *
 *  const half = f32(0.5)  // Node<'f32'>
 *  ```
 */
export const f32 = (v: number): Node<'f32'> =>
  new Node<'f32'>({ op: 'lit', type: f32T, value: litNum(v, 'f32') })
/** An i32 literal node. Use it over the f32 default wherever a value must type-check as a
 *  signed integer: array and loop indices, `matchExpr` and `matchEnum` scrutinees, texture
 *  layer arguments.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @throws {TypeError} `v` is not a JS number. A common slip is passing a node when you meant
 *    to convert one; use {@link toI32} for that.
 *
 *  @example
 *  ```ts
 *  import { i32 } from '@xgis/shader-dsl'
 *
 *  const zero = i32(0)  // Node<'i32'>
 *  ```
 */
export const i32 = (v: number): Node<'i32'> =>
  new Node<'i32'>({ op: 'lit', type: i32T, value: litNum(v, 'i32') })
/** A u32 literal node. Use it over the f32 default wherever WGSL demands an unsigned scalar:
 *  buffer strides, vertex and instance indices, bit-flag masks used with `.bitAnd` and `.bitOr`.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @throws {TypeError} `v` is not a JS number. A common slip is passing a node when you meant
 *    to convert one; use {@link toU32} for that.
 *
 *  @example
 *  ```ts
 *  import { u32 } from '@xgis/shader-dsl'
 *
 *  const flags = u32(4)  // Node<'u32'>
 *  ```
 */
export const u32 = (v: number): Node<'u32'> =>
  new Node<'u32'>({ op: 'lit', type: u32T, value: litNum(v, 'u32') })
/** An f64 (emulated double) literal node. The literal carries the full JS double value and is
 *  split into its (hi, lo) f32 halves when the module is built, so the authored constant
 *  round-trips without loss.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @throws {TypeError} `v` is not a JS number. To convert a node use {@link toF64}.
 *
 *  @example
 *  ```ts
 *  import { f64 } from '@xgis/shader-dsl'
 *
 *  const radius = f64(6378137)  // Node<'f64'>
 *  ```
 */
export const f64 = (v: number): Node<'f64'> =>
  new Node<'f64'>({ op: 'lit', type: f64T, value: litNum(v, 'f64') })
/** A bool literal node, the condition type for `.select()`, `select()` and control flow
 *  (`If`, `While`). Only a JS boolean is accepted, so a stray `bool(someNode)` fails at the
 *  call site instead of coercing to `true`.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @throws {TypeError} `v` is not a JS boolean.
 *
 *  @example
 *  ```ts
 *  import { bool } from '@xgis/shader-dsl'
 *
 *  const flag = bool(true)  // Node<'bool'>
 *  ```
 */
export const bool = (v: boolean): Node<'bool'> => {
  if (typeof v !== 'boolean')
    throw new TypeError(`shader-dsl: bool() takes a boolean literal, got ${typeof v}`)
  return new Node<'bool'>({ op: 'lit', type: boolT, value: v })
}

/** A reference to a module-level constant by name, such as one declared with `constExpr`.
 *  The type defaults to f32. */
export function constRef<T extends ShaderType = typeof f32T>(
  name: string,
  type?: T,
): ReadonlyNode<KeyOf<T>> {
  return new Node<KeyOf<T>>({ op: 'constref', type: type ?? f32T, name })
}

/** A read of a pipeline specialization constant, the read side of an `overrideConst(...)`
 *  declaration. The result is a {@link ReadonlyNode}, and the optimizer treats it as opaque:
 *  the value is symbolic until pipeline creation, so no folding or dead-branch pass may
 *  collapse a branch it guards. Authoring code reads through the handle `overrideConst`
 *  returns; this is the primitive behind that handle. */
export function overrideRef<T extends ShaderType>(name: string, type: T): ReadonlyNode<KeyOf<T>> {
  return new Node<KeyOf<T>>({ op: 'overrideref', type, name })
}

/** A read of a global the host provides, the read side of an `externVar(...)` declaration
 *  and the variable counterpart of an `externFn` call. It is read-only: the host owns the
 *  value. The optimizer treats it as opaque, like {@link overrideRef}: the value is unknown when
 *  the module is built, so no folding or dead-branch pass may collapse a branch it guards.
 *  Authoring code reads through the handle `externVar` returns; this is the primitive behind
 *  that handle. */
export function externRef<T extends ShaderType>(name: string, type: T): ReadonlyNode<KeyOf<T>> {
  return new Node<KeyOf<T>>({ op: 'externref', type, name })
}

/** A function parameter reference, with the key inferred from the `ShaderType`. A parameter
 *  is read-only, so `.assign()` on one is a `tsc` error. */
export function param<T extends ShaderType>(name: string, type: T): ReadonlyNode<KeyOf<T>> {
  return new Node<KeyOf<T>>({ op: 'param', type, name })
}

/** A module-level binding reference (storage/uniform). */
export function bindingRef<T extends ShaderType>(name: string, type: T): Node<KeyOf<T>> {
  return new Node<KeyOf<T>>({ op: 'varref', type, name })
}

// ── Builtins (free functions) ──

// ── Builtin key DOMAINS ──
//
// Every builtin's key parameter is bounded to the keys its WGSL/GLSL spec
// domain (and, for f64, the df64 whitelist) actually admits — `K extends
// string` used to admit bool/texture/struct keys, so `sinh(someBool)`
// type-checked and died at naga (#763 X6/X7's key-class discipline, applied
// to the free-function builtins).

/** The f32-family keys, `'f32'` and the f32 vectors: the argument domain of the float-only
 *  component-wise builtins (`sin`, `exp`, `saturate`, the hyperbolics, …). WGSL and GLSL ES
 *  3.00 define those builtins over floats only, so an i32, u32 or bool node is rejected at
 *  `tsc`.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export type FloatKey = 'f32' | `vec${number}<f32>`
/** The emulated-double keys, `'f64'` and the f64 vectors. Only the builtins with an f64
 *  emulation accept them: `abs`, `floor`, `fract`, `sin`, `cos`, `min`, `max`, `mix`, vector
 *  `normalize` and scalar `sqrt`. Every other builtin bounds its key to {@link FloatKey}, so
 *  an f64 argument to one is a `tsc` error at the authoring site.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export type Float64Key = 'f64' | `vec${number}<f64>`
/** The integer keys, i32 and u32 scalars and vectors, for the builtins whose WGSL and GLSL
 *  domain includes integers: `abs`, `min`, `max` and `clamp`. `sign` is defined over floats
 *  and signed integers only, so it takes i32 and rejects u32.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export type IntKey = 'i32' | 'u32' | `vec${number}<i32>` | `vec${number}<u32>`

const elemScalarType = (t: ShaderType): ShaderType =>
  isVec(t) ? { kind: 'scalar', scalar: t.elem } : t

const call = (fn: string, type: ShaderType, ...args: NodeLike[]): Node =>
  new Node({ op: 'call', type, fn, args: args.map((a) => lift(a).expr) })

// genType1: component-wise unary builtin — preserves the operand key. `A` is the
// fn's key DOMAIN (see the aliases above): float-only by default, widened per fn
// where the spec (ints) or the df64 whitelist (f64) admits more.
const genType1 =
  <A extends string = FloatKey>(fn: string) =>
  <K extends A>(x: ReadonlyNode<K>): Node<K> =>
    call(fn, x.type, x) as Node<K>

/** `sin(x)`: sine of `x` in radians, component-wise. Spelled the same on WGSL and GLSL ES 3.00.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, sin, f32T } from '@xgis/shader-dsl'
 *
 *  const wave = fn('wave', { t: f32T }, ({ t }) => sin(t))
 *  ```
 */
export const sin = genType1<FloatKey | Float64Key>('sin')
/** `cos(x)`: cosine of `x` in radians, component-wise. Spelled the same on WGSL and GLSL ES 3.00.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, cos, f32T } from '@xgis/shader-dsl'
 *
 *  const wave = fn('wave', { t: f32T }, ({ t }) => cos(t))
 *  ```
 */
export const cos = genType1<FloatKey | Float64Key>('cos')
/** `tan(x)`: tangent of `x` in radians, component-wise. Spelled the same on WGSL and GLSL ES 3.00.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, tan, f32T } from '@xgis/shader-dsl'
 *
 *  const slope = fn('slope', { angle: f32T }, ({ angle }) => tan(angle))
 *  ```
 */
export const tan = genType1('tan')
/** `asin(x)`: arcsine of `x`, returning radians in `[-π/2, π/2]`, component-wise. `x` outside
 *  `[-1, 1]` is undefined per the WGSL and GLSL specs (NaN on most drivers); {@link clamp} the
 *  argument first when rounding can push it outside that range.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, asin, clamp, f32T } from '@xgis/shader-dsl'
 *
 *  const angle = fn('angle', { sinA: f32T }, ({ sinA }) => asin(clamp(sinA, -1, 1)))
 *  ```
 */
export const asin = genType1('asin')
/** `acos(x)`: arccosine of `x`, returning radians in `[0, π]`, component-wise. Like {@link asin}
 *  it is undefined outside `x ∈ [-1, 1]`, so {@link clamp} the argument first when float error
 *  can push it a hair past ±1, as it can after a chain of floating-point operations.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, acos, clamp, f32T } from '@xgis/shader-dsl'
 *
 *  const angle = fn('angle', { cosTheta: f32T }, ({ cosTheta }) => acos(clamp(cosTheta, -1, 1)))
 *  ```
 */
export const acos = genType1('acos')
/** `atan(x)`: single-argument arctangent, returning radians in `(-π/2, π/2)`, component-wise.
 *  It covers two quadrants only; use {@link atan2} for the two-argument form, which recovers
 *  the full angle from a `(y, x)` pair with the sign information a plain ratio drops.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, atan, exp, f32T } from '@xgis/shader-dsl'
 *
 *  // The Gudermannian function, 2·atan(exp(y)) − π/2, is built on atan(exp(y)).
 *  const gudermannian = fn('gud', { y: f32T }, ({ y }) => atan(exp(y)))
 *  ```
 */
export const atan = genType1('atan')
/** `exp(x)`: eˣ, component-wise. {@link exp2} is the base-2 form.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, exp, f32T } from '@xgis/shader-dsl'
 *
 *  const decay = fn('decay', { t: f32T }, ({ t }) => exp(t.mul(-1)))
 *  ```
 */
export const exp = genType1('exp')
/** `log(x)`: natural logarithm, component-wise. {@link log2} is the base-2 form. `x <= 0` is
 *  undefined per spec, so floor the argument with {@link max} when it can reach zero.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, log, max, f32, f32T } from '@xgis/shader-dsl'
 *
 *  const decayRate = fn('decayRate', { x: f32T }, ({ x }) => log(max(x, f32(1e-6))))
 *  ```
 */
export const log = genType1('log')
/** `log2(x)`: base-2 logarithm, component-wise; the inverse of {@link exp2}. {@link log} is the
 *  natural-base form.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, log2, f32T } from '@xgis/shader-dsl'
 *
 *  const bits = fn('bits', { x: f32T }, ({ x }) => log2(x))
 *  ```
 */
export const log2 = genType1('log2')
/** `floor(x)`: round toward −∞, component-wise. {@link ceil}, {@link trunc} and {@link round}
 *  are the other rounding directions, and {@link fract} computes `x.sub(floor(x))` in one call.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, floor, f32T } from '@xgis/shader-dsl'
 *
 *  const cell = fn('cell', { x: f32T }, ({ x }) => floor(x))
 *  ```
 */
export const floor = genType1<FloatKey | Float64Key>('floor')
/** `ceil(x)`: round toward +∞, component-wise. {@link floor} rounds the other way.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, ceil, f32T } from '@xgis/shader-dsl'
 *
 *  const steps = fn('steps', { x: f32T }, ({ x }) => ceil(x))
 *  ```
 */
export const ceil = genType1('ceil')
/** `abs(x)`: absolute value, component-wise.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, abs, f32T } from '@xgis/shader-dsl'
 *
 *  const magnitude = fn('magnitude', { x: f32T }, ({ x }) => abs(x))
 *  ```
 */
export const abs = genType1<FloatKey | Float64Key | IntKey>('abs')
/** `sqrt(x)`: square root, component-wise. `x < 0` is undefined per spec. When only 1/√x is
 *  needed, {@link inverseSqrt} is one call in place of a square root and a divide.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, sqrt, f32T } from '@xgis/shader-dsl'
 *
 *  const dist = fn('dist', { sq: f32T }, ({ sq }) => sqrt(sq))
 *  ```
 */
export const sqrt = genType1<FloatKey | 'f64'>('sqrt')
/** `fract(x)`: fractional part, `x − floor(x)`, component-wise. The building block for domain
 *  repetition (tiling a coordinate into `[0, 1)`) and for hash-style noise such as
 *  `fract(dot(p3, p3.yzx.add(33.33)))`.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, fract, f32T } from '@xgis/shader-dsl'
 *
 *  const wrap = fn('wrap', { x: f32T }, ({ x }) => fract(x))
 *  ```
 */
export const fract = genType1<FloatKey | Float64Key>('fract')
/** `radians(deg)`: degrees to radians, component-wise, with the built-in's exact π/180. Write
 *  it in place of `x.mul(DEG2RAD)` with a hand-rounded constant; {@link degrees} is the inverse. */
export const radians = genType1('radians')
/** `degrees(rad)`: radians to degrees, component-wise, with the built-in's exact 180/π; the
 *  inverse of {@link radians}. Write it in place of `x.mul(RAD2DEG)` with a hand-rounded constant.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, degrees, f32T } from '@xgis/shader-dsl'
 *
 *  const deg = fn('deg', { rad: f32T }, ({ rad }) => degrees(rad))
 *  ```
 */
export const degrees = genType1('degrees')
/** `sign(x)`: `-1`, `0` or `1` per component, according to the sign of `x`.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, sign, f32T } from '@xgis/shader-dsl'
 *
 *  const dir = fn('dir', { x: f32T }, ({ x }) => sign(x))
 *  ```
 */
export const sign = genType1<FloatKey | 'i32' | `vec${number}<i32>`>('sign')
/** `exp2(x)`: 2ˣ, component-wise; the inverse of {@link log2}. */
export const exp2 = genType1('exp2')
/** `trunc(x)`: round toward zero, component-wise. */
export const trunc = genType1('trunc')
/** `round(x)`: nearest integer, ties to even, component-wise, on both targets. This differs
 *  from JS `Math.round`, which rounds halves toward +∞. WGSL's `round` is ties-to-even; GLSL
 *  ES 3.00's `round` leaves exact halves to the implementation, so the GLSL output uses
 *  `roundEven`. */
export const round = genType1('round')
/** `inverseSqrt(x)`: 1/√x, component-wise. Emitted as `inverseSqrt` on WGSL and `inversesqrt`
 *  on GLSL. */
export const inverseSqrt = genType1('inverseSqrt')
/** `sinh(x)`: hyperbolic sine, component-wise. Spelled the same on WGSL and GLSL ES 3.00.
 *  `atan(sinh(y))` is the inverse of `asinh(tan(x))`, one transcendental fewer, and better
 *  conditioned near y = 0, than the Gudermannian form `2·atan(exp(y)) − π/2`.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, atan, sinh, f32T } from '@xgis/shader-dsl'
 *
 *  const gd = fn('gd', { y: f32T }, ({ y }) => atan(sinh(y)))
 *  ```
 */
export const sinh = genType1('sinh')
/** `cosh(x)`: hyperbolic cosine, component-wise; the even partner of {@link sinh}
 *  (`cosh²x − sinh²x = 1`). Spelled the same on WGSL and GLSL ES 3.00. */
export const cosh = genType1('cosh')
/** `tanh(x)`: hyperbolic tangent, component-wise; `sinh(x)/cosh(x)`, saturating to ±1 as
 *  `x → ±∞` (the classic smooth soft clamp). Spelled the same on WGSL and GLSL ES 3.00. */
export const tanh = genType1('tanh')
/** `asinh(x)`: inverse hyperbolic sine, component-wise; defined over all reals. As the inverse
 *  Gudermannian, `asinh(tan(φ))` equals `log(tan(π/4 + φ/2))` with one transcendental fewer
 *  and no π/4 constant to truncate.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, asinh, tan, f32T } from '@xgis/shader-dsl'
 *
 *  const invGd = fn('invGd', { phi: f32T }, ({ phi }) => asinh(tan(phi)))
 *  ```
 */
export const asinh = genType1('asinh')
/** `acosh(x)`: inverse hyperbolic cosine, component-wise. `x < 1` is undefined per the WGSL
 *  and GLSL specs (NaN on most drivers); guard with `max(x, f32(1))` when rounding can push an
 *  in-domain operand under 1, as with {@link asin} and {@link acos}. */
export const acosh = genType1('acosh')
/** `atanh(x)`: inverse hyperbolic tangent, component-wise. `|x| >= 1` is undefined per the
 *  WGSL and GLSL specs (±∞ or NaN); clamp strictly inside `(-1, 1)` when the operand can reach
 *  the boundary by rounding, as with {@link asin} and {@link acos}. */
export const atanh = genType1('atanh')
/** `saturate(x)`: `clamp(x, 0, 1)`, component-wise, the standard normalized-range clamp for
 *  colour channels, interpolation factors and coverage. WGSL has a `saturate` builtin; GLSL ES
 *  3.00 has none, so the GLSL output is `clamp(x, 0.0, 1.0)`, with the same semantics.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, saturate, f32T } from '@xgis/shader-dsl'
 *
 *  const alpha = fn('alpha', { fade: f32T }, ({ fade }) => saturate(fade))
 *  ```
 */
export const saturate = genType1('saturate')

/** `atan2(y, x)`: two-argument arctangent, resolving the full angle in `[-π, π]` from a
 *  `(y, x)` pair. Use it over the single-argument {@link atan} whenever the sign of `x` carries
 *  quadrant information, as when recovering a heading from a 2-D offset. Spelled `atan2` on
 *  WGSL and as the two-argument `atan(y, x)` on GLSL.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, atan2, f32T } from '@xgis/shader-dsl'
 *
 *  const heading = fn('heading', { dy: f32T, dx: f32T }, ({ dy, dx }) => atan2(dy, dx))
 *  ```
 */
export const atan2 = <K extends FloatKey>(y: ReadonlyNode<K>, x: NoInfer<ArithArg<K>>): Node<K> =>
  call('atan2', y.type, y, x) as Node<K>
/** `min(a, b)`: component-wise minimum. `b` may be a scalar broadcast against a vector `a`,
 *  the same rule as the arithmetic methods, so `min(color, 1)` caps every channel against one
 *  literal without unrolling per component.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, min, f32T } from '@xgis/shader-dsl'
 *
 *  const capped = fn('capped', { x: f32T }, ({ x }) => min(x, 1))
 *  ```
 */
export const min = <K extends FloatKey | Float64Key | IntKey>(
  a: ReadonlyNode<K>,
  b: NoInfer<ArithArg<K>>,
): Node<K> => call('min', binResultType(a.type, lift(b).type, 'min'), a, b) as Node<K>
/** `max(a, b)`: component-wise maximum, the partner of {@link min}. `b` may be a scalar
 *  broadcast against a vector `a`. A common floor idiom is `max(x, f32(1e-6))`, which keeps a
 *  divisor or a `sqrt` or `log` argument off zero without a branch.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, max, f32, f32T } from '@xgis/shader-dsl'
 *
 *  const safe = fn('safe', { x: f32T }, ({ x }) => max(x, f32(1e-6)))
 *  ```
 */
export const max = <K extends FloatKey | Float64Key | IntKey>(
  a: ReadonlyNode<K>,
  b: NoInfer<ArithArg<K>>,
): Node<K> => call('max', binResultType(a.type, lift(b).type, 'max'), a, b) as Node<K>
/** `pow(a, b)`: `a` raised to the power `b`, component-wise. A JS number `b` lifts to the
 *  kind of `a`, so `pow(z, 4)` emits `pow(z, 4.0)` for an f32 base. WGSL requires `a` and `b`
 *  to have the same type, so a vector `a` needs a vector `b`; a scalar `b` against a vector
 *  `a` passes the type check here and is rejected by the WGSL compiler. */
export const pow = <K extends FloatKey>(a: ReadonlyNode<K>, b: NoInfer<ArithArg<K>>): Node<K> =>
  call('pow', binResultType(a.type, lift(b).type, 'pow'), a, b) as Node<K>
/** Floor modulo: `x - y * floor(x / y)`, with identical semantics on both targets. Use it
 *  wherever a negative operand is possible, which is what domain repetition and angle folds
 *  need: the result takes the sign of `y`, so for a positive `y` every input wraps into
 *  `[0, y)` and `mod(-1, 4)` is `3`.
 *
 *  The `.mod` method and `%` are the other modulo, truncated modulo, whose result takes the
 *  sign of `x`: there `(-1) % 4` is `-1`. That is WGSL's `%` semantics, and since GLSL ES
 *  3.00 keeps `%` for integers only, the GLSL writer spells the float case as
 *  `a - b * trunc(a / b)`. This free function is the portable float modulo of the two. It is
 *  deliberately not named `fmod`, which in C and HLSL means the truncated one.
 *
 *  Component-wise. `y` may be a scalar broadcast over a vector `x`.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @param x - the value to wrap.
 *  @param y - the modulus, a vector of the same shape or a scalar to broadcast.
 *  @returns the wrapped value, in `[0, y)` for a positive `y`.
 *
 *  @example
 *  ```ts
 *  import { fn, mod, f32T } from '@xgis/shader-dsl'
 *
 *  // Fold an angle into one revolution, whatever sign it arrives with.
 *  const wrap = fn('wrap_angle', { a: f32T }, ({ a }) => mod(a, 6.283185307179586))
 *  ```
 *
 *  @see {@link floor} for the rounding this is built on.
 */
export const mod = <K extends FloatKey>(x: ReadonlyNode<K>, y: NoInfer<ArithArg<K>>): Node<K> =>
  call('mod', binResultType(x.type, lift(y).type, 'mod'), x, y) as Node<K>
/** `clamp(x, lo, hi)`: restricts `x` to `[lo, hi]`, component-wise. `lo` and `hi` may be
 *  scalar broadcasts against a vector `x`. It is the standard guard before {@link asin} and
 *  {@link acos}, whose domain is `[-1, 1]`, keeping float rounding from pushing an in-range
 *  value a hair past its bound.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, clamp, f32T } from '@xgis/shader-dsl'
 *
 *  const norm = fn('norm', { x: f32T }, ({ x }) => clamp(x, 0, 1))
 *  ```
 */
export const clamp = <K extends FloatKey | IntKey>(
  x: ReadonlyNode<K>,
  lo: NoInfer<ArithArg<K>>,
  hi: NoInfer<ArithArg<K>>,
): Node<K> => call('clamp', x.type, x, lo, hi) as Node<K>
/** `fma(a, b, c)`: fused multiply-add, `a·b + c`. WGSL emits the hardware `fma`, a single
 *  rounding that a driver's fast-math cannot distribute or reassociate, unlike
 *  `a.mul(b).add(c)`. GLSL ES 3.00 has no `fma`, so the GLSL output is the unfused
 *  `(a * b + c)`. Use it only where the single rounding is the point, such as the error term
 *  `fma(a, b, -a*b)` of an exact product, which some GPU compilers fold away when it is built
 *  from separate operations. */
export const fma = <K extends FloatKey>(
  a: ReadonlyNode<K>,
  b: NoInfer<ArithArg<K>>,
  c: NoInfer<ArithArg<K>>,
): Node<K> => call('fma', a.type, a, b, c) as Node<K>
/** `mix(a, b, t)`: linear interpolation `a + t·(b − a)`, component-wise, keyed by `a`. A `t`
 *  outside `[0, 1]` extrapolates; pass `t` through {@link clamp} or {@link smoothstep} when the
 *  result must stay within the `a..b` range.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, mix, vec3, f32T } from '@xgis/shader-dsl'
 *
 *  const blend = fn('blend', { t: f32T }, ({ t }) => mix(vec3(0, 0, 0), vec3(1, 1, 1), t))
 *  ```
 */
export const mix = <K extends FloatKey | Float64Key>(
  a: ReadonlyNode<K>,
  b: NoInfer<ArithArg<K>>,
  t: ReadonlyNode<'f32'> | number,
): Node<K> => call('mix', a.type, a, b, t) as Node<K>
/** `smoothstep(e0, e1, x)`: Hermite interpolation from 0 at `x = e0` to 1 at `x = e1`,
 *  component-wise. WGSL requires all three arguments to have the same type, scalar or vector.
 *  The vector overload keeps the key of `x`; the scalar overload takes f32 nodes or JS numbers. */
export function smoothstep<K extends `vec${number}<f32>`>(
  e0: ReadonlyNode<K>,
  e1: ReadonlyNode<K>,
  x: ReadonlyNode<K>,
): Node<K>
export function smoothstep(
  e0: ReadonlyNode<'f32'> | number,
  e1: ReadonlyNode<'f32'> | number,
  x: ReadonlyNode<'f32'> | number,
): Node<'f32'>
export function smoothstep(
  e0: ReadonlyNode<string> | number,
  e1: ReadonlyNode<string> | number,
  x: ReadonlyNode<string> | number,
): Node<string> {
  const n = lift(x)
  return call('smoothstep', n.type.kind === 'vec' ? n.type : elemScalarType(n.type), e0, e1, n)
}
/** `step(edge, x)`: 0 where `x < edge`, else 1, component-wise. The result is keyed by `x`;
 *  WGSL requires `edge` and `x` to have the same type. */
export const step = <K extends FloatKey>(edge: NoInfer<ArithArg<K>>, x: ReadonlyNode<K>): Node<K> =>
  call('step', x.type, edge, x) as Node<K>
// K-constrained like `cross` (#763 X7) — dot(v2, v3) used to COMPILE and die at
// naga; the shared K pins both operands to one float-vector key.
/** `length(v)`: Euclidean vector magnitude, `|v|`. The return precision follows the operand: an
 *  f32 vector (vec2, vec3 or vec4) returns f32, and an emulated-double `vec${N}<f64>` returns
 *  f64, so an f64 operand keeps its precision without a cast.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *
 *  @example
 *  ```ts
 *  import { fn, length, vec2, f32T } from '@xgis/shader-dsl'
 *
 *  const mag = fn('mag', { x: f32T, y: f32T }, ({ x, y }) => length(vec2(x, y)))
 *  ```
 */
export function length<K extends `vec${number}<f64>`>(v: ReadonlyNode<K>): Node<'f64'>
export function length<K extends `vec${number}<f32>`>(v: ReadonlyNode<K>): Node<'f32'>
export function length(v: ReadonlyNode<string>): Node<string> {
  return call('length', isVec64(v.type) ? f64T : f32T, v)
}
/** `dot(a, b)`: dot product, vector to scalar. Like {@link length}, the return precision follows
 *  the operand key: f32 vectors return f32, emulated-double `vec${N}<f64>` vectors return f64.
 *  Both operands share one key, so `dot(v2, v3)` is a `tsc` error.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *
 *  @example
 *  ```ts
 *  import { fn, dot, vec3, f32T } from '@xgis/shader-dsl'
 *
 *  const luma = fn('luma', { x: f32T }, ({ x }) => dot(vec3(x, x, x), vec3(0.2, 0.7, 0.1)))
 *  ```
 */
export function dot<K extends `vec${number}<f64>`>(
  a: ReadonlyNode<K>,
  b: NoInfer<ReadonlyNode<K>>,
): Node<'f64'>
export function dot<K extends `vec${number}<f32>`>(
  a: ReadonlyNode<K>,
  b: NoInfer<ReadonlyNode<K>>,
): Node<'f32'>
export function dot(a: ReadonlyNode<string>, b: ReadonlyNode<string>): Node<string> {
  return call('dot', isVec64(a.type) ? f64T : f32T, a, b)
}
/** `normalize(v)`: `v/|v|`, keeping the vector key (vec2, vec3 or vec4). WGSL and GLSL define
 *  it over vectors only, so a scalar operand is a `tsc` error. */
export const normalize = genType1<`vec${number}<f32>` | `vec${number}<f64>`>('normalize')
/** `distance(a, b)`: `|a − b|`, vector to scalar; the built-in form of `length(a.sub(b))`.
 *  Returns f32 for f32 vectors and f64 for emulated-double vectors. */
export function distance<K extends `vec${number}<f64>`>(
  a: ReadonlyNode<K>,
  b: NoInfer<ReadonlyNode<K>>,
): Node<'f64'>
export function distance<K extends `vec${number}<f32>`>(
  a: ReadonlyNode<K>,
  b: NoInfer<ReadonlyNode<K>>,
): Node<'f32'>
export function distance(a: ReadonlyNode<string>, b: ReadonlyNode<string>): Node<string> {
  return call('distance', isVec64(a.type) ? f64T : f32T, a, b)
}
/** `cross(a, b)`: 3-D cross product of two `vec3<f32>` values. */
export const cross = (
  a: ReadonlyNode<'vec3<f32>'>,
  b: ReadonlyNode<'vec3<f32>'>,
): Node<'vec3<f32>'> => call('cross', vec3fT, a, b) as Node<'vec3<f32>'>
// NOTE: the GLSL/WGSL builtin `reflect(i, n)` is intentionally NOT added — the
// name is already taken by the std140 reflection engine (core/reflect.ts), and no
// shader currently needs vector reflection. Add it under a non-colliding name only
// when a real call site appears.
/** Pack a vec4<f32> (each component in [0,1]) into a u32 RGBA8. */
export const pack4x8unorm = (v: ReadonlyNode<'vec4<f32>'>): Node<'u32'> =>
  call('pack4x8unorm', u32T, v) as Node<'u32'>
/** Unpack a u32 RGBA8 into a vec4<f32> (each component in [0,1]). */
export const unpack4x8unorm = (v: ReadonlyNode<'u32'>): Node<'vec4<f32>'> =>
  call('unpack4x8unorm', vec4fT, v) as Node<'vec4<f32>'>
/** Pack a `vec2<f32>` into a u32 as two IEEE-754 binary16 (half) values, component 0 in the
 *  16 low bits. Native on both targets (WGSL `pack2x16float`, GLSL ES 3.00 `packHalf2x16`);
 *  a value outside binary16's finite range (`|x| > 65504`) overflows to ±∞ per IEEE conversion.
 *  A compact carrier for a pair where 8-bit unorm quantisation is too coarse and two full f32
 *  components are too wide; {@link unpack2x16float} restores the rounded pair.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, pack2x16float, vec2fT } from '@xgis/shader-dsl'
 *
 *  const packed = fn('packed', { hv: vec2fT }, ({ hv }) => pack2x16float(hv))
 *  ```
 */
export const pack2x16float = (v: ReadonlyNode<'vec2<f32>'>): Node<'u32'> =>
  call('pack2x16float', u32T, v) as Node<'u32'>
/** Unpack a u32 into a `vec2<f32>` of two binary16 (half) values, the exact inverse of
 *  {@link pack2x16float} (every binary16 value is exactly representable in f32). Component 0
 *  comes from the 16 low bits. Spelled `unpackHalf2x16` on GLSL ES 3.00. */
export const unpack2x16float = (v: ReadonlyNode<'u32'>): Node<'vec2<f32>'> =>
  call('unpack2x16float', vec2fT, v) as Node<'vec2<f32>'>
/** Pack a `vec2<f32>` (each component in [0,1]) into a u32 as two 16-bit unorm values,
 *  `⌊0.5 + 65535·clamp(x, 0, 1)⌋` per component, component 0 in the 16 low bits. The 16-bit
 *  step up from the 8-bit channels of {@link pack4x8unorm}. Spelled `packUnorm2x16` on GLSL ES
 *  3.00. */
export const pack2x16unorm = (v: ReadonlyNode<'vec2<f32>'>): Node<'u32'> =>
  call('pack2x16unorm', u32T, v) as Node<'u32'>
/** Unpack a u32 of two 16-bit unorm values into a `vec2<f32>` in [0,1] (`v/65535` per
 *  component), the inverse of {@link pack2x16unorm}. Spelled `unpackUnorm2x16` on GLSL ES 3.00. */
export const unpack2x16unorm = (v: ReadonlyNode<'u32'>): Node<'vec2<f32>'> =>
  call('unpack2x16unorm', vec2fT, v) as Node<'vec2<f32>'>
/** Pack a `vec2<f32>` (each component in [-1,1]) into a u32 as two 16-bit snorm values,
 *  `⌊0.5 + 32767·clamp(x, -1, 1)⌋` per component in two's complement, component 0 in the 16
 *  low bits. Suited to signed normals and direction fields. Spelled `packSnorm2x16` on GLSL ES
 *  3.00. */
export const pack2x16snorm = (v: ReadonlyNode<'vec2<f32>'>): Node<'u32'> =>
  call('pack2x16snorm', u32T, v) as Node<'u32'>
/** Unpack a u32 of two 16-bit snorm values into a `vec2<f32>` in [-1,1] (`max(v/32767, -1)`
 *  per component), the inverse of {@link pack2x16snorm}. Spelled `unpackSnorm2x16` on GLSL ES
 *  3.00. */
export const unpack2x16snorm = (v: ReadonlyNode<'u32'>): Node<'vec2<f32>'> =>
  call('unpack2x16snorm', vec2fT, v) as Node<'vec2<f32>'>
/** Reinterpret the bit pattern of an f32 as a u32. Emitted as `bitcast<u32>(x)` on WGSL and
 *  `floatBitsToUint(x)` on GLSL. */
export const bitcastU32 = (v: ReadonlyNode<'f32'>): Node<'u32'> =>
  call('bitcastU32', u32T, v) as Node<'u32'>
/** Reinterpret the bit pattern of a u32 as an f32, the inverse of {@link bitcastU32}. Emitted
 *  as `bitcast<f32>(x)` on WGSL and `uintBitsToFloat(x)` on GLSL. An f32 to u32 to f32
 *  round-trip is a fast-math optimization barrier, since the integer domain is not subject to
 *  float reassociation or contraction; {@link optBarrier} packages that. */
export const bitcastF32 = (v: ReadonlyNode<'u32'>): Node<'f32'> =>
  call('bitcastF32', f32T, v) as Node<'f32'>
/** An optimization barrier on one f32 value, the shader equivalent of C's `volatile`. It is
 *  the value-level counterpart of `FuncDecl.opaque`, which protects a whole function and is
 *  therefore never inlined.
 *
 *  `optBarrier(x)` equals `x` bit for bit, on both targets and in the CPU evaluation. What it
 *  adds is that no optimizer may look through it: it is emitted as an f32 to u32 to f32
 *  round-trip ({@link bitcastU32} then {@link bitcastF32}), and the integer domain is not
 *  subject to float reassociation, distribution or contraction. Two instructions, both targets,
 *  no extension.
 *
 *  What it defeats: this library's own constant folding and algebraic simplification, which
 *  match literal operands only, so a wrapped term stops matching every rewrite they have; and
 *  a driver's float reassociation or contraction across the barrier.
 *
 *  What it does not fix: it is a compiler barrier and has no effect on the hardware. It cannot
 *  make a lossy f32 multiply correctly rounded, and on Apple GPUs no float-domain barrier has
 *  been shown sufficient for an emulated-double multiply; the integer flavour that
 *  {@link recommendFp64Flavor} selects exists for that case. Use it to pin one value an
 *  optimizer would otherwise be free to rewrite: a Kahan compensation term, a split constant,
 *  an error-free-transform residual. Wrapping every operation buys nothing.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, Let, optBarrier, f32T } from '@xgis/shader-dsl'
 *
 *  // Kahan compensation: `(sum + y) - sum - y` is algebraically zero, which is exactly
 *  // what a reassociating compiler is licensed to delete.
 *  const compensation = fn('kahan_c', { sum: f32T, y: f32T }, ({ sum, y }) => {
 *    const t = Let(sum.add(y))
 *    return optBarrier(t.sub(sum)).sub(y)
 *  })
 *  ```
 */
export const optBarrier = (v: ReadonlyNode<'f32'> | number): Node<'f32'> =>
  bitcastF32(bitcastU32(typeof v === 'number' ? f32(v) : v))
/** An array-layer argument (#1651). A `number` becomes an i32 LITERAL, not the f32
 *  one `lift()` defaults to: WGSL's array_index takes i32/u32, and `0.0` there is a
 *  type error (GLSL wraps the value in float() either way). A FRACTIONAL number is
 *  rejected here (SD0015): `i32(1.5)` would emit `1.5` as an i32 literal — a naga
 *  compile error on WGSL but a silent round-to-nearest on GLSL (1.5 reads layer 2)
 *  — so the guard keeps the two backends from diverging. */
const layerArg = (l: ReadonlyNode<'i32' | 'u32'> | number): NodeLike => {
  if (typeof l === 'number') {
    if (!Number.isInteger(l)) throw dslError('SD0015', `layer ${l}`)
    return i32(l)
  }
  return l
}
/** A textureLoad MIP-LEVEL (or MSAA sample-index) argument — layerArg's twin, and for
 *  the same reason (#1703). WGSL's `textureLoad` takes an INTEGER level, but `lift()`
 *  defaults a bare number to f32, so the `textureLoad(t, c, 0)` this function's own doc
 *  recommends emitted `textureLoad(t, c, 0.0)` — which naga REJECTS. It went unnoticed
 *  because every in-repo caller writes `u32(0)` by hand and because GLSL's spelling
 *  wraps the argument in `int(…)`, which quietly absorbed the float. An integer texture
 *  has no sampling form at all, so textureLoad is its ONLY read and every author of one
 *  would have hit this on their first line.
 *
 *  NOT the same as textureSampleLevel's level, which really is an f32 in WGSL and
 *  keeps the default lift. A fractional number is rejected for layerArg's reason: the
 *  targets would not agree on how to round it. */
const levelArg = (l: NodeLike): NodeLike => {
  if (typeof l === 'number') {
    if (!Number.isInteger(l)) throw dslError('SD0015', `mip level ${l}`)
    return u32(l)
  }
  return l
}
/** Sample a 2D texture, returning `vec4<f32>`.
 *
 *  The level of detail is implicit: it comes from screen-space derivatives, which exist only
 *  in a fragment invocation. That makes this call fragment-only, and the `fragment-only-builtin`
 *  lint rule, a core rule that fires at every emit, reports `SD0109` when it appears in a
 *  vertex or compute stage. {@link textureSampleLevel} takes the level as an argument and is
 *  legal in every stage, so it is the form a vertex or compute shader reaches for.
 *
 *  A 2D array texture uses the same name, and the first argument's key picks the overload: a
 *  `texture_2d_array<f32>` requires the `layer` argument, and omitting it is a tsc error. A
 *  `number` layer lifts to an `i32` literal. The targets spell the layer differently and the
 *  DSL absorbs that: WGSL takes it as its own argument, `textureSample(t, s, uv, layer)`,
 *  while GLSL ES 3.00 folds it into the coordinate, `texture(t, vec3(uv, float(layer)))`.
 *  Both spellings are core, so an array texture needs no capability on either target.
 *
 *  Integer texture keys (`texture_2d<u32>`, `texture_2d<i32>` and their array twins) are
 *  rejected at tsc, deliberately. Filtering is a weighted average, and interpolating integer
 *  texels has no meaning, so WGSL has no `textureSample` for them at all. GLSL's
 *  `texture(usampler2D, …)` would compile, and accepting it would mint a construct that runs
 *  on WebGL2 and cannot be expressed on WebGPU. The surface both targets share for an integer
 *  texture is {@link textureLoad}, {@link textureDimensions} and {@link textureNumLayers}.
 *
 *  The CPU evaluation (`compileModule`) has no way to read a texture and returns a placeholder
 *  under its `gpuStubs` option.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @param tex - the sampled texture binding, `resource(name, texture2dfT, at).node`.
 *  @param smp - the sampler binding to filter with.
 *  @param uv - normalised texture coordinates.
 *  @param layer - which layer to read, required for an array texture and rejected otherwise.
 *  @returns the filtered texel.
 *
 *  @example
 *  ```ts
 *  import { fn, resource, textureSample, texture2dfT, samplerT, vec2fT, vec4fT } from '@xgis/shader-dsl'
 *
 *  const tex = resource('tex', texture2dfT, { group: 0, binding: 1 })
 *  const smp = resource('tex_sampler', samplerT, { group: 0, binding: 2 })
 *
 *  const fs = fn('fs_main', { uv: vec2fT }, vec4fT, ({ uv }) => textureSample(tex.node, smp.node, uv), {
 *    stage: 'fragment',
 *  })
 *  ```
 *
 *  @see {@link textureSampleLevel} for the any-stage form.
 *  @see {@link textureLoad} for an unfiltered texel fetch.
 */
export function textureSample(
  tex: ReadonlyNode<'texture_2d<f32>'>,
  smp: ReadonlyNode<'sampler'>,
  uv: ReadonlyNode<'vec2<f32>'>,
): Node<'vec4<f32>'>
/** Sample one layer of a 2D array texture, returning `vec4<f32>`. The layer is an argument, so
 *  an atlas of N layers costs one binding slot. See the non-array
 *  overload above for the fragment-only rule, the per-target layer spelling, and why an
 *  integer texture has no sampling form. */
export function textureSample(
  tex: ReadonlyNode<'texture_2d_array<f32>'>,
  smp: ReadonlyNode<'sampler'>,
  uv: ReadonlyNode<'vec2<f32>'>,
  layer: ReadonlyNode<'i32' | 'u32'> | number,
): Node<'vec4<f32>'>
export function textureSample(
  tex: ReadonlyNode<'texture_2d<f32>'> | ReadonlyNode<'texture_2d_array<f32>'>,
  smp: ReadonlyNode<'sampler'>,
  uv: ReadonlyNode<'vec2<f32>'>,
  layer?: ReadonlyNode<'i32' | 'u32'> | number,
): Node<'vec4<f32>'> {
  return (
    layer === undefined
      ? call('textureSample', vec4fT, tex, smp, uv)
      : call('textureSampleArray', vec4fT, tex, smp, uv, layerArg(layer))
  ) as Node<'vec4<f32>'>
}
/** Sample a 2D texture at an explicit mip level, returning `vec4<f32>`. It needs no
 *  derivatives, so it is legal in every stage and is the form a vertex or compute shader uses
 *  in place of {@link textureSample}, for a displacement map read in a vertex shader, say. A JS
 *  number `level` lifts to an f32 literal. Spelled `textureSampleLevel(t, s, uv, l)` on WGSL
 *  and `textureLod(t, uv, l)` on GLSL, where the sampler is part of the texture. The CPU
 *  evaluation returns a placeholder under its `gpuStubs` option. */
export function textureSampleLevel(
  tex: ReadonlyNode<'texture_2d<f32>'>,
  smp: ReadonlyNode<'sampler'>,
  uv: ReadonlyNode<'vec2<f32>'>,
  level: ReadonlyNode<'f32'> | number,
): Node<'vec4<f32>'>
/** Sample one layer of a 2D array texture at an explicit mip level, returning `vec4<f32>`.
 *  Legal in every stage, so it is the form to use in place of the fragment-only array
 *  {@link textureSample} outside a fragment shader. */
export function textureSampleLevel(
  tex: ReadonlyNode<'texture_2d_array<f32>'>,
  smp: ReadonlyNode<'sampler'>,
  uv: ReadonlyNode<'vec2<f32>'>,
  layer: ReadonlyNode<'i32' | 'u32'> | number,
  level: ReadonlyNode<'f32'> | number,
): Node<'vec4<f32>'>
export function textureSampleLevel(
  tex: ReadonlyNode<'texture_2d<f32>'> | ReadonlyNode<'texture_2d_array<f32>'>,
  smp: ReadonlyNode<'sampler'>,
  uv: ReadonlyNode<'vec2<f32>'>,
  levelOrLayer: ReadonlyNode<'f32'> | ReadonlyNode<'i32' | 'u32'> | number,
  level?: ReadonlyNode<'f32'> | number,
): Node<'vec4<f32>'> {
  return (
    level === undefined
      ? call('textureSampleLevel', vec4fT, tex, smp, uv, levelOrLayer as NodeLike)
      : call(
          'textureSampleLevelArray',
          vec4fT,
          tex,
          smp,
          uv,
          layerArg(levelOrLayer as ReadonlyNode<'i32' | 'u32'> | number),
          level,
        )
  ) as Node<'vec4<f32>'>
}
/** Every non-array texture key a texel load accepts: the three sampled elements (f32, u32,
 *  i32) plus the multisampled f32 texture. */
export type TextureLoad2dKey =
  'texture_2d<f32>' | 'texture_2d<u32>' | 'texture_2d<i32>' | 'texture_multisampled_2d<f32>'
/** Every 2D array texture key a texel load accepts. */
export type TextureLoadArrayKey =
  'texture_2d_array<f32>' | 'texture_2d_array<u32>' | 'texture_2d_array<i32>'
/** The `vec4<…>` key a texel load from texture key `K` yields: the loaded element is the
 *  element in the texture key, so `texture_2d<u32>` loads a `vec4<u32>`. Deriving it from the
 *  key keeps the result type and the texture in step; a `vec4<f32>` result from an integer
 *  texture, which both GPU compilers reject, cannot be written with {@link textureLoad}. */
export type TexelKey<K extends string> = K extends `${string}<${infer E}>` ? `vec4<${E}>` : never
// The IR type behind TexelKey — read off the TEXTURE NODE, never a second table, for
// the same reason. Falls through to vec4fT for a non-texture node, which the typed
// overloads make unreachable and which is byte-identical to the pre-#1703 hardcode.
const texelType = (t: ShaderType): ShaderType =>
  t.kind !== 'texture' ? vec4fT : t.elem === 'u32' ? vec4uT : t.elem === 'i32' ? vec4iT : vec4fT
/** Load one texel from a 2D texture at integer coordinates, returning `vec4<f32>`,
 *  `vec4<u32>` or `vec4<i32>` to match the texture's element. WGSL requires the mip level
 *  argument; pass `0` for the base level. A JS number level lifts to a u32 literal, so `0`
 *  emits a valid integer level on both targets, and a fractional level throws `SD0015`. The
 *  coordinate is usually a `vec2<i32>`; any vector or scalar node is accepted here and the
 *  GPU compiler checks it. The CPU evaluation returns a placeholder under its `gpuStubs`
 *  option.
 *
 *  For an integer texture this is the read to use: integer texels cannot be filtered, so
 *  {@link textureSample} and {@link textureSampleLevel} reject those keys at `tsc`. */
export function textureLoad<K extends TextureLoad2dKey>(
  tex: ReadonlyNode<K>,
  coord: NodeLike,
  level: NodeLike,
): Node<TexelKey<K>>
/** Load one texel from one layer of a 2D array texture. The read is unfiltered, so the layer
 *  and level are exact. GLSL folds the layer into an `ivec3` coordinate; WGSL takes it as its
 *  own argument. An integer array texture takes the same call, with the result type following
 *  its element. */
export function textureLoad<K extends TextureLoadArrayKey>(
  tex: ReadonlyNode<K>,
  coord: NodeLike,
  layer: ReadonlyNode<'i32' | 'u32'> | number,
  level: NodeLike,
): Node<TexelKey<K>>
export function textureLoad(
  tex: ReadonlyNode<TextureLoad2dKey> | ReadonlyNode<TextureLoadArrayKey>,
  coord: NodeLike,
  layerOrLevel: ReadonlyNode<'i32' | 'u32'> | NodeLike,
  level?: NodeLike,
): Node<string> {
  const ret = texelType(tex.type)
  return (
    level === undefined
      ? call('textureLoad', ret, tex, coord, levelArg(layerOrLevel as NodeLike))
      : call(
          'textureLoadArray',
          ret,
          tex,
          coord,
          layerArg(layerOrLevel as ReadonlyNode<'i32' | 'u32'> | number),
          levelArg(level),
        )
  ) as Node<string>
}
/** The anti-fast-math guard value of the f64 emulation: a 1.0 the GPU compiler cannot see
 *  through, emitted per target as a texel fetch from the guard texture that `fp64Guard`
 *  declares. The CPU evaluation returns exactly 1. The f64 emulation pass inserts it on its
 *  own; authoring code has no reason to call it. */
export const f64GuardOne = (): Node<'f32'> =>
  call('f64Guard', { kind: 'scalar', scalar: 'f32' }) as Node<'f32'>
/** Texture extent in texels, as a `vec2<u32>`. A 2D array texture reports its width and
 *  height the same way; the layer count is the separate {@link textureNumLayers} query. An
 *  integer texture is accepted too, since an extent does not depend on the texel element. On
 *  GLSL ES 3.00 the `ivec3` that `textureSize` returns for an array is truncated to the two
 *  extent components. Bind the result with `Let` when it is read more than once per
 *  invocation. */
export const textureDimensions = (
  tex: ReadonlyNode<TextureLoad2dKey | TextureLoadArrayKey>,
): Node<'vec2<u32>'> => call('textureDimensions', vec2uT, tex) as Node<'vec2<u32>'>
/** How many layers a 2D array texture has, as a `u32`.
 *
 *  {@link textureDimensions} reports the width and height only, `vec2<u32>`, for an array
 *  texture as much as for a plain one, so the layer count is this separate query. Wrap the
 *  result in {@link toF32} for float arithmetic.
 *
 *  It accepts an array key only: a plain 2D or multisampled texture has no layer count, and
 *  passing one is a tsc error. An integer array texture is accepted, since the count is a
 *  property of the view and not of the texel element.
 *
 *  The targets spell it differently, which is why it carries its own id instead of overloading
 *  `textureDimensions`. WGSL has the dedicated `textureNumLayers(t)`. GLSL ES 3.00
 *  has no such function and reads the third component of `textureSize(t, 0)`, exactly the
 *  component the `uvec2()` constructor behind `textureDimensions` drops. The lod argument is
 *  required there, and the layer count does not vary with lod, so `0` is always right.
 *
 *  The CPU evaluation (`compileModule`) has no way to query a texture and returns a
 *  placeholder under its `gpuStubs` option.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @param tex - the array-texture binding to measure.
 *  @returns the layer count.
 *
 *  @example
 *  ```ts
 *  import { resource, textureNumLayers, toF32, texture2dArrayfT } from '@xgis/shader-dsl'
 *
 *  const atlas = resource('atlas', texture2dArrayfT, { group: 0, binding: 1 })
 *  const layers = toF32(textureNumLayers(atlas.node))
 *  ```
 *
 *  @see {@link textureDimensions} for the width and height.
 *  @see {@link textureSample} for reading one layer.
 */
export const textureNumLayers = (tex: ReadonlyNode<TextureLoadArrayKey>): Node<'u32'> =>
  call('textureNumLayers', u32T, tex) as Node<'u32'>
/** `fwidth(x)`: `abs(dpdx(x)) + abs(dpdy(x))`, the screen-space derivative magnitude,
 *  component-wise. It exists only on the GPU (the CPU evaluation returns 0) and only in a
 *  fragment shader; the `fragment-only-builtin` lint rule, which runs at every emit, reports
 *  `SD0109` when it appears in a vertex or compute stage. In those stages compute the
 *  quantity on the host and pass it in. */
export const fwidth = genType1('fwidth')
/** `dpdx(x)`: the screen-space partial derivative of `x` along the X axis, component-wise.
 *  Like {@link fwidth} it exists only on the GPU (the CPU evaluation returns 0) and only in a
 *  fragment shader; the `fragment-only-builtin` lint rule reports `SD0109` elsewhere. Spelled
 *  `dpdx` on WGSL and `dFdx` on GLSL ES 3.00; {@link dpdy} is the Y-axis partner. */
export const dpdx = genType1('dpdx')
/** `dpdy(x)`: the screen-space partial derivative of `x` along the Y axis, component-wise; the
 *  partner of {@link dpdx}, with the same GPU-only and fragment-only constraints. Spelled `dpdy`
 *  on WGSL and `dFdy` on GLSL ES 3.00.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, dpdy, f32T } from '@xgis/shader-dsl'
 *
 *  const dv = fn('dv', { v: f32T }, ({ v }) => dpdy(v))
 *  ```
 */
export const dpdy = genType1('dpdy')

/** `select(cond, ifTrue, ifFalse)`: the free-function form of `ReadonlyNode.select`. Both
 *  branches must share a key; two JS numbers give an f32 result. */
export function select(cond: ReadonlyNode<'bool'>, ifTrue: number, ifFalse: number): Node<'f32'>
export function select<R extends string>(
  cond: ReadonlyNode<'bool'>,
  ifTrue: ReadonlyNode<R> | number,
  ifFalse: ReadonlyNode<R> | number,
): Node<R>
export function select<R extends string>(
  cond: ReadonlyNode<'bool'>,
  ifTrue: ReadonlyNode<R> | number,
  ifFalse: ReadonlyNode<R> | number,
): Node<R> {
  return cond.select(ifTrue, ifFalse)
}

/**
 * A typed multi-arm dispatch over a scalar scrutinee, the expression form of
 * `switch (scrutinee) { case v0: r0; …; default: dflt }`. Each arm pairs an integer case value
 * with its result, given either as a node or as a zero-argument function that builds one; the
 * default takes the same two forms. Before emit, every `matchExpr` in a function body is
 * rewritten into a `var` slot and a `switch` statement that writes each arm's value into it.
 * A match with ten or more arms casts a non-integer scrutinee to i32, since a WGSL `switch`
 * is integer-only.
 *
 * Every arm's type must equal the default's. The shared `R extends string` bound rejects most
 * mismatches at `tsc`; one that reaches the runtime throws.
 *
 * Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 * @throws {ShaderDslError} `SD0011` when an arm's type differs from the default's.
 *
 * @example
 * ```ts
 * import { fn, matchExpr, f32, u32T } from '@xgis/shader-dsl'
 *
 * const width = fn('width', { kind: u32T }, ({ kind }) =>
 *   matchExpr(kind, [[0, f32(1)], [1, () => f32(2)]], f32(0.5)),
 * )
 * ```
 *
 * @see {@link matchEnum} for the exhaustive form over an {@link enumU32}.
 */
export function matchExpr<S extends ScalarKey, R extends string>(
  scrutinee: ReadonlyNode<S>,
  // Thunk-or-node arms (#763 X17): when/matchEnum arms are thunks while
  // matchExpr's were eager nodes — migrating between the dispatch forms
  // silently moved value construction (and any inner Let) in or out of the
  // arm. Accepting both normalises the family; eager nodes stay supported.
  cases: ReadonlyArray<
    readonly [caseValue: number, value: ReadonlyNode<R> | (() => ReadonlyNode<R>)]
  >,
  default_: ReadonlyNode<R> | (() => ReadonlyNode<R>),
): Node<R> {
  const resolve = (v: ReadonlyNode<R> | (() => ReadonlyNode<R>)): ReadonlyNode<R> =>
    typeof v === 'function' ? v() : v
  const resolvedCases = cases.map(([n, v]) => [n, resolve(v)] as const)
  const resolvedDefault = resolve(default_)
  for (const [, v] of resolvedCases) {
    if (!typeEq(v.type, resolvedDefault.type)) {
      throw dslError('SD0011', `${typeKey(v.type)} vs default ${typeKey(resolvedDefault.type)}`)
    }
  }
  return new Node<R>({
    op: 'matchExpr',
    type: resolvedDefault.type,
    scrutinee: scrutinee.expr,
    cases: resolvedCases.map(([n, v]) => [n, v.expr] as const),
    default: resolvedDefault.expr,
  })
}

// ── Exhaustive integer dispatch (enumU32 + matchEnum) ──

/** A typed u32 enum: a name-to-value map whose members are `Node<'u32'>` literals, plus the raw
 *  value map. Pair it with {@link matchEnum} for exhaustive integer dispatch: the arms object
 *  must cover every member, and a missing or unknown key is a `tsc` error, so a forgotten case
 *  is caught at compile time instead of falling through the `switch` default. */
export interface EnumU32<M extends Record<string, number>> {
  /** Typed member literals: `Kind.members.Fill` is a `Node<'u32'>` holding that member's value. */
  readonly members: { readonly [K in keyof M]: Node<'u32'> }
  /** The raw name-to-value map, the integer case labels {@link matchEnum} dispatches on. */
  readonly values: M
}

/** Declare a u32 enum from a name-to-value map: `const Kind = enumU32({ Line: 0, Fill: 1, Stroke: 2 })`.
 *  The `const` type parameter preserves the literal keys, so {@link matchEnum} can require one
 *  arm per member. The values are the integer case labels emitted in the switch. */
export function enumU32<const M extends Record<string, number>>(values: M): EnumU32<M> {
  const members = {} as { [K in keyof M]: Node<'u32'> }
  for (const k of Object.keys(values) as (keyof M)[]) members[k] = u32(values[k])
  return { members, values }
}

/** Exhaustive integer dispatch over an {@link enumU32}:
 *  `matchEnum(kind, Kind, { Line: () => …, Fill: () => …, … })`. Every member must have an arm;
 *  omit one and `tsc` errors, since the arms type is a mapped type over the enum's keys, so
 *  adding a member surfaces every dispatch site that does not handle it. It builds the same
 *  {@link matchExpr} the hand-written form would: the last-declared member becomes the `switch`
 *  default, so the emitted code is a standard exhaustive switch. Arms are zero-argument
 *  functions, called in declaration order. */
export function matchEnum<M extends Record<string, number>, R extends string>(
  scrutinee: ReadonlyNode<ScalarKey>,
  e: EnumU32<M>,
  arms: { readonly [K in keyof M]: () => ReadonlyNode<R> },
): Node<R> {
  const keys = Object.keys(e.values) as (keyof M & string)[]
  if (keys.length === 0) throw new Error('shader-dsl: matchEnum needs at least one member')
  const last = keys[keys.length - 1]!
  const cases = keys.slice(0, -1).map((k) => [e.values[k], arms[k]()] as const)
  return matchExpr(scrutinee, cases, arms[last]())
}

// Casts
/** Convert to f32. On an f64 argument this is the explicit, precision-losing narrow, computed
 *  as the sum of the hi and lo halves; f64 never narrows implicitly. Emits `f32(x)` on WGSL and
 *  `float(x)` on GLSL. */
export const toF32 = (x: ReadonlyNode<string> | number): Node<'f32'> =>
  call('f32', f32T, x) as Node<'f32'>
/** Widen f32 to f64, exactly (the result is the pair `(x, 0.0)`). This is the explicit form
 *  of the widening the arithmetic methods apply on their own when an f32 meets an f64. */
export const toF64 = (x: ReadonlyNode<'f32'> | number): Node<'f64'> =>
  call('f64', f64T, x) as Node<'f64'>
/** Assemble an f64 from its (hi, lo) f32 halves, the shader-side counterpart of `splitF64` for
 *  a value that arrives as two f32 components (a hi/lo vertex attribute pair, a packed buffer).
 *  It costs nothing: the result is the pair `(hi, lo)` itself. The halves must be a normalized
 *  split, `lo = x − hi` as `splitF64` produces; an un-normalized pair weakens the arithmetic's
 *  error bounds. */
export const f64FromParts = (
  hi: ReadonlyNode<'f32'> | number,
  lo: ReadonlyNode<'f32'> | number,
): Node<'f64'> => call('f64FromParts', f64T, hi, lo) as Node<'f64'>
/** The (hi, lo) pair of an f64 as a plain `vec2<f32>`, for storing an f64 into a `vec2`
 *  buffer field or stage output. It costs nothing, since an emitted f64 already is its pair;
 *  `f64FromParts(v.x, v.y)` restores it. */
export const f64Parts = (x: ReadonlyNode<'f64'>): Node<'vec2<f32>'> =>
  call('f64Parts', vec2fT, x) as Node<'vec2<f32>'>
/** Convert to i32: the explicit numeric cast, where {@link i32} builds a literal from a JS
 *  number. Emits `i32(x)` on WGSL and `int(x)` on GLSL. Use it to turn a computed f32 or u32
 *  node into an integer index or scrutinee.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, toI32, f32T } from '@xgis/shader-dsl'
 *
 *  const idx = fn('idx', { u: f32T }, ({ u }) => toI32(u.mul(16)))
 *  ```
 */
export const toI32 = (x: ReadonlyNode<string> | number): Node<'i32'> =>
  call('i32', i32T, x) as Node<'i32'>
/** Convert to u32: the explicit numeric cast, where {@link u32} builds a literal from a JS
 *  number. Emits `u32(x)` on WGSL and `uint(x)` on GLSL. Use it over {@link toI32} wherever the
 *  context is unsigned, such as a buffer stride.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, toU32, f32T } from '@xgis/shader-dsl'
 *
 *  const idx = fn('idx', { anchorMode: f32T }, ({ anchorMode }) => toU32(anchorMode))
 *  ```
 */
export const toU32 = (x: ReadonlyNode<string> | number): Node<'u32'> =>
  call('u32', u32T, x) as Node<'u32'>

// Vector / struct constructors — `TypeName(arg0, arg1, …)`.
/** Low-level `TypeName(args)` constructor call, the primitive that {@link vec2}, {@link vec3},
 *  {@link vec2f64} and a struct's `.construct({...})` all build on. A bare-number argument lifts
 *  to the constructed type's element scalar. Call it directly only for a `ShaderType` those
 *  named helpers do not cover; ordinary authoring uses the typed wrapper.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { construct, vec3fT } from '@xgis/shader-dsl'
 *
 *  const v = construct(vec3fT, [1, 0, 0])  // same result as vec3(1, 0, 0)
 *  ```
 */
export const construct = <T extends ShaderType>(type: T, args: NodeLike[]): Node<KeyOf<T>> => {
  // A bare-number component lifts to the constructed type's ELEMENT scalar — so `vec4(pos, 0, 1)` emits
  // f32 components and `vec2u(0, 1)` emits u32 ones, dropping the f32()/u32() wrapper. Non-vec (struct)
  // args are typed field Nodes already, so the f32 fallback never lifts a stray number.
  const elem =
    type.kind === 'vec'
      ? type.elem
      : type.kind === 'vec64'
        ? 'f64'
        : type.kind === 'array' && type.elem.kind === 'scalar'
          ? type.elem.scalar
          : 'f32'
  const elemT = elem === 'u32' ? u32T : elem === 'i32' ? i32T : elem === 'f64' ? f64T : f32T
  return new Node<KeyOf<T>>({
    op: 'construct',
    type,
    args: args.map(
      (a) =>
        (typeof a === 'number'
          ? new Node({ op: 'lit', type: elemT, value: litNum(a, 'construct') })
          : a
        ).expr,
    ),
  })
}

/** Low-level struct member access, `base.name`, with the field type given explicitly. Shaders
 *  normally read fields through the typed getters a struct declaration provides; this is the
 *  primitive those getters build on. */
export const member = <T extends ShaderType>(
  base: ReadonlyNode,
  name: string,
  type: T,
): Node<KeyOf<T>> => new Node<KeyOf<T>>({ op: 'member', type, base: base.expr, field: name })
/** A `vec2<f32>` constructor, WGSL-style: `vec2(x, y)`. A bare number component lifts to f32,
 *  so `vec2(pos.x, 0)` emits an f32 zero with no `f32()` wrapper. {@link construct} is the
 *  untyped primitive this and every other vector and struct constructor is built on.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { vec2 } from '@xgis/shader-dsl'
 *
 *  const uv = vec2(0, 1)  // Node<'vec2<f32>'>
 *  ```
 */
export const vec2 = (...a: NodeLike[]): Node<'vec2<f32>'> =>
  construct(vec2fT, a) as Node<'vec2<f32>'>
/** A `vec3<f32>` constructor, WGSL-style: `vec3(x, y, z)`. Bare number components lift to f32.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { vec3 } from '@xgis/shader-dsl'
 *
 *  const rgb = vec3(1, 0, 0)  // Node<'vec3<f32>'>
 *  ```
 */
export const vec3 = (...a: NodeLike[]): Node<'vec3<f32>'> =>
  construct(vec3fT, a) as Node<'vec3<f32>'>
/** A `vec4<f32>` constructor, WGSL-style: `vec4(x, y, z, w)`. Bare number components lift to
 *  f32, so the common clip-space pattern `vec4(pos, 0, 1)` needs no `f32()` wrapper on the
 *  trailing arguments.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, vec2, vec4, f32T } from '@xgis/shader-dsl'
 *
 *  const clip = fn('clip', { pos: f32T }, ({ pos }) => vec4(vec2(pos, pos), 0, 1))
 *  ```
 */
export const vec4 = (...a: NodeLike[]): Node<'vec4<f32>'> =>
  construct(vec4fT, a) as Node<'vec4<f32>'>
/** A `vec2<u32>` constructor, WGSL-style: `vec2u(x, y)`. Bare number components lift to u32,
 *  where {@link vec2} lifts them to f32. For unsigned pairs such as a pick-buffer coordinate.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { vec2u } from '@xgis/shader-dsl'
 *
 *  const pick = vec2u(0, 0)  // Node<'vec2<u32>'>
 *  ```
 */
export const vec2u = (...a: NodeLike[]): Node<'vec2<u32>'> =>
  construct(vec2uT, a) as Node<'vec2<u32>'>
/** A `vec2<i32>` constructor, WGSL-style: `vec2i(x, y)`. Bare number components lift to i32,
 *  the type of the integer texel coordinate {@link textureLoad} takes
 *  (`vec2i(toI32(...), toI32(...))`).
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { vec2i, toI32, f32T, fn } from '@xgis/shader-dsl'
 *
 *  const coord = fn('coord', { u: f32T, v: f32T }, ({ u, v }) => vec2i(toI32(u), toI32(v)))
 *  ```
 */
export const vec2i = (...a: NodeLike[]): Node<'vec2<i32>'> =>
  construct(vec2iT, a) as Node<'vec2<i32>'>
// Emulated-double vector constructors. Components are f64 nodes (or bare
// numbers, split losslessly at build time); an f32 component widens exactly
// during lowering. A single argument splats, WGSL-style.
type Vec64Arg = ReadonlyNode<'f64' | 'f32'> | number
/** An emulated-double `vec2<f64>` constructor. A bare number component splits without loss
 *  into its (hi, lo) f32 pair when the module is built (a JS number already is an f64), and an
 *  f32 node component widens exactly, so mixed arguments such as `vec2f64(x64, 0)` are fine.
 *  One argument splats to both components, WGSL-style. Use it over {@link vec2} wherever the
 *  value needs more than the seven or so significant digits of f32.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { vec2f64 } from '@xgis/shader-dsl'
 *
 *  const p = vec2f64(1e8 + 0.5, 2)  // Node<'vec2<f64>'>: exact, where an f32 vec2 would round
 *  ```
 */
export const vec2f64 = (...a: Vec64Arg[]): Node<'vec2<f64>'> =>
  construct(vec2f64T, a) as Node<'vec2<f64>'>
/** An emulated-double `vec3<f64>` constructor, the three-component sibling of {@link vec2f64};
 *  that entry has the splat, split and widen rules every `vecNf64` constructor shares.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { vec3f64 } from '@xgis/shader-dsl'
 *
 *  const p = vec3f64(1e8 + 0.5, 2, 3)  // Node<'vec3<f64>'>
 *  ```
 */
export const vec3f64 = (...a: Vec64Arg[]): Node<'vec3<f64>'> =>
  construct(vec3f64T, a) as Node<'vec3<f64>'>
/** An emulated-double `vec4<f64>` constructor, the four-component sibling of {@link vec2f64};
 *  that entry has the splat, split and widen rules every `vecNf64` constructor shares.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { vec4f64 } from '@xgis/shader-dsl'
 *
 *  const p = vec4f64(1e8 + 0.5, 2, 3, 4)  // Node<'vec4<f64>'>
 *  ```
 */
export const vec4f64 = (...a: Vec64Arg[]): Node<'vec4<f64>'> =>
  construct(vec4f64T, a) as Node<'vec4<f64>'>

// Emulated-double matrix constructors — column-major, one vecN<f64> per column
// (the same convention as WGSL `matNxN(col0, …)`). They lower to a DF64MatN
// column struct; matmul / mat·vec / transpose compose the SCALAR df64 EFTs.
type Mat64Col<N extends 2 | 3 | 4> = ReadonlyNode<`vec${N}<f64>`>
/** An emulated-double `mat2x2<f64>` constructor, column-major: one `vec2<f64>` argument per
 *  column, the same convention as WGSL's `mat2x2(col0, col1)`. Use {@link transformMat64} and
 *  {@link mulMat64} for the f64 matrix-vector and matrix-matrix products; the generic `.mul`
 *  rejects a matrix operand.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { mat2f64, vec2f64 } from '@xgis/shader-dsl'
 *
 *  const m = mat2f64(vec2f64(1, 2), vec2f64(3, 4))  // Node<'mat2x2<f64>'>
 *  ```
 */
export const mat2f64 = (...cols: [Mat64Col<2>, Mat64Col<2>]): Node<'mat2x2<f64>'> =>
  construct(mat2f64T, cols) as Node<'mat2x2<f64>'>
/** An emulated-double `mat3x3<f64>` constructor, column-major, the 3×3 sibling of
 *  {@link mat2f64}; that entry has the column-argument convention and the transform helpers.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { mat3f64, vec3f64 } from '@xgis/shader-dsl'
 *
 *  const m = mat3f64(vec3f64(1, 0, 0), vec3f64(0, 1, 0), vec3f64(0, 0, 1))
 *  ```
 */
export const mat3f64 = (...cols: [Mat64Col<3>, Mat64Col<3>, Mat64Col<3>]): Node<'mat3x3<f64>'> =>
  construct(mat3f64T, cols) as Node<'mat3x3<f64>'>
/** An emulated-double `mat4x4<f64>` constructor, column-major, the 4×4 sibling of
 *  {@link mat2f64}; that entry has the column-argument convention and the transform helpers.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { mat4f64, vec4f64 } from '@xgis/shader-dsl'
 *
 *  const m = mat4f64(
 *    vec4f64(1, 0, 0, 0),
 *    vec4f64(0, 1, 0, 0),
 *    vec4f64(0, 0, 1, 0),
 *    vec4f64(0, 0, 0, 1),
 *  )
 *  ```
 */
export const mat4f64 = (
  ...cols: [Mat64Col<4>, Mat64Col<4>, Mat64Col<4>, Mat64Col<4>]
): Node<'mat4x4<f64>'> => construct(mat4f64T, cols) as Node<'mat4x4<f64>'>

/** `matNxN<f64> × vecN<f64> → vecN<f64>`: the emulated-double matrix-vector product. The
 *  generic `.mul` rejects a matrix operand; this is the f64 counterpart of
 *  {@link transformMat4}. */
export const transformMat64 = <N extends 2 | 3 | 4>(
  m: ReadonlyNode<`mat${N}x${N}<f64>`>,
  v: ReadonlyNode<`vec${N}<f64>`>,
): Node<`vec${N}<f64>`> =>
  new Node({
    op: 'binop',
    type: binResultType(m.type, v.type, '*'),
    bop: '*',
    a: m.expr,
    b: v.expr,
  }) as Node<`vec${N}<f64>`>
/** `matNxN<f64> × matNxN<f64> → matNxN<f64>`: the emulated-double matrix product. */
export const mulMat64 = <N extends 2 | 3 | 4>(
  a: ReadonlyNode<`mat${N}x${N}<f64>`>,
  b: ReadonlyNode<`mat${N}x${N}<f64>`>,
): Node<`mat${N}x${N}<f64>`> =>
  new Node({
    op: 'binop',
    type: binResultType(a.type, b.type, '*'),
    bop: '*',
    a: a.expr,
    b: b.expr,
  }) as Node<`mat${N}x${N}<f64>`>
/** Transpose of an emulated-double matrix (new column i = lane i of every old column). */
export const transpose64 = <N extends 2 | 3 | 4>(
  m: ReadonlyNode<`mat${N}x${N}<f64>`>,
): Node<`mat${N}x${N}<f64>`> => call('transpose', m.type, m) as Node<`mat${N}x${N}<f64>`>

/** `mat4x4<f32> × vec4<f32> → vec4<f32>`: the matrix-vector product, as in a
 *  model-view-projection transform. The generic `.mul` rejects a matrix operand, since a matrix
 *  is neither a scalar nor a matching vector; this is the explicit form. */
export const transformMat4 = (
  m: ReadonlyNode<'mat4x4<f32>'>,
  v: ReadonlyNode<'vec4<f32>'>,
): Node<'vec4<f32>'> =>
  new Node<'vec4<f32>'>({ op: 'binop', type: vec4fT, bop: '*', a: m.expr, b: v.expr })

/** A fixed-length array literal, `array<elemKey, N>(...)`. The result key carries the element
 *  key and the item count, so `arrayLit(f32T, a, b, c)` is `Node<'array<f32,3>'>`, the key
 *  {@link typeKey} produces for its runtime type. */
export const arrayLit = <E extends ShaderType, const I extends readonly ReadonlyNode[]>(
  elem: E,
  ...items: I
): Node<`array<${KeyOf<E>},${I['length']}>`> =>
  new Node<`array<${KeyOf<E>},${I['length']}>`>({
    op: 'construct',
    type: arrayT(elem, items.length),
    args: items.map((n) => n.expr),
  })

// ── Composite arithmetic sugar (readability killer #2) ──
// JS has no infix operators, so plain math reads as `.mul().add()` chains. These
// helpers NAME the common painful patterns. Each is a pure Node-method composition,
// so it emits BYTE-IDENTICALLY to the manual chain — readability only, zero IR change.

/** Multiply-add, `a*b + c`, written as the plain `a.mul(b).add(c)` chain. For the fused
 *  single-rounding operation use {@link fma}. */
export const madd = <K extends string>(
  a: ReadonlyNode<K>,
  b: NoInfer<ArithArg<K>>,
  c: NoInfer<ArithArg<K>>,
): Node<K> => a.mul(b).add(c)
/** Out-of-range predicate: `x < lo || x > hi`. */
export const outsideRange = (
  x: ReadonlyNode<ScalarKey>,
  lo: ReadonlyNode<ScalarKey> | number,
  hi: ReadonlyNode<ScalarKey> | number,
): Node<'bool'> => x.lt(lo).or(x.gt(hi))
/** In-range predicate: `x >= lo && x <= hi`. */
export const insideRange = (
  x: ReadonlyNode<ScalarKey>,
  lo: ReadonlyNode<ScalarKey> | number,
  hi: ReadonlyNode<ScalarKey> | number,
): Node<'bool'> => x.ge(lo).and(x.le(hi))
