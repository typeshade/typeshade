---
id: '0152'
title: 'The gates run once on a merge group, and a run on main reports that result'
status: draft
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

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Change proposal `0152`, `status: draft`. The front matter is the lifecycle authority. `0152` is the next free number after `0151` on `origin/main`. No open pull request claims it (checked 2026-11-25 in the list of open pull requests).                                                                                                                                           |
| Date and attribution          | Written 2026-11-25, UTC. The date is the authoring context, not an approval. Drafted by the repository's coding agent in a session started by the orchestrating session. The measurements were read by Haiku sub-agents, and the orchestrating agent checked the key numbers (section "Measurements").                                                                               |
| Applicability / Effectivity   | `docs/language-design.md` Rule 13.4 (second paragraph, as proposal `0147` amended it; `0147` is `accepted` and its text is in the rule) and its Doorstop item `reqs/rules/RULE-1304.md`. `.github/workflows/ci.yml`, `downstream.yml`, `package-smoke.yml` and the repository ruleset of `main`. No `src/` code, surface, export, diagnostic or example. Release version unassigned. |
| Review baseline               | `origin/main` at `d28e833af4d5a7c5784abae6bef561abc1dc4b9b` (the merge of PR #1661, 2026-11-25).                                                                                                                                                                                                                                                                                     |
| Review and revision authority | The draft pull request that carries this file. Git records revisions. The owner's go-ahead in the conversation is the review (`CLAUDE.md`, Merging), and the merge of that pull request with `status: accepted` records the decision. This proposal changes approved text of `0147`, so only the owner decides it (`CLAUDE.md`, The owner's decisions).                              |

## What changes

This proposal does four things. Each one is a separate decision of the owner (section "Decisions for the owner").

1. The ruleset of `main` requires a merge queue (a `merge_queue` rule).
2. `ci.yml` gets the trigger `merge_group`. The merge group runs every gate on the tree that `main` will receive.
3. A ready pull request runs the light scope before the merge: `change scope`, `source and policy checks`, the pinned unit shards, `typecheck + unit` and `traceability (Doorstop)`. The heavy gates report `skipped` on the pull request, which the ruleset reads as success.
4. A push to `main` that a merge group already tested runs no heavy gate. Its `change scope` job reports the result of the merge group. A push that no merge group tested runs every gate, as today.

The rule that a run on `main` is never cancelled (`0147`) stays. A run on `main` still has its own `concurrency` group per commit.

**Before** (the last paragraph of the proposed text of Rule 13.4 in proposal `0147`, verbatim):

```text
Each skipped gate runs on `main` after the merge, and a run on `main` is never cancelled by a later push. A push to `main`, a manual dispatch and a release run every gate. A range that the checker refuses is an ordinary change.
```

**After** (the proposed last paragraph, and one new paragraph before it). The first sentence of the paragraph, "a push to `main` and a release run every gate" (`0055`), changes too: it reads "a push to `main` that no merge group tested, and a release", as the new text says. The implementing pull request edits that sentence with the rest.

```text
A pull request that is ready for review runs the source and policy checks, the unit shards of the pinned TypeScript version and the traceability check. The other gates run on the merge group that the merge queue builds, before the merge, and every gate runs there whatever the pull request declared (change `0152`).
A run on `main` is never cancelled by a later push. A push to `main` whose commit a merge group already tested with every gate reports that result and runs no gate again. A push to `main` that no merge group tested, a manual dispatch and a release run every gate. A range that the checker refuses is an ordinary change.
```

Effect on the limits of `0147`: its limit 2 (a failure of a skipped gate shows first on `main`) and its limit 4 (a stale base shows only on `main`) change under option A. The merge group shows both before the merge. Its limits 1, 3 and 8 stay. A `Move: comments` or `Move: pure` pull request keeps its smaller pre-queue run (`0147`). Its skipped gates run on the merge group before the merge. They no longer wait for the push to `main`. This strengthens the guarantee of `0147`, and it changes the place where the gates run.

Example of what an agent that merges sees.

- Before: the agent waits for four green required checks on the pull request head, then calls `merge_pull_request`. `main` receives a merge commit. Inference from the unequal trees: its tree is not the tree that the pull request run tested (section "Measurements", finding 5). Three workflows then run on `main`.
- After: the agent waits for the light checks, then enables auto-merge (`enable_pr_auto_merge`) or presses "Merge when ready". The queue builds a merge group, runs every gate on it and merges it. The push to `main` runs `change scope` and the two short workflows.

No author-facing name, form or example changes. No author of a `"use typeshade"` program sees a difference.

## Measurements

**Configuration.** Read on 2026-11-25 between 08:10Z and 08:35Z, with the GitHub Actions API (MCP tools `actions_list` and `actions_get`) and `git` on `origin/main` at `d28e833a`. The 40 merge commits are the first-parent chain of `origin/main`, from `921c9de6` (04:01Z) to `d28e833a` (07:46Z). The span is 3.76 hours and holds 39 intervals between the 40 merges, so the rate is 10.4 merges an hour (40 merges in the span would give 10.6). All 40 are merge commits of pull requests (`Merge pull request #N`).

**How the data were collected.** Haiku sub-agents read the runs and the jobs. Three of them used `gh api` GET calls for the job lists, which is read-only and outside the guidance of the session ("`gh` for search only"). That is a deviation, and it is closed here by this record. Three files hold job times that a sub-agent typed by hand from tool output: `downstream-main.json` (the jobs of `downstream.yml` on `main`), `downstream-pr.json` and `smoke-pr.json` (the pull request runs). The orchestrating agent compared one run of `downstream-pr.json` with the API (run `45566696071`, both jobs). The times matched within one second. No other row of the three files is compared. The group `ci` of option A uses 66.7 (the mean of the 27 full pull request runs). The run on `main` uses 66.3 (the mean of 23 runs). The two means are different samples of the same job set. Runner minutes are the sum of `completed_at - started_at` of the jobs that did not end `skipped`, for completed runs only. Cancelled, re-run and earlier runs of a pull request are not counted.

| Workflow (runs on `main`) | Completed / found | Jobs per run | Runner minutes per run, mean (min–max) | Wait from creation to first job, mean (max) | Created to last job done, mean (max) |
| ------------------------- | ----------------- | ------------ | -------------------------------------- | ------------------------------------------- | ------------------------------------ |
| `ci`                      | 23 / 40           | 19           | 66.3 (56.9–71.3)                       | 34.5 min (62.6)                             | 136 min (157)                        |
| `downstream`              | 37 / 37           | 2            | 1.7 (1.3–2.1)                          | 10.3 min (24.4)                             | not computed                         |
| `package compatibility`   | 37 / 40           | 7            | 4.6 (3.8–5.2)                          | 15.7 min (28.6)                             | not computed                         |

Seventeen `ci` runs on `main` (the 17 newest merges) were still queued at the time of reading. Three `package compatibility` runs were queued. `downstream` had no run for 3 merges (path filter).

| Workflow (last run on the pull request head) | Found | Jobs per run | Runner minutes per run, mean        | Wait, mean (max) | Created to last job done, mean (max) |
| -------------------------------------------- | ----- | ------------ | ----------------------------------- | ---------------- | ------------------------------------ |
| `ci`                                         | 40/40 | 15 or 19     | 51.0 (19 jobs: 66.7; 15 jobs: 18.3) | 10.0 min (44.4)  | 43 min (90)                          |
| `downstream`                                 | 37/40 | 2            | 1.3                                 | 8.2 min (26.6)   | not computed                         |
| `package compatibility`                      | 38/40 | 3 to 7       | 3.3                                 | 8.1 min (28.7)   | not computed                         |

Findings.

1. One merge costs 127.9 runner minutes: 55.3 on the pull request head (`51.0 + 1.3×37/40 + 3.3×38/40`) and 72.6 on `main` (`66.3 + 1.7 + 4.6`). The `ci` run on `main` is 91% of the cost on `main`.
2. The largest number of jobs in progress at one time was 20 (04:38Z, across all runs read). It was 20 in the runs on `main` alone as well, from 06:14Z. The table of job limits gives 20 concurrent jobs for the Free plan, 40 for Pro and 60 for Team (https://docs.github.com/en/actions/reference/limits). The observed ceiling equals the Free value. Inference: the account runs at 20. The plan was not checked.
3. The jobs that start in each hour sum to about 1000 runner minutes an hour (hours 04Z to 07Z: 960, 1023, 1093, 975). The capacity at 20 jobs is 1200 an hour. The model `127.9 × 10.4` gives 1330 an hour, above capacity. The runs that are not in this data (cancelled runs, re-runs, pushes to a pull request, draft `change scope` runs) add to the demand. Inference: the queue grows because demand is above capacity. The growth fits the data: the wait of a `ci` run on `main` rises from 2 minutes (04:01Z) to 48 minutes (the run created at 04:30Z), and 17 runs were queued at 08:19Z.
4. Jobs that take the most runner minutes in `ci` on `main` (total over 23 runs): the three pinned unit shards (166, 126 and 109), the three TypeScript 6 shards (158, 122 and 116), the three TypeScript 5 shards (155, 120 and 120), the compile gate (150) and the user journeys (93). The three shards `unit shard 3` are the longest single jobs (7.2, 6.9 and 6.7 minutes). `render gate` and `perf gate` are not in the first twelve.
5. Of the 40 merge commits, 0 have the same tree as the head of their pull request (`git rev-parse <merge>^{tree}` against `<merge>^2^{tree}`). Inference: every merge was made on a base that had moved. The run on `main` tests a tree that no pull request run tested.
6. Of the 40 pull requests, 11 declared `Move: comments` in a commit message, none declared `Move: pure`, and 2 edited documents only (no file outside `*.md` and `reqs/`). 27 are ordinary code changes. The scope of the run of a pull request follows the checker, not the declaration, and the data do not tell which of the 11 the checker accepted. The 13 pull request runs with 15 jobs are the light scope (18.3 runner minutes).

## Why

**Problem.** The structure refactoring merges 10 pull requests an hour. Each merge starts a full run of `ci` (66 runner minutes) on `main`, and each ready pull request has a full run of its own. The demand is above the capacity of 20 jobs. A ready pull request waits for a slot, and the wait is 43 minutes on average and up to 90 minutes before its last job is done. The runs on `main` wait 136 minutes on average.

**The cause is the cost of one merge, not one workflow.** A saving of one workflow is too small. The `ci` run on `main` is the largest part (finding 1). The run on the pull request head is the second part.

**What the gates prove today.** The run on the pull request head tests the head, and the run on `main` tests the merge. Finding 5 says that these two trees differ in all 40 cases. The merge tree is tested after it is already on `main`. A merge queue tests the merge tree before it is on `main`.

## Options

Numbers: model values from the measurements above, in runner minutes for one merge. `W` is the work of one hour at 10.4 merges, as a share of 1200 runner minutes (capacity at 20 jobs; inference, finding 2). A model value is not a measurement of the option.

| Option                                                | Runs for one merge                                                                                                   | Runner minutes for one merge                                                                                             | W at 10.4 merges an hour                               | Expected wait at 10 merges an hour                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Today                                                 | 3 workflows on the pull request, 3 on `main`                                                                         | 127.9                                                                                                                    | 111% (above capacity)                                  | The queue grows. Measured: 43 minutes mean on the pull request, 136 on `main`, 17 `ci` runs queued.                                                                                                                                                                                                                                     |
| A, merge queue, group size N=1                        | light `ci` and 2 workflows on the pull request; one full `ci` on the group; `change scope` and 2 workflows on `main` | 96.6 (`22.6 + 66.7 + 1 + 6.3`)                                                                                           | 84%                                                    | Enqueue to merge: about one `ci` wall time. The unloaded median wall time of a full `ci` run is 32.5 minutes (27 pull request runs with 19 jobs; the 13 light runs have a median of 21.0). Inference: 35 to 45 minutes. Close to capacity, so it may still queue.                                                                       |
| A, N=3                                                | as above, one full `ci` for three merges                                                                             | 52.1 (`22.6 + 66.7/3 + 1 + 6.3`)                                                                                         | 45%                                                    | Up to the wait for the group (set at most 10 minutes) plus 35 to 45 minutes. Inference: stable.                                                                                                                                                                                                                                         |
| A, N=4                                                | as above                                                                                                             | 46.6                                                                                                                     | 40%                                                    | As N=3.                                                                                                                                                                                                                                                                                                                                 |
| B, skip on `main` when the tree equals the head tree  | unchanged                                                                                                            | 127.9, saving 0                                                                                                          | 111%                                                   | Unchanged. The condition held for 0 of 40 merges (finding 5). It holds only if each pull request is up to date with `main` at the merge, which a merge queue gives, and which "require branches to be up to date" gives at the price that each merge forces every other pull request to update and run again (inference, not measured). |
| C, one waiting run on `main`, default `queue: single` | one running and one pending `ci` run on `main`. A newer pending run replaces the older one.                          | about 73 (`55.3 + 11.3 + 6`), where 11.3 is 66.3 times 0.17 runs per merge (about 1.8 runs an hour from a 33-minute run) | about 63%                                              | Pull requests wait about their own wall time (median 32.5 minutes). About 8 of 10 commits on `main` get no run of their own.                                                                                                                                                                                                            |
| C with `queue: max`                                   | every commit queues, runs serially                                                                                   | 73, but the line is serial                                                                                               | not applicable                                         | 1.8 runs an hour against 10.4 arrivals: the queue grows by about 8.6 runs an hour. Worse than today.                                                                                                                                                                                                                                    |
| D, batches of k pull requests                         | unchanged per merge                                                                                                  | 127.9 per merge, fewer merges                                                                                            | k=2: 55% (5.2 merges an hour). k=3: 37% (3.5 an hour). | k=2 is the smallest batch under 70%. Inference: the queue drains at k=2 and above.                                                                                                                                                                                                                                                      |

Which guarantee of `0147` each option keeps.

| Option | A run on `main` is never cancelled                                                                                                                                                    | A skipped gate runs for the commit before it is trusted                                                                         | What it changes in the approved text of `0147`                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| A      | Kept.                                                                                                                                                                                 | Strengthened. The gates skipped on the pull request run on the merge group, before the merge, on the tree that `main` receives. | The sentence "Each skipped gate runs on `main` after the merge" becomes "on the merge group before the merge". The Rule 13.4 text above. |
| B      | Kept.                                                                                                                                                                                 | Weaker. A gate that ran on the head is not run again on a tree that equals it. For 0 of 40 merges the condition held.           | One sentence of the rule.                                                                                                                |
| C      | Changed. A pending run is replaced, which GitHub calls cancelled (https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency). | Weaker. A skipped gate of a `Move: comments` commit runs only if its commit is the one that gets a run.                         | The rule "never cancelled" is reversed. This is an amendment of approved text. It is not recommended.                                    |
| D      | Kept.                                                                                                                                                                                 | Unchanged.                                                                                                                      | None.                                                                                                                                    |

What the owner must change in the settings, and what changes for an agent that merges.

| Option | Repository settings (owner only)                                                                                  | An agent that merges                                                                                         | What can go wrong                                                                                                                                                      |
| ------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | Add the `merge_queue` rule to the ruleset of `main`. Script below.                                                | Enables auto-merge or presses "Merge when ready". It no longer calls `merge_pull_request` as a bypass actor. | See "Risks and limits".                                                                                                                                                |
| B      | None, if no condition is needed. A condition needs a change to the ruleset ("require branches to be up to date"). | Updates the branch before each merge.                                                                        | A rebase storm at 10 merges an hour.                                                                                                                                   |
| C      | None.                                                                                                             | Unchanged.                                                                                                   | Commits of `main` without a run. A failure found on a later commit needs a bisect.                                                                                     |
| D      | None.                                                                                                             | Opens fewer pull requests, each with k times the work.                                                       | A larger pull request fails review or a check as a whole. The affected tests of a larger pull request are more. The run time of a large pull request was not measured. |

## Recommendation

A sequence of two, in this order.

1. **D now.** It needs no setting and no change of approved text. It changes the practice of `docs/structure-slice-playbook.md` ("Local first, few pull requests"): a batch is at least 3 pull requests of work, so that the rate is at most 3.5 merges an hour. The queue of 17 `ci` runs on `main` then drains. The playbook already asks for few pull requests. It gives no number.
2. **A after a trial.** A removes the cost that D cannot: 73 of 128 runner minutes for a merge and the untested merge tree (finding 5). It needs the owner's setting and an amendment of `0147`.

B alone saves nothing today. C reverses an approved rule of `0147`, so this proposal does not recommend it. A is the option that keeps the rule and moves the gates.

## Risks and limits

These are the limits of option A.

1. Whether the merge queue is available for this repository was not checked. The page "Managing a merge queue" gives no plan or ownership requirement (https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue). The repository `typeshade/typeshade` is public (read from the repository list on 2026-11-25). Whether the owner of the repository is an organization was not checked.
2. Every required check must report on the `merge_group` event, or the merge fails because the check never reports (the same page, and https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows). `ci.yml` has no `merge_group` trigger today. The required check names are `typecheck + unit`, `traceability (Doorstop)`, `compile gate (Tint + WebGL2)` and `user journeys (packed tarball, WebGPU)`, and they keep their names.
3. How the jobs behave on `merge_group`, read from `ci.yml` at `d28e833a`, not from a run. The step `diff` of `change scope` sets `code=true` for every event except `pull_request`. The step `move` runs only on a `pull_request`, so `move` is `none`. The `draft` output reads `github.event.pull_request.draft`, which is empty on `merge_group`, so it is `false`. Result: every job runs on a merge group, as it does on a push to `main`. The five steps of `quality` that are `if: github.event_name == 'pull_request'` (documentation impact, `LINT.IfChange` pairs, change proposal, move purity, rule citation) do not run on the merge group. They stay on the pull request. In `downstream.yml` and `package-smoke.yml` the `move scope` job runs the checker only on a `pull_request`. Neither workflow has a `merge_group` trigger, so neither runs on a merge group. They stay on the push to `main`, 6.3 runner minutes for one merge. Neither is a required check.
4. A merge group that holds only documents still runs every gate, as a push to `main` does. Proposal `0055` gives documents-only pull requests a light scope. The proposal does not extend it to the merge group (decision D4 below).
5. Whether the `main` commit after the queue has the same SHA as the merge group was not checked. The design needs it, so that the `change scope` job on `main` can find a successful merge group run for `github.sha`. The documentation does not say (the page lists the branches of the queue as "temporary branches" and does not say whether `main` takes the tested commit). Trial T2 checks it.
6. Whether a bypass actor can skip the queue was not checked. The page says that an administrator can "directly merge" with "bypass branch protections" and does not say whether the queue is skipped. The REST page gives `bypass_mode` values `always`, `pull_request` and `exempt` (https://docs.github.com/en/rest/repos/rules). Trial T3 checks it. `CLAUDE.md` (Merging) lets an agent bypass only the review requirement, on the owner's go-ahead. How the agent keeps that is open until T3.
7. Whether `enable_pr_auto_merge` puts a pull request in the queue was not checked. The documentation says that "Merge when ready" turns on auto-merge when the pull request cannot enter the queue at once, and that auto-merge needs the repository setting only on a branch without a queue (https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request). The documentation names the GraphQL mutation `enqueuePullRequest` for an immediate add. Trial T4 checks the MCP tool.
8. The queue settings are starting values. The measurements give no value for them. `grouping_strategy: ALLGREEN` makes every pull request in a group pass. A failing group is removed and its entries are tested again, which costs more runs than the model counts.
9. A queue adds a wait of up to `min_entries_to_merge_wait_minutes` for a lone pull request, plus one run of `ci` (35 to 45 minutes, inference). The wait of a ready pull request does not shrink for a single pull request. The gain is the capacity.
10. The ruleset, the queue and the plan are the owner's. An agent has no admin access.
11. The data cover one 3.76-hour window of one day. The rate of 10.4 merges an hour is the rate of the refactoring, not a general rate.

## Owner's decisions

This proposal rests on no entry of `docs/owner-decisions.md` and touches none. A check of OD-1 to OD-11 on 2026-11-25 found no entry about CI, gates or merging. OD-1, OD-2, OD-3, OD-5, OD-7, OD-8, OD-9, OD-10 and OD-11 are about the language and do not apply. OD-6 (nothing is released) does not apply: no release or published build depends on this change. The proposal reverses no entry. OD-4 applies to the handling: the owner sees the options with their costs before deciding.

### Decisions for the owner

- D1. Add the `merge_queue` rule to the ruleset of `main`, after the trial (Trials, below).
- D2. Amend the sentence of `0147` "Each skipped gate runs on `main` after the merge" as the text above says.
- D3. How an agent merges under the queue: auto-merge on the owner's go-ahead, or a direct merge by a bypass actor if T3 shows that it skips the queue.
- D4. Whether a merge group of documents only runs a light scope. Recommendation: no, in the first version. Every gate runs, as on a push to `main`.
- D5. Whether to set the batch rule of the playbook to at least 3 pull requests now (the recommendation, step 1).

## Why the compiler cannot do it

Not applicable: this proposal adds no author-facing name, rule of the language, diagnostic code or surface form. It changes where CI runs its gates (Rule 13.4), and the compiler has no part in it.

## What it touches

- `rules: [13.4]`. The second paragraph of Rule 13.4 gains the text above, and the last paragraph of `0147` changes.
- `surface: []`, `exports: []`, `exports-removed: []`, `codes: []`, `examples: []`, `names: []`. Nothing an author or a host meets changes.
- `downstream: []`. No downstream repository restates Rule 13.4 or the CI jobs. This is an inference from the finding of `0055` and `0147`. The implementer repeats the search that `0147` names before the implementing pull request.

Files of the implementation. None is changed by this proposal.

- `.github/workflows/ci.yml`: the trigger `merge_group` with `types: [checks_requested]`. `change scope` gets an output `tested`, true on a push to `main` when a successful `ci` run of the event `merge_group` exists for `github.sha`. Every gate job gets `tested != 'true'` in its `if`. A ready pull request gets the light scope for the heavy gates, with the same skipped-job rule as `0147`. The `LINT.IfChange` block of `ci.yml` names `AGENTS.md`, so `AGENTS.md` changes with it.
- `.github/workflows/downstream.yml`, `.github/workflows/package-smoke.yml`: no change to the triggers. The implementer reads their `scope` jobs again for `merge_group`.
- `docs/language-design.md` Rule 13.4 and `reqs/rules/RULE-1304.md` (regenerated by `bun run reqs:sync`; a person runs `doorstop review RULE-1304`, an agent does not clear it).
- `AGENTS.md` (Tests and CI) and `CLAUDE.md` (Merging, Waiting on a pull request): the merge step, and the rule that a pull request is "ready" for the light scope.
- `docs/structure-slice-playbook.md`: the batch rule of step 1 of the recommendation.
- The ruleset of `main`: the owner's change only.

Required evidence for the implementation. Each item is a future result, not a completed one.

- Trial T1: a documents-only pull request runs the light scope, enters the queue, and the merge group run reports the four required checks.
- Trial T2: the SHA of `main` after a queue merge equals the SHA of the merge group, and the push run on `main` takes the `tested` path.
- Trial T3: whether a bypass actor skips the queue, and whether the review requirement still holds.
- Trial T4: `enable_pr_auto_merge` of the MCP tools enters a pull request in the queue.
- A push to `main` with no merge group runs every gate.
- Two pushes to `main` in quick succession: the first run is not cancelled.
- A failing merge group: the pull request leaves the queue and `main` does not move.
- `bun run reqs:sync`, `python scripts/doorstop-check.py -C` and `bun run docs:impact` with the flagged items read by a person.

### Script for the owner (PowerShell, GitHub CLI)

This script changes the repository ruleset. It is the owner's to run, and an agent does not run it. It has two steps that cannot be undone by this text alone: the PUT replaces the ruleset. The script saves the old ruleset first, and the second block restores it.

1. Run `gh auth login` once. Never paste a token in the conversation.
2. Run the script.
3. Open Settings > Rules > Rulesets > `main` and read the new rule.
4. Open a documents-only pull request and read the trials T1 to T4 above.
5. If the queue is not available for the repository, the PUT fails with an error. Send the error text to the agent.
6. To roll back, run the second block, which restores the saved file `ruleset-main-backup.json`.

```powershell
$ErrorActionPreference = 'Stop'
$repo = 'typeshade/typeshade'
$sets = gh api "repos/$repo/rulesets" | ConvertFrom-Json
$id = ($sets | Where-Object { $_.name -eq 'main' } | Select-Object -First 1).id
if (-not $id) { throw 'No ruleset named main. Read the names: gh api repos/typeshade/typeshade/rulesets' }
$raw = gh api "repos/$repo/rulesets/$id"
if ($LASTEXITCODE -ne 0) { throw 'Cannot read the ruleset.' }
[IO.File]::WriteAllText("$PWD\ruleset-main-backup.json", ($raw -join "`n"), (New-Object Text.UTF8Encoding($false)))
$rs = ($raw -join "`n") | ConvertFrom-Json
$queue = @{
  type = 'merge_queue'
  parameters = @{
    check_response_timeout_minutes    = 90
    grouping_strategy                 = 'ALLGREEN'
    max_entries_to_build              = 2
    max_entries_to_merge              = 4
    merge_method                      = 'MERGE'
    min_entries_to_merge              = 2
    min_entries_to_merge_wait_minutes = 10
  }
}
$rules = @($rs.rules | Where-Object { $_.type -ne 'merge_queue' }) + $queue
$body = @{
  name          = $rs.name
  target        = $rs.target
  enforcement   = $rs.enforcement
  conditions    = $rs.conditions
  bypass_actors = $rs.bypass_actors
  rules         = $rules
} | ConvertTo-Json -Depth 20
$body | gh api -X PUT "repos/$repo/rulesets/$id" --input -
if ($LASTEXITCODE -ne 0) { throw 'The PUT failed. The ruleset is unchanged. Send the error text to the agent.' }
```

The rollback is a second block. Run it only when step 6 says so.

```powershell
$ErrorActionPreference = 'Stop'
$repo = 'typeshade/typeshade'
$id = ((gh api "repos/$repo/rulesets" | ConvertFrom-Json) | Where-Object { $_.name -eq 'main' } | Select-Object -First 1).id
$old = Get-Content "ruleset-main-backup.json" -Raw | ConvertFrom-Json
@{ name=$old.name; target=$old.target; enforcement=$old.enforcement; conditions=$old.conditions; bypass_actors=$old.bypass_actors; rules=$old.rules } | ConvertTo-Json -Depth 20 | gh api -X PUT "repos/$repo/rulesets/$id" --input -
```

The field names and limits of `merge_queue` come from https://docs.github.com/en/rest/repos/rules: `check_response_timeout_minutes` 1 to 360, `grouping_strategy` `ALLGREEN` or `HEADGREEN`, `max_entries_to_build` 0 to 100, `max_entries_to_merge` 0 to 100, `merge_method` `MERGE`, `SQUASH` or `REBASE`, `min_entries_to_merge` 0 to 100, `min_entries_to_merge_wait_minutes` 0 to 360. The page gives no default. The values in the script are starting values chosen from the measurements: a group of at most 4 gives at most 2.6 groups an hour at 10.4 merges, and the wall time of one `ci` run is 30 to 45 minutes. The script was not run, and no `pwsh` was available to parse it. It targets Windows PowerShell 5.1 and later. The `GET` response may hold fields that the `PUT` body does not accept (for example an `id` inside `rules`). Not checked: if the `PUT` is refused, remove the named field and run again. The script is untested.

### What was not checked

- The plan of the account and whether the queue is available. The concurrent-job ceiling of 20 is observed, and the Free value is from the documentation.
- The push to `main` after a queue merge: its SHA, and whether `push` workflows run (the two pages do not say).
- Whether a bypass actor skips the queue, and whether `enable_pr_auto_merge` enters the queue.
- Whether a merge group that the queue rebuilds can be cancelled. A `merge_group` ref is not `refs/heads/main`, so `cancel-in-progress` is `true` for it in the `concurrency` of `ci.yml`. The behaviour of a rebuilt group was not checked.
- Closed by reading the YAML: `github.base_ref` is used only on a `pull_request` in the step `diff` (`ci.yml`) and in `ci-unit.yml`. A merge group runs the full unit suite there, as a push to `main` does.
- Whether the minutes cost money. The repository is public. Public repositories have no charge for standard runners; this was not checked on a GitHub page. The limit that binds is the number of concurrent jobs.
- The run time of a pull request of a larger batch (option D).
- The speculative re-builds of a queue with `max_entries_to_build` above 1.
- `downstream` and `package compatibility` times from creation to the last job: not computed.

### Draft impact estimate

Known work: a `merge_group` trigger, one new output of `change scope`, one condition on each gate job, text in Rule 13.4, `AGENTS.md`, `CLAUDE.md` and the playbook, and the regeneration of one Doorstop item. Duration and cost of that work: unknown. Compatibility: a merge goes through a queue, and an agent changes how it merges. The decisions D1 to D5 must be resolved before acceptance.

### Independent review record

Date: 2026-11-25. Revision reviewed: commit `4be76d44` of this file. Reviewer: a Sonnet sub-agent that did not write the proposal. It recomputed the tables from the data files and read the three workflow files. Findings and answers:

1. The rate: 40 merges in 3.76 hours is 10.6, and 10.4 counts 39 intervals. Fixed: the text says so. The model keeps 10.4.
2. The option A, N=3 cost is 52.1, not 52.2. Fixed.
3. "The two shards" named three. Fixed.
4. The 48-minute wait belongs to the run created at 04:30Z, not 04:36Z. Fixed.
5. The 20-job maximum on `main` alone holds only from 06:14Z. Fixed.
6. The unloaded wall time mixed light and full runs. Fixed: 32.5 minutes for the full run, 21.0 for the light one.
7. The group `ci` uses 66.7 and the run on `main` uses 66.3. Fixed: the text names the two samples.
8. The `github.base_ref` item can be closed, and `ci-unit.yml` was missing. Fixed.
9. `concurrency` of a `merge_group` ref cancels in progress. Fixed: added to "What was not checked".
10. The first paragraph of Rule 13.4 conflicts with the new text. Fixed: the After block names it.
11. The limits 2 and 4 of `0147` change under option A. Fixed: stated in "What changes". The effectivity line says that `0147` is accepted.
12. OD-6 was not named. Fixed.
13. `CLAUDE.md` Merging is affected. Kept: decision D3 and the list of files cover it. The reviewer found no silent reversal.
14. Terms vary ("merge group" and "queue", "light scope" and "pre-queue run", "pull request head" and "head"). Open: the next revision unifies them.
15. Two inferences were unlabelled. Fixed.
16. STE: about 20 sentences exceed 25 words. Open: the next revision splits them.
17. The rollback ran at once after the PUT, a failing `gh` call did not stop the script, and `Out-File` writes a BOM in Windows PowerShell 5.1. Fixed: the rollback is a second block, `$ErrorActionPreference` is `Stop`, the exit code is checked and the backup is written without a BOM.
18. The reviewer could not check the documentation claims, the plan limit, the typed times beyond one row, and the script by running it. These stay in "What was not checked".

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decisions D1 to D5, the independent review, and the merge of this file with `status: accepted`. No approval, schedule or responsibility is recorded here.

### Configuration and validation record

This record does not yet apply. Delivery will require the accepted revision, the implementing commits and pull requests, the delivered configuration, the observed results of the trials T1 to T4 and of the evidence listed above, and a record of each deviation from the approved text.

## What it owes downstream

Nothing known. No repository in `DOWNSTREAM_REPOS` is expected to restate Rule 13.4 or the CI jobs. The implementer confirms this with the search named under "What it touches" and records the result.
