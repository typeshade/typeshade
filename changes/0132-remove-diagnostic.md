---
id: '0132'
title: An author writes no diagnostic filter; the compiler rewrites an implicit-LOD sample or a derivative in non-uniform control flow
status: accepted
rules:
  - '1.4'
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

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0132, `status: accepted`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Date and attribution          | Drafted 2026-11-09 (UTC) by an AI agent (Claude Code) at the owner's direction, revised the same day after an independent review, again the same day to record the owner's decisions 3 to 6 and to amend Rule 1.4 (decision 6), and again the same day to record the owner's change of decision 5 (refuse at once) and to answer the follow-up review of `f61a44e4`. The date is the drafting date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Request source                | The owner (Seungup) set the direction in the Claude Code session on 2026-11-09: the language gains as little as possible; what the compiler can decide is compiler work and is never pushed onto the author; what the author does not need to learn is removed. The owner directed this removal in the same session. Draft proposal 0130 (pull request #1094) proposes the principle as a design rule and removes the stage calls. Proposal 0131 (pull request #1104, merged as `71887632`, `status: accepted`) removes the other stage-call option, `numerics`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Applicability / effectivity   | Expected: `src/compiler/ts/diagnostic-directive.ts` (deleted; what remains of the options parser moves to `stage-call.ts`, see "Migration order"), `src/compiler/ts/source-file.ts`, `compile.ts`, `host-face.ts`, `builtin-check.ts`, `decorated-form.ts`, `stage-call.ts`, `src/cli/migrate.ts`, `src/core/passes/uniformity.ts` (the `TS8052` text), a new rewrite pass in `src/core/passes/`, `src/language-service/ambient.ts`, `docs.ts` and `service.ts`, `src/core/coverage/wgsl.ts`, `docs/language-design.md`, `docs/use-typeshade-surface.md`, `docs/capability-coverage.md`, `src/__api__/surface.md`, `CHANGELOG.md`, two examples and four of their goldens, `reqs/` (`RULE-0104`, `RULE-0607`, `RULE-0805`), and the tests listed under "What it touches". The WGSL and GLSL ES 3.00 of a program that writes no `diagnostic` change only where a sample or a derivative is rewritten. No release version is assigned. The removal ships in one implementing change (decision 5): a written filter is refused with `TS8028` in the change that removes it, and no release has a warning window. |
| Review baseline               | `main` at `79c76d48` (merge of pull request #1098), 2026-11-09. Every count below was measured on that commit unless the row says otherwise. The independent review measured revision `13d254f5` on `main` at `f2f05cb5`. Decisions 3 to 6, the Rule 1.4 amendment and the coverage cells were measured on `main` at `9f1621f7`, merged into this branch. The changed decision 5, the answers to the follow-up review of `f61a44e4` and the coverage counts were measured on `main` at `c8fe704f`, merged into this branch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Review and revision authority | Pull request #1105 (draft). Git records the revisions of this file. Its merge with `status: accepted` will record the decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

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
   declaration `declare function diagnostic(…)` from the language. A written `@diagnostic(…)`
   or `{ diagnostic: [...] }` option gets `TS8028`, an error, in `compile()` and in the
   language service (Rule 12.7), in the same change that removes it. The refusal replaces the
   `TS8028` warning of `src/compiler/ts/decorated-form.ts` lines 115-117, which today advises
   `write the option "{ diagnostic: [...] }"`. It is not added beside it: one refusal message,
   which never points to the removed option (see "A written filter: refused at once").
2. Stop the `"use typeshade"` front end from emitting a `diagnostic(…)` directive. Remove the
   `directives` member of `CompileTsSourceResult` (`src/__api__/surface.md` line 992), in the
   same change. The removal is breaking (Rule 13.9).
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
   language does not reach them. They are not an author construct (decision 4).
7. Change `tshc migrate` (`src/cli/migrate.ts`): delete a `@diagnostic(…)` decorator and a
   stage call's `diagnostic` option, in place of rewriting the decorator to the option.
8. Amend Rule 1.4 (decision 6) with an explicit exception: a WGSL capability that only
   switches off a validation the compiler satisfies by rewriting the program is not borrowed.
   The text is under "Rule 1.4, amended".

Items 1 to 8, the edits to Rules 1.4, 6.7 and 8.5 and to surface §3, §7, §50 and §54, the two
coverage rows that become `refused`, the two examples without the option and the `CHANGELOG.md`
entry land in one implementing change (decision 5). There is no release split. The rewrite and
the refusal land together, so no program carries a filter while the rewrite runs.

### A written filter: refused at once

The owner decided on 2026-11-09 that a written filter is refused at once (decision 5). The
facts it rests on, measured 2026-11-09:

- `RELEASING.md` says "Publishing is a GitHub release". The repository has no GitHub release
  and no Git tag (`gh api repos/typeshade/typeshade/releases` and `…/tags` each return an
  empty list).
- `npm view typeshade versions` lists only `0.0.0`.
- `CHANGELOG.md` has a heading `[0.1.0] - 2026-09-29` (line 2774), whose section holds the
  entry "Derivative uniformity is analysed, or switched off on request" (line 4390). A heading
  is not a publication.

Inference: `@diagnostic(…)` was never published. Rule 13.9 binds "a published version", and
Rule 13.10 counts its window "in published releases". Neither requires a window for a form no
published version has. Proposal 0131 read the two rules the same way ("Rules 13.9 and 13.10
bind a published version", its "Problem and evidence"). The stage call's `{ diagnostic: [...] }`
option came with change 0111 and has no `CHANGELOG.md` entry at all (N4 of the follow-up
review).

What an author sees after the implementing change:

- A written `{ diagnostic: [...] }` on `vertex`, `fragment` or `compute` gets one `TS8028`, an
  error, in both halves. On `workgroup_size`, 0131's accepted text already refuses it, as any
  third argument, with `TS8028` in both halves. After 0131 is implemented, a stage call takes no
  options, so the text is: `A stage call takes no options; "diagnostic: [...]" is not one.
Delete it: the compiler rewrites each implicit-LOD sample or derivative it can reach (Rule
8.5) and reports each other one with TS8052 and the reason. "tshc migrate" deletes it.`
- A written `@diagnostic(…)` gets one `TS8028`, an error, in both halves: `"@diagnostic(…)" is
not a decorator the compiler reads (Rule 6.7). Delete it: …`, with the same last two sentences.
  It replaces the warning of `src/compiler/ts/decorated-form.ts` lines 115-117.
- Neither text names the removed option or a severity. The exact texts are fixed by the
  implementation and held by tests (Rule 12.5).
- The program compiles once the filter is deleted. Each call the rewrite cannot reach gets
  `TS8052` with the reason.

The earlier choice, "경고 후 거부" (warn, then refuse), rested on the agent's incorrect premise
that `0.1.0` was published. The owner changed it after the correction (decision 5).

### How each control-flow shape is rewritten

The uniformity walk already names the statement that made the flow non-uniform (`Via` in
`src/core/passes/uniformity.ts`, lines 133-168). The hoist point follows from it:

| Shape (`Via`)                                                   | Hoist point                                                                                                                             |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `branch` (`if`), `switch`                                       | Before the `if` or the `switch`. One recompute serves every arm and case that needs it.                                                 |
| `short-circuit` (`&&`, `\|\|`)                                  | Before the statement that holds the expression, so that the right side's slice is recomputed whether the left side lets it run or not.  |
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
  passes them in. That fallback changes how the example is written, so the implementing pull
  request shows it to the owner before and after, before merge (decision 3, decided: the
  removal goes ahead either way).

### Rule 1.4, amended

Today (`docs/language-design.md` §1.8, on `main` at `9f1621f7`):

> **Rule 1.4.** Where ECMAScript has a form that carries the GPU meaning, the surface must borrow
> TypeScript's spelling; a WGSL spelling is borrowed only where no ECMAScript spelling carries
> the meaning, and the borrowing must keep every WGSL capability reachable (Rule 11.14).
> A form may be borrowed in part: the members, the positions or the meaning it takes are those
> the rules give it.
>
> - Rationale: the WGSL vocabulary is there to say what TypeScript cannot say, such as a value's
>   width or an address space. It is not a second spelling an author has to learn for what
>   TypeScript already says.
> - Derives from: `changes/0100-typescript-meaning.md` (section 1, the first two requirements);
>   the roadmap's first rule, "ordinary TypeScript first".
> - Enforced by: review (Rule 13.1); Appendix B, under Rule 1.1, for the spellings the tree still
>   offers twice.

Proposed. The first two sentences do not change. A third sentence, and one clause at the end of
each bullet, are added:

> **Rule 1.4.** Where ECMAScript has a form that carries the GPU meaning, the surface must borrow
> TypeScript's spelling; a WGSL spelling is borrowed only where no ECMAScript spelling carries
> the meaning, and the borrowing must keep every WGSL capability reachable (Rule 11.14).
> A form may be borrowed in part: the members, the positions or the meaning it takes are those
> the rules give it.
> A WGSL capability that only switches off a validation the compiler satisfies by rewriting the
> program is not borrowed: the compiler's rewrite gives the program the capability would have
> admitted. The `derivative_uniformity` filter is such a capability (Rule 8.5). Its rows in
> `docs/capability-coverage.md` are `refused` with this rule (Rule 11.14, Rule 11.18).
>
> - Rationale: the WGSL vocabulary is there to say what TypeScript cannot say, such as a value's
>   width or an address space. It is not a second spelling an author has to learn for what
>   TypeScript already says. A filter that switches a validation off is not something the author
>   must state: it asks the author to learn a WGSL rule name and its severities for work the
>   compiler can do, and the program it leaves is indeterminate in WGSL and undefined in GLSL ES
>   3.00. The language keeps a construct only for what the author must state and the compiler
>   cannot know (`docs/owner-decisions.md`, OD-3).
> - Derives from: `changes/0100-typescript-meaning.md` (section 1, the first two requirements);
>   the roadmap's first rule, "ordinary TypeScript first"; `changes/0132-remove-diagnostic.md`
>   (decision 6) and OD-3 for the third sentence.
> - Enforced by: review (Rule 13.1); Appendix B, under Rule 1.1, for the spellings the tree still
>   offers twice; the rows' cells in `src/core/coverage/wgsl.ts`, checked by
>   `capability-coverage.test.ts` (Rule 11.18); `TS8028` on a written `@diagnostic(…)` or
>   `{ diagnostic: [...] }`, and the tests of Rule 8.5's rewrite.

`reqs/rules/RULE-0104.md` follows with `bun run reqs:sync`. The Rule 1.4 amendment, the two
coverage rows that become `refused` and the `TS8028` refusal land together in the implementing
change. No revision of `main` has the rule and the table disagree, and none has a rule that
calls a form refused while the compiler still accepts it.

Once 0130 lands, the third sentence of Rule 1.4 cites Rule 1.8 <!-- doc-refs: skip — Rule 1.8 is the rule 0130 adds -->
and the rationale clause that repeats Rule 1.8's reasoning is removed. The second of the two
implementations to land makes that edit.

**The coverage cells, measured.** `docs/capability-coverage.md`'s statuses are `typed`, `raw`,
`refused`, `planned`, `gap` and `n/a` (Rule 11.14). `refused` fits: an author who writes the
filter is refused (`TS8028`), and the capability is reached by another spelling, the call written
where it is. `n/a` names a capability the target lacks, and WebGPU has this one. Rule 11.18 asks a
`refused` cell for a rule and a portable spelling. Both cells use one portable spelling, _P_:
"write the sample or the derivative where it is; the compiler rewrites what it can reach (Rule
8.5); otherwise textureSampleLevel or textureSampleGrad, or the call moved above the branch".
The proposed cells of `src/core/coverage/wgsl.ts`, WebGPU column:

- The `@diagnostic` attribute row (its `name` at `src/core/coverage/wgsl.ts` line 2750; rendered
  at `docs/capability-coverage.md` line 706): `refused('Rule 1.4', P, 'a written @diagnostic is
TS8028; surface §54; subgroup_uniformity: the compiler writes that filter only on its own
lowering (src/core/passes/kernel-lower.ts), and the uniformity walk refuses an author
subgroup call in non-uniform control flow (TS8052)')`, in place of `typed`. The note covers
  the other rule the attribute can name (N1 of the follow-up review).
- The `diagnostic` keyword row (its `name` at `src/core/coverage/wgsl.ts` line 2997; rendered at
  `docs/capability-coverage.md` line 726): `refused('Rule 1.4', P, 'the module-level directive
is not written by hand (surface §50)')`, in place of `gap` (group 12, #643). The row's `note`
  at line 3000, "also: the @diagnostic attribute on an entry is typed (issue 161)", is removed:
  it is no longer true. The gap list of `docs/capability-coverage.md` (line 1492) loses the
  entry.

The WebGL2 column stays `n/a`. Measured on `main` at `c8fe704f` (2026-11-09, Bun 1.4.4), with
the two cells above substituted in a working tree and reverted after:

- `bun run bake:capability-coverage`: 0 defects in every check of `CHECKS` (`checkRefused`,
  `checkGap`, `checkSubGaps`, `checkEvidence` and the others). `checkRefused` accepts `Rule 1.4`
  because `docs/language-design.md` defines it; the amendment keeps the number.
- `bun test src/core/spec-conformance/capability-coverage.test.ts`: 92 pass, 0 fail.
- The count rows the bake rewrites, in `docs/capability-coverage.md` and in the Appendix C count
  table of `docs/language-design.md`:

| Row         | typed     | refused | gap       |
| ----------- | --------- | ------- | --------- |
| B, WebGPU   | 241 → 240 | 10 → 12 | 40 → 39   |
| all, WebGPU | 540 → 539 | 10 → 12 | 157 → 156 |

- The `Gap cells` line of group 12 (#643): WebGPU 19 → 18. No other row or count moves.

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
  decide "an optimization it can prove exact". Proposal 0131 (accepted) removes `numerics` on the
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
  reachable (Rule 11.14). After the change, no author construct reaches the
  `derivative_uniformity` filter. The owner decided on 2026-11-09 to amend Rule 1.4 in this
  proposal (decision 6), so the rule states the exception and the coverage rows become
  `refused` with Rule 1.4 ("Rule 1.4, amended").

## Owner's decisions

This proposal rests on two entries of `docs/owner-decisions.md`:

- **OD-3.** The language stays small; the compiler's work is not pushed onto the author. A
  validation the compiler can satisfy by rewriting is the compiler's work, and a construct the
  compiler could replace is removed. OD-3 names this proposal. The Rule 1.4 amendment
  (decision 6) writes OD-3's case into the rule.
- **OD-4.** Show the owner what changes before the owner decides. The `sample-branch` example
  is shown before and after ("Example"), each decision was put to the owner as a question with
  its options and costs, and the Namek fallback, if used, is shown before and after before merge
  (decision 3). The change of decision 5 was put to the owner as a question after the agent
  corrected its premise (`0.1.0` was not published).

The proposal reverses no entry. OD-1 and OD-2 are not touched: the proposal removes a filter and
does not change how a stage or any other construct is written.

## Why the compiler cannot do it

Not applicable: this proposal adds no author-facing name, rule, diagnostic code or surface form.
It removes a construct and gives its work to the compiler. The reverse question is the point:
the compiler rewrites the calls whose slice it can recompute, and it reports the rest with
`TS8052` and the reason.

## What it touches

- `rules` 1.4: the third sentence and the three clauses of "Rule 1.4, amended" (decision 6);
  `reqs/rules/RULE-0104.md` follows with `bun run reqs:sync`.
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
- `exports` `CompileTsSourceResult`: loses `directives: readonly DiagnosticDirective[]`
  (`src/__api__/surface.md` line 992) in the implementing change. It is a breaking change (Rule
  13.9); the release that carries it bumps the minor (see `CHANGELOG.md` below).
- `exports-removed`: none. `DiagnosticDirective` and `ModuleDecl.diagnostics` stay for the IR
  builder (proposed item 6).
- `codes`: none added or removed. `TS8052` keeps its number; its text changes (Rule 12.5, "The
  final `TS8052` sentences"). `TS8028` keeps its number; its warning for `@diagnostic` in
  `src/compiler/ts/decorated-form.ts` (lines 115-117) is replaced by a refusal, and its stage-call
  text becomes "A stage call takes no options" (N6 of the follow-up review; see "A written
  filter: refused at once" and "Migration order").
- `examples`: no id is added or removed. `sample-branch` and `capsule-corp-namek-class` change
  source and four goldens: `examples/__emit-goldens__/sample-branch.wgsl`,
  `sample-branch.fragment.glsl` (`texture` to `textureGrad`, lines 15 and 20),
  `capsule-corp-namek-class.wgsl` and `capsule-corp-namek-class.fragment.glsl` (the `dFdx` and
  `dFdy` at lines 1069-1074 move to the hoist point).
- `names`: none added. `diagnostic` leaves `src/__api__/author-names.md`; a removed name is not
  a criterion (`changes/README.md`).

Not in the front matter, and changed:

- `docs/capability-coverage.md`: in the implementing change, the `@diagnostic` attribute row
  (line 706) moves from `typed` to `refused (Rule 1.4; …)` on WebGPU, and the `diagnostic`
  keyword row (line 726) from `gap` to `refused (Rule 1.4; …)`; the gap list (line 1492, #643)
  loses the entry. The bake also moves the count rows of `docs/capability-coverage.md` and the
  Appendix C count table of `docs/language-design.md`. The cells and the counts are measured
  under "Rule 1.4, amended".
- `src/compiler/ts/decorated-form.ts`: the `diagnostic` branch of `stageSentence` (lines
  115-117) is replaced by the refusal of item 1.
- `src/__api__/surface.md`: `CompileTsSourceResult` (line 992) loses `directives`
  (`bun run bake:api-surface`).
- `CHANGELOG.md`: one removal entry under `### Removed` in `[Unreleased]` (see "Required
  validation evidence"). `bun run bake:capability-coverage` and
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
  `compile()` and in the language service's `getDiagnostics`, on the same source. A
  `{ diagnostic }` option and a `@diagnostic` decorator are each refused with one `TS8028` in
  both halves, with a text that does not name the removed option.
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
- `bun run bake:capability-coverage`: only the two rows named above, the gap-list entry and the
  counts change. On `c8fe704f` the counts move as measured under "Rule 1.4, amended" (B/WebGPU
  typed 241 → 240, refused 10 → 12, gap 40 → 39; all/WebGPU typed 540 → 539, refused 10 → 12,
  gap 157 → 156; group 12 gap cells WebGPU 19 → 18), in `docs/capability-coverage.md` and in the
  Appendix C count table of `docs/language-design.md`. Re-measure on the implementing change's
  base.
- `bun run reqs:sync` and `python scripts/doorstop-check.py -C` after the rule edits
  (`RULE-0104`, `RULE-0607`, `RULE-0805`).
- `CHANGELOG.md`: one removal entry under `### Removed` in `[Unreleased]`, in the house style
  (Rule 13.8). It names the edit an author makes (delete the filter, or run `tshc migrate`), the
  removal of `CompileTsSourceResult.directives` and the two coverage rows that become `refused`
  (Rule 13.9). `src/changelog.test.ts` treats a `### Removed` entry as breaking, so the release
  that carries it bumps the minor over `0.1.0`. No deprecation entry is written: there is no
  warning release.
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

0130 (#1094), 0131 (#1104) and this proposal touch the stage call. The order:

1. 0131 is implemented first. It is accepted (pull request #1104, merged as `71887632`) and has
   no migration release. After it, the options parser in `diagnostic-directive.ts` reads one
   option, `diagnostic`. 0131's accepted text already refuses `{ diagnostic }` on
   `workgroup_size`, as any third argument, with `TS8028` in both halves.
2. This proposal's implementation lands next, in one change with `Change: 0132`. It holds the
   rewrite and the new `TS8052` text; the `TS8028` refusal of a written filter in both halves,
   in place of the warning of `decorated-form.ts`; `tshc migrate`'s deletion; the edits to Rules
   1.4, 6.7 and 8.5 and to surface §3, §7, §50 and §54; the two coverage rows as `refused` and
   the re-baked counts; the two examples without the option (their goldens re-baked and
   reviewed, Rule 11.4); the removal of `CompileTsSourceResult.directives`; and the
   `CHANGELOG.md` removal entry. Because 0131 is already implemented, this change deletes
   `src/compiler/ts/diagnostic-directive.ts`, moves what remains of the options parser to
   `src/compiler/ts/stage-call.ts`, removes the `options` parameter from the ambient stage
   calls, and `TS8028` says "a stage call takes no options".
3. 0130 (#1094, draft, head `5ea5aef2`) waits on this implementation. Its codemod runs after
   this proposal's `tshc migrate` deletion step, in the same run, because `tshc migrate` cannot
   place a `{ diagnostic }` option on an attribute. After 0130, a stage-call form is refused, and
   the "takes no options" text leaves with the stage calls. A `@diagnostic(…)` written on a 0130
   entry (`@fragment`) is the same filter and is refused with `TS8028`. 0130's text at
   `5ea5aef2` ("Interaction with 0131 and 0132") still describes a warning release for 0132; it
   owes that update in #1094.

**Rule 1.4 and draft 0130.** Draft 0130 (#1094, head `5ea5aef2`, read 2026-11-09) does not list
`'1.4'` in its `rules` and does not change Rule 1.4's text. It reads Rule 1.4 in the rationale of
the Rule 1.8 it proposes <!-- doc-refs: skip — Rule 1.8 is the rule 0130 adds -->
("Rule 1.4 still holds where an ECMAScript form carries the meaning") and reads the roadmap's
"ordinary TypeScript first" there. This proposal adds a third sentence to Rule 1.4 and one
clause at the end of each bullet; it does not change the first two sentences, which 0130 reads.
The order in which the two land is therefore irrelevant to their meaning. If a revision of 0130
edits Rule 1.4's "Derives from" bullet, where "ordinary TypeScript first" is cited, the two
edits meet in that one bullet: the second to land keeps both, 0130's reading and this
proposal's clause. The rule 0130 adds <!-- doc-refs: skip — Rule 1.8 is the rule 0130 adds -->
also says that "a validation the compiler can satisfy by rewriting the program" is the
compiler's work. Once both land, the third sentence of Rule 1.4 cites that rule and drops the
rationale clause that repeats it ("Rule 1.4, amended").

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
3. **Decided 2026-11-09: the example is fixed by hand.** The question: if the rewrite cannot
   reach Namek's six calls at first, does the example's source hoist them by hand, or does the
   option stay until the rewrite reaches them? The owner chose, in the conversation's question
   form, "예제를 손으로 고침 (권장)" (fix the example by hand, recommended). If the first
   implementation does not reach the six calls, the implementing pull request computes them in
   `render` before the branch, by hand, and shows the owner that change before and after (OD-4)
   before merge. The removal goes ahead either way.
4. **Decided 2026-11-09: kept.** The question: does the IR builder keep `ModuleDecl.diagnostics`
   and `DiagnosticDirective`, or does a separate proposal remove them? The owner chose "남김
   (권장)" (keep, recommended). They stay for the IR builder (`typeshade/core/ir`, Rule 11.19).
   They are not an author construct: no `"use typeshade"` form reaches them.
5. **Decided 2026-11-09, changed the same day: refused at once.** The question: is a written
   option or decorator refused with `TS8028` at once, or does it warn for one release first? The
   owner first chose "경고 후 거부 (권장)" (warn, then refuse, recommended). That choice rested on
   the agent's incorrect premise that `0.1.0` was published. The agent corrected the premise:
   the repository has no Git tag and no GitHub release, `RELEASING.md` says publishing is a
   GitHub release, and npm lists only `0.0.0` (measured 2026-11-09). The `[0.1.0] - 2026-09-29`
   heading of `CHANGELOG.md` is not a publication. Rules 13.9 and 13.10 bind a published
   version, so they do not require a window; 0131 read them the same way. Asked again in the
   conversation's question form, the owner chose "바로 거부로 변경" (change to refuse at once). A
   written `@diagnostic(…)` or `{ diagnostic }` option gets `TS8028`, refused, in both halves,
   in the same change that lands the removal; `tshc migrate` deletes it ("A written filter:
   refused at once", "Migration order").
6. **Decided 2026-11-09: Rule 1.4 is amended.** The question: does the `@diagnostic` capability
   only become `refused` under today's Rule 1.4, or is Rule 1.4 amended in this proposal? The
   owner chose "Rule 1.4 개정" (amend Rule 1.4). This proposal adds `'1.4'` to `rules` and gives
   the new text under "Rule 1.4, amended": a capability that only switches off a validation the
   compiler satisfies by rewriting is not borrowed, because the compiler's rewrite gives the
   program the capability would have admitted (OD-3).

Open decisions: none.

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

| Field             | Record                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| Reviewer          | A Claude Code agent that did not write the proposal.                                                   |
| Date              | 2026-11-09.                                                                                            |
| Revision reviewed | `13d254f5`, measured on `main` at `f2f05cb5`.                                                          |
| Verdict           | Not ready.                                                                                             |
| This revision     | Answers each finding below; re-measured on `main` at `79c76d48`. Reviewed again at `f61a44e4` (below). |

| ID  | Finding                                                                                                                                                                                                                                                              | Status and answer                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Reason 1 ("the operand reads a value written inside the branch") refuses Namek: `dirt += …` (line 3305 on `79c76d48`) is inside `Terrain.shade`, called under `else if (terrainT > 0.0)` (line 4016). Reaching it needs the whole side-effect-free slice recomputed. | Fixed in this revision: item 3 recomputes the backward slice, with constant-trip-count loops only; reason 1 now names only what cannot be recomputed. Namek's slice is measured to meet the condition.      |
| B2  | The example emit used a chain rule (`g0x * 0.5`), which is not the stated rule. Pick one method and make the emit match; a loop without a constant trip count keeps `TS8052` (no TDR risk).                                                                          | Fixed in this revision: one method, recompute, then derive; the example derives `c1 = v.uv * 0.5`. Affine propagation is alternative E, not chosen. A non-constant loop on the slice is reason 1.           |
| B3  | The CPU oracle is the third consumer (Rule 11.1). It samples nothing (`GPU_STUBS`); without `gpuStubs` a derivative throws. A moved derivative runs on every invocation, so the oracle throws where it did not.                                                      | Fixed in the text ("The CPU oracle"). The choice is the owner's: decision 2 (a) or (b).                                                                                                                     |
| S1  | Decision 2 understated the difference: a rewritten sample can differ on every quad, not only diverging ones. 0130 and 0131 hold rewrites to "proved exact"; this one is not. Present both principles with one example.                                               | Owner: decision 2 reframed with both principles and `wide(v.uv)` as the example; listed under "Conflicts".                                                                                                  |
| S2  | Shapes missing: depth textures, the bias clamp, early `return`, `break`, `continue`, `&&`, `\|\|`, `switch`, `?:`, memory-read order, unaffected built-ins, `discard` in WGSL and GLSL.                                                                              | Fixed in this revision: "How each control-flow shape is rewritten", the bias, depth and `discard` paragraphs, and the list of unrestricted calls under "Today". The GLSL `discard` reading is an inference. |
| S3  | Scope missing: `docs/capability-coverage.md` lines 706, 726, 1492; Rule 1.4; `src/vite.test.ts` 468-485; seven test files; RULE-0805 and RULE-0607; the `TS8028` text; four goldens; the reach decision in `compileTsSource`; device evidence beyond `gate:render`.  | Fixed: each is in "What it touches" or "Required validation evidence". Rule 1.4: decided by the owner on 2026-11-09 (decision 6), amended in this proposal ("Rule 1.4, amended").                           |
| S4  | Write the final `TS8052` sentences, each naming an action that needs no new construct.                                                                                                                                                                               | Fixed in this revision: "The final `TS8052` sentences".                                                                                                                                                     |
| S5  | Give the migration order with 0130 and 0131: who deletes `diagnostic-directive.ts`, the `TS8028` text, 0130's removal of stage calls.                                                                                                                                | Fixed in this revision: "Migration order".                                                                                                                                                                  |
| N1  | Cost: Namek computes the dirt field per pixel; explicit gradients cost more on some GPUs. Put device timing in the evidence.                                                                                                                                         | Fixed in this revision: Assumptions (Cost) and the device comparison with frame times. The measurement itself is open until implementation.                                                                 |
| N2  | Speculative gradients at silhouettes are defined but meaningless.                                                                                                                                                                                                    | Fixed in this revision: Assumptions (Silhouettes).                                                                                                                                                          |
| N3  | ANGLE on D3D (FXC) may benefit.                                                                                                                                                                                                                                      | Fixed in this revision: Assumptions (ANGLE and FXC), marked not measured.                                                                                                                                   |
| N4  | Line numbers off by one: 61 and 66; 3290-3291, 3324-3325, 3331-3332.                                                                                                                                                                                                 | Fixed in this revision: re-measured with `compile()` on `79c76d48`.                                                                                                                                         |
| N5  | Say whether a helper is inlined or receives the gradients as parameters.                                                                                                                                                                                             | Fixed in this revision: specialization with gradient parameters is the method; inlining is the fallback. The example shows `sharp_grad` and `wide_grad`.                                                    |

Findings for the owner: S1 and B3 were decided by the owner (decision 2), and the Rule 1.4 item
of S3 was decided by the owner (decision 6). None is open. Open until implementation: the
measurements of N1 and of the equality assumption.

### Follow-up review record

| Field             | Record                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Reviewer          | A Claude Code agent that did not write the proposal.                                                                        |
| Date              | 2026-11-09.                                                                                                                 |
| Revision reviewed | `f61a44e4` (the owner's decisions 3 to 6, the Rule 1.4 amendment, the warning release).                                     |
| Verdict           | Not ready.                                                                                                                  |
| This revision     | Answers each finding below, with decision 5 changed by the owner; measured on `main` at `c8fe704f`. Not yet reviewed again. |

The IDs are the reviewer's.

| ID  | Finding                                                                                                                                                                                                                                                                                                       | Status and answer                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Rule against table timing: the Rule 1.4 amendment landed with the warning release while the coverage rows stayed `typed` and `gap` until the refusing release, so the rule and the table disagreed for a release.                                                                                             | Closed. With no warning release (decision 5, changed), the amendment, the two rows as `refused` and the `TS8028` refusal land together in the implementing change ("Rule 1.4, amended", "Migration order"). No revision of `main` has the two disagree.                                                                                                                       |
| S1  | Rule 1.4's third sentence said the capability "is reached through that rewrite", which reads as a borrowing; the two cells gave different portable spellings; the keyword row's note at `src/core/coverage/wgsl.ts` line 3000 stays false; the line labels mixed `wgsl.ts` and `docs/capability-coverage.md`. | Closed. The third sentence is an explicit exception ("is not borrowed"). Both cells use one portable spelling, _P_. The note at line 3000 is removed. Each row names its `name` line in `wgsl.ts` (2750, 2997) and its rendered line in `docs/capability-coverage.md` (706, 726). Re-measured: 0 defects, 92 tests pass.                                                      |
| S3  | During the warning release a program could carry a filter while the rewrite ran.                                                                                                                                                                                                                              | Closed as moot. The rewrite and the refusal land together, so no program carries a filter while the rewrite runs ("Proposed", after item 8).                                                                                                                                                                                                                                  |
| S4  | `src/compiler/ts/decorated-form.ts` lines 115-117 already give a `TS8028` warning that advises `write the option "{ diagnostic: [...] }"`; a second message would point to the removed option.                                                                                                                | Closed. Item 1 names `decorated-form.ts` and replaces that warning with one refusal that never points to the removed option.                                                                                                                                                                                                                                                  |
| S5  | Items 1, 2 and 7 and the rule and surface edits were split across releases inconsistently.                                                                                                                                                                                                                    | Closed. All land in the one implementing change ("Proposed", "Migration order").                                                                                                                                                                                                                                                                                              |
| S6  | 0131 is accepted (`71887632`, no migration release) and is implemented first; branches "if all three are accepted" and "if only this proposal is accepted" are moot; 0130's head and its dependency on 0132 are stale.                                                                                        | Closed. "Migration order": 0131 first; 0132's implementation deletes `diagnostic-directive.ts`, moves the rest of the options parser to `stage-call.ts`, and `TS8028` says "a stage call takes no options"; 0131 already refuses `{ diagnostic }` on `workgroup_size` in both halves; 0130 (#1094, `5ea5aef2`) waits on 0132's implementation. The moot branches are removed. |
| S7  | `CHANGELOG.md`: one removal entry, and its effect on the version; the bake changes count rows not named in the evidence.                                                                                                                                                                                      | Closed. One entry under `### Removed`; `src/changelog.test.ts` reads it as breaking, so the release bumps the minor. The count rows and their measured values are under "Rule 1.4, amended" and "Required validation evidence".                                                                                                                                               |
| N1  | `subgroup_uniformity` is the other rule `@diagnostic` names.                                                                                                                                                                                                                                                  | Closed. The `@diagnostic` cell's note says the compiler writes that filter only on its own lowering and the uniformity walk refuses an author's subgroup call (`TS8052`).                                                                                                                                                                                                     |
| N2  | Rule 1.4's "Enforced by" should name the cells and their test.                                                                                                                                                                                                                                                | Closed. "the rows' cells in `src/core/coverage/wgsl.ts`, checked by `capability-coverage.test.ts` (Rule 11.18)".                                                                                                                                                                                                                                                              |
| N3  | Once 0130 lands, Rule 1.4's third sentence should cite Rule 1.8 and not repeat its rationale. <!-- doc-refs: skip — Rule 1.8 is the rule 0130 adds -->                                                                                                                                                        | Closed. Stated under "Rule 1.4, amended" and "Rule 1.4 and draft 0130".                                                                                                                                                                                                                                                                                                       |
| N4  | The `{ diagnostic }` option has no `CHANGELOG.md` entry; it came with change 0111.                                                                                                                                                                                                                            | Closed. Stated under "A written filter: refused at once".                                                                                                                                                                                                                                                                                                                     |
| N5  | `CompileTsSourceResult.directives` (`src/__api__/surface.md` line 992) is removed in the implementing change; it is breaking.                                                                                                                                                                                 | Closed. Items 2 and "What it touches" (`exports`, `src/__api__/surface.md`); the minor bump is noted.                                                                                                                                                                                                                                                                         |
| N6  | After 0131, the `TS8028` stage-call text is "a stage call takes no options".                                                                                                                                                                                                                                  | Closed. "A written filter: refused at once", "What it touches" (`codes`) and "Migration order".                                                                                                                                                                                                                                                                               |

Findings for the owner: none open. Decision 5 was changed by the owner, not by a finding.

### Approval and plan record

- **Decision.** Accepted by the owner (Seungup) on 2026-11-09, in the Claude Code session. The
  owner answered "새 부분만 재검토 후 병합 (권장)": merge after a follow-up independent review of
  the parts added after the first review. That review (revision `f61a44e4`) found one blocking
  finding (B1) and others; revision `1ba17624` closes every one, as the follow-up review record
  shows, and the reviewer stated that after those fixes no design question remains. The owner
  cannot approve their own pull request on GitHub, so this go-ahead is the review (`CLAUDE.md`,
  Merging). The merge of #1105 with `status: accepted` records the decision.
- **Approved revision and scope.** This file as merged by #1105: decisions 1 to 6 as recorded
  above (decision 5 as changed to refusal at once), and the rules, surface sections, exports,
  codes and downstream work in the front matter.
- **Evidence read at acceptance.** The independent review records above (revisions `13d254f5`
  and `f61a44e4`, every finding closed) and the coverage measurement on `c8fe704f`.
- **Responsibilities.** Implementation is not yet assigned. Each implementing pull request carries
  `Change: 0132`.
- **Milestones.** One implementing change, after 0131's implementation and before 0130's codemod
  (Migration order). Duration and cost are not estimated.

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
