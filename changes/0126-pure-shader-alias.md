---
id: '0126'
title: A pure shader alias preserves its target's declarations and binding slots
status: draft
rules:
  - '3.9'
surface:
  - 68
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: Describe pure root aliases beside ordinary shader import reachability in both locales; verify compiler and editor examples and record 0126 when adopting.
  - repo: vscode-typeshade
    what: Update shader-import guidance and multi-document fixtures for preserved alias inventory, source diagnostics and unchanged selected imports; record 0126 when adopting.
  - repo: typecv
    what: Recheck kernel aliases against their direct targets before extending their use, preserve ordinary import expectations, and record 0126 when adopting the compiler.
---

**Document control**

| Field                         | Record                                                                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0126, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                     |
| Date and attribution          | Authored 2026-11-06 UTC by Codex while progressing the owner's remaining-issue request. This date records authorship, not approval.                                           |
| Request source                | Issue [#780](https://github.com/typeshade/typeshade/issues/780), including its unused-binding counterexample and the factual correction in PR #1057.                          |
| Applicability / Effectivity   | Shader linking through the public compiler, host-face generator, Vite, CLI and shader language service. WGSL, GLSL and CPU targets share the retained IR. Release unassigned. |
| Review baseline               | `main` at `8a3189924118f25d9edc2f4032071a171d5e01ab`.                                                                                                                         |
| Review and revision authority | No PR assigned yet. Git records revisions; PR review and an accepted merge will record the decision. No implementation is authorized by this draft alone.                     |

## What changes

Amend Rule 3.9 and surface §68 for one form of compilation root: a pure shader alias.
The proposed form is a file whose only statements are the required directive and one
non-type-only export-star declaration with a module specifier and no export clause or attributes:

```ts
"use typeshade";
export * from "./new/k.shade.ts";
```

Comments, whitespace and optional statement-ending semicolons do not affect recognition.
An additional statement, including an empty statement or another directive, makes the root
ordinary. Named re-exports, namespace re-exports, type-only export-stars and multiple stars
are ordinary roots. Import attributes do not gain support through this proposal.

### Declaration retention

Follow the pure root's single export-star through any further pure aliases. Resolve every
edge by the existing relative/package resolver and supplied import hooks. The first file that
is not a pure alias is the terminal target.

Compile the terminal target with the declaration retention and ordering used when compilation
starts from that target directly. Preserve its private and exported bindings, functions,
module variables, constants, types, overrides and entry points. Preserve dependencies those
declarations reach in other files. This includes an unused binding or an uncalled private
helper that ordinary imported-file reachability would omit. Retain and validate the target's
other module statements too, including its existing enable/diagnostic directives and cases
with no declaration unit to seed retention. This adds no directive syntax or support.

The resulting binding names, groups and slots must match direct compilation with the same
compiler options and resolver. Automatic slots retain the target's declaration order;
explicit slots retain their existing validation. Declaration ordering and name collisions
use the existing rules. Binding, override and entry-point contract names remain fixed.
Private emitted spellings can differ under existing package-provenance prefixes; preserving
declarations does not remove those prefixes. No extra resources or entry points come from
the alias itself.

This exception starts only at the requested compilation root. A pure-looking file reached
through an ordinary named import, mixed root or named re-export keeps existing reachability.
It does not promote its target to a whole retained module. The terminal target's own imports
also retain ordinary reachability. A terminal target that is itself a mixed module keeps its
own declarations and re-exports exactly as a direct compilation of that mixed module would.

### Exports, paths and identity

Retaining a private declaration does not export it. The alias keeps the public names that
its export-star exposes under existing TypeScript module rules. Private helpers, bindings
and entry points remain private to host imports. Entry-call signatures still use the
bindings that each entry reaches; retaining an unused module binding adds no host argument.

Rule 3.9's default-export refusal remains unchanged. Export-star does not forward a target's
authored default as a named host export. Apply the existing direct-compilation validation
path to the retained target; do not hide a refusal by dropping its offending declaration.
Existing gaps in default-export validation are outside this proposal and are not supported
syntax promises. This proposal adds no general default-support or refusal redesign.

The generated host module's existing default manifest remains available and reflects the
preserved declaration inventory. This generated default is distinct from an authored shader
default export; the proposal adds no default-export spelling or host API.

The requested alias remains the source-path identity of the compilation. Module names,
generated-file headers, host-view destinations and Vite module IDs continue to use the
requested path. Source spans retain the file that authored each declaration. Import failures
remain on the export/import edge that failed. A target declaration error stays on that
declaration's file and span, including through a chain; no duplicate wrapper error is added.
Watch dependencies include the alias chain, target and files the existing loader reads.

Fusion identity keeps change 0122's contract. With no override, `hostFace` uses the requested
`fileName`; an explicit `origin`, including an empty string, remains exact. Vite's optional
`originNamespace` still encodes the requested module path. Direct and alias paths therefore
remain distinct by default. The compiler does not merge their runtime instances or allocate
one shared origin. Hosts remain responsible for distinct identities of distinct modules in
one fusion scope. `fuse: false` continues to omit fusion records.

The contract is preserved shader declarations, binding layout and behavior under equal
options. It does not promise byte-identical host modules, manifests or shader text across
different paths. Path-dependent headers, source metadata, module names and fusion identities
may differ. Tests compare the defined fields directly and test behavior independently.

### Failures and cycles

A missing or unreadable target, a non-shader target and unsupported imports keep their
existing refusals. The alias does not hide a target error by dropping its offending private
declaration. A target that fails when compiled directly must also fail through its pure alias,
with the existing diagnostic code, source location and cascade suppression.

Resolve the alias chain with a visited-file set using the linker's canonical file identities.
A chain consisting only of aliases that returns to a visited file has no terminal target.
Use existing ordinary linking for that case, with no invented target or new cycle diagnostic.
Ordinary import cycles remain supported, and function call cycles retain their existing refusal.
The implementation must finish a self-alias and a multi-file alias cycle in bounded time.

**Exclusions.** No new syntax, package-resolution condition, exported API shape or diagnostic
code. No whole-module retention for ordinary imports. No runtime resource sharing between
separately imported paths. No revision of 0090's directory-placement proposal. This change
does not make every imported library, unused private declaration or unsupported program valid.

## Why

Issue #780 reports that a pure export-star alias drops an unused private binding and renumbers
later bindings. TypeCV's kernel relocation encountered this difference. PR #1057 corrected
0090's historical measurement: equality at `e03ff7e` applied only to its measured fixture.

The 2026-11-06 audit at `00c8d0eb` used public `compile`, `hostFace` and the shader language
service. Eleven configurations covered direct modules, pure and chained stars, named
re-exports, selected imports, exported unused bindings and private helpers. All had no
compiler, host-face or shader-editor diagnostics; editor WGSL matched compiler WGSL.

- An unused private binding before two reached bindings occupied slots 0, 1 and 2 directly.
  The pure alias retained only the reached bindings, at slots 0 and 1.
- With all bindings reached, an uncalled private helper still made direct and alias WGSL and
  generated modules differ. Retaining only binding declarations would not resolve this case.
- Exporting the unused binding, or reaching every binding without the private helper, produced
  matching outputs in those controls. Host views matched in the reported counterexamples.

Comparisons used the same basename, `fuse: false` and a shared explicit `origin`. These compute
cases provided no emitted GLSL comparison, GPU execution or Tint result. They establish the
retention difference, not performance or general byte identity. The review baseline includes
the factual correction; the proposed behavior is not implemented there.

Existing behavior follows Rule 3.9 and accepted change 0022: keep root declarations and the
imported declarations they reach. This proposal adds a narrow root exception rather than
describing the old behavior as an implementation of a whole-alias guarantee.

Independent probes at the review baseline found two relevant existing limits. A pure alias
cycle terminates without diagnostics and with empty inventory; the proposed fallback preserves
that behavior. Named default functions/classes and default values currently pass despite
Rule 3.9's refusal, whereas an anonymous default function reports TS8020 when compiled directly.
The latter error can disappear through an alias today. Preserving direct validation fixes that
pruning effect; general default-export enforcement remains a separate issue. Type-only stars
also retain their existing behavior outside this proposal's recognition boundary.

A package target can emit a private collision name with a package prefix absent from a direct
file compile. Existing package identity, version deduplication and prefixes remain unchanged.
The proposal preserves authored declaration correspondence and meaning, not every private spelling.

Alternatives considered:

- Keep reachability for every star and only document it. This preserves today's layout change
  when a complete module moves behind a pure alias.
- Reject a pure alias if its target has any private unreachable declaration. This rejects
  otherwise valid modules and requires authors to expose or remove private declarations.
- Retain every imported module in full. This changes ordinary library imports and their
  resource requirements, far beyond a file kept only as an alias.
- Preserve bindings alone. This fixes the reported slot shift but leaves private helpers,
  module variables and entry-point inventory different from the target.
- Reuse the target's identity for every artifact. This changes paths, watcher behavior and
  fusion-origin policy beyond declaration retention, and is not required to preserve slots.

The recommended decisions are root-only recognition, complete target inventory, unchanged
host export visibility and path identity, and ordinary linking for an alias-only cycle.
These decisions require review before acceptance. The downstream file evidence uses the
snapshots recorded below; adopting repositories have delivered no work under this proposal.

## What it touches

- **Rule 3.9:** add the pure-root exception to the module-content paragraph. Preserve ordinary
  imports, resolution, scopes, errors and cycles. Synchronize and review `reqs/rules/RULE-0309.md`.
- **Surface 68:** explain recognition, chains, preserved declarations and slots, ordinary
  import controls, diagnostics and path-sensitive output. Review `reqs/surface/SURF-068.md`.
  Its identity explanation links to existing surfaces §64 and §71; those contracts do not change.
- **Exports, codes and examples:** none added, removed or reshaped. API-surface verification
  must confirm that the existing compiler and host-face option shapes remain unchanged.
- **Implementation:** root retention in `src/compiler/ts/link.ts`, consumed by
  `src/compiler/ts/source-file.ts`, the compiler, host-face generator and language service.
  Keep one shared resolution and retention rule; do not add a second loader in Vite or the CLI.
  Retain requested-entry source mapping and host identity independently of the terminal target.
- **Documentation:** source comments, the shader import guidance in `AUTHORING.md` where
  applicable, `CHANGELOG.md`, and this proposal's implementation record. Keep 0090's historical
  measurement as a historical result, without converting it into a general identity promise.

Required functional validation:

1. Extend the linker regressions with the unused-first-binding and uncalled-private-helper
   counterexamples. Assert direct/alias declaration inventory, ordering, fixed names and slots.
   Include private module variables, overrides, types and an unexported entry point. A target
   importing another file must cover colliding private names and automatic/explicit binding
   slots. Relative targets retain equivalent naming; package targets retain existing prefixes.
2. Read the same sources with the compiler and shader language service. Assert exact diagnostic
   codes, messages, counts and source spans for invalid retained declarations and bad imports.
   Check imported-file diagnostics on their documents and suppress dependent cascades. Include
   the anonymous default-function refusal and target statements with no declaration unit.
   No authored default becomes a named host export; do not add general default-policy changes.
   A target containing only the shader directive, `"enable f16";` and `export {};` must retain
   that enable through one alias and a chain, with no compiler or shader-editor diagnostic.
3. Cover one alias, a chain, a terminal mixed module, relative and package resolution, custom
   resolver hooks and canonical path identity. Include self-alias and multi-file alias cycles.
4. Use named, selected, mixed, namespace and type-only imports/re-exports as exclusion controls.
   Additional declarations, additional stars and empty statements must keep ordinary retention.
   A pure-looking file imported by an ordinary root must not retain unrelated target declarations.
5. Check generated host views with TypeScript and a host language service. Named exports and
   required entry bindings remain correct; private retained names must not become importable.
   The generated default manifest exposes the preserved slots and entry inventory. An unused
   authored binding must not make an otherwise binding-free fragment argument required;
   preserve change 0125's omitted/undefined/empty-object behavior.
6. Compare actual WGSL for compute and render fixtures and actual emitted GLSL for render
   fixtures. Exercise supported compute-tier output through existing host/program paths;
   this proposal does not add `compile().glsl` for compute. Do not treat absent GLSL as equality.
   Allow documented identity fields and private package prefixes explicitly. Hold source spans,
   generated headers, dependency paths and alias view destinations.
7. Check default and explicit fusion origins, empty-string origin, `fuse: false`, and Vite
   `originNamespace`. Alias/direct paths remain distinct by default and explicit values remain
   unchanged. No text rewriting or global origin coalescing belongs in the implementation.
8. Extend a finite packed host-import journey with direct and aliased paths, an unused binding
   before a live binding, and a chain. Check independent outputs on the supported CPU and GPU
   tiers, retained manifest slots and host calls. Exercise generated imports, not only IR helpers.
   Validate emitted fixtures with the native shader compilers. If a front-end refusal stands
   for a native error, demonstrate its invalid case and valid neighbor with that compiler.
9. Run focused linker, host-face, language-service, Vite, CLI and API regressions, then the build,
   lint, format, compile, packed-journey and bundle-boundary checks. Existing required CI applies.
   Record actual generated-size and bundle effects; retaining more code can increase artifacts.

Required document validation: proposal-shape tests, `docs:refs`, `docs:impact`, the proposal
scope check, format and commit hooks. Implementation additionally requires `reqs:sync`,
Doorstop review of the changed rule and surface, and review of all impact items.

### Draft impact estimate

Known work is a bounded root-alias walk and a shared retention seed, plus regression and
integration coverage. Reuse the existing graph, resolver and source mapping. No new dependency,
public option, runtime tier or package subpath is planned.

Compatibility changes are intentional: a pure alias gains previously dropped private
declarations and unused resource slots. Its artifact can grow, its later automatic slots can
change, and previously hidden target errors can become visible. Direct target compilation
and ordinary imported-file retention stay the reference behavior. Existing valid host calls
keep their named exports and reached-binding arguments.

Implementation time, downstream adoption time and resource costs have not been estimated.
The acceptance review must confirm the recognition boundary, cycle fallback, identity policy,
declared documentation scope and downstream obligations. No milestone date is assigned.

### Approval and plan record

This record does not yet apply. The owner authorized continued issue work and merging the
agents' own PRs; that standing authorization is not acceptance of this specific language change.
Acceptance requires review of this contract, declared impacts and required validation, followed
by a proposal-only merge with `status: accepted`. The approval record must identify the reviewed
revision, actual decision, responsible implementation/review roles and any agreed milestones.
No compiler implementation starts before that merge.

### Configuration and validation record

Implementation records do not yet apply. Delivery must identify the accepted proposal,
implementation commits and PR, tested configuration, functional results and document validation.
Keep deviations and remaining downstream work explicit. Compiler delivery does not establish
downstream adoption.

The preliminary compiler evidence above is from the 2026-11-06 audit at `00c8d0eb`; it is not
validation of the proposed behavior. This draft's document checks will be recorded on its PR.

## What it owes downstream

- **TypeCV:** inspected at `77c6d48e52daa2a623b130332f28279681a74d04`, with compiler pin
  `78a9060f96857710c17902bb95d0d93d2210c08f`. Its 37 shader files contain 30 bodies and seven
  pure aliases. [PR #250](https://github.com/typeshade/typecv/pull/250) merged the original
  relocation work. Its current
  [digest helper](https://github.com/typeshade/typecv/blob/77c6d48e52daa2a623b130332f28279681a74d04/scripts/kernel-digests.mjs)
  and [surface test](https://github.com/typeshade/typecv/blob/77c6d48e52daa2a623b130332f28279681a74d04/tests/surface/surface.test.ts)
  compare discovered aliases without a nonempty-set check. At adoption, explicitly cover all
  seven aliases and review the 30 body digests. Add synthetic aliases of the actual feature-count
  and float-match-status kernels from #780. Compare binding slots and inventory directly,
  along with available WGSL, integer-fp64 WGSL, GLSL and host views. Keep behavioral checks.
  Default `hostFace` source/origin values and the build's separate origin rewrite prevent an
  unqualified generated-module byte claim. Coordinate the compiler pin with existing
  [PR #277](https://github.com/typeshade/typecv/pull/277), refresh the digest revision record,
  and record 0126. This proposal does not retire that origin rewrite; change 0122 owns it.
- **typeshade.github.io:** inspected at `bca213452566152ed4b1b55dbdf8294c10d9a33a`, with
  compiler submodule `3e1e8420a5313e045beb175131148920bfdc2d07`. English guidance derives from
  the compiler's `AUTHORING.md` through
  [the guide loader](https://github.com/typeshade/typeshade.github.io/blob/bca213452566152ed4b1b55dbdf8294c10d9a33a/src/lib/guide.ts).
  The Korean
  [shader-import guidance](https://github.com/typeshade/typeshade.github.io/blob/bca213452566152ed4b1b55dbdf8294c10d9a33a/content/guide/ko/the-cpu-oracle.md)
  describes ordinary reached declarations. Add the pure-root exception in both languages and
  refresh the translation source stamp. Extend the existing import-edit harness in
  `playground-diagnostics.test.ts` and `check-playground.mjs` with alias chains and target edits;
  verify compiled-output and diagnostic refresh. Record 0126 when adopting the compiler.
  <!-- doc-refs: skip — the preceding guide and test paths belong to typeshade.github.io -->
- **vscode-typeshade:** inspected at `db3f4171d6ea4689d6048d2252b6553da4599906`, with the
  same compiler submodule revision. Its
  [language reference](https://github.com/typeshade/vscode-typeshade/blob/db3f4171d6ea4689d6048d2252b6553da4599906/plugins/typeshade/skills/typeshade/references/language.md)
  presents export-star beside ordinary reachability. Explain the root-only exception there.
  Extend `model.test.ts`, `tsserver.test.ts` and MCP `tools.test.ts` beyond their existing
  named-import cases: alias/chain compiled output, source diagnostics, target-edit invalidation,
  host views and unchanged selected imports. Check preview reflection/run and MCP compilation
  using the shared compiler; add no duplicate resolution policy. Record 0126 when adopting.
  <!-- doc-refs: skip — the preceding test paths belong to vscode-typeshade -->

The downstream snapshots were read, not tested or changed. Adoption, compiler-pin identities,
`compiler-changes.md` records and downstream-impact checks remain pending in each repository.
<!-- doc-refs: skip — compiler-changes.md is a record in each downstream repository -->

The adopting repositories own that work. No downstream completion date is assigned.
