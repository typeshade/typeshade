import { describe, expect, it } from 'vitest'
import { evalEntry } from './eval-entry.js'
import { vec4fT, u32T, f32T, structT } from '../../core/ir/types.js'
import type { Expr, ModuleDecl } from '../../core/ir/nodes.js'

const f = (n: number): Expr => ({ op: 'lit', type: f32T, value: n })
const v4 = (...xs: number[]): Expr => ({ op: 'construct', type: vec4fT, args: xs.map(f) })

function triangleModule(): ModuleDecl {
  return {
    consts: [],
    structs: [
      { name: 'Clip', fields: [{ name: 'pos', type: vec4fT, attr: '@builtin(position)', builtin: 'position' }] },
      { name: 'Color', fields: [{ name: 'color', type: vec4fT, attr: '@location(0)', location: 0 }] },
    ],
    bindings: [],
    funcs: [
      {
        name: 'vs',
        params: [{ name: 'i', type: u32T, builtin: 'vertex_index' }],
        ret: structT('Clip'),
        body: [{ s: 'return', expr: { op: 'construct', type: structT('Clip'), args: [v4(0, 0, 0, 1)] } }],
        stage: 'vertex',
        attrs: ['@vertex'],
      },
      {
        name: 'fs',
        params: [],
        ret: structT('Color'),
        body: [{ s: 'return', expr: { op: 'construct', type: structT('Color'), args: [v4(1, 0, 0, 1)] } }],
        stage: 'fragment',
        attrs: ['@fragment'],
      },
    ],
  }
}

describe('evalEntry', () => {
  it('runs vs on the CPU and returns clip pos', () => {
    const out = evalEntry(triangleModule(), 'vs', [0]) as { pos: number[] }
    expect(out.pos).toEqual([0, 0, 0, 1])
  })

  it('runs fs and returns red', () => {
    const out = evalEntry(triangleModule(), 'fs', []) as { color: number[] }
    expect(out.color).toEqual([1, 0, 0, 1])
  })
})
