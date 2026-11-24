---
id: '0148'
title: A kernel function that binds more arrays than a device allows still runs, and says why where it falls to a tier
status: draft
rules:
  - '8.22'
  - '11.8'
surface:
  - 65
exports: []
exports-removed: []
codes: []
examples: []
names: []
downstream:
  - repo: typeshade.github.io
    what: The kernel-function page (§65, "Where it runs") says that a loop whose entry binds more storage buffers than the device allows runs on the next tier and says why, and later that it runs on WebGPU with its read-only arrays packed. Search the pages (en and ko) for the sentence "the device allows". compiler-changes.md records 0148
  - repo: vscode-typeshade
    what: The skill's kernel-function reference follows the new "Where it runs" text. Search it for "storage buffers". compiler-changes.md records 0148
  - repo: typeaudio
    what: docs/compiler-asks.md row AE records the delivered stages. When the packing stage is delivered, src/kinds/lanes.shade.ts stops gathering one kind at a time (the workaround of typeaudio pull request #57). compiler-changes.md records 0148
---

<!-- doc-refs: skip-file — this draft names a sentence and stages that a later implementation adds, and files of the TypeAudio repository, which this tree does not have -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0148`, `status: draft`. The front matter is the identity and lifecycle authority. `0147` is taken on `main`, so `0148` is the next free number.                                                                                                                                      |
| Date and attribution          | Written 2026-11-24, UTC. The date records authorship, not an approval. A Claude Code sub-agent drafted it for the orchestrating session. On 2026-11-24 the owner delegated decisions to that session ("제대로 다시, 저의 의견이 사실 필요 없거든요"). The delegation is not an approval of this text. |
| Applicability / Effectivity   | `src/core/host-kernel.ts` (`tierFit`, `deviceBindings`), `src/core/host-kernel-gl.ts`, `src/core/fuse-plan.ts`, `src/core/fuse-group.ts`, `docs/language-design.md` Rule 11.8 and `docs/use-typeshade-surface.md` §65. No release version is assigned (OD-6).                                         |
| Review baseline               | `origin/main` at `be2e83de6ba5cdaddc2b8f19a74f98061bad78fe`. The probe in "Why" ran on that commit.                                                                                                                                                                                                   |
| Review and revision authority | Issue #1137. No pull request is assigned at the time of writing. Git records the revisions, and the review and merge of the pull request that carries this file record the decision.                                                                                                                  |

## What changes

A kernel function (Rule 8.22) is not refused when one of its entries binds more storage buffers than
the device allows. The compiler and the runtime make it run. This proposal fixes the direction and
the order of the work. It adds no name, code or form to the language.

**Before and after.** The author's code is the same in both. The module is the kernel of issue #1137
(six input arrays, six output arrays, one loop), and the call is:

```ts
import { twelve } from './twelve.shade.js';

await twelve(x0, x1, x2, x3, x4, x5, o0, o1, o2, o3, o4, o5);
```

| Step           | What the author sees                                                                                                                                                                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Today          | `tshc check` says `No problems found in 1 file.` On a device that allows 8, the first call rejects with Tint's sentence: `The number of storage buffers (12) in the Compute stage exceeds the maximum per-stage limit (8).` The call does not run on any tier.                                      |
| After stage S1 | The call runs on the next tier, the CPU tier here. The `why` of its `fuse` report group, and the `Error` of a policy that requires WebGPU, carry `loop 1 binds 12 storage buffers, and the device allows 8; packing the arrays into fewer buffers is not supported yet`. The results do not change. |
| After stage S2 | The call runs on WebGPU at the default limit. The loop's entry binds 7 storage buffers: the six outputs and one buffer that holds the six inputs. The results are the bits the CPU tier gives.                                                                                                      |
| After stage S3 | A WebGL2 loop that reads more arrays than the context has texture units runs on WebGL2 with the arrays in fewer textures.                                                                                                                                                                           |

Rule 11.8 gains one clause: a call that a device limit stops on a tier runs on the next tier of
the policy, with the reason of the limit in the report, and a tier of a policy of one tier that the
limit stops throws an `Error` that names the reason. Rule 11.8 does not say today that a limit can
stop a tier. Surface §65, "Where it runs", already shows this form for two of the entries (the
stores after the loops, and the loop whose range the device holds).

## Why

**Fact, probed on 2026-11-24 on `be2e83de`.** The kernel above compiles through `hostFace` with no
diagnostic. The generated WGSL of the loop's entry declares twelve `var<storage, ...>` bindings.
Issue #1137 records that WebGPU refuses that entry at the first dispatch. The #57 run of
2026-11-09 is its evidence, and this proposal does not reproduce it again.

**Fact, read from `src/core/host-kernel.ts` on `be2e83de`.** `tierFit` for `'webgpu'` counts the
storage bindings of two entries only: the entry that stores after the loops (`finishOf`), and the
range entry and the entry of a loop whose range the device holds (`deviceBindings`). It reads the
limit as `d.limits?.maxStorageBuffersPerShaderStage ?? STORAGE_BUFFERS`, with `STORAGE_BUFFERS` equal
to 8. The loop entry of a loop whose range the host knows is not counted. The issue's kernel is
that case. `src/core/fuse-plan.ts` reads the same limit as
`reportOf(device).limits.maxStorageBuffersPerShaderStage ?? DEFAULT_STORAGE_BUFFERS`, and
`src/core/fuse-group.ts` (F5) counts it for a group of several calls, not for one call alone.

**Fact.** `src/core/host-kernel-gl.ts` binds each array a WebGL2 loop reads as a data texture on its
own texture unit (`loop.reads.forEach((r, unit) => ...)`). It reads no `MAX_TEXTURE_IMAGE_UNITS`.
`tierFit` for `'webgl2'` compiles each program, and a failure returns the driver's message as the
reason.

**Inference, not probed.** A WebGL2 loop that reads more arrays than the context has fragment
texture units fails at program link, and the reason is the driver's own text. No WebGL2 context was
available to probe it.

**Two readings of the rules (issue #1137).** Rule 11.8 reads "the first tier ... that can run it".
Rule 12.6 reads "A requirement the front end can check must be checked at the front end". The
count is known at compile time. The limit is not. The device is made at run time, and
`configure({ limits })` and the adapter decide the limit (Rule 11.8, change 0051). A requirement
that depends on a value the front end cannot know is not one the front end can check. Rule 12.6
therefore does not apply, and Rule 11.8 does. This proposal states that reading in the text of
Rule 11.8, so that the two rules no longer read differently.

**Alternatives.**

| Option                                                | Cost                                                                                                                                                          | Verdict                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| (a) A front-end error or warning at the default of 8  | A code the author learns. It refuses a kernel that runs on a device with a higher limit. It reverses OD-9 and OD-11 for a limit the compiler can work around. | Not chosen. It is the reading the owner's decisions rule out.                         |
| (b) The next tier only, with the reason               | The kernel never uses WebGPU at the default limit. TypeAudio keeps its workaround.                                                                            | Chosen as stage S1, the interim. It is not the end state (OD-11, analogy).            |
| (c) Pack read-only arrays into one buffer             | One copy of the packed inputs on each call.                                                                                                                   | Chosen as stage S2, first lowering.                                                   |
| (d) Split the loop into dispatches that write subsets | Reads are fetched again in each dispatch. It needs the proof that the writes are independent.                                                                 | Chosen as stage S2, second lowering, for what packing leaves above the limit.         |
| (e) Ask the device for a higher limit from the module | The device is made before a module's kernels are known, and one module would change the device of others.                                                     | Not chosen. `configure({ limits })` stays the author's lever, and no author needs it. |

## Owner's decisions

This proposal rests on these entries of `docs/owner-decisions.md`. It reverses none.

- OD-3: the compiler's work is not pushed onto the author. Packing and splitting are rewrites
  the compiler can prove exact. No author-facing construct is added.
- OD-9: a program need not translate one to one. The packed buffer, the header of offsets and the
  split dispatches are forms the compiler chooses. The bound is the same result and the same
  values the host sees.
- OD-10: a form the compiler does not implement yet is refused as "not supported yet", never as
  impossible. The S1 sentence says "not supported yet".
- OD-11: "WebGPU has it, WebGL2 does not, so it cannot be done" is wrong. This proposal applies the
  same principle to a device limit. A limit is not a reason to drop the tier, and the data
  textures of the WebGL2 tier show that the packed form already exists.
- OD-4: the example above shows the owner what changes before the owner decides.

OD-1, OD-2, OD-5, OD-6, OD-7 and OD-8 are not touched. OD-6 means that no warning release is owed.

## Why the compiler cannot do it

Not applicable: this proposal adds no author-facing name, rule, diagnostic code or surface form.
The text of Rule 11.8 changes to say what the runtime already does for two entries, and the
rest is the compiler's and the runtime's work.

## What it touches

- Rule 8.22: the lowering of a loop may pack its read-only arrays or split its dispatch (stage S2).
- Rule 11.8: the tier clause names a device limit as a reason for the next tier, and states why
  Rule 12.6 does not apply.
- Surface §65: "Where it runs" lists the entries counted, the sentence, and the stages as delivered.

Decisions of this draft, each with the entries it rests on:

1. **The program is not refused.** The call falls to the next tier, and from stage S2 it runs on
   the device within the limit. Entries: OD-3, OD-9, OD-11.
2. **No diagnostic code.** `tshc check` stays silent for the kernel. The limit is a fact of the
   device (Rule 12.6 reading above). Cost recorded: the author learns of a fall at the first call,
   from the report, and not at `tshc check`. Entries: OD-3.
3. **The WebGPU limit is read from the device the call runs on.** The value is
   `maxStorageBuffersPerShaderStage` of that device's limits, as `configure({ limits })` and the
   adapter fixed it. Neither the adapter's maximum nor the author's request is read. Where a
   device reports none, as a stand-in does, the value is 8, WebGPU's default (Rule 11.13, F5).
   `tierFit` and the planner of `fuse` read it from one helper. Entries: OD-9.
4. **The count is every storage binding of every entry of the call.** It covers the loop entries,
   the range entries, the finish entry and the push and fold entries: each array, each partials
   buffer, each length word and the trip buffer. S1 widens the count from two entries to all of
   them. Entries: OD-10.
5. **The sentence is the contract (Rule 12.5).** S1 pins this text, with the loop number and the
   counts of the call:
   `loop 1 binds 12 storage buffers, and the device allows 8; packing the arrays into fewer buffers is not supported yet`.
   The existing two sentences keep their text. The sentence is in the `why` of a `fuse` group, in
   the `Error` of a policy that requires WebGPU, and in the reason list of a call no tier can run.
   Entries: OD-10.
6. **S2 packs read-only arrays first.** A read-only array of a loop entry goes into one storage
   buffer of 32-bit words, in the layout the WebGL2 data textures already use. A header in the same
   buffer holds each array's offset and length, so the packing adds no binding. Plain arrays are
   packed at the upload the call makes already. A resident `Buffer` is copied into the packed
   buffer in the same submission. A written array is never packed, because the caller's `Buffer`
   would be a copy. The results are the bits of the CPU tier (Rule 11.13). If the packed size
   passes `maxStorageBufferBindingSize`, the call falls with a reason that says so. Entries: OD-3,
   OD-9.
7. **S2 splits the loop second.** If the entry still binds more than the limit, the loop becomes
   several dispatches, each writing a subset of the written arrays. This applies only when the
   existing proof shows that the subsets are independent. Otherwise the call falls with the S1
   sentence. Cost recorded: each dispatch reads its inputs again. Entries: OD-3, OD-9, OD-10.
8. **WebGL2 reads the context's limit.** The value is `gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)`
   of the context the call uses, read once. The need of a loop is the arrays it reads as textures
   plus the textures its program binds besides (lookup tables, the `_fp64` guard). The WebGL2
   specification's guaranteed minimum is not used as the value. If the need is higher, S1 falls
   with `loop 1 reads 20 arrays as textures, and the context allows 16 texture units; packing the arrays into fewer textures is not supported yet`. Stage S3 packs read arrays into one data
   texture with a header, as S2 does. Entries: OD-11, OD-9.
9. **The stages are three pull requests, in this order.** S1 is the tier fit and its sentence (the
   count, the helper, Rule 11.8 text and §65). S2 is the WebGPU packing and splitting. S3 is the
   WebGL2 texture count and packing. S1 is useful alone: it removes the silent device failure.
   Entries: OD-10.

### Draft impact estimate

Known impacts: `tierFit` and the helper that reads the limit (S1, small); the lowering and the
call's upload and bind path (S2, large: the packed WGSL, the header, the copy of a resident
`Buffer`, the proof of independent subsets); the WebGL2 program and texture binding (S3, medium).
`src/core/host-kernel.ts` is a file of the size baseline, so S1 first moves one responsibility
out of it (`CLAUDE.md`, File size). Durations are unknown and not estimated. Compatibility: a call
that failed on the device now runs, so no working program changes meaning (OD-6).

Validation to define before acceptance: none open. The test plan follows.

**Test plan.** Each test of an author-visible behaviour reads both halves (`CLAUDE.md`, A test reads
both halves), with `bothTake` of `src/core/testing/both-halves.ts`.

1. Both halves, on the twelve-array kernel: `compile()` and the language service give no
   diagnostic, and the host view types the call as today. This pins decision 2.
2. S1, with `fakeGpu({ storageBuffers: n })` of `src/fuse.test.ts`, as the test of
   `sumInto` at line 6566 does:
   - twelve arrays on a device that allows 8: tier `cpu`, the group `why` has the pinned sentence,
     and the result equals the CPU oracle;
   - the same call with `prefer: ['webgpu']` rejects with `twelve(): no tier it may use can run it (webgpu: loop 1 binds 12 storage buffers, ...)`;
   - the boundary: a loop that binds exactly the limit runs on `webgpu`, and one more falls;
   - a device that reports no limit counts 8; a device that allows 16 runs the twelve-array call;
   - one test for each kind of entry counted (loop, range, finish, push, fold, with a length word);
   - `fuse`: a plan of one call and a plan of two calls give the same `why` for the call alone.
3. S2: the same kernel with `fakeGpu({ storageBuffers: 8 })` runs on `webgpu`, and the recorded
   bind-group sizes (`gpu.binds`) show at most 8 for every entry. Cases: arrays of different
   lengths, an empty array, `f32`, `i32`, `u32` and vector elements, a resident `Buffer` input and
   a plain one, a packed size past `maxStorageBufferBindingSize` (falls, with its reason), a loop
   that splits (two independent writes) and one that cannot (falls with the S1 sentence). Each
   result is compared bit for bit with the CPU tier.
4. S2 on a real device: the `user journeys (packed tarball, WebGPU)` job runs the twelve-array
   kernel at the default limit and compares with the CPU result. This is the check the issue says
   was not run. Whether the compile gate reaches the packed WGSL (Tint) is read from
   `AGENTS.md#tests` before the stage, and the packed WGSL goes through Tint where it can.
5. S3: a WebGL2 context stub whose `getParameter(MAX_TEXTURE_IMAGE_UNITS)` returns 16, with a loop
   that reads 17 arrays: S1 falls with the texture sentence, and S3 runs with the packed texture and
   gives the CPU result.
6. Document audit, separate from the above: `bun run docs:impact`, `bun run docs:refs`,
   `bun run reqs:sync`, `python scripts/doorstop-check.py -C` for the changed Rule 11.8, and a
   search of the site and the editor skill for the old text.

### Independent review record

Not done. The orchestrating session runs the independent review (`README.md`, Independent
review) before it sets `status: accepted`. This record does not yet apply.

### Approval and plan record

This record does not yet apply. Acceptance requires the independent review above, the decision
and its review or merge reference, the approved revision and scope, and the agreed milestones.
Responsibilities and dates are unassigned.

### Configuration and validation record

This record does not yet apply. Delivery requires the commits and pull requests of stages S1, S2
and S3, the delivered configuration, and the observed results of the test plan above. Each stage's
deviations and pending work are recorded then.

## What it owes downstream

- `typeshade.github.io`: the kernel-function page changes its "Where it runs" text for the
  sentence at S1 and for packing at S2. The pages in en and ko that quote a storage-buffer count
  are searched for the phrase "the device allows".
- `vscode-typeshade`: the skill's kernel-function reference follows the same text.
- `typeaudio`: row AE of `docs/compiler-asks.md` records each stage. At S2 the `gather` kernel takes
  its nine source arrays again, and the one-kind-at-a-time workaround retires. The pin pull request
  records `0148` in `compiler-changes.md`.

Each obligation is pending until its stage is delivered.
