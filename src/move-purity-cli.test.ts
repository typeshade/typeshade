import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALPHA, BETA, exported } from './core/testing/move-purity-fixtures.js';
import { runCli } from '../scripts/move-purity.js';
import { PURE_MOVE_LINE } from '../scripts/move-purity/git-range.js';

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

const SPLIT = {
  'src/a.ts': `export { addOne } from './a/part.js';\n`,
  'src/a/part.ts': exported(ALPHA),
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'move-purity-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'check@example.com');
  git('config', 'user.name', 'Check');
  git('config', 'commit.gpgsign', 'false');
  commit({ 'src/a.ts': exported(ALPHA), 'src/b.ts': BETA }, 'Base');
  git('checkout', '-q', '-b', 'feature');
  output = [];
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    output.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
  delete process.env.GITHUB_ACTIONS;
});

describe('the move-purity command over a git range', () => {
  it('reads a declaration line in a paragraph that is not the last one', () => {
    commit(SPLIT, 'Split a\n\nMove: pure\n\nA note after the line.\n');
    expect(run()).toBe(0);
    expect(output.join('\n')).toContain('Move purity: pure');
  });

  it('reads the line with a final full stop and any letter case', () => {
    expect(PURE_MOVE_LINE.test('Move: pure.')).toBe(true);
    expect(PURE_MOVE_LINE.test('move:   PURE')).toBe(true);
    expect(PURE_MOVE_LINE.test('Move: purely')).toBe(false);
    commit(SPLIT, 'Split a\n\nMove: pure.\n');
    expect(run()).toBe(0);
    expect(output.join('\n')).toContain('Move purity: pure');
  });

  it('prints a visible notice and exits 0 when no commit declares a pure move', () => {
    commit({ 'src/a.ts': 'const A = 1;\n' }, 'Change a body\n');
    expect(run()).toBe(0);
    expect(output.join('\n')).toContain('declares no pure move');
    expect(output.join('\n')).not.toContain('::notice::');
    output = [];
    process.env.GITHUB_ACTIONS = 'true';
    expect(run()).toBe(0);
    expect(output.join('\n')).toMatch(/^::notice::/);
  });

  it('exits 2 for an empty range when the check is required', () => {
    expect(run('--require')).toBe(2);
    expect(output.join('\n')).toContain('0 commits');
  });

  it('exits 1 when a declared pure move edits a body', () => {
    commit(
      { ...SPLIT, 'src/a/part.ts': exported(ALPHA).replace('x + 1', 'x + 2') },
      'Move: pure\n',
    );
    expect(run()).toBe(1);
    expect(output.join('\n')).toContain('NOT pure');
  });

  it('prints the report as JSON', () => {
    commit(SPLIT, 'Move: pure\n');
    expect(run('--json')).toBe(0);
    expect(JSON.parse(output.join('\n')).pure).toBe(true);
  });

  it('refuses a mode change that no file text shows', () => {
    commit(SPLIT, 'Move: pure\n');
    git('update-index', '--chmod=+x', 'src/b.ts');
    git('commit', '-q', '-m', 'Make b executable');
    expect(run()).toBe(1);
    expect(output.join('\n')).toContain('mode change');
  });

  it('fails on a line that looks like a declaration and is not one', () => {
    const lines = ['Move: pure-ish', '  Move: pure', '> Move: pure', 'move : pure.x'];
    lines.forEach((line, index) => {
      commit({ 'src/c.ts': `const C = ${index};\n` }, `Note\n\n${line}\n`);
    });
    expect(run()).toBe(1);
    expect(output.join('\n')).toContain('Not a declaration of a pure move');
  });

  it('requires the check when the title starts with Move:', () => {
    commit({ 'src/a.ts': 'const A = 1;\n' }, 'Change a body\n');
    expect(run()).toBe(0);
    expect(output.join('\n')).toContain('declares no pure move');
    output = [];
    expect(run('--require')).toBe(1);
    expect(output.join('\n')).toContain('NOT pure');
    output = [];
    expect(run('--title', 'Move: split a')).toBe(1);
    expect(output.join('\n')).toContain('a Move: pull request declares pure or comments');
    output = [];
    expect(run('--title', 'Fix a bug')).toBe(0);
  });

  it('prints the clean-file report of HEAD without a range', () => {
    expect(runCli(['--clean-report', '--json'], root)).toBe(0);
    const report = JSON.parse(output.join('\n'));
    expect(report.total.files).toBe(2);
    expect(report.total.clean).toBe(2);
    output = [];
    expect(runCli(['--clean-report'], root)).toBe(0);
    expect(output.join('\n')).toContain('Import cycles: 0');
  });

  it('reads the range of another checkout when it runs from a different directory', () => {
    commit(SPLIT, 'Split a\n\nMove: pure\n');
    const elsewhere = mkdtempSync(join(tmpdir(), 'move-purity-elsewhere-'));
    try {
      expect(runCli(['--repo', root, '--base', 'main', '--head', 'feature'], elsewhere)).toBe(0);
      expect(output.join('\n')).toContain('Move purity: pure');
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('fails on a changed source file whose text cannot be read', () => {
    commit({ 'src/a.ts': `${exported(ALPHA)}// \u0000\n` }, 'Move: pure\n');
    expect(run()).toBe(1);
    expect(output.join('\n')).toContain('unreadable file path src/a.ts');
  });
});
