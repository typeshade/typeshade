import { describe, expect, it } from 'vitest';
import { tree } from './core/testing/move-purity-fixtures.js';
import { checkMove, type MoveReport } from '../scripts/move-purity.js';

const kinds = (report: MoveReport): string[] => [...new Set(report.findings.map((f) => f.kind))];

describe('the full evaluation order of the modules that exist on both sides (S1)', () => {
  const files = {
    'src/dA.ts': 'export const A = 1;\n',
    'src/dB.ts': 'export const B = 2;\n',
  };
  const useB = 'export function useB(): number {\n  return B;\n}\n';
  const base = tree({
    ...files,
    'src/a.ts': `import { A } from './dA.js';\nimport { B } from './dB.js';\n${useB}export const keep = A;\n`,
  });
  const split = (head: string): MoveReport =>
    checkMove(
      base,
      tree({
        ...files,
        'src/a.ts': head,
        'src/b.ts': `import { B } from './dB.js';\n${useB}`,
      }),
    );
  const link = "export { useB } from './b.js';\n";
  const rest = "import { A } from './dA.js';\n";

  it('accepts a link to the new file that comes after the older dependencies', () => {
    const report = split(`${rest}${link}export const keep = A;\n`);
    expect(report.findings).toEqual([]);
    expect(report.pure).toBe(true);
  });

  it('refuses a link to the new file that pulls a dependency ahead of another', () => {
    const report = split(`${link}${rest}export const keep = A;\n`);
    expect(kinds(report)).toEqual(['evaluation order from']);
    expect(report.findings[0]?.detail).toContain('base src/dA.ts head src/dB.ts');
  });

  it('refuses a side-effect import added to an old file that evaluates a new dependency', () => {
    const effect = 'export const E = 1;\nregister();\n';
    const before = tree({ 'src/e.ts': effect, 'src/a.ts': 'export const keep = 1;\n' });
    const after = tree({
      'src/e.ts': effect,
      'src/a.ts': "import './e.js';\nexport const keep = 1;\n",
    });
    const report = checkMove(before, after);
    expect(kinds(report)).toContain('evaluation order from');
  });
});
