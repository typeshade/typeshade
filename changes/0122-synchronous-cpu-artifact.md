---
id: '0122'
title: Emit a synchronous CPU kernel artifact for preallocated host buffers
status: draft
rules:
  - '8.21'
  - '11.7'
  - '11.8'
surface:
  - 65
exports:
  - emitCpuKernel
  - CpuKernelArtifact
  - CpuKernelOptions
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeaudio
    what: Replace the private graph code-generator adapter, preserve shared reproduction fixtures, record 0122 in compiler-changes.md when the compiler pin advances, and verify immediate output and state continuity.
  - repo: typeshade.github.io
    what: Update the imported host-kernel reference in typeshade/web and retire the TypeAudio studio's build-only CPU adapter after its engine adapter adopts this contract.
  - repo: vscode-typeshade
    what: Document the explicit synchronous CPU artifact separately from asynchronous host kernel calls and verify completion and hover for its public exports.
---

<!-- doc-refs: skip-file — this draft names public exports and tests that do not exist before acceptance -->

**Document control**

| Field                         | Record                                                                                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0122, draft. Front matter is the lifecycle authority.                                                                                                       |
| Date and attribution          | Authored 2026-11-06 UTC by Codex at the owner's direction to connect Web, TypeAudio and TypeShade feedback. This date records authorship, not acceptance.            |
| Applicability                 | Source compilation, CPU code generation and generated-module loading. No release version is assigned.                                                                |
| Review baseline               | TypeShade `324251dfe7755f78041eb44a1bfe85e4294e12dd`; TypeAudio baseline `575b42baa13ee666cc050b25da1e63720dfbf6e4`; Web `769f3e7818329e1cc936048afb56e8724f34a9d3`. |
| Review and revision authority | No PR is assigned yet. Git records revisions; PR review and merge evidence record acceptance.                                                                        |

## What changes

This proposal adds an explicit artifact emitter at the package root. It does not change the queue semantics of existing host calls.

`emitCpuKernel(module, { entry })` would return a `CpuKernelArtifact`. `CpuKernelOptions` names one exported kernel function.
The artifact would contain ESM source, its exported function name, and the scalar/typed-array parameter signature.
Its generated function would operate directly on caller-owned buffers and return `void` before the caller reads those buffers.
The emitter would reject unsupported programs before returning an artifact, with the offending function and source location where available.
No new numbered diagnostic is proposed. Existing compilation diagnostics remain the first gate.

The first contract accepts scalar arithmetic, scalar locals, control flow and arrays of `f32`, `i32` and `u32`.
It accepts one leaf kernel; calls to supported scalar builtins remain permitted.
It refuses a generator fallback, nested user-function calls, object/vector/matrix construction, array construction, textures, barriers and device resources.
Typed-array kinds must match the declared parameter signature. The host validates buffer sizes and its iteration budget before calling.
The artifact does not prove a finite execution deadline or validate arbitrary host scheduling.

The artifact's callable closure must contain no explicit heap allocation, Promise, deferred microtask, dynamic import, GPU access or host-array clone.
The emitter checks the reachable builtin implementations as well as the generated function.
Initialization and static module imports can allocate before playback. No claim is made about allocations inside the JavaScript VM.
Generation and module loading occur before an AudioWorklet callback. The callback only calls an already-loaded function.
The generated module can import the compiler-owned operation library. Consumers do not import a private generator or patch its output.
Artifact code and its matching runtime version remain one deployment unit; cross-version artifact persistence is not supported initially.

Rules 8.21 and 11.8 would distinguish this explicit direct-buffer API from asynchronous kernel host calls.
Rule 11.7 would describe its f32 code generation and refusal conditions.
The CPU result follows the existing f32 CPU semantics. No new CPU/GPU bit-parity promise is added.
No audio node, sample rate, oscillator, scheduler or sound graph enters the language or compiler runtime.

## Why

TypeAudio's [compiler ask F](https://github.com/typeshade/typeaudio/blob/575b42baa13ee666cc050b25da1e63720dfbf6e4/docs/compiler-asks.md#f-a-worklet-build-of-the-cpu-tier) records the worklet pressure.
An asynchronous kernel call is unsuitable for an output buffer that must be complete when `process()` returns.
An observation about Chromium's microtask checkpoint is not a portable execution contract.

The Web graph adapter at the recorded baseline directly imports `src/core/cpu-codegen.ts`.
It requests f32 output, rejects fallbacks and nested calls, removes the generated `$.inout.values` publication, and scans for allocations.
The separate Web build adapter performs similar work for its live synthesizer.
Both depend on internal generator details and a manually audited builtin allowlist.

[TypeAudio PR #22](https://github.com/typeshade/typeaudio/pull/22) moves the graph adapter into the engine and adds shared reproduction fixtures.
The fixtures cover synchronous output, seeded state across block boundaries, parameter events and an independent xorshift reference.
[Web PR #45](https://github.com/typeshade/web/pull/45) consumes that engine implementation.
These changes establish a downstream regression path; they do not implement this compiler API.

Changing all kernel calls to synchronous execution would break their existing queue contract.
Keeping a private generator import leaves each downstream responsible for compiler internals.
Moving all compilation into the audio callback introduces work that cannot fit a stable callback budget.
An explicit ahead-of-time artifact preserves existing calls and provides a reviewable boundary for the general requirement.

## What it touches

- Rules 8.21, 11.7 and 11.8: direct buffer ownership, synchronous completion and existing asynchronous-call boundaries.
- Surface section 65: the opt-in CPU artifact, supported subset, preparation and limitations.
- The package root: `emitCpuKernel`, `CpuKernelArtifact` and `CpuKernelOptions`, including API surface and JSDoc coverage.
- CPU code generation and its builtin dependency analysis: refuse unsupported closures without falling back silently.
- The generated module's runtime closure and bundle checks: no evaluation helper or deferred loading during execution.
- Compiler tests and a packaged consumer journey: immediate output, state persistence, invalid shapes and allocation/dependency refusals.
- TypeAudio candidate CI and shared fixtures: compare both the pinned adapter and the new supported artifact on identical inputs.

### Draft impact estimate

This is an additive host API, not a shader syntax extension. Existing asynchronous host calls retain their behavior.
The emitter must separate direct-buffer publication from the current host-call ABI without changing existing generated modules.
The initial subset matches the graph workaround; general classes, fusion, vectors and WASM are outside this proposal.
The editor's shader vocabulary is unchanged, but its host API information needs the new exports.

Required functional evidence includes immediate writes before return, no Promise result, independent numerical references and seeded block continuity.
Refusal tests must plant allocations, nested calls and unsupported builtin dependencies and observe rejection.
A packed package must load its generated module under strict CSP and in an AudioWorklet before playback.
Chromium and another browser engine must be reported separately. Unavailable browser or hardware checks remain explicitly pending.
Existing emit goldens and CPU/GPU regression gates must continue to pass for the unchanged host-call path.
Timing reports identify compile/load cost separately from cold and warm execution. They do not establish hard real-time guarantees.

Required document evidence includes proposal scope, API surface, documentation references, rule traceability and downstream impact checks.
Implementation duration and cost are unestimated. Responsibility and milestone dates remain unassigned until acceptance.
Acceptance must settle the artifact signature, initial subset and buffer validation boundary described above.

### Approval and plan record

This record does not yet apply. The owner approved work on the cross-repository feedback loop on 2026-11-06 UTC.
That direction is the request source, not acceptance of this specific compiler contract.
Acceptance requires the reviewed proposal revision, explicit decisions on its contract, responsibilities and validation evidence.
The proposal must merge as accepted before a public API implementation begins.

### Configuration and validation record

This record does not yet apply. No compiler implementation or downstream adoption of proposal 0122 is claimed.
Delivery requires the accepted revision, implementation PR, compiler commit, executed checks and remaining deviations.
The engine and website pins, regression artifacts and browser results must then identify the adopted implementation separately.

## What it owes downstream

TypeAudio must replace its private graph adapter only after the official artifact passes its shared fixtures and worklet checks.
Its `compiler-asks.md` section F retains the request and links this proposal; `compiler-changes.md` records actual adoption, not this draft.
The engine retains domain validation, parameter smoothing, graph state, scheduling and sample-rate policy.

The website must adopt the matching TypeAudio/compiler pair through a tested pin PR.
Its graph compiler is already moving behind the engine API in Web PR #45.
Its remaining build-only synthesizer adapter needs a separate equivalence check before removal.
Published reference pages describe synchronous artifacts only after the pinned compiler supports them.

The editor repository must verify host-export diagnostics, completion and hover against the supported package.
No shader-language completion or syntax change is proposed.
All three downstream obligations are pending; a compiler merge alone cannot mark them complete.
