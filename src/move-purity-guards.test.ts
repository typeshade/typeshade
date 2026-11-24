import { describe, expect, it } from 'vitest';
import { ALPHA, exported, tree } from './core/testing/move-purity-fixtures.js';
import { checkMove, type MoveReport } from '../scripts/move-purity.js';
import { activeUnitsOf } from '../scripts/move-purity/clean-files.js';
import { createSide } from '../scripts/move-purity/side-program.js';

const kinds = (report: MoveReport): string[] => [...new Set(report.findings.map((f) => f.kind))];

describe('a namespace import is keyed by its module, not by its export names', () => {
  const lib = (): string => 'export const A = 1;\nexport const B = 2;\n';
  const use =
    'export function use(): number {\n  return take(ns);\n}\ndeclare function take(x: object): number;\n';
  const other = 'export function other(): number {\n  return 1;\n}\n';
  const files = { 'src/lib1.ts': lib(), 'src/lib2.ts': lib() };
  const base = tree({
    ...files,
    'src/c.ts': `import * as ns from './lib1.js';\n${use}${other}`,
  });

  it('refuses a unit that passes the namespace whole after the import was redirected', () => {
    const head = tree({
      ...files,
      'src/c.ts': other,
      'src/d.ts': `import * as ns from './lib2.js';\n${use}`,
    });
    expect(kinds(checkMove(base, head))).toContain('rebound');
  });

  it('accepts the same unit when the new file imports the same module', () => {
    const head = tree({
      ...files,
      'src/c.ts': `export { use } from './d.js';\n${other}`,
      'src/d.ts': `import * as ns from './lib1.js';\n${use}`,
    });
    expect(kinds(checkMove(base, head))).not.toContain('rebound');
  });
});

describe('a suite call has an inline callback (A2)', () => {
  const countOf = (body: string): number => {
    const text = `import { describe, it } from 'vitest';\n${body}`;
    const side = createSide('/suite-fixture', tree({ 'src/a.test.ts': text }));
    return activeUnitsOf(side, 'src/a.test.ts').length;
  };

  it.each([
    "it('x', () => {}, 100);",
    "it('x', () => {}, { timeout: 1 });",
    "describe('x', { timeout: 1 }, () => {\n  it('y', () => {});\n});",
    "it.skipIf(true)('x', () => {});",
    "it.todo('x');",
  ])('accepts %s', (text) => {
    expect(countOf(text + '\n')).toBe(0);
  });

  it.each([
    "const body = () => {};\nit('x', body);",
    "describe('x', body);",
    "it('x', make());",
    "it('x', () => {}, make());",
    "it('x', () => {}, { get timeout() { return 1; } });",
    "it('x', () => {}, { timeout: make() });",
    "it.skipIf(make())('x', () => {});",
    "it.runIf(flags)('x', () => {});",
    "it('x');",
  ])('refuses %s', (text) => {
    expect(countOf(text + '\n')).toBeGreaterThan(0);
  });

  it('names a callback that is not inline', () => {
    const side = createSide(
      '/suite-fixture',
      tree({ 'src/a.test.ts': "import { it } from 'vitest';\nit('x', body);\n" }),
    );
    expect(activeUnitsOf(side, 'src/a.test.ts')[0]?.reason).toContain(
      'suite callback is not inline',
    );
  });
});

describe('forms that the tools disagree on are refused (A3, A4)', () => {
  const lib = { 'src/m.ts': 'export interface A {}\nexport const V = 1;\n' };
  const added = (text: string): MoveReport =>
    checkMove(tree(lib), tree({ ...lib, 'src/a.ts': text }));
  const found = (report: MoveReport, kind: string): string[] =>
    report.findings.filter((f) => f.kind === kind).map((f) => f.detail);

  it('refuses an import or an export with an empty binding list', () => {
    expect(found(added("import {} from './m.js';\n"), 'empty import or export from path')).toEqual([
      './m.js',
    ]);
    expect(found(added("export {} from './m.js';\n"), 'empty import or export from path')).toEqual([
      './m.js',
    ]);
  });

  it('accepts a side-effect import and an export with names', () => {
    expect(found(added("import './m.js';\n"), 'empty import or export from path')).toEqual([]);
    expect(
      found(added("export { V } from './m.js';\n"), 'empty import or export from path'),
    ).toEqual([]);
  });

  it('refuses a type re-exported without the type keyword', () => {
    expect(
      found(added("export { A } from './m.js';\n"), 'type re-exported without type path'),
    ).toEqual(['A']);
    expect(
      found(
        added("import { A } from './m.js';\nexport { A };\n"),
        'type re-exported without type path',
      ),
    ).toEqual(['A']);
  });

  it('accepts a type re-exported as a type, and a value re-exported plainly', () => {
    for (const text of [
      "export type { A } from './m.js';\n",
      "export { type A } from './m.js';\n",
      "export { V } from './m.js';\n",
    ]) {
      expect(found(added(text), 'type re-exported without type path'), text).toEqual([]);
    }
  });
});

describe('a decorator on a parameter makes a class active (A7)', () => {
  const countOf = (text: string): number => {
    const side = createSide('/decorators-fixture', tree({ 'src/a.ts': text }));
    return activeUnitsOf(side, 'src/a.ts').length;
  };

  it.each([
    'class C {\n  constructor(@dec x: number) {}\n}\n',
    'class C {\n  m(@dec x: number) {}\n}\n',
    'class C {\n  set a(@dec x: number) {}\n}\n',
    'class C {\n  static m(@dec x: number) {}\n}\n',
  ])('refuses %s', (text) => {
    expect(countOf(text)).toBeGreaterThan(0);
  });

  it('accepts a class with undecorated parameters', () => {
    expect(countOf('class C {\n  m(x: number) {}\n}\n')).toBe(0);
  });
});

describe('a range may not change the checks (A6)', () => {
  it.each([
    'scripts/move-purity/check-move.ts',
    'scripts/move-purity.ts',
    '.github/workflows/ci.yml',
    'scripts/file-size-policy.ts',
    'scripts/other-baseline.json',
    'vitest.config.ts',
    'tsconfig.json',
    'tsconfig.tests.json',
    'eslint.config.mjs',
    'package.json',
  ])('names %s as a path of the checks', (path) => {
    const report = checkMove(tree({ [path]: 'a\n' }), tree({ [path]: 'b\n' }));
    expect(report.outside.map((entry) => entry.reason)).toContain(
      'a pure move may not change the checks path',
    );
    expect(report.pure).toBe(false);
  });

  it('refuses a split of a file of the checker itself', () => {
    const path = 'scripts/move-purity/check-move.ts';
    const report = checkMove(
      tree({ [path]: exported(ALPHA) }),
      tree({
        [path]: "export { addOne } from './part.js';\n",
        'scripts/move-purity/part.ts': exported(ALPHA),
      }),
    );
    expect(report.pure).toBe(false);
    expect(report.outside.map((entry) => entry.path)).toContain(path);
  });

  it('leaves the two baselines to their own rule', () => {
    const path = 'scripts/file-size-baseline.json';
    const report = checkMove(
      tree({ [path]: '{"src/a.ts":5}' }),
      tree({ [path]: '{"src/a.ts":4}' }),
    );
    expect(report.pure).toBe(true);
  });
});

describe('a source file that git lists and the texts lack (A5)', () => {
  it('fails closed', () => {
    const entry = { path: 'src/a.ts', oldMode: '100644', newMode: '100644' };
    const report = checkMove(tree({ 'src/a.ts': exported(ALPHA) }), tree({}), {
      entries: [entry],
      paths: ['src/a.ts'],
    });
    expect(report.findings).toContainEqual({
      kind: 'unreadable file path',
      path: 'src/a.ts',
      detail: '',
    });
  });

  it('accepts a deletion that git lists with no head mode', () => {
    const entry = { path: 'src/a.ts', oldMode: '100644', newMode: '000000' };
    const report = checkMove(tree({ 'src/a.ts': exported(ALPHA) }), tree({}), {
      entries: [entry],
      paths: ['src/a.ts'],
    });
    expect(kinds(report)).not.toContain('unreadable file path');
  });
});
