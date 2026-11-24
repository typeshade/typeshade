import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkMove, checkRange, formatReport } from '../scripts/move-purity.js';
import { fileComments } from '../scripts/move-purity/comments.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const tree = (files: Record<string, string>): Map<string, string> => new Map(Object.entries(files));

const ALPHA = `/** Adds one. */\nfunction addOne(x: number): number {\n  return x + 1;\n}\n`;
const BETA = `const LIMIT = 4;\n\nfunction clamp(x: number): number {\n  return Math.min(x, LIMIT);\n}\n`;

const surface = (path: string): string =>
  `# surface\n\n${path}#abs  const  { (x: number): number; }\nsrc/b.ts#add  const  { (a: number): number; }\n`;

describe('the move-purity check (docs/structure-refactoring-plan.md, S0 item a)', () => {
  it('accepts a declaration moved from one file to another', () => {
    const base = tree({ 'src/a.ts': ALPHA + BETA, 'src/b.ts': `const X = 1;\n` });
    const head = tree({ 'src/a.ts': BETA, 'src/b.ts': `const X = 1;\n${ALPHA}` });
    const report = checkMove(base, head);
    expect(report.pure).toBe(true);
    expect(report.units.moved).toEqual([
      {
        from: { path: 'src/a.ts', line: 2, names: ['addOne'] },
        to: { path: 'src/b.ts', line: 3, names: ['addOne'] },
      },
    ]);
  });

  it('accepts an export keyword added to a moved declaration and reports it', () => {
    const base = tree({ 'src/a.ts': ALPHA });
    const head = tree({ 'src/b.ts': ALPHA.replace('function', 'export function') });
    const report = checkMove(base, head);
    expect(report.pure).toBe(true);
    expect(report.units.exportsAdded.map((u) => u.names)).toEqual([['addOne']]);
    expect(report.units.exportsRemoved).toEqual([]);
  });

  it('accepts an export keyword removed and reports it', () => {
    const base = tree({ 'src/a.ts': `export const A = 1;\nexport default 2;\n` });
    const head = tree({ 'src/a.ts': `const A = 1;\nexport default 2;\n` });
    const report = checkMove(base, head);
    expect(report.pure).toBe(true);
    expect(report.units.exportsRemoved.map((u) => u.names)).toEqual([['A']]);
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
    const base = tree({ 'src/a.ts': ALPHA + BETA });
    const head = tree({ 'src/a.ts': BETA });
    const report = checkMove(base, head);
    expect(report.pure).toBe(false);
    expect(report.units.vanished.map((u) => u.names)).toEqual([['addOne']]);
  });

  it('accepts a change of import and export-from lines only', () => {
    const base = tree({
      'src/a.ts': `import { x } from './x.js';\nexport { x } from './x.js';\nexport { y };\n${BETA}`,
    });
    const head = tree({
      'src/a.ts': `import { z } from './z.js';\nexport * from './z.js';\n${BETA}`,
    });
    expect(checkMove(base, head).pure).toBe(true);
  });

  it('accepts a facade that holds only re-exports', () => {
    const base = tree({ 'src/a.ts': ALPHA + BETA });
    const head = tree({
      'src/a.ts': `export { addOne, clamp } from './a/parts.js';\n`,
      'src/a/parts.ts': `import type { Y } from '../y.js';\n${ALPHA.replace('function', 'export function')}\n${BETA.replace('function', 'export function')}`,
    });
    expect(checkMove(base, head).pure).toBe(true);
  });

  it('refuses a reformatted body', () => {
    const base = tree({ 'src/a.ts': ALPHA });
    const head = tree({ 'src/a.ts': ALPHA.replace('  return x + 1;', '    return x + 1;') });
    expect(checkMove(base, head).pure).toBe(false);
  });

  it('accepts a change of line endings', () => {
    const base = tree({ 'src/a.ts': ALPHA });
    const head = tree({ 'src/a.ts': ALPHA.replace(/\n/g, '\r\n') });
    expect(checkMove(base, head).pure).toBe(true);
  });

  it('refuses an edit of the comment directly above a moved declaration', () => {
    const base = tree({ 'src/a.ts': ALPHA });
    const head = tree({ 'src/b.ts': ALPHA.replace('Adds one.', 'Adds two.') });
    expect(checkMove(base, head).pure).toBe(false);
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
    expect(report.pure).toBe(false);
    expect(report.titles.vanished.map((t) => t.title)).toEqual(['works']);
    expect(report.titles.appeared.map((t) => t.title)).toEqual(['works well']);
    const removed = tree({ 'src/a.test.ts': `describe('a', () => {});\n` });
    expect(checkMove(base, removed).pure).toBe(false);
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

  it('accepts a test moved between test files', () => {
    const one = `describe('one', () => {\n  it('a', () => {});\n});\n`;
    const two = `describe('two', () => {\n  it('b', () => {});\n});\n`;
    const base = tree({ 'src/a.test.ts': one + two });
    const head = tree({ 'src/a.test.ts': one, 'src/b.test.ts': two });
    expect(checkMove(base, head).pure).toBe(true);
  });

  it('refuses a changed file outside the allowed list', () => {
    const base = tree({ 'package.json': '{}', 'docs/notes': 'a' });
    const head = tree({ 'package.json': '{"a":1}', 'docs/notes': 'b' });
    const report = checkMove(base, head);
    expect(report.pure).toBe(false);
    expect(report.outside.map((o) => o.path)).toEqual(['package.json']);
  });

  it('refuses a non-TypeScript file of src/ and accepts documents and proposals', () => {
    const base = tree({ 'src/data.json': '{}' });
    expect(checkMove(base, tree({ 'src/data.json': '[]' })).pure).toBe(false);
    const docs = checkMove(tree({}), tree({ 'docs/notes': 'x', 'changes/proposal': 'x' }));
    expect(docs.pure).toBe(true);
  });

  describe('the KNOWN list of src/layer-policy.test.ts', () => {
    const list = (edges: string[]): string =>
      `const MAY = 1;\n\nconst KNOWN: readonly string[] = [\n${edges.map((e) => `  '${e}',\n`).join('')}];\n`;
    const path = 'src/layer-policy.test.ts';

    it('accepts a removed line and reports it', () => {
      const base = tree({ [path]: list(['a.ts -> b.ts', 'c.ts -> d.ts']) });
      const head = tree({ [path]: list(['c.ts -> d.ts']) });
      const report = checkMove(base, head);
      expect(report.pure).toBe(true);
      expect(report.knownEdgesRemoved).toEqual(['a.ts -> b.ts']);
    });

    it('accepts the last line removed', () => {
      const report = checkMove(
        tree({ [path]: list(['a.ts -> b.ts']) }),
        tree({ [path]: list([]) }),
      );
      expect(report.pure).toBe(true);
    });

    it('refuses an added line', () => {
      const base = tree({ [path]: list(['a.ts -> b.ts']) });
      const head = tree({ [path]: list(['a.ts -> b.ts', 'c.ts -> d.ts']) });
      const report = checkMove(base, head);
      expect(report.pure).toBe(false);
      expect(report.outside).toEqual([{ path, reason: 'KNOWN edge added: c.ts -> d.ts' }]);
    });

    it('refuses an edit of the rest of the file', () => {
      const base = tree({ [path]: list(['a.ts -> b.ts']) });
      const head = tree({ [path]: list([]).replace('MAY = 1', 'MAY = 2') });
      expect(checkMove(base, head).pure).toBe(false);
    });
  });

  describe('src/__api__/surface.md', () => {
    const path = 'src/__api__/surface.md';

    it('accepts a change of the path of a definition and counts it', () => {
      const report = checkMove(
        tree({ [path]: surface('src/a.ts') }),
        tree({ [path]: surface('src/a/part.ts') }),
      );
      expect(report.pure).toBe(true);
      expect(report.surfacePathChanges).toBe(1);
    });

    it('refuses a change of the shape of a definition', () => {
      const head = surface('src/a.ts').replace('number; }\nsrc/b', 'string; }\nsrc/b');
      expect(checkMove(tree({ [path]: surface('src/a.ts') }), tree({ [path]: head })).pure).toBe(
        false,
      );
    });
  });

  describe('the baselines', () => {
    it('accepts a number that went down and a new smaller entry', () => {
      const base = tree({ 'scripts/file-size-baseline.json': '{"src/a.ts": 500}' });
      const head = tree({ 'scripts/file-size-baseline.json': '{"src/a.ts": 300}' });
      expect(checkMove(base, head).pure).toBe(true);
    });

    it('refuses a baseline whose sum went up', () => {
      const base = tree({ 'scripts/comment-baseline.json': '{"src/a.ts": 3}' });
      const head = tree({ 'scripts/comment-baseline.json': '{"src/a.ts": 3, "src/b.ts": 1}' });
      expect(checkMove(base, head).pure).toBe(false);
    });
  });

  describe('the order of declarations', () => {
    const a = 'const A = 1;\n';
    const b = 'const B = 2;\n';
    const c = 'const C = 3;\n';
    const d = 'const D = 4;\n';

    it('refuses two declarations swapped inside a file', () => {
      const report = checkMove(tree({ 'src/a.ts': a + b }), tree({ 'src/a.ts': b + a }));
      expect(report.pure).toBe(false);
      expect(report.units.reordered.map((u) => u.names)).toEqual([['B']]);
    });

    it('refuses two moved declarations swapped in the target', () => {
      const base = tree({ 'src/a.ts': a + b + c });
      const head = tree({ 'src/a.ts': c, 'src/b.ts': b + a });
      const report = checkMove(base, head);
      expect(report.pure).toBe(false);
      expect(report.units.reordered).toEqual([{ path: 'src/b.ts', line: 1, names: ['B'] }]);
    });

    it('accepts moved declarations interleaved in order with existing ones', () => {
      const base = tree({ 'src/a.ts': a + b + c, 'src/b.ts': d });
      const head = tree({ 'src/a.ts': c, 'src/b.ts': a + d + b });
      expect(checkMove(base, head).pure).toBe(true);
    });

    it('orders units of different sources only within each source', () => {
      const base = tree({ 'src/a.ts': a + b, 'src/b.ts': c + d });
      const head = tree({ 'src/t.ts': c + a + d + b });
      expect(checkMove(base, head).pure).toBe(true);
    });
  });

  describe('free comments', () => {
    it('refuses a header comment that was deleted', () => {
      const base = tree({ 'src/a.ts': `// header\nimport { x } from './x.js';\n${BETA}` });
      const head = tree({ 'src/a.ts': `import { x } from './x.js';\n${BETA}` });
      const report = checkMove(base, head);
      expect(report.pure).toBe(false);
      expect(report.comments.vanished.map((c) => c.text)).toEqual(['// header']);
    });

    it('refuses an edited comment above an import', () => {
      const base = tree({ 'src/a.ts': `// one\nimport { x } from './x.js';\n${BETA}` });
      const head = tree({ 'src/a.ts': `// two\nimport { x } from './x.js';\n${BETA}` });
      const report = checkMove(base, head);
      expect(report.pure).toBe(false);
      expect(report.comments.appeared.map((c) => c.text)).toEqual(['// two']);
    });

    it('refuses a comment at the end of a file and one before a closing brace', () => {
      const base = tree({ 'src/a.ts': `function f() {\n  // inner\n}\n// tail\n` });
      const head = tree({ 'src/a.ts': `function f() {\n  // inner\n}\n` });
      expect(checkMove(base, head).comments.vanished.map((c) => c.text)).toEqual(['// tail']);
      const inner = tree({ 'src/a.ts': `function f() {\n}\n// tail\n` });
      expect(checkMove(base, inner).pure).toBe(false);
    });

    it('does not count a comment marker inside a string or a template literal', () => {
      const text = "const U = 'http://x';\nconst T = `a // ${1} /* b */`;\n// real\n";
      expect(fileComments('src/a.ts', text).map((c) => c.text)).toEqual(['// real']);
    });
  });

  describe('the baselines, entry by entry', () => {
    const path = 'scripts/file-size-baseline.json';
    const run = (before: object, after: object) =>
      checkMove(tree({ [path]: JSON.stringify(before) }), tree({ [path]: JSON.stringify(after) }));

    it('refuses an entry that grew while the sum went down', () => {
      expect(
        run({ 'src/a.ts': 300, 'src/b.ts': 500 }, { 'src/a.ts': 350, 'src/b.ts': 100 }).pure,
      ).toBe(false);
    });

    it('accepts an entry replaced by a new path with the same number', () => {
      expect(run({ 'src/a.ts': 500 }, { 'src/b.ts': 500 }).pure).toBe(true);
    });

    it('refuses a baseline with more entries', () => {
      expect(run({ 'src/a.ts': 500 }, { 'src/a.ts': 300, 'src/b.ts': 100 }).pure).toBe(false);
    });
  });

  describe('files outside src/', () => {
    const source = "import { a } from '../src/a.js';\nconst NAME = 'one';\n";

    it('accepts a script with only an import path changed', () => {
      const head = source.replace('../src/a.js', '../src/a/part.js');
      expect(checkMove(tree({ 'scripts/x.ts': source }), tree({ 'scripts/x.ts': head })).pure).toBe(
        true,
      );
    });

    it('refuses a script with a string literal changed', () => {
      const head = source.replace("'one'", "'two'");
      expect(checkMove(tree({ 'scripts/x.ts': source }), tree({ 'scripts/x.ts': head })).pure).toBe(
        false,
      );
    });
  });

  it('reads a range of this repository, and finds the head of a range equal to itself pure', () => {
    const report = checkRange(ROOT, 'HEAD', 'HEAD');
    expect(report.pure).toBe(true);
    expect(report.changedPaths).toBe(0);
    expect(report.units.moved).toEqual([]);
  });
});
