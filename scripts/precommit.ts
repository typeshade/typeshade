// Agent-independent commit validation. Export the effective Git index so unstaged fixes cannot
// hide staged defects, and unstaged defects cannot reject a valid partial commit.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommitPhase } from './doc-impact.js';

export function runStagedChecks(
  root: string,
  options: { phase: CommitPhase; messageFile?: string },
): number {
  if (options.phase !== 'files' && !options.messageFile)
    throw new Error('Message checks require --message-file <path>.');
  const messageFile = options.messageFile ? resolve(root, options.messageFile) : undefined;
  if (messageFile) readFileSync(messageFile, 'utf8'); // Fail before creating a snapshot.
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const gitDir = git('rev-parse', '--absolute-git-dir');
  const index = git('rev-parse', '--path-format=absolute', '--git-path', 'index');
  const temp = mkdtempSync(join(tmpdir(), 'typeshade-commit-'));
  try {
    const tree = join(temp, 'tree');
    mkdirSync(tree);
    const frozenIndex = join(temp, 'index');
    copyFileSync(index, frozenIndex);
    const env = {
      ...process.env,
      GIT_DIR: gitDir,
      GIT_WORK_TREE: tree,
      GIT_INDEX_FILE: frozenIndex,
      GIT_OPTIONAL_LOCKS: '0',
      TYPESHADE_DOCS_ROOT: tree,
      TYPESHADE_COMMIT_SNAPSHOT: '1',
    };
    execFileSync(
      'git',
      ['checkout-index', '--all', '--ignore-skip-worktree-bits', `--prefix=${tree}${sep}`],
      { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const deps = join(root, 'node_modules');
    if (existsSync(deps)) symlinkSync(resolve(deps), join(tree, 'node_modules'), 'junction');
    const checker = join(tree, 'scripts', 'precommit.ts');
    if (!existsSync(checker)) throw new Error('Stage scripts/precommit.ts before using the hooks.');
    const args = [checker, '--snapshot'];
    if (options.phase === 'files') args.push('--files');
    if (options.phase === 'message') args.push('--message-only');
    if (messageFile) args.push('--message-file', messageFile);
    const result = spawnSync(process.execPath, args, { cwd: tree, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    return result.status ?? 1;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    let messageFile: string | undefined;
    let phase: CommitPhase = 'files';
    let snapshot = false;
    let files = false;
    let messageOnly = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--snapshot') snapshot = true;
      else if (args[i] === '--files') files = true;
      else if (args[i] === '--message-only') messageOnly = true;
      else if (args[i] === '--message-file' && args[i + 1] && !args[i + 1]!.startsWith('--'))
        messageFile = resolve(args[++i]!);
      else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
    }
    if (files && (messageOnly || messageFile))
      throw new Error('--files cannot take message options.');
    if (messageOnly && !messageFile) throw new Error('--message-only requires --message-file.');
    if (messageFile) phase = messageOnly ? 'message' : 'all';
    if (snapshot) {
      if (process.env.TYPESHADE_COMMIT_SNAPSHOT !== '1') throw new Error('--snapshot is internal.');
      const { checkCommit, readDiff } = await import('./doc-impact.js');
      const message = messageFile ? readFileSync(messageFile, 'utf8') : '';
      process.exitCode = await checkCommit(readDiff('HEAD', true), message, phase);
    } else {
      const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
      process.exitCode = runStagedChecks(root, { phase, messageFile });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
