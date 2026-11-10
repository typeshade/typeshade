"use typeshade";

// Weighted components expose lane and column swaps; the host passes the bare value.
declare const vectorFloat4Value: uniform<vec4>;

@vertex
export function vs(i: builtin<"vertex_index">): vec4 {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  return vec4(xs[i], ys[i], 0., 1.);
}

@fragment
export function fs(): location<0, vec4> {
  return vec4((vectorFloat4Value.x * 1. + vectorFloat4Value.y * 2. + vectorFloat4Value.z * 3. + vectorFloat4Value.w * 4.) / 4., 0.25, 0.75, 1.);
}
