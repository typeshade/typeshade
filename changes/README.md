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
| names     | Adds an author-facing name to `src/__api__/author-names.md`, the baked set of names a `"use typeshade"` file can write.                                                                             |

Anything else needs no proposal: an internal refactor, a test, a performance change, or a fix
that touches none of the above. `scripts/changes.ts` applies these criteria to the diff, so
nobody has to remember them.

The `names` criterion has two differences from the others:

- `Change: none` does not waive it. The language grows only through an accepted proposal that
  lists each added name under `names:`.
- A removed name is not a criterion. A smaller language is the direction the owner set on
  2026-11-09. `scripts/changes.ts` still reports each removed name, and the diff of
  `src/__api__/author-names.md` shows it to the reviewer.

`src/author-names.test.ts` holds the snapshot to the ambient library (`SHADE_DTS`). After a
name is added or removed, run `bun run bake:author-names` and commit the diff.

## A need from a downstream repository

A downstream repository (`DOWNSTREAM_REPOS` in `scripts/changes.ts`) that needs something of the
compiler asks for compiler work first. It does not ask for a language change.

1. Write the workaround in the downstream repository.
2. Measure the workaround on the devices that show the need.
3. Open an issue in this repository.
4. State the need, the workaround and the measurement (device, commit, result) in the issue.

The compiler side decides how to meet the need. What the compiler can decide is compiler work:
an optimization the compiler can prove exact, a lowering, a tuning parameter or a report. That
work adds no author-facing construct, and the criteria above give it no proposal. A numerical
relaxation is not compiler work: it changes results, and the GPU computes what the CPU oracle
computes (`docs/dx.md`).

A language change is the last resort. A proposal that adds an author-facing name, rule,
diagnostic code or form for a downstream need links the issue. Its
`Why the compiler cannot do it` section says why compiler work cannot meet the need. Nothing
domain-shaped is asked of the language (`docs/dx.md`, principle 7). Pull request #1094 (a draft) proposes the same principle as a
design rule.

The `downstream` field of a proposal lists the work that the proposal owes each repository. It
does not record where a request came from.

## The lifecycle

1. **Draft.** A new proposal uses `TEMPLATE.md` and the next free number in `NNNN-short-name.md`.
   The author declares every affected rule, surface section, export, code, example, author-facing
   name and downstream repository in the front matter. A proposal that adds to the language (an
   author-facing name, a rule, a diagnostic code or a surface form) says in
   `## Why the compiler cannot do it` what the author must write that the compiler cannot
   decide. What the compiler can decide (an optimization, a numerical relaxation, a tuning
   parameter) is the compiler's work. When the compiler can do it, the proposal is not needed:
   the work is an implementation change with no proposal, or no change. Rule links in `reqs/` (`reqs/README.md`) and searches of the
   site and editor establish those impacts. Review starts with a proposal-only PR and `status: draft`.
   Before the owner decides, the proposal passes an independent review (below).
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
5. **Downstream.** When a downstream repository (the site, the editor, Radiance, TypeNN, TypeCV
   or TypeAudio; `DOWNSTREAM_REPOS` in `scripts/changes.ts`) pins a compiler that carries the
   proposal, its pin pull request fails until the proposal's id is recorded in that repository's
   `compiler-changes.md` (`scripts/downstream-impact.ts`). The downstream work is therefore
   known from the day the proposal is accepted, and it cannot be skipped when the pin moves.
6. **Archived** or **withdrawn** once nothing more is owed, or once the change is abandoned.

A change the criteria catch but that truly needs no proposal, such as a typo inside a rule,
says why on a line of its own in the commit message: `Change: none, <reason>`. That line stays
in the history, where a reviewer reads it.

## Independent review

The rules that keep the language small are enforced by review: Rules 1.4, 1.6 and 1.7 of
`docs/language-design.md`, `docs/dx.md` and `docs/compiler-owns-performance.md`. A review that
nobody performs enforces nothing, and an author does not argue well against their own
recommendation. Each proposal therefore receives one review from an agent or a person that did
not write it, before the owner decides on it.

1. Give the reviewer the proposal and the documents above.
2. Ask the reviewer to argue against the proposal.
3. Ask the reviewer to answer the questions below, with file and line evidence.
4. Record the findings in the proposal, under `### Independent review record`.
5. Answer each finding in the same section: fixed, or kept with the reason.
6. Show the owner the open findings before the owner decides.

The questions:

- What does an author have to learn after this change that they did not have to learn before?
- Can the compiler do this instead of the author? If not, why not? Test the proposal's
  `Why the compiler cannot do it` section, which is the author's answer.
- Does the proposal conflict with a principle or a rule? Name each conflict and where the
  proposal resolves it. A conflict the proposal resolves by itself goes to the owner as a
  question.
- What does one example look like before and after the change?
- What does the change remove?

A proposal whose record has no independent review is not ready for the owner's decision.

## Controlled proposal records

These requirements apply to newly authored proposals and to their subsequent handling. Existing
historical proposals do not need a bulk retrospective rewrite. They do not add front-matter
fields or change the lifecycle above. `TEMPLATE.md` provides prompts; an actual proposal replaces
those prompts with specific facts or explicit uncertainty. It contains no unfinished placeholders,
fabricated signatures or predicted completion results.

Each new proposal retains the five sections `What changes`, `Why`,
`Why the compiler cannot do it`, `What it touches` and `What it owes downstream`. A
document-control table precedes those sections. It identifies:

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

`src/changes.test.ts` fails a proposal numbered after 0130 that declares `names:` and whose
`Why the compiler cannot do it` section is missing, empty or still the template's prompt
(`compilerFirstProblems` in `scripts/changes.ts`). Proposals up to 0130 predate the section and
are not rewritten. For a rule, a code or a surface form, this text requires the section and the
independent review checks it: the front matter does not tell an added rule from an edited one.

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
6. Explain why the compiler cannot do it.
7. Declare the affected surfaces.
8. Assess the expected impacts.
9. Identify unresolved decisions.
10. Identify the required validation evidence.
11. Label future-stage records as not yet applicable.
12. Replace the template prompts with proposal-specific content.
13. Review the document against its evidence.
14. Open the proposal-only draft PR.
15. Record the actual PR reference.

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
names: []                  # author-facing names added to src/__api__/author-names.md
downstream:                # the work each downstream repository will owe
- repo: typeshade.github.io
  what: One line naming the pages
```

`src/changes.test.ts` checks every proposal's shape: the fields, a unique id matching the file
name, a known status, known downstream repositories, and rule and section numbers that exist
once the proposal is implemented.

`names` lists each author-facing name the change adds, spelled as `src/__api__/author-names.md`
spells it: `abs` for a declared name, `Math.fround` for a member of a standard object and
`Array.prototype.map` for an array method. A proposal written before this field existed omits
it and declares no name. Such a proposal, once accepted, must be amended in its own pull request
before an implementation that adds a name can pass `scripts/changes.ts`.
