import { andGap, gap, na, planned, type Row, typed } from '../model.js';

export const ORIGIN_AND_PIPELINE_BASES_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUObjectDescriptorBase.label`',
    covers: ['GPUObjectDescriptorBase.label'],
    evidence: 'node_modules/@webgpu/types/dist/index.d.ts:1062',
    webgpu: na('label: a debugging aid the runtime does not set'),
    webgl2: na('label: a debugging aid the runtime does not set'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUOrigin2DDict.x`',
    covers: ['GPUOrigin2DDict.x'],
    evidence: 'changes/0050-texture-write.md:132, 149, 383',
    webgpu: gap(
      6,
      'a copy at an x or y origin has no spelling: 0050 fixes the origin to [0, 0, layer] and excludes a write of part of a level (changes/0050-texture-write.md:132, 149, 383)',
      637,
    ),
    webgl2: gap(6, '0050 names the WebGPU target only (changes/0050-texture-write.md:331)', 637),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUOrigin2DDict.y`',
    covers: ['GPUOrigin2DDict.y'],
    evidence: 'changes/0050-texture-write.md:132, 149, 383',
    webgpu: gap(
      6,
      'a copy at an x or y origin has no spelling: 0050 fixes the origin to [0, 0, layer] and excludes a write of part of a level (changes/0050-texture-write.md:132, 149, 383)',
      637,
    ),
    webgl2: gap(6, '0050 names the WebGPU target only (changes/0050-texture-write.md:331)', 637),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUOrigin3DDict.x`',
    covers: ['GPUOrigin3DDict.x'],
    evidence: 'changes/0050-texture-write.md:132, 149, 383',
    webgpu: gap(
      6,
      'a copy at an x or y origin has no spelling: 0050 fixes the origin to [0, 0, layer] and excludes a write of part of a level (changes/0050-texture-write.md:132, 149, 383)',
      637,
    ),
    webgl2: gap(6, '0050 names the WebGPU target only (changes/0050-texture-write.md:331)', 637),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUOrigin3DDict.y`',
    covers: ['GPUOrigin3DDict.y'],
    evidence: 'changes/0050-texture-write.md:132, 149, 383',
    webgpu: gap(
      6,
      'a copy at an x or y origin has no spelling: 0050 fixes the origin to [0, 0, layer] and excludes a write of part of a level (changes/0050-texture-write.md:132, 149, 383)',
      637,
    ),
    webgl2: gap(6, '0050 names the WebGPU target only (changes/0050-texture-write.md:331)', 637),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUOrigin3DDict.z`',
    covers: ['GPUOrigin3DDict.z'],
    evidence: 'changes/0050-texture-write.md:132, 149',
    webgpu: planned('0050', 'copy origin'),
    webgl2: gap(6, '0050 names the WebGPU target only (changes/0050-texture-write.md:331)', 637),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUPipelineDescriptorBase.layout`',
    covers: ['GPUPipelineDescriptorBase.layout'],
    evidence:
      'src/runtime/program.ts:1549, 1572, 1647; src/rhi/webgpu.ts#WebGpuDevice.createBindGroup',
    webgpu: typed('scripts/compile-gate.ts', 'explicit layout from the manifest'),
    webgl2: na('WebGL2 has no pipeline layout; its bindings are set by name'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUPipelineErrorInit.reason`',
    covers: ['GPUPipelineErrorInit.reason'],
    evidence:
      'node_modules/@webgpu/types/dist/index.d.ts:1090; src/runtime/program.ts:1571, 1579-1586, 1646, 1675-1682',
    webgpu: gap(
      8,
      'the runtime creates its pipelines with createComputePipelineAsync and createRenderPipelineAsync (src/runtime/program.ts:1578, 1649) and rejects with a new Error that carries the text of the pipeline error (src/runtime/program.ts:1579-1586, 1675-1682); no typed surface reads the reason',
      639,
    ),
    webgl2: na('WebGL2 has no async pipeline creation and no GPUPipelineError'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUPipelineLayoutDescriptor.bindGroupLayouts`',
    covers: ['GPUPipelineLayoutDescriptor.bindGroupLayouts'],
    evidence:
      'src/runtime/program.ts:1549, 1572, 1647; src/rhi/webgpu.ts#WebGpuDevice.createBindGroup',
    webgpu: andGap(
      typed('journeys/overrides/journey.mjs', 'one group per manifest group'),
      7,
      'host-placed groups have no spelling; automatic grouping is roadmap B3 (docs/roadmap.md:257)',
      638,
    ),
    webgl2: na('WebGL2 has no pipeline layout; its bindings are set by name'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUPipelineLayoutDescriptor.immediateSize`',
    covers: ['GPUPipelineLayoutDescriptor.immediateSize'],
    evidence:
      'src/runtime/program.ts:1549, 1572, 1647; src/rhi/webgpu.ts#WebGpuDevice.createBindGroup',
    webgpu: gap(
      7,
      'the layout names no immediate data (src/runtime/program.ts:1550); immediates have no spelling',
      536,
    ),
    webgl2: na('WebGL2 has no immediate data; a uniform is set by its program'),
  },
];
