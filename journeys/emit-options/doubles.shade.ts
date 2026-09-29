"use typeshade";

// A compute entry that computes in `f64`: `ys = xs * k + shift`, over values near 1e7 where an
// `f32` has no bit below 1, so a result an `f32` computes is off by the whole of the sum's steps.
// The WGSL holds each double as two `f32`s. The `'float'` flavor of that emulation reads the
// `_fp64` guard, a binding the manifest lists and the runtime binds; the `'integer'` flavor reads
// none. The host packs the program under several emit options (surface §69), and each must run
// on WebGPU as the manifest it gives says.

class Affine {
  k: f64;
  shift: f64;
}

declare const affine: uniform<Affine>;
declare const xs: storage<array<f64>>;
declare const ys: storage<array<f64>, "read_write">;

@compute([64])
export function axpy(@builtin("global_invocation_id") gid: vec3u) {
  if (gid.x >= xs.length) {
    return;
  }
  // `bias` is 0, written as the sum it is made of, which the optimizer folds and O0 leaves.
  const bias: f32 = 0.5 * 4. - 2.;
  ys[gid.x] = xs[gid.x] * affine.k + affine.shift + f64(bias);
}
