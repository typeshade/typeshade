---
id: '0106'
title: Assign to a multi-component swizzle (`d.xy = r`, `d.xy *= r`), with each operand evaluated once and the old components read before any write
status: draft
rules:
  - '7.1'
  - '7.2'
surface:
  - 7
  - 9
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: Review the constructs and diagnostics pages generated from surface sections 7 and 9, drop the multi-component swizzle refusal and its TS8018 example, and record this proposal in compiler-changes.md
  - repo: vscode-typeshade
    what: Update the plugin skill's assignment-target and TS8018 guidance that says a swizzle target names one component, and record this proposal in compiler-changes.md
---

<!-- doc-refs: skip-file: a draft proposal names tests and text its implementation adds -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0106, `status: draft`. The front matter is the identity and lifecycle authority. No approval exists yet.                                                                                                                                                                                                                                                               |
| Date and attribution          | Drafted 2026-11-01, Asia/Seoul, by an AI agent at the maintainer's request. The date is the drafting date, not an approval date. The maintainer (Seungup) owns the decision. Git authorship of the containing commit is not an approval signature.                                                                                                                              |
| Request source                | GitHub issue [#846](https://github.com/typeshade/typeshade/issues/846), split out of [#841](https://github.com/typeshade/typeshade/issues/841) (its requirement 3). #841 keeps the full analysis and the reproduction artifacts.                                                                                                                                                |
| Applicability / effectivity   | `docs/language-design.md` (Rules 7.1 and 7.2), `reqs/` (their items), `docs/use-typeshade-surface.md` §7 and §9, `src/compiler/ts/lower/statement.ts`, the language service diagnostics (`src/language-service/`), the WGSL and GLSL ES 3.00 writers, the CPU oracle, `src/core/coverage/wgsl.ts` and the tests that pin `TS8018` on a swizzle. No release version is assigned. |
| Review baseline               | `main` at commit `981b7c15` (merge of #859), 2026-11-01.                                                                                                                                                                                                                                                                                                                        |
| Review and revision authority | No pull request is assigned yet. Branch `docs/proposal-0106-swizzle-assign` carries the draft. Git records the revisions of this file. The merge of the proposal pull request with `status: accepted` will record the decision.                                                                                                                                                 |

## What changes

Today a swizzle target must name exactly one component. `d.xy *= dm` draws
`TS8018 Cannot assign to the swizzle ".xy"`, whose reason says WGSL writes one component at a time
(`src/compiler/ts/lower/statement.ts`, surface §9). This proposal accepts a swizzle of two to
four components as an assignment target, for `=` and for every compound `op=` the vector
type has.

The proposed behaviour:

1. A multi-component swizzle of a native vector is a place. `d.xy = r`, `d.zx += r` and
   `c.rgb *= s` compile.
2. The right-hand side has the swizzle's type, as a read of the same swizzle does (Rule 7.1).
   A scalar on the right of a compound form follows the vector-scalar overloads of that
   operator.
3. The base, each index in it and the right-hand side are evaluated once each. The order is
   the one an assignment already uses: the target's indices, then the right-hand side.
4. Every old component the operation reads is read before any component is written.
5. The writer never emits a multi-component swizzle on the left (`d.xy *= dm`) in WGSL. It
   emits a whole-vector write or one write per component instead.
6. A swizzle that names one component twice (`d.xx = r`, `d.yxy += r`) stays refused with
   `TS8018`. Its sentence names the repeated component.
7. Every existing access check holds: a `const` root and a read binding are `TS8005`, a
   parameter is `TS8018`, and a lane of an emulated-double vector (`vec2f64`) stays `TS8018`.

The two required regressions:

```ts
let d = vec2(2., 3.);
d.xy *= d.yx; // d is vec2(6., 6.), not vec2(6., 18.)

let e = vec2(2., 3.);
e.yx *= vec2(0.5, 2.); // e is vec2(4., 1.5)
```

A proposed WGSL spelling of the first, for illustration only:

```wgsl
let _sw0 = d.xy * d.yx;  // every old component is read here
d.x = _sw0.x;
d.y = _sw0.y;
```

When the base has an index with an effect (`ps[next()].xy += r`), the writer binds the index or
a pointer to the base once, ahead of the read, as Rule 7.9 does for a call that writes. When
the swizzle covers the whole vector in any order, one whole-vector write may replace the
component writes. The exact spelling is an implementation choice inside items 3 to 5.

Exclusions: a swizzle of an emulated-double vector, a swizzle used as an `@inout` or `@out`
argument, and `++` / `--` on a swizzle (a vector has no step, surface §9) stay as they are.

## Why

Shader code updates parts of a vector often: `uv.xy *= scale`, `col.rgb += light`. The refusal
makes the author write one line per component or rebuild the whole vector. #841 reached this
form in real code, and #846 records it as a gap.

The refusal's reason is no longer accurate. `src/core/coverage/wgsl.ts` records the gap as group
9 of #640: WGSL at the pinned commit has the `swizzle_assignment` language extension, and GLSL
ES 3.00 allows `v.xy = …` natively.

The naive spelling is wrong in a way that is easy to miss. `d.xy *= d.yx` written as two
component writes in order gives `d.x = 2 * 3 = 6`, then `d.y = 3 * 6 = 18`. The right answer
is `vec2(6, 6)`. The old components must be read before the first write. The regressions pin
this, and the `yx` case pins that the write order follows the destination letters, not the
source letters.

**Alternatives.**

| Alternative                                                     | Why it is not chosen                                                                                                                                                                            |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep the refusal                                                | The target languages allow the form, and the refusal costs authors a rewrite on a common pattern.                                                                                               |
| Emit `d.xy *= dm` under the WGSL `swizzle_assignment` extension | A device that does not report the extension refuses the shader. One lowering that needs no extension works on every WebGPU device. See D1.                                                      |
| Accept duplicate destinations with last-write-wins              | WGSL and GLSL both refuse a repeated component on the left. The result would depend on an order the source does not show.                                                                       |
| Lower in the front end to separate source-level statements      | The language service and the compiler must agree on one target shape (Rule 12.7). One IR assignment that each backend spells keeps the editor, the oracle and the GPU writers on one tree walk. |

Assumption: the oracle and both GPU writers already evaluate a compound component write
(`v.x *= s`) in the order item 3 names. The implementation must confirm it with a test that
can fail.

## What it touches

- Rule 7.1: a swizzle on the left of `=` or `op=` takes the type and the operator overloads of
  the same swizzle read, and a repeated component is refused.
- Rule 7.2: a new row maps a multi-component swizzle assignment to a snapshot of the old
  components and per-component (or whole-vector) writes, with its divergence recorded in
  surface §9.
- Surface §7: the `TS8005` row lists a multi-component swizzle among the places that are the
  same refusal on either access mode. That example leaves the list.
- Surface §9: the paragraph "A swizzle target names exactly one component" is replaced with the
  accepted forms, the evaluation order, the snapshot and the duplicate refusal.
- Codes: none added, removed or renumbered. `TS8018` keeps its number. Its swizzle sentence
  changes to the duplicate-component sentence.
- No export or example changes.

Rule 12.7 is not edited. It is an obligation: a program the compiler accepts must draw no error
in the editor or in `tshc check`. The language service must therefore accept the same swizzle
targets and refuse the same duplicates (`src/language-service/diagnostics.ts`).

Required implementation evidence:

1. Update `src/compiler/ts/member-assign.test.ts` and `src/compiler/ts/remedy-lines.test.ts`,
   which pin the refusal today.
2. Add the two regressions on the CPU oracle, WGSL and GLSL ES 3.00.
3. Add a case for each compound operator group and for a swizzle of a field and of an element.
4. Add a case with an index that has an effect, counting its calls.
5. Add the duplicate-component refusal on the compiler and in the editor.
6. Add an editor-parity case under Rule 12.7.
7. Run the compile gate over WGSL (Tint) and GLSL ES 3.00 (WebGL2).
8. Close the `swizzle_assignment` rows in `src/core/coverage/wgsl.ts` and regenerate
   `docs/capability-coverage.md`.

### Draft impact estimate

Known work:

- `src/compiler/ts/lower/statement.ts`: accept the target, bind the base and index once, and
  refuse duplicates.
- The WGSL and GLSL ES 3.00 writers: spell the snapshot and the writes.
- The CPU oracle: evaluate the same IR with the same order.
- The language service: drop its swizzle-target refusal and add the duplicate one.
- Tests and goldens as listed above. Goldens change only where a test program uses the form.

Compatibility: the change accepts programs that were refused. No accepted program changes
meaning. A program that relied on `TS8018` for `v.xy = …` now compiles.

Dependencies: none new. Tools: the existing compile gate, the GPU differential and `tshc check`.

Duration and cost: unknown. No basis for an estimate exists.

Decisions to resolve before acceptance:

- **D1.** WGSL spelling. Recommendation: lower to component writes after a snapshot, and do not
  require the `swizzle_assignment` extension. The alternative emits the native form where the
  device reports the extension, at the cost of two spellings to test.
- **D2.** GLSL ES 3.00 spelling. GLSL allows `v.xy *= r` natively. Recommendation: use the same
  snapshot lowering as WGSL, so one walk and one test set cover both writers. The alternative
  is the native GLSL spelling.
- **D3.** Emulated-double vectors. Recommendation: keep `vec2f64` / `vec3f64` / `vec4f64`
  swizzle targets refused in this change, as their single lanes are today. A later proposal can
  extend it.

### Approval and plan record

This record does not yet apply. Acceptance will require:

- the maintainer's actual decision on the proposal pull request, and its merge with
  `status: accepted`;
- the decisions on D1, D2 and D3;
- the approved revision and scope, the assigned implementer and any agreed milestone.

### Configuration and validation record

This record does not yet apply. Delivery will require:

- the accepted proposal revision and the implementation pull requests, with commits that say
  `Change: 0106`;
- the delivered configuration, file by file;
- functional validation: the unit suite, the compile gate, the GPU differential and the user
  journeys, each with its date, commit and result;
- document validation: `bun run docs:refs`, Rules 7.1 and 7.2, surface §7 and §9 and `reqs/`
  reviewed against the delivered behaviour;
- each deviation from this text, with its disposition.

## What it owes downstream

Expected work, not yet agreed:

- **typeshade.github.io.** The constructs and diagnostics pages generated from surface §7 and
  §9 say a swizzle target names one component and show `v.xy = …` as a `TS8018` example. Both
  must change. The site's `compiler-changes.md` must record 0106 when its pin carries it.
- **vscode-typeshade.** The plugin skill's language and diagnostics references describe the
  one-component rule and the `TS8018` swizzle example. Both must change. Its
  `compiler-changes.md` must record 0106 when its pin carries it. The editor's diagnostics come
  from the language service, so they change with the compiler pin.

Radiance, TypeNN and TypeCV owe nothing: the change only accepts programs that were refused.
