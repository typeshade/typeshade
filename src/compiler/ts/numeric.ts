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
import { foldNumericLit, retargetIntLit } from './lit-coerce.js'

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
 *  scalar peer behaves as before). Against an emulated double — a `vec64` or, since #151, a
 *  scalar `f64` — it is {@link retargetF64Lit}. */
export function retargetLit(expr: Expr, node: ts.Expression, peer: ShaderType): Expr {
  if (isF64(peer) || isVec64(peer)) return retargetF64Lit(expr, node)
  return retargetIntLit(expr, node, literalPeerType(peer))
}

/** The emulated-double arm of {@link retargetLit}, kept apart from the integer one so the two
 *  literal kinds are separate branches of the same decision.
 *
 *  A literal that lowered to an f32 (`0.1`, `-2`, `Math.PI`, a folded `1. / 3.`) beside an f64
 *  or a `vec64` becomes an f64 literal carrying the full double, so the fp64 pass splits the
 *  value the author WROTE into its (hi, lo) halves instead of widening the f32 rounding of it
 *  as (x, 0.0). It is what `liftAgainst` in ir/node.ts does for `v.mul(0.1)` in the fn() EDSL;
 *  a SCALAR f64 peer was the half that had been left out, so `s * 2.5` on an `s: f64` was a
 *  type mismatch with nothing an author could write instead (#151 F64-02). An explicit call
 *  such as `f32(0.1)` is left alone: it says which precision it means. */
function retargetF64Lit(expr: Expr, node: ts.Expression): Expr {
  const folded = foldNumericLit(expr)
  if (folded.op !== 'lit' || typeof folded.value !== 'number') return folded
  if (typeKey(folded.type) !== 'f32') return folded
  if (ts.isCallExpression(stripParens(node))) return folded
  return { op: 'lit', type: f64T, value: folded.value }
}

const BROADCAST_OPS: ReadonlySet<BinOp> = new Set<BinOp>(['+', '-', '*', '/', '%'])

/** Result type of an arithmetic op between a scalar `f64` and a scalar `f32`: `f64`, the rule
 *  `binResultType` in src/core/ir/node.ts applies in the fn() EDSL and the one the fp64 pass
 *  is written to ("A mixed f64∘f32 operand (legal per binResultType) widens the f32 side",
 *  passes/fp64-lower.ts) — the widen is EXACT, `vec2<f32>(x, 0.0)`, so it loses nothing. The
 *  front end refused the pair outright, which left `s * t` with an f64 `s` and an f32 `t` with
 *  no spelling at all short of widening by hand (#151 F64-02). `%` has no df64 emulation and
 *  stays refused, as it is on a vec64. A vector pair is {@link broadcastResultType}'s. */
export function f64WidenResultType(
  left: ShaderType,
  right: ShaderType,
  bop: BinOp,
): ShaderType | undefined {
  if (!BROADCAST_OPS.has(bop) || bop === '%') return undefined
  if (!isF64(left) && !isF64(right)) return undefined
  const other = isF64(left) ? right : left
  return isScalar(other) && other.scalar === 'f32' ? f64T : undefined
}

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
export function lowerScalarCast(name: string, arg: Expr): Expr | string {
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
  // An emulated double has a narrow to f32 (`df64_narrow`) and no direct integer one: the
  // fp64 pass raises SD0041 for `i32()`/`u32()` on an f64, which reached the author as a
  // span-less backend failure. Said here, at the cast, with the two-step form that works.
  if ((name === 'i32' || name === 'u32') && (isF64(arg.type) || isVec64(arg.type))) {
    return (
      `${name}() has no emulated-double form, got ${typeKey(arg.type)}. A double narrows to ` +
      `f32 first, so write ${name}(f32(x)).`
    )
  }
  if (arg.op === 'lit' && typeof arg.value === 'number') {
    const v = arg.value
    if (name !== 'f32' && !Number.isFinite(v)) return `${name}() needs a finite number.`
    if (name !== 'f32') return { op: 'lit', type, value: Math.trunc(v) }
    return { op: 'lit', type: f32T, value: v }
  }
  return { op: 'call', type, fn: name, args: [arg] }
}
