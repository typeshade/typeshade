---
id: '0101'
title: A binding or a kernel function's array of records takes the flat typed array of its layout, and the author reads it as `pts[i].y`
status: accepted
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
names: []
downstream:
  - repo: typeshade.github.io
    what: Describe the flat typed array as the host value of an array of records on the kernel-function page and the host-entry page, show the record-flat-binding example, in both locales, and record 0101 when the pin moves.
  - repo: vscode-typeshade
    what: Accept the flat typed array where the skill's references or a fixture name the host value of an array of structs or of fixed arrays, and record 0101 when the pin moves.
  - repo: typecv
    what: Convert the stride-packed records family by family in phase 10 of docs/library-structure.md, each with its bytes unchanged, and record 0101 when the pin moves.
---

<!-- doc-refs: skip-file — this proposal names an example that an implementation adds, and files of the TypeCV repository, which this tree does not have -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0101`, `status: accepted`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Date and attribution          | First drafted on 2026-10-27 (UTC) by a Claude Code sub-agent, for the coordinating Claude Code session of TypeCV's refactoring programme. Revised on 2026-11-24 (UTC) by a Claude Code sub-agent for the orchestrating session of this repository. Both dates record authorship, not approval. The source is proposal P1 of TypeCV's audit `docs/audits/2026-10-27-typescript-surface-gaps.md` (row T7, rank 2). The earlier draft is [PR #802](https://github.com/typeshade/typeshade/pull/802) at `b009cd8a`; this revision supersedes it.                                                          |
| Applicability / Effectivity   | The host value of a runtime-sized array of records: an entry's `storage<S[]>` binding (Rule 8.24) and a kernel function's `S[]` parameter (Rule 8.22), with `S` a struct or an `array<T, N>`. Files: `src/core/host-entry.ts` (`flatWidth`, `bulkOf`, `runtimeCount`, `pack`, `readInto`, `toCpu`, `fromCpu`, `packed`), `src/core/host-kernel.ts` (`checkArray`), `src/core/host-kernel-gl.ts` (`lanesOf`), `src/compiler/ts/host-view.ts` (`bindingTsType`) and `src/compiler/ts/host-types.ts` (`hostTypeOf`). The WGSL, the GLSL and the IR do not change. No release version is assigned (OD-6). |
| Review baseline               | TypeShade `main` at `be2e83de` (`Merge pull request #1545 from typeshade/claude/omo-project-structure-refactor-wm4fle`). The facts on the code, and the probes of "Why", are read at that commit on 2026-11-24. TypeCV evidence is as read on 2026-10-27 at TypeCV `main` `e68ecd5`, and is not read again here.                                                                                                                                                                                                                                                                                      |
| Review and revision authority | The pull request that merges this revision carries the review record, and it supersedes [PR #802](https://github.com/typeshade/typeshade/pull/802). Git records the revisions. The review and merge records of that pull request record the decision. This file does not claim that merge.                                                                                                                                                                                                                                                                                                            |

## What changes

**Proposal.** A runtime-sized array of records takes, as its host value, the flat typed array of
its layout. A record is a struct of 4-byte scalars and vectors of them, or an `array<T, N>` of a
4-byte scalar. The layout is the one `reflect()` reports for the type: each field at its offset,
each element at the array's stride, padding included. The author declares nothing and learns
nothing new: the source that compiles today keeps its meaning (Rule 1.1, change 0100).

The author reads each record as TypeScript reads an object, `pts[i].y`, `const { x, y } = pts[i]`
or `const [x, y, z] = pts[i]`. The construct is one of these:

- an entry's binding, `declare const pts: storage<P3[]>` or `storage<array<f32, 3>[]>`
  (`storage<Array<P3>>` and `storage<array<P3>>` are the same type; change 0114, stage S1);
- a kernel function's array parameter, `pts: P3[]` or `pts: array<f32, 3>[]`.

The array spelling follows change 0114. `P3[]` and `Array<P3>` are the spellings this proposal
writes. `array<P3>` stays accepted until change 0114 stage S4 removes it, and means the same.
The diagnostics of the call still print a type as `array<P3>` at `be2e83de`, and this proposal
quotes them as they are.

### Before and after

The source of the program does not change. Only the host's value does. The author owes this
comparison to the owner before the owner decides on the implementing pull request (OD-4).

```ts
"use typeshade";
class P3 { x: f32; y: f32; z: f32; }
declare const pts: storage<P3[]>;
declare const ys: storage<f32[], "read_write">;
@compute([64]) export function column(gid: builtin<"global_invocation_id">) {
  if (gid.x >= pts.length) return;
  ys[gid.x] = pts[gid.x].y;
}
```

| Today, at `be2e83de`                                                                                                                                                                    | With this proposal                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| The host builds one object per record: `Array.from({ length: n }, (_, i) => ({ x: xyz[3 * i], y: xyz[3 * i + 1], z: xyz[3 * i + 2] }))`, and calls `column({ pts, ys }, n)`.            | The host calls `column({ pts: xyz, ys }, n)` with `xyz` a `Float32Array` of `3 * n` numbers. |
| A `Float32Array` for `pts` is refused: `column(): binding "pts" (array<P3>): got a Float32Array, not an array.` (a probe, 2026-11-24).                                                  | The `Float32Array` is bound as its bytes. An array of objects is accepted as before.         |
| A `storage<array<f32, 3>[]>` binding and a kernel function's `array<f32, 3>[]` parameter refuse a `Float32Array` with the same sentence.                                                | Each takes a `Float32Array` of 3 numbers per element.                                        |
| The host packs records at a stride by hand, `out[4 * k + 1] = …`, and the kernel reads them at `b * N + c`. TypeCV writes 970 such accesses in its kernels and 208 such lines in hosts. | The kernel reads `pts[k].y`. The host keeps the same `Float32Array`, with the same bytes.    |
| `.length` of a kernel function's `P3[]` counts records.                                                                                                                                 | The same, whatever the host value: a `Float32Array` of 12 numbers is 4 records of `P3`.      |

### 1. The host value

**Proposal.**

- **Which arrays.** An array with no size whose element is a struct or an `array<T, N>`, as an
  entry's `storage<S[]>` binding (read or `read_write`) and as a kernel function's parameter.
  Every field of the struct is an `f32`, `i32` or `u32`, a vector or a matrix of them, an
  `array<T, N>` of them, or a struct of such fields. Part 5 lists the exclusions.
- **The value.** A typed array whose byte length is a whole number of elements at the stride that
  `reflect()` reports for the array. Element `i` starts at byte `i * stride`. Each field is at its
  byte offset in the element, and each padding word is skipped. Decision D1 says which typed
  arrays are accepted. Decision D2 says that the stride includes the padding.
- **A `Buffer`.** Rule 11.8 makes a `Buffer` the one kind of GPU array (change 0138, Q-I). This
  proposal does not change what makes a `Buffer` of records (decision D8).
- **The checks.** The call refuses, with a `TypeError` that names the entry or the function, the
  binding or the parameter and its type, before anything runs:
  - a byte length that is not a whole number of elements, in the words that `runtimeCount` uses
    today for an array of vectors: `column(): binding "pts" (array<P3>): got 10 numbers, which is
not a whole number of 3-number elements.`;
  - an empty typed array, as today: `got an empty array, which WebGPU cannot bind`;
  - a typed array of a kind that D1 does not accept, with the kinds it accepts.
- **The array of objects.** The array of objects (or of arrays) stays accepted beside the typed
  array (decision D3).
- **Written arrays.** The entry or the function reads back an array that it writes into the
  caller's typed array in place, as it does for a typed array of scalars today (Rule 8.21,
  change 0142). The CPU tier leaves the padding words as the caller wrote them. WebGPU leaves them
  as the GPU left them.

### 2. WebGPU

**Fact** (`src/core/host-entry.ts` at `be2e83de`). `pack` writes each struct element at `i * st`
and each field at its offset (`Layout` kind `'o'`), so the buffer that WebGPU binds has the layout
of `reflect()`. `bulkOf` copies a typed array as its bytes when the element is a scalar or a
vector with no padding. `matrixFlat` serves a `Float32Array` of matrices, as a `Buffer` gives it
(change 0138, Amendment A12, B2-1).

**Proposal.** A typed array of records is bound as its bytes, by one copy, as `bulkOf` copies an
array of scalars today. A written binding is read back as bytes into the caller's typed array. The
emitted WGSL does not change: the binding is `array<P3>` today and stays `array<P3>`.

### 3. WebGL2

**Fact** (`src/core/host-kernel-gl.ts`, `lanesOf`). A kernel function's loop on WebGL2 reads each
array as a data texture. For an array of structs, `lanesOf` packs the value through `packed` in
its storage layout and uploads the words, as `R32UI` when a field is an integer (change 0046). A
struct array that a loop writes is "not supported yet on the WebGL2 tier, and goes on to the CPU
tier" (surface §65, "The tiers"). An entry on WebGL2 (change 0054) holds each binding as words, as
std430 lays it out (OD-11, Rule 11.8).

**Proposal.** WebGL2 takes the typed array through the same `packed` call, so its programs do not
change. A read-only array of records is uploaded from the typed array's words. What goes to the
CPU tier today still goes there, and each such case stays "not supported yet" on WebGL2. No case
becomes "impossible" (OD-11).

### 4. The CPU tier and the oracle

**Fact** (`src/core/host-entry.ts`, `toCpu` and `fromCpu`). The CPU tier converts each host value
into its own representation when the call starts, and writes it back into the caller's value in
place when the call ends. A `Float32Array` of an `f32[]` becomes a JavaScript array of numbers
for the call. An array of structs becomes an array of objects. So the CPU tier copies today, for
every runtime-sized array.

**Proposal.** The CPU tier reads each field of a typed array of records at its offset, with the
field's own type, when the call starts, and writes each field back at its offset when the call
ends. The generated code (Rule 11.7) and the oracle do not change: they run on the same
representation as today. Decision D4 states the alternative.

An element is an object (OD-5, change 0142). `const p = pts[i]` names the element, and `p.y = v`
writes the element, as `pts[i].y = v` does. The CPU tier meets this through its converted objects,
which it writes back at the end of the call. The earlier draft (PR #802) said that `pts[i]` read as
a whole is a copy of the record. That sentence read against OD-5, and this revision removes it.
No new construct and no new refusal follows from the removal: change 0142 stage 3 owns the
identity of two elements of one array.

### 5. Exclusions

**Proposal.** These keep today's host value, an array of objects or of arrays. The call refuses
a typed array for them with the sentence of part 1 and the words "not supported yet" (OD-9,
OD-10):

- a struct with an `f64` field or a `vecNf64` field: the GPU holds a double as two `f32`s (§39),
  and the compiler does not yet map one logical number to that pair inside a record (decision D7);
- a struct with an `atomic<T>` field, for the same reason: not supported yet;
- a struct with a `T | undefined` field or a key-type field: neither reaches a binding today
  (changes 0081, 0093), and the call keeps refusing them with their own reason;
- a sized `storage<S>` and a `uniform<S>`: one record is a host value of its own (§64), not an
  array.

A helper's `array<T, N>` parameter is an object (Rule 8.8, change 0142) and does not change.
A kernel function that makes and returns an array of records (change 0114, S5) keeps its result
as an array of objects. This proposal does not decide that result.

### 6. A jagged array, `array<array<T>>`, is not part of this change

The earlier draft carried the jagged array as its second part. This revision removes it. Two
reasons hold.

- One record carries one change (`CLAUDE.md`, Configuration management). The records of a
  structure and the rows of a jagged array are two changes.
- The earlier draft recommended keeping the `TS8002` refusal of surface §51, whose sentence says
  that an array's element has a fixed size "(WGSL)". That reading is a target's limit given as the
  reason, which OD-9 and OD-10 do not allow. A refusal is "not supported yet", and the compiler
  can lower a jagged array.

**Fact** (a probe of `hostFace()` and `compile()` at `be2e83de`, 2026-11-24). A `storage<array<array<u32>>>`
binding is `TS8002` with that sentence. A kernel function's `rows: u32[][]` parameter compiles with
no diagnostic and the host view types it `readonly Uint32Array[]`. The call that passes
`[new Uint32Array([1, 2]), new Uint32Array([3])]` throws `Offset is outside the bounds of the
DataView`, and so does the call that passes `[[1, 2], [3]]`. The cause is not diagnosed.

**Open work, outside this change** (decision D5):

1. The compiler lowers a jagged array with no author-written form and no new host value: the host
   passes an array of typed arrays, as the host view already says, and the call packs the rows.
2. The `TS8002` sentence of §51 changes to "not supported yet".
3. A kernel function's `u32[][]` parameter is refused as "not supported yet" until then, in place of
   the raw `RangeError`. That is a bug fix that needs no proposal.

## Why

### The evidence

**Fact** (the audit, sections 1, 2.1 and 3, labelled there as counts of its scripts at TypeCV
`73c84dc`; read on 2026-10-27, not read again). Row T7 is rank 2 of 27 by the lines that a
compiler change removes:

- 970 storage accesses at `b * N + c` and 211 local ones in the 30 kernel modules (`idioms.mjs`);
- 119 runs of two or more statements that read or write one record's fields in order, 342 lines,
  which one destructuring each would cut by up to 223 (`runs.mjs`);
- 208 host lines in 20 modules that write or read a field at a constant stride (`hostpack.mjs`),
  most of them in `motion/gpu/klt.ts` (47), `analysis/gpu/hough.ts` (22),
  `motion/gpu/klt-tracker.ts` (22) and `sfm/tracks/gpu/observation-expansion.ts` (22);
- 5 jagged row bounds read by offsets (`csr.py`). Part 6 puts them outside this change.

**Fact** (TypeCV `main` at `e68ecd5`, read on 2026-10-27). The KLT start record is four `f32`s,
packed by the host and read by the kernel at a stride of 4:

```ts
// src/motion/gpu/klt.ts, kltSeedRecords
out[4 * k] = points[2 * k]!;
out[4 * k + 1] = points[2 * k + 1]!;
out[4 * k + 3] = 1;
```

```ts
// src/motion/gpu/klt.shade.ts, lines 259-261
const sx: f32 = kltStart[4 * k];
const sy: f32 = kltStart[4 * k + 1];
const startStatus: u32 = u32(kltStart[4 * k + 3]);
```

The status is a `u32` stored in an `f32` word and converted on each read. The k-NN kernel reads a
point and its cell at a stride of 3 (`src/mvs/gpu/cloud-knn.shade.ts`, lines 69-74).

**Fact** (the audit's probes Q58 and Q62 at TypeCV's earlier pin `725b2969`; scripts outside the
TypeCV repository). The kernel side compiles and destructures. The CPU tier refuses the
`Float32Array` that TypeCV's hosts hold, and accepts arrays of objects or of arrays.

**Fact** (a probe of `hostFace()` at `be2e83de`, run on 2026-11-24 in a test file that was then
deleted). Each form below compiles with no diagnostic, and the call has the result named:

| Form                                                                          | Host view                                        | Call with a `Float32Array`                                                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| an entry's `storage<P3[]>` binding, and the same as `storage<array<P3>>`      | `readonly { readonly x: f32; … }[]`              | `norm(): binding "recs" (array<P3>): got a Float32Array, not an array.`            |
| an entry's `storage<array<array<f32, 3>>>` binding                            | `readonly array<f32, 3>[]`                       | `norm(): binding "recs" (array<array<f32, 3>>): got a Float32Array, not an array.` |
| a kernel function's `pts: P3[]` parameter                                     | `readonly { readonly x: f32; … }[] \| Buffer<…>` | `sum(): parameter "pts" (array<P3>): got a Float32Array, not an array.`            |
| the same function, called with an array of objects                            | the same                                         | runs                                                                               |
| a kernel function that writes `pts[i].y` on an array of objects (change 0142) | the same                                         | the caller's objects change in place                                               |

The code explains the refusal. `flatWidth` in `src/core/host-entry.ts` returns `undefined` for a
struct or an array element, and `runtimeCount` then refuses any value that is not an `Array`.

### The goal

**Inference.** A TypeScript author writes `pts[i].y` and `const [x, y, z] = pts[i]`, and holds the
records in one `Float32Array`. Today the kernel side allows the first, and the host side refuses
the second, so TypeCV writes neither: it keeps the stride in both halves. An array of objects
costs the host an allocation per record and a pack per call, and TypeCV's hosts already hold the
bytes. This proposal lets the two halves meet: the kernel names the fields, and the host keeps its
bytes.

**Inference.** What it removes in TypeCV: the stride arithmetic in the kernels (up to 223 lines by
the audit's upper bound) and the field offsets in the host packers that only exist to match it. A
host that builds records field by field still writes at a stride. One that receives them from
another call or a file does not. The bytes that each call binds do not change, so each conversion
can be held to its current output.

### The precedent

**Fact** (surface §65, the table of host values; change 0068). A kernel function's `array<vecN>`
takes the scalar's typed array, `N` numbers per element, and `.length` counts vectors. An entry's
`storage<array<T>>` of vectors takes the same (§67). This proposal extends that form from a vector
to a record. Decision D2 states the one difference: the call pads an `array<vec3f>` element, and a
record keeps the padding of its layout.

### Relation to accepted proposals

- **0068 (vec4 views, accepted).** It states the host value of an `array<vecN>` kernel parameter.
  This proposal adds the record. It does not change 0068's packed `vec3` form.
- **0082 (private input layout, accepted).** A read-only array of flat objects may upload only the
  fields the kernel reads (`projectInputLayout`, `packed`). A typed array of records goes through
  the same projection: `pack` reads the logical layout from the typed array and writes the physical
  one. The projection does not change what the host passes.
- **0095 (proof offset forms, accepted).** It lets a kernel loop write a record at `b + w*i + o`,
  the stride form that TypeCV writes today. This proposal covers the host side, so that the kernel
  can name the field instead of the offset. The two are independent.
- **0114 (arrays, accepted).** It spells an array with no size `T[]` or `Array<T>`, and the made
  result of a kernel function is the value an array parameter of the same element takes. This
  proposal writes its forms in that spelling. It does not decide the result of an array of records
  (part 5).
- **0116 (host type family, accepted).** The host view spells the host value of a record with the
  name the shader writes. The typed array joins the union that the view already spells for a
  vector element, and its elements keep the struct's name (`P3`) where the module names it.
- **0138 (host nodes and graphs, accepted).** It makes `Buffer` the one kind of GPU array and gives
  an exported class's array a `Buffer<S>`. Decision D8 leaves that surface as it is.
- **0142 (objects are references, accepted).** A kernel function's array parameter is the caller's
  array, written in place. Part 1 and part 4 follow it.
- **0080, 0081, 0088 and 0093.** A key-type field, a `Record` and an optional field have no flat
  form. Part 5 excludes them and keeps their own reasons.
- **0094 (device-resident counts, accepted).** A pushed array may come as `{ array, length, offset? }`.
  Under this proposal `array` may be a typed array of records.

**Fact** (the front matter of every proposal at `be2e83de`). Accepted proposals that are not
implemented also declare Rule 8.21, Rule 8.23, §64, §65 and §67. The implementation that lands
second rebases on the others' text.

### Alternatives considered

- **Keep the hand packing.** Cost: none in the compiler. TypeCV keeps 970 stride accesses and 208
  packing lines, and every new kernel repeats the form. The surface already offers the field
  names, so the cost falls on the one place a TypeScript author does not expect it. Rejected.
- **A shared bindings module with one control struct.** TypeCV could move its strides and offsets
  into one module of named constants. It names the offsets, but the kernel still writes
  `kltStart[4 * k + START_STATUS]` and the host still packs. TypeCV can do it today as an interim
  step. It does not reach `pts[k].y`. Rejected as the answer.
- **Author-declared layouts.** The author would write `@layout` or a stride beside the type. Cost:
  an attribute that neither WGSL nor ECMAScript spells, which asks the author to state what the
  compiler already knows (OD-3). The layout is the type's, and `reflect()` reports it. Rejected.
- **A struct-of-arrays host value.** One typed array for each field. Cost: a new binding shape on
  every tier, since WGSL binds an array of structs as one buffer, and change 0082 records that no
  multi-column SoA policy is selected. TypeCV's hosts hold interleaved records. Rejected.

## Owner's decisions

The proposal rests on these entries of `docs/owner-decisions.md`. It reverses none.

- **OD-3.** The author states nothing new. The layout, the stride and the packing are the
  compiler's and the runtime's work. The rejected alternative "Author-declared layouts" is the
  reverse of this entry.
- **OD-4.** The "Before and after" section shows the host value before and after, and the
  implementing pull request owes the same to the owner.
- **OD-5.** An element is an object: `p = pts[i]; p.y = v` writes the element (part 4). A struct is
  passed as JavaScript passes it, so the array of objects stays accepted (D3).
- **OD-9.** The typed array need not look like the CPU tier's objects or the emitted code. The
  compiler converts, and the bytes the host holds stay as they are (D2, D4).
- **OD-10.** An array with no size is a dynamic array whose storage is the compiler's work. This
  proposal changes only what the host may pass for it.
- **OD-11.** No case of this proposal says that WebGL2 cannot take a form. Each case that is not
  implemented is "not supported yet" (part 3).
- **OD-1, OD-2, OD-6, OD-7 and OD-8** do not bear on this proposal. It adds no stage form (OD-2),
  no number default (OD-7) and no decorator (OD-8), and it needs no warning release (OD-6).

## Why the compiler cannot do it

Not applicable: the proposal adds no author-facing name (`names` is empty), no rule paragraph, no
diagnostic code and no surface form. The source an author writes is the source that compiles
today. What changes is the text of Rule 8.21 and Rule 8.23, which state the host value of an
array of records, so the `rules` criterion of `changes/README.md` names this proposal. The work
itself is the compiler's and the runtime's (OD-3): the layout is known from the type, and the
call reads and writes it. No issue on this repository records the need. It comes from the TypeCV
audit, row T7.

## Decisions

The owner delegated the decisions of this proposal to the orchestrating session on 2026-11-24:
"제대로 다시, 저의 의견이 사실 필요 없거든요" (English: do it properly again; my opinion is not
actually needed). Each decision below is checked against every entry of
`docs/owner-decisions.md`. Each is answered with the recommended option, and none reverses an
entry. Where an option would reverse an entry, the other option is chosen, and the text says so.

**D1. Which typed arrays a record takes.**

- (a) `Float32Array`, `Int32Array` or `Uint32Array`, for any record. The typed array is a container
  of 4-byte words. Each field is read with its own type at its offset, whatever the array's kind,
  so a `u32` field in a `Float32Array` is the bits of that word, as WebGPU binds them. Cost: one
  `DataView` read per field on the CPU tier. A host that writes a `u32` field through a
  `Float32Array` writes a float, so it needs a second view, `new Uint32Array(f.buffer)`.
- (b) Only the scalar's typed array, for a record whose fields are all one scalar type. Cost:
  KLT's start record (`f32` and a `u32` status) stays hand-packed.
- (c) `Float32Array` always, with integer fields converted as numbers. Cost: the bytes differ from
  what WebGPU binds, so the bulk copy of part 2 is lost for a mixed record.
- (d) Any `ArrayBufferView`. Cost: the host view names a wide type.

**Answer: (a).** The bytes are the layout on every tier, and one copy binds them. The host view
names the struct's own scalar array when the record has one scalar type, and the union of the
three when it is mixed. Entries: OD-3 (no author-side conversion), OD-9 (the bytes need not match
the CPU tier's objects). No entry is reversed.

**D2. Whether the stride includes the padding.**

- (a) The stride of `reflect()`, padding included. `struct { v: vec3f }` is 4 numbers per record,
  and the fourth is padding. Cost: the host writes padding words, and the form differs from an
  `array<vec3f>`, whose call pads 3 numbers to 4.
- (b) Packed: the call removes the padding, as for `array<vec3f>` (change 0068). Cost: a copy
  element by element on every call, and the bytes the host holds are not the bytes the GPU holds.

**Answer: (a).** The bytes are the ones `reflect()` reports, which is what a host that packs at a
stride holds today. The choice is the compiler's and the runtime's (OD-3, OD-9): a later change
may add (b) with no author-facing difference. Cost recorded: the host writes padding words for a
record that has them. No entry is reversed.

**D3. Whether the array of objects stays accepted.**

- (a) Keep both. The call tells them apart by the value's kind, and the host view is the union.
  Cost: two paths in `pack`, `toCpu` and `fromCpu`, and a longer host type.
- (b) Retire the array of objects for the forms of part 1. Cost: a breaking change for every host
  that passes objects, and the loss of 0082's projection, which reads objects.

**Answer: (a).** An array of objects is what `P3[]` means in TypeScript, so it must stay (OD-5, and
Rule 1.1 of change 0100). Option (b) would make an author's `P3[]` mean something other than a
JavaScript array of objects. The change is additive, and nothing that runs today changes. No entry
is reversed.

**D4. How the CPU tier reads a typed array of records.**

- (a) Convert at the call: read each record into the CPU tier's representation when the call
  starts, and write it back when it ends. Cost: one copy in and one copy out per call. No change
  to the generated code or the oracle.
- (b) Read in place: the generated code reads `pts[i].y` from the caller's bytes at its offset.
  Cost: a second representation in `cpu-codegen.ts` and the op library for every struct-array
  access, which the oracle shares (Rule 11.1).

**Answer: (a).** It keeps one representation in the oracle and matches what the tier does for
every other array. Either option is allowed by OD-9, and a later change may take (b) as an
optimization. Under both, an element is an object (OD-5; part 4). No entry is reversed.

**D5. A jagged `array<array<T>>` in storage.**

The earlier draft offered (a) a lowering to `{ offsets, values }` as a new host value and (b) the
refusal of §51. Both are replaced.

- (a) A lowering with a new host value `{ offsets, values }`. Cost: an author-facing host shape,
  and a rule beside Rule 4.4. This pushes the compiler's work to the author (OD-3).
- (b) Keep the `TS8002` refusal and its "(WGSL)" reason for good. Cost: none in code. It refuses
  a form for a target's sake, which OD-9 and OD-10 do not allow.
- (c) Take the jagged array out of this change (part 6). The compiler lowers it later with no new
  author-facing form, the host value stays an array of typed arrays, and the §51 sentence changes
  to "not supported yet".

**Answer: (c).** Option (a) reads against OD-3, and option (b) reads against OD-9 and OD-10. Option
(c) keeps the entries and the rule that one record carries one change. The §51 sentence that
reads against OD-9 is fixed in the change that owns it, not here. Entries: OD-3, OD-9, OD-10.

**D6. A kernel function's `u32[][]` parameter.**

- (a) Keep it as it is. Cost: it compiles, and the call fails with a raw `RangeError` (part 6).
- (b) Refuse it with a "not supported yet" diagnostic until the lowering of D5 exists. Cost: a
  new refusal needs both halves, `compile()` and the language service, and a Tint measure
  (Rule 13.3), though no WGSL is emitted for a kernel function.
- (c) Lower it with D5's work. Cost: that work.

**Answer: (b), as a bug fix with no proposal, and (c) later.** OD-9 and OD-10 allow a refusal only
as "not supported yet". A raw `RangeError` is neither. This proposal does not carry the fix. It
records the need in part 6. No entry is reversed.

**D7. A record with an `f64` field or an `atomic` field.**

- (a) Exclude it (part 5): the call refuses a typed array with "not supported yet", and such a
  record keeps the array of objects. Cost: none for the form that runs today.
- (b) Take a `Float64Array` of the record's logical numbers, which the call splits into `hi` and
  `lo` as it does for an `array<f64>` binding. Cost: the host's bytes differ from the GPU's, and
  the offsets of a mixed record are not the typed array's indices.

**Answer: (a).** The earlier reason, that "no typed array holds that pair", read as an
impossibility. The reason now is "not supported yet" (OD-9, OD-10, OD-11). The missing form is
open work and no limit of the design. TypeCV's records have no `f64` field among the counted
sites. No entry is reversed.

**D8. Whether a `Buffer` of records is made from the flat typed array.**

- (a) Take it in this change: `array(C, data)` of a class `C` accepts the flat typed array. Cost:
  the constructor of a resource is its own surface (Rule 11.8, change 0138), and a `Buffer<C>`
  holds the host's copy in the region (change 0138, R17).
- (b) Leave it for the implementing work or a later change, and decide it with the evidence of
  the first stages. Cost: a host that wants a `Buffer` of records builds objects for now.

**Answer: (b).** The earlier draft named a `Resident` of the typed array. Change 0138 replaced the
`Resident` by the `Buffer` (Q-I), and the constructor is outside the host values of an array
argument. The proposal does not decide it. OD-3 gives the direction that the host need not
convert, so the follow-up should accept it. No entry is reversed.

## What it touches

- **Rule 8.21.** Its sentences on the binding of an entry ("one of structs takes an array of
  objects") and on a kernel function's arrays gain the flat typed array of the layout and its
  checks, for the elements of part 1 with the exclusions of part 5.
- **Rule 8.23.** Its sentence on `.length` gains that an array of records counts records, whatever
  its host value.
- **Surface §64.** The sentence on a helper's `array<T, N>` says that the flat form belongs to the
  arrays of §65 and §67.
- **Surface §65.** The table of host values (the row `array<S>`, a struct, and a row for
  `array<T, N>[]`), the check and its sentence, and "The tiers" for WebGL2.
- **Surface §67.** The table of the bindings object (the row `storage<array<S>>` of a struct, and a
  row for an array of fixed arrays), the check, and the read-back.
- **Example `record-flat-binding` (new).** A host example in `examples/hosts/record-flat-binding/`:
  an entry over `storage<P3[]>` and a kernel function over `Rec[]` with a `u32` field, each called
  with a `Float32Array`, through the compile gate and a packed journey.
- **Host view types.** `bindingTsType` in `src/compiler/ts/host-view.ts` and `hostTypeOf` in
  `src/compiler/ts/host-types.ts`.
- **Code.** `src/core/host-entry.ts` (`flatWidth` or a new record test, `bulkOf`, `runtimeCount`,
  `pack`, `readInto`, `toCpu`, `fromCpu`, the projection of `packed`), `src/core/host-kernel.ts`
  (`checkArray`) and `src/core/host-kernel-gl.ts` (`lanesOf`). The files of `src/` stay at 400
  lines or fewer (`CLAUDE.md`, File size): the work moves a responsibility out of a file of the
  baseline before it adds code there.
- **Not touched.** No export: the host value is a type of the generated view, not a name of the
  package. No diagnostic code: the refusals are `TypeError`s of the call. No IR node, no WGSL and
  no GLSL text. `docs/language-design.md` §9 and `src/__api__/author-names.md` do not change.

### Draft impact estimate

**Known.** The change is additive (D3). A call that passes an array of objects runs as today. The
emitted WGSL and GLSL do not change, so the emit goldens do not change. The host view types
widen, so a fixture or a page that quotes them changes.

**Estimate.** The runtime work is the record branch of the functions in "Code", on the model of the
vector branch that `flatWidth` and `bulkOf` serve today, and the host view. The validation work is
the larger part: both halves, the differential against the oracle for the new host value, and a
journey. The bundle growth of `typeshade/runtime` is unmeasured. Duration and cost are unknown.

**TypeCV.** Up to 223 kernel lines by the audit's upper bound (**Inference**), and part of the 208
host lines, after TypeCV converts each family.

**Stages** (an implementation plan, not a result). Each stage is a pull request with `Change: 0101`.

1. S1, the entry binding: the checks of part 1, `pack`, `readInto`, the CPU tier and the host view
   of `storage<S[]>`.
2. S2, the kernel function: `checkArray`, the CPU path, the host view of an `S[]` parameter, and
   WebGL2 through `lanesOf`.
3. S3, the example `record-flat-binding`, the rule and surface text, and the packed journey.

An implementing pull request that changes how an author writes a host call needs the owner's
"merge" (`CLAUDE.md`, Merging), with the before and after of this proposal.

**Required validation** (requirements, not results; the gates of `AGENTS.md#tests`):

1. Both halves on the same source, with `bothTake` and `bothRefuse` of
   `src/core/testing/both-halves.ts`: `compile()` with no diagnostic and the language service's
   `getDiagnostics` with none, and `getHover` on the host view of each form, on the shape of
   `src/language-service/ambient-parity.test.ts`.
2. The call's refusals with their sentences: a byte length that is not a whole number of elements,
   an empty typed array, a kind that D1 refuses, an excluded record ("not supported yet").
3. The differential against the oracle (`scripts/gpu-differential.ts`) for a typed array of
   records: the same bytes in, the same bytes out, on WebGPU and on the CPU tier, read and written,
   with padding, a mixed record and a nested struct.
4. WebGL2 through `lanesOf` for a read-only record array, held to the CPU tier.
5. The compile gate (Tint and WebGL2) for the new example.
6. A packed journey that calls the example with a `Float32Array` on WebGPU.
7. The API-surface bake shows no export change, and `bun run bake:author-names` shows no name
   change.
8. The documentation checks: `bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync` and
   `python scripts/doorstop-check.py -C` after the rules change.

### Independent review record

Not run. No reviewer that did not write this revision has reviewed it. `changes/README.md`
(Independent review) requires one before the owner decides. Deviation, open: the orchestrating
session accepted the proposal on 2026-11-24 without that review. Next action: a reviewer other
than the author runs the review against the questions of `changes/README.md` and records the
findings and answers in this section, in this pull request, before it merges.

### Approval and plan record

- [decision, orchestrating session, 2026-11-24] The orchestrating session accepted this proposal
  under the owner's delegation of the same day. The owner's words, in the conversation, in Korean:
  "제대로 다시, 저의 의견이 사실 필요 없거든요" (English: do it properly again; my opinion is not
  actually needed). The session based the acceptance on OD-3, OD-9 and OD-10 (see Owner's
  decisions) and answered decisions D1 to D8 as "Decisions" records.
- Scope approved: the rule and surface text of "What changes", parts 1 to 5, the exclusion of part
  6, and decisions D1 to D8. The approved revision is the one that the merge of this pull request
  records. The merge and the owner's "merge" are not yet recorded.
- Responsibilities and milestones: stages S1 to S3 in order. No implementer, date, duration or
  cost is assigned.

### Configuration and validation record

This record does not yet apply. Delivery will require the accepted revision, the implementing
commits and pull requests with `Change: 0101`, the delivered configuration, and the observed
results of the required validation, functional and document checks kept apart. Compiler status
`implemented` will not establish downstream completion.

Probes run for this revision (observed results, not validation of the feature): `hostFace()` and
`compile()` on the programs of "Why" at `be2e83de`, on 2026-11-24, with Bun and `vitest`. The probe
file was deleted afterwards.

## What it owes downstream

Expected work, not yet agreed:

- **typeshade.github.io.** The kernel-function page and the host-entry page describe the host value
  of an array of structs as an array of objects. They gain the flat typed array, its check and its
  padding, in both locales, and show the `record-flat-binding` example. The proposal id goes into
  its `compiler-changes.md` when the pin moves.
- **vscode-typeshade.** The skill's references to the host values of §65 and §67, and any fixture
  that quotes the host view of an array of structs, accept the typed array. The proposal id goes
  into its `compiler-changes.md` when the pin moves.
- **typecv.** Phase 10 of `docs/library-structure.md` converts the stride-packed records family by
  family (KLT, Hough, the observation expansion, the k-NN and the others of row T7), each held to
  its current output with the bytes unchanged. The jagged rows stay in the offsets-and-values form
  until the separate change of part 6 lands. The proposal id goes into its `compiler-changes.md`
  when the pin moves.
