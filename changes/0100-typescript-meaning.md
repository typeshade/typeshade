---
id: '0100'
title: TypeShade is a language of its own that borrows how an author writes from TypeScript and what it can express from WGSL; a borrowed form keeps its source's meaning unless a rule records another, and the compiler chooses each representation
status: accepted
rules:
  - '1.1'
  - '1.3'
  - '1.4'
  - '1.5'
  - '1.6'
  - '1.7'
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
    what: The rule pages render the amended and the new rules from reqs/ at the pin. The Korean translations of Rules 2.1 and 4.1 in content/guide/ko/rules.json are written again (src/lib/rule-translations.ts holds them to the English); Rules 1.1, 1.3, 1.4, 1.5, 1.6, 3.6, 4.5 and 13.6 have no Korean translation today. The two sentences in src/i18n/en.ts and ko.ts that say each TypeScript statement means what the WGSL beside it means are read against the new Rule 1.1. compiler-changes.md records 0100 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's statement of what a "use typeshade" file means is read against the new Rule 1.1 and fixed where it says WGSL decides the meaning. compiler-changes.md records 0100 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names rules and sections it will add -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0100, `status: accepted`. The front matter is the identity and lifecycle authority. The owner approved the proposal on 2026-10-27 (UTC); see Approval and plan record. No implementation exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Date and attribution          | Authored 2026-10-27, UTC, by a Claude Code agent. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-10-27, in Korean. The session began with a request for TypedArray support. The owner then set the direction this proposal records: the concept an author writes is ECMAScript's and the compiler implements it with a heap, a stack or buffers as it needs ("개발의 자유도를 뺏는게 싫은거예요"); the outdated rules are to be improved by that principle; WGSL is the reference for the surface and TypeScript for how developers write; the surface borrows only some WGSL expressions, such as `declare`; expressiveness is kept, and behaviour follows TypeScript's. The owner then added that it need not be the same: TypeShade is a language of its own, and the relation is borrowing ("사실 같을 필요도 없어요 차용해오는거에 가깝지 typeshade는 자체 언어니까요"). The owner agreed that a form TypeScript authors commonly write is supported at the compiler level, that the lowercase `array` is to be read again for that reason, preferred `Array<T, N>` as the sized array ("그냥 Array<T, N> 이 제일 깔끔해보이는데?"), and stated that the tree is alpha and need not be bound by compatibility ("지금 구조는 아직 알파단계여서 그렇게까지 얽매이지 않아도 돼"), and that the specification is being made, may break as far as it needs to and may be more radical ("언어 스펙을 만들어가는 단계여서 얼마든지 깨져도 되고, 더 파격적으로 만들어도 돼요"). The owner then split the goal into minimal units ("최소 단위로 나눠야해요") and added that a compiled program needs a WebAssembly build ("컴파일했을때 필요한건 WASM 형태로 빌드하는게 필요한데"). The first revision of this file, a TypedArray spelling proposal, is superseded by this revision; its content moves to the planned array proposal. No GitHub issue is recorded. |
| Applicability / effectivity   | `docs/language-design.md` (Rules 1.1, 1.3, 2.1, 3.6, 4.1, 4.5 and 13.6, new Rules 1.4, 1.5, 1.6 and 1.7 in a new section 1.8, Appendix B), `reqs/` (the items of those rules), and the site's rule pages. No compiler code, IR, backend, CPU tier, export, diagnostic code, surface section or example changes in this proposal. No release version is assigned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Review baseline               | `main` at `37e6c6f0f597eb335ae0d16e7365ca122ed70a05` (2026-10-27).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Review and revision authority | Pull request [#801](https://github.com/typeshade/typeshade/pull/801) (branch `claude/typedarray-support-proposal-tr3cu0`). Git records the revisions of this file; the merge of #801 with `status: accepted` records the decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

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
the stack, a binding, or memory the compiler owns, and it may change between versions while every
observable answer stays the one Rule 1.1 defines. A program whose form the compiler cannot
represent on a target is refused there in one sentence naming the reason, or, for a call the CPU
tier can run, runs there and says why (Rule 11.7).

- Rationale: the meaning is the language's and the representation is the compiler's, as change
  0080 (its section 1) stated for `Map` and `Set`. What memory the compiler owns, how it is sized
  and how it appears to the host are unit S3 of `docs/typeshade-plan.md`, not this rule.

**Rule 1.6 (new).** TypeShade code is compute code: it computes results from data, may run in
parallel, and gives the same answer on every target. Code that reaches the world outside the
computation (input and output, the network, the DOM, timers, the clock, unseeded randomness,
`eval`, a dynamic `import`) is host code, written in TypeScript as today. A form TypeScript
authors commonly write in compute code, a form of the language or a member of its standard
library, must be supported by the compiler. A TypeShade name or a library function
is not a substitute for it; a library holds what TypeScript has no standard form for. A refusal is
the last resort, and names the reason the compiler cannot represent the form on that target
(Rule 1.5).

- Rationale: a TypeShade author is a TypeScript developer. A form they reach for first and find
  refused costs them a detour, and the detour is code: TypeCV's audit of 2026-10-27
  (`typecv/docs/audits/2026-10-27-typescript-surface-gaps.md`) counts 188 lines of hand-made hash
  tables, 122 of sorting and 77 of bounded lists that a `Map`, `sort` and `push` would hold.
- The §9.3 table (Rule 9.6) is already shrink-only; a row whose TypeScript form the compiler comes
  to support is deleted by Rule 13.7.
- The boundary is the present stage's, not a permanent one. A far closer coupling with the host is
  a direction the owner holds for the distant future (2026-10-27: "아주 먼 미래에는 호스트랑
  강하게 결합시킬 수 있는 아주 파워풀한걸 생각하긴 하는데"); no unit plans it, and the work now
  is to do well what exists ("지금은 ... 있는것부터 잘하고 싶어서"). A refusal of host code names
  the host as the place to write it.

**Rule 1.7 (new).** Every form the surface takes beyond TypeScript must be one the editor can
project to valid TypeScript, so that TypeScript's checker serves the editor (Rule 12.7). A form no
projection can carry is not added.

- Rationale: as the language borrows TypeScript's forms and extends a few (`Array<T, N>`), the
  editor keeps TypeScript's checker only while every extension has a TypeScript form it can be
  read as. A checker of TypeShade's own would be a second implementation of the language.

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
- The rule's second rationale stays until unit B7 of `docs/typeshade-plan.md` lands: `Array<T>` is the
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

### 3. The goal, in units

The principle is the goal. It is reached in units, not at once. A unit is the smallest change that
an author can use on its own and that a pull request can deliver and verify alone. The units, the
stages and their order are a living plan, `docs/typeshade-plan.md`, which ordinary pull requests
change as the work moves; this proposal records the decisions the plan follows (D2 to D10).

The rules the units change still state the old principle until their unit lands: their recorded
reason is that WGSL decides the meaning, or that a type must be a WGSL type. Under the amended
Rule 1.1 the burden is on a difference: the default outcome of each unit is the source's meaning,
implemented by the compiler, and a unit keeps a difference only where the compiler cannot
represent the form on a target (Rule 1.5) or where the difference serves the GPU and its reason is
written down. Appendix B gains one row for Rule 1.1 that names the plan's open units, and each
unit leaves the row when it lands.

Rule 4.6's refusal of `number` stays. `number` names no width, and the sized scalars are what the
surface borrows from WGSL to say it.

## Why

**The request.** The owner asked for TypedArray support. Answering it showed that the refusal was
not a gap in one feature. It came from Rule 1.1 and Rule 4.1, which make WGSL the source of
meaning and of types, and from Rule 3.6, which ties a type's spelling to WGSL. Every refusal in
the plan (`docs/typeshade-plan.md`) follows from them.

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
- **Amend every rule the plan names in this proposal.** One record would carry eight changes, some
  of which change what a compiling program computes. Not taken: CLAUDE.md requires one change for
  each record, and the units deliver one at a time what one record could not verify at once.
- **TypeScript for everything, `number` included.** `number` is an IEEE double. The GPU has no
  such type, and an `f32` would compute something else. Not taken.

### Assumptions and open points

- Rule 1.5 leaves the arena to unit A1. This proposal fixes no memory design.
- The units are planned, not accepted. Each is accepted with its own proposal or stage, and may be
  split further when it is drafted.

### Decisions at acceptance

The owner accepted every decision as recommended on 2026-10-27 (Approval and plan record).

1. **D1. The text of the principle and of the amended rules** in section 2: accepted as written.
2. **D2. This proposal holds the principle only.** Rule 13.10 is unit P1, and the arena's
   requirements are unit A1.
3. **D3. `bool`.** Removed by unit C2.
4. **D4. Proposals for the units.** One proposal for each area, with a stage for each unit and a
   pull request for each stage, as change 0094 does.
5. **D5. The order.** Area S first (the owner, 2026-10-27: "결국 개선이 먼저 되어야 더 앞으로 나아갈 수 있다"), then area W (the owner, 2026-10-27: "WASM 부터 먼저 가능하게 만들고 싶어요"), with shared memory, asynchronous calls and threads used by default as far as the host allows; then the units with no dependency, led by the TypeCV evidence.
6. **D6. Area R and the design basis of A1** are part of the plan. The JavaScript implementations
   stay as the oracle and the fallback; the runtime core is written in `"use typeshade"` (R6).
7. **D7. Two levels of IR** are part of the foundation (unit S4).
8. **D8. The editor's constraint.** Every extension is projectable to valid TypeScript (Rule 1.7).
9. **D9. A lighter process before `1.0.0`** (unit P2).
10. **D10. The plan's place and area S.** The units live in `docs/typeshade-plan.md`; area S is
    one `Target`, one runtime, the memory and thread contract, two levels of IR and the software
    adapter (S1 to S5).
11. **D11. TypeShade code is compute code** (Rule 1.6), the present stage's boundary.

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
- **Rule 1.7 (new).** Every extension is projectable to valid TypeScript.
- **`docs/typeshade-plan.md` (new).** The living plan of the units.
- **Rule 1.6 (new).** TypeShade code is compute code; a form commonly written in compute code is the compiler's to support.
- **Appendix B.** One row for Rule 1.1, naming the open units of `docs/typeshade-plan.md`.

No surface section, export, diagnostic code or example changes. The rules' new text describes the
current tree where the plan names no open unit, and Appendix B lists every exception.

### Draft impact estimate

Read on 2026-10-27 at `main` `37e6c6f0` by `grep` for each rule number; the counts are files.

- **Doorstop items made suspect.** A change to a rule's text makes each item that links to it
  suspect until a person reads it and clears it (`reqs/README.md`). The surface items link to
  rules; the rule items link to none. Suspect: SURF-014, SURF-026, SURF-028 and SURF-063 (linked to
  RULE-0201), SURF-063 (RULE-0306), SURF-028 (RULE-0405) and SURF-075 (RULE-0401). The new
  RULE-0104 to RULE-0107 need `doorstop review` after a person reads them.
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
  test grows with each unit of `docs/typeshade-plan.md` that adds a name.
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

The owner (Seungup) approved the proposal in the Claude Code session on 2026-10-27 (UTC), in
Korean ("네 좋아요"), in answer to the list of decisions D1 to D5 with their recommendations, the
addition of area R, and the use of the C comparison as the design basis of A1. Later the same day the owner approved the amendments that followed, decisions D7 to D11 and the merge of #801 ("모두 승인"). The approved
revision is the one this record is part of. The merge of #801 with `status: accepted` records the
decision.

Responsibilities: an agent of this repository implements the rule text of section 2 in a pull
request whose commits say `Change: 0100`, and drafts the proposals of `docs/typeshade-plan.md` area by area. The
site and the editor do their work when their pins move. No milestone date is assigned. No duration
or cost estimate is established.

### Configuration and validation record

This record does not yet apply. Delivery will require: the rule text in `docs/language-design.md`
equal to section 2 as accepted; `bun run reqs:sync` and `python scripts/doorstop-check.py -C`
clean; `bun run docs:impact` and `bun run docs:refs` clean; `bun run test` green on the
implementing head; and an audit that Appendix B names every open unit of `docs/typeshade-plan.md`.

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
