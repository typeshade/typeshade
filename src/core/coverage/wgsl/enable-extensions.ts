import { gap, na, refused, type Row, typed } from '../model.js';

export const ENABLE_EXTENSIONS_ROWS: readonly Row[] = [
  {
    table: 'B',
    kind: 'WGSL enable extension',
    name: '`atomic_vec2u_min_max`',
    covers: ['wgsl:enableExtensions:atomic_vec2u_min_max'],
    evidence: 'docs/roadmap.md:304',
    webgpu: gap(9, 'roadmap After 1.0, docs/roadmap.md:304; no proposal names it', 640),
    webgl2: na('a vector atomic is not supported yet on any tier; the WebGPU row is the open work'),
  },
  {
    table: 'B',
    kind: 'WGSL enable extension',
    name: '`clip_distances`',
    covers: ['wgsl:enableExtensions:clip_distances'],
    evidence: 'src/core/backends/wgsl.ts#WGSL_CAP_PROFILE.clipDistances',
    webgpu: typed('src/compiler/ts/builtin-values.test.ts', 'derived; surface §50'),
    webgl2: gap(10, 'WEBGL_clip_cull_distance', 641),
  },
  {
    table: 'B',
    kind: 'WGSL enable extension',
    name: '`dual_source_blending`',
    covers: ['wgsl:enableExtensions:dual_source_blending'],
    evidence: 'docs/use-typeshade-surface.md:6297',
    webgpu: typed('src/compiler/ts/entry-io-attributes.test.ts', 'derived from @blend_src'),
    webgl2: gap(10, 'WEBGL_blend_func_extended', 641),
  },
  {
    table: 'B',
    kind: 'WGSL enable extension',
    name: '`f16`',
    covers: ['wgsl:enableExtensions:f16'],
    evidence:
      'docs/language-design.md:314-318; src/core/backends/capability-reachability.test.ts:9-12',
    note: 'declarable, no value (Rule 4.7)',
    webgpu: refused('Rule 4.7', 'none: nothing an author writes uses f16 (Rule 4.7)'),
    webgl2: refused('Rule 4.7', 'none: nothing an author writes uses f16 (Rule 4.7)'),
  },
  {
    table: 'B',
    kind: 'WGSL enable extension',
    name: '`primitive_index`',
    covers: ['wgsl:enableExtensions:primitive_index'],
    evidence: 'docs/use-typeshade-surface.md:5838',
    webgpu: typed('src/compiler/ts/builtin-values.test.ts', 'derived'),
    webgl2: na('GLSL ES 3.00 has no gl_PrimitiveID'),
  },
  {
    table: 'B',
    kind: 'WGSL enable extension',
    name: '`subgroup_size_control`',
    covers: ['wgsl:enableExtensions:subgroup_size_control'],
    evidence: 'src/compiler/ts/builtin-check.ts#WGSL_ATTRIBUTES_ELSEWHERE',
    webgpu: gap(
      12,
      'refused today with no rule number: src/compiler/ts/builtin-check.ts:226-228 (the attribute @subgroup_size is not applied); §14 row, docs/language-design.md:1506; roadmap After 1.0, docs/roadmap.md:306',
      536,
    ),
    webgl2: na('not supported yet; on WebGL2 a subgroup is one invocation (Rule 11.21)'),
  },
  {
    table: 'B',
    kind: 'WGSL enable extension',
    name: '`subgroups`',
    covers: ['wgsl:enableExtensions:subgroups'],
    evidence:
      'docs/use-typeshade-surface.md:5855-5858; src/compiler/ts/enables.ts#collectEnables~"ENABLE_PREFIX.length"',
    note: 'change 0117: derived by the 21 subgroup functions and the four built-in values, or spelled as the string directive',
    webgpu: typed('src/compiler/ts/subgroups.test.ts'),
    webgl2: typed(
      'src/compiler/ts/subgroups.test.ts',
      'one invocation (Rule 11.21): the capability has an empty GLSL profile row, src/core/backends/glsl.ts',
    ),
  },
];
