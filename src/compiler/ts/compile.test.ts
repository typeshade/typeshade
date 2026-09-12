import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'

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

describe('compile()', () => {
  it('returns module + wgsl + eval for Clip/Color', () => {
    const s = compile(SRC)
    expect(s.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(s.module.funcs.filter((f) => f.stage).map((f) => f.stage).sort()).toEqual(['fragment', 'vertex'])
    expect(s.wgsl).toMatch(/@builtin\(position\)/)
    expect(s.wgsl).toMatch(/@vertex/)
    expect(s.glsl?.vertex).toMatch(/#version 300 es/)
    const red = s.eval('fs') as { color: number[] }
    expect(red.color).toEqual([1, 0, 0, 1])
  })
})
