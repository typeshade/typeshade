---
id: '0011'
title: WGSL's predeclared matCxRf aliases (mat2x2f … mat4x4f) are types and constructors, as the vecNf aliases already are
status: accepted
rules: []
surface:
- 40
exports: []
exports-removed: []
codes: []
examples: []
downstream:
- repo: typeshade.github.io
  what: The nine names in src/lib/language-reference.ts (as 'constructors', beside mat2x2 and the rest), a probe row each in target-mapping.ts and glsl-mapping.ts if those tables hold every spelling, and the vector-alias sentence in the i18n copy (en.ts:2511, ko.ts) gaining its matrix twin
- repo: vscode-typeshade
  what: The skill's type list (SKILL.md, references/language.md) names mat4x4f beside mat4x4 and mat4, if it lists the vecNf aliases
---

<!-- doc-refs: skip-file — a proposal names files of the repositories downstream, which this tree does not have -->

## What changes

An author can write WGSL's nine predeclared `f32` matrix aliases: `mat2x2f`, `mat2x3f`,
`mat2x4f`, `mat3x2f`, `mat3x3f`, `mat3x4f`, `mat4x2f`, `mat4x3f` and `mat4x4f`. Each one is a
type and a constructor, both in the compiler and in the editor. Each is the same type as the
`matCxR` it abbreviates, in the same way that `vec3f` is `vec3`. Before this change each of
them was `TS8002 Unknown type "mat2x2f"`, and the list of supported names in that diagnostic
did not contain the name the author had been told to use (#183).

```ts
"use typeshade";

export function turn(p: vec2, a: f32): vec2 {
  const r: mat2x2f = mat2x2f(cos(a), sin(a), -sin(a), cos(a));
  return r * p;
}
```

It emits exactly what `mat2x2` emits today (`mat2x2<f32>` in WGSL, `mat2` in GLSL ES 3.00).
The name a diagnostic quotes back for such a type stays `mat2x2` / `mat2`, because the first
key in `SCALAR_AND_VEC_MAP` wins (`authorTypeName`), just as `vec2` wins over `vec2f`.

## Why

Rule 2.1(a) makes WGSL's predeclared types a source of the surface, and the vector aliases have
been spelled here since the beginning. The matrix aliases were left out when #166 made every
`matCxR` a type. That was an omission, not a decision: no rule, row or comment refuses them.
Rule 13.6 admits a WGSL name by citing the section that declares it. That section is
[Predeclared aliases](https://gpuweb.github.io/gpuweb/wgsl/#predeclared-types), whose matrix
table lists all nine.

The checks #183 asked for:

- **§9 / Rule 2.1.** These are source (a) names, so no §9.3 row is needed and no rule text
  moves. `src/core/spec-conformance/surface-names.test.ts` expands the predeclared aliases from
  the fixture's `typeGenerators` (`mat[234]x[234]` × the `f`/`h` suffixes). Its test "the
  predeclared aliases are the ones the specification tabulates" already asserts `mat4x4f`. The
  fixture does not list the aliases by name, and it does not need to: I measured that it
  carries all nine `matCxR` generators and `f32`, which the expansion reads.
- **Other aliases the vectors have and the matrices lack.** Only the `h` (f16) family, for
  vectors and matrices alike. That belongs to #153, and it stays out of this change as #183
  says. WGSL has no integer or bool matrix alias.

## What it touches

- **Surface §40** ("Matrices: every `matCxR`"): one sentence and one line of the example. The
  nine `matCxRf` spellings are the same types as `matCxR`.
- **`docs/language-design.md` Appendix A**: the matrix row names `matCxRf` beside `matCxR`. The
  "Not spelled on this tree" sentence stops listing them. Neither is a rule paragraph.
- **Code**:
  - `MAT_TYPE_NAMES` / `MAT_SHAPE` in `src/compiler/ts/type-map.ts` gain the nine names, after
    the existing ones, so that `SUPPORTED_TYPE_NAMES` carries them.
  - The lowering that resolves `mat2x2(…)` as a constructor call accepts the same names. It
    is located by `trace_path` from `MAT_SHAPE` when the implementation starts.
  - `SHADE_DTS` (derived from those tables) gains `type mat2x2f = mat2x2` and the constructor
    overloads, with the same JSDoc.
- **Tests (both halves on the same source)**:
  - For each of the nine: `compile()` accepts it as a parameter, a return, a local annotation
    and a constructor call, and emits the same WGSL and GLSL as the `matCxR` spelling.
  - The language service's `getDiagnostics` is empty on the same sources, and `getHover` on the
    alias names the matrix type.
  - A row in `src/language-service/ambient-parity.test.ts` holds that agreement. The
    surface-names test passes with no new extension row.

## What it owes downstream

- **typeshade.github.io**:
  - the nine names in `src/lib/language-reference.ts`, beside `mat2x2` … `mat4x4`, as
    `constructors`. The site's completeness check over the ambient names will ask for them.
  - a probe row each in `target-mapping.ts` and `glsl-mapping.ts`, if those tables list every
    spelling, as they do for `vec3f`.
  - the i18n sentence that says `vec3` and `vec3f` are one type (`en.ts`, `ko.ts`) gains the
    matrix pair.
- **vscode-typeshade**: the skill's type list names `mat4x4f` beside `mat4x4` and `mat4`, if it
  lists the `vecNf` aliases.
