---
id: '0070'
title: 'Every name TypeScript accepts compiles on both targets, and the host still calls each declaration by the name the author wrote'
status: accepted
rules:
- '3.2'
- '3.3'
- '3.4'
- '9.5'
- '11.10'
- '12.3'
surface:
- 10
- 48
- 52
- 62
- 68
- 69
exports:
- reflect
- packModule
- BindEntry
- EntryInfo
- EntryIoField
- FieldLayout
- OverrideInfo
- StructLayout
- VertexAttr
- Pack
- PackBinding
- PackEntry
exports-removed: []
codes: []
examples: []
downstream:
- repo: typeshade.github.io
  what: The Korean guide pages that name reserved words (content/guide/ko/functions-and-entry-points.md and content/guide/ko/production-emit.md), the passage in `compiler-changes.md` that follows surface section 62, the error-code entry for TS8068 in src/lib/error-codes.ts (its trigger is a struct field named `half`, which compiles after this change), and the reflection examples that show a binding or an entry by its name.
- repo: vscode-typeshade
  what: The TS8068 rows of references/diagnostics.md and the skill's language and examples references, docs/agents.md (the `smooth` remark that names TS8068), and docs/design.md (the code list that names `TS8068`, at line 600 on `origin/main` on 2026-10-13). The plugin reads reflection through the host contract, so its host references follow the authored-name and emitted-name record.
---

<!-- doc-refs: skip-file — the proposal names src/compiler/ts/reserved-names.ts, which its implementation removes -->

**Document control**

| Field                       | Record                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document                    | Proposal 0070. This file is the proposal source and the approved design of the change. It has status `accepted`.                                                                                                                                                                                                                                                                                                                               |
| Revision context            | Drafted 2026-10-13, Asia/Seoul. This date is the authoring context. It is not an approval date. The owner approved the direction on 2026-10-13 (Asia/Seoul) and decided D1 to D5 on 2026-10-13 (Asia/Seoul). An amendment of 2026-10-13 adds `emittedGlsl` to D3. See Approval and plan record.                                                                                                                                                |
| Request source              | The repository owner, Seungup, stated the principle quoted below in the project conversation on 2026-10-13. No GitHub issue is recorded for this draft.                                                                                                                                                                                                                                                                                        |
| Attribution                 | Drafted by a Claude Code agent at the owner's request. Git authorship is not an approval signature.                                                                                                                                                                                                                                                                                                                                            |
| Current lifecycle state     | `accepted`, by the owner's decision of 2026-10-13 (see Approval and plan record). The merge of PR #665 records the acceptance. No implementation exists.                                                                                                                                                                                                                                                                                       |
| Applicability / effectivity | The name checks of the front end (`src/compiler/ts/reserved-names.ts`), the backend spellings of `src/core/passes/variable-names.ts` and `src/core/backends/glsl-sanitize.ts`, the reflection and manifest records (`src/core/reflect.ts`, `src/core/manifest-types.ts`, `src/core/manifest.ts`), the runtime that binds by name (`src/runtime/`), and the editor, which reads the same front end (Rule 12.7). No release version is assigned. |
| Review baseline             | `origin/main` at `f9aabe7fe4b8cfe014a3ff3ad6b0807b9f773f8c` (commit "Amend proposal 0067: FuseReport reports one workgroup shape per dispatch (D9) (#663)"). Proposal ids 0000 to 0069 were read on `origin/main` and on every remote branch on 2026-10-13. Id 0070 was not in use on any of them. Pull request #664 merged to `main` after this baseline, as `0d8e2bfc` (see D5).                                                             |
| Proposal review             | [PR #665](https://github.com/typeshade/typeshade/pull/665), the proposal-only pull request.                                                                                                                                                                                                                                                                                                                                                    |
| Revision authority          | Git records the revisions of this file. The review and merge of PR #665 record the decision.                                                                                                                                                                                                                                                                                                                                                   |

**The owner's principle.** The owner stated, on 2026-10-13:

> In TypeShade everything should just work without reserved words. It is the compiler's job; it is wrong that a developer has to care about it at all.

This proposal applies that principle to every declaration kind. The rules below follow from it.

## What changes

**Before.** Rule 3.2 lets a local, a parameter, a module constant and a module variable use any TypeScript identifier. The backend gives a name its target cannot spell a fresh spelling. Every other declaration keeps its emitted name. Rule 3.3 keeps a WGSL reserved word on any other declaration as an error. Rule 3.4 keeps a GLSL ES 3.00 reserved word on a struct, a field, an override or a binding as a warning, and the GLSL emit fails closed. Rule 3.5 keeps generated names clear of reserved words. The compiler reports these cases with `TS8068` (surface section 62). An author who writes `fn shared()` or `struct Vertex { half: vec2f }` receives a refusal, and must rename the declaration.

**After.** Every declaration kind receives a fresh emitted spelling whenever its authored name is one the target cannot spell. The host keeps the authored name. The compiler records each pair of authored name and emitted name, and the runtime uses that record.

The declaration kinds are:

1. locals and parameters (already done by `sanitizeVariableNames`);
2. module constants and module variables;
3. functions, including a function whose name a target predeclares (Rule 9.5 already does this for that case);
4. entry points;
5. bindings (`declare const`);
6. overrides;
7. structs and classes, and their flattened names (`Owner_member`);
8. struct fields and class fields;
9. enum members, if an enum member reaches emitted text (decision D4 below);
10. any other declaration the implementation finds that reaches emitted text. The implementation lists each one in its record before it merges.

The names a target cannot spell are:

- a WGSL keyword or reserved word (the set `WGSL_RESERVED` in `src/core/reserved-words.ts`);
- a name containing `$`;
- a bare `_`;
- a name beginning with `__`;
- a GLSL ES 3.00 reserved word (the set `GLSL_ES300_RESERVED`);
- a name beginning with `gl_` on GLSL;
- a name containing `__` on GLSL;
- a spelling that the GLSL writer renames although ES 3.00 does not reserve it: `buffer`, `shared`, `packed`, `texture`, `sampler` and `main` (`GLSL_RESERVED` in `src/core/backends/glsl-sanitize.ts`);
- a name a target predeclares, when the declaration hides that predeclared name for the module's WGSL.

**Rewritten rules.** The text below is the proposed text. It replaces the text of each rule, and the rule keeps its number.

**Rule 3.2.** Every local, parameter, module constant, module variable, function, entry point, binding, override, struct, class, field and enum member may use any identifier TypeScript permits. Each target spells a name it cannot spell with a fresh emitted name, and rewrites every reference to it. Function parameters and body locals keep their lexical scope: they may shadow a module value, and a closure resolves the nearest declaration. Duplicate declarations in the same scope remain errors. The authored IR, CPU oracle, diagnostics, debugger and host contract keep the authored name. The emitted name of each declaration is recorded beside its authored name (Rule 11.10).

**Rule 3.3.** A WGSL keyword or reserved word, on any declaration, receives a fresh WGSL spelling. A host names a declaration by its authored name, and the runtime translates that name to the emitted name through the record of Rule 11.10.

**Rule 3.4.** A GLSL ES 3.00 reserved word, a name beginning with `gl_`, and a name containing `__`, on any declaration, receives a fresh GLSL spelling. The record names the pair as Rule 3.3 does. No diagnostic refuses a name for a target. A module that a target cannot emit for another reason keeps the refusal that reason gives.

**Rule 3.5.** Unchanged. A name the compiler generates must not be a keyword or reserved word of either target.

**Rule 9.5.** The sentence "An entry point keeps the name written (Rule 3.2)" becomes: "An entry point that would hide a predeclared name the module's WGSL uses receives a fresh emitted name; the record names the pair (Rule 3.2)."

**Rule 11.10.** The manifest carries, for each binding, struct, field, override, entry and vertex or varying name the host uses, its authored name and its emitted name. The schema of the manifest changes. Decision D2 below sets the schema version. The text "(`schema`, 1)" and the sentence "Optional override metadata leaves existing schema-1 manifests valid" change with it.

**TS8068.** Decision D1 below sets what TS8068 becomes. The recommended text is in that decision.

**Surface section 62.** The section changes from "a name a target reserves is refused" to "a name a target reserves is spelled differently on that target". The GLSL warning, the WGSL error and the `TS8068` examples for `half` and for a field named by a reserved word are removed. Section 62 holds no strict-mode text. The strict-mode text for `eval` and `arguments` is in surface section 28, and it stays (D1).

**Surface section 48.** The subsection "A reserved word is still the author's problem" describes a local named `shared` as a refusal. That text becomes false, and the subsection is removed.

**Surface section 10.** The sentence "An entry point keeps its name, since the host creates the pipeline by it, so an entry named like something WGSL predeclares is refused with `TS8068`" becomes: "An entry named like something WGSL predeclares is emitted under a fresh name, and the host still creates the pipeline by the name written (D7)."

**Surface section 52.** The sentence "§62's reserved-name rule refuses a local named `_`" is removed. A local named `_` is spelled differently on the target, and no rule refuses it.

**Surface section 69.** The example `program.schema; // 1` becomes `// 2` (D2). The sentence "a reader refuses a schema it does not know" stays.

**Surface section 68.** The sentence "An entry point, a binding and an override are never renamed" becomes: "An entry point, a binding and an override keep the name written in the host contract. A target may spell one under a fresh emitted name, which the manifest records."

**Example of the proposed behaviour (illustrative).** The program below is valid after this change. It is refused today.

```ts
"use typeshade";

class Vertex {
  @location(0) half: vec2f; // a field named by a GLSL ES 3.00 reserved word
}

declare const shared: storage<array<f32>, "read_write">; // a WGSL reserved word

@compute([64])
export function fract(@builtin("global_invocation_id") gid: vec3u) {
  shared[gid.x] = 1.0; // an entry named like a WGSL predeclared builtin
}
```

The host calls the entry as `fract(bindings, workgroups)` and binds `shared` by its authored name. The WGSL text names the entry and the binding by their emitted names.

## Why

The principle in the owner's words is the reason. A developer writes TypeScript. The compiler sees the spelling that WGSL and GLSL reject. Today the developer must rename the declaration, and that work has no value to the program. The compiler has the means to do the renaming: it already renames locals, parameters, module constants and module variables (Rule 3.2, `sanitizeVariableNames` in `src/core/passes/variable-names.ts`), and it already renames a helper function that a target predeclares (Rule 9.5, `renamePredeclaredFunctions` in `src/core/passes/rename-predeclared.ts`).

The rules differ by declaration kind today. Three facts show the difference:

- Rule 3.2 names `$`, `_` and `__` as WGSL refusals for a binding, an override, an entry, a struct and a field, while the same spellings are renamed for a local. The check `wgslRefusal` in `src/compiler/ts/reserved-names.ts` applies to the kinds the rule lists.
- Rule 3.3 and Rule 3.4 make a reserved word a permanent refusal on those kinds. The GLSL check `glslRefusal` in the same file applies only when a declaration is one of the verbatim kinds (`GLSL_VERBATIM`).
- The entry point check `reportHiddenPredeclared` in the same file refuses an entry that hides a predeclared name the WGSL uses, while `renamePredeclaredFunctions` renames a helper function in that case.

A name that TypeScript accepts is therefore refused for a backend reason on some kinds and not on others. The author cannot predict which. The change removes the refusal and keeps one rule for every kind.

**Measured facts (2026-10-13).**

- Surface section 62 shows the `TS8068` refusal for a field named `half`. The table in that section records `'half' : Illegal use of reserved word` from ANGLE for a WebGL2 field named `half`.
- `reqs/` and `docs/language-service-api.md` (the `TS8068` row at line 801) already say that a local, a parameter, a module constant and a module variable are not refused for backend words. The documents describe the variable rule. The other kinds are still refused by `reportReservedNames`.
- `TS8068` also carries a second meaning. `strictModeBinding` in `src/compiler/ts/semantic.ts` reports a declaration that binds `eval` or `arguments` under the same code (Rule 2.1). The editor maps TS1215, TS1210 and TS1100 to `TS8068` in `src/language-service/diagnostics.ts` (the entries at lines 1524 to 1541). All three entries describe the strict-mode case. The strict-mode refusal is not about backend reserved words, so the code cannot simply be removed with the reserved-name checks. Decision D1 covers this.
- The GLSL uniform block lookup uses the struct's type name (`src/core/reflect.ts` documents it at line 330 for `getUniformBlockIndex`, and `src/runtime/gl-draw.ts` at line 837 calls it). The sampler uniform lookup uses the binding's name (`src/runtime/gl-draw.ts` at line 848). A struct rename or a binding rename therefore changes a name the WebGL2 host uses. The record of Rule 11.10 must carry both.
- The manifest schema is `PACK_SCHEMA = 1` (`src/core/manifest-types.ts`, line 107). `checkManifest` in `src/runtime/program.ts` (line 262) refuses a manifest whose `schema` is not equal to `PACK_SCHEMA`, so it refuses a schema 2 manifest in a schema 1 runtime.
- No `getAttribLocation` call exists in `src/` on 2026-10-13 (search of `src/`). The WebGL2 vertex inputs are therefore not looked up by name in this tree. The implementation confirms this before the record lists vertex inputs.
- Enum declarations are read as host values (`src/compiler/ts/host-face.ts`, line 1324, `kind: 'enum'`). Whether an enum member reaches emitted text is not verified. Decision D4 covers it.

**Alternatives.**

- **A. Keep the refusals, and document them.** It keeps the current rules. It does not meet the owner's principle.
- **B. Rename every declaration kind, and keep the authored name in the host contract (this proposal).** The compiler does the work. The host sees no change in names. The record of emitted names is the cost, and it is a contract that must be kept.
- **C. Rename every declaration kind, and do not record the emitted names.** The host would have to read the emitted WGSL to find a binding. That breaks the host contract and the reflection consumers. It is rejected.
- **D. Rename only the kinds that the host never names.** The host names entries, bindings, overrides and struct layouts, so this option leaves the refusal in place for the kinds that matter most. It is rejected.

**Assumptions.**

- The fresh-spelling scheme of Rule 3.2 (`name_`, then `name_1`, and the `ts_` prefix for `gl_`) is good enough for every kind.
- A runtime that reads the record by authored name makes the emitted name invisible to a host.
- The reflection consumers (TypeNN, radiance and the site) read names through `reflect()` and the manifest, not through the emitted text. This is checked in the implementation, not here.

## What it touches

- **Rule 3.2:** the rewritten text above. Every declaration kind takes a fresh spelling, and the host record is added.
- **Rule 3.3:** the rewritten text above. The WGSL refusal on other declarations is removed.
- **Rule 3.4:** the rewritten text above. The GLSL warning and the fail-closed emit for a reserved word are replaced by a fresh spelling and a record.
- **Rule 9.5:** the entry point sentence. An entry that hides a predeclared name is renamed in the emit, and the record names the pair.
- **Rule 11.10:** the manifest record of emitted names, and the schema version (D2).
- **Rule 12.3:** the "Enforced by" list only. Its fourth pin, `reports a struct field named half, on the field` in `src/compiler/ts/reserved-names.test.ts`, asserts a `TS8068` warning and `glsl` undefined. Under this change that field takes a fresh GLSL spelling and `glsl` is emitted, so the pin is replaced by the test of that spelling. The rule text is unchanged: other GLSL ES 3.00 shortfalls still warn on a module with a render entry.
- **Rule 3.5:** unchanged.
- **Surface section 10:** the sentence that refuses an entry named like a WGSL predeclared name.
- **Surface section 48:** the subsection about the reserved word as the author's problem is removed.
- **Surface section 52:** the sentence that says section 62 refuses a local named `_`.
- **Surface section 62:** rewritten. TS8068 text changes, with D1.
- **Surface section 68:** the sentence on entry, binding and override names.
- **Surface section 69:** the `program.schema` example (D2).
- **Exports:** `BindEntry`, `EntryInfo`, `EntryIoField`, `FieldLayout`, `OverrideInfo`, `StructLayout`, `VertexAttr`, `Pack`, `PackBinding` and `PackEntry` gain the emitted-name record (`src/__api__/surface.md` lists each). `Pack` also changes its `schema` literal (D2). `reflect()` and `packModule()` keep their signatures.
- **Diagnostics:** `TS8068` changes (D1). Its reserved-name messages retire. Its strict-mode messages remain. No code is added or removed under this proposal unless D1 chooses to move strict mode to a new code.
- **Codes:** none added. `TS8068` keeps its number under the recommended option (D1).
- **Examples:** none. The examples set does not change. `examples/array-length.shade.ts` carries a field named `half` on a compute kernel. Its comment names the refusal rule, so the comment is checked for truth in the implementation.
- **Runtime (`typeshade/runtime`, `src/runtime/`):** the host calls each entry, binding, override and struct by the authored name, and the runtime translates it through the record. The runtime does not change its public calls.
- **CPU oracle and debugger:** keep the authored names. No change except where a test pins a field name.
- **Editor (`src/language-service/`):** stops reporting the reserved-name refusals. It keeps the strict-mode refusals (TS1215, TS1210, TS1100 under TS8068). The two halves agree under Rule 12.7 because both read the same front end.
- **Documents:** `docs/language-design.md` (Rules 3.2, 3.3, 3.4, 9.5, 11.10 and the "Enforced by" lists that name `reserved-names.ts`), `docs/use-typeshade-surface.md` (sections 10, 48, 52, 62, 68 and 69), `docs/language-service-api.md` (the TS8068 row at line 801, and the mentions at lines 353 and 429), `CHANGELOG.md`, and `reqs/` (regenerated by `bun run reqs:sync`).

### Draft impact estimate

**Known technical work (from the reading above).**

- `src/compiler/ts/reserved-names.ts` loses `reportReservedNames` and `reportHiddenPredeclared`, or keeps only the strict-mode part, according to D1.
- `src/core/passes/variable-names.ts` extends its rename to every declaration kind. Its `taken` set must include the names of all kinds (it already includes consts, bindings, overrides, vars, structs, fields, funcs and externs).
- `GLSL_VERBATIM` in `src/compiler/ts/reserved-names.ts` goes with `reportReservedNames`. `src/core/backends/glsl-sanitize.ts` renames locals, parameters and functions only, and its header says that struct fields are left alone. Its rename extends to structs, fields, bindings and overrides for GLSL. The header names the reason for fields: the std140 host offset and the cross-stage varying link.
- `src/core/backends/wgsl.ts` and `src/core/backends/glsl.ts` apply the rename before emit for each kind, and report the pairs to the reflection writer.
- `src/core/reflect.ts` and `src/core/manifest.ts` add the emitted-name record. `src/core/manifest-types.ts` describes it.
- `src/runtime/` (`gl-draw.ts`, `program.ts`, `runtime.ts`) reads the record for each name the host uses.
- The ambient library and the editor need no new declarations. The editor's diagnostic filter in `src/language-service/diagnostics.ts` changes with D1.

**Compatibility.**

- A program that the compiler refuses today for a reserved name compiles after this change. This is a change in what is accepted.
- A program the compiler accepts today emits the same WGSL text. A local, a parameter, a module constant and a module variable already take fresh spellings, and the rule does not change them.
- A module that today draws a GLSL warning for a reserved struct, field, override or binding emits GLSL after this change. Its `glsl` output changes from `undefined` to a string. Its WebGL2 host code must bind by the record.
- The reflection shapes gain fields. Consumers that read existing fields are unaffected. A consumer that uses an emitted name as a host key breaks. Such a consumer is not known to exist; the implementation searches TypeNN, radiance and the site for it.
- The manifest schema changes (D2). A reader of schema 1 that reads a schema 2 manifest is refused by its schema check (Rule 11.10), if D2 bumps the version.

**Dependencies.**

- Proposal 0067 and proposal 0069 touch Rule 11.13 and the fuse planner. They do not touch the names of this change.
- Pull request #664 (issue #602) merged to `main` as `0d8e2bfc`. It renames kernel-function array bindings under Rule 3.3. It adds `spellArrayBindings` in `src/core/passes/kernel-lower.ts` (line 465) and `KernelPlan.bindingNames` (line 106 of the same file). `src/compiler/ts/host-face.ts` reads it at line 1005. The implementation of this proposal builds its binding case on that mechanism (D5). The sentence of surface section 68 that says a binding is never renamed is made exact by this proposal's rewrite of Rules 3.2 to 3.4.

**Validation work.** See "Configuration and validation record".

**Downstream effort.** See "What it owes downstream".

**Unestimated.** Effort, schedule and cost are unknown. None is recorded here. The proposal does not state a duration.

### Decisions

The owner decided D1 to D5 on 2026-10-13 (Asia/Seoul). D1 to D3 take the recommended option (a). D5 takes option (a). D4 and D6 to D9 take their defaults. No decision is open.

**D1. What TS8068 becomes. Decided: option (a).**

- Option (a). `TS8068` keeps its number and its strict-mode meaning only: a declaration that binds `eval` or `arguments`. The reserved-name refusals go. The text changes to name strict mode only.
- Option (b). `TS8068` is retired. Strict mode takes a new code in the TS80xx block of `src/compiler/ts/codes.ts`. The retired number leaves a gap (Rule 12.2).
- **Recommendation: (a).** It changes no code number and no existing test that pins the strict-mode text. It changes the reserved-name text only. The strict-mode text is already the only case in the editor's mapping for TS1215, TS1210 and TS1100.
- Proposed text for (a): "`eval` and `arguments` are not names a declaration can bind in strict mode." The wording is subject to Rule 12.5 review in the implementation.

**D2. Manifest schema version. Decided: option (a).**

- Option (a). The new record is added and `PACK_SCHEMA` goes from 1 to 2. A reader of schema 1 refuses a schema 2 manifest.
- Option (b). The record is added and `PACK_SCHEMA` stays 1.
- **Recommendation: (a).** A schema 1 reader that meets a schema 2 manifest reads the authored name and drives the emitted text with it, so a binding is bound to the wrong slot without an error. A refusal is safer than that. `checkManifest` in `src/runtime/program.ts` gives the schema check for this purpose, and Rule 11.10 names the schema.

**D3. Shape of the record. Decided: option (a).**

- Option (a). Each record that carries a name gains a field `emitted` beside its `name`. Examples are `BindEntry`, `EntryInfo`, `OverrideInfo`, `StructLayout`, each field of a `StructLayout`, and each uniform or sampler entry of the manifest. The host reads the pair on the same record.
- Option (b). One module-level map from authored name to emitted name, one map for each kind.
- **Recommendation: (a).** The host reads a pair without a lookup. A map by kind can hide a collision between two kinds of the same name.
- **Amendment of 2026-10-13: a second spelling where GLSL differs.** One `emitted` field cannot carry both targets. A name that only one target reserves takes a fresh spelling on that target alone: `half` is reserved by GLSL ES 3.00 and not by WGSL. One spelling for both targets would change the WGSL text of a program the compiler accepts today, against "Compatibility" above. So `emitted` is the WGSL spelling. `BindEntry`, `PackBinding`, `OverrideInfo` and `PackOverride` also gain `emittedGlsl`. It is present only when the GLSL spelling differs from `emitted`. A host on WebGL2 reads `emittedGlsl ?? emitted`. The other records keep one `emitted`: an entry name, a struct name and a field name reach GLSL through the WebGL2 maps of the manifest (`PackGlDraw`, `PackGlVertex`, `PackGlCompute`), which the GLSL writer fills. Option (b) of this amendment, `uniforms` and `overrides` maps on those WebGL2 records, is not taken.

**D4. Enum members. Default.**

- Default: if an enum member does not reach emitted text, the proposal does not change it. The implementation records the check. If an enum member reaches emitted text, it takes the same treatment as a constant.

**D5. Order of pull request #664. Decided: option (a).**

- Option (a). Pull request #664 merges first, under the current rules, because it is a fix for issue #602.
- Option (b). Pull request #664 is held. Its mechanism becomes the binding case of this proposal's first implementing pull request.
- **Draft recommendation: (b).** #664 changes the binding rule (Rule 3.3) in the way this proposal rewrites. Merging it first creates a second rule for kernel bindings.
- **Decision: (a).** In the conversation the coordinator recommended (a), against the draft: #664 fixes issue #602 under the current Rules 3.2 and 3.3, and its `spellArrayBindings` is the mechanism the binding case reuses, so no second rule results. The owner adopted that recommendation. #664 merged as `0d8e2bfc` under the bug-fix approval in advance (`CLAUDE.md`, Merging), before the owner's answer on D5. The deviation is recorded below.

**D6. Fresh spelling scheme for struct and field names. Default.**

- Default: the scheme of Rule 3.2 applies (`name_`, then `name_1`). A struct flattened name (`Owner_member`) takes the scheme on its whole flattened name.

**D7. Entry names that hide a predeclared name. Default.**

- Default: the entry takes a fresh emitted name and the record names the pair. The entry's WGSL name changes. The host calls the entry by the name written.

**D8. Editor hover. Default.**

- Default: the editor shows the authored name in hover and completion, as Rule 12.7 requires. The emitted name is not shown in the editor.

**D9. Rule 3.5 scope. Default.**

- Default: Rule 3.5 stays as written. This proposal does not extend it.

### Approval and plan record

- **Decision.** The owner approved the proposal in the project conversation on 2026-10-13 (Asia/Seoul), with the words "승인, 추천대로" ("approved, as recommended"). The owner adopted the coordinator's recommendations: option (a) for D1, D2, D3 and D5. D4 and D6 to D9 take their defaults. The merge of PR #665 records the acceptance.
- **Amendment of 2026-10-13 (Rule 12.3).** The implementation (step 2, C6) found that Rule 12.3's "Enforced by" list names a test this change makes false. The amendment adds Rule 12.3 to `rules`, for that list only. The status stays `accepted`. The amendment is a change to this file in its own pull request, with `Change: none`.
- **Amendment of 2026-10-13 (D3).** The implementation found that one `emitted` field cannot carry both targets. The owner approved the `emittedGlsl` field in the project conversation on 2026-10-13 (Asia/Seoul). The status stays `accepted`. The amendment is a change to this file in its own pull request, with `Change: none`. The approved revision is the file at the commit that merges the amendment.
- **Approved revision.** This file at the commit that PR #665 merges, as amended. Git records each commit.
- **Scope.** Every declaration kind of "What changes", Rules 3.2, 3.3, 3.4, 9.5 and 11.10, surface sections 48, 62 and 68, `TS8068` in its strict-mode meaning only (D1), `PACK_SCHEMA` 2 (D2) and the `emitted` field beside `name`, with `emittedGlsl` where GLSL differs (D3 and its amendment). No decision is open.
- **Deviation (D5), disposition: closed.** PR #664 merged as `0d8e2bfc` before the owner answered D5. It merged under the bug-fix approval in advance. The owner then chose option (a), which is the order that happened.
- **Responsibilities and milestones.** Unassigned. No schedule, owner or estimate is established.
- **Required validation.** The validation list below. None has run.

### Configuration and validation record

This record does not yet apply. Implementation requires the accepted revision of this file, commits with `Change: 0070`, the delivered configuration and the validation below. No validation has run for this proposal.

**Validation owed by the implementation.**

- **T1. Every reserved word compiles.** Every spelling of `WGSL_RESERVED` and of `GLSL_ES300_RESERVED`, plus a name containing `$`, a bare `_`, a name beginning with `__`, and a name beginning with `gl_`, is used as a name in each declaration kind of the list in "What changes". Each program compiles on WebGPU. Each program that has a GLSL target compiles on WebGL2. Each program is a test in `src/compiler/ts/` beside `reserved-names.test.ts`, which the implementation rewrites.
- **T2. Tint and ANGLE accept the output.** The compile gate (`Rule 13.3`) runs each T1 program through Tint and ANGLE, and records the measured text in the code comment and the record.
- **T3. The host binds by authored name.** On WebGPU, the bind group layout built from the record binds each binding by its authored name. On WebGL2, the uniform block lookup uses the authored struct name and the sampler lookup uses the authored binding name. On CPU, the oracle takes the authored names. Each case is a test.
- **T4. Both halves agree (Rule 12.7).** For each T1 source, `compile()` and the language service's `getDiagnostics` give the same result (no error), and `getHover` shows the authored name. `src/language-service/ambient-parity.test.ts` is the shape to follow.
- **T5. The record is exact.** A test pins each record pair for a module that uses every declaration kind. A manifest round trip keeps each pair. The schema check refuses a schema 1 reader under D2.
- **T6. Strict mode stays refused.** `eval` and `arguments` on a variable, a parameter and a function remain refused under D1. The test reads both halves (`src/language-service/diagnostics.test.ts`).
- **T7. No collision.** A fresh spelling never equals an authored name of the module, or another fresh spelling. A test covers a module whose authored names include the fresh spellings.
- **T8. Same-scope duplicates remain errors (Rule 3.2).** A test pins the duplicate refusal, which is already pinned by `src/compiler/ts/function-shadowing.test.ts`.
- **T9. Refusals removed.** A test shows that the program in "What changes" compiles, and that the reserved-name refusals of `reportReservedNames` and `reportHiddenPredeclared` no longer appear.
- **Document checks.** `bun run docs:refs`, `bun run docs:impact`, `bun run reqs:sync` and `doorstop -C` (after the rule and section edits), and the STE check of the repository that holds the documents.

**Validation that ran for this draft.** See the report of the drafting session. The draft changes no code, so no functional check applies to it.

**Implementation record, step 2 (C10).** Branch `claude/impl-0070-every-ts-name`, draft PR #666. Commits C1 to C10 carry `Change: 0070`. The measurements below ran on 2026-10-13 with `bun run gate:compile` (Tint on SwiftShader, ANGLE on SwiftShader, Chromium from `/opt/pw-browsers`). The step-2 record does not claim the validation list above. Each item states what ran.

- **Q1b, measured on Tint (raw WGSL, probe jobs `Q1b/...` of `scripts/compile-gate.ts`).**
  - `const max` called as `max(1.0, 3.0)`: refused, "cannot use 'const max' as call target".
  - `const max` read as a value: accepted.
  - `override min` called, `var<private> length` called, `var<storage> clamp` called: each refused.
  - `const sampler` read as a value: accepted.
  - `struct max` constructed as `max(1.0)`: accepted.
  - A parameter `max` called in its own function: refused, "cannot use parameter 'max' as call target".
- **Answer to Q1b.** A module-scope name that WGSL predeclares hides the predeclared name. The step-2 plan now gives such a name a fresh WGSL spelling: consts, module variables, overrides, bindings, structs and entry parameters (`src/core/spelling-plan.ts`). The rule is unconditional, as Q1 is. The emit goldens do not move.
- **Reserved-names leg (T2).** `scripts/compile-gate.ts`, section "The reserved-names leg": 303 reserved names, 19 kind-shape pairs, 5757 renamed jobs. Result after the change: every renamed job is accepted by Tint and ANGLE. Instrument: Tint refuses the undone form of 172 of 172 WGSL-reserved names; ANGLE refuses 175 of 183 GLSL-reserved names, and the 8 others are listed by name in the gate.
- **Deviations.**
  - D-C10-1 (closed 2026-10-19, decided by the owner: a rule by use): a helper parameter or a local named like a predeclared WGSL name takes a fresh spelling in a function that calls that builtin (`sanitizeVariableNames`, `src/core/passes/variable-names.ts`), and keeps its name elsewhere. No emit golden moves. Tint accepts the emitted form (probe `Q1b/param-and-local-respelled-by-use`) and refuses the authored one (`Q1b/param-max-called`). Test: `a local or helper parameter named like a builtin its function calls` in `src/compiler/ts/declared-builtin-names.test.ts`. A call that a pass after `preOptimize` adds is not seen; the rule text of step 4 states the rule.
  - D-C10-2 (accepted by the owner, 2026-10-19): the compute pass program names its sampled textures `_phx_tex<k>` (`src/core/passes/gl-compute.ts`), not `textures[].glsl?`. The index names are generated, so no reserved word reaches them, and the record is not widened.
  - D-C10-3 (accepted, measured): ANGLE accepts `iimageCubeArray`, `imageCubeArray`, `isamplerCubeArray`, `precise`, `samplerCubeArray`, `samplerCubeArrayShadow`, `uimageCubeArray` and `usamplerCubeArray` as identifiers in every kind the factory declares. Their renamed form is still checked. The gate lists them.
  - D-C10-4 (open): the kernel kind is not in the factory, so the reserved-names leg does not cover a kernel's array parameter. `src/compiler/ts/kernel-param-names.test.ts` covers it at the source level.
  - D-C10-6 (closed 2026-10-19): Rule 3.2, which this proposal declares, now states the respelling of a module-scope name that WGSL predeclares (Q1b), of an entry named like one (D7), and of a local or helper parameter named like a builtin its function calls (D-C10-1). Surface §62 says the same.
  - D-C10-5 (open): the browser half of T3 (a real WebGL2 `getUniformLocation` and `getUniformBlockIndex` on the manifest's names, and a WebGPU pipeline built with the translated `entryPoint` and `constants`) is not in the gate. The CPU half is in `src/core/cpu-names.test.ts`. The host tests of C8 and C9 use a recording stand-in for WebGL2.
- **Test run that did not pass.** `bun run test` (`npx vitest run`) of this branch failed 4 tests in `src/fuse.test.ts` on one run order, and passed each of them alone and in pairs. The same full run on the base commit passed. The failing tests depend on `glContext()` (`src/core/gl-context.ts`), which keeps its first result. In this run order a test file that ran earlier had made that result `null`. Open: the owner decides whether `glContext` may retry, or whether the test files reset it.

## What it owes downstream

For each repository in `downstream`:

- **typeshade.github.io.** The guide pages that describe a reserved word as a refusal, the Korean production emit page (it names reserved words), the TS8068 entry in the error-code table (src/lib/error-codes.ts), and the passage in `compiler-changes.md` (line 90 on `origin/main`) that follows surface section 62. The pages follow the surface, so the Korean guide pages and the English interface strings (src/i18n/en.ts) change together (`typeshade-site` skill).
- **vscode-typeshade.** The TS8068 row in the diagnostics reference of the plugin skill, the language and examples references of the plugin skill, the agents guide (line 255, the `smooth` remark), the design guide (line 600 on `origin/main`, the code list), and the MCP server's skill test. The plugin's host references describe the authored-name and emitted-name record.

Two more consumers are not in `DOWNSTREAM_REPOS` (`scripts/changes.ts`, line 61). They read reflection and the manifest:

- **radiance.** A search of `docs/design/` and `reqs/records/` on 2026-10-13 matched the word "reserved" only for lanes reserved for future use. No reserved-word name was found. The implementation confirms this against the pinned compiler.
- **TypeNN.** Not checked on 2026-10-13. It reads reflection. The implementation checks it before the manifest schema changes (D2).

Each downstream item is pending. No downstream change exists. A planned pin is not proof of downstream fulfillment.

## Open items

- Enum members (D4) are not verified.
- The vertex input lookup on WebGL2 is not verified (no `getAttribLocation` in `src/`).
- A GLSL field rename must keep the std140 host offset and the cross-stage varying link that the header of `src/core/backends/glsl-sanitize.ts` names. The implementation verifies this (T3).
- The TypeNN check is not done.
- A binding the host owns (`owner: 'host'`) and the fields of its struct are not given a fresh spelling. If such a name cannot be spelled on a target, the implementation reports a clear error. A later proposal decides whether to respell them.
