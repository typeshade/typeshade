import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { compile } from './compile.js'
import { compileModule } from '../../core/oracle.js'

describe('mat4 multiply', () => {
  it('types mat4 * vec4 as vec4', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function xform(m: mat4, p: vec4): vec4 {
        return m * p;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toMatch(/m \* p/)
  })

  it('types mat4 * mat4 as mat4', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function concat(a: mat4, b: mat4): mat4 {
        return a * b;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })

  // This used to assert that `vec4 * mat4` is an error, with no reason recorded. It is not an
  // error: wgsl.txt:9960-9995 gives `v * m` the ROW-vector product, `vecR * matCxR -> vecC`,
  // and GLSL ES 3.00 spells it the same way. `binResultType` simply had no arm for it (#149).
  // So the row is lifted, and what is pinned instead is the thing worth pinning — that it is
  // a DIFFERENT product from `m * v`, and equal to `transpose(m) * v`.
  it('types vec4 * mat4 as the row-vector product, which is transpose(m) * v', () => {
    const r = compile(`
      "use typeshade";
      export function rowTimes(p: vec4, m: mat4): vec4 {
        return p * m;
      }
      export function colTimes(p: vec4, m: mat4): vec4 {
        return m * p;
      }
      export function throughTranspose(p: vec4, m: mat4): vec4 {
        return transpose(m) * p;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const cpu = compileModule(r.module)
    // Column-major, and deliberately NOT symmetric — a symmetric matrix would make the two
    // products equal and the comparison below vacuous.
    const m = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
    const p = [1, 0, 0, 0]
    const row = cpu.fns.rowTimes!(p, m) as number[]
    const col = cpu.fns.colTimes!(p, m) as number[]
    const viaT = cpu.fns.throughTranspose!(p, m) as number[]
    // v * m takes the DOT of v with each column, so with p = (1,0,0,0) it is the first
    // component of every column.
    expect(row).toEqual([1, 5, 9, 13])
    // m * v takes the first column whole. The two differ, which is the point.
    expect(col).toEqual([1, 2, 3, 4])
    expect(row).not.toEqual(col)
    expect(row).toEqual(viaT)
  })

  it('types the non-square products by the spec table', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function a(m: mat2x3, v: vec2): vec3 { return m * v; }
      export function b(m: mat2x3, v: vec3): vec2 { return v * m; }
      export function c(x: mat3x2, y: mat2x3): mat2x2 { return x * y; }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })

  it('refuses a product whose dimensions do not meet, naming both shapes', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function bad(m: mat2x3, v: vec3): vec3 { return m * v; }
    `)
    const errors = r.diagnostics.filter((d) => d.category === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toContain('mat2x3<f32>')
    expect(errors[0]!.message).toContain('vec3<f32>')
  })
})
