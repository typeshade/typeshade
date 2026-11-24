"use typeshade";

// The arrays are the caller's, passed by reference (Rule 8.23). A host that normalizes calls
// `sumOfSquares` and then `scale` with `1 / sqrt(sum)`: a loop that reads what an earlier loop
// of the same function reduces runs on the CPU, so the reduction and its use are two calls.

export function sumOfSquares(xs: array<f32>): f32 {
  return xs.reduce((a, x) => a + x * x, 0);
}

export function scale(xs: array<f32>, out: array<f32>, k: f32) {
  xs.forEach((x, i) => {
    out[i] = x * k;
  });
}

export function firstAbove(xs: array<f32>, t: f32): i32 {
  return xs.findIndex((x) => x > t);
}
