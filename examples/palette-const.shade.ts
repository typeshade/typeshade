"use typeshade"

/* @example
{
  "title": "Module vector and array constants",
  "blurb": "A fullscreen triangle banded by a module-scope `array<vec4, 3>` palette and an `array<f32, 3>` of stops, with a `vec3` constant built from an earlier scalar one — every shape a module constant can now take, read from both stages.",
  "renderable": true
}
*/

// The gated example for module-level vector and array constants (#8 A9). Nothing the compile
// gate emitted declared one, so the gate said as much about A9 as it did before A9 existed.
// Every kind this item adds is here: a bare vector const, an annotated one, a float array, an
// array of vectors, and a vector built out of an earlier constant — declared at module scope
// and read from both stages, so Tint sees the WGSL `const` and ANGLE the GLSL one.
//
// The constants are all f32-element. An INTEGER module const still emits as a float literal
// (`const N: i32 = 4` → `4.0`), which is issue #13 and #17's fix, so an example that used one
// could not compile on either backend yet.

const UP = vec3(0., 1., 0.)
const SKY: vec4 = vec4(0.36, 0.55, 0.85, 1.)
const STOPS: array<f32, 3> = array<f32, 3>(0.2, 0.5, 0.8)
const PALETTE = array<vec4, 3>(
  vec4(0.95, 0.55, 0.2, 1.),
  vec4(0.2, 0.7, 0.45, 1.),
  vec4(0.55, 0.3, 0.8, 1.),
)
const HALF: f32 = 0.5
const GREY = vec3(HALF, HALF, HALF)

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

class Color {
  @location(0) color: vec4
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & u32(1)) * 4. - 1.
  const y = f32(vi >> u32(1)) * 4. - 1.
  // UP.y is 1., so this is the same triangle with the constant read once per vertex.
  return { pos: vec4(x, y * UP.y, 0., 1.), uv: vec2(x, y) }
}

@fragment
export function fs(v: VsOut): Color {
  const t = v.uv.x * HALF + HALF
  let band: vec4 = SKY
  if (t > STOPS[0]) {
    band = PALETTE[0]
  }
  if (t > STOPS[1]) {
    band = PALETTE[1]
  }
  if (t > STOPS[2]) {
    band = PALETTE[2]
  }
  const tinted: vec3 = band.rgb * HALF + GREY * HALF
  return { color: vec4(tinted, 1.) }
}
