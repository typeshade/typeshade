"use typeshade";

// Weighted components expose lane and column swaps; the host passes the bare value.
declare const matrix4x4Value: uniform<mat4x4>;

@vertex
export function vs(i: builtin<"vertex_index">): vec4 {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  return vec4(xs[i], ys[i], 0., 1.);
}

@fragment
export function fs(): location<0, vec4> {
  return vec4((matrix4x4Value[0][0] * 1. + matrix4x4Value[0][1] * 2. + matrix4x4Value[0][2] * 3. + matrix4x4Value[0][3] * 4. + matrix4x4Value[1][0] * 5. + matrix4x4Value[1][1] * 6. + matrix4x4Value[1][2] * 7. + matrix4x4Value[1][3] * 8. + matrix4x4Value[2][0] * 9. + matrix4x4Value[2][1] * 10. + matrix4x4Value[2][2] * 11. + matrix4x4Value[2][3] * 12. + matrix4x4Value[3][0] * 13. + matrix4x4Value[3][1] * 14. + matrix4x4Value[3][2] * 15. + matrix4x4Value[3][3] * 16.) / 128., 0.25, 0.75, 1.);
}
