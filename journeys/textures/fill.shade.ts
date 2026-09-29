"use typeshade";

// The first pass writes a level no colour target of 8 bits or of half floats could hold, into an
// r32float texture: the column x of a 64 pixel target holds 16 * (x + 0.5), from 8 to 1016.

@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  const i = i32(vi);
  return vec4(xs[i], ys[i], 0., 1.);
}

@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  return vec4(p.x * 16., 0., 0., 1.);
}
