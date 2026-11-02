---
id: '0113'
title: An author binds Math members to short names with a const, `const { sqrt, PI } = Math`, as TypeScript writes it
status: draft
rules:
  - '6.3'
  - '9.4'
  - '9.5'
surface:
  - '12'
  - '14'
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The guide pages that render surface §12 and §14 show the new form at the pin.
  - repo: vscode-typeshade
    what: The skill's list of refused forms drops `const { … } = Math`; compiler-changes.md records 0113 when the pin moves.
---

**Document control**

| Field                         | Record                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0113, `status: draft`. The front matter is the identity and lifecycle authority.                |
| Date and attribution          | Authored 2026-11-02, UTC, by a Claude Code agent. This is the authorship date, not an approval date.     |
| Applicability / effectivity   | To be completed in the next revision of this draft.                                                      |
| Review baseline               | `main` at `9afe73a`.                                                                                     |
| Review and revision authority | No pull request is assigned yet. Git records the revisions; the pull request's merge records a decision. |

## What changes

A first outline. The full text follows in the next revision on the same branch.

`const { sqrt, sin, PI } = Math;` binds each name to the `Math` member of its name, at module
scope and inside a function. Today both halves refuse it (`TS8014`, `TS8022`).
