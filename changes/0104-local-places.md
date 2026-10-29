---
id: '0104'
title: A local that only reads a place reads it in place, and a struct a call returns into a place is written there
status: accepted
rules:
  - '8.26'
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

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0104, `status: accepted`. The front matter is the identity and lifecycle authority. The owner approved the proposal on 2026-10-29 (UTC); see Approval and plan record. No implementation exists.                                                                                                                                                                                                                                                                                                    |
| Date and attribution          | Authored 2026-10-29, UTC, by a Claude Code agent. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                         |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-10-29, in Korean, after change 0103. The owner asked whether the compiler could find a local created again on each iteration of a loop, or assigned again and again in a function, and use pointers so that only the locals needed remain ("최소 로컬변수만 존재 가능하게"). The agent reported four patterns from the emitted WGSL and recommended items 1 and 2 below as one proposal; the owner answered "추천안대로". No GitHub issue is recorded. |
| Applicability / effectivity   | `docs/language-design.md` (Rule 8.26), `reqs/` (its item), `docs/use-typeshade-surface.md` §26, the WGSL backend's pointer pass (`src/core/backends/wgsl-ptr.ts`) or a pass beside it, the GLSL-local place pass (`src/core/backends/glsl-global-places.ts`), and the golden snapshots of emitted WGSL and GLSL. The CPU tiers, the exports, the diagnostic codes and the examples do not change. No release version is assigned.                                                                            |
| Review baseline               | `main` at `12f738573a31c09cc3fae1cead19d63d99516a49` (2026-10-29).                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Review and revision authority | Pull request [#830](https://github.com/typeshade/typeshade/pull/830) (branch `claude/proposal-0104-local-places`). Git records the revisions of this file; the merge of that pull request with `status: accepted` records the decision.                                                                                                                                                                                                                                                                      |

## What changes

### 1. The behaviour today

The agent compiled this program with `compile()` at the review baseline on 2026-10-29:

```ts
for (let i = 0; i < 16; i++) {
  const p = items[u32(i)]; // items: storage<array<P>>, P holds an array<vec4f, 4>
  acc += p.pos.x * p.vel.y + p.w[i & 3].z;
  let h = probe(p, acc); // probe(p: P, k: f32): Hit
  if (h.ok) { acc += h.t; }
}
for (let j = 0; j < 8; j++) { best = probe(items[u32(j)], f32(j)); }
```

```wgsl
for (var i: i32 = 0; (i < 16); i = (i + 1)) {
  let p = items[u32(i)];
  acc += ((p.pos.x * p.vel.y) + p.w[(i & 3)].z);
  var h: Hit = probe_value(p, acc);
  ...
}
for (...) { best = probe_storage_read(&items[u32(j)], f32(j)); }
```

- Each iteration loads the whole storage element into `p`, its array field included, and
  indexes the copy at a dynamic index.
- `probe` then takes `p` by value, since `p` is a WGSL `let` and no place (Rule 8.26).
- `best = probe(...)` builds a `Hit` in the callee and copies it into `best`.
- On WebGL2, `const p = items[i]` is refused today: an emulated storage element read whole has
  no lane (`TS8015 … used without a .field access`).

Approximate counts over the 148 WGSL goldens at the baseline (a text search, so scalars are
included and the struct and array cases are not separated): 66 `let` declarations whose value
is an indexed or member read of a name, and 29 assignments or `var` initializers that store the
result of a call to a function of the module.

### 2. Item 1: a local copy that only reads a place is the place

A `const` or `let` local of a struct or array type whose initializer is a place (Rule 8.26's
list) reads that place instead of a copy when both of these hold for its whole scope:

- the local is never written, and never handed to a parameter the callee writes through;
- the place it copies is not written, by the function or by a function it calls, from the
  local's declaration to its last read, and no barrier runs between them when the place is
  memory other invocations share.

WGSL spells it as a pointer `let`, `let p = &items[u32(i)];`, read as `(*p).pos.x` and handed
on as `p` to a callee that takes a pointer. GLSL ES 3.00 binds each index expression of the
place to a `let` at the declaration and reads the place itself, `items[_i0].pos.x`, which also
lets the storage emulation read the element field by field. Where a condition fails, the local
stays a copy.

### 3. Item 2: a struct a call returns into a place is written there

`dst = f(...)` and `let dst = f(...)` (or `var`), where `f` is a function of the module that
returns a struct or a fixed-size array and `dst` is a local `var` or a field or element of one,
call a copy of `f` that writes its result through a pointer: `f_into(&dst, ...)`, each `return
e;` in it becoming `*dst = e; return;`. It holds only when:

- no argument of the call reads `dst` or a part of it, and the callee does not read the root of
  `dst` by name;
- every return path of `f` returns a value (a struct-returning function always does).

On GLSL ES 3.00 an `out` parameter is a copy out, so this item applies to WGSL only (Decision D1).

### 4. The amended rule

Rule 8.26 gains two paragraphs, one for each item, with the conditions above. Its title idea
stays: the compiler does not copy an object it does not need to copy, and keeps the copy where
the two could be told apart. The surface statement that a struct local is a copy (surface §26,
"a struct is a value here") stays true: the elision applies only where no program can tell the
local from its source.

## Why

A copy of a struct or array costs a memory load or move per element. A loop multiplies it. An
array field read at a dynamic index makes the driver keep the copy in addressable memory, and a
storage element read whole loads every field. The compiler already knows which locals are never
written and which places nothing writes, so it can remove the copy without relying on the
driver (change 0103 made the same argument for call arguments).

A local declared inside a loop is not itself the cost. A GPU compiler assigns registers to the
values that are live at once; a `let` names one of them. This proposal therefore targets the
copies, not the number of declared names. That is an inference, not a measurement on a GPU.

**Alternatives.**

| Alternative                               | Why it is not chosen                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| Hoist declarations out of loops           | Changes no copy and no live value; a per-iteration `let` is already one value per iteration. |
| Make every unwritten `var` a `let` only   | Removes no copy; drivers already treat both alike. It may ride along as a separate change.   |
| Return-value writes on GLSL through `out` | `out` copies back at return, so it removes nothing there.                                    |

## What it touches

- Rule 8.26: two paragraphs for items 1 and 2.
- Surface §26: a paragraph and a listing beside the one for change 0103.
- No export, no diagnostic code and no example changes. The WebGL2 refusal above is a `TS8015`
  message, and it stops occurring for a `const` copy of a storage element that only reads it.

### Draft impact estimate

Known work: a liveness check of each candidate local over its scope (writes to the local and to
the root of its place, calls and their write sets from `fnWrites`, barriers); the WGSL pointer
`let` and its uses; the GLSL substitution with bound indices; the `_into` copies for item 2 with
the argument and name checks; tests that read both halves for each case and each refusal; the
goldens baked again. Duration and cost: unknown, no basis for an estimate.

Decisions, resolved at acceptance (Approval and plan record):

- **D1.** Item 2 applies to WGSL only, as drafted. GLSL ES 3.00's `out` copies back at return,
  so it removes nothing there.
- **D2.** Item 1 applies to a `let` local that is never written, as well as to a `const`.

### Approval and plan record

The owner (Seungup) approved the proposal in the Claude Code session on 2026-10-29 (UTC), in
Korean ("승인"), in answer to the agent's report of D1 and D2 with a recommendation for each
(D1: WGSL only; D2: include an unwritten `let`). Both are accepted as recommended. The approved
revision is the one this record is part of. The merge of
[#830](https://github.com/typeshade/typeshade/pull/830) with `status: accepted` records the
decision.

Responsibilities: an agent of this repository implements items 1 and 2, Rule 8.26 and surface §26
in pull requests whose commits say `Change: 0104`. No milestone date is assigned. No duration or
cost estimate is established.

### Configuration and validation record

This record does not yet apply. Delivery will require the implementing pull requests with
`Change: 0104` commits; the required checks green on their heads; `bun run reqs:sync` and
`python scripts/doorstop-check.py -C` clean; `bun run docs:impact` worked through; the golden
diff read; and the counts of section 1 measured again on the new goldens.

## What it owes downstream

Nothing is expected: no export, page or skill names the emitted spelling of a local. The
implementing pull request searches `typeshade.github.io` and `vscode-typeshade` for the
listings it changes and amends `downstream` first if one does.
