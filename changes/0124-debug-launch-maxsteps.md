---
id: '0124'
title: A debug launch configuration can bound its statement events
status: implemented
rules: []
surface: []
exports:
  - DebugLaunchConfig
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: Document the optional launch budget in the generated guide and Korean overview, check both languages after the compiler pin moves, and record 0124.
  - repo: vscode-typeshade
    what: Adopt the launch budget in the debug adapter and MCP runner, retire the resolver workaround where applicable, verify bounded runs, and record 0124.
---

**Document control**

| Field                         | Record                                                                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0124, implemented in PR #1053. Acceptance was merged by PR #1052.                                                                                                                          |
| Date and attribution          | Authored 2026-11-06 UTC by Codex while progressing the owner's remaining-issue request. This date records authorship, not approval.                                                                 |
| Request source                | Issue [#215](https://github.com/typeshade/typeshade/issues/215): the launch configuration cannot carry the debugger's existing statement budget.                                                    |
| Applicability / Effectivity   | The `typeshade/debug` host API, launch schema and resolver. The stepping engine's budget semantics stay unchanged. Release version unassigned.                                                      |
| Review baseline               | `main` at `093f6c609dacf91a783c0b8b9d96981bcea16cf7`.                                                                                                                                               |
| Review and revision authority | Proposal [PR #1052](https://github.com/typeshade/typeshade/pull/1052); implementation [PR #1053](https://github.com/typeshade/typeshade/pull/1053). Git records revisions and their merge evidence. |

## What changes

Add `readonly maxSteps?: number` to `DebugLaunchConfig`, exported from `typeshade/debug`.
An adapter can supply the statement budget through its launch configuration:

```ts
const session = startDebugSessionFromConfig(module, {
  entry: 'main',
  maxSteps: 10000,
});
session.continue();
```

The accepted contract is:

- A supplied value must satisfy `Number.isInteger(value) && value > 0`. Zero, negatives,
  fractions, `NaN`, infinities and non-number values are invalid. There is no coercion or
  rounding. Explicit `null` is invalid; omission and JavaScript `undefined` mean no budget.
- `startDebugSessionFromConfig` validates the value before starting the session. An invalid
  value adds `maxSteps must be a positive integer` to the existing `DebugConfigError.problems`.
  It participates in the existing collection of configuration problems. Entry lookup and
  unrelated validation order retain their existing behavior.
- `CONFIG_KEYS` accepts `maxSteps`. `DEBUG_LAUNCH_SCHEMA.properties.maxSteps` declares
  `type: 'integer'` and `minimum: 1`. The property is optional and has no schema default.
  JavaScript non-finite values are rejected by the resolver; they are not JSON numbers.
- A valid value passes unchanged to `startDebugSession` as `DebugSessionOptions.maxSteps`.
  Omission passes no budget. No adapter default is introduced by this API.

The budget retains the engine's meaning: statement events reached during one session,
including events that cause no pause. It is cumulative across stepping and `continue()`.
The engine's post-call events do not consume the budget. Exhaustion keeps the existing
`maxSteps` error and finished-session behavior. `stopOnEntry` and breakpoints keep their
current behavior. The budget is not a time limit or a count of loop iterations.

This proposal changes no shader syntax, compiler diagnostics, arithmetic, GPU execution or
language rule. It adds no cancellation mechanism and changes no lower-level budget validation.
`DebugSessionOptions`, `startDebugSession` and the engine remain as they are.

## Why

Issue #215 reports an existing engine capability that the shared launch configuration cannot
express. At the review baseline, `DebugSessionOptions.maxSteps` exists in
`src/core/debug/session.ts`. The engine counts statement events in `advance` and throws when
the budget is exceeded. An omitted budget is unbounded.

`src/core/debug/config.ts` omits the field from `DebugLaunchConfig`, `CONFIG_KEYS`,
`DEBUG_LAUNCH_SCHEMA` and the call to `startDebugSession`. A configuration that supplies it is
rejected as an unknown key. An adapter cannot use the shared resolver and set a budget.

The editor snapshot `db3f4171d6ea4689d6048d2252b6553da4599906` demonstrates the cost.
[the MCP runner](https://github.com/typeshade/vscode-typeshade/blob/db3f4171d6ea4689d6048d2252b6553da4599906/packages/mcp-server/src/run.ts) documents this limitation and calls `resolveInvocation`,
`resolveBindings` and `startDebugSession` itself. It supplies its own budget to the last call.
The proposed field allows that adapter to use the shared launch path when its other needs fit.

Alternatives considered:

- Keep budget handling in each adapter. This retains the duplicated resolver orchestration
  and leaves a launch configuration unable to describe its run completely.
- Introduce a default budget for every launch. This can stop existing runs that finish today.
  The proposal keeps omission unbounded and leaves adapter-specific defaults to adapters.
- Add a separate options argument for the budget. The existing third argument carries
  non-JSON hooks. A positive integer belongs in the serializable configuration and its schema.

The accepted decisions are a positive integer, no default, and reuse of existing engine
semantics. The Approval and plan record identifies the review and authorization. No additional
design choice is unresolved.

## What it touches

- **Exports:** `DebugLaunchConfig` gains the optional field. `src/__api__/surface.md` is rebaked.
  `DEBUG_LAUNCH_SCHEMA` changes its value but keeps `Readonly<Record<string, unknown>>`.
  `startDebugSessionFromConfig` validates and forwards the field without a signature change.
  Those two behavior changes are declared here; they do not reshape additional exports.
- **Rules and surface:** none. This is a debugger host API addition. The numbered language
  rules and `docs/use-typeshade-surface.md` sections keep their current contracts.
- **Codes and examples:** none. The resolver uses the existing `DebugConfigError`; no compiler
  diagnostic code or registered shader example changes.
- **Implementation:** `src/core/debug/config.ts` gains the field, allowed key, validation,
  pass-through and schema property. The engine needs no change.
- **Documentation:** `docs/debugging.md` §4.1 states the accepted values and omission behavior
  and shows a budget. Its broad defaults sentence must distinguish binding defaults from
  launch options. The `typeshade/debug` paragraph of `AUTHORING.md` mentions the optional
  statement budget. `CHANGELOG.md` records the addition.

Required functional validation:

- `src/core/debug/config.test.ts` runs a finite shader through the public launch API.
  A tiny budget raises the existing budget error; a sufficient budget returns the expected
  result. With `stopOnEntry: false`, exhaustion can occur in the launch call itself; test that
  existing behavior. Omission and explicit `undefined` preserve the unbounded default.
- A paused run retains its budget across resume and stepping. The test uses a finite shader,
  so a missing budget fails an assertion instead of hanging the test runner.
- Zero, a negative integer, a fraction, `NaN`, both infinities, a string, a boolean and `null`
  produce the specified configuration problem before shader execution. Invalid values tested
  from JavaScript are not assumed impossible because TypeScript declares `number`.
- A bad budget is collected with another configuration problem on a valid entry. No shader
  statement or console hook runs before validation fails.
- The schema/interface/key agreement tests include `maxSteps`; the schema declares an optional
  integer with minimum 1 and no default. Public type checking accepts the new optional field.
- Run the focused configuration and existing session tests, `src/api-surface.test.ts`, and
  `bun run build`. They hold the launch path, existing engine behavior and exported shape.
  No new GPU gate is required by this CPU debugger addition; required PR checks still apply.

Required document validation: `bun run docs:refs`, `bun run docs:impact`, the proposal check,
the existing proposal-shape tests and formatting. Review each reported impact against the
delivered scope. The implementation record must distinguish these results from functional
validation and retain their tested commit and tool versions.

### Draft impact estimate

Known work is one optional field, one validation branch, one schema property and pass-through,
plus tests, the API snapshot and the documentation above. Existing configurations retain their
behavior. A previously rejected `maxSteps` key becomes valid only for a positive integer.
The direct `startDebugSession` API keeps its existing behavior.

No dependency is added. Existing TypeScript, Vitest and documentation tools provide the checks.
Downstream work includes adopting the field, checking adapter-specific defaults and removing
duplicate resolver calls only where the launch path supplies the same behavior. No duration
or cost estimate is established. Acceptance confirms the contract and validation scope above.

### Approval and plan record

The owner authorized continued work on remaining issues and merging the agents' own pull
requests in the current session. This is standing task authorization, not a quoted decision
about the wording of `maxSteps`.

On 2026-11-06 UTC, the orchestrating Codex agent independently reviewed the contract and scope
recorded in draft commit `b0ecdb836d10ca24ae7bbad0f0d9485762fe63e6`, published in
[PR #1052](https://github.com/typeshade/typeshade/pull/1052). It approved the draft without
contract changes and directed acceptance under that authorization. A separate Codex source
review confirmed the engine semantics and downstream evidence without a blocker. The accepted
text adds an explicit test of existing `stopOnEntry: false` exhaustion during the launch call.
The approved scope is the positive-integer field, no default, existing cumulative engine
budget, declared host API/document impacts and required validation above.

A Codex agent in `typeshade/typeshade` is assigned the compiler repository implementation
within this scope. The orchestrating agent coordinates independent review and merge after
required checks pass. No milestone date or resource estimate is established. Downstream
adoption is assigned to each adopting repository's compiler-pin work; its completion remains
pending. The merge of PR #1052 with `status: accepted` establishes the approved baseline.
Implementation starts only after that merge.

### Configuration and validation record

**Accepted baseline.** Proposal PR #1052 merged as `accepted` at
`ffcb650d1b0b3d203d6204deca4be67436db0282`. Implementation branch
`feat/215-debug-launch-maxsteps` starts at that commit.

**Implementation.** [PR #1053](https://github.com/typeshade/typeshade/pull/1053), by Codex under
the owner's continuing-work authorization. Commit
`14498e8a64a3c1e1e77d6fec59763bea43a27c60` implements the code, tests, API snapshot and guide
changes. This subsequent documentation revision records delivery and marks the proposal
implemented. No release version is assigned.

**Delivered configuration.** `src/core/debug/config.ts` adds the optional field, allowed key,
positive-integer validation, pass-through and JSON Schema property. Validation precedes session
creation and joins the existing configuration problems. The engine in
`src/core/debug/session.ts` is unchanged. `src/__api__/surface.md` reshapes only
`DebugLaunchConfig`.

`src/core/debug/config.test.ts` adds finite public launch tests for paused and immediate
exhaustion, sufficient budgets, omission, explicit `undefined`, cumulative stepping and
breakpoints, invalid JavaScript values, problem collection and schema agreement. The small-budget
tests first establish a valid session or assert the engine's exact error. An unknown-key
`DebugConfigError` cannot satisfy them.

`AUTHORING.md`, `docs/debugging.md` §4.1 and the interface JSDoc describe the optional budget
and distinguish invocation/binding defaults from launch options. The document audit found the
same broad defaults sentence in `docs/use-typeshade.md`; it now states the same accepted
contract. `CHANGELOG.md` records the addition. No rule or numbered surface section changes.

**Functional validation.** The implementing Codex agent ran these checks on 2026-11-06 UTC,
on Linux with Node 24.22.1, Bun 1.4.4, TypeScript 5.6.3 and Vitest 5.0.5. The tested implementation
is the source tree committed as `14498e8a`; later changes only add this record.

- Before implementation, `src/core/debug/config.test.ts` with the 16 new tests selected by
  `-t 'change 0124'` failed all 16 against the accepted baseline. The programs are finite.
- `env -u NODE_OPTIONS node node_modules/vitest/vitest.mjs run src/core/debug src/api-surface.test.ts src/changes.test.ts --reporter dot`:
  12 files, 338 passed, 2 skipped. This includes 576 stepping/oracle differential comparisons.
- A separate Codex agent reviewed the frozen source and ran configuration, stepping and API
  tests independently: 3 files, 131 passed. It reported no blocker. The orchestrating agent
  independently approved the source and documentation within the declared scope.
- `bun run build`: passed. This checks the public optional field through TypeScript, including
  the tests. The API bake also passed its 15 snapshot tests and changed only the declared field.
- `bun run lint` and `bun run format:check`: passed. The semicolon formatter changed no line.

Session-local evidence is retained in the task workspace logs: `typeshade-215-before.log`,
`typeshade-215-focused.log`, `215-independent-review-tests.log`, `typeshade-215-build.log`,
`typeshade-215-lint.log` and `typeshade-215-format.log`. PR #1053 records the tested commit,
commands and results. The full unit suite and GPU gates were not run locally for this host-only
addition. Required CI checks still govern merge; their results are not presumed here.

**Document validation.** On the implementation tree, `bun scripts/doc-refs.ts` found zero dead
references in 1,475 files. `bun scripts/changes.ts --base origin/main` passed with
`Change: 0124` and identified only export `DebugLaunchConfig`. Staged precommit and diff checks
passed. The graph's inbound impact named the configuration and console tests; both ran above.

The implementing agent reviewed every `docs:impact` item. The proposal's problem description
refers to its recorded review baseline. Its declared implementation and export now match the
change. The binding-error description in `docs/debugging.md` remains true. The additional
`docs/use-typeshade.md` correction describes the same host contract and was approved during
review. There is no unresolved scope deviation.

**Pending work.** Website and editor adoption, compiler pins and their 0124 records remain
pending in the downstream repositories. This compiler implementation does not establish their
completion.

## What it owes downstream

- **typeshade.github.io.** Reviewed snapshot
  `bca213452566152ed4b1b55dbdf8294c10d9a33a`. [the guide loader](https://github.com/typeshade/typeshade.github.io/blob/bca213452566152ed4b1b55dbdf8294c10d9a33a/src/lib/authoring.ts) reads the pinned
  compiler's `AUTHORING.md`, so its English overview receives the budget guidance on adoption.
  Update [the Korean overview](https://github.com/typeshade/typeshade.github.io/blob/bca213452566152ed4b1b55dbdf8294c10d9a33a/content/guide/ko/overview.md) to match that guidance. Check the guide translations
  and both rendered overviews. [the API reference loader](https://github.com/typeshade/typeshade.github.io/blob/bca213452566152ed4b1b55dbdf8294c10d9a33a/src/lib/api.ts) does not include `src/debug.ts` among its
  API entry points at this snapshot; adding that reference section is outside this proposal.
  Record 0124 in `compiler-changes.md` when the compiler pin moves.
- **vscode-typeshade.** Reviewed snapshot
  `db3f4171d6ea4689d6048d2252b6553da4599906`. Adopt the compiler field in the launch schema
  and adapter configuration. In [the MCP runner](https://github.com/typeshade/vscode-typeshade/blob/db3f4171d6ea4689d6048d2252b6553da4599906/packages/mcp-server/src/run.ts), replace the documented
  missing-budget workaround with `startDebugSessionFromConfig` where it preserves the current
  invocation, bindings, precision, derivative policy and console handling. Keep the runner's
  existing default budget as its own policy. Verify small-budget refusal, a successful bounded
  run and adapter defaults. Record 0124 in `compiler-changes.md` when the compiler pin moves.

These are accepted obligations for downstream compiler-pin work. Actual downstream changes,
compiler pins and validation remain separately tracked and pending until delivered.
