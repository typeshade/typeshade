import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'

describe('declare uniform / storage', () => {
  it('binds declare const camera: uniform<f32>', () => {
    const r = compileTsSource(`
      "use typeshade";
      declare const camera: uniform<f32>;
      export function f(x: f32): f32 {
        return x * camera;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.bindings).toHaveLength(1)
    expect(r.bindings[0]).toMatchObject({ name: 'camera', space: 'uniform', binding: 0 })
    expect(r.wgsl).toMatch(/var<uniform>/)
  })

  it('treats declare let storage as read_write', () => {
    const r = compileTsSource(`
      "use typeshade";
      declare let pixels: storage<f32>;
      export function f(): f32 { return 0.; }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.bindings[0]).toMatchObject({ name: 'pixels', space: 'storage', access: 'read_write' })
  })

  it('treats declare const storage as read', () => {
    const r = compileTsSource(`
      "use typeshade";
      declare const src: storage<f32>;
      export function f(): f32 { return src; }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.bindings[0]).toMatchObject({ access: 'read' })
  })

  it('rejects writing a declare const uniform', () => {
    const r = compileTsSource(`
      "use typeshade";
      declare const camera: uniform<f32>;
      export function f(): void { camera = 1.; }
    `)
    expect(r.diagnostics.some((d) => /read-only/.test(d.message))).toBe(true)
  })

  it('rejects declare const camera: Camera without a space', () => {
    const r = compileTsSource(`
      "use typeshade";
      declare const camera: f32;
      export function f(): f32 { return camera; }
    `)
    expect(r.diagnostics.some((d) => /uniform<T> or storage<T>/.test(d.message))).toBe(true)
  })
})
