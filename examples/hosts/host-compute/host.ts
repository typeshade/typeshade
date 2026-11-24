// Dispatch a `@compute` entry: bindings by name and a workgroup count (surface §67, Rule 8.24).
// The import is the shader module itself: the Vite plugin turns `scale` into a function.
import { scale } from './host-compute.shade.ts';

/** Scale `n` numbers by 2.5 on the GPU, and return them. */
export async function run(n = 259): Promise<{ values: Float32Array }> {
  const xs = Float32Array.from({ length: n }, (_, i) => i);
  const ys = new Float32Array(n);
  // WIDTH defaults to 64, GAIN to 1. When the promise resolves, `ys` holds
  // what the entry wrote.
  await scale({ k: 2.5, xs, ys }, Math.ceil(n / 64));
  return { values: ys };
}
