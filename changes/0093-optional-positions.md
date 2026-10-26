---
id: '0093'
title: An optional value, `T | undefined`, may be a struct field, an array element and an optional parameter `x?: T`, where no binding layout holds it
status: draft
rules:
  - '7.10'
  - '8.8'
  - '8.18'
  - '8.21'
surface:
  - 7
  - 14
  - 28
  - 64
  - 76
exports: []
exports-removed: []
codes: []
examples:
  - optional-fields
downstream:
  - repo: typeshade.github.io
    what: Move an optional struct field, an optional array element and an optional parameter from the refused positions to the allowed ones in the English and Korean TypeScript guides; replace the TS8020 optional-parameter sentence and the TS8010 optional-field sentence in the error-code data and the Playground fixtures; add the example; record 0093 when the pin moves.
  - repo: vscode-typeshade
    what: Update the authoring skill's refused positions and its TS8020 and TS8010 references, verify hover on an optional field and an optional parameter, and record 0093 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names a future example, future test files, a rule and a surface section that exist only on the branch of change 0088, and files in other repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0093, `status: draft`. The front matter is the identity and lifecycle authority. No decision has been taken on this proposal.                                                                                                                                                                                                                                                                                                                                                                                            |
| Date and attribution          | Authored 2026-10-26, UTC, by a Claude Code agent. The date is the authorship date. It is not an approval or a delivery date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                |
| Request source                | The owner (Seungup) directed in a Claude Code session on 2026-10-26, in Korean, that the `"use typeshade"` surface should move toward ordinary TypeScript. The coordinating agent proposed this change as the first step, and the owner replied "진행 승인" (approve proceeding). The coordinating agent relayed both to the authoring agent. These are request records. They are not an acceptance of this proposal.                                                                                                             |
| Applicability / effectivity   | `"use typeshade"` source: the TypeScript front end (`src/compiler/ts/`), the structs the module declares, the WGSL and GLSL ES 3.00 writers, the CPU oracle and codegen, the host face (`src/compiler/ts/host-face.ts`), the language service (`src/language-service/`), and the documents named below. No new IR node and no public export is planned. No release version is assigned. This proposal extends change 0088 and is implementable only on a `main` that carries 0088's implementation.                               |
| Review baseline               | `main` at `fc234dbc6568bacc33349d5492a27a418c0950c9`, which carries proposal 0088 as `accepted` and no implementation of it. The implementation of 0088 was read on branch `change-0088-optional-values` at `9e053ecc109e6377166c863a97a4a335649b1b00`, the head of [#769](https://github.com/typeshade/typeshade/pull/769) (work in progress). Every measurement below ran against that head. The rule and surface texts this proposal changes are the ones that head carries. `#769` may move before this proposal is accepted. |
| Review and revision authority | No pull request is assigned at authoring time. The proposal-only pull request, once opened, is the place of discussion, and its merge with `status: accepted` is the decision record. Git records the revisions of this file. This document does not name the hash of the commit that contains it.                                                                                                                                                                                                                                |

## What changes

### The proposal in one paragraph

Change 0088 lets a local, a parameter and a function's result hold `T | undefined`, and leaves
a struct field, an array element and an optional parameter `x?: T` refused (its decisions D4 and
D8, its Exclusions). This proposal allows the three where no binding layout holds them: a struct
field and an array element in function scope, and an optional parameter on a function that is
not an entry point and not a kernel function. The lowering is the one 0088 already has, the
internal struct `__opt_<key>`, as the field's or the element's type. A struct or an array that
holds an optional is refused where it reaches a binding, a module variable, a module constant, an
entry point's parameter or result, a kernel function's parameter, or the host. `null` and
`xs.find(p)` stay refused.

### Before and after

At the review baseline (`#769` at `9e053ecc`) `compile()` and the editor refuse the first
program with one TS8002 at the class field and the second with one TS8020 at the parameter
(measured on 2026-10-26 UTC; the method is in Why):

```ts
"use typeshade";

class Hit {
  t: f32;
  n: vec3 | undefined; // TS8002 "vec3 | undefined" holds a value and a flag …; a struct field may not.
}

function march(o: vec3, d: vec3, limit?: f32): Hit { // TS8020 Optional parameter "limit" is not supported …
  const far = limit ?? 100.;
  // …
}
```

Under this proposal both compile. `Hit.n` is an `__opt_vec3_f32` field of `Hit`. `limit` is a
parameter of type `f32 | undefined`, and `march(o, d)` passes the absent value for it, as
`march(o, d, undefined)` does. The WGSL below is an illustration in the spelling the 0088 branch
emits for the internal struct:

```wgsl
struct _opt_vec3_f32_ { value: vec3<f32>, present: bool }
struct Hit { t: f32, n: _opt_vec3_f32_ }

fn march(o: vec3<f32>, d: vec3<f32>, limit: _opt_f32_) -> Hit { … }
// a call that omits `limit`:  march(o, d, _opt_f32_(0.0, false))
```

### Proposed behavior

**Positions.** The table of Rule 7.10 and surface §76 changes as follows. A row this proposal
does not name keeps 0088's entry.

| Position                                                                                      | 0088                     | Proposed                                                              |
| --------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------- |
| a field of a class, an interface or a type literal                                            | refused                  | allowed; the struct is a function-scope struct                        |
| an array element, `array<T \| undefined, N>`                                                  | refused                  | allowed; the array is a function-scope array                          |
| an optional field `f?: T`                                                                     | refused (`TS8010`)       | the same type as `f: T \| undefined` (decision D3)                    |
| an optional parameter `x?: T` on a helper, a method, a constructor, a local function          | refused (`TS8020`)       | allowed: `x` is `T \| undefined`, and a call may omit it              |
| `x?: T` in a function-typed parameter's type, `f: (x?: f32) => f32`                           | refused (`TS8020`)       | allowed, with the same meaning (Rule 8.18)                            |
| `x?: T` on an arrow function written as an argument                                           | refused (`TS8020`)       | decision D6                                                           |
| `x?: T` on an entry point or on a kernel function                                             | refused (`TS8020`)       | refused (`TS8020`), with a sentence that names the reason             |
| `x?: T = d`                                                                                   | refused (`TS8020`)       | refused (`TS8020`): TypeScript's TS1015, one parameter has one filler |
| a struct with an optional field, or an array of optionals, in a binding                       | not reached              | refused (`TS8002`) at the binding, naming the field                   |
| the same in a module variable, a module constant, an override                                 | not reached              | refused (`TS8002`) at the declaration                                 |
| the same as an entry point's parameter or result (an IO struct)                               | refused at the field     | refused (`TS8002`) at the entry, naming the field                     |
| the same as a kernel function's parameter (a storage array's element, a `Map` or `Set` value) | refused at the field     | refused (`TS8002`) at the parameter                                   |
| the same as a host-callable export's parameter or result                                      | no host value (measured) | no host value (Rule 8.21), the reason naming the field                |
| `xs.find(p)` on a fixed array                                                                 | refused (`TS8099`, §63)  | unchanged (Exclusions)                                                |
| `null`                                                                                        | refused                  | unchanged (0088 D7)                                                   |

"Function scope" means what Rule 7.10 means by it today: the struct or the array is the type of
a local, a parameter, a function's result, a function-typed parameter's parameter or result, or
a field or an element of one of these. The same struct declaration may serve a binding and a
local today. Under this proposal a struct that holds an optional serves function scope only, and
a binding that names it is refused at the binding.

**A struct field.** A field `f: T | undefined` of a class, an interface or a type literal has the
internal struct as its type, in the field's place among the members. `T` is what Rule 7.10
allows an optional to hold, so a field may hold an optional of a struct, and that struct may
hold an optional field of its own. `undefined` written for the field in an object literal
(`{ t: 1., n: undefined }`), in a constructor argument or in an assignment (`h.n = undefined`)
is the absent value. A `T` written there is present. A class field with no initializer starts
absent in `new C()`, since the absent value is the zero of the internal struct and `new C()`
starts each field at its zero today. A class field with an initializer `n: vec3 | undefined =
vec3(0., 1., 0.)` starts present. A field read `h.n` is an optional value and takes every form
of Rule 7.10: `h.n ?? d`, `h.n === undefined`, `h?.n`, and a narrowed read `h.n.value`.

**An array element.** `array<T | undefined, N>` and `[a, undefined, c]` against that type hold
the internal struct as the element. `xs[i]` is an optional value. A `for…of` loop's variable is
one. The array methods of surface §63 that take a callback hand the callback an optional
element, as they hand any element type. `array<T | undefined>` with no size is a storage array,
which stays refused (Rule 7.10: an array with no size is not a `T`, and storage is a binding).

**Narrowing of a member path (decision D2).** TypeScript narrows a reference `h.n`, and `h.a.n`,
by the same control flow that narrows a name. The recommended option follows TypeScript for a
member path rooted at a local or a parameter: `if (h.n !== undefined) { use(h.n); }`. A path is
narrowed by the forms Rule 7.10 lists for a name. An assignment to the path, to any prefix of it
(`h = …`, `h.a = …`), or to the root narrows or clears it as TypeScript does, and so does a call
that takes the root by reference (an `@inout` or `@out` argument, Rule 8.25; a method that
writes its object, Rule 8.10), after which the path is un-narrowed. Inside a closure the rule
for the root applies. An element access `xs[i]` is not narrowed, even with a literal index; it is
a recorded divergence (Rule 7.2), and the un-narrowed sentence names the copy to write:
`const x = xs[i]; if (x !== undefined) …`. The measured form on the baseline (`#769` at
`9e053ecc`), where a member read after a member test is reported with the generic result
sentence, becomes the 0088 un-narrowed sentence under either option of D2.

**An optional parameter `x?: T`.** On a function that is not an entry point and not a kernel
function, `x?: T` declares `x` as `T | undefined` in the body. A call may omit it, and the
omitted argument is the absent value, filled in where the call is, as surface §14 fills a
default in. A call may also write `undefined` for it. The arity sentence that a call with too
few arguments gets today (`"f" takes 2 to 3 argument(s), got 1`) counts an optional parameter
as it counts one with a default. TypeScript's own rules apply through Rule 12.7: an optional
parameter follows every required one (TypeScript's TS1016), and `x?: T = d` is refused
(TypeScript's TS1015), each with one compiler sentence, since the compiler reads no checker. The
body treats `x` exactly as it treats a parameter `x: T | undefined` (0088). `x?: T` on a method,
a static function, a constructor and a local function means the same. On an entry point the
parameter comes from the pipeline, and on a kernel function it comes from the host, so both are
refused (`TS8020`), with a sentence that says so. On a host-callable export (Rule 8.20) an
optional parameter has no host value (Rule 8.21, 0088 decision D4), so the host view declares
the export `never` with that reason, as it does for `x: T | undefined` today.

**A function-typed parameter (Rule 8.18).** `f: (x?: f32) => f32` takes a function whose
parameter is `f32 | undefined`, or `x?: f32`, and a call `f()` inside the body passes the absent
value. A function declared `(x: f32) => f32` is not taken: TypeScript refuses that assignment
under `strictNullChecks`, because `f32 | undefined` is not assignable to `x: f32`, so the
compiler refuses it too, with Rule 8.18's does-not-fit sentence (`TS8003`). A function declared
with fewer parameters is taken as Rule 8.18 takes it today. Decision D6 settles an arrow
function written in the call with `x?: T`.

**The host and `reflect()`.** A struct that holds an optional field has no host value: the host
view declares an export that takes or returns one `never`, with the reason naming the field
(`its result: field R.w: an optional value, f32 | undefined, has no host value yet (Rule
8.21)`, measured on the baseline). An array of optionals has none either. `reflect()` reports
the layouts of uniform and storage bindings, the vertex layout, the entries and the overrides
(`Reflection` in `src/core/reflect.ts`). No binding may hold an optional, so no optional reaches
`reflect()` output, and its shape does not change. A host mapping for an optional field stays
with 0088's decision D4.

**The refused sentences.** `TS8002`'s position sentence changes from "which a local, a parameter
or a function's result may hold; a struct field may not" to one that names the new allowed
positions and the refused one, in the pattern of 0088:
`"f32 | undefined" holds a value and a flag saying whether it is there, which a local, a parameter, a function's result, a struct field or an array element may hold; a binding may not. Carry a u32 flag beside the value, "f32".`
A struct refused through a field names the field: `"U" holds "w: f32 | undefined", … ; a binding may not.`
The remedy for a binding names a `u32`, not a `bool`, because WGSL forbids a `bool` in
host-shareable memory. The exact text is the implementing pull request's to settle; the
proposal fixes the pattern.

`TS8020`'s optional-parameter sentence (`Optional parameter "x" is not supported: a shader value
is always present, so there is no "absent" for the body to test. Give it a default instead …`)
is retired. Two narrower `TS8020` sentences take its place: one for an entry point's or a kernel
function's parameter, naming where the value comes from, and one for `x?: T = d`, naming
TypeScript's TS1015. `TS8010`'s optional-field sentence (`Optional field "y?" on "Q" is not
supported: a struct field is always present in the buffer the host fills.`) is retired under
decision D3's recommended option and kept under its alternative. No code is added, removed or
renumbered, so `codes` is empty.

### Exclusions

This change adds no host value for an optional, no optional in a binding, a module variable, a
module constant, an override, an enum member, a `Map` value or a `Record` value, no optional
parameter on an entry point or a kernel function, and no `null` (0088 decision D7 stands).
`xs.find(p)` stays refused (surface §63): it is an array method, not a position, and its
lowering is a loop that stops at the first match beside `findIndex`, which is a change to §63's
list and its own proposal. `m.get(k)` keeps its `has` guard (surface §74). `exactOptionalPropertyTypes`
is not modelled: `f?: T` and `f: T | undefined` are one type here, as they are in TypeScript's
default configuration.

## Why

### The problem

A TypeScript author puts "no value" where the value belongs: in the record that carries it (a
hit with no normal), in the list that collects it (a sample that was skipped), and in the
signature that may do without it (`limit?: f32`). 0088 lets the author write `T | undefined`
only for a local, a parameter and a result, so a struct that carries such a value still needs a
hand-written flag, and a function that may do without an argument still needs a default value
that means "none". The owner's direction is that the surface moves toward ordinary TypeScript.
These three positions are the ones the owner's direction reaches first, because their lowering
already exists.

### Evidence

**Measured on the review baseline** (2026-10-26 UTC, worktree of `change-0088-optional-values`
at `9e053ecc`, Bun 1.4.4, `compile()` from `src/compiler/ts/compile.ts`,
`createTypeshadeLanguageService()` from `src/language-service/service.ts`, `hostFace()` from
`src/compiler/ts/host-face.ts`, `compileModule()` from `src/core/oracle.ts` and
`compileModuleJs()` from `src/core/cpu-codegen.ts`; each program with one fragment entry):

| Source                                                                                                   | `compile()`                                                                                                                                                                                                     | Editor                                                                                     |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `class Q { f: f32 \| undefined; }`                                                                       | TS8002 `… a struct field may not. Carry a bool field beside the value, "f32".`                                                                                                                                  | the same TS8002                                                                            |
| `interface P { x: f32; w: f32 \| undefined; }` and `type P = { … }`, used by a local                     | accepted; WGSL `struct P { x: f32, w: _opt_f32_, }` emitted before `struct _opt_f32_`; GLSL ES 3.00 emits `_opt_f32_` before `P`                                                                                | nothing                                                                                    |
| the same, `const w = p.w; if (w !== undefined) { return w * 2.; }`                                       | accepted; the CPU oracle and the CPU codegen both give `8` for `x = 4` and `-4` for `x = -4`; `make(-4)` gives `{"x":-4,"w":{"value":0,"present":false}}`                                                       | nothing                                                                                    |
| the same, `if (p.w !== undefined) { return p.w; }`                                                       | TS8003 `Function "run" return type mismatch: declared f32, got f32 \| undefined.`                                                                                                                               | the same TS8003                                                                            |
| `let xs: array<f32 \| undefined, 4>;` and the same as a parameter                                        | TS8002 `… an array element may not. Carry a bool value beside the value, "f32".`                                                                                                                                | the same TS8002                                                                            |
| `(f32 \| undefined)[]`                                                                                   | TS8002 `T[] is a JS array type. Use array<T, N>.`                                                                                                                                                               | the same TS8002                                                                            |
| `function h(a: f32, x?: f32)`, with and without `if (x !== undefined)` in the body                       | TS8020 `Optional parameter "x" is not supported: a shader value is always present, so there is no "absent" for the body to test. Give it a default instead, "x: T = ...", which a call that omits it fills in.` | the same TS8020                                                                            |
| `x?: f32 = 1.`                                                                                           | the same TS8020                                                                                                                                                                                                 | TypeScript 1015 `Parameter cannot have question mark and initializer.` and the same TS8020 |
| `f: (x?: f32) => f32` as a parameter                                                                     | the same TS8020                                                                                                                                                                                                 | the same TS8020                                                                            |
| `apply((x?: f32) => 1.)`                                                                                 | TS8020 `A parameter of a function written as an argument is a plain name, with no default, rest or destructuring.`                                                                                              | the same TS8020                                                                            |
| `@location(1) w?: f32` on a fragment entry                                                               | the same optional-parameter TS8020                                                                                                                                                                              | the same TS8020                                                                            |
| `class Q { y?: f32; }`                                                                                   | TS8010 `Optional field "y?" on "Q" is not supported: a struct field is always present in the buffer the host fills.`                                                                                            | the same TS8010                                                                            |
| `declare const u: uniform<U>` and `storage<array<S>>`, `U` and `S` interfaces with `w: f32 \| undefined` | one warning, TS8015 `Backend emit failed: reflect: struct '__opt_f32' not found in module`; no error                                                                                                            | nothing                                                                                    |
| `class Out { @location(0) c: vec4; w: f32 \| undefined; }` as a fragment result, and as a vertex input   | TS8002 `… a struct field may not …` at the field                                                                                                                                                                | the same TS8002                                                                            |
| `let g: P = { x: 1., w: undefined };` at the top level, `P` the interface above                          | accepted                                                                                                                                                                                                        | nothing                                                                                    |
| `export function run(): R`, `R` an interface with `w: f32 \| undefined`                                  | accepted; the host view declares `run: never` with the reason `its result: field R.w: an optional value, f32 \| undefined, has no host value yet (Rule 8.21)`                                                   | nothing                                                                                    |
| `xs.find((x) => x > 1.)` on `array<f32, 4>`                                                              | TS8099 `".find" is not one of an array's methods here, which are map, forEach, some, every, reduce, fill, findIndex, findLastIndex, indexOf, lastIndexOf and includes. …`                                       | the same TS8099, with TypeScript 2339 and 7006                                             |

These observations establish four facts. First, the three positions are refused where the
implementation checks them, in both halves, with the sentences quoted. Second, the lowering this
proposal asks for already exists and already runs: an interface member `w: f32 | undefined`
lowers to the internal struct as a field, both writers emit it, and the oracle and the codegen
agree on it. Third, the host face already walks into a struct's fields and refuses a host value
for one that holds an optional. Fourth, the baseline's checks of the refused positions read the
top-level type only, so a struct that holds an optional reaches a binding and fails at emit with
a warning, reaches a module variable with no report, and is accepted as an interface member
while a class field is refused. The fourth fact is an observation about `#769` at `9e053ecc`,
which is work in progress; it is recorded here because this proposal's implementation replaces
those checks, and it is reported to `#769` separately. The probe scripts are in the session
scratchpad and are not part of the repository. `bun run gate:compile` (Tint and WebGL2) was
not run on the accepted forms.

**What the implementation of 0088 would change** (read at `9e053ecc`; each item is an
inference from the code, not a measured change):

- `src/compiler/ts/optional.ts`: `mayBeOptional` already admits a struct and a sized array as
  `T`. `usedOptionalDecls` and `collectOptionalNames` collect the optional structs the functions
  name and descend into arrays only; they would descend into struct fields too, and
  `src/compiler/ts/source-file.ts` would declare each optional struct before the first struct
  that holds it, since GLSL ES 3.00 needs a struct declared before its use (the GLSL writer
  ordered `_opt_f32_` before `P` in the measurement; the WGSL writer emitted module order, which
  WGSL allows). `refuseOptionalAt` would gain a companion that looks into a struct's fields and
  an array's element, as `atomicWithin` in `src/compiler/ts/bindings.ts` looks for an atomic.
- `src/compiler/ts/structs.ts`: the `refuseOptionalAt` call in the class path (the `a struct
field` sentence) is removed; `signatureFields` has none today. The three `questionToken`
  refusals (`TS8010`) change under decision D3.
- `src/compiler/ts/type-map.ts`: the `refuseOptionalAt` call for an array element in the sized
  array arm is removed. The `Map` value and `Record` value refusals stay.
- `src/compiler/ts/bindings.ts`, `module-vars.ts`, `module-const.ts` and the entry parameter and
  result checks in `src/compiler/ts/lower/function.ts`: each `refuseOptionalAt` call becomes the
  field-walking companion, so a struct that holds an optional is refused there, naming the field.
  The kernel-function parameter path in `function.ts` gains the same check.
- `src/compiler/ts/lower/function.ts`: the `questionToken` refusal (`TS8020`) becomes the
  optional-parameter lowering: the parameter's type is the optional of the written type, and the
  call-site fill of surface §14 (`src/compiler/ts/lower/function-args.ts` and the arity check)
  fills an omitted optional with `absentOf`. The entry and kernel paths keep a `TS8020`.
- `src/compiler/ts/lower/function-args.ts`: the `questionToken` arm of the plain-name refusal
  changes under decision D6.
- `src/compiler/ts/narrowing.ts`: under decision D2's recommended option, `Tracked` becomes a
  path (a root name and its member chain), the facts of a test apply to the path, and an
  assignment to a prefix or a by-reference call clears every path under it.
  `src/compiler/ts/lower/optional-values.ts` reads the record for a member read as it reads it
  for a name.
- `src/compiler/ts/host-face.ts`: no change is expected; `hostTypeOf` already returns `none` for
  an optional inside a struct.
- `src/language-service/`: the ambient library already types a field and a parameter as written;
  the TS18048 replacement of 0088 applies to a member read under D2.

### Alternatives

**(a) Allow the three positions in function scope, refuse them at a layout: proposed.** It is
the step 0088's D8 and Exclusions name ("where no binding layout is involved"). It adds no
representation: the field's type is the struct 0088 already emits, and the measurement shows
both writers and both CPU paths carry it. The refusal moves from the field to the position that
cannot hold it, which is where the reason lives (a layout, an interstage form, a host value).

**(b) Allow a struct field, but only in a struct no binding names anywhere in the program:
rejected.** It is (a) with a weaker sentence: the author learns at the binding either way, and
(a) names the field there.

**(c) Lower an optional field to two fields of the holding struct, `n` and `n_present`:
rejected.** It changes the holding struct's layout and field count, so `reflect()` and the host
face would need a second shape for it, and `h.n` would no longer be one value an author can pass
on. One representation everywhere is 0088's decision D1.

**(d) Lower `x?: T` to a default of `undefined`, with no change to the parameter's type:
rejected.** `x` must be `T | undefined` in the body, as TypeScript types it; a default keeps the
written type. The call-site fill is reused, the type is not.

**(e) Keep `x?: T` refused and keep "give it a default" as the remedy: rejected.** A default
value that means "none" is the sentinel pattern 0088 removed, moved to the signature.

**(f) Follow TypeScript's narrowing of a member path (D2, recommended) against narrowing by name
only (D2, alternative).** The alternative is cheaper: no change to `narrowing.ts`, and the
un-narrowed sentence tells the author to copy the field to a local first. It is not what the
editor accepts: TypeScript narrows `h.n` after `if (h.n !== undefined)`, so under the alternative
the compiler refuses a program the editor accepts, which Rule 12.7 allows only as a recorded
divergence. The recommended option keeps the two halves one vocabulary for the common form and
records the element access as the divergence.

### The cost of the flag in a struct or an array

Known: each optional field adds a `bool` to its struct, and each optional element a `bool` to
its element, in function scope only. No binding, buffer layout, vertex attribute or host value
changes, because none may hold one. A struct that holds an optional is larger by the flag's
size and alignment on each target.

Estimated, not measured: the register cost of a `bool` field is the same as 0088 estimated for
a local, and an array of `N` optionals carries `N` flags, which a driver may not pack. The
actual register count, occupancy and time on any hardware adapter are unknown. Required
validation step 7 measures one case.

## What it touches

- **Rule 7.10** moves a struct field, an interface member, a class field and an array element
  from the refused positions to the allowed ones, in function scope; adds the refusal of a
  struct or an array that holds an optional at a binding, a module variable, a module constant,
  an override, an entry point's parameter or result and a kernel function's parameter; adds the
  optional field `f?: T` (D3); adds the optional parameter `x?: T`, its call-site fill and its
  refusal on an entry point and a kernel function; and adds the narrowing of a member path with
  the element access as a recorded divergence (D2).
- **Rule 8.8** keeps its text. Its "Enforced by" names `TS8020` for a parameter shape the
  surface does not take; the optional parameter leaves that set, and the entry and kernel
  refusals and `x?: T = d` join it.
- **Rule 8.18** adds that a function-typed parameter's type may declare `x?: T`, what a call of
  the parameter passes when it omits `x`, and what D6 decides for an arrow function written in
  the call.
- **Rule 8.21** adds that a struct with an optional field and an array of optionals have no
  host value, as a parameter or as a result, and that an optional parameter has none.
- **Surface §7** changes the `TS8002` position row and the `TS8020` rows that name the optional
  parameter.
- **Surface §14** replaces "`b?: f32` stays refused, and now names the default to write instead"
  with the optional parameter and its fill.
- **Surface §28** changes the refused-position row for `T | undefined`.
- **Surface §64** adds the struct with an optional field and the optional parameter to the
  values with no host value.
- **Surface §76** changes its position table, adds the struct field, the array element, the
  member-path narrowing, the optional parameter and the new sentences, and changes "What it does
  not change".
- **Example `optional-fields`** (`examples/optional-fields.shade.ts`): a struct with an
  optional field built in a function and read through `??`, `?.` and a narrowed member path; an
  `array<f32 | undefined, N>` filled on some indices and folded in a loop; a helper with
  `limit?: f32` called with and without it. It goes through the compile gate on Tint and WebGL2
  and bakes its emit goldens. The id was free on `origin/main` at `fc234dbc` and on `#769` at
  `9e053ecc`, read on 2026-10-26 UTC.
- **Codes:** `TS8002`'s position sentence, `TS8020`'s optional-parameter sentence and
  `TS8010`'s optional-field sentence change as stated. No code is added, removed or renumbered.
- **Exports:** none. `reflect()`'s shape does not change.
- **Implementation files expected:** the list under "What the implementation of 0088 would
  change", plus `src/compiler/ts/optional-values.test.ts` (new rows for each allowed position,
  each refused layout position and each parameter form, both halves), a row set in
  `src/language-service/ambient-parity.test.ts`, `src/compiler/ts/honest-refusals.test.ts` and
  `src/compiler/ts/remedy-lines.test.ts` where a sentence changes, `AUTHORING.md`,
  `CHANGELOG.md` and the affected `reqs/` items.

### Draft impact estimate

Known technical impact: front-end typing and a declaration-order change for the internal
struct; the removal of three refusal sites and the addition of a field-walking refusal at six
positions; the optional-parameter lowering over the existing call-site fill; under D2, a path
form in the narrowing walk; documentation. No backend writer, IR node, export, dependency or
tool is planned.

Compatibility: every program that compiles at the baseline compiles to the same WGSL, GLSL and
CPU result, because every source this proposal accepts is refused at the baseline, with the
exception the fourth fact records (an interface member `w: T | undefined` that `#769` at
`9e053ecc` accepts). The text of three sentences changes, so a downstream fixture that quotes
them changes. Emit goldens of existing examples must not move.

Dependency: this proposal is implementable only after 0088's implementation is on `main`. Its
implementing pull request builds on `#769`'s merged revision, which this draft cannot name.

Unknown: implementation time, downstream effort, cost, and the GPU register and time cost of a
flag in a struct or an array. No estimate is given.

Required functional validation (future; none of it has run):

1. Compile a struct with an optional field of each element kind Rule 7.10 admits, as a local, a
   parameter, a result and a callback's value, and hold WGSL, GLSL ES 3.00, the CPU oracle and
   the CPU codegen to one value, present and absent.
2. Compile `array<T | undefined, N>` as a local, a parameter and a result, index it, loop over
   it and hand it to `map`, `forEach` and `reduce`, with the same four-way agreement.
3. Prove the declaration order: an optional of a struct that holds an optional field compiles on
   Tint and on WebGL2 (`bun run gate:compile` with the new example).
4. Pin each refused layout position (a binding, a module variable, a module constant, an
   override, an entry's parameter and result, a kernel function's parameter) to one sentence that
   names the field, with no cascaded diagnostic and no emit-time warning.
5. Compile `x?: T` on a helper, a method, a static function, a constructor, a local function and
   a function-typed parameter; call each with and without the argument and with `undefined`;
   hold the four paths to one value; pin the entry, the kernel and the `x?: T = d` refusals, and
   the arity sentence.
6. Assert both halves on each source (CLAUDE.md, "A test reads both halves"), with rows in
   `src/language-service/ambient-parity.test.ts` for each narrowing form of a member path the
   compiler follows and for the element access it does not.
7. Measure the emitted register count or time of a struct with an optional field against the
   hand-written flag on at least one hardware adapter, and record the adapter.
8. Run `bun run build`, the unit suite, `bun run gate:compile` and the packed user-journey gate,
   and keep existing goldens unchanged.

Required document validation (future): proposal shape, `docs:refs`, `docs:impact`, the IfChange
check, `reqs:sync` with Doorstop review of the changed rules, and the accepted-proposal scope
gate (`scripts/changes.ts`).

### Decisions

Each decision is open. The owner decides on the proposal's pull request. Each one carries the
draft's recommendation and the alternative it was weighed against.

- **D1. The positions.** Recommended: a struct field and an array element are allowed in
  function scope, and a struct or an array that holds an optional is refused at a binding, a
  module variable, a module constant, an override, an entry point's parameter or result, and a
  kernel function's parameter, with the sentence naming the field. Alternative: allow them in a
  local only, not through a parameter or a result; rejected as an arbitrary cut that 0088's
  allowed positions do not make.
- **D2. Narrowing of a member path.** Recommended: follow TypeScript for a member chain rooted
  at a local or a parameter, cleared by an assignment to the path, to a prefix or to the root and
  by a by-reference call on the root; an element access is a recorded divergence with the copy
  as the remedy. Alternative: narrow by name only, as 0088 does, and name the copy in the
  un-narrowed sentence for every member read. The alternative is cheaper and refuses a program
  the editor accepts.
- **D3. The optional field `f?: T`.** Recommended: the same type as `f: T | undefined`; an
  object literal may omit it, and the omitted field is absent; the `TS8010` optional-field
  sentence is retired. Alternative: keep `f?: T` refused (`TS8010`) with a sentence that names
  `f: T | undefined`; cheaper, and one spelling fewer of ordinary TypeScript.
- **D4. The absent and present values of a field and an element.** Recommended: `undefined`
  written for a field or an element is absent; a `T` written there is present; a class field
  with no initializer starts absent in `new C()`; a field with an initializer starts as the
  initializer says. This follows 0088's values rule and needs no alternative; it is listed so
  the owner confirms the `new C()` case.
- **D5. The optional parameter `x?: T`.** Recommended: TypeScript's meaning on a helper, a
  method, a static function, a constructor, a local function and a function-typed parameter's
  type; an omitted argument is the absent value filled at the call; refused on an entry point
  and a kernel function (`TS8020`); `x?: T = d` refused (`TS8020`); no host value (Rule 8.21).
  Alternative: keep `x?: T` refused; rejected, see Alternatives (e).
- **D6. An arrow function written as an argument with `x?: T`.** Recommended: allowed, with the
  same meaning, since the parameter's type already carries `T | undefined` there. Alternative:
  keep the plain-name refusal (`TS8020`) for it; cheaper, and it keeps `function-args.ts`
  unchanged.
- **D7. The host and `reflect()`.** Recommended: no host value for a struct with an optional
  field, an array of optionals or an optional parameter (the reason names the field or the
  parameter); `reflect()` unchanged. Alternative: none; a host mapping is 0088's D4.
- **D8. `xs.find(p)`.** Recommended: excluded, for the reason in Exclusions. Alternative:
  include it as `findIndex` followed by an element read wrapped as present or absent; it changes
  §63's list, which this proposal does not declare.
- **D9. `null`.** Recommended: unchanged, refused everywhere (0088 D7). No alternative.
- **D10. Numbering and names.** Recommended: no new rule and no new surface section; the
  example id `optional-fields`. The id was free as recorded above. Alternative: a new surface
  section for the three positions; rejected, since §76 is the optional value's section.
- **D11. The declaration order of the internal struct.** Recommended: each optional struct is
  declared before the first struct that holds it, on every target, and an optional of a struct
  after that struct. The alternative, module order with the GLSL writer's own sort, leaves the
  WGSL and the IR in an order the oracle and a reader cannot rely on.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's actual decision on the
proposal-only pull request, with its reviewed head, the approved revision and scope, the
resolution of D1 to D11, the finalized impact declarations, assigned responsibilities, agreed
milestones and the required validation. No approver, signature, schedule or result is recorded
here. An agent's recommendation above is not that decision.

### Configuration and validation record

This record does not yet apply. Delivery will require the accepted proposal revision, the
implementation commits and pull requests, the delivered configuration with tool versions, the
responsible actors, the observed results of the functional validation above and of the document
validation, and the disposition of each deviation. The required evidence listed above is not a
result.

Draft document checks ran on 2026-10-26 UTC, by the authoring agent, on this file in a
worktree based on `fc234dbc` (Bun 1.4.4, Vitest 3.2.7 on Node 22.22.0, Prettier 3.9.10). The
results were: `bunx vitest run src/changes.test.ts`, 17 tests passed; `bun run docs:refs`, 0
dead references in 1312 files; `bunx prettier --check changes/0093-optional-positions.md`,
passed after one `--write`; `bun scripts/doc-impact.ts`, "No prose names what this change
removed or touched." These checks validate the document, not an implementation. No functional
check of the proposed behavior has run. The measurements in Why ran against `#769` at
`9e053ecc`, not against this file's base.

## What it owes downstream

**typeshade.github.io.** The pages that 0088 owes (the TypeScript guide's optional values, its
refused positions, the construct cards, the error-code data in `src/lib/error-codes.ts` and the
Playground fixtures) will say that a struct field, an array element and `x?: T` are refused.
Under this proposal they say the opposite for function scope and name the layout positions
instead. The `TS8020` optional-parameter sentence and the `TS8010` optional-field sentence leave
the error-code data. The new example needs its page. 0088 is not yet implemented, so the site has
not yet done 0088's work; a pin that carries both proposals does both at once. That repository
was not inspected in this session. The site records 0093 in `compiler-changes.md` when its pin
moves.

**vscode-typeshade.** The authoring skill's language reference and its diagnostics reference
must move the three positions to the allowed ones and drop the two retired sentences. Hover on
an optional field and on an optional parameter must show `f32 | undefined`, and the editor must
show the compiler's `TS8003` sentence at an un-narrowed member read, as 0088 asks for a name.
That repository was not available in this session, so no file was inspected. The editor records
0093 in `compiler-changes.md` when its pin moves.

Radiance, TypeNN and TypeCV owe nothing: the change accepts sources they could not write and
changes no output of a source they compile. TypeCV's hand-written flag (`projection.ok === 0`
in `bundle.shade.ts`, recorded by 0088) is a candidate for an optional field, and its adoption
is optional and not tracked here. Downstream owners, content edits, pin pull requests and
validation results remain pending and unassigned.
