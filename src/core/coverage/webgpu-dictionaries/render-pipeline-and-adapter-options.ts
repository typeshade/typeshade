import { andGap, gap, na, raw, type Row, typed } from '../model.js';

export const RENDER_PIPELINE_AND_ADAPTER_OPTIONS_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPipelineDescriptor.vertex`',
    covers: ['GPURenderPipelineDescriptor.vertex'],
    evidence:
      'src/runtime/program.ts:752-965, 1592-1598; src/runtime/gl-draw.ts#GlRenderPrograms~"vertex: {"; src/rhi/webgl2.ts#GlDevice~"toGlClip((desc.module"|GlDevice~"desc.vertex.buffers"',
    webgpu: typed('src/runtime/runtime.test.ts', 'program.render(state)'),
    webgl2: typed('scripts/compile-gate.ts', 'program.render(state)'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPipelineDescriptor.primitive`',
    covers: ['GPURenderPipelineDescriptor.primitive'],
    evidence:
      'src/runtime/program.ts:752-965, 1592-1598; src/runtime/gl-draw.ts#GlRenderPrograms~"plan.primitive"|checkState~"GL_TOPOLOGY"; src/rhi/webgl2.ts#GlDevice~"desc.primitive.topology"|drawStateOf~"GL_TOPOLOGY"',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test reads descriptor.primitive (src/runtime/program.ts:1674); program.render(state)',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): every WebGL2 draw runs the default primitive state; program.render(state)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPipelineDescriptor.depthStencil`',
    covers: ['GPURenderPipelineDescriptor.depthStencil'],
    evidence:
      'src/runtime/program.ts:752-965, 1592-1598; src/runtime/gl-draw.ts#GlRenderPrograms~"depthStencil"; src/rhi/webgl2.ts#drawStateOf~"desc.depthStencil"',
    webgpu: typed('scripts/compile-gate.ts', 'program.render(state)'),
    webgl2: typed('scripts/compile-gate.ts', 'program.render(state)'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPipelineDescriptor.multisample`',
    covers: ['GPURenderPipelineDescriptor.multisample'],
    evidence:
      'src/runtime/program.ts:752-965, 1592-1598; src/runtime/gl-draw.ts#GlRenderPrograms~"multisample: plan.multisample"; src/rhi/webgl2.ts#GlDevice.createTexture~"sampleCount"|drawStateOf (drawStateOf reads no multisample member)',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test creates a multisampled render pipeline on WebGPU (src/runtime/program.ts:1217); program.render(state)',
      645,
    ),
    webgl2: typed('src/runtime/runtime.test.ts', 'program.render(state)'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURenderPipelineDescriptor.fragment`',
    covers: ['GPURenderPipelineDescriptor.fragment'],
    evidence:
      'src/runtime/program.ts:752-965, 1592-1598; src/runtime/gl-draw.ts#GlRenderPrograms~"fragment: {"; src/rhi/webgl2.ts#GlDevice~"desc.fragment"',
    webgpu: typed('src/runtime/runtime.test.ts', 'program.render(state)'),
    webgl2: typed('scripts/compile-gate.ts', 'program.render(state)'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURequestAdapterOptions.featureLevel`',
    covers: ['GPURequestAdapterOptions.featureLevel'],
    evidence: 'src/runtime/runtime.ts:644; src/runtime/runtime.ts#RuntimeOptions',
    webgpu: andGap(
      raw('createRuntime({ device })', 'the host requests its own adapter and passes the device'),
      8,
      'requestAdapter() takes no options; featureLevel has no typed spelling',
      639,
    ),
    webgl2: na('WebGL2 requests no adapter'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURequestAdapterOptions.powerPreference`',
    covers: ['GPURequestAdapterOptions.powerPreference'],
    evidence:
      'src/runtime/runtime.ts:644; src/runtime/runtime.ts:609-616; node_modules/typescript/lib/lib.dom.d.ts:2125',
    webgpu: andGap(
      raw('createRuntime({ device })', 'the host requests its own adapter and passes the device'),
      8,
      'requestAdapter() takes no options (src/runtime/runtime.ts:644); powerPreference has no typed spelling',
      639,
    ),
    webgl2: andGap(
      raw('createRuntime({ device })', 'the host sets powerPreference on its own context'),
      8,
      'the power preference is a context attribute the host sets (table D)',
      639,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURequestAdapterOptions.forceFallbackAdapter`',
    covers: ['GPURequestAdapterOptions.forceFallbackAdapter'],
    evidence: 'src/runtime/runtime.ts:644; src/runtime/runtime.ts#RuntimeOptions',
    webgpu: andGap(
      raw('createRuntime({ device })', 'the host requests its own adapter and passes the device'),
      8,
      'requestAdapter() takes no options; forceFallbackAdapter has no typed spelling',
      639,
    ),
    webgl2: na('WebGL2 requests no adapter'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPURequestAdapterOptions.xrCompatible`',
    covers: ['GPURequestAdapterOptions.xrCompatible'],
    evidence:
      'src/runtime/runtime.ts:644; node_modules/typescript/lib/lib.dom.d.ts:2119-2129; src/runtime/runtime.ts:609-616',
    webgpu: andGap(
      raw('createRuntime({ device })', 'the host requests its own adapter and passes the device'),
      8,
      'requestAdapter() takes no options; xrCompatible has no typed spelling',
      639,
    ),
    webgl2: andGap(
      raw(
        'createRuntime({ device })',
        'the host sets xrCompatible on its own context and passes it in',
      ),
      8,
      'the host sets xrCompatible on its own context; WebGLContextAttributes has no XR member (node_modules/typescript/lib/lib.dom.d.ts:2119-2129)',
      639,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUSamplerBindingLayout.type`',
    covers: ['GPUSamplerBindingLayout.type'],
    evidence: 'src/runtime/program.ts:1328-1381',
    webgpu: andGap(
      typed('src/runtime/runtime.test.ts', 'filtering or comparison from the manifest'),
      6,
      'non-filtering sampler bindings are not spellable (surface §69)',
      637,
    ),
    webgl2: na(
      'WebGL2 has no bind group layout; its bindings are set by name. The binding kind itself is typed: see GPUSamplerBindingType.',
    ),
  },
];
