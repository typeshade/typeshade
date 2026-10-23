---
id: '0084'
title: A host selects compute-entry override constants in direct calls and device plans
status: implemented
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
| Identity and status           | Proposal 0084. The front-matter status is `implemented`.                                                                                                                                                  |
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

The existing `host-compute` example also demonstrates the optional argument, with a complete
host and shader. Extending that registered example does not add or remove an example id.

### Approved scope and impact estimate

Expected work covers host-face generation, compute-entry metadata and runtime specialization,
shared override validation, CPU specialization, pipeline caches, limits and plan reports.
Existing entry calls and default manifests must remain compatible. No dependency is proposed.
Development duration and native performance gains are unestimated.

Required functional evidence includes direct and fused calls at multiple sizes, tail
invocations, resident arrays, indirect dispatch, normalized cache reuse, integer fp64 selection,
invalid constants and limits, CPU parity, and the WebGL2 default/refusal behavior. Run the build,
unit tests, runtime bundle-boundary gate, real compile gate, differential gate and a packed-package
journey. Document checks must include impact, references, change scope and paired edits.

The owner approved the optional argument, compatibility behavior and declared downstream scope.
Hardware performance and TypeCV adoption remain separate from compiler proof.

### Approval and plan record

The owner approved proposal revision `f8478bc7ea420e5407c81d9b38a844e19ac67a88`
in the TypeCV session on 2026-10-22 UTC with “승인”, in response to the request to accept and
merge [PR #741](https://github.com/typeshade/typeshade/pull/741). The approved scope is the optional
entry-call constants argument and the compatibility and downstream declarations above. This
revision records that decision; the PR merge records the accepted baseline under
`changes/README.md`. The Codex assistant implements and validates the change. The owner reviews
implementation merge decisions. No milestone date or resource estimate is agreed. This approval
does not establish implementation results or authorize an unreviewed downstream merge.

### Configuration and validation record

The accepted baseline is merge `918c014917383082bd3857394ee28e87c782339a` of
[PR #741](https://github.com/typeshade/typeshade/pull/741), with approval recorded in
`4bd16f5edd8e69072f49a89819fbc9aaba9929a6`. The Codex assistant implemented and validated
[PR #743](https://github.com/typeshade/typeshade/pull/743), source revision
`7a484995beb5a62841393338d96b8a520fe168bd`, on 2026-10-22 UTC. That source also carries
`621552d4`, the separate correctness fix from PR #742 for issue #740. Neither implementation
PR is claimed merged by this record.

The delivered call takes the optional third argument, normalizes and snapshots constants,
caches specialized entry objects and per-device pipelines, selects the owner's fp64 flavor,
and reports the resolved shape. CPU execution uses the generated factory with resized reachable
workgroup zeros. Invalid bare calls keep their errors on written Residents; invalid calls in a
scope fail its body before the plan runs. WebGL2 pins ordinary constants and refuses a changed
workgroup shape or array length. Specialized CPU allocations use portable WebGPU limits;
existing two-argument CPU calls retain their behavior. No public named export was added.

The functional configuration was Node 24.19.0, Bun 1.4.4, TypeScript 5.6.3 and Chromium
154.0.8037.57 on Linux, with SwiftShader WebGPU and ANGLE WebGL2. These are correctness results,
not native GPU performance measurements. The assistant ran these checks at the source revision
above:

| Check                                                          | Observed result                                                                                                                              |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Build, ESLint and formatting, including shader semicolons      | Passed                                                                                                                                       |
| Full Vitest suite                                              | 469 files; 10,840 passed, 4 skipped, 1 todo                                                                                                  |
| Packed-package journeys                                        | 31 journeys, 118 runs, all passed; host imports passed separately                                                                            |
| New imported-entry browser run                                 | Widths 32/64/128, tails, indirect count, single-submission groups, both fp64 owners, CPU and WebGL2 matched the reference exactly            |
| Real compile gate                                              | 184 examples on Tint; 127 GLSL programs linked; 122 render pipelines; 11 compute and 10 fragment host entries; no failures                   |
| Differential gate                                              | 360 kernel calls (3,229,148 exact values), 98 chain runs, 288 GLSL functions, 23 GL compute entries and 158 common-module calls; no failures |
| Runtime bundle boundary                                        | No compiler, package dependency or dynamic code generation in checked bundles; all budgets passed                                            |
| Document references, change scope, IfChange pairs and Doorstop | Passed; 0 dead references                                                                                                                    |

The common-module budgets are 42,650 bytes for algorithms (42,609 measured) and 27,900 for
random (27,841 measured). The other measured gzip sizes are runtime 44,265, fuse 85,595 and
emit 95,174 bytes, within their existing budgets. Shared-helper extraction moved source lines;
capability citations were remapped and regenerated with no coverage classification change.
The repaired queue-error regression and stale evidence/traceability checks passed before the
final full suite above. The public API snapshot remains unchanged.

The retained local outputs are `/tmp/typeshade-0084-unit-all-final.log`,
`/tmp/typeshade-0084-journeys-final.log`, `/tmp/typeshade-0084-compile-final.log` and
`/tmp/typeshade-0084-differential-final.log` in the task workspace. The committed tests and
[CI run 1966](https://github.com/typeshade/typeshade/actions/runs/39866444769) provide the review
references. At the last observed CI snapshot, compile, render, traceability and the TypeScript
5.9.3/6.0.3 jobs had passed; the baseline unit and packed-journey jobs were still running.
The subsequent [CI run 1967](https://github.com/typeshade/typeshade/actions/runs/39867644267)
at `6d418fd14253cf99aace51c27458c402768aeedc` completed all eight jobs successfully,
as observed by the assistant during the end-to-end documentation work.

The owner then requested completion of examples and documentation in the TypeCV session.
The assistant extended `examples/hosts/host-compute/` with default, direct-specialized and
device-plan runs. The independent reference checks 259 elements, including a partial last
workgroup, on the CPU tier and both browser GPU tiers. The packed WebGPU run checks the actual
report: shape `[[32,1,1]]`, one dispatch and one submission. WebGL2 retains width 64 while
selecting the ordinary `GAIN` constant. The generated gallery text and WGSL golden are current.

The additional functional checks on the same Linux configuration passed: build; 531 focused
example, golden, host-type and documentation-snippet tests; the real compile gate (184 examples,
11 compute and 10 fragment host entries, no failures); and all 31 packed journeys / 118 runs plus
host imports. Outputs are retained as `/tmp/typeshade-0084-examples-tests.log`,
`/tmp/typeshade-0084-complete-build.log`, `/tmp/typeshade-0084-complete-compile.log` and
`/tmp/typeshade-0084-complete-journeys.log`. The compiler/runtime implementation did not change
in this follow-up. The guide and surface section 67 now link the complete example, explain the
readback after the plan, bound pipeline variants, and distinguish ordinary WebGL2 constants
from workgroup specialization. The conditional-programs guide also describes runtime pinning.

Compiler delivery is complete in PR #743 and awaits merge review. TypeCV adoption remains
in [typeshade/typecv#208](https://github.com/typeshade/typecv/pull/208), with its pin, numerical
checks and native performance evidence tracked there. Site/editor documentation and pins remain
pending. No native Apple performance gain or device-loss fix is claimed.

## Integration with the current main branch

On 2026-10-23, the assistant reconciled this implementation with the merged runtime/device
information change 0083 and the separately merged fp64 array fix #742. Both public behaviors
remain. The boundary check measured runtime 44,873, fuse 85,831, emit 95,174, algorithms 42,818
and random 28,054 gzip bytes. The corresponding updated budgets are 44,900 for runtime,
42,850 for algorithms and 28,100 for random; fuse and emit retain their budgets. The small
increases over main cover the combined runtime imports. Source citations were remapped over
unchanged lines and regenerated; coverage classifications remain unchanged. Integration
validation and merge outcomes are recorded in the pull requests.

## What it owes downstream

The site and editor need to explain the third argument, defaults, caching and tier limits.
TypeCV needs to use it in the existing BA device plan, compare supported sizes against the CPU
oracle, keep the Apple integer flavor, and measure native performance before claiming an
optimal policy. Each implementing compiler pin records 0084 in `compiler-changes.md`.
No current name is removed. Existing TypeNN and Radiance calls keep their defaults; adoption
there is optional and is not claimed by this compiler change.
