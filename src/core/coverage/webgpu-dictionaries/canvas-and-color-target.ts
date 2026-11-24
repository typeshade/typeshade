import { andGap, gap, na, raw, type Row, typed } from '../model.js';

export const CANVAS_AND_COLOR_TARGET_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUCanvasConfiguration.device`',
    covers: ['GPUCanvasConfiguration.device'],
    evidence:
      'src/runtime/runtime.ts:105-170; src/core/host-draw.ts:315, 731; src/runtime/runtime.ts#RuntimeOptions',
    webgpu: raw(
      'createRuntime({ device })',
      'the host configures its context; the call layer configures an opaque one (Rule 8.24)',
    ),
    webgl2: na('WebGL2 has no configure(); the WebGL2 context is the device (table D)'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUCanvasConfiguration.format`',
    covers: ['GPUCanvasConfiguration.format'],
    evidence:
      'src/runtime/runtime.ts:105-170; src/core/host-draw.ts:315, 731; src/runtime/runtime.ts:51-58',
    webgpu: raw(
      'createRuntime({ device })',
      'the host configures its context; the call layer configures an opaque one (Rule 8.24)',
    ),
    webgl2: na('WebGL2 has no canvas configuration; its context attributes are table D'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUCanvasConfiguration.usage`',
    covers: ['GPUCanvasConfiguration.usage'],
    evidence:
      'src/runtime/runtime.ts:105-170; src/core/host-draw.ts:315, 731; src/runtime/runtime.ts:51-58',
    webgpu: raw(
      'createRuntime({ device })',
      'the host configures its context; the call layer configures an opaque one (Rule 8.24)',
    ),
    webgl2: na('WebGL2 has no canvas configuration; its context attributes are table D'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUCanvasConfiguration.viewFormats`',
    covers: ['GPUCanvasConfiguration.viewFormats'],
    evidence:
      'src/runtime/runtime.ts:105-170; src/core/host-draw.ts:315, 731; src/runtime/runtime.ts:51-58',
    webgpu: raw(
      'createRuntime({ device })',
      'the host configures its context; the call layer configures an opaque one (Rule 8.24)',
    ),
    webgl2: na('WebGL2 has no canvas configuration; its context attributes are table D'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUCanvasConfiguration.colorSpace`',
    covers: ['GPUCanvasConfiguration.colorSpace'],
    evidence:
      'src/runtime/runtime.ts:105-170; src/core/host-draw.ts:315, 731; src/runtime/runtime.ts:609-616; src/runtime/gl-draw.ts#recordPass~"currentTexture"',
    webgpu: raw(
      'createRuntime({ device })',
      'the host configures its context; the call layer configures an opaque one (Rule 8.24)',
    ),
    webgl2: andGap(
      raw('createRuntime({ device })', 'the host sets drawingBufferColorSpace on its own context'),
      8,
      'the drawing-buffer colour space is a context property the host sets (table D)',
      639,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUCanvasConfiguration.toneMapping`',
    covers: ['GPUCanvasConfiguration.toneMapping'],
    evidence:
      'src/runtime/runtime.ts:105-170; src/core/host-draw.ts:315, 731; src/runtime/runtime.ts:51-58',
    webgpu: raw(
      'createRuntime({ device })',
      'the host configures its context; the call layer configures an opaque one (Rule 8.24)',
    ),
    webgl2: na('WebGL2 has no canvas configuration; its context attributes are table D'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUCanvasConfiguration.alphaMode`',
    covers: ['GPUCanvasConfiguration.alphaMode'],
    evidence:
      'src/runtime/runtime.ts:105-170; src/core/host-draw.ts:315, 731; src/runtime/runtime.ts:609-616; src/runtime/gl-draw.ts#recordPass~"currentTexture"',
    webgpu: raw(
      'createRuntime({ device })',
      'the host configures its context; the call layer configures an opaque one (Rule 8.24)',
    ),
    webgl2: andGap(
      raw(
        'createRuntime({ device })',
        'the host sets alpha or premultipliedAlpha on its own context',
      ),
      8,
      'the context attributes alpha and premultipliedAlpha are set by the host (table D)',
      639,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUCanvasToneMapping.mode`',
    covers: ['GPUCanvasToneMapping.mode'],
    evidence: 'src/runtime/runtime.ts:105-170; src/runtime/runtime.ts:51-58',
    webgpu: raw('createRuntime({ device })', 'host-configured context'),
    webgl2: na('WebGL2 has no tone mapping of a context'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUColorDict.r`',
    covers: ['GPUColorDict.r'],
    evidence:
      'src/runtime/runtime.ts:105-170; src/runtime/gl-draw.ts#recordPass~"clearValue"; src/rhi/webgl2.ts#GlRenderPass.constructor~"clearBufferfv"|blitScreen',
    webgpu: typed('journeys/hdr-target/journey.mjs', 'PassTargets clear is an [r, g, b, a] tuple'),
    webgl2: typed('journeys/hdr-target/journey.mjs', 'PassTargets clear is an [r, g, b, a] tuple'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUColorDict.g`',
    covers: ['GPUColorDict.g'],
    evidence:
      'src/runtime/runtime.ts:105-170; src/runtime/gl-draw.ts#recordPass~"clearValue"; src/rhi/webgl2.ts#GlRenderPass.constructor~"clearBufferfv"|blitScreen',
    webgpu: typed('journeys/hdr-target/journey.mjs', 'PassTargets clear is an [r, g, b, a] tuple'),
    webgl2: typed('journeys/hdr-target/journey.mjs', 'PassTargets clear is an [r, g, b, a] tuple'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUColorDict.b`',
    covers: ['GPUColorDict.b'],
    evidence:
      'src/runtime/runtime.ts:105-170; src/runtime/gl-draw.ts#recordPass~"clearValue"; src/rhi/webgl2.ts#GlRenderPass.constructor~"clearBufferfv"|blitScreen',
    webgpu: typed('journeys/hdr-target/journey.mjs', 'PassTargets clear is an [r, g, b, a] tuple'),
    webgl2: typed('journeys/hdr-target/journey.mjs', 'PassTargets clear is an [r, g, b, a] tuple'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUColorDict.a`',
    covers: ['GPUColorDict.a'],
    evidence:
      'src/runtime/runtime.ts:105-170; src/runtime/gl-draw.ts#recordPass~"clearValue"; src/rhi/webgl2.ts#GlRenderPass.constructor~"clearBufferfv"|blitScreen',
    webgpu: typed('journeys/hdr-target/journey.mjs', 'PassTargets clear is an [r, g, b, a] tuple'),
    webgl2: typed('journeys/hdr-target/journey.mjs', 'PassTargets clear is an [r, g, b, a] tuple'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUColorTargetState.format`',
    covers: ['GPUColorTargetState.format'],
    evidence:
      'src/runtime/program.ts#TargetState; src/runtime/program.ts:277; src/runtime/gl-draw.ts#GlRenderPrograms~"plan.targets"',
    webgpu: andGap(
      typed('src/runtime/runtime.test.ts', 'RenderState.targets'),
      6,
      'stencil8, depth24plus-stencil8 and depth32float-stencil8 have no stencil state; depth16unorm is a depth attachment that read() and readFloats() cannot copy (src/runtime/resources.ts:153-155); BC, ETC2, EAC and ASTC (52 names) have no upload path, and 0050 covers no compressed blocks (changes/0050-texture-write.md:387)',
      637,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no WebGL2 test reads the format; the one test of targetsOf uses the fake WebGPU device (src/runtime/runtime.test.ts:471); RenderState.targets; stencil8, depth24plus-stencil8 and depth32float-stencil8 have no stencil state, and texture() refuses stencil8 (`GlTextureImpl` constructor of `src/runtime/gl-draw.ts`); depth16unorm cannot be copied by read() (src/runtime/resources.ts:153-155); BC, ETC2, EAC and ASTC (52 names) have no upload path (changes/0050-texture-write.md:387); r16, rg16 and rgba16 in unorm and snorm (6 names) and rgb9e5ufloat are refused by texture() (`GlTextureImpl` constructor of `src/runtime/gl-draw.ts`) and are not measured; roadmap row 13b names the tier-1 formats (docs/roadmap.md:228), and the surface text lists the 16-bit snorm names among them (docs/use-typeshade-surface.md:5377-5381)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUColorTargetState.blend`',
    covers: ['GPUColorTargetState.blend'],
    evidence:
      'src/runtime/program.ts#Bindings; src/rhi/webgl2.ts#drawStateOf~"first?.blend"; src/runtime/gl-draw.ts#checkState~"first?.blend"|GlRenderPrograms~"plan.targets"',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets a target blend on WebGPU; RenderState.targets',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no WebGL2 test sets a target blend; the lowering is `drawStateOf` of `src/rhi/webgl2.ts`; RenderState.targets; one blend state for every target; a blend per target has no spelling. Rule 11.11 refuses targets that blend apart (`checkState` of `src/runtime/gl-draw.ts`); the lowering is OES_draw_buffers_indexed; also: refused (Rule 11.11): targets that blend or mask apart',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUColorTargetState.writeMask`',
    covers: ['GPUColorTargetState.writeMask'],
    evidence:
      'src/runtime/program.ts#Bindings; src/rhi/webgl2.ts#drawStateOf~"writeMask ?? 15"|drawStateOf~"(mask & 1)"|setState~"colorMask"; src/runtime/gl-draw.ts#checkState~"writeMask"',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets a write mask on WebGPU; RenderState.targets',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no WebGL2 test sets a write mask; the lowering is `drawStateOf` of `src/rhi/webgl2.ts`; RenderState.targets; one write mask for every target; a mask per target has no spelling. Rule 11.11 refuses targets that mask apart (`checkState` of `src/runtime/gl-draw.ts`); also: refused (Rule 11.11): targets that blend or mask apart',
      645,
    ),
  },
];
