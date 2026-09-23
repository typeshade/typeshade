# Working in this repository with Claude Code

Read `AGENTS.md` first: it is the architecture guide (one IR, three backends, the pass
pipeline, the gates) and `src/AGENTS.md` the map of `src/`. This file adds the rules that
are specific to Claude Code sessions.

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

- Before committing, run `bun run docs:impact` and work through its list: fix every _must fix_
  item, read every _review_ item and fix whatever is no longer true in the same commit.
- After editing `docs/language-design.md`, the surface document or a test that carries a
  `Verifies: Rule N.M` tag, run `bun run reqs:sync` and `doorstop -C`, and work through what
  it flags as `reqs/README.md` says. Install Doorstop once with `pip install doorstop==3.2`.
- When you edit inside a `LINT.IfChange` block, edit its `ThenChange` targets too.
- `.claude/settings.json` holds `git commit` until all of that is done. Open review items are
  the one thing a message can answer, with a `Docs-Impact:` trailer that says what you read and
  found. Never write the trailer, `NO_IFTTT=`, `doorstop review` or `doorstop clear` without
  reading the listed locations: each is a claim a reviewer relies on.

<!-- LINT.ThenChange() -->

## The language design rules are normative

The language design rules are `docs/language-design.md`, and they are normative. Every change
to what an author can write (a name, a type, a spelling, a refusal) cites the rule it rests
on, by number, in the issue or the pull request. A change the rules do not cover changes the
rules first, in the same pull request, and only then moves the surface. A name an author can
write comes from WGSL, from ECMAScript as TypeScript spells it, or from the enumerated
extension table in that document's §9; a compiler-internal helper never becomes one.

## Everything else

The gates, the golden and API-surface bake commands, the compile gate and the emit rules are
in `AGENTS.md`. The `"use typeshade"` surface is `docs/use-typeshade-surface.md`; the
priority order is `docs/roadmap.md`.
