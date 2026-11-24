import { describe, expect, it } from 'vitest';
import { tree } from './core/testing/move-purity-fixtures.js';
import { checkMove, type MoveReport } from '../scripts/move-purity.js';

const kinds = (report: MoveReport): string[] => [...new Set(report.findings.map((f) => f.kind))];

describe('keys that tell a global from an unresolved import (S4)', () => {
  const unit = 'export function where(): unknown {\n  return location;\n}\n';
  const keep = 'export const keep = 1;\n';

  it('refuses a unit moved into a file that imports a name it used as a global', () => {
    const base = tree({ 'src/a.ts': keep + unit });
    const head = tree({
      'src/a.ts': `export { where } from './b.js';\n${keep}`,
      'src/b.ts': `import { location } from 'typeshade/core/ir';\n${unit}`,
    });
    const found = checkMove(base, head).findings.find((f) => f.kind === 'rebound');
    expect(found?.detail).toContain(
      'location base global:location head import:typeshade/core/ir#location',
    );
  });

  it('accepts a unit that keeps using the global in its new file', () => {
    const base = tree({ 'src/a.ts': keep + unit });
    const head = tree({
      'src/a.ts': `export { where } from './b.js';\n${keep}`,
      'src/b.ts': unit,
    });
    const report = checkMove(base, head);
    expect(report.findings).toEqual([]);
    expect(report.pure).toBe(true);
  });

  it('follows the package name and its exports to the tracked source file', () => {
    const manifest = JSON.stringify({ name: 'pkg', exports: { './x': './src/x.ts' } });
    const lib = 'export function f(): number {\n  return 1;\n}\n';
    const user = "import { f } from 'pkg/x';\nexport const g = (): number => f();\n";
    const base = tree({ 'package.json': manifest, 'src/x.ts': lib, 'src/c.ts': user });
    const head = tree({
      'package.json': manifest,
      'src/x.ts': "export { f } from './x/part.js';\n",
      'src/x/part.ts': lib,
      'src/c.ts': user,
    });
    const report = checkMove(base, head);
    expect(report.findings).toEqual([]);
    expect(report.pure).toBe(true);
  });
});

describe('the meaning of an export, not its syntax (F1)', () => {
  const lib = 'export interface I {}\nexport type T = number;\nexport class C {}\n';
  const part = (text: string): Record<string, string> => ({
    'src/a.ts': text,
    'src/a/part.ts': lib,
  });

  it('accepts export type from for an interface and a type alias', () => {
    const head = tree(
      part("export type { I, T } from './a/part.js';\nexport { C } from './a/part.js';\n"),
    );
    const report = checkMove(tree({ 'src/a.ts': lib }), head);
    expect(report.findings).toEqual([]);
    expect(report.pure).toBe(true);
  });

  it('refuses export type from for a class, which also has a value meaning', () => {
    const head = tree(part("export type { I, T, C } from './a/part.js';\n"));
    const report = checkMove(tree({ 'src/a.ts': lib }), head);
    expect(kinds(report)).toEqual(['surface']);
    expect(report.findings[0]?.detail).toMatch(/^C base vt/);
  });
});
