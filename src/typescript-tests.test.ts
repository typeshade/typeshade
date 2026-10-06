// ═══ The TypeScript legs run every test file that can load TypeScript ═══
//
// `scripts/typescript-tests.ts` lists the files CI's `typescript-versions` job runs. A file it
// leaves out runs only on the pinned TypeScript, so a reader that stopped seeing an import would
// hide a newer version's break and still look green. The known members on each side are held
// here (AGENTS.md#gate-discipline: the instrument must see what it is known to see).

import { describe, expect, it } from 'vitest';
import { classify } from '../scripts/typescript-tests.js';

const kinds = new Map(classify().map((t) => [t.file, t.reason?.kind]));

describe('the TypeScript legs run the tests that can load TypeScript', () => {
  it('lists a test that imports the compiler, the language service or the API surface', () => {
    for (const file of [
      'src/api-surface.test.ts',
      'src/language-service/ambient-parity.test.ts',
      'src/core/debug/phased.test.ts',
      'src/compiler/ts/doc-snippets.test.ts',
    ])
      expect(kinds.get(file), file).toBe('package');
  });

  it('lists a test that imports a .shade module, which the plugin compiles', () => {
    expect(kinds.get('src/vite.test.ts')).toBeDefined();
  });

  it('lists a test that starts a child process', () => {
    expect(kinds.get('src/self-contained.test.ts')).toBe('process');
  });

  it('leaves out a test that reads the IR and the backends only', () => {
    for (const file of ['src/core/ir/ir.test.ts', 'src/core/oracle.test.ts'])
      expect(kinds.get(file), file).toBeUndefined();
  });

  it('reads every test file vitest runs, itself included', () => {
    expect(kinds.has('src/typescript-tests.test.ts')).toBe(true);
    expect(kinds.size).toBeGreaterThan(300);
  });
});
