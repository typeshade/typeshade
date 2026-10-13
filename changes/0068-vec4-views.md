---
id: '0068'
title: 'A fused chain holds a vec4f scratch array as a local, and the rules say what an array<vec4f> kernel parameter already does'
status: draft
rules:
  - '8.23'
  - '11.13'
surface:
  - 65
  - 71
exports:
  - FuseScope
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The Korean API entry content/api/ko/fusescope.json (a hand translation keyed by a hash of the JSDoc) is translated again for the scratch overload with the element 'vec4f'. The English API reference is generated from the JSDoc with no hand edit. The site has no page that copies §65 or §71. compiler-changes.md records 0068 when the pin moves.
  - repo: vscode-typeshade
    what: The scratch-array paragraphs of plugins/typeshade/skills/typeshade/SKILL.md and references/host.md gain the element 'vec4f'. compiler-changes.md records 0068 when the pin moves.
---

<!-- doc-refs: skip-file — this proposal names the files, the tests and the element spelling that the implementation adds, which this tree does not have yet -->

**Document control**

| Field                       | Record                                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document                    | Proposal 0068; this file is the proposal source.                                                                                                                                                                                                                                                                                                     |
| Revision context            | Drafted 2026-10-13, Asia/Seoul. This date is the authoring context. It is not an approval date. A verification pass of 2026-10-13 (UTC) read the draft against `96dbaa9f` and ran a probe of the current behavior. The probe showed that most of the draft's "After" already holds at `96dbaa9f`. This revision narrows the proposal to what is new. |
| Request source              | The repository owner, Seungup, asked in the project conversation for vector access over scalar arrays in kernel functions and fusion. It follows a gap analysis of TypeNN training profiles. No GitHub issue is recorded for this draft.                                                                                                             |
| Current lifecycle state     | `draft`. No approval has been given. No implementation exists.                                                                                                                                                                                                                                                                                       |
| Applicability / effectivity | Kernel functions (Rule 8.22, Rule 8.23, surface §65), the fuse planner and scratch arrays (Rule 11.13, surface §71), `src/core/fuse-plan.ts`, `src/core/fuse-entry.ts`, and downstream documentation. No release version is assigned.                                                                                                                |
| Review baseline             | `origin/main` at `96dbaa9fa7208aa786a4937a8c90521e59023ffa` (commit "Copy flat f32, i32 and u32 arrays as bytes in pack and readInto (#648)").                                                                                                                                                                                                       |
| Proposal review             | No pull request is assigned. This draft is not yet pushed as a pull request.                                                                                                                                                                                                                                                                         |
| Revision authority          | Git records the revisions of this file. A review and a merge record the decision. Acceptance is not yet recorded.                                                                                                                                                                                                                                    |

## What changes

**Before, at `96dbaa9f`.** A kernel function may already declare an unsized parameter of element `vec4`. The spelling `vec4f` is the same type (`src/compiler/ts/type-map.ts`, line 103). The probe below was run on 2026-10-13 with bun 1.4.2 on the CPU tier, and on the lowering of `hostFace`. It used this source:

```ts
"use typeshade";

export function copy4(out: array<vec4f>, a: array<vec4f>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i];
  }
}
```

Observed results:

1. The host value is a `Float32Array` that holds the components one after another. Rule 8.21 and the table of surface §65 say so. A `Float32Array` of 8 numbers gives 2 elements.
2. `out.length` counts vectors. The loop above copied all 8 numbers in 2 iterations.
3. A `Resident<Float32Array>` is accepted in place of the typed array. The same `Resident` was also accepted by an `array<f32>` kernel in a later call.
4. The WebGPU lowering binds `var<storage, read_write> out: array<vec4<f32>>`, and the loop body is `out[i] = a[i]`. The element layout has a stride of 16 bytes.
5. A length that is not a multiple of 4 is a `TypeError` before any loop runs: `copy4(): parameter "out" (array<vec4>): got 6 numbers, which is not a whole number of 4-component elements.`
6. A fused scratch array holds a scalar only. `scope.scratch()` takes `'f32'`, `'i32'` or `'u32'` (`src/core/fuse-plan.ts`, lines 109 to 111). The check at line 438 of `src/core/fuse-entry.ts` refuses a local of any other element (`an array of … cannot be held as a local`). Change 0058 (decision 4) and surface §71 defer a vector element.

Not observed: the WebGPU tier on a device, and a fused chain of `array<vec4f>` parameters. This verification pass ran neither.

**After.** One addition, and one clarification.

1. **Scratch.** `scope.scratch(length, 'vec4f')` makes a `Resident<Float32Array>` that holds `length` vectors, so `4 × length` numbers. The planner contracts it to a `var` local of type `vec4<f32>` when Rule 11.13 allows it for a scalar scratch array today. The check at line 438 of `src/core/fuse-entry.ts` accepts a `vec4f` element and refuses every other non-scalar element with the same text. A call that takes the scratch array passes it where it takes an `array<vec4f>`. A parameter of another element is refused, as `scratch(…, 'i32')` is refused today for an `array<f32>` (`src/core/fuse-plan.ts`, line 293).
2. **Clarification.** Rule 8.23 gains one sentence: the `.length` of an unsized array counts elements, so an `array<vec4f>` counts vectors. This is the observed behavior (result 2). The rule does not say it today.

**Tiers.** A scratch array with the element `'vec4f'` follows a scalar scratch array. On WebGPU a group that holds it as a local binds no buffer for it. Otherwise the plan makes a zeroed device buffer of `16 × length` bytes. On the CPU tier a call that needs the elements gets a zeroed `Float32Array` of `4 × length` numbers. On WebGL2 a loop over a `vec4f` array is not a loop Rule 11.8 accepts, since its elements are 4 bytes. The call falls to the CPU tier by the order of `configure`, as Rule 11.8 states for a function that the GPU tiers refuse. The probe did not run this fall.

**Excluded.** This proposal does not add:

- a view over part of an array, or an offset (whole arrays only);
- vector elements other than `vec4f` in a scratch array (`vec2f`, `vec3f`, integer vectors) and struct elements;
- an implicit reinterpretation of an `array<f32>` as an `array<vec4f>`. The author writes the element type in the parameter, which is what the draft meant and what the language does today;
- a change to the host value or to the `TypeError` of result 5.

## Why

The owner's gap analysis states that TypeNN's copies and maps move one scalar per access, and that no vector view exists. The probe shows that a vector parameter exists. A kernel function that declares `array<vec4f>` moves four numbers in one load and one store. The measured bandwidth is not in this record. Before acceptance, the record must hold the measured numbers (see Acceptance).

What stays missing is the fused scratch array. A chain of vector maps that passes its intermediate through a scratch array of scalars cannot use vectors for it. A `vec4f` scratch array lets the chain keep the intermediate as a local.

Alternatives, and why each is not chosen:

- **A new builtin, such as `load4(a, i)`.** `load4` is not a WGSL name. Rule 13.6 admits a name only from WGSL or ECMAScript. The element type in the parameter is WGSL's own spelling.
- **`scope.scratch(length, 'vec4')`.** `vec4` is the short spelling of this language, and `vec4f` is WGSL's predeclared alias. The other element names (`'f32'`, `'i32'`, `'u32'`) are WGSL type names. `'vec4f'` follows them (decision D6).
- **A host value of an array of tuples.** Rule 8.23 gives an unsized array the caller's storage. A tuple array would copy it.
- **Leave the scratch element scalar and let the author write `4 * i + c`.** This keeps four scalar accesses, and the group needs the index to be exactly `i` (Rule 11.13, F3).

Assumptions:

- The fuse rule F4 ("one array has one type in a group") applies unchanged. The same resident cannot be read as `f32` in one call and as `vec4f` in another call of one group. Result 3 shows that it can in separate calls.
- A storage buffer of 16-byte elements is valid for `vec4f`, with a size that is a multiple of 16 bytes. The scratch buffer size is `16 × length`.

## What it touches

- **Rule 8.23:** one sentence: the `.length` of an unsized array counts elements, an `array<vec4f>` counting vectors.
- **Rule 11.13:** scratch arrays and contraction accept the element `vec4f`. F4 applies to the element type. The report's counts are unchanged.
- **Surface §65:** one sentence at the table row `array<vecN>`: `.length` counts vectors.
- **Surface §71:** `scratch(length, 'vec4f')`, the contraction of a `vec4f` scratch array, and the refusal text for an element other than `'f32'`, `'i32'`, `'u32'` or `'vec4f'`. The "Not yet" paragraph keeps `vec2f`, `vec3f` and a struct element as later changes.
- **`FuseScope`:** the `scratch` overload with the element `'vec4f'`. This reshapes an export listed in `src/__api__/surface.md`, which `bun run bake:api-surface` bakes again.
- **Codes:** none.
- **Examples:** none in v1. The journey covers the fused chain (decision D5).
- **Code:** `src/core/fuse-plan.ts` (`SCRATCH`, `ScratchState`, the overloads of `scratch`), `src/core/fuse-entry.ts` (line 438), and `src/core/fuse-group.ts` if the group reads the element.
- **Documents:** `CHANGELOG.md` gains an entry. `reqs/` follows the edits of Rule 8.23 and Rule 11.13 and of surface §65 and §71, through `bun run reqs:sync` and `python scripts/doorstop-check.py -C`.

### Draft impact estimate

- **Technical work.** The scratch state accepts the element `'vec4f'`: the zeroed host array, the length check in `measure`, and the buffer size. The entry builder contracts a `vec4f` slot to a local.
- **Compatibility.** Every existing scratch array and kernel keeps its WGSL and its results. The only new form is the element `'vec4f'`.
- **Dependencies.** None.
- **Validation work.** See the test list below. The bandwidth measurement needs a GPU.
- **Downstream effort.** The site retranslates one API entry. The editor adds a sentence to two files. TypeNN is a consumer, not a registered downstream repository (`scripts/changes.ts`, `DOWNSTREAM_REPOS`).
- **Unestimated.** Effort, schedule and cost are unknown. None is recorded here.

### Decisions

**Closed by the probe of 2026-10-13.**

- **D1.** `.length` of an `array<vec4f>` counts vectors. This is the behavior at `96dbaa9f` (result 2), and it matches WGSL's `arrayLength` on `array<vec4f>`. The proposal writes it into Rule 8.23. No owner decision remains.
- **D2.** The host value is a `Float32Array` of `4 × n` numbers, or a `Resident` of it (Rule 8.21, results 1 and 3). Nothing changes.
- **D4.** The current behavior of `array<vec4f>` in kernel functions is recorded in "Before". The first implementation commit adds the tests that pin it (results 1, 2, 3 and 5).

**Taken by default.** Each is a naming or consistency choice. A reviewer may overturn one at acceptance.

- **D3.** WebGL2 does not run a `vec4f` loop. The CPU tier runs it. A later proposal may read RGBA32F texels.
- **D5.** No example in v1. An example changes the set of `examples/*.shade.ts`, a visible change.
- **D6.** The element is spelled `'vec4f'`, not `'vec4'` (see "Why").
- **D7.** The error of a length that is not a multiple of 4 stays a `TypeError`, with its text. The draft proposed a `RangeError`. Rule 8.21 refuses a value that does not fit with a `TypeError`, and a second class for one mistake would split it.

### Approval and plan record

This record does not yet apply. Acceptance requires: the owner's go-ahead or an approving review of this file; the owner's confirmation of the narrowed scope (the scratch array and the sentence of Rule 8.23); and the measured bandwidth in Acceptance. The file becomes `accepted` by a merged pull request.

### Configuration and validation record

This record does not yet apply. Implementation requires the accepted revision of this file, commits with `Change: 0068`, the delivered configuration and the validation below.

**Validation (required before the implementation merges).**

- `compile()` and the language service on `copy4`: no diagnostic, on both halves. `getHover` on `a.length` shows `u32` (CLAUDE.md "A test reads both halves").
- Host call: a `Float32Array` of length `4n` gives the expected result. A length that is not a multiple of 4 gives the `TypeError` of result 5, before the loop runs.
- CPU oracle: `copy4` and the `f32` copy of the same data give equal bits.
- `src/core/fuse-entry.test.ts` (the test at line 836 refuses a `vec2<f32>` local): a `vec4f` scratch array of a fused chain is a local of type `vec4<f32>`, and the group contracts it. A `vec2f` element is still refused with the same text.
- `src/fuse.test.ts`: a chain of two `array<vec4f>` maps with a `vec4f` scratch array reports one fused group. A scratch array of the wrong element for a parameter is refused with the text of line 293 of `src/core/fuse-plan.ts`.
- WebGL2: a `vec4f` loop falls to the CPU tier, and the report says so.
- `bun run build`, `bun run test`, `bun run gate:compile`, `bun run docs:refs`, `bun scripts/changes.ts`, `bun run docs:impact`.
- Hardware bandwidth: a copy of 2^24 floats, as an `f32` kernel and as an `array<vec4f>` kernel, each run at least five times on one named WebGPU device. Record the device, driver, date, median time and GB/s for each.

**Acceptance.** For `n` floats, the `vec4f` copy runs `n / 4` iterations, each with one vector load and one vector store. The `f32` copy runs `n` iterations. A fused chain with a `vec4f` scratch array contracts it. The bandwidth of both copies is recorded on hardware.

## What it owes downstream

- `typeshade.github.io`, facts read at `0c56a88`. The site has no page that copies §65 or §71. The English API entry for `FuseScope` is generated from the JSDoc. The Korean entry `content/api/ko/fusescope.json` is a hand translation keyed by a hash of the English source, and `content/api/ko/fuse.json` repeats the scratch paragraph. `bun run check:api-ko` names each entry whose source changed, and each is translated again. Record 0068 in `compiler-changes.md` when the pin moves.
- `vscode-typeshade`, facts read at `bbb2d9e`. The scratch paragraph of `references/host.md` (line 257) and the scratch passage of `SKILL.md` (line 383) gain the element `'vec4f'`. The language service lives in this repository, and its hover text for an `array<vec4>` parameter does not change. Record 0068 in `compiler-changes.md` when the pin moves.
- Consumer note (not a downstream repository in the schema): TypeNN adopts `array<vec4f>` for its copies and maps now, and the `vec4f` scratch array after the implementation lands. That work is not part of this proposal's obligations.
