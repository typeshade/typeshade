---
id: '0058'
title: A host fuses a chain of kernel-function calls into one dispatch inside a `fuse` scope, and reads why each pair the runtime keeps apart stays apart
status: draft
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
| Revision context            | 2026-10-12, UTC. The date means the authorship of this draft. It is not an approval date.                                                                                                                                                                                                                                                                     |
| Request source              | Seungup's go-ahead in the project conversation on 2026-10-12, after a review of [typenn PR #6](https://github.com/typeshade/typenn/pull/6). The parent issue is [typeshade/typeshade#562](https://github.com/typeshade/typeshade/issues/562); the consumer prototype is [typenn#4](https://github.com/typeshade/typenn/issues/4).                             |
| Attribution                 | Drafted by Claude Code, an AI assistant, at Seungup's request. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                          |
| Current lifecycle state     | `draft`. No approval exists.                                                                                                                                                                                                                                                                                                                                  |
| Applicability / effectivity | The kernel-function pipeline (`src/core/passes/parallel-loop.ts`, `src/core/passes/kernel-lower.ts`, `src/compiler/ts/host-face.ts`), the call layer (`src/core/host-kernel.ts`, `src/core/resident.ts`), a new subpath `typeshade/fuse`, the Vite plugin (`src/vite.ts`), the rules, the surface reference and AUTHORING.md. No release version is assigned. |
| Review baseline             | `main` at `8b34888c2697227c3dd34723714468c29484e4cc`.                                                                                                                                                                                                                                                                                                         |
| Proposal review             | [PR #567](https://github.com/typeshade/typeshade/pull/567), opened on 2026-10-12 as the proposal-only review. Its review and merge records will establish acceptance.                                                                                                                                                                                         |
| Revision authority          | Git records revisions. Review and merge records establish decisions.                                                                                                                                                                                                                                                                                          |

This proposal is the roadmap row "Fusing a chain of device-resident calls into one dispatch" (`docs/roadmap.md`, After 1.0). It proposes to pull that row forward. The decision to do so is the owner's and is listed under unresolved decisions.

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

A group grows while the next call fuses with the last call in it. A refusal starts a new group. The report names each group, says whether it was fused, and for a group that did not join the one before it, says why in the author's words, in the form the kernel loop warning uses (`TS8070`): "mul and blur run as two dispatches because blur reads `t[i - 1]`".

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

### Why a scope, and not lazy calls

Every kernel call runs in the order it was made, whether or not the caller awaits it (Rule 11.8). Deferring every call until a `read()` would keep that order, but it would move each call's error to a later point and change what a caller sees at every call site. A scope defers only the calls made inside it, says so at the call site, and keeps the rules outside it as they are.

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
2. `typeshade/fuse`: the recorder, the plan over facts F1 to F5, the fused entry built from the loop IR as one `ModuleDecl`, emitted by the WGSL writer, compiled and cached per shape (the calls, their edges and their scratch arrays; no lengths and no values), dispatched by the call layer in the kernel queue; the report.
3. Scratch arrays and contraction.
4. The reduction prologue (F6).
5. The example, the journey, the rules, the surface sections and AUTHORING.md.

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

- Unit tests of the planner on hand-built fact records: each of F1 to F6 accepted and refused, the group boundaries and the report's wording.
- `gate:differential` extended with generated chains: random kernel functions (`generateKernelModule`) chained through residents and through scratch arrays, fused on headless WebGPU, every output held bit for bit to the CPU tier running the same calls apart.
- A test that the report's `dispatches` counts actual dispatches of the plan, not frame batching (#562's last criterion).
- `gate:compile` over `examples/loop-fuse.shade.ts`; `gate:journeys` over `journeys/loop-fuse/`.
- `gate:boundary` with a budget for `typeshade/fuse`, and the measured size of the facts and IR in a generated module recorded in this proposal.
- The CSP property: the fused WGSL is text the GPU compiles; no `new Function` is used on any tier (Rule 11.7).

### Unresolved decisions

1. Pull the roadmap row forward before 1.0, or keep it after 1.0.
2. The subpath name, `typeshade/fuse`, and whether `fuse` is also re-exported from `typeshade`.
3. An entry call or a draw inside the body: a `TypeError`, as proposed, or a barrier that runs apart in order.
4. The scratch API: `scope.scratch(length, element)` with scalar elements, as proposed, or a vector and struct element from the start.
5. WebGL2 in step 2: fuse only a group that writes one array, as proposed, or no WebGL2 fusion until a later proposal.
6. A kernel function with several loops: apart, as proposed, or its first and last loop as consumer and producer.
7. The option name `fuse: true`, and whether `vite dev` writes the facts always.
8. Whether a producer write at `a*i + c` with `a ≠ 1` (a strided write) may fuse with a consumer read of the same form. Proposed: identity only in this proposal.

### Approval and plan record

This record does not yet apply. Acceptance requires: the actual decision and its pull request, the approved revision and scope, the resolved decisions above, assigned responsibilities and agreed milestones, and the finalized validation list. No approver, schedule or result is recorded here.

### Configuration and validation record

This record does not yet apply. Delivery requires: the accepted revision, the implementing commits and pull requests with `Change: 0058`, the delivered configuration, the measured sizes, the gate results on their tested configuration, and the disposition of each deviation. A completed implementation does not establish downstream completion.

## What it owes downstream

- `typeshade.github.io`: the control-flow page's kernel-function copy, en and ko, gains the fuse scope and its report; the WebGPU concept page's runtime copy gains `typeshade/fuse` beside the load-time emitter; the API reference gains `fuse`, `FuseReport` and `FuseScope` from the compiler's JSDoc; the gallery, the Playground picker and the stills gain `loop-fuse`; `compiler-changes.md` records 0058 when the pin moves. The exact files are confirmed at acceptance against that repository's default branch.
- `vscode-typeshade`: the skill's compute section and `references/host.md` gain the fuse scope, scratch arrays and the report; `references/diagnostics.md` changes only if a code is added; `compiler-changes.md` records 0058 when the pin moves.
- Consumers outside the declared list: TypeNN (typenn#4, typenn PR #6) retargets its acceptance cases to the report, one dispatch for `add → mul → relu`, the refusal reasons, a later read of an intermediate, and an unfused gradient graph; Radiance's post-process chain follows. These are tracked in their own repositories, not here.
