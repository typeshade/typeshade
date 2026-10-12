// ═══ The input check of `bun run scope` refuses a bad revision and an empty issue ═══
//
// `scripts/scope.ts` runs its main only as the entry script. The tests here import `inputError`,
// the check that `main` runs before any work, and hold it to three answers: an unknown revision
// gives exit-2 text, an issue with neither a title nor a body gives exit-2 text, and a good input
// gives null. The repository is a throwaway one, so the revision check does not depend on the
// history of this checkout.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inputError } from '../scripts/scope.js';

// Runs git in the throwaway repository, with a fixed identity and no signing.
function git(cwd: string, args: readonly string[]): void {
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'scope test',
      GIT_AUTHOR_EMAIL: 'scope@example.invalid',
      GIT_COMMITTER_NAME: 'scope test',
      GIT_COMMITTER_EMAIL: 'scope@example.invalid',
    },
  });
}

describe('inputError refuses the input the pack cannot use', () => {
  let dir: string;

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'scope-cli-')));
    git(dir, ['init', '-q']);
    git(dir, ['checkout', '-q', '-b', 'main']);
    writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'first']);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('gives the unknown revision message for --at nope', () => {
    expect(inputError(dir, 'nope', 'a title', 'a body')).toBe('scope: unknown revision nope');
  });

  it('gives the no-text message for an empty title and an empty body', () => {
    expect(inputError(dir, '', '', '')).toBe('scope: the issue has no text');
  });

  it('gives null for a good input at HEAD', () => {
    expect(inputError(dir, 'HEAD', 'a title', 'a body')).toBeNull();
  });
});

// The CLI itself refuses the same input: `main` runs inputError before any work and exits 2 (T7).
describe('the scope CLI exits 2 on the input inputError refuses (T7)', () => {
  let dir: string;
  const SCOPE = join(__dirname, '..', 'scripts', 'scope.ts');

  function runScope(args: readonly string[]) {
    return spawnSync('bun', [SCOPE, ...args], { cwd: dir, encoding: 'utf8' });
  }

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'scope-cli-')));
    git(dir, ['init', '-q']);
    git(dir, ['checkout', '-q', '-b', 'main']);
    writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'first']);
    writeFileSync(join(dir, 'empty.txt'), '');
    writeFileSync(join(dir, 'issue.txt'), '# A title\n\nA body.\n');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('exits 2 with the no-text message for an empty issue file', () => {
    const result = runScope(['--text-file', join(dir, 'empty.txt')]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('scope: the issue has no text');
  }, 60_000);

  it('exits 2 with the unknown-revision message for --at nope', () => {
    const result = runScope(['--text-file', join(dir, 'issue.txt'), '--at', 'nope']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('scope: unknown revision nope');
  }, 60_000);
});
