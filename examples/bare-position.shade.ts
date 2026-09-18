"use typeshade"

// The smallest render pair there is: a vertex entry that returns the clip position and nothing
// else, and a fragment entry that returns one colour. A vertex return typed `vec4` carries
// `@builtin(position)` on its own, so no struct is needed to say so, and nothing travels
// between the stages.
//
// Both targets take it. On WGSL the return reads `-> @builtin(position) vec4<f32>`; on GLSL ES
// 3.00 it is `gl_Position`, which is not a varying and links nothing. The GLSL emitter used to
// refuse every bare non-struct vertex output, because a bare VARYING cannot link by name across
// the two stages, and that refusal was wider than its reason: it cost the simplest vertex
// shader there is its WebGL2 target, on a program Tint accepts. This example is the gate's
// evidence that the pair compiles and links.

@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  const xs: array<f32, 3> = [-1., 3., -1.]
  const ys: array<f32, 3> = [-1., -1., 3.]
  const i = i32(vi)
  return vec4(xs[i], ys[i], 0., 1.)
}

@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  const uv: vec2 = fract(p.xy * 0.01)
  return vec4(uv, 0.4, 1.)
}
