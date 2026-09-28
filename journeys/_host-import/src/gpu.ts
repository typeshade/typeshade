// The browser half of the journey: ordinary TypeScript that calls two compute entries, with plain
// typed arrays and then with arrays resident on the device, and draws two fragment entries
// through the import, with no WebGPU or WebGL code of its own. The page runs `run()` and
// `draws()`.
import { blockSum, report, scale } from './kernels.shade.ts';
import { axpy } from './doubles.shade.ts';
import { deep } from './deep.shade.ts';
import { fillRamp, plasma, ramped, tiled } from './draw.shade.ts';
import { configure, resident } from 'typeshade/runtime';
import { drift, histogram, odds, render, scaleNonNegative, stats, tally } from './loops.shade.ts';
// Copied in by the journey from journeys/particles and journeys/plasma.
import { step } from './particles.shade.ts';
import { fs } from './plasma.shade.ts';

export async function run(): Promise<Record<string, number[]>> {
  const xs = Float32Array.from({ length: 256 }, (_, i) => Math.sin(i * 0.37) * 4);
  const ys = new Float32Array(256);
  await scale({ k: 2.5, xs, ys }, 4); // ys is filled in place
  const sums = new Float32Array(4);
  await blockSum({ xs, sums, scratch: new Float32Array(256) }, 4); // WebGPU only: a barrier
  // Resident bindings (Rule 11.8): the map's output stays on the device and is the block sum's
  // input, the two calls only queue, and each handle is read back once.
  const devYs = resident(new Float32Array(256));
  const devSums = resident(new Float32Array(4));
  scale({ k: 2.5, xs, ys: devYs }, 4);
  blockSum({ xs: devYs, sums: devSums, scratch: resident(new Float32Array(256)) }, 4);
  // Emulated doubles (change 0013's f64 split): `Float64Array`s in and out, and a result an
  // `f32` would round at the seventh digit.
  const dxs = Float64Array.from({ length: 256 }, (_, i) => 1 + i * 1e-9);
  const dys = new Float64Array(256);
  const dps = new Float64Array(256 * 3);
  await axpy({ affine: { k: 3, shift: [0.25, 1e-10] }, xs: dxs, ys: dys, ps: dps }, 4);
  return {
    ys: [...ys],
    sums: [...sums],
    doubleYs: [...dys],
    doublePs: [...dps],
    residentYs: [...(await devYs.read())],
    residentSums: [...(await devSums.read())],
  };
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

/** Draw the fragment entries on each tier and read each frame back, in the task that
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
  // A fragment entry that computes in `f64`, on each tier: its band moves by a thousandth of a
  // period per pixel at 12 345.678, which an `f32` cannot tell apart.
  for (const kind of [undefined, 'webgl2', '2d'] as const) {
    const c = canvas(kind);
    out[`deep ${kind ?? 'webgpu'}`] = await deep(c, { zoom: { cx: 12345.678, scale: 1e-6 } }).then(
      () => pixels(c),
      (e: unknown) => String(e),
    );
  }
  // A storage array a kernel function wrote on the device and the draw binds as it is (Rule
  // 11.8): the fill only queues, and the draw runs after it. The CPU tier reads the handle's copy.
  const ramp = resident(new Float32Array(SIZE));
  fillRamp(ramp);
  for (const kind of [undefined, '2d'] as const) {
    const c = canvas(kind);
    out[`ramped ${kind ?? 'webgpu'}`] = await ramped(c, { ramp }).then(
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
  sim: Parameters<typeof step>[1];
  particles: { pos: [number, number, number, number]; vel: [number, number, number, number] }[];
  frames: number;
  frame: Parameters<typeof fs>[1]['frame'];
}): Promise<{ particles: number[]; plasma: number[] }> {
  const { sim, frames, frame } = input;
  // The particles stay on the device across the frames (Rule 11.8): each step only queues, and
  // the one read is after the last.
  const dev = resident(input.particles);
  for (let f = 0; f < frames; f++) step(dev, sim);
  const particles = await dev.read();
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

/** Call six kernel functions (change 0013): their loops run on WebGPU, one invocation per
 *  iteration, what they write comes back into these arrays in place, and what they reduce is
 *  folded in the tree order into what they return. */
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
  // 300 000 elements: 1172 partials, folded twice more to one.
  const xs = Float32Array.from({ length: 300000 }, (_, i) => Math.sin(i) * 1000.123);
  const scaled = new Float32Array(xs.length);
  const summary = await stats(xs, scaled, 0.5);
  const ints = Int32Array.from({ length: 70000 }, (_, i) => (i % 7) - 3);
  const total = await tally(ints);
  // Resident arrays (Rule 11.8): uploaded once, kept on the device across the calls, which only
  // queue, and read back once.
  const dev = resident(new Float32Array(64 * 64));
  render([1, 0.5, 2, 0.25], 64, dev);
  const devXs = resident(xs);
  const devScaled = resident(new Float32Array(xs.length));
  const devSummary = await stats(devXs, devScaled, 0.5);
  const bins = new Uint32Array(64);
  await histogram(xs, bins, -1000.123, 64 / 2000.246);
  // The WebGL2 tier, required (Rule 11.8): a map that writes one f32 array at `i` runs as a
  // fragment program, one texel per iteration.
  const glImg = new Float32Array(64 * 64);
  const glSkip = Float32Array.from({ length: 512 }, () => -1);
  const glXs = Float32Array.from({ length: 512 }, (_, i) => Math.sin(i) * 10);
  try {
    configure({ prefer: ['webgl2'] });
    await render([1, 0.5, 2, 0.25], 64, glImg);
    await scaleNonNegative(glXs, glSkip, 0.5);
  } finally {
    configure({});
  }
  return {
    glRender: [...glImg],
    glSkip: [...glSkip],
    render: [...img],
    drift: ps.flatMap((p) => [...p.pos, ...p.vel]),
    odds: [...every],
    stats: [...summary],
    scaled: [...scaled.subarray(0, 256)],
    tally: [total],
    histogram: [...bins],
    residentRender: [...(await dev.read())],
    residentStats: [...devSummary],
    residentScaled: [...(await devScaled.read()).subarray(0, 256)],
    short,
  };
}
