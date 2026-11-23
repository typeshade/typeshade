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
  - 14
  - 18
  - 20
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

### A12. The forms A7 left refused: an element of a grown array, a push in a nested or open loop, and a loop with an `f32` counter (draft, 2026-11-23)

- [fact] Status of this amendment: draft. It decides nothing. Questions Q1 and Q2 below are the
  owner's. The merge of its pull request, after the owner's answers, is its acceptance.
- [fact] Baseline: `main` at `b1622981` (2026-11-23).

**Why.**

- [fact] A7 made three forms of S5d part of the approved text as "not supported yet" refusals
  (`TS8099`, both halves; OD-9), "to be implemented in a later slice". This amendment designs that
  slice for each form: its meaning, its storage, its dependencies, what stays refused, its tests
  and one example.
- [fact] OD-10 says that the compiler handles the storage of a dynamic array: at compile time
  where it can ("a capacity it computes from the program, a second pass, or another form with
  the same result"), and with a heap it manages at run time where it cannot. A form the compiler
  does not implement yet is "not supported yet", never impossible.
- [observed, 2026-11-23, `bothHalves` of `src/core/testing/both-halves.ts`, Bun 1.4.4, a tree
  equal to `b1622981`] Each form is accepted today on an array parameter (changes 0078 and 0094),
  whose host array is the capacity. The two halves agree on every row.

| Source                                                     | The grown array (`const out: T[] = []`) | The same loop on an array parameter                                                      |
| ---------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| Example 1 below: `out[j] = out[j] / total` in a later loop | `TS8099` (A7 item 1)                    | no diagnostic                                                                            |
| `out[0] = 2.` after the last loop                          | `TS8099` (A7 item 1)                    | no diagnostic (`s[0] = out[0]` after the loop)                                           |
| Example 2 below: a push in a loop inside a top-level loop  | `TS8099` (A7 item 2)                    | no diagnostic                                                                            |
| A push in a `while` inside a top-level loop                | `TS8099` (A7 item 2)                    | no diagnostic                                                                            |
| A push in a top-level `while`                              | `TS8099` (A7 item 2)                    | `TS8070` warning: "This loop runs on the CPU because it is an open loop, …"              |
| A push in a loop under a branch                            | `TS8099` (A7 item 2)                    | `TS8070` warning: "This function runs on the CPU because line 2 is neither a loop nor …" |
| Example 3 below: a push in a loop with an `f32` counter    | `TS8099` (A7 item 3)                    | `TS8070` warning: "This loop runs on the CPU because it is an open loop, …"              |
| `out.push(f32(out.length))` in the loop that pushes        | `TS8070` warning, accepted              | `TS8070` warning, accepted                                                               |

- [fact] So the parameter form already gives each of these loops its JavaScript order, on the
  tier that runs it (Rule 8.22, Rule 8.23). The grown array lacks two things only: a capacity
  that the call can reserve, and a meaning for an index at or past its length.

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
   1. A counted loop nested in a counted loop, whose start and bound read only the operands A1
      item 4 lists: the product of the trip counts, times the pushes in one inner iteration.
   2. A loop under a branch: the loop counts as if the branch is taken. A6 item 2 counts a
      conditional push as one in the same way.
   3. A `for` loop that is not counted (an `f32` counter, a step `i *= 2`), whose initializer,
      condition and update read only listed operands and its own counter, and whose body does
      not write the counter: the host runs the header alone, with the program's arithmetic,
      and counts the trips. A nest whose headers read only listed operands and the counters of
      the loops around them may be counted the same way.
   4. An element write that the compiler cannot prove inside the length (section 2, item 2)
      counts as one push. It replaces an element or appends one, since a write past the length
      is not supported (section 2, item 3).
3. Route 2 applies to a top-level loop that the proof of Rule 8.22 accepts, whose range the host
   knows, and whose pushes Route 1 cannot bound: an inner loop whose header reads an element or
   a value of the iteration, or an inner `while`.
   1. WebGPU: the call runs the count and scan steps of change 0078, reads back the total,
      reserves that many elements, and runs the store step.
   2. The CPU tier: it runs the same count step, which stores nothing but the counts, and then
      runs the loop as written.
   3. Where two loops push, the call reserves before each store step and keeps the elements
      that earlier loops stored. On WebGPU that can be a copy on the device.
   4. Cost: one more read from the device for each such loop.
   5. [assumption] The proof accepts these inner loops on a grown array as it accepts them on an
      array parameter (observed above). The implementing pull request confirms it.
4. Route 3 applies to a loop that the call cannot count before its iterations run: a top-level
   `while` or `do … while`, a `for` whose body writes its counter or whose header reads another
   value, and a loop inside one of these.
   1. [fact] Each such loop runs on the CPU tier already (Rule 8.22, R1; `TS8070`), as for a
      parameter. No GPU tier runs it, before or after 0144.
   2. When Route 3 lands is question Q2.
5. A capacity past a tier's limit does what A1 item 8 gives. A loop whose range the device holds
   stays with A6 item 5 and change 0144, stage A3. This amendment does not change it.

**2. Form 1: an element read or write of the grown array.** [proposal]

Meaning. The meaning is that of a JavaScript array (OD-5), at that point of a sequential run:

1. A read `out[k]`, with `0 <= k < out.length`, gives element `k`.
2. A write `out[k] = v` with `k < out.length` replaces element `k`. With `k === out.length` it
   appends `v`, as `out.push(v)` does, and the length grows by one. A compound write
   (`out[k] += v`, `out[k]++`) is a read, then a write.
3. These have a JavaScript meaning that the compiler does not represent yet. They are not
   supported yet (OD-9, OD-10):
   - a read at `k >= out.length`, which gives `undefined` in JavaScript. Change 0093 represents
     an optional value, not an element that is not there;
   - a write at `k > out.length`, which leaves holes in JavaScript (A1 item 11);
   - a negative `i32` index, which reads or writes a property in JavaScript, not an element.

   How these are refused, at compile time or at the call, is question Q1.

Where it runs:

4. In a loop that also pushes onto `out`: the loop runs on the CPU tier (Rule 8.22, R4;
   `TS8070`), as for a parameter. The run is sequential, so items 1 to 3 hold as written.
5. In a later loop that does not push onto `out`: the loop is a candidate loop, as for a
   parameter. When the index is the loop's counter and the range is inside `0 .. out.length`
   (`j < out.length`), the compiler proves every access inside the length. The loop then runs
   on WebGPU, over a range the device holds (change 0094). A write that the compiler cannot
   prove inside the length makes the loop run on the CPU tier, since an append moves the length
   for the iterations after it. `TS8070` names the write.
6. After the last loop (change 0094, part 3, stores after the loops): on WebGPU the stores run in
   the finish entry, one invocation in program order. It reads the count the loops left, so
   items 1 to 3 hold as written.
7. In a statement between two loops: the function runs on the CPU tier, as Rule 8.22 runs a
   function whose statement before its last loop writes an array.
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
- With Q1 (A) only, a read and a write that the compiler cannot prove inside the length:
  `"out[k]" reads an element of "out", the array "f" grows with push, at an index the compiler
cannot prove is below its length; a read past the length is not supported yet. Index it by the
counter of a loop up to out.length.` A write says `writes` and `is at most its length`.
- With Q1 (B), the call throws instead (no editor half, since the editor cannot see the run):
  `RangeError: f(): "out[k]" reads index 7 of "out", whose length is 5 there. A read past the
length is not supported yet.` A write says `writes index 9` and `A write past the length`.

The sentence of A7 item 1 retires.

Example 1. Before, both halves give `TS8099`: `"out[j]" writes an element of "out", the array
"keepScaled" grows with push, and that is not supported yet. …`. After, both halves give no
diagnostic. The second loop runs on WebGPU over a range the device holds, as its parameter form
does today.

```ts
export function keepScaled(xs: f32[], t: f32): f32[] {
  const out: f32[] = [];
  for (const x of xs) {
    if (x > t) {
      out.push(x);
    }
  }
  const total = f32(out.length);
  for (let j: u32 = 0; j < out.length; j++) {
    out[j] = out[j] / total;
  }
  return out;
}
```

**3. Form 2: a push in a nested loop, in a `while`, or in a loop under a branch.** [proposal]

Meaning. The pushes append in the order of a sequential run, as Rule 8.23 gives them for an
array parameter: loop by loop, iteration by iteration, and statement by statement, with the
iterations of an inner loop in their order. The result is the elements pushed, in that order.

Where it runs. Each form runs on the tier that runs its parameter form today (observed above):

1. A push in a loop nested in a top-level loop: the top-level loop runs on WebGPU when the proof
   of Rule 8.22 accepts it. One invocation runs one whole iteration, inner loop included, so
   change 0078's count, scan and store keep the order.
2. A push in a top-level `while`: the loop runs on the CPU tier (R1, `TS8070`).
3. A push in a loop under a branch: the function runs on the CPU tier (`TS8070`).

Storage:

4. Nested counted loops with listed operands: Route 1 (section 1, item 2.1). A nest whose
   headers read the counters of the loops around them: Route 1 (item 2.3) or Route 2.
5. A nested loop whose header reads an element or a value of the iteration, or an inner `while`:
   Route 2.
6. A loop under a branch: Route 1 (item 2.2), when its own header is one Route 1 counts.
   Otherwise the rule for that header applies.
7. A top-level `while` or `do … while`, and a loop inside one: Route 3.

Dependencies: items 4 to 6 need nothing of change 0144. Item 7 is question Q2.

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
the capacity comes from Route 2 (or from the headers, item 2.3).

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

Meaning. The loop runs as JavaScript runs it. The counter steps with the program's arithmetic:
its type comes from its uses, and is `f32` where no use decides (OD-7). The trip count is the
one a sequential run gives, with its rounding. Each trip's pushes append in order.

Where it runs. On the CPU tier (R1, `TS8070`), as its parameter form does today (observed above).

Storage:

1. Route 1 (section 1, item 2.3): before the dispatch, the host runs the initializer, the
   condition and the update alone, with the program's arithmetic, and counts the trips. The
   capacity is the trips times the pushes in one trip. The same holds for any `for` that is not
   counted, a step `i *= 2` included. Cost: the header's work on the host, at most the loop's
   own trips.
2. JavaScript's array length is at most 4294967295. So when the trips pass 4294967295, the host
   stops and the call throws, before anything runs: `RangeError: f(): "for (let x = a; x < b; x
+= h)" runs more than 4294967295 times, and a capacity past that is not supported yet.`
3. A header that reads another value, or a body that writes the counter: Route 3 (question Q2).

Dependencies: item 1 needs nothing of change 0144. Item 3 is question Q2.

Refused as "not supported yet", `TS8099`, the same sentence in both halves:

- With Q2 (B) only, for item 3: `"for (let x = a; x < b; x += h)" pushes onto "out", and its
header reads a value the call does not know before it runs, or its body changes its counter, so
the call cannot reserve room for "out" before it runs; that is not supported yet.`

The sentence of A7 item 3 retires for the loops Route 1 counts.

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
  `T`, and the hover on `out` equals the hover on an array parameter `out: T[]` (A1).
- Each `TS8099` above reaches the editor with the compiler's code and sentence.
- A `RangeError` of the call (Q1 (B), section 4, item 2) has no editor half. The tests read it
  at the call.

**6. What the implementing pull request tests and checks.** [proposal]

1. `bothTake` (`src/core/testing/both-halves.ts`) on examples 1 to 3: no error in either half,
   example 3's `TS8070` with one text in both, and the hover on `out` equal to the parameter
   form's.
2. `bothRefuse` on each refusal that stays, with its sentence.
3. The CPU tier against a JavaScript loop on the same inputs, for each example and for: an empty
   result; a read of the last element; a write at `out.length`, which appends; a compound write;
   a store after the loops; two loops on Route 2; a triangular nest; a loop under a branch taken
   and not taken; an `f32` step that rounds (`0.1`); a loop of zero trips; a step `i *= 2`.
4. With Q1 (B): the `RangeError` text of a read past the length, a write past the length and a
   negative index, and every caller array unchanged after the throw.
5. With Q2 (A): a top-level `while` that pushes, against a JavaScript loop.
6. WebGPU, in `journeys/_host-import`: example 1, example 2 and a store after the loops, each
   equal to the CPU tier.
7. The differential gate (`scripts/gpu-differential.ts`) gains grown arrays with nested pushes
   and element writes.
8. Measurements: the extra read of Route 2 against the parameter form's call, and the host time
   of Route 1's header run for three trip counts.
9. The gates of `AGENTS.md`: `bun run test`, the compile gate (Tint and WebGL2) on the count
   steps and the finish entry, `bun run docs:impact`, `bun run reqs:sync` with
   `python scripts/doorstop-check.py -C`, and `bun run changes:check`.
10. The document audit: the push sentence of Rule 8.22, the S5d paragraph of Rule 8.23 and its
    "Enforced by" list, and surface §63 and §65, against the delivered behaviour.

**7. Stages and dependencies.** [proposal]

| Slice          | Delivers                                                                                                                                       | Needs first                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| S5d slice 2    | Form 1 (section 2), form 2 on Routes 1 and 2 (section 3, items 4 to 6), form 3 on Route 1 (section 4).                                         | nothing; it can land now                                        |
| S5d slice 3    | Route 3: form 2, item 7, and form 3, item 3.                                                                                                   | Q2 (A): nothing. Q2 (B): change 0144, stage A3, on the CPU tier |
| change 0144 A2 | Routes 1 and 2 reserve a call region in place of a binding of their own. No program changes.                                                   | 0144 A1                                                         |
| change 0144 A3 | Route 2 may reserve a run region from the bump word in one submission, with no read between steps (the compiler's choice). No program changes. | 0144 A2                                                         |

**8. Check against the owner's decisions.**

| Entry | How A12 keeps it                                                                                                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| OD-1  | No new syntax. The author writes TypeScript's index, `push`, `while` and `for`.                                                             |
| OD-2  | Not touched.                                                                                                                                |
| OD-3  | The capacity and the route are the compiler's. The author states nothing for them.                                                          |
| OD-4  | One example before and after for each form. Q1 and Q2 show options and costs.                                                               |
| OD-5  | The array is a JavaScript array. Each accepted form has its JavaScript meaning. A form without one in TypeShade yet is refused and says so. |
| OD-6  | No release exists, so no warning release is owed.                                                                                           |
| OD-7  | The counter of form 3 takes its type from its uses.                                                                                         |
| OD-8  | Not touched.                                                                                                                                |
| OD-9  | The routes, the count pass and the header run are the compiler's code with the same result. Each refusal is "not supported yet".            |
| OD-10 | Compile time first (Routes 1 and 2), the heap second (Route 3). Nothing is refused as impossible.                                           |

**9. Questions for the owner.**

**Q1. An index that the compiler cannot prove inside the length.** Example: `out[0] = 2.` after a
loop whose push is conditional. JavaScript replaces element 0 when one was pushed, and appends
when none was. Both cases are supported. The question is only an index past the length, which
gives `undefined` or holes in JavaScript.

- (A) Refuse at compile time. The compiler accepts an access only where it proves the index
  inside the length, and gives `TS8099` elsewhere. Cost: `out[0]` after a conditional push is
  refused, and so is a later loop `j < n` that writes `out[j]`.
- (B) Check at the call. The compiler proves where it can. Elsewhere the call checks the index
  and throws a `RangeError` "not supported yet" before it writes any caller array. Cost: a
  program that compiles can throw for some inputs. Each unproved access costs a comparison, and
  on WebGPU a flag word read back with the results. A1 item 4 (a `RangeError` for a length), A1
  item 7 and A5 item 1 already refuse at the call in this way. [assumption] A call with plain
  data writes a caller array only when it copies the results back (change 0144, C11 item 1,
  states the same as an inference). The implementing pull request verifies it.
- Recommendation: (B). It rests on OD-5 and OD-9, since no accepted program runs with a meaning
  JavaScript would not give, and on OD-10, since the refusal says "not supported yet". It
  reverses no entry.
- Not offered: a read past the length that gives `0`, or the value a target's robust access
  gives. Such a read has a meaning JavaScript would not give (OD-5, OD-9).

**Q2. Growing storage before change 0144, stage A3.** Route 3 serves a top-level `while`, a loop
inside it, and a `for` that Route 1 cannot count. Each runs on the CPU tier only (section 1,
item 4.1).

- (A) Land with S5d slice 3, now. The CPU tier holds the array in storage of its own that grows
  as the run pushes. Change 0144, stages A1 to A3, later move it into the CPU tier's arena, with
  no change to the program. This is the pattern the owner chose for S5 in A1: a binding of its
  own first, the arena when it exists. Cost: a storage path outside the arena on the CPU tier
  until change 0144, stage A3.
- (B) Wait for change 0144, stage A3. These forms stay refused with the `TS8099` sentences of
  sections 3 and 4 until the CPU tier has run regions. Cost: the forms wait for A1, A2 and A3.
- Recommendation: (A). It rests on OD-10 (a heap the compiler manages at run time; storage that
  the CPU tier grows is one), OD-3 and OD-9. It reverses no entry, and no GPU tier runs these
  loops in either option.
- Not offered: refusing these forms for good. OD-10 says "not supported yet", never impossible.

**Independent review record.** Not yet performed. `changes/README.md` (Independent review)
requires one before the owner decides.

- Affects: section 2 (S5d items 1, 2, 5 and 6; A7 items 1 to 3). Rules 8.22 and 8.23 and surface
  §63 and §65 change in the implementing pull request. No front-matter entry changes: Rules 8.22
  and 8.23 and surface §63, §64 and §65 are declared, `TS8099` exists, and `Array.prototype.push`
  and `length` are in `src/__api__/author-names.md`.
- Status: `status: accepted` does not change. A12: draft, open on Q1 and Q2. S5d slice 2: not
  started. S5d slice 3: not started.

## What it owes downstream

- **typeshade.github.io:** every page that spells `array<T>`, `array<T, N>(...)`, `fill<T, N>(v)`
  or `storage<T, "read_write">`, at the stage that changes it. Not searched from this session.
- **vscode-typeshade:** the completions, snippets and skill text that suggest those spellings.
  Not searched from this session.
