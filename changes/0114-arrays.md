---
id: '0114'
title: An array is written as TypeScript writes it, T[] when the size is unknown and from its value when it is known, array<T, N> stays the one sized type, and a storage binding's access follows from what the program does
status: draft
rules:
  - '4.5'
  - '6.1'
  - '6.2'
  - '9.6'
surface:
  - 1
  - 7
  - 14
  - 18
  - 20
  - 28
  - 63
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The guide pages and rule pages that spell `array<T>`, `array<T, N>(...)`, `fill<T, N>(v)` and `storage<T, "read_write">` are written again in the new spellings at each stage that changes them; the Korean translations of Rules 6.1 and 6.2 follow.
  - repo: vscode-typeshade
    what: The completions, snippets and the skill text that suggest `array<T>`, the `array(...)` constructor, `fill` or the `"read_write"` argument are changed at each stage that changes them.
---

<!-- doc-refs: skip-file — a draft proposal names rules and sections it will add -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0114, `status: draft`. The front matter is the identity and lifecycle authority. No implementation exists.                                                                                                                                                                                                 |
| Date and attribution          | Authored 2026-11-02, UTC, by a Claude Code agent. The date is the authorship date, not an approval date.                                                                                                                                                                                                            |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-02, in Korean. The owner asked whether `T[]` can replace `array<T>`, whether `array<T, N>` should be replaced by `Array<T, N>` or by a type of TypeShade's own, and how `readonly T[]` fits. The owner approved the direction this draft records ("승인"). |
| Applicability / effectivity   | `docs/language-design.md` (Rules 4.5, 6.1, 6.2, 9.6), `docs/use-typeshade-surface.md` (§1, §7, §14, §18, §20, §28, §63), `docs/typeshade-plan.md` (area B), the front end, the language service's ambient library, the binding reflection and the runtime's bind-group layout. No release version is assigned.      |
| Review baseline               | `main` at `9afe73a` (2026-11-02).                                                                                                                                                                                                                                                                                   |
| Review and revision authority | No pull request is assigned yet. Git records the revisions of this file; the merge of its pull request with `status: accepted` records the decision.                                                                                                                                                                |

## What changes

This is the proposal for area B of `docs/typeshade-plan.md` (proposal 0100, decision D4: one
proposal for each area, with a stage for each unit and a pull request for each stage). It applies
Rule 1.4 of accepted proposal 0100: where ECMAScript has a form that carries the meaning, the
surface borrows TypeScript's spelling, and a WGSL spelling is borrowed only where no ECMAScript
spelling carries it.

### 1. The principle for arrays

- **An array whose size is unknown is TypeScript's array.** `T[]`, `Array<T>`, `readonly T[]` and
  `ReadonlyArray<T>` carry it, so `array<T>` with no size leaves the surface.
- **An array whose size is known takes its size from its value.** A literal, a constructor with a
  constant length, or an initializer gives the size, so an author rarely writes a sized type.
- **`array<T, N>` stays the one sized type.** TypeScript has no type for "an array of N elements"
  except a tuple, which cannot spell a length such as 256. WGSL's `array<T, N>` carries the
  meaning, it is valid TypeScript as the ambient library declares it, and it needs no editor
  projection. By Rule 1.4 it is the borrowed word.
- **A value is built as TypeScript builds it.** The value constructor `array<T, N>(...)` and
  `fill<T, N>(v)` leave the surface for an array literal and `new Array(N).fill(v)`.

### 2. The stages

Each stage is one pull request, and each asserts both halves on the same source: `compile()` and
the language service (CLAUDE.md, "A test reads both halves"; Rule 12.7).

**S1. Unsized arrays in TypeScript's spelling (plan unit B1, with `readonly`).**

- `T[]`, `Array<T>`, `readonly T[]` and `ReadonlyArray<T>` are accepted wherever `array<T>` with no
  size is accepted today: a storage binding's value type (`storage<f32[]>`), the last field of a
  storage struct, and a kernel function's parameter.
- They mean exactly what `array<T>` means there, and they emit the same WGSL.
- `readonly` on a parameter is a promise that the function does not write the array. A write
  through it is refused in both halves. The editor gets the refusal from TypeScript's checker.
- `array<T>` with no size stays accepted in this stage. S4 removes it.
- TypedArrays (plan unit B2) are not in S1. They stay their own unit.

**S2. A size from the value (plan units B4 and B5, with literals and tuples).**

- An untyped array literal takes its element type and its length from its elements:
  `const a = [1., 2., 3.]` is `array<f32, 3>`. The element type follows the literal rules of §5
  (Rule 5.1). A literal whose elements do not share one type is refused with the types it found.
- `as const` on a module-scope literal gives the same sized array, read-only.
- `new Array(N).fill(v)`, `new Float32Array(N)` and `Array.from({ length: N }, f)` with a
  constant `N` give `array<T, N>`.
- A class field's size comes from its initializer: `weights = new Array(16).fill(0.)`.
- A tuple `[f32, f32, f32]` is already `array<f32, 3>` (surface §28); this stage records it as the
  short sized spelling for a small length and adds no behaviour to it.

**S3. A storage binding's access follows from what the program does (option C).**

- The compiler infers a storage binding's access mode from the program: a binding that some
  reachable entry writes, by assignment, a mutating method or an atomic builtin, is
  `var<storage, read_write>`; every other storage binding is `var<storage, read>`.
- `storage<readonly T[]>` (and a `readonly` value type in general) is the author's promise that
  nothing writes the binding. A write is refused in both halves, as a write to a read binding is
  today (TS8005 in the compiler, TS2542 or TS2540 in the editor).
- Reflection (`reflect()`), the manifest and the runtime's bind-group layout report the inferred
  mode (`src/core/reflect.ts`, `src/runtime/program.ts`: `'storage'` or `'read-only-storage'`).
- A binding that the module writes and that a vertex entry reads is refused with one sentence:
  WebGPU allows no writable storage buffer in the vertex stage. The sentence names the two
  remedies: a separate binding for the vertex stage, or a `readonly` declaration and no write.
- The explicit `"read_write"` argument of proposal 0006: see decision D3.

**S4. Removals (plan unit B7, revised).**

- The unsized type spelling `array<T>` is refused; the sentence names `T[]`.
- The value constructor `array<T, N>(...)` is refused; the sentence names the array literal
  `[a, b, c]` (with `as array<T, N>` or an annotation where the element type must be given).
- `fill<T, N>(v)` is refused; the sentence names `new Array(N).fill(v)`. Its §9.3 row leaves the
  table (Rule 9.6 is shrink-only; Rule 13.7).
- Before `1.0.0` there is no deprecation window: Rule 13.10 as written gives the window to a
  change that keeps a program compiling and computes something else, and a removed spelling stops
  compiling with a sentence naming its replacement, as `perInvocation<T>` did.
- `array<T, N>` as a type stays.

### 3. What this revises in the plan

`docs/typeshade-plan.md` planned `Array<T, N>` as the sized array (unit B3, with an editor
projection to `T[] & { readonly length: N }`) and the removal of `array<T, N>` (unit B7). This
proposal revises both, and the same pull request amends the plan:

- B3 becomes "no new sized spelling": `array<T, N>` stays, and S2 reduces where it must be written.
- B7 becomes the removal of `array<T>`, the `array<T, N>(...)` constructor and `fill`, and keeps
  the type `array<T, N>`.

The plan is a living document; the units were planned, not accepted (proposal 0100, "Assumptions
and open points").

## Why

### Evidence (measured)

Measured on `main` `9afe73a`, 2026-11-02, Bun 1.4.4, with `compileTsSource` and the language
service's `getDiagnostics` on the same source:

| Source                                                  | Compiler                                                    | Editor                    |
| ------------------------------------------------------- | ----------------------------------------------------------- | ------------------------- |
| `declare const xs: storage<f32[], "read_write">`        | TS8002 "T[] is a JS array type. Use array<T, N>."           | the same                  |
| `declare const xs: storage<Array<f32>, "read_write">`   | TS8002 "JS Array<T> is not a shader type. Use array<T, N>." | the same                  |
| a parameter `xs: f32[]`                                 | TS8002                                                      | TS8002                    |
| `const a: f32[] = [1., 2., 3.]`                         | TS8002                                                      | TS8002                    |
| `const a = [1., 2., 3.]`                                | TS8002 "needs an array type annotation"                     | the same                  |
| a parameter `xs: Float32Array`                          | TS8002 "Unknown type"                                       | the same                  |
| a parameter `xs: readonly f32[]`                        | TS8002 "Unsupported type syntax"                            | the same                  |
| a parameter `xs: readonly array<f32>`                   | TS8002 "Unsupported type syntax"                            | TS1354 (TypeScript's own) |
| `xs[0] = 1.` on `declare const xs: storage<array<f32>>` | TS8005, naming `storage<T, "read_write">`                   | TS2542 (TypeScript's own) |
| `declare const xs: storage<array<f32>, "read_write">`   | accepted                                                    | accepted                  |
| a parameter `xs: array<f32>`                            | accepted                                                    | accepted                  |

The two halves agree on every verdict. Two rows differ in the code: `readonly array<f32>` and the
write to a read binding. The second is by design (Rule 6.2 names TypeScript's codes as the
editor's enforcement); the first is noted for S1, which accepts the form and so removes the row.

The refusals name `array<T, N>` as the fix for a program a TypeScript developer writes first,
which is what Rule 1.6 of proposal 0100 asks the compiler to support instead.

### Why `array<T, N>` stays and `Array<T, N>` is not added

- `Array<T, N>` is not valid TypeScript. The global `Array` has one type parameter, and a
  declaration with two is TS2317. Only an editor projection can hide it, and the projection needs
  replacement as well as insertion (plan unit B3).
- Every tool outside the language service then reports the file: plain `tsc`, typescript-eslint
  with type information, and an editor without the TypeShade plugin.
- The projection depends on TypeScript's internal API, and plan unit T1 already records that it
  must be measured again on TypeScript 7. That cost returns with each TypeScript version.
- A sized-array type of TypeShade's own would be a third source of names for a meaning WGSL already
  names (Rule 2.1), with no specification an author can read.

### Why the access mode is inferred (option C)

- `docs/dx.md`: the GPU is an optimization level of the TypeScript the developer wrote. A storage
  buffer's access mode is a fact the compiler can read from the program, as the address space of a
  module variable is read from a top-level `let` (`docs/roadmap.md`, "Ordinary TypeScript first",
  the `perInvocation<T>` case).
- `readonly` is TypeScript's own word for "this is not written", so the promise needs no WGSL
  word.

### Alternatives

- **A. Keep `"read_write"`, and use `readonly` on parameters only.** Smallest change. It keeps two
  spellings for one fact. Not recommended.
- **B. `storage<readonly T[]>` is read, `storage<T[]>` is read-write.** Exactly TypeScript's
  meaning, but the default flips: every `storage<T[]>` that is only read becomes read-write, which
  the vertex stage refuses. Not recommended.
- **C. Inference, with `readonly` as a promise.** Recommended; approved by the owner on 2026-11-02.
- **`Array<T, N>` as the sized type.** See above. Not taken.
- **A TypeShade sized type (`FixedArray<T, N>`).** See above. Not taken.

### Assumptions and open points

- S3 makes the bind-group layout depend on the program's body. A host that builds its layout
  from an older reflection, or shares one layout between two modules, sees a different mode after
  an edit that adds or removes a write. The stage measures where the runtime and the manifest
  cache a layout.
- S2's element type for an untyped literal follows Rule 5.1, which proposal 0100's plan changes
  (the integer-literal default, #148). The literal rule follows whatever Rule 5.1 says when S2
  lands.

### Decisions for the owner

1. **D1. Stage order.** Recommended: S1, S2, S3, S4. S4 needs S1 and S2 so every removed spelling
   has its replacement on `main`.
2. **D2. Untyped literal of mixed integer and float elements** (`[1, 2.5]`). Recommended: refused,
   with the element types the compiler found, until #148 settles the integer default.
3. **D3. The explicit `"read_write"` argument after S3.** Recommended: removed in S4. With
   inference, the argument either repeats what the compiler knows or contradicts it; an argument
   that says `"read_write"` on a binding nothing writes would change only the layout. A host that
   must force a read-write layout (a buffer shared with another pipeline that writes it) is the
   one case for keeping it; if the owner wants that case, the argument stays optional and an
   argument that disagrees with the program is a warning.
4. **D4. Rule 6.2.** S3 reverses the first sentence of Rule 6.2 ("a storage binding's access mode is
   its second type argument") and its rationale ("the access mode is part of the WGSL type, so it
   belongs in the type"), from proposal 0006. Recommended: Rule 6.2 is rewritten to say the mode is
   inferred, `readonly` is the promise, and the write refusal in both halves stays.

## What it touches

- **Rule 4.5:** surface §28's list loses `T[]`, `Array<T>` and the untyped literal as refusals.
- **Rule 6.1:** the resource spellings gain `storage<T[]>` and `storage<readonly T[]>`; S4 removes
  `storage<T, "read_write">` if D3 is taken as recommended.
- **Rule 6.2:** rewritten by S3 (decision D4).
- **Rule 9.6:** the §9.3 table loses the `fill` row in S4.
- **Surface §1 and §20:** the storage spellings and the runtime-sized array's spelling.
- **Surface §7:** the new refusal sentences of S3 and S4.
- **Surface §14, §18 and §28:** the parameter and local spellings, the untyped literal, tuples.
- **Surface §63:** `new Array(N).fill(v)` and `Array.from`.
- **Codes:** none added. S3 and S4 refuse under existing codes (TS8002 for a type, TS8004 or
  TS8019 for a removed callee, TS8005 for a write) with new sentences.
- **Examples:** none added or removed. S4 edits the examples that call `array<T, N>(...)` or
  `fill`: `array-literal-ramp`, `array-methods`, `closures`, `higher-order`, `packing-bitcast`,
  `palette-const`, `reference-parameters` and `tuple-and-brand` (found with `grep` on `9afe73a`).
- **`docs/typeshade-plan.md`:** units B3 and B7 revised (section 3).

Related drafts, not dependencies: proposal 0112 (#878) removes `arrayLength` for `.length`;
proposal 0113 (#877) admits `const { sqrt } = Math`; proposal 0115 (#879) discusses the core
vocabulary and module isolation.

### Draft impact estimate

- S1: the front end's type mapping (`src/compiler/ts/type-map.ts` and the binding reader), the
  ambient library's `storage<T>` and parameter types, and the tests of both halves. Known small.
- S2: the literal typing in the front end, constant-length constructors, class field sizes.
  Medium; B4 and B5 of the plan.
- S3: an access analysis over the reachable entries, reflection, the manifest and the runtime's
  layout, the vertex refusal. Medium to large; the cache question above is unknown.
- S4: the removals, the examples and their goldens, the site and the editor. Medium.
- No duration is estimated.

### Approval and plan record

This record does not yet apply. Acceptance requires the owner's decisions D1 to D4 and the merge
of this file with `status: accepted`.

### Configuration and validation record

This record does not yet apply. Each stage will record its pull request, its commits, the checks
that ran (both halves for every form it adds or refuses, the compile gate for the emitted WGSL and
GLSL, the CPU oracle) and its deviations.

## What it owes downstream

- **typeshade.github.io:** every page that spells `array<T>`, `array<T, N>(...)`, `fill<T, N>(v)`
  or `storage<T, "read_write">`, at the stage that changes it. Not searched from this session.
- **vscode-typeshade:** the completions, snippets and skill text that suggest those spellings.
  Not searched from this session.
