// The host half of the loop-fuse journey's reduction (change 0058): `add`, `mul` and `total`,
// three kernel functions called over `Resident` arrays inside one `fuse` scope, the two
// intermediates scratch arrays the scope makes, and the sum of the last call as its result. The
// reduction is the last call of its group, and the calls before it run as the prologue of each of
// its iterations. It writes no WebGPU. The harness runs `run` on each tier.
import { configure, resident } from 'typeshade/runtime';
import { fuse } from 'typeshade/fuse';
import { add, mul, total } from './ops.shade.ts';

/** The sum of `(a + b) * c` over the inputs, on `tier`, and the report of the scope that ran it. */
export async function run(tier, { a, b, c }) {
  // A reduction has no WebGL2 program (Rule 11.8), so on that tier its call falls to the CPU tier.
  configure({ prefer: tier === 'webgl2' ? [tier, 'cpu'] : [tier] });
  try {
    const [ra, rb, rc] = [a, b, c].map((xs) => resident(Float32Array.from(xs)));
    let sum;
    const report = await fuse((scope) => {
      // The host never reads these two: on WebGPU they are locals of the loop's iteration.
      const t = scope.scratch(a.length);
      const u = scope.scratch(a.length);
      add(t, ra, rb);
      mul(u, t, rc);
      sum = total(u);
    });
    return { values: [await sum], report };
  } finally {
    configure({});
  }
}
