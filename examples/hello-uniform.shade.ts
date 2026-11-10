"use typeshade";

/* @example
{
  "title": "Hello uniform",
  "blurb": "A bare `declare const scale: uniform<f32>` keeps the same numeric host value on both targets. GLSL ES 3.00 places the scalar in a private std140 block; the caller needs no wrapper class.",
  "renderable": true
}
*/

declare const scale: uniform<f32>;

// The gallery draws an explicit stage pair; the host-call fragment still uses its own triangle.
@vertex
export function vs(vi: builtin<"vertex_index">): builtin<"position"> {
  const x = f32((vi << 1) & 2) * 2 - 1;
  const y = f32(vi & 2) * 2 - 1;
  return vec4(x, y, 0, 1);
}

@fragment
export function fs(): vec4 {
  return vec4(scale, 0, 0, 1);
}
