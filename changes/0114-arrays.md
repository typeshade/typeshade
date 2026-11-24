---
id: '0114'
title: An array is written as TypeScript writes it, T[] when the size is unknown and from its value when it is known, array<T, N> stays the one sized type, and a storage binding's access follows from what the program does
status: accepted
rules:
  - '4.5'
  - '5.1'
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
  - 9
  - 14
  - 18
  - 20
  - 23
  - 26
  - 28
  - 63
  - 64
  - 65
  - 71
  - 76
exports: []
exports-removed: []
codes: []
examples: []
names:
  - Float32Array
  - Array.from
  - ReadonlyArray
downstream:
  - repo: typeshade.github.io
    what: The guide pages and rule pages that spell `array<T>`, `array<T, N>(...)`, `fill<T, N>(v)` and `storage<T, "read_write">` are written again in the new spellings at each stage that changes them; the Korean translations of Rules 6.1 and 6.2 follow.
  - repo: vscode-typeshade
    what: The completions, snippets and the skill text that suggest `array<T>`, the `array(...)` constructor, `fill` or the `"read_write"` argument are changed at each stage that changes them.
---

<!-- doc-refs: skip-file — a draft proposal names rules and sections it will add -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0114, `status: accepted`, approved by the owner on 2026-11-02 (decisions D1 to D4 as recommended). The front matter is the identity and lifecycle authority. No implementation exists.                                                                                                                                                                                                                             |
| Date and attribution          | Authored 2026-11-02, UTC, by a Claude Code agent. The date is the authorship date, not an approval date.                                                                                                                                                                                                                                                                                                                    |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-02, in Korean. The owner asked whether `T[]` can replace `array<T>`, whether `array<T, N>` should be replaced by `Array<T, N>` or by a type of TypeShade's own, and how `readonly T[]` fits. The owner approved the direction this draft records ("승인").                                                                                                         |
| Applicability / effectivity   | `docs/language-design.md` (Rules 4.5, 6.1, 6.2, 9.6; Amendment A1: 8.18, 8.21, 8.22, 8.23, 11.13), `docs/use-typeshade-surface.md` (§1, §7, §14, §18, §20, §28, §63, §76; Amendment A1: §64, §65, §71), the host call (Amendment A1), `docs/typeshade-plan.md` (area B), the front end, the language service's ambient library, the binding reflection and the runtime's bind-group layout. No release version is assigned. |
| Review baseline               | `main` at `9afe73a` (2026-11-02).                                                                                                                                                                                                                                                                                                                                                                                           |
| Review and revision authority | Pull request [#880](https://github.com/typeshade/typeshade/pull/880) (branch `claude/proposal-0114-arrays`). Git records the revisions of this file; the merge of its pull request with `status: accepted` records the decision.                                                                                                                                                                                            |

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
  that did not show this proposal. The owner's later choice withdraws that choice, its Rule 9.2
  exception and `array.of(x)`.
- [decision, owner, 2026-11-17] The result's host value: the value a kernel's array parameter
  takes (Rule 8.21), "네".
- [decision, owner, 2026-11-17] The form of the change: stage S5 of this proposal, not a
  proposal of its own. The storage: the host call allocates a binding for the new array, as it
  binds an array parameter, first. When the arena exists (plan units A1 and A2), the storage
  moves to a region of the arena reserved for the call. The owner: "권도안대로", to these two
  recommendations.
- [inference, agent] The change rests on OD-1 (TypeScript's way of writing), OD-3 (the compiler allocates;
  the author states only the length), OD-5 (each constructor keeps its JavaScript meaning; a
  returned array is the caller's), OD-7 (a length takes the number type its value has) and
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
   loop. In a function with no loop (Rule 8.22, change 0094, decision D7), it comes before the
   first store.
4. Rule 8.23: `n` has any number type of the program: `u32`, `i32` or `f32` (OD-7). The host
   evaluates it before the dispatch, with the program's arithmetic. It reads only these
   operands:
   - a scalar value parameter, a component of a vector parameter, a field of a struct parameter;
   - a module constant;
   - the `.length` of an array parameter;
   - a number literal, and `u32(…)`, `i32(…)` and `f32(…)` of a listed operand;
   - a top-level `const` of the function whose initializer reads only listed operands;
   - `+`, `-`, `*`, `/`, `%`, `min` and `max`, with the program's arithmetic: `size * size` of
     two `u32`s wraps as a `u32` does, and `/` and `%` by zero follow WGSL's rules.

   A value of `n` that is negative or not an integer (an `f32` such as `2.5`) throws a
   `RangeError` that names the function and the length, before anything runs, as JavaScript's
   `new Float32Array(2.5)` and `new Array(-1)` throw one.

5. Rule 8.22's body shape: the new array is one of the function's arrays. Its constructor is
   its value at allocation, not a statement that writes it: zeros for `new Float32Array(n)`, `n`
   copies of `v` for `new Array(n).fill(v)`. So the sentence of Rule 8.22 that sends a function
   whose statements before a loop write an array to the CPU does not apply to it, and S5 edits
   that sentence to say so. Its loops read and write it. A store after the last loop stores into it. The function ends with `return out` on
   every path. `out.length` reads `n` on every tier.
6. Rule 8.21, a call with plain data: the result's host value is the value Rule 8.21 gives an
   array parameter of the same element type, in one form, not the parameter's union: the
   scalar's typed array for a scalar or vector element (a vector's components one after
   another), and an array of objects for a struct, laid out as change 0082 lays out a parameter.
   For example, the host view gives `Promise<Float32Array>` for `f32[]` and `vec4f[]`,
   `Promise<Int32Array>` for `i32[]`, and `Promise<T[]>` for a struct `T`. The implementing pull
   request lists the form of each element type Rule 8.21 admits. The caller owns the result.
7. Rule 8.21, a call on a resource: the result is a new `Buffer` on the call's device, of the
   scalar for a scalar or vector element, or a `Buffer<C>` for an element of an exported class
   `C`, as Rule 8.21 and change 0138 (Amendment A10, Q-C; Amendment A11, Q-I) give for a
   parameter. The caller owns it and disposes it (Rule 11.8). Rule 11.8 admits no `Buffer` of
   length 0, so a call on a resource with `n = 0` throws a `RangeError` that says a `Buffer` of
   length 0 is not supported yet (open item 1).
8. Every tier treats the new array as an array parameter of `n` elements, with that tier's
   limit, and past the limit does what it does for such a parameter: WebGPU (a storage binding), WebGL2 (the data texture of 2048 columns,
   `src/core/host-kernel-gl.ts`, `MAX_W`), the WebAssembly tier (proposal 0042) and the
   JavaScript CPU tier (a typed array). For a call with plain data and `n = 0`, the result is
   empty, and the call binds one element in its place.
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
11. `new Array(n)` with no `fill` gives an array of holes in JavaScript. The compiler has no
    representation of a hole yet (change 0093 represents an optional value, not a hole). So it
    is refused as "not supported yet" with `TS8099`, in place of today's `TS8035`, for a
    constant length in S2 and for any length in S5. A result of an array with no size that is no
    new array, and a struct whose last field is one, stay `TS8020` (with its interim text, below).

12. The representation is the compiler's (OD-9). The program says what the new array means; the
    emitted code need not hold it as one WGSL or GLSL object. A binding of its own, a region of
    the arena, a capacity of at least `n` reused across calls, a kernel specialized for a length
    the compiler chooses, or any other code with the same result is allowed, as change 0080
    chooses how a `Map` or a `Set` is held. The first implementation uses a binding of its own
    (the owner's decision above). No choice changes the program, its result, or what the host
    view declares.

    [decision, owner, 2026-11-17] Asked whether the storage or the compiled kernel must match
    the array one to one, the owner said that it is the compiled side that need not: "언어랑
    매칭이 1:1 로 꼭 TS -> WGSL , TS -> GLSL 이렇게 가는건 맞는데 무조건 1:1로 매칭될 필요는
    없다는거예요 … map 이라던가, set 같은 구현체라던가 그런거 얘기하는거예요". [inference,
    agent] This is OD-9 applied to S5, not a new entry.

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
- An `f32` length is accepted (item 4), so neither half refuses a length for its type.
- `out` is a `T[]`: its index reads a `T`, and its `.length` is a `u32`. Its hover shows the
  same type text as the hover on an array parameter `out: f32[]`.
- Each refusal of item 10 reaches the editor with the compiler's code and sentence.
- The test asserts both halves on the example above with `bothTake`
  (`src/core/testing/both-halves.ts`): `compile()` gives no diagnostic, the language service
  gives none, and `getHover` on `out` equals `getHover` on `out` in the parameter form. Each refusal is a `bothRefuse` case.

**Costs of the owner's decisions.**

- S5 waits for S1 (`T[]`), S2 (the constructors and `fill`'s result) and proposal 0142 stage 1
  (#1324). All edit the same rules and the same array code.
- `Float32Array` spells `f32` only until B2. A vector array is `new Array(n).fill(vec4f())`.
- A vector array comes back flat (`vec4f[]` is a `Float32Array` of `4n` scalars), as a
  parameter takes it.
- A write past the end is checked before the run where the range is known, and dropped where
  the device holds the range or the store follows the loops, for a parameter and for the result
  alike (item 9). WGSL's robust access, which may clamp, is not relied on.
- A call on a resource with `n = 0` throws, since no `Buffer` of length 0 exists (item 7).
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
- Change 0138: Amendment A10, Q-C (a call on a resource returns a `Buffer`, and another call
  takes it as an argument) and Amendment A11, Q-I (a `Buffer` of the scalars) are what item 7
  rests on. Surface §7 refuses `return xs` until 0138's slice 3; Amendment A19 moves that to
  change 0142 stage 1.
- Change 0093: an optional value, which is no hole (item 11).

**What S5 touches.**

- Rule 8.18 (the `fill` sentence, through S2), Rule 8.21, Rule 8.22 (the kind, the body shape,
  and the sentence on writes before a loop), Rule 8.23, and Rule 11.13.
- Surface §7 (the `new Array(n)` row), §20 ("The length of a runtime-sized storage array", which
  refuses a local that holds one), §63 (`fill`'s result), §64 (the host call's result), §65
  (the kernel loop) and §71 (the refusal inside `fuse`).
- `exports`: none declared. A kernel function's `face` (a `KernelFace` of `HostExport`) gains the
  length expression, which the host call evaluates. `src/__api__/surface.md` prints `HostExport`
  with `face: KernelFace` only. If the bake shows the change, the implementing pull request
  amends this entry first.
- `codes`: none. The refusals use `TS8099` and `TS8020`.
- `examples`: none added or removed. `loop-kernel` may gain the result form.
- `docs/typeshade-plan.md`: unit B8 names this stage and the storage decision. A new unit,
  B8b, carries the forms item 10 refuses (a new array in a helper, in an entry, or as a local
  that is not returned), on the arena (A2).

**Status.**

- S5: not started. Its prerequisites are S1 (#934, draft), S2 (not started) and proposal 0142
  stage 1 (#1324, draft).
- The interim text of `TS8020` ("not supported yet", OD-9) is a bug fix in its own pull request.
  Not started.

**Open, owner must settle.**

1. A `Buffer` of length 0. Item 7 throws for `n = 0` on a resource, since Rule 11.8 admits
   lengths 1 to 4294967295. If the owner wants an empty `Buffer`, Rule 11.8 changes in its own
   amendment of change 0138. Until then, the throw is "not supported yet" (OD-9).

**Independent review record.**

- 2026-11-17, an AI agent (Claude Code) that did not write the amendment reviewed `d333fa6`
  against `docs/owner-decisions.md`, the accepted proposals on arrays and kernel functions, and
  the code at `main` `7513a9a`. It ran `bun scripts/changes.ts`, `src/changes.test.ts` (39
  passed) and both halves on the refused form. Twelve findings, none blocking. It found that
  no entry of OD-1 to OD-9 is reversed.
- Answers, in the next commit: (1) D7 is change 0094's; (2) the constructor is the value at
  allocation, and S5 edits Rule 8.22's sentence on writes before a loop (item 5); (3) the costs
  agree with item 9; (4) `n = 0` on a resource throws, open item 1; (5) the hover equals the
  parameter form's; (6) `new Array(n)` with no `fill` is "not supported yet", and an `f32`
  length is accepted with JavaScript's `RangeError` (items 4 and 11); (7) plan unit B8b carries
  the refused forms, and B8's dependencies name 0142 stage 1; (8) change 0138 and §71 are cited;
  (9) past a tier's limit, the call does what it does for a parameter (item 8); (10) item 6
  gives the rule for each element type; (11) the record names S2, §20's heading and the
  document control; (12) labels, actor, code span, and this record.

- Affects: the front matter (`rules` gains 8.18, 8.21, 8.22, 8.23 and 11.13; `surface` gains 64
  and 65 and 71; `names` lists `Float32Array` and `Array.from`), the document control's
  applicability, section 2 (stage S5, and S2's obligation that `fill` gives its array back), and
  section 3 (units B8 and B8b).
- Status: `status: accepted` does not change.

### A2. S1 names `ReadonlyArray` (2026-11-18)

- [fact] Why. S1 accepts `readonly T[]` and `ReadonlyArray<T>` (section 2). Pull request #1367
  (merged as `74e7f05`) delivered `T[]` and `Array<T>` and left both `readonly` spellings out.
  For the editor to refuse a write through them, the ambient library must declare
  `ReadonlyArray<T>`; without it, TypeScript reads `readonly T[]` as a plain `Array<T>`.
  `ReadonlyArray` is not in `src/__api__/author-names.md`, and this proposal's `names` did not
  list it, so `scripts/changes.ts` refuses the implementation (`changes/README.md`, The front
  matter).
- [fact] `readonly T[]` adds no name: `readonly` is TypeScript's type operator, and the array
  type it applies to is `ReadonlyArray<T>`.
- [fact] Rule 2.1: `ReadonlyArray` is ECMAScript's library type as TypeScript spells it.
- [decision, owner, 2026-11-18] "추천대로", to the agent's recommendation to list `ReadonlyArray`
  in `names` before S1's second pull request.
- Affects: the front matter (`names` gains `ReadonlyArray`). No rule, surface section, code or
  stage changes.
- Status: `status: accepted` does not change. S1 is in progress: `T[]` and `Array<T>` are done
  (#1367); `readonly T[]`, `ReadonlyArray<T>` and the write refusal are not started.

### A3. An untyped list of integer-written numbers takes its element type from its uses (2026-11-18)

- [fact] Why. S2a (pull request #1372, merged as `d8cf58e`) gives an untyped list its element
  type from its elements. A list of integer-written numbers alone (`const a = [1, 2, 3]`) has no
  element that decides a type, and Rule 5.1 does not name a list among the values its uses
  decide. So #1372 kept the old refusal: `"const a" needs an array type annotation to take a
list, e.g. const a: array<f32, 3> = [...].` Fixing the element type to `f32` would choose a
  default type, which OD-7 rules out.
- [fact] Rule 5.1 already gives an unannotated function-local `let`, module variable, static
  field and class field initialized by integer-written literals the type of every place it
  reaches, and `f32` where no use decides, as the compiler's choice (OD-7).
- [decision, owner, 2026-11-18] "승인", to the agent's recommendation: amend this proposal to
  extend Rule 5.1 to such a list, and, until it is implemented, say "not supported yet" in the
  refusal (OD-9).

**S2c. A list of integer-written numbers (plan unit B5).**

1. Rule 5.1: an unannotated `const` or `let`, in a function or at module scope, whose initializer
   is a list of integer-written literals (and `+`, `-`, `*` and `/` over them) is a value whose
   uses decide its element type. Each element read (`a[i]`) and each whole use of the array (an
   argument of a declared `array<T, N>` parameter, an assignment to a typed array, a `return` in a
   function whose result type is declared, `for (const x of a)`) is a place the element type
   reaches, as Rule 5.1 lists for a `let`. Where no use decides, the element type is `f32`, the
   compiler's choice. The length is the number of elements, as in S2.
2. A use that asks `i32` and one that asks `u32`, and an integer use beside a float use, are
   refused as Rule 5.1 refuses them for a `let`, with the annotation remedy
   (`const a: array<u32, 3> = [...]`).
3. A `/` over an element whose uses make it an integer is refused as Rule 5.1 refuses the `/`
   over a `let` that its uses make an integer.
4. Both halves: the editor's projection writes the decided type into the declaration, so the hover
   shows `const a: array<u32, 3>` where an index use decides `u32`.
5. Until S2c is implemented, the refusal says the form is not supported yet: `"const a" is a list
of integer-written numbers, whose element type its uses will decide; that is not supported
yet. Declare the type: const a: array<f32, 3> = [...].` (a bug fix under OD-9, in its own
   pull request).

- [fact] D2 (`[1, 2.5]`, refused until #148 settles the integer default) is not changed by this
  amendment. #148's question was superseded by change 0134 and OD-7; whether D2's refusal stays
  is the owner's to decide, as an open item.
- [fact] A function-local `as const` list stays refused (S2 names module scope only); open item.
- Affects: the front matter (`rules` gains 5.1), section 2 (stage S2c).
- Status: `status: accepted` does not change. S2c: not started.

### A4. S2b names surface §26 (2026-11-18)

- [fact] Why. A1 item 11 makes `new Array(n)` with no `fill` "not supported yet" (`TS8099`) in
  place of `TS8035`. S2b (pull request #1375) implements it. Surface §26's table of `new` targets
  still lists `new Array(4)` as `TS8035`, and §26 was not in this proposal's `surface`, so
  `scripts/changes.ts` refused the edit and `SURF-026` stays suspect.
- [decision, owner, 2026-11-18] "승인", to the agent's recommendation to add §26 to `surface` in
  its own pull request before #1375 edits it.
- Affects: the front matter (`surface` gains 26). No rule, code or stage changes.
- Status: `status: accepted` does not change.

### A5. The deviations of S5 slice 1 (2026-11-18)

- [fact] Why. S5 slice 1 (pull request #1379, merged as `fad9fce`) differs from A1 in two
  places, both recorded on #1379 as open deviations.
- [decision, owner, 2026-11-18] "승인", to the agent's recommendation to make both part of the
  approved text. Both are "not supported yet" refusals (OD-9).

**1. A call inside `fuse()`.** A1 item 10 refuses, in both halves, the result passed to another
call inside one fusion (Rule 11.13). A `fuse()` body is host code, which neither the compiler nor
the language service reads, so no compile-time refusal can see it. Amended: a call of a kernel
function that makes its result, made inside `fuse()`, throws a `TypeError` at the call:
`render(): returns the array it makes, "out", and a call inside fuse() that makes its result is
not supported yet. Call render() outside fuse().` Its face carries no fusion facts (Rule 11.13;
surface §71).

**2. Two more refusals.** Beyond the forms item 10 lists, slice 1 refuses as "not supported yet"
(`TS8099`), in both halves:

- a fill value (`new Array(n).fill(v)`) that reads an operand item 4 does not list;
- a use of the new array other than an element read or write, `.length` and `return`, array
  methods included.

Each stays refused until a later slice implements it.

- [fact] The third deviation recorded on #1379, `out.length` reading 1 when `n = 0`, was fixed
  before the merge (`26e5b90f`): the body reads the length the host computed (A1 item 5).
- Affects: section 2 (S5 items 10 and 11). No front-matter entry, rule number or code changes.
- Status: `status: accepted` does not change. S5: slice 1 done (#1379); slice 2 (vector and
  struct elements, a call on a resource, the WebGL2 and WebAssembly tiers) not started; plan unit
  B8b not started.

### A6. Stage S5d: a kernel function returns an array it grows with `push` (2026-11-18)

- [fact] Why. The owner asked on 2026-11-18 whether a kernel function can start an empty array,
  `push` into it in a loop and return it. A1 item 10 refuses `out.push(v)` on the array a kernel
  function makes. The same day the owner recorded OD-10: TypeShade supports dynamic arrays, and
  the compiler handles their storage, at compile time where it can and with a heap it manages at
  run time where it cannot.
- [fact] Change 0078 already lets a loop push onto a kernel function's array parameter: it starts
  empty (or at a held length, change 0094), and the pushes append in the order a sequential run
  makes them, on every tier (Rule 8.23).
- [decision, owner, 2026-11-18] OD-10 and its "승인"; this amendment applies OD-10 to S5.

**S5d. An array the function grows (plan unit B8).**

```ts
export function render(k: vec4, size: u32): f32[] {
  const out: f32[] = [];
  for (let i: u32 = 0; i < size * size; i++) {
    out.push(height(p(i, size), k));
  }
  return out;
}
const img: Float32Array = await render(k, 512);
```

1. Rule 8.23: an exported kernel function may declare one `const` at the top level of its body,
   before its first candidate loop, initialized by an empty list and annotated with an array type
   with no size (`const out: f32[] = []`), push onto it inside its candidate loops, and return it on
   every path (A1 items 3 and 5 hold as for a made array).
2. The capacity is the compiler's (OD-3, OD-10). Where every push is inside counted loops whose
   trip counts read only the operands A1 item 4 lists, the compiler computes the most elements the
   pushes can append, the sum over the loops of the trip count times the pushes in one iteration,
   and the host call reserves that many before the dispatch. A conditional push counts as one.
3. The pushes append as change 0078 gives them, in the order of a sequential run, on every tier.
   The result is the elements pushed, in that order: its length is the number pushed, which may be
   less than the capacity, and `out.length` in the body reads the number pushed so far.
4. The result's host value and its ownership are those of A1 items 6 and 7.
5. Where the capacity cannot be computed at compile time (a push in a loop whose range the device
   holds, a `while`, a loop that is not counted, a trip count that reads an unlisted operand), the
   form waits for the heap OD-10 names (plan units A1 to A3) and is refused until then as "not
   supported yet" (`TS8099`), naming the loop.
6. A1's other refusals of item 10 still apply to `out`, except `out.push(v)` inside a candidate
   loop. A push outside every loop is refused as "not supported yet".
7. Both halves: the editor's ambient `Array<T>` already declares `push`; the compiler reports each
   refusal with the editor showing the same code and sentence.

- Affects: section 2 (stage S5d), Rule 8.23 (when implemented). No front-matter entry changes:
  Rule 8.23 and surface §65 are declared.
- Status: `status: accepted` does not change. S5d: not started.

### A7. The deviations of S5d (2026-11-18)

- [fact] Why. S5d (pull request #1385, merged as `9aa51e4`) differs from A6 in three places, each
  recorded on #1385 as an open deviation.
- [decision, owner, 2026-11-23] "승인", to the agent's recommendation to make all three part of
  the approved text. Each is a "not supported yet" refusal (`TS8099`, both halves; OD-9), to be
  implemented in a later slice.

1. **An element read or write of the grown array.** A6 item 1 carried over A1 item 5 ("its loops
   read and write it"). JavaScript extends an array on a write past its length, and the number
   pushed is known only after the run, so `out[i]` on an array the function grows is refused:
   `"out[0]" reads an element of "out", the array "f" grows with push, and that is not supported
yet. Push onto it in a loop, read its length, and return it.`
2. **A push in a loop inside a loop.** A6 names the candidate loops, the `for` and `for…of`
   loops at the top level of the body (Rule 8.22). A push in a loop nested in one, in a `while`
   or in a loop under a branch is refused: `"out.push(1.)" pushes onto "out" inside "<loop>",
which is no for loop at the top level of "f", and that is not supported yet. …`
3. **A loop with an `f32` counter.** Its trip count is no count from a start to a bound by a
   constant whole step, so the capacity cannot be computed; it is refused with A6 item 5's
   sentence for a loop that is not counted.

- Affects: section 2 (S5d items 1 and 5). No front-matter entry, rule number or code changes.
- Status: `status: accepted` does not change. S5d: done (#1385), with these three forms open.

### A8. The deviations of S5 slice 2, first part, and a struct fill that shares one object (2026-11-23)

- [fact] Why. The first part of S5 slice 2 (pull request #1404) makes a kernel function return an
  array of vectors or structs. It differs from A1 and A5 in three places, each recorded on #1404
  as an open deviation. Its review also found that A1 item 2's "`n` copies of `v`" differs from
  JavaScript when `v` is a struct.
- [decision, owner, 2026-11-23] The agent recommended an amendment that makes the three
  deviations part of the approved text, and the owner chose it ("0114 A8 수정안으로 기록").
- [decision, owner, 2026-11-23] For a struct fill, the agent recommended a "not supported yet"
  refusal. The owner chose instead "JS처럼 공유 구현": the result shares one object as
  JavaScript's `fill` does (OD-5).

**1. More fill values.** A5 item 2 refuses a fill value that reads an operand A1 item 4 does not
list. Amended: the fill value may also be a vector or a struct built of listed operands
(`vec4f()`, `vec4f(s, 0, 0, 1)`, `{ a: s, c: 3 }`), or a whole vector or struct value parameter.
A class constructor call stays refused as an unlisted operand ("not supported yet", `TS8099`,
OD-9).

**2. Elements that stay refused.** A1 item 1 admits any element a kernel's array parameter may
hold. Amended: a matrix, a `bool`, a key and an `f64` element, and a struct that holds one, stay
refused with `TS8099` ("not supported yet", OD-9) until a later slice. A field write into an
element of a struct array made by `fill` stays refused by change 0142, stage 3.

**3. Two messages.** The `TS8099` text for a refused element and for a refused fill operand
change their wording to name the new forms. No code changes (Rule 12.5).

**4. A struct fill shares one object (OD-5).** A1 item 2 is amended for a struct element:
`new Array(n).fill(v)` gives `n` references to one object, as JavaScript's `fill` does.

- [proposal] An element that the run writes as a whole (`out[i] = w`) refers to its own object
  after the write. Every element that the run does not write refers to the one object of `v`.
- [proposal] So in the host's `Promise<T[]>` the elements that the run did not write are one
  object: `r[0] === r[1]` when the run wrote neither, and a write to `r[0].a` on the host shows
  in `r[1]`. The elements that the run wrote are each their own object.
- [proposal] The compiler finds which elements the run writes. Where it cannot prove that every
  element is written, the kernel records a written mark for each element, and the host builds the
  shared object once. A vector element is a value (OD-5), so a vector fill has no sharing.
- [proposal] A push of a struct (S5d) follows the same rule: two pushes of one object, such as a
  `const` struct declared before the loop, give two references to one object on the host. Where
  the compiler cannot decide whether two pushes push one object, the push is refused as "not
  supported yet" (`TS8099`, OD-9) until it can.
- Cost: one mark for each element where the compiler cannot prove every element written, and a
  pass on the host over the marks.

- Affects: section 2 (S5 items 1, 2 and 10; S5d item 1). No front-matter entry, rule number or
  code changes. The text of Rules 8.21 and 8.23 follows in the implementing pull request.
- Status: `status: accepted` does not change. S5 slice 2: the first part is in progress (#1404),
  with item 4 of this amendment to be implemented there before it merges; a call on a resource,
  the WebGL2 tier and the WebAssembly tier are not started.

### A9. Two open deviations of A8 item 4 (2026-11-23)

- [fact] Why. The implementation of A8 item 4 (pull request #1404, merged as `68a4ca0`) refuses
  two groups of forms that A8's text does not list. Both are "not supported yet" refusals
  (`TS8099`, both halves; OD-9). Each keeps A8 item 4 and OD-5 true: no accepted form gives an
  object JavaScript would not give.
- [fact] This amendment records them. It decides nothing. Their disposition is open until the
  owner decides it.

1. **A whole write whose object may be in two elements.** A8 item 4 says an element written as a
   whole is its own object. When the written value may also be in another element, its own object
   would differ from JavaScript. So `out[i] = w`, where `w` is a parameter, another element or a
   `const` declared before the loop, is refused. `main` never accepted these forms.
2. **Pushes the compiler could decide.** A8 refuses a push only where the compiler cannot decide
   whether two pushes push one object. The implementation decides two cases: every push pushes a
   new object, or every push pushes one top-level `const` that only the pushes use. Every other
   case is refused, a mix of one object and new ones included. A written mark for each pushed
   element needs a change to the push lowering.

- Disposition: closed by A10 (the owner, 2026-11-23).
- Affects: section 2 (S5 item 2, S5d item 1). No front-matter entry, rule number or code changes.
- Status: `status: accepted` does not change. S5 slice 2: the first part is done (#1404); a call
  on a resource, the WebGL2 tier and the WebAssembly tier are not started.

### A10. The deviations of A9 and of a call on a resource, made part of the approved text (2026-11-23)

- [fact] Why. A9 records two open deviations of A8 item 4. The call on a resource of A1 item 7
  (pull request #1411, merged as `64593b0`) differs from A1 in five places, each recorded on #1411
  as an open deviation. All seven are "not supported yet" refusals (`TS8099` at compile time, or a
  throw at the call; both halves where a half can see them; OD-9).
- [decision, owner, 2026-11-23] For A9: the agent recommended making both refusals part of the
  approved text, and the owner chose it ("거부로 승인").
- [decision, owner, 2026-11-23] For #1411: the agent recommended making all five refusals part of
  the approved text, and the owner chose it ("다섯 모두 거부로 승인").

**1. A9 items 1 and 2.** Both refusals are part of the approved text: a whole write whose object
may also be in another element, and the pushes of a struct outside the two cases the compiler
decides. A9's disposition is closed.

**2. A call on a resource refuses, as "not supported yet":**

1. an array the function grows with `push` (S5d): its length is known only after the run, and a
   `Buffer`'s `length` is read at once (to be revisited after change 0144, stages A2 and A3);
2. a struct fill whose unwritten elements share one object (A8 item 4): what sharing means in a
   `Buffer<C>` is not yet decided;
3. a struct of no exported class: item 7 names only `Buffer<C>`, and change 0138, Amendment A11,
   gives such a parameter no `Buffer`;
4. a call that also writes a plain array: change 0138, Amendment A11, Q7 says such a call waits
   and gives plain data, and item 7 says the result is a `Buffer`; the owner decides which holds
   before it is implemented;
5. a length or a fill value that reads a resource argument: `n` must be known at the call, and
   such a value is read only when the call runs.

- [fact] Item 7 gives a vector element a `Buffer` of the scalar: `vec4f[]` gives a `Buffer<f32>`
  of `4n` elements (#1411).
- Affects: section 2 (S5 items 2 and 7, S5d item 1). No front-matter entry, rule number or code
  changes.
- Status: `status: accepted` does not change. S5 slice 2: vector and struct elements done (#1404);
  a call on a resource done (#1411), with these five forms refused; the WebGL2 tier and the
  WebAssembly tier not started.

### A11. Status of S5 slice 2 after the WebGL2 tier (2026-11-23)

- [fact] Pull request #1418 (merged as `75b3ea2`) runs a made array on each tier that would run
  an array parameter of the same element in its place (A1 item 8). On WebGL2 that is one loop that
  writes an `f32`, `i32` or `u32` element at `i`. A vector or struct element, an array grown with
  `push` (S5d), and a struct fill with written marks stay on the CPU tier, as their parameter
  forms do. No rule, surface section or code changes beyond what A1 item 8 declares.
- [fact] This amendment records status only. It decides nothing.
- Status: `status: accepted` does not change. S5 slice 2: vector and struct elements done (#1404);
  a call on a resource done (#1411), with A10's five forms refused; the WebGL2 tier done (#1418);
  the WebAssembly tier not started.

### A12. The forms A7 left refused: an element of a grown array, a push in a nested or open loop, and a loop with an `f32` counter (2026-11-23)

- [fact] Status of this amendment: draft. Questions Q1 and Q2 below are the owner's. The owner
  answered both on 2026-11-23 against the draft's text (section 9). Q2 is decided: (A). Q1 is
  open again, since the review corrected its costs and its recommendation. The merge of its pull
  request, after the owner's answer to Q1, is its acceptance.
- [fact] Q2 is decided (A). So the parts marked "with Q2 (B)" do not apply. They stay in the text
  as the record of the option the owner did not take.
- [fact] Baseline: `main` at `b1622981` (2026-11-23). The draft was written at `747e8637` and
  revised at the same commit after the independent review (record below). `src/` is the same at
  both commits.

**Why.**

- [fact] A7 made three forms of S5d part of the approved text as "not supported yet" refusals
  (`TS8099`, both halves; OD-9), "to be implemented in a later slice". This amendment designs that
  slice for each form. It gives the meaning, the storage, the dependencies, what stays refused,
  the tests and one example.
- [fact] OD-10 says that the compiler handles the storage of a dynamic array. At compile time it
  uses "a capacity it computes from the program, a second pass, or another form with the same
  result". Where compile time cannot decide it, it uses a heap it manages at run time. A form
  the compiler does not implement yet is "not supported yet", never impossible.
- [observed, 2026-11-23, `bothHalves` of `src/core/testing/both-halves.ts`, Bun 1.4.4, a tree
  equal to `b1622981`] Each form is accepted today on an array parameter (changes 0078 and 0094),
  whose host array is the capacity. The two halves agree on every row.

| Source                                                    | The grown array (`const out: T[] = []`) | The same loop on an array parameter                                                      |
| --------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| Example 1 below: `out[j] = out[j] / t` in a later loop    | `TS8099` (A7 item 1)                    | no diagnostic                                                                            |
| `out[0] = 2.` after the last loop                         | `TS8099` (A7 item 1)                    | no diagnostic (`s[0] = out[0]` after the loop)                                           |
| Example 2 below: a push in a loop inside a top-level loop | `TS8099` (A7 item 2)                    | no diagnostic                                                                            |
| A push in a `while` inside a top-level loop               | `TS8099` (A7 item 2)                    | no diagnostic                                                                            |
| A push in a top-level `while`                             | `TS8099` (A7 item 2)                    | `TS8070` warning: "This loop runs on the CPU because it is an open loop, …"              |
| A push in a loop under a branch                           | `TS8099` (A7 item 2)                    | `TS8070` warning: "This function runs on the CPU because line 2 is neither a loop nor …" |
| Example 3 below: a push in a loop with an `f32` counter   | `TS8099` (A7 item 3)                    | `TS8070` warning: "This loop runs on the CPU because it is an open loop, …"              |
| `out.push(f32(out.length))` in the loop that pushes       | `TS8070` warning, accepted              | `TS8070` warning, accepted                                                               |

- [observed, 2026-11-23, `lowerKernel` of `src/core/passes/kernel-lower.ts` on the parameter
  form, Bun 1.4.4, `747e8637`] No diagnostic does not mean WebGPU. The plans differ:

| Parameter form                                                                  | `lowerKernel`                                                                                                                |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Example 1 below                                                                 | a GPU plan                                                                                                                   |
| Example 1 with `const total = f32(out.length)` between the loops, and `/ total` | `noGpu`: `loop 2 writes "out", which the statements before it read, and each of its invocations runs those statements again` |
| Example 2 below                                                                 | a GPU plan                                                                                                                   |
| `ys[i] = ks[i] * 2; for (let j: u32 = 0; j < ys[i]; j++) { out.push(j); }`      | `noGpu`: `loop 1 pushes and reads back what it writes to "ys", which its counting step does not write`                       |
| a second loop `for (let j: u32 = 0; j < out.length; j++) { out.push(1.); }`     | `noGpu`: `it reads the length of an array it pushes onto before its result, which the call knows once the loop has run`      |

- [inference] So the parameter form already gives each of these loops its JavaScript order, on
  the tier that runs it (Rule 8.22, Rule 8.23). The grown array lacks two things only. It lacks
  a capacity that the call can reserve. It lacks a meaning for an index at or past its length.

**Terms.** [proposal] The amendment names three routes to the storage of a grown array.

| Route                    | What the compiler does                                                                                                         | OD-10                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| Route 1, the headers     | The host computes the capacity before the dispatch from the headers of the loops that push. A6 item 2 is Route 1's first case. | compile time: "a capacity"    |
| Route 2, a count pass    | The call counts the pushes first (change 0078's count and scan steps), reads the total, reserves it, then runs the store step. | compile time: "a second pass" |
| Route 3, growing storage | The storage grows while the run pushes.                                                                                        | the heap                      |

**1. Storage, for all three forms.** [proposal]

1. The compiler takes Route 1 where it can, then Route 2, then Route 3 (OD-10). The choice is
   the compiler's (OD-3, OD-9). No route changes the result, the host view or what the author
   writes. A1 item 12 holds: the representation is the compiler's.
2. Route 1 extends A6 item 2 to these cases:
   1. A nest of counted loops whose starts and bounds read only the operands A1 item 4 lists.
      Each push adds the product of the trip counts of every loop around it, at every depth.
      The capacity is the sum of that over the pushes. A push in the outer body counts once for
      each outer trip. A push in an inner body counts once for each inner trip of each outer
      trip. Today `pushesIn` (`src/compiler/ts/lower/made-array/capacity.ts`) counts an inner
      push once for each outer trip. The implementing pull request replaces it for a nest.
   2. A loop under a top-level branch whose condition reads only listed operands. The host
      evaluates the condition with the CPU tier's generated code, and counts the loop only when
      the branch is taken. A branch whose condition reads any other value: Route 3 (item 4).
      The loop never counts "as if the branch is taken". Such a count can run a header that
      the program never runs, as `if (h > 0)` around a loop that steps by `h` shows.
   3. Only with Q2 (B): a `for` loop that is not counted (an `f32` counter, a step `i *= 2`).
      Its initializer, condition and update read only listed operands and its own counter, and
      its body does not write the counter. The host runs the header alone, with the CPU tier's
      generated code, and counts the trips (section 4, items 1 and 2). With Q2 (A), Route 3
      serves these loops, and this item is not built (Q2).
   4. An element write that the compiler cannot prove below the length (section 2, item 2)
      counts as one push. It replaces an element or appends one. A write past the length is not
      supported (section 2, item 3).
3. Route 2 applies to a top-level loop when all of these hold:
   - the proof of Rule 8.22 accepts it, and the host knows its range;
   - Route 1 cannot bound its pushes, or Route 1's capacity passes the tier's limit (A1 item 8);
   - it meets the conditions of `pushGap` (`src/core/passes/kernel-lower.ts`). It pushes onto
     one array and adds to no `Map` or `Set`. It reduces nothing. It does not scatter or store
     into a texture. It does not read back what it writes to an array.

   Its cases are two. One is an inner loop whose header reads an element, a value of the iteration
   or an outer counter (Example 2). The other is an inner `while`.
   1. WebGPU: the call runs the count and scan steps of change 0078, reads back the total,
      reserves that many elements, and runs the store step.
   2. The CPU tier: it runs the same count step, which stores nothing but the counts, and then
      runs the loop as written. The conditions above make that count exact. A count step that
      stores nothing under-counts an iteration that reads back its own writes. It combines a
      reduction twice.
   3. Where two loops push, the call reserves before each store step. It keeps the elements that
      earlier loops stored. On WebGPU that can be a copy on the device.
   4. Cost: one more read from the device for each such loop. [inference] A call that takes
      Route 2 cannot be one submission of a fuse plan until change 0144, stage A3.
   5. Change 0144 rejected this design as its general memory contract ("Always read the size back
      first", its section "Alternatives"). That alternative paid a round trip on every call and
      broke a fuse plan's one submission. Route 2 is acceptable in the interim for three reasons:
      - it reads back only for a loop that Route 1 cannot bound, and no other call pays it;
      - these forms are refused today, so no call becomes slower;
      - a run region of change 0144, stage A3, replaces it with no change to the program
        (section 7).
   6. [assumption] The proof accepts these inner loops on a grown array as it accepts them on an
      array parameter (observed above). The implementing pull request confirms it.

4. Route 3 applies to every other loop that pushes onto a grown array. The closing rule is: a
   loop that pushes and that neither Route 1 nor Route 2 serves takes Route 3. Among them:
   - a top-level `while` or `do … while`, and a loop inside one;
   - a `for` that is not counted, whose body writes its counter or whose header reads another
     value, and every such `for` with Q2 (A);
   - a top-level counted loop that the proof rejects and that holds an inner `while`, or an
     inner loop whose header reads an element;
   - a loop that fails one of `pushGap`'s conditions (item 3);
   - a loop, or an inner `while`, under a top-level branch that item 2.2 does not count;
   - a later loop whose header reads `out.length` of the grown array and that pushes onto it.
   1. [inference] Each such loop runs on the CPU tier already, as for a parameter (Rule 8.22, R1
      or the proof's refusal; `TS8070`; or `lowerKernel`'s `noGpu`). Change 0144 does not change
      the proof, so no GPU tier runs these loops before or after it.
   2. When Route 3 lands is question Q2. Until it lands, each such loop stays refused with
      `TS8099` (sections 3 and 4).
5. The capacity is exact. [proposal]
   1. A trip count is a value of the program. It keeps the program's arithmetic, as A1 item 4
      gives a length.
   2. The capacity is the compiler's: the products and the sums of items 2.1 to 2.4. The host
      computes them exactly, in `f64` or `BigInt`, never in wrapping `u32` arithmetic. Each
      comparison of an `f64` capacity with 4294967295 is exact, since the rounding is monotone.
   3. The call checks the capacity, not the trips. Past 4294967295 it throws, before anything
      runs: `RangeError: f(): "out" can grow to more than 4294967295 elements, and a capacity past
that is not supported yet.`
   4. Past the tier's limit, it does what A1 item 8 gives. A loop whose range the device holds
      stays with A6 item 5 and change 0144, stage A3. This amendment does not change it.
   5. [fact] Today `grownCapacity` (`src/compiler/ts/lower/made-array/capacity.ts`) builds the
      capacity as `u32` expressions. The CPU tier's code runs them with `Math.imul(…) >>> 0`. A
      wrap under-allocates. `src/core/host-kernel-made.ts` then cuts the result to the
      allocation with no error, against OD-5.
   6. [fact] That is a latent bug on `main`, reached by a product of two large trip counts. A
      separate bug-fix pull request fixes it. A12 changes no code. Item 2.1's nest product makes
      the wrap easier to reach, so S5d slice 2 needs that fix first (section 7).

**2. Form 1: an element read or write of the grown array.** [proposal]

Meaning. The meaning is that of a JavaScript array (OD-5), at that point of a sequential run:

1. A read `out[k]`, with `0 <= k < out.length`, gives element `k`.
2. A write `out[k] = v` with `k < out.length` replaces element `k`. With `k === out.length` it
   appends `v`, as `out.push(v)` does, and the length grows by one. A compound write
   (`out[k] += v`, `out[k]++`) is a read, then a write. So a write needs `k <= out.length`, and a
   read needs `k < out.length`.
3. These have a JavaScript meaning that the compiler does not represent yet. They are not
   supported yet (OD-9, OD-10):
   - a read at `k >= out.length`, which gives `undefined` in JavaScript. Change 0093 represents
     an optional value, not an element that is not there;
   - a write at `k > out.length`, which leaves holes in JavaScript (A1 item 11);
   - a negative `i32` index, which reads or writes a property in JavaScript, not an element.

   How these are refused, at compile time or at the call, is question Q1.

Where it runs:

4. In a loop that also pushes onto `out`: the loop runs on the CPU tier (`TS8070`), as for a
   parameter. A read follows Rule 8.22, R4: "an array the loop pushes onto is not read at all".
   A write gives the reason of `src/compiler/ts/kernel-loops.ts`: `writes "out" in place, and the
loop also pushes onto it`. The run is sequential, so items 1 to 3 hold as written.
5. In a later loop that does not push onto `out`: the loop is a candidate loop, as for a
   parameter. The index is the loop's counter, and the range is inside `0 .. out.length`
   (`j < out.length`). Then the compiler proves every access below the length. The loop then
   runs on WebGPU, over a range the device holds (change 0094). These cases run on the CPU tier
   instead:
   - A write that the compiler cannot prove at most the length. An append moves the length for
     the iterations after it. `TS8070` names the write.
   - A statement between the loops that reads `out`, its length included (Example 1 with
     `const total = f32(out.length)`). `lowerKernel` gives `loop 2 writes "out", which the
statements before it read, and each of its invocations runs those statements again`. The
     function runs on the CPU tier, as its parameter form does.
   - A later loop over `j < out.length` that reduces or pushes, unless it has the cap of change
     0094, decision D6. That cap is `min(d, c)`, with `c` a value the host knows. A loop that pushes
     onto `out` itself also takes Route 3 (section 1, item 4).
6. After the last loop (change 0094, part 3, stores after the loops): on WebGPU the stores run in
   the finish entry. One invocation runs them in program order. It reads the count the loops left,
   so items 1 to 3 hold as written. This changes A1 item 9 for a grown array. A1 item 9 says that "a
   store after the loops past the end is dropped". For a grown array such a store appends (at the
   length) or is refused (past it). So `guardStoresAfterLoops` (`src/core/passes/kernel-stores.ts`)
   guards a grown array by its length, the number pushed, not by its capacity.
7. In a statement between two loops: the function runs on the CPU tier. Rule 8.22 runs a function so
   when a statement before its last loop writes an array.
8. Before the first loop: the array is empty. A read is past the length, and a write at index 0
   is a push outside every loop (A6 item 6). Both stay refused at compile time (below).
9. A struct element: A8 item 4, A9 and A10 item 1 apply to a whole write `out[k] = w`. A field
   write `out[k].a = v` stays refused by change 0142, stage 3 (A8 item 2).

Storage: Route 1, with section 1, item 2.4. Dependencies: none on change 0144.

Refused as "not supported yet", `TS8099`, the same sentence in both halves:

- A read before the first loop: `"out[0]" reads an element of "out", the array "f" grows with
push, before anything is pushed onto it; a read past its length is not supported yet. Read it
after the loop that pushes onto it.`
- A write before the first loop: `"out[0] = 1." writes an element of "out", the array "f" grows
with push, before its first loop, which adds an element outside every loop, and that is not
supported yet. Push onto it inside a loop of "f".`
- With Q1 (A) only, a read that the compiler cannot prove below the length: `"out[k]" reads an
element of "out", the array "f" grows with push, at an index the compiler cannot prove is below
its length; a read past the length is not supported yet. Index it by the counter of a loop up to
out.length.` A write that it cannot prove at most the length says `writes` and `is at most its
length`.
- With Q1 (B) or (C), the call throws instead. There is no editor half, since the editor cannot
  see the run: `RangeError: f(): "out[k]" reads index 7 of "out", whose length is 5 there. A read
past the length is not supported yet.` A write says `writes index 9` and `A write past the
length`.

The sentence of A7 item 1 retires.

Example 1. Before, both halves give `TS8099`: `"out[j]" writes an element of "out", the array
"keepScaled" grows with push, and that is not supported yet. …`. After, both halves give no
diagnostic. The second loop runs on WebGPU over a range the device holds, as its parameter form
does today (observed above). A statement between the loops that reads `out` would send the
function to the CPU tier (item 5).

```ts
export function keepScaled(xs: f32[], t: f32): f32[] {
  const out: f32[] = [];
  for (const x of xs) {
    if (x > t) {
      out.push(x);
    }
  }
  for (let j: u32 = 0; j < out.length; j++) {
    out[j] = out[j] / t;
  }
  return out;
}
```

**3. Form 2: a push in a nested loop, in a `while`, or in a loop under a branch.** [proposal]

Meaning. The pushes append in the order of a sequential run, as Rule 8.23 gives them for an
array parameter. The order is loop by loop, iteration by iteration, and statement by statement.
The iterations of an inner loop keep their order. The result is the elements pushed, in that
order.

Where it runs. Each form runs on the tier that runs its parameter form today (observed above):

1. A push in a loop nested in a top-level loop: the top-level loop runs on WebGPU when two things
   hold. The proof of Rule 8.22 accepts it, and `pushGap` gives no reason. One invocation runs one
   whole iteration, inner loop included. So change 0078's count, scan and store keep the order.
2. A push in a top-level `while`: the loop runs on the CPU tier (R1, `TS8070`).
3. A push in a loop under a branch: the function runs on the CPU tier (`TS8070`).

Storage. A nest takes one route, chosen in this order:

4. Route 1 (section 1, item 2.1), when every loop of the nest is counted with listed operands
   and the capacity is within the tier's limit.
5. Otherwise Route 2, when the top-level loop meets section 1, item 3. Example 2 is this case:
   its inner start reads `i`.
6. Otherwise Route 3 (section 1, item 4).
7. A loop under a top-level branch: Route 1 (item 2.2), when the condition reads only listed
   operands and the loop's own headers are ones Route 1 counts. Otherwise Route 3.
8. A top-level `while` or `do … while`, and a loop inside one: Route 3.

[fact] A header run would cost the nest's total inner trips on the host. For Example 2 that is
n(n−1)/2, which passes 4294967295 at n = 92683. Its capacity, n(n−1), passes 4294967295 at
n = 65537. So no nest uses a header run. Route 2 counts on the device instead.

Dependencies: items 4, 5 and 7 need nothing of change 0144. Items 6 and 8 are question Q2.

Refused as "not supported yet", `TS8099`, the same sentence in both halves:

- With Q2 (B) only, until change 0144, stage A3: `"while (at !== 0)" pushes onto "path", and its
trip count is known only when it ends, so the call cannot reserve room for "path" before it
runs; that is not supported yet.`
- Unchanged: a push outside every loop (A6 item 6), and a loop whose range the device holds (A6
  item 5).

The sentence of A7 item 2 retires.

Example 2. Before, both halves give `TS8099`: `"out.push(i)" pushes onto "out" inside "for (let
j: u32 = i + 1; j < xs.length; j++)", which is no for loop at the top level of "pairs", and that
is not supported yet. …`. After, both halves give no diagnostic. The inner start reads `i`, so
the capacity comes from Route 2 (item 5).

```ts
export function pairs(xs: f32[], r: f32): u32[] {
  const out: u32[] = [];
  for (let i: u32 = 0; i < xs.length; i++) {
    for (let j: u32 = i + 1; j < xs.length; j++) {
      if (abs(xs[i] - xs[j]) < r) {
        out.push(i);
        out.push(j);
      }
    }
  }
  return out;
}
```

**4. Form 3: a loop with an `f32` counter.** [proposal]

Meaning. The loop runs as the CPU tier's code runs it. The counter's type comes from its uses,
and is `f32` where no use decides (OD-7). The counter is rounded to `f32` after each step, as
the CPU tier's code runs it. The trip count is the one that sequential run gives. Each trip's
pushes append in order.

- [observed, 2026-11-23, `Math.fround` in Bun 1.4.4] `samples(0, 1, 0.1)` takes 10 trips in
  `f32` and 11 in plain JavaScript's `f64`. `samples(0, 1, 0.01)` takes 101 in `f32` and 100 in
  `f64`.

Where it runs. On the CPU tier (R1, `TS8070`), as its parameter form does today (observed above).

Storage:

1. With Q2 (A): Route 3. The loop runs once, and the storage grows as it pushes. No header run
   is needed.
2. With Q2 (B): Route 1 (section 1, item 2.3). Before the dispatch, the host runs the
   initializer, the condition and the update alone, and counts the trips. It runs them with the
   CPU tier's generated code, as `cpu.F[made.length]` runs a length today
   (`src/core/host-kernel-made/making.ts`). So the count equals the tier's trips exactly. The
   capacity is the trips times the pushes in one trip, computed exactly (section 1, item 5).
   The same holds for any `for` that is not counted, a step `i *= 2` included.
   1. The host stops when that capacity passes the tier's limit (A1 item 8) or 4294967295, and
      the call throws before anything runs: `RangeError: f(): "for (let x = a; x < b; x += h)"
can push more than 4294967295 elements, the most this tier holds, and that is not supported
yet.` The number is the tier's limit or 4294967295, whichever is less.
   2. Cost: the header's work on the host, at most the steps that reach the tier's limit. A
      conditional push counts once for each trip. So the call can throw where JavaScript pushes
      fewer elements.
3. A header that reads another value, or a body that writes the counter: Route 3 (question Q2).

Dependencies: nothing of change 0144 with either answer to Q2. Route 3 is question Q2.

Refused as "not supported yet", `TS8099`, the same sentence in both halves:

- With Q2 (B) only, for item 3: `"for (let x = a; x < b; x += h)" pushes onto "out", and its
header reads a value the call does not know before it runs, or its body changes its counter, so
the call cannot reserve room for "out" before it runs; that is not supported yet.`

The sentence of A7 item 3 retires: with Q2 (A) for every loop of this form, with Q2 (B) for the
loops Route 1 counts.

Example 3. Before, both halves give `TS8099`: `"for (let x = a; x < b; x += h)" pushes onto
"out", and its trip count is no count from a start to a bound by a constant whole step, …`.
After, both halves give the `TS8070` warning of the parameter form, "This loop runs on the CPU
because it is an open loop, …", and no error.

```ts
export function samples(a: f32, b: f32, h: f32): f32[] {
  const out: f32[] = [];
  for (let x = a; x < b; x += h) {
    out.push(sin(x));
  }
  return out;
}
```

**5. Both halves (Rule 12.7).** [proposal]

- The ambient `Array<T>` already declares the index, `push` and `length`. An element read is a
  `T`.
- The hover on `out` shows the same type text as the hover on an array parameter `out: T[]`.
  [observed, 2026-11-23, `bothHalves(…).hover`, `747e8637`] The hovers are not equal. A grown
  array shows `const out: array<f32>`. A parameter shows `(parameter) out: array<f32>` and a
  paragraph on the caller's object.
- Each `TS8099` above reaches the editor with the compiler's code and sentence.
- A `RangeError` of the call has no editor half: Q1 (B) or (C), section 1, item 5.3, and section
  4, item 2.1. The tests read it at the call.

**6. What the implementing pull request tests and checks.** [proposal]

1. `bothTake` (`src/core/testing/both-halves.ts`) on examples 1 and 2: no diagnostic in either
   half. `bothHalves` on example 3, since `bothTake` throws on a warning: no error, and the
   `TS8070` warning with one text in both halves. On each example, the hover on `out` shows the
   same type text as the parameter form's.
2. `bothRefuse` on each refusal that stays, with its sentence.
3. The CPU tier against a JavaScript loop on the same inputs. An `f32` counter's oracle rounds
   each step with `Math.fround`. The cases are each example and:
   - an empty result; a read of the last element; a write at `out.length`, which appends; a
     compound write; a store after the loops;
   - two loops on Route 2; a triangular nest;
   - a square nest with unconditional pushes in the outer body and the inner body; a nest three
     deep;
   - a loop under a branch taken and not taken, and `if (h > 0)` around a loop that steps by `h`,
     with `h = 0`;
   - an `f32` step that rounds (`0.1` and `0.01`); a loop of zero trips; a step `i *= 2`.
4. The capacity: a nest whose exact capacity is 4294967295 passes the check of section 1, item 5.
   One of 4294967296 (65536 × 65536) throws its `RangeError` and does not wrap to 0.
5. With Q1 (B): the `RangeError` text of a read past the length, a write past the length and a
   negative index. Every caller array is unchanged after the throw, on WebGPU, WebGL2 and the
   CPU tier. On WebGPU, a throw in the second loop after the first loop's flush.
6. With Q1 (C): the same texts on the CPU tier. A function with an unproved access has no GPU
   plan, and its reason names the access. Every caller array is unchanged after the throw.
7. With Q2 (A): a top-level `while` that pushes, and example 3, against a JavaScript loop.
8. WebGPU, in `journeys/_host-import`: example 1, example 2 and a store after the loops, each
   equal to the CPU tier. Example 1 with a statement between its loops runs on the CPU tier.
9. The differential gate (`scripts/gpu-differential.ts`) gains grown arrays with nested pushes
   and element writes.
10. Measurements: the extra read of Route 2 against the parameter form's call. With Q2 (B), the
    host time of Route 1's header run for three trip counts.
11. The gates of `AGENTS.md`: `bun run test`, the compile gate (Tint and WebGL2) on the count
    steps and the finish entry, `bun run docs:impact`, `bun run reqs:sync` with
    `python scripts/doorstop-check.py -C`, and `bun run changes:check`.
12. The document audit: the push sentence of Rule 8.22, the S5d paragraph of Rule 8.23 and its
    "Enforced by" list, and surface §63 and §65, against the delivered behaviour.

**7. Stages and dependencies.** [proposal]

| Slice                                | Delivers                                                                                                                                       | Needs first                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| bug fix, no proposal                 | The exact capacity and its check (section 1, items 5.2 and 5.3) for the forms on `main`.                                                       | nothing                                                             |
| S5d slice 2                          | Form 1 (section 2), form 2 on Routes 1 and 2 (section 3, items 4, 5 and 7), and with Q2 (B) form 3 on Route 1 (section 4, item 2).             | the bug fix                                                         |
| S5d slice 3                          | Route 3: form 2, items 6 and 8; form 3, items 1 and 3; the other loops of section 1, item 4.                                                   | Q2 (A): S5d slice 2. Q2 (B): change 0144, stage A3, on the CPU tier |
| a later amendment of change 0144, A2 | Routes 1 and 2 reserve a call region in place of a binding of their own. No program changes.                                                   | 0144 A1                                                             |
| a later amendment of change 0144, A3 | Route 2 may reserve a run region from the bump word in one submission, with no read between steps (the compiler's choice). No program changes. | 0144 A2                                                             |

[fact] Change 0144, section 5, excludes "A push in a loop inside a loop (0114, Amendment A7, item
2)". So the last two rows are not 0144's work as approved. Each needs an amendment of change
0144 that widens its scope first.

**8. Check against the owner's decisions.**

| Entry | How A12 keeps it                                                                                                                                                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OD-1  | No new syntax. The author writes TypeScript's index, `push`, `while` and `for`.                                                                                                           |
| OD-2  | Not touched.                                                                                                                                                                              |
| OD-3  | The capacity and the route are the compiler's. The author states nothing for them.                                                                                                        |
| OD-4  | One example before and after for each form. Q1 and Q2 show options and costs.                                                                                                             |
| OD-5  | The array is a JavaScript array. Each accepted form has its JavaScript meaning. A form without one in TypeShade yet is refused and says so. A wrapped capacity that cuts a result is not. |
| OD-6  | No release exists, so no warning release is owed.                                                                                                                                         |
| OD-7  | The counter of form 3 takes its type from its uses.                                                                                                                                       |
| OD-8  | Not touched.                                                                                                                                                                              |
| OD-9  | The routes, the count pass and the header run are the compiler's code with the same result. Each refusal is "not supported yet".                                                          |
| OD-10 | Compile time first (Routes 1 and 2), the heap second (Route 3). Nothing is refused as impossible.                                                                                         |

**9. Questions for the owner.**

**Q1. An index that the compiler cannot prove inside the length.** Example: `const first = out[0]`
after a loop whose push is conditional. JavaScript gives element 0 when one was pushed. It gives
`undefined` when none was. A write `out[0] = 2.` in the same place needs no question. Index 0 is
always at most the length, so the write replaces or appends (section 2, item 2). The question is
only a read at or past the length, and a write past it.

- [fact] What a throw during the run costs. A call with plain data on WebGPU flushes after each
  loop and after the finish entry (`onDevice`, `src/core/host-kernel.ts`). `DispatchBatch.flush`
  reads each storage binding back into the caller's value in place (`src/core/host-entry.ts`).
  The bound arrays are the caller's own. WebGL2 writes into the caller's array after each draw
  (`onWebgl2`, `src/core/host-kernel-gl.ts`). Only the CPU tier copies: it runs on copies and
  writes them back after the function returns (`onCpu`, `src/core/host-kernel.ts`). So on
  WebGPU and WebGL2, a throw in a later loop finds the caller's arrays already changed.
- (A) Refuse at compile time. The compiler accepts a read only where it proves the index below the
  length. It accepts a write only where it proves the index at most the length. Elsewhere it gives
  `TS8099`. Cost: the read `out[0]` after a conditional push is refused. So is a later loop `j < n`
  that writes `out[j]`. The author rewrites these.
- (B) Check at the call, on every tier. The compiler proves where it can. Elsewhere the call
  checks the index and throws a `RangeError` "not supported yet". Every caller array must be
  unchanged after the throw (OD-5). On WebGPU and WebGL2 that needs one of these:
  - a restore, as change 0144, C11 gives it. The call copies each array it can write before it runs.
    It copies each back before it throws;
  - every loop's copy-back deferred to the end of the call, after the check of the flag word.

  Cost: a program that compiles can throw for some inputs. Each unproved access costs a
  comparison, and on WebGPU a flag word read back with the results. The restore costs a copy of
  each writable array on every call of such a function. The deferral changes when every
  function's results reach the caller.

- (C) Check at the call, on the CPU tier only. A function with an unproved access has no GPU
  plan, as section 2, item 5 already gives an unproved write. The CPU tier runs on copies, so a
  throw leaves every caller array unchanged. Cost: a program that compiles can throw for some
  inputs. Each such function runs on the CPU tier, its other loops included, until a later
  change gives (B)'s restore. That later change is the compiler's, with no change to the
  program.
- [fact] A check at the call is new in kind. A1 item 4 (a `RangeError` for a length), A1 item 7
  and A5 item 1 refuse at the call too, but before anything runs. (B) and (C) throw during the
  run.
- [decision, owner, 2026-11-23] "추천대로", to the draft's recommendation, (B). The owner saw the
  draft's cost of (B), which held no restore: the draft assumed a caller array changes only at
  copy-back. Review finding B2 shows that assumption false on WebGPU and WebGL2.
- [fact] Q1 is open again. The corrected cost of (B) adds the restore or the deferred copy-back.
  With that cost, the recommendation changes to (C). The answer "추천대로" was given to another
  recommendation, so this record does not take it as a decision for (B) or for (C). The owner is
  shown the corrected costs and decides again.
- [decision, owner, 2026-11-23] Shown the corrected costs of (A), (B) and (C), the owner chose
  (C): "(C) CPU에서만 검사, 나중에 (B)". Q1 is decided (C).
- Recommendation: (C) now, and (B) when change 0144, stage A3, gives the restore. It rests on OD-5
  and OD-9. No accepted program runs with a meaning JavaScript would not give. The host sees the
  caller's arrays unchanged after a throw. It rests on OD-10, since the refusal says "not supported
  yet", and on OD-3, since the author rewrites nothing. It reverses no entry.
- Not offered: a read past the length that gives `0`, or the value a target's robust access
  gives. Such a read has a meaning JavaScript would not give (OD-5, OD-9).

**Q2. Growing storage before change 0144, stage A3.** Route 3 serves every loop of section 1,
item 4: a top-level `while`, a loop inside it, a `for` that is not counted, and the others there.
Each runs on the CPU tier only (section 1, item 4.1).

- (A) Land with S5d slice 3, now. The CPU tier holds the array in storage of its own that grows
  as the run pushes. Change 0144, stages A1 to A3, later move it into the CPU tier's arena, with
  no change to the program. This is the pattern the owner chose for S5 in A1: a binding of its
  own first, the arena when it exists. Cost: a storage path outside the arena on the CPU tier
  until change 0144, stage A3. A grown copy each time the storage fills.
- (B) Wait for change 0144, stage A3. Until the CPU tier has run regions, these costs hold:
  - The loops that section 1, item 2.3 counts land only through a header run on the host. Its
    work is up to the steps that reach the tier's limit. Over-counted conditional pushes can make
    the call throw where JavaScript returns.
  - Every other loop of section 1, item 4 stays refused, with the `TS8099` sentences of sections
    3 and 4.
  - The forms wait for change 0144, A1, A2 and A3.
- [decision, owner, 2026-11-23] "추천대로", to the recommendation (A). The review did not change
  the options or the recommendation of Q2; it added costs of (B) (finding S6). Q2 is decided:
  (A).
- Recommendation: (A). With (A), Route 3 serves every CPU-only loop. Item 2.3, the header run,
  its `RangeError` and the hazard of a header the program never runs are not built. It rests on
  OD-10 (a heap the compiler manages at run time; storage that the CPU tier grows is one), OD-3
  and OD-9. It reverses no entry, and no GPU tier runs these loops in either option.
- Not offered: refusing these forms for good. OD-10 says "not supported yet", never impossible.

**Independent review record.**

- [fact] Reviewer: an independent agent that did not write this amendment. Date: 2026-11-23.
  Configuration: `747e8637`. Each finding was checked against the code at that commit before
  its disposition. The probes ran `lowerKernel` and `bothHalves` with Bun 1.4.4.

| Finding | What it found                                                                                                                    | Disposition                                                                                                                                                                                                                                           |
| ------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1      | Example 1 does not run on WebGPU: `const total = f32(out.length)` between the loops gives `noGpu`.                               | Fixed. Confirmed by probe (observed table). Example 1 drops `total`. Section 2, item 5 adds the statement between the loops. Test 8 checks both.                                                                                                      |
| B2      | Q1's assumption is false: WebGPU and WebGL2 write the caller's arrays after each loop. Only the CPU tier copies.                 | Fixed. Confirmed in `onDevice`, `DispatchBatch.flush`, `onWebgl2` and `onCpu`. The assumption is removed. Q1 (B) states the restore or the deferral and its cost. Q1 (C) is added. Tests 5 and 6 replace the old test 4.                              |
| B3      | The capacity is computed in wrapping `u32` arithmetic, and a wrap cuts the result with no error (OD-5).                          | Fixed in the text. Confirmed in `grownCapacity`, `cpu-codegen.ts` (`Math.imul`) and `host-kernel-made.ts`. Section 1, item 5 requires the exact capacity and checks it. The latent bug goes to a separate bug-fix pull request; no code changes here. |
| B4      | Route 2's store-free count under-counts an iteration that reads back its own writes, or reduces.                                 | Fixed. Confirmed by probe (`pushGap`'s reason). Route 2 requires `pushGap`'s conditions (section 1, item 3). Every other loop takes Route 3.                                                                                                          |
| S1      | Route 1 under a branch "as if taken" can run a header the program never runs, and throw where JavaScript returns.                | Fixed. Section 1, item 2.2 evaluates a listed condition on the host. Any other condition takes Route 3. Test 3 adds `if (h > 0)` with `h = 0`.                                                                                                        |
| S2      | Say which route a nest takes, and correct the header run's cost.                                                                 | Fixed. Section 3, items 4 to 8 give the order. The cost is the nest's total inner trips. Corrected: n(n−1)/2 passes 4294967295 at n = 92683, not about 92682. No nest uses a header run.                                                              |
| S3      | The route classification has gaps.                                                                                               | Fixed. Section 1, item 4 has the closing rule and lists the three gaps found.                                                                                                                                                                         |
| S4      | The `f32` counter's trip count differs from plain JavaScript.                                                                    | Fixed. Confirmed with `Math.fround`: 10 against 11, and 101 against 100. Section 4 states the rounding, the CPU tier's generated code for the header run, and a `Math.fround` oracle.                                                                 |
| S5      | Q1 contradicts itself: a write needs only "at most its length". The checks of A1 and A5 run before the run.                      | Fixed. Q1's example is now a read. (A)'s cost names the read only. The fact on A1 and A5 is corrected.                                                                                                                                                |
| S6      | Every loop that needs items 2.2 or 2.3 runs on the CPU tier only, so Q2 (A) makes them unneeded.                                 | Fixed, with one correction. Item 2.3's nest clause served Example 2, which WebGPU runs. That nest now takes Route 2, so the finding holds after the revision. Item 2.3 is built only with Q2 (B), and Q2 shows it as a cost of (B).                   |
| S7      | Route 2 is the alternative change 0144 rejected. 0144, section 5, excludes a push in a nested loop.                              | Fixed. Confirmed at both places in change 0144. Section 1, item 3.5 cites it and says why it is acceptable in the interim. Section 7 marks the rows as a later amendment of change 0144.                                                              |
| S8      | Change 0094, D6 and A1 item 9 need statements.                                                                                   | Fixed. Section 2, item 5 states D6's cap. Section 2, item 6 states the change to A1 item 9 and to `guardStoresAfterLoops`.                                                                                                                            |
| M1      | `bothTake` throws on a warning.                                                                                                  | Fixed. Confirmed in `both-halves.ts`. Test 1 uses `bothHalves` for example 3.                                                                                                                                                                         |
| M2      | The hovers differ.                                                                                                               | Fixed. Confirmed by probe. Section 5 and test 1 say "the same type text".                                                                                                                                                                             |
| M3      | Two labels are wrong.                                                                                                            | Fixed. Both are `[inference]` now.                                                                                                                                                                                                                    |
| M4      | Sentences over 25 words.                                                                                                         | Fixed. The revision splits them.                                                                                                                                                                                                                      |
| M5      | The form 3 bound can cost 4.29e9 header steps.                                                                                   | Fixed. The header run stops at the tier's limit (section 4, item 2.1).                                                                                                                                                                                |
| M6      | Item 4 cites R4, but a write gives another reason.                                                                               | Fixed, in part. R4 is right for a read ("an array the loop pushes onto is not read at all"). A write gives the reason of `kernel-loops.ts`. Section 2, item 4 names both.                                                                             |
| M7      | Item 2.1's formula leaves out pushes in the outer body and in deeper nests. `pushesIn` counts an inner push once per outer trip. | Fixed. Confirmed in `capacity.ts`. Item 2.1 sums over every push. Tests 3 and 4 add a square nest, a nest three deep and a capacity near 2^32.                                                                                                        |

- Open findings: none. Q1 is decided (C). Q2 is decided (A).
- Affects: section 2 (S5d items 1, 2, 5 and 6; A7 items 1 to 3; A1 item 9 for a grown array).
  Rules 8.22 and 8.23 and surface §63 and §65 change in the implementing pull request. No
  front-matter entry changes. Rules 8.22 and 8.23 and surface §63, §64 and §65 are declared,
  `TS8099` exists, and `Array.prototype.push` and `length` are in `src/__api__/author-names.md`.
- Status: `status: accepted` does not change. A12: reviewed, Q1 decided (C), Q2 decided (A). The
  capacity bug fix: done (#1426, `e73d0464`). S5d slice 2: in progress (#1431): form 1 and Q1 (C)
  first; form 2 on Route 1 second (A14); form 2 on Route 2 next. S5d slice 3: not started.

### A13. The deviations of S5d slice 2, part 1 (2026-11-23)

- [fact] Why. Pull request #1431 (merged as `579c6d1`) delivers form 1 of A12 and Q1 (C). It
  differs from A12 in four places, each recorded on #1431 as an open deviation.
- [fact] This amendment records them. It decides nothing. Each stays open until the owner decides
  it, or a later slice closes it.

1. **D1. A store after the loops.** A12, section 2, item 6, runs a store after the loops on
   WebGPU, with a journey case (test 8). An index after the loops is never proved below the length,
   so the store runs on the CPU tier with the check of Q1 (C). The journey case is not added.
2. **D2. The reason for an unproved write.** A12, section 2, item 5, asks that `TS8070` name an
   unproved write in a later loop. No `TS8070` is added. The function's `noGpu` reason names the
   access instead.
3. **D3. A negative index.** A12 gives no `RangeError` sentence for a negative index. The
   implementation uses the read and write sentences, which say "past the length".
4. **D4. Two `TS8099` sentences.** A12 does not word two refusals: an unproved write in a loop that
   is no `for` at the top level, and a loop whose only push is such a write. The implementation
   words them in the style of A7.

- [fact] Form 3 (a loop with an `f32` counter) is not in #1431. With Q2 decided (A), A12 sends it to
  Route 3, which is slice 3. This follows A12; it is no deviation.
  **A10 item 2.4 decided.** A10 refuses a call on a resource that also writes a plain array, because
  change 0138, Amendment A11, Q7 and A1 item 7 point different ways.

- [decision, owner, 2026-11-23] The agent recommended 0138's Q7, and the owner chose it: "0138 Q7:
  일반 데이터". Such a call waits, and its promise gives the made array as plain data (the typed
  array or the array of objects of A1 item 6), not a `Buffer`. A call on a resource that does not
  wait still gives a new `Buffer` (A1 item 7).
- [fact] The refusal of A10 item 2.4 stays until an implementing pull request lands this.

- Affects: section 2 (S5 item 7, S5d items 5 and 6). No front-matter entry, rule number or code
  changes.
- Status: `status: accepted` does not change. A12's heading no longer says "draft". S5d slice 2:
  form 1 and Q1 (C) done (#1431); form 2 on Routes 1 and 2 not started. S5d slice 3 (Route 3, form 3) not started.

### A14. S5d slice 2, part 2: form 2 on Route 1, and its deviations (2026-11-23)

- [fact] Why. Pull request #1444 (merged as `82121fd`) delivers form 2 of A12 on Route 1: a push in a
  nest of counted loops, and in a loop under a top-level branch whose condition reads only listed
  operands. Route 2 (a count pass) is not in it. Route 2 needs a change to the dispatch of the
  WebGPU tier that cannot run in the container of this slice (section 6, test 8).
- [fact] What the pull request does. The capacity sums over every push at every depth: the pushes
  of one depth times the product of the trip counts of every loop around them (A12, section 1,
  item 2.1; finding M7). A loop under a top-level branch counts only when the host finds its
  branch taken, evaluated with the CPU tier's generated code (item 2.2; finding S1). The host
  sums in `BigInt` and compares with 4294967295 exactly (item 5.2). A product that wraps in
  `u32` throws its `RangeError` and does not wrap.
- This amendment records the differences from A12. Each stays open until the owner decides it,
  or a later slice closes it.

1. **D1. Route 2 is not built.** A12, section 3, item 5, and section 1, item 3, are not
   delivered. An inner loop whose start or bound reads a counter of a loop around it (Example 2)
   stays refused. A12 words no sentence for the interim, so the sentence is the one of a start or
   bound that reads another operand ("reads a value the call does not know before it runs …").
   Closes with Route 2.
2. **D2. Route 1's preference for Route 2.** A12, section 1, item 3, prefers Route 2 when Route 1's
   capacity passes the tier's limit (finding S2). Route 1 throws its `RangeError` there until
   Route 2 lands. Closes with Route 2.
3. **D3. A loop under a branch inside a loop, and a loop under a `switch`.** A12 counts a loop
   under a top-level branch (item 2.2) and sends "a loop under a top-level branch that item 2.2
   does not count" to Route 3. It words nothing for a loop under a branch inside a loop, or for a
   loop under a `switch`. The slice refuses both with `TS8099` and one new sentence for the
   first: `"out.push(1.)" pushes onto "out" inside "for (…)", which stands under a branch inside
"for (…)", and a loop under a branch inside a loop is not supported yet. Move the loop out of
the branch.` The second takes the A7 sentence. Closes with Route 3 or with an owner decision.
4. **D4. A branch whose condition reads another operand.** A12 sends it to Route 3. The slice
   refuses it with `TS8099` and a sentence in the style of A13, D4: `"if (xs[0] > 0)" decides
whether a loop pushes onto "out", and its condition reads a value the call does not know
before it runs. …` Closes with Route 3.
5. **D5. The A7 sentence for a `while`.** A7 item 2 retires for a nest and a branch. It stays for
   a push in a `while`, a `do … while`, and a loop inside either, since A12 sends them to Route 3.
   For a `for` loop inside a `while`, the sentence names the `while`. Closes with Route 3.
6. **D6. The `RangeError` sentence.** A12, section 1, item 5.3, words it `f(): "out" can grow to
more than 4294967295 elements, and a capacity past that is not supported yet.` The delivered
   sentence is the one of #1426, which names the capacity: `f(): the array it grows with push,
"out", needs room for N elements, the most its loops can push, and a length past 4294967295 is
not supported yet.` Open until the owner decides which sentence holds.
7. **D7. Test 3, the hazard of a loop that steps by `h`.** A12, section 6, item 3, tests `if
(h > 0)` around a loop that steps by `h`, with `h = 0`. A loop whose step is a variable is no
   counted loop, so it is refused (form 3, Route 3). The test uses a counted nest under a branch
   whose capacity would pass the limit if it were counted "as if taken" (`guarded`). Closes
   with Route 3.
8. **D8. Tests, gates and measurements not run.** Section 6, test 8 (journeys on WebGPU), test 9
   (the differential gate) and test 10 (measurements) did not run, and Route 2's cases in test 3
   are not tested. The compile gate (Tint and WebGL2) passed in CI on #1444.

- Affects: section 3 (A7 item 2 for a nest and a top-level branch). Rules 8.22 and 8.23 and surface
  §65 change as the pull request lists. No front-matter entry, rule number or code changes.
- Status: `status: accepted` does not change. S5d slice 2: form 1 and Q1 (C) done (#1431); form 2
  on Route 1 done (#1444); form 2 on Route 2 not started. S5d
  slice 3 (Route 3, form 3) not started.

### A15. Status: A10 item 2.4 implemented (2026-11-24)

- [fact] Pull request #1456 (merged as `a6934b3`) implements the owner's answer recorded in A13
  ("0138 Q7: 일반 데이터"). A call on a resource of a kernel function that makes and returns an
  array, and that also writes a plain array, waits. Its promise gives the made array as plain
  data, the typed array or the array of objects of A1 item 6. The refusal of A10 item 2.4 is gone.
  A call on a resource that writes no plain array still returns a new `Buffer` at once (A1 item 7).
- [fact] The waiting call takes the path of a call with plain data. So the forms A10 refuses on a
  resource (items 2.1 to 2.3: a grown array, a struct fill that shares one object, a struct of no
  exported class) work there when the call also writes a plain array, as they work for a call
  with plain data. A10 items 2.1 to 2.3 keep their refusal for a call that does not wait.
- [fact] A length or a fill value that reads a resource argument (A10 item 2.5) stays refused on
  the waiting call too; the promise rejects with the `TypeError` that names it.
- [fact] This amendment records status only. It decides nothing.
- Status: `status: accepted` does not change. A10's open items: 2.4 done (#1456); 2.1 to 2.3 and
  2.5 stay refused for a call that does not wait.

### A16. Route 2 delivered, and S1's status (2026-11-23)

- [fact] Amendment A15 merged in pull request #1460 (merge commit `d24f94cc`). This amendment
  follows it in number only and does not depend on its text.

**(a) S5d slice 2, part 3: Route 2 on the CPU tier and on WebGPU.**

- [fact] Pull request #1466 (merge commit `369f1b41`) delivers Route 2 of A12 for form 2
  (Example 2). On WebGPU the first run dispatches only the count and scan entries of change 0078,
  with no store entry, and reads the total. On every other tier the first run is the function's run
  on the CPU tier.
- [fact] Route 2 reads the size back before the second run. It is the interim of the alternative
  change 0144 rejected ("always read the size back first", 0144, Alternatives). A12 review
  finding S7 accepts that interim until 0144 A3.
- [fact] Pull request #1466 closes A14 D1 (Route 2 is not built) and A14 D2 (Route 1's preference
  for Route 2).
- This amendment records the differences from A12, section 1, item 3. Each stays open until the
  owner decides it.

1. **D1. The eligibility is stricter than `pushGap`.** `countable`
   (`src/core/passes/countable.ts`) accepts a function only on these conditions. Every write is an
   `append` onto one array. Every push is a statement. The body reads no element of the grown
   array. Only the return follows the loops. Every read of an operand array is at a counter that
   runs up to that array's length. A12 item 3 allows more. Any other function keeps `TS8099`.
   Open.
2. **D2. No mismatch word (owner decision (b), 2026-11-23).** The second run checks that its
   total equals the first run's. [inference] Count and store errors that cancel in the total are not caught.
   Open.
3. **D3. A count of 4294967295 or more throws (owner decision (e)).** `countedTotal`
   (`src/core/host-kernel-made/capacity.ts`) throws the `RangeError` at 4294967295. The count
   saturates only for a counted function (decision (f)). On WebGPU, `min` and `-` in the count
   helper and in the scan do it (`exactTotal` of `LowerOptions`). On the CPU tier, the push builtin
   does it (`withSaturatingPushes`). A total of exactly 4294967295 throws, though it is
   representable. [inference] Decision (e) is the reason: no tier allocates that total. Open.
4. **D4. Route 1's limit test at the call.** `host-kernel-grown-capacity.test.ts` and
   `host-kernel-grown-nest.test.ts` no longer assert at the call that a counted function past the
   limit throws Route 1's `RangeError`. That call takes Route 2, and a real run needs billions of
   trips. Before the change it ran 520 s and 570 s before it failed. The tests assert
   `exactCapacity` and `checkedCapacity` for the same inputs. A function that is not counted
   (`guarded`) keeps the assertion at the call. The switch from Route 1 to Route 2 at the limit is
   tested with a mocked `callKernel` only. Open.
5. **D5. WebGL2.** A push loop has no WebGL2 plan (`noWebgl2`, Rule 11.8). A counted function
   runs there on the CPU tier, and its face keeps that reason. Open.
6. **D6. A13 D1 and D2 stay open.** This slice does not close them. Open.

- [fact] Not run for #1466: the differential gate, and a saturated scan on a device. A real count
  past 4294967295 is infeasible.
- [fact] The four required checks were green on head `4c3c022e` of #1466: `typecheck + unit`,
  `traceability (Doorstop)`, `compile gate (Tint + WebGL2)` and
  `user journeys (packed tarball, WebGPU)`.
- [fact] The journey cases `pairSearch` and `pairTwice` ran locally on WebGPU (SwiftShader) on
  2026-11-23. Their results equal the reference. This local run is not a CI result.
- Affects: Rule 8.23 and surface section 65 (the first run on WebGPU). No front-matter entry,
  rule number or code changes.
- Status: `status: accepted` does not change. S5d slice 2: form 2 on Route 2 done on the CPU tier
  and on WebGPU (#1466, merge commit `369f1b41`). S5d slice 3 (Route 3, form 3) not started.

**(b) S1's status.**

- [fact] A2's status line says that `readonly T[]`, `ReadonlyArray<T>` and the write refusal are
  not started. That line is out of date.
- [fact] Pull request #1369 (merge commit `b30b8a6b`) delivered `readonly T[]`, `ReadonlyArray<T>`
  and the write refusal. Its title is "Proposal 0114 S1: accept readonly f32[] and
  ReadonlyArray<f32> and refuse a write through them".
- [fact] Pull request #1369 added `src/compiler/ts/type-map/readonly-array.ts` and
  `src/compiler/ts/readonly-ts-arrays.test.ts`.
- [fact] Pull request #1370 (merge commit `a2e69146`, "State 0114 S1 in Rule 6.1") stated S1 in
  Rule 6.1. It changed two tests: `src/compiler/ts/readonly-ts-arrays.test.ts` and
  `src/compiler/ts/unsized-ts-arrays.test.ts`.
- [fact] `git log --oneline` on the two test files shows #1367, #1369 and #1370 only.
- Status: S1 done: `T[]` and `Array<T>` (#1367), `readonly T[]`, `ReadonlyArray<T>` and the write
  refusal (#1369), Rule 6.1 (#1370). A2's text stays as written.

### A17. The owner's decisions of 2026-11-23 on S3, Route 3 and do ... while (2026-11-23)

- [fact] This amendment follows A16 in number only. It records five decisions that the owner gave
  in the conversation on 2026-11-23. The owner chose the recommended option of each question and
  answered "승인". A decision below quotes the recommendation that the owner accepted.
- [fact] No earlier amendment changes. Where a decision differs from an earlier sentence, the
  decision names the sentence.

**(a) S3: a storage binding's access (pull request #1476, merged as `698af76f`).**

- [decision, owner, 2026-11-23] "승인", to the recommendation (1) to add surface sections 9 and 23
  to the front-matter `surface` list of this change. Their sentences that call a bare `storage<T>`
  read-only can then be fixed. Section 9 holds the table row "`declare const x: uniform<T>` /
  `storage<T>` | no: `TS8005`". Section 23 holds the sentence "Every atomic builtin needs
  read_write access, so a binding whose type does not say `"read_write"` is TS8005". Both
  sentences are false after S3. A bare `storage<T>` that an entry writes is `read_write` now.
  - Rests on: OD-3 (the author does not state what the compiler can infer) and OD-9. The
    front-matter list is the scope of the change (`changes/README.md`).
  - Changes in the approved text: the front matter gains `9` and `23`. The implementing pull
    request fixes the two sentences above. No rule number or code changes.
- [decision, owner, 2026-11-23] "승인", to the recommendation (2): a write to a bare storage
  binding inside a helper that no entry reaches is accepted. The binding stays
  `var<storage, read>`. The compiler does not emit the helper.
  - Rests on: OD-5 (a write goes through the call) and OD-9 (the program need not translate
    one-to-one: a helper that no entry reaches has no target code).
  - Changes in the approved text: the implementing pull request changes the first sentence of
    Rule 6.2. It says that a binding is `read_write` when an entry reaches a write to it, by
    assignment, a mutating method, an atomic builtin, or a write through a function or a
    reference parameter. It changes the last sentence of Rule 6.2 ("A write to a read-only
    resource must be refused") to say that an unreached write is not refused. The matching
    surface sentences change too.
- [decision, owner, 2026-11-23] "승인", to the recommendation (3): a binding declared with an
  explicit `"read_write"` argument that a vertex entry reads is refused now. The refusal stands
  under the Rule 6.2 vertex sentence, because WebGPU refuses that layout.
  - Rests on: OD-9. The target forces the refusal, and the refusal is not the compiler's choice.
  - Changes in the approved text: the implementing pull request changes the last sentence of
    Rule 6.2. The sentence now says: "A binding that the module writes and a vertex entry reads
    is refused". It will also name a binding that the author declared `"read_write"` and a
    vertex entry reads, with no write. The surface sentence of the same refusal changes too. The
    refusal keeps its existing code. No code is added.
- Affects: the front matter `surface` gains 9 and 23. Rule 6.2 and surface sections 9 and 23, and
  the surface sentences that restate Rule 6.2, change in the implementing pull request. No rule number or code changes.

**(b) Route 3 (A12, S5d slice 3).**

- [fact] The decisions below settle three questions of the Route 3 design, which an agent wrote
  outside the repository. Its stages are S0 to S5. S0 and S1 merged in #1479, and S2 merged in
  #1481. Each decision below states what it changes, so this record does not depend on the design.
- [decision, owner, 2026-11-23] "승인", to the recommendation R3-Q1 (B). At call time, Route 1's
  capacity can pass 4294967295, or its allocation can throw. If Route 2 does not serve the
  function, Route 3 runs on a CPU-only face of that call. The pattern is `counting(k)` in
  `host-kernel-made/counted.ts`. If the runtime's tier list has no CPU tier, the call throws the
  `pastLimit` sentence as today.
  - Rests on: OD-5 (a throw leaves the caller's arrays unchanged), OD-9, OD-10.
  - Changes in the approved text: A12 section 1, items 5.3 and 5.4, and the delivered Rule 8.23
    say that such a call "throws" before anything runs. That sentence changes to "runs on the CPU
    tier" for a function with a CPU tier. A later stage of S5d slice 3 delivers it. S1 (#1479)
    built the growing store and the `RangeError` marker that it uses. It settles the design's
    question on the row "A capacity Route 1 sizes past 4294967295".
- [decision, owner, 2026-11-23] "승인", to the recommendation R3-Q2 (A). A function that the proof
  accepts, and whose capacity no route can size (shape 5, `repeated`), draws a `TS8070` warning.
  Both halves show it, on the loop whose header the compiler cannot read. The sentence is new and
  sits under the existing code.
  - Rests on: OD-9 and OD-11.
  - Changes in the approved text: surface section 7 gains one `TS8070` sentence. The compiler and
    the language service emit it in stage S3 (`kernelLoopDiagnostics`). A12 section 4 names the
    warning for a loop the proof refuses only. This decision extends it to shape 5. No code is
    added.
- [decision, owner, 2026-11-23] "승인", to the recommendation R3-Q3 (A). A pull request closes
  A16 D1 first, before Route 3 stage S3. Then the `repeated` shape takes Route 2 on WebGPU, as
  A12 section 1, item 3 approves. The shape is an inner loop whose header reads an element of an
  array parameter at the outer counter, under an outer loop to that array's length.
  - Widening needs a proof or a call-time length check, because a read out of range differs
    between tiers.
  - An inner pushing `while` stays on Route 3 until S5.
  - Rests on: OD-11 (a device tier is not dropped silently) and OD-9.
  - Changes in the approved text: S3 does not start before that pull request merges. `repeated`
    is then no S3 case. A16 D1 stays open until that pull request closes it.
- [fact] The three decisions settle the design questions R3-Q1, R3-Q2 and R3-Q3. They settle
  items of A12: section 1, item 3 (R3-Q3), section 1, items 5.3 and 5.4 (R3-Q1) and section 4
  (R3-Q2).

**(c) do ... while (A-record of Route 3 S2, deviation 1, pull request #1481).**

- [decision, owner, 2026-11-23] "승인", to the recommendation: a later stage adds a bottom-tested
  loop to the IR and serves a pushing `do ... while` on Route 3. The stage comes after Route 3
  S3, in its own pull request.
- [fact] Until that stage merges, the `TS8099` refusal of a pushing `do ... while` stays an open
  deviation from A12. Rests on OD-10: the refusal says "not supported yet".
- Open item. Reason: the IR has no bottom-tested loop. Next action: the later stage, after Route 3
  S3.
- Affects: no front-matter entry, rule number or code changes by (b) and (c).
- Status: `status: accepted` does not change. S3 (#1476): decisions (1) to (3) recorded; the
  implementing pull request for (2) and (3) is not started. Route 3: R3-Q1 to R3-Q3 decided; A16
  D1 closing pull request not started; S0 to S5 not started. `do ... while`: open deviation.

### A18. Status and deviations of the slices merged on 2026-11-23 and 2026-11-24 (2026-11-24)

- [fact] This amendment is written on `main` at `de7f742d`. It follows A17 in number only. It
  records the status and the deviations of the pull requests that merged after A16 was written.
  Each pull request body states its own deviations. The bodies and the merged code on `main` are
  the sources.
- [fact] No earlier amendment changes. Where an earlier status line is out of date, this
  amendment says so under "Earlier status lines that are out of date".
- [fact] A "bug fix" below is a pull request with `Change: none`. It implements no sentence of
  this change. It is listed because it closes or opens a deviation of a pull request of this
  change.

**(a) S2c: a list of integer-written numbers (A3), pull requests #1474, #1477 and #1480.**

- [fact] #1474 is done. Merge commit `229bf084`. It implements A3, stage S2c, items 1 to 4. Item 5
  (the interim refusal) was already on `main`. `list-uses.ts` in
  `src/compiler/ts/lower/expression-array/` decides the element type from the uses of the list.
  Where no use decides, the type is `f32` (OD-7).
- [fact] #1477 is done (bug fix). Merge commit `23f2f810`. The language service drops the
  `TS2345` that it drew at an array parameter for a list with a conflict
  (`repeatsRefusedListUses` in `src/language-service/diagnostics/refused-list.ts`).
- [fact] #1480 is done. Merge commit `3eaa8282`. A module-scope `let` list takes its type as a
  module `const` list does (`src/compiler/ts/module-vars/untyped-list.ts`).
- [fact] #1480 closes a deviation. S2a (#1372) and S2c promised a module-scope `let` list in
  surface section 18, and the code refused it with `TS8033`. No rule or surface text changed.

Deviations of #1474.

1. The conflict sentence is the sentence of a `let`:
   `Cannot infer "a": its uses require i32 and u32. Write an explicit type annotation on "a" ...`.
   A3, item 2 names the remedy
   `const a: array<u32, 3> = [...]`. The sentence asks for an annotation but does not spell it.
   Disposition: open. Next action (proposal):
   the owner decides whether the sentence must spell the example.
2. Where a whole use conflicts with another use, the editor showed one `TS2345` for each
   `array<T, N>` parameter, beside the shared `TS8003`. `compile()` showed the `TS8003` only.
   Disposition: closed by #1477 (merge commit `23f2f810`).
3. `s += a[i]`, with a typed `u32` `s`, does not decide the element type and is refused with
   `TS8003`. A `let` gives the same refusal (`let k = 1; s += k`). Disposition: open. Next action
   (proposal): the owner decides whether to widen both forms in one change.
4. A module-scope `as const` integer list takes its type from its uses (S2 already allowed that
   form at module scope). A function-local `as const` list stays refused with `TS8099`.
   Disposition: open. Next action (proposal):
   the owner decides whether A3 states the module-scope case.

Deviations of #1480.

1. No deviation from the approved text. Disposition: closed.
2. No test pins a hand-annotated module `let` list beside the untyped form in the editor. Four
   forms of a module `let` list were probed with `compile()`: a spread, a vector element list, a
   nested list and a length mismatch. Each one matches the module `const` form. No test covers
   these. Disposition:
   open. Next action: a test in a bug-fix pull request, when one of them fails.

**(b) S3: inferred storage access (decisions D3 and D4), pull request #1476.**

- [fact] #1476 is done. Merge commit `698af76f`. A bare `storage<T>` is `var<storage, read_write>`
  when an entry writes it, and `var<storage, read>` otherwise. `storage-access.ts` in
  `src/compiler/ts/` holds the inference. `storage<readonly T[]>` stays a promise of no write.
- [fact] The decisions (1) to (3) of A17 (a) settle deviations 1 to 3 below. The implementing
  pull request is #1494. It is open, in draft, and not merged.

Deviations of #1476.

1. Surface sections 9 and 23 were false after S3, and 0114 did not list them. Disposition: made
   part of the approved text by A17 (a), decision (1). Closed when #1494 merges.
2. A write in a helper that no entry reaches, to a bare binding, draws `TS8005`. Disposition:
   settled by A17 (a), decision (2). Closed when #1494 merges.
3. A vertex entry that only reads a binding declared `"read_write"` is accepted, as on `main`
   before S3. WebGPU refuses that layout. Disposition: settled by A17 (a), decision (3). Closed
   when #1494 merges.
4. Surface section 7 did not list the sentence for the write of a vertex entry: "WebGPU allows no
   writable storage buffer in the vertex stage, and the vertex entry ... writes ...". Disposition:
   open. Next action: check the section at the merge of #1494.
5. Decision D3 does not name the explicit `"read"` argument after S4. Disposition: open. Next
   action (proposal): the owner decides, before S4.
6. The `TS8005` remedy for a `"read"` binding names `storage<T, "read_write">`, a spelling that D3
   removes in S4. Disposition: open. Next action: change the sentence in S4.
7. A program with a bare binding that no entry writes lowers twice (a provisional `read_write`,
   then `read`), inside the inference loop. Disposition: open, a cost of the design. Next action:
   measure the compile time if a program shows a cost.

- [fact] The layout cache of the runtime (`#layouts` in `src/runtime/program.ts`) keys a layout by
  its entries, which hold `buffer.type`. A changed mode gives a new key. Only a layout that a host
  built from an older `reflect()` can break. This is a cost of the design.

**(c) Route 3 (A12, S5d slice 3), pull requests #1479 and #1481.**

- [fact] #1479 is done. Merge commit `37439d9d`. It holds stages S0 and S1: the growing store on
  the CPU tier (`src/core/host-kernel-made/growing.ts`, growth mode in `pushOnto` of
  `src/core/pushed-index.ts`). No front-end code sets `growing`, so no author program changes.
- [fact] #1481 is done. Merge commit `31394a93`. It holds stage S2. Shapes 1 to 4 of A12 take
  Route 3. One shape is a `while`. One shape is a `for` that is no count. One shape is a loop under a `switch`. One shape is a loop under a branch inside a loop.
  `routeOf` in `route.ts` decides the route in one place. The call runs on the
  CPU tier only, and returns the elements pushed, in the order of a sequential run (OD-5).
- [fact] #1481 adds a WebGPU journey for `inside` (a loop under a branch inside a loop, Route 2).
  The `journeys/_host-import` cases are `inside`, `insideCpu` and `evens`.
  `inside` on WebGPU equals the CPU tier and the reference. `insideCpu` is the CPU tier run of
  `inside`. `evens` is Route 3 and runs on the CPU tier. A WebGPU-only runtime refuses `evens`
  with `TS8070`.

Deviations of #1479.

1. The growing flag is a `WeakMap` of limits, not a plain flag, because the limit is per store.
   Disposition: closed in #1479.
2. The new files carry no `Implements:` or `Verifies:` marker, so `reqs/` is unchanged. Disposition:
   open. Next action: add the markers with the first test that cites Rule 8.23 for Route 3.
3. Route 1 equivalence is tested for the scalar element only. Disposition: open. Next action: a
   test for a vector element, with Route 3 stage S3.
4. The push-to-failure measurements of the design (Bun and V8) were not run. Disposition: open.
   Next action: run them before stage S3 of Route 3.
5. The bundle caps in `scripts/bundle-budget.json` were raised to the measured values (a few
   hundred bytes). Disposition: closed, the values are the measured ones.

Deviations of #1481.

1. A pushing `do ... while` stays refused by the front end (`TS8099`). A12 section 1, item 4 gives
   it to Route 3. Disposition: open. A17 (c) records the later stage, after Route 3 stage S3.
2. A loop under a branch inside a loop that `countable` proves took `refusedNest` before. It now
   takes Route 2 and keeps its WebGPU plan. Disposition: closed by the journey case `inside`. It
   equals the CPU tier and the JavaScript reference for n = 0, 1, 3, 4 and 64.
3. The remedy of the refusal of a push outside every loop changed. The old wording is
   `Push onto it inside a for loop at the top level of "f".`. The new wording is
   `Push onto it inside a loop of "f".`. Disposition:
   open. Next action (proposal):
   the owner decides whether the new wording is the approved wording.
4. In `host-kernel-grown-elements.test.ts`, the case `overwrite` expects the reason of the proof
   (`TS8070`). This follows the reason order of `cpuOnly`. The order is the proof, the growing
   reason, then the access. Disposition: open. Next action
   (proposal): the owner decides whether this order is the approved order.
5. `while (i < xs[0])` takes Route 3. The counted `for` with the same bound stays `TS8099` until
   change 0144, stage A3 (A12 item 5.4). Disposition: open. Next action: change 0144 stage A3.
6. Three pre-existing defects were found and left unchanged. Item (d) below records them. Each
   one is closed or open there.

**(d) Bug fixes for the three defects of #1481, deviation 6.**

- [fact] #1486 is done (bug fix). Merge commit `8b10cf07`. `pushOnto` stores a copy of a vector.
  Before, a later write to the vector changed the element pushed, on the CPU tier. Disposition
  of deviation 6, first defect: closed.
- [fact] #1490 is done (bug fix). Merge commit `91cd7047`. A made array that holds a write at the
  length counts these writes in `.length`. `lengthFromHost` reads `pushCount` for a grown array.
  Disposition of deviation 6, second defect: closed.
- [fact] #1491 is done (bug fix). Merge commit `de7f742d`. An access sentence quotes `out.length`,
  not `pushCount(out)`, and quotes the checked index as the author wrote it. Disposition of
  deviation 6, third defect: closed.
- [fact] #1490 left one defect open. A write at the length outside every loop, after a loop that
  wrote at the length, throws a `RangeError` for n >= 1. JavaScript returns n + 1 elements. The
  throw is loud, not silent. Disposition: open. Next action: a bug-fix pull request with a test
  that reads both halves.
- [fact] #1489 (merge commit `9d45ef40`) corrected the comment baseline. It is no change of 0114.
  It lets `src/comment-policy.test.ts` pass on `main` again, which #1490 and #1491 needed.

**Earlier status lines that are out of date.**

- A3, last line: "S2c: not started". S2c is done: #1474, with #1477 and #1480.
- A17 (a), the Status line: "the implementing pull request for (2) and (3) is not started". The
  pull request is #1494, open and in draft.
- A17, last Status line: "A16 D1 closing pull request not started; S0 to S5 not started". The
  pull request that closes A16 D1 is #1495, open and in draft. Route 3 S0 and S1 are done
  (#1479). Route 3 S2 is done (#1481). Route 3 S3 to S5 are not started.
- A2, S1 status: A16 (b) corrected it already. This amendment does not repeat it.

**Open pull requests.**

- #1494, in progress. It implements decisions (1) to (3) of A17 (a). It is not merged.
- #1495, in progress. It implements R3-Q3 (A) and closes A16 D1. It waits for the owner's "merge".
  It changes how an author's program is accepted: `repeated` goes from refused to accepted.

- Affects: no front matter, rule number or code changes. The feature pull requests above
  implement text already recorded. The bug fixes implement none.
- Status: `status: accepted` does not change. S2c: done (#1474, #1477, #1480). S3: done (#1476);
  decisions (1) to (3) in progress (#1494). Route 3: S0 and S1 done (#1479); S2 done (#1481); S3
  to S5 not started; A16 D1 in progress (#1495). Open items: #1474 deviations 1, 3 and 4; #1476
  deviations 4 to 7; #1479 deviations 2 to 4; #1480 deviation 2; #1481 deviations 1, 3, 4 and 5; the defect that
  #1490 left; `do ... while`.

## What it owes downstream

- **typeshade.github.io:** every page that spells `array<T>`, `array<T, N>(...)`, `fill<T, N>(v)`
  or `storage<T, "read_write">`, at the stage that changes it. Not searched from this session.
- **vscode-typeshade:** the completions, snippets and skill text that suggest those spellings.
  Not searched from this session.
