import { andGap, gap, na, type Row, typed } from '../model.js';

export const RASTERIZER_STATE_ROWS: readonly Row[] = [
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Culling and winding: `cullFace`, `frontFace`',
    covers: [
      'webgl:WebGLRenderingContextBase.cullFace',
      'webgl:WebGLRenderingContextBase.frontFace',
    ],
    evidence: 'src/rhi/webgl2.ts (cullFace, frontFace)',
    note: 'RenderState.primitive; the switch that turns culling on is in Capability switches',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test reads primitive.cullMode or frontFace from a descriptor',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets cullMode or frontFace on the WebGL2 tier (`setState` of `src/rhi/webgl2.ts`)',
      645,
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: '`WEBGL_provoking_vertex`',
    covers: ['webgl:WEBGL_provoking_vertex'],
    evidence:
      'src/core/passes/varying-interpolate.ts:138-153 (flat defaults to `first`); src/rhi/webgl2.ts (firstVertexLast, provokingVertexWEBGL)',
    note: "measured: ES 3.00 takes the last vertex for a flat varying and WGSL's @interpolate(flat, first) the first; the WebGL2 backend takes the first with the extension, and without it draws each triangle with its first vertex last and refuses a line that carries a flat value",
    webgpu: typed('src/compiler/ts/entry-io-attributes.test.ts', "first is WGSL's default"),
    webgl2: typed(
      'src/rhi/webgl2.test.ts',
      'both ways, with the extension and without it; the pixels in the compile gate (src/rhi/rhi-conformance.ts, the three flat cases), on a context without the extension',
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Scissor: `scissor` (`enable(SCISSOR_TEST)` is in Capability switches)',
    covers: ['webgl:WebGLRenderingContextBase.scissor'],
    evidence:
      'src/runtime/gl-draw.ts#GlPass.setScissorRect; src/rhi/webgl2.ts#GlRenderPass.constructor~"SCISSOR_TEST"|GlRenderPass.setScissorRect|GlRenderPass.end~"SCISSOR_TEST" (SCISSOR_TEST is disabled before a pass draws, and at its end)',
    note: 'RenderPass.setScissorRect sets the scissor rectangle; the runtime disables the scissor test at each pass start and end',
    webgpu: typed(
      'journeys/render-state',
      'RenderPass.setScissorRect; also src/runtime/runtime.test.ts',
    ),
    webgl2: typed(
      'journeys/render-state',
      'RenderPass.setScissorRect; also src/runtime/gl-draw.test.ts',
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Viewport: `viewport`',
    covers: ['webgl:WebGLRenderingContextBase.viewport'],
    evidence:
      'src/rhi/webgl2.ts#GlRenderPass.constructor~"gl.viewport"|GlRenderPass.setViewport (the whole target at each pass start); src/runtime/gl-draw.ts#GlPass.setViewport',
    note: 'RenderPass.setViewport sets a sub-viewport; the runtime sets the whole target at each WebGL2 pass start',
    webgpu: typed(
      'journeys/render-state',
      'RenderPass.setViewport; also src/runtime/runtime.test.ts',
    ),
    webgl2: andGap(
      typed('journeys/render-state', 'RenderPass.setViewport; also src/runtime/gl-draw.test.ts'),
      14,
      'a depth range other than 0 to 1 is refused for a fragment that writes frag_depth (proposal 0064, O6)',
      644,
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Polygon offset: `polygonOffset`, `EXT_polygon_offset_clamp`',
    covers: ['webgl:EXT_polygon_offset_clamp', 'webgl:WebGLRenderingContextBase.polygonOffset'],
    evidence:
      'src/runtime/program.ts#RenderState.depth (RenderState.depth.bias); src/rhi/webgpu.ts#WebGpuEncoder.copyBufferToBuffer|depthStencilOf (depthStencilOf); src/runtime/gl-draw.ts#refuseBias|BIASED_FORMATS (refuseBias); src/rhi/webgl2.ts#setState~"polygonOffsetClampEXT" (setState, the polygon offset)',
    note: 'depthBias is pipeline state; each draw sets the polygon offset from its pipeline',
    webgpu: typed(
      'journeys/pipeline-state',
      'RenderState.depth.bias: the constant and the slope; also src/runtime/runtime.test.ts',
    ),
    webgl2: andGap(
      typed(
        'journeys/pipeline-state',
        'polygonOffset for the constant and the slope, on depth24plus, depth32float and depth24plus-stencil8 (A1); also src/runtime/gl-draw.test.ts',
      ),
      1,
      'a non-zero clamp is refused on a context without EXT_polygon_offset_clamp, and the context names it (A1, O4)',
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Sample coverage: `sampleCoverage`',
    covers: ['webgl:WebGLRenderingContextBase.sampleCoverage'],
    evidence: 'src/runtime/program.ts:308-310',
    note: 'alphaToCoverage and the sample mask have no typed form',
    webgpu: gap(1, 'alphaToCoverageEnabled and the sample mask', 632),
    webgl2: gap(
      1,
      'a multisampled target is not supported yet on the WebGL2 tier (Rule 11.11), so a sample coverage value has no effect; no typed form',
      632,
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: '`OES_sample_variables`',
    covers: ['webgl:OES_sample_variables'],
    evidence:
      'src/compiler/ts/builtin-check.ts:333-334 (sample_index and sample_mask: fragment inputs, table B); src/core/backends/glsl.ts:513-518 (BUILTIN_IN: no sample_index or sample_mask)',
    note: 'the extension would lower sample_index and sample_mask',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test compiles or emits @builtin("sample_index") or @builtin("sample_mask"); the typed spelling is the WGSL built-in values sample_index and sample_mask (table B)',
      645,
    ),
    webgl2: gap(10, 'would lower sample_index and sample_mask', 641),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Capability switches: `enable`, `disable`, `isEnabled`, `hint` (`enable(DITHER)`, `enable(RASTERIZER_DISCARD)`, and the switch of each state above)',
    covers: [
      'webgl:WebGLRenderingContextBase.disable',
      'webgl:WebGLRenderingContextBase.enable',
      'webgl:WebGLRenderingContextBase.hint',
      'webgl:WebGLRenderingContextBase.isEnabled',
    ],
    evidence: 'src/rhi/webgl2.ts#setState~"gl.disable" (the switch of each state)',
    note: 'a switch is a mechanism: each state it switches has its own row; dither has no portable meaning; rasterizer discard serves transform feedback; no use of DITHER or hint in src/runtime/',
    webgpu: na('WebGPU has no capability switch: each state is a descriptor field'),
    webgl2: na(
      'an implementation mechanism: each state it switches has its own row; dither has no portable meaning',
    ),
  },
];
