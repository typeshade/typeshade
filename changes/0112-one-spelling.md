---
id: '0112'
title: A meaning that an ECMAScript form carries in every case has that one spelling, and `Math` takes scalars as ECMAScript's does
status: implemented
rules:
  - '9.4'
  - '9.6'
  - '9.9'
surface:
  - 7
  - 10
  - 14
  - 17
  - 18
  - 20
  - 23
  - 27
  - 28
  - 49
  - 54
  - 63
  - 66
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: Every page and snippet that writes arrayLength(…), a free PI, E, LN2, LN10, LOG2E or LOG10E, a free log10, log1p, expm1, cbrt or hypot, any(xs, p), all(xs, p), none(xs, p), sum(xs), or Math.* on a vector is rewritten to the kept spelling; the rule pages render the amended Rules 9.4 and 9.6 and the new Rule 9.9 from reqs/ at the pin. Not searched yet.
  - repo: vscode-typeshade
    what: The skill's builtin list, completions and snippets drop the removed names and name the kept spelling. Not searched yet.
  - repo: typenn
    what: In `src/kernels/binary.shade.ts`, the five `pow` calls on lines 263, 276, 290, 405 and 407 changed to `a ** b` (typenn#26, merged as `3a7d66c` on 2026-11-02, before #899 merged), because `pow` is removed (decision D1). The TypeNN record in `compiler-changes.md` is added when the TypeNN pin moves past the implementation.
---

<!-- doc-refs: skip-file — a draft proposal names rules and text its implementation adds -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0112, `status: implemented`. The front matter is the identity and lifecycle authority. The owner approved the proposal on 2026-11-02; see Approval and plan record. Part 1 (sections 3 and 5, the removals and the refusal; Rules 9.4 and 9.9) is implemented by pull request #899, merged into `main` as `6229368` on 2026-11-02. Part 2 (section 4, `Math` takes scalars) is implemented by pull request #933, merged into `main` as `ef10f96` on 2026-11-02; see Configuration and validation record.                                                                                      |
| Date and attribution          | Authored 2026-11-02, UTC, by a Claude Code agent. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-02, in Korean. The owner asked why `arrayLength` exists when `.length` is more TypeScript-like, and said there are many such names ("이런게 좀 많다고 느껴져요"). The agent surveyed the ambient library and proposed a test by Rule 1.4 of proposal 0100. The owner also asked whether every author should have to write `Math.` for math; the agent recommended that `Math` keep ECMAScript's scalar meaning and that vector math stay on the WGSL names. The owner answered "승인" to drafting this proposal. No GitHub issue is recorded. |
| Applicability / effectivity   | `docs/language-design.md` (Rules 9.4 and 9.6, the §9.3 table, a new Rule 9.9, Appendix B), `reqs/`, `docs/use-typeshade-surface.md` (the sections in the front matter), `src/language-service/ambient.ts`, `src/compiler/ts/math-alias.ts` and the fold lowering, `src/core/spec-conformance/surface-names.test.ts`, the tests and four examples that call a removed name. No export, diagnostic code or example id changes. No release version is assigned.                                                                                                                                           |
| Review baseline               | `main` at `9afe73abdf7e39597fd1aad951e39b28a7dae425` (2026-11-02).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Review and revision authority | Pull request [#878](https://github.com/typeshade/typeshade/pull/878) (branch `claude/proposal-0112-one-spelling`). Git records the revisions of this file; the merge of that pull request with `status: accepted` records the decision.                                                                                                                                                                                                                                                                                                                                                                |

## What changes

### 1. The test

Proposal 0100 (accepted) gives the principle as Rule 1.4: a WGSL spelling is borrowed only where
no ECMAScript spelling carries the meaning. This proposal applies the principle to the names the
surface has today. For each WGSL name and each §9.3 name, the question is:

> Does an ECMAScript spelling carry every case that this name accepts, with the same meaning?

- Yes: the name is removed. The ECMAScript spelling is the one spelling.
- No: the name stays. A case that only the name carries (a vector, a bool-vector mask, a WGSL
  feature) is the reason, and the reason is recorded.

The proposal adds this test as **Rule 9.9** (proposed text):

> **Rule 9.9.** A WGSL built-in function, an overload of one, or a §9.3 name must not be
> authorable when an ECMAScript spelling the compiler supports carries every case it accepts with
> the same meaning (Rule 1.4 of proposal 0100). A call or a read of a removed name must be refused
> in one sentence that names the ECMAScript spelling.

### 2. Measured on both halves

Each row was run through `compile()` and through the language service's `getDiagnostics` on the
same source, on `main` at `9afe73a`, with Bun 1.4.4. "OK" means no error diagnostic. The two halves
agree on every row except `Math.sqrt(v)`.

| Source                                                   | `compile()`                             | Editor     | Verdict                                                |
| -------------------------------------------------------- | --------------------------------------- | ---------- | ------------------------------------------------------ |
| `src.length` on `storage<array<f32>>`                    | OK                                      | OK         | covers every case of `arrayLength` (surface §20)       |
| `log10(v)`, `log1p(v)`, `expm1(v)`, `cbrt(v)` on `vec3f` | TS8003 `expects f32, got vec3`          | same       | the free form takes scalars only: `Math.*` covers it   |
| `hypot(a, b)` on `vec3f`                                 | TS8003 `arguments must be f32`          | same       | scalars only: `Math.hypot` covers it                   |
| `xs.reduce((a, b) => a + b)` vs `sum(xs)`                | OK, OK                                  | OK, OK     | same unrolled additions in the same order (below)      |
| `xs.some(p)` vs `any(xs, p)`                             | OK, OK                                  | OK, OK     | same result; `some` returns at the first pass          |
| `!xs.some(p)` vs `none(xs, p)`                           | OK, OK                                  | OK, OK     | same result                                            |
| `a ** b` vs `pow(a, b)`, scalar and `vec3f`              | OK, OK                                  | OK, OK     | `**` covers every case of `pow`; decision D1           |
| `c ? b : a` vs `select(a, b, c)`, scalar `c`             | OK, OK                                  | OK, OK     | the ternary covers the scalar case                     |
| `(a < b) ? b : a` on `vec3f`                             | TS8003 `Ternary condition must be bool` | same       | only `select` takes a bool-vector mask: `select` stays |
| `atan2(y, x)` on `vec2f`                                 | OK                                      | OK         | `Math.atan2` takes scalars only: `atan2` stays         |
| `Math.sqrt(v)` on `vec3f`                                | OK                                      | **TS2345** | a Rule 12.7 split; section 4                           |
| `Math.max(v, 0.)` on `vec3f`                             | OK                                      | OK         | the ambient declares vector overloads; section 4       |

The emitted WGSL of the two reductions, for `xs: array<f32, 4>`:

```wgsl
// sum(xs)
return (((xs[0] + xs[1]) + xs[2]) + xs[3]);
// xs.reduce((a, b) => a + b), through a helper the call names
let acc = xs[0];
let acc_1 = f_f(acc, xs[1]);
let acc_2 = f_f(acc_1, xs[2]);
let acc_3 = f_f(acc_2, xs[3]);
```

Both are unrolled, and both add in the same order, so the `f32` results are the same bits. With an
initial value `0.`, `reduce` adds `0. + xs[0]` first, which differs from `sum` only in the sign of
a zero sum (`0. + -0.` is `+0.`).

### 3. What is removed and what stays

**Removed** (the ECMAScript spelling carries every case):

| Name                                         | Write instead                | Source of the name today   |
| -------------------------------------------- | ---------------------------- | -------------------------- |
| `arrayLength(xs)`                            | `xs.length`                  | WGSL                       |
| `PI`, `E`, `LN2`, `LN10`, `LOG2E`, `LOG10E`  | `Math.PI`, `Math.E`, …       | §9.3, family 9             |
| `log10`, `log1p`, `expm1`, `cbrt`, `hypot`   | `Math.log10`, …              | §9.3, family 5             |
| `any(xs, p)`, `all(xs, p)` (the array folds) | `xs.some(p)`, `xs.every(p)`  | an overload on a WGSL name |
| `none(xs, p)`                                | `!xs.some(p)`                | §9.3, family 5             |
| `sum(xs)`                                    | `xs.reduce((a, b) => a + b)` | §9.3, family 5             |

The array-fold overloads of `any` and `all` also fail Rule 9.2: a builtin's signature must be
WGSL's, and WGSL's `any` and `all` take a bool or a bool vector only.

An author who wants the short name writes it as ordinary TypeScript, for example
`const PI = Math.PI;`. A file's own declaration of a removed name stays the file's (Rule 9.5):
`examples/capsule-corp-namek-class.shade.ts` declares `const PI` and
`examples/loop-reduction.shade.ts` declares `function sum`, and neither changes.

**Stays** (a case only this name carries):

- `TAU`: neither ECMAScript nor WGSL has it.
- `select`: the bool-vector mask.
- `atan2`, `sqrt`, `max`, `min`, `abs`, `floor` and the other WGSL math names: the vector forms.
  `Math.*` keeps the scalar forms (section 4), so both spellings exist for a scalar. This is the
  one recorded duplicate, and its reason is that the WGSL name is one name for scalars and
  vectors.
- `any(v)` and `all(v)` on a bool or a bool vector: WGSL's own forms.
- `mod`, `fill`, `zip`, `discard`, `random`: no ECMAScript spelling carries their meaning.

**Decision D1, `pow`.** By the measurement, `**` carries every case of `pow`, so the test removes
`pow`. `pow` is also a WGSL builtin with 15 example files and 31 source files that call it.
Decided on 2026-11-02 by the owner: `pow` is removed.

### 4. `Math` takes scalars, as ECMAScript's does

`Math` is ECMAScript's object, and TC39 decides its future members. A `Math` member that takes a
vector is a meaning ECMAScript does not give, and a later ECMAScript member of the same name could
give another. So:

- The ambient `MathObject` declares scalar signatures only. The vector overloads of `Math.max` and
  `Math.min` are removed.
- The compiler refuses a vector argument to a `Math` member with `TS8003`, in a sentence that names
  the WGSL name: `Math.sqrt takes a number; for a vec3 write sqrt(v)`.
- This closes the split above: the compiler accepts `Math.sqrt(v)` today and the editor refuses it
  (Rule 12.7).

Rule 9.4 gains one sentence (proposed): "A `Math` member takes the scalar arguments ECMAScript
gives it; the vector form of the same operation is the WGSL name."

### 5. The refusal

A removed name stops compiling. Before `1.0.0`, Rule 13.10 asks for a window only for a change that
keeps a program compiling and computes something else; a program that stops compiling says so with
its fix (Rule 12.1). Unit P1 of `docs/typeshade-plan.md` states the same for this stage.

The refusal reuses the existing codes, as the retired `perInvocation<T>` did under `TS8014`:

- a call: `TS8004`, `arrayLength was removed: write xs.length.`;
- a read of a constant: `TS8022`, `PI was removed: write Math.PI.`;
- a fold overload: `TS8004` for `none` and `sum`, and for `any(xs, p)` and `all(xs, p)` the
  `TS8019` arity sentence with the `some` or `every` fix.

No code is added, removed or renumbered, so `codes` is empty. The text of `TS8032`, which names
`arrayLength`, changes to name `.length` only.

## Why

The ambient library declares 191 names. A survey on 2026-11-02 found names whose meaning an
ECMAScript form already carries in every case. Each is a second spelling an author has to learn,
and the roadmap's first rule names that cost: "keeping it as an alternative spelling left one
variable with two ways to write it, which is a thing to learn and not a thing to use"
(`docs/roadmap.md`, Ordinary TypeScript first). Proposal 0100 made that rule normative as Rule 1.4.

Eleven of the removed names are §9.3 rows that no surface section documents (Appendix B, the row
of Rule 9.7). Their removal pays that debt, except for `TAU`, which stays and still needs its
section.

### Alternatives

- **Keep every name, and let the editor suggest the ECMAScript spelling.** Two spellings stay, and
  the cost the roadmap names stays. Not taken.
- **Widen `Math` to vectors and remove the WGSL math names.** `Math` would then carry a meaning
  ECMAScript does not give, and a future TC39 member could collide with it. Every shader would
  write `Math.` for most of its lines. Not taken.
- **Destructure `Math` for short names (`const { sqrt } = Math`).** Ordinary TypeScript, refused
  today with `TS8014`. It is a separate change with its own proposal; this proposal does not
  depend on it.

### Assumptions and open points

- This proposal cites Rule 1.4 as proposal 0100 words it. If 0100's rule text lands in
  `docs/language-design.md` first, Rule 9.9 cites the rule; if not, it cites the proposal.
- D1, `pow`: decided on 2026-11-02. `pow` is removed (section 3).
- D2, decided on 2026-11-02 as recommended. The refusal of the `any`/`all` fold overloads is
  `TS8019` (arity), with the fix in the sentence. Reason: `any` and `all` stay
  declared, so a two-argument call is a wrong arity, and `TS8004` would call a known name
  unknown.

## What it touches

- Rule 9.4: one sentence, `Math` takes scalars.
- Rule 9.6: the §9.3 table loses `PI`, `E`, `LN2`, `LN10`, `LOG2E`, `LOG10E`, `log10`, `log1p`,
  `expm1`, `cbrt`, `hypot`, `none` and `sum`; families 5 and 9 are rewritten. The table is
  shrink-only, so this is the direction it allows.
- Rule 9.9: new, the test of section 1.
- Appendix B: the Rule 9.7 row loses the eleven names; `TAU` stays in it.
- Surface §7: the `TS8032` row names `.length` only.
- Surface §10: the builtin table drops the removed names and, by D1, `pow`.
- Surface §14 and §27: the folds `any(xs, pred)`, `all`, `none` become `some`, `every`, `!some`.
- Surface §20: `.length` is the spelling; the `arrayLength` paragraphs go.
- Surface §17, §23, §49, §54, §63, §66: each names `arrayLength` once or more in text or a
  snippet, which changes to `.length`.
- Surface §18: the `sum([1., 2.])` example becomes `xs.reduce((a, b) => a + b)`.
- Surface §28: the `PI` example uses `TAU` or `Math.PI`, as fits the example.
- Exports: none. Codes: none (section 5). Example ids: none added or removed.
- Examples edited: `atomic-histogram`, `gpu-console`, `workgroup-override`, `workgroup-scratch`
  (`arrayLength`), `higher-order` (`any(bands, …)`); goldens re-baked and reviewed.
- Tests: `surface-names.test.ts` (the extension table and its LINT block), `ambient-parity.test.ts`
  (the `Math` table), `array-length.test.ts`, and each test that calls a removed name, rewritten to
  the kept spelling; plus one test per removed name that asserts the refusal on both halves.

### Draft impact estimate

- Known: about 41 source files name `arrayLength`, 27 call `sum(`, and 24 call a `Math` member on
  something that may be a vector (a regular-expression count on `9afe73a`; not every hit is a
  call of the removed form).
- Estimate: one implementing pull request for sections 3 and 5, and one for section 4. Duration
  unknown.
- Compatibility: a program that calls a removed name stops compiling with a sentence that names
  the fix. No program changes what it computes.

### Approval and plan record

- 2026-11-02, the owner (Seungup), in a Claude Code session, in Korean ("승인"): D1 decided as
  recommended. `pow` is removed.
- 2026-11-02, the owner, in the same session ("머지 승인"): the proposal is accepted, with D2
  decided as recommended (`TS8019`). The merge of this file with `status: accepted` records the
  decision.
- 2026-11-02, the owner, in the Claude Code session ("추천대로 승인"): the scope is widened to
  declare surface §18 and §28, as recommended. Both sections name removed spellings and were not
  declared in the front matter, so `scripts/changes.ts` refused their edits.
- 2026-11-02, the owner (Seungup), in the Claude Code session ("A안 추천대로 승인"): TypeNN
  replaces `pow(a, b)` with `a ** b` before pull request #899 merges, and this proposal records
  TypeNN as a downstream repository (front matter, `downstream`). `**` already works on the
  current compiler.
- 2026-11-02, the owner, in a Claude Code session ("머지 승인"): typenn#26 (`a ** b` in
  `src/kernels/binary.shade.ts`, with a `playwright-core` 1.64.1 pin carried as a recorded
  deviation) is merged into typenn `main` as `3a7d66c`.
- 2026-11-02, the owner, in the same session ("승인", twice): #909 (the `TypeNN candidate` gate's
  typenn pin moves to `3a7d66c`) is merged into `main` as `cd89637`; then #899, part 1 of this
  proposal, is merged into `main` as `6229368` after `main` was merged into its branch twice.
- 2026-11-02, the owner, in the same session ("둘 다 승인하겟습니다"): this record is written, and
  the `ci` workflow of `main` at `6229368` is checked.

### Deviation record

- 2026-11-02. Deviation: the downstream search at drafting did not name TypeNN. The drafting
  agent could not search downstream repositories. The `TypeNN candidate (build + CPU)` check on
  pull request #899 failed on `src/kernels/binary.shade.ts`: `TS8004 pow was removed: write a ** b.`
  Disposition: closed on 2026-11-02. TypeNN is named in `downstream`; typenn#26 landed as
  typenn `3a7d66c`, and #909 moved the gate's pin to it (`main` at `cd89637`). The
  `TypeNN candidate (build + CPU)` check passed on #899 at `e4bd9d6` and on `main` at `6229368`
  (run 41443217694).
- 2026-11-02. Deviation: the draft estimated one implementing pull request for sections 3 and
  5 and one for section 4. Part 1 took one pull request (#899) after #894, its first attempt,
  was abandoned: #894 was based on `10847cc`, and a merge of `main` into it could not pass the
  commit hooks. Disposition: closed; #899 applied the same change on `main` at `cb17347`.
- 2026-11-02. Deviation: the `pow` removal (D1) moved fifteen examples to `**`, where "What it
  touches" names four examples for `arrayLength` and one for `any`. Disposition: closed by D1;
  the goldens are byte-identical except `higher-order`, whose `some` is a helper call.
- 2026-11-02. Deviation: `scripts/doc-impact.ts` changed so that a short lowercase name counts
  as a mention only in call or member form; the tool is not in "What it touches". Disposition:
  closed; the same change landed on `main` by #896, and the diff vanished at the merge.
- 2026-11-02. Deviation: `src/language-service/diagnostics.ts` drops TypeScript's TS7006 on the
  callback of a removed call, and `LANG_CONST` is `TAU` alone with the removed names' docs moved
  into `MATH_MEMBER_DOCS`. Neither is named in "What it touches". Disposition: closed; both are
  the editor half of section 5 (one sentence on both halves).
- 2026-11-02. Deviation: Rule 9.4 was amended and Rule 9.9 added in commit `366326d`, which
  needed `doorstop review` of `RULE-0904` and `RULE-0909` by a person; the owner read the items
  in the Claude Code session ("추천대로 승인") before the review ran. Disposition: closed; the
  rules are on `main` at `6229368`.
- 2026-11-02. Deviation: while #899 was open, `main` gained three files that use a removed
  spelling, none named in "What it touches": `examples/subgroup-reduce.shade.ts` (#919,
  `arrayLength(src)`), `scripts/class-arm.ts` (#883, the generated twin's bounds guard) and
  `journeys/class-twins/units.shade.ts` (#883, three `arrayLength` calls). Each changed to
  `.length` in merge commit `c4fa59b`. Without the last, the class arm of `gate:differential`
  held 0 classes under its floor of 6. Disposition: closed; recorded here, no emit changed.

### Configuration and validation record

This record covers both parts. Part 1 is sections 3 and 5 (the removals and the refusal), Rule 9.4
as amended and Rule 9.9. Part 2 is section 4 (`Math` takes scalars), recorded after part 1. Part 2
is the last implementing pull request, so it sets `status: implemented`.

**Part 1** (pull request #899):

Accepted revision: the file as merged in [#878](https://github.com/typeshade/typeshade/pull/878)
(`main` at `10847cc`), amended by [#895](https://github.com/typeshade/typeshade/pull/895)
(`c4e99ae`, surface §18 and §28) and [#906](https://github.com/typeshade/typeshade/pull/906)
(`7f4e916`, TypeNN as a downstream repository). Implementation: pull request
[#899](https://github.com/typeshade/typeshade/pull/899), branch `claude/0112-removals-v2`, by
Claude Code agents, superseding #894. The work started from `main` at
`cb1734749e3ee8c60becf8d993428e45995d6cfd`. Merged into `main` as
`6229368a0f26290aa3bd45740c02ca247e93d0b9` on 2026-11-02 with the owner's go-ahead.

Commits with `Change: 0112`:

- `e08760af`: the removals, the refusal sentences on both halves (`TS8004`, `TS8022`, `TS8019`),
  the tests, the surface sections and the §9.3 table.
- `eb36913f`: surface §18 and §28 examples.
- `366326d4`: Rule 9.4 amended and Rule 9.9 added; `doorstop review` on `RULE-0904` and
  `RULE-0909`, `doorstop clear` on `SURF-012`.
- `afb77e52`: the compile gate's inline sources written without the removed spellings.
- `c4fa59b9`: merge of `main` at `cdb12dc`. Ten examples and
  `src/compiler/ts/lower/expression-call.ts` conflicted; each resolution takes `main`'s entry
  form (change 0111) and keeps this change's spelling. Three files `main` added changed to
  `.length` (Deviation record).
- `e4bd9d67`: merge of `main` at `4ace586`. Two code blocks of `docs/use-typeshade-surface.md`
  conflicted and were resolved the same way.

The two merge commits were made with `--no-verify`: the `commit-msg` check reads a merge against
its first parent (issue #901), so the commits of `main` showed as changes of this proposal. Each
message says so. `bun run precommit` passed on the staged files of each, and CI's
`scripts/changes.ts --base origin/main` read the pull request range, where the diff is this
change's alone (`change scope` and `source and policy checks` green on `e4bd9d6`).

Delivered configuration on `main` at `6229368`: `docs/language-design.md` (Rules 9.4 and 9.9,
the §9.3 table, Appendix B), `reqs/` synced, `docs/use-typeshade-surface.md` (the sections in
the front matter), `src/language-service/ambient.ts` and `docs.ts`, `src/compiler/ts/math-alias.ts`,
`src/compiler/ts/lower/expression-call.ts` and `expression.ts`, `src/language-service/diagnostics.ts`,
`src/core/spec-conformance/surface-names.test.ts`, one refusal test per removed name, fifteen
examples spelled with `**` and four with `.length`, and the re-baked goldens.

Functional validation, by the author session on `afb77e5` (base `cb17347`): `npx vitest run
src/compiler src/language-service` (206 files, 5498 pass, 1 todo); `bun run build`;
`bun run format:check`; `bun run docs:refs` (0 dead); `bun run bake:goldens` (353 pass, no
unstaged golden diff); `gate:compile` (194 examples on Tint, 134 on WebGL2, 0 failures). By the
merging session on `e4bd9d6`, 2026-11-02: `bun run build`; `bun run format:check`;
`bun run docs:refs` (0 dead in 1426 files); `vitest run src/compiler src/language-service
src/core/intrinsic-coverage.test.ts src/doc-references.test.ts` (212 files, 5631 pass, 1 todo);
`bun run bake:goldens` on `c4fa59b` (354 pass, no golden changed); `bun run gate:compile`
(195 examples on Tint, 134 on WebGL2, 0 failures); `bun run gate:differential` (class arm
6 classes, 13 members, every arm 0 failures). CI on `e4bd9d6`: all 26 checks green, among them
`typecheck + unit`, `traceability (Doorstop)`, `compile gate (Tint + WebGL2)`,
`user journeys (packed tarball, WebGPU)` and `TypeNN candidate (build + CPU)` against typenn
`3a7d66c`. On `main` at `6229368`: `downstream` (run 41443217694) and `package compatibility`
(run 41443217792) green; the `ci` run (41443218087) was cancelled by the next push to `main`
(`1cb928f`, #926, which holds this change), whose `ci` run stands in for it.

Document validation: `bun run reqs:sync` and `python scripts/doorstop-check.py -C` clean on
`e4bd9d6`; `RULE-0904` and `RULE-0909` reviewed and `SURF-012` cleared in `366326d`; the
`Docs-Impact:` trailer of each commit names the locations read. The downstream search of the
draft missed TypeNN (Deviation record).

**Part 2** (section 4, `Math` takes scalars; pull request #933).

Implementation: pull request [#933](https://github.com/typeshade/typeshade/pull/933), by Claude Code
agents, with the owner's go-ahead. Head `e02c0de`. Merged into `main` as
`ef10f96fd16b7e91d6dcae74345fd5adac6657c4` on 2026-11-02 (squash), with the commit `Change: 0112`.

Delivered configuration on `main` at `ef10f96`:

- `docs/language-design.md`: the Rule 9.4 sentence, "A `Math` member takes the scalar arguments
  ECMAScript gives it; the vector form of the same operation is the WGSL name."
- `docs/use-typeshade-surface.md`: §7 (the `TS8003` row for a vector argument to a `Math` member, and
  the scalar paragraph) and §10.
- `reqs/rules/RULE-0904.md`, `reqs/surface/SURF-010.md` and `reqs/surface/SURF-012.md` (two lines).
  `RULE-0904` and `SURF-010` were reviewed after the owner read them on 2026-11-02.
- `src/compiler/ts/lower/expression-call.ts` and `expression-misc.ts`: one `TS8003` sentence per
  vector argument, which names the WGSL builtin that takes the vector.
- `src/language-service/ambient.ts` and `docs.ts`: the `MathObject` vector overloads of `max` and `min`
  are removed. `Math.sqrt(v)` is refused in both halves.
- `src/compiler/ts/math-scalar.test.ts` (new, 17 tests), `math-args.test.ts` and `math-binding.test.ts`.

Functional validation, by the part-2 session on head `e02c0de`, run locally and reported here; this
pull request does not re-run them: `bun run build`; `bun run format:check`; `bun run docs:refs`;
`bun scripts/changes.ts`; `bun run bake:goldens` (no golden diff); `bun run gate:compile` (195 examples
on Tint, 0 failures); the 17 math-scalar tests and the spec-conformance tests (the count was not
recorded).

CI on head `e02c0de`: 26 checks green, among them `typecheck + unit`, `traceability (Doorstop)`,
`compile gate (Tint + WebGL2)`, `user journeys (packed tarball, WebGPU)` and `TypeNN candidate (build + CPU)`.

Deviations of part 2:

- 2026-11-02. Deviation: a `min` or `max` bound to a name by a `const` (change 0113) took the vector
  overloads before #933. It now takes the scalar signature, as every `Math` member does. Section 4
  names the removal of the vector overloads of `Math.max` and `Math.min`; the bound name is one
  of those members. Disposition: closed; surface §7 records it ("`min` and `max` included").
- 2026-11-02. Deviation: `Math.random(seed)` keeps its existing exclusion from the scalar rule (#181).
  Disposition: closed, out of scope of section 4.
- 2026-11-02. Deviation: the `ambient-parity` `Math` table named in the earlier pending note is not in
  #933's file list. The two-half check of the scalar rows is in `src/compiler/ts/math-scalar.test.ts`,
  which reads `compile()` and `getDiagnostics` on the same source (Rule 12.7). Disposition: closed.

Open items: none in the compiler repository. Downstream work is below.

## What it owes downstream

- typeshade.github.io: every page that writes a removed name, and the rule pages for Rules 9.4,
  9.6 and 9.9. The repository was not searched; it is outside this session's access.
- vscode-typeshade: the skill's builtin list, completions and snippets. Not searched, for the same
  reason.
- typenn: `src/kernels/binary.shade.ts`, five `pow` calls (lines 263, 276, 290, 405 and 407)
  changed to `a ** b` in typenn#26, merged as typenn `3a7d66c` on 2026-11-02, before #899 merged
  (decision D1). Found by the `TypeNN candidate` check on #899, not by the drafting search; see
  the deviation record. The gate's pin moved to `3a7d66c` in #909 (`main` at `cd89637`).
  Still owed: the 0112 record in typenn's `compiler-changes.md` when its pin moves past `ef10f96`.

Each records 0112 in its `compiler-changes.md` when its pin moves past the implementation.
