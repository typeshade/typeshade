---
id: '0085'
title: Host calls use their device without registration or optimization setup
status: draft
rules:
  - '8.23'
  - '11.8'
  - '11.9'
  - '11.10'
  - '11.11'
  - '11.13'
surface:
  - 38
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

| Field                         | Record                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0085. Front-matter status is `draft`. No delivered behavior is claimed.                                                                              |
| Date and attribution          | Authored by a Codex agent on 2026-10-23 UTC. This is the authorship date.                                                                                     |
| Request source                | The owner requested a review of hidden initialization and setup costs, then said to proceed with the eight reported improvements.                             |
| Applicability / effectivity   | Host calls, device owners, generated host modules, Vite/CLI setup and program-runtime console loading. No release version is assigned.                        |
| Review baseline               | `main` at `d36ac5027356b96e87a9ad900dfd8e6ea4ab55dc`. The initial audit used `73a497d8`; the relevant executable source is unchanged between these revisions. |
| Review and revision authority | No pull request is assigned at this initial revision. Git records revisions. A proposal-only PR will retain the design review and acceptance decision.        |

## What changes

This proposal removes eight related setup costs from the normal host path.
Device ownership and execution order remain explicit in the implementation.
Applications do not register a planner or select its build metadata to use a public method.
Advanced overrides remain available.

### Device calls and automatic fusion support

The following is proposed usage, not current behavior:

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
The implementation must verify this old-reader behavior with real baseline code before retaining schema 2.

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
The proposal PR retains the repeated compiler/type-check results against the review baseline.
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

- Rule 8.23 clarifies that fusion metadata does not select a call's physical input layout.
- Rule 11.8 covers inferred owners, default fp64 selection and instance capability options.
- Rules 11.9 and 11.10 distinguish an available console variant from enabled recording.
- Rule 11.11 permits only package-owned executor loading and retains the compiler/dependency boundary.
- Rule 11.13 removes registration as a precondition while preserving recording and queue semantics.
- Surface 38 retains the fp64 correctness limits; sections 64 to 67, 69 and 71 explain the changed host paths.
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
The recorder's size and first-use loading time have not been measured because it is not implemented.

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

Acceptance does not yet apply.
The owner's instruction authorizes preparing this proposal and its review evidence.
The new default behavior, loading policy, bundle cost and compatibility decisions require review of this concrete revision.
The proposal must be merged as accepted before implementation begins, as `changes/README.md` requires.

The proposed implementation order is automatic fp64 selection and valid options, device ownership and recorder loading,
default compiler facts with projection, project initialization, then console capability delivery.
Each implementation PR records its exact scope and completed evidence.
Implementation milestones have no assigned dates.
No agent is assigned completion credit for tests or downstream work that have not run.

Before acceptance, the review must settle the loader/CSP policy and bundle-accounting method,
confirm schema-2 console compatibility, and approve the explicit type migration.
The proposed choices above are recommendations, not an approval record.

### Configuration and validation record

Delivery does not yet apply. This PR contains a proposal only.
The baseline probes and bundle experiment establish the problem and a measured alternative.
They are not tests of a new API implementation.
The PR records documentation checks and proposal-shape validation separately from those observations.

Proposal 0082 remains accepted pending controlled physical-device whole-call evidence.
Proposal 0081 deviation D1 remains open.
This proposal does not change entry binding layouts, raw byte representations or the key-id contract.

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
