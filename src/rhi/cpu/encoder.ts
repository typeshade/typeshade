import type {
  RhiBuffer,
  RhiColorAttachment,
  RhiCommandEncoder,
  RhiComputePass,
  RhiRenderPass,
  RhiRenderPassDesc,
} from '../rhi.js';
import type { CpuBuffer } from './buffer.js';
import type { CpuCanvas } from './canvas.js';
import type { CpuView } from './handles.js';
import { clearTexture, clearDepth } from './texel.js';
import type { Command } from './types.js';
import { CpuComputePassImpl } from './compute-pass.js';
import { CpuRenderPass } from './render-pass.js';

export class CpuEncoder implements RhiCommandEncoder {
  readonly commands: Command[] = [];
  constructor(readonly drawn: Set<CpuCanvas>) {}
  beginRenderPass(desc: RhiRenderPassDesc): RhiRenderPass {
    return new CpuRenderPass(this.commands, () => {
      const targets = desc.colorAttachments.map(
        (a: RhiColorAttachment) => (a.view as CpuView).texture,
      );
      const ds = desc.depthStencilAttachment;
      const depth = ds === undefined ? undefined : (ds.view as CpuView).texture;
      const first = targets[0] ?? depth;
      if (first === undefined) throw new TypeError('The render pass has no attachment.');
      for (const [i, a] of desc.colorAttachments.entries()) {
        const t = targets[i]!;
        if (a.loadOp === 'clear') clearTexture(t, a.clearValue);
        if (t.canvas !== undefined) this.drawn.add(t.canvas);
      }
      if (depth !== undefined && ds!.depthReadOnly !== true && ds!.depthLoadOp === 'clear')
        clearDepth(depth, ds!.depthClearValue ?? 1);
      return {
        targets,
        width: first.width,
        height: first.height,
        pipeline: undefined,
        groups: new Map(),
        vertexBuffers: [],
        index: undefined,
        viewport: {
          x: 0,
          y: 0,
          width: first.width,
          height: first.height,
          minDepth: 0,
          maxDepth: 1,
        },
        scissor: { x: 0, y: 0, width: first.width, height: first.height },
      };
    });
  }
  beginComputePass(): RhiComputePass {
    return new CpuComputePassImpl(this.commands);
  }
  copyBufferToBuffer(
    src: RhiBuffer,
    srcOffset: number,
    dst: RhiBuffer,
    dstOffset: number,
    size: number,
  ): void {
    this.commands.push(() => {
      const s = src as CpuBuffer;
      const d = dst as CpuBuffer;
      if (srcOffset + size > s.size || dstOffset + size > d.size)
        throw new TypeError(
          `copyBufferToBuffer: ${size} bytes from ${srcOffset} of ${s.size} to ${dstOffset} of ${d.size} do not fit.`,
        );
      d.bytes.set(s.bytes.subarray(srcOffset, srcOffset + size), dstOffset);
    });
  }
}
