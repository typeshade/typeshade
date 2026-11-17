"use typeshade";

/* @example
{
  "title": "A kernel that appends with push",
  "blurb": "`strong` appends the index of each element above a threshold with `out.push(i)` (change 0078). The elements land in the order of the iterations on every tier, and `out.length` after the loop is the count appended, which may exceed `out`'s length: the host array is the capacity. On WebGPU the loop runs in three dispatches: each iteration counts its pushes, one workgroup scans the counts into offsets, and each iteration stores its pushes at its offset.",
  "renderable": false,
  "reason": "no entry point"
}
*/

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
