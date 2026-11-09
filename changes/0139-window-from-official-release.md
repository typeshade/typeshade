---
id: '0139'
title: A deprecation window is owed only for a meaning that an official release of the `typeshade` package carried; test builds and bundles do not count
status: draft
rules:
  - '13.9'
  - '13.10'
surface: []
exports: []
exports-removed: []
codes: []
examples: []
names: []
downstream: []
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0139, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                           |
| Date and attribution          | Drafted 2026-11-09 (UTC) by an AI agent (Claude Code) at the direction of the session's coordinator. The date is the drafting date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                               |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-09, in Korean: "아직 정식 릴리즈 전이라 문제 없음 테스트용으로 한것뿐이라". Recorded as `docs/owner-decisions.md` OD-6 (pull request #1132). Proposal 0134 (decision Q9, review findings S4 to S6) leaves the OD-6 sentence of Rule 13.10 to its own change. This proposal is that change. |
| Applicability / effectivity   | Expected: `docs/language-design.md` Rules 13.9 and 13.10, `reqs/rules/RULE-1309.md`, `reqs/rules/RULE-1310.md`, `RELEASING.md` §7 (prose that restates the two rules). No code, test, diagnostic, export, surface section or example changes. No release version is assigned.                                                                       |
| Review baseline               | `main` at `089fe921` (merge of pull request #1132), read on 2026-11-09.                                                                                                                                                                                                                                                                             |
| Review and revision authority | Pull request #1140 (draft). Git records the revisions of this file. The review and the merge of the proposal's pull request record the decision.                                                                                                                                                                                                    |

## What changes

Rules 13.9 and 13.10 say "a published version" and "a published release", and they do not say
of what. Three published things carry the compiler today, and none of them is a release of the
`typeshade` package (Why, fact F1). This proposal defines the term once, in Rule 13.9, and uses
it in Rule 13.10.

1. **Rule 13.9 defines an official release.** Proposed sentence, added after the first sentence:

   > An _official release_ is a version of the `typeshade` package published on npm, other than
   > the placeholder `0.0.0`. A test build is not one, and neither is a published package that
   > bundles the compiler (the `vscode-typeshade` extension, `@typeshade/mcp`) or a version
   > heading of `CHANGELOG.md` with no such version on npm.

   The first sentence changes from "A published version must follow Semantic Versioning 2.0.0"
   to "An official release must follow Semantic Versioning 2.0.0". The definition of _breaking_
   and the rest of the rule do not change. "Derives from" adds `docs/owner-decisions.md` OD-6.

2. **Rule 13.10 owes a window only for a meaning an official release carried.** The first
   sentence changes as follows.

   Before:

   > A change that keeps a program compiling and makes it compute something else must ship in
   > two steps, and the second must come no earlier than the next breaking release after the
   > first step's release was published (the next minor before `1.0.0`, the next major after
   > it).

   After:

   > A change that keeps a program compiling and makes it compute something other than what an
   > official release (Rule 13.9) computed for it must ship in two steps, and the second must come no
   > earlier than the next breaking release after the first step's release was published (the
   > next minor before `1.0.0`, the next major after it).

   The second sentence changes "a published release must report" to "an official release must
   report". The fourth sentence changes "The window is counted in published releases." to "The
   window is counted in official releases. A meaning that no official release carried owes no
   window." The rationale adds: "A test build reached its testers and no user (OD-6)."
   "Derives from" adds `docs/owner-decisions.md` OD-6.

What does not change: the two steps of the window, the opt-in deprecation option, the
`### Changed` entry, the minor as the breaking position before `1.0.0`, and the duty of Rule
13.9 that every breaking change carries a `CHANGELOG.md` entry with its migration edit.

An example. Proposal 0134 changes the type of `let k = 7; let h = k / 2;` from `f32` to a refusal.
Under the rules on `main`, a reader can count `@typeshade/mcp` 0.1.1 on npm as "a published
release" that carried the `f32` meaning, and so owe a warning release first. After this change,
no official release carried that meaning, so the change takes effect at once, with its
`### Changed` entry (Rule 13.9).

## Why

The owner decided that TypeShade has no official release yet and that the bundled builds were
tests (OD-6). OD-6 names Rules 13.9 and 13.10. The rule text can still be read against it,
because "published" covers any package on npm or on the Marketplace. `CLAUDE.md` (The owner's
decisions) says to follow the entry and fix the other document in its own pull request.

Facts, observed on 2026-11-09:

- **F1.** `npm view typeshade versions` returns only `0.0.0`. `npm view @typeshade/mcp versions`
  returns `0.1.0` and `0.1.1`. `gh api repos/typeshade/typeshade/releases` returns 0 releases, and
  the repository has no tag. Proposal 0134 fact F11 records the `vscode-typeshade` 0.3.0 build on
  the Visual Studio Marketplace.
- **F2.** `CHANGELOG.md` has the heading `## [0.1.0] - 2026-09-29`, and `package.json` says
  `"version": "0.1.0"`. No `typeshade` 0.1.0 is on npm.

Alternatives:

- **Define the term in Rule 13.10 only.** Rejected: Rule 13.9 says "a published version" with
  the same gap, and OD-6 names both rules. One definition in Rule 13.9 serves both.
- **Name the bundles by version only** ("`@typeshade/mcp` 0.1.x and `vscode-typeshade` 0.3.0 do
  not count"). Rejected: the next test build would reopen the question. The definition names the
  one package whose versions count.
- **Leave the text and rely on OD-6.** Rejected: `CLAUDE.md` asks for the other document to be
  fixed, and Rule 13.10 is normative.

## Owner's decisions

This proposal rests on OD-6 (nothing is released yet; the bundled builds were tests; a change of
meaning or a refusal owes no warning release because of them; the `## [0.1.0]` heading does not
make a release). It reverses no entry. It does not touch OD-1 to OD-5 or OD-7.

## Why the compiler cannot do it

Not applicable: this proposal adds no name, no diagnostic code and no surface form. It edits the
text of two existing rules to record an owner decision about what counts as a release. That is a
process rule, which no compiler work decides.

## What it touches

- **Rule 13.9**: the first sentence and one new sentence that defines an official release, and
  its "Derives from". `reqs/rules/RULE-1309.md` follows through `bun run reqs:sync`.
- **Rule 13.10**: the first, second and fourth sentences, the rationale and "Derives from".
  `reqs/rules/RULE-1310.md` follows. Proposal 0134 also edits Rule 13.10 ("Derives from" and
  "Enforced by", for the retirement of `TS8053`). The two edits touch different sentences. The
  later pull request merges `main` and keeps both.
- **`RELEASING.md` §7**: the prose that restates Rule 13.9 and Rule 13.10 says "official release"
  where the rules do. This is prose, not a criterion of `README.md`. The table of open windows
  (the `TS8053` row) belongs to proposal 0134 and is not edited here.
- **`src/changelog.test.ts`** and **`src/compiler/ts/integer-literal-deprecation.test.ts`**:
  no change. Their `Verifies:` tags stay. After `bun run reqs:sync`, Doorstop flags the two
  items as changed, and a person reviews them (`reqs/README.md`).

Not part of this change, listed as separate follow-ups:

- **The `## [0.1.0] - 2026-09-29` heading of `CHANGELOG.md`** (OD-6). It records no release.
  The minimal correction renames it to a heading that names it as a test build with no npm
  version, keeps its entries, and corrects the introduction's sentence "Nothing in this
  repository was published to npm before **`0.1.0`, the first release**". `src/changelog.test.ts`
  reads every `## ` heading as `## [Unreleased]` or `## [X.Y.Z] - YYYY-MM-DD`, so the same pull
  request teaches it the one test-build heading. That correction needs no proposal (no criterion
  of `README.md` applies), so it is its own pull request with `Change: none`. Whether
  `package.json` keeps `"version": "0.1.0"` is a question for that pull request.
- **The §14 row and the `RELEASING.md` open-windows row for `TS8053`**: proposal 0134 owns them.
- **`docs/typeshade-plan.md` row P1** restates Rule 13.10 for the time before `1.0.0`. The
  implementing pull request reads it and fixes it if the new text makes it false.

### Draft impact estimate

Known: about ten changed lines in `docs/language-design.md`, the two `reqs/` items, and about six
lines of `RELEASING.md` §7. No code, golden, test, export or diagnostic moves. No downstream
repository names Rule 13.9, Rule 13.10 or "deprecation window" in its Markdown or TypeScript
(grep on 2026-11-09: `vscode-typeshade` at `db3f417`, `radiance` at `3e4efb3`, `typeaudio` at
`8bd1ab1`, `typenn` at `3a7d66c`, `typecv` at `5c3f8ce`, `web` at `990ec50`; 0 matches each). So
`downstream` is empty. Duration and cost are not estimated.

### Independent review record

Not yet done. Before the owner decides, an agent or a person that did not write this proposal
reviews it against `README.md` (Independent review), and the findings and answers go here.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decision on the proposal's
pull request, the merge with `status: accepted`, and the approved revision. The implementing
pull request will carry `Change: 0139`.

### Configuration and validation record

This record does not yet apply. Delivery will require the implementing commit and pull request,
`bun run reqs:sync` and `python scripts/doorstop-check.py -C` with the two items reviewed,
`bun run docs:refs`, `bun run docs:impact`, `bun scripts/changes.ts --base origin/main` and
`npx vitest run src/changelog.test.ts src/reqs.test.ts`, each with its date, commit and result.

## What it owes downstream

Nothing. No downstream repository restates the two rules (Draft impact estimate). A downstream
pin that carries this change owes no edit and no `compiler-changes.md` record, because
`downstream` is empty.
