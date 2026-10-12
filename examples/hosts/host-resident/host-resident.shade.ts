"use typeshade";

/* @example
{
  "title": "Host: keep data on the GPU",
  "blurb": "Three kernel functions and a host that chains them over `resident()` arrays. Each `decay` and `accumulate` call only queues: the array stays in its buffer on the device, and the next call binds the same buffer. The host waits once, for `sum`, and reads the array back once, with `read()` (Rule 11.8).",
  "renderable": false,
  "reason": "no entry point"
}
*/

// Each loop writes only its own element, so each runs on the GPU, one invocation per element.
export function decay(k: f32, ys: array<f32>) {
  for (let i: u32 = 0; i < ys.length; i++) {
    ys[i] = ys[i] * k;
  }
}

export function accumulate(xs: array<f32>, ys: array<f32>) {
  for (let i: u32 = 0; i < ys.length; i++) {
    ys[i] = ys[i] + xs[i];
  }
}

// A reduction, folded by the workgroup tree on the GPU.
export function sum(xs: array<f32>): f32 {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return s;
}
