"use typeshade";

/* @example
{
  "title": "Host: one helper on the CPU and the GPU",
  "blurb": "A terrain `height` function that the fragment entry draws on the GPU and the host calls on the CPU. The host draws the terrain with `fs(canvas, { view })`, then calls `height([u, v])` for the height under the cursor: a plain number, from the same code at `f32` precision, with no read of the canvas (surface §64).",
  "renderable": false,
  "reason": "no entry point"
}
*/

class View {
  size: vec2;
}

declare const view: uniform<View>;

// An ordinary exported function: the fragment entry calls it on the GPU, and a host that imports
// the module calls it on the CPU.
export function height(p: vec2): f32 {
  return 0.5 + 0.25 * sin(6.2831853 * p.x) * cos(6.2831853 * p.y);
}

@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  const h = height(p.xy / view.size);
  return vec4(h, h, h, 1.);
}
