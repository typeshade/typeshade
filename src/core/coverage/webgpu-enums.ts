// ═══ Capability coverage, table A: one row per WebGPU enum type ═══
//
// WHAT THIS FILE HOLDS. The rows of table A for the enum types of `@webgpu/types`: a type alias
// whose body is a union of string literals (proposal 0059, Rule 11.14). One row covers one enum
// type, which is one source key, so the values of the enum are not listed here. The member count
// the source reader finds opens the note of each row.
//
// HOW A ROW READS. `covers` names the one key. `evidence` gives the file:line of this tree that
// grounds the statuses. `note` is the note the classification gives the row. A second status of a
// cell starts `also: `. A part of the capability with no typed spelling is a sub-gap, given with
// `andGap`. On an enum row, a sub-gap names a value of the enum or a part the classification noted.
// A use of the enum by a member, such as a stencil compare or a stencil load op, is the row of that
// member.
//
// ORIGIN. The classification was ported from the step-1 inventory of proposal 0059 on 2026-10-12.
// Each `file:line` is a line of the tree at the commit that holds this file.
//
// HOW IT IS CHECKED. scripts/bake-capability-coverage.ts reads these rows and holds them to the
// keys of scripts/capability-sources.ts. The test of Rules 11.14 to 11.18 fails on a key with no
// row and on a row with no key. A status changes only by an edit in this file and a re-bake of
// docs/capability-coverage.md. Do not hand-edit the generated document.

import { andGap, gap, na, planned, raw, type Row, typed } from './model.js';

export const WEBGPU_ENUM_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUAddressMode`',
    covers: ['GPUAddressMode'],
    evidence: 'src/runtime/resources.ts:76-100',
    note: '3 members. clamp, repeat, mirror',
    webgpu: typed('scripts/user-journey.ts'),
    webgl2: typed('scripts/user-journey.ts'),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUAutoLayoutMode`',
    covers: ['GPUAutoLayoutMode'],
    evidence: 'docs/language-design.md:1251',
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
    evidence: 'src/runtime/program.ts:53-62; src/runtime/gl-draw.ts:891',
    note: '17 members. passed through; src1 factors need @blend_src; constant factors need setBlendConstant',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets TargetState.blend (src/runtime/program.ts:53-62); constant factors need setBlendConstant, which no typed surface sets',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets TargetState.blend on the WebGL2 tier (src/runtime/gl-draw.ts:891-919); src1 factors need @blend_src, which the GLSL writer refuses (Rule 10.3); constant factors need setBlendConstant, which no typed surface sets; also: refused (Rule 11.11): targets that blend or mask apart',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUBlendOperation`',
    covers: ['GPUBlendOperation'],
    evidence: 'src/runtime/program.ts:53-62; src/runtime/gl-draw.ts:897',
    note: '5 members.',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets TargetState.blend (src/runtime/program.ts:53-62)',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets TargetState.blend on the WebGL2 tier (src/runtime/gl-draw.ts:1300-1301); also: refused (Rule 11.11): targets that blend or mask apart',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUBufferBindingType`',
    covers: ['GPUBufferBindingType'],
    evidence: 'src/runtime/program.ts:399-452; src/runtime/gl.ts:338-340; src/core/reflect.ts:903',
    note: '3 members.',
    webgpu: typed('src/runtime/runtime.test.ts'),
    webgl2: typed(
      'scripts/compile-gate.ts',
      'WebGL2 has no bind group layout; the binding kind follows the declared address space: uniform, or words for storage (src/runtime/gl.ts:338-340; src/core/reflect.ts:903)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUBufferMapState`',
    covers: ['GPUBufferMapState'],
    evidence: 'src/runtime/resources.ts:312; docs/language-design.md:1322',
    note: '3 members.',
    webgpu: raw(
      'GPUBuffer',
      'the host reads the map state of its own GPUBuffer, as GPUBuffer.mapState does; the runtime maps its own readback staging buffer (src/runtime/resources.ts:312)',
    ),
    webgl2: na('WebGL2 has no GPUBuffer mapping state'),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUCanvasAlphaMode`',
    covers: ['GPUCanvasAlphaMode'],
    evidence:
      'src/runtime/runtime.ts:41-48, 83-84, 439-441, 466-473; src/runtime/gl-draw.ts:1364-1371; docs/language-design.md:906',
    note: '2 members. the host configures; the call layer draws opaque (Rule 8.24)',
    webgpu: raw(
      'createRuntime({ device })',
      'the host configures its own canvas context with the device it passes in, and passes the context as a colour target (src/runtime/runtime.ts:83-84, 439-441)',
    ),
    webgl2: andGap(
      raw(
        'createRuntime({ device })',
        'the host creates the WebGL2 context with its attributes and passes it in (src/runtime/runtime.ts:41-48, 466-473); the pass takes the context as its canvas target (src/runtime/gl-draw.ts:1364-1371)',
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
    evidence: 'src/runtime/runtime.ts:41-48, 83-84, 439-441',
    note: '2 members.',
    webgpu: raw(
      'createRuntime({ device })',
      'the host configures toneMapping on its own canvas context, made with the device it passes in (src/runtime/runtime.ts:41-48, 83-84)',
    ),
    webgl2: na('a WebGPU canvas option; WebGL2 canvases have no tone mapping'),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUCompareFunction`',
    covers: ['GPUCompareFunction'],
    evidence: 'src/runtime/program.ts:78-86; src/runtime/resources.ts:81-92',
    note: '8 members. depth compare and sampler compare',
    webgpu: typed('scripts/compile-gate.ts'),
    webgl2: typed('scripts/compile-gate.ts'),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUCompilationMessageType`',
    covers: ['GPUCompilationMessageType'],
    evidence: 'docs/language-design.md:36, 1383-1387; src/core/host-draw.ts:518',
    note: '3 members.',
    webgpu: na(
      'the front end diagnoses at the source (Rule 12.6); the compile gate holds the emit to Tint (Rule 1.1)',
    ),
    webgl2: na(
      'WebGL2 reports shader errors through getShaderInfoLog, a string with no message type (src/core/host-draw.ts:518)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUCullMode`',
    covers: ['GPUCullMode'],
    evidence: 'src/runtime/program.ts:87-93',
    note: '3 members.',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): src/runtime/runtime.test.ts:717 sets cullMode and checks only that the pipeline key changes (src/runtime/program.ts:655)',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets cullMode on the WebGL2 tier (src/runtime/gl-draw.ts:1294, 912)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUDeviceLostReason`',
    covers: ['GPUDeviceLostReason'],
    evidence: 'src/core/host-entry.ts:686; src/runtime/runtime.ts:148-153',
    note: '2 members. see GPUDevice.lost',
    webgpu: andGap(
      raw(
        'Runtime.device',
        'the host reads the loss reason through rt.device.lost; the call layer ignores its value (src/core/host-entry.ts:686)',
      ),
      8,
      'no typed surface reports the loss reason to the host; the call layer requests a new device once one is lost (src/runtime/runtime.ts:537)',
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
    evidence: 'src/runtime/runtime.ts:347',
    note: '3 members. validation only',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test provokes a validation error through the runtime (src/runtime/runtime.ts:347); the out-of-memory and internal filters have no typed spelling; the runtime pushes only a validation scope (src/runtime/runtime.ts:347)',
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
      'src/core/backends/wgsl.ts:216-272; src/core/ir/nodes.ts:732-770; src/compiler/ts/builtin-check.ts:226-227; docs/language-design.md:314; node_modules/@webgpu/types/dist/index.d.ts:1472-1483',
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
        '§14 asks whether read_write storage formats are a host-feature capability or refused (docs/language-design.md:1496), and the surface text places them in the same position (docs/use-typeshade-surface.md:5377-5381). ' +
        'Other parts of this enum: depth-clip-control (group 1); timestamp-query (group 4); indirect-first-instance (group 5); the subgroup functions (group 13, docs/language-design.md:1498; docs/roadmap.md:306); subgroup-size-control (group 12, docs/language-design.md:1498; docs/roadmap.md:306); atomic-vec2u-min-max (group 9, docs/roadmap.md:304)',
      637,
    ),
    webgl2: na('a WebGPU feature name; WebGL2 names its capabilities as extensions (table D)'),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUFilterMode`',
    covers: ['GPUFilterMode'],
    evidence: 'src/runtime/resources.ts:76-100',
    note: '2 members.',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): every sampling case reads texel centres, where nearest and linear return the same texel; no test reads the sampler descriptor (src/runtime/resources.ts:335-340)',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): every WebGL2 sampling case reads texel centres, where nearest and linear return the same texel (src/runtime/gl-draw.ts:435-443)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUFrontFace`',
    covers: ['GPUFrontFace'],
    evidence: 'src/runtime/program.ts:87-93',
    note: '2 members.',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets primitive.frontFace, and every frame culls nothing (src/runtime/program.ts:691)',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets frontFace on the WebGL2 tier (src/runtime/gl-draw.ts:1296, 914)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUIndexFormat`',
    covers: ['GPUIndexFormat'],
    evidence: 'src/runtime/program.ts:130-140',
    note: '2 members.',
    webgpu: typed('scripts/compile-gate.ts'),
    webgl2: typed('scripts/compile-gate.ts'),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPULoadOp`',
    covers: ['GPULoadOp'],
    evidence: 'src/runtime/runtime.ts:88-103',
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
      'src/runtime/resources.ts:340; src/runtime/gl-draw.ts:346, 435-446; changes/0050-texture-write.md:323-325, 331',
    note: '2 members. follows filter; a chain to filter over is 0050 (WebGPU)',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test sets or reads a mipmap filter (src/runtime/resources.ts:340); also: planned (0050, draft): a mip chain to filter over',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test reads a mip filter on WebGL2 (src/runtime/gl-draw.ts:442-443); the sampler sets one filter for min and mag; a WebGL2 texture has one level (src/runtime/gl-draw.ts:346, 435-446); a mip chain to filter over: 0050 is WebGPU only (changes/0050-texture-write.md:323-325, 331)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUPipelineErrorReason`',
    covers: ['GPUPipelineErrorReason'],
    evidence:
      'node_modules/@webgpu/types/dist/index.d.ts:346; src/runtime/program.ts:627-634; src/runtime/program.ts:706-713',
    note: '2 members.',
    webgpu: gap(
      8,
      'the runtime rethrows only the message of the platform error, as a new Error, so no runtime program reports the reason (src/runtime/program.ts:630-631, 709-710)',
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
    evidence: 'src/runtime/runtime.ts:41-48, 497; node_modules/typescript/lib/lib.dom.d.ts:2125',
    note: '2 members. requestAdapter() takes no options; WebGL2 context attribute powerPreference',
    webgpu: andGap(
      raw(
        'createRuntime({ device })',
        'the host requests its own adapter and passes the device in',
      ),
      8,
      'requestAdapter() takes no options (src/runtime/runtime.ts:497); powerPreference has no typed spelling',
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
    evidence: 'src/runtime/program.ts:87-93; src/runtime/gl-draw.ts:703-709',
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
      'node_modules/@webgpu/types/dist/index.d.ts:361; src/runtime/runtime.ts:148-153; src/runtime/gl.ts:419-438',
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
      'no query set; WebGL2 query objects have no typed form; the frame runs its draws after submit() returns, so a query begun and ended around the synchronous call wraps none (src/runtime/gl.ts:419-438); issue 542 tracks timestamps only',
      542,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUSamplerBindingType`',
    covers: ['GPUSamplerBindingType'],
    evidence: 'src/runtime/program.ts:399-452; src/runtime/gl-draw.ts:447-449',
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
        "WebGL2 has no bind group layout; the sampler's compare option sets its comparison kind (src/runtime/gl-draw.ts:447-449)",
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
    evidence: 'src/runtime/program.ts:71-108',
    note: '8 members. no stencil',
    webgpu: planned(
      '0064',
      'no stencil state; the runtime builds the pipeline state and no hatch reaches its stencil part (src/runtime/program.ts:71-108)',
    ),
    webgl2: planned('0064', 'no stencil state (src/runtime/program.ts:71-108)'),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUStorageTextureAccess`',
    covers: ['GPUStorageTextureAccess'],
    evidence:
      'docs/language-design.md:1149-1152; src/core/ir/types.ts:105-122; src/core/reflect.ts:904',
    note: '3 members. write, read, read_write (Rule 10.5)',
    webgpu: andGap(
      typed('src/compiler/ts/storage-textures.test.ts'),
      6,
      'read_write beyond r32uint, r32sint and r32float is refused (TS8002); §14 row, docs/language-design.md:1496; roadmap 13b, docs/roadmap.md:228',
      162,
    ),
    webgl2: andGap(
      typed(
        'src/core/passes/gl-compute.test.ts',
        'compute only (Rule 10.5); WebGL2 has no bind group layout, and the access is the declared one (src/core/reflect.ts:904)',
      ),
      6,
      'read_write beyond r32uint, r32sint and r32float is refused (TS8002); §14 row, docs/language-design.md:1496; roadmap 13b, docs/roadmap.md:228',
      162,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUStoreOp`',
    covers: ['GPUStoreOp'],
    evidence: 'src/runtime/runtime.ts:83-87, 370; node_modules/typescript/lib/lib.dom.d.ts:23654',
    note: '2 members. always store',
    webgpu: andGap(
      raw(
        'RenderPipeline.draw(pass, …)',
        'the host makes its own pass with a store op and records into it with RenderPipeline.draw',
      ),
      1,
      'no typed spelling sets a store op; the runtime always stores (src/runtime/runtime.ts:370)',
      632,
    ),
    webgl2: planned(
      '0064',
      'the runtime stores every attachment (src/runtime/runtime.ts:83-87); WebGL2 has invalidateFramebuffer, which discards (node_modules/typescript/lib/lib.dom.d.ts:23654)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUTextureAspect`',
    covers: ['GPUTextureAspect'],
    evidence: 'src/runtime/resources.ts:307; src/runtime/gl-draw.ts:403, 493-495',
    note: '3 members. depth-only on a depth32float read; stencil-only is a sub-gap; the stencil-only aspect is the capability of table D row WEBGL_stencil_texturing (group 6)',
    webgpu: andGap(
      typed('src/runtime/runtime.test.ts'),
      6,
      'the stencil-only aspect has no typed spelling; the runtime copies only the depth-only aspect of depth32float (src/runtime/resources.ts:307)',
      637,
    ),
    webgl2: andGap(
      typed('scripts/compile-gate.ts'),
      6,
      'the stencil-only aspect has no typed spelling; WebGL2 reads depth through a copy to r32float and refuses other depth formats (src/runtime/gl-draw.ts:403, 493-495)',
      637,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUTextureDimension`',
    covers: ['GPUTextureDimension'],
    evidence: 'src/runtime/resources.ts:24; src/runtime/gl-draw.ts:321-324',
    note: '3 members. 2d, 3d on WebGPU; 2d on WebGL2; 1d is a sub-gap on WebGPU and refused on WebGL2',
    webgpu: andGap(
      typed('scripts/compile-gate.ts'),
      6,
      'the runtime makes no 1d texture (src/runtime/resources.ts:24); texture_1d is shipped as a WGSL spelling (roadmap 12, docs/roadmap.md:225); roadmap 13c names storage 1d textures (docs/roadmap.md:229)',
      637,
    ),
    webgl2: typed(
      'scripts/compile-gate.ts',
      'also: refused (Rule 10.5) for 1d; refused (Rule 11.11) for 3d (src/runtime/gl-draw.ts:321-324)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUTextureFormat`',
    covers: ['GPUTextureFormat'],
    evidence:
      'src/runtime/resources.ts:16-17, 162-172; src/runtime/gl-draw.ts:74-199, 331-332; changes/0050-texture-write.md:96-97, 387',
    note: '101 members. grouped: 8/16/32-bit colour, srgb, packed (rgb10a2, rg11b10, rgb9e5), depth24plus, depth32float typed on WebGPU; stencil8, depth24plus-stencil8, depth32float-stencil8 pass to createTexture on WebGPU but have no stencil state (sub-gap); depth16unorm is a depth attachment that read() cannot copy (sub-gap); BC, ETC2, EAC and ASTC compressed (52 names): no upload path; 0050 does not cover compressed blocks (changes/0050-texture-write.md:387); sampling is a sub-gap; 3-component and LUMINANCE formats exist only on WebGL2 (D); on WebGL2, r16, rg16 and rgba16 in unorm and snorm and rgb9e5ufloat are refused by texture() (src/runtime/gl-draw.ts:332); the 16-bit norm formats and rgb9e5ufloat as targets are not measured',
    webgpu: andGap(
      typed('src/runtime/runtime.test.ts'),
      6,
      'stencil8, depth24plus-stencil8 and depth32float-stencil8 have no stencil state; depth16unorm is a depth attachment that read() and readFloats() cannot copy (src/runtime/resources.ts:162-164); BC, ETC2, EAC and ASTC (52 names) have no upload path, and 0050 covers no compressed blocks (changes/0050-texture-write.md:387)',
      637,
    ),
    webgl2: andGap(
      typed('scripts/compile-gate.ts'),
      6,
      'stencil8, depth24plus-stencil8 and depth32float-stencil8 have no stencil state, and texture() refuses stencil8 (src/runtime/gl-draw.ts:332); depth16unorm cannot be copied by read() (src/runtime/resources.ts:162-164); BC, ETC2, EAC and ASTC (52 names) have no upload path (changes/0050-texture-write.md:387); r16, rg16 and rgba16 in unorm and snorm (6 names) and rgb9e5ufloat are refused by texture() (src/runtime/gl-draw.ts:332) and are not measured; roadmap row 13b names the tier-1 formats (docs/roadmap.md:228), and the surface text lists the 16-bit snorm names among them (docs/use-typeshade-surface.md:5377-5381)',
      637,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUTextureSampleType`',
    covers: ['GPUTextureSampleType'],
    evidence: 'docs/language-design.md:1237; src/runtime/gl-draw.ts:84',
    note: '5 members. from the calls (Rule 11.10)',
    webgpu: typed('src/runtime/runtime.test.ts'),
    webgl2: typed(
      'src/core/passes/gl-compute.test.ts',
      'WebGL2 has no bind group layout; the format record of the texture sets its kind (src/runtime/gl-draw.ts:84)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUTextureViewDimension`',
    covers: ['GPUTextureViewDimension'],
    evidence:
      'src/runtime/program.ts:399-452; src/runtime/gl-draw.ts:321-324; src/runtime/gl.ts:302, 359-361',
    note: '6 members. from the binding type; cube-array and 1d refused on WebGL2 (Rule 10.5)',
    webgpu: typed('src/compiler/ts/texture-dims.test.ts'),
    webgl2: typed(
      'src/compiler/ts/texture-dims.test.ts',
      'also: refused (Rule 10.5) for cube-array and 1d; refused (Rule 11.11) for 2d-array and 3d (src/runtime/gl-draw.ts:321-324). WebGL2 has no bind group layout; the view dimension is the declared texture dimension (src/runtime/gl.ts:302)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU enum',
    name: '`GPUVertexFormat`',
    covers: ['GPUVertexFormat'],
    evidence: 'src/core/vertex-layout.ts:72-80',
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
    evidence: 'src/core/vertex-layout.ts:65; src/core/vertex-layout.ts:72-87',
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
