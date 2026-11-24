import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../scripts/move-purity.js';
import { declaredKinds, malformedLines } from '../scripts/move-purity/move-kinds.js';

let root = '';
let output: string[] = [];

const git = (...args: string[]): void => {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' });
};

const commit = (files: Record<string, string | null>, message: string): void => {
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    if (text === null) {
      rmSync(full);
      continue;
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  git('add', '-A');
  git('commit', '-q', '-m', message);
};

const run = (...args: string[]): number =>
  runCli(['--base', 'main', '--head', 'feature', ...args], root);

const said = (): string => output.join('\n');

const marker = ['Verifies', 'Rule 1.1'].join(': ');
const CODE = 'export const a = 1;\nexport const b = 2;\n';
const COMMENTED = `// one\n// two\n${CODE}`;
const BASELINE = (a: number): string => `${JSON.stringify({ 'src/a.ts': a }, null, 2)}\n`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'move-comments-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'check@example.com');
  git('config', 'user.name', 'Check');
  git('config', 'commit.gpgsign', 'false');
  commit(
    {
      'src/a.ts': COMMENTED,
      'src/b.ts': `// ${marker}\n${CODE}`,
      'scripts/comment-baseline.json': BASELINE(2),
    },
    'Base',
  );
  git('checkout', '-q', '-b', 'feature');
  output = [];
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    output.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('the declaration table', () => {
  it('reads pure and comments, with a final full stop and any letter case', () => {
    expect(declaredKinds(['Move: pure.', 'move:  COMMENTS'])).toEqual(['pure', 'comments']);
    expect(declaredKinds(['Move: comment', 'Move: purely'])).toEqual([]);
  });

  it('calls a line malformed when it looks like a declaration and is not one', () => {
    const lines = ['Move: comment', '  Move: comments', '> Move: pure', 'Move: pure', 'Other'];
    expect(malformedLines(lines)).toEqual(['Move: comment', '  Move: comments', '> Move: pure']);
  });
});

describe('the move-purity command over a range that declares Move: comments', () => {
  it('passes a range that removes plain comments and lowers the baseline', () => {
    commit(
      { 'src/a.ts': CODE, 'scripts/comment-baseline.json': BASELINE(0) },
      'Remove\n\nMove: comments\n',
    );
    expect(run()).toBe(0);
    expect(said()).toContain('Comment removal: pure');
    expect(said()).toContain('Baseline: 2 -> 0 (2 fewer).');
    expect(said()).toContain('file     src/a.ts: 2 comments, 2 lines');
  });

  it('prints the report as JSON', () => {
    commit({ 'src/a.ts': CODE }, 'Remove\n\nMove: comments\n');
    expect(run('--json')).toBe(0);
    const report = JSON.parse(said());
    expect(report.removedLines).toBe(2);
    expect(report.declared).toBe('comments');
  });

  it('fails when a code token changed', () => {
    commit({ 'src/a.ts': CODE.replace('= 2', '= 3') }, 'Remove\n\nMove: comments\n');
    expect(run()).toBe(1);
    expect(said()).toContain('code changed src/a.ts:');
  });

  it('fails when a comment is added', () => {
    commit({ 'src/a.ts': `${COMMENTED}// three\n` }, 'Add\n\nMove: comments\n');
    expect(run()).toBe(1);
    expect(said()).toContain('comment added, edited or moved src/a.ts');
  });

  it('fails when a marker comment is removed', () => {
    commit({ 'src/b.ts': CODE }, 'Remove\n\nMove: comments\n');
    expect(run()).toBe(1);
    expect(said()).toContain('allowed comment removed src/b.ts:1');
  });

  it('fails when a baseline entry is raised', () => {
    commit(
      { 'src/a.ts': CODE, 'scripts/comment-baseline.json': BASELINE(5) },
      'Remove\n\nMove: comments\n',
    );
    expect(run()).toBe(1);
    expect(said()).toContain('the baseline entry src/a.ts grew');
  });

  it('fails when a file outside src changes', () => {
    commit({ 'src/a.ts': CODE, 'README.md': 'text\n' }, 'Remove\n\nMove: comments\n');
    expect(run()).toBe(1);
    expect(said()).toContain('outside  README.md');
  });

  it('exits 2 for an empty range when the check is required', () => {
    git('commit', '-q', '--allow-empty', '-m', 'Empty\n\nMove: comments\n');
    expect(run('--require')).toBe(2);
    expect(said()).toContain('nothing to check');
  });
});

describe('the declarations of a range', () => {
  it('fails when a range declares both', () => {
    commit({ 'src/a.ts': CODE }, 'Remove\n\nMove: comments\n');
    commit({ 'src/c.ts': CODE }, 'Add\n\nMove: pure\n');
    expect(run()).toBe(1);
    expect(said()).toContain('must not declare both');
  });

  it('fails when a title starts with Move: and no commit declares a move', () => {
    commit({ 'src/a.ts': CODE }, 'Remove\n');
    expect(run('--title', 'Move: remove comments')).toBe(1);
    expect(said()).toContain('a Move: pull request declares pure or comments');
  });

  it('runs the comment check for a title that starts with Move:', () => {
    commit({ 'src/a.ts': CODE.replace('= 2', '= 3') }, 'Remove\n\nMove: comments\n');
    expect(run('--title', 'Move: remove comments')).toBe(1);
    expect(said()).toContain('Comment removal: NOT pure');
  });

  it('fails on a misspelled declaration', () => {
    commit({ 'src/a.ts': CODE }, 'Remove\n\nMove: comment\n');
    expect(run()).toBe(1);
    expect(said()).toContain('Not a declaration of a pure move or a comment removal');
  });

  it('prints a notice and exits 0 when no commit declares a move', () => {
    commit({ 'src/a.ts': CODE }, 'Remove\n');
    expect(run()).toBe(0);
    expect(said()).toContain('declares no pure move or comment removal');
  });
});
