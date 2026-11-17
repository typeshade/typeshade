// A test that reads a refusal of `compile()` reads the editor too.
//
// A `"use typeshade"` program is read by the compiler and by the language service, and Rule 12.7
// makes the two one vocabulary. A test that reads one half passes while the other disagrees.
// This test finds each test file that names a front-end code (`TS8xxx`) on a `"use typeshade"`
// source and never reads the language service. A new such file fails here. `KNOWN` lists the
// files that did so when the check landed; the list only shrinks.
//
// The check reads the text of a file, so it sees a refusal only where the test names its code.
// A test that asserts a refusal by its sentence alone is outside it.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('.', import.meta.url));

/** The test files that read only `compile()` when this check landed. Convert one with
 *  `bothHalves` (`src/core/testing/both-halves.ts`), then remove its line. Never add a line. */
const KNOWN: readonly string[] = [
  'cli/migrate.test.ts',
  'compiler/ts/array-literal.test.ts',
  'compiler/ts/bindings.test.ts',
  'compiler/ts/builtins.test.ts',
  'compiler/ts/call-statement.test.ts',
  'compiler/ts/convert-ctor.test.ts',
  'compiler/ts/declare-bind.test.ts',
  'compiler/ts/int-lit-context.test.ts',
  'compiler/ts/math-alias.test.ts',
  'compiler/ts/math-args.test.ts',
  'compiler/ts/math-expand.test.ts',
  'compiler/ts/member-assign.test.ts',
  'compiler/ts/mixins.test.ts',
  'compiler/ts/module-const-value.test.ts',
  'compiler/ts/module.test.ts',
  'compiler/ts/packed-4x8.test.ts',
  'compiler/ts/recursion.test.ts',
  'compiler/ts/runtime-loop-bound.test.ts',
  'compiler/ts/swizzle-random.test.ts',
  'compiler/ts/texture-dims.test.ts',
  'compiler/ts/unsized-array-length.test.ts',
  'core/passes/scatter-f32.test.ts',
  'vite.test.ts',
];

/** Whether the text of a test file reads a refusal of `compile()` and not the editor. */
export function readsOnlyTheCompiler(path: string, text: string): boolean {
  if (path.startsWith('language-service/')) return false;
  const code = text.replace(/^\s*\/\/.*$/gm, '');
  const shade = /["']use typeshade["']/.test(code);
  const frontEnd = /from '[^']*(?:compiler\/ts\/|\.\/)(?:compile|source-file)\.js'/.test(code);
  const refusal = /\bTS8\d{3}\b/.test(code);
  const editor =
    /from '[^']*(?:language-service\/[^']*|language-service\.js|both-halves\.js)'/.test(code);
  return shade && frontEnd && refusal && !editor;
}

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('a test of a refusal reads both halves (Rule 12.7)', () => {
  const found = testFiles(SRC)
    .map((path) => relative(SRC, path).split(sep).join('/'))
    .filter((path) => readsOnlyTheCompiler(path, readFileSync(join(SRC, path), 'utf8')))
    .sort();

  it('no new test file reads a refusal from compile() alone', () => {
    const added = found.filter((path) => !KNOWN.includes(path));
    expect(
      added,
      'Each file names a TS8xxx code on a "use typeshade" source and never reads the language ' +
        'service. Assert both halves with bothTake or bothRefuse of ' +
        'src/core/testing/both-halves.ts. Do not add the file to KNOWN.',
    ).toEqual([]);
  });

  it('KNOWN lists no file that reads both halves now', () => {
    const converted = KNOWN.filter((path) => !found.includes(path));
    expect(converted, 'Remove each of these lines from KNOWN: the list only shrinks.').toEqual([]);
  });

  it('sees a compiler-only refusal, and spares a file that reads the editor', () => {
    const only = `import { compile } from './compiler/ts/compile.js';
const r = compile('"use typeshade";');
expect(r.diagnostics[0].code).toBe('TS8003');`;
    expect(readsOnlyTheCompiler('x.test.ts', only)).toBe(true);
    const both = `${only}\nimport { bothRefuse } from './core/testing/both-halves.js';`;
    expect(readsOnlyTheCompiler('x.test.ts', both)).toBe(false);
    expect(readsOnlyTheCompiler('x.test.ts', `// TS8003\n${only.replace('TS8003', 'x')}`)).toBe(
      false,
    );
  });
});
