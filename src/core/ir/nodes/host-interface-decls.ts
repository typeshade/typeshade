import type { ShaderType } from '../types.js';

/** A pipeline specialization constant, the declaration behind {@link overrideConst}.
 *  On WGSL it emits a module-scope `override name: type = default;`, which the host
 *  specializes through `createRenderPipeline({ constants: { name } })`. On GLSL ES 3.00 it
 *  emits `#define name default` after the `#version` line, and the host specializes it by
 *  emitting again with `emitGlslModule(m, stage, { overrideValues })`. The value is chosen
 *  when the pipeline is created, so a single authored module yields as many
 *  driver-specialized variants as the host needs, and the driver eliminates the branches
 *  a constant turns dead. Only WGSL scalar types are allowed (`bool`, `i32`, `u32`,
 *  `f32`); a vector, matrix, array or struct type is rejected at authoring with
 *  `SD0014`. */
export interface OverrideDecl {
  readonly name: string;
  readonly type: ShaderType;
  /** The default value emitted into the `override` declaration or `#define`: the
   *  value a pipeline gets when the host supplies nothing for this constant. */
  readonly default: number | boolean;
}

/** The `BindingDecl.space` a resource binding lives in: WGSL's `var<uniform>` or
 *  `var<storage, ...>`. It selects the WGSL declaration spelling and, on GLSL, the choice
 *  between a `uniform` block and an emulated storage-buffer path (WebGL2 GLSL ES 3.00 has
 *  no native storage buffer). See {@link BindingDecl.access}, which applies only when
 *  this is `'storage'`.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export type AddressSpace = 'uniform' | 'storage';
/** A `ModuleDecl.bindings` entry: a resource bound at a `(group, binding)` slot. It is a
 *  uniform buffer, a storage buffer, a texture, or a sampler, keyed by `type` (a struct,
 *  scalar or array type means a buffer; a `texture` or `sampler` `ShaderType.kind` means
 *  a handle resource with no address space). WGSL emits both `group` and `binding`.
 *  GLSL ES 3.00 has a single binding namespace, so its backend reads `binding` only;
 *  `group` is still used by {@link reflect}, which groups resources per WGSL bind group.
 *  Use {@link uniformStruct}, {@link resource} or {@link storageBuffer} to derive one
 *  instead of constructing it directly.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export interface BindingDecl {
  readonly group: number;
  readonly binding: number;
  readonly name: string;
  readonly space: AddressSpace;
  /** Storage access, `read` or `read_write`. Ignored for `uniform`. */
  readonly access?: 'read' | 'read_write';
  readonly type: ShaderType;
  /** Who owns this resource. `'module'` (the default) means the module declares it and
   *  describes its layout, and a host builds its bind group from {@link reflect}.
   *  `'host'` means the resource belongs to the surrounding host, such as a bind group a
   *  host-integrated WebGPU renderer hands the module, so the host's layout is the
   *  authority and {@link reflect} reports it under `hostResources`. Ownership does not
   *  change the spelling: a host-owned binding is still declared in the emitted source,
   *  which is what makes it type-checkable; it is just not the module's to allocate. For
   *  a symbol the host's prelude already declares, use {@link externVar}, which emits
   *  nothing. */
  readonly owner?: 'module' | 'host';
  /** GLSL ES 3.00 precision qualifier for this declaration. GLSL only; WGSL has no such
   *  concept and ignores it. Without it the declaration takes the stage default from the
   *  precision preamble, which is right for a module that owns its own header and wrong
   *  for a fragment composed into a host program whose preamble the module does not
   *  control. */
  readonly precision?: 'highp' | 'mediump' | 'lowp';
  /** How a struct-typed uniform binding is spelled on GLSL ES 3.00. Ignored on WGSL, which
   *  has exactly one spelling, and ignored for non-struct types.
   *
   *  `'std140-block'` (the default, and the only choice for a module-owned block) emits
   *  `layout(std140) uniform Name { … } var;`. `'loose'` emits one default-block
   *  `uniform <type> <field>;` per member and rewrites every `var.field` read to the bare
   *  `field`, which is the form a GLSL host prelude provides. Only a host-owned block may
   *  choose `'loose'`: for a module-owned block the two spellings are not interchangeable
   *  (std140 is the only one with a defined layout for a host to write into), so the
   *  choice would be a silent ABI change. */
  readonly glsl?: 'std140-block' | 'loose';
}

/** A host-provided global, the declaration behind {@link externVar}. It is the variable
 *  counterpart of {@link externFn}.
 *
 *  It emits nothing on either backend: the host's prelude declares the symbol. The
 *  declaration exists so that reads of it type-check, survive renaming, and appear in
 *  `reflect().requires`, where a host can check them against what its prelude provides.
 *
 *  `spelling` maps the logical name onto what each target writes, so moving to a host
 *  that exposes the same value differently (a WGSL struct member or a bound uniform in
 *  place of a GLSL prelude global) is a change to the spelling map and leaves the shader
 *  source alone. */
export interface ExternVarDecl {
  readonly name: string;
  readonly type: ShaderType;
  /** Per-target spelling. A missing side falls back to `name`. */
  readonly spelling?: { readonly wgsl?: string; readonly glsl?: string };
  /** Restrict the symbol to one stage, for a host global only that stage's prelude
   *  provides. Advisory metadata for `reflect().requires`; nothing gates on it. */
  readonly stage?: 'vertex' | 'fragment' | 'compute';
}
