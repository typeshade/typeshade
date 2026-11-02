---
id: '0107'
title: An author can opt a function or module into named floating-point rewrites that the default O2 refuses, each with a stated domain and a measured error bound
status: accepted
rules:
  - '6.7'
  - '11.22'
surface:
  - 38
  - 78
exports:
  - FuncDecl
  - NumericsClass
  - DeterminismKind
exports-removed: []
codes:
  - TS8078
examples: []
downstream:
  - repo: typeshade.github.io
    what: Document the numerics(...) call and the numerics option of a stage call, the two classes and TS8078 on the pages generated from Rule 6.7, Rule 11.22 and surface §38 and §78, and record 0107 in compiler-changes.md
  - repo: vscode-typeshade
    what: Add numerics(...), the numerics option and TS8078 to the plugin skill's attribute and diagnostics references, and record 0107 in compiler-changes.md
---

<!-- doc-refs: skip-file — an accepted proposal names the rule and the code its implementation adds, which this tree does not have yet -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0107, `status: accepted`. The front matter is the identity and lifecycle authority. The owner approved it on 2026-11-02 (see Approval and plan record).                                                                                                                                                                                                                                                         |
| Date and attribution          | Drafted 2026-11-01, Asia/Seoul, by an AI agent at the maintainer's request. The date is the drafting date. It is not an approval date. The maintainer owns every decision this proposal leaves open. Git authorship of the containing commit is not an approval signature.                                                                                                                                               |
| Request source                | Issue [#852](https://github.com/typeshade/typeshade/issues/852), split out of [#841](https://github.com/typeshade/typeshade/issues/841) (body section 3). The comments on [#850](https://github.com/typeshade/typeshade/issues/850) (N5, N8) and issue [#851](https://github.com/typeshade/typeshade/issues/851) (N9, N10) name this contract as their prerequisite.                                                     |
| Applicability / effectivity   | Expected: `src/core/passes/opt/algebraic.ts`, `src/core/passes/opt/optimize.ts` (`OptLevel`, `LEVEL_PASSES`), the `"use typeshade"` front end if an annotation is chosen, `src/core/passes/determinism.ts`, `docs/language-design.md` §11, `docs/use-typeshade-surface.md` §38 and §69, and the emit goldens. The default `'O2'` output does not change. The CPU oracle does not change. No release version is assigned. |
| Review baseline               | `main` at `981b7c15` (merge of pull request #859), 2026-11-01. Re-read on `main` at `5e0e532a` (merge of #920), 2026-11-02: `algebraic.ts`, `OptLevel`, `LEVEL_PASSES`, Rules 1.3, 2.1, 4.4, 6.7, 11.2, 11.5, 11.20 and 13.4, surface §38 and §69 and `docs/dx.md` still say what this proposal quotes.                                                                                                                  |
| Review and revision authority | Pull request #861 (branch `docs/proposal-0107-numerical-contract`). Git records the revisions of this file. Its merge with `status: accepted` records the decision.                                                                                                                                                                                                                                                      |

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
     rounding even for finite operands. Of the #841 candidates (body section 3), two belong here:
     the normalization moved to the end of fBm (3.1) and the factored palette, brightness and
     vignette (3.2). The other three are not reassociation and are not in either class: the
     shared palette phase (3.3) is a trigonometric identity, the eight-segment fold (3.4) a
     specialization on a value's range, and the vignette early return (3.5) a consumer-driven exit
     of the kind #851 tracks. Each needs its own class or proposal (amended 2026-11-02).
4. Let an author opt in per function, with a call that wraps the function, in the form change
   0111 gives every other attribute (amended 2026-11-02, Amendment 2). A function of the file is
   written `const f = numerics(["finite-math"], function f(…) { … })`; an entry or a kernel
   function takes the classes as an option of its stage call, beside `diagnostic`:
   `fragment(f, { numerics: ["finite-math"] })`, `workgroup_size([128], f, { numerics: [...] })`.
   Each element names one class, `"finite-math"` or `"reassociate"`; there is no catch-all. A
   class name the compiler does not know, a repeated class, an empty list, a list that is not an
   array of string literals, and a `numerics(...)` call anywhere but as the initializer of a
   `const` at the top of the file are refused with `TS8078`, in `compile()` and in the editor
   alike (Rule 12.7). Rule 6.7 gains the name, and the ambient library declares the call and the
   option.
5. Never apply a contract to lowered df64 arithmetic: any expression `fp64-lower` produced, or
   any operand of type `f64`, `vecNf64` or `matN<f64>`.
6. Never apply a contract across an opaque function boundary. A rewrite inside an opted-in
   function stays inside it. Inlining an opted-in body into an exact caller does not extend the
   contract to the caller. The IR records no function of origin on an expression, so the order is
   fixed (amended 2026-11-02): the contract's rewrites run on an opted-in function before any pass
   inlines it, and no pass inlines an exact function into an opted-in one before they run. An
   inlined body then carries only rewrites already made, and the caller's own expressions stay
   exact.
7. Admit a rewrite into a class only with a supported domain and a measured error bound,
   recorded where the rewrite is defined.
8. List each operation a contract rewrote in the determinism report (surface §38), in a new
   column or row the implementation names.

### Example

```ts
const tickRow = numerics(
  ["finite-math"],
  function tickRow(base: vec3, x: vec3, curl: f32, spread: f32): vec3 {
    // Under finite-math, a call with curl = 0 folds mix(...) to base,
    // and drops the sin/cos that fed X.
    return mix(base, x, curl).add(spread * hash12(base.xy));
  },
);
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

### Decisions (the owner, 2026-11-02)

1. **Mechanism: B**, per function, spelled `@numerics(...)` (proposed item 4). (Amendment 2: spelled
   `numerics([...], f)` and the stage call's `numerics` option.)
2. **Classes:** `finite-math` and `reassociate`, separate switches; an author names each one.
3. **Comparison with the CPU oracle:** a `finite-math` function equals the oracle bit for bit on
   finite inputs, apart from the sign of a zero; a `reassociate` function stays within the ulp
   bound measured and recorded for each of its rewrites. The differential gate applies those
   comparisons to an opted-in function and the exact one to every other.
4. **`x + 0 -> x` stays where it is**, in the default `'O2'`. Moving it into a class would change
   the default output; that is a proposal of its own.
5. **The new rule is Rule 11.21**, after Rule 11.20. (Amendment 2: change 0117 took Rule 11.21
   first, so the rule is Rule 11.22.)
6. **Common modules (Rule 11.20) never opt in.** They promise the oracle's bits on every tier.

## What it touches

- `rules`: Rule 11.22 is new (Amendment 2): a numerical contract is opted into per function, by class, never
  for df64 or `f64` operands, never across a function boundary, never in a common module, each
  rewrite with its domain and measured bound. Rule 6.7 adds `numerics` to the attribute names
  the compiler reads, written as the call and the stage call's option. Rule 1.3 and Rule 4.4 constrain it and do not change. Rule 2.1 holds: the
  name is an extension the compiler reads, listed with the others of Rule 6.7 and in §9's
  extension table of `docs/language-design.md`.
- `surface` 38: the determinism report shows which operations a contract rewrote. Surface §78 (new)
  documents the annotation, its classes, the rewrites of each, the inlining boundary and `TS8078`.
- `exports` (Amendment 1): `FuncDecl` gains `numerics?: readonly NumericsClass[]`, the classes a
  function opted into, which every pass that copies a function carries; `NumericsClass` is new,
  `'finite-math' | 'reassociate'`; `DeterminismKind` gains `'contract'`, the kind of a report row
  that names a function under a contract and the class. All three are listed in
  `src/__api__/surface.md`. The annotation itself is source-level; the ambient library declares it
  for the editor.
- `codes`: `TS8078`, a refused `numerics` (an unknown or repeated class, an empty list, or a place
  other than a function). `TS8076` is reserved by draft 0052, so the next free number is taken.
- `examples`: none.

Required validation evidence:

- Unit tests per rewrite in `src/core/passes/opt/`, with a NaN, an Inf and a signed-zero input
  that show the rewrite stays out of exact code.
- A test that an opted-in function inlined into an exact caller leaves the caller's own
  expressions exact, and that an exact function inlined into an opted-in one is not rewritten.
- `TS8078` on each refused form, in `compile()` and in the editor (Rule 12.7).
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
- Downstream: the site and the editor (front matter `downstream`).
- Decisions 1 to 6 are resolved above.

### Approval and plan record

The owner (Seungup) approved the proposal in the Claude Code session on 2026-11-02 (UTC), in
Korean ("수락"), in answer to a review that listed four corrections (the misfiled #841 candidates,
the inlining order, the obligations of option B, the review baseline) and a recommendation for
each of the six open decisions. The decisions above are those recommendations. The spelling `@numerics(...)` and the code `TS8078` were written into this revision after that answer, and the owner confirmed both the same day, before the merge. The approved revision is the one this record is part of; the
merge of #861 with `status: accepted` records the decision.

Responsibilities: an agent of this repository implements Rule 11.22, `numerics` and `TS8078`
in a pull request whose commits say `Change: 0107`, starting with the `finite-math` class that
#850 N5 needs. Each `reassociate` rewrite enters with its measured bound, one at a time. The site
and the editor do their work when their pins move. No milestone date is assigned. No duration or
cost estimate is established.

### Amendment 1 (2026-11-02)

Before implementation, a reading of `main` at `334b9fc4` found that the accepted text could not be
delivered with `exports: []`:

- A per-function contract must be carried on the function through every pass that copies it
  (specialization, the restructuring of calls). The IR's place for that is a field of `FuncDecl`,
  and `FuncDecl` is listed member by member in `src/__api__/surface.md`. A new optional field
  reshapes that export.
- `FuncDecl.opaque` cannot stand in for it: `specializeCalls` and `restructureCalls` skip an opaque
  function, which would block the constant-argument specialization #850 N5 needs.
- Proposed item 8 needs a row of the determinism report that no existing `DeterminismKind` names,
  and `DeterminismKind` is exported.

This amendment declares the three exports and surface §78, and splits the delivery in two stages:

1. `@numerics` (Amendment 2: `numerics`) and `TS8078`, `FuncDecl.numerics`, the inlining boundary, the `finite-math` class,
   Rules 6.7 and 11.21 (Amendment 2: 11.22), surface §78, and the tests. The class's rewrites run on an opted-in
   function after `specializeCalls` and before `fp64Lower`, where an `f64` operand still has its
   type, so restricting them to `f32` and `f16` excludes every df64 expression (item 5). An
   opted-in function is never inlined into another function and receives no other function's
   body, so a rewrite never leaves the function it was written in (item 6).
2. The `'contract'` rows of the determinism report (item 8, surface §38).

`reassociate` is accepted as a class name from stage 1 and holds no rewrite until each one enters
with its measured bound (item 7). The owner approved this amendment in the Claude Code session on
2026-11-02 ("네 승인합니다"), before its pull request was opened.

### Amendment 2 (2026-11-02)

Before implementation, a reading of `main` at `1cb928fd` (merge of #926) found two conflicts with
work merged after this proposal was accepted:

- Change 0117 (subgroup operations) took Rule 11.21. The rule this proposal adds is Rule 11.22.
- Change 0111 (accepted) writes every attribute where a plain `tsc --strict` accepts it, and
  Rule 6.7 refuses every decorator outside its list of migrating forms. A plain TypeScript
  compiler refuses a decorator on a function declaration (TS1206), so a new `@numerics(...)`
  decorator would add the form 0111 removes.

This amendment spells the annotation the way 0111 spells `workgroup_size` (proposed item 4):

- A function of the file: `const f = numerics(["finite-math"], function f(…) { … })`.
- An entry or a kernel function: the `numerics` option of its stage call, beside `diagnostic`:
  `fragment(f, { numerics: ["finite-math"] })`.

`TS8078` refuses an unknown or repeated class, an empty list, a list that is not an array of
string literals, and a `numerics(...)` call anywhere but as the initializer of a `const` at the
top of the file. A decorator `@numerics` is refused with `TS8028`, as any other decorator
outside Rule 6.7's list. Everything else this proposal and Amendment 1 declare stays as it is.
The owner chose the call form in the Claude Code session on 2026-11-02, in answer to a question
that listed both forms and recommended this one.

### Configuration and validation record

This record does not yet apply. Delivery will require the accepted revision, the implementation
commits and pull requests, the delivered configuration, and the observed results of the
validation evidence listed above.

## What it owes downstream

- **typeshade.github.io.** The pages generated from Rule 6.7, Rule 11.22 and surface §38 and §78
  gain `numerics(...)`, the stage call's `numerics` option, the two classes and `TS8078`. Record 0107 in `compiler-changes.md` when the pin
  moves.
- **vscode-typeshade.** The plugin skill's attribute and diagnostics references gain
  `numerics(...)`, the `numerics` option and `TS8078`. Record 0107 in `compiler-changes.md` when the pin moves. The editor's diagnostics
  come from the language service, so they change with the pin.

Radiance, TypeNN and TypeCV owe nothing: no program changes unless its author opts in.
