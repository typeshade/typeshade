---
id: '0059'
title: 'Every capability of WebGPU and of WebGL2 has one status per target, held by a test, so a user never meets "the platform can, TypeShade cannot" without a written rule'
status: accepted
rules:
  - '11.14'
  - '11.15'
  - '11.16'
  - '11.17'
  - '11.18'
  - '13.9'
surface: []
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The WebGPU and WebGL2 concept pages and the "from WGSL" and "from GLSL" pages state the six statuses and link the coverage table; the API reference's runtime-api page names each escape hatch of Rule 11.17 as one; compiler-changes.md records 0059 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's language and host references (plugins/typeshade/skills/typeshade/references/language.md, host.md) gain the six statuses and the list of escape hatches, so the agent answers "can TypeShade do X" from the table; compiler-changes.md records 0059 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names rules, an appendix, a script, a fixture and tests that do not exist yet, and files in downstream repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0059`, `status: accepted`. The front matter is the lifecycle authority. The owner approved the proposal in the conversation on 2026-10-12, Asia/Seoul ("머지승인", merge approved), on the revision of pull request #568 at that time; the merge of #568 is the acceptance record. `0058` (`changes/0058-fuse-kernel-chain.md`) was accepted on `main` at `d7c3bc09` (pull request #567, 2026-10-12) after this draft was written, so this draft takes `0059`. Proposal 0058 claims Rule 11.13, so this draft claims Rules 11.14 to 11.18 (Rule 3.7: a claimed number is never reused, and a gap stays a gap). |
| Date and attribution          | Written 2026-10-12, Asia/Seoul. The date is the authoring context, not an approval. A coding agent drafted it at the owner's request in a Claude Code session. The request text set the goal, the six statuses, the five rules and the three open decisions. Attribution is not approval.                                                                                                                                                                                                                                                                                                                                       |
| Applicability / Effectivity   | `docs/language-design.md` §11 (five new rules), Rule 13.9 (one clause added), a new Appendix C; a new generated document `docs/capability-coverage.md` and its bake script `scripts/bake-capability-coverage.ts`; a new fixture `src/core/spec-conformance/fixtures/glsl-es300-names.json`; a new test `src/core/spec-conformance/capability-coverage.test.ts`. The compiler, the writers, the runtime and the oracle change nothing under this proposal. Release version unassigned.                                                                                                                                           |
| Review baseline               | `origin/main` at `031c040c9476c734d4963c485ed8cb49d187d873` (2026-10-12 14:55 +0900). `@webgpu/types` 0.1.74 (installed from the range `^0.1.69`; the tree has no lockfile). TypeScript 5.6.3 (`devDependencies`, exact). `src/core/spec-conformance/fixtures/wgsl-names.json` from gpuweb/gpuweb `358eebc8e7bf2d6efa41a4b8b3fbc3a715288204`. typeshade/radiance read at its `main` (`docs/design/0006-compiler-boundary.md`, `docs/design/0011-gaussian-splatting.md`, `docs/typeshade-feedback.md`). X-GIS/x-gis was outside the session's repository scope and was not read.                                                 |
| Review and revision authority | [PR #568](https://github.com/typeshade/typeshade/pull/568), opened as a draft on 2026-10-12. Git records the revisions. The pull request's review and merge will record the decision. This document does not name the hash of the commit that will contain it. A new proposal merges only when the owner says "merge" in the conversation (`CLAUDE.md`, Merging).                                                                                                                                                                                                                                                               |

## What changes

The goal is one sentence. A user of TypeShade must never meet "WebGPU can do this but TypeShade
cannot" or "WebGL2 can do this but TypeShade cannot" unless a written rule gives the reason.

This proposal changes the rules first. The compiler changes nothing until the proposal is
accepted. After acceptance, step 3 generates the table, adds the completeness test, files one
issue per gap and implements the gaps in priority order.

### The statuses

Each capability of each platform has exactly one status per target. The two targets are the
WebGPU tier (the WGSL writer, the call layer of Rules 8.21 to 8.24 and the WebGPU tier of the
program runtime, Rule 11.11) and the WebGL2 tier (the GLSL ES 3.00 writer, the WebGL2 tier of the
call layer and of the program runtime, change 0054).

| Status    | Meaning                                                                                                                                                                                                          | The row must name                                                |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `typed`   | A language spelling or a program-runtime surface reaches the capability, and a test reads it.                                                                                                                    | The test, for each target where the row is `typed` (Rule 11.18). |
| `raw`     | A documented escape hatch reaches the platform object, with no change to the shader.                                                                                                                             | The escape hatch, from the list of Rule 11.17.                   |
| `refused` | A rule refuses it, and the refusal names the portable spelling where one exists.                                                                                                                                 | The rule number and the portable spelling.                       |
| `planned` | A proposal in `changes/` with `status: draft` or `accepted` names it.                                                                                                                                            | The proposal id.                                                 |
| `gap`     | None of the above.                                                                                                                                                                                               | The issue, once one is filed (step 3).                           |
| `n/a`     | The platform has no such capability on this target, or the capability has no meaning in a program (a debugging aid, an implementation hint, an introspection the manifest replaces). Used with a written reason. | The reason.                                                      |

A roadmap row or a §14 row is not a proposal. A capability that only such a row names is a `gap`
whose reason cell cites the row (open decision 4).

### The sources

The table is built from machine-readable sources and never from memory:

| Platform     | Source                                                                                                                                                                                                                                                                                         | Rows                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| WebGPU host  | `node_modules/@webgpu/types/dist/index.d.ts`, at the version `package.json` pins (open decision 3).                                                                                                                                                                                            | One row per method and per descriptor field of each interface; one row per enum type (a large enum is one grouped row).             |
| WGSL         | `src/core/spec-conformance/fixtures/wgsl-names.json` (the commit `docs/language-design.md` pins).                                                                                                                                                                                              | One row per built-in function, predeclared type, type generator, built-in value, attribute, keyword, enable and language extension. |
| WebGL2 host  | `node_modules/typescript/lib/lib.dom.d.ts` of the pinned TypeScript: `WebGL2RenderingContextBase`, `WebGL2RenderingContextOverloads`, `WebGLRenderingContextBase`, `WebGLContextAttributes`, and the extension interfaces that apply to WebGL2.                                                | One row per capability, not per `GLenum`; each row lists the members it covers, so every member is covered by exactly one row.      |
| GLSL ES 3.00 | A new fixture `src/core/spec-conformance/fixtures/glsl-es300-names.json`: the built-in functions of section 8 (today `GLSL_ES300_BUILTIN_FUNCTIONS` in `src/core/reserved-words.ts`), the built-in variables of section 7, the types of section 4.1 and the qualifiers of sections 4.3 to 4.7. | One row per function, variable, type family and qualifier.                                                                          |

### The rules

Five rules join §11 of `docs/language-design.md`, numbered 11.14 to 11.18, and one clause joins
Rule 13.9. The proposed text:

**Rule 11.14 (new).** Every capability of WebGPU and of WebGL2, as the sources of Appendix C
enumerate them, must have exactly one status per target in the coverage table: `typed`, `raw`,
`refused`, `planned`, `gap` or `n/a`. A capability with no row, or with two statuses on one
target, is a defect of the table.

- Rationale: the goal is a sentence about every capability, so the table must cover every one,
  and one status per target is what makes the sentence checkable.
- Derives from: the request that opened this proposal; Rule 1.2; Rule 2.1.
- Enforced by: `src/core/spec-conformance/capability-coverage.test.ts` (Rule 11.15).

**Rule 11.15 (new).** A test must fail when a member of a source has no row, and when a row
names a member that no source has. The sources are pinned by version, and a version bump re-bakes
the table as a reviewed diff (Rule 11.4 applies: a re-bake is read, not rubber-stamped).

- Rationale: a table nothing holds to its sources drifts the day a package updates; the API
  surface already works this way (`src/__api__/surface.md`, Rule 11.6).
- Derives from: Rule 11.6; `scripts/bake-wgsl-names.ts` and `surface-names.test.ts`, which hold
  the WGSL names to the specification the same way.
- Enforced by: `capability-coverage.test.ts`, which reads the four sources at their pinned
  versions and the classification, and fails on an unclaimed member and on a stray row.

**Rule 11.16 (new).** A capability that only WebGL2 has must enter the surface only as a row of
§9.3 (an author-facing name) or as a capability of §10 (a host feature a module declares or
derives); it must not become a language construct, a built-in value or a type by another route.
Where neither is justified, its row is `n/a` with the reason, and the reason is a rule.

- Rationale: Rule 1.2 makes GLSL ES 3.00 a target and not the definition of a construct, and
  Rule 2.1 gives an author-facing name three sources, none of which is WebGL2; a WebGL2-only
  capability therefore needs the one door the rules leave open, and a row that says `n/a`
  without a rule is the "TypeShade cannot" this proposal exists to end.
- Derives from: Rule 1.2; Rule 2.1; Rule 9.6; Rule 10.4.
- Enforced by: `capability-coverage.test.ts`, which fails on a WebGL2-flagged row whose WebGL2
  status is `typed` with no §9.3 row and no §10 capability behind it, and on one whose status is
  `n/a` with no rule number in its reason.

**Rule 11.17 (new).** A `raw` row must name one documented escape hatch, and the escape hatches
are exactly these: `Frame.encoder`, `RenderPass.raw`, `Texture.texture`, `Sampler.sampler`,
`Runtime.device`, `createRuntime({ device })`, a host `GPUBuffer`, `GPUTexture`,
`GPUTextureView`, `GPUSampler`, `WebGLBuffer`, `WebGLTexture` or `WebGLSampler` passed as a
binding, a target or a geometry buffer, `RenderPipeline.draw(pass, …)` and
`ComputePipeline.dispatch(target, …)` into the host's own encoders, and `Runtime.submit(…encoders)`.
Each is documented in its JSDoc as an escape hatch. Removing one, or narrowing what it accepts,
is a breaking change (Rule 13.9).

- Rationale: an escape hatch is the promise that a capability the runtime does not spell is still
  reachable without leaving the runtime; a host builds on it, so it is part of the public surface
  and not a convenience that may go.
- Derives from: Rule 11.11; `src/runtime/runtime.ts` (`Frame.encoder`, `RenderPass.raw`,
  `Runtime.device`), `src/runtime/resources.ts` (`Texture.texture`, `Sampler.sampler`),
  `src/runtime/program.ts` (the host objects a binding and a `Geometry` take); Rule 13.9.
- Enforced by: `capability-coverage.test.ts`, which fails on a `raw` row that names nothing in
  the list, and `src/api-surface.test.ts`, which already fails on a removed export.

**Rule 11.18 (new).** A `typed` row must name the test that verifies the capability on each
target where it is `typed`; the test must read both halves where the capability is a language
spelling (Rule 12.7). A `refused` row must name the rule and the portable spelling. A `planned`
row must name its proposal. A `gap` row must name its issue once one is filed. An `n/a` row must
name its reason.

- Rationale: a status is a claim, and a claim with no evidence is the kind of row Appendix B
  exists to list.
- Derives from: Rule 12.5; Rule 12.7; Appendix B's shape.
- Enforced by: `capability-coverage.test.ts`, which fails on a `typed` row whose test file does
  not exist, on a `refused` row with no `Rule N.M`, and on a `planned` row whose proposal file
  does not exist or is `withdrawn`.

**Rule 13.9 (amended).** The list of what is breaking gains one clause: "an escape hatch Rule
11.17 names is removed, or what it accepts is narrowed".

### Appendix C (new): capability coverage

Appendix C holds the statuses, the sources, the counts per status and target, and the list of
the capabilities flagged as WebGL2-only, each with the door it may enter by. The table itself is
`docs/capability-coverage.md`, generated (open decision 2). Appendix C says where the table is and
how it is baked, as Rule 11.6 does for `src/__api__/surface.md`.

The shape of a row, as the inventory of step 1 wrote it:

| Kind                | Name                                       | Source               | Evidence                               | WebGPU                              | WebGL2                                                  |
| ------------------- | ------------------------------------------ | -------------------- | -------------------------------------- | ----------------------------------- | ------------------------------------------------------- |
| WebGPU descriptor   | `GPUDepthStencilState.stencilFront`        | `index.d.ts:911`     | `src/runtime/program.ts:67-104`        | gap                                 | gap                                                     |
| WebGPU method       | `GPUCommandEncoder.copyTextureToTexture()` | `index.d.ts:2373`    | `src/runtime/runtime.ts:109-112`       | raw (`Frame.encoder`)               | gap                                                     |
| WGSL built-in value | `sample_mask`                              | `wgsl-names.json`    | `src/compiler/ts/builtin-check.ts:334` | typed (`builtin-values.test.ts`)    | gap (`OES_sample_variables`; fails closed by Rule 10.3) |
| WGSL type generator | `texture_cube_array`                       | `wgsl-names.json`    | `docs/language-design.md:1437`         | typed (`texture-wgsl-only.test.ts`) | refused (Rule 10.5, #135)                               |
| WGSL language ext.  | `swizzle_assignment`                       | `wgsl-names.json`    | `TS8018` (probe)                       | gap                                 | gap                                                     |
| GLSL built-in       | `gl_PointSize`                             | GLSL ES 3.00.6 §7.1  | `TS8024` (probe)                       | n/a (WebGPU draws one-pixel points) | gap (WebGL2-only: a §9.3 row or a §10 capability)       |
| WebGL2 capability   | transform feedback                         | `lib.dom.d.ts:23554` | change 0054                            | n/a (no WebGPU form)                | n/a (a compute entry is the portable form, Rule 11.8)   |

### What does not change

No rule of §1 to §10 changes. No diagnostic, export, surface section or example changes. The
compiler, the writers, the runtime and the oracle emit and compute what they emit and compute
today. A gap row changes nothing by itself; step 3 files its issue, and each fix is its own change
under this proposal or under a proposal of its own where the fix touches a rule.

## Why

### The evidence: the inventory of step 1

The inventory was built on 2026-10-12 from the four sources above, on `main` at `031c040c`,
with 47 `compile()` probes and 20 language-service probes (bun 1.4.2) over the doubtful rows.
Both halves agreed on every probe. The counts, one row counted once per target:

| Table                         | Target | typed | raw | refused | planned | gap | n/a | rows |
| ----------------------------- | ------ | ----- | --- | ------- | ------- | --- | --- | ---- |
| A. WebGPU host API (members)  | WebGPU | 196   | 63  | 0       | 53      | 79  | 26  | 417  |
| A. WebGPU host API (members)  | WebGL2 | 178   | 14  | 3       | 53      | 50  | 119 | 417  |
| B. WGSL                       | WebGPU | 225   | 0   | 20      | 0       | 47  | 6   | 298  |
| B. WGSL                       | WebGL2 | 192   | 0   | 21      | 0       | 19  | 66  | 298  |
| C. GLSL ES 3.00.6             | WebGPU | 97    | 0   | 1       | 1       | 16  | 10  | 125  |
| C. GLSL ES 3.00.6             | WebGL2 | 97    | 0   | 2       | 1       | 17  | 8   | 125  |
| D. WebGL2 host (capabilities) | WebGPU | 30    | 3   | 1       | 1       | 13  | 11  | 59   |
| D. WebGL2 host (capabilities) | WebGL2 | 22    | 5   | 2       | 1       | 22  | 7   | 59   |
| all                           | WebGPU | 548   | 66  | 22      | 55      | 155 | 53  | 899  |
| all                           | WebGL2 | 489   | 19  | 28      | 55      | 108 | 200 | 899  |

Table A has one row per member of `@webgpu/types` and one per enum type; table D has one row
per capability, so the two are not comparable. The full tables, with a `file:line` for every
claim, are the inventory file of the session (`inventory.md`, delivered to the owner on
2026-10-12). They are not in this proposal because the table is generated at step 3 (Rule 11.15).

### What the inventory found

1. The statuses `typed` and `raw` cover 68 percent of the WebGPU column and 56 percent of the
   WebGL2 column. The rest is 55 `planned` rows (changes 0048, 0050, 0051), 155 and 108 `gap`
   rows, 22 and 28 `refused` rows, and the `n/a` rows.
2. Thirteen refusals have a written reason but no rule number: `do…while`, a labelled statement,
   `const_assert`, `@must_use`, `@subgroup_size`, the module-level `diagnostic` directive,
   `global_invocation_index` and `workgroup_index`, `uniform_buffer_standard_layout`, the GLSL
   precision qualifiers, `texture_storage_2d_array` on the WebGL2 runtime, and the three types
   Appendix A lists as "not spelled" (`texture_external`, `texture_storage_1d`,
   `texture_storage_3d`). Each is right in behaviour and wrong under the goal: the reason is in
   the surface document, a comment or a message, and not in a rule.
3. Nine WGSL features fail closed on the GLSL writer by Rule 10.3 with no deferral that names
   them, although a WebGL2 extension or plain arithmetic would lower each: `sample_index` and
   `sample_mask` (`OES_sample_variables`), `@interpolate("linear")` and `sample`
   (`NV_shader_noperspective_interpolation`, `OES_shader_multisample_interpolation`),
   `clip_distances` (`WEBGL_clip_cull_distance`), `@blend_src` (`WEBGL_blend_func_extended`),
   targets that blend apart (`OES_draw_buffers_indexed`), an `rgba8snorm` storage target
   (`EXT_render_snorm`) and the packed 4x8 family (bit arithmetic). Only the family #130 to #139
   has a written deferral (Rule 10.5).
4. Ten capabilities exist only on WebGL2: `gl_PointSize` above one pixel, `gl_PointCoord`,
   `lineWidth`, `LINE_LOOP` and `TRIANGLE_FAN`, the 3-component and `LUMINANCE`/`ALPHA`
   formats, `UNPACK_COLORSPACE_CONVERSION_WEBGL`, `preserveDrawingBuffer`, transform feedback,
   `OVR_multiview2` and `EXT_texture_mirror_clamp_to_edge`. Today `point_size` is `TS8024` with
   no rule, and `multiview` is a declarable capability nothing can author
   (`src/core/backends/capability-reachability.test.ts`). Rule 11.16 gives each its door.
5. The largest groups of gaps both platforms can do are render state (stencil, depth bias,
   scissor, viewport, blend constant, alpha-to-coverage, store ops), vertex input (30 of 42
   `GPUVertexFormat` members, per-instance step, several buffers, first and base offsets),
   multisample resolve, queries and timestamps (#542), indirect draw and dispatch (#540),
   textures (layer read, layered targets, cube textures from `rt.texture()`, compressed formats,
   copies, sampler LOD and anisotropy), bindings (host-placed groups, dynamic offsets, a
   sub-range), device loss, and five WGSL spellings the compiler refuses while both targets have
   them (`v.xy = …`, `modf`, the offset overloads of `textureSample*`, `textureNumLevels`,
   `textureSampleBaseClampToEdge`).
6. Two claims need a measurement at step 3 (Rule 13.3): the provoking vertex of a flat varying
   on GLSL ES 3.00 (last vertex) against WGSL's `@interpolate(flat, first)`, and whether Rule
   8.25's storage and workgroup pointer parameters need `requires unrestricted_pointer_parameters;`,
   which `reflect()` does not report.

### Why rules, and why before the compiler

A gap fixed today is a gap reopened by the next package update, and a refusal written as a
message is a refusal nobody can cite. The rules make the table the contract: every member of
every source has a row, every row has evidence, and a change to a source is a diff a reviewer
reads. The compiler work of step 3 then has a definition of done per row instead of a feeling.

### Alternatives considered

- Keep the capability witness table (`capability-reachability.test.ts`) as the only coverage
  gate. It covers the eighteen capabilities of §10 and nothing of the host APIs. Rejected as
  too narrow.
- Hand-write the table into Appendix C. At 899 rows it would be edited by hand and would drift;
  the API surface shows the generated form works (Rule 11.6). Rejected; open decision 2.
- Count a roadmap or §14 row as `planned`. It would hide 32 subgroup and pointer rows under a
  status with no owner. Rejected; open decision 4.
- Let an escape hatch stay an undocumented convenience. A host that builds on it is then broken
  by a patch release (Rule 13.9). Rejected; Rule 11.17.

### Unresolved decisions

Each decision names a recommendation. The owner decides at acceptance.

1. **Is "no gap rows" a 1.0 criterion?** Recommendation: yes for the WebGPU column; every row is
   `typed`, `raw`, `refused`, `planned` with an accepted proposal, or `n/a` with a rule, before
   `1.0.0` (roadmap item 24 freezes the surface and a frozen surface should not hide a gap). Yes
   for the WebGL2 column too, with one difference: a deferral written as Rule 10.5 writes it
   counts as `refused`, so 1.0 requires a written reason per row and not a lowering per row.
   Basis: the counts above (155 and 108 gap rows) and the work order of step 3; no duration
   estimate is established.
2. **Does the table live in an appendix or in a generated file?** Recommendation: a generated
   file, `docs/capability-coverage.md`, baked by `scripts/bake-capability-coverage.ts` from a
   hand-maintained classification (`src/core/coverage/`) and the four sources, held by the test
   of Rule 11.15, with Appendix C holding the rules, the statuses, the counts and the
   WebGL2-only list. Basis: 899 rows; the precedent of `src/__api__/surface.md`.
3. **Which pinned versions of `@webgpu/types` and TypeScript does the table use?**
   Recommendation: `@webgpu/types` pinned exactly in `devDependencies` (today the range
   `^0.1.69` resolves to 0.1.74, and the tree has no lockfile, so two installs can differ); a
   bump is a pull request that re-bakes the table and reads the diff (Rule 11.4). TypeScript:
   the `devDependencies` version (5.6.3), whose `lib.dom.d.ts` the test reads; the CI matrix legs
   on other TypeScript versions skip the test, since their `lib.dom.d.ts` differs. The WebGL
   extension list beyond `lib.dom.d.ts` is baked into a fixture from the Khronos registry at
   bake time with the fetch date recorded; the registry answered HTTP 403 twice on 2026-10-12,
   so that fixture is owed at step 3.
4. **Does a roadmap row or a §14 row count as `planned`?** Recommendation: no. `planned` names a
   proposal id; a roadmap or §14 row is cited in the reason cell of a `gap` row.
5. **Do `Frame.encoder` and `RenderPass.raw` stay refused on the WebGL2 tier?** Recommendation:
   yes; `Runtime.device` is the WebGL2 context and is that tier's escape hatch (Rule 11.17), and
   the two encoders have no WebGL2 meaning (Rule 11.11).
6. **Order of the gap work at step 3.** Recommendation: the order of the gap register of the
   inventory: render state, vertex input, multisampling, queries, indirect, textures, bindings,
   device, the five WGSL spellings, the nine GLSL lowerings, the WebGL2-only doors, the rules for
   the thirteen rule-less refusals. The evidence is radiance's records 0006 and 0011 and the
   issues #535 to #543; X-GIS/x-gis usage is owed at step 3 and may reorder it. Usage is
   evidence for the order and not the definition of what is needed.

## What it touches

- Rules 11.14 to 11.18: new, as written above.
- Rule 13.9: one clause added to the list of breaking changes.
- Appendix C: new.
- `surface: []`: no numbered section of `docs/use-typeshade-surface.md` changes. Step 3 may open
  a section for the coverage table's reading if the site needs one; that is a later amendment.
- Exports, codes, examples: none. The escape hatches of Rule 11.17 exist today
  (`src/__api__/surface.md`, `./runtime`); the rule names them and adds nothing.
- Validation evidence the proposal will require: `capability-coverage.test.ts` green on the
  baked table; `bun run build`, `bun run test` and the traceability check (change 0055, a
  documents-only change for the rules; the test and the bake are code and run the unit suite);
  `bun run reqs:sync` and `doorstop -C` after the rules land.

### Draft impact estimate

- Technical work (step 3, after acceptance): the bake script, the GLSL fixture, the
  classification files, the test, Appendix C and the five rules; then one issue per gap row and
  the fixes in order. Known: the classification of 899 rows exists in the inventory and moves
  into the tree as data. Unknown: the duration of the fixes; no estimate is established.
- Compatibility: none at acceptance. A later fix that turns a `gap` into `typed` adds; one that
  turns a refusal into a rule changes a message (Rule 12.5, a surface change with a CHANGELOG
  entry); none removes.
- Dependencies: an exact pin of `@webgpu/types` (open decision 3); the Khronos registry for the
  extension fixture.
- Tools: `bun`, the existing `scripts/doc-refs.ts`, `scripts/doc-impact.ts`, Doorstop.
- Downstream: the two repositories above, when their pins move past the implementation.
- Decisions to resolve before acceptance: the six above.

### Approval and plan record

- Decision: the owner approved the proposal as drafted, in the conversation on 2026-10-12,
  Asia/Seoul ("머지승인", merge approved). Pull request #568 records the review and the merge.
- Approved revision and scope: this file at the merge of #568; the five rules, the clause of
  Rule 13.9, Appendix C and the generated table, as "What changes" states them.
- The six open decisions were not answered one by one. The recommendation of each stands as
  the decision of record until the owner says otherwise; a change to one is an amendment of
  this file, as 0056's amendments were made.
- Responsibilities: a coding agent in a Claude Code session implements step 3 at the owner's
  direction; the owner decides each "merge" of a step that touches a rule, a public export or a
  surface section, and reviews each bug-fix step as `CLAUDE.md` (Merging) allows.
- Milestones: step 3 in the order of open decision 6, each step its own pull request with
  `Change: 0059`. No date is agreed. No duration or cost estimate is established.
- Required validation: `capability-coverage.test.ts` green on the baked table; `bun run build`,
  `bun run test` and the traceability check on every step; the GPU gates on a step that changes
  an emit; `bun run reqs:sync` and `doorstop -C` after the rules land; the document audit of
  Appendix C against the tree.

### Configuration and validation record

This record does not yet apply. Delivery will require: the implementing pull requests, the
delivered configuration (the pinned versions of the four sources, the commit of the baked table),
the test's result on that configuration, the document audit (Appendix C, the rules and the
generated table agree with the tree), and each deviation with its disposition.

## What it owes downstream

- `typeshade.github.io`: the WebGPU and WebGL2 concept pages and the "from WGSL" and "from GLSL"
  pages gain the six statuses and a link to the coverage table; the runtime-api reference marks
  each escape hatch of Rule 11.17; `compiler-changes.md` records 0059 when the pin moves.
- `vscode-typeshade`: the skill's language and host references gain the statuses and the escape
  hatches, so the agent answers "can TypeShade do X" from the table; `compiler-changes.md`
  records 0059 when the pin moves.
- `typeshade/radiance` (not a downstream of `scripts/changes.ts`, named for the record): its
  record 0006 items 1, 2, 4, 5, 8 and 10 and its needs C4 to C7 are rows of the table; the rows
  cite the issues, and the engine's feedback log is evidence for the order of step 3.

In the draft these are expected work. At acceptance the responsibilities are recorded here.
