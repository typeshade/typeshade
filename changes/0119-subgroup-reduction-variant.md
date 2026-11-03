---
id: '0119'
title: A kernel function's integer reduction and its scatter fold inside a subgroup first on a device that has `subgroups`, as a second WGSL variant the runtime selects by feature and probe; no source changes
status: accepted
rules:
  - '8.22'
  - '10.2'
  - '11.23'
surface:
  - 38
  - 65
  - 69
exports:
  - DeviceInfo
  - DeviceOptions
  - DeviceStatistics
  - EmitIdentityInput
  - EmitOptions
  - HostExport
  - Pack
  - Reflection
  - ReflectOptions
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The unified benchmark's compiled kernel cases (`reduction-workgroup`, `atomics-bins-1` and the kernel-loop cases) get the subgroup variant on a device that has the feature, so the comparison of the pin before this change against the pin after it is the measurement this proposal asks for; the method copy says which variant ran, from the record's new field; surface §65 and §69 pages are generated from the pin; the Korean sections the new AUTHORING.md paragraph leaves stale are translated.
  - repo: vscode-typeshade
    what: Nothing an author writes changes. The skill's description of the kernel lowering, if it names the tree, is read against §65 at the pin. Not searched yet.
  - repo: typecv
    what: `docs/gpu-throughput.md` gap G2 asks for subgroup intrinsics to shorten the tree of `bundleMetricPartials`, the PCG dot products and the top-2 selection of matching; the integer ones (counts, the top-2 selection) get the variant with no source change at the pin, and the record says which. `bundleMetricPartials` is an `f32` sum and stays on the tree (section 6).
  - repo: radiance
    what: Issue typeshade/typeshade#536's use, a subgroup fold before an integer `atomicAdd` in the backward pass, is what the scatter variant does to a kernel function's `a[k] += e` on `u32` or `i32`; record 0011's compiler need C8 reads this proposal beside 0117 and says whether the hand-written form of 0117 or this variant is used.
  - repo: typenn
    what: An integer reduction or histogram in a kernel function gets the variant at the pin; `compiler-changes.md` records the id. Not searched yet.
  - repo: typeaudio
    what: No known integer reduction in a kernel function. The record notes the id at the pin. Not searched yet.
---

<!-- doc-refs: skip-file — a draft proposal names a rule and a field its implementation adds -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0119, `status: accepted`. The front matter is the identity and lifecycle authority. The owner accepted the proposal on 2026-11-02 with O1, O3 and O4 decided as the draft assumed; see Approval and plan record. No implementation has started.                                                                                                                                                                                                                                                                                                                                                           |
| Date and attribution          | Authored 2026-11-02, UTC, by a Claude Code agent. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-02, in Korean, after change 0117 landed and typeshade/web PR #22 put the measurement on the site: the owner asked whether TypeShade code "naturally" becomes subgroup operations, pointed at `docs/compiler-owns-performance.md` (PR #930) as the principle the pointer changes 0103 to 0105 followed, and approved this draft before answering that note's open decisions ("승인"). Issue #536 (2026-10-08) is the earlier request; TypeCV's `docs/gpu-throughput.md` gap G2 is the downstream use.                                                      |
| Applicability / effectivity   | `docs/language-design.md` (Rule 8.22, Rule 10.2, a new Rule 11.23, numbered 11.22 in the draft), `reqs/`, `docs/use-typeshade-surface.md` (§38, §65, §69), `AUTHORING.md`, `docs/roadmap.md`, `docs/performance.md`, `src/core/passes/kernel-lower.ts`, `src/core/fuse-group.ts`, `src/core/emit.ts`, `src/core/emit-identity.ts`, `src/core/reflect.ts`, `src/core/manifest-types.ts`, `src/compiler/ts/pack.ts`, `src/compiler/ts/host-face.ts`, `src/core/host-entry.ts`, `src/core/device-info.ts`, `src/runtime/device.ts`, `src/runtime/runtime.ts`, `scripts/perf-gate.ts`. No release version is assigned. |
| Review baseline               | `main` at `3f74848` (2026-11-02), the merge of #964.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Review and revision authority | Pull request [#977](https://github.com/typeshade/typeshade/pull/977) (branch `claude/0119-subgroup-reduction`). Git records the revisions of this file; the merge of that pull request with `status: accepted` records the decision.                                                                                                                                                                                                                                                                                                                                                                               |

## What changes

### 1. What an author sees

Nothing in the source. A kernel function (Rule 8.22) that reduces a `u32` or an `i32` with `+`,
`&`, `|`, `^`, `min` or `max`, or that scatters with `a[k] op= e` on such an element, runs faster
on a WebGPU device that has the `subgroups` feature, with the same values, and the host view's
report says which variant ran. The program of `docs/performance.md`'s measurement, written as a
kernel function, is the witness:

```ts
"use typeshade";

export function total(xs: array<u32>): u32 {
  let s: u32 = 0;
  for (let i: u32 = 0; i < xs.length; i++) s += xs[i];
  return s;
}

export function histogram(xs: array<u32>, bins: array<u32>): void {
  for (let i: u32 = 0; i < xs.length; i++) bins[xs[i] & 7] += 1;
}
```

Today both lower to the workgroup tree of `src/core/kernel-tree.ts` (blocks of 256, six strides
with a barrier each) and, for the scatter, one `atomicAdd` per lane. After this change the WebGPU
tier has a second WGSL text for each loop's entry, and the runtime dispatches it where the device
has `subgroups`.

### 2. The subgroup variant of a reduction (Rule 8.22, amended)

The tree stays the meaning (Rule 7.2, change 0013). The variant changes how a block of 256 is
folded on the WebGPU tier when the operator is one for which every order gives the same bits: an
integer `+`, `&`, `|`, `^`, `min` or `max`, and `min` and `max` on a float. For such an operator
the variant folds each subgroup's lanes with the matching subgroup function (`subgroupAdd`,
`subgroupAnd`, `subgroupOr`, `subgroupXor`, `subgroupMin`, `subgroupMax`), lane 0 of each
subgroup writes its value to the workgroup slot `subgroup_id`, one barrier follows, and lane 0 of
the workgroup folds the `num_subgroups` values with a loop and writes the block's partial. The
level-of-partials entry is the same text with the same substitution.

The variant is right on any assignment of lanes to subgroups: it reads `subgroup_id` and
`num_subgroups`, which 0117 made authorable, and assumes nothing about consecutive lanes. The two
level variant that `docs/performance.md` measures as `<elem>/subgroup/2` (a second
`subgroupAdd` over the partials) is not emitted: it is right only where a subgroup's lanes are
consecutive `local_invocation_index` values, which the device probe reports and this proposal does
not require.

An `f32` or `f64` sum or product keeps the tree in both variants, since the bits of such a sum
depend on the order (Rule 7.2's `order` row, `docs/compiler-owns-performance.md` section 3). The
amended sentence of Rule 8.22:

> On the WebGPU tier, a reduction whose operator gives one value in every order (an integer
> operator, or `min` and `max`) may fold the lanes of a subgroup with the subgroup function of
> that operator before the workgroup slots, as a variant the runtime selects (Rule 11.22); the
> bits it writes are the tree's.

### 3. The subgroup variant of a scatter

A scatter lowers `a[k] op= e` to the atomic of `op` on `a[k]` (`ATOMIC_OF` in
`kernel-lower.ts`): one atomic per lane. The variant adds, before the atomic, a fold of the lanes
of the subgroup whose `k` is equal: `subgroupAdd(select(0, e, k == subgroupBroadcastFirst(k)))`,
then one atomic from the lane `subgroupElect()` picks, repeated for the next distinct `k` of the
subgroup until every lane's contribution is added (a loop over the lanes whose `k` is not yet
served, with `subgroupBallot`). For a scatter whose keys are mostly equal across a subgroup (a
histogram with few bins, the adjoint accumulation of #536) the atomic traffic drops by the
subgroup size; for a scatter whose keys are all distinct it adds the fold's instructions and
removes nothing.

The variant is emitted only for `+`, `&`, `|` and `^` on `u32` and `i32` and for `min` and `max`
on them: the operators `ATOMIC_OF` has. The decision whether to emit it for a given scatter is
the compiler's, by a cost rule the implementing pull request states in §65 and
`docs/performance.md` (section Why, open point O3).

### 4. Variant selection: Rule 11.22 (proposed)

The emulated double already has two WGSL texts of an entry, `wgsl` and `wgslInteger`, and the
owner of a call picks one by its flavor (`flavored()` in `src/core/host-entry.ts`, change 0073;
`createDevice({ fp64Flavor: 'auto' })` selects by the device, change 0085). This proposal makes
that mechanism a rule and adds a second axis:

> **Rule 11.22.** A compiled program may carry more than one WGSL text of a compute entry (a
> variant). Every variant of an entry must write the same bits for every input, except where a
> rule records a divergence between them. The runtime must select a variant when it opens the
> device, from the device's features and from a known-answer probe that runs the variant once
> and compares its result with the oracle's; a variant whose probe fails must not be selected,
> and the device report must name the variant each entry runs. A feature a variant alone needs
> must not be in the module's `requiredFeatures` (Rule 10.2); the runtime requests it when the
> adapter has it.

Under this rule:

- The subgroup variant is selected on a WebGPU device whose adapter has `subgroups`, when the
  probe passes. The probe is one dispatch of a fixed kernel of the runtime (a `u32` reduction and
  a `u32` histogram over 4096 values) whose result the runtime compares with the CPU tier's; it
  runs once per device, before the first kernel call, as `createDevice()` opens the device.
- The host selects by hand with `createDevice({ subgroups: 'auto' | 'never' })`, `'auto'` by
  default. `'never'` is for a measurement that wants the tree on a device that has the feature
  (the site's benchmark compares both on one device) and for a device the probe accepts but the
  host distrusts. There is no `'always'`: a device without the feature cannot compile the text.
- `DeviceInfo` gains `subgroups`: `null` on a device without the feature or whose probe failed,
  else the probe's observation (`size`, `numSubgroups` for a workgroup of 256, `consecutive`),
  the same fields typeshade/web's instrument records today. `device.report()` and the kernel
  statistics name the variant (`'tree'` or `'subgroup'`) per entry.
- `reflect()` reports the module's `requiredFeatures` without `subgroups`, as today, and a new
  `variants` list: each entry that has one, with the feature it needs. `reflect({ variant })`
  reflects the WGSL of that variant.

### 5. The emit and the manifest

- `EmitOptions` and `EmitIdentityInput` gain `subgroupFolds?: boolean`, as they carry
  `fp64Flavor`; `lowerForBackend` reads it. The pack records it in `emit`, so `repack` emits the
  variant from a fixed manifest, and `Pack.emit.subgroupFolds` is part of the emit identity
  (surface §69).
- The host module `tshc` writes carries `wgslSubgroup?` beside `wgslInteger?` on each compute
  entry of a kernel loop that has the variant, and `HostExport`'s compute entry carries it. A
  module that emulates `f64` and has an integer reduction has up to four texts; the runtime
  picks by both axes. A fused plan (`src/core/fuse-group.ts`, change 0058) has the same two
  texts for a group that holds a reduction.
- The WGSL text of the variant has `enable subgroups;` and the `features` of its own manifest
  name `subgroups`; the module's manifest (the tree text) does not.

### 6. Exclusions

- An `f32` or `f64` sum or product: the tree, in both variants, until the owner decides
  decisions 2 and 3 of `docs/compiler-owns-performance.md` (the adjacent pairwise tree and the
  strict and fast modes). TypeCV's `bundleMetricPartials` is such a sum and does not change.
- The two-level fold (`<elem>/subgroup/2`): it needs consecutive lanes, which the probe can
  observe but WGSL does not promise.
- Compaction (`out.push(v)`, change 0078): its three phases, count, scan and scatter
  (`pushEntries` in `kernel-lower.ts`), keep their texts. A `subgroupBallot` count and a
  `subgroupExclusiveAdd` scan are the note's section 5 and a later proposal.
- The WebGL2 tier and the CPU tier: one text each, as today. Rule 11.21's one-invocation meaning
  is not used by this proposal, since the variant exists only where the device has the feature.
- Removing the `"enable subgroups"` directive and the other kinds of capability the note's
  section 7 names: a later proposal, after decision 5.
- A subgroup fold the author writes with 0117's functions is left as written. The compiler does
  not rewrite an author's `subgroupAdd` and does not add a second fold to a loop that already
  calls one.

## Why

### The problem

Change 0117 lets an author write the subgroup functions. That is against the direction
`docs/compiler-owns-performance.md` records in its section 1: a program must become faster when
the compiler improves, with no change to its source, and an author must not have to know what the
device supports. Changes 0103 to 0105 did this for struct and array copies, and TypeCV's gap G2 and
#536's use are integer reductions and scatters that a kernel function already writes. They get
nothing from 0117 unless someone rewrites each of them by hand, with the device's feature in view.

### Evidence

- On SwiftShader (a software device; `docs/performance.md`, typeshade/web PR #22 at `47cb9dc`,
  2026-11-02, extended profile, 262,144 elements, medians of the device time per dispatch,
  candidate build `cdb12dc0`): `reduction-subgroup` 41.41 ms against `reduction-workgroup`
  91.21 ms; `atomics-bins-1-subgroup` 5.38 ms against `atomics-bins-1` 11.64 ms. A software
  device runs a barrier as a thread switch, so these say the lowering works and the instrument
  measures it, not what a GPU does. The hardware numbers come from visitors of typeshade.dev's
  benchmark page; none is recorded at authoring.
- TypeCV (`docs/gpu-throughput.md`, section 6 and gap G2, pin `725b2969`): the tree costs
  `bundleMetricPartials`, the PCG dot products and the top-2 selection several barriers each;
  `bundle.shade.ts` has 12 barriers, `joint-focal.shade.ts` 10, `float-matching.shade.ts` 9.
  Those are hand-written workgroup kernels, not kernel functions, so the variant reaches them
  only where TypeCV writes the reduction as a kernel function or writes 0117's functions by hand.
- The mechanism exists: `flavored()` picks an entry's WGSL text by the owner's flavor, and
  `automaticFp64Flavor()` picks the flavor from the device (changes 0073 and 0085). The variant
  adds an axis, not a mechanism.
- Issue #536 states the correctness argument: an integer sum has one value in every order, so a
  subgroup fold before an integer atomic changes no bits. `kernel-tree.ts` says the same for the
  tree's integer operators, `min` and `max`.

### Alternatives

- **Rewrite by hand with 0117's functions.** Works today for a hand-written workgroup kernel,
  and TypeCV may do it for its `f32` reductions where it accepts the `order` row. For a kernel
  function it is against Rule 8.22's shape (a kernel function's loop body is the author's
  iteration, not a workgroup program) and against the note's section 1.
- **One text with a runtime branch.** A WGSL module that spells `enable subgroups;` does not
  compile on a device without the feature, so a branch inside the shader cannot choose
  (`docs/compiler-owns-performance.md`, section 6). Two texts are needed.
- **Select by vendor signal, as `fp64Flavor: 'auto'` does.** The note's section 6 proposes a
  probe instead, so a device with unknown signals still gets the right variant, and a device
  whose driver miscompiles the fold is caught by its result. This proposal takes the probe
  (decision 4 of the note, assumed; open point O1).
- **Emit the variant for every reduction, floats included.** Changes the bits of an `f32` sum by
  device and subgroup size, against Rule 7.2 and the note's section 3. Excluded until the owner
  decides the note's decisions 2 and 3.
- **The two-level fold.** Faster on SwiftShader (57.37 ms against 41.41 ms for one level in the
  same run, so slower there; the ordering differs by device). Needs consecutive lanes. Excluded.

### Assumptions and open points

- O1. Selection by probe, not by vendor signals (the note's decision 4). Decided on 2026-11-02
  by the owner's approval of the draft as written: the probe.
- O2. The note's decision 5, how 0117's authorable functions relate to this direction: this
  draft keeps them and adds the variant beside them (section 6, last item). If the owner decides
  that the directive and the functions are to go, that is a separate proposal and this one does
  not depend on it.
- O3. The cost rule for the scatter variant (section 3). Decided on 2026-11-02 by the owner's
  approval of the draft as written: the variant is emitted for every integer scatter. A static
  rule that reads the keys, or a timing probe that chooses per entry, is a later proposal once
  hardware ratios exist.
- O4. Whether the probe also times the two texts and selects the faster one per entry, or only
  checks the value. Decided on 2026-11-02 by the owner's approval of the draft as written: the
  value check only. A timing probe needs `timestamp-query` or a wall clock, and the note's
  section 2 says the numbers that decide come from a hardware adapter; it is a later proposal.
- O5. The Rule number 11.22 assumes no accepted proposal takes it first; the implementing pull
  request renumbers if one does. Proposal 0118 (PR #959, a fuse report's tier) does not take a
  rule number.
- O6. The probe's result on a device whose `subgroups` feature is present but whose subgroup
  size is 1 (allowed by WebGPU's `subgroupMinSize`): the variant is correct and gains nothing;
  the probe passes; the draft lets it be selected. A later timing probe (O4) would reject it.

## What it touches

- Rule 8.22: the amended sentence of section 2 (the WebGPU tier may fold a subgroup first for an
  order-free operator, as a variant).
- Rule 10.2: a feature a variant alone needs is not in `requiredFeatures`; the runtime requests
  it when the adapter has it (section 4).
- Rule 11.22 (new): variants, their equal bits, the selection by feature and probe, the device
  report, the feature rule.
- Surface §38: a sentence that the subgroup variant adds no row, since it is emitted only for
  operators whose result has one value in every order; the `order` row of a float reduction is
  unchanged.
- Surface §65: the lowering paragraph (the tree, the partials) gains the variant and the
  scatter's fold, the device report's variant name, and the `createDevice({ subgroups })`
  switch; the example of section 1.
- Surface §69: the emit identity gains `subgroupFolds`; the running section describes the second
  text of an entry beside the integer flavor's, and the probe.
- `docs/roadmap.md`: item 15 gains the variant; `docs/performance.md`: the measurement section
  names the variant and `bench:subgroup-reduce` compares the two texts of one kernel function.
- `AUTHORING.md`: one paragraph under the kernel function section and one under running.
- Exports, reshaped: `EmitOptions` and `EmitIdentityInput` (`subgroupFolds`), `Pack` (`emit`),
  `HostExport` (the compute entry's `wgslSubgroup`), `DeviceOptions` (`subgroups`), `DeviceInfo`
  (`subgroups`), `DeviceStatistics` (`variants`, amendment 1), `Reflection` (`variants`),
  `ReflectOptions` (`variant`). None removed. The implementing pull request amends this list in
  a proposal-only pull request if its diff reshapes another, as 0117's #917 did.
- Code: `kernel-lower.ts` (the variant of `reductionEntries` and of the scatter), `fuse-group.ts`
  (the variant of a fused group), `emit.ts`, `emit-identity.ts`, `reflect.ts`,
  `manifest-types.ts`, `pack.ts`, `host-face.ts` and the host module writer, `host-entry.ts`
  (`flavored()` gains the axis), `device-info.ts` (the probe's observation), `runtime/device.ts`
  (the option, the probe, the selection, the report), `runtime/runtime.ts` (the feature request
  takes the optional features of the variants the adapter has), `CHANGELOG.md`.
- Codes: none. The variant is never refused; a device without the feature runs the tree.
- Examples: none. Section 1's program is a test fixture, not a gallery example, since the gallery
  shows what an author writes and the author writes nothing new.

### Draft impact estimate

- Technical work, known: the variant of `reductionEntries` is a substitution in the tree builder
  (the six-stride loop becomes one subgroup call, one slot write, one barrier and a lane-0 loop);
  the scatter's fold is new IR before the atomic; the second text follows `wgslInteger` through
  the pack, the host module and `flavored()`; the probe and the option follow `fp64Flavor`'s path
  in `runtime/device.ts`; the feature request in `runtime.ts` splits required from optional.
  Unknown: the fused plan's variant, whose planner holds a reduction last in a group.
- Compatibility: additive. No name an author writes changes; a program's values do not change; a
  host that reads `DeviceInfo` sees one new field; a fixed manifest packed before this change
  has no variant and runs the tree.
- Dependencies: change 0117 (merged, `cdb12dc`) for the functions and the built-in values the
  variant emits. Independent of 0118 (PR #959). Reads `docs/compiler-owns-performance.md`'s
  decisions 2 to 5 as open; depends on none of them (section Assumptions).
- Tools: Tint through the compile gate for the variant's WGSL; SwiftShader for the probe and the
  differential of the two texts (it has `subgroups`, size 4); `gate:perf` for the regression
  gate, on the runners that have a device.
- Validation, functional: the two texts of section 1's program give equal bits on SwiftShader for
  `u32` and `i32`, for every operator of section 2, over lengths that are not multiples of 256
  and over an empty array; the scatter's fold gives the bits of the per-lane atomics on a
  histogram with 1, 8 and 4096 bins and on all-distinct keys; the probe rejects a text fed a
  wrong answer (a broken shader first, as 0117's measurement did); `createDevice({ subgroups:
'never' })` runs the tree on SwiftShader; a module that emulates `f64` with an integer
  reduction picks by both axes; a fused group with a reduction has both texts; the WebGL2 and
  CPU tiers are unchanged by the differential gate; `requiredFeatures` of the module does not
  name `subgroups` and `reflect().variants` does.
- Validation, document: §38, §65, §69, Rules 8.22, 10.2 and 11.22 through `reqs:sync` and the
  Doorstop check, `docs:impact` and `docs:refs`, the roadmap and performance pages, AUTHORING.md.
- Downstream effort: the site's benchmark gains the comparison for free at the next pin (the
  catalog compiles the kernel cases with both pins); its method copy and the record's variant
  field are the site's work; TypeCV and radiance record the id and say which form they use;
  Korean translation of the new AUTHORING.md paragraphs: unknown.
- Duration: unknown. No basis for an estimate is recorded.
- Decisions before acceptance: O1, O3 and O4, decided on 2026-11-02 (section Assumptions and
  open points). O2, O5 and O6 stay open and do not block acceptance.

### Approval and plan record

- Decision: the owner (Seungup) accepted the proposal on 2026-11-02 in the Claude Code session,
  in Korean ("승인"), in answer to the report of pull request #977 that listed O1, O3 and O4
  with the draft's assumption for each; the approval takes those assumptions as the decisions
  (section Assumptions and open points). The owner cannot approve their own pull request, so
  this go-ahead is the review (CLAUDE.md, Merging).
- Record: pull request #977, merged with this file at `status: accepted`. Git records the
  revision; the merge is the evidence.
- Approved scope: section 1 (what an author sees), section 2 (the reduction variant and the
  amended sentence of Rule 8.22), section 3 (the scatter variant, emitted for every integer
  scatter), section 4 (Rule 11.22, the probe, the option, the device report, the reflection),
  section 5 (the emit and the manifest), section 6 (the exclusions).
- Responsibilities: the implementing pull requests are the owner's agent sessions' to open, each
  with `Change: 0119`; no person is assigned by name. No milestone date is agreed.
- Required validation at implementation: the functional and document lists under Draft impact
  estimate, and the Configuration and validation record below. No duration or cost estimate is
  established.
- Amendment 2 (2026-11-03, before the docs stage is merged): the new rule is declared as 11.23,
  not 11.22, which change 0107's numerical contract took first (open point O5 foresaw it).
- Amendment 1 (2026-11-03, before the runtime stage is merged): `DeviceStatistics` joins the
  reshaped exports. Section 4 says the device report names the variant each entry runs; the
  runtime has no `device.report()`, and its per-call record is `Device.statistics`, so the
  statistics gain `variants`, the text the last call of each kernel function dispatched. The
  draft listed `DeviceInfo` for the probe's observation and no export for the per-call record.
  Recorded in the pull request that carries this amendment; Git records the revision.

### Configuration and validation record

This record does not yet apply. Delivery will require: the accepted revision's pull request and
merge commit; the implementing pull requests and the merged commits; the tested configuration
(the head commit, the Chromium and SwiftShader versions of the compile gate, the hardware
adapter of `gate:perf` where one ran); the observed results of the functional validation list
above, retained as the pull requests' checks and the perf gate's records; the document audit of
the list above; each deviation with its disposition; and the pending downstream deliveries, which
compiler status `implemented` does not presume complete.

## What it owes downstream

- typeshade.github.io: the benchmark's compiled kernel cases run the variant on the candidate
  build where the device has the feature; the record gains the variant each row ran (a field of
  the instrument, its own revision); the method copy explains the comparison; §65 and §69 pages
  are generated from the pin; `bun run check:guide` lists the Korean sections to translate.
- vscode-typeshade: nothing an author writes changes; the skill is read against §65 at the pin.
- typecv: gap G2 of `docs/gpu-throughput.md` is answered for integer reductions written as
  kernel functions; `compiler-changes.md` records the id and whether `bundleMetricPartials`
  stays on the tree (it does, section 6) or is rewritten with 0117's functions under the `order`
  row.
- radiance: record 0011's compiler need C8 says whether the backward pass uses this variant (a
  kernel function's scatter) or 0117's hand-written fold; `compiler-changes.md` records the id.
- typenn, typeaudio: `compiler-changes.md` records the id at the pin; any integer reduction in a
  kernel function gets the variant with no source change.
