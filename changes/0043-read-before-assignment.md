---
id: '0043'
title: A read of a local before it is assigned is refused, as TypeScript refuses it, and every target starts a local at zero
status: accepted
rules:
  - '7.6'
  - '12.7'
surface:
  - 7
  - 14
  - 49
exports: []
exports-removed: []
codes:
  - TS8075
examples: []
downstream:
  - repo: typeshade.github.io
    what: The constructs page's entry for `let x: f32` with no initializer, which says a read before the first assignment is zero on WGSL and undefined on GLSL; the TS8075 entry in the diagnostics reference; compiler-changes.md records 0043 when the pin moves.
  - repo: vscode-typeshade
    what: references/diagnostics.md gains TS8075 and the skill's note that TS2454 is now the compiler's TS8075; compiler-changes.md records 0043 when the pin moves.
---

<!-- doc-refs: skip-file — an accepted but unimplemented proposal names a future code and files in downstream repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0043`, `status: accepted`. The front matter is the lifecycle authority. The merge of its pull request is the acceptance.                                                                                                                                                           |
| Date and attribution          | Written 2026-10-05, Asia/Seoul. The date is the authoring context, not an approval. Drafted by the repository's coding agent at the owner's direction, after the owner asked whether `let s: f32; add(1., 2., s);` works and the measurement below found that the compiler and the editor disagree. |
| Applicability / Effectivity   | `"use typeshade"` source; the front end (`src/compiler/ts/lower/`), the GLSL ES 3.00 backend (`src/core/backends/glsl.ts`), the language service's diagnostics (`src/language-service/diagnostics.ts`), the documents named below; the site and the editor. Release version unassigned.             |
| Review baseline               | `origin/main` at `a5ff08f5dd9ff32b8ab7d6c49c0284a8178132aa`.                                                                                                                                                                                                                                        |
| Review and revision authority | [PR #469](https://github.com/typeshade/typeshade/pull/469); the third amendment of change 0040 goes in the same pull request. Git records revisions; the pull request's review and merge record the decision.                                                                                       |

## What changes

A read of a local before it is assigned on every path is refused with `TS8075 UNASSIGNED_READ`,
by TypeScript's own rule for TS2454 ("Variable 'x' is used before being assigned"). The editor
shows the compiler's `TS8075` where TypeScript reported TS2454, so the two halves report one
mistake once (Rule 12.7).

```ts
let s: f32;
return id(s); // TS8075: "s" is read before it is assigned. Assign it first: let s: f32 = 0.;

let t: f32;
if (k) { t = 1.; } else { t = 2.; }
return t; // accepted: every path assigns t
```

The analysis is TypeScript's: a local declared with no initializer is unassigned; an
assignment to the whole local assigns it; a write into a field or element of it is a read of
the local; `if`, `switch`, loops, `break`, `continue` and `return` join paths as TypeScript joins
them; a read inside a local function is not checked, as TypeScript does not check it. One case
is TypeShade's: a call that passes the local to an `@out` parameter (change 0040, third
amendment) assigns it.

Rule 7.6 changes from a recorded divergence to a rule. A program that reads a local before it
is assigned no longer compiles, so the value of such a read is no longer observable. Every
target still gives a local declared with no initializer the zero of its type: WGSL and the CPU
do today, and GLSL ES 3.00 emits the zero as the initializer (`float s = 0.0;`), where it left
the value undefined. The zero costs nothing a driver does not already remove, and it keeps the
three targets equal for any read an analysis might miss.

| Source                                                     | Before                                                          | After                               |
| ---------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------- |
| `let s: f32; return s;`                                    | Accepted: 0 on WGSL and CPU, undefined on GLSL. Editor: TS2454. | `TS8075` in both.                   |
| `let s: f32; s = 1.; return s;`                            | Accepted.                                                       | Accepted.                           |
| `let a: array<f32, 3>; a[0] = 1.; return a[0];`            | Accepted. Editor: TS2454 on `a`.                                | `TS8075` in both.                   |
| `let s: f32; add(1., 2., s); return s;` with `@out c: f32` | (not expressible)                                               | Accepted.                           |
| `let s: f32; const f = (): f32 => s; s = 1.; return f();`  | Accepted.                                                       | Accepted, as TypeScript accepts it. |

## Why

The owner asked whether an uninitialized local can be handed to an `@out` parameter. The
measurement on 2026-10-05 (compiler at `a5ff08f`) found a defect that answer depends on:

```
let s: f32; return id(s);
  compiler: no diagnostic        editor: TS2454 Variable 's' is used before being assigned.
  WGSL: var s: f32;              GLSL: float s;            oracle: 0
```

The compiler accepted a program the editor marked as an error, against Rule 12.7, and the three
targets gave it two different values: WGSL and the CPU read 0, and WebGL2 may read anything.
Rule 7.6 recorded that divergence and asked the author to assign first, with no diagnostic.

Two alternatives were weighed. Zero-initializing on GLSL alone makes the targets agree but leaves
the compiler accepting what the editor refuses, and leaves the author's mistake silent. Adopting
TypeScript's TS2454 positions directly in the compiler cannot express `@out`: TypeScript reads
`add(1., 2., s)` as a read of `s` and keeps `s` unassigned after it, so every later read would
be refused. The compiler therefore runs the analysis itself, by TypeScript's rule with the one
addition, and the editor takes the compiler's result. For a program with no `@out` argument, the
compiler's `TS8075` positions must equal TypeScript's TS2454 positions; a corpus test holds that.

## What it touches

- Rule 7.6: "a read of a local before its first assignment must be refused (`TS8075`), by
  TypeScript's definite-assignment rule, and a call that passes the local to an `@out` parameter
  assigns it; every target starts a local declared with no initializer at the zero of its type."
  The Appendix B row for Rule 7.6 is removed.
- Rule 12.7: TypeScript's TS2454 is replaced in the editor by the compiler's `TS8075`.
- Surface §14: the paragraph on `let x: f32` with no initializer states the refusal and the zero.
  §7: the diagnostics table gains `TS8075`. §49: the editor's diagnostic for an unassigned read.
- `TS8075 UNASSIGNED_READ` in `src/compiler/ts/codes.ts`, the next free code (Rule 3.7).
- The GLSL ES 3.00 backend emits the zero initializer for a local declared with none; the emit
  goldens of the examples that declare one change, and the compile gate links them on WebGL2.
- Tests that read both halves: the table above in the compiler and the editor, the corpus test
  of `TS8075` against TS2454, and the GLSL text.

### Impact estimate

| Area              | Expected work                                                                                          | Basis and uncertainty                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Front end         | A definite-assignment pass over each function's body, by TypeScript's rule, plus `@out` arguments.     | TypeScript's rule is documented and its results are the test oracle. Medium.  |
| GLSL backend      | A zero initializer for a local declared with none.                                                     | Small. Golden churn in the examples that declare one.                         |
| Editor            | TS2454 dropped where the compiler reports `TS8075`.                                                    | `mergeDiagnostics` already drops TypeScript reports the compiler owns. Small. |
| Compatibility     | A program that read a local before assigning it stops compiling. TypeScript already reported each one. | Known. No released program depends on the read; the value differed by target. |
| Duration and cost | Unknown; not estimated.                                                                                | No basis established.                                                         |

### Approval and plan record

The approval is the merge of this proposal's pull request, at the owner's direction ("네", in
conversation on 2026-10-05, to fixing the defect). That merge has not happened at this revision.
The implementing pull request records it. Responsibilities, milestones, duration and cost are not
assigned.

### Configuration and validation record

Does not yet apply. Delivery requires: the table above in the compiler and the editor on the
same source; the corpus test of `TS8075` against TypeScript's TS2454 over the examples and the
test programs with no `@out` argument; the GLSL text; `bun run gate:compile` and
`bun run gate:differential`; `docs:impact`, `docs:refs`, `reqs:sync` and `doorstop -C`.

## What it owes downstream

**typeshade.github.io.** The constructs page's entry for a local with no initializer, which
states the WGSL and GLSL divergence that this change removes; the diagnostics reference's
`TS8075` entry, in English and Korean. `compiler-changes.md` records `0043` when the pin moves.

**vscode-typeshade.** `references/diagnostics.md` gains `TS8075`; the skill notes that the
editor reports `TS8075` where TypeScript reported TS2454. `compiler-changes.md` records `0043`
when the pin moves.
