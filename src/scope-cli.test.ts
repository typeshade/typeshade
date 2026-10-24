// ═══ The input check of `bun run scope` refuses a bad revision and an empty issue ═══
//
// `scripts/scope.ts` runs its main only as the entry script. The tests here import `inputError`,
// the check that `main` runs before any work, and hold it to three answers: an unknown revision
// gives exit-2 text, an issue with neither a title nor a body gives exit-2 text, and a good input
// gives null. The repository is a throwaway one, so the revision check does not depend on the
// history of this checkout.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inputError, issueFromReplies } from '../scripts/scope.js';

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

// The issue is read through the REST API. `issueFromReplies` takes the two replies as text: the
// issue object, and the comment pages as readIssue builds them: one JSON array of pages.
describe('issueFromReplies joins the REST replies of an issue', () => {
  const issue = JSON.stringify({ number: 7, title: 'A title', body: 'The body.' });

  it('joins the body and two pages of comments in order, after the title', () => {
    const pages = JSON.stringify([[{ body: 'Comment one.' }], [{ body: 'Comment two.' }]]);
    expect(issueFromReplies(7, issue, pages)).toEqual({
      title: 'A title',
      body: 'The body.\n\nComment one.\n\nComment two.',
      number: 7,
    });
  });

  it('reads a null body and a null comment body as empty, with no empty paragraph', () => {
    const nullIssue = JSON.stringify({ number: 7, title: 'A title', body: null });
    const pages = JSON.stringify([[{ body: null }], [{ body: 'Only comment.' }]]);
    expect(issueFromReplies(7, nullIssue, pages).body).toBe('Only comment.');
  });

  it('throws the gh could not read issue 7 message for a reply that is not an object', () => {
    expect(() => issueFromReplies(7, '"text"', '[]')).toThrow(/^gh could not read issue 7:/);
    expect(() => issueFromReplies(7, 'null', '[]')).toThrow(/^gh could not read issue 7:/);
  });

  it('throws the gh could not read issue 7 message for a reply with no title', () => {
    expect(() => issueFromReplies(7, '{"body":"x"}', '[]')).toThrow(/^gh could not read issue 7:/);
  });

  it('throws for a comments reply that is not an array of arrays', () => {
    expect(() => issueFromReplies(7, issue, '{"a":1}')).toThrow(/^gh could not read issue 7:/);
    expect(() => issueFromReplies(7, issue, '[{"body":"x"}]')).toThrow(
      /^gh could not read issue 7:/,
    );
  });
});

// The command form: `scope.ts --issue` reaches `gh` only through `gh api`, never through
// `gh issue view --json`. A preload in this CLI child routes only gh to the REST fixture;
// Git stays real and no shell/PATH shim or live GitHub request is involved.
describe('scope --issue reads through gh api and never through gh issue', () => {
  const ROOT = join(__dirname, '..');
  const SCOPE = join(ROOT, 'scripts', 'scope.ts');
  const GH_PRELOAD = join(ROOT, 'scripts', 'scope', '__fixtures__', 'gh-preload.mjs');
  let dir: string;
  let log: string;

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'scope-fake-gh-')));
    log = join(dir, 'calls.log');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Runs `scope --issue 7` through the fake gh, with the calls logged to `logFile`.
  function runIssue(logFile: string, full?: string) {
    return spawnSync(
      'bun',
      ['--preload', GH_PRELOAD, SCOPE, '--issue', '7', '--at', 'HEAD', '--json'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          ...process.env,
          FAKE_GH_LOG: logFile,
          FAKE_GH_FULL: full ?? '',
        },
      },
    );
  }

  function readCalls(logFile: string): string[][] {
    return readFileSync(logFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]);
  }

  it('builds the pack from the REST replies and calls only gh api', () => {
    const result = runIssue(log);
    expect(result.status).toBe(0);
    const pack = JSON.parse(result.stdout) as { issue: { title: string; number: number } };
    expect(pack.issue.title).toBe('Canned title from the fake gh');
    expect(pack.issue.number).toBe(7);

    const calls = readCalls(log);
    expect(calls.length).toBe(2);
    for (const call of calls) {
      expect(call[0]).toBe('api');
      expect(call).not.toContain('--json');
    }
  }, 60_000);

  it('reads comment pages 1 and 2 of a full first page, and no page 3', () => {
    const commentLog = join(dir, 'comments.log');
    const result = runIssue(commentLog, 'comments');
    expect(result.status).toBe(0);

    const pages = readCalls(commentLog)
      .flat()
      .filter((arg) => arg.includes('issues/7/comments'))
      .map((arg) => new URL(`https://fake.invalid/${arg}`).searchParams.get('page'));
    expect(pages).toEqual(['1', '2']);
  }, 60_000);
});
