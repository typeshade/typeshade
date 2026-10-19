"use typeshade";

// A shader module that imports the device face of a common module by the package's name
// (change 0072, surface §73): `xorshift32` and `uniform` of `typeshade/random`, read through the
// package's `typeshade` condition from the installed tarball, as `relief.shade.ts` reads
// `shade-contour`. The host calls `jitter` on the CPU through the import, and imports
// `fillUniform` from the same specifier for the kernel the host face carries.

import { uniform, xorshift32 } from "typeshade/random";

/** A draw in [0, 1) from a seed and an index, one step of xorshift32 on their xor. */
export function jitter(seed: u32, i: u32): f32 {
  return uniform(xorshift32(seed ^ i));
}
