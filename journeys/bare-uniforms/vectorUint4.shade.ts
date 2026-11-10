"use typeshade";

// Weighted components expose lane and column swaps; the host passes the bare value.
declare const vectorUint4Value: uniform<vec4u>;

@vertex
export function vs(i: builtin<"vertex_index", u32>): vec4 {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  return vec4(xs[i], ys[i], 0., 1.);
}

@fragment
export function fs(): location<0, vec4> {
  return vec4((f32(vectorUint4Value.x) * 1. + f32(vectorUint4Value.y) * 2. + f32(vectorUint4Value.z) * 3. + f32(vectorUint4Value.w) * 4.) / 64., 0.25, 0.75, 1.);
}
