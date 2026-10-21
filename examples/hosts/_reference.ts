// ═══ The host examples' JavaScript reference (change 0061) ═══
//
// What each host example's `run()` should give back, computed in plain JavaScript with no
// TypeShade, and the inputs each run is called with. Two checks read it: the unit suite, which
// runs each host on the CPU tier through the Vite plugin (`examples/host-examples.test.ts`), and
// `bun run gate:journeys`, which builds `examples/hosts/` with Vite and runs each host on headless
// WebGPU (`scripts/user-journey.ts`). One reference for both, so the two tiers are held to the
// same numbers (AGENTS.md#gate-discipline, one authority).
//
// No imports and no environment: the gate reads this file under Bun, and the test under Vitest.

/** A canvas the driver draws into, and how to read it back. */
export interface Surface {
  /** A fresh canvas of this size, into which nothing has drawn. */
  canvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas;
  /** The canvas's pixels: RGBA, one byte to a channel, the top row first. */
  pixels(canvas: HTMLCanvasElement | OffscreenCanvas): number[] | Promise<number[]>;
}

/** What one host example's run gave back: each part as numbers. */
export type Outputs = Readonly<Record<string, readonly number[]>>;

/** `_drive.ts`'s export, typed here so a caller can import the driver by a computed path and
 *  still type what it gets (`tsconfig.tests.json` cannot read the host files it imports). */
export type Drive = (
  surface: Surface,
  ids: readonly string[],
) => Promise<Readonly<Record<string, Outputs | string>>>;

/** One part of a reference: the values, and the largest absolute difference allowed. */
export interface Expected {
  readonly values: readonly number[];
  readonly tolerance: number;
}

/** The inputs each run is called with. */
export const INPUTS = {
  draw: { size: 16, times: [0, 0.5, 1.25] },
  compute: { n: 256 },
  kernel: { n: 1024 },
  resident: { n: 1024, steps: 8 },
  helper: { size: 16, cursor: [5, 11] as const },
  program: { size: 16, times: [0, 0.5, 1.25] },
  // Small dyadic numbers, so every step is exact in `f32`.
  fuse: {
    a: Array.from({ length: 1000 }, (_, i) => (i % 7) - 3),
    b: Array.from({ length: 1000 }, (_, i) => ((i % 5) - 2) * 0.5),
    c: Array.from({ length: 1000 }, (_, i) => ((i % 3) - 1) * 0.25),
  },
  collect: { n: 64 },
} as const;

const TAU = 6.2831853;

/** One frame of `size` by `size` pixels, each `color(u, v)` at the pixel's centre, stored as an
 *  `rgba8unorm` target stores it. */
function frame(size: number, color: (u: number, v: number) => readonly number[]): number[] {
  const out: number[] = [];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      for (const c of color((x + 0.5) / size, (y + 0.5) / size))
        out.push(Math.round(Math.min(1, Math.max(0, c)) * 255));
  return out;
}

/** The terrain of `host-helper`. */
const terrain = (u: number, v: number): number =>
  0.5 + 0.25 * Math.sin(TAU * u) * Math.cos(TAU * v);

/** Two steps of an 8-bit channel: `f32` arithmetic against this `f64` reference, rounded. */
const PIXEL = 2;

/** What `host-set-unique` gives back: JavaScript's own Set and Map over the same pixels. */
function collected(n: number): Readonly<Record<string, Expected>> {
  const pixels = Array.from({ length: n }, (_, i) => (i * 5) % 7);
  const seen = new Set<number>();
  for (const p of pixels) if (p !== 0) seen.add(p);
  const last = new Map<number, number>();
  pixels.forEach((p, i) => last.set(p, i / 4));
  const found = Array.from({ length: 10 }, (_, k) => last.get(k) ?? -1);
  return {
    seen: { values: [...seen], tolerance: 0 },
    count: { values: [seen.size], tolerance: 0 },
    keys: { values: [...last.keys()], tolerance: 0 },
    values: { values: [...last.values()], tolerance: 0 },
    found: { values: found, tolerance: 0 },
    present: {
      values: Array.from({ length: 10 }, (_, k) => (pixels.includes(k) ? 1 : 0)),
      tolerance: 0,
    },
  };
}

/** What each host example's run should give back, part by part. */
export function reference(): Readonly<Record<string, Readonly<Record<string, Expected>>>> {
  const { draw, compute, kernel, resident, helper, program } = INPUTS;
  const lastDraw = draw.times[draw.times.length - 1]!;
  const lastProgram = program.times[program.times.length - 1]!;

  const tone = Array.from({ length: kernel.n }, (_, i) => 1 - Math.exp(-((i % 64) / 16) * 1.5));

  // `ys = ys * 0.5 + xs`, in `f32`: every value is a multiple of 2^-11 below 2, so each step is
  // exact, and so is the sum of 1024 of them.
  const xs = Array.from({ length: resident.n }, (_, i) => (i % 8) / 8);
  let ys = new Array<number>(resident.n).fill(0);
  for (let s = 0; s < resident.steps; s++) ys = ys.map((y, i) => y * 0.5 + xs[i]!);

  const [cx, cy] = helper.cursor;
  const u = INPUTS.fuse.a.map((x, i) => (x + INPUTS.fuse.b[i]!) * INPUTS.fuse.c[i]!);
  return {
    'host-draw': {
      pixels: {
        values: frame(draw.size, (u, v) => [u, v, 0.5 + 0.5 * Math.sin(TAU * u + lastDraw), 1]),
        tolerance: PIXEL,
      },
    },
    'host-compute': {
      ys: { values: Array.from({ length: compute.n }, (_, i) => i * 2.5), tolerance: 0 },
    },
    'host-kernel': {
      // WGSL bounds `exp` at 3 + 2|x| ULP; the values are below 1.
      pixels: { values: tone, tolerance: 1e-5 },
      peak: { values: [Math.max(...tone)], tolerance: 1e-5 },
    },
    'host-resident': {
      values: { values: ys, tolerance: 0 },
      total: { values: [ys.reduce((a, b) => a + b, 0)], tolerance: 0 },
    },
    'host-helper': {
      // The helper on the CPU, in `f32`.
      height: {
        values: [terrain((cx + 0.5) / helper.size, (cy + 0.5) / helper.size)],
        tolerance: 1e-5,
      },
      pixels: {
        values: frame(helper.size, (u, v) => {
          const h = terrain(u, v);
          return [h, h, h, 1];
        }),
        tolerance: PIXEL,
      },
    },
    'loop-fuse': {
      chain: { values: u.map((x) => Math.max(x, 0)), tolerance: 0 },
      split: { values: u.map((x, i) => Math.max(x + u[i ^ 1]!, 0)), tolerance: 0 },
      // Each term is a multiple of 2^-3 no larger than 1, so every partial sum of the 1,000 terms
      // is a multiple of 2^-3 below 2^10, which `f32` holds exactly: the sum is the same in any
      // order, the tree's included.
      reduce: { values: [u.reduce((sum, x) => sum + x, 0)], tolerance: 0 },
    },
    'host-set-unique': collected(INPUTS.collect.n),
    'host-program': {
      pixels: {
        values: frame(program.size, (u, v) => [u, 1 - v, 0.5 + 0.5 * Math.cos(lastProgram), 1]),
        tolerance: PIXEL,
      },
    },
  };
}

/**
 * Hold what a run gave back to the reference.
 *
 * @param id - the host example.
 * @param got - what its run gave back, or the error it threw, as a string.
 * @returns one line for each part that does not match, empty when every part does.
 */
export function compare(id: string, got: Outputs | string | undefined): string[] {
  const want = reference()[id];
  if (want === undefined) return [`${id}: no reference`];
  if (got === undefined) return [`${id}: did not run`];
  if (typeof got === 'string') return [`${id}: ${got}`];
  const wrong: string[] = [];
  for (const [part, { values, tolerance }] of Object.entries(want)) {
    const ran = got[part];
    if (ran === undefined || ran.length !== values.length) {
      wrong.push(
        `${id}.${part}: ${ran === undefined ? 'missing' : `${ran.length} values`}, expected ${values.length}`,
      );
      continue;
    }
    let worst = 0;
    let at = -1;
    values.forEach((v, i) => {
      const d = Math.abs(ran[i]! - v);
      if (!(d <= worst)) {
        worst = d;
        at = i;
      }
    });
    if (!(worst <= tolerance))
      wrong.push(
        `${id}.${part}: element ${at} is ${ran[at]}, expected ${values[at]} (allowed ${tolerance})`,
      );
  }
  return wrong;
}
