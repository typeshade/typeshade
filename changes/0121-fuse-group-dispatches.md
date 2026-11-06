---
id: '0121'
title: Each fuse report group carries the number of device dispatches it made
status: implemented
rules:
  - '11.13'
surface:
  - 71
exports:
  - FuseReport
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: Explain group dispatch counts in both languages and update report examples when the compiler pin moves; record 0121.
  - repo: vscode-typeshade
    what: Update the host reference and report fixtures with the required group count when the compiler pin moves; record 0121.
  - repo: radiance
    what: Audit report literals and explain displays for the required field; record 0121 when the compiler pin moves.
  - repo: typenn
    what: Update any hand-built report groups and their fixtures; record 0121 when the compiler pin moves.
  - repo: typecv
    what: Update any hand-built report groups and their fixtures; record 0121 when the compiler pin moves.
  - repo: typeaudio
    what: Read group.dispatches in explain instead of counting workgroupShapes; update candidate W and record 0121 when the compiler pin moves.
---

**Document control**

| Field                         | Record                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0121, implemented in PR #1040 after the accepted merge. Front matter controls its lifecycle.                                       |
| Date and attribution          | Authored 2026-11-06 UTC by Codex in response to the owner's request to progress unstarted issues. This is an authorship date, not approval. |
| Request source                | Issue [#985](https://github.com/typeshade/typeshade/issues/985), reporting TypeAudio experiment 6 at compiler pin `14566606`.               |
| Applicability / Effectivity   | Fuse execution and reporting on WebGPU, WebGL2 and CPU. Release version unassigned.                                                         |
| Review baseline               | Compiler `main` at `324251dfe7755f78041eb44a1bfe85e4294e12dd`, inspected on 2026-11-06 UTC.                                                 |
| Review and revision authority | Proposal [PR #1036](https://github.com/typeshade/typeshade/pull/1036). Git records revisions; the reviewed accepted merge records approval. |

## What changes

**Before implementation.** A plan reports its total `dispatches`. Each group reports its tier and
workgroup shapes, but no count. Shapes omit reduction folds, push stages and store-only entries.
They cannot determine the group's actual dispatch count.

**Approved behavior.** Add required `readonly dispatches: number` to each `FuseReport.groups`
member. The count is a non-negative integer with the plan's existing unit:

- WebGPU: each encoded direct or indirect compute dispatch counts once. Reduction folds,
  push count/scan/store stages and store-only entries belong to their executing group.
- WebGL2: each draw used to execute the group counts once.
- CPU: zero device dispatches, regardless of the number of CPU iterations.

Every successfully returned report satisfies
`report.groups.reduce((n, group) => n + group.dispatches, 0) === report.dispatches`.
A group that encodes no device operation reports zero. An indirect dispatch still counts once
when its device-held dimensions are zero: the host must not read them to count the command.
A failing scope still rejects; this proposal adds no partial report.

`mergeReports` preserves each group's count and continues summing plan totals. Empty reports
keep their current shape. Submissions, timing, tier selection, group boundaries and fusion facts
retain their meanings. `workgroupShapes` remains shape information, not an operation count.

Rule 11.13 and surface §71 will state the group count and sum invariant. The misleading comment
that every fused group is one dispatch will distinguish the loop dispatch from reduction folds.

## Why

Issue #985 reports ten dispatches across five groups, but only three workgroup-shape entries.
Its consumer inferred one dispatch for a push and zero for a store-only call. The issue's
measurements are reported evidence, not a measurement repeated while drafting this proposal.

At the review baseline, `src/core/fuse-plan.ts` maintains `GpuCounts` for the plan and tracks
`run.group` while executing each settled group. Its report construction exposes no group count.
`src/core/fuse-report.ts` documents the omitted fold and store entries explicitly.

An optional field avoids changes to report literals but leaves consumers unable to distinguish
missing evidence from zero. A required field gives each returned report a checkable invariant.
Expanding `workgroupShapes` into an operation log is a different API and would still need a
meaning on WebGL2. This proposal adds the count directly.

## What it touches

- Rule 11.13: require group counts and equality with the plan total; synchronize and review its
  Doorstop item and dependent surface item in `reqs/`.
- Surface §71: update the report listing, JSON examples, reductions, CPU/WebGL2 explanations
  and `mergeReports` paragraph. No other section is expected to change.
- Export `FuseReport`: add the required field to its group type and bake `src/__api__/surface.md`.
  The function signature of `mergeReports` does not change.
- Execution: attribute increments at the same sites that already count plan operations, using
  the active settled-group index. Do not derive counts from shapes or reimplement dispatch rules.
- Tests and fixtures: update compiler report literals, host examples and journeys that compare
  full reports. The set of examples and diagnostic codes does not change.

### Impact estimate

Known compatibility impact: consumers reading reports continue to work. TypeScript consumers
constructing a group literal must add `dispatches`; serialized fixtures gain a field. The
implementation must document this required type field in `CHANGELOG.md` under `### Changed`.
Rule 13.9 requires a new minor release before `1.0.0` for this source-breaking type change.
The migration is to give each hand-built group its actual device-command count, using zero for CPU groups.
Rule 13.10 permits a source-breaking change before `1.0.0` without a deprecation window when
it does not silently change computed values. Existing report values retain their meaning.
No release version or calendar schedule is assigned.

Estimated work: extend accounting, update report types and fixtures, and verify each tier.
No new runtime dependency or GPU query is proposed. CPU overhead, bundle growth and delivery
time are unestimated; measure them before delivery. Change 0118 already supplies group tiers.

The owner's approval covers the required field, command-count semantics including
zero-dimensional indirect dispatches, the sum invariant and the declared downstream obligations.
Release handling follows Rules 13.9 and 13.10; this proposal does not authorize publication of a release.

### Approval and plan record

On 2026-11-06 UTC, the owner replied "승인" (approved) in the task conversation after receiving
the link to proposal [PR #1036](https://github.com/typeshade/typeshade/pull/1036).
The reviewed proposal revision was `aed075dbd7c678948699dcac28c8e7edfdedd35e`.
This revision records that decision and the existing release policy; it adds no implementation scope.
PR #1036 merged as accepted at `07639439021f00143c3fa31f01e14ed289d26a98`,
the implementation baseline.

Codex handles the compiler implementation and its validation under the owner's task request.
The sequence is accepted-proposal merge, implementation PR with the required evidence, then
compiler merge after required checks pass. No milestone dates were agreed.
Downstream adoption remains separate: its obligations are approved, but individual assignees
and pin schedules remain unassigned. Neither approval nor compiler delivery establishes adoption.

### Configuration and validation record

Implementation is on `feat/985-group-dispatches` from the accepted merge above.
On 2026-11-06 UTC, the affected four test files passed all 329 tests; build and bundle
boundary, lint, format, compile gate (203 examples; no failures), and journeys
(35 journeys, 126 runs) passed. Documentation references have no dead links,
and Doorstop passes after reviewing RULE-1113 and clearing SURF-038 and SURF-071.
Implementation PR: [#1040](https://github.com/typeshade/typeshade/pull/1040), first implementation
commit `d33ef48f2a13f2ab1a71d3dcc45db5527ac84e2c`. The full packed-package journey gate
also passed, including imported host modules and offline automatic fuse plans.
Integration with `main` at `4f70703b591978986c1926dca2bf1c626426d0bc` preserves the CPU
return-buffer optimization; its bundle caps are measured again below and the integrated
five-file suite passes all 333 tests. Final CI remains pending.
Configuration: Bun 1.4.4, Node 24.22.1, TypeScript 5.6.3, Vitest 5.0.5, Doorstop 3.2.
Node differs from the repository's 24.19.0 pin; pinned CI remains required.

Required functional evidence:

- A recording WebGPU device observes push, store-only, fused and reduction-fold commands.
  Group counts equal these observations and sum to the plan total. A deliberately wrong count
  must fail the test.
- Cover direct and indirect entry calls, a zero-work group, a multi-loop call, mixed tiers,
  CPU-only plans and the empty plan.
- A real WebGL2 execution compares group counts with observed draws. A WebGPU journey checks
  its report against recorded device calls and checks values against an independent reference.
- `mergeReports` retains group objects and counts, and satisfies the sum invariant across
  reports with different tiers.
- Run affected tests, build, lint, format, bundle boundary, compile and journey gates.

Required document evidence: bake the API surface; synchronize requirements; review suspect
links; pass Doorstop, document references, documentation impact, IfChange and proposal scope.
Record deviations and unperformed checks explicitly. Compiler completion does not establish
any downstream's adoption.

### Measured implementation cost

Measured with Bun 1.4.4 on Linux, 2026-11-06 UTC. The accepted base and the documentation-only
proposal branch have identical runtime, fuse and common-module sources. After integrating
main's CPU return-buffer optimization, the comparison is against main `4f70703b`.
`bun run gate:boundary` measures gzip bytes with every export retained:

| Subpath    | Single file, before → after | Split initial, before → after | Split total, before → after |
| ---------- | --------------------------- | ----------------------------- | --------------------------- |
| runtime    | 153129 → 153152             | 38589 → 38637                 | 155026 → 155126             |
| emit       | 117301 → 117301             | 117301 → 117301               | 117301 → 117301             |
| fuse       | 113926 → 114002             | 15670 → 15726                 | 114383 → 114510             |
| algorithms | 51383 → 51458               | 51383 → 51458                 | 51383 → 51458               |
| random     | 33393 → 33441               | 33393 → 33441                 | 33393 → 33441               |

The changed caps are the measured sizes; floors are unchanged. One count array is allocated
per plan, and each returned group gains one number. Each encoded WebGPU command performs one
extra indexed increment; WebGL2 adds its existing draw total to the owning group. No query,
readback or dependency is added. CPU plans populate zero counts when constructing their reports.

CPU wall-time sample: Bun 1.4.4, separate processes in baseline/candidate/candidate/baseline
order, 10,000 warm-up scopes and seven batches of 10,000 awaited scopes for each group count.
Each group scales one resident f32 value; 0 groups measures the empty scope. Baseline checkout
`82107d37` has main's runtime sources unchanged; only compiler diagnostics differ. Candidate is
`d33ef48f` integrated with `4f70703b`, before this documentation-only record. The resulting value
is checked. Times are microseconds per scope; every sample is retained below.

| Process       | Groups | Median  | Seven batches (µs/scope)                                     |
| ------------- | ------ | ------- | ------------------------------------------------------------ |
| A (baseline)  | 0      | 3.245   | 4.628, 3.462, 2.731, 2.432, 3.245, 3.811, 3.091              |
| A (baseline)  | 1      | 23.945  | 23.945, 62.086, 19.616, 28.612, 24.724, 13.268, 20.388       |
| A (baseline)  | 8      | 143.395 | 196.650, 170.886, 112.215, 126.052, 143.395, 166.840, 83.771 |
| B (candidate) | 0      | 2.832   | 5.133, 3.588, 2.874, 2.832, 2.096, 2.173, 2.728              |
| B (candidate) | 1      | 14.339  | 18.971, 14.728, 12.674, 12.869, 14.339, 14.491, 12.182       |
| B (candidate) | 8      | 107.626 | 122.316, 107.626, 85.225, 86.948, 91.571, 123.975, 109.574   |
| C (candidate) | 0      | 3.335   | 7.664, 3.335, 2.681, 3.605, 11.645, 2.067, 2.248             |
| C (candidate) | 1      | 16.879  | 24.149, 29.292, 16.661, 17.568, 15.044, 14.113, 16.879       |
| C (candidate) | 8      | 87.424  | 87.424, 100.021, 74.248, 70.856, 75.372, 98.469, 91.651      |
| D (baseline)  | 0      | 2.786   | 5.538, 3.802, 2.259, 4.886, 2.786, 2.023, 2.068              |
| D (baseline)  | 1      | 15.221  | 21.378, 15.221, 12.431, 17.947, 16.111, 13.294, 13.100       |
| D (baseline)  | 8      | 85.494  | 79.544, 85.494, 110.770, 81.308, 101.047, 100.408, 80.239    |

These noisy process measurements do not establish a CPU overhead bound or a speedup. The first
baseline process overlapped the bundle measurement; later batches still vary with warm-up and
scheduling. The per-command cost is the indexed increment described above. No hardware GPU
timing claim is made. Reproduce by saving the following script outside the checkout and running
`bun <script> <checkout>` in the stated order, with all checkouts' dependencies installed:

```ts
import { resolve } from 'node:path';
const root = process.argv[2]!;
const { configure, resident } = await import(resolve(root, 'src/core/resident.ts'));
const { fuse } = await import(resolve(root, 'src/fuse.ts'));
const { scale } = await import(resolve(root, 'src/algorithms/index.ts'));
configure({ prefer: ['cpu'] });
const x = resident(new Float32Array([1]));
const y = resident(new Float32Array(1));
for (const groups of [0, 1, 8]) {
  const body = () => { for (let j = 0; j < groups; j++) void scale(y, x, 2); };
  for (let i = 0; i < 10000; i++) await fuse(body);
  const samples = [];
  for (let round = 0; round < 7; round++) {
    const start = performance.now();
    for (let i = 0; i < 10000; i++) await fuse(body);
    samples.push((performance.now() - start) * 1000 / 10000);
  }
  console.log(JSON.stringify({ root, groups, microsecondsPerScope: samples }));
}
if ((await y.read())[0] !== 2) throw new Error('wrong CPU result');
x.destroy(); y.destroy();
```

No delivery date was promised; implementation and local validation took place on 2026-11-06 UTC.
The compiler PR's Git history records the implementation revisions and CI configuration. All six
downstream adoptions remain open; a compiler merge is not evidence of their completion.

## What it owes downstream

The website was searched at `bca213452566152ed4b1b55dbdf8294c10d9a33a`. Its
[src/i18n/en.ts](https://github.com/typeshade/typeshade.github.io/blob/bca213452566152ed4b1b55dbdf8294c10d9a33a/src/i18n/en.ts) and [src/i18n/ko.ts](https://github.com/typeshade/typeshade.github.io/blob/bca213452566152ed4b1b55dbdf8294c10d9a33a/src/i18n/ko.ts) explain fusion reports and workgroup shapes. Update both
languages to distinguish counts from shapes and update displayed report examples.

The editor was searched at `db3f4171d6ea4689d6048d2252b6553da4599906`. Its
[plugins/typeshade/skills/typeshade/references/host.md](https://github.com/typeshade/vscode-typeshade/blob/db3f4171d6ea4689d6048d2252b6553da4599906/plugins/typeshade/skills/typeshade/references/host.md) describes `FuseReport` and workgroup
shapes. Update the report reference and matching fixtures.

TypeAudio's issue evidence identifies its explain module and candidate W in its compiler asks.
Replace the shape-length inference with `group.dispatches`. That repository was not read in
this drafting session; its exact implementation and pin require confirmation before downstream adoption.

Radiance, TypeNN and TypeCV must audit hand-built reports before adopting the required field.
Their current report literals were not inspected here. Do not infer that no change is needed.
Each adopting repository records 0121 in its compiler-change record. All downstream work is
pending, and assignments are unconfirmed.
