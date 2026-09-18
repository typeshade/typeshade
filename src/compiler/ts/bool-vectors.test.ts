// Boolean vectors (roadmap 0.2 item 7, §27): a comparison of two vectors is componentwise and
// yields `vecN<bool>`, which `any`, `all`, a per-component `select` and `!` take, and which
// `vec2b`/`vec3b`/`vec4b` name and construct. Measured on `main` before this: `a < b` on two
// vectors compiled with no diagnostic, typed as a scalar bool, emitted `bool m = (a < b);` on
// GLSL (invalid) and read as one scalar on the oracle (wrong). What is pinned here: both
// spellings, the three CPU paths agreeing with the componentwise answer, and every refusal.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileTsSource } from './source-file.js'
import { TS_CODES } from './codes.js'
import { compileModuleJs } from '../../core/cpu-codegen.js'
import { startDebugSession } from '../../core/debug/session.js'

const FS = (body: string) => `"use typeshade"
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  const a = vec3(uv, 0.5)
  const b = vec3(0.5, 0.5, 0.5)
${body}
}
`
const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`)

/** The three CPU paths on one fragment, asserted equal to `expected`. */
function agree(src: string, uv: [number, number], expected: number[]): void {
  const r = compile(src)
  expect(r.diagnostics).toEqual([])
  expect(r.eval('fs', [uv]), 'oracle').toEqual(expected)
  expect(compileModuleJs(r.module).fns['fs']!(uv), 'codegen').toEqual(expected)
  const s = startDebugSession(r.module, 'fs', [uv])
  s.continue()
  expect(s.result, 'stepper').toEqual(expected)
}

describe('bool vectors: what each form lowers to', () => {
  it('a comparison of two vectors is a vector of bools on both targets', () => {
    const r = compile(FS('  const m = a < b\n  return vec4(select(a, b, m), 1.)'))
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('let m = (a < b);')
    expect(r.wgsl).toContain('return vec4<f32>(select(a, b, m), 1.0);')
    expect(r.glsl?.fragment).toContain('bvec3 m = lessThan(a, b);')
    expect(r.glsl?.fragment).toContain('_ret = vec4(mix(a, b, m), 1.0);')
  })

  it('every comparison has its GLSL function; equality takes === and !==', () => {
    const r = compile(
      FS(
        '  const lt = a < b\n  const le = a <= b\n  const gt = a > b\n  const ge = a >= b\n  const eq = a === b\n  const ne = a !== b\n  return vec4(f32(any(lt) && any(le) && any(gt) && any(ge) && any(eq) && any(ne)), 0., 0., 1.)',
      ),
    )
    expect(r.diagnostics).toEqual([])
    const g = r.glsl!.fragment
    for (const fn of [
      'lessThan(a, b)',
      'lessThanEqual(a, b)',
      'greaterThan(a, b)',
      'greaterThanEqual(a, b)',
      'equal(a, b)',
      'notEqual(a, b)',
    ]) {
      expect(g).toContain(fn)
    }
    expect(r.wgsl).toContain('let eq = (a == b);')
  })

  it('any, all and ! spell as the builtins and a compare with a vector of falses', () => {
    const r = compile(
      FS('  const m = a < b\n  return vec4(f32(any(m)), f32(all(m)), f32(all(!m)), 1.)'),
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain(
      'f32(any(m)), f32(all(m)), f32(all((m == vec3<bool>(false, false, false))))',
    )
    expect(r.glsl?.fragment).toContain(
      'float(any(m)), float(all(m)), float(all(equal(m, bvec3(false, false, false))))',
    )
  })

  it('a vec3b constructor, and a per-component select over integer vectors', () => {
    const r = compile(
      FS(
        '  const m = vec3b(true, false, uv.x > 0.5)\n  const i = select(vec3i(1, 2, 3), vec3i(7, 8, 9), m)\n  return vec4(f32(i.x), f32(i.y), f32(i.z), f32(m.x))',
      ),
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('let m = vec3<bool>(true, false, (uv.x > 0.5));')
    expect(r.wgsl).toContain('let i = select(vec3<i32>(1, 2, 3), vec3<i32>(7, 8, 9), m);')
    // GLSL ES 3.00 has `mix` with a bvec for floats only; an integer pick is componentwise.
    expect(r.glsl?.fragment).toContain('bvec3 m = bvec3(true, false, (uv.x > 0.5));')
    expect(r.glsl?.fragment).toContain(
      'ivec3 i = ivec3(((m).x ? (ivec3(7, 8, 9)).x : (ivec3(1, 2, 3)).x)',
    )
  })

  it('a scalar select and a scalar comparison are as they were', () => {
    const r = compile(FS('  return vec4(select(a, b, uv.x < 0.5), 1.)'))
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('select(a, b, (uv.x < 0.5))')
    expect(r.glsl?.fragment).toContain('((uv.x < 0.5) ? b : a)')
  })
})

describe('bool vectors: the three CPU paths agree with the componentwise answer', () => {
  it('select picks per component, any and all reduce, ! flips', () => {
    // uv (0.25, 0.75): a = (0.25, 0.75, 0.5), b = (0.5, 0.5, 0.5), a < b = (true, false, false).
    agree(
      FS('  const m = a < b\n  return vec4(select(a, b, m), 1.)'),
      [0.25, 0.75],
      [0.5, 0.75, 0.5, 1],
    )
    agree(
      FS('  const m = a < b\n  return vec4(f32(any(m)), f32(all(m)), f32(all(!m)), 1.)'),
      [0.25, 0.75],
      [1, 0, 0, 1],
    )
    agree(
      FS(
        '  const e = a === b\n  const ne = a !== b\n  return vec4(f32(all(e)), f32(any(ne)), f32(any(e)), 1.)',
      ),
      [0.25, 0.75],
      [0, 1, 1, 1],
    )
    agree(
      FS('  return vec4(f32(all(a === a)), f32(any(a !== a)), 0., 1.)'),
      [0.25, 0.75],
      [1, 0, 0, 1],
    )
  })

  it('an integer pick and a constructed mask', () => {
    agree(
      FS(
        '  const m = vec3b(true, false, uv.x > 0.5)\n  const i = select(vec3i(1, 2, 3), vec3i(7, 8, 9), m)\n  return vec4(f32(i.x), f32(i.y), f32(i.z), f32(m.x))',
      ),
      [0.25, 0.75],
      [7, 2, 3, 1],
    )
    agree(
      FS(
        '  const m = vec3b(true, false, uv.x > 0.5)\n  const i = select(vec3i(1, 2, 3), vec3i(7, 8, 9), m)\n  return vec4(f32(i.x), f32(i.y), f32(i.z), f32(m.z))',
      ),
      [0.75, 0.25],
      [7, 2, 9, 1],
    )
  })

  it('equality on f32 vectors rounds to f32 first, as the scalar form does', () => {
    // 0.1 + 0.2 is not 0.3 in f64 but rounds to the same f32.
    agree(
      FS(
        '  const x = vec2(0.1, 0.) + vec2(0.2, 0.)\n  return vec4(f32(all(x === vec2(0.3, 0.))), 0., 0., 1.)',
      ),
      [0, 0],
      [1, 0, 0, 1],
    )
  })
})

describe('bool vectors: what is refused, and what the fix is', () => {
  const only = (src: string) => {
    const errors = errorsOf(src)
    expect(errors, src).toHaveLength(1)
    return errors[0]!
  }

  it('an ordering on bool vectors, a select whose arms do not match the mask', () => {
    expect(only(FS('  const m = a < b\n  const n = m < m\n  return vec4(1.)'))).toBe(
      `${TS_CODES.TYPE_MISMATCH} "<" has no meaning on vec3<bool>: compare bool vectors with === or !==, or reduce them with any() or all().`,
    )
    expect(only(FS('  const m = uv < vec2(0.5)\n  return vec4(select(a, b, m), 1.)'))).toBe(
      `${TS_CODES.TYPE_MISMATCH} select with a vec2<bool> condition picks per component and needs 2-component arms; got vec3<f32>.`,
    )
    expect(only(FS('  return vec4(select(a, b, uv), 1.)'))).toBe(
      `${TS_CODES.TYPE_MISMATCH} select condition must be bool or a vector of bools, got vec2<f32>. The order is WGSL's: select(falseValue, trueValue, cond).`,
    )
  })

  it('any and all take a vector of bools, or an array with a predicate', () => {
    expect(only(FS('  return vec4(f32(any(uv.x < 0.5)), 0., 0., 1.)'))).toBe(
      `${TS_CODES.TYPE_MISMATCH} any(v) takes a vector of bools, which a comparison of two vectors gives (§27), or an array with a predicate, any(xs, (x) => ...); got bool.`,
    )
    expect(only(FS('  return vec4(f32(all(a)), 0., 0., 1.)'))).toBe(
      `${TS_CODES.TYPE_MISMATCH} all(v) takes a vector of bools, which a comparison of two vectors gives (§27), or an array with a predicate, all(xs, (x) => ...); got vec3<f32>.`,
    )
    // The fold keeps its own message.
    expect(
      only(FS('  const xs: array<f32, 2> = [1., 2.]\n  return vec4(f32(any(xs)), 0., 0., 1.)')),
    ).toContain('needs an array and a predicate function')
  })

  it('&& and || stay scalar', () => {
    expect(only(FS('  const m = a < b\n  const n = m && m\n  return vec4(1.)'))).toBe(
      `${TS_CODES.TYPE_MISMATCH} Logical "&&" requires bool operands.`,
    )
  })
})
