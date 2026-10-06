// The resources the program runtime makes (Rule 11.11): a `Texture` (change 0025, #204's image) and a
// `Sampler`. Each is made by the runtime or wraps the host's own object, so a host that writes
// WebGPU beside the runtime binds the same texture both ways.

import {
  BUFFER,
  MAP_READ,
  TEXTURE,
  type Device,
  type Sampler as GpuSampler,
  type Texture as GpuTexture,
  type TextureView,
} from './gpu.js';
import { DEVICE_VIEW } from '../core/host-entry.js';

/** What `rt.texture()` makes. `format` is any `GPUTextureFormat` the device can render to or
 *  sample: `rgba8unorm`, `rgba16float`, `depth24plus`, `r32float`. */
export interface TextureOptions {
  /** `[width, height]`, or `[width, height, layers]` for an array or a 3D texture. */
  readonly size: readonly [number, number] | readonly [number, number, number];
  readonly format: string;
  /** `'2d'` (the default) or `'3d'`. A texture is a render target and a sampled texture at once,
   *  and one with a single sample can be copied to and from. */
  readonly dimension?: '2d' | '3d';
  /** 4 for a multisampled render target; 1, the default, otherwise. */
  readonly sampleCount?: number;
  /** Add `STORAGE_BINDING`, for a storage texture an entry writes. */
  readonly storage?: boolean;
}

/**
 * A texture the runtime binds by name and renders into: a sampled texture, a render target, a
 * depth or shadow map. It lives until `destroy()`, and `resize()` gives it a new size, keeping
 * its format. `texture` is the `GPUTexture` itself, for the host's own WebGPU.
 */
export interface Texture {
  readonly texture: object;
  readonly format: string;
  readonly width: number;
  readonly height: number;
  /** Replace the texture with one of this size. What it held is gone. */
  resize(width: number, height: number): void;
  /**
   * Read every texel back as bytes: rows tightly packed, as many bytes to a texel as the format
   * has, its channels in the format's order (a `bgra8unorm` texel is blue, green, red, alpha).
   * Any uncompressed colour format is read, and `depth32float`; a compressed format and the other
   * depth and stencil formats reject with a `TypeError`. An array or a 3D texture gives its first
   * layer or slice.
   *
   * A read reads what was submitted before the call. Its copy is recorded and submitted before
   * `read()` awaits anything, so the queue runs it after every submit made before the call and
   * before every one made after: a frame submitted while the read is pending draws after the
   * copy, and the bytes are the texture as it was. `frame.submit()` and `rt.submit()` hand the
   * queue their commands before their own first `await`, so a frame counts as submitted from that
   * call and not from the moment its promise resolves; a frame recorded and not yet submitted is
   * not read.
   */
  read(): Promise<Uint8Array>;
  /**
   * Read every texel back as numbers: a `Float32Array` of the texels' channels in the order and
   * with the packing `read()` gives, one number to each channel of each texel. A float format is
   * decoded (a half float exactly), a `unorm` one gives 0 to 1, an `snorm` one -1 to 1, and
   * `depth32float` its depth. An sRGB format gives the numbers it stores, as `read()`'s bytes
   * hold them, not the linear values a shader reads. An integer format rejects with a `TypeError`
   * that names `read()`, which gives its bytes.
   *
   * It reads what `read()` reads, and when: the copy is recorded and submitted before
   * `readFloats()` awaits anything.
   */
  readFloats(): Promise<Float32Array>;
  destroy(): void;
}

/** What `rt.sampler()` makes. */
export interface SamplerOptions {
  /** How it magnifies, minifies and picks between mip levels: `'linear'` when omitted. */
  readonly filter?: 'nearest' | 'linear';
  /** What it reads past an edge, on every axis: `'clamp'` (clamp to the edge) when omitted. */
  readonly address?: 'clamp' | 'repeat' | 'mirror';
  /** A comparison sampler, for a depth texture a shadow pass wrote: the comparison it makes. */
  readonly compare?:
    | 'less'
    | 'less-equal'
    | 'greater'
    | 'greater-equal'
    | 'equal'
    | 'not-equal'
    | 'always'
    | 'never';
}

/** A sampler the runtime binds by name. `sampler` is the `GPUSampler` itself. */
export interface Sampler {
  readonly sampler: object;
}

const ADDRESS = { clamp: 'clamp-to-edge', repeat: 'repeat', mirror: 'mirror-repeat' } as const;

/** A format `read()` copies: its bytes to a texel, and what `readFloats()` makes of them, which is
 *  nothing for a format of integers. `raw` holds the texels' bytes on a buffer of its own. */
export interface Layout {
  readonly bytes: number;
  readonly floats?: (raw: Uint8Array) => Float32Array;
}

/** `f` of each element, as `f32`s. */
function map(from: ArrayLike<number>, f: (v: number) => number): Float32Array {
  const out = new Float32Array(from.length);
  for (let i = 0; i < from.length; i++) out[i] = f(from[i]!);
  return out;
}

/** An unsigned float of a 5-bit exponent and `m` mantissa bits, biased by 15: a half float without
 *  its sign, and the red and green (`m` 6) and blue (`m` 5) of `rg11b10ufloat`. */
function small(v: number, m: number): number {
  const e = v >> m;
  const f = v & ((1 << m) - 1);
  if (e === 0) return f * 2 ** (-14 - m);
  if (e === 31) return f === 0 ? Infinity : NaN;
  return (1 + f / 2 ** m) * 2 ** (e - 15);
}

/** A format packed into one 32-bit word, whose `channels` are what `unpack` makes of a word. */
const packed = (channels: number, unpack: (word: number) => number[]): Layout => ({
  bytes: 4,
  floats: (raw) => {
    const words = new Uint32Array(raw.buffer);
    const out = new Float32Array(words.length * channels);
    for (let i = 0; i < words.length; i++) out.set(unpack(words[i]!), i * channels);
    return out;
  },
});

/** The packed formats. */
const PACKED: Readonly<Record<string, Layout>> = {
  __proto__: null as never,
  rgb10a2uint: { bytes: 4 },
  rgb10a2unorm: packed(4, (w) => [
    (w & 1023) / 1023,
    ((w >>> 10) & 1023) / 1023,
    ((w >>> 20) & 1023) / 1023,
    (w >>> 30) / 3,
  ]),
  rg11b10ufloat: packed(3, (w) => [
    small(w & 2047, 6),
    small((w >>> 11) & 2047, 6),
    small(w >>> 22, 5),
  ]),
  // Three 9-bit mantissas under a shared 5-bit exponent, biased by 15.
  rgb9e5ufloat: packed(3, (w) => {
    const scale = 2 ** ((w >>> 27) - 24);
    return [(w & 511) * scale, ((w >>> 9) & 511) * scale, ((w >>> 18) & 511) * scale];
  }),
};

/** The formats named by their channels, their bits and how they are stored: `rgba16float`,
 *  `r8snorm`, `bgra8unorm-srgb`. */
const NAMED = /^(r|rg|rgba|bgra)(8|16|32)(unorm|snorm|uint|sint|float)(-srgb)?$/;

/** How `read()` and `readFloats()` take a format, or `undefined` for one they cannot copy: a
 *  compressed format, and every depth and stencil format but `depth32float`. */
export function layoutOf(format: string): Layout | undefined {
  const known = PACKED[format];
  if (known !== undefined) return known;
  // A depth32float texel is one 32-bit float, as an r32float one is.
  const named = NAMED.exec(format === 'depth32float' ? 'r32float' : format);
  if (named === null) return undefined;
  const bits = Number(named[2]);
  const kind = named[3];
  const bytes = (named[1]!.length * bits) / 8;
  if (kind === 'uint' || kind === 'sint') return { bytes };
  const snorm = kind === 'snorm';
  // The largest value a channel holds: 255 or 65535, or 127 or 32767 with a sign.
  const top = 2 ** (bits - (snorm ? 1 : 0)) - 1;
  const decode =
    kind === 'float'
      ? (h: number) => (h & 0x8000 ? -1 : 1) * small(h & 0x7fff, 10)
      : snorm
        ? (v: number) => Math.max(v / top, -1)
        : (v: number) => v / top;
  const View: new (buffer: ArrayBufferLike) => ArrayLike<number> =
    bits === 32
      ? Float32Array
      : bits === 16
        ? snorm
          ? Int16Array
          : Uint16Array
        : snorm
          ? Int8Array
          : Uint8Array;
  return {
    bytes,
    floats: (raw) =>
      bits === 32 ? new Float32Array(raw.buffer) : map(new View(raw.buffer), decode),
  };
}

export class TextureImpl implements Texture {
  /** The view the call layer binds when a call takes this texture as an image (change 0025). */
  [DEVICE_VIEW](): object {
    return this.view();
  }

  #gpu: GpuTexture;
  #view: TextureView | undefined;
  readonly #owned: boolean;
  readonly #options: TextureOptions | undefined;

  constructor(
    private readonly device: Device,
    source: TextureOptions | object,
  ) {
    if ('createView' in source) {
      this.#gpu = source as GpuTexture;
      this.#owned = false;
      this.#options = undefined;
    } else {
      this.#options = source as TextureOptions;
      this.#gpu = this.#make(this.#options.size[0], this.#options.size[1]);
      this.#owned = true;
    }
  }

  #make(width: number, height: number): GpuTexture {
    const o = this.#options!;
    const samples = o.sampleCount ?? 1;
    let usage = TEXTURE.RENDER_ATTACHMENT | TEXTURE.TEXTURE_BINDING;
    if (samples === 1) usage |= TEXTURE.COPY_SRC | TEXTURE.COPY_DST;
    if (o.storage === true) usage |= TEXTURE.STORAGE_BINDING;
    return this.device.createTexture({
      size: [width, height, o.size[2] ?? 1],
      format: o.format,
      dimension: o.dimension ?? '2d',
      sampleCount: samples,
      usage,
    });
  }

  get texture(): object {
    return this.#gpu;
  }
  get format(): string {
    return this.#gpu.format;
  }
  get width(): number {
    return this.#gpu.width;
  }
  get height(): number {
    return this.#gpu.height;
  }

  /** The view a bind group or a pass attaches. */
  view(): TextureView {
    return (this.#view ??= this.#gpu.createView());
  }

  resize(width: number, height: number): void {
    if (!this.#owned)
      throw new TypeError(
        'This texture wraps one the host made; resize the host’s texture instead.',
      );
    if (width === this.width && height === this.height) return;
    this.#gpu.destroy();
    this.#gpu = this.#make(width, height);
    this.#view = undefined;
  }

  async read(): Promise<Uint8Array> {
    return this.#copy(this.#layout('read'));
  }

  async readFloats(): Promise<Float32Array> {
    const layout = this.#layout('readFloats');
    if (layout.floats === undefined)
      throw new TypeError(
        `readFloats() takes a float, unorm or snorm format and depth32float; a ${this.format} texture holds integers, which read() gives as bytes.`,
      );
    // The copy is recorded and submitted by the call, before this awaits anything.
    return layout.floats(await this.#copy(layout));
  }

  /** How the texture's format reads back; `who` is the method that asks. */
  #layout(who: string): Layout {
    const layout = layoutOf(this.format);
    if (layout === undefined)
      throw new TypeError(
        `${who}() cannot copy a ${this.format} texture back; it copies every uncompressed colour format and depth32float.`,
      );
    return layout;
  }

  /** The texels as bytes, rows tightly packed. The copy is recorded and submitted here, before
   *  anything is awaited, so it runs after every submit made before the call and before every one
   *  made after it; the size is the texture's at the call, whatever `resize()` does after. */
  async #copy(layout: Layout): Promise<Uint8Array> {
    const { width, height } = this;
    const row = width * layout.bytes;
    const stride = Math.ceil(row / 256) * 256;
    const staging = this.device.createBuffer({
      size: stride * height,
      usage: BUFFER.MAP_READ | BUFFER.COPY_DST,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: this.#gpu, ...(this.format === 'depth32float' ? { aspect: 'depth-only' } : {}) },
      { buffer: staging, bytesPerRow: stride },
      [width, height, 1],
    );
    this.device.queue.submit([encoder.finish()]);
    await staging.mapAsync(MAP_READ);
    const mapped = new Uint8Array(staging.getMappedRange());
    const out = new Uint8Array(row * height);
    for (let y = 0; y < height; y++)
      out.set(mapped.subarray(y * stride, y * stride + row), y * row);
    staging.unmap();
    staging.destroy();
    return out;
  }

  destroy(): void {
    if (this.#owned) this.#gpu.destroy();
  }
}

export class SamplerImpl implements Sampler {
  readonly #gpu: GpuSampler;
  constructor(device: Device, source: SamplerOptions | object | undefined) {
    if (source !== undefined && !isSamplerOptions(source)) {
      this.#gpu = source as GpuSampler;
      return;
    }
    const o = (source ?? {}) as SamplerOptions;
    const filter = o.filter ?? 'linear';
    const address = ADDRESS[o.address ?? 'clamp'];
    this.#gpu = device.createSampler({
      magFilter: filter,
      minFilter: filter,
      mipmapFilter: filter,
      addressModeU: address,
      addressModeV: address,
      addressModeW: address,
      ...(o.compare !== undefined ? { compare: o.compare } : {}),
    });
  }
  get sampler(): object {
    return this.#gpu;
  }
}

/** A plain object is options; a `GPUSampler` is an instance of its own class. */
function isSamplerOptions(o: object): boolean {
  const proto = Object.getPrototypeOf(o) as unknown;
  return proto === Object.prototype || proto === null;
}
