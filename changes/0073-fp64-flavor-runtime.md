---
id: '0073'
title: 'A host picks the df64 flavor of its kernels at run time, by the device'
status: implemented
rules:
  - '8.22'
  - '11.8'
  - '11.13'
surface:
  - 39
  - 64
  - 65
  - 71
exports:
  - configure
  - DeviceOptions
  - Device
  - recommendFp64Flavor
  - isAppleGpu
  - Fp64FlavorSignals
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The English API reference is generated from the JSDoc of `createDevice` and `configure`, which gain the `fp64Flavor` option, and of the three helpers `typeshade/runtime` re-exports. The Korean entries for `createDevice` and `configure` are translated again. The guide page that describes the emulated double (surface section 39) gains the run-time choice. Not read in this draft; the implementation reads the site before acceptance is recorded.
  - repo: vscode-typeshade
    what: The host references that describe `createDevice(options)` and `configure({ prefer, runtime })` describe the flavor option. The skill's passage on `f64` names the flavor a device needs. Not read in this draft; the implementation reads the plugin before acceptance is recorded.
---

<!-- doc-refs: skip-file — this draft names fields, options and tests that a later implementation adds, which this tree does not have yet -->

**Document control**

| Field                       | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document                    | Proposal 0073; this file is the proposal source and the approved design of the change. Option A is the decided design. Options B and C are recorded as alternatives that this proposal does not take.                                                                                                                                                                                                                                                                                                                                                                           |
| Revision context            | Drafted 2026-10-19, Asia/Seoul. This date is the authoring context. The owner approved the proposal on 2026-10-19 (Asia/Seoul) in the project conversation; see Approval and plan record. The draft was first numbered 0071 from a stale listing; ids 0071 and 0072 were in use on `origin/main`, so it is 0073. A verification pass of 2026-10-19 aligned it with change 0071 (the device owner), implemented on the review baseline.                                                                                                                                          |
| Request source              | The owner, Seungup, asked in the project conversation of 2026-10-19 for the cause of two failures of the typecv lab on real GPUs, and for a fix. The failures are recorded in the lab's collector (see Why). No GitHub issue is recorded for this draft.                                                                                                                                                                                                                                                                                                                        |
| Current lifecycle state     | `implemented`. Accepted by the owner's approval of 2026-10-19 (see Approval and plan record), recorded by the merge of PR #685 (`0fd03c4`). Implemented by PR #687 (see Configuration and validation record).                                                                                                                                                                                                                                                                                                                                                                   |
| Applicability / effectivity | The fp64 lowering and its two flavors (`src/core/passes/fp64-lower.ts`, `src/core/fp64/`), the host face a `.shade.ts` import carries (`src/compiler/ts/host-face.ts`, Rule 8.22), the call layer and the device owner of change 0071 (`src/core/resident.ts`, `src/core/owner.ts`, `src/runtime/device.ts`, `src/core/host-kernel.ts`, `src/core/host-compute.ts`, Rule 11.8), the fuse planner and its entry (`src/core/fuse-entry.ts`, Rule 11.13), the `typeshade/runtime` and `typeshade/fuse` subpaths, and the downstream documentation. No release version is assigned. |
| Review baseline             | `origin/main` at `be90a216d2900a24ffd4bb915b070ac74cc36028` (commit "Merge pull request #683 from typeshade/claude/fuse-side-effect").                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Proposal review             | [PR #685](https://github.com/typeshade/typeshade/pull/685), the proposal-only pull request.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Revision authority          | Git records the revisions of this file. The review and merge of PR #685 record the decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## What changes

**Before.** `f64` is an emulated double (surface §39, Rule 4.4). The fp64 lowering pass rewrites it into `f32` pairs and `df64_*` helper calls under one of two flavors (`Fp64Flavor`, `src/core/passes/fp64-lower.ts`). The `'float'` flavor computes the error terms with `f32` arithmetic and binds the `_fp64` guard. The `'integer'` flavor computes the same error terms through integer primitives, which a fast-math compiler cannot reassociate, and binds no guard. `recommendFp64Flavor(signals)` (`src/core/fp64/flavor-select.ts`) names the flavor a device needs: `'integer'` on an Apple GPU, `'float'` everywhere else. Both are exported from `typeshade` only.

The flavor is chosen at build time, and only by one path. `packModule(m, { emit: { fp64Flavor } })` records it in a manifest (Rule 11.10, surface §69). The host face of a `.shade.ts` import (Rule 8.22, surface §64) carries each kernel function's WGSL emitted at build time (`emitModule(plan.module)` in `src/compiler/ts/host-face.ts`, line 980), and under `typeshade({ fuse: true })` the lowered module as portable IR (line 1140), both under the `'float'` flavor and with no option to change it (`TypeshadeViteOptions` has `console`, `fuse` and `ir`; `HostFaceOptions` has no flavor). `callKernel` (Rule 11.8) dispatches that WGSL, and a fuse scope (Rule 11.13) emits its fused entry from that IR (`emitModule(module)` in `src/core/fuse-entry.ts`, line 769). Since change 0071 a host opens a device owner, `createDevice(options)` on `typeshade/runtime`, which holds the tier, the arrays and the plans of its calls; `DeviceOptions` takes `prefer`, `device`, `runtime` and `poolBytes`, and no flavor, and the default owner of a bare call takes `configure({ prefer, runtime })`, and no flavor either. A host that imports `.shade.ts` modules therefore runs the `'float'` flavor on every device, an Apple GPU included, where the library's own record says the flavor is wrong (the comment of `src/core/fp64/flavor-select.ts`, PR X-GIS #924 to #932).

**Decided design (option A).** A host chooses the flavor when it opens the device, and every call and every plan of that owner runs the chosen flavor:

1. `createDevice({ fp64Flavor })` takes the flavor as an option of the owner (change 0071), `'float'` or `'integer'`, and `device.fp64Flavor` reports it. Every kernel call (Rule 11.8), entry call (Rule 8.24) and `device.fuse()` plan (Rule 11.13) of that owner runs it. The default owner takes the same word through `configure({ fp64Flavor })`, a third option beside `prefer` and `runtime`, which applies to the calls made after it. The default of both stays `'float'`, which is the lowering every module runs today, byte for byte. An unknown word is a `TypeError` that names the two words.
2. The host face of a module that emulates `f64` carries both lowerings. Each kernel function's face carries its WGSL under the `'float'` flavor, as today, and under the `'integer'` flavor (`wgslInteger`). Under `typeshade({ fuse: true })` the fuse record carries the portable IR of both (`ir`, as today, and `irInteger`). A module that emulates no `f64` carries one of each, as today, and the option changes nothing for it.
3. `callKernel`, `callCompute` and the fuse planner read the owner's flavor at the time of the call and take the matching WGSL or IR. The pipeline and bind-group caches key on it, since the two texts are two pipelines. The `_fp64` guard is bound under `'float'` and absent under `'integer'`, as the manifest path does today (surface §69).
4. `typeshade/runtime` re-exports `recommendFp64Flavor`, `isAppleGpu` and `Fp64FlavorSignals`, so a host that ships only the runtime (Rule 11.11) can pick the flavor from a WebGPU adapter's `info` and the user agent without the compiler.
5. The fuse report does not change shape. The WGSL of a fused entry under `'integer'` has the `df64_*` helpers of that flavor and no guard binding.

**Example (illustrative, not an accepted example).** A host opens a device owner with the flavor the adapter needs and runs its kernels:

```ts
import { createDevice, recommendFp64Flavor } from 'typeshade/runtime';
import 'typeshade/fuse';
import { refine, score } from './bundle.shade.ts';

const adapter = await navigator.gpu.requestAdapter();
const device = await createDevice({
  prefer: ['webgpu'],
  fp64Flavor: recommendFp64Flavor({ adapterInfo: adapter?.info, userAgent: navigator.userAgent }),
});
await device.fuse(() => {
  score(poses, points, costs); // the integer flavor on an Apple GPU, the float flavor elsewhere
  refine(costs, poses, out);
});
```

The example set does not change (`examples: []`).

## Why

**The failures.** On 2026-10-19 the typecv lab (`cv.typeshade.dev/lab/`, typecv at `486df3b`, which pins typeshade `212d26d2`) sent three failure records to its collector. The numbers below are copied from those records.

| Record (collector id)        | Device                                     | What happened                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `20261019100719260-789ba764` | Apple GPU, iPhone, iOS 18.7, Safari 27.0.1 | Pair verification (a RANSAC with adaptive stopping on `f64` scores) took 35.3 s for 10 pairs, 310 submissions, 3.5 s per pair. On SwiftShader the same pairs take under 0.4 s each. The device was then lost in the fifth verification, at the kernel `snapshotPairModelBudget`.                                         |
| `20261019100902196-f82a27f5` | the same iPhone                            | The eight-frame pyramid benchmark verified 22 pairs in 59.2 s (682 submissions) and then found no stable initial pair. The same sample registers eight of eight views on SwiftShader and on the CPU tier.                                                                                                                |
| `20261019095412032-e5e0f937` | NVIDIA Blackwell, Windows, Chrome 155      | The first pair verified in 176 ms (3 submissions). The device was then lost, `DXGI_ERROR_DEVICE_HUNG`, in the first triangulation, a kernel of `f64` DLT and Jacobi sweeps that is unchanged since it ran on an RTX 2080 on 2026-10-17. Its cause is not established; a test on that machine is pending (typecv PR #44). |

The two Apple records match the record of this repository: `src/core/fp64/flavor-select.ts` states that Metal's shader compiler reassociates the float error terms and collapses the `'float'` flavor to `f32` precision, proven on device in PR X-GIS #924 to #932, and `recommendFp64Flavor` answers `'integer'` for any Apple signal. A RANSAC whose scores lose their precision neither stops early nor finds the right model, which is what the two records show. This is an inference from the records and the library's own record. The implementation measures it (see Validation).

**The gap.** The library has the right flavor and the function that names it, but a host that imports `.shade.ts` modules cannot use either: the host face and the fuse record are emitted under `'float'` at build time, and no option of `typeshade({ ... })`, `createDevice({ ... })`, `configure({ ... })` or `fuse` reaches the lowering. The comment of `flavor-select.ts` says the consumer passes the result "as `EmitOptions.fp64Flavor`", which only `packModule` takes. typecv's kernels go through `fuse` and the call layer, as the fuse design intends (change 0058), and so cannot follow the recommendation.

**Options.** Each names what it touches. The owner decided option A on 2026-10-19.

- **Option A. Both lowerings in the face; the host picks at run time (decided).**
  - Touches: Rule 8.22 (the face carries both lowerings of a module that emulates `f64`), Rule 11.8 (the owner's flavor, `createDevice({ fp64Flavor })`, `configure({ fp64Flavor })` for the default owner, and the flavor a call runs), Rule 11.13 (the IR a plan fuses), surface §39, §64, §65 and §71, the exports `DeviceOptions`, `Device` and `configure` (reshaped) and `recommendFp64Flavor`, `isAppleGpu` and `Fp64FlavorSignals` (added to `typeshade/runtime`).
  - Trade-off: a module that emulates `f64` carries about twice the WGSL and IR in its face. typecv's built runtime (`dist/gpu`, 2.8 MB unminified, most of it the faces of modules that emulate `f64`) would grow by an estimated 1 to 2 MB before compression; the estimate is not measured. The `typeshade/fuse` and `typeshade/runtime` bundles gain a few lines (the choice and the three helpers) and no pass. One build serves every device.
- **Option B. A build-time option: `typeshade({ fuse: true, fp64Flavor })`.**
  - Touches: `TypeshadeViteOptions` and `HostFaceOptions` (an `fp64Flavor` field), surface §64. No rule changes, since the lowering is still fixed at build time.
  - Trade-off: the smallest change. One build serves one flavor. A host that serves Apple and other devices from one bundle must ship `'integer'` to every device or build twice and choose a bundle at load. The `'integer'` flavor's cost on devices that do not need it is not measured. The comment of `flavor-select.ts` records a compile-time device reset on ANGLE-D3D11 for the fully inlined integer bodies; whether D3D12 through DXC behaves the same is not known.
- **Option C. The fuse bundle lowers at plan time from pre-lowering IR.**
  - Touches: Rule 8.22 (the fuse record carries the module before the fp64 pass), Rule 11.13 (the planner runs `fp64Lower`), the `typeshade/fuse` bundle budget (`scripts/bundle-budget.json`: the pass and the `df64` libraries of both flavors join the closure), surface §71, and still Rule 11.8 for the plain kernel call, whose WGSL is text, so option C does not cover it without option A's second WGSL.
  - Trade-off: one IR per module, any flavor at run time. The fuse bundle grows by the fp64 pass and its libraries (not measured), the plan does the lowering work at every first use, and the plain call still needs option A's text. Largest change.

**Decision.** Option A. The owner chose it on 2026-10-19. It is the smallest change that lets one build follow `recommendFp64Flavor` on every device, it keeps the default lowering byte for byte, and it adds no pass to a shipped bundle. Options B and C are not taken.

## What it touches

- **Rule 8.22:** the face of a kernel function of a module that emulates `f64` carries its WGSL under both flavors, and under `typeshade({ fuse: true })` the portable IR of both.
- **Rule 11.8:** the owner's flavor (`createDevice({ fp64Flavor })`, `device.fp64Flavor`), `configure({ fp64Flavor })` for the default owner, the default, the refusal of an unknown word, and the sentence that a call runs the lowering of its owner's flavor.
- **Rule 11.13:** a plan fuses the IR of the configured flavor; the guard binding follows the flavor.
- **Surface §39:** the paragraph on the two flavors names the run-time choice and the recommendation helper.
- **Surface §64:** what the face of an `f64` module carries.
- **Surface §65:** `createDevice({ fp64Flavor })` and `device.fp64Flavor` beside the owner's other options, and `configure({ fp64Flavor })` beside `prefer` and `runtime`.
- **Surface §71:** the flavor of a fused entry and its guard.
- **Exports:** `DeviceOptions` (the option), `Device` (the property) and `configure` (a third option) are reshaped. `recommendFp64Flavor`, `isAppleGpu` and `Fp64FlavorSignals` are added to `./runtime` (they stay on `.`).
- **Codes:** none. The refusal of an unknown flavor word is a `TypeError` of the call layer, as `configure` refuses an unknown tier today.
- **Examples:** none.
- **Documents:** `CHANGELOG.md` gains an entry. `reqs/` follows the edits of the three rules and the four sections through `bun run reqs:sync` and `python scripts/doorstop-check.py -C`. The JSDoc of `createDevice` (`src/runtime/device.ts`), of `configure` (`src/core/resident.ts`) and of the fuse record change with them.

### Draft impact estimate

- **Technical work.** `hostFace` emits each kernel function's WGSL twice and lowers the fuse record twice when the module contains `f64` (`containsF64` in `src/core/passes/fp64-lower.ts` already answers that). The owner (`src/core/owner.ts`) and the default owner's state in `src/core/resident.ts` hold the flavor; `callKernel`, `callCompute` and the fuse entry builder read it from the owner of the call. The bind-group and pipeline caches key on the flavor, since the two WGSL texts are two pipelines. Both `typeshade/runtime` and `typeshade/fuse` re-export or import the helpers; `scripts/bundle-boundary.ts` measures them against the budgets.
- **Compatibility.** A host that never calls `configure({ fp64Flavor })` runs what it runs today. A face built by this version is read by this version only (the IR carries its version, as today). A module with no `f64` is unchanged in size.
- **Dependencies.** Change 0058 (fuse, implemented) and change 0071 (the device owner, implemented on the review baseline). The integer flavor and the recommendation (PR X-GIS #932 and #933, in this tree).
- **Validation work.** See Validation below. The measurement on an Apple device and on the NVIDIA device needs the owner's machines; the typecv lab and its collector are the instruments.
- **Downstream effort.** See "What it owes downstream".
- **Unestimated.** Effort, schedule, cost and the size growth are unknown or estimates, as marked. None is recorded as established.

### Questions decided

The owner approved the proposal as drafted on 2026-10-19, which takes the default answer of each question below.

- **Q1.** Option A, B or C? Decided: A.
- **Q2.** Under option A, does the face carry both lowerings always, or only under a build option (`typeshade({ fp64Flavors: ['float', 'integer'] })`) so that a host that serves one device class pays no size? Default if undecided: always, since a module with no `f64` pays nothing and the growth is confined to `f64` modules.
- **Q3.** Should the default stay `'float'`, or should `createDevice` call `recommendFp64Flavor` itself from the adapter it opens? Default if undecided: the default stays `'float'`, and the host decides, as the library's comment says the library cannot see a GPU; an owner that opens WebGPU has the adapter's `info` in hand, so a later amendment could make the recommendation the default once the integer flavor is measured on non-Apple devices.
- **Q4.** Does the plan report name the flavor it ran (`FuseReport.fp64Flavor`)? Default if undecided: no, to keep the report's shape; the host knows what it configured.

### Approval and plan record

- **Decision.** The owner approved the proposal in the project conversation on 2026-10-19 (Asia/Seoul), as drafted: option A, with the default answers of Q2 to Q4 (both lowerings always carried, the default flavor `'float'`, the report unchanged). The merge of PR #685 records the acceptance.
- **Approved revision.** This file at the commit that PR #685 merges. Git records that commit.
- **Scope.** Option A as "What changes" states it, with Q1 to Q4 as decided above. No decision is open.
- **Responsibilities and milestones.** The implementation is the next work of the session that drafted this proposal, on a branch of its own, with commits that carry `Change: 0073`. No schedule or estimate is established.
- **Required validation.** The validation list below. What ran, and what stood in for an item that could not run as written, is in the Configuration and validation record.

### Validation (required before the implementation merges)

- Both halves (CLAUDE.md "A test reads both halves"): the editor's view of a `.shade.ts` module does not change; a test asserts the face of an `f64` module and the language service's diagnostics on the same source.
- `src/compiler/ts/host-face.test.ts`: a module with `f64` carries both WGSL texts and, under `fuse: true`, both IRs; a module without carries one.
- `src/runtime/device.test.ts` and the call-layer tests: `createDevice({ fp64Flavor: 'integer' })` makes the owner's kernel calls bind no guard and run the integer `df64_*` helpers, and `device.fp64Flavor` reports it; `configure({ fp64Flavor: 'integer' })` does the same for the default owner; two owners in one context run different flavors; an unknown word is refused with the two words; the default is `'float'`.
- `src/fuse.test.ts`: a fused plan under each flavor gives the CPU oracle's bits within the tolerance the `df64` known-answer tests use (`src/core/fp64/df64-known-answer.test.ts`), on the CPU tier and on WebGPU (SwiftShader in CI).
- `bun run gate:compile`: the integer-flavor WGSL of the examples and of a fused entry compiles on Tint (Rule 13.3).
- `scripts/bundle-boundary.ts`: `typeshade/runtime` and `typeshade/fuse` stay inside their budgets, or the budgets move in the same pull request with the measured growth.
- Hardware (Rule 13.3): the typecv lab on the owner's iPhone, with its pin moved to the implementing version and `createDevice({ fp64Flavor: recommendFp64Flavor(...) })` in `ShadeDevice.open`, verifies the pyramid sample's pairs in a time of the same order as SwiftShader and registers its eight views; the failure records above are the baseline. The same lab on the NVIDIA Blackwell machine, under each flavor, records whether the triangulation completes.
- `bun run build`, `bun run test`, `bun run docs:refs`, `bun scripts/changes.ts`, `bun run docs:impact`, `bun run reqs:sync`, `python scripts/doorstop-check.py -C`.

**Acceptance (for the eventual implementation).** A host that opens `createDevice({ fp64Flavor: recommendFp64Flavor(signals) })` runs the integer lowering on an Apple GPU and the float lowering elsewhere from one build, and the typecv lab registers the pyramid sample's eight views on the owner's iPhone.

### Configuration and validation record

- **Accepted revision.** This file at the merge of PR #685, `0fd03c4`.
- **Implementing pull request.** [PR #687](https://github.com/typeshade/typeshade/pull/687),
  branch `claude/impl-0073-fp64-flavor-runtime`, from `main` at `0fd03c4`. Its commits carry
  `Change: 0073`: `41fc4f2` (the implementation, the rules, the surface, the changelog, the
  requirements tree, the API surface and `src/AGENTS.md`), `f47abfe` (the import journey's
  integer-flavor runs, and the editor's half in the host-entry test), the commit that makes the
  dev step of the import journey survive Vite's reload for a new dependency, and the commit that
  contains this record, which Git knows.
- **Delivered configuration.** `src/compiler/ts/host-face.ts` (the second WGSL of a module that
  emulates `f64`: `__ts_wgsl_integer`, `wgslInteger` on each entry and on `KernelFace.gpu`),
  `src/core/host-entry.ts` (`ComputeEntry.wgslInteger`, `flavored`), `src/core/host-kernel.ts`
  (`entriesOf` per flavor), `src/core/host-compute.ts` and `src/core/host-draw.ts` (the owner's
  flavor at the call), `src/core/fuse-entry.ts` (`fusedFor(members, contracted, flavor)`),
  `src/core/fuse-plan.ts`, `src/core/owner.ts` (`CallOwner.fp64Flavor()`), `src/core/resident.ts`
  (`configure({ fp64Flavor })`, `configuredFp64Flavor`, `checkFp64Flavor`, `FP64_FLAVORS`),
  `src/runtime/device.ts` (`DeviceOptions.fp64Flavor`, `Device.fp64Flavor`), `src/runtime.ts`
  (`recommendFp64Flavor`, `isAppleGpu`, `Fp64FlavorSignals`), `src/core/fp64/flavor-select.ts`
  (the JSDoc). Tools: bun 1.4.2, TypeScript 5.6.3 in the container; CI's matrix runs TypeScript
  5.9.3 and 6.0.3.
- **Functional validation, observed on 2026-10-19.** `src/runtime/device.test.ts` (28 tests): the
  default is `'float'`, `createDevice({ fp64Flavor: 'integer' })` reports it and refuses another
  word naming the two; two owners in one context dispatch each their own text, the float one
  with the `_fp64` guard declared and one guard texture made, the integer one with no `_fp64` in
  its text and no texture, for a call that runs alone and for a fused group of two; the default
  owner under `configure({ fp64Flavor })`, read at each call, restored by `configure({})`; the
  helpers on `typeshade/runtime` are the root's. `src/core/fuse-entry.test.ts` (98): the entry of
  the integer flavor is built apart from the float one, once per shape, with no guard on the loop
  entry or the fold entry, for a map chain and for a reduction. `src/compiler/ts/host-kernel.test.ts`
  (57): the face of an `f64` function carries `wgslInteger` with no guard and the integer helpers,
  and an `f32` function carries none. `src/compiler/ts/host-entry.test.ts` (24): the generated
  module carries `__ts_wgsl_integer` and names it on each entry, a module without `f64` carries
  one text, the language service gives no diagnostic on the same source and the host view does
  not change (both halves). `src/compiler/ts/host-draw.test.ts`, `src/fuse.test.ts`,
  `src/core/host-entry.test.ts`, `src/api-surface.test.ts`, `src/api-doc-coverage.test.ts`,
  `src/changes.test.ts` and `src/vite.test.ts` pass. `bun run gate:journeys` on `f47abfe` with
  the dev-step fix: 27 journeys, 59 runs, every check passed, and the import journey's
  `doubleIntegerYs` and `doubleIntegerPs` (the entry under `configure({ fp64Flavor: 'integer' })`,
  WebGPU required) match a double's reference within 7.4e-15, `doubleIntegerStats` (the kernel
  function's sum and min) and `doubleIntegerFused` (a chain of two kernel functions fused on
  `createDevice({ fp64Flavor: 'integer' })`, one dispatch, one group, fused) within 1.7e-15, on
  SwiftShader through Tint. CI on the pull request's head runs `typecheck + unit`, `compile gate
(Tint + WebGL2)`, `user journeys (packed tarball, WebGPU)`, `render gate`, `traceability
(Doorstop)` and `change scope`; the pull request records the result.
- **Bundle.** `bun scripts/bundle-boundary.ts`: `typeshade/runtime` 35,777 bytes minified and
  gzipped (budget 39,000), `typeshade/fuse` 81,292 (budget 86,000), `typeshade/emit` 95,053
  (budget 97,500). No budget moves.
- **Document validation, observed on 2026-10-19.** `bun run docs:impact` listed review items only,
  read and acted on (`src/AGENTS.md` rows for `runtime.ts`, `core/resident.ts` and
  `core/owner.ts`). `bun run docs:refs`: 0 dead references. `bun run reqs:sync`, then
  `python scripts/doorstop-check.py -C` clean after `doorstop review` of RULE-0822, RULE-1108 and
  RULE-1113 and `doorstop clear` of SURF-003, SURF-038, SURF-065, SURF-067, SURF-069 and
  SURF-071. `bun run bake:api-surface` lists the three exports added to `./runtime` and the
  reshaped `configure`, `Device` and `DeviceOptions`. `bun run lint` and `bun run format:check`
  pass.
- **Deviations.** Three.
  1. Item 2 of "What changes" says the fuse record carries the portable IR of both flavors
     (`irInteger`). The record's IR is the module before the fp64 pass, so one IR serves both
     flavors and the planner lowers it under the owner's flavor when it emits the entry. No
     `irInteger` exists. Disposition: closed, narrower than declared; Rules 8.22 and 11.13 state
     the delivered design.
  2. The validation item for `src/fuse.test.ts` asks for the CPU oracle's bits under each flavor.
     The oracle runs the module before the fp64 pass, so it cannot tell the flavors apart. The
     numbers of each flavor are held on WebGPU, where the flavors differ, by the import journey
     above. Disposition: closed, by substitution.
  3. The validation item for `bun run gate:compile` asks for the integer text of the examples and
     of a fused entry on Tint. The examples' integer text under `packModule` was already held by
     `journeys/emit-options`; the host face's integer text and a fused entry's are compiled by
     Tint in the import journey above. The compile gate itself is unchanged. Disposition: closed,
     by substitution.
- **Pending.** The hardware validation (Rule 13.3) on the owner's iPhone and on the NVIDIA
  Blackwell machine, which needs typecv's pin moved to the implementing version and
  `createDevice({ fp64Flavor: recommendFp64Flavor(...) })` in its `ShadeDevice.open`. The
  downstream work of `typeshade.github.io` and `vscode-typeshade` (What it owes downstream), each
  until its pin moves. The size growth of a built `f64` module is measured on typecv when its pin
  moves.

## What it owes downstream

For each repository in `downstream`:

- **typeshade.github.io.** The API entry for `configure` and the three re-exported helpers are generated from the JSDoc; the Korean entry for `configure` is translated again. The guide page on the emulated double names the run-time choice. Not read in this draft; the implementation reads the site at its pinned commit and records what it found before acceptance is recorded. Record 0073 in `compiler-changes.md` when the pin moves.
- **vscode-typeshade.** The host references that describe `configure` and the skill's `f64` passage. Not read in this draft; the implementation reads the plugin at its pinned commit and records what it found. Record 0073 in `compiler-changes.md` when the pin moves.

Two consumers are not in `DOWNSTREAM_REPOS` (`scripts/changes.ts`):

- **typecv.** The reason for this proposal. After the pin moves, `ShadeDevice.open` (`src/gpu/device.ts`) opens the owner of change 0071 (its own obligation from that change) with the flavor `recommendFp64Flavor` names from the adapter's `info` and the user agent; the lab gains a query switch to force a flavor for a measurement. The failure records above are its baseline.
- **radiance** and **TypeNN.** Not checked in this draft. Neither is known to emulate `f64`. The implementation searches both before the pin moves.

Each downstream item is pending. No downstream change exists.

## Open items

- The Blackwell device loss (the third record) is not explained by this proposal. The pending test on that machine (typecv PR #44) decides whether the integer flavor removes it. If it does not, that failure needs its own cause.
- The size growth of option A and the speed of the integer flavor on devices that do not need it are estimates, not measurements.
