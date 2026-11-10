"use typeshade";

/* @example
{
  "title": "Hello uniform block",
  "blurb": "A `Uniforms` class behind `uniform<T>` groups several values in one std140 block on both targets. Both stages read the same binding. This was the first source-compiled example with a binding and a renderable GLSL pair, the configuration whose absence let #14 hide.",
  "renderable": true
}
*/

// A struct behind `uniform<T>` groups several values in a std140 block on both targets.
// `hello-uniform` shows a single bare value, which now also emits and links on WebGL2 (0127).
//
// It is also the configuration whose absence let #14 hide: a source-compiled example with a
// binding AND a renderable GLSL pair. The three renderable `.shade.ts` examples had no
// bindings, and the two with bindings were `renderable: false`, so no source-compiled
// uniform declaration ever reached the compile gate or the per-stage GLSL sweep.

class Uniforms {
  tint: vec4;
  gain: f32;
}

declare const u: uniform<Uniforms>;

interface VsOut {
  pos: builtin<"position">;
  uv: vec2;
}

// Oversized fullscreen triangle — 3 verts, no vertex buffer. `u.gain` is applied HERE
// rather than in the fragment stage so the VERTEX source mentions the binding too: a gate
// that only ever sees a binding read from one stage cannot tell a per-stage reachability
// bug from a working walk, which is the gap #14 hid in. The clip position is untouched, so
// the triangle still covers the screen whatever the host sets `gain` to.
@vertex
export function vs(idx: builtin<"vertex_index">): VsOut {
  const x = f32(idx & 1) * 4. - 1.;
  const y = f32(idx >> 1) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x * 0.5 + 0.5, (y * 0.5 + 0.5) * u.gain) };
}

@fragment
export function fs(vo: VsOut): vec4 {
  // TypeScript types `v * s` as `number`, so handing the product straight to
  // `vec4(v: vec3, w: number)` used to draw TS2345 in the editor on a program that compiles,
  // which is why this local is annotated (issue #43). The language service now filters that
  // diagnostic, so the one-line form reads clean too; the annotated local stays because the
  // emitted WGSL and GLSL goldens are pinned to this shape.
  const rgb: vec3 = u.tint.rgb * vo.uv.y;
  return vec4(rgb, u.tint.a);
}
