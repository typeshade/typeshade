import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALPHA, exported, tree } from './core/testing/move-purity-fixtures.js';
import { checkMove, type MoveReport } from '../scripts/move-purity.js';
import {
  ACCEPTED_CLASS_MEMBER_KINDS,
  ACCEPTED_EXPRESSION_KINDS,
  ACCEPTED_OBJECT_MEMBER_KINDS,
  ACCEPTED_STATEMENT_KINDS,
  acceptedKindNames,
} from '../scripts/move-purity/accepted-kinds.js';
import { activeUnitsOf } from '../scripts/move-purity/clean-files.js';
import { cleanReport } from '../scripts/move-purity/clean-report.js';
import { createSide } from '../scripts/move-purity/side-program.js';
import { KNOWN_PATH_LISTS, pathLists } from '../scripts/move-purity/vitest-config.js';

const kinds = (report: MoveReport): string[] => [...new Set(report.findings.map((f) => f.kind))];
const root = (name: string): string => fileURLToPath(new URL(`../${name}`, import.meta.url));

describe('edges are what really loads (A3)', () => {
  const klass = 'export class T {}\n';
  const user = (specifier: string): string =>
    `import { T } from '${specifier}';\nexport function f(x: T): void {}\n`;

  it('refuses a value import that a changed file uses only as a type', () => {
    const base = tree({ 'src/t.ts': klass, 'src/a.ts': user('./t.js') + 'export const K = 1;\n' });
    const head = tree({ 'src/t.ts': klass, 'src/a.ts': user('./t.js') });
    const found = checkMove(base, head).findings.find(
      (f) => f.kind === 'value import used only as a type path',
    );
    expect(found).toMatchObject({ path: 'src/a.ts', detail: './t.js' });
  });

  it('accepts the same import written as a type import', () => {
    const text = "import type { T } from './t.js';\nexport function f(x: T): void {}\n";
    const base = tree({ 'src/t.ts': klass, 'src/a.ts': text + 'export const K = 1;\n' });
    const head = tree({ 'src/t.ts': klass, 'src/a.ts': text });
    expect(kinds(checkMove(base, head))).not.toContain('value import used only as a type path');
  });

  it('draws no cycle through an import that is used only as a type', () => {
    const report = cleanReport(
      '/edges-fixture',
      tree({
        'src/a.ts': "import { fb } from './b.js';\nexport class A {}\nexport const fa = fb;\n",
        'src/b.ts':
          "import { A } from './a.js';\nexport function fb(x?: A): number {\n  return 1;\n}\n",
      }),
    );
    expect(report.cycles).toEqual([]);
  });

  it('draws a cycle through an import that is used as a value', () => {
    const report = cleanReport(
      '/edges-fixture',
      tree({
        'src/a.ts':
          "import { fb } from './b.js';\nexport function fa(): number {\n  return fb();\n}\n",
        'src/b.ts':
          "import { fa } from './a.js';\nexport function fb(): number {\n  return fa();\n}\n",
      }),
    );
    expect(report.cycles).toHaveLength(1);
  });

  it('holds while no tsconfig sets an option that keeps unused imports', () => {
    const configs = readdirSync(root('.')).filter((name) => /^tsconfig.*\.json$/.test(name));
    expect(configs).toContain('tsconfig.base.json');
    for (const name of configs) {
      const text = readFileSync(root(name), 'utf8');
      expect(text).not.toMatch(/verbatimModuleSyntax|preserveValueImports|importsNotUsedAsValues/);
    }
  });
});

describe('a file the range changes may not gain export * (A5)', () => {
  it('refuses a facade that re-exports with a star', () => {
    const base = tree({ 'src/a.ts': exported(ALPHA) });
    const head = tree({
      'src/a.ts': "export * from './a/part.js';\n",
      'src/a/part.ts': exported(ALPHA),
    });
    expect(checkMove(base, head).findings).toContainEqual({
      kind: 'export * added',
      path: 'src/a.ts',
      detail: '',
    });
  });
});

describe('a describe is movable only when it holds no collection-time code (A6)', () => {
  const countOf = (body: string): number => {
    const side = createSide('/describe-fixture', tree({ 'src/a.test.ts': body }));
    return activeUnitsOf(side, 'src/a.test.ts').length;
  };
  const header = "import { describe, it, beforeEach, vi } from 'vitest';\n";

  it.each([
    [
      'tests, nested describes and hooks',
      "describe('a', () => {\n  beforeEach(() => {});\n  it('b', () => {});\n  describe('c', () => {\n    it.skip('d', () => {});\n  });\n});\n",
    ],
    [
      'a free constant and a function',
      "describe('a', () => {\n  const K = 1;\n  function h() {}\n  it('b', () => {});\n});\n",
    ],
    [
      'an each table of literals',
      "describe.each([[1], [2]])('a %s', (n) => {\n  it('b', () => {});\n});\n",
    ],
  ])('accepts a describe with %s', (_name, text) => {
    expect(countOf(header + text)).toBe(0);
  });

  it.each([
    ['a call', "describe('a', () => {\n  vi.mock('x');\n  it('b', () => {});\n});\n"],
    [
      'a constant from a call',
      "describe('a', () => {\n  const x = make();\n  it('b', () => {});\n});\n",
    ],
    ['an assignment', "let x = 0;\ndescribe('a', () => {\n  x = 1;\n  it('b', () => {});\n});\n"],
    [
      'a nested describe with a call',
      "describe('a', () => {\n  describe('c', () => {\n    run();\n  });\n});\n",
    ],
    [
      'an each table with a call',
      "describe.each(make())('a', () => {\n  it('b', () => {});\n});\n",
    ],
    ['a body that is an expression', "describe('a', () => it('b', () => {}));\n"],
    ['a computed title', "describe(make(), () => {\n  it('b', () => {});\n});\n"],
  ])('refuses a describe with %s', (_name, text) => {
    expect(countOf(header + text)).toBeGreaterThan(0);
  });

  it('names collection-time code in the reason', () => {
    const side = createSide(
      '/describe-fixture',
      tree({ 'src/a.test.ts': header + "describe('a', () => {\n  run();\n});\n" }),
    );
    expect(activeUnitsOf(side, 'src/a.test.ts')[0]?.reason).toContain(
      'collection-time code in describe',
    );
  });
});

describe('a test moves with its traceability markers (A6)', () => {
  const header = "import { describe, it } from 'vitest';\n";
  const one = "describe('one', () => {\n  it('a', () => {});\n});\n";
  const two = "describe('two', () => {\n  it('b', () => {});\n});\n";
  const marker = `// ${['Verifies', 'Rule 1.1'].join(': ')}\n`;

  it('refuses a move between files whose markers differ', () => {
    const base = tree({ 'src/a.test.ts': marker + header + one + two });
    const head = tree({ 'src/a.test.ts': marker + header + one, 'src/b.test.ts': header + two });
    expect(kinds(checkMove(base, head))).toContain('test moved across a traceability marker');
  });

  it('accepts a move between files that already carry the same markers', () => {
    const three = "describe('three', () => {\n  it('c', () => {});\n});\n";
    const base = tree({
      'src/a.test.ts': marker + header + one + two,
      'src/b.test.ts': marker + header + three,
    });
    const head = tree({
      'src/a.test.ts': marker + header + one,
      'src/b.test.ts': marker + header + three + two,
    });
    expect(checkMove(base, head).pure).toBe(true);
  });
});

describe('where a unit may move (A7)', () => {
  const fn = 'export function f(): number {\n  return 1;\n}\n';

  it('refuses a changed, added or deleted shade file', () => {
    const shade = '"use typeshade";\n' + fn;
    expect(kinds(checkMove(tree({}), tree({ 'src/a.shade.ts': shade })))).toContain(
      'shade files do not take part in a pure move',
    );
    expect(kinds(checkMove(tree({ 'src/a.shade.ts': shade }), tree({})))).toContain(
      'shade files do not take part in a pure move',
    );
  });

  it('refuses a unit that moves to another top-level directory', () => {
    const report = checkMove(tree({ 'src/a.ts': fn }), tree({ 'scripts/a.ts': fn }));
    expect(kinds(report)).toContain('unit moved across top-level directories');
  });

  it('refuses a unit of a file that a configuration names by its path', () => {
    const config = (path: string): string => JSON.stringify({ files: [path] });
    const base = tree({ 'tsconfig.json': config('src/a.ts'), 'src/a.ts': fn });
    const head = tree({
      'tsconfig.json': config('src/a.ts'),
      'src/a.ts': "export { f } from './a/part.js';\n",
      'src/a/part.ts': fn,
    });
    expect(kinds(checkMove(base, head))).toContain('path is named in tsconfig.json');
    const added = checkMove(
      tree({ 'tsconfig.json': config('src/n.ts') }),
      tree({ 'tsconfig.json': config('src/n.ts'), 'src/n.ts': fn }),
    );
    expect(kinds(added)).toContain('path is named in tsconfig.json');
  });

  it('does not refuse a file that no configuration names', () => {
    const base = tree({ 'tsconfig.json': '{"files":["src/z.ts"]}', 'src/a.ts': fn });
    const head = tree({
      'tsconfig.json': '{"files":["src/z.ts"]}',
      'src/a.ts': "export { f } from './a/part.js';\n",
      'src/a/part.ts': fn,
    });
    expect(checkMove(base, head).pure).toBe(true);
  });
});

describe('the reasons a range is refused, by text', () => {
  const header = "import { describe, it } from 'vitest';\n";
  const one = "describe('one', () => {\n  it('a', () => {});\n});\n";
  const two = "describe('two', () => {\n  it('b', () => {});\n});\n";

  it.each(['MOCKS', 'FP64'])(
    'names a test moved across the %s list of vitest.config.ts',
    (list) => {
      const config = `const ${list} = ['src/a.test.ts'];\n`;
      const base = tree({ 'vitest.config.ts': config, 'src/a.test.ts': header + one + two });
      const head = tree({
        'vitest.config.ts': config,
        'src/a.test.ts': header + one,
        'src/b.test.ts': header + two,
      });
      expect(kinds(checkMove(base, head))).toContain('test moved across a vitest project path');
    },
  );

  const reasons = (base: Record<string, string>, head: Record<string, string>): string[] =>
    checkMove(tree(base), tree(head)).outside.map((entry) => entry.reason);

  it('names a document that changed more than a renamed path', () => {
    expect(reasons({ 'README.md': 'one\n' }, { 'README.md': 'two\n' })).toContain(
      'a document may only follow a renamed path',
    );
  });

  it('names a line of surface.md that changed more than its path', () => {
    const line = (shape: string): string => `src/a.ts#f ${shape}\n`;
    expect(
      reasons(
        { 'src/__api__/surface.md': line('(): number') },
        { 'src/__api__/surface.md': line('(): string') },
      ),
    ).toContain('a line changed more than its path');
  });

  it('names a file that a pure move may not change', () => {
    expect(reasons({ 'notes.txt': 'a' }, { 'notes.txt': 'b' })).toContain(
      'a pure move may not change this file',
    );
  });

  it('names a file that a pure move never changes', () => {
    expect(reasons({ 'CLAUDE.md': 'a' }, { 'CLAUDE.md': 'b' })).toContain(
      'a pure move never changes this file',
    );
  });
});

describe('the path lists of vitest.config.ts', () => {
  it('are the lists that the check knows', () => {
    const text = readFileSync(root('vitest.config.ts'), 'utf8');
    expect([...pathLists(text).keys()].sort()).toEqual([...KNOWN_PATH_LISTS].sort());
  });
});

describe('the plan lists what the classifier accepts', () => {
  const plan = readFileSync(root('docs/structure-refactoring-plan.md'), 'utf8');
  const listed = (label: string): string[] => {
    const line = plan.split('\n').find((l) => l.trim().startsWith(`Accepted ${label} kinds:`));
    return [...(line ?? '').matchAll(/`(\w+)`/g)].map((m) => m[1]!);
  };

  it.each([
    ['statement', ACCEPTED_STATEMENT_KINDS],
    ['expression', ACCEPTED_EXPRESSION_KINDS],
    ['class member', ACCEPTED_CLASS_MEMBER_KINDS],
    ['object member', ACCEPTED_OBJECT_MEMBER_KINDS],
  ] as const)('names the accepted %s kinds as the table does', (label, table) => {
    expect(listed(label)).toEqual(acceptedKindNames(table));
  });
});
