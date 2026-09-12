import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'

describe('parameter builtins', () => {
  it('reads @builtin on a vertex param', () => {
    const r = compileTsSource(`
      "use typeshade";
      @vertex
      export function vs(@builtin("vertex_index") i: u32): vec4 {
        return vec4(0., 0., 0., 1.);
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const vs = r.funcs.find((f) => f.name === 'vs')!
    expect(vs.params).toHaveLength(1)
    expect(vs.params[0]).toMatchObject({ name: 'i', builtin: 'vertex_index' })
    expect(vs.retAttr).toBe('@builtin(position)')
  })

  it('reads @builtin on a compute param', () => {
    const r = compileTsSource(`
      "use typeshade";
      @compute([64])
      export function paint(@builtin("global_invocation_id") id: vec3u): void {
        const x = id.x;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.funcs[0]!.params[0]).toMatchObject({ name: 'id', builtin: 'global_invocation_id' })
  })

  it('does not invent a vid name', () => {
    const r = compileTsSource(`
      "use typeshade";
      @vertex
      export function vs(): vec4 {
        return vec4(0., 0., 0., 1.);
      }
    `)
    expect(r.funcs[0]!.params.some((p) => p.name === 'vid')).toBe(false)
  })
})
