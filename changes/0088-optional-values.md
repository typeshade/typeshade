---
id: '0088'
title: A function, a local and a callback hold `T | undefined`, and the compiler carries whether the value is there
status: implemented
rules:
  - '7.2'
  - '7.8'
  - '7.10'
  - '8.18'
  - '8.19'
  - '8.21'
  - '12.7'
surface:
  - 7
  - 28
  - 49
  - 64
  - 76
exports: []
exports-removed: []
codes: []
examples:
  - optional-values
downstream:
  - repo: typeshade.github.io
    what: Document `T | undefined` values, their narrowing and their refused positions in the English and Korean TypeScript guides; replace the "carry a bool" advice and the TS8002 null sentence; add the example and Playground fixtures; record 0088 when the pin moves.
  - repo: vscode-typeshade
    what: Update the authoring skill's nullable refusal and diagnostics reference, verify hover and the replaced TS18048 diagnostic on optional values, and record 0088 when the pin moves.
---

<!-- doc-refs: skip-file — an accepted but unimplemented proposal names a future rule, a future surface section, a future example and test files, and files in other repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0088, `status: implemented`. The front matter is the identity and lifecycle authority. The owner approved the proposal on 2026-10-26 (UTC); see Approval and plan record. The compiler repository's work is delivered by pull request [#769](https://github.com/typeshade/typeshade/pull/769) (branch `change-0088-optional-values`); the downstream work and the compiler pins remain pending (What it owes downstream).                                              |
| Date and attribution          | Authored 2026-10-26, UTC, by a Claude Code agent. The date is the authorship date. It is not an approval or a delivery date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                              |
| Request source                | The owner (Seungup) asked in a Claude Code session on 2026-10-26 which compiler improvements the work on TypePlot revealed, then said "진행하세요" (proceed) to drafting proposals. In the same conversation the owner directed this design: "Expressing 'no value' is really boilerplate-like: the compiler can do it by adding extra data." The coordinating agent relayed that direction in English translation. These are request records, not acceptance of this proposal. |
| Applicability / effectivity   | `"use typeshade"` source: the TypeScript front end (`src/compiler/ts/`), the IR it emits through existing struct types, the WGSL and GLSL ES 3.00 writers, the CPU oracle and codegen, the language service (`src/language-service/`), and the documents named below. No new IR node and no public export is planned. No release version is assigned.                                                                                                                           |
| Review baseline               | `main` at `e03ff7ea74bb8d6c7398d2310b2a53cc7e582227`. The refusal was also read at `91c2fe31de045ebf0e5f2c333ac98b95cc460280`, the compiler pin of TypePlot; the TS8002 union sentence in `src/compiler/ts/type-map.ts` is the same text there.                                                                                                                                                                                                                                 |
| Review and revision authority | [#765](https://github.com/typeshade/typeshade/pull/765) is the proposal-only pull request. The owner approved its head `5e02bdd` in the conversation; this acceptance commit records that decision and the recorded decisions D1 to D9. Git records the revisions of this file. The merge of #765 with `status: accepted` records the decision. This document does not name the hash of the commit that contains it.                                                            |

## What changes

### The proposal in one paragraph

An author writes "no value here" the way TypeScript writes it: a type `T | undefined`, a
`return undefined;`, a test `v === undefined` and a fallback `v ?? d`. The compiler adds the
presence flag itself. It lowers each `T | undefined` value to the value and a `bool` that says
whether the value is there. Today TS8002 tells the author to carry that `bool` by hand. The
flag is the same on WGSL, GLSL ES 3.00 and the CPU oracle, and nothing in it depends on NaN.

### Before and after

At the review baseline `compile()` refuses this source with two TS8002 errors: one at the
alias `Curve` and one at the result type of `root`. It reports nothing more at the uses
(measured on 2026-10-26 UTC; see Why for the method):

```ts
"use typeshade";
type Curve = (x: f32) => f32 | undefined;

function root(x: f32): f32 | undefined {
  if (x < 0.) {
    return undefined;
  }
  return sqrt(x);
}

function sampleOr(f: Curve, x: f32, fallback: f32): f32 {
  const v = f(x);
  if (v === undefined) {
    return fallback;
  }
  return v * 2.;
}

export function probe(x: f32): f32 {
  return sampleOr(root, x, 0.) + (root(x) ?? 1.);
}
```

Under this proposal the source compiles. Its lowering is the program an author writes by hand
today with an interface `{ value: f32; present: bool }`. The WGSL below is an illustration;
the internal struct name is not fixed by this proposal:

```wgsl
struct _opt_f32 { value: f32, present: bool }   // internal name, not authorable (Rule 2.2)

fn root(x: f32) -> _opt_f32 {
  if ((x < 0.0)) { return _opt_f32(0.0, false); }
  return _opt_f32(sqrt(x), true);
}
```

### Proposed behavior

**The type.** `T | undefined` is an _optional value_ (proposed Rule 7.10). `T` is a type that
a function-scope struct field may hold: a scalar, a vector, a matrix, an emulated `f64` or
`vecNf64`, a fixed-size array, a struct, or a key type. A union that repeats `undefined` is
the same type, as TypeScript flattens it. `T | undefined` for a texture, a sampler, an atomic,
a runtime-sized array, a `Map`, a `Set` or `void` stays refused.

**Where an optional value may appear in this change:**

| Position                                                                    | Proposed                 |
| --------------------------------------------------------------------------- | ------------------------ |
| a `let` or `const` in a function body, with or without a type annotation    | allowed                  |
| a parameter of a function that is not an entry, a method, a local function  | allowed                  |
| the result of such a function, written or inferred (Rule 8.19)              | allowed                  |
| the parameters and the result of a function-typed parameter (Rule 8.18)     | allowed                  |
| a struct field, an interface member, a class field                          | refused                  |
| an array element (`array<f32 \| undefined, 4>`, `(f32 \| undefined)[]`)     | refused                  |
| a uniform or storage binding, a workgroup or private module variable        | refused                  |
| a module constant, an override, an enum member                              | refused                  |
| an entry point's parameter or result, a vertex or fragment IO struct        | refused                  |
| a host-callable export's parameter or result, a kernel function's parameter | no host value            |
| an optional parameter `x?: f32`                                             | refused today; unchanged |

A refused position keeps a TS8002 sentence that names the position and the remedy. The
reasons are these. WGSL forbids `bool` in host-shareable memory, so a binding cannot hold the
flag. A struct field or an array element would change a layout that `reflect()` reports
(Rule 6.8). An entry's IO has no `bool` interstage form. An optional has no host value in this change
(decision D4).

**Values.** `undefined` written where an optional value is expected is the absent value: the
zero of `T` and `present: false`. A value of type `T` written there is present: that value and
`present: true`. A `let` of an optional type declared with no initializer starts absent. That
is also the zero of the internal struct, so it agrees with Rule 7.6's zero start, and
TypeScript reports no TS2454 for a type that contains `undefined`.

**Tests and narrowing.** The compiler follows TypeScript's control-flow narrowing for a local
or a parameter, referenced by its name:

- `v === undefined`, `v !== undefined`, `v == undefined`, `v != undefined` (Rule 7.1's
  aliases), in either operand order, and `!` of each;
- the conditions of `if`, `?:`, `&&`, `||`, `while` and `for`, and an early `return`,
  `break`, `continue` or `discard`;
- an assignment or an initializer: `v = 1.` makes `v` present, `v = undefined` absent, as
  TypeScript narrows a declared union on assignment;
- `v ??= d`, after which `v` is present;
- inside a local function or an arrow function, TypeScript 5.6's rule for a closure: a
  `const` keeps its narrowing, and a `let` or a parameter keeps it only after its last
  assignment.

A narrowed read of `v` as `T` lowers to `v.value`. `v === undefined` lowers to `!v.present`.

**Operators.** `v ?? d` gives `v.value` when `v` is present and `d` otherwise. `d` is evaluated
only when `v` is absent, as ECMAScript evaluates it; a `d` with an effect lowers through the
existing `if` lowering of `?:`, `&&` and `||` (Rule 7.2, Rule 7.9). When `d` is itself
optional, the result is optional. `o?.f`, `o?.xy` and `o?.[i]` read a member, a swizzle or an
element of a present `o` and give an optional value: `{ value: o.value.f, present: o.present }`.
`v === x` with a value `x` of type `T` gives ECMAScript's result: `v.present && v.value == x`.
`v === w` with two optional values gives `true` when both are absent. Both comparisons apply
only where `===` already applies to `T` (Rule 7.1).

**Refused, each in one sentence with the edit to write:**

- an un-narrowed optional value where a `T` is needed: arithmetic, an argument, a `return`
  of a non-optional function, an index (`TS8003`). Example sentence:
  `"v" is "f32 | undefined" here, and "*" takes an f32. Test it first, "if (v !== undefined)", or give the absent case a value, "v ?? 0.".`
- an optional value as a condition (`if (v)`, `v && …`), because a condition is a `bool`
  (the existing TS8003 condition sentence). The remedy names `v !== undefined`, and
  for `bool | undefined` it names `v === true` or `v ?? false`.
- the non-null assertion `v!` on an optional value (decision D6).
- a narrowing form beyond the list above: a user type guard (`x is f32`), an aliased condition
  (`const ok = v !== undefined; if (ok) …`), `typeof v === "undefined"`, `switch (true)`. Each
  is a recorded divergence (Rule 7.2) with a sentence naming the test to write in the
  condition.
- a bare `return;` beside `return v;`, and a path that ends a function with an optional
  result without a `return`. Both keep today's TS8021 refusal, which names `return undefined;`
  (decision D5).
- `o?.m()` and `f?.()`: an optional call. A call has effects, and a shader has no function
  value to test.
- `null` anywhere. `f32 | null` keeps TS8002, with a sentence that names `f32 | undefined`.

**Inferred results (Rule 8.19).** A function that writes no result type, with `return undefined;`
beside `return v;` where `v` is a `T`, returns `T | undefined`, as TypeScript infers it. Rule
8.19's rationale sentence that "`undefined` beside a value has none, and those are refused"
changes accordingly.

**Function-typed parameters (Rule 8.18).** A parameter `f: (x: f32) => f32 | undefined` takes a
function that returns `f32 | undefined`. It also takes a function that returns `f32`, because
TypeScript assigns a function with a narrower result. The copy of the callee that Rule 8.18
makes for that function wraps each result as present. A library can therefore change its
callback type to `T | undefined` and keep every existing callback that returns `T`.

**TS8002's text.** The union sentence at `src/compiler/ts/type-map.ts` changes from "There is no
null on the GPU, so "f32 | undefined" names no type … carry a bool saying whether the value
means anything." to one sentence per case:

- `f32 | null`: `"f32 | null" names null, which a shader has no value for. Write "f32 | undefined": the compiler carries whether the value is there.`
- `T | undefined` in a refused position, for example a struct field:
  `"f32 | undefined" holds a value and a flag saying whether it is there, which a local, a parameter or a function's result may hold; a struct field may not. Carry a bool field beside the value.`
  The other positions name themselves in the same pattern.
- the keyword `undefined` or `null` alone as a type keeps the `KEYWORD_ADVICE` sentence, with
  its remedy changed to name `T | undefined`.

The code TS8002 is not renumbered and no code is added, so `codes` is empty.

### Exclusions

This change adds no optional struct field, no optional array element, no optional binding, no
host value for an optional, no optional parameter `x?: T`, and no `null`. It does not change
`xs.find(p)`, which stays refused (surface §63), or `m.get(k)`, which keeps its `has` guard
(surface §74). Each is a candidate for a later proposal. NaN keeps its present meaning: an
`f32` that holds a NaN is a present value.

## Why

### The problem

A TypeScript author writes "no value" as `undefined`. TypeShade refuses that spelling, and its
remedy asks the author to carry a `bool` by hand. Libraries then invent a sentinel value
instead, because a sentinel fits in the `f32` the callback already returns. The sentinel is
untyped: no checker sees a read that forgets to test it.

### Evidence

**Measured on the review baseline** (2026-10-26 UTC, worktree at `e03ff7e`, Bun, `compile()` from
`src/compiler/ts/compile.ts` and `createTypeshadeLanguageService()` from
`src/language-service/service.ts`, one fragment entry calling the probe):

| Source                                                                                             | `compile()`                                                                                                                                                                                                                                            | Editor                                                                                    |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| result `f32 \| undefined`, `return undefined;`                                                     | TS8002 "There is no null on the GPU, so "f32 \| undefined" names no type …"                                                                                                                                                                            | same TS8002, plus TypeScript 2769 at the use                                              |
| `v * 2.` on an un-narrowed `f32 \| undefined`                                                      | TS8002                                                                                                                                                                                                                                                 | TS8002, plus TypeScript 18048 "'v' is possibly 'undefined'."                              |
| inferred result from `return undefined;` and `return x;`                                           | TS8022 `Unknown identifier "undefined".`, twice                                                                                                                                                                                                        | the same two TS8022; no TypeScript error, so TypeScript inferred and narrowed an optional |
| `(x: f32) => f32 \| undefined` parameter                                                           | TS8002 twice                                                                                                                                                                                                                                           | TS8002 twice                                                                              |
| `vec2 \| undefined` local, `P \| undefined` with `?.`                                              | TS8002 (and TS8022 for `undefined`)                                                                                                                                                                                                                    | same                                                                                      |
| `h(x?: f32)`                                                                                       | TS8020 "Optional parameter "x" is not supported …"                                                                                                                                                                                                     | same                                                                                      |
| `return NaN;`                                                                                      | TS8022 `Unknown identifier "NaN".`                                                                                                                                                                                                                     | same                                                                                      |
| `return Number.NaN;`, `Number.isNaN(x)`                                                            | TS8022 `"Number" is a type, not a value …`                                                                                                                                                                                                             | same                                                                                      |
| `return 0. / 0.;`                                                                                  | TS8003 `Division by zero …` (Rule 7.4)                                                                                                                                                                                                                 | same                                                                                      |
| `isNaN(x)`, `isnan(x)`                                                                             | TS8004 `Unknown function …`                                                                                                                                                                                                                            | same                                                                                      |
| `x !== x ? 0. : x`                                                                                 | accepted; WGSL `select(x, 0.0, (x != x))`                                                                                                                                                                                                              | accepted                                                                                  |
| sentinel `return 1e20;` tested by `abs(v) < 1e18`                                                  | accepted                                                                                                                                                                                                                                               | accepted                                                                                  |
| hand-written `interface { value: f32; present: bool }` returned through a function-typed parameter | accepted; WGSL and GLSL ES 3.00 emit the struct, its constructor and `select`/`?:`; the CPU oracle (`compileModule`, `precision: 'f32'`) gave `2` for `x = 4`, the fallback `-1` for `x = -4`, and `{"value":0,"present":false}` for the absent result | accepted                                                                                  |

These observations establish three facts. First, the natural spellings are refused in both
halves. Second, the editor's TypeScript checker already types and narrows `f32 | undefined`:
it reports TS18048 at an un-narrowed use and accepts a narrowed one. Third, the lowering this
proposal asks the compiler to write already compiles on WGSL and GLSL ES 3.00 and runs on the
CPU oracle when an author writes it by hand. The probe scripts are in the session scratchpad
and are not part of the repository. `bun run gate:compile` (Tint and WebGL2) was not run on
the hand-written form.

**TypePlot (evidence only; it is not a `DOWNSTREAM_REPOS` repository).** TypePlot pins this
compiler at `91c2fe31` (`package.json` in TypePlot at `2f9e8bf`). Its contract for an omitted
point is a callback value of magnitude at least `1e18`; its example
`examples/curve.shade.ts` returns `1e20` for `x < 0`. At `2f9e8bf`, `shaders/plot.shade.ts`
holds 26 occurrences of `1e20` and 81 calls of `present(` or `presentPoint(`, which test
`abs(v) < 1e18`. Commit `918e3ba` ("State the omitted-domain contract once in the plot shader",
2026-10-26) introduced those two helpers. TypePlot's `docs/verification.md`, section "Why
earlier visibility defects reached `main`", records four curve visibility defects in four days
(fb51c63, c0b26cb, d11039d and #27). Its cause 3 says that "64 inline tests applied it with
different policies: stop the search, skip the sample, drop the interval or take a one-sided
derivative". Commit `752c734` changed one test from `abs(previousValue) >= 1e18` to
`!(abs(previousValue) < 1e18)`, because the first form treats NaN as present.

**TypeCV (a `DOWNSTREAM_REPOS` repository) uses the same pattern.** At TypeCV `5e1c95c`,
`src/gpu/*.shade.ts` holds 32 occurrences of `1e20` or `1e30`, among them `NO_VALUE: f32 = 1e30`
in `dense-mesh.shade.ts` and `return 1e30;` in helper results in `consensus.shade.ts` and
`numerics.shade.ts`. `bundle.shade.ts` carries a hand-written flag (`projection.ok === 0`). Some
of these sentinels are in storage, which this proposal leaves refused. No TypeCV source breaks
under this proposal, so TypeCV owes no work and is not in `downstream`.

**What TypeShade already says about NaN.** Surface §44 (change 0045) records that "WGSL lets an
implementation assume no NaN is present". Surface §11 records that WGSL leaves a NaN
float-to-integer conversion indeterminate. Appendix C of `docs/language-design.md` lists
`isnan` and `isinf` as WebGL2-only gaps with no WGSL spelling, refused as TS8004. Rule 11.13's rationale records that `gate:differential` leaves out
NaN inputs. A NaN is therefore not a portable carrier of meaning on the GPU targets.

### Alternatives

**(a) The compiler carries a presence flag: proposed.** It matches the owner's direction. It
uses the TypeScript spelling that the editor already checks (Rule 12.7). It needs no new IR
node, because the lowering is an ordinary struct that all four paths already carry, as
measured. It gives the same answer on every target, because a `bool` field is not subject to
WGSL's no-NaN assumption. An analysis gap can at worst miss a refusal: an absent value reads
the zero the compiler stored, on every target, never an indeterminate value.

**(b) A library convention only (`present()` or a documented `{ value, present }` struct): rejected.**
It is cheaper: it needs no language change, and the struct form compiles today. It gives no
check. A reader that forgets the test reads the sentinel or the zero, and the TypePlot defects
above came from that gap. Each library invents its own struct or its own threshold. The owner
called the hand-written flag boilerplate that the compiler can write.

**(c) NaN as the official "omitted" value with a builtin predicate: rejected.** WGSL lets an
implementation assume that no NaN is present, so a NaN test such as `x != x` or
`!(abs(v) < 1e18)` can be folded by a driver; that is an inference from the WGSL text quoted in
surface §44, not a measured fold. `isnan` has no WGSL spelling and is refused today. `NaN` is no
value name in a `"use typeshade"` file, and `0. / 0.` is refused by Rule 7.4. A NaN also comes
from arithmetic (`sqrt(-1.)`), so "omitted" and "computed badly" become one value. Integers and
`bool` have no NaN.

**(d) NaN-boxing as the lowering of `f32 | undefined`: rejected.** It saves the flag for float
types only. Integer, `bool`, vector and struct optionals still need a flag, so the compiler
would carry two lowerings. It inherits every NaN risk of (c), and an author's own NaN would
read as absent.

**(e) A reserved in-range value chosen by the compiler (for example the largest `f32`): rejected.**
It removes a valid value from `T`, and it is the sentinel pattern of (b) moved into the
compiler.

**(f) Two values in place of a struct (scalar replacement of the parameter and the local): not
chosen.** A function returns one value, so a result needs a struct in any case. One
representation everywhere is simpler, and a driver can replace the struct's fields by scalars
itself. The implementation may still split parameters if a measurement shows a cost.

**(g) Ask TypeScript's checker for narrowing inside `compile()`: not chosen for this draft.** Rule
8.19's rationale states that "the front end has no checker to ask". A follow-up of
`src/compiler/ts/definite.ts`, which already walks the flow "in TypeScript's terms" for Rule
7.6, is the chosen route (decision D2). The cost of a checker in `compile()` is unknown.

### The register and ABI cost of the flag

Known: each live optional value carries one `bool` beside its `T`, in function scope only. No
binding, buffer layout, vertex attribute or host value changes, because an optional cannot
reach any of them in this change. A function with an optional result returns a two-field
struct on WGSL and GLSL ES 3.00.

Estimated, not measured: a GPU compiler usually keeps such a `bool` in one 32-bit register or a
predicate, and usually inlines a small function so that the struct disappears. A sentinel costs
no extra register but one comparison at each test, so the difference is expected to be small.
The actual register count, occupancy and time on any hardware adapter are unknown. Required
validation step 7 measures them.

## What it touches

- **Rule 7.2** gains rows in its table of lowerings: `T | undefined` to the value and a
  presence flag; `undefined` to the zero of `T` and `false`; `v ?? d` and `o?.f`; equality with
  `undefined` and with a value; and the narrowing forms the compiler does not follow, as
  recorded divergences.
- **Rule 7.8** no longer lists "a nullable" as a refusal of every expression. It refuses `null`
  and an optional value outside the positions of Rule 7.10.
- **Rule 7.10 (new)** states the optional value: its element types, its positions, its absent
  and present values, the narrowing forms, the operators and the refusals above. The number is
  fixed by decision D9.
- **Rule 8.18** adds that a function-typed parameter whose result is `T | undefined` takes a
  function that returns `T`, wrapped as present in its copy.
- **Rule 8.19** infers `T | undefined` from `return undefined;` beside a `T`, and its rationale
  sentence about `undefined` beside a value changes. The bare `return;` refusal stays (D5).
- **Rule 8.21** adds the optional value to the list of types that have no host value as a
  helper's parameter (decision D4).
- **Rule 12.7** adds one sentence: an un-narrowed read of an optional value is the compiler's to
  report (`TS8003`), in TypeScript's TS18048, TS2322 or TS2345 place, as TS8075 stands in
  TS2454's place. The editor shows the compiler's sentence there and drops TypeScript's
  duplicate. The compiler's narrowing must not refuse what TypeScript's narrowing accepts,
  except for the recorded forms of Rule 7.2.
- **Rule 7.6** is read but not expected to change: TypeScript's TS2454 rule, which it adopts,
  already exempts a type that contains `undefined`. `src/compiler/ts/definite.ts` reads no types
  today, so it must learn to skip an optional local.
- **Surface §7** gains a row for the un-narrowed read and changes the TS8002 row text for a
  nullable.
- **Surface §28** changes its `f32 | null` row and adds a row for `T | undefined` in a refused
  position.
- **Surface §49** (the editor and the compiler agree) records the TS18048 replacement and the
  shared hover type `f32 | undefined`.
- **Surface §64** adds the optional value to the helper parameter types with no host value.
- **Surface §76 (new)**, "Optional values: `T | undefined`", explains the feature with its
  lowering on each target. The number is fixed by decision D9.
- **Example `optional-values`** (`examples/optional-values.shade.ts`) puts a function result,
  a local, a callback result, `??`, `?.` and the narrowing forms through the compile gate on
  Tint and WebGL2.
- **Code TS8002** keeps its number; its union sentence changes as stated. **Code TS8003** gains
  the un-narrowed-read sentence. No code is added, removed or renumbered.
- **Exports:** none. The internal struct is not authorable (Rule 2.2) and is not in
  `reflect()` output, since no binding can hold it.
- **Implementation files expected:** `src/compiler/ts/type-map.ts` (`mapUnion`,
  `KEYWORD_ADVICE`), the expression and statement lowerers under `src/compiler/ts/lower/`, a
  narrowing walk beside `src/compiler/ts/definite.ts`, `src/compiler/ts/semantic.ts` for the
  value `undefined`, the function-typed parameter copy in `src/compiler/ts/lower/function.ts`,
  `src/compiler/ts/host-face.ts` for the `never` reason, and
  `src/language-service/diagnostics.ts` for the TS18048 replacement. The tests replace
  `src/compiler/ts/honest-refusals.test.ts`'s null case where its text changes. `AUTHORING.md`,
  `CHANGELOG.md` and the affected `reqs/` items follow.

### Draft impact estimate

Known technical impact: front-end typing, lowering and a narrowing walk over existing IR; a
language-service projection change; documentation. No backend writer, IR node, export,
dependency or tool is planned. Existing valid programs keep their output, because every
source that this proposal accepts is refused at the baseline. The text of TS8002 for a
nullable changes, so a downstream fixture that quotes it changes.

Compatibility: a program that compiled at the baseline compiles to the same WGSL, GLSL and
CPU result. Emit goldens of existing examples must not move.

Unknown: implementation time, downstream effort, cost, and the GPU register and time cost of
the flag. No estimate is given.

Required functional validation (future; none of it has run):

1. Compile each allowed position for each element-type kind and hold WGSL, GLSL ES 3.00, the
   CPU oracle and the CPU codegen to one value, present and absent.
2. Prove `??` evaluates its right side only when absent, with a right side that writes.
3. Assert both halves on each source (CLAUDE.md, "A test reads both halves"): `compile()`
   diagnostics or emit, and the language service's `getDiagnostics` and `getHover`.
4. Add rows to `src/language-service/ambient-parity.test.ts` for every narrowing form the
   compiler follows (both accept) and every un-narrowed read (both refuse).
5. Pin each refused position, each recorded narrowing divergence, `null`, `v!`, truthiness and
   the optional call to its sentence, with no cascaded diagnostic at later uses.
6. Run `bun run build`, the unit suite, `bun run gate:compile` with the new example, and the
   packed user-journey gate, and keep existing goldens unchanged.
7. Measure the emitted register count or time of an optional result against the sentinel form
   on at least one hardware adapter, and record the adapter. A software adapter result is not a
   hardware claim.

Required document validation (future): proposal shape, `docs:refs`, `docs:impact`, the
IfChange check, `reqs:sync` with Doorstop review of Rule 7.10 and of the changed rules, and the
accepted-proposal scope gate (`scripts/changes.ts`).

### Decisions

The owner accepted each decision as the draft recommended it (Approval and plan record). One
part of D1 had no recommendation and stays open.

- **D1. The internal representation.** Decided: one internal struct for each element type,
  holding the value and the presence flag. Its name follows the reserved-name scheme (surface
  §62) and is not authorable (Rule 2.2). The draft made no recommendation for the exact name
  and the field order, and left them open. Settled by the implementing branch
  `change-0088-optional-values` (commit `225156a`, `src/compiler/ts/optional.ts`): the IR name
  is `__opt_` followed by the type key of `T` with every character a name cannot hold replaced
  by `_` (`__opt_f32`, `__opt_vec2_f32`, `__opt_array_f32_4`), and a struct's own name for a
  struct (`__opt_Hit`); the fields are `value: T` first and `present: bool` second. Each writer
  spells the name afresh under the reserved-name scheme (`_opt_f32_` on WGSL and on GLSL ES
  3.00), since a name that begins with `__` is reserved on both targets. Neither is visible to
  an author.
- **D2. The narrowing analysis.** Decided: a walk in the compiler, beside
  `src/compiler/ts/definite.ts`, that follows TypeScript 5.6's narrowing for the listed forms.
  The compiler does not ask TypeScript's checker.
- **D3. The diagnostic code for an un-narrowed read.** Decided: reuse `TS8003`
  (`TYPE_MISMATCH`). No code is added, so `codes` stays empty.
- **D4. A host value for an optional.** Decided: none in this change (Rule 8.21). A mapping
  such as `number | undefined` on the host needs a later proposal.
- **D5. A bare `return;` and an end-of-body path in a function with an optional result.**
  Decided: both stay refused (TS8021), and the sentence names `return undefined;`.
- **D6. The non-null assertion `v!`.** Decided: refused on an optional value.
- **D7. `null`.** Decided: refused everywhere. The TS8002 sentence names `T | undefined`.
- **D8. Optional struct fields and array elements.** Decided: refused in this change. A later
  proposal can allow them where no binding layout is involved.
- **D9. Numbering.** Decided: Rule 7.10, surface §76 and the example id `optional-values`.
  Each was free on `origin/main` at `fbf67d3427600535d0ea6a3cd3d1d1ef69baebfc`, read on
  2026-10-26 UTC. Proposals 0087 (#764) and 0089 (#766), accepted at the same time, take none of
  these names.

### Approval and plan record

The owner, Seungup, approved the proposal in the Claude Code conversation on 2026-10-26, at
about 10:55 UTC. The owner replied "진행승인" (approve proceeding). Asked for the scope, the owner
chose "전부 (초안 권장안대로)" (all, as the draft recommends). The coordinating agent relayed
both replies to the authoring agent. The approved revision is PR #765 at head `5e02bdd`. The
approved scope is the proposal as drafted, with decisions D1 to D9 taking the draft's
recommended options. The open part of D1 is the one exception, as recorded above. The merge of
PR #765 with `status: accepted` records the decision.

The declared impacts are final as the front matter states them. The required functional and
document validation is the list in the Draft impact estimate. Responsibilities: an agent of this
repository implements the proposal in commits that say `Change: 0088`. typeshade.github.io and
vscode-typeshade do their work when their pins move. No milestone date is assigned. No
duration or cost estimate was agreed.

### Configuration and validation record

**Delivered configuration.** The implementing pull request is #769, branch
`change-0088-optional-values`, based on the accepted revision of this proposal (`d563a3f`, the
merge of #765) and merged with `main` at `fc234dbc`. Its head at the time of this record is
`0248fd4`, on which every required check passed (below). The compiler change is in
`src/compiler/ts/optional.ts`, `src/compiler/ts/narrowing.ts`,
`src/compiler/ts/lower/optional-values.ts`, with edits in `src/compiler/ts/type-map.ts`,
`host-face.ts`, `definite.ts`, `context.ts`, `structs.ts`, `bindings.ts`, `module-vars.ts`,
`module-const.ts`, the lowerers under `src/compiler/ts/lower/`, `src/core/passes/lint/rules/all-paths-return.ts`
(its predicate exported), the editor's `src/language-service/diagnostics.ts`, `hover.ts` and
`projection.ts`, `examples/optional-values.shade.ts` with its emit goldens,
`journeys/optional-values/`, `src/compiler/ts/optional-values.test.ts`, rows in
`src/language-service/ambient-parity.test.ts`, and the documents this proposal names (Rules
7.2, 7.8, 7.10, 8.18, 8.19, 8.21 and 12.7; surface §7, §28, §49, §64 and §76; `AUTHORING.md`;
`CHANGELOG.md`; `src/AGENTS.md`). The responsible actors are the Claude Code agents of the
owner's session on 2026-10-26; the merge of #769 is the delivery.

Functional validation ran on 2026-10-26 UTC on the branch at `0248fd4` (Bun 1.4.4, Vitest 3.2.7
on Node 22.22.0, TypeScript 5.6.3, Prettier 3.9.10; CI also on TypeScript 5.9.3 and 6.0.3):
`bun run build`, passed; `bun run lint`, passed; `bun run format:check`, passed; `bun run test`
locally at `ba93ad0`, 482 files, 11183 passed and 1 failed (`expression-parity`, fixed by
`0248fd4`), and CI's `typecheck + unit` on all three TypeScript legs at `0248fd4`, passed;
`bun run gate:compile`, 185 examples on Tint and 128 GLSL ES 3.00 pairs on WebGL2, 0 failures,
`optional-values` among them; `bun run gate:journeys`, passed, with `journeys/optional-values/`
on WebGPU, WebGL2 and the CPU oracle against its JavaScript reference (worst relative error
9.86e-8 on the GPU tiers, 0 on the oracle); `bun scripts/changes.ts --base origin/main`, the
change touches exactly what this proposal declares. Step 7 of the required validation, a
register or time measurement on a hardware adapter, was not run; no hardware claim is made.

Deviations from the approved text, each made part of the approved text by this record:
`discard` is not a narrowing form (TypeScript's flow does not know it, and Rule 12.7 wins; a
read after `if (v === undefined) { discard; }` is TS8003 in both halves); a path that ends an
optional-result function without a `return` is a new TS8021 sentence in the front end, where
"today's TS8021" of decision D5 was in fact the IR lint's TS8015; `null` alone as a type gets the
null keyword's sentence, since TypeScript parses it as a literal type; TypeScript's TS2538
joins TS18048 and TS2532 as the codes the editor drops at an un-narrowed read; a `for`
condition cannot carry the test, since Rule 7.5's counted-loop exit refuses it first (TS8006);
and the editor's projection writes an inferred `T | undefined` result after the parameter
list, as it writes an inferred scalar. Decision D1's open part is settled: the struct is
`__opt_<key>` (the key of `T`, a struct's own name for a struct, non-identifier characters
replaced by `_`), its fields `value` then `present`, and each writer spells it afresh
(`_opt_f32_`).

Document validation of the implementing branch ran on 2026-10-26 UTC (Bun 1.4.4, Vitest 3.2.7
on Node 22.22.0, Prettier 3.9.10, Doorstop 3.2): `bun run docs:refs`, 0 dead references in 1315
files; `bun run docs:impact`, no must-fix item; `bunx prettier --check` on the edited Markdown,
passed; `src/compiler/ts/doc-snippets.test.ts`, 243 passed; `bun run reqs:sync` with
`doorstop review` of RULE-0710, SURF-076 and the changed rules and `doorstop clear` of each
suspect section after reading it; `python scripts/doorstop-check.py -C -e -F`, clean;
`doorstop publish all`, published; `src/reqs.test.ts`, `src/changes.test.ts` and
`src/doc-references.test.ts`, 40 passed. Rule 7.10 names its example in its rationale and not
in its "Enforced by", since `examples/shade-examples.test.ts` does not yet carry `Rule 7.10` in
its `Verifies` tag; the pull request adds the tag and moves the name. Functional validation (the unit suite, `bun run
build`, `bun run gate:compile`, the user-journey gate, the register measurement of step 7) is
recorded by the pull request, not here; each is not run as part of this record. The
deviations recorded so far: `discard` is not a narrowing form (the proposal's list named it;
TypeScript's flow does not know `discard`, so Rule 7.10 follows TypeScript, Rule 12.7), and
TypeScript's TS2538 joins TS18048 and TS2532 as the codes the editor drops at an un-narrowed
read. Both are part of the approved text by this record.

Draft document checks ran on 2026-10-26 UTC, by the authoring agent, on this file in a
worktree based on `e03ff7e` (Bun 1.4.4, Vitest 3.2.7 on Node 22.22.0, Prettier 3.9.10). The
results were: `bunx vitest run src/changes.test.ts`, 17 tests passed; `bun run docs:refs`, 0
dead references in 1306 files; `bunx prettier --check`, passed; `bun scripts/doc-impact.ts`,
"No prose names what this change removed or touched." These checks validate the document,
not an implementation. No functional check of the proposed behavior has run.

## What it owes downstream

**typeshade.github.io.** The TypeScript-to-TypeShade guide and the construct cards say that a
union and a nullable are refused, and the Korean pages restate them; these must describe
`T | undefined`, its narrowing, its refused positions and its lowering. The error-code data
(`src/lib/error-codes.ts`) and the Playground fixtures that quote TS8002's nullable sentence or
TS8003 must follow the new text. The new example needs its page. A search of the site at
`f1eb89c` for "no null on the GPU", "carry a bool", "f32 | null" and "f32 | undefined" in
`src/` found no copy of the old sentence; that limited search does not establish that no page is
affected. The site records 0088 in `compiler-changes.md` when its pin moves.

**vscode-typeshade.** The authoring skill's language reference and its diagnostics reference
must replace the nullable refusal with the optional value, its narrowing and its refused
positions. The editor must show the compiler's TS8003 sentence in place of TypeScript's TS18048
at an un-narrowed read, and hover must show `f32 | undefined`. That repository was not available
in this session, so no file was inspected. The editor records 0088 in `compiler-changes.md` when
its pin moves.

Radiance, TypeNN and TypeCV owe nothing: the change accepts sources they could not write and
changes no output of a source they compile. Their adoption of optional values is optional and is
not tracked here. Downstream owners, content edits, pin PRs and validation results remain
pending and unassigned.
