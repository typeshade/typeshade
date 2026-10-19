---
id: '0069'
title: 'A tiled compute entry with workgroup memory can be a call inside a fuse scope'
status: implemented
rules:
- '8.24'
- '11.8'
- '11.13'
surface:
- 67
- 71
exports: []
exports-removed: []
codes: []
examples: []
downstream:
- repo: typeshade.github.io
  what: The English API reference is generated from the JSDoc of fuse. The Korean entry content/api/ko/fuse.json, a hand translation keyed by a hash of that JSDoc, lists the calls a body refuses, an entry call among them, and is translated again. The site has no page that copies §67 or §71. A tiled-matmul page or example waits for decision Q7.
- repo: vscode-typeshade
  what: references/host.md (the fuse passages at lines 81, 292 and 293, and the sentence at line 421) and SKILL.md name the entry call among the calls a fuse body refuses. They describe the entry call in a body instead. compiler-changes.md records 0069 when the pin moves.
---

<!-- doc-refs: skip-file — this accepted proposal names the files, options and tests that a later implementation adds, which this tree does not have yet -->

**Document control**

| Field                       | Record                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document                    | Proposal 0069; this file is the proposal source and the record of its delivery. It has status `implemented`. Option A is the decided design. Options B and C are recorded as alternatives that this proposal does not take.                                                                                                                                                                     |
| Revision context            | Drafted 2026-10-13, Asia/Seoul. This date is the authoring context. It is not an approval date. The owner decided the option on 2026-10-13 (Asia/Seoul); see Approval and plan record. A verification pass of 2026-10-13 (UTC) read every claim again at `96dbaa9f`. It corrected the CPU-tier claim, removed Rule 10.5 and surface §24 and §25 from the declared impact, and closed Q4 and Q5. |
| Request source              | The repository owner, Seungup, asked in the project conversation for tiled kernels that can join a fused plan. It follows a gap analysis of TypeNN training profiles. TypeNN's matmul and convolution are naive kernel functions. No GitHub issue is recorded for this draft.                                                                                                                   |
| Current lifecycle state     | `implemented`, by PR #667 (merged 2026-10-13, head `772d4501`; see Configuration and validation record). Accepted by the owner's decision of 2026-10-13, recorded by the merge of PR #654. The record of 2026-10-19 sets the status and adds the measurements of Q2 at 512 and Q3 on a software device. The downstream work of the site and the editor is not started.                          |
| Applicability / effectivity | Compute entries with workgroup memory and barriers (Rule 8.24, surface §24 and §25), the entry call (surface §67, `callCompute` in `src/core/host-compute.ts`), the fuse planner and recorder (Rule 11.13, surface §71, `src/core/fuse-plan.ts`, `src/core/fuse-scope.ts`), and downstream documentation. No release version is assigned.                                                       |
| Review baseline             | `origin/main` at `96dbaa9fa7208aa786a4937a8c90521e59023ffa` (commit "Copy flat f32, i32 and u32 arrays as bytes in pack and readInto (#648)").                                                                                                                                                                                                                                                  |
| Proposal review             | [PR #654](https://github.com/typeshade/typeshade/pull/654), the proposal-only pull request.                                                                                                                                                                                                                                                                                                     |
| Revision authority          | Git records the revisions of this file. The review and merge of PR #654 record the decision.                                                                                                                                                                                                                                                                                                    |

## What changes

**Before.** A compute entry may declare `workgroup<T>` memory and call `workgroupBarrier()` (surface §24 and §25). A host calls the entry as `entry(bindings, workgroups)` (Rule 8.24). Inside a `fuse` body an entry call is a `TypeError` that names the call (Rule 11.13, `callCompute` in `src/core/host-compute.ts`, line 66), because it would run before the calls recorded earlier. The text is `blur(): an entry call cannot run inside fuse(), which records kernel calls only. Call it outside fuse().` (surface §71). A tiled matmul therefore cannot join a fused plan. A host that wants it must end the scope, call the entry, and start a new scope. Each entry call outside a scope is its own submission: `onGpu` (`src/core/host-entry.ts`, line 1258) makes a `DispatchBatch` for the one dispatch and flushes it.

**Decided design (option A).** A call of a compute entry is allowed in a fuse body, under these rules:

1. The entry call takes its bindings as Rule 8.24 gives them. Each array the call reads or writes is a `Resident` (Rule 11.13). A call in the body that writes a host array stays a `TypeError`.
2. The planner gives the entry call its own group. No kernel call joins the group before or after it. The rule is a new fact of Rule 11.13: F8. Proposal 0067 adds F7. The owner fixed both numbers on 2026-10-13 (decision D1), so the two proposals do not depend on each other and land in either order.
3. The group runs as one dispatch of the entry, in the order of the plan. The planner records the call in the report's `calls`, under the entry's name.
4. The entry's bindings, its workgroups and its result follow Rule 8.24 unchanged.
5. On WebGL2 the entry runs by the pass program of change 0054, as it runs outside a scope (Rule 10.5 already lifts the deferral of barriers for a compute entry). Rule 11.13 already runs the calls of a scope apart on WebGL2.
6. The CPU tier of the call layer has no barrier (Rule 8.24). An entry that reaches `workgroupBarrier()` has no CPU tier in a scope either, and `callCompute` refuses it with the `TypeError` it gives outside a scope: it needs a GPU tier. The CPU oracle (`dispatch` of `compileModule`, surface §25) runs barriers in lockstep, so it is the reference for bit equality with WebGPU. That equality depends on Q3.

The body of a `fuse` call that is not an entry stays as Rule 11.13 states. A draw, a host write and a read of a `Resident` in the body keep their `TypeError`.

**Example (illustrative, not an accepted example).** A host records a tiled matmul (an entry) and then a bias map (a kernel function). `a`, `b`, `c`, `v` and `out` are `Resident` arrays:

```ts
import { fuse } from "typeshade/fuse";
import { matmul, bias } from "./tiled.shade.ts";

await fuse((scope) => {
  matmul({ a, b, c }, [n / 16, m / 16]); // an entry call: one dispatch, its own group
  bias(c, v, out); // a kernel call: a group of its own, after the matmul
});
```

The example is illustrative. The example set does not change in this proposal (decision Q7). The map cannot join the matmul's group, so the matmul's output reaches it through the `Resident` `c`.

## Why

The fuse planner joins kernel loops. It knows each loop's counter and each array's access at that counter (Rule 8.22, Rule 11.13 F1 to F6). A tiled kernel reads a tile at an index that the loop counter does not give. A proof of its accesses would need new facts, not new spellings. So the tiled kernel is not a kernel loop. It is an entry. An entry already has its own dispatch, its own bindings and a defined WebGL2 tier (change 0054, Rule 10.5).

The owner needs TypeNN's matmul and convolution to run tiled and to join a fused plan. Without a rule change, the tiled matmul runs as an entry called outside the scope. Each call then costs a submission. The benefit of (A) is the removal of that break, and the matmul's own speed comes from its tiling.

**Options.** Each option names what it touches. The owner decided option A on 2026-10-13. Option B is rejected. Option C is deferred.

- **Option A. An entry call is a fuse call that forms its own group (decided).**
  - Touches: Rule 8.24 (an entry may be called in a scope), Rule 11.8 (its tier), Rule 11.13 (F8 and the `TypeError` list), surface §67 and §71.
  - Trade-off: the matmul's output reaches the next map only through a `Resident`. The planner does not contract the matmul into the map. The gain is one submission for each entry call, and the tiling itself.
  - Determinism: the entry's sum order is the source order of each invocation. Rule 7.2 tree order does not apply to the entry's loop, because the entry is not a kernel loop. See Q2.
  - WebGL2: the entry uses the phased model of change 0054, which already lifts the barrier deferral of Rule 10.5 for compute entries.
- **Option B. A new kernel-function form with a tile loop, workgroup memory and barriers (rejected).**
  - Touches: Rule 8.22 (R6 forbids barriers and workgroup memory in a loop; a new form relaxes it under new facts), Rule 8.23, Rule 11.8 (a WebGL2 tier for kernel functions with barriers, which 0054 does not give to kernel functions), Rule 11.13 (F1 to F6 assume identity indices), surface §65.
  - Trade-off: this keeps the tile inside a kernel function, so the planner could in principle contract it. It needs new proof rules for tile indices and new facts for F3, and a new barrier model for kernel functions on every tier. The rule change is large. The owner rejected this option. It stays recorded so that a later proposal can read the reasons.
- **Option C. A library recipe: a built-in tiled matmul (deferred).**
  - Touches: an exported module of `typeshade/*` (a new public export, which `src/__api__/surface.md` lists) and an example or journey (a visible change).
  - Trade-off: a built-in gives the fastest path for users who need only matmul. It does not join a fused plan unless option A also holds. It adds a name to the public surface that Rule 13.6 must justify. A user can already write the recipe as an entry today (Rule 8.24) without any rule change. The owner deferred this option. It may follow as a later proposal, which this proposal does not number.

**Decision.** Option A. The owner chose it on 2026-10-13. It makes the smallest rule change that lets a tiled kernel join a plan. It uses the entry model that already has WebGPU and WebGL2 tiers and a CPU order. Option C is a separate choice that may follow as a later proposal. It does not replace A.

## What it touches

- **Rule 8.24:** an entry may be called inside a `fuse` body, with the bindings of Rule 11.13.
- **Rule 11.8:** the tier order of an entry call in a scope is the order of an entry call outside a scope.
- **Rule 11.13:** F8 (decision D1), "an entry call forms its own group; no kernel call joins it, and it joins none"; the `TypeError` list loses the entry call and keeps the draw, the host write, the read and every other use.
- **Surface §67:** the entry call inside a scope, and that an entry that reaches a barrier still needs a GPU tier there.
- **Surface §71:** F8, the report's `calls` for an entry, and the refusal table, which loses the row `an entry call (§67)`.
- **Not touched:** Rule 10.5, because the deferral of barriers is already lifted for a compute entry (change 0054), and surface §24 and §25, which name no fuse limit.
- **Documents:** `CHANGELOG.md` gains an entry. `reqs/` follows the edits of Rule 11.13 and of surface §67 and §71, through `bun run reqs:sync` and `python scripts/doorstop-check.py -C`. The JSDoc of `fuse` (`src/fuse.ts`) lists the calls a body refuses and changes with them.
- **Exports:** none. The `fuse` and `FuseReport` shapes do not change. The report's `calls` may name an entry, which is a text change, not a shape change.
- **Codes:** none. The new refusals stay runtime `TypeError`s, as Rule 11.13 states for the other calls.
- **Examples:** none. Decision Q7 ships no tiled-matmul example.

### Draft impact estimate

- **Technical work.** `FuseRecorder` (`src/core/fuse-scope.ts`) gains a method for an entry call, and `callCompute` (`src/core/host-compute.ts`, line 66) calls it where it calls `refuse` today. The planner in `src/core/fuse-plan.ts` and `src/core/fuse-group.ts` gets F8. On WebGPU the plan adds the entry's dispatch to its own `DispatchBatch`, so it shares the plan's submission (`onGpu`, `src/core/host-entry.ts` line 1258, shows the call). The WebGL2 path runs the entry's pass program apart.
- **Compatibility.** A `fuse` body that calls an entry today throws. After this change it runs. No other existing call changes.
- **Dependencies.** Change 0054 (the phased WebGL2 model, implemented). Proposal 0067 adds F7, and this proposal adds F8. The numbers are fixed (decision D1), and neither proposal depends on the other. The tile size needs no other change: an entry already carries its shape in `@compute` (Rule 8.7).
- **Validation work.** See the test list below. The measurement needs a GPU and a matching Tint compile (Rule 13.3).
- **Downstream effort.** The site and the editor describe the entry call in a scope.
- **Unestimated.** Effort, schedule and cost are unknown. None is recorded here.

### Decision of the owner

- **Option.** Decided on 2026-10-13 (Asia/Seoul): option A. An entry call forms its own group inside a `fuse` scope. Option B is rejected. Option C is deferred and may follow as a later proposal. The rules of "What changes" are the decided design.

### Questions closed or decided by default

Each is a numbering, scope or consistency choice. The owner confirmed each on 2026-10-13. Q2 and Q3 are measurements, not choices. The implementation owes them, and they do not block acceptance.

- **D1.** The new fact is F8. Proposal 0067 adds F7. The owner fixed both numbers on 2026-10-13, since the two proposals are accepted at the same time. No dependency exists between them.
- **Q1.** Can a map follow an entry in its group (an epilogue, such as bias and ReLU, in the same dispatch)? Default: no in v1. Each entry call is its own group. An epilogue is a later proposal.
- **Q4.** Where is the uniformity rule of `workgroupBarrier()` met? Closed: it is not a choice. The rule of surface §25 applies as it does outside a scope. A tile load past the matrix edge clamps its index and does not return early, so every invocation reaches each barrier. The compiler refuses a barrier in non-uniform control flow (TS8052).
- **Q5.** Which tile size is the default? Closed: there is no default. The author writes the entry's shape in `@compute` (Rule 8.7, for example `@compute([16, 16])`, and change 0057 allows `u32` override names). Proposal 0067 concerns kernel functions and is not needed. TypeShade has no check of the workgroup memory size against `maxComputeWorkgroupStorageSize` (inference from a search of `src/` on 2026-10-13: only the coverage tables name it). WebGPU's pipeline creation refuses an entry past the limit.
- **Q6.** Does an entry in a scope on WebGL2 run apart, as a scope runs its calls on WebGL2 (Rule 11.13), or may the pass program join a group? Default: apart, in v1.
- **Q7.** Does the proposal ship a tiled-matmul example or a library recipe (option C)? Decided: neither. A shipped example changes the set of `examples/*.shade.ts` and needs `examples` in the front matter of its own proposal. Option C is deferred (see Options). A later proposal decides both after option A is measured.
- **Q8.** Does the owner keep option B as a later option? Decided: option B is rejected. It stays as recorded text for its reasons, and no later work is scheduled.

### Measurements owed by the implementation

The owner decided on 2026-10-13 that these two measurements do not block acceptance. The first implementation step runs them, and the implementation record states the results.

- **Q2.** Does the tiled sum equal the naive sum bit for bit? The tiled kernel must add the products in ascending `k` order, as the naive kernel does. The naive kernel's inner sum must also run sequentially in its lowered code. The first implementation step checks that, on the CPU oracle and in WGSL.
- **Q3.** Does the driver or Tint contract `acc = acc + a * b` into a fused multiply-add? If it does, the WebGPU bits differ from the CPU oracle. Rule 13.3 requires a measurement on Tint and on the device before this is kept. The result is not known yet.

### Approval and plan record

- **Decision.** The owner approved the proposal in the project conversation on 2026-10-13 (Asia/Seoul). The owner decided option A (an entry call forms its own group inside a `fuse` scope), rejected option B, deferred option C, fixed F8 for this proposal and F7 for 0067, and confirmed the defaults. The owner asked for the proposal to move to `accepted`. The merge of PR #654 records the acceptance.
- **Approved revision.** This file at the commit that PR #654 merges. Git records that commit.
- **Scope.** Option A as "What changes" states it, with D1 and Q1 to Q8 as written above. No decision is open.
- **Responsibilities and milestones.** Unassigned. No schedule, owner or estimate is established.
- **Measurements.** Q2 and Q3 are owed by the implementation. They are not blockers.
- **Required validation.** The validation list below. None has run.

### Implementation record (branch `claude/impl-0069-tiled-entry-fuse`)

PR #667 merged on 2026-10-13 at head `772d4501`. The status moved to `implemented` with the record of 2026-10-19, below. Commits, each with `Change: 0069`:

- `169a7491`: F8 and the entry call in a scope (rules, surface, planner, run, tests).
- `654091bc`: a test that a fused entry binds through the device's bind-group cache (#658).
- `006e5e1a`: the `typeshade/fuse` budget raised from 86000 to 95824 bytes gzipped, where main measured 76430 and this branch 86254 (growth 9824); Doorstop items reviewed or cleared.
- Independent verification (this pull request's review pass): the growth came from `core/fuse-plan.ts` importing `core/host-compute.ts`, which pulled `core/gl-compute.ts`, `core/host-draw.ts` and `core/passes/phase-schedule.ts` into the closure of `typeshade/fuse`. The plan now receives `checkEntryCall`, `residentsOf` and `runEntry` from `callCompute` at the call (`entryHost` in `core/host-compute.ts`) and imports their types only. The branch measures 77038 bytes (growth 608), and the budget returns to 86000. A plan that read a `Resident` back for an entry on WebGL2 or the CPU did not count the read in `submissions`, as a kernel call does; it counts it now. Tests added in `src/fuse.test.ts` for the order of an entry and a kernel over one `Resident` (CPU and WebGPU), the plan record of an entry, one uniform for each entry call in one submission, a failed plan, a bad entry call in the body, and an entry on WebGL2.

Deviations, with disposition:

- Scratch arrays: an entry call in the body that takes a scratch array is refused with the kernel-call wording. The proposal does not declare it. Disposition: accepted by the owner, 2026-10-13.
- Host arrays: the proposal's "each array the call reads or writes is a Resident" is applied literally, so a host read-only array in an entry call in the body is refused. Kernel calls accept host reads. Disposition: accepted by the owner, 2026-10-13.

Measurements (Q2): the CPU oracle gives the tiled entry the bits of the naive kernel at 32, 64 and 128 (test at 32 and 64). The 512 by 512 run is in the Configuration and validation record.

Not run at the merge of PR #667: Q3 (FMA contraction on device), hardware timing of 512 by 512 on a named WebGPU device, WebGL2 run of an entry in a scope, the `gate:differential` arm. The record of 2026-10-19 closes Q3 on a software device and the `gate:differential` arm, and leaves the other two pending.

### Configuration and validation record

- **Accepted revision.** This file at the merge of PR #654 (`a4a2a777`).
- **Implementing pull request.** [PR #667](https://github.com/typeshade/typeshade/pull/667),
  branch `claude/impl-0069-tiled-entry-fuse`, from `main` at `f22288f6`, merged on 2026-10-13 at
  head `772d4501`. Its commits carry `Change: 0069`: `169a7491`, `654091bc`, `006e5e1a`,
  `fb5e1983` and `772d4501` (Implementation record). The record below was added on 2026-10-19 by
  the pull request that sets the status, which Git knows.
- **Delivered configuration.** `src/core/fuse-scope.ts` (the recorder's entry call),
  `src/core/fuse-group.ts` (`EntryCall`, fact F8), `src/core/fuse-plan.ts` (an entry's group,
  its dispatch in the plan's batch, `EntryHost`), `src/core/host-compute.ts` (`entryHost`:
  `checkEntryCall`, `residentsOf`, `runEntry`; `callCompute` records in a body), `src/fuse.ts`
  (JSDoc), Rules 8.24, 11.8 and 11.13, surface §67 and §71, `AUTHORING.md`, `CHANGELOG.md`,
  `src/AGENTS.md`, `reqs/`. Tests: `src/compiler/ts/tiled-matmul.test.ts` (new),
  `src/core/fuse-group.test.ts`, `src/fuse.test.ts`. No export, code or example changed.
- **Functional validation, observed on 2026-10-13 (PR #667).** CI on `772d4501`: `typecheck +
unit`, `typecheck + unit (TypeScript 5.9.3)`, `typecheck + unit (TypeScript 6.0.3)`, `compile
gate (Tint + WebGL2)`, `user journeys (packed tarball, WebGPU)`, `render gate (WebGPU + pixel
golden)`, `traceability (Doorstop)` and `change scope` green. `src/fuse.test.ts` 153 tests,
  `gate:compile` 163 examples with 0 failures, `gate:boundary` `typeshade/fuse` 77,038 bytes
  against 86,000 (PR #667's record).
- **Functional validation, observed on 2026-10-19 at `main` `be90a21`** (bun 1.4.2, TypeScript
  5.6.3, headless Chromium 141 `chromium-1194` with SwiftShader, a software device).
  `bunx vitest run src/compiler/ts/tiled-matmul.test.ts src/core/fuse-group.test.ts
src/fuse.test.ts`: 273 tests pass. `bun run gate:differential`: the WebGPU arm, the chain arm,
  the WebGL2 arm (288 generated functions, 66,811 values bit for bit, 0 failures) and the compute
  arm (23 compute entries on WebGL2 in two layouts, 25,054 storage words, 0 failures) pass; this
  closes "the `gate:differential` arm" of the Implementation record. `bun run gate:boundary`:
  `typeshade/fuse` 81,173 bytes against 86,000 (other changes since 0069 moved it).
- **Q2 (bit equality of the tiled entry and the naive kernel on the CPU oracle).** At 32 and 64
  by the test, at 128 by PR #667's record. At 512 on 2026-10-19 (`main` `be90a21`, bun 1.4.2, the f64 oracle, the test's inputs): 0 of 262,144 values differ between the tiled entry dispatched as `[32, 32, 1]` and the naive kernel. The oracle took 724.9 s for the tiled entry and 36.0 s for the naive kernel on this container, a cost of the lockstep interpreter and no measure of a GPU.
- **Q3 (contraction into a fused multiply-add on a device).** Measured on 2026-10-19 on
  SwiftShader (adapter `google swiftshader`, Chromium 141, Tint of that build), a software device,
  with a probe that compiles the test's tiled entry to WGSL, creates the shader module (Tint
  reported no compilation message), dispatches `[N / 16, N / 16, 1]` and reads `c` back. With f32
  inputs, the device's words equal the f32 oracle's (`compileModule(module, { precision: 'f32' })`,
  the same inputs) and a plain sequential f32 sum (each product and each sum rounded, ascending
  `k`) bit for bit: 0 of 4,096 values differ at N = 64 and 0 of 16,384 at N = 128. So this Tint
  and SwiftShader do not contract `acc + a * b`. The 512 by 512 run against the f32 oracle started on 2026-10-19 and had not finished at the commit that carries this sentence; the next commit records its result. Q3 on hardware (a named
  WebGPU device and its driver) stays pending: Rule 13.3 needs that measurement before the bit
  claim is kept for hardware. Observation of the probe, not a defect: the oracle takes the inputs
  it is given, so a probe that hands it f64 inputs and the device f32 words sees differences at
  almost every value (3,607 of 4,096 at N = 64); with f32 inputs on both sides there are none.
- **Document validation, observed on 2026-10-19.** `bun run docs:impact`, `bun run docs:refs` and
  `bun scripts/changes.ts --base origin/main` on the commit that carries this record, as its
  pull request states.
- **Deviations.** Two, both closed: D1 (a scratch array in an entry call in the body is refused,
  as surface §71 already requires) and D2 (a host read-only array in an entry call in the body is
  refused). Disposition of each: accepted by the owner on 2026-10-13, recorded in PR #667.
- **Pending.** Hardware timing of the 512 by 512 matmul, tiled and naive, on a named WebGPU
  device (the acceptance criterion's factor). Q3 on hardware. A WebGL2 run of an entry in a scope
  on a real context (the `gate:differential` compute arm runs entries on WebGL2 outside a scope;
  `src/fuse.test.ts` runs the scope's WebGL2 path with `runGlCompute` mocked). The downstream work
  of `typeshade.github.io` and `vscode-typeshade` (What it owes downstream), each until its pin
  moves.

The validation list the acceptance required follows, as approved.

**Validation (required before the implementation merges).**

- Both halves (CLAUDE.md "A test reads both halves"): `compile()` and the language service give the same diagnostics for the tiled entry's source. The refusals of this proposal are runtime `TypeError`s of the call layer and no diagnostic, so the test of a refusal asserts the `TypeError` text for a host array in the body, which is unchanged.
- `src/core/fuse-group.test.ts`: an entry call forms its own group; a kernel call before and after it does not join it (F8).
- CPU oracle (`dispatch` of `compileModule`, which runs barriers in lockstep): the tiled entry's output and the naive kernel's output are equal bit for bit on a 512 × 512 matrix. The call layer's CPU tier refuses the entry (point 6).
- Tint: the tiled WGSL compiles (`gate:compile`), with its FMA behavior recorded (Q3).
- WebGL2: the entry runs by the pass program and matches the CPU oracle on the same matrix.
- Hardware: a 512 × 512 matmul, tiled and naive, on one named WebGPU device, each run at least five times. Record the device, driver, date, median times and the factor between them.
- `bun run build`, `bun run test`, `bun run gate:compile`, `bun run docs:refs`, `bun scripts/changes.ts`, `bun run docs:impact`.

**Acceptance (for the eventual implementation).** A 512 × 512 tiled matmul matches the CPU oracle bit for bit. It beats the naive kernel function by a recorded factor on hardware. It appears in a `fuse` scope as one group, and the report shows that group.

## What it owes downstream

- `typeshade.github.io`, facts read at `0c56a88`. The site has no page that copies §67 or §71. The English API entry for `fuse` is generated from the JSDoc. The Korean entry `content/api/ko/fuse.json` lists the calls a body refuses, and it is translated again, since its source hash changes. Record 0069 in `compiler-changes.md` when the pin moves.
- `vscode-typeshade`, facts read at `bbb2d9e`. `references/host.md` lines 81, 292 and 293 and line 421 name the entry call among the refused calls. `SKILL.md` names the same list. Each describes the entry call in a body. Record 0069 in `compiler-changes.md` when the pin moves.
- Consumer note (not a downstream repository in the schema): TypeNN would use the tiled matmul and convolution through im2col. Its adoption is not part of this proposal's obligations.
