"use typeshade";

// Weighted components expose lane and column swaps; the host passes the bare value.
declare const vectorFloat3Value: uniform<vec3>;

@vertex
export function vs(i: builtin<"vertex_index">): vec4 {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  return vec4(xs[i], ys[i], 0., 1.);
}

@fragment
export function fs(): location<0, vec4> {
  return vec4((vectorFloat3Value.x * 1. + vectorFloat3Value.y * 2. + vectorFloat3Value.z * 3.) / 4., 0.25, 0.75, 1.);
}
