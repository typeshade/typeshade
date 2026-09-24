// The browser half of the journey: ordinary TypeScript that calls two compute entries through
// the import, with plain typed arrays and no WebGPU code of its own. The page runs `run()`.
import { blockSum, scale } from './kernels.shade.ts';

export async function run(): Promise<{ ys: number[]; sums: number[] }> {
  const xs = Float32Array.from({ length: 256 }, (_, i) => Math.sin(i * 0.37) * 4);
  const ys = new Float32Array(256);
  await scale({ k: 2.5, xs, ys }, 4); // ys is filled in place
  const sums = new Float32Array(4);
  await blockSum({ xs, sums, scratch: new Float32Array(256) }, 4); // WebGPU only: a barrier
  return { ys: [...ys], sums: [...sums] };
}
