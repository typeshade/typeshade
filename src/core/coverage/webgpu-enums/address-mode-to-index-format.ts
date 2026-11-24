import { andGap, gap, na, raw, type Row, typed } from '../model.js';

export const ADDRESS_MODE_TO_INDEX_FORMAT_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUAddressMode`',
    covers: ['GPUAddressMode'],
    evidence: 'src/runtime/resources.ts#SamplerOptions|Sampler|ADDRESS',
    note: '3 members. clamp, repeat, mirror',
    webgpu: typed('scripts/user-journey.ts'),
    webgl2: typed('scripts/user-journey.ts'),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUAutoLayoutMode`',
    covers: ['GPUAutoLayoutMode'],
    evidence: 'docs/language-design.md:1253',
    note: '1 member. never layout: auto (Rule 11.11)',
    webgpu: na('never layout: auto (Rule 11.11)'),
    webgl2: na(
      'WebGL2 has no pipeline layout object; the runtime never builds an auto layout (Rule 11.11)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUBlendFactor`',
    covers: ['GPUBlendFactor'],
    evidence: 'src/runtime/program.ts#Bindings; src/runtime/program.ts:1532',
    note: '17 members. passed through; src1 factors need @blend_src; constant factors read the blend constant, set by RenderPass.setBlendConstant or RenderState.blendConstant',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets TargetState.blend (src/runtime/program.ts:73-79); constant factors read the blend constant, set by RenderPass.setBlendConstant or RenderState.blendConstant',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets TargetState.blend on the WebGL2 tier (src/runtime/gl-draw.ts:545-575); src1 factors need @blend_src, which the GLSL writer refuses (Rule 10.3); constant factors read the blend constant, set by RenderPass.setBlendConstant or RenderState.blendConstant; also: refused (Rule 11.11): targets that blend or mask apart',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUBlendOperation`',
    covers: ['GPUBlendOperation'],
    evidence: 'src/runtime/program.ts#Bindings; src/runtime/gl-draw.ts:583',
    note: '5 members.',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets TargetState.blend (src/runtime/program.ts:68-77)',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets TargetState.blend on the WebGL2 tier (src/runtime/gl-draw.ts:972-973); also: refused (Rule 11.11): targets that blend or mask apart',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUBufferBindingType`',
    covers: ['GPUBufferBindingType'],
    evidence:
      'src/runtime/program.ts:1334-1338; src/runtime/gl.ts:378-380; src/core/reflect.ts:903',
    note: '3 members.',
    webgpu: typed('src/runtime/runtime.test.ts'),
    webgl2: typed(
      'scripts/compile-gate.ts',
      'WebGL2 has no bind group layout; the binding kind follows the declared address space: uniform, or words for storage (src/runtime/gl.ts:378-380; src/core/reflect.ts:903)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUBufferMapState`',
    covers: ['GPUBufferMapState'],
    evidence: 'src/rhi/webgpu.ts:274-280, 328-335; docs/language-design.md:1328',
    note: '3 members.',
    webgpu: raw(
      'GPUBuffer',
      'the host reads the map state of its own GPUBuffer, as GPUBuffer.mapState does; the runtime maps its own readback staging buffer (src/runtime/resources.ts:286)',
    ),
    webgl2: na('WebGL2 has no GPUBuffer mapping state'),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUCanvasAlphaMode`',
    covers: ['GPUCanvasAlphaMode'],
    evidence:
      'src/runtime/runtime.ts:526-530; src/rhi/webgpu.ts:346-348; src/runtime/gl-draw.ts:1094-1100; docs/language-design.md:906',
    note: '2 members. the host configures; the call layer draws opaque (Rule 8.24)',
    webgpu: raw(
      'createRuntime({ device })',
      'the host configures its own canvas context with the device it passes in, and passes the context as a colour target (src/runtime/runtime.ts:530)',
    ),
    webgl2: andGap(
      raw(
        'createRuntime({ device })',
        'the host creates the WebGL2 context with its attributes and passes it in (src/runtime/runtime.ts:609-616); the pass takes the context as its canvas target (src/runtime/gl-draw.ts:1094-1100)',
      ),
      8,
      'the context attributes alpha and premultipliedAlpha are set by the host (table D)',
      639,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUCanvasToneMappingMode`',
    covers: ['GPUCanvasToneMappingMode'],
    evidence: 'src/runtime/runtime.ts:530',
    note: '2 members.',
    webgpu: raw(
      'createRuntime({ device })',
      'the host configures toneMapping on its own canvas context, made with the device it passes in (src/runtime/runtime.ts:51-58, 100-101)',
    ),
    webgl2: na('a WebGPU canvas option; WebGL2 canvases have no tone mapping'),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUCompareFunction`',
    covers: ['GPUCompareFunction'],
    evidence:
      'src/runtime/program.ts:278-284; src/runtime/resources.ts#SamplerOptions.compare|Sampler|ADDRESS',
    note: '8 members. depth compare and sampler compare',
    webgpu: typed('scripts/compile-gate.ts'),
    webgl2: typed('scripts/compile-gate.ts'),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUCompilationMessageType`',
    covers: ['GPUCompilationMessageType'],
    evidence: 'docs/language-design.md:36, 1391-1395; src/core/gl-compute.ts:131',
    note: '3 members.',
    webgpu: na(
      'the front end diagnoses at the source (Rule 12.6); the compile gate holds the emit to Tint (Rule 1.1)',
    ),
    webgl2: na(
      'WebGL2 reports shader errors through getShaderInfoLog, a string with no message type (src/core/gl-compute.ts:131)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUCullMode`',
    covers: ['GPUCullMode'],
    evidence: 'src/runtime/program.ts:301-307',
    note: '3 members.',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): src/runtime/runtime.test.ts:391 sets cullMode and checks only that the pipeline key changes (src/runtime/program.ts:911-913)',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets cullMode on the WebGL2 tier (src/rhi/webgl2.ts:647, 535)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUDeviceLostReason`',
    covers: ['GPUDeviceLostReason'],
    evidence: 'src/core/host-entry.ts:704; src/runtime/runtime.ts#SubmitResult|Runtime.info',
    note: '2 members. see GPUDevice.lost',
    webgpu: andGap(
      raw(
        'Runtime.device',
        'the host reads the loss reason through rt.device.lost; the call layer ignores its value (src/core/host-entry.ts:704)',
      ),
      8,
      'no typed surface reports the loss reason to the host; the call layer requests a new device once one is lost (src/runtime/runtime.ts:769)',
      639,
    ),
    webgl2: na(
      'the WebGPU device-loss reason; WebGL2 reports loss on its context (see GPUDevice.lost)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUErrorFilter`',
    covers: ['GPUErrorFilter'],
    evidence: 'src/runtime/runtime.ts#RuntimeImpl.submit; src/rhi/webgpu.ts:438-440',
    note: '3 members. validation only',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test provokes a validation error through the runtime (src/runtime/runtime.ts:453); the out-of-memory and internal filters have no typed spelling; the runtime pushes only a validation scope (src/runtime/runtime.ts:453)',
      645,
    ),
    webgl2: na('a WebGPU error scope; WebGL2 has no error scope to filter'),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUFeatureName`',
    covers: ['GPUFeatureName'],
    evidence:
      'src/core/backends/wgsl.ts:216-272; src/core/ir/nodes.ts#Capability|ALL_CAPABILITIES; src/compiler/ts/builtin-check.ts#WGSL_ATTRIBUTES_ELSEWHERE; docs/language-design.md:314; node_modules/@webgpu/types/dist/index.d.ts:1472-1483',
    note: '25 members. grouped: shader-f16 refused (Rule 4.7); subgroups typed directive, functions sub-gap; clip-distances, dual-source-blending, primitive-index, bgra8unorm-storage typed; float32-filterable, float32-blendable declarable with no "use typeshade" spelling (sub-gap, surface §50); depth-clip-control, depth32float-stencil8, timestamp-query, indirect-first-instance, texture-compression-bc/etc2/astc (+sliced-3d), rg11b10ufloat-renderable, texture-component-swizzle, texture-compression-unaligned, texture-formats-tier1, texture-formats-tier2: sub-gap; core-features-and-limits n/a. rg11b10ufloat-renderable as a render target: not measured',
    webgpu: andGap(
      typed(
        'src/compiler/ts/builtin-values.test.ts',
        'also: refused (Rule 4.7) for shader-f16; n/a for core-features-and-limits, which names the core feature level, not a feature (node_modules/@webgpu/types/dist/index.d.ts:1472-1483)',
      ),
      6,
      'float32-filterable and float32-blendable have no "use typeshade" spelling (surface §50); depth32float-stencil8, texture-compression-bc, texture-compression-bc-sliced-3d, texture-compression-etc2, texture-compression-astc, texture-compression-astc-sliced-3d, rg11b10ufloat-renderable, texture-component-swizzle and texture-compression-unaligned have no typed spelling; ' +
        'no adapter reachable from this repository reports texture-formats-tier1, and both Chromium builds refuse every tiered format at every storage access mode (docs/use-typeshade-surface.md:5377-5381); ' +
        'texture-formats-tier2 is not measured. Roadmap 13b names the tier-1 formats as shipped (docs/roadmap.md:228). ' +
        '§14 asks whether read_write storage formats are a host-feature capability or refused (docs/language-design.md:1504), and the surface text places them in the same position (docs/use-typeshade-surface.md:5377-5381). ' +
        'Other parts of this enum: depth-clip-control (group 1); timestamp-query (group 4); indirect-first-instance (group 5); the subgroup functions (group 13, docs/language-design.md:1506; docs/roadmap.md:306); subgroup-size-control (group 12, docs/language-design.md:1506; docs/roadmap.md:306); atomic-vec2u-min-max (group 9, docs/roadmap.md:304)',
      637,
    ),
    webgl2: na('a WebGPU feature name; WebGL2 names its capabilities as extensions (table D)'),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUFilterMode`',
    covers: ['GPUFilterMode'],
    evidence: 'src/runtime/resources.ts#SamplerOptions|Sampler|ADDRESS',
    note: '2 members.',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): every sampling case reads texel centres, where nearest and linear return the same texel; no test reads the sampler descriptor (src/runtime/resources.ts:303-308)',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): every WebGL2 sampling case reads texel centres, where nearest and linear return the same texel (src/rhi/webgl2.ts:1424-1434)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUFrontFace`',
    covers: ['GPUFrontFace'],
    evidence: 'src/runtime/program.ts:301-307',
    note: '2 members.',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets primitive.frontFace, and every frame culls nothing (src/runtime/program.ts:815)',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets frontFace on the WebGL2 tier (src/rhi/webgl2.ts:537)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUIndexFormat`',
    covers: ['GPUIndexFormat'],
    evidence: 'src/runtime/program.ts#Geometry',
    note: '2 members.',
    webgpu: typed('scripts/compile-gate.ts'),
    webgl2: typed('scripts/compile-gate.ts'),
  },
];
