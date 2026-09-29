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
  /** Read every texel back, rows tightly packed, as bytes. */
  read(): Promise<Uint8Array>;
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

const isDepth = (format: string): boolean =>
  format.startsWith('depth') || format.startsWith('stencil');

/** Bytes per texel of the formats `read()` copies back. */
const TEXEL_BYTES: Readonly<Record<string, number>> = {
  r8unorm: 1,
  rg8unorm: 2,
  r16float: 2,
  rgba8unorm: 4,
  'rgba8unorm-srgb': 4,
  bgra8unorm: 4,
  'bgra8unorm-srgb': 4,
  r32float: 4,
  r32uint: 4,
  r32sint: 4,
  rg16float: 4,
  rgba16float: 8,
  rg32float: 8,
  rgba32float: 16,
  rgba32uint: 16,
  depth32float: 4,
};

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
    const texel = TEXEL_BYTES[this.format];
    if (texel === undefined)
      throw new TypeError(
        `read() cannot copy a ${this.format} texture back; it reads ${Object.keys(TEXEL_BYTES).join(', ')}.`,
      );
    const row = this.width * texel;
    const stride = Math.ceil(row / 256) * 256;
    const staging = this.device.createBuffer({
      size: stride * this.height,
      usage: BUFFER.MAP_READ | BUFFER.COPY_DST,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: this.#gpu, ...(isDepth(this.format) ? { aspect: 'depth-only' } : {}) },
      { buffer: staging, bytesPerRow: stride },
      [this.width, this.height, 1],
    );
    this.device.queue.submit([encoder.finish()]);
    await staging.mapAsync(MAP_READ);
    const mapped = new Uint8Array(staging.getMappedRange());
    const out = new Uint8Array(row * this.height);
    for (let y = 0; y < this.height; y++)
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
