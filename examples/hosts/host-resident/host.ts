// Chain kernel calls over arrays that stay on the GPU (surface §65, Rule 11.8).
//
// `resident(value)` wraps a host value once. The first call on WebGPU uploads it; the calls
// after bind the same buffer and read nothing back. A call whose written arrays are all
// resident, and that returns nothing, only queues: nothing waits on it.
import { resident } from 'typeshade/runtime';
import { accumulate, decay, sum } from './host-resident.shade.ts';

/** Run `steps` steps of `ys = ys * 0.5 + xs` on the GPU, then read the result once. */
export async function run(n = 1024, steps = 8): Promise<{ values: Float32Array; total: number }> {
  const xs = resident(Float32Array.from({ length: n }, (_, i) => (i % 8) / 8));
  const ys = resident(n, 'f32'); // zeros: no host copy and no upload until a call writes it
  for (let step = 0; step < steps; step++) {
    decay(0.5, ys); // queued
    accumulate(xs, ys); // queued, after decay
  }
  const total = await sum(ys); // waits for the chain, and reads one number
  const values = await ys.read(); // the one read of the array
  xs.destroy();
  ys.destroy();
  return { values, total };
}
