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

// Oversized fullscreen triangle — 3 verts, no vertex buffer. `u.gain` is applied HERE
// rather than in the fragment stage so the VERTEX source mentions the binding too: a gate
// that only ever sees a binding read from one stage cannot tell a per-stage reachability
// bug from a working walk, which is the gap #14 hid in. The clip position is untouched, so
// the triangle still covers the screen whatever the host sets `gain` to.
@vertex
export function vs(@builtin("vertex_index") idx: u32): VsOut {
  const x = f32(idx & 1) * 4. - 1.
  const y = f32(idx >> 1) * 4. - 1.
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x * 0.5 + 0.5, (y * 0.5 + 0.5) * u.gain) }
}

@fragment
export function fs(vo: VsOut): vec4 {
  // The `vec3` annotation is not decoration. TypeScript types `v * s` as `number`, so the
  // product cannot be handed straight to `vec4(v: vec3, w: number)` without the editor
  // reporting TS2345 on a program that compiles — issue #43. Naming the type restores it.
  // This example pays that cost because it has no EDSL twin whose emit it must match.
  const rgb: vec3 = u.tint.rgb * vo.uv.y
  return vec4(rgb, u.tint.a)
}
