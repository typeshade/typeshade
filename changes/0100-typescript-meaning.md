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
| Applicability / effectivity   | `docs/language-design.md` (Rules 1.1, 1.3, 2.1, 3.6, 4.1, 4.5 and 13.6, new Rules 1.4, 1.5 and 1.6 in a new section 1.8, Appendix B), `reqs/` (the items of those rules), and the site's rule pages. No compiler code, IR, backend, CPU tier, export, diagnostic code, surface section or example changes in this proposal. No release version is assigned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
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
  and how it appears to the host are unit A1 of section 3, not this rule.

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
- The rule's second rationale stays until unit B7 of section 3 lands: `Array<T>` is the
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
an author can use on its own and that a pull request can deliver and verify alone. Each unit lands
in its own pull request. The units of one area may share one proposal with stages, as change 0094
does, or have a proposal each (decision D4).

The rules the units change still state the old principle until their unit lands: their recorded
reason is that WGSL decides the meaning, or that a type must be a WGSL type. Under the amended
Rule 1.1 the burden is on a difference: the default outcome of each unit is the source's meaning,
implemented by the compiler, and a unit keeps a difference only where the compiler cannot
represent the form on a target (Rule 1.5) or where the difference serves the GPU and its reason is
written down. A refusal that TypeCV's audit of 2026-10-27 calls a form the GPU "cannot hold" is
not taken as settled: with the arena of unit A1, several are representations still to be built.
Appendix B gains one row for Rule 1.1 that lists the open units, and each unit leaves the row when
it lands.

| Unit | Area        | What an author can write when it lands                                                                                                                                                                 | Needs                                            |
| ---- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| P1   | Process     | Rule 13.10: before `1.0.0` a change may break any program in the next release, with no window, deprecation step or kept spelling; a `### Changed` entry and reviewed goldens remain.                   | none                                             |
| A1   | Memory      | One buffer the compiler owns (the arena): it appears in `reflect()` and the manifest, and the call sizes and binds it. The records of a loop that pushes (change 0078) move into it as its first user. | none                                             |
| A2   | Memory      | A region of the arena reserved per call from a size the call knows (a host value's length, a constant).                                                                                                | A1                                               |
| A3   | Memory      | Running out of the arena: a flag the call reads, then the CPU tier for a host call, or a refusal that names the bound.                                                                                 | A2                                               |
| A4   | Memory      | A reference as a value: an offset into the arena that a variable, a field or an element holds.                                                                                                         | A2                                               |
| C1   | `boolean`   | `boolean` is accepted wherever `bool` is, as the same type.                                                                                                                                            | none                                             |
| C2   | `boolean`   | `bool` is removed; its diagnostic names `boolean`; examples and documents use `boolean`.                                                                                                               | C1, P1                                           |
| B1   | Arrays      | `T[]` and `Array<T>` wherever `array<T>` with no size is accepted (a kernel function's parameter, a storage binding).                                                                                  | none                                             |
| B2   | Arrays      | `Float32Array`, `Int32Array`, `Uint32Array` and `Float64Array` in the same positions (revision 1 of this file).                                                                                        | none                                             |
| B3   | Arrays      | `Array<T, N>` as the sized array; the editor projects it to `T[] & { readonly length: N }` (TS2317 on the global `Array`).                                                                             | none                                             |
| B4   | Arrays      | A local's size from its value: `new Array(N)`, `new Float32Array(N)`, `Array.from({ length: N }, f)` with a constant `N`.                                                                              | B1                                               |
| B5   | Arrays      | A class field's size from its initializer, a binding's struct included: `weights = new Float32Array(16)`.                                                                                              | B4                                               |
| B6   | Arrays      | A helper's `T[]` parameter, compiled once for each length its callers pass (Rule 8.9).                                                                                                                 | B1                                               |
| B7   | Arrays      | `array<T, N>` is removed; its diagnostic names `Array<T, N>`.                                                                                                                                          | B3, P1                                           |
| B8   | Arrays      | `new Float32Array(n)` and `new Array(n)` with `n` known when the call runs.                                                                                                                            | B4, A2                                           |
| B9   | Arrays      | `push` outside a kernel function's loop, on an array in the arena.                                                                                                                                     | A3                                               |
| D1   | References  | `const b = a` of a local array or struct is the same object: a write through `b` is seen through `a` (`TS8005` withdrawn for locals).                                                                  | none                                             |
| D2   | References  | A struct or array parameter a helper writes is the caller's, as in TypeScript.                                                                                                                         | none                                             |
| D3   | References  | A reference held in a field or an element.                                                                                                                                                             | A4                                               |
| E1   | Types       | `'x' in s`, answered from the type.                                                                                                                                                                    | none                                             |
| E2   | Types       | A union of two types, `A                                                                                                                                                                               | B`, as a tagged value, as the optional value is. | none |
| E3   | Types       | `s instanceof C`, from the static type, or from the tag of E2.                                                                                                                                         | E2                                               |
| E4   | Types       | A rest tuple `[T, ...T[]]`, as a `T[]` with at least one element.                                                                                                                                      | B1                                               |
| F1   | Loops       | `while (true)` and `for (;;)` with a `break`, as WGSL's `loop`.                                                                                                                                        | none                                             |
| F2   | Loops       | A `for` that is not counted, as an open loop; the analyses that need a counted loop skip it.                                                                                                           | none                                             |
| F3   | Loops       | `do…while`.                                                                                                                                                                                            | none                                             |
| F4   | Loops       | A labelled `break` and `continue`.                                                                                                                                                                     | none                                             |
| G1   | Methods     | `find` and `findLast`, giving `T                                                                                                                                                                       | undefined`.                                      | none |
| G2   | Methods     | `sort` of a sized array in one invocation.                                                                                                                                                             | none                                             |
| G3   | Methods     | `slice` with a constant length, and `concat` of sized arrays.                                                                                                                                          | B3                                               |
| G4   | Methods     | `filter`, its result in the arena.                                                                                                                                                                     | A2                                               |
| G5   | Methods     | `sort` of a kernel function's array, on the device.                                                                                                                                                    | none                                             |
| H1   | Map and Set | A `Map` or `Set` local to a function, in the arena.                                                                                                                                                    | A3                                               |
| H2   | Map and Set | A `Map` or `Set` in a binding.                                                                                                                                                                         | H1                                               |
| I1   | Functions   | A function held in a local `const` or `let` and called later, as an id the compiler dispatches on.                                                                                                     | none                                             |
| I2   | Functions   | A function held in a field or an element.                                                                                                                                                              | I1                                               |
| I3   | Functions   | A closure whose captures live in the arena.                                                                                                                                                            | I1, A2                                           |
| J1   | Recursion   | Recursion whose depth the compiler bounds from constants.                                                                                                                                              | none                                             |
| J2   | Recursion   | Recursion over an explicit stack in the arena.                                                                                                                                                         | A3                                               |
| K1   | Strings     | A `string` constant and `===` on it, held as an id.                                                                                                                                                    | none                                             |
| K2   | Strings     | A string built at run time, UTF-16 code units in the arena, with `length`, `charCodeAt` and `===`.                                                                                                     | A2                                               |
| L1   | Exceptions  | `throw` and `try`/`catch` within one function.                                                                                                                                                         | none                                             |
| L2   | Exceptions  | A `throw` that crosses calls.                                                                                                                                                                          | L1                                               |
| L3   | Exceptions  | A `throw` that leaves a kernel function or an entry and reaches the host as a rejected promise.                                                                                                        | L2                                               |
| W1   | WebAssembly | The wasm tier of proposal 0042 for a kernel function over scalar arrays: the encoder, the numeric contract, the tier between WebGL2 and the CPU tier, the JavaScript tier as its fallback.             | 0042 accepted                                    |
| W2   | WebAssembly | Vectors and matrices on the wasm tier, scalarized.                                                                                                                                                     | W1                                               |
| W3   | WebAssembly | A `@compute` entry's invocations on the wasm tier.                                                                                                                                                     | W2                                               |
| W4   | WebAssembly | A full-screen `@fragment` draw on the wasm tier.                                                                                                                                                       | W2                                               |
| W5   | WebAssembly | A `Resident` array kept in linear memory between calls.                                                                                                                                                | W1                                               |
| W6   | WebAssembly | The binary as a Vite asset loaded with `instantiateStreaming`, with an inline fallback.                                                                                                                | W1                                               |
| W7   | WebAssembly | The arena of unit A1 in linear memory, so the units that need it run on the wasm tier where no GPU tier represents them.                                                                               | W1, A1                                           |
| R1   | Runtime     | A runtime core module, prebuilt in the package, and its loader; its first function packs an array of structs into `std430` bytes (TypeCV audit P1).                                                    | none                                             |
| R2   | Runtime     | One `WebAssembly.Memory` per device owner (Rule 11.8) holds the host copies of `Resident` arrays in the GPU's layout, so an upload is one `writeBuffer`.                                               | R1                                               |
| R3   | Runtime     | The pool of released arrays in that memory.                                                                                                                                                            | R2                                               |
| R4   | Runtime     | The ordered merge of a `Map` or `Set`'s records (change 0080) in the runtime core.                                                                                                                     | R1                                               |
| R5   | Runtime     | The host side of the arena of unit A1 in that memory.                                                                                                                                                  | R2, A1                                           |
| R6   | Runtime     | The runtime core written in `"use typeshade"`, one source compiled to WGSL for the GPU and to WebAssembly for the host.                                                                                | R1, W1                                           |

Rule 4.6's refusal of `number` stays. `number` names no width, and the sized scalars are what the
surface borrows from WGSL to say it.

Area W carries proposal 0042 (draft, PR #460), split into units; its stage gate stays: W1 runs
at least twice as fast as the CPU tier, bit for bit, or 0042 is withdrawn with the numbers. The
JavaScript CPU tier stays the oracle and the fallback. A form the GPU cannot represent (Rule 1.5)
runs on the wasm tier before the JavaScript one once W7 lands.

Area R uses WebAssembly for the runtime itself: memory, layout and the host's share of the
algorithms. The program module of area W imports the runtime core's memory, so a device owner has
one linear memory. A call crosses the boundary once for each array, never once for each element,
and compiles a module once, asynchronously, at load (0042, decision D2 of #459). A user never
holds a raw view of linear memory: growing a memory that is not shared detaches its
`ArrayBuffer`, so a user holds a `Resident` handle, and a view is made again after a growth. The
JavaScript implementations stay as the oracle and as the fallback where a page's content security
policy refuses WebAssembly.

The design basis of A1 is the layout C compilers give WebAssembly (Emscripten, clang's `wasm32`),
read from general knowledge and not verified in this proposal: static data, then a shadow stack
for what needs an address, then a heap that grows with `memory.grow`, views refreshed after each
growth, function pointers through a table and `call_indirect`, and exceptions as native
WebAssembly exception handling. TypeShade differs in three ways: the arena's layout is the GPU's
`std430` (Rule 6.8), so it moves without conversion; optimization runs on the IR before encoding,
since 0042 adds no dependency; and one program runs alike on four tiers, so the memory model of
A1 to A4 must be one that WebGPU and WebAssembly both take.

The units with no dependency can start at once and in any order. P1 comes before any unit that
removes a spelling (B7, C2). The order among the rest is the owner's (decision D5); the TypeCV
audit's ranking of its forced forms (sort, `Map`, bounded lists, records at a stride) is the
evidence for G2, H1 and B9 first. Each proposal takes the next free number when it is drafted
(Rule 3.7).

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
5. **D5. The order.** The units with no dependency first, led by the TypeCV evidence.
6. **D6. Area R and the design basis of A1** are part of section 3. The JavaScript implementations
   stay as the oracle and the fallback; the runtime core is written in `"use typeshade"` (R6).

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
- **Appendix B.** One row for Rule 1.1, listing the open units of section 3.

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

The owner (Seungup) approved the proposal in the Claude Code session on 2026-10-27 (UTC), in
Korean ("네 좋아요"), in answer to the list of decisions D1 to D5 with their recommendations, the
addition of area R, and the use of the C comparison as the design basis of A1. The approved
revision is the one this record is part of. The merge of #801 with `status: accepted` records the
decision.

Responsibilities: an agent of this repository implements the rule text of section 2 in a pull
request whose commits say `Change: 0100`, and drafts the proposals of section 3 area by area. The
site and the editor do their work when their pins move. No milestone date is assigned. No duration
or cost estimate is established.

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
