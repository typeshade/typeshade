---
id: 'NNNN'
title: One line saying what an author can do after this change
status: draft
rules: []
surface: []
exports: []
exports-removed: []
codes: []
examples: []
downstream: []
---

<!-- Authoring instructions: replace these prompts with proposal-specific facts. Remove this
comment from the proposal. Do not leave placeholders or invent approval and completion records.
See README.md for stage-specific evidence and STE-inspired writing conventions. -->

**Document control**

| Field                         | Authoring instruction                                                                                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Use the proposal number and front-matter status. They are the proposal identity and lifecycle authority.                                                                                                          |
| Date and attribution          | State the actual date, timezone and date meaning. Identify authors and sources from available evidence; distinguish attribution from approval.                                                                    |
| Applicability / Effectivity   | Identify affected files, subsystems, targets and versions. State when a release version is unassigned.                                                                                                            |
| Review baseline               | Record the reviewed base revision and commit. Do not rely on a branch name alone.                                                                                                                                 |
| Review and revision authority | Link the actual PR when available. Before PR creation, state that no PR is assigned. State that Git records revisions and PR review/merge evidence records decisions. Do not invent the containing commit's hash. |

## What changes

Describe the proposed before/after behavior. Cite affected rules by number. Keep proposed
behavior distinct from implemented behavior. Include concrete examples and exclusions where
they establish the scope.

## Why

Describe the problem and its evidence. Explain the relevant alternatives and the reason for
the proposed choice. State assumptions and unresolved decisions explicitly.

## What it touches

Explain each entry of the front matter in one line: why that rule, section, export, code or
example changes. Identify the implementation and validation evidence the proposal will require.

### Draft impact estimate

Describe expected technical work, compatibility effects, dependencies, tools, validation work
and downstream effort. Separate known impacts from estimates. Record the basis of any known
duration or cost estimate. Mark unestimated values as unknown, not zero. Identify decisions
that must be resolved before acceptance.

### Approval and plan record

For a draft, state: this record does not yet apply; acceptance will require the evidence below.
Do not fill future approval fields with placeholders or predicted approvals.

At acceptance, record the actual decision and review/merge reference, the approved proposal
revision and scope, assigned responsibilities and agreed milestones. Include duration or cost
estimates only when established, with their basis. Finalize declared impacts and required
functional and document validation evidence. The proposal must be merged as `accepted` before
implementation, as described in `README.md`.

### Configuration and validation record

Before implementation, state: this record does not yet apply; delivery will require the
evidence below. Required future evidence is not a completed result.

At implementation, record the accepted proposal revision, actual implementation commits/PRs,
delivered configuration, responsible actors and observed results. Link retained validation
evidence to its tested configuration. Distinguish functional validation from document validation.
Record scope deviations and pending work. Compiler status `implemented` does not establish
downstream completion.

## What it owes downstream

For each repository in `downstream`, the pages, docs, tests or examples that describe the old
behaviour and must change. Search each name the change removes or renames in that repository.

In the draft, describe expected work. At acceptance, record agreed responsibilities. Track
actual downstream changes, compiler pins, proposal-id records and validation evidence separately
after compiler implementation. Keep undelivered obligations explicitly pending.
