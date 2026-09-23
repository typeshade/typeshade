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
      const SKY: vec4 = vec4(0.4, 0.6, 0.9, 1.);
      const H = vec2(0.5);
      const N = vec3u(u32(1), u32(2), u32(3));
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
      const V = vec3(1. / 3., -2., 0.5 * 4.);
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
      const K: f32 = 2.;
      const V = vec3(K, K, K);
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
      const SKY: vec4 = vec4(0.4, 0.6, 0.9, 1.);
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
      const XS: array<f32, 3> = array<f32, 3>(1., 2., 3.);
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
      const PAL = array<vec4, 2>(vec4(1., 0., 0., 1.), vec4(0., 1., 0., 1.));
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
      const XS = array<f32, 4>(1., 2., 3., 4.);
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
    // A derivative is the one builtin a constant may not call: it has no value outside a
    // fragment invocation. (`sin(1.)` in that position is a constant since issue #73.)
    expect(
      diagnose(`
        const V = vec3(fwidth(1.), 0., 0.)
        export function f(): vec3 {
          return V;
        }
      `),
    ).toBe(
      'Module const "V" must be constant: a literal, a whole earlier module const, a ' +
        'constructor over those, or arithmetic over those with a non-zero divisor. It may ' +
        'call a math builtin over those, but not a declared function or a derivative, and it ' +
        'cannot read a resource or take a component, field or element.',
    )
  })

  it('reports being non-constant, not being the wrong type, for a scalar', () => {
    // The two checks used to run the other way round, so a scalar with a non-constant value
    // was told "f32 is neither a foldable scalar nor a whole vector or array" — untrue of f32,
    // and the type was never the problem.
    expect(
      diagnose(`
        const K: f32 = dpdx(1.)
        export function f(): f32 {
          return K;
        }
      `),
    ).toContain('must be constant')
  })

  it('rejects a division by a divisor it can prove is zero', () => {
    // The scalar path gets this from foldConstNumber returning undefined for `/ 0`. This path
    // only asked whether the operands were foldable, so the whole declaration compiled clean,
    // Tint refused the WGSL, and GLSL and the CPU disagreed about the value. Since #68 the
    // division itself is refused where it is lowered, so the sentence names the divisor.
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
      ).toContain('Division by zero')
    }
    // A divisor that is merely not foldable is not proven anything, and a real one still works.
    const c = compile(`
      "use typeshade";
      const Y = vec3(1. / 4., 0., 0.);
      export function f(): vec3 {
        return Y;
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.eval('f', [])).toEqual([0.25, 0, 0])
  })

  it('follows a reference to an earlier VECTOR const to find the zero', () => {
    // The hole the first zero-divisor fix left, and of the same shape: a non-scalar const's
    // value lives in `valueExpr` and its binding carries no constValue, so `foldConstNumber`
    // on a reference to one answered undefined and the divisor looked unprovable. Every one of
    // these compiled clean and Tint refused the WGSL.
    for (const src of [
      'const Z = vec3(1., 0., 1.)\nconst A = vec3(1., 2., 3.)\nconst Y = A / Z',
      'const Z = vec3(1., 0., 1.)\nconst A = vec3(1., 2., 3.)\nconst Y = A % Z',
      'const Z = vec3(1., 0., 1.)\nconst W = Z\nconst A = vec3(1., 2., 3.)\nconst Y = A / W',
      'const Z = vec3(1., 0., 1.)\nconst W = Z\nconst V = W\nconst A = vec3(1., 2., 3.)\nconst Y = A / V',
    ]) {
      expect(
        diagnose(`
          ${src}
          export function f(): vec3 {
            return Y;
          }
        `),
      ).toContain('Division by zero')
    }
    // …and a reference whose components are all non-zero still divides, through a hop as well.
    for (const src of [
      'const Z = vec3(1., 2., 1.)\nconst A = vec3(2., 4., 6.)\nconst Y = A / Z',
      'const Z = vec3(1., 2., 1.)\nconst W = Z\nconst A = vec3(2., 4., 6.)\nconst Y = A / W',
    ]) {
      const ok = compile(`
        "use typeshade";
        ${src}
        export function f(): vec3 {
          return Y;
        }
      `)
      expect(ok.diagnostics.filter((d) => d.category === 'error')).toEqual([])
      expect(ok.eval('f', [])).toEqual([2, 2, 6])
    }
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
    // reason. The tail was a hedge ("read-only resource or const") while a binding and a
    // module const shared one BindingKind; #18 has since given a binding its own, and the
    // message now says WHICH — asserted here, since that is the wording a reader will see.
    const d = diagnoseFull(`
      const UP = vec3(0., 1., 0.)
      export function f(): vec3 {
        UP = vec3(1., 0., 0.);
        return UP;
      }
    `)
    expect(d.code).toBe('TS8005')
    expect(d.message).toContain('Cannot assign to "UP"')
    expect(d.message).toContain('a module const')
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

// Issue #73 — a module constant may call a math builtin over constant operands. The call is
// emitted as written, so the GPU computes it (a builtin call over constants is a constant
// expression in WGSL and in GLSL ES 3.00), while the front end knows the value.
describe('a module constant that calls a math builtin', () => {
  const SRC = `const K: f32 = sin(1.)
const HALF: f32 = sin(1.) * 0.5 + cos(0.)
const N: i32 = max(i32(4), 8)
const UP: vec3 = normalize(vec3(1., 1., 0.))
export function f(): f32 {
  let acc = 0.
  for (let i: i32 = 0; i < N; i++) {
    acc += 1.
  }
  return acc + K + HALF + UP.x
}`

  it('carries the call as its expression, on every kind of constant', () => {
    const consts = constsOf(SRC)
    expect(consts.map((c) => c.name)).toEqual(['K', 'HALF', 'N', 'UP'])
    for (const c of consts) expect(c.valueExpr).toBeDefined()
    expect(consts[0]!.valueExpr).toMatchObject({ op: 'call', fn: 'sin' })
  })

  it('emits the call on both targets, and the GPU computes it', () => {
    const r = compile(`"use typeshade";\n${SRC}`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('const K: f32 = sin(1.0);')
    expect(r.wgsl).toContain('const HALF: f32 = ((sin(1.0) * 0.5) + cos(0.0));')
    expect(r.wgsl).toContain('const N: i32 = max(4, 8);')
    expect(r.wgsl).toContain('const UP: vec3<f32> = normalize(vec3<f32>(1.0, 1.0, 0.0));')
    expect(r.glsl?.fragment ?? r.glsl?.vertex ?? '').toContain('const float K = sin(1.0);')
  })

  it('knows the value, so an integer one bounds a loop and the oracle agrees', () => {
    const r = compile(`"use typeshade";\n${SRC}`)
    const v = r.eval('f') as number
    expect(v).toBeCloseTo(8 + Math.sin(1) + (Math.sin(1) * 0.5 + 1) + Math.SQRT1_2, 10)
  })

  it("needs the annotation to agree with the call's type", () => {
    expect(diagnose('const K: i32 = floor(2.7)\nexport function f(): i32 { return K }')).toBe(
      'Module const "K" is i32, but its initializer is f32. Cast it, e.g. i32(...), or change the annotation.',
    )
  })

  it('still refuses a derivative, which has no value outside a fragment', () => {
    expect(diagnose('const K: f32 = fwidth(1.)\nexport function f(): f32 { return K }')).toContain(
      'It may call a math builtin over those, but not a declared function or a derivative',
    )
  })

  it('does not fold a transcendental into a JavaScript value', () => {
    // sin(1.0) stays a call in the emit; only the front end's own copy of the value is folded.
    const r = compile(
      '"use typeshade";\nconst K: f32 = sin(1.)\nexport function f(): f32 { return K }',
    )
    expect(r.wgsl).not.toContain('0.8414709848078965')
    expect(r.wgsl).toContain('sin(1.0)')
  })
})
