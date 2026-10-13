// ═══ Capability coverage: the rows of the table, joined in table order ═══
//
// WHAT THIS FILE IS. The one module that joins the six data files of this directory.
// `COVERAGE_ROWS` lists their rows in the order of the table: table A (the WebGPU objects, then the
// dictionaries, then the enum types), table B (WGSL), table C (GLSL ES 3.00) and table D (the WebGL2
// host API). The bake (scripts/bake-capability-coverage.ts) and the coverage test read it. The model
// (the statuses, the escape hatches, the gap groups and the row builders) is re-exported, so a reader
// imports one module.
//
// Proposal 0059 defines the statuses; Rules 11.14 to 11.18 of docs/language-design.md hold the table.

import { WEBGPU_OBJECT_ROWS } from './webgpu-objects.js';
import { WEBGPU_DICTIONARY_ROWS } from './webgpu-dictionaries.js';
import { WEBGPU_ENUM_ROWS } from './webgpu-enums.js';
import { WGSL_ROWS } from './wgsl.js';
import { GLSL_ROWS } from './glsl.js';
import { WEBGL2_HOST_ROWS } from './webgl2-host.js';
import type { Row } from './model.js';

export * from './model.js';

/** Every row of the coverage table, in table order: A (objects, dictionaries, enums), B, C, D. */
export const COVERAGE_ROWS: readonly Row[] = [
  ...WEBGPU_OBJECT_ROWS,
  ...WEBGPU_DICTIONARY_ROWS,
  ...WEBGPU_ENUM_ROWS,
  ...WGSL_ROWS,
  ...GLSL_ROWS,
  ...WEBGL2_HOST_ROWS,
];
