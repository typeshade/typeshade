import { andGap, gap, type Row, typed } from '../model.js';

export const DEPTH_STENCIL_STATE_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUDepthStencilState.format`',
    covers: ['GPUDepthStencilState.format'],
    evidence: 'src/runtime/program.ts:268-327, 1217; src/rhi/webgl2.ts#drawStateOf~"ds.write"',
    webgpu: andGap(
      typed('scripts/compile-gate.ts', 'RenderState.depth: format, compare, write'),
      6,
      'stencil8, depth24plus-stencil8 and depth32float-stencil8 have no stencil state; depth16unorm is a depth attachment that read() and readFloats() cannot copy (src/runtime/resources.ts:153-155); BC, ETC2, EAC and ASTC (52 names) have no upload path, and 0050 covers no compressed blocks (changes/0050-texture-write.md:387)',
      637,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): the WebGL2 depth state reads no format (src/runtime/gl-draw.ts:598-604); RenderState.depth: format, compare, write; stencil8, depth24plus-stencil8 and depth32float-stencil8 have no stencil state, and texture() refuses stencil8 (src/runtime/gl-draw.ts:172); depth16unorm cannot be copied by read() (src/runtime/resources.ts:153-155); BC, ETC2, EAC and ASTC (52 names) have no upload path (changes/0050-texture-write.md:387); r16, rg16 and rgba16 in unorm and snorm (6 names) and rgb9e5ufloat are refused by texture() (src/runtime/gl-draw.ts:172) and are not measured; roadmap row 13b names the tier-1 formats (docs/roadmap.md:228), and the surface text lists the 16-bit snorm names among them (docs/use-typeshade-surface.md:5377-5381)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUDepthStencilState.depthWriteEnabled`',
    covers: ['GPUDepthStencilState.depthWriteEnabled'],
    evidence: 'src/runtime/program.ts:268-327, 1217; src/rhi/webgl2.ts#setState~"depthMask"',
    webgpu: typed('scripts/compile-gate.ts', 'RenderState.depth: format, compare, write'),
    webgl2: typed('scripts/compile-gate.ts', 'RenderState.depth: format, compare, write'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUDepthStencilState.depthCompare`',
    covers: ['GPUDepthStencilState.depthCompare'],
    evidence: 'src/runtime/program.ts:268-327, 1217; src/rhi/webgl2.ts#setState~"depthFunc"',
    webgpu: typed('scripts/compile-gate.ts', 'RenderState.depth: format, compare, write'),
    webgl2: typed('scripts/compile-gate.ts', 'RenderState.depth: format, compare, write'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUDepthStencilState.stencilFront`',
    covers: ['GPUDepthStencilState.stencilFront'],
    evidence:
      'src/runtime/program.ts#RenderState.depth (RenderState.depth.stencil); src/runtime/program.ts#depthStencilAttachmentOf (depthStencilOf); src/rhi/webgl2.ts#drawStateOf~"stencil.front"|setState~"stencilOpSeparate" (setState)',
    webgpu: typed(
      'journeys/pipeline-state',
      'RenderState.depth.stencil.front; also src/runtime/runtime.test.ts',
    ),
    webgl2: typed(
      'journeys/pipeline-state',
      'RenderState.depth.stencil.front; also src/runtime/gl-draw.test.ts',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUDepthStencilState.stencilBack`',
    covers: ['GPUDepthStencilState.stencilBack'],
    evidence:
      'src/runtime/program.ts#RenderState.depth (RenderState.depth.stencil); src/runtime/program.ts#depthStencilAttachmentOf (depthStencilOf); src/rhi/webgl2.ts#drawStateOf~"stencil.back"|setState~"stencilOpSeparate" (setState)',
    webgpu: typed(
      'journeys/pipeline-state',
      'RenderState.depth.stencil.back; also src/runtime/runtime.test.ts',
    ),
    webgl2: typed(
      'journeys/pipeline-state',
      'RenderState.depth.stencil.back; also src/runtime/gl-draw.test.ts',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUDepthStencilState.stencilReadMask`',
    covers: ['GPUDepthStencilState.stencilReadMask'],
    evidence:
      'src/runtime/program.ts#RenderState.depth (RenderState.depth.stencil); src/runtime/program.ts#depthStencilAttachmentOf (depthStencilOf); src/rhi/webgl2.ts#setState~"t.readMask" (setState)',
    webgpu: typed(
      'journeys/pipeline-state',
      'RenderState.depth.stencil.readMask; also src/runtime/runtime.test.ts',
    ),
    webgl2: typed(
      'journeys/pipeline-state',
      'RenderState.depth.stencil.readMask; also src/runtime/gl-draw.test.ts',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUDepthStencilState.stencilWriteMask`',
    covers: ['GPUDepthStencilState.stencilWriteMask'],
    evidence:
      'src/runtime/program.ts#RenderState.depth (RenderState.depth.stencil); src/runtime/program.ts#depthStencilAttachmentOf (depthStencilOf); src/rhi/webgl2.ts#setState~"stencilMaskSeparate" (setState)',
    webgpu: typed(
      'journeys/pipeline-state',
      'RenderState.depth.stencil.writeMask; also src/runtime/runtime.test.ts',
    ),
    webgl2: typed(
      'journeys/pipeline-state',
      'RenderState.depth.stencil.writeMask; also src/runtime/gl-draw.test.ts',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUDepthStencilState.depthBias`',
    covers: ['GPUDepthStencilState.depthBias'],
    evidence:
      'src/runtime/program.ts#RenderState.depth (RenderState.depth.bias); src/runtime/program.ts#depthStencilAttachmentOf (depthStencilOf); src/runtime/gl-draw.ts#GlSamplerImpl.sampler|BIASED_FORMATS|refuseBias (refuseBias); src/rhi/webgl2.ts#setState~"polygonOffset" (setState, the polygon offset)',
    webgpu: typed(
      'journeys/pipeline-state',
      'RenderState.depth.bias.constant; also src/runtime/runtime.test.ts',
    ),
    webgl2: andGap(
      typed(
        'journeys/pipeline-state',
        'RenderState.depth.bias.constant on depth24plus, depth32float and depth24plus-stencil8, within the bound of A1; also src/runtime/gl-draw.test.ts',
      ),
      1,
      'a constant on depth16unorm and depth32float-stencil8 is refused, because neither format is measured (A1)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUDepthStencilState.depthBiasSlopeScale`',
    covers: ['GPUDepthStencilState.depthBiasSlopeScale'],
    evidence:
      'src/runtime/program.ts#RenderState.depth (RenderState.depth.bias); src/runtime/program.ts#depthStencilAttachmentOf (depthStencilOf); src/runtime/gl-draw.ts#GlSamplerImpl.sampler|BIASED_FORMATS|refuseBias (refuseBias); src/rhi/webgl2.ts#setState~"polygonOffset" (setState, the polygon offset)',
    webgpu: typed(
      'journeys/pipeline-state',
      'RenderState.depth.bias.slopeScale; also src/runtime/runtime.test.ts',
    ),
    webgl2: andGap(
      typed(
        'journeys/pipeline-state',
        'RenderState.depth.bias.slopeScale on depth24plus, depth32float and depth24plus-stencil8; also src/runtime/gl-draw.test.ts',
      ),
      1,
      'a slopeScale on depth16unorm and depth32float-stencil8 is refused, because neither format is measured (A1)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUDepthStencilState.depthBiasClamp`',
    covers: ['GPUDepthStencilState.depthBiasClamp'],
    evidence:
      'src/runtime/program.ts#RenderState.depth (RenderState.depth.bias); src/runtime/program.ts#depthStencilAttachmentOf (depthStencilOf); src/runtime/gl-draw.ts#GlSamplerImpl.sampler|BIASED_FORMATS|refuseBias (refuseBias); src/rhi/webgl2.ts#setState~"polygonOffsetClampEXT" (setState, the polygon offset)',
    webgpu: typed(
      'src/runtime/render-state-parity.test.ts',
      'depth.bias.clamp reaches depthBiasClamp',
    ),
    webgl2: andGap(
      typed(
        'src/runtime/gl-draw.test.ts',
        'RenderState.depth.bias.clamp as polygonOffsetClampEXT, when the context exposes EXT_polygon_offset_clamp (A1)',
      ),
      1,
      'a non-zero clamp is refused on a context without EXT_polygon_offset_clamp, and the context names it (A1, O4)',
    ),
  },
];
