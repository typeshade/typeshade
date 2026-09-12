// Expansions for Math.* names that are not 1:1 WGSL builtins.

import type { Expr } from '../../core/ir/nodes.js'
import type { ShaderType } from '../../core/ir/types.js'
import { f32T, vec2fT, vec3fT } from '../../core/ir/types.js'
import { typeKey } from '../../core/ir/types.js'

const lit = (value: number): Expr => ({ op: 'lit', type: f32T, value })
const call = (fn: string, type: ShaderType, args: readonly Expr[]): Expr => ({
  op: 'call',
  type,
  fn,
  args,
})
const bin = (bop: '+' | '-' | '*' | '/', a: Expr, b: Expr): Expr => ({
  op: 'binop',
  type: a.type,
  bop,
  a,
  b,
})

export type ExpandId = 'log10' | 'log1p' | 'expm1' | 'cbrt' | 'hypot'

export function expandMath(id: ExpandId, args: readonly Expr[]): Expr | string {
  if (id === 'hypot') {
    if (args.length < 2 || args.length > 3) return 'hypot expects 2 or 3 arguments.'
    for (const a of args) {
      if (typeKey(a.type) !== 'f32') return `hypot arguments must be f32, got ${typeKey(a.type)}.`
    }
    const ctorType = args.length === 2 ? vec2fT : vec3fT
    const vec: Expr = { op: 'construct', type: ctorType, args: [...args] }
    return call('length', f32T, [vec])
  }
  if (args.length !== 1) return `${id} expects 1 argument.`
  const x = args[0]!
  if (typeKey(x.type) !== 'f32') return `${id} expects f32, got ${typeKey(x.type)}.`
  switch (id) {
    case 'log10':
      return bin('*', call('log', f32T, [x]), lit(Math.LOG10E))
    case 'log1p':
      return call('log', f32T, [bin('+', x, lit(1))])
    case 'expm1':
      return bin('-', call('exp', f32T, [x]), lit(1))
    case 'cbrt':
      return call('pow', f32T, [x, lit(1 / 3)])
  }
}
