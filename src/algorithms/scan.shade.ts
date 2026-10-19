"use typeshade";

// ═══ typeshade/algorithms: scan, compaction and histogram (change 0072, §72) ═══
//
// The scan is two loops of one kernel function (proposal 0072, Amendment 1): the first writes the
// sum of each block of `x` into `sums`, the second writes each element's prefix within its block
// plus the sums of the blocks before it. Neither has a barrier, so every tier runs them and they
// join a fuse scope. The block is `ceil(x.length / sums.length)`, so a caller that passes a `sums`
// of about `sqrt(x.length)` elements pays about `2 * n * sqrt(n)` reads. A workgroup-memory scan
// is a later delivery (decision D6).
//
// Compaction writes at `i` and finds its source by a binary search over the inclusive count
// `offsets[k] + flags[k]`, since a scatter to `offsets[i]` is a write at an index two iterations
// could share, which runs on the CPU only (Rule 8.22, R3). The histogram scatters by atomics, as
// `examples/loop-reduction.shade.ts` does; it adds into `bins`, which the caller zeroes.

/** `out[i] = Σ_{t < i} x[t]`, the exclusive prefix sum. `sums` is the caller's scratch of at least
 *  one element, one block sum each; the block is `ceil(x.length / sums.length)`. */
export function exclusiveScan(out: array<u32>, x: array<u32>, sums: array<u32>): void {
  const n = x.length;
  const block = (n + sums.length - 1) / sums.length;
  for (let j: u32 = 0; j < sums.length; j++) {
    let s: u32 = 0;
    const start = j * block;
    for (let k: u32 = 0; k < block; k++) {
      const t = start + k;
      if (t < n) s = s + x[t];
    }
    sums[j] = s;
  }
  for (let i: u32 = 0; i < out.length; i++) {
    const b = i / block;
    let s: u32 = 0;
    for (let k: u32 = 0; k < b; k++) s = s + sums[k];
    for (let t: u32 = b * block; t < i; t++) s = s + x[t];
    out[i] = s;
  }
}

/** `out[i] = Σ_{t <= i} x[t]`, the inclusive prefix sum, with `sums` as `exclusiveScan` takes
 *  it. */
export function inclusiveScan(out: array<u32>, x: array<u32>, sums: array<u32>): void {
  const n = x.length;
  const block = (n + sums.length - 1) / sums.length;
  for (let j: u32 = 0; j < sums.length; j++) {
    let s: u32 = 0;
    const start = j * block;
    for (let k: u32 = 0; k < block; k++) {
      const t = start + k;
      if (t < n) s = s + x[t];
    }
    sums[j] = s;
  }
  for (let i: u32 = 0; i < out.length; i++) {
    const b = i / block;
    let s: u32 = 0;
    for (let k: u32 = 0; k < b; k++) s = s + sums[k];
    for (let t: u32 = b * block; t <= i; t++) s = s + x[t];
    out[i] = s;
  }
}

/** The elements of `x` whose flag is 1, in their order, where `offsets` is the exclusive scan of
 *  `flags`: `out[offsets[k]] = x[k]` for each flagged `k`, and 0 past the count of kept elements.
 *  Written as a gather at `i`: the source of `out[i]` is the first `k` whose inclusive count
 *  `offsets[k] + flags[k]` exceeds `i`, found by a binary search. */
export function compact(out: array<f32>, x: array<f32>, flags: array<u32>, offsets: array<u32>): void {
  const n = x.length;
  for (let i: u32 = 0; i < out.length; i++) {
    let lo: u32 = 0;
    let hi: u32 = n;
    while (lo < hi) {
      const mid = lo + (hi - lo) / 2;
      if (offsets[mid] + flags[mid] > i) hi = mid;
      else lo = mid + 1;
    }
    out[i] = lo < n ? x[lo] : 0.0;
  }
}

/** Adds the count of `x` in each of `bins.length` equal bins over `[lo, hi)` into `bins`; a value
 *  below `lo` counts in the first bin and one at or above `hi` in the last. Each add is an atomic
 *  on a GPU and a plain add on the CPU tier, in iteration order. The caller zeroes `bins`. */
export function histogram(bins: array<u32>, x: array<f32>, lo: f32, hi: f32): void {
  const top = bins.length - 1;
  const scale = f32(bins.length) / (hi - lo);
  for (let i: u32 = 0; i < x.length; i++) {
    const k = min(u32(max((x[i] - lo) * scale, 0.0)), top);
    bins[k] += 1;
  }
}
