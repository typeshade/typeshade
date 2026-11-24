import { andGap, gap, na, planned, raw, type Row, typed } from '../model.js';

export const QUERY_SET_QUEUE_AND_BUNDLES_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUQuerySet.destroy()`',
    covers: ['GPUQuerySet.destroy'],
    evidence:
      'src/runtime/runtime.ts:192-205; src/runtime/runtime.ts:230-238; src/runtime/gl.ts#GlFrameImpl.record|GlFrameImpl.submit',
    webgpu: andGap(
      raw('Runtime.device', 'the host destroys a query set it made on the runtime device'),
      4,
      'no typed spelling makes a query set; issue 542 tracks timestamps only',
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
    name: '`GPUQuerySet.type`',
    covers: ['GPUQuerySet.type'],
    evidence:
      'src/runtime/runtime.ts:192-205; src/runtime/runtime.ts#SubmitResult|Runtime.info; src/runtime/gl.ts#GlFrameImpl.record|GlFrameImpl.submit',
    webgpu: andGap(
      raw('Runtime.device', 'the host reads the type of a query set it made on the runtime device'),
      4,
      'no typed spelling makes a query set; src/runtime makes none; issue 542 tracks timestamps only',
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
    name: '`GPUQuerySet.count`',
    covers: ['GPUQuerySet.count'],
    evidence:
      'src/runtime/runtime.ts:192-205; src/runtime/runtime.ts:230-238; src/runtime/gl.ts#GlFrameImpl.record|GlFrameImpl.submit',
    webgpu: andGap(
      raw(
        'Runtime.device',
        'the host reads the count of a query set it made on the runtime device',
      ),
      4,
      'no typed spelling makes a query set; issue 542 tracks timestamps only',
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
    name: '`GPUQueue.submit()`',
    covers: ['GPUQueue.submit'],
    evidence:
      'src/runtime/runtime.ts:419-432, 500-510; src/rhi/webgpu.ts:433-436; src/runtime/gl.ts#GlFrameImpl.submit',
    webgpu: typed('src/runtime/runtime.test.ts'),
    webgl2: typed('journeys/mesh-raycast/journey.mjs'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUQueue.onSubmittedWorkDone()`',
    covers: ['GPUQueue.onSubmittedWorkDone'],
    evidence: 'src/runtime/runtime.ts#Frame; src/runtime/gl.ts#GlFrameImpl.submit',
    webgpu: typed(
      'src/runtime/runtime.test.ts',
      'Frame.submit() resolves after the queue ran the frame',
    ),
    webgl2: typed(
      'scripts/compile-gate.ts',
      'Frame.submit() resolves after the queue ran the frame',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUQueue.writeBuffer()`',
    covers: ['GPUQueue.writeBuffer'],
    evidence:
      'src/core/resident.ts#ElementView.get; changes/0048-partial-buffer-write.md:35; src/runtime/gl-draw.ts#GlDrawing.uploaded',
    webgpu: typed(
      'src/runtime/runtime.test.ts',
      'Buffer.set(value); also: planned (0048, sub-range write)',
    ),
    webgl2: typed(
      'journeys/mnist/test-webgl2.mjs',
      'Buffer.set(value); also: planned (0048, sub-range write)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUQueue.writeTexture()`',
    covers: ['GPUQueue.writeTexture'],
    evidence: 'changes/0050-texture-write.md:37-38; changes/0050-texture-write.md:331',
    webgpu: planned('0050', 'Texture.write(bytes)'),
    webgl2: gap(
      6,
      'a host write of bytes into a texture: not supported yet on the WebGL2 tier; the typed form is not written (Rule 11.11); 0050 leaves the WebGL2 tier unchanged (changes/0050-texture-write.md:331)',
      637,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUQueue.copyExternalImageToTexture()`',
    covers: ['GPUQueue.copyExternalImageToTexture'],
    evidence:
      'changes/0050-texture-write.md:64; changes/0050-texture-write.md:147; changes/0050-texture-write.md:331; docs/language-design.md:857; src/core/gl-image.ts#uploadImage',
    webgpu: planned('0050', 'the call layer uploads an image source at a call today (Rule 8.21)'),
    webgl2: gap(
      6,
      'a copy of an image into a texture: no typed copy exists on WebGL2, though the call layer uploads an image source at each call (src/core/gl-image.ts:54-74); 0050 leaves the WebGL2 tier unchanged (changes/0050-texture-write.md:331)',
      637,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface',
    name: '`GPURenderBundle`',
    covers: ['GPURenderBundle'],
    evidence: 'src/runtime/runtime.ts#StencilAspect|RenderPass',
    webgpu: raw('RenderPass.raw', 'RenderPass.raw.executeBundles'),
    webgl2: na('WebGPU render bundles; WebGL2 has no bundle object'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPURenderBundleEncoder.finish()`',
    covers: ['GPURenderBundleEncoder.finish'],
    evidence: 'src/runtime/runtime.ts#SubmitResult|Runtime.info',
    webgpu: raw('Runtime.device', 'made on rt.device'),
    webgl2: na('WebGPU render bundles; WebGL2 has no bundle object'),
  },
];
