---
id: '0061'
title: The examples show how a host runs a `"use typeshade"` module, not only how the module is written
status: accepted
rules: []
surface: []
exports:
  - hostExamples
  - HostExample
exports-removed: []
codes: []
examples:
  - host-draw
  - host-compute
  - host-kernel
  - host-resident
  - host-helper
  - host-program
downstream:
  - repo: typeshade.github.io
    what: The examples page gains a host group that shows each host example's `.shade.ts` and its host file side by side, with a live run where the browser has WebGPU or WebGL2; each host example gets its page under /guide/examples/, in English and Korean; compiler-changes.md records 0061 when the pin moves.
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal `0061`, `status: accepted`. The front matter is the lifecycle authority. Seungup approved it in the project conversation on 2026-10-12, Asia/Seoul ("승인", approved); the merge of PR #571 is the acceptance record.                                                                                                                            |
| Date and attribution          | Written 2026-10-12, Asia/Seoul. The date is the authorship context, not an approval. Claude Code, an AI assistant, drafted it at Seungup's request in the project conversation of that day. The request: the examples are aimed at `"use typeshade"` alone and are thin; add runtime examples to the compiler's `examples/`. Attribution is not approval. |
| Applicability / effectivity   | `examples/` (new host examples, the registry), `examples/index.ts`'s export surface (`typeshade/examples`), the tests and gates that hold the examples, `README.md` (Examples). No language rule, surface section or diagnostic changes. No release version is assigned.                                                                                  |
| Review baseline               | `main` at `f144f26d1f6a8b6056dbab75b803a5e4862041fc` (#570).                                                                                                                                                                                                                                                                                              |
| Review and revision authority | [PR #571](https://github.com/typeshade/typeshade/pull/571), the proposal-only pull request. Git records revisions. Its review and merge records establish decisions.                                                                                                                                                                                      |

## What changes

### Today

`examples/` holds two corpora. The registry (`examples/index.ts`, 36 entries) is built with the IR builder. The `.shade.ts` corpus (94 files) is written in `"use typeshade"`. Each entry of either is a module: its source, its emitted WGSL and GLSL, and its reflection. No example shows the host side: how an application imports a module, binds its data, runs it, and reads the result.

The host side exists and is tested. `journeys/` holds host programs that the `gate:journeys` gate runs on the packed tarball, and the surface sections §64, §65, §67 and §69 each show a short host snippet. Neither is an example a reader finds next to the shaders. A journey host is written for the harness (`export default { title, runs }`), not as an application writes it.

### After this change

`examples/hosts/` holds host examples. Each host example is one directory with two files:

- `<id>.shade.ts`: the module, in `"use typeshade"`, with the `/* @example */` block every `.shade.ts` example has.
- `host.ts`: the host, written as an application writes it. It imports the module through the Vite plugin (§64), binds plain host values (Rule 8.21) and runs the module through `typeshade/runtime`. It exports one function, `run`, that returns the values the host reads back, so a test can hold them to a JavaScript reference.

The proposed set covers each way a host runs a module, one example for each:

| id              | What the host does                                                                                                                        | Rules and sections      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `host-draw`     | Draws a full-screen `@fragment` entry into a canvas with `entry(canvas, bindings)`, and sets a uniform each frame.                        | Rule 8.24, §67          |
| `host-compute`  | Dispatches a `@compute` entry with `entry(bindings, workgroups)` and reads the written storage array back into a `Float32Array`.          | Rule 8.24, §67          |
| `host-kernel`   | Calls a kernel function over an `array<f32>` with plain arguments; each accepted loop runs on the GPU.                                    | Rule 8.22, §65          |
| `host-resident` | Calls a chain of kernel functions over `resident()` arrays, so the data stays on the device, and reads once at the end.                   | Rule 11.8, §65          |
| `host-helper`   | Calls an exported helper on the CPU, for a value the host needs (a height under the cursor), and draws with the same function on the GPU. | §64                     |
| `host-program`  | Loads the module's manifest with `runtime()` and `rt.load()`, and renders frames with the program's pipeline, as an engine does.          | Rules 11.10, 11.11, §69 |

```ts
// examples/hosts/host-compute/host.ts
import { scale } from './host-compute.shade.ts';

export async function run(): Promise<Float32Array> {
  const xs = Float32Array.from({ length: 256 }, (_, i) => i);
  const ys = new Float32Array(256);
  await scale({ k: 2.5, xs, ys }, 4); // four workgroups of 64; ys is filled in place
  return ys;
}
```

`typeshade/examples` gains `hostExamples`, a list of `HostExample` records: the id, the title, the blurb, the text of both files, and which tiers the host runs on. The list is built from the directory, in the order of `_order.ts`, as the registry is.

### What stays as it is

- The registry and the `.shade.ts` corpus keep their entries. Proposal 0060 decides what happens to the registry's builder-made entries; this proposal does not depend on it.
- `journeys/` stays the gate that runs the packed tarball. A host example is a reader's example; a journey is a test of the package.
- A fuse example is not part of this set. Proposal 0058 owns `loop-fuse` (its step 6).

## Why

A reader who finishes a `"use typeshade"` example has a module and no way to see it run. The site's examples page shows the shader, its WGSL and its GLSL, and stops there. The questions that follow are host questions: how do I give it my data, how do I draw it, how do I read the result, does my data have to come back to the CPU between calls. The answers are in four surface sections and in a test harness. An example is where a reader looks first.

The owner asked for the examples to live in the compiler, not on the site. The site's copy follows the pinned compiler (its `CLAUDE.md`), so an example that the compiler holds and tests cannot drift from the API the way a page written by hand can.

### Alternatives

- **Host pages written on the site alone.** Faster, and no proposal. Rejected by the owner: nothing in the compiler would fail when the host API changes.
- **Present the journeys as examples.** They are tested already. Rejected: a journey host is shaped for the harness, and a reader would copy the harness, not an application.
- **One host file that runs every module.** Shorter. Rejected: each way of running a module is its own pattern, and a reader looks for the one they need.

### Assumptions

- A host example runs on the CPU tier in the unit suite, through the plugin's generated module, with no browser. The runtime's CPU tier exists for entries and kernel functions (Rule 11.7). `host-draw` and `host-program` draw and need a GPU; on the CPU tier they are checked through the CPU oracle's fragment call.
- The headless WebGPU harness the journeys use (`journeys/_harness.mjs`, SwiftShader) can load a Vite-built page. This is to be confirmed at step 1.

### Decisions

Each item was open in the draft. Seungup accepted the proposed answer of each on 2026-10-12, in the project conversation, by approving the proposal as a whole.

1. **The set.** The six ids above.
2. **The layout.** One directory per host example under `examples/hosts/`, holding the `.shade.ts` and `host.ts` together. The scanner of the `.shade.ts` corpus learns the directory, so each module is in the corpus, its goldens and its compile gate.
3. **The GPU check.** An arm of `gate:journeys` builds `examples/hosts/` with Vite and runs each `run()` on headless WebGPU, held to the same JavaScript reference as the CPU-tier unit test.

## What it touches

- **Examples** `host-draw`, `host-compute`, `host-kernel`, `host-resident`, `host-helper`, `host-program`: added, each a `.shade.ts` and a `host.ts`.
- **Exports** `hostExamples` and `HostExample` from `typeshade/examples`: the list the site and the CLI printer read.
- **Rules, surface sections, codes:** none. The examples use what §64, §65, §67 and §69 already describe.
- **`README.md`** (Examples): one paragraph on `examples/hosts/`.

Required validation:

- `shade-examples.test.ts` and `gate:compile` over each host example's `.shade.ts`, as for every `.shade.ts` example.
- A unit test per host example that calls `run()` on the CPU tier and holds the result to a JavaScript reference.
- The GPU arm of decision 3, if accepted: each `run()` on headless WebGPU, held to the same reference.
- `tsc` over each `host.ts` with the host view `tshc sync` writes, so the host file type-checks as an application's does.
- `bun run docs:impact`, `bun run docs:refs`, `bun run bake:api-surface` and `src/api-surface.test.ts` (the new exports).

### Draft impact estimate

- **Compiler:** none. No pass, backend or runtime code changes.
- **Examples:** six small modules and six host files; a registry builder for `hostExamples`; one test file. Known work.
- **Gate:** the GPU arm needs a Vite build of `examples/hosts/` inside the journeys harness. Unestimated until decision 3.
- **Compatibility:** additive. No existing export changes.
- **Dependencies:** none added. Vite is already a dev dependency.
- **Downstream:** the site's examples page and example pages (below). The editor owes nothing.
- **Effort and date:** unestimated. No milestone is set.

### Approval and plan record

Seungup approved the proposal in the project conversation on 2026-10-12, Asia/Seoul, after the draft of the same day. The approved revision is the one PR #571 merges. The approved scope is the six host examples, the `hostExamples` and `HostExample` exports, and the validation listed under "What it touches", with the decisions recorded above. A Claude Code session implements and reviews. Each implementing pull request carries `Change: 0061` and merges under the approved-in-advance rule of `CLAUDE.md` when every required check is green, with no conflict and no open thread. No milestone date and no effort estimate were set.

### Configuration and validation record

This record does not yet apply. Delivery requires the implementing pull requests with `Change: 0061`, the delivered configuration and the observed results of the validation above.

## What it owes downstream

- `typeshade.github.io`: the examples page (`src/components/pages/ExamplesPage.astro`) gains a host group that reads `hostExamples` from the pinned compiler; each host example gets a page under `/guide/examples/<id>/` that shows the module and the host file side by side and runs `host-draw` and `host-program` live where the browser has WebGPU or WebGL2; the Korean dictionary gains the blurbs; `compiler-changes.md` records 0061 when the pin moves. Expected work; the exact files are confirmed at acceptance against the site's default branch.
