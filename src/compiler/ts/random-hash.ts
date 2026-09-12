// Deterministic hash-random. GPU has no Math.random.
// random(seed) → fract(sin(h) * 43758.5453) using existing IR.

import type { Expr } from '../../core/ir/nodes.js'
import type { ShaderType } from '../../core/ir/types.js'
import { f32T, vec2fT, vec3fT, typeKey } from '../../core/ir/types.js'

const HASH_SCALE = 43758.5453123
const HASH_2A = 12.9898
const HASH_2B = 78.233
const HASH_3C = 37.719

const lit = (value: number): Expr => ({ op: 'lit', type: f32T, value })
const call1 = (fn: string, type: ShaderType, a: Expr): Expr => ({
  op: 'call',
  type,
  fn,
  args: [a],
})
const mul = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: f32T, bop: '*', a, b })

function hash1(h: Expr): Expr {
  return call1('fract', f32T, mul(call1('sin', f32T, h), lit(HASH_SCALE)))
}

export function lowerRandomHash(seed: Expr): Expr | undefined {
  const k = typeKey(seed.type)
  if (k === 'f32') return hash1(seed)
  if (k === 'vec2<f32>') {
    const magic: Expr = { op: 'construct', type: vec2fT, args: [lit(HASH_2A), lit(HASH_2B)] }
    const d: Expr = { op: 'call', type: f32T, fn: 'dot', args: [seed, magic] }
    return hash1(d)
  }
  if (k === 'vec3<f32>') {
    const magic: Expr = {
      op: 'construct',
      type: vec3fT,
      args: [lit(HASH_2A), lit(HASH_2B), lit(HASH_3C)],
    }
    const d: Expr = { op: 'call', type: f32T, fn: 'dot', args: [seed, magic] }
    return hash1(d)
  }
  return undefined
}
