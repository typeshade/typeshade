---
id: '0082'
title: A kernel's class array keeps its logical type while the compiler selects a private physical layout
status: draft
rules:
  - '8.21'
  - '8.22'
  - '8.23'
  - '11.8'
  - '11.13'
surface:
  - 65
  - 71
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: Before choosing a hardware policy, provide an opt-in browser measurement page and a versioned result collector, en and ko. After compiler implementation, explain private kernel layouts, the conservative AoS fallback and exposed-layout boundaries on the kernel and host pages. Update rule fingerprints after reading the changed rules. Record 0082 in compiler-changes.md at the implementation pin.
  - repo: vscode-typeshade
    what: Update the skill's host and language references to distinguish logical struct values from private kernel storage. Explain the Resident and raw-byte boundaries. Record 0082 in compiler-changes.md at the implementation pin.
  - repo: typecv
    what: No source migration is proposed. Validate struct-array kernels and exposed buffer interoperation at the implementation pin, then record 0082 in compiler-changes.md.
  - repo: typenn
    what: No source migration is proposed. Validate calls, resident arrays and fuse chains at the implementation pin, then record 0082 in compiler-changes.md.
  - repo: radiance
    what: No source migration is proposed. Validate manifest, raw-buffer and resident interoperation at the implementation pin, then record 0082 in compiler-changes.md.
---

**Document control**

| Field                         | Record                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0082. This file is the proposal source. Its status is `draft`.                                                                                                                                      |
| Date and attribution          | Drafted by a Codex agent on 2026-10-22 UTC. The date identifies authoring, not approval or delivery.                                                                                                         |
| Request source                | The repository owner supplied earlier design discussions and instructed the agent to measure first, then draft. The discussions ask for performance, memory, safety and optimization opportunities together. |
| Applicability / effectivity   | Private WebGPU kernel storage for ordinary host arrays of structs, the compiler's kernel lowering and host call layer. Public resource layouts remain fixed. No release version is assigned.                 |
| Review baseline               | `main` at `94203d3cab6433065bbe111c3b93f66a4058828e`, which completed 0081.                                                                                                                                  |
| Review and revision authority | [PR #734](https://github.com/typeshade/typeshade/pull/734). Git records revisions; review and merge evidence will record decisions. This draft does not approve its implementation.                          |

## What changes

The proposal separates an array's logical element type from a kernel's private physical
storage. An author continues to write a class and `array<Particle>`. No layout decorator,
container type or host argument is added.

Today the kernel's call packs every struct field in AoS storage. A generated WebGPU kernel
uses the same storage layout. Under this proposal, a private plan can instead describe:

- The existing AoS, which remains the baseline and fallback.
- A projected AoS, containing only the fields the kernel needs on the device.
- SoA columns, grouped into buffers subject to access modes and device binding limits.

These are alternatives, not a promise that SoA wins. AoSoA is a future experiment, outside
this draft. The implementation must not ship a heuristic justified only by a software GPU.

### Analysis and selection

The compiler proves the logical loop under Rule 8.22 before changing its physical layout.
It then derives field read and write sets from that IR, including transitively called helpers.
It plans over the whole function, not one loop in isolation. A field written in one loop and
read later remains live. A whole-element read or an unresolved field use retains all fields.

The initial candidates are flat structs of `f32`, `i32` and `u32` data fields. Timing evidence
in this draft covers `f32` only. Nested structs, arrays, matrices, vectors, atomics, `f64`,
append/scatter kernels and collection values retain their current layouts initially.
The existing field and array semantics are not widened by this proposal.

For an eligible read-only host array, validate the complete logical value and gather the
fields read by the device. For a written array, upload the fields read and return the fields
written only when reconstruction preserves the current host result exactly. Unknown cases
use the existing call, without a new refusal or warning.

The selected private plan must describe its offsets, strides, column extents, resource access
and logical-to-physical mapping. It must produce typed IR and WGSL through the existing
lowering and writer, rather than patching shader strings. The CPU oracle continues to run
the logical program. Optimized device results must agree with it and the existing call.

Selection must account for array length, field access, validation and gathering, host transfer,
written-field reconstruction, additional allocations and bindings, and emitted bundle size.
AoS remains selected when eligibility or the benefit is not established. No switching threshold
is assigned from the measurements below.

### Boundaries

The following retain their current AoS layouts and interoperation:

- Authored entry bindings and `reflect()` layouts (Rule 6.8).
- Manifest buffer layouts and schema 2 (Rule 11.10).
- Raw bytes, including `Uint8Array` and `Resident<Uint8Array>` (change 0049).
- Every `Resident`, including buffers shared by entry calls, kernels and the program runtime.

A compiled callable therefore needs its existing AoS plan even if it carries a private
alternative. A call receiving any exposed representation selects the existing plan.
Mixed representations, aliases or a fuse scope use that plan unless equivalence is proved.
The first implementation does not change fuse grouping or resident buffer identity.
The CPU and WebGL2 paths retain their current representations and tier selection.

Key types and Record keep 0081's host contract. Deviation D1 remains open and unchanged.
Map/Set sorting, duplicate removal, lookup and insertion order are outside 0082's scope.

### Observable behavior that cannot be dropped

Skipping GPU bytes does not authorize skipping host validation. A missing or invalid unused
field must produce the existing refusal, at the same call boundary.
Untouched fields, host row identity and logical array length must remain correct.
Aliases between parameters or between host rows require an existing-layout fallback until
their reconstruction is proved equivalent. This does not weaken the loop proof.

The current `pack`/`readInto` path rounds even an untouched `f32` field on a written array.
The retained probe reads `0.1` back as `0.10000000149011612`. A naive selective copyback
leaves `0.1`, which is observably different. A safe plan may retain normalized cold fields
on the host and reconstruct them in baseline order, but that work and memory must be counted.
It must also settle mutation of the host while a call is pending. Until then, written arrays
keep AoS. Changing these semantics would need an explicit decision, not an optimization claim.

## Why

The owner's design discussions identify layout as a possible cost, rather than classes as
the problem. They recommend compiler selection and field projection, with measurement first.
Two earlier generalizations need qualification:

- AoS does not prove that a GPU fetches every field. Cache-line and transaction behavior depend
  on the device and accesses. Allocated bytes are not measured memory traffic.
- A `vec3<f32>` has a 12-byte payload and 16-byte alignment. A following `f32` can occupy offset 12. The measured `pos: vec3; mass: f32` struct has stride 16, with no wasted scalar slot.
  Two consecutive vec3 fields have stride 32 and 24 payload bytes in the measured layout.

The instrument is `scripts/kernel-layout-bench.ts`. Its retained JSON and readable analysis
are in `docs/measurements/0082-kernel-struct-layout.json` and
`docs/measurements/0082-kernel-struct-layout.md`. The JSON records source text, emitted WGSL,
layouts, raw samples, adapter identity, command, source hash and compiler revision.

The experiment compares full and projected AoS with full and projected SoA, over 1,024,
65,536 and 1,048,576 elements. It covers one-, four- and eight-field reads and a one-field
write. Device timestamps and host dispatch wall time exclude compilation and initial uploads.
Separate host measurements cover full-value validation, gathering and field merging.

The available adapter is SwiftShader, a software fallback. Its timings characterize that
configuration, not a physical GPU or a portable performance threshold. Exact byte counts
establish storage savings independently of those timings. Full eight-field reads provide a
control where projection removes nothing, including identical-kernel alternatives.

The SoA write prototype needs three storage bindings, versus AoS's two. Today's proof refuses
a read at `n + i` in the same array written at `i` (`TS8070`), so the prototype separates the
written column from read-only columns. A private physical plan must preserve logical safety
without asking the source author to make this rewrite.

### Voluntary measurements on the site

The owner proposed collecting voluntary browser measurements on typeshade.dev, following
TypeCV's existing run-record workflow. This is a proposed evidence-collection stage before
choosing compiler policy. It is not automatic layout selection or a deployed page.

TypeCV's current code provides the precedent: its
[record sender](https://github.com/typeshade/typecv/blob/d8a478213487f79d57e89ca1e670b0093114bc18/website/src/lib/send-record.ts)
sends validated records to its
[collector](https://github.com/typeshade/typecv/blob/d8a478213487f79d57e89ca1e670b0093114bc18/website/worker.mjs),
which validates and bounds them before storage.
Its lab and probe expose consent, result inspection, download and sending. TypeShade needs
its own versioned record schema and endpoint; TypeCV's SfM/probe schema is not a layout schema.

The proposed TypeShade flow is:

1. Explain the workload, expected resource use and fields in a submitted record.
2. Run only after the visitor selects the run action, with progress and a stop action.
3. Show the local result and its timing limitations, with JSON download available.
4. Send only with explicit consent; show success or failure and retain a local download.

Use fixed synthetic inputs and a frozen benchmark revision. Send no user shader, image or
input file. Record the benchmark/schema revision, compiler and shader hashes, browser version,
reported adapter identity and fallback status, relevant features/limits, workload sizes,
warm-up/sample counts, raw paired samples, correctness outcomes and interrupted/failed cases.
Missing device timestamps remain unavailable, not zero. Browser-redacted adapter fields
remain unknown. Classify known software adapters separately and do not infer a physical GPU
from a missing or false fallback flag alone.

Each submission runs competing layouts on the same device with interleaved order. Keep
kernel timing separate from host validation, packing, transfer and full-call latency.
Bound array sizes and duration by the device limits. Record background-tab interruptions;
interrupted or correctness-failing runs cannot qualify a performance policy.

The collector validates schema/revision, sizes, sample counts and numeric ranges, bounds
request size and rate, and keeps stored records readable only through the maintainer's
authorized access. Submitters need no account. Explain collection and retention in the page.
Benchmark records do not include a persistent visitor identifier. Any transient abuse-control
data and infrastructure logs need a separately documented retention policy.

Analyze paired layout ratios and distributions by benchmark revision, workload and reported
device/browser family. Do not average unrelated machines' raw milliseconds or count repeated
submissions as independent devices. Browser submissions are untrusted observations; client
correctness claims are not attestation. Reproduce candidate policies on controlled hardware
before enabling them in the compiler. Evidence collection alone does not authorize a policy.

The TypeShade site already has a Cloudflare Worker with D1/R2 bindings. A separate site PR
can reuse that infrastructure and TypeCV's interaction pattern without changing the compiler
pin or publishing the proposed optimizer. Endpoint shape, storage/retention and review UI
remain to be specified in that PR. No collector is implemented by this proposal draft.

### Alternatives and open decisions

1. **Keep AoS.** This is the safe default. Specialized packing can be investigated independently;
   a faster prototype pack is not evidence that transposition itself caused the improvement.
2. **Always use SoA.** Not recommended. It spends bindings or indexing work, can lose on wide
   accesses, and does not settle exposed layouts or host reconstruction.
3. **Compiler selection.** Recommended direction, subject to the acceptance evidence below.
   Start with read-only field projection; select AoS or SoA only under an agreed cost policy.

Before acceptance, decide:

- Which physical GPUs and repeatability bounds establish the selection policy and thresholds.
- Which collector schema, retention policy and repeated-run treatment make voluntary results
  suitable for review and controlled reproduction.
- Whether the first implementation is read-only projection alone, or also includes SoA.
- Whether written-array projection retains normalized cold-field snapshots or remains deferred.
- How eligibility handles getters, proxies, shared row objects and concurrent host mutation.
- Whether one linear column buffer or multiple access-mode buffers wins after binding limits,
  proof complexity and transfer costs are included.

No hardware speedup, completion date or implementation cost is assigned by this draft.

## What it touches

- Rule 8.21: preserve complete logical host validation and representation despite omitted bytes.
- Rule 8.22: derive field effects from proved logical loops and retain conservative fallbacks.
- Rule 8.23: preserve in-place writes, untouched fields, length and alias-sensitive copyback.
- Rule 11.8: select a private plan only for eligible ordinary calls; preserve exposed buffers.
- Rule 11.13: require the existing layout for fuse/resident interoperation in the first phase.
- Surface §65: explain eligible arrays, selection costs and existing-layout fallback.
- Surface §71: explain the preserved fuse/resident boundary.
- Public exports, diagnostic codes and registered examples: no additions or removals proposed.

Expected code work reaches `src/core/passes/kernel-lower.ts`, the IR access/effect readers,
`src/compiler/ts/host-face.ts`, `src/core/host-kernel.ts` and the generated call metadata.
Private plan packing must stay separate from the public manifest's layout vocabulary.
The call layer's dependency boundary and bundle budgets remain in force.

### Draft impact estimate

This requires field-effect analysis, a private physical plan, typed lowering, argument gating,
packing and reconstruction. It also requires conservative treatment of aliases and whole-value
uses. Existing layouts, schema, raw bytes and Resident device ownership must remain compatible.
No additional runtime dependency is proposed. Runtime and generated-module size growth are
unmeasured until an implementation exists. Effort and duration are unestimated.
The evidence-collection stage separately needs a browser worker, bounded run/cancel handling,
result preview/download/consent, server validation/storage and maintained aggregation tools.
Its implementation, hosting volume and retention cost are unestimated.

Functional acceptance must include:

- Repeatable measurements on physical GPUs, including host-to-device transfer and full call
  latency, with sparse/wide accesses and both small and large arrays.
- A browser collector that sends nothing without consent, preserves unavailable timing as
  unavailable, validates submissions and retains benchmark provenance. Rejected, interrupted,
  software and repeated runs must be distinguishable from qualifying independent evidence.
- Differential execution against the logical CPU oracle and the existing AoS path; corruption
  probes must show that wrong field mappings, lengths and untouched-field writes are detected.
- Read-only, write-only and read/write fields; multiple loops, helpers, whole-element reads,
  aliases, duplicate host rows, nested unsupported types and partial workgroups.
- Missing or invalid unused fields, nonrepresentable `f32` inputs and untouched-field rounding.
- Entry, manifest, raw-byte, mixed Resident and fuse interoperation, and CPU/WebGL2 fallbacks.
- Device binding limits, zero/small lengths, allocation failures and deterministic fallback.
- Existing build, unit, compile, differential, journey and bundle-boundary gates.

Document acceptance must identify every changed rule and surface section, update traceability,
read all documentation-impact review items, and declare the final downstream obligations.
These are required future checks, not results of this draft's instrument.

### Approval and plan record

This record does not yet apply. The owner authorized measurement and drafting, not acceptance
of a physical layout or implementation. Acceptance needs reviewed evidence, resolved decisions,
the approved proposal revision and a merge of this proposal with `status: accepted`.
Implementation responsibilities and milestone dates remain unassigned.

### Configuration and validation record

Implementation delivery does not yet apply. No automatic layout selection has been implemented.
The measurement report records the compiler baseline, instrument hash, environment and observed
results. A passing experiment does not establish implementation completion.

Delivery will require actual implementing commits and PRs, the accepted baseline, functional
and document check results, and explicit disposition of every deviation and pending item.

## What it owes downstream

The site and editor must explain the distinction between logical types and private kernel
storage, the eligibility/fallback rules, and the unchanged exposed-layout boundaries. Their
compiler-pin changes must read the updated rules and record 0082 after implementation.
The site maintains English and Korean copy and rule fingerprints; the editor updates the
skill's host and language references. These changes are pending, not delivered by this draft.
Before compiler implementation, the site may deliver the voluntary measurement page and
collector as a separate evidence-only change. That delivery needs its own PR, tested revision,
deployment and recorded results; it does not mark the compiler proposal implemented.

TypeCV, TypeNN and Radiance need no source rewrite under the proposed compatibility contract.
Their pin updates must verify the calls and exposed-buffer interoperation they use and record 0082. The compiler's accepted scope and implementation determine any additional obligations.
Downstream owners, implementation PRs and validation dates are not yet assigned.
