// Module-level vector and array constants in "use typeshade" (#8 A9): `const UP = vec3(0.,
// 1., 0.)`. A scalar module constant is carried by the ConstDecl wgslValue/cpuValue pair; a
// non-scalar one is carried by ConstDecl.valueExpr, the field the EDSL's constExpr fills, so
// both writers emit the expression and the CPU backend evaluates it.

import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { compile } from './compile.js'
import { typeKey } from '../../core/ir/types.js'
import type { ConstDecl } from '../../core/ir/nodes.js'

function constsOf(source: string): readonly ConstDecl[] {
  const r = compileTsSource(`"use typeshade";\n${source}`)
  expect(r.diagnostics).toEqual([])
  return r.consts
}

function diagnose(source: string): string {
  const r = compileTsSource(`"use typeshade";\n${source}`)
  expect(r.diagnostics.length).toBeGreaterThan(0)
  return r.diagnostics[0]!.message
}

describe('a vector module constant', () => {
  const SRC = `
    const UP = vec3(0., 1., 0.)
    export function f(): vec3 {
      return UP;
    }
  `

  it('is a ConstDecl carrying its value as an expression', () => {
    const [c] = constsOf(SRC)
    expect(c!.name).toBe('UP')
    expect(typeKey(c!.type)).toBe('vec3<f32>')
    expect(c!.valueExpr?.op).toBe('construct')
    if (c!.valueExpr?.op !== 'construct') return
    expect(c!.valueExpr.args.map((a) => (a.op === 'lit' ? a.value : undefined))).toEqual([0, 1, 0])
  })

  it('emits a module-scope const on both targets', () => {
    const c = compile(`"use typeshade";\n${SRC}`)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.wgsl).toContain('const UP: vec3<f32> = vec3<f32>(0.0, 1.0, 0.0);')
    expect(c.glsl?.fragment).toContain('const vec3 UP = vec3(0.0, 1.0, 0.0);')
  })

  it('reads as a constref in a function body, and evaluates', () => {
    const r = compileTsSource(`"use typeshade";\n${SRC}`)
    const stmt = r.funcs[0]!.body[0]!
    if (stmt.s !== 'return' || !stmt.expr) throw new Error('expected a return')
    expect(stmt.expr.op).toBe('constref')
    const c = compile(`"use typeshade";\n${SRC}`)
    expect(c.eval('f', [])).toEqual([0, 1, 0])
  })

  it('takes a declared type, a splat and an integer element kind', () => {
    const c = compile(`
      "use typeshade";
      const SKY: vec4 = vec4(0.4, 0.6, 0.9, 1.)
      const H = vec2(0.5)
      const N = vec3u(u32(1), u32(2), u32(3))
      export function a(): vec4 {
        return SKY;
      }
      export function b(): vec2 {
        return H;
      }
      export function c(): vec3u {
        return N;
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.wgsl).toContain('const SKY: vec4<f32> = vec4<f32>(0.4, 0.6, 0.9, 1.0);')
    expect(c.wgsl).toContain('const H: vec2<f32> = vec2<f32>(0.5, 0.5);')
    expect(c.wgsl).toContain('const N: vec3<u32> = vec3<u32>(1u, 2u, 3u);')
    expect(c.eval('a', [])).toEqual([0.4, 0.6, 0.9, 1])
    expect(c.eval('b', [])).toEqual([0.5, 0.5])
    expect(c.eval('c', [])).toEqual([1, 2, 3])
  })

  it('takes arithmetic over literals, folded by the writers', () => {
    const c = compile(`
      "use typeshade";
      const V = vec3(1. / 3., -2., 0.5 * 4.)
      export function f(): vec3 {
        return V;
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.wgsl).toContain('const V: vec3<f32> = vec3<f32>((1.0 / 3.0), (-2.0), (0.5 * 4.0));')
    expect(c.eval('f', [])).toEqual([1 / 3, -2, 2])
  })

  it('takes an earlier module const as a component', () => {
    const c = compile(`
      "use typeshade";
      const K: f32 = 2.
      const V = vec3(K, K, K)
      export function f(): vec3 {
        return V;
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.wgsl).toContain('const V: vec3<f32> = vec3<f32>(K, K, K);')
    expect(c.eval('f', [])).toEqual([2, 2, 2])
  })

  it('can be used in arithmetic like any other value', () => {
    const c = compile(`
      "use typeshade";
      const SKY: vec4 = vec4(0.4, 0.6, 0.9, 1.)
      export function f(): vec4 {
        return SKY * 2.;
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.eval('f', [])).toEqual([0.8, 1.2, 1.8, 2])
  })
})

describe('an array module constant', () => {
  it('emits and indexes on both targets', () => {
    const c = compile(`
      "use typeshade";
      const XS: array<f32, 3> = array<f32, 3>(1., 2., 3.)
      export function f(i: i32): f32 {
        return XS[i];
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.wgsl).toContain('const XS: array<f32, 3> = array<f32, 3>(1.0, 2.0, 3.0);')
    expect(c.glsl?.fragment).toContain('const float[3] XS = float[3](1.0, 2.0, 3.0);')
    expect(c.eval('f', [1])).toBe(2)
  })

  it('holds vectors', () => {
    const c = compile(`
      "use typeshade";
      const PAL = array<vec4, 2>(vec4(1., 0., 0., 1.), vec4(0., 1., 0., 1.))
      export function f(i: i32): vec4 {
        return PAL[i];
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.eval('f', [1])).toEqual([0, 1, 0, 1])
  })

  it('reports its length, so it can bound a loop', () => {
    const c = compile(`
      "use typeshade";
      const XS = array<f32, 4>(1., 2., 3., 4.)
      export function f(): f32 {
        let acc = 0.;
        for (let i: i32 = 0; i < XS.length; i++) {
          acc += XS[i];
        }
        return acc;
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.eval('f', [])).toBe(10)
  })
})

describe('what a module constant still is not', () => {
  it('rejects a value that is not constant', () => {
    expect(
      diagnose(`
        const V = vec3(sin(1.), 0., 0.)
        export function f(): vec3 {
          return V;
        }
      `),
    ).toBe(
      'Module const "V" must be constant: a literal, a constructor over literals, arithmetic ' +
        'over those, or an earlier module const. It cannot call a function or read a resource.',
    )
  })

  it('rejects a declared type its value does not have', () => {
    expect(
      diagnose(`
        const V: vec4 = vec3(0., 1., 0.)
        export function f(): vec4 {
          return V;
        }
      `),
    ).toBe('Module const "V" is declared vec4<f32> but its value is vec3<f32>.')
  })

  it('rejects a write to it', () => {
    expect(
      diagnose(`
        const UP = vec3(0., 1., 0.)
        export function f(): vec3 {
          UP = vec3(1., 0., 0.);
          return UP;
        }
      `),
    ).toBe('Cannot assign to "UP" — it is read-only resource or const.')
  })

  it('leaves a scalar module const exactly as it was', () => {
    const cs = constsOf(`
      const PI2: f32 = 6.28318
      const N: i32 = 4
      export function f(): f32 {
        return PI2 + f32(N);
      }
    `)
    expect(cs).toEqual([
      { name: 'PI2', type: expect.anything(), wgslValue: 6.28318, cpuValue: 6.28318 },
      { name: 'N', type: expect.anything(), wgslValue: 4, cpuValue: 4 },
    ])
    expect(cs.every((c) => c.valueExpr === undefined)).toBe(true)
  })
})
