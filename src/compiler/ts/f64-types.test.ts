import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { compile } from './compile.js'

describe('f64 surface', () => {
  it('accepts f64 and vec3<f64>', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function add(a: vec3<f64>, b: vec3d): vec3<f64> {
        return a;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })

  it('accepts mat4<f64> * vec4<f64>', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function xform(m: mat4<f64>, p: vec4<f64>): vec4<f64> {
        return m * p;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })
})

// ═══ P1-42, P1-43 and P1-44 of #155 — the f64 surface, from source ═══
//
// The emulated double is a double `f32` pair rewritten by `passes/fp64-lower.ts`, and that
// pass keeps two whitelists: the builtins that have a `df64_*` twin and, by omission, the ones
// that do not. The second list is the contract users hit — call `pow` on an `f64` and the
// program does not emit — and it was pinned at IR level for four codes only. From SOURCE,
// which is how an author meets it, almost nothing was pinned: the audit counted 20 of ~143
// f64 tests starting from `"use typeshade"`, none of them a builtin twin.
//
// Every row below was measured on this tree on 2026-09-21; the ones that do not hold yet are
// `it.fails` naming #151 (the f64 surface issue), so the lane that closes them flips the row.
describe('the f64 builtins, from source, against the double the oracle computes', () => {
  const scalar = (id: string, arity: number): string => {
    const params = ['x', 'y', 'z'].slice(0, arity)
    return `"use typeshade"
export function f(${params.map((p) => `${p}: f64`).join(', ')}): f64 {
  return ${id}(${params.join(', ')})
}
`
  }

  const errorsOf = (src: string): string[] =>
    compileTsSource(src)
      .diagnostics.filter((d) => d.category === 'error')
      .map((d) => d.message)

  /** Twin, arity, arguments, and the double JavaScript computes for them. The expectation is
   *  the IEEE double, not a re-derivation: the whole point of the emulated pair is that the
   *  GPU agrees with the host to more than f32's seven digits. */
  const TWINS: readonly (readonly [string, number, number[], number])[] = [
    ['sqrt', 1, [2], Math.SQRT2],
    ['abs', 1, [-2.5], 2.5],
    ['floor', 1, [2.5], 2],
    ['fract', 1, [2.25], 0.25],
    ['sin', 1, [2], Math.sin(2)],
    ['cos', 1, [2], Math.cos(2)],
    ['min', 2, [2, 3], 2],
    ['max', 2, [2, 3], 3],
  ]

  it.each(TWINS)(
    'lowers `%s` on an f64 to its df64 twin, and the CPU agrees to a double',
    (id, arity, args, want) => {
      const result = compile(scalar(id, arity))
      expect(
        result.diagnostics.filter((d) => d.category === 'error').map((d) => d.message),
      ).toEqual([])
      expect(result.wgsl ?? '').toContain(`df64_${id}(`)
      // 15 digits: an f32 pair carries about 2×24 bits of mantissa, so a twin that silently
      // fell back to single precision would miss this by orders of magnitude.
      expect(result.eval('f', args)).toBeCloseTo(want, 15)
    },
  )

  it.fails(
    'lowers `mix` on f64 scalars, which the pass table claims a twin for — flipped by #151',
    () => {
      // `fp64-lower.ts`'s `CALL_FN` has `mix: 'df64_mix'`, and a three-argument `mix` written in
      // source still reaches the backend unrewritten: SD0041 at emit. A twin the surface cannot
      // reach is the same gap as a twin that does not exist.
      expect(errorsOf(scalar('mix', 3))).toEqual([])
    },
  )

  /** The builtins with NO twin. Each is a program that compiles through the front end and
   *  fails at emit, which is the refusal an author meets. */
  const NO_TWIN: readonly (readonly [string, number])[] = [
    ['ceil', 1],
    ['trunc', 1],
    ['round', 1],
    ['sign', 1],
    ['exp', 1],
    ['log', 1],
    ['tan', 1],
    ['pow', 2],
    ['atan2', 2],
    ['clamp', 3],
  ]

  it.each(NO_TWIN)(
    'refuses `%s` on an f64 with SD0041, naming the unsupported operation',
    (id, arity) => {
      const errors = errorsOf(scalar(id, arity))
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('SD0041')
    },
  )

  it('refuses `%` on two f64 operands, with the same code', () => {
    const errors = errorsOf(`"use typeshade"
export function f(x: f64, y: f64): f64 {
  return x % y
}
`)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('SD0041')
  })

  it('names the call and lists the twins that DO exist, which is the useful half', () => {
    const errors = errorsOf(scalar('pow', 2))
    expect(errors[0]).toMatch(/\bpow\(\) on f64 operands/)
    expect(errors[0]).toMatch(/only \+ - \* \/ compare, abs, min, max, sqrt, mix, floor, fract/)
  })

  it.fails('points at the CALL rather than at the module — flipped by #151', () => {
    // The text is right and the SPAN is not: every row above arrives as `TS8015 Backend emit
    // failed` at 1:1, so an editor underlines the directive instead of `pow(x, y)`.
    const diagnostics = compileTsSource(scalar('pow', 2)).diagnostics.filter(
      (d) => d.category === 'error',
    )
    expect(diagnostics[0]?.line).toBe(3)
  })
})

// BLOCKER F64-01 of the audit: `length`, `distance` and `dot` on a `vec64` are typed `f32` by
// the front end (`lower/expression-misc.ts`'s `mathResultType`) while the EDSL types them `f64`
// and `fp64-lower.ts` emits the pair. The symptom is a return-type mismatch on a program that
// is correct, which is the worst shape: the diagnostic blames the author's declaration.
describe('the reductions of a vec64 carry the f64 they compute (F64-01)', () => {
  const reduce = (body: string, params: string): string => `"use typeshade"
export function f(${params}): f64 {
  return ${body}
}
`

  it('types them f32 today, which is what makes the correct program fail', () => {
    for (const [body, params] of [
      ['length(v)', 'v: vec3<f64>'],
      ['dot(a, b)', 'a: vec3<f64>, b: vec3<f64>'],
      ['distance(a, b)', 'a: vec3<f64>, b: vec3<f64>'],
    ] as const) {
      const errors = compileTsSource(reduce(body, params))
        .diagnostics.filter((d) => d.category === 'error')
        .map((d) => d.message)
      expect(errors.join(' | '), body).toMatch(/declared f64, got f32/)
    }
  })

  it.fails('types length(vec64) as f64 — flipped by #151', () => {
    expect(
      compileTsSource(reduce('length(v)', 'v: vec3<f64>')).diagnostics.filter(
        (d) => d.category === 'error',
      ),
    ).toEqual([])
  })

  it.fails('types dot(vec64, vec64) as f64 — flipped by #151', () => {
    expect(
      compileTsSource(reduce('dot(a, b)', 'a: vec3<f64>, b: vec3<f64>')).diagnostics.filter(
        (d) => d.category === 'error',
      ),
    ).toEqual([])
  })
})

// P1-44: an `f64` in a slot the spec types `f32`. The pass has no lowering for it, so the
// program does not emit — which is the right answer, reached the wrong way.
describe('an f64 in an f32-typed slot of a texture call', () => {
  const LEVEL = `"use typeshade"
declare const t: texture_2d<f32>
declare const smp: sampler
class V {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}
@fragment
export function fs(v: V): vec4 {
  const l: f64 = f64(1.)
  return textureSampleLevel(t, smp, v.uv, l)
}
`

  it('does not emit, so no Tint-invalid module leaves the compiler', () => {
    const errors = compileTsSource(LEVEL)
      .diagnostics.filter((d) => d.category === 'error')
      .map((d) => d.message)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('SD0041')
  })

  it.fails('names the call and the fix f32(x), at the call span — flipped by #145 / #151', () => {
    const errors = compileTsSource(LEVEL)
      .diagnostics.filter((d) => d.category === 'error')
      .map((d) => d.message)
    expect(errors[0]).toMatch(/f32\(/)
  })
})
