---
id: '0098'
title: '`null` is an absent value: `T | null` and `T | null | undefined` are optional values, and `v == null` tests one'
status: draft
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
  - null-values
downstream:
  - repo: typeshade.github.io
    what: Describe `T | null` and `T | null | undefined` beside `T | undefined` in the English and Korean TypeScript guides; replace the TS8002 null sentence in the error-code data and the Playground fixtures; add the example; record 0098 when the pin moves.
  - repo: vscode-typeshade
    what: Update the authoring skill's null refusal and its diagnostics reference, verify hover `f32 | null` and the replaced TS18047, TS18049, TS2531 and TS2533 diagnostics, and record 0098 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names a future example, future test files and files in other repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0098, `status: draft`. The front matter is the identity and lifecycle authority. No decision is recorded. Compiler implementation has not started.                                                                                                                                                                                                                                                                                                                                                                                    |
| Date and attribution          | Authored 2026-10-27, UTC, by a Claude Code agent. The date is the authorship date. It is not an approval or a delivery date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                             |
| Request source                | The owner (Seungup) asked in a Claude Code session on 2026-10-27, in Korean, whether the compiler can take `null` as well as `undefined`, and stated that the question is about the language as a whole, not about one library. The agent compared two designs and recommended the three-state design; the owner then asked for the amendment proposal only ("개정 제안서만 써봐", write only the amendment proposal). This is a request record. It is not an acceptance of this proposal.                                                     |
| Applicability / effectivity   | `"use typeshade"` source: the TypeScript front end (`src/compiler/ts/`), in particular `optional.ts`, `narrowing.ts`, `type-map.ts` and `lower/optional-values.ts`; the WGSL and GLSL ES 3.00 writers through the internal struct they already emit; the CPU oracle and codegen; the host face; the language service (`src/language-service/`); and the documents named below. No new IR node and no public export is planned. No release version is assigned. This proposal amends decision D7 of change 0088 and decision D9 of change 0093. |
| Review baseline               | `main` at `a21f702467d242ceccd9bafb5d92fafcf3886890`, which carries changes 0088 and 0093 as `implemented` (#769 and #773). The original implementation measurements ran against that commit.                                                                                                                                                                                                                                                                                                                                                  |
| Review and revision authority | Proposal-only [PR #784](https://github.com/typeshade/typeshade/pull/784) carries this draft. Git records the revisions of this file. The review and merge record of the proposal-only pull request will record the decision. This document does not name the hash of the commit that contains it.                                                                                                                                                                                                                                              |

**Revision context.** Revised on 2026-10-27 UTC by a Codex agent at the owner's request
in this conversation, following review of draft commit `b8139911e735bc2129108596b89d0f26ff2f40a5`.
This revision clarifies logical type identity, optional chaining and expression conversions,
and changes the recommendation for D3. It does not record acceptance. The implementation
review baseline and the original measurements remain unchanged.

## What changes

### The proposal in one paragraph

Change 0088 made `T | undefined` an optional value and refused `null` everywhere (its decision
D7); change 0093 kept that refusal (its decision D9). This proposal makes `null` a second absent
value. `T | null` is an optional value with the same representation as `T | undefined`: the
value and a presence flag. The static type says which absent value the flag stands for.
`T | null | undefined` is an optional value that carries one more `bool`, which says whether an
absent value is `null`, so that `v === null` and `v === undefined` keep TypeScript's results.
`v == null` and `v != null`, which TypeScript authors write for "absent", are accepted on every
optional value, `T | undefined` included. `null` takes every position, form and refusal that
Rule 7.10 gives `undefined`.

### Before and after

At the review baseline `compile()` and the editor refuse each program below with the sentences
quoted (measured on 2026-10-27 UTC; the method is in Why):

```ts
"use typeshade";

function hitDistance(o: vec3, d: vec3): f32 | null { // TS8002 "f32 | null" names null, … Write "f32 | undefined" …
  // …
  return null;
}

function shade(x: f32 | undefined): f32 {
  if (x == null) { return 0.; } // TS8099 Unsupported expression "null".
  return x;                     // TS8003 "x" is "f32 | undefined" here, …
}
```

Under this proposal both compile. `hitDistance` returns the internal struct that `f32 | undefined`
returns today, and `return null;` is its absent value. `x == null` is `!x.present`, and the
`return x;` after it is a narrowed read.

The WGSL below is an illustration in the spelling the writers emit at the baseline for the
internal struct, with the three-state struct named as decision D1 leaves open:

```wgsl
struct _opt_f32_ { value: f32, present: bool }
fn hitDistance(o: vec3<f32>, d: vec3<f32>) -> _opt_f32_ { … return _opt_f32_(0.0, false); }

// f32 | null | undefined (decision D1): one more flag, true when an absent value is null
struct _optn_f32_ { value: f32, present: bool, isNull: bool }
```

### Proposed behavior

**Types.** A union of `T` with `null`, with `undefined` or with both is an optional value. `T`
is what Rule 7.10 lets an optional hold today. TypeScript flattens a repeated member, so
`T | null | null` is `T | null`. A union of `T` with `null` for a `T` that an optional may not
hold (a texture, a sampler, an atomic, an array with no size, a `Map`, a `Set`, `void`, an
optional) is refused (`TS8002`), as `T | undefined` is. `null` alone as a type keeps its
`TS8002` sentence, and the remedy names `T | null` and `T | undefined`.

**Representation (decision D1).** `T | null` and `T | undefined` lower to the same internal
struct, `__opt_<key> { value: T, present: bool }`. The absent value of `T | null` is `null`, and
the absent value of `T | undefined` is `undefined`; the static type tells them apart, so the
struct needs no more. `T | null | undefined` lowers to a second internal struct per element type,
with the fields `value: T`, `present: bool` and a third `bool` that is `true` when the value is
absent and is `null`. Its zero is `undefined`, the value TypeScript gives a `let` of that type
with no initializer. A struct field, an array element and a parameter `x?: T | null`, which
TypeScript types as `T | null | undefined`, use the second struct. No binding, buffer layout,
interstage value or host value holds either struct (Rule 7.10, change 0093 decision D1).

**Logical type identity.** Sharing an emitted struct does not make `T | null` and
`T | undefined` assignable to each other. The front end must retain the inner type and the
set of admitted absent values independently of the emitted struct name. This information
must survive aliases, local inference, parameters, results, struct fields, array elements
and callback signatures. Narrowing records the remaining states without changing the
storage type of the original place. Type checking and conversions use these logical types;
equality of IR struct names or `typeKey` alone is not sufficient. The implementation may
choose the metadata representation, but must retain this information until all affected
checks and conversions are complete. No new IR node is required by this contract.

For example, an un-narrowed `T | null` cannot be assigned, passed or returned as
`T | undefined`, or conversely. A present value narrowed to `T` can be wrapped in either.
Widening an absent two-state value to the three-state form sets its tag from the logical
source type, including when that value comes from a field, array element or call.

**Values.** `null` written where an optional that admits `null` is expected is the absent value
`null`: the zero of `T`, `present` false, and on the three-state struct the `null` flag true.
`undefined` written where the type admits `undefined` is the absent value `undefined`. A `T`
written there is present. `null` written where the type does not admit it (a `T`, a
`T | undefined`) is refused (`TS8003`), as `undefined` is today, in TypeScript's TS2322 or
TS2345 place. A `let` of type `T | null` with no initializer is not assigned: a read before an
assignment is refused (`TS8075`, Rule 7.6), as TypeScript's TS2454 refuses it. A `let` whose
type admits `undefined` starts as `undefined`, as today.

**Assignment between optional types.** TypeScript assigns `T` to each of the three types,
`T | null` and `T | undefined` to `T | null | undefined`, and a narrowed `T | null | undefined`
to the type its narrowing leaves. The compiler converts the value where it is assigned, passed
or returned: a `T` is present; a `T | null` or a `T | undefined` widens to the three-state
struct with the `null` flag set from its static type; a three-state value narrowed to exclude
`null` or `undefined` keeps its `value` and `present` fields. Rule 8.18 applies the same widening
to a function handed to a parameter whose type returns an optional (a function that returns `T`
or `T | null` fits a parameter whose type returns `T | null | undefined`).

**Tests and narrowing (decision D2).** The compiler follows TypeScript's narrowing for these
forms, in either operand order and through `!`, in every place Rule 7.10 lists today:

| Form, on `v`                  | `T \| null` | `T \| undefined` | `T \| null \| undefined`                    |
| ----------------------------- | ----------- | ---------------- | ------------------------------------------- |
| `v == null`, `v == undefined` | `!present`  | `!present`       | `!present`                                  |
| `v != null`, `v != undefined` | `present`   | `present`        | `present`                                   |
| `v === null`                  | `!present`  | decision D3      | `!present && isNull`; else `T \| undefined` |
| `v !== null`                  | `present`   | decision D3      | narrows to `T \| undefined`                 |
| `v === undefined`             | decision D3 | `!present`       | `!present && !isNull`; else `T \| null`     |
| `v !== undefined`             | decision D3 | `present`        | narrows to `T \| null`                      |

A narrowing that leaves `T` makes a read of `v` the narrowed read `v.value`, as today. A
narrowing that leaves `T | null` or `T | undefined` from a three-state value keeps the value an
optional, and the compiler tracks which absent values remain. The clearing rules of Rule 7.10
for a name and for a member path apply unchanged.

**Expression result types and conversions.** For compatible value types, `c ? a : b`
joins the logical types of its branches, including their admitted absent values, and converts
the selected branch to that result representation. `a ?? b` removes both absent values from
the left type and joins its present type with the right type; it does not retain the left
operand's absent states. An enclosing expected type is applied through a checked conversion,
not by reinterpreting a shared struct. These rules also apply without a written result type.

For `a: f32 | null`, `b: f32 | undefined` and `c: bool`, with no further narrowing:

| Expression  | Inferred result type       | Required conversion                                       |
| ----------- | -------------------------- | --------------------------------------------------------- |
| `c ? a : b` | `f32 \| null \| undefined` | Widen either branch, preserving its absent value.         |
| `a ?? b`    | `f32 \| undefined`         | Wrap a present `a` in the result type; otherwise use `b`. |
| `b ?? a`    | `f32 \| null`              | Wrap a present `b` in the result type; otherwise use `a`. |

`??=` retains the declared storage type of its target. Its right operand must be assignable
to that type; for example, an un-narrowed `T | undefined` cannot be the right operand of
`??=` on a `T | null`. The left operand and the selected right operand or branch are evaluated
once, in source order. An unselected branch or fallback has no effects (Rule 7.9).

**Optional chaining.** `o?.f` on an `o` of type `S | null` has the logical type
`F | undefined`, where `F` is the complete declared type of the field, including any absent
values. The union is flattened. The outer presence flag decides whether to read the field;
an absent outer object produces `undefined`, not its own absent value. A present outer object
preserves the field's value and absent state. The same rule applies to optional element access
and continued chains, under the existing chain and evaluation rules.

For a field `f: f32 | null`, the result of `o?.f` is `f32 | null | undefined`:

| State                                  | Result      |
| -------------------------------------- | ----------- |
| `o` is absent                          | `undefined` |
| `o` is present and `o.f` is `null`     | `null`      |
| `o` is present and `o.f` holds a value | That value  |

An already-optional field must not bypass the outer presence check. In particular, the
zero-filled payload of an absent object is not an observable field value. The lowering must
convert the field to the result representation and select `undefined` for the absent outer
case. It evaluates the receiver once and preserves the chain's short-circuit effects.

**Equality.** `v === x` with `x` a `T` is `v.present && v.value == x`, under Rule 7.10's
existing equality restrictions. `v === w` with two optionals is true when both
are present with equal values, or both are absent with the same absent value; `v == w` is true
when both are absent, whichever absent value each holds.

**Refusals.** Every refusal Rule 7.10 lists for an optional applies to one that admits `null`,
each with its sentence naming the form to write: an optional as a condition (`if (v)`), the
assertion `v!`, an optional call (`o?.m()`), a bare `return;` in a function with an optional
result, a path that ends that function's body without a `return`, and a function with no
written result that returns `null` and no value. `typeof v === "object"`, TypeScript's other
test for `null`, is not followed and is refused as `typeof` is (`TS8099`), a recorded
divergence (Rule 7.2). The un-narrowed read names the test that fits the type: `v !== null`,
`v !== undefined`, or `v != null` for the three-state type.

**Inferred results (Rule 8.19).** A function with no written result whose body returns `null`
beside a value of `T` returns `T | null`; one that returns `null`, `undefined` and a value
returns `T | null | undefined`, as TypeScript infers them. One that returns `null` and no value
is refused (`TS8021`), as one that returns `undefined` and no value is.

**The editor (Rule 12.7).** TypeScript reports a read of a possibly-`null` value with TS18047,
TS18049, TS2531 or TS2533, beside TS18048 and TS2532 for `undefined`. The editor shows the
compiler's `TS8003` sentence in those places and drops TypeScript's, as it does for `undefined`
today. Hover shows `f32 | null` and `f32 | null | undefined` as written.

**Host (Rule 8.21).** No optional has a host value in this change, as change 0088 decided (its
D4). The host view declares an export that takes or returns one `never`, with the reason naming
the type. A mapping of `null` and `undefined` on the host is a later proposal.

### Exclusions

This change adds no host value for an optional, no optional in a binding, a module variable, a
module constant, an override, an enum member, a `Map` value or a `Record` value, and no optional
parameter on an entry point or a kernel function: each stays refused as changes 0088 and 0093
decided. `v!` stays refused (0088 decision D6). `xs.find(p)` stays refused (surface §63), and
`m.get(k)` keeps its `has` guard (surface §74); both return `undefined` in TypeScript, so this
change does not reach them. NaN keeps its meaning: a present `f32` may hold one.

## Why

### The problem

TypeScript code writes "no value" two ways. A library that returns `null` for "not found", and
the `x == null` test that covers both absent values, are ordinary TypeScript. The language design
rules take an author's names from WGSL and from ECMAScript as TypeScript spells it, and `null` is
an ECMAScript value. At the baseline, an author who ports such code must rewrite every `null` to
`undefined` and every `== null` to `=== undefined`. The second rewrite is needed even for code
that already uses `T | undefined`: the measurement below shows `x == null` on an `f32 | undefined`
refused with a generic sentence that names no remedy.

Change 0093 makes the combined type ordinary as well. It allows `x?: T` and `f?: T`, and
TypeScript types `x?: T | null` and `f?: T | null` as `T | null | undefined`. A design that
refuses the combined type refuses those common signatures.

### Evidence

**Measured on the review baseline** (2026-10-27 UTC, `main` at `a21f7024`, Bun 1.4.4,
`compile()` from `src/compiler/ts/compile.ts` and `createTypeshadeLanguageService()` from
`src/language-service/service.ts`; each program with one fragment entry that calls the function
under test). The editor column lists every diagnostic the language service reported; in each row
it was the compiler's sentence and no TypeScript diagnostic.

| Source                                                                    | `compile()` and the editor                                                                                                                                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `let v: f32 \| null = null;` then `v ?? 0.`                               | TS8002 `"f32 \| null" names null, which a shader has no value for. Write "f32 \| undefined": the compiler carries whether the value is there (Rule 7.10).`                                             |
| a result `f32 \| null` with `return null;`; a parameter `x: f32 \| null`  | the same TS8002                                                                                                                                                                                        |
| `x?: f32 \| null`                                                         | the same TS8002                                                                                                                                                                                        |
| `x: f32 \| null \| undefined`                                             | TS8002 `"f32 \| null \| undefined" names null, which a shader has no value for. Write "f32 \| undefined \| undefined": …`                                                                              |
| an interface field `n: vec3 \| null`, `{ t: x, n: null }`, `h.n === null` | the TS8002 for `vec3 \| null`, then TS8099 `Unsupported expression "null".` twice                                                                                                                      |
| `x == null` on `x: f32 \| undefined`, then `return x;`                    | TS8099 `Unsupported expression "null".` and TS8003 `"x" is "f32 \| undefined" here, and the result here is an f32. Test it first, "if (x !== undefined)", or give the absent case a value, "x ?? 0.".` |
| `x != null` on `x: f32 \| undefined`, then `return x;` inside             | TS8099 `Unsupported expression "null".`                                                                                                                                                                |
| `x === undefined` on `x: f32 \| undefined`, then `return x;`              | nothing (accepted)                                                                                                                                                                                     |
| `x: null` as a parameter type                                             | TS8002 `null names no value a shader has. Write "T \| undefined" for a value that may be absent: …`                                                                                                    |

**TypeScript's own reading** (TypeScript 5.6.3 from the repository's `node_modules`, `strict`,
2026-10-27 UTC): with `a: number | null`, `b: number | undefined` and
`c: number | null | undefined`, the checker reports nothing for `a === undefined`,
`b === null` and `a!`; it narrows `c` to `number | undefined` after `c !== null`, `c` to `number`
after `c != null`, and `a` to `number` after `a != undefined`; it reports TS2322 for `a` and for
`c` assigned to `number`, and TS2454 for a read of `let u: number | null;` before an assignment.

These observations establish four facts. First, `null` is refused in both halves with one
sentence, so the two halves agree today. Second, `v == null` and `v != null` are refused even on
a `T | undefined` that the compiler accepts, with a sentence that names no remedy, while
TypeScript accepts them and narrows. Third, the remedy for `f32 | null | undefined` names
`"f32 | undefined | undefined"`, which is a defect in the sentence; the implementation of this
proposal replaces it, and a bug fix may correct it earlier, since the sentence's text is no
criterion of `changes/README.md`. Fourth, TypeScript's checker separates the two absent values
in `===` and its narrowing and joins them in `==`, so a representation with one flag for the
combined type would give a result TypeScript does not give. The probe scripts are in the
session scratchpad and are not part of the repository. `bun run gate:compile` was not run,
because no accepted form exists at the baseline.

**What the implementation would change** (read at `a21f7024`; each item is an inference from
the code, not a measured change):

- `src/compiler/ts/type-map.ts`: `mapUnion` maps a union with `null` to the optional type
  instead of refusing it, and maps the combined union to the three-state type.
- `src/compiler/ts/optional.ts` and the front-end type/context plumbing: logical optional
  types retain their admitted absent values independently of shared IR struct names, including
  nested fields and array elements. The internal struct gains its three-state form;
  `absentOf` takes which absent value; conversion helpers widen and narrow between the forms.
  `optionalDeclaredType` adds `undefined` to a nullable `?` field or parameter rather than
  returning its existing two-state representation unchanged.
- `src/compiler/ts/narrowing.ts`: a fact records which absent values remain, beside whether the
  value is present.
- `src/compiler/ts/lower/optional-values.ts` and `src/compiler/ts/lower/expression.ts`: the
  `null` literal, `==`, `!=`, `===` and `!==` with `null`, and the conversions at an assignment,
  an argument and a `return`; conditional and nullish expression result inference and branch
  conversion; optional chaining that combines outer presence with the field's absent state.
  At the baseline, `lowerOptionalRead` compares `typeKey`, `lowerNullish` matches representation
  types, and `lowerOptionalChain` returns an already-optional member unchanged. These paths
  need the logical-type and conversion rules above.
- `src/compiler/ts/definite.ts`: a `let` of type `T | null` with no initializer is unassigned.
- `src/language-service/diagnostics.ts` and `hover.ts`: the TS18047, TS18049, TS2531 and TS2533
  pairs and the hover.

### Alternatives

**(a) One more flag only where both absent values are in the type: proposed.** `T | null` and
`T | undefined` share today's struct, so code that uses one absent value pays nothing new. The
combined type keeps TypeScript's results for `===`.

**(b) One flag for both, `null` and `undefined` the same absent value: rejected.** It is the
smallest change, but `v === null` would be true for a `v` that holds `undefined`, a result
TypeScript does not give. An author who tests `=== null` would get a wrong answer with no
diagnostic.

**(c) Accept `T | null` and `T | undefined`, refuse the combined type: rejected.** It needs no
second struct, but it refuses `x?: T | null` and `f?: T | null`, which change 0093 made ordinary
spellings, and it refuses the type of `c ? a : b` where `a` is a `T | null` and `b` a
`T | undefined`.

**(d) A `u32` state field instead of two `bool` fields: considered for decision D1.** One field
holds three states, but every reader of `present` would change to a comparison, and the struct
for one absent value would differ from today's. Two `bool` fields keep the `present` field and
every lowering that reads it.

**(e) Keep `null` refused, and accept only `v == null` and `v != null` on `T | undefined`: the
smaller alternative.** It removes the second fact's friction at the cost of a narrowing form and
no representation. It leaves ported `null` code refused. The owner may take this part alone; it
is decision D4.

### The cost of the second flag

Known: `T | null` and `T | undefined` cost what `T | undefined` costs at the baseline. The
combined type adds one `bool` to its struct, in function scope only.

Estimated, not measured: the register cost of the second `bool` is of the same order as the
first. The register count, occupancy and time on any hardware adapter are unknown. Required
validation step 7 measures one case.

## What it touches

- **Rule 7.2** adds rows for `null` where `T | null` and `T | null | undefined` are expected,
  for `v == null` and `v === null`, for the three-state struct, and for `typeof v === "object"`
  as a form the compiler does not follow. It records the D3 policy chosen at acceptance.
- **Rule 7.8** removes `null` from its list of refusals of every expression, and keeps `null`
  alone as a type refused.
- **Rule 7.10** states that `T | null` and `T | null | undefined` are optional values: their
  representation and distinct logical identities (D1), their absent values, the conversions
  between the forms and expression branches, the narrowing table (D2 and D3), `v == null`
  (D4), optional chaining over optional fields, the operators, the refusals and the editor's places.
- **Rule 8.18** adds the widening of a function's result from `T | null` or `T | undefined` to a
  parameter whose type returns `T | null | undefined`.
- **Rule 8.19** adds the inferred results `T | null` and `T | null | undefined`.
- **Rule 8.21** names `T | null` and `T | null | undefined` beside `T | undefined` as values with
  no host value.
- **Rule 12.7** adds TS18047, TS18049, TS2531 and TS2533 to the places where the editor shows the
  compiler's `TS8003` sentence.
- **Surface §7** changes the `TS8002` row for `null` and the `TS8099` row that the `null`
  literal reaches today.
- **Surface §28** changes its `f32 | null` row: the type is accepted, and `null` alone as a type
  stays refused with the new remedy.
- **Surface §49** records the four TypeScript codes that the compiler's sentence replaces and the
  hover of the new types.
- **Surface §64** names the new types among the values with no host value.
- **Surface §76** changes its title to name `null`, adds the representation, the narrowing table,
  the conversions and the refusals, and changes "What it does not change".
- **Example `null-values`** (`examples/null-values.shade.ts`): a function that returns `T | null`
  and its caller's `??`; a `v == null` test on a `T | undefined`; a helper with `x?: f32 | null`
  called with a value, with `null` and with no argument, that tells the three apart with `===`.
  It goes through the compile gate on Tint and WebGL2 and bakes its emit goldens. The id was free
  on `main` at `a21f7024`, read on 2026-10-27 UTC.
- **Codes:** the sentences of `TS8002` for `null`, of `TS8099` for the `null` literal and of
  `TS8003` for an un-narrowed read change as stated. No code is added, removed or renumbered.
- **Exports:** none. `reflect()`'s shape does not change.
- **Implementation files expected:** the list under "What the implementation would change", plus
  `src/compiler/ts/optional-values.test.ts` (rows for each type, form and refusal, both halves),
  rows in `src/language-service/ambient-parity.test.ts`, `src/compiler/ts/honest-refusals.test.ts`
  where the `null` sentence changes, `AUTHORING.md`, `CHANGELOG.md` and the affected `reqs/` items.

### Draft impact estimate

Known technical impact: front-end typing of a union with `null`; a second internal struct form
and the conversions between the forms; a second fact in the narrowing walk; the `null` literal
and its comparisons in the lowering; four editor pairs; documentation. No backend writer, IR
node, export, dependency or tool is planned. The writers already emit a struct with `bool`
fields.

Compatibility: every program that compiles at the baseline compiles to the same WGSL, GLSL and
CPU result, because every source this proposal accepts is refused at the baseline. The text of
three sentences changes, so a downstream fixture that quotes them changes. Emit goldens of
existing examples must not move.

Unknown: implementation time, downstream effort, cost, and the GPU register and time cost of the
second flag. No estimate is given.

Required functional validation (future; none of it has run):

1. Compile `T | null` and `T | null | undefined` as a local, a parameter, a result, a struct
   field, an array element and a callback's value, for a scalar, a vector and a struct `T`, and
   hold WGSL, GLSL ES 3.00, the CPU oracle and the CPU codegen to one value, present, `null` and
   `undefined`.
2. Hold each row of the narrowing table to TypeScript's result on each absent value and on a
   present one, on the four paths.
3. Compile each conversion (a `T`, a `T | null` and a `T | undefined` assigned, passed and
   returned as `T | null | undefined`, and a narrowed three-state value assigned to the narrower
   type) with the same four-way agreement.
4. Pin each refusal to one sentence, with no cascaded diagnostic; assert the chosen D3 policy
   separately, including both equality and inequality.
5. Assert both halves on each source (CLAUDE.md, "A test reads both halves"), with rows in
   `src/language-service/ambient-parity.test.ts` for each narrowing form the compiler follows and
   each editor pair.
6. Compile the example on Tint and WebGL2 (`bun run gate:compile`).
7. Measure the emitted register count or time of a `T | null | undefined` against a
   `T | undefined` on at least one hardware adapter, and record the adapter.
8. Run `bun run build`, the unit suite and the packed user-journey gate, and keep existing
   goldens unchanged.
9. Verify that un-narrowed `T | null` and `T | undefined` cannot be assigned, passed or returned
   as each other despite their shared representation; include aliases, inferred locals, fields,
   array elements and callback results, and verify their valid widening preserves the tag.
10. Hold optional chaining over an optional field to the three outcomes in its table on all
    four execution paths; include nullable and three-state receivers, omitted optional fields,
    continued chains and optional element access.
11. Hold the conditional and nullish expression table to both halves' inferred types and all
    four execution paths, with each possible absent and present input; verify permitted and
    refused `??=` assignments and enclosing-context conversions.
12. Verify single evaluation and short-circuit effects with observable counters for receivers,
    branches, fallbacks and D3 constant comparisons; verify combined and successive narrowing
    tests such as `v !== null && v !== undefined` and branch joins.

Required document validation (future): proposal shape, `docs:refs`, `docs:impact`, the IfChange
check, `reqs:sync` with Doorstop review of the changed rules, and the accepted-proposal scope
gate (`scripts/changes.ts`).

**Draft revision validation.** On 2026-10-27 UTC, the Codex agent ran document checks
on this proposal-only working-tree revision, based on `b8139911` and compared with
`main` at `a21f7024`, using Bun 1.4.4. `docs:refs` reported 0 dead references in 1,331
files; this proposal retains its declared `skip-file` exemption for future references.
`docs:impact` reported no affected prose. `changes:check` reported no proposal requirement
for this document-only diff. The IfChange check passed, and
`vitest run src/changes.test.ts` passed all 17 tests with Vitest 3.2.7. These are document
checks, not evidence that the proposed null semantics work. Functional validation and
implementation-stage rule traceability remain pending. Git records this revision's exact diff.

### Decisions

Each decision is open. The owner decides on the proposal's pull request. Each one carries the
draft's recommendation and the alternative it was weighed against.

- **D1. The representation.** Recommended: `T | null` and `T | undefined` share today's struct
  `{ value, present }`; `T | null | undefined` adds a third `bool` that is true for an absent
  `null`, and its zero is `undefined`. The internal name of the three-state struct and its field
  name are left to the implementing pull request, under the reserved-name scheme (surface §62),
  as change 0088 left its own. Logical type identity must retain the admitted absent values
  independently of this shared representation through every position described above.
  Alternatives: one flag for both (Alternatives (b)); a `u32` state
  (Alternatives (d)).
- **D2. Narrowing on which absent value remains.** Recommended: follow TypeScript, so that
  `v !== null` on `T | null | undefined` leaves `T | undefined`, which may be assigned to a
  `T | undefined`. Alternative: track presence only, and refuse the assignment of a partly
  narrowed three-state value to a narrower type, as a recorded divergence (Rule 7.2); cheaper,
  and it refuses a program the editor accepts.
- **D3. Strict tests for an absent value excluded by the optional type.** `v === null` on a
  `T | undefined`, and `v === undefined` on a `T | null`, are always false; their `!==` forms
  are always true. TypeScript reports nothing. Recommended: accept these forms, in either
  operand order, with those constant results. Evaluate the operand once and preserve its
  effects; replacing the entire expression with a literal must not discard a call or write.
  This recommendation favors TypeScript compatibility and porting without rewriting valid
  tests. The opposite branch is unreachable and supplies no usable narrowing fact.
  Alternative: refuse all four forms (`TS8003`) with an appropriate nullish-test remedy,
  recording the divergence in Rule 7.2. This follows the baseline's refusal of comparisons
  between a non-optional value and `undefined`, but rejects valid TypeScript. The existing
  non-optional comparison refusal stays outside this change.
- **D4. `v == null` and `v != null` on `T | undefined`.** Recommended: accepted, with the
  narrowing of `v == undefined`, as part of this proposal. Alternative: take this part alone if
  the owner refuses `T | null` (Alternatives (e)).
- **D5. A `let` of type `T | null` with no initializer.** Recommended: unassigned, so a read
  before an assignment is refused (`TS8075`), as TypeScript's TS2454 refuses it. Alternative:
  start it as `null`; it accepts a program the editor refuses (Rule 12.7).
- **D6. Numbering and names.** Recommended: no new rule and no new surface section; Rule 7.10
  and surface §76 take the change, and §76's title names `null`; the example id `null-values`.
  The id was free as recorded above. Alternative: a new surface section for `null`; rejected,
  since §76 is the optional value's section.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decision on the
proposal-only pull request, recorded with its date, the approved revision of this file, the
decision taken on each of D1 to D6, and the merge of that pull request with `status: accepted`.
Responsibilities, milestones and any duration or cost estimate are not assigned.

### Configuration and validation record

This record does not yet apply. Delivery will require the accepted revision, the implementation
commits and pull requests that say `Change: 0098`, the delivered configuration, and the observed
results of the functional and document validation listed above, each with its date and tested
configuration. Deviations will need a recorded disposition.

## What it owes downstream

**typeshade.github.io.** The pages that change 0088 owes (the TypeScript guide's optional
values, its refused positions, the construct cards, the error-code data in
`src/lib/error-codes.ts` and the Playground fixtures) will say that `null` is refused and that
`T | undefined` is the one spelling. Under this proposal they describe `T | null` and
`T | null | undefined` beside it, and the `TS8002` `null` sentence leaves the error-code data.
The new example needs its page. A search of the site's `main` at `f1eb89c` on 2026-10-27 found
no copy of the baseline's `null` sentence outside the vendored compiler; the site has not yet
recorded 0088 or 0093 in `compiler-changes.md`, so a pin that carries all three proposals does
their work at once. The site records 0098 in `compiler-changes.md` when its pin moves.

**vscode-typeshade.** The authoring skill's language reference and its diagnostics reference
must replace the `null` refusal with the two new types and their tests. Hover must show
`f32 | null` and `f32 | null | undefined`, and the editor must show the compiler's `TS8003`
sentence in the places of TypeScript's TS18047, TS18049, TS2531 and TS2533. That repository was
not available in this session, so no file was inspected. The editor records 0098 in
`compiler-changes.md` when its pin moves.

Radiance, TypeNN and TypeCV owe nothing: the change accepts sources they could not write and
changes no output of a source they compile. Downstream owners, content edits, pin pull requests
and validation results remain pending and unassigned.
