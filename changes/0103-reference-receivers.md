---
id: '0103'
title: A call does not copy an object its callee only reads when the object is a place; WGSL passes a pointer and both targets read a module-scope place directly
status: draft
rules:
  - '8.10'
  - '8.11'
  - '8.25'
  - '8.26'
surface:
  - 26
  - 70
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The class lesson in src/i18n/en.ts (and its Korean pair in src/i18n/ko.ts) says `r.at(t)` calls `Ray_at(r, t)`; read it against the new spelling `Ray_at_function(&r, t)` and say that a method reads its object in place. The lowering excerpt that src/lib/typescript-lowering.ts picks by the names `Ray_at` and `hit` is read against the new function names. compiler-changes.md records 0103 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names a rule it will add -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0103, `status: draft`. The front matter is the identity and lifecycle authority. No approval exists. No implementation exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Date and attribution          | Authored 2026-10-29, UTC, by a Claude Code agent. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-10-29, in Korean. The owner observed that the WGSL a class method lowers to uses no pointer and so copies its object, and asked for pointers to be used more widely. After the agent's report, the owner asked whether a call without a pointer makes an unnecessary copy, and then decided that the rule must change, since the compiler can remove the copy and does not ("규칙을 변경해야겠는데요 컴파일 단계에서 최적화 가능한건데 안하는거잖아요"). No GitHub issue is recorded.                                                             |
| Applicability / effectivity   | `docs/language-design.md` (Rules 8.10, 8.11 and 8.25, new Rule 8.26), `reqs/` (the items of those rules), `docs/use-typeshade-surface.md` §26 and §70, the class-method lowering in `src/compiler/ts/lower/class-methods.ts`, the WGSL backend (`src/core/backends/wgsl.ts`), the GLSL ES 3.00 backend (`src/core/backends/glsl.ts`) and its storage emulation, the reference-alias check in `src/compiler/ts/lower/references.ts`, and the golden snapshots of emitted WGSL and GLSL. The CPU tiers, the exports, the diagnostic codes and the examples do not change. No release version is assigned. |
| Review baseline               | `main` at `b502924f415ed0f23a41e286e4fa424b9906ea25` (2026-10-29).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Review and revision authority | Pull request [#826](https://github.com/typeshade/typeshade/pull/826) (branch `claude/receiver-reference-proposal`). Git records the revisions of this file; the merge of that pull request with `status: accepted` records the decision.                                                                                                                                                                                                                                                                                                                                                                |

## What changes

### 1. The behaviour today

A method or a getter that only reads its object takes the object by value (surface §26). A method
that writes its object takes it by reference (Rule 8.10). The agent compiled four programs with
`compile()` at the review baseline on 2026-10-29 and observed this output:

```wgsl
fn Big_pick(self_: Big, i: i32) -> f32 {
  return (self_.xs[i].x + self_.a.x);
}
fn Big_twice(self_: Big, i: i32) -> f32 {
  return (Big_pick(self_, i) * 2.0);
}
fn Big_bump_function(self_: ptr<function, Big>, k: f32) { … }
fn Big_bump_private(self_: ptr<private, Big>, k: f32) { … }

let v = Big_twice(U, i) + Big_pick(b, i) + Big_pick(G, i) + Big_pick(R[u32(i)], i);
```

```glsl
float Big_pick(Big_value self_, int i) { … }
void Big_bump(inout Big_value self_, float k) { … }

float v = Big_twice(Big_value(U.a, U.b, U.xs), i) + Big_pick(b, i) + Big_pick(G, i);
```

- Each read-only call loads or copies the whole object: a uniform (`U`), a storage element
  (`R[u32(i)]`), a module variable (`G`) and a local (`b`).
- A read-only method that calls another one copies the object again at each level (`Big_twice`).
- GLSL ES 3.00 builds a new `Big_value` from the uniform block's fields at each call.
- A writing method on GLSL ES 3.00 copies its object in and out (`inout`), also on a module
  variable.
- On WebGL2, a read-only method called on a storage element is refused:
  `TS8015 Backend emit failed: glsl-es300 storage-emul: storage struct element 'R[i]' used
without a .field access`. The same program compiles for WGSL.

A plain function of the file that takes a struct or an array parameter, and does not declare it
`@inout` or `@out`, also takes it by value (§70). Its calls copy the argument in the same way.

### 2. The proposed rule

New Rule 8.26 states the requirement:

> **Rule 8.26.** A call must not copy an object, a struct or an array, that its callee only reads,
> when the argument is a place (Rule 8.10's list, a reference parameter included). The callee
> reads the caller's place. A copy remains only where a target has no way to reach the place, or
> where the place can change during the call by another route (below), and there the copy is
> taken at the call, as today.

The rule covers three arguments:

- the object of a method or a getter that reads its object only;
- the object of a base's body called through `super` that reads its object only;
- a struct or an array argument of a function of the file whose parameter carries no qualifier
  and is never written in the body (see Decision D1).

The rule does not cover a scalar, a vector or a matrix argument. A copy of one is a register move.

### 3. How each target spells it

The IR is not changed by this proposal. A pre-emit step, shared by the two backends, chooses how
each argument reaches its callee. The CPU tiers run the IR before that step and see the same
values.

| The place                                                                                                     | WGSL                                                    | GLSL ES 3.00                                                                                          |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| A local `var` (`let` in the source) or a reference parameter                                                  | `ptr<function, T>`: `Big_pick_function(&b, i)`          | `in T`, a copy (the target has no reference that reads only)                                          |
| A module variable (`var<private>`)                                                                            | `ptr<private, T>`: `Big_pick_private(&G, i)`            | A copy of the function that reads the global by name: `Big_pick_G(i)`                                 |
| A uniform binding, or a field or element of one                                                               | `ptr<uniform, T>`: `Big_twice_uniform(&U, i)`           | A copy that reads the block by name: `Big_twice_U(i)`                                                 |
| A storage element, or a field or element of one                                                               | `ptr<storage, T, A>`: `Big_pick_storage(&R[u32(i)], i)` | A copy that reads the emulated element field by field, its index a parameter: `Big_pick_R(u32(i), i)` |
| A workgroup variable, or a field or element of one                                                            | `ptr<workgroup, T>`                                     | Not reachable (GLSL ES 3.00 has no workgroup memory)                                                  |
| A value nothing holds: a temporary, a call's result, `new X()`, a `const` whose value something else may hold | By value, as today                                      | By value, as today                                                                                    |

- A function that receives a reference passes it on as a reference. `Big_twice_function` calls
  `Big_pick_function(self_, i)` with no copy.
- WGSL names each copy of a function by its address space, as the writing path does today
  (`_function`, `_private`, `_storage`). The GLSL copies for a module-scope place are named by the
  global they read.
- The GLSL copy for a module-scope place also serves a writing method. `G.bump(2.)` becomes
  `Big_bump_G(2.0)`, which writes `G` by name, and the `inout` copy goes away.
- A function that only one form ever reaches keeps one copy. A form no call uses is not emitted.

### 4. Where a copy remains

The callee reads the caller's place for the whole call. The value it reads differs from the copy
of today only when the place changes during the call. Three routes can change it, and on each one
the argument is passed by value, as today:

1. The callee, or a function it calls, writes the same root by its name: a module variable or a
   binding. Tint also refuses this pointer (Rule 8.25's measured table).
2. Another argument of the same call that the callee writes is a reference to the same root.
3. The place is a workgroup variable or a `read_write` storage element, and the callee, or a
   function it calls, runs a barrier. Another invocation's write becomes visible after the
   barrier, and the copy of today does not see it.

So no program computes another value after this change. The change removes copies only.

### 5. The amended rules

- **Rule 8.10.** The rule keeps its list of places and its refusals for a writing method. It gains
  one sentence: a method that only reads its object takes it as Rule 8.26 says, and a receiver
  that is not a place is accepted and copied.
- **Rule 8.11.** A getter takes its object as a reading method does, so Rule 8.26 applies to it.
  The rule's text names Rule 8.26.
- **Rule 8.25.** A reference that the callee only reads counts in the one-call check as a read. The
  rule says which reads fall back to a copy (section 4, items 1 and 2) instead of being refused.
  No refusal is added or removed.

## Why

**The copy is a cost the author did not write.** In TypeScript, `this` in a method is the object
itself, and an object argument is the object itself. An author who writes `items[i].area()`
expects a read of the fields the method reads. The emitted WGSL loads the whole element first.

**The driver does not remove every copy.** The facts and the inferences are separate here.

- Fact (WGSL specification): a parameter of a struct or an array type is a value. The call
  evaluates the whole argument.
- Inference, not measured on a GPU: a driver usually inlines the call. After inlining, it usually
  removes the loads and moves that nothing reads. A simple local receiver then costs nothing.
- Inference, not measured: a copy remains likely in these cases. An array field read with a
  dynamic index (`this.xs[i]`) needs the copy in addressable memory, and a SPIR-V writer spills a
  value array that is indexed dynamically into a function variable. A whole storage element loads
  every field when nothing proves the loads dead. A chain of methods copies at each level.
- Fact (observed at the baseline): GLSL ES 3.00 builds a new struct from the uniform block at each
  call, and refuses a method on an emulated storage element.

The compiler knows which callee reads which argument, and where each argument lives. It can remove
the copy in every case above. A rule that relies on the driver gives a cost that changes from one
driver to the next.

**Alternatives.**

| Alternative                                          | Why it is not chosen                                                                                                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wire `autoInline` (`src/core/passes/auto-inline.ts`) | It inlines a single-return helper only. It changes the bytes of every golden. It leaves a method with statements, a recursive chain and every GLSL uniform copy. |
| Pointer on WGSL only                                 | GLSL keeps the uniform rebuild, the `inout` copies and the storage refusal.                                                                                      |
| Specialize by the global on both targets, no pointer | A function-space local and a reference parameter cannot be reached that way, and the number of function copies grows with each module-scope place.               |
| Copy only above a size threshold                     | The size of a struct does not decide the cost. A dynamic index or a storage load decides it. A threshold adds a number that no rule can justify.                 |

## What it touches

- Rule 8.10: one sentence, for a method that only reads its object.
- Rule 8.11: a getter follows Rule 8.26.
- Rule 8.25: a read-only reference is counted as a read, and section 4 says when it falls back to a
  copy.
- Rule 8.26: new, the requirement of section 2.
- Surface §26: the text and the WGSL listing that show `Ray_at(self_: Ray, t: f32)` and the call
  `Ray_at(r, 1.0)` change to the new spellings, and the paragraph on a method that changes its
  object names the GLSL copy for a module variable.
- Surface §70: a struct or an array parameter with no qualifier is read in place (Decision D1).
- No export, no diagnostic code and no example is added or removed. The WebGL2 storage refusal
  above is a `TS8015` message, not a code, and it stops occurring for a read-only method.

### Draft impact estimate

Known work:

- A pre-emit step that classifies each struct or array argument of each call (place, its address
  space, its root, and the three fallback routes of section 4) and records the form each callee
  needs. It reuses the `fnReads` and `fnWrites` tables that `checkReferenceAliases` reads.
- WGSL: an address-space copy of each read-only function that a place reaches, as the writing path
  makes today.
- GLSL ES 3.00: a copy of each function for each module-scope place that reaches it, for reads and
  for writes, with the index chain of an element as parameters, through the storage emulation too.
- Tests that read both halves: `compile()`'s WGSL and GLSL for each row of the table in section 3
  and for each fallback route of section 4, with the language service's `getDiagnostics` on the
  same sources showing no new diagnostic; a CPU-oracle value equality for each row; the WebGL2
  storage program above compiling.
- The golden snapshots of emitted WGSL and GLSL baked again.

Compatibility: the emitted function names change (`Ray_at` becomes `Ray_at_function`,
`Ray_at_uniform` and so on). A host does not call these functions by name, so no export changes.
A page that quotes the emitted text changes (What it owes downstream).

Estimates: the duration and the cost are unknown. No basis for an estimate exists yet. The growth
in emitted function count is unknown until the goldens are baked; a program that calls one method
on four kinds of place gets up to four copies of it.

Decisions to resolve before acceptance:

- **D1.** Does Rule 8.26 cover a struct or an array argument of a plain function of the file, or a
  method's object only? This draft covers both. The owner's question named function calls.
- **D2.** WGSL storage, uniform and workgroup pointers as parameters need the language extension
  `unrestricted_pointer_parameters`. The writing path already relies on it for storage (coverage
  note of `src/core/coverage/wgsl.ts`). This draft uses it for the read path too. The other choice
  is the GLSL form on WGSL as well: a copy of the function that reads the binding by name, which
  needs no extension.
- **D3.** Downstream repositories outside this session (`vscode-typeshade`, `radiance`, `typenn`)
  were not searched for the old spelling. `typecv` was searched and names none.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decision in the conversation
or a review, the merge of the proposal-only pull request with `status: accepted`, the dispositions
of D1, D2 and D3, and the final impact declarations.

### Configuration and validation record

This record does not yet apply. Delivery will require: the implementing pull requests with
`Change: 0103` commits; `bun run test` (typecheck + unit), the compile gate (Tint + WebGL2) and the
user journeys green on their heads; `bun run reqs:sync` and `python scripts/doorstop-check.py -C`
clean after the rule edits; `bun run docs:impact` worked through; the golden diff read; and the
emitted function count before and after over `examples/*.shade.ts`, recorded with the commit.

## What it owes downstream

- **typeshade.github.io.** `src/i18n/en.ts` says that `r.at(t)` calls `Ray_at(r, t)`. The sentence
  is read against the new spelling, and its Korean pair in `src/i18n/ko.ts` too.
  `src/lib/typescript-lowering.ts` picks lines of compiled output by the names `Ray_at` and `hit`;
  the pick is read against the new function names. `compiler-changes.md` records 0103 when the pin
  moves.
- `typecv`: searched for `self_` and the emitted method spellings; none found. No work owed.
- `vscode-typeshade`, `radiance`, `typenn`: not searched (D3).
