// ═══ Capability coverage, table A: one row per WebGPU enum type ═══
//
// WHAT THIS FILE JOINS. The section files (in the directory of this name) that hold the rows of table A for the enum types of `@webgpu/types`: a type alias
// whose body is a union of string literals (proposal 0059, Rule 11.14). One row covers one enum
// type, which is one source key, so the values of the enum are not listed here. The member count
// the source reader finds opens the note of each row.
//
// HOW A ROW READS. `covers` names the one key. `evidence` gives the file:line of this tree that
// grounds the statuses. `note` is the note the classification gives the row. A second status of a
// cell starts `also: `. A part of the capability with no typed spelling is a sub-gap, given with
// `andGap`. On an enum row, a sub-gap names a value of the enum or a part the classification noted.
// A use of the enum by a member, such as a stencil compare or a stencil load op, is the row of that
// member.
//
// ORIGIN. The classification was ported from the step-1 inventory of proposal 0059 on 2026-10-12.
// Each `file:line` is a line of the tree at the commit that holds these rows.
//
// HOW IT IS CHECKED. scripts/bake-capability-coverage.ts reads these rows and holds them to the
// keys of scripts/capability-sources.ts. The test of Rules 11.14 to 11.18 fails on a key with no
// row and on a row with no key. A status changes only by an edit in this file or its directory and a re-bake of
// docs/capability-coverage.md. Do not hand-edit the generated document.

import { ADDRESS_MODE_TO_INDEX_FORMAT_ROWS } from './webgpu-enums/address-mode-to-index-format.js';
import { LOAD_OP_TO_VERTEX_STEP_MODE_ROWS } from './webgpu-enums/load-op-to-vertex-step-mode.js';
import type { Row } from './model.js';

export const WEBGPU_ENUM_ROWS: readonly Row[] = [
  ...ADDRESS_MODE_TO_INDEX_FORMAT_ROWS,
  ...LOAD_OP_TO_VERTEX_STEP_MODE_ROWS,
];
