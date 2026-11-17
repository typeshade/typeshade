---
id: '0143'
title: A kernel function returns a new array whose length its arguments give, as a TypeScript function returns one
status: draft
rules:
  - '8.21'
  - '8.22'
  - '8.23'
surface: []
exports: []
exports-removed: []
codes: []
examples:
  - loop-kernel
names: []
downstream: []
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0143, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                              |
| Date and attribution          | Drafted 2026-11-17 (UTC) by an AI agent (Claude Code) at the owner's request.                                                                                                                                                                                                          |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-17, in Korean. Asked whether `render(k: vec4, size: u32): array<f32>` can replace an `out` parameter, and told that it cannot: "안되는건 사실 말이 안되죠? typeshade 는 typescript 와 같은 계열의 언어인데".                  |
| Applicability / effectivity   | Expected: Rules 8.21, 8.22 and 8.23 of `docs/language-design.md`, the front end's kernel-function analysis (`src/compiler/ts/`), the kernel planner and the host call (`src/core/host-kernel.ts`), the host view, and `examples/loop-kernel.shade.ts`. No release version is assigned. |
| Review baseline               | `main` at `337d64a` (merge of pull request #1348), read on 2026-11-17.                                                                                                                                                                                                                 |
| Review and revision authority | No pull request is assigned yet. Git records the revisions of this file. The review and the merge of the proposal's pull request record the decision.                                                                                                                                  |

## What changes

A kernel function can make an array and return it. The length is an expression of the
function's value parameters, so the host knows it before the kernel runs.

Before, at `main` `337d64a`, the author writes the result as a parameter:

```ts
export function render(k: vec4, size: u32, @inout out: array<f32>) {
  for (let i: u32 = 0; i < size * size; i++) {
    const p = vec2(f32(i % size), f32(i / size)) / f32(size);
    out[i] = height(p, k);
  }
}

// host
const img = new Float32Array(512 * 512);
await render(k, 512, img);
```

After this change, the author may also write the result as a result. The spelling of the
new array is question Q1 below; this example uses option A, the recommendation:

```ts
export function render(k: vec4, size: u32): array<f32> {
  const out = new Float32Array(size * size);
  for (let i: u32 = 0; i < size * size; i++) {
    const p = vec2(f32(i % size), f32(i / size)) / f32(size);
    out[i] = height(p, k);
  }
  return out;
}

// host
const img = await render(k, 512);
```

Today both halves refuse the second form, at `main` `337d64a`:

- `compile()` and the editor report `TS8020`: "This function returns array<f32>, an array with
  no size, which lives only in a storage binding because its length is known only when the host
  binds it."
- Under Rule 8.22 the function is no kernel function at all, because it takes no array with no
  size.

### The rules, in short

1. Rule 8.22: a kernel function is also an exported function whose result is an array with no
   size (`array<T>`). Its candidate loops are found as they are today.
2. Rule 8.23: the function makes the array once, at its top level, before its first candidate
   loop. The length is an expression of the value parameters and of module constants. The new
   array holds the zero of its element type.
3. Rule 8.23: the function returns that array, on every path. A return of another array is
   refused, as "not supported yet" (OD-9).
4. Rule 8.21: called with plain data, the function returns `Promise<A>`, where `A` is the host
   value of `array<T>`: `Float32Array`, `Int32Array`, `Uint32Array`, or `Float64Array` for an
   `f64` (change 0013's split). Called on a resource, it returns a `Buffer` of the scalars.
5. A length that depends on what a loop computes is refused, as "not supported yet". The host
   must allocate the storage before the dispatch.

### Exclusions

- An array of structs or of vectors as a result. Option A of Q1 spells only scalars. Options B
  and C spell any element type; the choice decides this exclusion.
- A helper (not a kernel function) that returns an array with no size. It runs inside a shader,
  where WGSL has no array whose length a call chooses. OD-9 makes that the compiler's problem,
  not a refusal reason; this proposal leaves it to a later one and refuses it as "not supported
  yet".
- A function that returns one of its own array parameters (`return ps`). Proposal 0142 covers
  it (Table 2, stage 1).

## Why

- [fact] TypeScript returns a new array from a function; the language borrows TypeScript's way
  of writing (OD-1). Writing the result as a parameter is the shape C and WGSL force, not the
  shape TypeScript writes.
- [fact] The refusal reason `TS8020` gives is a target's: WGSL has no array whose length a call
  chooses. OD-9 says a target's lack is no reason to refuse a form; the compiler rewrites it.
- [inference, agent] The rewrite exists. The length is known on the host before the dispatch,
  so the host call allocates the storage, binds it as the kernel's `out` binding, and gives it
  back as the result. The kernel itself is the same kernel the parameter form compiles to.

### Alternatives

| Alternative                                           | Why it is not proposed                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Keep the parameter form only.                         | The owner said the refusal makes no sense for a language of the TypeScript family.        |
| Only fix the text of `TS8020` to "not supported yet". | It obeys OD-9 but leaves the form refused. It is the interim step, not the change.        |
| Allow any length, a loop's result included.           | The storage must exist before the dispatch. It needs a second dispatch; a later proposal. |

## Owner's decisions

This proposal rests on OD-1 (TypeScript's way of writing), OD-3 (the compiler allocates; the
author states only the length), OD-5 (an object behaves as a JavaScript object: a returned
array is the caller's from then on) and OD-9 (the target's lack of the form is no refusal
reason). It reverses no entry.

### Questions for the owner

**Q1. How the author makes the new array.** Each option is an ECMAScript spelling, as
`docs/language-design.md` §2.1 requires of a name an author writes.

| Option | Spelling                                                                | JavaScript meaning                                                       | Element types         |
| ------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------- |
| A      | `new Float32Array(n)` (and `Int32Array`, `Uint32Array`, `Float64Array`) | `n` zeros of that type, exactly                                          | scalars only          |
| B      | `new Array<f32>(n).fill(0)`                                             | `n` copies of the value; `fill` is already an array method (surface §63) | any type `fill` takes |
| C      | `array<f32>(n)`                                                         | none: no ECMAScript form; a TypeShade name                               | any                   |

- Recommendation: A, then B for vectors and structs in a later step. A's JavaScript meaning is
  exactly the result the compiler gives (zeros), and it is the host value a kernel's array
  already takes (Rule 8.21), so the host and the shader read one type.
- C adds an author-facing name that is neither WGSL nor ECMAScript. It is listed because the
  zero value of a sized array is written `array<T, N>()` today (change 0047).

**Q2. The result's host type.** Recommendation: the typed array of Rule 8.21, as for a
parameter. A `Buffer` for a call on a resource, as Rule 8.21 gives for a parameter.

**Q3. The interim text of `TS8020`.** Until this proposal is implemented, the refusal says the
form is not supported yet, as OD-9 asks, in its own pull request as a bug fix. Recommendation:
yes.

## Why the compiler cannot do it

The author must state the length: the compiler cannot know how many elements the caller
wants. Everything else is the compiler's: the binding, the allocation, the read back. The
proposal adds no binding, qualifier or attribute for the author to write (OD-3). Under option A
it adds no name either: `Float32Array` and its siblings are ECMAScript.

## What it touches

- Rule 8.21: the result of a kernel function called with plain data, and on a resource.
- Rule 8.22: a kernel function is also one whose result is an array with no size.
- Rule 8.23: where the new array is made, its length, its zero fill and its return.
- `loop-kernel`: the example moves to the result form, or gains it beside the parameter form.

The implementation will need, on both halves (`CLAUDE.md`, A test reads both halves): the front
end's lowering of the new array to a kernel binding, the host call's allocation and return, the
host view's result type, the ambient library's typed-array constructors in a `"use typeshade"`
file, and the CPU tier.

### Draft impact estimate

- Known: the refusals of `TS8020` for this shape, and of Rule 8.22's definition, change.
- Estimate: one front-end slice, one host-call slice, one example slice. Duration unknown.
- Unknown: whether proposal 0142's stage 1 (#1324, open) must land first. It touches the same
  kernel parameter code.

### Independent review record

Not yet reviewed. An agent or a person that did not write this proposal reviews it against
`README.md` (Independent review) before the owner decides.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's answers to Q1 to Q3, the
independent review, and a merge of this file as `accepted`.

### Configuration and validation record

This record does not yet apply. Delivery will require both halves' tests of the new form and
of each refusal, the CPU and GPU tiers holding one result, and the example's goldens.

## What it owes downstream

None expected: the parameter form stays. A downstream repository may adopt the result form
after the pin moves.
