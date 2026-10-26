---
id: '0097'
title: A scalar or vector conditional whose arm is costly lowers to an `if`, so the arm not taken does not run
status: accepted
rules:
  - '7.2'
surface:
  - 31
  - 76
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The TypeScript guide's sentence on `?:` says `select` on a scalar or a vector; say that a costly arm is an `if`, and record 0097 when the pin moves.
---

<!-- doc-refs: skip-file — names a perf gate case and a test file that exist only once the change is implemented -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0097, `status: accepted`. The front matter is the identity and lifecycle authority. The owner approved the proposal on 2026-10-26 (UTC); see Approval and plan record. Compiler implementation follows in its own pull request.                                                                                                                                                                                                                     |
| Date and attribution          | Authored 2026-10-26, UTC, by a Claude Code agent. The date is the authorship date. It is not an approval or a delivery date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                           |
| Request source                | The owner (Seungup) asked in a Claude Code session on 2026-10-26, in Korean, which compiler-only changes would improve the performance of the emitted code most, and then directed the agent to write the proposals, merge them, implement them and merge the implementations ("병합하고 구현까지 한 다음 머지까지 해놓아주세요"). This is the first of them: the one that needs no new rule, changes no result and has a measurable effect on both targets. |
| Applicability / effectivity   | The shared pre-emit pipeline (`src/core/emit.ts`, `src/core/passes/select-composite.ts`), the WGSL and GLSL ES 3.00 emit of every module that holds a scalar or vector conditional with a costly arm; the emit goldens of such examples; the perf gate's corpus. The CPU oracle and the CPU codegen are not affected: they read the IR, where the conditional stays a conditional. No release version is assigned.                                           |
| Review baseline               | `main` at `ff51e8f8c4dd07fae0c4001afd9541184a0c3507` (2026-10-26), which carries the performance gate (#776).                                                                                                                                                                                                                                                                                                                                                |
| Review and revision authority | The proposal-only pull request that carries this file. Git records its revisions; the pull request's merge with `status: accepted` records the decision, on the owner's instruction above.                                                                                                                                                                                                                                                                   |

## What changes

### The proposal in one paragraph

`c ? a : b` on a scalar or a vector lowers to WGSL's `select(b, a, c)` and GLSL's ternary, which
evaluate both arms (Rule 7.2). When an arm is costly, a call of a function of the module, a
texture read, or more than a few operations, the work of the arm not taken is wasted on every
invocation. This change lowers such a conditional the way a conditional on a struct already
lowers (surface §31): a slot and an `if`, so only the arm taken runs. A cheap arm keeps
`select`, which keeps the lanes of a workgroup together. An arm that holds a derivative, an
implicit-LOD texture sample, a barrier, or a call of a function that reaches one keeps `select`
too, since an `if` on a non-uniform condition would put it outside uniform control flow (Rule
8.5). The value is the same either way; only the cost changes.

### Before and after

```ts
"use typeshade";
function heavy(x: f32): f32 { return sin(x) * cos(x * 3.) + sqrt(abs(x)) * exp(-x * x); }
export function pick(x: f32): f32 {
  return x > 0.5 ? heavy(x) : 0.;
}
```

Before: `return select(0.0, heavy(x), (x > 0.5));`, and `heavy` runs for every `x`. After:

```wgsl
var _sel0: f32;
if ((x > 0.5)) {
  _sel0 = heavy(x);
} else {
  _sel0 = 0.0;
}
return _sel0;
```

GLSL ES 3.00 gets the same `if`; `x > 0.5 ? x * 2. : x * 3.` keeps `select` and the ternary.

### Proposed behavior

- **The cost of an arm** is the sum over the IR nodes of the arm: a call of a function of the
  module counts 16, a texture builtin (`textureLoad`, `textureSampleLevel`, …) 8, any other
  builtin call 2, an arithmetic, comparison or logical operation and a constructor 1, a
  literal, a name, a member or an index 0. An arm is _costly_ when its cost is 8 or more
  (decision D1).
- **The lowering.** A `select` whose condition is a scalar and whose value is a scalar or a
  vector, with at least one costly arm, is hoisted into a slot and an `if`, exactly as surface
  §31 hoists a composite: inside the statement's own block, never out of a loop body, bottom-up
  so a nested conditional hoists first. The CPU backends read the IR and change nothing.
- **Kept as `select`.** A conditional whose arms are both cheap; a componentwise `select` (a
  vector condition); and a conditional whose arm holds a derivative builtin, an implicit-LOD
  sample, a barrier, or a call of a function that reaches one of those (decision D2). The
  uniformity analysis of Rule 8.5 runs in the front end, before this pass, on the `select`;
  an `if` that the pass adds must therefore never hold a collective operation.
- **Where.** The shared pre-emit pipeline, in `select-composite.ts`, after the fp64 lowering
  and before the optimizer, so both targets lower one way and the optimizer sees the `if`.
- **Rule 7.9 is unchanged.** A call that writes in an arm is already an `if` (`sequence.ts`),
  before this pass; the pass sees no such call. `v ?? d` (surface §76) lowers to the same
  `select` and takes the same rule: a costly `d` is an `if`.
- **Measurement.** The perf gate's corpus gains a case, `branch`: a kernel whose loop body
  chooses between a costly helper and a cheap value by a condition that holds for a quarter of
  the elements. Its time before and after the change, on SwiftShader in CI and on the owner's
  device when a baseline exists, is the evidence (decision D3).

### Exclusions

No change to a conditional on a struct or an array (§31, already an `if`), to `&&` and `||`
(already an `if` where the right operand writes, Rule 7.9; otherwise both operands are cheap
by the same measure or stay as they are), to the CPU tiers, to `switch` lowering, or to any
diagnostic. No new option: the threshold is the compiler's, not the author's.

## Why

### The problem

`select` evaluates both arms on every target. A fragment shader that writes
`hit ? shade(hit) : background` runs `shade` for every pixel, and a kernel that writes
`active ? step(state) : state` runs `step` for every lane that is idle. The CPU oracle runs one
arm, so nothing in the differential gate sees the cost; only a timing does, and until #776 no
gate timed anything.

### Evidence

Measured on the baseline (`ff51e8f8`) with `scripts/perf-gate.ts`'s page on SwiftShader, on a
kernel over 262,144 elements whose arm is a 12-operation helper taken for one element in four:
the `select` form and the `if` form differ by the cost of the untaken arm, which is three
quarters of the helper's work. The exact numbers are the implementing pull request's to record,
before and after, with the gate.

### Alternatives

- (a) Convert every scalar conditional to an `if`. Rejected: a cheap arm as an `if` costs a
  branch and a possible divergence where `select` costs one instruction, and the goldens of
  most examples would change for nothing.
- (b) An author option, `@branch`, on the conditional. Rejected: the author would have to know
  the cost model of two targets; the compiler knows the arm.
- (c) Lower in the front end. Rejected: the front end's uniformity analysis would then see the
  `if` and refuse a derivative in an arm; keeping the `select` for those arms is simpler than
  teaching the analysis which `if`s are selects.

## What it touches

- **Rule 7.2**: the row `c ? a : b` on a scalar or vector gains "or an `if` with a temporary
  when an arm is costly (change 0097)", with the exclusions.
- **Surface §76**: the `v ?? d` row, which lowers to a `select` the same way, says that a costly
  `d` is an `if` too (Amendment 1, before acceptance: the implementing branch found the row).
- **Surface §31**: the section's paragraph "A scalar or a vector conditional keeps the operator
  each target has" changes to say when it does not, with the cost measure and the exclusions,
  and the before/after above.
- **Implementation files expected:** `src/core/passes/select-composite.ts` (the cost measure
  and the collective-arm exclusion beside the composite hoist), its test
  `src/core/passes/select-composite.test.ts`, `scripts/perf-gate.ts` (the `branch` case),
  `docs/performance.md` (the case), the emit goldens the change moves, `CHANGELOG.md`, the
  `reqs/` items of Rule 7.2 and §31.

### Draft impact estimate

Known: one pass gains a predicate and a reachability set over the module's functions; the
goldens of the examples with a costly arm change. Estimated: the compile gate and the
journeys are unaffected in validity, since the `if` is the form §31 already emits. The
downstream site changes one sentence when its pin moves. No duration or cost estimate is
established.

### Decisions

- **D1. The cost measure and the threshold.** Recommended: the weights above and a threshold
  of 8. Alternative: a threshold of 1 (any call). The weights make a `sqrt(x) * 2.` arm cheap
  and a helper call costly, which is the line the measurement supports.
- **D2. The collective exclusion.** Recommended: an arm that holds a derivative, an implicit-LOD
  sample, a barrier, or a call of a function that reaches one, keeps `select`. Alternative:
  none; an `if` around those is a Tint error on a non-uniform condition.
- **D3. The measurement.** Recommended: a `branch` case in the perf gate's corpus. Alternative:
  a one-off script; rejected, since the gate is where a later change is held.

### Approval and plan record

The owner, Seungup, directed in the Claude Code conversation on 2026-10-26 (UTC), after the
agent listed the compiler-only performance items in leverage order and the owner replied
"모두 승인" and then "병합하고 구현까지 한 다음 머지까지 해놓아주세요", that the agent write
the proposals, merge them as accepted, implement them and merge the implementations. The
coordinating agent reads that as the acceptance of this proposal with decisions D1 to D3
taking the recommended option; a decision the owner wants otherwise is an amendment of this
record. The approved revision is the merge of the pull request that carries this file with
`status: accepted`.

The declared impacts are final as the front matter states them. The required functional
validation: the unit suite, the compile gate on Tint and WebGL2, the journeys gate, and the
perf gate's `branch` case before and after. The required document validation: `docs:refs`,
`docs:impact`, `reqs:sync` and the Doorstop check. Responsibilities: the agent of the same
session implements it in commits that say `Change: 0097`. No milestone date, duration or cost
is assigned.

### Configuration and validation record

This record does not yet apply. Delivery will require the accepted proposal revision, the
implementation commits and pull request, the delivered configuration with tool versions, the
responsible actors, the observed results of the functional validation above, including the
perf gate's `branch` case before and after, and of the document validation, and the
disposition of each deviation.

## What it owes downstream

**typeshade.github.io.** The TypeScript guide says a scalar `?:` is `select`; one sentence
says that a costly arm is an `if`. The site records 0097 in `compiler-changes.md` when its pin
moves. That repository was not inspected in this session.

**vscode-typeshade, Radiance, TypeNN, TypeCV.** Nothing: the change accepts no new source and
changes no value a source computes.
