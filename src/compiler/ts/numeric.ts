// Scalar numeric policy: NO implicit i32 ↔ u32 ↔ f32 conversion.

import ts from 'typescript'
import type { BinOp, Expr } from '../../core/ir/nodes.js'
import type { ShaderType } from '../../core/ir/types.js'
import {
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
 *  when the pair does not broadcast. This mirrors binResultType in src/core/ir/node.ts, the
 *  rule the fn() EDSL applies (`v.mul(s)`, `s.sub(v)`): a native vector takes a scalar of its
 *  own element kind and the result is the vector's type whichever side it is on, and an
 *  emulated-double vector (vec64) takes an f64 or f32 scalar, except under `%`, which has no
 *  f64 emulation. Operand order is the caller's to keep: `s * v` stays scalar-left, which
 *  both backends emit as written and WGSL and GLSL accept. A same-type pair, a vector against
 *  a vector, and every non-arithmetic operator are not this helper's business and return
 *  undefined. */
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
    const toLeft = `vec${left.n}${VEC_CTOR_SUFFIX[left.elem]}(…)`
    const toRight = `vec${right.n}${VEC_CTOR_SUFFIX[right.elem]}(…)`
    return (
      `Type mismatch: cannot ${op} ${pair}. Vectors must have the same element type. ` +
      `Convert one side: ${toLeft} or ${toRight}, e.g. a + ${toLeft}.`
    )
  }
  const [vec, scalar] = isVec(left) ? [left, right] : [right, left]
  if (isVec(vec) && isScalar(scalar) && scalar.scalar in VEC_CTOR_SUFFIX) {
    if (scalar.scalar === vec.elem) {
      return (
        `Type mismatch: cannot ${op} ${pair}. ` +
        `A vector combines with a scalar of its element type only through + - * / %.`
      )
    }
    const ctor = `vec${vec.n}${VEC_CTOR_SUFFIX[scalar.scalar]}(…)`
    return (
      `Type mismatch: cannot ${op} ${pair}. A vector takes a scalar of its own element type. ` +
      `Cast the scalar: ${vec.elem}(x), or convert the vector: ${ctor}.`
    )
  }
  if (isScalar(left) && isScalar(right)) {
    return `Type mismatch: cannot ${op} ${pair}. Types must match, or cast with f32()/i32()/u32().`
  }
  return `Type mismatch: cannot ${op} ${pair}. Types must match.`
}

export function lowerScalarCast(name: string, arg: Expr): Expr | string {
  const type = SCALAR_CAST[name]
  if (!type) return `Unknown scalar cast "${name}".`
  if (arg.op === 'lit' && typeof arg.value === 'number') {
    const v = arg.value
    if (name !== 'f32' && !Number.isFinite(v)) return `${name}() needs a finite number.`
    if (name !== 'f32') return { op: 'lit', type, value: Math.trunc(v) }
    return { op: 'lit', type: f32T, value: v }
  }
  return { op: 'call', type, fn: name, args: [arg] }
}
