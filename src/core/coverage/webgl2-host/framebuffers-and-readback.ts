import { andGap, gap, na, raw, refused, type Row, typed } from '../model.js';

export const FRAMEBUFFERS_AND_READBACK_ROWS: readonly Row[] = [
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Framebuffers and render targets: `createFramebuffer`, `bindFramebuffer`, `deleteFramebuffer`, `framebufferTexture2D`, `checkFramebufferStatus`, `drawBuffers`, `readBuffer`',
    covers: [
      'webgl:WebGL2RenderingContextBase.drawBuffers',
      'webgl:WebGL2RenderingContextBase.readBuffer',
      'webgl:WebGLRenderingContextBase.bindFramebuffer',
      'webgl:WebGLRenderingContextBase.checkFramebufferStatus',
      'webgl:WebGLRenderingContextBase.createFramebuffer',
      'webgl:WebGLRenderingContextBase.deleteFramebuffer',
      'webgl:WebGLRenderingContextBase.framebufferTexture2D',
    ],
    evidence: 'src/rhi/webgl2.ts#GlRenderPass.constructor~"drawBuffers"',
    note: 'Frame.pass(targets): colour targets, depth, clear and load',
    webgpu: typed('scripts/compile-gate.ts'),
    webgl2: typed('scripts/compile-gate.ts'),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Framebuffer invalidation: `invalidateFramebuffer`, `invalidateSubFramebuffer`',
    covers: [
      'webgl:WebGL2RenderingContextBase.invalidateFramebuffer',
      'webgl:WebGL2RenderingContextBase.invalidateSubFramebuffer',
    ],
    evidence:
      'src/runtime/runtime.ts:467-498 (FrameImpl.pass); src/runtime/program.ts:1198-1215 (depthStencilAttachmentOf); src/rhi/webgl2.ts#GlRenderPass.end~"storeOp" (a discarded attachment is cleared, and no invalidation call is made)',
    note: 'a hint: the contents after a pass may be dropped',
    webgpu: typed(
      'journeys/pass-attachments',
      'PassTargets store: discard, the WebGPU analogue; also src/runtime/runtime.test.ts',
    ),
    webgl2: na(
      "an implementation hint: `store: 'discard'` realises it by a clear to 0, and the runtime never calls invalidateFramebuffer (proposal 0064)",
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Renderbuffers: `createRenderbuffer`, `bindRenderbuffer`, `deleteRenderbuffer`, `renderbufferStorage`, `framebufferRenderbuffer`, `isRenderbuffer`, `getRenderbufferParameter`',
    covers: [
      'webgl:WebGLRenderingContextBase.bindRenderbuffer',
      'webgl:WebGLRenderingContextBase.createRenderbuffer',
      'webgl:WebGLRenderingContextBase.deleteRenderbuffer',
      'webgl:WebGLRenderingContextBase.framebufferRenderbuffer',
      'webgl:WebGLRenderingContextBase.getRenderbufferParameter',
      'webgl:WebGLRenderingContextBase.isRenderbuffer',
      'webgl:WebGLRenderingContextBase.renderbufferStorage',
    ],
    evidence:
      'src/runtime/gl-draw.ts#recordPass~"createView" (the runtime attaches textures to its targets, not renderbuffers)',
    note: 'the runtime gives every render target as a texture; a renderbuffer is a storage choice a program cannot name',
    webgpu: na(
      'the runtime gives every render target as a texture; a renderbuffer is a storage choice a program cannot name',
    ),
    webgl2: na(
      'the runtime gives every render target as a texture; a renderbuffer is a storage choice a program cannot name',
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Multisampled renderbuffers: `renderbufferStorageMultisample`',
    covers: ['webgl:WebGL2RenderingContextBase.renderbufferStorageMultisample'],
    evidence:
      'src/runtime/gl-draw.ts#GlTextureImpl.constructor (no multisampled texture on the WebGL2 tier)',
    note: 'a multisampled draw on WebGL2 is refused; the platform has a multisampled renderbuffer path that the runtime does not take',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test creates a multisampled target through the runtime; the typed spellings are sampleCount 4 (rt.texture) and multisample.count (RenderState)',
      645,
    ),
    webgl2: refused(
      'Rule 11.11',
      'none: a multisampled target is not supported yet on the WebGL2 tier',
      "the platform has a multisampled renderbuffer path (renderbufferStorageMultisample) that the runtime does not take yet; table A's GPUTextureDescriptor.sampleCount and GPUMultisampleState.count rows are refused on this tier too",
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Blit (resolve): `blitFramebuffer`',
    covers: ['webgl:WebGL2RenderingContextBase.blitFramebuffer'],
    evidence:
      'src/runtime/gl-draw.ts#GlTextureImpl.constructor~"sampleCount" (no multisampled texture on the WebGL2 tier); src/rhi/webgl2.ts#blitScreen~"blitFramebuffer" (blitFramebuffer makes the screen flip)',
    note: 'a resolve has no typed form on either tier',
    webgpu: andGap(
      raw('RenderPipeline.draw(pass, …)', 'the host makes its own pass with resolveTarget'),
      3,
      'resolveTarget has no typed form',
      634,
    ),
    webgl2: refused(
      'Rule 11.11',
      'none: a multisampled target is not supported yet on the WebGL2 tier',
      "the resolve of a multisampled target is not supported yet on this tier; table A's GPURenderPassColorAttachment.resolveTarget row has the same capability",
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: '`readPixels` (synchronous readback), `PIXEL_PACK_BUFFER`',
    covers: ['webgl:WebGL2RenderingContextOverloads.readPixels'],
    evidence: 'src/rhi/webgl2.ts (readPixels); src/runtime/resources.ts#Texture',
    note: 'Texture.read() and readFloats() on both tiers',
    webgpu: typed('src/runtime/runtime.test.ts'),
    webgl2: andGap(
      typed('scripts/compile-gate.ts'),
      6,
      'a readback into a PIXEL_PACK_BUFFER has no typed form',
      637,
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Clears: `clear`, `clearColor`, `clearDepth`, `clearStencil`, `clearBufferfv/iv/uiv/fi`',
    covers: [
      'webgl:WebGL2RenderingContextBase.clearBufferfi',
      'webgl:WebGL2RenderingContextBase.clearBufferfv',
      'webgl:WebGL2RenderingContextBase.clearBufferiv',
      'webgl:WebGL2RenderingContextBase.clearBufferuiv',
      'webgl:WebGLRenderingContextBase.clear',
      'webgl:WebGLRenderingContextBase.clearColor',
      'webgl:WebGLRenderingContextBase.clearDepth',
      'webgl:WebGLRenderingContextBase.clearStencil',
    ],
    evidence:
      'src/rhi/webgl2.ts#GlRenderPass.constructor~"clearBufferiv" (the stencil clear); src/runtime/runtime.ts:467-498 (FrameImpl.pass); src/runtime/program.ts#depthStencilAttachmentOf (depthStencilAttachmentOf)',
    note: 'PassTargets clear values',
    webgpu: typed(
      'journeys/pass-attachments',
      'PassTargets stencil.clear; also scripts/compile-gate.ts',
    ),
    webgl2: typed(
      'journeys/pass-attachments',
      'PassTargets stencil.clear; also scripts/compile-gate.ts',
    ),
  },
];
