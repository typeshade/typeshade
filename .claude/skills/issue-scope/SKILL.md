---
name: issue-scope
description: Build and read the context pack of a typeshade issue before implementing it. Load this when you start work on an issue (a bug or a feature), and when the owner asks what an issue touches.
---

# Scoping an issue

The context pack is a mechanical starting point for an issue. Every line names its source. It is not a plan.
`scripts/scope.ts` builds the pack. This skill is the procedure to build it, read it, deepen it with the code graph, and check it after the change.

## Build the pack

Without the MCP tools, run each named tool as `codebase-memory-mcp cli <tool>` with the same arguments.
The CLI's graph tools take `--project <name>`.
`codebase-memory-mcp cli list_projects` prints each project's name and root path.
Run `codebase-memory-mcp cli <tool> --help` to list the flags.

1. Run `git status --porcelain` at the commit you will change.
2. If the command prints anything, clean the working tree first.
3. Index the code graph with `index_repository`, with `repo_path` set to the repository root.
4. Run `bun run scope -- --issue <n>`.
5. Keep its Markdown output.
6. Run `bun run scope -- --issue <n> --json`.
7. Write that JSON output to a scratch file, not into the repository.
8. For an issue not on GitHub yet, write its title and body to a scratch text file.
9. Run `bun scripts/scope.ts --text-file <path>`.
10. Read the header line, `at <sha> · resolver: … · <ms> ms`.
11. If the resolver note says `git grep`, write down why the graph did not run.

For step 8, the title is the first `# ` line. With no such line, the title is the first non-empty line.

## Read the pack

The steps below follow the sections of the pack, in the pack's order.

1. Note the layers in `## Scope at a glance`.
2. Check the deepest layer against the top files; it was right in seven of ten held-out cases.
3. Read the "Needs a proposal" line in `## Scope at a glance`.
4. Treat that line as a prediction, not a decision.
5. Decide with `changes/README.md#when-a-change-needs-one`.
6. If a proposal is needed, draft it from `changes/TEMPLATE.md`, as CLAUDE.md ("The prose follows the code") requires.
7. If a proposal is needed, do not implement the change until it is merged as accepted.
8. Read every file in `## Files to read first`, not only the top 5.
9. Read the "Why" column of each row.
10. Treat a row whose only reasons are co-change or past fixes as history, not a definition.
11. For each symbol in `## Symbols named in the issue` defined in a top file, call `get_code_snippet`.
12. Call `trace_path` with direction `both` on each function the change may alter.
13. Copy each obligation in `## Obligations` into your plan as a checklist item.
14. Read the footprint of each named proposal in `## Similar past work`.
15. Run `git show --stat` on each commit of each similar fix.
16. Run the tests in `## Tests and checks to run` once before the change, as a baseline.
17. Read the subjects in `## Past fixes in these files`; a recurring defect needs a root-cause check.
18. Read each rule named in `## Rules` in `docs/language-design.md`.
19. Read the tests that carry the `Verifies: Rule N.M` tag of each rule.
20. Search each name in `## Not resolved` with `search_graph`, then `git grep` if it stays unresolved.

Steps 8 to 20 do not depend on each other. Do them in any order after the proposal decision in steps 3 to 7.
An unresolved name in step 20 can be a name the issue proposes.

## Check the change against the pack

1. Run `git fetch origin main`.
2. Call `detect_changes` with base branch `origin/main`.
3. List each changed file that the pack did not rank.
4. Read the callers of each file you listed in step 3.
5. List each obligation you did not complete.
6. Complete each listed obligation, or write its reason in the pull request.
7. Run `bun run docs:impact`.
8. Work through its list, as CLAUDE.md requires.
9. In the pull request, name each file the pack missed; this data improves the ranking.

## What the pack cannot see

- The accuracy of the pack is measured, not guaranteed. Quote the held-out row below as the expectation.
- Held-out set, git resolver, default weights, `--limit 15`, measured 2026-10-12 with #599: recall@5 0.607, recall@15 0.657, MRR 0.675, precision@5 0.240.
- The deepest layer was right in 7 of 10 cases (2 of 10 before #599). Tests scored 0.390.
- `bun run scope:backtest -- --set held-out --limit 15` reproduces these numbers.
- The tuning set (11 cases) was used to choose the ranking rules. Do not quote its numbers as the expectation.
- The graph resolver on held-out gives recall@5 0.565 and recall@15 0.768. These two do not depend on the limit.
- A rule, a design intent, or a new name that the issue only implies is not a seed. The pack finds only what the issue text names, or what history connects.
- The pack uses the graph only at HEAD, on a clean tree, with a project whose root path is the repository. The project must be indexed no earlier than HEAD's commit. Otherwise, the pack uses `git grep`, and its header line says why.
- The git fallback has no call graph. Its callers and callees read `none`.
- The test list is capped at 20 and ordered by tier. The text "… and N more" means more tests exist.
- A pack is a starting point. The plan is yours.

## Measure the pack

Measure at `--limit 15`, the CLI's default, because the deepest layer and the test list depend on the limit.
`bun run scope:backtest` measures the pack against the corpus `scripts/scope/backtest/cases.json`. Its default resolver is `git`. Pass `--resolver graph` for the code graph. A graph case builds a fresh worktree and a graph project, so it is slow. Run one graph backtest at a time.
A change to `scripts/scope/pack.ts` quotes the held-out numbers before and after in its pull request.
