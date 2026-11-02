---
id: '0117'
title: The subgroup built-in functions and the `subgroup_id` and `num_subgroups` built-in values are authorable behind `enable subgroups`, with a one-invocation meaning on the oracle and on GLSL ES 3.00
status: implemented
rules:
  - '11.21'
surface:
  - 50
  - 77
exports:
  - SUBGROUP_FOLDS
  - SUBGROUP_INTRINSICS
  - SUBGROUP_LANE_READS
  - FixedTypeBuiltinName
  - WGSL_BUILTIN_TYPES
  - WgslBuiltinName
  - builtin
exports-removed: []
codes: []
examples:
  - subgroup-reduce
downstream:
  - repo: typeshade.github.io
    what: The language reference gains the 21 subgroup functions and the two built-in values from the compiler's tables, which the reference reads at the pin; the authoring guide's Korean sections that the new AUTHORING.md section leaves stale are translated; the unified benchmark's four fixed WGSL subgroup cases (web PR #22) become TypeShade source compiled at each build, with a build that refuses the source recorded as such. The gallery and the Playground list the new example.
  - repo: vscode-typeshade
    what: The ambient library the editor serves gains the family's declarations through the generated `shade.d.ts`; the skill's builtin list names the family and its directive. Not searched yet.
  - repo: radiance
    what: Issue typeshade/typeshade#536 (compiler need C8, record 0011) can write `subgroupAdd` before `atomicAdd` in the backward pass once the pin carries this change; its record names the WebGL2 meaning below.
---

<!-- doc-refs: skip-file — a draft proposal names a rule, a surface section and an example its implementation adds -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0117, `status: accepted`. The front matter is the identity and lifecycle authority. The owner accepted the proposal on 2026-11-02 with D1 decided for the lowering; see Approval and plan record. No implementation has started.                                                                                                                                                                                                                                                                                    |
| Date and attribution          | Authored 2026-11-02, UTC, by a Claude Code agent. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                         |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-02, in Korean. The owner asked what a subgroup optimization would buy the compiler, had a measurement built first (PR #903, merged as `c0f61a7`; typeshade/web PR #22, draft), and then asked that the test run on code built from TypeShade source. The owner approved this proposal's drafting in the same session ("네 승인합니다"). Issue #536 (typeshade/radiance, 2026-10-09) is the earlier request.                                                         |
| Applicability / effectivity   | `docs/language-design.md` (a new Rule 11.21, the §13 decisions table, Appendix B), `reqs/`, `docs/use-typeshade-surface.md` (§50, a new §77), `AUTHORING.md`, `docs/roadmap.md` (the After 1.0 row), `src/core/builtins/overlay.ts`, `src/core/intrinsics.ts`, `src/core/sot.ts`, `src/compiler/ts/builtin-check.ts`, `src/core/passes/required-caps.ts`, `src/core/passes/uniformity.ts`, `src/core/passes/determinism.ts`, the oracle, the GLSL writer, the language service, `examples/`. No release version is assigned. |
| Review baseline               | `main` at `9dbc2988` (2026-11-02), the merge of #890.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Review and revision authority | Pull request [#911](https://github.com/typeshade/typeshade/pull/911) (branch `proposal/subgroup-operations`). Git records the revisions of this file; the merge of that pull request with `status: accepted` records the decision.                                                                                                                                                                                                                                                                                           |

## What changes

### 1. The names

After this change an author can write, in a `"use typeshade"` file, the 21 subgroup built-in
functions of WGSL's `subgroups` extension, with WGSL's signatures:

| Group      | Names                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| reductions | `subgroupAdd`, `subgroupMul`, `subgroupMin`, `subgroupMax`, `subgroupAnd`, `subgroupOr`, `subgroupXor`                             |
| scans      | `subgroupExclusiveAdd`, `subgroupInclusiveAdd`, `subgroupExclusiveMul`, `subgroupInclusiveMul`                                     |
| votes      | `subgroupAll`, `subgroupAny`, `subgroupBallot`, `subgroupElect`                                                                    |
| broadcasts | `subgroupBroadcast`, `subgroupBroadcastFirst`, `subgroupShuffle`, `subgroupShuffleDown`, `subgroupShuffleUp`, `subgroupShuffleXor` |

and the two built-in values WGSL added beside `subgroup_invocation_id` and `subgroup_size`:
`@builtin("subgroup_id")` and `@builtin("num_subgroups")`, both `u32`, both compute inputs.

Every name is WGSL's, as the specification spells it (Rule 2.1(a); Rule 13.6: WGSL
[Subgroup Built-in Functions](https://gpuweb.github.io/gpuweb/wgsl/#subgroup-builtin-functions)
and [Built-in Inputs and Outputs](https://gpuweb.github.io/gpuweb/wgsl/#builtin-inputs-outputs)).
No TypeShade spelling is added, so §9.3 does not change. The signatures come from Tint's
`core.def` through the overlay (Rule 12.7, change 0017): the family's rows leave the DEFERRED
claim `extensionOf` gives them today and become SUPPORTED, in a new family `subgroups`. The `f16`
instances of each row stay out, as Rule 4.7 keeps them out of every family. The four `quad*`
functions and the `subgroup_matrix` family are not in this proposal (section 6).

```ts
"use typeshade";

declare const src: storage<array<u32>>;
declare const bins: storage<array<atomic<u32>>, "read_write">;

@compute([64])
export function main(@builtin("global_invocation_id") gid: vec3u): void {
  const v = subgroupAdd(src[gid.x]); // the subgroup's sum, in every lane
  if (subgroupElect()) {
    atomicAdd(bins[0], v); // one atomic per subgroup instead of one per lane
  }
}
```

### 2. The capability

A call of a subgroup function derives the `subgroups` capability, as the two built-in values do
today (§50): the module gets `enable subgroups;` and `reflect().requiredFeatures` names the host
feature `subgroups`. The `"enable subgroups"` directive stays for a file that uses none of them.
Nothing changes in the capability vocabulary (`src/core/ir/nodes.ts`) or in the WGSL backend's
profile.

### 3. The one-invocation meaning: Rule 11.21 (proposed)

WGSL leaves a subgroup's size to the device, between the adapter's `subgroupMinSize` and
`subgroupMaxSize`, and gives a float reduction no fixed order. GLSL ES 3.00 has no subgroups.
The CPU oracle runs invocations one after another. The proposal gives both the meaning #536
asked for, as a recorded divergence:

> **Rule 11.21.** On the CPU oracle and on GLSL ES 3.00, a subgroup is one invocation:
> `subgroup_size` is 1, `subgroup_invocation_id` is 0, `subgroup_id` is `local_invocation_index`
> and `num_subgroups` is the workgroup's invocation count; each subgroup built-in function must
> give the value it gives a subgroup of one lane. The determinism report must list a subgroup
> reduction or scan on a float as `order`, and a broadcast or shuffle whose lane argument is not
> 0 as `target`. A module that uses a subgroup function must not be refused on GLSL ES 3.00 for
> the capability alone.

The value each function gives a subgroup of one lane, with `x` the lane's argument:

| Function                                                                                               | Value                                    |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| `subgroupAdd`, `subgroupMul`, `subgroupMin`, `subgroupMax`, `subgroupAnd`, `subgroupOr`, `subgroupXor` | `x`                                      |
| `subgroupInclusiveAdd`, `subgroupInclusiveMul`                                                         | `x`                                      |
| `subgroupExclusiveAdd`                                                                                 | `0` of `x`'s type                        |
| `subgroupExclusiveMul`                                                                                 | `1` of `x`'s type                        |
| `subgroupAll(p)`, `subgroupAny(p)`                                                                     | `p`                                      |
| `subgroupBallot(p)`                                                                                    | `vec4u(u32(p), 0, 0, 0)`                 |
| `subgroupElect()`                                                                                      | `true`                                   |
| `subgroupBroadcast(x, id)`, `subgroupShuffle(x, id)`                                                   | `x`; `id` other than 0 is `target`       |
| `subgroupBroadcastFirst(x)`                                                                            | `x`                                      |
| `subgroupShuffleDown(x, d)`, `subgroupShuffleUp(x, d)`, `subgroupShuffleXor(x, m)`                     | `x`; `d` or `m` other than 0 is `target` |

What this meaning gives and what it does not:

- An integer reduction followed by an atomic accumulation, the use #536 names, gives the same
  final sum on WebGPU, on WebGL2 and on the oracle, whatever the device's subgroup size, because
  an integer sum has one value in every order.
- A float reduction gives bits that differ by device and by subgroup size. The determinism
  report says so (`order`), as it does for a kernel function's float reduction today.
- A program that reads lanes other than its own (a broadcast from lane 3, a shuffle) computes
  something else on a subgroup of one. The report says so (`target`). This is the same
  position Rule 11.5 takes for a GLSL spelling that answers otherwise on an input WGSL settles.
- Whether a device may report a subgroup size of 1 is not verified (#536's open point). The rule
  does not claim it may: the one-lane meaning is TypeShade's for its own tiers, recorded as a
  divergence, and the WebGPU tier runs the device's.

**Decision D1, the GLSL ES 3.00 lowering.** Rule 9.3 says a WGSL builtin GLSL has no spelling for
is behind a capability and the GLSL emit fails closed on it; §50 says `subgroups` fails closed
today. #536 asks the opposite for radiance: a feature it uses stays usable on WebGL2 by a
lowering. The proposal takes #536's side, through the last sentence of Rule 11.21: the GLSL
writer spells each function by the table above, and a module that uses one compiles on GLSL. The
alternative, failing closed, keeps Rule 9.3 as written and leaves every subgroup program
WebGPU-only. Decided on 2026-11-02 by the owner, in the Claude Code session, in Korean ("D1은 lowering으로"): the lowering.

### 4. Uniform control flow

WGSL requires a subgroup built-in function to be called in uniform control flow
(`subgroup_uniformity`, an error by default in Tint since Chrome 145 per #536). The front end
already refuses `workgroupBarrier` and the implicit-LOD texture reads outside uniform control
flow in the author's words (Rule 12.6, `src/core/passes/uniformity.ts`, kind `barrier`). The
subgroup functions join that analysis with a kind of their own, `subgroup`, so the refusal
names the call and the cause as it does for a barrier. The seed table already lists
`subgroup_size` and `num_subgroups` as uniform; `subgroup_id` and `subgroup_invocation_id` vary
by invocation.

### 5. Both halves, measured

- The language service's ambient library gains the family's declarations from the same rows
  (Rule 12.7), so `subgroupAdd(v)` has a hover, completion and no editor error where the compiler
  accepts it.
- Each row is held to both halves by the overlay's test, as the other SUPPORTED families are.
- The stage rule comes from `core.def`: compute or fragment for every function
  (`fixtures/coredef-stages.json`), as `src/core/spec-conformance/stage-rules.test.ts` requires.
- Measured on Tint (Rule 13.3), Chrome for Testing 153.0.8010.12, SwiftShader, 2026-11-02, in
  PR #903's run and in typeshade/web PR #22's run: `enable subgroups;` with `subgroupAdd` on
  `u32` and `f32`, `subgroupElect()`, and the built-in values `subgroup_invocation_id`,
  `subgroup_size`, `subgroup_id` and `num_subgroups` compile and run; every variant computed the
  checked value; the probe saw `subgroup_size` 4, `num_subgroups` 16 for a workgroup of 64,
  with consecutive lanes. The remaining 19 functions are measured by the implementing pull
  request, with a broken shader fed to the instrument first, before any row is claimed.

### 6. Exclusions

- The four `quad*` functions: the same extension, but a quad is four invocations of a fragment
  2×2 block, and a one-invocation meaning for `quadSwapX` is a lie about geometry, not an order.
  They wait for their own use.
- `subgroup_matrix` and the `subgroupMatrix*` functions: Dawn's experimental extension, outside
  the WGSL surface this package targets (`extensionOf`).
- `@subgroup_size(N)` and `subgroup_size_control`: the attribute stays refused as it is today
  (`builtin-check.ts`: "a compute entry runs at the subgroup size the device chooses").
- Any compiler optimization that emits a subgroup function on its own, in a kernel function's
  reduction or before an atomic. That is a later proposal, measured with this one's names on the
  site's benchmark first (section Why).
- `f16` instances, by Rule 4.7.

## Why

### The problem

Issue #536 asks for subgroup operations with one use in view: radiance's backward pass adds each
pixel's contribution into a splat's adjoint with an integer `atomicAdd`, and a `subgroupAdd` before
one atomic per subgroup cuts the atomic traffic without changing the sum. The roadmap defers the
whole feature to after 1.0 with the reason "A WebGPU extension with no WebGL2 equivalent and no
oracle meaning yet". This proposal supplies the meaning, and the measurement that makes the
decision concrete:

- PR #903's script (`bench:subgroup-reduce`) and the site's benchmark (typeshade/web PR #22) run
  hand-written WGSL, because the compiler cannot emit a subgroup function. They measure what the
  device can do, not what TypeShade-built code does. The owner asked on 2026-11-02 that the test
  run on code built from TypeShade source. That needs the names first.
- With the names authorable, the site's regression benchmark compiles one TypeShade source at
  two compiler revisions, which is what it exists for, and the subgroup cases become ordinary
  compiled cases.

### Evidence

- On SwiftShader, a software device, the hand-written cases of web PR #22 at `a8d91b0`
  (2026-11-02, quick profile, 68 rows, every check passed): `reduction-subgroup` took 0.55 of
  `reduction-workgroup`'s GPU time; `atomics-bins-1-subgroup` took 0.73 of `atomics-bins-1`'s;
  `atomics-bins-1-workgroup`, the tree before one atomic, took 12 times `atomics-bins-1`'s. A
  software device runs a barrier as a thread switch, so these numbers say the instrument works,
  not what a GPU does. The hardware numbers come from visitors once the page is deployed.
- `coredef.ts` already carries the 21 functions' rows with their signatures (`fiu32_f16` on the
  reductions, `bool` on the votes, `u32` lane arguments on the broadcasts). The overlay defers
  them with the sentence "no issue asks for its functions yet". #536 does.
- The two existing built-in values derive the capability from use and are checked at the
  authoring line (§50). The functions follow the same path.

### Alternatives

- **An internal optimization first** (the compiler emits `subgroupAdd` in a kernel function's
  reduction on a device that has the feature, with no authorable name). It needs the device's
  feature at dispatch, so the call layer picks a variant per device, and a float reduction needs
  Rule 7.2 amended. It also cannot be tested from TypeShade source until the names exist. Not
  first; a later proposal, measured on this one's names.
- **Fail closed on GLSL** (keep Rule 9.3 as written). Leaves #536's program WebGPU-only against
  the principle #130 states for radiance (every feature emits on both targets). Decision D1.
- **Keep the After 1.0 placement.** The reason the roadmap gives, no oracle meaning, is what
  this proposal supplies. The surface grows by WGSL names only, which Rule 2.1(a) admits and the
  overlay already types.

### Assumptions and open points

- D1 was decided on 2026-11-02: the lowering (section 3).
- The Rule number 11.21 assumes no other accepted proposal takes it first; the implementing pull
  request renumbers if one does.
- The surface section number 77 assumes §76 stays the last section at acceptance.
- `subgroup_id` and `num_subgroups` on a fragment entry: WGSL declares both for compute only.
  The implementation measures Tint before writing the stage table (Rule 13.3), as the existing
  pair's fragment acceptance was measured.

## What it touches

- Rule 11.21 (new): the one-invocation meaning on the oracle and on GLSL ES 3.00, the determinism
  rows and the GLSL lowering (decision D1).
- Surface §50: the sentence "the subgroup built-in functions (`subgroupAdd` and the rest) are not
  on this surface" is removed; the built-in value table gains `subgroup_id` and `num_subgroups`;
  the derivation sentence names the functions.
- Surface §77 (new): the family, its signatures, the one-invocation table, the determinism rows,
  the uniformity refusal, measured on Tint.
- `docs/language-design.md` §13 decisions table: the row "Subgroup operations, pointer values,
  `f16`" loses "Subgroup operations". `docs/roadmap.md` After 1.0: the row is removed and the
  change recorded. Appendix B: no new row.
- Example `subgroup-reduce` (new): the compute entry of section 1, WGSL-only on the gallery until
  D1 lands the GLSL lowering, then on both.
- Code: `overlay.ts` (a `subgroups` family, SUPPORTED; `extensionOf` keeps the `quad*` and
  `subgroupMatrix*` deferrals), `intrinsics.ts` (21 rows, WGSL spelling and the GLSL spelling of
  the table), `sot.ts` and `builtin-check.ts` (two built-in values, compute stage),
  `required-caps.ts` (the call derives `subgroups`), `uniformity.ts` (kind `subgroup`),
  `determinism.ts` (`order` and `target` rows), the oracle (the table), the language service's
  generated declarations and docs strings, `CHANGELOG.md`.
- Codes: none. A misuse is `TS8003` (a wrong argument type), `TS8019` (arity) or the uniformity
  refusal's existing code.
- Exports (amendment of 2026-11-02, before the implementation is merged; the accepted text
  declared none): three new, `SUBGROUP_INTRINSICS`, `SUBGROUP_FOLDS` and `SUBGROUP_LANE_READS`
  in `src/core/intrinsics.ts`, the family's id sets beside `PACKED_4X8_IDS` and
  `TEXTURE_GATHER_IDS`, which the determinism pass, the GLSL lowering and the front end read;
  and four reshaped, `WgslBuiltinName`, `FixedTypeBuiltinName`, `WGSL_BUILTIN_TYPES` and
  `builtin` in `src/core/sot.ts`, which gain `subgroup_id` and `num_subgroups` as they gained
  `subgroup_invocation_id` and `subgroup_size`. Nothing is removed.

### Draft impact estimate

- Technical work, known: the family is table-driven (change 0017), so the overlay, the ambient
  declarations and the both-halves test follow from marking the rows SUPPORTED; the intrinsic
  rows, the two built-in values and the capability derivation follow the packed 4x8 family
  (§47) and the built-in value pair (§50). New work: the oracle's values for 21 functions, the
  GLSL spellings (D1), the uniformity kind, the determinism rows.
- Compatibility: additive. No name changes meaning; no program that compiles today stops.
- Dependencies: none on an open proposal. Independent of 0115.
- Tools: Tint through the compile gate; a WebGL2 driver through the compile gate for the GLSL
  lowering; the GPU differential for the oracle.
- Validation: the compile gate on the example, both halves on every row, the oracle against
  WebGPU on an integer `subgroupAdd` then `atomicAdd` (the sums equal), the determinism report's
  rows, `reqs:sync` and the Doorstop check for Rule 11.21 and §50, §77.
- Downstream effort: the site's reference pages are generated; the benchmark case rewrite is
  web PR #22's follow-up; the editor's declarations are generated. Translation of the new
  AUTHORING.md section into Korean: unknown.
- Duration: unknown. No basis for an estimate is recorded.
- Decisions before acceptance: D1, decided for the lowering on 2026-11-02.

### Approval and plan record

- Decision: the owner (Seungup) accepted the proposal on 2026-11-02 in the Claude Code session,
  in Korean ("D1은 lowering으로 하고 0117 accept해서 머지해"), with D1 decided for the GLSL ES
  3.00 lowering. The owner cannot approve their own pull request, so this go-ahead is the review
  (CLAUDE.md, Merging).
- Record: pull request #911, merged with this file at `status: accepted`. Git records the
  revision; the merge is the evidence.
- Approved scope: section 1 (the 21 functions and the two built-in values), section 2 (the
  derived capability), section 3 (Rule 11.21 and its table, with the lowering), section 4 (the
  uniformity kind), section 5 (both halves and the Tint measurement), section 6 (the
  exclusions).
- Responsibilities: the implementing pull requests are the owner's agent sessions' to open, each
  with `Change: 0117`; no person is assigned by name. No milestone date is agreed.
- Required validation at implementation: the list under Draft impact estimate, and the
  Configuration and validation record below. No duration or cost estimate is established.

### Configuration and validation record

- Accepted revision: pull request #911, merged to `main` as `0b52a0a` with `status: accepted`.
- Implementing pull request: the pull request opened from branch `claude/0117-subgroups` (its
  number is recorded on `main` by the merge commit; every commit says `Change: 0117`), from
  `0b52a0a`, by the owner's Claude Code session on 2026-11-02; no person is assigned by name.
  The merged revision is the delivered configuration, and Git records it.
- Delivered configuration of the validation: the pull request's head commit; Tint of Chrome for
  Testing 153 on SwiftShader (`bun run gate:compile`, `TYPESHADE_CHROMIUM`); the WebGL2 half of
  the gate on the same Chromium; no hardware device (the owner's adapter is a company machine
  and is not available to this work).
- Observed results: `bun run build`, `bun run lint`, `bun run format:check`, `bun run test` and
  `bun run gate:compile` green on the head commit; `src/compiler/ts/subgroups.test.ts` holds both
  halves, the oracle, the determinism rows and the refusals to section 3's table on one program;
  `examples/subgroup-reduce.shade.ts` compiles on the gate's Tint on a device that asked for
  `subgroups`. The pull request's checks are the retained evidence.
- Document audit: surface §50 and §77, Rule 11.21 and the decisions table of
  `docs/language-design.md`, AUTHORING.md's capability table and notes, `docs/roadmap.md`,
  `docs/debugging.md`, `docs/performance.md`, `docs/capability-coverage.md` (baked),
  `CHANGELOG.md`, and `reqs/` (`RULE-1121`, `SURF-050`, `SURF-077` reviewed).
- Deviations:
  - D-1, open. Rule 11.21 lists a broadcast or shuffle whose lane argument is not 0 as `target`.
    The determinism report is by float kind (surface §38, `DeterminismEntry.elem` is `f32` or
    `f64`), so an integer broadcast or shuffle from another lane has no row, though it differs
    on a subgroup of one the same way. Closing it needs a row kind for an integer read, a change
    to §38 this proposal does not declare, or an amendment of the sentence to float reads.
    Next action: the owner's decision, in a proposal-only pull request.
  - D-2, closed. Section 3's table gives `subgroupBroadcastFirst` the value `x` and no `target`
    row; the first active lane of a subgroup of one is lane 0, which the rule's sentence leaves
    out, so the implementation lists it under no row. Read as the approved text intends.
- Pending: the downstream deliveries below are tracked in their repositories and are not
  presumed complete.

## What it owes downstream

- typeshade.github.io: the language reference pages for the 21 functions and the two values come
  from the compiler's tables at the pin; `bun run check:guide` lists the Korean sections the new
  AUTHORING.md section leaves stale; the benchmark's fixed WGSL cases of web PR #22 become
  TypeShade source compiled at each build, with a catalog state for a build that refuses the
  source; the example joins the gallery and the Playground picker with its still and blurbs.
- vscode-typeshade: the generated declarations carry the family; the skill's list names it. Not
  searched yet.
- radiance: #536's compiler need C8 is met for the integer pre-reduction; the record notes the
  one-invocation meaning on WebGL2 and the `order` row for a float reduction.
