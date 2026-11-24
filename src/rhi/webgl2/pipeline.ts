import type { RhiRenderPipeline, RhiVertexBufferLayout } from '../rhi.js';
import type { Slot, DrawState } from './types.js';

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
