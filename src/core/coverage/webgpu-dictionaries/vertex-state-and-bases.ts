import { andGap, gap, na, raw, type Row, typed } from '../model.js';

export const VERTEX_STATE_AND_BASES_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUUncapturedErrorEventInit.error`',
    covers: ['GPUUncapturedErrorEventInit.error'],
    evidence: 'src/runtime/runtime.ts:230-238',
    webgpu: andGap(
      raw('Runtime.device', 'the host listens for the event on rt.device'),
      8,
      'no typed uncaptured-error event',
      639,
    ),
    webgl2: na('WebGL2 has no uncaptured-error event'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUVertexAttribute.format`',
    covers: ['GPUVertexAttribute.format'],
    evidence: 'src/core/vertex-layout.ts:23-88; src/rhi/webgl2.ts#GlRenderPass~"a.format.split"',
    webgpu: andGap(
      typed(
        'src/compiler/ts/vertex-layout.test.ts',
        'from @location inputs, tightly packed (Rule 6.8)',
      ),
      2,
      '8/16-bit, normalized, float16 and packed formats have no typed spelling (src/core/vertex-layout.ts:72-80)',
      633,
    ),
    webgl2: andGap(
      typed('scripts/compile-gate.ts', 'from @location inputs, tightly packed (Rule 6.8)'),
      2,
      '8/16-bit, normalized, float16 and packed formats have no typed spelling (src/core/vertex-layout.ts:72-80)',
      633,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUVertexAttribute.offset`',
    covers: ['GPUVertexAttribute.offset'],
    evidence:
      'src/core/vertex-layout.ts:23-80; src/rhi/webgl2.ts#GlRenderPass~"vertexAttribPointer"',
    webgpu: typed(
      'src/compiler/ts/vertex-layout.test.ts',
      'from @location inputs, tightly packed (Rule 6.8)',
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): the WebGL2 mesh draws at offset 0 only (scripts/render-case.ts:58-60); from @location inputs, tightly packed (Rule 6.8)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUVertexAttribute.shaderLocation`',
    covers: ['GPUVertexAttribute.shaderLocation'],
    evidence:
      'src/core/vertex-layout.ts:23-80; src/rhi/webgl2.ts#GlRenderPass~"vertexAttribPointer"',
    webgpu: typed(
      'src/compiler/ts/vertex-layout.test.ts',
      'from @location inputs, tightly packed (Rule 6.8)',
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): the only WebGL2 attribute drawn is at location 0 (scripts/render-case.ts:59); from @location inputs, tightly packed (Rule 6.8)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUVertexBufferLayout.arrayStride`',
    covers: ['GPUVertexBufferLayout.arrayStride'],
    evidence:
      'src/core/vertex-layout.ts:23-80; src/rhi/webgl2.ts#GlRenderPass~"vertexAttribPointer"',
    webgpu: typed('src/compiler/ts/vertex-layout.test.ts', 'one buffer, stepMode vertex'),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): the only WebGL2 vertex buffer is one tightly packed vec3 (scripts/render-case.ts:58-60); one buffer, stepMode vertex',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUVertexBufferLayout.stepMode`',
    covers: ['GPUVertexBufferLayout.stepMode'],
    evidence: 'src/core/vertex-layout.ts:23-80',
    webgpu: gap(2, 'vertex only; per-instance attributes read instance_index instead', 633),
    webgl2: gap(2, 'vertex only; per-instance attributes read instance_index instead', 633),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUVertexBufferLayout.attributes`',
    covers: ['GPUVertexBufferLayout.attributes'],
    evidence: 'src/core/vertex-layout.ts:23-80; src/rhi/webgl2.ts#GlRenderPass~"layout.attributes"',
    webgpu: typed('src/compiler/ts/vertex-layout.test.ts', 'one buffer, stepMode vertex'),
    webgl2: typed('scripts/compile-gate.ts', 'one buffer, stepMode vertex'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUVertexState.buffers`',
    covers: ['GPUVertexState.buffers'],
    evidence: 'src/core/vertex-layout.ts:23-80',
    webgpu: andGap(
      typed('scripts/compile-gate.ts', 'one buffer, stepMode vertex'),
      2,
      'several vertex buffers have no spelling',
      633,
    ),
    webgl2: andGap(
      typed('scripts/compile-gate.ts', 'one buffer, stepMode vertex'),
      2,
      'several vertex buffers have no spelling',
      633,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUObjectBase.label`',
    covers: ['GPUObjectBase.label'],
    evidence: 'node_modules/@webgpu/types/dist/index.d.ts:1995',
    webgpu: na('a debugging label the runtime does not set'),
    webgl2: na('a debugging label the runtime does not set'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUPipelineBase.getBindGroupLayout()`',
    covers: ['GPUPipelineBase.getBindGroupLayout'],
    evidence: 'src/runtime/program.ts:425-446, 1550',
    webgpu: gap(
      7,
      'no typed or raw surface returns a pipeline layout; the layouts come from the manifest (src/runtime/program.ts:1550); host-placed groups have no spelling; roadmap B3 names the layout of automatic state binding (docs/roadmap.md:257)',
      638,
    ),
    webgl2: na('WebGL2 has no bind group layout; its bindings are set by name'),
  },
];
