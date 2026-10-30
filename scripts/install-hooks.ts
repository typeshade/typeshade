// Opt-in repository-local Git hooks. Never replace an existing hook configuration silently.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const HOOKS_PATH = '.githooks';

/** Install the tracked hooks for this repository (shared by its linked worktrees).
 * Existing hooks and non-matching configuration require the owner's explicit integration. */
export function installHooks(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): 'installed' | 'already-installed' {
  const git = (...args: string[]): string => {
    const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr.trim() || `git exited ${result.status}`);
    return result.stdout.replace(/\r?\n$/, '');
  };
  const root = git('rev-parse', '--show-toplevel');
  for (const name of ['pre-commit', 'commit-msg']) {
    const path = join(root, HOOKS_PATH, name);
    if (!existsSync(path) || !statSync(path).isFile())
      throw new Error(`Missing tracked hook: ${path}. Check out the hook files before installing.`);
  }

  const configured = spawnSync('git', ['config', '--show-scope', '--get-all', 'core.hooksPath'], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  if (configured.error) throw configured.error;
  if (configured.status !== 0 && configured.status !== 1)
    throw new Error(configured.stderr.trim() || `git config exited ${configured.status}`);
  if (configured.status === 0) {
    const values = configured.stdout.replace(/\r?\n$/, '').split(/\r?\n/);
    const last = values[values.length - 1]!;
    const split = last.indexOf('\t');
    if (split < 0)
      throw new Error('Cannot read the existing core.hooksPath configuration; no changes made.');
    const scope = last.slice(0, split);
    const value = last.slice(split + 1);
    // No write is needed if the effective setting is already our repository-local value.
    if (scope === 'local' && value === HOOKS_PATH) return 'already-installed';
    throw new Error(
      `core.hooksPath is already configured (${scope}: ${value || '(empty)'}). ` +
        'No configuration was changed. Integrate the tracked hooks with the existing setup, ' +
        'or deliberately remove that setting before running hooks:install again.',
    );
  }

  // With no override, Git uses the common hook directory, including for a linked worktree.
  const hooks = git('rev-parse', '--path-format=absolute', '--git-path', 'hooks');
  const existing = existsSync(hooks)
    ? readdirSync(hooks).filter((name) => !name.endsWith('.sample'))
    : [];
  if (existing.length)
    throw new Error(
      `Existing hook files in ${hooks}: ${existing.sort().join(', ')}. ` +
        'No configuration was changed. Integrate or move these files deliberately before installing.',
    );
  git('config', '--local', 'core.hooksPath', HOOKS_PATH);
  return 'installed';
}

if (import.meta.main) {
  try {
    const result = installHooks(process.cwd());
    console.log(
      `Git hooks ${result === 'installed' ? 'installed' : 'already installed'}: ${HOOKS_PATH}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
