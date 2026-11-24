import { gap, type Row, typed } from '../model.js';

export const TEXTURE_LOOKUPS_ROWS: readonly Row[] = [
  {
    table: 'C',
    kind: 'GLSL built-in function',
    name: '`textureSize`',
    covers: ['glsl:builtinFunctions:8.8:textureSize'],
    evidence: 'src/compiler/ts/foreign-names.ts:76; src/compiler/ts/math-alias.ts:210',
    note: 'textureDimensions',
    webgpu: typed('src/compiler/ts/texture-dims.test.ts'),
    webgl2: typed('src/core/backends/glsl.test.ts'),
  },
  {
    table: 'C',
    kind: 'GLSL built-in function',
    name: '`texture`',
    covers: ['glsl:builtinFunctions:8.8:texture'],
    evidence: 'src/compiler/ts/foreign-names.ts:71; src/compiler/ts/math-alias.ts:200',
    note: 'textureSample / textureSampleCompare',
    webgpu: typed('src/core/backends/glsl.test.ts'),
    webgl2: typed('src/core/backends/glsl.test.ts'),
  },
  {
    table: 'C',
    kind: 'GLSL built-in function',
    name: '`textureProj`',
    covers: ['glsl:builtinFunctions:8.8:textureProj'],
    evidence:
      'src/compiler/ts/codes.ts:27 (TS8004); src/compiler/ts/lower/expression-call.ts:498 (the unknown-function refusal)',
    webgpu: gap(
      9,
      'no WGSL form; the author divides by w; refused today as TS8004 (measured with compile(), 2026-10-12)',
      640,
    ),
    webgl2: gap(
      9,
      'no WGSL form; the author divides by w; refused today as TS8004 (measured with compile(), 2026-10-12)',
      640,
    ),
  },
  {
    table: 'C',
    kind: 'GLSL built-in function',
    name: '`textureLod`',
    covers: ['glsl:builtinFunctions:8.8:textureLod'],
    evidence: 'src/compiler/ts/foreign-names.ts:73; src/compiler/ts/math-alias.ts:201',
    note: 'textureSampleLevel',
    webgpu: typed('src/core/backends/glsl.test.ts'),
    webgl2: typed('src/core/backends/glsl.test.ts'),
  },
  {
    table: 'C',
    kind: 'GLSL built-in function',
    name: '`textureOffset`',
    covers: ['glsl:builtinFunctions:8.8:textureOffset'],
    evidence:
      'src/compiler/ts/codes.ts:27 (TS8004); src/compiler/ts/lower/expression-call.ts:498 (the unknown-function refusal); docs/roadmap.md:229 (roadmap 0.4 item 13c); docs/use-typeshade-surface.md:4505-4506 (§36)',
    webgpu: gap(
      9,
      'refused by name as TS8004 (measured with compile(), 2026-10-12); WGSL textureSample with an offset is TS8019 (measured with compile(), 2026-10-12); roadmap 0.4 item 13c names the offsets (docs/roadmap.md:229); surface §36 defers them (docs/use-typeshade-surface.md:4505-4506)',
      162,
    ),
    webgl2: gap(
      9,
      'refused by name as TS8004 (measured with compile(), 2026-10-12); roadmap 0.4 item 13c names the offsets (docs/roadmap.md:229); surface §36 defers them (docs/use-typeshade-surface.md:4505-4506)',
      162,
    ),
  },
  {
    table: 'C',
    kind: 'GLSL built-in function',
    name: '`texelFetch`',
    covers: ['glsl:builtinFunctions:8.8:texelFetch'],
    evidence: 'src/compiler/ts/foreign-names.ts:75; src/compiler/ts/math-alias.ts:206',
    note: 'textureLoad',
    webgpu: typed('src/core/backends/glsl.test.ts'),
    webgl2: typed('src/core/backends/glsl.test.ts'),
  },
  {
    table: 'C',
    kind: 'GLSL built-in function',
    name: '`texelFetchOffset`',
    covers: ['glsl:builtinFunctions:8.8:texelFetchOffset'],
    evidence:
      'src/compiler/ts/foreign-names.ts:75 (texelFetch maps to textureLoad, the spelling the offset form uses)',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test reads the offset form textureLoad(t, coord + offset, level), the portable spelling (measured with compile(), 2026-10-12: it compiles on both targets); roadmap 0.4 item 13c names the offsets (docs/roadmap.md:229)',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test reads the offset form textureLoad(t, coord + offset, level), the portable spelling (measured with compile(), 2026-10-12: it compiles on both targets); roadmap 0.4 item 13c names the offsets (docs/roadmap.md:229)',
      645,
    ),
  },
  {
    table: 'C',
    kind: 'GLSL built-in function',
    name: '`textureProjOffset`',
    covers: ['glsl:builtinFunctions:8.8:textureProjOffset'],
    evidence:
      'src/compiler/ts/codes.ts:27 (TS8004); src/compiler/ts/lower/expression-call.ts:498 (the unknown-function refusal); docs/roadmap.md:229 (roadmap 0.4 item 13c); docs/use-typeshade-surface.md:4505-4506 (§36)',
    webgpu: gap(
      9,
      'no WGSL form; a projective offset overload; refused by name as TS8004 (measured with compile(), 2026-10-12); roadmap 0.4 item 13c names the offsets (docs/roadmap.md:229); surface §36 (docs/use-typeshade-surface.md:4505-4506)',
      162,
    ),
    webgl2: gap(
      9,
      'no WGSL form; a projective offset overload; refused by name as TS8004 (measured with compile(), 2026-10-12); roadmap 0.4 item 13c names the offsets (docs/roadmap.md:229); surface §36 (docs/use-typeshade-surface.md:4505-4506)',
      162,
    ),
  },
  {
    table: 'C',
    kind: 'GLSL built-in function',
    name: '`textureLodOffset`',
    covers: ['glsl:builtinFunctions:8.8:textureLodOffset'],
    evidence:
      'src/compiler/ts/codes.ts:27 (TS8004); src/compiler/ts/lower/expression-call.ts:498 (the unknown-function refusal); docs/roadmap.md:229 (roadmap 0.4 item 13c); docs/use-typeshade-surface.md:4505-4506 (§36)',
    webgpu: gap(
      9,
      'offset overload of textureLod; refused by name as TS8004 (measured with compile(), 2026-10-12); roadmap 0.4 item 13c names the offsets (docs/roadmap.md:229); surface §36 defers them (docs/use-typeshade-surface.md:4505-4506)',
      162,
    ),
    webgl2: gap(
      9,
      'offset overload of textureLod; refused by name as TS8004 (measured with compile(), 2026-10-12); roadmap 0.4 item 13c names the offsets (docs/roadmap.md:229); surface §36 defers them (docs/use-typeshade-surface.md:4505-4506)',
      162,
    ),
  },
  {
    table: 'C',
    kind: 'GLSL built-in function',
    name: '`textureProjLod`',
    covers: ['glsl:builtinFunctions:8.8:textureProjLod'],
    evidence:
      'src/compiler/ts/codes.ts:27 (TS8004); src/compiler/ts/lower/expression-call.ts:498 (the unknown-function refusal)',
    webgpu: gap(9, 'no WGSL form; the author divides by w', 640),
    webgl2: gap(9, 'no WGSL form; the author divides by w', 640),
  },
  {
    table: 'C',
    kind: 'GLSL built-in function',
    name: '`textureProjLodOffset`',
    covers: ['glsl:builtinFunctions:8.8:textureProjLodOffset'],
    evidence:
      'src/compiler/ts/codes.ts:27 (TS8004); src/compiler/ts/lower/expression-call.ts:498 (the unknown-function refusal); docs/roadmap.md:229 (roadmap 0.4 item 13c); docs/use-typeshade-surface.md:4505-4506 (§36)',
    webgpu: gap(
      9,
      'no WGSL form; a projective offset overload; refused by name as TS8004 (measured with compile(), 2026-10-12); roadmap 0.4 item 13c names the offsets (docs/roadmap.md:229); surface §36 (docs/use-typeshade-surface.md:4505-4506)',
      162,
    ),
    webgl2: gap(
      9,
      'no WGSL form; a projective offset overload; refused by name as TS8004 (measured with compile(), 2026-10-12); roadmap 0.4 item 13c names the offsets (docs/roadmap.md:229); surface §36 (docs/use-typeshade-surface.md:4505-4506)',
      162,
    ),
  },
  {
    table: 'C',
    kind: 'GLSL built-in function',
    name: '`textureGrad`',
    covers: ['glsl:builtinFunctions:8.8:textureGrad'],
    evidence: 'src/compiler/ts/foreign-names.ts:74; src/compiler/ts/math-alias.ts:203',
    note: 'textureSampleGrad',
    webgpu: typed('src/compiler/ts/texture-dims.test.ts'),
    webgl2: typed('src/compiler/ts/texture-dims.test.ts'),
  },
  {
    table: 'C',
    kind: 'GLSL built-in function',
    name: '`textureGradOffset`',
    covers: ['glsl:builtinFunctions:8.8:textureGradOffset'],
    evidence:
      'src/compiler/ts/codes.ts:27 (TS8004); src/compiler/ts/lower/expression-call.ts:498 (the unknown-function refusal); docs/roadmap.md:229 (roadmap 0.4 item 13c); docs/use-typeshade-surface.md:4505-4506 (§36)',
    webgpu: gap(
      9,
      'offset overload of textureGrad; refused by name as TS8004 (measured with compile(), 2026-10-12); roadmap 0.4 item 13c names the offsets (docs/roadmap.md:229); surface §36 defers them (docs/use-typeshade-surface.md:4505-4506)',
      162,
    ),
    webgl2: gap(
      9,
      'offset overload of textureGrad; refused by name as TS8004 (measured with compile(), 2026-10-12); roadmap 0.4 item 13c names the offsets (docs/roadmap.md:229); surface §36 defers them (docs/use-typeshade-surface.md:4505-4506)',
      162,
    ),
  },
  {
    table: 'C',
    kind: 'GLSL built-in function',
    name: '`textureProjGrad`',
    covers: ['glsl:builtinFunctions:8.8:textureProjGrad'],
    evidence:
      'src/compiler/ts/codes.ts:27 (TS8004); src/compiler/ts/lower/expression-call.ts:498 (the unknown-function refusal)',
    webgpu: gap(9, 'no WGSL form; the author divides by w', 640),
    webgl2: gap(9, 'no WGSL form; the author divides by w', 640),
  },
  {
    table: 'C',
    kind: 'GLSL built-in function',
    name: '`textureProjGradOffset`',
    covers: ['glsl:builtinFunctions:8.8:textureProjGradOffset'],
    evidence:
      'src/compiler/ts/codes.ts:27 (TS8004); src/compiler/ts/lower/expression-call.ts:498 (the unknown-function refusal); docs/roadmap.md:229 (roadmap 0.4 item 13c); docs/use-typeshade-surface.md:4505-4506 (§36)',
    webgpu: gap(
      9,
      'no WGSL form; a projective offset overload; refused by name as TS8004 (measured with compile(), 2026-10-12); roadmap 0.4 item 13c names the offsets (docs/roadmap.md:229); surface §36 (docs/use-typeshade-surface.md:4505-4506)',
      162,
    ),
    webgl2: gap(
      9,
      'no WGSL form; a projective offset overload; refused by name as TS8004 (measured with compile(), 2026-10-12); roadmap 0.4 item 13c names the offsets (docs/roadmap.md:229); surface §36 (docs/use-typeshade-surface.md:4505-4506)',
      162,
    ),
  },
];
