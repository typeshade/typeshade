// Implements: Rule 4.8, Rule 6.8, Rule 11.10 (docs/language-design.md; traced in reqs/).

import { withoutKernels } from './ir/kernels.js';
import { emittedName, inheritSpellings, spellingsOf } from './spelling-plan.js';
import {
  type ShaderType,
  type ModuleDecl,
  type AddressSpace,
  type Capability,
  storageTextureLayoutAccess,
  type BindingDecl,
  typeKey,
  stageOf,
  workgroupShapeOf,
  type WorkgroupShape,
} from './ir/index.js';
import { entryIo, type IoField } from './ir/entry-io.js';
import { vertexLayoutOfEntry } from './vertex-layout.js';
import {
  requiredCaps,
  requiredLanguageFeatures,
  type LanguageFeature,
} from './passes/required-caps.js';
import { bindingStages } from './passes/stage-bindings.js';
import { sampledTextures } from './passes/texture-pairs.js';
import { fp64Lower, type Fp64Flavor } from './passes/fp64-lower.js';
import { consoleBuffer } from './passes/console-buffer.js';
import { glslDataTextureOf } from './glsl-data-texture.js';
import { structLayout, type StructLayout } from './reflect/layout.js';
import type { ResourceKind, BindEntry, BindGroup } from './reflect/bind-entry.js';
export type { ResourceKind, BindEntry, BindGroup } from './reflect/bind-entry.js';
export { typeLayout, wgslLayout } from './reflect/layout.js';
export type { LayoutKind, FieldLayout, StructLayout } from './reflect/layout.js';

function glslOnly(
  name: string,
  wgsl: ReadonlyMap<string, string>,
  glsl: ReadonlyMap<string, string>,
): { emittedGlsl?: string } {
  const g = emittedName(glsl, name);
  return g === emittedName(wgsl, name) ? {} : { emittedGlsl: g };
}
/** One `@location` input of the module's `@vertex` entry point, from a loose parameter or a
 *  located struct field. Attributes follow declaration order, and each `offset` is the end
 *  of the previous attribute. These formats use 4-byte lanes and require no padding between
 *  attributes. Reordering inputs can change their offsets. `type` is the DSL type key (the string
 *  {@link typeKey} returns), the same spelling `StructLayout.fields[].type` uses.
 *
 *  Exported from `typeshade`.
 */
export interface VertexAttr {
  readonly name: string;
  /** The parameter's name in the emitted text (Rule 11.10). */
  readonly emitted: string;
  /** The location, written (`location<n, T>`) or given by the compiler (Rule 6.6, change
   *  0135). */
  readonly location: number;
  readonly type: string;
  readonly offset: number;
}
/** The vertex-buffer layout for a module's `@vertex` entry: every `@location` input and the
 *  interleaved, tightly packed `arrayStride` they fill. {@link reflect} describes the
 *  first `@vertex` entry it finds in `module.funcs`; a module with more than one vertex entry
 *  point gets a `VertexLayout` for the one declared first. `Reflection.vertex` is `undefined`
 *  when the module has no `@location` vertex parameters.
 *
 *  Exported from `typeshade`.
 */
export interface VertexLayout {
  readonly attributes: readonly VertexAttr[];
  readonly arrayStride: number;
}
/** One field of an entry point's stage interface: a `@location(n)` varying, vertex attribute
 *  or fragment draw buffer, or a `@builtin(name)` slot. Where the entry spelled it as a member
 *  of a struct parameter or struct return, the field is reported flattened out of that struct;
 *  see {@link EntryIo}.
 *
 *  Exported from `typeshade`.
 */
export interface EntryIoField {
  /** The field's own identifier: a parameter's name, a flattened struct field's name, or
   *  `_ret` for a bare non-struct return value (the name the GLSL backend gives that
   *  output). */
  readonly name: string;
  /** The field's name in the emitted text (Rule 11.10). */
  readonly emitted: string;
  /** The DSL type key (the string {@link typeKey} returns), the same spelling
   *  `StructLayout.fields[].type` and `VertexAttr.type` use. */
  readonly type: string;
  /** The location, written (`location<n, T>`) or given by the compiler (Rule 6.6, change
   *  0135). Absent on a `@builtin` field and on an unattributed one of a module built in code;
   *  the two are told apart by whether `builtin` is set. */
  readonly location?: number;
  /** The declared `@builtin(name)`, in WGSL's own vocabulary (`position`, `vertex_index`,
   *  …). Builtins are reported alongside locations. A consumer that compares varyings and
   *  leaves builtins out (they are not varyings) filters on this field, and can then report
   *  that `position` was excluded because it is a builtin. */
  readonly builtin?: string;
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
 *  Exported from `typeshade`.
 */
export interface EntryIo {
  readonly inputs: readonly EntryIoField[];
  readonly outputs: readonly EntryIoField[];
}
/** One `@vertex`, `@fragment` or `@compute` entry point: its stage, its parameter and return
 *  types as DSL type keys (the strings {@link typeKey} returns), and, for a `@compute` entry
 *  only, its workgroup size, which defaults to 64 when the entry declares none, matching the
 *  WGSL backend's own default. {@link semanticDiff} fingerprints a module's public interface
 *  with this shape: two modules whose entries differ here have a different pipeline contract
 *  even if every other byte of emitted source matches.
 *
 *  Exported from `typeshade`.
 */
export interface EntryInfo {
  /** The entry's authored name, the one the host calls it by (Rule 11.10). */
  readonly name: string;
  /** The entry's name in the emitted text (Rule 11.10). Equal to `name` when the target
   *  spells it as written. */
  readonly emitted: string;
  readonly stage: 'vertex' | 'fragment' | 'compute';
  /** The `x` workgroup extent of a compute entry. A host sizing a dispatch reads
   *  {@link EntryInfo.workgroupShape}, which also carries `y` and `z`. */
  readonly workgroupSize?: number;
  /** The `[x, y, z]` workgroup extents of a compute entry, WGSL's `@workgroup_size(x, y, z)`
   *  with a missing extent as 1: a dispatch of `n` invocations along an axis needs
   *  `ceil(n / extent)` workgroups on it. */
  readonly workgroupShape?: WorkgroupShape;
  /** Override identifiers for the corresponding axes in `workgroupShape`. Each selected value
   *  replaces the corresponding default extent when a host creates a compute pipeline. */
  readonly workgroupSizeOverrides?: readonly [
    string | undefined,
    string | undefined,
    string | undefined,
  ];
  readonly inputs: readonly string[];
  readonly output: string;
  /** Present, as `true`, when the entry is declared a portable kernel; absent otherwise,
   *  never `false`. It tells a host which dispatch shape the kernel needs: on a backend with
   *  no compute stage a portable kernel emits as fragment-shader GPGPU and is dispatched as
   *  a fullscreen draw into an `R32UI` target instead of a compute dispatch. An entry
   *  without it runs on WebGL2 as the pass program when it reaches no texture (Rule 8.24). */
  readonly portable?: true;
  /** The entry's location and builtin interface, in structured form. `inputs` and `output`
   *  are type keys, which is what {@link semanticDiff} fingerprints with; `io` is the view
   *  beside them that a host validating a stage pair reads for the `@location` numbers.
   *  Always present. See {@link EntryIo} for how struct parameters and returns flatten. */
  readonly io: EntryIo;
}
/** A pipeline specialization constant (a WGSL `override`) the host supplies when it creates
 *  a pipeline. Both backends' host-side shapes derive from it: the WGSL `constants`
 *  dictionary is `{ [name]: value }`, and the GLSL `#define` header is one
 *  `#define <name> <value>` line per entry. Both are keyed by `name` and fall back to
 *  `default` when the host supplies nothing.
 *
 *  Exported from `typeshade`.
 */
export interface OverrideInfo {
  /** The override's authored name, the one the host supplies it by (Rule 11.10). */
  readonly name: string;
  /** The GLSL spelling of the override, present only when it differs from `emitted` (D3). */
  readonly emittedGlsl?: string;
  /** The override's name in the emitted text (Rule 11.10). */
  readonly emitted: string;
  readonly type: string;
  readonly default: number | boolean;
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
 *  Exported from `typeshade`.
 */
export interface Reflection {
  readonly bindGroups: readonly BindGroup[];
  /** std140 uniform-buffer struct layouts (one per uniform binding whose type is a struct). */
  readonly uniforms: readonly StructLayout[];
  /** std430 storage-buffer struct layouts. */
  readonly storage: readonly StructLayout[];
  /** Vertex attributes from the first `@vertex` entry's `@location` inputs, its loose
   *  parameters and the located fields of its struct parameters, tightly packed in the order
   *  written: the layout `packModule()` and the manifest carry (Rule 6.8). */
  readonly vertex?: VertexLayout;
  readonly entries: readonly EntryInfo[];
  /** Pipeline specialization constants: the names, types and defaults the host passes at
   *  pipeline creation (WGSL `constants`, or the GLSL `#define` header). Always present;
   *  empty for a module that declares no overrides. */
  readonly overrides: readonly OverrideInfo[];
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
  readonly requiredFeatures: readonly Capability[];
  /** Every WGSL *language* extension this module needs (§50), sorted and deduplicated. Always
   *  present; empty for a module that needs none, which is most.
   *
   *  This is the `requires` axis of WGSL, not the `enable` axis {@link requiredFeatures}
   *  reports: a language extension changes what the WGSL text may SAY, and it is not requested
   *  at `requestDevice` — it is either present in the browser's WGSL implementation or not, so
   *  a host checks it against `navigator.gpu.wgslLanguageFeatures` before it builds the
   *  module. GLSL ES 3.00 has no such axis, and the resource capability carrying each row is
   *  what fails a module closed on that target.
   *
   *  Two rows today, and the writer DIRECTS only one of them — reporting a feature and writing
   *  `requires` for it are separate decisions, each measured. A storage texture bound `read` or
   *  `read_write` (or a `textureBarrier` call) needs
   *  `readonly_and_readwrite_storage_textures` to be a program at all, since core WGSL gives a
   *  storage texture `write` only, and the directive is accepted by the Tint the gate runs, so
   *  it is emitted. The packed 4x8 integer family (#152) reports
   *  `packed_4x8_integer_dot_product` and emits nothing: all eight builtins compile bare on the
   *  same Tint and the directive "changes nothing", so writing it could only fail a module
   *  closed on a browser that lacks the name.
   *
   *  ```ts
   *  for (const f of reflect(m).requiredLanguageFeatures) {
   *    if (!navigator.gpu.wgslLanguageFeatures.has(f)) throw new Error(`no WGSL ${f}`)
   *  }
   *  ```
   */
  readonly requiredLanguageFeatures: readonly LanguageFeature[];
  /** The host-provided globals this module references but does not declare: one entry per
   *  {@link externVar} declarator, reported so a composer can check them against what the
   *  host's prelude actually supplies. Always present; empty for a module that expects
   *  nothing from its host. Host-provided functions ({@link externFn}) have no declaration to
   *  report here; the `requires` list of an emitted fragment ({@link emitFragment}) covers
   *  those by walking call sites. */
  readonly requires: readonly ExternRequirement[];
}

/** One host-provided global a module expects, declared with {@link externVar}. `type` is the
 *  DSL type key (the string {@link typeKey} returns). `wgsl` and `glsl` are the per-target
 *  spellings the emit writes, and the host provides the global under those; `name` is the
 *  logical name the module uses. `stage`, when present, is the advisory stage the declaration
 *  named.
 *
 *  Exported from `typeshade`.
 */
export interface ExternRequirement {
  readonly name: string;
  readonly type: string;
  readonly wgsl: string;
  readonly glsl: string;
  readonly stage?: 'vertex' | 'fragment' | 'compute';
}

const ioField =
  (members: ReadonlyMap<string, string>) =>
  (f: IoField): EntryIoField => ({
    name: f.name,
    emitted: emittedName(members, f.name),
    type: typeKey(f.type),
    ...(f.location !== undefined ? { location: f.location } : {}),
    ...(f.builtin !== undefined ? { builtin: f.builtin } : {}),
  });

const resourceKind = (space: AddressSpace, t: ShaderType): ResourceKind =>
  t.kind === 'texture' || t.kind === 'depth-texture'
    ? 'texture'
    : t.kind === 'storage-texture'
      ? 'storage-texture'
      : t.kind === 'sampler' || t.kind === 'sampler-comparison'
        ? 'sampler'
        : space === 'storage'
          ? 'storage-buffer'
          : 'uniform-buffer';

/** Options for {@link reflect}. */
export interface ReflectOptions {
  /** The f64 emulation flavour the emit will use, the same {@link Fp64Flavor} the backend is
   *  given. It decides whether the module binds the `_fp64` guard, a 1x1 texture the
   *  emulated-double helpers read so that a fast-math compiler cannot reassociate their
   *  arithmetic: the `'float'` helpers (the default) read it and the `'integer'` helpers do
   *  not. Pass the same value the emit will get; a host that builds a bind group from a
   *  reflection computed with a different flavour is describing a different program than the
   *  one it runs. */
  readonly fp64Flavor?: Fp64Flavor;
  /** Where a `console` call is recorded: `'gpu'` reports the `_console` buffer the WGSL then
   *  binds (Rule 6.11, surface §66), as `_fp64` is reported. Pass the same value `compile()`
   *  got. Defaults to `'cpu'`, which adds no binding. */
  readonly console?: 'cpu' | 'gpu';
}

function bindingsIncludingInjected(
  m: ModuleDecl,
  flavor: Fp64Flavor | undefined,
): { readonly bindings: readonly BindingDecl[]; readonly lowered: ModuleDecl } {
  const lowered = fp64Lower(m, flavor !== undefined ? { flavor } : undefined);
  if (lowered === m) return { bindings: m.bindings, lowered };
  const declared = new Set(m.bindings.map((b) => b.name));
  const injected = lowered.bindings.filter((b) => !declared.has(b.name));
  return {
    bindings: injected.length === 0 ? m.bindings : [...m.bindings, ...injected],
    lowered,
  };
}

const sampleTypeOf = (
  t: Extract<ShaderType, { kind: 'texture' }>,
  paired: boolean,
): 'float' | 'unfilterable-float' | 'sint' | 'uint' =>
  t.elem === 'u32'
    ? 'uint'
    : t.elem === 'i32'
      ? 'sint'
      : paired && t.dim !== '2d-ms'
        ? 'float'
        : 'unfilterable-float';

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
 *    stride. Attributes are tightly packed in declaration order, with no padding between
 *    them. The stride is the sum of their format sizes, as in `packModule()` and the manifest.
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
 *  A texture binding reports three more fields a host needs to create a matching view and
 *  layout. `textureDim` is `'2d'`, `'2d-ms'`, `'2d-array'`, `'cube'`, `'3d'`, `'1d'` or
 *  `'cube-array'`, and `textureElem` is the texel element, `f32`, `u32` or `i32`. Both axes are
 *  needed: WebGPU's `sampleType` must be `'uint'` or `'sint'` for an integer texture, and WebGL2
 *  must back one with an integer internal format. Getting that pairing wrong raises nothing on
 *  WebGL2, since a texture whose format disagrees with its sampler type is merely incomplete and
 *  reads zero. `sampleType` is the layout's own word for it, `'depth'`, `'uint'`, `'sint'`,
 *  `'float'` or `'unfilterable-float'`: an `f32` texture is `'float'` when a call of an entry
 *  pairs it with a `sampler`, and `'unfilterable-float'` when the entries only load, measure or
 *  count it, which a 32-bit float format needs.
 *
 *  Reflection is read-only over the IR and never runs on the emit path. It takes a module and
 *  never a backend, which is why every id it reports is target-neutral.
 *
 *  {@link wgslLayout} is the same offset engine on its own, for a single struct with no module
 *  around it.
 *
 *  Exported from `typeshade`.
 *
 *  @param m - the module to describe.
 *  @param opts - the emit facts that change what a host must bind, the fp64 flavour among
 *    them. Pass the same values the emit will get; a default here that disagrees with the
 *    emit describes a different program.
 *  @returns the target-neutral pipeline metadata described above.
 *
 *  @example
 *  ```ts
 *  import { reflect, hostFeaturesFor, wgslBackend } from 'typeshade'
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
  m = inheritSpellings(withoutKernels(m), m);
  const plan = spellingsOf(m);
  if (opts?.console === 'gpu')
    return reflect(inheritSpellings(consoleBuffer(m).module, m), { ...opts, console: 'cpu' });
  const structs = new Map(m.structs.map((s) => [s.name, s]));
  const { bindings: allBindings, lowered } = bindingsIncludingInjected(m, opts?.fp64Flavor);
  const stages = bindingStages(lowered);
  const sampled = sampledTextures(lowered);
  const byGroup = new Map<number, BindEntry[]>();
  for (const b of allBindings) {
    const e: BindEntry = {
      group: b.group,
      binding: b.binding,
      name: b.name,
      emitted: emittedName(plan.wgsl.bindings, b.name),
      ...glslOnly(b.name, plan.wgsl.bindings, plan.glsl.bindings),
      space: b.space,
      ...(b.access ? { access: b.access } : {}),
      resourceKind: resourceKind(b.space, b.type),
      owner: b.owner ?? 'module',
      ...(b.type.kind === 'struct' && b.owner === 'host'
        ? { glslSpelling: b.glsl ?? 'std140-block' }
        : {}),
      ...(b.type.kind === 'struct' ? { structName: b.type.name } : {}),
      ...(b.type.kind === 'struct'
        ? { structEmitted: emittedName(plan.wgsl.structs, b.type.name) }
        : {}),
      ...(b.type.kind === 'texture'
        ? {
            textureDim: b.type.dim,
            textureElem: b.type.elem,
            sampleType: sampleTypeOf(b.type, sampled === undefined || sampled.has(b.name)),
          }
        : {}),
      ...(b.type.kind === 'depth-texture'
        ? { textureDim: b.type.dim, textureDepth: true, sampleType: 'depth' as const }
        : {}),
      ...(b.type.kind === 'sampler-comparison' ? { samplerComparison: true } : {}),
      ...(b.type.kind === 'storage-texture'
        ? {
            textureDim: b.type.dim,
            storageFormat: b.type.format,
            storageAccess: storageTextureLayoutAccess(b.type.access),
          }
        : {}),
      ...(b.space === 'storage' && glslDataTextureOf(b.type, structs) !== undefined
        ? { glslDataTexture: glslDataTextureOf(b.type, structs)! }
        : {}),
      stages: stages.get(b.name) ?? [],
    };
    (byGroup.get(b.group) ?? byGroup.set(b.group, []).get(b.group)!).push(e);
  }
  const bindGroups: BindGroup[] = [...byGroup.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([group, entries]) => ({ group, entries: entries.sort((a, b) => a.binding - b.binding) }));

  const uniforms: StructLayout[] = [];
  const storage: StructLayout[] = [];
  for (const b of allBindings) {
    if (b.type.kind !== 'struct') continue;
    const s = structs.get(b.type.name);
    if (!s) continue;
    if (b.space === 'uniform') uniforms.push(structLayout(s, 'std140', structs, plan.wgsl));
    else storage.push(structLayout(s, 'std430', structs, plan.wgsl));
  }

  const entries: EntryInfo[] = [];
  let vertex: VertexLayout | undefined;
  for (const f of m.funcs) {
    const stage = stageOf(f);
    if (!stage) continue;
    const io = entryIo(f, structs);
    const shape: WorkgroupShape | undefined =
      stage === 'compute' ? (workgroupShapeOf(f) ?? [64, 1, 1]) : undefined;
    entries.push({
      name: f.name,
      emitted: emittedName(plan.wgsl.entries, f.name),
      stage,
      ...(shape !== undefined ? { workgroupSize: shape[0], workgroupShape: shape } : {}),
      ...(f.workgroupSizeOverrides !== undefined
        ? { workgroupSizeOverrides: f.workgroupSizeOverrides }
        : {}),
      inputs: f.params.map((p) => typeKey(p.type)),
      output: typeKey(f.ret),
      ...(f.portable === true ? { portable: true as const } : {}),
      io: {
        inputs: io.inputs.map(ioField(plan.wgsl.members)),
        outputs: io.outputs.map(ioField(plan.wgsl.members)),
      },
    });
    if (stage === 'vertex' && !vertex) {
      const layout = vertexLayoutOfEntry(f, m.structs);
      if (layout !== undefined)
        vertex = {
          attributes: layout.attributes.map((a): VertexAttr => ({
            name: a.name,
            emitted: emittedName(plan.wgsl.members, a.name),
            location: a.location,
            type: a.type,
            offset: a.offset,
          })),
          arrayStride: layout.arrayStride,
        };
    }
  }

  const overrides: OverrideInfo[] = (m.overrides ?? []).map((o) => ({
    name: o.name,
    emitted: emittedName(plan.wgsl.overrides, o.name),
    ...glslOnly(o.name, plan.wgsl.overrides, plan.glsl.overrides),
    type: typeKey(o.type),
    default: o.default,
  }));

  const requiredFeatures = requiredCaps(m).sort();

  return {
    bindGroups,
    uniforms,
    storage,
    ...(vertex ? { vertex } : {}),
    entries,
    overrides,
    requiredFeatures,
    requiredLanguageFeatures: requiredLanguageFeatures(m),
    requires: (m.externs ?? []).map((e) => ({
      name: e.name,
      type: typeKey(e.type),
      wgsl: e.spelling?.wgsl ?? e.name,
      glsl: e.spelling?.glsl ?? e.name,
      ...(e.stage ? { stage: e.stage } : {}),
    })),
  };
}
