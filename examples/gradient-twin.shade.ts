"use typeshade";

/* @example
{
  "title": "Gradient pass (source twin)",
  "blurb": "`gradient-pass.ts` written in the source language instead of built with `fn()` / `module()` — the same shader through the other surface, with a uniform block both targets lay out and a GLSL pair that links.",
  "renderable": true,
  "twinOf": "gradient"
}
*/

// The `"use typeshade"` twin of `gradient-pass.ts`. Same shader, written in the source
// language instead of built with `fn()` / `module()` — the pairing the goldens in
// `shade-twins.test.ts` pin.
//
// It is a faithful port of the ORIGINAL'S SOURCE, not of its emit: the two named
// intermediates below are the ones `gradient-pass.ts` writes. That is worth knowing, because
// they do not survive the same way. An EDSL `const` is a build-time JavaScript binding that
// vanishes into the expression it feeds; a source-language `const` is a shader `let` that
// emits. Same program, two more statements — and the diff golden is where that shows.
//
// Held back from #16: until #14 the fragment GLSL dropped the uniform block and kept the
// uses, so this could be registered neither as `renderable: true` (the GLSL did not compile)
// nor as `renderable: false` (the flag arm correctly refuses a module that emits a `main()`).

class Uniforms {
  top: vec4;
  bottom: vec4;
  mix_bias: f32;
}

declare const u: uniform<Uniforms>;

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

// Oversized fullscreen triangle (3 verts, NDC −1..3) — covers the screen from a single
// non-indexed draw with no vertex buffer.
@vertex
export function vs_full(@builtin("vertex_index") idx: u32): VsOut {
  let pos = vec2(-1., -1.);
  if (idx === 1) {
    pos = vec2(3., -1.);
  } else if (idx === 2) {
    pos = vec2(-1., 3.);
  }
  return { pos: vec4(pos, 0., 1.), uv: vec2((pos.x + 1.) * 0.5, (pos.y + 1.) * 0.5) };
}

// Fragment — vertical gradient between the two uniform colours, biased. `vo` (not `in`, a
// GLSL reserved word) is the fragment input.
@fragment
export function fs_gradient(vo: VsOut): vec4 {
  const t = vo.uv.y + u.mix_bias;
  const rgb = mix(u.bottom.rgb, u.top.rgb, t);
  return vec4(rgb, f32(1.));
}
