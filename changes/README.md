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

1. **Draft.** Copy `TEMPLATE.md` to a new file in this directory named `NNNN-short-name.md`, taking the next free number.
   Fill in the front matter: every rule, surface section, export, code and example the change
   will touch, and every downstream repository with the work it will owe there. To find them,
   follow the rule's links in `reqs/` (`reqs/README.md`) and search the site and the editor for
   each name. Open a pull request that adds only this file, with `status: draft`.
2. **Accepted.** Discussion happens on that pull request. Merging it with `status: accepted` is
   the agreement.
3. **Implementation.** Each pull request that implements the proposal has a commit message line
   `Change: NNNN`. CI (`scripts/changes.ts`) checks two things:
   - The proposal is accepted on the base branch.
   - Everything the diff actually touches is inside what the proposal declared.

   Anything outside stops the pull request. It is either a cascade nobody planned for, or a
   proposal that needs updating first. What was declared and is not yet done is listed as
   pending, so one proposal can be implemented over several pull requests.

4. **Implemented.** The pull request that finishes the work sets `status: implemented`.
5. **Downstream.** When the site or the editor pins a compiler that carries the proposal, their
   pin pull request fails until the proposal's id is recorded in that repository's
   `compiler-changes.md` (`scripts/downstream-impact.ts`). The downstream work is therefore
   known from the day the proposal is accepted, and it cannot be skipped when the pin moves.
6. **Archived** or **withdrawn** once nothing more is owed, or once the change is abandoned.

A change the criteria catch but that truly needs no proposal, such as a typo inside a rule,
says why on a line of its own in the commit message: `Change: none, <reason>`. That line stays
in the history, where a reviewer reads it.

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
