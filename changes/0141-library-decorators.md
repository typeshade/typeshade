---
id: '0141'
title: A `"use typeshade"` file can carry a decorator that a host module defines as an ordinary function, and the decorator runs on the host
status: draft
rules:
  - '1.7'
  - '1.8'
  - '2.1'
  - '3.9'
  - '6.7'
  - '8.16'
  - '8.20'
  - '8.25'
  - '12.4'
surface:
  - 2
  - 4
  - 7
  - 26
  - 49
  - 51
  - 64
  - 70
  - 79
exports: []
exports-removed: []
codes: []
examples: []
names: []
downstream:
  - repo: radiance
    what: Design record 0108 marks a table and a system by the file's place and its exports. After the pin moves past this change, an amendment of that record gives the decorated form, and the reference games move to it.
  - repo: typeshade.github.io
    what: The new surface section, the changed rows of sections 2, 4, 7, 26, 49, 51, 64 and 70, and the new texts of `TS8028`, `TS8035` and `TS8072` on their error-code pages. Record 0141 in compiler-changes.md.
  - repo: vscode-typeshade
    what: The tests of the editor's filter for TypeScript's diagnostics on a decorator gain a host module's decorator on a function and on a parameter, and the import that only a decorator uses. Record 0141 in compiler-changes.md.
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0141, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                   |
| Date and attribution          | Drafted 2026-11-11 (UTC) by an AI agent (Claude Code) in the session that designs the game engine of `typeshade/radiance`. This is the third revision, written the same day. Attribution is not approval.                                                   |
| Request source                | The owner (Seungup), in that session on 2026-11-11, in Korean. `docs/owner-decisions.md` OD-8 holds the words of the decision. "The readings" below holds the words that chose this revision's design.                                                      |
| Applicability / effectivity   | Expected: `docs/language-design.md` Rules 1.7, 1.8, 2.1, 3.9, 6.7, 8.16, 8.20, 8.25 and 12.4, nine surface sections, the front end's decorator reading, the linker's import rule, the host module and the language service. No release version is assigned. |
| Review baseline               | `typeshade/typeshade` `main` `93a1e6f`.                                                                                                                                                                                                                     |
| Review and revision authority | Pull request #1254. Git records revisions, and the pull request's review and merge record decisions.                                                                                                                                                        |

## What changes

Today the compiler reads a fixed list of decorators (Rule 6.7). A decorator outside the list
must be refused, and the compiler refuses it with `TS8028`. A `"use typeshade"` file imports
only another such file (`TS8072`).

After this change, a decorator is an ordinary function of a host module, defined as a
TypeScript author defines one. A `"use typeshade"` file imports it and writes it on a
declaration. The compiler emits the same GPU code as without it. The module that a host
imports applies the decorator when it loads, on the host, to the host value of the
declaration. The decorator records what it marks. It does not change it.

### One example, before and after

Before, at commit `6d6a979` and at `a658868`:

```ts
"use typeshade";

@entity({ slots: 16 })
export class Orc {
  hp: u32 = 4;
}
// TS8028: Unknown attribute "@entity". Supported attributes: @vertex, @fragment, ...
```

After, a library defines the decorators in an ordinary TypeScript file:

```ts
// radiance/decorators.ts, a host module
const tables: { cls: Function; slots: number }[] = [];

/** Marks a class as a table of a game. */
export function entity(options: { slots: number }) {
  return (cls: Function) => {
    tables.push({ cls, slots: options.slots });
  };
}
```

and a game writes them:

```ts
"use typeshade";
import { entity, save, system } from "radiance";

@entity({ slots: 16 })
export class Orc {
  @save hp: u32 = 4;
}

@system
export function heal(orcs: array<Orc>) {
  for (let i: u32 = 0; i < orcs.length; i++) {
    orcs[i].hp = orcs[i].hp + 1;
  }
}
```

The WGSL, the GLSL and the CPU tier's result of the game's file are the same as those of the
same file with the three decorators and the import removed. When a host imports the game's
file, `entity`, `save` and `system` each run once, and the library's own list then holds
`Orc`, its field `hp` and `heal`.

### The proposed rules

1. **A decorator is a host function.** A decorator is an exported function of a host module:
   a TypeScript file that is not a `"use typeshade"` file. Nothing in the language declares
   it. It has no type of the language.
2. **The import.** A `"use typeshade"` file imports a decorator with an ordinary import. An
   import of a host module is accepted when the file uses each name it binds only as a
   decorator. Any other use of such a name, and any other import of a host module, stays
   `TS8072`. The import adds nothing to the program (Rule 3.9): no module, no declaration and
   no binding.
3. **A use.** A decorator is written `@name` or `@name(arguments)` before a declaration. `name`
   is a name that an import of rule 2 binds. `@r.name`, through a namespace import, stays
   refused as "not a name".
4. **Where it is written.** On an exported class, a method or a field of a class that is not
   `static`, an exported function of a module or a namespace, and a parameter of such a
   function, after `@inout` or `@out` when the parameter has one. A library's decorator is
   written after the compiler's own attribute on the same declaration (`@compute([64])
@system`). Open question 2 covers the values of an entry.
5. **The arguments.** Each argument is a literal (a number, `true` or `false`, a string, an
   array or an object of these) or the name of an exported class, function, constant or enum
   of the file that has a host value (Rule 8.20). The host module evaluates it. A number is a
   host number: OD-7 does not apply, since no type of the language receives it.
6. **No meaning for the GPU.** A decorator and its arguments change nothing that the compiler
   emits or computes for an entry, a kernel function or the CPU oracle. A use of a decorator
   is no use for lowering.
7. **The host applies it.** The module a host imports (Rule 8.20) applies each decorator once,
   when the module loads, in ECMAScript's order. The decorator gets the host value of the
   declaration, in the shape of open question 1. A declaration with no host value gets
   `undefined` in its place.
8. **A decorator records, and does not replace.** A decorator returns nothing. A decorator
   that returns a value makes the module throw a `TypeError` when it loads. The error names
   the decorator and the declaration. A decorator must not change the class or the function it
   gets: the compiler does not see such a change, so the GPU and the CPU tier would differ
   (`docs/dx.md`).
9. **The refusals.** Each one names the decorator, the fact and a remedy (Rule 12.5), once
   (Rule 12.4):
   - `TS8028`, as today: a decorator that no import binds and that is not the compiler's.
   - `TS8028`: a decorator in a place of rule 4 that takes none, an argument that rule 5 does
     not take, and an import that binds one of the compiler's names (Rule 6.7's list).
   - `TS8072`, as today, with the new case named in its text: a name of a host module used as
     anything but a decorator.
   - `TS8035`: no longer given for an imported decorator on a method.
10. **Both halves.** The language service reports what `compile()` reports (Rule 12.7). It
    drops every diagnostic of TypeScript inside the span of an imported decorator where
    TypeScript's grammar takes none (a function declaration and its parameter: TS1206 at the
    baseline). It does not report the import as unused. It checks the arguments of such a
    decorator against the function's signature itself, since TypeScript checks nothing there.
    Its hover and its go-to-definition on a use show the host function.

### What does not change

- The compiler's own attributes (Rule 6.7's list) keep their names, their places and their
  meaning. An import cannot bind one of those names.
- A `"use typeshade"` file still calls no host function and reads no host value.
- The compiler learns no name of a library (`docs/dx.md`, principle 7).

## Why

Issue #1253 states the need. A tool that builds a program from a project of `"use typeshade"`
files must know which class is a table, which function is a step, and which field or
parameter has a special part. The game engine of `typeshade/radiance` is the first such tool.
Its workaround is a file's place and its exports. That marks a file. It cannot mark one field
or one parameter, and the mark is not beside the thing it marks.

### The readings

OD-8 says that the owner decides in this proposal what a decorator does. Three readings were
shown to the owner, each with the same use: `@entity({ slots: 16 }) export class Orc`.

| Reading | Who defines the decorator, and what it does                                                                                         | Cost against OD-3                                                                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1       | A `"use typeshade"` module declares it with a new form and a new type. The compiler checks it and lists each use in its reflection. | One construct, one type name, one declaration form. The first two revisions of this proposal took it.                              |
| 2       | The compiler runs the decorator at compile time, and the decorator changes the code.                                                | A model of execution at compile time, in three backends and the CPU oracle. An author learns what each decorator does to the code. |
| 3       | A host module defines it as an ordinary TypeScript function. The host module of the file runs it at load, and it only records.      | One construct. An author who knows TypeScript's decorators learns one rule: a decorator records and does not replace.              |

This revision is reading 3. The owner said on 2026-11-11: "typeshade 언어 자체에서 데코레이터를
만들고 지원하려면 어떻게 데코레이터를 정의하고 쓸 수 있는걸까요? 일반적인 ts코드 개발처럼 진행해도
되지 않을까 싶은데". The agent showed reading 3 with its costs, and the owner answered: "네, 그
방향으로 다시 써주세요". The owner's acceptance of this proposal is the decision that OD-8
leaves to it. Until then the choice among the three readings is open question 0.

Two independent reviews of reading 1 are in the review record. Three of their findings are
costs of reading 1 that reading 3 does not have: the declaration form that the language
refuses today, a report of declarations that no entry reaches, which the module's reflection
does not hold, and argument types that need new type forms.

### Alternatives

- **A registration in the tool's host code**, for example `table(Orc, { slots: 16 })` in a
  host file. It needs no language change. The mark is not beside the thing it marks, a second
  file must name each class and each function, and it cannot mark a parameter. OD-8 chose the
  decorator.
- **A comment that a tool reads.** Nothing checks a comment, so a wrong name gives no error
  (Rule 12.5).
- **A base class as the mark** (`class Orc extends Entity`), with a `static` field for an
  option. It works at commit `6d6a979` for a class. It cannot mark a function, a field or a
  parameter.

The need is not about performance, so issue #1253 holds probes of the compiler and no
measurement on a device.

### Open questions for the owner

Each question shows one example and the cost of each answer (OD-4).

0. **The reading.** The table above. This draft takes reading 3.
1. **The shape a decorator is called with.** TypeScript has two. A project that `tshc init`
   configures has `experimentalDecorators: true`, and the language service uses it too, since
   only that mode parses a decorator on a parameter (`@inout`).
   - Choice A (this draft): TypeScript's shapes of that mode, which NestJS uses. A class
     decorator gets `(cls)`. A field's gets `(prototype, name)`. A method's gets
     `(prototype, name, descriptor)`. A parameter's gets `(owner, name, index)`. A function's,
     which TypeScript does not have, gets `(fn, name)`. Cost: it is the older of TypeScript's
     two models. Gain: `tsc` already checks a class's, a member's and a method parameter's
     decorator in every TypeShade project with no new work.
   - Choice B: the standard shapes of ECMAScript, `(value, context)`. Cost: that model has no
     decorator on a parameter, and `tsc` reports each one under the mode that TypeShade's
     projects use, so the editor must drop more.
2. **A decorator on an entry's value.** Rule 1.8 and OD-5 say that what describes a value that
   flows into or out of an entry is part of its type. OD-8 says that a file can carry a
   library's decorator (`CLAUDE.md`, the conflict procedure).
   - Choice A (this draft): rule 4 is the whole rule, by the place of the declaration alone. A
     decorator can be on a field of any exported class and on a parameter of any exported
     function, so `@save hp` on `Orc` is accepted when `heal(orcs: array<Orc>)` takes `Orc`
     from the host. It is not on a parameter of an entry (`@vertex`, `@fragment`, `@compute`)
     or on a field of a class that an entry's signature names. Cost: the second refusal looks
     at a use of the class in the same file.
   - Choice B: no exclusion at all. A decorator of a library marks and describes no flow, so
     Rule 1.8 does not reach it. Cost: an entry's field can carry `@`, which change 0111 D5
     began to remove, and an author must tell the two kinds of `@` apart.
3. **`@system` and `@system()`.** With reading 3 both are TypeScript's own: `@system` when
   `system` is the decorator, `@system()` when `system` returns one. The library chooses, as
   in TypeScript. Cost: an author meets both spellings across libraries.
4. **A decorator defined in a `"use typeshade"` file.** This draft says no: such a file holds
   no host function. Cost: a library ships a host module beside its `"use typeshade"` modules.

The report of a kernel function's parameters (issue #1253, item 3) is compiler work with no
language change. It is not a question of this proposal.

## Owner's decisions

- **OD-8** is the decision this proposal carries out. OD-8 leaves to this proposal what a
  decorator does (open question 0).
- **OD-1.** The form is the language's own. A decorator on a function declaration and on its
  parameter is not TypeScript's grammar, and the language service drops what TypeScript says of
  it (rule 10).
- **OD-2.** A stage stays `@vertex`, `@fragment` or `@compute`. An import cannot bind those
  names.
- **OD-3.** The construct exists for what the author must state and the compiler cannot know:
  what a tool is to do with a declaration. It adds no type and no declaration form. The change
  removes nothing, which is a cost under this entry.
- **OD-5.** `@inout` and `@out` stay the parameter qualifiers, and an entry's I/O stays in the
  type. Open question 2 asks the owner about a library's mark on an entry's value.

The draft reverses no entry. Choice B of open question 2 would strain OD-5, so it is a
question for the owner and not the draft's text.

## Why the compiler cannot do it

The compiler cannot decide from a program which class a tool treats as a table, how many rows
the table has, or which field a save holds. These are facts about the tool's use of the
program. The author must state them. No optimization, lowering or report can supply them.

Compiler work meets part of the need of issue #1253: the report of a kernel function's
parameters and of the arrays it writes. That part needs no author-facing construct, and this
proposal does not cover it.

## What it touches

- **Rule 1.7.** The kept forms whose grammar report the language service drops gain a host
  module's decorator on a function declaration and on its parameter.
- **Rule 1.8.** An attribute `@name` on a declaration can also be a library's mark. The rule's
  sentence on an entry's values does not change (open question 2).
- **Rule 2.1.** A decorator that a host module defines is the library's name. It is not an
  author-facing name of the language.
- **Rule 3.9.** An import of a host module that binds only decorators is accepted, and it adds
  nothing to the program.
- **Rule 6.7.** "A decorator outside the list must be refused" becomes "a decorator that is not
  in the list and that no import binds must be refused". The rule gains the places, the
  arguments and the order after the compiler's own attribute.
- **Rule 8.16.** An imported decorator on a method, a function-valued field included, is no
  longer `TS8035`.
- **Rule 8.20.** The module a host imports applies the decorators of the file when it loads.
  The rule gains the order, the value each kind of declaration gives, and the `TypeError` of a
  decorator that returns a value.
- **Rule 8.25.** A library's decorator on a parameter is written after `@inout` or `@out`.
- **Rule 12.4.** One mistake in a decorator gives one diagnostic, in both halves.
- **Surface §2, §4, §7, §26, §49, §51, §64 and §70.** Their sentences on a field's decorator,
  on "every decorator on a declaration", on an unknown attribute, on a method's decorator, on
  the editor's filters, on a field's attributes, on the host module and on a parameter's
  qualifiers each gain the imported decorator.
- **Surface §79** (new). The definition, the import, the use, what the host module does and
  each refusal.

No diagnostic code is added, removed or renumbered, and the language gains no name. The texts
of `TS8028`, `TS8035` and `TS8072` change, in the surface sections above.

Not known yet: whether a public export changes its shape. The host module's manifest (`Pack`)
may carry the decorators of a file. The implementation plan names each such export before
acceptance, and `exports` then lists it.

Validation the implementation owes: each rule in both halves on the same source
(`CLAUDE.md`, A test reads both halves), the emit of a decorated file equal to the emit of the
file without decorators and without the import on WGSL, GLSL and the CPU oracle, each
decorator called once at load with the value its kind gives, the `TypeError` of a decorator
that returns a value, and the import journey with a decorated file on WebGPU.

### Draft impact estimate

- Known, read at the baseline: the name sets are in `src/compiler/ts/decorated-form.ts`. The
  refusal of an unknown name is in `src/compiler/ts/builtin-check.ts`, by spelling. `TS8072` is
  the linker's (`src/compiler/ts/link.ts`). `TS8035` on a method comes from the class
  collector. The host module is made by `src/compiler/ts/host-face.ts`. The editor's filters
  are in `src/language-service/diagnostics.ts`, and the language service runs TypeScript with
  `experimentalDecorators: true` (`src/language-service/host.ts`).
- Observed by the second reviewer at `a658868` (TypeScript 5.6.3, the language service's
  options): TypeScript reports TS1206 on a decorator on a function declaration and on its
  parameter, checks nothing inside it, and reads the import as unused.
- Estimate, not measured: the work is in the front end (the import rule, the places, the
  arguments), in the host module (the calls at load) and in the language service (the filter
  by place, the unused import, the check of the arguments, hover). No pass and no backend
  changes, since the IR holds no decorator.
- Unknown: the duration, the public exports that change, and the effort in `vscode-typeshade`
  and `typeshade.github.io`.
- Not established: that the Vite plugin and each bundler path of a host import keep the
  decorator calls and the import of the host module in the emitted module. A probe before
  acceptance shows it.
- To resolve before acceptance: open questions 0 to 4, and the two items above.

### Independent review record

Two reviews ran on 2026-11-11 (UTC). The reviewer of each was an AI agent (Claude, model
`opus`) that did not write the proposal, run as a sub-agent of the session. Both reviewed
reading 1. A third review, by an agent of the same kind, ran on the same day on this revision,
reading 3. Its record is below.

**Review 1**, of the first draft (`fd359a8`). Verdict: not ready. It found two blockers and
eight major findings. The second revision (`a658868`) answered each, and review 2 checked the
answers.

**Review 2**, of the second revision (`a658868`). Verdict: not ready. It confirmed 9 of the 17
answers of review 1 in full, and found the following.

| No. | Severity | Finding                                                                                                                                     | Answer in this revision                                                                                                                                   |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Major    | The editor facts were wrong: TypeScript reports TS1206 on a function's decorator, checks nothing inside it, and reads the import as unused. | Carried: rule 10 defines the filter by place, keeps the import, and makes the language service check the arguments. The estimate records the observation. |
| 2   | Major    | The exclusion of an entry's values depended on use and was unclear for a kernel function's parameter and a class a host supplies.           | Carried: open question 2 defines the exclusion by the declaration and says what the example gets.                                                         |
| 3   | Major    | The choice of the reading was not among the open questions, and reading 2 had no example.                                                   | Fixed: open question 0, with one use for all three readings and the owner's words.                                                                        |
| 4   | Major    | `surface` and `rules` left out §2, §4 and §64 and Rules 8.20 and 8.25.                                                                      | Fixed: listed. §14 is no longer touched, since no `declare function` is used.                                                                             |
| 5   | Major    | The report did not fit how `Reflection` is built: it holds only what an entry reaches.                                                      | Removed with reading 1: the compiler reports nothing. The host module runs the decorators.                                                                |
| 6   | Minor    | The refusals were incomplete, and `TS8028` covered argument type errors.                                                                    | Reduced: reading 3 has four refusals (rule 9). TypeScript reports an argument's type in the editor.                                                       |
| 7   | Minor    | The parameter types of a declaration were underspecified.                                                                                   | Removed with reading 1: a decorator is a host function with TypeScript's types.                                                                           |
| 8   | Minor    | `Attribute` had no family in §9.3.                                                                                                          | Removed with reading 1: no name is added.                                                                                                                 |
| 9   | Minor    | Refusing `@r.entity` departs from Rule 3.9's namespace read.                                                                                | Kept: rule 3 says so, and Rule 3.9 is listed. A namespace of a host module is no module of the program.                                                   |
| 10  | Minor    | The taken names: a later compiler attribute can collide with a library's name.                                                              | Kept, with the cost: rule 9 refuses an import that binds a compiler's name, so a library renames its import (`import { vertex as v }`).                   |
| 11  | Minor    | "Change 0111 D5 removed" the decorated form, which is still accepted with a warning.                                                        | Fixed: open question 2 says "began to remove".                                                                                                            |
| 12  | Minor    | A wrong rule number for "two spellings".                                                                                                    | Removed: open question 3 no longer cites it.                                                                                                              |
| 13  | Minor    | Two open questions had no example, and one needed no decision.                                                                              | Fixed: the report of issue #1253 is no longer a question.                                                                                                 |
| 14  | Minor    | The document control did not give the pull request.                                                                                         | Fixed: #1254.                                                                                                                                             |
| 15  | Note     | An `interface` struct's field cannot carry a decorator, and a static method was treated unlike a static field.                              | Kept, with the cost: a decorator is on a class's member only (rule 4), and no `static` member takes one.                                                  |
| 16  | Note     | A smaller alternative: no `Target` on the declared type.                                                                                    | Removed with reading 1.                                                                                                                                   |
| 17  | Note     | The owner's "승인" was in no record.                                                                                                        | Fixed: "The readings" holds the owner's words that chose this revision.                                                                                   |

**Review 3**, of this revision (`afd15e0`). Verdict: not ready. It found two blockers and ten
major findings. No finding is answered yet: the two blockers and findings 7 and 10 change what
this reading costs, so the owner sees them before a fourth revision is written. The reviewer
ran its probes with the compiler at `afd15e0` and TypeScript 5.6.3.

| No. | Severity | Finding                                                                                                                                                                                                                                                                                                                                                                    | State                                                                                                                                     |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Blocker  | Rule 10 makes the editor check a decorator's arguments, and `compile()` checks only that each is a literal. A program that `compile()` accepts then draws an error in the editor (Rule 12.7), and rule 10's own check of a function's decorator is a second checker (Rule 1.7). Observed: `@entity({ slots: "x" })` gives TS2322 in TypeScript and nothing in `compile()`. | Open. It is a conflict of Rules 1.7 and 12.7 with this reading. The owner is asked (`CLAUDE.md`, the conflict procedure).                 |
| 2   | Blocker  | "Applied at load, in ECMAScript's order" has no meaning in the host module. `hostFace` writes that module from the IR (`src/compiler/ts/host-face.ts`), so no import and no decorator of the source is in it, and its order is not the source's.                                                                                                                           | Open. The next revision must give the emitted text for each kind of declaration: what each call receives, where it is, and in what order. |
| 3   | Major    | A re-export makes a second host value of the same class (Rule 8.20), and the proposal does not say which module applies its decorators.                                                                                                                                                                                                                                    | Open.                                                                                                                                     |
| 4   | Major    | Rule 2 does not say whether `compile()` reads the host module. If it does not, a misspelled name passes `compile()`, against OD-8's last sentence. A mixed import, `import type`, a re-export, a default import and an alias have no stated outcome. The condition `typeshade` of Rule 3.9 can resolve the package to a shader module.                                     | Open.                                                                                                                                     |
| 5   | Major    | The language service reads a host module inside the shader program, with `lib: []`. A normal host module does not type-check there (observed: `new Map()` gives TS2585), and a package that resolves to `.js` is left unresolved on purpose.                                                                                                                               | Open. The editor needs a way to give a host module its types, and the estimate does not count it.                                         |
| 6   | Major    | Open question 1 has wrong facts. Both modes parse a decorator on a parameter. `tsc` does not check shader files in a project of `tshc init`, the language service does. Choice A does not define a function parameter's decorator, its `(fn, name)` shape is this proposal's own, and NestJS relies on `emitDecoratorMetadata`.                                            | Open. The facts are wrong as written.                                                                                                     |
| 7   | Major    | A declaration with no host value (a vertex entry, a generic, a function that takes a function, a function that reaches a binding) gives its decorator `undefined` and no name, so the mark is lost with no diagnostic.                                                                                                                                                     | Open. It is a choice an author sees, so it becomes an open question: pass a name in every shape, or refuse.                               |
| 8   | Major    | Open question 2, choice A, contradicts itself: "by the place alone" and an exclusion by use. Its refusal is not in rule 9. Rule 1.8 also names a binding, and `heal(orcs: array<Orc>)` makes one.                                                                                                                                                                          | Open.                                                                                                                                     |
| 9   | Major    | `surface` leaves out §68 (the import rule and the table of TS8072) and probably §3. `rules` leaves out 12.7.                                                                                                                                                                                                                                                               | Open.                                                                                                                                     |
| 10  | Major    | A cost is not stated. The host module marks its CPU tier as pure, so a bundle that needs only the manifest drops it. Calls at the top level and the import of the library defeat that for every bundle that imports the file.                                                                                                                                              | Open. It is a cost of this reading (OD-4), shown to the owner.                                                                            |
| 11  | Major    | Nothing enforces "records and does not replace" before load, and a decorator that changes the generated class makes the CPU tier differ from the GPU. A factory written without its call throws at load with no remedy in the text.                                                                                                                                        | Open.                                                                                                                                     |
| 12  | Major    | The table of readings understates reading 3. An author learns the import exception, the places, the limit on arguments, the order, the load-time refusal, `undefined` and the function shape.                                                                                                                                                                              | Open. The table must list them, so that the owner compares the readings fairly.                                                           |
| 13  | Minor    | Rule 12.5 is cited for the remedy. The rule about a remedy is Rule 12.1.                                                                                                                                                                                                                                                                                                   | Open.                                                                                                                                     |
| 14  | Minor    | Rule 4 does not list a constructor, a constructor's parameter, an accessor, an abstract method or a function of a namespace.                                                                                                                                                                                                                                               | Open.                                                                                                                                     |
| 15  | Minor    | Rule 5 leaves `-1`, a name of another shader module, a name of a host module and a template string open.                                                                                                                                                                                                                                                                   | Open.                                                                                                                                     |
| 16  | Minor    | "A file still calls no host function" is false under rule 7.                                                                                                                                                                                                                                                                                                               | Open.                                                                                                                                     |
| 17  | Minor    | The baselines differ: `93a1e6f`, `6d6a979` and `a658868`.                                                                                                                                                                                                                                                                                                                  | Open. The reviewer's probes at `afd15e0` give the same results.                                                                           |
| 18  | Minor    | Today an import of a host module and three uses give four diagnostics. The implementation of rule 9 must keep one for each mistake (Rule 12.4).                                                                                                                                                                                                                            | Open, as a constraint on the implementation.                                                                                              |
| 19  | Minor    | Open questions 3 and 4 are consequences, not choices. Four choices were made without a question: findings 1, 4, 7 and 10.                                                                                                                                                                                                                                                  | Open.                                                                                                                                     |
| 20  | Minor    | The example does not define `save` and `system`. The validation list lacks a re-export, `compile()` with no `readDocument`, `tshc check`, a manifest-only bundle, the program runtime, `fuse` and the editor's types of a host module.                                                                                                                                     | Open.                                                                                                                                     |

The review confirmed these facts of the proposal. `TS8028`, `TS8035` and `TS8072` are today's
refusals as the text says. TypeScript reports TS1206 on a function's decorator. The setting
`experimentalDecorators` is on in the language service and in `tshc init`. The cited rules and
surface sections exist, apart from findings 9 and 13. No entry of `docs/owner-decisions.md` is
reversed. It did not check hover, bundlers other than Vite, `fuse` or the downstream
repositories.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decision on the open
questions, the independent review of this revision, and the merge of this proposal as
`accepted`.

### Configuration and validation record

This record does not yet apply. Delivery will require the evidence that "What it touches"
names.

## What it owes downstream

- **radiance.** Design record 0108 marks a table by a file's place and its exports, and a
  written array by a parameter's name. After the pin moves past this change, an amendment of
  that record gives the decorated form, and the two reference games move to it. Expected work,
  not agreed: the engine defines its decorators in a host module, and its reader of a project
  loads each file's host module and reads the engine's own list.
- **typeshade.github.io.** The new surface section, the changed rows of the eight sections
  above, and the new texts of `TS8028`, `TS8035` and `TS8072` on their error-code pages.
  Expected work, not agreed.
- **vscode-typeshade.** The tests of the editor's filter gain a host module's decorator on a
  function and on a parameter, and the import that only a decorator uses. Expected work, not
  agreed.
- **typenn, typecv, typeaudio.** The second reviewer searched their `"use typeshade"` files at
  `a658868`. None declares or uses a library's decorator, so none owes work.
