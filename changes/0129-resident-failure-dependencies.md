---
id: '0129'
title: Queued host calls propagate failed Resident inputs without stopping independent work
status: accepted
rules:
  - '11.8'
  - '11.13'
surface:
  - 65
  - 67
  - 71
exports:
  - Resident
  - Device
  - fuse
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: Explain failed-input propagation, independent calls and write-only recovery in both languages; record 0129 when adopting the compiler.
  - repo: vscode-typeshade
    what: Update host references for queued failure propagation and recovery; record 0129 when the compiler pin moves.
  - repo: typeaudio
    what: Recheck experiment 5 and final-output-only error handling, then update compiler ask 2 and record the validated pin.
  - repo: typenn
    what: Test failed producers, dependent plans and recovery calls in training pipelines when adopting 0129.
  - repo: typecv
    what: Test failed producers and dependent image plans while keeping independent work runnable; record the adoption pin.
  - repo: radiance
    what: Audit generated host-entry and draw error handling without assuming manual Frame submissions changed; record adoption separately.
---

**Document control**

| Field                         | Record                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0129, accepted. The front matter controls its lifecycle.                                                                                     |
| Date and attribution          | Authored 2026-11-07 UTC by Codex under the owner's continuing issue-work request. This is an authorship date, not approval.                           |
| Request source                | Issue [#998](https://github.com/typeshade/typeshade/issues/998), reported by TypeAudio experiment 5.                                                  |
| Applicability / Effectivity   | Generated host kernel calls, compute-entry calls, fragment-entry calls and `fuse` plans using `Resident` inputs. Release version unassigned.          |
| Review baseline               | Compiler main `8e7f29f646da4b7540c8ba5125c28218bbcf367d`, inspected on 2026-11-07 UTC.                                                                |
| Review and revision authority | Proposal [PR #1087](https://github.com/typeshade/typeshade/pull/1087). Git records revisions; the PR review and accepted merge will record decisions. |

## What changes

**Current behavior.** A failed queued call stores its error on the `Resident` values it would write.
`read()` throws that error. A later call can nevertheless read their old contents and succeed.
Reading only the last output of a chain therefore hides an earlier failure.

**Proposed behavior.** Propagate failure along content dependencies of generated host calls.
Keep independent calls runnable and preserve successful write-only recovery.
Do not turn the shared queue into a globally rejected promise.

### D1. Check failed inputs at the call's queue position

After ordinary argument validation, check the incoming contents the call may read.
Perform this check after earlier queued calls settle and before this call executes, uploads inputs or submits work.
If a read input carries an error, reject with that same error object.
Retain it on every `Resident` the rejected call would write, as for other execution failures.
The error then reaches dependent calls and the last output's `read()`.

Do not check only when the host records the call: its producer might still be running.
No tier fallback may turn a failed dependency into a successful execution on old bytes.
The policy applies on WebGPU, WebGL2 and CPU, and to default and explicit device owners.
Existing owner, arity, shape and alias refusals remain argument validation, with their existing precedence.

When otherwise valid inputs carry different errors, use declared parameter or binding order.
Check a held array's length word beside that parameter, and an indirect dispatch count after its bindings.
Do not use host object property enumeration to select the error.
The proposal adds no diagnostic code, wrapper error or public error-reset method.

For the current #998 reproduction, `padTo` writes eight elements into a four-element output.
It rejects during validation. The queued `twice(b, a)` then rejects with the same error,
and both `a.read()` and `b.read()` reject. An independent call still runs.

### D2. Classify content access, not the presence of a handle

Read-only and read/write inputs depend on incoming contents. A proven write-only destination does not.
A `.length` query that measures fixed storage capacity reads no element and does not propagate its content error.
A parameter that the call never uses is also no content dependency.

Held-length words, device-resident loop bounds and indirect dispatch counts contain data used by execution.
They are read dependencies even when the call also updates them.
An index, branch, reduction or return expression that reads array contents creates a dependency too.
Reads through helpers, aggregates and later statements must not disappear from classification.

The existing `writes` flag alone does not prove write-only access.
Derive access facts from the compiler's shared operand-access analysis, including the whole function.
Do not infer safety merely from one loop's output binding or an absent fusion hint.
Carry any required private facts with the generated host artifact; do not add runtime compiler analysis.
Use a separate private payload or registration, rather than adding fields to the publicly exposed `HostExport.face` or entry structures.
The implementation must preserve the public shapes and serialized content of `HostFace.exports`, `Pack` and host-view declarations.
Generated executable code may change to carry the private facts.
Unknown access, including an older artifact without sufficient facts, counts as a read.
Such older artifacts remain loadable; after an input failure they may conservatively refuse a recovery call.
No public manifest schema or public export shape changes are proposed.

### D3. Preserve explicit recovery and ordinary queue progress

A call with a failed write-only destination and healthy content inputs may execute.
Success clears the errors of the `Resident` values it writes, as successful calls do today.
Failure stores the new execution error instead. A read/write update cannot recover by reading failed contents.
This preserves the existing successful-writer contract; it does not prove that every element was overwritten.
Array bounds and the treatment of elements the program leaves unwritten stay unchanged.
Successful zero-trip and partial write-only calls retain that existing error-clearing behavior too.

The existing whole-value `Resident.write(value)` retains the stored error; it does not become a reset operation.
Change 0048 remains a draft: its proposed partial host write is not an existing API and is outside this record's scope.
A new handle or a successful write-only call supplies recovery.
Destroying, releasing and reusing owned handles retain their lifetime and pool rules.
An independent call, including one on another owner, continues after a failed call.
No rollback of earlier writes or transaction across separate calls is introduced.

### D4. A fuse plan keeps its existing failure boundary

Check the plan at its reserved queue position, after validating recorded arguments and before executing any group.
Walk its recorded calls in order with a temporary dependency state.
A prior write-only call in this same plan can supply the value a later call reads.
If that writer fails when executed, the existing whole-plan failure stops the dependent call.
Do not clear the real handle's error early merely to approve the plan.
Execution uses the plan's approved dependency state instead of rechecking a stale real error through the ordinary per-call admission path.
An actual execution failure still aborts the plan immediately under its existing rules.

A content dependency still failed at its read rejects the whole plan with that error.
Every recorded promise rejects and every planned written `Resident` retains it, as Rule 11.13 already specifies.
The plan produces no partial `FuseReport`; scratch cleanup, chunk handling and queue order remain unchanged.
Independent calls within a rejected plan do not escape its existing failure boundary.
Independent calls outside that plan still run.
Nested scopes retain their single outer plan and report.

### D5. Define the execution boundary

Generated kernel calls, generated compute-entry calls and generated fragment-entry draws follow this policy.
A dependent draw rejects before preparing or painting the canvas, which keeps its prior image.
A compute entry checks content-reading bindings and its indirect count; write-only bindings remain possible recovery destinations.
The compiler must conservatively classify a binding when its current metadata cannot prove write-only access.

Manually encoded `typeshade/runtime` programs and `Frame` submissions are outside this proposal.
Their WebGPU commands can bind resources synchronously before a queued host call settles;
their WebGL2 frame execution also has a separate recording and submission contract.
Changing those contracts requires its own design. This proposal makes no claim that all uses of a `Resident` propagate errors.
The surface must state this boundary where it describes sharing a handle between the two layers.

## Why

Option (a) in #998 makes the last output of a generated call chain report a failed producer.
Keeping successful reads of old bytes would require every caller to inspect every intermediate handle.
A global queue failure would also stop unrelated work and prevent intentional recovery.
Rejecting every handle with an error would unnecessarily reject write-only destinations and capacity queries.

The revised reproduction still fails on baseline `8e7f29f6`.
A paired compiler/editor source compiles without diagnostics. On CPU, the producer rejects while `twice` resolves to four 18s.
`a.read()` retains the producer's identical error; independent work succeeds.
A whole `write()` retains the error, while a successful overwrite kernel clears it.
A recording WebGPU device observes one consumer dispatch and an upload of stale input.
That recording does not execute GPU arithmetic and is not native-GPU evidence.
The original eight-element successful producer remains a control because #997 repaired its guarded-read refusal.

## What it touches

- Rule 11.8 and surface §65: queued host-call dependencies, `Resident.read()` errors and recovery.
- Surface §67: generated compute and fragment entries, including indirect counts and draws.
- Rule 11.13 and surface §71: admission of a whole fuse plan and its existing shared failure boundary.
- `Resident`, `Device` and `fuse`: documentation of existing operations whose error behavior changes; no new signature is proposed.
- Compiler host facts, host kernel/compute/draw execution and the fuse recorder/executor need review as one dependency path.
- The shared access catalogue and runtime boundary of Rule 11.11 remain constraints, not new authoring features.
- No diagnostic code, example set, shader result, new GPU synchronization or default-tier change is proposed.

### Draft impact estimate

This deliberately changes success after a failed input into rejection.
Programs that used stale contents must recover explicitly before consuming them.
Healthy execution, shader text and numerical results must remain unchanged.
Private access facts may increase generated artifacts and runtime bundles; the size cost is not yet measured.
Paired bundle measurements must precede any narrowly justified cap update.
Implementation duration and downstream delivery dates are unestimated, not zero.

Required functional evidence before delivery:

1. Reproduce the CPU and recording-device stale-consumer failure on the implementation baseline.
2. Test same-error propagation through multiple consumers, independent owners, and full, partial and zero-trip write-only recovery.
3. Test read/write destinations, unused parameters, length-only reads, helper reads, held lengths and indirect counts.
4. Test error precedence, legacy artifacts without access facts and the existing whole-value host write.
5. Test fuse admission, ordered recovery within a plan, nested scopes and failed-plan output/report cleanup.
6. Test generated compute and fragment entry dependencies on their supported tiers, including preservation of a rejected draw's canvas.
7. Match compiler and language-service acceptance for every authored source control.
8. Run native WebGPU/WebGL2 positive controls and failed-dependency instruments, not only a recording device.
9. Run the canonical build, affected tests, compile/differential/packed-journey gates and paired bundle boundary checks.

The negative instrument must fail if dependency admission is disabled.
Healthy emitted shader artifacts and CPU results need an independent before/after comparison.
Compare public host-export metadata, packed manifests and host-view declarations byte for byte on healthy controls.
Document verification includes Rule 11.8/11.13, surfaces §65/67/71, API comments, CHANGELOG, proposal scope and strict Doorstop.
Manual Frame behavior must not be presented as covered by these host-call tests.

### Approval and plan record

On 2026-11-07 UTC, the primary Codex agent recorded acceptance of D1–D5 for PR #1087.
The owner's standing instructions authorize continued issue work and merging the agent's own PRs after validation.
This record applies that authorization; it does not claim that the owner separately reviewed this technical revision.

Independent technical review approved revision `3eb4f15b23c54f761654cc53f48e9353eaea9b10`.
It checked queue ordering, argument validation, error identity and the manual Frame boundary against source.
That review missed change 0048's draft status and incorrectly described its proposed partial host write as existing behavior.
The correction against main `4c7da1a962da692c9a3b93de1b61fedb03816c36` limits D3 and validation item 4 to the implemented `Resident.write(value)`.
Partial and zero-trip kernel writes remain existing recovery controls; they do not require a partial host-write API.
The reviewed revision includes private fact transport, public artifact parity, ordered fuse admission and partial/zero-trip recovery controls.
The primary agent accepts those decisions, declared impacts and required functional/document evidence without a design deviation.
The accepted merge of PR #1087 remains the implementation authorization baseline; no runtime implementation may precede it.

Codex is assigned compiler implementation and verification under the continuing issue-work request.
The milestones are the accepted merge, private dependency implementation, the listed functional/document checks, then a checked implementation PR.
Implementation duration and milestone dates remain unestimated.
Downstream assignees, adoption dates, release and publication remain unassigned.
Technical approval of this proposal is not implementation validation or downstream completion.

### Configuration and validation record

This record does not yet apply to delivery. The baseline reproduction and source audit establish the defect and current boundaries only.
Delivery must identify the accepted revision, implementation PR and exact tested commits, actual checks and any deviation disposition.
Compiler completion does not establish downstream adoption or publication.

## What it owes downstream

The site and editor update their host-call references and examples without promising a queue-wide or manual-Frame policy.
The read-only site baseline is `bca213452566152ed4b1b55dbdf8294c10d9a33a`; its English and Korean catalogues reference `Resident`.
The editor baseline is `db3f4171d6ea4689d6048d2252b6553da4599906`.
Its [host reference](https://github.com/typeshade/vscode-typeshade/blob/db3f4171d6ea4689d6048d2252b6553da4599906/plugins/typeshade/skills/typeshade/references/host.md)
names `Resident` and needs the new failure contract at adoption.
Existing downstream compiler-pin PRs are not part of this proposal.

TypeAudio rechecks experiment 5 and its final-output-only error handling.
TypeNN and TypeCV test dependent plans, independent work and recovery with their actual wrappers.
Radiance audits generated entry and draw calls while retaining the documented manual-runtime boundary.
Every adopting repository records proposal 0129, its compiler pin and its own observed checks.
Downstream assignees, implementation commits and delivery dates remain unassigned.
