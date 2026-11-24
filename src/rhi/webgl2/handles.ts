import type {
  RhiBindEntry,
  RhiBindGroup,
  RhiBindGroupLayout,
  RhiBindLayoutEntry,
  RhiBuffer,
  RhiBufferUsage,
  RhiCanvas,
  RhiSampler,
  RhiShaderModule,
  RhiTexture,
  RhiTextureView,
} from '../rhi.js';
import type { GlFormat } from './format.js';

export class GlBuffer implements RhiBuffer {
  readonly __rhi = 'buffer' as const;
  staleBuffer = true;
  staleTexture = true;
  padded = -1;
  texture: WebGLTexture | undefined;
  first: { readonly native: WebGLBuffer; key: string; count: number } | undefined;

  constructor(
    readonly size: number,
    readonly usage: ReadonlySet<RhiBufferUsage>,
    readonly elem: 'f32' | 'i32' | 'u32',
    readonly bytes: Uint8Array | undefined,
    readonly native: WebGLBuffer | undefined,
    readonly owned: boolean,
  ) {}
}

export class GlTexture implements RhiTexture {
  readonly __rhi = 'texture' as const;
  constructor(
    readonly native: WebGLTexture | undefined,
    readonly width: number,
    readonly height: number,
    readonly format: string,
    readonly fmt: GlFormat | undefined,
    readonly screen = false,
  ) {}
}

export class GlView implements RhiTextureView {
  readonly __rhi = 'view' as const;
  constructor(readonly texture: GlTexture) {}
}

export class GlSampler implements RhiSampler {
  readonly __rhi = 'sampler' as const;
  constructor(readonly native: WebGLSampler) {}
}

export class GlModule implements RhiShaderModule {
  readonly __rhi = 'module' as const;
  constructor(readonly code: string) {}
}

export class GlLayout implements RhiBindGroupLayout {
  readonly __rhi = 'bindlayout' as const;
  constructor(readonly entries: readonly RhiBindLayoutEntry[]) {}
}

export class GlGroup implements RhiBindGroup {
  readonly __rhi = 'bindgroup' as const;
  constructor(readonly entries: ReadonlyMap<number, RhiBindEntry['resource']>) {}
}

export class GlCanvas implements RhiCanvas {
  readonly __rhi = 'canvas' as const;
}
