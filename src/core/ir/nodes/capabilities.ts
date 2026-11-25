import type { DerivedCapability } from '../derived-capabilities.js';

/** A GPU or language feature a target backend may or may not support. Emitting a module
 *  that needs an unsupported feature throws {@link UnsupportedFeatureError}: a capability
 *  absent from the target's `capProfile` fails closed, naming the capability.
 *
 *  Ids are neutral; a module never names a raw `EXT_*` or `OVR_*` string. Each backend's
 *  `capProfile` row translates the id into that target's `hostFeature` (what the host
 *  activates: `gl.getExtension(...)` on WebGL2, a `requiredFeatures` entry on WebGPU) and
 *  its `directive` (what the emitted source says), so the same module ports across
 *  targets whose extension names differ.
 *
 *  There are three classes:
 *  - Derived resource capabilities, `storageBuffer`, `compute`, `msaaTextureLoad` and
 *    `storageTexture`, are inferred from a module's shape (a storage binding, a `@compute`
 *    entry, a multisampled texture load, a storage-texture binding) and never declared.
 *  - Opt-in language capabilities, `f16`, `subgroups`, `clipDistances` and
 *    `primitiveIndex`, are declared in `ModuleDecl.enables`, or — for the two that a
 *    `@builtin(...)` id names outright — derived from that use by `requiredCaps`, the way
 *    `enable clip_distances;` is what WGSL asks for before `@builtin(clip_distances)` is
 *    spelled. Each is a WGSL `enable` directive with no GLSL ES 3.00 counterpart, so a
 *    module using one fails closed on the GLSL backend.
 *  - Opt-in device capabilities are also declared in `ModuleDecl.enables`. They change
 *    what the device can do and leave what the source may spell unchanged.
 *    `floatRenderTarget` (WebGL2 `EXT_color_buffer_float`, WebGPU core), `float32Blend`
 *    (`EXT_float_blend`, WebGPU `'float32-blendable'`) and `float32Filterable`
 *    (`OES_texture_float_linear`, WebGPU `'float32-filterable'`) are host-side: on WebGL2
 *    the host activates them with `gl.getExtension` before creating the pipeline, and
 *    they have no shader-source token, so declaring one leaves the emitted source
 *    unchanged on both targets. `multiview` is the one source-directive capability:
 *    GLSL ES 3.00 needs `#extension GL_OVR_multiview2 : require` in the shader itself. It
 *    is absent from the WGSL profile, since WebGPU has no equivalent, so a multiview
 *    module fails closed there. Note that `multiview` buys the directive only: a module
 *    declaring it emits the `#extension` line and still renders single-view, because the
 *    DSL cannot spell `layout(num_views = N) in;` or read `gl_ViewID_OVR`.
 *
 *  A bit width appears in an id only where the feature is bit-width specific:
 *  `float32Blend` and `float32Filterable` carry the `32` because both underlying features
 *  are 32-bit-float only. `floatRenderTarget` carries none, because
 *  `EXT_color_buffer_float` makes both 16-bit and 32-bit float attachments renderable.
 *
 *  A host reads what to activate from `reflect().requiredFeatures`. */
export type Capability =
  | 'storageBuffer'
  | 'compute'
  | 'msaaTextureLoad'
  | 'storageTexture'
  | 'texture1d'
  | 'textureCubeArray'
  | 'textureGather'
  | 'f16'
  | 'subgroups'
  | 'clipDistances'
  | 'primitiveIndex'
  | 'dualSourceBlending'
  | 'floatRenderTarget'
  | 'float32Blend'
  | 'float32Filterable'
  | 'multiview'
  | 'bgra8unormStorage'
  | 'packed4x8Dot';

/** Every {@link Capability}, as a runtime value: the list a capability matrix, a doc
 *  generator or a coverage check iterates. A union type has no runtime form, so the list
 *  is written out, and the `satisfies` clause keeps it in step with the union. */
export const ALL_CAPABILITIES = [
  'storageBuffer',
  'compute',
  'msaaTextureLoad',
  'storageTexture',
  'texture1d',
  'textureCubeArray',
  'textureGather',
  'f16',
  'subgroups',
  'clipDistances',
  'primitiveIndex',
  'dualSourceBlending',
  'floatRenderTarget',
  'float32Blend',
  'float32Filterable',
  'multiview',
  'bgra8unormStorage',
  'packed4x8Dot',
] as const satisfies readonly Capability[];

/** The capabilities a module may name in `ModuleDecl.enables`: {@link Capability} minus
 *  the nine capabilities DERIVED from the module's shape. `requiredCaps` infers each of
 *  those from what the module already says (a storage binding means `storageBuffer`, a
 *  `@compute` entry means `compute`, a multisampled texture means `msaaTextureLoad`, and so
 *  on through the texture ids, a `bgra8unorm` storage format and the packed 4x8 calls), so
 *  declaring one would at best restate the shape and at worst assert a feature the module
 *  does not use. This type makes that a compile error. The excluded list is the private
 *  `DERIVED_CAPABILITIES` (`derived-capabilities.ts`), the same list
 *  `capabilityMatrix` reads for its `declarable` column.
 *
 *  `clipDistances`, `primitiveIndex` and `subgroups` are on BOTH sides and deliberately so:
 *  each is derived from a `@builtin(...)` id the module spells (§50), and each is still
 *  declarable, because a module may hold the directive for a feature it reaches another way.
 *  Deriving and declaring meet in one set, so naming one changes nothing.
 *
 *  Only the authoring surface narrows: `requiredCaps`, {@link Capabilities} and
 *  {@link CapProfile} keep reading the full `Capability`, because the derived ids are
 *  exactly what they must express. */
export type DeclarableCapability = Exclude<Capability, DerivedCapability>;
