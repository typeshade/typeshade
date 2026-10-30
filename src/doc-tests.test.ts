// ═══ A documents-only pull request runs every test that can read a document ═══
//
// `scripts/doc-tests.ts` lists the files CI's `typecheck + unit` job runs when a pull request
// changes only documents. A file it leaves out is not run for such a change, so a reader that
// stopped seeing an import would let a document change pass that should have failed. The known
// members on each side are held here (AGENTS.md#gate-discipline: the instrument must see what it
// is known to see).

import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { classify, Reader } from '../scripts/doc-tests.js';

const kinds = new Map(classify().map((t) => [t.file, t.reason?.kind]));
const fixtures: string[] = [];
afterAll(() => {
  for (const root of fixtures) rmSync(root, { recursive: true, force: true });
});

function fixture(source: string, helpers: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'typeshade-inputs-'));
  fixtures.push(root);
  for (const [file, text] of Object.entries({ 'src/entry.test.ts': source, ...helpers })) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

const reason = (root: string, conservative = true) =>
  new Reader({ conservative }).reason(join(root, 'src/entry.test.ts'));

describe('a documents-only pull request runs the tests that can read a document', () => {
  it('lists the tests that read the rules, the surface, the proposals and the changelog', () => {
    for (const file of [
      'src/api-surface.test.ts',
      'src/changes.test.ts',
      'src/changelog.test.ts',
      'src/compiler/ts/doc-snippets.test.ts',
      'src/api-doc-coverage.test.ts',
    ])
      expect(kinds.get(file), file).toBeDefined();
  });

  it('lists a test that starts a child process', () => {
    expect(kinds.get('src/self-contained.test.ts')).toBeDefined();
  });

  it('leaves out a test that reads the IR and the backends only', () => {
    for (const file of ['src/core/ir/ir.test.ts', 'src/core/oracle.test.ts'])
      expect(kinds.get(file), file).toBeUndefined();
  });

  it('reads every test file vitest runs, itself included', () => {
    expect(kinds.has('src/doc-tests.test.ts')).toBe(true);
    expect(kinds.size).toBeGreaterThan(300);
  });
});

describe('conservative inputs for code-change selection', () => {
  it('keeps filesystem reads reached through a local helper and re-export', () => {
    const root = fixture('import { read } from "./bridge.js";', {
      'src/bridge.ts': 'export { read } from "./reader.js";',
      'src/reader.ts': 'import { readFile } from "node:fs/promises"; export const read = readFile;',
    });
    expect(reason(root)).toEqual({ kind: 'io', name: 'node:fs/promises' });
    expect(reason(root, false)).toEqual({ kind: 'io', name: 'node:fs/promises' });
  });

  it.each(['typescript', 'fixture-package', 'vitest/node', '#local-alias'])(
    'keeps unanalyzed package or alias imports: %s',
    (specifier) => {
      const root = fixture(`import { read } from ${JSON.stringify(specifier)}; read();`);
      expect(reason(root)).toEqual({ kind: 'package', specifier });
      expect(reason(root, false)).toBeUndefined();
    },
  );

  it.each([
    'const value = require("./pure.js");',
    'const load = require; const value = load("./pure.js");',
    'const value = module.require("./pure.js");',
    'const value = module["require"]("./pure.js");',
    'import { createRequire as factory } from "node:module"; const load = factory(import.meta.url);',
    'import * as loader from "module"; const load = loader.createRequire(import.meta.url);',
    'import value = require("./pure.js");',
    'const fs = process.getBuiltinModule("fs");',
  ])('keeps module loaders outside the static import graph: %s', (source) => {
    const root = fixture(source, { 'src/pure.ts': 'export const value = 1;' });
    expect(reason(root)?.kind).toBe('dynamic');
    expect(reason(root, false)).toBeUndefined();
  });

  it.each(['node:worker_threads', 'cluster', 'node:vm'])(
    'keeps runtimes that can load files outside imports: %s',
    (specifier) => {
      const root = fixture(`import * as runtime from ${JSON.stringify(specifier)};`);
      expect(reason(root)?.kind).toBe('dynamic');
      expect(reason(root, false)).toBeUndefined();
    },
  );

  it.each([
    `const read = new Function('return process.getBuiltinModule("fs").readFileSync("input.ts", "utf8")'); read();`,
    `const evaluate = eval; evaluate('process.getBuiltinModule("fs").readFileSync("input.ts", "utf8")');`,
    `const compile = Function; compile('return 1')();`,
    `globalThis['eval']('1');`,
  ])('keeps evaluated source whose imports and file reads are hidden in strings: %s', (source) => {
    const root = fixture(source);
    expect(reason(root)?.kind).toBe('dynamic');
    expect(reason(root, false)).toBeUndefined();
  });

  it('keeps unresolved relative edges without changing the document classification', () => {
    const root = fixture('import "./generated.js";');
    expect(reason(root)).toEqual({ kind: 'unresolved', specifier: './generated.js' });
    expect(reason(root, false)).toBeUndefined();
  });

  it('keeps a nonliteral import through a helper', () => {
    const root = fixture('import { load } from "./loader.js";', {
      'src/loader.ts': 'export const load = (name: string) => import(name);',
    });
    expect(reason(root)?.kind).toBe('dynamic');
    expect(reason(root, false)?.kind).toBe('dynamic');
  });

  it('leaves ordinary local modules and test API imports to Vitest', () => {
    const root = fixture('import { expect } from "vitest"; import { value } from "./pure.js";', {
      'src/pure.ts': 'import { basename } from "node:path"; export const value = basename("a/b");',
    });
    expect(reason(root)).toBeUndefined();
    expect(reason(root, false)).toBeUndefined();
  });

  it('exposes the conservative mode without changing default callers', () => {
    const root = fixture('import ts from "typescript";');
    execFileSync('git', ['init', '--quiet'], { cwd: root, stdio: 'ignore' });
    expect(classify(root)).toEqual([{ file: 'src/entry.test.ts', reason: undefined }]);
    expect(classify(root, { conservative: true })).toEqual([
      { file: 'src/entry.test.ts', reason: { kind: 'package', specifier: 'typescript' } },
    ]);
  });
});
