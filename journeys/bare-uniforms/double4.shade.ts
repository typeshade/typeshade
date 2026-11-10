"use typeshade";

// Weighted components expose lane and column swaps; the host passes the bare value.
declare const double4Value: uniform<vec4f64>;

@vertex
export function vs(i: builtin<"vertex_index">): vec4 {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  return vec4(xs[i], ys[i], 0., 1.);
}

@fragment
export function fs(): location<0, vec4> {
  return vec4(f32((double4Value.x - f64(1)) * f64(1073741824) + (double4Value.y - f64(1)) * f64(2147483648) + (double4Value.z - f64(1)) * f64(3221225472) + (double4Value.w - f64(1)) * f64(4294967296)) / 64., 0.25, 0.75, 1.);
}
