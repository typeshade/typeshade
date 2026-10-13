---
id: '0063'
title: A builtin's scalar overload returns `ScalarOf<P0, …>`, one declared type, in place of an inlined conditional chain
status: draft
rules:
  - '9.6'
surface:
  - 49
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The language reference prints the short scalar overload of each of the 49 builtins the generator gives one, and lists `ScalarOf` beside `Numeric` under the types the ambient file declares for its own use, which needs the helper filter in `src/lib/language-reference.ts` (`isHandle`) to stop dropping a type that reads a brand tag; compiler-changes.md records 0063 when the pin moves.
---

<!-- doc-refs: skip-file — a proposal names a file of typeshade.github.io, which this tree does not have -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal `0063`, `status: draft`. The front matter is the lifecycle authority. `0062` is the highest number on `main`, and `0052` is held by the closed pull request #502, so this draft takes `0063`.                                                                                                                                                                              |
| Date and attribution          | Written 2026-10-13, Asia/Seoul. The date is the authorship context, not an approval. Claude Code, an AI assistant, drafted it at Seungup's request in the project conversation of that day, after the problem was seen on typeshade.dev. Seungup chose the name `ScalarOf` in that conversation. Attribution is not approval.                                                       |
| Applicability / effectivity   | `src/language-service/builtin-signatures.ts`, `src/language-service/ambient.ts` (`SHADE_DTS`, written to `dist/shade.d.ts`), `src/compiler/ts/type-map.ts` (`LIBRARY_TYPE_NAMES`), `src/core/spec-conformance/surface-names.test.ts` (`TYPESHADE_EXTENSIONS`), `docs/language-design.md` §9.3, `docs/use-typeshade-surface.md` §49, `CHANGELOG.md`. No release version is assigned. |
| Review baseline               | `main` at `8e3c3d58651a79e373d3ea975cb9430348265aa7` (#622). The site measurements below are at typeshade.github.io `main` `4ff04c4d79643fc69f12778882f89e8febf1e056`, which pins this compiler at `c89f6b227812c939eb8f0f294f16651f05476743`.                                                                                                                                      |
| Review and revision authority | No pull request is assigned when this revision is written; the proposal-only pull request that carries this file is its review record. Git records revisions. Its review and merge records establish decisions.                                                                                                                                                                     |

## What changes

### Today

Proposal 0017 generates each builtin's overloads from Tint's `core.def`, one overload per row
(`src/language-service/builtin-signatures.ts`). A row over a scalar `T` gives each argument its
own type parameter, `P0`, `P1`, `P2`. Its result is the scalar of the first argument that
carries a brand: `bool` for a boolean, and `number` when no argument carries one (Rule 12.7, the
abstract numeric). `firstBrand` writes that rule into each overload as an inline conditional
chain. The header comment of the file gives the reason: no helper type becomes a global name an
author could write (Rules 2.2 and 9.8).

The chain is five arms per argument. Measured on the review baseline:

- 49 overloads carry it, one in each of 49 builtins.
- 37 chains read one argument, 8 read two (`atan2`, `max`, `min`, `pow`, `step`, `distance`,
  `insertBits`, `select`), and 4 read three (`clamp`, `mix`, `smoothstep`, `fma`).
- The 49 lines are 15 727 characters of `SHADE_DTS`.

`pow`'s scalar overload, as `SHADE_DTS` holds it (462 characters):

```ts
declare function pow<P0 extends number, P1 extends number>(a0: P0, a1: P1): ([P0] extends [boolean] ? bool : typeof f32Tag extends keyof P0 ? f32 : typeof i32Tag extends keyof P0 ? i32 : typeof u32Tag extends keyof P0 ? u32 : typeof f64Tag extends keyof P0 ? f64 : ([P1] extends [boolean] ? bool : typeof f32Tag extends keyof P1 ? f32 : typeof i32Tag extends keyof P1 ? i32 : typeof u32Tag extends keyof P1 ? u32 : typeof f64Tag extends keyof P1 ? f64 : number))
```

`min`'s is the same text under its own name (462 characters). `clamp`'s reads three arguments
(681 characters):

```ts
declare function clamp<P0 extends number, P1 extends number, P2 extends number>(a0: P0, a1: P1, a2: P2): ([P0] extends [boolean] ? bool : typeof f32Tag extends keyof P0 ? f32 : typeof i32Tag extends keyof P0 ? i32 : typeof u32Tag extends keyof P0 ? u32 : typeof f64Tag extends keyof P0 ? f64 : ([P1] extends [boolean] ? bool : typeof f32Tag extends keyof P1 ? f32 : typeof i32Tag extends keyof P1 ? i32 : typeof u32Tag extends keyof P1 ? u32 : typeof f64Tag extends keyof P1 ? f64 : ([P2] extends [boolean] ? bool : typeof f32Tag extends keyof P2 ? f32 : typeof i32Tag extends keyof P2 ? i32 : typeof u32Tag extends keyof P2 ? u32 : typeof f64Tag extends keyof P2 ? f64 : number)))
```

typeshade.dev's language reference prints each declaration as `SHADE_DTS` holds it. At the
site's pin, 49 of its 175 function pages print a chain like these. Each one shows the brand
symbols `f32Tag` to `f64Tag`, which the site documents nowhere, and wraps to many lines.

### After this change

The ambient library declares one type alias, `ScalarOf`. It states the rule `firstBrand` writes
today, once:

```ts
type ScalarOf<A, B = unknown, C = unknown> = unknown extends A
  ? number
  : [A] extends [boolean]
    ? bool
    : typeof f32Tag extends keyof A
      ? f32
      : typeof i32Tag extends keyof A
        ? i32
        : typeof u32Tag extends keyof A
          ? u32
          : typeof f64Tag extends keyof A
            ? f64
            : ScalarOf<B, C>
```

Every generated scalar overload returns `ScalarOf` over the arguments that the row's result
type reads, in order. The same three declarations become:

```ts
declare function pow<P0 extends number, P1 extends number>(a0: P0, a1: P1): ScalarOf<P0, P1>
declare function min<P0 extends number, P1 extends number>(a0: P0, a1: P1): ScalarOf<P0, P1>
declare function clamp<P0 extends number, P1 extends number, P2 extends number>(a0: P0, a1: P1, a2: P2): ScalarOf<P0, P1, P2>
```

They are 92, 92 and 125 characters. The 49 lines go from 15 727 characters to 3 735.

The shape is read off `firstBrand`:

- **Fixed arity with defaults.** TypeScript has no variadic list of type parameters. The rows
  need at most three, so `ScalarOf` takes three, and the second and third default to `unknown`.
  The generator derives the arity from the rows it generates and fails when a row needs more
  (Decision D1).
- **`unknown` is the end of the list.** `unknown extends A` holds only for an argument slot the
  call does not fill. A builtin's type parameter is bounded by `number`, `boolean` or
  `number | boolean`, so TypeScript never infers `unknown` for one, and the sentinel cannot meet
  a real argument. A list that ends with no brand is `number`, as the last arm of the chain is
  today.
- **The arms keep their order.** `bool` first, then `f32`, `i32`, `u32` and `f64`, which is
  `BRANDS` in `builtin-signatures.ts`. The alias is generated from `BRANDS`, so the order has
  one source (Decision D2).
- **The check stays on the bracketed form and on `keyof`.** `[A] extends [boolean]` does not
  distribute over a union, and `typeof f32Tag extends keyof A` is the brand test `VecElemOf`
  documents in `ambient.ts`. The checked type of each arm is not a naked type parameter, so no
  arm distributes.

No inferred type moves. Where TypeScript has the arguments, it evaluates `ScalarOf` as it
evaluates the chain today. A call's hover and its signature help show the instance, for example
`pow<f32, f32>(a0: f32, a1: f32): f32`. What changes is the text of the declaration: in
`dist/shade.d.ts`, on a reference page, and in a declaration an editor shows before the
arguments are known.

**Rule 9.6.** The §9.3 table gains one row in the "type machinery" family, directly after
`Numeric`:

| Family         | Name       | Reason                                                                   |
| -------------- | ---------- | ------------------------------------------------------------------------ |
| type machinery | `ScalarOf` | the scalar a builtin's scalar overload returns, read off its first brand |

Family note 7 gains one sentence: `ScalarOf` names the result rule of a generated scalar
overload of a builtin, so the rule is written once and the overloads name it.

**Surface §49.** The paragraph on the generated builtin declarations gains one sentence: a row
over a scalar returns `ScalarOf<P0, …>`, the scalar of the first argument that carries a brand,
`bool` for a boolean, and `number` when none does.

**Exclusions.** The vector overloads (`V extends vec2 | …`, the element read by `elementOf`) and
the location overloads (atomics, `arrayLength`) do not change. The hand-written overloads in
`ambient.ts` do not change. No compiler behaviour changes: no emit, no diagnostic, no code.

## Why

### The problem and its evidence

- Seungup saw it on typeshade.dev on 2026-10-13: the scalar overloads of the builtins print
  brand symbols and many lines of conditional types.
- Measured at the site's pin `c89f6b2` (typeshade.github.io `4ff04c4`, `languageEntries()` of
  `src/lib/language-reference.ts`): 175 function entries, and 49 of them carry the chain in
  their signature.
- The brand symbols are machinery. The site lists none of `f32Tag`, `i32Tag`, `u32Tag` or
  `f64Tag` as a helper type, so a reader of `pow`'s page meets four names the page does not
  explain.

### Why a declared name now

The header comment of `builtin-signatures.ts` chose the inline chain so that no helper type
becomes a global name an author could write (Rules 2.2 and 9.8). Proposal 0017 had already
planned the opposite: its Rule 9.6 entry let the "type machinery" rows gain "one for the scalar
a call's arguments carry", by Rule 9.7. This proposal takes that plan, with the name Seungup
chose.

The rules allow the name:

- **Rule 2.1(c).** `ScalarOf` becomes an author-facing name of source (c), by a row of §9.3
  (Rules 9.6, 9.7 and 13.6).
- **Rule 2.2 and §2.1.** A compiler-internal name denotes a representation the compiler chose,
  an operation over one, a pass intermediate, a contract between passes, or a generated backend
  name. `ScalarOf` is none of these. It denotes a type over WGSL values: the scalar `T` a
  `core.def` row's result takes, as WGSL's overload resolution picks it from the arguments.
  It is not a value, and the front end resolves no call to it.
- **Rule 9.8.** The row's reason describes a rule of WGSL's typing, not a representation the
  compiler chose. The review Rule 9.8 asks for reads it on this pull request.
- **Rule 12.7.** The declaration stays derived from the compiler's tables: the overloads are
  still one per `core.def` row, and `ScalarOf` is generated from `BRANDS`, the table
  `firstBrand` reads today. A program the compiler accepts draws no new editor error, and an
  expression's editor type does not move (the measurement below).

An author who writes `ScalarOf` where a shader type is due is refused in both halves, as an
author who writes `VecFor2<f32>` is today. Measured on the review baseline:
`const x: VecFor2<f32> = uv.x` is `TS8002` in `compile()` and in the language service.

### Measurement on a prototype

A prototype applied the two edits to a scratch copy of the review baseline: `ScalarOf` in
`SHADE_DTS`, and `ScalarOf<…>` in place of `firstBrand(…)`. It was reverted, and it is not part
of this pull request. Observed on 2026-10-13, Bun 1.4.2:

- The language service's hover at the call, the hover at the result variable, `getDiagnostics`
  and `compile()`'s errors were byte-identical before and after on twelve calls:
  `pow(f32, f32)`, `pow(2., 3.)`, `pow(2., f32)`, `clamp(i32, 0, 10)`, `clamp(0.5, 0., f32)`,
  `min(u32, u32)`, `max(f64, 1.)`, `abs(i32)`, `sqrt(f32)`, `select(f32, f32, bool)`,
  `extractBits(u32, u32, u32)` and `fma(1., 2., f32)`. Examples of the call hover:
  `pow<f32, f32>(a0: f32, a1: f32): f32`, `pow<2, 3>(a0: 2, a1: 3): number`,
  `clamp<i32, 0, 10>(…): i32`, `max<f64, 1>(…): f64`. No diagnostic in either half.
- `bunx vitest run` over `coredef-overloads.test.ts`, `expression-parity.test.ts`,
  `hover.test.ts`, `signature.test.ts`, `ambient.test.ts`, `ambient-parity.test.ts` and
  `surface-names.test.ts`: 450 passed, 6 failed. All 6 failures name `ScalarOf` as a declared
  name with no §9.3 row (5 cases of `surface-names.test.ts`) or no entry in
  `LIBRARY_TYPE_NAMES` (1 case of `ambient-parity.test.ts`). These are the gates the
  implementation satisfies with the row and the entry.

### Alternatives

- **Keep the chain.** It is correct, and every page and `dist/shade.d.ts` stay unreadable.
- **A tuple form, `ScalarOf<[P0, P1]>`.** It needs no default and no fixed arity. The
  declarations read one pair of brackets more, and Seungup's spelling is `ScalarOf<P0, P1, …>`.
  It stays open as D1's second choice.
- **One alias per arity (`ScalarOf1` to `ScalarOf3`).** Three rows of §9.3 for one rule.
- **Reuse `VecElemOf`.** It reads one type and has no "no brand" result; an unbranded number
  falls to its `F` arm, so it cannot give `number` for an all-literal call.
- **Shorten the text on the site only.** The site would rewrite the compiler's declarations,
  and `dist/shade.d.ts` and an editor would still show the chain. Rule 12.7 makes the ambient
  file the one vocabulary.

### Assumptions

- The rows that need a scalar result read at most three arguments. This holds on the review
  baseline. D1's guard makes a fourth a build failure, not a silent wrong type.
- The editor shows an instantiated signature wherever the arguments are known. The prototype
  observed this for hover and signature help. A declaration shown without arguments (go to
  definition into `dist/shade.d.ts`, the site) shows the short form.

### Decisions

- **D1. The shape.** Proposed: `ScalarOf<A, B = unknown, C = unknown>`, with the arity taken
  from the generated rows and a generator error when a row needs more. Alternative: the tuple
  form above.
- **D2. Where the alias is written.** Proposed: `builtin-signatures.ts` builds the declaration
  from `BRANDS` and exports it, and `ambient.ts` places it beside `Numeric`. Alternative: write
  it by hand in `ambient.ts`, and keep `BRANDS` and the alias in agreement by a test.
- **D3. The reuse of a retired name.** `ScalarOf` was a §9.3 row until #210 (proposal 0007,
  item 7), with another meaning: a vector's element type, per its element kind. Proposal 0007
  removed it with `VecOf`, `ComponentKeys` and `Vec64`. Seungup chose the name for the new
  meaning on 2026-10-13. The `CHANGELOG.md` entry says that the name returns with a new meaning.
  A search of typeshade.github.io, vscode-typeshade, radiance and stepinside on 2026-10-13
  found no use of the old name outside a pinned compiler tree.

## What it touches

- **Rule 9.6.** The §9.3 table gains the `ScalarOf` row in the "type machinery" family, and
  family note 7 gains its sentence (Rule 9.7: the rationale first, then the
  `TYPESHADE_EXTENSIONS` row with the same reason, the surface `§`, the `CHANGELOG.md` entry).
  The table is inside a `LINT.IfChange(extensions)` block whose target is
  `src/core/spec-conformance/surface-names.test.ts:extensions`, so the two change in one
  commit.
- **Surface §49.** "The editor and the compiler agree" gains the sentence on the scalar
  overload's result.
- **No export changes.** `SHADE_DTS` stays a `string` (`src/__api__/surface.md`). Its text
  changes.
- **No diagnostic code changes, and no example is added or removed.**

Files the implementation changes:

- `src/language-service/builtin-signatures.ts`: `firstBrand` is replaced by the `ScalarOf`
  spelling and the generated alias (D2). The header comment's paragraph on inline conditionals
  is rewritten to say why the rule is now a declared name.
- `src/language-service/ambient.ts`: `SHADE_DTS` declares `ScalarOf` beside `Numeric`.
- `src/compiler/ts/type-map.ts`: `LIBRARY_TYPE_NAMES` gains `ScalarOf`, so the compiler knows
  the library declares it.
- `src/core/spec-conformance/surface-names.test.ts`: `TYPESHADE_EXTENSIONS` gains the row.
- `docs/language-design.md` §9.3, `docs/use-typeshade-surface.md` §49, `CHANGELOG.md`
  (`[Unreleased]`, Rules 9.7 and 13.8).

Tests the implementation owes, on both halves (CLAUDE.md, "A test reads both halves"):

1. The editor's type of a scalar call does not move. On one source, the language service's
   `getHover` and `getDiagnostics`, and `compile()`'s diagnostics and emit, for at least:
   `pow(f32, f32)` is `f32`; `pow(2., 3.)` is `number` in the editor and abstract in the
   compiler (Rule 12.7); `clamp(i32, 0, 10)` is `i32`; `min(u32, u32)` is `u32`;
   `max(f64, 1.)` is `f64`; `select(f32, f32, bool)` is `f32`. The rows go in
   `src/language-service/ambient-parity.test.ts` or `src/language-service/hover.test.ts`.
2. `ScalarOf` written as a shader type (`const x: ScalarOf<f32> = uv.x`) is refused in both
   halves with `TS8002`, the same refusal `VecFor2<f32>` gets.
3. The generated text: every generated scalar overload returns `ScalarOf<…>`, `SHADE_DTS` holds
   no inline `[P0] extends [boolean]` chain, and the generator throws for a row that needs more
   arguments than `ScalarOf` takes (D1).
4. `src/core/spec-conformance/surface-names.test.ts` accepts `ScalarOf` by its row, and its
   table-equality case reads the new row of §9.3.
5. `src/language-service/ambient-parity.test.ts` ("every type the library declares is a name the
   compiler knows is declared") accepts `ScalarOf` through `LIBRARY_TYPE_NAMES`.
6. `src/core/spec-conformance/coredef-overloads.test.ts` passes unchanged: it reads every
   SUPPORTED instance in both halves.

Document checks the implementation owes: `bun run docs:impact`, `bun run docs:refs`, and
`bun run reqs:sync` with `doorstop -C`, since §9.3 is under Rule 9.6. `docs/language-service-api.md`
(the paragraph on the generated overloads, "WHAT THE LIB DECLARES") is a review item: it
describes the scalar row's type parameters and may gain the name of its result.

### Draft impact estimate

- **Known.** One generator function, one ambient declaration, one entry in each of two name
  lists, one table row, two sentences of documentation and one `CHANGELOG.md` entry. The
  prototype shows the type behaviour does not move, and names the gates that change.
- **Compatibility.** A program that compiles today compiles the same. An author gains one type
  name. A program that declares its own `ScalarOf` keeps it, since a declaration of the file
  wins over a library type of the name (Rule 2.1, "Enforced by"). This is not measured for
  `ScalarOf` and is a case for test 2.
- **Tools.** No new tool or dependency.
- **Duration and cost.** Not estimated.
- **Downstream.** One pin pull request on typeshade.github.io with one change to its helper
  filter (below). No work is expected in vscode-typeshade: a search on 2026-10-13 found no
  copy of the chain or of the §9.3 type-machinery names there.

### Approval and plan record

This record does not yet apply. Acceptance will require: Seungup's decision and the merge of
this proposal's pull request with `status: accepted`; the answers to D1, D2 and D3; and the
final impact declarations above.

### Configuration and validation record

This record does not yet apply. Delivery will require: the implementation pull request(s) with
`Change: 0063`; the delivered configuration (commit); the observed results of tests 1 to 6 and
of `bun run build`, `bun run test`, `bun run docs:impact`, `bun run docs:refs`, `doorstop -C`
and `bun run format:check`; and the measured length of the `pow`, `clamp` and `min`
declarations in the built `dist/shade.d.ts`. The prototype above is draft evidence, not this
record.

## What it owes downstream

### typeshade.github.io

Expected work, after the pin moves to a compiler that carries 0063:

1. The language reference reads `SHADE_DTS` at the pin. Each of the 49 function pages prints
   the short scalar overload, `ScalarOf<P0, …>`, with no change to the site's code.
2. `src/lib/language-reference.ts` lists, for each entry, the helper types its signature names,
   under "A signature may name a type the ambient file declares for its own use" (`helpersP` in
   `src/i18n/en.ts`). It drops a type alias whose text names a brand tag (`isHandle`), to keep
   out the opaque handles. `ScalarOf` reads `f32Tag` to `f64Tag`, so `isHandle` drops it. At the
   site's pin, the same filter already drops `VecElemOf` and `BitcastArg`: the helper set is
   `BoolVec`, `Numeric`, `ReadView`, the storage-texture types, `TexelCoord2`, `TexelCoord3`,
   `TextureElem`, `Vec64Any`, `VecFor2` to `VecFor4` and `WriteOnlyStorageFormat`. The site
   narrows `isHandle` (for example, a handle is a type whose declaration carries a tag as a
   property key, not one that reads `typeof tag`), so `ScalarOf` is listed beside `Numeric`.
   Whether `VecElemOf` and `BitcastArg` are listed too is the site's decision.
3. `compiler-changes.md` records `0063`.
4. The site checks the `pow`, `clamp` and `min` pages in a browser at 1440 and 390 after the
   build.

Responsibilities and the pin date are not assigned.

### vscode-typeshade

None expected. A search of its tree on 2026-10-13 (outside the pinned compiler) found no
`Numeric`, `VecElemOf` or inline brand chain in its code or documents.
