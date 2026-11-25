---
id: '0151'
title: The compiler records the GLSL name of a binding and of an override every time, so a host reads it and picks nothing
status: draft
rules:
  - '3.4'
  - '11.10'
surface:
  - 62
  - 69
exports:
  - BindEntry
  - OverrideInfo
  - PackBinding
  - PackOverride
  - Pack
exports-removed: []
codes: []
examples: []
names: []
downstream:
  - repo: typeshade.github.io
    what: The API reference pages of `BindEntry`, `OverrideInfo`, `PackBinding` and `PackOverride` (the web repository holds `apps/typeshade/content/api/ko/bindentry.json`, `packbinding.json` and `overrideinfo.json`) say that a GLSL host reads `emittedGlsl ?? emitted`, and the pages that quote surface §62 and §69 say the field is present only where it differs, and print `program.schema; // 2`. Each follows the new text. compiler-changes.md records 0151
  - repo: vscode-typeshade
    what: The skill's and the docs' text on reflection and the manifest (`emitted`, `emittedGlsl`, the schema number) follows the new text. It was not searched (see What it owes downstream). compiler-changes.md records 0151
---

<!-- doc-refs: skip-file — the proposal names src/runtime/gl-draw/glsl-name.ts, which its implementation removes -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0151, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Date and attribution          | 2026-11-25, UTC (the drafting date). A Claude Code agent drafted it from the owner's finding of the same date (below). This row is attribution, not approval.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Applicability / Effectivity   | `src/core/reflect.ts`, `src/core/manifest-types.ts`, `src/core/manifest.ts`, `src/core/gl-overrides.ts`, `src/runtime/gl-draw/`, `src/core/host-draw.ts`, `src/core/host-entry.ts`, `src/core/host-kernel-gl.ts`, `src/runtime/gl/program.ts`, `src/core/host-overrides.ts`, `src/core/host-entry-program.ts`, `src/runtime/limits.ts`, `src/random/face.ts`, `src/algorithms/face.ts`, `scripts/bare-uniform-cases.ts`, `scripts/bake-common-modules.ts`, `docs/language-design.md` Rules 3.4 and 11.10, `docs/use-typeshade-surface.md` §62 and §69. No release is assigned (OD-6). |
| Review baseline               | `origin/main` at `4ed243e08688981aef4f08f26793a16a8b81951b`. Every "today" claim below was read at that commit on 2026-11-25.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Review and revision authority | No pull request is assigned yet; the pull request that adds this file records it. Git records revisions. PR review and merge records establish decisions.                                                                                                                                                                                                                                                                                                                                                                                                                             |

**The owner's finding (2026-11-25).** The owner pointed at `glslNameOf` (`src/runtime/gl-draw/glsl-name.ts`, one line: `(b) => b.emittedGlsl ?? b.emitted`, in a file of its own): "a or b 를 택하는 함수인데도 함수형이 필요한 이유가 설명이 안돼" (it only picks a or b, and nothing explains why it must be a function with a parameter). The orchestrating session traced the cause and recommended fixing the source of the choice. This proposal is that recommendation. The owner has not yet decided on it (OD-4).

## What changes

### Facts at the baseline

- F1. The choice exists because the field is optional. `glslOnly` writes `emittedGlsl` only when the GLSL spelling differs from the WGSL one (`src/core/reflect.ts:255-262`: `return g === emittedName(wgsl, name) ? {} : { emittedGlsl: g };`).
- F2. Decision D3 of accepted proposal 0070 made it optional and put the choice on every reader: "It is present only when the GLSL spelling differs from `emitted`. A host on WebGL2 reads `emittedGlsl ?? emitted`" (`changes/0070-every-ts-name.md`, D3, amendment of 2026-10-13). The field's doc comment says the same (`src/core/reflect.ts:344-345`).
- F3. The choice is written in five places, each reading the same pair:

| Reader                       | File and line                                                                                | Reads                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `glslNameOf`, two call sites | `src/runtime/gl-draw/glsl-name.ts:1-4`; `src/runtime/gl-draw/render-programs.ts:184`, `:202` | `BindEntry`/`PackBinding` `emittedGlsl ?? emitted` |
| `toDrawBinding`              | `src/core/manifest.ts:864`                                                                   | `PackBinding` `emittedGlsl ?? emitted`             |
| `glslOverrideNames`          | `src/core/gl-overrides.ts:29`                                                                | `PackOverride` `emittedGlsl ?? emitted`            |
| a script                     | `scripts/bare-uniform-cases.ts:188`                                                          | `guardBinding.emittedGlsl ?? guardBinding.emitted` |

`glslNameOf` is re-exported at `src/runtime/gl-draw.ts:12`. It is not in `src/__api__/surface.md`.

- F4. A sibling of the same shape reads `glsl ?? name`, on records of the generated host module:
  `src/core/host-kernel-gl.ts:157` (`r.glsl ?? r.name`) and `:161` (`u.glsl ?? u.name`), declared at `:32` and `:40`; `DrawBinding.glsl` (`src/core/host-entry.ts:94`) and `HandleBinding.glsl` (`:111`), converted at `src/core/host-draw.ts:443` (`packBindingOf` copies `b.glsl` into `emittedGlsl`; it picks nothing). Their writers are `toDrawBinding` (`manifest.ts:860-873`) and `src/compiler/ts/host-face.ts:429-436`, `:1040`, `:1049`. Their presence rule differs from F1: `toDrawBinding` writes `glsl` when the GLSL name differs from the authored `name`, not from `emitted`.
- F5. Two fixes at the reader were built and measured and both grow the bundles (alternatives, below). No shape at the reader is free.
- F6. A record that always holds both spellings exists already: `Pack.requires[]` writes `wgsl: e.spelling?.wgsl ?? e.name` and `glsl: e.spelling?.glsl ?? e.name` (`src/core/reflect.ts:992-993`). The writer resolves the name there.

### Proposal (not yet implemented)

P1. The compiler writes `emittedGlsl` on every `BindEntry`, `OverrideInfo`, `PackBinding` and `PackOverride`. It equals `emitted` when the two targets spell the name alike. The type of the field is `string`, not `string | undefined`.

P2. A reader of the GLSL name reads `emittedGlsl` and chooses nothing. After stage 1 one pick remains: `packBindingOf` writes `emittedGlsl: b.glsl ?? b.name` from the F4 records. It goes in stage 2, so P2 holds in full only after stage 2. `glslNameOf` and its file go. The `??` at `manifest.ts:864`, `gl-overrides.ts:29` and `scripts/bare-uniform-cases.ts:188` goes.

P3. `emitted` keeps its meaning, the WGSL spelling. Nothing about the WGSL side changes.

P4. What of proposal 0070 changes. Only the second sentence of D3's amendment: "It is present only when the GLSL spelling differs from `emitted`. A host on WebGL2 reads `emittedGlsl ?? emitted`." becomes "It is always present. A host on WebGL2 reads `emittedGlsl`." The other parts of 0070 stand: the pair on each record (D3 option (a)), `emitted` as the WGSL spelling, the records that keep one `emitted` (an entry, a struct, a field), the schema decision D2 stands only under D2 (b); under D2 (a) the schema number of 0070 D2 and its Scope line change too, and the pull request of plan item 4 edits them. 0070 stays `accepted`; this proposal amends D3 through its own accepted merge, and a later pull request records the amendment in 0070's Approval and plan record.

P5. The kernel-loop and draw records of F4 (`glsl ?? name`) follow in a second stage, under the same rule (see the plan).

### One example before and after

An author's program with a binding `tex` (no reserved word):

```ts
declare const tex: texture_2d<f32>;
```

`reflect(module).bindGroups[0].entries[0]` and the manifest's `bindings[0]` today (measured on `examples/gallery/hello-uniform/hello-uniform.shade.ts`, binding `scale`):

```json
{ "name": "scale", "emitted": "scale", "space": "uniform", "group": 0, "binding": 0, "type": "f32", ... }
```

After:

```json
{ "name": "scale", "emitted": "scale", "emittedGlsl": "scale", "space": "uniform", "group": 0, "binding": 0, "type": "f32", ... }
```

An override record, from `workgroup-override.shade.ts`: before `{"name":"WG_SIZE","emitted":"WG_SIZE","type":"u32","default":64}`, after `{"name":"WG_SIZE","emitted":"WG_SIZE","emittedGlsl":"WG_SIZE","type":"u32","default":64}`.

Host code before and after (a host that binds a WebGL2 uniform by the manifest):

```ts
// before
const at = gl.getUniformLocation(program, b.emittedGlsl ?? b.emitted);
// after
const at = gl.getUniformLocation(program, b.emittedGlsl);
```

An author's `"use typeshade"` source does not change at all. Code that reads `emittedGlsl ?? emitted` compiles and gives the same name on a manifest that carries the field. A runtime that checks the schema still refuses a manifest of another schema (D2).

### Which fields the proposal covers

A search for the syntax (`?? x.emitted`, `.glsl ??`, `spelling?.glsl`, `.get(n) ?? n`) at the baseline gives these pairs.

| Pair                                          | Declared at                   | Writer                                                          | Readers                                      | Public shape                               | Covered      |
| --------------------------------------------- | ----------------------------- | --------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------ | ------------ |
| `BindEntry.emittedGlsl`                       | `reflect.ts:346`              | `reflect.ts:879` (`glslOnly`)                                   | via `manifest.ts:490-502` into `PackBinding` | `reflect()` result; `surface.md:1461`      | yes, stage 1 |
| `OverrideInfo.emittedGlsl`                    | `reflect.ts:616`              | `reflect.ts:973`                                                | `manifest.ts:826`                            | `reflect()`; `surface.md:1469`             | yes, stage 1 |
| `PackBinding.emittedGlsl`                     | `manifest-types.ts:182`       | `manifest.ts:490-502`                                           | `glslNameOf` (F3); `manifest.ts:864`         | manifest, Rule 11.10; `surface.md:1399`    | yes, stage 1 |
| `PackOverride.emittedGlsl`                    | `manifest-types.ts:247`       | `manifest.ts:826`                                               | `gl-overrides.ts:29`                         | manifest; `surface.md`                     | yes, stage 1 |
| `DrawBinding.glsl`, `HandleBinding.glsl`      | `host-entry.ts:94`, `:111`    | `manifest.ts:860-873`; `host-face.ts:429-436`, `:1040`, `:1049` | `host-draw.ts:443`                           | generated host module, not in `surface.md` | yes, stage 2 |
| kernel loop `reads[].glsl`, `uniforms[].glsl` | `host-kernel-gl.ts:32`, `:40` | `host-face.ts:1040`, `:1049`                                    | `host-kernel-gl.ts:157`, `:161`              | generated host module                      | yes, stage 2 |

Left out, with the reason:

- The spelling plan's sparse maps (`emittedName(map, name) = map.get(name) ?? name`, `src/core/spelling-plan.ts:95-96`, and the same lookup in `manifest.ts:380-381`, `core/compute/runner/webgl2.ts:90-91`, `backends/glsl.ts:2099`). They are inside the writer: the plan is where the name is decided, and no host reads a plan. Each lookup stays.
- `Pack.requires[].wgsl` and `.glsl`, and the IR extern readers `e.spelling?.glsl ?? e.name` (`fragment.ts:93`, `passes/mangle.ts:177`, `passes/spell-externs.ts:8`, `backends/glsl-block-values.ts:231`): the first record always holds both (F6), the others read the compiler's own IR, inside the writer.
- `entries[].emitted`, `structs[].emitted`, field `emitted`: one spelling, the WGSL one. GLSL reaches an entry, a struct and a field through the WebGL2 maps (`PackGlDraw`, `PackGlVertex`, `PackGlCompute`), which 0070 D3 chose.
- `glslSpelling` (`reflect.ts:885`): a layout mode (`loose` or `std140-block`), not a name.

## Why

The cause of the finding is F1 and F2. A reader can pick the name only because the writer left it out. Each reader that needs the name repeats the pick, and the repeat is a function (`glslNameOf`) in one file and a bare `??` in two others. Moving the pick to the writer leaves one place that decides and, after stage 2, no reader that picks.

Assumption A1: no host outside this repository reads the pair in a way this change breaks (see What it owes downstream; Radiance and vscode-typeshade were not searched).

### Facts: measured costs

Baseline `4ed243e08688981aef4f08f26793a16a8b81951b`; scratch copy of variant A (stage 1 only), measured on 2026-11-25 by a sub-agent, and the numbers below are its report. The variant needed three more `PackBinding` writers to name the field (`host-draw.ts` near 551, `host-entry-program.ts` near 130, `runtime/limits.ts` near 56, each `emittedGlsl: '_console'`) and `packBindingOf` (`host-draw.ts:443`) to write `b.glsl ?? b.name`. `bunx tsc -p tsconfig.json --noEmit` gave 0 errors.

`bun scripts/bundle-boundary.ts`, gzip bytes (the script prints gzip only):

| Bundle                 | Metric           | Before | Variant A | Delta  | Budget |
| ---------------------- | ---------------- | ------ | --------- | ------ | ------ |
| `typeshade/runtime`    | single           | 179118 | 179112    | -6     | 179118 |
| `typeshade/runtime`    | split initial    | 52236  | 52245     | **+9** | 52237  |
| `typeshade/runtime`    | split deferred   | 128845 | 128835    | -10    |        |
| `typeshade/runtime`    | split total      | 181081 | 181080    | -1     | 181081 |
| `typeshade/emit`       | single and split | 124662 | 124624    | -38    | 124662 |
| `typeshade/fuse`       | single           | 123237 | 123237    | 0      |        |
| `typeshade/algorithms` | single           | 71246  | 71246     | 0      |        |
| `typeshade/random`     | single           | 52771  | 52771     | 0      |        |

**The check fails on variant A:** `FAIL typeshade/runtime: split initial is 52245 bytes gzipped, over its budget of 52237`. The bundles fall as expected, except the initial chunk of the runtime split, which rises by 9 bytes while its total falls by 1: a byte moved between the initial and deferred chunks. This is a cost of the direction. The rise sits inside the third bullet of `CLAUDE.md` (Merging), "a rise of a budget … inside a pull request that implements a proposal already `accepted`" (the pull request sets the number to the measured one and records it in `CHANGELOG.md`), and no ceiling of `scripts/bundle-ceiling.json` is in question at 9 bytes. The proposal does not use the cost as a reason to change the direction.

Manifests of `examples/**/*.shade.ts`, `compile` then `packModule`, `JSON.stringify` (121 of 127 examples packed; clip-planes, cube-array-gather, imported-noise, loop-on-cpu, msaa-resolve and packed-bytes did not pack with that call and are not in the totals):

|              | Plain before | Plain after | Delta          | Gzip before | Gzip after | Delta         |
| ------------ | ------------ | ----------- | -------------- | ----------- | ---------- | ------------- |
| Total of 121 | 1070673      | 1073229     | +2556 (+0.24%) | 237248      | 237866     | +618 (+0.26%) |

70 manifests change; 51 have no binding or override and do not change. Per manifest the plain delta is 0 to 137 bytes (median 18) and the gzip delta 0 to 25 bytes (median 5). The sub-agent's table of all 121 rows is a scratch file and is not kept in the tree.

Tests that carry the pair and change (functional run of the 238 test files that name `emittedGlsl`, `emitted`, `packModule`, `reflect(`, `bindGroups`, `toDrawBinding`, `packBindingOf`, `glslOverrideNames` or `manifest`; 14 tests failed, 12 because of the change):

- `src/core/reflect.test.ts`: 6 tests (`toEqual` on bind entries, lines 155, 239, 495, 504, 518, 540).
- `src/core/emitted-record.test.ts`: 1 (line 119, `emittedGlsl` expected undefined).
- `src/core/backends/glsl-spelling.test.ts`: 1 (line 70).
- `src/runtime/gl-draw-resources.test.ts`: 1 (line 150; also a type error under `tsconfig.tests.json`).
- `src/runtime/gl-names.test.ts`: 2 (lines 154 and 348; also a type error).
- `src/api-surface.test.ts`: 1 (`src/__api__/surface.md` lines 1399, 1461, 1469 change `emittedGlsl?: string` to `emittedGlsl: string`; `bun run bake:api-surface`).
- Tests that still pass but carry the old rule in their text, found by review: `src/core/manifest-gl-names.test.ts:65-69` and `src/runtime/gl-names.test.ts:159` (both pick `emittedGlsl ?? emitted`), and a comment at `src/compiler/ts/reserved-names.test.ts:146`. Stage 1 edits them. The count of 12 is a lower bound.
- Not caused by the change: `src/publish-manifest.test.ts` (2 tests; they fail on unmodified `origin/main` in a worktree with no `dist`).
- Not run: the whole suite (a full `vitest run` hung in the scratch worktree and was stopped). Test files outside the grep list were not run. `examples/__emit-goldens__/` holds shader text only and carries no manifest, so no golden changes.
- `scripts/bare-uniform-cases.ts:188` is a reader of the pair (F3); stage 1 edits it.

Variant B (stage 2: required `glsl` in `host-entry.ts` and `host-kernel-gl.ts`, no `?? name`): not measured. A trial gave 26 type errors in 7 files, among them 13 in `src/compiler/ts/host-face.ts`, so stage 2 reaches the compiler's host-face output. Its bundle cost is unknown.

## Alternatives

| Alternative                                            | Cost                                                                                                                          | Measured                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Status quo                                             | Three readers pick (F3), two more pick `glsl ?? name` (F4); the owner's finding stays.                                        | none                                          |
| `class Emitted` with `get glslName()` (draft PR #1646) | A wrapper type, four `b.record` unwraps.                                                                                      | runtime +57 gzip, emit +40, fuse +2           |
| A private map in the GL runtime                        | The two copies in `core` stay.                                                                                                | runtime +10 gzip                              |
| A getter on a class the runtime builds at load         | Same wrapper cost as `Emitted`, built per load; not built or measured.                                                        | unknown                                       |
| **Writer resolves the name (this proposal)**           | The manifest grows by 0.24% plain; the runtime split initial rises 9 bytes over its budget; 12 tests and `surface.md` change. | runtime single -6, emit -38, split initial +9 |

## Owner's decisions

The proposal rests on:

- OD-3 (the compiler's work is not pushed onto the author). The author writes nothing new. The pick moves from every reader to the one writer, the compiler. OD-3 speaks of the author. It does not reach a host, and this proposal does not stretch it to one. A host's reading is simpler as a side effect.
- OD-6 (nothing is released). An old manifest, one without the field, owes no warning release. D2 states the consequence.

The proposal reverses no entry. It checks against the rest: OD-1, OD-2, OD-5, OD-7, OD-8, OD-10 and OD-11 concern syntax, stages, objects, numbers, decorators, arrays and tiers, and none speaks of a record field. OD-9 allows the compiler to emit any form with the same result; the host-visible result (the name each target declares) does not change. OD-4 holds: this section shows one example before and after, and the owner decides on the merge.

## Why the compiler cannot do it

Not applicable: the proposal adds no author-facing name, rule, diagnostic code or surface form. It changes what the compiler records. Rules 3.4 and 11.10 change in their text about that record (see What it touches).

## What it touches

- Rule 3.4 and Rule 11.10 (`docs/language-design.md`): "carries `emittedGlsl` where that spelling differs" and "`emittedGlsl` where the GLSL one differs, change 0070" become "carries `emittedGlsl`, which equals `emitted` where the two spellings agree". Rule 11.10 also names the schema (`schema`, 2): see D2. Rule 3.2 and Rule 11.11 keep their text.
- Surface §62 ("`emittedGlsl` is present where the GLSL one differs") and §69 (the schema number).
- Exports `BindEntry`, `OverrideInfo`, `PackBinding`, `PackOverride`: `emittedGlsl` becomes required. `Pack`: only if D2 takes option (a) (`schema: 3`).
- `reqs/rules/RULE-0304.md` and `RULE-1110.md` carry `emittedGlsl` and follow `bun run reqs:sync` after the rule text changes.
- Comments that state the old rule and become false: `src/core/spelling-plan.ts:10`, the doc comments at `reflect.ts:344` and `:615`, `manifest-types.ts:181` and `:246` (surface definitions keep their doc comments, edited with the field); `host-entry.ts:93`, `:110` and `host-kernel-gl.ts:30`, `:38` in stage 2. `CHANGELOG.md:1352` is history and stays.
- Code: F3 and F4 readers and writers, `glsl-name.ts` and its re-export, and the three `PackBinding` writers that variant A found (`host-draw.ts:552-553`, `host-entry-program.ts:131-132`, `runtime/limits.ts:56-58`). Also `src/runtime/gl/program.ts:64` and `src/core/host-overrides.ts:76`, which call `glslOverrideNames` and need no edit.

### Decisions

**D1. Scope of stage 2.** (a) Cover the F4 records in a second pull request. (b) Leave them. Recommendation: (a). The same pick sits there, it is read on the pack path only through `host-draw.ts:443`, and the fix reaches `host-face.ts` (13 type errors). The cost of (a) is not measured; its pull request measures it first and the owner sees it.

**D2. The schema number.** Adding a field that is always present is additive: a new runtime reads a manifest of a new compiler in either option. The only case at issue is an old manifest (no field) read by a new runtime. (a) `PACK_SCHEMA` 2 becomes 3. The existing check (`src/runtime/program.ts:459-461`) refuses the old manifest, so no host passes `undefined` to `getUniformLocation`. A shipped schema-2 runtime refuses a schema-3 manifest too. (b) Keep 2: an old manifest gives `undefined` with no error, and OD-6 says no release needs support for it. Recommendation: (a), for the reason 0070 D2 gave for its own bump (a refusal is safer than a silent misbind). The blast radius of (a), found by review: the tests that name the schema (`src/vite.test.ts:205`, `src/compiler/ts/pack.test.ts:102`, `console-variants.test.ts:21`, `emitted-record.test.ts:44,46`, and `src/runtime/runtime.test.ts:476`, which uses 3 as its unknown schema); the checked-in manifests `src/random/face.ts:62` and `src/algorithms/face.ts:826` (rebake with `scripts/bake-common-modules.ts`); `scripts/bench-vite-lifecycle.mjs:126,307`; `scripts/console-variant-journey.ts`; surface §69 and the `Pack` line of `surface.md`; and 0070's D2 and Scope, which record schema 2. Downstream, `typeshade/typeplot` and `typeshade/web` regenerate their committed build output and manifests at their next pin move. I recommend (a); option (b) is the owner's to take.

### Draft impact estimate

Known: the readers, writers and tests listed above. Unknown: the cost of stage 2 (bundle and host-face change); the effort and the schedule (unestimated, not zero). The recorded cost of the rise is the 9-byte initial chunk number, set to the measured value by the implementing pull request under `CLAUDE.md` (Merging).

### Implementation plan (not yet applicable; no stage starts before this file is merged `accepted`)

Each pull request says `Change: 0151`, stays inside what this file declares and changes the 0070 text only through its own amendment.

1. Stage 0, tests first. Add `bothTake` or `bothRefuse` (`src/core/testing/both-halves.ts`) cases for a binding and an override whose names are plain and reserved, and assert both halves: `reflect()` (`emittedGlsl` present, equal or different) and the language service's hover and diagnostics on the same source (an author does not see `emittedGlsl`; the test pins that nothing the editor shows changes, `CLAUDE.md`, A test reads both halves). Add a manifest test that every binding and override of every example carries `emittedGlsl`.
2. Stage 1. Make the field required, write it in `glslOnly` and the manifest writers, drop the readers' `??`, delete `glsl-name.ts` and the re-export of `glslNameOf` (`gl-draw.ts:12`), update the 12 tests and `surface.md` (`bun run bake:api-surface`), edit Rules 3.4 and 11.10, surface §62 and §69, and (D2 (a)) the schema number; run `bun run reqs:sync` and the Doorstop check; set the bundle numbers it exceeds to the measured ones in `scripts/bundle-budget.json` and `CHANGELOG.md`.
3. Stage 2 (D1 (a)). Make `glsl` required on the F4 records, drop `?? name`, measure first and show the bundle numbers.
4. A pull request that records the amendment of 0070 D3 in 0070's Approval and plan record (`Change: none`, documentation only).

### Independent review record

Reviewer: a Sonnet sub-agent that did not write this file. Date: 2026-11-25. Revision reviewed: the first draft of this file at baseline `4ed243e`. Measurements were not repeated. Every citation matched except the items below. Findings and the author's answers:

1. `reflect.ts:991-993` one line off. Fixed (`992-993`).
2. `host-draw.ts:443` named a reader but is a conversion. Fixed in F4 and the table.
3. Stage 1 leaves a pick in `packBindingOf`, so P2 held only after stage 2. Fixed: P2 and Why say it.
4. D2 (a) contradicted "old hosts keep working", and the reason to bump was weak. Fixed: the example sentence changed, D2 is stated as a real choice with its reason and blast radius.
5. `scripts/bare-uniform-cases.ts:188` is a reader. Fixed: F3, P2 and the table.
6. Two tests carry the old rule in text. Fixed: listed under tests.
7. Comments and doc comments state the old rule. Fixed: What it touches.
8. 0070 changes beyond D3's sentence under D2 (a). Fixed: P4 and plan item 4.
9. The applicability row omitted files. Fixed.

Open for the owner: D1 and D2, and the judgement the reviewer raised: the benefit is the end of one pick function against a manifest that grows 0.24%, a nine-byte rise of the runtime initial chunk and a schema migration.

### Approval and plan record

Does not yet apply. Acceptance will require the owner's decision on the merge and on D1 and D2, and the review record above.

### Configuration and validation record

Does not yet apply. Delivery will require the checks of the plan: the tests of stage 0, `bun run docs:impact`, `bun run reqs:sync`, `python scripts/doorstop-check.py -C`, the type check, the lint, the format check and the bundle check. Functional validation and the document audit are separate records.

## What it owes downstream

Two searches were made on 2026-11-25. The first is this session's: `gh api -X GET search/code -f q='<name> org:typeshade'`, default branches only. Only `typeshade/web` was reachable. The second is the orchestrating session's, reported here as its facts (this session did not re-run it). It ran on local checkouts whose HEAD equals `origin/main` of the repository that day: `typeshade/typeaudio` `714ecbf7`, `typeshade/typecv` `3df1921b`, `typeshade/typenn` `794aa467`, `typeshade/typeplot` `e8a0eb97`, `typeshade/web` `7a8d2926`. For each repository `$d` it ran `grep -rIl --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist -e 'emittedGlsl' $d` and `grep -rIn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --include=*.ts --include=*.tsx --include=*.js --include=*.mjs -E '\.glsl \?\? |emittedGlsl \?\?' $d`.

- `typeshade/typeaudio`, `typeshade/typecv`, `typeshade/typenn`: no file names `emittedGlsl`, and no code picks.
- `typeshade/typeplot`: no source file names `emittedGlsl`. Its committed build output does (`dist/compiler.js` and one chunk of `dist/`, which bundle this compiler and carry the compiler's own `r.emittedGlsl??r.emitted`). It commits generated example manifests (`examples/generated/*.js`). A schema bump (D2 (a)) makes them stale until `npm run build` and `npm run examples` run at its next pin move.
- `typeshade/web`: 21 files name `emittedGlsl`: the three API JSON pages below and compiled benchmark artifacts under `apps/typeshade/public/benchmarks/artifacts/`. No code picks. This session's search found: `apps/typeshade/content/api/ko/bindentry.json` ("GLSL 호스트는 `emittedGlsl ?? emitted`를 읽습니다"), `packbinding.json` and `overrideinfo.json` (member text for `emittedGlsl`), all prose. `ReferenceEntryPage.astro` has `f.glsl ?? { note: r.noForm }`, which reads texture-form data, not this field. Each page follows the new text.
- Not searched: `typeshade/radiance`, `vscode-typeshade`, `typeshade.github.io` as a separate repository, and `node_modules` and `dist` (except the `typeplot` note). Zero hits there would not be evidence of absence. Each repository records 0151 in `compiler-changes.md` when it pins a compiler that carries it.
- Any downstream host that reads `emittedGlsl ?? emitted` keeps working on a manifest that carries the field. Under D2 (a) a stored manifest (`schema` 2) fails the new runtime's schema check, and the host regenerates it. `typeshade/typeplot` and `typeshade/web` regenerate their committed build output and manifests when their pin moves past 0151.
