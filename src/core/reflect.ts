// ═══ Shader DSL — pipeline REFLECTION (additive; layout engine shared with GLSL emit) ═══
//
// The IR already carries every binding/struct/entry fact, but emitModule discards
// it into a string — so a host re-derives bind-group layouts + uniform byte offsets
// BY HAND (and they drift; see runtime point-uniform-layout.test.ts). reflect(module)
// recovers that metadata as a target-neutral `Reflection` object the host can consume
// mechanically: bind-group entries, std140/std430 struct byte layouts, vertex
// attributes, and entry-point signatures.
//
// PURE + ADDITIVE — scoped precisely (#763 H2): `reflect()` itself is read-only over
// the IR and sits on no emit path. The LAYOUT ENGINE in this file (typeLayout /
// structLayout) does NOT share that invariant: the GLSL backend imports it to bake
// std140 UBO / std430 storage offsets into emitted source (glsl.ts), so a layout-rule
// change here CAN change emitted GLSL bytes (never WGSL — the WGSL backend derives
// nothing from it). The std140/std430 offsets are anchored to the offsets the runtime
// already ships (reflect.test.ts).

import {
  type ShaderType,
  type StructDecl,
  type ModuleDecl,
  type AddressSpace,
  type Capability,
  type TextureElem,
  type BindingDecl,
  typeKey,
  stageOf,
  workgroupSizeOf,
} from './ir/index.js'
import { entryIo, type IoField } from './ir/entry-io.js'
import { requiredCaps } from './passes/required-caps.js'
import { bindingStages } from './passes/stage-bindings.js'
import { fp64Lower, type Fp64Flavor } from './passes/fp64-lower.js'

const roundUp = (x: number, a: number): number => Math.ceil(x / a) * a

/** The byte-layout rule a struct's fields are placed under. `'std140'` is the rule WGSL
 *  applies to the `uniform` address space, and the rule of a GLSL ES 3.00
 *  `layout(std140) uniform` block: a struct or array base alignment rounds up to 16 bytes, so
 *  a `vec3` field costs 16 and an array of `f32` uses 16 bytes per element. `'std430'` is the
 *  rule WGSL applies to the `storage` address space: natural alignment with no 16-byte
 *  round-up. Vertex-attribute offsets use the same rule.
 *
 *  Pick the rule from the binding's address space, on either backend: `uniform` is std140 and
 *  `storage` is std430. GLSL ES 3.00 has no storage buffer, so a `storage` binding is emitted
 *  as a data texture there, but {@link reflect} describes the module as authored and reports
 *  its fields under std430 in `Reflection.storage`.
 *
 *  A `mat2` field under `'std140'` throws: WGSL's uniform rule gives a `mat2` a column stride
 *  of 8 bytes while GLSL std140 gives it 16, and this engine reports one number for both
 *  backends. Declare the two columns as `vec2` fields instead.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export type LayoutKind = 'std140' | 'std430'

/** Size + alignment (bytes) of a host-shareable type under a layout. Throws on a
 *  non-host-shareable type (texture/sampler/void are bind resources, not struct fields). */
function typeLayout(
  t: ShaderType,
  layout: LayoutKind,
  structs: ReadonlyMap<string, StructDecl>,
): { size: number; align: number } {
  switch (t.kind) {
    case 'scalar':
      return { size: 4, align: 4 }
    // f64 (emulated double) occupies its lowered vec2<f32> slot — hi then lo,
    // 8 bytes, 8-aligned — under BOTH layouts, so reflecting the authored module
    // and the lowered module yield byte-identical offsets. Hosts pack with
    // splitF64 (core/fp64/df64-lib.ts).
    case 'f64':
      return { size: 8, align: 8 }
    // vec64 lowers to `struct { hi: vecN<f32>, lo: vecN<f32> }` — derive the
    // layout from THAT struct through the same engine (single authority), so
    // authored and lowered reflections agree byte-for-byte here too.
    case 'vec64': {
      const vecT: ShaderType = { kind: 'vec', n: t.n, elem: 'f32' }
      const sl = structLayout(
        {
          name: `DF64Vec${t.n}`,
          fields: [
            { name: 'hi', type: vecT },
            { name: 'lo', type: vecT },
          ],
        },
        layout,
        structs,
      )
      return { size: sl.size, align: sl.align }
    }
    case 'vec':
      // vec2 → 8/8, vec3 → 12/16, vec4 → 16/16 (elem is always 4 bytes)
      return t.n === 2
        ? { size: 8, align: 8 }
        : t.n === 3
          ? { size: 12, align: 16 }
          : { size: 16, align: 16 }
    case 'mat': {
      // mat64 (emulated double) lowers to `struct DF64MatN { c0..c(N-1): DF64VecN }`
      // — derive the layout from THAT struct through the same engine (single
      // authority), so authored and lowered reflections agree byte-for-byte.
      if (t.elem === 'f64') {
        const vecT: ShaderType = { kind: 'vec', n: t.n, elem: 'f32' }
        const colStruct: StructDecl = {
          name: `DF64Vec${t.n}`,
          fields: [
            { name: 'hi', type: vecT },
            { name: 'lo', type: vecT },
          ],
        }
        const nested = new Map(structs)
        nested.set(colStruct.name, colStruct)
        const sl = structLayout(
          {
            name: `DF64Mat${t.n}`,
            fields: Array.from({ length: t.n }, (_, j) => ({
              name: `c${j}`,
              type: { kind: 'struct', name: colStruct.name } as ShaderType,
            })),
          },
          layout,
          nested,
        )
        return { size: sl.size, align: sl.align }
      }
      // #763 P7 — mat2 std140 DIVERGES between WGSL uniform rules (column stride 8)
      // and real GLSL std140 (columns round to vec4 → stride 16). The GLSL UBO emit
      // declares this layout THE offset contract, so a mat2 field would drift host
      // bytes vs GL for it and every following field. No producer exists (types.ts
      // exports only mat4x4fT) — reject until the vec4-rounded rule + a layout test land.
      if (layout === 'std140' && t.n === 2) {
        throw new Error(
          'wgslLayout: mat2 in std140 is not supported — WGSL uniform rules (stride 8) and GLSL std140 (stride 16) disagree; add the dual-rule layout + tests before using mat2 in a UBO',
        )
      }
      // matNxN<f32>: N columns of vecN; column stride = round(size,align) of the column vec.
      const col =
        t.n === 2
          ? { size: 8, align: 8 }
          : t.n === 3
            ? { size: 12, align: 16 }
            : { size: 16, align: 16 }
      const stride = roundUp(col.size, col.align)
      return { size: stride * t.n, align: col.align }
    }
    case 'struct': {
      const sl = structLayout(structByName(structs, t.name), layout, structs)
      return { size: sl.size, align: sl.align }
    }
    case 'array': {
      const el = typeLayout(t.elem, layout, structs)
      let stride = roundUp(el.size, el.align)
      let align = el.align
      if (layout === 'std140') {
        stride = roundUp(stride, 16)
        align = roundUp(align, 16)
      }
      const count = t.size ?? 0 // runtime-sized array → 0 (stride still defined)
      return { size: count * stride, align }
    }
    default:
      throw new Error(`reflect: type '${t.kind}' is not host-shareable (no byte layout)`)
  }
}

function structByName(structs: ReadonlyMap<string, StructDecl>, name: string): StructDecl {
  const s = structs.get(name)
  if (!s) throw new Error(`reflect: struct '${name}' not found in module`)
  return s
}

/** One struct field's byte layout: its `name`, its DSL type key (the string {@link typeKey}
 *  returns), and its `offset`, `align` and `size` in bytes under the {@link LayoutKind} the
 *  enclosing {@link StructLayout} was computed with. A packer that writes `Float32Array`
 *  slots divides `offset` by 4; every type this engine lays out is at least 4-byte aligned,
 *  so the division is exact.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export interface FieldLayout {
  readonly name: string
  readonly type: string
  readonly offset: number
  readonly align: number
  readonly size: number
}
/** A struct's complete byte layout: its total `size` and `align` plus one {@link FieldLayout}
 *  per field, in declaration order. {@link wgslLayout} produces one for a standalone struct;
 *  {@link reflect} produces one for every struct bound in a module, under std140 for a
 *  `uniform` binding and std430 for a `storage` binding (see {@link LayoutKind}). `size` is
 *  already rounded up to `align`, which under std140 is itself rounded to 16, so it is also
 *  the element stride of an array of this struct.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export interface StructLayout {
  readonly name: string
  readonly size: number
  readonly align: number
  readonly fields: readonly FieldLayout[]
}

/** Compute the byte layout of one struct under a {@link LayoutKind}: each field's offset,
 *  alignment and size, plus the struct's total size and alignment. Under `'std140'` the
 *  struct's and every nested array's base alignment rounds up to 16; under `'std430'` natural
 *  alignment applies.
 *
 *  Exported from `@xgis/shader-dsl`.
 *
 *  @param struct - the struct to lay out.
 *  @param layout - `'std140'` for a uniform buffer, `'std430'` for a storage buffer.
 *  @param structs - the structs a nested struct-typed field may refer to, by name. Defaults
 *    to a map holding only `struct` itself.
 *  @returns the {@link StructLayout}.
 *  @throws if a field's type has no byte layout (a texture or a sampler), if a nested struct
 *    is not in `structs`, or if a `mat2` field is laid out under `'std140'` (see
 *    {@link LayoutKind}).
 *
 *  @example
 *  ```ts
 *  import { wgslLayout, vec3fT, f32T } from '@xgis/shader-dsl'
 *
 *  const light = { name: 'Light', fields: [{ name: 'pos', type: vec3fT }, { name: 'radius', type: f32T }] }
 *  wgslLayout(light, 'std140')
 *  // { name: 'Light', size: 16, align: 16, fields: [
 *  //   { name: 'pos', type: 'vec3<f32>', offset: 0, align: 16, size: 12 },
 *  //   { name: 'radius', type: 'f32', offset: 12, align: 4, size: 4 } ] }
 *  ```
 */
export function wgslLayout(
  struct: StructDecl,
  layout: LayoutKind,
  structs: ReadonlyMap<string, StructDecl> = new Map(),
): StructLayout {
  return structLayout(struct, layout, structs.size ? structs : new Map([[struct.name, struct]]))
}

function structLayout(
  struct: StructDecl,
  layout: LayoutKind,
  structs: ReadonlyMap<string, StructDecl>,
): StructLayout {
  let cursor = 0
  let maxAlign = 1
  const fields: FieldLayout[] = []
  for (const f of struct.fields) {
    const { size, align } = typeLayout(f.type, layout, structs)
    cursor = roundUp(cursor, align)
    fields.push({ name: f.name, type: typeKey(f.type), offset: cursor, align, size })
    cursor += size
    if (align > maxAlign) maxAlign = align
  }
  const structAlign = layout === 'std140' ? roundUp(maxAlign, 16) : maxAlign
  return { name: struct.name, size: roundUp(cursor, structAlign), align: structAlign, fields }
}

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
 *  Exported from `@xgis/shader-dsl`.
 */
export type ResourceKind = 'uniform-buffer' | 'storage-buffer' | 'texture' | 'sampler'
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
 *  Exported from `@xgis/shader-dsl`.
 */
export interface BindEntry {
  readonly group: number
  readonly binding: number
  readonly name: string
  readonly space: AddressSpace
  readonly access?: 'read' | 'read_write'
  readonly resourceKind: ResourceKind
  /** Who owns the resource. `'module'` when the module declares it and the host builds its
   *  bind group from this reflection; `'host'` when the surrounding host owns it and the
   *  host's own layout is the authority. Always set. `bindGroups` lists host-owned bindings
   *  too: a host still has to know about a binding it owns, it just must not allocate for
   *  it. */
  readonly owner: 'module' | 'host'
  /** How GLSL ES 3.00 spells a host-owned struct binding. Present only when `owner` is
   *  `'host'` and the binding's type is a struct: a module-owned block is always a std140
   *  block, and WGSL has one spelling regardless. `'std140-block'` means bind a uniform
   *  buffer to the block index; `'loose'` means the members were flattened into the default
   *  uniform block and are set individually with `glUniform*` under their field names (the
   *  layout in `uniforms` still lists them, in declaration order). */
  readonly glslSpelling?: 'std140-block' | 'loose'
  /** The struct's type name, for a binding whose type is a struct; absent on every other
   *  kind. It is the name a GLSL host passes to `getUniformBlockIndex`. */
  readonly structName?: string
  /** The texture dimension the shader declared, so a host can create or validate the
   *  matching view: `'2d-array'` needs an array view and a layer-aware bind, `'2d-ms'` a
   *  multisampled one. Always set on a `texture` entry, absent on every other kind. */
  readonly textureDim?: '2d' | '2d-ms' | '2d-array'
  /** The texel element the shader declared. Always set on a `texture` entry, absent on
   *  every other kind.
   *
   *  A host needs both `textureDim` and `textureElem` to build a valid binding, since the
   *  dimension alone does not say whether the view is float or integer. WebGPU's
   *  `GPUTextureBindingLayout.sampleType` must be `'uint'` or `'sint'` for a `u32` or `i32`
   *  texture and `'float'` for `f32`; WebGL2 must back an integer texture with an integer
   *  internal format (`R32UI`, `R32I`). The value is the DSL's own element, untranslated,
   *  because reflection takes a module and never a backend.
   *
   *  An integer texture is unfilterable, so a host must not pair one with a filtering
   *  sampler. A module that type-checks never asks it to: {@link textureSample} rejects an
   *  integer texture at compile time. */
  readonly textureElem?: TextureElem
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
  readonly stages: readonly ('vertex' | 'fragment' | 'compute')[]
}
/** The bind entries of one WGSL `@group(N)`, sorted by `binding`. `Reflection.bindGroups`
 *  holds one of these per group the module declares, sorted by `group`; a module that
 *  declares only `@group(0)` yields a single-element list. GLSL ES 3.00 has no notion of a
 *  group; see {@link BindEntry} for how a GLSL host folds `group` into the binding point it
 *  assigns.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export interface BindGroup {
  readonly group: number
  readonly entries: readonly BindEntry[]
}
/** One `@location`-attributed parameter of the module's `@vertex` entry point. Attributes
 *  are listed in the order the entry function declares its parameters, and `offset` comes
 *  from walking them in that order and rounding each one up to its own type's std430
 *  alignment. The layout follows the parameter order, so reordering the entry's parameters
 *  changes every later attribute's `offset`. `type` is the DSL type key (the string
 *  {@link typeKey} returns), the same spelling `StructLayout.fields[].type` uses.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export interface VertexAttr {
  readonly name: string
  readonly location: number
  readonly type: string
  readonly offset: number
}
/** The vertex-buffer layout for a module's `@vertex` entry: every `@location` parameter and
 *  the interleaved `arrayStride` those parameters pack into. {@link reflect} describes the
 *  first `@vertex` entry it finds in `module.funcs`; a module with more than one vertex entry
 *  point gets a `VertexLayout` for the one declared first. `Reflection.vertex` is `undefined`
 *  when the module has no `@location` vertex parameters.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export interface VertexLayout {
  readonly attributes: readonly VertexAttr[]
  readonly arrayStride: number
}
/** One field of an entry point's stage interface: a `@location(n)` varying, vertex attribute
 *  or fragment draw buffer, or a `@builtin(name)` slot. Where the entry spelled it as a member
 *  of a struct parameter or struct return, the field is reported flattened out of that struct;
 *  see {@link EntryIo}.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export interface EntryIoField {
  /** The field's own identifier: a parameter's name, a flattened struct field's name, or
   *  `_ret` for a bare non-struct return value (the name the GLSL backend gives that
   *  output). */
  readonly name: string
  /** The DSL type key (the string {@link typeKey} returns), the same spelling
   *  `StructLayout.fields[].type` and `VertexAttr.type` use. */
  readonly type: string
  /** The declared `@location(n)`. Absent on a `@builtin` field and on an unattributed one;
   *  the two are told apart by whether `builtin` is set. */
  readonly location?: number
  /** The declared `@builtin(name)`, in WGSL's own vocabulary (`position`, `vertex_index`,
   *  …). Builtins are reported alongside locations. A consumer that compares varyings and
   *  leaves builtins out (they are not varyings) filters on this field, and can then report
   *  that `position` was excluded because it is a builtin. */
  readonly builtin?: string
}
/** One entry point's `@location` and `@builtin` interface: the shape a host validates a
 *  vertex/fragment pair against, builds a `GPUVertexState` from, or diffs as a pipeline
 *  contract. Both sides are flattened. A struct parameter or struct return contributes its
 *  fields, one row each with its own location, because WGSL lets an entry spell the same
 *  varyings either as loose parameters or as one struct, and a consumer comparing two stages
 *  must not care which form each side used. A `void` return contributes nothing.
 *
 *  `outputs` is a list, so a fragment entry that writes several attachments (`@location(0)`
 *  a colour and `@location(1)` an entity id) is expressible here, where `EntryInfo.output`'s
 *  single type key cannot represent it.
 *
 *  The fields are read through the same attribute readers the GLSL backend uses for its `in`
 *  and `out` declarations, so the published interface and the emitted one cannot disagree.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export interface EntryIo {
  readonly inputs: readonly EntryIoField[]
  readonly outputs: readonly EntryIoField[]
}
/** One `@vertex`, `@fragment` or `@compute` entry point: its stage, its parameter and return
 *  types as DSL type keys (the strings {@link typeKey} returns), and, for a `@compute` entry
 *  only, its workgroup size, which defaults to 64 when the entry declares none, matching the
 *  WGSL backend's own default. {@link semanticDiff} fingerprints a module's public interface
 *  with this shape: two modules whose entries differ here have a different pipeline contract
 *  even if every other byte of emitted source matches.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export interface EntryInfo {
  readonly name: string
  readonly stage: 'vertex' | 'fragment' | 'compute'
  readonly workgroupSize?: number
  readonly inputs: readonly string[]
  readonly output: string
  /** Present, as `true`, when the entry is declared a portable kernel; absent otherwise,
   *  never `false`. It tells a host which dispatch shape the kernel needs: on a backend with
   *  no compute stage a portable kernel emits as fragment-shader GPGPU and is dispatched as
   *  a fullscreen draw into an `R32UI` target instead of a compute dispatch. An entry
   *  without it runs on WebGPU only. */
  readonly portable?: true
  /** The entry's location and builtin interface, in structured form. `inputs` and `output`
   *  are type keys, which is what {@link semanticDiff} fingerprints with; `io` is the view
   *  beside them that a host validating a stage pair reads for the `@location` numbers.
   *  Always present. See {@link EntryIo} for how struct parameters and returns flatten. */
  readonly io: EntryIo
}
/** A pipeline specialization constant (a WGSL `override`) the host supplies when it creates
 *  a pipeline. Both backends' host-side shapes derive from it: the WGSL `constants`
 *  dictionary is `{ [name]: value }`, and the GLSL `#define` header is one
 *  `#define <name> <value>` line per entry. Both are keyed by `name` and fall back to
 *  `default` when the host supplies nothing.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export interface OverrideInfo {
  readonly name: string
  readonly type: string
  readonly default: number | boolean
}
/** The target-neutral pipeline metadata {@link reflect} recovers from a module: bind-group
 *  layout (`bindGroups`), every bound struct's byte layout (`uniforms`, `storage`), the
 *  vertex-attribute layout if any (`vertex`), every entry point's signature (`entries`),
 *  specialization constants (`overrides`), the capabilities a host must activate before
 *  pipeline creation (`requiredFeatures`), and the host-provided globals the module expects
 *  (`requires`). Each field's own doc gives its shape. A host that takes its bind-group
 *  layouts and byte offsets from a `reflect()` call on the same module it emits shader text
 *  from keeps one table, so a struct field cannot sit at byte 20 in the shader and at byte 24
 *  in the CPU packer.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export interface Reflection {
  readonly bindGroups: readonly BindGroup[]
  /** std140 uniform-buffer struct layouts (one per uniform binding whose type is a struct). */
  readonly uniforms: readonly StructLayout[]
  /** std430 storage-buffer struct layouts. */
  readonly storage: readonly StructLayout[]
  /** Vertex attributes from the `@vertex` entry's `@location` parameters. Offsets are
   *  std430-aligned, each field rounded up to its type's alignment, so a host reads `offset`
   *  and `arrayStride` from here instead of assuming a tightly packed buffer. */
  readonly vertex?: VertexLayout
  readonly entries: readonly EntryInfo[]
  /** Pipeline specialization constants: the names, types and defaults the host passes at
   *  pipeline creation (WGSL `constants`, or the GLSL `#define` header). Always present;
   *  empty for a module that declares no overrides. */
  readonly overrides: readonly OverrideInfo[]
  /** Every capability this module's emit requires: the ones derived from the module's shape
   *  (a storage binding needs `storageBuffer`, a `@compute` entry needs `compute`, a
   *  multisampled texture load needs `msaaTextureLoad`) plus everything the module declared
   *  in `enables`. Sorted and deduplicated. Always present; empty for a module that needs
   *  nothing.
   *
   *  This is what a host must have active before it creates a pipeline for the module. The
   *  ids are neutral, because reflection takes a module and never a backend, so translate
   *  them for one target with {@link hostFeaturesFor}:
   *
   *  ```ts
   *  for (const ext of hostFeaturesFor(glslEs300Backend, reflect(m).requiredFeatures)) {
   *    if (!gl.getExtension(ext)) throw new Error(`WebGL2 lacks ${ext}`)
   *  }
   *  // WebGPU fixes its features at requestDevice, so do this at boot, before any pipeline:
   *  // requestDevice({
   *  //   requiredFeatures: hostFeaturesFor(wgslBackend, reflect(m).requiredFeatures) })
   *  ```
   *
   *  A capability the target backend cannot provide at all normally never reaches this loop
   *  in a usable pipeline, because emit for that backend already throws
   *  {@link UnsupportedFeatureError} (`SD0030`) naming it. The exception is `storageBuffer`
   *  on GLSL ES 3.00: a `storage` binding is emitted as a data texture there, so the module
   *  emits fine while reflection of the module as authored still reports the capability.
   *  `hostFeaturesFor` skips every capability the backend has no host feature for, so the
   *  loop above is correct either way. */
  readonly requiredFeatures: readonly Capability[]
  /** The host-provided globals this module references but does not declare: one entry per
   *  {@link externVar} declarator, reported so a composer can check them against what the
   *  host's prelude actually supplies. Always present; empty for a module that expects
   *  nothing from its host. Host-provided functions ({@link externFn}) have no declaration to
   *  report here; the `requires` list of an emitted fragment ({@link emitFragment}) covers
   *  those by walking call sites. */
  readonly requires: readonly ExternRequirement[]
}

/** One host-provided global a module expects, declared with {@link externVar}. `type` is the
 *  DSL type key (the string {@link typeKey} returns). `wgsl` and `glsl` are the per-target
 *  spellings the emit writes, and the host provides the global under those; `name` is the
 *  logical name the module uses. `stage`, when present, is the advisory stage the declaration
 *  named.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export interface ExternRequirement {
  readonly name: string
  readonly type: string
  readonly wgsl: string
  readonly glsl: string
  readonly stage?: 'vertex' | 'fragment' | 'compute'
}

/** An `ir/entry-io` field as the reflection publishes it: the `ShaderType` becomes its type
 *  KEY (the spelling every other reflected type uses), `interpolate` is dropped — it is an
 *  emit detail of how a varying is sampled, not part of which slot it occupies. */
const ioField = (f: IoField): EntryIoField => ({
  name: f.name,
  type: typeKey(f.type),
  ...(f.location !== undefined ? { location: f.location } : {}),
  ...(f.builtin !== undefined ? { builtin: f.builtin } : {}),
})

const resourceKind = (space: AddressSpace, t: ShaderType): ResourceKind =>
  t.kind === 'texture'
    ? 'texture'
    : t.kind === 'sampler'
      ? 'sampler'
      : space === 'storage'
        ? 'storage-buffer'
        : 'uniform-buffer'

// String fallback ONLY (#740 R3): fn()-authored decls carry structured
// `stage`/`workgroupSize` — reflect reads those first; the attrs-string parse
// survives solely for hand-built FuncDecl literals.
// Stage / workgroup-size predicates live in core/ir (#763 S1) — one shared helper
// for reflect, the capability gate, GLSL entry classification, and fn-DCE roots.

/** Options for {@link reflect}. */
export interface ReflectOptions {
  /** The f64 emulation flavour the emit will use, the same {@link Fp64Flavor} the backend is
   *  given. It decides whether the module binds the `_fp64` guard, a 1x1 texture the
   *  emulated-double helpers read so that a fast-math compiler cannot reassociate their
   *  arithmetic: the `'float'` helpers (the default) read it and the `'integer'` helpers do
   *  not. Pass the same value the emit will get; a host that builds a bind group from a
   *  reflection computed with a different flavour is describing a different program than the
   *  one it runs. */
  readonly fp64Flavor?: Fp64Flavor
}

/** The module's declared bindings, plus any a LOWERING injects that a host must still bind
 *  (#1724).
 *
 *  `fp64Lower` auto-injects the `_fp64` guard texture into any module whose f64 helpers read
 *  it — authors declare nothing, which is the documented contract (`fp64/df64-lib.ts`: "Either
 *  way the binding shows up in reflect() … and the host MUST bind a 1x1 texture"). It runs
 *  inside emit, so before this the emitted source declared a binding the reflection did not
 *  report, and a host that built its bind group from the reflection never bound the guard the
 *  shader samples. On WebGPU that is a validation error; on WebGL2 there is no error at all —
 *  the sampler stays on its default unit and the guard silently reads a value that is not 1.0,
 *  so the anti-fast-math protection lapses without a symptom.
 *
 *  The decision is fp64Lower's and stays there: whether a guard is needed depends on WHICH
 *  helpers the lowering pulled in (comparison-only closures read no guard) and on the flavor,
 *  neither of which is cheap to re-derive — and a second copy of that rule is how the two
 *  authorities drifted in the first place. So this runs the pass and takes ONLY the bindings
 *  it added. Deliberately not "reflect the lowered module": that would also re-report every
 *  f64 type as its `vec2<f32>` emulation, which is a much larger change than the contract
 *  violation being fixed here.
 *
 *  Identity for every module without f64 — `fp64Lower` returns the same object, so the cost
 *  is one reference comparison.
 *
 *  The LOWERED module comes back alongside because `BindEntry.stages` must be walked over
 *  it, not over the authored one: nothing in the authored IR calls `f64Guard`, so `_fp64`
 *  is reachable only after the lowering that injected it — the same module the per-stage
 *  GLSL emit scopes over. */
function bindingsIncludingInjected(
  m: ModuleDecl,
  flavor: Fp64Flavor | undefined,
): { readonly bindings: readonly BindingDecl[]; readonly lowered: ModuleDecl } {
  const lowered = fp64Lower(m, flavor !== undefined ? { flavor } : undefined)
  if (lowered === m) return { bindings: m.bindings, lowered }
  const declared = new Set(m.bindings.map((b) => b.name))
  const injected = lowered.bindings.filter((b) => !declared.has(b.name))
  return {
    bindings: injected.length === 0 ? m.bindings : [...m.bindings, ...injected],
    lowered,
  }
}

/** Recover a module's pipeline metadata from its IR. It is what a host reads to build bind
 *  groups, write uniform buffers, describe vertex state and check device features, without
 *  parsing a line of emitted source.
 *
 *  The result carries:
 *
 *  - `bindGroups`: every declared binding, sorted by group then binding, each with its name,
 *    address space, access mode, resource kind, owner, and the stages that reference it. It
 *    also includes the bindings the f64 emulation adds on the author's behalf, the `_fp64`
 *    guard texture among them (see {@link ReflectOptions}), because a host builds its bind
 *    group from this list and a binding missing here is a binding never bound.
 *  - `uniforms` and `storage`: std140 and std430 struct layouts, per field offset, align and
 *    size plus the struct's own size and alignment. This is where a byte offset comes from,
 *    so nothing counts them by hand.
 *  - `vertex`: the vertex entry's `@location` attributes with their offsets and the array
 *    stride. Offsets are std430-aligned, each field rounded up to its type's alignment.
 *  - `entries`: one signature per entry point, with its stage, its workgroup size for a
 *    compute entry, its input and output types, its structured location and builtin interface,
 *    and `portable` when the kernel declares that tier.
 *  - `requiredFeatures`: every capability the emit needs, sorted and deduplicated. It covers
 *    the capabilities derived from the module's shape (a storage binding, a compute entry, a
 *    multisampled texture load), the capabilities the module declared in `enables`, and the
 *    closure over implication, so a module declaring `float32Blend` also reports `floatRenderTarget`,
 *    since blending into a float target needs that target to be colour-renderable first. The
 *    ids are neutral, so translate them through {@link hostFeaturesFor} for one target.
 *  - `overrides`: each specialization constant's name, type and default, the values a host
 *    pins through pipeline constants or a define header.
 *  - `requires`: the host-provided globals the module references and does not declare.
 *
 *  A texture binding reports two more fields a host needs to create a matching view.
 *  `textureDim` is `'2d'`, `'2d-ms'` or `'2d-array'`, and `textureElem` is the texel element,
 *  `f32`, `u32` or `i32`. Both axes are needed: WebGPU's `sampleType` must be `'uint'` or
 *  `'sint'` for an integer texture, and WebGL2 must back one with an integer internal format.
 *  Getting that pairing wrong raises nothing, since a texture whose format disagrees with its
 *  sampler type is merely incomplete and reads zero.
 *
 *  Reflection is read-only over the IR and never runs on the emit path. It takes a module and
 *  never a backend, which is why every id it reports is target-neutral.
 *
 *  {@link wgslLayout} is the same offset engine on its own, for a single struct with no module
 *  around it.
 *
 *  Exported from `@xgis/shader-dsl`.
 *
 *  @param m - the module to describe.
 *  @param opts - the emit facts that change what a host must bind, the fp64 flavour among
 *    them. Pass the same values the emit will get; a default here that disagrees with the
 *    emit describes a different program.
 *  @returns the target-neutral pipeline metadata described above.
 *
 *  @example
 *  ```ts
 *  import { reflect, hostFeaturesFor, wgslBackend } from '@xgis/shader-dsl'
 *
 *  const r = reflect(MODULE)
 *  const device = await adapter.requestDevice({
 *    requiredFeatures: hostFeaturesFor(wgslBackend, r.requiredFeatures),
 *  })
 *  r.uniforms[0].fields // [{ name: 'mvp', offset: 0, size: 64, align: 16 }, …]
 *  ```
 *
 *  @see {@link wgslLayout} for the offset engine alone.
 *  @see {@link hostFeaturesFor} for turning `requiredFeatures` into one target's strings.
 */
export function reflect(m: ModuleDecl, opts?: ReflectOptions): Reflection {
  const structs = new Map(m.structs.map((s) => [s.name, s]))
  const { bindings: allBindings, lowered } = bindingsIncludingInjected(m, opts?.fp64Flavor)
  const stages = bindingStages(lowered)
  // bind groups (sorted by group, then binding)
  const byGroup = new Map<number, BindEntry[]>()
  for (const b of allBindings) {
    const e: BindEntry = {
      group: b.group,
      binding: b.binding,
      name: b.name,
      space: b.space,
      ...(b.access ? { access: b.access } : {}),
      resourceKind: resourceKind(b.space, b.type),
      owner: b.owner ?? 'module',
      ...(b.type.kind === 'struct' && b.owner === 'host'
        ? { glslSpelling: b.glsl ?? 'std140-block' }
        : {}),
      ...(b.type.kind === 'struct' ? { structName: b.type.name } : {}),
      ...(b.type.kind === 'texture' ? { textureDim: b.type.dim, textureElem: b.type.elem } : {}),
      stages: stages.get(b.name) ?? [],
    }
    ;(byGroup.get(b.group) ?? byGroup.set(b.group, []).get(b.group)!).push(e)
  }
  const bindGroups: BindGroup[] = [...byGroup.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([group, entries]) => ({ group, entries: entries.sort((a, b) => a.binding - b.binding) }))

  const uniforms: StructLayout[] = []
  const storage: StructLayout[] = []
  for (const b of allBindings) {
    if (b.type.kind !== 'struct') continue
    const s = structs.get(b.type.name)
    if (!s) continue
    if (b.space === 'uniform') uniforms.push(structLayout(s, 'std140', structs))
    else storage.push(structLayout(s, 'std430', structs))
  }

  const entries: EntryInfo[] = []
  let vertex: VertexLayout | undefined
  for (const f of m.funcs) {
    const stage = stageOf(f)
    if (!stage) continue
    // #1905 — the location/builtin view of the same signature, read through the GLSL
    // backend's own attribute readers so the two cannot describe different interfaces.
    const io = entryIo(f, structs)
    entries.push({
      name: f.name,
      stage,
      ...(stage === 'compute' ? { workgroupSize: workgroupSizeOf(f) ?? 64 } : {}),
      inputs: f.params.map((p) => typeKey(p.type)),
      output: typeKey(f.ret),
      // Present only when declared (#1812) — an absent field, not `portable: false`, so the
      // host reads "WebGPU-only" the same way it reads every other absent capability.
      ...(f.portable === true ? { portable: true as const } : {}),
      io: { inputs: io.inputs.map(ioField), outputs: io.outputs.map(ioField) },
    })
    if (stage === 'vertex' && !vertex) {
      let cursor = 0
      const attributes: VertexAttr[] = []
      for (const p of f.params) {
        if (p.location === undefined) continue
        const { size, align } = typeLayout(p.type, 'std430', structs)
        cursor = roundUp(cursor, align)
        attributes.push({
          name: p.name,
          location: p.location,
          type: typeKey(p.type),
          offset: cursor,
        })
        cursor += size
      }
      if (attributes.length) vertex = { attributes, arrayStride: cursor }
    }
  }

  // #923 — specialization constants, in declaration order (the host reads names +
  // defaults straight from here to build the WGSL `constants` dict / GLSL define header).
  const overrides: OverrideInfo[] = (m.overrides ?? []).map((o) => ({
    name: o.name,
    type: typeKey(o.type),
    default: o.default,
  }))

  // #1670 — the caps the host must have active before pipeline creation. Same
  // derivation the emit gate uses (requiredCaps: shape-derived + declared `enables`), so
  // reflection and assertCaps can never disagree about what a module needs; sorted for a
  // deterministic order. Always present, empty when the module needs nothing — the
  // `overrides` model, so a consumer never distinguishes "needs nothing" from "old
  // reflection shape".
  const requiredFeatures = requiredCaps(m).sort()

  return {
    bindGroups,
    uniforms,
    storage,
    ...(vertex ? { vertex } : {}),
    entries,
    overrides,
    requiredFeatures,
    requires: (m.externs ?? []).map((e) => ({
      name: e.name,
      type: typeKey(e.type),
      wgsl: e.spelling?.wgsl ?? e.name,
      glsl: e.spelling?.glsl ?? e.name,
      ...(e.stage ? { stage: e.stage } : {}),
    })),
  }
}
