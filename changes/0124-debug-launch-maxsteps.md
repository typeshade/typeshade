---
id: '0124'
title: A debug launch configuration can bound its statement events
status: accepted
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

| Field                         | Record                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0124, accepted on merge of PR #1052. The front matter is the lifecycle authority.                                                       |
| Date and attribution          | Authored 2026-11-06 UTC by Codex while progressing the owner's remaining-issue request. This date records authorship, not approval.              |
| Request source                | Issue [#215](https://github.com/typeshade/typeshade/issues/215): the launch configuration cannot carry the debugger's existing statement budget. |
| Applicability / Effectivity   | The `typeshade/debug` host API, launch schema and resolver. The stepping engine's budget semantics stay unchanged. Release version unassigned.   |
| Review baseline               | `main` at `093f6c609dacf91a783c0b8b9d96981bcea16cf7`.                                                                                            |
| Review and revision authority | Proposal [PR #1052](https://github.com/typeshade/typeshade/pull/1052). Git records revisions; its accepted merge makes the decision effective.   |

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

This record does not yet apply. Delivery requires the accepted proposal revision, actual
implementation PR and commits, the delivered configuration, responsible actors and observed
functional and document validation results. Deviations and pending work must be recorded.
Compiler implementation will not establish downstream completion.

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
