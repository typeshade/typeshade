---
id: '0143'
title: A kernel function makes an array with `array<T>(n)` and returns it, as a TypeScript function returns one
status: draft
rules:
  - '8.21'
  - '8.22'
  - '8.23'
surface:
  - 20
  - 64
  - 65
exports: []
exports-removed: []
codes: []
examples:
  - loop-kernel
names: []
downstream: []
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0143, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                        |
| Date and attribution          | Drafted 2026-11-17 (UTC) by an AI agent (Claude Code) at the owner's request. Revision 2, the same day, records the owner's answer to Q1 and the independent review of revision 1 (`a5e336c`).                                                                                                                                                                                                                   |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-17, in Korean. Asked whether `render(k: vec4, size: u32): array<f32>` can replace an `out` parameter, and, told it cannot: "안되는건 사실 말이 안되죠? typeshade 는 typescript 와 같은 계열의 언어인데".                                                                                                                                                |
| Applicability / effectivity   | Expected: Rules 8.21, 8.22 and 8.23 and §9.3 of `docs/language-design.md`; surface §20, §64 and §65; the front end (`src/compiler/ts/lower/runtime-array.ts` and the kernel-function analysis); the host call on WebGPU, WebGL2 and the CPU tier (`src/core/host-kernel.ts`, `src/core/host-kernel-gl.ts`); the host view; the ambient library; `examples/loop-kernel.shade.ts`. No release version is assigned. |
| Review baseline               | `main` at `7513a9a` (merge of pull request #1350), read on 2026-11-17.                                                                                                                                                                                                                                                                                                                                           |
| Review and revision authority | Pull request #1351 (draft). Git records the revisions of this file. The review and the merge of the proposal's pull request record the decision.                                                                                                                                                                                                                                                                 |

## What changes

A kernel function can make one array whose length its value parameters give, write it, and
return it. The host knows the length before the kernel runs, so the host call allocates the
storage and gives it back as the result.

Before, at proposal 0142 stage 1 (#1324, which removes `@inout`), the author writes the result
as a parameter:

```ts
export function render(k: vec4, size: u32, out: array<f32>) {
  for (let i: u32 = 0; i < size * size; i++) {
    const p = vec2(f32(i % size), f32(i / size)) / f32(size);
    out[i] = height(p, k);
  }
}

// host
const img = new Float32Array(512 * 512);
await render(k, 512, img);
```

After this change, the author may also write it as a result. The spelling `array<T>(n)` is the
owner's answer to Q1:

```ts
export function render(k: vec4, size: u32): array<f32> {
  const out = array<f32>(size * size);
  for (let i: u32 = 0; i < size * size; i++) {
    const p = vec2(f32(i % size), f32(i / size)) / f32(size);
    out[i] = height(p, k);
  }
  return out;
}

// host
const img = await render(k, 512);
```

The parameter form stays.

### What refuses the second form today

At `main` `7513a9a`, four refusals stand in the way. This change lifts each one for the shape
below, and only for it.

1. The result: `TS8020`, "This function returns array<f32>, an array with no size, which lives
   only in a storage binding because its length is known only when the host binds it. Read the
   binding by its name where the value is needed." (`runtime-array.ts`, `refuseRuntimeArraySignature`).
2. The local: a local whose type holds `array<T>` is `TS8099` (surface §20,
   `refuseRuntimeArrayLocal`).
3. The constructor: `array<u32>()` is `TS8099`, "has no zero value: an array with no size lives
   only in a storage binding" (`expression-array.ts`). `array<T>(n)` has no meaning today.
4. The kind: under Rule 8.22, a function is a kernel function only if it takes an array with no
   size, so `render(k, size)` is a helper, and Rule 8.22's body shape allows only "an optional
   `return` of scalars".

### The rules, in short

1. Rule 8.22: a kernel function is also an exported function whose result is `array<T>`.
2. Rule 8.23, §9.3: `array<T>(n)`, with an element type and one argument, makes an array of `n`
   elements, each the zero of `T`, as `array<T, N>()` does for a sized array (change 0047). It is
   a new signature of WGSL's `array`, which gets a §9.3 row: no new name.
3. Rule 8.23: the function makes one such array, as a `const` at the top level of its body,
   before its first candidate loop. `n` is an expression of the value parameters and of module
   constants, of type `u32` or `i32`, evaluated with the program's arithmetic: `size * size` of
   two `u32`s wraps as a `u32` does.
4. Rule 8.22's body shape: the new array is one of the function's arrays. Its loops write it
   and read it, its `.length` is read, the stores after the last loop store into it, and the
   function ends with `return out` on every path.
5. Rule 8.21: the result's host value (Q2). On a resource, the result is a `Buffer` of the
   scalars, as the second signature gives a result.
6. The host call, on WebGPU, WebGL2 and the CPU tier:
   - computes `n` from the arguments before anything runs;
   - refuses a negative `n` (an `i32`) and an `n` past the device's largest storage binding with
     a `RangeError` that names the function and the length, as the parameter path refuses an
     array too short with a `TypeError`;
   - gives back an empty array for `n = 0`, and binds a buffer of one element in its place;
   - drops a write past the end, as Rule 8.22 drops a store past an array's end.
7. Refused as "not supported yet" (OD-9), each in both halves, with `TS8099`:
   - `array<T>(n)` anywhere else: in a helper, in an entry, inside a loop, under a branch;
   - a length that reads what a loop computes, or an element of an array;
   - a second new array, or a new array the function does not return;
   - a path that returns a parameter (`return ps`, 0142 Table 2) and another that returns the
     new array;
   - `out.push(v)`, a second name for `out` (`const o = out`), and `out` passed to a helper;
   - the result fed to another call inside one fusion (Rule 11.13), until the fuse facts
     describe it.

### The editor (Rule 12.7)

- The ambient library declares the signature `array<T>(n: u32 | i32): array<T>` beside
  `array<T, N>(…)`.
- `out` is an `array<T>`: its index reads a `T`, its `.length` is a `u32`, and its hover shows
  `array<f32>`.
- Each refusal above is reported by the editor with the compiler's code and sentence.

## Why

- [fact] TypeScript returns a new array from a function; the language borrows TypeScript's way
  of writing (OD-1). Writing the result as a parameter is the shape C and WGSL force.
- [fact] `TS8020` gives a target's reason: WGSL has no array whose length a call chooses. OD-9
  says a target's lack is no reason to refuse a form.
- [inference, agent; checked by the independent review] The rewrite exists. The host call
  already checks, uploads and reads back a kernel's arrays and returns results
  (`host-kernel.ts`, `tailResult`). With the length known before the dispatch, it allocates the
  storage, binds it where the parameter form binds `out`, and returns it.

### Alternatives for Q1, and why the owner chose C

| Option | Spelling                     | Cost                                                                                                                                                                                                                                             |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A      | `new Float32Array(n)`        | Adds four names the ambient library does not declare (`Float32Array`, `Int32Array`, `Uint32Array`, `Float64Array`; both halves report `TS8022` today). Spells only scalars: `array<vec4f>` has no spelling. The shader still reads `array<f32>`. |
| B      | `new Array<f32>(n)` + `fill` | `Array` has no constructor in the ambient library, and `fill` gives nothing (surface §63, change 0079), so one expression cannot both make and fill it. JavaScript gives a plain `Array`.                                                        |
| C      | `array<T>(n)`                | A new signature of a WGSL name (§9.3 row). A WGSL reader may take `array<u32>(3)` for an array holding 3; that form is no valid WGSL, so nothing clashes. Spells every element type.                                                             |

The owner chose C on 2026-11-17.

## Owner's decisions

This proposal rests on OD-1 (TypeScript's way of writing), OD-3 (the compiler allocates; the
author states only the length), OD-5 (a returned array is the caller's from then on) and OD-9
(a target's lack of a form is no refusal reason; a form the compiler does not implement yet is
refused as such). It reverses no entry.

### The owner's answers

- Q1, the spelling: **C, `array<T>(n)`**, 2026-11-17 (the owner's selection in the session,
  after "array 여도 좋고").

### Questions for the owner

**Q2. The result's host value.** Rule 8.21 gives two precedents, and they differ.

| Option | Host value of the result                                                                                                             | Cost                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| A      | As a kernel's `array<T>` parameter: a typed array (`array<vec4f>` a `Float32Array` of `4n` scalars), an array of objects for structs | The result can be passed back to the parameter form unchanged. A vector array is flat.                                |
| B      | As a sized `array<T, N>` result: an array of `n` host values of `T` (a tuple per vector)                                             | Matches a sized result. Allocates `n` objects for a vector array, and cannot be passed to a parameter without a copy. |

Recommendation: A. The result of one kernel is often the input of the next.

## Why the compiler cannot do it

The author must state the length: the compiler cannot know how many elements the caller
wants. The binding, the allocation and the read back are the compiler's. The change adds a
signature of `array` and a rule; it adds no name, binding, qualifier or attribute (OD-3).

## What it touches

- Rule 8.21: the result's host value, with a plain call and on a resource.
- Rule 8.22: the kind, and the body shape (finding 4 of the review).
- Rule 8.23 and §9.3: `array<T>(n)`, where it may stand, its length and its zero fill.
- Surface §20 (a local of `array<T>`), §64 (the host call's result) and §65 (the kernel loop).
- `loop-kernel`: the example gains the result form beside the parameter form.
- `exports`: none expected. `KernelFace` (`HostExport`) may need a field for the length
  expression; if it does, this proposal is amended before that code lands.
- `codes`: none new. The refusals reuse `TS8099` ("not supported yet"); `TS8020` stays for
  every other function shape.

### Draft impact estimate

- Prerequisite: proposal 0142 stage 1 (#1324). It removes `@inout`, edits the same text of
  Rules 8.21 to 8.23, and lets a kernel function return its own array parameter. This proposal
  is implemented after it.
- Expected slices: the front end with the editor; the host call on three tiers; the example
  with its goldens. Duration unknown.
- Note: the zero fill gives a written-only array the upload skip that 0142 lost with `@out`
  (0142's recorded cost).

### Independent review record

Revision 1 (`a5e336c`) was reviewed on 2026-11-17 by an AI agent (Claude Code) that did not
write it, against `changes/README.md`. It ran one probe through `bothHalves`. Findings and
answers:

1. Option A adds names; `names: []` and "adds no name" were wrong. Fixed: A's cost lists the
   four names; the owner chose C, which adds a signature, not a name.
2. Option B was described wrongly: `fill` gives nothing and `Array` has no constructor. Fixed in
   the alternatives table.
3. "Today" left out refusals (`TS8022`, the local's `TS8099`, surface §20). Fixed: four
   refusals listed.
4. Rule 8.22's body shape was not addressed. Fixed: rule 4 above.
5. The interaction with 0142 was misstated. Fixed: the "before" example is at 0142 stage 1,
   0142 stage 1 is a stated prerequisite, and a mixed `return ps` / `return out` is refused.
6. Q2 had one option. Fixed: two options with their costs.
7. The call on a resource. Fixed: rule 5 above.
8. Missing cases (length type and value, zero, too large, writes past the end, two arrays,
   aliasing, `push`, the WebGL2 tier, fusion). Fixed: rules 3, 6 and 7 above, and "What it
   touches".
9. The editor half was not specified. Fixed: the section "The editor". The claim "the host and
   the shader read one type" is removed.
10. The front matter was incomplete. Fixed: `surface` lists §20, §64, §65; `exports` and
    `codes` are stated.
11. The `TS8020` quote was cut short. Fixed: quoted in full.
12. Q3 (the interim `TS8020` text) is no design choice: OD-9 requires it, and `CLAUDE.md`
    approves a bug fix in advance. Fixed: Q3 is removed; the fix is its own pull request.
13. Option C's naming was imprecise. Fixed: a signature of WGSL's `array`, with a §9.3 row.
14. The rewrite claim holds. Kept.

Revision 2 has not been reviewed again.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's answer to Q2, a review of
revision 2, and a merge of this file as `accepted`.

### Configuration and validation record

This record does not yet apply. Delivery will require both halves' tests of the new form and of
each refusal, the three tiers holding one result, and the example's goldens.

## What it owes downstream

None expected: the parameter form stays. A downstream repository may adopt the result form
after the pin moves.
