---
id: '0143'
title: A kernel function makes an array whose length its arguments give, as TypeScript makes one (proposal 0114), and returns it
status: draft
rules:
  - '8.21'
  - '8.22'
  - '8.23'
  - '11.13'
surface:
  - 20
  - 64
  - 65
exports:
  - HostExport
exports-removed: []
codes: []
examples: []
names: []
downstream:
  - repo: typeshade.github.io
    what: The reference pages for Rules 8.21, 8.22 and 8.23 and the pages for surface §20, §64 and §65 gain the result form; no page that writes the parameter form changes.
  - repo: vscode-typeshade
    what: The skill's description of a kernel function gains the result form; compiler-changes.md records 0143 when the pin moves.
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0143, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                          |
| Date and attribution          | Drafted 2026-11-17 (UTC) by an AI agent (Claude Code) at the owner's request. Revisions 2 to 4, the same day, record the owner's answers and three independent reviews. Revision 5, the same day, moves the spelling onto accepted proposal 0114, at the owner's decision.                                                                                                                                                                         |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-17, in Korean. Asked whether `render(k: vec4, size: u32): array<f32>` can replace an `out` parameter, and, told it cannot: "안되는건 사실 말이 안되죠? typeshade 는 typescript 와 같은 계열의 언어인데".                                                                                                                                                                                  |
| Applicability / effectivity   | Expected: Rules 8.21, 8.22, 8.23 and 11.13 of `docs/language-design.md`; surface §20, §64 and §65; the front end (`src/compiler/ts/lower/runtime-array.ts` and the kernel-function analysis); the host call on WebGPU, WebGL2 and the CPU tier (`src/core/host-kernel.ts`, `src/core/host-kernel-gl.ts`); the host face (`HostExport`) and the host view; the ambient library (`src/language-service/ambient.ts`). No release version is assigned. |
| Review baseline               | `main` at `7513a9a` (merge of pull request #1350), read on 2026-11-17.                                                                                                                                                                                                                                                                                                                                                                             |
| Review and revision authority | Pull request #1351 (draft). Git records the revisions of this file. The review and the merge of the proposal's pull request record the decision.                                                                                                                                                                                                                                                                                                   |

## What changes

A kernel function can make one array whose length its arguments give, write it, and return
it. It makes the array as TypeScript makes one, in the spellings accepted proposal 0114 gives
the surface. The host knows the length before the kernel runs, so the host call allocates the
storage and gives it back as the result.

Before, at proposal 0142 stage 1 (#1324, which removes `@inout`) and 0114 stage S1 (#934,
`T[]`), the author writes the result as a parameter:

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

After this change, the author may also write it as a result:

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

The parameter form stays.

### How this extends proposal 0114

Proposal 0114 (accepted 2026-11-02, not implemented) decides how an array is written:

- an array whose size is unknown is TypeScript's array, `T[]` (stage S1); `array<T>` leaves the
  surface (S4);
- a value is built as TypeScript builds it: `new Array(N).fill(v)`, `new Float32Array(N)`,
  `Array.from({ length: N }, f)` and an array literal give `array<T, N>` when `N` is a constant
  (S2); the constructor `array<T, N>(...)` and `fill<T, N>(v)` leave the surface (S4).

This proposal takes the same constructors where `N` is no constant: in a kernel function, with a
length its arguments give, the result is a `T[]` whose storage the host call allocates. It adds
no spelling of its own.

### What refuses the second form today

At `main` `7513a9a`, these refusals stand in the way. 0114 lifts the spellings; this change
lifts the rest, for the shape below only.

1. The result: `TS8020`, "This function returns array<f32>, an array with no size, which lives
   only in a storage binding because its length is known only when the host binds it. Read the
   binding by its name where the value is needed." (`runtime-array.ts`,
   `refuseRuntimeArraySignature`).
2. The local: a local whose type holds an array with no size is `TS8099` (surface §20,
   `refuseRuntimeArrayLocal`).
3. The constructors: `Float32Array` is `TS8022` ("Unknown identifier") in both halves, and
   `Array` has no constructor in the ambient library. 0114 S2 adds them, for a constant length.
4. The kind: under Rule 8.22, a function is a kernel function only if it takes an array with no
   size or a 2D storage texture, so `render(k, size)` is a helper; and Rule 8.22's body shape
   allows only "an optional `return` of scalars".

### The rules, in short

1. Rule 8.22: a kernel function is also an exported function whose result is an array with no
   size (`T[]`, or `array<T>` until 0114 S4), with `T` a type a kernel's array parameter may
   hold.
2. Rule 8.23: the function makes one array with one of 0114's constructors and a length `n`
   that rule 4 admits:
   - `new Float32Array(n)`, `new Int32Array(n)`, `new Uint32Array(n)`, `new Float64Array(n)`:
     `n` zeros of the scalar, as in JavaScript;
   - `new Array<T>(n).fill(v)`, for any `T` the array may hold: `n` copies of `v`, as in
     JavaScript.
3. Rule 8.23: it makes the array as a `const` at the top level of its body, before its first
   candidate loop, or, in a function with no loop (Rule 8.22, decision D7), before its first
   store.
4. Rule 8.23: `n` is a `u32` or an `i32` (OD-7). It may read only these operands, which the host
   can evaluate before the dispatch:
   - a scalar value parameter, a component of a vector parameter, a field of a struct
     parameter;
   - a module constant;
   - the `.length` of an array parameter;
   - an integer literal, and the casts `u32(…)` and `i32(…)` of a listed operand;
   - a top-level `const` of the function whose initializer reads only listed operands;
   - integer `+`, `-`, `*`, `/`, `%`, `min` and `max`, with the program's arithmetic:
     `size * size` of two `u32`s wraps as a `u32` does, and `/` and `%` by zero follow WGSL's
     integer rules.
5. Rule 8.22's body shape: the new array is one of the function's arrays. Its loops write and
   read it, the stores after the last loop store into it, and the function ends with
   `return out` on every path. `out.length` reads `n` on every tier.
6. Rule 8.21: the result's host value is the one a kernel's array parameter takes (Q2): the
   scalar's typed array, a vector's components one after another, an array of objects for a
   struct. The host view gives one type, not the parameter's union: `Promise<Float32Array>` for
   `f32[]` or `vec4f[]`, `Promise<T[]>` for a struct `T`. The caller owns the result and may
   write it.
7. Rule 8.21, on a resource: the result is a new `Buffer` on the device the call ran on: a
   `Buffer` of the scalar for a scalar or a vector element, a `Buffer<C>` for an element of an
   exported class `C`, as Rule 8.21 gives for a parameter. The caller owns it and disposes it
   (Rule 11.8).
8. The host call treats the new array as an array parameter of `n` elements. Whatever each tier
   does with such an array, it does with this one:
   - WebGPU: the storage binding and its size limit;
   - WebGL2: the data texture of 2048 columns (`host-kernel-gl.ts`, `MAX_W`) and its limit;
   - the CPU tier: a typed array, with JavaScript's limit.

   A negative `n` (an `i32`) is refused before anything runs, with a `RangeError` that names
   the function and the length, as JavaScript's constructors throw one. For `n = 0` the result
   is empty, and the call binds one element in its place.

9. Indices past the end: the call makes every check against `n` that it makes for an array
   parameter, reads included (`a*i + c` with its guards, strides `i*k + b`, rows `i*W + x`), and
   refuses before anything runs with the `TypeError` the parameter form gives for an array too
   short (Rule 8.21). The sentence names the function and the result, not a parameter, and both
   numbers. A loop whose range the device holds drops such a write, as it does for a parameter
   (change 0094).
10. Refused as "not supported yet" (OD-9), in both halves, with `TS8099`, each with a sentence
    that names the form and says it is not supported yet:
    - one of these constructors with a length that is no constant anywhere else: in a helper,
      in an entry, inside a loop, under a branch;
    - a length that reads any operand rule 4 does not list;
    - `new Array<T>(n)` with no `fill`: JavaScript gives an array of holes, which a shader value
      cannot hold;
    - `Array.from({ length: n }, f)` with a length that is no constant;
    - a second new array, or a new array the function does not return;
    - a path that returns a parameter (`return ps`, 0142 Table 2) and another that returns the
      new array;
    - `out.push(v)`, a second name for `out` (`const o = out`), and `out` passed to a helper;
    - a kernel function that has a 2D storage texture and makes an array;
    - the result fed to another call inside one fusion (Rule 11.13), until the fuse facts
      describe it.
11. Kept as today: a result of an array with no size that is no new array, and a struct whose
    last field is one, stay `TS8020`.

### The editor (Rule 12.7)

- 0114 S2 declares the constructors in the ambient library. This proposal needs one thing more
  of them: a length typed `u32 | i32` that is no literal gives `T[]`, not `array<T, N>`.
- The editor cannot refuse an `f32` length by type alone (the brands are optional), so the
  compiler checks the length's type and the editor reports the compiler's `TS8003` with its
  sentence.
- `out` is a `T[]`: its index reads a `T`, its `.length` is a `u32`, and its hover shows `f32[]`.
- Each refusal above is reported by the editor with the compiler's code and sentence.

## Why

- [fact] TypeScript returns a new array from a function; the language borrows TypeScript's way
  of writing (OD-1), and 0114 already applies that to arrays. Writing the result as a parameter
  is the shape C and WGSL force.
- [fact] `TS8020` gives a target's reason: WGSL has no array whose length a call chooses. OD-9
  says a target's lack is no reason to refuse a form.
- [inference, agent; checked by the independent reviews] The rewrite exists. The host call
  already checks, uploads and reads back a kernel's arrays (`host-kernel.ts`). With the length
  known before the dispatch, it allocates the storage, binds it where the parameter form binds
  `out`, and returns the read-back of that binding.

### Costs of the owner's decisions

- Following 0114: this proposal cannot be implemented before 0114 S1 (`T[]`) and S2 (the
  constructors, and `fill` that gives its array back, which today gives nothing, change 0079).
- `Float32Array` and its siblings spell scalars only. A vector array is
  `new Array<vec4f>(n).fill(vec4f())`.
- Q2, a typed array: a vector array comes back flat (`vec4f[]` is a `Float32Array` of `4n`
  scalars), as a parameter takes it.
- A write past the end is refused before the run for a parameter and for the result alike
  (rule 9), so the two forms agree; WGSL's robust access, which may clamp, is not relied on.

## Owner's decisions

This proposal rests on OD-1 (TypeScript's way of writing), OD-3 (the compiler allocates; the
author states only the length), OD-5 (each constructor has its JavaScript meaning; a returned
array is the caller's from then on), OD-7 (a literal length takes the type its use needs) and
OD-9 (a target's lack of a form is no refusal reason; a form the compiler does not implement yet
is refused as such). It reverses no entry. It follows accepted proposal 0114 and adds no spelling
of its own.

### The owner's answers

- Q1, the spelling: **the spellings of proposal 0114** (`new Float32Array(n)`,
  `new Array<T>(n).fill(v)`, `T[]`), 2026-11-17 (the owner's "좋아요").
  - History: the owner first chose `array<T>(n)` the same day, among three options the agent
    offered, and then discussed `array(n)` against `array.of(x)`. The agent had not shown the
    owner that accepted proposal 0114 already decides how an array is written; neither had the
    three reviews. Shown it, the owner asked how TypeScript would write it and chose 0114's
    spellings. The `array<T>(n)` design, its Rule 9.2 exception and `array.of` are withdrawn.
- Q2, the result's host value: **A, the value a kernel's array parameter takes**, 2026-11-17
  (the owner's "네" to the recommendation).

## Why the compiler cannot do it

The author must state the length: the compiler cannot know how many elements the caller wants.
The binding, the allocation and the read back are the compiler's. The change adds a rule; it
adds no name, binding, qualifier or attribute (OD-3); the constructors' names are 0114's.

## What it touches

- Rule 8.21: the result's host value, with a plain call and on a resource.
- Rule 8.22: the kind, and the body shape.
- Rule 8.23: which constructors make the array, where, its length, its `.length`.
- Rule 11.13: the refusal of a result fed to another call inside one fusion.
- Surface §20 (a local array with no size), §64 (the host call's result) and §65 (the kernel
  loop).
- `exports`: `HostExport`. A kernel function's entry (its `face`, a `KernelFace`) gains the
  length expression, which the host call evaluates from the arguments. `src/__api__/surface.md`
  prints `HostExport` with `face: KernelFace` only, so the implementing pull request checks
  whether the bake shows the change and amends this entry if it does not.
- `codes`: none new. The refusals reuse `TS8099` ("not supported yet") and `TS8003` (the length's
  type); `TS8020` stays for every other function shape.
- `examples`: none added or removed. `loop-kernel` may gain the result form in the implementing
  pull request.
- `names`: none. The constructors are 0114's.

### Draft impact estimate

- Prerequisites, in order: proposal 0142 stage 1 (#1324); proposal 0114 S1 (#934) and S2. All
  edit the same rules and the same array code.
- Expected slices: the front end with the editor; the host face and the host call on three
  tiers; the example and its goldens. Duration unknown.
- Note: the zero fill gives a written-only array the upload skip that 0142 lost with `@out`
  (0142's recorded cost).

### Independent review record

Revisions 1 to 4 were reviewed three times on 2026-11-17, each time by an AI agent (Claude Code)
that did not write the revision. Their findings and the answers are in this file's history
(revision 4, `09bbd9d`). In short:

- Revision 1 (`a5e336c`), 14 findings: the options' names and costs, the refusals of today,
  Rule 8.22's body shape, 0142 as a prerequisite, the missing cases, the editor half, the front
  matter. All answered.
- Revision 2 (`12c65a6`), 12 findings: the §9.3 mechanism (blocking), the one-argument trap, the
  length's operands, `.length` at zero, the tiers' limits, writes past the end, the host type and
  its ownership, `downstream`. All answered.
- Revision 3 (`42f63a4`), 7 findings: the source of the Rule 9.2 exception, literals and casts in
  the length, every index check, `Buffer<C>`, `tailResult`, the two spellings, Rule 11.13. All
  answered.

What revision 5 keeps from those answers: rules 3 to 11 and the editor's length check. What it
drops: the `array<T>(n)` spelling, its Rule 9.2 exception, the overload placement, and the costs
that belonged to that spelling.

None of the three reviews compared the proposal with accepted proposals beyond 0142. Revision 5
is not reviewed yet; its review checks it against every accepted proposal that touches arrays,
0114 first.

### Approval and plan record

This record does not yet apply. Acceptance will require a review of revision 5 and a merge of
this file as `accepted`.

### Configuration and validation record

This record does not yet apply. Delivery will require both halves' tests of the new form and of
each refusal, the three tiers holding one result, and, if `loop-kernel` gains the form, its
goldens.

## What it owes downstream

- `typeshade.github.io`: the reference pages for Rules 8.21, 8.22 and 8.23 and the pages for
  surface §20, §64 and §65 gain the result form. No page that writes the parameter form changes.
- `vscode-typeshade`: the skill's description of a kernel function gains the result form;
  `compiler-changes.md` records 0143 when the pin moves.

Each is expected work; none is started.
