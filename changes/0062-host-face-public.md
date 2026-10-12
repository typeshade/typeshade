---
id: '0062'
title: A tool that runs host code in a browser computes a module's host face with `hostFace` from `typeshade/language-service`
status: implemented
rules: []
surface:
  - 64
exports:
  - hostFace
  - HostFace
  - HostFaceOptions
  - HostExport
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The Playground's language worker imports `hostFace` from `typeshade/language-service` instead of the deep path `src/compiler/ts/host-face.ts`, to run and type-check an editable `host.ts` beside the `.shade.ts`; the API reference gains the four names; compiler-changes.md records 0062 when the pin moves.
---

<!-- doc-refs: skip-file — a proposal names exports and a site file this tree does not have yet -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal `0062`, `status: implemented` (accepted by PR #588; implemented by the pull request that carries the configuration record below). The front matter is the lifecycle authority. Seungup approved it in the project conversation on 2026-10-12, Asia/Seoul ("승인", approved); the merge of PR #588 is the acceptance record.                                                                                |
| Date and attribution          | Written 2026-10-12, Asia/Seoul. The date is the authorship context, not an approval. Claude Code, an AI assistant, drafted it at Seungup's request in the project conversation of that day: the Playground should show and run the host-side TypeScript, and the compiler function it needs should be public first, as the TypeScript Playground builds only on public TypeScript API. Attribution is not approval. |
| Applicability / effectivity   | `src/language-service/index.ts` (the `typeshade/language-service` subpath), `src/compiler/ts/host-face.ts` (the JSDoc of the exported names), `src/__api__/surface.md`, `docs/use-typeshade-surface.md` §64, `scripts/bundle-budget.json` if the subpath's budget moves. No release version is assigned.                                                                                                            |
| Review baseline               | `main` at `48e3951ff1db73f45b4e35850daabddaf125ab55` (#582).                                                                                                                                                                                                                                                                                                                                                        |
| Review and revision authority | [PR #588](https://github.com/typeshade/typeshade/pull/588), the proposal-only pull request. Git records revisions. Its review and merge records establish decisions.                                                                                                                                                                                                                                                |

## What changes

### Today

`hostFace(source, options)` (`src/compiler/ts/host-face.ts`) computes a shader module's host face: the exports a host can call (Rule 8.20), their host types (Rule 8.21), the host view `tsc` reads, and the generated module a bundler loads, which imports `typeshade/runtime/internal`. The Vite plugin (`src/vite.ts`) and `tshc sync` call it. No public subpath exports it (`src/api-subpaths.ts`).

The function needs only `typescript` and the core modules; the only Node-specific part of the plugin is the `readDocument` callback that reads from disk. So a tool in a browser could run host code the way an application runs it through the plugin, but only by importing the compiler's internal file by path. A tool that does that breaks when the file moves, and no gate tells the compiler that a downstream repository depends on it.

### After this change

`typeshade/language-service` exports `hostFace` and its types `HostFace`, `HostFaceOptions` and `HostExport`, with their current signatures. The subpath already carries the TypeScript front end the function runs on, and it is the subpath an editor or a playground already imports.

```ts
import { hostFace } from 'typeshade/language-service';

const face = hostFace(source, { fileName: 'plasma.shade.ts', readDocument: (f) => files.get(f) });
face.view; // the host view a type checker reads for `import … from './plasma.shade.ts'`
face.code; // the module a host runs; it imports `typeshade/runtime/internal`
face.diagnostics; // empty when the module compiles
```

`typeshade/runtime/internal` stays what it is: the path a generated module imports, not API for a host to import. A tool that runs a generated module maps that specifier to the package's own `typeshade/runtime/internal`, as a bundler does.

Surface §64 gains one paragraph: a tool that runs host code without Vite computes the face with `hostFace` and gives the generated module the package's `typeshade/runtime/internal`.

## Why

The owner asked for the Playground to show the host-side TypeScript beside the shader, editable and runnable, with type checking. The site's design study found that the Playground's language worker can compute the face in the browser today, by deep path. The owner chose to publish the function first, as the TypeScript Playground does: it builds on the published `typescript` API and on `@typescript/vfs`, a package the TypeScript team publishes, and imports no compiler internals by path.

### Alternatives

- **The deep path.** No proposal; the site imports `vendor/shader-dsl/src/compiler/ts/host-face.ts` and a site test fails on a pin move that breaks it. Rejected by the owner: a downstream tool should not depend on an internal file.
- **A new subpath, `typeshade/host-face`.** A smaller import for a tool that needs only the face. Not proposed: the function needs the TypeScript front end, which `typeshade/language-service` already carries, so a new subpath would carry the same code under a second name.
- **Export from `typeshade/vite`.** Rejected: that subpath imports `node:fs` and does not load in a browser.

### Assumptions

- `hostFace` does not import `node:*`. To be confirmed at implementation with `gate:boundary`, by building the subpath for the browser.
- The subpath's bundle grows by the face generator only; the front end is shared. The size is measured at implementation and recorded here.

### Decisions

Each item was open in the draft. Seungup accepted the proposed answer of each on 2026-10-12, in the project conversation, by approving the proposal as a whole.

1. **The subpath.** `typeshade/language-service`.
2. **Stability.** The four names are stable API from this change, under Rule 11.6's re-bake.

## What it touches

- **Exports** `hostFace`, `HostFace`, `HostFaceOptions`, `HostExport` from `typeshade/language-service`: re-exported with their current shapes; JSDoc on each (`api-doc-coverage.test.ts`).
- **Surface §64:** one paragraph, as above.
- **Rules, codes, examples:** none.

Required validation:

- `bun run bake:api-surface`, `src/api-surface.test.ts`, `src/api-doc-coverage.test.ts`.
- A test that imports `hostFace` from the subpath's entry and computes the face of a host example (`examples/hosts/host-compute`) with an in-memory `readDocument`, and that its `code` and `view` equal what the Vite plugin path produces for the same file.
- `gate:boundary`: the subpath builds for the browser, with no `node:*` import, within its budget.
- `bun run docs:impact`, `bun run docs:refs`.

### Draft impact estimate

- **Compiler:** a re-export and its JSDoc, one test, one surface paragraph. Known work; small.
- **Bundle:** the subpath grows by the face generator; unknown until measured.
- **Compatibility:** additive.
- **Downstream:** the site's Playground (below). The editor owes nothing; it may adopt the export later.
- **Effort and date:** unestimated. No milestone is set.

### Approval and plan record

Seungup approved the proposal in the project conversation on 2026-10-12, Asia/Seoul, after the draft of the same day. The approved revision is the one PR #588 merges. The approved scope is the re-export, its JSDoc, the test, the surface paragraph and the bundle measurement, with the decisions recorded above. A Claude Code session implements and reviews. The implementing pull request carries `Change: 0062` and merges under the approved-in-advance rule of `CLAUDE.md` when every required check is green, with no conflict and no open thread. No milestone date and no effort estimate were set.

### Configuration and validation record

**Delivered configuration.** One pull request from branch `feat/0062-host-face-export`, based on `0e48ade2` (the commit that marks this proposal accepted, PR #588); its commit carries `Change: 0062`. It delivers every item of "What it touches":

- `src/language-service/index.ts` re-exports `hostFace`, `HostFace`, `HostFaceOptions` and `HostExport` from `src/compiler/ts/host-face.ts`, with their shapes unchanged. Each definition already had a doc comment. The doc comment of `hostFace` now names the subpath, and the one of `HostFaceOptions.runtime` says that a tool that runs the generated module maps `typeshade/runtime/internal` to the package's own copy.
- `src/__api__/surface.md`, rebaked with `bun run bake:api-surface`: `./language-service` goes from 43 to 47 exports, and the shapes from 624 to 628 definitions.
- `src/language-service/host-face-export.test.ts`: `hostFace` imported from `src/language-service/index.ts` computes the face of `examples/hosts/host-compute/host-compute.shade.ts` with an in-memory `readDocument`. Its `diagnostics` are empty, and its `code` and `view` equal the code the Vite plugin's `transform` returns and the view it writes, for a copy of the same file in a temporary directory. A second case holds a module that does not compile to diagnostics with no `code` and no `view`.
- `docs/use-typeshade-surface.md` §64: one paragraph, "Without Vite".
- `src/AGENTS.md`: the `language-service/` row names `hostFace`.
- `scripts/bundle-budget.json` is unchanged: no budget covers `typeshade/language-service`, and `gate:boundary` does not check that subpath.

**Bundle measurement.** `gate:boundary` checks only `typeshade/runtime`, `typeshade/emit` and `typeshade/fuse`. So the subpath was measured with the gate's own method (its `closureOf` walk, and the entry bundled by `Bun.build` for the browser, minified, every export kept, gzip level 9), from a script outside the tree, before and after the change:

| `src/language-service/index.ts` | Before (`0e48ade2`) | After       | Growth    |
| ------------------------------- | ------------------- | ----------- | --------- |
| Modules in the closure          | 222                 | 234         | +12       |
| Gzipped, `typescript` bundled   | 1,347,159 B         | 1,376,738 B | +29,579 B |
| Gzipped, `typescript` external  | 332,371 B           | 361,662 B   | +29,291 B |

The only bare specifier of the closure is `typescript`, before and after: no `node:*` import. The bundled text names no `node:` specifier. The assumption that `hostFace` imports no `node:*` holds. The assumption that the subpath grows "by the face generator only" holds in kind: the 12 added modules are `host-face.ts` and what it reaches that the service did not, the CPU code generator, the host-value checks, the kernel lowering and the call layer (`src/core/cpu-codegen.ts`, `host-values.ts`, `host-kernel.ts`, `resident.ts` and seven more of `src/core/`), and the size it adds is about 29 KB gzipped, about 2% with TypeScript.

**Observed results**, on 2026-10-12, Bun 1.4.2, TypeScript 5.6.3, Node from the container:

- `bun run build`: passed.
- `vitest run --maxWorkers=2` (the suite of `bun run test`): 421 files, 9396 tests passed, 4 skipped, 1 todo. An earlier `bun run test` on the same change passed every file and test but exited 1 on 253 `[vitest-worker]: Timeout calling "onTaskUpdate"` errors, while other processes loaded the 4-core container; the run with two workers had none.
- `vitest run src/language-service/host-face-export.test.ts src/api-surface.test.ts src/api-doc-coverage.test.ts`: 26 passed.
- `bun run gate:boundary`: passed; `typeshade/runtime` 29,340 B, `typeshade/emit` 92,422 B and `typeshade/fuse` 73,890 B, each within its budget.
- `bun run lint`, `bun run format:check`, `bun run docs:refs` (0 dead references): passed.
- `bun run docs:impact`: no must-fix item. Each review item was read; the `language-service/` row of `src/AGENTS.md` now names `hostFace`, and every other sentence still holds.
- `bun scripts/changes.ts`: passed on the commit that carries `Change: 0062`.
- Not run: `gate:compile`, `gate:journeys`, `gate:differential` and `gate:render`. The change emits no new shader text and changes no host behaviour.

**Deviations.** None from the approved text. The bundle check of `typeshade/language-service` was made by a script outside the tree, since `gate:boundary` does not cover that subpath; adding it to the gate is not in this proposal's scope (open, no action owed).

## What it owes downstream

- `typeshade.github.io`: the Playground's language worker (`src/scripts/playground-language-worker.ts`) imports `hostFace` from `typeshade/language-service` to compute the face of the open `.shade.ts`, type-check an editable `host.ts` against its view and run it against its generated module in a sandboxed iframe; the API reference gains the four names; `compiler-changes.md` records 0062 when the pin moves. Expected work, confirmed at acceptance against the site's default branch.
