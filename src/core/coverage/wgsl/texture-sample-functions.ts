import { andGap, gap, type Row, typed } from '../model.js';

export const TEXTURE_SAMPLE_FUNCTIONS_ROWS: readonly Row[] = [
  {
    table: 'B',
    kind: 'WGSL built-in function',
    name: '`textureSample`',
    covers: ['wgsl:builtinFunctions:textureSample'],
    evidence:
      'src/core/intrinsics.ts:290; src/core/spec-conformance/coredef-texture-overloads.test.ts:263; src/core/spec-conformance/coredef-texture-overloads.test.ts:271; docs/use-typeshade-surface.md:4311-4318',
    note: 'INTRINSICS row with a GLSL spelling',
    webgpu: andGap(
      typed('src/compiler/ts/texture-dims.test.ts'),
      9,
      'the offset overloads are refused (TS8019); roadmap 13c, docs/roadmap.md:229; a plain read of a depth texture is refused on both targets (TS8099), stricter than WGSL; docs/use-typeshade-surface.md:4311-4318',
      162,
    ),
    webgl2: andGap(
      typed('src/compiler/ts/texture-dims.test.ts'),
      9,
      'the offset overloads are refused (TS8019); roadmap 13c, docs/roadmap.md:229; a plain read of a depth texture is refused on both targets (TS8099), stricter than WGSL; docs/use-typeshade-surface.md:4311-4318',
      162,
    ),
  },
  {
    table: 'B',
    kind: 'WGSL built-in function',
    name: '`textureSampleBaseClampToEdge`',
    covers: ['wgsl:builtinFunctions:textureSampleBaseClampToEdge'],
    evidence:
      'src/core/spec-conformance/coredef-texture-overloads.test.ts:266; src/compiler/ts/codes.ts#TS_CODES.UNKNOWN_FN',
    webgpu: gap(
      9,
      'not spelled: the front end raises TS8004 (UNKNOWN_FN); roadmap 13c, docs/roadmap.md:229',
      162,
    ),
    webgl2: gap(
      9,
      'the front end raises TS8004 (UNKNOWN_FN); a WebGL2 lowering would need textureLod with coordinates clamped to the edge of the base level; roadmap 13c, docs/roadmap.md:229',
      162,
    ),
  },
  {
    table: 'B',
    kind: 'WGSL built-in function',
    name: '`textureSampleBias`',
    covers: ['wgsl:builtinFunctions:textureSampleBias'],
    evidence:
      'src/core/intrinsics.ts:339; src/core/spec-conformance/coredef-texture-overloads.test.ts:263',
    note: 'INTRINSICS row with a GLSL spelling',
    webgpu: andGap(
      typed('src/compiler/ts/texture-dims.test.ts'),
      9,
      'the offset overloads are refused (TS8019); roadmap 13c, docs/roadmap.md:229',
      162,
    ),
    webgl2: andGap(
      typed('src/compiler/ts/texture-dims.test.ts'),
      9,
      'the offset overloads are refused (TS8019); roadmap 13c, docs/roadmap.md:229',
      162,
    ),
  },
  {
    table: 'B',
    kind: 'WGSL built-in function',
    name: '`textureSampleCompare`',
    covers: ['wgsl:builtinFunctions:textureSampleCompare'],
    evidence:
      'src/core/intrinsics.ts#INTRINSICS.textureLoad; src/core/spec-conformance/coredef-texture-overloads.test.ts:263',
    note: 'INTRINSICS row with a GLSL spelling',
    webgpu: andGap(
      typed('src/compiler/ts/depth-textures.test.ts'),
      9,
      'the offset overloads are refused (TS8019); roadmap 13c, docs/roadmap.md:229',
      162,
    ),
    webgl2: andGap(
      typed('src/compiler/ts/depth-textures.test.ts'),
      9,
      'the offset overloads are refused (TS8019); roadmap 13c, docs/roadmap.md:229',
      162,
    ),
  },
  {
    table: 'B',
    kind: 'WGSL built-in function',
    name: '`textureSampleCompareLevel`',
    covers: ['wgsl:builtinFunctions:textureSampleCompareLevel'],
    evidence:
      'src/core/intrinsics.ts:773; src/core/spec-conformance/coredef-texture-overloads.test.ts:263',
    note: 'INTRINSICS row with a GLSL spelling',
    webgpu: andGap(
      typed('src/compiler/ts/depth-textures.test.ts'),
      9,
      'the offset overloads are refused (TS8019); roadmap 13c, docs/roadmap.md:229',
      162,
    ),
    webgl2: andGap(
      typed('src/compiler/ts/depth-textures.test.ts'),
      9,
      'the offset overloads are refused (TS8019); roadmap 13c, docs/roadmap.md:229',
      162,
    ),
  },
  {
    table: 'B',
    kind: 'WGSL built-in function',
    name: '`textureSampleGrad`',
    covers: ['wgsl:builtinFunctions:textureSampleGrad'],
    evidence:
      'src/core/intrinsics.ts:350; src/core/spec-conformance/coredef-texture-overloads.test.ts:263',
    note: 'INTRINSICS row with a GLSL spelling',
    webgpu: andGap(
      typed('src/compiler/ts/texture-dims.test.ts'),
      9,
      'the offset overloads are refused (TS8019); roadmap 13c, docs/roadmap.md:229',
      162,
    ),
    webgl2: andGap(
      typed('src/compiler/ts/texture-dims.test.ts'),
      9,
      'the offset overloads are refused (TS8019); roadmap 13c, docs/roadmap.md:229',
      162,
    ),
  },
  {
    table: 'B',
    kind: 'WGSL built-in function',
    name: '`textureSampleLevel`',
    covers: ['wgsl:builtinFunctions:textureSampleLevel'],
    evidence:
      'src/core/intrinsics.ts:300; src/core/spec-conformance/coredef-texture-overloads.test.ts:263; src/core/spec-conformance/coredef-texture-overloads.test.ts:271; docs/use-typeshade-surface.md:4311-4318',
    note: 'INTRINSICS row with a GLSL spelling',
    webgpu: andGap(
      typed('src/compiler/ts/texture-dims.test.ts'),
      9,
      'the offset overloads are refused (TS8019); roadmap 13c, docs/roadmap.md:229; a plain read of a depth texture is refused on both targets (TS8099), stricter than WGSL; docs/use-typeshade-surface.md:4311-4318',
      162,
    ),
    webgl2: andGap(
      typed('src/compiler/ts/texture-dims.test.ts'),
      9,
      'the offset overloads are refused (TS8019); roadmap 13c, docs/roadmap.md:229; a plain read of a depth texture is refused on both targets (TS8099), stricter than WGSL; docs/use-typeshade-surface.md:4311-4318',
      162,
    ),
  },
];
