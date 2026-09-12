import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'

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

  it('rejects vec4 * mat4', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function bad(p: vec4, m: mat4): vec4 {
        return p * m;
      }
    `)
    expect(r.diagnostics.some((d) => d.category === 'error')).toBe(true)
  })
})
