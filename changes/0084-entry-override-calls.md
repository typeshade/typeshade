---
id: '0084'
title: A host selects compute-entry override constants in direct calls and device plans
status: draft
rules:
  - '8.24'
  - '11.8'
  - '11.11'
  - '11.13'
surface:
  - 67
  - 69
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: Document the optional constants argument of compute-entry calls, resolved workgroup shapes and caching in English and Korean. Record 0084 at the implementation pin.
  - repo: vscode-typeshade
    what: Update the host/runtime references for compute-entry constants, CPU parity and WebGL2 specialization limits. Record 0084 at the implementation pin.
  - repo: typecv
    what: Select validated BA workgroup variants through entry calls inside the existing TypeShade device plans. Retain integer fp64 selection, numerical oracles, device limits and dispatch accounting. Record 0084 at the implementation pin.
---

**Document control**

| Field                         | Record                                                                                                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0084. The front-matter status is `draft`.                                                                                                                                                        |
| Date and attribution          | Authored 2026-10-22 UTC by the Codex assistant, following the owner's explicit request in the TypeCV session to report and implement compiler/runtime gaps. This date records authorship, not acceptance. |
| Applicability / Effectivity   | Generated compute-entry host faces, the direct-call runtime and `device.fuse()` entry groups. WebGPU, the CPU tier and the existing WebGL2 specialization limit. No release version is assigned.          |
| Review baseline               | `d05e457eaa263e1683533f80637dd85c7b476fe1`, the main branch revision inspected on 2026-10-22 UTC.                                                                                                         |
| Review and revision authority | Issue [#739](https://github.com/typeshade/typeshade/issues/739) and [PR #741](https://github.com/typeshade/typeshade/pull/741). Git records revisions; PR review and merge record acceptance.             |

## What changes

An imported compute entry gains an optional third argument with the existing program-runtime
shape `{ constants: { NAME: value } }`. Existing two-argument calls retain their behavior.

```ts
await device.fuse(() => {
  assemble(bindings, groups, { constants: { WORKGROUP_SIZE: selectedSize } });
});
```

The values select the module's declared overrides. Omitted values take their authored defaults.
Validation uses the same names, types, range rules and normalized values as
`program.compute(entry, { constants })`. Invalid names or values fail before GPU work is
submitted. Supplying constants to an entry that declares none reports that fact.

The selected values determine the entry's resolved workgroup shape, workgroup-memory lengths,
CPU constants and the shapes reported for dispatched work. Dispatch counts remain numbers,
three-dimensional counts or the indirect counts supported by change 0075. Constants never
change the caller's workgroup count implicitly.

WebGPU pipelines are cached per device, entry, normalized constants and fp64 flavor. Repeating
the same specialization returns to its cached pipeline. The integer flavor remains selected
by the device owner, including an externally supplied device. Entry calls inside `device.fuse()`
remain groups of their own and join the plan's existing GPU submission without an extra fence,
readback or submission merely to select constants.

The generated CPU code receives the same override values and derives its invocation builtins
and workgroup arrays from them. It uses generated closures or data, never runtime compilation,
`eval` or `Function`. A barrier that the current CPU call tier cannot execute remains refused.
WebGL2 keeps change 0057's policy: the declared default shape is supported and an unsupported
non-default workgroup specialization receives a clear refusal.

The language's override declaration syntax and `program.compute` API stay as they are.
No new named public export is proposed. Implementation may extract shared internal validation
and shape-resolution helpers so the two host paths use one authority.

## Why

TypeCV BA dispatches imported compute entries through `device.fuse()`. The existing program
runtime can specialize them, but the direct-call runtime accepts only `(bindings, workgroups)`.
Switching to a separate program-runtime submission for each BA row would add submission and
fence costs and would require a separate integration for the owner's fp64 flavor.

The owner's iPhone run `7b5f61ef` measured 46.0 seconds in `bundleCameraRows`, 35% of its measured
GPU time. That identifies a workload to optimize; it does not establish that any workgroup size
fixes the native device loss or is optimal on Apple hardware. TypeCV's program-runtime probe
can compare row variants against its scalar CPU oracle before adopting a size policy.

Alternatives are to keep the default shape, migrate all BA scheduling to the program runtime,
or generate distinct shader sources per shape. The optional argument keeps the existing
device plans and reuses the override mechanism that already exists. Shader-source rewriting,
private runtime mutation and a second pipeline-constants vocabulary are excluded.

Issue [#740](https://github.com/typeshade/typeshade/issues/740) separately tracks fp64 lowering
losing symbolic workgroup-array counts. Fixing that existing correctness defect does not by
itself add entry-call constants. Both behaviors need validation before TypeCV adopts them.

## What it touches

- Rule 8.24 and surface section 67: the optional compute-entry call argument and generated
  TypeScript host signature.
- Rules 11.8 and 11.11: owner-specific specialization, shared validation and generated CPU code
  without shipping the compiler or dynamic code generation.
- Rule 11.13: entry groups keep their scheduling order, resident bindings and dispatch reports.
- Surface section 69: explain that entry calls and the program runtime select the same named
  constants, with the same specialization limits.
- No diagnostic code, named public export or shader example is added or removed.

### Draft impact estimate

Expected work covers host-face generation, compute-entry metadata and runtime specialization,
shared override validation, CPU specialization, pipeline caches, limits and plan reports.
Existing entry calls and default manifests must remain compatible. No dependency is proposed.
Development duration and native performance gains are unestimated.

Required functional evidence includes direct and fused calls at multiple sizes, tail
invocations, resident arrays, indirect dispatch, normalized cache reuse, integer fp64 selection,
invalid constants and limits, CPU parity, and the WebGL2 default/refusal behavior. Run the build,
unit tests, runtime bundle-boundary gate, real compile gate, differential gate and a packed-package
journey. Document checks must include impact, references, change scope and paired edits.

Before acceptance, confirm the optional argument, the compatibility behavior and the declared
downstream scope. Hardware performance and TypeCV adoption remain separate from compiler proof.

### Approval and plan record

Not yet applicable. The owner requested implementation work in the TypeCV session, but this
draft has not been accepted or merged. Acceptance requires review of this proposal revision
and a merge with `status: accepted`, under `changes/README.md`. No implementation or downstream
merge decision is inferred from the issue being opened. Review responsibility and milestone
dates are unassigned.

### Configuration and validation record

Not yet applicable. Delivery must record the accepted proposal revision, actual implementation
commits/PRs, tested configuration, functional results and document checks. No result is claimed
for this draft. TypeCV's numerical/performance evidence and its eventual compiler pin must be
recorded separately.

## What it owes downstream

The site and editor need to explain the third argument, defaults, caching and tier limits.
TypeCV needs to use it in the existing BA device plan, compare supported sizes against the CPU
oracle, keep the Apple integer flavor, and measure native performance before claiming an
optimal policy. Each implementing compiler pin records 0084 in `compiler-changes.md`.
No current name is removed. Existing TypeNN and Radiance calls keep their defaults; adoption
there is optional and is not claimed by this compiler change.
