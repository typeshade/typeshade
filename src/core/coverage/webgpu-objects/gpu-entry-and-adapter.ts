import { andGap, gap, na, planned, raw, type Row, typed } from '../model.js';

export const GPU_ENTRY_AND_ADAPTER_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`NavigatorGPU.gpu`',
    covers: ['NavigatorGPU.gpu'],
    evidence: 'src/runtime/runtime.ts:639-644',
    webgpu: typed('src/runtime/runtime.test.ts', 'createRuntime() requests the adapter'),
    webgl2: na('navigator.gpu is the WebGPU entry point; WebGL2 has none'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPU.requestAdapter()`',
    covers: ['GPU.requestAdapter'],
    evidence: 'src/runtime/runtime.ts:644',
    webgpu: andGap(
      typed(
        'journeys/mnist/webgpu.mjs',
        'createRuntime requests the adapter; reflect() reports requiredLanguageFeatures (Rule 10.2)',
      ),
      8,
      'requestAdapter() takes no options; the options have no typed spelling (GPURequestAdapterOptions)',
      639,
    ),
    webgl2: na('the WebGPU adapter request; the WebGL2 tier makes its own context (Rule 11.11)'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPU.getPreferredCanvasFormat()`',
    covers: ['GPU.getPreferredCanvasFormat'],
    evidence: 'src/runtime/runtime.ts:105-170; src/core/host-draw.ts:728-730',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test reads the format it returns; the call layer takes it for a canvas it configures (src/core/host-draw.ts:728-730)',
      645,
    ),
    webgl2: na('the WebGPU canvas format query; WebGL2 has no GPU object'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPU.wgslLanguageFeatures`',
    covers: ['GPU.wgslLanguageFeatures'],
    evidence: 'src/core/passes/required-caps.ts:90-107',
    webgpu: typed(
      'src/compiler/ts/storage-textures.test.ts',
      'reflect().requiredLanguageFeatures (Rule 10.2); the host checks the set',
    ),
    webgl2: na('the WGSL language features; the WebGL2 tier has no WGSL'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUAdapter.features`',
    covers: ['GPUAdapter.features'],
    evidence: 'src/runtime/runtime.ts:644-654',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test stubs navigator.gpu or requestAdapter, and no journey passes a program that needs a feature; features requested from programs; limits are 0051; float32-filterable and float32-blendable have no "use typeshade" spelling (surface §50); depth32float-stencil8, texture-compression-bc, texture-compression-bc-sliced-3d, texture-compression-etc2, texture-compression-astc, texture-compression-astc-sliced-3d, rg11b10ufloat-renderable, texture-component-swizzle and texture-compression-unaligned have no typed spelling; no adapter reachable from this repository reports texture-formats-tier1, and both Chromium builds refuse every tiered format at every storage access mode (docs/use-typeshade-surface.md:5377-5381); texture-formats-tier2 is not measured. Roadmap 13b names the tier-1 formats as shipped (docs/roadmap.md:228). §14 asks whether read_write storage formats are a host-feature capability or refused (docs/language-design.md:1504), and the surface text places them in the same position (docs/use-typeshade-surface.md:5377-5381). Other parts of this enum: depth-clip-control (group 1); timestamp-query (group 4); indirect-first-instance (group 5); the subgroup functions (group 13, docs/language-design.md:1506; docs/roadmap.md:306); subgroup-size-control (group 12, docs/language-design.md:1506; docs/roadmap.md:306); atomic-vec2u-min-max (group 9, docs/roadmap.md:304)',
      645,
    ),
    webgl2: na('the WebGPU adapter features; WebGL2 extensions are rows of table D'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUAdapter.limits`',
    covers: ['GPUAdapter.limits'],
    evidence: 'changes/0051-device-limits.md:257-258; changes/0051-device-limits.md:415-416',
    webgpu: planned('0051'),
    webgl2: gap(
      8,
      '0051 excludes WebGL2 (changes/0051-device-limits.md:415-416); #541 asks for the WebGL2 tier',
      541,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUAdapter.info`',
    covers: ['GPUAdapter.info'],
    evidence: 'src/runtime/runtime.ts:51-58; src/runtime/runtime.ts:644',
    webgpu: andGap(
      raw(
        'createRuntime({ device })',
        'the host requests its own adapter and reads its info; GPUDevice.adapterInfo gives the same fields',
      ),
      8,
      'the runtime keeps no adapter (src/runtime/runtime.ts:644), so no typed spelling reports adapter info',
      639,
    ),
    webgl2: na('the WebGPU adapter; WebGL2 has no adapter object'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUAdapter.requestDevice()`',
    covers: ['GPUAdapter.requestDevice'],
    evidence: 'src/runtime/runtime.ts:644-654',
    webgpu: typed('journeys/mnist/webgpu.mjs', 'features requested from programs; limits are 0051'),
    webgl2: na('the WebGPU device request; the WebGL2 tier makes its own context (Rule 11.11)'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUAdapterInfo.vendor`',
    covers: ['GPUAdapterInfo.vendor'],
    evidence:
      'src/runtime/runtime.ts:230-238; src/core/spec-conformance/fixtures/webgl-extensions.json:572',
    webgpu: andGap(
      raw('Runtime.device', 'rt.device.adapterInfo'),
      8,
      'no typed surface reports adapter info',
      639,
    ),
    webgl2: andGap(
      raw(
        'Runtime.device',
        'the unmasked vendor string of WEBGL_debug_renderer_info, read through the context',
      ),
      8,
      'no typed surface reports adapter info',
      639,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUAdapterInfo.architecture`',
    covers: ['GPUAdapterInfo.architecture'],
    evidence:
      'src/runtime/runtime.ts:230-238; src/core/spec-conformance/fixtures/webgl-extensions.json:572',
    webgpu: andGap(
      raw('Runtime.device', 'rt.device.adapterInfo'),
      8,
      'no typed surface reports adapter info',
      639,
    ),
    webgl2: na(
      'WebGL2 reports no adapter architecture; WEBGL_debug_renderer_info gives the vendor and renderer strings only',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUAdapterInfo.device`',
    covers: ['GPUAdapterInfo.device'],
    evidence:
      'src/runtime/runtime.ts:230-238; src/core/spec-conformance/fixtures/webgl-extensions.json:572',
    webgpu: andGap(
      raw('Runtime.device', 'rt.device.adapterInfo'),
      8,
      'no typed surface reports adapter info',
      639,
    ),
    webgl2: andGap(
      raw(
        'Runtime.device',
        'the unmasked renderer string of WEBGL_debug_renderer_info, read through the context',
      ),
      8,
      'no typed surface reports adapter info',
      639,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUAdapterInfo.description`',
    covers: ['GPUAdapterInfo.description'],
    evidence:
      'src/runtime/runtime.ts:230-238; src/core/spec-conformance/fixtures/webgl-extensions.json:572',
    webgpu: andGap(
      raw('Runtime.device', 'rt.device.adapterInfo'),
      8,
      'no typed surface reports adapter info',
      639,
    ),
    webgl2: na(
      'WebGL2 reports no adapter description; WEBGL_debug_renderer_info gives the vendor and renderer strings only',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUAdapterInfo.subgroupMinSize`',
    covers: ['GPUAdapterInfo.subgroupMinSize'],
    evidence: 'src/runtime/runtime.ts:230-238',
    webgpu: andGap(
      raw('Runtime.device', 'rt.device.adapterInfo'),
      13,
      'no typed spelling of a subgroup size; subgroup operations are After 1.0 (docs/roadmap.md:306; docs/language-design.md:1506)',
      536,
    ),
    webgl2: na('a subgroup is one invocation on WebGL2 (Rule 11.21); no subgroup size'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUAdapterInfo.subgroupMaxSize`',
    covers: ['GPUAdapterInfo.subgroupMaxSize'],
    evidence: 'src/runtime/runtime.ts:230-238',
    webgpu: andGap(
      raw('Runtime.device', 'rt.device.adapterInfo'),
      13,
      'no typed spelling of a subgroup size; subgroup operations are After 1.0 (docs/roadmap.md:306; docs/language-design.md:1506)',
      536,
    ),
    webgl2: na('a subgroup is one invocation on WebGL2 (Rule 11.21); no subgroup size'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUAdapterInfo.isFallbackAdapter`',
    covers: ['GPUAdapterInfo.isFallbackAdapter'],
    evidence:
      'src/runtime/runtime.ts:230-238; src/core/spec-conformance/fixtures/webgl-extensions.json:572',
    webgpu: andGap(
      raw('Runtime.device', 'rt.device.adapterInfo'),
      8,
      'no typed surface reports adapter info',
      639,
    ),
    webgl2: na(
      'WebGL2 has no fallback adapter; WEBGL_debug_renderer_info gives the vendor and renderer strings only',
    ),
  },
];
