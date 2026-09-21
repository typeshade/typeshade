// Scalar numeric policy: NO implicit i32 ↔ u32 ↔ f32 conversion.

import ts from 'typescript'
import type { BinOp, Expr } from '../../core/ir/nodes.js'
import type { ShaderType } from '../../core/ir/types.js'
import {
  boolT,
  f32T,
  f64T,
  i32T,
  u32T,
  isF64,
  isScalar,
  isVec,
  isVec64,
  typeKey,
} from '../../core/ir/types.js'
import { fitsTarget, foldNumericLit, retargetIntLit } from './lit-coerce.js'
import { wrapInt } from '../../core/passes/opt/expr-utils.js'

export const SCALAR_CAST: Readonly<Record<string, ShaderType>> = {
  f32: f32T,
  i32: i32T,
  u32: u32T,
  bool: boolT,
  f64: f64T,
}

export function isNumericScalarType(t: ShaderType): boolean {
  const k = typeKey(t)
  return k === 'f32' || k === 'i32' || k === 'u32'
}

/** The type a bare numeric literal should take when it meets `peer` in an arithmetic op: the
 *  element scalar of a native vector (`v * 2` with `v: vec3<u32>` types the `2` as u32), and
 *  the peer itself otherwise, so the scalar-scalar behaviour of the literal retarget is
 *  unchanged. */
export function literalPeerType(peer: ShaderType): ShaderType {
  if (isVec(peer)) return peer.elem === 'f32' ? f32T : peer.elem === 'i32' ? i32T : u32T
  return peer
}

function stripParens(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? stripParens(node.expression) : node
}

/** Retargets a bare numeric literal on one side of an arithmetic op to the kind its `peer`
 *  asks for. Against a native vector or a scalar this is {@link retargetIntLit} with the
 *  vector's element scalar as the peer (`v * 2` with `v: vec3<u32>` types the `2` as u32; a
 *  scalar peer behaves as before). Against an emulated-double vector (vec64) a literal that
 *  lowered to an f32 (`0.1`, `-2`, `Math.PI`, a folded `1. / 3.`) becomes an f64 literal
 *  carrying the full double, as liftAgainst in src/core/ir/node.ts does for `v.mul(0.1)`; the
 *  fp64 pass splits it into (hi, lo) halves, so the low half is kept instead of being widened
 *  from the f32 rounding as (x, 0.0). An explicit call such as `f32(0.1)` is left alone. */
export function retargetLit(expr: Expr, node: ts.Expression, peer: ShaderType): Expr {
  if (!isVec64(peer)) return retargetIntLit(expr, node, literalPeerType(peer))
  const folded = foldNumericLit(expr)
  if (folded.op !== 'lit' || typeof folded.value !== 'number') return folded
  if (typeKey(folded.type) !== 'f32') return folded
  if (ts.isCallExpression(stripParens(node))) return folded
  return { op: 'lit', type: f64T, value: folded.value }
}

const BROADCAST_OPS: ReadonlySet<BinOp> = new Set<BinOp>(['+', '-', '*', '/', '%'])

/** Result type of an arithmetic op (`+ - * / %`) between a vector and a scalar, or undefined
 *  when the pair does not broadcast. This follows binResultType in src/core/ir/node.ts, the
 *  rule the fn() EDSL applies (`v.mul(s)`, `s.sub(v)`), for which shapes broadcast: the result
 *  is the vector's type whichever side it is on, and an emulated-double vector (vec64) takes
 *  an f64 or f32 scalar, except under `%`, which has no f64 emulation. For a native vector it
 *  is tighter than binResultType, which accepts any scalar at runtime and leaves the element
 *  check to tsc through ArithArg: here the scalar must be the vector's own element kind, since
 *  WGSL and GLSL reject `vec3<u32> * f32`. Operand order is the caller's to keep: `s * v`
 *  stays scalar-left, which both backends emit as written and WGSL and GLSL accept. A
 *  same-type pair, a vector against a vector, and every non-arithmetic operator are not this
 *  helper's business and return undefined. */
export function broadcastResultType(
  left: ShaderType,
  right: ShaderType,
  bop: BinOp,
): ShaderType | undefined {
  if (!BROADCAST_OPS.has(bop)) return undefined
  const [vec, other] = isVec(left) || isVec64(left) ? [left, right] : [right, left]
  if (isVec(vec)) return isScalar(other) && other.scalar === vec.elem ? vec : undefined
  if (isVec64(vec)) {
    if (bop === '%') return undefined
    return isF64(other) || (isScalar(other) && other.scalar === 'f32') ? vec : undefined
  }
  return undefined
}

const VEC_CTOR_SUFFIX: Readonly<Record<string, string>> = { f32: '', i32: 'i', u32: 'u' }

export function numericMismatch(op: string, left: ShaderType, right: ShaderType): string {
  const lk = typeKey(left)
  const rk = typeKey(right)
  if (lk === rk) return `Type mismatch in ${op}: unexpected same-type mismatch.`
  const pair = `${lk} and ${rk}`
  const ints = (lk === 'i32' && rk === 'u32') || (lk === 'u32' && rk === 'i32')
  if (ints) {
    return (
      `Type mismatch: cannot ${op} ${pair} — WGSL has no implicit integer conversion. ` +
      `Cast one side: ${lk}(…) or ${rk}(…), e.g. a + ${lk === 'i32' ? 'i32' : 'u32'}(b).`
    )
  }
  if (
    (lk === 'f32' && (rk === 'i32' || rk === 'u32')) ||
    (rk === 'f32' && (lk === 'i32' || lk === 'u32'))
  ) {
    return (
      `Type mismatch: cannot ${op} ${pair} — no implicit int/float conversion. ` +
      `Cast explicitly: f32(intVal) or i32(floatVal) / u32(floatVal).`
    )
  }
  if (isVec(left) && isVec(right)) {
    if (left.n !== right.n) {
      return `Type mismatch: cannot ${op} ${pair}. Vectors must have the same size.`
    }
    // There is no element-converting vector constructor yet (#8 A8): vec3u(v) with v a
    // vec3<f32> is rejected, so the only spelling that compiles today casts per component.
    const rebuilt = `vec${left.n}${VEC_CTOR_SUFFIX[left.elem]}(${'xyzw'
      .slice(0, left.n)
      .split('')
      .map((c) => `${left.elem}(b.${c})`)
      .join(', ')})`
    const example = /^[-+*/%]$/.test(op) ? op : '+'
    return (
      `Type mismatch: cannot ${op} ${pair}. Vectors must have the same element type. ` +
      `Cast one side per component, e.g. a ${example} ${rebuilt}.`
    )
  }
  if ((op === '%' || op === '%=') && (isVec64(left) || isVec64(right))) {
    return (
      `Type mismatch: cannot ${op} ${pair}. % has no f64 emulation; ` +
      `a vec64 takes a scalar only through + - * /.`
    )
  }
  const [vec, scalar] = isVec(left) ? [left, right] : [right, left]
  if (isVec(vec) && isScalar(scalar) && scalar.scalar in VEC_CTOR_SUFFIX) {
    const splat = `vec${vec.n}${VEC_CTOR_SUFFIX[vec.elem]}(x)`
    if (scalar.scalar === vec.elem) {
      return (
        `Type mismatch: cannot ${op} ${pair}. ` +
        `A vector combines with a scalar of its element type only through + - * / %; ` +
        `splat the scalar with ${splat} to get a vector.`
      )
    }
    return (
      `Type mismatch: cannot ${op} ${pair}. A vector takes a scalar of its own element type. ` +
      `Cast the scalar: ${vec.elem}(x).`
    )
  }
  if (isScalar(left) && isScalar(right)) {
    return `Type mismatch: cannot ${op} ${pair}. Types must match, or cast with f32()/i32()/u32().`
  }
  return `Type mismatch: cannot ${op} ${pair}. Types must match.`
}

/** A scalar cast: `f32(x)`, `i32(x)`, `u32(x)`, and now `bool(x)` and `f64(x)`, the two WGSL
 *  spells that this surface had no name for. `bool` and `f64` are handled before the integer
 *  truncation below: `f64(0.1)` keeps the whole double (truncating it to 0 would be the exact
 *  precision the emulation exists to carry), and `bool(0)` is the literal `false`, not `0`. A
 *  cast of a value that already has the target type is that value — `f64(x)` with `x: f64`
 *  emits nothing, as WGSL's identity conversion does — which also keeps the fp64 pass from
 *  seeing a widen it would have to undo. `bool(x)` becomes the compare `x != 0`, which is
 *  what WGSL's bool conversion means and what all three backends already evaluate. Every
 *  other name keeps its behaviour exactly. */
export function lowerScalarCast(
  name: string,
  arg: Expr,
  constOf?: (e: Expr) => number | undefined,
): Expr | string {
  const type = SCALAR_CAST[name]
  if (!type) return `Unknown scalar cast "${name}".`
  if (name === 'bool') {
    if (typeKey(arg.type) === 'bool') return arg
    if (!isNumericScalarType(arg.type)) {
      return `bool() takes a numeric scalar, got ${typeKey(arg.type)}.`
    }
    if (arg.op === 'lit' && typeof arg.value === 'number') {
      return { op: 'lit', type: boolT, value: arg.value !== 0 }
    }
    // WGSL's `bool(x)` is "x is not zero", and that is what this lowers to: the IR has no
    // bool-cast intrinsic (the EDSL's `bool()` builds a boolean literal, not a cast), so
    // rather than add one to the core the surface spells the conversion with the compare it
    // already has. `x != 0` is the same value on all three backends and needs nothing new in
    // the CPU oracle, where an unknown `bool` call would have thrown.
    return {
      op: 'compare',
      type: boolT,
      cop: '!=',
      a: arg,
      b: { op: 'lit', type: arg.type, value: 0 },
    }
  }
  if (name === 'f64') {
    if (isF64(arg.type)) return arg
    if (arg.op === 'lit' && typeof arg.value === 'number') {
      return { op: 'lit', type: f64T, value: arg.value }
    }
    if (typeKey(arg.type) !== 'f32') {
      return `f64() widens an f32, got ${typeKey(arg.type)}. Cast to f32 first, e.g. f64(f32(x)).`
    }
    return { op: 'call', type: f64T, fn: 'f64', args: [arg] }
  }
  // `f32(vec3(...))` was accepted and emitted `f32(vec3<f32>(...))` on WGSL and `float(vec3)`
  // on GLSL. Measured: Tint REFUSES it ("no matching constructor for 'f32(vec3<f32>)'"), and a
  // WebGL2 driver COMPILES it and silently takes `.x`. So the two targets do not merely differ
  // on a corner, they disagree about whether the program exists; WGSL's conversions take a
  // scalar (wgsl.txt:20207-20209), and that is the rule this surface follows.
  // A SCALAR for this rule is a native scalar (including `bool`, which `bool(x)` handled
  // above and which `u32(b)` converts) or an emulated double — `f32(f64(x))` is the narrowing
  // the surface documents. A vector of any kind is not.
  if (arg.type.kind !== 'scalar' && arg.type.kind !== 'f64') {
    const width = arg.type.kind === 'vec' || arg.type.kind === 'vec64' ? arg.type.n : undefined
    return (
      `${name}() takes a scalar; got ${typeKey(arg.type)}.` +
      (width === undefined
        ? ''
        : ` A vector is converted component-wise by its own constructor, ` +
          `e.g. vec${width}${VEC_CTOR_SUFFIX[name] ?? ''}(v).`)
    )
  }
  // A NEGATED literal is a unop, not a lit, so `u32(-1)` used to reach the backend as
  // `u32(-1.0)`. Folded first, which is also what makes the range rule below see the number
  // the author wrote.
  const lit = foldNumericLit(arg)
  const litValue = lit.op === 'lit' && typeof lit.value === 'number' ? lit.value : undefined
  // A reference to a `const` is a compile-time value too, and by the time the backend sees it
  // the const-propagation pass has substituted it: `const k: i32 = -1; u32(k)` EMITS `u32(-1)`,
  // measured on the dev pipeline. So the range rule has to see through the reference, which is
  // what `constOf` is — the caller's scope-aware folder, since this module knows nothing about
  // scopes. Only the CHECK looks through it; the call itself is still emitted as written, so an
  // in-range `u32(k)` keeps its name and the substitution stays the optimizer's business.
  const v = litValue ?? constOf?.(arg)
  if (v !== undefined) {
    if (name !== 'f32' && !Number.isFinite(v)) return `${name}() needs a finite number.`
    if (name !== 'f32') {
      const truncated = Math.trunc(v)
      // An INT -> INT conversion is never out of range. It is a bit reinterpretation, which
      // both targets perform and agree on: measured, `u32(-1i)` compiles on Tint and is
      // 4294967295, and GLSL ES 3.00 compiles `uint(-1)` and answers 4294967295 too. What
      // Tint refuses is `u32(-1)` with no suffix, because an unsuffixed integer literal is an
      // ABSTRACT integer and an AbstractInt must fit its target — a fact about the SPELLING,
      // not about the program. The const-fold pass rewrites that spelling into the literal the
      // conversion yields (`foldIntConvert`), so the module Tint sees never contains one.
      //
      // A FLOAT operand is the case that genuinely diverges, and it is the only one refused
      // here. Measured, by running the conversion on both: WGSL clamps and GLSL ES 3.00 leaves
      // it undefined, so `u32(-1.)` is 0 on Tint and 4294967295 on a WebGL2 driver, and
      // `u32(4.3e9)` is 4294967295 there and 5032960 here. Two targets, two answers, and no
      // diagnostic anywhere — which is what this refusal is for.
      const fromInteger = typeKey(lit.type) === 'i32' || typeKey(lit.type) === 'u32'
      if (fromInteger) {
        // Folded rather than refused, and folded with the target's OWN wrap, so the front end
        // agrees with the const-fold pass instead of contradicting it.
        return litValue === undefined
          ? { op: 'call', type, fn: name, args: [arg] }
          : { op: 'lit', type, value: wrapInt(truncated, typeKey(type) === 'u32' ? 'u32' : 'i32') }
      }
      if (!fitsTarget(truncated, type)) {
        const unsigned = typeKey(type) === 'u32'
        // The clamp names the TARGET's own bounds. `clamp(x, 0., 1.)` was the example whatever
        // the cast was, which for `i32(…)` proposed clamping into [0, 1] — advice that loses
        // every value the type holds.
        const bounds = unsigned ? '0., 4294967295.' : '-2147483648., 2147483647.'
        return (
          `${name}(${String(v)}) is out of range: ${unsigned ? 'a' : 'an'} ${typeKey(type)} ` +
          `holds ${unsigned ? '0 to 4294967295' : '-2147483648 to 2147483647'}, and the two ` +
          `targets compute different values for a float that does not. Measured: u32(-1.) is ` +
          `0 on WGSL and 4294967295 on GLSL ES 3.00, and u32(4.3e9) is 4294967295 there and ` +
          `5032960 here. Clamp it first if you want one answer, e.g. ` +
          `${name}(clamp(x, ${bounds})).`
        )
      }
      if (litValue !== undefined) return { op: 'lit', type, value: truncated }
    } else if (litValue !== undefined) {
      return { op: 'lit', type: f32T, value: v }
    }
  }
  return { op: 'call', type, fn: name, args: [arg] }
}
