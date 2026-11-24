import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ALPHA, BETA, exported, tree } from './core/testing/move-purity-fixtures.js';
import { checkMove, formatReport } from '../scripts/move-purity.js';
import { fileComments } from '../scripts/move-purity/comments.js';

const comments = (text: string): string[] =>
  fileComments(ts.createSourceFile('src/a.ts', text, ts.ScriptTarget.Latest, true), 'src/a.ts').map(
    (c) => c.text,
  );

describe('the move-purity check (docs/structure-refactoring-plan.md, S0 item a)', () => {
  it('accepts a declaration moved from one file to another', () => {
    const base = tree({ 'src/a.ts': ALPHA + BETA, 'src/b.ts': `const X = 1;\n` });
    const head = tree({ 'src/a.ts': BETA, 'src/b.ts': `const X = 1;\n${ALPHA}` });
    const report = checkMove(base, head);
    expect(report.findings).toEqual([]);
    expect(report.pure).toBe(true);
    expect(report.units.moved).toEqual([
      {
        from: { path: 'src/a.ts', line: 2, names: ['addOne'] },
        to: { path: 'src/b.ts', line: 3, names: ['addOne'] },
      },
    ]);
  });

  it('accepts an export keyword added to a declaration moved into a new file', () => {
    const base = tree({ 'src/a.ts': ALPHA });
    const head = tree({ 'src/b.ts': exported(ALPHA) });
    const report = checkMove(base, head);
    expect(report.pure).toBe(true);
    expect(report.units.exportsAdded.map((u) => u.names)).toEqual([['addOne']]);
  });

  it('refuses an export keyword added to or removed from a file that stays', () => {
    const plain = tree({ 'src/a.ts': `const A = 1;\nexport default 2;\n` });
    const marked = tree({ 'src/a.ts': `export const A = 1;\nexport default 2;\n` });
    expect(checkMove(plain, marked).findings.map((f) => f.kind)).toEqual(['surface']);
    const removed = checkMove(marked, plain);
    expect(removed.pure).toBe(false);
    expect(removed.units.exportsRemoved.map((u) => u.names)).toEqual([['A']]);
  });

  it('refuses a default export that changed its modifier', () => {
    const base = tree({ 'src/a.ts': `export default function f() {}\n` });
    const head = tree({ 'src/a.ts': `function f() {}\n` });
    expect(checkMove(base, head).pure).toBe(false);
  });

  it('refuses a body edited by one character and names the declaration', () => {
    const base = tree({ 'src/a.ts': ALPHA });
    const head = tree({ 'src/b.ts': ALPHA.replace('x + 1', 'x + 2') });
    const report = checkMove(base, head);
    expect(report.pure).toBe(false);
    expect(report.units.changed).toEqual([
      {
        base: { path: 'src/a.ts', line: 2, names: ['addOne'] },
        head: { path: 'src/b.ts', line: 2, names: ['addOne'] },
      },
    ]);
    expect(formatReport(report)).toContain('changed  src/a.ts:2 addOne -> src/b.ts:2');
  });

  it('refuses a declaration copied and left in place', () => {
    const base = tree({ 'src/a.ts': ALPHA });
    const head = tree({ 'src/a.ts': ALPHA, 'src/b.ts': ALPHA });
    const report = checkMove(base, head);
    expect(report.pure).toBe(false);
    expect(report.units.appeared.map((u) => u.names)).toEqual([['addOne']]);
  });

  it('refuses a declaration that vanished', () => {
    const report = checkMove(tree({ 'src/a.ts': ALPHA + BETA }), tree({ 'src/a.ts': BETA }));
    expect(report.pure).toBe(false);
    expect(report.units.vanished.map((u) => u.names)).toEqual([['addOne']]);
  });

  it('accepts imports split over two lines and refuses a local export that changed', () => {
    const x = 'export const x = 1;\nexport const w = 2;\n';
    const use = 'export const sum = x + w;\n';
    const base = tree({ 'src/x.ts': x, 'src/a.ts': `import { x, w } from './x.js';\n${use}` });
    const split = tree({
      'src/x.ts': x,
      'src/a.ts': `import { x } from './x.js';\nimport { w } from './x.js';\n${use}`,
    });
    expect(checkMove(base, split).pure).toBe(true);
    const local = tree({ 'src/a.ts': 'const a = 1;\nexport { a as b };\n' });
    const renamed = tree({ 'src/a.ts': 'const a = 1;\nexport { a as c };\n' });
    expect(checkMove(local, renamed).pure).toBe(false);
  });

  it('accepts a facade that holds only re-exports and a real split behind it', () => {
    const lib = `function helper(x: number): number {\n  return x * 2;\n}\n\nexport function double(x: number): number {\n  return helper(x) + helper(x);\n}\n`;
    const consumer = `import { double } from './a.js';\nexport const four = double(2);\n`;
    const base = tree({ 'src/a.ts': lib, 'src/consumer.ts': consumer });
    const head = tree({
      'src/a.ts': `export { double } from './a/part.js';\n`,
      'src/a/part.ts': lib,
      'src/consumer.ts': consumer,
    });
    const report = checkMove(base, head);
    expect(report.findings).toEqual([]);
    expect(report.pure).toBe(true);
  });

  it('accepts a whole-file rename with the importers updated', () => {
    const consumer = (path: string): string =>
      `import { addOne } from '${path}';\nexport const two = addOne(1);\n`;
    const base = tree({ 'src/a.ts': exported(ALPHA), 'src/c.ts': consumer('./a.js') });
    const head = tree({ 'src/b.ts': exported(ALPHA), 'src/c.ts': consumer('./b.js') });
    const report = checkMove(base, head);
    expect(report.findings).toEqual([]);
    expect(report.pure).toBe(true);
  });

  it('refuses a reformatted body', () => {
    const head = tree({ 'src/a.ts': ALPHA.replace('  return x + 1;', '    return x + 1;') });
    expect(checkMove(tree({ 'src/a.ts': ALPHA }), head).pure).toBe(false);
  });

  it('accepts a change of line endings', () => {
    const head = tree({ 'src/a.ts': ALPHA.replace(/\n/g, '\r\n') });
    expect(checkMove(tree({ 'src/a.ts': ALPHA }), head).pure).toBe(true);
  });

  it('refuses an edit of the comment directly above a moved declaration', () => {
    const head = tree({ 'src/b.ts': ALPHA.replace('Adds one.', 'Adds two.') });
    expect(checkMove(tree({ 'src/a.ts': ALPHA }), head).pure).toBe(false);
  });

  it('moves a trailing comment of a line with its declaration', () => {
    const base = tree({ 'src/a.ts': `const A = 1; // one\nconst B = 2;\n` });
    const head = tree({ 'src/a.ts': `const B = 2;\n`, 'src/b.ts': `const A = 1; // one\n` });
    expect(checkMove(base, head).pure).toBe(true);
    const edited = tree({ 'src/a.ts': `const B = 2;\n`, 'src/b.ts': `const A = 1; // two\n` });
    expect(checkMove(base, edited).pure).toBe(false);
  });

  it('refuses a test title that vanished or was renamed', () => {
    const base = tree({
      'src/a.test.ts': `describe('a', () => {\n  it('works', () => {});\n});\n`,
    });
    const renamed = tree({
      'src/a.test.ts': `describe('a', () => {\n  it('works well', () => {});\n});\n`,
    });
    const report = checkMove(base, renamed);
    expect(report.titles.vanished.map((t) => t.title)).toEqual(['works']);
    expect(report.titles.appeared.map((t) => t.title)).toEqual(['works well']);
    expect(checkMove(base, tree({ 'src/a.test.ts': `describe('a', () => {});\n` })).pure).toBe(
      false,
    );
  });

  it('reads titles of each, skip, only and todo forms at any depth', () => {
    const base = tree({
      'src/a.test.ts':
        `describe.skip('s', () => {\n  it.each([1])('e %s', () => {});\n` +
        `  test.only('o', () => {});\n  it.todo('t');\n});\n`,
    });
    const head = tree({ 'src/a.test.ts': `describe.skip('s', () => {});\n` });
    const report = checkMove(base, head);
    expect(report.titles.vanished.map((t) => t.title).sort()).toEqual(['e %s', 'o', 't']);
  });

  it('refuses a test moved between test files, which is an active statement', () => {
    const one = `describe('one', () => {\n  it('a', () => {});\n});\n`;
    const two = `describe('two', () => {\n  it('b', () => {});\n});\n`;
    const report = checkMove(
      tree({ 'src/a.test.ts': one + two }),
      tree({ 'src/a.test.ts': one, 'src/b.test.ts': two }),
    );
    expect(report.titles).toEqual({ vanished: [], appeared: [] });
    expect(report.findings.map((f) => f.kind)).toEqual(['active unit moved']);
  });

  describe('the order of declarations', () => {
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((n, i) => `const ${n} = ${i};\n`) as [
      string,
      string,
      string,
      string,
    ];

    it('refuses two declarations swapped inside a file', () => {
      const report = checkMove(tree({ 'src/a.ts': a + b }), tree({ 'src/a.ts': b + a }));
      expect(report.pure).toBe(false);
      expect(report.units.reordered.map((u) => u.names)).toEqual([['B']]);
    });

    it('refuses two moved declarations swapped in the target', () => {
      const base = tree({ 'src/a.ts': a + b + c });
      const head = tree({ 'src/a.ts': c, 'src/b.ts': b + a });
      expect(checkMove(base, head).units.reordered).toEqual([
        { path: 'src/b.ts', line: 1, names: ['B'] },
      ]);
    });

    it('accepts moved declarations interleaved in order with existing ones', () => {
      const base = tree({ 'src/a.ts': a + b + c, 'src/b.ts': d });
      const head = tree({ 'src/a.ts': c, 'src/b.ts': a + d + b });
      expect(checkMove(base, head).pure).toBe(true);
    });

    it('orders units of different sources only within each source', () => {
      const base = tree({ 'src/a.ts': a + b, 'src/b.ts': c + d });
      expect(checkMove(base, tree({ 'src/t.ts': c + a + d + b })).pure).toBe(true);
    });
  });

  describe('free comments', () => {
    const link = `import { x } from './x.js';\n`;

    it('refuses a header comment that was deleted', () => {
      const base = tree({ 'src/a.ts': `// header\n${link}${BETA}` });
      const report = checkMove(base, tree({ 'src/a.ts': `${link}${BETA}` }));
      expect(report.pure).toBe(false);
      expect(report.findings.map((f) => f.kind)).toContain('free comment vanished');
    });

    it('refuses an edited comment above an import', () => {
      const base = tree({ 'src/a.ts': `// one\n${link}${BETA}` });
      const report = checkMove(base, tree({ 'src/a.ts': `// two\n${link}${BETA}` }));
      expect(report.findings.map((f) => f.kind).sort()).toEqual([
        'free comment appeared',
        'free comment vanished',
      ]);
    });

    it('refuses a comment at the end of a file and one before a closing brace', () => {
      const base = tree({ 'src/a.ts': `function f() {\n  // inner\n}\n// tail\n` });
      const tail = checkMove(base, tree({ 'src/a.ts': `function f() {\n  // inner\n}\n` }));
      expect(tail.findings.map((f) => f.detail)).toEqual(['// tail']);
      expect(checkMove(base, tree({ 'src/a.ts': `function f() {\n}\n// tail\n` })).pure).toBe(
        false,
      );
    });

    it('refuses a free comment that appears in a new file that is not a rename', () => {
      const base = tree({ 'src/a.ts': ALPHA + BETA });
      const head = tree({ 'src/a.ts': BETA, 'src/b.ts': `${ALPHA}// tail\n` });
      expect(checkMove(base, head).findings.map((f) => f.kind)).toContain('free comment appeared');
    });

    it('does not count a comment marker inside a string, a template or a doc comment', () => {
      const text = "const U = 'http://x';\nconst T = `a // ${1} /* b */`;\n// real\n";
      expect(comments(text)).toEqual(['// real']);
      expect(comments('/**\n * @param x // inner\n */\nfunction f(x: number) {}\n')).toEqual([
        '/**\n * @param x // inner\n */',
      ]);
    });
  });

  describe('the baselines, entry by entry', () => {
    const path = 'scripts/file-size-baseline.json';
    const run = (before: object, after: object) =>
      checkMove(tree({ [path]: JSON.stringify(before) }), tree({ [path]: JSON.stringify(after) }));

    it('refuses an entry that grew while the sum went down', () => {
      const report = run(
        { 'src/a.ts': 300, 'src/b.ts': 500 },
        { 'src/a.ts': 350, 'src/b.ts': 100 },
      );
      expect(report.pure).toBe(false);
    });

    it('accepts an entry replaced by a new path with the same number', () => {
      expect(run({ 'src/a.ts': 500 }, { 'src/b.ts': 500 }).pure).toBe(true);
    });

    it('refuses a baseline with more entries', () => {
      expect(run({ 'src/a.ts': 500 }, { 'src/a.ts': 300, 'src/b.ts': 100 }).pure).toBe(false);
    });
  });
});
