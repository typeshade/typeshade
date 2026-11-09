---
id: '0132'
title: An author writes no diagnostic filter; the compiler rewrites an implicit-LOD sample or a derivative in non-uniform control flow
status: draft
rules:
  - '6.7'
  - '8.5'
surface:
  - 3
  - 7
  - 50
  - 54
exports:
  - CompileTsSourceResult
exports-removed: []
codes: []
examples: []
names: []
downstream:
  - repo: typeshade.github.io
    what: Rewrite the sample-branch example's title and blurb (English from the compiler, Korean in ko.ts), the CompileTsSourceResult.directives member text and the pages generated from Rule 8.5 and surface §54; record 0132 in compiler-changes.md
  - repo: vscode-typeshade
    what: Remove the @diagnostic("off", "derivative_uniformity") advice from the plugin skill's references/language.md and say that the compiler rewrites what it can; record 0132 in compiler-changes.md
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0132, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Date and attribution          | Drafted 2026-11-09 (UTC) by an AI agent (Claude Code) at the owner's direction. The date is the drafting date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Request source                | The owner (Seungup) set the direction in the Claude Code session on 2026-11-09: the language gains as little as possible; what the compiler can decide is compiler work and is never pushed onto the author; what the author does not need to learn is removed. The owner directed this removal in the same session. Draft proposal 0130 (pull request #1094) proposes the principle as a design rule. Draft proposal 0131 (pull request #1104) removes the other stage-call option, `numerics`.                                                                                                                                                                           |
| Applicability / effectivity   | Expected: `src/compiler/ts/diagnostic-directive.ts` (deleted), `src/compiler/ts/source-file.ts`, `compile.ts`, `host-face.ts`, `builtin-check.ts`, `decorated-form.ts`, `stage-call.ts`, `src/cli/migrate.ts`, `src/core/passes/uniformity.ts` (the `TS8052` text), a new rewrite pass in `src/core/passes/`, `src/language-service/ambient.ts`, `docs.ts` and `service.ts`, `src/core/coverage/wgsl.ts`, `docs/language-design.md`, `docs/use-typeshade-surface.md`, two examples and their goldens, `reqs/`. The WGSL and GLSL ES 3.00 of a program that writes no `diagnostic` change only where a sample or a derivative is rewritten. No release version is assigned. |
| Review baseline               | `main` at `16a3c36f` (merge of pull request #1097), 2026-11-09. Every count below was measured on that commit unless the row says otherwise.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Review and revision authority | No pull request is assigned at the time of writing; the pull request that carries this file records its number. Git records the revisions of this file. Its merge with `status: accepted` will record the decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## What changes

### Today

WGSL refuses an implicit-LOD sample (`textureSample`, `textureSampleBias`,
`textureSampleCompare`) and a screen-space derivative (`dpdx`, `dpdy`, `fwidth` and their
variants) in non-uniform control flow (the `derivative_uniformity` rule, default severity
`error`). The front end refuses such a call at the source line with `TS8052` (Rule 8.5, surface
§54). The author has one more way out: a diagnostic filter.

- `fragment(f, { diagnostic: ["off", "derivative_uniformity"] })`, the stage call's option
  (change 0111, D7); the severities are `off`, `info`, `warning` and `error`.
- `@diagnostic("off", "derivative_uniformity")` on a top-level function, the decorated form,
  accepted in the migration release with a `TS8028` warning (change 0111, D5).

Either form silences the derivative half of the analysis. The WGSL backend then emits the
module-scope directive `diagnostic(off, derivative_uniformity);`
(`src/compiler/ts/diagnostic-directive.ts`, 248 lines).

### Proposed

1. Remove the stage call's `diagnostic` option, the decorated `@diagnostic(…)` and the ambient
   declaration `declare function diagnostic(…)` from the language. Delete
   `src/compiler/ts/diagnostic-directive.ts`.
2. Stop the `"use typeshade"` front end from emitting a `diagnostic(…)` directive. Remove the
   `directives` member of `CompileTsSourceResult`.
3. Add compiler work: a rewrite of an implicit-LOD sample or a derivative that the uniformity
   walk finds in definitely non-uniform control flow. The rewrite has two forms:
   - **Gradient form.** Where the sample's coordinate is a side-effect-free expression of values
     defined before the branch, compute `dpdx` and `dpdy` of the coordinate before the branch,
     in uniform control flow. Inside the branch, sample with `textureSampleGrad` and those
     gradients. A derivative under the branch becomes the value computed before it.
   - **Hoist form.** Where the whole call is side-effect-free and its arguments are values
     defined before the branch, compute the call before the branch and use its value inside.
     The rewrite runs on the shared IR, before both backends. A helper reached under the branch is
     specialized or inlined at that call site first, so that its coordinate can be expressed in
     the caller's values.
4. Keep `TS8052` (Rule 8.5) for every call the rewrite cannot reach. Remove the third way out
   ("or give the stage call of the entry the option …") from its text. Add the reason the
   compiler could not rewrite the call. Proposed reasons, each to confirm at implementation:
   - the coordinate (or the derivative's operand) reads a value written inside the branch;
   - the call is `textureSampleCompare` or `textureSampleBias` on a shape that has no gradient
     form the compiler can prove equal (see Assumptions);
   - the call is inside a loop whose iterations differ by invocation.
5. Keep the barrier half of Rule 8.5 unchanged. A barrier is not filterable today and no rewrite
   applies to it.
6. Keep `ModuleDecl.diagnostics`, `DiagnosticDirective` and their WGSL emission in
   `src/core/backends/wgsl.ts` for the IR builder (`typeshade/core/ir`). The `"use typeshade"`
   language does not reach them. Whether the IR builder keeps them is a separate decision
   (decision 4 below).
7. Change `tshc migrate` (`src/cli/migrate.ts`): delete a `@diagnostic(…)` decorator and a
   stage call's `diagnostic` option, in place of rewriting the decorator to the option.

After the change, a stage call that still passes `{ diagnostic: [...] }` is refused with
`TS8028`, as any unknown option is today. A written `@diagnostic(…)` is a decorator outside Rule
6.7's list, so it is `TS8028` too. Each refusal's text says that the compiler now rewrites the
call or names the reason it cannot (Rule 12.5).

### Example

`examples/sample-branch.shade.ts` changes how an author writes an example, so the comparison is
shown here (`CLAUDE.md`, Merging).

Before (`main` at `16a3c36f`, the entry):

```ts
export const fs = fragment(function fs(v: VsOut): vec4 {
  let base: vec4 = vec4(0., 0., 0., 1.);
  if (v.uv.x > 0.5) {
    base = sharp(v.uv);   // textureSample(albedo, smp, uv)
  } else {
    base = wide(v.uv);    // textureSample(albedo, smp, uv * 0.5)
  }
  // …
}, { diagnostic: ["off", "derivative_uniformity"] });
```

```wgsl
diagnostic(off, derivative_uniformity);
```

After (the source loses the option; nothing else changes):

```ts
export const fs = fragment(function fs(v: VsOut): vec4 {
  let base: vec4 = vec4(0., 0., 0., 1.);
  if (v.uv.x > 0.5) {
    base = sharp(v.uv);
  } else {
    base = wide(v.uv);
  }
  // …
});
```

The expected emit (an estimate; the implementation fixes the exact text): no directive, the
gradients computed before the `if`, and `textureSampleGrad` inside it.

```wgsl
let g0x = dpdx(v.uv);
let g0y = dpdy(v.uv);
if (v.uv.x > 0.5) {
  base = textureSampleGrad(albedo, smp, v.uv, g0x, g0y);
} else {
  base = textureSampleGrad(albedo, smp, v.uv * 0.5, g0x * 0.5, g0y * 0.5);
}
```

### What the two examples become

- **`sample-branch`.** The id stays, so the set of examples does not change. The source loses
  the option. Its title and blurb change from "the directive that allows it" to "the compiler
  rewrites it". It becomes the gate's evidence for the gradient form: the emit carries no
  directive, and Tint and ANGLE compile it. Without the option on `main` at `16a3c36f`, the file
  gives two `TS8052` (lines 62 and 67, the samples in `sharp` and `wide`), measured with
  `compile()`. Both coordinates are expressions of `v.uv`, which is defined before the branch, so
  the gradient form reaches both (estimate).
- **`capsule-corp-namek-class`.** The source loses the option (line 4268). Without it on `main`
  at `16a3c36f`, the file gives six `TS8052`, measured with `compile()`: `dpdx` and `dpdy` at
  lines 3291-3292, 3325-3326 and 3332-3333, in `Terrain.shade`. `Terrain.shade` is called under
  `} else if (terrainT > 0.0) {` (line 4016). Its arguments (`ro + rd * terrainT`, `ro`,
  `terrainT`, …) are defined before that branch. The operands are `dirt`
  (`dirtField(groundWarp(p.xz))`, then a sum with two `Noise.value` terms) and `x = p.xz`. All
  are side-effect-free expressions of those arguments, so the gradient form can reach all six in
  principle (estimate). The cost is that the dirt field is then computed for every pixel, ship
  and sky pixels included (not measured). If the first implementation does not reach them, the
  example's source computes the six derivatives in `render` before the branch, by hand, and
  passes them in. That fallback changes how the example is written and is shown to the owner
  before merge.

### Exclusions

- GLSL ES 3.00 has no refusal: an implicit derivative in non-uniform control flow is undefined
  there (surface §54). The rewrite still runs on the shared IR, so the GLSL text changes too,
  with `textureGrad` in place of `texture`. The GLSL result then becomes defined.
- No new author-facing name, option or code.

## Why

### Problem and evidence

- The owner's direction of 2026-11-09 removes what the author does not need to learn. The
  option asks the author to know a WGSL rule name, four severities, where the filter is written
  and why it is emitted at module scope (surface §54, "Written on the entry, emitted at module
  scope").
- The filter does not fix the program. It tells Tint to accept a sample whose implicit level of
  detail is undefined on the quads that diverge. The compiler can compute a defined gradient in
  uniform flow instead.
- Two examples write the option on `main` at `16a3c36f`: `sample-branch` and
  `capsule-corp-namek-class` (0 of the other 100 `examples/*.shade.ts`). No downstream default
  branch writes it (see "What it touches").

### Alternatives

| Option                                                                         | For                                                                | Against                                                                                                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| A. Remove the option; rewrite where possible; `TS8052` remains (this proposal) | No author construct. The emitted program is defined on every quad. | New compiler work with unproven reach. The result can differ from an implicit-LOD sample (Assumptions).                                 |
| B. Remove the option; no rewrite                                               | Smallest change.                                                   | Namek and `sample-branch` stop compiling until rewritten by hand. The author does work the compiler can do.                             |
| C. Emit the filter automatically wherever the walk finds a non-uniform sample  | No author construct; the output matches today's.                   | The compiler silences a rule and emits undefined behaviour on purpose. A barrier is not filterable, so it covers only half of Rule 8.5. |
| D. Keep the option (no change)                                                 | No work.                                                           | Conflicts with the owner's direction of 2026-11-09.                                                                                     |

Recommendation (a proposal, not a decision): A.

### Assumptions (to measure)

- **Reach.** The rewrite is unproven when the coordinate is computed inside the branch from a
  value written there, or when the sample is in a loop whose trip count differs by invocation.
  Those calls keep `TS8052`. How many real programs fall there is unknown.
- **Equality.** `textureSampleGrad` with gradients from `dpdx` and `dpdy` may not give the same
  bits as an implicit-LOD `textureSample` on all hardware. A device may compute the implicit
  level of detail with coarse or fine differences and its own approximation. Equality on the
  quads that do not diverge is an assumption to measure on each gate device. On the quads that
  diverge, the old result was undefined, so no equality is owed there.
- **`textureSampleBias`.** WGSL has no gradient form with a bias. Scaling the gradients by
  `exp2(bias)` gives the same level of detail in theory. It is an assumption to measure, or the
  call keeps `TS8052`.
- **`textureSampleCompare`.** WGSL has no `textureSampleCompareGrad`. The hoist form can reach it
  when its arguments are defined before the branch. Otherwise it keeps `TS8052`.
- **Cost.** The gradient form adds two derivatives per coordinate in uniform flow, and it
  evaluates the coordinate for every invocation. For Namek, that is the dirt field on every
  pixel (not measured).
- **The CPU oracle.** It returns zero for a derivative (`src/core/cpu-runtime.ts` line 877). A
  sample with zero gradients and an implicit-LOD sample then read the same level on the oracle.
  This is an inference to confirm with the oracle's texture tests.
- **The determinism report.** It already lists derivatives as `unbounded` and filtered texture
  reads as driver-dependent (`src/core/passes/determinism.ts`). The rewrite adds no new kind of
  difference, so no new row is proposed. This is an inference for the reviewer.

### Conflicts

- Rule 1.3 and `docs/dx.md` (lines 22-26): the GPU computes what the oracle computes. The rewrite
  can change the GPU result relative to today's filtered module on diverging quads, where today's
  result is undefined. No rule promises the undefined value. The question goes to the owner with
  decision 2 below.

### Why the compiler cannot do it

Not required. This proposal removes a construct and adds none. The section applies to a proposal
that adds to the language (draft pull request #1098). The reverse question is the point of the
proposal: the compiler can rewrite the calls it can prove, and it reports the rest with `TS8052`.

## What it touches

- `rules` 6.7: `diagnostic` leaves the attribute names the compiler reads, with its option
  sentence (D7) and `@diagnostic(…)` in the list of decorated forms.
- `rules` 8.5: the rationale and "Enforced by" lose the filter, and gain the rewrite and the
  reasons `TS8052` names when the rewrite cannot reach a call.
- `surface` 3: the stage-call option list loses `diagnostic`.
- `surface` 7: the `TS8028` rows that name `@diagnostic` lose it.
- `surface` 50: the paragraph "The `diagnostic(...)` directive is not written by hand" is
  rewritten: the front end emits none.
- `surface` 54: "Switching it off" and the filter's text are replaced by the rewrite, its two
  forms, its reach and the new `TS8052` text. The measurement table stays.
- `exports` `CompileTsSourceResult`: loses `directives: readonly DiagnosticDirective[]`.
- `exports-removed`: none. `DiagnosticDirective` and `ModuleDecl.diagnostics` stay for the IR
  builder (proposed item 6).
- `codes`: none added or removed. `TS8052` keeps its number; its text changes (Rule 12.5,
  surface §54). `TS8028` keeps its number; its text for a `diagnostic` option and decorator
  changes.
- `examples`: no id is added or removed. `sample-branch` and `capsule-corp-namek-class` change
  source and goldens (see "What the two examples become").
- `names`: none added. `diagnostic` leaves `src/__api__/author-names.md` (line 101 at
  `16a3c36f`); a removed name is not a criterion (`changes/README.md`).

The compiler's own `@diagnostic(off, subgroup_uniformity)` in `src/core/passes/kernel-lower.ts`
(line 1551) and `src/core/subgroup-probe.ts` (line 53) is not author-facing and does not change.

Measured on `main` at `16a3c36f`:

| Item                                                                                                                                                          | Count                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Examples that write `{ diagnostic: [...] }`                                                                                                                   | 2 of 102: `sample-branch`, `capsule-corp-namek-class`                                                                                              |
| Goldens with `diagnostic(off, derivative_uniformity);`                                                                                                        | 2: `examples/__emit-goldens__/sample-branch.wgsl`, `capsule-corp-namek-class.wgsl`                                                                 |
| `TS8052` without the option, with `compile()`                                                                                                                 | `sample-branch` 2, `capsule-corp-namek-class` 6                                                                                                    |
| Files outside `changes/` and `CHANGELOG.md` that match `derivative_uniformity`, `diagnostic-directive`, `DiagnosticDirective`, `@diagnostic` or `.directives` | 37 (tests among them: `uniformity.test.ts` 30 lines, `stage3.test.ts` 11, `stage-call.test.ts` 5, `migrate.test.ts` 4, `decorated-form.test.ts` 3) |

Downstream, measured on each repository's default branch, 2026-11-09, for
`derivative_uniformity`, `diagnostic: [`, `@diagnostic`:

| Repository                                                                           | Commit    | Matches                                                                                                                                                 |
| ------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| typecv                                                                               | `4189b3c` | 0                                                                                                                                                       |
| typenn                                                                               | `3a7d66c` | 0                                                                                                                                                       |
| typeaudio                                                                            | `27287bb` | 0                                                                                                                                                       |
| radiance                                                                             | `3e4efb3` | 0                                                                                                                                                       |
| typeplot (not a `DOWNSTREAM_REPOS`)                                                  | `9f20c12` | 1, in its committed compiler bundle `dist/compiler.js`, not an author use                                                                               |
| vscode-typeshade                                                                     | `db3f417` | 1: the plugin skill's language reference, lines 435-437, advises `@diagnostic("off", "derivative_uniformity")`                                          |
| web (`apps/typeshade` is typeshade.dev, `typeshade.github.io` in `DOWNSTREAM_REPOS`) | `ed33afb` | API member texts for `CompileTsSourceResult.directives`, `ModuleDecl.diagnostics`, `DiagnosticDirective`; the `sample-branch` title and blurb in Korean |

Required validation evidence (at implementation):

- `sample-branch` and `capsule-corp-namek-class` compile with no option and no `TS8052`, on
  Tint and on ANGLE (the compile gate), with no `diagnostic(` line in their WGSL.
- Tests, both halves (Rule 12.7): each rewrite form; each `TS8052` reason; a `{ diagnostic }`
  option and a `@diagnostic` decorator refused with `TS8028` in `compile()` and in the editor.
- A Tint measurement of the rewrite's output with its valid neighbours (Rule 13.3).
- A device measurement of the equality assumption on the gate devices (render gate or a
  dedicated comparison), recorded with device, commit and result.
- `bun run bake:goldens`: only the goldens of programs with a rewritten call change.
- `bun run bake:api-surface`: only `CompileTsSourceResult` changes.
- `bun run bake:author-names`: only `diagnostic` leaves.
- `bun run reqs:sync` and `python scripts/doorstop-check.py -C` after the rule edits.
- `bun run docs:impact`, `bun run docs:refs`, and the mechanical gates of Rule 13.4.

### Draft impact estimate

Known:

- Two examples write the option. Without it, they give 2 and 6 `TS8052` today.
- No downstream program writes the option. The editor's skill text and the site's texts owe
  updates.
- The uniformity walk (`src/core/passes/uniformity.ts`) already finds each call and the
  statement that made the flow non-uniform; the rewrite can start from its result.

Estimated:

- The rewrite pass is new compiler work of unknown size. No duration or cost is estimated.
- Reach: both examples' calls are expressions of values defined before their branch, so the
  gradient form can reach all eight. This is an estimate until the pass exists.
- Runtime cost for Namek: unknown, not measured.
- Bundle size: `diagnostic-directive.ts` leaves; the rewrite pass enters. Net change unknown.

Implementation order (a proposal): the rewrite first, then the removal of the option, so that
neither example stops compiling between the two pull requests.

Interaction: draft proposal 0131 removes the other stage-call option, `numerics`. If both are
accepted, a stage call takes no options, and the `options` parameter leaves the ambient stage
calls. If only this one is accepted, `numerics` stays the one option.

Decisions for the owner before acceptance:

1. Option A (rewrite, then `TS8052` for the rest), or option B (no rewrite). Recommendation: A.
2. Accept that the rewritten GPU result can differ from today's filtered result on diverging
   quads, where today's result is undefined.
3. The Namek fallback: if the rewrite cannot reach its six calls at first, hoist them in the
   example's source by hand (shown to the owner before merge), or keep the option until the
   rewrite reaches them.
4. Keep `ModuleDecl.diagnostics` and `DiagnosticDirective` for the IR builder (recommended in
   this proposal), or remove them in a separate proposal.
5. A written option or decorator after the change: `TS8028` at once (recommended, since no
   downstream program writes it), or one migration release with a warning.

### Independent review record

Not yet reviewed. Before the owner decides, an agent or a person that did not write this
proposal reviews it against `changes/README.md` (Independent review).

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decision on this pull
request, the approved revision, answers to the five decisions above, and the review record.

### Configuration and validation record

This record does not yet apply. Delivery will require the implementing pull requests (each
commit `Change: 0132`), the delivered configuration and the validation evidence listed under
"Required validation evidence".

## What it owes downstream

- **typeshade.github.io** (`web`, `apps/typeshade`, at `ed33afb`). Change these files of
  `apps/typeshade` in that repository:
  - `src/i18n/ko.ts` lines 2459 and 2620: the `sample-branch` title and blurb. <!-- doc-refs: skip — a file of typeshade/web -->
  - `content/api/ko/compiletssourceresult.json` line 9: the `members.directives` text, removed. <!-- doc-refs: skip — a file of typeshade/web -->

  The pages generated from Rule 6.7, Rule 8.5 and surface §3, §7, §50 and §54, and the English
  example title and blurb, follow the pin. Record 0132 in that repository's
  `compiler-changes.md` when the pin moves.

- **vscode-typeshade** (at `db3f417`). Remove the `@diagnostic` advice, lines 435-437, and say that
  the compiler rewrites what it can, in this file of that repository:
  `plugins/typeshade/skills/typeshade/references/language.md`. <!-- doc-refs: skip — a file of typeshade/vscode-typeshade -->
  Record 0132 in `compiler-changes.md` when the pin moves.
- Radiance, TypeNN, TypeCV and TypeAudio owe nothing: none of them writes the option.
