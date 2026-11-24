import type { Capability } from '../ir/index.js';
import type { LanguageFeature } from '../passes/required-caps.js';
import type { Fp64Flavor } from '../passes/fp64-lower.js';
import type { StructLayout } from './layout.js';
import type { BindGroup } from './bind-entry.js';
import type { VertexLayout, EntryInfo, OverrideInfo, ExternRequirement } from './entry-types.js';

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
