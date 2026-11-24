import { andGap, gap, na, raw, type Row, typed } from '../model.js';

export const RENDER_PASS_DESCRIPTOR_AND_LAYOUT_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassDescriptor.colorAttachments`',
    covers: ['GPURenderPassDescriptor.colorAttachments'],
    evidence:
      'src/runtime/runtime.ts:195-224; src/rhi/webgl2.ts#GlRenderPass.constructor~"desc.colorAttachments"',
    webgpu: typed('scripts/compile-gate.ts', 'Frame.pass(targets, record)'),
    webgl2: typed('scripts/compile-gate.ts', 'Frame.pass(targets, record)'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassDescriptor.depthStencilAttachment`',
    covers: ['GPURenderPassDescriptor.depthStencilAttachment'],
    evidence:
      'src/runtime/runtime.ts#PassTargets; src/runtime/program.ts#depthStencilAttachmentOf; src/rhi/webgl2.ts#GlRenderPass.constructor~"desc.depthStencilAttachment"',
    webgpu: typed('scripts/compile-gate.ts', 'Frame.pass(targets, record)'),
    webgl2: typed('scripts/compile-gate.ts', 'Frame.pass(targets, record)'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassDescriptor.occlusionQuerySet`',
    covers: ['GPURenderPassDescriptor.occlusionQuerySet'],
    evidence:
      'src/runtime/runtime.ts:195-224; src/runtime/program.ts#ComputePipeline.dispatch|RenderPipeline.vertex|RenderPipeline.fragment',
    webgpu: andGap(
      raw(
        'RenderPipeline.draw(pass, …)',
        'the host records its own pass with an occlusion query set',
      ),
      4,
      'no occlusion query',
      635,
    ),
    webgl2: gap(4, 'no occlusion query; the runtime spells no query on WebGL2', 635),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassDescriptor.timestampWrites`',
    covers: ['GPURenderPassDescriptor.timestampWrites'],
    evidence:
      'src/runtime/runtime.ts:195-224; src/runtime/program.ts#ComputePipeline.dispatch|RenderPipeline.vertex|RenderPipeline.fragment',
    webgpu: andGap(
      raw(
        'RenderPipeline.draw(pass, …)',
        'the host records its own pass with timestamp writes; a timestamp query set needs a device that has timestamp-query, passed with createRuntime({ device })',
      ),
      4,
      'no timestamp writes; GPU time has no typed spelling',
      542,
    ),
    webgl2: gap(
      4,
      'GPU time of a pass: WebGL2 has timer queries (EXT_disjoint_timer_query_webgl2), not timestamp writes',
      542,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassDescriptor.maxDrawCount`',
    covers: ['GPURenderPassDescriptor.maxDrawCount'],
    evidence: 'node_modules/@webgpu/types/dist/index.d.ts:1393',
    webgpu: na('an implementation hint'),
    webgl2: na('an implementation hint'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassLayout.colorFormats`',
    covers: ['GPURenderPassLayout.colorFormats'],
    evidence: 'src/runtime/runtime.ts#SubmitResult|Runtime.info',
    webgpu: raw('Runtime.device', 'render bundles only'),
    webgl2: na('a render bundle has no WebGL2 form'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassLayout.depthStencilFormat`',
    covers: ['GPURenderPassLayout.depthStencilFormat'],
    evidence: 'src/runtime/runtime.ts#SubmitResult|Runtime.info',
    webgpu: raw('Runtime.device', 'render bundles only'),
    webgl2: na('a render bundle has no WebGL2 form'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassLayout.sampleCount`',
    covers: ['GPURenderPassLayout.sampleCount'],
    evidence: 'src/runtime/runtime.ts#SubmitResult|Runtime.info',
    webgpu: raw('Runtime.device', 'render bundles only'),
    webgl2: na('a render bundle has no WebGL2 form'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassTimestampWrites.querySet`',
    covers: ['GPURenderPassTimestampWrites.querySet'],
    evidence:
      'src/runtime/runtime.ts:195-224; src/runtime/program.ts#ComputePipeline.dispatch|RenderPipeline.vertex|RenderPipeline.fragment',
    webgpu: andGap(
      raw(
        'RenderPipeline.draw(pass, …)',
        'the host records the pass with its own query set; a timestamp query set needs a device that has timestamp-query, passed with createRuntime({ device })',
      ),
      4,
      'timestamp writes have no typed spelling',
      542,
    ),
    webgl2: gap(
      4,
      'GPU time: WebGL2 has timer queries (EXT_disjoint_timer_query_webgl2), not timestamp writes',
      542,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassTimestampWrites.beginningOfPassWriteIndex`',
    covers: ['GPURenderPassTimestampWrites.beginningOfPassWriteIndex'],
    evidence:
      'src/runtime/runtime.ts:195-224; src/runtime/program.ts#ComputePipeline.dispatch|RenderPipeline.vertex|RenderPipeline.fragment',
    webgpu: andGap(
      raw(
        'RenderPipeline.draw(pass, …)',
        'the host records the pass with its own query set; a timestamp query set needs a device that has timestamp-query, passed with createRuntime({ device })',
      ),
      4,
      'timestamp writes have no typed spelling',
      542,
    ),
    webgl2: gap(
      4,
      'GPU time: WebGL2 has timer queries (EXT_disjoint_timer_query_webgl2), not timestamp writes',
      542,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPassTimestampWrites.endOfPassWriteIndex`',
    covers: ['GPURenderPassTimestampWrites.endOfPassWriteIndex'],
    evidence:
      'src/runtime/runtime.ts:195-224; src/runtime/program.ts#ComputePipeline.dispatch|RenderPipeline.vertex|RenderPipeline.fragment',
    webgpu: andGap(
      raw(
        'RenderPipeline.draw(pass, …)',
        'the host records the pass with its own query set; a timestamp query set needs a device that has timestamp-query, passed with createRuntime({ device })',
      ),
      4,
      'timestamp writes have no typed spelling',
      542,
    ),
    webgl2: gap(
      4,
      'GPU time: WebGL2 has timer queries (EXT_disjoint_timer_query_webgl2), not timestamp writes',
      542,
    ),
  },
];
