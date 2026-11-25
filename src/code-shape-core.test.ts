import { describe, expect, it } from 'vitest';
import { areaOf } from '../scripts/code-shape/areas.js';
import { SKIP_RULES, createContextFromSources } from '../scripts/code-shape/context.js';
import { importEdges } from '../scripts/code-shape/imports.js';
import { parseLayerPolicy } from '../scripts/code-shape/layer-policy.js';
import ts from 'typescript';

describe('areaOf', () => {
  it('splits core and compiler/ts by their directory', () => {
    expect(areaOf('src/core/ir/node.ts')).toBe('core/ir');
    expect(areaOf('src/core/ir/deep/node.ts')).toBe('core/ir');
    expect(areaOf('src/compiler/ts/link/names.ts')).toBe('compiler/ts/link');
  });

  it('keeps a file directly in a split directory in the parent area', () => {
    expect(areaOf('src/core/host-draw.ts')).toBe('core');
    expect(areaOf('src/compiler/ts/compile.ts')).toBe('compiler/ts');
  });

  it('uses the top directory otherwise', () => {
    expect(areaOf('src/rhi/cpu/program.ts')).toBe('rhi');
    expect(areaOf('src/compiler/other/x.ts')).toBe('compiler');
    expect(areaOf('src/index.ts')).toBe('src');
  });
});

describe('createContextFromSources', () => {
  const sources = {
    'src/core/a.ts': `export const a = 1;\n`,
    'src/core/a.test.ts': `export const t = 1;\n`,
    'src/core/testing/helper.ts': `export const h = 1;\n`,
    'src/core/x.generated.ts': `export const g = 1;\n`,
    'src/core/y.shade.ts': `export const s = 1;\n`,
    'src/core/fixtures/f.ts': `export const f = 1;\n`,
    'src/rhi/b.ts': `import { a } from '../core/a.js';\nexport const b = a;\n`,
  };

  it('analyses the files no rule skips and keeps every file in all', () => {
    const ctx = createContextFromSources(sources);
    expect(ctx.analysed.map(ctx.rel).sort()).toEqual(['src/core/a.ts', 'src/rhi/b.ts']);
    expect(ctx.all).toHaveLength(7);
  });

  it('counts each skipped file under the rule that skipped it', () => {
    const ctx = createContextFromSources(sources);
    expect(ctx.skipped).toEqual({
      'test files': 1,
      'testing directories': 1,
      'api directory': 0,
      'fixtures directories': 1,
      'generated files': 1,
      'shade sources': 1,
    });
    expect(Object.keys(ctx.skipped).sort()).toEqual(SKIP_RULES.map((rule) => rule.name).sort());
  });

  it('restricts analysed to the given files and keeps all whole', () => {
    const ctx = createContextFromSources(sources, ['src/rhi/b.ts']);
    expect(ctx.analysed.map(ctx.rel)).toEqual(['src/rhi/b.ts']);
    expect(ctx.all).toHaveLength(7);
  });

  it('keeps the product files apart: all minus the skipped files', () => {
    const ctx = createContextFromSources(sources);
    expect(ctx.product.map(ctx.rel).sort()).toEqual(['src/core/a.ts', 'src/rhi/b.ts']);
    const narrow = createContextFromSources(sources, ['src/rhi/b.ts']);
    expect(narrow.product.map(narrow.rel).sort()).toEqual(['src/core/a.ts', 'src/rhi/b.ts']);
  });

  it('names a wanted file that no analysed file matched', () => {
    const ctx = createContextFromSources(sources, [
      'src/rhi/b.ts',
      'src/core/a.test.ts',
      'src/missing.ts',
    ]);
    expect(ctx.unmatched).toEqual(['src/core/a.test.ts', 'src/missing.ts']);
    expect(createContextFromSources(sources).unmatched).toEqual([]);
  });
});

describe('importEdges of dynamic imports', () => {
  const ctx = createContextFromSources({
    'src/a.ts': [
      `export const load = () => import('./b.js');`,
      `export type Loaded = typeof import('./c.js');`,
      `export type Alone = import('./d.js').D;`,
      `export const text = import(name);`,
      '',
    ].join('\n'),
    'src/b.ts': `export const b = 1;\n`,
    'src/c.ts': `export const c = 1;\n`,
    'src/d.ts': `export type D = 1;\n`,
  });
  const edges = importEdges(ctx.checker, ctx.program.getSourceFile('/virtual/src/a.ts')!);

  it('reads import() calls and import types with a string literal as edges', () => {
    expect(
      edges.map((edge) => [ctx.rel(edge.target), edge.line, edge.typeOnly, edge.dynamic]),
    ).toEqual([
      ['src/b.ts', 1, false, true],
      ['src/c.ts', 2, true, true],
      ['src/d.ts', 3, true, true],
    ]);
  });
});

describe('importEdges', () => {
  const ctx = createContextFromSources({
    'src/a.ts': [
      `import { v } from './b.js';`,
      `import type { T } from './b.js';`,
      `import { type U, type W } from './b.js';`,
      `import { type X, y } from './b.js';`,
      `export { v as v2 } from './b.js';`,
      `export type { T as T2 } from './b.js';`,
      `export * from './b.js';`,
      `import 'node:fs';`,
      `export const z = v;`,
      '',
    ].join('\n'),
    'src/b.ts': `export const v = 1;\nexport const y = 2;\nexport type T = 1;\nexport type U = 1;\nexport type W = 1;\nexport type X = 1;\n`,
  });
  const edges = importEdges(ctx.checker, ctx.program.getSourceFile('/virtual/src/a.ts')!);

  it('resolves each edge to its target file with its line', () => {
    expect(edges.map((edge) => edge.line)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(edges.every((edge) => ctx.rel(edge.target) === 'src/b.ts')).toBe(true);
  });

  it('flags type-only edges apart from value edges', () => {
    expect(edges.map((edge) => edge.typeOnly)).toEqual([
      false,
      true,
      true,
      false,
      false,
      true,
      false,
    ]);
  });
});

describe('parseLayerPolicy', () => {
  const parse = (text: string) =>
    parseLayerPolicy(ts.createSourceFile('p.ts', text, ts.ScriptTarget.Latest, true));

  it('reads MAY_IMPORT and KNOWN from the source text', () => {
    const policy = parse(
      `const MAY_IMPORT: Readonly<Record<string, readonly string[]>> = { core: [], 'language-service': ['core'] };\nconst KNOWN: readonly string[] = ['a/x.ts -> b/y.ts'];\n`,
    );
    expect(policy).toEqual({
      mayImport: { core: [], 'language-service': ['core'] },
      known: ['a/x.ts -> b/y.ts'],
    });
  });

  it('returns nothing when a constant is missing', () => {
    expect(parse(`const KNOWN = [];\n`)).toBeUndefined();
  });
});
