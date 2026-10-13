---
id: '0051'
title: A host's WebGPU device, on the program runtime and on the call layer, requests the limits it needs, reports them, and refuses a pipeline past a limit by name
status: accepted
rules:
  - '11.8'
  - '11.11'
  - '11.13'
surface:
  - 3
  - 64
  - 65
  - 69
  - 71
exports:
  - Runtime
  - RuntimeOptions
  - configure
  - callDevice
  - DeviceReport
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The runtime paragraph of the WebGPU concept page, en and ko, says the runtime requests the features the programs need. It gains the limits and rt.limits. Its call-layer paragraph gains configure({ limits, features }) and callDevice(). The page explains Rule 11.11 and Rule 11.13's F5. When the pin moves, the edit of that rule makes the site's rule checks name the page in en and ko. READ_AGAINST in src/lib/design-rules.ts and content/guide/ko/rules.json then take the rule's new fingerprint, after each page is read again. The API reference is generated from the pinned compiler's source and lists the new limits fields with no hand edit. compiler-changes.md records 0051 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's references/host.md says the runtime requests the features programs need, and that a program is refused for a feature the device lacks. It gains the limits, rt.limits, the pipeline refusal, and configure({ limits, features }) with callDevice() for the call layer. compiler-changes.md records 0051 when the pin moves.
---

<!-- doc-refs: skip-file — an accepted proposal not yet implemented names files it will add and files in downstream repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0051`, `status: accepted` (accepted by PR #649). The front matter is the lifecycle authority. On 2026-10-05 at 16:53 UTC the draft took `0051`, after `main` held proposals up to `0043` and pull requests #482, #483 and #486 held `0044` to `0046`. Pull request #496 then took `0051` on `main` for the array zero value (c57fbdc9), so on 2026-10-06 this draft moved to `0051`, the next free number after record 0006's other drafts `0048` to `0050`. This proposal is item 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Date and attribution          | Written 2026-10-05 (UTC). The date is the authoring context, not an approval. A coding agent drafted it in a Claude Code session, at the owner's direction, for the engine typeshade/radiance. The source is item 1 of the engine's design record 0006 (`docs/design/0006-compiler-boundary.md`, accepted 2026-10-05, radiance `main` at `0bd1be8`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Applicability / Effectivity   | The program runtime, `typeshade/runtime` (`src/runtime/runtime.ts`, `src/runtime/program.ts`, `src/runtime/gpu.ts`, `src/runtime/gl.ts` and a new `src/runtime/limits.ts`). Rules 11.8, 11.11 and 11.13, surface §3, §64, §65, §69 and §71. The call layer's device (`gpuDevice()` in `src/core/host-entry.ts`, `configure()` in `src/core/resident.ts`, `settle()` in `src/core/fuse-plan.ts`) joins the runtime from revision 2. The site and the editor. Release version unassigned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Review baseline               | `origin/main` at `96dbaa9f` (read for revisions 2 and 3 on 2026-10-13). Revision 1 read `origin/main` at `3f6f46b0c97b9761a4cb1d6975cf16685e7f355b`. Revision 3 read every citation of this repository again at `96dbaa9f`. It read the citations of other repositories at their `origin/main` of 2026-10-13: the site at `0c56a88`, the editor at `bbb2d9e` and the engine at `30daafa`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Revision                      | Revision 2, 2026-10-13 (UTC), drafted at the owner's request. It adds the call layer's device (`configure({ limits, features })`, `callDevice()`, and the F5 read of Rule 11.13), moves the review baseline and widens the front matter. The date means the authorship of this revision, not an approval. Git history holds revision 1. Revision 3, 2026-10-13 (UTC), is a verification pass that a coding agent made at the owner's request. It reads every citation again at `96dbaa9f`, and corrects what `main` changed after `3f6f46b`: the WebGL2 tier of change 0054, the workgroup check of change 0057, the engine's `limits.ts` and the bundle size. It adds decisions 12 to 14 and refusal R7, and changes the design only as they state. The date means authorship, not approval. The owner approved revision 3 on 2026-10-13 (Asia/Seoul) and decided decisions 1 to 11 as the Decisions section states. The design text of revision 3 is otherwise unchanged. |
| Review and revision authority | [PR #649](https://github.com/typeshade/typeshade/pull/649), the proposal-only pull request. Git records revisions. The review and merge of PR #649 record the decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## What changes

The program runtime (Rule 11.11) and the call layer (Rules 11.8 and 11.13) gain WebGPU's device limits. The runtime part has four parts, and the call layer has one, below. Part 4
ships with this proposal (decision 3 under "Why"):

1. **Request.** `createRuntime({ limits })` names limits the requested device must have. With
   `programs`, the runtime also derives from each manifest the limits its entries need, and
   requests both. A binding size the host names raises `maxBufferSize` with it.
2. **Report.** `rt.limits` is the device's limits: a frozen record of numbers, keyed by WebGPU's
   names.
3. **Refuse a pipeline.** The runtime refuses a pipeline whose entries need more of a limit than
   the device has, before it calls WebGPU. The refusal names the entry, its line, the limit and
   both numbers. At the baseline WebGPU refuses such a pipeline, and the runtime passes on
   WebGPU's message (Before and after).
4. **Refuse a value.** `dispatch()` and `draw()` refuse a buffer larger than the device binds or
   makes. They also refuse a dispatch with more workgroups than the device dispatches. The refusal
   names the limit.

Nothing an author writes changes. The compiler's diagnostics keep WebGPU's default limits, since a
compile does not know the device (Rule 8.7). The manifest keeps schema 1 (Rule 11.10).

The program runtime has two tiers since change 0054: WebGPU and WebGL2 (Rule 11.11,
`createRuntime({ prefer })`, `rt.tier`). WebGPU's limits belong to the WebGPU tier. A WebGL2
runtime reports an empty `rt.limits`. Parts 1 to 4 apply to the WebGPU tier. What each tier does,
below, gives the rules for `prefer` and for a WebGL2 `device` (decisions 12 and 13).

The design extends change 0025, section 2 ("The device"). That text says that the runtime "requests
a device with the features and limits the programs in `programs` need". Rule 11.11 and
`createRuntime` delivered the features alone. This proposal states the limits half as rule text,
with its API, its refusals and its tests.

### The call layer's device (revision 2)

The call layer runs kernel functions, entries, draws, `fuse` scopes and the default runtime on one
device. `gpuDevice()` requests that device (`src/core/host-entry.ts`, lines 703 to 722) with no
descriptor, so no call raises a limit. Revision 2 gives the call layer the request and the report
that the runtime has. The steps below apply to the call layer only.

1. **Request.** `configure({ limits, features })` names the limits and the WebGPU features the
   call layer's device must have. `limits` takes the value rules of R1. `features` is a list of
   feature names. `configure()` checks the values when it runs and throws for a wrong one (C1).
2. **Refuse at the first call.** The first call that needs the device requests it. Before
   `requestDevice`, the request checks each name and value against the adapter. A limit or a
   feature the adapter cannot give rejects that call with an `Error` (C2). `configure()` is
   synchronous, so it cannot make this check.
3. **Keep the request.** After the device exists, `configure({ limits })` or `configure({ features })`
   with a different value throws a `TypeError` (C3). A refused request leaves no device, so a later
   call may request the device again.
4. **Report.** `callDevice()` requests the device as a call does. It resolves to a `DeviceReport`:
   `limits`, a frozen record of the device's numeric limits keyed by WebGPU's names, and
   `features`, the enabled feature names in sorted order. It resolves `null` where the call layer
   has no WebGPU device.
5. **Read the limit in `fuse`.** The planner reads `maxStorageBuffersPerShaderStage` from the
   report, and takes the default of 8 only when the report has none (Rule 11.13, F5).

When `configure({ runtime })` names a runtime, the calls use that runtime's device. The host made
it, so `configure({ limits })` and `configure({ features })` throw a `TypeError` (C4). The host
names those limits in `createRuntime()` instead.

WebGPU's `requestDevice` sets a limit to the value requested when that value is above the default
and at or below the adapter's value. A request below the default leaves the default. The unit test
pins what the call layer passes.

| Id  | Where                                                               | Class       | Text                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | `configure({ limits })`                                             | `TypeError` | The R1 texts, with `configure({ limits })` in place of `createRuntime({ limits })`.                                                                                                                                          |
| C2  | the first call that needs the device; that call rejects             | `Error`     | `The adapter supports maxStorageBuffersPerShaderStage up to 8; configure({ limits }) asks for 12.` For a feature: `The adapter lacks the "timestamp-query" feature that configure({ features }) asks for.`                   |
| C3  | `configure()` after the device exists                               | `TypeError` | `configure({ limits }): the call layer's device exists with maxStorageBuffersPerShaderStage 8, and its limits cannot change. Set limits before the first call, or pass createRuntime({ limits }) to configure({ runtime }).` |
| C4  | `configure({ limits })` or `configure({ features })` with a runtime | `TypeError` | `configure({ limits }): a runtime is configured, and its device is the host's. Pass limits to createRuntime({ limits }).`                                                                                                    |

The default runtime, `runtime()`, runs on the call layer's device, so `configure({ limits })` also
applies to it (decision 11).

### Before and after

| At `96dbaa9f`                                                                                                                                                                                                                        | After this proposal                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| With no `device`, `createRuntime()` requests the features `programs` need and no limit (`src/runtime/runtime.ts` line 508).                                                                                                          | It requests the features and the limits `programs` need, and the limits `createRuntime({ limits })` names.                                                                                        |
| A host cannot name a limit. A device the runtime requests has WebGPU's default limits.                                                                                                                                               | `RuntimeOptions.limits` names limits by their WebGPU names. The runtime checks each against the adapter before it requests the device.                                                            |
| The runtime reports no limit. `rt.device` is typed `D`, which is `object` unless the host names a type. So a host reads `rt.device.limits` only with WebGPU's own types.                                                             | `rt.limits` reports the device's limits, for the host's device and for one the runtime requested.                                                                                                 |
| A pipeline past a limit reaches WebGPU, which refuses it. The runtime rethrows the rejection as an `Error`. It names the entry, its line and WebGPU's message (`src/runtime/program.ts` lines 629 to 633 and 708 to 712).            | `program.compute()` and `program.render()` reject with a `TypeError` before the runtime calls WebGPU. The text names the entry, its line, the limit and both numbers in the runtime's words (R4). |
| A binding past `maxStorageBufferBindingSize`, or a buffer past `maxBufferSize`, is left to WebGPU's validation. For a call that records into a frame, that frame's `submit()` rejects with `The frame did not validate` (inference). | `dispatch()` and `draw()` throw a `RangeError` that names the entry, its line, the binding, its size and the limit (part 4).                                                                      |

The drafting agent read row 4's left column in `src/runtime/program.ts` at the baseline, and the
refusal itself in the WebGPU spec. `at()` (line 224) writes the line. WebGPU's message is the
browser's own text. The spec calls it a human-readable, localizable text and fixes no wording. So
whether it names the limit and the numbers depends on the browser. Inference from the spec: the
layouts `#shape` makes (`src/runtime/program.ts` lines 589 and 596) fail validation before the
pipeline does. That error goes to the error scope open at that time, or to the device's
`uncapturederror` event.

So part 3 changes three things for a host:

- The class of the rejection changes from `Error` to `TypeError` (decision 2).
- The check comes before WebGPU. The runtime makes no layout that fails validation, so no
  validation error reaches an error scope or `uncapturederror` for it.
- The text names the limit and both numbers, whatever the browser's message says.

Row 5's left column is an inference from `src/runtime/program.ts` and `src/runtime/runtime.ts`
(lines 347 and 424 to 426, the frame's error scope). The drafting agent measured neither row on a
device.

### The API

`RuntimeOptions` and `Runtime` each gain one field. Every other field stays as it is (`prefer` and `tier` are change 0054's).

```ts
/** How `createRuntime()` makes a runtime. */
export interface RuntimeOptions<D extends object = object> {
  /** The host's `GPUDevice` or `WebGL2RenderingContext`, which the runtime uses and never
   *  destroys. Omitted: the runtime tries the tiers of `prefer`, and on WebGPU requests a
   *  device with the features and the limits `programs` need and the limits `limits` names. */
  readonly device?: D;
  /** The tiers `createRuntime` tries when it is given no device: `['webgpu', 'webgl2']` by
   *  default. As at `96dbaa9f`. */
  readonly prefer?: readonly ('webgpu' | 'webgl2')[];
  /** The programs the requested device must be able to run. */
  readonly programs?: readonly Pack[];
  /** WebGPU limits the device must have, by their names in `GPUSupportedLimits`:
   *  `{ maxStorageBufferBindingSize: 1 << 30 }`. Without `device`, the runtime requests each,
   *  with the limits `programs` need, and the larger of the two where both name one. A binding
   *  size named here raises `maxBufferSize` with it, up to the adapter's. With `device`, the
   *  runtime checks the device against each. A WebGL2 runtime has no WebGPU limits: with a
   *  WebGL2 `device` the runtime refuses `limits` (R7). Omitted: none. */
  readonly limits?: Readonly<Record<string, number>>;
  readonly console?: 'print' | ConsoleSink;
  readonly consoleBytes?: number;
  readonly emit?: (manifest: Pack, options: { readonly console?: boolean }) => Pack;
}

/** The program runtime: a device, and everything a program needs on it. */
export interface Runtime<D extends object = object> {
  /** The `GPUDevice`: the host's, or the one the runtime requested. */
  readonly device: D;
  /** The device's limits, by their names in `GPUSupportedLimits`, copied when the runtime is
   *  made. Frozen. Empty on the WebGL2 tier (`tier` is `'webgl2'`). */
  readonly limits: Readonly<Record<string, number>>;
  // tier, load, texture, sampler, frame, submit and destroy as at `96dbaa9f`
}
```

`createRuntime` keeps its signature, `<D extends object = object>(options?: RuntimeOptions<D>) =>
Promise<Runtime<D>>`. `runtime()`, the default runtime, reports the limits of the device the call
layer uses. A host that keeps to `typeshade/runtime` writes this:

```ts
import { createRuntime } from 'typeshade/runtime';
import trace from './trace.shade.ts'; // the manifest (§64)

const rt = await createRuntime({
  programs: [trace], // the runtime derives what its entries need: nine storage buffers, say
  limits: { maxStorageBufferBindingSize: 512 * 1024 * 1024 }, // a size only the host knows
});
rt.limits.maxStorageBuffersPerShaderStage; // 9 or more, where the adapter supports 9
rt.limits.maxStorageBufferBindingSize; // 536870912 or more
rt.limits.maxBufferSize; // raised with the binding size, where the adapter supports it
```

**The type.** The value type is `Readonly<Record<string, number>>`, keyed by WebGPU's names. It
needs no new export, and it takes a limit WebGPU adds later with no change to the runtime. A
named type that lists every limit is the alternative (decision 1).

**The copy.** `rt.limits` holds every limit the device's `limits` object reports. The attributes
of `GPUSupportedLimits` are accessors on its prototype (WebIDL), so an object spread copies none
of them. The implementation copies them with `for…in`, which lists inherited enumerable
properties, and freezes the copy. A device's limits do not change after it is made, so one copy
is enough.

**A device or an adapter with no `limits`.** Every `GPUDevice` and every `GPUAdapter` has
`limits`. Only a stand-in has none. The recording device of the tests at the baseline is one
(`fakeDevice`, `src/runtime/runtime.test.ts` line 47). The site's `scripts/compute-runtime.test.ts`
fakes an adapter with no `limits` (typeshade.github.io `0c56a88`, lines 145 to 152). That test
passes `device`, so it does not reach the adapter's limits.

- A device with no `limits` gives an empty `rt.limits`, and the runtime checks no limit against
  it. So R1's check of a name, R3, R4, R5 and R6 do not run there.
- An adapter with no `limits` reports no limit. R1's check of a name, R2 and steps 4 to 7 below
  then do nothing. Step 8 passes no `requiredLimits`, as at the baseline.
- R1's check of a value runs in both cases.

A test of a refusal gives its stand-in a `limits` object.

### What the runtime derives from a manifest

The runtime derives a need for each entry from fields schema 1 already carries (Rule 11.10). They
are `entries[].bindings`, each binding's `resource.resourceKind`, `group` and `binding`, and an
entry's `workgroupSize`. For a program that records, they include `console.bindings`.

| Limit                                                                              | What one entry needs                                                                                                                                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxStorageBuffersPerShaderStage`                                                  | The storage-buffer bindings the entry reaches. `_console` counts too, for a compute or fragment entry of a program that can record.                     |
| `maxUniformBuffersPerShaderStage`                                                  | The uniform-buffer bindings the entry reaches.                                                                                                          |
| `maxSampledTexturesPerShaderStage`                                                 | The texture bindings the entry reaches, the `_fp64` guard among them.                                                                                   |
| `maxSamplersPerShaderStage`                                                        | The sampler bindings the entry reaches.                                                                                                                 |
| `maxStorageTexturesPerShaderStage`                                                 | The storage-texture bindings the entry reaches.                                                                                                         |
| `maxBindGroups`                                                                    | One more than the highest group the entry reaches. `_console` and the `_fp64` guard are in group 0.                                                     |
| `maxBindingsPerBindGroup`                                                          | One more than the highest binding number the entry reaches. `_console` and the `_fp64` guard count: each takes a binding past group 0's other bindings. |
| `maxComputeWorkgroupSizeX`, `maxComputeWorkgroupSizeY`, `maxComputeWorkgroupSizeZ` | A compute entry's `workgroupSize`, axis by axis. The request only: `checkWorkgroupShape` refuses a shape past the limit (below).                        |
| `maxComputeInvocationsPerWorkgroup`                                                | The product of the three extents.                                                                                                                       |

The runtime counts per stage because its pipeline layout makes each binding visible to the stages
whose entries reach it (`#shape` in `src/runtime/program.ts`, line 549). So a stage's count in a
pipeline is its own entry's count. A render pipeline needs, limit by limit, the larger of its
vertex entry's need and its fragment entry's need.

The console pass puts `_console` in group 0, one past the group's highest binding. The `_fp64`
guard goes one past `_console` (`src/core/passes/console-buffer.ts` lines 471 to 474).

**A program that can record.** A program records when it is loaded with its recorded variant.
That is the default when its manifest carries `console` (§69). A host can also call
`load(m, { console: true })` for a manifest with no `console`. The runtime then emits the variant
with `createRuntime({ emit })`, from the manifest's `ir` (`src/runtime/runtime.ts` lines 216 to
226). So a program can record when its manifest carries `console`. It can also record when its
manifest carries `ir` and the host passes `emit`. The derivation counts `_console` for each such
program. The pipeline check counts `_console` when the loaded program records, and R4 then names
the console buffer.

Inference: for a host that never records, this count can request one storage buffer more than its
pipelines bind. The request stays capped at the adapter's value, so it refuses nothing.

**One authority.** One function computes the need. The implementation first moves the selection
of bindings out of `#shape` (`src/runtime/program.ts` lines 550 to 577) into a pure function in
`src/runtime/limits.ts`. That step is necessary because `#shape` is private and makes GPU objects.
It reads the program's bindings and its log, so `createRuntime` cannot call it on a bare manifest.
The pure function takes the entries, the binding of each name and whether the program can record.
It returns each binding with the stages that reach it. It adds `_console` by the recorder rule of
`#shape` (line 560). `#shape`, the derivation and the pipeline check all call it. So the pipeline
check and the layout cannot disagree (`AGENTS.md#gate-discipline`, "One authority").

The derivation agrees with them for a manifest that carries its recorded variant. A manifest that
the emitter would record carries no `_console` binding. For it, the function places `_console` by
the console pass's rule above, and moves the `_fp64` guard, where there is one, one past it. That
count is a prediction of the variant, and the pipeline check holds the variant itself.

**The limits the runtime does not derive.**

- The manifest carries no workgroup memory size, so `maxComputeWorkgroupStorageSize` is not
  derived.
- `maxInterStageShaderVariables`, `maxVertexAttributes`, `maxVertexBuffers` and
  `maxColorAttachments` follow render state as well as the manifest.
- A value decides `maxStorageBufferBindingSize`, `maxUniformBufferBindingSize`, `maxBufferSize`,
  `maxComputeWorkgroupsPerDimension` and `maxTextureDimension2D`. A host names each of these in
  `limits`. The runtime also raises `maxBufferSize` with a binding size the host names (step 7
  below).
- `maxStorageBuffersInVertexStage`, `maxStorageBuffersInFragmentStage`,
  `maxStorageTexturesInVertexStage` and `maxStorageTexturesInFragmentStage` follow the per-stage
  limits on a core device. The runtime does not request them, and R4 does not check them.
- WebGPU checks a render pipeline's bind groups and vertex buffers together against
  `maxBindGroupsPlusVertexBuffers`, and checks a draw's again. The runtime's render pipeline
  takes at most one vertex buffer (`src/runtime/program.ts` lines 670 to 682). A draw also counts
  what the host sets on its own pass, which the runtime does not know. So the runtime does not
  request this limit, and R4 does not check it. The default is 24. Inference: the runtime's need
  is at most one more than its `maxBindGroups` need.

The reason for the vertex-stage and fragment-stage item comes from the WebGPU editor's draft. The
drafting agent read it on 2026-10-05 through a web tool that summarizes a page. It read it again in
the draft's source (gpuweb/gpuweb `main`, `spec/index.bs`). The draft's device creation sets the two
vertex-stage and the two fragment-stage storage limits to the per-stage values. It does so when the
device has the `core-features-and-limits` feature ("create a new device", step 8). The drafting
agent did not check this on a device. The measurement under "Approval and plan record" reads these
four limits on CI's adapter.

For a limit part 4 does not check, WebGPU's validation reports the excess, as at the baseline.

### Requesting the device

With no `device`, `createRuntime` does these things in this order:

1. It requests an adapter and checks the features, as at the baseline (`src/runtime/runtime.ts`
   lines 492 to 507).
2. It checks each entry of `limits` (refusal R1). The value must be a whole number of 0 or more.
   An alignment limit's value must be a power of 2 below 2³². `maxStorageBufferBindingSize`,
   `maxVertexBufferArrayStride` and `maxImmediateSize` take a multiple of 4. The name must be one
   the adapter's `limits` reports.
3. It checks each value `limits` names against the adapter's. For one the adapter cannot give, it
   records the reason (R2) and goes on to the next tier of `prefer`, as it does for a missing
   feature (`src/runtime/runtime.ts` lines 502 to 507). The check comes before `requestDevice`.
4. It derives the need of every entry of every program in `programs`, and keeps the largest for
   each limit.
5. It caps each derived need at the adapter's value. A need past it is refused when the host
   makes that pipeline (R4), since the device then has the adapter's value (decision 5).
6. It takes, for each limit, the larger of the capped need and the value `limits` names. For an
   alignment limit, a name that starts with `min`, it takes the value `limits` names. It derives
   no alignment limit.
7. It raises `maxBufferSize` to the larger binding size that `limits` names, where that is more
   than step 6 gives. It caps the raise at the adapter's `maxBufferSize` (decision 8).
8. It calls `adapter.requestDevice({ requiredFeatures, requiredLimits })`.
9. It copies the device's limits into `rt.limits`, and keeps the adapter's limits for R4.

The basis of R1's rules for a value, read in the source of WebGPU's draft on 2026-10-05:

- A required limit is a `GPUSize64`, an unsigned integer type with `[EnforceRange]`. WebIDL's
  conversion refuses a negative value with a `TypeError`, which names nothing of the host's call.
- `requestDevice` rejects an alignment value that is not a power of 2 below 2³² with an
  `OperationError`.
- WebGPU's limit rules hold `maxStorageBufferBindingSize`, `maxVertexBufferArrayStride` and
  `maxImmediateSize` to a multiple of 4. The `requestDevice` steps do not check a required value
  against these rules. The drafting agent did not measure what a browser does with such a value.

A whole number is the runtime's own rule. A limit counts bytes, bindings or invocations, so a
fraction is the host's mistake. The drafting agent checked none of these rules on a device.

Step 7 exists because the runtime makes the buffer of each binding it fills, at least as large as
the binding (part 4). A binding size past `maxBufferSize` could then bind no buffer the runtime
makes. A raise capped at the adapter refuses nothing. R5 names `maxBufferSize` for a buffer past
the cap.

WebGPU's `requestDevice` sets each limit of a new device to the default, and raises it to a
required value that is better
([WebGPU, `requestDevice`](https://gpuweb.github.io/gpuweb/#dom-gpuadapter-requestdevice)). So a
derived need at or under the default has no effect, and the runtime keeps no table of the
defaults. The unit test pins what the runtime passes, and the journey shows what a real adapter
gives (below).

With `device`, the runtime cannot raise the device's limits. It checks each name in `limits`
against the device's `limits` and refuses one the device does not meet (R3). It does not check
`programs` when it is made. It checks a program's pipeline when it makes the pipeline, as it
checks a program's features at `load()` (decision 5).

### The pipeline check

`program.compute(entry, options)` and `program.render(state)` compute the need of the pipeline's
entries and compare it with `rt.limits`. They check every derived limit of the table above, except the four workgroup limits.
`checkWorkgroupShape` (`src/runtime/program.ts` line 330) already refuses a shape past those, with
a `TypeError` that names the entry and the allowed range. It keeps its text. It reads `rt.limits`
in place of `device.limits`, and its defaults of 256, 256, 64 and 256 stay for a device that
reports none. The runtime still requests those limits for a program whose entry needs more
(decision 14). The check runs before `#shape` makes a layout (`src/runtime/program.ts` lines 617 and 658). A need
past a limit rejects the promise with a `TypeError` (R4). The runtime then makes no bind group
layout, no pipeline layout and no pipeline. The check is part of the cached pipeline's creation,
so the runtime checks a cached pipeline once.

The check runs at the pipeline and not at `load()`. A program can hold entries the host never
makes a pipeline of, and one of them may need more than the device has. `load()` keeps its
checks of the schema and the features.

### The value checks (part 4)

`ComputePipeline.dispatch()` and `RenderPipeline.draw()` check three things. The checks come
before the call takes the console buffer, and before it makes or binds a buffer (the order,
below).

- **A buffer binding's size.** A storage binding is held to `maxStorageBufferBindingSize`, and a
  uniform binding to `maxUniformBufferBindingSize`. The size is the one WebGPU binds:
  - A plain value in a storage binding: the packed bytes, which the binding names as its `size`
    (`src/runtime/program.ts` line 837).
  - A plain value in a uniform binding: the whole buffer the pool takes. That is the packed bytes
    rounded up to 16 (lines 833 to 836, and `BufferPool.take` at line 461).
  - A `Resident`: the bytes of its host value, the size of the buffer `storageBuffer` makes
    (`src/core/host-entry.ts` line 651).
  - The host's own `GPUBuffer`: its `size`.
- **A buffer the runtime makes.** The runtime makes the buffer of a plain value through
  `BufferPool.take` (`src/runtime/program.ts` lines 460 to 466 and line 833). It makes a
  `Resident`'s buffer through `bufferFor` (line 779). Each of these is also held to
  `maxBufferSize`. For a plain value, the size is the packed bytes rounded up to 16, as
  `BufferPool.take` rounds them.
- **A dispatch's workgroups.** Each of `x`, `y` and `z` is held to
  `maxComputeWorkgroupsPerDimension`.

Each excess is a `RangeError` (R5, R6), thrown at the call, as the binding refusals of Rule 11.11
are thrown today. R5 names the first limit the size passes: the binding's limit, then
`maxBufferSize`.

**The order.** At the baseline `dispatch()` and `draw()` take the console buffer before they walk
the bindings (`src/runtime/program.ts` lines 884 to 886 and 930 to 932). `rt.consoleBuffer()`
adds a row that the next `submit()` reads back (`src/runtime/runtime.ts` line 280). So the
checks run in a pass of their own, before that call. The pass computes each size and makes no
buffer. A refused call then takes no console buffer and leaves no row. The pass leaves a value it
cannot size, such as one that does not fit its layout, to the binding walk. The walk refuses it
as at the baseline.

Inference from the same lines: at the baseline a binding refusal of Rule 11.11 comes after the
console buffer, so it leaves a row. That is a separate fix, not part of this proposal.

**What part 4 does not check.** WebGPU's validation reports each excess below, as at the
baseline:

- A vertex or index array the runtime uploads (`#upload`, line 1000).
- The console buffer. Its size is `RuntimeOptions.consoleBytes`, 1 MiB by default
  (`src/runtime/runtime.ts` lines 63 and 173). The pool takes it at that size, rounded up to 16
  (line 462), and the runtime binds it whole as storage (`src/runtime/program.ts` line 761).

With part 4, a host need not keep its own copy of these limits. The engine's record 0001 plans
such a copy, `packages/radiance/src/renderers/limits.ts` in typeshade/radiance (section
"Limits"). At radiance `30daafa` the file exists and holds those defaults, with `checkStorageBinding`.

### The refusals

Each text below is the one the implementation writes, with example values. `(trace.shade.ts:12)`
is the entry's line, written as the runtime's other refusals write it (`at()` in
`src/runtime/program.ts`).

| Id  | Where                                            | Class        | Text                                                                                                                                                                                                                            |
| --- | ------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `createRuntime`, a name or a value               | `TypeError`  | `createRuntime({ limits }): "maxStorageBufferz" is not a limit this adapter reports.` With `device`, "this device reports". For a value, `createRuntime({ limits }): maxBufferSize takes a whole number of 0 or more; got 1.5.` |
| R2  | `createRuntime`, a named limit, no `device`      | `Error`      | `createRuntime(): no tier it may use is here (webgpu: the adapter supports maxStorageBufferBindingSize up to 134217728, and createRuntime({ limits }) asks for 536870912).` For an alignment limit, "down to".                  |
| R3  | `createRuntime`, a named limit, `device`         | `TypeError`  | `The device has maxStorageBufferBindingSize 134217728; createRuntime({ limits }) asks for 536870912. Request the limit in requestDevice({ requiredLimits }) for this device, or omit device so the runtime requests it.`        |
| R4  | `compute()` or `render()` rejects                | `TypeError`  | `The entry "trace" (trace.shade.ts:12) needs maxStorageBuffersPerShaderStage 9; this device has 8. Pass the program in createRuntime({ programs }), or raise the limit with createRuntime({ limits }).`                         |
| R5  | `dispatch()` or `draw()` throws                  | `RangeError` | `"trace" (trace.shade.ts:12), binding "nodes" (array<vec4<f32>>) is 201326592 bytes; this device binds at most 134217728 bytes in one storage binding (maxStorageBufferBindingSize).`                                           |
| R6  | `dispatch()` throws                              | `RangeError` | `"trace" (trace.shade.ts:12): 70000 workgroups in x; this device dispatches at most 65535 in one dimension (maxComputeWorkgroupsPerDimension).`                                                                                 |
| R7  | `createRuntime`, `limits` named, WebGL2 `device` | `TypeError`  | `createRuntime({ limits }): the device is a WebGL2 context, which has no WebGPU limits. Omit limits, or pass a GPUDevice.`                                                                                                      |

Variants of these texts:

- R1 for an alignment limit's value.
  `createRuntime({ limits }): minStorageBufferOffsetAlignment takes a power of 2 below 2^32; got 48.`
- R1 for a value WebGPU holds to a multiple of 4.
  `createRuntime({ limits }): maxStorageBufferBindingSize takes a multiple of 4; got 134217730.`
- R4 on a device the host gave ends with the sentence below, in place of the two remedies. The
  runtime knows which device it owns (the `owned` argument of `RuntimeImpl`).
  `Request the limit in requestDevice({ requiredLimits }) for the device the runtime was given.`
- R4 for a count that includes the console buffer adds a clause after the count.
  `needs maxStorageBuffersPerShaderStage 9, the console buffer among them;`
- R4 can fire on a device the runtime requested that already has the adapter's value of the
  limit. The text then ends with `This adapter supports no more.` in place of the two remedies.
  The runtime keeps the adapter's limits for this when it requests the device (step 9).
- R4 names the entry whose need is the largest. For a render pipeline, that is the vertex or the
  fragment entry.
- R5 for a uniform binding says `in one uniform binding (maxUniformBufferBindingSize)`.
- R5 for a buffer the runtime makes past `maxBufferSize` ends with the clause below.
  `this device makes at most 268435456 bytes in one buffer (maxBufferSize).`

The classes follow the runtime's own at the baseline. An adapter that lacks a feature is an
`Error` at `createRuntime`, and a device that lacks one is a `TypeError` at `load()`. A size past
a limit is JavaScript's `RangeError` (decision 2). At the baseline WebGPU's refusal of a pipeline
reaches the host as an `Error`. R4 is a `TypeError`, as a device that lacks a feature is, since
the runtime refuses the pipeline before WebGPU sees it.

### What each tier does

- **WebGPU, through the program runtime (§69).** Everything above.
- **WebGPU, through the call layer (§64, §65 and §67).** The call layer runs on the device that
  `gpuDevice()` requests. Revision 2 adds `configure({ limits, features })` to that request, with
  refusals C1 to C4 above. A host that needs no raised limit keeps the default request. The call
  layer's WebGPU tier gains no check that gives way to the next tier, and Rule 11.8 keeps its tier
  order (decision 4).
- **WebGL2, through the program runtime (§69, change 0054).** WebGPU's limits do not apply to it.
  A WebGL2 runtime reports an empty frozen `rt.limits`, derives nothing and runs none of R4 to R6.
  With a WebGL2 `device` and a `limits` entry, `createRuntime` throws R7. With no `device`, a
  `limits` entry only constrains the WebGPU tier: where the adapter cannot give it, `prefer` goes
  on to WebGL2 as for a missing feature (decision 12).
- **WebGL2, through the call layer.** The call layer's WebGL2 tier stays as it is.
- **The CPU tier and the oracle.** They have no device and no limit, and the oracle records
  nothing new. A program a device refuses for a limit still runs on the oracle (`compileModule`,
  `dispatch`) and on the CPU tier (Rule 11.7). The engine holds its GPU results to the oracle
  that way.
- **The wasm tier of change 0042 (draft).** No interaction. Its linear memory has a size of its
  own, which 0042 decides.

### The host view and the editor

Rules 8.21 and 8.24 do not change. `hostFace` (`src/compiler/ts/host-face.ts`) writes no limit
into a host view. An entry's host signature and a kernel function's stay as they are, and the
default export stays typed `Pack`. The editor reads `RuntimeOptions` and `Runtime` from the
package's declarations, so `limits` completes in a host file with no change to the language
service. Nothing an author writes in a `"use typeshade"` file changes. So no test of both halves
(`src/language-service/ambient-parity.test.ts`) is owed.

### The compiler's defaults stay

Two diagnostics read WebGPU's defaults at compile time:

- `TS8026` warns at the default compute limits (`DEFAULT_WORKGROUP_LIMITS` in
  `src/compiler/ts/lower/function.ts`, line 3437).
- `TS8071` warns that the WGSL records no console call in a stage that already binds eight
  storage buffers (`DEFAULT_STORAGE_BUFFERS_PER_STAGE` in `src/core/passes/console-buffer.ts`,
  line 47).

A compile does not know the device, so both keep the defaults. Rule 8.7's rationale already says
that "a device requested with raised limits runs a larger workgroup". Surface §3's `TS8026` bullet
gains one sentence: `createRuntime({ programs })` requests that limit, where the adapter supports
it (§69).

### Exclusions

- No change to Rule 11.8's tier order, and no limit check on the call layer's WebGPU tier (decision 4).
- No change to `TS8071`'s eight bindings. That is record 0006 item 9 (below).
- No manifest field and no schema change.
- No check of a texture's size in `rt.texture()`. A texture write is record 0006 item 4, a
  proposal of its own.
- No check of a vertex or index array the runtime uploads, and no check of the console buffer's
  size (part 4).
- No request of the vertex-stage or fragment-stage storage limits, or of
  `maxBindGroupsPlusVertexBuffers` (the derivation, above).
- No request of the adapter's limits as a whole (alternatives, below).
- No new dependency. The new exports are `callDevice` and `DeviceReport`, as the front matter lists; `configure` gains two options.

## Why

### The engine's need

Record 0006 item 1 of typeshade/radiance asks for the request, the report and the refusal. The
engine's record 0001 (`docs/design/0001-scene-data-model.md`) lays its scene out under two runtime
facts:

- Seven storage buffers in the path tracer's pipeline, never eight. The eighth slot stays free for
  the console buffer, which a stage that binds eight cannot take (`TS8071`).
- Each buffer under WebGPU's default `maxStorageBufferBindingSize`, 134,217,728 bytes. Record 0001
  plans a host check of each buffer against constants in
  `packages/radiance/src/renderers/limits.ts`, which throws a `RangeError` (section "Limits"). At
  radiance `30daafa` the file exists (revision 1 read `0bd1be8`, where it did not).

The runtime cannot raise either today. Record 0006 names two consumers: record 0001's headroom at
M3, where reserved fields fill, and M3v. M3v adds volume rendering over dense grids of 128³ to
256³ cells (the engine's `docs/plan.md` §3.4). Inference: one 256³ grid of `vec4<f32>` is
268,435,456 bytes. That is twice the default binding size and equal to the default
`maxBufferSize`. So a larger grid needs both limits raised.

### Evidence at the baseline

Facts, read at `96dbaa9f` for revision 3. Revision 1 read them at `3f6f46b`, and the engine at `e923a34`:

- `src/runtime/runtime.ts` line 508 calls `requestDevice({ requiredFeatures: [...wanted] })` on
  the adapter. It passes no `requiredLimits`.
- `RuntimeOptions` (lines 41 to 70) has no `limits`, and `Runtime` (lines 148 to 171) reports
  none.
- `src/runtime/gpu.ts` declares `features` on `Device` and on `Adapter`. It declares `limits` on `Device` only, and only the four workgroup fields that `checkWorkgroupShape` reads (line 80).
- `RuntimeImpl.load` (lines 209 to 215) refuses a feature the device lacks. The runtime checks
  one limit group itself: `checkWorkgroupShape` (`src/runtime/program.ts` line 330) holds an
  entry's workgroup shape to the device's `maxComputeWorkgroupSize*` and
  `maxComputeInvocationsPerWorkgroup`, with 256, 256, 64 and 256 where the device reports none
  (change 0057).
- When WebGPU refuses a pipeline, the runtime rethrows the rejection as an `Error`. It names the
  entry, its line and WebGPU's message (`src/runtime/program.ts` lines 629 to 633 and 708 to 712).
- `src/core/passes/console-buffer.ts` line 47 holds `DEFAULT_STORAGE_BUFFERS_PER_STAGE = 8`.
  `consoleBuffer` reads it at line 312 for `TS8071`.

Observed result, from a probe run on 2026-10-05 at `3f6f46b` with bun 1.3.14. Revision 3 did not run it again. The probe made a
recording device in the shape of `fakeDevice` in `src/runtime/runtime.test.ts`. Its program had
two compute entries: `wide` binds eight storage buffers and makes no console call, and `logs` calls
`console.log`. The probe packed it with `console: true` and called `program.compute('wide')`. The
layout held nine storage buffers visible to the compute stage. The reason is in `#shape`
(`src/runtime/program.ts` line 560): a program that records adds `_console` to the first compute or
fragment entry of every pipeline. Inference, not measured on a device: WebGPU at the default limit
refuses that layout. This proposal counts what the runtime binds, so R4 names the limit in that
case. Whether `_console` belongs in a pipeline whose entry records nothing is a separate fix, not
part of this proposal.

A search of typeshade/typeshade's issues for "limits" on 2026-10-05 found none. The same search
tool found #335 for "program runtime engine entry points", so it reads the tracker.

### A neighbour: the console at eight bindings

Record 0006 item 9 is the console at eight bindings. A compute entry that binds eight storage
buffers cannot record its console (`TS8071`, Rule 11.9). This proposal does not fold it in. After
this proposal a device can bind nine storage buffers in a stage. `TS8071` still warns at eight and
the WGSL records nothing there, since a compile does not know the device. Item 9 frees the slot,
for example with the console buffer in a bind group of its own.

### Alternatives considered

- **The host reads `rt.device.limits`.** `rt.device` is typed `D`, which is `object` unless the
  host names a type such as `GPUDevice`. Either way the host reads the limits with WebGPU's types.
  The engine's boundary refuses every `GPU…` type name in its packages (`WEBGPU_CALL` in
  `scripts/boundary.mjs` of typeshade/radiance), after the engine journey's own rule. The runtime
  still could not refuse before WebGPU, with the limit and both numbers. Rejected.
- **Request every limit the adapter has.** One line, and no derivation. But a size or a dispatch
  past the default then passes on the developer's adapter with no limit named. It fails only on
  a weaker adapter. This proposal requests only what the programs and the host name. So R5 and
  R6 refuse it on the developer's adapter too, until the host names the limit. Rejected.
- **A `limits` field in the manifest, written by the compiler.** It would be a second authority
  beside the manifest's bindings and entries. It would also be a schema change. The runtime
  derives the same numbers from schema 1. Rejected.
- **A named type that lists every WebGPU limit.** It is a new export, and it goes stale when
  WebGPU adds a limit. A record keyed by WebGPU's names takes any limit the adapter reports. Kept
  as decision 1.
- **The check at `load()`, for every entry.** It would refuse a program whose unused entry needs
  more than the device has. The check at the pipeline refuses only what the host runs. Rejected.
- **Raise the compiler's defaults from the device.** A compile does not know the device (Rule 8.7).
  Rejected.

The design keeps the decisions of change 0025. The runtime stays no typed wrapper over every
WebGPU object (0025 section 2, after #335 decision 1). `rt.limits` is a record of numbers that the
runtime reads for its own refusals. The runtime gains no scene concept.

### Why the call layer too (revision 2)

No path raises a limit today. `gpuDevice()` requests no limit, and the program runtime takes none
yet. The fuse planner reads `maxStorageBuffersPerShaderStage` from the device, and takes 8 when the
device reports none (`settle()` in `src/core/fuse-plan.ts`; `DEFAULT_STORAGE_BUFFERS` in
`src/core/fuse-group.ts`). A device that the call layer requests reports the default of 8. So F5
splits a chain of ten distinct arrays into two groups, although the adapter may allow more.

A host that uses only the calls has no way to lift the split. The alternative is a runtime from
`createRuntime({ limits })`, passed to `configure({ runtime })`. That makes the host build a second
object for the calls it already makes. Naming the limit on the call layer puts the choice where the
calls are made. The runtime path stays as section 1 describes.

### Decisions of the owner

The owner decided 1 to 11 on 2026-10-13 (Asia/Seoul). Each takes the proposed answer, except that decision 7 is worded as its entry states. No decision is open.

1. The value type: `Readonly<Record<string, number>>`, with no new export, or a named type that
   lists the limits, as a new export of `typeshade/runtime`. Decided: the record.
2. The error classes: `Error` for an adapter that cannot give a limit, and `TypeError` for a
   pipeline past the device. A value past a limit is a `RangeError`. At the baseline the rejection
   of such a pipeline is an `Error` (`src/runtime/program.ts` lines 629 to 633). The other choice
   keeps that class for R4. Decided: as listed.
3. Whether part 4, the value checks, ships with this proposal or with a later one. Decided: with
   this one.
4. Whether the call layer's WebGPU tier checks the limits and gives way to the next tier, with the
   limit as its reason (Rule 11.8). Decided: a later proposal.
5. When the runtime refuses a program's need. Decided: at the pipeline (R4) alone. The other
   choice also refuses at `createRuntime`. There a need past the adapter is an `Error`, as a
   missing feature is, and a need past a host's `device` is a `TypeError`.
6. Whether change 0025's record notes the limits half of its section 2 as a deviation that this
   proposal closes. Decided: yes, in the pull request that accepts this proposal. PR #649 adds the note to `changes/0025-program-runtime.md` (section "Record").
7. The bundle budget of `typeshade/runtime`, if the implementation passes it (impact estimate,
   below). Decided: the implementing pull request measures the growth of the runtime bundle. If the
   growth fits a raise of `scripts/bundle-budget.json`, that pull request raises the budget and
   states the measured numbers. The derivation moves out of `typeshade/runtime` only if a reviewer
   rejects the raise.
8. Whether a binding size the host names raises `maxBufferSize` (step 7), or the host names
   `maxBufferSize` itself. Decided: the raise, with R5 for a buffer past it.
9. The reporting function. Revision 2 adds `callDevice()` and the type `DeviceReport`, each
   exported from `typeshade` and `typeshade/runtime`, as `configure()` is. Decided: as named.
10. A refused first request. Decided: the refusal clears the cached device request, so a later
    `configure()` and call may try again. The other choice keeps the refusal for the page's life.
11. The default runtime. `runtime()` runs on the call layer's device, so `configure({ limits })`
    reaches it. Decided: yes, since the two share one device (`src/runtime/runtime.ts`).

### Decisions taken by default (revision 3)

Each of these is a naming or consistency choice inside an established pattern. The owner
confirmed each on 2026-10-13.

12. A `limits` entry the adapter cannot give. Default: the WebGPU tier is unavailable, the
    reason joins the list that `createRuntime` throws, and `prefer` goes on to the next tier.
    Reason: a feature the adapter lacks already works so (`src/runtime/runtime.ts` lines 502 to
    507). R2's class stays `Error`, and its text becomes the reason inside the tier list.
13. The WebGL2 tier. Default: `rt.limits` is an empty frozen record, and a WebGL2 `device` with
    a `limits` entry throws R7. Reason: WebGPU's limits name no WebGL2 quantity, and a silent
    ignore hides the host's mistake.
14. The four workgroup-size limits. Default: the runtime requests them from a manifest, and
    `checkWorkgroupShape` stays their refusal, now reading `rt.limits`. R4 does not repeat them.
    Reason: one refusal for one limit (`AGENTS.md#gate-discipline`, "One authority").

## What it touches

- **Rule 11.11.** Its first sentence gains the limits. The runtime requests a device with the
  features and the limits the programs need, and the limits `createRuntime({ limits })` names.
  New text adds `rt.limits`, the derived limits of the table above, the raise of `maxBufferSize`
  and the refusals R1 to R7. Its "Derives from" line gains change 0051, and its "Enforced by"
  line the tests below.
- **Surface §3.** The `TS8026` bullet gains one sentence that names `createRuntime({ programs })`.
- **Surface §69.** The device bullet gains the limits and `rt.limits`. A new bullet holds the
  table of derived limits and the refusals. The program bullet gains the pipeline refusal.
- **`RuntimeOptions`** gains `limits`. **`Runtime`** gains `limits`. `createRuntime`'s signature
  does not change.
- **Code.** `src/runtime/limits.ts` (new) holds the selection of bindings moved out of `#shape`,
  the need of an entry and the copy of a device's limits. `src/runtime/runtime.ts` holds the
  request, the checks R1 to R3, R7 and `rt.limits`. In `src/runtime/program.ts`, `#shape` calls the
  selection, and `#compute` and `#render` run R4 before `#shape`. `dispatch()` and `draw()` run
  R5 and R6 in a pass before they take the console buffer. `src/runtime/gpu.ts` declares `limits`
  on `Device` and on `Adapter`. `src/runtime/gl.ts` gives `GlRuntimeImpl` an empty frozen `limits`.
- **Tests.** `src/runtime/runtime.test.ts`, against the recording device and a fake adapter on
  `globalThis.navigator.gpu`:
  - The `requiredLimits` that `createRuntime({ programs })` passes for an entry of nine storage
    buffers.
  - The merge with `limits`: the larger value kept, and a derived need capped at the adapter's.
  - `maxBufferSize` raised with a binding size `limits` names, and capped at the adapter's.
  - Each refusal's text, R1 to R7, and each variant.
  - The WebGL2 tier: an empty frozen `rt.limits`, R7 for a WebGL2 `device` with `limits`, and
    `prefer` going on to WebGL2 where the adapter cannot give a named limit (decision 12).
  - `checkWorkgroupShape` reading `rt.limits`, with its text unchanged (decision 14).
  - One test for each row of the derivation table.
  - `_console` counted for an entry that records and for the probe's `wide`. It is also counted
    for a manifest with `ir` when the host passes `emit`.
  - A stand-in device with no `limits`: an empty `rt.limits`, and no limit checked.
  - A stand-in adapter with no `limits`: `requestDevice` receives no `requiredLimits`.
  - A refused `dispatch()` of a program that records: the next `submit()` resolves to no row for
    it.
  - R5 for a plain value in a uniform binding, at the packed bytes rounded up to 16.
  - `rt.limits` from a device whose limits are accessors on a prototype, as `GPUSupportedLimits`
    is, frozen.
  - For every example's manifest, each stage's count equal to the bind group layout entries the
    recording device receives. A floor on the storage bindings counted proves the instrument
    (`AGENTS.md#gate-discipline`).
- **A journey**, `journeys/limits/`, an engine run on public exports alone like
  `journeys/engine/`. It first shows a default device refusing an entry of nine storage buffers
  with R4. It then runs the entry on a device that `createRuntime({ programs })` requests, and
  holds the result to the CPU oracle. Its second half needs an adapter that offers more than eight
  (the measurement under "Approval and plan record").
- **Documents.**
  - `CHANGELOG.md` gains an entry.
  - `src/__api__/surface.md` is baked again (`bun run bake:api-surface`).
  - `src/AGENTS.md`'s `runtime/` row (line 34) lists the runtime's files, and gains `limits.ts`.
  - Surface §69 and Rule 11.11's rationale say the runtime is about 13 KB gzipped on WebGPU, and
    its WebGL2 tier 15 KB more (`docs/use-typeshade-surface.md` line 7891,
    `docs/language-design.md` line 1254). Both follow the size the implementation measures. The
    headroom at `96dbaa9f` is 279 bytes of the whole budget (decision 7).
  - `reqs/` follows the edits of Rule 11.11 and of surface §3 and §69 (`RULE-1111`, `SURF-003`
    and `SURF-069`), through `bun run reqs:sync` and `doorstop -C`.
  - `scripts/bundle-budget.json` changes only by decision 7.
- No diagnostic code and no example changes.

### Call layer (revision 2)

- **Rule 11.8.** The WebGPU condition names the device that `configure({ limits, features })`
  requests. The tier order and the refusal stay (decision 4).
- **Rule 11.13.** F5 reads `maxStorageBuffersPerShaderStage` from the report, as section 1 of
  the call layer describes. Its refusal text in surface §71 names the device's limit, not 8.
- **Surface §64, §65 and §71.** The paragraph on the default device in §64 and §65 gains
  `configure({ limits, features })` and `callDevice()`. §71 gains the F5 wording.
- **Exports.** `configure` gains `limits` and `features`. `callDevice` and `DeviceReport` are new.
- **Code.** `src/core/host-entry.ts`: `gpuDevice()` takes the request from the stored
  configuration, applies C2 and keeps the report; `callDevice()` is new beside it.
  `src/core/resident.ts`: `configure()` applies C1, C3 and C4. `src/core/fuse-plan.ts`:
  `settle()` (lines 582 to 589) reads the report and not `device.limits`.
- **Tests.** `src/fuse.test.ts`, on its fake device with the `storageBuffers` option: ten distinct
  `Resident` arrays in one chain, one group at 12 and two at the default; C2 on a fake adapter
  that allows 8, where the first call rejects and the fake's `requestDevice` runs 0 times; C3
  after a call; C4 with `configure({ runtime })`; a refused first request that a later
  `configure()` and call retry; `callDevice()` on a fake device, and `null` with no
  `navigator.gpu`. A new `src/core/host-entry.test.ts` checks the `requiredLimits` and
  `requiredFeatures` the fake receives.
- **Acceptance.**
  1. On a fake adapter that allows `maxStorageBuffersPerShaderStage` 12, a chain of 10 distinct
     `Resident` arrays, after `configure({ limits: { maxStorageBuffersPerShaderStage: 12 } })`,
     reports one group, and that group is `fused`. Without `configure` the same chain reports two
     groups. The implementation measures both on the fake before acceptance.
  2. The same chain on a real adapter that allows 12 reports one group in the packed journey. Not
     run. The record names the adapter and its limit when it runs.
  3. C2 rejects the first call with the text above, and `requestDevice` runs 0 times.

### Draft impact estimate

| Area              | Expected work                                                                                                                                                                                | Basis and uncertainty                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime           | The selection moved out of `#shape`, the derivation, the request, `rt.limits`, R1 to R6, in four files.                                                                                      | `createRuntime` is 50 lines (463 to 512) and `#shape` 51 (549 to 599) at the baseline. The size of the change is not estimated.                                                                                                                                                                                                                                                                                            |
| Tests and gates   | The recording-device tests, a fake adapter, the journey.                                                                                                                                     | `fakeDevice` exists (`src/runtime/runtime.test.ts` line 47). No test fakes an adapter today: each passes `device`. The harness runs engine journeys already.                                                                                                                                                                                                                                                               |
| Bundle            | `typeshade/runtime` grows by the derivation and the texts.                                                                                                                                   | Measured on 2026-10-13 at `96dbaa9f` with `bun scripts/bundle-boundary.ts`: 29,521 bytes minified and gzipped for the whole of `typeshade/runtime`, the WebGL2 tier included, against a budget of 29,800 in `scripts/bundle-budget.json`. Revision 1 measured 11,700 against 12,900 at `3f6f46b`. The growth is not estimated. It probably passes the 279 bytes of headroom (inference), so decision 7 is likely to apply. |
| Documents         | Rule 11.11, §3, §69, the changelog, `reqs/`, the API surface, `src/AGENTS.md`, and the two sentences that give the runtime's size.                                                           | `bun run docs:impact`, `docs:refs`, `reqs:sync` and `doorstop -C` hold the set.                                                                                                                                                                                                                                                                                                                                            |
| Compatibility     | Additive in the API. A device the runtime requests for `programs` can have limits above the defaults. A pipeline past a limit rejects with a `TypeError` where the baseline gave an `Error`. | Known from `src/runtime/program.ts` lines 629 to 633 and 708 to 712. A host that catches that rejection by its class sees the change. No validation error reaches an error scope or `uncapturederror` for it. `dispatch()` and `draw()` throw a `RangeError` where the baseline left the excess to WebGPU (inference). `createRuntime` refuses only a limit the host names.                                                |
| Measurement       | The limits CI's adapter offers, before the journey's second half is kept (Rule 13.3). It includes the four vertex-stage and fragment-stage storage limits.                                   | Not measured. The journeys run in headless Chromium on SwiftShader (`journeys/README.md`).                                                                                                                                                                                                                                                                                                                                 |
| Dependencies      | None.                                                                                                                                                                                        | Known.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Duration and cost | Unknown. Not estimated.                                                                                                                                                                      | No basis established.                                                                                                                                                                                                                                                                                                                                                                                                      |

### Approval and plan record

- **Decision.** The owner approved the proposal in the project conversation on 2026-10-13
  (Asia/Seoul). The owner decided decisions 1 to 11 and confirmed decisions 12 to 14, and asked
  for the proposal to move to `accepted`. The merge of PR #649 records the acceptance.
- **Approved revision.** Revision 3, with the Decisions section of this acceptance. Git records the
  commit that PR #649 merges.
- **Scope.** Parts 1 to 4 of the runtime and the call layer's device, as written above. The id
  `0051` is final. The section numbers of the surface are the tree's at the baseline, and the
  implementation confirms them.
- **Measurements.** The owner accepted without the limits of CI's adapter (Rule 13.3):
  `maxStorageBuffersPerShaderStage`, `maxStorageBufferBindingSize`, `maxBufferSize` and the four
  vertex-stage and fragment-stage storage limits. The implementation owes that measurement before it
  keeps the journey's second half. The record of the implementation states the numbers.
- **Responsibilities and milestones.** Unassigned. No schedule, owner, duration or cost is
  established.
- **Required validation.** The validation of the configuration record below. None has run.

### Configuration and validation record

This record does not yet apply. Delivery requires the implementing commits with `Change: 0051`.
Functional validation requires `src/runtime/runtime.test.ts` and the journey green on the delivered
revision, and `bun scripts/bundle-boundary.ts` within its budget. Document validation requires
`bun run docs:impact`, `docs:refs`, `reqs:sync` and `doorstop -C` clean after the edits of
Rule 11.11 and of surface §3 and §69. The site's and the editor's pin pull requests, with `0051`
in their `compiler-changes.md`, are tracked separately.

## What it owes downstream

This section describes the expected work. Responsibilities are unassigned. Downstream work is tracked separately after the compiler implementation.

**typeshade.github.io.** Facts, read at the site's `0c56a88` (revision 1 read `79484e3`):

- The runtime paragraph of the WebGPU and WebGL2 concept page (`/guide/concepts/webgpu-and-webgl2/`)
  is in `src/i18n/en.ts` line 1830 and `src/i18n/ko.ts` line 1763. It says the runtime
  "requests a device with the features the programs need". It gains the limits and `rt.limits`
  in one sentence each.
- The page explains Rules 11.10 and 11.11 (`src/lib/design-rules.ts` line 697). `READ_AGAINST`
  pins Rule 11.11's fingerprint at line 767, and `content/guide/ko/rules.json` line 42 pins the
  same one. The edit of Rule 11.11 changes the fingerprint at the pin. `assertRuleReadings` then
  stops the build, and `bun run check:guide` names the ko page. Each page is read again against
  the new rule, and both records take the new fingerprint.
- The API reference is generated from the pinned compiler's source (`src/lib/api.ts`). It lists
  an interface's members with their JSDoc (`membersOf`, line 825). So it lists `limits` in
  `RuntimeOptions` and in `Runtime` with no hand edit. `bun run check:api` checks the data.
- `src/lib/compute-runner.ts` and `src/lib/render-runtime.ts` call `createRuntime` and need no
  change.
- `compiler-changes.md` records `0051` when the pin moves.

**Call layer (revision 2).** The call-layer paragraph of the WebGPU concept page, en and ko, and
surface §64, §65 and §71 in the site copy gain `configure({ limits, features })` and `callDevice()`.
The F5 wording of §71 takes the device's limit from the report. Their tests and copy change in the
same pull request as the pin.

**vscode-typeshade.** The skill's host reference is
`plugins/typeshade/skills/typeshade/references/host.md`, lines 319 to 322, read at the editor's
`bbb2d9e` (revision 1 read `53afb2b`). It says the device is one the runtime "requests with the features `programs` need". It
says a program is refused "for another schema or a feature the device lacks". It gains the
limits, `rt.limits` and the pipeline refusal R4. The webview's `createRuntime({ programs })`
(`packages/vscode-typeshade/src/webview/canvas.ts` line 145) receives the derived limits with no
change. `compiler-changes.md` records `0051` when the pin moves.

**typeshade/radiance**, the engine that asks for this proposal, is not a downstream repository of
`scripts/changes.ts`. Its record 0006 tracks its own work. Its record 0001 plans
`packages/radiance/src/renderers/limits.ts` as a copy of the default limits until the runtime
reports them. When the engine's pin moves past the implementation, `rt.limits` and
`createRuntime({ limits })` take that copy's place.

## Implementation record

This record states what the implementation delivers, on which configuration, and what is open. It
does not change the approved design above. A difference from the approved text is a deviation,
listed below with its disposition.

**Configuration.** Pull request #670 (draft), branch `claude/impl-0051-device-limits`, head
`ff69ed5b` after this record's commits (`62d01326` the limits journey, `6a7930a1` the section 64
sentence and the section 67 revert, `ff69ed5b` the size sentences). `origin/main` is merged in the
branch. This repository is the compiler, so the record names its own head and no pin.

**What was implemented, per section.**

- **Parts 1 to 4 (runtime).** `createRuntime({ limits })` and `RuntimeOptions.limits` (Rule 11.11,
  surface §69). The request merges the derived need of `programs` with `limits` and caps it at the
  adapter (`src/runtime/limits.ts`, `src/runtime/runtime.ts`). `rt.limits` is a frozen copy of the
  device's limits, and empty on the WebGL2 tier (`src/runtime/gl.ts`). Refusals R1 to R7 are in
  `src/runtime/runtime.ts` and `src/runtime/program.ts`. `maxBufferSize` rises with a binding size
  that `limits` names.
- **Call layer (revision 2).** `configure({ limits, features })`, `callDevice()` and
  `DeviceReport` are exported (`src/core/host-entry.ts`, `src/core/resident.ts`,
  `src/core/device-limits.ts`). `settle()` reads the report and not `device.limits`
  (`src/core/fuse-plan.ts`). F5 of the fuse scope reads `maxStorageBuffersPerShaderStage` from the
  report; the refusal names that value.
- **Rule 11.8, 11.11, 11.13.** Rule texts and "Enforced by" lines are updated in `docs/language-design.md`
  and `reqs/rules/` (RULE-1108, RULE-1111, RULE-1113). Rule 11.11's rationale states the measured
  size (see the size item below).
- **Surface.** §3 (the TS8026 sentence names `createRuntime({ programs })`), §64 (the device of a
  `@compute` entry), §65 (the call layer's device), §69 (device, `rt.limits`, the pipeline refusal,
  the `dispatch()` and `draw()` refusals), §71 (F5). Section 67 is not changed (see the open item).
- **Size.** Rule 11.11 and §69 state the measured size of `typeshade/runtime`: 33,355 bytes
  minified and gzipped, from `bun scripts/bundle-boundary.ts`, the WebGL2 tier included. The
  split of the WebGL2 tier is not measured, so the proposal's "15 KB more" is not stated.
- **Journey.** `journeys/limits/` (kind `limits`, see deviation D1).
- **Tests.** `src/runtime/runtime.test.ts`, `src/runtime/limits.test.ts`, `src/core/host-entry.test.ts`,
  `src/fuse.test.ts`, and `src/runtime/limits-layout.test.ts` (added in the verification pass: the
  derived need of each pipeline equals the layout the recording device receives, for the examples
  and for a program that records beside an `_fp64` guard).

**Bundle growth.** `typeshade/runtime` grew from 30,313 bytes (minified and gzipped, the figure
the owner gave for the baseline of this change) to 33,355 bytes over 0051. A verification pass
re-measured `origin/main` at `212d26d2` on 2026-10-13 with Bun 1.4.2: 30,389 bytes, 129 modules, so
the growth of 0051 against that baseline is 2,966 bytes (+9.8%), and 131 modules. The two added
modules are `src/runtime/limits.ts` and `src/core/device-limits.ts`. The bundle pulls in no module
the runtime did not need before. The minified bytes (before gzip) of each changed module, from
Bun's metafile, are below (total +9,875 minified bytes, 91,145 to 101,020).

| Module                       | Baseline | Branch |  Added |
| ---------------------------- | -------: | -----: | -----: |
| `src/runtime/runtime.ts`     |    5,956 |  7,986 | +2,030 |
| `src/runtime/limits.ts`      |        0 |  1,988 | +1,988 |
| `src/core/resident.ts`       |    6,144 |  8,118 | +1,974 |
| `src/runtime/program.ts`     |   13,732 | 15,690 | +1,958 |
| `src/core/host-entry.ts`     |    6,163 |  7,307 | +1,144 |
| `src/core/device-limits.ts`  |        0 |    722 |   +722 |
| `src/runtime/gl.ts` and rest |        - |      - |    +59 |

Each added byte is a part of 0051: the request and the checks R1 to R3 and R7 (`runtime.ts`), the
derivation (`limits.ts`), `configure({ limits, features })` with C1, C3 and C4 (`resident.ts`),
R4 to R6 (`program.ts`), the request and report of the call layer (`host-entry.ts`) and the value
rules (`device-limits.ts`). The refusal texts are a large part of it. No import can be removed:
`resident.ts` and `host-entry.ts` were in the closure at the baseline, since `typeshade/runtime`
exports `configure` and `resident`. The budget in `scripts/bundle-budget.json` was 30,450 on
`origin/main` (61 bytes over its 30,389) and is 33,413 on this branch (58 bytes over 33,355),
raised in this pull request under decision 7. The verification pass keeps the budget.

**Deviations.**

| ID  | Deviation from the approved text                                                                                                                                                      | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | The proposal calls the journey an engine run. It is a `limits` host, because the engine kind hands the module its device and forbids `navigator.gpu`, which the requested half needs. | Closed, implementation choice within 0051, verified 2026-10-13. The journey keeps what the proposal asks: public exports alone (the harness refuses any other import and any WebGPU call in the host), R4 on the default device, then the entry on the requested device. The run kind and the edits to `journeys/_harness.mjs` and `journeys/README.md` serve that. The result is held to the exact sums, not to the oracle.                |
| D2  | C2 wording: the refusal text of the call layer's first request differs from the proposal's wording.                                                                                   | Closed, implementation choice within 0051, verified 2026-10-13. The limit and feature texts equal the proposal's C2 texts (tests in `src/core/host-entry.test.ts`). The only additions are the "down to" form for an alignment limit, which R2 states, and one text for a name the adapter does not report.                                                                                                                                 |
| D3  | C3 and C4 feature texts differ from the proposal's wording.                                                                                                                           | Closed, implementation choice within 0051, verified 2026-10-13. The proposal gives C3 and C4 for `limits` only. The feature texts follow the same shape, in the same class (`TypeError`).                                                                                                                                                                                                                                                   |
| D4  | No cache of a null device: `callDevice()` and `gpuDevice()` do not cache a `null` result.                                                                                             | Open for the owner. This is a change of behaviour. At `origin/main` a `null` result stays cached for the page's life. Now a call on a page whose `navigator.gpu` gives no adapter asks `requestAdapter()` again at each call. The proposal states the retry for a refused request (decision 10) and says nothing of a `null` result. Next action: the owner accepts it, or the implementation caches `null` and `deviceFixed()` ignores it. |
| D5  | Same-value `configure()` is allowed: a second `configure({ limits })` with the same values does not refuse.                                                                           | Closed, no deviation, verified 2026-10-13. C3 says "with a different value" throws, so a same value is what the proposal asks.                                                                                                                                                                                                                                                                                                              |
| D6  | The helpers moved to `src/core/device-limits.ts`, not into the runtime's files.                                                                                                       | Closed, implementation choice within 0051, verified 2026-10-13. `typeshade/fuse` and `typeshade/emit` reach `src/core/` and not `src/runtime/` (`scripts/bundle-boundary.ts`), and `host-entry.ts` and `resident.ts` need the helpers. `src/runtime/limits.ts` re-exports them. The runtime bundle includes them (722 minified bytes).                                                                                                      |
| D7  | The surface §64 sentence on the device of a `@compute` entry is an addition the proposal names. Its wording is the implementer's.                                                     | Closed, implementation choice within 0051, verified 2026-10-13. §64 is in the proposal's front matter and "What it touches". The sentence says what the proposal says of §64 and §65. `scripts/changes.ts` passes.                                                                                                                                                                                                                          |
| D8  | The surface snapshot renders the device's `limits` as `\| null` where the proposal's text has none.                                                                                   | Closed, implementation choice within 0051, verified 2026-10-13. The description is stale. The baked snapshot has no `\| null` on a limit. It renders `callDevice` as `() => Promise<DeviceReport>` because the generator drops `null` from every type: `main` renders `configure`'s `runtime` without its `\| null` too. No change.                                                                                                         |
| D9  | The surface §67 entry and draw sentence is not declared by 0051, so it is not in the approved text.                                                                                   | Open: amendment of 0051 owed. See the open item.                                                                                                                                                                                                                                                                                                                                                                                            |

**Open item O1 (amendment owed).** Surface §67 needs the sentence on the call layer's device for
entries and draws. The sentence, as written in the implementation of revision 2, is:
"Where it runs. On WebGPU where there is a device: the device of the runtime `configure({ runtime })`
names (§69), or else one the call requests on first use, with the limits and features
`configure({ limits, features })` names; `callDevice()` reports that device's limits and features
(change 0051)." The coordinator amends 0051 to declare §67. Until then §67 stays as on `main`.

**Checks (2026-10-13).**

| Check      | Command                                                                                                                  | Result                                                                                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build      | `bun run build`                                                                                                          | exit 0                                                                                                                                                                                                                                               |
| Lint       | `bun run lint`                                                                                                           | exit 0                                                                                                                                                                                                                                               |
| Format     | `bun run format:check`                                                                                                   | exit 0                                                                                                                                                                                                                                               |
| Changes    | `bun scripts/changes.ts --base origin/main`                                                                              | exit 0; §64 is declared and done; O1 is the open item                                                                                                                                                                                                |
| Doc refs   | `bun run docs:refs`                                                                                                      | 0 dead references                                                                                                                                                                                                                                    |
| Doc impact | `bun run docs:impact`                                                                                                    | read: the live items name the size sentences and the record, all true; the historical `changes/` items are not live documents                                                                                                                        |
| Boundary   | `bun scripts/bundle-boundary.ts`                                                                                         | exit 0; runtime 33,355 bytes within budget 33,413                                                                                                                                                                                                    |
| Reqs       | `bun run reqs:sync`, `python scripts/doorstop-check.py -C -e -F`                                                         | RULE-1111 reviewed, SURF-069 cleared; exit 0                                                                                                                                                                                                         |
| Tests      | `npx vitest run` on runtime.test.ts, limits.test.ts, host-entry.test.ts, fuse.test.ts, reqs.test.ts, api-surface.test.ts | 198, 8, 14, 177, 10, 12 tests passed, exit 0 each                                                                                                                                                                                                    |
| Journeys   | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers bun run gate:journeys`                                                        | 27 journeys, 59 runs, every check passed; `limits#0`: the default device has 8 storage buffers per stage and refuses the entry by name (R4); the SwiftShader adapter has 10 and runs the nine-buffer entry on the requested device, 256 values exact |

**Not run.** Real-adapter acceptance (acceptance item 2 of the call layer, a real adapter that allows
12 storage buffers per stage, and the proposal's "measurement" of CI's adapter limits). The SwiftShader
adapter allows 10, so the packed journey's 12-buffer case is not exercised. `gate:compile` is listed
under the final checks of this change (see the report of this pull request).

**Verification pass (2026-10-13).** An independent agent read the delivered code against parts 1 to
4, the call layer's steps 1 to 5, the derivation table, R1 to R7, C1 to C4 and F5. It found no
defect in the behaviour. It found two gaps in the record, and closed them:

- The proposal owes a test that holds the derived need of each pipeline to the layout the runtime
  makes, for every example. It was missing. `src/runtime/limits-layout.test.ts` adds it, with a
  floor on what it compares, for the examples' manifests and for a program that records beside an
  `_fp64` guard (its recorded variant, and the one the emitter makes from its IR). Changing the
  derivation's `maxBindingsPerBindGroup` by one makes it fail.
- `journeys/limits/journey.mjs` said the gate's adapter allows eight storage buffers per stage.
  The measured number is ten (see the Journeys row above). The comment says so.

The bundle finding and the dispositions of D1 to D8 are above. `docs:impact` was read in full
(every item outside `changes/`): the live documents it lists stay true, and
`docs/webgpu-runtime-survey.md` line 249 ("When 0051 lands") is left as it is. A wording that is
true both before and after this pull request merges is not possible, and the line reads as the
guidance for the time after the merge.
