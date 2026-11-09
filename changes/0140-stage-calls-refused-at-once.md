---
id: '0140'
title: The stage calls `vertex(f)`, `fragment(f)`, `compute([…], f)` and `workgroup_size([…], f)` and an `export default` entry are refused at once with `TS8028`, with no warning release (amends change 0130 D4)
status: draft
rules:
  - '1.7'
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
    what: The pages, example cards, Playground starter and generated host text that change 0130 lists move to the stage attribute in the same pull request that moves the pin past this change's implementation, since no compiler release accepts a stage call with a warning; `compiler-changes.md` records 0140 when the pin moves.
  - repo: typeaudio
    what: The stage calls under `experiments/` that change 0130 lists (15 at 0130's review, 6 in template strings that the author edits by hand) move to the stage attribute in the same pull request that moves the pin past this change's implementation; `compiler-changes.md` records 0140 when the pin moves.
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0140, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                |
| Date and attribution          | Drafted 2026-11-09 (UTC) by an AI agent (Claude Code) at the direction of the session's coordinator. The date is the drafting date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                    |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-09, in Korean: "바로 거부" (refuse at once), asked whether the stage calls of change 0111 get change 0130's one warning release before the refusal. See Owner's decisions.                                                                                                                                                                                                                                                                      |
| Applicability / effectivity   | Expected: the proposed texts of change 0130 for Rules 1.7, 6.7 and 8.1, its "proposed rules, in short" items 4 to 6, "The editor" item 2, the codes bullet of "What it touches", D4, "Migration order", the milestones of its "Approval and plan record" and its "Configuration and validation record"; `docs/language-design.md` and `reqs/` when 0130 is implemented; `src/compiler/ts/stage-call.ts` and its test; `src/language-service/ambient.ts`; `CHANGELOG.md`. No release version is assigned. |
| Review baseline               | `main` at `965d6d6e` (merge of pull request #1122), read on 2026-11-09.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Review and revision authority | No pull request is assigned when this revision is written. Git records the revisions of this file. The review and the merge of the proposal's pull request record the decision.                                                                                                                                                                                                                                                                                                                          |

## What changes

Change 0130 (accepted, not implemented) decides in D4 that the calls `vertex(f)`, `fragment(f)`,
`compute([…], f)` and `workgroup_size([…], f)` compile for one release with a `TS8028` warning,
and are refused after it. An entry written `export default` gets the same treatment (0130's
proposed rule 5 and Rule 8.1). This proposal replaces that decision.

**After this change:** a stage call and an `export default` entry are refused at once. Each is a
`TS8028` error, in the compiler and in the editor. The text names the attribute form and
`tshc migrate`. No release has a warning window.

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

### Amending change 0130

Change 0130 is accepted and not implemented. `changes/README.md` says an accepted proposal is
amended in its own pull request (The front matter). This proposal is that pull request. It is a
separate record, as change 0137 is for the parameter qualifier. It does not edit the text of
change 0130.

It replaces these parts of change 0130. The rest of change 0130 stands, change 0137's
replacements included.

1. **D4. Migration.** Replaced whole by: "The call forms and an `export default` entry are refused
   with `TS8028` at once, in the implementing pull request that migrates the examples, tests and
   `journeys/` with `tshc migrate` (change 0140)."
2. **Rule 1.7, Enforced by** (0130's proposed text): "`TS8028 ATTRIBUTE_NAME` on a stage call
   after the migration release" becomes "`TS8028 ATTRIBUTE_NAME` on a stage call".
3. **Rule 6.7** (0130's proposed text): the sentence "The calls `vertex(f)`, `fragment(f)`,
   `compute([…], f)` and `workgroup_size([…], f)` are accepted for one release with a `TS8028`
   warning that names the attribute and `tshc migrate`, and are refused after it (change 0130,
   D4)" becomes "The calls `vertex(f)`, `fragment(f)`, `compute([…], f)` and
   `workgroup_size([…], f)` must be refused with `TS8028`, whose text names the attribute and
   `tshc migrate` (change 0130, D4, as amended by change 0140)". In its Enforced by, "for the
   stage calls during the warning release" becomes "for the refusal of the stage calls", and
   `src/compiler/ts/stage-call.test.ts` is read as pinning "the refusal of the stage calls".
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
     (`ambient.ts` lines 1655-1671); the call overloads leave with the refusal" becomes "The call
     overloads leave the ambient library in the refusing pull request, or stay only where the
     implementation shows that they keep TypeScript from adding a second diagnostic to the
     call's `TS8028` (Rule 12.4)".
6. **"Final rule texts for the owner (summary)"**: the Rule 6.7 bullet's "the stage calls warn
   for one release, then are refused" becomes "the stage calls are refused". The Rule 8.1
   bullet's "except the stage calls, which warn for one release; `export default` warns for one
   release, then is refused" becomes "the stage calls and `export default` are refused".
7. **"The editor" item 2**: it applies to the call forms as an error. The language service
   reports a stage call's and an `export default` entry's `TS8028` with `category: 'error'`,
   where `compile()` does. No warning state exists for them in the editor.
8. **"What it touches", the codes bullet**: "`TS8028` warns on, then refuses, the call forms"
   becomes "`TS8028` refuses the call forms and an `export default` entry".
9. **"Migration order"**: step 5, "One release warns on the call forms; the next refuses them",
   is removed. Steps 3 and 4 become: "3. Implement the attributes as the decided form, the
   narrowed editor filter and projection, and split `tshc migrate`; the call forms stay
   accepted, with no warning, until step 4. 4. In one pull request, refuse the call forms and an
   `export default` entry with `TS8028`, and migrate the examples, the tests, `journeys/` and the
   documents with `tshc migrate`; template strings are edited by hand."
10. **"Approval and plan record", milestones**: "then 0130's front end, editor and warning
    release, then its codemod, then the refusing release" becomes "then 0130's front end and
    editor, then the one pull request of Migration order step 4".
11. **"Configuration and validation record"**: "the call forms' warning and refusal" becomes "the
    call forms' refusal".

Whichever of change 0130 and this proposal is implemented second keeps this proposal's
sentences. The pull request that accepts this proposal also adds one sentence after the
cross-reference to change 0137 in change 0130's "What changes", as a deliberate pointer: "Change
0140 replaces D4: the call forms and an `export default` entry are refused at once with
`TS8028`; the implementation applies change 0140's text in the named places." It changes no other
text of change 0130.

### Exclusions

- The decorators `@builtin`, `@location`, `@interpolate`, `@invariant` and `@blend_src` on a
  parameter or a field (change 0111 D5, kept by 0130's Rules 6.6 and 6.7) are not part of this
  proposal. Their timing is not changed here.
- The parameter qualifiers `@inout` and `@out` belong to change 0137.
- The attribute forms, the editor's projection and filter, `@workgroup_size([n])` and D1 to D3
  and D5 of change 0130 do not change.

## Why

The owner decided to refuse the stage calls at once (Owner's decisions). Two facts support that
decision:

- **F1.** No official release exists. `npm view typeshade versions` returns only `0.0.0`, and the
  repository has no tag and no GitHub release (observed 2026-11-09). OD-6 says the bundled builds
  were tests, and that a refusal owes no warning release because of them.
- **F2.** On `main` at `965d6d6e`, 93 files of `examples/*.shade.ts` and 77 files under
  `journeys/` write a stage call (`grep -E "= (vertex|fragment|compute|workgroup_size)\("`).
  `tshc migrate` rewrites them in the implementing pull request. A warning release would only
  keep the second spelling for one more release.

Precedents: change 0132 decision 5 refuses a written `@diagnostic(…)` or `{ diagnostic }` at
once, on the same facts. Change 0137 refuses the type form `inout<T>` at once.

A refusal of a program that compiles today is a breaking change under Rule 13.9. Rule 13.10 does
not apply: a refused program does not compute something else. Rule 13.9 needs a `CHANGELOG.md`
entry that names the migration edit, and the implementing pull request carries it.

### Alternatives

- **One warning release, then refusal (change 0130 D4 as accepted).** Rejected by the owner. No
  official release exists to carry the warning (OD-6), and the call form is a second spelling of
  a stage for that release (OD-3).

### Costs of the owner's decision

- A downstream repository that moves its pin past the implementing pull request must migrate its
  stage calls in the same pull request. typeaudio has 15, 6 of them in template strings that
  `tshc migrate` cannot reach (0130's downstream entry). typeshade.github.io edits its pages by
  hand. These are recorded as costs of the decision, not reasons to change it.
- The refusing pull request is large: it carries the refusal and the migration of every example,
  test and journey together, because CI refuses a stage call from that commit on.

## Owner's decisions

- **OD-2.** An entry's stage is written `@vertex`, `@fragment` or `@compute`. A stage is not a
  call of a fixed function name. This proposal removes the call form sooner, so it follows OD-2.
- **OD-3.** The language stays small. The call form is a second spelling of a stage, and it
  leaves at once.
- **OD-6.** Nothing is released yet. A refusal owes no warning release because of the bundled
  builds.
- **The owner's decision for this proposal.** Date: 2026-11-09. The owner's words, in the
  session: "바로 거부" (refuse at once). Asked whether the stage calls get change 0130's one
  warning release before the refusal, the owner chose to refuse them at once with `TS8028`,
  naming `@vertex export function vs(…)` and `tshc migrate`, in one implementing pull request.

This proposal reverses no entry.

## Why the compiler cannot do it

Not applicable: this proposal adds no name, no diagnostic code and no surface form. It changes
when an existing refusal (`TS8028`, declared by change 0130) takes effect. The compiler already
does the migration work: `tshc migrate` rewrites the call forms.

## What it touches

- **Rule 1.7, Rule 6.7, Rule 8.1**: the sentences of change 0130's proposed texts named under
  "Amending change 0130". When change 0130 is implemented, `docs/language-design.md` and
  `reqs/rules/RULE-0107.md`, `RULE-0607.md` and `RULE-0801.md` carry the amended sentences.
- **`TS8028`**: no code is added or removed. Its category on a stage call and on an
  `export default` entry is an error from the refusing pull request on. Change 0130 declares the
  code.
- **Examples, surface sections and downstream pages**: as change 0130 declares them. This
  proposal adds none. The implementing pull requests carry `Change: 0130` and `Change: 0140`
  together, so `scripts/changes.ts` checks the diff against both records.
- **Tests**: `src/compiler/ts/stage-call.test.ts` pins the refusal of each call form, and
  `src/compiler/ts/stage3.test.ts` pins the refusal of `export default`. Both halves are read on
  each refusal (`src/language-service/ambient-parity.test.ts` shape).
- **`CHANGELOG.md`**: one `### Removed` entry under `[Unreleased]` names the call forms and
  `export default` on an entry, and the edit `tshc migrate` makes (Rule 13.9).

### Draft impact estimate

Known: the 93 example files and 77 journey files of F2, which change 0130 already migrates. This
proposal removes the warning state from `src/compiler/ts/stage-call.ts` and from the editor; it
removes no work that exists on `main`, since no warning was implemented. Estimated, not measured:
the refusing pull request's size, which carries the migration of F2. Duration and cost are
unknown.

### Independent review record

Not yet done. Before the owner decides, an agent or a person that did not write this proposal
reviews it against `changes/README.md` (Independent review), and the findings and answers go
here.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decision on the proposal's
pull request, the merge with `status: accepted`, the pointer sentence in change 0130, and the
approved revision. Each implementing pull request carries `Change: 0140` with `Change: 0130`.
The refusing pull request changes how an author writes an example, so it shows one example
before and after and waits for the owner's "merge" (`CLAUDE.md`, Merging).

### Configuration and validation record

This record does not yet apply. Delivery will require: the refusing commit and pull request; both
halves read on each refused form; the emit goldens unchanged for every migrated example;
`bun run reqs:sync` and `python scripts/doorstop-check.py -C` with the changed items reviewed; and
the document audit of the rules, the surface document and `reqs/`.

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
