import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { wgslLayout } from '../../core/reflect.js'
import { typeKey } from '../../core/ir/types.js'

describe('uniform<Camera>', () => {
  it('binds declare const camera: uniform<Camera> and reports WGSL size', () => {
    const r = compileTsSource(`
      "use typeshade";
      class Camera {
        view: mat4;
        pos: vec3;
      }
      declare const camera: uniform<Camera>;
      export function f(): vec3 {
        return camera.pos;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.structs[0]!.decl.name).toBe('Camera')
    expect(r.bindings[0]).toMatchObject({ name: 'camera', space: 'uniform', group: 0, binding: 0 })
    expect(typeKey(r.bindings[0]!.type)).toBe('struct:Camera')
    const layout = wgslLayout(r.structs[0]!.decl, 'std140')
    expect(layout.size).toBe(80)
    expect(layout.fields.map((f) => f.name)).toEqual(['view', 'pos'])
    expect(r.wgsl).toMatch(/struct Camera/)
    expect(r.wgsl).toMatch(/var<uniform> camera/)
  })
})
