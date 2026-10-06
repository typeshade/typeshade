---
id: '0052'
title: 'A file says it targets WGSL alone with a `"target wgsl"` directive, and its GLSL ES 3.00 shortfall is then no `TS8015`'
status: draft
rules:
  - '10.1'
  - '10.3'
surface:
  - 50
exports: []
exports-removed: []
codes:
  - TS8076
examples: []
downstream:
  - repo: typeshade.github.io
    what: The language reference's §50 entry shows the directive; the rule pages that read Rules 10.1 and 10.3 are read again for the new fingerprints; the Korean guide pages that check:guide lists if AUTHORING.md changes; compiler-changes.md records 0052 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's language reference (plugins/typeshade/skills/typeshade/references/language.md, beside the "enable <ext>" line) names the directive and TS8076; compiler-changes.md records 0052 when the pin moves.
  - repo: radiance
    what: Each WebGPU-only shader file with a render entry (packages/radiance/src/kernels/trace.shade.ts and any other that tshc check warns TS8015 on) gains "target wgsl"; docs/typeshade-feedback.md links the change; compiler-changes.md records 0052 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names a code, tests and files in downstream repositories that do not exist yet -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0052`, `status: draft`. The front matter is the lifecycle authority. `0052` is the next number after the proposals on `main` (up to `0051`) and in the open pull requests on 2026-10-06.                                                                                                                              |
| Date and attribution          | Written 2026-10-06, Asia/Seoul. The date is the authoring context, not an approval. Drafted by the repository's coding agent at the owner's direction, from issue [#468](https://github.com/typeshade/typeshade/issues/468), which typeshade/radiance raised. The owner chose a per-file declaration over the other two options below. |
| Applicability / Effectivity   | `"use typeshade"` source; the front end's string directives (`src/compiler/ts/enables.ts` and its neighbours); `compile()` (`src/compiler/ts/compile.ts`), and through it `tshc check`; the language service's diagnostics; surface §50; Rules 10.1 and 10.3. No backend changes. Release version unassigned.                          |
| Review baseline               | `origin/main` at `a079a1bc` (the merge of PR #494).                                                                                                                                                                                                                                                                                    |
| Review and revision authority | No pull request is assigned when this revision is written. Git records revisions; the pull request's review and merge record the decision.                                                                                                                                                                                             |

## What changes

A `"use typeshade"` file can say that it targets WGSL alone, with a string directive beside
`"use typeshade"`:

```ts
"use typeshade";
"target wgsl";
```

`compile()` then emits WGSL and does not attempt GLSL ES 3.00. `glsl` is `undefined`, and the
GLSL shortfall is no `TS8015`. A file with no directive is unchanged.

| File                                                    | Before                          | After                         |
| ------------------------------------------------------- | ------------------------------- | ----------------------------- |
| compute entry only, no directive                        | no `TS8015`, `glsl` undefined   | unchanged                     |
| compute and render entries, no directive                | `TS8015` warning on line 1      | unchanged                     |
| compute and render entries, `"target wgsl"`             | `TS8014` error on the directive | no `TS8015`, `glsl` undefined |
| render entries GLSL can emit, `"target wgsl"`           | `TS8014` error on the directive | `glsl` undefined              |
| render entries with a real GLSL shortfall, no directive | `TS8015` warning                | unchanged                     |
| `"target glsl"`, `"target webgpu"` or any other value   | `TS8014` error on the directive | `TS8076`, naming `wgsl`       |
| `"target wgsl"` twice                                   | `TS8014` error on each          | `TS8076` on the second        |

Today any string other than `"use typeshade"` and `"enable <ext>"` at the top of a file is
`TS8014 Top-level expressions are not a TypeShade program` (measured on `main` at `a079a1bc`), so
no file that compiles today carries the directive, and no program changes meaning.

The directive follows the placement rule of every string directive: at the top of the file,
beside `"use typeshade"` and the `"enable <ext>"` directives (`TS8069` otherwise). The proposed
`TS8076` text is
`"target" names the one target this file is emitted for, and the only value is "wgsl"; got "<value>".`
The exact text is settled in the implementing pull request and pinned by its test (Rule 12.5).

The editor reports the same `TS8076` with the same text (Rule 12.7). The editor's own
diagnostics never run the backends, so `TS8015` there comes only from `tshc check`, which
follows `compile()`.

**Exclusions.** The directive governs the file that carries it. A file that imports from a
`"target wgsl"` file keeps its own GLSL attempt. `reflect()`, the runtime and the WebGL2 tiers do
not read the directive: a file with `glsl` undefined fails closed on WebGL2 as a compute-only
module does today. No value other than `wgsl` is proposed: WGSL is the source target every
module has, and GLSL ES 3.00 is the second target that a file can opt out of.

## Why

Radiance's path tracer `packages/radiance/src/kernels/trace.shade.ts` has a `@compute` entry
and a `@vertex` / `@fragment` pair that shows its `read_write` storage array. Radiance is
WebGPU-only by design (`docs/plan.md` there: "no WebGL2 fallback"). Each `tshc check` warns:

```text
trace.shade.ts:1:1 - warning TS8015: Backend emit failed: backend 'glsl-es300' cannot emit this module — missing capabilities: storageBuffer, compute
```

Measured on `main` at `a079a1bc` (2026-10-06): a file with the compute entry alone gets no
warning, as Rule 10.3 says. The same file with a fragment entry beside it gets the warning
above. The author has no way to say the file is WebGPU-only, so a warning that always shows
teaches the reader to skip warnings (#468).

Rule 10.3 makes the shortfall silent for a compute-only module because GLSL ES 3.00 has nothing
to serve there. A file that says it targets WGSL alone is the same case, stated by the author.

### Alternatives considered

- **A project or command-line target (`tshc check --targets wgsl`, or a package.json field).**
  No change to the language. But the editor would read the setting separately, and one project
  could not hold a WebGPU-only file beside a file meant for both targets.
- **No `TS8015` when the shortfall includes `compute`.** The smallest change, with no
  declaration. But a mixed module whose render pair is meant for WebGL2 would lose a real
  report, and the reason would be the compiler's guess, not the author's word.
- **A per-file directive (proposed).** The author states the target where the shader is
  written, the compiler and the editor read the same line, and a file with no directive is
  unchanged. The owner chose this option on 2026-10-06.

### Decisions at acceptance

- The spelling is `"target wgsl"`. Rule 2.1 governs names an author declares or calls. A string
  directive's word is governed by Rule 10.1, which this change amends to list it. `target` is
  the word TypeScript's own `tsconfig.json` uses for the output language. Alternatives:
  `"wgsl only"`, `"webgpu only"`.
- The value list is `wgsl` alone.
- The code is a new `TS8076` (`TARGET_NAME`), not a second meaning of `TS8050`, which names the
  `enable` profile.

## What it touches

- `rules: [10.1, 10.3]`. Rule 10.1 lists `"target wgsl"` beside `"enable <ext>"` as a string
  directive. Rule 10.3 gains the case: a file that says `"target wgsl"` gets silence and
  `glsl: undefined`, as a compute-only module does.
- `surface: [50]`. §50 gains a paragraph and the example above, after the `"enable <ext>"`
  paragraph.
- `codes: [TS8076]`. A new code for a wrong value or a second directive.
- `exports: []`. `CompileResult` keeps its shape: `glsl` is already optional.
- `examples: []`. No example changes. An example that is WebGPU-only is not needed to prove the
  change, since the tests below read both halves.

Required functional evidence:

- `src/compiler/ts/target-directive.test.ts` (new): a file with compute and render entries and
  `"target wgsl"` has no `TS8015` and `glsl` undefined; the same file with no directive keeps its
  `TS8015`; a render-only file GLSL can emit has `glsl` undefined under the directive; a wrong
  value and a second directive are `TS8076` with code and text (Rule 12.5); the directive after
  another statement is `TS8069`.
- `src/language-service/ambient-parity.test.ts` or the language service's diagnostics test: the
  editor reports the same `TS8076` text on the same sources (Rule 12.7).
- `src/language-service/check.test.ts`: `checkDocuments` on the mixed file with the directive
  reports no `TS8015`, and without it one.

### Draft impact estimate

Known work: one directive reader beside `enables.ts`, one condition in `compile()`, one code, the
language service's directive check, Rule 10.1 and 10.3 text, surface §50, the tests above.
Duration and cost are not estimated. The change is additive: a file with no directive compiles
to the same result.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's approval of the three
decisions above and the merge of this file as `accepted`.

### Configuration and validation record

This record does not yet apply. Delivery will require: the implementing commits with
`Change: 0052`; the tests above green on the delivered revision; `bun run docs:impact`,
`docs:refs`, `reqs:sync` and `doorstop -C` clean; and, separately, the downstream pin pull
requests with `0052` recorded in their `compiler-changes.md`.

## What it owes downstream

- **typeshade.github.io.** The language reference's §50 entry shows the directive. The rule
  pages that read Rules 10.1 and 10.3 are read again when their fingerprints change.
  `bun run check:guide` lists the Korean guide pages to translate again if `AUTHORING.md`
  changes. `compiler-changes.md` records `0052`.
- **vscode-typeshade.** `plugins/typeshade/skills/typeshade/references/language.md` names the
  directive and `TS8076` beside the `"enable <ext>"` line. `compiler-changes.md` records `0052`.
- **radiance.** `packages/radiance/src/kernels/trace.shade.ts`, and each other WebGPU-only file
  that `tshc check` warns `TS8015` on, gains `"target wgsl"`. `docs/typeshade-feedback.md` links
  the change. `compiler-changes.md` records `0052`.

Each item is expected work. None is started, and each follows the pin that carries the
implementation.
