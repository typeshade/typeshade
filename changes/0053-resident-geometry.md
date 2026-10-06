---
id: '0053'
title: "A draw's `indices` and `vertices` take a `Resident`, uploaded once and bound as it is on every draw after"
status: implemented
rules: []
surface:
  - 69
exports:
  - Geometry
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The API reference's Geometry page reads the new JSDoc from the pinned source with no hand edit; compiler-changes.md records 0053 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's host reference (plugins/typeshade/skills/typeshade/references/host.md) says a draw's indices and vertices take a Resident; compiler-changes.md records 0053 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names tests that do not exist yet, and files in downstream repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Change proposal `0053`, `status: implemented`. The front matter is the lifecycle authority. `0053` is the next number after `0052` (pull request #502).                                                                                                                                                                  |
| Date and attribution          | Written 2026-10-06, Asia/Seoul. The date is the authoring context, not an approval. Drafted by the repository's coding agent at the owner's direction ("승인", for the order #467, #468, #391, #408), from part 1 of issue [#391](https://github.com/typeshade/typeshade/issues/391), which typeshade/stepinside raised. |
| Applicability / Effectivity   | The program runtime: `src/runtime/program.ts` (`Geometry`, the draw's vertex and index buffers). `src/core/resident.ts` reads the handle's state and does not change its API. Surface §69. The call layer, its WebGL2 tier, the CPU tier, the oracle and the compiler do not change. Release version unassigned.         |
| Review baseline               | `origin/main` at `bfb6eee5` (the merge of PR #501).                                                                                                                                                                                                                                                                      |
| Review and revision authority | [PR #503](https://github.com/typeshade/typeshade/pull/503). Git records revisions; the pull request's review and merge record the decision.                                                                                                                                                                              |

## What changes

A draw's `indices` and `vertices` take a `Resident` that holds a typed array. The first draw
uploads it. Each draw after binds the same device buffer, until `write()` changes the host copy.

```ts
const indices = resident(meshIndices); // a Uint32Array
const cells = resident(meshVertices); // a Float32Array, laid out as the vertex entry reads it
pass.draw(mesh, { view }, { count: meshIndices.length, indices, vertices: cells });
```

| `Geometry` field | Before                                                                         | After                                                                        |
| ---------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `indices`        | `Uint16Array` or `Uint32Array`, uploaded at each draw; or `{ buffer, format }` | the same, or a `Resident` of a `Uint32Array`, format `uint32`, uploaded once |
| `vertices`       | a typed array, uploaded at each draw; or the host's `GPUBuffer`                | the same, or a `Resident` of a typed array, uploaded once                    |

Today a `Resident` passed as `indices` is not uploaded: `#upload` in `src/runtime/program.ts`
takes anything that is not a typed array as the host's `GPUBuffer`, and binds the handle object
as a buffer. Inference, not measured: WebGPU then refuses the object at `setIndexBuffer`, far
from the draw call that passed it.

The device buffer is the one a storage binding of the same `Resident` uses. `storageBuffer` in
`src/core/host-entry.ts` already gives it `VERTEX` and `INDEX` usage (change 0025), so one
`Resident` can be the index buffer of a draw and a storage array a vertex entry pulls from.

A `Resident` of any other value (a number, an array, an object, a `Float64Array`) as `indices` or
`vertices` is a `TypeError` at the draw that names the field and what it holds.

**Exclusions.** A `Uint16Array` index buffer stays a typed array or the host's buffer: `resident()`
does not take a `Uint16Array`, and this change does not widen it. Mip levels for a texture
(part 2 of #391) are draft proposal `0050`, `generateMipmaps()`, and are not repeated here.

## Why

typeshade/stepinside draws a photo as a mesh of about two million triangles. Its index buffer
and its two per-vertex storage arrays come from `rt.device.createBuffer()` and
`device.queue.writeBuffer()`, so the host keeps a second set of WebGPU objects beside the runtime
(#391). A typed array as `indices` is uploaded again on every draw. A `Resident` serves the
storage bindings already, but not the index buffer.

Measured on `main` at `bfb6eee5` (2026-10-06): `Geometry.indices` is typed
`Uint16Array | Uint32Array | { buffer, format }`, and `#upload` returns any value that is not a
typed array as it is.

### Alternatives considered

- **`rt.buffer({ data } | { size }, usage)`**, the first option of #391. It gives the host a raw
  buffer API, and the host then manages usage flags and uploads, which the runtime hides
  elsewhere. A `Resident` already holds a host copy, uploads on first use and reads back.
- **A `Resident` (proposed).** One handle for a storage binding, a vertex buffer and an index
  buffer, with the upload rule surface §65 already gives.

### Decisions at acceptance

- `indices` takes a `Resident` of a `Uint32Array` only. A `Uint16Array` index buffer stays a
  typed array or the host's buffer.
- `vertices` takes a `Resident` of a `Float32Array`, `Int32Array` or `Uint32Array`, read as raw
  bytes in the manifest's vertex layout.

## What it touches

- `exports: [Geometry]`. Its `indices` and `vertices` field types gain `Resident`. No export is
  removed.
- `surface: [69]`. The draw paragraph says a `Resident` is accepted and uploaded once.
- `rules: []`, `codes: []`, `examples: []`. No rule, code or example names the draw's buffers.

Required functional evidence, from the tests #391 lists:

- `src/runtime/runtime.test.ts`: a draw whose `indices` is a `Resident` records one upload over
  two frames and binds the same buffer; the same for `vertices`; a `write()` between the frames
  records a second upload; a `Resident` of an object as `indices` is a `TypeError` naming the
  field.
- One `Resident` used as `indices` of a draw and as a storage binding of the same draw binds one
  device buffer.

### Draft impact estimate

Known work: the two field types and the resident branch in the draw's buffer code, the surface
paragraph, the JSDoc, the tests. Duration and cost are not estimated. The change is additive: a
draw that works today works the same.

### Approval and plan record

The approval is the owner's go-ahead in conversation on 2026-10-06, Asia/Seoul ("세 PR 모두
(추천안대로)"), which accepted the two decisions above as proposed. The merge of
[PR #503](https://github.com/typeshade/typeshade/pull/503) records it; Git holds the merge commit.
The approved revision is this file at that merge. Responsibilities, milestones, duration and
cost were not assigned.

### Configuration and validation record

**Implementation.** The pull request that carries this record, with `Change: 0053`, by the
repository's coding agent at the owner's direction. Git holds the merge commit. Delivered:
`Geometry.indices` and `Geometry.vertices` take a `Resident`, and `RenderPipelineImpl` binds its
device buffer through `bufferFor` (`src/runtime/program.ts`); surface §69; the CHANGELOG.

**Functional validation**, 2026-10-06, the session's Linux container, bun 1.3.14, node 22.22.0:
`src/runtime/runtime.test.ts`, 150 passed. Its new cases: a `Resident` as `indices` and as
`vertices` makes no buffer and writes nothing on the second frame, and writes again after
`write()`; one `Resident` as `indices` and as a binding makes one device buffer; a `Resident` of a
`Float32Array` as `indices` and of an array as `vertices` is each a `TypeError` naming the field.
The compile gate and the journeys were not run locally; CI runs them.

**Document validation**, the same date: `bun run bake:api-surface` (one line, `Geometry`),
`bun run docs:impact` (no item to fix), `bun run docs:refs` (0 dead references),
`bun run reqs:sync` and `doorstop -C` (no warning).

**Deviations.** None from the approved text.

## What it owes downstream

- **typeshade.github.io.** The API reference's `Geometry` page reads the new JSDoc. A search on
  2026-10-06 found no guide page that restates the draw's `indices`. `compiler-changes.md`
  records `0053`.
- **vscode-typeshade.** `plugins/typeshade/skills/typeshade/references/host.md` says a draw's
  `indices` and `vertices` take a `Resident`. `compiler-changes.md` records `0053`.

Each item is expected work. None is started, and each follows the pin that carries the
implementation.
