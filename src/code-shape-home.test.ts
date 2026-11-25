import { describe, expect, it } from 'vitest';
import { createContextFromSources } from '../scripts/code-shape/context.js';
import {
  HOME_MIN_WEIGHT,
  TYPE_ONLY_WEIGHT,
  home,
  summariseHome,
} from '../scripts/code-shape/home.js';

const leaf = (name: string): string => `export const ${name} = 1;\n`;

const importers = (count: number, directory: string, target: string): Record<string, string> =>
  Object.fromEntries(
    Array.from({ length: count }, (_, at) => [
      `src/${directory}/user${at}.ts`,
      `import { ${target} } from '../a/m.js';\nexport const u${at} = ${target};\n`,
    ]),
  );

const bLeaves = Object.fromEntries(
  [1, 2, 3, 4].map((at) => [`src/b/leaf${at}.ts`, leaf(`l${at}`)]),
);

const SOURCES: Record<string, string> = {
  ...bLeaves,
  ...importers(4, 'b', 'm'),
  'src/a/m.ts':
    [1, 2, 3, 4].map((at) => `import { l${at} } from '../b/leaf${at}.js';`).join('\n') +
    '\nexport const m = [l1, l2, l3, l4];\n',
  'src/c/own1.ts': leaf('o1'),
  'src/c/own2.ts': leaf('o2'),
  'src/c/own3.ts': leaf('o3'),
  'src/c/own.ts': [
    `import { o1 } from './own1.js';`,
    `import { o2 } from './own2.js';`,
    `import { o3 } from './own3.js';`,
    `import { l1 } from '../b/leaf1.js';`,
    `export const own = [o1, o2, o3, l1];`,
    '',
  ].join('\n'),
  'src/d/parent.ts':
    [1, 2, 3, 4].map((at) => `import { l${at} } from '../b/leaf${at}.js';`).join('\n') +
    '\nexport const p = [l1, l2, l3, l4];\n',
  'src/d/parent/inner.ts': leaf('inner'),
  'src/e/index.ts':
    [1, 2, 3, 4].map((at) => `import { l${at} } from '../b/leaf${at}.js';`).join('\n') +
    '\nexport const i = [l1, l2, l3, l4];\n',
  'src/f/facade.ts':
    [1, 2, 3, 4].map((at) => `export { l${at} } from '../b/leaf${at}.js';`).join('\n') + '\n',
  'src/g/types.ts':
    [1, 2, 3, 4].map((at) => `import type { l${at} } from '../b/leaf${at}.js';`).join('\n') +
    '\nexport type T = [typeof l1, typeof l2, typeof l3, typeof l4];\n',
  'src/h/small.ts':
    [1, 2].map((at) => `import { l${at} } from '../b/leaf${at}.js';`).join('\n') +
    '\nexport const s = [l1, l2];\n',
};

describe('the home signal', () => {
  const ctx = createContextFromSources(SOURCES);
  const findings = home(ctx);
  const byFile = new Map(findings.map((finding) => [finding.file, finding]));

  it('exports the weights as constants', () => {
    expect(TYPE_ONLY_WEIGHT).toBe(0.5);
    expect(HOME_MIN_WEIGHT).toBe(3);
  });

  it('reports a file coupled more to one other directory than to its own', () => {
    const finding = byFile.get('src/a/m.ts');
    expect(finding).toBeDefined();
    expect(finding!.remedy).toBe('move the file');
    expect(finding!.evidence).toMatchObject({
      ownDirectoryWeight: 0,
      topDirectory: 'src/b',
      topDirectoryWeight: 8,
      totalWeight: 8,
      imports: 4,
      importers: 4,
      typeOnlyShare: 0,
    });
    expect(finding!.line).toBe(1);
  });

  it('does not report coupling that sits in the own directory', () => {
    expect(byFile.has('src/c/own.ts')).toBe(false);
  });

  it('does not report the parent file of its module directory', () => {
    expect(byFile.has('src/d/parent.ts')).toBe(false);
  });

  it('does not report index.ts', () => {
    expect(byFile.has('src/e/index.ts')).toBe(false);
  });

  it('does not report a facade file', () => {
    expect(byFile.has('src/f/facade.ts')).toBe(false);
  });

  it('weighs a type-only edge less than a value edge', () => {
    const finding = byFile.get('src/g/types.ts');
    expect(finding).toBeUndefined();
    const heavier = createContextFromSources({
      ...bLeaves,
      'src/g/types.ts':
        [1, 2, 3, 4, 5, 6]
          .map(
            (at) => `import type { l${at % 4 || 4} as t${at} } from '../b/leaf${at % 4 || 4}.js';`,
          )
          .join('\n') + '\nexport type T = [typeof t1];\n',
    });
    const entry = home(heavier).find((item) => item.file === 'src/g/types.ts');
    expect(entry!.evidence).toMatchObject({
      topDirectoryWeight: 6 * TYPE_ONLY_WEIGHT,
      typeOnlyShare: 1,
    });
  });

  it('does not report a file below the minimum weight', () => {
    expect(byFile.has('src/h/small.ts')).toBe(false);
  });

  it('counts the files each rule removed in the header', () => {
    const text = summariseHome(ctx, findings).join('\n');
    expect(text).toContain('Rule 1 (removed 1 files)');
    expect(text).toContain('Rule 2 (removed 1 files)');
    expect(text).toContain('Rule 3 (removed 1 files)');
    expect(text).toContain('TYPE_ONLY_WEIGHT');
  });
});
