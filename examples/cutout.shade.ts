"use typeshade"

/* @example
{
  "title": "Cutout (source language)",
  "blurb": "`discard` in a helper the fragment entry calls, with `fwidth` softening the rim and `saturate`, `exp2` and `**` shaping the falloff — the example that carries #8 A6's spellings to Tint and a real WebGL2 context. Renders a circular cutout with a radial centre-to-rim gradient.",
  "renderable": true
}
*/

// A `"use typeshade"` sibling of `discard-cutout.ts` (#8 A6). It is the example that carries
// this item's new spellings into the compile gate: `discard` in a helper the FRAGMENT entry
// calls, `fwidth` for the antialiased rim, and `saturate`, `exp2` and `**` shaping the
// falloff. Before it, the gate's verdict said exactly as much about A6 as it did before the
// feature existed — no registered example used any of it.
//
// It carries its own id rather than registering as a twin of `discard-cutout`: the EDSL
// original returns the discarding helper's value straight into the IO struct's constructor to
// pin the shape ANGLE's D3D11 backend miscompiles (#1840), and the rim term here makes the
// two different shaders. What they share is the behaviour a reader checks — discard outside
// the unit circle, a radial gradient inside.
//
// It takes NO uniform, deliberately. A `"use typeshade"` module with a `uniform<T>` emits a
// GLSL ES 3.00 fragment stage that never declares the block (`'U' : undeclared identifier`),
// which is the correctness bug issue #8 parks on its own ticket — and an example that cannot
// link is an example ANGLE never gets to check. Aspect comes from the vertex stage instead,
// which costs this example nothing.

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

class FsOut {
  @location(0) color: vec4
}

// Fullscreen triangle: three vertices covering the screen, with a centred [-1, 1] uv. No
// vertex buffer — the position comes from the vertex index alone.
@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & u32(1)) * 4. - 1.
  const y = f32(vi >> u32(1)) * 4. - 1.
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x, y) }
}

// Discards outside the unit circle; inside, a radial gradient from a bright centre to a dim
// rim, with the rim itself softened over one pixel of screen space.
export function discardOutsideCircle(p: vec2): vec4 {
  const r = length(p)
  if (r > 1.) {
    discard
  }
  const edge = fwidth(r)
  const rim = saturate((1. - r) / (edge + 0.0001))
  const fall = exp2(-r * 2.) * (1. - r ** 2.)
  // Spelled in three steps rather than one nested expression, and with a vector `t` for the
  // mix, because the editor's ambient lib types both shapes as a plain `number`: its
  // `mix<T extends Numeric>(a: T, b: T, t: T)` has no scalar-`t` overload, and vector
  // arithmetic (`vec3 * f32`) yields `number`, which is a TS2345 the moment either result is
  // passed on. Both are language-service gaps in #21's family, not compiler ones — the
  // annotated `const` is the shape TS2322 filtering already covers.
  const tint: vec3 = mix(vec3(0.06, 0.1, 0.35), vec3(1., 1., 1.), vec3(fall, fall, fall))
  const shaded: vec3 = tint * rim
  return vec4(shaded, 1.)
}

@fragment
export function fs(v: VsOut): FsOut {
  return { color: discardOutsideCircle(v.uv) }
}
