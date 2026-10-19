"use typeshade";

// ═══ typeshade/random: the generators and hashes a kernel draws from (change 0072, §73) ═══
//
// A common module (Rule 11.20): every function is written here, in "use typeshade", and gives on
// WebGPU, on WebGL2 and on the CPU tier the bits the CPU oracle gives. The device face is the
// three scalar helpers, which a "use typeshade" file imports into its own kernel or entry. The
// host face is the two kernel functions, which host code calls over Resident arrays, alone or in
// a fuse scope, and `generator(seed)` of `./generator.ts`, the same hash and the same mapping over
// a counter on the host (decision D5). `./index.ts` is baked from this file by
// `scripts/bake-common-modules.ts`.

/** One step of xorshift32 (shifts 13, 17 and 5). A zero state stays zero: seed with a non-zero
 *  word. */
export function xorshift32(state: u32): u32 {
  let x = state;
  x = x ^ (x << 13);
  x = x ^ (x >> 17);
  x = x ^ (x << 5);
  return x;
}

/** A 32-bit integer finaliser, the `lowbias32` constants, for a stateless draw from an index:
 *  every input word maps to one output word, and near inputs map to far outputs. */
export function hash32(x: u32): u32 {
  let h = x ^ (x >> 16);
  h = h * 0x7feb352d;
  h = h ^ (h >> 15);
  h = h * 0x846ca68b;
  h = h ^ (h >> 16);
  return h;
}

/** The 24 high bits of `word` as an `f32` in [0, 1): `f32(word >> 8) / 2^24`, exact in f32, so
 *  the same word gives the same number on every tier. */
export function uniform(word: u32): f32 {
  return f32(word >> 8) * (1. / 16777216.);
}

/** Element `i` of `out` is `uniform(hash32(seed ^ i))`: the draw depends on the seed and the
 *  index only, not on the tier or the dispatch shape, and `generator(seed)` on the host gives the
 *  same numbers in the same order. */
export function fillUniform(out: array<f32>, seed: u32): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = uniform(hash32(seed ^ i));
}

/** Element `i` of `out` is `hash32(seed ^ i)`: the words `fillUniform` maps to [0, 1), for a
 *  caller that wants the bits (a seed per element, a Bernoulli draw by a mask). */
export function fillWords(out: array<u32>, seed: u32): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = hash32(seed ^ i);
}
