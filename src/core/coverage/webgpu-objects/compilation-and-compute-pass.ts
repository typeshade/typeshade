import { na, type Row, typed } from '../model.js';

export const COMPILATION_AND_COMPUTE_PASS_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUCompilationMessage.message`',
    covers: ['GPUCompilationMessage.message'],
    evidence: 'docs/language-design.md:1391-1395; src/core/gl-compute.ts:131',
    webgpu: na(
      'the front end diagnoses at the source (Rule 12.6); the compile gate holds the emit to Tint (Rule 1.1)',
    ),
    webgl2: na(
      'WebGL2 reports shader errors through getShaderInfoLog, a string, and has no compilation message object (src/core/gl-compute.ts:131)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUCompilationMessage.type`',
    covers: ['GPUCompilationMessage.type'],
    evidence: 'docs/language-design.md:1391-1395; src/core/gl-compute.ts:131',
    webgpu: na(
      'the front end diagnoses at the source (Rule 12.6); the compile gate holds the emit to Tint (Rule 1.1)',
    ),
    webgl2: na(
      'WebGL2 reports shader errors through getShaderInfoLog, a string with no message type (src/core/gl-compute.ts:131)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUCompilationMessage.lineNum`',
    covers: ['GPUCompilationMessage.lineNum'],
    evidence: 'docs/language-design.md:1391-1395; src/core/gl-compute.ts:131',
    webgpu: na(
      'the front end diagnoses at the source (Rule 12.6); the compile gate holds the emit to Tint (Rule 1.1)',
    ),
    webgl2: na(
      'WebGL2 reports shader errors through getShaderInfoLog, a string with no lineNum, linePos, offset or length field (src/core/gl-compute.ts:131)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUCompilationMessage.linePos`',
    covers: ['GPUCompilationMessage.linePos'],
    evidence: 'docs/language-design.md:1391-1395; src/core/gl-compute.ts:131',
    webgpu: na(
      'the front end diagnoses at the source (Rule 12.6); the compile gate holds the emit to Tint (Rule 1.1)',
    ),
    webgl2: na(
      'WebGL2 reports shader errors through getShaderInfoLog, a string with no lineNum, linePos, offset or length field (src/core/gl-compute.ts:131)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUCompilationMessage.offset`',
    covers: ['GPUCompilationMessage.offset'],
    evidence: 'docs/language-design.md:1391-1395; src/core/gl-compute.ts:131',
    webgpu: na(
      'the front end diagnoses at the source (Rule 12.6); the compile gate holds the emit to Tint (Rule 1.1)',
    ),
    webgl2: na(
      'WebGL2 reports shader errors through getShaderInfoLog, a string with no lineNum, linePos, offset or length field (src/core/gl-compute.ts:131)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUCompilationMessage.length`',
    covers: ['GPUCompilationMessage.length'],
    evidence: 'docs/language-design.md:1391-1395; src/core/gl-compute.ts:131',
    webgpu: na(
      'the front end diagnoses at the source (Rule 12.6); the compile gate holds the emit to Tint (Rule 1.1)',
    ),
    webgl2: na(
      'WebGL2 reports shader errors through getShaderInfoLog, a string with no lineNum, linePos, offset or length field (src/core/gl-compute.ts:131)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUComputePassEncoder.setPipeline()`',
    covers: ['GPUComputePassEncoder.setPipeline'],
    evidence:
      'src/runtime/program.ts#ComputePipeline.entry|ComputePipeline.workgroupShape; src/runtime/gl.ts#GlComputePipelineImpl.dispatch',
    webgpu: typed('journeys/mesh-raycast/journey.mjs'),
    webgl2: typed('journeys/mesh-raycast/journey.mjs'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUComputePassEncoder.dispatchWorkgroups()`',
    covers: ['GPUComputePassEncoder.dispatchWorkgroups'],
    evidence:
      'src/runtime/program.ts#ComputePipeline.entry|ComputePipeline.workgroupShape; src/runtime/gl.ts#Given',
    webgpu: typed('journeys/mesh-raycast/journey.mjs', 'ComputePipeline.dispatch'),
    webgl2: typed('journeys/mesh-raycast/journey.mjs', 'ComputePipeline.dispatch'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUComputePassEncoder.dispatchWorkgroupsIndirect()`',
    covers: ['GPUComputePassEncoder.dispatchWorkgroupsIndirect'],
    evidence: 'src/core/host-entry.ts:1755-1756',
    webgpu: typed(
      'scripts/user-journey.ts',
      'an entry call takes { indirect, offset? }, the counts a Buffer<u32> holds (change 0075); the program runtime takes no indirect count yet, so a host cannot issue an indirect dispatch of a runtime program (#540)',
    ),
    webgl2: na(
      'WebGPU indirect dispatch; WebGL2 has no such call to cover, and an entry call there reads its indirect counts from the host copy (change 0075, Rule 11.8)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUComputePassEncoder.end()`',
    covers: ['GPUComputePassEncoder.end'],
    evidence: 'src/runtime/runtime.ts:195-224; src/runtime/gl.ts#GlFrameImpl.submit',
    webgpu: typed('journeys/mesh-raycast/journey.mjs'),
    webgl2: typed('journeys/mesh-raycast/journey.mjs'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface',
    name: '`GPUComputePipeline`',
    covers: ['GPUComputePipeline'],
    evidence:
      'src/runtime/program.ts#ComputePipeline.entry|ComputePipeline.workgroupShape; src/runtime/gl.ts#GlProgramImpl.render',
    webgpu: typed('src/runtime/runtime.test.ts', 'ComputePipeline'),
    webgl2: typed('journeys/mesh-raycast/journey.mjs', 'ComputePipeline'),
  },
];
