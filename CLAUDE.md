# Repository operating rules

Read `docs/owner-decisions.md` before anything else: it records the owner's decisions about
what TypeShade is, and it takes precedence over every other document here (The owner's
decisions, below). Then read `AGENTS.md`: it is the architecture guide (one IR, three backends, the pass
pipeline, the gates) and `src/AGENTS.md` the map of `src/`. This file is the shared source
of operating rules for every agent working here. Claude-specific integrations are named
explicitly below.

## The owner's decisions

`docs/owner-decisions.md` holds the owner's decisions, each in the owner's words with its date.
An agent treats each entry as a constraint, not as one option among others.

- Never propose, recommend or offer as an option a design that reverses an entry, unless the
  owner asks for that in the conversation.
- Before recommending anything, check it against every entry, and cite the entries it rests
  on. A recommendation the owner accepts ("추천대로") must not reverse an entry.
- A review finding, a measurement or a tool's behaviour that an entry makes costly is recorded
  as a cost of the entry. It never becomes a reason to change the design against the entry.
  Show the cost to the owner, who alone can change an entry.
- Where another document can be read against an entry, follow the entry and fix the other
  document in its own pull request.
- When the owner states a new decision about what TypeShade is, record it as a new entry, in
  the owner's words with the date, in a pull request that changes `docs/owner-decisions.md`
  only.

## The language of the conversation

Answer the owner in Korean, every reply, from the first to the last of a session: a status
report, a question, a summary after a merge. What goes into the repository stays in English as
it is: code, comments, commit messages, pull request titles and bodies, proposals and every
document in the tree.

## Writing and configuration management

Every reply to the owner and every task follows two disciplines from aircraft maintenance
practice. The writing follows the principles of ASD-STE100, Simplified Technical English. The
work follows the configuration management functions of SAE EIA-649 and ISO 10007. Both are
local conventions, and they claim no compliance or certification (`changes/README.md`, Writing
and handling conventions). `AGENTS.md` (Controlled proposals and everyday answers) applies the
same principles to proposals and answers.

**Writing.**

- Keep descriptive text and procedures apart. Write a procedure as numbered steps in the
  imperative, with one action in each step.
- Give each sentence one topic. Keep a step to 20 words and a descriptive sentence to 25. Give
  each paragraph one topic.
- Use one term for one thing. Use the exact identifier of each file, symbol, check and command.
- Use the active voice when the actor is known. Do not invent an actor.
- Put a warning before the step it applies to. Name an action that cannot be undone (a merge,
  a force push, a deletion) before it is done.
- Keep facts, inferences, proposals, decisions and observed results apart. Label each one when
  the difference matters.
- A reply in Korean applies these principles in Korean: short sentences, one topic in each, one
  action in each step, the same term for the same thing. ASD-STE100's dictionary is English and
  governs only English text.

**Configuration management.**

- Identification. Name each configuration item by its identifier: a repository, a branch, a
  commit, a pull request, a proposal, a submodule pin, a release or a required check. "The
  latest" is no identifier. A commit hash is one.
- Baselines. `main` at a commit is this repository's baseline. The merged revision of an
  accepted proposal is the approved design. A downstream repository's pin of this compiler is
  that repository's baseline of it.
- Change control. Change a baseline only through a pull request. A change to the language also
  needs an accepted proposal (`changes/README.md`). The approval is a review or the owner's
  go-ahead in the conversation (Merging). A change does only what its record declares. To do
  more, amend the record first. One record carries one change, so two unrelated changes are
  two pull requests.
- Status accounting. Record the status of each request and each change: not started, in
  progress or done, and for a proposal its lifecycle state. A status report names each one with
  its identifiers. List each open item with its reason and its next action: deferred work, an
  open deviation, a check that is not green.
- Verification and audit. Support a claim of completion with the checks that actually ran:
  the command or check, the date, the configuration (commit, tool versions) and the result.
  Functional verification (the tests and gates) and the document audit (the documents and
  records match the delivered configuration) are separate. One does not replace the other.
  Report a check that did not run as not run.
- Deviations. Record each difference between the approved text and the delivered work, on the
  pull request and in the proposal's record, with its disposition: closed, made part of the
  approved text by an amendment, or open.

Each task runs in the order of a maintenance task card:

1. Identify the request, the configuration items it touches and their baselines.
2. Find the change record that authorizes the change, or open one.
3. Make the change inside what that record declares.
4. Verify the change with the functional checks and the document audit.
5. Record what was done, on which configuration, what was verified and what remains open.
6. Report the status of every request to the owner.

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
`AGENTS.md#docs-follow-the-code` is the procedure; for every agent it comes down to:

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
  `Verifies: Rule N.M` tag, run `bun run reqs:sync` and `python scripts/doorstop-check.py -C`,
  and work through what it flags as `reqs/README.md` says. A new item needs
  `doorstop review <ID>` after a person reads it. Install Doorstop once with
  `pip install doorstop==3.2`.
- When you edit inside a `LINT.IfChange` block, edit its `ThenChange` targets too.
- Install the shared Git hooks with `bun run hooks:install` to check commits made by any
  agent or person. `pre-commit` checks the active index's files; `commit-msg` checks proposal
  scope, `ThenChange` waivers and the review trailer against the actual message. The checks
  use an exported index snapshot, so partial staging and `git commit -a` are read as Git
  will commit them. Run `bun run precommit` for staged file checks, or
  `bun run precommit --message-file <path>` for both files and the pending message.
  `.claude/settings.json` retains the same policy as an early working-tree preflight.
  A commit that reaches past its proposal needs the proposal widened first, in its own
  pull request. Open review items are the one thing a message can answer, with a
  `Docs-Impact:` trailer that says what you read and found. Never write the trailer,
  `NO_IFTTT=`, a `Change: none` line, `doorstop review` or `doorstop clear` without reading
  the listed locations: each is a claim a reviewer relies on. Local hooks are opt-in and
  `--no-verify` can bypass them; they do not replace CI.

<!-- LINT.ThenChange() -->

## The language design rules are normative

The language design rules are `docs/language-design.md`, and they are normative. Every change
to what an author can write (a name, a type, a spelling, a refusal) cites the rule it rests
on, by number, in the issue or the pull request. A change the rules do not cover changes the
rules first, in the same pull request, and only then moves the surface. A name an author can
write comes from WGSL, from ECMAScript as TypeScript spells it, or from the enumerated
extension table in that document's §9; a compiler-internal helper never becomes one.

When two principles or rules point different ways, the agent does not choose between them.
An example is `docs/roadmap.md`'s "ordinary TypeScript first" against the language's own syntax:
change 0111 chose the first without asking, and it replaced `@vertex` with `vertex(f)`.

1. Stop before the proposal or the change takes a side.
2. Name both principles with their sources (file and rule or section).
3. Show what each choice does to one example an author writes.
4. Ask the owner, in the conversation, which one holds.
5. Record the owner's decision and its date in the proposal.

A conflict found after acceptance is asked the same way, before the implementation goes on.

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
- Write that assertion with `bothTake` or `bothRefuse` of `src/core/testing/both-halves.ts`.
  `src/both-halves-policy.test.ts` fails a new test file that names a `TS8xxx` code and never
  reads the language service.
- A front-end refusal that stands in for a Tint error (Rule 12.6) is measured against Tint once,
  with its valid neighbours, so it neither misses what Tint refuses nor refuses what Tint accepts
  (Rule 13.3).
- When a bug reached `main` past the tests, its fix says in the pull request which half the tests
  read, and adds the test for the half they missed next to the fix.

## Comments

The owner's rule, given on 2026-11-17: "99% 가까운 금지로". A comment cannot be enforced and it
goes stale, so the code carries the knowledge instead.

- Write no comment in a file of `src/`. Name the thing so that the code says it. Hold an
  invariant with a test or an assert. Put the reason for a change in the commit message.
- Two kinds of comment stay: a marker that a check reads (`Verifies: Rule N.M`,
  `Implements: Rule N.M`, which `reqs/` reads, and `LINT.IfChange`), and the doc comment of a definition of `src/__api__/surface.md`, which the
  API reference and the editor's hover show.
- A comment that is truly necessary stays too. The owner said on 2026-11-17: "주석이 꼭 필요한 경우는
  1%에 들어갑니다. 그런것만 있으면 돼요". It states what no name, test or assert can: where a
  method comes from, or what a target or a specification forces. Begin it with `Why:`. The check
  spares it, and fails when these comments take more than 1% of the lines of `src/`.
- `src/comment-policy.test.ts` fails a file that has more comment lines than
  `scripts/comment-baseline.json` records. Never raise a number there.
- An existing comment goes in a pull request for its directory. Before a comment that states an
  invariant goes, a test or an assert holds the invariant. Then run
  `bun run bake:comment-baseline`.

## File size

The owner's rule, given on 2026-11-17: "한 파일당 주석 포흠 400줄이 넘어가지 않도록 프로젝트 구조를
잡고 싶은데". A long file hides its parts, and a directory named for a module shows them.

- A file of `src/` has at most 400 lines, comments included.
- `src/file-size-policy.test.ts` fails a new file above the limit, and a file of
  `scripts/file-size-baseline.json` that grew. Never raise a number there.
- To add code to a file of the baseline, first move one responsibility out of it, into a file
  of its own in a directory named for the module. Then run `bun run bake:file-size-baseline`.
- 200 lines is a goal, not a limit, and no check enforces it. The owner said on 2026-11-24:
  "강제가 아닙니다. 200줄 안에 들어갈 수 있는 구조가 가능하고, 그 방향이 적절한 방향이고 앞으로의
  구조 및 안티 패턴이 없어지는 경우 처리하는걸 목표로하는게 좋아보입니다." Aim for a file of 200
  lines or fewer when such a structure is possible, the direction is right, and the split removes
  an anti-pattern. Do not split a responsibility only to reach the number.
- A file holds one responsibility. One class has one file, with the types and helpers that only
  it uses. A type that several files use goes into a types file of the module. A group of small
  classes or types that form one concept (error classes, the members of a union) may share a file.
  The owner raised this on 2026-11-24: "파일 안에 여러 타입 정의부터 클래스가 여러개 정의된다거나
  하는 문제도 있을것 같아서요".

## Before pushing

Run the gates `AGENTS.md#tests` lists that the change can reach, before you mark the pull request
ready for review. A draft runs no CI gate, so no CI result stands in for them. CI runs the same
gates on a ready pull request, and a red check costs a round trip. The installed Git hooks run the documentation checks above;
the build, the lint, the format check and the tests are yours to run.

## Merging

`main` is protected by a GitHub ruleset: a pull request, a Code Owner review (`.github/CODEOWNERS`)
and the required checks (`typecheck + unit`, `traceability (Doorstop)`, `compile gate (Tint + WebGL2)`,
`user journeys (packed tarball, WebGPU)`). The repository admin can bypass it, and an agent acting
through the owner's account can too, so the rule is written here:

- Merge only when every required check is green on the pull request's current head. A red
  check is fixed, never bypassed. On a ready pull request `typecheck + unit` and
  `traceability (Doorstop)` always run: if either shows `skipped`, the checks are those of the
  draft, and they are not green.
- Bypass only the review requirement, and only when the owner has said in the conversation to
  merge that pull request, or the pull request is one the owner has approved in advance (below).
  The owner cannot approve their own pull request, so their go-ahead is the review.
- Approved in advance, so merged as soon as every required check is green, with no conflict and
  no review thread left open:
  - a pull request whose commits say `Change: none` and that edits only documentation or a
    proposal's `status` line;
  - a pull request that implements a proposal already `accepted` on `main`, within what the
    proposal declares (`scripts/changes.ts` passes), and that adds or renames no author-facing
    name and does not change how an author writes an example (below);
  - a bug fix that needs no proposal.
  - a pull request whose commits declare `Move: pure` or `Move: comments` and that
    `scripts/move-purity.ts` accepts (`docs/structure-refactoring-plan.md`, section 8). Before
    the merge, the merging agent runs the checker of `main` on the range of the pull request and
    reads "pure". A pull request runs its own copy of the checker, so the run on `main` is the
    one that counts. The owner approved this on 2026-11-24: "승인".

  Everything else waits for the owner to say "merge" in the conversation: a new proposal, and a
  change to a design rule, a public export, a surface section, a diagnostic code or the set of
  examples that no accepted proposal covers. After a merge, report it to the owner.

- An implementing pull request that adds or renames an author-facing name (`docs/language-design.md`
  §2.1), or changes how an author writes an example, is not approved in advance, even when its
  proposal is accepted. Its body shows one example before and after the change. Show the owner
  that comparison in the conversation, and wait for the owner to say "merge". An accepted
  proposal approves a direction; the owner approves what authors will read.
- A proposal that changes how an author writes an example shows one example before and after
  the change in its own text. Show the owner that comparison before the owner decides on it.

- Never push to `main` directly, and never force-push it.
- The ruleset, the secrets and every other repository setting are the owner's to change: an
  agent has no admin access to them. When one must change, write the owner a script for the
  GitHub CLI (`gh auth login`, then `gh api`), in PowerShell, since the owner works on Windows.
  Never ask for a token in the conversation: a token pasted there is a leaked token.
- Each required check is a job's `name:` in `.github/workflows/ci.yml`. Renaming or removing
  that job leaves every pull request waiting on a check that never reports, so the ruleset
  (Settings > Rules > Rulesets > `main`) changes in the same step.

## Running sub-agents

The owner's rules, given on 2026-10-13, for every session:

- Run at most six sub-agents at the same time, workflow agents included. Start the next one only
  when one has finished. The owner raised the cap from three to six on 2026-11-23: "6개로 상향" (raise
  it to six).
- Stop a sub-agent as soon as its report is in. A sub-agent stops every server and background
  process that it started before it reports.
- Give every task its pull request first. Push the first commit early and open a draft pull
  request at once. Push each later commit to the same branch, so that no work stays only in the
  container.

The owner's rule, given on 2026-11-23: "구현이랑 테스트, 기타 작업은 sonnet haiku를 사용하시고 당신은
오케스트레이션을 중심으로해주세요" (English: use Sonnet and Haiku for implementation, tests and other
work, and keep yourself to orchestration).

- The session's own model orchestrates: it splits the work, briefs each sub-agent, checks what
  comes back, commits, pushes, opens and merges pull requests, and reports to the owner.
- A Sonnet sub-agent does implementation, tests, fixes, proposal drafts, reviews and plans.
- A Haiku sub-agent does mechanical work: reading a CI log, a measurement, a text check, a
  baseline update.
- The orchestrator checks each report's key facts itself before it commits or merges.

## Waiting on a pull request

- Keep a pull request a draft while you work. A draft runs no CI gate (the `draft` scope of
  `.github/workflows/ci.yml`). The owner asked for this on 2026-11-24: "CI랑 관계없이 로컬에서 먼저
  처리한 다음, 머지 직전이 아니라면 CI는 넘기는 방법은 안될까요".
- Mark the pull request ready for review when the work is complete and the local checks pass. CI
  then runs once on the head. After that, wait for the run that the ready event started.
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
