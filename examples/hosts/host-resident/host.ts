// Chain kernel calls over arrays that stay on the GPU (surface §65, Rule 11.8; change 0138).
//
// `array(xs)` makes a `Buffer` of the typed array's scalars. The first call on WebGPU uploads it;
// the calls after bind the same buffer and read nothing back. A call that takes a `Buffer` does not
// block, and a kernel function that returns a value gives a `Buffer` of one element.
import { array } from 'typeshade/runtime';
import { accumulate, decay, sum } from './host-resident.shade.ts';

/** Run `steps` steps of `ys = ys * 0.5 + xs` on the GPU, then read the result once. */
export async function run(n = 1024, steps = 8): Promise<{ values: Float32Array; total: number }> {
  const xs = array(Float32Array.from({ length: n }, (_, i) => (i % 8) / 8));
  const ys = array(n, 'f32'); // zeros: no host copy and no upload until a call writes it
  for (let step = 0; step < steps; step++) {
    decay(0.5, ys); // does not block
    accumulate(xs, ys); // does not block, and runs after decay
  }
  const [total] = await sum(ys).read(); // a Buffer of one element, read once
  const values = await ys.read(); // the one read of the array
  xs.dispose();
  ys.dispose();
  return { values, total: total! };
}
