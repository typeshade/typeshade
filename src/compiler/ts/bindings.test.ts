import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'

describe('uniform / storage', () => {
  it('collects uniform<f32>({ binding: 0 }) and reads it', () => {
    const r = compileTsSource(`
      "use typeshade";
      const scale = uniform<f32>({ binding: 0 });
      export function f(x: f32): f32 {
        return x * scale;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.bindings).toHaveLength(1)
    expect(r.bindings[0]).toMatchObject({ name: 'scale', space: 'uniform', binding: 0, group: 0 })
    expect(r.wgsl).toMatch(/var<uniform>/)
  })

  it('collects storage with read_write', () => {
    const r = compileTsSource(`
      "use typeshade";
      const xs = storage<array<f32, 4>>({ binding: 1, access: "read_write" });
      export function f(): f32 {
        return 0.;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.bindings[0]).toMatchObject({
      name: 'xs',
      space: 'storage',
      binding: 1,
      access: 'read_write',
    })
    expect(r.wgsl).toMatch(/var<storage/)
  })

  it('rejects writes to a uniform', () => {
    const r = compileTsSource(`
      "use typeshade";
      const scale = uniform<f32>({ binding: 0 });
      export function f(): void {
        scale = 1.;
      }
    `)
    expect(r.diagnostics.some((d) => /read-only|read_write/.test(d.message))).toBe(true)
  })

  it('does not treat a resource as a module const', () => {
    const r = compileTsSource(`
      "use typeshade";
      const scale = uniform<f32>({ binding: 0 });
      export function f(): f32 { return scale; }
    `)
    expect(r.consts).toEqual([])
    expect(r.bindings).toHaveLength(1)
  })
})
