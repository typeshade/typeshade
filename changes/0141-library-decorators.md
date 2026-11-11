---
id: '0141'
title: A `"use typeshade"` file can carry a decorator that a library declares, and the compiler reports it to a tool
status: draft
rules:
  - '1.7'
  - '1.8'
  - '2.1'
  - '3.6'
  - '3.9'
  - '6.7'
  - '8.16'
  - '9.6'
  - '12.4'
surface:
  - 7
  - 14
  - 26
  - 49
  - 51
  - 70
  - 79
exports:
  - ModuleDecl
  - Reflection
exports-removed: []
codes: []
examples: []
names:
  - Attribute
downstream:
  - repo: radiance
    what: Design record 0108 marks a table and a system by the file's place and its exports. After the pin moves past this change, an amendment of that record gives the decorated form, and the reference games move to it.
  - repo: typeshade.github.io
    what: The new surface section, the changed rows of sections 7, 14, 26, 49, 51 and 70, and the new texts of `TS8028`, `TS8020` and `TS8035` on their error-code pages. Record 0141 in compiler-changes.md.
  - repo: vscode-typeshade
    what: The tests of the editor's filter for TypeScript's diagnostics on a decorator (TS1206, TS1238, TS1329) gain a library's decorator. Record 0141 in compiler-changes.md.
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0141, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                |
| Date and attribution          | Drafted 2026-11-11 (UTC) by an AI agent (Claude Code) in the session that designs the game engine of `typeshade/radiance`. Attribution is not approval.                                                                  |
| Request source                | The owner (Seungup), in that session on 2026-11-11, in Korean. `docs/owner-decisions.md` OD-8 holds the words. Issue #1253 states the downstream need.                                                                   |
| Applicability / effectivity   | Expected: `docs/language-design.md` Rules 2.1 and 6.7 and the table of §9.3, a new surface section, the front end's decorator reading, the language service and the module's reflection. No release version is assigned. |
| Review baseline               | `typeshade/typeshade` `main` `93a1e6f`.                                                                                                                                                                                  |
| Review and revision authority | The pull request that adds this file. Git records revisions, and the pull request's review and merge record decisions.                                                                                                   |

## What changes

Today the compiler reads a fixed list of decorators (Rule 6.7). A decorator outside the list
must be refused, and the compiler refuses it with `TS8028`.

After this change, a `"use typeshade"` module can declare a decorator, and another module can
write it. The compiler checks the decorator and reports it. The compiler gives it no meaning.
A tool that reads the report gives it one.

### One example, before and after

Before, at commit `6d6a979` and at `fd359a8`:

```ts
"use typeshade";

@entity(16)
export class Orc {
  hp: u32 = 4;
}
// TS8028: Unknown attribute "@entity". Supported attributes: @vertex, @fragment, ...
```

After, a library declares the decorators in a `"use typeshade"` module:

```ts
"use typeshade";

/** Marks a class as a table of a game, with its number of rows. */
export declare function entity(slots: u32): Attribute<"class">;
/** Marks a function as a step of a tick. */
export declare function system(): Attribute<"function">;
/** Marks a field that a save holds. */
export declare function save(): Attribute<"field">;
```

and a game writes them:

```ts
"use typeshade";
import { entity, save, system } from "radiance";

@entity(16)
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
same file with the three decorators removed and the import kept.

### The proposed rules

1. **A declaration.** A decorator is declared by an exported `declare function` of a
   `"use typeshade"` module whose result type is `Attribute<Target>`. This is the one
   `declare function` the language accepts. Any other one stays `TS8020`.
   - `Target` is one of `"class"`, `"function"`, `"method"`, `"field"` and `"parameter"`, or a
     union of them.
   - Each parameter's type is `bool`, `i32`, `u32`, `f32`, or an array of one of these. This
     draft takes no string, no object and no reference to a class or a function (open
     question 5).
   - The declaration has no body, no overload and no type parameter.
   - A call of the name as an expression, and the name as a value, are refused.
2. **A use.** A decorator is written `@name` when its declaration has no parameter, and
   `@name(arguments)` when it has one or more. It is written on a declaration of a kind its
   `Target` names.
3. **Which declaration a name means.** The compiler resolves the name by the declaration it
   refers to, through an import, an alias or a re-export. It does not resolve it by its
   spelling. A decorator can be used in the module that declares it. `@r.entity`, through a
   namespace import, stays refused as "not a name".
4. **The compiler's names are taken.** A library cannot declare, and an import cannot alias,
   a name of Rule 6.7's list or a WGSL attribute name that the compiler answers for (`size`,
   `align`, `group`, `binding`, `id`, `must_use`, `diagnostic`, `subgroup_size`, `std140`).
5. **The arguments.** Each argument is a constant the compiler can fold: a literal, a module
   `const`, an enum member, or an expression of these. An `override` is not a constant here. A
   literal takes its type from the parameter (OD-7). The compiler checks each argument's type.
6. **Where it is written.** A decorator is written on:
   - a class of a module or a namespace, and not a class expression or a local class,
   - a function of a module or a namespace, and not a local function or an overload signature,
   - a method of a class, and not a constructor, an accessor or an abstract member (a
     function-valued field is a method, Rule 8.16),
   - a field of a class that is not `static`,
   - a parameter of a function of a module or a namespace, after `@inout` or `@out` when the
     parameter has one.

   It is not written on an entry's parameter, a field of an entry I/O struct or a binding
   (open question 1).

7. **No meaning.** A decorator changes nothing that the compiler emits or computes. A use of a
   decorator is not a use of anything for lowering: it reaches no declaration, and an argument
   does not make a constant used. A decorator's declaration adds nothing to the program. The
   module that declares it is imported as any module is (Rule 3.9).
8. **The report.** `Reflection` gains a list of the uses, in source order, for each source
   module of the program. It lists a use on a declaration that no entry reaches. Each use has:
   the decorator's name as declared, the module that declares it (its package, version and
   path, so a re-export does not change it), the target's kind, the target's name as the
   author wrote it with its namespace and its class, a parameter's index, each argument's
   value with its type, and the file, line and column.
9. **The refusals.** Each one names the decorator, the fact and a remedy (Rule 12.5), once
   (Rule 12.4):
   - `TS8028`: a decorator that nothing declares, as today. A decorator on a declaration that
     its `Target` does not name. A decorator in a place of item 6 that takes none. An argument
     of a wrong type or that is no constant. A declaration or an alias with one of the
     compiler's names.
   - `TS8020`: a `declare function` whose result is not `Attribute<…>`, as today, with the new
     form named in its text.
   - `TS8035`: no longer given for a declared decorator on a method.
10. **Both halves.** The language service reports what `compile()` reports (Rule 12.7). On a
    declared decorator it drops what TypeScript says of the form: TS1206 (a decorator is not
    valid here), TS1238 and TS1329 (the decorator's signature), TS1239 and TS1249. Its hover on
    a use shows the declaration and its comment. The ambient library declares `Attribute`.

### What does not change

- The compiler's own attributes (Rule 6.7's list) keep their names, their places and their
  meaning.
- A decorator cannot change a class, a function or a value. It cannot run code.
- The compiler learns no name of a library (`docs/dx.md`, principle 7).
- An entry's I/O stays in the type (OD-5, Rule 1.8).

## Why

Issue #1253 states the need. A tool that builds a program from a project of `"use typeshade"`
files must know which class is a table, which function is a step, and which field or
parameter has a special part. The game engine of `typeshade/radiance` is the first such tool.

Its workaround is a file's place and its exports. That marks a file. It cannot mark one field
or one parameter, and the mark is not beside the thing it marks.

### The two readings shown to the owner

| Reading | What the compiler does                                                  | Cost against OD-3                                                                                                                      |
| ------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | Checks the decorator and reports it. The emitted code is unchanged.     | One construct, one type name and one declaration form. An author learns that a decorator is a mark that a tool reads.                  |
| 2       | Runs the decorator at compile time, and the decorator changes the code. | A model of execution at compile time, in three backends and the CPU oracle. An author must learn what each decorator does to the code. |

This draft is reading 1. On 2026-11-11 the owner approved reading 1 as the draft's
recommendation ("승인"). OD-8 says that the owner decides what a declared decorator does in
this proposal. So the choice between the two readings stays open until the owner accepts the
proposal.

### Alternatives

- **A registration in the tool's host code**, for example `table(Orc, { slots: 16 })` in a
  host file. It needs no language change. The mark is not beside the thing it marks, a second
  file must name each class and each function, and it cannot mark a parameter. OD-8 chose the
  decorator.
- **A comment that a tool reads.** The compiler does not check a comment, so a wrong name or
  a wrong argument gives no error (Rule 12.5).
- **A base class as the mark** (`class Orc extends Entity`), with a `static` field for an
  option. It works at commit `6d6a979` for a class. It cannot mark a function, a field or a
  parameter.
- **An exported constant beside the class** (`export const slots = 16`). It marks a file, and
  two classes in one file cannot differ.

The need is not about performance, so issue #1253 holds probes of the compiler and no
measurement on a device.

### Open questions for the owner

Each question shows one example and the cost of each answer (OD-4).

1. **A library's mark on an entry's value.** Rule 1.8 and OD-5 say that what describes a value
   that flows into or out of an entry is part of its type. OD-8 says that a file can carry a
   library's decorator. The two point different ways for a field of an entry I/O struct, an
   entry's parameter and a binding (`CLAUDE.md`, the conflict procedure).
   - Choice A (this draft): no library decorator there. `@save pos: builtin<"position">` is
     refused. Cost: a tool cannot mark such a value.
   - Choice B: allowed there. Cost: an entry's field can again carry a decorator, which change
     0111 D5 removed, and an author must learn which decorators are the language's.
2. **The name of the type.** Rule 3.6 says that a type name TypeShade declares is capitalized,
   so this draft writes `Attribute<Target>`. The lowercase `attribute` is a reserved word of
   WGSL and of GLSL ES. Cost of the capital: it differs from `builtin<…>` and `location<…>`,
   which are WGSL's names.
3. **`@system` or `@system()`.** This draft takes `@system` only, as `@vertex` is (Rule 8.1).
   Cost: TypeScript reads `@system` as "the function is the decorator" and reports TS1329, with
   a quick fix that writes `@system()`. The language service drops TS1329, but an editor with
   no TypeShade extension shows it. Taking `@system()` too gives two spellings (Rule 1.1).
4. **A host file as the declarer.** This draft says no: a `"use typeshade"` module imports only
   another such module (`TS8072`). Cost: a library ships one `"use typeshade"` module for its
   decorators.
5. **The types of an argument.** This draft takes `bool`, `i32`, `u32`, `f32` and arrays of
   them: `@entity(16)`. Named options, `@entity({ slots: 16 })`, need an object type in a
   parameter, which the language refuses today (`TS8002`). A string and a reference to a class
   or a function (`@after(move)`) are not taken either. Cost of the draft: positional
   arguments only. Cost of more: each one is a new type form in a declaration.
6. **The report of a kernel function's parameters.** Issue #1253 asks for it as compiler work
   with no language change. It can ship before or after this proposal.

## Owner's decisions

- **OD-8** is the decision this proposal carries out: a `"use typeshade"` file can carry a
  decorator that a library declares. OD-8 leaves to this proposal what a declared decorator
  does.
- **OD-1.** The form is the language's own. Whether `tsc` accepts `@save hp: u32` is no
  criterion, and the language service drops what TypeScript says of it (rule 10 above).
- **OD-2.** A stage stays `@vertex`, `@fragment` or `@compute`. A library cannot declare or
  alias those names.
- **OD-3.** The construct exists for what the author must state and the compiler cannot know:
  what a tool is to do with a declaration. The change removes nothing, which is a cost under
  this entry. Reading 2 is not taken for its larger cost.
- **OD-5.** `@inout` and `@out` stay the parameter qualifiers, and an entry's I/O stays in the
  type. This draft writes no library decorator on an entry's value. Open question 1 asks the
  owner.
- **OD-7.** A literal argument takes its type from the decorator's parameter.

The draft reverses no entry. Choice B of open question 1 would strain OD-5, so it is a question
for the owner and not the draft's text.

## Why the compiler cannot do it

The compiler cannot decide from a program which class a tool treats as a table, how many rows
the table has, or which field a save holds. These are facts about the tool's use of the
program. The author must state them.

Compiler work meets part of the need of issue #1253: the report of a kernel function's
parameters and of the arrays it writes. That part needs no author-facing construct, and this
proposal does not cover it. The marks of items 1, 2 and 4 of the issue are statements of the
author, so no optimization, lowering or report can supply them.

## What it touches

- **Rule 1.7.** The list of kept forms whose grammar report the language service drops gains a
  declared decorator.
- **Rule 1.8.** An attribute `@name` on a declaration can also be a library's mark. The rule's
  sentence on an entry's values does not change (open question 1).
- **Rule 2.1.** A decorator that a library declares is the library's name, as a function that
  a library exports is.
- **Rule 3.6.** `Attribute` is a type name TypeShade declares, so it is capitalized.
- **Rule 3.9.** A decorator's declaration adds nothing to the program, and a use of a decorator
  is no use for lowering.
- **Rule 6.7.** "A decorator outside the list must be refused" becomes "a decorator that is not
  in the list and that nothing declares must be refused". The rule gains the declaration, the
  targets, the arguments and the taken names.
- **Rule 8.16.** A declared decorator on a method, a function-valued field included, is no
  longer `TS8035`.
- **Rule 9.6.** The table of §9.3 gains the row `Attribute`, by Rules 9.7 and 13.6, with its
  row in `TYPESHADE_EXTENSIONS` (`surface-names.test.ts`).
- **Rule 12.4.** One mistake in a decorator gives one diagnostic, in both halves.
- **Surface §7, §14, §26, §49, §51 and §70.** Their rows on an unknown attribute, on
  `declare function`, on a method's decorator, on the editor's filters, on a field's
  attributes and on a parameter's qualifiers each gain the declared decorator.
- **Surface §79** (new). The declaration, the use, the report and each refusal.
- **`ModuleDecl` and `Reflection`.** Both gain the list of uses. Each pass that rebuilds a
  module keeps the list.
- **`Attribute`.** A new type name in the table of §9.3.

No diagnostic code is added, removed or renumbered. The texts of `TS8028`, `TS8020` and `TS8035`
change, in the surface sections above.

Validation the implementation owes: each rule in both halves on the same source
(`CLAUDE.md`, A test reads both halves), the emit of a decorated file equal to the emit of the
file without decorators on WGSL, GLSL and the CPU oracle, an import that binds only decorators
adding nothing to the program, and the report's content.

### Draft impact estimate

- Known: the name sets are in `src/compiler/ts/decorated-form.ts`. The refusal of an unknown
  name is in `src/compiler/ts/builtin-check.ts` (`checkAttributeName`, `attributeRefusal`,
  `unreadDecoratorSite`), by spelling. `TS8020` on an ambient function is in
  `src/compiler/ts/lower/function.ts`. `TS8035` on a method comes from the class collector. The
  editor's filters are in `src/language-service/diagnostics.ts`, and the ambient library is
  `src/language-service/ambient.ts`.
- Estimate, not measured: the work is in the front end (the declaration form, resolution by
  declaration, the targets, the arguments), in the module's IR and reflection (a new list that
  every pass keeps), in the language service and in the documents. No backend emits anything
  new.
- Unknown: the duration, and the effort in `vscode-typeshade` and `typeshade.github.io`.
- Not searched: `typenn`, `typecv` and `typeaudio`. No decorator of a library compiled before
  this change, so none can hold one. The review of the next revision confirms it.
- To resolve before acceptance: the six open questions.

### Independent review record

| Field    | Record                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------- |
| Reviewer | An AI agent (Claude, model `opus`) that did not write the proposal, run as a sub-agent of the session |
| Date     | 2026-11-11 (UTC)                                                                                      |
| Revision | `fd359a8`, the first draft                                                                            |
| Verdict  | Not ready for the owner's decision until findings 1 to 10 are answered                                |

The reviewer ran two probes that changed no file: the draft's example through `compile()` and
the language service, and through TypeScript alone.

| No. | Severity | Finding                                                                                                                                            | Answer                                                                                                                              |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Blocker  | The language refuses the draft's own declaration: `declare function` is `TS8020`, and the inline object type of its parameter is `TS8002`.         | Fixed: rule 1 makes the declaration its own form with scalar and array parameters. Named options are open question 5.               |
| 2   | Blocker  | The editor half is not specified. TypeScript reports TS1238, TS1329 and TS1206 on the example.                                                     | Fixed: rule 10 lists each TypeScript code the editor drops. Rules 1.7 and 12.4 are listed. Open question 3 shows the cost.          |
| 3   | Major    | A decorator on an entry's field or parameter strains Rule 1.8 and OD-5.                                                                            | Fixed: rule 6 excludes those places. Open question 1 puts both choices to the owner, as the conflict procedure asks.                |
| 4   | Major    | `surface` leaves out §7, §14, §26, §49, §51 and §70.                                                                                               | Fixed: listed.                                                                                                                      |
| 5   | Major    | `rules` leaves out Rules 1.7, 1.8, 3.6, 3.9, 8.16 and the row of §9.3. A lowercase `attribute` is against Rule 3.6 and is a reserved word of WGSL. | Fixed: listed, and the type is `Attribute`. Open question 2 shows the cost.                                                         |
| 6   | Major    | `exports: []` is wrong: the report changes `Reflection` and `ModuleDecl`. "No pass changes" is too strong.                                         | Fixed: both listed, and the estimate says that each pass keeps the list.                                                            |
| 7   | Major    | The compiler finds a decorator by its spelling today. Aliases, re-exports, use in the declaring module and the taken names are open.               | Fixed: rules 3 and 4.                                                                                                               |
| 8   | Major    | The claim of equal emit skips the import, which adds a module to the program.                                                                      | Fixed: the example keeps the import, and rule 7 says what a declaration and a use add.                                              |
| 9   | Major    | The draft says the owner approved reading 1. OD-8 says the owner decides in the proposal.                                                          | Fixed: the text says the approval is of the recommendation, and the choice stays open until acceptance.                             |
| 10  | Major    | The arguments, the targets and the report are underspecified.                                                                                      | Fixed: rules 5, 6 and 8. A reference to a class or a function as an argument is open question 5.                                    |
| 11  | Minor    | The estimate names the wrong file for the refusal.                                                                                                 | Fixed: the pointers are corrected.                                                                                                  |
| 12  | Minor    | `codes: [TS8028]` misuses the field, and the texts of `TS8020` and `TS8035` change too.                                                            | Fixed: `codes` is empty, and "What it touches" names the three texts.                                                               |
| 13  | Minor    | `downstream` leaves out `typeshade.github.io` and `vscode-typeshade`.                                                                              | Fixed: both listed. `typenn`, `typecv` and `typeaudio` were not searched, and the estimate says why none can hold such a decorator. |
| 14  | Minor    | The open questions give no costs and no examples.                                                                                                  | Fixed.                                                                                                                              |
| 15  | Note     | A registration in the tool's host code is an alternative that needs no language change. Issue #1253 holds no measurement on a device.              | Fixed: the alternative is listed with its cost, and the text says the need is not about performance.                                |
| 16  | Note     | "A base class gives no options" is not established: a `static` field can hold one.                                                                 | Fixed: the sentence is corrected.                                                                                                   |
| 17  | Note     | The document control gives no pull request number.                                                                                                 | Fixed: #1254.                                                                                                                       |

This revision answers each finding. It has not been reviewed. A second review of this revision
comes before the owner decides.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decision on the open
questions, the independent review, and the merge of this proposal as `accepted`.

### Configuration and validation record

This record does not yet apply. Delivery will require the evidence that "What it touches"
names.

## What it owes downstream

- **radiance.** Design record 0108 marks a table by a file's place and its exports, and a
  written array by a parameter's name. After the pin moves past this change, an amendment of
  that record gives the decorated form, and the two reference games move to it. Expected work,
  not agreed: the engine's reader of a project takes the report in place of its own reading of
  the source.
- **typeshade.github.io.** The new surface section, the changed rows of the six sections above,
  and the new texts of `TS8028`, `TS8020` and `TS8035` on their error-code pages. Expected work,
  not agreed.
- **vscode-typeshade.** The tests of the editor's filter for TypeScript's diagnostics on a
  decorator gain a library's decorator. Expected work, not agreed.
