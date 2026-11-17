"use typeshade";

// ═══ typeshade/algorithms: the reductions (change 0072, §72) ═══
//
// A whole reduction is a kernel function with a result (Rule 8.22): its loop folds in Rule 7.2's
// one tree order on every tier, so a sum is the same bits on WebGPU, on WebGL2 and on the CPU
// tier. `max` and `min` are builtins' names, so the kernel functions are `maxAll` and `minAll`
// here and the host face exports them as `max` and `min` (proposal 0072, Amendment 1, the same
// reason as the maps). An axis reduction reads `x` as `[outer, axis, inner]` and writes one loop
// at `i` over `out`, each element a serial fold in ascending `k`, so it fuses with the maps before
// it as far as fact F3 allows and runs apart otherwise.

/** The sum of `x`, folded in the tree order (Rule 7.2). */
export function sum(x: array<f32>): f32 {
  let s: f32 = 0.0;
  for (let i: u32 = 0; i < x.length; i++) s += x[i];
  return s;
}

/** The largest element of `x`, folded in the tree order; `-Infinity` for an empty array is not a
 *  value the tiers share, so the fold starts at the lowest finite `f32`. The host face exports it
 *  as `max`. */
export function maxAll(x: array<f32>): f32 {
  let m: f32 = -3.4028234663852886e38;
  for (let i: u32 = 0; i < x.length; i++) m = max(m, x[i]);
  return m;
}

/** The smallest element of `x`, folded in the tree order from the highest finite `f32`. The host
 *  face exports it as `min`. */
export function minAll(x: array<f32>): f32 {
  let m: f32 = 3.4028234663852886e38;
  for (let i: u32 = 0; i < x.length; i++) m = min(m, x[i]);
  return m;
}

/** `out[o * inner + n] = Σ_k x[(o * axis + k) * inner + n]`, in ascending `k`. */
export function sumAxis(out: array<f32>, x: array<f32>, axis: u32, inner: u32): void {
  for (let i: u32 = 0; i < out.length; i++) {
    const o = i / inner;
    const n = i % inner;
    let s: f32 = 0.0;
    for (let k: u32 = 0; k < axis; k++) s = s + x[(o * axis + k) * inner + n];
    out[i] = s;
  }
}

/** The sum along the axis divided by `axis`. */
export function meanAxis(out: array<f32>, x: array<f32>, axis: u32, inner: u32): void {
  for (let i: u32 = 0; i < out.length; i++) {
    const o = i / inner;
    const n = i % inner;
    let s: f32 = 0.0;
    for (let k: u32 = 0; k < axis; k++) s = s + x[(o * axis + k) * inner + n];
    out[i] = s / f32(axis);
  }
}

/** The product along the axis, in ascending `k`. */
export function prodAxis(out: array<f32>, x: array<f32>, axis: u32, inner: u32): void {
  for (let i: u32 = 0; i < out.length; i++) {
    const o = i / inner;
    const n = i % inner;
    let p: f32 = 1.0;
    for (let k: u32 = 0; k < axis; k++) p = p * x[(o * axis + k) * inner + n];
    out[i] = p;
  }
}

/** The largest element along the axis. */
export function maxAxis(out: array<f32>, x: array<f32>, axis: u32, inner: u32): void {
  for (let i: u32 = 0; i < out.length; i++) {
    const o = i / inner;
    const n = i % inner;
    let m: f32 = x[o * axis * inner + n];
    for (let k: u32 = 1; k < axis; k++) m = max(m, x[(o * axis + k) * inner + n]);
    out[i] = m;
  }
}

/** The smallest element along the axis. */
export function minAxis(out: array<f32>, x: array<f32>, axis: u32, inner: u32): void {
  for (let i: u32 = 0; i < out.length; i++) {
    const o = i / inner;
    const n = i % inner;
    let m: f32 = x[o * axis * inner + n];
    for (let k: u32 = 1; k < axis; k++) m = min(m, x[(o * axis + k) * inner + n]);
    out[i] = m;
  }
}

/** The index along the axis of the largest element, as an `f32`; the first largest wins a tie. */
export function argMaxAxis(out: array<f32>, x: array<f32>, axis: u32, inner: u32): void {
  for (let i: u32 = 0; i < out.length; i++) {
    const o = i / inner;
    const n = i % inner;
    let best: f32 = x[o * axis * inner + n];
    let at: u32 = 0;
    for (let k: u32 = 1; k < axis; k++) {
      const v = x[(o * axis + k) * inner + n];
      if (v > best) {
        best = v;
        at = k;
      }
    }
    out[i] = f32(at);
  }
}

/** The index along the axis of the smallest element, as an `f32`; the first smallest wins a
 *  tie. */
export function argMinAxis(out: array<f32>, x: array<f32>, axis: u32, inner: u32): void {
  for (let i: u32 = 0; i < out.length; i++) {
    const o = i / inner;
    const n = i % inner;
    let best: f32 = x[o * axis * inner + n];
    let at: u32 = 0;
    for (let k: u32 = 1; k < axis; k++) {
      const v = x[(o * axis + k) * inner + n];
      if (v < best) {
        best = v;
        at = k;
      }
    }
    out[i] = f32(at);
  }
}
