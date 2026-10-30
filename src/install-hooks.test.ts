import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installHooks } from '../scripts/install-hooks.js';

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function repository(): {
  dir: string;
  root: string;
  env: NodeJS.ProcessEnv;
  git: (...args: string[]) => string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade hook install '));
  temporary.push(dir);
  const root = join(dir, 'repo with spaces');
  mkdirSync(root);
  const global = join(dir, 'global.config');
  writeFileSync(global, '');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: global,
  };
  // Git hook invocations can pass these; keep fixtures independent of the invoking repository.
  for (const key of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_COMMON_DIR',
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_PARAMETERS',
  ])
    delete env[key];
  const git = (...args: string[]): string =>
    execFileSync('git', args, {
      cwd: root,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Hook test');
  git('config', 'user.email', 'hooks@example.invalid');
  mkdirSync(join(root, '.githooks'));
  for (const name of ['pre-commit', 'commit-msg'])
    writeFileSync(join(root, '.githooks', name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return { dir, root, env, git };
}

describe('opt-in Git hook installation', () => {
  it('installs locally from a nested path with spaces and is idempotent', () => {
    const { root, env, git } = repository();
    const nested = join(root, 'nested path');
    mkdirSync(nested);
    expect(installHooks(nested, env)).toBe('installed');
    expect(git('config', '--local', '--get', 'core.hooksPath')).toBe('.githooks');
    const before = readFileSync(join(root, '.git/config'), 'utf8');
    expect(installHooks(root, env)).toBe('already-installed');
    expect(readFileSync(join(root, '.git/config'), 'utf8')).toBe(before);
  });

  it.each(['local', 'global', 'worktree'] as const)('preserves a %s hooksPath', (scope) => {
    const { root, env, git } = repository();
    if (scope === 'worktree') git('config', 'extensions.worktreeConfig', 'true');
    git('config', `--${scope}`, 'core.hooksPath', 'existing hooks');
    expect(() => installHooks(root, env)).toThrow(/already configured/);
    expect(git('config', `--${scope}`, '--get', 'core.hooksPath')).toBe('existing hooks');
    expect(git('config', '--get', 'core.hooksPath')).toBe('existing hooks');
  });

  it('does not hide a default hook or modify its contents', () => {
    const { root, env, git } = repository();
    const path = join(root, '.git/hooks/pre-commit');
    writeFileSync(path, '#!/bin/sh\necho existing\n', { mode: 0o755 });
    const config = readFileSync(join(root, '.git/config'), 'utf8');
    expect(() => installHooks(root, env)).toThrow(/Existing hook files/);
    expect(readFileSync(path, 'utf8')).toBe('#!/bin/sh\necho existing\n');
    expect(readFileSync(join(root, '.git/config'), 'utf8')).toBe(config);
    expect(() => git('config', '--local', '--get', 'core.hooksPath')).toThrow();
  });

  it('preserves an explicitly empty hooksPath', () => {
    const { root, env, git } = repository();
    git('config', '--global', 'core.hooksPath', '');
    expect(() => installHooks(root, env)).toThrow(/global: \(empty\)/);
    expect(git('config', '--global', '--get', 'core.hooksPath')).toBe('');
    expect(() => git('config', '--local', '--get', 'core.hooksPath')).toThrow();
  });

  it('uses repository-local configuration from a linked worktree', () => {
    const { dir, root, env, git } = repository();
    git('add', '.githooks');
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
    const worktree = join(dir, 'linked worktree');
    git('worktree', 'add', '--detach', worktree, 'HEAD');
    expect(installHooks(worktree, env)).toBe('installed');
    expect(installHooks(root, env)).toBe('already-installed');
    expect(git('config', '--local', '--get', 'core.hooksPath')).toBe('.githooks');
  });

  it('refuses a checkout without both tracked hook files', () => {
    const { root, env } = repository();
    rmSync(join(root, '.githooks/commit-msg'));
    expect(() => installHooks(root, env)).toThrow(/Missing tracked hook/);
  });
});
