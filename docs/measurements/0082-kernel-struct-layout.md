# Kernel struct-array layout measurements

## Request and baseline

The owner requested measurement before drafting proposal 0082, on 2026-10-22 UTC.
The supplied conversation proposes separating a logical class from its physical storage.
It asks the compiler to choose a layout, rather than always choosing SoA.

The compiler baseline is `94203d3cab6433065bbe111c3b93f66a4058828e`, which completed
proposal 0081. This branch does not implement automatic layout selection.
Measurement is in progress; no layout decision or performance result is approved here.

## Questions

- When does AoS beat or lose to SoA for the same field accesses and arithmetic?
- How much does removing unused fields help without changing AoS?
- What do the host's packing, validation and field-preserving writeback cost?
- Which bytes, allocations, buffer bindings and dispatches does each alternative require?
- Can the call preserve invalid-value diagnostics, aliases and untouched fields?

## Experiment

Compare full AoS, projected AoS, full SoA and projected SoA for the same inputs.
Use small and large arrays, narrow and wide reads, and a partial field write.
Validate every output against an independent CPU calculation before accepting timings.
Deliberately corrupt one output and require the validator to reject it.

Keep compilation and pipeline creation outside steady-state dispatch timing.
Warm each case, interleave alternatives, retain samples, and report their distribution.
Report host wall time separately from device timestamps when the adapter provides them.
Record the adapter and driver. A software renderer is not evidence of hardware GPU speed.

Measure host work separately from dispatch. Report validation, packing and writeback as
distinct costs. A prototype that omits production checks cannot establish a call-layer win.
Report allocated bytes separately from estimated memory traffic; AoS does not imply that
the GPU fetches every field, and a vec3's alignment is not its payload size.

## Compatibility boundaries to examine

Entry bindings, manifest layouts, raw bytes and Resident buffers expose physical layouts.
The initial proposal must preserve these boundaries or explicitly resolve each incompatibility.
Field elimination must preserve untouched host fields and existing validation behavior.
Whole-value reads, aliases, nested arrays, multiple loops and fuse chains need conservative
eligibility rules. Buffer limits and layout conversion costs count in a selection policy.

Map and Set already exist under proposals 0080 and 0081. This study does not replace their
algorithms or claim an unmeasured improvement to their value storage.

## Next record

After measurement, retain the instrument and results with their configuration, then draft
0082 using `changes/TEMPLATE.md`. The draft will distinguish observations from hypotheses,
declare affected rules and downstream work, and leave acceptance to review.
