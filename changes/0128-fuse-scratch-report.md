---
id: '0128'
title: A fuse report counts WebGPU scratch buffer allocations and pool reuses
status: draft
rules:
  - '11.13'
surface:
  - 71
exports:
  - FuseReport
  - mergeReports
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: Explain the optional WebGPU scratch metrics, unknown legacy reports and merge behavior in both languages; record 0128 when the compiler pin moves.
  - repo: vscode-typeshade
    what: Update the host reference and report fixtures with the metrics and their missing-value meaning; record 0128 when the compiler pin moves.
  - repo: radiance
    what: Audit full-report fixtures and report displays; preserve unknown legacy metrics and record 0128 when the compiler pin moves.
  - repo: typenn
    what: Audit report aggregation and full-report fixtures without requiring old report literals to invent metrics; record 0128 when the compiler pin moves.
  - repo: typecv
    what: Audit report aggregation and full-report fixtures without requiring old report literals to invent metrics; record 0128 when the compiler pin moves.
  - repo: typeaudio
    what: Show actual scratch acquisitions in src/explain.ts and experiment reports, distinguish unknown from zero, update ask U and record 0128 at adoption.
---

**Document control**

| Field                         | Record                                                                                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0128, draft. The front matter controls its lifecycle.                                                                                                                         |
| Date and attribution          | Authored 2026-11-07 UTC by Codex under the owner's request to continue remaining issues. This date records authorship, not approval.                                                   |
| Request source                | Issue [#992](https://github.com/typeshade/typeshade/issues/992), from TypeAudio experiment 4 at compiler pin `14566606`.                                                               |
| Applicability / Effectivity   | Reports returned by `fuse()` and `device.fuse()`, their aggregation and documentation. Release version unassigned.                                                                     |
| Review baseline               | Compiler main `463ed3a88c26b9a9328712d87569f8ec98a354a5`, read on 2026-11-07 UTC. Pool implementation reviewed separately at PR #1074 head `c7e03ac6fe010ce109c25b48eb177c6a0e0c469b`. |
| Review and revision authority | Proposal [PR #1082](https://github.com/typeshade/typeshade/pull/1082). Git records revisions; PR review and the accepted merge record decisions.                                       |

## What changes

**Current behavior.** A `FuseReport` gives dispatch and submission counts. It does not say
whether a scratch array caused a WebGPU storage buffer allocation or borrowed a pooled buffer.
`DeviceStatistics.allocations` and `reuses` count `array()` calls, so they cannot supply this information.
PR [#1074](https://github.com/typeshade/typeshade/pull/1074) fixes scratch pooling separately and leaves those public counters unchanged.

**Proposed behavior.** Add one optional, readonly member to `FuseReport`:

```ts
readonly webgpuScratch?: {
  readonly allocations: number;
  readonly allocatedBytes: number;
  readonly reuses: number;
  readonly reusedBytes: number;
};
```

The nested object adds no separate exported type. Rule 11.13 and surface §71 will define these
four counters. Their scope is WebGPU storage buffers backing the plan's `scope.scratch()` arrays.
They are not a count of all GPU allocations, all temporary storage, or all device memory.

### D1. Count actual buffer acquisitions

- `allocations` counts new scratch storage buffers acquired while the plan runs.
- `allocatedBytes` sums their WebGPU buffer descriptor sizes, in bytes.
- `reuses` counts existing storage buffers borrowed from the owner's pool for the plan's scratch arrays.
- `reusedBytes` sums the descriptor sizes of those borrowed buffers.

The buffer may come from an ordinary `Resident` or an earlier scratch array; its provenance does not affect reuse.
A pool slot with no GPU buffer is not a reuse. Its first device use can allocate a new buffer,
which contributes to `allocations` and `allocatedBytes` instead. A buffer of another device,
type or incompatible physical size cannot contribute a reuse.

A scratch array bound by several calls contributes only its actual acquisitions. Rebinding the
same buffer, clearing it, uploading host values or returning it to the pool adds no acquisition.
If execution creates a replacement storage buffer, that creation contributes another allocation.
Keeping a buffer in the pool after the plan does not cancel the plan's allocation count.

Byte counters describe requested buffer storage, including its layout padding. They do not
measure the driver's heap reservation, GPU memory pressure, allocation latency or execution time.
No GPU query, fence or readback is added to obtain these counters.

Ordinary `Resident` storage, reduction partials, staging buffers, uniforms, guards and WebGL
textures are outside this member. Existing `DeviceStatistics` meanings remain unchanged.

### D2. Preserve lazy execution and failures

Every report returned by the new runtime includes `webgpuScratch`, including four zeros when
the plan acquired no WebGPU scratch buffer. This includes an empty plan, unused scratch,
scratch held entirely in a fused local, and a plan executed only on CPU or WebGL2.
Zero here does not claim that CPU or WebGL2 execution allocated no other memory.

Mixed plans count acquisitions across all their groups. A CPU call followed by a WebGPU call
can allocate or borrow one scratch buffer. A later host synchronization and GPU rebind do not
count that buffer again. Nested scopes still share the outer plan and its single report.
Chunk reports retain these counters; chunk timing and rate learning keep their current meanings.

Tier selection and fallback do not change. At the reviewed implementation, tier suitability is
checked before scratch buffers are bound. A refused tier therefore contributes no acquisition.
Counters describe actual acquisitions during a successful plan, not its declared tier or shapes.

A failing scope still rejects without a partial `FuseReport`. Allocations made before its
failure do not appear in a later plan's report. If its released buffer reaches a later successful
plan through the pool, that later plan counts its own reuse. A thrown allocation that supplies
no buffer contributes no successful acquisition. Cleanup and queue ordering remain unchanged.

### D3. Keep old report literals valid

The outer member is optional so an existing hand-built or serialized `FuseReport` stays valid.
Omission means that the report did not record these metrics. It does not mean four zeros.
All four fields are required when the member is present; partial metrics are not proposed.

Readers can display "not recorded" for omission. They must not use `?? 0` to claim a measured
total for older reports. Existing fields, group identity and the report's promise type do not change.

### D4. Aggregate only known metrics

`mergeReports(reports)` adds each of the four counters when every input contains `webgpuScratch`.
If any input omits it, the merged report omits the entire member. A partial sum would conceal
unknown acquisitions. `mergeReports([])` includes four zeros: no plans made no acquisitions.

The function still sums dispatches and submissions, preserves each group and its order, chooses
the best tier, and omits `chunk`. It does not mutate an input. A single legacy report still
produces a merged report without the new member.

### D5. Show the reported cost without a timing claim

Issue #992 describes 10,000 lanes of 1,024 `f32` frames: 40,960,000 bytes per scratch buffer.
The following is a proposed report fragment for two successful plans of that shape:

```json
{"webgpuScratch":{"allocations":1,"allocatedBytes":40960000,"reuses":0,"reusedBytes":0}}
{"webgpuScratch":{"allocations":0,"allocatedBytes":0,"reuses":1,"reusedBytes":40960000}}
```

Their merged metrics report one allocation and one reuse, each of 40,960,000 bytes. With pooling
disabled or insufficient capacity, both plans instead report one allocation and no reuse.
Before this proposal, neither plan exposes that difference in its `FuseReport`.

This example illustrates the proposed counters. It is not a new allocation, GPU or performance
measurement. The issue's experiment could not separate allocation cost from container load.

## Why

The consumer needs to distinguish repeated buffer creation from reuse without inferring either
from wall time. Counts distinguish operations; bytes distinguish their storage sizes.
One 16-byte allocation and one 40,960,000-byte allocation should not look like the same storage cost.

The review traced `ScratchState.bufferFor`, `DeviceImpl`'s pool transfer, `runPlan` and `mergeReports`.
The pool can contain a slot with no GPU buffer. Scratch can also stay entirely within a fused
local, so neither a scratch declaration nor a pool lookup proves a GPU acquisition.
Accounting must observe buffer creation or a real buffer lease, not derive it from array lengths
or the device's public `array()` counters.

**Alternatives.** Required top-level counters would break older report literals, as the required
group dispatch field did under change 0121. Optional independent numbers permit incomplete records.
The optional complete object preserves source compatibility and makes missing evidence explicit.
Counts alone are smaller, but omit the storage-size distinction that motivated #992.
An all-memory profiler, per-group attribution and failed-plan reports need different contracts
and are outside this proposal.

## What it touches

- Rule 11.13: define the four counters, their scope and missing-value meaning; synchronize its
  Doorstop item and review dependent surface links.
- Surface §71: extend the `FuseReport` listing, returned report examples, scratch explanation
  and `mergeReports` description. Rule 11.8 and device pool limits retain their meanings.
- Exports `FuseReport` and `mergeReports`: extend the report shape and aggregation behavior.
  Bake `src/__api__/surface.md`; no separate metrics type is exported.
- Runtime: count private scratch acquisitions at their actual lifecycle sites, then attach
  a detached value snapshot to the returned report. Do not infer counts from public statistics.
- Tests, journeys and examples: update full-report expectations where necessary. The set of
  examples, shader source vocabulary and diagnostic codes do not change.

### Draft impact estimate

The implementation depends on the pool fix in #1074 merging first. It does not change that
fix's pool policy, physical layout matching, zeroing, owner isolation or scratch handle lifetime.
Proposal 0128 can be reviewed before that merge; public fields must wait for this proposal's
accepted merge as well.

Older consumers that construct report literals remain source-compatible. Consumers comparing
whole returned objects or serialized snapshots will see the added member and need updated
expectations. Consumers reading metrics must distinguish omission from zero. No existing
reported value or shader computation changes. Release version and publication are unassigned.

Expected work is private event accounting, report aggregation, tests and documentation.
No new dependency is proposed. Bundle growth, CPU overhead and delivery time are unestimated;
measure the bundle before delivery and make no performance claim without a separate measurement.

Decisions D1 to D5 are proposed for acceptance together. Review must settle the exact member
name, complete optional object, descriptor-size unit and unknown-input aggregation before acceptance.

### Required functional evidence

- Two repeated bounded plans: the first records allocation, the second reuse, and recorded
  `createBuffer` calls and buffer identities independently verify the report.
- Different sizes and scalar/vector layouts, wrong-device and incompatible pool entries,
  a compatible ordinary `Resident` buffer, a host-only pool slot, pool eviction and
  `poolBytes: 0` retain correct counts and bytes.
- Unused scratch, a fused local, empty plans, CPU-only and WebGL2-only plans report four zeros.
- Mixed CPU/WebGPU plans and repeated bindings count each real acquisition once. Default-owner
  scopes count new allocations without inventing a device pool reuse. Nested scopes share counts.
- Body, executor-loading and allocation failures still reject. A failed plan releases its
  resources; the next successful plan has only its own allocation or reuse events.
- `mergeReports` covers known, unknown, mixed, empty and chunked inputs without mutation.
  Type checks accept old manual literals and require all four fields of a present member.
- A bounded native WebGPU run verifies repeated-plan values against CPU and an independent
  reference while recording actual buffer creation. Its evidence distinguishes API calls from
  driver memory or timing. A negative counter instrument must make the counter assertions fail.
- Canonical build, relevant unit and API tests, bundle boundary, compile, differential and
  packed journey gates pass. Changed shader fixtures also satisfy compiler/editor parity.

### Required document evidence

Update Rule 11.13, surface §71, JSDoc, API snapshot and CHANGELOG together. Run requirement
synchronization, actual Doorstop review, document references, impact review and proposal policy.
Record exact tested revisions and distinguish local checks from CI and downstream adoption.

### Approval and plan record

This record does not yet apply. Acceptance requires the reviewed decisions D1 to D5, finalized
impacts, actual review and merge references, and assigned implementation responsibilities.
No technical revision has been individually approved by the owner in this record.
The owner's standing task authorization is not a fabricated technical review or validation result.

### Configuration and validation record

This record does not yet apply. Delivery requires the accepted proposal revision, implementation
PR and commits, functional and document evidence, and dispositions for any deviation.
The read-only source audit and issue evidence support this draft; they do not validate an
implementation of the new fields. Downstream adoption remains separate from compiler delivery.

## What it owes downstream

- **typeshade.github.io:** surface §71 in both languages, API translations and report examples
  must explain the counters and missing metrics. `compiler-changes.md` records 0128 at adoption.
- **vscode-typeshade:** update [the host reference](https://github.com/typeshade/vscode-typeshade/blob/main/plugins/typeshade/skills/typeshade/references/host.md), which
  documents `FuseReport`, scratch and aggregation. Audit report fixtures and record 0128.
- **typeaudio:** [src/explain.ts](https://github.com/typeshade/typeaudio/blob/main/src/explain.ts) reads `FuseReport` and `mergeReports`. Display allocations and
  reuses for the last block and known totals; show missing metrics as unrecorded. Update ask U
  in [docs/compiler-asks.md](https://github.com/typeshade/typeaudio/blob/main/docs/compiler-asks.md), relevant experiment records and report fixtures when the pin moves.
- **radiance, typenn, typecv:** audit full-report fixtures, aggregation and displays at adoption.
  Older hand-built literals can remain unchanged and unknown; do not fill them with guessed zeros.
  Each repository records 0128 in `compiler-changes.md` when its pin includes the implementation.

The audit read TypeAudio's current [src/explain.ts](https://github.com/typeshade/typeaudio/blob/main/src/explain.ts) through GitHub, and the local site/editor
references at `bca213452566152ed4b1b55dbdf8294c10d9a33a` and
`db3f4171d6ea4689d6048d2252b6553da4599906`. Other consumer audits remain adoption work.
Search results alone do not establish that a repository contains no report literals.

Existing downstream pin PRs and fixed CI engine revisions remain their own configuration items.
This proposal does not authorize changing those pins or PRs, or mark their obligations complete.
TypeAudio candidate CI in compiler PR #1038 still depends on its separate engine PR and fixed
revision. A 0128 adoption must use reviewed pins and must not silently replace that baseline.
Downstream assignees and delivery dates are unassigned.
