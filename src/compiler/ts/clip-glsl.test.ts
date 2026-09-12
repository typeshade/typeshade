import { describe, expect, it } from 'vitest'
import { emitGlslStages } from '../../core/backends/glsl.js'
import { vec4fT, u32T, f32T, structT } from '../../core/ir/types.js'
import type { Expr, ModuleDecl } from '../../core/ir/nodes.js'

const f = (n: number): Expr => ({ op: 'lit', type: f32T, value: n })
const v4 = (...xs: number[]): Expr => ({ op: 'construct', type: vec4fT, args: xs.map(f) })

describe('Clip / Color GLSL ES 3.00', () => {
  it('emits vertex and fragment from the same IR as WGSL', () => {
    const clip = {
      name: 'Clip',
      fields: [{ name: 'pos', type: vec4fT, attr: '@builtin(position)', builtin: 'position' }],
    }
    const color = {
      name: 'Color',
      fields: [{ name: 'color', type: vec4fT, attr: '@location(0)', location: 0 }],
    }
    const m: ModuleDecl = {
      consts: [],
      structs: [clip, color],
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
    const { vertex, fragment } = emitGlslStages(m)
    expect(vertex).toMatch(/#version 300 es/)
    expect(fragment).toMatch(/#version 300 es/)
    expect(vertex).toMatch(/gl_Position/)
    expect(fragment).toMatch(/out /)
  })
})
