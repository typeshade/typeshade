import { execFileSync, spawnSync } from 'node:child_process';
import { isComparedSource, COMMENT_BASELINE, SIZE_BASELINE, SURFACE_PATH } from './outside-move.js';
import { LAYER_POLICY_PATH } from './known-edges.js';

const MAX_BUFFER = 1024 * 1024 * 1024;

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: MAX_BUFFER });
}

export function mergeBase(root: string, base: string, head: string): string {
  return git(root, ['merge-base', base, head]).trim();
}

export function diffPaths(root: string, from: string, to: string): string[] {
  return git(root, ['diff', '--name-only', '--no-renames', '-z', from, to])
    .split('\0')
    .filter((path) => path.length > 0);
}

export function declaresPureMove(root: string, from: string, to: string): boolean {
  const values = git(root, [
    'log',
    '--format=%(trailers:key=Move,valueonly,separator=%x0a)',
    `${from}..${to}`,
  ]);
  return values.split('\n').some((value) => value.trim().toLowerCase() === 'pure');
}

const NEEDS_TEXT = new Set([SIZE_BASELINE, COMMENT_BASELINE, SURFACE_PATH, LAYER_POLICY_PATH]);

export const needsText = (path: string): boolean => isComparedSource(path) || NEEDS_TEXT.has(path);

export function readTexts(
  root: string,
  ref: string,
  paths: readonly string[],
): Map<string, string> {
  const texts = new Map<string, string>();
  if (paths.length === 0) return texts;
  const result = spawnSync('git', ['cat-file', '--batch'], {
    cwd: root,
    input: paths.map((path) => `${ref}:${path}\n`).join(''),
    maxBuffer: MAX_BUFFER,
  });
  if (result.status !== 0) throw new Error(`git cat-file failed: ${result.stderr.toString()}`);
  const out = result.stdout;
  let at = 0;
  for (const path of paths) {
    const end = out.indexOf(0x0a, at);
    const header = out.subarray(at, end).toString('utf8').split(' ');
    at = end + 1;
    if (header[1] === 'missing') continue;
    const size = Number(header[2]);
    texts.set(path, out.subarray(at, at + size).toString('utf8'));
    at += size + 1;
  }
  return texts;
}
