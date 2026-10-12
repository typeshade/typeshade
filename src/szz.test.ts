// ═══ SZZ reads a git history the way the report does, and is proven on a history built for it ═══
//
// `scripts/szz.ts` is a report, not a gate: CI does not run it. Its readers are pinned here on
// hand-written input. Its algorithm is pinned on a throwaway repository whose commits each carry
// one case: a whitespace-only change, a comment-only change, a blame that moves to an earlier
// commit, a line that reaches the root commit, an add-only fix, an ignored revision, a merge.
// The instrument must find a known answer before its silence counts as a finding.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  analyzeFix,
  findFixes,
  formatMarkdown,
  formatText,
  isFixSubject,
  isMeaningfulLine,
  isSourcePath,
  parseArgs,
  parseBlame,
  prNumber,
  readCommit,
  removedLines,
  resolveIgnoreRevs,
  summarize,
  szz,
  toRanges,
  unquotePath,
  widenRanges,
} from '../scripts/szz.js';

describe('pure readers', () => {
  it('recognises a Conventional Commits fix subject, and only that', () => {
    expect(isFixSubject('fix: x')).toBe(true);
    expect(isFixSubject('fix(glsl): x')).toBe(true);
    expect(isFixSubject('fix!: x')).toBe(true);
    expect(isFixSubject('Fix: x')).toBe(true);
    expect(isFixSubject('feat: fix x')).toBe(false);
    expect(isFixSubject('fixture: x')).toBe(false);
    expect(isFixSubject('fixes #3')).toBe(false);
  });

  it('keeps source files and leaves tests, documents, goldens and fixtures out', () => {
    expect(isSourcePath('src/a.ts')).toBe(true);
    expect(isSourcePath('examples/x.shade.ts')).toBe(true);
    expect(isSourcePath('scripts/szz.ts')).toBe(true);
    expect(isSourcePath('src/a.test.ts')).toBe(false);
    expect(isSourcePath('docs/roadmap.md')).toBe(false);
    expect(isSourcePath('src/core/spec-conformance/fixtures/x.ts')).toBe(false);
    expect(isSourcePath('examples/__emit-goldens__/x.ts')).toBe(false);
  });

  it('counts a line as meaningful only when it is code', () => {
    for (const text of ['', '   ', '// c', '  * c', '/* c */', '*/']) {
      expect(isMeaningfulLine(text), JSON.stringify(text)).toBe(false);
    }
    expect(isMeaningfulLine('return a;')).toBe(true);
    expect(isMeaningfulLine('  x = 1; // note')).toBe(true);
  });

  it('reads the number of the last (#N) in a subject', () => {
    expect(prNumber('fix: x (#467) (#501)')).toBe(501);
    expect(prNumber('fix: x (0054)')).toBeNull();
    expect(prNumber('fix: x (#12)')).toBe(12);
  });

  it('merges sorted, unique line numbers into inclusive ranges', () => {
    expect(toRanges([5, 1, 2, 3, 3, 9])).toEqual([
      [1, 3],
      [5, 5],
      [9, 9],
    ]);
    expect(toRanges([])).toEqual([]);
  });
});

describe('removedLines', () => {
  it('records the old-side removed lines of modify and delete hunks, and no added line', () => {
    const diff = [
      'diff --git a/m.ts b/m.ts',
      'index 1111111..2222222 100644',
      '--- a/m.ts',
      '+++ b/m.ts',
      '@@ -3,2 +3 @@ function f() {',
      '-old one',
      '-old two',
      '+new',
      '@@ -10 +9,0 @@',
      '-gone',
      '@@ -5,0 +6,2 @@',
      '+added a',
      '+added b',
      '\\ No newline at end of file',
    ].join('\n');
    const map = removedLines(diff);
    expect([...map.keys()]).toEqual(['m.ts']);
    expect(map.get('m.ts')).toEqual([
      { line: 3, text: 'old one' },
      { line: 4, text: 'old two' },
      { line: 10, text: 'gone' },
    ]);
  });

  it('keys a renamed file by its old path', () => {
    const diff = [
      'diff --git a/old.ts b/new.ts',
      'similarity index 90%',
      'rename from old.ts',
      'rename to new.ts',
      'index 1111111..2222222 100644',
      '--- a/old.ts',
      '+++ b/new.ts',
      '@@ -1 +1 @@',
      '-x',
      '+y',
    ].join('\n');
    const map = removedLines(diff);
    expect([...map.keys()]).toEqual(['old.ts']);
    expect(map.get('old.ts')).toEqual([{ line: 1, text: 'x' }]);
  });

  it('keys a deleted file by its old path', () => {
    const diff = [
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      'index 3333333..0000000',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-first',
      '-second',
    ].join('\n');
    const map = removedLines(diff);
    expect([...map.keys()]).toEqual(['gone.ts']);
    expect(map.get('gone.ts')).toEqual([
      { line: 1, text: 'first' },
      { line: 2, text: 'second' },
    ]);
  });

  it('records nothing for an added file, whose old side is /dev/null', () => {
    const diff = [
      'diff --git a/new-file.ts b/new-file.ts',
      'new file mode 100644',
      'index 0000000..4444444',
      '--- /dev/null',
      '+++ b/new-file.ts',
      '@@ -0,0 +1,2 @@',
      '+a',
      '+b',
    ].join('\n');
    const map = removedLines(diff);
    expect(map.size).toBe(0);
    expect(map.has('new-file.ts')).toBe(false);
  });

  it('reads a removed line whose text starts with "-- " as a removed line, not a header', () => {
    const diff = [
      'diff --git a/q.sql b/q.sql',
      'index 1111111..2222222 100644',
      '--- a/q.sql',
      '+++ b/q.sql',
      '@@ -2 +2 @@',
      '--- x',
      '+y',
    ].join('\n');
    expect(removedLines(diff).get('q.sql')).toEqual([{ line: 2, text: '-- x' }]);
  });

  it('strips the tab git appends after a path that contains a space', () => {
    const diff = [
      'diff --git a/with space.ts b/with space.ts',
      '--- a/with space.ts\t',
      '+++ b/with space.ts\t',
      '@@ -1 +1 @@',
      '-s',
      '+t',
    ].join('\n');
    const map = removedLines(diff);
    expect([...map.keys()]).toEqual(['with space.ts']);
    expect(map.get('with space.ts')).toEqual([{ line: 1, text: 's' }]);
  });
});

describe('parseBlame', () => {
  const A = 'a871bca8d780bea9af29b1bbd6ed433fb806fc41';
  const B = '7cdc8c84607fc1b9012b0b425e8429acd7aef8bd';
  const BLAME = [
    `${A} 1 1 1`,
    'author t',
    'author-mail <t@t>',
    'author-time 1767225600',
    'author-tz +0000',
    'committer t',
    'committer-mail <t@t>',
    'committer-time 1767225600',
    'committer-tz +0000',
    'summary root',
    'boundary',
    'filename f.ts',
    '\ta',
    `${B} 2 2 1`,
    'author t',
    'author-mail <t@t>',
    'author-time 1767225600',
    'author-tz +0000',
    'committer t',
    'committer-mail <t@t>',
    'committer-time 1767225600',
    'committer-tz +0000',
    'summary feat: x',
    `previous ${A} f.ts`,
    'filename f.ts',
    '\tB',
    `${B} 4 4 1`,
    '\td',
  ].join('\n');

  it('returns one entry per header, and marks every line of a boundary sha', () => {
    expect(parseBlame(BLAME)).toEqual([
      { line: 1, sha: A, boundary: true },
      { line: 2, sha: B, boundary: false },
      { line: 4, sha: B, boundary: false },
    ]);
  });
});

// The history of the real-repository tests. Each commit carries one case; the subjects and the
// dates are part of the expectations.
type History = Record<'c0' | 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6' | 'c7' | 'c8', string>;

const BASE_ENV = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_NOSYSTEM: '1',
};

// Each commit is one day after the one before it, from 2026-01-01T00:00:00Z.
function makeRepo(dir: string) {
  let day = 0;
  const git = (...args: string[]): string => {
    const when = new Date(Date.UTC(2026, 0, 1) + day * 86400000)
      .toISOString()
      .replace('.000Z', 'Z');
    return execFileSync('git', args, {
      cwd: dir,
      env: {
        ...process.env,
        ...BASE_ENV,
        HOME: dir,
        GIT_AUTHOR_DATE: when,
        GIT_COMMITTER_DATE: when,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  };
  const head = (): string => git('rev-parse', 'HEAD').trim();
  const write = (path: string, lines: readonly string[]): void => {
    writeFileSync(join(dir, path), `${lines.join('\n')}\n`);
  };
  const commit = (subject: string): string => {
    git('add', '-A');
    git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', subject);
    day += 1;
    return head();
  };
  return { git, head, write, commit };
}

function buildHistory(dir: string): { repo: ReturnType<typeof makeRepo>; c: History } {
  const repo = makeRepo(dir);
  repo.git('init', '-q', '-b', 'main');
  mkdirSync(join(dir, 'src'));

  repo.write('src/a.ts', ['export const one = 2;', 'export const two = 2;']);
  const c0 = repo.commit('chore: root');

  repo.write('src/sum.ts', [
    'export function sum(a: number, b: number): number {',
    '  // adds the two',
    '  const total = a - b;',
    '  return total;',
    '}',
  ]);
  const c1 = repo.commit('feat: add sum');

  // whitespace only
  repo.write('src/sum.ts', [
    'export function sum(a: number, b: number): number {',
    '  // adds the two',
    '    const total = a - b;',
    '  return total;',
    '}',
  ]);
  const c2 = repo.commit('style: reindent');

  // comment only
  repo.write('src/sum.ts', [
    'export function sum(a: number, b: number): number {',
    '  // adds a and b',
    '    const total = a - b;',
    '  return total;',
    '}',
  ]);
  const c3 = repo.commit('docs: comment');

  // the fix: one code line, one comment line, and one whitespace-only line
  repo.write('src/sum.ts', [
    'export function sum(a: number, b: number): number {',
    '  // returns a plus b',
    '  const total = a + b;',
    '  return total;',
    ' }',
  ]);
  repo.write('src/sum.test.ts', ['export {};']);
  const c4 = repo.commit('fix: sum adds (#12)');

  repo.write('src/a.ts', ['export const one = 1;', 'export const two = 2;']);
  const c5 = repo.commit('fix: one is one');

  repo.write('src/a.ts', [
    'export const one = 1;',
    'export const two = 2;',
    'export const guard = true;',
  ]);
  const c6 = repo.commit('fix: add a guard');

  repo.write('src/sum.ts', [
    'export function sum(a: number, b: number): number {',
    '  // returns a plus b',
    '  const total = a + b;',
    '  return total + 0;',
    ' }',
  ]);
  const c7 = repo.commit('refactor: rename total');

  repo.write('src/sum.ts', [
    'export function sum(a: number, b: number): number {',
    '  // returns a plus b',
    '  const total = a + b;',
    '  return total;',
    ' }',
  ]);
  const c8 = repo.commit('fix: return the total');

  return { repo, c: { c0, c1, c2, c3, c4, c5, c6, c7, c8 } };
}

describe('SZZ over a real repository: the instrument finds known answers', () => {
  let dir: string;
  let c: History;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'szz-'));
    c = buildHistory(dir).c;
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds the four fix commits, newest first, and no other commit', () => {
    expect(findFixes(dir)).toEqual([c.c8, c.c6, c.c5, c.c4]);
  });

  it('traces a fix to its one introducing commit, past whitespace and comment changes', () => {
    const r = analyzeFix(dir, c.c4);
    expect(r.status).toBe('analyzed');
    expect(r.candidates).toEqual([
      { commit: expect.objectContaining({ sha: c.c1 }), lines: 1, files: ['src/sum.ts'] },
    ]);
    expect(r.blamedLines).toBe(1);
    expect(r.boundaryLines).toBe(0);
    expect(r.fix.pr).toBe(12);
  });

  it('reports a line that reaches the root commit as history boundary, not as a candidate', () => {
    const r = analyzeFix(dir, c.c5);
    expect(r.status).toBe('analyzed');
    expect(r.candidates).toEqual([]);
    expect(r.boundaryLines).toBe(1);
  });

  it('reports a fix that only adds lines as having no removed line', () => {
    expect(analyzeFix(dir, c.c6).status).toBe('no-removed-lines');
  });

  it('traces a fix to the commit that last changed the removed line', () => {
    const r = analyzeFix(dir, c.c8);
    expect(r.candidates.map((x) => x.commit.sha)).toEqual([c.c7]);
  });

  it('looks past an ignored revision to the commit before it', () => {
    const r = analyzeFix(dir, c.c8, { ignoreRevs: [c.c7] });
    expect(r.candidates.map((x) => x.commit.sha)).toEqual([c.c1]);
  });

  it('reports a root commit as skipped', () => {
    const r = analyzeFix(dir, c.c0);
    expect(r.status).toBe('root');
    expect(r.candidates).toEqual([]);
  });

  it('keeps the same candidate with allFiles, where the test file adds no removed line', () => {
    const r = analyzeFix(dir, c.c4, { allFiles: true });
    expect(r.candidates.map((x) => x.commit.sha)).toEqual([c.c1]);
  });

  it('summarises the four fixes into the expected counts', () => {
    expect(summarize(szz(dir, findFixes(dir)))).toEqual({
      fixes: 4,
      withCandidates: 2,
      boundaryOnly: 1,
      ignoredOnly: 0,
      noRemovedLines: 1,
      skipped: 0,
    });
  });

  it('writes the text report with the fix line and the candidate line', () => {
    const text = formatText(szz(dir, [c.c4]));
    expect(text).toContain(`fix ${c.c4.slice(0, 7)} fix: sum adds (#12)`);
    expect(text).toContain(`  <- ${c.c1.slice(0, 7)} 1 line 2026-01-02 feat: add sum`);
  });

  it('writes the Markdown table with its header and the file of the candidate', () => {
    const md = formatMarkdown(szz(dir, [c.c4]));
    expect(md).toContain('| Fix | Introducing commit | Lines | Files |');
    expect(md).toContain('`src/sum.ts`');
  });
});

describe('SZZ skips a merge commit', () => {
  let dir: string;
  let c9: string;
  let merge: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'szz-merge-'));
    const { repo } = buildHistory(dir);
    repo.git('checkout', '-q', '-b', 'side');
    repo.write('src/a.ts', [
      'export const one = 1;',
      'export const two = 3;',
      'export const guard = true;',
    ]);
    c9 = repo.commit('fix: on the side');
    repo.git('checkout', '-q', 'main');
    repo.write('src/b.ts', ['export const b = 1;']);
    repo.commit('chore: main moves');
    repo.git('merge', '-q', '--no-ff', '-m', 'fix: merge side', 'side');
    merge = repo.head();
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('has status merge, with zero counts and no candidates, for the merge commit', () => {
    const r = analyzeFix(dir, merge);
    expect(r.status).toBe('merge');
    expect(r.blamedLines).toBe(0);
    expect(r.boundaryLines).toBe(0);
    expect(r.candidates).toEqual([]);
  });

  it('lists the side fix and not the merge commit', () => {
    const fixes = findFixes(dir);
    expect(fixes).not.toContain(merge);
    expect(fixes).toContain(c9);
  });
});

// ═══ Round 2: each case builds its own repository, so the expectations above stay as written ═══

const scratch: string[] = [];

function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function gitIn(dir: string, args: readonly string[], env: Record<string, string> = {}): string {
  return execFileSync('git', [...args], {
    cwd: dir,
    env: { ...process.env, ...BASE_ENV, HOME: dir, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function initIn(dir: string): void {
  gitIn(dir, ['init', '-q', '-b', 'main']);
}

function writeIn(dir: string, path: string, lines: readonly string[]): void {
  mkdirSync(join(dir, path, '..'), { recursive: true });
  writeFileSync(join(dir, path), `${lines.join('\n')}\n`);
}

// One commit. The committer date is set, and the author date too when it differs.
function commitIn(dir: string, subject: string, committer: string, author = committer): string {
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', subject], {
    GIT_AUTHOR_DATE: author,
    GIT_COMMITTER_DATE: committer,
  });
  return gitIn(dir, ['rev-parse', 'HEAD']).trim();
}

// The n-th day after 2026-02-01, in the form git reads.
function stamp(n: number): string {
  return new Date(Date.UTC(2026, 1, 1) + n * 86400000).toISOString().replace('.000Z', 'Z');
}

describe('SZZ orders candidates by lines, then author time (S1, F1)', () => {
  it('lists the two-line commit first, then the later author time before the earlier', () => {
    const dir = scratchDir('szz-order-');
    initIn(dir);
    writeIn(dir, 'README.md', ['root']);
    commitIn(dir, 'chore: root', stamp(0));
    writeIn(dir, 'src/o.ts', [
      'export const a1 = 1;',
      'export const a2 = 2;',
      'export const keep = 0;',
    ]);
    const shaA = commitIn(dir, 'feat: add a', stamp(1));
    writeIn(dir, 'src/o.ts', [
      'export const a1 = 1;',
      'export const a2 = 2;',
      'export const b1 = 1;',
      'export const keep = 0;',
    ]);
    // B's author date is 2026-01-01T16:00Z. C's is 2026-01-02T01:00Z, later in real time.
    const shaB = commitIn(dir, 'feat: add b', stamp(2), '2026-01-02T01:00:00+09:00');
    writeIn(dir, 'src/o.ts', [
      'export const a1 = 1;',
      'export const a2 = 2;',
      'export const b1 = 1;',
      'export const c1 = 1;',
      'export const keep = 0;',
    ]);
    const shaC = commitIn(dir, 'feat: add c', stamp(3), '2026-01-01T20:00:00-05:00');
    writeIn(dir, 'src/o.ts', ['export const keep = 0;', 'export const fixed = 9;']);
    const fix = commitIn(dir, 'fix: drop four lines', stamp(4));
    expect(analyzeFix(dir, fix).candidates.map((x) => x.commit.sha)).toEqual([shaA, shaC, shaB]);
  });
});

describe('SZZ traces a block moved to a new file, with its context blamed (S2)', () => {
  it('names the commit that wrote the block, not the move, and counts one line', () => {
    const dir = scratchDir('szz-move-');
    const block = [
      'export function scaleTheValue(value: number, factor: number): number {',
      '  const scaled = value * factor + 0;',
      '  return scaled;',
      '}',
    ];
    initIn(dir);
    writeIn(dir, 'src/a.ts', ['export const first = 0;']);
    commitIn(dir, 'chore: root', stamp(0));
    writeIn(dir, 'src/a.ts', ['export const first = 0;', ...block]);
    const c1 = commitIn(dir, 'feat: add scale', stamp(1));
    writeIn(dir, 'src/a.ts', ['export const first = 0;']);
    writeIn(dir, 'src/b.ts', block);
    commitIn(dir, 'refactor: move scale', stamp(2));
    writeIn(dir, 'src/b.ts', [
      block[0],
      '  const scaled = value * factor + 1;',
      block[2],
      block[3],
    ]);
    const c3 = commitIn(dir, 'fix: scale', stamp(3));
    const r = analyzeFix(dir, c3);
    expect(r.candidates.map((x) => x.commit.sha)).toEqual([c1]);
    expect(r.blamedLines).toBe(1);
  });
});

describe('SZZ reads .git-blame-ignore-revs (S3, history F3)', () => {
  let dir: string;
  let c1 = '';
  let c2 = '';
  let withoutFile: ReturnType<typeof analyzeFix>;
  let withFile: ReturnType<typeof analyzeFix>;
  let fourOnly: ReturnType<typeof analyzeFix>;

  beforeAll(() => {
    dir = scratchDir('szz-ignore-');
    initIn(dir);
    writeIn(dir, 'README.md', ['root']);
    commitIn(dir, 'chore: root', stamp(0));
    writeIn(dir, 'src/c.ts', ['export const one = 1', 'export const two = 2']);
    c1 = commitIn(dir, 'feat: add', stamp(1));
    writeIn(dir, 'src/c.ts', [
      'export const one = 1;',
      'export const two = 2;',
      'export const three = 3;',
      'export const four = 4;',
    ]);
    c2 = commitIn(dir, 'style: semicolons', stamp(2));
    writeIn(dir, 'src/c.ts', [
      'export const one = 10;',
      'export const two = 2;',
      'export const three = 30;',
      'export const four = 4;',
    ]);
    const c3 = commitIn(dir, 'fix: one and three', stamp(3));
    withoutFile = analyzeFix(dir, c3);
    writeIn(dir, '.git-blame-ignore-revs', ['# style: semicolons, a mechanical reformat', c2]);
    commitIn(dir, 'chore: ignore the reformat', stamp(4));
    withFile = analyzeFix(dir, c3);
    writeIn(dir, 'src/c.ts', [
      'export const one = 10;',
      'export const two = 2;',
      'export const three = 30;',
      'export const four = 40;',
    ]);
    const c5 = commitIn(dir, 'fix: four', stamp(5));
    fourOnly = analyzeFix(dir, c5);
  });

  it('without the file, both removed lines trace to the reformat', () => {
    expect(withoutFile.candidates.map((x) => [x.commit.sha, x.lines])).toEqual([[c2, 2]]);
    expect(withoutFile.ignoredLines).toBe(0);
  });

  it('with the file, line 1 maps past the reformat and line 3 stays on it', () => {
    expect(withFile.candidates.map((x) => [x.commit.sha, x.lines])).toEqual([[c1, 1]]);
    expect(withFile.ignoredLines).toBe(1);
  });

  it('counts a line only an ignored commit wrote as ignored, not as a candidate', () => {
    const s = summarize([fourOnly]);
    expect(s.ignoredOnly).toBe(1);
    expect(s.withCandidates).toBe(0);
  });
});

describe('resolveIgnoreRevs rejects a line that is not a full object name (S3)', () => {
  it('throws, naming the line, for a short name in the file', () => {
    const dir = scratchDir('szz-badrev-');
    initIn(dir);
    writeIn(dir, '.git-blame-ignore-revs', ['deadbeef']);
    expect(() => resolveIgnoreRevs(dir, [])).toThrow(/line/);
  });
});

describe('resolveIgnoreRevs leaves out a file entry whose commit this clone lacks (R2-1)', () => {
  it('returns the entries it holds, does not throw, and analyzes a fix', () => {
    const dir = scratchDir('szz-absent-');
    initIn(dir);
    writeIn(dir, 'README.md', ['root']);
    const c0 = commitIn(dir, 'chore: root', stamp(0));
    writeIn(dir, 'src/c.ts', ['export const one = 1']);
    const c1 = commitIn(dir, 'feat: add', stamp(1));
    writeIn(dir, '.git-blame-ignore-revs', [
      '# an object this clone does not hold',
      'a'.repeat(40),
      c0,
    ]);
    writeIn(dir, 'src/c.ts', ['export const one = 10']);
    const c2 = commitIn(dir, 'fix: one', stamp(2));
    expect(resolveIgnoreRevs(dir, [])).toEqual([c0]);
    const result = analyzeFix(dir, c2);
    expect(result.status).toBe('analyzed');
    expect(result.candidates.map((x) => x.commit.sha)).toEqual([c1]);
  });
});

describe('SZZ names the commit of a line under diff.noprefix when a top-level dir is a/ (N10)', () => {
  it('names the commit that wrote the line of a/f.ts, not a blame failure', () => {
    const dir = scratchDir('szz-topa-');
    initIn(dir);
    writeIn(dir, 'README.md', ['root']);
    commitIn(dir, 'chore: root', stamp(0));
    writeIn(dir, 'a/f.ts', ['export const one = 1', 'export const two = 2']);
    const wrote = commitIn(dir, 'feat: add a/f.ts', stamp(1));
    gitIn(dir, ['config', 'diff.noprefix', 'true']);
    writeIn(dir, 'a/f.ts', ['export const one = 10', 'export const two = 2']);
    const fix = commitIn(dir, 'fix: one', stamp(2));
    expect(analyzeFix(dir, fix).candidates.map((x) => x.commit.sha)).toEqual([wrote]);
  });
});

describe('SZZ resolves an annotated tag to its commit (F2)', () => {
  it('names the full sha of the commit the tag peels to', () => {
    const dir = scratchDir('szz-tag-');
    const { repo, c } = buildHistory(dir);
    repo.git('tag', '-a', 'v1', '-m', 'tagged', c.c4);
    expect(analyzeFix(dir, 'v1').fix.sha).toBe(c.c4);
  });
});

describe('readCommit caches a commit by its full sha (F7)', () => {
  it('returns the same object for HEAD and for the full sha of HEAD', () => {
    const dir = scratchDir('szz-cache-');
    const { repo } = buildHistory(dir);
    expect(readCommit(dir, 'HEAD')).toBe(readCommit(dir, repo.head()));
  });
});

describe('SZZ reads a diff whose user config drops the a/ and b/ prefixes (F3)', () => {
  it('still names the candidate of a fix to a line of src/a.ts', () => {
    const dir = scratchDir('szz-noprefix-');
    const { repo, c } = buildHistory(dir);
    repo.git('config', 'diff.noprefix', 'true');
    repo.write('src/a.ts', [
      'export const one = 1;',
      'export const two = 2;',
      'export const guard = false;',
    ]);
    const fix = repo.commit('fix: guard off');
    expect(analyzeFix(dir, fix).candidates.map((x) => x.commit.sha)).toEqual([c.c6]);
  });
});

describe('unquotePath and removedLines read a C-quoted path (F3)', () => {
  it('unquotes escapes and octal bytes, and leaves an unquoted path unchanged', () => {
    expect(unquotePath('"a/we\\"ird.ts"')).toBe('a/we"ird.ts');
    expect(unquotePath('"a/caf\\303\\251.ts"')).toBe('a/café.ts');
    expect(unquotePath('a/plain.ts')).toBe('a/plain.ts');
  });

  it('keys the removed line of a quoted path by its unquoted name', () => {
    const diff = [
      'diff --git "a/we\\"ird.ts" "b/we\\"ird.ts"',
      'index 1111111..2222222 100644',
      '--- "a/we\\"ird.ts"',
      '+++ "b/we\\"ird.ts"',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');
    const map = removedLines(diff);
    expect([...map.keys()]).toEqual(['we"ird.ts']);
    expect(map.get('we"ird.ts')).toEqual([{ line: 1, text: 'old' }]);
  });
});

describe('removedLines records no line for a gitlink (F4)', () => {
  it('has no key for a submodule pin that changed', () => {
    const diff = [
      'diff --git a/vendor/s b/vendor/s',
      'index 3e0b681..a0a5dd6 160000',
      '--- a/vendor/s',
      '+++ b/vendor/s',
      '@@ -1 +1 @@',
      '-Subproject commit 3e0b681',
      '+Subproject commit a0a5dd6',
    ].join('\n');
    expect(removedLines(diff).has('vendor/s')).toBe(false);
  });
});

describe('szz fails before analysis when an ignored revision does not resolve (F5)', () => {
  it('throws for an unknown revision even when no fix has a line to blame', () => {
    const dir = scratchDir('szz-typo-');
    const { c } = buildHistory(dir);
    expect(() => szz(dir, [c.c6], { ignoreRevs: ['no-such-rev'] })).toThrow();
  });
});

describe('widenRanges widens each window and merges the windows that touch (S2)', () => {
  it('merges overlapping or adjacent windows and keeps the others apart', () => {
    expect(
      widenRanges(
        [
          [5, 5],
          [20, 22],
        ],
        8,
        25,
      ),
    ).toEqual([[1, 25]]);
    expect(
      widenRanges(
        [
          [3, 3],
          [40, 40],
        ],
        8,
        100,
      ),
    ).toEqual([
      [1, 11],
      [32, 48],
    ]);
    expect(widenRanges([[10, 10]], 8, 12)).toEqual([[2, 12]]);
  });
});

describe('isMeaningfulLine counts a generator method as code (S2.7)', () => {
  it('reads *gen() { as code, and the comment continuations as not', () => {
    expect(isMeaningfulLine('*gen() {')).toBe(true);
    for (const text of ['*', ' * text', '*/']) {
      expect(isMeaningfulLine(text), JSON.stringify(text)).toBe(false);
    }
  });
});

describe('parseArgs reads the command line and refuses what it cannot run (S4 CLI)', () => {
  it('reads --help', () => {
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
  });

  it('refuses an unknown option', () => {
    expect(parseArgs(['--bogus'])).toEqual({ kind: 'error', message: 'unknown option --bogus' });
  });

  it('refuses a value flag with no value', () => {
    expect(parseArgs(['--limit'])).toEqual({ kind: 'error', message: '--limit needs a value' });
  });

  it('refuses a limit that is not a whole number', () => {
    for (const value of ['', '-1', '1.5', 'x']) {
      expect(parseArgs(['--limit', value])).toEqual({
        kind: 'error',
        message: `--limit needs a whole number, got ${value}`,
      });
    }
  });

  it('refuses --fix with --limit or --range', () => {
    const message = '--fix names the fixes, so --range, --since and --limit do not apply';
    expect(parseArgs(['--fix', 'x', '--limit', '3'])).toEqual({ kind: 'error', message });
    expect(parseArgs(['--fix', 'x', '--range', 'HEAD'])).toEqual({ kind: 'error', message });
  });

  it('refuses --json with --markdown', () => {
    expect(parseArgs(['--json', '--markdown'])).toEqual({
      kind: 'error',
      message: '--json and --markdown do not go together',
    });
  });

  it('reads the repeated --fix and --ignore-rev flags', () => {
    expect(
      parseArgs(['--fix', 'a', '--fix', 'b', '--ignore-rev', 'c', '--all-files', '--markdown']),
    ).toEqual({
      kind: 'run',
      fixes: ['a', 'b'],
      ignoreRevs: ['c'],
      allFiles: true,
      format: 'markdown',
    });
  });
});

describe('the text report names its fix count in the singular (summary sentence)', () => {
  it('starts with the singular summary sentence for one fix', () => {
    const dir = scratchDir('szz-sentence-');
    const { c } = buildHistory(dir);
    expect(formatText(szz(dir, [c.c4]))).toMatch(/^SZZ over 1 fix commit:/);
  });
});

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe('the script imports nothing from src/', () => {
  it('has no top-level import of a module under src/', () => {
    const text = readFileSync(join(__dirname, '..', 'scripts', 'szz.ts'), 'utf8');
    expect(text.match(/^import[^;]*from '\.\.\/src\/[^']*';/gm) ?? []).toEqual([]);
  });
});
