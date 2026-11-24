import type { RhiRenderPipeline, RhiVertexBufferLayout } from '../rhi.js';
import type { DrawState } from './draw-state.js';

export interface Slot {
  readonly binding: number;
  readonly kind: 'block' | 'texture' | 'data';
  readonly unit: number;
  readonly minimum?: number;
  readonly sampler?: number;
}

export class GlPipeline implements RhiRenderPipeline {
  readonly __rhi = 'pipeline' as const;
  constructor(
    readonly program: WebGLProgram,
    readonly slots: readonly (readonly Slot[])[],
    readonly state: DrawState,
    readonly vao: WebGLVertexArrayObject,
    readonly buffers: readonly RhiVertexBufferLayout[],
    readonly flat: boolean,
  ) {}
}

export function glReadBindings(pipeline: RhiRenderPipeline): readonly (readonly number[])[] {
  return (pipeline as GlPipeline).slots.map((group) => group.map((s) => s.binding));
}
