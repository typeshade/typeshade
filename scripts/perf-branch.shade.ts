"use typeshade";

// The perf gate's `branch` case (change 0097): a kernel whose loop body chooses between a costly
// helper and the input itself by a condition that holds for one element in four, in runs of 256,
// so that the lanes of a workgroup agree. With `select` the helper runs for every element; with
// the `if` of change 0097 it runs for the quarter alone.

function heavy(x: f32): f32 {
  let s = x;
  s = sin(s) * cos(s * 3.) + sqrt(abs(s)) * exp(-s * s);
  s = s * s + sin(s * 7.) * 0.5 + cos(s * 11.) * 0.25;
  return s;
}

export function branchy(out: array<f32>, xs: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    const x = xs[i];
    out[i] = x > 0.75 ? heavy(x) : x;
  }
}
