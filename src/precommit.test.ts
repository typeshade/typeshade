// The Git-facing runner must validate the index Git will commit, never an unstaged repair.
// These fixtures use a tiny checker in the index; the runner and Git hooks are real.
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runStagedChecks } from '../scripts/precommit.js';

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const stub = `import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
const root = process.env.TYPESHADE_DOCS_ROOT;
if (!args.includes('--snapshot') || process.env.TYPESHADE_COMMIT_SNAPSHOT !== '1' || root !== process.cwd()) {
  throw new Error('checker did not run inside the staged snapshot');
}
const payload = readFileSync('payload.txt', 'utf8');
const at = args.indexOf('--message-file');
const message = at >= 0 ? readFileSync(args[at + 1], 'utf8') : null;
const names = execFileSync('git', ['diff', '--cached', '--name-only', 'HEAD'], { encoding: 'utf8' });
writeFileSync(process.env.TYPESHADE_TEST_RECEIPT, JSON.stringify({ root, payload, message, names, args }));
if (!args.includes('--message-only') && payload !== 'pass\\n') {
  console.error('staged payload refused');
  process.exit(2);
}
if (!args.includes('--files') && !message?.includes('Approved fixture')) {
  console.error('commit message refused');
  process.exit(2);
}
`;

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function fixture(): { root: string; receipt: string; index: string } {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade commit checks '));
  dirs.push(dir);
  const root = join(dir, 'repository with spaces');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  git(root, 'init', '--quiet', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Commit fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'config', 'core.autocrlf', 'false');
  git(root, 'config', 'core.hooksPath', join(dir, 'empty-hooks'));
  mkdirSync(join(dir, 'empty-hooks'));
  writeFileSync(join(root, 'scripts/precommit.ts'), stub);
  writeFileSync(join(root, 'payload.txt'), 'base\n');
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'fixture baseline');
  return {
    root,
    receipt: join(dir, 'receipt.json'),
    index: resolve(root, git(root, 'rev-parse', '--git-path', 'index').trim()),
  };
}

function withEnv<T>(values: Record<string, string>, run: () => T): T {
  const before = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) process.env[key] = value;
    return run();
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function receipt(file: string): {
  root: string;
  payload: string;
  message: string | null;
  names: string;
  args: string[];
} {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function hooks(root: string): void {
  const driver = join(root, 'hook driver.mjs');
  const runner = pathToFileURL(resolve(import.meta.dirname, '../scripts/precommit.ts')).href;
  writeFileSync(
    driver,
    `import { runStagedChecks } from ${JSON.stringify(runner)};
try {
  process.exit(runStagedChecks(process.cwd(), { phase: process.argv[2], messageFile: process.argv[3] }));
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
`,
  );
  const dir = join(root, 'fixture hooks');
  mkdirSync(dir);
  git(root, 'config', 'core.hooksPath', dir);
  const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
  for (const [name, phase, argument] of [
    ['pre-commit', 'files', ''],
    ['commit-msg', 'message', ' "$1"'],
  ]) {
    writeFileSync(join(dir, name!), `#!/bin/sh\nexec bun ${quote(driver)} ${phase}${argument}\n`, {
      mode: 0o755,
    });
  }
}

describe('agent-neutral staged commit runner', () => {
  it('preserves LF in tracked shell hooks after an autocrlf checkout', () => {
    const f = fixture();
    const names = ['.gitattributes', 'pre-commit', 'commit-msg'];
    mkdirSync(join(f.root, '.githooks'));
    git(f.root, 'config', 'core.autocrlf', 'true');
    for (const name of names)
      writeFileSync(
        join(f.root, '.githooks', name),
        readFileSync(resolve(import.meta.dirname, '../.githooks', name)),
        { mode: 0o755 },
      );
    git(f.root, 'add', '.githooks');
    git(f.root, 'commit', '--quiet', '-m', 'tracked hooks');
    for (const name of names) rmSync(join(f.root, '.githooks', name));
    git(f.root, 'checkout', '--', '.githooks');
    for (const name of ['pre-commit', 'commit-msg']) {
      const contents = readFileSync(join(f.root, '.githooks', name), 'utf8');
      expect(contents).toMatch(/^#!\/bin\/sh\n/);
      expect(contents).not.toContain('\r');
    }
  });

  it('accepts a staged good file despite an unstaged bad edit, without modifying either tree', () => {
    const f = fixture();
    writeFileSync(join(f.root, 'payload.txt'), 'pass\n');
    git(f.root, 'add', 'payload.txt');
    writeFileSync(join(f.root, 'payload.txt'), 'fail\n');
    const index = readFileSync(f.index);
    const status = withEnv({ TYPESHADE_TEST_RECEIPT: f.receipt }, () =>
      runStagedChecks(f.root, { phase: 'files' }),
    );
    expect(status).toBe(0);
    expect(receipt(f.receipt).payload).toBe('pass\n');
    expect(receipt(f.receipt).root).not.toBe(f.root);
    expect(receipt(f.receipt).names).toContain('payload.txt');
    expect(readFileSync(f.index)).toEqual(index);
    expect(readFileSync(join(f.root, 'payload.txt'), 'utf8')).toBe('fail\n');
  });

  it('refuses a staged bad file even when an unstaged repair exists', () => {
    const f = fixture();
    writeFileSync(join(f.root, 'payload.txt'), 'fail\n');
    git(f.root, 'add', 'payload.txt');
    writeFileSync(join(f.root, 'payload.txt'), 'pass\n');
    const index = readFileSync(f.index);
    const status = withEnv({ TYPESHADE_TEST_RECEIPT: f.receipt }, () =>
      runStagedChecks(f.root, { phase: 'files' }),
    );
    expect(status).not.toBe(0);
    expect(receipt(f.receipt).payload).toBe('fail\n');
    expect(readFileSync(f.index)).toEqual(index);
    expect(readFileSync(join(f.root, 'payload.txt'), 'utf8')).toBe('pass\n');
  });

  it('honors an alternate Git index and leaves the repository index alone', () => {
    const f = fixture();
    const alternate = join(f.root, 'alternate index');
    const index = readFileSync(f.index);
    withEnv({ GIT_INDEX_FILE: alternate, TYPESHADE_TEST_RECEIPT: f.receipt }, () => {
      git(f.root, 'read-tree', 'HEAD');
      writeFileSync(join(f.root, 'payload.txt'), 'pass\n');
      git(f.root, 'add', 'payload.txt');
      writeFileSync(join(f.root, 'payload.txt'), 'fail\n');
      const alternateBytes = readFileSync(alternate);
      expect(runStagedChecks(f.root, { phase: 'files' })).toBe(0);
      expect(readFileSync(alternate)).toEqual(alternateBytes);
    });
    expect(readFileSync(f.index)).toEqual(index);
    expect(receipt(f.receipt).payload).toBe('pass\n');
  });

  it('includes tracked skip-worktree files in the snapshot', () => {
    const f = fixture();
    writeFileSync(join(f.root, 'payload.txt'), 'pass\n');
    git(f.root, 'add', 'payload.txt');
    git(f.root, 'update-index', '--skip-worktree', 'payload.txt');
    writeFileSync(join(f.root, 'payload.txt'), 'fail\n');
    const index = readFileSync(f.index);
    const status = withEnv({ TYPESHADE_TEST_RECEIPT: f.receipt }, () =>
      runStagedChecks(f.root, { phase: 'files' }),
    );
    expect(status).toBe(0);
    expect(receipt(f.receipt).payload).toBe('pass\n');
    expect(readFileSync(f.index)).toEqual(index);
    expect(readFileSync(join(f.root, 'payload.txt'), 'utf8')).toBe('fail\n');
  });

  it('requires a real message file for message/all checks and resolves relative paths from the repository', () => {
    const f = fixture();
    for (const phase of ['message', 'all'] as const)
      expect(() => runStagedChecks(f.root, { phase })).toThrow();
    writeFileSync(join(f.root, 'message with spaces.txt'), 'Approved fixture\n');
    const status = withEnv({ TYPESHADE_TEST_RECEIPT: f.receipt }, () =>
      runStagedChecks(f.root, { phase: 'message', messageFile: 'message with spaces.txt' }),
    );
    expect(status).toBe(0);
    expect(receipt(f.receipt).message).toBe('Approved fixture\n');
    expect(receipt(f.receipt).args).toContain('--message-only');
  });

  it('checks the temporary commit -a index through actual Git hooks', () => {
    const f = fixture();
    hooks(f.root);
    const base = git(f.root, 'rev-parse', 'HEAD');
    writeFileSync(join(f.root, 'payload.txt'), 'fail\n');
    const rejected = spawnSync('git', ['commit', '-am', 'Approved fixture'], {
      cwd: f.root,
      encoding: 'utf8',
      env: { ...process.env, TYPESHADE_TEST_RECEIPT: f.receipt },
    });
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain('staged payload refused');
    expect(receipt(f.receipt).payload).toBe('fail\n');
    expect(git(f.root, 'rev-parse', 'HEAD')).toBe(base);
    writeFileSync(join(f.root, 'payload.txt'), 'pass\n');
    withEnv({ TYPESHADE_TEST_RECEIPT: f.receipt }, () =>
      git(f.root, 'commit', '-am', 'Approved fixture'),
    );
    expect(git(f.root, 'show', 'HEAD:payload.txt')).toBe('pass\n');
  });

  it('reads commit -F message contents from a path containing spaces', () => {
    const f = fixture();
    hooks(f.root);
    writeFileSync(join(f.root, 'payload.txt'), 'pass\n');
    git(f.root, 'add', 'payload.txt');
    const message = join(f.root, 'commit message.txt');
    writeFileSync(message, 'Rejected fixture\n');
    const rejected = spawnSync('git', ['commit', '-F', message], {
      cwd: f.root,
      encoding: 'utf8',
      env: { ...process.env, TYPESHADE_TEST_RECEIPT: f.receipt },
    });
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain('commit message refused');
    writeFileSync(message, 'Approved fixture\n');
    withEnv({ TYPESHADE_TEST_RECEIPT: f.receipt }, () => git(f.root, 'commit', '-F', message));
    expect(git(f.root, 'log', '-1', '--format=%B')).toContain('Approved fixture');
    expect(receipt(f.receipt).message).toBe('Approved fixture\n');
  });
});
