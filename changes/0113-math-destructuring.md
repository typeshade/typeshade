---
id: '0113'
title: An author binds Math members to short names with a const, `const { sqrt, PI } = Math`, as TypeScript writes it
status: draft
rules:
  - '6.3'
  - '9.4'
  - '9.5'
surface:
  - '12'
  - '14'
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The guide pages that render surface §12 and §14 show the new form at the pin, and the rule pages render the amended Rules 6.3, 9.4 and 9.5 from reqs/. compiler-changes.md records 0113 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's account of the forms the compiler refuses drops `const { … } = Math` and `const s = Math.sqrt`, and states the vector case of section 4. compiler-changes.md records 0113 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names rules and sections it will amend -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0113, `status: draft`. The front matter is the identity and lifecycle authority. No implementation exists.                                                                                                                                                                                                                                    |
| Date and attribution          | Authored 2026-11-02, UTC, by a Claude Code agent. This is the authorship date, not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                             |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-02, in Korean. The owner asked whether an author should always have to write `Math.` for math that is almost all of a shader ("항상 Math 라는걸 쓰도록 유도하는 것도 고민됩니다"), and then approved drafting this proposal ("승인").                                                         |
| Applicability / effectivity   | `docs/language-design.md` (Rules 6.3, 9.4 and 9.5), `docs/use-typeshade-surface.md` (§12 and §14), `reqs/` (the items of those rules), the front end (`src/compiler/ts/`), the language service (`src/language-service/`), and their tests. No IR node, backend, CPU tier, export, diagnostic code or example changes. No release version is assigned. |
| Review baseline               | `main` at `9afe73a` (2026-11-02). The measurements in section 1 were made on `main` at `c9efde0`; no commit between the two touches the front end's handling of `Math`.                                                                                                                                                                                |
| Review and revision authority | Pull request [#877](https://github.com/typeshade/typeshade/pull/877) (branch `claude/proposal-0113-math-destructuring`). Git records the revisions of this file; the merge of #877 with `status: accepted` records the decision.                                                                                                                       |

## What changes

### 1. Today

An author who wants a short name for a `Math` member writes the TypeScript they already know, and
both halves refuse it. Measured on `main` at `c9efde0` with `compile()` and the language service's
`getDiagnostics`, on the same source:

| Source                                     | `compile()`                                                       | Editor                           |
| ------------------------------------------ | ----------------------------------------------------------------- | -------------------------------- |
| `const { sqrt, sin, PI } = Math;` (module) | `TS8014 Module const must be a simple name.`                      | the same                         |
| `const { sqrt, PI } = Math;` (function)    | `TS8022 "Math" is an object of functions, not a value. …`         | the same                         |
| `const { sqrt: s } = Math;`                | `TS8022`, then `TS8004 Unknown function "s".`                     | the same                         |
| `const s = Math.sqrt;`                     | `TS8099 "Math.sqrt" is a function alias. Call it.`, then `TS8004` | the same                         |
| `const P = Math.PI;`                       | accepted                                                          | accepted                         |
| `const { foo } = Math;`                    | `TS8022`                                                          | TypeScript's 2339, then `TS8022` |

So the only short spelling is a free name: WGSL's `sqrt`, or a TypeShade row of §9.3 (`PI`,
`log10`, `cbrt`). Proposal 0112, drafted in parallel, removes the rows of §9.3 that only repeat a
`Math` member. This proposal gives the author the TypeScript way to keep a short name.

### 2. The proposed meaning

A `const` whose initializer is `Math`, with an object pattern, binds each name to the `Math`
member of its key. A `const` whose initializer is a `Math` member (`const s = Math.sqrt`) binds the
one name the same way.

```ts
"use typeshade";
const { sqrt, sin, PI } = Math;

export function f(x: f32): f32 {
  const { abs: a } = Math;
  return sqrt(a(x)) + sin(x) * PI;
}
```

- **A bound name is an alias, not a value.** No object and no function value exists at run time.
  A call of a name bound to a function member means the call of that member, and lowers as
  `Math.sqrt(x)` lowers today (Rule 9.4). A name bound to a constant member (`PI`, `E`, `LN2`,
  `LN10`, `LOG2E`, `LOG10E`, `SQRT2`, `SQRT1_2`) is that constant, inlined as an `f32` literal as
  `Math.PI` is today.
- **Renaming is accepted.** `const { sqrt: s } = Math` binds `s` to `Math.sqrt`.
- **Scope is TypeScript's.** A module-scope binding is visible in the whole file; a binding in a
  function body is visible in its block (surface §21).
- **The signature is the member's.** The bound name takes exactly the signatures the ambient
  `MathObject` declares for the member, so the editor's TypeScript checker and the compiler read
  one type. Proposal 0112 keeps `Math` members to ECMAScript's scalar signatures. This proposal
  does not depend on 0112: it binds whatever signatures the member has when it lands.
- **Nothing new is emitted.** The WGSL, the GLSL and the CPU oracle see the same IR as for the
  `Math.member` spelling. No emitted name, IR node or intrinsic id is added.

### 3. What stays refused

Each refusal is one sentence in both halves, with the same code and text (Rule 12.5, Rule 12.7).
No new diagnostic code is added: each case uses an existing code with its own sentence.

| Form                                              | Code     | What the sentence says                                                                                          |
| ------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `let { sqrt } = Math`, `let s = Math.sqrt`        | `TS8099` | a function member is bound with `const`; a `let` would hold a function value, which a shader has none of        |
| `let { PI } = Math`                               | accepted | a constant member is a number, and `let` copies it, as `let p = Math.PI` does today                             |
| `const { sqrt, ...r } = Math`                     | `TS8099` | `Math` has no remainder to name; bind the members you call (the sentence §14 gives a struct's rest, for `Math`) |
| `const { sqrt = Math.abs } = Math`                | `TS8099` | every member is present, so a default stands in for nothing (the sentence §14 gives a struct's default)         |
| `const { foo } = Math`                            | `TS8022` | `Math` has no member `foo`; TypeScript's 2339 merges into it                                                    |
| `({ sqrt } = Math)`, an assignment pattern        | `TS8099` | as §14 refuses an assignment pattern today                                                                      |
| `export const { sqrt } = Math`                    | `TS8014` | a bound `Math` member is not exported; open point O2                                                            |
| `ap(Math.sqrt, x)`, a member handed as a function | `TS8099` | unchanged; open point O3                                                                                        |
| `const { log } = console`                         | `TS8022` | unchanged; `console` is out of scope (section 5)                                                                |

### 4. The interaction with Rule 9.5

A bound name is a declaration of the file. Rule 9.5 makes a declaration of the file win over every
builtin of its name, and TypeScript's lookup does the same. So `const { sqrt } = Math;` hides
WGSL's `sqrt` in its scope: at module scope, in the whole file.

The consequence is a vector argument. WGSL's `sqrt` takes a vector; `Math.sqrt` takes a scalar (in
ECMAScript, and in the ambient library under proposal 0112). Inside the scope of a bound `sqrt`,
`sqrt(v)` on a `vec3f` is refused in both halves:

- the editor reports TypeScript's 2345 today (`Argument of type 'vec3' is not assignable to
parameter of type 'number'.`), measured on `c9efde0` in a function that binds `sqrt`;
- the compiler must report the same refusal, with a sentence that names the fix: `"sqrt" here is
Math.sqrt, which takes a scalar; leave sqrt out of the pattern to call the builtin, which takes a
vector.`

**Proposed decision: accept the refusal.** It is what TypeScript says of the same program, it keeps
the two halves one vocabulary (Rule 12.7), and the fix is one edit. The alternative (a bound name
that falls back to the WGSL builtin for a vector) would make the compiler accept what the editor's
checker refuses, or would need a second type for the bound name that the editor cannot project
(Rule 1.7). Decided on 2026-11-02 by the owner (O1): the refusal is accepted. Its message names
the fix.

### 5. Exclusions

- `console` and every other object. `console` is output, which Rule 1.6 places in host code; its
  destructuring stays refused as it is today.
- A pattern over anything but `Math` or a `Math` member: the destructuring of a struct, a vector
  and an array stays as §14 states it.
- Parameter patterns, `for...of` patterns and nested patterns over `Math`: refused as §14 refuses
  them today.

### 6. The rules this proposal amends

The text below is proposed. The implementing pull request writes it into
`docs/language-design.md` and `reqs/`.

**Rule 6.3 (amended), a sentence added.** A top-level `const` whose initializer is `Math` with an
object pattern, or a `Math` member, binds each name to that member (Rule 9.4) and declares no
module constant of its own.

**Rule 9.4 (amended), a sentence added.** A name a `const` binds to a `Math` member, by an object
pattern over `Math` or by the member itself, must mean that member: a call of it is the member's
call, and a constant member is its inlined literal; it takes the member's signatures, and no
function value exists for it.

**Rule 9.5 (amended), a sentence added.** A name a `const` binds to a `Math` member is a
declaration of the file and wins over a builtin of its name in its scope, as TypeScript's lookup
finds it; a call the member's signature refuses is refused in that scope, with a sentence that
names the builtin and how to reach it.

## Why

- **Rule 1.6 (proposal 0100).** A form TypeScript authors commonly write in compute code must be
  supported, and a TypeShade name is not a substitute for it. `const { sqrt, PI } = Math` is that
  form for an author who finds `Math.` too long for code that is almost all math.
- **It makes the free names unnecessary.** Proposal 0112 removes the §9.3 rows that repeat a `Math`
  member. Without this proposal, an author who wrote `PI` would have to write `Math.PI` at every
  use. With it, one line at the top of the file keeps the short name, and the name has a source an
  author can look up (Rule 2.1(b)).
- **It costs no new surface.** No name, no export and no code is added; one ECMAScript form of a
  name the library already declares becomes accepted.

### Alternatives

- **Keep the refusal, and keep the free names of §9.3.** Not taken: it keeps names with no source
  for what TypeScript already says (Rule 1.4 of proposal 0100).
- **Accept any `const` alias of a function, `const f = g`.** Not taken here: a function value is a
  separate decision (Rule 8.18 and open point O3). This proposal binds only `Math` members, whose
  meaning the compiler already resolves by name.
- **Let a bound name fall back to the WGSL builtin for a vector.** Not taken (section 4).

### Assumptions and open points

- **O1, decided on 2026-11-02.** A bound `sqrt` hides WGSL's `sqrt` in its scope, so `sqrt(v)` on
  a vector is refused there (section 4). The refusal's message names the fix.
- **O2, decided on 2026-11-02.** `export const { sqrt } = Math` and an import of it from another
  shader module (surface §68) stay refused. An imported alias of a `Math` member is a new path
  through the import resolver with no evidence of need.
- **O3.** A `Math` member handed to a function that takes one (`ap(Math.sqrt, x)`, Rule 8.18).
  Out of scope; it stays refused.
- The implementation assumes that the front end can resolve a bound name to its member before
  it resolves a callee (`resolveMathFn` in `src/compiler/ts/math-alias.ts`). This is unverified.

## What it touches

- **Rule 6.3**: a top-level `const` with a `Math` pattern is no module constant; `TS8014` no longer
  refuses it.
- **Rule 9.4**: the meaning of a name bound to a `Math` member.
- **Rule 9.5**: a bound name is a declaration of the file, with the refusal of section 4.
- **Surface §12**: the module-constant section states the `Math` binding at module scope.
- **Surface §14**: the destructuring subsection ("A destructuring declaration is the reads it stands
  for") states the `Math` pattern and the refusals of section 3.
- **Codes**: none added, removed or renumbered. `TS8014`, `TS8022` and `TS8099` gain sentences.
- **Examples**: none.
- **Tests the implementation owes** (each reads both halves, CLAUDE.md "A test reads both halves"):
  every row of sections 1 and 3, through `compile()` and `getDiagnostics`, and `getHover` on a bound
  name; a row in `src/language-service/ambient-parity.test.ts`; the emit of a bound call and of a
  bound constant, equal to the `Math.member` spelling on WGSL and GLSL; the CPU oracle on the same
  program; the vector refusal of section 4 in both halves with the same sentence.

### Draft impact estimate

- **Known.** Front-end work in the declaration lowering (module and local `const`) and in callee
  resolution; the language service needs no type change, since TypeScript already types the
  pattern against `MathObject`, but it must stop reporting the compiler's `TS8014` and `TS8022` for
  the accepted forms.
- **Compatibility.** Additive. Every program that compiles today compiles the same. A program the
  editor or the compiler refuses today becomes accepted.
- **Dependencies.** None. Proposal 0112 is related, not required.
- **Estimate.** Unknown. No measurement exists.

### Approval and plan record

- 2026-11-02, the owner (Seungup), in a Claude Code session, in Korean ("승인"): O1 and O2 decided
  as proposed. O3 stays out of scope.
- Acceptance requires the merge of this proposal with `status: accepted`.

### Configuration and validation record

This record does not yet apply. Delivery will require the tests listed in "What it touches", run
on the implementing commit, and the document audit of Rules 6.3, 9.4 and 9.5 and surface §12 and
§14 against the delivered behavior.

## What it owes downstream

- **typeshade.github.io**: the guide pages that render surface §12 and §14, and the rule pages for
  Rules 6.3, 9.4 and 9.5, at the new pin. Expected work: re-render; no page names the refused form
  by text, to be confirmed by a search for `= Math` in that repository.
- **vscode-typeshade**: the skill's account of refused forms, and the vector case of section 4.
  Expected work: one paragraph. compiler-changes.md records 0113 when the pin moves.

These obligations are pending until the compiler implementation lands.
