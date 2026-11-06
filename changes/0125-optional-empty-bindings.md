---
id: '0125'
title: A fragment entry with no host bindings draws with only its target
status: accepted
rules:
  - '8.24'
surface:
  - 64
  - 67
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: Omit the empty fragment bindings argument in Quick Start and generated host starters, update English and Korean guidance, verify the calls after adopting the compiler, and record 0125.
  - repo: vscode-typeshade
    what: Update host-call guidance and tsserver fixtures for optional empty fragment bindings while preserving required-binding errors; record 0125 after the compiler pin moves.
---

**Document control**

| Field                         | Record                                                                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0125, accepted on merge of PR #1054. The front matter is the lifecycle authority.                                                                                   |
| Date and attribution          | Authored 2026-11-06 UTC by Codex while progressing the owner's remaining-issue request. This date records authorship, not approval.                                          |
| Request source                | Issue [#454](https://github.com/typeshade/typeshade/issues/454), including its 2026-11-06 recheck: a fragment entry with no reached binding still requires `fs(canvas, {})`. |
| Applicability / Effectivity   | Generated host views and imported full-screen fragment calls under Rule 8.24, on WebGPU, WebGL2 and the CPU tier. Release version unassigned.                                |
| Review baseline               | `main` at `3ca2eaf628313dcea28f8a72fe0f7145fd2ad126`.                                                                                                                        |
| Review and revision authority | Proposal [PR #1054](https://github.com/typeshade/typeshade/pull/1054). Git records revisions; its accepted merge makes the decision effective.                               |

## What changes

Permit omission of the trailing `bindings` argument of a callable full-screen fragment entry
exactly when the entry reaches no binding that the host supplies. This amends Rule 8.24's
fragment-call paragraph and surfaces §64 and §67. The entry remains subject to the rule's existing
eligibility conditions.

```ts
// solid.shade.ts
"use typeshade";

export const fs = fragment(function fs(): vec4 {
  return vec4(1.);
});
```

```ts
import { fs } from './solid.shade.ts';

await fs(canvas);
await fs(canvas, undefined);
await fs(canvas, {});
```

These three calls draw the same frame. `target` remains required. The generated host view for
this entry becomes:

```ts
export declare function fs(
  target: HTMLCanvasElement | OffscreenCanvas,
  bindings?: {},
): Promise<void>;
```

The accepted contract is:

- **Eligibility is per entry.** Use the existing transitive read/write reachability used to
  form the entry's host bindings. An unused declaration, or a binding reached only by another
  entry, does not make this entry's argument required. A binding reached through a helper does.
- **Runtime resources are not host bindings.** The `_fp64` guard belongs to the runtime and
  does not require a host argument. A guard-only entry is eligible. Use the existing guard
  classification and authored binding set; do not infer eligibility from raw binding-array
  length, field optionality or another reachability analysis. Classification uses ownership
  metadata, not a name blacklist. An authored binding named `_fp64` or `_console` remains a
  host binding. Console recording alone adds no host-supplied binding.
- **Omission means the existing empty object.** For an eligible entry, one or two arguments
  are accepted. Omitted `bindings` or explicit `undefined` is normalized to an empty object
  before the existing binding validation and frame capture. An explicit object follows the
  existing checks unchanged.
- **Reached host bindings remain required.** The generated signature keeps its required
  object type when any authored binding is reached. Runtime omission and `undefined` remain
  errors. Missing non-sampler fields, wrong values and unknown keys retain their current
  refusals. Existing sampler-property defaults do not make the whole argument optional.
- **Invalid calls remain invalid.** `null`, arrays, primitives and unknown object keys are
  not treated as omission. Invalid targets, zero arguments and excess arguments remain errors.
  An eligible entry's arity error says
  `fs() takes 1 or 2 arguments, (target, bindings?); got N.` with its own name and argument
  count. Entries that require bindings keep the current two-argument error.

The existing empty-object host type remains `{}`. This proposal does not strengthen TypeScript's
empty-object checking: runtime validation still rejects extra keys and non-object values that
TypeScript's `{}` admits today. The new optional type additionally admits `undefined`.

There is no change to frame contents, target sizing, return type, submission ordering, resource
ownership or tier selection. A draw with no host resource uses the existing default owner.
The call still performs validation before GPU work and still refuses a draw in a `fuse` scope.
The runtime supplies internal resources as it does for an explicit empty bindings object.

**Scope boundary.** Compute calls remain `entry(bindings, workgroups[, options])`, including
`entry({}, workgroups)` when they reach no host bindings. Their leading argument cannot become
optional without a separate decision about argument positions. This proposal adds no compute
overload, default workgroup count or indirect-count spelling. Helpers, kernel calls, program
runtime pipelines, the RHI and currently non-callable entries keep their existing contracts.
The other concerns referenced by issue #198, including lost-write warnings, are not part of
this proposal.

## Why

Issue #454 asks the host to avoid an argument that carries no value. Its 2026-11-06 recheck on
`main` at `093f6c60` confirmed the gap on a finite white-pixel program. Both a shader with no
binding declaration and one with an unused declaration generated required `bindings: {}`.
Host TypeScript reported TS2554 for `fs(canvas)`; the runtime rejected the arity. Passing `{}`
drew the expected pixel. A binding reached through a helper correctly remained required.

At this proposal's review baseline, `src/compiler/ts/host-face.ts` still writes the required
fragment argument. `src/core/host-draw.ts` still accepts exactly two arguments. Implemented
proposal 0016 introduced these calls and their reached-binding set; it did not permit omission.
The relevant source remains consistent with the issue's recheck.

Alternatives considered:

- Keep `fs(canvas, {})`. It works, but preserves the empty argument in the first draw an author
  writes and leaves the issue unresolved.
- Default every bindings object. This weakens the required-binding contract and can obscure
  a missing input. The proposal permits omission only for an empty reached host-binding set.
- Add `entry(workgroups[, options])` for compute at the same time. This needs argument
  disambiguation beside direct and indirect counts. It is separate from the trailing fragment
  argument in the reported problem.
- Introduce a stricter empty-object host type. That changes existing host typing beyond
  omission. Runtime validation already rejects an unknown binding; its behavior is preserved.

The accepted decisions are fragment-only scope, omission/`undefined`/`{}` equivalence for an
eligible entry, and reuse of existing reachability and runtime-resource ownership. The Approval
and plan record identifies the review and authorization. No other design choice is unresolved.

## What it touches

- **Rule 8.24:** the fragment-call paragraph permits omission exactly for the empty reached
  host-binding set. It names the runtime-owned guard exception and preserves compute's shape.
  Review and synchronize `reqs/rules/RULE-0824.md` after the normative edit.
- **Surface 64:** its "In the host view" table must show the conditional optionality of the
  fragment's bindings argument, or state that distinction beside the table and link to §67.
  Review `reqs/surface/SURF-064.md` after the table changes.
- **Surface 67:** the introductory fragment call and "Drawing a fragment entry" explain the
  optional argument, its eligibility and its invalid values. Review `reqs/surface/SURF-067.md`
  and any suspect links after synchronization.
- **Exports:** none added, removed or reshaped in `src/__api__/surface.md`. The generated
  fragment declaration changes; `hostFace`, `HostExport` and runtime entry metadata retain
  their exported shapes. API-surface verification must confirm this.
- **Codes and examples:** none. Host TypeScript uses its existing argument checks, and the
  runtime retains `TypeError`. No compiler diagnostic code or registered shader example changes.
- **Implementation:** the fragment view in `src/compiler/ts/host-face.ts` and argument handling
  in `src/core/host-draw.ts`. Derive eligibility from the same host-binding set used by
  `bindingsTypes` and `checkBindings`; reuse the existing `isGuard` authority in the call layer.
  Do not add an independent binding-reachability walk or require a new metadata flag.
- **Documentation:** update the host-draw guidance in `AUTHORING.md`, the completed roadmap
  item B6, source comments and `CHANGELOG.md`. Audit all other descriptions of the affected
  calls; their required-binding examples remain valid.

Required functional validation:

- Extend `src/compiler/ts/host-draw.test.ts` with no-declaration, unused-declaration and
  guard-only entries. Read each shader with the compiler and shader language service. Read
  the generated host view with TypeScript and a host TypeScript language service. Omission,
  explicit `undefined` and `{}` must type-check for those entries.
- On the CPU tier, draw all three call forms into a finite canvas and compare pixels with an
  independent expected result. The guard-only source must retain non-constant `f64` arithmetic,
  so the test actually has an internal guard to exclude.
- A direct or transitively reached authored binding keeps its required signature and runtime
  validation. Assert the host errors for omission and the runtime failures for omission,
  `undefined` and missing required fields. A valid bindings object still draws correctly.
  Include authored `_fp64` and `_console` names, and a console-only entry with no host binding,
  to distinguish ownership metadata from spelling. Existing name-collision refusals stay intact.
- Cover invalid targets, null/array/primitive bindings, unknown keys and excess arguments.
  Hold the exact arity messages and verify refusals occur before drawing. Preserve existing
  tests for required-binding calls and draws refused inside `fuse`.
- Add a scope regression showing a binding-free compute entry still requires the leading
  object and succeeds as `entry({}, workgroups)`; do not introduce shifted arguments.
  Use `fragment(function ...)` for the primary sources and retain one equivalent decorator
  case. Vite and the language service consume the same host view; no second arity rule belongs
  in either adapter.
- Extend the existing packed host-import journey and entry-call gate with an actual omitted
  fragment argument. Compare against explicit `{}` and independent pixels on WebGPU, WebGL2
  and CPU. Include a guard-only fragment under both existing fp64 flavors on WebGPU, and the
  existing GLSL variant on WebGL2. Internal resources must still be supplied correctly.
- Run focused host-draw/host-entry and API tests, `bun run build`, `bun run lint`,
  `bun run format:check`, `bun run gate:compile`, `bun run gate:journeys` and the bundle boundary
  gate. Record measured bundle effects and tested configurations. Required CI checks still apply.

Required document validation: `docs:refs`, `docs:impact`, the proposal check, proposal-shape
tests, requirements synchronization and Doorstop review of the changed rule and linked surface.
The implementation record must distinguish these checks from runtime validation.

### Draft impact estimate

Known work is a conditional optional parameter and normalization of the omitted runtime
argument, plus the tests, documentation and traceability above. Existing valid two-argument
draws remain valid. One-argument calls to eligible entries become valid; invalid calls to
entries with reached host bindings retain their current behavior.

No dependency or serialized metadata change is planned. Consumers must regenerate host views
when adopting the compiler. Pair generated views with their compiler/runtime version; this
proposal introduces no guarantee for mixed versions. The site can simplify its Quick Start
and host starter, while the editor gains a host fixture for omission. Duration and cost are
unknown; no estimate is established. Acceptance confirms the scope and validation above.

### Approval and plan record

The owner authorized continued work on remaining issues and merging the agents' own pull
requests in the current session. This is standing task authorization, not a quoted decision
about fragment-call argument syntax.

On 2026-11-06 UTC, the orchestrating Codex agent independently reviewed the complete proposal.
It approved fragment-only scope, the three equivalent empty-binding forms and preservation of
existing invalid-call checks. It required explicit ownership metadata and regressions for
user-authored `_fp64` and `_console` bindings, plus a console-only entry. Draft commit
`474bb216a535a5a63416aad2b7f3f8123319305d`, published in
[PR #1054](https://github.com/typeshade/typeshade/pull/1054), contains those clarifications.
The agent directed acceptance under the owner's standing authorization once they were included.
A separate Codex source audit confirmed existing transitive reachability, guard ownership,
console metadata and the distinct compute signature. No implementation was written during
proposal review.

The orchestrating agent's subsequent document audit found that §64's host-view table also
unconditionally spells the fragment signature with two required arguments. It approved adding
surface §64 to the declaration and updating that table to describe the same optionality before
the accepted merge. This corrects the documentation scope and adds no behavior.

The approved scope is Rule 8.24's fragment call, surfaces §64 and §67, the declared host view/runtime
change, required validation and downstream obligations. Compute argument positions, the
program runtime and the RHI remain outside it. A Codex agent in `typeshade/typeshade` is assigned
implementation within that scope. The orchestrating agent coordinates independent review and
merge after required checks pass. No milestone date or resource estimate is established.
Downstream adoption belongs to each adopting repository's compiler-pin work and remains pending.
The merge of PR #1054 with `status: accepted` establishes the approved baseline; implementation
starts only after that merge.

### Configuration and validation record

Implementation is in [PR #1056](https://github.com/typeshade/typeshade/pull/1056), following
the accepted merge `cadf1f07b733cdf6e307a1d56fc0c5ea9f3595f9` of PR #1054.
The first implementation commit is `aac6af9392d69037985830764c05fc31799204cb`.
Merge commit `9d7bd524472ff0daeba59d1965bc1726abd9002f` integrates `main` at
`00c8d0eb2bcf9684c91a1b585ef991f1cf631d89`. Git and the pull request identify later
validation-record revisions and the eventual delivered merge. No release version is assigned.

A Codex implementation agent changed the generated fragment signature and `callDraw`.
Both use the existing `isGuard` metadata predicate over the entry's existing binding set.
Only eligible calls normalize omitted or `undefined` bindings to `{}`. Compute calls,
metadata shapes, public exports, owner selection and existing invalid-value checks stay unchanged.
A second agent supplied compile-gate and packed-journey coverage. An independent agent and
the orchestrating agent reviewed the core implementation, tests and documents without findings.

Functional observations on 2026-11-06 UTC, with Node 24.22.1 and Bun 1.4.4:

- The focused host/compiler/API/policy run passed 173 tests in seven files.
  Independent review passed 75 tests in four files. The API snapshot did not change.
- The new tests check shader compiler/language-service agreement and generated host
  tsc/TypeScript-language-service agreement. CPU draws match independent pixel values.
  They cover empty, unused, other-entry, guard-only, console-only and decorator cases;
  direct, helper and authored `_fp64`/`_console` bindings remain required.
- On the accepted baseline, the first 13 regression tests produced eight failures and
  five passing controls. All 14 final tests pass with the implementation, including fuse refusal.
- The bundle-boundary gate passed for all five checked public subpaths. The new compiler
  import uses an existing authority and performs no GPU/device work at module import time.
  An independent same-path browser build of `hostFace` measured 4,959,328 to 4,959,732
  minified bytes and 1,393,901 to 1,394,068 gzip bytes: increases of 404 and 167 bytes.
  No dependency or bundle budget changed.
- Build, lint, format, compile-gate and packed-journey results for the integrated configuration
  are pending and will be recorded before delivery.

The document audit updated Rule 8.24, surfaces §64 and §67, `AUTHORING.md`, the changelog,
roadmap, journey description and generated requirement records. The documentation-reference
check and strict Doorstop validation passed. Existing bound examples, compute contracts and
architecture references remain accurate. Historical proposals retain their baseline descriptions.

One existing-contract correction changes Rule 8.24's unsupported-value example from
"an emulated f64" to "a matrix of f64". PR #344, merged at
`787dbaec2445774ab5e12912cb241d652b8255e8`, already delivered scalar/vector/array f64
host values under changes 0013 and 0016. Current scalar uniform/storage probes are callable;
matrix probes still produce `never`. The orchestrating agent approved this documentation
correction within the declared rule. It adds no runtime behavior. Disposition: closed.

No implementation deviation remains open. Website and editor changes, compiler pins and
their validation remain pending under the downstream obligations below. Compiler completion
does not establish downstream adoption.

## What it owes downstream

- **typeshade.github.io.** Reviewed snapshot
  `bca213452566152ed4b1b55dbdf8294c10d9a33a`. The shared
  [Quick Start component](https://github.com/typeshade/typeshade.github.io/blob/bca213452566152ed4b1b55dbdf8294c10d9a33a/src/components/pages/QuickStartPage.astro)
  currently writes `fs(canvas, {})`; use `fs(canvas)` for that binding-free shader.
  The [host starter generator](https://github.com/typeshade/typeshade.github.io/blob/bca213452566152ed4b1b55dbdf8294c10d9a33a/src/scripts/playground-host-default.ts)
  should omit the object only for eligible fragments. Keep nonempty fragment and compute
  calls unchanged. Update the host-call copy in the English and Korean i18n files and the
  [Korean CPU guide](https://github.com/typeshade/typeshade.github.io/blob/bca213452566152ed4b1b55dbdf8294c10d9a33a/content/guide/ko/the-cpu-oracle.md).
  The English guide follows the pinned `AUTHORING.md`. Verify both Quick Start languages and
  generated host calls with the adopted compiler. Record 0125 in `compiler-changes.md`.
- **vscode-typeshade.** Reviewed snapshot
  `db3f4171d6ea4689d6048d2252b6553da4599906`. Update the
  [host reference](https://github.com/typeshade/vscode-typeshade/blob/db3f4171d6ea4689d6048d2252b6553da4599906/plugins/typeshade/skills/typeshade/references/host.md)
  and the adjacent skill's host section. Extend
  [HOST_IMPORT_PROJECT](https://github.com/typeshade/vscode-typeshade/blob/db3f4171d6ea4689d6048d2252b6553da4599906/packages/tsserver-plugin/src/fixtures.ts)
  with an eligible fragment and an omitted bindings call. Preserve the current plasma fixture,
  whose `frame` uniform is required. Check omission and required-binding errors through the
  tsserver integration. Record 0125 in `compiler-changes.md` when the compiler pin moves.

These are accepted obligations for downstream compiler-pin work. Actual downstream changes,
pins and validation remain separately tracked and pending until delivered.
