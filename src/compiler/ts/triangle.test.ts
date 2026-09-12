import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'

describe('hardcoded triangle entries', () => {
  it('uses an explicit vertex_index param', () => {
    const r = compileTsSource(`
      "use typeshade";
      @vertex
      export function vs(@builtin("vertex_index") i: u32): vec4 {
        return vec4(0., 0., 0., 1.);
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const vs = r.funcs.find((f) => f.name === 'vs')!
    expect(vs.stage).toBe('vertex')
    expect(vs.params[0]).toMatchObject({ name: 'i', builtin: 'vertex_index' })
    expect(vs.retAttr).toBe('@builtin(position)')
  })

  it('gives @fragment a @location(0) return', () => {
    const r = compileTsSource(`
      "use typeshade";
      @fragment
      export function fs(): vec4 {
        return vec4(1., 0., 0., 1.);
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.funcs[0]!.retAttr).toBe('@location(0)')
  })
})
