import { describe } from '../../core/host-entry.js';
import { kernelQueue } from '../../core/resident.js';
import { layoutOf, type Texture, type TextureOptions } from '../resources.js';
import type { RhiTexture } from '../../rhi/rhi.js';
import { textureKindOf, type GlTextureKind } from '../../rhi/webgl2.js';
import type { GlDrawing } from './drawing.js';

export class GlTextureImpl implements Texture {
  #tex: RhiTexture;
  #w: number;
  #h: number;
  readonly #kind: GlTextureKind;
  readonly #storage: boolean;

  constructor(
    private readonly d: GlDrawing,
    options: TextureOptions | object,
  ) {
    const o = options as TextureOptions;
    if (
      typeof o !== 'object' ||
      o === null ||
      !Array.isArray(o.size) ||
      typeof o.format !== 'string'
    )
      throw new TypeError(
        `texture() on WebGL2 takes { size, format }; got ${describe(options)}. A host's own texture is bound as it is, not wrapped.`,
      );
    if ((o.dimension ?? '2d') !== '2d' || (o.size[2] ?? 1) !== 1)
      throw new TypeError(
        'texture(): the WebGL2 tier makes 2D textures of one layer; an array or a 3D texture is not here yet.',
      );
    if ((o.sampleCount ?? 1) !== 1)
      throw new TypeError(
        'texture(): a multisampled texture is not supported yet on the WebGL2 tier (Rule 10.5, Rule 11.11).',
      );
    const kind = textureKindOf(o.format);
    if (kind === undefined)
      throw new TypeError(`texture(): ${o.format} is not supported yet on WebGL2 (Rule 11.11).`);
    this.format = o.format;
    this.#kind = kind;
    this.#storage = o.storage === true;
    this.#w = o.size[0];
    this.#h = o.size[1];
    this.#tex = this.#make();
  }

  readonly format: string;

  #make(): RhiTexture {
    return this.d.rhi.createTexture({
      size: [this.#w, this.#h, 1],
      format: this.format,
      usage: [
        'render',
        'sampled',
        'copy-src',
        'copy-dst',
        ...(this.#storage ? ['storage' as const] : []),
      ],
    });
  }

  get texture(): object {
    return this.d.rhi.toNative(this.#tex);
  }
  get handle(): RhiTexture {
    return this.#tex;
  }
  get width(): number {
    return this.#w;
  }
  get height(): number {
    return this.#h;
  }
  get kind(): GlTextureKind {
    return this.#kind;
  }

  resize(width: number, height: number): void {
    if (width === this.#w && height === this.#h) return;
    const old = this.#tex;
    this.#w = width;
    this.#h = height;
    this.#tex = this.#make();
    kernelQueue.whenIdle(() => this.d.rhi.destroyTexture(old));
  }

  read(): Promise<Uint8Array> {
    try {
      return this.#read('read');
    } catch (err) {
      return Promise.reject(err as Error);
    }
  }

  readFloats(): Promise<Float32Array> {
    try {
      const layout = layoutOf(this.format);
      if (layout?.floats === undefined)
        throw new TypeError(
          layout === undefined
            ? `readFloats() cannot copy a ${this.format} texture back; it copies every uncompressed colour format and depth32float.`
            : `readFloats() takes a float, unorm or snorm format and depth32float; a ${this.format} texture holds integers, which read() gives as bytes.`,
        );
      const floats = layout.floats;
      return this.#read('readFloats').then((bytes) => floats(bytes));
    } catch (err) {
      return Promise.reject(err as Error);
    }
  }

  #read(who: string): Promise<Uint8Array> {
    const layout = layoutOf(this.format);
    if (layout === undefined || (this.#kind === 'depth' && this.format !== 'depth32float'))
      throw new TypeError(
        `${who}() cannot copy a ${this.format} texture back; it copies every uncompressed colour format and depth32float.`,
      );
    if (/snorm$/.test(this.format))
      throw new TypeError(
        `${who}(): a ${this.format} texture is not supported yet on the WebGL2 tier, as a target or as a read-back (Rule 11.11).`,
      );
    const tex = this.#tex;
    return kernelQueue.run(() => this.d.rhi.readTexture(tex, layout.bytes));
  }

  destroy(): void {
    const t = this.#tex;
    kernelQueue.whenIdle(() => this.d.rhi.destroyTexture(t));
  }
}
