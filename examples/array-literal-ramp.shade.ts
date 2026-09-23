"use typeshade"

/* @example
{
  "title": "Array literals",
  "blurb": "A fullscreen triangle whose corners come from two `array<f32, 3>` lists and whose colour comes from an `array<vec3, 3>` of stops weighted by an `array<i32, 3>` — a list at every element type the initializer form takes, through Tint and a real WebGL2 context.",
  "renderable": true
}
*/

// The gated example for a list as a local array's initializer (#8 A16). Before it, nothing the
// compile gate emits wrote `[...]`, so the gate said as much about A16 as it did before A16
// existed. Both stages go to a real compiler: WGSL to Tint, GLSL ES 3.00 to a WebGL2 context
// that also links the pair — which is what makes `float[3](…)` more than a string this
// repository agrees with itself about.
//
// It writes the list at every element type the form accepts: `array<f32, 3>` stops in the
// vertex stage, `array<vec3, 3>` colours in the fragment stage, and an `array<i32, 3>` of
// weights whose elements are written as plain integers — the spelling the `array<i32, 3>(…)`
// call cannot give, since it lowers each argument on its own and emits float literals there.
// It takes no uniform, so nothing else has to be right for the gate to reach the lists.

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

class Color {
  @location(0) color: vec4
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const xs: array<f32, 3> = [-1., 3., -1.]
  const ys: array<f32, 3> = [-1., -1., 3.]
  const i = i32(vi)
  const p: vec2 = vec2(xs[i], ys[i])
  return { pos: vec4(p, 0., 1.), uv: p * 0.5 + vec2(0.5, 0.5) }
}

@fragment
export function fs(v: VsOut): Color {
  // A list of vectors, and a list of integers written without a decimal point.
  const stops: array<vec3, 3> = [vec3(0.1, 0.1, 0.35), vec3(0.9, 0.4, 0.2), vec3(1., 0.95, 0.7)]
  const weights: array<i32, 3> = [1, 2, 1]
  // `i32(2)`, not `2`: an integer literal takes its type from the position around it only
  // once #8 A3 lands; until then a bare `2` here is an f32 and the assignment is a mismatch.
  let band = i32(v.uv.x * 3.)
  if (band > i32(2)) {
    band = i32(2)
  }
  const w = f32(weights[band]) * 0.25
  const c: vec3 = stops[band] * (0.75 + w)
  return { color: vec4(c, 1.) }
}
