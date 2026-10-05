---
id: '0046'
title: 'On GLSL ES 3.00, a storage struct array with an integer field is an R32UI data texture, so its `u32` lanes are exact, and `reflect()` names the format a host gives it'
status: draft
rules: []
surface: []
exports:
  - BindEntry
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The API reference's BindEntry page shows the new field from its JSDoc with no change of its own; the Korean guide pages that check:guide lists when AUTHORING.md's Storage buffers paragraph changes; compiler-changes.md records 0046 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names a field and tests that do not exist yet, and files in a downstream repository -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0046`, `status: draft`. The front matter is the lifecycle authority.                                                                                                                                                                                                                                                                                                               |
| Date and attribution          | Written 2026-10-05, Asia/Seoul. The date is the authoring context, not an approval. Drafted by the repository's coding agent at the owner's direction ("make it an issue and handle it"; the owner then approved handling part 2 through a proposal), from issue [#484](https://github.com/typeshade/typeshade/issues/484), part 2.                                                                 |
| Applicability / Effectivity   | The GLSL ES 3.00 storage emulation (`lowerStorageToDataTexture` in `src/core/backends/glsl.ts`); the WebGL2 kernel tier's upload (`src/core/host-kernel-gl.ts`); `createComputeRunner`'s upload (`src/core/compute/runner.ts`); `reflect()` (`src/core/reflect.ts`, `BindEntry`); `AUTHORING.md` (Storage buffers) and the `storageBuffer` JSDoc. WGSL is not affected. Release version unassigned. |
| Review baseline               | `origin/main` at `2b4f3a98f626a4e4c63bd29cfecd90f7ef017592`.                                                                                                                                                                                                                                                                                                                                        |
| Review and revision authority | [PR #486](https://github.com/typeshade/typeshade/pull/486). Git records revisions; the pull request's review and merge record the decision.                                                                                                                                                                                                                                                         |

## What changes

A storage binding whose element is a struct is a data texture on GLSL ES 3.00. Today that
texture is always R32F (`sampler2D`), and a `u32` field is read as
`floatBitsToUint(_sfetch(...))`. After this change:

| Element                                     | Before                                   | After                                                                      |
| ------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------- |
| struct of `f32` and `vecN<f32>` fields only | R32F, `_sfetch`                          | unchanged: R32F, `_sfetch`, the same emitted text                          |
| struct with one or more `u32` fields        | R32F; a `u32` lane via `floatBitsToUint` | R32UI, `_sfetchU`; a `u32` lane as is, an `f32` lane via `uintBitsToFloat` |
| struct with an `i32` field                  | refused at emit                          | R32UI; an `i32` lane via `int(...)`, which keeps the bits                  |

`BindEntry` gains one optional field, `glslDataTexture`, on a `storage-buffer` entry:
`'r32f' | 'r32ui' | 'r32i'`. It names the internal format the host gives the data texture on
GLSL ES 3.00, for every storage shape the emulation reads: a scalar or vector array and a struct
array. A host reads it instead of deriving the format from the element type.

The WebGL2 kernel tier and `createComputeRunner` upload a struct array with an integer field as
`Uint32Array` lanes into R32UI. `AUTHORING.md` (Storage buffers) and the `storageBuffer` JSDoc
state the rule and point to the field.

**Exclusions.** A struct with a `vecN<u32>`, `vecN<i32>` or matrix field stays refused on access,
as today. WGSL does not change. An `f32` lane read through `uintBitsToFloat` keeps GLSL ES 3.00's
own freedom to flush a subnormal result (§2.1.1); that freedom exists on the R32F route too.

## Why

GLSL ES 3.00 §2.1.1 lets a driver flush any denormal, and a small integer is a subnormal `f32`
bit pattern (`1u` is 1.4e-45). The compiler already refuses that route for `array<u32>` and
reads it from R32UI (X-GIS #1703). The comment in `lowerStorageToDataTexture` names the struct
lane as the one place left: "the struct-FIELD u32 lane further down still bitcasts through R32F".

Measured on 2026-10-05 (#479, proposal 0045): SwiftShader's WebGL2 kept the subnormal words
`0x00000001`, `0x007fffff` and `0x80000001` through R32F and `floatBitsToUint`. So the loss was
not observed. A hardware driver was not measured. The defect is what the specification allows,
not an observed wrong answer.

### Why a reflect field

The texture format is a contract the emitted source cannot state: a texture whose format does
not match its sampler is incomplete, raises nothing, and reads zero. Today a host derives the
format from the element type by a rule written in prose. This change makes the rule depend on
the struct's fields, so a host that keeps the old rule (R32F for every struct) would read zeros
with no error. A field in `reflect()` lets a host stop encoding the rule at all.

### Alternatives considered

- **Every struct array becomes R32UI.** One rule for all structs, but the emitted text and the
  host format change for every existing struct array, including the ones with no integer field.
- **Keep R32F and document the risk.** No contract change, but a known-unsafe route stays in
  the emitter, beside the R32UI route the same file chose for `array<u32>`.
- **Two textures for one binding (R32F and R32UI).** Each lane exact in its own format, but one
  binding becomes two texture units, and the host binds both.
- **R32UI only for a struct with an integer field, plus `glslDataTexture` (proposed).** Only the
  structs that carry an integer lane change, and the host has a field to read.

### Unresolved decisions

- The field's name and values. `glslDataTexture: 'r32f' | 'r32ui' | 'r32i'` is proposed. WebGL's
  constant names (`R32F`) are another spelling.
- Whether an `i32` struct field becomes readable in this change (proposed) or stays refused.

## What it touches

- `exports: [BindEntry]`. One optional field is added. No export is removed.
- `surface: []`, `rules: []`, `codes: []`, `examples: []`. No surface section, rule, code or
  example names the struct emulation's texture format. The refusal text of an `i32` struct
  field changes if the second decision is taken; it is a thrown `UnsupportedFeatureError`
  (`SD0030`), not a numbered diagnostic of its own.

Required functional evidence:

- `src/core/backends/glsl.test.ts`: a struct of `f32` fields emits the same text as before; a
  struct with a `u32` field emits `usampler2D`, `_sfetchU` and `uintBitsToFloat` for its `f32`
  lanes, and no `floatBitsToUint`.
- A reflect test: `glslDataTexture` on each storage shape.
- A run on WebGL2 (SwiftShader) of a struct array with small integers in its `u32` field,
  through the kernel tier or `createComputeRunner`, compared with the oracle.
- The emit goldens and `bun run gate:compile` pass unchanged for the examples, none of which
  has a struct array with an integer field (to be confirmed by the implementation).

### Draft impact estimate

Known work: the struct branch of `lowerStorageToDataTexture`, the two uploaders, one field in
`reflect()`, two documents, the tests. Duration and cost are not estimated. The change is
breaking for a host outside this repository that allocates R32F for a struct array with an
integer field; how many such hosts exist is unknown.

### Approval and plan record

This record does not yet apply. Acceptance requires: the owner's decisions on the two
unresolved decisions above, recorded in this file; the actual decision and its pull request
reference; and the approved revision of this file. No responsibility, milestone, duration or
cost is assigned by this draft.

### Configuration and validation record

This record does not yet apply. Delivery requires: the implementing commits with `Change: 0046`;
the tests above and the gates green on the delivered revision; `bun run bake:api-surface` for the
new field; `bun run docs:impact` and `docs:refs` clean; and, separately, the site's pin pull
request with `0046` recorded in its `compiler-changes.md`.

## What it owes downstream

- **typeshade.github.io.** The API reference's `BindEntry` page shows the new field from its
  JSDoc when the pin moves. `bun run check:guide` lists the Korean guide pages that the
  changed Storage buffers paragraph leaves stale. `compiler-changes.md` records `0046`.
- **vscode-typeshade.** Nothing. Searched for `R32F`, `R32UI` and `textureElem` on 2026-10-05:
  the only hit is `canvas-plan.test.ts`, which names `textureElem` for a sampled texture, and
  that entry does not change.

Each item is expected work. None is started, and each follows the pin that carries the
implementation.
