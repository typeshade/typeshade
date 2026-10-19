// The host face of `typeshade/random` that is plain JavaScript: a generator over a counter, the
// same `hash32` and `uniform` the kernels run, so that a host-side shuffle and a device-side draw
// from one seed agree bit for bit (change 0072, decision D5). The two functions are the CPU face
// of the shader module (`./face.ts`), which `scripts/bake-common-modules.ts` bakes, so this file
// holds no second copy of either.

import * as face from './face.js';

const hash32 = face.hash32 as (x: number) => number;
const uniform = face.uniform as (word: number) => number;

/**
 * A generator seeded with `seed`: each call returns the next number of `fillUniform(out, seed)`,
 * `uniform(hash32(seed ^ i))` for `i` from 0, so the host and the device draw the same sequence.
 * The seed is read as a 32-bit word. The counter wraps at 2^32, where `fillUniform` has no
 * element.
 */
export function generator(seed: number): () => number {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new RangeError(
      `generator(): the seed is a whole number from 0 to 4294967295; got ${String(seed)}.`,
    );
  let i = 0;
  return () => {
    const word = hash32(((seed ^ i) >>> 0) as number);
    i = (i + 1) >>> 0;
    return uniform(word);
  };
}
