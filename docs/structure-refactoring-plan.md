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

Fact: the import cycles, the load-time effects and a proposed module tree for `src/compiler/ts` are in
[structure analysis](structure-analysis.md). It is the evidence for S0 item h and series S14 (sections 6.3 and 6.4).

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

0. Remove the banned comments of the file first, in a pull request of its own (decision D13, section 6.5). The tool of step 6 refuses a unit with banned comment lines.
   1. `bun run comments:remove -- <file> --keep-invariants --dry-run` lists the review candidates and the lines.
   2. `bun run comments:remove -- <file> --keep-invariants` writes the file. Without `--keep-invariants`, it also removes the candidates.
   3. `bun run bake:comment-baseline`, then `bun run bake:file-size-baseline`.
   4. Commit with `Change: none, comment removal without behaviour change` and the trailer `Move: comments`.
   5. `bun run move:check --base origin/main --require` passes. It runs the comments mode.
   6. The reviewing sub-agent reports on the candidates (decision D13). Merge, then start step 1.
1. Pick one responsibility of one file of `scripts/file-size-baseline.json`. Choose the group by the shape of the file (`CLAUDE.md`, File size): one class with the types and helpers only it uses; the types that several files use; or the functions of one responsibility. Prefer a group that makes a file of 200 lines or fewer. Do not cut a responsibility to reach the number.
2. Check the open pull requests for the file (section 7.1). Pick another file if one edits it.
3. Open a draft pull request with the slice's scope. Push the first commit at once.
4. List the callers of the code to move. Use `trace_path` and `search_graph` of the code graph.
5. Create the directory named for the module, if it does not exist.
6. Move the declarations with `bun run move:declarations -- --from <source> --to <new file> --move <names> [--closure]` (`scripts/move-declarations.ts`). Run it with `--dry-run` first. Do not retype code, rename a symbol or edit a body.
7. Keep every import of a caller outside the directory working without edit.
8. Leave the test files unedited. The next pull request moves them (decision D2).
9. Run `bun run bake:file-size-baseline`. The numbers go down and no number goes up.
10. When a `KNOWN` edge of `src/layer-policy.test.ts` is gone, delete its line.
11. Run `bun run bake:comment-baseline` only if a comment moved with the code. After step 0 the units carry no banned comment, so it is normally not needed.
12. Run the move-purity check of S0 item a (`bun run move:check --base origin/main --require`). It includes the module-surface check of S0 item f.
13. Run the checks of section 8. If the bundle check of item 6 fails for a budget, follow decision D14 before step 15.
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

| ID  | Status      | Files and responsibility                                                                                                                                      | Exit condition                                                                  |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| S0  | In progress | The tools and checks, items a to h below.                                                                                                                     | Items a and b are merged; items c to h are merged or recorded as open.          |
| S1  | Not started | The 11 importing files of the 32 `KNOWN` edges. `core/host-draw.ts`, `core/host-entry-program.ts` and `core/host-runtime.ts` move up (D3).                    | `KNOWN` is empty; `core` imports no other directory.                            |
| S2  | Not started | `core/ir`: `node.ts` and 3 more files above the limit, then the 1 test file.                                                                                  | No file of `core/ir` is in the baseline.                                        |
| S3  | Not started | `core/backends`: `glsl.ts`, `wgsl.ts`, then their 4 test files.                                                                                               | No file of `core/backends` is in the baseline.                                  |
| S4  | In progress | `core/passes`: 17 files, then 14 test files. The files include `kernel-lower.ts` (split in R5).                                                               | No file of `core/passes` is in the baseline.                                    |
| S5  | Not started | `core` root files (22, then 12 test files) and `core/coverage` (6 files), `core/testing`, `core/debug`, `core/spec-conformance`, `core/libm`.                 | No file of `core` is in the baseline.                                           |
| S6  | In progress | `rhi`: 5 files, then 1 test file.                                                                                                                             | No file of `rhi` is in the baseline.                                            |
| S7  | Not started | `runtime`: 7 files, then 10 test files.                                                                                                                       | No file of `runtime` is in the baseline.                                        |
| S8  | Not started | `compiler/ts/lower`: 16 files, including `function.ts`, `statement.ts` and `expression-call.ts`.                                                              | No file of `compiler/ts/lower` is in the baseline.                              |
| S9  | In progress | `compiler/ts` (rest): 25 files, including `abstract-const.ts` and `structs.ts`.                                                                               | No non-test file of `compiler/ts` is in the baseline.                           |
| S10 | Not started | `language-service`: 7 files, then 11 test files. The files include `diagnostics.ts` and `service.ts`.                                                         | No file of `language-service` is in the baseline.                               |
| S11 | Not started | Test files of `compiler/ts` (58 files, 53,343 lines), after S8 and S9.                                                                                        | No test file of `compiler/ts` is in the baseline.                               |
| S12 | Not started | The 14 test files of `src` root, including `fuse.test.ts` (7,088 lines).                                                                                      | No file of `src` root is in the baseline.                                       |
| S13 | Not started | Facade removal, one pull request per directory, after the series of that directory.                                                                           | No facade without a caller outside its directory; `docs:refs` and `build` pass. |
| S14 | Not started | Cycles of `src/compiler/ts`: steps 1 to 10 of the structure analysis (section 6.4).                                                                           | No cycle of emitted imports in `src/compiler/ts`.                               |
| S15 | Not started | Banned comments: the 41 clean oversized files of D12 first, then each directory in the order of S2 to S10, `Move: comments` pull requests (D13, section 6.5). | `scripts/comment-baseline.json` is empty.                                       |
| S16 | In progress | Evidence citations become symbol anchors: phases P1 to P4 of section 6.6.                                                                                     | No line citation into a `src/` product file; `cited by line path` never fires.  |

### 6.1 Series S0, the tools and checks

Each item is its own pull request.

| Item | Status                    | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| a    | Done in this pull request | `scripts/move-purity.ts` with a policy test. For a base and a head commit it compares the multiset of top-level declarations of `src/`, by a hash of their text from the TypeScript AST. Only `import` declarations, `export ... from` declarations and an added or removed `export` modifier may differ. It reports each declaration that changed, appeared or vanished. It also compares the multiset of test titles (the first-argument strings of `describe`, `it` and `test`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |     |
| b    | Done in this pull request | `scripts/move-declarations.ts` (`bun run move:declarations`). It takes a source file, a new target file and a list of top-level names (`--move`, with `--closure` for the private helpers that only the moved group uses). It moves each unit with the text that the check hashes, writes the imports that the units need into the new file, and leaves a named re-export in the source for each moved export. It adds `export` in the new file to a moved name that the source still uses, and imports it back. It formats both files with Prettier and keeps the unit texts. It runs `checkMove` on the result before it writes, and it writes nothing when the result is not pure (`--keep` writes it for inspection). It creates new files only. It refuses what a pure move cannot do, with the reason: an unclean source, a unit that is not evaluation-free, a moved unit that needs a declaration that stays (an import cycle), a partial multi-declarator statement, a default export, a location-dependent unit, banned comment lines in the moved units, a value import that the move leaves with type uses only, a test, declaration or shade file, a configuration path, and two top-level directories. `--dry-run` prints the plan and the verdict of the check. |     |
| c    | Decision                  | A name policy test. No new file of `src/` is named `utils`, `helpers`, `common`, `misc`, `shared-stuff` or `part-N`, or has a bare numeric suffix. The two existing files (`src/compiler/ts/growing-programs/common.ts` and `src/compiler/ts/optional/helpers.ts`) are its baseline, which only shrinks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| d    | Decision                  | An import-cycle ratchet. The number of file-level import cycles has a baseline that only shrinks. A cycle is a strongly connected component of more than one file. Type-only imports are counted separately. The move-purity check already refuses a slice that makes a cycle or that touches a file of a cycle (P4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| e    | Decision                  | A facade ratchet. A list names the facade files. A facade holds only re-exports. The list only shrinks after S13 begins. A file inside a module's directory never imports its own facade.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| f    | Part of item a            | A module-surface check for a slice. Item a carries it as rule 3 (P3). The set of symbols that files outside a module's directory import from it is the same before and after the slice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| g    | Proposal                  | An extension of `MAY_IMPORT` inside `core`, for example `core/ir` below `core/passes` below `core/backends`, with its own `KNOWN` list. The exact order is fixed by measurement, in its own pull request.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| h    | Proposal                  | Four structure rules, R1 to R4, each a ratchet policy test that is not written yet (section 6.3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |     |

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

Decision D9: D5 requires the commit line `Move: pure` on the head that is merged.
The title alone is not enough, because CI does not run again when a title is edited.
The orchestrating agent reads the output of the `move purity` step on that head before it merges.

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

### 6.3 Series S0 item h, the structure rules

Proposal: four rules. Each is a ratchet policy test, and none is written yet.
Each test is its own pull request. A baseline only shrinks.
The evidence is [structure analysis](structure-analysis.md), sections 4, 7 and 8.

| Rule | Content                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------- |
| R1   | No active top-level unit outside files named `register.ts`, entry files and data files.           |
| R2   | No cycle of emitted imports (the edges that the JavaScript keeps, including side-effect imports). |
| R3   | The files outside a module directory import it only through its `index.ts`.                       |
| R4   | An `index.ts` holds re-exports only.                                                              |

Proposal: a data file is a file whose active units are only table construction.
The pull request of R1 fixes the exact rule.
Reason: of the 638 active units that the analysis found, 393 are empty containers and literal tables, and they are harmless.
The rule must not make a registry of caches a violation. It must still catch the 9 registrations by side effect.

Fact: R2 overlaps S0 item d, which counts cycles of all imports with type-only edges apart.
The pull request of R2 says which baseline it replaces or keeps.

### 6.4 Series S14, the cycles of `src/compiler/ts`

Proposal: S14 is the ten steps of [structure analysis](structure-analysis.md), section 9, one pull request for each.
The status of each step is not started.

- Steps 1 to 7 are mechanical moves of types and pure helpers.
- A file in a cycle is not clean (P4). So these steps are ordinary reviewed changes outside D5, until the cycle is gone.
- Step 7 moves module state with `classFunctionOf`.
- Step 8 splits `lowerLValue`. Step 9 adds a port file for `lowerExpression` and `placeOf`.
  Step 9 needs a design that the owner sees first (an import cycle becomes a load-order rule).
- Step 10 waits for pull request #1498 (section 7.1).

Decision D12: the 41 clean oversized non-test files are the first slices of S1 to S13.
They run in parallel with S14. Reason: a clean file allows a pure move today (decision D10).
Each slice follows section 4 and rule 10 of section 5. A slice does not touch a file that a step of S14 edits at the same time.

Fact: the list is the intersection of `bun scripts/move-purity.ts --clean-report --json` (files with 0 active units and no cycle)
with the non-test entries of `scripts/file-size-baseline.json`. It was measured on `1a864657` on 2026-11-24.
The 41 files hold 36,054 lines.

| Directory              | Files                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/compiler/ts`      | `class-names.ts`, `definite.ts`, `entry-locations.ts`, `host-face.ts`, `link.ts`, `loop-bound.ts`, `optional.ts`, `program-refusals.ts`, `sequence.ts`, `symbols.ts` (10) |
| `src/core` (root)      | `fuse-group.ts`, `fuse-plan.ts`, `gl-compute.ts`, `host-compute.ts`, `host-entry-program.ts`, `host-values.ts`, `oracle.ts`, `reflect.ts`, `semantic-diff.ts` (9)         |
| `src/core/backends`    | `wgsl.ts` (1)                                                                                                                                                             |
| `src/core/builtins`    | `coredef.ts` (1)                                                                                                                                                          |
| `src/core/compute`     | `runner.ts` (1)                                                                                                                                                           |
| `src/core/debug`       | `interp.ts`, `session.ts` (2)                                                                                                                                             |
| `src/core/ir`          | `nodes.ts`, `types.ts` (2)                                                                                                                                                |
| `src/core/passes`      | `const-expr.ts`, `kernel-lower-ir.ts`, `kernel-lower.ts`, `parallel-loop.ts`, `uniform-layout.ts` (5)                                                                     |
| `src/core/testing`     | `fuse-chain.ts`, `libm-cases.ts` (2)                                                                                                                                      |
| `src/language-service` | `completions.ts`, `hover.ts`, `service.ts` (3)                                                                                                                            |
| `src/rhi`              | `cpu.ts`, `rhi.ts`, `webgl2.ts` (3)                                                                                                                                       |
| `src/runtime`          | `gl-draw.ts`, `gl.ts` (2)                                                                                                                                                 |

Blocked: 9 of the 41 files are cited by line in `src/core/coverage/`, so the move-purity guard refuses a move of them (section 8, item 9, line citations).
They stay blocked until their citations become symbol anchors: `src/core/gl-compute.ts` (17 citing segments), `src/core/reflect.ts` (2),
`src/core/backends/wgsl.ts` (12), `src/core/compute/runner.ts` (1), `src/core/ir/nodes.ts` (1), `src/core/ir/types.ts` (2),
`src/rhi/webgl2.ts` (131), `src/runtime/gl-draw.ts` (93) and `src/runtime/gl.ts` (34).
Measured with `bun scripts/move-purity.ts --clean-report` on `fda5e901`, 2026-11-24.

Fact: the 10 + 9 + 1 + 1 + 1 + 2 + 2 + 5 + 2 + 3 + 3 + 2 rows add up to 41.
The other 82 oversized non-test files are in a cycle (34) or hold an active unit and no cycle (48).
Some of the 41 are large: `src/core/passes/kernel-lower.ts` has 2,094 lines and `src/compiler/ts/host-face.ts` has 2,006 lines.
A clean file can still need a decomposition (decision D7) when one unit passes 400 lines.

### 6.5 Series S15, the banned comments

Fact: the tool `scripts/move-declarations.ts` refused all five clean oversized files that pull request #1525 tried.
Each refusal named banned comment lines in the units to move: 33, 11, 62, 3 and 3 lines.
A new file is not in `scripts/comment-baseline.json`, so `src/comment-policy.test.ts` fails a new file that carries a banned comment.
So a file needs its comments removed before its declarations can move.

Fact: `bun scripts/bake-comment-baseline.ts` measured on `HEAD` (`60e386b3`, 2026-11-24): the baseline holds 52,644 banned comment lines in 967 files.
`src/comment-policy.test.ts` counts the same lines. The 41 files of D12 hold 5,908 of them.

Decision D13: each file loses its banned comments before its declarations move.
Authority: `CLAUDE.md`, Comments (the owner's rule of 2026-11-17: "99% 가까운 금지로"; an existing comment goes in a pull request for its directory; a test or an assert holds an invariant before its comment goes).

1. A comment-removal pull request has the title `Move: ...` and a commit line `Move: comments`.
   `bun scripts/move-purity.ts` runs the comments mode on it (section 8, item 9a).
2. The orchestrating agent merges it under the conditions of D5, and one more.
   The conditions of D5 are: the check passes on the merged head, every required check is green,
   and the orchestrating agent ran the checker of `main` on the range.
3. The added condition: an independent reviewing sub-agent read the removed comments of the review-candidate list
   and reported that none states an invariant that no test or assert holds.
4. A comment that does state one stays (`--keep-invariants`).
   An ordinary pull request then adds the test or the assert first, and removes the comment (`CLAUDE.md`, Comments).

Reason: the token comparison proves that the code did not change.
Only the judgement about invariants is not mechanical.
The review candidates are the comments with invariant-like words (`scripts/remove-comments/invariant-words.ts`).
A comment without such a word is not proof that it states no invariant. The reviewing sub-agent reads the list and the diff.

Proposal: S15 runs in this order.

1. The 41 clean oversized files of D12, each before its slice. The banned lines of each are in the second table below.
2. Then each directory in the order of S2 to S10: its sources, then its tests.
3. Then the rest (`src/cli`, `src/random`, `src/core/coverage` and the other directories of the first table).

A pull request can hold one file or one directory. The size of the diff is the banned lines of the table.
`src/language-service/hover.ts` has 472 and `src/core/builtins/coredef.ts` has 1.

Fact: the banned comment lines on `HEAD`, by the directories of the clean report (`directoryOf` of `scripts/move-purity/clean-report.ts`).

| Directory                   | Files | Non-test lines | Test lines | Total  |
| --------------------------- | ----- | -------------- | ---------- | ------ |
| `src` (root files)          | 54    | 240            | 1663       | 1903   |
| `src/cli`                   | 13    | 223            | 73         | 296    |
| `src/compiler/ts`           | 327   | 11957          | 6443       | 18400  |
| `src/core` (root files)     | 136   | 6299           | 1871       | 8170   |
| `src/core/backends`         | 31    | 1771           | 1274       | 3045   |
| `src/core/builtins`         | 5     | 95             | 0          | 95     |
| `src/core/compute`          | 2     | 199            | 89         | 288    |
| `src/core/coverage`         | 8     | 232            | 0          | 232    |
| `src/core/debug`            | 18    | 732            | 388        | 1120   |
| `src/core/diagnostics`      | 8     | 140            | 21         | 161    |
| `src/core/fp64`             | 11    | 426            | 249        | 675    |
| `src/core/ir`               | 58    | 916            | 535        | 1451   |
| `src/core/libm`             | 6     | 18             | 222        | 240    |
| `src/core/passes`           | 159   | 5826           | 2060       | 7886   |
| `src/core/spec-conformance` | 9     | 59             | 674        | 733    |
| `src/core/testing`          | 24    | 1095           | 258        | 1353   |
| `src/language-service`      | 50    | 2320           | 1682       | 4002   |
| `src/random`                | 1     | 5              | 0          | 5      |
| `src/rhi`                   | 11    | 615            | 59         | 674    |
| `src/runtime`               | 36    | 1144           | 771        | 1915   |
| Total                       | 967   | 34,312         | 18,332     | 52,644 |

Fact: the banned comment lines of the 41 clean oversized files of D12 (`HEAD`, 2026-11-24). The lines of the file follow the banned lines.

| File                                  | Banned lines | Lines  |
| ------------------------------------- | ------------ | ------ |
| `src/compiler/ts/class-names.ts`      | 103          | 593    |
| `src/compiler/ts/definite.ts`         | 37           | 402    |
| `src/compiler/ts/entry-locations.ts`  | 69           | 445    |
| `src/compiler/ts/host-face.ts`        | 224          | 2006   |
| `src/compiler/ts/link.ts`             | 216          | 1574   |
| `src/compiler/ts/loop-bound.ts`       | 269          | 1013   |
| `src/compiler/ts/optional.ts`         | 99           | 579    |
| `src/compiler/ts/program-refusals.ts` | 126          | 541    |
| `src/compiler/ts/sequence.ts`         | 100          | 679    |
| `src/compiler/ts/symbols.ts`          | 136          | 405    |
| `src/core/backends/wgsl.ts`           | 203          | 632    |
| `src/core/builtins/coredef.ts`        | 1            | 721    |
| `src/core/compute/runner.ts`          | 199          | 698    |
| `src/core/debug/interp.ts`            | 255          | 1077   |
| `src/core/debug/session.ts`           | 64           | 679    |
| `src/core/fuse-group.ts`              | 152          | 513    |
| `src/core/fuse-plan.ts`               | 95           | 533    |
| `src/core/gl-compute.ts`              | 159          | 1077   |
| `src/core/host-compute.ts`            | 187          | 767    |
| `src/core/host-entry-program.ts`      | 77           | 501    |
| `src/core/host-values.ts`             | 96           | 452    |
| `src/core/ir/nodes.ts`                | 10           | 945    |
| `src/core/ir/types.ts`                | 44           | 1177   |
| `src/core/oracle.ts`                  | 198          | 915    |
| `src/core/passes/const-expr.ts`       | 177          | 554    |
| `src/core/passes/kernel-lower-ir.ts`  | 201          | 858    |
| `src/core/passes/kernel-lower.ts`     | 259          | 2094   |
| `src/core/passes/parallel-loop.ts`    | 210          | 1411   |
| `src/core/passes/uniform-layout.ts`   | 173          | 528    |
| `src/core/reflect.ts`                 | 136          | 1130   |
| `src/core/semantic-diff.ts`           | 74           | 593    |
| `src/core/testing/fuse-chain.ts`      | 213          | 1336   |
| `src/core/testing/libm-cases.ts`      | 115          | 857    |
| `src/language-service/completions.ts` | 94           | 433    |
| `src/language-service/hover.ts`       | 472          | 1539   |
| `src/language-service/service.ts`     | 98           | 605    |
| `src/rhi/cpu.ts`                      | 88           | 1251   |
| `src/rhi/rhi.ts`                      | 117          | 442    |
| `src/rhi/webgl2.ts`                   | 176          | 1768   |
| `src/runtime/gl-draw.ts`              | 128          | 1207   |
| `src/runtime/gl.ts`                   | 58           | 524    |
| Total                                 | 5,908        | 36,054 |

Fact: a first run of `bun scripts/remove-comments.ts` on three of these files (a scratch worktree, 2026-11-24):

| File                            | Banned lines before | After with `--keep-invariants` | After without it | Review candidates |
| ------------------------------- | ------------------- | ------------------------------ | ---------------- | ----------------- |
| `src/runtime/gl-draw.ts`        | 128                 | 5                              | 0                | 3                 |
| `src/core/reflect.ts`           | 136                 | 70                             | 0                | 10                |
| `src/language-service/hover.ts` | 472                 | 189                            | 0                | 15                |

Fact: the comments mode and the helper left the checks green on each of the three files (section 8, item 9a).
After the removal on `src/runtime/gl-draw.ts`, `bun scripts/move-declarations.ts` moved `GlSamplerImpl` and `COMPARISONS` into a new file, and the pure check passed on that commit.

### 6.6 Series S16, evidence citations become symbol anchors

Fact: `bun scripts/move-purity.ts --clean-report` and a count of the evidence strings of `src/core/coverage/*.ts` on `origin/main` (`e735e635`, 2026-11-24) found 1,809 evidence segments that cite `path:line` or `path:line-line`.
1,414 of them cite `src/` product files. Line citations block declared moves on 52 source files.
A sample found that about half of the citations already point at the wrong line, because `checkEvidence` checks only that the file exists and the line is in range.

Decision: an evidence segment may cite a declaration by symbol, so that a move does not shift it.
The grammar is in `scripts/symbol-anchors/grammar.ts`. Forms: `path#Symbol`, `path#Class.method` (also `Interface.member`, `Enum.member`, and `CONST.key` for a top-level `const` with an object literal), and `path#Symbol~"needle"`, where the needle is a literal substring of the declaration text.
Several anchors share one path and are joined by `|` (`path#A|B.c`). A `.test.ts` file takes one form only, a quoted title: `path#"title substring"`. A file that is not `.ts` keeps `path` or `path:line`.
The resolver (`scripts/symbol-anchors/resolve.ts`) follows `export { X } from` and `export * from`. It does not guess a file when the original file is missing. An anchor follows a declaration that moved into the directory named for its file (for `a.ts`, the directory `a/`): when `path#Symbol` is neither declared in nor re-exported by `path`, the resolver looks for one top-level declaration in the `.ts` files of that directory, recursively, except test, `.d.ts`, `.shade.ts` and `.spec.ts` files. The order is the file, its re-exports, then the directory. A named re-export of the symbol ends the search, even when its target lacks the symbol. The directory is searched only for the cited path, never for a file reached through a re-export. Two parts that declare the name give `symbol-ambiguous`. The code is `scripts/symbol-anchors/module-directory.ts`.
`scripts/move-purity/line-citations.ts` counts line citations only, so an anchor never blocks a move.

| Phase | Content                                                                                    | Status           |
| ----- | ------------------------------------------------------------------------------------------ | ---------------- |
| P1    | The resolver and a checker that accepts both forms. No row changes.                        | In progress      |
| P2    | A converter that turns each line citation into an anchor and writes a review queue.        | Done when merged |
| P3    | Migrate the rows in batches. A person reads each batch of the queue.                       | Not started      |
| P4    | `checkEvidence` refuses a line citation into a `src/` product file. Test files keep lines. | Not started      |

Fact: `scripts/convert-evidence.ts` (`bun run evidence:convert`) is phase P2. `--report` measured 1,791 line-cited segments in `src/core/coverage/*.ts` at `f35c3859` on 2026-11-24 (the 1,809 above were counted on `e735e635`).
Counts by class: `exact` 598, `inside-large` 638, `between` 164, `out-of-bounds` 0, `test-file` 17, `non-ts` 351, `outside-src` 23 (a non-test `.ts` file outside `src/`; this class is not in the P2 brief).
Of the 598 `exact` segments, 192 have `no-row-word-nearby` and go to the review queue. `--write --only exact` would rewrite 406 segments in 6 coverage files.
The review queue holds 994 segments. A write on a copy of the tree rewrote the 406 segments, `checkEvidence` accepted the result, and a second run changed nothing. No row of the tree changed in P2.

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

Functional verification. A slice (a range that declares `Move: comments` or `Move: pure`) runs these checks locally.
Items 2, 5, 7 and 8 are CI work for a slice (item 10), and item 6 with one exception. Do not run them locally:
the affected set took 11 minutes for one comment-removal slice, and CI runs the pinned unit shards on every slice.

1. `bun install --frozen-lockfile`
2. CI runs `bun run build`. Locally run `bunx tsc --noEmit -p tsconfig.json`.
3. `bun run lint`
4. `bun run format:check`
5. The tests that read the text of other files, not the affected set:
   `bunx vitest run src/core/spec-conformance 'src/*-policy.test.ts' src/self-contained.test.ts src/doc-references.test.ts`.
   Reason: removing comments from `src/runtime/gl-draw.ts` broke `src/core/spec-conformance/capability-coverage.test.ts`,
   because data rows cite that file by line number. A later slice that moves code can break a row the same way.
6. CI runs `bun run gate:boundary` (the `runtime bundle boundary` step of `quality`).
   Exception: a slice that splits a file of a bundle runs `bun scripts/bundle-boundary.ts` locally before step C is pushed (decision D14).
7. CI runs `bun run gate:compile` for `Move: pure`, and not for `Move: comments`.
8. CI runs the emit goldens inside the unit shards.
9. The move-purity check of S0 item a, over the base and the head commit of the pull request:
   `bun run move:check --base origin/main --require`.

   Procedure for a slice:

   1. Start the pull request title with `Move:`.
   2. Add the line `Move: pure` to the message of at least one commit of the range.
      The check judges the net difference between the merge base and the head.
   3. CI runs the check when the title starts with `Move:` or any commit message line matches.
   4. A commit message line that starts with `Move:` and is not exactly `Move: pure` fails the check.
   5. Without a title and without the line, the check prints a notice and exits 0. It did not run.
   6. The flag `--require` runs the check anyway. An empty range then exits 2.

   Decision D5 applies only to a pull request whose merged head has the commit line `Move: pure`.
   The title alone is not enough, because CI does not run again when a title is edited.
   The orchestrating agent reads the output of the `move purity` step on that head before it merges.
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
     An edge of the graph is what loads at run time.
     A side-effect import is an edge.
     An `import` with bindings is an edge only when TypeScript keeps it, that is, when at least one
     binding is referenced in a value position of the file.
     An `export ... from` is an edge when it re-exports at least one value, and `export *` is an edge.
     The repository sets no `verbatimModuleSyntax`.
     TypeScript, esbuild and Bun agree on these forms: a side-effect import loads the module,
     an import with a binding that is used as a value loads it, and an import whose bindings are
     unused or used only as types is dropped.
     They disagree on `import {} from` and `export {} from` (Bun keeps them, tsc and esbuild drop them)
     and on `export { Type } from` (Bun fails at load).
     The check refuses the disputed forms (see the further refusals).
     A test reads the `tsconfig` files and fails when such an option appears.
     Cycles (P4) and order (P5) use this one edge definition.
     The classifier is an allow-list by syntax kind, in `scripts/move-purity/accepted-kinds.ts`.
     A kind that is not in the list is active, and the reason is the kind name.
     A `using` declaration, an `import x = ...` and an `import x = require(...)` are active.
     The rules for an evaluation-free declaration are in `scripts/move-purity/evaluation-free.ts`.
     Accepted statement kinds: `ClassDeclaration`, `EnumDeclaration`, `ExportAssignment`, `ExportDeclaration`, `FunctionDeclaration`, `InterfaceDeclaration`, `TypeAliasDeclaration`, `VariableStatement`.
     Accepted expression kinds: `ArrayLiteralExpression`, `ArrowFunction`, `AsExpression`, `BigIntLiteral`, `BinaryExpression`, `CallExpression`, `ClassExpression`, `ConditionalExpression`, `FalseKeyword`, `FunctionExpression`, `Identifier`, `NewExpression`, `NoSubstitutionTemplateLiteral`, `NonNullExpression`, `NullKeyword`, `NumericLiteral`, `ObjectLiteralExpression`, `OmittedExpression`, `ParenthesizedExpression`, `PrefixUnaryExpression`, `PropertyAccessExpression`, `RegularExpressionLiteral`, `SatisfiesExpression`, `StringLiteral`, `TemplateExpression`, `TrueKeyword`, `TypeAssertionExpression`, `TypeOfExpression`, `VoidExpression`.
     Accepted class member kinds: `Constructor`, `GetAccessor`, `IndexSignature`, `MethodDeclaration`, `PropertyDeclaration`, `SemicolonClassElement`, `SetAccessor`.
     Accepted object member kinds: `GetAccessor`, `MethodDeclaration`, `PropertyAssignment`, `SetAccessor`, `ShorthandPropertyAssignment`.
     A `new Map` or `new WeakMap` takes no argument, or one array of two-element array entries.
     A `new Set` or `new WeakSet` takes no argument, or one array of elements.
     An entry element is a primitive, a function, or a name of a function, a class or an enum.
     No entry is an object, a spread or another name, because the constructor reads the entries.
     `Object.freeze` takes one object or array literal.
     A function, a type, an interface, a `declare` function or constant, a literal `const`, an
     enum of literals, a class without decorators or static blocks, and an `Object.freeze` of a literal are free.
     A call, a `let`, a destructuring, an element access and a `declare module` are not.
     A property read is free only as an identifier chain from an enum or a namespace import.
     Operands of operators and templates, and computed keys, must be primitive values.
     A reference to an object in such a position is active.
     In doubt, a declaration is active.
   - P5. The evaluation order of the modules that exist on both sides is unchanged among the modules that are not clean.
     From every module that exists on both sides, the depth-first order of its edges
     in source order, taken over the modules that are not clean, must be equal in the base and the head.
     A module is not clean when it has an active unit or is in an import cycle.
     The order among clean modules cannot be observed, so it is not compared.
     Every changed file is clean (P4), so a module that a slice edits is never one that is compared.
     A module that is new in the head does not appear in the compared sequence.
     The type-only flags and the import attributes of a link are kept.
     A new file has no import without bindings.
   - P6. The comments, the directive prologue, the preamble, the test titles and the file classes are kept.
     The free comments of a file keep their order.
     A unit that uses `import.meta` or `__filename`, or a relative path or `__dirname` across a
     directory change, does not move.
     A range that moves a test call fails with `test code moved` unless the CLI gets `--allow-test-moves`.
     CI does not pass the flag.
     With the flag, and only then, one exception holds for series S11 and S12. A top-level `describe`, `it` or `test` call may move
     between two files that vitest runs, when both are clean test files.
     A test file is clean when it has only evaluation-free declarations and such calls at the top level.
     A `describe` call, `describe.each(...)(...)` included, is such a call only when its callback body
     holds, recursively, only `it` and `test` calls, nested `describe` calls, the hooks `beforeEach`,
     `afterEach`, `beforeAll` and `afterAll`, and evaluation-free declarations.
     The table of `.each` must be evaluation-free, and the arguments of `runIf` and `skipIf` must be primitive values.
     The callback of a suite call must be an inline arrow function or function expression (`suite callback is not inline`).
     An options argument is a number or an object literal of primitive properties without accessors.
     Other code in the body is `collection-time code in describe`.
     The source and the target file must hold the same free comments that contain `Verifies:` or `Implements:`.
     A hook, a `vi.*` call or any other active statement in the source or the target file refuses the move.
     The source and the target file must also have the same `@vitest-` pragma comments.
     Neither file may be named in a path list of a vitest project of `vitest.config.ts`.
     A test file whose last test moves out changes the set of its dependencies, and the check refuses it.
   - P7. Nothing else changed.
     No document is free.
     A Markdown document may only follow an exact file path that the range renamed.
     It may write the path from the repository root or from its own directory.
     Neither baseline may grow: the number of entries, each entry and the sum stay equal or fall.
     A new file with banned comments is therefore not a pure move, as in `src/comment-policy.test.ts`.
     `src/__api__/surface.md` may change paths only, and the `KNOWN` list may lose lines only.
     A removed or renamed file may not stay named in a string of a declaration or in any tracked
     text file that is not Markdown.
     A mode change or a symlink is refused.
     A path of the checks may not change (`a pure move may not change the checks path`): `scripts/move-purity/`,
     `scripts/move-purity.ts`, `.github/`, `scripts/*-policy.ts`, `scripts/*-baseline.json` other than the two baselines,
     `vitest.config.ts`, `tsconfig*.json`, `eslint.config.mjs` and `package.json`.
   - Further refusals, each a finding of the check:
     a changed or added file may not hold an import or an export with an empty binding list and a specifier
     (`empty import or export from path`);
     a changed or added file may not re-export a type without `type` (`type re-exported without type path`),
     so a slice writes `export type { X } from` or `export { type X } from`;
     a changed `.ts` file that git lists and whose text cannot be read fails (`unreadable file path`);
     a decorator on a parameter of any function-like class member makes the class active;
     a namespace import is keyed by its module, not by its export names;
     a changed file may not gain an `export *` statement (`export * added`, so facades use named re-exports);
     a changed file may not hold a non-`type` import that has no value reference
     (`value import used only as a type path`, so a slice writes `import type`);
     a unit moves only between files under the same top-level directory (`src/` to `src/`);
     a changed, added or deleted `.shade.ts` file is refused, since the check does not model shaders
     (`shade files do not take part in a pure move`);
     a file whose repository path is written in `tsconfig*.json`, `eslint.config.mjs`, `vitest.config.ts`,
     `package.json` or a `scripts/*.json` that is not a baseline may not gain or lose units
     and may not be added or deleted (`path is named in <config>`).

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
   It also lists each clean file that evidence rows cite by line, with the number of citing segments.
   The JSON rows of `files` carry `citedByLine` and `citingSegments`.

   Line citations. Rows of `src/core/coverage/*.ts` cite evidence as `path:line` or `path:line-line`.
   A move shifts these lines, and a citation goes stale without a failure, or the test
   "every evidence citation resolves" fails when the line passes the end of the file.
   The checker reads the evidence strings on the head side. It refuses the range, with the finding
   `cited by line path`, when a changed, deleted or renamed `.ts` path is cited by line.
   The finding names the file, the number of citing segments and one row location.
   A new file that no row cites is not refused. `scripts/move-declarations.ts` refuses a cited source
   before it plans, with the same text. The guard applies under `--require` too.

   Known gaps. The check does not cover these cases:

   - Another file can depend on the line numbers of a moved file. The guard reads only the evidence
     strings of `src/core/coverage/`. A line number kept in another file or document is not found. The check does not cover these cases:

   - A package entry (`exports` of `package.json`) that points to a deleted file.
   - Glob-keyed configuration is not modelled: a new file under an ESLint `ignores` or a tsconfig `exclude` glob,
     or under `!**/core/coverage` of the `files` of `package.json`.
   - External packages are not in the graph.
   - Test projects with `isolate: false` share module state.
   - The program uses `noLib` and no ambient types. Global names bind by text.
   - An import of an external package that changes how that package loads.
   - A dynamic or computed access that the checker does not resolve to a declaration.
   - A dynamic `import()` or `require` is not an edge of the cycle graph and of the order.
   - The check does not load the modules. Nothing proves a load.
   - The behaviour of the external packages is assumed identical on both sides.
   - The order of the hooks of a `describe` across files in a project with `isolate: false` is not modelled.
   - An unchanged file that gets another resolution of a specifier because a file appeared is not checked.
   - The check reads the base and the head only. It does not read the commits between them.

9a. The comments mode of the same checker, for a range with the line `Move: comments` (decision D13):
`bun run move:check --base origin/main --require`. It reads the files that changed and nothing else.

What a pass proves:

- Only tracked `.ts` files of `src/` changed, and `scripts/comment-baseline.json` and `scripts/file-size-baseline.json`, whose entries only shrank or went.
  No file was added, deleted, renamed or given a new mode. No path of the checks, no shade file and no generated file changed.
- The syntax tree of each changed file is the same: the node kinds, their depth and the text of each leaf. Comments are left out, JSDoc included.
  A line break that a comment held and that cut a restricted production (`return` and its value) is a changed tree, so it fails.
- The directive prologue, the shebang and the byte order mark are the same.
- Each comment of the head exists in the base, in the same order, with the same text and at the same place among the code leaves.
- No changed `.ts` file is cited by line in an evidence string of `src/core/coverage/` (item 9, line citations).
  `scripts/remove-comments.ts` refuses such a file with the same text.
  So no comment was added, reworded or moved. The indentation of the lines of a block comment is not compared.
- Each removed comment is one that `scripts/comment-policy.ts` counts as banned.
  A marker, a `Why:` comment, the doc comment of a definition of `src/__api__/surface.md` and the protected comments
  (`scripts/move-purity/protected-comments.ts`: `@vite-ignore`, `__PURE__`, `prettier-ignore`, `format:semicolons skip`, a triple-slash directive and the like) stay.
  A comment that the policy does not see, such as one right after the `(` of a call, is no banned line. The comments mode accepts its removal unless it is a marker, a `Why:` comment or protected. The report counts those lines apart.

What a pass does not prove:

- It does not judge whether a removed comment mattered to a reader. The allowed kinds and the review of decision D13 cover that.
- The check of a line break is a check of the tree. Prettier-clean code is assumed: a file that Prettier would reflow with a changed token (a comma, a parenthesis) fails.
- A comment that stays is compared by text and by its place among the code leaves, so a swap of two comments fails. A comment that moves within the same two tokens passes.
- The checks of the pure mode (evaluation order, import graph, test titles) do not run. They have nothing to read: no declaration moved.
- The helper `scripts/remove-comments.ts` runs this comparison on its own result, so it proves the same thing and no more.

10. What CI runs for a slice. Reason: the owner said on 2026-11-24 "CI 무시하는게 좋아보여요. 지금 보니까 코드 변경이 없는데도 너무 무거운 작업을 진행하는건 비용효율적이지 않습니다" (CI looks worth ignoring; running such heavy jobs when no code changes is not cost-effective).
    The owner answered the proposal of a lighter path with "좋은 방향으로 그러면" (then go in a good direction).

    The `change scope` job of `.github/workflows/ci.yml` reads the `move` output of `.github/actions/change-scope/action.yml`.
    The output is `comments` or `pure` only when the job runs
    `bun scripts/move-purity.ts --base "origin/$BASE" --require --title "$PR_TITLE" --json`, the command exits 0,
    and the JSON has `pure: true` and `declared` equal to that mode. Every other result is `none`.
    The job does not fail on a range that is not pure. The `move purity` step of `quality` reports that.

    A draft pull request runs no gate (owner request, 2026-11-24: "CI랑 관계없이 로컬에서 먼저 처리한 다음, 머지 직전이 아니라면 CI는 넘기는 방법은 안될까요"). Work is verified locally.
    CI runs once the pull request is marked ready for review, and on each push while it is ready.

    | Job                                                 | documents | `Move: comments` | `Move: pure`                 | code (and every push to `main`) |
    | --------------------------------------------------- | --------- | ---------------- | ---------------------------- | ------------------------------- |
    | `change scope`                                      | runs      | runs             | runs                         | runs                            |
    | `source and policy checks`                          | runs      | runs             | runs                         | runs                            |
    | `pinned TypeScript unit shards` (3)                 | runs      | runs             | runs                         | runs                            |
    | `typecheck + unit` (required)                       | runs      | runs             | runs                         | runs                            |
    | `traceability (Doorstop)` (required)                | runs      | runs             | runs                         | runs                            |
    | `TypeScript 5 unit shards` (3) and its check        | skipped   | skipped          | skipped                      | runs                            |
    | `TypeScript 6 unit shards` (3) and its check        | skipped   | skipped          | skipped                      | runs                            |
    | `compile gate (Tint + WebGL2)` (required)           | skipped   | skipped          | runs                         | runs                            |
    | `user journeys (packed tarball, WebGPU)` (required) | skipped   | skipped          | runs                         | runs                            |
    | `render gate (WebGPU + pixel golden)`               | skipped   | skipped          | skipped                      | runs                            |
    | `perf gate (instrument, SwiftShader)`               | skipped   | skipped          | skipped                      | runs                            |
    | `package-smoke.yml`: build, then smoke              | not run   | skipped          | one smoke, Linux and Node 24 | five smokes                     |
    | `downstream.yml`: `TypeNN candidate (build + CPU)`  | not run   | skipped          | runs                         | runs                            |

    A skipped required check reports success to the ruleset, as it does for a documents-only pull request.
    `package-smoke.yml` and `downstream.yml` cannot read a job of `ci.yml`.
    Each has its own `scope` job that calls the same action. Their path filters keep documents-only pull requests out.

    Limits:

    - A skipped gate runs on the push to `main` after the merge (`on.push.branches: [main]` of each workflow).
      A run on `main` is never cancelled by a later push: `concurrency` of the three workflows sets
      `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`.
      Each commit of `main` also has its own `concurrency` group (`github.sha`), because GitHub replaces a waiting run of a group with a newer one.
      Rule 13.4 and change `0147` record this exception.
      A failure there marks the commit on `main` red and notifies the account that merged and the watchers of Actions.
      No workflow opens an issue or reverts the commit.
    - A pull request runs its own copy of the workflow, the action and the checker. A range could lie to skip gates.
      A range that edits `.github/` or `scripts/move-purity/` is not pure, but the orchestrating agent still runs
      the checker of `main` before a merge (section 9.1, decision D5).
    - The unit shards of the pinned TypeScript version run in every scope. Before the merge they run the selection of `scripts/affected-tests.ts`, not the whole suite.
      A comment removal can still break a test that reads the text of a file. If the selection misses that test, it fails on `main`, where the full suite runs.

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

Decision D5: a pull request of S1 to S13 with the title `Move:` and at least one commit with the line `Move: pure` is merged by the orchestrating agent without a separate "merge" from the owner when both hold.

1. The move-purity check passes.
2. Every required check is green on the current head of the pull request.

Process rule of D5. A pull request runs its own copy of the workflow and of the checker.
Before it merges under D5, the orchestrating agent runs the checker of `main` on the range of the pull request.
Run these steps from the repository:

1. `git worktree add <tmp> origin/main`
2. `bun <tmp>/scripts/move-purity.ts --base origin/main --head <pr head> --require`
3. Merge only when the output says `pure`.

The option `--repo <path>` runs the checker from another checkout against that repository.

Decision D13 (section 6.5) adds a condition for a pull request with the line `Move: comments`: a reviewing sub-agent reads the removed review candidates first.

Decision D14: a rise of a budget of `scripts/bundle-budget.json` that a `Move: pure` range causes merges without a separate "merge" from the owner.
The rise goes in a pull request of its own, since a `Move: pure` range cannot change that file.
The conditions and the two limits are in `CLAUDE.md`, Merging: 0.2% for one pull request, and 1% above the number at `c4a12d3f`.
The orchestrating session measures the rise and merges the budget pull request (`docs/structure-slice-playbook.md`, The bundle budget).
Authority: the owner's answer of 2026-11-24 ("추천") to the rule that the conversation recommended.

Fact, measured on 2026-11-24 with `bun scripts/bundle-boundary.ts`: `src/runtime/runtime.ts` loads `src/runtime/gl.ts` with a dynamic `import()`, and the check builds one chunk.
Bun then gives a module below that import a lazy-init wrapper when the module holds top-level state or imports a wrapped module.
A wrapper costs 10 to 25 gzip bytes of `typeshade/runtime`. The split build did not grow.
The split of `src/rhi/webgl2.ts` (#1578) raised the single-file size from 178,681 to 178,749 bytes, over the budget of 178,698 by 51.
A local branch with seventeen new files from `src/runtime/gl.ts` and `src/runtime/gl-draw.ts` measured 178,897 on `48df2cc9`, a rise of 216.

Cost of D14: a budget set to the measured size has no headroom. The next rise from any cause needs a budget pull request or the owner.

Decision D11: moving tests is an ordinary reviewed change for now, in S11 and S12 too.
The flag `--allow-test-moves` exists for local use, and CI does not pass it.

Authority: the quotes in section 1.1. Reason: the owner delegated the design of this refactoring, and the check proves the move is pure.

Fact: a slice that the move-purity check refuses is not a pure move. The agent handles it as an ordinary change.
An ordinary change follows `CLAUDE.md`, Merging, and waits for the owner where that section says so.

Fact: `CLAUDE.md`, Merging, lists the pull requests that need no "merge" from the owner.
Since pull request #1529 (`d14bebb4`) that list names a pull request that declares `Move: pure` or `Move: comments` and that `scripts/move-purity.ts` accepts.
D5 therefore rests on `CLAUDE.md`, Merging, and the owner's approval of 2026-11-24 ("승인") recorded there.

### 9.2 Dispositions of the first four open items

| No. | Question                                                                                        | Disposition                                                                  |
| --- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | Is a pure-move pull request with green checks approved in advance, or does it wait for "merge"? | Closed by D5. The orchestrating agent merges it after the move-purity check. |
| 2   | Do the naming rules of section 3 become enforced policy tests?                                  | Closed by D4 and S0 item c.                                                  |
| 3   | Are the oversized test files in scope now, or after the sources?                                | Closed by D2. Sources move first. Tests move in the next pull request.       |
| 4   | May S1 move the three `host-*` files to a layer that may import `runtime` and `rhi`?            | Closed by D3. They move up into `src/runtime/host/`.                         |

### 9.3 Open items

| No. | Item                                                                    | Reason                                                               | Next action                                                                         |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 5   | The exact order of `core/ir`, `core/passes` and `core/backends` (S0 g). | The import graph of `core` is not measured yet.                      | Measure it in the pull request of S0 item g. Record the order and its `KNOWN` list. |
| 6   | The import cycles around the three `host-*` files (D3).                 | No one measured them. The S0 item d check does not exist yet.        | Build S0 item d. Run it before the S1 move.                                         |
| 7   | A revision of `CLAUDE.md`, Merging, for pure moves (D5).                | Done in pull request #1529 (`d14bebb4`): the section lists the move. | None. Closed.                                                                       |
| 8   | The conflict of S9 with #1493, #1498 and the waiting patches.           | Section 7.1: these edit files that the series would move.            | Check the open pull requests before S9 starts. Start it when they merge.            |

Items 9 to 16 record the files that the first slice wave stopped on.
Each line count was measured on `origin/main` at `4c1df624` with `git show origin/main:<file> | wc -l`.
A reason labelled "reported" is the report of the session. The repository does not prove it.
The owner approved on 2026-11-25 ("추천안대로", relayed by the orchestrating session) that these reasons go into the open items.

- Item 9: `src/compiler/ts/sequence.ts`, 679 lines. Step A not started.
  Reported by session D on 2026-11-24: a comment about `select` contradicts the code, a possible violation of Rule 7.9.
  Next action: establish which of the two is right. Read Rule 7.9 of `docs/language-design.md`, the code and its tests before any comment is removed.
  If the code is wrong, that is a bug for the owner to see.
- Item 10: `src/compiler/ts/program-refusals.ts`, 531 lines. Step A merged in #1575 for part of the file. Steps B and C not started.
  Reported by session D on 2026-11-24: about 25 behaviours have no test.
  Verified in the repository: `git ls-remote origin slice/program-refusals-A` shows `6d7eb28a`. No pull request was checked for that branch.
  Next action: write the tests for the 25 behaviours, then run steps B and C.
- Item 11: `src/compiler/ts/link.ts`, 1,132 lines. Step C merged in #1592 moved part of the file into `src/compiler/ts/link/`.
  Reported by session D on 2026-11-24: pending a format pull request or a tool fix.
  Verified on `4c1df624`: `bun scripts/move-purity.ts --clean-report --json` lists `link.ts` with 3 units and 0 active units.
  `linkProgram` spans lines 63 to 1070, 1,008 lines, so one function holds most of the file.
  `bun scripts/move-declarations.ts --from src/compiler/ts/link.ts --to src/compiler/ts/link/suggested-file.ts --move suggestedFile --dry-run` prints, verbatim: "Refused: suggestedFile is location-dependent (the relative path "./"); it does not move".
  Next action: split `linkProgram` in an ordinary pull request that has its own tests. Then move the helpers.
- Item 12: `src/compiler/ts/host-face.ts`, 1,228 lines. Step C merged in #1592 moved part of the file into `src/compiler/ts/host-face/`.
  Reported by session D on 2026-11-24: pending a format pull request or a tool fix.
  Verified on `4c1df624`: the clean report lists `host-face.ts` with 18 units and 0 active units.
  `bun scripts/move-declarations.ts --from src/compiler/ts/host-face.ts --to src/compiler/ts/host-face/reported.ts --move reported --dry-run` prints "Move purity: pure" and "Findings: 0". It did not reproduce the reported reason for `reported`.
  Next action: run the same dry run for each remaining declaration. Report each refusal verbatim here.
- Item 13: `src/core/backends/wgsl.ts`, 632 lines. Stopped by session F.
  Reported by session F on 2026-11-24: a test cannot hold the evaluation order of `modOperandsOnce` (issue #841).
  Verified in the repository: `git ls-remote origin slice-a/wgsl` shows `84be93c7`, a branch of unmerged tests. No pull request was checked for it.
  Next action: decide how the order of `modOperandsOnce` is held (issue #841) before the move.
- Item 14: `src/core/builtins/coredef.ts`, 721 lines. Not started by session F.
  Verified in the repository: the first line says "GENERATED by scripts/bake-coredef.ts from Tint's core.def. Do not edit: re-bake." The generator `scripts/bake-coredef.ts` exists.
  Next action: change `scripts/bake-coredef.ts` so that it writes files of at most 400 lines. Then re-bake it with the generator. Do not move the generated file by hand.
- Item 15: `src/core/passes/kernel-lower.ts`, 948 lines. Steps A, B and C merged in #1577, #1582 and #1587. The file stays above 400 lines.
  Reported by the session on 2026-11-24: a call cycle between `lowerKernel` and `lowerCollections`.
  Verified in the repository: `lowerKernel` (line 87) calls `lowerCollections` (line 111, defined at line 789). The reverse call was not checked.
  Next action: an ordinary pull request that breaks the cycle with a narrow type. Then the moves (`docs/structure-slice-playbook.md`, step C, item 2).
- Item 16: `src/rhi/webgl2.ts`, 845 lines. Steps A, B and C merged in #1567, #1571 and #1578. The file stays above 400 lines.
  Reported by the session on 2026-11-24: the classes `GlRenderPass`, `GlEncoder` and `GlDevice` name each other, and the move tool takes that as a cycle.
  Next action: as for item 15.

Fact, measured on `4c1df624`: `scripts/file-size-baseline.json` lists 244 files, 104 non-test files and 140 test files.
`scripts/comment-baseline.json` lists 949 files with 49,655 comment lines in all.

Fact: nothing in this plan reverses an entry of `docs/owner-decisions.md`.
