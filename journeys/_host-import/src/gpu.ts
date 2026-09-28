// The browser half of the journey: ordinary TypeScript that calls two compute entries and draws
// two fragment entries through the import, with plain typed arrays and no WebGPU or WebGL code
// of its own. The page runs `run()` and `draws()`.
import { blockSum, report, scale } from './kernels.shade.ts';
import { plasma, tiled } from './draw.shade.ts';
import { drift, odds, render } from './loops.shade.ts';
// Copied in by the journey from journeys/particles and journeys/plasma.
import { step } from './particles.shade.ts';
import { fs } from './plasma.shade.ts';

export async function run(): Promise<{ ys: number[]; sums: number[] }> {
  const xs = Float32Array.from({ length: 256 }, (_, i) => Math.sin(i * 0.37) * 4);
  const ys = new Float32Array(256);
  await scale({ k: 2.5, xs, ys }, 4); // ys is filled in place
  const sums = new Float32Array(4);
  await blockSum({ xs, sums, scratch: new Float32Array(256) }, 4); // WebGPU only: a barrier
  return { ys: [...ys], sums: [...sums] };
}

/** The size of each canvas `draws()` draws into. */
const SIZE = 32;

/** A canvas whose first context is `kind`, so a draw into it keeps that tier: a canvas keeps
 *  the first kind of context it hands out. With no kind, the draw picks, and WebGPU comes first. */
function canvas(kind?: 'webgl2' | '2d'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  if (kind === 'webgl2')
    c.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true });
  if (kind === '2d') c.getContext('2d', { alpha: false });
  return c;
}

/** The canvas's pixels, RGBA, top row first. */
function pixels(c: HTMLCanvasElement): number[] {
  const copy = document.createElement('canvas');
  copy.width = SIZE;
  copy.height = SIZE;
  const ctx = copy.getContext('2d')!;
  ctx.drawImage(c, 0, 0);
  return [...ctx.getImageData(0, 0, SIZE, SIZE).data];
}

/** Draw both fragment entries on each tier and read each frame back, in the task that
 *  submitted it. */
export async function draws(): Promise<Record<string, number[] | string>> {
  const out: Record<string, number[] | string> = {};
  const wave = { time: 1.25, scale: 0.09 };
  for (const kind of [undefined, 'webgl2', '2d'] as const) {
    const c = canvas(kind);
    out[`plasma ${kind ?? 'webgpu'}`] = await plasma(c, { wave }).then(() => pixels(c));
  }
  // An 8x8 image, each texel its own colour, repeated with nearest filtering.
  const img = new ImageData(8, 8);
  for (let j = 0; j < 8; j++)
    for (let i = 0; i < 8; i++) img.data.set([i * 32, j * 32, (i + j) * 16, 255], 4 * (j * 8 + i));
  const smp = { filter: 'nearest', address: 'repeat' } as const;
  for (const kind of [undefined, 'webgl2', '2d'] as const) {
    const c = canvas(kind);
    out[`tiled ${kind ?? 'webgpu'}`] = await tiled(c, { image: img, smp }).then(
      () => pixels(c),
      (e: unknown) => String(e),
    );
  }
  return out;
}

/** Call an entry that logs: in `vite dev` its four `console.log` calls print from WebGPU, in
 *  invocation order; in a production build they record nothing. */
export async function logged(): Promise<void> {
  await report({ xs: Float32Array.of(1.5, 2.5, 3.5, 4.5) }, 1);
}

/** The particles and plasma journeys' programs (`journeys/particles`, `journeys/plasma`), which
 *  the journey copies beside this file, run through the import: no packing, no layout, no WebGPU
 *  code. `input` is each journey's own starting data. */
export async function journeys(input: {
  sim: Parameters<typeof step>[0]['sim'];
  particles: Parameters<typeof step>[0]['particles'];
  frames: number;
  frame: Parameters<typeof fs>[1]['frame'];
}): Promise<{ particles: number[]; plasma: number[] }> {
  const { sim, particles, frames, frame } = input;
  for (let f = 0; f < frames; f++) await step({ sim, particles }, Math.ceil(particles.length / 64));
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const plasmaPixels = await fs(c, { frame }).then(() => {
    const copy = document.createElement('canvas');
    copy.width = 64;
    copy.height = 64;
    const ctx = copy.getContext('2d')!;
    ctx.drawImage(c, 0, 0);
    return [...ctx.getImageData(0, 0, 64, 64).data];
  });
  return { particles: particles.flatMap((p) => [...p.pos, ...p.vel]), plasma: plasmaPixels };
}

/** Call three kernel functions (change 0013): their loops run on WebGPU, one invocation per
 *  iteration, and what they write comes back into these arrays in place. */
export async function loops(): Promise<Record<string, number[] | string>> {
  const img = new Float32Array(64 * 64);
  await render([1, 0.5, 2, 0.25], 64, img);
  const ps = Array.from({ length: 100 }, (_, i) => ({
    pos: [i, 10, 0, 1] as [number, number, number, number],
    vel: [1, 0, -1, 0] as [number, number, number, number],
  }));
  await drift(ps, 0.25);
  const every = new Float32Array(30);
  await odds(every, 10);
  // An array shorter than the loop writes is refused before anything is uploaded.
  const short = await render([1, 0.5, 2, 0.25], 64, new Float32Array(10)).then(
    () => 'no error',
    (e: unknown) => String(e),
  );
  return {
    render: [...img],
    drift: ps.flatMap((p) => [...p.pos, ...p.vel]),
    odds: [...every],
    short,
  };
}
