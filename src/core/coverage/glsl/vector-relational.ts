import { gap, type Row, typed } from '../model.js';

export const VECTOR_RELATIONAL_ROWS: readonly Row[] = [
  {
    table: 'C',
    kind: 'GLSL built-in function',
    name: '`lessThan`',
    covers: ['glsl:builtinFunctions:8.7:lessThan'],
    evidence:
      "docs/language-design.md:504 (Rule 7.1); src/core/backends/glsl.ts:650; src/compiler/ts/lower/operator-kinds.ts#FAMILY~\"'<': 'ordering'\"|operatorKindRefusal~\"t.kind === 'vec') return undefined;\"",
    note: 'the `<` operator on vectors (Rule 7.1)',
    webgpu: typed('src/compiler/ts/bool-vectors.test.ts'),
    webgl2: typed('src/compiler/ts/bool-vectors.test.ts'),
  },
  {
    table: 'C',
    kind: 'GLSL built-in function',
    name: '`lessThanEqual`',
    covers: ['glsl:builtinFunctions:8.7:lessThanEqual'],
    evidence:
      'docs/language-design.md:504 (Rule 7.1); src/core/backends/glsl.ts:651; src/compiler/ts/lower/operator-kinds.ts#FAMILY',
    note: '`<=`',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test asserts the WGSL text of a vector `<=`',
      645,
    ),
    webgl2: typed('src/compiler/ts/bool-vectors.test.ts'),
  },
  {
    table: 'C',
    kind: 'GLSL built-in function',
    name: '`greaterThan`',
    covers: ['glsl:builtinFunctions:8.7:greaterThan'],
    evidence:
      "docs/language-design.md:504 (Rule 7.1); src/core/backends/glsl.ts:652; src/compiler/ts/lower/operator-kinds.ts#FAMILY~\"'>': 'ordering'\"|operatorKindRefusal~\"t.kind === 'vec') return undefined;\"",
    note: '`>`',
    webgpu: typed('examples/shade-examples.test.ts'),
    webgl2: typed('src/compiler/ts/bool-vectors.test.ts'),
  },
  {
    table: 'C',
    kind: 'GLSL built-in function',
    name: '`greaterThanEqual`',
    covers: ['glsl:builtinFunctions:8.7:greaterThanEqual'],
    evidence:
      'docs/language-design.md:504 (Rule 7.1); src/core/backends/glsl.ts:653; src/compiler/ts/lower/operator-kinds.ts#FAMILY',
    note: '`>=`',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test asserts the WGSL text of a vector `>=`',
      645,
    ),
    webgl2: typed('src/compiler/ts/bool-vectors.test.ts'),
  },
  {
    table: 'C',
    kind: 'GLSL built-in function',
    name: '`equal`',
    covers: ['glsl:builtinFunctions:8.7:equal'],
    evidence:
      'docs/language-design.md:504 (Rule 7.1); src/core/backends/glsl.ts:654; src/compiler/ts/lower/operator-kinds.ts#FAMILY',
    note: '`==`',
    webgpu: typed('src/compiler/ts/bool-vectors.test.ts'),
    webgl2: typed('src/compiler/ts/bool-vectors.test.ts'),
  },
  {
    table: 'C',
    kind: 'GLSL built-in function',
    name: '`notEqual`',
    covers: ['glsl:builtinFunctions:8.7:notEqual'],
    evidence:
      'docs/language-design.md:504 (Rule 7.1); src/core/backends/glsl.ts:655; src/compiler/ts/lower/operator-kinds.ts#FAMILY',
    note: '`!=`',
    webgpu: typed('src/compiler/ts/operators-statements.test.ts'),
    webgl2: typed('src/compiler/ts/bool-vectors.test.ts'),
  },
  {
    table: 'C',
    kind: 'GLSL built-in function',
    name: '`any`',
    covers: ['glsl:builtinFunctions:8.7:any'],
    evidence: 'src/core/intrinsics.ts:1106',
    note: 'same WGSL name',
    webgpu: typed('src/compiler/ts/builtins.test.ts'),
    webgl2: typed('src/compiler/ts/builtins.test.ts'),
  },
  {
    table: 'C',
    kind: 'GLSL built-in function',
    name: '`all`',
    covers: ['glsl:builtinFunctions:8.7:all'],
    evidence: 'src/core/intrinsics.ts#INTRINSIC_HELPERS',
    note: 'same WGSL name',
    webgpu: typed('src/compiler/ts/builtins.test.ts'),
    webgl2: typed('src/compiler/ts/builtins.test.ts'),
  },
  {
    table: 'C',
    kind: 'GLSL built-in function',
    name: '`not`',
    covers: ['glsl:builtinFunctions:8.7:not'],
    evidence: 'src/compiler/ts/lower/expression.ts:554-555',
    note: '`!` on a bool vector',
    webgpu: typed('src/compiler/ts/bool-vectors.test.ts'),
    webgl2: typed('src/compiler/ts/bool-vectors.test.ts'),
  },
];
