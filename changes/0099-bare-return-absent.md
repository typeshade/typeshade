---
id: '0099'
title: A bare `return;` and a path that ends the body are the absent value in a function with an optional result, as TypeScript reads them
status: draft
rules:
  - '7.2'
  - '7.10'
  - '8.19'
surface:
  - 14
  - 76
exports: []
exports-removed: []
codes: []
examples:
  - optional-values
downstream:
  - repo: typeshade.github.io
    what: The TypeScript guide's optional-value paragraph and the types page say `return undefined;` is the absent value and a bare `return;` is refused; say that a bare `return;` and a fall-through are the absent value too, and record 0099 when the pin moves.
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0099, `status: draft`. The front matter is the identity and lifecycle authority. No approval and no implementation are recorded.                                                                                                                                                                                                                                                                                                                                                                                                      |
| Date and attribution          | Authored 2026-10-27, UTC, by a Claude Code agent. The date is the authorship date. It is not an approval or a delivery date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                             |
| Request source                | The owner (Seungup) asked in a Claude Code session on 2026-10-27, in Korean, whether a bare `return;` should be allowed too ("그냥 return; 도 허용해야하는거 아니야?"), after asking whether `null` was left out of change 0088, and approved opening this proposal ("승인"). Change 0088 refused both forms by its decision D5, and change 0098 repeats the refusal for an optional that admits `null`.                                                                                                                                       |
| Applicability / effectivity   | The front end's lowering of a function body with an optional result (`src/compiler/ts/lower/function.ts`: the `return` check and the end-of-body check), the return-type inference of a function that writes no result type (Rule 8.19), the editor's diagnostics over the same programs (Rule 12.7), surface §14 and §76, `examples/optional-values.shade.ts`. The IR, the three backends and the CPU oracle are not affected: the absent value they receive is the one `return undefined;` already produces. No release version is assigned. |
| Review baseline               | `main` at `d0ce8843b65a4dd5a2f676a74a4d5933b2ddae13` (2026-10-27), which carries changes 0088 and 0093 as implemented and proposal 0098 as accepted (#784).                                                                                                                                                                                                                                                                                                                                                                                    |
| Review and revision authority | The proposal-only pull request that carries this file. Git records its revisions; the pull request's merge with `status: accepted` records the decision, on the owner's instruction above. No PR is assigned at authoring time; the number is recorded below once it exists.                                                                                                                                                                                                                                                                   |

## What changes

### The proposal in one paragraph

In a function whose result is `T | undefined`, a bare `return;` and a path that reaches the end
of the body without a `return` are the absent value, exactly as `return undefined;` is. TypeScript
reads both that way when the declared result includes `undefined`, and infers `T | undefined` for
a function with no written result whose `return;` stands beside a `return v;`. Change 0088 refused
both forms (decision D5, `TS8021`) so that the absent case would be spelled `return undefined;`.
This change lifts the two refusals and keeps every other one: a bare `return;` in a function whose
result is a plain `T` stays `TS8021`, as TypeScript's TS2322 refuses it, and a function with no
written result that returns `undefined` and no value stays `TS8021` (Rule 8.19), since nothing
says what `T` is.

### Before and after

```ts
"use typeshade";
export function root(x: f32): f32 | undefined {
  if (x < 0.) {
    return;
  }
  return sqrt(x);
}
export function firstPositive(a: f32, b: f32): f32 | undefined {
  if (a > 0.) return a;
  if (b > 0.) return b;
}
export function half(x: f32) {
  if (x < 0.) return;
  return x * 0.5;
}
```

Before: `root` is `TS8021 Function "root" returns f32 | undefined but has a bare "return". Write
"return undefined;" for the absent case (Rule 7.10).`; `firstPositive` is `TS8021 "firstPositive"
returns f32 | undefined, and a path ends its body without a "return". Write "return undefined;" for
the absent case (Rule 7.10).`; `half` is the bare-return sentence too, since its first `return`
with a value makes it an `f32` function and the bare `return` does not fit (Rule 8.19).

After: all three compile, with no diagnostic from the compiler and none from the editor (Rule
12.7). `root` and `firstPositive` return `__opt_f32`, and the bare `return` and the fall-through
each return the absent value, `__opt_f32(0.0, false)`, the value `return undefined;` returns
today. `half` returns `f32 | undefined`, as TypeScript infers it, and the editor hovers it so.
The WGSL, the GLSL ES 3.00 and the CPU oracle are the ones the same functions written with
`return undefined;` produce today, byte for byte, since the lowering reaches the same IR.

### Proposed behavior

**A bare `return;`** (Rule 7.10). In a function whose result is an optional, written or inferred,
a bare `return;` lowers as `return undefined;` does: the absent value of the result type. A
constructor's bare `return` keeps its meaning (it returns the struct it built), and a method that
writes through its receiver keeps its bare returns, since neither has an optional result.

**A path that ends the body.** In a function whose result is an optional and whose body a path
can leave without a `return`, the end of the body is the absent value, as TypeScript reads it: the
lowering appends `return undefined;` to the body where today it refuses. A function whose result
is a plain `T` keeps the IR lint's `all-paths-return` refusal.

**Inference** (Rule 8.19). A function that writes no result type takes the type of its first
`return` with a value, as today; a bare `return;` before or after it, and a path that ends the
body, make the result `T | undefined`, as a `return undefined;` does today (change 0088). A
function whose returns are all bare, or that has none, returns nothing, as today. A function
whose only returns are bare `return;` and `return undefined;` keeps the `TS8021` sentence that
asks for a result type, since nothing says what `T` is.

**The editor** (Rule 12.7). TypeScript reports nothing on any of the three programs above, and
after this change neither does the compiler, so the editor's merged list is empty where it was
one sentence. The hover of `half` reads `f32 | undefined`.

**The host face** (Rule 8.21) is unchanged: a function with an optional result has no host value
(change 0088, decision D4), whichever form spells the absent case.

### Exclusions

- A bare `return;` where the result is a plain `T`: refused as today (`TS8021`), as TypeScript
  refuses it (TS2322).
- `return null;` and `return;` in a function whose result admits `null` (change 0098): 0098's
  "Refusals" paragraph lists the bare `return;` and the fall-through among the refusals it
  inherits from Rule 7.10. This proposal lifts them there too, with the same absent value 0098
  gives `return undefined;` for `T | undefined` and `return null;` for `T | null`; for the
  three-state type `T | null | undefined`, a bare `return;` and the fall-through are
  `undefined`, as TypeScript reads them. Decision D3 records it; 0098's file gains an amendment
  note when this proposal is accepted.
- A `return;` in an entry point, a kernel function or a getter: unchanged, since none has an
  optional result (Rule 7.10's refused positions).

## Why

### The problem

Change 0088 chose `return undefined;` as the one spelling of the absent case and refused the two
others TypeScript accepts (decision D5). The reason recorded was legibility: the absent case
reads as a value, not as a missing one. The cost is a divergence from TypeScript that Rule 7.2
does not record: a program TypeScript accepts, in which every type is known, is refused by the
compiler with a sentence that asks the author to write what TypeScript already infers. The owner
reads it as a gap, and the compiler's own rule for lowerings (Rule 7.2) asks that a mapping follow
TypeScript's meaning where WGSL can carry it. Here it can: the absent value exists, and the
lowering of `return undefined;` already produces it.

### Evidence

- TypeScript, under `strict`, accepts `function f(x: number): number | undefined { if (x < 0) return; return x; }` and `function g(a: number, b: number): number | undefined { if (a > 0) return a; if (b > 0) return b; }` (TS2366 does not fire when the result includes `undefined`), and infers `number | undefined` for `function h(x: number) { if (x < 0) return; return x; }`. The ambient-parity test (`src/language-service/ambient-parity.test.ts`) will pin the three.
- The compiler's two refusals are front-end checks on `src/compiler/ts/lower/function.ts`: the `return` loop that refuses a `return` with no expression, and the end-of-body check that runs when `!alwaysReturns(body)` and the result is optional. Both sit after the body is lowered, where `absentOf(stub.ret)` is available.
- `src/compiler/ts/optional-values.test.ts` pins both refusals today ("a bare return in an optional function", "a path that ends an optional function without a return is TS8021 naming return undefined (D5)") and will pin the acceptance instead, in both halves.

### Alternatives

- **Keep the refusal, record the divergence in Rule 7.2.** Honest, and cheaper by a day, but it
  keeps a refusal of a program that is correct in TypeScript and has an exact WGSL meaning, which
  Rule 7.2 reserves for forms WGSL cannot carry.
- **Allow the bare `return;` and keep refusing the fall-through.** TypeScript treats them alike,
  and a reader who learns one expects the other. Rejected.
- **Allow both.** Chosen.

## What it touches

- **Rule 7.2.** The optional-value rows gain one: a bare `return;` and a path that ends the body
  of a function with an optional result lower to the absent value; no divergence.
- **Rule 7.10.** The refusal list loses "a bare `return;` in a function with an optional result"
  and "a path that ends such a function's body without a `return`"; the `TS8021` sentences the
  "Enforced by" line quotes for them go.
- **Rule 8.19.** A bare `return;` beside a `return` with a value makes the result `T | undefined`,
  as `return undefined;` does; the sentence "a bare `return` beside one with a value" in the
  refusals of Rule 8.19's neighbour (surface §14's list) is narrowed to a result that is a plain `T`.
- **Surface §14.** The refusal "a bare `return` beside one with a value" says "where the result is
  a plain `T`".
- **Surface §76.** "A function result": the two sentences that refuse a bare `return;` and a
  fall-through are replaced by the sentences that accept them.
- **Codes.** None added or removed. `TS8021` loses two sentences; its other sentences stay.
- **`examples/optional-values.shade.ts`.** One function of the example spells its absent case with
  a bare `return;`, so the example and its emit goldens show the form; its blurb says so.
- **0098.** Its "Refusals" paragraph loses the two items by this proposal (decision D3).
- **Tests.** `src/compiler/ts/optional-values.test.ts` (both halves of the three programs, the
  inferred result, the exclusions); `src/language-service/ambient-parity.test.ts` (the hover and
  the empty merged list); `src/compiler/ts/return-inference.test.ts` and
  `src/compiler/ts/newline-return.test.ts` keep the plain-`T` refusal.

### Draft impact estimate

- **Compiler.** Two sites in `src/compiler/ts/lower/function.ts`: the `return` loop substitutes
  `absentOf(stub.ret)` for a missing expression when `isOptional(stub.ret)`, and the end-of-body
  check appends the absent return instead of refusing. Inference: the collection of pending absent
  returns (`pendingAbsentReturns`) counts a bare `return;` as it counts `return undefined;` when
  the function writes no result type. Estimated at one day with the tests; the basis is the size
  of change 0088's `return undefined;` path, which this reuses.
- **Compatibility.** Programs that compile today compile unchanged. Programs refused today by the
  two sentences compile after. No emitted text of an accepted program changes.
- **Documents.** Rules 7.2, 7.10, 8.19; surface §14 and §76; `AUTHORING.md`'s optional-value
  section; `CHANGELOG.md`; `reqs/` after `bun run reqs:sync`.
- **Downstream.** typeshade.github.io: the guide paragraph and the types page's sentence named in
  the front matter, and the Korean translations of the same; no error-code program changes (the
  site's `TS8021` program is a plain-`f32` function). vscode-typeshade: none expected; the
  diagnostics it shows come from the compiler.
- **Unknown.** Whether `alwaysReturns` treats a `switch` with a `default` and a loop that always
  returns as TypeScript's control-flow analysis does; a difference would make the appended absent
  return unreachable, which is harmless, or missing, which the IR lint catches. Measured in the
  implementation.

### Decisions

- **D1. A bare `return;` in a function with an optional result.** Proposed: the absent value, as
  TypeScript reads it.
- **D2. A path that ends such a function's body.** Proposed: the absent value, as TypeScript
  reads it; the lowering appends the return.
- **D3. The same two forms under change 0098.** Proposed: lifted there too; for
  `T | null | undefined` the absent value is `undefined`, as TypeScript reads a bare `return;`.
  0098's file records the amendment at acceptance.
- **D4. A bare `return;` where the result is a plain `T`.** Proposed: refused as today.
- **D5. A function whose returns are all bare or `return undefined;`, with no result type.**
  Proposed: refused as today (`TS8021`, Rule 8.19), since nothing says what `T` is.

### Approval and plan record

This record does not yet apply. Acceptance will require: the owner's decision on this pull
request, the approved revision of this file, and the agreed milestones (the implementation pull
request, the documents and the site's pin). No approver, schedule or result is recorded here.

### Configuration and validation record

This record does not yet apply. Delivery will require: the implementation commits and pull
request, the configuration (`main` commit, tool versions), the functional evidence (the tests
above in both halves, the emit goldens, the compile gate on Tint and WebGL2, the CPU oracle) and
the document evidence (`bun run docs:impact`, `bun run reqs:sync`, `python scripts/doorstop-check.py -C`).

## What it owes downstream

- **typeshade.github.io.** The TypeScript guide's optional-value paragraph (`AUTHORING.md`'s
  section, translated in that repository's Korean guide page for values and mutation) says `return undefined;` is the
  absent value; it will say a bare `return;` and a fall-through are too. The types page's boundary
  item and the `TS8003`/`TS8021` lines keep their text unless they quote the removed sentences
  (none does today). Record 0099 in `compiler-changes.md` when the pin moves. Expected work: two
  paragraphs in two languages and the pin's usual checks.
