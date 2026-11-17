---
id: '0114'
title: An array is written as TypeScript writes it, T[] when the size is unknown and from its value when it is known, array<T, N> stays the one sized type, and a storage binding's access follows from what the program does
status: accepted
rules:
  - '4.5'
  - '6.1'
  - '6.2'
  - '8.18'
  - '8.21'
  - '8.22'
  - '8.23'
  - '9.6'
  - '11.13'
surface:
  - 1
  - 7
  - 14
  - 18
  - 20
  - 28
  - 63
  - 64
  - 65
  - 76
exports: []
exports-removed: []
codes: []
examples: []
names:
  - Float32Array
  - Array.from
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
| Identity and status           | Proposal 0114, `status: accepted`, approved by the owner on 2026-11-02 (decisions D1 to D4 as recommended). The front matter is the identity and lifecycle authority. No implementation exists.                                                                                                                     |
| Date and attribution          | Authored 2026-11-02, UTC, by a Claude Code agent. The date is the authorship date, not an approval date.                                                                                                                                                                                                            |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-02, in Korean. The owner asked whether `T[]` can replace `array<T>`, whether `array<T, N>` should be replaced by `Array<T, N>` or by a type of TypeShade's own, and how `readonly T[]` fits. The owner approved the direction this draft records ("승인"). |
| Applicability / effectivity   | `docs/language-design.md` (Rules 4.5, 6.1, 6.2, 9.6), `docs/use-typeshade-surface.md` (§1, §7, §14, §18, §20, §28, §63), `docs/typeshade-plan.md` (area B), the front end, the language service's ambient library, the binding reflection and the runtime's bind-group layout. No release version is assigned.      |
| Review baseline               | `main` at `9afe73a` (2026-11-02).                                                                                                                                                                                                                                                                                   |
| Review and revision authority | Pull request [#880](https://github.com/typeshade/typeshade/pull/880) (branch `claude/proposal-0114-arrays`). Git records the revisions of this file; the merge of its pull request with `status: accepted` records the decision.                                                                                    |

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

- Decisions D1 to D4 are closed by the owner's approval on 2026-11-02 (see Decisions). The open
  point on #148 below remains open.
- S3 makes the bind-group layout depend on the program's body. A host that builds its layout
  from an older reflection, or shares one layout between two modules, sees a different mode after
  an edit that adds or removes a write. The stage measures where the runtime and the manifest
  cache a layout.
- S2's element type for an untyped literal follows Rule 5.1, which proposal 0100's plan changes
  (the integer-literal default, #148). The literal rule follows whatever Rule 5.1 says when S2
  lands.

### Decisions

Decided by the owner on 2026-11-02, as recommended in each item.

1. **D1. Stage order.** Decided: S1, S2, S3, S4. S4 needs S1 and S2 so every removed spelling
   has its replacement on `main`.
2. **D2. Untyped literal of mixed integer and float elements** (`[1, 2.5]`). Decided: refused,
   with the element types the compiler found, until #148 settles the integer default.
3. **D3. The explicit `"read_write"` argument after S3.** Decided: removed in S4. With
   inference, the argument either repeats what the compiler knows or contradicts it; an argument
   that says `"read_write"` on a binding nothing writes would change only the layout. A host that
   must force a read-write layout (a buffer shared with another pipeline that writes it) is the
   one case for keeping it; if the owner wants that case, the argument stays optional and an
   argument that disagrees with the program is a warning.
4. **D4. Rule 6.2.** S3 reverses the first sentence of Rule 6.2 ("a storage binding's access mode is
   its second type argument") and its rationale ("the access mode is part of the WGSL type, so it
   belongs in the type"), from proposal 0006. Decided: Rule 6.2 is rewritten to say the mode is
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
- **Surface §76:** the optional-element row no longer says every `T[]` is refused; `(f32 | undefined)[]` is refused for its element type (S1).
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

- **2026-11-02.** The owner approved proposal 0114 in a Claude Code session, in Korean: "0114 추천대로 승인"
  ("approve 0114 as recommended"). The owner decided D1 to D4 as recommended.
- **2026-11-02.** The owner approved widening this proposal's declared scope to surface §76, in a Claude Code session, in Korean: "승인" (approved). S1 makes `T[]` accepted, so the optional-element row of §76 is no longer true as written; this widening lets S1 (pull request #934) correct it.
- The approved revision is this file at the commit on pull request #880 that sets
  `status: accepted`. The approval is the owner's go-ahead in the conversation, recorded here.
- The proposal is accepted on `main` when pull request #880 merges. Until then, no implementation
  may cite proposal 0114 as accepted.

### Configuration and validation record

This record does not yet apply. Each stage will record its pull request, its commits, the checks
that ran (both halves for every form it adds or refuses, the compile gate for the emitted WGSL and
GLSL, the CPU oracle) and its deviations.

## Amendments

An amendment changes the accepted text. Its pull request is proposal-only, and its merge is its
acceptance. Git holds the earlier text. The decided text stays in place, and an amendment record
sits under it.

### A1. Stage S5: a kernel function makes and returns an array whose length its arguments give (plan unit B8) (2026-11-17)

**Why.**

- [fact] On 2026-11-17 the owner asked whether `render(k: vec4, size: u32): array<f32>` can
  replace the `out` parameter of `examples/loop-kernel.shade.ts`. At `main` `7513a9a` both halves
  refuse it with `TS8020`, whose sentence gives a target's reason: WGSL has no array whose length
  a call chooses. The owner: "안되는건 사실 말이 안되죠? typeshade 는 typescript 와 같은 계열의
  언어인데".
- [fact] OD-9 says that a target's lack of a form is no reason to refuse it.
- [fact] The agent first drafted the change as its own proposal, 0143 (pull request #1351,
  revisions 1 to 5). That draft missed this proposal and plan unit B8
  (`docs/typeshade-plan.md`: "`new Float32Array(n)` and `new Array(n)` with `n` known when the
  call runs"). Proposal 0100, decision D4, puts each unit of an area in one proposal, as one
  stage. So the change is this amendment, and draft 0143 is withdrawn unmerged. Its number is
  not reused.
- [fact] Baseline: `main` at `7513a9a` (merge of pull request #1350).

**The owner's decisions.**

- [decision, owner, 2026-11-17] The spelling: the spellings of this proposal (`T[]`,
  `new Float32Array(n)`, `new Array(n).fill(v)`), "좋아요", after the owner asked how
  TypeScript writes it. The owner had first chosen `array<T>(n)`, the same day, among options
  that did not show this proposal. That choice, its Rule 9.2 exception and `array.of(x)` are
  withdrawn.
- [decision, owner, 2026-11-17] The result's host value: the value a kernel's array parameter
  takes (Rule 8.21), "네".
- [decision, owner, 2026-11-17] The form of the change: stage S5 of this proposal, not a
  proposal of its own. The storage: the host call allocates a binding for the new array, as it
  binds an array parameter, first. When the arena exists (plan units A1 and A2), the storage
  moves to a region of the arena reserved for the call. The owner: "권도안대로", to these two
  recommendations.
- [fact] The change rests on OD-1 (TypeScript's way of writing), OD-3 (the compiler allocates;
  the author states only the length), OD-5 (each constructor keeps its JavaScript meaning; a
  returned array is the caller's), OD-7 (an integer literal takes the type its use needs) and
  OD-9. It reverses no entry.

**One example, before and after.**

Before, with proposal 0142 stage 1 (#1324, which removes `@inout`) and S1 (#934, `T[]`), the
result is a parameter:

```ts
export function render(k: vec4, size: u32, out: f32[]) {
  for (let i: u32 = 0; i < size * size; i++) {
    const p = vec2(f32(i % size), f32(i / size)) / f32(size);
    out[i] = height(p, k);
  }
}

// host
const img = new Float32Array(512 * 512);
await render(k, 512, img);
```

After S5, the author may also write it as a result. The parameter form stays.

```ts
export function render(k: vec4, size: u32): f32[] {
  const out = new Float32Array(size * size);
  for (let i: u32 = 0; i < size * size; i++) {
    const p = vec2(f32(i % size), f32(i / size)) / f32(size);
    out[i] = height(p, k);
  }
  return out;
}

// host
const img: Float32Array = await render(k, 512);
```

**S5. An array whose length a kernel function's arguments give (plan unit B8).**

S2 builds an array with a constant length. S5 takes S2's constructors where the length is no
constant, in one place: a kernel function that returns the array. It adds no spelling.

1. Rule 8.22: a kernel function is also an exported function whose result is an array with no
   size (`T[]`, or `array<T>` until S4), with `T` a type a kernel's array parameter may hold.
2. Rule 8.23: the function makes one array, with one of S2's constructors and a length `n` that
   item 4 admits:
   - `new Float32Array(n)`: `n` zeros of `f32`, as in JavaScript;
   - `new Array(n).fill(v)`: `n` copies of `v`, for any `v` a kernel's array may hold. The
     element type is the type of `v`, as S2 gives it.

   `Int32Array`, `Uint32Array` and `Float64Array` join when plan unit B2 lands, in the same
   position. Until then they are refused as S2 refuses them.

3. Rule 8.23: the array is a `const` at the top level of the body, before the first candidate
   loop. In a function with no loop (Rule 8.22, decision D7 of change 0142), it comes before the
   first store.
4. Rule 8.23: `n` is a `u32` or an `i32` (OD-7). It reads only these operands, which the host
   evaluates before the dispatch:
   - a scalar value parameter, a component of a vector parameter, a field of a struct parameter;
   - a module constant;
   - the `.length` of an array parameter;
   - an integer literal, and `u32(…)` and `i32(…)` of a listed operand;
   - a top-level `const` of the function whose initializer reads only listed operands;
   - integer `+`, `-`, `*`, `/`, `%`, `min` and `max`, with the program's arithmetic: `size *
size` of two `u32`s wraps as a `u32` does, and `/` and `%` by zero follow WGSL's integer
     rules.
5. Rule 8.22's body shape: the new array is one of the function's arrays. Its loops read and
   write it. A store after the last loop stores into it. The function ends with `return out` on
   every path. `out.length` reads `n` on every tier.
6. Rule 8.21, a call with plain data: the result's host value is the value a kernel's array
   parameter takes: the scalar's typed array, a vector's components one after another, an array
   of objects for a struct. A struct element is laid out as proposal 0082 lays out a parameter.
   The host view gives one type: `Promise<Float32Array>` for `f32[]` and `vec4f[]`,
   `Promise<T[]>` for a struct `T`. The caller owns the result.
7. Rule 8.21, a call on a resource: the result is a new `Buffer` on the call's device, of the
   scalar for a scalar or vector element, or a `Buffer<C>` for an element of an exported class
   `C`. The caller owns it and disposes it (Rule 11.8).
8. Every tier treats the new array as an array parameter of `n` elements, with that tier's
   limit: WebGPU (a storage binding), WebGL2 (the data texture of 2048 columns,
   `src/core/host-kernel-gl.ts`, `MAX_W`), the WebAssembly tier (proposal 0042) and the
   JavaScript CPU tier (a typed array). A negative `n` throws a `RangeError` that names the
   function and the length before anything runs, as JavaScript's constructors throw one. For
   `n = 0` the result is empty, and the call binds one element in its place.
9. Indices past the end: the call makes every check against `n` that it makes for an array
   parameter, reads included (`a*i + c` with its guards, strides `i*k + b`, rows `i*W + x`). A
   failed check throws the `TypeError` that the parameter form throws for an array too short,
   before anything runs. The sentence names the function, the result and both numbers. A loop
   whose range the device holds drops such a write, as for a parameter (change 0094). A store
   after the loops past the end is dropped, as for a parameter, not refused.
10. Refused as "not supported yet" (OD-9) in both halves, with `TS8099` and a sentence that names
    the form:
    - one of these constructors with a length that is no constant anywhere else: in a helper, in
      an entry, inside a loop, under a branch;
    - a length that reads an operand item 4 does not list;
    - `Array.from({ length: n }, f)` with a length that is no constant;
    - a second new array, or a new array the function does not return;
    - one path that returns a parameter (`return ps`, change 0142, Table 2) and another that
      returns the new array;
    - `out.push(v)`, a second name for `out` (`const o = out`), and `out` passed to a helper;
    - a kernel function that has a 2D storage texture and makes an array;
    - the result passed to another call inside one fusion (Rule 11.13), until the fusion facts
      describe it.
11. Kept: `new Array(n)` with no `fill` stays `TS8035` (surface §7, the `new` row), since
    JavaScript gives an array of holes, which a shader value cannot hold. A result of an array
    with no size that is no new array, and a struct whose last field is one, stay `TS8020`.

**What S5 needs of S2.**

- `fill` gives back the array it fills, as ECMAScript's `Array.prototype.fill` does. Today it
  gives nothing (change 0079; the `fill` sentence under Rule 8.18; surface §63). S2 needs the
  same for `new Array(N).fill(v)`, so S2 changes the sentence and §63, and S5 uses it.
- [fact] S2 names `Float32Array` and `Array.from`, but this proposal predates the `names` field.
  This amendment declares them in `names`, so that S2's implementation passes
  `scripts/changes.ts` (`changes/README.md`, The front matter). `Array` and
  `Array.prototype.fill` are listed in `src/__api__/author-names.md` already.

**The editor (Rule 12.7).**

- [proposal] The ambient library declares S2's constructors with the length as a type
  parameter, so a literal length gives the sized type and any other length gives the unsized
  one. A sketch, for the implementing pull request to fix:
  `new <N extends number>(length: N): array<f32, N>`. With `N` a `u32`, `array<f32, N>` is the
  ambient library's unsized `array<f32>`, whose `length` is a `u32`
  (`src/language-service/ambient.ts`, `type array<T, N>`).
- In a `"use typeshade"` file, `new Float32Array(n)` is the shader array `f32[]`. On the host
  side of a call it is the JavaScript `Float32Array` (item 6). These are two positions of one
  name, as Rule 8.21 already gives a kernel's array parameter.
- The editor cannot refuse an `f32` length by type alone, since the brands are optional. The
  compiler checks the length's type and reports `TS8003`, and the editor reports the compiler's
  code and sentence.
- `out` is a `T[]`: its index reads a `T`, its `.length` is a `u32`, and its hover shows `f32[]`.
- Each refusal of item 10 reaches the editor with the compiler's code and sentence.
- The test asserts both halves on the example above with `bothTake`
  (`src/core/testing/both-halves.ts`): `compile()` gives no diagnostic, the language service
  gives none, and `getHover` on `out` shows `f32[]`. Each refusal is a `bothRefuse` case.

**Costs of the owner's decisions.**

- S5 waits for S1 (`T[]`), S2 (the constructors and `fill`'s result) and proposal 0142 stage 1
  (#1324). All edit the same rules and the same array code.
- `Float32Array` spells `f32` only until B2. A vector array is `new Array(n).fill(vec4f())`.
- A vector array comes back flat (`vec4f[]` is a `Float32Array` of `4n` scalars), as a
  parameter takes it.
- A write past the end is refused before the run for a parameter and for the result alike
  (item 9). WGSL's robust access, which may clamp, is not relied on.
- The first implementation allocates a binding for each call's new array. The arena (A1, A2)
  will reserve a region of one buffer instead. The author's program does not change.

**Related accepted proposals.**

- Change 0079, deferred item 3(a): `return xs.map(f)`, a method whose result the call makes on
  the host. S5 is the first form of a kernel function that makes a new array; 3(a) stays
  deferred and can build on S5.
- Change 0082: a struct element of the new array takes the layout a parameter takes.
- Change 0042: the WebAssembly tier holds the result as the other tiers do (item 8).
- Change 0094: a loop whose range the device holds drops a write past the end (item 9).
- Change 0142: Table 2's `return ps` stays. S5 adds a second kind of returned array.

**What S5 touches.**

- Rule 8.18 (the `fill` sentence, through S2), Rules 8.21, 8.22 and 8.23, and Rule 11.13.
- Surface §20 (a local array with no size), §63 (`fill`'s result), §64 (the host call's result)
  and §65 (the kernel loop).
- `exports`: none declared. A kernel function's `face` (a `KernelFace` of `HostExport`) gains the
  length expression, which the host call evaluates. `src/__api__/surface.md` prints `HostExport`
  with `face: KernelFace` only. If the bake shows the change, the implementing pull request
  amends this entry first.
- `codes`: none. The refusals use `TS8099`, `TS8003`, `TS8035` and `TS8020`.
- `examples`: none added or removed. `loop-kernel` may gain the result form.
- `docs/typeshade-plan.md`: unit B8 names this stage and the storage decision.

**Status.**

- S5: not started. Its prerequisites are S1 (#934, draft), S2 (not started) and proposal 0142
  stage 1 (#1324, draft).
- The interim text of `TS8020` ("not supported yet", OD-9) is a bug fix in its own pull request.
  Not started.

- Affects: the front matter (`rules` gains 8.18, 8.21, 8.22, 8.23 and 11.13; `surface` gains 64
  and 65; `names` lists `Float32Array` and `Array.from`), section 2 (stage S5) and section 3 (unit
  B8).
- Status: `status: accepted` does not change.

## What it owes downstream

- **typeshade.github.io:** every page that spells `array<T>`, `array<T, N>(...)`, `fill<T, N>(v)`
  or `storage<T, "read_write">`, at the stage that changes it. Not searched from this session.
- **vscode-typeshade:** the completions, snippets and skill text that suggest those spellings.
  Not searched from this session.
