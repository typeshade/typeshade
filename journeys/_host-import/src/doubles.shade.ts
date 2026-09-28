"use typeshade";

// Emulated doubles through the import (change 0013's f64 split): a compute entry whose module
// computes in `f64`, which the WGSL holds as two `f32`s. The host passes `Float64Array`s and
// numbers, the runtime splits and joins them, and binds the `_fp64` guard the emulation reads.
// `deep.shade.ts` is the fragment entry's twin.

class Affine {
  k: f64;
  // A `vec2f64` in a uniform is a `DF64Vec2` struct, which the WGSL aligns to 16 bytes.
  shift: vec2f64;
}

declare const affine: uniform<Affine>;
declare const xs: storage<array<f64>>;
declare const ys: storage<array<f64>, "read_write">;
declare const ps: storage<array<vec3f64>, "read_write">;

@compute([64])
export function axpy(@builtin("global_invocation_id") gid: vec3u) {
  if (gid.x >= xs.length) {
    return;
  }
  ys[gid.x] = xs[gid.x] * affine.k + affine.shift.x + affine.shift.y;
  // A vector of doubles is two planes, `hi` and `lo`, which the runtime writes and reads apart.
  ps[gid.x] = vec3f64(xs[gid.x], affine.k, ys[gid.x]);
}

/** A kernel function over doubles (Rule 8.22): the map and both reductions run on WebGPU, each
 *  double as two f32s, and the reductions fold in the 256-wide tree order (Rule 7.2). */
export function dstats(vs: array<f64>, k: f64): vec2f64 {
  let sum: f64 = 0;
  let lo: f64 = 1e30;
  for (let i: u32 = 0; i < vs.length; i++) {
    vs[i] = vs[i] * k;
    sum += vs[i];
    lo = min(lo, vs[i]);
  }
  return vec2f64(sum, lo);
}
