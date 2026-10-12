// Dispatch a `@compute` entry and read what it wrote (surface §67, Rule 8.24).
//
// The import is the shader module itself: the Vite plugin turns `scale` into a function that
// takes the entry's bindings by name, as plain values, and the number of workgroups.
import { scale } from './host-compute.shade.ts';

/** Scale `n` numbers by 2.5 on the GPU, and return them. */
export async function run(n = 256): Promise<Float32Array> {
  const xs = Float32Array.from({ length: n }, (_, i) => i);
  const ys = new Float32Array(n);
  // `@compute([64])`: one workgroup for each 64 elements. When the promise resolves, `ys` holds
  // what the entry wrote.
  await scale({ k: 2.5, xs, ys }, Math.ceil(n / 64));
  return ys;
}
