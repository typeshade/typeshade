---
id: '0058'
title: A host fuses a chain of kernel-function calls into one dispatch inside a `fuse` scope, and reads why each pair the runtime keeps apart stays apart
status: implemented
rules:
  - '8.22'
  - '11.8'
  - '11.11'
  - '11.13'
surface:
  - 65
  - 69
  - 71
exports:
  - fuse
  - FuseReport
  - FuseScope
  - TypeshadeViteOptions
exports-removed: []
codes: []
examples:
  - loop-fuse
downstream:
  - repo: typeshade.github.io
    what: The control-flow page's kernel-function copy (en and ko) gains the fuse scope and its report; the WebGPU concept page's runtime copy gains the fuse plug-in beside the load-time emitter; the API reference gains fuse, FuseReport and FuseScope; the gallery, the Playground picker and the stills gain loop-fuse; compiler-changes.md records 0058 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's compute section and references/host.md gain the fuse scope, scratch arrays and the report; references/diagnostics.md changes only if implementation adds a diagnostic code; compiler-changes.md records 0058 when the pin moves.
---

<!-- doc-refs: skip-file — a proposal names the subpath, the files, the rule and the sections it will add, which this tree does not have yet -->

**Document control**

| Field                       | Record                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document                    | Proposal 0058; this file is the proposal source.                                                                                                                                                                                                                                                                                                              |
| Revision context            | 2026-10-12, UTC. The date means the authorship of this draft. It is not an approval date. The draft was revised the same day to follow `docs/computing-platform-plan.md` (#554), which `main` gained after the first draft.                                                                                                                                   |
| Request source              | Seungup's go-ahead in the project conversation on 2026-10-12, after a review of [typenn PR #6](https://github.com/typeshade/typenn/pull/6). The parent issue is [typeshade/typeshade#562](https://github.com/typeshade/typeshade/issues/562); the consumer prototype is [typenn#4](https://github.com/typeshade/typenn/issues/4).                             |
| Attribution                 | Drafted by Claude Code, an AI assistant, at Seungup's request. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                          |
| Current lifecycle state     | `implemented`, set by the pull request of step 6 on 2026-10-12 (UTC). Seungup approved the proposal in the project conversation on 2026-10-12 (UTC). PR #567 is the acceptance record; its merge is the agreement. The status does not claim that the site, the editor or a compiler pin is done (Configuration and validation record).                       |
| Applicability / effectivity | The kernel-function pipeline (`src/core/passes/parallel-loop.ts`, `src/core/passes/kernel-lower.ts`, `src/compiler/ts/host-face.ts`), the call layer (`src/core/host-kernel.ts`, `src/core/resident.ts`), a new subpath `typeshade/fuse`, the Vite plugin (`src/vite.ts`), the rules, the surface reference and AUTHORING.md. No release version is assigned. |
| Review baseline             | `main` at `031c040c9476c734d4963c485ed8cb49d187d873`, which carries `docs/computing-platform-plan.md` (#554) and is merged into the proposal branch. The first draft was written against `8b34888c2697227c3dd34723714468c29484e4cc`.                                                                                                                          |
| Proposal review             | [PR #567](https://github.com/typeshade/typeshade/pull/567), opened on 2026-10-12 as the proposal-only review. Its review and merge records will establish acceptance.                                                                                                                                                                                         |
| Revision authority          | Git records revisions. Review and merge records establish decisions.                                                                                                                                                                                                                                                                                          |

This proposal is the roadmap row "Fusing a chain of device-resident calls into one dispatch" (`docs/roadmap.md`, After 1.0). It proposes to pull that row forward. The decision to do so is the owner's and is listed under unresolved decisions. The proposal is also the first slice of P3, "Thin cross-operation execution plan", in `docs/computing-platform-plan.md`, and follows that plan's order: the access and effect record and one submission per scope first, fusion second, temporary storage third.

## What changes

### Today

A kernel function (Rule 8.22) is an exported function with a loop over an array. Its call dispatches each accepted loop as one compute entry (`src/core/host-kernel.ts`). A chain of calls over `Resident` arrays pays one upload and one read (Rule 11.8). It still pays one dispatch per call, and each intermediate array is written to storage by one call and read back from storage by the next.

A consumer that wants one dispatch for a chain composes it by hand. typenn PR #6 does this: it extracts scalar helpers from its kernel sources at build time, walks its tensor graph, assembles one entry with the IR builder, packs it, and loads it. That works through the public API, which answers the first acceptance criterion of #562. It also puts compiler work in the consumer: a planner, a helper contract and its validator, a cache, binding assignment, a device-limit check and a fallback policy. Every consumer with a chain of kernels (an engine's post-process passes, a particle update) would write the same.

### After this change

The author writes each operation as a kernel function. No `@compute`, no binding and no `global_invocation_id` is written:

```ts
// ops.shade.ts
"use typeshade";

export function add(out: array<f32>, a: array<f32>, b: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i] + b[i];
  }
}

export function mul(out: array<f32>, a: array<f32>, b: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i] * b[i];
  }
}

export function relu(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = max(x[i], 0.);
  }
}
```

The host fuses a chain of calls inside one scope. `fuse` comes from a new subpath, `typeshade/fuse`, which the host imports on purpose, as it imports `typeshade/emit`:

```ts
import { resident } from 'typeshade/runtime';
import { fuse } from 'typeshade/fuse';
import { add, mul, relu } from './ops.shade.ts';

const out = resident(new Float32Array(n));
const report = await fuse((scope) => {
  const t = scope.scratch(n);
  const u = scope.scratch(n);
  add(t, a, b);
  mul(u, t, c);
  relu(out, u);
});
report.dispatches; // 1
report.submissions; // 1
const y = await out.read();
```

The runtime runs the body once, synchronously. A kernel call made inside the body whose every written array is a `Resident` is recorded and not yet run. At the body's return, the runtime plans the recorded calls in the order they were made. The plan fuses a producer with the consumer that follows it when the facts below allow it. The plan then runs as one unit in the kernel queue, at the point the scope holds in the order of Rule 11.8. A call or a `read()` made after the scope sees what the plan wrote. The promise resolves to the report when the plan has run, and rejects with the first error.

The fused group of the example is one compute entry. Its body is the three loop bodies, one after another, for one index. The two scratch arrays become locals:

```wgsl
@compute @workgroup_size(64)
fn fused_add_mul_relu(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= args._n) {
    return;
  }
  let i = args._start + gid.x;
  let t_i = a[i] + b[i];
  let u_i = t_i * c[i];
  out[i] = max(u_i, 0.0);
}
```

For each index, the fused entry computes what the three calls compute for that index, in the same order and with the same `f32` rounding at each operation. The CPU tier does not fuse: it runs the recorded calls one after another, so it stays the oracle of the fused group (Rule 11.7).

### The facts that allow a fusion

The compiler writes a fact record for each accepted loop into the generated module at build time, beside the loop's entry. The runtime matches facts; it analyzes no IR. A producer loop P and the consumer loop C that follows it fuse when:

- F1. Each is the one candidate loop of its kernel function, and the function lowers (Rule 8.22). A function with several loops, a scatter loop, a loop that writes a texture and a function that runs on the CPU take no part in a fusion; they run apart.
- F2. The two loops have the same start, the same bound and the same step. The range functions give these on the CPU tier before anything runs, as the call does today.
- F3. Every array P writes, it writes at exactly `i`; the proof already records the write form `a*i + c` (Rule 8.22, R3), and `a = 1, c = 0` is the accepted form. Every array C reads that P writes, C reads at exactly `i` and does not write. This read fact is new: the proof records, for each array parameter a loop reads without writing, whether every read is at `i`, and otherwise the first read that is not, in the author's words.
- F4. No array C writes is one P reads or writes. A `Resident` may be read by both calls. The same `Resident` as two parameters of one call stays refused (Rule 11.8).
- F5. The fused entry binds no more storage buffers than the device allows (`maxStorageBuffersPerShaderStage`), counting each distinct `Resident` once and no contracted scratch array.
- F6. P does not reduce. A reduction loop may be C: its per-iteration contribution takes P's body as a prologue, and the fold entries and the CPU tail stay as they are (Rule 7.2).

A group grows while the next call fuses with the last call in it. A refusal starts a new group. The report counts the dispatches and the submissions of the plan, names each group, says whether it was fused, and for a group that did not join the one before it, says why in the author's words, in the form the kernel loop warning uses (`TS8070`): "mul and blur run as two dispatches because blur reads `t[i - 1]`".

### Scratch arrays

`scope.scratch(length, element?)` makes a `Resident` the host promises not to read. `element` is `'f32'`, `'i32'` or `'u32'`, `'f32'` by default. Inside a fused group the plan contracts it to a local and allocates no buffer. Where a refusal leaves it a real intermediate, the plan allocates it for the scope and releases it at the end. `read()` on a scratch array is a `TypeError` naming it as scratch. A `Resident` made with `resident()` keeps its buffer and its write inside a fused group, so the host can read it after the scope.

### What stays as it is

- A kernel call outside a scope runs as today, in order, one dispatch per loop.
- A call inside the body that is not a kernel call with resident written arrays (a call with a host array to read back, an entry call of Rule 8.24, a draw) is a `TypeError` naming the call. Close the scope around it.
- A nested `fuse` joins the scope around it; one plan runs.
- The body is synchronous. An `async` body is a `TypeError`.
- On WebGL2 a fused group runs only when it writes one array (Rule 11.8); otherwise its calls run apart, and the report says so. The CPU tier never fuses.
- The `typeshade/runtime` bundle imports nothing of this: `fuse` lives in `typeshade/fuse`, and a generated module carries the facts and the loop IR only when the plugin is told to write them (`typeshade({ fuse: true })`).

## Why

### The evidence

typenn PR #6 (head `02479b1`) is the consumer experiment #562 asked for. Its measurements, taken on 2026-10-12 in this review:

| Observation                                                                           | Unfused                | Fused                  |
| ------------------------------------------------------------------------------------- | ---------------------- | ---------------------- |
| 32,768 elements, `add → mul → relu`, WebGPU on SwiftShader, Chromium 141, warm median | 11.4 ms, 3 dispatches  | 7.7 ms, 1 dispatch     |
| 1,048,576 elements, TypeNN's CPU executor                                             | 739 ms                 | 319 ms                 |
| TypeNN's published bundle                                                             | 2,222 kB (gzip 198 kB) | 2,646 kB (gzip 314 kB) |

The speedup is real and the mechanism works. The cost is where it was paid: the consumer ships the compiler (+116 kB gzipped), compiles at run time on each new topology, and carries about 600 lines of planner and validator plus a build-time extraction script. Its fusion covers scalar maps only. A reduction, a broadcast and a matmul epilogue would each need the consumer to grow its own compiler.

The compiler already has what a general answer needs. The proof of Rule 8.22 records the write index of every array a loop writes, the reduction it combines, and the calls it makes, with no solver and no alias analysis. Residency (Rule 11.8) already keeps a chain's arrays on the device; #252 measured why that matters. What is missing is one read fact, a recorder, a planner over facts, and an emitter that is already in the tree (`typeshade/emit` holds the WGSL writer without the TypeScript front end, Rule 11.11).

### The computing-platform plan

`docs/computing-platform-plan.md` (#554) sets the direction this proposal follows. Its planner "should reference existing typed functions and their effect summaries; it must not duplicate function bodies or invent a second type system", and a minimal plan describes operation identity, whole-resource read and write access, true dependencies, barriers, target constraints and temporary storage lifetime. In this proposal the plan record is exactly that: the kernel function and its loop, the `Resident` arrays each call reads and writes, the dependency from a write to the reads after it, a call that cannot fuse as a barrier, and a scratch array's lifetime. The fused entry is not a plan record. It is a transformation of the IR under the contract F1 to F6, done by the compiler's own writer in `typeshade/fuse`. There is no second IR and no second type system.

The plan says: "Begin with correct ordering and one-device command batching. Add resource reuse, safe fusion, asynchronous overlap and cost-guided placement only when deterministic tests and benchmarks justify each step." The implementation steps below follow that order. `journeys/mnist/REPORT.md` records that every dispatch is submitted and awaited today, four completion waits per training batch, and asks for submission batching to be benchmarked first. Step 2 gives one submission per scope and is measured before any fusion.

The plan leaves two decisions open that this proposal answers for kernel functions. The minimal resource-access summary that is safe without alias analysis is the whole-`Resident` reads and writes plus the write-at-`i` and read-at-`i` facts of the proof. A fusion requires exact equality with the unfused CPU tier; a user-declared tolerance is not part of this proposal.

P3's acceptance reads: "at least one multi-kernel workload has validated equal results and measured improvement over unplanned execution; failing cases explain why optimization did not occur." That is this proposal's acceptance at step 3, with the report's reasons as the explanation.

### Why a scope, and not lazy calls

Every kernel call runs in the order it was made, whether or not the caller awaits it (Rule 11.8). Deferring every call until a `read()` would keep that order, but it would move each call's error to a later point and change what a caller sees at every call site. A scope defers only the calls made inside it, says so at the call site, and keeps the rules outside it as they are. The platform plan warns against a global scheduler before measured evidence from several independent calls; a scope is local and explicit, and measures one chain at a time.

### Why facts at build time, and a plan at run time

The analysis is the compiler's and runs once. The plan depends on lengths and on which `Resident` is which, known only at the call. Splitting the two keeps `typeshade/fuse` free of `src/compiler/` (Rule 11.11) and keeps the refusal wording in the author's names, which only the compiler has.

### Alternatives

- **Composition in the consumer** (typenn PR #6): works today through the public IR builder and `packModule`. Rejected as the lasting answer for the reasons above: the compiler work moves into every consumer, and it stops at scalar maps.
- **Fusion by the Vite plugin at build time**, for a scope whose calls are known statically: no emitter in the application. A good follow-up for a static pipeline. Not first, because TypeNN's chains exist only at run time.
- **A tensor-expression layer** (maps, reductions and index maps with a scheduler, as Halide and TVM have): the general design. Not now: it is a new IR, and #562 says to add none before the experiment shows the gap. The gap the experiment shows is a chain fusion over facts the proof already has.
- **Lazy `Resident` calls**: see above.

### Assumptions

- The proof's write facts suffice for F3; the read fact is a syntactic check of the same kind. If a loop reads an array through a helper, the helper takes the element by value (Rule 8.23 refuses an `array<T>` parameter elsewhere), so the check stays in the loop body.
- A backend may contract floating-point operations across what used to be a storage write and a storage read. The differential gate measures this per device, as it does for a single kernel today, and a difference is a finding before step 1 is accepted as delivered.

## What it touches

- **Rule 8.22:** the proof also records, for each array parameter a loop reads without writing, whether every read is at `i`, and otherwise the first read that is not, in the author's words.
- **Rule 11.8:** the recorded calls of a scope run as one unit at the scope's point in the order; the WebGL2 condition applies to a fused group as a whole; a scratch array's `read()` is a `TypeError`.
- **Rule 11.11:** `typeshade/fuse` stands beside the load-time emitter: its closure holds no file of `src/compiler/` and no package, within its own budget in `scripts/bundle-budget.json`.
- **Rule 11.13 (new):** the fuse scope: what is recorded, when the plan runs, the facts F1 to F6, the report, scratch arrays, and the guarantee that each tier gives the bits the unfused calls give.
- **Surface §65:** the kernel-function section names the scope and the facts in one paragraph and points to §71.
- **Surface §69:** the runtime's plug-ins: `typeshade/fuse` beside `typeshade/emit`.
- **Surface §71 (new):** the fuse scope, the report, scratch arrays, each refusal with its wording, and the tiers.
- **AUTHORING.md:** one section after "A loop over an array", with the example above.
- **Exports:** `fuse`, `FuseReport` and `FuseScope` from `typeshade/fuse`; `TypeshadeViteOptions` gains `fuse?: boolean`, which writes each kernel function's facts and loop IR into the generated module.
- **Codes:** none planned. A refusal is a plan fact in the report, not a compile diagnostic. Add a code only if implementation finds a form the compiler must refuse at compile time.
- **Example `loop-fuse`:** `examples/loop-fuse.shade.ts` with `add`, `mul`, `relu`, a reduction and a stencil, so one source shows a fused group, a prologue and a refusal.
- **Journey:** `journeys/loop-fuse/`, a host file that calls `fuse` on the packed tarball and checks the report's dispatch count and the output against its own JavaScript reference.

### Implementation steps

1. The read fact in `parallel-loop.ts`, written into the kernel face by `host-face.ts` under `typeshade({ fuse: true })`, with the loop IR.
2. `typeshade/fuse`: the scope, the plan record (operation identity, whole-`Resident` accesses, dependencies, barriers), one submission per scope, and the report with each reason. No fusion yet. Measured against today's one submission per dispatch on the MNIST journey's four dispatches per batch.
3. Fusion of identity-index chains (F1 to F5): the fused entry built from the loop IR as one `ModuleDecl`, emitted by the WGSL writer, compiled and cached per shape (the calls, their edges and their scratch arrays; no lengths and no values), dispatched by the call layer in the kernel queue. P3's acceptance is met here.
4. Scratch arrays and contraction: temporary storage lifetime.
5. The reduction prologue (F6).
6. The example, the journey, the rules, the surface sections and AUTHORING.md.

Each step is its own pull request with `Change: 0058`.

### Draft impact estimate

- **Compiler:** one new fact in the proof, its wording, and its place in the generated module. Known work; small.
- **Runtime:** a new subpath with a recorder, a planner, an IR concatenation and a pipeline cache. Known work; the largest part. Unestimated.
- **Generated module size:** the loop IR and the facts per kernel function, only under `fuse: true`. Basis for the estimate: `ir: true` on TypeNN's 75 packs added 367 kB raw and 45 kB gzipped on 2026-10-12. A kernel function's loop IR is a fraction of a whole module, so the per-function cost is expected below 1 kB gzipped; to be measured on `examples/` before acceptance of step 1 as delivered.
- **Bundle:** `typeshade/fuse` holds the WGSL writer and the validation passes the fused module needs. Its budget is unknown until measured; `typeshade/emit`, which holds both writers, has a budget of 97,500 bytes minified and gzipped.
- **Compatibility:** no existing call changes. A module built without `fuse: true` runs as today; `fuse` on such a module runs every call apart and says so in the report.
- **Dependencies:** none added.
- **Validation work:** listed below.
- **Downstream:** the site and the editor as the front matter says. TypeNN is the first consumer outside this repository: it rewrites its elementwise kernels as kernel functions, calls `fuse` from its tensor graph's execution, and retires the planner, the extraction script and the validator of typenn PR #6. Radiance is the second: its post-process chain. Neither is a repository `scripts/changes.ts` lists, so this record does not declare them.
- **Effort and date:** unestimated. No milestone is set.

### Required validation

- Step 2 measured: the MNIST journey's training batch with one submission per scope against today's four submissions, on one configuration; on SwiftShader this is a comparison, not a hardware claim.
- Unit tests of the planner on hand-built fact records: each of F1 to F6 accepted and refused, the group boundaries and the report's wording.
- `gate:differential` extended with generated chains: random kernel functions (`generateKernelModule`) chained through residents and through scratch arrays, fused on headless WebGPU, every output held bit for bit to the CPU tier running the same calls apart.
- A test that the report's `dispatches` counts actual dispatches of the plan, not frame batching (#562's last criterion).
- `gate:compile` over `examples/loop-fuse.shade.ts`; `gate:journeys` over `journeys/loop-fuse/`.
- `gate:boundary` with a budget for `typeshade/fuse`, and the measured size of the facts and IR in a generated module recorded in this proposal.
- The CSP property: the fused WGSL is text the GPU compiles; no `new Function` is used on any tier (Rule 11.7).

### Decisions

Each item was open in the draft. Seungup accepted the proposed answer of each on 2026-10-12, in the project conversation, by approving the proposal as a whole.

1. The roadmap row is pulled forward: the work starts now. The row in `docs/roadmap.md` is updated when step 6 lands.
2. The subpath is `typeshade/fuse`. `fuse` is not re-exported from `typeshade`; the host imports the subpath, as it imports `typeshade/emit`.
3. An entry call or a draw inside the body is a `TypeError` naming the call.
4. `scope.scratch(length, element)` with a scalar element, `'f32'` by default. A vector or struct element is a later proposal.
5. On WebGL2 a fused group runs only when it writes one array; otherwise its calls run apart and the report says so.
6. A kernel function with several loops takes no part in a fusion; its calls run apart.
7. The option is `typeshade({ fuse: true })`. The facts and the loop IR are written only under the option, in `vite dev` and in `vite build` alike.
8. A producer write at `a*i + c` with `a ≠ 1` does not fuse; identity index only.
9. Step 2 (the record and one submission per scope, without fusion) is delivered and measured on its own before step 3.

### Approval and plan record

Seungup approved the proposal in the project conversation on 2026-10-12 (UTC), after the draft of the same day and its revision for `docs/computing-platform-plan.md`. The approved revision is the one PR #567 merges. The approved scope is the six implementation steps above with the decisions recorded in "Decisions". Responsibilities, as Seungup set them in the same conversation: a Claude Code session orchestrates and reviews; Sonnet and Haiku sub-agents implement; each step is its own pull request with `Change: 0058` and merges under the approved-in-advance rule of `CLAUDE.md` when every required check is green, with no conflict and no open thread. No milestone date and no effort estimate were set. The required validation is the list under "Required validation"; the measurement of step 2 precedes step 3.

### Configuration and validation record

This record applies from step 6, the pull request that sets `status: implemented`. The compiler status does not claim that the site, the editor or a compiler pin is done. That work is `not started`, as "What it owes downstream" lists.

**Accepted revision.** [PR #567](https://github.com/typeshade/typeshade/pull/567), merged into `main` as `d7c3bc0` on 2026-10-12 (UTC) with `status: accepted`. The approved scope is the six steps and the nine decisions above.

**Implementing pull requests.** Each carries a `Change: 0058` line. Each merged into `main` on 2026-10-12 (UTC), except the last.

| Step    | Pull request                                            | Merge commit     | What it delivered                                                                                                                                                      |
| ------- | ------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | [#569](https://github.com/typeshade/typeshade/pull/569) | `7e4e453`        | The read fact in the proof, and the loop facts and the loop IR in the kernel face under `typeshade({ fuse: true })`.                                                   |
| 2       | [#570](https://github.com/typeshade/typeshade/pull/570) | `f144f26`        | `typeshade/fuse`: the scope, the plan record, one submission for a scope, and the report. No fusion.                                                                   |
| 3       | [#573](https://github.com/typeshade/typeshade/pull/573) | `fb7725e`        | The planner (F1 to F5) and the fused entry.                                                                                                                            |
| 3b      | [#579](https://github.com/typeshade/typeshade/pull/579) | `d2eb280`        | The chain arm of `gate:differential`, over generated chains.                                                                                                           |
| 4       | [#574](https://github.com/typeshade/typeshade/pull/574) | `c934e08`        | Scratch arrays, and their contraction to locals.                                                                                                                       |
| example | [#583](https://github.com/typeshade/typeshade/pull/583) | `96d9104`        | The host example `loop-fuse`, without its reduction.                                                                                                                   |
| 5       | [#586](https://github.com/typeshade/typeshade/pull/586) | `a20a488`        | The reduction prologue (F6).                                                                                                                                           |
| 6       | [#589](https://github.com/typeshade/typeshade/pull/589) | the merge record | Rules 8.22, 11.8, 11.11 and 11.13; surface §65, §69 and §71; `AUTHORING.md`; the example's reduction; the rule tags; roadmap item 15a; the platform plan; this record. |

**Responsible actors.** Seungup approved the proposal and owns each disposition marked `open` below. A Claude Code session orchestrated the steps, wrote their briefs and reviewed their diffs. Sub-agents implemented the steps: the bodies of #569 and #570 name a Sonnet sub-agent, and the bodies of #573, #574, #579 and #586 say "the implementer". A separate Claude Code session wrote #583 at Seungup's request. A Sonnet 5.5 sub-agent wrote step 6. No schedule and no effort estimate was set.

**Delivered configuration.**

- The subpath `typeshade/fuse` (`package.json` exports `./fuse`, `src/fuse.ts`) exports `fuse`, `FuseReport` and `FuseScope`. `TypeshadeViteOptions` gains `fuse?: boolean`. No diagnostic code is added.
- The compiler: the read fact in `src/core/passes/parallel-loop.ts`; `iterates`, `iteration` and `continues` of a loop's plan in `src/core/passes/kernel-lower.ts`; `describeRead` in `src/compiler/ts/kernel-loops.ts`; `fuseRecord` and `bareArrays` in `src/compiler/ts/host-face.ts`; the option in `src/vite.ts`.
- The runtime: the slot `src/core/fuse-scope.ts`, the recorder, plan, report and scratch arrays in `src/core/fuse-plan.ts`, the planner `src/core/fuse-group.ts`, and the builder `src/core/fuse-entry.ts`. In the call layer: `checkCall`, `runChecked` and `reduceOnGpu` in `src/core/host-kernel.ts`, `DispatchBatch` in `src/core/host-entry.ts`, and the refusals in `src/core/resident.ts`, `src/core/host-compute.ts` and `src/core/host-draw.ts`.
- The tests and gates: `src/fuse.test.ts`, `src/core/fuse-group.test.ts`, `src/core/fuse-entry.test.ts`, `src/core/testing/random-chain.test.ts`, the generator `generateChain` in `src/core/testing/random-ir.ts` and `src/core/testing/fuse-chain.ts`, the chain arm of `scripts/gpu-differential.ts`, `scripts/bundle-boundary.ts` with `scripts/bundle-budget.json`, `journeys/loop-fuse/`, and `journeys/mnist/batch.shade.ts` with `bench-submissions.mjs`.
- The example: `examples/hosts/loop-fuse/` (`loop-fuse.shade.ts` and `host.ts`), listed in `examples/hosts/_drive.ts`, `_reference.ts` and `_order.ts`, and held by `scripts/user-journey.ts`.
- The documents: Rules 8.22, 11.8, 11.11 and 11.13 of `docs/language-design.md`; surface §65, §69 and §71; `AUTHORING.md`; roadmap item 15a; `docs/computing-platform-plan.md`; `CHANGELOG.md`.

**Measured sizes.** Measured on `main` `a20a488` with the files of this pull request applied, on 2026-10-12 (UTC). The sizes of earlier steps are those the pull requests report.

| Item                                               | Size                                                                                                                         | Measured by                                                                                                                    |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `typeshade/fuse` bundle                            | 73,890 bytes minified and gzipped (floor 35,700, budget 86,000); 11,052 at step 2, 71,683 at step 3, 73,006 at step 4        | `bun run gate:boundary`                                                                                                        |
| `typeshade/runtime` bundle                         | 29,340 bytes (floor 13,500, budget 29,800); 29,174 before the change                                                         | `bun run gate:boundary`                                                                                                        |
| `typeshade/emit` bundle                            | 92,422 bytes (floor 44,200, budget 97,500), unchanged                                                                        | `bun run gate:boundary`                                                                                                        |
| The module of `journeys/loop-fuse/ops.shade.ts`    | 2,560 bytes without `fuse: true`, 4,368 bytes with it: 1,808 bytes more for five kernel functions, 362 bytes each on average | The generated module that `hostFace` returns to `typeshade()`, minified by Bun 1.4.2 (imports external) and gzipped at level 9 |
| The same, for a module of one function             | `add` alone: 1,277 and 1,945 bytes (668 more). `total` alone, a reduction: 1,448 and 2,723 bytes (1,275 more)                | The same, on the function copied into a module of its own                                                                      |
| The same, for the four map functions in one module | 992 bytes more                                                                                                               | The same                                                                                                                       |

The estimate of the draft, below 1 kB gzipped for each function, holds for a map function and fails for a reduction (deviation D1).

**Validation that ran.** Functional validation and the document audit are kept apart.

- The latest full list before this step is that of #586: `d889ee2`, rebased onto `main` `69a213a`, on 2026-10-12 (UTC), bun 1.4.2, node 22.22.0, Chromium 141.0.7390.37 on SwiftShader. `bun run build`, `lint` and `format:check` exit 0. `bun run test`: 419 files, 9,270 passed, 4 skipped, 1 todo. `gate:boundary`: `typeshade/fuse` 73,890 bytes, `typeshade/runtime` 29,340. `gate:journeys`: 25 journeys, 56 runs, every check passed, `loop-fuse#0` to `#3` on WebGPU, WebGL2 and the CPU tier with worst relative error 0. `gate:compile`: 156 examples, 0 failures. `gate:differential`: exit 0 (the WebGPU arm 48 kernel functions and 224 calls, the chain arm 48 chains, the WebGL2 arm 288 functions, the compute arm 23 entries, 0 failures in each). `gate:render` did not run. Its document audit: `doc-impact` (8 review items, no must-fix), `docs:refs` (0 dead references in 1,100 files), `changes.ts`, `ifchange.ts`, `reqs-sync --check` and `doorstop -C -e -F` passed.
- Step 6 ran on a copy of `main` `a20a488` with the files of this pull request applied, which is the tree of the pull request once it is on `main`. The branch of the pull request is based on `d889ee2`, the head of #586, and CI runs on the head of the pull request. Date: 2026-10-12 (UTC). Tools: bun 1.4.2, node 22.22.0, vitest 3.2.7, Doorstop 3.2, Chromium 141.0.7390.37 on SwiftShader. Functional: `bun run build`, `lint` and `format:check` (Prettier and the semicolon check) exit 0. `bun run test`: 420 files, 9,399 passed, 4 skipped, 1 todo. That includes `src/changes.test.ts`, `src/reqs.test.ts`, `src/compiler/ts/doc-snippets.test.ts`, `examples/host-examples.test.ts` and `examples/emit-goldens.test.ts`. `gate:boundary`: `typeshade/fuse` 73,890 bytes, `typeshade/runtime` 29,340, `typeshade/emit` 92,422. `gate:compile`: 157 examples, 0 failures. `gate:journeys`: 25 journeys, 56 runs, every check passed. It holds the three reports of the host example on WebGPU (1 dispatch in 1 submission, 2 dispatches in 1 submission with its `why`, and 2 dispatches in 2 submissions for `add`, `mul` and `total`) and each result to the reference. `examples/host-examples.test.ts` holds each of the three scopes on the CPU tier to the tier `cpu`, 0 dispatches and no fused group, and the values to the reference. `gate:differential`: exit 0 in 2 minutes (the WebGPU arm 48 kernel functions and 224 calls, the chain arm 48 chains and 96 runs, the WebGL2 arm 288 functions, the compute arm 23 entries, 0 failures in each). `gate:render` did not run: this step changes no emitted code (the emit golden of `loop-fuse` is one byte, since a kernel function emits nothing).
- Document audit of step 6, same tree: `bun scripts/doc-impact.ts --staged`: 13 review items (Rules 8.22, 11.8, 11.11 and 11.13, and 9 changed files), no must-fix, and `--check` exits 0. Each listed mention was read. One sentence changed: the row of `.github/workflows/ci.yml` in `AGENTS.md` now names the fuse scope beside the runtime and the emitter. `bun run docs:refs`: 0 dead references in 1,103 files. `bun scripts/ifchange.ts` passed. `PR_BODY='Change: 0058' bun scripts/changes.ts --staged` passed: the change touches Rules 8.22, 11.8, 11.11 and 11.13 and surface §65, §69 and §71, and the proposal declares all of them. `bun run reqs:sync` leaves `reqs/` as it is. `doorstop -C -e -F` exits 0 after the review of RULE-0822, RULE-1108, RULE-1111, RULE-1113 and SURF-038, and the clear of SURF-038, SURF-065, SURF-067, SURF-069 and SURF-071. Each item was marked after the text and the files it names were read. The refusal wordings, the `why` reasons and the counts that surface §71 states were compared with `src/core/fuse-plan.ts`, `src/core/fuse-group.ts` and `src/core/host-kernel.ts` at `main` `a20a488`.

**Required validation.** The status of each item of "Required validation" above.

| Item                                                                                                                         | Status                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step 2 measured: a training batch, one submission for a scope against four                                                   | Done in #570 on SwiftShader: a median of 4.9 to 5.1 ms in a scope against 5.2 to 5.9 ms apart over 20 batches, in three runs. It is a comparison and not a hardware claim.                                                                                     |
| Unit tests of the planner on hand-built fact records                                                                         | Done: `src/core/fuse-group.test.ts` accepts and refuses each of F1 to F6 and words every `why`.                                                                                                                                                                |
| `gate:differential` with generated chains, through residents and through scratch arrays                                      | Partly done. The chain arm over residents is done (#579). The arm over scratch arrays and over reductions is open (deviation D14).                                                                                                                             |
| The report's `dispatches` counts the dispatches of the plan, not frame batching                                              | Done: `src/fuse.test.ts` counts on a recording device, and `journeys/loop-fuse` holds the report to the dispatches and submissions that the device counts itself.                                                                                              |
| `gate:compile` over the example; `gate:journeys` over `journeys/loop-fuse/`                                                  | Done. The example is `examples/hosts/loop-fuse/loop-fuse.shade.ts` (deviation D12). The three reports of the host example are asserted on WebGPU in `scripts/user-journey.ts`.                                                                                 |
| `gate:boundary` with a budget for `typeshade/fuse`, and the size of the facts and IR recorded here                           | Done: budget 86,000 and floor 35,700 in `scripts/bundle-budget.json`; the sizes are in "Measured sizes".                                                                                                                                                       |
| The CSP property: the fused WGSL is text the GPU compiles, and no tier uses `new Function`                                   | Done in the follow-up pull request of D15 (deviation D15, closed). The builder emits text with the WGSL writer. `gate:boundary` parses each minified bundle and fails on `new Function`, `Function(`, `eval(` or `import(`. It first reports each one planted. |
| P3's acceptance in `docs/computing-platform-plan.md`: equal results, measured improvement, a reason for each call kept apart | Done for kernel-function chains on a software adapter: equal bits (`gate:differential`, the journeys), 0.56 to 0.93 of the time apart over scratch arrays, and a `why` for each group that stands apart. No hardware measurement was made.                     |

**Decisions as delivered.** Decisions 1, 2, 3, 4, 6, 7, 8 and 9 hold as delivered. Decision 5 does not: WebGL2 runs the calls of a scope apart (deviation D2).

**Deviations.** Each difference between the approved text and the delivered work, with its disposition: `closed`, `accepted` (now stated in Rule 11.13, where the table says so) or `open`. An `open` item has its reason and its next action in the last column.

| No. | Deviation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Source                       | Disposition                                                                                                                                                                                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | A reduction loop's record is above the draft's estimate of below 1 kB gzipped: 1,275 bytes for `total` alone, and 1.25 to 1.46 kB in #569. A map function's record is 668 bytes.                                                                                                                                                                                                                                                                                                                                                                                                                                            | #569, #590                   | Open. Reason: the draft left the estimate to a measurement, and it is made. The JSDoc of `TypeshadeViteOptions.fuse` is worded from the measurements (0.7 kB for a map, 1.3 kB for a reduction) in #590. Next action: Seungup records whether the draft's estimate stands for maps only. The option stays off by default. |
| D2  | WebGL2 does not fuse. Decision 5 planned a fused group that writes one array there. The calls of a scope run apart, and the report says `WebGL2 runs the calls apart`.                                                                                                                                                                                                                                                                                                                                                                                                                                                      | #573                         | Open. Reason: not built. Next action: a later step, or an amendment of decision 5 if Seungup prefers fusion on WebGPU alone.                                                                                                                                                                                              |
| D3  | A group whose fused entry cannot be built runs its calls apart, and each call after the first says why.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | #573                         | Accepted, now in Rule 11.13.                                                                                                                                                                                                                                                                                              |
| D4  | F5 counts a scratch array as a buffer until the last call of the plan that names it has joined the group, so a call that would fit only after a later call joins is refused at the limit.                                                                                                                                                                                                                                                                                                                                                                                                                                   | #574                         | Accepted, now in Rule 11.13.                                                                                                                                                                                                                                                                                              |
| D5  | A scratch array that no call writes is not contracted. It stays a zeroed buffer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | #574                         | Accepted, now in Rule 11.13.                                                                                                                                                                                                                                                                                              |
| D6  | An entry call or a draw (Rule 8.24) given a scratch array after its scope fails with the existing `Misfit` ("got undefined"), which does not name scratch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | #574, #594                   | Closed. Delivered by #594.                                                                                                                                                                                                                                                                                                |
| D7  | The levels of a reduction are a submission each, because the partials are read back between them, and not part of the one submission of the plan (R1 finding 22).                                                                                                                                                                                                                                                                                                                                                                                                                                                           | #570, #586, #595             | Closed. Delivered by #595. The levels and the copy of the folded slot are in the plan's one submission: `add → mul → total` reports 1 submission over 1,000 and over 70,000 elements, and reported 2 and 3.                                                                                                               |
| D8  | `read()` in the body is a `TypeError`, with `write()`, `destroy()` and every other use of the queue. The brief of step 2 had said that a `read()` in the body sees the plan.                                                                                                                                                                                                                                                                                                                                                                                                                                                | #570                         | Accepted, now in Rule 11.13.                                                                                                                                                                                                                                                                                              |
| D9  | The plan is checked whole before any call runs. A scope with a call on WebGL2 or the CPU submits more than once, and the report says so.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | #570                         | Accepted, now in Rule 11.13. A scope with a reduction submitted more than once until D7.                                                                                                                                                                                                                                  |
| D10 | `FuseReport.tier` is the best tier any call of the plan ran on: WebGPU before WebGL2 before the CPU tier.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | #570                         | Accepted, now in Rule 11.13.                                                                                                                                                                                                                                                                                              |
| D11 | The facts carry more than the draft lists (`scatters`, `continues`, `iterates`, `iteration`, a store beside a read). The first access that is not at `i` was worded `arrayLength(t)`, and an array that a loop only measures was not among them.                                                                                                                                                                                                                                                                                                                                                                            | #569, #573, #574             | Closed. Step 4 worded it `t.length` and added the fact `bare`. Rule 8.22 states the facts.                                                                                                                                                                                                                                |
| D12 | The example is `examples/hosts/loop-fuse/`, the host-example layout of change 0061, and not `examples/loop-fuse.shade.ts`. `scripts/changes.ts` does not scan `examples/hosts/`.                                                                                                                                                                                                                                                                                                                                                                                                                                            | #583                         | Closed for this change: the id `loop-fuse` is declared and exists, and `src/changes.test.ts` checks both layouts. The scan of `scripts/changes.ts` is an open item of change 0061.                                                                                                                                        |
| D13 | The host example left out the reduction until step 6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | #583                         | Closed. `total` and a third scope, `add`, `mul` and `total`, are in the module and the host, with their report asserted in `scripts/user-journey.ts`.                                                                                                                                                                     |
| D14 | The chain arm of `gate:differential` draws no scratch array and no reduction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | #579, #586                   | Open. Reason: a follow-up. Next action: a pull request that marks arrays with no host read as scratch and draws reducing calls.                                                                                                                                                                                           |
| D15 | No committed check holds the CSP property for `typeshade/fuse`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | step 6, #593                 | Closed. Delivered by #593.                                                                                                                                                                                                                                                                                                |
| D16 | The host example lists WebGPU and the CPU tier, not WebGL2: its third scope ends in `total`, which reduces, and a reduction is refused with WebGL2 alone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | step 6                       | Closed. `host-kernel` and `host-resident` list the same tiers for the same reason.                                                                                                                                                                                                                                        |
| D17 | The tests of steps 2 to 5 carried no rule tag (#570 deviation 5), and #569 deviation 4 left the step 1 tests to step 6. Now `src/fuse.test.ts` (Rules 11.8 and 11.13), `src/core/fuse-group.test.ts`, `src/core/fuse-entry.test.ts` and `src/core/testing/random-chain.test.ts` carry `Verifies`. The three step 1 tests already carried `Verifies: Rule 8.22`. `src/fuse.ts`, `src/core/fuse-plan.ts`, `src/core/fuse-group.ts` and `src/core/fuse-entry.ts` carry `Implements: Rule 11.13`, a comment line, so that Doorstop finds the rule in the files its "Enforced by" names.                                         | #569, #570, step 6           | Closed. No behavior changes.                                                                                                                                                                                                                                                                                              |
| D18 | The JSDoc of `FuseReport.tier` in `src/core/fuse-plan.ts`, and so the API reference, says "in the order `configure({ prefer })` allows". The code ranks WebGPU, WebGL2, CPU, as Rule 11.13 says.                                                                                                                                                                                                                                                                                                                                                                                                                            | step 6                       | Closed. The orchestrating session changed the JSDoc in the pull request of step 6: the best tier any call ran on, WebGPU before WebGL2 before the CPU tier, and each call on the first tier of `configure({ prefer })` that can run it.                                                                                   |
| D19 | The pull requests record these as measurement and test design, each `closed` there: #570 runs the MNIST stages as kernel functions; #574 counts the buffers of one array's size; #579 gives the generator a strided write, runs a refused pair as a unit test, keeps `generateChain` in `random-ir.ts` and writes `bare` in `lowerFace`; #583's WebGL2 run exposed a runtime fault that #581 fixed; #586 shares one shader module for each WGSL text, moves the level loop into `reduceOnGpu`, gives the harness `webgl2.why`, compares a 70,000-element case with the tree sum and gives `bench-reduce.mjs` random inputs. | #570, #574, #579, #583, #586 | Closed, as the pull requests record them.                                                                                                                                                                                                                                                                                 |

**Open items.** Each has its reason and its next action in the table above: D1, D2 and D14. Issue #578 is related and is not this change's: the chain arm found, at 400 seeds, a generated program whose lowered plan holds an integer division by zero that Tint refuses.

**Follow-up of D7, measured.** Measured on `main` `5fb79c7` with the files of the follow-up applied, on 2026-10-12 (UTC). Tools: bun 1.4.2, node 22.22.0, Chromium 141.0.7390.37 on SwiftShader. The machine was shared, with a load average of 7 to 25 on 4 cores. Counts, which `journeys/loop-fuse` and `journeys/loop-fuse/bench-reduce.mjs` hold to what the device is given: `add → mul → total` is 2 dispatches in 1 submission over 1,000 and over 32,768 elements, and 3 dispatches in 1 submission over 70,000 and over 1,048,576 elements. It was 2 in 2 and 3 in 3. The three calls apart are 4 dispatches in 3 submissions and 5 in 3. They were 4 in 4 and 5 in 5. The device is asked for 2 buffers fewer over 32,768 elements and 4 fewer over 1,048,576. Sizes: `typeshade/fuse` 74,243 bytes minified and gzipped (73,890 before; budget 86,000), `typeshade/runtime` 29,343 (29,340; budget 29,800) and `typeshade/emit` 92,422, unchanged. No budget moved. Time is host wall time on a software device, not a hardware claim. `bench-reduce.mjs` ran three times with 20 samples, each run of the changed build next to a run of the build before it. The medians below are the median of the three run medians, in ms, for the calls apart, a scope without the facts, a scope over residents and a scope over scratch arrays. Over 32,768 elements: 57.2, 50.9, 51.9 and 46.3 before, and 51.8, 48.6, 56.0 and 42.8 after. Over 1,048,576 elements: 1,721, 1,818, 1,762 and 1,615 before, and 1,781, 1,895, 1,730 and 1,622 after. The run medians of one build differ from each other by more than the two builds differ, so the runs show no change in time. A first set of runs, taken while this session ran its lint and format checks on the same machine, is left out. A browser that ran both builds and alternated the samples gives a finer comparison: 100 pairs over 32,768 elements and 20 over 1,048,576. `add → mul → total` over scratch arrays in a scope took 45.0 ms before and 40.6 ms after over 32,768 elements. The median of the paired differences is 4.3 ms, and the changed build was faster in 69 of 100 pairs. Over 1,048,576 elements it took 1,683 ms before and 1,643 ms after, and the changed build was faster in 13 of 20 pairs. The reduction alone, outside a scope, took 42.7 ms before and 42.4 ms after over 32,768 elements, and 1,141 ms before and 1,203 ms after over 1,048,576. Every run gave the sum of random `f32` numbers the same bits in both builds, on the CPU tier and in a scope.

**Downstream.** The site and the editor have not started. Their work is the list under "What it owes downstream": status `not started` for `typeshade.github.io` and for `vscode-typeshade`, each until its pin moves to a compiler that carries 0058 and its `compiler-changes.md` records the id. TypeNN and Radiance are tracked in their own repositories.

## What it owes downstream

- `typeshade.github.io`: the control-flow page's kernel-function copy, en and ko, gains the fuse scope and its report; the WebGPU concept page's runtime copy gains `typeshade/fuse` beside the load-time emitter; the API reference gains `fuse`, `FuseReport` and `FuseScope` from the compiler's JSDoc; the gallery, the Playground picker and the stills gain `loop-fuse`; `compiler-changes.md` records 0058 when the pin moves. The exact files are confirmed at acceptance against that repository's default branch.
- `vscode-typeshade`: the skill's compute section and `references/host.md` gain the fuse scope, scratch arrays and the report; `references/diagnostics.md` changes only if a code is added; `compiler-changes.md` records 0058 when the pin moves.
- Consumers outside the declared list: TypeNN (typenn#4, typenn PR #6) retargets its acceptance cases to the report, one dispatch for `add → mul → relu`, the refusal reasons, a later read of an intermediate, and an unfused gradient graph; Radiance's post-process chain follows. These are tracked in their own repositories, not here.
