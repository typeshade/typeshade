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
      importWeight: 4,
      importerWeight: 4,
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
      ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((at) => [`src/b/leaf${at}.ts`, leaf(`l${at}`)])),
      'src/g/types.ts':
        [1, 2, 3, 4, 5, 6]
          .map((at) => `import type { l${at} as t${at} } from '../b/leaf${at}.js';`)
          .join('\n') + '\nexport type T = [typeof t1];\n',
    });
    const entry = home(heavier).find((item) => item.file === 'src/g/types.ts');
    expect(entry!.evidence).toMatchObject({
      topDirectoryWeight: 6 * TYPE_ONLY_WEIGHT,
      typeOnlyShare: 1,
    });
  });

  it('names the kind of a finding for what it measures', () => {
    expect(byFile.get('src/a/m.ts')!.kind).toBe('directory-coupling');
  });

  it('does not count a test file or a generated file as an importer', () => {
    const extra = createContextFromSources({
      ...bLeaves,
      'src/k/n.ts': leaf('n'),
      'src/b/one.test.ts': `import { n } from '../k/n.js';\nexport const a = n;\n`,
      'src/b/two.test.ts': `import { n } from '../k/n.js';\nexport const b = n;\n`,
      'src/b/three.generated.ts': `import { n } from '../k/n.js';\nexport const c = n;\n`,
    });
    expect(home(extra).map((finding) => finding.file)).not.toContain('src/k/n.ts');
  });

  it('does not count an import of a skipped file as an import of the file', () => {
    const extra = createContextFromSources({
      ...bLeaves,
      'src/b/testing/one.ts': leaf('one'),
      'src/b/testing/two.ts': leaf('two'),
      'src/b/testing/three.ts': leaf('three'),
      'src/k/n.ts':
        [1, 2, 3]
          .map(
            (at) =>
              `import { ${['one', 'two', 'three'][at - 1]} } from '../b/testing/${['one', 'two', 'three'][at - 1]}.js';`,
          )
          .join('\n') + '\nexport const n = [one, two, three];\n',
    });
    expect(home(extra).map((finding) => finding.file)).not.toContain('src/k/n.ts');
  });

  it('counts the edges to one target once, and a value edge wins over a type-only edge', () => {
    const merged = createContextFromSources({
      ...bLeaves,
      'src/g/x.ts': [
        `import { l1 } from '../b/leaf1.js';`,
        `import { l1 as again } from '../b/leaf1.js';`,
        `import type { l1 as typed } from '../b/leaf1.js';`,
        `import { l2 } from '../b/leaf2.js';`,
        `import { l4 } from '../b/leaf4.js';`,
        `import type { l3 } from '../b/leaf3.js';`,
        `import type { l3 as typedAgain } from '../b/leaf3.js';`,
        `export const x = [l1, again, l2, l4];`,
        `export type T = [typeof typed, typeof l3, typeof typedAgain];`,
        '',
      ].join('\n'),
    });
    const entry = home(merged).find((item) => item.file === 'src/g/x.ts');
    expect(entry!.evidence).toMatchObject({
      importWeight: 3 + TYPE_ONLY_WEIGHT,
      topDirectoryWeight: 3 + TYPE_ONLY_WEIGHT,
      typeOnlyShare: 0.14,
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
