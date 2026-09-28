"use typeshade";

/* @example
{
  "title": "Reductions in a loop",
  "blurb": "A sum, a mean and a variance, and a histogram, each a loop over an array. `s += x` is a reduction: the GPU folds it 256 at a time by the workgroup tree and then the partials the same way, and the CPU tier and the oracle fold it in the same order, so a sum is the same bits on every tier (Rule 7.2). `bins[k] += 1` is a scatter: two iterations may land on one bin, so each add is an atomic on the GPU.",
  "renderable": false,
  "reason": "no entry point"
}
*/

// A variable a loop combines with one of `+ * & | ^ min max`, and reads nowhere else, is a
// reduction. The function's `return` runs after the loops, on the CPU, with what they folded.

export function sum(xs: array<f32>): f32 {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return s;
}

// Two reductions in one loop: the mean and the variance from one pass.
export function meanVariance(xs: array<f32>): vec2 {
  let s = 0.;
  let q = 0.;
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
    const k = min(u32(max((xs[i] - lo) * scale, 0.)), top);
    bins[k] += 1;
  }
}
