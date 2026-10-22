---
id: '0082'
title: Kernel object arrays can use a physical layout selected from their field use
status: draft
rules:
  - '8.21'
  - '8.23'
surface:
  - 65
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: Explain private kernel layouts on the kernel guide page, translate it, and compare the delivered optimizer through the versioned benchmark. Record 0082 when the pin moves.
  - repo: vscode-typeshade
    what: Explain the unchanged object-array host contract and fixed external layouts in the authoring references. Record 0082 when the pin moves.
---

**Document control**

| Field                         | Record                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0082; `draft`. Front matter controls the lifecycle state.                                                                                                                    |
| Date and attribution          | Authored 2026-10-22 UTC by the Codex agent at the owner's request. This is an authorship date, not approval.                                                                          |
| Request source                | The owner requested measurements before deciding how kernel object arrays should use AoS, SoA and field projection. They requested this proposal after building the device benchmark. |
| Applicability / effectivity   | Kernel lowering, generated host metadata and host packing for private, non-resident object arrays on WebGPU. No release version is assigned.                                          |
| Review baseline               | Compiler main `dab376596884ff987d518f8b27ed8a6bbd767ea3`, fetched and read on 2026-10-22 UTC.                                                                                         |
| Review and revision authority | No PR is assigned yet. Git records revisions; PR review and merge record decisions. Neither Git authorship nor this draft signifies acceptance.                                       |

## What changes

An author continues to pass an array of plain objects to a kernel function. The compiler
may choose a smaller private representation without changing the logical struct type.
Rules 8.21 and 8.23 will distinguish the host value from that private representation.

The proposed first delivery handles read-only `array<T>` parameters where `T` is a flat
struct of `f32`, `i32` or `u32` fields. Field-use analysis covers every loop and reachable
helper in the call. It may omit a field from GPU storage only when no reachable operation
observes that field. Host validation still checks every declared field before any work.

For example, a kernel that reads one of eight fields may upload one field per object.
The caller still supplies eight-field objects, and the call still refuses an invalid field.
Input objects remain unchanged. The compiler does not introduce a new authoring syntax,
layout annotation, configuration option, public export or diagnostic code.

The compiler retains AoS when analysis cannot establish safety. Whole-object use, an
unresolved field path or an unsupported element type blocks projection. Direct helper
calls require a field-use summary; an absent summary conservatively uses every field.
Field liveness is the union across all loops, including serial statements and reductions.

The selected layout is one plan per parameter for the entire call. A projected AoS packs
the live fields together. SoA places each live field in a contiguous column. SoA must use
a bounded number of storage bindings; one binding per field cannot assume unlimited device
limits. Generated entry code and host packing must consume the same plan.

The first delivery must compare projected AoS with projected SoA before selecting a default.
The proposed initial policy favors field projection and retains AoS unless controlled
complete-call measurements justify a SoA choice. A deterministic policy must be finalized
before acceptance. The compiler does not read submitted telemetry at compile time or run time.

The following boundaries retain their existing byte layout and behavior:

- Authored entry bindings, reflection and manifests (Rule 6.8).
- Raw bytes from change 0049 and every `Resident` value (Rule 11.8).
- Arrays participating in a `fuse` scope or scratch storage (Rule 11.13), in the first delivery.
- Written object-array parameters, nested structs, vectors, matrices, `f64`, atomics and collections, in the first delivery.

Written-field copyback and initialization elimination require a later amendment or proposal.
In particular, skipping copyback must preserve existing numeric conversion and alias effects.
This draft does not assume an unwritten field can simply bypass its existing conversion.
Map/Set value columns and their ordering remain under change 0080. Change 0081 deviation D1 stays open.

## Why

AoS and SoA answer different memory-access patterns. A field-only read can benefit from
contiguous values. A read of every field may benefit from keeping each object's fields together.
Neither arrangement inherently removes unused fields. Projection is a separate optimization.

### Observed device evidence

Authenticated, read-only D1 export at 2026-10-22 13:38:41 UTC returned four complete reports.
Two use the original schema-1 instrument, one uses `paired-1`, and one uses `unified-1`.
Reported adapters include Apple and NVIDIA Blackwell. These are reports, not independent-device
counts. Raw reports, run UUIDs, browser strings and renderer fingerprints remain private.

The unified report passed all 162 correctness checks and their corrupted-result probes.
Its catalog digest is `3f1859a17048ac2eccaa0737294522f0207ed547fa0e5bc0d1d9b1d0a43322cf`.
Its compiler builds are baseline `82d7ba527e72975df15c35eb16d27239401ea3eb` and candidate
`94203d3cab6433065bbe111c3b93f66a4058828e`. Each entry below compares layout alternatives
within the candidate build and the same run. Values are medians of 15 per-dispatch GPU samples.

| Elements | Read 1 of 8: AoS / SoA, microseconds | AoS / SoA ratio | Read all 8: AoS / SoA, microseconds | AoS / SoA ratio |
| -------- | ------------------------------------ | --------------- | ----------------------------------- | --------------- |
| 16,384   | 10.082 / 5.770                       | 1.747           | 14.601 / 14.094                     | 1.036           |
| 65,536   | 38.322 / 10.196                      | 3.759           | 22.746 / 24.212                     | 0.939           |
| 262,144  | 112.078 / 13.169                     | 8.511           | 107.932 / 141.534                   | 0.763           |

At 262,144 elements, SoA's all-field median takes about 31.1% longer than AoS.
Their descriptive 10th-to-90th percentile ranges are 137.489–149.683 and 100.089–132.632
microseconds, respectively. These ranges describe samples; they are not confidence intervals.
The two builds in this report are repeated conditions, not independent devices.

The full eight-field fixtures have identical logical buffer bytes: `36 * N`, including
their scalar output. The one-field fixtures use `8 * N`. Thus projection reduces this
fixture's logical buffers by 77.8%; rearrangement alone does not reduce them. At 262,144
elements, observed peak instrumented buffers are 17,829,936 and 3,149,872 bytes, respectively.
Peak buffers also include staging and instrumentation; they are not total device memory.

The fixtures are explicit compute bindings with prepacked scalar data. They do not measure
the full JavaScript object validation, packing and copyback path of an optimized host call.
Different layout cases also calibrate different dispatch counts. Cache reuse and batching
limit extrapolation to a single cold call. Whole-call gains remain unestablished.
The original NVIDIA report has no usable layout GPU intervals. It supplies no device-time
comparison for this decision. Older cohorts are not pooled with the unified report.

These observations support testing projection first. They reject an unconditional switch
to SoA and do not establish a cross-device selection threshold. No compiler optimization
has been delivered by this proposal or by the benchmark page.

The benchmark protocol and source are in site PR #217:
[unified protocol](https://github.com/typeshade/typeshade.github.io/blob/83fe3d92c949d20ef66b89c99b322d8d651c629c/docs/benchmark-unification.md),
[fixture construction](https://github.com/typeshade/typeshade.github.io/blob/83fe3d92c949d20ef66b89c99b322d8d651c629c/src/lib/benchmarks/fixtures.ts),
and [measurement code](https://github.com/typeshade/typeshade.github.io/blob/83fe3d92c949d20ef66b89c99b322d8d651c629c/src/lib/benchmarks/regression-gpu.ts).

### Alternatives

- Keep full AoS: simplest fallback, with unnecessary upload bytes when most fields are unused.
- Project AoS: removes unused columns without requiring many buffers or a universal SoA policy.
- Always use SoA: contradicted by the unified report's largest all-field case.
- Select AoS or SoA after projection: proposed direction, with complete-call evidence still required.
- Use AoSoA or an online autotuner: deferred; neither has measurements or an agreed block size.

## What it touches

- Rule 8.21: keep full logical host validation while allowing a private physical representation.
- Rule 8.23: preserve element indexing and array length when private storage is projected.
- Surface §65: explain eligible parameters, conservative fallback and fixed external boundaries.
- `src/core/passes/kernel-lower.ts`: analyze reachable field use and lower accesses with one plan.
- `src/compiler/ts/host-face.ts`: serialize the plan for the host call and retain logical validation metadata.
- `src/core/host-kernel.ts`: validate full objects and pack live fields using that same plan.
- `src/core/host-entry.ts`: retain the shared external layout and number-conversion contract.
- Kernel tests and GPU differential generation: exercise projected storage and the AoS fallback.

### Draft impact estimate

No host signature changes are proposed. WebGL2 and CPU paths retain their existing representation.
Entry manifests, resident interoperability, collection behavior and bundle boundaries stay fixed.
Implementation complexity is concentrated in field-use analysis and shared physical metadata.
The public API snapshot must remain unchanged; an unexpected exported shape requires an amendment.
No new dependency is proposed. Duration, cost, implementer assignments and milestone dates are unestimated.

Before acceptance, resolve these decisions:

1. Define the deterministic projection and layout-selection policy from complete-call measurements.
2. Confirm that field analysis covers reachable helpers and every loop without losing validation.
3. Measure packing cost, transfer bytes, device time, whole-call time and peak buffers separately.
4. Obtain controlled runs on more physical adapters, including an adapter outside the Apple reports.
5. Finalize the first delivery's read-only restriction and the fallback for aliases and unsupported shapes.

### Approval and plan record

This record does not yet apply. The owner's instruction authorizes measurement and drafting;
it does not establish a merged accepted proposal. Acceptance requires the actual reviewed
revision, agreed policy and scope, responsible actors, validation plan and approval/merge evidence.
The proposal must be merged as `accepted` before its implementation changes normative behavior.

### Configuration and validation record

Compiler implementation evidence does not yet apply. Required delivery evidence includes:

- Compile and editor checks on the same source, including unchanged diagnostics and host types.
- Full shape validation for unused fields, empty arrays and zero live fields.
- Exact CPU-reference parity, GPU corruption probes and fallback cases on all supported tiers.
- Differential cases with several loops, helper reads, reductions and unsupported whole-object use.
- Unchanged entry reflection, manifest bytes, raw bytes, resident values and fusion behavior.
- Measured complete-call comparisons against a full-AoS build on controlled physical devices.
- Build, lint, formatting, affected tests, compile gate, GPU differential and packed host journeys.
- Documentation impact, references, traceability and downstream obligation review.

Functional evidence must identify the actual implementation commits, compiler configuration,
device conditions, executor, UTC date and observed results. Document validation must separately
record the guide, design rules, surface, API and downstream review. Deviations remain explicit.

## What it owes downstream

The site will explain the optimization's scope on its kernel guide in English and Korean.
Its versioned benchmark will compare the implemented candidate against a fixed baseline,
without rewriting historical workload provenance. Its compiler pin and `compiler-changes.md`
record remain separate delivery steps.

The editor will explain that host object types and external buffer layouts remain unchanged.
Its authoring references and `compiler-changes.md` will record the delivered policy when pinned.
No downstream delivery, responsibility assignment or pin movement has occurred for this draft.
