"use typeshade";

// A variable a loop combines with one of `+ * & | ^ min max`, and reads nowhere else, is a
// reduction. The function's `return` runs after the loops, on the CPU, with what they folded.

export function sum(xs: array<f32>): f32 {
  let s = 0;
  for (const x of xs) {
    s += x;
  }
  return s;
}

// Two reductions in one loop: the mean and the variance from one pass.
export function meanVariance(xs: array<f32>): vec2 {
  let s = 0;
  let q = 0;
  for (const x of xs) {
    s += x;
    q += x * x;
  }
  const n = f32(xs.length);
  const mean = s / n;
  return vec2(mean, q / n - mean * mean);
}

// A scatter into an integer array: `bins` comes back with the counts added.
export function histogram(xs: array<f32>, bins: array<u32>, lo: f32, scale: f32) {
  const top = bins.length - 1;
  for (let i: u32 = 0; i < xs.length; i++) {
    const k = min(u32(max((xs[i] - lo) * scale, 0)), top);
    bins[k] += 1;
  }
}
