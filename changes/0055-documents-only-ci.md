---
id: '0055'
title: 'A pull request that changes only documents runs the build, the unit suite and the traceability check, and skips the GPU gates and the TypeScript legs'
status: draft
rules:
  - '13.4'
surface: []
exports: []
exports-removed: []
codes: []
examples: []
downstream: []
---

<!-- doc-refs: skip-file — a draft proposal names a CI job that does not exist yet -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0055`, `status: draft`. The front matter is the lifecycle authority. `0055` is the next number after `0054` (pull request #506).                                                                                         |
| Date and attribution          | Written 2026-10-06, Asia/Seoul. The date is the authoring context, not an approval. Drafted by the repository's coding agent at the owner's direction ("docs 만 올리는거면 CICD 좀 개선해야겠네요 너무 많은 불필요한 작업이 실행됩니다"). |
| Applicability / Effectivity   | `.github/workflows/ci.yml`; Rule 13.4 of `docs/language-design.md`; `AGENTS.md` (Tests); `README.md`. No source file, test or published package changes. Release version unassigned.                                                      |
| Review baseline               | `origin/main` at `5c9bb5dc` (the merge of PR #504).                                                                                                                                                                                       |
| Review and revision authority | No pull request is assigned when this revision is written. Git records revisions; the pull request's review and merge record the decision.                                                                                                |

## What changes

A pull request that changes only documents runs two of CI's seven jobs. A document here is a
`.md` file outside `src/`, or a Doorstop item under `reqs/`.

| Job (check name)                                    | Reads documents                                                 | Documents-only pull request | Any other change |
| --------------------------------------------------- | --------------------------------------------------------------- | --------------------------- | ---------------- |
| `typecheck + unit`                                  | yes: the unit suite reads the rules, the surface, the proposals | runs                        | runs             |
| `traceability (Doorstop)`                           | yes: `reqs/` and the rule text                                  | runs                        | runs             |
| `typecheck + unit (TypeScript 5.9.3)` and `(6.0.3)` | no new reading: the same suite on another TypeScript            | skipped                     | runs             |
| `compile gate (Tint + WebGL2)`                      | no: the examples and generated programs                         | skipped                     | runs             |
| `user journeys (packed tarball, WebGPU)`            | no: the journeys and the packed tarball                         | skipped                     | runs             |
| `render gate (WebGPU + pixel golden)`               | no: one example's pixels                                        | skipped                     | runs             |

A new job, `change scope`, reads the pull request's diff against its base and decides. A file
under `src/` is code whatever its extension: `src/__api__/surface.md` is a snapshot the unit
suite reads. A workflow file is code. A push to `main`, a manual dispatch and the release
workflow (`publish.yml` calls `ci.yml`) run every job, whatever they change.

A skipped job reports success to the ruleset, so a required check is not left waiting. The
required checks keep their names.

## Why

A proposal, a status line or a record runs the full gate today: the unit suite three times
(once on the pinned TypeScript, once on 5.9.3, once on 6.0.3), two browser gates and the
journeys. Read from pull request #502's checks on `d71141f9`, a change to one proposal file
(2026-10-06): seven jobs, `typecheck + unit` 6.8 minutes, `typecheck + unit (TypeScript 5.9.3)`
8.5, `(6.0.3)` 6.4, the compile gate 1.8, the journeys 2.2, the render gate 0.6. The four jobs this
proposal skips read no document, so they can find nothing in such a change.

The unit suite stays. Many unit tests read documents: `src/compiler/ts/doc-snippets.test.ts`
compiles every snippet of the surface document, `src/changes.test.ts` reads the proposals, and
about a hundred test files name a document or its path (a text search of `src/` on 2026-10-06,
which over-counts the files that read one). A documents-only change can break them, as `0052`'s front matter broke
`src/changes.test.ts` on #502.

### Alternatives considered

- **Skip the whole workflow for documents (`paths-ignore`).** The fastest, but the required
  checks would then never report and every such pull request would wait for ever
  (CLAUDE.md, Merging). And the unit suite, which does read documents, would not run.
- **Run only the tests that read documents.** Faster again, but the list of such tests is large
  and changes with every test added; a test missing from it would let a broken document merge.
- **Skip the jobs that read no document (proposed).** One job decides, the jobs that read
  documents keep running in full, and nothing else needs a list kept up to date.

## What it touches

- `rules: [13.4]`. Rule 13.4 says every change must pass `gate:compile`. It gains: a change that
  edits only documents must pass `bun run build`, `bun run test` and the traceability check, and
  needs no GPU gate, since no GPU gate reads a document.
- `surface: []`, `exports: []`, `codes: []`, `examples: []`. Nothing an author or a host meets
  changes.
- `downstream: []`. A search of typeshade.github.io and vscode-typeshade on 2026-10-06 found no
  page that restates Rule 13.4 or CI's jobs.

Required evidence:

- A documents-only pull request whose checks show `change scope`, `typecheck + unit` and
  `traceability (Doorstop)` passing and the other four skipped, and whose required checks let it
  merge.
- A pull request that changes one source file runs all seven jobs.
- `src/reqs.test.ts`, `src/ifchange.test.ts` and `scripts/ifchange.ts` pass: `ci.yml`'s
  `LINT.IfChange(jobs)` block names `AGENTS.md` (Tests), which changes with it.

### Draft impact estimate

Known work: one job and four `needs`/`if` lines in `ci.yml`, its header comment, one paragraph in
`AGENTS.md`, one sentence in `README.md`, Rule 13.4. Duration: under an hour. Cost: none.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's approval and the merge of
this file as `accepted`.

### Configuration and validation record

This record does not yet apply. Delivery will require the implementing commit with
`Change: 0055` and the evidence above.

## What it owes downstream

Nothing. No downstream repository restates CI's jobs or Rule 13.4.
