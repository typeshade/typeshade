import { andGap, gap, na, raw, type Row, typed } from '../model.js';

export const STENCIL_AND_TEXEL_COPY_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUStencilFaceState.compare`',
    covers: ['GPUStencilFaceState.compare'],
    evidence:
      'src/runtime/program.ts:118 (StencilFaceState); src/runtime/program.ts:750 (planOf); src/rhi/webgl2.ts#compareOf|stencilOpOf (stencilOpOf)',
    webgpu: typed(
      'src/runtime/render-state-parity.test.ts',
      'RenderState.depth.stencil.compare; the pass of each draw in the journey',
    ),
    webgl2: typed(
      'journeys/pipeline-state',
      'RenderState.depth.stencil.compare; also src/runtime/gl-draw.test.ts',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUStencilFaceState.failOp`',
    covers: ['GPUStencilFaceState.failOp'],
    evidence:
      'src/runtime/program.ts:118 (StencilFaceState); src/runtime/program.ts:750 (planOf); src/rhi/webgl2.ts#stencilOpOf (stencilOpOf)',
    webgpu: typed(
      'src/runtime/render-state-parity.test.ts',
      'RenderState.depth.stencil.failOp; the pass of each draw in the journey',
    ),
    webgl2: typed(
      'journeys/pipeline-state',
      'RenderState.depth.stencil.failOp; also src/runtime/gl-draw.test.ts',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUStencilFaceState.depthFailOp`',
    covers: ['GPUStencilFaceState.depthFailOp'],
    evidence:
      'src/runtime/program.ts:118 (StencilFaceState); src/runtime/program.ts:750 (planOf); src/rhi/webgl2.ts#stencilOpOf (stencilOpOf)',
    webgpu: typed(
      'src/runtime/render-state-parity.test.ts',
      'RenderState.depth.stencil.depthFailOp; the pass of each draw in the journey',
    ),
    webgl2: typed(
      'journeys/pipeline-state',
      'RenderState.depth.stencil.depthFailOp; also src/runtime/gl-draw.test.ts',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUStencilFaceState.passOp`',
    covers: ['GPUStencilFaceState.passOp'],
    evidence:
      'src/runtime/program.ts:118 (StencilFaceState); src/runtime/program.ts:750 (planOf); src/rhi/webgl2.ts#stencilOpOf (stencilOpOf)',
    webgpu: typed(
      'src/runtime/render-state-parity.test.ts',
      'RenderState.depth.stencil.passOp; the pass of each draw in the journey',
    ),
    webgl2: typed(
      'journeys/pipeline-state',
      'RenderState.depth.stencil.passOp; also src/runtime/gl-draw.test.ts',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUStorageTextureBindingLayout.access`',
    covers: ['GPUStorageTextureBindingLayout.access'],
    evidence: 'src/runtime/program.ts:1328-1381',
    webgpu: andGap(
      typed('scripts/compile-gate.ts', "from the binding's format and access"),
      6,
      'read_write beyond r32uint, r32sint and r32float is refused (TS8002); §14 row, docs/language-design.md:1504; roadmap 13b, docs/roadmap.md:228',
      162,
    ),
    webgl2: na(
      'WebGL2 has no bind group layout; its bindings are set by name. The binding kind itself is typed: see GPUStorageTextureAccess.',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUStorageTextureBindingLayout.format`',
    covers: ['GPUStorageTextureBindingLayout.format'],
    evidence: 'src/runtime/program.ts:1328-1381',
    webgpu: andGap(
      typed('scripts/compile-gate.ts', "from the binding's format and access"),
      6,
      'read_write formats beyond r32uint, r32sint and r32float have no spelling; a host-feature capability or a refusal is open (docs/language-design.md:1504; roadmap 0.4 item 13b, docs/roadmap.md:228)',
      162,
    ),
    webgl2: na('WebGL2 has no bind group layout; its bindings are set by name'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUStorageTextureBindingLayout.viewDimension`',
    covers: ['GPUStorageTextureBindingLayout.viewDimension'],
    evidence: 'src/runtime/program.ts:1328-1381',
    webgpu: gap(
      15,
      "typed in code; no test reads it on this target (Rule 11.18): no test reads a storageTexture entry; the entry's viewDimension comes from the manifest's textureDim (src/runtime/program.ts:1351); from the binding's format and access; refused today with no rule number: storage 1d and 3d are not spelled (docs/language-design.md:1539; roadmap 0.4 item 13c, docs/roadmap.md:229)",
      645,
    ),
    webgl2: na(
      'WebGL2 has no bind group layout; its bindings are set by name. The binding kind itself is typed: see GPUTextureViewDimension.',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTexelCopyBufferInfo.buffer`',
    covers: ['GPUTexelCopyBufferInfo.buffer'],
    evidence: 'src/runtime/runtime.ts#RenderPass|Frame; src/rhi/webgl2.ts#depthToColour',
    webgpu: raw('Frame.encoder', 'Frame.encoder copies; Texture.read() is the typed readback'),
    webgl2: gap(
      6,
      'WebGL2 reads a texture into a buffer with readPixels on PIXEL_PACK_BUFFER; a readback into a PIXEL_PACK_BUFFER has no typed form; the runtime has no copy that takes a buffer info',
      637,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTexelCopyBufferLayout.offset`',
    covers: ['GPUTexelCopyBufferLayout.offset'],
    evidence:
      'src/runtime/resources.ts:35-70, 262-274; src/rhi/webgpu.ts:312-336; src/rhi/webgl2.ts#depthToColour',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets or reads an offset on read() (src/rhi/webgpu.ts:322-326); rows tightly packed on read(); also: write is planned (0050)',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): the WebGL2 read passes a literal 0 offset (src/rhi/webgl2.ts:753); rows tightly packed on read(); write: 0050 is WebGPU only (changes/0050-texture-write.md:331)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTexelCopyBufferLayout.bytesPerRow`',
    covers: ['GPUTexelCopyBufferLayout.bytesPerRow'],
    evidence:
      'src/runtime/resources.ts:35-70, 262-274; src/rhi/webgpu.ts:312-336; src/rhi/webgl2.ts#depthToColour',
    webgpu: typed(
      'src/runtime/runtime.test.ts',
      'rows tightly packed on read(); also: write is planned (0050)',
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): the WebGL2 read has no row stride; readPixels packs the rows (src/rhi/webgl2.ts:753); rows tightly packed on read(); write: 0050 is WebGPU only (changes/0050-texture-write.md:331)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTexelCopyBufferLayout.rowsPerImage`',
    covers: ['GPUTexelCopyBufferLayout.rowsPerImage'],
    evidence:
      'src/runtime/resources.ts:35-70, 262-274; src/rhi/webgpu.ts:312-336; src/rhi/webgl2.ts#depthToColour',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): the one-layer read sets no rowsPerImage (src/runtime/resources.ts:286); rows tightly packed on read(); also: write is planned (0050)',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): the WebGL2 read has no image height (src/rhi/webgl2.ts:753); rows tightly packed on read(); write: 0050 is WebGPU only (changes/0050-texture-write.md:331)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTexelCopyTextureInfo.texture`',
    covers: ['GPUTexelCopyTextureInfo.texture'],
    evidence: 'src/runtime/resources.ts#TextureImpl.destroy; src/rhi/webgl2.ts#depthToColour',
    webgpu: andGap(
      typed('journeys/plasma/journey.mjs', 'read() copies level 0 of layer 0'),
      6,
      'a layer read has no typed spelling',
      637,
    ),
    webgl2: andGap(
      typed('journeys/plasma/journey.mjs', 'read() copies level 0 of layer 0'),
      6,
      'a layer read has no typed spelling',
      637,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTexelCopyTextureInfo.mipLevel`',
    covers: ['GPUTexelCopyTextureInfo.mipLevel'],
    evidence: 'src/runtime/resources.ts#TextureImpl.destroy; src/rhi/webgl2.ts#depthToColour',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets or reads a mip level (src/runtime/resources.ts:286); read() copies level 0 of layer 0; a read of another mip level has no typed spelling',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): the WebGL2 read binds level 0 as a literal (src/rhi/webgl2.ts:740); read() copies level 0 of layer 0; a read of another mip level has no typed spelling',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTexelCopyTextureInfo.origin`',
    covers: ['GPUTexelCopyTextureInfo.origin'],
    evidence: 'src/runtime/resources.ts#TextureImpl.destroy; src/rhi/webgl2.ts#depthToColour',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): the read copy takes the default origin (src/runtime/resources.ts:286); read() copies level 0 of layer 0; a read at another origin has no typed spelling',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): readPixels starts at (0, 0) as a literal (src/rhi/webgl2.ts:753); read() copies level 0 of layer 0; a read at another origin has no typed spelling',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTexelCopyTextureInfo.aspect`',
    covers: ['GPUTexelCopyTextureInfo.aspect'],
    evidence:
      'src/runtime/resources.ts#TextureImpl.destroy; src/runtime/gl-draw.ts#GlTextureImpl.readFloats; src/rhi/webgl2.ts#BLIT_VS|depthToColour',
    webgpu: andGap(
      typed('src/runtime/runtime.test.ts', 'read() copies level 0 of layer 0'),
      6,
      'the stencil-only aspect has no typed spelling; the runtime copies only the depth-only aspect of depth32float (src/rhi/webgpu.ts:323)',
      637,
    ),
    webgl2: andGap(
      typed('scripts/compile-gate.ts', 'read() copies level 0 of layer 0'),
      6,
      'the stencil-only aspect has no typed spelling; WebGL2 reads depth through a copy to r32float and refuses other depth formats (src/runtime/gl-draw.ts:253; src/rhi/webgl2.ts:714-716)',
      637,
    ),
  },
];
