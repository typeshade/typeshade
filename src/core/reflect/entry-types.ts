import type { WorkgroupShape } from '../ir/index.js';

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
