import { describe, expect, it } from 'vitest';
import { tree } from './core/testing/move-purity-fixtures.js';
import { checkMove, type MoveReport } from '../scripts/move-purity.js';

const kinds = (report: MoveReport): string[] => [...new Set(report.findings.map((f) => f.kind))];

const header = "import { describe, it, beforeEach, vi } from 'vitest';\n";
const one = `describe('one', () => {\n  it('a', () => {});\n});\n`;
const two = `describe('two', () => {\n  beforeEach(() => {});\n  it('b', () => {});\n});\n`;

describe('tests that move between test files (series S11 and S12)', () => {
  it('accepts a test moved from one plain test file to another', () => {
    const base = tree({ 'src/a.test.ts': header + one + two });
    const head = tree({ 'src/a.test.ts': header + one, 'src/b.test.ts': header + two });
    const report = checkMove(base, head);
    expect(report.findings).toEqual([]);
    expect(report.pure).toBe(true);
  });

  it('accepts a test moved into an existing plain test file', () => {
    const three = `describe('three', () => {\n  it('c', () => {});\n});\n`;
    const base = tree({ 'src/a.test.ts': header + one + two, 'src/b.test.ts': header + three });
    const head = tree({ 'src/a.test.ts': header + one, 'src/b.test.ts': header + three + two });
    expect(checkMove(base, head).pure).toBe(true);
  });

  it('refuses a test moved out of a file with a top-level hook', () => {
    const hook = 'beforeEach(() => {});\n';
    const base = tree({ 'src/a.test.ts': header + hook + one + two });
    const head = tree({ 'src/a.test.ts': header + hook + one, 'src/b.test.ts': header + two });
    expect(kinds(checkMove(base, head))).toEqual(['not a clean file path']);
  });

  it('refuses a test moved into a file with a top-level mock', () => {
    const mock = "vi.mock('x');\n";
    const base = tree({ 'src/a.test.ts': header + one + two, 'src/b.test.ts': header + mock });
    const head = tree({ 'src/a.test.ts': header + one, 'src/b.test.ts': header + mock + two });
    expect(kinds(checkMove(base, head))).toEqual(['not a clean file path']);
  });

  it('refuses a test moved between files whose vitest pragmas differ', () => {
    const pragma = '// @vitest-demo one\n';
    const base = tree({ 'src/a.test.ts': pragma + header + one + two });
    const head = tree({ 'src/a.test.ts': pragma + header + one, 'src/b.test.ts': header + two });
    expect(kinds(checkMove(base, head))).toContain('test moved across a vitest pragma');
    const three = `describe('three', () => {\n  it('c', () => {});\n});\n`;
    const both = tree({
      'src/a.test.ts': pragma + header + one + two,
      'src/b.test.ts': pragma + header + three,
    });
    const same = tree({
      'src/a.test.ts': pragma + header + one,
      'src/b.test.ts': pragma + header + three + two,
    });
    expect(checkMove(both, same).pure).toBe(true);
  });

  it('refuses a test moved to a file that vitest does not run', () => {
    const base = tree({ 'src/a.test.ts': header + one + two });
    const head = tree({ 'src/a.test.ts': header + one, 'scripts/b.test.ts': header + two });
    const report = checkMove(base, head);
    expect(kinds(report)).toContain('test moved to a file vitest does not run');
    expect(report.titles.vanished.length).toBeGreaterThan(0);
  });

  it('refuses a hook or a mock that moves on its own', () => {
    const hook = 'beforeEach(() => {});\n';
    const base = tree({ 'src/a.test.ts': header + hook + one });
    const head = tree({ 'src/a.test.ts': header + one, 'src/b.test.ts': header + hook });
    expect(kinds(checkMove(base, head))).toContain('not a clean file path');
  });
});

describe('unit instance identity', () => {
  const f = 'export function f(): number {\n  return 1;\n}\n';
  const g = 'export function g(): number {\n  return f();\n}\n';

  it('refuses an import redirected to an identical copy in another file', () => {
    const files = { 'src/m1.ts': f, 'src/m2.ts': f };
    const base = tree({ ...files, 'src/c.ts': `import { f } from './m1.js';\n${g}` });
    const head = tree({ ...files, 'src/c.ts': `import { f } from './m2.js';\n${g}` });
    expect(kinds(checkMove(base, head))).toContain('rebound');
  });

  it('prints each differing identifier of a unit, at most five, and counts the rest', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const decl = (path: string): Record<string, string> => ({
      [`src/${path}.ts`]: names.map((n) => `export const ${n} = '${path}';\n`).join(''),
    });
    const user = (path: string): string =>
      `import { ${names.join(', ')} } from './${path}.js';\nexport const all = [${names.join(', ')}];\n`;
    const base = tree({ ...decl('p'), ...decl('q'), 'src/c.ts': user('p') });
    const head = tree({ ...decl('p'), ...decl('q'), 'src/c.ts': user('q') });
    const rebound = checkMove(base, head).findings.find((x) => x.kind === 'rebound');
    expect(rebound?.detail.split('; ')).toHaveLength(6);
    expect(rebound?.detail).toMatch(/and 2 more$/);
  });
});
