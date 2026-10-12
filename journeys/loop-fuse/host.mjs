// The host half of the loop-fuse journey (change 0058), as its author would write it: three kernel
// functions called over `Resident` arrays inside one `fuse` scope, and the result read back. It
// writes no WebGPU. The harness runs `run` on each tier in turn, and counts what the device is
// given while it runs, to hold the report to it.
import { configure, resident } from 'typeshade/runtime';
import { fuse } from 'typeshade/fuse';
import { add, mul, relu } from './ops.shade.ts';

/** `relu((a + b) * c)` over the inputs, on `tier`, and the report of the scope that ran it. */
export async function run(tier, { a, b, c }) {
  configure({ prefer: [tier] });
  try {
    const [ra, rb, rc] = [a, b, c].map((xs) => resident(Float32Array.from(xs)));
    const empty = () => resident(new Float32Array(a.length));
    const [t, u, out] = [empty(), empty(), empty()];
    const report = await fuse(() => {
      add(t, ra, rb);
      mul(u, t, rc);
      relu(out, u);
    });
    return { values: [...(await out.read())], report };
  } finally {
    configure({});
  }
}
