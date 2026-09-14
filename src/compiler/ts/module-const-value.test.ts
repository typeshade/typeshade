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
  return diagnoseFull(source).message
}

/** The first diagnostic whole, for an assertion that wants the code as well as the text. */
function diagnoseFull(source: string): { code: string | undefined; message: string } {
  const r = compileTsSource(`"use typeshade";\n${source}`)
  expect(r.diagnostics.length).toBeGreaterThan(0)
  const d = r.diagnostics[0]!
  return { code: d.code, message: d.message }
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
      'Module const "V" must be constant: a literal, a whole earlier module const, a ' +
        'constructor over those, or arithmetic over those with a non-zero divisor. It cannot ' +
        'call a function, read a resource, or take a component, field or element.',
    )
  })

  it('reports being non-constant, not being the wrong type, for a scalar', () => {
    // The two checks used to run the other way round, so `const K: f32 = sin(1.)` was told
    // "f32 is neither a foldable scalar nor a whole vector or array" — untrue of f32, and the
    // type was never the problem.
    expect(
      diagnose(`
        const K: f32 = sin(1.)
        export function f(): f32 {
          return K;
        }
      `),
    ).toContain('must be constant')
  })

  it('rejects a division by a divisor it can prove is zero', () => {
    // The scalar path gets this from foldConstNumber returning undefined for `/ 0`. This path
    // only asked whether the operands were foldable, so the whole declaration compiled clean,
    // Tint refused the WGSL, and GLSL and the CPU disagreed about the value.
    for (const src of [
      'const ZERO: f32 = 0.\nconst Y = vec3(1. / ZERO, 0., 0.)',
      'const Y = vec3(1. / 0., 0., 0.)',
      'const Y = vec3(1. % 0., 0., 0.)',
      'const A = vec3(1., 2., 3.)\nconst Y = A / vec3(1., 0., 1.)',
    ]) {
      expect(
        diagnose(`
          ${src}
          export function f(): vec3 {
            return Y;
          }
        `),
      ).toContain('non-zero divisor')
    }
    // A divisor that is merely not foldable is not proven anything, and a real one still works.
    const c = compile(`
      "use typeshade";
      const Y = vec3(1. / 4., 0., 0.)
      export function f(): vec3 {
        return Y;
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.eval('f', [])).toEqual([0.25, 0, 0])
  })

  it('rejects an array of arrays, which ANGLE will not take', () => {
    expect(
      diagnose(`
        const G: array<array<f32, 2>, 2> = array<array<f32, 2>, 2>(array<f32, 2>(1., 2.), array<f32, 2>(3., 4.))
        export function f(): f32 {
          return 1.;
        }
      `),
    ).toContain('is neither')
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
    // Asserted as the code plus the part of the sentence that identifies the name and the
    // reason. The tail ("read-only resource or const") is a hedge #18 removes — a binding and
    // a module const share one BindingKind today, so the message cannot say which — and
    // pinning it here would turn that fix red on this branch for no reason.
    const d = diagnoseFull(`
      const UP = vec3(0., 1., 0.)
      export function f(): vec3 {
        UP = vec3(1., 0., 0.);
        return UP;
      }
    `)
    expect(d.code).toBe('TS8005')
    expect(d.message).toContain('Cannot assign to "UP"')
    expect(d.message).toContain('read-only')
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
