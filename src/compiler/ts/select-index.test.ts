import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'

describe('select / index', () => {
  it('lowers c ? a : b to select', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function pick(c: bool, a: f32, b: f32): f32 {
        return c ? a : b;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const ret = r.funcs[0]!.body[0]
    if (ret!.s === 'return') expect(ret.expr?.op).toBe('select')
    expect(r.wgsl).toMatch(/select\(/)
  })

  it('rejects a non-bool ternary condition', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function pick(a: f32, b: f32): f32 {
        return a ? a : b;
      }
    `)
    expect(r.diagnostics.some((d) => /bool/.test(d.message))).toBe(true)
  })

  it('rejects mismatched ternary arms', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function pick(c: bool, a: f32, b: i32): f32 {
        return c ? a : b;
      }
    `)
    expect(r.diagnostics.some((d) => /mismatch|Cannot/.test(d.message))).toBe(true)
  })

  it('lowers v[i] to index', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function at(v: vec3, i: i32): f32 {
        return v[i];
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const ret = r.funcs[0]!.body[0]
    if (ret!.s === 'return') expect(ret.expr?.op).toBe('index')
  })

  it('rejects a float index', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function at(v: vec3, i: f32): f32 {
        return v[i];
      }
    `)
    expect(r.diagnostics.some((d) => /Index must be i32 or u32/.test(d.message))).toBe(true)
  })
})
