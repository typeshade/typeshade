---
id: '0140'
title: The stage calls `vertex(f)`, `fragment(f)`, `compute([…], f)` and `workgroup_size([…], f)` and an `export default` entry are refused with `TS8028` with no warning release (amends change 0130 D4)
status: draft
rules:
  - '1.8'
  - '6.7'
  - '8.1'
surface: []
exports: []
exports-removed: []
codes: []
examples: []
names: []
downstream:
  - repo: typeshade.github.io
    what: The pages, example cards, Playground starter and generated host text that change 0130 lists move to the stage attribute in the same pull request that moves the pin past this change's refusing pull request, since no compiler release accepts a stage call with a warning; `compiler-changes.md` records 0140 when the pin moves.
  - repo: typeaudio
    what: The stage calls under `experiments/` that change 0130 lists (15 at 0130's review, 6 in template strings that the author edits by hand) move to the stage attribute in the same pull request that moves the pin past this change's refusing pull request; `compiler-changes.md` records 0140 when the pin moves.
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0140, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Date and attribution          | Drafted 2026-11-09 (UTC) by an AI agent (Claude Code) at the direction of the session's coordinator, and revised the same day to answer the independent review of `ed8e32ee` and to record the owner's decision on the split into several pull requests. The date is the drafting date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                              |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-09, in Korean: "바로 거부" (refuse at once), asked whether the stage calls of change 0111 get change 0130's one warning release before the refusal, and "여러 PR, 마지막에 거부" (several pull requests, the refusal last), asked how the work is split. See Owner's decisions.                                                                                                                                                                                                                                                                                                                                                               |
| Applicability / effectivity   | Expected: the proposed texts of change 0130 for Rules 1.8 (new, its Enforced by), 6.7 and 8.1, its "proposed rules, in short" items 4 to 6, its summary bullets for Rules 6.7 and 8.1, "The editor" item 2, the codes bullet of "What it touches", the OD-2 bullet of "Costs of the owner's decisions", D4, "Migration order", the milestones of its "Approval and plan record" and its "Configuration and validation record"; `docs/language-design.md` and `reqs/` (`RULE-0108.md`, `RULE-0607.md`, `RULE-0801.md`) when 0130 is implemented; `src/compiler/ts/stage-call.ts` and its test; `src/cli/migrate.ts`; `src/language-service/ambient.ts`; `CHANGELOG.md`. No release version is assigned. |
| Review baseline               | `main` at `965d6d6e` (merge of pull request #1122), read on 2026-11-09. Revision 2 merges `main` at `d6a31f63`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Review and revision authority | Pull request #1141 (draft). Git records the revisions of this file. The review and the merge of the proposal's pull request record the decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## What changes

Change 0130 (accepted, not implemented) decides in D4 that the calls `vertex(f)`, `fragment(f)`,
`compute([…], f)` and `workgroup_size([…], f)` compile for one release with a `TS8028` warning,
and are refused after it. An entry written `export default` gets the same treatment (0130's
proposed rule 5 and Rule 8.1). This proposal replaces that decision.

**After this change:** a stage call and an `export default` entry are refused with no warning
release. Each is a `TS8028` error, in the compiler and in the editor. The text names the
attribute form and `tshc migrate`. The work is split into four pull requests, and the refusal
comes last (The pull requests, below). No release happens between them.

Before (compiles today, and under 0130 D4 would warn for one release):

```ts
export const vs = vertex(function vs(vi: builtin<"vertex_index", u32>): VsOut { … });
```

After (the stage call is refused with `TS8028`; the author writes, or `tshc migrate` writes):

```ts
@vertex export function vs(vi: builtin<"vertex_index", u32>): VsOut { … }
```

The `TS8028` text for a stage call names the attribute and the migration, for example:
`a stage is an attribute on the function declaration: write "@vertex export function vs(…)", or
run "tshc migrate" (change 0130)`. For `compute([8, 8], f)` it names `@compute([8, 8])`, and for
`workgroup_size([128], f)` it names `@workgroup_size([128])`. For `export default` it is 0130's
text: "an entry takes its declaration's name; write `export function k`".

### The pull requests

The owner decided the split (Owner's decisions, "여러 PR, 마지막에 거부"). Each pull request
carries `Change: 0130` and `Change: 0140`.

1. **The attributes and the reversed migration.** The front end and the editor read `@vertex`,
   `@fragment`, `@compute([…])` and `@workgroup_size([n])` as 0130 decides. `tshc migrate`
   rewrites a stage call to its attribute (calls to attributes), with a test. The call forms stay
   accepted, with no warning.
2. **The examples.** `tshc migrate` rewrites the examples (F2).
3. **The tests, the journeys and the documents.** Template strings that `tshc migrate` cannot
   reach are edited by a script or by hand (F2).
4. **The refusal.** The call forms and an `export default` entry get `TS8028`, an error, in both
   halves.

No release happens between pull requests 1 and 4 (OD-6). Each pull request that changes how an
author writes an example shows one example before and after, and waits for the owner's "merge"
(`CLAUDE.md`, Merging).

**`tshc migrate`.** Today's `tshc migrate` is change 0111's codemod. It rewrites attributes to
calls, the opposite direction (`src/cli/migrate.ts`, lines 3-7). The reversed rewrite (0130
Migration order step 3) exists in pull request 1, no later than the refusing pull request. It
keeps the call-to-attribute rewrite after the refusal, with a test, so an author with a refused
call has the tool the `TS8028` text names.

### Amending change 0130

Change 0130 is accepted and not implemented. `changes/README.md` says an accepted proposal is
amended in its own pull request (The front matter). This proposal is that pull request. It is a
separate record, as change 0137 is for the parameter qualifier. It does not edit the text of
change 0130.

It replaces these parts of change 0130. The rest of change 0130 stands, change 0137's
replacements included.

1. **D4. Migration.** Replaced whole by: "The call forms and an `export default` entry are refused
   with `TS8028`, with no warning release, in the last of four pull requests (change 0140, The
   pull requests)."
2. **Rule 1.8, Enforced by** (0130's proposed text of the new rule): "`TS8028 ATTRIBUTE_NAME` on <!-- doc-refs: skip — Rule 1.8 and RULE-0108 are added by change 0130 -->
   a stage call after the migration release" becomes "`TS8028 ATTRIBUTE_NAME` on a stage call".
3. **Rule 6.7** (0130's proposed text): the clause from "The calls `vertex(f)`" to "(change 0130,
   D4)" becomes "The calls `vertex(f)`, `fragment(f)`, `compute([…], f)` and
   `workgroup_size([…], f)` must be refused with `TS8028`, whose text names the attribute and
   `tshc migrate` (change 0130, D4, as amended by change 0140)". The rest of that sentence, as
   change 0137 amends it, stays. Change 0137 and this proposal touch different clauses, and the
   implementation applies both. In its Enforced by, "for the stage calls during the warning
   release" becomes "for the refusal of the stage calls", and `src/compiler/ts/stage-call.test.ts`
   is read as pinning "the refusal of the stage calls".
4. **Rule 8.1** (0130's proposed text):
   - "`export default` on an entry is accepted for one release with a `TS8028` warning ("an entry
     takes its declaration's name; write `export function k`") and is refused after it (change
     0130, D4)" becomes "`export default` on an entry must be refused with `TS8028` ("an entry
     takes its declaration's name; write `export function k`") (change 0130, D4, as amended by
     change 0140)".
   - "the stage calls of change 0111 are accepted for one release with a warning (Rule 6.7)"
     becomes "the stage calls of change 0111 are refused (Rule 6.7)".
   - In its Enforced by, "`export default` warned, then refused" becomes "`export default`
     refused".
5. **"The proposed rules, in short"**:
   - Item 4 becomes: "The calls `vertex(f)`, `fragment(f)`, `compute([…], f)` and
     `workgroup_size([…], f)` are refused with `TS8028`, whose text names the attribute
     (change 0140). `tshc migrate` rewrites them."
   - In item 5, "gets a `TS8028` warning for one release, … and is refused after it, as the call
     forms are" becomes "is refused with `TS8028`, "an entry takes its declaration's name; write
     `export function k`", as the call forms are".
   - In item 6, "For the warning release the ambient library keeps both overload sets
     (`ambient.ts` lines 1655-1671); the call overloads leave with the refusal" becomes "From the
     refusing pull request on, a stage call gets one diagnostic, `TS8028`, in the compiler and in
     the editor (Rule 12.4): TypeScript adds no second diagnostic to it. Completion and signature
     help offer no call signature for `vertex`, `fragment`, `compute` or `workgroup_size`. The
     implementation chooses the means."
6. **"Final rule texts for the owner (summary)"**: the Rule 6.7 bullet's "the stage calls warn
   for one release, then are refused" becomes "the stage calls are refused". The Rule 8.1
   bullet's "except the stage calls, which warn for one release; `export default` warns for one
   release, then is refused" becomes "the stage calls and `export default` are refused".
7. **"The editor" item 2** gains: "The language service reports a stage call's and an
   `export default` entry's `TS8028` with `category: 'error'`, where `compile()` does. No warning
   state exists for them." The rest of item 2 stays.
8. **"What it touches", the codes bullet**: its first clause, "`TS8028` warns on, then refuses,
   the call forms", becomes "`TS8028` refuses the call forms and an `export default` entry". The
   rest of the bullet stays.
9. **"Costs of the owner's decisions", the OD-2 bullet**: the sentence "Two overload sets stay in
   the ambient library for one release." is removed. Item 6 as amended governs.
10. **"Migration order"**: step 5, "One release warns on the call forms; the next refuses them",
    is removed. Steps 3 and 4 become the four pull requests of "The pull requests" above.
11. **"Approval and plan record", milestones**: "then 0130's front end, editor and warning
    release, then its codemod, then the refusing release" becomes "then the four pull requests of
    change 0140, The pull requests, with no release between them".
12. **"Configuration and validation record"**: "the call forms' warning and refusal" becomes "the
    call forms' refusal".

0140 is implemented together with 0130. Each implementing pull request carries `Change: 0130` and
`Change: 0140`. `scripts/changes.ts` reads every `Change:` line (`changeLines`) and checks the
diff against the union of the named proposals (`judge`).

**The pointer sentence in change 0130.** The pull request that accepts this proposal adds one
sentence after the cross-reference to change 0137 in change 0130's "What changes": "Change 0140
replaces D4 and refuses the call forms and an `export default` entry with no warning release, in
the last of four pull requests; the implementation applies change 0140's text in place of D4, the
Enforced by of Rule 1.8, the call-form clause of Rule 6.7, the `export default` and stage-call <!-- doc-refs: skip — Rule 1.8 and RULE-0108 are added by change 0130 -->
sentences of Rule 8.1, items 4 to 6 of the proposed rules in short, the summary bullets for Rules
6.7 and 8.1, item 2 of The editor, the first clause of the codes bullet, the overload sentence of
the OD-2 cost, Migration order steps 3 to 5, the milestones and the validation record." It
changes no other text of change 0130.

### Exclusions

- The decorators `@builtin`, `@location`, `@interpolate`, `@invariant` and `@blend_src` on a
  parameter or a field (change 0111 D5, kept by 0130's Rules 6.6 and 6.7) are not part of this
  proposal. 0130 keeps them accepted with a warning "until the release that refuses it". That
  timing is outside 0140 and may need its own question to the owner.
- The parameter qualifiers `@inout` and `@out` belong to change 0137.
- The attribute forms, the editor's projection and filter, `@workgroup_size([n])` and D1 to D3
  and D5 of change 0130 do not change.

## Why

The owner decided to refuse the stage calls with no warning release, and to split the work with
the refusal last (Owner's decisions). These facts support the decisions:

- **F1.** No official release exists. `npm view typeshade versions` returns only `0.0.0`, and the
  repository has no tag and no GitHub release (observed 2026-11-09). OD-6 says the bundled builds
  were tests, and that a refusal owes no warning release because of them.
- **F2.** The migration is large. Measured by the independent review on `ed8e32ee`:
  - 93 top-level `examples/*.shade.ts` files, 7 shader files under `examples/hosts/` and
    `examples/passes/`, and `examples/hosts/index.ts`;
  - 77 files under `journeys/`;
  - about 1,213 lines in 204 `src/**/*.test.ts` files, most of them in template strings that
    `tshc migrate` cannot reach, so a script or a hand edits them;
  - `src/rhi/rhi-conformance.ts` (16 lines) and `src/core/testing/compute-programs.ts` (15);
  - `docs/use-typeshade-surface.md` (77 lines), `docs/language-design.md` (11), `AUTHORING.md`
    (34) and `README.md`;
  - the goldens whose entry span moves to the first decorator.

  Change 0111 moved the same forms the other way in separate pull requests: #904 (the codemod),
  #907 (the examples) and #921 (the tests). The split of "The pull requests" is the owner's
  answer to this cost.

Precedents: change 0132 decision 5 refuses a written `@diagnostic(…)` or `{ diagnostic }` with
no warning release, on the same facts. Change 0137 refuses the type form `inout<T>` the same way.

A refusal of a program that compiles today is a breaking change under Rule 13.9. Rule 13.10 does
not apply: a refused program does not compute something else. Rule 13.9 needs a `CHANGELOG.md`
entry that names the migration edit, and the refusing pull request carries it.

### Alternatives

- **One warning release, then refusal (change 0130 D4 as accepted).** Rejected by the owner. No
  official release exists to carry the warning (OD-6), and the call form is a second spelling of
  a stage for that release (OD-3).

### Costs of the owner's decisions

- A downstream repository that moves its pin past the refusing pull request must migrate its
  stage calls in the same pull request. typeaudio has 15, 6 of them in template strings that
  `tshc migrate` cannot reach (0130's downstream entry). typeshade.github.io edits its pages by
  hand. These are recorded as costs of the decision, not reasons to change it.
- Between pull requests 1 and 4, `main` accepts both the stage call and the attribute, with no
  warning on the call. No release carries that state (OD-6).

## Owner's decisions

- **OD-2.** An entry's stage is written `@vertex`, `@fragment` or `@compute`. A stage is not a
  call of a fixed function name. This proposal removes the call form with no warning release, so
  it follows OD-2.
- **OD-3.** The language stays small. The call form is a second spelling of a stage, and it
  leaves with no warning release.
- **OD-6.** Nothing is released yet. A refusal owes no warning release because of the bundled
  builds.
- **The owner's decision for this proposal: refuse with no warning release.** Date: 2026-11-09.
  The owner's words, in the session: "바로 거부" (refuse at once). Asked whether the stage calls
  get change 0130's one warning release before the refusal, the owner chose to refuse them with
  `TS8028`, naming `@vertex export function vs(…)` and `tshc migrate`, with no warning release.
- **The owner's decision for this proposal: several pull requests, the refusal last.** Date:
  2026-11-09. The owner's words, in the session: "여러 PR, 마지막에 거부" (several pull requests,
  the refusal last). Asked how the work is split, after the independent review measured its size
  (F2), the owner chose the four pull requests of "The pull requests", with no release between
  them. This decision refines the earlier draft's "one implementing pull request". The refusal
  still comes with no warning release.

This proposal reverses no entry.

## Why the compiler cannot do it

Not applicable: this proposal adds no name, no diagnostic code and no surface form. It changes
when an existing refusal (`TS8028`, declared by change 0130) takes effect. The reversed
`tshc migrate` (pull request 1) does the migration work for the author.

## What it touches

- **Rule 1.8, Rule 6.7, Rule 8.1**: the sentences of change 0130's proposed texts named under <!-- doc-refs: skip — Rule 1.8 and RULE-0108 are added by change 0130 -->
  "Amending change 0130". When change 0130 is implemented, `docs/language-design.md` and
  `reqs/rules/RULE-0108.md`, `RULE-0607.md` and `RULE-0801.md` carry the amended sentences. <!-- doc-refs: skip — Rule 1.8 and RULE-0108 are added by change 0130 -->
- **`TS8028`**: no code is added or removed. Its category on a stage call and on an
  `export default` entry is an error from the refusing pull request on. Change 0130 declares the
  code.
- **Examples, surface sections and downstream pages**: as change 0130 declares them. This
  proposal adds none. `scripts/changes.ts` checks each implementing diff against both records.
- **`src/cli/migrate.ts`**: the call-to-attribute rewrite, with a test, from pull request 1 on,
  kept after the refusal.
- **Tests**: `src/compiler/ts/stage-call.test.ts` pins the refusal of each call form, and
  `src/compiler/ts/stage3.test.ts` pins the refusal of `export default`. Both halves are read on
  each refusal (`src/language-service/ambient-parity.test.ts` shape).
- **`CHANGELOG.md`**: one `### Removed` entry under `[Unreleased]`, in the refusing pull request,
  names the call forms and `export default` on an entry, and the edit `tshc migrate` makes (Rule
  13.9).

### Draft impact estimate

Known: the files of F2, which change 0130 already migrates. This proposal removes the warning
state from `src/compiler/ts/stage-call.ts` and from the editor. It removes no work that exists on
`main`, since no warning was implemented. Estimated, not measured: the size of each of the four
pull requests. Duration and cost are unknown.

### Independent review record

Reviewer: an AI agent (Claude Code) that did not write this proposal, at the coordinator's
request, on 2026-11-09. Revision reviewed: head `ed8e32ee` of pull request #1141. Answers are in
revision 2.

- **B1 (blocking).** Item 2 pointed at Rule 1.7, but the clause "`TS8028 ATTRIBUTE_NAME` on a
  stage call after the migration release" is in the Enforced by of 0130's new Rule 1.8. Fixed: <!-- doc-refs: skip — Rule 1.8 and RULE-0108 are added by change 0130 -->
  item 2 names Rule 1.8; `rules` has `'1.8'` in place of `'1.7'`; Applicability and What it <!-- doc-refs: skip — Rule 1.8 and RULE-0108 are added by change 0130 -->
  touches name Rule 1.8 and `RULE-0108.md`. <!-- doc-refs: skip — Rule 1.8 and RULE-0108 are added by change 0130 -->
- **S1.** "`tshc migrate` rewrites the call forms" was false: today's `tshc migrate` is change
  0111's codemod, which rewrites attributes to calls. Fixed: "The pull requests" says that the
  reversed rewrite exists in pull request 1, no later than the refusal, and stays after it with a
  test; the refusal text names it.
- **S2.** The OD-2 bullet of 0130's "Costs of the owner's decisions" still says "Two overload sets
  stay in the ambient library for one release." Fixed: item 9 removes it; item 6 governs.
- **S3.** Item 3 replaced more of Rule 6.7's sentence than the call-form clause, against change
  0137's amendment of the same sentence. Fixed: item 3 is scoped to the clause from "The calls
  `vertex(f)`" to "(change 0130, D4)", and says that 0137 and 0140 touch different clauses.
- **S4.** The size of the migration was not stated. Fixed: F2 states it, with 0111's precedent
  (#904, #907, #921). The owner answered the cost with the split ("여러 PR, 마지막에 거부").
- **N1.** "Whichever is implemented second" did not fit a proposal implemented with 0130. Fixed:
  0140 is implemented together with 0130, and each pull request carries both `Change:` lines
  (`changeLines` and `judge` in `scripts/changes.ts`).
- **N2.** Item 7 read as a replacement of The editor item 2. Fixed: "item 2 gains".
- **N3.** Item 6 named a means, not a requirement. Fixed: one `TS8028` in both halves (Rule 12.4),
  no call signature in completion or signature help; the implementation chooses the means.
- **N4.** Item 8 replaced the whole codes bullet. Fixed: only its first clause; the rest stays.
- **N5.** The timing of the parameter and field decorators (change 0111 D5, "until the release
  that refuses it") is outside 0140. Kept as a note in Exclusions: it may need its own question
  to the owner. No change to this proposal's scope.

No finding is open.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decision on the proposal's
pull request, the merge with `status: accepted`, the pointer sentence in change 0130, and the
approved revision. Each implementing pull request carries `Change: 0140` with `Change: 0130`.
Pull requests 2, 3 and 4 change how an author writes an example or what compiles, so each shows
one example before and after and waits for the owner's "merge" (`CLAUDE.md`, Merging).

### Configuration and validation record

This record does not yet apply. Delivery will require: the four pull requests and their commits;
the call-to-attribute test of `tshc migrate`; both halves read on each refused form; the emit
goldens unchanged for every migrated example; `bun run reqs:sync` and
`python scripts/doorstop-check.py -C` with the changed items reviewed; and the document audit of
the rules, the surface document and `reqs/`.

## What it owes downstream

- **typeshade.github.io**: the pages, example cards, Playground starter and generated host text
  that change 0130 lists move to the stage attribute in the pull request that moves the pin past
  the refusing pull request. No compiler release accepts a stage call with a warning in between.
  `compiler-changes.md` records 0140.
- **typeaudio**: the stage calls under `experiments/` move to the stage attribute in the pull
  request that moves the pin past the refusing pull request (6 in template strings, by hand).
  `compiler-changes.md` records 0140.
- vscode-typeshade, radiance, typenn and typecv write no stage call (0130's downstream entries),
  so this proposal owes them nothing beyond change 0130.
