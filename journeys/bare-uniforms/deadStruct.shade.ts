"use typeshade";

// The driver may remove this block after seeing that its value cannot affect the pixel.
interface Params { value: f32; }
declare const deadStructValue: uniform<Params>;

@vertex
export function vs(i: builtin<"vertex_index">): vec4 {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  return vec4(xs[i], ys[i], 0., 1.);
}

@fragment
export function fs(): location<0, vec4> {
  return vec4(deadStructValue.value * 0. + 0.25, 0.25, 0.75, 1.);
}
