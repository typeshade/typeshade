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
| Review and revision authority | [PR #802](https://github.com/typeshade/typeshade/pull/802), opened on 2026-10-27, UTC, as a draft, is the review record. Git records the revisions. The review and merge records of PR #802 record the decision; this file does not claim that merge.                                                                                                                                                                                                                                                                                                                                                 |

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

## Why

### The evidence

**Fact** (the audit, sections 1, 2.1 and 3, labelled there as counts of its scripts at TypeCV
`73c84dc`). Row T7 is rank 2 of 27 by the lines that a compiler change removes:

- 970 storage accesses at `b * N + c` and 211 local ones in the 30 kernel modules (`idioms.mjs`);
- 119 runs of two or more statements that read or write one record's fields in order, 342 lines,
  which one destructuring each would cut by up to 223 (`runs.mjs`);
- 208 host lines in 20 modules that write or read a field at a constant stride (`hostpack.mjs`),
  most of them in `motion/gpu/klt.ts` (47), `analysis/gpu/hough.ts` (22),
  `motion/gpu/klt-tracker.ts` (22) and `sfm/tracks/gpu/observation-expansion.ts` (22);
- 5 jagged row bounds read by offsets (`csr.py`): `cloud-knn.shade.ts:104-105`,
  `dense-mesh.shade.ts:141-142`, `triangulation.shade.ts:354-355`, `bundle.shade.ts:837`,
  `joint-focal.shade.ts:799`.

**Fact** (TypeCV `main` at `e68ecd5`, read for this proposal). The KLT start record is four `f32`s,
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
point and its cell at a stride of 3 (`src/mvs/gpu/cloud-knn.shade.ts`, lines 69-74:
`gridPoints[i * 3]`, `gridPoints[i * 3 + 1]`, …, `gridCells[i * 3 + 2]`).

**Fact** (the audit's probes Q58 and Q62 at pin `725b2969`; the probes are scripts outside the
TypeCV repository, as the audit's section 0 states). The kernel side compiles and destructures. The
CPU tier refuses the `Float32Array` that TypeCV's hosts hold, with the sentences quoted in "Before
and after", and accepts arrays of objects or of arrays.

**Fact** (a probe of `compile()` and `hostFace()` at `b009cd8a`, run for this proposal in a test
file that was then deleted). The four forms compile with no diagnostic: a `storage<array<P3>>`
binding, a `storage<array<array<f32, 3>>>` binding, a kernel function's `array<P3>` parameter and an
`array<Rec>` parameter with `f32`, `u32` and `vec3f` fields. The host view types each as an array of
objects or of arrays, or a `Resident` of it, and names no typed array. The code at `b009cd8a`
explains it: `flatWidth` in `src/core/host-entry.ts` returns `undefined` for a struct or an array
element, and `runtimeCount` then refuses any value that is not an `Array`.

**Fact** (the same probe). The manifest type of the module's default export (`program`) types the
`array<array<f32, 3>>` binding's elements as `readonly number[] | Float32Array | Int32Array |
Uint32Array | Float64Array`, while the bindings object of the entry types them as
`readonly number[]`. **Inference.** `pack` reads a fixed array through `listOf`, which accepts any
`ArrayLike`, so each element may already be a typed array of 3. The flat typed array of all elements
is not accepted by either.

### The goal

**Inference.** A TypeScript author writes `pts[i].y` and `const [x, y, z] = pts[i]`, and holds the
records in one `Float32Array`. Today the kernel side allows the first, and the host side refuses the
second, so TypeCV writes neither: it keeps the stride in both halves. An array of objects costs the
host an allocation per record and a pack per call, and TypeCV's hosts already hold the bytes. This
proposal lets the two halves meet: the kernel names the fields, and the host keeps its bytes.

**Inference.** What it removes in TypeCV: the stride arithmetic in the kernels (up to 223 lines by
the audit's upper bound) and the field offsets in the host packers that only exist to match it. A
host that builds records field by field still writes at a stride; one that receives them from
another call or a file does not. The bytes that each call binds do not change, so each conversion
can be held to its current output.

### The precedent

**Fact** (surface §65, the table of host values; change 0068). A kernel function's `array<vecN>`
takes the scalar's typed array, `N` numbers per element, and `.length` counts vectors. An entry's
`storage<array<T>>` of vectors takes the same (§67). This proposal extends that form from a vector
to a record. D2 states the one difference: the call pads an `array<vec3f>` element, and a record
keeps the padding of its layout.

### Relation to accepted proposals

- **0068 (vec4 views, accepted).** It states the host value of an `array<vecN>` kernel parameter.
  This proposal adds the record. It does not change 0068's packed `vec3` form.
- **0082 (private input layout, accepted).** A read-only array of flat objects may upload only the
  fields the kernel reads (`projectInputLayout`, `packed`). A typed array of records goes through the
  same projection: `pack` reads the logical layout from the typed array and writes the physical one.
  The projection does not change what the host passes.
- **0095 (proof offset forms, accepted).** It lets a kernel loop write a record at `b + w*i + o`, the
  stride form that TypeCV writes today. It covers the kernel side of the hand-packed form in part.
  This proposal covers the host side, so that the kernel can name the field instead of the offset.
  The two are independent: 0095 keeps the flat form working, and this one makes it unnecessary.
- **0080 and 0081 (Map and Set, accepted; string keys and Record, implemented).** A key-type field
  and a `Record` in a binding are already ids and arrays of values (Rule 8.21). This proposal adds
  nothing to them, and part 5 excludes a key-type field from the flat form.
- **0088 and 0093 (optional values, implemented).** An optional field has no binding layout, so a
  record with one never reaches this form (part 5).
- **0094 (device-resident counts, accepted).** A pushed array may come as `{ array, length, offset?
}`. Under this proposal `array` may be a typed array of records, or its `Resident`. A push of a
  struct writes the record at its offset (Q56 measures a struct push today).

**Fact** (the front matter of every proposal at `b009cd8a`). Accepted proposals that are not
implemented also declare these items: Rule 8.21 (0082, 0094, 0095), Rule 8.23 (0068, 0077, 0080,
0082, 0085, 0091, 0094), §64 (0051, 0056, 0085, 0089, 0090), §65 (0051, 0056, 0065, 0067, 0068,
0077, 0080, 0082, 0085, 0091, 0094, 0095) and §67 (0051, 0054, 0085, 0092). The implementation
that lands second rebases on the others' text.

### Alternatives considered

- **Keep the hand packing.** Cost: none in the compiler. TypeCV keeps 970 stride accesses and 208
  packing lines, and every new kernel repeats the form. The surface already offers the field names,
  so the cost falls on the one place a TypeScript author does not expect it. Rejected.
- **A shared bindings module with one control struct.** TypeCV could move its strides and offsets
  into one module of named constants (`const START_STATUS = 3`). Cost: none in the compiler. It
  names the offsets, but the kernel still writes `kltStart[4 * k + START_STATUS]` and the host still
  packs. It is a refactor TypeCV can do today, and it does not reach `pts[k].y`. Rejected as the
  answer; it stays open to TypeCV as an interim step.
- **Author-declared layouts.** The author would write `@layout` or a stride beside the type. Cost: an
  attribute that neither WGSL nor ECMAScript spells, which needs a row of the extension table of `docs/language-design.md` §9 (Rules 9.6 and 13.6), and
  `@size` and `@align` are refused today (§51). The layout is already the type's, and `reflect()`
  reports it. Rejected.
- **A struct-of-arrays host value.** One typed array for each field. Cost: a new binding shape on
  every tier, since WGSL binds an array of structs as one buffer, and change 0082 records that no
  multi-column SoA policy is selected. TypeCV's hosts hold interleaved records. Rejected.

## Unresolved decisions

Each decision has alternatives, their cost and a recommendation, for the owner. D1, D2, D3 and D5
must be decided before acceptance. D4, D6 and D7 may stay open, bounded by the recommendation.

**D1. Which typed arrays a record takes.**

- (a) `Float32Array`, `Int32Array` or `Uint32Array`, for any record. The typed array is a container
  of 4-byte words. Each field is read with its own type at its offset, whatever the array's kind, so
  a `u32` field in a `Float32Array` is the bits of that word, as WebGPU binds them. Cost: one
  `DataView` read per field on the CPU tier; a host that writes a `u32` field through a
  `Float32Array` writes a float, so it needs a second view, `new Uint32Array(f.buffer)`.
- (b) Only the scalar's typed array, for a record whose fields are all one scalar type; a mixed
  record keeps the array of objects. Cost: KLT's start record (`f32` and a `u32` status) stays
  hand-packed or keeps its status as an `f32`, as today.
- (c) `Float32Array` always, with integer fields converted as numbers. Cost: the bytes differ from
  what WebGPU binds, so the bulk copy of part 2 is lost for a mixed record.
- (d) Any `ArrayBufferView`, `DataView` and `Uint8Array` included. Cost: the host view names a wide
  type, and a byte length must also be a multiple of 4.

Recommendation: (a). The bytes are the layout on every tier, one copy binds them, and the host view
names the struct's own scalar array when the record has one scalar type, and the union of the three
when it is mixed.

**D2. Whether the stride includes the padding.**

- (a) The stride of `reflect()`, padding included. `struct { v: vec3f }` is 4 numbers per record,
  and the fourth is padding. Cost: the host writes padding words; the form differs from an
  `array<vec3f>`, whose call pads 3 numbers to 4.
- (b) Packed: the call removes the padding, as for `array<vec3f>` (change 0068). Cost: a copy element
  by element on every call, and the bytes the host holds are not the bytes the GPU holds, so a
  `Resident` of the typed array needs a repack.

Recommendation: (a). The bytes are the ones `reflect()` reports and the GPU holds, which is what a
host that already packs at a stride holds today. The `array<vec3f>` form stays as change 0068 has
it.

**D3. Whether the array of objects stays accepted.**

- (a) Keep both. The call tells them apart by the value's kind, and the host view is the union.
  Cost: two paths in `pack`, `toCpu` and `fromCpu`, and a longer host type.
- (b) Retire the array of objects for the forms of part 1. Cost: a breaking change for every host
  that passes objects today: the tests of the `loop-struct-array` example (`examples/loop-examples.test.ts`, `src/compiler/ts/host-kernel.test.ts`), the site's pages, and §65 and §67's
  examples; and the loss of 0082's projection, which reads objects.

Recommendation: (a). The change is then additive, and nothing that runs today changes.

**D4. How the CPU tier reads a typed array of records.**

- (a) Convert at the call: read each record into the CPU tier's representation when the call starts,
  and write it back when it ends, as the tier does for a typed array of scalars today. Cost: one copy
  in and one copy out per call. No change to the generated code or the oracle.
- (b) Read in place: the generated code reads `pts[i].y` from the caller's bytes at its offset.
  Cost: a second representation in `cpu-codegen.ts` and the op library for every struct-array
  access, which the oracle shares (Rule 11.1), and the CPU tier's copy of a scalar array would stay
  a copy.

Recommendation: (a). It keeps one representation in the oracle, and it matches what the tier does
for every other array. Under both, `pts[i]` read as a whole is a copy of the record (part 4).

**D5. A jagged `array<array<T>>` in storage.**

- (a) A lowering to offsets and values (part 6). Cost in rules: Rule 4.1 says every type is a WGSL
  type, and `array<array<T>>` is none, so it needs an amendment or a new rule beside Rule 4.4, and
  Rule 8.21 gains the `{ offsets, values }` host value. Cost in the surface: §51 (the refusal goes),
  §64, §65 and §67, and a new section for the form. Cost in code: one declaration becomes two
  bindings in the front end, so `reflect()` and the manifest report two entries for one name; the
  index and `.length` rewrites on the IR; the host view; the CPU tier; the compile gate, since every
  tier must agree. A write that changes a row's length has no meaning, so `push` is refused.
  TypeCV gain: 5 row bounds, and its k-NN reads go through a bucket index anyway.
- (b) Keep the refusal of #800 and its remedy. Cost: none. The author writes the two arrays, as
  TypeCV does today.

Recommendation: (b). The lowering adds a TypeShade type that is no WGSL type, for 5 sites, and a
binding whose name is not one buffer. The remedy already names the form, and a later proposal can
take (a) when more evidence comes.

**D6. A kernel function's `array<array<T>>` parameter.**

The parameter compiles today, runs on the CPU tier and takes an array of typed arrays (part 6).

- (a) Keep it as it is. Cost: none; it is the one place a jagged array works, on the CPU only.
- (b) Refuse it with §51's `TS8002`, for one rule in both places. Cost: a host that uses it breaks,
  and a new refusal needs both halves and a Tint measure (Rule 13.3) — though no WGSL is emitted for
  it.
- (c) Lower it to the GPU under D5 (a). Cost: D5 (a)'s, without the binding name problem, since the
  call can pack the rows into offsets and values.

Recommendation: (a) in this proposal. Its future follows D5.

**D7. A record with an `f64` field.**

- (a) Exclude it (part 5). Cost: such a record keeps the array of objects.
- (b) Take a `Float64Array` of the record's logical numbers, which the call splits into `hi` and `lo`
  as it does for an `array<f64>` binding. Cost: the host's bytes differ from the GPU's, so a
  `Resident` repacks, and the offsets of a mixed record are not the typed array's indices.

Recommendation: (a). TypeCV's records have no `f64` field among the counted sites.

## What it touches

- **Rule 8.21.** Its sentences on the binding of an entry ("one of structs takes an array of
  objects") and on a kernel function's arrays ("or, for a struct, an array of objects") gain the
  flat typed array of the layout, its check and its `Resident`, for the elements of part 1 with the
  exclusions of part 5.
- **Rule 8.23.** Its sentence on `.length` gains that an array of records counts records, whatever
  its host value.
- **Surface §64.** The sentence after the table of host values: a helper's `array<T, N>` stays a
  list, and the flat form belongs to the arrays of §65 and §67.
- **Surface §65.** The table of host values (the row `array<S>`, a struct, and a row for
  `array<array<T, N>>`), the check and its sentence, and "The tiers" for WebGL2.
- **Surface §67.** The table of the bindings object (the row `storage<array<S>>` of a struct, and a
  row for an array of fixed arrays), the check, and the read-back.
- **Example `record-flat-binding` (new).** An entry over `storage<array<P3>>` and a kernel function
  over `array<Rec>` with a `u32` field, each called with a `Float32Array`, through the compile gate
  and a packed journey.
- **Host view types.** `bindingTsType` and the kernel parameter types in
  `src/compiler/ts/host-face.ts`, and the manifest type of the default export, which disagree today
  for an array of fixed arrays (Why).
- **Code.** `src/core/host-entry.ts` (`flatWidth` or a new record test, `bulkOf`, `runtimeCount`,
  `pack`, `readInto`, `toCpu`, `fromCpu`, the projection of `packed`), `src/core/host-kernel.ts`
  (`checkArray`, the CPU path, the `Resident` path), `src/core/host-kernel-gl.ts` (`lanesOf`).
- **Not touched.** No export: the host value is a type of the generated view, not a name of the
  package. No diagnostic code: the refusals are `TypeError`s of the call, and §51's `TS8002` stays
  under D5 (b). No IR node, no WGSL and no GLSL text.
- **If D5 is (a).** Rule 4.1 (amended) or a new rule, §51, a new surface section, and an IR
  rewrite join the front matter before acceptance.

### Draft impact estimate

**Known.** The change is additive under D3 (a). A call that passes an array of objects runs as
today. The emitted WGSL and GLSL do not change, so the emit goldens do not change. The host view
types widen, so a fixture or a page that quotes them changes.

**Estimate.** The runtime work is the record branch of the functions in "Code" above, on the model
of the vector branch that `flatWidth` and `bulkOf` serve today, and the host view. The validation
work is the larger part: both halves, the differential against the oracle for the new host value,
and a journey. The bundle growth of `typeshade/runtime` is unmeasured. Duration and cost are
unestimated.

**TypeCV.** Up to 223 kernel lines by the audit's upper bound (**Inference**), and part of the 208
host lines, after TypeCV converts each family.

**Required validation** (requirements, not results; the gates of `AGENTS.md`):

1. Both halves on the same source: `compile()` with no diagnostic and the language service's
   `getDiagnostics` with none, and `getHover` on the host view of each form, on the shape of
   `src/language-service/ambient-parity.test.ts`.
2. The call's refusals with their sentences: a byte length that is not a whole number of elements,
   an empty typed array, a kind that D1 refuses, an excluded record.
3. The differential against the oracle (`scripts/gpu-differential.ts`) for a typed array of records:
   the same bytes in, the same bytes out, on WebGPU and on the CPU tier, read and written, with
   padding, a mixed record and a nested struct.
4. WebGL2 through `lanesOf` for a read-only record array, held to the CPU tier.
5. The compile gate (Tint and WebGL2) for the new example.
6. A packed journey that calls the example with a `Float32Array` on WebGPU.
7. The API-surface bake shows no export change.
8. The documentation checks: `bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync` and
   `python scripts/doorstop-check.py -C` after the rules change.

**Decisions before acceptance:** D1, D2, D3 and D5. D4, D6 and D7 may stay open.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decision with its date and the
merge of PR #802 with `status: accepted`, the approved revision, the decisions D1, D2, D3 and D5,
the finalized declarations, and the required validation above. No implementer, milestone, duration
or cost is assigned.

### Configuration and validation record

This record does not yet apply. Delivery will require the accepted revision, the implementing
commits and pull requests with `Change: 0101`, the delivered configuration, and the observed results
of the required validation, functional and document checks kept apart. Compiler status
`implemented` will not establish downstream completion.

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
  under D5 (b). The proposal id goes into its `compiler-changes.md` when the pin moves.
