import { andGap, gap, planned, raw, type Row, typed } from '../model.js';

export const PIXEL_STORE_AND_SAMPLERS_ROWS: readonly Row[] = [
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Pixel store: `pixelStorei` (`UNPACK_FLIP_Y_WEBGL`, `UNPACK_PREMULTIPLY_ALPHA_WEBGL`, alignments)',
    covers: ['webgl:WebGLRenderingContextBase.pixelStorei'],
    evidence:
      'changes/0050-texture-write.md:148-152 (the call layer sets both for an image upload); src/core/gl-image.ts:54-74; src/rhi/webgl2.ts:742, 576',
    note: 'WebGPU spells flipY and premultipliedAlpha on copyExternalImageToTexture, a copy member of table A; the typed route here is the call-layer image upload',
    webgpu: typed('scripts/user-journey.ts', 'call layer; also: planned (0050)'),
    webgl2: andGap(
      typed('scripts/user-journey.ts', 'call-layer image upload'),
      6,
      'write and mipmaps: 0050 is WebGPU only (changes/0050-texture-write.md:323-325, 331)',
      637,
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: '`UNPACK_COLORSPACE_CONVERSION_WEBGL` (pixel store constant)',
    covers: ['webgl:WebGLRenderingContextBase.UNPACK_COLORSPACE_CONVERSION_WEBGL'],
    evidence:
      'changes/0050-texture-write.md:148-152 (the call layer sets flipY and premultiplyAlpha for an image upload, not the colour-space conversion); node_modules/@webgpu/types/dist/index.d.ts:864-886 (GPUCopyExternalImageDestInfo.colorSpace); src/core/host-entry.ts:945 (the copy passes no colorSpace)',
    note: "declared on WebGLRenderingContextBase (WebGL 1.0); flagged WebGL2-only by changes/0059-capability-coverage.md:221-226, item 4; table A's GPUCopyExternalImageDestInfo.colorSpace (a WebGPU member) has WebGL2 gap group 6, a different key",
    webgpu: planned(
      '0050',
      'GPUCopyExternalImageDestInfo.colorSpace: changes/0050-texture-write.md:150 fixes "srgb" in the image copy and exposes no choice',
    ),
    webgl2: gap(11, 'no typed spelling; WebGL2-only capability; no door yet (Rule 11.16)', 642),
    webgl2Only: { door: 'none' },
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Samplers: `createSampler`, `samplerParameteri/f`, `bindSampler` (filter, wrap, compare, LOD)',
    covers: [
      'webgl:WebGL2RenderingContextBase.bindSampler',
      'webgl:WebGL2RenderingContextBase.createSampler',
      'webgl:WebGL2RenderingContextBase.deleteSampler',
      'webgl:WebGL2RenderingContextBase.samplerParameterf',
      'webgl:WebGL2RenderingContextBase.samplerParameteri',
    ],
    evidence: 'src/runtime/resources.ts:74-91; src/rhi/webgl2.ts (samplerParameteri)',
    note: 'filter, address and compare are typed; the LOD clamps have no typed form; anisotropy is its own row',
    webgpu: andGap(
      typed(
        'journeys/engine/engine.mjs',
        'also: raw (GPUSampler): a host GPUSampler that carries the clamps is bound as is',
      ),
      6,
      'lodMinClamp and lodMaxClamp have no typed form',
      637,
    ),
    webgl2: andGap(
      typed(
        'src/core/gl-compute.test.ts',
        'also: raw (WebGLSampler): a host WebGLSampler that carries the clamps is bound as is',
      ),
      6,
      'the LOD clamps have no typed form',
      637,
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: '`EXT_texture_filter_anisotropic`',
    covers: ['webgl:EXT_texture_filter_anisotropic'],
    evidence:
      'src/runtime/resources.ts:298-300 (a host GPUSampler is bound as is); src/runtime/gl-draw.ts:977-984 (samplerOf takes a WebGLSampler)',
    note: 'a host sampler carries the anisotropy: a host GPUSampler on WebGPU, a host WebGLSampler on WebGL2',
    webgpu: andGap(
      raw('GPUSampler', 'a host GPUSampler with maxAnisotropy is bound as is'),
      6,
      'maxAnisotropy has no typed sampler option',
      637,
    ),
    webgl2: andGap(
      raw('WebGLSampler', 'a host WebGLSampler is bound as is; the host sets the anisotropy on it'),
      6,
      'no typed sampler option for anisotropy',
      637,
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Float texture filtering and rendering: `OES_texture_float_linear`, `EXT_color_buffer_float`, `EXT_color_buffer_half_float`, `EXT_float_blend`',
    covers: [
      'webgl:EXT_color_buffer_float',
      'webgl:EXT_color_buffer_half_float',
      'webgl:EXT_float_blend',
      'webgl:OES_texture_float_linear',
    ],
    evidence:
      'src/rhi/webgl2.ts:256-261 (turns on three of the four); src/core/backends/glsl.ts:604-607; docs/use-typeshade-surface.md:5916-5917 (floatRenderTarget, float32Blend and float32Filterable are still unspellable)',
    note: 'the runtime turns on EXT_color_buffer_float, EXT_color_buffer_half_float and OES_texture_float_linear; the three declarable capabilities (floatRenderTarget, float32Filterable, float32Blend) have no "use typeshade" spelling',
    webgpu: gap(6, 'float32-filterable and float32-blendable are not spellable', 637),
    webgl2: andGap(
      typed('journeys/hdr-target/journey.mjs', 'EXT_color_buffer_float'),
      6,
      'EXT_color_buffer_half_float and OES_texture_float_linear are turned on with no spelling; EXT_float_blend has none',
      637,
    ),
  },
];
