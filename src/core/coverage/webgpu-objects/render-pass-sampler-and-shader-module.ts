import { andGap, gap, na, raw, type Row, typed } from '../model.js';

export const RENDER_PASS_SAMPLER_AND_SHADER_MODULE_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPURenderPassEncoder.setViewport()`',
    covers: ['GPURenderPassEncoder.setViewport'],
    evidence:
      'src/runtime/runtime.ts:172-191; src/runtime/gl-draw.ts:1062-1079 (GlPass.setViewport)',
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
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPURenderPassEncoder.setScissorRect()`',
    covers: ['GPURenderPassEncoder.setScissorRect'],
    evidence:
      'src/runtime/runtime.ts:172-191; src/runtime/gl-draw.ts:1070-1073 (GlPass.setScissorRect)',
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
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPURenderPassEncoder.setBlendConstant()`',
    covers: ['GPURenderPassEncoder.setBlendConstant'],
    evidence:
      'src/runtime/runtime.ts:172-191; src/runtime/gl-draw.ts:1058-1062 (GlPass.setBlendConstant, the blendColor call)',
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
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPURenderPassEncoder.setStencilReference()`',
    covers: ['GPURenderPassEncoder.setStencilReference'],
    evidence:
      'src/runtime/runtime.ts:581-585 (FramePass.setStencilReference); src/runtime/gl-draw.ts:1012-1014 (GlPass.setStencilReference)',
    webgpu: typed(
      'journeys/pipeline-state',
      'RenderPass.setStencilReference; also src/runtime/runtime.test.ts',
    ),
    webgl2: typed(
      'journeys/pipeline-state',
      'RenderPass.setStencilReference; also src/runtime/gl-draw.test.ts',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPURenderPassEncoder.beginOcclusionQuery()`',
    covers: ['GPURenderPassEncoder.beginOcclusionQuery'],
    evidence:
      'src/runtime/runtime.ts#StencilAspect|RenderPass; src/runtime/program.ts#RenderPipeline.vertex|RenderPipeline.fragment; src/runtime/gl.ts:469-472',
    webgpu: andGap(
      raw(
        'RenderPipeline.draw(pass, …)',
        'the host begins the query on its own pass, and RenderPipeline.draw(pass, …) records the draws into it',
      ),
      4,
      'no typed spelling begins an occlusion query',
      635,
    ),
    webgl2: gap(
      4,
      'a typed query is not supported yet on the WebGL2 tier (Rule 11.11); the frame runs its draws after submit() returns (src/runtime/gl.ts:469-472), so a query the host begins earlier wraps none',
      635,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPURenderPassEncoder.endOcclusionQuery()`',
    covers: ['GPURenderPassEncoder.endOcclusionQuery'],
    evidence:
      'src/runtime/runtime.ts#StencilAspect|RenderPass; src/runtime/program.ts#RenderPipeline.vertex|RenderPipeline.fragment; src/runtime/gl.ts:469-472',
    webgpu: andGap(
      raw(
        'RenderPipeline.draw(pass, …)',
        'the host ends the query on its own pass, and RenderPipeline.draw(pass, …) records the draws into it',
      ),
      4,
      'no typed spelling ends an occlusion query',
      635,
    ),
    webgl2: gap(
      4,
      'a typed query is not supported yet on the WebGL2 tier (Rule 11.11); the frame runs its draws after submit() returns (src/runtime/gl.ts:469-472), so a query the host begins earlier wraps none',
      635,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPURenderPassEncoder.executeBundles()`',
    covers: ['GPURenderPassEncoder.executeBundles'],
    evidence: 'src/runtime/runtime.ts#StencilAspect|RenderPass',
    webgpu: raw('RenderPass.raw'),
    webgl2: na('WebGPU render bundles; WebGL2 has no bundle object'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPURenderPassEncoder.end()`',
    covers: ['GPURenderPassEncoder.end'],
    evidence: 'src/runtime/runtime.ts:195-224; src/runtime/gl.ts:455-457',
    webgpu: typed('src/runtime/runtime.test.ts', 'Frame.pass()'),
    webgl2: typed('scripts/compile-gate.ts', 'Frame.pass()'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface',
    name: '`GPURenderPipeline`',
    covers: ['GPURenderPipeline'],
    evidence:
      'src/runtime/program.ts#ComputePipeline|RenderPipeline.vertex|RenderPipeline.fragment; src/rhi/webgl2.ts:571',
    webgpu: typed('src/runtime/runtime.test.ts', 'RenderPipeline'),
    webgl2: typed('scripts/compile-gate.ts', 'RenderPipeline'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface',
    name: '`GPUSampler`',
    covers: ['GPUSampler'],
    evidence: 'src/runtime/resources.ts#Sampler; src/runtime/gl-draw.ts:284',
    webgpu: typed(
      'journeys/engine/engine.mjs',
      'Sampler, made by rt.sampler(); also: Sampler.sampler is the GPUSampler (raw)',
    ),
    webgl2: typed('scripts/compile-gate.ts', 'Sampler, made by rt.sampler()'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUShaderModule.getCompilationInfo()`',
    covers: ['GPUShaderModule.getCompilationInfo'],
    evidence: 'docs/language-design.md:1391-1395; src/core/gl-compute.ts:131',
    webgpu: na('Rule 12.6: the front end diagnoses at the source'),
    webgl2: na(
      'WebGL2 has no shader module object; a program reads its compile status with getShaderParameter and getShaderInfoLog',
    ),
  },
];
