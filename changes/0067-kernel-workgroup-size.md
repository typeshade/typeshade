---
id: '0067'
title: 'A kernel function declares its workgroup size with @workgroup_size, and a fusion splits a chain where the sizes differ'
status: accepted
rules:
- '6.7'
- '8.22'
- '11.8'
- '11.13'
surface:
- 3
- 65
- 71
exports:
- FuseReport
exports-removed: []
codes:
- 'TS8077'
examples: []
downstream:
- repo: typeshade.github.io
  what: The API reference entry for FuseReport (English generated from the JSDoc, Korean content/api/ko/fusereport.json translated again). src/lib/error-codes.ts gains an example program and its fix for TS8077, which the build compiles against the pin. The site has no page that copies §65 or §71.
- repo: vscode-typeshade
  what: The skill's kernel-function and fuse sections (SKILL.md), references/host.md, the decorator list in references/language.md, and references/diagnostics.md for TS8077.
---

<!-- doc-refs: skip-file — this accepted proposal names the files, the tests and the diagnostic code that the implementation adds, which this tree does not have yet -->

**Document control**

| Field                       | Record                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document                    | Proposal 0067; this file is the proposal source.                                                                                                                                                                                                                                                                                                                                                                                                    |
| Revision context            | Drafted 2026-10-13, Asia/Seoul. This date is the authoring context. It is not an approval date. The owner decided D1 to D5 on 2026-10-13 (Asia/Seoul); see Approval and plan record. A verification pass of 2026-10-13 (UTC) read every citation again at `96dbaa9f`. It removed the claim about `reflect()` (decision D6), moved the diagnostic code from TS8076 to TS8077 (decision D7) and added the site's code example to the downstream list. |
| Request source              | The repository owner, Seungup, asked in the project conversation for a per-kernel workgroup size. The request follows a gap analysis of training profiles of TypeNN, a downstream consumer. No GitHub issue is recorded for this draft.                                                                                                                                                                                                             |
| Current lifecycle state     | `accepted`, by the owner's decision of 2026-10-13 (see Approval and plan record). The merge of PR #652 records the acceptance. No implementation exists.                                                                                                                                                                                                                                                                                            |
| Applicability / effectivity | Kernel functions (Rule 8.22, surface §65), the WebGPU lowering of their loops (`lowerKernel`), the fuse planner (Rule 11.13, surface §71), `FuseReport`, and downstream documentation. No release version is assigned.                                                                                                                                                                                                                              |
| Review baseline             | `origin/main` at `96dbaa9fa7208aa786a4937a8c90521e59023ffa` (commit "Copy flat f32, i32 and u32 arrays as bytes in pack and readInto (#648)").                                                                                                                                                                                                                                                                                                      |
| Proposal review             | [PR #652](https://github.com/typeshade/typeshade/pull/652), the proposal-only pull request.                                                                                                                                                                                                                                                                                                                                                         |
| Revision authority          | Git records the revisions of this file. The review and merge of PR #652 record the decision.                                                                                                                                                                                                                                                                                                                                                        |

## What changes

**Before.** A kernel function has no workgroup-size spelling. `lowerKernel` in `src/core/passes/kernel-lower.ts` sets every loop that does not reduce to a workgroup of `KERNEL_WORKGROUP` (64, line 108). A loop that reduces (Rule 7.2) uses `KERNEL_TREE` (256, `src/core/kernel-tree.ts`). A fused entry has one `@workgroup_size`. The non-reducing branch of `assemble` in `src/core/fuse-entry.ts` throws `runs in workgroups of … and … in workgroups of …` when two calls of one group differ in size. No call sets a size today, so that throw is not reached. A group that ends in a reduction runs every call at 256, in its reducing entry.

**After.** An exported kernel function may carry the attribute `@workgroup_size` with an array literal. The argument grammar is the one Rule 8.7 gives `@compute`, with one extent: a positive integer literal or integer module constant in an array literal of one element (decision D8).

```ts
"use typeshade";

const TILE = 128;

@workgroup_size([TILE])
export function scale(out: array<f32>, a: array<f32>, k: f32): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i] * k;
  }
}
```

The loop lowers to one `@compute` entry whose WGSL reads `@workgroup_size(128)`. A kernel function with no attribute keeps 64 when it runs alone or in a group with no attributed call. Inside a group with an attributed call it takes the size of the group (F7). The rules of the new form are these:

1. A kernel function's `@workgroup_size` sets the workgroup of each loop that the function lowers to a compute entry.
2. A loop that reduces keeps the tree of 256 (Rule 7.2). An attribute on a kernel function with a reducing loop is refused (TS8077).
3. `@workgroup_size` on an exported `@compute` entry keeps its refusal and its text. The text still names `@compute`'s argument.
4. `@workgroup_size` on a function that is neither a kernel function nor an entry is refused with TS8028, as Rule 6.7 refuses an attribute the compiler does not read.
5. The attribute does not change a result. A loop of a kernel function writes each element from its own index `i` (Rule 8.22). The output bits are the same at every size. Only the time changes.
6. On WebGL2 the attribute is accepted and has no effect on the program. The fragment pass of Rule 11.8 has no workgroup.
7. The argument is checked as `@compute`'s is (Rule 8.7). A wrong argument is `TS8037`, and a shape over WebGPU's default limits is the `TS8026` warning. The text of both codes names the attribute that was written.

The attribute spells WGSL's own attribute name. It is not a new name. See "Why" for the alternatives.

**Fuse fact (F7).** Rule 11.13 gains a seventh condition for joining a group:

- F7: a call with `@workgroup_size` declares a size. A call with no attribute declares none: it has no preference and takes the size of the group it joins (decision D5, option b). In a group that does not reduce, every call that declares a size declares the same one. The size of the group is that size, or 64 when no call of the group declares one. A group that ends in a reduction has the size 256 (Rule 7.2) for every call in it, so a call that declares a size joins it only when the size is 256. A call that declares none joins a reduction as it does at `96dbaa9f`, since `fuse-group.ts` has no size fact today.

A call that fails F7 starts a new group. The `why` text names both sizes, for example `workgroup size 128 of scale() differs from 64 of add()` (when `add` carries `@workgroup_size([64])`), or `workgroup size 128 of scale() differs from the tree size 256 of total()`. A call with no attribute never fails F7, so it never starts a group for a size reason.

Proposal 0069 adds a separate fact, F8, for an entry call. The two facts do not depend on each other, and they land in either order. The owner fixed the numbers on 2026-10-13: F7 here, F8 there. The `FuseReport` group entry gains `workgroupShape`, the resolved triple of the group, `[n, 1, 1]`. The name `workgroupShape` is the one `ComputePipeline` already uses (change 0057). It is absent for a group that does not run on WebGPU, since WebGL2 and the CPU tier have no workgroup. `groupCalls` in `src/core/fuse-group.ts` checks F7 before an entry is built. The non-reducing branch of `assemble` then takes the size of the group from the calls that declare one, and no longer reads the `wg` of each call. So the throw in `assemble` is not reached by a group the planner forms.

**The face.** The host face of a kernel function already carries the size of each loop (`FuseLoop.wg`, `src/core/host-kernel.ts` line 127). `fuseRecord` (`src/compiler/ts/host-face.ts`, line 1099) also writes whether the author declared that size, so that F7 tells `@workgroup_size([64])` from no attribute (decision D5): the first declares 64, and the second declares none. `reflect()` (`src/core/reflect.ts` line 885) removes kernel functions before it reads a module (`withoutKernels`), so it reports no size for them. A host reads the size from the `FuseReport` group, after a run (decision D6).

**Excluded.** This proposal does not change:

- the tree of 256 for a reducing loop (Rule 7.2);
- the WGSL of an entry that `@compute` declares;
- the host call of a kernel function (surface §65 keeps `k(…)`);
- a size chosen by the host at each call (open decision D1).

## Why

The owner's gap analysis, from TypeNN training profiles, states that one fixed size does not suit each kernel. This is the owner's inference from the profiles. The profile numbers are not in this record. The measurement is owed by the implementation. Its record holds the numbers, with the device, the driver and the date (see Acceptance).

Alternatives, and why each is not chosen:

- **A new decorator, such as `@kernel([n])`.** Rule 13.6 admits an author-facing name only from WGSL or ECMAScript, and `kernel` is neither. A TypeShade extension needs a row of §9.3 and a reason, which a workgroup size does not need.
- **A call option, such as `k(…, { workgroupSize })`.** This changes the host call of §65 and Rule 8.21. The fuse planner would then learn the size at run time, but F7 needs it at build time, in the face (Rule 11.13: facts are written at build time).
- **One module-wide `override` constant.** It gives every kernel of a module one size. It cannot serve a chain whose calls need different sizes.
- **Keep 64 and let each thread do more work.** This changes the iteration structure that the proof of Rule 8.22 reads. It does not give the author a choice.
- **Reuse `@workgroup_size` as WGSL spells it.** Rule 6.7 already spells WGSL attributes with underscores when no other spelling exists (`@blend_src`, `@diagnostic`). Rule 6.7 gives `@workgroup_size` a refusal on entries, which this proposal keeps.

Assumptions:

- The first version takes integer literals and module integer constants only. A value from the host is not in v1.
- The size of a group is the size of each of its calls (F7), so a group has one `@workgroup_size` (WGSL requires one per entry).

## What it touches

- **Rule 6.7:** the attribute list gains `@workgroup_size` on a kernel function. The entry refusal is kept.
- **Rule 8.22:** a kernel function's loops take the size of the function's attribute, and a reducing loop keeps 256.
- **Rule 11.8:** the WebGPU lowering of a kernel function's loops uses the attribute. The WebGL2 and CPU tiers ignore it, and the results are unchanged.
- **Rule 11.13:** F7 is added. The report's group gains `workgroupShape`.
- **Surface §3:** the decorator list documents the attribute on a kernel function and the refusal on an entry.
- **Surface §65:** the kernel function's attribute, its argument grammar and the reducing refusal.
- **Surface §71:** F7, the split of a group, and the `why` text.
- **`FuseReport`:** each group gains `workgroupShape`. This reshapes an export listed in `src/__api__/surface.md`, which `bun run bake:api-surface` bakes again.
- **Code TS8077:** a kernel function with `@workgroup_size` and a loop that reduces. TS8076 is the next free number in `src/compiler/ts/codes.ts` at the review baseline, but draft proposal 0052 (branch `claude/wgsl-bitcast-nan-typeshade-5wltob-0050`) reserves it. This proposal takes TS8077 (decision D7). The text is written in the author's names, one sentence for the cause and one for the remedy (Rule 12.4): `"total" has a loop that reduces, which always runs in workgroups of 256. Remove @workgroup_size from "total", or put the reduction in a function of its own.` The implementation confirms the number against `codes.ts` when it lands. It adds the code to `src/compiler/ts/codes.ts`, and the language service reports it too (Rule 12.7; `src/language-service/diagnostics.ts`).
- **Existing codes whose text widens:** `TS8028` (the refusal of `@workgroup_size` moves from every non-entry function to a function that is neither a kernel function nor an entry), `TS8037` and `TS8026` (point 7). No number changes.
- **Examples:** none. An example is an open decision (D3).

### Draft impact estimate

- **Technical work.** The front end reads the attribute on a function that is not an entry (the refusal is in `src/compiler/ts/builtin-check.ts`, line 212). `lowerKernel` (`src/core/passes/kernel-lower.ts`) takes the size from the function, where it uses `KERNEL_WORKGROUP` (line 108) today. `groupCalls` (`src/core/fuse-group.ts`, line 300) adds F7 and its `why` text. The non-reducing branch of `assemble` in `src/core/fuse-entry.ts` takes the group's size from the calls that declare one. The face (`src/compiler/ts/host-face.ts`, `fuseRecord`) writes whether the size is declared. `runPlan` puts the group's shape in the report.
- **Compatibility.** A program with no `@workgroup_size` keeps 64 and 256 in every group. Its WGSL and its report do not change. Only the new fields are added. A call with no attribute that joins a group with an attributed call takes the size of that group. Its result does not change (rule 5), and only its time may.
- **Dependencies.** None.
- **Validation work.** See the test list below. The hardware timing needs a GPU that the owner or the implementer can run.
- **Downstream effort.** The site and the editor describe the attribute (Surface §3, §65, §71). TypeNN is a consumer, not a registered downstream repository. The `downstream` list accepts only `typeshade.github.io` and `vscode-typeshade` (`scripts/changes.ts`, `DOWNSTREAM_REPOS`).
- **Unestimated.** Effort, schedule and cost are unknown. None is recorded here.

### Decisions of the owner

The owner decided D1 to D5 on 2026-10-13 (Asia/Seoul). D1 to D4 take the recommended answer. D5 takes option (b). No decision is open.

- **D1.** Should a host choose a size per call? Decided: no in v1. A size is fixed at build time. Option (b), a call option, may follow in a later proposal, which needs a change to §65 and Rule 8.21. TypeNN builds one module per size, or waits for that proposal.
- **D2.** Should v1 accept an `override<u32>` name in the attribute, as 0057 does for `@compute`? Decided: no in v1. The kernel call has no `constants` option (see D1). A later proposal may add it with a per-call size.
- **D3.** Should a new example show two sizes? Decided: no example in v1. The journey covers it. The set of `examples/*.shade.ts` does not change.
- **D4.** Should TypeNN be a registered downstream repository in `scripts/changes.ts`? Decided: no. That list is a code change, and it is not part of this proposal.
- **D5.** A call with no attribute in a group with an attributed call. Decided: option (b). A call with no attribute has no preference. It joins any group and takes the size of the group. The attributed calls of one group must declare the same size. Option (a) is rejected: it gave an unattributed call the size 64, which split it from a group of 128. Reason for (b): it fuses more, it drops no request of the author, and it treats a reduction and a map alike. F7 and the examples above state (b).

### Decisions taken by default

Each is an obvious consistency or numbering choice. The owner confirmed D6 to D8 on 2026-10-13.

- **D6.** `reflect()` is not part of v1. Reason: it reads no kernel function (`withoutKernels`), so the draft's claim was wrong. A host reads the size from the `FuseReport` group. A later proposal may add a reader.
- **D7.** The code is TS8077, not TS8076. Reason: draft 0052 reserves TS8076.
- **D8.** The attribute takes one extent. `@workgroup_size([8, 8])` on a kernel function is `TS8037`. Reason: a loop of a kernel function runs on the x index alone (`FuseLoop.wg` is one number, and `grid()` in `src/core/host-kernel.ts` spreads groups over x and y of the dispatch), so an extent in y or z would run each element more than once.

### Approval and plan record

- **Decision.** The owner approved the proposal in the project conversation on 2026-10-13 (Asia/Seoul). The owner adopted the recommended answer of D1 to D4, chose option (b) for D5, and asked for the proposal to move to `accepted`. The merge of PR #652 records the acceptance.
- **Approved revision.** This file at the commit that PR #652 merges. Git records that commit.
- **Scope.** The attribute on a kernel function, F7 with option (b) of D5, `workgroupShape` and TS8077, with D1 to D8 as written above. No decision is open.
- **Responsibilities and milestones.** Unassigned. No schedule, owner or estimate is established.
- **Measured numbers.** The hardware timing in Acceptance is a measurement owed by the implementation. It is not a blocker for acceptance. Its numbers go in the implementation's record.
- **Required validation.** The validation list below. None has run.

### Configuration and validation record

This record does not yet apply. Implementation requires the accepted revision of this file, its commits with `Change: 0067`, the delivered configuration and the validation below.

**Validation (required before the implementation merges).**

- `compile()` on `scale` above: the emitted WGSL contains `@compute` and `@workgroup_size(128)`. The same source with `@workgroup_size` on a reducing kernel gives TS8077, with its text, and the same diagnostic in the language service's `getDiagnostics` (Rule 12.5, CLAUDE.md "A test reads both halves").
- `compile()` on `@workgroup_size` placed on an exported `@compute` entry: the refusal keeps its existing code and text.
- The language service's `getHover` on the decorator shows the resolved shape, where the type is the point.
- `src/core/fuse-group.test.ts`: two calls that declare 64 and 128 form two groups, and the second group's `why` names both sizes. A call that declares 128 before a reduction does not join it, and the `why` names the tree size 256. A call with no attribute joins a group of 128 and a group of 64 and takes the size of each. A call with no attribute never starts a group for a size reason.
- `src/core/fuse-entry.test.ts`: a group of equal declared sizes builds one entry with that size. A group of one declaring call and one call with no attribute builds one entry with the declared size.
- CPU oracle differential: the output bits of `scale` at 64, 128 and 256 are equal.
- `bun run build`, `bun run test`, `bun run gate:compile`, `bun run docs:refs`, `bun scripts/changes.ts`, `bun run docs:impact`.
- Hardware timing: a chain of three maps at sizes 64 and 128 on one named WebGPU device, run at least five times each, with the device, driver, date and median times recorded. SwiftShader does not represent GPU timing and does not count.

**Acceptance.** The lowered WGSL of a kernel with `@workgroup_size([n])` carries `@workgroup_size(n)` on its compute entry. A fused group of two different declared sizes splits, with the new `why`. A call with no attribute joins a group and takes its size. The timing at two sizes is recorded on hardware, with the numbers in the implementation's record.

## What it owes downstream

- `typeshade.github.io` (facts read at `0c56a88`): the site has no page that copies §65 or §71. The API reference entry for `FuseReport` is generated in English, and `content/api/ko/fusereport.json` is translated again. `src/lib/error-codes.ts` needs a `TS8077` entry with a trigger program and a fix: a code with none stops the build. Record 0067 in `compiler-changes.md` when the pin moves.
- `vscode-typeshade` (facts read at `bbb2d9e`): the skill's kernel and fuse sections in `SKILL.md`; `references/host.md`; the decorator list in `references/language.md` (line 313 region); `references/diagnostics.md` for TS8077. Record 0067 in `compiler-changes.md` when the pin moves.
- Consumer note (not a downstream repository in the schema): TypeNN picks its sizes per kernel in its own source and reads `workgroupShape` from the `FuseReport` group. Its work follows the implementation and is not part of this proposal's obligations.
