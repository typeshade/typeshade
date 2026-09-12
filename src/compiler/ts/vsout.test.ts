import { describe, expect, it } from 'vitest'
import { emitModule } from '../../core/backends/wgsl.js'
import { emitGlslStages } from '../../core/backends/glsl.js'
import { compileModule } from '../../core/oracle.js'
import { vec4fT, vec2fT, u32T, f32T, boolT, structT } from '../../core/ir/types.js'
import type { Expr, ModuleDecl } from '../../core/ir/nodes.js'

const f = (n: number): Expr => ({ op: 'lit', type: f32T, value: n })
const u = (n: number): Expr => ({ op: 'lit', type: u32T, value: n })
const eq = (i: Expr, n: number): Expr => ({ op: 'compare', type: boolT, cop: '==', a: i, b: u(n) })
const sel = (iff: Expr, ift: Expr, cond: Expr): Expr => ({ op: 'select', type: f32T, cond, ifTrue: ift, ifFalse: iff })

function vsoutModule(): ModuleDecl {
  const i: Expr = { op: 'param', type: u32T, name: 'i' }
  const x = sel(sel(f(-0.8), f(0.8), eq(i, 1)), f(0), eq(i, 2))
  const y = sel(f(-0.8), f(0.8), eq(i, 2))
  const u0 = sel(sel(f(0), f(1), eq(i, 1)), f(0.5), eq(i, 2))
  const v0 = sel(f(0), f(1), eq(i, 2))
  const vParam: Expr = { op: 'param', type: structT('VsOut'), name: 'v' }
  return {
    consts: [],
    structs: [
      {
        name: 'VsOut',
        fields: [
          { name: 'pos', type: vec4fT, attr: '@builtin(position)', builtin: 'position' },
          { name: 'uv', type: vec2fT, attr: '@location(0)', location: 0 },
        ],
      },
      {
        name: 'Color',
        fields: [{ name: 'color', type: vec4fT, attr: '@location(0)', location: 0 }],
      },
    ],
    bindings: [],
    funcs: [
      {
        name: 'vs',
        params: [{ name: 'i', type: u32T, builtin: 'vertex_index' }],
        ret: structT('VsOut'),
        body: [{
          s: 'return',
          expr: {
            op: 'construct',
            type: structT('VsOut'),
            args: [
              { op: 'construct', type: vec4fT, args: [x, y, f(0), f(1)] },
              { op: 'construct', type: vec2fT, args: [u0, v0] },
            ],
          },
        }],
        stage: 'vertex',
        attrs: ['@vertex'],
      },
      {
        name: 'fs',
        params: [{ name: 'v', type: structT('VsOut') }],
        ret: structT('Color'),
        body: [{
          s: 'return',
          expr: {
            op: 'construct',
            type: structT('Color'),
            args: [{
              op: 'construct',
              type: vec4fT,
              args: [
                { op: 'member', type: f32T, base: { op: 'member', type: vec2fT, base: vParam, field: 'uv' }, field: 'x' },
                { op: 'member', type: f32T, base: { op: 'member', type: vec2fT, base: vParam, field: 'uv' }, field: 'y' },
                f(0.2),
                f(1),
              ],
            }],
          },
        }],
        stage: 'fragment',
        attrs: ['@fragment'],
      },
    ],
  }
}

describe('VsOut interpolate', () => {
  it('emits shared struct IO and evals vertex uv', () => {
    const m = vsoutModule()
    const wgsl = emitModule(m)
    expect(wgsl).toMatch(/struct VsOut/)
    expect(wgsl).toMatch(/@location\(0\) uv/)
    expect(wgsl).toMatch(/fn fs\(/)
    const { vertex, fragment } = emitGlslStages(m)
    expect(vertex).toMatch(/out vec2 uv/)
    expect(fragment).toMatch(/in vec2 uv/)
    const cpu = compileModule(m)
    const p0 = cpu.fns.vs!(0) as { pos: number[]; uv: number[] }
    const p1 = cpu.fns.vs!(1) as { pos: number[]; uv: number[] }
    const p2 = cpu.fns.vs!(2) as { pos: number[]; uv: number[] }
    expect(p0.uv).toEqual([0, 0])
    expect(p1.uv).toEqual([1, 0])
    expect(p2.uv).toEqual([0.5, 1])
    const redish = cpu.fns.fs!({ pos: p0.pos, uv: p0.uv }) as { color: number[] }
    expect(redish.color[0]).toBe(0)
    expect(redish.color[1]).toBe(0)
  })
})
