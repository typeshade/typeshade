"use typeshade";

// Two kernel functions whose loops the subgroup variant folds inside a subgroup (change 0119):
// an integer sum, stored after the loop, and a histogram over eight bins. Nothing here names a
// subgroup: the compiler emits the variant beside the tree text, and the runtime dispatches it
// where the device has the `subgroups` feature and passed the probe. The journey's reference
// is the same sum and the same bins in plain JavaScript, and the two must agree to the bit.

/** The sum of every element, written to `out[0]`. */
export function total(xs: array<u32>, out: array<u32>): void {
  let s: u32 = 0;
  for (let i: u32 = 0; i < xs.length; i++) s += xs[i];
  out[0] = s;
}

/** How many elements fall in each of eight bins, by the low three bits, and the sum of the
 *  elements above a threshold in each bin: two scatters into one array of 16 counters. */
export function histogram(xs: array<u32>, bins: array<u32>, threshold: u32): void {
  for (let i: u32 = 0; i < xs.length; i++) {
    const b = xs[i] & 7;
    bins[b] += 1;
    if (xs[i] > threshold) bins[8 + b] += xs[i];
  }
}

/** The least and the greatest element, written to `out[0]` and `out[1]`. */
export function extremes(xs: array<i32>, out: array<i32>): void {
  let lo: i32 = 2147483647;
  let hi: i32 = -2147483648;
  for (let i: u32 = 0; i < xs.length; i++) {
    lo = min(lo, xs[i]);
    hi = max(hi, xs[i]);
  }
  out[0] = lo;
  out[1] = hi;
}
