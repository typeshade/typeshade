import { describe, expect, it } from 'vitest';
import { ALPHA, BETA, exported, tree } from './core/testing/move-purity-fixtures.js';
import { checkMove, type MoveReport } from '../scripts/move-purity.js';
import { describeCycle } from '../scripts/move-purity/clean-files.js';

const refusals = (report: MoveReport): string[] =>
  report.findings
    .filter((f) => f.kind === 'not a clean file path')
    .map((f) => `${f.path} ${f.detail}`);

describe('a pure move touches clean files only (P4)', () => {
  const split = (source: string): MoveReport =>
    checkMove(
      tree({ 'src/a.ts': source + exported(ALPHA) }),
      tree({
        'src/a.ts': `export { addOne } from './a/part.js';\n${source}`,
        'src/a/part.ts': exported(ALPHA),
      }),
    );

  it('accepts a split inside a clean file', () => {
    const report = split(BETA);
    expect(report.findings).toEqual([]);
    expect(report.pure).toBe(true);
  });

  it('refuses the same split when the source file keeps one active unit, and names it', () => {
    const report = split('register();\n');
    expect(refusals(report)).toEqual([
      'src/a.ts base: active unit at line 1: ExpressionStatement register();',
      'src/a.ts head: active unit at line 2: ExpressionStatement register();',
    ]);
    expect(report.pure).toBe(false);
  });

  it('counts the other active units of the file', () => {
    const report = split("register();\nregister('b');\n");
    expect(refusals(report)[0]).toBe(
      'src/a.ts base: active unit at line 1: ExpressionStatement register(); (2 active units in the file)',
    );
  });

  it('refuses a link added to a kept file that closes a cycle', () => {
    const files = {
      'src/a.ts': 'export function fa(): number {\n  return 1;\n}\n',
      'src/b.ts':
        "import { fa } from './a.js';\nexport function fb(): number {\n  return fa();\n}\n",
    };
    const head = { ...files, 'src/a.ts': `import './b.js';\n${files['src/a.ts']}` };
    const found = refusals(checkMove(tree(files), tree(head)));
    expect(found).toContain('src/a.ts head: import cycle: src/a.ts -> src/b.ts -> src/a.ts');
  });

  it('refuses a split whose new file imports the old file while the old file re-exports it', () => {
    const keep = 'export function K(): number {\n  return 5;\n}\n';
    const moved = 'export function D(): number {\n  return K();\n}\n';
    const report = checkMove(
      tree({ 'src/a.ts': keep + moved }),
      tree({
        'src/a.ts': `export { D } from './b.js';\n${keep}`,
        'src/b.ts': `import { K } from './a.js';\n${moved}`,
      }),
    );
    expect(refusals(report)).toContain(
      'src/b.ts head: import cycle: src/b.ts -> src/a.ts -> src/b.ts',
    );
    expect(report.pure).toBe(false);
  });

  it('refuses an import-only edit of a file that is in a cycle already', () => {
    const fn = (name: string, other: string): string =>
      `import { ${other} } from './${other}.js';\nexport function ${name}(): number {\n  return ${other}();\n}\n`;
    const base = {
      'src/p.ts': fn('p', 'q'),
      'src/q.ts': fn('q', 'p'),
      'src/r.ts': 'export function r(): number {\n  return 1;\n}\n',
    };
    const head = { ...base, 'src/p.ts': `import { r } from './r.js';\n${base['src/p.ts']}` };
    const found = refusals(checkMove(tree(base), tree(head)));
    expect(found).toContain('src/p.ts base: import cycle: src/p.ts -> src/q.ts -> src/p.ts');
    expect(found).toContain('src/p.ts head: import cycle: src/p.ts -> src/q.ts -> src/p.ts');
  });

  it('refuses a file whose only change is a link statement when it holds an active unit', () => {
    const base = { 'src/a.ts': 'register();\n', 'src/r.ts': 'export const R = 1;\n' };
    const head = { ...base, 'src/a.ts': "import { R } from './r.js';\nregister();\n" };
    expect(refusals(checkMove(tree(base), tree(head))).length).toBe(2);
  });

  it('does not look at a file that the range leaves alone', () => {
    const files = { 'src/n.ts': 'register();\n' };
    const report = checkMove(
      tree({ ...files, 'src/a.ts': exported(ALPHA) }),
      tree({ ...files, 'src/b.ts': exported(ALPHA) }),
    );
    expect(report.pure).toBe(true);
  });

  it('prints at most six nodes of a cycle, then an ellipsis', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'a'];
    expect(describeCycle(nodes.slice(0, 4))).toBe('a -> b -> c -> d');
    expect(describeCycle(nodes)).toBe('a -> b -> c -> d -> e -> f -> ...');
  });
});
