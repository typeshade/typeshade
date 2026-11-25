import { describe, expect, it } from 'vitest';
import {
  BREADTH_REPORT_FROM,
  breadth,
  breadthOf,
  summariseBreadth,
} from '../scripts/code-shape/breadth.js';
import { createContextFromSources } from '../scripts/code-shape/context.js';

const leaf = (name: string): string => `export const ${name} = 1;\n`;

const SOURCES = {
  'src/rhi/a.ts': leaf('a'),
  'src/runtime/b.ts': leaf('b'),
  'src/random/c.ts': leaf('c'),
  'src/cli/d.ts': leaf('d'),
  'src/algorithms/e.ts': leaf('e'),
  'src/core/ir/i1.ts': leaf('i1'),
  'src/core/ir/i2.ts': leaf('i2'),
  'src/core/wide.ts': [
    `import { a } from '../rhi/a.js';`,
    `import { b } from '../runtime/b.js';`,
    `import { c } from '../random/c.js';`,
    `import { d } from '../cli/d.js';`,
    `export const w = [a, b, c, d];`,
    '',
  ].join('\n'),
  'src/core/narrow.ts': [
    `import { a } from '../rhi/a.js';`,
    `import { b } from '../runtime/b.js';`,
    `export const n = [a, b];`,
    '',
  ].join('\n'),
  'src/core/mixed.ts': [
    `import { a } from '../rhi/a.js';`,
    `import type { b } from '../runtime/b.js';`,
    `import type { c } from '../random/c.js';`,
    `import { type d } from '../cli/d.js';`,
    `import { e } from '../algorithms/e.js';`,
    `export const m = [a, e];`,
    `export type B = typeof b;`,
    '',
  ].join('\n'),
  'src/core/same.ts': [
    `import { i1 } from './ir/i1.js';`,
    `import { i2 } from './ir/i2.js';`,
    `import { a } from '../rhi/a.js';`,
    `export const s = [i1, i2, a];`,
    '',
  ].join('\n'),
  'src/core/ir/inside.ts': [
    `import { i1 } from './i1.js';`,
    `import { w } from '../wide.js';`,
    `export const x = [i1, w];`,
    '',
  ].join('\n'),
};

describe('the breadth signal', () => {
  const ctx = createContextFromSources(SOURCES);
  const findings = breadth(ctx);
  const find = (file: string) => findings.find((finding) => finding.file === file);

  it('reports a file that imports from the threshold number of other areas', () => {
    expect(BREADTH_REPORT_FROM).toBe(4);
    expect(find('src/core/wide.ts')).toMatchObject({
      signal: 'breadth',
      remedy: 'split along the components',
      evidence: {
        valueAreas: 4,
        typeAreas: 0,
        modules: 4,
        areaList: ['cli', 'random', 'rhi', 'runtime'],
      },
    });
  });

  it('does not report a file that imports from fewer areas', () => {
    expect(find('src/core/narrow.ts')).toBeUndefined();
    expect(find('src/core/same.ts')).toBeUndefined();
  });

  it('counts type-only imports apart from value imports', () => {
    expect(find('src/core/mixed.ts')?.evidence).toMatchObject({
      valueAreas: 2,
      typeAreas: 3,
      modules: 5,
    });
  });

  it('does not count an import of the same area', () => {
    const same = breadth(
      createContextFromSources({
        ...SOURCES,
        'src/core/ir/more.ts': [
          `import { i1 } from './i1.js';`,
          `import { i2 } from './i2.js';`,
          `import { a } from '../../rhi/a.js';`,
          `export const z = [i1, i2, a];`,
          '',
        ].join('\n'),
      }),
    ).find((finding) => finding.file === 'src/core/ir/more.ts');
    expect(same).toBeUndefined();
  });

  it('counts a file of core as another area for a file of core/ir', () => {
    const inside = breadthOf(ctx).find((entry) => ctx.rel(entry.file) === 'src/core/ir/inside.ts');
    expect(inside?.valueAreas).toEqual(['core']);
    expect(inside?.modules).toEqual(['src/core/wide.ts']);
  });

  it('summarises the files that are narrow and the widest file', () => {
    const lines = summariseBreadth(ctx, findings);
    expect(lines.join('\n')).toContain('Widest by modules');
    expect(lines[1]).toContain('2 files import from 4 or more other areas');
  });
});
