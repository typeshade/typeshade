---
id: '0054'
title: 'Every `@compute` entry runs on WebGL2, through a phased execution model that gives the results WGSL defines, in the call layer and in the program runtime'
status: accepted
rules:
  - '8.24'
  - '10.3'
  - '10.5'
  - '11.8'
  - '11.11'
surface:
  - 23
  - 25
  - 67
  - 69
exports:
  - Runtime
  - RuntimeOptions
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The pages that say WebGL2 has no compute stage, that a compute entry falls back to the CPU on WebGL2, or that the program runtime is WebGPU-only, en and ko, say what this change makes true; the rule pages that read Rules 8.24, 10.3, 10.5, 11.8 and 11.11 are read again for their new fingerprints; compiler-changes.md records 0054 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's host reference (plugins/typeshade/skills/typeshade/references/host.md) says a compute entry runs on WebGL2 and how the runtime reports the tier; compiler-changes.md records 0054 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names files, tests and journeys that do not exist yet, and files in downstream repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0054`, `status: accepted`, as amended three times. The front matter is the lifecycle authority. `0052` was the closed pull request #502 and `0053` is pull request #503, so this draft takes `0054`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Date and attribution          | Written 2026-10-06, Asia/Seoul. The date is the authoring context, not an approval. Drafted by the repository's coding agent at the owner's direction. The owner set the scope in the conversation: both runtimes in one proposal; a general model, not the shortest path; barriers, workgroup memory and atomics supported with the same results, not refused. Sources: #468 (typeshade/radiance), #130, #137, #138, #139.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Applicability / Effectivity   | The GLSL ES 3.00 backend (`src/core/backends/glsl.ts`), the portable-kernel analysis (`src/core/passes/portable-kernel.ts`), a new GL compute executor in `src/core/`, the call layer (`src/core/host-compute.ts`, `src/core/tiers.ts`), the program runtime (`src/runtime/`), `compile()`'s GLSL output, Rules 10.3, 10.5, 11.8 and 11.11, surface §25, §67 and §69, the site and the editor. Release version unassigned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Amendment                     | This revision adds surface §23 (Atomics) to the front matter. Its paragraph on the CPU oracle says the oracle "runs invocations one after another, so its atomics are plain reads and writes in that order", and decision 3 (a), accepted, changes that order to the phased one. Found while implementing step 1, 2026-10-06. The merge of its pull request is its acceptance. Git holds the earlier text. The second amendment adds Rule 8.24 (a `@compute` entry a host calls) to the front matter: its text gives the call's tiers as "WebGPU ... and otherwise the CPU tier" and says "an entry that reaches a barrier needs WebGPU", and step 2 of this change, under Rule 11.8 which the front matter already names, runs the call on WebGL2 between the two. Found while implementing step 2, 2026-10-06. The merge of its pull request is its acceptance. The third amendment rewrites items 1 to 3 of the execution model, adds item 7, and amends decision 5, from what steps 2 and the performance work found (pull requests #520 and #521, 2026-10-06): memory, state and output are layers of 2D array textures, so no size sends a call to another tier; the scatter draws straight into memory, since it never reads it, so the ping-pong pair and its copy are gone; a pass runs each invocation once, as a vertex whose record transform feedback captures, and the state stays on the GPU; read-backs wait on a fence; and memory is `R32UI` only, as the measurement decision 5 asked for found no gain in `R32F`. |
| Review baseline               | `origin/main` at `bfb6eee5` (the merge of PR #501).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Review and revision authority | [PR #506](https://github.com/typeshade/typeshade/pull/506). Git records revisions; the pull request's review and merge record the decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## What changes

A `@compute` entry runs on WebGL2. WGSL stays as it is: a storage buffer is a storage buffer and
a dispatch is a dispatch. On GLSL ES 3.00 the runtime carries out the same dispatch with
textures, render passes and, where WGSL needs it, more than one pass. The author writes nothing
new.

| Before (measured on `main` at `bfb6eee5`)                                                                                                       | After                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A module with a `@compute` entry has no GLSL: `missing capabilities: storageBuffer, compute`, `TS8015` when the module also has a render entry. | `compile()` emits the GL programs of every entry. `TS8015` stays only for what no WebGL2 context can do. |
| The call layer runs a compute entry on WebGPU or on the CPU; its WebGL2 arm always says "a @compute entry has no WebGL2 tier".                  | The call layer runs it on WebGL2 when there is no WebGPU device, before the CPU tier.                    |
| The program runtime, `typeshade/runtime`, throws "This environment has no WebGPU".                                                              | The program runtime takes a WebGL2 context, and loads, dispatches and draws the same manifest on it.     |
| WebGL2 runs only the portable-kernel shape: one `read_write` `array<u32>`, written once at `gid.x`.                                             | WebGL2 runs every compute entry WGSL accepts, within the limits below.                                   |

### The execution model

The executor runs a dispatch as a sequence of passes. Each pass runs every live invocation once,
as one point or one fragment for each invocation. The compiler splits the entry into **phases**
and gives the executor the program of each phase.

1. **Memory is textures.** Each storage buffer, and each workgroup variable (one copy for each
   workgroup), is an `R32UI` 2D array texture of 32-bit words in std430 order. A layer holds
   `width × layerRows` words (2048 × 2048 by default), and a buffer takes as many layers as it
   needs, so no size sends a call to another tier. A read is a `texelFetch` of the texture as it
   was at the start of the pass.
2. **A write goes to a log, then to memory.** An invocation records each write in its own write
   log. A read of an address the invocation wrote earlier in the same pass is answered from its
   log, so an invocation always sees its own writes. At the end of the pass, a scatter pass draws
   one point for each log entry, at the texel of its address, straight into the layer the
   address falls in. The scatter reads the logs and never the memory, so the texture needs no
   second copy and nothing is copied; an address that nothing writes keeps its value. The scatter
   draws only the layers the pass wrote, and in each only the invocations that wrote there.
3. **A phase ends at a barrier, an atomic operation or a full log.** The compiler cuts the entry
   at each `workgroupBarrier()`, `storageBarrier()` and atomic operation. It also cuts where the
   write log can be full, since the log has a fixed size. At a cut, the invocation saves its live
   local variables and its resume point in its record and stops. The next pass resumes it. A
   loop that contains a cut runs as a pass for each iteration, and the executor runs passes until
   no invocation is live. A pass runs each invocation once, as one vertex: the vertex shader
   writes the invocation's whole record (its state, its write log and its atomic request), which
   transform feedback captures, and the executor copies the records into a record texture on
   the GPU (a pixel unpack buffer). The next pass reads the state there and the scatter reads the
   logs there, so the state does not leave the GPU between passes. The host reads back only what
   it decides by (each invocation's resume point, its log's count and keys, and its request) and
   writes only which invocations run and what their atomic operations returned.
4. **A barrier is a phase boundary.** Every write before it is in memory before any read after
   it, which is what WGSL's barrier gives a workgroup. WGSL requires a barrier in uniform control
   flow, so every invocation of a workgroup reaches the same cut.
5. **An atomic operation is a resolve pass.** Each invocation that reaches an atomic operation
   records its request (address, operation, operand) and stops. A resolve pass applies the
   requests to each address in a fixed order and gives each invocation the value its operation
   returns. The invocations resume in the next pass with that value.
6. **The fast path is the same model with one phase.** An entry with no barrier, no atomic and
   writes the log always holds is one pass and one scatter. An entry that writes only at
   `gid.x` is one pass with no scatter, the portable-kernel tier of today.
7. **A read-back does not hold the page.** The host reads through a pixel pack buffer and waits on
   a fence (`fenceSync`) before it maps the words, so a call's `await` gives the page back while
   the GPU works.

A value is stored as its bits. A 4-byte lane is an `R32UI` texel, written with `floatBitsToUint`
and read with `uintBitsToFloat`, which WebGL2 renders to with no extension. Memory uses `R32UI`
only, an `f32` buffer included (decision 5, as amended).

### What "the same results" means

WGSL defines the result of most programs and leaves some open. The guarantee follows that line:

- **A program whose result WGSL defines gives the same result on WebGPU, WebGL2 and the CPU
  oracle.** This covers every program without a data race, whose atomic operations do not depend
  on their order (an `atomicAdd` whose return value is not used, `atomicMin`, `atomicMax`,
  `atomicAnd`, `atomicOr`, `atomicXor`). A floating-point operation the determinism report lists
  as `target` (Rule 11.5) may still differ between the GPU tiers, as it may today.
- **Where WGSL allows more than one result, WebGL2 and the CPU oracle give the same one, and it
  is one WebGPU may give.** This covers the values atomic operations return, and therefore an
  append buffer's order. The order is fixed: within one phase, by invocation index. The CPU
  oracle already runs the invocations of a workgroup in index order between barriers
  (`src/core/debug/dispatch.ts`), but an invocation there runs all its atomic operations before
  the next invocation starts. The phased model interleaves them: the first atomic operation of
  every invocation, then the second. The two orders differ for a program that makes more than
  one atomic operation on one address in one phase. Decision 3 settles which order both use.
- **A data race has no defined result in WGSL.** A read of an address another invocation writes
  in the same phase reads the value from the start of the pass on WebGL2. That is one of the
  values WGSL allows. No tier promises more.

### What stays outside

These are limits of the WebGL2 context, not choices of this proposal. Each one is reported with a
reason and runs on the CPU tier:

- a buffer larger than the largest texture the context allows (`MAX_TEXTURE_SIZE`² texels);
- an `f16` or `subgroups` entry, which needs a feature WebGL2 does not have;
- a storage texture's format that WebGL2 cannot render to.

A busy-wait loop that waits for another invocation (a spin lock) makes progress in the phased
model, since each atomic operation ends a phase. WGSL gives such a loop no forward-progress
guarantee on any tier, and this proposal does not add one.

## Why

- typeshade/radiance's path tracer has a `@compute` entry and a render pair in one file. `tshc
check` warns `TS8015` on it, because the GLSL backend has no compute stage (#468). Proposal
  `0052` (pull request #502) would have let a file turn the GLSL target off. The owner closed it:
  a language above WGSL and GLSL should make the second target run the program, and the runtime
  exists to do that.
- WGSL defines what a dispatch does. The GLSL writer emits only what GLSL ES 3.00 can express,
  but the runtime can build the rest from passes and textures. #130 records this rule for every
  WGSL-only feature: lower it, state its fidelity, and keep a capability only as a host hint.
- Today's WebGL2 compute paths each accept one shape (`analyzePortableKernel`, `lowerKernelGl`).
  A general model replaces the special cases. The special cases stay as its one-pass fast
  paths.

### Alternatives considered

- **Refuse on GLSL what has no direct GLSL form, and fall back to the CPU** (the plan in #137 and
  #138). This is small and exact, but radiance's own kernel writes at a computed index and falls
  outside it. Each later kernel shape would need its own exception.
- **Lower each feature on its own** (a scatter path, a ping-pong path, an atomics path). Each
  path is simpler, but their combinations (a scatter after a barrier, an atomic in a loop) have
  no single semantics to test.
- **One phased model with fast paths (proposed).** One semantics, which the CPU oracle can follow
  step for step. The fast paths keep the cost of the common shapes low.

### Decisions at acceptance

1. **Rule 10.5.** Lift the deferral for read-write storage, atomics and barriers (#137, #138) and
   for the compute entry (#139). The other members of the family (#131 to #136) stay deferred.
2. **The program runtime's WebGL2 tier.** `createRuntime` takes a WebGL2 context, or makes one,
   when there is no WebGPU. Its `load`, `compute`, `render`, `dispatch` and `draw` keep their
   signatures, and `Runtime` reports the tier it runs on. The shape of `RuntimeOptions` for this
   is settled in the implementing pull request.
3. **The atomic order.** Either (a) the CPU oracle moves to the phased order, so WebGL2 and the
   oracle agree on every program; or (b) the GL executor serializes each phase in the oracle's
   order, which costs a resolve pass for each atomic operation of each invocation. Proposed: (a).
   Both orders are ones WGSL allows.
4. **The write log's size.** A fixed number of entries for each invocation in each pass, chosen
   from `MAX_DRAW_BUFFERS` and `MAX_COLOR_ATTACHMENTS` of the context. Proposed: 4 entries of 4
   lanes, the minimum WebGL2 guarantees.
5. **Float targets.** As amended: memory is `R32UI` only. The accepted text took `R32F` and
   `RGBA32F` when the context has `EXT_color_buffer_float`, and asked for both to be measured.
   Measured on SwiftShader, 2026-10-06 (pull request #520, `scripts/gl-compute-bench.ts`): one
   pass over 2^20 words took 23.1 ms with `R32UI` and 28.1 ms with `R32F`, and no smaller size
   differed beyond the timer's 0.1 ms. One format keeps one path, needs no extension, and stores
   every bit pattern as itself; that a float target keeps a NaN's payload was not measured. A
   hardware GPU was not measured: a measurement there that favours `R32F` reopens this decision.

## What it touches

- `rules: [8.24, 10.3, 10.5, 11.8, 11.11]`. Rule 8.24: a compute entry's call runs on WebGL2 where there is no WebGPU device, before the CPU tier, and an entry that reaches a barrier no longer needs WebGPU. Rule 10.3: `TS8015` stays only for what no WebGL2
  context can do. Rule 10.5: decision 1. Rule 11.8: the call layer's WebGL2 tier runs compute
  entries. Rule 11.11: the program runtime runs on WebGL2.
- `surface: [23, 25, 67, 69]`. §23 (atomics) says the CPU oracle performs atomic operations in
  the phased order of decision 3 (a). §25 (barriers) says a barrier is a phase boundary on WebGL2. §67 (a
  compute entry called from the host) gains the WebGL2 tier. §69 (the program runtime) gains the
  WebGL2 context.
- `exports: [Runtime, RuntimeOptions]`. Decision 2. No export is removed.
- `codes: []`, `examples: []`. No code changes number. Every compute example moves to both
  halves of the compile gate.

Required functional evidence:

- The GL executor against the CPU oracle, in both precisions, on every compute example and on
  generated programs (`scripts/gpu-differential.ts` gains a compute arm): a write at `gid.x`, a
  write at a computed index, several writes in one invocation, a read after its own write, a
  barrier with workgroup memory, a reduction, `atomicAdd` with and without its return value, an
  append buffer, and a loop with a barrier. Each one exact, except an operation the determinism
  report lists as `target` (Rule 11.5).
- The same programs on WebGPU in the compile gate, against the oracle, for every program whose
  result WGSL defines.
- typeshade/radiance's `trace.shade.ts`: `tshc check` reports no `TS8015`, and its Cornell box
  through the program runtime on WebGL2 (SwiftShader) is held to the oracle.
- A journey through the packed tarball that runs a compute entry and a draw on WebGL2 through
  `typeshade/runtime`.
- Both float targets, measured: the time of one pass with `R32F` and with `R32UI`.
- The compute arm in the executor's own layout and again in a layout of small layers, so memory,
  state and output each span many layers; and a dispatch past one layer of each in the default
  layout, every word of its result checked (`scripts/gl-compute-bench.ts`).
- The time of the corpus and of the dispatch past one layer, before and after each change to the
  executor, in its pull request.

### Draft impact estimate

The work is large, and it splits into implementing pull requests under this one record, in this
order:

1. the phase splitter and the state texture, in the IR, with the CPU oracle running the phased
   order (decision 3) and the differential tests;
2. the GL executor (memory textures, write log, scatter, ping-pong, resolve pass) in
   `src/core/`, with the call layer's WebGL2 tier;
3. `compile()`'s GLSL for compute modules, and Rule 10.3's narrower `TS8015`;
4. the program runtime's WebGL2 tier;
5. the documents, the site and the editor.

Duration and cost are not estimated. The basis for "large" is the size of
`src/core/passes/kernel-lower.ts` and `src/core/host-kernel-gl.ts`, which serve one loop shape
today. A program that runs today runs the same: WebGPU stays the first tier.

### Approval and plan record

The approval is the owner's go-ahead in conversation on 2026-10-06, Asia/Seoul ("세 PR 모두
(추천안대로)"), which accepted the five decisions above as proposed: Rule 10.5's deferral is
lifted for #137, #138 and #139; the program runtime gains a WebGL2 tier; the CPU oracle moves to
the phased atomic order (3a); the write log holds 4 entries of 4 lanes; and an `f32` buffer uses
`R32F` or `RGBA32F` with `EXT_color_buffer_float` and `R32UI` otherwise. The merge of
[PR #506](https://github.com/typeshade/typeshade/pull/506) records it; Git holds the merge commit.
The approved revision is this file at that merge. The implementation follows the five steps of
the impact estimate, each its own pull request. Duration and cost were not assigned. The third amendment changed decision 5 to `R32UI` only; its merge records that decision.

### Configuration and validation record

This record does not yet apply. Delivery will require: the implementing commits with
`Change: 0054`; the evidence above green on the delivered revision; `bun run docs:impact`,
`docs:refs`, `reqs:sync` and `doorstop -C` clean; and, separately, the downstream pin pull
requests with `0054` recorded in their `compiler-changes.md`.

**Deviations.** One so far, from the "What changes" table's row "`compile()` emits the GL
programs of every entry". Step 3 ([PR #518](https://github.com/typeshade/typeshade/pull/518))
keeps `CompileResult.glsl` as `{ vertex, fragment }`: a compute entry's pass program reaches the
host through the generated host module (`ComputeEntry.gl`, [PR #517](https://github.com/typeshade/typeshade/pull/517)),
not through `CompileResult`, because a new field would change an export this record does not
list. Disposition: accepted by the owner in conversation on 2026-10-06, Asia/Seoul ("승인").

## What it owes downstream

- **typeshade.github.io.** Each page that says WebGL2 has no compute stage, that a compute entry
  falls back to the CPU on WebGL2, or that the program runtime is WebGPU-only, in English and
  Korean. The rule pages read Rules 10.3, 10.5, 11.8 and 11.11 again. `compiler-changes.md`
  records `0054`.
- **vscode-typeshade.** `plugins/typeshade/skills/typeshade/references/host.md` says a compute
  entry runs on WebGL2 and how the runtime reports its tier. `compiler-changes.md` records
  `0054`.
- **radiance** (not a repository `scripts/changes.ts` tracks). Its `trace.shade.ts` needs no
  change. Its plan's line "no WebGL2 fallback" is the engine's own decision, which this proposal
  does not change.

Each item is expected work. None is started, and each follows the pin that carries the
implementation.
