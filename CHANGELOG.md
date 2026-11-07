# Changelog

All notable changes to `typeshade` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before `1.0.0` the minor is the breaking
position: a breaking change ships only in a new `0.N.0`, and a `0.N.P` only fixes and adds.
What counts as breaking, and the deprecation window a change of meaning takes, are design rules
13.9 and 13.10 (`docs/language-design.md`; the procedure is `RELEASING.md#7-versions-and-deprecations`).
A released version is headed `## [X.Y.Z] - YYYY-MM-DD`.

This file starts where TypeShade was separated from the X-GIS monorepo. Everything before that
— the IR, the three backends, the pass pipeline, and the breaking changes that shaped them — is
in [`docs/HISTORY.md`](docs/HISTORY.md), kept as its generator produced it. Nothing in this
repository was published to npm before **`0.1.0`, the first release**.

## [Unreleased]

### Added

- **Pure shader root aliases** (change 0126, #780). A file containing only the shader directive
  and one value export-star retains its terminal target's private declarations, module
  directives and binding slots through alias chains. Ordinary imports remain selective.
  Named host exports, requested-path identity and existing package naming remain unchanged.

- **Optional empty fragment bindings** (change 0125, #454). A full-screen fragment entry
  that reaches no host-supplied binding accepts `fs(canvas)`, `fs(canvas, undefined)` or
  `fs(canvas, {})`. Runtime-owned guards do not require an argument; reached authored bindings
  remain required. Compute argument positions and existing invalid-value checks are unchanged.

- **A statement budget in debug launch configurations** (change 0124, #215).
  `DebugLaunchConfig.maxSteps` accepts a positive integer and forwards it to the debugger's
  existing session budget. The resolver and JSON Schema reject invalid values. Omission
  remains unbounded; stepping and resume share the same budget.

- **Scalar `f64` module constants** (change 0123, #967). Literal expressions, earlier constants
  and permitted builtin calls fold to a double for the CPU and a literal pair for both GPU
  targets. Explicit `f32` boundaries are preserved, and nonfinite or unrepresentable results
  are diagnosed at the declaration. Namespace constants and unwritten static fields share
  the same behavior. An earlier `f32` constant contributes its recorded compile-time value,
  which need not reproduce its GPU builtin expression. The editor now gives `Math` constants
  the compiler's `f32` type, while literal `f64` contexts retain their double values.

- **Portable fusion identities** (change 0122, #805). `hostFace` accepts an exact `origin`
  independent of its source `fileName`. Vite's opt-in `originNamespace` combines a package
  namespace with each module's path relative to the project root. Distinct packages need
  distinct namespaces. Defaults, source paths and shader behavior remain unchanged.

- **The subgroup variant of a kernel function's WGSL** (change 0119, stage 1). A kernel function
  whose loop reduces a `u32` or an `i32` with any operator, or an `f32` with `min` or `max`, or
  scatters into an integer array with a write a lane makes at most once, gets a second text
  beside its WGSL, `wgslSubgroup` on the face (and `wgslSubgroupInteger` when the module emulates
  `f64`), in which each subgroup folds first with the subgroup function of the operator: a
  reduction takes one barrier in place of the tree's eight, and a scatter folds the lanes that
  share a key before one lane adds. The text needs the `subgroups` feature; the bits it writes
  are the tree's and the atomics', so a float sum stays on the tree in both texts. The face marks
  each loop the variant folds (`subgroupFold`). Measured on Tint (Chrome for Testing 153,
  SwiftShader, subgroup size 4): both texts of a `u32` sum, an `i32` `min`/`max` pair and two
  histograms compile and write equal bits. Nothing an author writes changes; the runtime's
  selection of the text is the next stage.
- **The runtime selects the subgroup variant by feature and probe** (change 0119, stage 2). When
  a WebGPU device opens, through `createDevice()` or on the call layer's first call, and the
  adapter has the `subgroups` feature, the call layer requests it (never requires it) and runs a
  known-answer probe: one workgroup of 256 lanes folds a reduction and a scatter in the exact
  shape the variant emits, and the host compares the folds with their answers. Where the probe
  passes, every kernel call of that owner dispatches the subgroup variant of a face that has one;
  where it fails, or the feature is absent, or `createDevice({ subgroups: 'off' })` keeps it
  off, the call runs the tree text. `device.info.subgroups` records what the probe saw: the
  adapter's size range, the subgroup size and count one workgroup had, and whether a subgroup's
  lanes were consecutive. `device.statistics.variants` names the text the last call of each
  kernel function dispatched, `'subgroup'` or `'tree'`. Measured on SwiftShader (subgroup size 4) by the `subgroup-folds` journey: a sum, a histogram and a min/max pair over 1000 integers
  write the bits the plain-JavaScript reference computes.
- **The rules of the subgroup variant** (change 0119, stage 3). Rule 8.22 names the variant of a
  reduction and a scatter and the operators it is emitted for; Rule 10.2 keeps a feature a
  variant alone needs out of `requiredFeatures`; Rule 11.23 (new) says what a variant is, that
  its bits are equal, and that the runtime selects it when a device opens by feature and probe.
  Surface §38, §65 and §69 and the authoring guide describe it. The proposal's draft called the
  rule 11.22, which change 0107's numerical contract took first.
- **A numerical contract, opted into per function** (change 0107, stages 1 and 2; Rule 6.7, Rule 9.6,
  Rule 11.22, surface §3, §38 and §78). `const f = numerics(["finite-math"], function f(…) { … })`, or
  a stage call's `{ numerics: [...] }` option, lets `-O2` fold `x * 0`, `x - x`, `mix(a, b, 0)`
  and `mix(a, b, 1)` in that function, which the default keeps because a NaN or an infinity can
  observe them. Only `f32` operands are matched, so no rewrite reaches the emulated double, and
  no inlining pass moves a body into or out of an opted-in function. The CPU oracle keeps the
  source's meaning. `reassociate` is a valid class with no rewrite yet. A wrong list, and the
  call anywhere but as a top-level `const`'s initializer, is the new code `TS8078`. The IR gains
  `FuncDecl.numerics` and the exported type `NumericsClass`. The determinism report lists each class
  a function opted into as a `contract` row (the new `DeterminismKind` value), after every other
  row.
- **The subgroup built-in functions and values** (change 0117; Rule 11.21, surface §50 and
  §77). The 21 functions of WGSL's `subgroups` extension (`subgroupAdd`, `subgroupBallot`,
  `subgroupElect`, `subgroupBroadcast` and the rest) and the built-in values `subgroup_id` and
  `num_subgroups` are authorable, with WGSL's signatures from `core.def` through the overlay. A
  call derives `enable subgroups;` and the host feature, as the two existing built-in values do.
  On the CPU oracle and on GLSL ES 3.00 a subgroup is one invocation, so a program stays usable
  on WebGL2; the determinism report lists a float fold as `order` and a float broadcast or
  shuffle as `target`. The front end refuses an argument no row takes, a computed
  `subgroupBroadcast` lane, a vertex entry and a call outside uniform control flow, each in a
  sentence. `examples/subgroup-reduce.shade.ts` is the use #536 asked for. No code or export is
  added; `subgroupMatrix*`, the `quad*` functions and `@subgroup_size` stay out.
- **Each group of a `fuse` report names the tier it ran on** (change 0118; Rule 11.13, surface
  §71). Every group of `FuseReport.groups` has `tier`, `'webgpu'`, `'webgl2'` or `'cpu'`, and the
  plan's `tier` stays the best of them. A group that ran on a later tier than its plan's, and that
  the planner gives no other reason, says why in `why`: `b runs on the CPU, ` or
  `b runs on WebGL2, `, then the reason of each tier of the owner's policy before its own, in the
  words the `Error` of a call that no tier can run gives that tier. With
  `configure({ prefer: ['webgl2', 'cpu'] })` a reduction says `total runs on the CPU, it runs on
the CPU, loop 1 reduces, which WebGL2 has no workgroup memory for`. The plan settles each call's
  tier with the checks the call layer runs (`tierFit` and `entryTierFit`, one place for each
  reason), a WebGL2 program the driver refuses among them. So a call that WebGPU refuses after the
  device check (a texture of the CPU tier's memory, stores or a device-held range past the device's
  storage buffers, pushes after a held length that only the CPU tier starts from) reports the tier
  it ran on and no `workgroupShapes`. `mergeReports` keeps each group as its report held it. A
  host or a test that writes a `FuseReport` literal by hand adds `tier` to each group. The tier
  checks and the sentence add code to the call layer and the executor, so four caps of
  `scripts/bundle-budget.json` take the measured gzip sizes, single file: `typeshade/runtime`
  149,943 to 150,134 (+191), `typeshade/fuse` 111,283 to 111,461 (+178), `typeshade/algorithms`
  47,986 to 48,084 (+98) and `typeshade/random` 31,816 to 31,901 (+85). The split totals of the
  runtime and fuse move from 151,804 to 152,037 and from 111,762 to 111,902, and the runtime's
  split initial from 36,465 to 36,469; the floors and `typeshade/emit` do not change.

### Changed

- **Each fuse report group counts its device commands (§71, change 0121).** Required `group.dispatches` includes WebGPU push stages, reduction folds and store-only entries, WebGL2 draws, and zero on the CPU. Group counts sum to the plan total. Hand-built `FuseReport` groups must add the actual count; CPU groups add `dispatches: 0`. This source-breaking type change requires a new minor release before 1.0. Bundle measurements add 23 bytes gzip to runtime, 76 to fuse, 75 to algorithms and 48 to random; split aggregate grows by 100 bytes for runtime and 127 for fuse, with floors unchanged.

- **A constant argument reaches a function under a numerical contract** (#850 N5; Rule 11.22).
  At `-O2`, a call that passes a scalar literal to a function opted in with `numerics(...)` calls
  a copy of it with the literal in place, so `finite-math` folds what the literal decides:
  `tick(b, x, 0., 0.)` on a `tick` that returns `mix(base, x, curl) + spread * hash(base.xy)`
  becomes a copy that returns `base`. Calls with the same literals share a copy, and the original
  is dropped once no call reaches it. An exact function is never copied, so the default output
  does not change, and no golden moved.

- **The design rules say what TypeShade borrows (change 0100).** `docs/language-design.md`
  now defines a `"use typeshade"` program by its own rules: a form borrowed from ECMAScript keeps
  ECMAScript's meaning, a form borrowed from WGSL keeps WGSL's, and a rule records each
  difference (Rules 1.1 and 1.3). New §1.8 adds Rules 1.4 to 1.7: TypeScript's spelling first,
  the representation is the compiler's, TypeShade code is compute code, and every extension
  projects to valid TypeScript. Rules 2.1, 3.6, 4.1, 4.5 and 13.6 follow, and Appendix B lists
  the open units of `docs/typeshade-plan.md`. No program changes its result or its diagnostics.
- **O2 reuses values across calls and storage reads.** Specialization, producer/consumer
  fusion, aggregate splitting and shared arithmetic helpers remove intermediate work.
  Stable storage regions and bounded loops reuse loads; writes and synchronization end reuse.
  Scoped loop hoisting, overwritten-copy sinking and final reduction-barrier cleanup are included.
  SwiftShader measurements, controls and limitations are recorded in `docs/performance.md`.
  Paired Linux bundle measurements use Bun 1.4.4 against `64a9a5db`, retaining all exports at gzip level 9.
  Runtime single-file/aggregate bytes change from 134,408/136,477 to 143,872/145,808;
  emit changes from 101,183 to 110,453 in both forms;
  fuse changes from 95,844/96,260 to 105,237/105,745.
  Seven exceeded caps take these measured values. Runtime/fuse initial caps, all floors,
  algorithms and random remain unchanged. Public APIs and language rules are unchanged.

- **Reuse default WGSL within a host compilation.** The Vite host manifest uses the front
  end's already validated output, avoiding a second default emit/optimization. Explicit emit
  options still run their own pipeline. Generated shader/host code and diagnostics are unchanged.
  Paired Linux measurements on 2026-10-30 with Bun 1.4.4, retaining all exports at gzip level 9,
  increase emit from 101,178 bytes at `31b7066b` to 101,183 bytes in each build form.
  Only the single-file and split initial/aggregate caps rise by five bytes; all floors and other caps remain unchanged.

- Record the merged `typeshade/emit` bundle at 101,178 gzip bytes on Bun 1.4.4.
  Its single-file and split initial/aggregate caps rise by three bytes; all floors and other caps remain unchanged.

- Accept `T | null` and `T | null | undefined` in function-scope declarations, including classes, members, callbacks and generics. Preserve absent identity through conversions, strict tests, narrowing and optional chains (0098).

- **Boundary allowances follow paired Windows/Linux correctness measurements.** Each stock/
  candidate pair used the same Bun/dependencies within its host, retaining all exports with
  gzip level 9. Stock was `05618`, with only source-path normalization in the Windows control
  and no source changes in Linux CI. On Windows
  (Bun 1.4.2+744846f84), single-file bytes changed from 127,219 to 128,028 for runtime and
  88,842 to 89,476 for fuse. Emit's split initial/aggregate changed from 95,174 to 96,435 bytes;
  fuse's split aggregate changed from 89,117 to 89,764. Those Windows measurements initially
  set five caps. Stock Windows fuse was already 2 bytes above its old 88,840 cap. Runtime's
  measured Windows split initial/aggregate remains 35,086/129,192.
  Paired Linux CI runs used the same Bun 1.4.4+38afee6c8: runtime's split initial changed
  from 36,293 to 36,292 and aggregate from 129,352 to 130,101 (+749); fuse's initial changed
  from 13,591 to 13,592 (+1) and aggregate from 89,207 to 89,859 (+652). Fuse's entry grew
  from 203 to 204 bytes while its initial shared chunk stayed 13,388. Linux single-file
  runtime/fuse measured 127,219/88,840 for stock and 128,028/89,473 for the corrected sources.
  The caps use the observed maxima across both hosts: runtime aggregate 130,101, fuse initial
  13,592 and fuse aggregate 89,859. There are seven changed cap keys against `05618`; runtime's
  initial cap stays 36,293, and every floor and other cap stays unchanged. The first Linux CI
  failure exposed the omitted split-cap coverage; it did not report a forbidden runtime dependency
  or CSP scan failure. The final common-face bake measures algorithms at 43,486 bytes, down 9
  from stock's 43,495; random remains 28,736 bytes. These are bundle-size measurements, without
  a GPU performance claim.

- **One explicit command initializes a Vite host project.** (Proposal 0085, initializer stage;
  surface §64.) `tshc init` configures the plugin, host-view resolution, shader project and synchronization hooks.
  It preserves unrelated settings and JSONC comments, refuses conflicts before writing, and makes no change on repetition.
  Standard Vite app references are selected automatically; `--project` selects another host config.
  Generated install, typecheck and build scripts synchronize views in order, with shared shader diagnostics before checks and builds.
  Explicit `--allow-empty` lets those hooks run before the first shader. Existing check/sync defaults and manual setup remain supported.
  Dynamic Vite configurations retain the manual path. No runtime initialization side effect, dependency, binding layout or release is added.

- **Kernel fusion facts are generated by default.** (Proposal 0085, compiler-facts stage;
  Rules 8.22, 8.23 and 11.13; surface §64, §65 and §71.) `typeshade()` and `hostFace()` include
  eligible kernels' full-layout facts and portable loop IR. `fuse: true` keeps the default;
  `fuse: false` omits the facts to reduce generated size. Eligible ordinary calls retain private
  input projection with facts present. Resident and fused calls keep full layouts.
  Metadata-free benchmark controls now request `fuse: false` explicitly.
  Measured on 2026-10-23 with Bun 1.4.3, imports external and gzip level 9: the five-kernel
  loop-fuse module is 4,289 bytes by default and 2,575 with `fuse: false` (1,714 more).
  A four-field object-input fixture is 2,033/1,429 bytes (604 more). Explicit `true` matches
  the default in both fixtures. These are payload measurements, without a performance claim.

- **Device owners negotiate their own capabilities.** (Proposal 0085, instance-options stage;
  Rule 11.8; surface §69.) `createDevice({ limits, features })` validates and copies requirements
  independently of the default owner. Requested devices negotiate them; supplied devices and runtimes
  must already enable them. Unavailable WebGPU requirements follow the owner's remaining tier policy.
  Existing default-owner `configure()` restrictions remain. Measured on 2026-10-23 with Bun 1.4.3
  and 1.4.4, retaining all exports: runtime single-file gzip grows from 126,968 to 127,219 bytes.
  Split initial/aggregate budgets move from 36,015/129,057 to measured 36,293/129,352 bytes.
  Algorithms measures 43,495 bytes (previous actual 43,488, budget 43,491) and random 28,736
  (previous actual 28,725, budget 28,729); their single-file and split budgets use those measurements.
  Emit and fuse budgets and every floor stay unchanged. No performance or release claim is assigned.

- **Local declarations destructure fixed-length arrays.** (Proposal 0086; surface §14 and
  §18.) `const [a, , c] = xs`, shorter patterns, homogeneous tuple annotations and nested
  object/array patterns lower to ordinary indexed reads and local copies. A literal binding
  source can infer its array type. Source calls and nested getters run once. Existing numeric
  conversion rules remain unchanged; defaults, rest and unknown-length patterns remain refused.

- **Device fusion needs no registration import.** (Proposal 0085, automatic-loading stage;
  design rules 11.11 and 11.13; surface §65, §67, §69 and §71.) `device.fuse()` records its body
  synchronously and reserves its queue position before loading a fixed package-owned executor.
  Loading failures reach recorded calls and written residents, and release scratch storage.
  Named and registration-only `typeshade/fuse` imports remain supported. Deploy all emitted assets.
  The boundary gate scans every split chunk and refuses missing, remote or computed import paths.
  Measured on 2026-10-23 with Bun 1.4.3, keeping every public export: the runtime single-file
  budget grows from 45,112 to 126,968 gzip bytes because that form inlines the executor.
  Repeated split fixtures measure 6,922–6,924 entry bytes, initial shared code 29,091,
  executor 73,786, WebGL2 runtime 18,599 and deferred shared code 657: initial 36,013–36,015
  and aggregate 129,055–129,057 bytes. Split budgets use the measured maxima.
  These are different build forms, not a claim that initial loading got smaller.
  The fuse single-file budget grows from 86,586 to 88,840; its split initial/aggregate values
  are 13,591/89,207 bytes. Emit measures 95,174, algorithms 43,488 and random 28,725 bytes;
  their single-file budgets remain 97,500, 43,491 and 28,729. New split budgets record measured
  initial and aggregate values, with separate floors. No release is assigned.

- **Ordinary host calls infer their device owner.** (Proposal 0085, owner-inference stage;
  design rule 11.8; surface §65, §67 and §69.) Kernel functions, compute entries and draws
  select the unique owner of their resident arrays and device-created textures, including
  indirect workgroup counts. Plain values select no owner. Mixed owners are refused before
  execution. Calls captured before disposal complete; later calls are refused. A WebGPU canvas
  rebuilds device-specific drawing resources when its owner changes. Automatic fusion loading
  remains pending. Measured on 2026-10-23 with Bun 1.4.3: runtime grows from 45,092 to 45,112
  gzip bytes, fuse from 86,459 to 86,586, algorithms from 43,440 to 43,491 and random from
  28,673 to 28,729. Each budget moves from its previous value to that measured value.
  The emitter remains 95,174 bytes within its 97,500-byte budget. No release is assigned.

- **Host calls select an emulated-double flavor automatically.** (Proposal 0085, first stage;
  design rule 11.8; surface §39 and §65.) `createDevice()` and the default call owner now use
  `'auto'`: actual device or retained creation-adapter signals select `'integer'` on Apple or
  Metal, otherwise `'float'`; CPU selects `'float'`. Explicit overrides remain supported.
  Unknown GPU signals retain the float fallback without proving precision on that hardware.
  `DeviceOptions` rejects conflicting `prefer`, `device` and `runtime` values during type checking
  as well as execution. Compose extended options with an intersection instead of an interface
  extending `DeviceOptions`. No release is assigned. Measured on 2026-10-23 with Bun 1.4.3:
  runtime grows from 44,873 to 45,092 gzip bytes, fuse from 85,831 to 86,459, algorithms from
  42,818 to 43,440 and random from 28,054 to 28,673. Their budgets move from 44,900 to 45,092,
  86,000 to 86,459, 42,850 to 43,440 and 28,100 to 28,673 respectively. The emitter remains
  95,174 bytes within its 97,500-byte budget. Compiler and CSP boundaries remain enforced.

- **Hosts read shared build and device information.** (Proposal 0083; design rules 11.8,
  11.11 and 11.17; surface §65 and §69.) `buildInfo` and `TypeShadeBuildInfo` expose the
  package version and nullable clean source revision from the root and runtime entry points.
  Modified or unstamped sources report `revision: null`. `Device.info` and `Runtime.info`
  expose frozen historical `DeviceInfo` snapshots of the actual opened device or context,
  with enabled WebGPU capabilities and explicitly attributed nullable identity. External
  devices never cause an unrelated adapter request. No telemetry or per-call execution
  attribution is added. On 2026-10-22, main `918c0149` measured 44,244 gzip bytes for
  `typeshade/runtime`, 42,587 for `typeshade/algorithms` and 27,822 for `typeshade/random`.
  With the integrated metadata helpers they measure 44,847, 42,800 and 28,037 bytes.
  Their budgets move from 44,600 to 44,847, from 42,587 to 42,800 and from 27,822 to
  28,037 bytes respectively. Fuse measures 85,827 bytes within its 86,000-byte budget.
  The compiler and package remain outside the runtime closure.

- **Private kernel input projection (0082).** Read-only flat scalar object arrays can upload
  only live fields. Full logical validation and field-read order remain intact. Resident,
  fused, written and unproved inputs keep full AoS. No public API or external buffer layout changes.
  Bundle measurements with Bun 1.4.3: the algorithms budget moves from 42,400 to 42,587 gzip bytes,
  and the random budget from 27,600 to 27,822. The measured values include private packing and variant selection.

- **Proposal 0081 is complete in the compiler.** A numeric `Record` accepts enum or integer
  literal keys with values 0 through N-1 and indexes by value. Kernel `Map` and `Set` parameters
  accept string literal key types, converting host strings to GPU ids and back in insertion
  order. Open string keys remain refused. The `string-keys-record` host example runs on all
  three tiers. Deviation D1 remains open: bindings and arrays with no size retain numeric ids
  and Record arrays in id order.

- **A WebGL2 draw sets the stencil test and the polygon offset from its pipeline.** (Proposal 0064, design rule 11.11, surface §69.) Every draw sets `STENCIL_TEST` and `POLYGON_OFFSET_FILL` from its pipeline, and the stencil functions, operations and masks when the pipeline has `depth.stencil`. A value that the host set through `Runtime.device` no longer reaches a runtime draw. A pass leaves the stencil test, the stencil functions and operations, and the polygon offset as its last draw set them. It sets the stencil write mask to full. No version is published, so this is not yet a breaking change.

- **`depth.compare` is a `CompareFunction`, and every key of a render state is checked.** (Proposal
  0064, design rule 11.11, surface §69.) A typo in `depth.compare` stops compiling under `tsc`. A
  state held in a variable without an annotation does too. Annotate it with `: RenderState`,
  `satisfies RenderState` or `as const`. `SamplerOptions.compare` takes the same type. An unknown key
  on `RenderState` is a `TypeError` that names the key. An unknown key on `depth`, `primitive`,
  `multisample` or an object target is a `TypeError` that names the keys that object takes.
  Two spellings of one state, with a default written or omitted, give one `RenderPipeline`. A WebGL2
  pass clears depth and stencil with two calls. It sets its viewport, depth range and blend
  constant at its start. It gives the host's values back at its end. Measured on 2026-10-19 after
  the second merge of `origin/main` (`492902c3`), `typeshade/runtime` is 38,254 bytes gzipped
  against a budget of 39,000 bytes, the budget `main` records. The baseline before proposal 0064
  was 30,389 bytes against 30,450 bytes.
- **A pass checks every key and value of its targets.** (Proposal 0064, design rule 11.11, surface §69.) An unknown key on `PassTargets`, a colour entry, a depth attachment or a `stencil` object is a `TypeError`. The sentence names the key and the keys that object takes. A WebGPU name, such as `depthStoreOp`, is refused with its TypeShade name. A depth `clear` outside 0 to 1 is refused on both tiers, whatever the load. `stencil8` is refused as a depth attachment. The doc of `PassTargets` no longer says that every attachment is stored. No version is published, so none of this is a breaking change yet.
- **A colour entry of a pass is typed.** (Proposal 0064, design rule 11.11.) The object member of a colour entry is `object & { readonly target?: never }`. A typo in a colour entry stops compiling. A host object with its own `target` property takes the typed arm. A literal host object with an unknown key, written inline, stops compiling. No version is published, so this is not a breaking change yet.

- **A host picks the flavor of the emulated double at run time** (proposal 0073; design rules
  8.22, 11.8 and 11.13; surface §39, §64, §65 and §71). The generated module of a `.shade.ts`
  file that emulates `f64` carries its WGSL under both flavors, `'float'` and `'integer'`, and
  each kernel function that lowers carries its own. `createDevice({ fp64Flavor })` sets the
  flavor of a device and `device.fp64Flavor` reports it; `configure({ fp64Flavor })` sets it for
  the default owner. A kernel call, an entry call, a draw and a `fuse()` plan of that owner
  dispatch the WGSL of its flavor, the `_fp64` guard bound under `'float'` and absent under
  `'integer'`. The default stays `'float'`, byte for byte, and a module that emulates no `f64`
  is unchanged. `typeshade/runtime` exports `recommendFp64Flavor`, `isAppleGpu` and
  `Fp64FlavorSignals`, so a host that ships the runtime alone can pick the flavor from a WebGPU
  adapter's `info` and the user agent.
- **Every name TypeScript accepts compiles on both targets** (proposal 0070; design rules 3.2,
  3.3, 3.4, 9.5 and 12.3; surface §10, §48, §62 and §68). A binding, an override, a struct, a
  field, a helper function or an entry point whose name a target reserves or cannot spell takes a
  fresh spelling on that target (`half_`, `Self_`), and every reference with it. Reflection and
  the manifest name each emitted spelling beside the authored name: `emitted` is the WGSL one, and
  `emittedGlsl` is present where the GLSL one differs. The manifest is schema 2. The host binds and
  calls by the name written. `TS8068` keeps only its strict-mode meaning, a declaration that binds
  `eval` or `arguments`; its reserved-name errors and warnings are gone. A local or a helper
  parameter named like a builtin its function calls is respelled too.
- **A tiled compute entry is a call inside a `fuse` scope** (proposal 0069; design rules 8.24,
  11.8 and 11.13; surface §67 and §71). An entry call in the body of `fuse` is recorded, not
  refused: it forms a group of its own in the plan (fact F8), so no kernel call joins it, and it
  runs in the order the body made it. Its storage arrays with no size are `Resident`s, and a host
  array in their place is a `TypeError` that names the binding. A draw and a kernel call that
  writes a host array stay refused. A tiled entry that reaches a barrier needs a GPU tier there
  too: on a host with no WebGPU device and no WebGL2 context the plan is refused, as the call is
  outside a scope.
- **A builtin's scalar overload returns `ScalarOf<P0, …>`** (proposal 0063; design rules 9.6
  and 12.7; surface §49). The ambient library declares one type alias, `ScalarOf`, a new "type
  machinery" row of the extension table: the scalar of the first argument that carries a brand,
  `bool` for a boolean, `number` when none does. Each of the 49 scalar overloads generated from
  Tint's `core.def` returns it in place of a conditional chain written into the overload, five
  arms per argument. `pow`'s declaration goes from 462 characters to 92
  (`pow<P0 extends number, P1 extends number>(a0: P0, a1: P1): ScalarOf<P0, P1>`), `clamp`'s
  from 681 to 125, and the 49 lines from 15 727 characters to 3 735, so `dist/shade.d.ts` and a
  reference page print no brand symbols. No type moves: a call hovers as before
  (`pow<f32, f32>(a0: f32, a1: f32): f32`), and the compiler emits the same text. `ScalarOf`
  written where a shader type is due is refused, `TS8002`, in the compiler and in the editor
  alike. The name returns with a new meaning: an earlier row `ScalarOf`, a vector's element
  type, left the table with proposal 0007 (#210).
- **An `f32` scatter with `+=` at a computed index runs on the CPU tier in the tree order**
  (proposal 0056, step 2, slice 2a; option C; surface §65). In a kernel function's loop,
  `g[idx[i]] += x[i]` on an `f32` parameter array folds the contributions to each element in
  Rule 7.2's 256-wide tree, over the iterations in order. The CPU tier and the oracle compute it
  at the precision of the call. The GPU tiers do not lower it: the proof refuses it there, and
  `TS8070` stays. A program that compiles today computes the same, except a kernel loop that
  scatters `f32` values at an index the proof cannot show distinct: its sum now follows the tree
  order, which may differ from the sequential sum in the last places. The determinism report
  lists the scatter as an `order` row.
- **A reduction is one submission, with the dispatches that fold its partials** (proposal 0058,
  deviation D7; design rule 11.13; surface §71). The loop of a kernel function that reduces
  (`s += xs[i]`) and the dispatch for each level of its partials were a submission each, and the
  host read the partials back before every level. The partials of every level are now one device
  buffer for each variable that the loop and every level bind, each level has a uniform buffer of
  its own, and the one submission that holds the dispatches also copies the folded slot of each
  variable, from which the call makes its result. Nothing is read back between the levels. Inside a
  `fuse` scope the reduction joins the one submission of the plan, and the plan no longer submits
  what it holds before it: `add`, `mul` and `total` report 1 submission over 1,000 elements and over
  70,000, where they reported 2 and 3, and the copy of the folded slot adds none. A reduction called
  outside a scope runs through the same function, so it is one submission and not one for each
  level, and the error the device reports for a reduction with a level says "calls" where it said
  "call". The tree order of Rule 7.2 is untouched, and the results are the bits they were:
  `bench-reduce.mjs` holds a sum of random `f32` numbers to the same bits apart, in a scope and on
  the CPU tier, and the import journey's `f32`, `i32` and emulated `f64` reductions still equal
  their references. Measured on headless Chromium's WebGPU, a software adapter (SwiftShader), with
  the page counting `queue.submit` and `dispatchWorkgroups` on their prototypes: `add`, `mul` and
  `total` are 2 dispatches in 1 submission over 32,768 elements and 3 in 1 over 1,048,576 (2 and 2,
  and 3 and 3, before); the three calls apart are 4 dispatches in 3 submissions and 5 in 3 (4 and 4,
  and 5 and 5, before); the device is asked for 2 to 4 buffers fewer. In a browser that ran both
  builds and alternated the samples, `add → mul → total` over scratch arrays in a scope took 40.6 ms
  against 45.0 ms over 32,768 elements (the median of 100 paired differences is 4.3 ms, 69 of the
  100 pairs faster), and 1,643 ms against 1,683 ms over 1,048,576 (20 pairs), and `total` alone took
  the same time before and after. This is host wall time on a software device on a shared machine,
  not a hardware claim. The `typeshade/fuse` bundle is 74,243 bytes minified and gzipped (73,890
  before), within its budget of 86,000, and `typeshade/runtime` is 29,343 (29,340), within 29,800.
- **A flat `f32`, `i32` or `u32` array is copied as bytes.** A runtime-sized array whose host value is
  the matching typed array is validated, uploaded and read back by one copy of its bytes, not by one
  `DataView` call per element. Every value that is not a NaN is the same as before. A NaN keeps the
  bits it had, where the element path rewrote them, so a NaN's payload can differ from earlier
  builds. On Node, for 1,000,000 `f32` elements, the upload went from 10.1 ms to 1.7 ms and the
  readback from 9.9 ms to 0.4 ms (`scripts/pack-bench.ts`; host time, not a GPU measurement).

- **A struct or array held in a WGSL `let` is passed by pointer, and more returned structs are
  written in place (change 0105, #835).** A struct the module declares, or a fixed-size array, in a
  `let` becomes a `var` nothing writes, so a method on it takes a pointer, not a value copy. A
  struct returned into a module variable or a `read_write` storage element is written there
  through an `_into` copy of the callee. An index with no call is read in place, and writes are
  compared by path. Over the 148 WGSL goldens, methods taking their object by value fall from 72
  to 6.

- **A struct or array local reads the place it copies, and a returned struct is built in the
  caller's local (change 0104, #832).** A `const`, or a `let` never written, that copies a place
  reads the place itself when nothing writes it while the local is read. On WGSL, `dst = f(...)`
  into a local `var` calls `f_into(&dst, ...)` when that saves a copy. On WebGL2,
  `const q = items[i]` on an emulated storage element now compiles; it was `TS8015` before.

- **A call hands a place to a callee that only reads it (change 0103, #827).** On WGSL a read-only
  struct or fixed-size array parameter takes a pointer for each address space its calls pass a
  place in. A call keeps a by-value copy when its argument is no place or the place can change
  during the call. On GLSL ES 3.00 a callee given a module-scope place reads it by name, so a
  uniform block is no longer rebuilt at each call, and a read-only method on an emulated storage
  element now compiles for WebGL2.

- **A splat stays one constructor of its scalar (#831).** `vec4f(x)` now emits `vec4<f32>(x)` in
  WGSL and `vec4(x)` in GLSL, where it emitted `x` four times. A call in a splat is no longer
  spelled four times, and `vec2<f32>(0.5, 0.5)` becomes `vec2<f32>(0.5)`. 62 emit goldens change.

- **`cse-local` binds a repeated expression in a function that also calls something that writes
  (#829).** The pass used to skip the whole function. It now skips only the statement whose own
  expressions hold such a call, and binds repeats in every other statement to a `let` placed just
  before it. Values don't change.

- **The host call layer creates WebGPU pipelines with the asynchronous form (#706).** A kernel or
  entry called from the host, alone or in a `fuse` scope, and a host draw now use
  `createComputePipelineAsync` and `createRenderPipelineAsync` when the device offers them, as the
  program runtime already did. A device without them keeps the synchronous form. Chrome compiles a
  synchronous pipeline on its GPU process's main thread, which stops painting for the compile.

- **A `fuse` scope run again reuses its uniform buffer and bind groups on WebGPU (#658).** Each
  device keeps one growing uniform ring, bound at dynamic offsets, and a cache of bind groups of up
  to 512 entries. A `Resident`'s buffer leaves the cache before it is destroyed or replaced. A warm
  scope in `scripts/bench-fuse-scope.ts` makes no new uniform buffer or bind group. WebGL2, the
  CPU tier and draws are unchanged.

- **The WebGL2 compute executor links its programs once per context (change 0054, #520).** A
  dispatch used to compile and link its pass program and scatter each time; a per-context cache
  now keeps them, and a lost context links again. The host no longer reads the log's values back.
  On SwiftShader the compute corpus fell from 2446.5 ms to 242.4 ms.

- **The WebGL2 compute executor runs a pass as one draw of points (change 0054, #523).** One vertex
  is one invocation, and transform feedback captures its whole record in one draw. Records stay on
  the GPU between passes, and the host reads only their first texels. A multi-pass program no
  longer stops at its first pass on a feedback-loop error.

- **A WebGL2 compute read-back no longer blocks the page (change 0054, #524).** A read-back now
  waits on a fence and yields to the page between polls, then reads the words from one pixel pack
  buffer. A lost context throws with a message. The call layer's WebGL2 tier awaits the executor.

### Added

- **The host view spells each type with the shader's name, from the host type family** (change
  0116 with its Amendment 1; Rule 8.21, surface §64 and §74). `typeshade/runtime` exports, as
  types only, one name for each value type a shader writes: `f32`, `f64`, `i32`, `u32` and
  `bool`; `vec2` to `vec4` with their `f`, `i`, `u`, `b`, `f64` and `d` forms; every `matCxR`
  with its `matCxRf` alias and the `matN` spelling, a square one taking `f64` as a type argument;
  and `array<T>` and `array<T, N>`. Each is a name for a host value of Rule 8.21, which does not
  change. A scalar is the `number` or `boolean` it is, with its name as an optional phantom
  property, so a plain literal is one and an `f32` is not a `u32`. A vector and a matrix are
  `readonly` tuples of their components, and a matrix also has its name. `array<T>` is the typed
  array, or the array of structs, with its `Resident`; `array<T, N>` is a `readonly T[]`. The host
  view writes every parameter, result, constant, field and binding with those names and imports
  the ones it writes: `run(out: array<f32>, xs: array<f32>, filters: array<OnePole>, block: u32)`.
  A struct goes by its name as an argument and as a result, the class for an exported class, so
  a host passes an instance it built with `new`; the call still takes a plain object of the
  fields. A struct binding in the manifest's `Pack` is its name beside its packed forms. A result
  is `readonly`. A host program keeps type-checking where it holds each value in the shape the
  old spelling gave it; the exceptions are listed in §64 (a result written in place, a value of
  one name where another goes, a matrix of unknown length, a result held in a mutable tuple type,
  a plain object where a class's instance goes). The baked views of `typeshade/algorithms` and
  `typeshade/random` spell their scalars with the names (`axis: u32`, `Promise<f32>`), and a
  kernel function's numeric `Set` or `Map` key is `u32`, `i32` or `f32`. The family is held to
  the ambient library's value types, one for one, by `src/runtime/host-types.test.ts`. The
  runtime's split build moved by 1 gzip byte, from the names Bun's minifier gives the entry
  chunk, measured with Bun 1.4.4.
- **The host view carries the author's JSDoc** (proposal 0108; Rules 8.20, 8.21 and 11.8, surface
  §64). Each JSDoc block above an exported declaration of a shader module is written into the host
  view, as the author wrote it and in source order: on a function, a constant, an `enum` and each
  of its members, a class, an `interface` or a `type` and each of its fields, a `@compute` entry, a
  kernel function, a full-screen `@fragment` entry and an export that is `never`. A class carries
  the comment of each member the view declares, on the member's line: the constructor, a method,
  each half of an accessor and a static method (item 4 of the proposal, after change 0109 made a
  class a value of the host face). A member the view declares `never` has the author's blocks
  first and the sentence of the view at the end of the last block. A member a class takes from an
  exported base class stands in the base, with its comment, and a class declared without `extends`
  carries the comment of the base member. An overload signature with no body is not copied. A
  static field has no line in the view, so its comment is not copied either. A re-export of
  another shader file carries the comment of the file that declares it. The sentence the view
  writes itself stands at the end of the last block, after one empty comment line, so a hover
  shows the author's words first. The sentence of a kernel function and of a `@compute` entry also
  says that a call whose written arrays or bindings are all `Resident`s, and that returns nothing,
  may be made without `await`. The generated module does not change. The baked views of
  `typeshade/algorithms` and `typeshade/random` carry the comments of their shader sources.
- **A swizzle of distinct components is an assignment target** (proposal 0106; Rules 7.1 and
  7.2, surface §7 and §9). `v.xy = r`, `p.zx += r` and `c.rgb *= s` compile, for `=` and every
  compound `op=` the vector has. Every old component the operation reads is read into one `let`
  before any is written, so `d.xy *= d.yx` with `d = vec2(2., 3.)` gives `vec2(6., 6.)`; a
  non-constant index of the target that reads a place or calls is read once, first. The emitted
  code is one write per component on WGSL and GLSL ES 3.00, so WGSL's `swizzle_assignment`
  extension is not needed. A swizzle that names a component twice (`v.xx = …`) stays `TS8018`
  and names the component; an `@inout` argument, `++`, `--` and an emulated-double lane still
  take one component. On a read binding `v.xy = …` is now `TS8005`.

- **A `Math` member is bound to a short name with a `const`** (proposal 0113; Rules 6.3, 9.4 and
  9.5, surface §12 and §14). `const { sqrt, sin, PI } = Math`, `const { sqrt: s } = Math` and
  `const s = Math.sqrt` bind each name as an alias of the member, at module scope and in a
  function: a call is the member's call, a constant is its inlined `f32` literal, and nothing new
  is emitted on WGSL, GLSL or the CPU oracle. A bound name hides the builtin of its name in its
  scope, so `sqrt(v)` on a vector is refused there in both halves, with a sentence that names the
  fix (`TS8003`). A `let` of a function member, a rest element, a default and an `export` of a
  bound member stay refused (`TS8099`, `TS8014`). No code, export or example is added.

- **An exported class is a value of a module's host face** (change 0109; Rules 8.20 and 8.21,
  surface §64). A host file imports a class of a `.shade.ts`, builds an instance with `new`,
  which checks and converts its arguments and runs the class's constructor on the CPU tier, and
  calls its methods, accessors and static functions there; a method that changes its object
  writes the instance's fields back in place, and one that returns `this` returns the instance.
  The host view declares `export declare class`, with `extends` where the class above is exported
  as a class too and `abstract` where the class is, and the generated module exports a JavaScript
  class whose chain follows, so `instanceof` holds. A member that fails Rule 8.20's conditions is
  declared `never` with its reason, and the class stays a value; a class with a field that has no
  host value stays a type, `export interface`; a generic class stays `never`. An instance is taken
  wherever a struct's object is, and a struct a result holds is an instance of its class when the
  class is exported and not abstract, built without its constructor. `HostFace.exports` reports a
  class as its struct, so `hostFace` keeps the shape of its result. The class helpers in
  `typeshade/runtime/internal` (`callMember`, `fromShaderIn`) are dropped from every subpath;
  the budgets moved by 5 (runtime, split aggregate), 1 (fuse) and 6 (random) gzip bytes,
  measured with Bun 1.4.4 against `78a9060`.

- **A `Resident` of instances reads back as instances** (change 0109, Amendment 1; Rule 11.8,
  surface §65). `resident(value)`, `device.array(value)` and `r.write(value)` copy the value with
  the class of each object kept: an element of an array of structs, and a struct that a field
  holds. `await r.read()` returns a new copy with the same classes, each instance made from its
  class's prototype with the fields its own properties and its constructor not run, as a struct
  that a result holds is made; a plain object stays a plain object. A call that writes the
  `Resident` changes the fields on every tier, so `instanceof Voice` holds on what `read()`
  returns and `tick()` runs on it, as `Resident<Voice[]>` said (issue #945). The bytes that a GPU
  tier binds do not change. The copy no longer calls `structuredClone`, which an
  `AudioWorkletGlobalScope` does not have: a typed array is sliced, an array, a `Map` and a `Set`
  are copied entry by entry, and any other object level by level, so each place of the copy is a
  value of its own, also where the value given shares one array between two places. The runtime
  bundle grew by 33 gzip bytes (split initial +39, aggregate +40) and `typeshade/fuse` by 47
  (split initial +57, aggregate +57), measured with Bun 1.4.4 against `480b6a64`; the budgets
  moved by those bytes.

- **A kernel function's loop runs over a trip count the device holds** (proposal 0094, stage 3;
  Rules 8.21, 8.22, 11.8 and 11.13, surface §65 and §71). The statements before a loop, its start
  and its bound may read the elements of the function's arrays and what an earlier loop of the same
  call wrote, `out.length` of a pushed array included: `const n = count[0]; for (… j < n …)` no
  longer runs the function on the CPU tier. On WebGPU a range entry of one invocation computes the
  loop's start and trip count and the workgroups of its dispatch into a buffer the call makes, and
  the call dispatches the loop with `dispatchWorkgroupsIndirect` from it, in the same submission,
  with nothing read back; a trip count of 0 dispatches no workgroup. WebGL2 computes the range on the
  CPU tier from its host copies and draws the iterations inside the array the loop writes, and the
  CPU tier runs the function as written. A write such a loop makes past an array's end is dropped
  on every tier (decision D2): the front end guards each such write by the array's length in the IR,
  and the host no longer checks such a loop's writes before it runs. A function whose ranges read no
  element keeps its WGSL text and its face byte for byte. A loop over such a range that pushes or
  reduces, stores into a texture, writes through an `@inout` argument or writes an array the
  statements before it read runs the function on the CPU tier, and the host view says why. In a
  `fuse` scope such a call forms a group of its own, `b reads its trip count from an array`. The
  call layer grows the bundles, so the budgets move to the measured sizes: `typeshade/runtime`
  130,348 to 130,982 gzip bytes, its split initial 36,460 to 36,465 and its split total 132,484 to
  133,119; `typeshade/fuse` 91,789 to 92,409, its split initial 13,770 to 13,772 and its split total
  92,207 to 92,845; `typeshade/algorithms` 46,799 to 47,399 and `typeshade/random` 30,732 to
  31,308, each with its split initial and total. Every floor and `typeshade/emit` stay unchanged.
- **A kernel function pushes after a length a `Resident` holds, and two loops push onto one array
  on the device** (proposal 0094, stage 2; Rules 8.21, 8.22, 8.23, 11.8 and 11.13, surface §65 and
  §71). An array a loop pushes onto may come as `{ array, length, offset? }`: element `offset` of
  the `Resident<Uint32Array>` `length` is its length when the call runs, the pushes append after
  it, and the call leaves the new length there. On WebGPU the call runs a second WGSL text, in which
  the scan starts at the held length and writes the new length into it, so the count stays on the
  device and a call that returns nothing reads nothing back. A function that lowered before keeps
  its WGSL text byte for byte. The CPU tier starts the push count at the held length and writes the
  new one into the host copy. The call refuses, with a `TypeError` before anything runs, the object
  on an array no loop pushes onto (decision D5), a `length` that is not a live
  `Resident<Uint32Array>` made with `resident()` or `device.array()`, an `offset` that is no whole
  number or is past it, and a `length` that is another argument; the host view types the object on
  a pushed array only. Two loops that push onto one array now run on WebGPU, the second after the
  first (closing deviation 3 of change 0078), and a store after the loops may read a pushed array's
  length, `count[0] = list.length`. In a `fuse` scope such a call forms a group of its own,
  `b pushes after a held length`. On a device that allows a stage fewer storage buffers than the
  entry that stores after the loops binds, the call runs on the next tier and says why. The call
  layer grows the bundles, so the budgets move to the measured sizes: `typeshade/runtime` 129,082
  to 130,348 gzip bytes, its split initial 36,293 to 36,460 and its split total 131,157 to 132,484;
  `typeshade/fuse` 90,552 to 91,789, its split initial 13,595 to 13,770 and its split total 90,888
  to 92,207; `typeshade/algorithms` 45,480 to 46,799 and `typeshade/random` 29,493 to 30,732, each
  with its split initial and total. Every floor and `typeshade/emit` stay unchanged.
- **A kernel function stores into its arrays after its last loop, on the device** (proposal 0094,
  stage 1; Rules 8.22, 11.8 and 11.13, surface §65 and §71). `sums[0] = s` after a loop that
  reduces, and `count[0] = n`, no longer run the function on the CPU tier with `TS8070`. On WebGPU
  the stores run in an entry of one invocation that the call dispatches after the loops. It
  combines what each loop reduced as the result's tail does, so a store into a `Resident` stays on
  the device, and a call that returns nothing reads nothing back. A function with no loop may be
  scalar statements and such stores (decision D7). WebGL2 draws the loops and runs the stores on the
  CPU tier over its copies, and the CPU tier runs the function as written. A store past the array's
  end is dropped on every tier: the front end guards each store by the array's length in the IR, so
  `a.length` after it stays the array's length on the CPU tier too. In a `fuse` scope such a call
  forms a group of its own, `b stores into an array after its loops`. The `TS8070` text for a store
  before the last loop now names the stores after the loops. The record of proposal 0094 holds
  decisions D3, D4, D5, D7 and D8, which this stage takes. The call layer grows the bundles, so the
  budgets move to the measured sizes: `typeshade/runtime` 128,506 to 129,082 gzip bytes and its
  split total 130,560 to 131,157; `typeshade/fuse` 89,989 to 90,552, its split initial 13,592 to
  13,595 and its split total 90,306 to 90,888; `typeshade/algorithms` 44,919 to 45,480;
  `typeshade/random` 28,973 to 29,493. Every floor and `typeshade/emit` stay unchanged.
- **A bare `return;` and a path that ends the body are the absent value in a function with an
  optional result** (proposal 0099, Rules 7.2, 7.10 and 8.19, surface §14 and §76). Both lower to
  the value `return undefined;` lowers to, as TypeScript reads them, and a function with no
  written result whose `return;` or fall-through stands beside a `return` with a value returns
  `T | undefined`, as TypeScript infers it. Change 0088 refused both forms (`TS8021`, decision
  D5); the two sentences are gone. A bare `return;` where the result is a plain `T`, and a
  function with no written result whose returns are all bare or `return undefined;`, are
  refused as before. `examples/optional-values.shade.ts` spells `halfOf`'s absent case with a
  bare `return;`.
- **A lane past the trip count of a kernel function's GPU loop runs the last iteration and
  writes nothing, instead of returning early** (proposal 0096, Rule 8.22, surface §65). The
  compiler-made entries of a map, a push and a reduction, and a fused group's entry, start with
  one scaffold: a workgroup wholly past the trip count returns as one, on its first index, and in
  the workgroup that holds the last iteration a lane past it runs iteration `n − 1`, its index
  clamped, with every write of the iteration masked by its `_live` flag; a reduction takes the
  identity from such a lane and a push counts nothing for it. Where the clamped lane would read
  what another lane writes (a loop that reads back what it writes, one that loads a texel it
  stores, one that writes through an `@inout` argument, a fused group with an edge), it skips the
  iteration under the same flag. The results of a call do not change on any tier; the WebGL2
  program and the CPU tier keep their forms. The form is the one that completed on the D3D12
  device where a workgroup with idle lanes that returned early hung (`docs/hardware-notes.md` A1,
  issue #703). Every map entry now reads `workgroup_id`. The scaffold and the baked faces of the
  common modules grow the bundles, so the budgets move to the measured sizes: `typeshade/runtime`
  128,319 to 128,506 gzip bytes and its split total 130,361 to 130,560; `typeshade/fuse` 89,732 to
  89,989 and its split total 90,093 to 90,306; `typeshade/algorithms` 43,495 to 44,919;
  `typeshade/random` 28,736 to 28,973. Every floor and `typeshade/emit` stay unchanged.
- **A scalar or vector conditional whose arm is costly lowers to an `if`** (proposal 0097, Rule
  7.2, surface §31). `select` and the ternary evaluate both arms; when an arm holds a call of a
  function of the module, a texture read, or 8 or more operations, the conditional is hoisted
  into a slot and an `if`, as a conditional on a struct already was, so the arm not taken does
  not run. A cheap arm keeps `select`, and so does an arm that holds a derivative, an
  implicit-LOD sample, a barrier or a call that reaches one. The value does not change. The perf
  gate's corpus gains a `branch` case that measures it. The pass is in the shared pre-emit
  pipeline, so the bundle budgets move to the measured sizes: `typeshade/runtime` 128,028 to
  128,319 gzip bytes and its split total 130,101 to 130,361; `typeshade/emit` split 96,435 to
  96,670; `typeshade/fuse` 89,476 to 89,732 and its split total 89,859 to 90,093. Every floor
  and the other budgets stay unchanged.

- **A struct field, an array element and an optional parameter `x?: T` hold `T | undefined`.** (Proposal 0093; design rules 7.10, 8.8, 8.18 and 8.21; surface §7, §14, §28, §64 and §76.) A field `f: T | undefined` of a class, an interface or a type literal, `f?: T` (the same type, which an object literal may omit) and an element of `array<T | undefined, N>` are allowed where the struct or the array is in function scope; `new C()` starts a field with no initializer absent, and `undefined` written for a field or an element is the absent value. The compiler narrows a member path rooted at a local or a parameter, `h.n`, by the forms it follows for a name, and clears it on an assignment to a prefix or the root and on a call that takes the root by reference; an element access `xs[i]` is not narrowed (a recorded divergence), and its `TS8003` names the copy to test. `x?: T` on a helper, a method, a static function, a constructor, a local function, a function-typed parameter's type and an arrow function written as an argument declares `x` as `T | undefined`, and a call that omits it passes the absent value where the call is. A struct or an array that holds an optional is refused (`TS8002`) at a binding, a module variable, a module constant, an override, an entry's parameter or result and a kernel function's parameter, naming the field; `x?: T` on an entry point or a kernel function, `x?: T = d` and a required parameter after an optional one are refused (`TS8020`), which the editor shows in TypeScript's TS1015 and TS1016 place. The `TS8002` position sentence now names the allowed positions and the refused one and asks for a `u32` flag; the `TS8020` optional-parameter sentence and the `TS8010` optional-field sentence are retired. Each optional struct is declared before the first struct that holds it. A struct with an optional field, an array of optionals and an optional parameter have no host value. The example is `examples/optional-fields.shade.ts`.
- **A function, a local and a callback hold `T | undefined`, and the compiler carries whether the value is there.** (Proposal 0088; design rules 7.2, 7.8, 7.10, 8.18, 8.19, 8.21 and 12.7; surface §7, §28, §49, §64 and §76.) `f32 | undefined` is an optional value: the compiler lowers it to an internal struct of the value and a `bool`, `__opt_f32`, the same on WGSL, GLSL ES 3.00 and the CPU oracle, so nothing in it depends on NaN. `return undefined;` is the absent value, `v === undefined` tests it, `v ?? d` and `o?.f` read it, and `v ??= d` fills it. The compiler follows TypeScript's narrowing (the conditions of `if`, `?:`, `&&`, `||`, `while` and `for`, an early `return`, an assignment, `??=`, and a closure's `const`), and refuses a read nothing narrowed with `TS8003`, which the editor shows in TypeScript's TS18048 place. A function that returns `undefined` beside a value infers `T | undefined`, and a function-typed parameter whose result is `T | undefined` takes a function that returns `T`. An optional may be a local, a helper's parameter or a function's result; a struct field, an array element, a binding, a module variable or constant, and an entry's parameter or result stay refused (`TS8002`, naming the position), `null` stays refused with `T | undefined` as the spelling to write, and an optional has no host value yet. The example is `examples/optional-values.shade.ts`.

- Imported compute entries take an optional `{ constants }` third argument, directly and in
  `device.fuse()`. Shared override validation selects cached WebGPU pipelines, generated CPU
  constants and workgroup arrays, resolved report shapes and the owner's fp64 flavor (0084).
  The complete `examples/hosts/host-compute/` example covers default, direct-specialized and
  device-plan calls with a partial last workgroup, checked on WebGPU, WebGL2 and the CPU tier.

- **A union of string literal types is a key type, and `Record` over one is a table.** (Proposal 0081, parts 1 and 2; design rules 4.1, 7.8 and 8.21; surface §28, §64 and §75.) `type Channel = "r" | "g" | "b"` is a closed set of names, and the GPU holds a value of it as a `u32` id, the member's index in the order of the members' UTF-16 code units. A string literal is accepted where a key type is expected, and `===`, `!==` and `switch` apply to it. Every other operator, a number in its place and a string outside the union are refused, in the compiler and in the editor. A host call passes and gets the members as strings. `Record<K, V>` over a key type is an `array<V, N>` indexed by the member's id: `r[k]`, `r.g`, `r["g"]` and an object literal of its members, and an object of its members on the host. An enum or a union of integer literals as `K`, and the key types of a `Map` and a `Set`, are later parts of the change. Measured on 2026-10-21: the host-value conversions of a key and a `Record` make `typeshade/algorithms` 42,039 bytes gzipped and `typeshade/random` 27,300, against budgets moved to 42,400 and 27,600 bytes.

- **A loop that reads a `Map` or a `Set` an earlier loop of the same function added to runs on WebGPU.** (Proposal 0080, part 2; design rule 11.8; surface §74.) The call reads back the earlier loop's records and applies them before it uploads the collection for the loop that reads it. A loop that adds after one that reads runs the function on the CPU tier and says why. The host example `host-set-unique` gains `present`, held to JavaScript's own `Set` on WebGPU.

- **A loop that reads a `Map` or a `Set` runs on WebGPU.** (Proposal 0080, part 2; design rule 11.8; surface §74.) When no loop of the function adds to the collection, the call uploads its keys, sorted by an order word that is equal for keys SameValueZero calls equal, and a `Map`'s values beside them, and `has`, `get` and `size` in the loop search them. The host example `host-set-unique` gains `lookup`, held to JavaScript's own `Map` on WebGPU.

- **A loop that adds to a `Map` or a `Set` runs on WebGPU.** (Proposal 0080, part 2; design rules 8.22, 11.8 and 11.13; surface §71 and §74.) Each `add` or `set` pushes a record, the key and a `Map`'s value, as a loop that pushes does (change 0078), onto a binding the call makes `n` times the most an iteration adds long. The call applies the records to the caller's `Map` or `Set` in order, so the entries, the value set last and the insertion order are ECMAScript's on every tier. A loop that reads a `Map` or a `Set`, two loops that add to one, and an add inside a nested loop run the function on the CPU tier in this version. The host example `host-set-unique` runs on WebGPU, held to JavaScript's own `Set` and `Map`. Measured on 2026-10-21: `typeshade/random` is 26,635 bytes gzipped, against a budget moved to 27,200 bytes.

- **The host example `host-set-unique`.** (Proposal 0080, Amendment 1.) A `"use typeshade"` module and the `host.ts` that calls `labels` with the host's own `Set` and `latest` with its own `Map`, so the Playground's host tab can run them. The unit suite holds its `run()` to JavaScript's own `Set` and `Map` on the CPU tier, and `bun run gate:journeys` checks that WebGPU and WebGL2 say why they do not run it in this version.

- **The example `kernel-set-unique`.** (Proposal 0080.) `labels` collects the unique nonzero labels of an image in a `Set<u32>`, `latest` keeps the last value set for each key in a `Map<u32, f32>`, and `lookup` reads the map in a later loop where `has` guards `get`. The example runs on the CPU tier in this version, through the compile gate, and `src/compiler/ts/host-kernel-collections.test.ts` holds it to JavaScript's own `Map` and `Set`.

- **A kernel function takes ECMAScript's `Map` and `Set`, on the CPU tier.** (Proposal 0080, part 1; design rules 2.1, 8.22, 8.23, 11.8 and 11.13; surface §65 and §74; the export `ShaderType` gains the kind `collection`.) A parameter of a kernel function may be a `Set<K>` or a `Map<K, V>`, with `K` a `u32`, an `i32` or an `f32`. Its loops add to it with `s.add(k)` and `m.set(k, v)`, and the function reads it with `has`, `size` and `m.get(k)` where a `has` of the key guards it, in the compiler and in the editor. The host passes JavaScript's own `Map` or `Set` by reference, and reads back the entries a sequential run leaves: each key once, in the order first added, the value set last, keys compared by SameValueZero. The proof refuses, with `TS8070`, a loop that reads a collection it adds to. In this version such a function runs on the CPU tier. The WebGPU lowering is a later part of the proposal. Measured on 2026-10-21: `typeshade/random` is 26,232 bytes gzipped, against a budget moved to 26,600 bytes.

- **A kernel function's loop that pushes runs on WebGPU.** (Proposal 0078, part 2; design rules 8.22, 11.8 and 11.13; surface §65 and §71; example `kernel-push`.) The loop runs in three dispatches of one submission: each iteration counts its pushes, one workgroup of 256 scans the counts into offsets and the total, and each iteration stores its pushes at its offset while that is inside the array. The call reads the total back for `out.length`. The elements and the count are the CPU tier's, bit for bit. A loop runs on the CPU tier when its counting step would change what it computes: two pushed arrays, a reduction, a scatter, a texture store, or a write it reads back. WebGL2 runs no loop that pushes, and a `fuse` plan runs the call in a group of its own.

- **An array has `fill`, `findIndex`, `findLastIndex`, `indexOf`, `lastIndexOf` and `includes`.** (Proposal 0079, part 2; design rule 8.18; surface §63 and §65; example `kernel-array-methods`.) Each takes one argument and runs as ECMAScript runs it, on an `array<T, N>`, a storage binding and a kernel function's array. An index is an `i32`, `-1` where nothing matches. `includes` finds a NaN, told by its bits, and `indexOf` does not. On a kernel function's array each is a loop over every element on the GPU: `fill` writes at `i`, a search is a `min` or a `max` of the index, and `includes` an `|`. A start or an end index is not taken.

- **`forEach`, `reduce`, `some` and `every` work on a kernel function's array.** (Proposal 0079, part 1; design rules 7.2, 8.18 and 8.22; surface §63 and §65.) Each call is the loop it stands for, written into the kernel function's body with the function handed over as its body. The proof runs it on the GPU as it runs the `for` loop: `xs.forEach((x, i) => { out[i] = … })` writes at `i`, and `xs.reduce((a, x) => a + x, 0.)` reduces in the tree order. `some` and `every` are an `|` and an `&` over every element. Before this change each was `TS8099` on a kernel function's array.

- **A kernel function's loop appends to an array parameter with `out.push(v)`, on the CPU tier.** (Proposal 0078, part 1; design rules 8.22 and 8.23; surface §63 and §65.) `out.push(v)` is accepted on a kernel function's array parameter inside a candidate loop, as a statement, in the compiler and in the editor. The array starts empty in the function. The elements land in the order of a sequential run of the loop, and `out.length` after the loop is the count appended, which may exceed the host array's length. The host array is the capacity. The proof refuses, with `TS8070`, a loop that reads a pushed array, its `.length` or the value `push` returns, and a loop that also writes the array in place. In this version a loop that pushes runs on the CPU tier. The WebGPU lowering is a later part of the proposal. A `push` anywhere else keeps its refusal.

- **The example `kernel-image-invert`, and the texture group of a `fuse` plan in Rule 11.13.** (Proposal 0077; design rule 11.13.) The example is `invert`, a kernel function that reads a `texture_2d<f32>` and stores into a `texture_storage_2d`. Rule 11.13 says that a texture call is a group of its own in a plan, whose reason on WebGPU is `b takes a texture`.

- **The CPU tier holds a texture, and a texture call runs there.** (Proposal 0077; design rules 11.7 and 11.8; surface §65.) A device with no WebGPU device makes its textures in the CPU tier's memory, of every storage format but `rgba16float`. An `ImageData` is copied there. `textureLoad`, `textureStore` and `textureDimensions` read and write that memory: a store converts as WebGPU does for the format, a load outside the texture reads the nearest texel inside, and a store outside is dropped. Every other texture builtin keeps the stub contract. The import journey runs `invertImage` on the CPU tier in headless Chromium, and each byte equals its WebGPU run. Measured on 2026-10-20: `typeshade/runtime` is 44,244 bytes gzipped, against a budget moved to 44,600 bytes.

- **A kernel function takes a texture, and a device makes the texture it stores into.** (Proposal 0077; design rules 8.22, 8.23 and 11.8; surface §33, §65 and §71.) A 2D storage texture parameter makes an exported function a kernel function. A `texture_2d<f32>` parameter alone does not (Amendment 1). The loop reads a `texture_2d<f32>` with `textureLoad` and stores into the storage texture at `vec2u(i % W, i / W)`. The call takes an image source or a `Texture` for a sampled texture, and a device's `Texture` of the parameter's format for a storage texture. `device.texture({ size, format, storage })` makes the texture, and the device owns it. A call of another owner refuses it. Before anything runs, the call checks that each stored texture holds the texels of every iteration. In this version the call runs on WebGPU alone, and a `fuse` plan runs it in a group of its own. The import journey stores into a 4x3 texture on WebGPU in headless Chromium with SwiftShader, and each byte equals the reference. Measured on 2026-10-20: `typeshade/runtime` is 43,473 bytes gzipped after `device.texture()`, against a budget moved to 44,000 bytes.

- **`depth.stencil` on a render pipeline, and `setStencilReference` on a pass.** (Proposal 0064, design rule 11.11, surface §69.) `depth.stencil` takes the compare function, the three operations, the read and write masks and a reference. The four face fields apply to both faces. `front` and `back` each override one face. `setStencilReference` takes a whole number from 0 to 255, and it is 0 at each pass start. A pipeline that declares a `reference` uses it instead of the pass value. A pipeline with `depth.stencil` needs a pass whose depth attachment has a stencil aspect of the same format. `depth.format: 'stencil8'` is refused on both tiers. Each refusal is a `TypeError` that names the field.
- **`depth.bias` on a render pipeline.** (Proposal 0064, amendment A1.) `depth.bias` takes a constant, a slope scale and a clamp. A non-zero bias on a line or point topology is refused. The WebGL2 tier takes a bias on `depth24plus`, `depth32float` and `depth24plus-stencil8`. Measured on SwiftShader at window depths 0.25, 0.5 and 0.75. From window depth 0.25 up, its constant offset is at least the WebGPU offset and at most twice it. Measured on SwiftShader, below 0.25 it is 8 times the WebGPU offset at 0.0625 and 4 times at 0.125. Below window depth 0.0625 the ratio is not measured. It is expected to grow as the depth falls (inference: it doubles each time the depth halves). The slope offset is the same on both tiers. A non-zero clamp needs `EXT_polygon_offset_clamp`, and WebGL2 refuses it without that extension.
- **`multisample.mask` on a render pipeline.** It takes a whole number at count 1, and bit 0 keeps or drops the draw.
- **Frames.** The frames cover the eight stencil operations against the eight compare functions, the faces, the masks, the reference rules and the sample mask. They also cover the bias sign, the bias bound at five depths, the slope threshold and the clamp. The run `bias-clamp` needs `EXT_polygon_offset_clamp` on WebGL2. They run in the pipeline-state journey (`journeys/pipeline-state`), on WebGPU and WebGL2, in headless Chromium with SwiftShader. Measured on 2026-10-20: `typeshade/runtime` is 41,511 bytes gzipped against a budget of 41,650 bytes.

- **`store`, `readOnly` and a `stencil` object on a pass attachment.** (Proposal 0064, design rule 11.11, surface §69.) A colour target and a depth attachment take `store`, which is `'store'` or `'discard'`. A discarded attachment reads as zero afterwards on both tiers. On WebGL2 the pass clears it to 0 at its end. That clear may cost the bandwidth that `'discard'` saves on a tile-based or integrated GPU. The cost is not measured on a device yet. A canvas target refuses `'discard'`. A depth attachment takes `readOnly`. A read-only aspect takes no `clear`, `load` or `store`. Its `stencil` object takes `clear`, `load`, `store` and `readOnly`, and follows the depth aspect for each field it omits. The stencil clear takes a whole number from 0 to 255. `DepthAttachment` is exported from `typeshade/runtime`.
- **A pipeline that writes a read-only aspect is refused at the draw.** (Proposal 0064, design rule 11.11, surface §69.) A pipeline that writes depth is refused on a pass whose depth aspect is read-only. A pipeline that writes stencil is refused on a pass whose stencil aspect is read-only. The sentence names the field to change. The WebGL2 tier refuses a draw that binds the depth attachment of its own pass as a texture. Sample it in a later pass. WebGPU does not refuse that draw.
- **Frames of the pass attachments.** The frames cover the discard of colour, depth and stencil. They also cover the stencil clear, the clears of depth and stencil apart, and the read-only aspects. They run in the pass-attachments journey (`journeys/pass-attachments`), on WebGPU and WebGL2, in headless Chromium with SwiftShader. Measured on 2026-10-20: `typeshade/runtime` is 43,178 bytes gzipped against a budget of 43,300 bytes.

- **An entry call takes a workgroup count that a call wrote** (proposal 0075; design rules 8.24,
  11.8 and 11.13; surface §65, §67 and §71). The second argument of an entry call also takes
  `{ indirect, offset? }`: the three counts at element `offset` of a `Resident<Uint32Array>`, 0 by
  default. A kernel or an entry writes the counts, and the host submits the next call with no read
  between. On WebGPU the call records `dispatchWorkgroupsIndirect` at four times the offset, and
  every `Resident` buffer has the usage `INDIRECT` for it. The CPU tier and WebGL2 read the counts
  from the host copy when the call runs. A count with a 0 in it, or one past the device's
  `maxComputeWorkgroupsPerDimension` (65535 without a device), runs nothing on every tier. In a
  `fuse` scope the call is a group of its own, it runs after the call that wrote its counts, and
  its report group has `indirect: true`. The refusals are `TypeError`s that name
  `workgroups.indirect` or `workgroups.offset`: an array that is no `Resident<Uint32Array>`, an
  offset that is no whole number from 0, counts past the array, an array of another owner, a
  scratch array, a destroyed array, and an array that is also a binding the entry writes or binds
  `read_write`. Kernel functions and the program runtime's `dispatch` take no indirect count
  (#540 stays open for the program runtime). Measured on 2026-10-19, `typeshade/runtime` is 38,944
  bytes gzipped against a budget of 39,000 bytes. The baseline was 38,932 bytes.
- **A device runs long kernels as chunks under a time budget** (proposal 0074; design rules 11.8
  and 11.13; surface §65, §69 and §71). A GPU watchdog resets a device whose one submission runs
  too long, and a kernel that iterates inside one dispatch can run that long.
  `createDevice({ timeBudgetMs })` sets the time one chunk may take: 250 ms by default, reported as
  `device.timeBudgetMs`. A value that is not a finite number from 1 to 60000 is a `RangeError`.
  `device.fuse(body, { chunk: { key, units } })` runs one chunk alone. The device waits for its
  earlier work, times the plan by the wall clock to its fence, and learns the rate of `key`. The
  report gains `chunk: { key, units, elapsedMs }`, and `mergeReports` leaves that row out.
  `device.chunkSize(key, max, min)` sizes the next chunk to eight tenths of the budget. A chunk
  grows at most fourfold and never holds more than `max`. On the CPU tier the size is `max`.
  `device.chunkRates` holds a `ChunkRate` for each key. The type is exported from
  `typeshade/runtime` and the root. A plan with no chunk does not change, and the default owner
  has no budget. The arithmetic is typecv's (`f253716`), with `max` winning over `min`. Measured
  on 2026-10-19, `typeshade/runtime` is 38,932 bytes gzipped against a budget of 39,000 bytes.
  The baseline was 38,254 bytes.
- **`setViewport`, `setScissorRect` and `setBlendConstant` on a pass, and `blendConstant` on a pipeline.**
  (Proposal 0064, design rule 11.11, surface §69.) `setViewport(x, y, width, height, minDepth?,
maxDepth?)` takes whole numbers. Its width and height run from 0 to the viewport limit of the tier.
  Its depths satisfy 0 ≤ `minDepth` ≤ `maxDepth` ≤ 1. The defaults are 0 and 1.
  `setScissorRect` takes whole numbers from 0 up. It clips the rectangle to a `Texture` or canvas
  target. A rectangle wholly past the target keeps a zero size and passes on.
  `setBlendConstant` takes four numbers, each from 0 to 1. So does `RenderState.blendConstant`.
  The viewport limit is `maxTextureDimension2D` on WebGPU. On WebGL2 it is the smaller entry of
  `MAX_VIEWPORT_DIMS`. Each refusal is a `TypeError` that names the call and the value.
  A WebGL2 pass refuses a depth range other than 0 to 1 for a fragment that writes `frag_depth`.
  WebGPU clamps it. Two states that differ only in `blendConstant` give two `RenderPipeline`s over
  one GPU pipeline. Measured on 2026-10-19 by the render-state journey (`journeys/render-state`) on
  WebGPU and WebGL2, in headless Chromium with SwiftShader. The unit tests of `src/runtime` also
  check these rules.
- **`FuseReport` and `mergeReports` on `typeshade/runtime` and the root** (proposal 0071,
  Amendment 2; design rule 11.13; surface §71). The type of the report a `fuse` scope resolves to
  was exported from `typeshade/fuse` alone, so a host that ships the runtime without the planner
  re-declared it by hand. It is now exported from `typeshade/runtime` and the package root too, and
  `mergeReports(reports)` beside it is the report of several plans as one: the dispatches and the
  submissions summed, the groups in the order given, and the tier the most capable report ran on.
  It is arithmetic over the records and imports none of the planner.
- **Two common modules, `typeshade/algorithms` and `typeshade/random`** (proposal 0072 with its
  Amendment 1; design rule 11.20; surface §72 and §73). TypeShade gains a library written in
  `"use typeshade"`: the copy, the fill, the maps, the whole and axis reductions, a two-pass scan
  over `u32`, a stable compaction and a histogram over arrays, and the generators and hashes a
  kernel draws from (`xorshift32`, `hash32`, `uniform`) with the fills a host calls
  (`fillUniform`, `fillWords`) and `generator(seed)`, the same draw on the host. Each is a kernel
  function or a plain function of a shader module, so it runs on every tier with the oracle's bits
  and fuses with its neighbours in a `fuse` scope. A host imports the subpath under its `default`
  condition, the baked host face (`scripts/bake-common-modules.ts`); a `"use typeshade"` file
  imports the shader module under the `typeshade` condition. A map or a reduction named like a
  builtin is `<op>Map` or `<op>All` in the shader module and exported under the builtin's name,
  since a kernel function cannot carry a builtin's name.
- **A device owner, `createDevice()` on `typeshade/runtime` and the root** (proposal 0071;
  design rules 11.8, 11.11 and 11.13; surface §65, §69 and §71). A host opens the owner of its
  kernel calls on the first tier of `prefer` that opens, on a `GPUDevice` it has or on a program
  runtime's device. `device.array()` makes the owner's `Resident` arrays and `device.release()`
  returns them to a pool that `poolBytes` bounds; `device.fuse()` runs a body's calls as one plan
  on that device; `device.limits`, `device.lost`, `device.wait()` and `device.dispose()`. One
  `Resident` belongs to one owner, and a call takes its own owner's arrays only, a `TypeError`
  naming both owners otherwise. Two devices in one context are independent. `configure()`,
  `resident()` and `fuse()` describe the default owner as before.
- **A `vec4f` scratch array in a `fuse` scope** (proposal 0068; design rules 8.23 and 11.13;
  surface §65 and §71). `scope.scratch(length, 'vec4f')` makes an `array<vec4f>` of `length`
  vectors, which is `4 × length` numbers of its `Resident<Float32Array>`. A fused chain holds it as
  a local of `vec4<f32>` when the planner allows a scalar scratch array. Otherwise it is a zeroed
  buffer of `16 × length` bytes on WebGPU, and a zeroed host array on the CPU tier. A loop over
  `array<vec4f>` has no WebGL2 program, so its call goes to the CPU tier there. Rule 8.23 says that
  the `.length` of an `array<vec4f>` counts vectors. An element other than `'f32'`, `'i32'`,
  `'u32'` or `'vec4f'` is refused with the element list that names `'vec4f'`. A `vec4f` scratch
  array is refused as an argument of an array of another element. Its length limit is the
  existing one, 4294967295 vectors.

- **A device requests the WebGPU limits a host names, and reports them** (proposal 0051; design
  rules 11.8, 11.11 and 11.13; surface §3, §64, §65, §69 and §71). `createRuntime({ limits })`
  requests the limits a host names, and with `programs` the limits the programs need, and
  `rt.limits` reports the device's limits (`{}` on WebGL2). A pipeline past a limit is refused
  with a `TypeError` that names the entry, its line, the limit and both numbers, before WebGPU
  sees it; `dispatch()` and `draw()` refuse a buffer or a dispatch past a limit with a
  `RangeError`. On the call layer, `configure({ limits, features })` names the limits and features
  its device must have, and `callDevice()` reports that device as a `DeviceReport`. `fuse` reads
  its storage-buffer limit from that report. Nothing an author writes changes.
- **`resident(length, element)` makes a zeroed `Resident`** (proposal 0065; design rule 11.8;
  surface §65 and §69). `resident(1_000_000, 'f32')` holds no host copy and writes no byte until a
  call writes it or the host reads it. A call on WebGPU makes a zeroed storage buffer, as WebGPU
  makes every new buffer. `read()` of a handle that no call wrote returns zeros with no download.
  The element has no default: `'f32'`, `'i32'` or `'u32'`. `f64` is not part of this form. A length
  that is not a whole number from 1 to 4294967295, an element that is not one of the three, and a
  first argument that is not a number when an element is given are refused with a `TypeError`.
  The one-argument form `resident(value)` is unchanged.

- **Every capability of WebGPU and WebGL2 has one status per target** (proposal 0059, Rules 11.14
  to 11.18, Appendix C). `docs/capability-coverage.md` is the coverage table. The command
  `bun run bake:capability-coverage` generates it from `src/core/coverage/`, the hand-maintained
  classification, and four sources at their pins:
  - the WebGPU host API: `@webgpu/types` 0.1.74, pinned exactly in `package.json`;
  - WGSL: gpuweb/gpuweb commit `358eebc8e7bf2d6efa41a4b8b3fbc3a715288204`;
  - GLSL ES 3.00: KhronosGroup/OpenGL-Registry commit `6af574a14089ccfee87efe230ebcdd8742859813`,
    revision 6;
  - the WebGL2 host API: TypeScript 5.6.3 `lib.dom.d.ts`, and KhronosGroup/WebGL commit
    `714857a28445e8f5d8d6ae1c78498578009534d8` for the extensions.

  Each row has one of six statuses on each target: `typed`, `raw`, `refused`, `planned`, `gap` or
  `n/a`. Rule 11.18 gives each status its evidence: a test, an escape hatch, a rule, a proposal,
  an issue or a reason. `src/core/spec-conformance/capability-coverage.test.ts` holds the table to
  its sources.

  The table has 937 rows in four tables, A to D. The counts per target are:
  - WebGPU: 479 `typed`, 135 `raw`, 10 `refused`, 52 `planned`, 200 `gap` and 61 `n/a`;
  - WebGL2: 373 `typed`, 31 `raw`, 31 `refused`, 0 `planned`, 247 `gap` and 255 `n/a`.

  Rule 13.9 now counts removing or narrowing an escape hatch of Rule 11.17 as breaking. Nothing an
  author writes, emits or computes changes.

- **`typeshade/fuse` runs a chain of kernel-function calls as one plan, in one WebGPU
  submission** (proposal 0058, step 2; the rule and the surface section follow in step 6). A
  host imports `fuse` from the new subpath `typeshade/fuse`, as it imports `typeshade/emit`, and
  makes its calls over `Resident` arrays inside the body:
  `await fuse(() => { add(t, a, b); mul(u, t, c); relu(out, u); })`. The runtime runs the body
  once, synchronously, and records each call whose written arrays are all `Resident`s. It runs
  the calls as one unit in the kernel queue, at the place the scope holds, so a call or a
  `read()` made after it sees what they wrote. On WebGPU the dispatches of all the calls are
  encoded into one command encoder and submitted once. A reduction, which reads its partials
  back, and a call that runs on WebGL2 or the CPU tier each submit what the plan holds first. On
  WebGL2 each loop draws as it does outside a scope, and on the CPU tier the calls run one after
  another. The promise resolves to a `FuseReport`: the best tier any call ran on, the dispatches
  and the `queue.submit` calls the plan made, counted where they are made, and one group for
  each call, since this step fuses nothing. The first error rejects it and stays on every
  `Resident` the plan's calls write, for `read()` to throw. Inside the body an entry call, a
  draw and a kernel call that writes a host array are a `TypeError` naming the call, and so are
  `read()`, `write()` and `destroy()` of a `Resident` and every other use of the kernel queue,
  which would run before the calls recorded earlier. A nested `fuse` joins the scope, and an
  `async` body is a `TypeError`. A call outside a scope does what it did. `typeshade/runtime`
  imports the slot the call layer asks and none of the planner, so a host that never imports
  `typeshade/fuse` ships none of it. Measured on headless Chromium's WebGPU, a software adapter
  (SwiftShader): `journeys/loop-fuse` makes three dispatches in one submission, the counts the
  page reads off the device, and the same scope gives the same bits on WebGL2 and the CPU tier.
  `journeys/mnist/bench-submissions.mjs` makes four submissions apart and one in a scope for one
  MNIST-shaped training batch of four kernel calls, with the same weights both ways. In three
  runs of 20 batches the median is 4.9 to 5.1 ms in a scope against 5.2 to 5.9 ms apart, a
  ratio of 0.87 to 0.96, and over 200 batches it is 5.2 ms against 6.1 ms; this is host wall
  time on a software device, not a hardware claim. The `typeshade/fuse` bundle is 11,052 bytes
  minified and gzipped, within its budget of 13,300, and `typeshade/runtime` grew from 29,174
  to 29,301 bytes, within its budget of 29,800.
- **`fuse` runs the consecutive calls the compiler's facts allow as one dispatch** (proposal
  0058, step 3; the rule and the surface section follow in step 6). Over a module built with
  `typeshade({ fuse: true })`, the planner of `typeshade/fuse` joins a call to the group before it
  when, against every call already in the group, each call is the one loop of a kernel function
  that neither reduces, scatters nor continues; the loops have one start, one trip count and one
  step; an array one call wrote and a later call reads is written and read at exactly the loop's
  index; no array a call writes is one an earlier call of the group reads or writes; and the group
  binds no more distinct arrays than the device allows storage buffers
  (`maxStorageBuffersPerShaderStage`, 8 where the device reports none). A group of several calls
  is one compute entry, built from the loop IR in the calls' faces as one `ModuleDecl` and emitted
  by the WGSL writer and the validation `typeshade/emit` uses: one binding for each distinct
  array, one uniform for the scalar parameters of all the calls, the statements of each call under
  its own prefix, and an array one call writes and a later call reads kept in storage and read
  from a `var` local. The entry is cached for the shape of the group, the faces and the slot each
  array parameter takes, and no length or value. The report names each group, says which are
  fused, and gives each group that stands apart from the one before it the reason, in the
  author's words: `mul and blur run as two dispatches because blur reads t[i - 1] (line 9)`. Its
  `dispatches` counts a fused group once. Only WebGPU fuses: WebGL2 runs the calls apart and the
  report says so, the CPU tier never fuses and says nothing, and a module built without the
  option has no facts, so its calls run apart. Measured on headless Chromium's WebGPU, a software
  adapter (SwiftShader), in three runs of 20 samples each: the chain `add`, `mul` and `relu` of
  `journeys/loop-fuse/bench.mjs` is one dispatch in one submission against three dispatches in
  three submissions apart, and its median is 0.59 to 0.65 of the time apart over 1,000 elements
  and 0.78 to 0.83 over 32,768, and equal to it, 1.00 to 1.04, over 1,048,576, where three
  dispatches in one submission take 1.28 to 1.31 times as long as three submissions; one
  MNIST-shaped training batch of four kernel calls is three dispatches, with `backward` and
  `update` fused, at 0.74 to 0.81 of the time apart. Every output is the same bits apart and in a
  scope. This is host wall time on a software device, not a hardware claim. The `typeshade/fuse`
  bundle is 71,683 bytes minified and gzipped, which holds the WGSL writer now, within a budget of
  86,000; `typeshade/runtime` is unchanged at 29,301 bytes.
- **A `fuse` scope makes scratch arrays, and a fused group holds them as locals** (proposal 0058,
  step 4; the rule and the surface section follow in step 6). `scope.scratch(length, element?)`
  makes a `Resident` for an intermediate that the host never reads. The `element` is `'f32'` (the
  default), `'i32'` or `'u32'`, and a kernel call takes the handle as an `array<f32>`,
  `array<i32>` or `array<u32>`. It holds zeros when the plan starts, as a new buffer does. The
  planner holds a scratch array as a local when every call of the plan that names it is in one
  fused group, one of them writes it, each reaches it at exactly the loop's counter, and none
  names it by its length (`xs.length`, a fact that `typeshade({ fuse: true })` now writes into the
  face). The fused entry then declares a `var` local that starts at zero: it binds no buffer for
  the array, the device is asked for none, and no host array of its length is made. The count of
  storage buffers a group binds counts no such array. Otherwise the array stays a buffer: the
  plan makes a zeroed device buffer for the scope, or on the CPU tier and WebGL2 a zeroed host
  array when the first call needs it, and frees it when the plan has run, on success and on
  failure. A `Resident` from `resident()` is never held as a local, so the host may read it after
  the scope. `read()` and `write()` of a scratch array are a `TypeError` that names it as
  scratch, and so is a kernel call that takes it outside the body of the scope that made it or
  after the plan has run. `destroy()` does nothing, since the plan frees the array. The first
  access that is not at the counter, in the facts and in `TS8070`, now spells a length as the
  author wrote it, `xs.length`, and not `arrayLength(xs)`. `FuseScope` gains `scratch`, and
  `FuseReport` is as it was. Measured on headless Chromium's WebGPU, a software adapter
  (SwiftShader), in three runs of 20 samples each: the chain `add`, `mul` and `relu` of
  `journeys/loop-fuse/bench.mjs` is one dispatch in one submission over residents and over
  scratch arrays, and its median over scratch arrays is 0.83 to 0.87 of the time over residents
  and 0.67 to 0.69 of the time of three calls apart with 32,768 elements, and 0.58 to 0.61 and
  0.56 to 0.60 with 1,048,576. The device is asked for 2 buffers in the first run over scratch
  arrays and for 4 over residents, and every output is the same bits. This is host wall time on a
  software device, not a hardware claim. The `typeshade/fuse` bundle is 73,006 bytes minified and
  gzipped, within its budget of 86,000, and `typeshade/runtime` is 29,313, within 29,800.
- **`gate:differential` fuses generated chains of kernel calls on WebGPU and holds them to the
  calls run apart** (proposal 0058, step 3b; scratch arrays follow with step 4). A new arm draws
  chains of 2 to 6 kernel calls with `generateChain` (`src/core/testing/random-ir.ts`): functions
  of one loop that the proof accepts, built from the statements and expressions of
  `generateKernelModule`'s, with no reduction and no scatter. A call's output is a new array
  unless the chain reuses one, its inputs are drawn from earlier outputs, and now and then a call
  has a scalar, a helper call, a read at another index, a write at `2 * i`, a `continue`, a loop
  that starts at 1 or 3 or steps by 2, or runs over another count. The planner of `typeshade/fuse`
  groups each chain from faces built from the IR as the compiler builds them
  (`src/core/testing/fuse-chain.ts`). Each fused group is dispatched on headless WebGPU as the
  entry the builder made, every other call as its own lowered plan, all in one submission. Every
  array a chain writes and every result is held bit for bit to the same calls run apart on the
  `f32` oracle, with the exclusions of the arm before it. The groups the planner makes are held to
  the groups the facts F1 to F5 give for the chain as the generator built it, which reads no fact
  of any face, and the dispatches the device is given, counted where it is given them, to those
  groups. The arm proves its instrument: a fused group dispatched with its first iteration
  skipped, a face whose facts say every read is at the counter, and a chain dispatched apart
  where the facts fuse are each reported, and floors hold the corpus to fused groups, the edges
  they keep in locals and every fact the planner refuses on. Measured on headless Chromium's
  WebGPU, a software adapter (SwiftShader), at the default 48 chains: 96 runs of 362 calls in 238
  dispatches, 84 groups fused (206 calls, the largest of 5, 64 edges kept in locals), 156 groups
  apart, and 63,551 values bit for bit, 26,798 of them written by a call, with no difference; the
  arm adds about 20 s, and `TYPESHADE_DIFF_SEEDS` lengthens it as it does the others.
  `src/core/testing/random-chain.test.ts` holds 50 chains to the same facts and to the calls
  apart on the oracle, with no GPU.
- **`fuse` fuses a reduction with the calls before it** (proposal 0058, step 5; the rule and the
  surface section follow in step 6). A call whose loop reduces (`s += xs[i]`) may be the last call
  of a fused group, and the calls before it run as a prologue of each of its iterations:
  `add(t, a, b); mul(u, t, c); total(u)` is one loop dispatch and one fold dispatch for each level
  of partials, where the calls apart are two map dispatches and then the reduction's own. The
  planner holds the reduction to the facts of the other calls (the loops have one start, one trip
  count and one step; an array a call before it wrote is read at exactly the loop's index; no array
  the reduction writes is one a call of the group reads or writes) and counts the partials binding
  of each variable it folds among the storage buffers of the dispatch. No call joins a group after a
  call that reduces, and the report says why:
  `total and relu run as two dispatches because total reduces`. A reduction alone is not fused, and
  one with a `continue` of its own, a scatter or no iteration stays apart. The fused entry keeps the
  lowering of the reduction: its loop entry, which indexes the invocation at 256 and folds the
  invocations of a workgroup by the tree into one partial each; its fold entry; its sums struct and
  its workgroup arrays. Only the helper that runs one iteration is replaced, by one that holds the
  locals of the group, runs the iterations of the calls before the reduction, and then the
  reduction's own. The tree order of Rule 7.2 is untouched, and the sum and the arrays are the bits
  the calls give apart. The plan submits what it holds before the reduction, since its partials are
  read back between the levels, and the loop and each fold level reach the queue in a submission of
  their own, run by the function (`reduceOnGpu`) that a reduction outside a scope runs through.
  WebGPU now makes one shader module for the entries of one WGSL text, so the loop and the fold
  entry of a reduction, fused or not, compile once. Measured on headless Chromium's WebGPU, a
  software adapter (SwiftShader), in three runs of 20 samples each: the chain `add`, `mul` and
  `total` of `journeys/loop-fuse/bench-reduce.mjs` is 2 dispatches in 2 submissions over 32,768
  elements and 3 in 3 over 1,048,576 (one loop dispatch and one or two fold levels), against 4 and 5
  apart. Its median over scratch arrays is 0.84 to 0.88 of the time apart with 32,768 elements and
  0.93 with 1,048,576, and over residents 0.90 to 0.96 and 0.96 to 1.01. The sum, of random `f32`
  numbers for which the order of the additions changes the bits, is the same bits apart, in a scope
  and on the CPU tier. This is host wall time on a software device, not a hardware claim. The
  `typeshade/fuse` bundle is 73,890 bytes minified and gzipped, within its budget of 86,000, and
  `typeshade/runtime` is unchanged at 29,313, within 29,800.
- **Rule 11.13 and surface §71 describe the `fuse` scope, and the `loop-fuse` example fuses a
  reduction** (proposal 0058, step 6; design rules 8.22, 11.8, 11.11 and 11.13; surface §65, §69 and
  §71). Rule 11.13 states what `typeshade/fuse` does: what a body records and what it refuses, when
  the plan runs, the facts F1 to F6 that make consecutive calls one dispatch, the report and the
  `why` of a group in the author's words, scratch arrays and when a fused group holds one as a
  local, the fall-back when the entry of a group cannot be built, one entry for each shape, and the
  guarantee that the arrays and results hold the bits of the calls run apart. Rule 8.22 gains the
  read fact and the bare fact the proof records under `typeshade({ fuse: true })`, Rule 11.8 the
  place of a scope in the order of the calls, and Rule 11.11 `typeshade/fuse` beside the load-time
  emitter. Surface §65 names the facts the compiler writes under the option, §69 the subpath, and
  the new §71 the scope for an author: the option, the body, every refusal with its exact wording,
  the facts, the report, scratch arrays, the submissions of a reduction and the tiers.
  `AUTHORING.md` gains a section on writing a chain that fuses. The host example `loop-fuse`
  gains `total` and a third scope, `add`, `mul` and `total`, one fused group of a loop dispatch and
  one fold dispatch over its 1,000 elements; the example lists WebGPU and the CPU tier, since a
  reduction is refused with WebGL2 alone. The four fuse test files carry `Verifies: Rule 11.13`,
  and `src/changes.test.ts` checks that the examples a proposal declares exist, as a module or as a
  host example. Roadmap item 15a and `docs/computing-platform-plan.md` record the delivery, and the
  proposal sets `status: implemented` with its record: the pull requests, the sizes, the
  validation and the deviations. Measured on the module of `journeys/loop-fuse/ops.shade.ts`
  (five kernel functions), the facts and the IR add 1,808 bytes minified and gzipped to its 2,560
  bytes, 362 bytes for each function on average, 668 for `add` alone and 1,275 for `total` alone.
  The `typeshade/fuse` bundle is 73,890 bytes and `typeshade/runtime` 29,340, both unchanged. The
  site and the editor have not started their share of the change.
- **`gate:boundary` scans each bundle for code built at run time** (proposal 0058, deviation D15;
  design rules 11.7 and 11.13). A strict content security policy refuses `new Function` and
  `eval`, and Rule 11.13 promises that no tier builds code that way. The gate parses the minified
  bundle of `typeshade/runtime`, `typeshade/emit` and `typeshade/fuse`. It fails, naming the
  subpath and the text around the hit, on a `new Function`, a call of `Function` or `eval` (an
  indirect `(0,eval)(code)` too), or a dynamic `import(`, which loads code the bundle does not
  hold. It reads code, so `lowerFunction(`, a string and a comment are no hit. Its instrument
  comes first. The scan must report each way planted in a string and nothing in a string of
  look-alikes. It must also report the same ones planted after the real text of each bundle,
  which fails a bundle that it cannot read to its end. The summary line of each subpath says how many bytes the scan read, with none found:
  87,221 for `typeshade/runtime`, 298,884 for `typeshade/emit` and 233,911 for `typeshade/fuse`.
  The sizes and the budgets are unchanged. The run takes about 3 s, against under 1 s before.
- **`gate:differential` draws scratch arrays and reductions in its generated chains** (proposal
  0058, deviation D14). `generateChain` marks as scratch the arrays of `f32`, `i32` or `u32`
  elements that the host reads nothing from after the chain, and leaves at least one array a call
  writes to the host. In three chains of ten one call reduces, folding one variable or two, mostly
  as the last call of the chain and now and then before another. The planner holds a scratch array
  as a local where Rule 11.13 allows. `modelGroups` (`src/core/testing/fuse-chain.ts`) restates
  that rule, F6 and the partials binding that F5 counts, over the chain as the generator built it,
  and the arm holds the locals the planner makes to the locals the facts give. The device job makes
  no buffer for a local, makes a zeroed buffer for a scratch array that stays one, and dispatches a
  reduction as the runtime does: its loop, and then one fold for each level of partials, with the
  uniform's `c<m>__n`, `c<m>__in` and `c<m>__out` set. The partials stay in one buffer of the job,
  so the arm holds the dispatches and the folded values, and does not depend on how the runtime
  submits the levels. The dispatches the device is given are held to the groups, the folds among
  them. The comparison leaves a scratch array out, since the host never reads it, and holds every
  other array a call writes and every result to the calls run apart on the `f32` oracle. Two
  chains built from source fold 70,000 iterations in two levels. The arm reports seven faults run
  on purpose: the three it had, a scratch array held as a local against the facts (a stencil reads
  it), a scratch buffer that starts with words other than zeros, a fused reduction whose last
  level of partials is not dispatched, and one whose partials are zeroed between the levels.
  Floors hold the corpus to scratch arrays held as locals and kept as buffers for each clause of
  the rule, reductions fused and apart, and the fold levels. Measured on headless Chromium's
  WebGPU (SwiftShader), at the default 48 chains: 98 runs of 365 calls in 251 dispatches, 91
  groups fused, 45 scratch arrays held as locals and 150 kept as buffers, 34 reductions in 20
  fold levels, and 58,370 values bit for bit, with no difference. The chain arm takes 36 s of CPU
  time against 32 s before. `src/core/testing/random-chain.test.ts` holds the same 50 chains to
  the same facts on the oracle, with nine instruments of its own.
- **`typeshade({ fuse: true })` writes each kernel function's loop facts and lowered IR into the
  generated module** (proposal 0058, step 1; design rule 8.22). The proof of a kernel function's
  loops records, for every array parameter an accepted loop reaches, whether every access is at
  exactly the loop counter, and names the first one that is not, in the author's words. Under the
  option the face of each kernel function that lowers carries those facts and the lowered module
  as portable IR, which the planner of `typeshade/fuse` (a later step) fuses a chain of calls
  from. The option is off by default; a module built without it is byte for byte the one it was.

- **Reverse-mode `grad` differentiates loops** (proposal 0056, step 1b). A loop runs under the
  checkpoint schedule of the proposal in function memory: a counted `for` reads its trip count
  from its header, and a `while` or a loop with a `break` or a `return` runs a count sweep first.
  `C` slots (`GradOptions.checkpoints`, 32 by default) hold the loop state, and a second array of
  `C` slots holds a segment's states. `continue`, nested loops and early returns inside a loop
  are covered. `GradResult.tapeBytes` reports the bytes of function memory the tape takes.
  `GradOptions.custom` replaces the generated adjoint of a function with an author-written one,
  and `gradCheck` takes it too.
- **`grad` differentiates in reverse mode** (proposal 0056, step 1). `grad(m, fn, wrt,
{ mode: 'reverse' })` adds `<fn>_vjp(args, dy)`, which returns a struct of the adjoint of every
  name of `wrt` in one evaluation. It covers loop-free functions: arithmetic on `f32`, float
  vectors and float matrices, every builtin forward mode differentiates, `if`, `switch`, early
  returns and calls to other functions of the module through `g_vjp` helpers. The tape is the
  function's own variables. A loop is refused with `SD0118` until the checkpoint schedule lands.
  `GradOptions` gains `mode`, and `GradResult` gains `adjoints`. Forward mode is the default and
  does not change. `gradCheck` (roadmap item 20) holds a derivative of either mode to a central
  difference on the `f64` oracle.
- **A host's `@compute` entry call runs on WebGL2 where there is no WebGPU device** (proposal
  0054, step 2c; design rules 8.24 and 11.8; surface §67). The call tries WebGPU, then WebGL2,
  then the CPU tier, in the order `configure` sets. On WebGL2 the entry runs as its pass program:
  storage as words, barriers and atomic operations at the cuts of the phased order. A 2D texture
  the entry reads is a `sampler2D` of the pass program, the image uploaded as `RGBA8` with its
  sampler's filter and address. Every other handle has no host value in the call (#204), so an
  entry that reaches one has no host function. An entry that reaches a
  barrier now runs where there is WebGL2 and no WebGPU, where before the call was refused.
  Memory, state and output are layers of 2D array textures, so a buffer past four million words,
  or a dispatch of more invocations, runs on WebGL2 too; a pass writes only the layers its
  invocations wrote.

- **The program runtime draws on WebGL2** (proposal 0054, step 4; design rule 11.11; surface
  §69). A runtime of the WebGL2 tier makes textures and samplers, links render pipelines from the
  vertex and fragment programs the manifest now carries (`Pack.gl.vertices`, and `gl.draws` for
  every fragment entry), and draws passes into textures or into its canvas, where before
  `render()`, `texture()`, `sampler()` and `pass()` were a `TypeError`. It keeps WebGPU's
  conventions: a texture's row 0 is the top row, a fragment's `position` and a stored depth are
  WebGPU's, and `read()` and `readFloats()` give WebGPU's bytes and numbers, depth32float
  included. A read-only storage array is the data texture GLSL ES 3.00 reads; a `Resident` is
  uploaded again only when its host copy changes. Each entry's GLSL is now emitted from what that
  entry reaches, so a module whose compute entry writes storage keeps WebGL2 programs for its
  draws. What WebGL2 has no form of is a `TypeError` that names it: a multisampled, layered, 3D or
  storage texture, targets that blend apart, a frame's `encoder` and a pass's `raw` encoder.

- **The program runtime runs compute entries on WebGL2** (proposal 0054, step 4; design rule
  11.11; surface §69). `createRuntime({ device })` takes a `WebGL2RenderingContext` as well as a
  `GPUDevice`, and `createRuntime({ prefer })` orders the tiers it tries when it is given none,
  WebGPU and then WebGL2 by default. `rt.tier` reports `'webgpu'` or `'webgl2'`. The manifest
  carries each compute entry's pass program, `gl.computes`, built when it is packed, so the runtime
  runs it on WebGL2 and ships no compiler. A dispatch on WebGL2 runs at the frame's `submit()`; a
  `Resident` it writes holds the result. A draw on WebGL2 is the next step: until then `render()`,
  `texture()`, `sampler()` and a frame's `pass()` are a `TypeError` there. `Pack.gl.draws` is now
  optional, as `gl.computes` is. A compute entry's pass program now gives memory and uniforms only
  for what the entry and its callees name, so an entry of a module whose other entry binds more
  runs on WebGL2, through the call layer too, where before it asked for that memory.

- **A compute entry on the program runtime's WebGL2 tier reads every texture GLSL ES 3.00 reads**
  (proposal 0054; design rule 11.11; surface §69). Its pass program binds a 2D array, 3D or cube
  texture of any element, and a depth texture of those dimensions as the shadow sampler its
  comparison sampler fuses into, so `textureSampleCompareLevel` runs on WebGL2. `PackGlCompute`'s
  `textures` gain `dim` and the `sample` kind `depth`. A texture of another dimension than 2D is a
  `WebGLTexture` made for its target; a runtime texture there is a `TypeError`. A 1D, cube array
  or multisampled texture still has no pass program, now with that reason.

- **A compute entry's storage texture runs on the program runtime's WebGL2 tier** (proposal
  0054, fifth amendment, which needs the owner's acceptance; design rules 10.3 and 10.5; surface
  §33 and §69). GLSL ES 3.00 has no image load and store, so the pass program holds the texture
  as a memory root of words, four a texel, which the dispatch reads in from the texture before the
  first pass and draws back into it after the last. A store outside the texture is dropped and a
  load outside it reads the nearest texel. `rt.texture({ storage: true })` now makes a texture on
  WebGL2, and a dispatch binds it to a storage texture of its format. `rgba8snorm` that the entry
  writes is refused with "whose format WebGL2 cannot render to", which is now Rule 10.3's
  example of `TS8015`, and a float format needs `EXT_color_buffer_float`. `PackGlCompute` gains
  `storageTextures`. The call layer still has no host value for a storage texture (#204).

- **A draw's `indices` and `vertices` take a `Resident`** (proposal 0053, #391; surface §69). A
  `Resident` of a `Uint32Array` as `indices`, or of a `Float32Array`, `Int32Array` or
  `Uint32Array` as `vertices`, is uploaded on its first use and bound as it is after, until
  `write()` changes it, where a typed array is uploaded at every draw. It is the device buffer a
  binding of the same handle uses. Before, a `Resident` there was bound as if it were a
  `GPUBuffer`. A `Resident` of any other value is a `TypeError` naming the field.

- **A host's draws and dispatches are typed by the bindings each entry reaches** (proposal 0030,
  #408; design rules 8.21 and 11.11; surface §64 and §69). The host view types a module's default
  export, its manifest, as `Pack<{ entry: bindings }>`, and the program runtime carries that type:
  `rt.load(program)` is a `Program` of it, `compute(entry)` and `render({ vertex, fragment })` give
  pipelines of the bindings those entries reach, and `draw` and `dispatch` take them. `tsc` now
  refuses a misspelled binding, a missing binding or struct field, a `vec3` for a `vec4` and an
  entry name the program does not have, where before the runtime refused them at the first draw.
  A buffer binding takes its host value, a `Resident` of it or the host's own buffer; a texture or
  a sampler takes the runtime's or the host's own object. `BindingsOf<typeof program, 'vs'>` names
  one entry's bindings. A manifest read from JSON or packed at run time is `Pack` with no argument
  and takes any bindings, as before. `render()` with no entry names types its draws by any one
  entry's bindings. Nothing changes at run time.

- **`array<T, N>()` is the zero value of a fixed-size array** (proposal 0047, #495; design rules
  2.1 and 7.6; surface §44), as WGSL's `T()` is: every element its type's zero, a struct's and a
  matrix's included, written out as `vec3()` is. It is the value `TS8075` asks a local array to
  be declared with, and the editor took it already. A wrong count is still `TS8019`;
  `array<u32>()` is `TS8099` with a sentence that no longer names `array<u32, 0>`.

- **`bitcast` takes a vector** (proposal 0044, #478; design rule 9.2; surface §44).
  `bitcast<vec2u|vec3u|vec4u>(v)` reads each component of a float vector as a `u32`, and
  `bitcast<vec2|vec3|vec4>(w)` reads a `u32` vector back, as WGSL's overload
  `bitcast<vecN<T>>(e: vecN<S>)` does. WGSL emits `bitcast<vec4<u32>>(v)`, GLSL ES 3.00
  `floatBitsToUint(v)` / `uintBitsToFloat(w)`, and each component on the CPU equals the scalar
  form's answer. The editor accepts the same calls with no `TS2344`. A vector of another width is
  `TS8003`, which names the one overload; the signed forms are still refused.

- **A NaN or subnormal `f32` word has no portable `bitcast`, and the docs say so** (proposal
  0045, #479; design rules 1.3 and 11.2; surface §44). Measured: the CPU oracle gives a NaN word
  back as `0x7fc00000` on bun and node, while SwiftShader's WebGPU and WebGL2 keep the bits; WGSL
  §15.7.2 permits either, and GLSL ES 3.00 §2.1.1 lets a driver flush a subnormal, which every
  small integer is as `f32` bits. Surface §44 and the `bitcast` hover say to keep an integer
  word in a `storage<array<u32>>` or `storage<array<vec4u>>` binding. `accuracyOf` gives every
  `bitcast` id `exact` with a `note`; the `exact` arm of `DeterminismAccuracy` gains that
  optional `note`. No target's answer changes.

- **Parameters that write back: `@inout` and `@out`** (proposal 0040; design rules 8.25, 8.8,
  8.10, 8.17, 7.9, 6.7, 6.10, 2.1, 9.6 and 12.7; surface §70, with §9, §14, §26, §49 and §52). A
  parameter declared `@inout` names the caller's place, and the call passes the variable itself:
  `swap(x, y)` exchanges two locals, `advance(rays[i], dt)` moves a storage element in place. An
  `@out` parameter is one the function writes before reading it and on every path, so its
  argument may be a local with no value yet: `let s: f32; add(a, b, s);`. The body reads and
  writes the parameter as a local, a field as `r.origin`, the way a method that changes its
  object reaches `this`; WGSL receives a pointer, `swap(&x, &y)` with `*a = *b`, compiled once per
  address space its calls use, GLSL ES 3.00 an `inout` parameter, and the CPU paths copy the
  value in and store it back. The qualifiers are GLSL's, written as parameter decorators, which
  TypeScript parses; GLSL's `in` is TypeScript's reserved word and is every parameter's default.
  The `Ref<T>` parameter and `ref(x)` argument of the earlier unreleased revision are gone.
  - `TS8073 REFERENCE` refuses a value nothing holds where a place is taken, a place no function
    may write (a value parameter, a `const` that may share its value, a read-only binding, a
    vector's component), and a qualifier on a method's, a local function's, an entry's or a
    generic function's parameter. `TS8074 REFERENCE_ALIAS` refuses two references to one variable
    in one call when the callee writes either, and a reference to a module variable the callee
    also touches by name: WGSL's alias analysis, measured on Tint.
  - The CPU oracle, its generated code and the debugger store an `inout` argument that is a field
    or an element back into it, resolved once at the call.
  - `TS8018` on a write through a value parameter names the second remedy, `@inout r: Ray`.
  - An export with a qualified parameter is `never` in the host view, with the reason: a host
    call passes values.
  - A local function captures a qualified parameter as it captures any variable (Rule 8.17).
  - The example `reference-parameters` draws with every shape: two locals, a struct, array
    elements handed over by a local function, a matrix's column, and an `@out` result.
- **A read of a local before it is assigned is refused** (proposal 0043; design rules 7.6 and
  12.7; surface §14). `TS8075 UNASSIGNED_READ`, by TypeScript's TS2454 rule, with an `@out`
  argument counting as an assignment; the editor shows it in TypeScript's place. The compiler
  accepted such a read before, and WebGL2 could read a value WGSL and the CPU did not. GLSL ES
  3.00 now starts a local with no initializer at zero, as WGSL and the CPU do.
- **A texture read back as bytes or as numbers, in the order it was submitted** (proposal 0028,
  item 5; design rule 11.11; surface §69; #407). `texture.read()` copies every uncompressed
  colour format of WebGPU and `depth32float` as bytes, rows tightly packed, where it copied
  sixteen formats, and `texture.readFloats()` resolves to a `Float32Array` of the same texels'
  channels as numbers, in the format's channel order: a float format decoded (a half float
  exactly), a `unorm` format 0 to 1, an `snorm` format -1 to 1, and `depth32float`. An integer
  format rejects with a `TypeError` that names `read()`. A host that read an `rgba16float`
  target decoded the half floats itself (stepinside wrote a `halfToFloat`), and the site's
  storage textures of `rgba8snorm` and of the integer formats were refused.
  - A read reads what was submitted before the call. Its copy is recorded and submitted before it
    awaits anything, so the queue runs it after every submit made before the call and before
    every one made after it: a frame submitted while the read is pending draws after the copy.
    `frame.submit()` and `rt.submit(…)` hand the queue their commands before their own first
    `await`, so a frame counts as submitted from the call and not from the moment its promise
    resolves; a frame recorded and not yet submitted is not read. The JSDoc of `read()` and
    `readFloats()` and surface §69 say so. The read also keeps the size the texture had at the
    call: it read `width` and `height` again after its `await`, so a `resize()` while it was
    pending unpacked the copy at a size it was not made at.
  - The formats are read from their names, the channels, the bits and how each is stored, with
    the four packed ones beside them, so a texel's bytes follow from the format: the 43
    uncompressed colour formats `@webgpu/types` lists, `r16unorm` and the other 16-bit `unorm`
    and `snorm` ones among them, and `depth32float`. A compressed format and `stencil8`,
    `depth16unorm`, `depth24plus` and the two combined depth and stencil formats reject with a
    `TypeError` that names what `read()` copies, before anything reaches the queue. The four
    packed formats decode too: `rgb10a2unorm` as a `unorm` format, `rg11b10ufloat` and
    `rgb9e5ufloat` as floats, and `rgb10a2uint` is an integer format.
  - Two choices the proposal left open. A `bgra8unorm` texel is blue, green, red, alpha, in the
    order its bytes hold it and its name says, so `readFloats()` and `read()` agree channel for
    channel. An sRGB format gives the numbers it stores, its bytes over 255, and not the linear
    values a shader reads.
  - `Texture` gains `readFloats()`, the one export that changes; `src/__api__/surface.md` records
    it.
  - `src/runtime/runtime.test.ts` holds, against the recording device, the bytes and the copy
    each format WebGPU has is given (the list read from `@webgpu/types`, so a format the types
    add is a failure until it is stated), the refusal of each format it cannot copy, the numbers
    each float, `unorm`, `snorm` and packed format decodes to (all 65536 half floats among them,
    held to the standard's formula), the refusal of each integer format, and, against a queue
    that runs each command buffer when it is given it, that a read started before a frame's
    `submit()` reads the texture as it was and one started after it reads the frame, from a frame
    and from the host's own encoders. Each test was shown to fail when `resources.ts` is broken
    in the matching way, among them a copy that waits for a tick before it is recorded.
  - `journeys/hdr-target/` draws values above 1 and below 0 into an `rgba16float` target on
    WebGPU through `typeshade/runtime` and reads the target back with `readFloats()`, each value
    a small dyadic number that is exactly the half float the target stores, so a readback that
    decodes one bit wrong fails. The harness starts the read while the frame is pending and
    draws a later frame that clears the target to -1 before the read resolves; the read holds the
    first frame, and the target afterwards the clear. A run names its float `target`
    (`journeys/README.md`).
  - `typeshade/runtime` is now 11,722 bytes minified and gzipped, 580 more than the 11,142 it
    was, and its budget in `scripts/bundle-budget.json` moves from 11,600 to 12,900 in this
    change, where a reviewer reads it: the size and about a tenth more, as the script's header
    says. The table of formats and their bytes is 138 of them, and `readFloats()` with its
    decoders is 442, about 90 of those the three packed formats'. `typeshade/emit` is as it was.

- **A program packed under emit options** (proposal 0028, item 4; design rules 11.10 and 11.11;
  surface §69). `packModule(m, { emit: { level, parens, fp64Flavor, plugins } })` emits the
  manifest's `wgsl`, its recorded variant's `wgsl`, its `glsl` and the fragment program of each
  of its WebGL2 draws, and its `bindings`, under those options: the WGSL writer's own and an
  optimization level, `'O0'`, `'O1'` or `'O2'`. `fp64Flavor` changes the bindings too, since the
  `'float'` flavor of the `f64` emulation binds the `_fp64` guard and the `'integer'` one binds
  none, so the manifest lists the guard its WGSL declares. The GLSL writer has no level, so
  `level` is the WGSL's alone. `packModule(m)` emitted the program at the defaults, so a host that
  shows or ships it under other options, an application's WGSL tab, could not hand the runtime
  the program it showed.
  - The manifest records what the build gave of `level`, `parens` and `fp64Flavor` in `emit`, so
    `repack` from `typeshade/emit` emits the program again under them and Rule 11.10's promise,
    that the IR emitted again gives every other field byte for byte, holds for a manifest packed
    under options, the recorded variant a load adds included. A manifest built with none has no
    `emit`, and absent stands for the default, so a manifest written before this one reads as it
    did.
  - A plugin is a function, which a manifest cannot record, so `{ ir: true }` with `plugins` is a
    `TypeError` that says the load-time emitter could not emit the program again. A word an
    option does not take is a `TypeError` too, naming what the option takes: the writers read an
    unknown level as the full optimizer, an unknown `parens` as `'minimal'` and an unknown flavor
    as `'float'`, and the manifest would have recorded the word it was given. A WebGL2 draw reads
    the block and sampler names it binds by from the program the plugins leave alone, since a
    text plugin such as `minify` writes a declaration this reads by its spacing, and ships the
    program the plugins write; the names a plugin keeps are the ones a host binds by.
  - `PackOptions` gains `emit` and `Pack` gains `emit`, the two exports that change, and
    `src/__api__/surface.md` records both; no name is new. `PackOptions` is declared beside the
    builder now, in `src/core/manifest.ts`, since it names the writers' types, and `Pack['emit']`
    spells the words out, so that the program runtime's module closure is the 29 modules it was
    and reaches no emitter; the build stops when a word is in one and not in the other. The
    plugin's options are as they were (`typeshade({ console, ir })`, surface §64).
  - `src/core/manifest.test.ts` packs every example under each of three levels with each of the
    two flavors, under `parens: 'minimal'` and under all three, and holds the manifest's WGSL to
    what the writers emit under those options and `repack` to giving the manifest back byte for
    byte; and, for six subjects, two of them programs that emulate `f64`, that each level, flavor
    and `parens` gives the GLSL, the bindings, the recorded variant and the WebGL2 draws those
    options emit, the guard among the bindings only under the `'float'` flavor. It holds each
    refusal's sentence, and
    fails when an option is left out of the WGSL, the GLSL, the recorded variant, the bindings
    or a draw, when the manifest does not record its options, and when `repack` does not read
    them. `src/runtime/runtime.test.ts` holds, against the recording device, that the runtime
    makes its shader module from the manifest's text and lays it out by its bindings, and that
    the variant a load-time emitter adds is the one the recorded options emit.
  - `journeys/emit-options/` runs a compute entry and a full-screen draw that compute in emulated
    doubles on WebGPU through `typeshade/runtime`, each packed at the defaults and under four
    sets of options, and holds every result to plain JavaScript's doubles and to the CPU oracle's.
    It fails when the WGSL leaves out the flavor its bindings follow ("Binding doesn't exist"),
    and it found the bug listed under Fixed: Tint refused the WGSL that `parens: 'minimal'` wrote
    for an arithmetic operand of a bitwise or shift operator.
  - `typeshade/runtime` is still 11,142 bytes minified and gzipped, and `typeshade/emit`, which
    carries the manifest builder, is now 76,132, 6,368 under its budget. Rule 11.11's rationale,
    surface §69 and the header of `scripts/bundle-boundary.ts` said about 10 KB for the runtime,
    which it was before the overrides, the sample types and the console's counts, and about 75 or
    78 KB for the emitter; they say about 11 and 76.

- **The console's counts, to the host** (proposal 0028, item 3; design rule 11.11; surface §69).
  `frame.submit()` and `rt.submit(…)` resolve to what the console buffers of that submit held,
  `{ console: [{ entry, lines, dropped }, …] }`: a row for each dispatch and draw that recorded,
  in the order they were recorded, with its entry (a draw's is its fragment entry), the lines the
  buffer kept and the calls that did not fit it. A runtime given a sink,
  `createRuntime({ console: sink })`, prints nothing now: it printed the warning for the calls
  that did not fit on the host's console beside the sink, so a host that shows the lines itself
  could not show how many were dropped. The default, `'print'`, prints the lines and the warning
  as it did.
  - `Frame`'s and `Runtime`'s `submit` are the two exports that change; they resolved to nothing.
    The row type is written where `Frame.submit` declares it, and `Runtime.submit` returns the
    same type, so no name is new. `src/__api__/surface.md` records both.
  - `lines` counts each `console.*` call the buffer kept once, as the sink receives it, so a
    `console.table`, which is printed as two calls of the host's console, is one line. A
    dispatch whose entry made no call is a row all the same, with no lines.
  - `src/runtime/runtime.test.ts` holds, against the recording device, a row for each dispatch
    and each draw with its entry, in the order recorded, from a frame and from the host's own
    encoders; a submit that recorded nothing; that each submit gets the rows of its own; that a
    runtime given a sink prints nothing, the warning included; and that the default prints the
    lines and the warning as it did. `journeys/_harness.mjs` read the dropped count by patching
    the page's `console.warn`, which a runtime given a sink no longer prints to; it reads the
    counts from `submit()` now, holds the rows to the entry that records, the lines to what the
    sink was handed and the dropped count to what the buffer had no room for, and fails when the
    runtime prints the warning.
  - `typeshade/runtime` is now 11,142 bytes minified and gzipped, 458 under its budget.

- **A texture's sample type, from the calls that read it** (proposal 0028, item 2; design rules
  11.10 and 11.11; surface §69; #404). `reflect()` reports each sampled texture's `sampleType`,
  WebGPU's word for what a `GPUTextureBindingLayout` takes: `depth` for a depth texture, `uint` or
  `sint` for an integer one, `float` for an `f32` texture that a call pairs with a `sampler`, and
  `unfilterable-float` for every other `f32` texture, which no sampler reads: one the program only
  loads, measures or counts, one no entry reaches, and a multisampled one (#414). The manifest
  carries it in the binding's `resource`, and the program runtime lays each texture out by it. The
  runtime laid out every `f32` texture `float`, which takes filterable formats only, so a host
  could not bind an `r32float` or an `rgba32float` texture that a program only loads, and WebGPU
  named the layout in its error and not the binding.
  - The pairs are read where the handles flow, not only where a call names two bindings: a
    `textureSample` of any form or a `textureGather`, which puts its component first, through a
    helper function's parameters, and through a `const` of the texture and of the sampler.
    Measured on Dawn (Chromium 153, SwiftShader), a texture laid out `unfilterable-float` beside a
    `filtering` sampler is refused for each of them and accepted when the texture is only loaded.
    `texturePairs`, which gave the WebGL2 tier the sampler each texture is fused with, read a
    call's first two arguments through plain names, so it missed `textureGather(0, t, s, uv)`, a
    helper's parameters and a `const`, and would have left the `albedo` of `cube-array-gather` an
    `unfilterable-float` texture a sampler gathers. It is now one analysis,
    `src/core/passes/texture-pairs.ts`, for both consumers: the WebGL2 tier's `samplers` name the
    sampler of a texture read through a `const`, which they left `null`.
  - The sample type follows the texture and not one entry: a texture one entry samples and another
    loads is `float` for both. A module with a `raw` statement in what its entries reach is opaque,
    so its `f32` textures are `float`, as they all were; a module with no entry is read whole,
    since a host writes the entries over it. A manifest written before the sample type existed
    carries none, and the runtime lays its texture out from its element, as it did.
  - `BindEntry` gains `sampleType`, the one export that changes, and `src/__api__/surface.md`
    records it; the manifest's `PackResource` carries the same word.
  - `src/core/passes/texture-pairs.test.ts` holds each way a call pairs a texture with a sampler
    and each it does not, `src/core/manifest.test.ts` holds every example's texture to the calls
    in its WGSL, and `src/runtime/runtime.test.ts` holds, against the recording device, the layout
    of a texture only loaded and of one a sampler reads. `journeys/textures/` binds an `r32float`
    level a program only loads, beside two textures a sampler reads, on WebGPU through
    `typeshade/runtime`; it fails when the runtime lays the level out `float`, and when a texture a
    sampler reads is laid out `unfilterable-float`.
  - `typeshade/runtime` is now 11,105 bytes minified and gzipped, 495 under its budget, and
    `typeshade/emit`, which carries `reflect()`, 75,526.

- **A host sets a program's overrides by name** (proposal 0028, item 1; design rule 11.11; surface
  §69). `RenderState.constants` and `program.compute(entry, { constants })` take a record of
  override name to value, and every stage of the pipeline is created with it as WebGPU's
  `constants`, keyed by the name the source declares, which is the name the WGSL declares. An
  override the record leaves out keeps the default its declaration states. The runtime made every
  pipeline with no values, so a host had no way to set one.
  - A name the manifest's `overrides` does not list is a `TypeError` that names the program's
    overrides; a value its type cannot hold is a `TypeError` that says what the type takes: an
    `f32` takes a finite number no larger than 3.4028234663852886e38, an `i32` or a `u32` a whole
    number in its range, and a `bool` a boolean or a number, where 0 is false. Measured on
    Chromium 141, WebGPU alone refuses an undeclared name without saying which overrides the
    module has, and converts silently a fraction for an `i32` or a `u32`, and a string or a
    boolean for any type.
  - The pipeline cache keys on the values, so two states that differ in an override are two
    pipelines and the same values give the same pipeline back, whatever order the record is
    written in and whether a `bool` is spelled `true` or `1`. An `f32` tells `-0` from `0`, which a
    shader can tell apart; an integer has no `-0`.
  - `Program`'s `compute` takes the options as its second argument, and `RenderState` gains
    `constants`; each option's default is in its JSDoc, and `src/__api__/surface.md` records both.
  - `src/runtime/runtime.test.ts` holds, against the recording device, the values each stage is
    created with, each type's refusal with its sentence, the values each type holds and the
    cache's key. `journeys/overrides/` runs a compute entry and a render pair on WebGPU through
    `typeshade/runtime` at their defaults, at other values and at one value with the rest at
    their defaults, each result held to a plain JavaScript reference and to the CPU oracle's run
    of the module with the values as the overrides' defaults. The journey fails when the compute
    stage, the vertex stage or the fragment stage is created with no values.
  - `typeshade/runtime` is now 11,099 bytes minified and gzipped, 501 under its budget.

- **CI runs the type check and the unit suite on TypeScript 5.9 and 6.0, beside the pinned 5.6.3**
  (#259; Rule 13.4). `typecheck + unit` installs the 5.6.3 that `package.json` pins, and the
  editors that load the language service ship newer ones. A newer TypeScript had already changed
  what the compiler reads once, with the pinned one silent: TS2454 on workgroup memory, reported
  from 5.7 (#247). The `typescript-versions` job installs 5.9.3 and 6.0.3 over the pin with
  `bun add --no-save`, fails a leg that does not run the version it names, and runs
  `bun run build` and `bun run test`. Each leg is a check of its own, named for its version:
  `typecheck + unit (TypeScript 5.9.3)` and `typecheck + unit (TypeScript 6.0.3)`. The release
  workflow waits on both. With #247's rule disabled, `src/language-service/ambient.test.ts`
  passes 228 of 228 on 5.6.3 and fails four Playground examples on each new version: the editor
  half, which the pinned version could not read.
  - `src/api-surface.test.ts` was red on both new versions with the surface unchanged. TypeScript
    5.7 prints a typed array with its default type argument, `Uint8Array<ArrayBufferLike>`, in 4
    shapes, and 6.0 turns `strict` on by default, which put `| undefined` on the optional members
    and moved 166 lines. The reader now sets `strict: false` and drops that type argument, so
    `src/__api__/surface.md` is byte for byte the same baked on 5.6.3, 5.9.3 and 6.0.3, and two arms
    hold the reader to each.
  - The peer range stays `>=5.0.0 <6`. 6.0.3 passing is what admitting it would rest on, and
    that decision is not part of this change.

- **The compile gate draws on a device through the program runtime** (#392; Rule 11.11). The
  runtime's render path was tested against a recording fake device, and the gate's program tier
  only dispatched compute entries, so a wrong depth state, index format or load op passed every
  test and showed in a host first. The entry-call leg now draws three small programs
  (`scripts/render-case.ts`) through `typeshade/runtime` on WebGPU, as a host does, and reads
  colour and depth back:
  - the `passes` frame, in one `frame.pass()`: a sky drawn with `compare: 'always'` and
    `write: false`, then two indexed draws under `compare: 'greater'` over a depth cleared to 0,
    one from a `Uint16Array` and one from a `Uint32Array`; then a second pass that loads colour
    and depth (`load: 'load'`) and draws from the host's own `GPUBuffer` vertex and index
    buffers;
  - the `pulled` frame: vertices a shader pulls from a storage `Resident` by `vertex_index`,
    drawn indexed by a `Uint16Array` of three (six bytes, which the runtime pads) and by a host
    `GPUBuffer` of `uint32` indices.
  - Each frame is held to a picture computed in plain JavaScript, colour within one 8-bit step
    and depth within 1e-6. The shapes lie on the pixel grid, so coverage is exact and on
    SwiftShader nothing differs.
  - The instrument comes first (AGENTS.md#gate-discipline): the same frames drawn with
    `compare: 'less'` must differ from the picture, and each frame must hold at least 4 or 3
    distinct colours, so a blank one cannot pass.
  - `src/render-case.test.ts` holds what needs no device: the pictures, the comparison, and both
    halves' reading of the three programs, the compiler's and the editor's.
  - Fourteen one-line faults were put into `src/runtime/`, one at a time: a depth compare, write,
    clear or load ignored; a colour clear or load ignored; a `Uint16Array` or a `Uint32Array` of
    indices bound in the other format, and a host index buffer bound in one format whatever it
    holds (two faults); index data not padded to four bytes; `drawIndexed` recorded as `draw`;
    the vertex buffer never set; a pass's later draws made with its first pipeline. Before this
    the gate passed all fourteen, the recording-device suite 13 and the engine journey 12. Now
    the gate fails on each.

- **`gate:differential` holds its planner to the storage-buffer limit and its entries to the zero start of a local**: two hand-built chains, one whose four maps bind eight arrays so that the partials of its last call, a sum, make nine, and one whose scratch array `t[i] += a[i]` reaches the output through a local. A planner that does not count the partials and an entry whose local starts at one are each REPORTED (proposal 0058, step 4 instruments).

- **A fuse scope's report gives each group's GPU time (change 0066, #669).** On a WebGPU device that
  offers `timestamp-query`, each `FuseReport` group carries `gpuTime`, the nanoseconds of its
  passes summed. The plan's submission count doesn't change. A flush of more than 2048 passes, a
  CPU-tier group and a WebGL2 plan give no `gpuTime`, and a timing failure never rejects the plan.

- **A kernel function declares its workgroup size with `@workgroup_size([n])` (change 0067,
  #660).** A chain splits where the declared sizes differ, and a call with no attribute takes its
  group's size. The new `TS8077` refuses the attribute on a kernel with a reducing loop. On WebGPU,
  `FuseReport` groups carry `workgroupShapes`, one `[n, 1, 1]` for each loop.

- **`typeshade/language-service` exports `hostFace` (change 0062, #591).** A tool without Vite
  can make the host face of a `"use typeshade"` module, with the types `HostFace`,
  `HostFaceOptions` and `HostExport`. Its output equals the Vite plugin's transform.

- **The host examples (change 0061, #577).** `examples/hosts/<id>/` holds six examples, each a
  `"use typeshade"` module and the `host.ts` that runs it: `host-draw`, `host-compute`,
  `host-kernel`, `host-resident`, `host-helper` and `host-program`. `typeshade/examples`
  exports `hostExamples` and `HostExample`. `gate:journeys` and the unit suite check the tiers
  each example lists.

- **The host example `loop-fuse` (change 0058, #583).** Its kernel functions `add`, `mul`,
  `relu` and `pairsum` run in `fuse` scopes from `typeshade/fuse`, with intermediates in
  `scope.scratch(n)` and the output in a `resident()`. `run()` returns each scope's values and
  report.

- **A `@compute` entry's workgroup size and workgroup array lengths can name overrides (change
  0057, #565).** `program.compute(..., { constants })` sets them from host conditions, and the
  resolved `workgroupShape` is reported. The CPU oracle follows the same values. WebGL2 refuses a
  specialized shape other than the default, with a message. The example `workgroup-override`
  selects 64 or 256.

- **`==` and `!=` are accepted as typed aliases of `===` and `!==` (change 0034, #437).** The
  operands are type-checked the same way, and the emitted comparison is the same.

- **`min` and `max` take a vector and a scalar (change 0033, #434).** `min(vecN, scalar)` and
  `max(vecN, scalar)` are accepted in the compiler and the editor. The scalar is emitted as a
  vector splat on WGSL and GLSL.

- **A value parameter can be reassigned, and an authored name survives a backend's reserved words
  (changes 0031 and 0032, #433).** A whole-value assignment to a parameter writes a mutable local
  copy. A name the backend can't use, such as `target`, gets an escaped spelling in WGSL and GLSL,
  while diagnostics and the debugger keep the authored name. Imported shader modules keep their
  own scopes and diagnostics.

- **A class with no fields compiles, and an integer-written local takes its type from a call
  (changes 0035 and 0036, #440).** A fieldless class gets an internal GPU representation, while
  host and CPU objects keep no fields. A local written with an integer literal and passed to a
  declared nongeneric function takes the parameter's type, with conflict and range diagnostics.
  A newline-ended `return` gets an explanation; its meaning doesn't change.

- **More TypeScript compiles: integer locals from more contexts, derived classes in base
  positions, and shadowing (changes 0037, 0038 and 0039, #443).** An integer-written local takes
  its type from a constructor, a member or a typed assignment. A derived value is accepted where a
  read-only base is expected and dispatch is the same. A function's parameters and locals may
  shadow module values; same-scope duplicates stay errors.

- **The example `capsule-corp-namek-class` (#432).** A class-based conversion of the Capsule Corp.
  Namek shader, in the example corpus with its WGSL and GLSL goldens.

### Changed

- **A function the file declares wins over every builtin function of its name** (proposal 0029;
  design rules 3.2 and 9.5; surface §10, §15, §62 and §69; #403). The rule kept the builtins that
  predate it (`fract`, `pow`, `clamp`, `min` …) in front of a function of the module, and that held
  in the constant folder and on the CPU alone: WGSL calls the declaration, and ANGLE refuses a
  program that redeclares a GLSL ES 3.00 built-in function, so `function fract(x: f32): f32 { … }`
  had three answers, 0.75 on WebGPU, 0.25 on the CPU and none on WebGL2. It has one, the
  declaration's, in the folder, on the three CPU walks, on WebGPU and on WebGL2, in the program
  runtime's manifest and its WebGL2 pass programs, and in the CPU tier of a generated host module,
  and it is what the editor's hover shows. Every builtin function is user-first, a WGSL built-in
  function, the free spelling of a `Math` member and a TypeShade extension that is a function
  (`random`, `sum`, `fill`), and `USER_FIRST_BUILTINS` is the two names it keeps, `bool` and
  `f64`. A value constructor keeps its precedence, as a type name does over an alias (Rule 4.2):
  `f32(x)` beside a declared `f32` is still the cast. Each writer emits a declared function whose
  name its target predeclares under another, `fract_` and then `fract_1`, and every call through
  it, so a builtin call keeps the builtin: the `fract` that `random(p)` expands to, and a
  `Math.pow(a, b)` beside a declared `pow`. WGSL predeclares its built-in functions, its types and
  aliases (a declared `f32` hid the type in the whole module) and the enumerants its text spells
  (`read`, `storage`, `rgba8unorm`); GLSL ES 3.00 predeclares the built-in functions of its
  section 8. An entry point keeps its name, so an entry named like something WGSL predeclares
  is refused with `TS8068` where the module's WGSL uses that name (`@compute export function
fract()` beside a `random(p)`), where its WGSL reached Tint with no diagnostic; an entry named
  `step` in a module that never calls `step` still compiles. A function handed by its name follows the call, to a fold, an array method or a
  function that takes one: `zip(xs, ys, atan2)` beside a declared `atan2` calls it, and
  `xs.map(u32)` beside a declared `u32` is refused, since a call of `u32` is the cast. An analysis
  that reads a builtin's arguments by its name reads a call through a declaration as a call of a
  function: a kernel loop that calls a declared `atomicAdd(a: f32, b: f32)` is a map, not an
  atomic. The compile gate has a leg for it, a function declared under each name a writer renames,
  on Tint and on ANGLE, with the same modules handed over un-renamed as its instrument, and #403's
  program run on WebGPU against the CPU oracle. No example's emit moves; a module that declares
  such a function reads `fract_` in its WGSL and GLSL, and the CPU still calls it `fract`.
  `typeshade/emit` grows by about 2 KB gzipped.

- **A module with a render entry and a `@compute` entry has GLSL** (proposal 0054, step 3;
  design rules 10.3 and 10.5). `compile()`'s `glsl` now holds the vertex and fragment programs
  of what the render entries reach. The compute entry runs on WebGL2 as its pass program. A
  storage binding the compute entry writes and the render entries only read is a data texture
  to them. Before, such a module had no `glsl` and one `TS8015` warning (`missing
capabilities: storageBuffer, compute`). A compute entry with no pass program (one that
  reaches a storage texture) is now the one `TS8015` warning, and it names the entry.

- **`dispatch` runs a compute entry in the WebGL2 tier's passes** (proposal 0054, decision 3a;
  surface §23 and §25). `compileModule(m).dispatch` and `compileModuleJs(m).dispatch` cut the
  entry at its barriers, its atomic operations and where a four-entry write log could be full,
  and run every invocation of the dispatch one pass at a time: a pass reads memory as it began
  plus the invocation's own writes, and the writes land in invocation index order. The held
  atomic operations of the whole dispatch are performed in invocation index order between passes,
  so an append buffer over two workgroups gives every invocation its first slot before any its
  second, where before each workgroup ran to its end first. A data race reads the value from the
  start of the pass. Every program whose result WGSL defines gives the same result as before.

- **A lockstep `dispatch` performs atomic operations in the phased order** (proposal 0054,
  decision 3a; surface §23 and §25). Each invocation of a workgroup now stops before each atomic
  operation, and the held operations are performed in invocation index order before any invocation
  runs on: the first operation of every invocation, then the second. Before, each invocation ran
  to its end before the next began, so an append buffer gave invocation 0 its slots first. Both
  orders are ones WGSL allows; this one is the order the WebGL2 tier's resolve pass will give, so
  the two agree. `compileModuleJs(m).dispatch` runs an entry that reaches an atomic operation on
  the interpreter's lockstep path, as one that reaches a barrier.

- **On GLSL ES 3.00, a storage struct array with a `u32` or `i32` field is an R32UI data
  texture** (proposal 0046, #484). Its integer fields were read through an R32F texel and
  `floatBitsToUint`, which GLSL ES 3.00 §2.1.1 lets a driver break for a small integer; every
  lane is now read as a `u32`, a float field through `uintBitsToFloat`, and an `i32` field,
  refused before, through `int()`. A struct of float fields is unchanged. **A host that
  allocates the texture itself must give such a struct array R32UI** and upload its std430
  bytes as a `Uint32Array`: an R32F texture there is incomplete and reads zero, with no error.
  `BindEntry` gains `glslDataTexture` (`'r32f' | 'r32ui' | 'r32i'`) on every storage binding,
  so a host reads the format instead of deriving it. The WebGL2 kernel tier and
  `createComputeRunner` upload the format the GLSL declared; the runner's single read binding
  was always R32F before, an `array<u32>` included.

- **The CPU tier's code is written by type, and a host call of a small function is several
  times faster** (#410; Rules 11.7 and 8.21). The generated CPU code wrapped every
  subexpression in the generic `$.B["__fround"](…)`, which made a new array for a vector at each
  use, built a swizzle's index list on every call, sent vector arithmetic through `applyBin` and
  its operator string, and rounded a parameter again at every read. It now reads the IR's
  types: a vector operation of a known width is written out one component at a time, each
  component the scalar operation the runtime helper applies to it; a per-component builtin
  calls the one scalar function its `BUILTINS` entry is built from (`COMPONENTWISE`); `dot`,
  `length`, `distance`, `normalize` and `cross` are summed term by term in their entries' order;
  `Math.fround` and every helper are bound once at the top of the module; an `f32` parameter is
  rounded once as the function is entered; and a value the code has just built is stored
  without a copy. An operand with an effect, and every operand before one, is still evaluated
  once and in order. A vector operand that may be missing when the code runs (the result of a
  function that reaches a `discard`, an element read past the end of an array, a matrix column
  past its last) keeps the runtime helper, which takes it as a scalar, as the interpreter does,
  where a component read would throw; the module is followed once for where such a value goes.
  At the boundary, `toShader` converts a number that fits without descending the parameter's
  type and a vector or matrix with one loop for its element kind, `fromShader` copies an array
  without `Array.from`, and the call takes its arguments without an array spread. Results and
  refusals are unchanged bit for bit, but for one thing: a component that nothing reads is no
  longer computed, so an error that only it would raise (a field read of an array element past
  the array's end) is not raised. `src/core/cpu-codegen.test.ts` holds each new path to the
  interpreter in both precisions at NaN, ±0, the infinities, subnormals and the integer wrap,
  with shared argument arrays, calls that write an operand between the operands, and values the
  module leaves missing; `src/core/host-values.test.ts` holds each conversion to the one it
  replaces, its refusals' text and what it reads of a host array (an accessor, a `Proxy`)
  included; and the compile gate's entry calls and the GPU differential's WebGL2 leg hold the
  generated code to a GPU. The issue's two functions, called
  in Bun: a host call pair from about 3.4 µs to 0.5 µs, the two bodies alone from 1.25 µs to
  0.1 µs (medians of ten timings on a loaded machine; the same code by hand is 0.05 µs).

- **The `typescript` peer range takes TypeScript 6** (#259). `peerDependencies` reads
  `>=5.0.0 <7`, where it read `<6`. CI runs the type check and the whole suite on 6.0.3 as well
  as on the pinned 5.6.3 and on 5.9.3, so a project on TypeScript 6, the version VS Code ships,
  installs `typeshade` without a peer conflict. TypeScript 7 stays out: its default export has
  no `SyntaxKind`, and the package throws on import against it. A wider range breaks nothing
  (Rule 13.9 counts only a narrower one).

### Removed

- **A meaning that an ECMAScript form carries in every case has that one spelling (change 0112,
  change 0112).** The ambient library no longer declares, and the front end no longer resolves, the
  names below. A program that calls or reads one stops compiling with a sentence that names the
  spelling to write instead; no deprecation window applies, because nothing compiles to another
  result (Rule 13.10, before `1.0.0`). The emitted WGSL and GLSL of the replacement are the same.
  - `arrayLength(xs)`: write `xs.length` (`TS8004`).
  - `pow(a, b)`: write `a ** b` (`TS8004`).
  - `PI`, `E`, `LN2`, `LN10`, `LOG2E`, `LOG10E`: write `Math.PI`, `Math.E`, `Math.LN2`,
    `Math.LN10`, `Math.LOG2E`, `Math.LOG10E` (`TS8022`). `TAU` stays.
  - `log10`, `log1p`, `expm1`, `cbrt`, `hypot`: write `Math.log10`, `Math.log1p`, `Math.expm1`,
    `Math.cbrt`, `Math.hypot` (`TS8004`).
  - `sum(xs)`: write `xs.reduce((a, b) => a + b)` (`TS8004`).
  - `any(xs, p)` and `all(xs, p)`, the array folds only: write `xs.some(p)` and `xs.every(p)`
    (`TS8019`). `any(v)` and `all(v)` on a bool or a bool vector stay.
  - `none(xs, p)`: write `!xs.some(p)` (`TS8004`).

  The thirteen rows of these names leave the §9.3 table (Rule 9.6). A function or constant the
  file declares under one of these names is the file's own (Rule 9.5). The examples `atomic-histogram`, `gpu-console`,
  `workgroup-override`, `workgroup-scratch` and `higher-order`, and the examples that wrote `pow`,
  now use the replacements.

- **The package root no longer exports the IR builder** (proposal 0060, steps 1 to 3; Rule
  11.19). An author writes a program in `"use typeshade"`. The builder's 209 values (`fn`,
  `module`, `Let`, `If`, `Loop`, the node classes `Node`, `ReadonlyNode` and `Builder`, a
  function per WGSL builtin, a type token per type, and the declarators `uniformStruct`,
  `ioStruct`, `storageBuffer` and the rest) leave `typeshade` and stay at `typeshade/core/ir`,
  which now also exports the declarators of `src/core/sot.ts`. The root keeps the IR's 65 types
  and 17 readers over a compiled module (`typeKey`, `typeEq`, `stageOf`, `workgroupSizeOf`,
  `workgroupShapeOf`, `sourceSpanOf`, `isScalar`, `isVec`, `isMat`, `isVec64`, `isMat64`,
  `isF64`, `ALL_CAPABILITIES`, `ALL_STORAGE_TEXTURE_FORMATS`, `READ_WRITE_STORAGE_FORMATS`,
  `WRITE_ONLY_STORAGE_FORMATS`, `storageFormatFeature`). Code that builds IR changes its import:
  `import { fn, module, vec4 } from 'typeshade/core/ir'`. `typeshade/core/ir` carries no
  stability promise before 1.0. `AUTHORING.md` teaches `"use typeshade"` alone, and the new
  `docs/ir-builder.md` describes the builder for engines and tools.

### Fixed

- **Output-pane backend diagnostics** (#321, misc#5). GLSL shortfalls now use the compiler's
  warning text for render modules and stay quiet without a render entry. WGSL failures remain
  errors on every output target. A render+compute module's GLSL uses the compiler's render
  selection. Output requests leave cached document diagnostics unchanged.

- **Generic call diagnostic merging** (#321, classes#14). A wrong type-argument count now
  keeps the compiler's single diagnostic in the editor and `tshc check`. Independent
  TypeScript errors and value-argument count errors retain their diagnostics.
