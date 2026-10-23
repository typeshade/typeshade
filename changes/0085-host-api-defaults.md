---
id: '0085'
title: Host calls use their device without registration or optimization setup
status: accepted
rules:
  - '8.22'
  - '8.23'
  - '11.8'
  - '11.9'
  - '11.10'
  - '11.11'
  - '11.13'
surface:
  - 38
  - 39
  - 64
  - 65
  - 66
  - 67
  - 69
  - 71
exports:
  - createDevice
  - Device
  - DeviceOptions
  - Resident
  - configure
  - TypeshadeViteOptions
  - HostFaceOptions
  - Pack
  - PackOptions
  - Runtime
  - RuntimeOptions
  - LoadOptions
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: Update English and Korean setup, device ownership, fusion, fp64 selection and console guidance. Translate changed API JSDoc. Retain benchmark cohort provenance and record the validated pin.
  - repo: vscode-typeshade
    what: Update the runtime and project-setup references. Verify generated host views and a clean project without a registration import. Record the implementation pin.
  - repo: typecv
    what: Adopt automatic device selection and ordinary owned-array calls where applicable. Remove registration-only imports. Validate explicit fp64 overrides, device ownership, execution reports and shipping chunks. Record the implementation pin.
  - repo: typenn
    what: Validate independent devices, ordinary calls and fused graph execution without registration. Verify packaging of planner chunks and record the implementation pin.
  - repo: radiance
    what: Update host setup and device guidance where applicable. Validate supplied devices, program loading, console variants and deployment of package chunks. Record the implementation pin.
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0085. Front-matter status is `accepted`. Compiler implementation is in progress. Automatic fp64 selection and owner inference are merged; automatic fusion loading and instance capabilities are in progress. |
| Date and attribution          | Authored by a Codex agent on 2026-10-23 UTC. This is the authorship date.                                                                                                                                              |
| Request source                | The owner requested a review of hidden initialization and setup costs, then said to proceed with the eight reported improvements.                                                                                      |
| Applicability / effectivity   | Host calls, device owners, generated host modules, Vite/CLI setup and program-runtime console loading. No release version is assigned.                                                                                 |
| Review baseline               | `main` at `d36ac5027356b96e87a9ad900dfd8e6ea4ab55dc`. The initial audit used `73a497d8`; the relevant executable source is unchanged between these revisions.                                                          |
| Review and revision authority | [PR #745](https://github.com/typeshade/typeshade/pull/745) retains the proposal review and acceptance decision. Initial proposal commit: `2fe242e25abf9f391a3facb3f7c700ca62b2bba8`. Git records later revisions.      |

## What changes

This proposal removes eight related setup costs from the normal host path.
Device ownership and execution order remain explicit in the implementation.
Applications do not register a planner or select its build metadata to use a public method.
Advanced overrides remain available.

### Device calls and automatic fusion support

The following usage combines ordinary owner inference with automatic fusion support:

```ts
import { createDevice } from 'typeshade/runtime';
import { twice } from './ops.shade.ts';

const device = await createDevice();
const values = device.array(new Float32Array([1, 2]));
await twice(values);
await device.fuse(() => {
  twice(values);
  twice(values);
});
const result = await values.read();
await device.dispose();
```

Neither call requires `import 'typeshade/fuse'`.
A normal call selects the unique owner of its owned arrays or textures.
A call with no owned resource retains the default owner.
Mixing distinct owners, including an explicitly default-owned resource, remains a refusal before execution.
Calls with plain host values retain their validation, copy-back and fallback behavior.
The same owner-selection rule applies to kernel calls, compute-entry calls and draw calls.
It does not create a process-global current device.

The selected owner's queue determines ordering, lifetime checks, tier policy and resolved fp64 flavor.
Inference does not make a disposed resource usable or transfer ownership.
Calls on independent devices remain independent.

`device.fuse()` always has its recorder available.
Its body still runs synchronously exactly once at the call site.
Recording reserves the plan's queue position before returning.
An asynchronous internal loader may then obtain the planner and executor.
Later calls and reads cannot pass that reservation.
Nested scopes, synchronous body errors and the existing refusal of asynchronous bodies retain their semantics.
Loading failures reject the queued plan and reach its written residents as existing execution failures do.
The implementation must not move body execution behind an `await`.

The heavy executor uses a cached import of a package-owned, static module path.
Bundlers may emit it as a local chunk or inline it in a single bundle.
Applications configure no loader and supply no URL.
`typeshade/fuse` remains supported for existing named imports and registration-only imports.
Neither form is required to make a device method work.

### Compiler facts and private input layouts

The Vite plugin and `hostFace()` produce fusion facts by default for eligible kernels.
Existing `fuse: true` remains accepted. `fuse: false` becomes an optional size override.
A false override still permits ordered scopes and reports why eligible calls ran apart.
Safety facts continue to decide whether calls can actually fuse.
This proposal does not promise that every chain becomes one dispatch.

Producing fusion facts does not disable ordinary-call input projection.
An eligible ordinary WebGPU call may use the private layout of proposal 0082 even when its module carries those facts.
Resident and fused calls retain the full layout.
The planner reads the full-layout facts and bindings; an ordinary projected call reads its private bindings.
Logical validation, property-read order and all fallback cases remain unchanged.
This is a separation of metadata availability from actual execution mode.
It does not approve universal SoA or complete proposal 0082's physical-device validation.

### Automatic fp64 selection

`DeviceOptions.fp64Flavor` accepts `'auto'`, `'float'` and `'integer'`.
Omission means `'auto'`.
`Device.fp64Flavor` remains the resolved `'float'` or `'integer'`, not an unresolved setting.
The default call owner uses the same automatic policy.
`configure({ fp64Flavor })` retains explicit overrides and also accepts `'auto'`.

Automatic selection uses the actual device, its retained creation adapter or the actual WebGL context.
It may use the existing user-agent fallback.
It never requests another adapter and attributes that adapter's identity to the supplied device.
CPU selects `'float'`. Unknown GPU signals retain the existing selector's `'float'` fallback.
An Apple or Metal signal selects `'integer'`, as `recommendFp64Flavor()` already specifies.
This fallback is not proof that unidentified hardware preserves extended precision.
Explicit overrides remain available for controlled reproduction and compatibility.

Generated modules already carry both WebGPU flavors when they emulate `f64`.
Low-level `emitModule()` and fixed shader text remain explicit escape hatches.
This proposal does not infer a device while compiling a source file.

### Instance options and invalid combinations

`createDevice()` gains instance-local `limits` and `features` options.
A device it requests negotiates them during creation.
A supplied device or runtime is checked against its enabled capabilities.
These options never mutate another owner or request unsupported features silently.
Tier fallback remains governed by that owner's policy.

`configure()` remains a compatibility API for the default owner.
Existing late changes to immutable native capabilities remain refused.
New application guidance uses constructor options, so setup does not depend on another library's first call.
`configure({})` keeps its documented reset behavior; it does not reset unrelated device owners.

`DeviceOptions` becomes a common-options intersection with a union of its device-source choices.
`prefer`, `device` and `runtime` remain mutually exclusive.
Impossible combinations fail TypeScript checking as well as runtime validation.
Valid existing option values remain accepted.
Changing an interface into a union can affect downstream interfaces that extend it.
The implementation must document composition through intersections for those declarations.
It must not claim this type-only migration is invisible to all consumers.

### One project-setup command

Add `tshc init` for the normal Vite and TypeScript host project.
It creates or merges the host-view resolution settings, shader-project configuration and synchronization hooks.
It prints the files it changes.
It preserves unrelated settings, scripts and JSONC comments, and does not overwrite a conflicting configuration silently.
A repeated invocation makes no change.
No configuration file is written merely by importing the runtime or loading a plugin.

The resulting install and type-check/build scripts synchronize generated host views in the required order.
A clean checkout needs no manually remembered `tshc sync` step.
Existing `tshc sync` and manual setup remain supported.
Shader validation uses TypeShade's shared compiler/language-service diagnostics.
The command must not claim that ordinary `tsc` accepts shader decorators it currently refuses.
The existing shader file naming rule remains unchanged.
Other bundlers are outside this initial initializer's scope.

### Console availability without emitter setup

Normal builds retain a recorded console variant only for programs whose reachable entries use console calls.
The production default still does not record or print those calls.
`rt.load(manifest, { console: true })` selects the retained variant without an emitter import or an IR option.
Development and explicitly recorded builds retain their existing enabled behavior.

The proposed additive schema-2 representation is `Pack.variants.console`.
It uses the recorded shape already held by `Pack.console`.
`Pack.console` retains its legacy enabled-by-default meaning.
An old reader therefore ignores the new optional field and continues to use the ordinary shader.
A new reader accepts both forms and does not activate the optional variant by its presence alone.
A load-only probe against the real baseline reader accepted this optional field and kept `recording` false. Explicit enabling on that old reader still refused the missing legacy variant. New-reader execution and actual GPU logging remain implementation tests before retaining schema 2.

`PackOptions.console: 'never'` and the existing Vite `console: 'never'` omit retained variants explicitly.
Boolean pack options keep their enabled/disabled meaning.
A stripped or historical manifest with neither a variant nor IR still gives a capability-specific refusal.
Existing explicit `repack` and portable IR remain advanced, supported paths.
No IR is added to every manifest and no production logging is enabled implicitly.

## Why

The owner compared the current setup with React and Vue.
The requested property is that importing a public API is sufficient to use it.
The initial audit found the following costs.

| Audit item | Baseline evidence                                                                        | Proposed result                                                               |
| ---------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1          | `Device.fuse()` exists but refuses an unloaded `fuseSlot.open`.                          | The recorder and automatic executor loader are part of the method's contract. |
| 2          | A bare call uses `defaultOwner` and refuses a device's resident.                         | Select the unique owner without requiring an optimization scope.              |
| 3          | Fusion facts require `fuse: true`; that flag also suppresses ordinary input projection.  | Default facts and execution-specific layout selection.                        |
| 4          | The device defaults to `'float'` although the selector recommends `'integer'` for Apple. | Resolve the default from actual device signals.                               |
| 5          | Global capabilities must be configured before another call creates the native device.    | Put custom requirements on the independently created owner.                   |
| 6          | Host view settings, synchronization and shader project configuration are separate steps. | One explicit initializer maintains those settings and hooks.                  |
| 7          | A missing recorded console variant requires an emitter plus retained IR.                 | Retain the requested debug capability without enabling production logging.    |
| 8          | A `DeviceOptions` value can type-check with mutually exclusive device sources.           | Reject that value during type checking.                                       |

Relevant implementation locations are `src/runtime/device.ts`, `src/core/host-kernel.ts`,
`src/core/owner.ts`, `src/compiler/ts/host-face.ts`, `src/core/resident.ts`,
`src/runtime/runtime.ts`, `src/core/manifest.ts`, `src/core/manifest-types.ts` and `src/vite.ts`.
The existing setup is described in `README.md` and surface sections 64 and 69.

### Observed baseline evidence

A Codex agent reran CPU call and compiler probes on the review baseline on 2026-10-23 UTC.
Tools were Bun 1.4.3 and TypeScript 5.6.3.
These observations describe existing behavior, not this proposal's implementation.

- `createDevice({ prefer: ['cpu'] }).fuse(...)` rejected without the registration import.
- A generated `twice(array<f32>)` call rejected that device's resident outside a scope.
- The same call inside a registered scope returned `[2, 4]` for input `[1, 2]`.
- A normal call over a plain host array returned `[6, 8]` for `[3, 4]`.
- The device's default flavor was `'float'`; an Apple vendor signal recommended `'integer'`.
- `createDevice({ device: {}, prefer: ['cpu'] })` rejected the conflicting options.

The initial audit also found zero TypeScript diagnostics for that conflicting option value.
For a two-field input that reads one field, default compilation produced projection without fusion facts.
`fuse: true` produced facts without projection.
The repeated compiler/type-check probe on the review baseline gave zero diagnostics for the conflicting option value. It also reproduced projection without fusion facts and fusion facts without projection.
Apple hardware was not rerun; its precision behavior is supported by the existing selector documentation and determinism records.

### Bundle experiment and alternatives

A source-entry experiment used Bun's browser ESM bundler with minification and gzip level 9.
The unchanged runtime measured 44,765 gzip bytes.
An external entry that imported `src/fuse.ts` and re-exported `src/runtime.ts` measured 125,037 gzip bytes.
The increase was 80,272 bytes, before implementing any proposed behavior.
These are whole-entry measurements on the review baseline, not unused-code measurements in a consumer app.

The proposed design keeps a synchronous recorder in the runtime and loads its heavy executor automatically.
A static eager link remains a measured alternative, with the cost above.
Automatically inserting a registration import from the Vite plugin alone does not cover other host entry paths.
A second device factory would require users to choose which methods are usable.
The proposed device contract avoids both choices on the normal path.

Code splitting adds first-use latency and a deployable asset.
A single-file build includes the executor in the same file.
An offline application must ship or cache every generated chunk, as it does for other application chunks.
No claim is made that this design removes the executor's bytes or guarantees faster calls.

## What it touches

- Rule 8.22 updates the existing compiler-facts default and its verification description.
- Rule 8.23 clarifies that fusion metadata does not select a call's physical input layout.
- Rule 11.8 covers inferred owners, default fp64 selection and instance capability options.
- Rules 11.9 and 11.10 distinguish an available console variant from enabled recording.
- Rule 11.11 permits only package-owned executor loading and retains the compiler/dependency boundary.
- Rule 11.13 removes registration as a precondition while preserving recording and queue semantics.
- Surfaces 38 and 39 retain the determinism and fp64 correctness limits; sections 64 to 67, 69 and 71 explain the changed host paths.
- The declared exports cover device options, host compilation defaults and console-capable manifests.
- The CLI adds the initializer and its setup records. No new shader spelling or diagnostic code is proposed.
- Existing examples and journeys change usage where necessary. No new registered example is proposed.

### Dependency and CSP boundary

The runtime and loaded executor must import no `src/compiler/` file, TypeScript or external runtime package.
Neither may use `eval` or `Function` to construct JavaScript.
The current blanket dynamic-import scan changes only for the fixed, package-owned executor path.
Computed imports, user URLs, remote code and imports outside the packaged closure remain refused by the gate.
Its planted-fault instrument must prove each refusal.
The gate checks every emitted chunk, not just the small entry file.
It records entry, executor, shared and aggregate bytes separately, avoiding duplicated-count errors.
Single-file and split builds are tested under an enforced CSP with no `unsafe-eval`.
The split fixture serves its complete asset graph under `script-src 'self'`.
The single-file fixture verifies that no secondary fetch is required.

### Draft impact estimate

Work includes separating recording from execution, owner selection across host calls, automatic flavor selection,
constructor options and types, default compilation facts, initializer integration and optional console variants.
No new runtime dependency is proposed.
Duration and cost are unestimated.
Recorder and executor sizes are measured in `CHANGELOG.md`. The packed journey records first-use sequence wall time,
including loading, pipeline creation, queued calls and readback. It does not isolate network latency or predict production performance.

Valid existing imports and explicit overrides remain supported.
Compiled metadata and retained console variants increase some build artifacts.
The `DeviceOptions` type migration and schema-2 old-reader compatibility require explicit migration tests.
Any budget change records old, measured and new bytes in `CHANGELOG.md` after measurement.
The eager-link experiment is not a new bundle allowance.

### Required validation

Functional validation must cover all eight audit items:

1. Run device scopes without the legacy import in fresh browser and worker contexts.
2. Prove synchronous body execution, queue reservation, nested scopes, rejected bodies and loader failure propagation.
3. Run ordinary owned-array and owned-texture calls on independent devices; refuse mixed owners before a write.
4. Match default and explicit fp64 selections with actual-device, retained-adapter, redacted and CPU cases.
5. Reproduce fp64 cancellation on real Apple/Metal hardware before closing that validation item.
6. Verify independent instance capabilities, supplied-device ownership and legacy configuration behavior.
7. Check valid and invalid option combinations with TypeScript 5.6, current 5.x and 6.x.
8. Run eligible ordinary projection and fused full-layout calls from the same default-built module against independent references.
9. Initialize a clean frontend project, repeat initialization and test conflicting JSONC without losing unrelated configuration.
10. Build and type-check that project without a manual synchronization step.
11. Load default and legacy manifests with console on and off; verify that production stays quiet by default.
12. Run an old reader against the optional console-variant field and preserve its existing default.
13. Verify single-file and split production packages, CSP, missing chunks and offline asset completeness.
14. Run build, lint, format, affected unit suites, the compile/differential/journey gates and the boundary instrument.

Document validation reads every changed rule, surface section, API comment and setup example.
It includes `docs:impact`, `docs:refs`, `reqs:sync`, Doorstop, proposal-scope and IfChange checks.
Tests of an authored shader still read the compiler and language-service halves from the same source.
Physical-device observations retain the exact compiler, artifacts, workload and instrumentation revisions.
The new defaults require a new benchmark cohort; existing records are not relabeled.

### Approval and plan record

The owner approved PR #745 in the conversation on 2026-10-23 UTC.
The approval was received at 01:35 UTC against proposal revision
`46db8ec8deb75b9f903bde892cf1f5071b4c33e0`.
It covers the eight changes, impact declarations, compatibility decisions and required validation in this proposal.
This includes the static package-owned loader and CSP exception, separate entry/chunk/aggregate bundle accounting,
the additive schema-2 console variant and the explicit `DeviceOptions` type migration.
The proposal must be merged as accepted before implementation begins, as `changes/README.md` requires.

The approved implementation order is automatic fp64 selection and valid options, device ownership and recorder loading,
default compiler facts with projection, project initialization, then console capability delivery.
Each implementation PR records its exact scope and completed evidence.
The Codex agent is responsible for compiler implementation and its recorded validation.
Implementation milestones have no assigned dates. Downstream delivery responsibilities remain unassigned.
No agent is assigned completion credit for tests or downstream work that have not run.

Acceptance does not establish implementation correctness or physical-device performance.
The Apple/Metal precision check and all implementation validation above remain required.

On 2026-10-23 UTC, the Codex agent corrected the surface impact declaration before implementation delivery.
The emulated-double default is documented in section 39, while section 38 describes the determinism report.
The original declaration named section 38 only. Section 39 is added for the already approved automatic fp64 policy.
This correction changes no behavior, compatibility decision or implementation milestone.

On 2026-10-23 UTC, the Codex agent corrected another impact declaration before delivering default compiler facts.
Rule 8.22 already describes those facts and their verification. The front matter now includes that rule.
This records the already approved default-facts work; it changes no approved behavior or delivery milestone.

### Configuration and validation record

Proposal-only PR #745 was merged as `0ee3ffa82d367e29adbf70f4888e367ae4c5b530`.
It delivered the accepted design, with no host implementation.
The baseline probes and bundle experiment establish the problem and a measured alternative.
They are not tests of a new API implementation.
The PR records documentation checks and proposal-shape validation separately from those observations.

A Codex agent ran these checks on 2026-10-23 UTC at initial proposal commit
`2fe242e25abf9f391a3facb3f7c700ca62b2bba8`, with executable source from the review baseline.
The later documentation revision adds the PR reference and observed evidence only.

| Command or check                                                            | Observed proposal-review result                                                                                    |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `bun run docs:impact`, `bun run docs:refs`                                  | No impact item and zero dead references across 1,271 files.                                                        |
| `bun run reqs:sync`, `python scripts/doorstop-check.py -C`                  | Passed with no tracked requirement change or manual review stamp.                                                  |
| `bun run build`, `bun run lint`, `bun run format:check`                     | Passed.                                                                                                            |
| Document-reading Vitest selection from `bun scripts/doc-tests.ts --summary` | 94 files passed; 4,131 tests passed and 4 skipped.                                                                 |
| `TYPESHADE_CHROMIUM=/usr/bin/chromium bun run gate:compile`                 | 184 WGSL examples, 127 GLSL programs, 122 render pipelines and all entry-call checks passed.                       |
| `TYPESHADE_CHROMIUM=/usr/bin/chromium bun run gate:differential`            | All five arms passed, including the corrupted-input instrument.                                                    |
| `bun run gate:boundary`                                                     | Five closures and CSP instruments passed. Retained-export runtime: 44,873 gzip bytes against a 44,900-byte budget. |
| `bun scripts/ifchange.ts`, `bun scripts/changes.ts --base origin/main`      | Passed for a proposal-only diff.                                                                                   |

The boundary fixture retains all exports through a namespace assignment.
Its bytes differ from the whole-source-entry experiment above; neither measurement changes a budget.
The old-reader console probe used actual baseline code and a structural device for loading only.
It did not dispatch a shader or establish new-runtime behavior.
Temporary probe import and root-directory settings were corrected before the successful results.

The full unit suite and `gate:journeys` were not repeated locally for proposal-only PR #745.
Its current-head CI status is retained by that PR separately.

### First compiler implementation stage

The first stage implements automatic fp64 selection and mutually exclusive device-source option types.
It starts from accepted proposal commit `0ee3ffa8`, with the section-39 impact correction in PR #746.
Branch `agent/0085-auto-fp64` retains the implementation, delivered by
[PR #747](https://github.com/typeshade/typeshade/pull/747) after #746 merged.
Its source commit is `1b84fd32484bd8e9a5ea719fb96476aba1b58435`; the merge is `c06aa5adaf1b94f3e854e699deefe0acaa118454`.
No release or downstream pin is assigned.

The default owner passes the executing GPU into flavor selection for kernel calls, entry calls, draws and fused groups.
A device resolves its own policy when it opens. Recommendations are cached per native device.
The existing identity snapshot remains unchanged, including redaction and provenance.
The automatic policy may use the retained creation adapter when the device's optional strings are absent.
Neither path requests another adapter. Explicit overrides remain supported.

A Codex agent ran these checks on 2026-10-23 UTC with Bun 1.4.3, TypeScript 5.6.3,
Chromium 154.0.8037.57 on SwiftShader, and Doorstop 3.2:

- `bun run build`, `bun run lint`, `bun run format:check`: passed.
- `bun run test`: 473 files passed; 10,860 tests passed, four skipped and one TODO.
- TypeScript 5.9.3 and 6.0.3: `tsc --project tsconfig.tests.json --incremental false` passed in isolated compiler installations.
- `bun run gate:compile`: 184 WGSL examples, 127 GLSL programs, 122 render pipelines and all entry-call checks passed.
- `bun run gate:differential`: all five arms and planted-fault instruments passed.
- `bun run gate:journeys`: 31 journeys and 118 runs passed, followed by the packed host-import and host-example checks.
- `bun run gate:boundary`: all five closures and CSP instruments passed after the measured budget changes recorded in `CHANGELOG.md`.
- `bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync` and `python scripts/doorstop-check.py -C -e -F`: passed.
  The agent read Rule 11.8 and its dependent surface items before reviewing or clearing each item individually.

The import journey executes an `f64` entry with automatic selection and each explicit flavor against the same reference.
Unit tests verify actual-device and retained-adapter signals, redaction, WebGL renderer strings,
CPU behavior, explicit overrides, caching, default-owner dispatch and source-option refusals.
These results do not establish Apple/Metal hardware precision; that required physical check remains open.
The complete TypeScript-version CI suites remain separate evidence.

Remaining compiler work is instance capability negotiation,
default fusion facts with ordinary projection, project initialization and optional console capability delivery.
Proposal 0085 remains `accepted` until those stages and their required validation are complete.

### Ordinary owner inference implementation

The next implementation uses `main` at `c06aa5adaf1b94f3e854e699deefe0acaa118454` as its baseline.
That revision merged [PR #747](https://github.com/typeshade/typeshade/pull/747), whose source commit is
`1b84fd32484bd8e9a5ea719fb96476aba1b58435`. All eight current-head CI checks passed before that merge.
The first stage delivered automatic fp64 selection and device-source option types.

The owner-inference stage selects a unique owner for ordinary kernel, compute-entry and draw calls.
An indirect workgroup count participates, and plain values select no owner.
Mixed owners are refused before execution. Queued calls retain their selected owner and recheck changed bindings.
Calls captured before disposal complete; new calls after disposal starts are refused.
A WebGPU canvas rebuilds device-specific drawing resources when its owner changes, while retaining its drawing tier.
Branch `agent/0085-owner-inference` retains this stage; Git identifies its implementation commits.
[PR #749](https://github.com/typeshade/typeshade/pull/749) delivered source commit `8bc2cff7d56fc5188547603fab1c50ba68206705`.
It merged as `05915c3bd80965467c269473faf9cc1839c51e9b` after all eight current-head CI checks passed
on 2026-10-23 UTC (run 39903060979).

A Codex agent ran the following checks on 2026-10-23 UTC with Bun 1.4.3, TypeScript 5.6.3,
Chromium 154.0.8037.57 on SwiftShader, and Doorstop 3.2:

- `bun run build`, `bun run lint`, `bun run format:check`: passed.
- `bun run test`: 473 files passed; 10,869 tests passed, four skipped and one TODO.
- The focused runtime, texture, draw and fuse suites: 273 tests passed.
- `bun run gate:compile`: 184 WGSL examples, 127 GLSL programs, 122 render pipelines and all entry-call checks passed.
- `bun run gate:differential`: all five arms and planted-fault instruments passed.
- `bun run gate:journeys`: 31 journeys and 118 runs passed, followed by all packed host-import and host-example checks.
- `bun run gate:boundary`: all five closures and CSP instruments passed with the measured budgets recorded in `CHANGELOG.md`.
- `bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync`, `python scripts/doorstop-check.py -C -e -F`,
  `bun scripts/ifchange.ts` and `PR_BODY='Change: 0085' bun scripts/changes.ts --staged`: passed.
  The agent read Rule 11.8 and each dependent surface item before reviewing or clearing it individually.

The browser journey executes ordinary owned-array and owned-texture calls, including an indirect dispatch,
and alternates two native WebGPU devices on one canvas. Each result matches its independent reference.
Unit tests cover mixed owners, the explicit default owner, host copy-back, changed queued bindings,
destroyed handles and disposal ordering. The added fragment fixture is read by both compiler and language service.
The existing entry-specific diagnostic for a destroyed indirect count remains intact.
These software-adapter checks establish behavior, not physical-device speed or Apple/Metal precision.

### Automatic fusion loading implementation

This stage uses `main` at `05915c3bd80965467c269473faf9cc1839c51e9b` as its baseline.
Branch `agent/0085-auto-fuse` retains its implementation; Git identifies its commits.
[PR #751](https://github.com/typeshade/typeshade/pull/751) retains this stage.
Its first implementation commit is `bb3d0c6f38ad4e6d26455df2128d058a01701757`.
CI run 39908553529 failed Prettier on the independently merged proposal 0086, before the unit step ran.
Formatting-only [PR #753](https://github.com/typeshade/typeshade/pull/753) repaired that table as
`17cd4611414055f1e39e6b52b4d4b516bb39891c`, merged as `66c4a67d0e6efc920335b81f396564423b83c664`.
This branch incorporates that main revision to refresh the merge checkout. Git records the refresh commit.
CI run 39911259869 passed all eight jobs at refresh commit `47bef31a9506c06d8aa51a8b6ee274778df77a05`.
Main then advanced to `72b2f99f` with proposal 0086 implementation. This branch preserves both CHANGELOG entries
while incorporating that revision. Git and PR #751 retain the next refresh and its validation.
The refreshed merge checkout passed build, lint, format, 476 unit files and 10,909 tests on 2026-10-23 UTC.
Compile, all five differential arms, 32 journeys with 119 runs, automatic-fusion checks and all bundle boundaries passed.
The documentation, reference, traceability, IfChange and exact-base change-scope checks also passed.
CI run 39914259681 passed all eight jobs at `ebe15ab317f94f84c2c96ad787f1f8e5fda78bab`.
PR #751 merged as `eb5c3378cd4ffb8f74a9aede8f70cb3bde5155b5` on 2026-10-23 UTC.

`core/fuse-record.ts` records the body and reserves the queue before importing `core/fuse-plan.ts`.
The import uses one fixed package-owned path and caches its promise.
The executor retains validation, grouping, emission and failure handling.
An import failure rejects every recorded call, marks written residents and releases scratch arrays.
The public `FuseScope` declaration retains its existing source path and shape.
Device methods need no registration import; legacy named and registration-only imports remain supported.
The CSP gate checks every emitted asset and permits only literal imports of included local JavaScript files.
Split and single-file build sizes are measured independently in `CHANGELOG.md`.

The complete packed-artifact journey passed on 2026-10-23 UTC, including GPU/CPU calls in a fresh page and GPU calls in a fresh worker.
They require strict CSP, synchronous nested recording, queue ordering and the independent result `[9, -9, 21]`.
A planted missing executor rejects instead of running successfully.
A Codex agent ran the following checks on 2026-10-23 UTC with Bun 1.4.3, TypeScript 5.6.3,
Chromium 154.0.8037.57 on SwiftShader, and Doorstop 3.2:

- `bun run build`, `bun run lint` and `bun run format:check`: passed.
- `bun run test`: 475 files passed; 10,885 tests passed, four skipped and one TODO.
- The focused fuse, device, loading-failure and split-boundary suites: 261 tests passed.
- Public API surface and JSDoc coverage: 24 tests passed without changing the API snapshot.
- `bun run gate:compile`: 184 WGSL examples, 127 GLSL programs, 122 render pipelines and all entry-call checks passed.
- `bun run gate:differential`: all five arms and planted-fault instruments passed.
- `bun run gate:journeys`: 31 journeys and 118 runs, all packed host checks, and 11 automatic-fusion checks passed.
- `bun run gate:boundary`: all five source closures, single-file builds and every split asset passed the compiler, dependency and CSP checks.
- `bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync`, `python scripts/doorstop-check.py -C -e -F`
  and `bun scripts/ifchange.ts`: passed. No must-fix documentation impact remained.
  The agent read Rules 11.11 and 11.13 before reviewing them individually.
  It read surface sections 38, 69 and 71 before clearing their suspect links individually.

The offline page and worker execute from the retained artifact map with browser networking disabled and zero HTTP requests.
CSP canaries refuse inline scripts and `Function`; a missing executor rejects.
The final journey observed first-use sequence times of 140.9 ms for browser GPU and 73.4 ms for worker GPU.
The browser CPU sequence took 1 ms after the GPU sequence had cached the executor.
Offline observations were 160.7 ms, 105.4 ms and 1 ms respectively.
These wall times include loading, pipeline creation, queued calls and readback on a software adapter.
They neither isolate network latency nor predict production or physical-device performance.
Current-head CI and the implementation PR remain separate evidence. No downstream pin or release is assigned.

Proposal 0082 remains accepted pending controlled physical-device whole-call evidence.
Proposal 0081 deviation D1 remains open.
This proposal does not change entry binding layouts, raw byte representations or the key-id contract.

### Instance capability implementation

This stage starts from main `66c4a67d0e6efc920335b81f396564423b83c664` and integrates the automatic-loading
branch at `47bef31a9506c06d8aa51a8b6ee274778df77a05` (PR #751).
Branch `agent/0085-device-capabilities` retains this stage. Git identifies its implementation commits.
[PR #754](https://github.com/typeshade/typeshade/pull/754) retains this stage at source commit `28457e2dabd5408e303f229dcd6e865a0e8d9b07`.
CI run 39912070385 passed all eight jobs on that commit on 2026-10-23 UTC.
This branch incorporates automatic-loading refresh `ebe15ab3` and main `72b2f99f`, preserving both CHANGELOG entries.
Git and PR #754 retain the refresh commit and its current-head CI.

`DeviceOptions.limits` and `DeviceOptions.features` are instance-local WebGPU requirements.
An owner snapshots them before awaiting an adapter. Omission gives empty requirements, independent of `configure()`.
Requested devices negotiate capabilities; unsupported requirements or request failures follow only the owner's remaining tiers.
A supplied device or runtime is checked against enabled features and actual limits without requesting an adapter.
Minimum limits use the inverse comparison. A refusal never destroys the supplied device.
Legacy default-owner negotiation and late-change refusals remain in place.
The public API snapshot records the additive options. No shader syntax or binding layout changes.

A Codex agent performed validation on 2026-10-23 UTC with Bun 1.4.3 and 1.4.4, TypeScript 5.6.3,
Chromium 154.0.8037.57 on SwiftShader, and Doorstop 3.2.

- `bun run build`, `bun run lint` and `bun run format:check`: passed.
- `bun run test`: 476 files and 10,898 tests passed, with four skipped and one TODO.
- Focused capability, device, report, host-entry, API and type-option suites: 105 tests passed.
- `tsc --project tsconfig.tests.json --incremental false` with isolated TypeScript 5.9.3 and 6.0.3 installations: passed.
- `bun run gate:compile`: 184 WGSL examples, 127 GLSL programs, 122 pipelines and entry-call checks passed.
- `bun run gate:differential`: all five arms and planted-fault checks passed.
- `bun run gate:journeys`: 31 journeys, 118 runs, all packed host checks and 11 automatic-fusion checks passed.
- `bun run gate:boundary`: five source closures, single-file builds and every split asset passed.
- `bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync`, `python scripts/doorstop-check.py -C -e -F`
  and `bun scripts/ifchange.ts`: passed. Current prose was reviewed; historical records were retained.
  The agent read Rule 11.8 and its verifying files before reviewing it.
  It read surface sections 65, 67, 69, 71 and 72 before clearing their suspect links individually.

The packed fixture checks real WebGPU limit negotiation, ordinary WebGPU/CPU calls against `[4, -8, 12]`,
and the recorded fallback for an unavailable feature.
The bundle gate passed after the measured budget adjustments in `CHANGELOG.md`.
These software-adapter results establish behavior, not physical-device performance or Apple/Metal precision.

Default fusion facts with ordinary-call projection, project initialization and console variants remain pending.
Downstream pins, release and the physical Apple/Metal check remain unassigned or unperformed.
Proposal 0082 remains accepted and proposal 0081 deviation D1 remains open.

## What it owes downstream

Each repository in the front matter adopts a validated implementation pin and records 0085 in `compiler-changes.md`.
The site updates its setup, runtime, fusion, fp64 and console pages in English and Korean, including API translations.
The editor updates host references and initializer guidance without inventing shader ambient names.
TypeCV and TypeNN verify their owned-array wrappers, explicit flavor policies and fused plans against the new defaults.
Radiance reviews supplied-device and manifest-loading paths where applicable.
All browser deployments include the executor's emitted assets.

Downstream adoption retains separate compiler and workload provenance.
No speed improvement in TypeCV or another engine is claimed from a compiler pin alone.
Existing shipped shaders require rebuilding, and actual workloads determine which optimizations apply.
All downstream work is pending until implementation and validated pin updates.

### Default compiler facts and ordinary projection implementation

This stage starts from instance-capability source `28457e2dabd5408e303f229dcd6e865a0e8d9b07`,
then incorporates parent refresh `6053e360` and main `72b2f99f`.
Branch `agent/0085-default-facts` retains this stage. Git identifies its implementation commits.
No implementation PR was assigned when this record was prepared.

`hostFace()` writes eligible kernels' fusion facts unless `fuse: false` is explicit.
The Vite plugin preserves an explicit false override and shares that default.
Manifest `ir` remains independent. The planner's facts and portable IR describe full layouts.
Ordinary input projection is no longer suppressed by those facts.
The runtime still selects private inputs only for ordinary, non-resident calls and retains alias guards.
Resident and fused calls use the original bindings and IR. No exposed binding layout changes.

The new regression alternates ordinary, resident, fused and ordinary calls on one generated face.
Its two-item input writes 8, 32 and 8 bytes for the ordinary/resident/ordinary calls.
The full-layout and private shader variants remain distinct, and the fused group retains full-layout IR.
Both compiler and language service read the new shader source.
The packed journey uses default Vite configuration and compares ordinary, resident and a two-call fused result with independent references.
Its single-loop `layoutMap` and two-loop `layoutRead` remain separate fixtures. Both compiler and language service read the whole shader file.
An initial journey assertion incorrectly required the two-loop function to fuse. The corrected single-loop fixture passes without changing planner rules.
The loop-fuse and MNIST timing controls now request `fuse: false` explicitly.

Generated payloads were measured on 2026-10-23 UTC with Bun 1.4.3, all imports external,
minification enabled and gzip level 9. The unchanged five-kernel loop-fuse source measures
4,289 bytes by default versus 2,575 with `fuse: false`. The four-field object-input fixture measures 2,033 versus 1,429 bytes.
Explicit `fuse: true` matches the default byte for byte in both fixtures.
These sizes describe generated payloads. They establish no physical-device performance result.

The focused host-face, projection, Vite, device and fuse suites passed 341 tests on 2026-10-23 UTC.
A Codex agent completed the following checks on 2026-10-23 UTC with Bun 1.4.3, TypeScript 5.6.3,
Chromium 154.0.8037.57 on SwiftShader, and Doorstop 3.2:

- `bun run build`, `bun run lint` and `bun run format:check`: passed, including the final fixture.
- `bun run test`: 477 files and 10,925 tests passed, with four skipped and one TODO, before the final fixture parity test was added.
- After that addition, `bunx vitest run src/compiler/ts/kernel-project.test.ts`: all 17 tests passed.
- The final Vite suite: 22 tests passed, including explicit `fuse: false` with manifest `ir: true`.
- Public API shape and JSDoc coverage: 24 tests passed without changing the API snapshot.
- Common modules: 14 tests and `bun scripts/bake-common-modules.ts --check` passed; baked files remain unchanged.
- Isolated TypeScript 5.9.3 and 6.0.3 checks of `tsconfig.tests.json`: passed.
- `bun run gate:compile`: 184 WGSL examples, 127 GLSL programs, 122 pipelines and entry-call checks passed.
- `bun run gate:differential`: all five arms and planted-fault checks passed, including corrupted projected input detection.
- The corrected `bun run gate:journeys`: 32 journeys, 119 runs and all packed host checks passed.
  Default-built object inputs matched their reference under ordinary projection and one fused full-layout dispatch.
- `bun run gate:boundary`: all five closures, single-file builds and split assets passed without changing budgets.
  Runtime single-file gzip remains 127,219 bytes; split initial/aggregate remain 36,293/129,352 bytes.
  Emit remains 95,174, fuse 88,840, algorithms 43,495 and random 28,736 bytes.
- `bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync`, `python scripts/doorstop-check.py -C -e -F`
  and `bun scripts/ifchange.ts`: passed. No must-fix impact remained. Historical records were retained.
  The agent read Rules 8.22, 8.23 and 11.13 and their verifying references before reviewing them individually.
  It read surface sections 3, 38, 63, 65, 71, 72 and 74 before clearing their suspect links individually.

The ordinary/fused byte and result checks establish behavior and memory use, without a physical-device speed claim.
Proposal 0085 remains accepted. Initializer guidance, console variants, downstream pins and physical Apple/Metal validation remain.
Proposal 0082 still requires controlled physical-device evidence. Proposal 0081 deviation D1 remains open.

### Project initializer implementation

This stage starts from main `fe7e105e842ee33ce44ba1818bf9fe9a67002d4a` on 2026-10-23 UTC.
Before the first commit, it incorporates main `bdd0a8f1ec999f8e96d268fa1be9982aa28b7859` (documentation correction PR #756).
The functional and document checks are repeated on that refreshed checkout before pushing.
PR #754 merged as `e6c4c38b60b5ad6178bd46dd069f2f688a448906` after all eight jobs of CI run 39915765469 passed.
PR #755 merged as `fe7e105e842ee33ce44ba1818bf9fe9a67002d4a` after all eight jobs of run 39917053674 passed.
Its two additional MNIST workflows also passed (runs 39917053649 and 39917053655).
Branch `agent/0085-project-init` retains the initializer stage; Git identifies its implementation commits.
No implementation PR was assigned when this record was prepared.

`cli/init.ts` plans the Vite plugin, host and shader configurations, ignore entry and synchronization scripts before writing.
It preserves JSONC source ranges and unrelated commands. It does not execute the Vite configuration.
Static default objects and `defineConfig({ ... })` with literal plugin arrays are supported.
Unrecognized dynamic configuration retains the manual path. Conflicts, including inherited option conflicts, are refused before writing.
Standard app project references are selected automatically. An explicit `--project` selects another host configuration within the project.
The host configuration uses `noEmit` and permits TypeScript extension imports; incompatible values require an explicit user edit.
Repeated initialization changes no file. The initializer adds no runtime dependency and importing a library initializes no configuration.

Generated install hooks synchronize views. Generated typecheck and build prefixes synchronize views and run shared shader diagnostics before original commands.
Explicit `--allow-empty` supports the empty new project. Legacy check/sync behavior without it remains a refusal.
The shader project provides ambient types; ordinary tsc is not claimed to accept shader decorators.
The compiler and language service both read the packed fixture in the focused tests.
The packed journey proves missing-view detection, normal-script regeneration and an actual WebGPU result against independent values.

A Codex agent completed validation on 2026-10-23 UTC with Bun 1.4.3, TypeScript 5.6.3,
Node 24.19.0, Chromium 154.0.8037.57 on SwiftShader, and Doorstop 3.2:

- `bun run build`, `bun run lint` and `bun run format:check`: passed.
- `bun run test`: 478 files and 10,951 tests passed, four skipped and one TODO.
- Focused CLI tests: 34 passed. They cover JSONC preservation, inherited settings, referenced app selection,
  explicit projects, Windows drives, conflicts with no writes, plugin aliases, repeated setup and empty-tree behavior.
- Public API and JSDoc coverage: 24 tests passed; the public API snapshot remains unchanged.
- Isolated TypeScript 5.9.3 and 6.0.3 checks of `tsconfig.tests.json`: passed.
- `bun run gate:compile`: 184 WGSL examples, 127 GLSL programs, 122 render pipelines and entry-call checks passed.
- `bun run gate:differential`: all five arms and planted-fault instruments passed.
- `bun run gate:journeys`: 32 journeys and 119 runs passed, followed by seven initialized-project checks and all existing packed host checks.
  Install works with no shader and retains the prepare command. Missing views make bare host tsc fail;
  normal scripts regenerate them. The CSP-protected production page executes the WebGPU call against `[2.5, -4, 7]`.
- `bun run gate:boundary`: all five closures and single-file/split instruments passed without a budget change.
  Runtime single-file gzip remains 127,219 bytes, split initial/aggregate 36,293/129,352.
  Emit remains 95,174, fuse 88,840, algorithms 43,495 and random 28,736 bytes.
- `bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync`, `python scripts/doorstop-check.py -C -e -F`
  and `bun scripts/ifchange.ts`: passed. Every listed review was read, current CLI prose was updated,
  historical records were retained, and no must-fix impact remained.

These checks establish initialization and execution behavior. They make no physical-device speed or Apple/Metal precision claim.
Proposal 0085 remains accepted: retained console variants, physical Apple/Metal validation and downstream pins remain open.
Proposal 0082 still requires controlled physical-device evidence. Proposal 0081 deviation D1 remains open.
