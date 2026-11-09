---
id: '0137'
title: A parameter that a function writes back to its caller is written `@inout a: f32` or `@out c: f32`, before the parameter, and no longer as the type `inout<T>` or `out<T>`
status: draft
rules:
  - '1.7'
  - '1.8'
  - '6.7'
  - '7.2'
  - '7.6'
  - '8.25'
surface:
  - 6
  - 7
  - 9
  - 14
  - 26
  - 49
  - 52
  - 65
  - 70
  - 76
exports: []
exports-removed: []
codes: []
examples: []
names: []
downstream:
  - repo: typeshade.github.io
    what: The pages, the i18n strings (English and Korean), the lowering table and the GLSL migration guide that write `inout<T>` or `out<T>` show `@inout a: T` and `@out c: T`; the TypeAudio website's generated function template, its project JSON and its browser check that match `state: inout<State>` are edited by hand, since `tshc migrate` does not reach a template string; `compiler-changes.md` records 0137 when the pin moves.
  - repo: vscode-typeshade
    what: Its skill, references, fixtures and inlay hints already write and read `@inout` and `@out` and stay; its tsserver tests follow the TS1206 filter for a parameter qualifier, which lives in this repository (`src/language-service/diagnostics.ts`); `compiler-changes.md` records 0137 when the pin moves.
  - repo: typecv
    what: Its 10 `@inout` parameters (under `src/` at review time) are the language's form and stay; the move of them to `inout<T>` that change 0111 and change 0130 list as owed is cancelled; do not run a `tshc migrate` from before this proposal's implementation, which would still rewrite them to `inout<T>`; `compiler-changes.md` records 0137 when the pin moves.
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0137, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Date and attribution          | Drafted 2026-11-09 (UTC) by an AI agent (Claude Code) at the owner's direction. The date is the drafting date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-09, in Korean: "inout, in, out 이런건 지금 앞에 따로 쓰는데 왜 타입으로 바꿔야해?". The owner chose the form written before the parameter for a parameter qualifier and kept the type form for an entry's I/O. Recorded as `docs/owner-decisions.md` OD-5 (pull request #1120, merged as `583891d2`). No GitHub issue is recorded.                                                                                                                                                                                                                                                                                                                                |
| Applicability / effectivity   | Expected: `docs/language-design.md` Rules 6.7, 7.2, 7.6 and 8.25, and the texts change 0130 proposes for Rules 1.7, 1.8, 6.7, 7.6 and 8.25; `reqs/`; `docs/use-typeshade-surface.md` §6, §7, §9, §14, §26, §49, §52, §65, §70 and §76; `docs/typescript-coverage.md`; `src/compiler/ts/decorated-form.ts`, `attribute-types.ts`, `lower/references.ts`, `lower/statement.ts`, `definite.ts`, `host-face.ts`, `narrowing.ts`; `src/cli/migrate.ts`; `src/language-service/ambient.ts`, `diagnostics.ts`, `navigation.ts`, `hover.ts`, `docs.ts`; `examples/reference-parameters.shade.ts`; `journeys/class-twins/units.shade.ts`; the tests listed under "What it touches"; `CHANGELOG.md`. No release version is assigned. |
| Review baseline               | `main` at `583891d2` (merge of pull request #1120, OD-5), read on 2026-11-09. Every count and measurement below was taken on that commit unless the row says otherwise.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Review and revision authority | No pull request is assigned at the first revision. Git records the revisions of this file. The review and the merge of its pull request record the decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## What changes

This proposal replaces two decisions of change 0111 for a parameter qualifier, and the
sentences of change 0130's proposed rule texts that carry them:

- Change 0111 D4 ("`@inout x: T` and `@out x: T` become the types `inout<T>` and `out<T>`") is
  replaced: the qualifier is written before the parameter.
- Change 0111 D5 (one release warns on the decorated form, the next refuses it) no longer applies
  to `@inout` and `@out`. It still applies to the other decorators of change 0111 that change
  0130 keeps scheduled (`@builtin`, `@location`, `@interpolate`, `@invariant`, `@blend_src` on a
  parameter or a field).

An entry's built-in values and inter-stage values stay in the type, `builtin<…>` and
`location<…>` (OD-5). This proposal does not touch them.

### Before and after

**Before** (`main` at `583891d2`, surface §70):

```ts
"use typeshade";

class Ray {
  origin!: vec3;
  dir!: vec3;
}
declare const rays: storage<array<Ray>, "read_write">;

function swap(a: inout<f32>, b: inout<f32>): void {
  const t = a;
  a = b;
  b = t;
}

function add(a: f32, b: f32, c: out<f32>): void {
  c = a + b;
}

function advance(r: inout<Ray>, t: f32): void {
  r.origin = r.origin + r.dir * t;
}

export const main = compute([64, 1, 1], function main(id: builtin<"global_invocation_id", vec3u>): void {
  let x: f32 = 1.;
  let y: f32 = 2.;
  swap(x, y); // x is 2., y is 1.
  let s!: f32;
  add(x, y, s); // s is 3.
  advance(rays[id.x], 2.); // the storage element itself
});
```

**After** (this proposal alone; the lines this proposal changes are the three function
headers):

```ts
"use typeshade";

class Ray {
  origin!: vec3;
  dir!: vec3;
}
declare const rays: storage<array<Ray>, "read_write">;

function swap(@inout a: f32, @inout b: f32): void {
  const t = a;
  a = b;
  b = t;
}

function add(a: f32, b: f32, @out c: f32): void {
  c = a + b;
}

function advance(@inout r: Ray, t: f32): void {
  r.origin = r.origin + r.dir * t;
}

export const main = compute([64, 1, 1], function main(id: builtin<"global_invocation_id", vec3u>): void {
  let x: f32 = 1.;
  let y: f32 = 2.;
  swap(x, y); // x is 2., y is 1.
  let s!: f32;
  add(x, y, s); // s is 3.
  advance(rays[id.x], 2.); // the storage element itself
});
```

With change 0130 implemented as accepted, the entry becomes
`@compute([64, 1, 1]) export function main(id: builtin<"global_invocation_id", vec3u>): void { … }`
and the local becomes `let s: f32;` (change 0130 D1 and D3). The function headers are as above
in both cases. The call stays unmarked: `swap(x, y)`. The emitted WGSL and GLSL ES 3.00 do not
change: `fn swap(a: ptr<function, f32>, b: ptr<function, f32>)` and
`void swap(inout float a, inout float b)`. Measured on `583891d2`: `compile()` of the decorated
`swap` and of an `@out` parameter `split(v: vec2, @out q: vec2)` gives
`fn split(v: vec2<f32>, q: ptr<function, vec2<f32>>)` and `void split(vec2 v, inout vec2 q)`, the
text `src/compiler/ts/reference-parameters.test.ts` asserts for the type form.

### Every form that changes

| Form                                                                                                                                                    | Today (`583891d2`)                                                                                                                                                                 | After                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@inout a: T`, `@out c: T` on a parameter of a module function                                                                                          | compiles, with a `TS8028` warning on each decorator: `"@inout" is the decorated form, which the next release refuses: write "a: inout<f32>", or run "tshc migrate" (change 0111).` | the language's form: compiles with no diagnostic in either half                                                                                              |
| `a: inout<T>`, `c: out<T>`                                                                                                                              | the language's form                                                                                                                                                                | the decision for the owner below: (a) a `TS8028` warning for one release, then refused; (b) refused at once with `TS8028`; (c) accepted beside the attribute |
| a qualifier on a parameter of an entry, a method, a constructor, an accessor, a local function, a function written as an argument or a generic function | `TS8073`; on a local function the editor also shows TypeScript's TS1206 (measured)                                                                                                 | `TS8073` alone in both halves (Rule 12.4)                                                                                                                    |
| two qualifiers on one parameter, `@inout a: inout<f32>`                                                                                                 | `TS8028` warning and `TS8073` "`"a" carries inout<T> and inout<T>`"                                                                                                                | under (a) or (b), the type form's `TS8028` alone; under (c), `TS8073` naming `@inout` twice                                                                  |
| the messages of `TS8073`, `TS8075`, the `TS8018` remedy and the host view's `never` reason                                                              | name the type form: `"a" is inout<T>, and …`, `"c" is an out<T> parameter, …`, `declare "r: inout<Ray>"`                                                                           | name the attribute: `"a" is @inout, and …`, `"c" is an @out parameter, …`, `declare "@inout r: Ray"`                                                         |
| hover on a qualified parameter                                                                                                                          | `(parameter) a: inout<f32>`, and on the function `function swap(a: inout<f32>, b: inout<f32>): void`                                                                               | `(parameter) @inout a: f32`, and on the function `function swap(@inout a: f32, @inout b: f32): void`                                                         |
| hover on `@inout`                                                                                                                                       | "The decorated form of `p: inout<T>`: …"                                                                                                                                           | what the qualifier does, with no "decorated form" wording                                                                                                    |
| go-to-definition on `@inout` or `@out`                                                                                                                  | throws `Debug Failure` from TypeScript 5.6.3 (measured; a defect on `main` today)                                                                                                  | answers, or answers nothing, and does not throw                                                                                                              |
| `tshc migrate`                                                                                                                                          | rewrites `@inout v: f32` to `v: inout<f32>`                                                                                                                                        | does not; under (a) or (b) it rewrites `v: inout<f32>` to `@inout v: f32`                                                                                    |
| `@in a: f32`                                                                                                                                            | `TS8030 Expression expected.` (`in` is a keyword, so this is no decorator)                                                                                                         | unchanged: `in` is not written (OD-5)                                                                                                                        |

### The type form `inout<T>` and `out<T>`: options for the owner

OD-5 says the type form "is not the language's form". It does not say when a written
`inout<T>` stops compiling. Three options:

| Option                                | What an author sees                                                                                                                                                            | Cost                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) warn for one release, then refuse | `a: inout<f32>` compiles with a `TS8028` warning, `write "@inout a: f32", or run "tshc migrate" (change 0137)`. The release after it refuses the type form with the same text. | Two implementing steps. The ambient library keeps `type inout<T>` and `type out<T>` for the warning release. The project has no published release (below), so the warning reaches only downstream repositories that pin a commit inside the window. One spelling in the end.                                              |
| (b) refuse at once                    | `a: inout<f32>` is a `TS8028` error with the same text, in the compiler and in the editor. `tshc migrate` rewrites it.                                                         | One implementing step. A downstream pin that moves past it must rewrite the type form in the same pull request. On `main` of the downstream repositories only typeshade.github.io writes it (below). Three of its places are template strings and JSON that `tshc migrate` does not reach. One spelling at once.          |
| (c) keep both                         | `a: inout<f32>` and `@inout a: f32` both compile, with no diagnostic.                                                                                                          | Two spellings of one construct stay, and the author learns both. The ambient library keeps the type aliases. The hover, the messages and the documents choose one spelling and mention the other. This is what OD-3 rejects ("가능한 다 없애는게 맞아요"), and OD-5 says that the type form "is not the language's form". |

**Measured facts for the choice** (2026-11-09):

- `npm view typeshade versions` lists only `0.0.0`. `npm view typeshade@0.0.0 description` is
  "Placeholder ahead of the first release.", published 2026-09-07, 2 files.
- `gh api repos/typeshade/typeshade/releases` and `…/tags` each return an empty list.
  `git ls-remote --tags origin` lists nothing.
- `CHANGELOG.md` has a heading `[0.1.0] - 2026-09-29`. No tag and no npm version carries it.
- The type aliases `type inout<T> = T` and `type out<T> = T` entered the ambient library in
  `fef8133d` (2026-11-02), after that heading.
- Inference: no published version carries `inout<T>` or `out<T>`. Rule 13.9 binds "a published
  version", so it does not decide between the options. Rule 13.10 covers a program that keeps
  compiling and computes something else, which no option does.
- Change 0132 decision 5 is the precedent for (b): the owner chose on 2026-11-09 to refuse a
  written `@diagnostic` at once, on the same facts.

**Recommendation: (b), refuse at once.** It rests on:

- OD-5: the type form is not the language's form.
- OD-3: one construct has one spelling, and the author does not learn a second one.
- OD-1: the type form exists only so that a plain `tsc` accepts the file, which OD-1 rejects.

The cost of (b) is the downstream rewrite at the next pin move of typeshade.github.io, listed
under "What it owes downstream". Under (a) the same rewrite happens one step later.

### Amending change 0130 and change 0111

Change 0130 is accepted and not implemented. Change 0111 is accepted and partly implemented.
`changes/README.md` says an accepted proposal is amended in its own pull request. This proposal
is that pull request for the qualifier. It is a separate record, as change 0130 is a separate
record that replaces change 0111 D1. It does not edit the text of change 0130 or change 0111.

- The texts below replace the named sentences of change 0130's proposed rule texts. The rest of
  change 0130 stands.
- Whichever of change 0130 and this proposal is implemented second keeps this proposal's
  sentences for the qualifier. If this proposal is implemented first, it edits the rule texts
  on `main`, and change 0130's implementation then applies its own texts with these sentences in
  place of the replaced ones.
- The pull request that accepts this proposal also adds one sentence after the first paragraph
  of change 0130's "What changes": "Change 0137 replaces the sentences of this proposal's rule
  texts that make a parameter qualifier a type; the implementation applies change 0137's
  sentences." It changes no decision of change 0130.

### The proposed rule texts

Each text replaces the named part whole. A sentence that is not named stays.

- **Rule 1.8** (change 0130's proposed text). <!-- doc-refs: skip — Rule 1.8 is the rule change 0130 adds -->
  The sentence "A construct that describes a value that flows in or out (a parameter, a field,
  a result, a binding) is part of its type." becomes: "A construct that describes a value that
  flows into or out of an entry (an entry's parameter, a field of an entry I/O struct, an
  entry's result) or a binding is part of its type. A parameter qualifier, which states that a
  function writes back to its caller's variable, is an attribute `@inout` or `@out` written
  before the parameter it marks (Rule 8.25)." Its Rationale gains, after "The owner rejected both
  criteria on 2026-11-09.": "The owner decided on 2026-11-09 that a parameter qualifier is
  written before the parameter, as GLSL writes `inout float a`, and that an entry's I/O stays in
  the type (`docs/owner-decisions.md`, OD-5)." Its Derives from gains "change `0137`; OD-5".
- **Rule 1.7** (change 0130's proposed text). The list "(a stage attribute, Rule 8.1, or
  `@workgroup_size`, Rule 8.22)" becomes "(a stage attribute, Rule 8.1, `@workgroup_size`, Rule
  8.22, or a parameter qualifier `@inout` or `@out`, Rule 8.25)". On `main` today, Rule 1.7
  reads "projected to valid TypeScript". If this proposal is implemented before change 0130, it
  leaves Rule 1.7 on `main` as it is: the editor already keeps `@inout` as TypeScript parses it
  (The editor, below), and change 0130 brings the kept-form wording.
- **Rule 6.7** (on `main` and in change 0130's text). The clause "and `inout` and `out` are the
  types `inout<T>` and `out<T>` (Rule 8.25, D4)" (0130: "(Rule 8.25)") becomes "and `inout` and
  `out` are attributes written before a parameter, `@inout a: f32` and `@out c: f32` (Rule 8.25,
  change 0137)". `@inout` and `@out` leave the list of decorated forms that warn and are refused
  later (on `main`, the sentence that begins "The decorated forms"; in change 0130's text, the
  clause "the decorators `@builtin`, … `@inout` and `@out` on a parameter or a field stay as
  change 0111 D5 says"). Its Derives from gains "change `0137`".
- **Rule 7.2**, the row "an assignment to an `inout<T>` or `out<T>` parameter, or to a field,
  component or element of it (change 0111, D4)" becomes "an assignment to an `@inout` or `@out`
  parameter, or to a field, component or element of it (changes 0040 and 0137)". The other
  columns of the row stay.
- **Rule 7.6** (on `main` and in change 0130's text). Each "`out<T>` parameter" becomes "`@out`
  parameter", and each "`out<T>` argument" becomes "argument of an `@out` parameter". Nothing
  else in the rule changes.
- **Rule 8.25** (on `main`; change 0130 replaces only its Rationale clause).
  - Its first sentence becomes: "A parameter declared `@inout` or `@out`, written before the
    parameter (`@inout a: f32`, `@out c: f32`), names the caller's place, and the call passes the
    variable itself, unmarked: reading the parameter reads that place, and assigning to it, or
    to a field, component or element of it, writes it, for the call."
  - In the fourth sentence, "An `out<T>` parameter" becomes "An `@out` parameter", "`out<T>` and
    `inout<T>` give one result" becomes "`@out` and `@inout` give one result", and "an argument an
    `out<T>` parameter takes" becomes "an argument an `@out` parameter takes".
  - The fifth sentence ("Each type means `T` to TypeScript, … The decorated form, `@inout x: T`
    and `@out x: T`, stays accepted until the release after the migration release (change 0111,
    D5).") becomes: "To TypeScript the parameter is its written type `T`, and an assignment to it
    is local; that the write reaches the caller is a divergence Rule 7.2 records. The type form
    of change 0111, `a: inout<T>` and `a: out<T>`, must be refused with `TS8028`, which names the
    attribute form and `tshc migrate` (change 0137)." Under option (a) the text adds "after one
    release that warns". Under option (c) the sentence reads "is accepted and means the same".
  - Its Rationale clause "written as the parameter's type, `inout<T>` or `out<T>`, which a plain
    `tsc --strict` accepts where it refuses a decorator on a parameter of a function (change
    0111)", and change 0130's replacement of it, become: "written before the parameter, `@inout`
    or `@out`, as GLSL writes `inout float a` (OD-5)".
  - Its Derives from: "change `0111` (D4)" becomes "change `0111` (D4, replaced by change
    `0137`); change `0137`".
  - Its Enforced by: "`src/compiler/ts/attribute-types.ts`, which reads `inout<T>` and `out<T>`
    as the qualifiers, pinned by `src/compiler/ts/attribute-types.test.ts`" becomes "the front
    end's reading of a qualifier, `qualifiersOf` in `src/compiler/ts/lower/references.ts`, and
    the refusal of the type form, pinned by `src/compiler/ts/reference-parameters.test.ts`; the
    editor's TS1206 filter for a qualifier in `src/language-service/diagnostics.ts`, pinned by
    the same test".

Rules 8.8, 8.10, 8.17 and 12.7 and §9's note 10 already write `@inout` and `@out`. They do not
change.

### The editor (Rule 1.7, Rule 12.4, Rule 12.7)

Measured on `583891d2` with TypeScript 5.6.3 (`node_modules/typescript`):

- `tsc --noEmit --strict` reports TS1206 ("Decorators are not valid here") on each `@inout` and
  `@out` on a parameter of a plain function. `--experimentalDecorators` changes nothing. The
  type form gives no diagnostic.
- A TypeScript language service over the same file reports TS1206 three times and nothing
  else. Quick info on the parameter is `(parameter) a: f32`. `findReferences` and
  `findRenameLocations` on `a` return its three occurrences. Completion in the body offers `a`.
  `findReferences` and `findRenameLocations` on `inout` inside the decorator answer.
- `getDefinitionAtPosition` on `inout` inside `@inout` throws `Debug Failure` (in
  `getEffectiveDecoratorArguments`). The tree's language service throws it too
  (`getDefinition` at `@inout`), since the guard in `src/language-service/navigation.ts`
  (`isDecoratorOnFunctionDeclarationAt`) covers a decorator on a function declaration and not
  one on its parameter. This is a defect on `main` today, which typecv's `@inout` files reach.
- The tree's language service hides TS1206 on `@inout` today only because the file "still writes
  the decorated form" (`usesDecoratedForm`, `src/language-service/diagnostics.ts`), and it shows
  the `TS8028` warning. On a qualifier of a local function it shows TS1206 beside `TS8073`.

The language service therefore:

1. Keeps `@inout` and `@out` as written in the file it gives TypeScript. References, rename,
   completion and the parameter's type stay TypeScript's.
2. Drops TS1206 on `@inout` or `@out` on a parameter of a function at the top of the file or of
   a namespace, whatever else the file writes. The filter no longer depends on
   `usesDecoratedForm`, and `usesDecoratedForm` no longer counts a qualifier.
3. Drops TS1206 on `@inout` or `@out` where the compiler refuses the qualifier (`TS8073` on an
   entry, a method, a local function and the other places of Rule 8.25), so the compiler's
   refusal is the one diagnostic (Rule 12.4).
4. Checks the qualifier with the compiler's own check, as it does today: `TS8073`, `TS8074` and
   `TS8075` reach the editor from `compile()`. This is no second checker (Rule 1.7).
5. Guards go-to-definition on a decorator of a parameter of a function declaration, as it
   guards one on the function declaration, so the request answers and does not throw.
6. Shows the hover in the author's form: `(parameter) @inout a: f32` on the parameter, and
   `function swap(@inout a: f32, @inout b: f32): void` on the function (`hover.ts`). The hover on
   `@inout` and `@out` (`ATTRIBUTE_DOCS` in `docs.ts`) says what the qualifier does and no longer
   calls it "the decorated form of `p: inout<T>`".
7. Under (a) or (b), shows the compiler's `TS8028` on a written `inout<T>` and no TypeScript
   diagnostic for the same mistake (Rule 12.4).

A test reads both halves on each case, in the shape of
`src/compiler/ts/reference-parameters.test.ts`, which already reads every program in the
compiler and in the editor.

### Tooling

Measured on 2026-11-09: prettier 3.9.10 (`SyntaxError: Decorators are not valid here.`),
esbuild 0.28.2 and `bun build` (`Expected identifier but found "@"`) refuse a decorator on a
parameter of a plain function. `.prettierignore` already excludes `*.shade.ts`. Under OD-1 and
Rule 1.8 this is no reason to change the form. It is the same tooling work that change 0130 <!-- doc-refs: skip — Rule 1.8 is the rule change 0130 adds -->
lists for a stage attribute ("Tooling owed by the project"). This proposal adds no new kind of
tooling work.

### `tshc migrate`

`src/cli/migrate.ts` rewrites `@inout v: f32` to `v: inout<f32>` today, through
`attributeTypeOf` in `src/compiler/ts/decorated-form.ts`, whose last loop wraps the type for each
qualifier. The implementation:

1. Stops that rewrite: `attributeTypeOf` no longer wraps a qualifier, and a qualifier decorator
   is left as written.
2. Under (a) or (b), rewrites `v: inout<T>` to `@inout v: T` and `v: out<T>` to `@out v: T` on a
   parameter of a module function. A type form it cannot carry (no parameter, a type alias that
   wraps `inout<T>`) is left as written and named in `skipped`, as today.
3. Leaves a template string as written, as today. The TypeAudio website's three places (What it
   owes downstream) are edited by hand.

### Exclusions

- An entry's I/O (`builtin<…>`, `location<…>` and their options) is out of scope (OD-5).
- The `!` on a local that an `@out` argument fills is change 0130's (D3).
- `in` is not written (OD-5). `@in a: f32` is a parse error today (`TS8030`), and this proposal
  adds no message for it. A better message is compiler work.

## Why

Change 0111 D4 moved the qualifier into the type for one reason: a plain `tsc --strict` refuses
a decorator on a parameter of a function (TS1206). OD-1 rejects that criterion: whether a
TypeScript tool accepts a form is not a criterion for the language. With the reason gone, the
owner decided the form (OD-5): a qualifier is written before the parameter, as GLSL writes it
and as TypeShade wrote it from change 0040 until change 0111.

The type form also reads as a type that it is not. `inout<f32>` means `f32` to TypeScript
(`type inout<T> = T`), so a hover, a type alias or a generic argument shows a type that carries a
call-site meaning. The attribute marks the parameter, not its value.

### Alternatives

| Alternative                                     | Why it is not proposed                                                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep the type form as the language's form       | Reverses OD-5.                                                                                                                                 |
| A keyword before the parameter (`inout a: f32`) | TypeScript does not parse it, the language service cannot keep it as a form TypeScript parses (Rule 1.7), and the owner chose `@inout a: f32`. |
| Infer the qualifier from the body's writes      | The compiler cannot know whether the author means the write to reach the caller ("Why the compiler cannot do it").                             |

### Costs of the owner's decision

Recorded as costs of OD-5, not as reasons against it (`CLAUDE.md`, The owner's decisions):

- A plain `tsc --strict`, prettier, esbuild and `bun build` refuse a file that writes `@inout`
  or `@out` (measured above). The language service hides TS1206.
- TypeScript 5.6.3 throws on go-to-definition at the decorator. The language service guards it.
- The compiler tree rewrites the type form in about 36 source files, 4 documents and 2 shader
  files (measured below).

## Owner's decisions

- **OD-5** is the basis: a parameter qualifier is written before the parameter, `@inout a: f32`
  or `@out c: f32`; `in` is not written; an entry's I/O stays in the type.
- **OD-1** removes the only reason of change 0111 D4: a plain `tsc` accepting the file is not a
  criterion.
- **OD-3** is the basis of the recommendation of option (b): one construct has one spelling.
- **OD-4**: the before and after, the list of forms that change and the options with their costs
  are shown above.
- **OD-2** is untouched: this proposal changes no stage form.

This proposal reverses no entry.

## Why the compiler cannot do it

This proposal adds no author-facing name (`inout` and `out` stay in
`src/__api__/author-names.md` as the decorators they are today). It changes a surface form and
rule texts, so this section applies.

The qualifier is author intent. A function that assigns to its parameter can mean two things:
the write is local to the function (TypeScript's value semantics, Rule 8.8), or the write reaches
the caller's variable. The program alone does not say which one the author means, and the
compiler must not change TypeScript's value semantics on its own. So the author states it, and
the language keeps the qualifier. This proposal changes only where it is written. It adds no
construct that the compiler could replace.

## What it touches

- **Rules 1.7 and 1.8**: the texts change 0130 proposes, so that a parameter qualifier is a kept
  attribute and not part of the type. <!-- doc-refs: skip — Rule 1.8 is the rule change 0130 adds -->
- **Rule 6.7**: `inout` and `out` are attributes before the parameter, and they leave the list of
  decorated forms that warn and are refused later.
- **Rule 7.2**: the divergence row names `@inout` and `@out`.
- **Rule 7.6**: `out<T>` becomes `@out` in its text.
- **Rule 8.25**: the form, the refusal of the type form, the rationale and the enforcement.
- **Surface §6** (step 7 lists `inout<T>` and `out<T>`), **§7** (the decorated-form row, the
  `TS8075` and `TS8073` rows), **§9**, **§14**, **§26**, **§49**, **§52**, **§65**, **§70** and
  **§76**: each section that writes `inout<T>` or `out<T>` (measured: 34 occurrences in those
  sections) writes `@inout` or `@out`. §70's title becomes "Parameter qualifiers: `@inout` and
  `@out`".
- **Codes**: none added, removed or renumbered. The messages of `TS8028` (the decorated-form
  warning no longer covers a qualifier; under (a) or (b) a new message on the type form),
  `TS8073`, `TS8075`, the `TS8018` remedy and the host view's reason change, and the tests that
  assert their text follow (Rule 12.5).
- **Examples**: none added or removed. `examples/reference-parameters.shade.ts` (17 type-form
  occurrences) and `journeys/class-twins/units.shade.ts` (1) are rewritten. Their emit goldens
  must not move.
- **Exports and names**: none.

### Draft impact estimate

Known, measured on `583891d2` with `git grep -E '\b(inout|out)<'`:

| Place                               | Files | Occurrences |
| ----------------------------------- | ----- | ----------- |
| `src/`                              | 36    | 139         |
| `docs/`                             | 4     | 73          |
| `changes/` (history; not rewritten) | 2     | 37          |
| `examples/`                         | 1     | 17          |
| `journeys/`                         | 1     | 1           |

Of the 36 files under `src/`, 21 are tests. The others are the compiler's readers and messages
(`attribute-types.ts`, `decorated-form.ts`, `definite.ts`, `host-face.ts`, `lower/references.ts`,
`lower/statement.ts`, `narrowing.ts`), the language service (`ambient.ts`, `diagnostics.ts`,
`docs.ts`, `hover.ts`), `src/cli/migrate.ts`, `src/cli/run.ts`, `src/core/testing/compute-programs.ts`
and `src/AGENTS.md`.

Estimate: one implementing pull request under (b) or (c), two under (a). Duration and cost are not
estimated.

Validation required at implementation:

- `bun run test`, the compile gate (Tint and WebGL2) and the user journeys green.
- The emit goldens of `reference-parameters` and of the class twins unchanged.
- `src/compiler/ts/reference-parameters.test.ts` reads each case in both halves: the attribute
  form with no diagnostic, each refusal once, the hover, go-to-definition at `@inout` that does
  not throw, and the type form under the chosen option.
- `tshc migrate` tests: `@inout v: f32` stays; under (a) or (b), `v: inout<f32>` becomes
  `@inout v: f32`.
- `bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync` and
  `python scripts/doorstop-check.py -C`.

### Decisions for the owner

1. The type form `inout<T>` and `out<T>`: option (a), (b) or (c). Recommended: (b).

### Open questions for the owner

None beyond decision 1. OD-5 settles the one conflict this proposal meets: change 0130's
Rule 1.8 text says a parameter is part of its type, and OD-5 says a parameter qualifier is <!-- doc-refs: skip — Rule 1.8 is the rule change 0130 adds -->
written before the parameter. No other two principles or rules point different ways for this
change.

### Independent review record

Not yet performed. `changes/README.md` (Independent review) requires one review by an agent or
a person that did not write this proposal before the owner decides.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decision on decision 1, the
independent review record with an answer to each finding, and the merge of this proposal's pull
request with `status: accepted`.

### Configuration and validation record

This record does not yet apply. Delivery will require the evidence listed under "Draft impact
estimate".

## What it owes downstream

Measured on 2026-11-09 with `git grep -E '\b(inout|out)<'` and `git grep -E '@(inout|out)\b'` on
each repository's `origin/main`. `vendor/`, `node_modules/` and `dist/` are left out.

- **typeshade.github.io** (`typeshade/web`, `ed33afb`): the type form in <!-- doc-refs: skip — paths in a downstream repository -->
  `apps/typeshade/src/i18n/en.ts` (12) and `ko.ts` (14), `src/lib/typescript-lowering.ts` (5), <!-- doc-refs: skip — paths in a downstream repository -->
  `src/lib/language-reference.ts` (2), `src/components/pages/LanguageFunctionsPage.astro` (3), <!-- doc-refs: skip — paths in a downstream repository -->
  `content/guide/ko/the-cpu-oracle.md` (7) and `content/guide/ko/migrating-a-glsl-shader.md` (2). <!-- doc-refs: skip — paths in a downstream repository -->
  The TypeAudio website writes it in a generated template, `apps/typeaudio/website/functions/newDefinition.ts`, <!-- doc-refs: skip — paths in a downstream repository -->
  in `public/projects/function-impact.json` (3) and in the check
  `check-function-authoring-browser.ts` (`/state: inout<State>/`). These three are strings that
  `tshc migrate` does not reach. (One more match, `CodeContext.tsx`, is HTML, `out</code>`, and
  not the type form.)
- **vscode-typeshade** (`db3f417`): no type form. Its skill, references, MCP fixtures and inlay <!-- doc-refs: skip — paths in a downstream repository -->
  hints (`packages/tsserver-plugin/src/inlay.ts`, `writesBack`, which reads only the decorator)
  already use `@inout` and `@out`. Its tsserver tests follow the TS1206 filter of this
  repository.
- **typecv** (`4189b3c`, pin `78a9060f`): no type form. 10 `@inout` parameters in <!-- doc-refs: skip — paths in a downstream repository -->
  `src/geometry/gpu/pair-models.shade.ts` (1), `src/mvs/gpu/cloud-knn.shade.ts` (3) and <!-- doc-refs: skip — paths in a downstream repository -->
  `src/mvs/gpu/mvs.shade.ts` (6) stay. Change 0130's downstream entry for typecv lists "10
  `@inout` parameter decorators" to move to types; this proposal cancels that part.
- **radiance** (`3e4efb3`), **typenn** (`3a7d66c`), **typeaudio** (`9c1266d`): no type form and
  no qualifier. Nothing owed.

Each repository in `downstream` records 0137 in `compiler-changes.md` when its pin moves.
