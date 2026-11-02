---
id: '0106'
title: Assign to a multi-component swizzle (`d.xy = r`, `d.xy *= r`), with each operand evaluated once and the old components read before any write
status: accepted
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
| Identity and status           | Proposal 0106, `status: accepted`. The front matter is the identity and lifecycle authority. The owner approved it on 2026-11-02 (see Approval and plan record).                                                                                                                                                                                                                |
| Date and attribution          | Drafted 2026-11-01, Asia/Seoul, by an AI agent at the maintainer's request. The date is the drafting date, not an approval date. The maintainer (Seungup) owns the decision. Git authorship of the containing commit is not an approval signature.                                                                                                                              |
| Request source                | GitHub issue [#846](https://github.com/typeshade/typeshade/issues/846), split out of [#841](https://github.com/typeshade/typeshade/issues/841) (its requirement 3). #841 keeps the full analysis and the reproduction artifacts.                                                                                                                                                |
| Applicability / effectivity   | `docs/language-design.md` (Rules 7.1 and 7.2), `reqs/` (their items), `docs/use-typeshade-surface.md` §7 and §9, `src/compiler/ts/lower/statement.ts`, the language service diagnostics (`src/language-service/`), the WGSL and GLSL ES 3.00 writers, the CPU oracle, `src/core/coverage/wgsl.ts` and the tests that pin `TS8018` on a swizzle. No release version is assigned. |
| Review baseline               | `main` at commit `981b7c15` (merge of #859), 2026-11-01. Re-read on `main` at `9dbc2985` (merge of #890), 2026-11-02: every location this proposal names still says what it quotes, and the branch merges onto it without conflict.                                                                                                                                             |
| Review and revision authority | Pull request #860 (branch `docs/proposal-0106-swizzle-assign`). Git records the revisions of this file. Its merge with `status: accepted` records the decision.                                                                                                                                                                                                                 |

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
   `TS8018`. Its sentence names the repeated component. The refusal comes before the access
   check, as the one-component rule does today (`lowerMemberLValue`): `v.xx = …` on a read
   binding is `TS8018`, not `TS8005`, since it is no place on either access mode.
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

When the base has an index with an effect (`ps[next()].xy += r`), the lowering binds the index
or a pointer to the base once, ahead of the read, as Rule 7.9 does for a call that writes. When
the swizzle covers the whole vector in any order, one whole-vector write may replace the
component writes. The exact spelling is an implementation choice inside items 3 to 5.

**Where the lowering happens** (amended 2026-11-02). The front end lowers the assignment into
IR that every backend already has: a `let` that holds the snapshot and one component assignment
per destination letter (or one whole-vector assignment). `lowerMemberLValue` and the assignment
lowering of `src/compiler/ts/lower/statement.ts` do it. The WGSL writer, the GLSL ES 3.00 writer
and the CPU oracle then need no change, and they cannot disagree on the order of items 3 and 4.
This settles D1 and D2 as recommended. The optimizer may remove a snapshot that no destination
reads back.

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

| Alternative                                                     | Why it is not chosen                                                                                                                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep the refusal                                                | The target languages allow the form, and the refusal costs authors a rewrite on a common pattern.                                                                                           |
| Emit `d.xy *= dm` under the WGSL `swizzle_assignment` extension | A device that does not report the extension refuses the shader. One lowering that needs no extension works on every WebGPU device. See D1.                                                  |
| Accept duplicate destinations with last-write-wins              | WGSL and GLSL both refuse a repeated component on the left. The result would depend on an order the source does not show.                                                                   |
| A new IR form that each backend spells                          | Three implementations (WGSL, GLSL ES 3.00, the CPU oracle) of one evaluation order, each needing its own tests. The front-end lowering above keeps one implementation (amended 2026-11-02). |

Assumption: the oracle and both GPU writers already evaluate a one-component write (`v.x = e`)
as the front end orders it. The front-end lowering relies on that form only. The implementation
must confirm it with a test that can fail.

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
in the editor or in `tshc check`. **Fact** (checked on `9dbc2985`, 2026-11-02). The editor has no
swizzle-target refusal of its own: the ambient vector types declare every swizzle writable, and
the editor's `TS8018` for `d.xy *= d.yx` and `d.xx = a` comes from the same front-end lowering
as the compiler's. So the change in `lowerMemberLValue` moves both halves at once. The parity
test below still pins that they agree.

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
9. Add a kernel function whose loop writes `out[i].xy = …` (Rule 8.22): the proof accepts the
   component stores, and the GPU lowering and the CPU tier write the same values.
10. Add a swizzle target on a `storage<…, "read_write">` element and on a `workgroup` vector.
11. Run `bun run reqs:sync` and `python scripts/doorstop-check.py -C` after editing Rules 7.1
    and 7.2, and review `RULE-0701` and `RULE-0702` (`reqs/README.md`).
12. Add the read-binding case of item 6: `v.xx = …` is `TS8018` and `v.xy = …` is `TS8005`.

### Draft impact estimate

Known work:

- `src/compiler/ts/lower/statement.ts`: accept the target, bind the base and index once, refuse
  duplicates, and lower to the snapshot and the component writes.
- The WGSL and GLSL ES 3.00 writers and the CPU oracle: no change expected (the IR they read is
  the one they read today).
- The language service: no change of its own; its diagnostics follow the front end.
- Tests and goldens as listed above. Goldens change only where a test program uses the form.

Compatibility: the change accepts programs that were refused. No accepted program changes
meaning. A program that relied on `TS8018` for `v.xy = …` now compiles.

Dependencies: none new. Tools: the existing compile gate, the GPU differential and `tshc check`.

Duration and cost: unknown. No basis for an estimate exists.

Decisions to resolve before acceptance:

- **D1.** WGSL spelling. Recommendation: lower to component writes after a snapshot, in the
  front end (above), and do not require the `swizzle_assignment` extension. The alternative emits the native form where the
  device reports the extension, at the cost of two spellings to test.
- **D2.** GLSL ES 3.00 spelling. GLSL allows `v.xy *= r` natively. Recommendation: use the same
  snapshot lowering as WGSL, so one walk and one test set cover both writers. The alternative
  is the native GLSL spelling.
- **D3.** Emulated-double vectors. Recommendation: keep `vec2f64` / `vec3f64` / `vec4f64`
  swizzle targets refused in this change, as their single lanes are today. A later proposal can
  extend it.

### Approval and plan record

The owner (Seungup) approved the proposal in the Claude Code session on 2026-11-02 (UTC), in
Korean ("수락"), after the review amendments of commit `d4b994cc` were reported to them. The
approved revision is the one this record is part of. The merge of #860 with `status: accepted`
records the decision.

Decisions, each as recommended:

- **D1.** WGSL: the front end lowers the assignment to a snapshot `let` and component writes
  (or one whole-vector write). The `swizzle_assignment` extension is not required.
- **D2.** GLSL ES 3.00 takes the same lowering, since the writers read the same IR.
- **D3.** A swizzle target of an emulated-double vector stays `TS8018` in this change.

Scope: items 1 to 7 of "What changes", the lowering place of "Where the lowering happens", and
evidence items 1 to 12 of "What it touches". Responsibilities: an agent of this repository
implements it for issue #846 in a pull request whose commits say `Change: 0106`. The site and the
editor do their work when their pins move. No milestone date is assigned. No duration or cost
estimate is established.

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
