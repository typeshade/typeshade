import type { CompareFunction } from '../program.js';
import type { Sampler, SamplerOptions } from '../resources.js';
import type { RhiDevice, RhiSampler } from '../../rhi/rhi.js';

const COMPARISONS: Record<CompareFunction, true> = {
  never: true,
  less: true,
  equal: true,
  'less-equal': true,
  greater: true,
  'not-equal': true,
  'greater-equal': true,
  always: true,
};

export class GlSamplerImpl implements Sampler {
  readonly handle: RhiSampler;
  constructor(
    private readonly rhi: RhiDevice,
    options: SamplerOptions | object | undefined,
  ) {
    const host = options === undefined ? undefined : rhi.fromNative('sampler', options);
    if (host !== undefined) {
      this.handle = host;
      return;
    }
    const o = (options ?? {}) as SamplerOptions;
    if (o.compare !== undefined && !(o.compare in COMPARISONS))
      throw new TypeError(
        `"${String(o.compare)}" is not a comparison; WebGPU's are less, less-equal, greater, greater-equal, equal, not-equal, always and never.`,
      );
    const filter = (o.filter ?? 'linear') === 'nearest' ? 'nearest' : 'linear';
    const address =
      o.address === 'repeat'
        ? 'repeat'
        : o.address === 'mirror'
          ? 'mirror-repeat'
          : 'clamp-to-edge';
    this.handle = rhi.createSampler({
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
    return this.rhi.toNative(this.handle);
  }
}
