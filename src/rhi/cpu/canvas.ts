import type { RhiCanvas, RhiTexture } from '../rhi.js';
import { FORMATS, type Format } from './format.js';

export class CpuTexture implements RhiTexture {
  readonly __rhi = 'texture';
  readonly bytes: Uint8Array;
  readonly kind: Format;
  destroyed = false;
  constructor(
    readonly width: number,
    readonly height: number,
    readonly layers: number,
    readonly format: string,
    readonly canvas?: CpuCanvas,
  ) {
    const kind = FORMATS[format];
    if (kind === undefined)
      throw new TypeError(`Texture format "${format}" is not supported yet on the CPU tier.`);
    this.kind = kind;
    this.bytes = new Uint8Array(width * height * layers * kind.bytes);
  }
}

interface Context2d {
  readonly canvas: { readonly width: number; readonly height: number };
  createImageData(width: number, height: number): { readonly data: Uint8ClampedArray };
  putImageData(image: object, x: number, y: number): void;
}

export const isContext2d = (v: object): v is Context2d => {
  const c = v as Partial<Context2d>;
  return (
    typeof c.putImageData === 'function' &&
    typeof c.createImageData === 'function' &&
    typeof c.canvas === 'object'
  );
};

export class CpuCanvas implements RhiCanvas {
  readonly __rhi = 'canvas';
  texture: CpuTexture | undefined;
  constructor(readonly context: Context2d) {}
}

export function present(c: CpuCanvas): void {
  const t = c.texture;
  if (t === undefined) return;
  const image = c.context.createImageData(t.width, t.height);
  image.data.set(t.bytes);
  c.context.putImageData(image, 0, 0);
}
