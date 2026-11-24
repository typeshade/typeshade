import type { CpuProgram } from '../cpu-program.js';
import type {
  RhiBindEntry,
  RhiBindGroup,
  RhiBindGroupLayout,
  RhiBindLayoutEntry,
  RhiSampler,
  RhiSamplerDesc,
  RhiShaderModule,
  RhiTextureView,
} from '../rhi.js';
import type { CpuTexture } from './canvas.js';

export class CpuView implements RhiTextureView {
  readonly __rhi = 'view';
  constructor(readonly texture: CpuTexture) {}
}

export class CpuSampler implements RhiSampler {
  readonly __rhi = 'sampler';
  constructor(readonly desc: RhiSamplerDesc) {}
}

export class CpuModule implements RhiShaderModule {
  readonly __rhi = 'module';
  constructor(readonly program: CpuProgram) {}
}

export class CpuBindLayout implements RhiBindGroupLayout {
  readonly __rhi = 'bindlayout';
  constructor(readonly entries: readonly RhiBindLayoutEntry[]) {}
}

export class CpuBindGroup implements RhiBindGroup {
  readonly __rhi = 'bindgroup';
  constructor(
    readonly layout: CpuBindLayout,
    readonly entries: readonly RhiBindEntry[],
  ) {}
}
