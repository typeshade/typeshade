import { andGap, gap, na, raw, refused, type Row, typed } from '../model.js';

export const DEPTH_STENCIL_AND_BLENDING_ROWS: readonly Row[] = [
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Depth test: `depthFunc`, `depthMask`',
    covers: [
      'webgl:WebGLRenderingContextBase.depthFunc',
      'webgl:WebGLRenderingContextBase.depthMask',
    ],
    evidence: 'src/runtime/program.ts:278-284; src/rhi/webgl2.ts (depthFunc, depthMask)',
    note: 'RenderState.depth; the switch that turns the test on is in Capability switches',
    webgpu: typed('scripts/compile-gate.ts'),
    webgl2: typed('scripts/compile-gate.ts'),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: '`depthRange`',
    covers: ['webgl:WebGLRenderingContextBase.depthRange'],
    evidence: 'src/rhi/webgl2.ts:575-617 (setState sets no depth range)',
    note: "the runtime sets the depth range to 0 to 1 at each WebGL2 pass start and gives the host's back at its end; on WebGPU it is an argument of setViewport",
    webgpu: typed(
      'journeys/render-state',
      'RenderPass.setViewport sets the depth range; also src/runtime/runtime.test.ts',
    ),
    webgl2: andGap(
      typed(
        'journeys/render-state',
        'RenderPass.setViewport sets the depth range; also src/runtime/gl-draw.test.ts',
      ),
      14,
      'a depth range other than 0 to 1 is refused for a fragment that writes frag_depth (proposal 0064, O6)',
      644,
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: '`EXT_clip_control`',
    covers: ['webgl:EXT_clip_control'],
    evidence:
      "docs/use-typeshade-surface.md:7955-7956 (the WebGL2 tier keeps WebGPU's depth conventions)",
    note: "the runtime maps WebGPU's [0,1] clip depth itself",
    webgpu: na('no WebGPU form: the clip volume is fixed, with depth from 0 to 1'),
    webgl2: typed('scripts/compile-gate.ts', 'internal mapping'),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: '`EXT_depth_clamp`',
    covers: ['webgl:EXT_depth_clamp'],
    evidence: 'src/runtime/program.ts:268-326 (no unclipped depth field)',
    note: 'depth clamping is unclippedDepth on WebGPU; the runtime sets no depth clamp on either tier; no DEPTH_CLAMP use in src/runtime or src/core',
    webgpu: gap(1, 'unclippedDepth (depth clamp)', 632),
    webgl2: andGap(
      raw(
        'Runtime.device',
        'the host enables the clamp on rt.device; the runtime sets and resets none',
      ),
      1,
      'depth clamp has no typed form',
      632,
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Stencil: `stencilFunc`, `stencilFuncSeparate`, `stencilOp`, `stencilOpSeparate`, `stencilMask`, `stencilMaskSeparate`',
    covers: [
      'webgl:WebGLRenderingContextBase.stencilFunc',
      'webgl:WebGLRenderingContextBase.stencilFuncSeparate',
      'webgl:WebGLRenderingContextBase.stencilMask',
      'webgl:WebGLRenderingContextBase.stencilMaskSeparate',
      'webgl:WebGLRenderingContextBase.stencilOp',
      'webgl:WebGLRenderingContextBase.stencilOpSeparate',
    ],
    evidence:
      'src/runtime/program.ts#RenderState.depth (RenderState.depth.stencil); src/rhi/webgpu.ts#WebGpuEncoder.copyBufferToBuffer|depthStencilOf (depthStencilOf); src/rhi/webgl2.ts:575-617 (setState)',
    note: 'the stencil test, its functions, operations and masks are set by each draw of a pipeline with depth.stencil',
    webgpu: typed(
      'journeys/pipeline-state',
      'RenderState.depth.stencil: the compare and the masks; also src/runtime/render-state-parity.test.ts',
    ),
    webgl2: typed(
      'journeys/pipeline-state',
      'RenderState.depth.stencil on the WebGL2 tier; also src/runtime/gl-draw.test.ts',
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: '`WEBGL_stencil_texturing`',
    covers: ['webgl:WEBGL_stencil_texturing'],
    evidence:
      'src/rhi/webgl2.ts:923-1178 (a stencil attachment is cleared to 0 and never tested); src/runtime/resources.ts#Texture (a depth or stencil format other than depth32float rejects a read)',
    note: 'the stencil aspect of a depth-stencil texture as a sampled texture; the same capability as the stencil-only aspect of GPUTextureAspect in table A',
    webgpu: gap(
      6,
      'the stencil aspect of a depth-stencil texture has no typed spelling; the same capability as the stencil-only aspect of GPUTextureAspect (table A)',
      637,
    ),
    webgl2: gap(
      6,
      'the stencil aspect of a depth-stencil texture has no typed spelling; WebGL2 reads a depth texture through a copy to r32float and refuses other depth formats (src/runtime/gl-draw.ts:253; src/rhi/webgl2.ts:714-716)',
      637,
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Blending: `blendFunc`, `blendFuncSeparate`, `blendEquation`, `blendEquationSeparate`',
    covers: [
      'webgl:WebGLRenderingContextBase.blendEquation',
      'webgl:WebGLRenderingContextBase.blendEquationSeparate',
      'webgl:WebGLRenderingContextBase.blendFunc',
      'webgl:WebGLRenderingContextBase.blendFuncSeparate',
    ],
    evidence:
      'src/rhi/webgl2.ts:596-597 (blendFuncSeparate, blendEquationSeparate); src/runtime/program.ts#Bindings',
    note: 'TargetState.blend; min and max are core in WebGL2 (ES 3.00), the form EXT_blend_minmax adds in WebGL 1.0; the switch that turns blending on is in Capability switches',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets TargetState.blend (src/runtime/program.ts:77)',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets TargetState.blend on the WebGL2 tier (src/runtime/gl-draw.ts:972-973)',
      645,
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: '`blendColor`',
    covers: ['webgl:WebGLRenderingContextBase.blendColor'],
    evidence:
      'src/rhi/webgl2.ts:468 (the constant factor maps to CONSTANT_COLOR); src/rhi/webgl2.ts:575-617 (setState sets the functions, not the colour)',
    note: 'the constant blend factor is typed (TargetState.blend, src/runtime/program.ts:73-79); the constant colour is typed by RenderPass.setBlendConstant and RenderState.blendConstant',
    webgpu: typed(
      'journeys/render-state',
      'RenderPass.setBlendConstant; also src/runtime/runtime.test.ts',
    ),
    webgl2: typed(
      'journeys/render-state',
      'RenderPass.setBlendConstant; also src/runtime/gl-draw.test.ts',
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Per-target blend and mask: `OES_draw_buffers_indexed`',
    covers: [
      'webgl:OES_draw_buffers_indexed.blendEquationSeparateiOES',
      'webgl:OES_draw_buffers_indexed.blendEquationiOES',
      'webgl:OES_draw_buffers_indexed.blendFuncSeparateiOES',
      'webgl:OES_draw_buffers_indexed.blendFunciOES',
      'webgl:OES_draw_buffers_indexed.colorMaskiOES',
      'webgl:OES_draw_buffers_indexed.disableiOES',
      'webgl:OES_draw_buffers_indexed.enableiOES',
    ],
    evidence:
      'docs/use-typeshade-surface.md:7967 (targets that blend or mask apart are refused on WebGL2); src/runtime/gl-draw.ts:588-613 (the refusal, a TypeError)',
    note: 'the extension would lift the refusal',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets blend or writeMask on one colour target of a WebGPU pipeline',
      645,
    ),
    webgl2: refused(
      'Rule 11.11',
      'give every target the same blend and writeMask',
      "OES_draw_buffers_indexed would lower it (group 10); table A's GPUColorTargetState.blend row names the same capability; WebGL2 keeps one blend state and one mask (src/rhi/webgl2.ts:1486-1525)",
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Dual-source blending: `WEBGL_blend_func_extended`',
    covers: ['webgl:WEBGL_blend_func_extended'],
    evidence: 'docs/use-typeshade-surface.md:6293 (@blend_src has no GLSL form and fails closed)',
    note: 'the extension would lower @blend_src',
    webgpu: typed(
      'src/compiler/ts/entry-io-attributes.test.ts',
      '@blend_src, dual-source-blending',
    ),
    webgl2: gap(10, 'the extension would lower @blend_src', 641),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Colour mask: `colorMask`',
    covers: ['webgl:WebGLRenderingContextBase.colorMask'],
    evidence: 'src/rhi/webgl2.ts (colorMask)',
    note: 'TargetState.writeMask; one mask for every target on WebGL2',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets TargetState.writeMask (src/runtime/program.ts:78)',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets writeMask on the WebGL2 tier (src/runtime/gl-draw.ts:975)',
      645,
    ),
  },
];
