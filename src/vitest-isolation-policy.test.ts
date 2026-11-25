import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { FP64, MOCKS, NO_INLINING, NO_INLINING_MOCKS } from '../vitest.config.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TREES = ['src', 'examples'];
const MOCK_CALLS = new Set(['mock', 'doMock']);

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : testFiles(path);
    return entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

function viNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== 'vitest') continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === 'vi') names.add(element.name.text);
    }
  }
  return names;
}

export function callsViMock(path: string, text: string): boolean {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const names = viNames(source);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      names.has(node.expression.expression.text) &&
      MOCK_CALLS.has(node.expression.name.text)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const files = TREES.flatMap((tree) => testFiles(join(ROOT, tree)))
  .map((path) => relative(ROOT, path).split(sep).join('/'))
  .sort();

describe('a test file that mocks a module runs in an isolated project (vitest.config.ts, MOCKS)', () => {
  const calling = files.filter((path) => callsViMock(path, readFileSync(join(ROOT, path), 'utf8')));

  it('lists every file that calls vi.mock or vi.doMock in MOCKS', () => {
    const missing = calling.filter((path) => !MOCKS.includes(path));
    expect(
      missing,
      `${missing.join(', ')} call vi.mock or vi.doMock outside an isolated project: a mock takes effect only for a module that the worker loads after it, and the shared project reuses modules. List each file in MOCKS of vitest.config.ts.`,
    ).toEqual([]);
  });

  it('lists in MOCKS only files that exist and call vi.mock or vi.doMock', () => {
    const stale = MOCKS.filter((path) => !calling.includes(path));
    expect(
      stale,
      `${stale.join(', ')} are in MOCKS of vitest.config.ts and do not exist or call neither vi.mock nor vi.doMock. Remove each entry.`,
    ).toEqual([]);
  });

  it('puts each test file in one project', () => {
    const lists = [MOCKS, FP64, NO_INLINING];
    const all = lists.flat();
    expect(all.filter((path, index) => all.indexOf(path) !== index)).toEqual([]);
    expect(all.filter((path) => !files.includes(path))).toEqual([]);
    expect(NO_INLINING_MOCKS.filter((path) => !MOCKS.includes(path))).toEqual([]);
  });

  it('does not fire on a fixture string, a hoisted value or an unrelated mock', () => {
    const fixture = 'const text = "vi.mock(\'x\');";\n';
    const hoisted = "import { vi } from 'vitest';\nconst a = vi.hoisted(() => 1);\n";
    const other = "const vi = { mock() {} };\nvi.mock('x');\n";
    expect(callsViMock('a.test.ts', fixture)).toBe(false);
    expect(callsViMock('a.test.ts', hoisted)).toBe(false);
    expect(callsViMock('a.test.ts', other)).toBe(false);
  });

  it('fires on vi.mock, vi.doMock and a renamed vi', () => {
    expect(callsViMock('a.test.ts', "import { vi } from 'vitest';\nvi.mock('x');\n")).toBe(true);
    expect(callsViMock('a.test.ts', "import { vi } from 'vitest';\nawait vi.doMock('x');\n")).toBe(
      true,
    );
    expect(callsViMock('a.test.ts', "import { vi as v } from 'vitest';\nv.mock('x');\n")).toBe(
      true,
    );
  });
});
