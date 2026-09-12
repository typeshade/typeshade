import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'

describe('data class + annotations', () => {
  it('collects class fields as a struct', () => {
    const r = compileTsSource(`
      "use typeshade";
      class Camera {
        view: vec4;
        pos: vec3;
      }
      export function f(): f32 { return 0.; }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.structs).toHaveLength(1)
    expect(r.structs[0]!.decl.name).toBe('Camera')
    expect(r.structs[0]!.decl.fields.map((f) => f.name)).toEqual(['view', 'pos'])
    expect(r.structs[0]!.packing).toBe('wgsl')
  })

  it('errors on class-level packing attrs that are not applied', () => {
    const r = compileTsSource(`
      "use typeshade";
      @std140
      @align(16)
      class Camera {
        pos: vec3;
      }
      export function f(): f32 { return 0.; }
    `)
    expect(r.diagnostics.some((d) => /@std140/.test(d.message) && /not applied/.test(d.message))).toBe(true)
    expect(r.diagnostics.some((d) => /@align/.test(d.message) && /not applied/.test(d.message))).toBe(true)
  })

  it('keeps @location and rejects unused @align on fields', () => {
    const r = compileTsSource(`
      "use typeshade";
      class VsIn {
        @location(0) position: vec3;
        @align(16) uv: vec2;
      }
      export function f(): f32 { return 0.; }
    `)
    expect(r.diagnostics.some((d) => /@align/.test(d.message) && /not applied/.test(d.message))).toBe(true)
    const fields = r.structs[0]!.decl.fields
    expect(fields[0]).toMatchObject({ name: 'position', location: 0 })
  })

  it('rejects @compute on a data class', () => {
    const r = compileTsSource(`
      "use typeshade";
      @compute
      class Camera {
        pos: vec3;
      }
      export function f(): f32 { return 0.; }
    `)
    expect(r.diagnostics.some((d) => /does not belong on a data class/.test(d.message))).toBe(true)
  })

  it('rejects methods on a data class', () => {
    const r = compileTsSource(`
      "use typeshade";
      class Camera {
        pos: vec3;
        forward(): vec3 { return this.pos; }
      }
      export function f(): f32 { return 0.; }
    `)
    expect(r.diagnostics.some((d) => /cannot have methods/.test(d.message))).toBe(true)
  })
})
