import { andGap, gap, na, raw, refused, type Row, typed } from '../model.js';

export const TEXTURES_ROWS: readonly Row[] = [
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Textures 2D: `createTexture`, `bindTexture`, `activeTexture`, `texStorage2D`, `texImage2D`, `texSubImage2D`, `copyTexImage2D`, `copyTexSubImage2D`, `generateMipmap`, `texParameteri/f`, `deleteTexture`',
    covers: [
      'webgl:WebGLRenderingContextBase.activeTexture',
      'webgl:WebGLRenderingContextBase.bindTexture',
      'webgl:WebGLRenderingContextBase.copyTexImage2D',
      'webgl:WebGLRenderingContextBase.copyTexSubImage2D',
      'webgl:WebGLRenderingContextBase.createTexture',
      'webgl:WebGLRenderingContextBase.deleteTexture',
      'webgl:WebGLRenderingContextBase.generateMipmap',
      'webgl:WebGLRenderingContextBase.texParameterf',
      'webgl:WebGLRenderingContextBase.texParameteri',
      'webgl:WebGL2RenderingContextBase.texStorage2D',
      'webgl:WebGL2RenderingContextOverloads.texImage2D',
      'webgl:WebGL2RenderingContextOverloads.texSubImage2D',
    ],
    evidence:
      'src/rhi/webgl2.ts#bindTexture~"activeTexture"|dataTexture~"texSubImage2D"|GlDevice.writeTexture~"texSubImage2D"|GlDevice.createTexture; src/runtime/gl-draw.ts#GlTextureImpl~"createTexture"; src/runtime/gl-draw.ts#GlDrawing.guard~"writeTexture" (the _fp64 guard texture, written once); changes/0050-texture-write.md',
    note: 'rt.texture() makes a 2D texture in any WebGPU-named format WebGL2 has; an upload from the host and mipmaps are 0050 on WebGPU only; copies between textures and texParameter (LOD, compare) have no typed form. The sRGB formats (EXT_sRGB is core in WebGL2; `specOf` of `src/rhi/webgl2.ts`) and the cube faces are covered by this row; the WebGL2 route to a cube texture is in the Textures 3D / array row',
    webgpu: andGap(
      typed(
        'scripts/compile-gate.ts',
        'also: planned (0050: write, mipmaps); raw (copyTextureToTexture on Frame.encoder)',
      ),
      6,
      'rt.texture() has no cube option; roadmap row 12 names texture_cube (docs/roadmap.md:225)',
      637,
    ),
    webgl2: andGap(
      typed('scripts/compile-gate.ts'),
      6,
      'copyTexSubImage2D and texParameter have no typed form; write and mipmaps: 0050 is WebGPU only (changes/0050-texture-write.md:323-325, 331)',
      637,
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: '`LUMINANCE`, `ALPHA`, `LUMINANCE_ALPHA` (texture formats)',
    covers: [
      'webgl:WebGLRenderingContextBase.ALPHA',
      'webgl:WebGLRenderingContextBase.LUMINANCE',
      'webgl:WebGLRenderingContextBase.LUMINANCE_ALPHA',
    ],
    evidence: 'src/rhi/webgl2.ts#specOf (specOf: no luminance or alpha case)',
    note: 'declared on WebGLRenderingContextBase (WebGL 1.0); flagged WebGL2-only by changes/0059-capability-coverage.md:221-226, item 4',
    webgpu: na('no WebGPU form: WebGPU has no luminance or alpha-only texture format'),
    webgl2: gap(11, 'no typed spelling; WebGL2-only capability; no door yet (Rule 11.16)', 642),
    webgl2Only: { door: 'none' },
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: '`RGB`, `RGB8`, `SRGB8`, `RGB565`, `RGB8_SNORM`, `RGB16F`, `RGB32F`, `RGB8I`, `RGB8UI`, `RGB16I`, `RGB16UI`, `RGB32I`, `RGB32UI` (three-component texture formats)',
    covers: [
      'webgl:WebGL2RenderingContextBase.RGB16F',
      'webgl:WebGL2RenderingContextBase.RGB16I',
      'webgl:WebGL2RenderingContextBase.RGB16UI',
      'webgl:WebGL2RenderingContextBase.RGB32F',
      'webgl:WebGL2RenderingContextBase.RGB32I',
      'webgl:WebGL2RenderingContextBase.RGB32UI',
      'webgl:WebGL2RenderingContextBase.RGB8',
      'webgl:WebGL2RenderingContextBase.RGB8I',
      'webgl:WebGL2RenderingContextBase.RGB8UI',
      'webgl:WebGL2RenderingContextBase.RGB8_SNORM',
      'webgl:WebGL2RenderingContextBase.SRGB8',
      'webgl:WebGLRenderingContextBase.RGB',
      'webgl:WebGLRenderingContextBase.RGB565',
    ],
    evidence:
      'src/rhi/webgl2.ts#specOf (specOf: no unpacked three-component case); src/rhi/webgl2.ts#specOf~"rg11b10ufloat" (rg11b10ufloat, the one packed three-component case); node_modules/@webgpu/types/dist/index.d.ts:429 (rgb9e5ufloat, a packed three-component format)',
    note: 'RGB and RGB565 are declared on WebGLRenderingContextBase (WebGL 1.0); the others on WebGL2RenderingContextBase; flagged WebGL2-only by changes/0059-capability-coverage.md:221-226, item 4',
    webgpu: na(
      'no WebGPU form: WebGPU has no unpacked three-component texture format; rgb9e5ufloat and rg11b10ufloat are packed',
    ),
    webgl2: gap(11, 'no typed spelling; WebGL2-only capability; no door yet (Rule 11.16)', 642),
    webgl2Only: { door: 'none' },
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Textures 3D / array: `texStorage3D`, `texImage3D`, `texSubImage3D`, `copyTexSubImage3D`',
    covers: [
      'webgl:WebGL2RenderingContextBase.copyTexSubImage3D',
      'webgl:WebGL2RenderingContextBase.texImage3D',
      'webgl:WebGL2RenderingContextBase.texStorage3D',
      'webgl:WebGL2RenderingContextBase.texSubImage3D',
    ],
    evidence:
      'docs/use-typeshade-surface.md:7939-7941 (a 2D array, 3D or cube texture is a host WebGLTexture on the WebGL2 tier); src/runtime/gl.ts#GlComputePipelineImpl~"textureOf(rhi, v, where)"|GL_TARGET (a host texture of another dimension is bound for the target its pass program names); src/runtime/gl-draw.ts#recordPass~"a colour target on WebGL2" (a colour target is a runtime Texture or the canvas context)',
    note: "the runtime's texture is 2D on WebGL2; a 2D array, 3D or cube texture is a host WebGLTexture on WebGL2 (surface §69); a layered colour target is the row below",
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test makes a 3D or array texture through rt.texture; TextureOptions.size[2] is the typed spelling; a layer read has no typed form; roadmap row 12 names texture_cube_array and texture_3d (docs/roadmap.md:225)',
      645,
    ),
    webgl2: andGap(
      raw(
        'WebGLTexture',
        'a host WebGLTexture of TEXTURE_2D_ARRAY, TEXTURE_3D or TEXTURE_CUBE_MAP; only a compute entry binds it, since a draw binds TEXTURE_2D (`bindTexture` of `src/rhi/webgl2.ts`)',
      ),
      6,
      'no pass takes a layer: a colour target on WebGL2 is a runtime Texture or the canvas context (`recordPass` of `src/runtime/gl-draw.ts`); roadmap row 12 names texture_cube_array and texture_3d (docs/roadmap.md:225)',
      637,
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: '`framebufferTextureLayer` (a layer of a 3D or array texture as a colour target)',
    covers: ['webgl:WebGL2RenderingContextBase.framebufferTextureLayer'],
    evidence:
      'src/runtime/gl-draw.ts#GlTextureImpl.constructor (the WebGL2 tier makes 2D textures of one layer); src/runtime/gl-draw.ts#recordPass~"a colour target on WebGL2" (a colour target is a runtime Texture or the canvas context)',
    note: 'the runtime binds each colour target as a 2D texture; on WebGPU a layer is the depthSlice member of table A',
    webgpu: andGap(
      raw(
        'RenderPipeline.draw(pass, …)',
        'the host records its own pass with a layer (depthSlice)',
      ),
      6,
      'a layer of a 3D or array texture as a colour target has no typed form',
      637,
    ),
    webgl2: refused(
      'Rule 11.11',
      'use a 2D texture; omit depthSlice',
      'a layer of a 3D or array texture as a colour target; the `GlTextureImpl` constructor of `src/runtime/gl-draw.ts` refuses a dimension other than 2d',
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Compressed textures: `compressedTexImage2D/3D`, `compressedTexSubImage2D/3D`, `WEBGL_compressed_texture_*`, `EXT_texture_compression_*`',
    covers: [
      'webgl:EXT_texture_compression_bptc',
      'webgl:EXT_texture_compression_rgtc',
      'webgl:WEBGL_compressed_texture_astc.getSupportedProfiles',
      'webgl:WEBGL_compressed_texture_etc',
      'webgl:WEBGL_compressed_texture_etc1',
      'webgl:WEBGL_compressed_texture_pvrtc',
      'webgl:WEBGL_compressed_texture_s3tc',
      'webgl:WEBGL_compressed_texture_s3tc_srgb',
      'webgl:WebGL2RenderingContextBase.compressedTexImage3D',
      'webgl:WebGL2RenderingContextBase.compressedTexSubImage3D',
      'webgl:WebGL2RenderingContextOverloads.compressedTexImage2D',
      'webgl:WebGL2RenderingContextOverloads.compressedTexSubImage2D',
    ],
    evidence:
      'src/runtime/resources.ts:153-154 (read cannot copy a compressed format); changes/0050-texture-write.md:284, 387 (write refuses a compressed format, and no write of compressed blocks)',
    note: 'the runtime makes no compressed texture and uploads none; a texture the host makes is bound as is (src/runtime/resources.ts:206-210; `GlDevice.fromNative` of `src/rhi/webgl2.ts`)',
    webgpu: andGap(
      raw(
        'GPUTexture',
        'a BC, ETC2 or ASTC texture the host makes is bound as is (src/runtime/resources.ts:209)',
      ),
      6,
      'no upload path; changes/0050-texture-write.md:387 excludes a write of compressed blocks',
      637,
    ),
    webgl2: andGap(
      raw(
        'WebGLTexture',
        'a compressed texture the host makes is bound as is (`GlDevice.fromNative` of `src/rhi/webgl2.ts`)',
      ),
      6,
      'no upload path; changes/0050-texture-write.md:387 excludes a write of compressed blocks',
      637,
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: '`EXT_texture_norm16` (16-bit unorm and snorm colour formats)',
    covers: ['webgl:EXT_texture_norm16'],
    evidence:
      'src/rhi/webgl2.ts#NAMED (NAMED admits the names); src/rhi/webgl2.ts#specOf (specOf: no 16-bit unorm or snorm case)',
    note: 'the runtime does not turn EXT_texture_norm16 on (`GlState` constructor of `src/rhi/webgl2.ts`); the sampling route is read, not measured on a WebGL2 context',
    webgpu: andGap(
      typed(
        'src/runtime/runtime.test.ts',
        'r16unorm and the other 16-bit norm formats pass to createTexture',
      ),
      14,
      'as a render target the 16-bit norm formats are not measured; roadmap row 13b names the tier-1 formats (docs/roadmap.md:228)',
      644,
    ),
    webgl2: andGap(
      raw(
        'WebGLTexture',
        'a host WebGLTexture of this format is bound as is (`GlDevice.fromNative` of `src/rhi/webgl2.ts`)',
      ),
      14,
      'not measured as a target; the runtime makes no 16-bit unorm or snorm texture and admits no render target of the format (`specOf` and `formatOf` of `src/rhi/webgl2.ts`; `recordPass` of `src/runtime/gl-draw.ts`); roadmap row 13b names the tier-1 formats (docs/roadmap.md:228)',
      644,
    ),
  },
];
