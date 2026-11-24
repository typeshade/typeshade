// ═══ Capability coverage, table D: one row per WebGL2 host capability ═══
//
// WHAT THIS FILE JOINS. The section files (in the directory of this name) that hold the rows of table D: the WebGL2 host API. Each key is a method or a
// non-constant field of the four WebGL2 interfaces of lib.dom.d.ts, a constant that
// CAPABILITY_CONSTANTS names, or an extension that applies to WebGL2
// (src/core/spec-conformance/fixtures/webgl-extensions.json). The keys come from
// scripts/capability-sources.ts (`readWebGl2Host`). Proposal 0059 (Rules 11.14 to 11.18) defines
// the statuses. The rows were ported from the step-1 inventory of proposal 0059 on 2026-10-12.
//
// HOW A ROW READS. `covers` names every key the row covers. Each key is covered by exactly one
// row. `evidence` gives the file:line that grounds the statuses. `note` gives the reason. A cell
// that has a second status names it in its note, starting `also: `. A sub-gap (`andGap`) names
// the part of a capability that has no typed spelling inside a typed, raw or planned cell. An
// issue that tracks the capability of a cell lives in the cell's `issue` (or the sub-gap's
// `issue`). Evidence never names an issue. A note may name the issue of a related capability.
//
// A CONSTANT. A GLenum is a key only when CAPABILITY_CONSTANTS names it. The constants of that set
// have rows of their own. Any other constant is not a key: its capability sits in the row of the
// method that takes it. Table C holds `gl_PointSize`.
//
// RAW ON WEBGL2. `Runtime.device` is the WebGL2 context. A `Runtime.device` cell that sets context
// state is `raw` only where the runtime neither sets nor resets that state before its draws; the
// row cites the source lines. A cell that names a host object (`WebGLTexture`, `WebGLSampler`), a
// read (`getError`, `getExtension`) or the host's own context (`createRuntime({ device })`) is
// `raw` by the hatch it names. Otherwise the cell is `gap`.

import { CONTEXT_AND_EXTENSION_DISCOVERY_ROWS } from './webgl2-host/context-and-extension-discovery.js';
import { LIMITS_SHADERS_AND_UNIFORMS_ROWS } from './webgl2-host/limits-shaders-and-uniforms.js';
import { VERTEX_INPUT_BUFFERS_AND_DRAWS_ROWS } from './webgl2-host/vertex-input-buffers-and-draws.js';
import { TEXTURES_ROWS } from './webgl2-host/textures.js';
import { PIXEL_STORE_AND_SAMPLERS_ROWS } from './webgl2-host/pixel-store-and-samplers.js';
import { FRAMEBUFFERS_AND_READBACK_ROWS } from './webgl2-host/framebuffers-and-readback.js';
import { DEPTH_STENCIL_AND_BLENDING_ROWS } from './webgl2-host/depth-stencil-and-blending.js';
import { RASTERIZER_STATE_ROWS } from './webgl2-host/rasterizer-state.js';
import { TRANSFORM_FEEDBACK_QUERIES_AND_SYNC_ROWS } from './webgl2-host/transform-feedback-queries-and-sync.js';
import { INTROSPECTION_AND_EXTENSIONS_ROWS } from './webgl2-host/introspection-and-extensions.js';
import type { Row } from './model.js';

export const WEBGL2_HOST_ROWS: readonly Row[] = [
  ...CONTEXT_AND_EXTENSION_DISCOVERY_ROWS,
  ...LIMITS_SHADERS_AND_UNIFORMS_ROWS,
  ...VERTEX_INPUT_BUFFERS_AND_DRAWS_ROWS,
  ...TEXTURES_ROWS,
  ...PIXEL_STORE_AND_SAMPLERS_ROWS,
  ...FRAMEBUFFERS_AND_READBACK_ROWS,
  ...DEPTH_STENCIL_AND_BLENDING_ROWS,
  ...RASTERIZER_STATE_ROWS,
  ...TRANSFORM_FEEDBACK_QUERIES_AND_SYNC_ROWS,
  ...INTROSPECTION_AND_EXTENSIONS_ROWS,
];
