---
id: '0065'
title: A host makes a zeroed Resident of a length and an element, with no host copy and no upload until a call writes it or the host reads it
status: draft
rules:
  - '11.8'
surface:
  - 65
  - 69
exports:
  - resident
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The pages that teach resident(value) gain resident(length, element): the kernel-function copy of §65 and the WebGPU concept page's Resident copy, in en and ko. The API reference lists the new overloads from the pinned compiler's JSDoc with no hand edit. compiler-changes.md records 0065 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's references/host.md gains resident(length, element) beside resident(value). compiler-changes.md records 0065 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names files it will add and files in downstream repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document                      | Proposal 0065; this file is the proposal source.                                                                                                                                                                                                                                                                                         |
| Revision context              | 2026-10-13, UTC. The date means the authorship of this draft. It is not an approval date. A verification pass of the same date read every citation again at `96dbaa9f` and corrected the claims in "What changes", "Why" and "What it owes downstream". It changed no proposed behavior, except as the decisions taken by default state. |
| Request source                | The owner's request in a Claude Code session of 2026-10-13. The request cites gap C11 of the gap analysis of `origin/main` at `96dbaa9f` (2026-10-13), which TypeNN's training profiles drew: TypeNN must upload zero arrays to create its output arrays.                                                                                |
| Attribution                   | Drafted by Claude Haiku 5.5, in a Claude Code session, at the owner's request. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                     |
| Current lifecycle state       | `draft`. No decision has accepted it. Acceptance requires a merged `accepted` status in this file.                                                                                                                                                                                                                                       |
| Applicability / effectivity   | `resident()` and `ResidentArrayState` in `src/core/resident.ts`; `ScratchState` in `src/core/fuse-plan.ts`, whose zero path moves; the bind paths `src/core/host-kernel.ts`, `src/core/host-compute.ts`, `src/core/host-draw.ts` and `src/runtime/program.ts`; Rule 11.8; surface §65 and §69. No release version is assigned.           |
| Review baseline               | `origin/main` at `96dbaa9f` (commit `96dbaa9f`, "Copy flat f32, i32 and u32 arrays as bytes in pack and readInto (#648)").                                                                                                                                                                                                               |
| Review and revision authority | No pull request is assigned yet. Git records revisions. The pull request's review and merge record the decision.                                                                                                                                                                                                                         |

## What changes

A `Resident` (Rule 11.8) is made today from a host value only: `resident(value)` (Rule 8.21) copies
the value and keeps the copy. The first call that runs on WebGPU uploads that copy. A host that
needs an output array of `n` zeros must allocate `n` zeros on the host and upload them. Before:

```ts
const out = resident(new Float32Array(1_000_000)); // 4 MB of zeros, held on the host
fill(out); // the first WebGPU call uploads the 4 MB of zeros
const y = await out.read(); // one download of 4 MB
```

After, with the proposed form:

```ts
const out = resident(1_000_000, 'f32'); // no host copy, no upload
fill(out); // the call makes a zeroed device buffer; the call writes no byte
const y = await out.read(); // one download of 4 MB, the first copy of the array
```

Rule 11.8 gains a second form, `resident(length, element)`. It does the following:

1. Takes a length, which is a whole number from 1 to 4294967295, and an element, which is `'f32'`,
   `'i32'` or `'u32'`. The element has no default (see "Why", the spelling).
2. Returns a `Resident` of a `Float32Array`, an `Int32Array` or a `Uint32Array` that holds `length`
   zeros.
3. Holds no host copy and no device buffer when it is made. It writes no byte to any queue.
4. On WebGPU, a call that uses it makes a zeroed storage buffer, as WebGPU makes every new buffer.
   It writes no byte. A call that writes it leaves the device copy the newer.
5. `read()` returns a new array of zeros, with no device copy and no host copy kept, when no call
   has written the handle and `write()` has not run. Otherwise it downloads the device buffer
   once, as a `Resident` does today (decision 5).
6. Keeps every other rule of a `Resident` as it is: `write()` replaces the contents, `destroy()`
   frees the buffer, a use after `destroy()` is a `TypeError`, and an error of a queued call stays
   on the handle for `read()`.

On the CPU tier, a call that uses the handle makes its host copy zeroed. That is an allocation,
not an upload. On WebGL2, the first draw or kernel call that uploads the handle uploads its zeroed
host copy as any `Resident` does. That upload is a texture upload and not a WebGPU
`writeBuffer`. This proposal does not reduce it.

The one-argument form does not change. `resident(5)` still wraps the number 5 (Rule 8.21). The
number of arguments chooses the form, so `resident(8, undefined)` is the zeroed form and R2
refuses it (decision 4). A call with two arguments whose first argument is not a number is refused
(R3).

The length is held to 4294967295 and no lower bound than 1, as `scope.scratch(length)` is held to
`MOST_ELEMENTS` (`src/core/fuse-plan.ts` line 242). A buffer past the device's `maxBufferSize` is
WebGPU's to refuse when a call makes it. Change 0051 (draft) may name that limit.

The refusals:

| Id  | Where                              | Class       | Text                                                                                               |
| --- | ---------------------------------- | ----------- | -------------------------------------------------------------------------------------------------- |
| R1  | `resident(length, element)`        | `TypeError` | `resident(): a zeroed Resident takes a length that is a whole number from 1 to 4294967295; got 0.` |
| R2  | `resident(length, element)`        | `TypeError` | `resident(): a zeroed Resident takes the element 'f32', 'i32' or 'u32'; got 'f64'.`                |
| R3  | `resident(a, b)`, `a` not a number | `TypeError` | `resident(): with an element, the first argument is the length, a whole number; got an array.`     |

`scope.scratch(length, element)` inside a `fuse` body (Rule 11.13) does not change. Its refusals
and its lifetime stay as they are. This proposal does not give a scratch array a host copy.

The element `f64` is not part of this form. A later proposal may add it.

Implementation shape. A scratch array is already a `Resident` that holds no host copy and whose
first use makes zeros (`ScratchState`, `src/core/fuse-plan.ts`, lines 244 to 330). The change moves
that zero path into a base class, `ZeroedState`, in `src/core/resident.ts`. `ScratchState` extends
it and keeps its phase checks, which refuse a use outside the plan of its scope. The zeroed handle
extends the base class with no phase check.

## Why

The gap. The gap analysis (C11) found two ways to make a zeroed array, and neither is public. The
internal `zeroedBuffer(d, size)` (`src/core/host-entry.ts`, line 659) is internal: no public export names it. The public
`resident(value)` needs a host value and keeps a host copy. `scope.scratch(length, element)` works
only inside a `fuse` body. So TypeNN uploads zeros to make each output array. The cost per output
is `length × 4` bytes uploaded, plus `length × 4` bytes of host memory held for the handle's life.
Neither cost was measured on a device for this draft. The bytes saved per output are known.

The alternatives, with the reason each was not chosen:

1. `resident.zeros(length, element)`. A property on a function object. `zeros` has no WGSL or
   ECMAScript source. Rule 13.6 admits a new author-facing name only with its source, and host code
   is written by the same authors. Rejected.
2. A new export `zeros(length, element)`. The same name, and a new export. Rejected for the same
   reason.
3. `resident(Float32Array, length)`, with the typed-array constructor. The constructor is an
   ECMAScript name, but Rule 13.6 cites a source only for a `Math` or `console` member. The rule
   would change first. Not chosen now. A later proposal may choose it.
4. `resident(new Float32Array(length))`, with the upload made lazy. The host allocation stays, and
   the first WebGPU call still uploads the zeros. Rejected.
5. Chosen: `resident(length, element)`, the existing name with a second argument. A number as the
   only argument is a scalar host value (Rule 8.21), so the element cannot default. The element is
   required, which keeps a `u32` output from becoming an `f32` one by accident.

Compatibility. Today the second argument of `resident()` is refused by the TypeScript signature
and ignored at run time. A JavaScript caller that passes two arguments, with a number first, gets a
zeroed handle instead of the number. The host view under `tsc` refuses the form before the run.
The repository's own call sites were searched at `96dbaa9f`: `examples/hosts/host-resident/host.ts`
and `examples/hosts/index.ts` pass one argument each. Their output arrays use
`resident(new Float32Array(n))`. Those examples keep their behaviour and are owed a new form under
"What it owes downstream".

Estimates. The change is small: a base class moves, one overload is added and the zero path is
shared. Its effort is unestimated. Its bundle effect on `typeshade/runtime` is unknown until it is
measured against `scripts/bundle-budget.json`. It adds no dependency.

### Decisions taken by default

Each is a naming or consistency choice inside an established pattern. A reviewer may overturn one
at acceptance. The default of 1 to 3 is the draft's own proposal. The default of 4 and 5 comes from
the verification pass of 2026-10-13.

1. The spelling. Default: the overload `resident(length, element)`. Any other spelling needs a
   rule of its own, as the alternatives above show.
2. A length of 0. Default: refused at creation (R1). The other choice accepts 0 and refuses the
   first GPU use, as a scratch array does. The first choice names the error where it is made. A
   caller with a possibly empty length, such as a pool of tensors, uses `resident(new
Float32Array(0))`, which stays valid.
3. The element `f64`. Default: not part of this proposal.
4. A second argument of `undefined`. Default: the argument count chooses the form, so R2 refuses
   it. The other choice reads `undefined` as a missing argument, and `resident(8, undefined)` then
   wraps the number 8. That hides a mistake of the caller.
5. `read()` of a handle no call has written. Default: it returns a new array of zeros and keeps no
   host copy. Reason: `ScratchState.sync` makes a host copy (`src/core/fuse-plan.ts`, line 301), and the next WebGPU call would then upload that copy of zeros, which the form exists
   to avoid. Inference from `bufferFor` in `src/core/resident.ts`: a handle with a host copy and
   `fresh` equal to `'host'` uploads.

## What it touches

- **Rule 11.8.** The `resident(value)` sentence gains the zeroed form, its facts and its
  refusals R1 to R3. The rule's "Derives from" line gains change `0065`.
- **Surface §65.** The "Resident arrays" paragraph gains `resident(length, element)` with one
  example, the CPU and WebGL2 facts of this proposal, and the refusals.
- **Surface §69.** The paragraph on a `Resident` as a binding gains the zeroed handle. Its first use
  on WebGPU makes a zeroed buffer, as in §65.
- **Exports.** `resident` is reshaped: it gains the overload `resident(length: number, element:
'f32' | 'i32' | 'u32')` with the result types `Resident<Float32Array>`, `Resident<Int32Array>`
  and `Resident<Uint32Array>`. The one-argument form and the type `Resident` do not change.
- **Code.** `src/core/resident.ts`: the overload and R1 to R3 in `resident()`, and `ZeroedState` as
  the base class of `ResidentArrayState`'s zero path. `src/core/fuse-plan.ts`: `ScratchState`
  extends `ZeroedState` (lines 244 to 330). The bind paths read `measure`, `sync` and `bufferFor`
  as they do now, and need no change.
- **Tests owed.** The language service reads no declaration of `resident` (no file under
  `src/language-service` names it), so the editor half of the test is the typed host view under
  `tsc`, as `src/compiler/ts/host-kernel.test.ts` tests a queued call. Both halves are:
  1. `src/compiler/ts/host-kernel.test.ts`: `const r: Resident<Float32Array> = resident(8, 'f32')`
     type-checks; `resident(8, 'f64')` is a type error under `tsc`.
  2. `src/runtime/runtime.test.ts` and `src/fuse.test.ts`, on their fake devices, which count
     `createBuffer` calls and the bytes passed to `queue.writeBuffer` and `copyBufferToBuffer`.
  3. The refusals R1 to R3 with their texts, `resident(8, undefined)` refused by R2, and
     `resident(5)` read back as 5.
  4. A zeroed handle read once, then used by a WebGPU call: 0 `writeBuffer` bytes in all (decision 5).
- **Documents.**
  - `CHANGELOG.md` gains an entry.
  - `src/__api__/surface.md` is baked again (`bun run bake:api-surface`): `resident` gains an
    overload.
  - `reqs/` follows the edits of Rule 11.8 and of surface §65 and §69, through `bun run
reqs:sync` and `python scripts/doorstop-check.py -C`.
  - `AUTHORING.md` (line 1714) may use the zeroed form for its output array.
  - `examples/hosts/index.ts` embeds the source of `examples/hosts/host-resident/host.ts`, so it
    is generated again with it. The set of examples does not change.

### Acceptance

These are the measurable results the implementation must show. None of them has run.

1. On the fake WebGPU device, `resident(1_000_000, 'f32')` makes 0 `writeBuffer` bytes, 0
   `createBuffer` calls and holds no host copy.
2. `await r.read()` before any call writes `r` returns a `Float32Array` of 1,000,000 zeros, with 0
   device copy bytes.
3. A kernel `fill(out)` that writes `r` on WebGPU makes 0 upload bytes. After it, `await r.read()`
   equals the CPU oracle's output for the same call, element for element, for 1,000,000 values.
4. The same program gives the same bits on the CPU tier and on WebGL2, in the journey run in
   Chromium. The record names the browser and its version when it runs.
5. The refusals R1, R2 and R3 are thrown with the texts above for `resident(0, 'f32')`,
   `resident(1.5, 'f32')`, `resident(4, 'f64')` and `resident([1], 'f32')`.

### Configuration and validation record

This record does not yet apply. Delivery requires the implementation commits with `Change: 0065`,
the test results named above with their date and configuration, and the bundle size measured
against `scripts/bundle-budget.json`.

## What it owes downstream

- **typeshade.github.io.** Facts, read at the site's `0c56a88`:
  - The English API reference is generated from the pinned compiler's JSDoc (`src/lib/api.ts`), so
    the new overload appears with no hand edit.
  - The Korean API reference is a hand translation keyed by a hash of the English source:
    `content/api/ko/resident.json` and, where its text changes, `content/api/ko/resident-interface.json`.
    The new JSDoc changes the hash. `bun run check:api-ko` then names the entry, and the
    translation is made again.
  - `content/api/ko/fuse.json` and `content/api/ko/fusescope.json` mention `resident()` and
    `scope.scratch`. They change only if the JSDoc of those exports changes. This proposal changes
    neither.
  - The site has no `resident(` call in `src/i18n/en.ts`, so the kernel-function copy of §65 and
    the WebGPU concept page need no new sentence. The Korean guide page
    `content/guide/ko/the-cpu-oracle.md` (line 336) translates a section of `AUTHORING.md`, whose
    line 1714 uses `resident(new Float32Array(n))` for an output array. If the implementation
    edits that line, `bun run check:guide` names the page.
  - `compiler-changes.md` records `0065` when the pin moves.
- **vscode-typeshade.** Facts, read at the editor's `bbb2d9e`.
  `plugins/typeshade/skills/typeshade/references/host.md` (lines 51 to 54) and
  `plugins/typeshade/skills/typeshade/SKILL.md` (lines 390 to 393) use `resident(value)` for
  inputs and outputs. The host reference gains the zeroed form beside it, and the skill's example
  of the output array may use it. `packages/tsserver-plugin/src/fixtures.ts` (lines 403 and 449)
  holds host-view fixtures that name `resident`. A fixture for the new overload is owed there.
  `compiler-changes.md` records `0065` when the pin moves.
- **typenn (outside `scripts/changes.ts`).** Read at typenn `f22b352`: `acquire` in
  `src/runtime/device.ts` (line 274) makes an output array with `resident(values ?? new
Float32Array(length))`. For an output, `values` is absent, so the zeroed form replaces it. A
  length of 0 keeps the one-argument form (decision 2). This record does not declare typenn in
  `downstream`, as the record of 0058 does not declare its consumers. Its work is owed when
  typenn's pin moves.
- **This repository.** `examples/hosts/host-resident/host.ts` and `examples/hosts/index.ts` use
  `resident(new Float32Array(n))` for their output arrays. They change to the zeroed form in the
  pull request that implements this proposal. `examples/hosts/index.ts` is generated from them.
