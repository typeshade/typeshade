---
id: '0069'
title: 'A tiled compute entry with workgroup memory can be a call inside a fuse scope'
status: draft
rules:
- '8.24'
- '10.5'
- '11.8'
- '11.13'
surface:
- 24
- 25
- 67
- 71
exports: []
exports-removed: []
codes: []
examples: []
downstream:
- repo: typeshade.github.io
  what: The entry-call copy of §67 and the fuse copy of §71, in English and Korean, and the workgroup-memory copy of §24 and §25 where it names the fuse limit. A tiled-matmul page or example waits for the open decision Q7.
- repo: vscode-typeshade
  what: The skill's compute and fuse sections and references/host.md, for an entry call inside a fuse body and its TypeError, if the option is accepted.
---

<!-- doc-refs: skip-file — this proposal names the files, options and tests that a later implementation adds, which this tree does not have yet -->

**Document control**

| Field                       | Record                                                                                                                                                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document                    | Proposal 0069; this file is the proposal source. This is a design proposal for discussion. It declares a recommended scope and lists the other options.                                                                                                                       |
| Revision context            | Drafted 2026-10-13, Asia/Seoul. This date is the authoring context. It is not an approval date.                                                                                                                                                                               |
| Request source              | The repository owner, Seungup, asked in the project conversation for tiled kernels that can join a fused plan. It follows a gap analysis of TypeNN training profiles. TypeNN's matmul and convolution are naive kernel functions. No GitHub issue is recorded for this draft. |
| Current lifecycle state     | `draft`. The options are open for discussion. No approval has been given. No implementation exists.                                                                                                                                                                           |
| Applicability / effectivity | Compute entries with workgroup memory and barriers (Rule 8.24, surface §24 and §25), the WebGL2 pass program (change 0054, Rule 10.5), the fuse planner (Rule 11.13, surface §71), and downstream documentation. No release version is assigned.                              |
| Review baseline             | `origin/main` at `96dbaa9fa7208aa786a4937a8c90521e59023ffa` (commit "Copy flat f32, i32 and u32 arrays as bytes in pack and readInto (#648)").                                                                                                                                |
| Proposal review             | No pull request is assigned. This draft is not yet pushed as a pull request.                                                                                                                                                                                                  |
| Revision authority          | Git records the revisions of this file. A review and a merge record the decision. Acceptance is not yet recorded.                                                                                                                                                             |

## What changes

**Before.** A compute entry may declare `workgroup<T>` memory and call `workgroupBarrier()` (surface §24 and §25). A host calls the entry as `entry(bindings, workgroups)` (Rule 8.24). Inside a `fuse` body an entry call is a `TypeError` that names the call (Rule 11.13), because it would run before the calls recorded earlier. A tiled matmul therefore cannot join a fused plan. A host that wants it must end the scope, call the entry, and start a new scope.

**Recommended scope (option A).** A call of a compute entry is allowed in a fuse body, under these rules:

1. The entry call takes its bindings as Rule 8.24 gives them. Each array the call reads or writes is a `Resident` (Rule 11.13). A call in the body that writes a host array stays a `TypeError`.
2. The planner gives the entry call its own group. No kernel call joins the group before or after it. The rule is F8 in Rule 11.13.
3. The group runs as one dispatch of the entry, in the order of the plan. The planner records the call in the report's `calls`, under the entry's name.
4. The entry's bindings, its workgroups and its result follow Rule 8.24 unchanged.
5. On WebGL2 the entry runs by the pass program of change 0054, as it runs outside a scope. Rule 11.13 already runs the calls of a scope apart on WebGL2.
6. On the CPU tier the entry runs invocation by invocation, in the order Rule 8.24 states. Bit equality with WebGPU depends on Q3.

The body of a `fuse` call that is not an entry stays as Rule 11.13 states. A draw, a host write and a read of a `Resident` in the body keep their `TypeError`.

**Example (illustrative, not an accepted example).** A host records a tiled matmul, then a bias map:

```ts
import { fuse } from "typeshade/fuse";
import { matmul, bias } from "./tiled.shade.js";

await fuse((scope) => {
  matmul({ a, b, c }, [n / 16, m / 16]); // one dispatch: its own group
  bias({ c, v, out }, n);                 // a group of its own, after the matmul
});
```

The example is illustrative. The example set does not change in this proposal (open decision Q7).

## Why

The fuse planner joins kernel loops. It knows each loop's counter and each array's access at that counter (Rule 8.22, Rule 11.13 F1 to F6). A tiled kernel reads a tile at an index that the loop counter does not give. A proof of its accesses would need new facts, not new spellings. So the tiled kernel is not a kernel loop. It is an entry. An entry already has its own dispatch, its own bindings and a defined WebGL2 tier (change 0054, Rule 10.5).

The owner needs TypeNN's matmul and convolution to run tiled and to join a fused plan. Without a rule change, the tiled matmul runs as an entry called outside the scope. Each call then costs a submission. The benefit of (A) is the removal of that break, and the matmul's own speed comes from its tiling.

**Options.** Each option names what it touches. The recommended one is option A.

- **Option A. An entry call is a fuse call that forms its own group (recommended).**
  - Touches: Rule 8.24 (an entry may be called in a scope), Rule 10.5 (the WebGL2 entry under a scope), Rule 11.8 (its tier), Rule 11.13 (F8 and the `TypeError` list), surface §67, §71 and the workgroup sections §24 and §25.
  - Trade-off: the matmul's output reaches the next map only through a `Resident`. The planner does not contract the matmul into the map. The gain is one submission for each entry call, and the tiling itself.
  - Determinism: the entry's sum order is the source order of each invocation. Rule 7.2 tree order does not apply to the entry's loop, because the entry is not a kernel loop. See Q2.
  - WebGL2: the entry uses 0054's phased model, which lifts the barrier deferral of Rule 10.5 for compute entries.
- **Option B. A new kernel-function form with a tile loop, workgroup memory and barriers.**
  - Touches: Rule 8.22 (R6 forbids barriers and workgroup memory in a loop; a new form relaxes it under new facts), Rule 8.23, Rule 11.8 (a WebGL2 tier for kernel functions with barriers, which 0054 does not give to kernel functions), Rule 11.13 (F1 to F6 assume identity indices), surface §65.
  - Trade-off: this keeps the tile inside a kernel function, so the planner could in principle contract it. It needs new proof rules for tile indices and new facts for F3, and a new barrier model for kernel functions on every tier. The rule change is large.
- **Option C. A library recipe: a built-in tiled matmul.**
  - Touches: an exported module of `typeshade/*` (a new public export, which `src/__api__/surface.md` lists) and an example or journey (a visible change).
  - Trade-off: a built-in gives the fastest path for users who need only matmul. It does not join a fused plan unless option A also holds. It adds a name to the public surface that Rule 13.6 must justify. A user can already write the recipe as an entry today (Rule 8.24) without any rule change.

**Recommendation.** Option A. It makes the smallest rule change that lets a tiled kernel join a plan. It uses the entry model that already has WebGPU and WebGL2 tiers and a CPU order. Option C is a separate choice that may follow. It does not replace A.

## What it touches

- **Rule 8.24:** an entry may be called inside a `fuse` body, with the bindings of Rule 11.13.
- **Rule 10.5:** a compute entry with barriers runs inside a scope on WebGL2 by the same pass program as outside a scope. No new GLSL lowering.
- **Rule 11.8:** the tier order of an entry call in a scope is the order of an entry call outside a scope.
- **Rule 11.13:** F8, "an entry call forms its own group; no kernel call joins it, and it joins none"; the `TypeError` list loses the entry call and keeps the draw, the host write, the read and every other use.
- **Surface §24 and §25:** workgroup memory and barriers in an entry that a scope calls. The uniformity rule for barriers stays as is.
- **Surface §67:** the entry call inside a scope.
- **Surface §71:** F8 and the report's `calls` for an entry.
- **Exports:** none. The `fuse` and `FuseReport` shapes do not change. The report's `calls` may name an entry, which is a text change, not a shape change.
- **Codes:** none. The new refusals stay runtime `TypeError`s, as Rule 11.13 states for the other calls.
- **Examples:** none in this draft. A tiled-matmul example is open decision Q7.

### Draft impact estimate

- **Technical work.** The planner in `src/core/fuse-plan.ts` and `src/core/fuse-group.ts` gets F8. The entry call path in `src/core/fuse-scope.ts` gets its record. The WebGL2 path runs the entry's pass program apart.
- **Compatibility.** A `fuse` body that calls an entry today throws. After this change it runs. No other existing call changes.
- **Dependencies.** Change 0054 (the phased WebGL2 model) and change 0067 (a per-entry workgroup size, if the tile size is chosen by a size attribute).
- **Validation work.** See the test list below. The measurement needs a GPU and a matching Tint compile (Rule 13.3).
- **Downstream effort.** The site and the editor describe the entry call in a scope.
- **Unestimated.** Effort, schedule and cost are unknown. None is recorded here.

### Open questions (not decided)

- **Q1.** Can a map follow an entry in its group (an epilogue, such as bias and ReLU, in the same dispatch)? Recommendation: no in v1. Each entry call is its own group.
- **Q2.** Does the tiled sum equal the naive sum bit for bit? The tiled kernel must add the products in ascending `k` order, as the naive kernel does. The naive kernel's inner sum must also run sequentially in its lowered code. The first implementation step checks that, on the CPU oracle and in WGSL.
- **Q3.** Does the driver or Tint contract `acc = acc + a * b` into a fused multiply-add? If it does, the WebGPU bits differ from the CPU oracle. Rule 13.3 requires a measurement on Tint and on the device before this is kept. The result is not known yet.
- **Q4.** Where is the uniformity rule of `workgroupBarrier()` met? A tile load past the matrix edge must clamp its index, not return early, so that every invocation reaches each barrier.
- **Q5.** Which tile size is the default: a fixed 16 × 16, or the size of a per-entry attribute (change 0067)? The workgroup memory must fit the device limit (`maxComputeWorkgroupStorageSize`).
- **Q6.** Does an entry in a scope on WebGL2 run apart, as a scope runs its calls on WebGL2 (Rule 11.13), or may the pass program join a group? Recommendation: apart, in v1.
- **Q7.** Does the proposal ship a tiled-matmul example or a library recipe (option C)? A shipped example changes the set of `examples/*.shade.ts` and needs its own proposal entry. Recommendation: decide after A is measured.
- **Q8.** Option B (a kernel-function tile loop) is not recommended now. Does the owner want it kept as a later option? Recommendation: keep it recorded, not scheduled.

### Approval and plan record

This record does not yet apply. A decision on the option and on Q1 to Q8 precedes acceptance. Acceptance requires the owner's go-ahead or an approving review, and the measurements of Q2 and Q3. The file becomes `accepted` by a merged pull request.

### Configuration and validation record

This record does not yet apply. Implementation requires the accepted revision of this file, commits with `Change: 0069`, the delivered configuration and the validation below.

**Validation (required before the implementation merges).**

- `compile()` and the language service on the same source (CLAUDE.md "A test reads both halves"): an entry call inside a `fuse` body is accepted by the editor's diagnostics, and the compiler's `TypeError` for a host array in the body is unchanged.
- `src/core/fuse-group.test.ts`: an entry call forms its own group; a kernel call before and after it does not join it (F8).
- CPU oracle: the tiled entry's output and the naive kernel's output are equal bit for bit on a 512 × 512 matrix.
- Tint: the tiled WGSL compiles (`gate:compile`), with its FMA behavior recorded (Q3).
- WebGL2: the entry runs by the pass program and matches the CPU oracle on the same matrix, or the report says it runs apart.
- Hardware: a 512 × 512 matmul, tiled and naive, on one named WebGPU device, each run at least five times. Record the device, driver, date, median times and the factor between them.
- `bun run build`, `bun run test`, `bun run gate:compile`, `bun run docs:refs`, `bun scripts/changes.ts`, `bun run docs:impact`.

**Acceptance (for the eventual implementation).** A 512 × 512 tiled matmul matches the CPU oracle bit for bit. It beats the naive kernel function by a recorded factor on hardware. It appears in a `fuse` scope as one group, and the report shows that group.

## What it owes downstream

- `typeshade.github.io`: the entry-call copy of §67 and the fuse copy of §71, in English and Korean. Record 0069 in `compiler-changes.md` when the pin moves.
- `vscode-typeshade`: the skill's compute and fuse sections, and `references/host.md`, if option A is accepted. Record 0069 in `compiler-changes.md` when the pin moves.
- Consumer note (not a downstream repository in the schema): TypeNN would use the tiled matmul and convolution through im2col. Its adoption is not part of this proposal's obligations.
