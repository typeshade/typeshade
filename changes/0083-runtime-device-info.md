---
id: '0083'
title: A host reads the TypeShade build and the opened device through shared runtime information
status: draft
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

| Field                         | Record                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0083. Front-matter status is `draft`.                                                                                                    |
| Date and attribution          | Authored by a Codex agent on 2026-10-22 UTC. This date identifies draft authorship.                                                               |
| Request source                | The owner asked whether TypeShade itself could provide its version and executing-device information during the voluntary benchmark work.          |
| Applicability / effectivity   | Host APIs exported by `typeshade` and `typeshade/runtime`; WebGPU, WebGL2 and CPU device owners. No release version is assigned.                  |
| Review baseline               | `main` at `94203d3cab6433065bbe111c3b93f66a4058828e`.                                                                                             |
| Related work                  | Proposal 0082's measurement work is draft PR #734. Site PR #215 implements a broader voluntary benchmark against the existing compiler pin.       |
| Review and revision authority | No proposal PR is assigned yet. Git records revisions; PR review and merge evidence will record decisions. This draft approves no implementation. |

## What changes

The proposed API exposes one immutable build description and one device-information format.
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
  The accepted design must choose an explicit modified-source flag or a `null` revision.

The runtime's version and the compiler that produced a program are separate facts.
`Pack.compiler` continues to identify that compiler's package version. This proposal does not
change the manifest schema. Benchmark catalog revisions, compiler pins and shader hashes remain
separate provenance. A package version alone does not distinguish unreleased compiler commits.

### Device information

Export `DeviceInfo` and add a readonly `info` snapshot to `Device` and `Runtime`.
The proposed shape contains `build`, `tier`, `webgpu` and `webgl`. Backend sections are nullable.
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

Before acceptance, resolve the following decisions:

1. Confirm `buildInfo`, `Device.info` and `Runtime.info`, including nullable backend sections and identity provenance.
2. Choose how packaging represents modified or unstamped sources without claiming an exact clean revision.
3. Confirm that per-call execution attribution is excluded and that `FuseReport.tier` retains its existing meaning.
4. Confirm the frozen snapshot's lifetime after device loss or disposal. The proposed choice retains historical metadata with no claim of current availability.

### Approval and plan record

This record does not yet apply. Acceptance requires a reviewed API shape, build-stamping
semantics, declared downstream work and merged `accepted` proposal. No approval or implementation
is recorded by this draft.

### Configuration and validation record

This record does not yet apply to implementation. Required future evidence includes:

- Type and API-golden checks for both entry points and the new structural exports.
- Version equality with package metadata and honest clean, modified and unstamped build cases.
- WebGPU own-device and external-device identity, immutable copies, enabled capabilities and no extra adapter request.
- WebGL2 actual-context attribution, missing debug extension, redacted strings and getter failures.
- CPU and non-browser imports, independent owners, loss and disposal semantics.
- Real-browser integration, runtime bundle boundaries and measured size changes.
- Host journeys using the packed npm artifact, plus functional and document audits at the delivered commit.

Proposal-only validation results and its actual PR will be recorded before review.

## What it owes downstream

The site adopts shared metadata after a validated compiler pin and documents it in both languages.
Its benchmark keeps workload/compiler/shader provenance and consent. Until then, PR #215 uses
its own attributed browser observations. No runtime-info feature is claimed by its current pin.

The editor updates host API references without adding host names to the shader ambient library.
TypeCV, TypeNN and Radiance review their duplicate device reporting and supplied-device paths.
Each downstream records the implementation pin and actual validation separately. Those changes
remain pending while this proposal is a draft.

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
