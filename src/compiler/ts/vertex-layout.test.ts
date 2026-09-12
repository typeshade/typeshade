import { describe, expect, it } from 'vitest'
import { vertexLayoutOf } from './vertex-layout.js'
import { vec3fT, vec2fT, vec4fT, u32T, structT } from '../../core/ir/types.js'
import type { ModuleDecl } from '../../core/ir/nodes.js'

describe('vertexLayout', () => {
  it('flattens VsIn @location fields into a tight GPU layout', () => {
    const m: ModuleDecl = {
      consts: [],
      structs: [
        {
          name: 'VsIn',
          fields: [
            { name: 'position', type: vec3fT, attr: '@location(0)', location: 0 },
            { name: 'uv', type: vec2fT, attr: '@location(1)', location: 1 },
          ],
        },
        {
          name: 'Clip',
          fields: [{ name: 'pos', type: vec4fT, attr: '@builtin(position)', builtin: 'position' }],
        },
      ],
      bindings: [],
      funcs: [
        {
          name: 'vs',
          params: [{ name: 'vin', type: structT('VsIn') }],
          ret: structT('Clip'),
          body: [],
          stage: 'vertex',
          attrs: ['@vertex'],
        },
      ],
    }
    const layout = vertexLayoutOf(m)
    expect(layout).toEqual({
      arrayStride: 20,
      attributes: [
        { name: 'position', location: 0, offset: 0, format: 'float32x3', type: 'vec3<f32>' },
        { name: 'uv', location: 1, offset: 12, format: 'float32x2', type: 'vec2<f32>' },
      ],
    })
  })

  it('skips @builtin vertex_index', () => {
    const m: ModuleDecl = {
      consts: [],
      structs: [],
      bindings: [],
      funcs: [
        {
          name: 'vs',
          params: [{ name: 'i', type: u32T, builtin: 'vertex_index' }],
          ret: vec4fT,
          body: [],
          stage: 'vertex',
          attrs: ['@vertex'],
        },
      ],
    }
    expect(vertexLayoutOf(m)).toBeUndefined()
  })
})
