---
id: '0115'
title: The surface has three layers, ECMAScript, TypeShade's core vocabulary and the target features, and no new global name is added until the place of each layer is decided
status: draft
rules:
  - '2.1'
  - '2.5'
  - '9.6'
  - '13.6'
surface: []
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The rule pages render the amended Rules 2.1, 9.6 and 13.6 and the new Rule 2.5 from reqs/ at the pin.
  - repo: vscode-typeshade
    what: The skill's account of where a name comes from is read against the three layers.
---

<!-- doc-refs: skip-file — a draft proposal names rules it will add -->

**Document control**

| Field                         | Record                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0115, `status: draft`. A discussion draft. No decision is recorded. No implementation exists.                     |
| Date and attribution          | Authored 2026-11-02, UTC, by a Claude Code agent, from the owner's request in a Claude Code session of the same date.      |
| Applicability / effectivity   | `docs/language-design.md` (Rules 2.1, 9.6, 13.6, new Rule 2.5). No compiler code changes. No release version.              |
| Review baseline               | `main` at `9afe73a`.                                                                                                       |
| Review and revision authority | No pull request is assigned yet. Git records the revisions of this file; the merge of its pull request records a decision. |

## What changes

Outline. The full text follows in the next revision.

1. The surface has three layers: ECMAScript, TypeShade's core vocabulary, and the target features.
2. Interim rule: no new ambient global name is added until the place of each layer is decided.
3. Open decision: the target features move from ambient globals to explicit module imports.
