# Private kernel input layouts

Implementation of accepted proposal 0082 starts from `d05e457eaa263e1683533f80637dd85c7b476fe1`.
The owner approved proposal PR #737 on 2026-10-22 UTC. This record distinguishes the
implementation work from the device observations in the proposal.

## Scope

Read-only, non-resident kernel object arrays may pack only live scalar fields in declaration
order. Logical validation still checks every declared field. The shader and the call layer
consume the same physical plan. Full AoS remains available for resident and fused calls,
whole-object escapes, unsupported types, unproved aliases and zero or fully live fields.

The first delivery does not select a multi-column SoA layout. Authored entry bindings,
reflection, manifests, raw bytes, written object arrays and collection layouts retain their
existing contract. Proposal 0081 deviation D1 remains open.

## Required verification

- Read each source through the compiler and language service.
- Check direct reads, helper reads, several loops, reductions and conservative fallbacks.
- Reject invalid unused fields before upload; retain empty-array and array-length behavior.
- Compare every GPU output with the CPU reference, including deliberate corruption probes.
- Exercise the packed host call, resident fallback and fusion fallback in Chromium.
- Record validation, packing, upload bytes, device time, whole-call time and peak buffers separately.
- Check documentation impact, references, Doorstop traceability and the public API snapshot.
- Run build, lint, formatting, affected tests, compile, differential and journey gates before pushing implementation code.

Physical-device speed conclusions require controlled reproduction. SwiftShader verifies the
instrument and behavior. A smaller input buffer alone is not a complete-call speed result.

## Status

The implementation is in progress. No optimizer delivery or performance result is claimed
by this initial scope record. Actual commits, commands, dates and results will be recorded
as verification completes. Downstream pin changes are separate work.
