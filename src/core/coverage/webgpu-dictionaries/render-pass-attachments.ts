import { andGap, na, raw, refused, type Row, typed } from '../model.js';

export const RENDER_PASS_ATTACHMENTS_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderBundleEncoderDescriptor.depthReadOnly`',
    covers: ['GPURenderBundleEncoderDescriptor.depthReadOnly'],
    evidence: 'src/runtime/runtime.ts#SubmitResult|Runtime.info',
    webgpu: andGap(
      raw('Runtime.device', 'a bundle is made on rt.device and drawn through RenderPass.raw'),
      1,
      'read-only depth on a bundle has no typed spelling',
      632,
    ),
    webgl2: na('a render bundle has no WebGL2 form'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderBundleEncoderDescriptor.stencilReadOnly`',
    covers: ['GPURenderBundleEncoderDescriptor.stencilReadOnly'],
    evidence: 'src/runtime/runtime.ts#SubmitResult|Runtime.info',
    webgpu: andGap(
      raw('Runtime.device', 'a bundle is made on rt.device and drawn through RenderPass.raw'),
      1,
      'read-only stencil on a bundle has no typed spelling',
      632,
    ),
    webgl2: na('a render bundle has no WebGL2 form'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassColorAttachment.view`',
    covers: ['GPURenderPassColorAttachment.view'],
    evidence:
      'src/runtime/runtime.ts:105-170, 467-498; src/rhi/webgl2.ts#GlRenderPass.constructor~"framebufferTexture2D"',
    webgpu: typed('scripts/compile-gate.ts', 'view, clear, load'),
    webgl2: typed('scripts/compile-gate.ts', 'view, clear, load'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassColorAttachment.depthSlice`',
    covers: ['GPURenderPassColorAttachment.depthSlice'],
    evidence:
      'src/runtime/runtime.ts:467-498; src/runtime/gl-draw.ts#GlTextureImpl.constructor; src/runtime/program.ts#ComputePipeline.dispatch|RenderPipeline.vertex|RenderPipeline.fragment',
    webgpu: andGap(
      raw('RenderPipeline.draw(pass, …)', 'the host records its own pass with a slice'),
      6,
      'a slice of a 3D texture as a target (layered targets)',
      637,
    ),
    webgl2: refused(
      'Rule 11.11',
      'use a 2D texture; omit depthSlice',
      'a slice of a 3D texture; src/runtime/gl-draw.ts:161-164 refuses a dimension other than 2d',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassColorAttachment.resolveTarget`',
    covers: ['GPURenderPassColorAttachment.resolveTarget'],
    evidence:
      'src/runtime/runtime.ts:467-498; src/runtime/program.ts#ComputePipeline.dispatch|RenderPipeline.vertex|RenderPipeline.fragment; src/runtime/gl-draw.ts#GlTextureImpl.constructor',
    webgpu: andGap(
      raw('RenderPipeline.draw(pass, …)', 'the host records its own pass with a resolve target'),
      3,
      'a multisampled target cannot be resolved through Frame.pass',
      634,
    ),
    webgl2: refused(
      'Rule 11.11',
      'none: a multisampled target is not supported yet on the WebGL2 tier',
      'the WebGL2 tier draws with one sample for now; a multisampled target is not supported yet (src/runtime/gl-draw.ts:436-438); one sample is the default: omit resolveTarget',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassColorAttachment.clearValue`',
    covers: ['GPURenderPassColorAttachment.clearValue'],
    evidence:
      'src/runtime/runtime.ts:105-170, 467-498; src/runtime/gl-draw.ts#recordPass~"clearValue"; src/rhi/webgl2.ts#blitScreen',
    webgpu: typed('journeys/hdr-target/journey.mjs', 'view, clear, load'),
    webgl2: typed('journeys/hdr-target/journey.mjs', 'view, clear, load'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassColorAttachment.loadOp`',
    covers: ['GPURenderPassColorAttachment.loadOp'],
    evidence:
      'src/runtime/runtime.ts:105-170, 467-498; src/runtime/gl-draw.ts#recordPass~"loadOp"; src/rhi/webgl2.ts#blitScreen',
    webgpu: typed('scripts/compile-gate.ts', 'view, clear, load'),
    webgl2: typed('scripts/compile-gate.ts', 'view, clear, load'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassColorAttachment.storeOp`',
    covers: ['GPURenderPassColorAttachment.storeOp'],
    evidence:
      'src/runtime/runtime.ts:467-498 (FrameImpl.pass); src/runtime/program.ts#depthStencilAttachmentOf (depthStencilAttachmentOf); src/runtime/program.ts:1071-1181 (passOf); src/runtime/program.ts#checkPassFit (checkPassFit); src/runtime/runtime.ts#PassTargets.color (PassTargets); src/runtime/runtime.ts:127-129 (DepthAttachment)',
    webgpu: typed(
      'journeys/pass-attachments',
      'PassTargets.color store; also src/runtime/runtime.test.ts',
    ),
    webgl2: typed(
      'journeys/pass-attachments',
      'PassTargets.color store, cleared to 0 at pass end; also src/runtime/gl-draw.test.ts',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassDepthStencilAttachment.view`',
    covers: ['GPURenderPassDepthStencilAttachment.view'],
    evidence:
      'src/runtime/runtime.ts:105-170; src/runtime/program.ts#depthStencilAttachmentOf; src/rhi/webgl2.ts#GlRenderPass.constructor~"DEPTH_STENCIL_ATTACHMENT"; src/rhi/webgl2.ts#GlRenderPass.constructor~"DEPTH_ATTACHMENT"; src/runtime/gl-draw.ts#recordPass~"depthStencilAttachmentOf"',
    webgpu: typed('scripts/compile-gate.ts', 'depth target, clear, load'),
    webgl2: typed('scripts/compile-gate.ts', 'depth target, clear, load'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassDepthStencilAttachment.depthClearValue`',
    covers: ['GPURenderPassDepthStencilAttachment.depthClearValue'],
    evidence:
      'src/runtime/runtime.ts:105-170; src/runtime/program.ts#depthStencilAttachmentOf; src/rhi/webgl2.ts#GlRenderPass.constructor~"depthClearValue"; src/runtime/gl-draw.ts#recordPass~"depthStencilAttachmentOf"; src/rhi/webgl2.ts#blitScreen',
    webgpu: typed('scripts/compile-gate.ts', 'depth target, clear, load'),
    webgl2: typed('scripts/compile-gate.ts', 'depth target, clear, load'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassDepthStencilAttachment.depthLoadOp`',
    covers: ['GPURenderPassDepthStencilAttachment.depthLoadOp'],
    evidence:
      'src/runtime/runtime.ts:105-170; src/runtime/program.ts#depthStencilAttachmentOf; src/rhi/webgl2.ts#GlRenderPass.constructor~"depthLoadOp"; src/rhi/webgl2.ts#blitScreen',
    webgpu: typed('scripts/compile-gate.ts', 'depth target, clear, load'),
    webgl2: typed('scripts/compile-gate.ts', 'depth target, clear, load'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassDepthStencilAttachment.depthStoreOp`',
    covers: ['GPURenderPassDepthStencilAttachment.depthStoreOp'],
    evidence:
      'src/runtime/runtime.ts:467-498 (FrameImpl.pass); src/runtime/program.ts#depthStencilAttachmentOf (depthStencilAttachmentOf); src/runtime/program.ts:1071-1181 (passOf); src/runtime/program.ts#checkPassFit (checkPassFit); src/runtime/runtime.ts#PassTargets.color (PassTargets); src/runtime/runtime.ts:127-129 (DepthAttachment)',
    webgpu: typed(
      'journeys/pass-attachments',
      'DepthAttachment.store; also src/runtime/runtime.test.ts',
    ),
    webgl2: typed(
      'journeys/pass-attachments',
      'DepthAttachment.store, cleared to 0 at pass end; also src/runtime/gl-draw.test.ts',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassDepthStencilAttachment.depthReadOnly`',
    covers: ['GPURenderPassDepthStencilAttachment.depthReadOnly'],
    evidence:
      'src/runtime/runtime.ts:467-498 (FrameImpl.pass); src/runtime/program.ts#depthStencilAttachmentOf (depthStencilAttachmentOf); src/runtime/program.ts:1071-1181 (passOf); src/runtime/program.ts#checkPassFit (checkPassFit); src/runtime/gl-draw.ts#GlPass.depthReadOnly|GlPass.readsOwnDepth (GlPass.readsOwnDepth); src/runtime/runtime.ts#PassTargets.color (PassTargets); src/runtime/runtime.ts:127-129 (DepthAttachment)',
    webgpu: typed(
      'journeys/pass-attachments',
      'DepthAttachment.readOnly; also src/runtime/runtime.test.ts',
    ),
    webgl2: andGap(
      typed(
        'journeys/pass-attachments',
        'DepthAttachment.readOnly; also src/runtime/gl-draw.test.ts',
      ),
      1,
      "a texture bound from the pass's own depth attachment is refused on WebGL2 (proposal 0064)",
      632,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassDepthStencilAttachment.stencilClearValue`',
    covers: ['GPURenderPassDepthStencilAttachment.stencilClearValue'],
    evidence:
      'src/runtime/runtime.ts:467-498 (FrameImpl.pass); src/runtime/program.ts#depthStencilAttachmentOf (depthStencilAttachmentOf); src/runtime/program.ts:1071-1181 (passOf); src/runtime/program.ts#checkPassFit (checkPassFit); src/runtime/runtime.ts#PassTargets.color (PassTargets); src/runtime/runtime.ts:127-129 (DepthAttachment)',
    webgpu: typed(
      'journeys/pass-attachments',
      'DepthAttachment.stencil.clear; also src/runtime/runtime.test.ts',
    ),
    webgl2: typed(
      'journeys/pass-attachments',
      'DepthAttachment.stencil.clear; also src/runtime/gl-draw.test.ts',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassDepthStencilAttachment.stencilLoadOp`',
    covers: ['GPURenderPassDepthStencilAttachment.stencilLoadOp'],
    evidence:
      'src/runtime/runtime.ts:467-498 (FrameImpl.pass); src/runtime/program.ts#depthStencilAttachmentOf (depthStencilAttachmentOf); src/runtime/program.ts:1071-1181 (passOf); src/runtime/program.ts#checkPassFit (checkPassFit); src/runtime/runtime.ts#PassTargets.color (PassTargets); src/runtime/runtime.ts:127-129 (DepthAttachment)',
    webgpu: typed(
      'journeys/pass-attachments',
      'DepthAttachment.stencil.load; also src/runtime/runtime.test.ts',
    ),
    webgl2: typed(
      'journeys/pass-attachments',
      'DepthAttachment.stencil.load; also src/runtime/gl-draw.test.ts',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassDepthStencilAttachment.stencilStoreOp`',
    covers: ['GPURenderPassDepthStencilAttachment.stencilStoreOp'],
    evidence:
      'src/runtime/runtime.ts:467-498 (FrameImpl.pass); src/runtime/program.ts#depthStencilAttachmentOf (depthStencilAttachmentOf); src/runtime/program.ts:1071-1181 (passOf); src/runtime/program.ts#checkPassFit (checkPassFit); src/runtime/runtime.ts#PassTargets.color (PassTargets); src/runtime/runtime.ts:127-129 (DepthAttachment)',
    webgpu: typed(
      'journeys/pass-attachments',
      'DepthAttachment.stencil.store; also src/runtime/runtime.test.ts',
    ),
    webgl2: typed(
      'journeys/pass-attachments',
      'DepthAttachment.stencil.store, cleared to 0 at pass end; also src/runtime/gl-draw.test.ts',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassDepthStencilAttachment.stencilReadOnly`',
    covers: ['GPURenderPassDepthStencilAttachment.stencilReadOnly'],
    evidence:
      'src/runtime/runtime.ts:467-498 (FrameImpl.pass); src/runtime/program.ts#depthStencilAttachmentOf (depthStencilAttachmentOf); src/runtime/program.ts:1071-1181 (passOf); src/runtime/program.ts#checkPassFit (checkPassFit); src/runtime/gl-draw.ts#GlPass.stencilReadOnly|GlPass.readsOwnDepth (GlPass.readsOwnDepth); src/runtime/runtime.ts#PassTargets.color (PassTargets); src/runtime/runtime.ts:127-129 (DepthAttachment)',
    webgpu: typed(
      'journeys/pass-attachments',
      'DepthAttachment.stencil.readOnly; also src/runtime/runtime.test.ts',
    ),
    webgl2: andGap(
      typed(
        'journeys/pass-attachments',
        'DepthAttachment.stencil.readOnly; also src/runtime/gl-draw.test.ts',
      ),
      1,
      "a texture bound from the pass's own depth attachment is refused on WebGL2 (proposal 0064)",
      632,
    ),
  },
];
