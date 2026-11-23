// ═══ The learning path's driver (change 0145) ═══
//
// Calls each step's `run()` with the inputs `_reference.ts` names, and gives back the pixels it
// drew, for `compare()` to hold to the reference. The unit suite drives it on the CPU tier
// (`examples/path-examples.test.ts`, a canvas whose only context is `2d`); a page with WebGPU can
// build it with Vite and drive it there. It is a check's harness, not an example: a reader copies
// the `host.ts` files, not this one.

import { run as firstColor } from './first-color/host.js';
import { run as uvGradient } from './uv-gradient/host.js';
import { run as movingWave } from './moving-wave/host.js';
import { run as sdfShapes } from './sdf-shapes/host.js';
import { INPUTS, type Drive, type Outputs, type Surface } from './_reference.js';

export { configure } from 'typeshade/runtime';

const RUNS: Readonly<Record<string, (surface: Surface) => Promise<Outputs>>> = {
  'first-color': (surface) => drawn(surface, (canvas) => firstColor(canvas)),
  'uv-gradient': (surface) => drawn(surface, (canvas) => uvGradient(canvas)),
  'moving-wave': (surface) => drawn(surface, (canvas) => movingWave(canvas, INPUTS.time)),
  'sdf-shapes': (surface) => drawn(surface, (canvas) => sdfShapes(canvas)),
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
