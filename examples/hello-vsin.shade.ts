"use typeshade";

/* @example
{
  "title": "Hello vertex attributes",
  "blurb": "Vertex input from a buffer rather than from `vertex_index`: a `VsIn` interface of vertex attributes, numbered in the order written, becomes GLSL `in` declarations and WGSL struct parameters from the one declaration.",
  "renderable": true
}
*/

interface VsIn {
  position: vec3;
  uv: vec2;
}

interface VsOut {
  pos: builtin<"position">;
  uv: vec2;
}

interface Color {
  color: vec4;
}

@vertex
export function vs(vin: VsIn): VsOut {
  return { pos: vec4(vin.position, 1), uv: vin.uv };
}

@fragment
export function fs(v: VsOut): Color {
  return { color: vec4(v.uv, 0.2, 1) };
}
