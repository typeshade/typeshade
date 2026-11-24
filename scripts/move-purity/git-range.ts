import { execFileSync, spawnSync } from 'node:child_process';
import type { DiffEntry } from './outside-move.js';

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

export function diffEntries(root: string, from: string, to: string): DiffEntry[] {
  const tokens = git(root, ['diff', '--raw', '--no-renames', '-z', from, to]).split('\0');
  const entries: DiffEntry[] = [];
  for (let at = 0; at + 1 < tokens.length; at += 2) {
    const [oldMode, newMode] = tokens[at]!.slice(1).split(' ');
    entries.push({ path: tokens[at + 1]!, oldMode: oldMode!, newMode: newMode! });
  }
  return entries;
}

export function commitCount(root: string, from: string, to: string): number {
  return Number(git(root, ['rev-list', '--count', `${from}..${to}`]).trim());
}

export const PURE_MOVE_LINE = /^Move:\s*pure\.?\s*$/i;

export function declaresPureMove(root: string, from: string, to: string): boolean {
  return git(root, ['log', '--format=%B', `${from}..${to}`])
    .split('\n')
    .some((line) => PURE_MOVE_LINE.test(line.replace(/\r$/, '')));
}

export function malformedMoveLines(root: string, from: string, to: string): string[] {
  return git(root, ['log', '--format=%B', `${from}..${to}`])
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => /^\s*>?\s*move\s*:/i.test(line) && !PURE_MOVE_LINE.test(line));
}

export function trackedPaths(root: string, ref: string): string[] {
  return git(root, ['ls-tree', '-r', '--name-only', '-z', ref])
    .split('\0')
    .filter((path) => path.length > 0);
}

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
    const content = out.subarray(at, at + size);
    if (!content.includes(0)) texts.set(path, content.toString('utf8'));
    at += size + 1;
  }
  return texts;
}
