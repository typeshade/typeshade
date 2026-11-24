import { describe } from '../../core/host-entry.js';
import type { RhiDevice, RhiSampler, RhiTexture } from '../../rhi/rhi.js';
import { GlTextureImpl } from './texture.js';
import { GlSamplerImpl } from './sampler.js';

export function textureOf(rhi: RhiDevice, v: unknown, where: string): RhiTexture {
  if (v instanceof GlTextureImpl) return v.handle;
  const host = typeof v === 'object' && v !== null ? rhi.fromNative('texture', v) : undefined;
  if (host !== undefined) return host;
  throw new TypeError(
    `${where} takes a Texture of the runtime or a WebGLTexture; got ${describe(v)}.`,
  );
}

export function samplerOf(rhi: RhiDevice, v: unknown, where: string): RhiSampler {
  if (v instanceof GlSamplerImpl) return v.handle;
  const host = typeof v === 'object' && v !== null ? rhi.fromNative('sampler', v) : undefined;
  if (host !== undefined) return host;
  throw new TypeError(
    `${where} takes a Sampler of the runtime or a WebGLSampler; got ${describe(v)}.`,
  );
}
