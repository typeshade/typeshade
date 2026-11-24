import { andGap, gap, na, planned, raw, refused, type Row, typed } from '../model.js';

export const TEXTURE_AND_NAVIGATORS_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUTexture.createView()`',
    covers: ['GPUTexture.createView'],
    evidence: 'src/runtime/resources.ts#Texture.texture',
    webgpu: andGap(
      raw('Texture.texture', 'Texture.texture.createView()'),
      6,
      'no typed spelling makes a layered or mip view',
      637,
    ),
    webgl2: na('a GPUTextureView; WebGL2 has no texture view object'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUTexture.destroy()`',
    covers: ['GPUTexture.destroy'],
    evidence:
      'src/runtime/resources.ts#Texture.destroy; src/runtime/gl-draw.ts#GlTextureImpl.destroy; examples/hosts/host-program/host.ts:25',
    webgpu: typed(
      'scripts/user-journey.ts',
      'Texture.destroy(): the host-program example destroys its target (examples/hosts/host-program/host.ts:25)',
    ),
    webgl2: typed(
      'scripts/user-journey.ts',
      'Texture.destroy(): the same example on WebGL2 queues deleteTexture (`GlTextureImpl.destroy` of `src/runtime/gl-draw.ts`); the journey shows the call runs, not that the texture is deleted',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUTexture.width`',
    covers: ['GPUTexture.width'],
    evidence: 'src/runtime/resources.ts#Texture.width; src/runtime/gl-draw.ts#GlTextureImpl.width',
    webgpu: typed(
      'src/runtime/runtime.test.ts',
      'Texture.width; also: Texture.texture is the GPUTexture (raw)',
    ),
    webgl2: typed(
      'scripts/compile-gate.ts',
      'Texture: format, width, height, resize, read, readFloats, destroy',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUTexture.height`',
    covers: ['GPUTexture.height'],
    evidence:
      'src/runtime/resources.ts#Texture.height; src/runtime/gl-draw.ts#GlTextureImpl.height',
    webgpu: typed(
      'src/runtime/runtime.test.ts',
      'Texture.height; also: Texture.texture is the GPUTexture (raw)',
    ),
    webgl2: typed(
      'scripts/compile-gate.ts',
      'Texture: format, width, height, resize, read, readFloats, destroy',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUTexture.depthOrArrayLayers`',
    covers: ['GPUTexture.depthOrArrayLayers'],
    evidence:
      'src/runtime/resources.ts#TextureOptions; src/runtime/gl-draw.ts#GlTextureImpl.constructor',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test passes a three-value size to rt.texture on WebGPU; the typed surface is TextureOptions.size[2]',
      645,
    ),
    webgl2: typed(
      'src/runtime/runtime.test.ts',
      'one layer, size: [width, height]; also: refused (Rule 11.11) for more than one layer or a 3d texture (`GlTextureImpl` constructor of `src/runtime/gl-draw.ts`); the input key GPUExtent3DDict.depthOrArrayLayers takes the same refusal (Rule 11.11)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUTexture.mipLevelCount`',
    covers: ['GPUTexture.mipLevelCount'],
    evidence:
      'changes/0050-texture-write.md:38; changes/0050-texture-write.md:58; changes/0050-texture-write.md:331',
    webgpu: planned('0050'),
    webgl2: gap(
      6,
      'the mip level count of a texture: not supported yet on the WebGL2 tier; the typed form is not written (Rule 11.11); 0050 leaves the WebGL2 tier unchanged (changes/0050-texture-write.md:331)',
      637,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUTexture.sampleCount`',
    covers: ['GPUTexture.sampleCount'],
    evidence:
      'src/runtime/resources.ts#TextureOptions; src/runtime/gl-draw.ts#GlTextureImpl.constructor',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test passes sampleCount to rt.texture on WebGPU; the typed surface is TextureOptions.sampleCount (src/runtime/resources.ts:25, 220); roadmap 13 names the multisampled texture type texture_2d_ms (docs/roadmap.md:226)',
      645,
    ),
    webgl2: refused(
      'Rule 11.11',
      'omit sampleCount (one sample)',
      'the WebGL2 tier refuses a multisampled texture',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUTexture.dimension`',
    covers: ['GPUTexture.dimension'],
    evidence:
      'src/runtime/resources.ts#TextureOptions.dimension; src/runtime/resources.ts:227; src/runtime/gl-draw.ts#GlTextureImpl.constructor',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test passes dimension to rt.texture; TextureOptions.dimension (src/runtime/resources.ts:23, 227): the typed Texture creates a texture of this dimension; the runtime makes no 1d texture (src/runtime/resources.ts:23); texture_1d is shipped as a WGSL spelling (roadmap 12, docs/roadmap.md:225); roadmap 13c names storage 1d textures (docs/roadmap.md:229)',
      645,
    ),
    webgl2: typed(
      'src/runtime/runtime.test.ts',
      '2d textures of one layer; also: refused (Rule 10.5) for 1d; refused (Rule 11.11) for 3d and for more than one layer (`GlTextureImpl` constructor of `src/runtime/gl-draw.ts`)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUTexture.format`',
    covers: ['GPUTexture.format'],
    evidence:
      'src/runtime/resources.ts#TextureOptions.format; src/runtime/gl-draw.ts#GlTextureImpl.constructor; src/runtime/resources.ts#layoutOf; src/runtime/gl-draw.ts#GlTextureImpl.constructor; changes/0050-texture-write.md:387',
    webgpu: andGap(
      typed(
        'src/runtime/runtime.test.ts',
        'Texture.format; also: Texture.texture is the GPUTexture (raw)',
      ),
      6,
      'stencil8, depth24plus-stencil8 and depth32float-stencil8 have no stencil state; depth16unorm is a depth attachment that read() and readFloats() cannot copy (src/runtime/resources.ts:153-155); BC, ETC2, EAC and ASTC (52 names) have no upload path, and 0050 covers no compressed blocks (changes/0050-texture-write.md:387)',
      637,
    ),
    webgl2: andGap(
      typed(
        'src/runtime/runtime.test.ts',
        'Texture: format, width, height, resize, read, readFloats, destroy',
      ),
      6,
      'stencil8, depth24plus-stencil8 and depth32float-stencil8 have no stencil state, and texture() refuses stencil8 (`GlTextureImpl` constructor of `src/runtime/gl-draw.ts`); depth16unorm cannot be copied by read() (src/runtime/resources.ts:153-155); BC, ETC2, EAC and ASTC (52 names) have no upload path (changes/0050-texture-write.md:387); r16, rg16 and rgba16 in unorm and snorm (6 names) and rgb9e5ufloat are refused by texture() (`GlTextureImpl` constructor of `src/runtime/gl-draw.ts`) and are not measured; roadmap row 13b names the tier-1 formats (docs/roadmap.md:228), and the surface text lists the 16-bit snorm names among them (docs/use-typeshade-surface.md:5377-5381)',
      637,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUTexture.usage`',
    covers: ['GPUTexture.usage'],
    evidence: 'src/runtime/resources.ts:220-233',
    webgpu: typed(
      'journeys/engine/engine.mjs',
      'fixed by the runtime; storage adds STORAGE_BINDING',
    ),
    webgl2: na('WebGPU-only concept: WebGL2 has no texture usage flags'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUTexture.textureBindingViewDimension`',
    covers: ['GPUTexture.textureBindingViewDimension'],
    evidence: 'src/runtime/resources.ts:220-233; src/runtime/program.ts:1842',
    webgpu: andGap(
      raw(
        'GPUTextureView',
        'the host passes a view with its own view dimension as a binding (src/runtime/program.ts:1842)',
      ),
      6,
      'not in TextureOptions; a typed texture takes no binding view dimension',
      637,
    ),
    webgl2: na('WebGL2 has no texture view object'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface',
    name: '`GPUTextureView`',
    covers: ['GPUTextureView'],
    evidence:
      'src/runtime/runtime.ts:105-170; src/runtime/program.ts:1839-1840; src/runtime/runtime.ts#FrameImpl.submit',
    webgpu: andGap(
      raw('GPUTextureView', 'a view the host made binds and attaches'),
      6,
      'no typed view with this member',
      637,
    ),
    webgl2: na('WebGL2 has no texture view object'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUUncapturedErrorEvent.error`',
    covers: ['GPUUncapturedErrorEvent.error'],
    evidence: 'src/runtime/runtime.ts:230-238',
    webgpu: andGap(
      raw('Runtime.device', 'rt.device'),
      8,
      'no typed surface reports an uncaptured error',
      639,
    ),
    webgl2: na('a WebGPU device event; the WebGL2 tier has no uncapturederror event'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface',
    name: '`GPUValidationError`',
    covers: ['GPUValidationError'],
    evidence: 'src/runtime/runtime.ts:500-511; src/rhi/webgpu.ts:442-445',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test provokes a validation error through Frame.submit(); the name GPUValidationError appears in no test; the runtime rejects with a plain Error (src/runtime/runtime.ts:511)',
      645,
    ),
    webgl2: na('the WebGPU validation error; WebGL2 has no error scope'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface',
    name: '`Navigator`',
    covers: ['Navigator'],
    evidence: 'src/runtime/runtime.ts:639-644',
    webgpu: typed('src/runtime/runtime.test.ts', 'navigator.gpu through NavigatorGPU.gpu'),
    webgl2: na('navigator.gpu is the WebGPU entry point; WebGL2 has none'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface',
    name: '`WorkerNavigator`',
    covers: ['WorkerNavigator'],
    evidence: 'src/runtime/runtime.ts:639-644',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test runs the runtime in a worker; navigator.gpu is read through NavigatorGPU.gpu',
      645,
    ),
    webgl2: na('navigator.gpu is the WebGPU entry point; WebGL2 has none'),
  },
];
