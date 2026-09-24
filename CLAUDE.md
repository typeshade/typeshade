# Working in this repository with Claude Code

Read `AGENTS.md` first: it is the architecture guide (one IR, three backends, the pass
pipeline, the gates) and `src/AGENTS.md` the map of `src/`. This file adds the rules that
are specific to Claude Code sessions.

## The language of the conversation

Answer the owner in Korean, every reply, from the first to the last of a session: a status
report, a question, a summary after a merge. What goes into the repository stays in English as
it is: code, comments, commit messages, pull request titles and bodies, proposals and every
document in the tree.

## Use codebase-memory-mcp for every structural question

`.mcp.json` registers [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp)
(`npx -y codebase-memory-mcp`), a code-intelligence server that indexes this repository into a
knowledge graph of functions, calls, imports and tests. Prefer its answers to walking
1500-line files with grep: the same question costs a fraction of the tokens and returns file
and line ranges.

**At the start of a session**, make sure the graph exists and follows the branch:

- MCP tool: `index_repository` with `repo_path` set to the repository root.
- Without the MCP tools (a server registered mid-session is not loaded until the next
  session): `npm install -g codebase-memory-mcp` once, then
  `codebase-memory-mcp cli index_repository --repo-path <repository root>`. The CLI runs the
  same engine and gives the same answers; `codebase-memory-mcp cli <tool> --help` lists the
  flags. The project name is the absolute path with `/` replaced by `-`
  (`codebase-memory-mcp cli list_projects` shows it).

Indexing takes about ten seconds. Re-index after each commit.

**While working:**

- `search_graph` (a name pattern, optionally a label such as `Function`, `Variable`,
  `Interface`, `Struct`) finds a symbol with its file and line range.
- `get_file_outline` outlines a large file (`expression-call.ts`, `function.ts`, `glsl.ts`,
  `node.ts`, `intrinsics.ts`) before you edit it; `get_code_snippet` reads one function.
- `trace_path` lists a function's callers and callees. Do this before changing any
  function's contract: the front end, the three backends and the CPU oracle share one IR,
  and a caller you did not see is where drift starts.
- `search_code` is the indexed grep; `get_architecture` is the overview.
- `detect_changes` (base branch `main`) after implementing and before committing: the
  symbols the diff touches and their inbound blast radius. Run the tests of the affected
  callers, and hand the list to a reviewer.

`.codebase-memory/` (the artifact the indexer may write at the root) is gitignored; never
commit it.

## The prose follows the code

The graph covers code, not prose, so it cannot tell you which sentence your change made false.
`AGENTS.md#docs-follow-the-code` is the procedure; in a Claude Code session it comes down to:

<!-- LINT.IfChange(the-prose-follows-the-code) -->

- Before implementing a change to a design rule, a public export, a surface section, a
  diagnostic code or the set of examples, find its accepted proposal in `changes/`. If there is
  none, stop and draft one (`changes/TEMPLATE.md`): list what it touches and what the site and
  the editor will owe, and open it as its own pull request for discussion. Do not implement
  until it is merged as accepted. Each implementing commit says `Change: NNNN`; a caught change
  that truly needs none says `Change: none, <reason>` (`changes/README.md`).
- Before committing, run `bun run docs:impact` and work through its list: fix every _must fix_
  item, read every _review_ item and fix whatever is no longer true in the same commit. A path,
  anchor, rule or script you name must exist (`bun run docs:refs`).
- After editing `docs/language-design.md`, the surface document or a test that carries a
  `Verifies: Rule N.M` tag, run `bun run reqs:sync` and `doorstop -C`, and work through what
  it flags as `reqs/README.md` says. Install Doorstop once with `pip install doorstop==3.2`.
- When you edit inside a `LINT.IfChange` block, edit its `ThenChange` targets too.
- `.claude/settings.json` holds `git commit` until all of that is done, and while a commit
  reaches past its proposal: widen the proposal first, in its own pull request, rather than
  the commit. Open review items are the one thing a message can answer, with a `Docs-Impact:`
  trailer that says what you read and found. Never write the trailer, `NO_IFTTT=`, a
  `Change: none` line, `doorstop review` or `doorstop clear` without reading the listed
  locations: each is a claim a reviewer relies on.

<!-- LINT.ThenChange() -->

## The language design rules are normative

The language design rules are `docs/language-design.md`, and they are normative. Every change
to what an author can write (a name, a type, a spelling, a refusal) cites the rule it rests
on, by number, in the issue or the pull request. A change the rules do not cover changes the
rules first, in the same pull request, and only then moves the surface. A name an author can
write comes from WGSL, from ECMAScript as TypeScript spells it, or from the enumerated
extension table in that document's §9; a compiler-internal helper never becomes one.

## A test reads both halves

A `"use typeshade"` program is read twice: by the compiler (`compile()`: its diagnostics, the
WGSL and GLSL, the CPU oracle) and by the editor (the language service over the ambient library:
its diagnostics, hover and completion). Rule 12.7 makes the two one vocabulary, and a test that
reads one half passes while the other disagrees. A runtime-sized array's `.length` was a `u32` to
the compiler and `number` to the editor, and no test failed.

- A test of something an author can write, or of a refusal, asserts both halves on the same
  source: `compile()`'s diagnostics (code and text, Rule 12.5) or its emit, and the language
  service's `getDiagnostics`, plus `getHover` where the type is the point.
  `src/language-service/ambient-parity.test.ts` is the shape for a program the two must agree on.
- A front-end refusal that stands in for a Tint error (Rule 12.6) is measured against Tint once,
  with its valid neighbours, so it neither misses what Tint refuses nor refuses what Tint accepts
  (Rule 13.3).
- When a bug reached `main` past the tests, its fix says in the pull request which half the tests
  read, and adds the test for the half they missed next to the fix.

## Before pushing

Run the gates `AGENTS.md#tests` lists that the change can reach. CI runs the same ones, and a
red check costs a round trip. `.claude/settings.json` holds each commit to the documentation
checks above; the build, the lint, the format check and the tests are yours to run.

## Merging

`main` is protected by a GitHub ruleset: a pull request, a Code Owner review (`.github/CODEOWNERS`)
and the required checks (`typecheck + unit`, `traceability (Doorstop)`, `compile gate (Tint + WebGL2)`,
`user journeys (packed tarball, WebGPU)`). The repository admin can bypass it, and an agent acting
through the owner's account can too, so the rule is written here:

- Merge only when every required check is green on the pull request's current head. A red
  check is fixed, never bypassed.
- Bypass only the review requirement, and only when the owner has said in the conversation to
  merge that pull request, or the pull request is one the owner has approved in advance (below).
  The owner cannot approve their own pull request, so their go-ahead is the review.
- Approved in advance, so merged as soon as every required check is green, with no conflict and
  no review thread left open:
  - a pull request whose commits say `Change: none` and that edits only documentation or a
    proposal's `status` line;
  - a pull request that implements a proposal already `accepted` on `main`, within what the
    proposal declares (`scripts/changes.ts` passes);
  - a bug fix that needs no proposal.

  Everything else waits for the owner to say "merge" in the conversation: a new proposal, and a
  change to a design rule, a public export, a surface section, a diagnostic code or the set of
  examples that no accepted proposal covers. After a merge, report it to the owner.

- Never push to `main` directly, and never force-push it.
- The ruleset, the secrets and every other repository setting are the owner's to change: an
  agent has no admin access to them. When one must change, write the owner a script for the
  GitHub CLI (`gh auth login`, then `gh api`), in PowerShell, since the owner works on Windows.
  Never ask for a token in the conversation: a token pasted there is a leaked token.
- Each required check is a job's `name:` in `.github/workflows/ci.yml`. Renaming or removing
  that job leaves every pull request waiting on a check that never reports, so the ruleset
  (Settings > Rules > Rulesets > `main`) changes in the same step.

## Waiting on a pull request

- Mark a draft pull request ready for review as soon as its required checks are green, not at
  merge time.
- Waiting on CI is not work: end the turn, and let the pull request's events wake the session.
  Never sleep inside a turn for a check.
- A pull request that is green, has no conflict and waits only on the owner needs no check-in.
  Do not schedule one: a review, a comment and a push to `main` arrive as events. Schedule a
  check-in only while something the agent owns is still in flight (a red check, a pending fix).
- While one pull request waits, move on to the next piece of work rather than holding the
  session on it.

## Everything else

The gates, the golden and API-surface bake commands, the compile gate and the emit rules are
in `AGENTS.md`. The `"use typeshade"` surface is `docs/use-typeshade-surface.md`; the
priority order is `docs/roadmap.md`.
