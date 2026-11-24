import { andGap, gap, na, raw, type Row, typed } from '../model.js';

export const LOAD_OP_TO_VERTEX_STEP_MODE_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPULoadOp`',
    covers: ['GPULoadOp'],
    evidence: 'src/runtime/runtime.ts:105-170',
    note: '2 members.',
    webgpu: typed('scripts/compile-gate.ts'),
    webgl2: typed('scripts/compile-gate.ts'),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUMipmapFilterMode`',
    covers: ['GPUMipmapFilterMode'],
    evidence:
      'src/runtime/resources.ts#SamplerImpl.constructor; src/rhi/webgl2.ts#GlDevice.createTexture~"texStorage2D"|GlDevice.createSampler~"TEXTURE_MIN_FILTER"; changes/0050-texture-write.md:323-325, 331',
    note: '2 members. follows filter; a chain to filter over is 0050 (WebGPU)',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets or reads a mipmap filter (src/runtime/resources.ts:308); also: planned (0050, draft): a mip chain to filter over',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test reads a mip filter on WebGL2 (src/rhi/webgl2.ts:1432-1434); the sampler sets one filter for min and mag; a WebGL2 texture has one level (src/rhi/webgl2.ts:1336, 1424-1437); a mip chain to filter over: 0050 is WebGPU only (changes/0050-texture-write.md:323-325, 331)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUPipelineErrorReason`',
    covers: ['GPUPipelineErrorReason'],
    evidence:
      'node_modules/@webgpu/types/dist/index.d.ts:346; src/runtime/program.ts:1579-1586; src/runtime/program.ts:1675-1682',
    note: '2 members.',
    webgpu: gap(
      8,
      'the runtime rethrows only the message of the platform error, as a new Error, so no runtime program reports the reason (src/runtime/program.ts:1582-1583, 1678-1679)',
      639,
    ),
    webgl2: na(
      'the WebGPU pipeline error reason; WebGL2 reports a failed program through its info log',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUPowerPreference`',
    covers: ['GPUPowerPreference'],
    evidence: 'src/runtime/runtime.ts:51-58, 644; node_modules/typescript/lib/lib.dom.d.ts:2125',
    note: '2 members. requestAdapter() takes no options; WebGL2 context attribute powerPreference',
    webgpu: andGap(
      raw(
        'createRuntime({ device })',
        'the host requests its own adapter and passes the device in',
      ),
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
    kind: 'WebGPU enum',
    name: '`GPUPrimitiveTopology`',
    covers: ['GPUPrimitiveTopology'],
    evidence: 'src/runtime/program.ts:301-307; src/rhi/webgl2.ts#firstVertexLast',
    note: '5 members. all five; strips with indices need stripIndexFormat (sub-gap)',
    webgpu: andGap(
      typed('scripts/compile-gate.ts'),
      14,
      'a strip drawn with indices needs stripIndexFormat, which the runtime does not set (to measure)',
      644,
    ),
    webgl2: typed('scripts/compile-gate.ts'),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUQueryType`',
    covers: ['GPUQueryType'],
    evidence:
      'node_modules/@webgpu/types/dist/index.d.ts:361; src/runtime/runtime.ts#SubmitResult|Runtime.info; src/runtime/gl.ts#GlFrameImpl.record|GlFrameImpl.submit',
    note: '2 members.',
    webgpu: andGap(
      raw(
        'Runtime.device',
        'the host makes a query set of either type on the runtime device, and its own pass uses it',
      ),
      4,
      'no typed spelling makes a query set; src/runtime makes none; issue 542 tracks timestamps only',
      542,
    ),
    webgl2: gap(
      4,
      'no query set; WebGL2 query objects have no typed form; the frame runs its draws after submit() returns, so a query begun and ended around the synchronous call wraps none (src/runtime/gl.ts:459-478); issue 542 tracks timestamps only',
      542,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUSamplerBindingType`',
    covers: ['GPUSamplerBindingType'],
    evidence:
      'src/runtime/program.ts:1330-1381; src/rhi/webgl2.ts#GlDevice.createSampler~"TEXTURE_COMPARE_MODE"',
    note: '3 members. filtering and comparison; non-filtering is not spellable (surface §69)',
    webgpu: andGap(
      typed('src/runtime/runtime.test.ts'),
      6,
      'non-filtering sampler bindings are not spellable (surface §69)',
      637,
    ),
    webgl2: andGap(
      typed(
        'scripts/compile-gate.ts',
        "WebGL2 has no bind group layout; the sampler's compare option sets its comparison kind (src/rhi/webgl2.ts:1438-1440)",
      ),
      6,
      'non-filtering sampler bindings are not spellable (surface §69)',
      637,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUStencilOperation`',
    covers: ['GPUStencilOperation'],
    evidence:
      'src/runtime/program.ts:102 (STENCIL_OPERATIONS); src/rhi/webgl2.ts#stencilOpOf (stencilOpOf)',
    note: '8 members. The eight operations are taken on both tiers',
    webgpu: typed(
      'journeys/pipeline-state',
      'the eight operations in each of three places; also src/runtime/render-state-parity.test.ts',
    ),
    webgl2: typed(
      'journeys/pipeline-state',
      'the eight operations in each of three places; also src/runtime/gl-draw.test.ts',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUStorageTextureAccess`',
    covers: ['GPUStorageTextureAccess'],
    evidence:
      'docs/language-design.md:1151-1154; src/core/ir/types.ts#READ_WRITE_STORAGE_FORMATS|WRITE_ONLY_STORAGE_FORMATS; src/core/reflect.ts:904',
    note: '3 members. write, read, read_write (Rule 10.5)',
    webgpu: andGap(
      typed('src/compiler/ts/storage-textures.test.ts'),
      6,
      'read_write beyond r32uint, r32sint and r32float is refused (TS8002); §14 row, docs/language-design.md:1504; roadmap 13b, docs/roadmap.md:228',
      162,
    ),
    webgl2: andGap(
      typed(
        'src/core/passes/gl-compute.test.ts',
        'compute only (Rule 10.5); WebGL2 has no bind group layout, and the access is the declared one (src/core/reflect.ts:904)',
      ),
      6,
      'read_write beyond r32uint, r32sint and r32float is refused (TS8002); §14 row, docs/language-design.md:1504; roadmap 13b, docs/roadmap.md:228',
      162,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUStoreOp`',
    covers: ['GPUStoreOp'],
    evidence:
      'src/runtime/runtime.ts:467-498 (FrameImpl.pass); src/runtime/program.ts#depthStencilAttachmentOf (depthStencilAttachmentOf); src/runtime/program.ts:1071-1181 (passOf); src/runtime/program.ts:960-989 (checkPassFit); src/runtime/runtime.ts#PassTargets.color (PassTargets); src/runtime/runtime.ts:127-129 (DepthAttachment)',
    note: '2 members: store and discard, both taken',
    webgpu: typed(
      'journeys/pass-attachments',
      'PassTargets store; also src/runtime/runtime.test.ts',
    ),
    webgl2: typed(
      'journeys/pass-attachments',
      'PassTargets store, cleared to 0 at pass end; also src/runtime/gl-draw.test.ts',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUTextureAspect`',
    covers: ['GPUTextureAspect'],
    evidence:
      'src/runtime/resources.ts#TextureImpl.destroy; src/runtime/gl-draw.ts#GlTextureImpl.readFloats; src/rhi/webgl2.ts#depthToColour',
    note: '3 members. depth-only on a depth32float read; stencil-only is a sub-gap; the stencil-only aspect is the capability of table D row WEBGL_stencil_texturing (group 6)',
    webgpu: andGap(
      typed('src/runtime/runtime.test.ts'),
      6,
      'the stencil-only aspect has no typed spelling; the runtime copies only the depth-only aspect of depth32float (src/runtime/resources.ts:286)',
      637,
    ),
    webgl2: andGap(
      typed('scripts/compile-gate.ts'),
      6,
      'the stencil-only aspect has no typed spelling; WebGL2 reads depth through a copy to r32float and refuses other depth formats (src/runtime/gl-draw.ts:253; src/rhi/webgl2.ts:714-716)',
      637,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUTextureDimension`',
    covers: ['GPUTextureDimension'],
    evidence:
      'src/runtime/resources.ts#TextureOptions.dimension; src/runtime/gl-draw.ts#GlTextureImpl.constructor',
    note: '3 members. 2d, 3d on WebGPU; 2d on WebGL2; 1d is a sub-gap on WebGPU and refused on WebGL2',
    webgpu: andGap(
      typed('scripts/compile-gate.ts'),
      6,
      'the runtime makes no 1d texture (src/runtime/resources.ts:23); texture_1d is shipped as a WGSL spelling (roadmap 12, docs/roadmap.md:225); roadmap 13c names storage 1d textures (docs/roadmap.md:229)',
      637,
    ),
    webgl2: typed(
      'scripts/compile-gate.ts',
      'also: refused (Rule 10.5) for 1d; refused (Rule 11.11) for 3d (src/runtime/gl-draw.ts:161-164)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUTextureFormat`',
    covers: ['GPUTextureFormat'],
    evidence:
      'src/runtime/resources.ts:15-16, 153-163; src/rhi/webgl2.ts#specOf|formatOf; src/runtime/gl-draw.ts#GlTextureImpl.constructor; changes/0050-texture-write.md:96-97, 387',
    note: '101 members. grouped: 8/16/32-bit colour, srgb, packed (rgb10a2, rg11b10, rgb9e5), depth24plus, depth32float typed on WebGPU; stencil8, depth24plus-stencil8, depth32float-stencil8 pass to createTexture on WebGPU but have no stencil state (sub-gap); depth16unorm is a depth attachment that read() cannot copy (sub-gap); BC, ETC2, EAC and ASTC compressed (52 names): no upload path; 0050 does not cover compressed blocks (changes/0050-texture-write.md:387); sampling is a sub-gap; 3-component and LUMINANCE formats exist only on WebGL2 (D); on WebGL2, r16, rg16 and rgba16 in unorm and snorm and rgb9e5ufloat are refused by texture() (src/runtime/gl-draw.ts:172); the 16-bit norm formats and rgb9e5ufloat as targets are not measured',
    webgpu: andGap(
      typed('src/runtime/runtime.test.ts'),
      6,
      'stencil8, depth24plus-stencil8 and depth32float-stencil8 have no stencil state; depth16unorm is a depth attachment that read() and readFloats() cannot copy (src/runtime/resources.ts:153-155); BC, ETC2, EAC and ASTC (52 names) have no upload path, and 0050 covers no compressed blocks (changes/0050-texture-write.md:387)',
      637,
    ),
    webgl2: andGap(
      typed('scripts/compile-gate.ts'),
      6,
      'stencil8, depth24plus-stencil8 and depth32float-stencil8 have no stencil state, and texture() refuses stencil8 (src/runtime/gl-draw.ts:172); depth16unorm cannot be copied by read() (src/runtime/resources.ts:153-155); BC, ETC2, EAC and ASTC (52 names) have no upload path (changes/0050-texture-write.md:387); r16, rg16 and rgba16 in unorm and snorm (6 names) and rgb9e5ufloat are refused by texture() (src/runtime/gl-draw.ts:172) and are not measured; roadmap row 13b names the tier-1 formats (docs/roadmap.md:228), and the surface text lists the 16-bit snorm names among them (docs/use-typeshade-surface.md:5377-5381)',
      637,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUTextureSampleType`',
    covers: ['GPUTextureSampleType'],
    evidence: 'docs/language-design.md:1239; src/rhi/webgl2.ts#textureKindOf',
    note: '5 members. from the calls (Rule 11.10)',
    webgpu: typed('src/runtime/runtime.test.ts'),
    webgl2: typed(
      'src/core/passes/gl-compute.test.ts',
      'WebGL2 has no bind group layout; the format record of the texture sets its kind (src/rhi/webgl2.ts:67-68)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUTextureViewDimension`',
    covers: ['GPUTextureViewDimension'],
    evidence:
      'src/runtime/program.ts:1330-1381; src/runtime/gl-draw.ts#GlTextureImpl.constructor; src/runtime/gl.ts#GlComputePipelineImpl~"textureDim"|GL_TARGET',
    note: '6 members. from the binding type; cube-array and 1d refused on WebGL2 (Rule 10.5)',
    webgpu: typed('src/compiler/ts/texture-dims.test.ts'),
    webgl2: typed(
      'src/compiler/ts/texture-dims.test.ts',
      'also: refused (Rule 10.5) for cube-array and 1d; refused (Rule 11.11) for 2d-array and 3d (src/runtime/gl-draw.ts:161-164). WebGL2 has no bind group layout; the view dimension is the declared texture dimension (src/runtime/gl.ts:340)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUVertexFormat`',
    covers: ['GPUVertexFormat'],
    evidence: 'src/core/vertex-layout.ts#PREFIX|vertexFormat',
    note: '42 members. float32xN, sint32xN, uint32xN (12 of 42); 8/16-bit, norm, float16 and packed formats are sub-gaps',
    webgpu: andGap(
      typed('src/compiler/ts/vertex-layout.test.ts'),
      2,
      '8/16-bit, normalized, float16 and packed formats have no typed spelling (src/core/vertex-layout.ts:72-80)',
      633,
    ),
    webgl2: andGap(
      typed('scripts/compile-gate.ts'),
      2,
      '8/16-bit, normalized, float16 and packed formats have no typed spelling (src/core/vertex-layout.ts:72-80)',
      633,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUVertexStepMode`',
    covers: ['GPUVertexStepMode'],
    evidence:
      'src/core/vertex-layout.ts#vertexLayoutOfEntry; src/core/vertex-layout.ts#PREFIX|vertexFormat',
    note: '2 members. vertex only',
    webgpu: gap(
      2,
      'vertex only: no per-instance step mode is spelled (src/core/vertex-layout.ts:65)',
      633,
    ),
    webgl2: gap(
      2,
      'vertex only: no per-instance attribute divisor is spelled (src/core/vertex-layout.ts:65)',
      633,
    ),
  },
];
