import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'

describe('hardcoded triangle entries', () => {
  it('gives @vertex a vid and @builtin(position) return', () => {
    const r = compileTsSource(`
      "use typeshade";
      @vertex
      export function vs(): vec4 {
        const x = vid;
        return vec4(0., 0., 0., 1.);
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const vs = r.funcs.find((f) => f.name === 'vs')!
    expect(vs.stage).toBe('vertex')
    expect(vs.params.some((p) => p.name === 'vid' && p.builtin === 'vertex_index')).toBe(true)
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
    const fs = r.funcs.find((f) => f.name === 'fs')!
    expect(fs.stage).toBe('fragment')
    expect(fs.retAttr).toBe('@location(0)')
  })

  it('rejects vid in a helper', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): u32 { return vid; }
    `)
    expect(r.diagnostics.some((d) => /@vertex/.test(d.message))).toBe(true)
  })
})
