---
id: '0150'
title: An explicit select(f, t, c) evaluates its three arguments, left to right
status: implemented
rules:
  - '7.9'
surface:
  - 10
  - 19
  - 26
  - 27
exports: []
exports-removed: []
codes: []
examples: []
names: []
downstream:
  - repo: typeshade.github.io
    what: The pages that quote surface §10 (the `select` row), §26 and §27 (en and ko) say that `select(f, t, c)` is the ternary's own IR, or say nothing of its argument order. Search them for "select(", "the ternary" and "WGSL's order". Each page follows the new text. compiler-changes.md records 0150
  - repo: vscode-typeshade
    what: The skill and any hover, completion or fixture text that says `select` compiles to the same code as a ternary follow the new text. compiler-changes.md records 0150
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0150, `status: implemented`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                |
| Date and attribution          | 2026-11-25, UTC (the drafting date). An AI agent (Claude Code) drafted it on the owner's decision of the same date, recorded below. The approval is recorded in the Approval and plan record below. This table row is attribution, not approval.                               |
| Applicability / Effectivity   | `src/compiler/ts/lower/expression-call.ts` (`lowerSelectCall`), `src/compiler/ts/sequence.ts`, `src/core/ir/nodes.ts`, `src/language-service/docs.ts`, `docs/language-design.md` Rule 7.9 and `docs/use-typeshade-surface.md` §10, §26 and §27. No release is assigned (OD-6). |
| Review baseline               | `main` at `49a41425ef40ef6eafa665c5d0c5dd7186081268`. Every "today" claim below was probed with `compile()` at this commit on 2026-11-25.                                                                                                                                      |
| Review and revision authority | The pull request that adds this file. Git records revisions. PR review and merge records establish decisions. The pull request is #1615.                                                                                                                                       |

## What changes

An author who writes `select(f, t, c)` writes a call. Its three arguments are evaluated, all of them, in the order they are written: `f`, then `t`, then `c`. A call that writes inside any of them takes effect in that order, on every target, whichever value `c` picks.

An author who wants one arm to run writes `c ? t : f`. The conditional forms stay as they are: `?:`, `&&` and `||` evaluate an operand only when TypeScript does (Rule 7.9).

### Fact: the two texts disagree

Facts, read at `main` `49a41425`:

- Rule 7.9 (`docs/language-design.md`, lines 715 and 716): "An expression must be evaluated left to right, as TypeScript and WGSL both evaluate it, and a call that writes … inside a larger expression must take effect in that order on every target." Line 716 adds: "a call TypeScript evaluates conditionally, in an arm of `?:` or the right operand of `&&` or `||`, keeps its condition as an `if`." The rule does not name `select`. The rule's own sources include WGSL's "Function call argument values are evaluated. The relative order of evaluation is left-to-right." (`docs/language-design.md`, Rule 7.9, Derives from).
- The surface (`docs/use-typeshade-surface.md`, line 840, §10): "`select(f, t, c)` | `c ? t : f`. **WGSL's order: the condition is last.** The same IR the ternary builds; a vector-of-bools `c` picks per component (§27)".
- The editor's text (`src/language-service/docs.ts`, line 303, `FUNCTION_DOCS.select`): "… Compiles to the same code as a ternary over `cond`."
- The doc comment above `lowerSelectCall` (`src/compiler/ts/lower/expression-call.ts`, lines 1396 to 1401) says the same: "It lowers to the `select` Expr op, the very node `cond ? trueValue : falseValue` already lowers to, so the two spellings are one IR". The comment at `sequence.ts` lines 468 and 469 says both arms are evaluated "in the order they are written", which is false for a vector condition today. The implementation removes it or makes it true. The comment of `expression-call.ts` sits above `lowerStructuredClone`, not above `lowerSelectCall` (line 1465).

TypeScript evaluates every argument of a call, left to right. The WGSL specification (section 11.2) says the same of a function call, and `select` is a builtin function there (section 17.3.3). The surface says `select` is the ternary. The ternary evaluates one arm. The two texts give an author two different programs.

### The owner's decision (2026-11-25)

On 2026-11-25 the orchestrating session showed the owner one example and two choices:

1. `select` is a function call. Its three arguments are all evaluated, in the order `f`, `t`, `c`. An author who wants one arm to run writes `?:`. The compiler, the surface line and the editor's text change.
2. `select` is another spelling of `c ? t : f`. The behaviour stays. Rule 7.9 names `select` as conditional.

The session recommended choice 1. The owner answered: "추천안을 승인할게요". The decision is choice 1. This proposal records it and rests on it. It adds no entry to `docs/owner-decisions.md`: the decision is about one builtin.

### Example before and after (OD-4)

Program B. `Rng` is the class of `src/compiler/ts/sequence.test.ts`, seeded with `500`: its first `next()` gives 0.7281508 and its second gives 0.3963825.

```ts
"use typeshade";

class Rng {
  state: u32;
  constructor(seed: u32) {
    this.state = seed;
  }
  bits(): u32 {
    this.state = this.state * 747796405 + 2891336453;
    return this.state >> 8;
  }
  next(): f32 {
    return f32(this.bits()) / 16777216.;
  }
}

@fragment
export function fs(uv: location<0, vec2>): vec4 {
  let rng = new Rng(u32(uv.x * 1000.));
  const v = select(rng.next(), rng.next(), uv.y > 0.5);
  return vec4(v, 0., 0., 1.);
}
```

Probed 2026-11-25 at `49a41425`, with `uv.x` 0.5. `compile()` reports no diagnostic, and the language service reports none.

| Input `uv.y` | Today: value of `v`, calls of `next()` | After this change: value of `v`, calls of `next()` |
| ------------ | -------------------------------------- | -------------------------------------------------- |
| 0.25 (false) | 0.728, one call                        | 0.728, two calls                                   |
| 0.75 (true)  | 0.728, one call                        | 0.396, two calls                                   |

Today the compiler writes an `if` with one call in each branch, so the result is the same for both inputs. After the change `f` runs first and `t` second. The condition picks the second value, as `select(f, t, c)` says.

An author who wants the old behaviour, one call, writes `const v = uv.y > 0.5 ? rng.next() : rng.next()`. This program stays as it is, and so does every `?:` (see the control below).

### Probes of the other programs

All values below were probed on 2026-11-25 at `49a41425` with `r.eval('fs', [[0.5, uv.y]])`. The WGSL emit of B and D2 was read. The GLSL emit was not read for these programs, so "the three outputs agree" is not re-checked here.

| Program                                                                                                | Today                                                                               | Left to right, all three evaluated           |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------- |
| A: `const m = vec2(uv.y) > vec2(0.5); const v = select(vec2(rng.next(), 0.), vec2(rng.next(), 1.), m)` | the second argument's call runs first: `v` = (0.396, 0) at 0.25, (0.728, 1) at 0.75 | (0.728, 0) at 0.25, (0.396, 1) at 0.75       |
| B: `select(rng.next(), rng.next(), uv.y > 0.5)`                                                        | an `if`, one call: 0.728 for both                                                   | 0.728 when false, 0.396 when true; two calls |
| C: `select(rng.next(), 5., rng.next() > 2.)`                                                           | the condition's call runs first: 0.396                                              | 0.728                                        |
| D2: `const x = select(rng.next(), 5., uv.y > 0.5); return vec4(x, rng.next(), 0., 1.)`                 | when true the first call is skipped: (5, 0.728)                                     | (5, 0.396)                                   |

Other builtins evaluate their arguments left to right today (probed the same way): `mix(rng.next() * 10., rng.next(), 0.5)` gives 3.839, `clamp(rng.next(), rng.next(), 2.)` gives 0.728 and `step(rng.next(), rng.next())` gives 0. Only `select` is out of order.

### The compiler: how the front end keeps the two forms apart

Facts about today's code:

- `lowerSelectCall` (`src/compiler/ts/lower/expression-call.ts`, line 1465) lowers each argument, checks the types and returns `{ op: 'select', type, cond, ifTrue, ifFalse }` (line 1548).
- `c ? t : f` lowers to the same IR op (`src/compiler/ts/lower/expression.ts`, line 382, and `scope.selectWithSetup` in `src/compiler/ts/context.ts`, line 1126, which builds a branch when an arm needs setup). The `??` lowering, the index lowering and the array-method lowerings build the same op too.
- `sequenceEffects` (`src/compiler/ts/sequence.ts`) runs on the IR that the front end built. Its header says "every consumer sees the one order: both writers, the CPU oracle, the codegen and the debugger". Its `select` case (lines 467 to 495) cannot tell the spellings apart. For a vector condition it sequences `cond`, `ifTrue`, `ifFalse` (that is not the written order `f`, `t`, `c`). For a scalar condition with an arm that writes, it emits `var t; if (cond) { t = ifTrue } else { t = ifFalse }`.
- Inference, not proved by a grep: a vector condition does not come from `?:`, because TypeScript's `?:` takes one `bool`. The vector branch then serves explicit `select` calls alone. The implementation confirms it in `lowerSelect`.
- The write sets of a callee (`writesOf`, `callWrites`) are computed inside `sequence.ts`, over the whole module. The lowering of one call does not have them (inference from the code read).

#### Design 1: a marker on the IR node, read by `sequence.ts` (proposed)

The design in three steps (proposal):

1. `lowerSelectCall` sets a marker on the node. Amendment A1, C(i), says where the marker lives: not in the public type `Expr`.
2. The `select` case of `sequence.ts` reads the field. For a marked node it calls `seqList` on `ifFalse`, `ifTrue`, `cond`, in that order, and builds no `if`.
3. A strip step removes the field from every marked node after sequencing, including a node with no call that writes.

Step 3 is needed. `seqExpr` returns early when an expression holds no call that writes (`sequence.ts`, line 392: `if (!hasWrite(e, fn)) return e;`), so a pure `select(0., 1., hit)` never reaches the `select` case. Without step 3 its marker would reach every pass and backend. An unmarked node keeps the code of today.

- Cost for the IR: none in the public type. Amendment A1, C(i): the marker is a property that one new file sets, reads and deletes. A consumer that does not read it is unchanged.
- Cost for the backends and the CPU oracle: none. After step 3 the WGSL writer, the GLSL writer, the CPU oracle, the codegen and the debugger see an ordinary `select`. Its arms hold no call that writes: each such call is a `let` ahead of the statement. This rests on the header claim quoted above (inference). `sequenceEffects` is called at `src/compiler/ts/source-file.ts`, line 463, after every function is lowered. The implementation must test it with the debugger and the codegen. It must also list the front-end passes that read the node before that line, such as the uniformity analysis of Rule 8.5.
- Cost for the other producers of `select` (`??`, index select, array methods, `?:`): none. Every constructor of `select` other than `lowerSelectCall` leaves the field unset (25 sites by `grep -rn "op: 'select'" src`). So `v ?? d` keeps its `if` when `d` writes (Rule 7.9). A pass that copies a node with `...e` would copy a marker, which is one more reason for step 3.
- A `select` without a call that writes in any argument emits the same text as today. The implementation holds this with the emit goldens of `examples/__emit-goldens__/` (`bool-select.wgsl`, `tile-pattern.wgsl` and the others that contain `select(`): the goldens must not change.

#### Design 2: bind each argument in the lowering

`lowerSelectCall` binds each argument that needs it to a temporary, in source order, with `scope.hoistTemp`, and then builds the plain node.

- Cost: the lowering must know which arguments write. That knowledge is in `sequence.ts`, so the lowering would copy it or run it. `hoistTemp` is allowed only where `canHoist()` is true (`src/compiler/ts/context.ts`, line 1106). Some positions may not be hoistable (inference), and then a second path is needed.
- Benefit: no new IR field. It spreads the order rule over two files.

#### Design 3: a separate IR node (`selectAll`)

- Cost: `case 'select'` appears in 45 matches (tests included) across the IR visitors, the passes, the CPU oracle, the codegen, the debugger, the fp64 pass and both writers (`grep -rn "case 'select'" src`). Each needs a twin or a shared branch, or `sequence.ts` rewrites the node first, which is Design 1 with a larger type change.

**Proposal: Design 1.** It changes shared code least. It keeps the order rule in `sequence.ts`, the one file that holds Rule 7.9. It hands every backend and the CPU oracle the IR they take today. A leftover marker is a risk. The implementation must test that no marker survives.

### The text of Rule 7.9

Proposed new text, added to line 716 of `docs/language-design.md` after the sentence on `?:`, `&&` and `||`:

> A call `select(f, t, c)` is a call, not a conditional: its three arguments are evaluated in the order they are written, `f`, `t`, then `c`, and a call that writes in any of them takes effect in that order on every target, whichever value `c` picks. An operand is evaluated conditionally only where TypeScript evaluates it conditionally, as in `?:`, `&&`, `||` and `??`.

The Rationale of Rule 7.9 (line 720) stays true: it names the scalar `?:` as the operator that lowers to `select`. No other rule names `select` as a conditional form (`grep -nE "\bselect\b" docs/language-design.md`: Rule 5.1, the table rows at lines 618, 619 and 656, Rule 7.9's Rationale, and the bool-vector rows at lines 1282, 1336 and 1368). The rows at lines 618, 619 and 656 describe what `?:` and `??` lower to, and stay true.

### The surface sentences that change

| Place                         | Sentence today                                                                                                                                               | New wording                                                                                                                                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §10, line 840 (the table row) | "`select(f, t, c)` \| `c ? t : f`. **WGSL's order: the condition is last.** The same IR the ternary builds; a vector-of-bools `c` picks per component (§27)" | "`select(f, t, c)` \| the value of `t` where `c` is true and of `f` elsewhere. **WGSL's order: the condition is last.** A call: `f`, `t` and `c` are all evaluated, in that order (Rule 7.9). Write `c ? t : f` to run one arm. A vector-of-bools `c` picks per component (§27)" |
| §27, lines 4560 to 4564       | "**`select(f, t, m)`** with a vector-of-bools condition picks per component, and the arms are vectors of the mask's size (TS8003 otherwise). …"              | Add after the first sentence: "The three arguments are evaluated in the order `f`, `t`, `m` (Rule 7.9)."                                                                                                                                                                         |

§26, lines 3539 to 3541. The sentence today is: "A call TypeScript runs conditionally keeps its condition: an arm of `?:` is an `if` rather than WGSL's `select`, which would evaluate both arms, and the right operand of `&&` or `||` is an `if` on the left one." Keep it. Add after it: "`select(f, t, c)` is a call, so it runs `f`, `t` and `c` in that order and keeps no condition: a call that writes in `f` or in `t` runs whatever `c` is."

Read and kept, because each stays true (the sentence names the operator that `?:` lowers to, or the IR's own representation):

- §13, lines 1403 and 1450 (`select` in a list of places a value keeps its origin).
- §19, line 2778 (a `select` as a statement is refused). Amendment A1, B adds one sentence there.
- §31, line 5034 and lines 5040 to 5058 (the cost rule and the hoisting of a costly arm). These sentences describe `?:`. A pure, costly arm of an explicit `select` may still be skipped by the optimizer, because no program can observe it. A call that writes is never skipped (inference from `select-composite.ts` and `sequence.ts`; the implementation must test it).
- §49, lines 6657 to 6666 (what the editor accepts).
- §54, lines 7502 and 7536 to 7538 ("A `?:` that picks a scalar or a vector is `select`, which evaluates both arms"). With Design 1 an explicit `select` evaluates all arms in the source too, so the sentence stays true.
- §76, lines 12590 and 12598 (the lowering of `??` and of optional comparisons).

`docs/ir-builder.md` (line 134, the `cond.select(a, b)` row, and lines 136 and 137) describes the IR builder's free `select(cond, a, b)`, a different surface with the condition first. It is not changed.

### The editor's text

`FUNCTION_DOCS.select` (`src/language-service/docs.ts`, line 302) today reads: "Returns `trueValue` where `cond` is true and `falseValue` where it is false, in WGSL's argument order: the condition comes last. Compiles to the same code as a ternary over `cond`." The hover on `select` shows this text through `renderJSDoc(FUNCTION_DOCS.select)` in `src/language-service/ambient.ts` (line 1604).

Proposed new text: "Returns `trueValue` where `cond` is true and `falseValue` where it is false, in WGSL's argument order: the condition comes last. A call: `falseValue`, `trueValue` and `cond` are all evaluated, in that order. Write `cond ? trueValue : falseValue` to evaluate one arm."

`src/__api__/surface.md` does not carry this sentence (`grep -rn "same code as a ternary" src docs reqs`: only `docs.ts`). The implementation runs `bun run bake:api-surface` only if the baked file changes.

### The tests (not written in this proposal)

The implementation adds one test file next to `src/compiler/ts/sequence.test.ts`. It uses `bothTake` of `src/core/testing/both-halves.ts` for each program, so the compiler and the language service read the same source (`CLAUDE.md`, A test reads both halves).

1. Programs A, B, C and D2 with `bothTake`, and the values of the table above through `agree`-style checks of the oracle, the codegen and the debugger (the shape of `agree` in `sequence.test.ts`). B asserts two `Rng_next` calls in the WGSL and in the GLSL.
2. The control: the test "an arm of ?: runs only when it is chosen, which select would not do" (`sequence.test.ts`, line 96) stays and passes unchanged.
3. A pure-argument control: `select(0., 1., hit)` (`sequence.test.ts`, lines 113 and 122) still compiles to the text of today.
4. A test that no marker is left in the IR after sequencing, for each program and for a pure `select(0., 1., hit)`.
5. A hover test: `bothTake(...).hover('select')` contains "all evaluated, in that order".
6. A test of `??` with a call that writes in `d`: it stays an `if`.

Expected effect on the gates (not yet observed): the compile gate (Tint and WebGL2) sees new WGSL and GLSL only for programs with a call that writes in an argument of `select`, and no example has one (below). The emit goldens must not change. The API-surface bake changes only if `docs.ts` text reaches `src/__api__/surface.md`, which the search above says it does not.

### Diagnostic

None. The rules call for none: Rule 7.9 already orders the expression, and a program that writes in an argument of `select` is valid TypeScript with a defined order. A note on "a call that writes in an argument whose value is discarded" would add a code (and so a criterion of `changes/README.md`) for a pattern the language does not refuse. If the owner wants a hint, it is a separate proposal.

## Why

Two normative texts gave an author two programs for one call. Rule 7.9 orders an expression left to right and lets only TypeScript's conditional forms evaluate conditionally. The surface said `select` is the ternary. The code followed the surface, and for a vector condition it followed neither text: it evaluated `cond` first, then `ifTrue`, then `ifFalse`, which is not the written order `f`, `t`, `c`.

Alternative (rejected by the owner's decision): name `select` as conditional in Rule 7.9. An author would then read a function call whose arguments are not all evaluated. TypeScript has no such call, and WGSL's `select` is not one. The owner chose the call (Rule 1.4 borrows the spelling and so the meaning).

## Owner's decisions

- OD-6 (nothing is released yet). The change of meaning of a program that relied on the old behaviour owes no warning release (Rules 13.9 and 13.10).
- OD-1 (TypeShade is a language of its own that borrows TypeScript's syntax). A call borrowed from TypeScript keeps TypeScript's evaluation of its arguments.
- OD-3 (the language stays small). The proposal adds no name, no code and no form. An author who wants one arm uses the form that already exists, `?:`.
- OD-9 (a program need not translate one-to-one into a target). The compiler may write the explicit `select` in the target as it chooses, if the order and the values hold.
- OD-4 (show the owner what changes). The example above shows one program before and after.

This proposal reverses no entry. The decision of 2026-11-25, recorded above, is the only one it adds, and it stays in this proposal.

## Why the compiler cannot do it

Not applicable: this proposal adds no author-facing name, rule, diagnostic code or surface form. It fixes the reading of one builtin. The compiler cannot choose that reading for the author. Whether an arm runs is visible in the program's result (program B), so the owner decides it, and did.

## What it touches

- Rule 7.9: names an explicit `select` as a call whose arguments are evaluated in source order.
- Surface §10, §19, §26 and §27: the places in the table above, and the sentence that Amendment A1, B adds to §19.
- Compiler: `src/compiler/ts/lower/expression-call.ts` (`lowerSelectCall` sets the marker; the misplaced doc comment at lines 1396 to 1401 is rewritten), and `src/compiler/ts/sequence.ts` (the `select` case), with the new file `src/compiler/ts/sequence/ordered-select.ts` that holds the marker (Amendment A1, C(i)). `src/core/ir/nodes.ts` does not change.
- Editor: `src/language-service/docs.ts` (`FUNCTION_DOCS.select`).
- Doorstop items (`reqs/`): `RULE-0709` (the text changes; its `references` list `src/compiler/ts/sequence.ts` and `sequence.test.ts`, and the new test file carries `Verifies: Rule 7.9`), and `SURF-010`, `SURF-019`, `SURF-026` and `SURF-027`. The implementation runs `bun run reqs:sync` and `python scripts/doorstop-check.py -C`, and a person reads each flagged item before `doorstop review`.
- `CHANGELOG.md`: one entry, "an explicit `select` evaluates its three arguments left to right", with the cost to authors.
- Examples: none changes. Command: `grep -rnE "(^|[^.A-Za-z_0-9])select\(" examples docs site README.md AGENTS.md src/__api__` outside `__emit-goldens__`, `docs/use-typeshade-surface.md` and `docs/language-design.md`. Found: `examples/gallery/packing-bitcast/packing-bitcast.shade.ts` (line 82) and `examples/gallery/bool-select/bool-select.shade.ts` (line 33), both with pure arguments, `examples/gallery/pick-composite/pick-composite.shade.ts` (line 16, a comment), and `examples/PORTING.md` (lines 562 and 565). No example has a call that writes in an argument of `select`. `examples/PORTING.md` line 565 says that `c ? 1. : 0.` "lowers to `select(...)`, so it is the spelling" of it. It stays true for `?:`. The implementation reads it and fixes it if it says an explicit `select` is the ternary.
- Documents that call `select` with an argument that writes: none found, by the same command. Tests: `src/compiler/ts/sequence.test.ts` uses `select(0., 1., hit)` with pure arguments, and no test asserts an explicit `select` with a call that writes (the same command over `src`, filtered for `.next(`, `.bits(` and `()` calls).

### Draft impact estimate

Known: one optional IR field, one `case` of `sequence.ts`, one line of `lowerSelectCall`, one docs string, three surface sentences, one rule sentence, one test file. Not estimated: time. The cost of the change to authors: a program that relied on the old behaviour gives a different result (program B). An arm that is expensive, or that discards its value, runs in every explicit `select` where it writes. A pure arm may still be skipped by the optimizer. Nothing is released (OD-6), so no warning release is owed.

### Independent review record

Reviewer: a Sonnet sub-agent that did not write this proposal, on 2026-11-25. Revision reviewed: `d2cc74059926f17c9093d1037e2d1a69985cffcc`. It checked quotations against file and line, missed `select` and ternary text, design claims against the code and the writing rules. It gave 15 findings. Answer: all fixed in the later commits of this pull request (one finding, the marker left on a pure `select`, changed the design to its three steps). The findings are not listed one by one here. Git holds the reviewed text and the fixes.

### Approval and plan record

- Decision: the owner approved the proposal in the conversation of the orchestrating session on 2026-11-25, after reading the example before and after, the Rule 7.9 sentence, the hover text, the design and the downstream facts. The owner's words: "머지 승인" (English: merge approved). The orchestrating session relayed the decision to this session.
- Earlier decision, same date: the choice of `select` as a function call, recorded under "The owner's decision (2026-11-25)" above.
- Approved revision: the text at head `1c7a9057b5d06e9daf1f3bd31e429c6484cd304b` of pull request #1615. The commit that sets `status: accepted` changes this file's status, the document-control rows and this record, and nothing else.
- Responsibilities: unassigned. The implementation pull requests are not yet assigned to an actor.
- Milestones: not agreed. No schedule is set.
- Required validation: stated in the tests section and in the next record.

### Amendment A1. The Rule 7.9 sentence names `??`, §19 is read against `select`, and the marker is not a field of `Expr` (2026-11-25)

- [fact] Why, the Rule 7.9 sentence. The last sentence that this proposal adds to Rule 7.9 says "Only `?:`, `&&` and `||` evaluate an operand conditionally." It is false. Surface §76 says of `v ?? d` "an `if` when `d` writes, so `d` runs only when `v` is absent (Rule 7.9)", and lowers `v ??= d` to `if (!v.present) { v = d; }`. The implementing session probed `compile()` on 2026-11-25. `const x = v ?? rng.next();` emits `if (v.present) { _seq0 = v.value; } else { _seq0 = Rng_next(&rng); }` on WGSL and the same shape on GLSL. `v ??= rng.next();` emits `if ((v.present == false)) { let _seq0 = Rng_next(&rng); v = _opt_f32_(_seq0, true); }`.
- [fact] Why, §19. Surface §19 lists "a `select`" under "**A value that is not a call may not**", the statement form. The behaviour does not change. On the implementing tree `select(rng.next(), rng.next(), c);` is still `TS8099` ("... builds a value and drops it. Only a function call may stand alone as a statement; assign the value or remove the line.") and `_ = select(...)` is still `TS8099` ("... is not one, so there is nothing to drop; remove the line."). The wording reads against the new sentence "`select(f, t, c)` is a call".
- [decision, owner, 2026-11-25] "추천대로" (English: as recommended), after the owner read the two sentences below with their before and after. The owner approved the merge of this amendment in advance.
- A. Rule 7.9, the second added sentence.
  - Before: "Only `?:`, `&&` and `||` evaluate an operand conditionally."
  - After: "An operand is evaluated conditionally only where TypeScript evaluates it conditionally, as in `?:`, `&&`, `||` and `??`."
  - The first added sentence does not change. The body above gives the new sentence.
- B. Surface §19. After the sentence that ends "... with the two ways out, assign the value or remove the line.", add: "An explicit `select(f, t, c)` is a call for the order of its arguments (Rule 7.9); as a statement it is still refused, because it builds a value and drops it." The front matter `surface:` list gains `19`. "What it touches" gains §19 and `SURF-019`.
- C. Deviations of the implementation that this amendment makes part of the approved text. The implementing session is `session_017fz53TkADmmzDGUZF8WKiC`. It holds the evidence. Its pull request is #1621.
  1. The marker of Design 1 is not a field of the public type `Expr`. It is a property `__orderedSelect`. Only the new file `src/compiler/ts/sequence/ordered-select.ts` sets, reads and deletes it. The type is declared there and is absent from the public type. `src/core/ir/nodes.ts` and `src/__api__/surface.md` do not change, and `exports` stays `[]`. Reason: a field of `Expr` changes an export that this proposal does not declare. A symbol key is lost by `cloneIr` (`src/compiler/ts/context.ts`), which the implementing session reproduced with `for (let i = 0; i < 3; i++, s = select(rng.next(), rng.next(), uv.y > 0.5))`. "What it touches" drops `src/core/ir/nodes.ts` and names the new file.
  2. The hover text keeps its approved wording, with `cond ? trueValue : falseValue`. The prose-style check of `src/language-service/docs.test.ts` refused any `?`. It now exempts a `?` inside a backtick code span, with a control test.
  3. The sentence of this proposal that says the API-surface bake changes only if `docs.ts` text reaches `src/__api__/surface.md` stays true with item 1.
- D. Open item, not decided. Whether `select(...)` may stand as a statement like another value-returning builtin (`max(a, b);`), and the two `TS8099` sentences that call it "not a call". It is outside this proposal. A separate proposal follows if the owner asks.
- Corrected places of the body. The Rule 7.9 sentence, the front matter `surface:` list, step 1 of Design 1, the cost for the IR, the compiler and Doorstop lines of "What it touches", and the §19 line of the kept list now follow A to C.
- Status: `status: accepted` does not change. Delivery of this amendment is added to "Configuration and validation record" when the implementation merges.

### Configuration and validation record

Delivered by pull request #1621 (`Change: 0150`), with the pure move #1626 (merge commit `226f47561001a38c21897784ff0db59ae34bca4e`) that made room in `src/core/ir/nodes.ts` before the design changed. Amendment A1 is `c1168a6a953eb2c7287f0f1cd0e0007f2fb232fd` (#1643). The implementing session is `session_017fz53TKADmmzDGUZF8WKiC`; the orchestrating session `session_017fz53SGjwDwHVKa9RHKiEm` recorded the Doorstop reviews (the owner's decision of 2026-11-25).

Delivered configuration: the front end marks the node that `lowerSelectCall` builds with the property `__orderedSelect` (`src/compiler/ts/sequence/ordered-select.ts`). The `select` case of `sequenceEffects` reads it and takes the ordered path (`f`, `t`, `c`, no `if`), and the same path for any `select` with a vector condition. `stripOrdered` deletes the property before the module leaves the front end. `src/core/ir/nodes.ts` and `src/__api__/surface.md` do not change. Rule 7.9, surface §10, §19, §26 and §27, `FUNCTION_DOCS.select` and the prose check of `src/language-service/docs.test.ts` carry the approved texts.

Functional validation, 2026-11-25, on head `0decf9cfc` of the pull request (the tree of this record differs only by this file): `bunx tsc --noEmit -p tsconfig.json` and `-p tsconfig.tests.json`: clean. `bun run lint`, `bun run format:check`, `bun run docs:refs` (0 dead references): pass. `bun scripts/bundle-boundary.ts`: no FAIL line. `bun scripts/changes.ts --base origin/main`: Rule 7.9 and surface §10, §19, §26, §27, no export. `bunx vitest run` of `src/compiler/ts/sequence-select.test.ts` (22 tests), `sequence.test.ts`, `src/language-service/docs.test.ts`, `src/api-surface.test.ts`, the file-size, comment, layer and both-halves policy tests, `src/reqs.test.ts` and `examples/emit-goldens.test.ts`: 164 pass, the emit goldens unchanged. A run of `src/*.test.ts`, `src/compiler/ts`, `src/language-service`, `src/core/ir` and three example tests on an earlier tree: 535 of 540 files pass; the failures are the 11 tests of `src/affected-tests.test.ts`, `src/doc-test-selection.test.ts` and `src/publish-manifest.test.ts`, which fail the same way on `origin/main` in this container, and the `?` check of `docs.test.ts`, fixed afterwards. Mutations that fail the new tests: the marker not set, `stripOrdered` not called, the vector guard of the `select` case removed, the hover text changed, the code-span exemption of `docs.test.ts` removed. The compile gate (`bun run gate:compile`) did not run in this container (no Playwright browser); CI runs it.

Document validation: `bun run reqs:sync` changes nothing at the head; `python3 scripts/doorstop-check.py -C -e -F` prints no warning.

Deviations, all closed by Amendment A1: the marker is the property `__orderedSelect` and not a field of `Expr`, because a field changes an export that this proposal does not declare and a symbol key is lost by `cloneIr` (reproduced with `for (let i = 0; i < 3; i++, s = select(rng.next(), rng.next(), uv.y > 0.5))`); the prose check of `docs.test.ts` exempts a `?` in a code span; the files `src/compiler/ts/sequence/ordered-select.ts`, `src/language-service/docs.test.ts` and the two baselines changed beyond the first touch list. Pending outside this repository: the texts of the site (`typeshade/web`) and the compiler-changes records of the downstream repositories, as the sections above list.

## Open items and out of scope

- Other builtins: `mix`, `clamp` and `step` evaluate their arguments left to right today (probed above), and `sequence.ts` gives no builtin call other than `select` a special case among the cases of `seqExpr`: `call`, `binop`, `compare`, `unop`, `construct`, `member`, `index`, `logical` and `select` (`src/compiler/ts/sequence.ts`, `seqNode`, lines 405 to 495). The proposal does not widen to them.
- The producers of `select` that are not an explicit call (`??`, index select, array methods) keep their behaviour. Whether the marker is better named by what it says (`ordered`) or by what it forbids is an implementation choice.
- The editor does not report a call that writes inside an argument of `select`. No diagnostic is proposed.

## What it owes downstream

This session searched no downstream repository itself. The orchestrating session searched local checkouts on 2026-11-25 and reported the facts below. This session did not re-run the search (reported fact).

### Search of downstream sources

Each HEAD equals `origin/main` of its repository after `git fetch origin main`. The command, for each repository `$d`, from the parent directory of the checkouts:

1. `grep -rl --include=*.ts -e '"use typeshade"' -e "'use typeshade'" $d --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git`
2. `grep -nE -A3 '\bselect\(' <those files>`
3. A reader read the first two arguments of every site.

| Repository            | Commit                                     | Files with the directive | Lines with a `select(` call                                                  | Sites with a call that may write in the first or second argument |
| --------------------- | ------------------------------------------ | ------------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `typeshade/typeaudio` | `714ecbf7e4307f73f7942bbef46db543c7234f1c` | 59                       | 4                                                                            | 0                                                                |
| `typeshade/typecv`    | `3df1921bdc1c86f9e24de80bff244500436f2c5d` | 42                       | 65 (67 calls: two lines nest a `select`)                                     | 0                                                                |
| `typeshade/typenn`    | `794aa4679630fa3f1d889ab29e30ef6a03cfbcf3` | 10                       | 17                                                                           | 0                                                                |
| `typeshade/typeplot`  | `e8a0eb97a0ffa6e32aec124557db859b8f584bf5` | 16                       | 0                                                                            | 0                                                                |
| `typeshade/web`       | `7a8d29265cdcbaa25a02f2908bdcd59591d49242` | 45                       | 12 (6 are TypeShade calls; the rest are host calls such as `input.select()`) | 0                                                                |

The calls found in a first or second argument are builtins and constructors only: `max`, `min`, `abs`, `sqrt`, `f32`, `u32`, `vec2`, `bitcast` and a nested `select`. The one user function near a `select` is in the third argument (`typeaudio` `study.ts:264`, `uniform(hash32(...))`, both pure). The change does not move a third argument.

No downstream source changes its result under this proposal. The site owes text, below.

Not searched:

- `node_modules` and `dist`.
- Compiler-emitted WGSL and GLSL inside generated manifests (`typeplot/examples/generated/*.js`, `web/apps/typeshade/public/benchmarks/artifacts/*.js`).
- TypeShade source that a host builds at run time by string interpolation (`typeaudio` src/graph/compiler/emitGraphSource.ts in typeaudio and the `study.ts` templates), beyond the literal `select(` text in them.
- Radiance, and any repository outside the five above.

### What the site owes

The site (`typeshade/web` at `7a8d2926`, the repository that holds `typeshade.github.io`'s content) changes in its own pull request after its pin moves. These are the texts that the change makes false or incomplete (reported fact):

- `apps/typeshade/content/guide/ko/values-and-mutation.md:105` says that `select(f, t, c)` is the same as `c ? t : f`. After this proposal that holds only when no argument writes. The page follows the new text.
- `apps/typeshade/src/i18n/en.ts:3839` and `apps/typeshade/src/i18n/ko.ts:3988` say "A scalar choice is the ternary here and `select` on WGSL, so one name serves both". The implementation reads it against the new text and records whether it stays true. It is open.
- `apps/typeshade/content/guide/ko/control-flow.md:107` says that the ternary computes both branches and then picks one, "like WGSL's `select`". That sentence is about `?:`. It is already imprecise against Rule 7.9 today. This proposal does not cause it and does not own the fix. It is an observation.
- `typecv` `docs/audits/2026-10-27-typescript-surface-gaps.md:128` and `:465` record that `select(f, t, c)` and `c ? t : f` emit identical WGSL and GLSL at that pin (row Q63, 66 calls). That stays true for those 66 calls, because no argument writes. The audit is a dated record and owes nothing.
- apps/typeshade/content/api/ko/select.json in typeshade/web describes the builder function `select(cond, ifTrue, ifFalse)` of `ReadonlyNode`, which is another surface with the condition first. This proposal does not touch it: the builder builds the IR node (`src/core/ir/node.ts`, line 792) without the marker, so its behaviour stays as it is.

### Per repository

- `typeshade.github.io` (content in `typeshade/web`): the pages above follow the new text. Pending.
- `vscode-typeshade`: not searched. Its skill and fixtures may say that `select` compiles to the same code as a ternary. Pending.
- `typenn`, `typecv`, `typeaudio`: no source change. Each records `0150` in its `compiler-changes.md` when its pin moves. Pending.
- `radiance`: not searched. Pending, and unknown.
