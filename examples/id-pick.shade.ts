"use typeshade"

// Entry IO as WGSL declares it (§53): an INTEGER varying, an explicit `@interpolate`, and
// `@invariant` on the position.
//
// The integer varying is the row this example exists for. WGSL requires every integral
// user-defined IO to carry `@interpolate(flat)` — there is no way to interpolate a `u32` — and
// the compiler emitted `@location(0) id: u32,` bare, which Tint refuses with "integral
// user-defined vertex output must have a flat interpolation attribute". GLSL ES 3.00 says the
// same thing (`flat in uint`), and the GLSL writer had always added the qualifier, so the two
// targets disagreed about a program neither author nor compiler had written down. The
// attribute is derived now, from the type, on both writers.
//
// `@interpolate("perspective", "centroid")` on the uv is the spelling that passes through:
// WGSL takes the pair as written, GLSL ES 3.00 spells it `smooth centroid`. `@invariant` on
// the position is WGSL's promise that a second pipeline computes it the same way, which GLSL
// spells `invariant gl_Position;`.

class VsOut {
  @builtin("position") @invariant pos: vec4
  // The integer varying. No @interpolate here: the compiler derives `flat` because the type
  // is integral, which is the only interpolation either target has for one.
  @location(0) id: u32
  // A float varying that says how it is interpolated, rather than taking the default.
  @location(1) @interpolate("perspective", "centroid") uv: vec2
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const xs: array<f32, 3> = [-1., 3., -1.]
  const ys: array<f32, 3> = [-1., -1., 3.]
  const i = i32(vi)
  const p: vec2 = vec2(xs[i], ys[i])
  return { pos: vec4(p, 0., 1.), id: vi + u32(1), uv: p * 0.5 + vec2(0.5, 0.5) }
}

@fragment
export function fs(v: VsOut): vec4 {
  // The id arrives whole, the same value for every fragment of the triangle, which is what
  // `flat` means and why an integer varying may not be anything else.
  const band: f32 = f32(v.id & u32(3)) / 3.
  const grid: vec2 = fract(v.uv * 8.)
  const line: f32 = 1. - step(0.06, min(grid.x, grid.y))
  return vec4(band, v.uv.x * 0.5, v.uv.y * 0.5, 1.) + vec4(line * 0.4, line * 0.4, line * 0.4, 0.)
}
