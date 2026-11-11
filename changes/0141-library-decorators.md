---
id: '0141'
title: A `"use typeshade"` file can carry a decorator that a library declares, and the compiler reports it to a tool
status: draft
rules:
  - '2.1'
  - '6.7'
surface:
  - 79
exports: []
exports-removed: []
codes:
  - TS8028
examples: []
names:
  - attribute
downstream:
  - repo: radiance
    what: Design record 0108 marks a table and a system by the file's place and its exports. After the pin moves past this change, an amendment of that record gives the decorated form, and the reference games move to it.
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

Before, at commit `6d6a979`:

```ts
"use typeshade";

@entity({ slots: 16 })
export class Orc {
  hp: u32 = 4;
}
// TS8028: Unknown attribute "@entity". Supported attributes: @vertex, @fragment, ...
```

After, a library declares the decorator in a `"use typeshade"` module:

```ts
"use typeshade";

/** Marks a class as a table of a game. */
export declare function entity(options: { slots: u32 }): attribute<"class">;
/** Marks a function as a step of a tick. */
export declare function system(): attribute<"function">;
/** Marks a field that a save holds. */
export declare function save(): attribute<"field">;
```

and a game writes it:

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

The WGSL, the GLSL and the CPU tier's result of this file are the same as those of the file
with the three decorators removed.

### The proposed rules, in short

1. **A declaration.** A decorator is declared by an exported `declare function` of a
   `"use typeshade"` module whose result type is `attribute<Target>`. `Target` is one of
   `"class"`, `"function"`, `"method"`, `"field"` and `"parameter"`, or a union of them.
2. **A use.** A decorator is written `@name` when its declaration has no parameter, and
   `@name(arguments)` when it has one or more. It is written on a declaration of the kind its
   `Target` names.
3. **The arguments.** Each argument is a constant: a number, a `bool`, a string, an array or
   an object of constants, or a constant of a module. The compiler checks each argument
   against the parameter's type.
4. **No meaning.** A declared decorator changes nothing that the compiler emits or computes.
5. **The report.** The module's reflection lists each use: the decorator's name, the module
   that declares it, what it is on, its arguments as values, and its place in the source.
6. **The refusals.** A decorator that no module declares is refused as today. A decorator on
   a declaration that its `Target` does not name, and an argument of a wrong type, are refused
   with `TS8028`. Each text names the decorator, the fact and a remedy.
7. **Both halves.** The language service reports the same diagnostics as `compile()`
   (Rule 12.7). Its hover on a use shows the declaration and its comment.

### What does not change

- The compiler's own attributes (Rule 6.7's list) keep their names, their places and their
  meaning. A library cannot declare a decorator with one of those names.
- A decorator cannot change a class, a function or a value. It cannot run code.
- The compiler learns no name of a library (`docs/dx.md`, principle 7).

## Why

Issue #1253 states the need. A tool that builds a program from a project of `"use typeshade"`
files must know which class is a table, which function is a step, and which field or
parameter has a special part. The game engine of `typeshade/radiance` is the first such tool.

Its workaround is a file's place and its exports. That marks a file. It cannot mark one field
or one parameter, and the mark is not beside the thing it marks.

### The two readings shown to the owner

| Reading | What the compiler does                                                  | Cost against OD-3                                                                                                                      |
| ------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | Checks the decorator and reports it. The emitted code is unchanged.     | One construct. An author learns that a decorator is a mark that a tool reads.                                                          |
| 2       | Runs the decorator at compile time, and the decorator changes the code. | A model of execution at compile time, in three backends and the CPU oracle. An author must learn what each decorator does to the code. |

This proposal is reading 1, with decorators on a field and on a parameter and with checked
arguments. A tool that needs to write code reads the report and writes a file. The owner
approved reading 1 as the proposal's recommendation on 2026-11-11 ("승인"). Reading 2 stays an
alternative that this proposal does not take.

### Alternatives

- **A comment that a tool reads.** The compiler does not check a comment, so a wrong name or
  a wrong argument gives no error (Rule 12.5).
- **A base class as the mark** (`class Orc extends Entity`). It works at commit `6d6a979` for a
  class. It gives no options, and it cannot mark a function, a field or a parameter.
- **An exported constant beside the class** (`export const slots = 16`). It marks a file, and
  two classes in one file cannot differ.

### Open questions for the owner

1. The name of the type. `attribute<Target>` is this draft's name. It is new in the table of
   §9.3.
2. Whether a decorator with no parameter is written `@system` only, or also `@system()`.
   This draft takes `@system` only, as `@vertex` is (Rule 8.1).
3. Whether a host file (`.ts`) can also declare a decorator. This draft says no: a
   `"use typeshade"` module imports only another such module (`TS8072`).
4. Whether the report also lists each kernel function's parameter names and the arrays it
   reads and writes. Issue #1253 asks for it as compiler work with no language change. It can
   ship before or after this proposal.

## Owner's decisions

- **OD-8** is the decision this proposal carries out: a `"use typeshade"` file can carry a
  decorator that a library declares.
- **OD-1.** The form is the language's own. Whether `tsc` accepts `@save hp: u32` is no
  criterion, and the language service hides what TypeScript says of it.
- **OD-2.** A stage stays `@vertex`, `@fragment` or `@compute`. A library cannot declare those
  names.
- **OD-3.** The construct exists for what the author must state and the compiler cannot know:
  what a tool is to do with a declaration. Reading 2 is not taken for its cost against this
  entry.
- **OD-5.** `@inout` and `@out` stay the parameter qualifiers. A library's decorator on a
  parameter is written the same way, before the parameter.

The proposal reverses no entry.

## Why the compiler cannot do it

The compiler cannot decide from a program which class a tool treats as a table, how many rows
the table has, or which field a save holds. These are facts about the tool's use of the
program. The author must state them.

Compiler work meets part of the need of issue #1253: the report of a kernel function's
parameters and of the arrays it writes. That part needs no author-facing construct, and this
proposal does not cover it. The marks of items 1, 2 and 4 of the issue are statements of the
author, so no optimization, lowering or report can supply them.

## What it touches

- **Rule 2.1.** A decorator that a library declares is the library's name, as a function that
  a library exports is. It is not an author-facing name of the language.
- **Rule 6.7.** "A decorator outside the list must be refused" becomes "a decorator that is not
  in the list and that no module declares must be refused". The rule gains the declaration,
  the targets and the arguments.
- **Surface §79** (new). A decorator that a library declares: the declaration, the use, the
  report and each refusal.
- **`TS8028`.** Three new texts: a decorator on a declaration its target does not name, an
  argument of a wrong type, and a declaration that takes one of the compiler's names.
- **`attribute`.** A new type name in the table of §9.3 (the extensions), since it comes from
  neither WGSL nor ECMAScript.

Validation the implementation owes: each rule in both halves on the same source
(`CLAUDE.md`, A test reads both halves), the emit of a decorated file equal to the emit of the
file without decorators on WGSL, GLSL and the CPU oracle, and the report's content.

### Draft impact estimate

- Known: the front end reads decorators in `src/compiler/ts/decorated-form.ts` and refuses
  unknown ones (`TS8028 ATTRIBUTE_NAME`). The language service filters TypeScript's
  diagnostics inside a decorator (Rule 6.7, Enforced by).
- Estimate, not measured: the work is in the front end, the language service, the reflection
  and the documents. No pass and no backend changes, since a declared decorator has no
  meaning.
- Unknown: the duration, the shape of the report's type, and the effort in
  `vscode-typeshade` and `typeshade.github.io` to show the new section.
- To resolve before acceptance: the four open questions above.

### Independent review record

This record does not yet apply. No review has run.

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
- **typeshade.github.io** and **vscode-typeshade.** No page describes the old behaviour of a
  library's decorator, since the compiler refused every one. The new surface section and the
  new texts of `TS8028` follow the usual path of a visible change. They are not listed in
  `downstream` until the review confirms what each one shows.
