// ═══ Capability coverage, table C: one row per GLSL ES 3.00 key ═══
//
// WHAT THIS FILE JOINS. The section files (in the directory of this name) that hold the rows of table C: one row for each key of the GLSL fixture
// (src/core/spec-conformance/fixtures/glsl-es300-names.json, GLSL ES 3.00 revision 6). Its six
// lists are the built-in functions, the built-in variables, the types, the qualifiers, the
// statements and the preprocessor. Proposal 0059 (Rules 11.14 to 11.18) defines the statuses.
// The classification was ported from the step-1 inventory of proposal 0059 on 2026-10-12.
//
// HOW A ROW READS. `covers` names every key the row covers. Each key is covered by exactly one
// row. `evidence` gives the file:line of this tree that grounds the statuses. `note` gives the
// reason of a row. A cell that has two statuses keeps its first status, and the second goes into
// the cell's note, starting `also: `.
//
// THE WRITER OWNS THE PREPROCESSOR. The author writes TypeScript, which has no directive, so each
// directive key is `n/a` on the author's side. The GLSL writer emits the lines it needs: `#version`,
// `#extension`, `#define`, and `#ifndef` with `#endif` around an override default
// (src/core/backends/glsl.ts:2300-2329). One host export writes a conditional ladder:
// `variantFamily().emitGuarded` (src/core/variant-family.ts) writes `#if`, `#elif`, `#endif` and
// `defined(X)` for a host that owns the define. Its rows keep the author's cell `n/a` and name the
// host route in the note. An override is the portable form; the writer lowers it to `#define`.
//
// HOW IT IS CHECKED. scripts/bake-capability-coverage.ts holds these rows to the keys of
// scripts/capability-sources.ts. The test of Rules 11.14 to 11.18 fails on a key with no row, on a
// row with no key, and on a status the model does not allow.

import { TRIGONOMETRY_AND_EXPONENTIAL_ROWS } from './glsl/trigonometry-and-exponential.js';
import { COMMON_FUNCTIONS_ROWS } from './glsl/common-functions.js';
import { FLOAT_BITS_AND_PACKING_ROWS } from './glsl/float-bits-and-packing.js';
import { GEOMETRIC_AND_MATRIX_ROWS } from './glsl/geometric-and-matrix.js';
import { VECTOR_RELATIONAL_ROWS } from './glsl/vector-relational.js';
import { TEXTURE_LOOKUPS_ROWS } from './glsl/texture-lookups.js';
import { DERIVATIVES_AND_BUILT_IN_VARIABLES_ROWS } from './glsl/derivatives-and-built-in-variables.js';
import { TYPES_AND_QUALIFIERS_ROWS } from './glsl/types-and-qualifiers.js';
import { STATEMENTS_AND_PREPROCESSOR_ROWS } from './glsl/statements-and-preprocessor.js';
import type { Row } from './model.js';

export const GLSL_ROWS: readonly Row[] = [
  ...TRIGONOMETRY_AND_EXPONENTIAL_ROWS,
  ...COMMON_FUNCTIONS_ROWS,
  ...FLOAT_BITS_AND_PACKING_ROWS,
  ...GEOMETRIC_AND_MATRIX_ROWS,
  ...VECTOR_RELATIONAL_ROWS,
  ...TEXTURE_LOOKUPS_ROWS,
  ...DERIVATIVES_AND_BUILT_IN_VARIABLES_ROWS,
  ...TYPES_AND_QUALIFIERS_ROWS,
  ...STATEMENTS_AND_PREPROCESSOR_ROWS,
];
