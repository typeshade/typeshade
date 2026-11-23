// ═══ The learning path's driver (change 0145) ═══
//
// Calls each step's `run()` with the inputs `_reference.ts` names, and gives back what it drew or
// computed (`pixels` or `values`), for `compare()` to hold to the reference. The unit suite drives
// it on the CPU tier (`examples/path-examples.test.ts`, a canvas whose only context is `2d`); a
// page with WebGPU can build it with Vite and drive it there. It is a check's harness, not an example: a reader copies
// the `host.ts` files, not this one.

import { run as firstColor } from './first-color/host.js';
import { run as uvGradient } from './uv-gradient/host.js';
import { run as movingWave } from './moving-wave/host.js';
import { run as sdfShapes } from './sdf-shapes/host.js';
import { run as tilePattern } from './tile-pattern/host.js';
import { run as fractal } from './fractal/host.js';
import { run as palette } from './palette/host.js';
import { run as bouncingBalls } from './bouncing-balls/host.js';
import { run as doubleArray } from './double-array/host.js';
import { run as imageBlur } from './image-blur/host.js';
import { run as parallelSum } from './parallel-sum/host.js';
import { run as histogram } from './histogram/host.js';
import { run as rayTracer } from './ray-tracer/host.js';
import { INPUTS, type Drive, type Outputs, type Surface } from './_reference.js';

export { configure } from 'typeshade/runtime';

const RUNS: Readonly<Record<string, (surface: Surface) => Promise<Outputs>>> = {
  'first-color': (surface) => drawn(surface, (canvas) => firstColor(canvas)),
  'uv-gradient': (surface) => drawn(surface, (canvas) => uvGradient(canvas)),
  'moving-wave': (surface) => drawn(surface, (canvas) => movingWave(canvas, INPUTS.time)),
  'sdf-shapes': (surface) => drawn(surface, (canvas) => sdfShapes(canvas)),
  'tile-pattern': (surface) => drawn(surface, (canvas) => tilePattern(canvas)),
  fractal: (surface) => drawn(surface, (canvas) => fractal(canvas)),
  palette: (surface) => drawn(surface, (canvas) => palette(canvas)),
  'bouncing-balls': (surface) => drawn(surface, (canvas) => bouncingBalls(canvas, INPUTS.time)),
  'double-array': async () => ({ values: [...(await doubleArray(INPUTS.double.count))] }),
  'image-blur': async () => ({
    values: [...(await imageBlur(INPUTS.blur.width, INPUTS.blur.height))],
  }),
  'parallel-sum': async () => ({ values: [await parallelSum(INPUTS.sum.count)] }),
  histogram: async () => ({ values: [...(await histogram(INPUTS.histogram.count))] }),
  'ray-tracer': (surface) => drawn(surface, (canvas) => rayTracer(canvas)),
};

async function drawn(
  surface: Surface,
  draw: (canvas: HTMLCanvasElement | OffscreenCanvas) => Promise<void>,
): Promise<Outputs> {
  const canvas = surface.canvas(INPUTS.size, INPUTS.size);
  await draw(canvas);
  return { pixels: await surface.pixels(canvas) };
}

/** Run each step of `ids` in turn; a run that throws gives its error as a string. */
export const drive: Drive = async (surface, ids) => {
  const out: Record<string, Outputs | string> = {};
  for (const id of ids) {
    const run = RUNS[id];
    if (run === undefined) {
      out[id] = `no step is named ${id}`;
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
