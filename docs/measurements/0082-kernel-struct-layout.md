# Kernel struct-array layout measurements

## Request and baseline

The owner requested measurement before drafting proposal 0082, on 2026-10-22 UTC.
The supplied conversation proposes separating a logical class from its physical storage.
It asks the compiler to choose a layout, rather than always choosing SoA.

The compiler baseline is `94203d3cab6433065bbe111c3b93f66a4058828e`, which completed
proposal 0081. This branch does not implement automatic layout selection.
Measurements completed on 2026-10-22 UTC. They inform the draft in
`changes/0082-kernel-struct-layout.md`; no layout policy is approved here.

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

## Retained configuration and reproduction

The measured instrument is `scripts/kernel-layout-bench.ts`. Its SHA-256 is
`dd49347b3a98a23b13dacd5d6b5fe15acfd487960e58e141ab328f3d73aa6179`.
The result is `docs/measurements/0082-kernel-struct-layout.json`, recorded at
2026-10-22 06:15:06 UTC. It retains all 48 cases, sources, WGSL, layouts and raw samples.
The checkout was `acc9a466`, whose compiler sources match baseline `94203d3c`.
No file under `src/` changed during measurement.

```sh
TYPESHADE_CHROMIUM=/usr/bin/chromium bun scripts/kernel-layout-bench.ts --output=docs/measurements/0082-kernel-struct-layout.json
```

The executor was Linux x64, Bun 1.4.3, Chromium 154. The default adapter reported
`google / swiftshader`, `isFallbackAdapter: true`, `timestamp-query` and eight storage bindings.
The command did not force a software adapter; that was the available adapter.
For a machine with no default adapter, `--software` explicitly requests SwiftShader.
For a physical-device run, omit that option and inspect the recorded adapter identity.

There were three warm-up samples and eleven measured samples per case. A sample dispatches
16 times at 1,024 elements, four times at 65,536 and once at 1,048,576. Reported times are
per dispatch. Layout order rotates between rounds. Pipelines and initial uploads are outside
the timed region. Device timestamps cover the compute pass; dispatch wall time also includes
encoding, submission, query resolution and waiting, but not mapping the timestamp result.
Correctness readback is outside timing. Host measurements run after the browser closes.

The instrument checked 80,289,792 values before and after timing. All matched an independent
CPU calculation. It rejected deliberately corrupted output and untouched fields in 120 probes.
It also required invalid WGSL rejection and refused an invalid host field omitted by projection.
No correctness leg skips on an absent adapter or absent timestamp data masquerading as zero.

## Device observations

The following are median device timestamp durations in milliseconds at 1,048,576 elements.
They describe SwiftShader, not a physical GPU. Host wall distributions and every sample are
in the JSON. Small differences are not a repeatable selection threshold.

| Work              | Full AoS | Projected AoS | Full SoA | Projected SoA |
| ----------------- | -------: | ------------: | -------: | ------------: |
| Read one field    |   6.6784 |        5.9947 |   6.0006 |        6.0819 |
| Read four fields  |   9.2313 |        7.0249 |   8.0902 |        8.3741 |
| Read eight fields |  11.6808 |       11.7139 |  13.6961 |       14.0103 |
| Write f0 from f1  |   7.4245 |        6.8589 |   7.8957 |        7.7866 |

All variants use the current compiler's `hostFace` kernel lowering, at workgroup size 64.
The SoA prototype spells scalar column indexing in its experimental source; automatic
class-array transposition is not implemented. Read cases use one input and one output buffer.
The SoA write case uses separate writable and readonly column buffers plus the output buffer,
so it uses three storage bindings where AoS uses two. Its comparison includes that distinction.

At eight-field reads, full/projected AoS compile to identical kernels, as do full/projected
SoA. Their timing spread is an internal noise control. For example, the two AoS medians at
65,536 elements were 0.6613 and 0.5956 ms despite identical kernels. This run cannot establish
a fine-grained switching rule. A preliminary run also varied substantially; the retained run
uses the final instrument hash above and does not average unlike configurations.

## Allocated bytes

The logical struct has eight f32 fields, with a 32-byte AoS stride and no padding.
At 1,048,576 rows the full input occupies 32 MiB. These counts describe actual storage
buffer allocations, not cache traffic, JavaScript heap size or an end-to-end memory peak.

| Work              | Projected input | Input reduction | Output | Total projected storage |
| ----------------- | --------------: | --------------: | -----: | ----------------------: |
| Read one field    |           4 MiB |           87.5% |  4 MiB |                   8 MiB |
| Read four fields  |          16 MiB |             50% |  4 MiB |                  20 MiB |
| Read eight fields |          32 MiB |              0% |  4 MiB |                  36 MiB |
| Write f0 from f1  |           8 MiB |             75% |  4 MiB |                  12 MiB |

Full AoS and full SoA each allocate 36 MiB including the output. A uniform, query buffers
and temporary verification staging buffers are additional. Projection saves the same input
bytes in either layout; this saving does not require SoA. The experiment does not measure
PCIe/device transfer throughput or automatically eliminate write-only uploads.

## Host observations

At 1,048,576 plain objects, median milliseconds were:

| Operation                                   |      AoS |      SoA |
| ------------------------------------------- | -------: | -------: |
| Prototype gather one field                  |  13.0633 |  12.6887 |
| Full validation plus one-field gather       | 152.9446 | 153.4782 |
| Prototype gather eight fields               | 187.6918 | 175.8936 |
| Full validation plus eight-field gather     | 318.9278 | 320.4827 |
| Merge the returned f0 into existing objects |   6.7810 |   6.6441 |

Full eight-field validation alone took 144.6824 ms. The production `packed` path, with its
checks and path construction, took 364.0288 ms; `readInto` of all fields took 249.0829 ms.
The prototype validates all eight fields even when it gathers one, and checks every gathered
value. Its partial merge updates f0 and preserves f7. A nonzero accumulated sink retains the
packing work. Each host timing has three warm-ups and eleven samples.

The prototype only covers plain objects and scalar f32 fields. It does not reproduce every
production diagnostic, getter, proxy, alias, nested layout or asynchronous-call behavior.
Host alternatives are timed sequentially, unlike the interleaved device cases. These numbers
therefore motivate further work; they do not establish a complete call-layer speedup.
The full-width prototype AoS is a control for specialized packing. Its difference from the
production pack must not be attributed to SoA. Alias/descriptor preflight, transfer, normalized
cold-field snapshots and full host-call latency remain unmeasured.

## Compatibility observations

- The same compiler reports `pos: vec3; mass: f32` at stride 16, with `mass` at offset 12.
  It reports `pos: vec3; vel: vec3` at stride 32, with `vel` at offset 16. Thus vec3 padding
  depends on the surrounding fields; a vec3 payload itself is 12 bytes.
- Reading `data[n + i]` in a loop that writes `data[i]` is refused for GPU execution by R4
  (`TS8070`). The measured SoA write prototype uses separate buffers to preserve that proof.
- Full `pack` and `readInto` change an untouched f32 field from `0.1` to
  `0.10000000149011612`. A naive field-only merge retains `0.1`. This packing-layer probe
  disproves the assumption that selective readback is automatically invisible to the host.
- Projected host gathering still rejects a nonnumeric unused f7 field. Removing its GPU
  storage is not permission to remove logical validation.

## Decision supported by this evidence

Keep AoS as the fallback. Investigate read-only field projection first. It reduces storage
without requiring SoA, and the prototype's host cost is dominated by complete validation.
Keep written-array optimization gated on equivalent reconstruction, including cold-field
rounding. Do not choose SoA universally or set hardware thresholds from this software run.

Before implementation, collect physical-GPU and full-call measurements, agree eligibility
and reconstruction, and accept proposal 0082. The draft leaves these decisions open.

## Validation record

All commands below ran on 2026-10-22 UTC. The compiler sources remain those of `94203d3c`;
the benchmark is identified by its SHA-256 above. This draft changes no runtime behavior.

| Command or check                                                                           | Observed result                                                                                             |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `bun run build`                                                                            | Passed, including the no-emit pass over scripts.                                                            |
| `bun run lint`                                                                             | Passed.                                                                                                     |
| `bun run format:check`                                                                     | Passed.                                                                                                     |
| `bun run test -- src/changes.test.ts src/core/reflect.test.ts src/core/host-entry.test.ts` | Passed: 61 tests in three files.                                                                            |
| `bun run docs:impact`                                                                      | No must-fix item. Read and reconciled all review items naming this report, the retained JSON and the draft. |
| `bun run docs:refs`                                                                        | Passed: zero dead references.                                                                               |
| `bun run changes:check`                                                                    | Passed: the instrument and draft change no normative rule, export or downstream-visible surface.            |
| `bun run reqs:sync`                                                                        | Passed; no tracked requirement changed.                                                                     |
| `python scripts/doorstop-check.py -C`                                                      | Passed; no review or clear operation was needed.                                                            |
| `TYPESHADE_CHROMIUM=/usr/bin/chromium bun run gate:compile`                                | Passed: 184 WGSL examples, 127 GLSL pairs, 122 render pipelines; zero failures.                             |
| `TYPESHADE_CHROMIUM=/usr/bin/chromium bun run gate:differential`                           | Passed: kernel, chain, GLSL, WebGL2 compute and common-module arms; zero failures.                          |
| Full layout benchmark command above                                                        | Passed: 48 cases, 80,289,792 compared values, 120 rejection probes.                                         |
| Benchmark with `--sizes=0 --reps=3`                                                        | Rejected the invalid size before starting a browser.                                                        |
| Retained-data integrity check                                                              | Instrument hash matched; case and comparison floors matched; compiler-source diff was empty.                |

Both the first protocol commit and the final instrument passed the compile and differential
gates. `gate:journeys` was not rerun locally: the draft changes neither host runtime code
nor generated host-call behavior. PR CI remains separate evidence from these local checks.
