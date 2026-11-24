"use typeshade";

// The host passes the capacity and reads the count: `const n = await strong(xs, 0.5, out)`, and
// `out[0 .. min(n, out.length))` hold the indices in ascending order.

export function strong(xs: array<f32>, t: f32, out: array<u32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] > t) {
      out.push(i);
    }
  }
  return out.length;
}
