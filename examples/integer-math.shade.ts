"use typeshade"

// The integer `abs` and `dot`, and the scalar conversions (§45). Both builtins were spelled
// identically on every target for every element kind, which is a lie for two of the forms:
// GLSL ES 3.00 has no `abs(uint)` and no integer `dot` at all. Measured on a WebGL2 driver,
// each of `abs(uvec3)`, `abs(uint)`, `dot(ivec3, ivec3)` and `dot(uvec3, uvec3)` is "no
// matching overloaded function found", while `abs(ivec3)` and `dot(vec3, vec3)` compile.
//
// So this example is a gate witness for the fix rather than a picture: it runs on both halves,
// and the GLSL half only links because `abs` on an unsigned value became the identity and the
// integer `dot` became the `_idot` helper. A signed `abs` and a float `dot` are in here too, as
// the controls — they keep the portable spelling, and a change that broke that would show up
// here as a compile failure rather than as nothing.

class Grid {
  origin: vec2i
  span: vec2u
}

declare const grid: uniform<Grid>

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const xs = array(-1., 3., -1.)
  const ys = array(-1., -1., 3.)
  const i = i32(vi)
  const p: vec2 = vec2(xs[i], ys[i])
  return { pos: vec4(p, 0., 1.), uv: p * 0.5 + vec2(0.5, 0.5) }
}

@fragment
export function fs(v: VsOut): vec4 {
  // The texel this fragment covers, as a signed and as an unsigned vector.
  const at: vec2i = vec2i(i32(v.uv.x * 64.), i32(v.uv.y * 64.))
  const cell: vec2u = vec2u(u32(at.x), u32(at.y))

  // UNSIGNED abs: the identity on both targets, and no `abs(uvec2)` in the GLSL.
  const magnitude: vec2u = abs(cell)
  const width: u32 = abs(grid.span.x)

  // SIGNED abs: real GLSL, so it keeps the portable spelling. The control.
  const offset: vec2i = abs(at - grid.origin)

  // INTEGER dot, both signednesses: the `_idot` helper on GLSL, `dot` on WGSL.
  const squared: i32 = dot(offset, offset)
  const spread: u32 = dot(magnitude, magnitude)

  // FLOAT dot: the portable spelling, the other control.
  const radial: f32 = dot(v.uv - vec2(0.5, 0.5), v.uv - vec2(0.5, 0.5))

  // A conversion of a literal the target can hold, and the zero value beside it.
  const scale: f32 = f32(4096)
  const base = f32()

  const rings: f32 = f32(squared % 97) / 97.
  const bands: f32 = f32(spread % u32(53)) / 53.
  const edge: f32 = f32(width % u32(7)) / 7.
  return vec4(rings, bands, base + edge * 0.5 + radial * 0.5, 1. - f32(squared) / scale * 0.)
}
