---
id: '0092'
title: A `@compute` entry that reaches a barrier runs on the host's CPU tier too, in the passes the WebGL2 tier runs
status: accepted
rules:
  - '8.24'
  - '11.7'
  - '11.8'
surface:
  - 25
  - 67
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: Replace the statement that an entry reaching a barrier needs a GPU tier on the pages that describe entry calls and their tiers, in both locales, and record 0092 when the pin moves.
  - repo: vscode-typeshade
    what: Replace the same statement in the skill's host reference and in any fixture that expects the TypeError, and record 0092 when the pin moves.
  - repo: typecv
    what: Decide under item 10 of docs/library-structure.md whether the oracle twins and their backend branches go once the CPU tier runs the tiled entries, and record 0092 when the pin moves.
---

<!-- doc-refs: skip-file — this draft names files, options and tests that a later implementation adds, and files of the TypeCV repository, which this tree does not have -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0092`, `status: accepted`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Date and attribution          | Written on 2026-10-26, UTC. The date records authorship, not an approval. A Claude Code sub-agent (Claude Opus 5.5) drafted it at the request of the coordinating Claude Code session of TypeCV's refactoring programme. TypeCV's owner decided on 2026-10-26 to open TypeCV's request C2 as a TypeShade proposal (TypeCV `docs/library-structure.md`, section 7, item 7). Sources: that document and `docs/audits/2026-10-26-kernel-style.md` at TypeCV `48e2711`, and this tree. Accepted on 2026-10-26, UTC, by the owner's go-ahead in the session (Approval and plan record). Neither date is a delivery date. |
| Applicability / Effectivity   | The host CPU tier of `entry(bindings, workgroups)`: `src/core/host-compute.ts` (`callCompute`), `src/core/host-entry.ts`, the generated module that `hostFace` writes (`src/compiler/ts/host-face.ts`), and a pass executor in `typeshade/runtime` beside `src/core/phase-schedule.ts`. The WGSL, the WebGL2 pass program and the oracle do not change. No release version is assigned.                                                                                                                                                                                                                             |
| Review baseline               | `main` at `e03ff7ea74bb8d6c7398d2310b2a53cc7e582227`. `main` moved to `d563a3fa6cb911b060e36200509702bbd9872056` during the draft: #762 reads a CPU-tier texture in the oracle, and #764, #765 and #766 accepted proposals 0087, 0088 and 0089. None of them touches what this draft cites. TypeCV evidence: `main` at `48e2711dbea8649c74e26baf2ca364951ab5a1dc`, whose compiler pin is `d36ac5027356b96e87a9ad900dfd8e6ea4ab55dc` (`package.json` line 60).                                                                                                                                                       |
| Review and revision authority | [PR #768](https://github.com/typeshade/typeshade/pull/768), opened on 2026-10-26, UTC, is the review record. The owner's go-ahead in the session accepted revision `db6a8ca` (Approval and plan record). Git records the revisions. The merge of PR #768 with `status: accepted` records the decision; this file does not claim that merge.                                                                                                                                                                                                                                                                         |

## What changes

**Proposal.** The host's CPU tier runs a `@compute` entry that reaches a barrier. It runs the
entry in the passes the WebGL2 tier runs (change 0054), from the same plan. So the CPU tier,
the WebGL2 tier and the oracle's `dispatch` leave the same memory, and the host calls one entry
on every tier instead of a GPU entry and a CPU twin.

### Before and after

| Today, at `e03ff7e`                                                                                                                                | With this proposal                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| With no WebGPU device and no WebGL2 context, a call of an entry that reaches a barrier throws a `TypeError` naming the barrier (Rule 8.24).        | The call runs on the CPU tier, in passes.                                                                                |
| `callCompute` skips the CPU tier with "it reaches `workgroupBarrier()` at …, and a barrier has no CPU tier" (`src/core/host-compute.ts`).          | The CPU tier is skipped only for what it still cannot run: a texture, a GPU-only call, an entry the splitter cannot cut. |
| `compileModule(m).dispatch` and `compileModuleJs(m).dispatch` run such an entry in passes, through the interpreter (`src/core/debug/dispatch.ts`). | Unchanged. The CPU tier now runs the same plan through generated code, with no interpreter.                              |
| A library that needs a CPU answer writes a twin entry without barriers, which the CPU tier can run.                                                | The library calls the tiled entry on every tier.                                                                         |

### How the CPU tier runs it

1. **At build time.** For each exported entry that reaches a barrier, `hostFace` splits the
   entry into phases with `splitPhases` (`src/core/passes/phase-split.ts`). It already does so
   for the WebGL2 pass program. It then writes the phase function into the generated module as
   generated code, at `f32` precision, as it writes every other function of the CPU tier (Rule
   11.7). The phase function is ordinary IR, a loop over a `switch` on the resume point, so the
   generator needs no new construct.
2. **At run time.** A pass executor in `typeshade/runtime` runs that phase function the way
   `src/core/debug/phased.ts` runs the plan through the interpreter. Each pass runs every live
   invocation that is not waiting, from its resume point to its next cut. A write goes to the
   invocation's log, and the logs are applied in invocation index order once the pass ends. The
   atomic operations held at a cut are performed in invocation index order between passes. A
   workgroup is released from a barrier when every live invocation has reached it.
3. **The pass loop is the one the runtime already ships.** `src/core/phase-schedule.ts` "imports
   nothing, so the program runtime, which carries no compiler, can run it". The WebGL2 executor
   (`src/core/gl-compute.ts`) already drives its passes with it.
4. **The same plan.** The CPU tier uses the plan of the WebGL2 pass program and of `dispatch`:
   the same cuts and the same write log of four entries (change 0054, decision 4). So a data
   race reads the value from the start of the pass on all three, and an atomic operation
   returns the same value on all three.
5. **Divergence.** A workgroup whose invocations disagree about a barrier fails the call. The
   message names the barrier's line and the counts, as `dispatch` words it (surface §25).
6. **What does not change.** The builtins, the zeroed workgroup memory, the bindings, the
   indirect count read from the `Resident`'s host copy (change 0075), the order of the tiers
   (Rule 11.8) and every entry that reaches no barrier. A `fuse` scope (Rule 11.13) runs such a
   call on the CPU tier in its plan, as it runs any entry call there.

### The fold order and the bits

**Inference.** An author's tree reduction in workgroup memory (stride 32 down to 1, a barrier
at each level) is the entry's own code. The CPU tier runs that code, so it adds the lanes in the
tree's order, as the GPU does. Three cases follow:

- **Integers, and `min` or `max` of non-NaN values.** Any order gives one answer, so the CPU
  tier gives the GPU's bits, as the twin does today.
- **`f32`.** The CPU tier rounds each `f32` operation as a correctly-rounding `f32` machine
  (Rule 11.7, `src/core/passes/precision.ts`). The order is now the tree's, so the CPU tier
  gives the GPU's bits wherever the GPU computes each operation as written and correctly
  rounded. #378 records that a driver may reassociate, which no tier controls.
- **`f64`.** WebGPU computes the emulated double, a pair of `f32` words of about 48 bits
  (surface §39), under the owner's flavor (change 0073). The CPU tier computes a JavaScript
  binary64. **Fact** (`src/core/passes/precision.ts`): the `f32` pass rounds only `f32` values.
  So the CPU tier gives the GPU's order for an `f64` tree, but not the GPU's bits. The two differ
  within the error of the emulated double. One answer on every tier for an `f64` sum would need
  the CPU tier to compute the flavor's arithmetic. This proposal does not ask for that
  (decision D4).

### Exclusions

- No change to the WGSL, to the WebGL2 pass program, to the oracle or to the debugger.
- No change to an entry that reaches no barrier. It keeps the sequential order (decision D2).
- An entry that `splitPhases` cannot cut yet keeps no CPU tier, as it keeps no WebGL2 pass
  program. That is an atomic operation inside `&&`, `||` or `?:`, or a function that reaches
  one and takes an `inout` parameter (surface §25). Decision D3.
- No CPU tier for a texture or a GPU-only call; they stay refused, with their reasons.
- No emulated double on the CPU tier (decision D4).

## Why

### TypeCV's evidence

**Fact** (TypeCV `docs/library-structure.md` at `48e2711`, section 6, row C2). The limit: "the
CPU tier runs one invocation per call and cannot run a barrier (Rule 8.24), although the
compiler's own oracle `dispatch` can". The effect: "18 `...Oracle` twins, the MVS splits and 29
backend branches; the oracle proves the twin, not the tiled entry, and 10 twins add in another
order than the GPU's tree". The request: "the host CPU tier of an entry runs barrier entries in
passes, as `dispatch` does". Its estimate is about 250 lines.

**Fact** (read at TypeCV `48e2711` for this draft). Eighteen entries are named `…Oracle` in
ten kernel files: two each in `bundle.shade.ts`, `joint-focal.shade.ts` and `pnp.shade.ts`, six
in `mvs.shade.ts`, and one each in six other files. Forty-three lines of the host modules under
`src/gpu` name one. `bundleMetricPartials` sums `f64` lanes in a 64-lane tree in workgroup
memory, and its twin `bundleMetricPartialsOracle` sums the same 64 lanes in order in one
invocation. `src/gpu/device.ts` calls the CPU backend "an explicit differential-testing tier".

**Fact** (TypeCV `docs/audits/2026-10-26-kernel-style.md` at `48e2711`, sections 1 and 5). Ten
of the eighteen twins add floating-point lanes in order where the GPU entry uses a 64-lane tree.
The two scan twins are exact integer sums. The six MVS twins drop the per-workgroup pose cache.

**Fact** (the same structure document, section 7, item 10, decided on 2026-10-26). "Not now. The
reductions and the oracle twins stay; a later record may propose the change." Deleting the twins
after C2 renews TypeCV's CPU digests once, and waits for that item.

**Fact** (TypeCV `docs/design-rules.md` at `48e2711`). Rule 1.1 asks one answer on every tier.
Rule 1.2 asks a proof bit for bit where the operation has one answer, and within a stated bound
where it does not. Rule 3.3 sends a gap to TypeShade as a proposal.

### Why the CPU tier refuses a barrier today

- **Fact** (Rule 8.24 and `src/core/host-entry.ts`). The CPU tier runs each invocation of each
  workgroup to completion, z, then y, then x. The rationale: "a barrier needs the interpreter's
  generators to run in lockstep, which the runtime does not ship".
- **Fact** (change 0016, "Alternatives considered"). "Shipping the interpreter, so that the CPU
  tier runs barriers in lockstep. That puts the IR and the interpreter into every application's
  bundle (0009 measured the generator alone at 92 KiB minified), for the fallback of a
  fallback."
- **Fact** (change 0054 and surface §25). Change 0054 added `splitPhases`, which turns an entry
  into a phase function of ordinary IR, and the phased order. The WebGL2 tier runs that plan as
  a pass program built at build time. `dispatch` runs the same plan on the CPU through the
  interpreter (`src/core/debug/phased.ts`), "so the two agree on every program, the values
  atomic operations return included" (`src/core/debug/dispatch.ts`).
- **Inference.** The reason of 2026-10 no longer holds. The plan needs no interpreter: its phase
  function is IR that the build-time generator can write as code, and its pass loop already
  ships in the runtime. Only a CPU executor of the plan is missing.

### Alternatives considered

1. **Keep the twins.** No compiler work. TypeCV keeps 18 twins, the MVS splits and the backend
   branches, about 250 lines by its estimate. The CPU tier keeps proving the twin and not the
   tiled entry, and ten twins keep another order than the GPU's tree. Rejected as the TypeShade
   answer, since every library with a cooperative entry pays the same cost.
2. **A documented oracle-only path.** A test calls `compile(source).module`, then
   `compileModule(module).dispatch(entry, workgroups)` or `compileModuleJs`'s, which run barrier
   entries in passes today. It needs the package root, which loads TypeScript, and the module's
   IR in the test process. It suits a Node test, not a shipped CPU tier, and it bypasses the
   host's own call path (`entry(bindings, workgroups)`, a device, a `fuse` scope). Recorded as
   the interim path for tests; not a replacement.
3. **Ship the interpreter in the runtime.** Change 0016 rejected it for its size. Rejected again
   for the same reason.
4. **Generators in the generated code**, which yield at each barrier, under a lockstep scheduler.
   It needs no phase split. Its order is the lockstep order, which agrees with the phased order
   only on a program whose result WGSL defines: what a data race reads, and the value an
   order-dependent atomic operation returns across workgroups, can differ from the WebGL2
   tier's (`src/core/debug/dispatch.ts`). Every function on a path to a barrier would become a
   generator. Rejected; the phased plan already gives one order with WebGL2 and the oracle.

### Unresolved decisions

- **D1. Size.** `scripts/bundle-budget.json` caps `typeshade/runtime` at 128,028 bytes, minified
  and gzipped, which equals its last measurement (`AGENTS.md`, the boundary receipt). The
  executor therefore raises the cap by its measured size, or it sits in a chunk that a split
  build loads on the first such call, so the initial chunk does not grow. Rule 11.11 holds the
  numbers either way.
- **D2. Entries with no barrier.** Keep their sequential order (this draft), or run every entry
  of the CPU tier in the phased order. The second gives one order with WebGL2 and the oracle for
  the atomic values across invocations too, at a cost in speed.
- **D3. Entries the splitter cannot cut.** Keep them refused on the CPU tier (this draft), or
  run them in lockstep by another means.
- **D4. The emulated double on the CPU tier.** Whether a later proposal makes the CPU tier
  compute the flavor's `f64` arithmetic, so the CPU tier gives WebGPU's bits for `f64` too.
  Change 0073 records that the oracle runs the module before the `f64` pass, so it cannot tell
  the flavors apart.
- **D5. Speed.** The executor's speed against the per-invocation run, measured on a 64-lane
  tree, before acceptance.

## What it touches

- **Rule 8.24.** "An entry that reaches a barrier needs a GPU tier, WebGPU or WebGL2" becomes:
  the CPU tier runs it in the passes of change 0054, and a workgroup that diverges at a barrier
  fails the call. The rationale's sentence on the interpreter's generators is replaced.
- **Rule 11.7.** The CPU tier is the generated code, and for an entry that reaches a barrier the
  generated code of its phase function, run by the runtime's pass executor.
- **Rule 11.8.** "the CPU tier when the entry reaches no barrier and no texture" becomes "the CPU
  tier when the entry reaches no texture and the splitter can cut it".
- **Surface §25.** "Running it on the CPU" adds that the host's CPU tier runs the same passes.
- **Surface §67.** The three statements that an entry with a barrier needs a GPU tier are
  replaced: for a call, for a call in a `fuse` scope, and in the paragraph on `{ constants }`
  (change 0084).
- **Code.** `src/compiler/ts/host-face.ts` writes the phase function into the generated module.
  `src/core/host-entry.ts` and `src/core/host-compute.ts` run it on the CPU tier. A CPU pass
  executor joins the runtime beside `src/core/phase-schedule.ts`.
- **Tests.** The CPU tier's result equals `compileModule(m, { precision: 'f32' }).dispatch` bit
  for bit on entries with barriers, atomic operations, an indirect count, a data race, a `fuse`
  scope and a divergent workgroup. The existing CPU-tier tests stay. A packed journey calls a
  tiled reduction on WebGPU, WebGL2 and the CPU tier: the `f32` and integer results equal
  across the tiers, and an `f64` result within the bound the `df64` known-answer tests use.
  `bun run gate:boundary` measures the executor.
- **Not touched.** No export, no diagnostic code, no example. The language service is not
  involved: the refusal it removes is a run-time `TypeError` that no editor reports.

### Draft impact estimate

**Known.** The change is additive: a call that threw now runs. An entry that reaches no barrier
runs as before. A generated module that an older plugin wrote carries no phase function, and the
runtime keeps refusing its barrier entries on the CPU tier.

**Estimate.** The executor is of the size of `src/core/debug/phased.ts` (230 lines) without its
interpreter, since the pass loop already ships (`src/core/phase-schedule.ts`, 135 lines). Its
bundle size is unmeasured (D1). Each barrier entry's generated module gains its phase function;
that size is unmeasured. The speed is unmeasured (D5). Duration and cost are unestimated.

**TypeCV.** Up to about 250 lines (TypeCV's estimate) can go once TypeCV decides item 10. Its
CPU digests then change once. **Inference.** For TypeCV's `f64` trees the new CPU digests equal
neither the twins' digests nor WebGPU's bits ("The fold order and the bits").

**Decisions before acceptance:** D1 and D5. D2, D3 and D4 may stay open.

### Approval and plan record

**Decision.** Accepted, by the owner's go-ahead in the session on 2026-10-26, UTC, at 11:40 UTC
as the coordinating session reported it. The review evidence is
[PR #768](https://github.com/typeshade/typeshade/pull/768). The approved revision is commit
`db6a8cafbec1011247094a9584c09253f68962f4`, committed at 11:29 UTC, the head of PR #768 before
this acceptance commit. Its file is blob `b4b0219c4c4c63280241ccdab1248d42c79c39f0`. This
acceptance commit changes no scope. It sets the status and fills this record and the document
control.

**Approved scope.** What changes, with its exclusions, the front-matter declarations and the
required validation below.

**Open decisions.** D1 to D5 stay open. The first implementing pull request decides each one for
the owner's review. Until then the approved text bounds the scope:

- D1, the runtime size: a raised cap of `typeshade/runtime` or a chunk of a split build. It needs
  the executor's measured size.
- D2, entries with no barrier: the approved text keeps their sequential order.
- D3, entries that `splitPhases` cannot cut: the approved text keeps them refused on the CPU
  tier.
- D4, the emulated double on the CPU tier: the approved text does not ask for it.
- D5, the executor's speed, measured on a 64-lane tree.

The approved revision asked to settle D1 and D5 before acceptance, and the go-ahead did not
settle them. As for D2 of proposal 0090, the first implementing pull request names the choice.

**Finalized impact declarations.** Rules 8.24, 11.7 and 11.8 (amended); surface §25 and §67
(amended); no export; no diagnostic code; no example; downstream typeshade.github.io,
vscode-typeshade and typecv, as the front matter states. **Fact** (a re-scan of `main` at
`d563a3fa6cb911b060e36200509702bbd9872056` on 2026-10-26). These rules and sections keep their
numbers and the sentences this proposal cites, so no number moved and no deviation is recorded.
Other proposals declare some of the same items and are not implemented: the accepted 0051, 0065,
0067, 0080 and 0085 (Rule 11.8 or §67), 0054 (also Rule 8.24 and §25) and 0077 (also Rule
11.7), and the draft 0042, a WebAssembly tier (Rules 11.7 and 11.8, §67). The implementation that
lands second rebases on the others' text.

**Required validation.** The functional and document checks of the Configuration and validation
record below. They are requirements, not results.

**Responsibilities and milestones.** The go-ahead assigned no implementer, milestone, duration or
cost. Implementation is unassigned. Each downstream repository does its work when its pin moves.
Acceptance of this plan is not evidence that the implementation works.

### Configuration and validation record

This record does not yet apply. No implementation exists at acceptance. Delivery requires: the
implementing commits with `Change: 0092`; the tests above, green; `bun run gate:boundary` with the measured executor and
any budget change recorded; `bun run gate:journeys` with the new journey; `bun run build`,
`bun run lint`, `bun run format:check` and `bun run test`; `bun run docs:impact`,
`bun run docs:refs`, `bun run reqs:sync` and `python scripts/doorstop-check.py -C -e -F`, with
the changed rules reviewed. Downstream pins are tracked apart.

## What it owes downstream

This draft did not search the site or the editor repository. The work below is expected work; a
search of each repository for "needs a GPU tier" and "barrier has no CPU tier" fixes the list.

**typeshade.github.io.** The pages that describe entry calls and their tiers stop saying that an
entry that reaches a barrier needs a GPU tier, in English and Korean.

**vscode-typeshade.** The skill's host reference stops saying it. A fixture that expects the
`TypeError` changes.

**typecv.** Expected work, decided by TypeCV:

- Phase 10's C2 step deletes the 18 twins, the MVS splits and the backend branches only if
  section 7, item 10 is decided yes (TypeCV `docs/library-structure.md`).
- **Inference.** TypeCV's Rule 1.1 holds for the integer and `f32` folds after this change. For
  the `f64` folds it holds within a stated bound (TypeCV Rule 1.2), unless decision D4 is taken
  up.
- Record 0092 in `compiler-changes.md` when the pin moves.
