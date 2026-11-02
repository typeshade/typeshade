---
id: '0115'
title: The surface has three layers, ECMAScript, TypeShade's core vocabulary and the target features, and no new global name is added until the place of each layer is decided
status: accepted
rules:
  - '2.1'
  - '2.5'
  - '3.9'
  - '9.6'
  - '11.20'
  - '13.6'
surface: []
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The rule pages render the amended Rules 2.1, 9.6 and 13.6 and the new Rule 2.5 from reqs/ at the pin. If decision D4 takes option (b), the guide's pages that call a texture, atomic, barrier, derivative or packing function gain the import line.
  - repo: vscode-typeshade
    what: The skill's account of where a name comes from is read against the three layers. If decision D4 takes option (b), the extension offers the auto-import of a target-feature name and its snippets gain the import line.
---

<!-- doc-refs: skip-file — this proposal names rules it adds; their text lands with the implementing pull request -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0115, `status: accepted`. The front matter is the identity and lifecycle authority. The owner approved the proposal on 2026-11-02; see Approval and plan record, and its open items. No implementation exists.                                                                                                                    |
| Date and attribution          | Authored 2026-11-02, UTC, by a Claude Code agent. The date is the authorship date, not an approval date.                                                                                                                                                                                                                                   |
| Request source                | The owner, in a Claude Code session on 2026-11-02, in Korean. The session started from `arrayLength` beside `.length`, and went on to ask what a `"use typeshade"` file is, and how the surface should look ten years from now. The owner approved drafting this view for discussion.                                                      |
| Applicability / effectivity   | `docs/language-design.md` (Rules 2.1, 9.6 and 13.6, a new Rule 2.5; Rules 3.9 and 11.20 only if decision D4 takes option (b)), `reqs/` (the items of those rules), and the site's rule pages. No compiler code, IR, backend, export, diagnostic code, surface section or example changes in this proposal. No release version is assigned. |
| Review baseline               | `main` at `9afe73a` (2026-11-02).                                                                                                                                                                                                                                                                                                          |
| Review and revision authority | Pull request [#879](https://github.com/typeshade/typeshade/pull/879) (branch `claude/proposal-0115-core-vocabulary`). Git records the revisions of this file; the merge of #879 records a decision.                                                                                                                                        |

## What changes

### 1. The three layers (accepted)

Proposal 0100 (accepted) says where a name may come from: ECMAScript, WGSL or the §9.3 table
(Rule 2.1). It does not say how long each name is meant to last, or who owns its meaning. This
proposal sorts every author-facing name into one of three layers by that question.

| Layer              | What it holds                                                                                                                                                                                                              | Who owns the meaning                               | Expected life (inference)                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1. ECMAScript      | The syntax, `Math`, `console`, the array methods, `Map`, `Set`                                                                                                                                                             | TC39, as TypeScript's standard library declares it | The longest: ECMAScript does not break the web                                                                        |
| 2. Core vocabulary | The sized scalars, the vectors, the matrices, the constructors, the decorators and address spaces, and the math functions common to GPU languages (`dot`, `cross`, `normalize`, `clamp`, `mix`, `sqrt`, `smoothstep`, ...) | TypeShade, which defines and guarantees each name  | Long: GLSL, MSL and WGSL have shared most math names for about 20 years; HLSL shares most (it spells `mix` as `lerp`) |
| 3. Target features | Textures and samplers, atomics, barriers, derivatives, packing, `workgroupUniformLoad`, `quantizeToF16`, and later subgroups and `f16`                                                                                     | The target's specification, today WGSL             | Short: each WGSL revision and each new target adds or changes some                                                    |

**Rule 2.5 (new, accepted).** Every author-facing name belongs to exactly one layer of the table
above. A name of layer 1 means what ECMAScript gives it (Rule 1.1, as proposal 0100 amends it). A
name of layer 2 means what this document gives it, and this document names WGSL as the current
reference of that meaning. A name of layer 3 means what its target specification gives it.

- Rationale: a name lasts as long as the owner of its meaning keeps it. The surface should depend
  on the owner that changes least for each kind of name.

### 2. The interim rule (accepted)

**Rule 13.6 (amended, accepted), added sentence.** Until decision D4 of change 0115 is made, a
new author-facing name must not be declared as an ambient global. A name of layer 3 that a new
WGSL feature needs waits for the decision, or is added by an amendment of this proposal that
names it.

- Rationale: a global name cannot be versioned. It is the most expensive kind of name to retire,
  and after `1.0.0` each retirement costs a deprecation window (Rule 13.10). Every global added
  now is a name decision D4 must then move or keep.
- Effect today (fact): the roadmap places subgroups and `f16` after `1.0.0` (§14). No item before
  `1.0.0` is known to need a new global.

Decision (2026-11-02): accepted by the owner, with D1 to D6. See the approval record.

### 3. The decisions

Each decision gives the options, the recommendation and the reason. The line after each reason
records the owner's decision of 2026-11-02.

**D1. The layer of each name family.** Option (a): the table in section 1, as written. Option
(b): a different split. Recommendation: (a). The measured count at `9afe73a` is in the Why
section.

Decision (2026-11-02): option (a), as recommended.

**D2. `Math` stays layer 1.** Option (a): `Math` keeps ECMAScript's meaning and its scalar
signatures; vector math is layer 2. Option (b): `Math` members also take vectors, a meaning
recorded as a TypeShade difference. Recommendation: (a). Reason: TC39 keeps adding to `Math`, and
a widened member can collide with what TC39 later gives the same name. The Why section has the
`Math.clamp` case. Accepted proposal 0112 (#878) makes the same narrowing for the members the ambient
library widens today; this decision states the principle, and 0112 carries the change.

Decision (2026-11-02): option (a), as recommended.

**D3. Who defines a layer 2 name.** Option (a): a layer 2 name keeps meaning what WGSL gives it,
revision by revision, as Rule 1.1 says today. Option (b): this document writes down the meaning of
each layer 2 name, in a table of §9, and names the WGSL section as the current reference. A WGSL
revision that changes the meaning then does not change TypeShade until a proposal adopts it.
Recommendation: (b), written one family at a time. Reason: the same name runs on WGSL, GLSL ES
3.00, the CPU oracle and, by the plan of proposal 0100 (area W), wasm. The meaning must belong to
the language, not to one of its targets. The CPU oracle is already the reference evaluation (Rule
1.3).

Decision (2026-11-02): option (b), as recommended, decided before `1.0.0`.

**D4. Where layer 3 lives.**

- Option (a): ambient globals, as today.
- Option (b): module imports from the compiler's package, for example
  `import { textureSample } from "typeshade/gpu"`. A subpath can be versioned, split and retired;
  a global cannot.
- Option (c): both, for one release, then (b).

Recommendation: (b), decided before `1.0.0`. Reason: before `1.0.0` a spelling can move in one
release (Rule 13.10 as it stands; plan unit P1). After `1.0.0` the same move costs a deprecation
window per name and a major release. The cost of (b) is one import line in a file that uses a
target feature; the editor's auto-import can write it (to be measured, see D7).

The precedent exists (fact): `typeshade/random` and `typeshade/algorithms` are shader modules
that a `"use typeshade"` file imports today, under the `typeshade` condition (Rule 11.20, change
0072; surface §72 and §73).

Decision (2026-11-02): option (b), as recommended. The conditional items of this proposal
therefore apply (Rules 3.9 and 11.20, and the downstream items). Open items are listed in the
approval record.

**D5. The mechanism of a layer 3 module, if D4 takes (b).** A shader module cannot export a
function without a body today: `export declare function f(x: f32): f32` is refused with `TS8020
Function "f" needs a body (no ambient declarations)` (measured at `9afe73a`). Option (a): a
reserved subpath of the compiler's package, whose exports the linker resolves to the builtins, so
the declarations stay in the ambient library's text and only their visibility moves. Option (b):
allow a body-less declaration in a library module, bound to an intrinsic id. Recommendation: (a).
Reason: (b) opens a way for any package to declare a name the compiler then has to know, which
Rule 2.2 and Rule 9.8 exist to close.

Decision (2026-11-02): option (a), as recommended.

**D6. Does layer 2 also move to modules?** Option (a): no, layer 2 stays global. Option (b): yes,
`import { dot, normalize } from "typeshade/math"`. Recommendation: (a). Reason: almost every
shader file uses layer 2, as almost every GLSL file uses `dot` and `normalize`. An import line in
every file is a cost with little return, because layer 2 is the stable layer. Accepted proposal 0113
(#877), implemented in #889, lets an author write short names from `Math` in plain TypeScript
where that helps.

Decision (2026-11-02): option (a), as recommended.

**D7. What must be measured before D4 and D5 are decided.**

1. The editor's auto-import for a name of `typeshade/gpu`: completion offers it, and accepting it
   writes the import line (Rule 1.7: the form must project to TypeScript).
2. The number of examples and tests that call a layer 3 name: the size of the migration.
3. The message a global use of a moved name gets: one sentence that names the import line
   (Rule 12.1).

No recommendation is recorded for D7. Its three measurements are not made. They stay open; see
the approval record.

## Why

### The evidence

**The names declared today (fact).** The ambient library at `9afe73a` declares 186 functions.
Counted by name pattern:

| Group                                                                               | Functions |
| ----------------------------------------------------------------------------------- | --------- |
| Layer 3: textures, atomics, barriers, derivatives, packing and the related builtins | 56        |
| Layer 2: constructors (`vecN`, `matCxR`, scalar casts, `array`)                     | 45        |
| Layer 2: decorators and address spaces                                              | 13        |
| Layer 2, with layer 1 overlaps and §9.3 extensions: math, folds and the rest        | 72        |

The last group holds the names that accepted proposals 0112 and 0113 deal with (`arrayLength`, the free `Math`
spellings, the folds).

**An import of a library name today (fact).** Measured at `9afe73a` with `compileTsSource` and the
language service on the same source. `import { dot } from "typeshade/gpu"` is refused by both
halves with `TS8072` (the compiler: no `readDocument`; the editor: the package is not in
`node_modules`). The global `dot(v, v)` passes both. No library name can be imported today.

**`Math` belongs to TC39, and TC39 is still adding to it (fact).**

- `Math.sumPrecise` reached Stage 4 on 2025-07-28 and is part of ES2026
  ([proposal-math-sum](https://github.com/tc39/proposal-math-sum)).
- `Math.clamp` is at Stage 2 ([proposal-math-clamp](https://github.com/tc39/proposal-math-clamp),
  [spec draft](https://tc39.es/proposal-math-clamp/)). Its draft throws a `RangeError` when the
  minimum is greater than the maximum, and a `TypeError` for an argument that is not a Number.
  WGSL's `clamp` throws nothing at run time. A TypeShade `Math.clamp` widened to vectors today
  would have to pick one of the two meanings, and could disagree with ECMAScript the day the
  proposal ships.

**The roadmap's first rule (fact).** "A GPU concept earns a new spelling only when no ordinary
TypeScript shape carries it" (`docs/roadmap.md`, Three rules). An import is an ordinary
TypeScript shape; a global name with no source in ECMAScript is not.

### Alternatives

- **Keep every name global and decide nothing.** It costs nothing today. After `1.0.0` each name
  is fixed for a major release, and subgroups and `f16` arrive as more globals. Not recommended.
- **Move every name to modules, layer 2 included.** It is the most uniform. It puts an import line
  in every shader file for the names that change least. Not recommended (D6).
- **One subpath for each family** (`typeshade/texture`, `typeshade/atomic`, ...) in place of one
  `typeshade/gpu`. It versions finer, and costs more import lines. An option inside D4 (b), left
  open.

### Assumptions and open points

- The proposal assumes the editor can offer an auto-import for a name of the compiler's package
  (D7, item 1). It is not measured.
- The count by name pattern is an estimate of the split; a reviewer can move a name between
  groups.
- Related proposals: accepted 0100 (the principle); accepted 0112 (#878, one spelling for one
  meaning); accepted 0113 (#877, destructuring `Math`; implemented in #889). None is a dependency
  of this one.

## What it touches

- **Rule 2.1:** the three sources stay; the rule gains a reference to the layers of Rule 2.5.
- **Rule 2.5 (new):** the three layers and who owns the meaning of each.
- **Rule 3.9:** only if D4 takes (b): the reserved subpath and how the linker resolves its names.
- **Rule 9.6:** the §9.3 table records the layer of each row.
- **Rule 11.20:** only if D4 takes (b): the layer 3 subpath beside the common modules.
- **Rule 13.6:** the interim sentence of section 2.
- **No export, code, surface section or example** changes in this proposal. If D4 takes (b), an
  amendment adds the subpath to `exports`, a diagnostic for a global use of a moved name to
  `codes`, and the surface sections of the moved families to `surface`, before acceptance.

### Draft impact estimate

- This proposal, accepted: the text of Rules 2.1, 2.5, 9.6 and 13.6 and their `reqs/` items. Known
  scope; no code.
- D4 (b) and D5 (a), if accepted: the linker's reserved subpath, the editor's resolution of it, the
  migration of the examples and tests that call 56 functions, the site's pages, and the editor's
  snippets. Duration and cost are unknown; D7 measures the size first.
- D3 (b): one table of §9 for each family of layer 2, written over time. Unknown.

### Approval and plan record

- 2026-11-02, the owner, in a Claude Code session, in Korean ("0115 추천대로 승인"): D1 to D6 are
  decided as recommended. D1 takes option (a), D2 (a), D3 (b), D4 (b), D5 (a) and D6 (a). The
  interim sentence of section 2 is accepted.
- Inference, to confirm by the owner: the interim sentence applies "until decision D4 is made".
  This decision makes D4, so its condition is met. From this date a new layer 3 name is a module
  export under D4 (b). A layer 2 name stays global.
- The status `accepted` is set by the commit that carries this record. The merge of #879 records
  the acceptance (`changes/README.md`, item 2).

### Open items at acceptance

- **O-1. D7 measurements not made.** Section 3 says these measurements come before D4 and D5 are
  decided. D4 and D5 were decided first. Next action: measure items 1 to 3 of D7 before the first
  implementing pull request for a layer 3 module.
- **O-2. Impact declarations for D4 (b) and D5 (a) not declared.** The last bullet of "What it
  touches" says an amendment adds the subpath to `exports`, a diagnostic to `codes` and the moved
  families to `surface`, before acceptance. The front matter has `exports: []`, `codes: []` and
  `surface: []`. The owner's decision does not name them. This is an open deviation from that
  text. Next action: an amendment that declares them, before the first implementing pull request.
- **O-3. Downstream work not searched.** The rule pages, the guide pages and the editor's
  auto-import are owed by D4 (b). Next action: search each named repository by name, as
  `changes/README.md` item 5 requires, when the compiler pin moves.

### Configuration and validation record

This record does not yet apply. Delivery will require the implementing pull requests, the
`reqs/` items, the checks they ran and their results.

## What it owes downstream

- **typeshade.github.io:** the rule pages for Rules 2.1, 2.5, 9.6 and 13.6. If D4 takes (b), every
  guide page that calls a layer 3 function gains the import line. Expected work; not yet searched
  name by name.
- **vscode-typeshade:** the skill's account of where a name comes from. If D4 takes (b), the
  auto-import and the snippets of layer 3 names. Expected work.
