---
id: '0136'
title: Every for loop TypeScript accepts compiles, the counted form becomes the compiler's own fact, and an entry's return type is inferred where its body says it
status: draft
rules:
  - '7.5'
  - '8.19'
  - '8.22'
surface:
  - 14
  - 17
exports: []
exports-removed: []
codes: []
examples: []
names: []
downstream:
  - repo: typeshade.github.io
    what: Rewrite the TS8006, TS8007, TS8008 and TS8021 entries of src/lib/error-codes.ts to the sentences that remain, the guide's control-flow pages (content/guide/ko/control-flow.md and its English twin) that say a for loop must be counted and that an entry writes its return type, and the pages generated from Rule 7.5, Rule 8.19 and surface §17; record 0136 in compiler-changes.md
  - repo: vscode-typeshade
    what: Rewrite the skill's references/language.md (a for loop must be counted; an entry that returns a value needs its annotation, line 444 at db3f417) and references/diagnostics.md (the TS8006, TS8007, TS8008 and TS8021 rows), and record 0136 in compiler-changes.md when the pin moves
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0136, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Date and attribution          | Drafted 2026-11-09 (UTC) by an AI agent (Claude Code) at the owner's direction. The date is the drafting date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                        |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-09, in Korean. The owner asked which parts of the supported surface push onto the author work that the language or the compiler should do, judged against `OD-3`. From an audit of the surface, the owner chose two items for this proposal: the refusals of a `for` loop that is not counted (`TS8006`, `TS8007`, `TS8008`), and the return type an entry must write (`TS8021`). No GitHub issue is recorded.                                                                                                                                                 |
| Applicability / effectivity   | Expected: `docs/language-design.md` Rules 7.5, 8.19 and 8.22 (its R1 clause), §7.1 (the definitions, not a rule) and Appendix B's Rule 7.5 row, `docs/use-typeshade-surface.md` §14 and §17, `reqs/`, `src/compiler/ts/lower/control.ts` (`lowerFor` and the counted analysis it calls), `src/compiler/ts/loop-bound.ts`, `src/compiler/ts/kernel-loops.ts` (the R1 sentence), `src/compiler/ts/lower/function.ts` (the entry return), `src/language-service/` (the recorded inferred return), the IR `for` statement if a header carries two statements (decision F2), `CHANGELOG.md`. No release version is assigned. |
| Review baseline               | `main` at `583891d2` (merge of pull request #1120), 2026-11-09. The measurements of the compiler were made on `2cc98b8f`, the commit before it; `583891d2` changes no file under `src/compiler/` that they read (it adds `OD-5` and part 2b of change 0120). Change 0130 is `accepted` and not yet implemented on either commit.                                                                                                                                                                                                                                                                                        |
| Review and revision authority | Pull request #1124 (draft). Git records the revisions of this file. The merge of that pull request with `status: accepted` will record the decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## What changes

The examples in this proposal are written in the final form of change 0130 (accepted, not yet
implemented): an entry is `@vertex export function vs(…)` or `@fragment export function fs(…)`.

### Item 1: every `for` loop TypeScript accepts compiles

Today Rule 7.5 says "A `for` loop must be counted". The front end refuses every other `for`, and
most refusals tell the author to rewrite the loop as a `while`. Measured on `2cc98b8f`, each in a
fragment entry (`compile()`; the editor shows the same `typeshade` diagnostic):

| The `for` an author writes                       | Today                                                                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `for (;;) { …; if (c) { break; } }`              | `TS8007 for is missing an exit condition. A for loop is counted; a loop that ends at a break is "while (true) { … }".`                                       |
| `for (let x = 0.; x < 1.; x += 0.25)`            | `TS8003 Type mismatch: cannot compare i32 and f32 …` (the counter is made an `i32` whatever its initializer)                                                 |
| `for (let x: f32 = 0.; x < 1.; x += 0.25)`       | `TS8008 for induction must be i32 or u32, got f32.`                                                                                                          |
| `for (let i = 0, j = 10; i < j; i++, j--)`       | `TS8008 for-init must declare exactly one identifier.`                                                                                                       |
| `for (k = 2; k < 6; k++)`, `for (; k < 6; k++)`  | ``TS8008 for-init must be `let i: i32 = <start>` or `let i: u32 = <start>`.``                                                                                |
| `for (let i = 0; i < 6;) { i += 2; }`            | `TS8008 for-update is required (e.g. i++).`                                                                                                                  |
| `for (let i = 0; i < n; i++) { n -= 1; }`        | `TS8006 for bound reads "n", which the loop body writes, so it does not bound the loop. Read it into a const before the loop, or write the loop as a while.` |
| `for (let i = 0; !done; i++)`                    | `TS8006 for exit must compare "i" to a bound (e.g. i < 16, or i < n). A loop that ends some other way is a while loop.`                                      |
| `for (let i = 0; i < n && acc < 3.; i++)`        | `TS8006 for exit joins the bound "i < n" with "acc < 3.", and a counted loop's exit is its bound alone. … or write the loop as a while.`                     |
| `for (let i = 0; i != n; i++)`, `n` a uniform    | `TS8006 for exit "i != <bound>" with a runtime bound exits only if "i += 1" lands on it exactly. Compare with <, <=, > or >=.`                               |
| `for (let i = 1; i < 100; i = i * 3 + 1)`        | `TS8008 for-update must be i++ / i += <const>, or i *= / /= <const>.`                                                                                        |
| `for (let i = idx; i !== 0; i >>= 1)`            | the same `TS8008`                                                                                                                                            |
| `for (let i = 0; i < 4; v.x += 1.)`              | the same `TS8008`                                                                                                                                            |
| `for (let i = 0; i < 10; i += 0)`                | `TS8007 for step "i += 0" never advances "i": a step of 0 leaves it where it is.`                                                                            |
| `for (let i = 0; i < 10; i--)`                   | `TS8007 for (i = 0; i < 10; i -= 1) does not exit.`                                                                                                          |
| `for (let i: u32 = 0; i <= 4294967295; i++)`     | `TS8006 for (i = 0; i <= 4294967295; i += 1) walks "i" outside the range of u32 before the condition fails.`                                                 |
| `for (;;) { … }` with no `break` and no `return` | `TS8007`, the first sentence above                                                                                                                           |

Proposed (decision F1, recommended):

- A `for` statement means what it means in TypeScript: run the initializer once; before each trip
  test the condition (none is `true`); after each trip, and at each `continue`, run the update.
- The compiler classifies each `for`. A `for` that meets today's counted shape keeps its counted
  fact (the IR `for`'s `counted`, Rule 7.5's analysis, unchanged). Any other `for` is lowered as an
  open loop, as a `while` is today: an IR `for` with no `counted`.
- The counter of a `for` is a local like any `let`: it takes its annotation, or the type its
  initializer has. The one exception Rule 7.5 makes today stays: an unannotated non-negative
  integer literal compared with a `u32` bound is a `u32`.
- Kept refusals, for a loop the compiler proves never ends, the same rule as for `while`: a `for`
  with no condition, or a condition that folds to `true`, and no `break` or `return` that leaves
  it; a constant header whose step never moves the counter; a constant header that never reaches
  its bound, or leaves its counter's type first. Their sentences name the loop and stop telling the
  author to write a `while` (a new text for the same codes, Rule 12.5).
- A kernel function's loop (Rule 8.22): a `for` that is not counted is a candidate loop that the
  proof refuses under R1, as a `while` is today. The function runs on the CPU tier, and the host
  view says why, in a sentence that no longer calls it "a while loop".

### Item 2: an entry's return type is inferred where its body says it

Today Rule 8.19 lets every function infer its return type from its body, and then says "An entry
point writes its return type, which is its output (Rule 8.2)." An entry with no return type that
returns a value is refused, and the sentence already names the answer: `TS8021 Entry function "fs"
returns a value (inferred type vec4) but has no return type annotation; add ": vec4" to the
signature.` For a vertex entry the one omission gives three diagnostics (measured on
`examples/loops-over-data.shade.ts` with `: VsOut` removed): `TS8020 … It returns nothing.`,
`TS8021 … (inferred type VsOut) …` and `TS8010 VsOut.uv reads @location(0), which "vs" does not
produce.`, against Rule 12.4 ("One mistake reads as one diagnostic").

The return type of an entry carries the output's attribute (Rule 8.2, change 0111 D2). The
compiler already gives the default one from the type: a bare `vec4` vertex result is
`@builtin(position)`, and a bare scalar or vector fragment result is `@location(0)`
(`src/compiler/ts/lower/function.ts`, the entry signature). It cannot give any other one.

Proposed (decision R1, recommended):

- An entry that writes no return type returns what its body does, by Rule 8.19, as every other
  function does. A bare result takes the default attribute of its stage; a struct result takes its
  fields' attributes.
- The return type stays required where it says what the body cannot: a result that is another
  built-in value (`builtin<"frag_depth", f32>`, `builtin<"sample_mask", u32>`), the position with
  an option (`builtin<"position", vec4, { invariant: true }>`), or a location option
  (`location<0, vec4, { blend_src: 1 }>`). An entry whose body cannot be read as one of the
  defaults writes it.
- An object literal returned with no return type takes the struct whose field names it matches,
  the fallback surface §16 already gives a position that declares nothing. It must match exactly
  one struct the program declares; a literal that matches none or several keeps `TS8022`, and its
  sentence names the remedy, "write the return type". (Measured: today the table holds only the
  structs the program uses, so `return { color: … }` with `Color` named nowhere else is
  `TS8022 Object literal { color } does not match a known struct.`; the implementation widens the
  table to every declared struct for this fallback.)
- `TS8021` keeps its two other sentences (a bare `return` in a function that returns `T`; a
  function that returns `undefined` and no value). The entry sentence leaves.

### The example: `examples/loops-over-data.shade.ts`

Before (0130's final form, today's rules):

```ts
@vertex
export function vs(vi: builtin<"vertex_index", u32>): VsOut {
  const x = f32(i32(vi) / 2) * 4. - 1.;
  const y = f32(i32(vi) % 2) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x, y) * 0.5 + vec2(0.5, 0.5) };
}

function isqrt(x: f32): f32 {
  const a = max(x, 0.);
  let r = max(a, 1.);
  while (true) {
    const next = 0.5 * (r + a / r);
    if (abs(next - r) < 0.0001) {
      break;
    }
    r = next;
  }
  return r;
}

@fragment
export function fs(v: VsOut): Color {
  // … unchanged …
  return { color: vec4(ring, fract(n / 7.), s, 1.) };
}
```

After (both forms stay valid; the author may write either):

```ts
@vertex
export function vs(vi: builtin<"vertex_index", u32>) {
  const x = f32(i32(vi) / 2) * 4. - 1.;
  const y = f32(i32(vi) % 2) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x, y) * 0.5 + vec2(0.5, 0.5) }; // VsOut
}

function isqrt(x: f32): f32 {
  const a = max(x, 0.);
  let r = max(a, 1.);
  for (;;) {
    const next = 0.5 * (r + a / r);
    if (abs(next - r) < 0.0001) {
      break;
    }
    r = next;
  }
  return r;
}

@fragment
export function fs(v: VsOut) {
  // … unchanged …
  return { color: vec4(ring, fract(n / 7.), s, 1.) }; // Color
}
```

The emitted text of the "before" `isqrt` (measured on `2cc98b8f`) is the open loop the IR spells
as a `for` over a counter the compiler made:

```wgsl
fn isqrt(x: f32) -> f32 {
  let a = max(x, 0.0);
  var r: f32 = max(a, 1.0);
  for (var _w: i32 = 0; true; _w = (_w + 1)) {
    let next = (0.5 * (r + (a / r)));
    if ((abs((next - r)) < 0.0001)) {
      break;
    }
    r = next;
  }
  return r;
}
```

GLSL ES 3.00 emits `for (int _w = 0; true; _w = (_w + 1)) { … }` with the same body. The "after"
`for (;;)` lowers to the same IR, so it emits the same text (inference). The entries emit the same
WGSL and GLSL as before, since the inferred types are the written ones (inference; `VsOut` was
measured as the type `TS8021` names today, and `Color` needs the widened table above).

### Exclusions

- `for…of` and `for…in` do not change (Rule 7.5's sentences on them stay, with their `TS8008`,
  `TS8006` and `TS8003` sentences).
- `while` does not change.
- A helper's return type does not change (Rule 8.19 already infers it).
- No name, rule number, diagnostic code or export is added or removed.

## Why

### Problem and evidence

- Item 1 (fact). The compiler already lowers an open loop: a `while` is an IR `for` with no
  `counted` (`lowerWhile`, `src/compiler/ts/lower/control.ts`), and both writers print an IR `for`
  with any condition and any update (`src/core/emit.ts`, `case 'for'`). Every consumer of the
  counted fact treats a `for` without it as a `while`: the kernel proof (R1,
  `src/core/passes/parallel-loop.ts`), the derivative rewrite (`loop-trips`,
  `src/core/passes/derivative-rewrite.ts`) and reverse-mode differentiation (`headerTrips`,
  `src/core/passes/grad-reverse.ts`). The refusals only make the author move the loop into a
  `while`, which the compiler then compiles the same way.
- Item 1 (fact, measured on Tint and ANGLE, see "Measured facts"). WGSL and GLSL ES 3.00 accept
  each `for` shape the table above refuses: an `f32` counter, an empty header, a bound the body
  writes, an update that is not a constant step (with `continue`), a condition that is not a
  comparison, no initializer or update, two counters, an assignment as the initializer.
- Item 1 (inference). Code downstream was written around the refusals. radiance's
  `packages/radiance/src/kernels/sampler.shade.ts` <!-- doc-refs: skip — a path in a downstream repository --> (`sobol1`) writes `let i = index; while (i !== 0)
{ …; i = i >> 1; }` where TypeScript reads `for (let i = index; i !== 0; i >>= 1)`. typecv's
  `src/mvs/gpu/cloud-knn.shade.ts` <!-- doc-refs: skip — a path in a downstream repository --> (`insertSorted`) writes `while (s > 0 && best[s - 1] > d2)`, an
  `&&` exit that a `for` refuses. <!-- doc-refs: skip — paths in downstream repositories -->
- Item 2 (fact). The front end lowers the body, infers the type and prints it in the refusal. The
  only meaning the return type adds beyond the body is a non-default attribute, which this
  proposal keeps as the case that writes it.

### Alternatives

No option reverses an entry of `docs/owner-decisions.md`.

**F. Item 1.**

- F1 (recommended). Lower every `for`; keep only the refusals of a loop proved never to end, as
  for `while`. Cost: a `for` no longer promises a reader that it is counted (the reason Rule 7.5's
  rationale gives today); a kernel's loop that is not counted runs on the CPU tier, which the host
  view reports. The rest of the analysis stays.
- F1b (variant). As F1, and also lower a constant header that never reaches its bound or leaves
  its type, with WGSL's wrapping arithmetic. Cost: a loop of two billion trips (`i--` from 0 to a
  bound of 10 wraps after 2^31 steps) compiles without a word; the CPU oracle runs it as long.
- F0 (no change). Cost: the author rewrites each such loop as a `while` and keeps the counter
  outside it (`OD-3`, Rule 1.6).

**F2. A header with two declarations or a comma update** (`for (let i = 0, j = 10; i < j; i++, j--)`).

- F2.1 (recommended). Included. The IR `for` holds one initializer statement and one update
  statement (`src/core/ir/nodes.ts`). The implementation carries a list in each, or emits the two
  declarations in a block before the loop and the updates as WGSL's `loop { … continuing { … } }`.
  Measured: Tint accepts that `loop`/`continuing` form, and ANGLE accepts the GLSL ES 3.00 form as
  written (`for (int i = 0, j = 10; i < j; i++, j--)`). Cost: an IR change that the three backends,
  the CPU oracle and every pass that walks a `for` read.
- F2.2. Deferred. Such a header stays refused, with a sentence that says it is not supported yet
  and names the reason (one statement in the IR header). Cost: one `for` form TypeScript accepts
  stays refused.

**R. Item 2.**

- R1 (recommended). Infer every entry's result that the body says, as above; keep the return type
  for a non-default attribute and for an object literal that does not match exactly one struct.
  Cost: an author who writes no return type reads the output from the body; a reader who wants it
  in the signature writes it. The inferred return feeds the editor's projection (below).
- R2. Infer only a bare scalar or vector result; a struct result keeps its return type. Cost: the
  struct case, the common vertex shape (69 of the examples' vertex entries return a struct), keeps
  the annotation. Benefit: no widening of §16's fallback.
- R0 (no change). Cost: the author copies a type the refusal already prints (`OD-3`).

### Assumptions

- The counted analysis (`analyzeCountedFor`, `src/compiler/ts/loop-bound.ts`) stays and runs as a
  classifier. Its results today and after are the same for every loop it accepts today, so every
  counted loop keeps its emit and its kernel proof (inference).
- ECMAScript gives a `let` declared in a `for` header a fresh binding on each trip
  (CreatePerIterationEnvironment). It is observable only by a closure that outlives a trip. A local
  function (Rule 8.17) that reads the counter is called in the trip, so the per-trip binding and
  one variable give the same answer (inference); the implementation tests it.

### Conflicts

None found that this proposal resolves by itself. Two texts are read against `OD-3` and follow it:

- Rule 7.5's rationale: "What a counted `for` promises a reader is exactly that shape, so a loop
  that ends some other way is written as a `while`, which says so." The compiler can tell whether a
  `for` is counted; the author does not need to say it (`OD-3`: "a validation the compiler can
  satisfy by rewriting is the compiler's work"). `docs/owner-decisions.md` (Precedence, item 2)
  makes the rule's text the one to fix. The rationale is replaced, and the cost is listed under F1.
- Rule 8.19's sentence "An entry point writes its return type, which is its output (Rule 8.2)."
  The output's default attribute is the compiler's already (Rule 8.2's "a bare `vec4`"). The
  sentence is narrowed to the results whose attribute is not the default.

## Owner's decisions

- `OD-3` is the entry this proposal rests on. Both items remove work the compiler does already:
  telling a counted `for` from another, and naming an entry's result type.
- `OD-1`: whether a TypeScript tool accepts a form is not the criterion; here TypeScript's meaning
  of `for` and of an inferred return is borrowed (Rule 1.4) and the compiler represents it.
- `OD-2` and `OD-5`: not touched. Stages stay attributes; an entry's I/O stays in its types where it
  is written; a return type that is written keeps `builtin<…>` and `location<…>`.
- `OD-4`: the example and the options with their costs are shown above, before the owner decides.

This proposal reverses no entry.

## Why the compiler cannot do it

Not applicable: this proposal adds no author-facing name, no rule, no diagnostic code and no surface
form. It removes refusals and an annotation requirement. The question is answered in reverse under
"Why": the compiler already does both, and the author stops doing them. The one statement left to
the author is a non-default output attribute (`frag_depth`, `sample_mask`, `invariant`,
`blend_src`), which the body cannot say: a returned `f32` is a colour at location 0 unless the
signature says it is the depth.

## What it touches

- `rules` 7.5: "A `for` loop must be counted" becomes a description of the counted fact the
  compiler records when a `for` has the shape; every other `for` is an open loop. The counter-type
  sentence keeps its `u32` case and otherwise reads as a `let`'s. The refusals list shrinks to the
  loops proved never to end. Rationale, "Enforced by" and the Appendix B row follow. §7.1's
  definitions say that a counted loop is a `for` of that shape and an open loop is a `while` or any
  other `for`.
- `rules` 8.19: "An entry point writes its return type, which is its output (Rule 8.2)." becomes
  "An entry point's result is inferred as any function's is; it writes its return type when the
  result carries an attribute other than its stage's default (Rule 8.2), or when an object literal
  it returns matches no single struct." "Enforced by" loses the entry clause of `TS8021`.
- `rules` 8.22: R1, "a `while` and a multiplicative step are refused", becomes "a `while`, a `for`
  that is not counted and a multiplicative step are refused".
- `surface` 14: "An entry point writes its return type, which is its output (§3)." is rewritten as
  Rule 8.19 is.
- `surface` 17: the section opens with the counted fact as the compiler's, shows `for (;;)`, an
  `f32` counter and a bound the body writes as accepted, and keeps the refusals of a loop that never
  ends.
- `codes`: none added, removed or renumbered (`TS8006`, `TS8007` and `TS8008` stay for `for…of`,
  `while` and the kept refusals; `TS8021` stays for its two other sentences). Sentences change
  (Rule 12.5): the `for` sentences in the table above leave, the kept ones lose "write the loop as a
  while", `TS8021`'s entry sentence leaves, `TS8022` gains "write the return type" for an entry's
  object literal, and the kernel R1 sentence of `src/compiler/ts/kernel-loops.ts` changes.
- `examples`: none added or removed. No example needs an edit: every loop and every annotation
  written today stays valid. The implementation may add a `for` form to
  `examples/loops-over-data.shade.ts`, the compile gate's loop evidence.
- `exports`, `names`: none.
- `docs/language-design.md` Rule 7.2 (the mappings) and Rule 8.2 are read, not changed.

### Measured facts

| Fact or inference | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fact              | The refusal sentences in the table of item 1: `compile()` on `main` at `2cc98b8f`, 2026-11-09, Bun 1.4.4, one scratch source per row. The editor (`createTypeshadeLanguageService().getDiagnostics`) shows the same `typeshade` diagnostic; TypeScript itself reports nothing for any row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Fact              | Tint and ANGLE accept the open-loop shapes: a scratch page on 127.0.0.1 in Google Chrome for Testing 153.0.8010.12 with the compile gate's software flags (`--use-angle=swiftshader`, `--use-vulkan=swiftshader`, `--enable-unsafe-webgpu`), adapter "google swiftshader", WebGL 2.0 with GLSL ES 3.0. Each WGSL text went to `createShaderModule` + `getCompilationInfo`; each GLSL ES 3.00 fragment stage to `compileShader` and `linkProgram`. Instrument: a broken text was refused by both. Accepted by both, 10 of 10: an `f32` counter; `for (… ; true; …)` with a `break`; `for (;;)` with a `break`; a bound the body writes; `i = i * 3 + 1` with a `continue`; `!done` as the condition; no initializer and no update; two counters (WGSL `loop`/`continuing`, GLSL `for (int i = 0, j = 10; i < j; i++, j--)`); an assignment as the initializer; a plain counted loop. |
| Fact              | The text is hand-written in the shape `src/core/emit.ts` prints for an IR `for`; it is not the output of the compiler, which refuses these sources today. The compile gate (`bun run gate:compile`) was not run for this draft.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Fact              | `while (true)` in `isqrt` emits `for (var _w: i32 = 0; true; _w = (_w + 1))` in WGSL and `for (int _w = 0; true; _w = (_w + 1))` in GLSL ES 3.00 (`compile()`, `2cc98b8f`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Fact              | `examples/loops-over-data.shade.ts` with `: VsOut` and `: Color` removed: `TS8020`, `TS8021 … (inferred type VsOut) …`, `TS8010` and `TS8022 Object literal { color } does not match a known struct.`, the same four in the editor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Fact              | A bare `vec4` vertex result already takes `@builtin(position)` and a bare scalar or vector fragment result `@location(0)` (`src/compiler/ts/lower/function.ts`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Fact              | In `examples/**/*.shade.ts` (114 files): 100 `for (…)` headers and 5 `while (` loops; every render entry (172) writes its return type, as Rule 8.19 requires.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Inference         | No example changes its WGSL or GLSL: every loop written today is counted and keeps its lowering; every annotation written today stays. `bun run bake:goldens` with no golden changed proves it at implementation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Estimate          | Implementation: `lowerFor` falls back to the open-loop lowering instead of refusing; the counter type; the kept refusals' sentences; F2's IR header list; the entry return through Rule 8.19's path and the editor's recorded return; the tests in both halves. Duration and cost are unknown.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### The editor (Rule 12.7)

- Today (fact): TypeScript accepts every row of item 1's table and an entry with no return type;
  the editor shows only the compiler's `typeshade` diagnostics.
- After: the refusals leave both halves at once, since the editor shows the compiler's diagnostics.
  The language service records an inferred return for a function that writes none
  (`recordInferredReturn`, `src/compiler/ts/lower/function.ts`, #162) and skips an entry today
  (`stub.stage === undefined`); it records an entry's too, so the projection TypeScript reads gives
  the entry the type the compiler inferred.
- Owed tests, both halves on the same source: each row of item 1's table accepted (and its WGSL,
  GLSL and CPU oracle agree on one value), each kept refusal with its new sentence, an entry with no
  return type for a bare `vec4`, a struct value and a matched object literal, and the refusal of a
  literal that matches two structs; rows in `src/language-service/ambient-parity.test.ts`; hover on
  an entry with no return type shows the inferred type.

### Host-facing reports

- `reflect()` and the manifest read the IR after lowering, so an inferred entry result is reported
  as a written one is (inference). The host face of an entry (Rule 8.24, `src/compiler/ts/host-face.ts`)
  reads the lowered function; the implementation confirms that no host-face path reads the written
  return type before the body is lowered (not measured).
- A kernel function whose loop is not counted reports, in the host view, that it runs on the CPU
  tier, with the new R1 sentence.

### Draft impact estimate

- Known: no source that compiles today is refused, and none changes its emit.
- Known: Rules 7.5, 8.19 and 8.22 and surface §14 and §17 are rewritten; `reqs/` follows.
- Estimate: item 1 without F2 is local to `lowerFor`; F2 changes the IR `for` and every reader of
  it. Item 2 is local to the entry path of `src/compiler/ts/lower/function.ts`, §16's fallback and
  the language service. Duration and cost are unknown.
- Required validation evidence at implementation (not yet applicable): the owed tests above;
  `src/compiler/ts/runtime-loop-bound.test.ts`, `src/compiler/ts/loop-shapes.test.ts` and
  `src/compiler/ts/return-inference.test.ts` updated; the compile gate with the new loop shapes on
  Tint and ANGLE; `bun run gate:differential` for a kernel with a loop that is not counted (CPU
  tier); `bun run bake:goldens` with no golden changed; `bun run reqs:sync` and
  `python scripts/doorstop-check.py -C`; `bun run docs:impact` and `bun run docs:refs`.
- Decisions to resolve before acceptance: F (F1 or F1b), F2 (F2.1 or F2.2), R (R1 or R2).

### Open questions for the owner

1. F: keep refusing a loop proved never to end, as `while` does (F1, recommended), or lower it too
   (F1b)?
2. F2: include two declarations and a comma update now (F2.1, recommended, an IR change), or defer
   them with a sentence that says why (F2.2)?
3. R: infer a struct result too (R1, recommended), or only a bare result (R2)?

No two principles or rules were found that point different ways and that this proposal would have
to choose between; the two texts under "Conflicts" are read against `OD-3`, which takes precedence.

### Independent review record

Not yet performed. Before the owner decides, an agent or a person that did not write this proposal
reviews it against `changes/README.md` (Independent review) and the record is written here.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decisions on F, F2 and R, the
independent review record above with each finding answered, and the merge of this file with
`status: accepted`.

### Configuration and validation record

This record does not yet apply. Delivery will require the implementing pull requests (each commit
with `Change: 0136`), the delivered configuration and the validation evidence listed under "Draft
impact estimate".

## What it owes downstream

Measured on the local clones on 2026-11-09 (not fetched): typecv `5c3f8ce`, typenn `3a7d66c`,
typeaudio `8bd1ab1`, radiance `3e4efb3`, vscode-typeshade `db3f417`, typeplot `9f20c12` (not in
`DOWNSTREAM_REPOS`), web `990ec50` (`apps/typeshade` is the site, `typeshade.github.io` in
`DOWNSTREAM_REPOS`).

- typeshade.github.io: the `TS8006`, `TS8007`, `TS8008` and `TS8021` entries of its error-code
  list, its control-flow guide page (Korean and English), and the pages generated from Rule 7.5,
  Rule 8.19 and surface §17. Record 0136 in `compiler-changes.md`.
- vscode-typeshade: the skill's language and diagnostics references (a `for` must be counted; an
  entry needs its return type, line 444; the four code rows). Record 0136 in `compiler-changes.md`
  when the pin moves.
- radiance, typenn, typecv, typeaudio: nothing owed; every loop and annotation they write stays
  valid. Each may rewrite a `while` as the `for` it stands for (radiance `sobol1`, typecv
  `insertSorted`). typecv's audit `docs/audits/2026-10-27-typescript-surface-gaps.md` <!-- doc-refs: skip — a path in the typecv repository --> names these
  codes; it is a record and needs no edit. <!-- doc-refs: skip — a path in the typecv repository -->
- typeplot (not in `DOWNSTREAM_REPOS`): nothing owed.
