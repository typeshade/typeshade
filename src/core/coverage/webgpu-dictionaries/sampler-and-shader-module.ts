import { andGap, gap, na, raw, type Row, typed } from '../model.js';

export const SAMPLER_AND_SHADER_MODULE_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUSamplerDescriptor.addressModeU`',
    covers: ['GPUSamplerDescriptor.addressModeU'],
    evidence:
      'src/runtime/resources.ts#SamplerOptions|Sampler|ADDRESS|SamplerImpl; src/rhi/webgpu.ts:350-352; src/rhi/webgl2.ts#GlDevice.createSampler~"addressModeU"',
    webgpu: andGap(
      typed('scripts/compile-gate.ts', 'filter, address (one word for U, V and W), compare'),
      6,
      'one address for every axis; per-axis address modes have no spelling (src/runtime/resources.ts:78-79)',
      637,
    ),
    webgl2: andGap(
      typed('scripts/compile-gate.ts', 'filter, address (one word for U, V and W), compare'),
      6,
      'one address for every axis; per-axis address modes have no spelling (src/runtime/resources.ts:78-79)',
      637,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUSamplerDescriptor.addressModeV`',
    covers: ['GPUSamplerDescriptor.addressModeV'],
    evidence:
      'src/runtime/resources.ts#SamplerOptions|Sampler|ADDRESS|SamplerImpl; src/rhi/webgpu.ts:350-352; src/rhi/webgl2.ts#GlDevice.createSampler~"addressModeV"',
    webgpu: andGap(
      typed('scripts/user-journey.ts', 'filter, address (one word for U, V and W), compare'),
      6,
      'one address for every axis; per-axis address modes have no spelling (src/runtime/resources.ts:78-79)',
      637,
    ),
    webgl2: andGap(
      typed('scripts/user-journey.ts', 'filter, address (one word for U, V and W), compare'),
      6,
      'one address for every axis; per-axis address modes have no spelling (src/runtime/resources.ts:78-79)',
      637,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUSamplerDescriptor.addressModeW`',
    covers: ['GPUSamplerDescriptor.addressModeW'],
    evidence:
      'src/runtime/resources.ts#SamplerImpl.constructor; src/rhi/webgl2.ts#GlDevice.createSampler~"addressModeW"',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test samples a third coordinate through a wrap mode (src/runtime/resources.ts:311); address applies to every axis; one address for every axis; per-axis address modes have no spelling (src/runtime/resources.ts:78-79)',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no assertion depends on WRAP_R (`createSampler` of `GlDevice` in `src/rhi/webgl2.ts`); address applies to every axis; one address for every axis; per-axis address modes have no spelling (src/runtime/resources.ts:78-79)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUSamplerDescriptor.magFilter`',
    covers: ['GPUSamplerDescriptor.magFilter'],
    evidence:
      'src/runtime/resources.ts#SamplerOptions|Sampler|ADDRESS|SamplerImpl; src/rhi/webgpu.ts:350-352; src/rhi/webgl2.ts#GlDevice.createSampler~"magFilter"',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): every sample is at a texel centre or a uniform clear, so nearest and linear give one frame; filter, address (one word for U, V and W), compare; one filter for mag, min and mip; separate filters have no spelling (src/runtime/resources.ts:303-308)',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): the WebGL2 draws sample texel centres, where nearest and linear return the same texels; filter, address (one word for U, V and W), compare; one filter for mag, min and mip; separate filters have no spelling (src/runtime/resources.ts:303-308)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUSamplerDescriptor.minFilter`',
    covers: ['GPUSamplerDescriptor.minFilter'],
    evidence:
      'src/runtime/resources.ts#SamplerOptions|Sampler|ADDRESS|SamplerImpl; src/rhi/webgpu.ts:350-352; src/rhi/webgl2.ts#GlDevice.createSampler~"minFilter"',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): every sample is at a texel centre or a uniform clear, so nearest and linear give one frame; filter, address (one word for U, V and W), compare; one filter for mag, min and mip; separate filters have no spelling (src/runtime/resources.ts:303-308)',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): at texel centres nearest and linear return the same texels; no assertion tells them apart; filter, address (one word for U, V and W), compare; one filter for mag, min and mip; separate filters have no spelling (src/runtime/resources.ts:303-308)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUSamplerDescriptor.mipmapFilter`',
    covers: ['GPUSamplerDescriptor.mipmapFilter'],
    evidence:
      'src/runtime/resources.ts#SamplerOptions|Sampler|ADDRESS|SamplerImpl; src/rhi/webgl2.ts#GlDevice.createSampler (createSampler never reads mipmapFilter); changes/0050-texture-write.md:323-325, 331',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): rt.texture makes one level, so the mip filter cannot change a frame (src/runtime/resources.ts:308); filter, address (one word for U, V and W), compare; one filter for mag, min and mip; separate filters have no spelling (src/runtime/resources.ts:303-308)',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no WebGL2 texture a test samples has mip levels (`createSampler` of `GlDevice` in `src/rhi/webgl2.ts`); filter, address (one word for U, V and W), compare; a mip chain to filter over: 0050 is WebGPU only (changes/0050-texture-write.md:323-325, 331)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUSamplerDescriptor.lodMinClamp`',
    covers: ['GPUSamplerDescriptor.lodMinClamp'],
    evidence:
      'src/runtime/resources.ts#SamplerImpl; src/rhi/webgl2.ts#GlDevice.fromNative~"WebGLSampler"',
    webgpu: andGap(
      raw(
        'GPUSampler',
        'the host makes a GPUSampler with the clamp; a host GPUSampler is bound as is',
      ),
      6,
      'lodMinClamp has no typed sampler option; SamplerOptions has none',
      637,
    ),
    webgl2: andGap(
      raw(
        'WebGLSampler',
        'the host sets the clamp on a WebGLSampler; a host WebGLSampler is bound as is',
      ),
      6,
      'lodMinClamp has no typed sampler option',
      637,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUSamplerDescriptor.lodMaxClamp`',
    covers: ['GPUSamplerDescriptor.lodMaxClamp'],
    evidence:
      'src/runtime/resources.ts#SamplerImpl; src/rhi/webgl2.ts#GlDevice.fromNative~"WebGLSampler"',
    webgpu: andGap(
      raw(
        'GPUSampler',
        'the host makes a GPUSampler with the clamp; a host GPUSampler is bound as is',
      ),
      6,
      'lodMaxClamp has no typed sampler option; SamplerOptions has none',
      637,
    ),
    webgl2: andGap(
      raw(
        'WebGLSampler',
        'the host sets the clamp on a WebGLSampler; a host WebGLSampler is bound as is',
      ),
      6,
      'lodMaxClamp has no typed sampler option',
      637,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUSamplerDescriptor.compare`',
    covers: ['GPUSamplerDescriptor.compare'],
    evidence:
      'src/runtime/resources.ts#SamplerOptions|Sampler|ADDRESS|SamplerImpl; src/rhi/webgpu.ts:350-352; src/rhi/webgl2.ts#GlDevice.createSampler~"TEXTURE_COMPARE_MODE"',
    webgpu: typed(
      'journeys/engine/engine.mjs',
      'filter, address (one word for U, V and W), compare',
    ),
    webgl2: typed('scripts/compile-gate.ts', 'filter, address (one word for U, V and W), compare'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUSamplerDescriptor.maxAnisotropy`',
    covers: ['GPUSamplerDescriptor.maxAnisotropy'],
    evidence:
      'src/runtime/resources.ts#SamplerImpl; src/rhi/webgl2.ts#GlDevice.fromNative~"WebGLSampler"',
    webgpu: andGap(
      raw('GPUSampler', 'a host GPUSampler with maxAnisotropy is bound as is'),
      6,
      'maxAnisotropy has no typed sampler option',
      637,
    ),
    webgl2: andGap(
      raw('WebGLSampler', 'a host WebGLSampler is bound as is; the host sets the anisotropy on it'),
      6,
      'maxAnisotropy has no typed sampler option; the host reaches EXT_texture_filter_anisotropic with getExtension',
      637,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUShaderModuleCompilationHint.entryPoint`',
    covers: ['GPUShaderModuleCompilationHint.entryPoint'],
    evidence: 'node_modules/@webgpu/types/dist/index.d.ts:1591',
    webgpu: na('a hint; the runtime creates explicit layouts'),
    webgl2: na('a hint; WebGL2 has no shader module'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUShaderModuleCompilationHint.layout`',
    covers: ['GPUShaderModuleCompilationHint.layout'],
    evidence: 'node_modules/@webgpu/types/dist/index.d.ts:1598',
    webgpu: na('a hint; the runtime creates explicit layouts'),
    webgl2: na('a hint; WebGL2 has no shader module'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUShaderModuleDescriptor.code`',
    covers: ['GPUShaderModuleDescriptor.code'],
    evidence: 'src/runtime/program.ts#ProgramImpl.constructor; src/rhi/webgpu.ts:354-356',
    webgpu: typed('src/runtime/runtime.test.ts', "the manifest's WGSL (Rule 11.10)"),
    webgl2: na("WebGL2 has no WGSL shader module; each stage is the manifest's GLSL"),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUShaderModuleDescriptor.compilationHints`',
    covers: ['GPUShaderModuleDescriptor.compilationHints'],
    evidence: 'src/runtime/program.ts#ProgramImpl.constructor; src/rhi/webgpu.ts:354-356',
    webgpu: na('a hint; the runtime sets none, as for GPUShaderModuleCompilationHint'),
    webgl2: na('a hint; WebGL2 has no shader module hint'),
  },
];
