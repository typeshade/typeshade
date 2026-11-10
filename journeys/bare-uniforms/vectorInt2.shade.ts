"use typeshade";

// Weighted components expose lane and column swaps; the host passes the bare value.
declare const vectorInt2Value: uniform<vec2i>;

@vertex
export function vs(i: builtin<"vertex_index", u32>): vec4 {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  return vec4(xs[i], ys[i], 0., 1.);
}

@fragment
export function fs(): location<0, vec4> {
  return vec4((f32(vectorInt2Value.x) * 1. + f32(vectorInt2Value.y) * 2.) / 64. + 0.5, 0.25, 0.75, 1.);
}
