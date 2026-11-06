---
id: '0122'
title: Host faces can identify fusion modules independently of their source paths
status: draft
rules: []
surface:
  - 64
  - 71
exports:
  - HostFaceOptions
  - TypeshadeVitePlugin
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: Explain portable Vite fusion origins and the optional hostFace origin in both language references; record 0122 when adopting.
  - repo: vscode-typeshade
    what: Update hostFace and fusion references for explicit origins and Vite root-relative origins; record 0122 when adopting.
  - repo: typecv
    what: Retire the typecv-fuse-origin text rewrite after validating equivalent origins with the new compiler pin; record 0122.
  - repo: typeaudio
    what: Check generated fusion origins and any report or bundle snapshots when adopting; record 0122.
  - repo: typenn
    what: Check generated fusion origins and any report or bundle snapshots when adopting; record 0122.
  - repo: radiance
    what: Check generated fusion origins and any report or bundle snapshots when adopting; record 0122.
---

**Document control**

| Field                         | Record                                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0122, draft. Front matter controls its lifecycle.                                                                                                      |
| Date and attribution          | Authored 2026-11-06 UTC by Codex while progressing the owner's remaining-issue request. This date records authorship.                                           |
| Request source                | Issue [#805](https://github.com/typeshade/typeshade/issues/805), observed in TypeCV and reproduced by inspection of the current plugin and host-face generator. |
| Applicability / Effectivity   | Host-face generation and Vite integration. GPU arithmetic and the runtime fusion algorithm are unchanged. Release version unassigned.                           |
| Review baseline               | `main` at `626b829984a9b5312082d987ee53a810f9b45f32`.                                                                                                           |
| Review and revision authority | No PR assigned yet. Git records revisions; the accepted proposal's PR merge records the decision.                                                               |

## What changes

Add optional `readonly origin?: string` to `HostFaceOptions`. When present, the exact string
identifies the generated module's fusion records. When absent, keep `fileName` as the origin.
An empty string is an explicit origin, not an instruction to use the default. Hosts that supply
origins must assign distinct keys to distinct modules that can share a fusion scope.

`fileName` continues to resolve imports, name diagnostics, locate watched files and select the
host-view destination. The override does not change shader compilation, source spans, generated
function names, host types or fusion eligibility. With `fuse: false`, it adds no fusion record.
This preserves Rules 3.9, 8.21 and 11.13; their normative text need not change.

Extend `TypeshadeVitePlugin.configResolved` to accept optional `readonly root?: string` beside
`command`. With an absolute root and module path on the same filesystem root, the plugin passes
the module path relative to that root as `origin`, using forward slashes. It keeps nested paths
and any `../` segments; it never reduces identity to a basename. Query suffixes are removed as
for the existing file path. Source and diagnostic paths remain absolute.

For example, "/home/alice/app/src/kernels/scale.shade.ts" under root `/home/alice/app` records
"src/kernels/scale.shade.ts". The equivalent checkout under `/build/app` records the same key.
Different modules such as "src/a/scale.shade.ts" and "src/b/scale.shade.ts" retain different keys.
Windows paths on the same drive use the same slash-normalized relative form.

A direct plugin invocation without `root`, or a path that cannot be made relative across
filesystem roots, retains its existing file-name origin. This avoids breaking existing hook
callers and avoids conflating Windows drives. Outside-root modules retain their relative path;
reproducibility depends on preserving their relative layout. Origins are scoped identifiers,
not globally unique package IDs. Hosts combining independently generated packages should use
explicit namespaced origins through `hostFace`.

## Why

The plugin currently passes Vite's absolute module ID as `fileName`. The host-face generator
copies it into each kernel's fusion origin. The runtime uses that string as an identity key,
not as a file to open. Moving an otherwise identical checkout therefore changes its fusion
metadata and exposes a build-machine path. TypeCV compensates by rewriting generated text.

A separate option preserves source-path semantics while making identity an explicit input.
Rewriting generated JavaScript would couple the plugin to serialization details and could
replace unrelated strings. Changing `fileName` itself would change import resolution and error
locations. A basename would merge unrelated modules. A global package identity scheme is outside
this proposal; existing hand-generated faces already choose their own origins.

## What it touches

- `HostFaceOptions`: the optional identity override, with the legacy default.
- `TypeshadeVitePlugin`: the compatible optional root in the resolved configuration callback.
- Surface sections 64 and 71: host-face options and the meaning and limits of fusion origins.
- `docs/language-service-api.md`: document the option and unchanged `fileName` behavior.
- The Vite plugin, host-face generator, their tests, API snapshot and changelog.
- No new rules, diagnostic codes, examples, dependencies or runtime exports.

### Draft impact estimate

The implementation is a build-time option and path calculation. Existing direct `hostFace`
callers retain behavior; normal Vite builds intentionally change fusion keys. The work includes
API documentation, snapshots and tests. Duration and bundle-size effects are unestimated.
No GPU performance claim follows from this change.

Required functional evidence:

1. Explicit, omitted and empty origins in host-face output; `fuse: false` omits metadata.
2. Two checkout roots yield identical fusion origins for the same relative module.
3. Distinct nested modules retain distinct origins; Windows separators and drive boundaries are tested.
4. Import resolution, watched file names, error paths and generated views retain source paths.
5. Existing Vite hooks without a root remain compatible; a real Vite build exercises the root hook.
6. Host-face/Vite tests, API snapshot, type build, lint, format and applicable CI checks pass.

Required document evidence: `docs:impact`, `docs:refs`, proposal scope and traceability checks;
read and review any changed requirements before marking them reviewed. The implementation must
record actual results and any remaining limitations, including absolute paths retained in other
metadata. The promise is portable fusion identity, not removal of every source path in every
compiler artifact.

### Approval and plan record

This record does not yet apply. Acceptance requires review of the proposed scope and merging
this proposal as accepted before implementation. The owner has authorized continued issue work
and merging the assistant's PRs; that standing authorization governs the eventual merge.

### Configuration and validation record

This record does not yet apply. Delivery must identify the accepted revision, implementation PR,
actual test results and documentation checks. Compiler completion does not establish downstream
adoption. No implementation is included in this proposal PR.

## What it owes downstream

The website and editor must update references that teach `hostFace` or describe fusion metadata.
Exact paths and search evidence will be recorded before acceptance. No existing API name is
removed or renamed.

TypeCV must validate and remove its `typecv-fuse-origin` workaround when its compiler pin includes
this change. Its issue record identifies PR #271 and `vite.gpu.config.ts`; the current downstream
checkout has not yet been inspected in this session.

TypeAudio, TypeNN and Radiance should inspect snapshots or generated faces when their pins move.
No required code migration is established for those repositories. Downstream owners and delivery
dates are unassigned; all downstream adoption and compiler-change records remain pending.
