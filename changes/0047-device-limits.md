---
id: '0047'
title: A host's runtime requests the limits its programs need, reports the device's limits, and refuses a pipeline past a limit by name
status: draft
rules:
  - '11.11'
surface:
  - 3
  - 69
exports:
  - Runtime
  - RuntimeOptions
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The runtime paragraph of the WebGPU concept page, en and ko, says the runtime requests the features the programs need. It gains the limits and rt.limits. The page explains Rule 11.11. When the pin moves, the edit of that rule makes the site's rule checks name the page in en and ko. READ_AGAINST in src/lib/design-rules.ts and content/guide/ko/rules.json then take the rule's new fingerprint, after each page is read again. The API reference is generated from the pinned compiler's source and lists the new limits fields with no hand edit. compiler-changes.md records 0047 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's references/host.md says the runtime requests the features programs need, and that a program is refused for a feature the device lacks. It gains the limits, rt.limits and the pipeline refusal. compiler-changes.md records 0047 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names files it will add and files in downstream repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0047`, `status: draft`. The front matter is the lifecycle authority. On 2026-10-05 at 16:53 UTC the remote's `main` held proposals up to `0043`, and pull requests #482, #483 and #486 held `0044` to `0046`. The four drafts of record 0006 take `0047` to `0050` in item order. This draft is item 1.                             |
| Date and attribution          | Written 2026-10-05 (UTC). The date is the authoring context, not an approval. A coding agent drafted it in a Claude Code session, at the owner's direction, for the engine typeshade/radiance. The source is item 1 of the engine's design record 0006 (`docs/design/0006-compiler-boundary.md`, accepted 2026-10-05, radiance `main` at `0bd1be8`). |
| Applicability / Effectivity   | The program runtime, `typeshade/runtime` (`src/runtime/runtime.ts`, `src/runtime/program.ts`, `src/runtime/gpu.ts` and a new `src/runtime/limits.ts`). Rule 11.11, surface §3 and §69. The site and the editor. Release version unassigned.                                                                                                          |
| Review baseline               | `origin/main` at `3f6f46b0c97b9761a4cb1d6975cf16685e7f355b`. The engine read its evidence at `e923a34`. Every line of this tree that the proposal cites was read again at the baseline. The remote's `main` moved to `2b4f3a98f626a4e4c63bd29cfecd90f7ef017592` on 2026-10-05. That commit changes `AUTHORING.md` alone, so no cited line moved.     |
| Review and revision authority | No pull request is assigned yet. Git records revisions. The pull request's review and merge record the decision.                                                                                                                                                                                                                                     |

## What changes

The program runtime (Rule 11.11) gains WebGPU's device limits. The proposal has four parts. Part 4
is an open decision (decision 3 under "Why"):

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

The design extends change 0025, section 2 ("The device"). That text says that the runtime "requests
a device with the features and limits the programs in `programs` need". Rule 11.11 and
`createRuntime` delivered the features alone. This proposal states the limits half as rule text,
with its API, its refusals and its tests.

### Before and after

| At the baseline (`3f6f46b`)                                                                                                                                                                                                          | After this proposal                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| With no `device`, `createRuntime()` requests the features `programs` need and no limit (`src/runtime/runtime.ts` line 436).                                                                                                          | It requests the features and the limits `programs` need, and the limits `createRuntime({ limits })` names.                                                                                        |
| A host cannot name a limit. A device the runtime requests has WebGPU's default limits.                                                                                                                                               | `RuntimeOptions.limits` names limits by their WebGPU names. The runtime checks each against the adapter before it requests the device.                                                            |
| The runtime reports no limit. `rt.device` is typed `D`, which is `object` unless the host names a type. So a host reads `rt.device.limits` only with WebGPU's own types.                                                             | `rt.limits` reports the device's limits, for the host's device and for one the runtime requested.                                                                                                 |
| A pipeline past a limit reaches WebGPU, which refuses it. The runtime rethrows the rejection as an `Error`. It names the entry, its line and WebGPU's message (`src/runtime/program.ts` lines 459 to 466 and 536 to 542).            | `program.compute()` and `program.render()` reject with a `TypeError` before the runtime calls WebGPU. The text names the entry, its line, the limit and both numbers in the runtime's words (R4). |
| A binding past `maxStorageBufferBindingSize`, or a buffer past `maxBufferSize`, is left to WebGPU's validation. For a call that records into a frame, that frame's `submit()` rejects with `The frame did not validate` (inference). | `dispatch()` and `draw()` throw a `RangeError` that names the entry, its line, the binding, its size and the limit (part 4).                                                                      |

The drafting agent read row 4's left column in `src/runtime/program.ts` at the baseline, and the
refusal itself in the WebGPU spec. `at()` (line 155) writes the line. WebGPU's message is the
browser's own text. The spec calls it a human-readable, localizable text and fixes no wording. So
whether it names the limit and the numbers depends on the browser. Inference from the spec: the
layouts `#shape` makes (`src/runtime/program.ts` lines 394 and 401) fail validation before the
pipeline does. That error goes to the error scope open at that time, or to the device's
`uncapturederror` event.

So part 3 changes three things for a host:

- The class of the rejection changes from `Error` to `TypeError` (decision 2).
- The check comes before WebGPU. The runtime makes no layout that fails validation, so no
  validation error reaches an error scope or `uncapturederror` for it.
- The text names the limit and both numbers, whatever the browser's message says.

Row 5's left column is an inference from `src/runtime/program.ts` and `src/runtime/runtime.ts`
(lines 327 and 393 to 397, the frame's error scope). The drafting agent measured neither row on a
device.

### The API

`RuntimeOptions` and `Runtime` each gain one field. Every other field stays as it is.

```ts
/** How `createRuntime()` makes a runtime. */
export interface RuntimeOptions<D extends object = object> {
  /** The host's `GPUDevice`, which the runtime uses and never destroys. Omitted: the runtime
   *  requests one, with the features and the limits `programs` need and the limits `limits`
   *  names. */
  readonly device?: D;
  /** The programs the requested device must be able to run. */
  readonly programs?: readonly Pack[];
  /** WebGPU limits the device must have, by their names in `GPUSupportedLimits`:
   *  `{ maxStorageBufferBindingSize: 1 << 30 }`. Without `device`, the runtime requests each,
   *  with the limits `programs` need, and the larger of the two where both name one. A binding
   *  size named here raises `maxBufferSize` with it, up to the adapter's. With `device`, the
   *  runtime checks the device against each. Omitted: none. */
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
   *  made. Frozen. */
  readonly limits: Readonly<Record<string, number>>;
  // load, texture, sampler, frame, submit and destroy as at the baseline
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
fakes an adapter with no `limits` (typeshade.github.io `79484e3`, lines 145 to 152). That test
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
| `maxComputeWorkgroupSizeX`, `maxComputeWorkgroupSizeY`, `maxComputeWorkgroupSizeZ` | A compute entry's `workgroupSize`, axis by axis.                                                                                                        |
| `maxComputeInvocationsPerWorkgroup`                                                | The product of the three extents.                                                                                                                       |

The runtime counts per stage because its pipeline layout makes each binding visible to the stages
whose entries reach it (`#shape` in `src/runtime/program.ts`, line 354). So a stage's count in a
pipeline is its own entry's count. A render pipeline needs, limit by limit, the larger of its
vertex entry's need and its fragment entry's need.

The console pass puts `_console` in group 0, one past the group's highest binding. The `_fp64`
guard goes one past `_console` (`src/core/passes/console-buffer.ts` lines 471 to 474).

**A program that can record.** A program records when it is loaded with its recorded variant.
That is the default when its manifest carries `console` (§69). A host can also call
`load(m, { console: true })` for a manifest with no `console`. The runtime then emits the variant
with `createRuntime({ emit })`, from the manifest's `ir` (`src/runtime/runtime.ts` lines 197 to
207). So a program can record when its manifest carries `console`. It can also record when its
manifest carries `ir` and the host passes `emit`. The derivation counts `_console` for each such
program. The pipeline check counts `_console` when the loaded program records, and R4 then names
the console buffer.

Inference: for a host that never records, this count can request one storage buffer more than its
pipelines bind. The request stays capped at the adapter's value, so it refuses nothing.

**One authority.** One function computes the need. The implementation first moves the selection
of bindings out of `#shape` (`src/runtime/program.ts` lines 355 to 370) into a pure function in
`src/runtime/limits.ts`. That step is necessary because `#shape` is private and makes GPU objects.
It reads the program's bindings and its log, so `createRuntime` cannot call it on a bare manifest.
The pure function takes the entries, the binding of each name and whether the program can record.
It returns each binding with the stages that reach it. It adds `_console` by the recorder rule of
`#shape` (line 365). `#shape`, the derivation and the pipeline check all call it. So the pipeline
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
  takes at most one vertex buffer (`src/runtime/program.ts` lines 500 to 512). A draw also counts
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
   lines 427 to 435).
2. It checks each entry of `limits` (refusal R1). The value must be a whole number of 0 or more.
   An alignment limit's value must be a power of 2 below 2³². `maxStorageBufferBindingSize`,
   `maxVertexBufferArrayStride` and `maxImmediateSize` take a multiple of 4. The name must be one
   the adapter's `limits` reports.
3. It checks each value `limits` names against the adapter's, and refuses one the adapter cannot
   give (R2). The refusal comes before `requestDevice`.
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
entries and compare it with `rt.limits`. They check every derived limit of the table above. The
check runs before `#shape` makes a layout (`src/runtime/program.ts` lines 449 and 488). A need
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
    (`src/runtime/program.ts` line 689).
  - A plain value in a uniform binding: the whole buffer the pool takes. That is the packed bytes
    rounded up to 16 (lines 687 to 688, and `BufferPool.take` at line 249).
  - A `Resident`: the bytes of its host value, the size of the buffer `storageBuffer` makes
    (`src/core/host-entry.ts` line 605).
  - The host's own `GPUBuffer`: its `size`.
- **A buffer the runtime makes.** The runtime makes the buffer of a plain value through
  `BufferPool.take` (`src/runtime/program.ts` lines 248 to 251 and line 685). It makes a
  `Resident`'s buffer through `bufferFor` (line 631). Each of these is also held to
  `maxBufferSize`. For a plain value, the size is the packed bytes rounded up to 16, as
  `BufferPool.take` rounds them.
- **A dispatch's workgroups.** Each of `x`, `y` and `z` is held to
  `maxComputeWorkgroupsPerDimension`.

Each excess is a `RangeError` (R5, R6), thrown at the call, as the binding refusals of Rule 11.11
are thrown today. R5 names the first limit the size passes: the binding's limit, then
`maxBufferSize`.

**The order.** At the baseline `dispatch()` and `draw()` take the console buffer before they walk
the bindings (`src/runtime/program.ts` lines 738 to 741 and 784 to 787). `rt.consoleBuffer()`
adds a row that the next `submit()` reads back (`src/runtime/runtime.ts` line 265). So the
checks run in a pass of their own, before that call. The pass computes each size and makes no
buffer. A refused call then takes no console buffer and leaves no row. The pass leaves a value it
cannot size, such as one that does not fit its layout, to the binding walk. The walk refuses it
as at the baseline.

Inference from the same lines: at the baseline a binding refusal of Rule 11.11 comes after the
console buffer, so it leaves a row. That is a separate fix, not part of this proposal.

**What part 4 does not check.** WebGPU's validation reports each excess below, as at the
baseline:

- A vertex or index array the runtime uploads (`#upload`, line 813).
- The console buffer. Its size is `RuntimeOptions.consoleBytes`, 1 MiB by default
  (`src/runtime/runtime.ts` lines 148 and 174). The pool takes it at that size, rounded up to 16
  (line 262), and the runtime binds it whole as storage (`src/runtime/program.ts` line 613).

With part 4, a host need not keep its own copy of these limits. The engine's record 0001 plans
such a copy, `packages/radiance/src/renderers/limits.ts` in typeshade/radiance (section
"Limits"). At radiance `0bd1be8` the file does not exist yet.

### The refusals

Each text below is the one the implementation writes, with example values. `(trace.shade.ts:12)`
is the entry's line, written as the runtime's other refusals write it (`at()` in
`src/runtime/program.ts`).

| Id  | Where                                       | Class        | Text                                                                                                                                                                                                                            |
| --- | ------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `createRuntime`, a name or a value          | `TypeError`  | `createRuntime({ limits }): "maxStorageBufferz" is not a limit this adapter reports.` With `device`, "this device reports". For a value, `createRuntime({ limits }): maxBufferSize takes a whole number of 0 or more; got 1.5.` |
| R2  | `createRuntime`, a named limit, no `device` | `Error`      | `The adapter supports maxStorageBufferBindingSize up to 134217728; createRuntime({ limits }) asks for 536870912.` For an alignment limit, "down to".                                                                            |
| R3  | `createRuntime`, a named limit, `device`    | `TypeError`  | `The device has maxStorageBufferBindingSize 134217728; createRuntime({ limits }) asks for 536870912. Request the limit in requestDevice({ requiredLimits }) for this device, or omit device so the runtime requests it.`        |
| R4  | `compute()` or `render()` rejects           | `TypeError`  | `The entry "trace" (trace.shade.ts:12) needs maxStorageBuffersPerShaderStage 9; this device has 8. Pass the program in createRuntime({ programs }), or raise the limit with createRuntime({ limits }).`                         |
| R5  | `dispatch()` or `draw()` throws             | `RangeError` | `"trace" (trace.shade.ts:12), binding "nodes" (array<vec4<f32>>) is 201326592 bytes; this device binds at most 134217728 bytes in one storage binding (maxStorageBufferBindingSize).`                                           |
| R6  | `dispatch()` throws                         | `RangeError` | `"trace" (trace.shade.ts:12): 70000 workgroups in x; this device dispatches at most 65535 in one dimension (maxComputeWorkgroupsPerDimension).`                                                                                 |

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
- **WebGPU, through the call layer (§64, §65 and §67).** The call layer runs on the device of the
  runtime `configure({ runtime })` names. With no such runtime, it runs on the device `gpuDevice()`
  requests with no descriptor (`src/core/host-entry.ts` line 665). This proposal changes neither.
  A host that needs a raised limit for a call passes
  `configure({ runtime: await createRuntime({ limits }) })`. The call layer's WebGPU tier gains no
  limit check here, and Rule 11.8 stays as it is (decision 4).
- **WebGL2.** WebGPU's limits do not apply to it. The program runtime has no WebGL2 tier (§69). The
  call layer's WebGL2 tier stays as it is.
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
  `src/compiler/ts/lower/function.ts`, line 3364).
- `TS8071` warns that the WGSL records no console call in a stage that already binds eight
  storage buffers (`DEFAULT_STORAGE_BUFFERS_PER_STAGE` in `src/core/passes/console-buffer.ts`,
  line 47).

A compile does not know the device, so both keep the defaults. Rule 8.7's rationale already says
that "a device requested with raised limits runs a larger workgroup". Surface §3's `TS8026` bullet
gains one sentence: `createRuntime({ programs })` requests that limit, where the adapter supports
it (§69).

### Exclusions

- No change to the call layer's device or to Rule 11.8.
- No change to `TS8071`'s eight bindings. That is record 0006 item 9 (below).
- No manifest field and no schema change.
- No check of a texture's size in `rt.texture()`. A texture write is record 0006 item 4, a
  proposal of its own.
- No check of a vertex or index array the runtime uploads, and no check of the console buffer's
  size (part 4).
- No request of the vertex-stage or fragment-stage storage limits, or of
  `maxBindGroupsPlusVertexBuffers` (the derivation, above).
- No request of the adapter's limits as a whole (alternatives, below).
- No new dependency and no new export.

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
  radiance `0bd1be8` the file does not exist yet.

The runtime cannot raise either today. Record 0006 names two consumers: record 0001's headroom at
M3, where reserved fields fill, and M3v. M3v adds volume rendering over dense grids of 128³ to
256³ cells (the engine's `docs/plan.md` §3.4). Inference: one 256³ grid of `vec4<f32>` is
268,435,456 bytes. That is twice the default binding size and equal to the default
`maxBufferSize`. So a larger grid needs both limits raised.

### Evidence at the baseline

Facts, read at `3f6f46b`. The engine read the same lines at `e923a34`, and none moved:

- `src/runtime/runtime.ts` line 436 calls `requestDevice({ requiredFeatures: [...wanted] })` on
  the adapter. It passes no `requiredLimits`.
- `RuntimeOptions` (lines 41 to 62) has no `limits`, and `Runtime` (lines 132 to 146) reports
  none.
- `src/runtime/gpu.ts` declares `features` on `Device` and on `Adapter`, and no `limits`.
- `RuntimeImpl.load` (lines 192 to 196) refuses a feature the device lacks. The runtime checks
  no limit itself.
- When WebGPU refuses a pipeline, the runtime rethrows the rejection as an `Error`. It names the
  entry, its line and WebGPU's message (`src/runtime/program.ts` lines 459 to 466 and 536 to 542).
- `src/core/passes/console-buffer.ts` line 47 holds `DEFAULT_STORAGE_BUFFERS_PER_STAGE = 8`.
  `consoleBuffer` reads it at line 312 for `TS8071`.

Observed result, from a probe run on 2026-10-05 at the baseline with bun 1.3.14. The probe made a
recording device in the shape of `fakeDevice` in `src/runtime/runtime.test.ts`. Its program had
two compute entries: `wide` binds eight storage buffers and makes no console call, and `logs` calls
`console.log`. The probe packed it with `console: true` and called `program.compute('wide')`. The
layout held nine storage buffers visible to the compute stage. The reason is in `#shape`
(`src/runtime/program.ts` line 365): a program that records adds `_console` to the first compute or
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

### Unresolved decisions

1. The value type: `Readonly<Record<string, number>>`, with no new export, or a named type that
   lists the limits, as a new export of `typeshade/runtime`. Proposed: the record.
2. The error classes: `Error` for an adapter that cannot give a limit, and `TypeError` for a
   pipeline past the device. A value past a limit is a `RangeError`. At the baseline the rejection
   of such a pipeline is an `Error` (`src/runtime/program.ts` lines 459 to 466). The other choice
   keeps that class for R4. Proposed: as listed.
3. Whether part 4, the value checks, ships with this proposal or with a later one. Proposed: with
   this one.
4. Whether the call layer's WebGPU tier checks the limits and gives way to the next tier, with the
   limit as its reason (Rule 11.8). Proposed: a later proposal.
5. When the runtime refuses a program's need. Proposed: at the pipeline (R4) alone. The other
   choice also refuses at `createRuntime`. There a need past the adapter is an `Error`, as a
   missing feature is, and a need past a host's `device` is a `TypeError`.
6. Whether change 0025's record notes the limits half of its section 2 as a deviation that this
   proposal closes. Proposed: yes, in the pull request that accepts this proposal.
7. The bundle budget of `typeshade/runtime`, if the implementation passes it (impact estimate,
   below).
8. Whether a binding size the host names raises `maxBufferSize` (step 7), or the host names
   `maxBufferSize` itself. Proposed: the raise, with R5 for a buffer past it.

## What it touches

- **Rule 11.11.** Its first sentence gains the limits. The runtime requests a device with the
  features and the limits the programs need, and the limits `createRuntime({ limits })` names.
  New text adds `rt.limits`, the derived limits of the table above, the raise of `maxBufferSize`
  and the refusals R1 to R6. Its "Derives from" line gains change 0047, and its "Enforced by"
  line the tests below.
- **Surface §3.** The `TS8026` bullet gains one sentence that names `createRuntime({ programs })`.
- **Surface §69.** The device bullet gains the limits and `rt.limits`. A new bullet holds the
  table of derived limits and the refusals. The program bullet gains the pipeline refusal.
- **`RuntimeOptions`** gains `limits`. **`Runtime`** gains `limits`. `createRuntime`'s signature
  does not change.
- **Code.** `src/runtime/limits.ts` (new) holds the selection of bindings moved out of `#shape`,
  the need of an entry and the copy of a device's limits. `src/runtime/runtime.ts` holds the
  request, the checks R1 to R3 and `rt.limits`. In `src/runtime/program.ts`, `#shape` calls the
  selection, and `#compute` and `#render` run R4 before `#shape`. `dispatch()` and `draw()` run
  R5 and R6 in a pass before they take the console buffer. `src/runtime/gpu.ts` declares `limits`
  on `Device` and on `Adapter`.
- **Tests.** `src/runtime/runtime.test.ts`, against the recording device and a fake adapter on
  `globalThis.navigator.gpu`:
  - The `requiredLimits` that `createRuntime({ programs })` passes for an entry of nine storage
    buffers.
  - The merge with `limits`: the larger value kept, and a derived need capped at the adapter's.
  - `maxBufferSize` raised with a binding size `limits` names, and capped at the adapter's.
  - Each refusal's text, R1 to R6, and each variant.
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
  - `src/AGENTS.md`'s `runtime/` row (line 33) lists the runtime's files, and gains `limits.ts`.
  - Surface §69 and Rule 11.11's rationale say the runtime is about 11 KB gzipped
    (`docs/use-typeshade-surface.md` line 7734, `docs/language-design.md` line 1232). Both follow
    the size the implementation measures. The headroom at the baseline is 1,200 bytes (decision 7).
  - `reqs/` follows the edits of Rule 11.11 and of surface §3 and §69 (`RULE-1111`, `SURF-003`
    and `SURF-069`), through `bun run reqs:sync` and `doorstop -C`.
  - `scripts/bundle-budget.json` changes only by decision 7.
- No diagnostic code and no example changes.

### Draft impact estimate

| Area              | Expected work                                                                                                                                                                                | Basis and uncertainty                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime           | The selection moved out of `#shape`, the derivation, the request, `rt.limits`, R1 to R6, in four files.                                                                                      | `createRuntime` is 21 lines (418 to 438) and `#shape` 51 (354 to 404) at the baseline. The size of the change is not estimated.                                                                                                                                                                                                                                             |
| Tests and gates   | The recording-device tests, a fake adapter, the journey.                                                                                                                                     | `fakeDevice` exists (`src/runtime/runtime.test.ts` line 47). No test fakes an adapter today: each passes `device`. The harness runs engine journeys already.                                                                                                                                                                                                                |
| Bundle            | `typeshade/runtime` grows by the derivation and the texts.                                                                                                                                   | Measured on 2026-10-05 at the baseline with `bun scripts/bundle-boundary.ts`, bun 1.3.14: 11,700 bytes gzipped, against a budget of 12,900. The growth is not estimated.                                                                                                                                                                                                    |
| Documents         | Rule 11.11, §3, §69, the changelog, `reqs/`, the API surface, `src/AGENTS.md`, and the two sentences that give the runtime's size.                                                           | `bun run docs:impact`, `docs:refs`, `reqs:sync` and `doorstop -C` hold the set.                                                                                                                                                                                                                                                                                             |
| Compatibility     | Additive in the API. A device the runtime requests for `programs` can have limits above the defaults. A pipeline past a limit rejects with a `TypeError` where the baseline gave an `Error`. | Known from `src/runtime/program.ts` lines 459 to 466 and 536 to 542. A host that catches that rejection by its class sees the change. No validation error reaches an error scope or `uncapturederror` for it. `dispatch()` and `draw()` throw a `RangeError` where the baseline left the excess to WebGPU (inference). `createRuntime` refuses only a limit the host names. |
| Measurement       | The limits CI's adapter offers, before the journey's second half is kept (Rule 13.3). It includes the four vertex-stage and fragment-stage storage limits.                                   | Not measured. The journeys run in headless Chromium on SwiftShader (`journeys/README.md`).                                                                                                                                                                                                                                                                                  |
| Dependencies      | None.                                                                                                                                                                                        | Known.                                                                                                                                                                                                                                                                                                                                                                      |
| Duration and cost | Unknown. Not estimated.                                                                                                                                                                      | No basis established.                                                                                                                                                                                                                                                                                                                                                       |

### Approval and plan record

This record does not yet apply. Acceptance requires the owner's answers to the eight unresolved
decisions, recorded in this file. It requires the actual decision and its pull request reference,
and the approved revision of this file. It requires the measured limits of CI's adapter (Rule
13.3). They are `maxStorageBuffersPerShaderStage`, `maxStorageBufferBindingSize`, `maxBufferSize`
and the four vertex-stage and fragment-stage storage limits. It requires the finalized surface
sections: the numbers above are the tree's at the baseline. It requires the final id, assigned
with the other record 0006 drafts (Identity and status). This draft assigns no responsibility,
milestone, duration or cost.

### Configuration and validation record

This record does not yet apply. Delivery requires the implementing commits with `Change: 0047`.
Functional validation requires `src/runtime/runtime.test.ts` and the journey green on the delivered
revision, and `bun scripts/bundle-boundary.ts` within its budget. Document validation requires
`bun run docs:impact`, `docs:refs`, `reqs:sync` and `doorstop -C` clean after the edits of
Rule 11.11 and of surface §3 and §69. The site's and the editor's pin pull requests, with `0047`
in their `compiler-changes.md`, are tracked separately.

## What it owes downstream

This draft describes the expected work. Acceptance records the agreed responsibilities.

**typeshade.github.io.** Facts, read at the site's `79484e3`:

- The runtime paragraph of the WebGPU concept page is `ConceptsWebgpuPage`, from
  `src/i18n/en.ts` line 1688 and `src/i18n/ko.ts` line 1645. It says the runtime "requests a
  device with the features the programs need". It gains the limits and `rt.limits` in one
  sentence each.
- The page explains Rules 11.10 and 11.11 (`src/lib/design-rules.ts` line 696). `READ_AGAINST`
  pins Rule 11.11's fingerprint at line 761, and `content/guide/ko/rules.json` line 42 pins the
  same one. The edit of Rule 11.11 changes the fingerprint at the pin. `assertRuleReadings` then
  stops the build, and `bun run check:guide` names the ko page. Each page is read again against
  the new rule, and both records take the new fingerprint.
- The API reference is generated from the pinned compiler's source (`src/lib/api.ts`). It lists
  an interface's members with their JSDoc (`membersOf`, line 800). So it lists `limits` in
  `RuntimeOptions` and in `Runtime` with no hand edit. `bun run check:api` checks the data.
- `src/lib/compute-runner.ts` and `src/lib/render-runtime.ts` call `createRuntime` and need no
  change.
- `compiler-changes.md` records `0047` when the pin moves.

**vscode-typeshade.** The skill's host reference is
`plugins/typeshade/skills/typeshade/references/host.md`, lines 126 to 130, read at the editor's
`53afb2b`. It says the device is one the runtime "requests with the features `programs` need". It
says a program is refused "for another schema or a feature the device lacks". It gains the
limits, `rt.limits` and the pipeline refusal R4. The webview's `createRuntime({ programs })`
(`packages/vscode-typeshade/src/webview/canvas.ts` line 145) receives the derived limits with no
change. `compiler-changes.md` records `0047` when the pin moves.

**typeshade/radiance**, the engine that asks for this proposal, is not a downstream repository of
`scripts/changes.ts`. Its record 0006 tracks its own work. Its record 0001 plans
`packages/radiance/src/renderers/limits.ts` as a copy of the default limits until the runtime
reports them. When the engine's pin moves past the implementation, `rt.limits` and
`createRuntime({ limits })` take that copy's place.
