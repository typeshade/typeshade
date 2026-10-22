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

## Implementation and configuration

[PR #738](https://github.com/typeshade/typeshade/pull/738) implements the first policy on
`agent/0082-kernel-layout`. Scope commit `fad3e47e` preceded source changes.
The accepted baseline is `d05e457eaa263e1683533f80637dd85c7b476fe1`, from proposal PR #737.
Codex implemented and verified this configuration on 2026-10-22 UTC.

`projectKernelInputs` analyzes a lowered private module. It combines field reads across loops
and transitive by-value helpers. Whole-object escapes, uncertain helpers, side effects in
indices, unsupported elements and written object arrays keep the original layout.
Generated host metadata contains both shader variants and their matching array layouts.
The runtime selects the private variant only for ordinary, non-resident, non-fused calls.

The logical packer still reads and checks every field in declaration order. A private view
redirects live scalar writes into the smaller buffer. Unused-field getters, inherited fields,
numeric checks and array-length reads retain the full packer's behavior.
The public API snapshot, authored module and full-layout variant remain unchanged.

## Controlled complete-call instrument

Run the comparison with a WebGPU-capable Chromium:

```sh
TYPESHADE_CHROMIUM=/path/to/chromium bun scripts/kernel-layout-bench.ts
```

The script writes `.cache/kernel-layout-bench.json` locally. It sends no report to a service.
`TYPESHADE_LAYOUT_SOFTWARE=1` explicitly selects SwiftShader for instrument verification.
Omit that setting for physical-device reproduction, and check the adapter and `software` fields.

Each pair uses the same source, compiler, options and JavaScript objects. The control removes
the private variant from generated metadata. It does not change aliasing or add host work.
The cases read one, four or eight fields from eight-field objects at lengths 1, 16,384,
65,536 and 262,144. Two warmups precede 15 samples per variant, with alternating pair order.
The report retains the individual samples and medians for all 24 rows.
Every result must match an independent JavaScript f32 calculation. Every corrupted output must fail that comparison.

Validation and packing probes run separately. Whole-call samples include the real generated
host call, validation, packing, upload, dispatch and output readback. Device intervals use
timestamp queries in that call's encoder. Upload counts cover `writeBuffer` payloads.
Peak counts cover tracked GPU buffers, including runtime staging and cached uniform buffers.
They exclude query instrumentation buffers and do not measure total device memory.

The first program-call time follows device setup and CPU probes. Pipelines and device caches
are shared across variants. That value is not an isolated cold-start comparison.
Standalone CPU probes can also warm the objects used by the complete call.

## Observed software-renderer results

The final local run ended at **2026-10-22 15:17:38 UTC**. Its adapter was Google SwiftShader,
with timestamp queries available. Bun was 1.4.3, Node 24.19.0, and Chromium 154.0.8037.57.
This verifies the instrument and functional behavior. It supplies no physical-GPU speed claim.

At 262,144 elements, reading one of eight fields gave these medians:

- Input bytes: 8,388,608 full; 1,048,576 projected, an 87.5% reduction.
- Total upload bytes: 9,437,200 full; 2,097,168 projected, approximately 77.8% less.
- Peak tracked buffer bytes: 10,489,856 full; 3,149,824 projected.
- Separate validation: 97.3 ms full; 99.3 ms projected.
- Separate packing: 96.4 ms full; 96.8 ms projected.
- Complete call: 206.2 ms full; 200.9 ms projected.
- Device interval: 2,504,688 ns full; 2,489,737 ns projected.

Reading four fields reduced the input to 4,194,304 bytes and total upload to 5,242,896 bytes.
Its complete-call medians were 206.5 ms full and 211.8 ms projected.
Reading all eight fields retained the full layout and byte counts in both variants.
Its complete-call medians were 212.8 ms and 216.2 ms, illustrating timing variation without projection.
Smaller buffers do not establish a complete-call speed improvement.

## Functional validation

Codex ran these commands on **2026-10-22 UTC**, using the tools above.
Browser gates used `TYPESHADE_CHROMIUM=/usr/bin/chromium` and SwiftShader.

- `bun run build`: passed.
- `bun run lint`: passed.
- `bun run format:check`: passed, including shader semicolons.
- `bun run test`: 468 files passed; 10,831 tests passed, four skipped and one todo.
- `bunx vitest run src/compiler/ts/kernel-project.test.ts src/compiler/ts/host-kernel.test.ts src/compiler/ts/key-types.test.ts src/api-surface.test.ts`:
  115 tests passed across four files, including the unchanged public API snapshot.
- `bunx vitest run src/changes.test.ts src/doc-references.test.ts`: 30 tests passed across two files.
- `bun run gate:compile`: passed shader compilation, render pipelines and entry calls.
- `bun run gate:differential`: passed every arm. WebGPU compared 3,229,148 values bit for bit
  across 360 calls, including nine projected inputs and eight Record cases. Rounded oracle
  values remain excluded by the gate's established policy. The projected-input corruption probe failed as required.
- `bun run gate:journeys`: passed the packed-tarball journeys. Projected calls, reductions,
  resident fallback and fused fallback matched their independent reference. Invalid unused fields were refused.
- `TYPESHADE_LAYOUT_SOFTWARE=1 bun scripts/kernel-layout-bench.ts`: 24 controlled rows passed,
  with 15 complete-call samples per row and corrupted-output probes.
- `bun run gate:boundary`: passed all package boundaries and measured budgets.

The algorithms budget moves from 42,400 to 42,587 gzip bytes, and random from 27,600 to 27,822.
Their measured accepted-baseline sizes were 42,156 and 27,391 bytes, respectively.
Runtime remained 44,244 and emit 95,192 bytes. Fuse grew from 85,125 to 85,593 bytes, within its 86,000-byte budget.
`CHANGELOG.md` records the budget changes. No dependency was added.

## Document audit and traceability

Codex reviewed the source map, Rules 8.21 and 8.23, surface §65, the proposal and the journey guide.
`bun run docs:impact` reported no must-fix items. All review references were read.
Private-layout descriptions and enforcement references now follow the code.
Historical proposals and fixed external-layout descriptions retain their existing meaning.

`bun run docs:refs`, `bun run reqs:sync`, `python3 scripts/doorstop-check.py -C`,
`bun scripts/ifchange.ts` and `bun scripts/changes.ts --base origin/main` passed.
RULE-0821 and RULE-0823 were read and reviewed individually.
SURF-064, SURF-065, SURF-067, SURF-069, SURF-072 and SURF-075 were read and cleared individually.
Their logical host and external-layout contracts remain applicable.
The change stays within the accepted rules and surface section.

## Open work

- Controlled physical-device complete-call reproduction remains pending. Proposal 0082 stays
  `accepted` until that required evidence is complete; this is not a waiver.
- Site and editor documentation, translations, actual-optimizer benchmark integration and compiler pins remain separate deliveries.
- Multi-column SoA selection, written fields and broader element types remain outside this first delivery.
- Proposal 0081 deviation D1 remains open.
