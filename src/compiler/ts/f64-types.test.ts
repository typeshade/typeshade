import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'

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
