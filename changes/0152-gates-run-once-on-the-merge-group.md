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
3. A ready pull request runs the light scope before the merge: `change scope`, `source and policy checks`, the pinned unit shards, `typecheck + unit` and `traceability (Doorstop)`. The heavy gates report `skipped` on the pull request, which the ruleset reads as success. This comes from `0055` and `0147` and the header of `ci.yml`. A GitHub page was not read for it.
4. A push to `main` that a merge group already tested runs no heavy gate. Its `change scope` job reports the result of the merge group. A push that no merge group tested runs every gate, as today.

The rule that a run on `main` is never cancelled (`0147`) stays. A run on `main` still has its own `concurrency` group per commit.

**Before** (the last paragraph of the proposed text of Rule 13.4 in proposal `0147`, verbatim):

```text
Each skipped gate runs on `main` after the merge, and a run on `main` is never cancelled by a later push. A push to `main`, a manual dispatch and a release run every gate. A range that the checker refuses is an ordinary change.
```

**After** (the proposed last paragraph, and one new paragraph before it). The first paragraph of the rule says "a push to `main` and a release run every gate" (`0055`). That sentence changes too. It reads "a push to `main` that no merge group tested, and a release", as the new text says. The implementing pull request edits it with the rest.

```text
A pull request that is ready for review runs the source and policy checks, the unit shards of the pinned TypeScript version and the traceability check. The other gates run on the merge group that the merge queue builds, before the merge, and every gate runs there whatever the pull request declared (change `0152`).
A run on `main` is never cancelled by a later push. A push to `main` whose commit a merge group already tested with every gate reports that result and runs no gate again. A push to `main` that no merge group tested, a manual dispatch and a release run every gate. A range that the checker refuses is an ordinary change.
```

Effect on the limits of `0147`: limit 2 and limit 4 change under option A. Limit 2 says that a failure of a skipped gate shows first on `main`. Limit 4 says that a stale base shows only on `main`. The merge group shows both before the merge. Its limits 1, 3 and 8 stay. A `Move: comments` or `Move: pure` pull request keeps its smaller run (`0147`). Its skipped gates run on the merge group before the merge. They no longer wait for the push to `main`. This strengthens the guarantee of `0147`, and it changes the place where the gates run.

Example of what an agent that merges sees.

- Before: the agent waits for four green required checks on the pull request head, then calls `merge_pull_request`. `main` receives a merge commit. Inference from the unequal trees: its tree is not the tree that the pull request run tested (section "Measurements", finding 5). Three workflows then run on `main`.
- After: the agent waits for the light checks, then enables auto-merge (`enable_pr_auto_merge`) or presses "Merge when ready". The merge queue builds a merge group, runs every gate on it and merges it. The push to `main` runs `change scope` and the two short workflows.

No author-facing name, form or example changes. No author of a `"use typeshade"` program sees a difference.

## Measurements

**Configuration.** Read on 2026-11-25 between 08:10Z and 08:35Z, with the GitHub Actions API (MCP tools `actions_list` and `actions_get`) and `git` on `origin/main` at `d28e833a`. The 40 merge commits are the first-parent chain of `origin/main`, from `921c9de6` (04:01Z) to `d28e833a` (07:46Z). The span is 3.76 hours. It holds 39 intervals between the 40 merges, so the rate is 10.4 merges an hour. A count of 40 merges would give 10.6. All 40 are merge commits of pull requests (`Merge pull request #N`).

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
2. The largest number of jobs in progress at one time was 20 (04:38Z, across all runs read). It was 20 in the runs on `main` alone as well, from 06:14Z. The table of job limits gives 20 concurrent jobs for Free, 40 for Pro and 60 for Team (https://docs.github.com/en/actions/reference/limits). The observed ceiling equals the Free value. Inference: the account runs at 20. The plan was not checked.
3. The jobs that start in each hour sum to about 1000 runner minutes an hour (hours 04Z to 07Z: 960, 1023, 1093, 975). The capacity at 20 jobs is 1200 an hour. The model `127.9 × 10.4` gives 1330 an hour, above capacity. The runs that are not in this data (cancelled runs, re-runs, pushes to a pull request, draft `change scope` runs) add to the demand. Inference: the backlog grows because demand is above capacity. The growth fits the data. The wait of a `ci` run on `main` rises from 2 minutes (04:01Z) to 48 minutes (the run created at 04:30Z). 17 runs were queued at 08:19Z.
4. These jobs take the most runner minutes in `ci` on `main` (total over 23 runs). The three pinned unit shards: 166, 126 and 109. The three TypeScript 6 shards: 158, 122 and 116. The three TypeScript 5 shards: 155, 120 and 120. The compile gate: 150. The user journeys: 93. The three shards `unit shard 3` are the longest single jobs (7.2, 6.9 and 6.7 minutes). `render gate` and `perf gate` are not in the first twelve.
5. Of the 40 merge commits, 0 have the same tree as the head of their pull request (`git rev-parse <merge>^{tree}` against `<merge>^2^{tree}`). Inference: every merge was made on a base that had moved. The run on `main` tests a tree that no pull request run tested.
6. Of the 40 pull requests, 11 declared `Move: comments` in a commit message, none declared `Move: pure`, and 2 edited documents only (no file outside `*.md` and `reqs/`). 27 are ordinary code changes. The scope of a pull request run follows the checker, not the declaration. The data do not tell which of the 11 the checker accepted. The 13 pull request runs with 15 jobs are the light scope (18.3 runner minutes).

## Why

**Problem.** The structure refactoring merges 10 pull requests an hour. Each merge starts a full run of `ci` (66 runner minutes) on `main`, and each ready pull request has a full run of its own. The demand is above the capacity of 20 jobs. A ready pull request waits for a slot. From creation to its last job, a run takes 43 minutes on average and up to 90 minutes. The runs on `main` wait 136 minutes on average.

**The cause is the cost of one merge, not one workflow.** A saving of one workflow is too small. The `ci` run on `main` is the largest part (finding 1). The run on the pull request head is the second part.

**What the gates prove today.** The run on the pull request head tests the head, and the run on `main` tests the merge. Finding 5 says that these two trees differ in all 40 cases. The merge tree is tested after it is already on `main`. A merge queue tests the merge tree before it is on `main`.

## Options

Numbers: model values from the measurements above, in runner minutes for one merge. `W` is the work of one hour at 10.4 merges, as a share of 1200 runner minutes (capacity at 20 jobs; inference, finding 2). A model value is not a measurement of the option.

| Option                                                            | Runs for one merge                                                                                                   | Runner minutes for one merge                                                                                             | W at 10.4 merges an hour                               | Expected wait at 10 merges an hour                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Today                                                             | 3 workflows on the pull request, 3 on `main`                                                                         | 127.9                                                                                                                    | 111% (above capacity)                                  | The backlog grows. Measured: 43 minutes mean on the pull request, 136 on `main`, 17 `ci` runs queued.                                                                                                                                                                                                                                   |
| A, merge queue, group size N=1                                    | light `ci` and 2 workflows on the pull request; one full `ci` on the group; `change scope` and 2 workflows on `main` | 96.6 (`22.6 + 66.7 + 1 + 6.3`)                                                                                           | 84%                                                    | Enqueue to merge: about one `ci` wall time. The unloaded median wall time of a full `ci` run is 32.5 minutes (27 pull request runs with 19 jobs; the 13 light runs have a median of 21.0). Inference: 35 to 45 minutes. Close to capacity, so it may still queue.                                                                       |
| A, N=3                                                            | as above, one full `ci` for three merges                                                                             | 52.1 (`22.6 + 66.7/3 + 1 + 6.3`)                                                                                         | 45%                                                    | Up to the wait for the group (set at most 10 minutes) plus 35 to 45 minutes. Inference: stable.                                                                                                                                                                                                                                         |
| A, N=4                                                            | as above                                                                                                             | 46.6                                                                                                                     | 40%                                                    | As N=3.                                                                                                                                                                                                                                                                                                                                 |
| B, skip on `main` when the tree equals the pull request head tree | unchanged                                                                                                            | 127.9, saving 0                                                                                                          | 111%                                                   | Unchanged. The condition held for 0 of 40 merges (finding 5). It holds only if each pull request is up to date with `main` at the merge, which a merge queue gives, and which "require branches to be up to date" gives at the price that each merge forces every other pull request to update and run again (inference, not measured). |
| C, one waiting run on `main`, default `queue: single`             | one running and one pending `ci` run on `main`. A newer pending run replaces the older one.                          | about 73 (`55.3 + 11.3 + 6`), where 11.3 is 66.3 times 0.17 runs per merge (about 1.8 runs an hour from a 33-minute run) | about 63%                                              | Pull requests wait about their own wall time (median 32.5 minutes). About 8 of 10 commits on `main` get no run of their own.                                                                                                                                                                                                            |
| C with `queue: max`                                               | every commit queues, runs serially                                                                                   | 73, but the line is serial                                                                                               | not applicable                                         | 1.8 runs an hour against 10.4 arrivals: the backlog grows by about 8.6 runs an hour. Worse than today.                                                                                                                                                                                                                                  |
| D, batches of k pull requests                                     | unchanged per merge                                                                                                  | 127.9 per merge, fewer merges                                                                                            | k=2: 55% (5.2 merges an hour). k=3: 37% (3.5 an hour). | k=2 is the smallest batch under 70%. Inference: the backlog drains at k=2 and above.                                                                                                                                                                                                                                                    |

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
| A      | Add the `merge_queue` rule to the ruleset of `main`. Script 3, after a trial.                                     | Enables auto-merge or presses "Merge when ready". It no longer calls `merge_pull_request` as a bypass actor. | See "Risks and limits".                                                                                                                                                |
| B      | None, if no condition is needed. A condition needs a change to the ruleset ("require branches to be up to date"). | Updates the branch before each merge.                                                                        | A rebase storm at 10 merges an hour.                                                                                                                                   |
| C      | None.                                                                                                             | Unchanged.                                                                                                   | Commits of `main` without a run. A failure found on a later commit needs a bisect.                                                                                     |
| D      | None.                                                                                                             | Opens fewer pull requests, each with k times the work.                                                       | A larger pull request fails review or a check as a whole. The affected tests of a larger pull request are more. The run time of a large pull request was not measured. |

## Recommendation

Three phases, in this order. Each phase ends before the next one starts.

**Phase 0. Larger batches (option D). Decided, no approval needed.** It changes no approved text and no setting. This is a decision of the orchestrating session of 2026-11-25. It is not an entry of the owner. A batch is at least three slices in one pull request. Each session has one ready pull request at a time and at most one merge in 90 minutes. The text of `docs/structure-slice-playbook.md` belongs to the tooling session (`session_017fz53QE4PQaF3JDLrqDKWC`). This proposal does not edit it. At 3 slices a batch the rate is at most 3.5 merges an hour, which is 37% of capacity (model, section "Options").

**Phase 1. A trial that touches neither `main` nor its ruleset.** An agent session runs it on the branch `ci-trial`. A second ruleset targets only that branch. Section "Phase 1, the trial" gives the steps, the cost and the limits.

**Phase 2. The change on `main`, after the owner has read the observed results.** The owner decides D1 to D4. The order never leaves `main` with a merge queue and no trigger. Section "Phase 2, the order on `main`" gives it.

Option A removes what option D cannot: 73 of 128 runner minutes for a merge, and the untested merge tree (finding 5). It also has a second reason. Inference from finding 5: the merge group tests the tree that `main` receives. Two pull requests that each pass alone and fail together fail in the merge group. They do not fail on `main`. The bundle budget race of `CLAUDE.md` (Merging) is such a case.

Option B alone saves nothing today. Option C reverses an approved rule of `0147`, so this proposal does not recommend it.

## Risks and limits

These are the limits of option A.

1. Whether the `merge_queue` rule type is available for this repository is open. The page "Managing a merge queue" gives no plan or ownership requirement (https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue). The page on rulesets says that rulesets are for "GitHub Team and GitHub Enterprise plans" (https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets; one fetch, not confirmed). The orchestrating session read the live repository on 2026-11-25: the owner type is `Organization`, the repository is public, and the ruleset `main` exists. I did not read these. The `POST` of script 1 answers the open point at no cost.
2. Every required check must report on the `merge_group` event. Otherwise the merge fails, because the check never reports (the same page, and https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows). A workflow that a branch filter skips leaves its checks "Pending". A pull request that requires them cannot merge (https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax). `ci.yml` has no `merge_group` trigger today. So the trigger must reach `main` before the rule does (Phase 2). The four required checks are `typecheck + unit`, `traceability (Doorstop)`, `compile gate (Tint + WebGL2)` and `user journeys (packed tarball, WebGPU)`. They keep their names.
3. The documentation does not say which file a `merge_group` run reads. The events page gives `GITHUB_SHA` as "SHA of the merge group" and says nothing about the workflow file. It does not say it for `pull_request` either. Not checked. Trial result T0 observes it.
4. How the jobs behave on `merge_group`. Read from `ci.yml` at `d28e833a`, not from a run. The step `diff` of `change scope` sets `code=true` for every event except `pull_request`. The step `move` runs only on a `pull_request`, so `move` is `none`. The `draft` output reads `github.event.pull_request.draft`. It is empty on `merge_group`, so it is `false`. Result: every job runs on a merge group, as on a push to `main`.
5. Five steps of `quality` carry `if: github.event_name == 'pull_request'`: documentation impact, `LINT.IfChange` pairs, change proposal, move purity and rule citation. They do not run on the merge group. They stay on the pull request.
6. In `downstream.yml` and `package-smoke.yml` the `move scope` job runs the checker only on a `pull_request`. Neither workflow has a `merge_group` trigger, so neither runs on a merge group. They stay on the push to `main`, 6.3 runner minutes for one merge. Neither is a required check.
7. A merge group of documents only still runs every gate, as a push to `main` does. Proposal `0055` gives documents-only pull requests a light scope. The proposal does not extend it to the merge group (decision D4).
8. Whether the `main` commit after a merge queue merge has the SHA of the merge group was not checked. The design needs it. The `change scope` job on `main` looks for a successful merge group run at `github.sha`. The page names the branches of the merge queue "temporary branches". It does not say that `main` takes the tested commit. Trial result T2 observes it. If the SHAs differ, `tested` stays false, and the run on `main` is a full run as today.
9. Whether the REST `merge_pull_request` by a bypass actor passes the merge queue is open. The documentation confirms that an administrator can merge directly in the web UI, with a checkbox and under branch protection rules (https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/merging-a-pull-request-with-a-merge-queue; one fetch reported it, a second did not confirm it). It is silent on rulesets, on `bypass_mode` and on the REST call. The REST page gives the `bypass_mode` values `always`, `pull_request` and `exempt` (https://docs.github.com/en/rest/repos/rules). The trial shows it as result T7, because script 1 copies the bypass actors of `main` into the trial ruleset. The first merge of Phase 2 shows it again on `main`. `CLAUDE.md` (Merging) lets an agent bypass only the review requirement, on the owner's go-ahead. The agent's way to keep that rule is open until then.
10. Whether `enable_pr_auto_merge` puts a pull request in the merge queue was not checked. The documentation says that the setting "Allow auto-merge" does not apply to a branch that requires a merge queue, and that "Merge when ready" can enable auto-merge on such a branch even when the setting is off (https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository). Those sentences are about the web UI. The GraphQL page lists `enqueuePullRequest` ("Add a pull request to the merge queue") and `enablePullRequestAutoMerge` (https://docs.github.com/en/graphql/reference/pulls). The orchestrating session reports `allow_auto_merge` as false today. Which call the MCP tool makes was not checked. Trial result T3 observes it, in both states of the pull request.
11. The queue settings are starting values. The measurements give no value for them. With `grouping_strategy: ALLGREEN`, every pull request in a group must pass. A failing group is removed and its entries are tested again. That costs more runs than the model counts.
12. A merge queue adds a wait for a lone pull request: at most `min_entries_to_merge_wait_minutes`, plus one `ci` run (35 to 45 minutes, inference). The gain is capacity, not the wait of one pull request.
13. A `merge_group` ref is not `refs/heads/main`, so `cancel-in-progress` is `true` for it in the `concurrency` of `ci.yml`. The behaviour of a rebuilt group was not checked.
14. The ruleset, the queue and the plan are the owner's. An agent has no admin access.
15. The data cover one window of 3.76 hours. The rate of 10.4 merges an hour is the rate of the refactoring, not a general rate.
16. A called workflow cannot hold more permissions than its caller. The reuse page says: "permissions can only be maintained or reduced—not elevated—throughout the chain" (https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows). The sentence is in the note on nested workflows. The page does not state the direct case in those words. The workflow-syntax page says that permissions not specified in a `permissions` key are set to `none` (https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax). Whether `actions: read` is the permission that lists workflow runs was not confirmed on that page. Not checked. `publish.yml` calls `ci.yml` under `contents: read`, so the plan gives `verify` both permissions (section "What it touches").
17. The REST contract of `bypass_actors`: the documentation returns the property only to a user with write access to the ruleset (https://docs.github.com/en/rest/repos/rules). Scripts 1 and 3 stop when it comes back null, so that a `PUT` does not drop the bypass actor that the agents rely on.

## Owner's decisions

This proposal rests on no entry of `docs/owner-decisions.md` and touches none. A check of OD-1 to OD-11 on 2026-11-25 found no entry about CI, gates or merging. OD-1, OD-2, OD-3, OD-5, OD-7, OD-8, OD-9, OD-10 and OD-11 are about the language and do not apply. OD-6 (nothing is released) does not apply, because no release or published build depends on this change. The proposal reverses no entry. OD-4 applies to the handling: the owner sees the options with their costs before deciding.

### Decisions for the owner

- D1. Approve the trial of Phase 1. The owner actions of Phase 1 are listed in one place in section "Phase 1, the trial": the go-ahead for a workflow push to `ci-trial`, the setting `allow_auto_merge` if T3 needs it, script 1, a removal of a queue entry if T0 times out, and script 2.
- D2. After the trial: amend the sentence of `0147` "Each skipped gate runs on `main` after the merge", as the text above says.
- D3. After the trial: how an agent merges under the merge queue. Choose auto-merge on the owner's go-ahead. Or choose a direct merge by a bypass actor, if the first merge of Phase 2 shows that it skips the merge queue. The second choice goes beyond `CLAUDE.md` (Merging), which allows a bypass of the review requirement only. It needs a change of `CLAUDE.md`. D3 is decided after step 4 of Phase 2.
- D4. Whether a merge group of documents only runs a light scope. Recommendation: no, in the first version. Every gate runs, as on a push to `main`.

Phase 0 is not a decision of the owner. The orchestrating session decided it (section "Recommendation").

## Why the compiler cannot do it

Not applicable: this proposal adds no author-facing name, rule of the language, diagnostic code or surface form. It changes where CI runs its gates (Rule 13.4), and the compiler has no part in it.

## What it touches

- `rules: [13.4]`. The second paragraph of Rule 13.4 gains the text above, and the last paragraph of `0147` changes.
- `surface: []`, `exports: []`, `exports-removed: []`, `codes: []`, `examples: []`, `names: []`. Nothing an author or a host meets changes.
- `downstream: []`. No downstream repository restates Rule 13.4 or the CI jobs. This is an inference from the findings of `0055` and `0147`. The implementer repeats the search that `0147` names before the implementing pull request.

Files of the implementation. None is changed by this proposal.

- `.github/workflows/ci.yml`, in implementing pull request 1 (Phase 2, step 2):
  - The trigger `merge_group` with `types: [checks_requested]`.
  - The job `change scope` lists `contents: read` and `actions: read`.
  - A new output `tested` of `change scope`. It is true on a push to `main` when a successful `ci` run of the event `merge_group` exists for `github.sha`. A failed lookup sets it to false.
  - Every job except `change scope` gets `tested != 'true'` in its `if`. This includes the aggregators `check` (`typecheck + unit`), `typescript5` and `typescript6`, and `traceability`. Reason: `check` and the two others run under `always()` and fail when a need is `skipped` (`test "$QUALITY" = success`). Without the condition, every queue merge makes a red run on `main`.
  - A push run on `main` then shows every job skipped except `change scope`. No required check applies to a push, so a skipped job blocks nothing.
  - The `LINT.IfChange` block of `ci.yml` names `AGENTS.md`, so `AGENTS.md` changes with it.
- `.github/workflows/ci.yml`, in implementing pull request 2: the light scope of a ready pull request for the heavy gates, with the skipped-job rule of `0147`.
- `.github/workflows/publish.yml`. This workflow calls `ci.yml` (`verify: uses: ./.github/workflows/ci.yml`) under `permissions: contents: read` at the top. The documentation says a called workflow cannot have more permissions than its caller (see risk 16; the page is being re-read). If `change scope` asks for `actions: read`, a release or a manual dispatch fails at start. So the job `verify` of `publish.yml` gets `contents: read` and `actions: read`. The job-level block replaces the top-level block, so it lists both.
- `.github/workflows/downstream.yml` and `.github/workflows/package-smoke.yml`: no change to the triggers. The implementer reads their `scope` jobs again for `merge_group`.
- `docs/language-design.md` Rule 13.4 and `reqs/rules/RULE-1304.md`. `bun run reqs:sync` regenerates the item. A person runs `doorstop review RULE-1304`. An agent does not clear it.
- `AGENTS.md` (Tests and CI) and `CLAUDE.md` (Merging, Waiting on a pull request): the merge step, and the meaning of "ready" for the light scope.
- The ruleset of `main`: the owner's change only.

`docs/structure-slice-playbook.md` is not in this list. The tooling session owns it.

Verification of pull request 1 for `publish.yml`: dispatch `publish.yml` with `dry_run: true` (the default) from the branch of pull request 1, and read that `verify` starts. This costs one full `ci` run. It is not done by this proposal.

## Phase 1, the trial

**Purpose.** The trial answers the open questions of section "Risks and limits" without a merge queue on `main`. It changes no file on `main` and no ruleset of `main`.

**Facts that shape it.** The orchestrating session read these on the live repository on 2026-11-25 with read-only `GET` calls. I did not read them. The owner type is `Organization` and the repository is public. The ruleset `main` (id 23876895) has the rules `deletion`, `non_fast_forward`, `pull_request` (`require_code_owner_review: true`) and `required_status_checks`. Its `bypass_actors` is one repository role (`actor_id` 5) with `bypass_mode: always`. Its `conditions` include `~DEFAULT_BRANCH`. The repository setting `allow_auto_merge` is false. `allow_merge_commit` is true.

**Parts.**

1. The branch `ci-trial`, cut from `main` by the trial session. It carries every edit before the second ruleset exists (see "Order"). The `ci.yml` of `ci-trial` differs from `main` in these ways:
   - It has the trigger `merge_group` and the output `tested`, as in pull request 1.
   - Its `push` trigger names `ci-trial` instead of `main`.
   - Its `concurrency` group and its `tested` condition treat `ci-trial` as `ci.yml` treats `refs/heads/main`. Without this, the second push run cancels the first.
   - One probe step in the job `change scope` fails on `merge_group` when the file `trial-fail` exists in the tree. It sits in `change scope`, so a failing group stops early.
     These edits stay on `ci-trial`. The branch never merges into `main`.
2. A second ruleset `ci-trial`. It targets only `refs/heads/ci-trial`. It holds:
   - the four required checks, with `do_not_enforce_on_create: true`;
   - the `merge_queue` rule, with `max_entries_to_build` 1 (one group at a time, so that two groups cannot fill the 20-job limit), `max_entries_to_merge` 2, `min_entries_to_merge` 2 and a wait of 2 minutes;
   - a copy of the `pull_request` rule and of the `bypass_actors` of the ruleset `main`, which script 1 reads from the live ruleset.
3. Trial pull requests. Each one targets `ci-trial` and changes one documents file, so it starts neither `downstream` nor `package compatibility`. A documents-only pull request skips `compile gate` and `user journeys` on the pull request, which the ruleset reads as success. It runs all four required checks on the merge group.

**Order. This order is a requirement.** After script 1 the ruleset `ci-trial` refuses a direct push, so the session could no longer create the branch or push `ci.yml`.

1. The trial session cuts `ci-trial` and pushes every edit of part 1. It tells the owner.
2. The owner runs script 1. It stops if the branch does not exist.
3. After script 1, a fix of `ci.yml` on `ci-trial` goes through a trial pull request. Or the owner runs script 2, and then script 1 again.

**What the trial shows.** Each result has its decisive read and its time limit in the table below.

- T0. A `merge_group` run starts and reads the `ci.yml` of `ci-trial`, not that of `main`.
- T1. A ready trial pull request runs the light scope and enters the merge queue. The merge group run reports the four required checks.
- T2. The commit of `ci-trial` after a merge queue merge has the SHA of the merge group. The push run takes the `tested` path: every job skipped except `change scope`.
- T3. `enable_pr_auto_merge` of the MCP tools, with the repository setting `allow_auto_merge` as it is. The session tries it on a pull request that is clean and on one that is not clean.
- T4. A merge group that fails (the file `trial-fail` is present) removes its pull request. `ci-trial` does not move.
- T5. Two trial pull requests enqueued together form one merge group. The branch gets one push event. `tested` is looked up for the head only. The first push run is not cancelled.
- T6. A `pull_request` run starts for a base other than `main`.
- T7. The session calls the REST `merge_pull_request` as a bypass actor on a trial pull request that needs a Code Owner review. The result is one of: refused, queued, or merged past the queue. The result also shows whether a pull request that needs a Code Owner review can enter the queue. Agents pass the review today only by bypass.

| Result | Decisive read (tools of the session)                                                                                                        | Time limit                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| T0     | `actions_list` `list_workflow_runs` with `event: merge_group`, then `list_workflow_jobs`: the probe step exists only in the `ci-trial` file | 10 minutes after the enqueue. If no such run appears, the owner removes the entry in the web UI. The session has no tool to dequeue (not checked). |
| T1     | `list_workflow_jobs` of the merge group run: the four required job names with `conclusion: success`                                         | 60 minutes                                                                                                                                         |
| T2     | `list_commits` on `ci-trial` against `head_sha` of the merge group run, then `list_workflow_runs` with `event: push`, `list_workflow_jobs`  | 15 minutes after the merge                                                                                                                         |
| T3     | The return of `enable_pr_auto_merge`, then `pull_request_read` (state, merged)                                                              | 20 minutes                                                                                                                                         |
| T4     | The conclusion of the merge group run, `pull_request_read` (still open), `list_commits` (unchanged)                                         | 15 minutes                                                                                                                                         |
| T5     | `list_workflow_runs` with `event: push` (one run for the head), `list_commits`                                                              | 40 minutes                                                                                                                                         |
| T6     | `list_workflow_runs` with `event: pull_request` for the trial pull request                                                                  | 5 minutes                                                                                                                                          |
| T7     | The status code and body of `merge_pull_request`, then `pull_request_read`                                                                  | Immediate                                                                                                                                          |

The session has no GraphQL tool. The pull request object of the REST API may have no queue field, and GraphQL `mergeQueueEntry` may be needed. Not checked. The session infers the queue state from runs and the pull request state.

**Rehearsal of script 3.** Script 3 runs first against the ruleset `ci-trial`, as a round trip with no change and a read-back (its variable `$name`). Its first run is not on `main`. The rollback block is rehearsed the same way.

**What the trial cannot show.** The trial is not `main`. It cannot show: the ruleset of `main` aggregated with a new rule, the real load of the refactoring, the light scope of a code pull request, `downstream` and `package compatibility` on `main`, and a group of more than two entries. The copy of the bypass actors and of the `pull_request` rule shows the behaviour of those rules on a queue branch. It does not show the ruleset `main` itself.

**Cost.** Model: seven trial pull requests (T1 and T2 share one, T3 two, T4 one, T5 two, T7 one). The cost has these parts:

- One push of `ci.yml` to `ci-trial` is a full run: about 67 runner minutes, each time.
- Each pull request runs the light scope: 18.3 runner minutes.
- Each merge group runs a full `ci`: 66.7 runner minutes. T5 shares one group for two pull requests.
- Each push run on `ci-trial` costs about 1 runner minute if T2 holds, and about 67 if it fails.

The model gives about 530 runner minutes. The reviewers' range for the worst case is 500 to 830. I did not re-derive their basis. The worst case is a failed T2 (a full push run after each merge) and two fixes of `ci.yml`. At 20 jobs, 830 runner minutes are 69% of one hour. Run the trial when the backlog of `main` has drained under Phase 0, and when the refactoring leaves slots free.

**Owner actions of Phase 1, in one place.**

1. Give the go-ahead for the trial session to push a file of `.github/workflows/` to `ci-trial` (D1). The session first tries a one-line workflow push. If the token is refused, the owner pushes the branch.
2. Turn on the repository setting `allow_auto_merge`, if T3 needs it. T3 shows whether the exemption for queue branches covers the mutation of the MCP tool. Not checked.
3. Run script 1 once, after the branch exists.
4. Remove a queue entry in the web UI if T0 times out.
5. Run script 2 when the record is complete.

The session does everything else: it cuts and pushes the branch, opens the pull requests, reads the runs, and writes T0 to T7 into this proposal ("Configuration and validation record"). It closes its pull requests when it is done. It does not delete the ruleset or the branch.

The task that produced this proposal said: do not edit a file of `.github/workflows/` on a branch that has a pull request. That rule binds the session that wrote this proposal. The trial session needs the owner's go-ahead for such an edit (D1).

## Phase 2, the order on `main`

1. The owner decides D2 to D4 with the observed results of the trial.
2. Implementing pull request 1 changes `ci.yml` and `publish.yml` as the list of files says: the trigger, the permissions, `tested` and the conditions. It changes nothing else. `tested` is never true before a merge group exists, and a failed lookup gives false, so the run on `main` is unchanged. It merges under today's rules. Verify `publish.yml` with the dry-run dispatch.
3. The orchestrating session sends one message to every session (below). The owner runs script 3 with `$name = 'main'`. It adds the `merge_queue` rule. A merge group now finds the trigger on `main`.
4. The first merge under the merge queue is a documents-only pull request, while the other sessions wait. It shows whether the REST `merge_pull_request` by a bypass actor passes the queue (risk 9). The owner decides D3 with that result.
5. Implementing pull request 2 gives the ready pull request the light scope, and edits Rule 13.4, `AGENTS.md` and `CLAUDE.md`. Until it merges, a ready pull request runs the full scope and the merge group runs it again. That is safe, and it costs more.

**The message of step 3.** The orchestrating session sends it to every session before script 3. It says:

1. From the stated time, do not call `merge_pull_request`.
2. Merge as the trial found: the procedure of T1 to T3 and T7.
3. Do not push to a pull request that is in the merge queue.
4. On an error, stop and report. Do not retry.

**The trigger for the rollback.** Run the rollback when one of these holds. A merge call is refused for two sessions. Or a pull request waits in the merge queue for 90 minutes and no `merge_group` run exists for it. The rollback replaces the ruleset with the backup. The fate of queued entries is not checked. The orchestrating session reads the entries and tells their sessions to enqueue again or to merge by the old way.

## Evidence for the implementation

Each item is a future result, not a completed one.

- The results T0 to T7 of the trial, and the rehearsal of script 3 on `ci-trial`.
- The dry-run dispatch of `publish.yml` from the branch of pull request 1.
- A push to `main` with no merge group runs every gate. A push to `main` after a queue merge shows every job skipped except `change scope`, and no red run.
- A failing merge group on `main`: the pull request leaves the queue and `main` does not move.
- `bun run reqs:sync`, `python scripts/doorstop-check.py -C` and `bun run docs:impact`, with the flagged items read by a person.

## Scripts for the owner (PowerShell, GitHub CLI)

**Nobody ran these scripts.** No `pwsh` is installed in the sessions that wrote and reviewed them, and the orchestrating session's permission classifier refused to run a downloaded PowerShell. Reviewers read them line by line. The scripts target Windows PowerShell 5.1 and later.

How to run a block: paste it into a PowerShell console. A saved `.ps1` file may meet the execution policy of Windows PowerShell 5.1. This is an inference and not checked. Run `gh auth login` once. Never paste a token in the conversation.

The scripts use these `gh api` calls:

- Create: `POST /repos/{owner}/{repo}/rulesets` (https://docs.github.com/en/rest/repos/rules, read verbatim).
- Update: `PUT /repos/{owner}/{repo}/rulesets/{id}`. Delete: `DELETE /repos/{owner}/{repo}/rulesets/{id}`. The page read for them was a summary. Not checked.
- The permission that creates a ruleset is not stated on the pages that were read. An administrator has it today (inference).

The guard of script 1 checks every ruleset of the repository, disabled ones included. It stops when a ruleset includes `~ALL`, includes the name `refs/heads/ci-trial`, or has a pattern with `*`, `?` or `[`. It does not check classic branch protection rules.

### Script 1. Create the trial ruleset (Phase 1, D1)

WARNING: this script creates a ruleset. It does not change the ruleset `main`. After it runs, the branch `ci-trial` refuses a direct push. Script 2 removes the ruleset.

```powershell
$ErrorActionPreference = 'Stop'
$repo = 'typeshade/typeshade'
gh api "repos/$repo/branches/ci-trial" --silent
if ($LASTEXITCODE -ne 0) { throw 'The branch ci-trial does not exist. Ask the trial session to push it first.' }
$sets = gh api "repos/$repo/rulesets" | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Cannot list the rulesets.' }
if ($sets | Where-Object { $_.name -eq 'ci-trial' }) { throw 'The ruleset ci-trial exists.' }
$details = foreach ($s in $sets) {
  $d = gh api "repos/$repo/rulesets/$($s.id)" | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw "Cannot read the ruleset $($s.name)." }
  $d
}
foreach ($d in $details) {
  foreach ($inc in @($d.conditions.ref_name.include)) {
    if ($inc -eq '~ALL' -or $inc -eq 'refs/heads/ci-trial' -or $inc -match '[\*\?\[]') {
      throw "The ruleset '$($d.name)' could match ci-trial. Stop and ask the agent."
    }
  }
}
$main = $details | Where-Object { $_.name -eq 'main' } | Select-Object -First 1
if (-not $main) { throw 'No ruleset named main.' }
if ($null -eq $main.bypass_actors) { throw 'bypass_actors of main is null. Stop and ask the agent.' }
$prRule = @($main.rules | Where-Object { $_.type -eq 'pull_request' })
$checks = @('typecheck + unit','traceability (Doorstop)','compile gate (Tint + WebGL2)','user journeys (packed tarball, WebGPU)') |
  ForEach-Object { @{ context = $_ } }
$rules = @(
  @{ type = 'required_status_checks'; parameters = @{
       do_not_enforce_on_create = $true
       strict_required_status_checks_policy = $false
       required_status_checks = @($checks) } },
  @{ type = 'merge_queue'; parameters = @{
       check_response_timeout_minutes = 90; grouping_strategy = 'ALLGREEN'
       max_entries_to_build = 1; max_entries_to_merge = 2; merge_method = 'MERGE'
       min_entries_to_merge = 2; min_entries_to_merge_wait_minutes = 2 } }
) + $prRule
$OutputEncoding = New-Object Text.UTF8Encoding($false)
@{
  name = 'ci-trial'; target = 'branch'; enforcement = 'active'
  bypass_actors = @($main.bypass_actors)
  conditions = @{ ref_name = @{ include = @('refs/heads/ci-trial'); exclude = @() } }
  rules = $rules
} | ConvertTo-Json -Depth 20 | gh api -X POST "repos/$repo/rulesets" --input -
if ($LASTEXITCODE -ne 0) { throw 'The POST failed. After a timeout or a 5xx, list the rulesets to see whether ci-trial exists. Then send the error text to the agent.' }
```

1. Paste the block and press Enter.
2. If it throws, send the message to the agent.
3. Tell the trial session that the ruleset exists.

### Script 2. Delete the trial ruleset and branch (end of Phase 1)

WARNING: this script deletes the ruleset `ci-trial` and the branch `ci-trial`. A deletion cannot be undone. Close the trial pull requests first, and keep the record of the trial.

```powershell
$ErrorActionPreference = 'Stop'
$repo = 'typeshade/typeshade'
$list = gh api "repos/$repo/rulesets" | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Cannot list the rulesets. Nothing was deleted.' }
$id = ($list | Where-Object { $_.name -eq 'ci-trial' } | Select-Object -First 1).id
if ($id) {
  gh api -X DELETE "repos/$repo/rulesets/$id"
  if ($LASTEXITCODE -ne 0) { throw 'The ruleset DELETE failed. The branch is kept.' }
  Write-Host "Deleted the ruleset ci-trial ($id)."
} else { Write-Host 'No ruleset ci-trial found.' }
gh api "repos/$repo/branches/ci-trial" --silent
if ($LASTEXITCODE -eq 0) {
  gh api -X DELETE "repos/$repo/git/refs/heads/ci-trial"
  if ($LASTEXITCODE -ne 0) { throw 'The branch DELETE failed.' }
  Write-Host 'Deleted the branch ci-trial.'
} else { Write-Host 'No branch ci-trial found.' }
```

### Script 3. Add the merge queue (rehearsal on `ci-trial`, then Phase 2 step 3 on `main`)

WARNING: with `$name = 'main'` this script replaces the ruleset `main` (PUT). Run it on `main` only after implementing pull request 1 is merged, and only after the rehearsal on `ci-trial` has passed. A merge queue with no `merge_group` trigger on `main` stops every merge. The script writes a backup with a time stamp and stops if the backup cannot be written.

```powershell
$ErrorActionPreference = 'Stop'
$repo = 'typeshade/typeshade'
$name = 'ci-trial'   # Rehearsal: a round trip with no change. Set to 'main' for Phase 2, step 3.
$list = gh api "repos/$repo/rulesets" | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Cannot list the rulesets.' }
$id = ($list | Where-Object { $_.name -eq $name } | Select-Object -First 1).id
if (-not $id) { throw "No ruleset named $name." }
$raw = (gh api "repos/$repo/rulesets/$id") -join "`n"
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) { throw 'Cannot read the ruleset.' }
$rs = $raw | ConvertFrom-Json
if ($null -eq $rs.bypass_actors) { throw 'bypass_actors is null. The token may not read it. Stop.' }
Write-Host ('Rule types: ' + (($rs.rules | ForEach-Object { $_.type }) -join ', '))
Write-Host ('Bypass actors: ' + (ConvertTo-Json @($rs.bypass_actors) -Compress -Depth 10))
$backup = Join-Path $PWD ("ruleset-$name-backup-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
[IO.File]::WriteAllText($backup, $raw, (New-Object Text.UTF8Encoding($false)))
if (-not (Test-Path $backup) -or (Get-Item $backup).Length -eq 0) { throw 'The backup is empty. Stop.' }
Write-Host "Backup: $backup"
$rules = @($rs.rules)
if ($name -eq 'main') {
  if ($rs.rules | Where-Object { $_.type -eq 'merge_queue' }) { throw 'The ruleset already has merge_queue.' }
  if ($rs.rules | Where-Object { $_.type -eq 'required_linear_history' }) { throw 'required_linear_history conflicts with merge_method MERGE. Stop.' }
  $file = gh api "repos/$repo/contents/.github/workflows/ci.yml?ref=main" | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw 'Cannot read ci.yml on main.' }
  $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($file.content -replace '\s', '')))
  if ($text -notmatch '(?m)^\s*merge_group\s*:') { throw 'ci.yml on main has no merge_group trigger. Stop.' }
  $queue = @{ type = 'merge_queue'; parameters = @{
    check_response_timeout_minutes = 90; grouping_strategy = 'ALLGREEN'
    max_entries_to_build = 2; max_entries_to_merge = 4; merge_method = 'MERGE'
    min_entries_to_merge = 2; min_entries_to_merge_wait_minutes = 10 } }
  $rules = @($rs.rules) + $queue
}
$OutputEncoding = New-Object Text.UTF8Encoding($false)
@{ name = $rs.name; target = $rs.target; enforcement = $rs.enforcement
   conditions = $rs.conditions; bypass_actors = $rs.bypass_actors; rules = $rules } |
  ConvertTo-Json -Depth 20 | gh api -X PUT "repos/$repo/rulesets/$id" --input -
if ($LASTEXITCODE -ne 0) { throw 'The PUT failed. Send the error text to the agent.' }
$after = (gh api "repos/$repo/rulesets/$id") -join "`n" | ConvertFrom-Json
$want = ($rules | ForEach-Object { $_.type } | Sort-Object) -join ','
$got = ($after.rules | ForEach-Object { $_.type } | Sort-Object) -join ','
if ($want -ne $got) { throw "Rule types differ after the PUT. Wanted $want. Got $got." }
if ((ConvertTo-Json @($after.bypass_actors) -Compress -Depth 10) -ne (ConvertTo-Json @($rs.bypass_actors) -Compress -Depth 10)) { throw 'bypass_actors changed. Roll back.' }
Write-Host 'The read-back matches.'
```

WARNING for the rollback below: it replaces the ruleset with the backup file. It loses every edit made to the ruleset after the backup. The fate of queued entries is not checked. Run it in the folder of script 3, with the backup path that script 3 printed. Run it only when the agent says so.

```powershell
$ErrorActionPreference = 'Stop'
$repo = 'typeshade/typeshade'
$name = 'ci-trial'   # The same value as in script 3.
$backup = 'PASTE THE BACKUP PATH THAT SCRIPT 3 PRINTED'
if (-not (Test-Path $backup)) { throw 'The backup file does not exist.' }
$id = ((gh api "repos/$repo/rulesets" | ConvertFrom-Json) | Where-Object { $_.name -eq $name } | Select-Object -First 1).id
if (-not $id) { throw "No ruleset named $name." }
$old = Get-Content $backup -Raw | ConvertFrom-Json
$OutputEncoding = New-Object Text.UTF8Encoding($false)
@{ name = $old.name; target = $old.target; enforcement = $old.enforcement
   conditions = $old.conditions; bypass_actors = $old.bypass_actors; rules = $old.rules } |
  ConvertTo-Json -Depth 20 | gh api -X PUT "repos/$repo/rulesets/$id" --input -
if ($LASTEXITCODE -ne 0) { throw 'The rollback failed. Send the error text to the agent.' }
$after = (gh api "repos/$repo/rulesets/$id") -join "`n" | ConvertFrom-Json
$want = ($old.rules | ForEach-Object { $_.type } | Sort-Object) -join ','
$got = ($after.rules | ForEach-Object { $_.type } | Sort-Object) -join ','
if ($want -ne $got) { throw "Rule types differ after the rollback. Wanted $want. Got $got." }
Write-Host 'The rollback matches the backup.'
```

The field names and limits of `merge_queue` come from https://docs.github.com/en/rest/repos/rules: `check_response_timeout_minutes` 1 to 360, `grouping_strategy` `ALLGREEN` or `HEADGREEN`, `max_entries_to_build` 0 to 100, `max_entries_to_merge` 0 to 100, `merge_method` `MERGE`, `SQUASH` or `REBASE`, `min_entries_to_merge` 0 to 100, `min_entries_to_merge_wait_minutes` 0 to 360. The page gives no default. The values in script 3 for `main` are starting values chosen from the measurements. A group of at most 4 gives at most 2.6 groups an hour at 10.4 merges. A `ci` run takes 32.5 minutes at the median, unloaded. The values of script 1 make a small group, so that a trial does not wait. The `GET` response may hold fields that the `PUT` body does not accept. Not checked. If a `PUT` is refused, remove the field that the error names.

### What was not checked

- The availability of the `merge_queue` rule type for this repository. The owner type and the existing ruleset are known (reported by the orchestrating session). The `POST` of script 1 answers this at no cost.
- The plan of the account. The ceiling of 20 jobs is observed. The Free value is from the documentation.
- Which file a `merge_group` run reads (risk 3).
- The push to `main` after a queue merge: its SHA, and whether `push` workflows run. The pages do not say.
- Whether the REST `merge_pull_request` by a bypass actor passes the queue (risk 9), and whether `enable_pr_auto_merge` enters the queue.
- Whether a `merge_queue` rule stays on the branches that its ruleset targets (the documentation is silent).
- Whether the token of the trial session may push a workflow file.
- The exact `ref_name` JSON for one branch. The documentation gives an example with `refs/heads/main`. `refs/heads/ci-trial` follows by analogy (inference).
- The `DELETE` route and the permission to create a ruleset (the page read was a summary).
- Whether a cancelled or rebuilt merge group cancels a run (risk 13).
- Whether the minutes cost money. The repository is public. This was not checked on a GitHub page. The limit that binds is the number of concurrent jobs.
- The run time of a pull request of a larger batch (option D).
- The speculative rebuilds of a merge queue with `max_entries_to_build` above 1.
- The state of the merge queue through the tools of the session (risk in the table of results).
- `downstream` and `package compatibility` times from creation to the last job: not computed.
- The live settings quoted under "Facts that shape it": not read by the author.
- All three scripts: not run.

### Draft impact estimate

Known work: a trial branch and a trial ruleset (about 430 runner minutes). A `merge_group` trigger. One new output of `change scope`. One condition on each gate job. Text in Rule 13.4, `AGENTS.md` and `CLAUDE.md`. The regeneration of one Doorstop item. Duration and cost of that work: unknown. Compatibility: a merge goes through a merge queue, and an agent changes how it merges. The decisions D1 to D4 must be resolved before acceptance.

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

Round 2. Date: 2026-11-25. Revision reviewed: commit `8f2e01f8`, the three-phase plan. Reviewer: a Sonnet sub-agent that did not write the proposal. It read the cited pages with WebFetch, which returns summaries. Findings and answers:

1. Two claims were not supported by the fetch: the quote "directly merge" with "bypass branch protections", and the mutation `enqueuePullRequest`. Fixed: both are labelled "one fetch reported, a second did not confirm, not checked" (risks 9 and 10).
2. The page on rulesets says rulesets are for GitHub Team and Enterprise plans. Fixed: named in risk 1.
3. "A skipped job reports success" had no GitHub citation. Fixed: the text says the source is `0055`, `0147` and the header of `ci.yml`.
4. The lookup of a merge group run needs `actions: read`, and `ci.yml` has `contents: read` only. Fixed: the permission and the rule "a failed lookup gives `tested=false`" are in the files of the implementation and in Phase 2, step 2.
5. D3 was "after the trial", but step 4 of Phase 2 gives its evidence. Fixed: D3 is decided after step 4. It also needs a change of `CLAUDE.md` for the second choice.
6. `required_linear_history` in the ruleset `main` would conflict with `merge_method MERGE`. Fixed: script 3 prints the rule types and stops.
7. On `ci-trial`, the `concurrency` group and the `tested` condition would not treat the branch as `main`. Fixed: part 1 of the trial lists both edits.
8. The trial numbering had no T3. Fixed: T0 to T6 with no gap.
9. Not observable in the trial: the light scope of a code pull request, and `downstream` and `package compatibility` on `main`. Fixed: both are in "What the trial cannot show".
10. Script 1 failed open when `gh` failed, script 2 had no exit-code check, script 3 piped text through the ASCII `$OutputEncoding`. Fixed: exit codes are checked and the encoding is set.
11. Terms and long sentences. Fixed in part: "backlog" now names the runner backlog, "merge queue" names the feature, and the named long sentences are split. A repeat count was not run.
12. Phase 0 changes the merge cadence of every session on the authority of the orchestrating session. Kept: the proposal says so. The owner sees it before deciding on the rest.
13. The reviewer could not read the full text of the pages, the plan and ownership of the repository, and PowerShell 5.1 behaviour. These stay in "What was not checked".

Round 3. Date: 2026-11-25. Revision reviewed: commit `ea0635cb`. Reviewers: four Sonnet sub-agents of the orchestrating session (script 1; scripts 2 and 3; the REST contract against the documentation and read-only `GET` calls on the live repository; the trial design against the workflow files) and one skeptic for each defect above minor. The orchestrating session reported 21 standing defects, 2 uncertain, 3 refuted and 13 minor, and sent a work order (items A to K). I checked items C and D against `ci.yml` and `publish.yml` myself. Answers:

- A (order of the trial). Fixed: the session pushes `ci-trial` with every edit before script 1. Script 1 stops if the branch does not exist. `do_not_enforce_on_create: true` is set. A later fix goes through a trial pull request, or script 2 and script 1 run again.
- B (what the trial shows). Fixed: script 1 copies `bypass_actors` and the `pull_request` rule of `main` (result T7). Script 3 runs first as a round trip on `ci-trial`, with a read-back. Group formation is result T5 (`min_entries_to_merge` 2, two pull requests). `max_entries_to_build` is 1 in the trial.
- C (`tested`). Confirmed in `ci.yml`: `check` fails when `quality` or `unit-pinned` is `skipped`. Fixed: every job except `change scope` carries the condition, aggregators included. A push run on `main` shows every job skipped except `change scope`. Pull request 1 carries the conditions.
- D (`publish.yml`). Confirmed: its top-level `permissions` is `contents: read` and `verify` calls `ci.yml`. Fixed: `verify` gets `contents: read` and `actions: read`, `publish.yml` joins "What it touches", and a dry-run dispatch verifies it. The documentation sentence covers nested chains. The direct case and the `actions: read` need are not confirmed (risk 16).
- E (owner actions). Fixed: one list in Phase 1. `allow_auto_merge` is a setting the owner may need to turn on. T3 runs in both states of the pull request.
- F (script 3). Fixed: time-stamped backup, exit-code and empty-text checks, stop when `merge_queue` exists, stop when `bypass_actors` is null, print the bypass actors and rule types, a code guard that reads `ci.yml` on `main`, a read-back, and a rollback with its own WARNING.
- G (script 2). Fixed: the list call is checked, each deletion is reported, and the branch is tested before the delete. I did not check the status that a missing ref returns (the page does not say).
- H (Phase 2 for the agents). Fixed: the message, the trigger for the rollback and its effect on queued entries (not checked).
- I (observations). Fixed: a table gives each result its decisive read and its time limit. The session has no GraphQL tool and no tool to dequeue.
- J (text). Fixed: risks 1 and 9 and the cost range. The range is about 530 (model) to 830 (the reviewers' worst case, basis not re-derived).
- K (minor). Fixed: how to run a block, the wording after a timeout, what the guard checks, the probe step in `change scope`, the skipped checks of a documents-only pull request, and an absolute path for the backup.
- Refuted, no action: printing the new ruleset id, deleting `gh-readonly-queue/ci-trial/*` branches, and the claim that T3 cannot run while `allow_auto_merge` is false.
- Not checked: the live facts of the work order (I did not read them), and all three scripts (nobody ran them).

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decisions D1 to D4, the trial record, the independent review, and the merge of this file with `status: accepted`. No approval, schedule or responsibility is recorded here.

### Configuration and validation record

This record does not yet apply. Delivery will require the accepted revision, the implementing commits and pull requests, the delivered configuration, the observed results of the trial results T0 to T7 and of the evidence listed above, and a record of each deviation from the approved text.

## What it owes downstream

Nothing known. No repository in `DOWNSTREAM_REPOS` is expected to restate Rule 13.4 or the CI jobs. The implementer confirms this with the search named under "What it touches" and records the result.
