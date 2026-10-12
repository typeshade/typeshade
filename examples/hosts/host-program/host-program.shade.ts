"use typeshade";

/* @example
{
  "title": "Host: run the compiled program",
  "blurb": "A vertex and a fragment entry, and a host that runs them as an engine does. The module's default export is its manifest; the host loads it with `rt.load()` on the program runtime, makes a render pipeline, and draws a full-screen triangle into a texture each frame, binding the uniform by name. Then it reads the texture back (Rules 11.10, 11.11).",
  "renderable": true
}
*/

class Sky {
  size: vec2;
  time: f32;
}

declare const sky: uniform<Sky>;

class VsOut {
  @builtin("position") pos: vec4;
}

class Color {
  @location(0) color: vec4;
}

// Three vertices that cover the target: the host draws `{ count: 3 }` and binds no vertex buffer.
@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(i32(vi) / 2) * 4. - 1.;
  const y = f32(i32(vi) % 2) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.) };
}

@fragment
export function fs(@builtin("position") p: vec4): Color {
  const uv = p.xy / sky.size;
  return { color: vec4(uv.x, 1. - uv.y, 0.5 + 0.5 * cos(sky.time), 1.) };
}
