// ═══ Capability coverage, table B: one row per WGSL key ═══
//
// WHAT THIS FILE JOINS. The section files (in the directory of this name) that hold the rows of table B: one row for each key of the WGSL fixture
// (src/core/spec-conformance/fixtures/wgsl-names.json, pinned at gpuweb/gpuweb 358eebc8). Its eight
// lists are the built-in functions, the predeclared types, the type generators, the built-in
// values, the attributes, the keywords, the enable extensions and the language extensions.
// `reservedWords` is not a capability and has no row. Rules 11.14 to 11.18 of
// docs/language-design.md define the statuses. This file gives each key one status per target.
// Rule 1.4 rests on the `diagnostic` rows of src/core/coverage/wgsl/attributes.ts and src/core/coverage/wgsl/keywords.ts.
// HOW A ROW READS. `covers` names the one key. `evidence` gives the file:line in the repository that
// grounds the statuses. `note` gives the reason of the row. A part of a capability that has no typed
// spelling inside a typed, raw or planned cell is a sub-gap, written with `andGap`. A second status in
// a note starts with `also: `. A form of the language that names no key is written on the keyword row
// it belongs to: the do…while statement and the labelled statement as sub-gaps of `while`, `break` and
// `continue`; the break if form of a continuing clause in the note of `continuing`.
//
// This table was ported from the step-1 inventory of proposal 0059 on 2026-10-12.
//
// HOW IT IS CHECKED. scripts/bake-capability-coverage.ts reads these rows and holds them to the
// keys of scripts/capability-sources.ts. The test of Rules 11.14 to 11.18 fails on a key with no
// row, on a row with no key, and on a status the model does not allow.

import { FUNCTIONS_ABS_TO_ATANH_ROWS } from './wgsl/functions-abs-to-atanh.js';
import { ATOMIC_FUNCTIONS_ROWS } from './wgsl/atomic-functions.js';
import { BITCAST_BUFFER_AND_DOT_FUNCTIONS_ROWS } from './wgsl/bitcast-buffer-and-dot-functions.js';
import { DERIVATIVE_AND_FLOAT_FUNCTIONS_ROWS } from './wgsl/derivative-and-float-functions.js';
import { FUNCTIONS_I32_TO_NORMALIZE_ROWS } from './wgsl/functions-i32-to-normalize.js';
import { PACK_FUNCTIONS_ROWS } from './wgsl/pack-functions.js';
import { QUAD_TO_STEP_FUNCTIONS_ROWS } from './wgsl/quad-to-step-functions.js';
import { STORAGE_BARRIER_AND_SUBGROUP_ARITHMETIC_ROWS } from './wgsl/storage-barrier-and-subgroup-arithmetic.js';
import { SUBGROUP_REDUCTIONS_AND_SHUFFLES_ROWS } from './wgsl/subgroup-reductions-and-shuffles.js';
import { TEXTURE_QUERY_AND_LOAD_FUNCTIONS_ROWS } from './wgsl/texture-query-and-load-functions.js';
import { TEXTURE_SAMPLE_FUNCTIONS_ROWS } from './wgsl/texture-sample-functions.js';
import { FUNCTIONS_TEXTURE_STORE_TO_WORKGROUP_UNIFORM_LOAD_ROWS } from './wgsl/functions-texture-store-to-workgroup-uniform-load.js';
import { PREDECLARED_TYPES_ROWS } from './wgsl/predeclared-types.js';
import { TYPE_GENERATORS_ROWS } from './wgsl/type-generators.js';
import { BUILT_IN_VALUES_ROWS } from './wgsl/built-in-values.js';
import { ATTRIBUTES_ROWS } from './wgsl/attributes.js';
import { KEYWORDS_ROWS } from './wgsl/keywords.js';
import { ENABLE_EXTENSIONS_ROWS } from './wgsl/enable-extensions.js';
import { LANGUAGE_EXTENSIONS_ROWS } from './wgsl/language-extensions.js';
import type { Row } from './model.js';

export const WGSL_ROWS: readonly Row[] = [
  ...FUNCTIONS_ABS_TO_ATANH_ROWS,
  ...ATOMIC_FUNCTIONS_ROWS,
  ...BITCAST_BUFFER_AND_DOT_FUNCTIONS_ROWS,
  ...DERIVATIVE_AND_FLOAT_FUNCTIONS_ROWS,
  ...FUNCTIONS_I32_TO_NORMALIZE_ROWS,
  ...PACK_FUNCTIONS_ROWS,
  ...QUAD_TO_STEP_FUNCTIONS_ROWS,
  ...STORAGE_BARRIER_AND_SUBGROUP_ARITHMETIC_ROWS,
  ...SUBGROUP_REDUCTIONS_AND_SHUFFLES_ROWS,
  ...TEXTURE_QUERY_AND_LOAD_FUNCTIONS_ROWS,
  ...TEXTURE_SAMPLE_FUNCTIONS_ROWS,
  ...FUNCTIONS_TEXTURE_STORE_TO_WORKGROUP_UNIFORM_LOAD_ROWS,
  ...PREDECLARED_TYPES_ROWS,
  ...TYPE_GENERATORS_ROWS,
  ...BUILT_IN_VALUES_ROWS,
  ...ATTRIBUTES_ROWS,
  ...KEYWORDS_ROWS,
  ...ENABLE_EXTENSIONS_ROWS,
  ...LANGUAGE_EXTENSIONS_ROWS,
];
