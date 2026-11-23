---
id: '0146'
title: The surface document says what the WebGL2 tier runs, and names its real gaps as not supported yet
status: draft
rules: []
surface:
  - 14
  - 23
  - 48
  - 65
  - 67
  - 71
  - 72
  - 74
exports: []
exports-removed: []
codes: []
examples: []
names: []
downstream:
  - repo: typeshade.github.io
    what: Each page that quotes or paraphrases the eight sections says that WebGL2 has no atomics, no workgroup memory or no storage buffer. Search the pages (en and ko) for those claims and for the old reduction reason in §71. Each page follows the new text. compiler-changes.md records 0146
  - repo: vscode-typeshade
    what: The skill and any hover or completion text that repeat the same claims follow the new text. compiler-changes.md records 0146
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0146, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                 |
| Date and attribution          | 2026-11-23, UTC (the drafting date). An AI agent (Claude Code) drafted it for the owner, who said "네" on 2026-11-23 to drafting it. The owner's words in `docs/owner-decisions.md` (OD-11) are a decision about direction, not an approval of this text. |
| Applicability / Effectivity   | `docs/use-typeshade-surface.md` only, eight sections. No release version is assigned (OD-6: nothing is released).                                                                                                                                         |
| Review baseline               | `main` at `3a6006ae` (merge of pull request #1436).                                                                                                                                                                                                       |
| Review and revision authority | No pull request is assigned yet. Git records the revisions. The review and merge of the proposal's pull request will record the decision.                                                                                                                 |

## What changes

This proposal changes no behaviour, rule, export, diagnostic code or example. It changes the
text of eight sections of `docs/use-typeshade-surface.md`, so that they match Rule 11.8, Rule
8.24, change 0054, change 0080 and OD-11.

Today the surface document says in several places that WebGL2 has no atomics, no workgroup memory
or no storage buffer. Those are facts about the WebGL2 API. The rules say that the WebGL2 tier
runs a `@compute` entry as a pass program with read-write storage, barriers and atomic operations
(Rule 8.24, change 0054). OD-11 says that "WebGL2 has no X" is never a reason, by itself, that a
program does not run on the tier.

After this change, each passage does one of two things.

1. It states what the tier runs, and cites the rule or change.
2. It states a real gap as "not supported yet on the WebGL2 tier", with the rule or decision.

The passages, by section:

| Section | Passage                                                                     | Disposition                                                                                                                                                                                                                              |
| ------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §14     | A whole struct element of a storage array is not copied                     | Reworded neutrally: "this version does not copy ..." on the WebGL2 tier. No rule states it (open question 1).                                                                                                                            |
| §23     | "GLSL ES 3.00 has no storage buffers and no atomics"                        | Reworded: the GLSL writer has no form of an atomic. A `@compute` entry that reaches no texture runs on the tier as its pass program in the phased order (change 0054, Rule 11.8).                                                        |
| §48     | "all three WebGPU-only"                                                     | Reworded: the GLSL writer fails closed; the tier runs a `@compute` entry that reaches no texture as the pass program of change 0054 (Rule 11.8). The rules do not say which of the three builtins gets a form, so the text does not say. |
| §65     | "WebGL2 has no compute stage"; a reduction, a scatter or a write not at `i` | Reworded: Rule 11.8 states what the tier takes. The rest "is not supported yet on the WebGL2 tier" and goes on to the CPU tier.                                                                                                          |
| §67     | "WebGL2 has no compute stage"; "WebGL2 has no storage buffer" in a draw     | The first is dropped. The second is a gap: "does not support a storage binding in a draw yet (OD-11)".                                                                                                                                   |
| §71     | The reduction reason: "which WebGL2 has no workgroup memory for"            | Reworded to the text of pull request #1437 (below).                                                                                                                                                                                      |
| §72     | Histogram: "WebGL2 has no atomics"                                          | A gap: the tier does not support a kernel function's atomic add yet (Rule 11.8).                                                                                                                                                         |
| §74     | "WebGL2 has no atomics, and runs no such function"                          | A gap: the tier does not support such a function yet (change 0080, Rule 11.8).                                                                                                                                                           |

**Dependency on pull request #1437.** Pull request #1437 (open, not merged) changes two runtime
texts in `src/`. The kernel reduction reason becomes `which the WebGL2 tier does not support yet
(Rule 11.8)`. The draw refusal becomes `the WebGL2 tier does not support a storage binding in a
draw yet`. §71 quotes the first text, and §67 states the second in prose. The implementing pull
request for this proposal merges after #1437, or it quotes the text that `main` then holds.
This is a dependency, not a question: merge #1437 first.

Before (§74):

> WebGL2 has no atomics, and runs no such function.

After (§74):

> The WebGL2 tier does not support such a function yet (change 0080, Rule 11.8).

## Why

Agents in several sessions read "WebGL2 has no X" in the surface document and concluded that a
program cannot run on the tier. That conclusion is false for atomics, workgroup memory and
read-write storage in a `@compute` entry (Rule 8.24, change 0054). The owner decided on
2026-11-23 that this is wrong (OD-11). The surface document is the text that authors and agents
read, so it must not say it.

The alternative is to leave the text and rely on OD-11 alone. That keeps a false sentence in a
normative-adjacent document. This proposal rejects it.

Assumption: where a passage keeps a gap, Rule 11.8 or the cited change states it. A gap that no
rule states is worded as "not supported yet", with no claim that the tier cannot do it. §14 is
not stated by a rule that this author found, so it says only what this version does. The forms
of the three builtins in §48 are not stated either, so §48 does not say. Both are the open
question (below).

## Owner's decisions

- OD-11: a feature WebGL2 lacks is TypeShade's work to provide, not a reason to drop the tier.
  This proposal applies it to the surface text.
- OD-3: the compiler's and the runtime's work provides the fallback, not the author.
- OD-9: a program need not translate one-to-one into a target language. The result is the same on
  every tier.

This proposal reverses no entry.

## Why the compiler cannot do it

Not applicable: this proposal adds no author-facing name, rule, diagnostic code or surface form.
It corrects the text of existing sections.

## What it touches

- Surface §14, §23, §48, §65, §67, §71, §72, §74: the passages in the table above. The
  declaration is exactly the set that `scripts/changes.ts` finds in the diff.
- Rules, exports, codes, examples and names: none. The cited rules are read, not changed.
- Requirement items. The surface patch edits `reqs/surface/SURF-023.md` and
  `reqs/surface/SURF-074.md`, and adds the new item SURF-048 in the same directory. Each carries a link to
  RULE-1108 (Rule 11.8). The implementing pull request needs `doorstop review SURF-048` by a
  person who read the item.
- Evidence the implementing pull request needs: `bun scripts/changes.ts`, `bun run docs:refs`,
  `bun run docs:impact`, `bun run reqs:sync`, and the review of the SURF items it flags.

### Draft impact estimate

Known: one file changes, with about 40 lines. No code changes. Unknown: the number of site and
editor passages that repeat the old claims; the downstream search sets it. A person must review
each changed SURF item in `reqs/` (`reqs/README.md`). Decision needed before acceptance: the
open question below.

**Open question for the owner.**

1. §14 and §48. Does the tier copy a whole struct element from a storage array, and which of
   `atomicCompareExchangeWeak`, `workgroupUniformLoad` and `textureBarrier` does the pass
   program give a form? Recommendation: keep the text as written until a test answers, and
   record the answer as a rule.

### Independent review record

- Reviewer: an AI agent that did not write the proposal.
- Date: 2026-11-23.
- Revision reviewed: `a20bb040`.
- Findings: 0 blocking, 2 should-fix, 3 nits.
- Verdict: approve after fixes. The fixes are in the revision after `a20bb040`.

| Finding | Class      | Answer                                                                                                                                                                     |
| ------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | should fix | §48 text and table row no longer call compare-exchange an atomic or `workgroupUniformLoad` a phase boundary. They say that the rules do not say which builtin gets a form. |
| 2       | should fix | §23 and §48 now say a `@compute` entry "that reaches no texture" (Rule 11.8).                                                                                              |
| 3       | nit        | §23 wording smoothed. The §14 and §67 replacement lines are broken.                                                                                                        |
| 4       | nit        | The §14 hedge now reads "this version does not copy ..." and is an open question.                                                                                          |
| 5       | nit        | The surface patch edits and adds SURF items. "What it touches" names them and the `doorstop review` of SURF-048.                                                           |
| 6       | note       | Open question 2 is a dependency on #1437. It moved to the dependency paragraph.                                                                                            |

### Approval and plan record

This record does not yet apply. Acceptance will require the evidence in `README.md`: the
decision, the approved revision and scope, and the validation evidence.

### Configuration and validation record

This record does not yet apply. Delivery will require the checks of the section "What it
touches", with the configuration and the result of each.

## What it owes downstream

- `typeshade.github.io`: search the English and Korean pages for "no atomics", "no workgroup
  memory", "no storage buffer", "no compute stage" and the old reason "has no workgroup memory
  for". Each page that repeats one follows the new text. The site's pin of the compiler moves
  after the implementing change.
- `vscode-typeshade`: search the skill and the hover text for the same phrases. Each one follows
  the new text.

Both obligations are expected work. Responsibilities are agreed at acceptance. Both are pending.
