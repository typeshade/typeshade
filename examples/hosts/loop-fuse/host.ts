// Run a chain of kernel calls as one plan (change 0058).
//
// Inside `fuse()`, a kernel call is recorded, not run. When the body returns, the scope runs the
// recorded calls together: on WebGPU, calls that each read only what the call before wrote at
// the same index become one dispatch, in one submission. A call that reduces can be the last
// call of such a group, and the calls before it run as a prologue of each of its iterations. The
// promise resolves to a report of what ran. The module must be built with
// `typeshade({ fuse: true })` in `vite.config.ts`; without it, every call runs on its own, and
// the report says why.
import { resident } from 'typeshade/runtime';
import { fuse, type FuseReport } from 'typeshade/fuse';
import { add, mul, pairsum, relu, total } from './loop-fuse.shade.ts';

/** One scope's result, read back, and its report. */
export interface Fused {
  readonly values: Float32Array;
  readonly report: FuseReport;
}

/** The sum that the last call of a scope returns, and the report of the scope. */
export interface Summed {
  readonly sum: number;
  readonly report: FuseReport;
}

/**
 * `relu((a + b) * c)` in one scope, `relu(pairsum((a + b) * c))` in another, and the sum of
 * `(a + b) * c` in a third.
 */
export async function run(
  a: Float32Array,
  b: Float32Array,
  c: Float32Array,
): Promise<{ chain: Fused; split: Fused; reduce: Summed }> {
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

  // add, mul and total: the reduction ends the group, and add and mul run as a prologue of each
  // of its iterations, so `t` and `u` are locals again. The call returns a promise, which
  // resolves to the sum once the scope has run; the body cannot wait for it.
  let sum!: Promise<number>;
  const reduceReport = await fuse((scope) => {
    const t = scope.scratch(n);
    const u = scope.scratch(n);
    add(t, ra, rb);
    mul(u, t, rc);
    sum = total(u);
  });
  const reduce = { sum: await sum, report: reduceReport };

  for (const r of [ra, rb, rc, out]) r.destroy();
  return { chain, split, reduce };
}
