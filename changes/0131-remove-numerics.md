---
id: '0131'
title: An author writes no numerical contract; the compiler applies a floating-point rewrite only where it proves the rewrite exact
status: draft
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
    what: Remove the TS8078 error-code page, the numerics lesson and operation model, the FuncDecl.numerics member text and the numerics mention in language-reference.ts; record 0131 in compiler-changes.md
  - repo: vscode-typeshade
    what: Confirm that the plugin skill names no numerics(...), numerics option or TS8078 (none found at db3f417) and record 0131 in compiler-changes.md when the pin moves
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0131, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Date and attribution          | Drafted 2026-11-09 (UTC) by an AI agent (Claude Code) at the owner's direction. The date is the drafting date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Request source                | The owner (Seungup) set the direction in the Claude Code session on 2026-11-09: TypeShade is a language, not a library; the language gains as little as possible; what the compiler can decide is compiler work and is never pushed onto the author; what the author does not need to learn is removed. The owner directed this removal in the same session. Draft proposal 0130 (pull request #1094) proposes the principle as a design rule and leaves this removal to its own proposal.                                                                                                                                                                |
| Applicability / effectivity   | Expected: `src/compiler/ts/numerics.ts` and its test, `src/compiler/ts/stage-call.ts`, `src/compiler/ts/lower/function.ts`, `src/compiler/ts/lower/expression-call.ts`, `src/compiler/ts/source-file.ts`, `src/compiler/ts/diagnostic-directive.ts`, `src/compiler/ts/codes.ts`, `src/core/ir/nodes.ts`, `src/core/emit.ts`, `src/core/passes/` (five files deleted, six edited), `src/language-service/ambient.ts` and `docs.ts`, `docs/language-design.md`, `docs/use-typeshade-surface.md`, `reqs/`. The default `'O2'` output of a program that writes no `numerics` does not change. The CPU oracle does not change. No release version is assigned. |
| Review baseline               | `main` at `16a3c36f` (merge of pull request #1097), 2026-11-09. Every count below was measured with `git grep` on that commit unless the row says otherwise.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Review and revision authority | Pull request #1104 (draft). Git records the revisions of this file. Its merge with `status: accepted` will record the decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

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
   language. The ambient library stops declaring both.
2. Retire `TS8078`. Do not reuse the number (the convention in the header of
   `src/compiler/ts/codes.ts`).
3. Rewrite Rule 11.22 as the rule that replaces the opt-in. Proposed text:

   > **Rule 11.22.** No source construct opts a function into a floating-point rewrite. The
   > optimizer applies a rewrite that a NaN, an infinity or the sign of a zero can observe
   > (`x * 0` to `0`, `x - x` to `0`, `mix(a, b, 0)` to `a`) only where it proves that the
   > operands are in the domain where the rewrite gives the CPU oracle's bits. It applies no
   > rewrite that changes the rounding of `f32` arithmetic (reassociation, distribution,
   > factoring).

4. Delete `src/core/passes/finite-math.ts`, `contract-constants.ts` and `contract-boundary.ts`
   with their tests. Remove the `outsideContracts` wrapper from the five inlining passes
   (`restructureCalls`, `inlineLinearAll`, `forceInline`, `autoInline`, `inlineFn`) and the two
   steps from `src/core/emit.ts`. Git keeps the code at `16a3c36f`, from which a proof-gated pass
   can start (item 7).
5. Remove `FuncDecl.numerics`, the type `NumericsClass`, the `'contract'` member of
   `DeterminismKind` and the `contract` rows of the determinism report (surface §38).
6. Keep the numbers Rule 11.22 and surface §78 with the new content, so that change 0107 and
   this change cite a rule and a section that exist (`src/changes.test.ts`, "once implemented,
   cites rules, surface sections and examples that exist"). Surface §78 becomes "A
   floating-point rewrite only where the compiler proves it exact": the new Rule 11.22, the
   five rewrites the compiler may apply once it can prove their domain, and a note that
   `numerics` and `TS8078` were removed by change 0131.
7. Replace the opt-in with compiler work that needs no proposal, because it is exact and adds
   nothing an author writes (`changes/README.md`, "When a change needs one"): a value-domain
   analysis over `f32` that proves an operand finite, not NaN and, where the rewrite needs it,
   of known sign. A rewrite of item 3 applies only where that proof holds. This proposal does
   not deliver the analysis. Open a compiler issue for it, linked from #850 and #851.

After the change, a source that still writes `numerics(...)` is a call of an undeclared
function: `TS8004` in `compile()` (measured on `16a3c36f` with an undeclared wrapper of the same
shape: `TS8004 Unknown function "relaxed". …`) and TypeScript's `TS2304` in the editor. A stage
call that still passes `{ numerics: [...] }` is refused with `TS8028`, as any unknown option is
today. The measurement above also shows a cascade `TS8099` on the class list; the
implementation must refuse the call once.

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
compiler folds it to `base` with no change to the source.

### Exclusions

- The default `'O2'` rewrites in `src/core/passes/opt/algebraic.ts` do not change. The `x + 0`
  exception (decision 4 of change 0107) stays where it is.
- The `fast` reduction mode that `docs/compiler-owns-performance.md` proposes is not decided
  here. It is a proposal in that document and is not implemented.
- Nothing changes in the CPU oracle or in the emulated double (Rule 4.4).

## Why

### Problem and evidence

- The owner's direction of 2026-11-09 removes what the author does not need to learn. An author
  of `numerics` must learn two class names, their domains, the inlining boundary and `TS8078`.
- A relaxation changes results, so the compiler cannot apply one silently. `docs/dx.md` (lines
  22-26): the CPU oracle is `-O0`, and the GPU "computes the same thing, faster".
  `docs/compiler-owns-performance.md` (line 243): "Only an opt-in such as `fast` may differ". So
  a removed opt-in leaves two choices: apply a rewrite only where the compiler proves it exact,
  or do not apply it. This proposal takes both: proof-gated where a proof exists, none where it
  does not.
- No program uses the opt-in on `main` at `16a3c36f` (measured, see "What it touches"). The one
  use is draft pull request #965 (not merged), which opts Namek's grass tick into
  `finite-math`.

### Alternatives

| Option                                                          | For                                                                                                                                      | Against                                                                                                                                                  |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Remove the opt-in; delete the three passes (this proposal)   | The smallest language and the smallest compiler. No code without a trigger stays in the tree.                                            | The `finite-math` rewrites must be rebuilt from Git when a proof exists. The measured gain of #965 is not delivered.                                     |
| B. Remove the opt-in; keep `finite-math.ts` behind a proof gate | The rewrite code stays ready. The proof can grow one case at a time.                                                                     | With no value-domain analysis on `main` (none found in `src/core/passes/`), the gate proves almost nothing at first, so the pass is code with no effect. |
| C. Keep `numerics` (no change)                                  | The measured Namek gain of #965 can land.                                                                                                | Conflicts with the owner's direction of 2026-11-09. The author decides what the compiler could prove.                                                    |
| D. Apply `finite-math` by default, everywhere                   | No author construct. WGSL already lets a driver assume finite math (§15.7.2, quoted in `docs/compiler-owns-performance.md` lines 68-75). | Breaks Rule 1.3: the GPU no longer computes what the oracle computes for a NaN or an infinity, and the compiler, not a driver, makes the difference.     |

Recommendation (a proposal, not a decision): A. Option B is the fallback if the owner prefers to
keep the rewrite code.

### Assumptions

- The rewrites that a proof can admit are few until an analysis exists. This is an estimate:
  no analysis exists to measure.
- WGSL's Finite Math Assumption (§15.7.2) lets a driver make some of these folds already. Then
  the GPU-time gain of a compiler fold is smaller than the WGSL size suggests. This is an
  inference, also recorded on #850 (N8).

### Conflicts

- `docs/compiler-owns-performance.md` (lines 13-14): a program "must become faster when the
  compiler improves". Rule 1.3 and `docs/dx.md` (lines 22-26): the GPU computes what the oracle
  computes. This proposal does not trade one for the other: it gives up the measured gain of
  #965 until a proof admits it, and keeps Rule 1.3. That choice is the owner's direction of
  2026-11-09, and it goes to the owner as a question with decision 1 below.

### Why the compiler cannot do it

Not required. This proposal removes a construct and adds none. The section applies to a proposal
that adds to the language (draft pull request #1098). The reverse question is answered above:
the compiler can do the safe part (a rewrite it proves exact), and nobody should do the unsafe
part silently.

## What it touches

- `rules` 6.7: `numerics` leaves the attribute names the compiler reads, with its spelling
  sentence and `TS8078`. The "Enforced by" entry loses `src/compiler/ts/numerics.ts`.
- `rules` 9.6: the §9.3 extension table loses the `contracts | numerics` row. "Eleven families"
  becomes ten, and family 11 is removed. The `LINT.IfChange` block names
  `src/core/spec-conformance/surface-names.test.ts:extensions`, which changes with it.
- `rules` 11.22: rewritten as proposed item 3. The number stays (proposed item 6).
- `surface` 3: the stage-call option list loses `numerics` and the link to §78.
- `surface` 38: the determinism report loses its `contract` rows.
- `surface` 78: rewritten as proposed item 6.
- `exports` `FuncDecl`: loses `numerics?: readonly NumericsClass[]`.
- `exports` `DeterminismKind`: loses `'contract'`.
- `exports-removed` `NumericsClass`: removed from `src/core/ir/nodes.ts` and `src/index.ts`.
- `codes` `TS8078`: retired, never reused.
- `examples`: none. No example writes `numerics` (0 of 102 `examples/*.shade.ts`). Two files say
  "numerics-textbook" in prose (`examples/fp64-cancellation-twin.shade.ts:13`,
  `examples/fp64-cancellation.ts:3`) and do not use the construct.
- `names`: none added. `numerics` leaves `src/__api__/author-names.md` (line 170 at
  `16a3c36f`); a removed name is not a criterion (`changes/README.md`).

Measured on `main` at `16a3c36f` (`git grep`):

| Item                                                            | Count                                                                                                                                                                                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Examples that write `numerics(` or `numerics:`                  | 0 of 102                                                                                                                                                                                                                                      |
| Common modules and `src/algorithms`, `src/random` that write it | 0                                                                                                                                                                                                                                             |
| Files to delete                                                 | 7: `numerics.ts` (146 lines), `numerics.test.ts` (125), `finite-math.ts` (91), `finite-math.test.ts` (198), `contract-boundary.ts` (64), `contract-constants.ts` (177), `contract-constants.test.ts`                                          |
| Other files under `src/` that name the construct or its passes  | 31 (lines matching `numerics`, `NumericsClass`, `finiteMath`, `finite-math`, `outsideContracts`, `underContract`, `specializeContractConstants` or `'contract'`); one of them, `src/core/fp64/df64-lib.ts:899`, says "numerics" only in prose |
| Documents and records                                           | `docs/language-design.md` (6 lines), `docs/use-typeshade-surface.md` (18), `src/AGENTS.md` (5), `reqs/rules/RULE-0607.md`, `RULE-1122.md`, `reqs/surface/SURF-078.md`                                                                         |

Downstream, measured on each repository's default branch, 2026-11-09:

| Repository                                                                           | Commit    | Uses of `numerics(`, `numerics:`, `TS8078`, `NumericsClass`                             |
| ------------------------------------------------------------------------------------ | --------- | --------------------------------------------------------------------------------------- |
| typecv                                                                               | `4189b3c` | 0                                                                                       |
| typenn                                                                               | `3a7d66c` | 0                                                                                       |
| typeaudio                                                                            | `27287bb` | 0                                                                                       |
| radiance                                                                             | `3e4efb3` | 0                                                                                       |
| vscode-typeshade                                                                     | `db3f417` | 0                                                                                       |
| typeplot (not a `DOWNSTREAM_REPOS`)                                                  | `9f20c12` | 0                                                                                       |
| web (`apps/typeshade` is typeshade.dev, `typeshade.github.io` in `DOWNSTREAM_REPOS`) | `ed33afb` | 17 lines in 7 files, all documentation of the construct (see "What it owes downstream") |

Required validation evidence (at implementation):

- `bun run bake:goldens` with no golden changed: no example opts in, so every emit stays.
- A test, both halves: `numerics(...)` gives one `TS8004` in `compile()` and `TS2304` in the
  editor; `{ numerics: [...] }` gives `TS8028` in both (Rule 12.7).
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
  and 5 to 4 `hash12` calls per blade. This removal does not deliver that gain. #965 would be
  closed unmerged.
- Deviation 2 of change 0107 (the differential comparison for a relaxed function) has no
  subject after the removal and closes.
- No value-domain analysis exists in `src/core/passes/` at `16a3c36f` (searched for range,
  interval and domain passes: none found).

Estimated:

- The removal is mostly deletion: seven files and the hooks in 30 others. No duration or cost is
  estimated; both are unknown.
- The replacement analysis (proposed item 7) is compiler work of unknown size. Candidate proof
  sources, each to measure: a finite literal; a conversion from `i32` or `u32` to `f32`, whose
  result is finite; `fract`, `sin` and `cos` of an operand already proved finite. Whether the
  analysis reaches Namek's tick (the operands of #965) is unknown.
- Bundle size: the three passes and the front-end reader leave `typeshade/runtime`, `emit` and
  `fuse`. The size was +595, +551 and +613 gzipped bytes at #936 and +761, +754 and +721 at #950
  (their records). The saving at `16a3c36f` is not measured.

Interaction: draft proposal 0132 (pull request #1105, remove `diagnostic`) removes the other stage-call option. If
both are accepted, a stage call takes no options, and the `options` parameter leaves the ambient
stage calls. If only this one is accepted, `diagnostic` stays the one option.

Decisions for the owner before acceptance:

1. Option A (delete the three passes) or option B (keep `finite-math.ts` behind a proof gate).
   Recommendation: A.
2. Keep the numbers Rule 11.22 and surface §78 with new content (recommended), or remove them
   and change `src/changes.test.ts` to accept a removed rule for an implemented proposal.
3. A source that still writes `numerics(...)`: the plain `TS8004` (recommended, since no
   program uses it), or a migration release with a named message and a `tshc migrate` step.
4. Close draft pull request #965 unmerged.
5. Set change 0107 to `archived`, with a line that names 0131, in the pull request that
   implements this change.

### Independent review record

Not yet reviewed. Before the owner decides, an agent or a person that did not write this
proposal reviews it against `changes/README.md` (Independent review).

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decision on this pull
request, the approved revision, answers to the five decisions above, and the review record.

### Configuration and validation record

This record does not yet apply. Delivery will require the implementing pull requests (each
commit `Change: 0131`), the delivered configuration and the validation evidence listed under
"Required validation evidence".

## What it owes downstream

- **typeshade.github.io** (`web`, `apps/typeshade`, at `ed33afb`). Remove or rewrite these files
  of `apps/typeshade` in that repository:
  - `src/lib/error-codes.ts`: the `TS8078` entry, line 1643. <!-- doc-refs: skip — a file of typeshade/web -->
  - `src/i18n/operation-lessons-en.ts` (line 386) and `operation-lessons-ko.ts` (line 366): the `numerics` lesson. <!-- doc-refs: skip — a file of typeshade/web -->
  - `src/lib/operation-models.ts`: the `numerics` model, line 745. <!-- doc-refs: skip — a file of typeshade/web -->
  - `content/api/ko/funcdecl.json`: the `members.numerics` text, line 17. <!-- doc-refs: skip — a file of typeshade/web -->
  - `src/lib/language-reference.ts`: the comment that lists `numerics([...], f)`, line 42. <!-- doc-refs: skip — a file of typeshade/web -->

  The pages generated from Rule 6.7, Rule 9.6, Rule 11.22 and surface §3, §38 and §78 follow the
  pin. Record 0131 in that repository's `compiler-changes.md` when the pin moves.

- **vscode-typeshade** (at `db3f417`). No reference found in the plugin skill. Confirm, and
  record 0131 in `compiler-changes.md` when the pin moves. The editor's diagnostics come from
  the language service and change with the pin.
- Radiance, TypeNN, TypeCV and TypeAudio owe nothing: none of them writes the construct.
