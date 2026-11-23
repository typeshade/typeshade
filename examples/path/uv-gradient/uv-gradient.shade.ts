"use typeshade";

/* @example
{
  "title": "UV gradient",
  "blurb": "Step 2 of the learning path. The `position` builtin gives the pixel's place, a uniform carries the canvas size, and a vector divide turns the place into a coordinate from 0 to 1. The swizzle `.xy` takes two components of a `vec4`. The host sets the size once, with `fs(canvas, { frame })`.",
  "renderable": false,
  "reason": "no entry point"
}
*/

// Step 2. The position builtin and the canvas size give each pixel a coordinate from 0 to 1.
interface Frame {
  size: vec2;
}

declare const frame: uniform<Frame>;

@fragment
export function fs(p: builtin<"position">): vec4 {
  const uv = p.xy / frame.size;
  return vec4(uv.x, uv.y, 0.5, 1.0);
}
