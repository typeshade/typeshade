---
id: '0122'
title: Host faces can identify fusion modules independently of their source paths
status: accepted
rules: []
surface:
  - 64
  - 71
exports:
  - HostFaceOptions
  - TypeshadeVitePlugin
  - TypeshadeViteOptions
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: Document the optional hostFace origin and opt-in Vite originNamespace when adopting; confirm the generated API reference and record 0122.
  - repo: vscode-typeshade
    what: Check the compiler pin and any newly exposed portable-origin guidance; no direct caller migration was found; record 0122 when adopting.
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
| Identity and status           | Proposal 0122, accepted for merge under the owner's standing authorization. Front matter controls its lifecycle.                                                |
| Date and attribution          | Authored 2026-11-06 UTC by Codex while progressing the owner's remaining-issue request. This date records authorship.                                           |
| Request source                | Issue [#805](https://github.com/typeshade/typeshade/issues/805), observed in TypeCV and reproduced by inspection of the current plugin and host-face generator. |
| Applicability / Effectivity   | Host-face generation and Vite integration. GPU arithmetic and the runtime fusion algorithm are unchanged. Release version unassigned.                           |
| Review baseline               | `main` at `626b829984a9b5312082d987ee53a810f9b45f32`.                                                                                                           |
| Review and revision authority | Proposal [PR #1044](https://github.com/typeshade/typeshade/pull/1044). Git records revisions; its accepted merge makes the decision effective.                  |

## What changes

Add optional `readonly origin?: string` to `HostFaceOptions`. When present, the exact string
identifies the generated module's fusion records. When absent, keep `fileName` as the origin.
An empty string is an explicit origin, not an instruction to use the default. Hosts that supply
origins must assign distinct keys to distinct modules that can share a fusion scope.

`fileName` continues to resolve imports, name diagnostics, locate watched files and select the
host-view destination. The override does not change shader compilation, source spans, generated
function names, host types or fusion eligibility. With `fuse: false`, it adds no fusion record.
This preserves Rules 3.9, 8.21 and 11.13; their normative text need not change.

Add optional `readonly originNamespace?: string` to `TypeshadeViteOptions`. Omitting it
preserves the existing file-name origin. Supplying a nonempty namespace opts into portable
fusion identity. Each independently built package that can share a fusion scope must use a
distinct namespace. A package name is a useful choice; the compiler does not allocate it.

Extend `TypeshadeVitePlugin.configResolved` to accept optional `readonly root?: string` beside
`command`. With an explicit namespace, require an absolute root and an absolute module path
on the same filesystem root. Strip the query suffix as for the existing source path, compute
the module path relative to the root and normalize its separators to forward slashes. Set
origin to `JSON.stringify([namespace, relativePath])`; tuple encoding avoids ambiguous delimiters.
Keep nested paths and `../` segments. A basename is not an identity.

For example, the same module at "src/kernels/scale.shade.ts" in two checkouts of package
"@acme/effects" has one origin, the JSON tuple of those two strings. Another package uses its
own namespace. Different paths inside one package also produce distinct origins.

An empty namespace, an unavailable or non-absolute root, a non-absolute shader path, or paths
on different drives or UNC shares are configuration errors when portability is enabled.
Report a plain plugin error explaining the invalid configuration; add no TS80xx diagnostic.
Without the option, existing direct hook calls without a root remain valid. With the option,
modules outside the root retain `../`; reproducibility assumes their relative layout is stable.
Do not trim the namespace, normalize it as a path or silently fall back to an absolute origin.

Explicit `hostFace.origin` values are complete opaque keys, whereas `originNamespace` names a
Vite build's module family. Both require hosts to keep different modules' identities distinct.
The compiler does not promise global uniqueness when hosts deliberately reuse an identity.

## Why

The plugin currently passes Vite's absolute module ID as `fileName`. The host-face generator
copies it into each kernel's fusion origin. The runtime uses that string as an identity key,
not as a file to open. Moving an otherwise identical checkout therefore changes its fusion
metadata and exposes a build-machine path. TypeCV compensates by rewriting generated text.

A separate option preserves source-path semantics while making identity an explicit input.
Rewriting generated JavaScript would couple the plugin to serialization details and could
replace unrelated strings. Changing `fileName` itself would change import resolution and error
locations. A basename would merge unrelated modules. Automatic root-relative keys also collide across
independently built packages with the same relative path. The runtime shares helpers by origin
and function name without comparing their bodies. Opt-in namespaces avoid introducing that
collision for existing users. Existing hand-generated faces already choose their own origins.

## What it touches

- `HostFaceOptions`: the optional identity override, with the legacy default.
- `TypeshadeVitePlugin`: the compatible optional root in the resolved configuration callback.
- `TypeshadeViteOptions`: the optional namespace that enables portable origins.
- Surface sections 64 and 71: host-face options and the meaning and limits of fusion origins.
- `docs/language-service-api.md`: document the option and unchanged `fileName` behavior.
- The Vite plugin, host-face generator, their tests, API snapshot and changelog.
- No new rules, diagnostic codes, examples, dependencies or runtime exports.

### Draft impact estimate

The implementation is a build-time option and path calculation. Existing direct `hostFace`
callers retain behavior; Vite builds with an explicit namespace intentionally change fusion keys. The work includes
API documentation, snapshots and tests. Duration and bundle-size effects are unestimated.
No GPU performance claim follows from this change.

Required functional evidence:

1. Explicit, omitted and empty origins in host-face output; `fuse: false` omits metadata.
2. Two checkout roots with one namespace yield identical fusion origins for the same relative module.
3. Distinct nested modules and distinct namespaces retain distinct origins; a fusion of different helpers agrees with unfused calls. Test Windows separators, UNC shares and invalid configuration.
4. Import resolution, watched file names, error paths and generated views retain source paths.
5. Existing Vite hooks without a root remain compatible; a real Vite build exercises the root hook.
6. Host-face/Vite tests, API snapshot, type build, lint, format and applicable CI checks pass.

Required document evidence: `docs:impact`, `docs:refs`, proposal scope and traceability checks;
read and review any changed requirements before marking them reviewed. The implementation must
record actual results and any remaining limitations, including absolute paths retained in other
metadata. The promise is portable fusion identity, not removal of every source path in every
compiler artifact.

### Approval and plan record

On 2026-11-06 UTC, the owner repeated the instruction to progress remaining work, with the
standing instruction to merge this session's PRs. Codex used that delegated authority to select
the opt-in namespace design after an independent review found the automatic-relative-key
collision in draft `63498c6a`. The revised scope is recorded in PR #1044; the accepted merge,
not this pre-merge status alone, authorizes implementation.

Codex owns compiler implementation and validation in this session. Milestones are the accepted
proposal merge, a separate implementing PR with the functional and document checks above, and
its merge after required CI passes. No delivery date or resource estimate is promised.
Downstream assignments remain unconfirmed. The declared impacts and required checks are final
for this scope. No implementation is included in the proposal PR.

### Configuration and validation record

This record does not yet apply. Delivery must identify the accepted revision, implementation PR,
actual test results and documentation checks. Compiler completion does not establish downstream
adoption. No implementation is included in this proposal PR.

## What it owes downstream

Website baseline `bca213452566152ed4b1b55dbdf8294c10d9a33a` was searched.
Its "src/scripts/playground-host-service.ts" uses `hostFace` with a URI fileName, which retains
its default. Its "src/lib/api.ts" generates the HostFaceOptions reference; confirm the new
option appears after the compiler pin moves. Benchmark and regression scripts already supply
relative file names. No immediate caller migration is required.

Editor baseline `db3f4171d6ea4689d6048d2252b6553da4599906` was searched in its package, plugin,
document and script directories. No direct consumer of these options was found. Its general
Vite references retain their meaning; add portable-origin guidance if exposing this option.
Both repositories currently pin compiler `3e1e8420a5313e045beb175131148920bfdc2d07`.
These paths identify downstream files, not files in this compiler repository.

TypeCV must validate the explicit namespace and retire its `typecv-fuse-origin` workaround
when its compiler pin includes this change. The issue record identifies PR #271 and
`vite.gpu.config.ts`; that current downstream checkout was not inspected in this session.
TypeAudio, TypeNN and Radiance may adopt a namespace when portable fusion identity is needed.
Their current settings were not inspected; no mandatory migration is established.

Each adopting repository records 0122 with its compiler pin. All downstream work remains
pending; owners and delivery dates are unassigned. No API name is removed or renamed.
