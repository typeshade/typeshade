import type {
  RhiBindGroupLayout,
  RhiComputePipeline,
  RhiRenderPipeline,
  RhiRenderPipelineDesc,
} from '../rhi.js';
import type { Stage } from './stage.js';

export class CpuComputePipeline implements RhiComputePipeline {
  readonly __rhi = 'computepipeline';
  constructor(
    readonly stage: Stage,
    readonly layouts: readonly RhiBindGroupLayout[],
  ) {}
}

export class CpuRenderPipeline implements RhiRenderPipeline {
  readonly __rhi = 'pipeline';
  constructor(
    readonly vertex: Stage,
    readonly fragment: Stage | undefined,
    readonly desc: RhiRenderPipelineDesc,
  ) {}
}
