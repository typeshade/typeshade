# Change proposals

A change that alters the language, the public API, or what the repositories downstream show,
starts here as a proposal. The proposal names everything the change will touch. It is agreed
before the implementation is written, and CI holds the implementation to it. The practice is the
one language projects use under other names: an RFC, a PEP, a KEP, OpenSpec's change folders.

This process exists because of a specific failure. #209 let a `for` loop take a runtime bound,
and #195 made closures compile. Both were correct, and neither said that typeshade.dev's
constructs page, its TS8006 example and the editor's skill described the old rules. That came
out weeks later, when the site pinned the compiler and its build stopped on one stale page after
another (`0001-runtime-loop-bound.md` records what that proposal would have said).

## When a change needs one

A diff needs a proposal when it does any of the following:

| Criterion | What counts                                                                                                                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rules     | Changes, adds or removes a `**Rule N.M.**` paragraph of `docs/language-design.md`.                                                                                                                  |
| exports   | Adds, removes or reshapes an export listed in `src/__api__/surface.md`.                                                                                                                             |
| visible   | Changes what a downstream repository shows or checks: a numbered section of `docs/use-typeshade-surface.md`, a diagnostic code (added, removed or renumbered), or the set of `examples/*.shade.ts`. |

Anything else needs no proposal: an internal refactor, a test, a performance change, or a fix
that touches none of the above. `scripts/changes.ts` applies these criteria to the diff, so
nobody has to remember them.

## The lifecycle

1. **Draft.** A new proposal uses `TEMPLATE.md` and the next free number in `NNNN-short-name.md`.
   The author declares every affected rule, surface section, export, code, example and downstream
   repository in the front matter. Rule links in `reqs/` (`reqs/README.md`) and searches of the
   site and editor establish those impacts. Review starts with a proposal-only PR and `status: draft`.
2. **Accepted.** Discussion happens on that pull request. Merging it with `status: accepted` is
   the agreement.
3. **Implementation.** Each pull request that implements the proposal has a commit message line
   `Change: NNNN`. CI (`scripts/changes.ts`) checks two things:
   - The proposal is accepted on the base branch.
   - Everything the diff actually touches is inside what the proposal declared.

   Anything outside stops the pull request. It is either a cascade nobody planned for, or a
   proposal that needs updating first. What was declared and is not yet done is listed as
   pending, so one proposal can be implemented over several pull requests.

4. **Implemented.** The pull request that finishes the compiler repository's work sets
   `status: implemented`. It records the delivered configuration and actual validation evidence.
   This status does not mean that downstream changes or compiler pins are complete.
5. **Downstream.** When the site or the editor pins a compiler that carries the proposal, their
   pin pull request fails until the proposal's id is recorded in that repository's
   `compiler-changes.md` (`scripts/downstream-impact.ts`). The downstream work is therefore
   known from the day the proposal is accepted, and it cannot be skipped when the pin moves.
6. **Archived** or **withdrawn** once nothing more is owed, or once the change is abandoned.

A change the criteria catch but that truly needs no proposal, such as a typo inside a rule,
says why on a line of its own in the commit message: `Change: none, <reason>`. That line stays
in the history, where a reviewer reads it.

## Controlled proposal records

These requirements apply to newly authored proposals and to their subsequent handling. Existing
historical proposals do not need a bulk retrospective rewrite. They do not add front-matter
fields or change the lifecycle above. `TEMPLATE.md` provides prompts; an actual proposal replaces
those prompts with specific facts or explicit uncertainty. It contains no unfinished placeholders,
fabricated signatures or predicted completion results.

Each new proposal retains the four sections `What changes`, `Why`, `What it touches` and
`What it owes downstream`. A document-control table precedes those sections. It identifies:

- The proposal number and current front-matter status.
- The actual document date, timezone and whether the date means authorship, revision context or
  another evidenced event. A document date is not automatically an approval or delivery date.
- Actual author attribution and source references where evidence is available. Unknown
  attribution stays unknown; Git authorship is not by itself an approval signature.
- Applicable files, subsystems, targets and versions. An unassigned release version stays
  unassigned.
- The exact review baseline commit and actual PR when available. Before PR creation, the
  document states that no PR is assigned.
- Git as the revision-history authority and review/merge records as the decision evidence.
  A document does not invent the hash of the commit that will contain it.

`id` and `status` in the front matter remain authoritative for proposal identity and state. The
table must agree with them. New prose records do not substitute for the merged accepted-proposal
requirement on the implementation's base branch.

### Evidence by lifecycle stage

| Stage                | Required record                                                                                                                                                                                                                                                              | What does not yet apply                                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `draft`              | Problem, evidence, proposed behavior, relevant alternatives, applicability, expected technical/compatibility/dependency/tool/downstream impact, required validation and unresolved decisions. Estimates identify their basis; unestimated time or cost is unknown, not zero. | Approval and implementation records state that they do not yet apply and identify the evidence required at the later transition. They contain no invented approver, signature, schedule or result. |
| `accepted`           | Actual approval decision and PR evidence, approved proposal revision and scope, finalized impact declarations, assigned responsibilities, agreed milestones and required validation. Resource estimates appear only when established.                                        | Completed implementation results do not yet apply. Acceptance of a plan is not successful execution of that plan.                                                                                  |
| `implemented`        | Accepted proposal revision, actual implementation commits/PRs, delivered configuration, responsible actors, observed results and retained functional/document validation evidence. Deviations have a recorded disposition; pending work remains pending.                     | Site/editor delivery and compiler pins are tracked separately and are not presumed complete from compiler implementation.                                                                          |
| Downstream follow-up | Actual downstream change/pin identities, the proposal id in `compiler-changes.md`, observed validation results and remaining obligations.                                                                                                                                    | A planned pin or compiler-only check is not proof of downstream fulfillment.                                                                                                                       |

The table describes the active delivery records. The repository also defines `archived` and
`withdrawn`; their existing lifecycle meaning remains unchanged. A future-stage evidence list is
allowed when explicitly labeled as not yet applicable. Empty approval forms, fake results and
TODO-like completion records are not allowed in an actual proposal.
Unassigned responsibilities or unagreed milestone dates remain explicitly unassigned. They must
not be replaced with invented owners or schedules. Established approval evidence still records
the actual decision and its date.

Functional validation establishes behavior against a tested configuration. Document validation
establishes that descriptions, impacts, references and records match that configuration. A passing
format check does not demonstrate feature correctness. A passing functional gate does not
demonstrate that the guide or downstream documentation is current. Record the actual executor
or reviewer, check date, tested configuration, result and supporting output/change reference
when each check is performed.

### Writing and handling conventions

Use STE-inspired principles for the proposal and its review responses. ASD-STE100 combines
English writing rules with a controlled dictionary. These local conventions do not claim full
ASD-STE100 compliance or certification. The software configuration-management records above are
not aviation records, and STE does not define repository state transitions.
[ASD-STE100 FAQ](https://www.asd-ste100.org/STE_faq.html)

Descriptive text explains behavior and rationale. Procedures use imperative actions. Each
numbered procedure step contains one action under this repository's local convention.
ASD-STE100 Rule 5.2 permits simultaneous-action exceptions; this local convention is stricter
for readability. A descriptive lifecycle list is not a numbered execution procedure.
[ASD-STE100 Issue 9, Rule 5.2](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf)

Use stable terms and exact technical identifiers. Prefer short, clear sentences and active voice
when the actor is known. Keep proposals, estimates, decisions and observed results distinct.
Do not invent an actor to make a sentence active. Cite actual sources and check outcomes before
claiming completion. `AGENTS.md` applies the corresponding principles to ordinary technical
questions as well as document work; ordinary answers do not require proposal forms.

Use this procedure when preparing a new draft:

1. Assign the next free proposal number.
2. Copy `TEMPLATE.md` to the proposal file.
3. Record the document-control facts.
4. Describe the proposed behavior.
5. Explain the evidence and alternatives.
6. Declare the affected surfaces.
7. Assess the expected impacts.
8. Identify unresolved decisions.
9. Identify the required validation evidence.
10. Label future-stage records as not yet applicable.
11. Replace the template prompts with proposal-specific content.
12. Review the document against its evidence.
13. Open the proposal-only draft PR.
14. Record the actual PR reference.

## The front matter

```yaml
id: '0001'                 # the file's number
title: One line
status: draft              # draft | accepted | implemented | archived | withdrawn
rules:                     # rule numbers the change edits, adds or removes
- '7.5'
surface:                   # docs/use-typeshade-surface.md section numbers
- 17
exports: []                # exports added or reshaped
exports-removed: []        # exports removed: downstream must stop naming them
codes: []                  # diagnostic codes added, removed or renumbered
examples: []               # examples/*.shade.ts ids added or removed
downstream:                # the work each downstream repository will owe
- repo: typeshade.github.io
  what: One line naming the pages
```

`src/changes.test.ts` checks every proposal's shape: the fields, a unique id matching the file
name, a known status, known downstream repositories, and rule and section numbers that exist
once the proposal is implemented.
