import { andGap, gap, planned, raw, type Row, typed } from '../model.js';

export const COMPUTE_PASS_AND_EXTERNAL_COPY_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUComputePassDescriptor.timestampWrites`',
    covers: ['GPUComputePassDescriptor.timestampWrites'],
    evidence: 'src/runtime/runtime.ts:195-224; src/runtime/program.ts#ComputePipeline',
    webgpu: andGap(
      raw(
        'ComputePipeline.dispatch(target, …)',
        'the host opens its own compute pass and dispatches a runtime program into it; a timestamp query set needs a device that has timestamp-query, passed with createRuntime({ device })',
      ),
      4,
      'Frame.dispatch opens the pass; timestampWrites has no typed spelling',
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
    name: '`GPUComputePassTimestampWrites.querySet`',
    covers: ['GPUComputePassTimestampWrites.querySet'],
    evidence: 'src/runtime/runtime.ts:195-224; src/runtime/program.ts#ComputePipeline',
    webgpu: andGap(
      raw(
        'ComputePipeline.dispatch(target, …)',
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
    name: '`GPUComputePassTimestampWrites.beginningOfPassWriteIndex`',
    covers: ['GPUComputePassTimestampWrites.beginningOfPassWriteIndex'],
    evidence: 'src/runtime/runtime.ts:195-224; src/runtime/program.ts#ComputePipeline',
    webgpu: andGap(
      raw(
        'ComputePipeline.dispatch(target, …)',
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
    name: '`GPUComputePassTimestampWrites.endOfPassWriteIndex`',
    covers: ['GPUComputePassTimestampWrites.endOfPassWriteIndex'],
    evidence: 'src/runtime/runtime.ts:195-224; src/runtime/program.ts#ComputePipeline',
    webgpu: andGap(
      raw(
        'ComputePipeline.dispatch(target, …)',
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
    name: '`GPUComputePipelineDescriptor.compute`',
    covers: ['GPUComputePipelineDescriptor.compute'],
    evidence:
      'src/runtime/program.ts:395-417, 1571-1578; src/rhi/webgpu.ts:385-396; src/runtime/gl.ts:148-179',
    webgpu: typed('src/runtime/runtime.test.ts', 'program.compute(entry, { constants })'),
    webgl2: typed('src/runtime/runtime.test.ts', 'program.compute(entry, { constants })'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUCopyExternalImageDestInfo.colorSpace`',
    covers: ['GPUCopyExternalImageDestInfo.colorSpace'],
    evidence: 'changes/0050-texture-write.md:148-150',
    webgpu: planned(
      '0050',
      'Texture.write() is drafted; the call layer uploads an image at a call (Rule 8.21)',
    ),
    webgl2: gap(6, '0050 names the WebGPU target only (changes/0050-texture-write.md:331)', 637),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUCopyExternalImageDestInfo.premultipliedAlpha`',
    covers: ['GPUCopyExternalImageDestInfo.premultipliedAlpha'],
    evidence: 'changes/0050-texture-write.md:148-150',
    webgpu: planned(
      '0050',
      'Texture.write() is drafted; the call layer uploads an image at a call (Rule 8.21)',
    ),
    webgl2: gap(6, '0050 names the WebGPU target only (changes/0050-texture-write.md:331)', 637),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUCopyExternalImageSourceInfo.source`',
    covers: ['GPUCopyExternalImageSourceInfo.source'],
    evidence: 'changes/0050-texture-write.md:130-168',
    webgpu: planned('0050', 'flipY and origin are 0050 decisions'),
    webgl2: gap(6, '0050 names the WebGPU target only (changes/0050-texture-write.md:331)', 637),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUCopyExternalImageSourceInfo.origin`',
    covers: ['GPUCopyExternalImageSourceInfo.origin'],
    evidence: 'changes/0050-texture-write.md:130-168',
    webgpu: planned('0050', 'flipY and origin are 0050 decisions'),
    webgl2: gap(6, '0050 names the WebGPU target only (changes/0050-texture-write.md:331)', 637),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUCopyExternalImageSourceInfo.flipY`',
    covers: ['GPUCopyExternalImageSourceInfo.flipY'],
    evidence: 'changes/0050-texture-write.md:130-168',
    webgpu: planned('0050', 'flipY and origin are 0050 decisions'),
    webgl2: gap(6, '0050 names the WebGPU target only (changes/0050-texture-write.md:331)', 637),
  },
];
