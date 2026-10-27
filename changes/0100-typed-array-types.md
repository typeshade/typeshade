---
id: '0100'
title: An author writes Float32Array, Int32Array, Uint32Array and Float64Array where an array with no size of their scalar is written, with the members ECMAScript gives a typed array
status: draft
rules:
  - '2.1'
  - '4.1'
  - '8.22'
  - '13.6'
surface:
  - 28
  - 63
  - 65
  - 67
  - 77
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The types page and the kernel-function page, en and ko, gain the four typed-array spellings, the members they have, and the typed arrays that are refused. compiler-changes.md records 0100 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's type table and kernel-function reference gain the four spellings and the refusals. compiler-changes.md records 0100 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names a surface section it will add -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0100, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                            |
| Date and attribution          | Authored 2026-10-27, UTC, by a Claude Code agent. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                 |
| Request source                | The owner (Seungup) asked in a Claude Code session on 2026-10-27, in Korean, for a proposal to add TypedArray support to TypeShade ("TypedArray 지원 기능을 TypeShade 에 추가하고 싶어. 제안서 한번 써봐"). No GitHub issue is recorded.                                                                                                                                                                                             |
| Applicability / effectivity   | The front end's type resolution (`src/compiler/ts/type-map.ts`) and member lookup, the ambient library (`SHADE_DTS` in `src/language-service/ambient.ts`), the surface-name classification (`src/core/spec-conformance/surface-names.test.ts`), the host face (`src/compiler/ts/host-face.ts`, unchanged in output). The IR, the three backends, the CPU oracle and the call layer are not affected. No release version is assigned. |
| Review baseline               | `main` at `37e6c6f0f597eb335ae0d16e7365ca122ed70a05` (2026-10-27), which carries changes 0079, 0080, 0091 and 0094 as implemented or accepted.                                                                                                                                                                                                                                                                                       |
| Review and revision authority | No pull request is assigned when this revision is written. Git records the revisions of this file. The review and merge of the proposal-only pull request record the decision.                                                                                                                                                                                                                                                       |

## What changes

### 1. Today

A host already passes a `Float32Array`, an `Int32Array`, a `Uint32Array` or a `Float64Array` for
an array with no size of `f32`, `i32`, `u32` or `f64` (Rule 8.21, surface §65 and §67). The shader
that receives it cannot write the same name. The author writes `array<f32>` in the shader and
`Float32Array` in the host, for one buffer.

Observed on the review baseline, 2026-10-27, with `compile()` and the language service's
`getDiagnostics` on the same source (bun 1.4.4, TypeScript 5.6.3):

| Source                                                  | Compiler                                    | Editor   |
| ------------------------------------------------------- | ------------------------------------------- | -------- |
| `export function scale(k: f32, xs: Float32Array)`       | `TS8002 Unknown type "Float32Array". …`     | the same |
| `declare const xs: storage<Float32Array, 'read_write'>` | `TS8002 Unknown type "Float32Array". …`     | the same |
| `const a = new Float32Array(4);` in a function          | `TS8022 Unknown identifier "Float32Array".` | the same |
| `export function scale(k: f32, xs: array<f32>)`         | accepted                                    | accepted |

The two halves agree. Both refuse.

### 2. The proposed spelling

Four ECMAScript type names become spellings of a WGSL array with no size:

| Author writes  | Type         | Element read and written as           |
| -------------- | ------------ | ------------------------------------- |
| `Float32Array` | `array<f32>` | `f32`                                 |
| `Int32Array`   | `array<i32>` | `i32`                                 |
| `Uint32Array`  | `array<u32>` | `u32`                                 |
| `Float64Array` | `array<f64>` | `f64`, the emulated double (Rule 4.4) |

The spelling is valid wherever `array<T>` with no size is valid, and nowhere else: a kernel
function's parameter (Rule 8.22), a storage binding's type (Rule 6.1), and a helper's
storage-array parameter (change 0091). Where `array<T>` with no size is refused (a uniform, a
local, a function result), the typed array is refused with the same diagnostic.

```ts
"use typeshade";

export function scale(k: f32, xs: Float32Array): void {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = xs[i] * k;
  }
}

declare const counts: storage<Uint32Array, "read_write">;
```

```ts
import { scale } from "./scale.shade.ts";

const xs = new Float32Array(1024);
await scale(2, xs); // the same type on both sides of the call
```

The type is one type with two spellings. The IR, the emitted WGSL and GLSL, the CPU oracle, the
reflection and the host view are the ones `array<T>` gives, byte for byte. A value of one spelling
is passed where the other is declared, in both directions.

### 3. The members

A typed array has the members ECMAScript's `%TypedArray%.prototype` has, as far as `array<T>` with
no size has them on the review baseline (surface §63, changes 0068 and 0079):

- an index read and write, `xs[i]`, of the element type above;
- `length`, a `u32`, as `array<T>`'s is (Rule 8.23);
- `for…of` (Rule 7.5);
- `forEach`, `some`, `every`, `reduce` from a value, `fill`, `findIndex`, `findLastIndex`,
  `indexOf`, `lastIndexOf` and `includes`, each accepted and refused where `array<T>`'s is.

Observed on the review baseline: `reduce` with no start value (`TS8019`) and `map` (`TS8099`) are
refused on `array<f32>` with no size. They stay refused on `Float32Array`, with the same text.

`push` is refused on a typed array. ECMAScript's typed arrays have no `push`, and a TypeScript
author who writes one on a `Float32Array` sees an error in every other TypeScript program. The
proposed text: `"xs" is a Float32Array, which has no push in ECMAScript. Declare it array<f32> to
push onto it (§65).` Changes 0078 and 0094 (a loop that pushes, a held length) therefore keep
`array<T>` as their spelling.

### 4. What is refused

- **The other typed arrays.** `Int8Array`, `Uint8Array`, `Uint8ClampedArray`, `Int16Array`,
  `Uint16Array`, `BigInt64Array` and `BigUint64Array` have no WGSL element type. `Float16Array`
  waits for `f16` (Rule 4.7). Each is refused with one sentence that names the reason and a remedy
  (Rule 4.5, surface §28). For example: `Uint8Array has no element type on the GPU: WGSL has no
8-bit integer. Declare a Uint32Array and read four bytes from each element with unpack4xU8().`
- **The members that are no array's.** `subarray`, `set`, `slice`, `buffer`, `byteOffset`,
  `byteLength` and `BYTES_PER_ELEMENT` are refused with the remedy an index offset gives.
- **The value.** `Float32Array` as a value (`new Float32Array(n)`, `Float32Array.from`,
  `Float32Array.of`) stays `TS8022` (decision D4).
- **Vectors.** A typed array is never an `array<vec4f>`. A `Float32Array` of vectors has no
  layout of its own (change 0048, change 0068). The author writes `array<vec4f>`.

### Not in this change

- A typed array built in a shader function (`new Float32Array(16)` as `array<f32, 16>`).
- `subarray` as a view of a storage array, and `set` as a copy into one.
- `Uint8Array` and the other narrow types as packed storage.

## Why

**One name for one buffer.** The host and the shader name the same storage. Today the host says
`Float32Array` and the shader says `array<f32>`. A TypeScript developer reads the shader's
signature with the type they already know, and copies it from the host without a translation.

**ECMAScript gives the meaning.** The element semantics coincide. A `Float32Array` store rounds to
the nearest `f32`, as an `f32` store does. `Int32Array` and `Uint32Array` stores wrap modulo 2³²
(ECMAScript's ToInt32 and ToUint32), as WGSL's `i32` and `u32` arithmetic does. `Float64Array` is
the exception: the GPU holds an emulated double (Rule 4.4), as the host table already says for
`array<f64>`.

**Small cost.** A spelling of an existing type adds no IR kind, no backend case and no Tint
measurement (Rule 13.3): the emit is the one an accepted program already gives.

### Alternatives

- **Do nothing.** The author keeps `array<f32>`. Not taken: the request is the spelling.
- **A distinct type** with its own IR kind. It would make every site that switches on a type
  decide about it, for no different behavior. Not taken.
- **Every typed array, the narrow ones emulated.** A `Uint8Array` as packed `u32` words needs
  byte-addressed writes, which are not atomic between invocations on WebGPU. That is a change of
  its own, with its own proof. Not taken here.
- **`push` on a typed array.** It would make `Float32Array` an alias of `array<f32>` with no
  exception. Not taken: ECMAScript has no such member, and Rule 2.1 (b) and the surface-names test
  hold every restated member to the running engine's prototype.

### Assumptions

- The ambient library is loaded only in a `lib: []` program (Rule 2.1 (b)), so its declarations
  of the four names do not merge with `lib.es5.d.ts`. The implementation verifies this for the
  Vite plugin's and the editor's programs.
- The ambient library can declare each typed array so that it is assignable to and from
  `array<T>` and has no `push`, with no new global name (Rule 9.8). If TypeScript cannot express
  both, decision D3 is reopened before implementation.

### Decisions at acceptance

Each decision has a recommended option, which the draft describes.

1. **D1. The set of spellings.** `Float32Array`, `Int32Array`, `Uint32Array` and `Float64Array`
   (recommended), or the first three only, leaving `array<f64>` with no ECMAScript spelling since
   the GPU holds no IEEE double.
2. **D2. The element type.** The WGSL scalar, `f32`, `i32`, `u32` or `f64` (recommended), or
   `number` as `lib.es5.d.ts` gives it. `number` is refused as a shader type (Rule 4.6).
3. **D3. `push`.** Refused on a typed array (recommended), or accepted so the typed array is the
   same type with no exception.
4. **D4. A typed array as a value.** Deferred to a later proposal (recommended), or included now:
   `new Float32Array(N)` with a constant `N` as an `array<f32, N>` local. Included now, the
   editor's type `Float32Array` has no size where the compiler has one, so `.length` would be a
   `u32` in the editor and `N` in the compiler (Rule 12.7).
5. **D5. The refusal of the other typed arrays.** One sentence under `TS8002` with the reason and
   the remedy (recommended), or a new code. The draft assigns no new code.

## What it touches

- **Rule 2.1.** Source (b) gains the four typed-array types the ambient file restates, with the
  members section 3 lists.
- **Rule 4.1.** A typed array is a TypeScript spelling of `array<T>` with no size. Appendix A gains
  the row.
- **Rule 8.22.** A kernel function takes at least one array with no size, `array<T>` or a typed
  array that spells one.
- **Rule 13.6.** An ECMAScript name is added by citing the `Math` or `console` member it is, or the
  ECMAScript standard-library declaration it restates (ECMA-262, TypedArray Objects).
- **Surface §28.** The refusal rows for the other typed arrays and for the value.
- **Surface §63.** A typed array has the array's members except `push`.
- **Surface §65.** The parameter table names the typed-array spelling beside `array<T>`.
- **Surface §67.** A storage binding's type may be a typed array.
- **Surface §77 (new).** "Typed arrays": the spellings, the members, the refusals, and the
  host and shader that name one buffer by one type.

Exports, diagnostic codes and examples do not change.

### Draft impact estimate

Known work, by area:

- **Front end.** Resolve the four names to `array<T>` with no size where a type is written. Refuse
  `push`, the members of section 4 and the other typed arrays with their sentences.
- **Language service.** Declare the four names in `SHADE_DTS`; type the refusals the same
  (Rule 12.7).
- **Tests.** Each spelling and each refusal on both halves on one source; rows in
  `src/language-service/ambient-parity.test.ts`; the surface-names test holds the restated members
  to `%TypedArray%.prototype`; an emit equality test: a program with `Float32Array` and the same
  program with `array<f32>` give the same WGSL, GLSL, reflection and host view.
- **Documents.** The rules and surface sections above, and a `CHANGELOG.md` entry (Rule 13.8).

Compatibility: no program that compiles today changes its meaning. Each of the four names is
refused today everywhere. A file that declares its own type named `Float32Array` keeps it, since
the file's declaration wins (Rule 2.1).

Dependencies: none. Changes 0068, 0079 and 0091 are on the review baseline.

Duration and cost: unknown. No estimate is established. The work is smaller than change 0080,
since no IR, backend or call-layer change is proposed.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decision on D1 to D5, the
review and merge reference of the proposal-only pull request with `status: accepted`, the
approved revision and scope, and the assigned responsibilities. No approver, date or milestone is
recorded here.

### Configuration and validation record

This record does not yet apply. Delivery will require this evidence, none of which exists yet:

- functional: each spelling and each refusal on both halves on one source (`compile()` and
  `getDiagnostics`, plus `getHover` for the element type), with the diagnostic code and text;
- functional: the emit equality test above, on WGSL, GLSL, the CPU oracle, `reflect()` and the
  host view;
- functional: `bun run build`, `bun run test`, `bun run gate:compile`, and the doc snippet test
  on the implementing head;
- document: `bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync` and
  `python scripts/doorstop-check.py -C` on the implementing head, and an audit that §28, §63,
  §65, §67 and §77 match the delivered configuration.

## What it owes downstream

- **typeshade.github.io.** The types page and the kernel-function page, in English and Korean,
  gain the four spellings, their members and the refused typed arrays. `compiler-changes.md`
  records 0100 when the pin moves.
- **vscode-typeshade.** The skill's type table and its kernel-function reference gain the
  spellings and the refusals. `compiler-changes.md` records 0100 when the pin moves.
- **radiance, typenn, typecv.** Nothing is owed: no page describes the old behavior, and an
  `array<T>` keeps its meaning. A kernel may move to the typed-array spelling when the pin moves.
