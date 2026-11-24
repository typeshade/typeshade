---
id: '0147'
title: 'A pull request that declares and passes a comments-only or pure move runs fewer gates before the merge'
status: accepted
rules:
  - '13.4'
surface: []
exports: []
exports-removed: []
codes: []
examples: []
names: []
downstream: []
---

<!-- doc-refs: skip-file — a draft proposal names files of an unmerged implementation -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0147`, `status: accepted`. The front matter is the lifecycle authority. `0147` is the next number after `0146`.                                                                                                                                      |
| Date and attribution          | Written 2026-11-24, UTC. The date is the authoring context, not an approval. Drafted by the repository's coding agent at the owner's direction (the owner's words are in section "Why"). The owner's decision of 2026-11-24 is recorded in the approval record below. |
| Applicability / Effectivity   | `docs/language-design.md` Rule 13.4 (second paragraph) and its Doorstop item `reqs/rules/RULE-1304.md`; the CI files of the unmerged commit `29f61c82` (branch `local/ci-scope`). No `src/` code, surface, export, diagnostic or example. Release version unassigned. |
| Review baseline               | `origin/main` at `d14bebb4` (the merge of PR #1529).                                                                                                                                                                                                                  |
| Review and revision authority | Pull request #1531. Git records revisions. The owner's go-ahead in the conversation is the review (`CLAUDE.md`, Merging), and the merge of that pull request records the decision.                                                                                    |

## What changes

Rule 13.4 has two paragraphs. The second one gives one exception: a change that edits only
documents (change `0055`). This proposal adds a second and a third exception. Both are for a pull
request range that declares a move and that `scripts/move-purity.ts` accepts.

The checker proves two things. In the `Move: comments` mode, the token stream of every changed
file is the same, apart from removed comments. In the `Move: pure` mode, declarations only move
between clean files, so no evaluation order and no import cycle changes
(`docs/structure-refactoring-plan.md`, section 8, items 9 and 9a).

**Before** (the second paragraph of Rule 13.4, `docs/language-design.md` line 1792, verbatim):

```text
A change that edits only documents (a `.md` file outside `src/`, or a Doorstop item under `reqs/`) must pass `bun run build`, `bun run test` and the traceability check, and needs no GPU gate, since no GPU gate reads a document; CI's `change scope` job tells the two apart on a pull request, and a push to `main` and a release run every gate (change `0055`).
```

**After** (the proposed second paragraph; the first sentence is the old text with its two ends
unchanged, and the new text follows it on its own lines):

```text
A change that edits only documents (a `.md` file outside `src/`, or a Doorstop item under `reqs/`) must pass `bun run build`, `bun run test` and the traceability check, and needs no GPU gate, since no GPU gate reads a document; CI's `change scope` job tells the two apart on a pull request, and a push to `main` and a release run every gate (change `0055`).
A pull request range that declares `Move: comments` and that `scripts/move-purity.ts` accepts removes comments and changes no token. Before the merge it must pass the source and policy checks, the unit shards of the pinned TypeScript version and the traceability check. It needs no compile gate, user journeys, TypeScript 5 or 6 unit shards, render gate, perf gate, package smoke or TypeNN build (change `0147`).
A range that declares `Move: pure` and that the checker accepts moves declarations between clean files. Before the merge it must also pass the compile gate, the user journeys, one package smoke and the TypeNN build. It needs no TypeScript 5 or 6 unit shards, render gate or perf gate (change `0147`).
Each skipped gate runs on `main` after the merge, and a run on `main` is never cancelled by a later push. A push to `main`, a manual dispatch and a release run every gate. A range that the checker refuses is an ordinary change.
```

The `rationale`, `Derives from` and `Enforced by` lines of Rule 13.4 stay as they are.

Example of what an author of a slice sees. A pull request titled `Move: comments, src/runtime` with
the commit line `Move: comments` runs the first four rows of the table below before the merge.
A pull request with no `Move:` line, or whose range the checker refuses, runs all of them.

| Job or check                                                                      | documents (`0055`) | `Move: comments` | `Move: pure`               | any other change |
| --------------------------------------------------------------------------------- | ------------------ | ---------------- | -------------------------- | ---------------- |
| `change scope`                                                                    | runs               | runs             | runs                       | runs             |
| `source and policy checks`                                                        | runs               | runs             | runs                       | runs             |
| pinned TypeScript unit shards, `typecheck + unit` (required)                      | runs               | runs             | runs                       | runs             |
| `traceability (Doorstop)` (required)                                              | runs               | runs             | runs                       | runs             |
| TypeScript 5 and TypeScript 6 unit shards                                         | skipped            | skipped          | skipped                    | runs             |
| `compile gate (Tint + WebGL2)` (required)                                         | skipped            | skipped          | runs                       | runs             |
| `user journeys (packed tarball, WebGPU)` (required)                               | skipped            | skipped          | runs                       | runs             |
| `render gate`, `perf gate`                                                        | skipped            | skipped          | skipped                    | runs             |
| package smoke (`package-smoke.yml`), when its path filter matches                 | not run            | skipped          | one smoke (Linux, Node 24) | five smokes      |
| `TypeNN candidate (build + CPU)` (`downstream.yml`), when its path filter matches | not run            | skipped          | runs                       | runs             |

The path filter of `downstream.yml` is `src/**`, `package.json`, `bun.lock`, `.node-version` and
two `.github/` paths. The filter of `package-smoke.yml` adds `examples/**`, `scripts/**`,
`tsconfig*.json` and `.bun-version`. A range outside a filter does not start that workflow at all.

The `change scope` job sets the output `move` (`none`, `comments` or `pure`). The local action of
the implementation runs `bun scripts/move-purity.ts --base "origin/$BASE" --require --title "$TITLE" --json`.
The output is `comments` or `pure` only when the command exits 0, the JSON has `pure: true`, and
its `declared` field equals that mode. Every other result is `none`. The job never fails on a range
that is not pure. The `move purity` step of `quality` reports that failure.

**A run on `main` is never cancelled.** `ci.yml`, `package-smoke.yml` and `downstream.yml` each set
`concurrency` with `cancel-in-progress: true`. Two quick merges then cancel the run of the first
commit on `main`, and a gate skipped before its merge may never report for that commit. The change
sets `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}` in the three workflows. A pull
request run is still cancelled by a newer push to its branch. This is part of this change, since
the exceptions rely on the run on `main` (decision of the orchestrating agent, 2026-11-24).

A skipped required check reports success to the ruleset, as it does for a documents-only pull
request under `0055`. The required checks keep their names.

## Why

**The owner's words.** On 2026-11-24, in the conversation: "CI 무시하는게 좋아보여요. 지금 보니까
코드 변경이 없는데도 너무 무거운 작업을 진행하는건 비용효율적이지 않습니다" (CI looks worth
ignoring; running such heavy jobs when no code changes is not cost-effective). The agent then
proposed a lighter CI path for declared moves, not ignoring CI. The owner answered "좋은 방향으로
그러면" (then go in a good direction). This is the owner's direction on the path. It is not an
approval of this text. The approval of the text is recorded in the approval record below.

**Measured cost** (from `docs/structure-refactoring-plan.md`, section 8, item 10 in commit
`29f61c82`, and the planning figures of that plan):

- A pull request that changes code runs about 73 runner-minutes of CI.
- A `Move: comments` slice saves about 50 of them.
- A `Move: pure` slice saves about 38 of them.
- The plan schedules hundreds of slices. The saving is therefore of the order of thousands of
  runner-minutes. This figure is an estimate from the plan, not a measurement of a finished series.
  The basis of each per-slice figure is the plan's item 10 and not a new run by this proposal.

**Why not ignore CI.** The skipped jobs would then never report, and the required checks would
wait for ever (`0055`, "Alternatives considered"). A comment removal has already broken a test
that reads the text of another file (the plan, section 8, item 5). So the unit shards of the
pinned TypeScript version and the traceability check stay in every scope. On a pull request,
`ci-unit.yml` passes `--base "origin/$BASE"` to `scripts/affected-tests.ts`, so these shards run
a selection of the suite and not the whole suite. Inference: the selection catches a test that
reads the text of a changed file only when `affected-tests.ts` selects that test. This proposal
did not measure that. On a push to `main`, `ci-unit.yml` passes no `--base`, so the full suite
runs there (inference from the workflow, not a measured run).

**Alternatives considered.**

- **Ignore CI for a declared move (`paths-ignore`).** Cheapest. The required checks never report,
  and the unit shards that catch a text-reading test are lost.
- **Keep every gate (the text of Rule 13.4 today).** Safest, and the cost above stays for each slice.
- **Skip by a list of files.** The checker already proves more than a list can, and a list needs upkeep.
- **Skip by the proof of the checker (proposed).** One job decides, and what it skips is what the
  proof makes redundant.

**Risks and limits.** These are facts of the design, not defects that a later change can remove.

1. A pull request runs its own copy of the workflow, the action and the checker. A range could
   lie to skip gates. The checker refuses a range that touches `.github/` or the checker itself,
   but a pull request that edits them runs its edited checker. The in-pull-request refusal is
   therefore no safeguard against such a pull request. The controls are two: the merging agent
   runs the checker of `main` on the range before a merge (`CLAUDE.md`, Merging; the plan, section
   9.1), and review. `.github/CODEOWNERS` lists `/.github/` and `*` for the owner, so a change to
   a workflow needs the owner's review. `scripts/move-purity.ts` is covered by `*` only.
2. A skipped gate first runs after the merge, on the push to `main`. A failure there marks a
   commit of `main` red. It is not a failure of the pull request.
3. Nobody is alerted to a red `main` beyond the GitHub defaults: the account that merged and the
   watchers of Actions. No workflow opens an issue or reverts the commit. Never cancelling a run on
   `main` makes the result exist, but a person or an agent must still read it. The orchestrating
   agent reads the run on `main` after each slice merge.
4. The render gate does not run for a pure move before the merge. A pure move can still change
   pixels if the checker has a gap. Its known gaps are listed in the plan, section 8, item 9.
   A pure pull request can also merge on a stale base. A semantic conflict with a newer commit of
   `main` then shows only on `main`, after the merge.
5. The TypeScript 5 and 6 shards do not run for a slice before the merge. They run on `main`.
6. The unit shards of the pinned TypeScript version run in every scope, but on a pull request they
   run the selection of `affected-tests.ts` and not the whole suite. Inference: a comment removal
   can still fail a selected test that reads the text of a file, and that fails the pull request.
   A test that is not selected fails on `main` after the merge, where the full suite runs.
7. The `CLAUDE.md` pre-approval of `Move: pure` and `Move: comments` pull requests (Merging) now
   rests on fewer green checks before the merge. The pre-approval text is not changed here.
8. The proposal gives no figure for how often a skipped gate fails on `main`. That rate is unknown.
   The series of slices will show it. The owner can withdraw the exceptions if it is high.

## Owner's decisions

This proposal rests on no entry of `docs/owner-decisions.md` and touches none. A check of
OD-1 to OD-11 on 2026-11-24 found no entry about CI, gates or merging. The proposal changes no
author-facing form, so OD-1, OD-2, OD-3, OD-5, OD-7, OD-8, OD-9, OD-10 and OD-11 do not apply. It
reverses no entry. OD-4 applies to the handling: the owner sees the before and after text above
before deciding. The owner's words of 2026-11-24 are recorded in "Why" and are not an entry.

## Why the compiler cannot do it

Not applicable: this proposal adds no author-facing name, rule, diagnostic code or surface form.
It amends the exceptions of an existing process rule (Rule 13.4) that governs which CI jobs a
pull request runs. It changes nothing a `"use typeshade"` author writes, and the compiler has no
part in it.

## What it touches

- `rules: [13.4]`. The second paragraph of Rule 13.4 gains the two exceptions above.
- `surface: []`, `exports: []`, `exports-removed: []`, `codes: []`, `examples: []`, `names: []`.
  Nothing an author or a host meets changes. The implementation adds a field to the JSON of an
  internal check, which is no export of `src/__api__/surface.md`.
- `downstream: []`. No downstream repository restates Rule 13.4 or the jobs of CI. This is an
  inference from the same finding as `0055` (2026-10-06). It is not re-searched for this draft:
  the implementer searches typeshade.github.io and vscode-typeshade for "13.4", "change scope" and
  "compile gate" before the implementing pull request, and records the result there. The site and
  the editor owe nothing known today.

Files of the implementation, commit `29f61c82` on `local/ci-scope`, not merged:

- `.github/actions/change-scope/action.yml` (new): the local action that runs the checker.
- `.github/workflows/ci.yml`: the `move` output of `change scope`, and the `if` of the jobs it gates.
- `.github/workflows/package-smoke.yml` and `.github/workflows/downstream.yml`: a `scope` job.
  Commit `29f61c82` does not yet change `concurrency`.
- `scripts/move-purity.ts`: the JSON field `declared`.
- `src/move-comments-cli.test.ts` and `src/move-purity-cli.test.ts`: tests of that field.
- `AGENTS.md` and `README.md`: the scopes, the limits and the shorter local list of a slice.
- `docs/structure-refactoring-plan.md`: section 8, item 10.

Files this proposal adds to that list:

- `.github/workflows/ci.yml`, `package-smoke.yml` and `downstream.yml`: `cancel-in-progress:
${{ github.ref != 'refs/heads/main' }}`, so a run on `main` is never cancelled.
- `docs/language-design.md`, Rule 13.4: the text above, in the implementing pull request.
- `reqs/rules/RULE-1304.md`: regenerated by `bun run reqs:sync`. The rule text changes, so the
  item's `reviewed` hash no longer matches. `python scripts/doorstop-check.py -C` then flags it.
  A person reads the new text and runs `doorstop review RULE-1304`. An agent does not clear it
  (`CLAUDE.md`, the prose follows the code). The `verification` is `test` and the `evidence` is
  `.github/workflows/ci.yml`. Both stay valid, since the workflow still carries the rule.
- `docs/language-design.md` lines 1795 and 1796 (`Derives from`, `Enforced by`) stay true.
- `ci.yml` has a `LINT.IfChange` block that names `AGENTS.md`. The implementation edits both.
  The commit `29f61c82` does that already.

Commit `29f61c82` carries `Change: none` and an open question about Rule 13.4. When this proposal
is accepted, the implementing pull request carries `Change: 0147` instead, so
`scripts/changes.ts` can check that Rule 13.4 is declared.

Required evidence for the implementation:

- A `Move: comments` pull request whose checks show `change scope`, `source and policy checks`,
  the pinned unit shards and `traceability (Doorstop)` passing and the other jobs skipped, and
  whose required checks let it merge.
- A `Move: pure` pull request that also runs the compile gate, the user journeys, one package
  smoke and the TypeNN build.
- A range that the checker refuses, which runs every job.
- A push to `main` that runs every job.
- Two pushes to `main` in quick succession, with the run of the first one not cancelled.
- `bun run reqs:sync` and `python scripts/doorstop-check.py -C` with the flagged item read by a person.

### Draft impact estimate

Known work: the files above are written in `29f61c82`, 10 files, 261 insertions and 30 deletions,
and unmerged. The remaining work is Rule 13.4's text, `bun run reqs:sync`, one person's
`doorstop review RULE-1304`, and the downstream search. Duration and cost of that work: unknown.

Compatibility: a merged slice passes fewer gates before the merge. The risks above are the cost.

Decided on 2026-11-24 (see the approval record): the exceptions stay as listed, and the render
gate stays skipped for a `Move: pure` range before the merge (risk 4).

### Independent review record

Date: 2026-11-24. Revision reviewed: commit `12ae17d3`. Reviewer: a separate agent that did not
write the proposal. The author verified each finding against the files of commit `29f61c82` and
`origin/main` before answering.

Findings that should be fixed:

1. The pinned unit shards run a selection on a pull request (`ci-unit.yml`, `affected-tests.ts
--base`), not the whole suite. Answer: fixed. "Why" and risk 6 say so, label the catch of a
   text-reading test as an inference, and say that the full suite runs on `main`. The proposed
   Rule 13.4 text claims only the named shards, so it is unchanged.
2. `concurrency` with `cancel-in-progress: true` in the three workflows can cancel a run on `main`,
   so a skipped gate may never report. Answer: fixed. The change sets `cancel-in-progress: ${{
github.ref != 'refs/heads/main' }}` in the three workflows. It is in "What changes", "What it
   touches" and the required evidence. Risk 3 keeps that a person or an agent reads the run.
3. The in-pull-request refusal of `.github/` and checker paths is no safeguard against a pull
   request that edits them. Answer: fixed in risk 1. Finding: `.github/CODEOWNERS` does list
   `/.github/`, so the reviewer's doubt about a missing entry does not hold. `scripts/move-purity.ts`
   has only the `*` entry.
4. The smoke and TypeNN rows of the table ignore the path filters. Answer: fixed. The rows say
   "when its path filter matches" and the filters are listed.

Notes:

5. The job table matches `ci.yml` of `29f61c82`. Kept.
6. The reviewer found no way to obtain `comments` or `pure` while the checker passes and behaviour
   changes, other than the lie of risk 1. Kept.
7. The required checks report in every scope through the skipped-job rule. Confirmed. Kept.
8. A pure pull request can merge on a stale base. Answer: fixed in risk 4.
9. The `CLAUDE.md` pre-approval rests on fewer checks. Answer: fixed as risk 7. Not changed here.
10. The estimate figures come from the plan. Answer: kept, as labelled in "Why".

### Approval and plan record

- Decision. [decision, owner, 2026-11-24] The orchestrating agent showed the owner in the
  conversation the before and after of Rule 13.4, the job table, the measured saving, the limits
  and its recommendation. The limits shown were: failures of skipped gates first show on `main`;
  a pull request runs its own checker; `Move: pure` skips the render gate before the merge; the
  pre-merge unit run is a selection. The recommendation was to keep the proposal as written, with
  the render gate skipped for `Move: pure`. The owner answered "추천대로 진행해주세요" (proceed as
  recommended). The merge of the pull request with `status: accepted` is the agreement.
- Render gate. The owner's answer keeps the render gate skipped for a `Move: pure` range before
  the merge (risk 4). No other open decision remains.
- Approved revision and scope. The revision of this file that the pull request merges. The scope
  is the front matter: Rule 13.4. No surface section, export, code, example or name.
- Independent review. It ran on 2026-11-24 (the record above). Its findings are answered there.
- Responsibilities and milestones. Not assigned. No schedule is agreed.
- Open at acceptance. The downstream search named under "What it touches" and the person's
  `doorstop review RULE-1304` are pending. The implementation of `29f61c82` is not merged.

### Configuration and validation record

This record does not yet apply. Delivery will require the accepted revision, the implementing
commits and pull requests, the delivered configuration, the observed results of the checks
listed under "Required evidence", and a record of each deviation from the approved text.

## What it owes downstream

Nothing known. No repository in `DOWNSTREAM_REPOS` is expected to restate Rule 13.4 or the CI
jobs. The site and the editor owe nothing: no name, rule text they quote, diagnostic code, example
or surface section changes. The implementer confirms this by the search named under "What it
touches" and records the result. A downstream pin that moves past this proposal needs no entry
in `compiler-changes.md` while `downstream` is empty.
