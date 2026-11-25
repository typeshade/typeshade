import type {
  RhiBuffer,
  RhiCommandEncoder,
  RhiComputePass,
  RhiRenderPass,
  RhiRenderPassDesc,
} from '../rhi.js';
import type { GlEncoderHost } from './types.js';
import type { GlBuffer } from './handles.js';
import { GlRenderPass } from './render-pass.js';

export const NO_COMPUTE =
  'The WebGL2 backend has no compute pass: a dispatch on WebGL2 runs as the pass program of change 0054 (caps.compute is fragment-emulated).';

export class GlEncoder implements RhiCommandEncoder {
  constructor(private readonly device: GlEncoderHost) {}

  beginRenderPass(desc: RhiRenderPassDesc): RhiRenderPass {
    return new GlRenderPass(this.device, this.device.state(), desc);
  }

  beginComputePass(): RhiComputePass {
    throw new TypeError(NO_COMPUTE);
  }

  copyBufferToBuffer(
    src: RhiBuffer,
    srcOffset: number,
    dst: RhiBuffer,
    dstOffset: number,
    size: number,
  ): void {
    const from = (src as GlBuffer).bytes;
    const to = dst as GlBuffer;
    if (from === undefined || to.bytes === undefined)
      throw new TypeError(
        'copyBufferToBuffer on WebGL2 copies between buffers the device made; a host WebGLBuffer holds no bytes the device keeps.',
      );
    to.bytes.set(from.subarray(srcOffset, srcOffset + size), dstOffset);
    to.staleBuffer = to.staleTexture = true;
  }
}
