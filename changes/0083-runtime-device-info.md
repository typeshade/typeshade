---
id: '0083'
title: A host reads the TypeShade build and the opened device through shared runtime information
status: implemented
rules:
  - '11.8'
  - '11.11'
  - '11.17'
surface:
  - 65
  - 69
exports:
  - buildInfo
  - TypeShadeBuildInfo
  - DeviceInfo
  - Device
  - Runtime
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: Document the shared build and device information in English and Korean. Adopt it in the benchmark runner at a validated compiler pin, retaining separate experiment and shader provenance. Translate the new API JSDoc and record 0083 at the implementation pin.
  - repo: vscode-typeshade
    what: Explain the host information API in the skill's runtime reference. Record 0083 at the implementation pin. No shader ambient declaration changes.
  - repo: typecv
    what: Replace duplicate device metadata extraction where the engine owns a TypeShade Device or Runtime. Keep explicit sending consent and separate workload provenance. Validate externally supplied devices and record 0083 at the implementation pin.
  - repo: typenn
    what: Adopt shared metadata in device reports where applicable. Validate existing device creation and diagnostics, then record 0083 at the implementation pin.
  - repo: radiance
    what: Document runtime information for host diagnostics where applicable. Validate externally supplied devices and record 0083 at the implementation pin.
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0083. Front-matter status is `implemented`.                                                                                                                                                                                  |
| Date and attribution          | Authored by a Codex agent on 2026-10-22 UTC. This date identifies draft authorship.                                                                                                                                                   |
| Request source                | The owner asked whether TypeShade itself could provide its version and executing-device information during the voluntary benchmark work.                                                                                              |
| Applicability / effectivity   | Host APIs exported by `typeshade` and `typeshade/runtime`; WebGPU, WebGL2 and CPU device owners. No release version is assigned.                                                                                                      |
| Review baseline               | `main` at `94203d3cab6433065bbe111c3b93f66a4058828e`.                                                                                                                                                                                 |
| Related work                  | Proposal 0082 was accepted through PR #737, and its first implementation merged through PR #738. Site PR #217 delivered the unified benchmark. Physical-device projection validation remains pending.                                 |
| Review and revision authority | [PR #735](https://github.com/typeshade/typeshade/pull/735) carries the approved proposal. The owner approved it in the conversation on 2026-10-22 UTC. Git records revisions. Implementation requires this accepted revision on main. |

## What changes

The API exposes one immutable build description and one device-information format.
Hosts can read these without loading the compiler, requesting a second adapter or sending data.
Rules 11.8, 11.11 and 11.17 continue to govern device ownership, the runtime boundary and host escape hatches.

```ts
import { buildInfo, createDevice } from 'typeshade/runtime';

const device = await createDevice();
console.log(buildInfo.version);
console.log(device.info);
```

A program runtime exposes the same shape as `runtime.info`. `Device.info` describes the device
that opened. It does not claim that every kernel call ran there. Existing fallback remains valid.
The implementation adds no mutable, process-global "last device" or "last call" field.

### Build information

Export `buildInfo` and its type `TypeShadeBuildInfo` from the root and runtime entry points.
The object has a package version and a nullable source revision. Its objects are frozen.

- `version` is the TypeShade package version. It agrees with the existing internal `VERSION`.
- `revision` is an exact source revision only when the build can establish it. Otherwise it is `null`.
- A browser performs no Git operation. A source checkout never guesses its revision from a release version.
- Build metadata is generated during packaging, with no import of package metadata at browser run time.
- A build from modified sources cannot claim that an unmodified commit fully identifies it.
  Modified or unstamped sources use a `null` revision. No modified-source flag is added.

The runtime's version and the compiler that produced a program are separate facts.
`Pack.compiler` continues to identify that compiler's package version. This proposal does not
change the manifest schema. Benchmark catalog revisions, compiler pins and shader hashes remain
separate provenance. A package version alone does not distinguish unreleased compiler commits.

### Device information

Export `DeviceInfo` and add a readonly `info` snapshot to `Device` and `Runtime`.
The shape contains `build`, `tier`, `webgpu` and `webgl`. Backend sections are nullable.
Nested structural types belong to `DeviceInfo`; separate exports are not proposed.

For WebGPU, copy the information of the actual device or its retained creation adapter:

- Adapter vendor, architecture, device and description, and fallback status when reported.
- Enabled device features and numeric device limits, copied and frozen.
- A provenance value identifying a device-provided report, a retained creation adapter or unavailable identity.

Supported adapter capabilities and enabled device capabilities are different facts. The
initial snapshot reports enabled features and limits. It must not label them adapter maxima.
A host can continue to use a raw adapter to inspect supported capabilities.

A host-supplied `GPUDevice` is common. Read its standard `adapterInfo` when available.
When neither it nor a retained creation adapter supplies identity, report unavailable identity.
Never request another adapter and attribute that adapter's strings to the supplied device.

For WebGL2, query the context the runtime or owner actually uses. Report the masked vendor and
renderer, plus nullable unmasked strings from `WEBGL_debug_renderer_info` when available.
Missing extensions, redacted values and getter failures remain unavailable. Reading `info`
never creates an unrelated context. CPU has no GPU identity; both backend sections are `null`.

An optional WebGL probe in a WebGPU benchmark remains a separate observation. It may select
another GPU. It must not be inserted into `Device.info.webgpu` or presented as its verified identity.
Browser user-agent information belongs to the host's benchmark record, outside this library API.

A snapshot is JSON-serializable and contains no native handles, promises or persistent device ID.
It is local information. TypeShade adds no network request, storage or automatic telemetry.
The host remains responsible for record inspection and explicit sending consent.

### Execution attribution

The opened device's `tier` and an individual call's effective tier are separate facts.
`FuseReport.tier` currently records the best tier any call used. It does not prove that all
calls used that tier. This proposal preserves that contract and does not relabel the report.

A benchmark that requires a GPU uses a required tier and verifies its execution path.
A future per-call execution report needs its own declared design. It is outside this proposal.
This keeps device metadata useful without claiming execution evidence it cannot establish.

## Why

The current code supplies useful pieces without a shared identity report:

- `src/core/version.ts` keeps `VERSION` for `Pack.compiler`, without a public runtime build API.
- `Device` exposes its opened tier, skipped tiers, limits, lost signal and allocation statistics.
- `Runtime` exposes its native device, tier and limits.
- `callDevice()` reports enabled features and numeric limits.
- Site PR #215 independently gathers WebGPU adapter and WebGL renderer metadata for benchmarks.

Each downstream engine otherwise repeats version injection, adapter retention, nullable identity
and WebGL extension handling. A shared snapshot can give those cases one tested meaning.
It also preserves the runtime-only bundle boundary instead of asking applications to import the compiler.

Alternatives are to keep metadata in each consumer or return raw browser objects. The first
repeats attribution errors. The second is not serializable and exposes platform differences to every host.
An immutable structural report keeps ownership and unavailable information explicit.

## What it touches

- Rules 11.8 and 11.11 gain the device and runtime snapshot contract. Rule 11.17 explains its relationship to native handles.
- Surface sections 65 and 69 describe host-device and program-runtime information.
- `Device` and `Runtime` gain `info`. `buildInfo`, `TypeShadeBuildInfo` and `DeviceInfo` are new root/runtime exports.
- Device creation retains the adapter metadata already observed. Wrapping external devices preserves unknown identity.
- Packaging generates truthful build provenance. Existing compiler-version equality tests remain applicable.
- No shader spelling, diagnostic code, example registry entry or IR type changes.

### Draft impact estimate

Expected work includes runtime metadata helpers, device creation, packaging, API goldens and
host documentation. CPU and non-browser imports must remain safe. Existing device ownership,
disposal, loss handling, tier fallback and manifest compatibility must remain unchanged.

The runtime-only dependency boundary remains mandatory. Measure bundle growth with
`gate:boundary`. If a budget must change, record old, measured and new values in `CHANGELOG.md`.
No additional runtime dependency is proposed. Duration and cost are unestimated.

The owner approved the proposal on 2026-10-22 UTC. The accepted decisions are:

1. Expose `buildInfo`, `Device.info` and `Runtime.info` with nullable backend sections and explicit identity provenance.
2. Stamp an exact clean source revision during packaging when it is established. Modified or unstamped sources report `revision: null`.
3. Exclude per-call execution attribution. Preserve `FuseReport.tier` and its existing aggregate meaning.
4. Retain the frozen snapshot after device loss or disposal as historical metadata. It makes no claim of current availability.

### Approval and plan record

The owner approved the proposal in the conversation on 2026-10-22 UTC after reviewing the
reported API and PR #735. This revision records the decisions above. A Codex agent is responsible
for implementation and validation within the declared scope. No completion date or cost is assigned.

Accepted proposal head `1d1f6b0c3735504e0c55643d7961ab4cbac6e18c` passed
[CI run 39743498245](https://github.com/typeshade/typeshade/actions/runs/39743498245).
The owner requested its merge in the conversation on 2026-10-22 UTC. PR #735 merged as
`dab376596884ff987d518f8b27ed8a6bbd767ea3` before implementation started.
[PR #736](https://github.com/typeshade/typeshade/pull/736) implements this accepted scope on
`agent/0083-runtime-info-implementation`. Downstream adoption follows a tested implementation
pin. Site PR #217 merged the unified benchmark while retaining its existing compiler pin.

### Configuration and validation record

A Codex agent implemented and validated the compiler change on 2026-10-22 UTC. The source
implementation is `b13bf71bcb3e5e206d3e9532e3961a15a5953da9`, based on accepted main
`dab376596884ff987d518f8b27ed8a6bbd767ea3`. PR #736 carries the code and this validation
record. Git records the later document revision. No npm release or downstream pin is claimed.

The delivered API exports `buildInfo`, `TypeShadeBuildInfo` and `DeviceInfo` from both entry
points. `Device.info` and `Runtime.info` hold deeply frozen historical snapshots. WebGPU
identity provenance is `device`, `adapter` or `unavailable`; only the enabled device supplies
features and limits. WebGL strings come from the actual context. CPU has no GPU section.
Tests cover absent/redacted identity, getter failures, external ownership, independent devices,
device loss, disposal and the absence of an unrelated adapter request.

A successful forced build records its source revision and emitted-tree fingerprint. Packaging
stamps that revision only while both source and artifact still match the receipt. Missing or
stale receipts, modified artifacts, modified sources and archives produce `revision: null`.
Source imports stay unstamped. The actual publish-manifest command was also run in an isolated
clean checkout: all 34 promised entry-point files existed and the imported built runtime
reported version `0.1.0` and the exact implementation revision above.

Tools: Bun 1.4.3, Node 24.19.0, TypeScript 5.6.3, Chromium 154.0.8037.57 and Doorstop 3.2.
GPU execution used the software-backed container browser; it establishes integration correctness,
not physical-device performance. The validation configuration was held fixed for the full suite.

| Validation                                                       | Observed result on 2026-10-22 UTC                                                                                |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `bun run build`                                                  | Passed with forced emission, test/script types and the clean build receipt.                                      |
| `bun run lint`, `bun run format:check`                           | Passed.                                                                                                          |
| `bun run test`                                                   | 470 files passed; 10,830 tests passed, 4 skipped and 1 todo.                                                     |
| `bun run gate:compile`                                           | 184 WGSL examples, 127 GLSL programs, 122 render pipelines and all entry-call checks passed.                     |
| `TYPESHADE_CHROMIUM=/usr/bin/chromium bun run gate:journeys`     | 30 journeys and 112 runs passed; packed host imports, runtime information, real WebGPU and WebGL2 checks passed. |
| `bun run gate:boundary`                                          | All five entry points passed dependency, size and CSP checks.                                                    |
| `bun run docs:impact --check`, `bun run docs:refs`               | No required fixes; zero dead references. Reviewed ownership, fallback, escape-hatch and packaging descriptions.  |
| `bun run reqs:sync`, `python scripts/doorstop-check.py -C -e -F` | Passed after reviewing changed rules and the affected surface links.                                             |
| `bun scripts/changes.ts`, `bun scripts/ifchange.ts`              | Passed with `Change: 0083`; all changes stay within the accepted scope.                                          |

[CI run 39750907056](https://github.com/typeshade/typeshade/actions/runs/39750907056)
retains independent workflow evidence for the source implementation. Its exact job status is
reported by GitHub; this record does not predict pending results. A later document-only head
requires its own checks before merge. The compiler implementation is complete in this PR tree;
merge, release and downstream adoption remain separate actions.

`CHANGELOG.md` records the measured bundle changes and budgets. No runtime dependency, shader
spelling, manifest schema or per-call attribution was added. Proposal 0082 remains accepted pending controlled physical-device validation, and
proposal 0081 deviation D1 remains open. No private device submissions are included in this PR.

### Integration with proposal 0082

On 2026-10-22 UTC, a Codex agent integrated main `918c014917383082bd3857394ee28e87c782339a`
into PR #736. That baseline includes the private kernel input projection from PR #738.
The merge retains projection packing, device ownership and the runtime-information implementation.
It resolves the changelog, measured bundle budgets and requirement-link fingerprints.
The source API remains unchanged from the implementation described above.

The integrated tree passed `bun run build`, `bun run lint`, `bun run format:check`,
`bun run gate:boundary` and `TYPESHADE_CHROMIUM=/usr/bin/chromium bun run gate:compile`.
The compile gate checked 184 WGSL examples, 127 GLSL programs, 122 render pipelines and host entry calls.
Document references, requirement synchronization, Doorstop and IfChange checks passed.
Proposal-scope review against that exact main revision found no undeclared change.
During the uncommitted merge, the normal scope command still used the older common ancestor;
the same checker passed with the exact incoming main as its diff base.

The full unit suite, GPU differential and packed journeys are in progress at this document revision.
PR #736 records their completed results and the exact integration head before merge.
The first compile invocation lacked `TYPESHADE_CHROMIUM` and could not launch a browser.
The explicit Chromium invocation above passed. This is software-browser validation;
physical-device projection performance and downstream adoption remain pending.

## What it owes downstream

The site adopts shared metadata after a validated compiler pin and documents it in both languages.
Its benchmark keeps workload/compiler/shader provenance and consent. Until then, the unified benchmark from site PR #217 uses
its own attributed browser observations. No runtime-info feature is claimed by its current pin.

The editor updates host API references without adding host names to the shader ambient library.
TypeCV, TypeNN and Radiance review their duplicate device reporting and supplied-device paths.
Each downstream records the implementation pin and actual validation separately. Those changes
remain pending until compiler implementation and validated pin updates.

### Proposal validation

On 2026-10-22 UTC, at base `94203d3c`, the proposal-only working tree passed:

| Command                                                                       | Observed result                                    |
| ----------------------------------------------------------------------------- | -------------------------------------------------- |
| `bun run docs:impact`                                                         | No affected prose or required fixes.               |
| `bun run docs:refs`                                                           | Zero dead references.                              |
| `bun run reqs:sync`                                                           | Requirement records unchanged.                     |
| `python scripts/doorstop-check.py -C`                                         | Passed; no item required a review or clear action. |
| `bun run build`                                                               | Passed, including test and script types.           |
| `bun run lint`                                                                | Passed.                                            |
| `bun run format:check`                                                        | Passed.                                            |
| `bun run test src/changes.test.ts src/changelog.test.ts src/ifchange.test.ts` | 29 tests passed.                                   |

These checks validate the draft and unchanged baseline. They do not validate a future
runtime-info implementation. GPU gates and host journeys were not run for this proposal-only diff.
