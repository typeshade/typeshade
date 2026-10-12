"use typeshade";

/* @example
{
  "title": "Host: fuse a chain of kernel calls",
  "blurb": "Four kernel functions and a host that calls them inside `fuse()` from `typeshade/fuse`. The calls `add`, `mul` and `relu` each read what the one before wrote at the same index, so on WebGPU the scope runs them as one dispatch, and the report says so. `pairsum` reads `t[i ^ 1]`, an element another invocation writes, so a scope with it in the middle runs two dispatches, and the report names the line (change 0058).",
  "renderable": false,
  "reason": "no entry point"
}
*/

// Four operations of a chain, each a kernel function: a loop over arrays with no size. Each
// iteration of add, mul and relu reads and writes only element i, so a chain of them can run as
// one loop, one invocation per element.

export function add(out: array<f32>, a: array<f32>, b: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i] + b[i];
  }
}

export function mul(out: array<f32>, a: array<f32>, b: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i] * b[i];
  }
}

export function relu(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = max(x[i], 0.);
  }
}

// pairsum reads an element and its pair. Another invocation writes the pair, so pairsum cannot
// share a dispatch with the call that wrote `t`.
export function pairsum(out: array<f32>, t: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = t[i] + t[i ^ 1];
  }
}
