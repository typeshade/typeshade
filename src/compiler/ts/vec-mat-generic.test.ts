import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'

describe('vec<T> / mat<T>', () => {
  it('accepts vec3<u32> and vec3u', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(a: vec3<u32>, b: vec3u): vec3<u32> {
        return a;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })

  it('accepts mat4<f32> * vec4<f32>', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function xform(m: mat4<f32>, p: vec4<f32>): vec4<f32> {
        return m * p;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })

  it('rejects mat4<u32>', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function bad(m: mat4<u32>, p: vec4<u32>): vec4<u32> {
        return p;
      }
    `)
    expect(r.diagnostics.some((d) => /floating-point only|mat4/.test(d.message))).toBe(true)
  })
})
