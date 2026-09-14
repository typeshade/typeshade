"use typeshade"

// The uniform that DOES have a GLSL ES 3.00 form, next to `hello-uniform`'s loose scalar
// that does not. A struct behind `uniform<T>` lays out as a std140 block on both targets, so
// this one emits and links on WebGL2 — and that is the point of it being here.
//
// It is also the configuration whose absence let #14 hide: a source-compiled example with a
// binding AND a renderable GLSL pair. The three renderable `.shade.ts` examples had no
// bindings, and the two with bindings were `renderable: false`, so no source-compiled
// uniform declaration ever reached the compile gate or the per-stage GLSL sweep.

class Uniforms {
  tint: vec4
  gain: f32
}

declare const u: uniform<Uniforms>

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

// Oversized fullscreen triangle — 3 verts, no vertex buffer.
@vertex
export function vs(@builtin("vertex_index") idx: u32): VsOut {
  const x = f32(idx & 1) * 4. - 1.
  const y = f32(idx >> 1) * 4. - 1.
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x * 0.5 + 0.5, y * 0.5 + 0.5) }
}

@fragment
export function fs(vo: VsOut): vec4 {
  return vec4(u.tint.rgb * (vo.uv.y * u.gain), u.tint.a)
}
