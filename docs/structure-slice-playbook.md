# The slice playbook for a session that works alone

A session that splits oversized files of `src/` follows this playbook from the first file to the
last merge. Its opening prompt names its files. The plan is `docs/structure-refactoring-plan.md`;
the rules are `CLAUDE.md`. Where this playbook and `CLAUDE.md` differ, `CLAUDE.md` holds.

This session is one of several that run in parallel on the structure refactoring. It is "fire and forget": nobody watches it. The owner said on 2026-11-24, in the orchestrating session (session_017fz53SGjwDwHVKa9RHKiEm): "맡긴 작업은 스스로 종결될 수 있게 해주시고. 발사 후 망각 같은 개념으로" and "남은 작업들도 그렇게 진행하면 병렬 효율성이 최고로 높아질 것 같은데". So you carry each file from start to merged, you merge what the rules below let you merge, you stop cleanly, and you ask the owner nothing unless a rule below says to stop.

## Your files

The opening prompt of the session lists them. Do them one at a time, smallest first. Other sessions own every other oversized file: do not touch a file of `scripts/file-size-baseline.json` that is not in your list.

## Goal for each file

`CLAUDE.md`, File size: a file of `src/` has at most 400 lines; 200 lines is a goal, not a limit; a file holds one responsibility — one class per file with the types and helpers only it uses, a type that several files use in a types file of the module, functions grouped by responsibility. Split the file into `<dir>/<name>/<part>.ts`, each part named for what it holds (never `part-1`). The original path stays and re-exports what it exported, so no importer changes. Do not cut one class or one function to reach a number, and say in the pull request which parts stay above 200 and why.

## Local first, few pull requests

- Do the three steps of every file locally, one worktree for each file. Verify there. Push your
  branches so that no work stays only in the container: a push without a pull request runs no CI,
  and a draft pull request runs no CI gate.
- Open few pull requests. One pull request carries one step for all your files: first the tests
  of step A, then the comment removals of step B, then the moves of step C. A range that declares
  `Move: comments` or `Move: pure` may span many files, and the checker judges the whole range.
  Start step B's branch from `main` after step A is merged, and step C's after step B is merged,
  so that each `Move:` range holds nothing but its own kind. A budget pull request (The bundle
  budget) is extra: it carries no step.
- Keep a pull request a draft until its batch is complete and the local checks pass. Then mark it
  ready for review: CI runs once.
- Before a batch is marked ready, an agent that did not write it reviews every file of it against
  this playbook: each removed comment and the test that holds it, the shape and the name of each
  new file, the checker's verdict. On 2026-11-24 a first pass of a similar task had a quarter of
  its results weak or wrong, and a review of a sample missed most of them: review all, not a sample.
- If one file of a batch fails its review or a check, take that file out of the batch and go on.

## The three steps, one pull request for each step, in this order

Step A — tests for the invariants the comments state (an ordinary pull request).

1. `bun scripts/remove-comments.ts <file> --dry-run` lists the banned comments and marks the "invariant candidates".
2. Read every comment the removal would delete, candidates included. A comment that states behaviour (an order, a rounding rule, a refusal, a unit, "never", "always", "must") states an invariant. For each, find the test that would fail if the behaviour changed. If none does, add a small behavioural test next to the module's tests (at most 400 lines per test file, aim for 200; no comments; a test file that names a `TS8xxx` code must also read the language service — `src/both-halves-policy.test.ts`; if the test is about something an author writes, use `bothTake`/`bothRefuse` of `src/core/testing/both-halves.ts`). Prove each new test bites: mutate the source, see it fail, restore the source.
3. A comment that states what no test, name or assert can hold (where a method comes from, what a target or a specification forces) stays: rewrite it to begin with `Why:` in this step (the policy spares it; `Why:` comments may take at most 1% of the lines of `src/`).
4. This pull request changes tests (and `Why:` comment text) only. Commit trailer: `Change: none, tests of existing behaviour; no export, rule, diagnostic or example changes`. If no test was missing and no `Why:` was needed, skip the pull request and say so in step B's body with the list of comment → test that holds it.

Step B — remove the banned comments (`Move: comments`).

1. `bun scripts/remove-comments.ts <file>` (without `--keep-invariants`, now that step A is merged), then `bun run bake:comment-baseline` and `bun run bake:file-size-baseline`.
2. One commit; its message has the lines `Change: none, comment removal without behaviour change` and `Move: comments`; the pull request title starts with `Move:`.

Step C — move the declarations (`Move: pure`).

1. Plan first: list the top-level units (`bun scripts/move-purity.ts --clean-report --json`, or the TypeScript AST), group them by the shape rule above, order the moves so that what others depend on moves first.
2. Move ONLY with `bun scripts/move-declarations.ts --from <file> --to <new file> --move <A,B,...> [--closure] [--dry-run] [--bake]`. Run `--dry-run` first. Never retype, rename or edit a body. If the tool refuses, read the reason and change the grouping (two declarations that need each other move together); never work around a refusal by hand. A group the tool cannot move stays in the original file: say so. Two classes that name each other, even in a type position only, are a cycle to the tool. To separate them, give one of them a narrow type of what it uses of the other, in an ordinary pull request between two `Move:` pull requests (tests first, then the change, with every body edit listed in the pull request), and move the classes after it.
3. One commit per moved group, each with `Change: none, declarations move between files without behaviour change` and `Move: pure`; after each, `bun scripts/move-purity.ts --base HEAD~1 --head HEAD --require` prints "pure". The pull request title starts with `Move:`.
4. A `Move:` range may change nothing else: no test, no document sentence, no other file. If `src/AGENTS.md` or another document describes the file's inside and is now inexact, fix it in a later documentation-only pull request (`Change: none, documentation only`).

## Before every push

- Check the open pull requests for your file (`mcp__github__list_pull_requests`, then the files of any that might touch it). If another open pull request edits the file, skip to your next file and come back later; if it is still open when everything else is done, stop and list it.
- `bun run precommit --message-file <file>` for each commit; if it lists review items, read each location and add a truthful `Docs-Impact:` line. Never write that line without reading.
- `bunx tsc --noEmit -p tsconfig.json`, `bunx tsc -p tsconfig.tests.json --noEmit`, `bun run lint`, `bun run format:check`, `bun run docs:refs`. `tsconfig.json` does not include the test files. `bun run build` runs the second command, so a type error in a test fails every job that builds; #1584 was red for that on 2026-11-24.
- `bun scripts/bundle-boundary.ts` before step C is pushed. A split of a file that a bundle contains can raise the gzip size of that bundle, and `scripts/bundle-budget.json` has little headroom. Measured on 2026-11-24: `src/runtime/runtime.ts` loads `src/runtime/gl.ts` with a dynamic `import()`, the check builds one chunk, and Bun then gives each module below that import a lazy-init wrapper of 10 to 25 gzip bytes; seventeen new files split from `src/runtime/gl.ts` and `src/runtime/gl-draw.ts` cost 216 bytes. A `Move:` range may not change `scripts/bundle-budget.json`. If the check prints FAIL for a budget, follow "The bundle budget" below before step C is marked ready.
- Tests: let the shell expand the glob — `bunx vitest run src/*.test.ts <the directory of your file> src/core/spec-conformance`. A quoted glob such as `'src/*-policy.test.ts'` selects NOTHING here. Three root test files fail in this container on a clean `main` and pass in CI: `src/affected-tests.test.ts`, `src/doc-test-selection.test.ts`, and `src/publish-manifest.test.ts` when there is no build output. Any other failure is yours.
- Traps that broke CI before: in no tracked `.ts` file, fixtures included, write a literal traceability marker (the word Verifies or Implements, a colon, then "Rule N.M" — build such a string from parts) unless you mean to register it; a relative import specifier that climbs out of the package; a non-existent repository-looking path with an extension. A file that a rule of `docs/language-design.md` names in its "Enforced by" line must contain the text `Rule N.M` (`src/reqs.test.ts`); when the moves will leave only re-exports in it, step A puts the marker `// Implements: Rule N.M` in place of one of its comment lines, so the file does not grow. An evidence citation in `src/core/coverage/**` is a symbol anchor (`path#Symbol`), never `path:line`; if a moved declaration is cited there, the anchor follows it only through a re-export — run `bun run bake:capability-coverage` and, if it reports a defect, stop that move (a `Move:` range may not edit the coverage rows) and report.
- Never raise a number in `scripts/comment-baseline.json` or `scripts/file-size-baseline.json`. Never skip, disable or weaken a test. Never push to `main`.

## The bundle budget

A `Move: pure` range may change only source files and the two baseline files, so a budget moves in a pull request of its own. `CLAUDE.md` (Merging) approves that pull request in advance when all its conditions hold. The owner approved this on 2026-11-24. Any other rise of a budget waits for the owner.

Two terms. The head of the moves is the head commit of the branch of step C. The trial merge is `origin/main` merged with the head of the moves in a scratch worktree; it is never pushed.

1. Push the branch of step C. Do not mark its pull request ready yet.
2. Make the trial merge. Resolve a conflict of a baseline file with the two bake commands.
3. Run `bun scripts/bundle-boundary.ts` on `origin/main` and on the trial merge.
4. For each bundle that fails on the trial merge, note `bytes`, `split.initial` and `split.total` of both runs.
5. Look for a shape of the split that avoids the rise and that the rules of File size allow. If one exists, use it and stop here.
6. Check the two limits of `CLAUDE.md` (Merging). Past a limit, stop and report the numbers.
7. On a new branch from `origin/main`, set each number that fails to the measured number of the trial merge.
8. Edit `scripts/bundle-budget.json` by hand: `--update` adds 10%. Change no floor and no number that does not fail.
9. In `CHANGELOG.md`, update the entry "Bundle budgets follow the file splits of the structure refactoring" with the new numbers and the pull request of the moves.
10. Run `bun run precommit --message-file <file>`. The proposal line is `Change: none, bundle budget follows a pure move`.
11. Open the pull request ready for review, not as a draft. CI runs every job, because the pull request changes a file of `scripts/`.
12. In its body, name the pull request of the moves and the head of the moves. Give the numbers of step 4 and the shapes that you tried.
13. Push no commit to the branch of step C until the budget pull request is merged. If you push one, repeat from step 2.
14. Before the merge, run the checker of `main` on the head of the moves and read "pure" (Merging — you close your own work).
15. Before the merge, fetch `origin/main` and repeat steps 2 and 3. If a number differs, correct the pull request and wait for CI again.
16. Merge when every required check is green.
17. Merge `origin/main` into the branch of step C and run `bun scripts/bundle-boundary.ts` again.
18. Mark step C ready.

- If CI measures a size that differs from your run, the size of CI holds. The same limits apply to it.
- If another session's split uses the headroom before step C merges, the check of step 17 fails. Then start again at step 2 with a new budget pull request. Its rise counts against both limits.
- If the moves do not merge, say in your final status which rise of a budget stays unused.

Measured on 2026-11-24 for step 5: `src/runtime/runtime.ts` loads `src/runtime/gl.ts` with a dynamic `import()`. In the single-file build each module below that import gets a lazy-init wrapper when it holds top-level state or imports a wrapped module. Of seventeen new files, the three with neither got no wrapper. The split build did not grow.

## Merging — you close your own work

- A `Move: comments` or `Move: pure` pull request is approved in advance (`CLAUDE.md`, Merging). Before the merge, run the checker of `main` on the range and read "pure": `git worktree add --detach /tmp/mainwt origin/main && ln -s "$PWD/node_modules" /tmp/mainwt/node_modules && (cd /tmp/mainwt && bun scripts/move-purity.ts --repo <your checkout> --base origin/main --head <your branch> --require); git worktree remove --force /tmp/mainwt`. Merge (method `merge`) only when every required check is green on the current head (`typecheck + unit`, `traceability (Doorstop)`, `compile gate (Tint + WebGL2)`, `user journeys (packed tarball, WebGPU)`; a skipped GPU gate counts as passed — change 0147 skips the two GPU gates for `Move: comments`; `typecheck + unit` and `traceability (Doorstop)` must show `success`, because `skipped` on those two means the checks of the draft) and there is no conflict. A red check is fixed, never bypassed.
- A step A pull request (tests and `Why:` text only) and a documentation-only pull request: merge when every required check is green, under the owner's words quoted above. Record those words, as relayed by the orchestrating session with the date, in the pull request body.
- After each merge, have a Haiku sub-agent read the workflow runs on `main` for the merge commit (the gates a `Move:` pull request skipped run there). If one is red because of your change, fix forward at once in a new pull request; if you cannot within one attempt, revert your merge with a pull request and report.
- A budget pull request (The bundle budget): merge it when all conditions of `CLAUDE.md` (Merging) hold and every required check is green. If it conflicts, merge `origin/main` into it and measure again; never resolve a number by hand.
- Conflicts: other sessions merge slices all day, and all of them edit the two baseline files. When your branch conflicts, merge `origin/main` into it (no rebase of pushed commits, no force-push), re-run the two bake commands rather than resolving a baseline by hand, re-run the checks, and for a `Move:` range re-run the checker of `main` (a merge commit in the range is fine if the checker still reads "pure"; if it does not, open a fresh branch from `main` and replay the moves with the tool).

## Stop and report instead of acting when

- the file turns out not to be clean (the checker says so), or a split needs a behaviour change, an export change, a rule, a diagnostic, an example, or an edit of `docs/owner-decisions.md`, `CLAUDE.md`, a workflow or the checker;
- a comment states an invariant that you cannot hold with a test, an assert or a `Why:` comment;
- `bun scripts/changes.ts --base origin/main` says a rule or surface is touched;
- a rise of a budget passes a limit of `CLAUDE.md` (Merging), or has a cause other than your `Move: pure` range.
  Stop work on that file only, write what you found in your final status, and go on with the next file.

## Ways of working

- Sub-agents: at most six at a time; Sonnet for tests and moves, Haiku for reading CI logs and check runs; stop each when its report is in; check its key facts yourself before you commit. A workflow of agents is a good fit when the session offers one: one agent slices a file, a second reviews it, a third fixes what the review found.
- Do not sleep or poll for CI: subscribe to your pull request and end the turn; the event wakes you. While one pull request waits, start the next step that does not depend on it (step A of the next file).
- When all your files are done or stopped: unsubscribe from your pull requests, leave no scheduled check-in and no running process, and write one final status in Korean: per file, the pull requests merged with their `main` commits, lines before and after, the parts above 200 lines and why, anything stopped and why, and rows or notes you found wrong on the way (do not fix those). Then stop.
