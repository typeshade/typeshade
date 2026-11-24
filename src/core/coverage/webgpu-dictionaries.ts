// ═══ Capability coverage, table A: the dictionaries of the WebGPU host API ═══
//
// WHAT THIS FILE JOINS. The section files (in the directory of this name) that hold the rows of the 63 dictionary interfaces of table A, one row per source key:
// 194 members of 62 interfaces, and `GPUExternalTextureBindingLayout`, which has no member and is one
// row. The keys are read from `@webgpu/types` by `scripts/capability-sources.ts`. Rules 11.14 and
// 11.15 hold each key to exactly one row of this file or its directory.
//
// ORIGIN. The rows were ported from the step-1 inventory of proposal 0059 (2026-10-12). Each row was
// then classified against the code of this tree.
//
// HOW A ROW IS WRITTEN. `covers` names the source key of the row. `evidence` gives the `file:line`
// where the code reaches the capability, joined by `; `. Each target has one status (Rule 11.14).
// `typed` names the test that reads the capability (Rule 11.18). `raw` names an escape hatch of Rule
// 11.17. `andGap` adds a sub-gap to a `typed`, `raw` or `planned` cell: the part of the capability
// that has no typed spelling. `gap` names a group of the gap register and its issue, when one is
// filed. `planned` names a proposal in `changes/`. `n/a` gives its reason. `refused` names a rule and
// a portable spelling. A second status in a note starts with `also: `.
//
// A WebGL2 cell is `n/a` where the WebGL2 tier has no such object or concept: a bind group, a bind
// group layout, a pipeline layout, a shader module, a WebGPU canvas configuration, a texture view or a
// usage flag. The WebGL2 tier sets its bindings by name (Rule 11.11). The WebGL2 cells of
// `GPUCanvasConfiguration.colorSpace` and `.alphaMode` are `raw`: the host sets the context attributes.
//
// Every row is written out by name, so a member that a new `@webgpu/types` adds has no row, and the
// test fails on it.

import { STRICT_AND_BIND_GROUP_ROWS } from './webgpu-dictionaries/strict-and-bind-group.js';
import { BLEND_AND_BUFFER_ROWS } from './webgpu-dictionaries/blend-and-buffer.js';
import { CANVAS_AND_COLOR_TARGET_ROWS } from './webgpu-dictionaries/canvas-and-color-target.js';
import { COMPUTE_PASS_AND_EXTERNAL_COPY_ROWS } from './webgpu-dictionaries/compute-pass-and-external-copy.js';
import { DEPTH_STENCIL_STATE_ROWS } from './webgpu-dictionaries/depth-stencil-state.js';
import { DEVICE_EXTENT_FRAGMENT_AND_MULTISAMPLE_ROWS } from './webgpu-dictionaries/device-extent-fragment-and-multisample.js';
import { ORIGIN_AND_PIPELINE_BASES_ROWS } from './webgpu-dictionaries/origin-and-pipeline-bases.js';
import { PRIMITIVE_STAGE_AND_QUERY_SET_ROWS } from './webgpu-dictionaries/primitive-stage-and-query-set.js';
import { RENDER_PASS_ATTACHMENTS_ROWS } from './webgpu-dictionaries/render-pass-attachments.js';
import { RENDER_PASS_DESCRIPTOR_AND_LAYOUT_ROWS } from './webgpu-dictionaries/render-pass-descriptor-and-layout.js';
import { RENDER_PIPELINE_AND_ADAPTER_OPTIONS_ROWS } from './webgpu-dictionaries/render-pipeline-and-adapter-options.js';
import { SAMPLER_AND_SHADER_MODULE_ROWS } from './webgpu-dictionaries/sampler-and-shader-module.js';
import { STENCIL_AND_TEXEL_COPY_ROWS } from './webgpu-dictionaries/stencil-and-texel-copy.js';
import { TEXTURE_DESCRIPTOR_ROWS } from './webgpu-dictionaries/texture-descriptor.js';
import { TEXTURE_VIEW_DESCRIPTOR_ROWS } from './webgpu-dictionaries/texture-view-descriptor.js';
import { VERTEX_STATE_AND_BASES_ROWS } from './webgpu-dictionaries/vertex-state-and-bases.js';
import type { Row } from './model.js';

export const WEBGPU_DICTIONARY_ROWS: readonly Row[] = [
  ...STRICT_AND_BIND_GROUP_ROWS,
  ...BLEND_AND_BUFFER_ROWS,
  ...CANVAS_AND_COLOR_TARGET_ROWS,
  ...COMPUTE_PASS_AND_EXTERNAL_COPY_ROWS,
  ...DEPTH_STENCIL_STATE_ROWS,
  ...DEVICE_EXTENT_FRAGMENT_AND_MULTISAMPLE_ROWS,
  ...ORIGIN_AND_PIPELINE_BASES_ROWS,
  ...PRIMITIVE_STAGE_AND_QUERY_SET_ROWS,
  ...RENDER_PASS_ATTACHMENTS_ROWS,
  ...RENDER_PASS_DESCRIPTOR_AND_LAYOUT_ROWS,
  ...RENDER_PIPELINE_AND_ADAPTER_OPTIONS_ROWS,
  ...SAMPLER_AND_SHADER_MODULE_ROWS,
  ...STENCIL_AND_TEXEL_COPY_ROWS,
  ...TEXTURE_DESCRIPTOR_ROWS,
  ...TEXTURE_VIEW_DESCRIPTOR_ROWS,
  ...VERTEX_STATE_AND_BASES_ROWS,
];
