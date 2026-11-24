import { andGap, gap, na, raw, type Row, typed } from '../model.js';

export const BUFFER_USAGE_AND_COLOR_WRITE_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUBufferUsage.MAP_READ`',
    covers: ['GPUBufferUsage.MAP_READ'],
    evidence: 'src/rhi/webgpu.ts#Adapter; src/rhi/webgpu.ts:317-320',
    webgpu: typed('src/runtime/runtime.test.ts', 'chosen by the runtime for each buffer'),
    webgl2: na('WebGPU-only concept: WebGL2 has no GPUBufferUsage flags'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUBufferUsage.MAP_WRITE`',
    covers: ['GPUBufferUsage.MAP_WRITE'],
    evidence: 'src/core/resident.ts#ResidentArrayState.version; src/core/host-entry.ts:633-634',
    webgpu: raw('GPUBuffer', 'a host GPUBuffer made with this usage can be mapped for writing'),
    webgl2: na('WebGPU-only concept: WebGL2 has no GPUBufferUsage flags'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUBufferUsage.COPY_SRC`',
    covers: ['GPUBufferUsage.COPY_SRC'],
    evidence: 'src/rhi/webgpu.ts:106; src/core/host-entry.ts:633-634; src/runtime/program.ts:1393',
    webgpu: typed('journeys/mesh-raycast/journey.mjs', 'chosen by the runtime for each buffer'),
    webgl2: na('WebGPU-only concept: WebGL2 has no GPUBufferUsage flags'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUBufferUsage.COPY_DST`',
    covers: ['GPUBufferUsage.COPY_DST'],
    evidence: 'src/rhi/webgpu.ts:107; src/core/host-entry.ts:633-634; src/runtime/program.ts:1393',
    webgpu: typed('journeys/mesh-raycast/journey.mjs', 'chosen by the runtime for each buffer'),
    webgl2: na('WebGPU-only concept: WebGL2 has no GPUBufferUsage flags'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUBufferUsage.INDEX`',
    covers: ['GPUBufferUsage.INDEX'],
    evidence:
      'src/rhi/webgpu.ts#BUFFER; src/core/host-entry.ts:633-634; src/runtime/program.ts:1393',
    webgpu: typed('scripts/compile-gate.ts', 'chosen by the runtime for each buffer'),
    webgl2: na('WebGPU-only concept: WebGL2 has no GPUBufferUsage flags'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUBufferUsage.VERTEX`',
    covers: ['GPUBufferUsage.VERTEX'],
    evidence:
      'src/rhi/webgpu.ts#BUFFER.MAP_READ; src/core/host-entry.ts:633-634; src/runtime/program.ts:1393',
    webgpu: typed('journeys/engine/engine.mjs', 'chosen by the runtime for each buffer'),
    webgl2: na('WebGPU-only concept: WebGL2 has no GPUBufferUsage flags'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUBufferUsage.UNIFORM`',
    covers: ['GPUBufferUsage.UNIFORM'],
    evidence:
      'src/rhi/webgpu.ts#BUFFER.COPY_SRC; src/core/host-entry.ts:633-634; src/runtime/program.ts:1393',
    webgpu: typed('journeys/engine/engine.mjs', 'chosen by the runtime for each buffer'),
    webgl2: na('WebGPU-only concept: WebGL2 has no GPUBufferUsage flags'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUBufferUsage.STORAGE`',
    covers: ['GPUBufferUsage.STORAGE'],
    evidence:
      'src/rhi/webgpu.ts#BUFFER.COPY_DST; src/core/host-entry.ts:633-634; src/runtime/program.ts:1393',
    webgpu: typed('journeys/mesh-raycast/journey.mjs', 'chosen by the runtime for each buffer'),
    webgl2: na('WebGPU-only concept: WebGL2 has no GPUBufferUsage flags'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUBufferUsage.INDIRECT`',
    covers: ['GPUBufferUsage.INDIRECT'],
    evidence: 'src/core/host-entry.ts:752-759',
    webgpu: typed(
      'scripts/user-journey.ts',
      'every Buffer has the usage, so an entry call reads its counts from one (change 0075); a host cannot issue an indirect draw or dispatch of a runtime program yet (#540)',
    ),
    webgl2: na('WebGPU-only concept: WebGL2 has no GPUBufferUsage flags'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUBufferUsage.QUERY_RESOLVE`',
    covers: ['GPUBufferUsage.QUERY_RESOLVE'],
    evidence:
      'src/rhi/webgpu.ts:104-112; src/runtime/runtime.ts#RenderPass|Frame; src/runtime/runtime.ts#SubmitResult|Runtime.info',
    webgpu: andGap(
      raw(
        'Runtime.device',
        'the host creates the buffer on the runtime device and resolves a query set into it on its own encoder',
      ),
      4,
      'no typed spelling makes a query-resolve buffer; issue 542 tracks timestamps only',
      542,
    ),
    webgl2: na('WebGPU-only concept: WebGL2 has no GPUBufferUsage flags'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUColorWrite.RED`',
    covers: ['GPUColorWrite.RED'],
    evidence:
      'src/runtime/program.ts#Bindings; src/rhi/webgl2.ts#drawStateOf~"writeMask ?? 15"|drawStateOf~"(mask & 1)"|setState~"colorMask"; src/runtime/gl-draw.ts#GlRenderPrograms~"plan.targets"',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets TargetState.writeMask or names GPUColorWrite; the runtime passes the target object through unchanged (src/runtime/program.ts:502-519); the typed surface is TargetState.writeMask',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets TargetState.writeMask or names GPUColorWrite; every WebGL2 draw sets the default mask 15, which sets RED (`drawStateOf` of `src/rhi/webgl2.ts`), and no test reads the bit decode (`drawStateOf` of `src/rhi/webgl2.ts`)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUColorWrite.GREEN`',
    covers: ['GPUColorWrite.GREEN'],
    evidence:
      'src/runtime/program.ts#Bindings; src/rhi/webgl2.ts#drawStateOf~"writeMask ?? 15"|drawStateOf~"(mask & 2)"|setState~"colorMask"; src/runtime/gl-draw.ts#GlRenderPrograms~"plan.targets"',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets TargetState.writeMask or names GPUColorWrite; the runtime passes the target object through unchanged (src/runtime/program.ts:502-519); the typed surface is TargetState.writeMask',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets a mask without GREEN; every WebGL2 draw sets the default mask 15, which sets GREEN (`drawStateOf` of `src/rhi/webgl2.ts`)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUColorWrite.BLUE`',
    covers: ['GPUColorWrite.BLUE'],
    evidence:
      'src/runtime/program.ts#Bindings; src/rhi/webgl2.ts#drawStateOf~"writeMask ?? 15"|drawStateOf~"(mask & 4)"|setState~"colorMask"; src/runtime/gl-draw.ts#GlRenderPrograms~"plan.targets"',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets TargetState.writeMask or names GPUColorWrite; the runtime passes the target object through unchanged (src/runtime/program.ts:502-519); the typed surface is TargetState.writeMask',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets a mask without BLUE; every WebGL2 draw sets the default mask 15, which sets BLUE (`drawStateOf` of `src/rhi/webgl2.ts`)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUColorWrite.ALPHA`',
    covers: ['GPUColorWrite.ALPHA'],
    evidence:
      'src/runtime/program.ts#Bindings; src/rhi/webgl2.ts#drawStateOf~"writeMask ?? 15"|drawStateOf~"(mask & 8)"|setState~"colorMask"; src/runtime/gl-draw.ts#GlRenderPrograms~"plan.targets"',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets TargetState.writeMask or names GPUColorWrite; the runtime passes the target object through unchanged (src/runtime/program.ts:502-519); the typed surface is TargetState.writeMask',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets a mask without ALPHA; the render case clears to alpha 1 and every tint has alpha 1, so a dropped alpha bit shows in no picture',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUColorWrite.ALL`',
    covers: ['GPUColorWrite.ALL'],
    evidence:
      'src/runtime/program.ts#Bindings; src/rhi/webgl2.ts#drawStateOf~"writeMask ?? 15"|drawStateOf~"(mask & 1)"|setState~"colorMask"; src/runtime/gl-draw.ts#GlRenderPrograms~"plan.targets"',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test passes writeMask; the runtime sets no mask on WebGPU unless the author passes one (src/runtime/program.ts:73-78, 502-519); the typed surface is TargetState.writeMask',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets all four bits, so a dropped ALPHA bit or a wrong mask decode fails no test (`drawStateOf` of `src/rhi/webgl2.ts`)',
      645,
    ),
  },
];
