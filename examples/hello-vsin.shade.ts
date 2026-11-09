"use typeshade";

/* @example
{
  "title": "Hello vertex attributes",
  "blurb": "Vertex input from a buffer rather than from `vertex_index`: a `VsIn` interface of `location<…>`-typed attributes becomes GLSL `in` declarations and WGSL struct parameters from the one declaration.",
  "renderable": true
}
*/

interface VsIn {
  position: location<0, vec3>;
  uv: location<1, vec2>;
}

interface VsOut {
  pos: builtin<"position", vec4>;
  uv: location<0, vec2>;
}

interface Color {
  color: location<0, vec4>;
}

@vertex
export function vs(vin: VsIn): VsOut {
  return { pos: vec4(vin.position, 1.), uv: vin.uv };
}

@fragment
export function fs(v: VsOut): Color {
  return { color: vec4(v.uv, 0.2, 1.) };
}
