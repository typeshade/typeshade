// Division by a constant zero (#68). Tint refuses `1.0 / 0.0` as a value f32 cannot
// represent; ANGLE warns at constant folding and picks a value. The refusal lived in one place,
// the module const collector, and its proof stopped at negation, at vector arithmetic and at
// the collector's door: every program below compiled clean on `main` before this, except the
// parameter one, which threw out of `compileTsSource`. The divisor is now folded wherever a
// division is lowered, componentwise, through the consts it names.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileTsSource } from './source-file.js'
import { TS_CODES } from './codes.js'

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`)

const ZERO = (divisor: string) =>
  `${TS_CODES.TYPE_MISMATCH} Division by zero: "${divisor}" is 0 on every invocation. WGSL refuses it and GLSL ES 3.00 leaves it undefined.`

const fs = (body: string, consts = '') => `"use typeshade"
${consts}
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  let x: f32 = uv.x
  ${body}
  return vec4(x, 0., 0., 1.)
}
`

describe('division by a constant zero (#68)', () => {
  it('1: a negated vector const with a zero component, in a module const', () => {
    const errors = errorsOf(`"use typeshade";
const A: vec3 = vec3(1., 2., 3.);
const Z: vec3 = vec3(1., 0., 1.);
const Y: vec3 = A / -Z;
@fragment
export function fs(): vec4 { return vec4(Y, 1.); }
`)
    expect(errors[0]).toBe(ZERO('-Z'))
  })

  it('2: vector arithmetic over consts, in a module const', () => {
    const errors = errorsOf(`"use typeshade";
const SIZE: vec3 = vec3(4., 0., 4.);
const STEP: vec3 = SIZE * 0.5;
const Q: vec3 = vec3(1., 2., 3.) / STEP;
@fragment
export function fs(): vec4 { return vec4(Q, 1.); }
`)
    expect(errors[0]).toBe(ZERO('STEP'))
  })

  it('3: in a function body, through a scalar const and through a vector const', () => {
    expect(errorsOf(fs('x = 1. / K', 'const K: f32 = 0.'))).toEqual([ZERO('K')])
    expect(
      errorsOf(`"use typeshade";
const Z: vec3 = vec3(1., 0., 1.);
@fragment
export function fs(): vec4 { return vec4(vec3(1., 2., 3.) / Z, 1.); }
`),
    ).toEqual([ZERO('Z')])
  })

  it('3: a compound assignment in a body', () => {
    expect(errorsOf(fs('x /= 0.'))).toEqual([ZERO('0.')])
    expect(errorsOf(fs('x %= 0.'))).toEqual([ZERO('0.')])
    expect(errorsOf(fs('x /= K * 2.', 'const K: f32 = 0.'))).toEqual([ZERO('K * 2.')])
  })

  it('a vector const with no zero component divides as it always did', () => {
    // The collector writes `cpuValue: 0` beside a vector const's `valueExpr` as a placeholder.
    // Read as a value in the function's scope, it made every division by a vector const a
    // division by zero; the initializer is what the folder reads now.
    const r = compile(`"use typeshade";
const Z: vec3 = vec3(1., 2., 4.);
@fragment
export function fs(): vec4 { return vec4(vec3(1., 2., 3.) / Z, 1.); }
`)
    expect(r.diagnostics).toEqual([])
    expect(r.eval('fs', [])).toEqual([1, 1, 0.75, 1])
  })

  it('a divisor it cannot fold passes', () => {
    expect(errorsOf(fs('x = 1. / uv.y'))).toEqual([])
    expect(errorsOf(fs('x /= uv.y * 0.'))).toEqual([])
    expect(errorsOf(fs('x = 1. / K', 'const K: f32 = 2.'))).toEqual([])
  })

  it('4: a parameter that repeats a module const is TS8023 on the parameter', () => {
    const src = `"use typeshade";
const K: f32 = 2.;
function g(K: f32): f32 { return K + 1.; }
@fragment
export function fs(): vec4 { return vec4(g(1.), 0., 0., 1.); }
`
    const errors = compileTsSource(src).diagnostics.filter((d) => d.category === 'error')
    expect(errors.map((d) => `${d.code} ${d.message}`)).toEqual([
      `${TS_CODES.DUPLICATE_SYMBOL} Parameter "K" repeats the name of a module-level declaration; rename one of them.`,
    ])
    expect(errors[0]!.start).toBe(src.indexOf('g(K') + 2)
    expect(errors[0]!.length).toBe(1)
  })
})
