---
id: '0001'
title: A for loop takes a runtime bound, the 256-trip ceiling goes, and while is an open loop
status: archived
rules:
- '7.5'
surface:
- 17
exports: []
exports-removed: []
codes: []
examples:
- loops-over-data
downstream:
- repo: typeshade.github.io
  what: The constructs page's for and while rows and the trip-limit fact, the TS8006 and TS8007 copy, the TS8006 example
- repo: vscode-typeshade
  what: The skill's TS8006 example and its loop advice, and the MCP run tool's step budget
---

## What changes

Recorded after the fact. #209 implemented this change on 2026-09-22, before proposals existed.
It is kept as the example this process is measured against: the proposal that should have
come first.

Before, a `for` needed a constant bound and at most 256 trips, and a `while` needed a
compile-time-constant bound. After, Rule 7.5 lets a `for` count to a runtime bound that its
body does not write, sets no trip limit, and makes `while` an open loop that must be able to
leave when its condition is constantly `true`.

## Why

A program over data loops to a length it learns at run time: a BVH traversal, a kernel striding
over a buffer. Tint and ANGLE both accept such loops (#203).

## What it touches

- Rule 7.5 and surface §17 say what a `for` and a `while` may be.
- `examples/loops-over-data.shade.ts` holds all three loops, compiled by the gate.

## What it owes downstream

- **typeshade.github.io**: the lowering table (`typescript-lowering.ts`) had a row refused for its trip
  count, and `loweringTripLimit()` read the limit from that refusal. The constructs page, the
  `statements.for` and `statements.while` copy, and the TS8006 and TS8007 descriptions stated
  the old rules. The TS8006 example relied on a uniform bound being refused. The site's pin to
  eb0dde6 found all of this one build failure at a time. With this proposal, the list would
  have been known on the day the change was agreed.
- **vscode-typeshade**: the skill's TS8006 example was a runtime-bounded loop, and its advice
  said to loop to a constant maximum and break. The MCP run tool's step budget became the only
  thing that ends a runaway run. #14 fixed all three.
