"use typeshade";

// The 0.1 cancellation makes changing the runtime guard observable in the pixel.
declare const double1Value: uniform<f64>;

export const vs = vertex(function vs(i: builtin<"vertex_index", u32>): vec4 {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  return vec4(xs[i], ys[i], 0., 1.);
});

export const fs = fragment(function fs(): location<0, vec4> {
  return vec4(f32((double1Value + f64(0.1) - f64(0.1) - f64(1)) * f64(1073741824)) / 8., 0.25, 0.75, 1.);
});
