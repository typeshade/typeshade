---
id: '0100'
title: WGSL decides what the surface can express and TypeScript decides how an author writes it and what it means; the compiler chooses each representation and may own memory for it
status: draft
rules:
  - '1.1'
  - '1.3'
  - '1.4'
  - '1.5'
  - '2.1'
  - '3.6'
  - '4.1'
  - '4.5'
  - '13.6'
surface: []
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The rule pages render the amended and the new rules from reqs/ at the pin; the Korean rule translations (src/lib/rule-translations.ts) of Rules 1.1, 1.3, 2.1, 3.6, 4.1, 4.5 and 13.6 are written again, and Rules 1.4 and 1.5 are translated. The two sentences in src/i18n/en.ts and ko.ts that say each TypeScript statement means what the WGSL beside it means are read against the new Rule 1.1. compiler-changes.md records 0100 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's statement of what a "use typeshade" file means is read against the new Rule 1.1 and fixed where it says WGSL decides the meaning. compiler-changes.md records 0100 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names rules and sections it will add -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0100, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Date and attribution          | Authored 2026-10-27, UTC, by a Claude Code agent. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-10-27, in Korean. The session began with a request for TypedArray support. The owner then set the direction this proposal records: the concept an author writes is ECMAScript's and the compiler implements it with a heap, a stack or buffers as it needs ("개발의 자유도를 뺏는게 싫은거예요"); the outdated rules are to be improved by that principle; WGSL is the reference for the surface and TypeScript for how developers write; the surface borrows only some WGSL expressions, such as `declare`; expressiveness is kept, and behaviour is the same as TypeScript's. The first revision of this file, a TypedArray spelling proposal, is superseded by this revision; its content moves to the planned array proposal. No GitHub issue is recorded. |
| Applicability / effectivity   | `docs/language-design.md` (Rules 1.1, 1.3, 2.1, 3.6, 4.1, 4.5 and 13.6, new Rules 1.4 and 1.5 in a new section 1.8, Appendix B), `reqs/` (the items of those rules), and the site's rule pages. No compiler code, IR, backend, CPU tier, export, diagnostic code, surface section or example changes in this proposal. No release version is assigned.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Review baseline               | `main` at `37e6c6f0f597eb335ae0d16e7365ca122ed70a05` (2026-10-27).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Review and revision authority | Pull request [#801](https://github.com/typeshade/typeshade/pull/801) (branch `claude/typedarray-support-proposal-tr3cu0`). Git records the revisions of this file; the merge of #801 with `status: accepted` records the decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## What changes

### 1. The principle

> WGSL decides what the surface can express. TypeScript decides how an author writes it and what
> it means. Where ECMAScript has a concept that carries the GPU meaning, the author writes
> ECMAScript's spelling and gets ECMAScript's behaviour, and the compiler chooses the
> representation, owning memory where it needs it. The surface borrows a WGSL expression only
> where no ECMAScript spelling carries the meaning, and the borrowing loses nothing WGSL can
> express.

Three parts of the principle are separate requirements:

- **The surface borrows from WGSL only what TypeScript has no word for.** The borrowed
  expressions are the sized scalars (`f32`, `i32`, `u32`, `f64`), the vectors, the matrices, the
  textures and samplers, the address spaces spelled with `declare const x: storage<T>` and its
  siblings, the attributes as decorators, and the built-in functions and values. A TypeScript
  `number` names none of the sized scalars, so they stay WGSL's. A TypeScript `boolean` carries
  what `bool` carries, so it needs no borrowed word.
- **Expressiveness is kept.** Every WGSL capability the surface reaches today stays reachable
  (Rule 11.14's coverage table). A TypeScript spelling replaces a WGSL one only where it carries
  the same meaning.
- **Behaviour is TypeScript's.** A form ECMAScript defines (an array, a `Map`, a `Set`, an object
  and its references, a loop, a method) does what it does in TypeScript. The compiler may
  represent it on the stack, in a binding, or in memory it owns, and may change the representation
  between versions, while every observable answer stays ECMAScript's. Change 0080 stated this for
  `Map` and `Set` (its section 1); this proposal makes it the rule for the whole surface.

The arithmetic of a borrowed WGSL type stays WGSL's: an `f32` sum rounds as WGSL rounds it, and
an `i32` overflow wraps as WGSL wraps it.

### 2. The rules this proposal amends

The text below is proposed. The implementing pull request writes it into
`docs/language-design.md` and `reqs/`.

**Rule 1.1 (amended).** A `"use typeshade"` program must mean what TypeScript means where it is
written in a form ECMAScript defines, and what WGSL means where it is written in a form the
surface borrows from WGSL, unless a rule in this document says otherwise.

- Rationale: WGSL decides what the surface can express, and TypeScript decides how an author
  writes it. An author who knows TypeScript reads a program as TypeScript; a meaning that differs
  from TypeScript's in a form TypeScript defines is a trap, not a feature.
- Was: "must mean what the WGSL program it emits means", with the rationale that TypeShade is a
  front end and the target language decides the meaning.

**Rule 1.3 (amended).** The CPU oracle is the reference evaluation: where ECMAScript fixes the
result of a form it defines, the oracle must give ECMAScript's result, with the arithmetic of the
WGSL types the program uses; where WGSL fixes a result, the oracle must give that result; where
WGSL leaves room (§11), the oracle's answer is one of the permitted ones.

- Was: the oracle follows WGSL alone. The CPU tier of change 0080 already uses JavaScript's own
  `Map` and `Set` as the oracle.

**Rule 1.4 (new), in a new section 1.8, "Relation to TypeScript".** Where ECMAScript has a
concept that carries the GPU meaning, the surface must spell it as TypeScript does; a WGSL
spelling is borrowed only where no ECMAScript spelling carries the meaning, and the borrowing must
keep every WGSL capability reachable (Rule 11.14).

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

### 3. The rules that still state the old principle

The amended Rule 1.1 keeps "unless a rule in this document says otherwise". The rules below still
say otherwise. This proposal does not change them: each changes in a proposal of its own, so
that each record carries one change. Appendix B gains one row for Rule 1.1 that lists them, and
each item leaves the row when its proposal is implemented.

| Item                                          | Rules                | What the old principle refuses or changes                                                                                                                                                                                         |
| --------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. The compiler's memory                      | 1.5, 6.11, 11.8      | Each feature makes its own buffer. Planned: one memory model, its sizing, the representation of a reference, the limits of each target, and what happens when the memory runs out.                                                |
| B. Arrays                                     | 2.1, 4.1, 8.22, 8.23 | `Array<T>`, `T[]` and the typed arrays are refused (`TS8002`). Planned: the revision 1 content of this file, widened to `Array<T>` and `T[]`, construction and growth, on the memory model of item A.                             |
| C. `boolean`                                  | 4.6                  | `boolean` is refused (`TS8002 TypeShade spells the boolean "bool".`). Planned: `boolean` is the same type as `bool`; both stay accepted.                                                                                          |
| D. References to objects and arrays           | 6.10, 7.2, 8.8       | A struct is a value: a write through a copy is not seen through the original, and `TS8005` refuses the case where the two would differ. A change here makes a compiling program compute something else, so it follows Rule 13.10. |
| E. Types surface §28 refuses                  | 7.8                  | A union of two types, a rest tuple, `instanceof`, `in` and `string` are refused. Each is read again under Rule 4.5 as amended.                                                                                                    |
| F. Loops                                      | 7.5                  | A `for` that is not counted, and a `for (;;)` or `while (true)` with a `break`, are refused, although WGSL's `loop` carries them.                                                                                                 |
| G. Array methods                              | 7.2, surface §63     | `filter`, `find`, `slice`, `concat` and `sort` are refused (change 0005).                                                                                                                                                         |
| H. `Map` and `Set` outside a kernel parameter | 2.1, 8.22            | A `Map` or `Set` is refused anywhere but a kernel function's parameter (change 0080).                                                                                                                                             |

Rule 4.6's refusal of `number` stays. `number` names no width, and the sized scalars are what the
surface borrows from WGSL to say it.

The planned order is A, then B and C, then the rest. C does not depend on A and may come first.
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
an exception to Rule 1.1. This proposal makes the exception the rule.

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
3. **D3. `bool` after item C.** Both spellings accepted, with `boolean` in documents and examples
   (recommended, as discussed on 2026-10-27), or `bool` withdrawn later under Rule 13.10.

## What it touches

- **Rule 1.1.** Section 2. The meaning is TypeScript's for ECMAScript forms.
- **Rule 1.3.** Section 2. The oracle gives ECMAScript's answer for ECMAScript forms.
- **Rule 1.4 (new).** Section 2. A WGSL spelling is borrowed only where TypeScript has none.
- **Rule 1.5 (new).** Section 2. The representation is the compiler's, and it may own memory.
- **Rule 2.1.** Source (b) is the standard library as TypeScript declares it.
- **Rule 3.6.** A type name follows its source's spelling.
- **Rule 4.1.** A type ECMAScript defines may be written.
- **Rule 4.5.** A refusal rests on what the compiler cannot represent.
- **Rule 13.6.** An ECMAScript name cites ECMA-262 or TypeScript's library.
- **Appendix B.** One row for Rule 1.1, listing items A to H.

No surface section, export, diagnostic code or example changes. The rules' new text describes the
current tree where section 3 does not list an exception, and Appendix B lists every exception.

### Draft impact estimate

- **Documents.** `docs/language-design.md` as above; `reqs/` updated with `bun run reqs:sync`; the
  new items 1.4 and 1.5 reviewed with `doorstop review` after a person reads them; a CHANGELOG
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
  in `src/lib/rule-translations.ts` of Rules 1.1, 1.3, 2.1, 3.6, 4.1, 4.5 and 13.6 are written
  again, and Rules 1.4 and 1.5 gain translations. Two sentences in `src/i18n/en.ts` and `ko.ts`
  say each TypeScript statement means what the WGSL beside it means; they are read against the
  new Rule 1.1. `compiler-changes.md` records 0100 when the pin moves.
- **vscode-typeshade.** The skill's statement of what a file means is read against Rule 1.1.
  `compiler-changes.md` records 0100 when the pin moves.
- **radiance, typenn, typecv.** Nothing is owed: no program changes.
