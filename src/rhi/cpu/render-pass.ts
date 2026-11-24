import type { RhiBindGroup, RhiBuffer, RhiRenderPass, RhiRenderPipeline } from '../rhi.js';
import type { CpuBuffer } from './buffer.js';
import type { CpuBindGroup } from './handles.js';
import type { CpuRenderPipeline } from './pipelines.js';
import type { Command } from './types.js';
import { draw, type PassState } from './execute.js';

export class CpuRenderPass implements RhiRenderPass {
  readonly #commands: Command[];
  readonly #state: () => PassState;
  constructor(commands: Command[], begin: () => PassState) {
    this.#commands = commands;
    let state: PassState | undefined;
    commands.push(() => {
      state = begin();
    });
    this.#state = () => state!;
  }
  #push(f: (s: PassState) => void): void {
    this.#commands.push(() => f(this.#state()));
  }
  setPipeline(pipeline: RhiRenderPipeline): void {
    this.#push((s) => (s.pipeline = pipeline as CpuRenderPipeline));
  }
  setBindGroup(index: number, group: RhiBindGroup): void {
    this.#push((s) => s.groups.set(index, group as CpuBindGroup));
  }
  setVertexBuffer(slot: number, buffer: RhiBuffer): void {
    this.#push((s) => (s.vertexBuffers[slot] = buffer as CpuBuffer));
  }
  setIndexBuffer(buffer: RhiBuffer, format: 'uint16' | 'uint32'): void {
    this.#push((s) => (s.index = { buffer: buffer as CpuBuffer, format }));
  }
  draw(vertexCount: number, instanceCount = 1): void {
    this.#push((s) => draw(s, (k) => k, vertexCount, instanceCount));
  }
  drawIndexed(indexCount: number, instanceCount = 1): void {
    this.#push((s) => {
      if (s.index === undefined)
        throw new TypeError('The indexed draw has no index buffer: call setIndexBuffer first.');
      const { buffer, format } = s.index;
      const size = format === 'uint16' ? 2 : 4;
      if (indexCount * size > buffer.size)
        throw new TypeError(
          `The indexed draw reads ${indexCount} indices, past the index buffer's ${buffer.size / size}.`,
        );
      const dv = new DataView(buffer.bytes.buffer);
      draw(
        s,
        (k) => (size === 2 ? dv.getUint16(2 * k, true) : dv.getUint32(4 * k, true)),
        indexCount,
        instanceCount,
      );
    });
  }
  setViewport(
    x: number,
    y: number,
    width: number,
    height: number,
    minDepth: number,
    maxDepth: number,
  ): void {
    this.#push((s) => (s.viewport = { x, y, width, height, minDepth, maxDepth }));
  }
  setScissorRect(x: number, y: number, width: number, height: number): void {
    this.#push((s) => (s.scissor = { x, y, width, height }));
  }
  setBlendConstant(): void {
    // No pipeline of this backend blends (it refuses a `blend`), so the constant reaches nothing.
  }
  setStencilReference(): void {
    // No pipeline of this backend tests the stencil (it refuses one), so the reference reaches
    // nothing.
  }
  end(): void {}
}
