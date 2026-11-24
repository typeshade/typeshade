# Structure refactoring plan, second phase

This plan splits the oversized files of `src/` by responsibility, in small pure moves.
It continues the [first refactoring](refactoring-plan.md) (R0 to R5), which is complete.
It changes no author-facing name, rule, diagnostic or emitted output.

Labels used below: **Fact** is a measured or quoted statement. **Decision** is a choice that is made
and recorded with its authority. **Proposal** is a suggestion that no one has decided.
**Open** is an item that waits for an action or an answer.

## 1. Purpose and authority

The owner asked for a structural refactoring of the whole project.
The owner also asked to learn from the open-source project `code-yeongyu/oh-my-openagent`
("omo", commit `1cfa727`).

Fact: omo worked in this way (its `ROADMAP.md` and history):

1. It wrote the layering plan before any move.
2. It committed baseline measurements.
3. It guarded boundaries with audit tests and count ratchets that only shrink.
4. It made each extraction a pure move. The old path kept a one-line re-export.
5. It moved in small commits, one module each.
6. It removed dead re-exports later, in separate commits.

Fact: omo's limit of 200 lines per file is not enforced, and one file of 3,626 lines remains.
TypeShade enforces its limits by test, which is stronger.

On 2026-11-24 the orchestrating agent proposed six steps. The owner answered in the conversation:
"좋아요. 그렇게 해주세요" (English: "Good. Please do it that way"). The six steps are:

1. Write the plan first: the target layers and the allowed dependency directions.
2. Measure and record the baseline.
3. Put the boundary audit test in first. Allow current violations as a baseline that only shrinks.
4. Move one responsibility at a time as a pure move. The old path stays as a re-export.
5. Never mix a move with a behaviour change in one pull request.
6. Remove the re-exports in separate pull requests.

This answer is an authority of this plan. It is a decision about how to work.
It is not an entry of [owner decisions](owner-decisions.md), which records what TypeShade is.

The plan also rests on two rules of the owner, both given on 2026-11-17 and recorded in `CLAUDE.md`:

- File size: a file of `src/` has at most 400 lines, comments included.
- Comments: write no comment in a file of `src/`, except the kinds that `CLAUDE.md` lists.

Fact: `docs/refactoring-plan.md` (2026-11-16) says "File length alone does not justify a split".
The 400-line rule came one day later. This plan meets the rule by moving responsibilities.
It never cuts a file at a line count.

Fact: OD-1 to OD-11 are about the language. This refactoring is internal. It changes no
author-facing name, rule, diagnostic code or emitted output, so no entry applies to it.
Under [change control](../changes/README.md#when-a-change-needs-one), an internal refactor needs no proposal.
Each commit says `Change: none, <reason>`.

### 1.1 The delegation of 2026-11-24

Fact: on 2026-11-24 the owner said the following to the orchestrating agent in the conversation.

- On the recommendations for the four open items and the mechanical checks: "추천대로" (said several times).
  The owner then said "앞으로도 추천대로 진행해주세요" (English: "Proceed as recommended from now on too").
- "You are the owner and long-term maintainer of this codebase, and its design is up to you."

Decision: this delegates the design of this internal refactoring to the orchestrating agent.
The design covers the layers, the module boundaries, the names and the order of the slices.
The orchestrating agent decides each such point and records it here with its reason.

Decision: the delegation does not change the following.

- The entries of `docs/owner-decisions.md`. Only the owner changes an entry.
- Anything an author reads. The agent shows it to the owner before a decision (OD-4).
- `CLAUDE.md`, Merging. The owner still merges a change to that section (decision D5).

## 2. Baseline

Fact: the baseline was measured on 2026-11-24, on `main` at `d4c40db1`.
The first measurement was on `91afe946`, and about twenty pull requests merged since.
The count of files above the limit (263 in the baseline) and the 32 `KNOWN` edges did not change.
The non-test lines of the baseline fell from 147,411 to 147,393.

| Item           | Value                                                                           |
| -------------- | ------------------------------------------------------------------------------- |
| Commit         | `main` at `d4c40db104867c23f1786c31e025697e5832f260`                            |
| Bun            | 1.4.4 (`.bun-version`)                                                          |
| Node           | v22.23.5 on the measuring machine; `.node-version` says 24.19.0                 |
| TypeScript     | 5.6.3 (`node_modules/typescript/package.json`)                                  |
| Method         | `git ls-files -- src`, files that end in `.ts`, lines counted as an editor does |
| Line rule      | `lineCount` of `scripts/file-size-policy.ts` (a final newline adds no line)     |
| Install        | `bun install --frozen-lockfile`                                                 |
| Baseline files | `scripts/file-size-baseline.json`, `scripts/comment-baseline.json`              |

### 2.1 Size of `src/`

| Measure                                | Files | Lines   |
| -------------------------------------- | ----- | ------- |
| All `.ts` files, non-test              | 616   | 217,156 |
| All `.ts` files, test (`*.test.ts`)    | 692   | 224,901 |
| In `file-size-baseline.json`, non-test | 123   | 147,393 |
| In `file-size-baseline.json`, test     | 140   | 131,025 |

- The baseline lists 263 files above 400 lines.
- The lower bound of new files is the sum of `ceil(n / 400) - 1` over those files: 317 non-test and 272 test.
- The policy skips files that carry a `GENERATED FILE`, `Generated by` or `@generated` marker, and `*.shade.ts`.
  The tree has 267 files above 400 lines, so four are skipped:
  `src/algorithms/face.ts`, `src/core/libm/explog.generated.ts`, `src/core/libm/explog.shade.ts`
  and `src/core/libm/trig.shade.ts`.
  Their split belongs to their generators (`scripts/bake-common-modules.ts`, `bun run bake:libm`, `tshc sync`), not to this plan.
- `src/core/coverage/*` is typed data that `scripts/bake-capability-coverage.ts` reads and checks.
  The script writes `docs/capability-coverage.md` and parts of `docs/language-design.md`, not these files.
  A split of `src/core/coverage/` keeps the output of `bun run bake:capability-coverage` byte-identical.

### 2.2 Files above the limit, by group

Each cell is files / lines of the baseline. A group follows the directory of the file.

| Group                  | Non-test      | Test          | New files needed (non-test, test) |
| ---------------------- | ------------- | ------------- | --------------------------------- |
| `compiler/ts/lower`    | 16 / 22,728   | 0             | 49, 0                             |
| `compiler/ts` (rest)   | 25 / 27,933   | 58 / 53,343   | 60, 108                           |
| `core` (root files)    | 22 / 23,261   | 12 / 9,829    | 49, 20                            |
| `core/passes`          | 17 / 17,991   | 14 / 11,743   | 38, 24                            |
| `core/coverage`        | 6 / 12,960    | 0             | 30, 0                             |
| `core/ir`              | 4 / 7,047     | 1 / 524       | 15, 1                             |
| `core/backends`        | 2 / 3,498     | 4 / 4,117     | 8, 9                              |
| `core/testing`         | 6 / 5,232     | 2 / 1,329     | 12, 3                             |
| `core` (other subdirs) | 6 / 4,960     | 13 / 9,363    | 8, 18                             |
| `language-service`     | 7 / 8,627     | 11 / 11,318   | 19, 24                            |
| `runtime`              | 7 / 7,785     | 10 / 12,995   | 17, 29                            |
| `rhi`                  | 5 / 5,371     | 1 / 425       | 12, 1                             |
| `src` root             | 0             | 14 / 16,039   | 0, 35                             |
| Total                  | 123 / 147,393 | 140 / 131,025 | 317, 272                          |

Fact: the ten largest non-test files are:

| Lines | File                                       |
| ----- | ------------------------------------------ |
| 4,436 | `src/compiler/ts/abstract-const.ts`        |
| 3,450 | `src/core/coverage/wgsl.ts`                |
| 3,227 | `src/language-service/diagnostics.ts`      |
| 3,069 | `src/compiler/ts/lower/function.ts`        |
| 2,915 | `src/compiler/ts/structs.ts`               |
| 2,912 | `src/compiler/ts/lower/statement.ts`       |
| 2,903 | `src/core/coverage/webgpu-dictionaries.ts` |
| 2,866 | `src/core/backends/glsl.ts`                |
| 2,796 | `src/core/ir/node.ts`                      |
| 2,715 | `src/core/coverage/webgpu-objects.ts`      |

The largest test files are `src/fuse.test.ts` (7,088), `src/runtime/runtime.test.ts` (5,110) and
`src/compiler/ts/use-inference.test.ts` (3,440).

### 2.3 Layer violations and other baselines

- `src/layer-policy.test.ts` lists 32 `KNOWN` edges that go against `MAY_IMPORT`.
  They come from 11 importing files and reach 17 distinct targets.
- Importing files, with edge counts: `core/host-draw.ts` 8, `core/host-entry-program.ts` 6,
  `core/testing/fuse-chain.ts` 4, `core/host-runtime.ts` 3, `core/spec-conformance/coredef-witness.ts` 3,
  `core/testing/both-halves.ts` 2, `core/testing/cpu-program.ts` 2, and one each for
  `compiler/ts/host-face.ts`, `compiler/ts/host-face-contracts.ts`, `core/cpu-entries.ts` and `core/debug/watch.ts`.
- `scripts/comment-baseline.json` lists 967 files with 52,644 comment lines in total.
- Nine files of `src/` are pure re-export facades: `src/compiler/ts/growing-programs/index.ts`,
  `src/compiler/ts/index.ts`, `src/compiler/ts/vertex-layout.ts`, `src/compute.ts`,
  `src/core/ir/index.ts`, `src/core/passes/lint/index.ts`, `src/core/passes/opt/expr-utils.ts`,
  `src/core/passes/opt/index.ts` and `src/runtime-internal.ts`.
  The count is a heuristic: a file of at most 40 lines that holds only `export ... from` statements.
- The tree has 12 `index.ts` files. Every file name of `src/` is kebab-case.
  Two names are catch-all: `src/compiler/ts/growing-programs/common.ts` and `src/compiler/ts/optional/helpers.ts`.

### 2.4 Commands that produced the numbers

1. `git rev-parse HEAD`
2. `bun --version`, `node --version`, and `grep '"version"' node_modules/typescript/package.json`
3. `git ls-files -z -- src`, filtered to `.ts`, then a count of lines per file (a script in the session scratchpad, not committed).
4. The sums of `scripts/file-size-baseline.json` and `scripts/comment-baseline.json`, by the same script.
5. A read of the `KNOWN` array of `src/layer-policy.test.ts`, grouped by importing file.

### 2.5 Status of the six steps

| Step | Status      | Evidence                                                                                               |
| ---- | ----------- | ------------------------------------------------------------------------------------------------------ |
| 1    | In progress | This document. The delegation of section 1.1 lets the orchestrating agent accept it once it is merged. |
| 2    | Done        | Section 2 of this document, measured again on `d4c40db1`.                                              |
| 3    | Already met | `src/layer-policy.test.ts`, `src/file-size-policy.test.ts`, `src/comment-policy.test.ts`.              |
| 4    | Not started | Series S1 to S12 below. They wait for series S0 (decision D1).                                         |
| 5    | Not started | Section 5, rule 1. The move-purity check of S0 item a (`scripts/move-purity.ts`) enforces it.          |
| 6    | Not started | Series S13 below.                                                                                      |

Fact: the three policy tests are ratchets. A number in a baseline file only goes down.
Step 3 needs no new work. S0 adds more ratchets (section 6).

## 3. Target structure

Proposal: the layer order is `MAY_IMPORT` of `src/layer-policy.test.ts`, unchanged.
Series S0 item g may add an order inside `core` (section 6).

```text
core             imports no other directory of src/
rhi              imports core
compiler         imports core
runtime          imports core, rhi
language-service imports core, compiler
algorithms       imports core, runtime
random           imports core, runtime
cli              imports core, compiler, language-service, runtime
```

Proposal: the target for one module is as follows.

- A file that passes 400 lines becomes a directory named for the module.
- The directory holds files named for responsibilities. Each file has at most 400 lines.
- The old path stays as a facade. The facade holds only `export ... from` statements.
- The facade keeps every export that a caller outside the directory imports.
- A new file imports only what its responsibility needs. It never imports the facade.

Fact: the tree already follows this shape in places. Examples are `src/compiler/ts/abstract-const/`,
`src/compiler/ts/lower/made-array/` and `src/compiler/ts/remedies/`.

Decision D4: the naming rules below are enforced by a policy test (S0 item c). Reason: a rule that no test reads goes stale.

- A file name is kebab-case. Fact: all 1,308 `.ts` files already comply.
- A new file has no catch-all name: `utils.ts`, `helpers.ts`, `common.ts`, `misc.ts`, `part-1.ts`.
  Fact: two files break this rule today (section 2.3). The policy test takes them as its baseline.
  The baseline only shrinks. Nothing renames them by this rule alone.
- A directory takes the name of the module it came from, in kebab-case.
- A test file takes the name of the source file it tests, with `.test.ts`.

## 4. The slice procedure

A slice is one responsibility moved out of one file. One slice is one pull request.
Do these steps in order. A slice of S1 to S13 starts only after S0 items a and b are merged (decision D1).

1. Pick one responsibility of one file of `scripts/file-size-baseline.json`.
2. Check the open pull requests for the file (section 7.1). Pick another file if one edits it.
3. Open a draft pull request with the slice's scope. Push the first commit at once.
4. List the callers of the code to move. Use `trace_path` and `search_graph` of the code graph.
5. Create the directory named for the module, if it does not exist.
6. Move the declarations with `scripts/move-declarations.ts`. Do not retype code, rename a symbol or edit a body. <!-- doc-refs: skip — a tool that series S0 of this plan builds -->
7. Keep every import of a caller outside the directory working without edit.
8. Leave the test files unedited. The next pull request moves them (decision D2).
9. Run `bun run bake:file-size-baseline`. The numbers go down and no number goes up.
10. When a `KNOWN` edge of `src/layer-policy.test.ts` is gone, delete its line.
11. Run `bun run bake:comment-baseline` only if a comment moved with the code.
12. Run the move-purity check of S0 item a (`bun run move:check --base origin/main --require`). It includes the module-surface check of S0 item f.
13. Run the checks of section 8.
14. Commit with `Change: none, internal move without behaviour change` and the trailer `Move: pure`. Add `Docs-Impact:` if the hook asks.
15. Push, mark the pull request ready when its required checks are green, and record the slice (section 8).

Proof that behaviour did not change:

- The move-purity check passes. Section 8, item 9 states what a pass proves and what it leaves open.
- Each moved declaration goes into a new file. A move into an existing file changes the exports of
  that file, and the check refuses it.
- A file that is in an import cycle, or that holds a declaration that runs code when the module
  loads, is not touched by a slice. The check refuses it (P4).
  Making such a file clean is an ordinary change and goes through review.
- The emit goldens are byte-identical: `bunx vitest run examples/emit-goldens.test.ts examples/shade-examples.test.ts examples/shade-twins.test.ts`
  without `UPDATE_EMIT_GOLDENS`. Never run `bun run bake:goldens` in a slice.
- `src/__api__/author-names.md` is unchanged. `src/author-names.test.ts` holds it.
- `src/__api__/surface.md` keeps the same names and shapes.
  Fact: it is keyed by the definition path (`src/algorithms/index.ts#abs`).
  A move of an exported definition can change that path. R3 (#1288) changed one such line.
  Decision D6: a path-only change to a line of `surface.md` is allowed in a slice. The pull request lists each one.
  Reason: the move changes the key and no name or shape. A changed name or shape is a behaviour change and is rejected.
- A test file that is not edited still passes against the moved source (decision D2).
  Its pass is the proof of the move.

## 5. Rules

1. No behaviour change inside a move. Diagnostics, emitted text, API shapes and error order stay as they are.
2. A bug found during a move becomes its own pull request. It lands before or after the move, never inside it.
3. Sources move first. Tests move in the next pull request (decision D2).
   Reason: a test file that is not edited and still passes against the moved source is the proof of the move.
   An oversized test file splits along the same responsibilities as its source.
4. A comment that states an invariant is replaced by a test or an assert before it goes (`CLAUDE.md`, Comments).
   Moved code keeps its comments. The move does not add a comment line to any file.
5. A facade removal is a separate later pull request, one per directory.
6. A slice does not raise a number in `scripts/file-size-baseline.json` or `scripts/comment-baseline.json`.
7. A slice does not add a `KNOWN` edge to `src/layer-policy.test.ts`.
8. A slice reaches into one directory. A move across directories is its own slice.
9. A compiler or editor path that an author can read keeps both halves in step (`CLAUDE.md`, A test reads both halves).
   A move needs no new test of this kind, but the existing `bothTake` and `bothRefuse` tests must still pass.
10. A slice does not move a file that an open pull request or a recorded waiting patch edits (section 7.1).

## 6. Work sequence

Decision D1: series S0 comes before S1. No slice of S1 to S13 starts before S0 items a and b are merged.
Reason: the checks and the tool make a pure move provable and mechanical. An agent chooses symbols and names, and never retypes code.
Each S0 item is its own pull request. An S0 item is not a pure move. Its commit says `Change: none, <reason>`.

Proposal: S2 to S13 follow the order of the layers, from the bottom. A row is a series of slices, not a deadline.
Status of each row: not started. Under decision D2, each series moves its sources first and its tests in the next pull request.

| ID  | Status      | Files and responsibility                                                                                                                      | Exit condition                                                                  |
| --- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| S0  | Not started | The tools and checks, items a to h below.                                                                                                     | Items a and b are merged; items c to h are merged or recorded as open.          |
| S1  | Not started | The 11 importing files of the 32 `KNOWN` edges. `core/host-draw.ts`, `core/host-entry-program.ts` and `core/host-runtime.ts` move up (D3).    | `KNOWN` is empty; `core` imports no other directory.                            |
| S2  | Not started | `core/ir`: `node.ts` and 3 more files above the limit, then the 1 test file.                                                                  | No file of `core/ir` is in the baseline.                                        |
| S3  | Not started | `core/backends`: `glsl.ts`, `wgsl.ts`, then their 4 test files.                                                                               | No file of `core/backends` is in the baseline.                                  |
| S4  | Not started | `core/passes`: 17 files, then 14 test files. The files include `kernel-lower.ts` (split in R5).                                               | No file of `core/passes` is in the baseline.                                    |
| S5  | Not started | `core` root files (22, then 12 test files) and `core/coverage` (6 files), `core/testing`, `core/debug`, `core/spec-conformance`, `core/libm`. | No file of `core` is in the baseline.                                           |
| S6  | Not started | `rhi`: 5 files, then 1 test file.                                                                                                             | No file of `rhi` is in the baseline.                                            |
| S7  | Not started | `runtime`: 7 files, then 10 test files.                                                                                                       | No file of `runtime` is in the baseline.                                        |
| S8  | Not started | `compiler/ts/lower`: 16 files, including `function.ts`, `statement.ts` and `expression-call.ts`.                                              | No file of `compiler/ts/lower` is in the baseline.                              |
| S9  | Not started | `compiler/ts` (rest): 25 files, including `abstract-const.ts` and `structs.ts`.                                                               | No non-test file of `compiler/ts` is in the baseline.                           |
| S10 | Not started | `language-service`: 7 files, then 11 test files. The files include `diagnostics.ts` and `service.ts`.                                         | No file of `language-service` is in the baseline.                               |
| S11 | Not started | Test files of `compiler/ts` (58 files, 53,343 lines), after S8 and S9.                                                                        | No test file of `compiler/ts` is in the baseline.                               |
| S12 | Not started | The 14 test files of `src` root, including `fuse.test.ts` (7,088 lines).                                                                      | No file of `src` root is in the baseline.                                       |
| S13 | Not started | Facade removal, one pull request per directory, after the series of that directory.                                                           | No facade without a caller outside its directory; `docs:refs` and `build` pass. |

### 6.1 Series S0, the tools and checks

Each item is its own pull request.

| Item | Status                    | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a    | Done in this pull request | `scripts/move-purity.ts` with a policy test. For a base and a head commit it compares the multiset of top-level declarations of `src/`, by a hash of their text from the TypeScript AST. Only `import` declarations, `export ... from` declarations and an added or removed `export` modifier may differ. It reports each declaration that changed, appeared or vanished. It also compares the multiset of test titles (the first-argument strings of `describe`, `it` and `test`). |                                                                     |
| b    | Decision                  | `scripts/move-declarations.ts`. It takes a source file, a list of top-level symbol names and a target file. It moves the declarations verbatim with their leading comments. It fixes imports in both files and in the importers. It leaves a re-export in the source file when an importer outside the directory uses a moved symbol.                                                                                                                                               | <!-- doc-refs: skip — a tool that series S0 of this plan builds --> |
| c    | Decision                  | A name policy test. No new file of `src/` is named `utils`, `helpers`, `common`, `misc`, `shared-stuff` or `part-N`, or has a bare numeric suffix. The two existing files (`src/compiler/ts/growing-programs/common.ts` and `src/compiler/ts/optional/helpers.ts`) are its baseline, which only shrinks.                                                                                                                                                                            |
| d    | Decision                  | An import-cycle ratchet. The number of file-level import cycles has a baseline that only shrinks. A cycle is a strongly connected component of more than one file. Type-only imports are counted separately. The move-purity check already refuses a slice that makes a cycle or that touches a file of a cycle (P4).                                                                                                                                                               |
| e    | Decision                  | A facade ratchet. A list names the facade files. A facade holds only re-exports. The list only shrinks after S13 begins. A file inside a module's directory never imports its own facade.                                                                                                                                                                                                                                                                                           |
| f    | Part of item a            | A module-surface check for a slice. Item a carries it as rule 3 (P3). The set of symbols that files outside a module's directory import from it is the same before and after the slice.                                                                                                                                                                                                                                                                                             |
| g    | Proposal                  | An extension of `MAY_IMPORT` inside `core`, for example `core/ir` below `core/passes` below `core/backends`, with its own `KNOWN` list. The exact order is fixed by measurement, in its own pull request.                                                                                                                                                                                                                                                                           |
| h    | Placeholder               | Structure rules: no top-level effects outside named files, no import cycles, imports of a module only through its index, index holds re-exports only; each a ratchet. The orchestrator writes them in a later pull request.                                                                                                                                                                                                                                                         |                                                                     |

Reasons for the order of S1 to S13 (Proposal):

- S1 changes few files and removes the largest layer problem. Later slices then cannot depend on an upward import.
- S2 to S7 follow `MAY_IMPORT` from the bottom. A lower layer is stable before the layer above it moves.
- `core/coverage` moves with `core` root files because both stay inside `core`. Its output is checked by `bun run bake:capability-coverage`.
- S8 comes before S9 because `compiler/ts/lower` is imported by `compiler/ts`, and its files are fewer.
- S10 comes after `compiler` because `language-service` imports `compiler`.
- A test file moves in the next pull request after its source (decision D2). S11 and S12 hold the tests that span directories, and the root tests.

Fact: the move-purity check refuses a move that a pure move cannot make.
A review measured the 123 oversized non-test files.
About 94% of their units and 86% of their lines are evaluation-free.
34 files cannot reach 400 lines by pure moves alone.
The causes are single units above 400 lines or large active units.
`src/compiler/ts/lower/function.ts` has one function of about 1,900 lines.
Each file of `src/core/coverage/` is one data unit.
Test files rarely split purely, because their describes share file-level helpers.

Decision D7: such a file needs an ordinary reviewed change (a decomposition) before a pure move, or instead of one.
That change is outside D5.
Reason: a pure move keeps each declaration text, so it cannot split one unit.

Fact: a banned comment cannot travel with a pure move.
The new file starts at 0 comment lines in `scripts/comment-baseline.json`, and the unit text must not change.
Doc comments of public definitions, markers and `Why:` comments can travel.

Decision D8: the comments of a directory go first, in their own ordinary pull request (`CLAUDE.md`, Comments).
D5 does not cover that pull request.

Decision D9: D5 requires that the `move purity` step ran as required on the head that is merged.
The orchestrating agent reads the output of that step before it merges.

Fact: three reviews of the move-purity check broke it through module evaluation.
The breaks were import cycles with reads of uninitialised bindings, units that run or read at load, and import order.
Measurement on `src/` at `HEAD` (617 non-test files, `bun scripts/move-purity.ts --clean-report`):
5.7% of the 8,218 top-level units are active (465 units, in 137 files).
14 import cycles hold 184 files, when type-only imports count as edges.
One cycle holds 139 files, all of `src/compiler/ts`.
When only value imports count, 10 cycles hold 80 files and the largest holds 46.
With the strict classifier of P4 and value imports only, 418 of the 617 files are clean:
139 files hold 494 active units, and 80 files are in cycles.

Decision D10: the check does not model module evaluation for arbitrary code.
A pure move is accepted only in clean files, where evaluation cannot matter (section 8, item 9, P4).
Structure rules make more of the tree clean over time.
Series S0 gains them as item h, and each rule is a ratchet.
A slice is possible only in clean files.
Cleaning a file or breaking a cycle is an ordinary reviewed change outside D5.
Reason: a model of evaluation had three reviews that broke it, and a structure that carries the complexity has none.

### 6.2 Series S1, the direction of the move

Fact: 17 of the 32 edges come from `core/host-draw.ts`, `core/host-entry-program.ts` and `core/host-runtime.ts`.
They import `runtime` and `rhi`. A slice in `core` cannot remove these edges without a design choice.

Decision D3: the three files move up into `src/runtime/host/`. They do not stay in `core`.
Reason: `core/host-draw.ts` imports `RuntimeImpl`, `webgpuDevice` and `cpuDevice` as values.
Pulling those down would put device code in `core`. It would break the rule that `core` imports no other directory.

Fact, read at `d4c40db1`: the files differ in what they import.

- `core/host-draw.ts` imports `RuntimeImpl`, `webgpuDevice` and `cpuDevice` as values, as the decision says.
- `core/host-entry-program.ts` imports `RuntimeImpl` as a type only. It imports no device factory.
  It imports `ProgramImpl`, `CallBuffer` and `CallWords` from `runtime/program.ts` and `holdValue` from `rhi/cpu.ts`, as values.
  It also imports from `core/host-draw.ts`.
- `core/host-runtime.ts` imports no `RuntimeImpl` and no device. It is the module that a generated host module imports.
  It re-exports `callDraw` and `callCompute` from the other two files.
  It re-exports `exportedBinding` from `runtime/resource.ts`, and types from `runtime/host-types.ts` and `runtime/resources.ts`.

The decision holds on this reading: the three files form one unit, and `host-draw.ts` forces it up.

Fact: the importers of the three files are as follows.

- `src/runtime-internal.ts` runs `export *` from `core/host-runtime.ts`.
- `src/compiler/ts/host-face-contracts.ts` imports the type `FragmentEntry` from `core/host-draw.ts`.
- `src/compiler/ts/host-face.ts` and `host-face-contracts.ts` import the type `ClassLayouts` from `runtime/resource.ts`.
- `src/compiler/ts/growing-load.ts` names the path `core/host-runtime.ts` in a string.
- Five files of `scripts/` name `core/host-runtime.ts` by import or by path:
  `bare-uniform-cases.ts`, `bench-fuse-scope.ts`, `class-arm.ts`, `entry-calls-page.ts` and `entry-calls.ts`.
- Four test files import them: `src/runtime/gl-names.test.ts`, `src/compiler/ts/host-draw.test.ts`,
  `src/compiler/ts/host-kernel.test.ts` and `src/compiler/ts/host-entry.test.ts`.

Decision D3, continued: the types that `compiler` needs from these files move down into `core` as contracts.
`FragmentEntry` and `ClassLayouts` are the two named above.
The old paths stay as re-exports until S13.

Open: the import cycles between `core`, `runtime` and `rhi` around these files are not measured yet.
The slice measures them before the move, with the check of S0 item d, and records the result in its pull request.

## 7. Parallel work and conflicts

- Run at most six sub-agents at the same time (`CLAUDE.md`, Running sub-agents). Start the next one when one finishes.
- Slices in different directories can run in parallel. They touch different files.
- Two slices of one directory run in sequence. They would edit the same file and the same baseline lines.
- `scripts/file-size-baseline.json` and `src/layer-policy.test.ts` are shared. Each slice edits only its own lines.
- `main` changes every day. Keep each slice small. Rebase on `main` before merge, and run `bun run bake:file-size-baseline` after the rebase.
- A slice that conflicts in the baseline file re-bakes it. It never resolves the conflict by hand.
- A sub-agent writes its working files under a directory of its own, and stops every process it started before it reports.

### 7.1 Other sessions and open work

Fact: three other sessions worked in this repository on 2026-11-24. Their reports say the work below is not on `main`.
It touches `src/`. The merges that these sessions reported are on `main`.

| Work                                    | Files                                                                  | Branch or pull request                | Status                        |
| --------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------- | ----------------------------- |
| 0146 implementation                     | `src/core/passes/gl-compute.ts`, `src/core/gl-compute.ts`              | `claude/0146-impl`                    | Branch not found on `origin`. |
| 0145 M4.3c, moves `examples/*.shade.ts` | `examples/*.shade.ts`                                                  | `claude/0145-m4-3c-gallery-move`      | Branch not found on `origin`. |
| Pull request #1493                      | `src/compiler/ts/abstract-const.ts` and `abstract-const/`              | `claude/clever-ramanujan-yrfjsq-1301` | Open on 2026-11-24.           |
| Pull request #1498                      | `src/compiler/ts/abstract-const.ts` and `abstract-const/`              | `claude/clever-ramanujan-yrfjsq-1308` | Open on 2026-11-24.           |
| Pushing `do ... while`, deferred        | `core/ir` and `core/backends` (`changes/0114-arrays.md`, A17 (c), A19) | none                                  | Deferred; no branch.          |

Fact: the checks of this subsection ran on 2026-11-24. `git ls-remote --heads origin` did not list the branches
`claude/0146-impl` and `claude/0145-m4-3c-gallery-move`. The REST API listed #1493 and #1498 as open.
Both edit `src/compiler/ts/abstract-const.ts`.

Fact: the two waiting patches (0146 implementation and 0145 M4.3c) wait for the owner's Doorstop review, as their sessions reported.
No branch holds them on `origin`, so the plan cannot check their files by branch.

Decision: a slice does not move a file that an open pull request or a recorded waiting patch edits (rule 10 of section 5).
The orchestrating agent checks the open pull requests before it starts a series.
The check is `gh api repos/{owner}/{repo}/pulls` and `git ls-remote --heads origin`.
Reason: a move under an open edit makes a conflict that the other author cannot resolve by a rebase.

Fact: `src/compiler/ts/abstract-const.ts` is the largest file of `src/`. S9 waits for #1493 and #1498.

## 8. Verification and the per-slice record

Functional verification. Run each check that the slice can reach, from `AGENTS.md#tests`:

1. `bun install --frozen-lockfile`
2. `bun run build`
3. `bun run lint`
4. `bun run format:check`
5. `bun run test`, or the affected set: `bun scripts/affected-tests.ts --base origin/main --run`
6. `bun run gate:boundary`, when the slice touches `runtime`, `core/emit` or `fuse`.
7. `bun run gate:compile`, when the slice touches emit or a backend. It needs Chromium.
8. The emit goldens, without update (section 4).
9. The move-purity check of S0 item a, over the base and the head commit of the pull request:
   `bun run move:check --base origin/main --require`.

   Procedure for a slice:

   1. Start the pull request title with `Move:`.
   2. Add the line `Move: pure` to the message of each commit of the slice.
   3. CI runs the check when the title starts with `Move:` or any commit message line matches.
   4. A commit message line that starts with `Move:` and is not exactly `Move: pure` fails the check.
   5. Without a title and without the line, the check prints a notice and exits 0. It did not run.
   6. The flag `--require` runs the check anyway. An empty range then exits 2.

   Decision D5 applies only to a pull request that has both the title and the lines.
   A slice that changes the plan puts that change in its own pull request.

   Promise. A range passes only when all of these hold:

   - P1. The same declaration texts exist, in the same relative order.
     A declaration is a top-level statement that is not a module link or a directive.
   - P2. Every identifier in every declaration binds to the same declaration instance as before.
     Two declarations with equal text in two files are two instances.
     A global name (key `global:`) and a name from an import that does not resolve (key `import:`)
     have different keys.
     A name that the package imports by its own name resolves to the file of its `exports` entry.
   - P3. Every file that exists on both sides exports the same names, bound to the same declarations.
     The kind of an export is its meaning (type, value or both), not its syntax.
     A type-only re-export of a class, an enum or a constant therefore fails.
   - P4. Every `.ts` file that the range changes, adds or deletes is clean on each side where it exists.
     A file is clean when both of these hold:
     it is in no import cycle of value imports, and every top-level declaration of it is evaluation-free.
     The check fails with `not a clean file path` and the first reason:
     `import cycle: a -> b -> ... -> a` (one shortest cycle through the file, at most 6 nodes),
     or `active unit at line N: <kind and text>` (the first one, and the count of the others).
     A file whose only change is a link statement is a changed file too.
     A move therefore cannot create a cycle, and a file of an existing cycle cannot take part in a pure move.
     Evaluating a clean file does nothing observable, and no read in it can see an uninitialised binding.
     The rules for an evaluation-free declaration are in `scripts/move-purity/evaluation-free.ts`.
     A function, a type, an interface, a `declare` function or constant, a literal `const`, an
     enum of literals, a class without decorators or static blocks, and an `Object.freeze` of a literal are free.
     A call, a `let`, a destructuring, an element access and a `declare module` are not.
     A property read is free only as an identifier chain from an enum or a namespace import.
     Operands of operators and templates, and computed keys, must be primitive values.
     A reference to an object in such a position is active.
     In doubt, a declaration is active.
   - P5. The evaluation order of the modules that exist on both sides is unchanged.
     From every module that exists on both sides, the depth-first order of its value imports
     and re-exports, in source order, must be equal in the base and the head.
     A module that is new in the head does not appear in the compared sequence.
     The type-only flags and the import attributes of a link are kept.
     A new file has no import without bindings.
   - P6. The comments, the directive prologue, the preamble, the test titles and the file classes are kept.
     The free comments of a file keep their order.
     A unit that uses `import.meta` or `__filename`, or a relative path or `__dirname` across a
     directory change, does not move.
     One exception holds for series S11 and S12. A top-level `describe`, `it` or `test` call may move
     between two files that vitest runs, when both are clean test files.
     A test file is clean when it has only evaluation-free declarations and such calls at the top level.
     A hook, a `vi.*` call or any other active statement in the source or the target file refuses the move.
     The source and the target file must also have the same `@vitest-` pragma comments.
     Neither file may be named in a path list of a vitest project of `vitest.config.ts`.
     A test file whose last test moves out changes the set of its dependencies, and the check refuses it.
   - P7. Nothing else changed.
     No document is free.
     A Markdown document may only follow an exact file path that the range renamed.
     It may write the path from the repository root or from its own directory.
     The baselines may not grow (a new entry of the comment baseline may appear).
     `src/__api__/surface.md` may change paths only, and the `KNOWN` list may lose lines only.
     A removed or renamed file may not stay named in a string of a declaration or in any tracked
     text file that is not Markdown.
     A mode change or a symlink is refused.

   Consequence of P4 and P5 for a slice. Both files of a split are clean.
   The old file keeps its re-export or its import of the new file.
   The new file does not import the old file, because that closes a cycle.
   The link to the new file takes a position that keeps the order of the dependencies of the old file.
   A slice that cannot meet these rules is not a pure move.
   Structure work (series S0, row h) makes more of the tree clean over time.

   Report mode. `bun scripts/move-purity.ts --clean-report [--json]` needs no range.
   For `HEAD` it prints, for the non-test files of `src/` and for each directory two levels below `src/`:
   the files, the clean files, the files with active units (and the units), the files in cycles,
   and the list of cycles with their sizes.

   Known gaps. The check does not cover these cases:

   - A package entry (`exports` of `package.json`) that points to a deleted file.
   - The program uses `noLib` and no ambient types. Global names bind by text.
   - An import of an external package that changes how that package loads.
   - A dynamic or computed access that the checker does not resolve to a declaration.
   - A dynamic `import()` or `require` is not an edge of the cycle graph and of the order.
   - A value import that the compiler drops (an import used only as a type) counts as an edge.
   - The check does not load the modules. The order rule of P5 is the only proof of the load order.
   - An unchanged file that gets another resolution of a specifier because a file appeared is not checked.
   - The check reads the base and the head only. It does not read the commits between them.

Document audit. It is separate from the functional checks:

1. `bun run docs:impact`
2. `bun run docs:refs`
3. `bun run precommit`

Each pull request states the following:

- The slice ID (S1 to S13), the file and the responsibility that moved.
- The base commit, and the tool versions (Bun, Node, TypeScript).
- The old and new line counts of each file touched, and the lines that `bake:file-size-baseline` removed.
- The `KNOWN` edges removed, if any.
- The result of the move-purity check: the declarations that changed, appeared or vanished, and the test titles that differ.
  A slice that the check refuses is not a pure move (decision D5).
- The result of the module-surface check (part of the move-purity check), and the import-cycle count before and after.
- Each check that ran: the command, the date and the result.
- Each check that did not run, marked "not run", with the reason.
- Each path-only change to a line of `src/__api__/surface.md`, if any.
- Each deviation from this plan, with its disposition: closed, made part of the plan by an amendment, or open.

The record of the whole plan is the status column of section 6, updated in the pull request of each series.

## 9. Dispositions and open items

### 9.1 Merge of a slice

Decision D5: a pull request of S1 to S13 with the title `Move:` and the commit lines `Move: pure` is merged by the orchestrating agent without a separate "merge" from the owner when both hold.

1. The move-purity check passes.
2. Every required check is green on the current head of the pull request.

Authority: the quotes in section 1.1. Reason: the owner delegated the design of this refactoring, and the check proves the move is pure.

Fact: a slice that the move-purity check refuses is not a pure move. The agent handles it as an ordinary change.
An ordinary change follows `CLAUDE.md`, Merging, and waits for the owner where that section says so.

Fact: this plan does not edit `CLAUDE.md`, Merging. That section lists the pull requests that need no "merge" from the owner.
A pure move is not among them. Until the section is revised, D5 rests on the quoted authority alone.
A revision of that section is a separate pull request that the owner merges.

### 9.2 Dispositions of the first four open items

| No. | Question                                                                                        | Disposition                                                                  |
| --- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | Is a pure-move pull request with green checks approved in advance, or does it wait for "merge"? | Closed by D5. The orchestrating agent merges it after the move-purity check. |
| 2   | Do the naming rules of section 3 become enforced policy tests?                                  | Closed by D4 and S0 item c.                                                  |
| 3   | Are the oversized test files in scope now, or after the sources?                                | Closed by D2. Sources move first. Tests move in the next pull request.       |
| 4   | May S1 move the three `host-*` files to a layer that may import `runtime` and `rhi`?            | Closed by D3. They move up into `src/runtime/host/`.                         |

### 9.3 Open items

| No. | Item                                                                    | Reason                                                                  | Next action                                                                         |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 5   | The exact order of `core/ir`, `core/passes` and `core/backends` (S0 g). | The import graph of `core` is not measured yet.                         | Measure it in the pull request of S0 item g. Record the order and its `KNOWN` list. |
| 6   | The import cycles around the three `host-*` files (D3).                 | No one measured them. The S0 item d check does not exist yet.           | Build S0 item d. Run it before the S1 move.                                         |
| 7   | A revision of `CLAUDE.md`, Merging, for pure moves (D5).                | The section does not list a pure move. The owner merges a change to it. | Draft the revision in its own pull request. The owner merges it.                    |
| 8   | The conflict of S9 with #1493, #1498 and the waiting patches.           | Section 7.1: these edit files that the series would move.               | Check the open pull requests before S9 starts. Start it when they merge.            |

Fact: nothing in this plan reverses an entry of `docs/owner-decisions.md`.
