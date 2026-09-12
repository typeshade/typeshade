import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'

const SRC = `
"use typeshade";

class Clip {
  @builtin("position") pos: vec4;
}

class Color {
  @location(0) color: vec4;
}

@vertex
export function vs(@builtin("vertex_index") i: u32): Clip {
  return { pos: vec4(0., 0., 0., 1.) };
}

@fragment
export function fs(): Color {
  return { color: vec4(1., 0., 0., 1.) };
}
`

describe('week1 Clip / Color', () => {
  it('compiles the Karpathy triangle source to WGSL', () => {
    const r = compileTsSource(SRC)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.structs.map((s) => s.decl.name).sort()).toEqual(['Clip', 'Color'])
    const vs = r.funcs.find((f) => f.name === 'vs')!
    const fs = r.funcs.find((f) => f.name === 'fs')!
    expect(vs.stage).toBe('vertex')
    expect(vs.params[0]).toMatchObject({ name: 'i', builtin: 'vertex_index' })
    expect(vs.ret.kind).toBe('struct')
    expect(fs.stage).toBe('fragment')
    expect(r.wgsl).toMatch(/struct Clip/)
    expect(r.wgsl).toMatch(/@builtin\(position\)/)
    expect(r.wgsl).toMatch(/@vertex/)
    expect(r.wgsl).toMatch(/@fragment/)
    expect(r.wgsl).toMatch(/@location\(0\)/)
  })
})
