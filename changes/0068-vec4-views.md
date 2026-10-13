---
id: '0068'
title: 'A kernel function reads and writes four consecutive f32 as one vec4f element, and a fused chain holds vec4f scratch arrays'
status: draft
rules:
- '8.21'
- '8.23'
- '11.8'
- '11.13'
surface:
- 64
- 65
- 71
exports:
- FuseScope
exports-removed: []
codes: []
examples: []
downstream:
- repo: typeshade.github.io
  what: The kernel-function copy (§65) and its host-call copy (§64), the fuse copy (§71), and the API reference entry for FuseScope, in English and Korean. Shows the vec4f view and the Float32Array host value.
- repo: vscode-typeshade
  what: The skill's kernel-function and fuse sections, references/host.md (host value of array<vec4>, the RangeError, scratch('vec4f')), and the hover and completion text the language service shows for an array<vec4> parameter.
---

<!-- doc-refs: skip-file — this proposal names the files, the tests and the element spelling that the implementation adds, which this tree does not have yet -->

**Document control**

| Field                       | Record                                                                                                                                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document                    | Proposal 0068; this file is the proposal source.                                                                                                                                                                                                           |
| Revision context            | Drafted 2026-10-13, Asia/Seoul. This date is the authoring context. It is not an approval date.                                                                                                                                                            |
| Request source              | The repository owner, Seungup, asked in the project conversation for vector access over scalar arrays in kernel functions and fusion. It follows a gap analysis of TypeNN training profiles. No GitHub issue is recorded for this draft.                   |
| Current lifecycle state     | `draft`. No approval has been given. No implementation exists.                                                                                                                                                                                             |
| Applicability / effectivity | Kernel functions (Rule 8.22, surface §65), their host values (Rule 8.21, surface §64), the WebGPU and CPU tiers of Rule 11.8, the fuse planner and scratch arrays (Rule 11.13, surface §71), and downstream documentation. No release version is assigned. |
| Review baseline             | `origin/main` at `96dbaa9fa7208aa786a4937a8c90521e59023ffa` (commit "Copy flat f32, i32 and u32 arrays as bytes in pack and readInto (#648)").                                                                                                             |
| Proposal review             | No pull request is assigned. This draft is not yet pushed as a pull request.                                                                                                                                                                               |
| Revision authority          | Git records the revisions of this file. A review and a merge record the decision. Acceptance is not yet recorded.                                                                                                                                          |

## What changes

**Before.** A kernel function that reads four floats per iteration reads four `f32` elements. Each element is one scalar load in WGSL. Rule 8.23 gives an unsized parameter the caller's storage, but no rule says what host value an unsized `array<vec4>` takes. A fused scratch array holds a scalar only. `scope.scratch()` in `src/core/fuse-plan.ts` takes `'f32'`, `'i32'` or `'u32'`. The check at line 438 of `src/core/fuse-entry.ts` refuses a local of any other element (`an array of … cannot be held as a local`). Surface §71 and change 0058 (decision 4) defer a vector element.

**After.** Three additions. Each is explicit in the source or the call. None rewrites an array silently.

1. **Parameter.** A kernel function may declare an unsized parameter of element `vec4f`, written as `array<vec4f>` or `array<vec4>`:

```ts
"use typeshade";

export function copy4(out: array<vec4f>, a: array<vec4f>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i];
  }
}
```

The host value is the same bytes as a `Float32Array` of length `4 × n`. Element `i` is the four floats at `4i` to `4i + 3`. The caller passes the array by reference, as Rule 8.23 says. No copy is made. `out.length` is `n`, the count of `vec4f` elements (open decision D1).

2. **Host check.** A host call of such a kernel with a `Float32Array` (or a `Resident<Float32Array>`) whose length is not a multiple of 4 throws a `RangeError` before any loop runs. The message names the parameter and the length. A host value of another type is refused as today.

3. **Fused scratch and contraction.** `scope.scratch(length, 'vec4f')` makes a `Resident<Float32Array>` of `4 × length` floats. The planner contracts it to a `var` local of type `vec4f` when the rules of Rule 11.13 allow it today for a scalar. The check at line 438 of `src/core/fuse-entry.ts` accepts a `vec4f` element and refuses every other non-scalar element with the same text.

**Tiers.** On WebGPU the parameter is bound as `array<vec4<f32>>`, one storage binding for each array. On the CPU tier the same loop runs per element, in the oracle's order, with the same float operations on each component (the lanes of one `vec4f` are not reordered). On WebGL2 a loop that touches a `vec4f` array is not one of the loops Rule 11.8 accepts (its elements are 4 bytes). The call falls to the CPU tier by the order of `configure`, as Rule 11.8 already states for a function that the GPU tiers refuse.

**Excluded.** This proposal does not add:

- a view over part of an array, or an offset (whole arrays only);
- vector elements other than `vec4f` (`vec2f`, `vec3f`, integer vectors) and struct elements;
- an implicit reinterpretation of an `array<f32>` as `array<vec4f>`. The author writes the element type in the parameter.

## Why

A copy or a per-element map over `f32` makes one scalar access for each element. An `array<vec4f>` lets one load and one store move four floats. The owner's gap analysis states that TypeNN's copies and maps move one scalar per access, and that no vector view exists. The measured bandwidth is not in this record. Before acceptance, the record must hold the measured numbers (see Acceptance).

Alternatives, and why each is not chosen:

- **Explicit builtins, such as `load4(a, i)` and `store4(a, i, v)`.** `load4` is not a WGSL name. Rule 13.6 admits a name only from WGSL or ECMAScript. A new name needs a row of §9.3 and a reason. The element type in the parameter is WGSL's own spelling, so it needs no new name.
- **A host value of an array of tuples.** Rule 8.21 gives an `array<T, N>` an array of host values, but Rule 8.23 gives an unsized array the caller's storage. An array of tuples would copy the storage, which Rule 8.23 forbids.
- **Leave the element scalar and let the author write `4 * i + c`.** This keeps four scalar accesses and the same index arithmetic. It does not change the work the GPU does per element.
- **A `bitcast` of an `f32` array to `vec4f` in the body.** WGSL has no bitcast of a runtime-sized array, and a bitcast does not change the access width.

Assumptions:

- A GPU storage buffer of 16-byte elements is valid for `vec4f`, with the buffer size a multiple of 16 bytes. WebGPU's storage alignment rules apply, and the implementation records their check in its validation.
- The fuse rule F4 ("one array has one type in a group") applies unchanged. The same resident cannot be read as `f32` in one call and as `vec4f` in another call of one group.

## What it touches

- **Rule 8.21:** the host value of an unsized `array<vec4f>` is a `Float32Array` of length `4 × n`, passed by reference, with the `RangeError` of "What changes" 2.
- **Rule 8.23:** an unsized parameter may have element `vec4f`; the caller's storage is then `4 × n` floats; the body's `.length` counts vectors.
- **Rule 11.8:** the WebGL2 condition (4-byte elements) is stated as is; a loop over `vec4f` is not on WebGL2 in v1, and it falls to the CPU tier. The WebGPU tier lowers the parameter as `array<vec4<f32>>`.
- **Rule 11.13:** scratch arrays and contraction accept `vec4f` elements; F4 applies to the element type; the report's counts are unchanged.
- **Surface §64:** the host value of an array of `vec4f` and the `RangeError`.
- **Surface §65:** the parameter form, the `.length` meaning and the loop's element access.
- **Surface §71:** `scratch(length, 'vec4f')` and the contraction of a `vec4f` scratch array.
- **`FuseScope`:** the `scratch` overload with the element `'vec4f'`. This reshapes an export listed in `src/__api__/surface.md`.
- **Codes:** none. The `RangeError` is a runtime error, not a compile diagnostic. A refused `vec4f` element on a non-kernel parameter keeps the diagnostic it has today.
- **Examples:** none in v1. The journey covers the copy and the fused chain (open decision D5).

### Draft impact estimate

- **Technical work.** The front end accepts the element `vec4f` in an unsized kernel parameter. The lowering (`lowerKernel`) writes the element access as one `vec4<f32>` load and store. The fuse planner accepts `vec4f` scratch arrays. The host call checks the length and the host value.
- **Compatibility.** Existing kernels with `f32` elements keep their WGSL and their results. Only the new forms are added.
- **Dependencies.** None.
- **Validation work.** See the test list below. The bandwidth measurement needs a GPU.
- **Downstream effort.** The site and the editor describe the form. TypeNN is a consumer, not a registered downstream repository (`scripts/changes.ts`, `DOWNSTREAM_REPOS`).
- **Unestimated.** Effort, schedule and cost are unknown. None is recorded here.

### Open decisions (must be settled before acceptance)

- **D1.** Does `.length` of `array<vec4f>` count vectors or floats? Recommendation: vectors, which matches WGSL's `arrayLength` on `array<vec4f>`.
- **D2.** Is the host value a `Float32Array` of `4 × n` floats? Recommendation: yes. Rule 8.23 keeps the caller's storage, and the typed array is the storage's own type.
- **D3.** Does WebGL2 run a `vec4f` loop? Recommendation: no in v1; the CPU tier runs it. A later proposal may read RGBA32F texels.
- **D4.** Does the record fix the behavior of `array<vec4f>` in kernel functions today before implementation? The first implementation commit records the current result. This draft has not run that test.
- **D5.** Which example, if any, shows the form? Recommendation: none in v1 (an example is a visible change).

### Approval and plan record

This record does not yet apply. Acceptance requires: the owner's go-ahead or an approving review of this file; the resolved decisions D1 to D5; and the measured bandwidth in Acceptance. The file becomes `accepted` by a merged pull request.

### Configuration and validation record

This record does not yet apply. Implementation requires the accepted revision of this file, commits with `Change: 0068`, the delivered configuration and the validation below.

**Validation (required before the implementation merges).**

- `compile()` of `copy4`: the emitted WGSL has one `vec4<f32>` load and one store per iteration, in the copy's loop. The same source in the language service gives no diagnostic, and `getHover` on `a.length` shows the vector count (CLAUDE.md "A test reads both halves").
- `compile()` of a `vec4f` element on a non-kernel parameter: the diagnostic it has today, with its code and text.
- Host call: a `Float32Array` of length `4n` gives the expected result; a length that is not a multiple of 4 throws a `RangeError` before the loop runs.
- CPU oracle: `copy4` and the `f32` copy of the same data give equal bits.
- `src/core/fuse-entry.test.ts`: a `vec4f` scratch array of a fused chain is a local of type `vec4f`, and the group contracts it. A `vec4f` element in another element's place is refused with the same text.
- WebGL2: a `vec4f` loop falls to the CPU tier, and the report says so.
- `bun run build`, `bun run test`, `bun run gate:compile`, `bun run docs:refs`, `bun scripts/changes.ts`, `bun run docs:impact`.
- Hardware bandwidth: a copy of 2^24 floats, as an `f32` kernel and as an `array<vec4f>` kernel, each run at least five times on one named WebGPU device. Record the device, driver, date, median time and GB/s for each.

**Acceptance.** For `n` floats, the `vec4f` copy runs `n / 4` iterations, each with one vector load and one vector store. The `f32` copy runs `n` iterations, each with one scalar load and one scalar store. A fused chain with a `vec4f` scratch array contracts it. The bandwidth of both copies is recorded on hardware.

## What it owes downstream

- `typeshade.github.io`: the host-call copy (§64) and the kernel-function copy (§65), in English and Korean; the fuse copy (§71); the API reference entry for `FuseScope`. Record 0068 in `compiler-changes.md` when the pin moves.
- `vscode-typeshade`: the skill's kernel-function and fuse sections; `references/host.md` (the host value, the `RangeError`, `scratch('vec4f')`); the hover and completion text for `array<vec4f>` parameters. Record 0068 in `compiler-changes.md` when the pin moves.
- Consumer note (not a downstream repository in the schema): TypeNN adopts `vec4f` for its copies and maps after the implementation lands. That work is not part of this proposal's obligations.
