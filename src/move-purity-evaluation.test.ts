import { describe, expect, it } from 'vitest';
import { ALPHA, exported, tree } from './core/testing/move-purity-fixtures.js';
import { checkMove, type MoveReport } from '../scripts/move-purity.js';

const kinds = (report: MoveReport): string[] => [...new Set(report.findings.map((f) => f.kind))];

describe('the evaluation order of existing modules is unchanged (S1)', () => {
  const effectful = (name: string): string => `export const ${name} = 1;\nregister('${name}');\n`;
  const plain = (name: string): string => `export const ${name} = 1;\n`;
  const importer = (first: string, second: string): string =>
    `import { ${first} } from './${first}.js';\nimport { ${second} } from './${second}.js';\nexport const keep = [p, q];\n`;

  it('refuses two value imports swapped when both targets are effectful', () => {
    const files = { 'src/p.ts': effectful('p'), 'src/q.ts': effectful('q') };
    const base = tree({ ...files, 'src/a.ts': importer('p', 'q') });
    const head = tree({ ...files, 'src/a.ts': importer('q', 'p') });
    const report = checkMove(base, head);
    expect(kinds(report)).toEqual(['evaluation order from']);
    expect(report.findings[0]?.detail).toMatch(
      /first difference at position 0: base src\/p.ts head src\/q.ts/,
    );
  });

  it('accepts the same swap when neither target is active, since their order is unobservable', () => {
    const files = { 'src/p.ts': plain('p'), 'src/q.ts': plain('q') };
    const base = tree({ ...files, 'src/a.ts': importer('p', 'q') });
    const head = tree({ ...files, 'src/a.ts': importer('q', 'p') });
    expect(checkMove(base, head).findings).toEqual([]);
  });

  const second = 'export function useTwo(): number {\n  return two;\n}\n';
  const files = { 'src/e1.ts': effectful('one'), 'src/e2.ts': effectful('two') };
  const split = (facadeFirst: boolean): MoveReport => {
    const base = tree({
      ...files,
      'src/a.ts': `import { one } from './e1.js';\nimport { two } from './e2.js';\n${second}export const keep = one;\n`,
    });
    const link = "export { useTwo } from './b.js';\n";
    const head = tree({
      ...files,
      'src/a.ts': `${facadeFirst ? link : ''}import { one } from './e1.js';\n${facadeFirst ? '' : link}export const keep = one;\n`,
      'src/b.ts': `import { two } from './e2.js';\n${second}`,
    });
    return checkMove(base, head);
  };

  it('refuses a new file whose import pulls a module ahead of another', () => {
    expect(kinds(split(true))).toContain('evaluation order from');
  });

  it('accepts the split when the link to the new file comes last', () => {
    const report = split(false);
    expect(report.findings).toEqual([]);
    expect(report.pure).toBe(true);
  });
});

describe('string paths to a removed file (A4)', () => {
  const consumer = (path: string, text: string): string =>
    `import { addOne } from '${path}';\nexport function two(): number {\n  return addOne(1);\n}\nexport const NAME = '${text}';\n`;

  it('refuses a rename that leaves its path in a string of a unit', () => {
    const base = tree({ 'src/a.ts': exported(ALPHA), 'src/c.ts': consumer('./a.js', './a.js') });
    const head = tree({ 'src/b.ts': exported(ALPHA), 'src/c.ts': consumer('./b.js', './a.js') });
    expect(kinds(checkMove(base, head))).toContain('path reference to a removed file');
  });

  it('accepts the rename when no string names the old file', () => {
    const base = tree({ 'src/a.ts': exported(ALPHA), 'src/c.ts': consumer('./a.js', 'other') });
    const head = tree({ 'src/b.ts': exported(ALPHA), 'src/c.ts': consumer('./b.js', 'other') });
    expect(checkMove(base, head).pure).toBe(true);
  });

  it('refuses a configuration file that names the removed file', () => {
    const base = tree({ 'src/a.ts': exported(ALPHA), 'package.json': '{"main":"src/a.ts"}' });
    const head = tree({ 'src/b.ts': exported(ALPHA), 'package.json': '{"main":"src/a.ts"}' });
    expect(kinds(checkMove(base, head))).toContain('path reference to a removed file');
  });
});

describe('imports that do not resolve (A6)', () => {
  const user = 'export const f = () => a;\n';

  it('refuses a changed alias or specifier of an unresolved import', () => {
    const base = tree({ 'src/a.ts': `import { a } from 'node:fs';\n${user}` });
    const respec = tree({ 'src/a.ts': `import { a } from 'node:path';\n${user}` });
    expect(kinds(checkMove(base, respec))).toContain('unresolved import changed');
    const alias = tree({ 'src/a.ts': `import { b as a } from 'node:fs';\n${user}` });
    expect(kinds(checkMove(base, alias))).toContain('unresolved import changed');
  });

  it('accepts a unit that takes its unresolved import to a new file in the same directory', () => {
    const base = tree({ 'src/a.ts': `import { a } from 'node:fs';\n${user}` });
    const head = tree({
      'src/a.ts': `export { f } from './b.js';\n`,
      'src/b.ts': `import { a } from 'node:fs';\n${user}`,
    });
    const report = checkMove(base, head);
    expect(report.findings).toEqual([]);
    expect(report.pure).toBe(true);
  });

  it('refuses a unit that moves to another directory with its unresolved import', () => {
    const base = tree({ 'src/a.ts': `import { a } from 'node:fs';\n${user}` });
    const head = tree({
      'src/a.ts': `export { f } from './sub/b.js';\n`,
      'src/sub/b.ts': `import { a } from 'node:fs';\n${user}`,
    });
    expect(kinds(checkMove(base, head))).toContain('unresolved import moved');
  });
});

describe('location-dependent units (A10)', () => {
  const unit = (body: string): string => `export function here() {\n  return ${body};\n}\n`;

  it('refuses import.meta and __filename in a unit that changes file in one directory', () => {
    for (const body of ['import.meta.url', '__filename']) {
      const report = checkMove(
        tree({ 'src/a/x.ts': unit(body) }),
        tree({ 'src/a/y.ts': unit(body) }),
      );
      expect(kinds(report)).toContain('location-dependent unit moved');
    }
  });

  it('refuses relative paths and __dirname only when the directory changes', () => {
    for (const body of ['__dirname', "'./data/a.json'", "import('./x.js')", "require('./x.js')"]) {
      const across = checkMove(
        tree({ 'src/a/x.ts': unit(body) }),
        tree({ 'src/b/x.ts': unit(body) }),
      );
      expect(kinds(across)).toContain('location-dependent unit moved');
      const within = checkMove(
        tree({ 'src/a/x.ts': unit(body) }),
        tree({ 'src/a/y.ts': unit(body) }),
      );
      expect(kinds(within)).not.toContain('location-dependent unit moved');
    }
  });

  it('accepts a dynamic import of a bare or node: specifier across directories', () => {
    const body = "await import('node:fs')";
    const text = `export async function here() {\n  return ${body};\n}\n`;
    const report = checkMove(tree({ 'src/a/x.ts': text }), tree({ 'src/b/x.ts': text }));
    expect(kinds(report)).not.toContain('location-dependent unit moved');
  });
});

describe('whole-file renames and the order of comments (C1, B)', () => {
  it('follows a rename of a file with no units', () => {
    const files = { 'src/x.ts': 'export const x = 1;\n', 'src/y.ts': 'export const x = 1;\n' };
    const base = tree({ ...files, 'src/a.ts': "// header\nexport * from './x.js';\n" });
    const head = tree({ ...files, 'src/b.ts': "// header\nexport * from './y.js';\n" });
    expect(kinds(checkMove(base, head))).not.toContain('free comment appeared');
    expect(kinds(checkMove(base, head))).not.toContain('free comment vanished');
  });

  it('refuses two header comments that swapped places', () => {
    const rest = "import { x } from './x.js';\nexport const y = x;\n";
    const lib = { 'src/x.ts': 'export const x = 1;\n' };
    const base = tree({ ...lib, 'src/a.ts': `// one\n// two\n${rest}` });
    const head = tree({ ...lib, 'src/a.ts': `// two\n// one\n${rest}` });
    expect(kinds(checkMove(base, head))).toContain('free comments reordered');
  });
});
