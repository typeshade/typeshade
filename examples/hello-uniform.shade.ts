"use typeshade";

/* @example
{
  "title": "Hello uniform",
  "blurb": "A bare `declare const scale: uniform<f32>` — the shortest resource declaration there is. WGSL takes a loose scalar uniform; GLSL ES 3.00 has no std140 block to put one in, so this example emits WGSL alone.",
  "renderable": false,
  "reason": "uniform binding 'scale' must be a struct (a std140 UBO block)"
}
*/

declare const scale: uniform<f32>;

@fragment
export function fs(): vec4 {
  return vec4(scale, 0., 0., 1.);
}
