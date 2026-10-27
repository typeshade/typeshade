---
id: '0101'
title: A binding or a kernel function's array of records takes the flat typed array of its layout, and the author reads it as `pts[i].y`
status: draft
rules:
  - '8.21'
  - '8.23'
surface:
  - 64
  - 65
  - 67
exports: []
exports-removed: []
codes: []
examples:
  - record-flat-binding
downstream:
  - repo: typeshade.github.io
    what: Describe the flat typed array as the host value of an array of records on the kernel-function page and the host-entry page, show the record-flat-binding example, in both locales, and record 0101 when the pin moves.
  - repo: vscode-typeshade
    what: Accept the flat typed array where the skill's references or a fixture name the host value of an array of structs or of fixed arrays, and record 0101 when the pin moves.
  - repo: typecv
    what: Convert the stride-packed records family by family in phase 10 of docs/library-structure.md, each with its bytes unchanged, and record 0101 when the pin moves.
---

<!-- doc-refs: skip-file — this draft names an example that a later implementation adds, and files of the TypeCV repository, which this tree does not have -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0101`, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Date and attribution          | Written on 2026-10-27, UTC. The date records authorship, not an approval. A Claude Code sub-agent drafted it at the request of the coordinating Claude Code session of TypeCV's refactoring programme. The owner approved drafting P1 first on 2026-10-27. The source is proposal P1 of TypeCV's audit `docs/audits/2026-10-27-typescript-surface-gaps.md` (row T7, rank 2), with its second part, the jagged `array<array<T>>`. Number 0100 is taken by the open [PR #801](https://github.com/typeshade/typeshade/pull/801) (`changes/0100-typed-array-types.md`), so this proposal takes 0101.      |
| Applicability / Effectivity   | The host value of a runtime-sized array of records: an entry's `storage<array<S>>` binding (Rule 8.24) and a kernel function's `array<S>` parameter (Rule 8.22), with `S` a struct or an `array<T, N>`. Files: `src/core/host-entry.ts` (`flatWidth`, `bulkOf`, `runtimeCount`, `pack`, `readInto`, `toCpu`, `fromCpu`, `packed`), `src/core/host-kernel.ts` (`checkArray`, the CPU path), `src/core/host-kernel-gl.ts` (`lanesOf`) and `src/compiler/ts/host-face.ts` (`bindingTsType` and the kernel parameter types). The WGSL, the GLSL and the IR do not change. No release version is assigned. |
| Review baseline               | TypeShade `main` at `b009cd8a` (`fix(compiler): refuse a kernel function's optional result (#792) (#798)`). The facts on the code in this document were read there, and the probes of "Why" ran there. TypeCV evidence: `main` at `e68ecd5`; the audit's own baseline is TypeCV `73c84dc` with the compiler pin `725b2969`.                                                                                                                                                                                                                                                                           |
| Review and revision authority | No pull request is assigned at the time of writing. Git records the revisions. The review and merge records of the proposal's pull request record the decision; this file does not claim that merge.                                                                                                                                                                                                                                                                                                                                                                                                  |

## What changes

**Proposal.** A runtime-sized array of records takes, as its host value, the flat typed array of
its layout. A record is a struct of 4-byte scalars and vectors of them, or an `array<T, N>` of a
4-byte scalar. The layout is the one `reflect()` reports for the type: each field at its offset,
each element at the array's stride, padding included. The author declares nothing.

The construct is one of these, read in the kernel as `pts[i].y`, `const { x, y } = pts[i]` or
`const [x, y, z] = pts[i]`:

- an entry's binding, `declare const pts: storage<array<P3>>` or `storage<array<array<f32, 3>>>`;
- a kernel function's array parameter, `pts: array<P3>` or `pts: array<array<f32, 3>>`.

### Before and after

| Today, at `b009cd8a`                                                                                                                                                                                             | With this proposal                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A `storage<array<P3>>` binding takes an array of objects. A `Float32Array` is refused: `norm(): binding "recs" (array<P3>): got a Float32Array, not an array.` (Q58).                                            | The binding takes the array of objects, or a `Float32Array` of 3 numbers per record.      |
| A `storage<array<array<f32, 3>>>` binding takes an array of arrays, `readonly (readonly number[])[]`. A `Float32Array` is refused with the same sentence (Q62).                                                  | The binding takes the array of arrays, or a `Float32Array` of 3 numbers per element.      |
| A kernel function's `pts: array<P3>` takes `readonly { readonly x: number; … }[]` or a `Resident` of it.                                                                                                         | It also takes a `Float32Array` or a `Resident` of one.                                    |
| The host packs records at a stride by hand, `out[4 * k + 1] = …`, and the kernel reads them at `b * N + c`. TypeCV writes 970 such accesses in its kernels and 208 such lines in its hosts (the audit's counts). | The kernel reads `pts[k].y`. The host keeps the same `Float32Array`, with the same bytes. |
| `.length` of a kernel function's `array<P3>` counts records.                                                                                                                                                     | The same, whatever the host value: a `Float32Array` of 12 numbers is 4 records of `P3`.   |

### 1. The host value

**Proposal.**

- **Which arrays.** An array with no size whose element is a struct or an `array<T, N>`, as an
  entry's `storage<array<S>>` binding (read or `read_write`) and as a kernel function's parameter.
  Every field of the struct is an `f32`, `i32` or `u32`, a vector or a matrix of them, an
  `array<T, N>` of them, or a struct of such fields. Exclusions are listed in part 5.
- **The value.** A typed array whose byte length is a whole number of elements at the stride that
  `reflect()` reports for the array. The element `i` starts at byte `i * stride`. Each field is at
  its byte offset in the element, and each padding word is skipped. Which typed arrays are accepted
  is decision D1. That the stride includes the padding is decision D2.
- **A `Resident`.** A `Resident` made from such a typed array is accepted wherever the array is
  (Rule 11.8). Its host value is the typed array.
- **The checks.** The call refuses, with a `TypeError` that names the entry or the function, the
  binding or the parameter and its type, before anything runs:
  - a byte length that is not a whole number of elements: `norm(): binding "recs" (array<P3>): got
10 numbers, which is not a whole number of 3-number elements.`, in the words that
    `runtimeCount` uses today for an array of vectors;
  - an empty typed array, as today: `got an empty array, which WebGPU cannot bind`;
  - a typed array of a kind that D1 does not accept, naming the kinds that it accepts.
- **The array of objects.** Whether the array of objects (or of arrays) stays accepted beside the
  typed array is decision D3. The draft keeps it.
- **Written arrays.** An array that the entry or the function writes is read back into the caller's
  typed array in place, as a typed array of scalars is today (Rule 8.21). The padding words are
  left as the caller wrote them on the CPU tier, and as the GPU left them on WebGPU.

### 2. WebGPU

**Fact** (`src/core/host-entry.ts` at `b009cd8a`). `pack` already writes each struct element at
`i * st` and each field at its offset (`Layout` kind `'o'`), so the buffer that WebGPU binds has the
layout of `reflect()`. `bulkOf` copies a typed array as its bytes when the element is a scalar or a
vector with no padding.

**Proposal.** A typed array of records is bound as its bytes, by one copy, as `bulkOf` copies an
array of scalars today. A written binding is read back as bytes into the caller's typed array. The
emitted WGSL does not change: the binding is `array<P3>` today and stays `array<P3>`.

### 3. WebGL2

**Fact** (`src/core/host-kernel-gl.ts`, `lanesOf`). A kernel function's loop on WebGL2 reads each
array as a data texture. For an array of structs, `lanesOf` packs the value through `packed` in its
storage layout and uploads the words, as `R32UI` when a field is an integer (change 0046). A loop
that writes a struct array goes to the CPU tier (surface §65, "The tiers"). An entry on WebGL2
(change 0054) holds each binding as words, as std430 lays it out.

**Proposal.** WebGL2 takes the typed array through the same `packed` call, so its programs do not
change. A read-only array of records is uploaded from the typed array's words. What goes to the CPU
tier today still goes there.

### 4. The CPU tier and the oracle

**Fact** (`src/core/host-entry.ts`, `toCpu` and `fromCpu`). The CPU tier converts each host value
into its own representation when the call starts, and writes it back into the caller's value in
place when the call ends. A `Float32Array` of an `array<f32>` becomes a JavaScript array of numbers
for the call. An array of structs becomes an array of objects. So the CPU tier copies today, for
every runtime-sized array.

**Proposal.** The CPU tier reads each field of a typed array of records at its offset, with the
field's own type, when the call starts, and writes each field back at its offset when the call ends.
The generated code (Rule 11.7) and the oracle do not change: they run on the same representation as
today. Decision D4 states the alternative, a generated code that reads the caller's bytes in place.

`pts[i]`, read as a whole on the CPU tier, is a copy of the record, as `const p = pts[i]` is a value
in WGSL. A write is `pts[i].y = v`, which writes the field and nothing else. This is today's
behaviour for an array of objects; D4 keeps it under both of its alternatives.

### 5. Exclusions

**Proposal.** These keep today's host value, an array of objects or of arrays, and the call refuses a
typed array for them with the sentence of part 1:

- a struct with an `f64` field or a `vecNf64` field: the GPU holds a double as two `f32`s (§39),
  and no typed array holds that pair (decision D7);
- a struct with an `atomic<T>` field;
- a struct with a `T | undefined` field or a key-type field: neither reaches a binding today
  (changes 0081, 0093);
- a sized `storage<S>` and a `uniform<S>`: one record is a host value of its own (§64), not an
  array.

A helper's `array<T, N>` parameter is passed by value (Rule 8.21) and does not change.

### 6. A jagged array, `array<array<T>>`

**Fact** (surface §51; `refuseJaggedArray` in `src/compiler/ts/bindings.ts`; #800 at `210f3b01`).
A binding that holds a list of no fixed length as a list's element, `storage<array<array<u32>>>` or
a struct field `rows: array<array<u32>>`, is refused as `TS8002`. The sentence names the remedy:
`Hold the rows flat: the values in one array<u32> and each row's first index in an array<u32> of
offsets, read as "values[offsets[r] + k]".`

**Fact** (a probe of `compile()` and `hostFace()` at `b009cd8a`). A kernel function's parameter
`rows: array<array<u32>>` compiles with no diagnostic. The host view types it
`readonly Uint32Array[] | Resident<readonly Uint32Array[]>`, and its comment says: `It runs on the
CPU: parameter "rows" holds an array with no size.`

**Proposal.** Two alternatives, decision D5:

- **(a) A lowering.** The host value of `array<array<T>>` is the pair `{ offsets, values }`, with
  `offsets` a `Uint32Array` of `rows + 1` entries and `values` the scalar's typed array. The
  compiler lowers the one declaration into two bindings. It reads `rows[r][k]` as
  `values[offsets[r] + k]` and `rows[r].length` as `offsets[r + 1] - offsets[r]` on every tier.
- **(b) The refusal.** Keep §51's refusal and its remedy. The author writes the two arrays.

The draft recommends (b). D6 states what a kernel function's `array<array<T>>` parameter does
under each alternative.
