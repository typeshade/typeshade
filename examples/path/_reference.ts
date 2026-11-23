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
  double: { count: 100 },
  blur: { width: 16, height: 16 },
  sum: { count: 1000 },
  histogram: { count: 1000 },
} as const;

/** Two steps of an 8-bit channel: `f32` arithmetic against this `f64` reference, rounded. */
const PIXEL = 2;

/** Compute results are `f32` sums of at most a thousand small numbers: this relative error covers
 *  the order in which the GPU adds them. */
const RELATIVE = 1e-5;

type Vec3 = readonly [number, number, number];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => scale(a, 1 / Math.sqrt(dot(a, a)));

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

const SPHERES = [
  { center: [-0.6, -0.2, 0] as Vec3, radius: 0.8, color: [0.9, 0.2, 0.2] as Vec3 },
  { center: [0.9, -0.5, 0.5] as Vec3, radius: 0.5, color: [0.2, 0.4, 0.9] as Vec3 },
];

const hitSphere = (s: (typeof SPHERES)[number], origin: Vec3, direction: Vec3): number => {
  const offset = sub(origin, s.center);
  const b = dot(offset, direction);
  const discriminant = b * b - (dot(offset, offset) - s.radius * s.radius);
  return discriminant < 0 ? -1 : -b - Math.sqrt(discriminant);
};

const sky = (direction: Vec3): Vec3 => {
  const t = Math.min(1, Math.max(0, direction[1]));
  const near: Vec3 = [0.95, 0.9, 0.8];
  const far: Vec3 = [0.3, 0.5, 0.9];
  return add(scale(near, 1 - t), scale(far, t));
};

const rayTrace = (u: number, v: number): readonly number[] => {
  const light = unit([0.5, 1, 0.7]);
  let origin: Vec3 = [0, 0, 3];
  let direction = unit([u, -v, -1.5]);
  let weight = 1;
  let color: Vec3 = [0, 0, 0];
  for (let bounce = 0; bounce < 2; bounce++) {
    let nearest = 1000;
    let normal: Vec3 = [0, 1, 0];
    let albedo: Vec3 = [0, 0, 0];
    for (const s of SPHERES) {
      const t = hitSphere(s, origin, direction);
      if (t > 0.001 && t < nearest) {
        nearest = t;
        normal = unit(sub(add(origin, scale(direction, t)), s.center));
        albedo = s.color;
      }
    }
    if (direction[1] < 0) {
      const t = (-1 - origin[1]) / direction[1];
      if (t > 0.001 && t < nearest) {
        nearest = t;
        normal = [0, 1, 0];
        const spot = add(origin, scale(direction, t));
        const half = 0.5 * (Math.floor(spot[0] + 0.31) + Math.floor(spot[2] + 0.17));
        const tile = half - Math.floor(half);
        albedo = [0.35 + 0.5 * tile, 0.35 + 0.5 * tile, 0.35 + 0.5 * tile];
      }
    }
    if (nearest >= 1000) {
      color = add(color, scale(sky(direction), weight));
      weight = 0;
      break;
    }
    const point = add(origin, scale(direction, nearest));
    let lit = Math.max(dot(normal, light), 0);
    if (SPHERES.some((s) => hitSphere(s, point, light) > 0.001)) lit *= 0.3;
    color = add(color, scale(albedo, weight * 0.65 * (0.2 + 0.8 * lit)));
    weight *= 0.35;
    origin = point;
    direction = sub(direction, scale(normal, 2 * dot(direction, normal)));
  }
  color = add(color, scale(sky(direction), weight));
  return [Math.sqrt(color[0]), Math.sqrt(color[1]), Math.sqrt(color[2]), 1];
};

/** The brightness of each pixel of the image `image-blur` starts from: a bright square. */
export function blurInput(width: number, height: number): number[] {
  return Array.from({ length: width * height }, (_, i) => {
    const x = i % width;
    const y = Math.floor(i / width);
    return x >= width / 4 && x < width / 2 && y >= height / 4 && y < height / 2 ? 1 : 0;
  });
}

/** What each step's run gives back, by id: the pixels of a drawing step, the numbers of a
 *  compute step. */
export function reference(): Readonly<Record<string, readonly number[]>> {
  const { size, time } = INPUTS;
  const { width, height } = INPUTS.blur;
  const image = blurInput(width, height);
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
    'tile-pattern': frame(size, (x, y) => {
      const gx = (6 * x) / size;
      const gy = (6 * y) / size;
      let level = 0;
      for (let n = 0; n < 3; n++)
        if (Math.hypot(gx - Math.floor(gx) - 0.5, gy - Math.floor(gy) - 0.5) < 0.15 + 0.1 * n)
          level += 1;
      level /= 3;
      return (Math.floor(gx) + Math.floor(gy)) % 2 === 0
        ? [0.2 + 0.7 * level, 0.3 + 0.4 * level, 0.9 - 0.5 * level, 1]
        : [0.9 - 0.6 * level, 0.4 + 0.2 * level, 0.2 + 0.3 * level, 1];
    }),
    fractal: frame(size, (x, y) => {
      const cx = (1.3 * (2 * x - size)) / size - 0.6;
      const cy = (1.3 * (2 * y - size)) / size;
      let zx = 0;
      let zy = 0;
      let count = 0;
      for (let i = 0; i < 32; i++) {
        if (Math.hypot(zx, zy) > 2) break;
        [zx, zy] = [zx * zx - zy * zy + cx, 2 * zx * zy + cy];
        count += 1;
      }
      const t = count / 32;
      return [t, Math.sqrt(t) * 0.8, 1 - t, 1];
    }),
    palette: frame(size, (x, y) => {
      const stops = [
        [0.1, 0.1, 0.35],
        [0.8, 0.2, 0.4],
        [0.98, 0.65, 0.2],
        [1, 0.95, 0.7],
      ];
      const wavy = x / size + 0.1 * Math.sin((10 * y) / size);
      const scaled = Math.min(0.999, Math.max(0, wavy)) * 3;
      const i = Math.floor(scaled);
      const f = scaled - i;
      return [0, 1, 2].map((k) => stops[i]![k]! * (1 - f) + stops[i + 1]![k]! * f).concat(1);
    }),
    'bouncing-balls': frame(size, (x, y) => {
      const u = (2 * x - size) / size;
      const v = -(2 * y - size) / size;
      const cover = (px: number, rise: number, radius: number): number => {
        const py = radius - 0.8 + rise * Math.abs(Math.sin(3 * time + 4 * px));
        return edge(Math.hypot(u - px, v - py) - radius);
      };
      const a = cover(-0.5, 1.2, 0.2);
      const b = cover(0.4, 0.8, 0.15);
      return [0.1 + 0.8 * a, 0.1 + 0.3 * a + 0.3 * b, 0.15 + 0.8 * b, 1];
    }),
    'double-array': Array.from({ length: INPUTS.double.count }, (_, i) => 2 * i),
    'image-blur': image.map((_, i) => {
      let total = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = Math.min(width - 1, Math.max(0, (i % width) + dx));
          const y = Math.min(height - 1, Math.max(0, Math.floor(i / width) + dy));
          total += image[y * width + x]!;
        }
      return total / 9;
    }),
    'parallel-sum': [
      Array.from({ length: INPUTS.sum.count }, (_, i) => (i % 10) + 1).reduce((a, b) => a + b, 0),
    ],
    histogram: Array.from(
      { length: 8 },
      (_, bin) =>
        Array.from({ length: INPUTS.histogram.count }, (_, i) => ((i * 37) % 100) / 100).filter(
          (v) => Math.floor(Math.min(Math.max(v, 0), 0.999) * 8) === bin,
        ).length,
    ),
    'ray-tracer': frame(size, (x, y) => rayTrace((2 * x - size) / size, (2 * y - size) / size)),
  };
}

/** What differs between what a step's run gave back and its reference, one line each: empty when
 *  they agree. A drawing step gives `pixels`, a compute step `values`. A run that threw gives its error as a string, which is one line. */
export function compare(id: string, got: Outputs | string | undefined): string[] {
  if (typeof got === 'string') return [`${id}: ${got}`];
  const want = reference()[id];
  if (want === undefined) return [`${id}: no reference`];
  const drawn = got?.['pixels'];
  const values = drawn ?? got?.['values'];
  if (values === undefined) return [`${id}: the run gave no pixels and no values`];
  if (values.length !== want.length)
    return [`${id}: ${values.length} values, the reference has ${want.length}`];
  const off = values.map((v, i) => Math.abs(v - want[i]!));
  if (drawn !== undefined) {
    const worst = Math.max(...off);
    return worst <= PIXEL ? [] : [`${id}: a pixel is off by ${worst}, the allowance is ${PIXEL}`];
  }
  const bad = off.findIndex((d, i) => d > RELATIVE * Math.max(1, Math.abs(want[i]!)));
  return bad < 0 ? [] : [`${id}: value ${bad} is ${values[bad]}, the reference has ${want[bad]}`];
}
