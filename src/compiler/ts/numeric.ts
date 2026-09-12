// Scalar numeric policy: NO implicit i32 ↔ u32 ↔ f32 conversion.

import type { Expr } from '../../core/ir/nodes.js'
import type { ShaderType } from '../../core/ir/types.js'
import { f32T, i32T, u32T, typeKey } from '../../core/ir/types.js'

export const SCALAR_CAST: Readonly<Record<string, ShaderType>> = {
  f32: f32T,
  i32: i32T,
  u32: u32T,
}

export function isNumericScalarType(t: ShaderType): boolean {
  const k = typeKey(t)
  return k === 'f32' || k === 'i32' || k === 'u32'
}

export function numericMismatch(op: string, left: ShaderType, right: ShaderType): string {
  const lk = typeKey(left)
  const rk = typeKey(right)
  if (lk === rk) return `${op}: unexpected same-type mismatch.`
  const pair = `${lk} and ${rk}`
  const ints = (lk === 'i32' && rk === 'u32') || (lk === 'u32' && rk === 'i32')
  if (ints) {
    return (
      `Cannot ${op} ${pair} — WGSL has no implicit integer conversion. ` +
      `Cast one side: ${lk}(…) or ${rk}(…), e.g. a + ${lk === 'i32' ? 'i32' : 'u32'}(b).`
    )
  }
  if ((lk === 'f32' && (rk === 'i32' || rk === 'u32')) || (rk === 'f32' && (lk === 'i32' || lk === 'u32'))) {
    return (
      `Cannot ${op} ${pair} — no implicit int/float conversion. ` +
      `Cast explicitly: f32(intVal) or i32(floatVal) / u32(floatVal).`
    )
  }
  return `Cannot ${op} ${pair}. Types must match, or cast with f32()/i32()/u32().`
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
