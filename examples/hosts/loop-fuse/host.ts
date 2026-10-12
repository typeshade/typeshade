// Run a chain of kernel calls as one plan (change 0058).
//
// Inside `fuse()`, a kernel call is recorded, not run. When the body returns, the scope runs the
// recorded calls together: on WebGPU, calls that each read only what the call before wrote at
// the same index become one dispatch, in one submission. The promise resolves to a report of
// what ran. The module must be built with `typeshade({ fuse: true })` in `vite.config.ts`;
// without it, every call runs on its own, and the report says why.
import { resident } from 'typeshade/runtime';
import { fuse, type FuseReport } from 'typeshade/fuse';
import { add, mul, pairsum, relu } from './loop-fuse.shade.ts';

/** One scope's result, read back, and its report. */
export interface Fused {
  readonly values: Float32Array;
  readonly report: FuseReport;
}

/** `relu((a + b) * c)` in one scope, and `relu(pairsum((a + b) * c))` in another. */
export async function run(
  a: Float32Array,
  b: Float32Array,
  c: Float32Array,
): Promise<{ chain: Fused; split: Fused }> {
  const n = a.length;
  // The calls in a scope take `Resident`s: the inputs, and `out`, which the host reads.
  const [ra, rb, rc] = [a, b, c].map((xs) => resident(xs));
  const out = resident(new Float32Array(n));

  // add, mul and relu: one dispatch on WebGPU. `t` and `u` are scratch arrays the host never
  // reads, so the fused entry holds them as locals, and no buffer is made for them.
  const chainReport = await fuse((scope) => {
    const t = scope.scratch(n);
    const u = scope.scratch(n);
    add(t, ra, rb);
    mul(u, t, rc);
    relu(out, u);
  });
  const chain = { values: await out.read(), report: chainReport };

  // pairsum reads u[i ^ 1], which another invocation of mul writes: two dispatches, and the
  // second group's `why` names the line. `u` is shared by both, so it becomes a buffer.
  const splitReport = await fuse((scope) => {
    const [t, u, v] = [scope.scratch(n), scope.scratch(n), scope.scratch(n)];
    add(t, ra, rb);
    mul(u, t, rc);
    pairsum(v, u);
    relu(out, v);
  });
  const split = { values: await out.read(), report: splitReport };

  for (const r of [ra, rb, rc, out]) r.destroy();
  return { chain, split };
}
