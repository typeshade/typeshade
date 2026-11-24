import { andGap, gap, na, raw, refused, type Row, typed } from '../model.js';

export const COMMAND_ENCODER_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU interface',
    name: '`GPUCommandBuffer`',
    covers: ['GPUCommandBuffer'],
    evidence:
      'src/runtime/runtime.ts#Frame; src/runtime/runtime.ts#RuntimeImpl.takeConsole; src/runtime/gl.ts#GlFrameImpl.encoder|GlRuntimeImpl.submit',
    webgpu: typed('src/runtime/runtime.test.ts', 'Frame.submit() and rt.submit(encoders)'),
    webgl2: refused(
      'Rule 11.11',
      'rt.frame().submit()',
      'the WebGL2 tier refuses a GPUCommandEncoder, so it makes no command buffer',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUCommandEncoder.beginRenderPass()`',
    covers: ['GPUCommandEncoder.beginRenderPass'],
    evidence:
      'src/runtime/runtime.ts:195-224; src/runtime/gl.ts#GlFrameImpl.pass; src/runtime/gl-draw.ts#recordPass~"beginRenderPass"',
    webgpu: typed('src/runtime/runtime.test.ts', 'Frame.pass()'),
    webgl2: typed('scripts/compile-gate.ts', 'Frame.pass()'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUCommandEncoder.beginComputePass()`',
    covers: ['GPUCommandEncoder.beginComputePass'],
    evidence:
      'src/runtime/runtime.ts:195-224; src/runtime/gl.ts#GlFrameImpl.dispatch|GlComputePipelineImpl.dispatch',
    webgpu: typed('journeys/mesh-raycast/journey.mjs', 'Frame.dispatch()'),
    webgl2: typed('journeys/mesh-raycast/journey.mjs', 'Frame.dispatch()'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUCommandEncoder.copyBufferToBuffer()`',
    covers: ['GPUCommandEncoder.copyBufferToBuffer'],
    evidence:
      'src/runtime/runtime.ts#RenderPass|Frame; src/rhi/webgl2.ts#GlEncoder.copyBufferToBuffer',
    webgpu: andGap(raw('Frame.encoder'), 6, 'no typed buffer-to-buffer copy', 637),
    webgl2: gap(6, 'a buffer copy; WebGL2 copyBufferSubData has no typed form', 637),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUCommandEncoder.copyBufferToTexture()`',
    covers: ['GPUCommandEncoder.copyBufferToTexture'],
    evidence: 'src/runtime/runtime.ts#RenderPass|Frame',
    webgpu: andGap(raw('Frame.encoder'), 6, 'no typed copy from a buffer into a texture', 637),
    webgl2: gap(6, 'buffer to texture: not supported yet on the WebGL2 tier (Rule 11.11)', 637),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUCommandEncoder.copyTextureToBuffer()`',
    covers: ['GPUCommandEncoder.copyTextureToBuffer'],
    evidence:
      'src/runtime/resources.ts#TextureImpl.destroy; src/rhi/webgl2.ts#GlDevice.readTexture|readTexels~"gl.readPixels("',
    webgpu: andGap(
      typed('src/runtime/runtime.test.ts', 'Texture.read() copies level 0 of layer 0'),
      6,
      'a read of another layer or mip level has no typed spelling',
      637,
    ),
    webgl2: andGap(
      typed('scripts/compile-gate.ts', 'Texture.read() copies level 0 of layer 0'),
      6,
      'a read of another layer or mip level has no typed spelling; a readback into a PIXEL_PACK_BUFFER has no typed form',
      637,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUCommandEncoder.copyTextureToTexture()`',
    covers: ['GPUCommandEncoder.copyTextureToTexture'],
    evidence: 'src/runtime/runtime.ts#RenderPass|Frame',
    webgpu: andGap(raw('Frame.encoder'), 6, 'no typed texture-to-texture copy', 637),
    webgl2: gap(6, 'WebGL2 copyTexSubImage2D has no typed form', 637),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUCommandEncoder.clearBuffer()`',
    covers: ['GPUCommandEncoder.clearBuffer'],
    evidence: 'src/runtime/runtime.ts#RenderPass|Frame',
    webgpu: andGap(
      raw('Frame.encoder'),
      6,
      'no typed buffer clear; Buffer.set(zeros) is the typed way for a whole buffer',
      637,
    ),
    webgl2: gap(
      6,
      'Buffer.set(zeros) is the typed way; the clear has no typed form of its own',
      637,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUCommandEncoder.resolveQuerySet()`',
    covers: ['GPUCommandEncoder.resolveQuerySet'],
    evidence:
      'src/runtime/runtime.ts#RenderPass|Frame; src/runtime/gl.ts#GlFrameImpl.record|GlFrameImpl.submit',
    webgpu: andGap(
      raw(
        'Frame.encoder',
        'the host resolves the query set on its own encoder, into a buffer it made',
      ),
      4,
      'no typed spelling resolves a query set; issue 542 tracks timestamps only',
      542,
    ),
    webgl2: gap(
      4,
      'a typed query is not supported yet on the WebGL2 tier (Rule 11.11); the frame runs its draws after submit() returns (`GlFrameImpl.record` and `GlFrameImpl.submit` of `src/runtime/gl.ts`), so a query the host begins earlier wraps none; issue 542 tracks timestamps only',
      542,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUCommandEncoder.finish()`',
    covers: ['GPUCommandEncoder.finish'],
    evidence:
      'src/runtime/runtime.ts#RuntimeImpl.takeConsole; src/runtime/gl.ts#GlFrameImpl.encoder|GlRuntimeImpl.submit',
    webgpu: typed(
      'src/runtime/runtime.test.ts',
      "rt.submit(encoders) finishes the host's encoders",
    ),
    webgl2: refused(
      'Rule 11.11',
      'rt.frame().submit()',
      'the WebGL2 tier refuses a GPUCommandEncoder',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUCompilationInfo.messages`',
    covers: ['GPUCompilationInfo.messages'],
    evidence:
      'docs/language-design.md:1391-1395; src/core/gl-compute.ts#compile~"getShaderInfoLog"',
    webgpu: na(
      'the front end diagnoses at the source (Rule 12.6); the compile gate holds the emit to Tint (Rule 1.1)',
    ),
    webgl2: na(
      'WebGL2 reports shader errors through getShaderInfoLog, a string, not a list of messages (`compile` of `src/core/gl-compute.ts`)',
    ),
  },
];
