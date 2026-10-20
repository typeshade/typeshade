// ═══ The CPU tier's texture memory (change 0077, part 5; Rule 11.7, Rule 8.23) ═══
//
// Before change 0077 the CPU oracle had no texture memory: a texture read gave opaque black under
// `gpuStubs`, and a store went nowhere (`GPU_STUBS` in `core/cpu-runtime.ts`). A kernel function
// that takes a texture runs on the CPU tier through this file: a `CpuTexture` holds the texels of a
// 2D texture in row order, as the bytes of its format, and the three builtins a kernel function
// reaches it with, `textureLoad`, `textureStore` and `textureDimensions`, read and write them.
//
// A store converts the value as WebGPU converts it for the format: a float format keeps an `f32`, a
// `unorm` or `snorm` format clamps to its range and rounds to the nearest step, and an integer
// format keeps the low bits. A load outside the texture reads the nearest texel inside, and a
// store outside it is dropped: two of the results WGSL allows, the ones the WebGL2 memory root
// gives (surface §33). Filtering is no part of it: a sampled read keeps the stub contract.
//
// Like the rest of `typeshade/runtime` it imports no compiler.

import type { CpuValue } from './cpu-runtime.js';

/** How a format holds a channel. */
type Element =
  'unorm8' | 'snorm8' | 'uint8' | 'sint8' | 'uint16' | 'sint16' | 'f32' | 'u32' | 'i32';

/** The formats the CPU tier holds, with their channel count and element. `bgra8unorm` keeps its
 *  bytes in blue, green, red, alpha order, as WebGPU's `read()` gives them. */
const FORMATS: Readonly<Record<string, { readonly n: number; readonly e: Element }>> = {
  rgba8unorm: { n: 4, e: 'unorm8' },
  bgra8unorm: { n: 4, e: 'unorm8' },
  rgba8snorm: { n: 4, e: 'snorm8' },
  rgba8uint: { n: 4, e: 'uint8' },
  rgba8sint: { n: 4, e: 'sint8' },
  rgba16uint: { n: 4, e: 'uint16' },
  rgba16sint: { n: 4, e: 'sint16' },
  r32float: { n: 1, e: 'f32' },
  rg32float: { n: 2, e: 'f32' },
  rgba32float: { n: 4, e: 'f32' },
  r32uint: { n: 1, e: 'u32' },
  rg32uint: { n: 2, e: 'u32' },
  rgba32uint: { n: 4, e: 'u32' },
  r32sint: { n: 1, e: 'i32' },
  rg32sint: { n: 2, e: 'i32' },
  rgba32sint: { n: 4, e: 'i32' },
};

const ARRAYS = {
  unorm8: Uint8Array,
  snorm8: Int8Array,
  uint8: Uint8Array,
  sint8: Int8Array,
  uint16: Uint16Array,
  sint16: Int16Array,
  f32: Float32Array,
  u32: Uint32Array,
  i32: Int32Array,
} as const;

type Texels =
  Uint8Array | Int8Array | Uint16Array | Int16Array | Float32Array | Uint32Array | Int32Array;

/** Why the CPU tier cannot hold a texture of `format`, or undefined when it can. */
export function cpuFormatGap(format: string): string | undefined {
  return FORMATS[format] !== undefined
    ? undefined
    : `the CPU tier holds no ${format} texture; it holds ${Object.keys(FORMATS).join(', ')}`;
}

/**
 * A 2D texture in the CPU tier's memory (change 0077): its texels in row order, each the bytes of
 * its format. It has the shape of a program runtime's `Texture`: `width`, `height`, `format`,
 * `read()`, `readFloats()` and `destroy()`.
 */
export class CpuTexture {
  readonly format: string;
  readonly width: number;
  readonly height: number;
  /** The texels, `n` channels to a texel, in row order. */
  readonly texels: Texels;
  readonly #n: number;
  readonly #e: Element;

  constructor(width: number, height: number, format: string) {
    const f = FORMATS[format];
    if (f === undefined) throw new TypeError(cpuFormatGap(format));
    this.format = format;
    this.width = width;
    this.height = height;
    this.#n = f.n;
    this.#e = f.e;
    this.texels = new ARRAYS[f.e](width * height * f.n);
  }

  /** The CPU tier's copy of an `ImageData`: an `rgba8unorm` texture of its bytes. */
  static fromImageData(img: {
    readonly width: number;
    readonly height: number;
    readonly data: ArrayLike<number>;
  }): CpuTexture {
    const t = new CpuTexture(img.width, img.height, 'rgba8unorm');
    t.texels.set(img.data);
    return t;
  }

  /** The texture itself: the CPU tier has no device object behind it. */
  get texture(): object {
    return this;
  }

  resize(): never {
    throw new TypeError('A CPU texture keeps its size; make a new one with device.texture().');
  }

  /** Every texel as bytes, rows tightly packed, as a WebGPU texture's `read()` gives them. */
  read(): Promise<Uint8Array> {
    const t = this.texels;
    return Promise.resolve(
      new Uint8Array(t.buffer.slice(t.byteOffset, t.byteOffset + t.byteLength)),
    );
  }

  /** Every channel as a number: a float format as it holds it, `unorm` 0 to 1, `snorm` -1 to 1. */
  readFloats(): Promise<Float32Array> {
    const e = this.#e;
    if (e !== 'f32' && e !== 'unorm8' && e !== 'snorm8')
      return Promise.reject(
        new TypeError(
          `readFloats() takes a float, unorm or snorm format; a ${this.format} texture holds integers, which read() gives as bytes.`,
        ),
      );
    return Promise.resolve(
      Float32Array.from(this.texels as ArrayLike<number>, (v) => decode(e, v)),
    );
  }

  destroy(): void {
    // Its memory is the garbage collector's.
  }

  /** The texel at `[x, y]` as a `vec4`, the nearest texel inside for a coordinate outside. */
  load(at: readonly number[]): number[] {
    const x = Math.min(Math.max(Math.trunc(at[0]!), 0), this.width - 1);
    const y = Math.min(Math.max(Math.trunc(at[1]!), 0), this.height - 1);
    const out = [0, 0, 0, 1];
    const base = (y * this.width + x) * this.#n;
    for (let c = 0; c < this.#n; c++)
      out[this.#channel(c)] = decode(this.#e, this.texels[base + c]!);
    return out;
  }

  /** Store `value` at `[x, y]`, converted for the format; a coordinate outside is dropped. */
  store(at: readonly number[], value: readonly number[]): void {
    const x = Math.trunc(at[0]!);
    const y = Math.trunc(at[1]!);
    if (!(x >= 0 && y >= 0 && x < this.width && y < this.height)) return;
    const base = (y * this.width + x) * this.#n;
    for (let c = 0; c < this.#n; c++)
      this.texels[base + c] = encode(this.#e, value[this.#channel(c)] ?? 0);
  }

  /** Which shader channel memory channel `c` holds: blue first for `bgra8unorm`. */
  #channel(c: number): number {
    return this.format === 'bgra8unorm' && c !== 3 ? 2 - c : c;
  }
}

/** Whether `v` is a texture of the CPU tier's memory. */
export const isCpuTexture = (v: unknown): v is CpuTexture => v instanceof CpuTexture;

function decode(e: Element, v: number): number {
  if (e === 'unorm8') return v / 255;
  if (e === 'snorm8') return Math.max(v / 127, -1);
  return v;
}

function encode(e: Element, v: number): number {
  switch (e) {
    case 'unorm8':
      return Number.isNaN(v) ? 0 : Math.round(Math.min(Math.max(v, 0), 1) * 255);
    case 'snorm8':
      return Number.isNaN(v) ? 0 : Math.round(Math.min(Math.max(v, -1), 1) * 127);
    case 'f32':
      return Math.fround(v);
    default:
      // An integer format keeps the low bits; the typed array wraps the value.
      return Math.trunc(v);
  }
}

/** The CPU tier's `textureLoad`, `textureStore` and `textureDimensions` over a `CpuTexture`, or
 *  undefined when `name` is none of them or its texture is no `CpuTexture`. */
export function cpuTextureCall(name: string, args: readonly CpuValue[]): CpuValue | undefined {
  const t = args[0];
  if (!isCpuTexture(t)) return undefined;
  if (name === 'textureDimensions') return [t.width, t.height];
  if (name === 'textureLoad' || name === 'textureLoadU') return t.load(args[1] as number[]);
  if (name === 'textureStore') {
    t.store(args[1] as number[], args[2] as number[]);
    return 0;
  }
  return undefined;
}
