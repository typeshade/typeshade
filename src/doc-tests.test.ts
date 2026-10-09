// ═══ A documents-only pull request runs every test that can read a document ═══
//
// `scripts/doc-tests.ts` lists the files CI's `typecheck + unit` job runs when a pull request
// changes only documents. A file it leaves out is not run for such a change, so a reader that
// stopped seeing an import would let a document change pass that should have failed. The known
// members on each side are held here (AGENTS.md#gate-discipline: the instrument must see what it
// is known to see).

import { describe, expect, it } from 'vitest';
import { classify } from '../scripts/doc-tests.js';

const kinds = new Map(classify().map((t) => [t.file, t.reason?.kind]));

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
