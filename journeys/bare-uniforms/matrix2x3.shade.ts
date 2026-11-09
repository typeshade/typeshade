"use typeshade";

// Weighted components expose lane and column swaps; the host passes the bare value.
declare const matrix2x3Value: uniform<mat2x3>;

@vertex
export function vs(i: builtin<"vertex_index", u32>): vec4 {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  return vec4(xs[i], ys[i], 0., 1.);
}

@fragment
export function fs(): location<0, vec4> {
  return vec4((matrix2x3Value[0][0] * 1. + matrix2x3Value[0][1] * 2. + matrix2x3Value[0][2] * 3. + matrix2x3Value[1][0] * 4. + matrix2x3Value[1][1] * 5. + matrix2x3Value[1][2] * 6.) / 128., 0.25, 0.75, 1.);
}
