import { andGap, gap, na, raw, type Row, typed } from '../model.js';

export const BLEND_AND_BUFFER_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUBlendComponent.operation`',
    covers: ['GPUBlendComponent.operation'],
    evidence:
      'src/runtime/program.ts#Bindings; src/runtime/gl-draw.ts#checkState~"GL_BLEND_OPERATION"|GlRenderPrograms~"plan.targets"; src/rhi/webgl2.ts#setState~"blendEquationSeparate"',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets a blend on WebGPU; TargetState.blend is GPUBlendState passed through and checked',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no WebGL2 test sets a blend; BLEND_OP runs only with the default state (`setState` of `src/rhi/webgl2.ts`; `checkState` of `src/runtime/gl-draw.ts`); TargetState.blend is GPUBlendState passed through and checked; one blend state for every target; a blend per target has no spelling; also: refused (Rule 11.11): targets that blend or mask apart',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUBlendComponent.srcFactor`',
    covers: ['GPUBlendComponent.srcFactor'],
    evidence:
      'src/runtime/program.ts#Bindings; src/runtime/gl-draw.ts#checkState~"GL_BLEND_FACTOR"|GlRenderPrograms~"plan.targets"; src/rhi/webgl2.ts#setState~"blendFuncSeparate"',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets a blend factor; TargetState.blend is GPUBlendState passed through and checked; constant factors read the blend constant, set by RenderPass.setBlendConstant or RenderState.blendConstant (src/runtime/program.ts:73-79)',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no WebGL2 test sets a blend factor; BLEND_FACTOR runs only with the default state (`checkState` of `src/runtime/gl-draw.ts`); TargetState.blend is GPUBlendState passed through and checked; src1 factors need @blend_src, which the GLSL writer refuses (Rule 10.3); constant factors read the blend constant, set by RenderPass.setBlendConstant or RenderState.blendConstant (src/runtime/program.ts:73-79)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUBlendComponent.dstFactor`',
    covers: ['GPUBlendComponent.dstFactor'],
    evidence:
      'src/runtime/program.ts#Bindings; src/runtime/gl-draw.ts#checkState~"GL_BLEND_FACTOR"|GlRenderPrograms~"plan.targets"; src/rhi/webgl2.ts#setState~"blendFuncSeparate"',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets a blend factor; TargetState.blend is GPUBlendState passed through and checked; constant factors read the blend constant, set by RenderPass.setBlendConstant or RenderState.blendConstant (src/runtime/program.ts:73-79)',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no WebGL2 test sets a blend factor; BLEND_FACTOR runs only with the default state (`checkState` of `src/runtime/gl-draw.ts`); TargetState.blend is GPUBlendState passed through and checked; src1 factors need @blend_src, which the GLSL writer refuses (Rule 10.3); constant factors read the blend constant, set by RenderPass.setBlendConstant or RenderState.blendConstant (src/runtime/program.ts:73-79)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUBlendState.color`',
    covers: ['GPUBlendState.color'],
    evidence:
      'src/runtime/program.ts#Bindings; src/runtime/gl-draw.ts#checkState~"blend.color"|GlRenderPrograms~"plan.targets"; src/rhi/webgl2.ts#setState~"blendFuncSeparate"|setState~"blendEquationSeparate"',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets a colour blend on WebGPU; TargetState.blend is GPUBlendState passed through and checked',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no WebGL2 test sets a colour blend; blendFuncSeparate runs only with the default state (`setState` of `src/rhi/webgl2.ts`); TargetState.blend is GPUBlendState passed through and checked; one blend state for every target; a blend per target has no spelling; also: refused (Rule 11.11): targets that blend or mask apart',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUBlendState.alpha`',
    covers: ['GPUBlendState.alpha'],
    evidence:
      'src/runtime/program.ts#Bindings; src/runtime/gl-draw.ts#checkState~"blend.alpha"|GlRenderPrograms~"plan.targets"; src/rhi/webgl2.ts#setState~"blendFuncSeparate"|setState~"blendEquationSeparate"',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets an alpha blend on WebGPU; TargetState.blend is GPUBlendState passed through and checked',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no WebGL2 test sets an alpha blend; blendFuncSeparate runs only with the default state (`setState` of `src/rhi/webgl2.ts`); TargetState.blend is GPUBlendState passed through and checked; one blend state for every target; a blend per target has no spelling; also: refused (Rule 11.11): targets that blend or mask apart',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUBufferBinding.buffer`',
    covers: ['GPUBufferBinding.buffer'],
    evidence:
      'src/runtime/program.ts:1785-1843; src/rhi/webgpu.ts:362-379; src/runtime/gl-draw.ts#GlRenderPipelineImpl~"buffer: host"; src/rhi/webgl2.ts#GlDevice.fromNative~"WebGLBuffer"',
    webgpu: andGap(
      typed(
        'src/runtime/runtime.test.ts',
        'a host value or a Buffer; also: raw (a host GPUBuffer, bound as is)',
      ),
      7,
      'whole-buffer binding only; a sub-range has no spelling',
      638,
    ),
    webgl2: andGap(
      typed(
        'journeys/plasma/journey.mjs',
        'a host value or a Buffer; also: raw (a host WebGLBuffer, bound as is)',
      ),
      7,
      'whole-buffer binding only; a sub-range has no spelling',
      638,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUBufferBinding.offset`',
    covers: ['GPUBufferBinding.offset'],
    evidence: 'src/runtime/program.ts:1780-1843',
    webgpu: gap(7, 'whole-buffer binding only', 638),
    webgl2: gap(7, 'whole-buffer binding only', 638),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUBufferBinding.size`',
    covers: ['GPUBufferBinding.size'],
    evidence: 'src/runtime/program.ts:1780-1843',
    webgpu: gap(7, 'whole-buffer binding only', 638),
    webgl2: gap(7, 'whole-buffer binding only', 638),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUBufferBindingLayout.type`',
    covers: ['GPUBufferBindingLayout.type'],
    evidence: 'src/runtime/program.ts:1328-1381',
    webgpu: typed(
      'src/runtime/runtime.test.ts',
      'type from the binding (uniform, storage, read-only-storage)',
    ),
    webgl2: na(
      'WebGL2 has no bind group layout; its bindings are set by name. The binding kind itself is typed: see GPUBufferBindingType.',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUBufferBindingLayout.hasDynamicOffset`',
    covers: ['GPUBufferBindingLayout.hasDynamicOffset'],
    evidence: 'src/runtime/program.ts:1328-1381',
    webgpu: gap(7, 'never set; a dynamic offset has no spelling', 638),
    webgl2: gap(
      7,
      'a dynamic offset has no spelling; WebGL2 binds a sub-range with bindBufferRange',
      638,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUBufferBindingLayout.minBindingSize`',
    covers: ['GPUBufferBindingLayout.minBindingSize'],
    evidence: 'src/runtime/program.ts:1328-1381',
    webgpu: na("the runtime checks the host value's shape itself (Rule 11.11)"),
    webgl2: na('WebGL2 has no bind group layout; its bindings are set by name'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUBufferDescriptor.size`',
    covers: ['GPUBufferDescriptor.size'],
    evidence:
      'src/core/resident.ts:216; src/runtime/program.ts:1393, 2102; src/rhi/webgpu.ts#WebGpuDevice.constructor; src/runtime/gl-draw.ts#fresh|GlDrawing.uploaded',
    webgpu: typed(
      'src/runtime/runtime.test.ts',
      'array() and plain host values make the buffers (Rules 8.21, 11.8)',
    ),
    webgl2: typed(
      'scripts/compile-gate.ts',
      'array() and plain host values make the buffers (Rules 8.21, 11.8)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUBufferDescriptor.usage`',
    covers: ['GPUBufferDescriptor.usage'],
    evidence:
      'src/core/resident.ts:216; src/runtime/program.ts:1393, 2102; src/rhi/webgpu.ts#WebGpuDevice.constructor; src/runtime/gl-draw.ts#fresh~"usage"|GlRenderPipelineImpl~"usage"',
    webgpu: typed(
      'src/runtime/runtime.test.ts',
      'array() and plain host values make the buffers (Rules 8.21, 11.8)',
    ),
    webgl2: na(
      'WebGL2 has no buffer usage flags; the runtime lists a usage in `fresh` of `src/runtime/gl-draw.ts`, and `GlDrawing.uploaded` sets none',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUBufferDescriptor.mappedAtCreation`',
    covers: ['GPUBufferDescriptor.mappedAtCreation'],
    evidence: 'src/core/resident.ts:216; src/runtime/program.ts:1393, 1780-1843, 2091',
    webgpu: raw('GPUBuffer', 'a host GPUBuffer made with mappedAtCreation is bound as is'),
    webgl2: na('WebGL2 has no mapping at creation; a buffer is written with bufferSubData'),
  },
];
