import { describe, expect, it } from 'vitest';
import {
  BREADTH_REPORT_FROM,
  breadth,
  breadthOf,
  summariseBreadth,
} from '../scripts/code-shape/breadth.js';
import { AREA_DEFINITION } from '../scripts/code-shape/areas.js';
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
      remedy: 'none (report)',
      kind: 'wide-imports',
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

  it('does not count the parent area or a child area as another area', () => {
    const inside = breadthOf(ctx).find((entry) => ctx.rel(entry.file) === 'src/core/ir/inside.ts');
    expect(inside?.valueAreas).toEqual([]);
    expect(inside?.modules).toEqual([]);
    const parent = breadthOf(ctx).find((entry) => ctx.rel(entry.file) === 'src/core/same.ts');
    expect(parent?.valueAreas).toEqual(['rhi']);
  });

  it('counts a sibling area as another area', () => {
    const sibling = breadthOf(
      createContextFromSources({
        'src/core/debug/d.ts': leaf('d'),
        'src/core/ir/i.ts': `import { d } from '../debug/d.js';\nexport const i = d;\n`,
      }),
    ).find((entry) => entry.file.fileName.endsWith('ir/i.ts'));
    expect(sibling?.valueAreas).toEqual(['core/debug']);
  });

  it('states the rule for nested areas in the definition', () => {
    expect(AREA_DEFINITION).toContain('A parent area and a child area are not other areas');
  });

  it('summarises the files that are narrow and the widest file', () => {
    const lines = summariseBreadth(ctx, findings);
    expect(lines.join('\n')).toContain('Widest by modules');
    expect(lines[1]).toContain('2 files import from 4 or more other areas');
    expect(lines.join('\n')).toContain('read signal 4 (cohesion)');
  });
});
