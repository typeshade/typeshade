"use typeshade";

// Weighted components expose lane and column swaps; the host passes the bare value.
declare const scalarUintValue: uniform<u32>;

export const vs = vertex(function vs(i: builtin<"vertex_index", u32>): vec4 {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  return vec4(xs[i], ys[i], 0., 1.);
});

export const fs = fragment(function fs(): location<0, vec4> {
  return vec4((f32(scalarUintValue) * 1.) / 16., 0.25, 0.75, 1.);
});
