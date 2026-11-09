---
id: '0131'
title: An author writes no numerical contract; the compiler applies a floating-point rewrite only where it proves the rewrite exact
status: accepted
rules:
  - '6.7'
  - '9.6'
  - '11.22'
surface:
  - 3
  - 38
  - 78
exports:
  - FuncDecl
  - DeterminismKind
exports-removed:
  - NumericsClass
codes:
  - TS8078
examples: []
names: []
downstream:
  - repo: typeshade.github.io
    what: Remove the TS8078 error-code page, the numerics lesson and operation model, the FuncDecl.numerics member text, the NumericsClass page, the contract text of the DeterminismKind page and the numerics mention in language-reference.ts; record 0131 in compiler-changes.md
  - repo: vscode-typeshade
    what: Confirm that the plugin skill names no numerics(...), numerics option or TS8078 (none found at db3f417) and record 0131 in compiler-changes.md when the pin moves
---

<!-- doc-refs: skip-file — an accepted proposal names the code and the files its implementation removes, which this tree no longer has -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0131, `status: accepted`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Date and attribution          | Drafted 2026-11-09 (UTC) by an AI agent (Claude Code) at the owner's direction. Revised 2026-11-09 (UTC) by an AI agent (Claude Code) after the independent review and the owner's decisions recorded below. The dates are drafting and revision dates. They are not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Request source                | The owner (Seungup) set the direction in the Claude Code session on 2026-11-09: TypeShade is a language, not a library; the language gains as little as possible; what the compiler can decide is compiler work and is never pushed onto the author; what the author does not need to learn is removed. The owner directed this removal in the same session. Draft proposal 0130 (pull request #1094) proposes the principle as a design rule and leaves this removal to its own proposal.                                                                                                                                                                                                                                                                                                                   |
| Applicability / effectivity   | Expected: `src/compiler/ts/numerics.ts` and its test, `src/compiler/ts/stage-call.ts`, `src/compiler/ts/lower/function.ts`, `src/compiler/ts/lower/expression-call.ts`, `src/compiler/ts/source-file.ts`, `src/compiler/ts/diagnostic-directive.ts`, `src/compiler/ts/codes.ts`, `src/core/ir/nodes.ts`, `src/core/emit.ts`, `src/core/passes/` (five files deleted, seven edited, `opt/algebraic.ts` and its test among them), `src/common-modules.test.ts`, `src/language-service/ambient.ts`, `docs.ts` and `diagnostics.ts`, `docs/language-design.md`, `docs/use-typeshade-surface.md`, `docs/compiler-owns-performance.md`, `CHANGELOG.md`, `reqs/`. The default `'O2'` output of a program that writes no `numerics` does not change. The CPU oracle does not change. No release version is assigned. |
| Review baseline               | `main` at `16a3c36f` (merge of pull request #1097), 2026-11-09. Every count below was measured with `git grep` on that commit unless the row says otherwise. The revision of 2026-11-09 merged `main` at `79c76d48` (merge of pull request #1098) into the branch and re-measured the two halves there.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Review and revision authority | Pull request #1104 (draft). Git records the revisions of this file. Its merge with `status: accepted` will record the decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## What changes

### Today

Change 0107 (implemented, Rule 11.22, surface §78) lets an author opt a function into named
floating-point rewrites that the default `'O2'` refuses:

- `const f = numerics(["finite-math"], function f(…) { … })` for a function of the file;
- `fragment(f, { numerics: ["finite-math"] })` or `workgroup_size([128], f, { numerics: [...] })`
  for an entry or a kernel function.

The classes are `finite-math` and `reassociate`. `finite-math` holds five rewrites on `f32`
(`x * 0`, `0 * x`, `x - x`, `mix(a, b, 0)`, `mix(a, b, 1)`; `src/core/passes/finite-math.ts`).
`reassociate` holds no rewrite. `TS8078` refuses a wrong class list or a misplaced call. Three
passes serve the opt-in: `finite-math.ts`, `contract-constants.ts` (a copy of an opted-in
function per literal argument set, #950) and `contract-boundary.ts` (no inlining across an
opted-in function). The determinism report lists a `contract` row per class.

### Proposed

1. Remove the `numerics(...)` call and the `numerics` option of every stage call from the
   language. The ambient library stops declaring both. `workgroup_size` loses its `options`
   parameter, because `numerics` is its only option (`src/language-service/ambient.ts:1661`).
2. Retire `TS8078`. Do not reuse the number (the convention in the header of
   `src/compiler/ts/codes.ts`).
3. Rewrite Rule 11.22 as the rule that replaces the opt-in. Proposed text:

   > **Rule 11.22.** No source construct opts a function into a floating-point rewrite; change
   > 0131 removed the `numerics` contract of change 0107. The optimizer must apply a rewrite
   > that a NaN, an infinity or the sign of a zero can observe (`x * 0` to `0`, `x - x` to `0`,
   > `mix(a, b, 0)` to `a`) only where it proves that the operands are in the domain where the
   > rewrite gives the CPU oracle's bits, with one exception: `x + 0` and `0 + x` to `x`
   > (decision 4 of change 0107), which ignores the sign of a zero, as WGSL §15.7.2 permits.
   > It must apply no rewrite that changes the rounding of `f32` arithmetic (reassociation,
   > distribution, factoring).
   >
   > - Rationale: the GPU computes what the oracle computes (`docs/dx.md`), and a rewrite the
   >   compiler can prove exact needs nothing from the author. A rewrite that cannot be proved
   >   exact changes a result, so neither the author nor the compiler opts into it.
   > - Derives from: change 0107 (removed by 0131); `changes/0131-remove-numerics.md`; Rule 1.3;
   >   Rule 4.4; Rule 11.20.
   > - Enforced by: `src/core/passes/opt/algebraic.ts`, and `src/core/passes/opt/algebraic.test.ts`,
   >   which asserts that `x * 0`, `x - x`, `mix(a, b, 0)` and `mix(a, b, 1)` are kept
   >   (`Verifies: Rule 11.22`).

   The lineage stays in the rule itself, as Rule 9.4 says "Rule 9.9 removed `pow`". The
   implementation adds the two `mix` cases and the `Verifies: Rule 11.22` tag to
   `algebraic.test.ts`; the `x * 0` and `x - x` cases exist (lines 105-106 at `79c76d48`).

4. Delete `src/core/passes/finite-math.ts`, `contract-constants.ts` and `contract-boundary.ts`
   with their tests. Remove the `outsideContracts` wrapper from the five inlining passes
   (`restructureCalls`, `inlineLinearAll`, `forceInline`, `autoInline`, `inlineFn`) and the two
   steps from `src/core/emit.ts`. Remove the common-module test that refuses `numerics`
   (the `describe` block at `src/common-modules.test.ts:40-52`, whose test is lines 44-49), which has no
   subject after the removal. Git keeps the code at `16a3c36f`, from which a proof-gated pass
   can start (item 8).
5. Remove `FuncDecl.numerics`, the type `NumericsClass`, the `'contract'` member of
   `DeterminismKind` and the `contract` rows of the determinism report (surface §38).
6. Keep the numbers Rule 11.22 and surface §78 with the new content, so that change 0107 and
   this change cite a rule and a section that exist (`src/changes.test.ts`, "once implemented,
   cites rules, surface sections and examples that exist"). Surface §78 keeps its title and
   states the new Rule 11.22, the five rewrites the compiler may apply once it can prove their
   domain, and that change 0131 removed `numerics` and `TS8078`. The section does not hide the
   removal behind a new title.
7. Replace the two `[Unreleased]` entries of `CHANGELOG.md` that describe the construct (lines
   83-93 and 165-166 at `16a3c36f`) with one entry that records the withdrawal of the
   `contracts | numerics` row (Rules 13.7 and 13.8). The construct was never released: the one
   published version is `0.1.0` of 2026-09-29 (`CHANGELOG.md`), and change 0107 landed after it.
8. Replace the opt-in with compiler work that needs no proposal, because it is exact and adds
   nothing an author writes (`changes/README.md`, "When a change needs one"): a value-domain
   analysis over `f32` that proves an operand finite, not NaN and, where the rewrite needs it,
   of known sign. A rewrite of item 3 applies only where that proof holds. This proposal does
   not deliver the analysis. Open a compiler issue for it, linked from #850 and #851.

### What an author sees after the change

- A source that still writes `numerics(...)` calls an undeclared function. `compile()` gives
  `TS8004` and the editor gives `TS8004` too, because Rule 12.4 merges TypeScript's `TS2304`
  into `TS8004` (`SAME_MISTAKE` in `src/language-service/diagnostics.ts`). Measured on
  `79c76d48` with an undeclared wrapper of the same shape: `TS8004 Unknown function "relaxed".
…` in both halves, then a cascade `TS8099` on the class list in both halves. The cascade
  `TS8099` stays, as it does for any unknown function today. This proposal does not change it.
- A stage call that still passes `{ numerics: [...] }` to `vertex`, `fragment` or `compute` gets
  one `TS8028` in both halves, as any unknown option does today (measured on `79c76d48` with
  `{ bogus: 1 }` on `fragment`: `TS8028` in both halves, no other diagnostic). The `TS8028`
  message changes from `A stage call takes two options, "diagnostic" and "numerics"; … is not
one.` (`src/compiler/ts/diagnostic-directive.ts:160` at `79c76d48`) to a message that names
  the options that remain (see "Interaction with 0130 and 0132").
- A third argument to `workgroup_size` gets one `TS8028` in both halves. The editor merges
  TypeScript's excess-argument or excess-property diagnostic into it (Rule 12.4). Today, on
  `79c76d48`, `workgroup_size([64], k, { bogus: 1 })` gives `TS8028` in `compile()` and
  `TS2353` plus `TS8028` in the editor.
- An author who wants #965's gain deletes the dead terms by hand. In Namek's tick, that means
  removing the `curl` and `spread` terms that the one call passes as `0`. The compiler does not
  remove them, because neither fold is exact (see "Why").

### Example

Before (accepted on `main` at `16a3c36f`; surface §78):

```ts
const tick = numerics(["finite-math"], function tick(base: vec3f, x: vec3f, spread: f32): vec3f {
  return mix(base, x, 0.0).add(spread * hash12(base.xy));
});
```

After:

```ts
function tick(base: vec3f, x: vec3f, spread: f32): vec3f {
  return mix(base, x, 0.0).add(spread * hash12(base.xy));
}
```

The emitted `mix(base, x, 0.0)` stays until the compiler proves `base` and `x` finite. Then the
compiler folds it to `base` with no change to the source. An author who knows the operands are
finite and wants the fold now writes `base` in the source.

### Exclusions

- The default `'O2'` rewrites in `src/core/passes/opt/algebraic.ts` do not change. The `x + 0`
  exception (decision 4 of change 0107) stays where it is, and the new Rule 11.22 names it.
- The `fast` reduction mode of `docs/compiler-owns-performance.md` (lines 61, 92 and 243, and
  open decision 3 at line 271) is excluded from Rule 11.22 until a proposal amends the rule. The
  mode is a proposal in that document and is not implemented. Open decision 3 there names
  "#852's numerical contract", which this change removes; the implementation edits that sentence
  so that it names Rule 11.22 and this exclusion.
- `contract-constants.ts` is an exact transform: it copies a function per set of literal
  arguments. A general `-O2` pass of that kind would need no proposal. It was limited to
  opted-in functions by the maintainer's decision on #850 of 2026-11-02 (the header of
  `contract-constants.ts` at `16a3c36f`), and #850 N5 measured the general form on 2026-11-01:
  about two multiplications saved per call and 34 goldens changed. This proposal deletes the
  file with its trigger and does not propose a general pass. A general pass stays compiler work,
  to measure on its own issue.
- Nothing changes in the CPU oracle or in the emulated double (Rule 4.4).
- The `diagnostic` option on `workgroup_size` is a separate two-halves split on `79c76d48`:
  `compile()` accepts `workgroup_size([64], k, { diagnostic: ['off', 'derivative_uniformity'] })`
  with no diagnostic, and the editor refuses it with `TS2353`. It is a bug, out of the scope of
  this change. After this change, both halves refuse it with `TS8028`.

## Why

### Problem and evidence

- The owner's direction of 2026-11-09 removes what the author does not need to learn. An author
  of `numerics` must learn two class names, their domains, the inlining boundary and `TS8078`.
- A relaxation changes results, so the compiler cannot apply one silently. `docs/dx.md` (lines
  22-26): the CPU oracle is `-O0`, and the GPU "computes the same thing, faster". The
  differential gate holds the GPU to the `f32` oracle bit for bit (`AGENTS.md`, `gate:differential`).
  `docs/compiler-owns-performance.md` (line 243): "Only an opt-in such as `fast` may differ". So
  a removed opt-in leaves two choices: apply a rewrite only where the compiler proves it exact,
  or do not apply it. This proposal takes both: proof-gated where a proof exists, none where it
  does not.
- No program uses the opt-in on `main` at `16a3c36f` (measured, see "What it touches"). The one
  use is draft pull request #965 (not merged), which opts Namek's grass tick into
  `finite-math`.

### Alternatives

| Option                                                                             | For                                                                                                                                      | Against                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Remove the opt-in; delete the three passes (this proposal; decided, decision 1) | The smallest language and the smallest compiler. No code without a trigger stays in the tree.                                            | The `finite-math` rewrites must be rebuilt from Git when a proof exists. The measured gain of #965 is not delivered (decision 0).                                                                                                                                                                                                                                                      |
| B. Remove the opt-in; keep `finite-math.ts` behind a proof gate                    | The rewrite code stays ready. The proof can grow one case at a time.                                                                     | With no value-domain analysis on `main` (none found in `src/core/passes/`), the gate proves almost nothing at first, so the pass is code with no effect.                                                                                                                                                                                                                               |
| C. Keep `numerics` (no change)                                                     | The measured Namek gain of #965 can land.                                                                                                | Conflicts with the owner's direction of 2026-11-09. The author decides what the compiler could prove.                                                                                                                                                                                                                                                                                  |
| D. Apply `finite-math` by default, everywhere (rejected, decision 0)               | No author construct. WGSL already lets a driver assume finite math (§15.7.2, quoted in `docs/compiler-owns-performance.md` lines 68-75). | Conflicts with `docs/dx.md` (lines 22-26: the GPU "computes the same thing") and with the differential gate, which holds the GPU to the oracle bit for bit. Rule 1.3 alone does not forbid it: Rule 1.3 allows a permitted answer where WGSL leaves room, and WGSL §15.7.2 permits the fold. The compiler, not a driver, would make every program's GPU answer differ from its oracle. |

Decision (2026-11-09): A, with D rejected (decisions 0 and 1 below).

### Assumptions

- The rewrites that a proof can admit are few until an analysis exists. This is an estimate:
  no analysis exists to measure.
- #965's gain is unlikely to come back through the analysis of item 8. Fact: in Namek's tick on
  #965's branch, `fk = (f32(k) - mid) / mid` with `mid = 0.5 * f32(n - 1)` is `0 / 0`, a NaN, at
  `n = 1` (`examples/capsule-corp-namek-class.shade.ts` on `feat/namek-numerics`). So
  `curl * sin(… fk)` is NaN there, and the fold to `0` is not exact. `seed` is a parameter, and
  its finiteness depends on the caller's data. Inference: no sound analysis admits these folds.
- WGSL's Finite Math Assumption (§15.7.2) lets a driver make some of these folds already. Then
  the GPU-time gain of a compiler fold is smaller than the WGSL size suggests. This is an
  inference, also recorded on #850 (N8).

### Conflicts

- `docs/compiler-owns-performance.md` (lines 13-14): a program "must become faster when the
  compiler improves". `docs/dx.md` (lines 22-26) and the differential gate: the GPU computes what
  the oracle computes. This proposal does not trade one for the other. It gives up the measured
  gain of #965 and keeps the oracle's bits. The owner decided this on 2026-11-09 (decision 0).

## Why the compiler cannot do it

Not applicable: this proposal adds no author-facing name, no rule, no diagnostic code and no
surface form. It removes the `numerics(...)` call, the `numerics` option, `TS8078` and the
`contracts | numerics` extension row. It rewrites Rule 11.22 and surface §78 in place, and the
new text adds nothing an author writes. The reverse question is answered under "Why": the
compiler can do the safe part (a rewrite it proves exact), and nobody does the unsafe part.

## What it touches

- `rules` 6.7: `numerics` leaves the attribute names the compiler reads, with its spelling
  sentence and `TS8078`. The "Enforced by" entry loses `src/compiler/ts/numerics.ts`.
- `rules` 9.6: the §9.3 extension table loses the `contracts | numerics` row. "Eleven families"
  becomes ten, and family 11 is removed. The `LINT.IfChange` block names
  `src/core/spec-conformance/surface-names.test.ts:extensions`, which changes with it.
- `rules` 11.22: rewritten as proposed item 3, with the lineage, the `x + 0` exception, "Derives
  from" and "Enforced by". The number stays (proposed item 6).
- `surface` 3: the stage-call option list loses `numerics` and the link to §78. `workgroup_size`
  takes no options.
- `surface` 38: the determinism report loses its `contract` rows.
- `surface` 78: rewritten as proposed item 6.
- `exports` `FuncDecl`: loses `numerics?: readonly NumericsClass[]`.
- `exports` `DeterminismKind`: loses `'contract'`.
- `exports-removed` `NumericsClass`: removed from `src/core/ir/nodes.ts` and `src/index.ts`.
- `codes` `TS8078`: retired, never reused. `TS8028` keeps its code; its message changes
  (proposed item 1 and "Interaction with 0130 and 0132").
- `examples`: none. No example writes `numerics` (0 of 102 `examples/*.shade.ts`). Two files say
  "numerics-textbook" in prose (`examples/fp64-cancellation-twin.shade.ts:13`,
  `examples/fp64-cancellation.ts:3`) and do not use the construct.
- `names`: none added. `numerics` leaves `src/__api__/author-names.md` (line 170 at
  `16a3c36f`); a removed name is not a criterion (`changes/README.md`).

Measured on `main` at `16a3c36f` (`git grep`):

| Item                                                            | Count                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Examples that write `numerics(` or `numerics:`                  | 0 of 102                                                                                                                                                                                                                                                                                                                    |
| Common modules and `src/algorithms`, `src/random` that write it | 0                                                                                                                                                                                                                                                                                                                           |
| Files to delete                                                 | 7: `numerics.ts` (146 lines), `numerics.test.ts` (125), `finite-math.ts` (91), `finite-math.test.ts` (198), `contract-boundary.ts` (64), `contract-constants.ts` (177), `contract-constants.test.ts` (98)                                                                                                                   |
| Other files under `src/` that name the construct or its passes  | 31 (lines matching `numerics`, `NumericsClass`, `finiteMath`, `finite-math`, `outsideContracts`, `underContract`, `specializeContractConstants`, `TS8078` or `'contract'`), `src/AGENTS.md` and two `src/__api__/` records among them. 30 need an edit; one, `src/core/fp64/df64-lib.ts:899`, says "numerics" only in prose |
| Documents and records                                           | `docs/language-design.md` (6 lines), `docs/use-typeshade-surface.md` (19), `src/AGENTS.md` (5), `CHANGELOG.md` (6, all under `[Unreleased]`), `docs/compiler-owns-performance.md` (1, line 271), `reqs/rules/RULE-0607.md`, `RULE-1122.md`, `reqs/surface/SURF-078.md`                                                      |

Downstream, measured on each repository's default branch, 2026-11-09:

| Repository                                                                           | Commit    | Uses of `numerics(`, `numerics:`, `TS8078`, `NumericsClass`                                                                                                                                                                           |
| ------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| typecv                                                                               | `4189b3c` | 0                                                                                                                                                                                                                                     |
| typenn                                                                               | `3a7d66c` | 0                                                                                                                                                                                                                                     |
| typeaudio                                                                            | `27287bb` | 0                                                                                                                                                                                                                                     |
| radiance                                                                             | `3e4efb3` | 0                                                                                                                                                                                                                                     |
| vscode-typeshade                                                                     | `db3f417` | 0                                                                                                                                                                                                                                     |
| typeplot (not a `DOWNSTREAM_REPOS`)                                                  | `9f20c12` | 0                                                                                                                                                                                                                                     |
| web (`apps/typeshade` is typeshade.dev, `typeshade.github.io` in `DOWNSTREAM_REPOS`) | `ed33afb` | 8 files outside `compiler-changes.md` and a built benchmark artifact (7 that name `numerics` or `TS8078`, and `determinismkind.json`, which describes `contract`), all documentation of the construct (see "What it owes downstream") |

Required validation evidence (at implementation):

- `bun run bake:goldens` with no golden changed: no example opts in, so every emit stays.
- A test, both halves, on the same sources (Rule 12.7): `numerics(...)` gives `TS8004` in
  `compile()` and in the editor; `{ numerics: [...] }` on `vertex`, `fragment` and `compute`
  gives one `TS8028` in both; a third argument to `workgroup_size` gives one `TS8028` in both,
  with TypeScript's excess diagnostic merged.
- `src/core/passes/opt/algebraic.test.ts`: `x * 0`, `x - x`, `mix(a, b, 0)` and `mix(a, b, 1)`
  kept, tagged `Verifies: Rule 11.22`.
- `src/core/passes/determinism.test.ts`: no `contract` row exists.
- `bun run bake:api-surface`: only `FuncDecl`, `DeterminismKind` and `NumericsClass` change.
- `bun run bake:author-names`: only `numerics` leaves.
- `bun run reqs:sync` and `python scripts/doorstop-check.py -C` after the rule edits.
- `bun run docs:impact` and `bun run docs:refs`.
- The mechanical gates of Rule 13.4 and the compile gate (`gate:differential` included).

### Draft impact estimate

Known:

- No program on `main` or in a downstream default branch writes the construct, so no program's
  output changes.
- Draft pull request #965 is the only use. Its measured gain (on its branch, 2026-11-02, with
  `compile()`): Namek's tick function 1,254 to 992 WGSL bytes, the module 57,233 to 56,741 bytes,
  and 5 to 4 `hash12` calls per blade. This removal does not deliver that gain, and the owner
  accepted that on 2026-11-09 (decision 0). #965 is closed unmerged after this proposal is
  accepted (decision 4).
- Deviation 2 of change 0107 (the differential comparison for a relaxed function) has no
  subject after the removal and closes.
- No value-domain analysis exists in `src/core/passes/` at `16a3c36f` (searched for range,
  interval and domain passes: none found).
- No migration release is needed (decision 3). Rules 13.9 and 13.10 bind a published version,
  and no published version has the construct (proposed item 7).

Estimated:

- The removal is mostly deletion: seven files and the hooks in 30 others. No duration or cost is
  estimated; both are unknown.
- The replacement analysis (proposed item 8) is compiler work of unknown size. Candidate proof
  sources, each to measure: a finite literal; a conversion from `i32` or `u32` to `f32`, whose
  result is finite; `fract`, `sin` and `cos` of an operand already proved finite. It is unlikely
  to reach Namek's tick (see "Assumptions").
- Bundle size: the three passes and the front-end reader leave `typeshade/runtime`, `emit` and
  `fuse`. The size was +595, +551 and +613 gzipped bytes at #936 and +761, +754 and +721 at #950
  (their records). The saving at `16a3c36f` is not measured.

### Interaction with 0130 and 0132

- Draft proposal 0130 (pull request #1094) removes the stage calls and edits Rule 6.7 and surface
  §3. It requires 0131 to be accepted first. This proposal edits the same rule and section; 0130
  is written against the text this proposal leaves.
- Draft proposal 0132 (pull request #1105, remove `diagnostic`) removes the other stage-call
  option and also edits `src/compiler/ts/diagnostic-directive.ts`. If only 0131 is implemented,
  `diagnostic` stays the one option, and the `TS8028` message names it alone. If both are
  implemented, a stage call takes no options: the `options` parameter leaves the ambient stage
  calls, and `TS8028` says that a stage call takes no options.
- Merge order of the implementations: 0131 first, then 0132. The second to land deletes
  `diagnostic-directive.ts` and moves what is left of the options parser to
  `src/compiler/ts/stage-call.ts`. If 0132 lands first, 0131 is the second and does that work.
  The proposal pull requests (#1104, #1105) touch different files and merge in any order.

### Decisions for the owner before acceptance

0. **Decided 2026-11-09.** Accept that #965's measured gain (Namek's tick 1,254 to 992 WGSL
   bytes) is not delivered, and reject option D (apply `finite-math` by default). The owner
   decided this by the approval of decisions 1 and 4 ("추천대로", then "승인", in the Claude Code
   session): option A and closing #965 unmerged both give up the gain, and option D is the only
   alternative that keeps it with no author construct.
1. **Decided 2026-11-09: option A** (delete `finite-math.ts`, `contract-constants.ts`,
   `contract-boundary.ts` and their hooks). The owner's words in the Claude Code session:
   "추천대로" (as recommended), then "승인" (approved).
2. **Decided 2026-11-09: keep the numbers Rule 11.22 and surface §78 with new content.** The
   alternative was to remove them and change `src/changes.test.ts` to accept a removed rule for
   an implemented proposal. The owner's words in the Claude Code session on 2026-11-09: "승인" (approved), given to the recommendation.
3. A source that still writes `numerics(...)`: the plain `TS8004` (recommended: no program uses
   it, and no published version has it), or a migration release with a named message and a
   `tshc migrate` step. **Decided 2026-11-09: the plain `TS8004`, no migration release.** The owner's words in the Claude Code session on 2026-11-09: "승인" (approved), given to the recommendation.
4. **Decided 2026-11-09: close draft pull request #965 unmerged, after 0131 is accepted.** The
   owner's words: "추천대로", then "승인". #965 stays open until then.
5. **Decided 2026-11-09: set change 0107 to `archived`, with a line that names 0131, in the
   pull request that implements this change.** The owner's words in the Claude Code session on 2026-11-09: "승인" (approved), given to the recommendation.

### Independent review record

Reviewer: a Claude Code agent that did not write this proposal. Date: 2026-11-09. Revision
reviewed: `2dd2e26b`, against the baseline `16a3c36f`. Verdict: the direction holds; the
proposal was not ready for the owner's decision. The answers below are in the revision that
follows `2dd2e26b` on pull request #1104.

| Finding                                                                                                                                                                                                                                                                         | Status                      | Answer                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1. The proposed Rule 11.22 is broken by today's `-O2` fold `x + 0` to `x` (`src/core/passes/opt/algebraic.ts:22-27`), which a signed zero observes.                                                                                                                            | Fixed                       | The rule names the exception: "`x + 0` and `0 + x` to `x` (decision 4 of change 0107), which ignores the sign of a zero, as WGSL §15.7.2 permits."                                                                                                                                                                                                 |
| B2. The editor gives `TS8004`, not `TS2304`: Rule 12.4 merges `TS2304` into `TS8004` (`src/language-service/diagnostics.ts:1345-1351`, `SAME_MISTAKE`), with a cascade `TS8099`.                                                                                                | Fixed                       | "What an author sees" and the validation evidence say `TS8004` in both halves. Re-measured on `79c76d48`: `TS8004` then `TS8099` in both halves.                                                                                                                                                                                                   |
| B3. `workgroup_size` declares `options?: { readonly numerics?: unknown }` (`ambient.ts:1661`). An unknown option gives `TS8028` in `compile()` and `TS2353` plus `TS8028` in the editor. `diagnostic` on `workgroup_size` is accepted by `compile()` and refused by the editor. | Fixed                       | Proposed item 1: `workgroup_size` loses its `options` parameter; a third argument gives one `TS8028` in both halves with the TypeScript diagnostic merged. The test covers `vertex`, `fragment`, `compute` and `workgroup_size`. Re-measured on `79c76d48`. The `diagnostic` split is recorded as a separate bug under "Exclusions", out of scope. |
| B4. The gain and `docs/dx.md` conflict was left to the author; option D's "Against" cited Rule 1.3, which allows a permitted answer.                                                                                                                                            | Fixed; decided by the owner | Decision 0 records the owner's decision of 2026-11-09. Option D's "Against" cites `docs/dx.md:22-26` and the differential gate's bit equality, and says Rule 1.3 alone does not forbid it.                                                                                                                                                         |
| S1. `CHANGELOG.md` (Rules 13.7 and 13.8): `numerics` was never released; its entries are under `[Unreleased]` (`CHANGELOG.md:83-93`, 165). Rules 13.9 and 13.10 do not bind.                                                                                                    | Fixed                       | Proposed item 7 replaces the entries with one withdrawal entry. Decision 3 and the impact estimate give "no published version has it" as the reason for no migration release.                                                                                                                                                                      |
| S2. The web repository's Korean API pages of `NumericsClass` and `DeterminismKind` (`numericsclass.json`, `determinismkind.json`) were missing.                                                                                                                                 | Fixed                       | Both are in "What it owes downstream" and in the front matter's `downstream` entry.                                                                                                                                                                                                                                                                |
| S3. The cascade `TS8099` was to be fixed without scope; the changed `TS8028` message was not named.                                                                                                                                                                             | Fixed                       | The cascade `TS8099` stays, as for any unknown function. The `TS8028` message of `diagnostic-directive.ts:160` is named, with what it becomes.                                                                                                                                                                                                     |
| S4. The new Rule 11.22 had no "Enforced by" and no "Derives from".                                                                                                                                                                                                              | Fixed                       | Both are in the proposed rule text: `algebraic.ts` and `algebraic.test.ts` (`Verifies: Rule 11.22`); change 0107 (removed by 0131) and this proposal.                                                                                                                                                                                              |
| S5. The rule excludes the `fast` reduction mode of `docs/compiler-owns-performance.md` (lines 61, 92, 243; open decision 3 at line 271) without saying so.                                                                                                                      | Fixed                       | "Exclusions" states that `fast` is excluded until a proposal amends Rule 11.22. The document is in scope: line 271 is edited.                                                                                                                                                                                                                      |
| S6. No interaction paragraph with 0130 and 0132.                                                                                                                                                                                                                                | Fixed                       | "Interaction with 0130 and 0132" names both, the shared file and the merge order.                                                                                                                                                                                                                                                                  |
| S7. The lineage was to be hidden by a new §78 title.                                                                                                                                                                                                                            | Fixed                       | The lineage is in Rule 11.22 itself, after the precedent of Rule 9.4. §78 keeps its title.                                                                                                                                                                                                                                                         |
| N1. Counts: `contract-constants.test.ts` is 98 lines; the surface document has 19 lines; 31 files under `src/`, one of them prose-only.                                                                                                                                         | Fixed                       | The table gives 98, 19 and 31 (30 to edit, `df64-lib.ts` prose-only).                                                                                                                                                                                                                                                                              |
| N3. The gain is unlikely to come back: `fk` is `0 / 0` at `n = 1`; `seed`'s finiteness is unknown.                                                                                                                                                                              | Fixed                       | "Assumptions" states it, with the source on #965's branch.                                                                                                                                                                                                                                                                                         |
| N4. `contract-constants.ts` is an exact transform that could stay as a general `-O2` pass; #850's decision of 2026-11-02 limited it.                                                                                                                                            | Fixed                       | "Exclusions" names it and leaves a general pass to compiler work.                                                                                                                                                                                                                                                                                  |
| N5. The removal of `src/common-modules.test.ts:44-49` was not named.                                                                                                                                                                                                            | Fixed                       | Proposed item 4 names it.                                                                                                                                                                                                                                                                                                                          |
| An author who wants #965's gain must delete the dead terms by hand; the proposal did not say so.                                                                                                                                                                                | Fixed                       | "What an author sees" and the example say so.                                                                                                                                                                                                                                                                                                      |

Open findings: none. Open decisions for the owner: none.

### Approval and plan record

- **Decision.** Accepted by the owner (Seungup) on 2026-11-09, in the Claude Code session, by the
  answer "병합" (merge) to the question whether to merge pull request #1104 as accepted. The
  owner cannot approve their own pull request on GitHub, so this go-ahead is the review
  (`CLAUDE.md`, Merging). The merge of #1104 with `status: accepted` records the decision.
- **Approved revision and scope.** This file as merged by #1104: decisions 0 to 5 as recorded
  above, and the rules, surface sections, exports, codes and downstream work in the front matter.
- **Evidence read at acceptance.** The independent review record above (revision `2dd2e26b`,
  every finding fixed) and the measurements in Draft impact estimate.
- **Responsibilities.** Implementation is not yet assigned. Each implementing pull request carries
  `Change: 0131`.
- **Milestones.** One implementing pull request, in the order of Interaction with 0130 and 0132:
  0131 before 0132. Duration and cost are not estimated.

### Configuration and validation record

Implementing pull request: #1114 (draft, branch `claude/clever-ramanujan-yrfjsq-impl-0131`, base
`main` at `8d6bf255`), by an AI agent (Claude Code). Each commit carries `Change: 0131`. The first
commit is `d8d545d7`; the commit that adds this record follows it on the same branch. The status
stays `accepted` until the owner's merge (`CLAUDE.md`, Merging): the pull request removes an
author-facing name and is not approved in advance.

Delivered configuration (as declared): `numerics(...)`, the `numerics` option of a stage call,
`TS8078` (retired, recorded as a gap), `FuncDecl.numerics`, `NumericsClass`, the `'contract'`
member of `DeterminismKind` and the `contract` rows are removed; `src/compiler/ts/numerics.ts`,
`src/core/passes/finite-math.ts`, `contract-constants.ts` and `contract-boundary.ts` are deleted
with their tests and hooks; `workgroup_size` takes no options; Rule 6.7, Rule 9.6 (ten
families), Rule 11.22 (the text of proposed item 3), surface §3, §38 and §78 (title kept) carry
the new text; `CHANGELOG.md` has one withdrawal entry; change 0107 is `archived`.

Validation evidence, run on 2026-11-09 on the first commit's tree (Bun 1.4.4, Node 22, TypeScript
of the lockfile, Chromium headless shell 156.0.8078.4 / SwiftShader for the compile gate):

| Check                                                                                     | Result                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run bake:goldens`                                                                    | passed, 355 tests; no golden changed                                                                                                                                                                          |
| `src/compiler/ts/numerics-removed.test.ts` (both halves, Rule 12.7)                       | passed: `numerics(...)` is `TS8004` in `compile()` and the editor, with the same cascade; the option on `vertex`, `fragment`, `compute` and a third `workgroup_size` argument are one `TS8028` each           |
| `src/core/passes/opt/algebraic.test.ts` (`Verifies: Rule 11.22`)                          | passed: `x * 0`, `x - x`, `mix(a, b, 0)` and `mix(a, b, 1)` kept                                                                                                                                              |
| `src/core/passes/determinism.test.ts`                                                     | passed: no `contract` row                                                                                                                                                                                     |
| `bun run bake:api-surface`                                                                | only `FuncDecl`, `DeterminismKind` and `NumericsClass` changed                                                                                                                                                |
| `bun run bake:author-names`                                                               | only `numerics` left (283 to 282)                                                                                                                                                                             |
| `bun run reqs:sync`, `python scripts/doorstop-check.py -C -e -F`                          | clean after `doorstop review` (RULE-0607, RULE-1122, RULE-1207, SURF-038, SURF-078) and `doorstop clear` (SURF-026, 049, 053, 077, 078), each read first                                                      |
| `bun run docs:impact`, `bun run docs:refs`                                                | no must-fix item; 0 dead references                                                                                                                                                                           |
| `bun scripts/changes.ts --base origin/main`, `bun scripts/ifchange.ts --base origin/main` | passed                                                                                                                                                                                                        |
| `bun run build`, `bun run lint`, `bun run format:check`, `bun scripts/bundle-boundary.ts` | passed; the runtime, emit and fuse budgets record the measured sizes (runtime 160,575 to 159,263 gzip bytes single file; after merging `main` at `b4e4ccaf`, 160,602 to 159,268)                              |
| `bun run gate:compile`                                                                    | passed: 203 examples on Tint, 140 GLSL ES 3.00 on WebGL2, 131 render pipelines, 0 failures                                                                                                                    |
| `bunx vitest run` (full suite)                                                            | 13,431 passed, 9 failed: the 9 tests of `src/affected-tests.test.ts` and `src/doc-test-selection.test.ts` fail identically on `origin/main` at `8d6bf255` in this container (environment), not on this change |
| `bun run gate:differential`                                                               | not run: it needs a WebGPU adapter; CI runs it                                                                                                                                                                |

Deviations (open, recorded on #1114 for the reviewer):

1. `scripts/numbering.ts` records TS8078 as a gap and steps `nextFree` past a recorded gap, so the
   next free code reads TS8079. The proposal does not name the script.
2. `scripts/doc-impact.ts` takes `docs/owner-decisions.md` for a record, as a proposal is, and
   honours a `doc-refs: skip` marker (for a heading, on the first line under it). Without this,
   the owner's file and §78's kept title (decision 2) stayed must-fix items.
3. `changes/0132-remove-diagnostic.md` gets one `doc-refs: skip` marker on its measurement line
   that names the deleted `numerics.test.ts`.
4. `src/language-service/diagnostics.ts` pairs TS2353 and TS2554 with `TS8028` (`SAME_MISTAKE`),
   the merge "What an author sees" requires, in a file the applicability row does not name.

Pending: the compiler issue for the value-domain analysis (proposed item 8); closing #965
unmerged (decision 4); `status: implemented` at the merge; the downstream work below.

## What it owes downstream

- **typeshade.github.io** (`web`, `apps/typeshade`, at `ed33afb`). Remove or rewrite these files
  of `apps/typeshade` in that repository:
  - `src/lib/error-codes.ts`: the `TS8078` entry, line 1643. <!-- doc-refs: skip — a file of typeshade/web -->
  - `src/i18n/operation-lessons-en.ts` (line 386) and `operation-lessons-ko.ts` (line 366): the `numerics` lesson. <!-- doc-refs: skip — a file of typeshade/web -->
  - `src/lib/operation-models.ts`: the `numerics` model, line 745, and the `'numerics'` entry of `related` at line 743. <!-- doc-refs: skip — a file of typeshade/web -->
  - `content/api/ko/funcdecl.json`: the `members.numerics` text, line 17. <!-- doc-refs: skip — a file of typeshade/web -->
  - `content/api/ko/numericsclass.json`: the page of the removed export `NumericsClass`. <!-- doc-refs: skip — a file of typeshade/web -->
  - `content/api/ko/determinismkind.json`: the `contract` sentence of the description, line 6. <!-- doc-refs: skip — a file of typeshade/web -->
  - `src/lib/language-reference.ts`: the comment that lists `numerics([...], f)`, line 42. <!-- doc-refs: skip — a file of typeshade/web -->

  The pages generated from Rule 6.7, Rule 9.6, Rule 11.22 and surface §3, §38 and §78 follow the
  pin. Record 0131 in that repository's `compiler-changes.md` when the pin moves. The 0107 entry
  there is history and stays.

- **vscode-typeshade** (at `db3f417`). No reference found in the plugin skill. Confirm, and
  record 0131 in `compiler-changes.md` when the pin moves. The editor's diagnostics come from
  the language service and change with the pin.
- Radiance, TypeNN, TypeCV and TypeAudio owe nothing: none of them writes the construct.
