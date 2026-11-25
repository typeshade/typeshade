import type { AddressSpace, TextureElem, StorageTextureFormat } from '../ir/index.js';

/** What a bind entry is at the host API, independent of the WGSL address space (`uniform`,
 *  `storage`) or type (`texture`, `sampler`) that declared it. A host switches on this field
 *  to pick its GPU resource type. `'uniform-buffer'` and `'storage-buffer'` are both backed by
 *  a buffer; the entry's `access`, present only on a storage buffer, further splits it into
 *  read-only and read-write. `'texture'` and `'sampler'` are the two kinds a buffer-only host
 *  must reject. On the GLSL ES 3.00 backend a `'sampler'` entry is folded into its paired
 *  `'texture'` entry's combined `sampler2D` uniform and gets no declaration of its own; it
 *  still appears in `bindGroups`, since reflection reports the module's structure, with
 *  nothing separate for a host to bind.
 *
 *  Exported from `typeshade`.
 */
export type ResourceKind =
  'uniform-buffer' | 'storage-buffer' | 'texture' | 'storage-texture' | 'sampler';
/** One resource slot in a reflected bind group: the shape of a single WGSL
 *  `@group(G) @binding(B) var<space> name: T` declaration, or of the sampler uniform or std140
 *  block the GLSL ES 3.00 backend emits for it. `name` is the declaration's own identifier,
 *  the one shader code reads through (`field_view.foo`). A GLSL host binding a struct binding
 *  needs `structName` instead: GLSL's block syntax is
 *  `layout(std140) uniform <StructName> { … } <name>;`, so `getUniformBlockIndex` takes the
 *  struct's type name (`'FieldView'` for a binding named `field_view`). Passing `name` there
 *  does not fail to link; the block silently lands at GL's default binding point 0 and aliases
 *  whatever else is bound there.
 *
 *  `group` and `binding` are metadata only on the GLSL backend. The emitted GLSL carries no
 *  binding qualifier, so a GLSL host resolves every entry by name at link time and assigns the
 *  binding point or texture unit itself from these numbers. GLSL has one flat namespace and
 *  no group, so a host whose modules declare more than one group folds `group` into the point
 *  it assigns (`group * 8 + binding`, say) so that two groups' binding 0 do not collide.
 *
 *  Exported from `typeshade`.
 */
export interface BindEntry {
  readonly group: number;
  readonly binding: number;
  /** The binding's authored name, the one the host binds by (Rule 11.10). */
  readonly name: string;
  /** The GLSL spelling of the binding, present only when it differs from `emitted` (Proposal 0070,
   *  D3). A GLSL host reads `emittedGlsl ?? emitted`. */
  readonly emittedGlsl?: string;
  /** The binding's name in the emitted text (Rule 11.10). Equal to `name` when the target
   *  spells it as written. */
  readonly emitted: string;
  readonly space: AddressSpace;
  readonly access?: 'read' | 'read_write';
  readonly resourceKind: ResourceKind;
  /** Who owns the resource. `'module'` when the module declares it and the host builds its
   *  bind group from this reflection; `'host'` when the surrounding host owns it and the
   *  host's own layout is the authority. Always set. `bindGroups` lists host-owned bindings
   *  too: a host still has to know about a binding it owns, it just must not allocate for
   *  it. */
  readonly owner: 'module' | 'host';
  /** How GLSL ES 3.00 spells a host-owned struct binding. Present only when `owner` is
   *  `'host'` and the binding's type is a struct: a module-owned block is always a std140
   *  block, and WGSL has one spelling regardless. `'std140-block'` means bind a uniform
   *  buffer to the block index; `'loose'` means the members were flattened into the default
   *  uniform block and are set individually with `glUniform*` under their field names (the
   *  layout in `uniforms` still lists them, in declaration order). */
  readonly glslSpelling?: 'std140-block' | 'loose';
  /** The struct's type name, for a binding whose type is a struct; absent on every other
   *  kind. It is the name a GLSL host passes to `getUniformBlockIndex`. */
  readonly structName?: string;
  /** The struct's name in the emitted text (Rule 11.10). Equal to `structName` for now. */
  readonly structEmitted?: string;
  /** The texture dimension the shader declared, so a host can create or validate the
   *  matching view: `'2d-array'` needs an array view and a layer-aware bind, `'2d-ms'` a
   *  multisampled one, `'cube'` a cube view, `'3d'` a 3d one, `'1d'` a 1d one and
   *  `'cube-array'` a cube-array view — the value
   *  `GPUTextureViewDescriptor.dimension` takes. Always set on a `texture` entry, absent on
   *  every other kind. */
  readonly textureDim?: '2d' | '2d-ms' | '2d-array' | 'cube' | '3d' | '1d' | 'cube-array';
  /** The texel element the shader declared. Always set on a `texture` entry, absent on
   *  every other kind.
   *
   *  A host needs both `textureDim` and `textureElem` to build a valid binding, since the
   *  dimension alone does not say whether the view is float or integer. WebGPU's
   *  `GPUTextureBindingLayout.sampleType` must be `'uint'` or `'sint'` for a `u32` or `i32`
   *  texture and one of the two float types for `f32`; WebGL2 must back an integer texture with
   *  an integer internal format (`R32UI`, `R32I`). The value is the DSL's own element,
   *  untranslated, because reflection takes a module and never a backend.
   *
   *  An integer texture is unfilterable, so a host must not pair one with a filtering
   *  sampler. A module that type-checks never asks it to: {@link textureSample} rejects an
   *  integer texture at compile time.
   *
   *  {@link BindEntry.sampleType} is what a layout takes for it, from this element and the calls
   *  that read the texture. */
  readonly textureElem?: TextureElem;
  /** The internal format of the data texture a `storage-buffer` entry becomes on GLSL ES 3.00
   *  (change 0046), which has no storage buffer: `'r32f'` (WebGL's `R32F`), `'r32ui'` or
   *  `'r32i'`. Set on every storage binding the emulation reads, an array of a scalar, a vector
   *  or a struct, and absent on every other entry. A struct with a `u32` or `i32` field is
   *  `'r32ui'`, and its float fields are read through `uintBitsToFloat`, so upload its std430
   *  bytes as a `Uint32Array`. A texture whose format does not match is incomplete and reads
   *  zero with no error, so allocate from this field rather than from the element type. */
  readonly glslDataTexture?: 'r32f' | 'r32ui' | 'r32i';
  /** What a host's `GPUTextureBindingLayout.sampleType` takes for this texture, in WebGPU's own
   *  words, from the element the shader declared and the calls that read it. Always set on a
   *  `texture` entry, absent on every other kind, so a host never has to read absence as a
   *  default.
   *
   *  - `'depth'` for a depth texture;
   *  - `'uint'` or `'sint'` for a `u32` or an `i32` texture;
   *  - `'float'` for an `f32` texture that a call pairs with a `sampler`: a `textureSample` (any
   *    of its forms) or a `textureGather` in an entry or in a function an entry calls, through a
   *    helper's parameters or a `const` of the texture as well. A `sampler` binding is laid out
   *    `filtering`, which WebGPU refuses beside an unfilterable texture, and a `'float'` layout
   *    takes a filterable format only;
   *  - `'unfilterable-float'` for every other `f32` texture: one the entries load, measure or
   *    count and never sample, one no entry reaches, and a multisampled one, which no sampler
   *    reads. It takes every format a `'float'` layout takes, and the 32-bit float formats
   *    (`r32float`, `rgba32float`) that layout refuses.
   *
   *  A module with a `raw` statement in what its entries reach is opaque, so each of its `f32`
   *  textures but a multisampled one is `'float'`. A module with no entry is read whole, since
   *  a host writes the entries over it. The sample type follows the texture, not one entry: a
   *  texture that one entry samples and another loads is `'float'` for both.
   *
   *  A host that samples an unfilterable format through a non-filtering sampler, which a module
   *  cannot say, writes its own layout for that binding. */
  readonly sampleType?: 'float' | 'unfilterable-float' | 'depth' | 'sint' | 'uint';
  /** The texel format the shader declared for a storage texture, exactly as WebGPU's
   *  `GPUStorageTextureBindingLayout.format` spells it. Always set on a `storage-texture`
   *  entry, absent on every other kind (roadmap 0.4 item 10).
   *
   *  A storage texture's format is part of its TYPE in WGSL, not a property of the view, and a
   *  host's bind group layout has to repeat it exactly: a layout whose format differs from the
   *  shader's is a validation error at pipeline creation. */
  readonly storageFormat?: StorageTextureFormat;
  /** How the shader may touch a storage texture, in WebGPU's spelling rather than WGSL's —
   *  `'write-only'`, `'read-only'`, `'read-write'` — which is what
   *  `GPUStorageTextureBindingLayout.access` takes. Always set on a `storage-texture` entry,
   *  absent on every other kind.
   *
   *  A host passing WGSL's own `write` / `read` / `read_write` through gets a validation error,
   *  so the translation happens here rather than in every host. */
  readonly storageAccess?: 'write-only' | 'read-only' | 'read-write';
  /** Set on a depth texture (roadmap 0.4 item 11): the host's `GPUTextureBindingLayout` takes
   *  `sampleType: 'depth'` for it, which {@link BindEntry.sampleType} reports, and pairs it with a
   *  comparison sampler. Always `true` on such an entry, absent on every other kind, so a host
   *  never has to read absence as "not depth" on an entry that is not a texture at all. A depth
   *  texture has no `textureElem`. */
  readonly textureDepth?: true;
  /** Set on a comparison sampler (roadmap 0.4 item 11): the host's `GPUSamplerBindingLayout`
   *  takes `type: 'comparison'` for it. Always `true` on such an entry, absent otherwise. */
  readonly samplerComparison?: true;
  /** The stages that reference this binding, in the order vertex, fragment, compute. It
   *  comes from the same reachability walk the per-stage GLSL emit uses to decide which
   *  shader declares which uniform, so a host's stage mask can never describe a narrower
   *  program than the emit produces. It is `GPUBindGroupLayoutEntry.visibility` before it
   *  becomes a bitmask, and the same fact a WebGL2 host uses to assign uniform-block binding
   *  points and texture units per stage. It is a list so that compute is expressible
   *  alongside vertex and fragment.
   *
   *  Always set, and it can be empty. `bindGroups` lists every declared binding, so a binding
   *  no entry point reaches (declared and never read, or in a module with no entry point at
   *  all) reports `[]`. A host must not invent a visibility for it.
   *
   *  For a host-owned binding (`owner: 'host'`) this is the module's view and therefore a
   *  lower bound: the host's real layout may expose the resource to stages this module's
   *  entries never reach. Merge it into the host layout; do not narrow the host layout to
   *  it. */
  readonly stages: readonly ('vertex' | 'fragment' | 'compute')[];
}
/** The bind entries of one WGSL `@group(N)`, sorted by `binding`. `Reflection.bindGroups`
 *  holds one of these per group the module declares, sorted by `group`; a module that
 *  declares only `@group(0)` yields a single-element list. GLSL ES 3.00 has no notion of a
 *  group; see {@link BindEntry} for how a GLSL host folds `group` into the binding point it
 *  assigns.
 *
 *  Exported from `typeshade`.
 */
export interface BindGroup {
  readonly group: number;
  readonly entries: readonly BindEntry[];
}
