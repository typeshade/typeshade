"use typeshade";

/* @example
{
  "title": "Host: call a kernel function",
  "blurb": "Two kernel functions and the host that calls them. `exposure` loops over an `array<f32>` and `peak` reduces one; the host calls `await exposure(1.5, pixels)` with a `Float32Array` and `await peak(pixels)` for a number. Each loop the compiler proves independent runs on the GPU, one invocation per iteration, and the array comes back in place (Rule 8.22).",
  "renderable": false,
  "reason": "no entry point"
}
*/

// A kernel function: an exported function that takes an array with no size. Each iteration
// writes only its own element, so the loop runs on the GPU, one invocation per element.
export function exposure(gain: f32, pixels: array<f32>) {
  for (let i: u32 = 0; i < pixels.length; i++) {
    pixels[i] = 1. - exp(-pixels[i] * gain);
  }
}

// A reduction: `m = max(m, x)` is folded by the workgroup tree on the GPU, and the return runs
// on the host with what it folded.
export function peak(xs: array<f32>): f32 {
  let m = 0.;
  for (const x of xs) {
    m = max(m, x);
  }
  return m;
}
