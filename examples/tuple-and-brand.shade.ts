"use typeshade"

// Two TypeScript shapes that carry no GPU meaning of their own, and so cost nothing to keep
// (roadmap 0.3 item T10, #92).
//
// A tuple is a list of a length the type fixes, which is exactly what `array<T, N>` is, so
// `[f32, f32]` IS `array<f32, 2>` — the same type, written the way a TypeScript developer
// writes a pair. Both targets take it in every position this file uses: a return, a parameter,
// and a list written at the call site. WGSL spells the function `fn bounds() -> array<f32, 2>`
// and GLSL ES 3.00 spells it `float[2] bounds()`, which ESSL 300 has and ESSL 100 did not.
//
// A brand is the nominal-typing idiom: `f32 & { readonly [m]: 'm' }` is an f32 that only a
// value the file calls Meters may be passed to. The brand carries no data, so it is erased and
// the parameter is an f32. Nothing about either shape reaches the emitted code, which is the
// point: `tsc` enforces them and the GPU never hears about them.

declare const m: unique symbol
type Meters = f32 & { readonly [m]: 'm' }

const HORIZON: f32 = 8.

/** The near and far distance a ray is marched between, as a pair. */
function bounds(scale: Meters): [near: f32, far: f32] {
  return [0.05 * scale, HORIZON * scale]
}

/** The midpoint of a pair, which is where this shader samples. */
function mid(span: [f32, f32]): f32 {
  return (span[0] + span[1]) * 0.5
}

/** The corner of the fullscreen triangle at `i`, as an x and a y. */
function corner(i: i32): [x: f32, y: f32] {
  const xs: array<f32, 3> = [-1., 3., -1.]
  const ys: array<f32, 3> = [-1., -1., 3.]
  return [xs[i], ys[i]]
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  const c = corner(i32(vi))
  return vec4(c[0], c[1], 0., 1.)
}

@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  const uv: vec2 = fract(p.xy * 0.01)
  const span = bounds(uv.x as Meters)
  // A list written straight into a parameter that declares `[f32, f32]`, which is the one
  // position that used to need `array<f32, 2>(...)` spelled out.
  const depth = mid([span[0], span[1]])
  return vec4(uv.x, uv.y, depth / HORIZON, 1.)
}
