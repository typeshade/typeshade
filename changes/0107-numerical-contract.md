---
id: '0107'
title: An author can opt a function or module into named floating-point rewrites that the default O2 refuses, each with a stated domain and a measured error bound
status: draft
rules: []
surface:
  - 38
  - 69
exports: []
exports-removed: []
codes: []
examples: []
downstream: []
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0107, `status: draft`. The front matter is the identity and lifecycle authority. No approval exists.                                                                                                                                                                                                                                                                                                            |
| Date and attribution          | Drafted 2026-11-01, Asia/Seoul, by an AI agent at the maintainer's request. The date is the drafting date. It is not an approval date. The maintainer owns every decision this proposal leaves open. Git authorship of the containing commit is not an approval signature.                                                                                                                                               |
| Request source                | Issue [#852](https://github.com/typeshade/typeshade/issues/852), split out of [#841](https://github.com/typeshade/typeshade/issues/841) (body section 3). The comments on [#850](https://github.com/typeshade/typeshade/issues/850) (N5, N8) and issue [#851](https://github.com/typeshade/typeshade/issues/851) (N9, N10) name this contract as their prerequisite.                                                     |
| Applicability / effectivity   | Expected: `src/core/passes/opt/algebraic.ts`, `src/core/passes/opt/optimize.ts` (`OptLevel`, `LEVEL_PASSES`), the `"use typeshade"` front end if an annotation is chosen, `src/core/passes/determinism.ts`, `docs/language-design.md` §11, `docs/use-typeshade-surface.md` §38 and §69, and the emit goldens. The default `'O2'` output does not change. The CPU oracle does not change. No release version is assigned. |
| Review baseline               | `main` at `981b7c15` (merge of pull request #859), 2026-11-01.                                                                                                                                                                                                                                                                                                                                                           |
| Review and revision authority | No pull request is assigned yet. Git records the revisions of this file. The merge of a proposal-only pull request with `status: accepted` will record the decision.                                                                                                                                                                                                                                                     |

## What changes

### Today

The optimizer holds to gcc `-O2` without `-ffast-math`. The header of
`src/core/passes/opt/algebraic.ts` lists the float rewrites it applies: `x*1`, `x/1`, `x+0`,
`x-0`, `-(-x)`, `x - (-y)`, `x / 2^k` and `select(c, x, x)`. Each one holds for every value,
NaN and Inf included. The one deliberate exception is `x + 0 -> x`, which a signed zero can
observe. The same header refuses `x*0 -> 0`, `x-x -> 0`, and any reassociation or distribution
on floats.

Two reasons support that line. First, `x*0 -> 0` and `x-x -> 0` are wrong for NaN and Inf.
Second, reassociation and distribution cancel the error terms of the emulated double
(`src/core/fp64/df64-lib.ts`). Rule 4.4 requires the compiler to emit an `f64` as a pair of
`f32`, and the `emulated` row of the determinism report (surface §38) states that those pairs
hold only while nothing reassociates or fuses them.

This line keeps the promise of `docs/dx.md`: `-O2` computes what `-O0` computes, and the CPU
oracle is `-O0` (Rule 1.3).

### Proposed

1. Keep the default `'O2'` exact. No program changes unless its author opts in.
2. Define a numerical contract as a named, closed list of rewrite classes. Each class names its
   rewrites, its supported domain and its measured error bound.
3. Start with two classes, kept separate because their risks differ:
   - **finite-math.** The operands are assumed finite and not NaN. Candidates: `x*0 -> 0`,
     `0*x -> 0`, `x-x -> 0`, `mix(a, b, 0.0) -> a`, `mix(a, b, 1.0) -> b`. With finite operands
     these hold exactly, apart from the sign of a zero.
   - **reassociate.** Reassociation, distribution and factoring of `f32` arithmetic. These change
     rounding even for finite operands. The #841 candidates belong here: hash normalization moved
     to the end of fBm, factored palette and vignette, a shared palette phase, an eight-segment
     fold specialization and a vignette early return.
4. Let an author opt in through one mechanism. The mechanism is an open decision (see Why).
5. Never apply a contract to lowered df64 arithmetic: any expression `fp64-lower` produced, or
   any operand of type `f64`, `vecNf64` or `matN<f64>`.
6. Never apply a contract across an opaque function boundary. A rewrite inside an opted-in
   function stays inside it. Inlining an opted-in body into an exact caller does not extend the
   contract to the caller.
7. Admit a rewrite into a class only with a supported domain and a measured error bound,
   recorded where the rewrite is defined.
8. List each operation a contract rewrote in the determinism report (surface §38), in a new
   column or row the implementation names.

### Example

```ts
// Hypothetical spelling; the mechanism is not decided.
function tickRow(base: vec3, x: vec3, curl: f32, spread: f32): vec3 {
  // Under finite-math, a call with curl = 0 folds mix(...) to base,
  // and drops the sin/cos that fed X.
  return mix(base, x, curl).add(spread * hash12(base.xy));
}
```

Under the default `'O2'`, the same call keeps both expressions, because `mix(base, x, 0.0)` is
NaN when `x` is Inf, and `0.0 * hash` is NaN when the hash is NaN.

### Exclusions

- No class is on by default, at any level.
- No contract changes the CPU oracle. The oracle stays the meaning of the source.
- No contract reorders a reduction (Rule 7.2, the `order` rows of §38).
- No contract applies to integer arithmetic. Integer identities are already exact and already
  applied.

## Why

### Problem and evidence

- #841 lists five `f32` rewrites that hold in real arithmetic but change rounding. The compiler
  can't apply them today, and it shouldn't apply them silently.
- On #850, a whole-module constant-argument pass (N5) was built and measured on 2026-11-01
  against `main` at 981b7c15. The work left to remove was `mix(base, X, 0.0)` with its `sin` and
  `cos`, and `0.0 * Noise_hash12(…)`. Neither fold is exact for an infinite or NaN operand.
  The maintainer deferred N5 until this contract exists.
- #851 (N9, N10) needs finite in-domain values to prove that an output is fixed. It also names
  a numerical contract as its prerequisite.

Without a stated contract, each of these cases either stays out or enters as an unreviewed
exception. The `x + 0` exception in `algebraic.ts` shows how that happens.

### Alternatives for the opt-in mechanism

| Option                                                             | For                                                                                                                  | Against                                                                                                                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Global: a new level or emit option (for example `'O2-relaxed'`) | Smallest front-end change. Fits `packModule(m, { emit })` (§69) and `OptLevel`. One switch for a whole build.        | Coarse. Common modules (Rule 11.20) promise oracle bits on every tier, so a global switch must exclude them. The author cannot see in the source which code is relaxed. |
| B. Per function: an annotation on a `"use typeshade"` function     | The relaxed code is visible where it is written. Composes with the opaque-function rule. Tests can pin one function. | Adds an author-facing name, so Rule 2.1 applies. Needs a front-end check, and likely a diagnostic code. Inlining needs a stated rule.                                   |
| C. Per region: a block or call form inside a function              | The finest grain. Fits one hot expression, such as one palette.                                                      | Largest IR change: every pass must carry region marks through CSE, GVN and LICM. Hardest to define where a hoisted expression belongs.                                  |

Recommendation (proposal, not a decision): B, with the class names as its argument. A
function is the unit the optimizer already treats as opaque, and the annotation shows in the
source what the oracle no longer matches bit for bit.

### Assumptions

- Shader code rarely needs NaN or Inf on the paths these rewrites touch. This is an inference.
  The error-bound records must confirm it per rewrite.
- A GPU driver may already apply some of these rewrites. Then the gain on GPU time is smaller
  than the IR counts suggest (the #850 comment on N8 records the same inference).

### Open decisions

1. Which mechanism: A, B or C.
2. The names of the classes, and whether finite-math and reassociate are separate switches.
3. How a relaxed function and the CPU oracle compare: an error bound per rewrite, or a
   per-function tolerance in the differential gate.
4. Whether the existing `x + 0 -> x` exception moves into a class, as the `algebraic.ts`
   header suggests. That move would change the default `'O2'` output.
5. The rule number of the new rule in `docs/language-design.md` §11.
6. Whether common modules (Rule 11.20) may ever opt in.

## What it touches

- `rules`: empty in this draft. The change adds one rule to §11, next to Rule 11.2 and
  Rule 11.5. Its number is open decision 5. Rule 1.3 and Rule 4.4 constrain it and do not
  change.
- `surface` 38: the determinism report must show which operations a contract rewrote.
- `surface` 69: under option A, the emit options of `packModule` gain a level or a field.
  Under B or C, §69 may not change. Remove the entry at acceptance if it does not.
- `exports`: empty in this draft. Option A reshapes the exported type `OptLevel`. Option B or
  C adds an author-facing annotation. Either is a proposed public surface, not a decided one.
- `codes`: empty in this draft. Option B or C likely needs a code for a misplaced or unknown
  annotation.
- `examples`: none.

Required validation evidence:

- Unit tests per rewrite in `src/core/passes/opt/`, with a NaN, an Inf and a signed-zero input
  that show the rewrite stays out of exact code.
- A test that no rewrite reaches a df64 expression.
- An unchanged default: `bun run bake:goldens` produces no diff at `'O2'`.
- `bun run gate:differential` with the agreed comparison for relaxed functions.
- `src/core/passes/determinism.test.ts`, extended to place each rewritten operation.
- The mechanical gates of Rule 13.4.

### Draft impact estimate

- Known: the default output does not change. The oracle does not change.
- Known: option A touches `OptLevel` and `LEVEL_PASSES` only. Options B and C touch the front
  end, the IR and every pass that moves expressions.
- Estimate: option B is moderate work; option C is the largest. No duration or cost is
  estimated. Both are unknown.
- Dependencies: #850 N5 and #851 wait on this contract.
- Downstream: unknown until the mechanism is chosen. A public annotation or level would need a
  page on typeshade.dev and a line in the editor's skill.
- Open decisions 1 to 6 must be resolved before acceptance.

### Approval and plan record

This record does not yet apply. Acceptance will require the maintainer's decision on the
proposal-only pull request, the approved revision and scope, the resolved open decisions, the
assigned responsibilities and the agreed milestones.

### Configuration and validation record

This record does not yet apply. Delivery will require the accepted revision, the implementation
commits and pull requests, the delivered configuration, and the observed results of the
validation evidence listed above.

## What it owes downstream

None is declared in this draft. If the maintainer chooses a public level or annotation, the
proposal must name, before acceptance:

- typeshade.github.io: the page that documents optimization levels or annotations.
- The editor: its skill text on optimization.

Search each repository for `O2` and `OptLevel` at that time. No downstream work is assigned.
