import { describe, expect, it } from 'vitest';
import { changelogNone, judgeChangelog, ships } from '../scripts/changelog-check.js';
import type { Diff } from '../scripts/doc-impact.js';

const diff = (modified: string[], added: string[] = []): Diff => ({
  base: 'HEAD',
  staged: true,
  deleted: [],
  renamed: [],
  modified,
  added,
  touched: new Map(),
  removedLines: new Map(),
  removedAt: new Map(),
});

describe('a shipped change names itself in CHANGELOG.md', () => {
  it('asks for an entry when a shipped source file changes alone', () => {
    const problems = judgeChangelog(diff(['src/core/host-kernel.ts']), 'fix: a thing');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('src/core/host-kernel.ts');
  });

  it('passes with an entry, or with a reason for none', () => {
    expect(judgeChangelog(diff(['src/core/host-kernel.ts', 'CHANGELOG.md']), 'fix')).toEqual([]);
    expect(
      judgeChangelog(
        diff(['src/core/host-kernel.ts']),
        'x\n\nChangelog: none, internal refactor\n',
      ),
    ).toEqual([]);
  });

  it('owes nothing for tests, test support, docs and scripts', () => {
    for (const f of [
      'src/core/host-kernel.test.ts',
      'src/core/testing/kernel-plan.ts',
      'docs/debugging.md',
      'scripts/changes.ts',
      'examples/__emit-goldens__/hello.wgsl',
    ])
      expect(ships(f), f).toBe(false);
    expect(
      judgeChangelog(diff(['src/core/host-kernel.test.ts', 'docs/debugging.md']), 'test'),
    ).toEqual([]);
  });

  it('takes a none line only with a reason', () => {
    expect(changelogNone('Changelog: none, test-only')).toBe('test-only');
    expect(changelogNone('Changelog: none')).toBeNull();
    expect(changelogNone('Changelog: none,   ')).toBeNull();
  });
});
