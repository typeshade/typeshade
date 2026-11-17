"use typeshade";

// Five operations of a chain, each a kernel function (change 0013): a loop over an array, with
// no @compute, no binding and no global_invocation_id. A host calls them one after another, and
// a call inside `fuse` (change 0058) is recorded and runs with the others as one plan. A chain of
// `add`, `mul` and `relu` is one dispatch, since each call reads what the one before it wrote at
// the same index. `pairsum` reads an element and its pair, `t[i ^ 1]`, and the element of its pair
// is written by another invocation: it cannot share a dispatch with the call that wrote `t`.
// `total` reduces: it is the last call of its group, and the calls before it are the prologue of
// each of its iterations, so that `add`, `mul` and `total` are one loop dispatch and the folds of
// its partials.

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

export function pairsum(out: array<f32>, t: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = t[i] + t[i ^ 1];
  }
}

export function total(xs: array<f32>): f32 {
  let s = 0.;
  for (let i: u32 = 0; i < xs.length; i++) {
    s += xs[i];
  }
  return s;
}
