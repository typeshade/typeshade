import { andGap, gap, na, planned, raw, refused, type Row, typed } from '../model.js';

export const TEXTURE_DESCRIPTOR_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTextureBindingLayout.sampleType`',
    covers: ['GPUTextureBindingLayout.sampleType'],
    evidence: 'src/runtime/program.ts:1328-1381',
    webgpu: typed(
      'src/runtime/runtime.test.ts',
      'sampleType, viewDimension, multisampled from the manifest',
    ),
    webgl2: na(
      'WebGL2 has no bind group layout; its bindings are set by name. The binding kind itself is typed: see GPUTextureSampleType.',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTextureBindingLayout.viewDimension`',
    covers: ['GPUTextureBindingLayout.viewDimension'],
    evidence: 'src/runtime/program.ts:1328-1381',
    webgpu: typed(
      'src/runtime/runtime.test.ts',
      'sampleType, viewDimension, multisampled from the manifest',
    ),
    webgl2: na(
      'WebGL2 has no bind group layout; its bindings are set by name. The binding kind itself is typed: see GPUTextureViewDimension.',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTextureBindingLayout.multisampled`',
    covers: ['GPUTextureBindingLayout.multisampled'],
    evidence: 'src/runtime/program.ts:1328-1381',
    webgpu: typed(
      'src/runtime/runtime.test.ts',
      'sampleType, viewDimension, multisampled from the manifest',
    ),
    webgl2: na('WebGL2 has no bind group layout; its bindings are set by name'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTextureDescriptor.size`',
    covers: ['GPUTextureDescriptor.size'],
    evidence:
      'src/runtime/resources.ts:17-32, 218-231; src/rhi/webgpu.ts:286-298; src/runtime/gl-draw.ts:161-168; src/rhi/webgl2.ts:1336',
    webgpu: typed(
      'src/runtime/runtime.test.ts',
      'size, format, dimension (2d, 3d), sampleCount and storage usage',
    ),
    webgl2: typed(
      'scripts/compile-gate.ts',
      'also: array layers and a 3D depth are refused (Rule 11.11, src/runtime/gl-draw.ts:161-164); typed for size [width, height]',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTextureDescriptor.mipLevelCount`',
    covers: ['GPUTextureDescriptor.mipLevelCount'],
    evidence: 'changes/0050-texture-write.md:38, 58, 79',
    webgpu: planned('0050'),
    webgl2: gap(
      6,
      'texture() on WebGL2 takes size and format only (src/runtime/gl-draw.ts:158-159); 0050 names the WebGPU target only (changes/0050-texture-write.md:331)',
      637,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTextureDescriptor.sampleCount`',
    covers: ['GPUTextureDescriptor.sampleCount'],
    evidence: 'src/runtime/resources.ts:17-32, 220-233; src/runtime/gl-draw.ts:165-168',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): the only rt.texture call with a sampleCount is the WebGL2 refusal (src/runtime/runtime.test.ts:1884); roadmap 13 names the multisampled load (docs/roadmap.md:226); size, format, dimension (2d, 3d), sampleCount and storage usage',
      645,
    ),
    webgl2: refused(
      'Rule 11.11',
      'omit sampleCount (one sample)',
      'a multisampled texture is not supported yet on the WebGL2 tier (src/runtime/gl-draw.ts:165-168)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTextureDescriptor.dimension`',
    covers: ['GPUTextureDescriptor.dimension'],
    evidence: 'src/runtime/resources.ts:23; src/runtime/gl-draw.ts:161-168',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no rt.texture call on WebGPU gives a dimension (src/runtime/resources.ts:227); 2d and 3d; the runtime makes no 1d texture (src/runtime/resources.ts:23); texture_1d is shipped as a WGSL spelling (roadmap 12, docs/roadmap.md:225); roadmap 13c names storage 1d textures (docs/roadmap.md:229)',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): the WebGL2 tier refuses a dimension other than 2d with layers (src/runtime/gl-draw.ts:161), and no test reads the member; also: 1d is refused (Rule 10.5); 3d is refused (Rule 11.11, src/runtime/gl-draw.ts:161-164); typed for 2d',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTextureDescriptor.format`',
    covers: ['GPUTextureDescriptor.format'],
    evidence:
      'src/runtime/resources.ts:17-32, 220-233; src/runtime/gl-draw.ts:161-168; src/rhi/webgl2.ts:1336; src/rhi/webgl2.ts:70-71, 211; src/runtime/gl-draw.ts:170-172',
    webgpu: andGap(
      typed(
        'src/runtime/runtime.test.ts',
        'size, format, dimension (2d, 3d), sampleCount and storage usage',
      ),
      6,
      'stencil8, depth24plus-stencil8 and depth32float-stencil8 have no stencil state; depth16unorm is a depth attachment that read() and readFloats() cannot copy (src/runtime/resources.ts:153-155); BC, ETC2, EAC and ASTC (52 names) have no upload path, and 0050 covers no compressed blocks (changes/0050-texture-write.md:387)',
      637,
    ),
    webgl2: andGap(
      typed(
        'journeys/hdr-target/journey.mjs',
        'typed for the formats formatOf accepts (src/rhi/webgl2.ts:211; src/runtime/gl-draw.ts:170-172)',
      ),
      6,
      'stencil8, depth24plus-stencil8 and depth32float-stencil8 have no stencil state, and texture() refuses stencil8 (src/runtime/gl-draw.ts:172); depth16unorm cannot be copied by read() (src/runtime/resources.ts:153-155); BC, ETC2, EAC and ASTC (52 names) have no upload path (changes/0050-texture-write.md:387); r16, rg16 and rgba16 in unorm and snorm (6 names) and rgb9e5ufloat are refused by texture() (src/runtime/gl-draw.ts:172) and are not measured; roadmap row 13b names the tier-1 formats (docs/roadmap.md:228), and the surface text lists the 16-bit snorm names among them (docs/use-typeshade-surface.md:5377-5381)',
      637,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTextureDescriptor.usage`',
    covers: ['GPUTextureDescriptor.usage'],
    evidence: 'src/runtime/resources.ts:220-233; src/runtime/gl-draw.ts:161-169',
    webgpu: typed(
      'journeys/hdr-target/journey.mjs',
      'the usages the runtime sets: render attachment, texture binding, copy when one sample, storage when storage is true (src/runtime/resources.ts:221-223)',
    ),
    webgl2: na(
      'WebGL2 has no texture usage flags; storage: true asks for nothing more (src/runtime/gl-draw.ts:169)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTextureDescriptor.viewFormats`',
    covers: ['GPUTextureDescriptor.viewFormats'],
    evidence: 'src/runtime/resources.ts:218-231; src/runtime/program.ts:1839-1840',
    webgpu: andGap(
      raw(
        'GPUTextureView',
        'the host makes a GPUTexture with view formats and passes a view in another format as a binding (src/runtime/program.ts:1842)',
      ),
      6,
      'not in TextureOptions; a typed texture takes no view formats',
      637,
    ),
    webgl2: na('WebGL2 views a texture only in its own format'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTextureDescriptor.textureBindingViewDimension`',
    covers: ['GPUTextureDescriptor.textureBindingViewDimension'],
    evidence: 'src/runtime/resources.ts:218-231; src/runtime/program.ts:1839-1840',
    webgpu: andGap(
      raw(
        'GPUTextureView',
        'the host passes a view with its own view dimension as a binding (src/runtime/program.ts:1842)',
      ),
      6,
      'not in TextureOptions; a typed texture takes no binding view dimension',
      637,
    ),
    webgl2: na('WebGL2 binds a texture by its target, not by a view dimension'),
  },
];
