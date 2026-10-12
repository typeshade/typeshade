// The host half of the loop-fuse journey's refusal (change 0058): the same scope as `host.mjs`
// with a call between, `pairsum`, that reads `t[i ^ 1]`, an element another invocation writes.
// The plan cannot make that one dispatch, so it makes two, one for each side of the call. The
// three intermediates are scratch arrays: `t` is private to the first dispatch and `v` to the
// second, so the plan holds both as locals, and `u` is used by both, so it stays a buffer. It
// writes no WebGPU. The harness runs `run` on each tier.
import { configure, resident } from 'typeshade/runtime';
import { fuse } from 'typeshade/fuse';
import { add, mul, pairsum, relu } from './ops.shade.ts';

/** `relu(pairsum((a + b) * c))` over the inputs, on `tier`, and the report of the scope. */
export async function run(tier, { a, b, c }) {
  configure({ prefer: [tier] });
  try {
    const [ra, rb, rc] = [a, b, c].map((xs) => resident(Float32Array.from(xs)));
    const out = resident(new Float32Array(a.length));
    const report = await fuse((scope) => {
      const [t, u, v] = [scope.scratch(a.length), scope.scratch(a.length), scope.scratch(a.length)];
      add(t, ra, rb);
      mul(u, t, rc);
      pairsum(v, u);
      relu(out, v);
    });
    return { values: [...(await out.read())], report };
  } finally {
    configure({});
  }
}
