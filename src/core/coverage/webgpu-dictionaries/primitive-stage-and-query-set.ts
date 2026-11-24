import { andGap, gap, na, raw, type Row, typed } from '../model.js';

export const PRIMITIVE_STAGE_AND_QUERY_SET_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUPrimitiveState.topology`',
    covers: ['GPUPrimitiveState.topology'],
    evidence:
      'src/runtime/program.ts:301-307; src/rhi/webgl2.ts#GL_TOPOLOGY|drawStateOf~"GL_TOPOLOGY"',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets a topology; the runtime writes the default (src/runtime/program.ts:1671; src/rhi/webgpu.ts:418-422); topology, cullMode, frontFace; a strip drawn with indices needs stripIndexFormat, which the runtime does not set (to measure)',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no WebGL2 test sets a topology; every draw runs triangle-list (src/rhi/webgl2.ts:444-453); topology, cullMode, frontFace',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUPrimitiveState.stripIndexFormat`',
    covers: ['GPUPrimitiveState.stripIndexFormat'],
    evidence: 'src/runtime/program.ts:1674',
    webgpu: gap(
      14,
      'a strip drawn with indices needs it; not set (inference: WebGPU validation would refuse; not measured)',
      644,
    ),
    webgl2: na('WebGL2 sets the index type in each drawElements call'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUPrimitiveState.frontFace`',
    covers: ['GPUPrimitiveState.frontFace'],
    evidence:
      'src/runtime/program.ts:301-307; src/rhi/webgl2.ts#drawStateOf~"frontFace"|setState~"frontFace"',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets frontFace; every draw uses ccw; topology, cullMode, frontFace',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): culling is none in every WebGL2 draw, so no frame shows the front face (src/rhi/webgl2.ts:535-537); topology, cullMode, frontFace',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUPrimitiveState.cullMode`',
    covers: ['GPUPrimitiveState.cullMode'],
    evidence:
      'src/runtime/program.ts:301-307; src/rhi/webgl2.ts#drawStateOf~"cullMode"|setState~"cullFace"',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no frame shows a cull mode; the only test that sets one checks a pipeline-cache key (src/runtime/runtime.test.ts:391); topology, cullMode, frontFace',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): every WebGL2 draw uses cullMode none (src/rhi/webgl2.ts:535-537); topology, cullMode, frontFace',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUPrimitiveState.unclippedDepth`',
    covers: ['GPUPrimitiveState.unclippedDepth'],
    evidence: 'src/runtime/program.ts:301-307; src/rhi/webgl2.ts#setState',
    webgpu: gap(1, 'feature depth-clip-control; WebGL2 EXT_depth_clamp', 632),
    webgl2: andGap(
      raw(
        'Runtime.device',
        'the host enables the clamp on rt.device; the runtime sets and resets none',
      ),
      1,
      'unclippedDepth has no typed form',
      632,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUProgrammableStage.module`',
    covers: ['GPUProgrammableStage.module'],
    evidence: 'src/runtime/program.ts:1573, 1648; src/rhi/webgpu.ts:390, 400-417',
    webgpu: typed(
      'journeys/overrides/journey.mjs',
      'module, entryPoint and constants from the manifest and RenderState.constants (change 0028)',
    ),
    webgl2: na("WebGL2 has no shader module; each stage is the manifest's GLSL"),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUProgrammableStage.entryPoint`',
    covers: ['GPUProgrammableStage.entryPoint'],
    evidence: 'src/runtime/program.ts:1649-1657; src/runtime/gl-draw.ts#GlRenderPrograms.render',
    webgpu: typed(
      'journeys/mnist/journey.mjs',
      'module, entryPoint and constants from the manifest and RenderState.constants (change 0028)',
    ),
    webgl2: typed(
      'journeys/mnist/journey.mjs',
      'module, entryPoint and constants from the manifest and RenderState.constants (change 0028)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUProgrammableStage.constants`',
    covers: ['GPUProgrammableStage.constants'],
    evidence:
      'src/runtime/program.ts:1649-1657; src/runtime/gl-draw.ts#GlRenderPrograms~"plan.constants"',
    webgpu: typed(
      'src/runtime/runtime.test.ts',
      'module, entryPoint and constants from the manifest and RenderState.constants (change 0028)',
    ),
    webgl2: typed(
      'src/runtime/runtime.test.ts',
      'module, entryPoint and constants from the manifest and RenderState.constants (change 0028)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUQuerySetDescriptor.type`',
    covers: ['GPUQuerySetDescriptor.type'],
    evidence: 'src/runtime/runtime.ts:644-654; src/runtime/runtime.ts#SubmitResult|Runtime.info',
    webgpu: andGap(
      raw(
        'Runtime.device',
        'the host makes its query set on rt.device; a timestamp query set needs a device that has timestamp-query, passed with createRuntime({ device })',
      ),
      4,
      'no typed spelling makes a query set; src/runtime makes none; issue 542 tracks timestamps only',
      542,
    ),
    webgl2: gap(
      4,
      'no query set; WebGL2 has beginQuery/EXT_disjoint_timer_query_webgl2; issue 542 tracks timestamps only',
      542,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUQuerySetDescriptor.count`',
    covers: ['GPUQuerySetDescriptor.count'],
    evidence: 'src/runtime/runtime.ts:644-654; src/runtime/runtime.ts:230-238',
    webgpu: andGap(
      raw(
        'Runtime.device',
        'the host makes its query set on rt.device; a timestamp query set needs a device that has timestamp-query, passed with createRuntime({ device })',
      ),
      4,
      'no typed query set; issue 542 tracks timestamps only',
      542,
    ),
    webgl2: gap(
      4,
      'no query set; WebGL2 has beginQuery/EXT_disjoint_timer_query_webgl2; issue 542 tracks timestamps only',
      542,
    ),
  },
];
