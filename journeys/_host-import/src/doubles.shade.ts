"use typeshade";

// Emulated doubles through the import (change 0013's f64 split): a compute entry whose module
// computes in `f64`, which the WGSL holds as two `f32`s. The host passes `Float64Array`s and
// numbers, the runtime splits and joins them, and binds the `_fp64` guard the emulation reads.
// `deep.shade.ts` is the fragment entry's twin.

class Affine {
  k: f64;
  shift: f64;
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
  ys[gid.x] = xs[gid.x] * affine.k + affine.shift;
  // A vector of doubles is two planes, `hi` and `lo`, which the runtime writes and reads apart.
  ps[gid.x] = vec3f64(xs[gid.x], affine.k, ys[gid.x]);
}
