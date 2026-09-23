"use typeshade"

/* @example
{
  "title": "Boolean vectors",
  "blurb": "A comparison of two vectors is a vector of bools (§27): `v.uv > vec2(0.5)` masks the screen, `select` picks a colour per channel from two palettes through it, and `all`/`any` of the mask tint the corners. WGSL spells the comparison as an operator, GLSL ES 3.00 as `lessThan`/`greaterThan` with `mix`; the gate runs both.",
  "renderable": true
}
*/

// Boolean vectors (roadmap 0.2 item 7, §27): a comparison of two vectors is componentwise and
// yields a vector of bools, which `select` takes per component and `any`/`all` reduce. The
// mask below picks a colour per channel from two palettes wherever the screen point is past
// the middle on that axis, and `all`/`any` of it choose the corner tint. WGSL spells the
// comparison as an operator and GLSL ES 3.00 as `lessThan(a, b)` with `mix(f, t, mask)` for the
// pick; both go through the compile gate, so the two spellings agree about the picture.

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
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
export function fs(v: VsOut): vec4 {
  const past = v.uv > vec2(0.5, 0.5)
  const cool = vec3(0.1, 0.3, 0.8)
  const warm = vec3(0.9, 0.5, 0.1)
  // Per channel: x past the middle picks red and green, y past it picks blue. Built with the
  // constructor from scalar comparisons, since the editor types `past` as one boolean and
  // cannot follow `past.x`; the compiler takes either spelling.
  const mask = vec3b(v.uv.x > 0.5, v.uv.x > 0.5, v.uv.y > 0.5)
  let color = select(cool, warm, mask)
  if (all(past)) {
    color = color * 1.2
  } else if (!any(past)) {
    color = color * 0.6
  }
  return vec4(color, 1.)
}
