import { describe, expect, it } from 'vitest'
import { packModule, packJson } from './pack.js'
import { vec4fT, vec3fT, vec2fT, f32T, structT } from '../../core/ir/types.js'
import type { ModuleDecl } from '../../core/ir/nodes.js'

const hello: ModuleDecl = {
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
    {
      name: 'Color',
      fields: [{ name: 'color', type: vec4fT, attr: '@location(0)', location: 0 }],
    },
    {
      name: 'Camera',
      fields: [{ name: 'pos', type: vec3fT }],
    },
  ],
  bindings: [{ group: 0, binding: 0, name: 'camera', space: 'uniform', type: structT('Camera') }],
  funcs: [
    {
      name: 'vs',
      params: [{ name: 'vin', type: structT('VsIn') }],
      ret: structT('Clip'),
      body: [{ s: 'return', expr: { op: 'construct', type: structT('Clip'), args: [
        { op: 'construct', type: vec4fT, args: [
          { op: 'member', type: vec3fT, base: { op: 'param', type: structT('VsIn'), name: 'vin' }, field: 'position' },
          { op: 'lit', type: f32T, value: 1 },
        ] },
      ] } }],
      stage: 'vertex',
      attrs: ['@vertex'],
    },
    {
      name: 'fs',
      params: [],
      ret: structT('Color'),
      body: [{ s: 'return', expr: { op: 'construct', type: structT('Color'), args: [
        { op: 'construct', type: vec4fT, args: [
          { op: 'lit', type: f32T, value: 1 },
          { op: 'lit', type: f32T, value: 0 },
          { op: 'lit', type: f32T, value: 0 },
          { op: 'lit', type: f32T, value: 1 },
        ] },
      ] } }],
      stage: 'fragment',
      attrs: ['@fragment'],
    },
  ],
}

describe('pack', () => {
  it('emits json-serializable wgsl + bindings + vertexLayout', () => {
    const p = packModule(hello)
    expect(p.wgsl).toMatch(/@vertex/)
    expect(p.wgsl).toMatch(/var<uniform> camera/)
    expect(p.glsl?.vertex).toMatch(/#version 300 es/)
    expect(p.bindings).toEqual([
      { name: 'camera', space: 'uniform', group: 0, binding: 0, type: 'struct:Camera' },
    ])
    expect(p.vertexLayout?.arrayStride).toBe(20)
    expect(p.entries.map((e) => e.stage).sort()).toEqual(['fragment', 'vertex'])
    expect(() => JSON.parse(packJson(hello))).not.toThrow()
  })
})
