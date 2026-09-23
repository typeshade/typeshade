// valueAndGrad: the host-side shape of grad (roadmap 0.7 item 18). One call per point returns
// the value and every requested derivative, each checked against a central difference, and the
// fitting loop a caller writes with it is the one grad.test.ts writes by hand.

import { describe, expect, it } from 'vitest'
import { compile } from '../compiler/ts/compile.js'
import { emitModule } from './backends/wgsl.js'
import { TypeShadeError } from './diagnostics/error.js'
import { valueAndGrad } from './value-and-grad.js'
import type { ModuleDecl } from './ir/nodes.js'

function moduleOf(src: string): ModuleDecl {
  const r = compile(`"use typeshade"\n${src}`)
  expect(r.diagnostics).toEqual([])
  return r.module
}

const WAVE = `export function wave(x: f32, a: f32, k: f32): f32 {
  return a * sin(k * x) * exp(-0.1 * x)
}`

describe('valueAndGrad', () => {
  it('returns the value and each partial derivative at a point', () => {
    const wave = valueAndGrad(moduleOf(WAVE), 'wave', ['a', 'k'])
    const [x, a, k] = [0.7, 1.3, 2.1]
    const { value, grad } = wave(x, a, k)
    expect(value).toBeCloseTo(a * Math.sin(k * x) * Math.exp(-0.1 * x), 12)
    expect(grad.a).toBeCloseTo(Math.sin(k * x) * Math.exp(-0.1 * x), 12)
    expect(grad.k).toBeCloseTo(a * x * Math.cos(k * x) * Math.exp(-0.1 * x), 12)
    expect(wave.names).toEqual({ a: 'wave_d_a', k: 'wave_d_k' })
  })

  it('differentiates a vector parameter along each lane: the gradient of a scalar result', () => {
    const m = moduleOf(`export function bowl(p: vec2, s: f32): f32 {
  return s * dot(p, p) + sin(p.x) * p.y
}`)
    const bowl = valueAndGrad(m, 'bowl', ['p', 's'])
    const [px, py, s] = [0.4, -1.2, 3]
    const { grad } = bowl([px, py], s)
    expect(grad.p).toHaveLength(2)
    const [gx, gy] = grad.p as number[]
    expect(gx).toBeCloseTo(2 * s * px + Math.cos(px) * py, 12)
    expect(gy).toBeCloseTo(2 * s * py + Math.sin(px), 12)
    expect(grad.s).toBeCloseTo(px * px + py * py, 12)
    expect(bowl.names.p).toEqual(['bowl_d_p_x', 'bowl_d_p_y'])
  })

  it('fits the samples back to the parameters that made them', () => {
    const wave = valueAndGrad(moduleOf(WAVE), 'wave', ['a', 'k'])
    const xs = Array.from({ length: 64 }, (_, i) => i * 0.1)
    const ys = xs.map((x) => wave(x, 1.7, 2.3).value as number)
    let a = 1
    let k = 2
    for (let step = 0; step < 1000; step++) {
      let ga = 0
      let gk = 0
      xs.forEach((x, i) => {
        const { value, grad } = wave(x, a, k)
        const r = (value as number) - ys[i]!
        ga += 2 * r * (grad.a as number)
        gk += 2 * r * (grad.k as number)
      })
      a -= 0.001 * ga
      k -= 0.001 * gk
    }
    expect(a).toBeCloseTo(1.7, 6)
    expect(k).toBeCloseTo(2.3, 6)
  })

  it('hands back the module with every derivative in it, which the GPU writers take', () => {
    const wave = valueAndGrad(moduleOf(WAVE), 'wave', ['a', 'k'])
    const wgsl = emitModule(wave.module)
    expect(wgsl).toContain('fn wave_d_a(x: f32, a: f32, k: f32) -> f32')
    expect(wgsl).toContain('fn wave_d_k(x: f32, a: f32, k: f32) -> f32')
  })

  it('refuses what grad refuses, and a parameter named twice', () => {
    const m = moduleOf(WAVE)
    const code = (thunk: () => unknown) => {
      try {
        thunk()
      } catch (e) {
        expect(e).toBeInstanceOf(TypeShadeError)
        return (e as TypeShadeError).message
      }
      throw new Error('expected a refusal')
    }
    expect(code(() => valueAndGrad(m, 'nope', ['a']))).toContain('no function "nope"')
    expect(code(() => valueAndGrad(m, 'wave', ['q' as 'a']))).toContain('no parameter "q"')
    expect(code(() => valueAndGrad(m, 'wave', ['a', 'a']))).toContain('named twice')
  })
})
