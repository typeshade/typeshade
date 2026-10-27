// The host half of the device-counts journey (change 0094), as its author would write it: three
// kernel functions called over `Resident` arrays inside one `fuse` scope. The list's length is a
// `Resident<Uint32Array>` of one word, which `keepAbove` pushes after and leaves the new length in,
// and which `gather` and `sumInto` read as their trip count on the device. The host reads nothing
// between the calls: it reads the four arrays once the scope has run. It writes no WebGPU. The
// harness runs `run` on each tier in turn.
import { configure, resident } from 'typeshade/runtime';
import { fuse } from 'typeshade/fuse';
import { gather, keepAbove, sumInto } from './counts.shade.ts';

/** The chain over the inputs, on `tier`: the length, the list, the gathered values and the sum,
 *  and the report of the scope that ran it. */
export async function run(tier, { xs, t, held, capacity }) {
  // A loop that pushes or reduces has no WebGL2 program (Rule 11.8), so on that tier those two
  // calls fall to the CPU tier.
  configure({ prefer: tier === 'webgl2' ? [tier, 'cpu'] : [tier] });
  try {
    const rxs = resident(Float32Array.from(xs));
    // The list already holds `held` entries, and the word holds their count.
    const first = new Uint32Array(capacity);
    first.set(held);
    const list = resident(first);
    const count = resident(new Uint32Array([held.length]));
    const out = resident(new Float32Array(capacity));
    const sums = resident(new Float32Array(1));
    const report = await fuse(() => {
      keepAbove(rxs, t, { array: list, length: count }); // appends after count[0]
      gather(count, list, rxs, out); // n = count[0], read on the device
      sumInto(count, out, sums); // sums[0] = s, on the device
    });
    const values = [
      ...(await count.read()),
      ...(await list.read()),
      ...(await out.read()),
      ...(await sums.read()),
    ];
    return { values, report };
  } finally {
    configure({});
  }
}
