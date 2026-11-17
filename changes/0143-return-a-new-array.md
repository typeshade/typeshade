---
id: '0143'
title: A kernel function makes an array with `array<T>(n)` and returns it, as a TypeScript function returns one
status: draft
rules:
  - '8.21'
  - '8.22'
  - '8.23'
  - '9.2'
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
    what: The reference pages for Rules 8.21, 8.22, 8.23 and 9.2 and the pages for surface §20, §64 and §65 gain the result form; no page that writes the parameter form changes.
  - repo: vscode-typeshade
    what: The skill's description of a kernel function gains the result form; compiler-changes.md records 0143 when the pin moves.
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0143, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                     |
| Date and attribution          | Drafted 2026-11-17 (UTC) by an AI agent (Claude Code) at the owner's request. Revision 2, the same day, records the owner's answer to Q1 and the review of revision 1 (`a5e336c`). Revision 3, the same day, records the owner's answer to Q2 and the review of revision 2 (`12c65a6`).                                                                                                                                                                                                       |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-17, in Korean. Asked whether `render(k: vec4, size: u32): array<f32>` can replace an `out` parameter, and, told it cannot: "안되는건 사실 말이 안되죠? typeshade 는 typescript 와 같은 계열의 언어인데".                                                                                                                                                                                                                             |
| Applicability / effectivity   | Expected: Rules 8.21, 8.22, 8.23 and 9.2 of `docs/language-design.md`; surface §20, §64 and §65; the front end (`src/compiler/ts/lower/runtime-array.ts`, `src/compiler/ts/lower/expression-array.ts` and the kernel-function analysis); the host call on WebGPU, WebGL2 and the CPU tier (`src/core/host-kernel.ts`, `src/core/host-kernel-gl.ts`); the host face (`HostExport`) and the host view; the ambient library (`src/language-service/ambient.ts`). No release version is assigned. |
| Review baseline               | `main` at `7513a9a` (merge of pull request #1350), read on 2026-11-17.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Review and revision authority | Pull request #1351 (draft). Git records the revisions of this file. The review and the merge of the proposal's pull request record the decision.                                                                                                                                                                                                                                                                                                                                              |

## What changes

A kernel function can make one array whose length its arguments give, write it, and return
it. The host knows the length before the kernel runs, so the host call allocates the storage
and gives it back as the result.

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
const img: Float32Array = await render(k, 512);
```

The parameter form stays.

### What refuses the second form today

At `main` `7513a9a`, four refusals stand in the way. This change lifts each one for the shape
below, and only for it.

1. The result: `TS8020`, "This function returns array<f32>, an array with no size, which lives
   only in a storage binding because its length is known only when the host binds it. Read the
   binding by its name where the value is needed." (`runtime-array.ts`,
   `refuseRuntimeArraySignature`).
2. The local: a local whose type holds `array<T>` is `TS8099` (surface §20,
   `refuseRuntimeArrayLocal`).
3. The constructor: `array<u32>()` is `TS8099`, "has no zero value: an array with no size lives
   only in a storage binding" (`expression-array.ts`). `array<f32>(x)`, with one argument, is
   read today as a list of one element and refused with `TS8099`, "Give the array a size:
   array<f32, 1>".
4. The kind: under Rule 8.22, a function is a kernel function only if it takes an array with no
   size or a 2D storage texture, so `render(k, size)` is a helper; and Rule 8.22's body shape
   allows only "an optional `return` of scalars".

### The rules, in short

1. Rule 8.22: a kernel function is also an exported function whose result is `array<T>`, with
   `T` a type a kernel's `array<T>` parameter may hold.
2. Rule 9.2: a third recorded exception. `array<T>(n)`, with an element type and one argument,
   makes an array of `n` elements, each the zero of `T`, as `array<T, N>()` does for a sized
   array (change 0047). `array` is already a name of WGSL; this is a new signature of it, not a
   new name, so `names` stays empty and §9.3 does not change.
3. Rule 8.23: the function makes one such array, as a `const` at the top level of its body,
   before its first candidate loop, or, in a function with no loop (Rule 8.22, decision D7),
   before its first store.
4. Rule 8.23: `n` is a `u32` or an `i32` (OD-7: a literal takes the type its use needs). It may
   read only these operands, which the host can evaluate before the dispatch:
   - a scalar value parameter, a component of a vector parameter, a field of a struct
     parameter;
   - a module constant;
   - the `.length` of an array parameter;
   - integer `+`, `-`, `*`, `/`, `%`, `min` and `max`, with the program's arithmetic
     (`size * size` of two `u32`s wraps as a `u32` does).
5. Rule 8.22's body shape: the new array is one of the function's arrays. Its loops write and
   read it, the stores after the last loop store into it, and the function ends with
   `return out` on every path. `out.length` reads `n` on every tier.
6. Rule 8.21: the result's host value is the one a kernel's `array<T>` parameter takes (Q2):
   the scalar's typed array, a vector's components one after another, an array of objects for a
   struct. The host view gives one type, not the parameter's union: `Promise<Float32Array>` for
   `array<f32>` or `array<vec4f>`, `Promise<T[]>` for a struct `T`. The caller owns the result
   and may write it.
7. Rule 8.21, on a resource: the result is a new `Buffer` of the scalars, on the device the call
   ran on. The caller owns it and disposes it (Rule 11.8).
8. The host call treats the new array as an array parameter of `n` elements. Whatever each tier
   does with such an array, it does with this one:
   - WebGPU: the storage binding and its size limit;
   - WebGL2: the data texture of 2048 columns (`host-kernel-gl.ts`, `MAX_W`) and its limit;
   - the CPU tier: a typed array, with JavaScript's limit.

   A negative `n` (an `i32`) is refused before anything runs, with a `RangeError` that names
   the function and the length. For `n = 0` the result is empty, and the call binds one element
   in its place.

9. A write past the end: the call checks the indices a loop writes at `a*i + c` against `n`
   before anything runs, and refuses with the `TypeError` the parameter form gives for an array
   too short (Rule 8.21), naming the function, `out` and both numbers. A loop whose range the
   device holds drops such a write, as it does for a parameter (change 0094).
10. Refused as "not supported yet" (OD-9), in both halves, with `TS8099`, each with a sentence
    that names the form and says it is not supported yet:
    - `array<T>(n)` anywhere else: in a helper, in an entry, inside a loop, under a branch;
    - a length that reads any operand rule 4 does not list;
    - a second new array, or a new array the function does not return;
    - a path that returns a parameter (`return ps`, 0142 Table 2) and another that returns the
      new array;
    - `out.push(v)`, a second name for `out` (`const o = out`), and `out` passed to a helper;
    - a kernel function that has a 2D storage texture and makes an array;
    - the result fed to another call inside one fusion (Rule 11.13), until the fuse facts
      describe it.
11. Kept as today: a result of `array<T>` that is no new array, and a struct whose last field is
    `array<T>`, stay `TS8020`.

### The editor (Rule 12.7)

- The ambient library declares `array<T>(n: u32 | i32): array<T>` after the element overloads
  of `array` (`ambient.ts`), so that `array(u32(3))` keeps its type, `array<u32, 1>`. A test pins
  that form in both halves.
- The editor cannot refuse an `f32` length by type alone (the brands are optional), so the
  compiler checks the length's type and the editor reports the compiler's `TS8003` with its
  sentence.
- `out` is an `array<T>`: its index reads a `T`, its `.length` is a `u32`, and its hover shows
  `array<f32>`.
- Each refusal above is reported by the editor with the compiler's code and sentence.

## Why

- [fact] TypeScript returns a new array from a function; the language borrows TypeScript's way
  of writing (OD-1). Writing the result as a parameter is the shape C and WGSL force.
- [fact] `TS8020` gives a target's reason: WGSL has no array whose length a call chooses. OD-9
  says a target's lack is no reason to refuse a form.
- [inference, agent; checked by both independent reviews] The rewrite exists. The host call
  already checks, uploads and reads back a kernel's arrays and returns results
  (`host-kernel.ts`, `tailResult`). With the length known before the dispatch, it allocates the
  storage, binds it where the parameter form binds `out`, and returns it.

### Alternatives for Q1, and why the owner chose C

| Option | Spelling                     | Cost                                                                                                                                                                                                        |
| ------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | `new Float32Array(n)`        | Adds four names the ambient library does not declare (`Float32Array`, `Int32Array`, `Uint32Array`, `Float64Array`; both halves report `TS8022` today). Spells only scalars: `array<vec4f>` has no spelling. |
| B      | `new Array<f32>(n)` + `fill` | `Array` has no constructor in the ambient library, and `fill` gives nothing (surface §63, change 0079), so one expression cannot both make and fill it. JavaScript gives a plain `Array`.                   |
| C      | `array<T>(n)`                | A third exception of Rule 9.2. Spells every element type.                                                                                                                                                   |

The owner chose C on 2026-11-17.

### Costs of the owner's decisions

- Q1, `array<T>(n)`: one argument means a length, two or more mean elements. `array<u32>(5)` is
  five zeros, while `array(u32(5))` stays a list of one element, `[5]`, as today. ECMAScript has
  the same trap in `Array(n)` against `Array(a, b)`. A WGSL reader may also take
  `array<u32>(3)` for an array holding 3; that form is no valid WGSL.
- Q2, a typed array: a vector array comes back flat (`array<vec4f>` is a `Float32Array` of `4n`
  scalars), as a parameter takes it.
- A write past the end is refused before the run for a parameter and for the result alike
  (rule 9), so the two forms agree; WGSL's robust access, which may clamp, is not relied on.

## Owner's decisions

This proposal rests on OD-1 (TypeScript's way of writing), OD-3 (the compiler allocates; the
author states only the length), OD-5 (a returned array is the caller's from then on), OD-7 (a
literal length takes the type its use needs) and OD-9 (a target's lack of a form is no refusal
reason; a form the compiler does not implement yet is refused as such). It reverses no entry.

### The owner's answers

- Q1, the spelling: **C, `array<T>(n)`**, 2026-11-17 (the owner's selection in the session,
  after "array 여도 좋고").
- Q2, the result's host value: **A, the value a kernel's `array<T>` parameter takes**,
  2026-11-17 (the owner's "네" to the recommendation).

### Q2 as it was asked

| Option | Host value of the result                                                                                                 | Cost                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| A      | As a kernel's `array<T>` parameter: a typed array (`array<vec4f>` a `Float32Array` of `4n` scalars), objects for structs | The result can be passed back to the parameter form unchanged. A vector array is flat.                                |
| B      | As a sized `array<T, N>` result: an array of `n` host values of `T` (a tuple per vector)                                 | Matches a sized result. Allocates `n` objects for a vector array, and cannot be passed to a parameter without a copy. |

## Why the compiler cannot do it

The author must state the length: the compiler cannot know how many elements the caller
wants. The binding, the allocation and the read back are the compiler's. The change adds a
signature of `array` and a rule; it adds no name, binding, qualifier or attribute (OD-3).

## What it touches

- Rule 8.21: the result's host value, with a plain call and on a resource.
- Rule 8.22: the kind, and the body shape.
- Rule 8.23: where `array<T>(n)` may stand, its length, its zero fill, its `.length`.
- Rule 9.2: the third recorded exception.
- Surface §20 (a local of `array<T>`), §64 (the host call's result) and §65 (the kernel loop).
- `exports`: `HostExport`. A kernel function's entry gains the length expression, which the host
  call evaluates from the arguments.
- `codes`: none new. The refusals reuse `TS8099` ("not supported yet") and `TS8003` (the length's
  type); `TS8020` stays for every other function shape.
- `examples`: none added or removed. `loop-kernel` may gain the result form in the implementing
  pull request.
- `names`: none. `array` is already an author-facing name (`src/__api__/author-names.md`).

### Draft impact estimate

- Prerequisite: proposal 0142 stage 1 (#1324). It removes `@inout`, edits the same text of
  Rules 8.21 to 8.23, and lets a kernel function return its own array parameter. This proposal
  is implemented after it.
- Expected slices: the front end with the editor; the host face and the host call on three
  tiers; the example and its goldens. Duration unknown.
- Note: the zero fill gives a written-only array the upload skip that 0142 lost with `@out`
  (0142's recorded cost).

### Independent review record

**Revision 1** (`a5e336c`) was reviewed on 2026-11-17 by an AI agent (Claude Code) that did not
write it, against `changes/README.md`. It ran one probe through `bothHalves`. Findings and
answers:

1. Option A adds names; `names: []` and "adds no name" were wrong. Fixed: A's cost lists the
   four names; the owner chose C, which adds a signature, not a name.
2. Option B was described wrongly: `fill` gives nothing and `Array` has no constructor. Fixed in
   the alternatives table.
3. "Today" left out refusals. Fixed in revision 2, and completed in revision 3 (the one-argument
   reading of `array<f32>(x)`, the storage-texture route).
4. Rule 8.22's body shape was not addressed. Fixed: rule 5.
5. The interaction with 0142 was misstated. Fixed: the "before" example is at 0142 stage 1,
   0142 stage 1 is a stated prerequisite, and a mixed `return ps` / `return out` is refused.
6. Q2 had one option. Fixed: two options with their costs.
7. The call on a resource. Fixed: rule 7.
8. Missing cases. Fixed in revision 2, and completed in revision 3 (rules 4, 8 and 9).
9. The editor half was not specified. Fixed in revision 2, and completed in revision 3 (the
   overload's place, the length's type).
10. The front matter was incomplete. Fixed in revision 2, and completed in revision 3
    (`exports`, `examples`, `downstream`, `rules`).
11. The `TS8020` quote was cut short. Fixed: quoted in full.
12. Q3 (the interim `TS8020` text) is no design choice. Fixed: Q3 is removed; the fix is its own
    pull request.
13. Option C's naming was imprecise. Revision 2 answered with a §9.3 row, which was wrong (see
    revision 2's finding 1). Fixed in revision 3: a third exception of Rule 9.2.
14. The rewrite claim holds. Kept.

**Revision 2** (`12c65a6`) was reviewed on 2026-11-17 by another AI agent (Claude Code) that
wrote neither revision. It ran probes through `bothHalves` and `tsc` over `SHADE_DTS`. Findings
and answers:

1. Blocking: a §9.3 row is for names of source (c) (Rule 9.6, shrink-only, pinned by
   `surface-names.test.ts`), and Rule 9.2 requires WGSL's signature. Fixed: rule 2 is a third
   exception of Rule 9.2; `'9.2'` is in `rules`; §9.3 does not change.
2. `array<f32>(x)` is read today as a one-element list. Fixed: "Today" item 3, and the cost of Q1
   records the one-argument / two-argument trap.
3. The editor overload's place and the length's type check. Fixed: "The editor".
4. The length's operands were not defined. Fixed: rule 4 lists them.
5. `.length` at `n = 0` disagreed with the bound buffer. Fixed: rule 5, `out.length` reads `n` on
   every tier.
6. The limits did not fit WebGL2 or the CPU tier. Fixed: rule 8 treats the result as an array
   parameter of `n` elements on each tier.
7. A write past the end differed between the two forms. Fixed: rule 9 aligns them.
8. The result's host type and ownership. Fixed: rules 6 and 7.
9. `downstream: []` was wrong. Fixed: the site and the editor extension are listed.
10. Front matter: `examples` held an unchanged id; `HostExport` was "may". Fixed.
11. Rule details (a kernel with no loop, the kept `TS8020` cases, the storage-texture route, the
    element types, the refusal texts). Fixed: rules 1, 3, 10 and 11. The exact sentence of each
    refusal is the implementing pull request's, under Rule 12.5.
12. The record of the first review overstated five fixes. Fixed: this record says which
    revision completed each.

Revision 3 has not been reviewed again.

### Approval and plan record

This record does not yet apply. Acceptance will require a review of revision 3 and a merge of
this file as `accepted`.

### Configuration and validation record

This record does not yet apply. Delivery will require both halves' tests of the new form and of
each refusal, the three tiers holding one result, and, if `loop-kernel` gains the form, its
goldens.

## What it owes downstream

- `typeshade.github.io`: the reference pages for Rules 8.21, 8.22, 8.23 and 9.2 and the pages for
  surface §20, §64 and §65 gain the result form. No page that writes the parameter form changes.
- `vscode-typeshade`: the skill's description of a kernel function gains the result form;
  `compiler-changes.md` records 0143 when the pin moves.

Each is expected work; none is started.
