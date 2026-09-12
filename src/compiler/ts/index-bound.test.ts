import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { TS_CODES } from './codes.js'

describe('constant index OOB', () => {
  it('accepts xs[0] and xs[3] on array<f32, 4>', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function at(xs: array<f32, 4>): f32 {
        return xs[3];
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })

  it('rejects xs[4] on array<f32, 4>', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function at(xs: array<f32, 4>): f32 {
        return xs[4];
      }
    `)
    expect(r.diagnostics.some((d) => d.code === TS_CODES.INDEX_OOB)).toBe(true)
    expect(r.diagnostics.some((d) => /out of range/.test(d.message))).toBe(true)
  })

  it('rejects xs[-1]', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function at(xs: array<f32, 4>): f32 {
        return xs[-1];
      }
    `)
    expect(r.diagnostics.some((d) => d.code === TS_CODES.INDEX_OOB)).toBe(true)
  })

  it('rejects v[3] on vec3', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function at(v: vec3): f32 {
        return v[3];
      }
    `)
    expect(r.diagnostics.some((d) => d.code === TS_CODES.INDEX_OOB)).toBe(true)
  })

  it('leaves runtime xs[i] as a plain index (UB on the GPU)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function at(xs: array<f32, 4>, i: i32): f32 {
        return xs[i];
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const ret = r.funcs[0]!.body[0]
    if (ret!.s === 'return') expect(ret.expr?.op).toBe('index')
  })
})
