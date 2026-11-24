import { describe, expect, it } from 'vitest';
import { tree } from './core/testing/move-purity-fixtures.js';
import {
  cleanReport,
  directoryOf,
  formatCleanReport,
} from '../scripts/move-purity/clean-report.js';

const fn = (name: string, other?: string): string =>
  `${other ? `import { ${other} } from './${other}.js';\n` : ''}export function ${name}(): number {\n  return ${other ? `${other}()` : '1'};\n}\n`;

const fixture = tree({
  'src/core/passes/a.ts': fn('a'),
  'src/core/passes/b.ts': 'export const B = 1;\nregister();\nregister();\n',
  'src/core/c.ts': fn('c'),
  'src/x/p.ts': fn('p', 'q'),
  'src/x/q.ts': fn('q', 'p'),
  'src/x/p.test.ts': "import { p } from './p.js';\nregister(p);\n",
  'src/top.ts': fn('top'),
});

describe('the clean-file report', () => {
  const report = cleanReport('/report-fixture', fixture);

  it('counts the files, the clean files and the active units of the tree', () => {
    expect(report.total).toEqual({
      files: 6,
      clean: 3,
      withActiveUnits: 1,
      activeUnits: 2,
      units: 8,
      inCycles: 2,
    });
  });

  it('groups the files by two path levels below src', () => {
    expect(directoryOf('src/core/passes/a.ts')).toBe('core/passes');
    expect(directoryOf('src/core/passes/deep/a.ts')).toBe('core/passes');
    expect(directoryOf('src/core/c.ts')).toBe('core');
    expect(directoryOf('src/top.ts')).toBe('.');
    expect(Object.keys(report.directories)).toEqual(['.', 'core', 'core/passes', 'x']);
    expect(report.directories['core/passes']).toMatchObject({ files: 2, clean: 1, activeUnits: 2 });
    expect(report.directories.x).toMatchObject({ files: 2, clean: 0, inCycles: 2 });
  });

  it('lists the cycles with their sizes and leaves out test files', () => {
    expect(report.cycles).toEqual([{ size: 2, files: ['src/x/p.ts', 'src/x/q.ts'] }]);
    expect(report.files.map((row) => row.path)).not.toContain('src/x/p.test.ts');
  });

  it('prints a table', () => {
    const text = formatCleanReport(report);
    expect(text).toContain('Import cycles: 1');
    expect(text).toMatch(/^total\s+6\s+3\s+1\s+2\/8\s+2$/m);
    expect(text).toContain('  2 files: src/x/p.ts, src/x/q.ts');
  });
});
