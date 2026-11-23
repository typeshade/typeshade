// ═══ The learning path's JavaScript reference (change 0145) ═══
//
// What each step's `run()` should draw, computed in plain JavaScript with no TypeShade, and the
// inputs each run is called with. The unit suite reads it on the CPU tier
// (`examples/path-examples.test.ts`), and a page with WebGPU can read it through `_drive.ts`.
// The pixels follow `hosts/_reference.ts`: RGBA, one byte to a channel, the top row first, each
// colour taken at the pixel's centre.
//
// No imports and no environment, so a gate can read this file under Bun and the test under Vitest.

/** A canvas the driver draws into, and how to read it back. */
export interface Surface {
  /** A fresh canvas of this size, into which nothing has drawn. */
  canvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas;
  /** The canvas's pixels: RGBA, one byte to a channel, the top row first. */
  pixels(canvas: HTMLCanvasElement | OffscreenCanvas): number[] | Promise<number[]>;
}

/** What one step's run gave back: each part as numbers. */
export type Outputs = Readonly<Record<string, readonly number[]>>;

/** `_drive.ts`'s export, typed here so a caller can import the driver by a computed path. */
export type Drive = (
  surface: Surface,
  ids: readonly string[],
) => Promise<Readonly<Record<string, Outputs | string>>>;

/** The inputs each run is called with. */
export const INPUTS = {
  size: 16,
  time: 1.25,
} as const;

/** Two steps of an 8-bit channel: `f32` arithmetic against this `f64` reference, rounded. */
const PIXEL = 2;

/** One frame of `size` by `size` pixels, each `color(x, y)` at the pixel's centre in pixels,
 *  stored as an `rgba8unorm` target stores it. */
function frame(size: number, color: (x: number, y: number) => readonly number[]): number[] {
  const out: number[] = [];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      for (const c of color(x + 0.5, y + 0.5))
        out.push(Math.round(Math.min(1, Math.max(0, c)) * 255));
  return out;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const edge = (distance: number): number => 1 - smoothstep(0, 0.01, distance);

/** The pixels each step draws, by id. */
export function reference(): Readonly<Record<string, readonly number[]>> {
  const { size, time } = INPUTS;
  return {
    'first-color': frame(size, () => [0.2, 0.6, 1, 1]),
    'uv-gradient': frame(size, (x, y) => [x / size, y / size, 0.5, 1]),
    'moving-wave': frame(size, (x, y) => {
      const wave = 0.5 + 0.5 * Math.sin(12 * (x / size) + 3 * time);
      return [y / size, 0.5 * wave, wave, 1];
    }),
    'sdf-shapes': frame(size, (x, y) => {
      const u = (2 * x - size) / size;
      const v = (2 * y - size) / size;
      const disc = edge(Math.hypot(u + 0.5, v) - 0.3);
      const panel = edge(Math.max(Math.abs(u - 0.5) - 0.3, Math.abs(v) - 0.2));
      return [0.1 + 0.8 * disc, 0.1 + 0.4 * disc + 0.3 * panel, 0.15 + 0.8 * panel, 1];
    }),
  };
}

/** What differs between what a step's run gave back and its reference, one line each: empty when
 *  they agree. A run that threw gives its error as a string, which is one line. */
export function compare(id: string, got: Outputs | string | undefined): string[] {
  if (typeof got === 'string') return [`${id}: ${got}`];
  const want = reference()[id];
  if (want === undefined) return [`${id}: no reference`];
  const pixels = got?.['pixels'];
  if (pixels === undefined) return [`${id}: the run gave no pixels`];
  if (pixels.length !== want.length)
    return [`${id}: ${pixels.length} values, the reference has ${want.length}`];
  const worst = pixels.reduce((m, v, i) => Math.max(m, Math.abs(v - want[i]!)), 0);
  return worst <= PIXEL ? [] : [`${id}: a pixel is off by ${worst}, the allowance is ${PIXEL}`];
}
