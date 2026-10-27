---
id: '0100'
title: TypeShade is a language of its own that borrows how an author writes from TypeScript and what it can express from WGSL; a borrowed form keeps its source's meaning unless a rule records another, and the compiler chooses each representation
status: draft
rules:
  - '1.1'
  - '1.3'
  - '1.4'
  - '1.5'
  - '1.6'
  - '2.1'
  - '3.6'
  - '4.1'
  - '4.5'
  - '13.6'
  - '13.10'
surface: []
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The rule pages render the amended and the new rules from reqs/ at the pin. The Korean translations of Rules 2.1 and 4.1 in content/guide/ko/rules.json are written again (src/lib/rule-translations.ts holds them to the English); Rules 1.1, 1.3, 1.4, 1.5, 1.6, 3.6, 4.5, 13.6 and 13.10 have no Korean translation today. The two sentences in src/i18n/en.ts and ko.ts that say each TypeScript statement means what the WGSL beside it means are read against the new Rule 1.1. compiler-changes.md records 0100 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's statement of what a "use typeshade" file means is read against the new Rule 1.1 and fixed where it says WGSL decides the meaning. compiler-changes.md records 0100 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names rules and sections it will add -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0100, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Date and attribution          | Authored 2026-10-27, UTC, by a Claude Code agent. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-10-27, in Korean. The session began with a request for TypedArray support. The owner then set the direction this proposal records: the concept an author writes is ECMAScript's and the compiler implements it with a heap, a stack or buffers as it needs ("개발의 자유도를 뺏는게 싫은거예요"); the outdated rules are to be improved by that principle; WGSL is the reference for the surface and TypeScript for how developers write; the surface borrows only some WGSL expressions, such as `declare`; expressiveness is kept, and behaviour follows TypeScript's. The owner then added that it need not be the same: TypeShade is a language of its own, and the relation is borrowing ("사실 같을 필요도 없어요 차용해오는거에 가깝지 typeshade는 자체 언어니까요"). The owner agreed that a form TypeScript authors commonly write is supported at the compiler level, that the lowercase `array` is to be read again for that reason, preferred `Array<T, N>` as the sized array ("그냥 Array<T, N> 이 제일 깔끔해보이는데?"), and stated that the tree is alpha and need not be bound by compatibility ("지금 구조는 아직 알파단계여서 그렇게까지 얽매이지 않아도 돼"), and that the specification is being made, may break as far as it needs to and may be more radical ("언어 스펙을 만들어가는 단계여서 얼마든지 깨져도 되고, 더 파격적으로 만들어도 돼요"). The first revision of this file, a TypedArray spelling proposal, is superseded by this revision; its content moves to the planned array proposal. No GitHub issue is recorded. |
| Applicability / effectivity   | `docs/language-design.md` (Rules 1.1, 1.3, 2.1, 3.6, 4.1, 4.5, 13.6 and 13.10, new Rules 1.4, 1.5 and 1.6 in a new section 1.8, Appendix B), `reqs/` (the items of those rules), and the site's rule pages. No compiler code, IR, backend, CPU tier, export, diagnostic code, surface section or example changes in this proposal. No release version is assigned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Review baseline               | `main` at `37e6c6f0f597eb335ae0d16e7365ca122ed70a05` (2026-10-27).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Review and revision authority | Pull request [#801](https://github.com/typeshade/typeshade/pull/801) (branch `claude/typedarray-support-proposal-tr3cu0`). Git records the revisions of this file; the merge of #801 with `status: accepted` records the decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## What changes

### 1. The principle

> TypeShade is a language of its own. It borrows how an author writes from TypeScript and what
> the surface can express from WGSL. A borrowed form keeps the meaning of its source unless a rule
> of this language gives it another, and that rule records the difference and its reason. Where
> ECMAScript has a form that carries the GPU meaning, the surface borrows ECMAScript's spelling,
> and borrows a WGSL expression only where no ECMAScript spelling carries the meaning. The
> borrowing loses nothing WGSL can express. The compiler chooses each representation, and owns
> memory where it needs it.

Four parts of the principle are separate requirements:

- **The surface borrows from WGSL only what TypeScript has no word for.** The borrowed
  expressions are the sized scalars (`f32`, `i32`, `u32`, `f64`), the vectors, the matrices, the
  textures and samplers, the address spaces spelled with `declare const x: storage<T>` and its
  siblings, the attributes as decorators, and the built-in functions and values. A TypeScript
  `number` names none of the sized scalars, so they stay WGSL's. A TypeScript `boolean` carries
  what `bool` carries, so it needs no borrowed word.
- **Expressiveness is kept.** Every WGSL capability the surface reaches today stays reachable
  (Rule 11.14's coverage table). A TypeScript spelling replaces a WGSL one only where it carries
  the same meaning.
- **The language is TypeShade's.** TypeShade borrows; it does not promise to be TypeScript or
  WGSL. A borrowed form may be borrowed in part, or given another meaning, when a rule says so
  with its reason. Rule 7.2's table of divergences is that record today. A difference that no rule
  records is a defect.
- **The default is the source's meaning.** With no recorded difference, a form borrowed from
  ECMAScript (an array, a `Map`, a `Set`, an object, a loop, a method) does what TypeScript does
  with it, and a form borrowed from WGSL does what WGSL does. An author who knows the source is
  not surprised where the rules are silent.
- **The representation is the compiler's.** The compiler may represent a form on the stack, in a
  binding, or in memory it owns, and may change the representation between versions, as change
  0080 (its section 1) stated for `Map` and `Set`.

The arithmetic of a borrowed WGSL type stays WGSL's: an `f32` sum rounds as WGSL rounds it, and
an `i32` overflow wraps as WGSL wraps it.

### 2. The rules this proposal amends

The text below is proposed. The implementing pull request writes it into
`docs/language-design.md` and `reqs/`.

**Rule 1.1 (amended).** A `"use typeshade"` program must mean what this document defines. A form
borrowed from ECMAScript means what ECMAScript gives it, and a form borrowed from WGSL means what
WGSL gives it, unless a rule of this document gives it another meaning and records the difference
and its reason. The WGSL the compiler emits must be a program WGSL accepts, and must compute that
meaning.

- Rationale: TypeShade is a language of its own that borrows how an author writes from TypeScript
  and what the surface can express from WGSL. The source's meaning is the default because an
  author reads a borrowed form by what it means there; a difference is allowed where it serves the
  GPU, and it is written down where the author can find it.
- Was: "must mean what the WGSL program it emits means", with the rationale that TypeShade is a
  front end and the target language decides the meaning.
- Enforced by: kept. The compile gate (`scripts/compile-gate.ts`) hands every registered example to
  Tint. The last sentence of the rule keeps what the current tree cites Rule 1.1 for: the coverage
  rows of `src/core/coverage/webgpu-objects.ts` and `webgpu-enums.ts` ("the compile gate holds the
  emit to Tint"), `src/compiler/ts/void-return.test.ts` and `src/compiler/ts/lower/function.ts`.

**Rule 1.3 (amended).** The CPU oracle is the reference evaluation of the meaning this document
defines (Rule 1.1): ECMAScript's result for a form borrowed from ECMAScript, with the arithmetic of
the WGSL types the program uses, WGSL's result for a form borrowed from WGSL, the recorded result
where a rule gives another, and, where WGSL leaves room (§11), one of the permitted answers.

- Was: the oracle follows WGSL alone. The CPU tier of change 0080 already uses JavaScript's own
  `Map` and `Set` as the oracle.

**Rule 1.4 (new), in a new section 1.8, "What TypeShade borrows".** Where ECMAScript has a form
that carries the GPU meaning, the surface must borrow TypeScript's spelling; a WGSL spelling is
borrowed only where no ECMAScript spelling carries the meaning, and the borrowing must keep every
WGSL capability reachable (Rule 11.14). A form may be borrowed in part: the members, the
positions or the meaning it takes are those the rules give it.

- Rationale: the WGSL vocabulary is there to say what TypeScript cannot say, such as a value's
  width or an address space. It is not a second spelling an author has to learn for what
  TypeScript already says.

**Rule 1.5 (new).** The representation of a form ECMAScript defines is the compiler's: a value on
the stack, a binding, or memory the compiler owns. Memory the compiler owns must be sized before
the dispatch or draw that uses it, must appear in `reflect()` and in the manifest as every binding
does (Rules 6.8 and 11.10), and must be invisible to the program except through the device's
limits. A program whose form the compiler cannot represent on a target is refused there in one
sentence naming the reason, or, for a call the CPU tier can run, runs there and says why
(Rule 11.7).

- Rationale: a GPU allocates nothing during a dispatch, so an ECMAScript array that grows or a
  `Map` needs memory the compiler sizes and owns. The `_console` buffer (Rule 6.11), the records
  of a loop that pushes (change 0078) and the table of a `Map` or `Set` (change 0080) are such
  memory today, each made by its own feature.

**Rule 1.6 (new).** A form TypeScript authors commonly write, a form of the language or a member
of its standard library, must be supported by the compiler. A TypeShade name or a library function
is not a substitute for it; a library holds what TypeScript has no standard form for. A refusal is
the last resort, and names the reason the compiler cannot represent the form on that target
(Rule 1.5).

- Rationale: a TypeShade author is a TypeScript developer. A form they reach for first and find
  refused costs them a detour, and the detour is code: TypeCV's audit of 2026-10-27
  (`typecv/docs/audits/2026-10-27-typescript-surface-gaps.md`) counts 188 lines of hand-made hash
  tables, 122 of sorting and 77 of bounded lists that a `Map`, `sort` and `push` would hold.
- The §9.3 table (Rule 9.6) is already shrink-only; a row whose TypeScript form the compiler comes
  to support is deleted by Rule 13.7.

**Rule 2.1 (amended), source (b).** ECMAScript, as TypeScript's standard library declares it: a
literal, an operator, a statement, the declaration forms, and a type, a function, an object or a
member of the standard library, with the members the compiler represents. The list of the current
tree (`Math`, `console`, the methods of `Array.prototype`, `Map`, `Set`, the shapes surface §14
and §28 admit) stays in the rule as the record of what is declared today.

**Rule 3.6 (amended).** A type name an author writes is spelled as its source spells it:
lowercase where WGSL declares it, as ECMAScript spells it where ECMAScript declares it (`Map`,
`Set`, `boolean`), and capitalized where TypeShade declares it.

- Was: lowercase for WGSL and capitalized for TypeShade, so that the case shows the source. `Map`
  and `Set` (change 0080) already break that reading.
- The rule's second rationale stays until item B of section 3 is decided: `Array<T>` is the
  checker's array of the ambient library (`lib: []`) and `array<T, N>` the author's, with a size.
  Surface §63 cites it for how `array<T, N>` picks its members from `Array<T>`.

**Rule 4.1 (amended).** Every type an author writes must be a type borrowed from WGSL under a
TypeScript spelling, a member of the f64 family (Rule 4.4), a key type, or a type ECMAScript
defines that the compiler represents (Rule 1.5).

**Rule 4.5 (amended).** A TypeScript type the compiler cannot represent on a target must be
refused in one sentence naming the reason and what to write instead; the list is surface §28.

- Was: "a TypeScript type the GPU has no word for". The test moves from WGSL's vocabulary to the
  compiler's ability to represent the type.

**Rule 13.6 (amended).** A new author-facing name must be added only by its source: a WGSL name by
citing the specification section that declares it, and an ECMAScript name by citing the section
of ECMA-262, or the declaration of TypeScript's standard library, that defines it.

- Was: an ECMAScript name by citing "the `Math` or `console` member it is".

**Rule 13.10 (amended).** From `1.0.0`, a change that keeps a program compiling and makes it
compute something else must ship in two steps, as the rule says today. Before `1.0.0` the language
is being specified, and any change may break any program in the next release: no window, no
deprecation step and no kept spelling is owed. A `### Changed` entry names what broke, and every
example golden is re-baked and reviewed.

- Rationale: the owner stated on 2026-10-27 that the specification is being made and may break as
  far as it needs to, and may be more radical. A window protects programs that depend on a
  published meaning; before `1.0.0` no meaning is settled enough to protect.
- Was: two steps before and after `1.0.0` alike, the second no earlier than the next breaking
  release.

### 3. The rules to read again under the principle

Under the amended Rule 1.1 a rule may give a borrowed form another meaning, or refuse part of it,
when it records the reason. The rules below do so, and their recorded reason is the old principle:
WGSL decides the meaning, or a type must be a WGSL type. That reason no longer holds. Each item is
decided in a proposal of its own, so that each record carries one change. The burden is on the
difference: the default outcome of each item is the source's meaning, implemented by the compiler,
and a proposal keeps a difference only where the compiler cannot represent the form on a target
(Rule 1.5) or where the difference serves the GPU and its reason is written down. A refusal TypeCV's
audit of 2026-10-27 calls a form the GPU "cannot hold" is not taken as settled: with memory the
compiler owns (item A), several of them are representations still to be built (items I to L). Appendix B gains one row for Rule 1.1 that lists the items, and each item leaves the row
when its proposal is implemented.

| Item                                          | Rules                | What the old principle refuses or changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. The compiler's memory                      | 1.5, 6.11, 11.8      | Each feature makes its own buffer. Planned: one memory model, its sizing, the representation of a reference, the limits of each target, and what happens when the memory runs out.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| B. Arrays                                     | 2.1, 4.1, 8.22, 8.23 | `Array<T>`, `T[]` and the typed arrays are refused (`TS8002`), and an array is spelled `array<T, N>`. Planned direction: `T[]` and `Array<T>` are the array with no size written, whose size the compiler takes from the value (an initializer, `new Float32Array(16)`, a class field's initializer) or, for a parameter, from each call; `Array<T, N>` is the sized array, a recorded TypeShade extension of TypeScript's `Array`, which the editor projects to `T[] & { readonly length: N }` since TypeScript's checker takes one type parameter on the global `Array` (TS2317, measured 2026-10-27); the typed arrays of revision 1; construction and growth on the memory model of item A; `array<T, N>` replaced by `Array<T, N>` (Rule 13.10 as amended). |
| C. `boolean`                                  | 4.6                  | `boolean` is refused (`TS8002 TypeShade spells the boolean "bool".`). Planned: `boolean` is the type; by Rule 1.4 `bool` has no reason to be borrowed, and decision D3 settles whether it stays as another name or is replaced.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D. References to objects and arrays           | 6.10, 7.2, 8.8       | A struct is a value: a write through a copy is not seen through the original, and `TS8005` refuses the case where the two would differ. The proposal may keep value semantics as TypeShade's own, with a reason, or take references; taking references makes a compiling program compute something else, which before `1.0.0` ships in one breaking minor (Rule 13.10 as amended).                                                                                                                                                                                                                                                                                                                                                                               |
| E. Types surface §28 refuses                  | 7.8                  | A union of two types, a rest tuple, `instanceof`, `in` and `string` are refused. Each is read again under Rule 4.5 as amended.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| F. Loops                                      | 7.5                  | A `for` that is not counted, and a `for (;;)` or `while (true)` with a `break`, are refused, although WGSL's `loop` carries them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| G. Array methods                              | 7.2, surface §63     | `filter`, `find`, `slice`, `concat` and `sort` are refused (change 0005).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| H. `Map` and `Set` outside a kernel parameter | 2.1, 8.22            | A `Map` or `Set` is refused anywhere but a kernel function's parameter (change 0080).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| I. Functions as values                        | 8.18                 | A function stored in a variable, a field or an array, or returned, is refused (`TS8099`, `TS8004`). Planned: a function value is an id the compiler dispatches on with a `switch` over the functions of its type; a closure carries its captures in memory the compiler owns.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| J. Recursion                                  | 8.4                  | A call cycle is refused (`TS8031`). Planned: the compiler lowers recursion to a loop over an explicit stack in memory it owns, sized from a bound or refused where none exists on the GPU and run on the CPU tier for a host call.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| K. Strings                                    | 4.5, 7.8             | A string at run time is refused (`TS8013`); only a `console` label passes. Planned: a string is a sequence of UTF-16 code units in memory the compiler owns, with the members of `String.prototype` the compiler represents.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| L. Exceptions                                 | 7.8, surface §28     | `throw` and `try` are refused (`TS8013`). Planned: a `throw` sets an error state that each call checks and propagates to the nearest `try`; a `throw` that leaves an entry or a kernel function reaches the host as a rejected promise or a reported event.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Rule 4.6's refusal of `number` stays. `number` names no width, and the sized scalars are what the
surface borrows from WGSL to say it.

The planned order is A, then B and C, then the rest. C does not depend on A and may come first.
I to L depend on A.
Each proposal takes the next free number when it is drafted (Rule 3.7).

## Why

**The request.** The owner asked for TypedArray support. Answering it showed that the refusal was
not a gap in one feature. It came from Rule 1.1 and Rule 4.1, which make WGSL the source of
meaning and of types, and from Rule 3.6, which ties a type's spelling to WGSL. Every refusal in
section 3 follows from them.

**The tree already works this way in places.** Change 0005 gave an array the methods of
`Array.prototype` with ECMAScript's meaning, change 0078 gave it `push`, change 0080 took `Map`
and `Set` with the principle "the concept is ECMAScript's, the implementation is the tier's", and
`TS8005` refuses the programs where WGSL's value semantics would part from TypeScript's. Each made
an exception to Rule 1.1. This proposal states what they had in common: the form is borrowed from TypeScript, and the meaning is the source's unless a rule records another.

**The rule keeps what WGSL is needed for.** The sized scalars, vectors, matrices, textures,
address spaces and builtins stay, since TypeScript has no word that carries them. `number` stays
refused for the same reason.

### Alternatives

- **Keep Rule 1.1 and add exceptions one proposal at a time.** That is what changes 0005, 0078
  and 0080 did. Each exception had to argue against the rule. Not taken.
- **Amend every rule of section 3 in this proposal.** One record would carry eight changes, some
  of which change what a compiling program computes. Not taken: CLAUDE.md requires one change for
  each record, and Rule 13.10 requires two steps for item D.
- **TypeScript for everything, `number` included.** `number` is an IEEE double. The GPU has no
  such type, and an `f32` would compute something else. Not taken.

### Assumptions and open points

- Rule 1.5 allows memory the compiler owns. Its design is item A's proposal; this proposal fixes
  only the requirements a design must meet.
- Item D changes the result of programs that compile today. Its proposal decides the two steps of
  Rule 13.10 and the warning of the first step.

### Decisions at acceptance

1. **D1. The text of the principle and of the amended rules** in section 2.
2. **D2. The split.** Rules only in this proposal, with section 3 as planned proposals
   (recommended), or the principle together with item B.
3. **D3. `bool` after item C.** Replaced by `boolean` in the release of item C, with `bool`'s
   diagnostic naming `boolean` (recommended under Rule 1.4 and Rule 13.10 as amended), or both
   spellings accepted, with `boolean` in documents and examples.
4. **D4. Rule 13.10 before `1.0.0`.** No window and no deprecation step (recommended, as the owner
   stated on 2026-10-27), or one breaking minor with a kept spelling.
5. **D5. Items I to L.** In the inventory with a planned direction (recommended), or left out until
   item A is accepted.

## What it touches

- **Rule 1.1.** Section 2. A borrowed form keeps its source's meaning unless a rule records another.
- **Rule 1.3.** Section 2. The oracle evaluates the meaning this document defines.
- **Rule 1.4 (new).** Section 2. TypeScript's spelling is borrowed first, WGSL's only where TypeScript has none, and a form may be borrowed in part.
- **Rule 1.5 (new).** Section 2. The representation is the compiler's, and it may own memory.
- **Rule 2.1.** Source (b) is the standard library as TypeScript declares it.
- **Rule 3.6.** A type name follows its source's spelling.
- **Rule 4.1.** A type ECMAScript defines may be written.
- **Rule 4.5.** A refusal rests on what the compiler cannot represent.
- **Rule 13.6.** An ECMAScript name cites ECMA-262 or TypeScript's library.
- **Rule 1.6 (new).** A form TypeScript authors commonly write is the compiler's to support.
- **Rule 13.10.** Before `1.0.0`, any change may break any program in the next release.
- **Appendix B.** One row for Rule 1.1, listing items A to L.

No surface section, export, diagnostic code or example changes. The rules' new text describes the
current tree where section 3 does not list an exception, and Appendix B lists every exception.

### Draft impact estimate

Read on 2026-10-27 at `main` `37e6c6f0` by `grep` for each rule number; the counts are files.

- **Doorstop items made suspect.** A change to a rule's text makes each item that links to it
  suspect until a person reads it and clears it (`reqs/README.md`). The surface items link to
  rules; the rule items link to none. Suspect: SURF-014, SURF-026, SURF-028 and SURF-063 (linked to
  RULE-0201), SURF-063 (RULE-0306), SURF-028 (RULE-0405) and SURF-075 (RULE-0401). The new
  RULE-0104, RULE-0105 and RULE-0106 need `doorstop review` after a person reads them.
- **Rules whose text names an amended rule.** Not suspect, since they hold no link, but read again
  in the implementing pull request: RULE-0701 (names Rule 1.1), RULE-1105 (1.3), RULE-1114,
  RULE-1116, RULE-1201 and RULE-1306 (2.1), RULE-0708 (4.1 and 4.5), RULE-0821 and RULE-0822
  (4.1), and RULE-0906 (13.6).
- **Tests that verify an amended rule.** Files with a `Verifies:` tag: Rule 1.1, 1; 1.3, 2; 2.1, 3;
  3.6, 1; 4.1, 2; 4.5, 1; 13.6, 1. None asserts the old text; each is read again with its item.
- **Line references.** `docs/capability-coverage.md` cites `docs/language-design.md:36` (Rule 1.1)
  by line. A new section 1.8 moves the lines after it; the table is regenerated in the implementing
  pull request.
- **Rule 13.6 and its test.** `surface-names.test.ts` accepts an ECMAScript name from `Math`,
  `console`, `Array.prototype`, `Map` and `Set`. The amended rule is wider than the test. The
  test grows with each item of section 3 that adds a name.
- **Rule 1.3 and Rule 9.4.** `src/compiler/ts/cbrt.test.ts` cites Rule 1.3 for WGSL's answer to
  `Math.cbrt`. `Math` is borrowed from ECMAScript, so under the amended rule the WGSL answer stands
  because Rule 9.4 records it as the difference.

- **Documents.** `docs/language-design.md` as above; `reqs/` updated with `bun run reqs:sync`; the
  new items 1.4, 1.5 and 1.6 reviewed with `doorstop review` after a person reads them; a CHANGELOG
  entry (Rule 13.8).
- **Tests.** No behaviour changes. `src/reqs.test.ts`, `src/doc-references.test.ts` and the
  Doorstop check run on the implementing head.
- **Downstream.** The site's Korean rule translations and two sentences of its copy; the editor
  skill's statement of meaning.

Compatibility: no program changes its result or its diagnostics in this proposal.

Dependencies: none.

Duration and cost: unknown. No estimate is established.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decision on D1 to D3, the
merge reference of #801 with `status: accepted`, and the approved revision. No approver or
milestone is recorded here.

### Configuration and validation record

This record does not yet apply. Delivery will require: the rule text in `docs/language-design.md`
equal to section 2 as accepted; `bun run reqs:sync` and `python scripts/doorstop-check.py -C`
clean; `bun run docs:impact` and `bun run docs:refs` clean; `bun run test` green on the
implementing head; and an audit that Appendix B lists every rule of section 3.

## What it owes downstream

- **typeshade.github.io.** The rule pages render from `reqs/` at the pin. The Korean translations
  of Rules 2.1 and 4.1 in `content/guide/ko/rules.json` are written again, since
  `src/lib/rule-translations.ts` holds each translation to its English; the other amended and new
  rules have no Korean translation today. Two sentences in `src/i18n/en.ts` and `ko.ts`
  say each TypeScript statement means what the WGSL beside it means; they are read against the
  new Rule 1.1. `compiler-changes.md` records 0100 when the pin moves.
- **vscode-typeshade.** The skill's statement of what a file means is read against Rule 1.1.
  `compiler-changes.md` records 0100 when the pin moves.
- **radiance, typenn, typecv.** Nothing is owed: no program changes.
