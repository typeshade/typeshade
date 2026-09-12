"use typeshade"

declare const scale: uniform<f32>

@fragment
export function fs(): vec4 {
  return vec4(scale, 0., 0., 1.)
}
