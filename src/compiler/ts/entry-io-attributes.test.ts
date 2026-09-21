// Entry IO ATTRIBUTES as WGSL declares them (§53, #158).
//
// A file of its own rather than `entry-io.test.ts`, which #109 already wrote about what an
// entry may RETURN: that is the shape of the return, this is what the attributes on it say.
//
// Measured on Chromium 141 (`chromium_headless_shell-1194`), with the broken-shader
// instrument check passing on both compilers first:
//
//   WGSL  `@location(0) id: u32` on a vertex output, bare
//         REFUSED — "integral user-defined vertex outputs must have a '@interpolate(flat)'
//         attribute"
//   WGSL  the same with `@interpolate(flat)`                        ACCEPTED
//   GLSL  `in uint id;`   REFUSED — "'in' : must use 'flat' interpolation here"
//   GLSL  `flat in uint id;`                                        ACCEPTED
//   WGSL  `enable dual_source_blending;`
//         REFUSED — "extension 'dual_source_blending' is not allowed in the current
//         environment"; `adapter.features.has('dual-source-blending')` is false on this
//         adapter, which is why no gate example carries `@blend_src`.
//
// So the two writers had disagreed about one program: the GLSL writer had always added `flat`
// and the WGSL writer had not, and the module Tint refused was the one the compiler emitted.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileTsSource } from './source-file.js'
import { TS_CODES } from './codes.js'

function compiled(source: string) {
  const c = compile(`"use typeshade"\n${source}`)
  expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  return c
}

function diagnose(source: string): { code?: string; message: string } {
  const r = compileTsSource(`"use typeshade"\n${source}`)
  const errors = r.diagnostics.filter((d) => d.category === 'error')
  expect(errors.length, 'expected a diagnostic, got none').toBeGreaterThan(0)
  // One mistake, one sentence: a rule that reads the struct alone must not be raised once per
  // stage that uses it (the same struct is a vertex output AND a fragment input).
  expect(new Set(errors.map((d) => d.message)).size, errors.map((d) => d.message).join('\n')).toBe(
    errors.length,
  )
  return { code: errors[0]!.code, message: errors[0]!.message }
}

const VARYINGS = `class VsOut {
  @builtin("position") pos: vec4
  @location(0) id: u32
  @location(1) uv: vec2
}
@vertex export function vs(@builtin("vertex_index") vi: u32): VsOut {
  return { pos: vec4(0., 0., 0., 1.), id: vi, uv: vec2(0., 0.) }
}
@fragment export function fs(v: VsOut): vec4 { return vec4(f32(v.id), v.uv, 1.) }`

describe('an integer varying is flat, because neither target can interpolate one', () => {
  it('emits @interpolate(flat) on every integer varying and GLSL keeps flat', () => {
    const c = compiled(VARYINGS)
    expect(c.wgsl).toContain('@location(0) @interpolate(flat) id: u32,')
    // The float varying beside it is untouched: it has an interpolation, so nothing is derived.
    expect(c.wgsl).toContain('@location(1) uv: vec2<f32>,')
    expect(c.glsl!.vertex).toContain('flat out uint id;')
    expect(c.glsl!.fragment).toContain('flat in uint id;')
    expect(c.glsl!.fragment).toContain('in vec2 uv;')
  })

  it('derives it from the type, for a vector and for a fragment input alike', () => {
    const c = compiled(`class VsOut {
  @builtin("position") pos: vec4
  @location(0) cell: vec2u
  @location(1) sign: i32
}
@vertex export function vs(): VsOut {
  return { pos: vec4(0., 0., 0., 1.), cell: vec2u(1, 2), sign: -1 }
}
@fragment export function fs(v: VsOut): vec4 {
  return vec4(f32(v.cell.x), f32(v.cell.y), f32(v.sign), 1.)
}`)
    expect(c.wgsl).toContain('@location(0) @interpolate(flat) cell: vec2<u32>,')
    expect(c.wgsl).toContain('@location(1) @interpolate(flat) sign: i32,')
    expect(c.glsl!.fragment).toContain('flat in uvec2 cell;')
    expect(c.glsl!.fragment).toContain('flat in int sign;')
  })
})

describe('@interpolate, @invariant and @blend_src', () => {
  it('passes @interpolate and @invariant through on WGSL and as qualifiers on GLSL', () => {
    const c = compiled(`class VsOut {
  @builtin("position") @invariant pos: vec4
  @location(0) @interpolate("perspective", "centroid") uv: vec2
}
@vertex export function vs(): VsOut { return { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.) } }
@fragment export function fs(v: VsOut): vec4 { return vec4(v.uv, 0., 1.) }`)
    expect(c.wgsl).toContain('@invariant @builtin(position) pos: vec4<f32>,')
    expect(c.wgsl).toContain('@location(0) @interpolate(perspective, centroid) uv: vec2<f32>,')
    // GLSL ES 3.00 spells perspective interpolation `smooth`, and `invariant` is a statement
    // about `gl_Position` rather than an attribute on a declaration.
    expect(c.glsl!.vertex).toContain('invariant gl_Position;')
    expect(c.glsl!.vertex).toContain('smooth centroid out vec2 uv;')
    expect(c.glsl!.fragment).toContain('smooth centroid in vec2 uv;')
  })

  it('fails GLSL closed for the two interpolations it does not have', () => {
    // `linear` and the `sample` position are WGSL-only: GLSL ES 3.00 has `smooth`, `flat` and
    // `centroid` and nothing else, so a module using one has no GLSL form at all rather than
    // a silently different one.
    for (const arg of ['"linear"', '"perspective", "sample"']) {
      const c = compiled(`class VsOut {
  @builtin("position") pos: vec4
  @location(0) @interpolate(${arg}) uv: vec2
}
@vertex export function vs(): VsOut { return { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.) } }
@fragment export function fs(v: VsOut): vec4 { return vec4(v.uv, 0., 1.) }`)
      expect(c.wgsl, arg).toContain('@interpolate(')
      expect(c.glsl, arg).toBeUndefined()
    }
  })

  it('derives dualSourceBlending from @blend_src and emits the directive', () => {
    const c = compiled(`class Out {
  @location(0) @blend_src(0) color: vec4
  @location(0) @blend_src(1) mask: vec4
}
@fragment export function fs(): Out { return { color: vec4(1., 1., 1., 1.), mask: vec4(0., 0., 0., 0.) } }`)
    expect(c.wgsl).toContain('enable dual_source_blending;')
    expect(c.wgsl).toContain('@location(0) @blend_src(0) color: vec4<f32>,')
    expect(c.wgsl).toContain('@location(0) @blend_src(1) mask: vec4<f32>,')
    // A dual-source pair is the one shape that puts two members at one location on purpose,
    // so the slot rule has to read the blend source too — and GLSL ES 3.00 has no second
    // source, so the module has no GLSL form.
    expect(c.glsl).toBeUndefined()
  })
})

describe('the entry IO shapes that are refused, one sentence each', () => {
  it('refuses a bool varying', () => {
    const d = diagnose(`class VsOut { @builtin("position") pos: vec4; @location(0) ok: bool }
@vertex export function vs(): VsOut { return { pos: vec4(0., 0., 0., 1.), ok: true } }
@fragment export function fs(v: VsOut): vec4 { return vec4(1.) }`)
    expect(d.code).toBe(TS_CODES.TYPE_MISMATCH)
    expect(d.message).toContain('a numeric scalar or a numeric vector')
  })

  it('refuses two members at one @location', () => {
    const d = diagnose(`class VsOut {
  @builtin("position") pos: vec4
  @location(0) a: vec2
  @location(0) b: vec2
}
@vertex export function vs(): VsOut {
  return { pos: vec4(0., 0., 0., 1.), a: vec2(0., 0.), b: vec2(0., 0.) }
}
@fragment export function fs(v: VsOut): vec4 { return vec4(1.) }`)
    expect(d.code).toBe(TS_CODES.STRUCT_FIELD)
    expect(d.message).toContain('each slot carries one value')
  })

  it('refuses user IO on a compute entry', () => {
    const d = diagnose(`@compute([64, 1, 1]) export function cs(@location(0) x: f32) {}`)
    expect(d.message).toContain('which has no user IO')
  })

  it('refuses a builtin declared with a type WGSL does not give it', () => {
    const d = diagnose(`@vertex export function vs(@builtin("vertex_index") i: f32): vec4 {
  return vec4(0., 0., 0., 1.)
}`)
    expect(d.code).toBe(TS_CODES.TYPE_MISMATCH)
    expect(d.message).toBe('Builtin "vertex_index" is "u32"; this declares it "f32".')
  })

  it('refuses a mismatched interstage pair, naming both sides', () => {
    const d = diagnose(`class VsOut { @builtin("position") pos: vec4; @location(0) uv: vec2 }
class FsIn { @builtin("position") pos: vec4; @location(0) uv: vec3 }
@vertex export function vs(): VsOut { return { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.) } }
@fragment export function fs(v: FsIn): vec4 { return vec4(v.uv, 1.) }`)
    expect(d.message).toContain('leaves "vs" as vec2<f32> (VsOut.uv)')
    expect(d.message).toContain('enters "fs" as vec3<f32> (FsIn.uv)')
  })

  it('refuses an interstage pair that disagrees about interpolation', () => {
    const d = diagnose(`class VsOut {
  @builtin("position") pos: vec4
  @location(0) @interpolate("flat") uv: vec2
}
class FsIn { @builtin("position") pos: vec4; @location(0) uv: vec2 }
@vertex export function vs(): VsOut { return { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.) } }
@fragment export function fs(v: FsIn): vec4 { return vec4(v.uv, 0., 1.) }`)
    expect(d.message).toContain('interpolated one way on both sides')
  })

  it('refuses a fragment reading a slot the vertex does not produce', () => {
    const d = diagnose(`class VsOut { @builtin("position") pos: vec4; @location(0) uv: vec2 }
class FsIn { @builtin("position") pos: vec4; @location(3) uv: vec2 }
@vertex export function vs(): VsOut { return { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.) } }
@fragment export function fs(v: FsIn): vec4 { return vec4(v.uv, 0., 1.) }`)
    expect(d.message).toContain('which "vs" does not produce')
  })

  it('takes a fragment that reads a SUBSET of the vertex output', () => {
    // WGSL constrains only the slots the fragment names, so an output it ignores is fine.
    const c = compiled(`class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
  @location(1) extra: vec2
}
class FsIn { @builtin("position") pos: vec4; @location(0) uv: vec2 }
@vertex export function vs(): VsOut {
  return { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.), extra: vec2(1., 1.) }
}
@fragment export function fs(v: FsIn): vec4 { return vec4(v.uv, 0., 1.) }`)
    expect(c.wgsl).toContain('@location(1) extra: vec2<f32>,')
  })

  it('refuses @interpolate on a @builtin, which carries its own rule', () => {
    const d = diagnose(`class VsOut {
  @builtin("position") @interpolate("flat") pos: vec4
}
@vertex export function vs(): VsOut { return { pos: vec4(0., 0., 0., 1.) } }
@fragment export function fs(v: VsOut): vec4 { return vec4(1.) }`)
    expect(d.message).toContain('@interpolate belongs on a @location field')
  })
})
