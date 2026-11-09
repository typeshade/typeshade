---
id: '0132'
title: An author writes no diagnostic filter; the compiler rewrites an implicit-LOD sample or a derivative in non-uniform control flow
status: draft
rules:
  - '6.7'
  - '8.5'
surface:
  - 3
  - 7
  - 50
  - 54
exports:
  - CompileTsSourceResult
exports-removed: []
codes: []
examples: []
names: []
downstream:
  - repo: typeshade.github.io
    what: Rewrite the sample-branch example's title and blurb (English from the compiler, Korean in ko.ts), the CompileTsSourceResult.directives member text and the pages generated from Rule 8.5 and surface §54; record 0132 in compiler-changes.md
  - repo: vscode-typeshade
    what: Remove the @diagnostic("off", "derivative_uniformity") advice from the plugin skill's references/language.md and say that the compiler rewrites what it can; record 0132 in compiler-changes.md
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0132, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Date and attribution          | Drafted 2026-11-09 (UTC) by an AI agent (Claude Code) at the owner's direction, revised the same day after an independent review. The date is the drafting date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Request source                | The owner (Seungup) set the direction in the Claude Code session on 2026-11-09: the language gains as little as possible; what the compiler can decide is compiler work and is never pushed onto the author; what the author does not need to learn is removed. The owner directed this removal in the same session. Draft proposal 0130 (pull request #1094) proposes the principle as a design rule and removes the stage calls. Draft proposal 0131 (pull request #1104) removes the other stage-call option, `numerics`.                                                                                                                                                                                                                                                                                             |
| Applicability / effectivity   | Expected: `src/compiler/ts/diagnostic-directive.ts` (deleted, or reduced to the options parser; see "Migration order"), `src/compiler/ts/source-file.ts`, `compile.ts`, `host-face.ts`, `builtin-check.ts`, `decorated-form.ts`, `stage-call.ts`, `src/cli/migrate.ts`, `src/core/passes/uniformity.ts` (the `TS8052` text), a new rewrite pass in `src/core/passes/`, `src/language-service/ambient.ts`, `docs.ts` and `service.ts`, `src/core/coverage/wgsl.ts`, `docs/language-design.md`, `docs/use-typeshade-surface.md`, `docs/capability-coverage.md`, two examples and four of their goldens, `reqs/`, and the tests listed under "What it touches". The WGSL and GLSL ES 3.00 of a program that writes no `diagnostic` change only where a sample or a derivative is rewritten. No release version is assigned. |
| Review baseline               | `main` at `79c76d48` (merge of pull request #1098), 2026-11-09. Every count below was measured on that commit unless the row says otherwise. The independent review measured revision `13d254f5` on `main` at `f2f05cb5`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Review and revision authority | Pull request #1105 (draft). Git records the revisions of this file. Its merge with `status: accepted` will record the decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## What changes

### Today

WGSL refuses an implicit-LOD sample (`textureSample`, `textureSampleBias`,
`textureSampleCompare`) and a screen-space derivative (`dpdx`, `dpdy`, `fwidth` and their
variants) in non-uniform control flow (the `derivative_uniformity` rule, default severity
`error`). The front end refuses such a call at the source line with `TS8052` (Rule 8.5, surface
§54). The author has one more way out: a diagnostic filter.

- `fragment(f, { diagnostic: ["off", "derivative_uniformity"] })`, the stage call's option
  (change 0111, D7); the severities are `off`, `info`, `warning` and `error`.
- `@diagnostic("off", "derivative_uniformity")` on a top-level function, the decorated form,
  accepted in the migration release with a `TS8028` warning (change 0111, D5).

Either form silences the derivative half of the analysis. The WGSL backend then emits the
module-scope directive `diagnostic(off, derivative_uniformity);`
(`src/compiler/ts/diagnostic-directive.ts`, 248 lines). The same file holds the parser of the
stage call's options, `numerics` included (line 160: "A stage call takes two options").

Calls the rule does not restrict are not in this proposal: `textureSampleLevel`,
`textureSampleGrad`, `textureSampleCompareLevel`, `textureSampleBaseClampToEdge`,
`textureGather`, `textureGatherCompare` and `textureLoad`. Each takes its level of detail as
written, or reads no level.

### Proposed

1. Remove the stage call's `diagnostic` option, the decorated `@diagnostic(…)` and the ambient
   declaration `declare function diagnostic(…)` from the language.
2. Stop the `"use typeshade"` front end from emitting a `diagnostic(…)` directive. Remove the
   `directives` member of `CompileTsSourceResult`.
3. Add compiler work: a rewrite of an implicit-LOD sample or a derivative that the uniformity
   walk finds in non-uniform control flow. The method is **recompute, then derive**:
   - **The slice.** For each such call, the compiler takes the backward slice of its operand
     (the coordinate of a sample, the argument of a derivative): every expression and
     assignment the operand's value depends on, back to values defined before the statement
     that made the flow non-uniform (the _hoist point_).
   - **The condition.** The slice is side-effect-free, and each of its inputs is defined before
     the hoist point. A loop on the slice must have a constant trip count: Rule 7.5's counted
     form with a constant start and a constant bound. A call on the slice is specialized or
     inlined first, under the same conditions.
   - **The recompute.** The compiler emits the slice again at the hoist point, in uniform
     control flow, with fresh names. It does not move the original statements, so the branch
     computes what it computed before.
   - **The derivative.** At the hoist point it emits `dpdx` and `dpdy` of the recomputed
     coordinate (two per coordinate), or the recomputed derivative itself.
   - **The use.** Inside the branch, a sample becomes `textureSampleGrad` with those gradients,
     and a derivative becomes the value computed at the hoist point. GLSL ES 3.00 gets
     `textureGrad` with `dFdx` and `dFdy`, from the same IR.
   - **The whole call.** Where a sample has no gradient form (a depth texture,
     `textureSampleCompare`), the compiler recomputes the whole call at the hoist point when
     every argument meets the condition above, and uses its value inside.
   - **Helpers.** A helper reached under the branch is specialized with the gradients as extra
     parameters, so that the hoist point sits in the caller. Inlining is the alternative where
     specialization cannot express the slice (see N5 in the review record).

   The rewrite runs on the shared IR, before the WGSL and GLSL writers. The decision whether the
   rewrite reaches a call (the _reach decision_) runs inside `compileTsSource`, before
   `uniformityViolations` (`src/compiler/ts/source-file.ts`, lines 412-427), so the compiler and
   the language service (which calls `compileTsSource` with `{ emit: false }`) report the same
   `TS8052` (Rule 12.7).

4. Keep `TS8052` (Rule 8.5) for every call the rewrite cannot reach. Remove the third way out
   ("or give the stage call of the entry the option …") from its text. Name the reason the
   compiler could not rewrite the call. The reasons:
   1. The operand depends on a value that cannot be recomputed at the hoist point: a read of
      `storage` (`read_write`) or `workgroup` memory that the branch or a call under it writes,
      the result of an atomic operation, a loop without a constant trip count, or a variable
      assigned from one of these. A `uniform` or `read` storage binding, a module constant and
      a read of a sampled texture can be recomputed.
   2. The call is a sample of a depth texture or `textureSampleCompare` (no gradient form in
      WGSL), and one of its arguments fails reason 1's test, so the whole call cannot be
      recomputed either.
   3. The call is inside a loop whose condition differs by invocation, or after a `break` or
      `continue` taken under a non-uniform condition, and its operand changes from one
      iteration to the next. The hoist point would be outside the loop, where no single value
      exists.
5. Keep the barrier half of Rule 8.5 unchanged. A barrier is not filterable today, and no
   rewrite applies to it.
6. Keep `ModuleDecl.diagnostics`, `DiagnosticDirective` and their WGSL emission in
   `src/core/backends/wgsl.ts` for the IR builder (`typeshade/core/ir`). The `"use typeshade"`
   language does not reach them. Whether the IR builder keeps them is a separate decision
   (decision 4 below).
7. Change `tshc migrate` (`src/cli/migrate.ts`): delete a `@diagnostic(…)` decorator and a
   stage call's `diagnostic` option, in place of rewriting the decorator to the option.

After the change, a stage call that still passes `{ diagnostic: [...] }` is refused with
`TS8028`, as any unknown option is today. A written `@diagnostic(…)` is a decorator outside Rule
6.7's list, so it is `TS8028` too. Each refusal's text says that the compiler now rewrites the
call or names the reason it cannot (Rule 12.5).

### How each control-flow shape is rewritten

The uniformity walk already names the statement that made the flow non-uniform (`Via` in
`src/core/passes/uniformity.ts`, lines 133-168). The hoist point follows from it:

| Shape (`Via`)                                                   | Hoist point                                                                                                                             |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `branch` (`if`), `switch`                                       | Before the `if` or the `switch`. One recompute serves every arm and case that needs it.                                                 |
| `short-circuit` (`&&`, `                                        |                                                                                                                                         | `)  | Before the statement that holds the expression, so that the right side's slice is recomputed whether the left side lets it run or not. |
| `conditional` (`?:`)                                            | Before the statement that holds the expression.                                                                                         |
| `return`, `loop-return` (an earlier `return` under a condition) | Before the outermost statement that holds that `return`. A `loop-return` whose operand changes per iteration keeps `TS8052` (reason 3). |
| `loop`, `bound-return`, `break`, `continue`                     | Before the loop, only when the operand is loop-invariant. Otherwise `TS8052` (reason 3).                                                |
| `switch-break`                                                  | Before the `switch`.                                                                                                                    |

**Memory reads on the slice.** The recompute reads memory at the hoist point, earlier than the
original read. It is the same value only if nothing writes that memory between the two points.
Reason 1 therefore refuses a `read_write` storage or `workgroup` read that the branch, or a call
under it, writes. A read of memory nothing in the shader writes is recomputed.

**`discard`.** WGSL demotes an invocation that discards to a helper invocation, which still
supplies the neighbour a derivative differences against. The uniformity walk accepts a
derivative after a non-uniform `discard` for that reason, and the rewrite does not touch it.
GLSL ES 3.00 says nothing of helper invocations: a derivative after a non-uniform `discard` is
as defined as the driver makes it. The rewrite does not change that GLSL text (inference, to
confirm on the WebGL2 devices of the gate).

**`textureSampleBias`.** WGSL clamps the bias to [-16.0, 15.99]. The gradient form multiplies
both gradients by `exp2(clamp(bias, -16.0, 15.99))`, which gives the same level of detail in
theory. The bias itself may be computed inside the branch, since it is used there. Equality is
an assumption to measure; where it fails, the call is recomputed whole when its arguments allow
it, and keeps `TS8052` otherwise.

**Depth textures.** `textureSample` of a `texture_depth_*` has no `textureSampleGrad` overload
in WGSL (§17.7.12 lists only the `f32` texture types). The rewrite recomputes the whole call, or
the call keeps `TS8052` (reason 2).

### The final `TS8052` sentences

The barrier sentence does not change. For a sample:

> textureSample() is reached under "VsOut.uv" (a fragment input at @location(0)), which WGSL's
> derivative_uniformity rule refuses: the implicit level of detail is a difference between
> neighbouring invocations, and one that did not run has no value to difference against. The
> compiler could not compute the gradients before the branch: _reason_. Move the call above the
> branch and select from its result, or call textureSampleLevel or textureSampleGrad with the
> level or the gradients you want.

For a derivative:

> dpdx() is reached under "uv" (a fragment input at @location(0)), which WGSL's
> derivative_uniformity rule refuses: it differences neighbouring invocations, and one that did
> not run has no value to difference against. The compiler could not compute it before the
> branch: _reason_. Compute the value it differences before the branch, call dpdx() there, and
> use the result inside.

The _reason_, one of:

- "its operand reads "_name_", which the branch writes" (reason 1, memory);
- "its operand depends on an atomic operation" (reason 1);
- "its operand is computed in a loop whose trip count is not a constant" (reason 1);
- ""_name_" is a depth texture, which has no gradient form, and its arguments are computed in
  the branch" (reason 2);
- "its operand changes on each iteration of a loop that not every invocation runs" (reason 3).

Each action names only what an author can already write: a statement moved above a branch,
`textureSampleLevel`, `textureSampleGrad`, `dpdx`. None needs a new construct.

### Example

`examples/sample-branch.shade.ts` changes how an author writes an example, so the comparison is
shown here (`CLAUDE.md`, Merging).

Before (`main` at `79c76d48`, the entry):

```ts
export const fs = fragment(function fs(v: VsOut): vec4 {
  let base: vec4 = vec4(0., 0., 0., 1.);
  if (v.uv.x > 0.5) {
    base = sharp(v.uv);   // textureSample(albedo, smp, uv)
  } else {
    base = wide(v.uv);    // textureSample(albedo, smp, uv * 0.5)
  }
  // …
}, { diagnostic: ["off", "derivative_uniformity"] });
```

```wgsl
diagnostic(off, derivative_uniformity);
```

After (the source loses the option; nothing else changes):

```ts
export const fs = fragment(function fs(v: VsOut): vec4 {
  let base: vec4 = vec4(0., 0., 0., 1.);
  if (v.uv.x > 0.5) {
    base = sharp(v.uv);
  } else {
    base = wide(v.uv);
  }
  // …
});
```

The expected WGSL (an estimate; the implementation fixes the names): no directive, each
helper specialized with its gradients, and each coordinate's slice recomputed and derived
before the `if`. The slice of `sharp`'s coordinate is `v.uv`; the slice of `wide`'s is
`v.uv * 0.5`. The derivatives are taken of the recomputed values, not derived by a chain rule.

```wgsl
fn sharp_grad(uv: vec2<f32>, gx: vec2<f32>, gy: vec2<f32>) -> vec4<f32> {
  return textureSampleGrad(albedo, smp, uv, gx, gy);
}

fn wide_grad(uv: vec2<f32>, gx: vec2<f32>, gy: vec2<f32>) -> vec4<f32> {
  let inner = (uv * 0.5);
  return textureSampleGrad(albedo, smp, inner, gx, gy);
}

// in fs:
  let c0 = v.uv;
  let g0x = dpdx(c0);
  let g0y = dpdy(c0);
  let c1 = (v.uv * 0.5);
  let g1x = dpdx(c1);
  let g1y = dpdy(c1);
  if ((v.uv.x > 0.5)) {
    base = sharp_grad(v.uv, g0x, g0y);
  } else {
    base = wide_grad(v.uv, g1x, g1y);
  }
```

The GLSL ES 3.00 changes the same way, with `textureGrad(albedo, inner, gx, gy)` in place of
`texture(albedo, inner)` and `dFdx`, `dFdy` at the hoist point. The third sample of the file
(`near`, under the uniform `tint.rgb.w > 0.5`) is not rewritten.

### What the two examples become

- **`sample-branch`.** The id stays, so the set of examples does not change. The source loses
  the option (line 87). Its title and blurb change from "the directive that allows it" to "the
  compiler rewrites it". It becomes the gate's evidence for the gradient form: the emit carries
  no directive, and Tint and ANGLE compile it. Without the option on `main` at `79c76d48`, the
  file gives two `TS8052` (lines 61 and 66, the samples in `sharp` and `wide`), measured with
  `compile()`. Both slices are expressions of `v.uv`, which is defined before the branch, so the
  rewrite reaches both (estimate until the pass exists).
- **`capsule-corp-namek-class`.** The source loses the option (line 4268). Without it on `main`
  at `79c76d48`, the file gives six `TS8052`, measured with `compile()`: `dpdx` and `dpdy` at
  lines 3290-3291, 3324-3325 and 3331-3332, in `Terrain.shade`. `Terrain.shade` is called under
  `} else if (terrainT > 0.0) {` (line 4016), the else arm of `if (shipHit && terrainT < 0.0)`,
  so the hoist point is before that outer `if`. Its arguments (`ro + rd * terrainT`, `ro`,
  `terrainT`, …) are defined before it. The operands are `dirt` and `x = p.xz`. `dirt` is
  `dirtField(groundWarp(x))` at line 3286, and line 3305 adds two `Noise.value` terms to it
  inside the branch (`dirt += …`). The second pair of derivatives (3324-3325) reads that second
  value. The slice is side-effect-free; its one loop is `Noise.fbm`'s
  `for (let i = 0; i < 4; i++)` (line 208), a constant trip count; `groundWarp` (line 2416) and
  `dirtField` (line 2443) have no other loop or branch. The rewrite therefore reaches all six
  (estimate until the pass exists). The cost is that the dirt field is computed for every pixel,
  ship and sky pixels included (N1). If the first implementation does not reach them, the
  example's source computes the six derivatives in `render` before the branch, by hand, and
  passes them in. That fallback changes how the example is written and is shown to the owner
  before merge (decision 3).

### Exclusions

- GLSL ES 3.00 has no refusal: an implicit derivative in non-uniform control flow is undefined
  there (surface §54). The rewrite still runs on the shared IR, so the GLSL text changes too,
  with `textureGrad` in place of `texture`. The GLSL result then becomes defined.
- No new author-facing name, option or code.

## Why

### Problem and evidence

- The owner's direction of 2026-11-09 removes what the author does not need to learn. The
  option asks the author to know a WGSL rule name, four severities, where the filter is written
  and why it is emitted at module scope (surface §54, "Written on the entry, emitted at module
  scope").
- The filter does not fix the program. It tells Tint to accept a sample whose result WGSL calls
  an indeterminate value in non-uniform control flow (WGSL §17.6, derivative built-in functions;
  §17.7, texture built-in functions). GLSL ES 3.00 calls it undefined. The compiler can compute
  a defined gradient in uniform flow instead.
- Two examples write the option on `main` at `79c76d48`: `sample-branch` and
  `capsule-corp-namek-class` (0 of the other 100 `examples/*.shade.ts`). No downstream default
  branch writes it (see "What it touches").

### Alternatives

| Option                                                                         | For                                                                | Against                                                                                                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| A. Remove the option; rewrite where possible; `TS8052` remains (this proposal) | No author construct. The emitted program is defined on every quad. | New compiler work. The result can differ from an implicit-LOD sample on every quad (decision 2).                                        |
| B. Remove the option; no rewrite                                               | Smallest change.                                                   | Namek and `sample-branch` stop compiling until rewritten by hand. The author does work the compiler can do.                             |
| C. Emit the filter automatically wherever the walk finds a non-uniform sample  | No author construct; the output matches today's.                   | The compiler silences a rule and emits undefined behaviour on purpose. A barrier is not filterable, so it covers only half of Rule 8.5. |
| D. Keep the option (no change)                                                 | No work.                                                           | Conflicts with the owner's direction of 2026-11-09.                                                                                     |
| E. Affine propagation (chain rule) in place of recompute, then derive          | No recompute of the slice; cheaper for an affine coordinate.       | Reaches only coordinates affine in a pre-branch value. Namek's `dirt` is not affine. A second method doubles the tests.                 |

Decision (the owner, 2026-11-09): A, with the method of recompute, then derive. See decision 1.

### Assumptions (to measure)

- **Reach.** The rewrite reaches a call whose slice meets the condition of item 3. How many
  real programs fall under reasons 1-3 is unknown; 0 of the 8 calls in the two examples do
  (estimate, from reading the slices).
- **Equality.** `textureSampleGrad` with gradients from `dpdx` and `dpdy` may not give the same
  bits as an implicit-LOD `textureSample`, on any quad. A device may compute the implicit level
  of detail with coarse or fine differences and its own approximation. Decision 2 asks the owner
  what standard this is held to.
- **`textureSampleBias`.** Scaling the gradients by `exp2` of the clamped bias gives the same
  level of detail in theory. It is an assumption to measure, or the call is recomputed whole or
  keeps `TS8052`.
- **Cost (N1).** The rewrite evaluates the slice for every invocation that reaches the hoist
  point. For Namek, that is two `fbm` calls in `groundWarp`, one in `dirtField` and two
  `Noise.value` per pixel, ship and sky pixels included, plus six derivatives. An explicit
  gradient sample can also cost more than an implicit one on some GPUs. Neither is measured; the
  validation evidence includes device frame times before and after.
- **Silhouettes (N2).** At a quad that straddles the branch, the recompute evaluates the slice
  on lanes that do not take the branch (for Namek, sky lanes next to terrain lanes, with
  `terrainT` negative). The gradient is defined, but it is the derivative of a value those lanes
  never use. The sample that uses it is on the lanes that take the branch, and its gradient
  mixes a meaningless neighbour. Today's filtered module has no defined value there at all.
- **ANGLE and FXC (N3).** On Windows, ANGLE translates GLSL to HLSL, and FXC handles a gradient
  operation inside divergent flow poorly (warning X3570, forced loop unrolling). The rewrite
  moves every derivative out of divergent flow, which can help there. This is an inference, not
  measured.
- **The determinism report.** It already lists derivatives as `unbounded` and filtered texture
  reads as driver-dependent (`src/core/passes/determinism.ts`). The rewrite adds no new kind of
  difference, so no new row is proposed. This is an inference for the reviewer.

### The CPU oracle

Rule 11.1 (`docs/language-design.md`, line 1342) makes the CPU oracle the third consumer of the
one IR. It samples nothing and differences nothing: `GPU_STUBS` (`src/core/cpu-runtime.ts`, lines
868-907) returns opaque black for a sample, `textureSampleGrad` included, and a zero of the
operand's shape for a derivative. Without `{ gpuStubs: true }`, a call to one throws
(`src/core/oracle.ts`, lines 788-796).

- **The value read.** With `gpuStubs`, a rewritten sample and the original sample read the same
  placeholder, and a moved derivative reads the same zero. The oracle's result does not change.
- **Where it throws.** The rewrite moves a derivative to the hoist point, where every
  invocation evaluates it. Without `gpuStubs`, the oracle then throws for an invocation that
  does not take the branch, where it did not throw before. A test that runs such a program on
  the oracle without `gpuStubs`, and stays out of the branch, changes from a result to an
  exception.

The proposal does not choose. It is part of decision 2: accept the new exceptions, or let the
oracle read the IR before the rewrite, which is an exception to Rule 11.1's one shared walk and
adds `'11.1'` to `rules` before acceptance.

### Conflicts

- **"Proved exact" against "made defined".** Draft proposal 0130 proposes a new
  Rule 1.8 <!-- doc-refs: skip — Rule 1.8 is the rule 0130 adds --> that lets the compiler
  decide "an optimization it can prove exact". Draft proposal 0131 removes `numerics` on the
  same footing: "the compiler applies a floating-point rewrite only where it proves the rewrite
  exact". This rewrite is not proved exact. It changes a program the language refuses (or a
  filtered program whose result WGSL calls indeterminate) into a defined program, and its result
  can differ from the implicit-LOD sample on every quad, per device. Today's filtered result is
  indeterminate in WGSL and undefined in GLSL ES 3.00, so no rule promises it. The owner decides
  which standard holds (`CLAUDE.md`, the procedure for two principles that point different
  ways). Decision 2 shows both with one example.
- **Rule 1.3 and `docs/dx.md`** (lines 22-26): the GPU computes what the oracle computes. The
  oracle computes a placeholder for both forms, so this rule is not moved; see "The CPU oracle".
- **Rule 1.4 and Rule 11.14.** Rule 1.4 says a borrowing must keep every WGSL capability
  reachable (Rule 11.14). After the change, the `@diagnostic` row of
  `docs/capability-coverage.md` (line 706) moves from `typed` to `refused` on WebGPU. The
  proposal's reading: Rule 11.14 allows `refused`, and Rule 1.4 governs how a capability is
  spelled, not whether a filter is kept. That reading is the proposal's own, so it goes to the
  owner as decision 6.

## Why the compiler cannot do it

Not applicable: this proposal adds no author-facing name, rule, diagnostic code or surface form.
It removes a construct and gives its work to the compiler. The reverse question is the point:
the compiler rewrites the calls whose slice it can recompute, and it reports the rest with
`TS8052` and the reason.

## What it touches

- `rules` 6.7: `diagnostic` leaves the attribute names the compiler reads, with its option
  sentence (D7) and `@diagnostic(…)` in the list of decorated forms (`reqs/rules/RULE-0607.md`
  follows with `bun run reqs:sync`).
- `rules` 8.5: the rationale and "Enforced by" lose the filter, and gain the rewrite and the
  reasons `TS8052` names when the rewrite cannot reach a call (`reqs/rules/RULE-0805.md`, lines
  25-28, follows).
- `surface` 3: the stage-call option list loses `diagnostic`.
- `surface` 7: the `TS8028` rows that name `@diagnostic` lose it.
- `surface` 50: the paragraph "The `diagnostic(...)` directive is not written by hand" is
  rewritten: the front end emits none.
- `surface` 54: "Switching it off" and the filter's text are replaced by the rewrite, its
  method, its reach and the new `TS8052` text. The measurement table stays.
- `exports` `CompileTsSourceResult`: loses `directives: readonly DiagnosticDirective[]`.
- `exports-removed`: none. `DiagnosticDirective` and `ModuleDecl.diagnostics` stay for the IR
  builder (proposed item 6).
- `codes`: none added or removed. `TS8052` keeps its number; its text changes (Rule 12.5, "The
  final `TS8052` sentences"). `TS8028` keeps its number; its text "A stage call takes two
  options, "diagnostic" and "numerics"" changes (see "Migration order").
- `examples`: no id is added or removed. `sample-branch` and `capsule-corp-namek-class` change
  source and four goldens: `examples/__emit-goldens__/sample-branch.wgsl`,
  `sample-branch.fragment.glsl` (`texture` to `textureGrad`, lines 15 and 20),
  `capsule-corp-namek-class.wgsl` and `capsule-corp-namek-class.fragment.glsl` (the `dFdx` and
  `dFdy` at lines 1069-1074 move to the hoist point).
- `names`: none added. `diagnostic` leaves `src/__api__/author-names.md`; a removed name is not
  a criterion (`changes/README.md`).

Not in the front matter, and changed:

- `docs/capability-coverage.md`: the `@diagnostic` attribute row (line 706) moves from `typed`
  to `refused` on WebGPU, with Rule 8.5; the `diagnostic` keyword row (line 726) and the gap
  list (line 1492, #643) follow. `bun run bake:capability-coverage` and
  `src/core/spec-conformance/capability-coverage.test.ts` check the table (Rule 11.14).
- Tests that write the option or read the directive, measured on `79c76d48` (matching lines):
  `src/core/passes/uniformity.test.ts` 30, `src/compiler/ts/stage3.test.ts` 11,
  `src/compiler/ts/stage-call.test.ts` 5 (line 161 holds the `TS8028` text),
  `src/cli/migrate.test.ts` 4, `src/compiler/ts/decorated-form.test.ts` 3,
  `src/compiler/ts/host-kernel.test.ts` 2, `src/vite.test.ts` 2 (the test at lines 468-485 keeps
  the directive in the manifest; it is rewritten to assert no directive and a
  `textureSampleGrad`), `src/compiler/ts/io-name-cascades.test.ts` 1,
  `src/language-service/ambient-registry-closure.test.ts` 1, and `src/compiler/ts/numerics.test.ts`
  line 122 (the `TS8028` text).

The compiler's own `@diagnostic(off, subgroup_uniformity)` in `src/core/passes/kernel-lower.ts`,
`src/core/subgroup-probe.ts` and the generated `src/algorithms/face.ts` is not author-facing and
does not change.

Measured on `main` at `79c76d48`:

| Item                                                                                                                                                                           | Count                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Examples that write `{ diagnostic: [...] }`                                                                                                                                    | 2 of 102: `sample-branch`, `capsule-corp-namek-class`                                                                                                   |
| Goldens with `diagnostic(off, derivative_uniformity);`                                                                                                                         | 2: `examples/__emit-goldens__/sample-branch.wgsl`, `capsule-corp-namek-class.wgsl`; their two `.fragment.glsl` change too                               |
| `TS8052` without the option, with `compile()`                                                                                                                                  | `sample-branch` 2 (lines 61, 66), `capsule-corp-namek-class` 6 (lines 3290-3291, 3324-3325, 3331-3332)                                                  |
| Files outside `changes/` and `CHANGELOG.md` that match `derivative_uniformity`, `diagnostic-directive`, `DiagnosticDirective`, `@diagnostic`, `.directives` or `diagnostic: [` | 38, of which 3 (`kernel-lower.ts`, `subgroup-probe.ts` and its test, `face.ts`) are `subgroup_uniformity` and do not change; the tests are listed above |

Downstream, measured on each repository's default branch, 2026-11-09, for
`derivative_uniformity`, `diagnostic: [`, `@diagnostic`:

| Repository                                                                           | Commit    | Matches                                                                                                                                                 |
| ------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| typecv                                                                               | `4189b3c` | 0                                                                                                                                                       |
| typenn                                                                               | `3a7d66c` | 0                                                                                                                                                       |
| typeaudio                                                                            | `27287bb` | 0                                                                                                                                                       |
| radiance                                                                             | `3e4efb3` | 0                                                                                                                                                       |
| typeplot (not a `DOWNSTREAM_REPOS`)                                                  | `9f20c12` | 1, in its committed compiler bundle `dist/compiler.js`, not an author use                                                                               |
| vscode-typeshade                                                                     | `db3f417` | 1: the plugin skill's language reference, lines 435-437, advises `@diagnostic("off", "derivative_uniformity")`                                          |
| web (`apps/typeshade` is typeshade.dev, `typeshade.github.io` in `DOWNSTREAM_REPOS`) | `ed33afb` | API member texts for `CompileTsSourceResult.directives`, `ModuleDecl.diagnostics`, `DiagnosticDirective`; the `sample-branch` title and blurb in Korean |

Required validation evidence (at implementation):

- `sample-branch` and `capsule-corp-namek-class` compile with no option and no `TS8052`, on
  Tint and on ANGLE (`bun run gate:compile`), with no `diagnostic(` line in their WGSL.
- Tests, both halves (Rule 12.7): each rewrite shape of the table above; each `TS8052` reason in
  `compile()` and in the language service's `getDiagnostics`, on the same source; a
  `{ diagnostic }` option and a `@diagnostic` decorator refused with `TS8028` in both halves.
- A Tint measurement of the rewrite's output with its valid neighbours (Rule 13.3).
- The oracle: the outcome of decision 2, tested (either the new exception without `gpuStubs`,
  or the pre-rewrite IR on the oracle).
- A device comparison beyond `bun run gate:render` (which renders only
  `examples/rt-renderer-class.shade.ts` on SwiftShader and samples no texture): `sample-branch`
  and Namek rendered with the filtered module on `main` and with the rewrite, on at least one
  desktop GPU per vendor the gate has and one mobile GPU, with the per-pixel difference on
  non-straddling quads and the frame time of each. Recorded with device, browser, commit and
  result.
- `bun run bake:goldens`: only the four goldens above, and those of other programs with a
  rewritten call, change.
- `bun run bake:api-surface`: only `CompileTsSourceResult` changes.
- `bun run bake:author-names`: only `diagnostic` leaves.
- `bun run bake:capability-coverage`: only the rows named above change.
- `bun run reqs:sync` and `python scripts/doorstop-check.py -C` after the rule edits.
- `bun run docs:impact`, `bun run docs:refs`, and the mechanical gates of Rule 13.4.

### Draft impact estimate

Known:

- Two examples write the option. Without it, they give 2 and 6 `TS8052` today.
- No downstream program writes the option. The editor's skill text and the site's texts owe
  updates.
- The uniformity walk (`src/core/passes/uniformity.ts`) already finds each call and names the
  statement that made the flow non-uniform (`Via`); the hoist point follows from it.

Estimated:

- The rewrite pass is new compiler work of unknown size: a backward slice, a recompute with
  fresh names, helper specialization, and the reach decision in `compileTsSource`. No duration
  or cost is estimated.
- Reach: both examples' slices meet the condition, so the rewrite can reach all eight calls.
  This is an estimate until the pass exists.
- Runtime cost for Namek: unknown, not measured (N1).
- Bundle size: the directive code leaves; the rewrite pass enters. Net change unknown.

### Migration order

0130 (#1094), 0131 (#1104) and this proposal touch the stage call. The order, if all three are
accepted:

1. The rewrite lands first, with `Change: 0132`. It changes no surface: it only makes `TS8052`
   fire less. The two examples still carry the option, which still works.
2. This proposal's removal and 0131's removal of `numerics` land in either order. The first of
   the two to land keeps the options parser in `diagnostic-directive.ts` with one option, and
   `TS8028` says "A stage call takes one option, …". The second deletes
   `src/compiler/ts/diagnostic-directive.ts`, moves whatever of the parser remains to
   `src/compiler/ts/stage-call.ts`, removes the `options` parameter from the ambient stage
   calls, and `TS8028` says "A stage call takes no options".
3. 0130 removes the stage calls themselves (one migration release with a `TS8028` warning, then
   refusal). After it, `TS8028` refuses a stage-call form, and the "takes no options" text
   leaves with the stage calls.

If only this proposal is accepted, `numerics` stays the one option, and step 2's first branch
applies.

### Decisions for the owner

1. **Decided.** The owner chose option A on 2026-11-09, in the conversation: "추천대로" (as
   recommended), then "승인" (approved). The compiler rewrites what it can reach; `TS8052`
   remains for the rest. This is a decision on the direction of the draft, not the acceptance of
   the proposal.
2. **Decided 2026-11-09: accepted as defined, and the oracle reads the rewritten IR.** A
   rewritten sample is not proved exact; the owner chose, in the conversation's question form,
   "A. 허용" (allow) for the rewrite and "예외 허용" (accept the exceptions) for the oracle: the
   oracle consumes the same rewritten IR (Rule 11.1 unchanged), and a run without `gpuStubs`
   throws on invocations that skipped the branch before. "Proved exact" (0130, 0131) applies to
   rewrites of a defined program; this rewrite makes a refused, indeterminate program defined.
3. **Open.** The Namek fallback: if the rewrite cannot reach its six calls at first, hoist them
   in the example's source by hand (shown to the owner before merge), or keep the option until
   the rewrite reaches them.
4. **Open.** Keep `ModuleDecl.diagnostics` and `DiagnosticDirective` for the IR builder
   (recommended in this proposal), or remove them in a separate proposal.
5. **Open.** A written option or decorator after the change: `TS8028` at once (recommended,
   since no downstream program writes it), or one migration release with a warning.
6. **Open.** Rule 1.4's reading: the `@diagnostic` capability becomes `refused` with Rule 8.5,
   and Rule 1.4 is not amended (recommended), or Rule 1.4 is amended in this proposal.

**Decision 2, the question.** Two principles point different ways:

- 0130's proposed Rule 1.8 <!-- doc-refs: skip — Rule 1.8 is the rule 0130 adds --> and 0131
  (title and item 7): the compiler applies a rewrite by itself only where it proves the rewrite
  exact.
- The owner's direction of 2026-11-09 and Rule 8.5: what the compiler can do is not pushed onto
  the author, and the emitted program is defined.

One example, `sample-branch`'s `wide(v.uv)` under `if (v.uv.x > 0.5)`:

- **Held to "proved exact".** The rewrite is not exact (explicit gradients against the device's
  implicit level of detail). The call keeps `TS8052`. The author moves the sample above the
  branch by hand, or writes `textureSampleGrad(albedo, smp, inner, dpdx(inner), dpdy(inner))`
  with `inner` computed before the `if`. The proposal then reduces to items 1, 2 and 4-7, and
  `sample-branch` is rewritten by hand.
- **Accepted as defined.** The compiler emits `textureSampleGrad` with gradients computed
  before the `if`. The pixel can differ from today's filtered result on any quad, on any device:
  WGSL calls today's result indeterminate, GLSL ES 3.00 undefined. The author writes nothing.

And for the oracle, under "accepted as defined": (a) accept that the oracle, without `gpuStubs`,
throws for an invocation outside the branch where it did not; or (b) the oracle reads the IR
before the rewrite, an exception to Rule 11.1.

### Independent review record

| Field             | Record                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Reviewer          | A Claude Code agent that did not write the proposal.                                     |
| Date              | 2026-11-09.                                                                              |
| Revision reviewed | `13d254f5`, measured on `main` at `f2f05cb5`.                                            |
| Verdict           | Not ready.                                                                               |
| This revision     | Answers each finding below; re-measured on `main` at `79c76d48`. Not yet reviewed again. |

| ID  | Finding                                                                                                                                                                                                                                                              | Status and answer                                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | Reason 1 ("the operand reads a value written inside the branch") refuses Namek: `dirt += …` (line 3305 on `79c76d48`) is inside `Terrain.shade`, called under `else if (terrainT > 0.0)` (line 4016). Reaching it needs the whole side-effect-free slice recomputed. | Fixed in this revision: item 3 recomputes the backward slice, with constant-trip-count loops only; reason 1 now names only what cannot be recomputed. Namek's slice is measured to meet the condition. |
| B2  | The example emit used a chain rule (`g0x * 0.5`), which is not the stated rule. Pick one method and make the emit match; a loop without a constant trip count keeps `TS8052` (no TDR risk).                                                                          | Fixed in this revision: one method, recompute, then derive; the example derives `c1 = v.uv * 0.5`. Affine propagation is alternative E, not chosen. A non-constant loop on the slice is reason 1.      |
| B3  | The CPU oracle is the third consumer (Rule 11.1). It samples nothing (`GPU_STUBS`); without `gpuStubs` a derivative throws. A moved derivative runs on every invocation, so the oracle throws where it did not.                                                      | Fixed in the text ("The CPU oracle"). The choice is the owner's: decision 2 (a) or (b).                                                                                                                |
| S1  | Decision 2 understated the difference: a rewritten sample can differ on every quad, not only diverging ones. 0130 and 0131 hold rewrites to "proved exact"; this one is not. Present both principles with one example.                                               | Owner: decision 2 reframed with both principles and `wide(v.uv)` as the example; listed under "Conflicts".                                                                                             |
| S2  | Shapes missing: depth textures, the bias clamp, early `return`, `break`, `continue`, `&&`, `                                                                                                                                                                         |                                                                                                                                                                                                        | `, `switch`, `?:`, memory-read order, unaffected built-ins, `discard` in WGSL and GLSL. | Fixed in this revision: "How each control-flow shape is rewritten", the bias, depth and `discard` paragraphs, and the list of unrestricted calls under "Today". The GLSL `discard` reading is an inference. |
| S3  | Scope missing: `docs/capability-coverage.md` lines 706, 726, 1492; Rule 1.4; `src/vite.test.ts` 468-485; seven test files; RULE-0805 and RULE-0607; the `TS8028` text; four goldens; the reach decision in `compileTsSource`; device evidence beyond `gate:render`.  | Fixed in this revision: each is in "What it touches" or "Required validation evidence". Rule 1.4's reading goes to the owner as decision 6.                                                            |
| S4  | Write the final `TS8052` sentences, each naming an action that needs no new construct.                                                                                                                                                                               | Fixed in this revision: "The final `TS8052` sentences".                                                                                                                                                |
| S5  | Give the migration order with 0130 and 0131: who deletes `diagnostic-directive.ts`, the `TS8028` text, 0130's removal of stage calls.                                                                                                                                | Fixed in this revision: "Migration order".                                                                                                                                                             |
| N1  | Cost: Namek computes the dirt field per pixel; explicit gradients cost more on some GPUs. Put device timing in the evidence.                                                                                                                                         | Fixed in this revision: Assumptions (Cost) and the device comparison with frame times. The measurement itself is open until implementation.                                                            |
| N2  | Speculative gradients at silhouettes are defined but meaningless.                                                                                                                                                                                                    | Fixed in this revision: Assumptions (Silhouettes).                                                                                                                                                     |
| N3  | ANGLE on D3D (FXC) may benefit.                                                                                                                                                                                                                                      | Fixed in this revision: Assumptions (ANGLE and FXC), marked not measured.                                                                                                                              |
| N4  | Line numbers off by one: 61 and 66; 3290-3291, 3324-3325, 3331-3332.                                                                                                                                                                                                 | Fixed in this revision: re-measured with `compile()` on `79c76d48`.                                                                                                                                    |
| N5  | Say whether a helper is inlined or receives the gradients as parameters.                                                                                                                                                                                             | Fixed in this revision: specialization with gradient parameters is the method; inlining is the fallback. The example shows `sharp_grad` and `wide_grad`.                                               |

Open findings for the owner before the decision: S1 and B3 (decision 2), the Rule 1.4 reading
of S3 (decision 6). Open until implementation: the measurements of N1 and of the equality
assumption.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decision on this pull
request, the approved revision, answers to decisions 2-6, and a review record with no open
finding that is not the owner's. Decision 1 is recorded above as the owner's direction for the
draft.

### Configuration and validation record

This record does not yet apply. Delivery will require the implementing pull requests (each
commit `Change: 0132`), the delivered configuration and the validation evidence listed under
"Required validation evidence".

## What it owes downstream

- **typeshade.github.io** (`web`, `apps/typeshade`, at `ed33afb`). Change these files of
  `apps/typeshade` in that repository:
  - `src/i18n/ko.ts` lines 2459 and 2620: the `sample-branch` title and blurb. <!-- doc-refs: skip — a file of typeshade/web -->
  - `content/api/ko/compiletssourceresult.json` line 9: the `members.directives` text, removed. <!-- doc-refs: skip — a file of typeshade/web -->

  The pages generated from Rule 6.7, Rule 8.5 and surface §3, §7, §50 and §54, and the English
  example title and blurb, follow the pin. Record 0132 in that repository's
  `compiler-changes.md` when the pin moves.

- **vscode-typeshade** (at `db3f417`). Remove the `@diagnostic` advice, lines 435-437, and say that
  the compiler rewrites what it can, in this file of that repository:
  `plugins/typeshade/skills/typeshade/references/language.md`. <!-- doc-refs: skip — a file of typeshade/vscode-typeshade -->
  Record 0132 in `compiler-changes.md` when the pin moves.
- Radiance, TypeNN, TypeCV and TypeAudio owe nothing: none of them writes the option.
