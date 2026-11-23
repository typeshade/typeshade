"use typeshade";

/* @example
{
  "title": "First colour",
  "blurb": "Step 1 of the learning path. The smallest program that draws: the `\"use typeshade\"` directive and one `@fragment` entry that returns one colour for every pixel. The host imports `fs` and calls `fs(canvas)`. The same call gives the same pixels on WebGPU, WebGL2 and the CPU tier.",
  "renderable": false,
  "reason": "no entry point"
}
*/

// Step 1. A fragment entry returns one colour for every pixel.
@fragment
export function fs(): vec4 {
  return vec4(0.2, 0.6, 1.0, 1.0);
}
