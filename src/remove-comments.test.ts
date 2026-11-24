import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bannedCommentLines } from '../scripts/comment-policy.js';
import { runCli as moveCli } from '../scripts/move-purity.js';
import { deleteRanges } from '../scripts/remove-comments/delete-ranges.js';
import {
  INVARIANT_PATTERNS,
  isReviewCandidate,
} from '../scripts/remove-comments/invariant-words.js';
import { runCli } from '../scripts/remove-comments.js';

let root = '';
let output: string[] = [];

const git = (...args: string[]): void => {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' });
};

const write = (path: string, text: string): void => {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

const read = (path: string): string => readFileSync(join(root, path), 'utf8');

const said = (): string => output.join('\n');

const marker = ['Verifies', 'Rule 1.1'].join(': ');

const SOURCE = [
  '// A plain header.',
  '// Over two lines.',
  'export const a = 1; // trailing',
  '',
  '// This must never change.',
  'export const b = 2;',
  '',
  `// ${marker}`,
  '/* inline */',
  'export const c = f(3);',
  'function f(x: number): number {',
  '  // Why: a target forces it.',
  '  return x;',
  '}',
  '',
].join('\n');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'remove-comments-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'check@example.com');
  git('config', 'user.name', 'Check');
  git('config', 'commit.gpgsign', 'false');
  write('src/a.ts', SOURCE);
  git('add', '-A');
  git('commit', '-q', '-m', 'Base');
  output = [];
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    output.push(String(line));
  });
  vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
    output.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('the invariant-like wording', () => {
  it('lists each pattern once, in one constant', () => {
    expect(INVARIANT_PATTERNS.length).toBeGreaterThan(20);
    expect(new Set(INVARIANT_PATTERNS.map(String)).size).toBe(INVARIANT_PATTERNS.length);
  });

  it('flags a comment with a word of the list', () => {
    const flagged = [
      '// This must hold.',
      '// Never call it twice.',
      '/* The order matters here. */',
      '// Assumes a sorted list.',
      '// Only if the flag is set.',
      '// Unless the caller owns it.',
      '// It cannot be null.',
      "// Don't reorder these.",
      '// The caller has to free it.',
      '// TODO: remove.',
      '// An unsafe cast.',
      '// After the first call the cache is warm.',
      '// It runs once. Before that the table is empty.',
    ];
    for (const text of flagged) expect(isReviewCandidate(text), text).toBe(true);
  });

  it('passes a descriptive comment', () => {
    const plain = [
      '// Adds one to the value.',
      '/* The result of the last frame. */',
      '// Returns the width in pixels.',
      '// Notes on the layout.',
    ];
    expect(isReviewCandidate(plain[0]!)).toBe(false);
    expect(isReviewCandidate(plain[1]!)).toBe(false);
    expect(isReviewCandidate(plain[2]!)).toBe(false);
    expect(isReviewCandidate(plain[3]!)).toBe(false);
  });
});

describe('the deletion of comment ranges', () => {
  it('removes a line that the deletion empties and trims a trailing comment', () => {
    const text = 'const a = 1; // x\n  // y\nconst b = 2;\n';
    const first = text.indexOf('//');
    const second = text.indexOf('//', first + 1);
    const ranges = [
      { pos: first, end: first + 4 },
      { pos: second, end: second + 4 },
    ];
    expect(deleteRanges(text, ranges)).toBe('const a = 1;\nconst b = 2;\n');
  });

  it('keeps the tokens apart when a comment sat between them', () => {
    const text = 'a/**/b';
    expect(deleteRanges(text, [{ pos: 1, end: 5 }])).toBe('a b');
  });
});

describe('the comment remover', () => {
  it('removes banned comments, keeps allowed ones and collapses emptied lines', async () => {
    expect(await runCli(['src/a.ts'], root)).toBe(0);
    const text = read('src/a.ts');
    expect(text).not.toContain('plain header');
    expect(text).not.toContain('trailing');
    expect(text).not.toContain('inline');
    expect(text).toContain(marker);
    expect(text).toContain('Why: a target forces it.');
    expect(text).not.toMatch(/\n\n\n/);
    expect(text.startsWith('export const a = 1;\n')).toBe(true);
    expect(said()).toContain('banned lines 5 -> 0');
  });

  it('lists the review candidates before it deletes and keeps them with --keep-invariants', async () => {
    expect(await runCli(['src/a.ts', '--keep-invariants'], root)).toBe(0);
    const text = read('src/a.ts');
    expect(text).toContain('// This must never change.');
    expect(text).not.toContain('plain header');
    expect(said()).toContain('candidate src/a.ts:5 This must never change.');
    expect(said()).toContain('1 review candidates (1 kept)');
    expect(said()).toContain('banned lines 5 -> 1');
    expect(bannedCommentLines('src/a.ts', text, new Set())).toBe(1);
  });

  it('removes a candidate too when it is not asked to keep it', async () => {
    expect(await runCli(['src/a.ts'], root)).toBe(0);
    expect(read('src/a.ts')).not.toContain('must never');
    expect(said()).toContain('candidate src/a.ts:5');
  });

  it('writes nothing with --dry-run', async () => {
    expect(await runCli(['src/a.ts', '--dry-run'], root)).toBe(0);
    expect(read('src/a.ts')).toBe(SOURCE);
    expect(said()).toContain('would be removed');
  });

  it('prints a JSON result without the text', async () => {
    expect(await runCli(['src/a.ts', '--json', '--dry-run'], root)).toBe(0);
    const result = JSON.parse(said());
    expect(result.files[0].bannedBefore).toBe(5);
    expect(result.files[0].text).toBeUndefined();
  });

  it('keeps a protected comment although the policy counts it', async () => {
    write('src/a.ts', '/* @vite-ignore */\nexport const a = 1; // drop\n');
    expect(await runCli(['src/a.ts'], root)).toBe(0);
    expect(read('src/a.ts')).toContain('@vite-ignore');
    expect(read('src/a.ts')).not.toContain('drop');
    expect(said()).toContain('1 protected kept');
  });

  it('refuses a path that the policy does not police', async () => {
    write('README.md', 'text\n');
    write('src/a.shade.ts', '// n\nexport const a = 1;\n');
    expect(await runCli(['README.md', 'src/missing.ts', 'src/a.shade.ts'], root)).toBe(1);
    expect(said()).toContain('README.md: not a policed .ts file of src/');
    expect(said()).toContain('src/a.shade.ts: not a policed .ts file of src/');
  });

  it('ignores a bare double dash that a package runner passes', async () => {
    expect(await runCli(['--', 'src/a.ts', '--dry-run'], root)).toBe(0);
    expect(read('src/a.ts')).toBe(SOURCE);
  });

  it('prints the usage for no path and for an unknown flag', async () => {
    expect(await runCli([], root)).toBe(2);
    expect(await runCli(['src/a.ts', '--unknown'], root)).toBe(2);
  });

  it('gives a result that the Move: comments check passes', async () => {
    expect(await runCli(['src/a.ts', '--keep-invariants'], root)).toBe(0);
    git('add', '-A');
    git('commit', '-q', '-m', 'Remove\n\nMove: comments\n');
    expect(moveCli(['--base', 'HEAD~1', '--head', 'HEAD', '--require'], root)).toBe(0);
    expect(said()).toContain('Comment removal: pure');
  });
});
