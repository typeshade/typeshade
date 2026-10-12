"use typeshade";

/* @example
{
  "title": "Host: draw into a canvas",
  "blurb": "A full-screen `@fragment` entry and the host that draws it. The host imports `fs` and calls `fs(canvas, { frame })` once a frame, with the time in the uniform: one full-screen triangle, on WebGPU, then WebGL2, then the CPU tier, with no pipeline, buffer or bind group in the host's code (Rule 8.24).",
  "renderable": false,
  "reason": "no entry point"
}
*/

// What the host sets each frame: the time, and the canvas's size in pixels.
class Frame {
  time: f32;
  size: vec2;
}

declare const frame: uniform<Frame>;

// A full-screen fragment entry reads no builtin but `position`, and writes one colour, so a host
// draws it into a canvas with no vertex entry of its own.
@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  const uv = p.xy / frame.size;
  const wave = 0.5 + 0.5 * sin(6.2831853 * uv.x + frame.time);
  return vec4(uv.x, uv.y, wave, 1.);
}
