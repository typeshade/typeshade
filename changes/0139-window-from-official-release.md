---
id: '0139'
title: A deprecation window is owed only for a meaning that an official release of the `typeshade` package carried; bundles, prereleases and changelog headings do not count
status: accepted
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

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0139, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                        |
| Date and attribution          | Drafted 2026-11-09 (UTC) by an AI agent (Claude Code) at the direction of the session's coordinator, and revised the same day to answer the independent review and to record the owner's decision on prereleases. The date is the drafting date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                               |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-09, in Korean: "아직 정식 릴리즈 전이라 문제 없음 테스트용으로 한것뿐이라". Recorded as `docs/owner-decisions.md` OD-6 (pull request #1132). Proposal 0134 (decision Q9, review findings S4 to S6) leaves the OD-6 sentence of Rule 13.10 to its own change. This proposal is that change.                              |
| Applicability / effectivity   | Expected: `docs/language-design.md` Rules 13.9 and 13.10, `reqs/rules/RULE-1309.md`, `reqs/rules/RULE-1310.md`, `RELEASING.md` §7 (prose that restates the two rules), the header comment of `src/changelog.test.ts` (it quotes Rule 13.9's "a published version"). No code, test logic, diagnostic, export, surface section or example changes. No release version is assigned. |
| Review baseline               | `main` at `089fe921` (merge of pull request #1132), read on 2026-11-09. Revision 2 merges `main` at `965d6d6e` (merge of pull request #1122).                                                                                                                                                                                                                                    |
| Review and revision authority | Pull request #1140 (draft). Git records the revisions of this file. The review and the merge of the proposal's pull request record the decision.                                                                                                                                                                                                                                 |

## What changes

Rules 13.9 and 13.10 say "a published version" and "a published release", and they do not say
of what. Three published things carry the compiler today, and none of them is a release of the
`typeshade` package (Why, fact F1). This proposal defines the term once, in Rule 13.9, and uses
it in Rule 13.10.

1. **Rule 13.9 defines an official release.** Proposed sentence, added after the first sentence:

   > An _official release_ is a version of the `typeshade` package published on npm, other than
   > the placeholder `0.0.0` and with no prerelease part (a version such as `1.0.0-rc.1` is not
   > one). A published package that bundles the compiler (the `vscode-typeshade` extension,
   > `@typeshade/mcp`) is not one, and neither is a version heading of `CHANGELOG.md`, a GitHub
   > release or a tag with no such version on npm.

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
   > earlier than the next breaking release after the first step's official release was published
   > (the next minor before `1.0.0`, the next major after it).

   The second sentence changes "a published release must report" to "an official release must
   report". The fourth sentence changes "The window is counted in published releases." to "The
   window is counted in official releases. A meaning that no official release carried owes no
   window." The rationale adds: "The bundled builds were tests (OD-6)."
   "Derives from" adds `docs/owner-decisions.md` OD-6.

What does not change: the two steps of the window, the opt-in deprecation option, the
`### Changed` entry, the minor as the breaking position before `1.0.0`, and the duty of Rule
13.9 that every breaking change carries a `CHANGELOG.md` entry with its migration edit.

An example. Proposal 0134 ("Values that change") changes what `const C = 0.1;` carries beside an
`f64`: today the `f32` value of 0.1, after it the full double, as the written `x * 0.1` does. The
program still compiles and computes something else, so Rule 13.10 applies. Under the rules on
`main`, a reader can count `@typeshade/mcp` 0.1.1 on npm as "a published release" that carried
the old value, and so owe a warning release first. After this change, no official release
carried that value, so the change takes effect at once, with its `### Changed` entry (Rule 13.9).

A refusal is a breaking change under Rule 13.9, not a change of meaning under Rule 13.10. OD-6
covers refusals through Rule 13.9: an official release is what a breaking change is counted
against, and no official release exists. A refusal still carries its `CHANGELOG.md` entry with
the migration edit (Rule 13.9).

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

The owner decided one more point for this proposal:

- **Prereleases are not official releases.** Date: 2026-11-09. The owner's words, in the
  session: "사전 버전 제외" (exclude prerelease versions). Asked whether a SemVer prerelease of
  `typeshade` on npm (a version with a `-` part, such as `1.0.0-rc.1`) counts as an official
  release, the owner chose that it does not. An official release is a version of `typeshade` on
  npm other than `0.0.0` and with no prerelease part. The definition in item 1 carries this
  decision. It replaces the draft's undefined phrase "A test build is not one" (review finding
  S3).

## Why the compiler cannot do it

Not applicable: this proposal adds no name, no diagnostic code and no surface form. It edits the
text of two existing rules to record an owner decision about what counts as a release. That is a
process rule, which no compiler work decides.

## What it touches

- **Rule 13.9**: the first sentence and one new sentence that defines an official release, and
  its "Derives from". `reqs/rules/RULE-1309.md` follows through `bun run reqs:sync`.
- **Rule 13.10**: the first, second and fourth sentences, the rationale and "Derives from".
  `reqs/rules/RULE-1310.md` follows. Proposal 0134 also edits Rule 13.10 ("Derives from" and
  "Enforced by", for the retirement of `TS8053`). Both proposals edit the "Derives from" line:
  0134 removes #148 and its test, and 0139 adds OD-6. The other edits touch different sentences.
  The later implementing pull request merges `main` and keeps both edits.
- **`RELEASING.md` §7**: the prose that restates Rule 13.9 and Rule 13.10 says "official release"
  where the rules do. This is prose, not a criterion of `README.md`. The table of open windows
  (the `TS8053` row) belongs to proposal 0134 and is not edited here.
- **`src/changelog.test.ts`**: its header comment quotes Rule 13.9 ("a published version
  follows Semantic Versioning 2.0.0") and says "official release" after this change. Its test
  logic does not change.
- **The tests tagged `Verifies: Rule 13.10`**: no change. On `main` at `965d6d6e` they are
  `src/compiler/ts/integer-literal-deprecation.test.ts` and
  `src/compiler/ts/field-literal-deprecation.test.ts`. Proposal 0134 deletes the first. The
  tagged tests are whatever is on `main` when this change lands. After `bun run reqs:sync`,
  Doorstop flags `RULE-1309` and `RULE-1310` as changed, and a person reviews them
  (`reqs/README.md`).

Not part of this change, listed as separate follow-ups:

- **The `## [0.1.0] - 2026-09-29` heading of `CHANGELOG.md`** (OD-6). It records no release.
  The minimal correction renames it to a heading that names it as a test build with no npm
  version, keeps its entries, and corrects the introduction's sentence "Nothing in this
  repository was published to npm before **`0.1.0`, the first release**". `src/changelog.test.ts`
  reads every `## ` heading as `## [Unreleased]` or `## [X.Y.Z] - YYYY-MM-DD`, so the same pull
  request teaches it the one test-build heading. That correction needs no proposal (no criterion
  of `README.md` applies), so it is its own pull request with `Change: none`. It edits
  `src/changelog.test.ts`, so it is not a documentation-only pull request: it waits for the
  owner's "merge" unless it qualifies as a bug fix (`CLAUDE.md`, Merging). It also owns the
  `[Unreleased]` sentences that count from `0.1.0`: "No published version had the construct (it
  landed after `0.1.0`), so no migration release follows (Rules 13.9 and 13.10 bind a published
  version)" (change 0131, about line 88), and "No published version had the filter … (Rules 13.9
  and 13.10 bind a published version)" (change 0132, about line 1698). Whether `package.json`
  keeps `"version": "0.1.0"` is a question for that pull request.
- **The §14 row and the `RELEASING.md` open-windows row for `TS8053`**: proposal 0134 owns them.
- **Plan unit P1** (`docs/typeshade-plan.md`, row P1; change 0100 decision D2, "Rule 13.10 is
  unit P1") is a separate change to Rule 13.10 for the time before `1.0.0`. This proposal neither
  delivers P1 nor blocks it. Row P1 stays unchanged.

### Draft impact estimate

Known: about ten changed lines in `docs/language-design.md`, the two `reqs/` items, about six
lines of `RELEASING.md` §7, and two lines of the header comment of `src/changelog.test.ts`. No code, golden, test, export or diagnostic moves. No downstream
repository names Rule 13.9, Rule 13.10 or "deprecation window" in its Markdown or TypeScript
(grep on 2026-11-09: `vscode-typeshade` at `db3f417`, `radiance` at `3e4efb3`, `typeaudio` at
`8bd1ab1`, `typenn` at `3a7d66c`, `typecv` at `5c3f8ce`, `web` at `990ec50`; 0 matches each). So
`downstream` is empty. Duration and cost are not estimated.

### Independent review record

Reviewer: an AI agent (Claude Code) that did not write this proposal, at the coordinator's
request, on 2026-11-09. Revision reviewed: head `85170188` of pull request #1140. Answers are
in revision 2.

- **S1.** The worked example `let k = 7; let h = k / 2;` is wrong: proposal 0134 leaves that
  local an `f32`, and a refusal falls under Rule 13.9, not Rule 13.10. Fixed: the example is
  0134's `const C = 0.1;` beside an `f64` (a meaning change), and a paragraph says that OD-6
  covers refusals through Rule 13.9.
- **S2.** "A test build reached its testers and no user (OD-6)" claims more than OD-6 says.
  Fixed: the rationale adds "The bundled builds were tests (OD-6)."
- **S3.** "A test build is not one" uses an undefined term. Fixed: deleted. The owner's decision
  on prereleases (Owner's decisions) replaces it, and the definition adds that a GitHub release
  or a tag alone is not an official release.
- **S4.** Proposal 0134 and this proposal both edit Rule 13.10's "Derives from" line, which the
  draft did not say. Fixed: What it touches says so, and the later pull request keeps both.
- **S5.** `src/compiler/ts/field-literal-deprecation.test.ts` also carries
  `Verifies: Rule 13.10`, and 0134 deletes `integer-literal-deprecation.test.ts`. Fixed: both are
  named, and the tagged tests are whatever is on `main` when this change lands.
- **S6.** Row P1 of `docs/typeshade-plan.md` is plan unit P1 (change 0100 D2), not prose this
  change makes false. Fixed: cited as P1 and 0100 D2. This proposal neither delivers nor blocks
  P1, row P1 stays unchanged, and "fixes it if …" is deleted.
- **N1.** The `CHANGELOG.md` follow-up also edits `src/changelog.test.ts`, so it is not
  approved in advance. It also owns the `[Unreleased]` sentences that count from `0.1.0`. Fixed:
  the follow-up says both, with change 0131's sentence (about line 88) and change 0132's (about
  line 1698).
- **N2.** The header comment of `src/changelog.test.ts` quotes Rule 13.9's "a published
  version". Fixed: added to Applicability and to What it touches.
- **N4.** The Rule 13.10 text mixed "release" and "official release". Fixed: "after the first
  step's official release was published".

No finding is open.

### Approval and plan record

Accepted. The owner (Seungup) approved acceptance in the Claude Code session on 2026-11-09, in
Korean ("승인"), after the new Rule 13.9 definition and the Rule 13.10 change were shown (OD-4).
The approval is recorded by the merge of pull request #1140 with `status: accepted`; the approved
revision is this file as merged. The implementing pull request will carry `Change: 0139`. It
changes rule text only, adds no author-facing name and changes no example, so it is approved in
advance once every required check is green (`CLAUDE.md`, Merging). Duration and cost are not
estimated.

### Configuration and validation record

This record does not yet apply. Delivery will require the implementing commit and pull request,
`bun run reqs:sync` and `python scripts/doorstop-check.py -C` with the two items reviewed,
`bun run docs:refs`, `bun run docs:impact`, `bun scripts/changes.ts --base origin/main` and
`npx vitest run src/changelog.test.ts src/reqs.test.ts`, each with its date, commit and result.

## What it owes downstream

Nothing. No downstream repository restates the two rules (Draft impact estimate). A downstream
pin that carries this change owes no edit and no `compiler-changes.md` record, because
`downstream` is empty.
