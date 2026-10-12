// ═══ Capability coverage: the types of the one-status-per-target table and its builders ═══
//
// WHAT THE TABLE IS. The coverage table gives every capability of WebGPU and of WebGL2 exactly one
// status per target: `typed`, `raw`, `refused`, `planned`, `gap` or `n/a`. Rules 11.14 to 11.18 of
// docs/language-design.md (proposal 0059) define it. Appendix C says where the table is and how it
// is baked.
//
// WHAT THIS DIRECTORY IS. The hand-maintained classification of the table: one row per source key
// or group of source keys, written in six data files (webgpu-objects.ts, webgpu-dictionaries.ts,
// webgpu-enums.ts, wgsl.ts, glsl.ts, webgl2-host.ts) and joined by index.ts. This file holds the
// types, the escape hatches of Rule 11.17, the gap groups and the builders the rows use. It imports
// nothing.
//
// HOW IT REACHES THE DOCUMENTS. scripts/bake-capability-coverage.ts reads these rows, checks them
// against the sources of Appendix C and writes two generated texts: docs/capability-coverage.md,
// and the block of Appendix C of docs/language-design.md that lies between
// `<!-- capability-coverage:begin` and `<!-- capability-coverage:end -->`. Neither generated text
// is edited by hand. A status changes only by an edit in this directory and a re-bake of both.

/** The six statuses of Rule 11.14. Each capability has exactly one of them on each target. */
export type Status = 'typed' | 'raw' | 'refused' | 'planned' | 'gap' | 'n/a';

/** The four tables: A, the WebGPU host API; B, WGSL; C, GLSL ES 3.00; D, the WebGL2 host API. */
export type TableId = 'A' | 'B' | 'C' | 'D';

/** The escape hatches of Rule 11.17, as the rule spells them between backticks, in its order.
 *  The test reads the rule's text and fails when this list and the rule differ (one authority). */
export const ESCAPE_HATCHES = [
  'Frame.encoder',
  'RenderPass.raw',
  'Texture.texture',
  'Sampler.sampler',
  'Runtime.device',
  'createRuntime({ device })',
  'GPUBuffer',
  'GPUTexture',
  'GPUTextureView',
  'GPUSampler',
  'WebGLBuffer',
  'WebGLTexture',
  'WebGLSampler',
  'RenderPipeline.draw(pass, …)',
  'ComputePipeline.dispatch(target, …)',
  'Runtime.submit(…encoders)',
] as const;
export type EscapeHatch = (typeof ESCAPE_HATCHES)[number];

/** The gap register. Decision 6 of proposal 0059 takes groups 1 to 12 as the work order; the
 *  register adds groups 13 and 14, and group 15 holds the typed cells no test reads (Rule 11.18). */
export const GAP_GROUPS = {
  1: 'Render state', // stencil, depth bias, scissor, viewport, blend constant, alpha-to-coverage, sample mask, storeOp, read-only depth
  2: 'Vertex input', // formats, per-instance step, several buffers, first/base offsets
  3: 'Multisampling', // resolve target (the WebGL2 multisampled targets are refused, Rule 11.11)
  4: 'Queries and GPU time', // #542
  5: 'Indirect draw and dispatch', // #540
  6: 'Textures', // layer read, layered targets, cube from rt.texture(), viewFormats, compressed, copies, sampler LOD/anisotropy
  7: 'Bindings', // host-placed groups, dynamic offsets, sub-range, immediates (#536)
  8: 'Device', // loss, adapter options; limits are 0051 (#541)
  9: 'WGSL spellings the compiler refuses or lacks', // v.xy =, modf, frexp, offset overloads, textureNumLevels, textureSampleBaseClampToEdge, GLSL-only builtins
  10: 'GLSL lowerings the writer fails closed on', // sample_index/mask, interpolate linear/sample, clip_distances, blend_src, blend apart, rgba8snorm, packed 4x8
  11: 'WebGL2-only doors', // Rule 11.16
  12: 'Refusals without a rule number', // refusals whose reason is written, but no rule number
  13: 'Subgroups', // #536
  14: 'To measure', // provoking vertex, stripIndexFormat, 16-bit norm/rgb9e5 targets, fragment_depth
  15: 'Typed in code, no test reads it', // Rule 11.18: the tests are owed
} as const;
export type GapGroup = keyof typeof GAP_GROUPS; // 1 | 2 | … | 15

/** A sub-gap is the part of a capability with no typed spelling inside a `typed`, `raw` or
 *  `planned` cell. The bake counts it in the gap register, beside the gap cells. */
export interface SubGap {
  readonly group: GapGroup;
  /** The reason. Cites the roadmap or §14 row that names the part, where one does. */
  readonly note: string;
  /** The issue that tracks the sub-gap, a positive integer, once one is filed. */
  readonly issue?: number;
}

/** Must name (0059, statuses table): the test, for each target where the row is `typed` (Rule 11.18). */
export interface Typed {
  readonly status: 'typed';
  /** The repo-relative path of the test that reads the capability on this target. */
  readonly test: string;
  readonly note?: string;
  /** The sub-gap of this cell, when a part of the capability has no typed spelling. */
  readonly subGap?: SubGap;
}

/** Must name (0059, statuses table): the escape hatch, from the list of Rule 11.17. */
export interface Raw {
  readonly status: 'raw';
  readonly hatch: EscapeHatch;
  readonly note?: string;
  /** The sub-gap of this cell, when a part of the capability has no typed spelling. */
  readonly subGap?: SubGap;
}

/** Must name (0059, statuses table): the rule number and the portable spelling. */
export interface Refused {
  readonly status: 'refused';
  /** A `Rule N.M` that docs/language-design.md defines. */
  readonly rule: string;
  /** The portable spelling, or `none: <why>` where none exists. */
  readonly portable: string;
  readonly note?: string;
}

/** Must name (0059, statuses table): the proposal id. */
export interface Planned {
  readonly status: 'planned';
  /** The four-digit id of a proposal file in `changes/`. */
  readonly proposal: string;
  readonly note?: string;
  /** The sub-gap of this cell, when a part of the capability has no typed spelling. */
  readonly subGap?: SubGap;
}

/** Must name (0059, statuses table): the issue, once one is filed (Rule 11.18). */
export interface Gap {
  readonly status: 'gap';
  readonly group: GapGroup;
  /** The reason. Cites the roadmap or §14 row that names the capability, where one does. */
  readonly note: string;
  /** The issue that tracks the gap, a positive integer, once one is filed. */
  readonly issue?: number;
}

/** Must name (0059, statuses table): the reason. */
export interface NotApplicable {
  readonly status: 'n/a';
  readonly reason: string;
}

export type Cell = Typed | Raw | Refused | Planned | Gap | NotApplicable;

/** Rule 11.16's door for a capability only WebGL2 has. `none` means it has not entered yet. */
export type Door =
  | { readonly door: '§9.3'; readonly row: string }
  | { readonly door: '§10'; readonly capability: string }
  | { readonly door: 'none' };

/** One row of the table: a source key or a group of source keys, with its status on each target. */
export interface Row {
  readonly table: TableId;
  /** The kind of source member, for example `WebGPU member`, `WGSL built-in function`. */
  readonly kind: string;
  /** What the table shows. Markdown is allowed (backticks). */
  readonly name: string;
  /** The source keys the row covers. Never empty. Each key is covered by exactly one row. */
  readonly covers: readonly string[];
  /** `file:line` in this tree, joined by `; `. Never empty. */
  readonly evidence: string;
  /** The note column of the classification. */
  readonly note?: string;
  readonly webgpu: Cell;
  readonly webgl2: Cell;
  /** Present only on a row flagged WebGL2-only (Rule 11.16). */
  readonly webgl2Only?: Door;
}

export const typed = (test: string, note?: string): Typed => ({
  status: 'typed',
  test,
  ...(note ? { note } : {}),
});

export const raw = (hatch: EscapeHatch, note?: string): Raw => ({
  status: 'raw',
  hatch,
  ...(note ? { note } : {}),
});

export const refused = (rule: string, portable: string, note?: string): Refused => ({
  status: 'refused',
  rule,
  portable,
  ...(note ? { note } : {}),
});

export const planned = (proposal: string, note?: string): Planned => ({
  status: 'planned',
  proposal,
  ...(note ? { note } : {}),
});

export const gap = (group: GapGroup, note: string, issue?: number): Gap => ({
  status: 'gap',
  group,
  note,
  ...(issue !== undefined ? { issue } : {}),
});

export const na = (reason: string): NotApplicable => ({ status: 'n/a', reason });

/** Adds a sub-gap to a `typed`, `raw` or `planned` cell and returns the new cell; the input is
 *  not changed. A cell holds one sub-gap, so a second call replaces the first. */
export const andGap = <C extends Typed | Raw | Planned>(
  cell: C,
  group: GapGroup,
  note: string,
  issue?: number,
): C => ({
  ...cell,
  subGap: { group, note, ...(issue !== undefined ? { issue } : {}) },
});
