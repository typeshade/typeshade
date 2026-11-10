"use typeshade";

// Weighted components expose lane and column swaps; the host passes the bare value.
declare const vectorFloat2Value: uniform<vec2>;

@vertex
export function vs(i: builtin<"vertex_index">): vec4 {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  return vec4(xs[i], ys[i], 0., 1.);
}

@fragment
export function fs(): location<0, vec4> {
  return vec4((vectorFloat2Value.x * 1. + vectorFloat2Value.y * 2.) / 4., 0.25, 0.75, 1.);
}
