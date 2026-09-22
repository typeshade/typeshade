"use typeshade"

/* @example
{
  "title": "Plasma (source twin)",
  "blurb": "`shadertoy-plasma.ts` written in the source language: three interfering sine waves, the same wave at three phase offsets becoming the three colour channels. The smallest fullscreen twin there is.",
  "renderable": true,
  "twinOf": "plasma"
}
*/

// The `"use typeshade"` twin of `shadertoy-plasma.ts`.
//
// The fullscreen head — the `{time, resolution}` uniform, `VsOut`, and the
// vertex stage — is spelled out here rather than shared. A `.shade.ts` file is
// source text for `compile()`, not an importable module, so `_fullscreen.ts`
// has no source-language counterpart. Every fullscreen twin repeats it.

class Uniforms {
  time: f32
  resolution: vec2
}

declare const U: uniform<Uniforms>

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & 1) * 4. - 1.
  const y = f32(vi >> 1) * 4. - 1.
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x * 0.5 + 0.5, y * 0.5 + 0.5) }
}

@fragment
export function fs(vo: VsOut): vec4 {
  const t = U.time
  const uv = vo.uv
  // three interfering sine waves — the classic plasma
  const v = sin(uv.x * 10. + t) + sin(uv.y * 10. + t) + sin((uv.x + uv.y) * 10. + t * 0.7)
  // the same wave at three phase offsets becomes the three colour channels
  // `col` is annotated for the EDITOR, not the compiler: TypeScript types `vec3 * scalar` as
  // `number`, which then draws TS2345 at the `vec4(col, 1.)` below, on a program that compiles
  // (issue #43). Emit-neutral: the WGSL and GLSL are byte-identical without it.
  const col: vec3 = vec3(sin(v), sin(v + 2.094), sin(v + 4.188)) * 0.5 + 0.5
  return vec4(col, 1.)
}
