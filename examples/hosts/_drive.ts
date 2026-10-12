// ═══ The host examples' driver (change 0061) ═══
//
// Calls each host example's `run()` with the inputs `_reference.ts` names, and gives back what it
// read, as numbers, for `compare()` to hold to the reference. The unit suite drives it on the CPU
// tier (`examples/host-examples.test.ts`, a canvas whose only context is `2d`), and
// `bun run gate:journeys` builds it with Vite and drives it in a page with WebGPU
// (`scripts/user-journey.ts`). It is a check's harness, not an example: a reader copies the
// `host.ts` files, not this one.

import { run as draw } from './host-draw/host.js';
import { run as compute } from './host-compute/host.js';
import { run as kernel } from './host-kernel/host.js';
import { run as residentChain } from './host-resident/host.js';
import { run as helper } from './host-helper/host.js';
import { run as program } from './host-program/host.js';
import { INPUTS, type Drive, type Outputs, type Surface } from './_reference.js';

// The call layer's `configure`, from the same copy of the runtime the hosts import: the gate's page
// sets `configure({ prefer: ['webgpu'] })`, so a kernel or entry call that cannot run on WebGPU
// throws there rather than passing on the CPU tier.
export { configure } from 'typeshade/runtime';

/** Each host example's run, with its inputs, and what it read back as numbers. */
const RUNS: Readonly<Record<string, (surface: Surface) => Promise<Outputs>>> = {
  'host-draw': async (surface) => {
    const { size, times } = INPUTS.draw;
    const canvas = surface.canvas(size, size);
    await draw(canvas, times);
    return { pixels: await surface.pixels(canvas) };
  },
  'host-compute': async () => ({ ys: [...(await compute(INPUTS.compute.n))] }),
  'host-kernel': async () => {
    const { pixels, peak } = await kernel(INPUTS.kernel.n);
    return { pixels: [...pixels], peak: [peak] };
  },
  'host-resident': async () => {
    const { values, total } = await residentChain(INPUTS.resident.n, INPUTS.resident.steps);
    return { values: [...values], total: [total] };
  },
  'host-helper': async (surface) => {
    const { size, cursor } = INPUTS.helper;
    const canvas = surface.canvas(size, size);
    const height = await helper(canvas, cursor);
    return { height: [height], pixels: await surface.pixels(canvas) };
  },
  'host-program': async () => {
    const { size, times } = INPUTS.program;
    return { pixels: [...(await program(size, size, times))] };
  },
};

/** Run each host example of `ids` in turn; a run that throws gives its error as a string. */
export const drive: Drive = async (surface, ids) => {
  const out: Record<string, Outputs | string> = {};
  for (const id of ids) {
    const run = RUNS[id];
    if (run === undefined) {
      out[id] = `no host example is named ${id}`;
      continue;
    }
    try {
      out[id] = await run(surface);
    } catch (e) {
      out[id] = String(e);
    }
  }
  return out;
};
