// ═══ Capability coverage, table A: the WebGPU objects of @webgpu/types ═══
//
// WHAT THIS FILE JOINS. The section files (in the directory of this name) that hold one row per source key of the objects of the WebGPU host API: a member of
// an interface (`GPUDevice.createBuffer`), or an interface with no member (`GPUCommandsMixin`).
// The keys come from `scripts/capability-sources.ts` (changes/0059-capability-coverage.md, "The
// sources"). The dictionaries, the enum types and the other tables are in their own files. The
// classification was ported from the step-1 inventory of proposal 0059 on 2026-10-12.
//
// HOW A CELL IS CLASSIFIED. Each key has one status per target (Rule 11.14).
// - `typed` names the test that reads the capability on that target: the repo-relative path of
//   the test. A cell that no test reads is `gap` (Rule 11.18).
// - `raw` names an escape hatch of Rule 11.17. A cell is `raw` when a host can use the capability
//   with a program of the runtime, through that hatch and with no change to the shader. Either the
//   capability takes effect on a draw, a dispatch or a submit that the runtime makes, or the host
//   reads it from an object the hatch gives (the device loss, and the size, usage, map state and write
//   mapping of a host buffer). A query set made on `Runtime.device` is raw: the host's own pass records the
//   runtime's draws with `RenderPipeline.draw`. The typed spelling a raw cell lacks is a sub-gap
//   (`andGap`) of the group that fits.
// - `gap` names its group of GAP_GROUPS and, where one exists, its issue. A hatch can reach the
//   platform object while the capability cannot be used with a program of the runtime. Three cases
//   make a cell `gap`: the runtime builds the pipeline the capability needs (an indirect draw or
//   dispatch, the pipeline state); the runtime sets the state before each pass or draw (the WebGL2
//   viewport, the stencil test that the runtime disables in its image pass, and the scissor test
//   that the runtime disables at each pass start); or the runtime
//   draws at a later call than the host's (a WebGL2 query: the frame runs its draws after
//   submit() returns, so a query the host begins wraps none).
// - `n/a` names its reason: a fact about the platform, or the design rule that leaves the
//   capability out (for example Rule 12.6).
// - `refused` and `planned` name a rule or a proposal.
//
// A canvas context is configured by the host with the device it passes in, through
// `createRuntime({ device })`. It is not an escape hatch of Rule 11.17. A raw cell has no sub-gap
// when no gap group names the part it lacks: the debug labels (`GPUDebugCommandsMixin`), the render
// bundles, the buffer size, usage, map state and write mapping (`GPUBuffer.size`,
// `GPUBuffer.usage`, `GPUBuffer.mapState`, `GPUMapMode.WRITE`, `GPUBufferUsage.MAP_WRITE`), and the
// canvas context configuration (`GPUCanvasContext.*`).
//
// EVIDENCE. Each `file:line` is a line of the tree that adds these rows: `main` at b6432536, with
// the edits to `docs/language-design.md` and `src/runtime/*.ts` that the same commit makes. An issue
// number is never an evidence token. It lives in the `issue` of the cell or of the sub-gap.
import { HOST_SOURCES_ROWS } from './webgpu-objects/host-sources.js';
import { DEVICE_STATE_ROWS } from './webgpu-objects/device-state.js';
import { DEVICE_CREATORS_ROWS } from './webgpu-objects/device-creators.js';
import { DEVICE_LOSS_AND_ERRORS_ROWS } from './webgpu-objects/device-loss-and-errors.js';
import { COMMAND_MIXINS_ROWS } from './webgpu-objects/command-mixins.js';
import { GPU_ENTRY_AND_ADAPTER_ROWS } from './webgpu-objects/gpu-entry-and-adapter.js';
import { BIND_GROUP_BUFFER_AND_CANVAS_CONTEXT_ROWS } from './webgpu-objects/bind-group-buffer-and-canvas-context.js';
import { COMMAND_ENCODER_ROWS } from './webgpu-objects/command-encoder.js';
import { COMPILATION_AND_COMPUTE_PASS_ROWS } from './webgpu-objects/compilation-and-compute-pass.js';
import { ERRORS_AND_PIPELINE_LAYOUT_ROWS } from './webgpu-objects/errors-and-pipeline-layout.js';
import { QUERY_SET_QUEUE_AND_BUNDLES_ROWS } from './webgpu-objects/query-set-queue-and-bundles.js';
import { RENDER_PASS_SAMPLER_AND_SHADER_MODULE_ROWS } from './webgpu-objects/render-pass-sampler-and-shader-module.js';
import { LIMITS_TEXTURES_AND_BIND_GROUPS_ROWS } from './webgpu-objects/limits-textures-and-bind-groups.js';
import { LIMITS_PER_STAGE_BINDINGS_ROWS } from './webgpu-objects/limits-per-stage-bindings.js';
import { LIMITS_VERTEX_ATTACHMENTS_AND_COMPUTE_ROWS } from './webgpu-objects/limits-vertex-attachments-and-compute.js';
import { TEXTURE_AND_NAVIGATORS_ROWS } from './webgpu-objects/texture-and-navigators.js';
import { BUFFER_USAGE_AND_COLOR_WRITE_ROWS } from './webgpu-objects/buffer-usage-and-color-write.js';
import { MAP_MODE_SHADER_STAGE_AND_TEXTURE_USAGE_ROWS } from './webgpu-objects/map-mode-shader-stage-and-texture-usage.js';
import type { Row } from './model.js';

export const WEBGPU_OBJECT_ROWS: readonly Row[] = [
  ...HOST_SOURCES_ROWS,
  ...DEVICE_STATE_ROWS,
  ...DEVICE_CREATORS_ROWS,
  ...DEVICE_LOSS_AND_ERRORS_ROWS,
  ...COMMAND_MIXINS_ROWS,
  ...GPU_ENTRY_AND_ADAPTER_ROWS,
  ...BIND_GROUP_BUFFER_AND_CANVAS_CONTEXT_ROWS,
  ...COMMAND_ENCODER_ROWS,
  ...COMPILATION_AND_COMPUTE_PASS_ROWS,
  ...ERRORS_AND_PIPELINE_LAYOUT_ROWS,
  ...QUERY_SET_QUEUE_AND_BUNDLES_ROWS,
  ...RENDER_PASS_SAMPLER_AND_SHADER_MODULE_ROWS,
  ...LIMITS_TEXTURES_AND_BIND_GROUPS_ROWS,
  ...LIMITS_PER_STAGE_BINDINGS_ROWS,
  ...LIMITS_VERTEX_ATTACHMENTS_AND_COMPUTE_ROWS,
  ...TEXTURE_AND_NAVIGATORS_ROWS,
  ...BUFFER_USAGE_AND_COLOR_WRITE_ROWS,
  ...MAP_MODE_SHADER_STAGE_AND_TEXTURE_USAGE_ROWS,
];
