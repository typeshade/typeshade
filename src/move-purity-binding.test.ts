import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BETA, tree } from './core/testing/move-purity-fixtures.js';
import { checkMove, type MoveReport } from '../scripts/move-purity.js';
import { RUNNABLE_TEST_ROOTS } from '../scripts/move-purity/runnable-tests.js';

const kinds = (report: MoveReport): string[] =>
  [...new Set(report.findings.map((f) => f.kind))].sort();

describe('binding identity (P2)', () => {
  const x = 'export function f(): number {\n  return 1;\n}\n';
  const y = 'export function f(): number {\n  return 2;\n}\n';
  const g = 'export function g(): number {\n  return f();\n}\n';

  it('refuses an import redirected to a same-named symbol of another module', () => {
    const base = tree({
      'src/x.ts': x,
      'src/y.ts': y,
      'src/a.ts': `import { f } from './x.js';\n${g}`,
    });
    const head = tree({
      'src/x.ts': x,
      'src/y.ts': y,
      'src/a.ts': `import { f } from './y.js';\n${g}`,
    });
    const report = checkMove(base, head);
    expect(report.pure).toBe(false);
    expect(kinds(report)).toContain('rebound');
    expect(report.findings.find((f) => f.kind === 'rebound')?.detail).toMatch(/^g: f base /);
  });

  it('refuses a unit moved into a file that has its own declaration of the same name', () => {
    const helper = (n: number): string => `function helper(): number {\n  return ${n};\n}\n`;
    const user = 'export function g(): number {\n  return helper();\n}\n';
    const base = tree({ 'src/a.ts': helper(1) + user, 'src/b.ts': `${helper(2)}export {};\n` });
    const head = tree({ 'src/a.ts': helper(1), 'src/b.ts': `${helper(2)}export {};\n${user}` });
    const report = checkMove(base, head);
    expect(kinds(report)).toContain('rebound');
  });

  it('accepts a consumer whose import reaches the same declaration through a facade', () => {
    const consumer = `import { f } from './x.js';\n${g}`;
    const base = tree({ 'src/x.ts': x, 'src/a.ts': consumer });
    const head = tree({
      'src/x.ts': `export { f } from './x/part.js';\n`,
      'src/x/part.ts': x,
      'src/a.ts': consumer,
    });
    expect(checkMove(base, head).findings).toEqual([]);
  });
});

describe('the export surface (P3)', () => {
  const x = 'export const f = 1;\n';
  const y = 'export const f = 2;\n';

  it('refuses a re-export redirected to another module', () => {
    const base = tree({
      'src/x.ts': x,
      'src/y.ts': y,
      'src/a.ts': `export { f } from './x.js';\n`,
    });
    const head = tree({
      'src/x.ts': x,
      'src/y.ts': y,
      'src/a.ts': `export { f } from './y.js';\n`,
    });
    const report = checkMove(base, head);
    expect(kinds(report)).toContain('surface');
    expect(report.findings.find((f) => f.kind === 'surface')?.path).toBe('src/a.ts');
  });

  it('refuses an export that vanished from a file that stays', () => {
    const base = tree({ 'src/x.ts': x + 'export const g = 2;\n' });
    const head = tree({ 'src/x.ts': x, 'src/y.ts': 'export const g = 2;\n' });
    expect(kinds(checkMove(base, head))).toContain('surface');
  });

  it('refuses an export whose type-only flag changed', () => {
    const t = 'export class C {}\n';
    const base = tree({ 'src/t.ts': t, 'src/a.ts': `export { C } from './t.js';\n` });
    const head = tree({ 'src/t.ts': t, 'src/a.ts': `export type { C } from './t.js';\n` });
    expect(kinds(checkMove(base, head))).toContain('surface');
  });

  it('refuses a facade re-export that left out one name', () => {
    const lib = 'export const a = 1;\nexport const b = 2;\n';
    const base = tree({ 'src/a.ts': lib });
    const head = tree({ 'src/a.ts': `export { a } from './a/part.js';\n`, 'src/a/part.ts': lib });
    expect(kinds(checkMove(base, head))).toContain('surface');
  });
});

describe('links of a file (P5)', () => {
  const setup = 'export {};\n';

  it('refuses a side-effect import in a new file', () => {
    const base = tree({ 'src/setup.ts': setup, 'src/a.ts': BETA });
    const head = tree({
      'src/setup.ts': setup,
      'src/a.ts': 'const LIMIT = 4;\n',
      'src/b.ts': `import './setup.js';\n${BETA.slice(BETA.indexOf('function'))}`,
    });
    expect(kinds(checkMove(base, head))).toContain('side-effect import in a new file');
  });

  it('refuses an import whose type-only flag changed', () => {
    const t = 'export type T = number;\n';
    const user = 'export const v: T = 1;\n';
    const base = tree({ 'src/t.ts': t, 'src/a.ts': `import type { T } from './t.js';\n${user}` });
    const head = tree({ 'src/t.ts': t, 'src/a.ts': `import { T } from './t.js';\n${user}` });
    expect(kinds(checkMove(base, head))).toContain('import flag changed');
  });

  it('refuses an import attribute that was added', () => {
    const x = 'export const a = 1;\n';
    const user = 'export const v = a;\n';
    const base = tree({ 'src/x.ts': x, 'src/a.ts': `import { a } from './x.js';\n${user}` });
    const head = tree({
      'src/x.ts': x,
      'src/a.ts': `import { a } from './x.js' with { type: 'json' };\n${user}`,
    });
    expect(kinds(checkMove(base, head))).toContain('import flag changed');
  });
});

describe('the preamble and the file class (P6)', () => {
  it('refuses a shebang or a byte order mark that changed', () => {
    const base = tree({ 'src/a.ts': '#!/usr/bin/env node\nconst A = 1;\n' });
    expect(kinds(checkMove(base, tree({ 'src/a.ts': 'const A = 1;\n' })))).toEqual(['preamble']);
    const plain = tree({ 'src/a.ts': 'const A = 1;\n' });
    const marked = tree({ 'src/a.ts': '\uFEFFconst A = 1;\n' });
    expect(kinds(checkMove(plain, marked))).toEqual(['preamble']);
  });

  it('refuses a unit moved between a source, a test and a shade file', () => {
    const unit = 'function f() {}\n';
    for (const target of ['src/a.test.ts', 'src/a.shade.ts', 'src/a.d.ts']) {
      const report = checkMove(tree({ 'src/a.ts': unit }), tree({ [target]: unit }));
      expect(kinds(report)).toContain('file class changed');
    }
  });

  it('counts the titles of a test file that vitest runs and not the others', () => {
    const text = `describe('a', () => {\n  it('works', () => {});\n});\n`;
    const report = checkMove(tree({ 'src/a.test.ts': text }), tree({ 'scripts/a.test.ts': text }));
    expect(report.titles.vanished.map((t) => t.title).sort()).toEqual(['a', 'works']);
  });

  it('keeps the runnable test roots equal to the include globs of vitest.config.ts', () => {
    const config = readFileSync(
      fileURLToPath(new URL('../vitest.config.ts', import.meta.url)),
      'utf8',
    );
    const globs = RUNNABLE_TEST_ROOTS.map((root) => `'${root}**/*.test.ts'`).join(', ');
    expect(config).toContain(`include: [${globs}]`);
    expect(config).toContain("'**/node_modules/**'");
  });
});
