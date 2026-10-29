---
id: '0105'
title: A struct or array local is a place, a struct returned into any local or into a place no callee names is written there, and a local reads only the part of its place that changes
status: draft
rules:
  - '8.28'
surface:
  - 26
exports: []
exports-removed: []
codes: []
examples: []
downstream: []
---

<!-- doc-refs: skip-file — a draft proposal names text it will add -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0105, `status: draft`. The front matter is the identity and lifecycle authority. No approval exists. No implementation exists.                                                                                                                                                                                                                                                                                                                  |
| Date and attribution          | Authored 2026-10-29, UTC, by a Claude Code agent. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                     |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-10-29, in Korean. After reading the implementation of change 0104 (#832), the owner said that more could be removed and that the approach was too conservative ("더 줄일 수 있는데 너무 보수적으로 접근하네요"). The agent listed four places where the conditions of 0104 keep a copy that no program needs; the owner answered "네" to all four and to this record. No GitHub issue is recorded. |
| Applicability / effectivity   | `docs/language-design.md` (Rule 8.28), `reqs/` (its item), `docs/use-typeshade-surface.md` §26, `src/core/passes/local-places.ts`, `src/core/backends/wgsl-return-into.ts`, the WGSL pointer pass, and the golden snapshots. The CPU tiers, the exports, the diagnostic codes and the examples do not change. No release version is assigned.                                                                                                            |
| Review baseline               | `main` at `19913bb242a10ae6798258364381c7b433fe4643` (2026-10-29), with change 0104's implementation (#832) as the work it extends.                                                                                                                                                                                                                                                                                                                      |
| Review and revision authority | Pull request [#834](https://github.com/typeshade/typeshade/pull/834) (branch `claude/proposal-0105-more-places`). Git records the revisions of this file; the merge of that pull request with `status: accepted` records the decision.                                                                                                                                                                                                                   |

## What changes

Change 0104 removes a copy only under conditions narrower than the program needs. The agent read the
WGSL goldens of #832 (`capsule-corp-namek-class`, `rt-renderer-class`) and found these copies
left. Each item below widens one condition. Each keeps the guarantee of Rule 8.28: the target
reads the same value the copy would hold.

### 1. A struct or array local is a place

`const ship = new Ship()`, `const h = Hit(...)` and `const legFrame = SDF_polarY(...)` are WGSL
`let` values today. A value cannot be addressed, so every method called on it takes a value copy
(`Ship_flapHome_value(self_, l)`), and so does every method that one calls on `self_` in turn:
one value at the top of a chain makes the whole chain copy. Every struct or fixed-size array
local that is still a `let` after item 1 of change 0104 becomes a `var` that nothing writes. It
is then a place, and the calls on it take pointers (Rule 8.28). It holds one value for its whole
scope, as the `let` did. A `let` that copies a place something writes stays a copy, now a `var`,
and the calls on it take pointers too.

### 2. A struct returned into any local, or into a place no callee names, is written there

Item 2 of 0104 takes a local `var` only. It now also takes:

- a `const` or `let` local, which item 1 above makes a `var` (`let legFrame = SDF_polarY(...)`
  is `var legFrame: Frame; SDF_polarY_into(&legFrame, ...)`);
- a module variable, a `read_write` storage binding, or a field or an element of one, when the
  callee and the functions it calls neither read nor write that root by name (`fnReads`,
  `fnWrites`), and no argument of the call reads it; the pointer is in that place's address space.

The destination is evaluated before the arguments once it is a pointer, so the call keeps its copy
when an argument calls something that writes a name the destination is spelled with.

### 3. An index that holds one value is not bound to a temporary

Item 1 of 0104 binds each index that something may change to a `let` (`let _pl0 = (u32(i) +
_licm0);`). An index gives the same value each time it is evaluated when it calls no function of
the module and no intrinsic with an effect, and none of its names is written or declared again
while the local can be read, nor is memory other invocations share across a barrier. Such an index
is written in place of the local without a temporary.

### 4. A write to another part of the place keeps the local in place

Item 1 of 0104 keeps the copy when anything writes the root of the place. It now keeps the copy
only when a write can reach the part the local reads. Two paths of one root reach different
parts when, at some step, they name different fields or different literal indices. An index that
is not a literal can be any index, so it decides nothing at its step. A path that is a prefix of
the other reaches a part of it. An assignment writes its target's path, a call writes the path of
each argument its callee writes through and the whole of each module name it writes, and an
atomic writes the whole of its root. `qs[1].a = 5.` does not reach `const q = qs[0]`, and
`ps[i].vel = v` does not reach `const pos = ps[j].pos`.

## Why

The owner's request: the compiler can remove these copies and does not. The facts behind each item
are in What changes. Items 1 and 2 remove the largest number: in `capsule-corp-namek-class`, the
ship and its trees are `let` values at the top of the fragment entry, so every SDF method below
takes its object by value. Item 3 removes a temporary per local. Item 4 removes the copies a
write to a neighbouring element or field keeps.

A `var` that nothing writes costs what a `let` costs: a GPU compiler keeps a value in registers
whichever way it is declared. That is an inference, not a measurement on a GPU.

**Alternatives.**

| Alternative                                                                      | Why it is not chosen                                                                                   |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A value parameter that a callee passes on by pointer after storing it to a `var` | A store per call, where item 1 makes the caller's value a place once.                                  |
| Alias analysis over dynamic indices (item 4)                                     | Two dynamic indices cannot be told apart at compile time; a literal step or a field is the safe split. |

## What it touches

- Rule 8.28: the paragraphs of change 0104 widened by items 1 to 4.
- Surface §26: the two paragraphs of change 0104 and their listing.
- No export, diagnostic code or example changes.

### Draft impact estimate

Known work: item 1 in the WGSL `postLower` (a `let` of struct or array type becomes a `var`); item 2's two new destinations in `wgsl-return-into.ts`, with `fnReads`
and `fnWrites` for the module-scope case; item 3 and item 4 in `local-places.ts`; tests that read
both halves for each item and each condition that keeps the copy; the goldens baked again.
Duration and cost: unknown, no basis for an estimate.

Decisions to resolve before acceptance:

- **D1.** Item 1 on WGSL only, or also on GLSL ES 3.00, where a local is a copy whatever its
  declaration and only module-scope places are read by name (change 0103). This draft applies it
  on WGSL only, since it changes nothing on GLSL.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decision, the merge of the
proposal-only pull request with `status: accepted`, and the disposition of D1.

### Configuration and validation record

This record does not yet apply. Delivery will require the implementing pull requests with
`Change: 0105` commits; the required checks green on their heads; `bun run reqs:sync` and
`python scripts/doorstop-check.py -C` clean; `bun run docs:impact` worked through; the golden diff
read; and the counts of change 0104's section 1 measured again.

## What it owes downstream

Nothing is expected: no export, page or skill names the emitted spelling of a local.
