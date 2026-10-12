// ═══ The history reader is proven on a history built for it ═══
//
// `scripts/scope/history.ts` gives the context pack its history: the commits, the proposal
// footprints, the issue fixes, the co-change partners and the similarity ranking. This test builds
// a throwaway repository whose commits each carry one case: a proposal whose front matter is read,
// two commits that implement it, a fix numbered before the monorepo cutover and a fix numbered
// after it, and a commit of 41 files that is noisy and must count in no co-change. The expected
// values follow from that history. The history length is asserted first, so an empty reader cannot
// pass the other assertions by returning nothing.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  OWN_NUMBERING_SINCE,
  Similarity,
  coChange,
  issueFixes,
  noisyCommits,
  readHistory,
  readProposals,
  tokenize,
  type HistoryCommit,
} from '../scripts/scope/history.js';

// The proposal file name is built from two parts so that no literal `.md` path sits in this file:
// the path is a fixture inside a throwaway repository, not a file of this tree.
const PROPOSAL_FILE = 'changes/0001-x' + '.md';
const PROPOSAL_DRAFT = [
  '---',
  "id: '0001'",
  'title: Fixture change',
  'status: draft',
  'rules:',
  "- '1.3'",
  'codes:',
  '- TS8019',
  'downstream:',
  '- repo: typeshade.github.io',
  '  what: One line naming the pages',
  '---',
  '',
  '# Fixture change',
  '',
  'Body text of the fixture.',
  '',
].join('\n');

const BASE_ENV = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_NOSYSTEM: '1',
};

function gitIn(dir: string, args: readonly string[], env: Record<string, string> = {}): string {
  return execFileSync('git', [...args], {
    cwd: dir,
    env: { ...process.env, ...BASE_ENV, HOME: dir, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function put(dir: string, path: string, text: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}

interface Built {
  readonly dir: string;
  readonly sha: Readonly<Record<string, string>>;
  readonly history: HistoryCommit[];
  readonly noisy: ReadonlySet<string>;
}

// Each commit takes its author and committer date from its own line, so the order and the
// cutover are deterministic. The keys name the commits in the expectations below.
function buildHistory(dir: string): Built {
  gitIn(dir, ['init', '-q', '-b', 'main']);
  const sha: Record<string, string> = {};
  const commit = (key: string, when: string, subject: string, body = ''): void => {
    gitIn(dir, ['add', '-A']);
    const args = ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', subject];
    if (body !== '') args.push('-m', body);
    gitIn(dir, args, { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when });
    sha[key] = gitIn(dir, ['rev-parse', 'HEAD']).trim();
  };

  // Before the cutover (2026-09-13T15:00:00Z): the root, the proposal and its implementation.
  put(dir, 'src/a.ts', 'export const one = 1;\n');
  put(dir, 'src/b.ts', 'export const bee = 1;\n');
  put(dir, 'src/c.ts', 'export const sea = 1;\n');
  commit('c0', '2026-08-01T00:00:00Z', 'chore: root');

  put(dir, PROPOSAL_FILE, PROPOSAL_DRAFT);
  commit('c1', '2026-08-02T00:00:00Z', 'docs: propose the fixture change');

  put(dir, 'src/a.ts', 'export const one = 2;\n');
  put(dir, 'src/b.ts', 'export const bee = 2;\n');
  commit('c2', '2026-08-03T00:00:00Z', 'feat: implement the fixture change', 'Change: 0001');

  // An issue fix numbered before the cutover: its numbers are not used.
  put(dir, 'src/a.ts', 'export const one = 3;\n');
  commit('c3', '2026-08-04T00:00:00Z', 'fix: follow up (#7) (#8)');

  // The second implementing commit also sets the proposal to accepted.
  put(dir, 'src/a.ts', 'export const one = 4;\n');
  put(dir, PROPOSAL_FILE, PROPOSAL_DRAFT.replace('status: draft', 'status: accepted'));
  commit('c4', '2026-08-05T00:00:00Z', 'feat: finish the fixture change', 'Change: 0001');

  // Repeated co-changes: src/a.ts with src/c.ts three times, and src/b.ts only twice.
  for (const [key, day, n] of [
    ['c5', '06', 5],
    ['c6', '07', 6],
    ['c7', '08', 7],
  ] as const) {
    put(dir, 'src/a.ts', `export const one = ${n};\n`);
    put(dir, 'src/c.ts', `export const sea = ${n};\n`);
    commit(key, `2026-08-${day}T00:00:00Z`, `chore: a and c, round ${n}`);
  }

  // After the cutover: a fix numbered with a pull request and an issue.
  put(dir, 'src/d.ts', 'export const dee = 1;\n');
  commit('c8', '2026-10-01T00:00:00Z', 'fix: parser (#12) (#13)');

  // A 41-file commit: noisy, because it touches more than 40 files.
  const bulk: string[] = [];
  for (let i = 1; i <= 39; i += 1) {
    const path = `src/bulk/f${String(i).padStart(2, '0')}.ts`;
    bulk.push(path);
    put(dir, path, `export const v${i} = ${i};\n`);
  }
  put(dir, 'src/a.ts', 'export const one = 8;\n');
  put(dir, 'src/c.ts', 'export const sea = 8;\n');
  commit('c9', '2026-10-02T00:00:00Z', 'chore: bulk reformat');

  const history = readHistory(dir, 'HEAD');
  const noisy = noisyCommits(dir, 'HEAD', history);
  return { dir, sha, history, noisy };
}

let built: Built;
const scratch: string[] = [];

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'scope-history-'));
  scratch.push(dir);
  built = buildHistory(dir);
});

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe('the history reader on a throwaway repository', () => {
  it('reads every non-merge commit, newest first, with its files', () => {
    expect(built.history.length).toBe(10);
    expect(built.history[0]?.sha).toBe(built.sha.c9);
    expect(built.history[0]?.subject).toBe('chore: bulk reformat');
    expect(built.history[0]?.files.length).toBe(41);
    expect(built.history[built.history.length - 1]?.sha).toBe(built.sha.c0);
  });

  it('places the cutover between the pre-cutover and the post-cutover commits', () => {
    const time = (key: string): number =>
      built.history.find((c) => c.sha === built.sha[key])?.time ?? Number.NaN;
    expect(time('c3')).toBeLessThan(OWN_NUMBERING_SINCE);
    expect(time('c8')).toBeGreaterThan(OWN_NUMBERING_SINCE);
  });

  it('marks the 41-file commit as the only noisy commit', () => {
    expect([...built.noisy]).toEqual([built.sha.c9]);
  });

  it('parses the front matter of the proposal at the revision', () => {
    const proposals = readProposals(built.dir, 'HEAD', built.history, built.noisy);
    const proposal = proposals.find((p) => p.id === '0001');
    expect(proposals.length).toBe(1);
    expect(proposal?.path).toBe(PROPOSAL_FILE);
    expect(proposal?.title).toBe('Fixture change');
    expect(proposal?.status).toBe('accepted');
    expect(proposal?.rules).toEqual(['1.3']);
    expect(proposal?.codes).toEqual(['TS8019']);
    expect(proposal?.downstream).toEqual([
      { repo: 'typeshade.github.io', what: 'One line naming the pages' },
    ]);
    expect(proposal?.text).toContain('Body text of the fixture.');
    expect(proposal?.text).not.toContain('status:');
  });

  it('finds the implementing commits newest first, and their files without the proposal file', () => {
    const proposal = readProposals(built.dir, 'HEAD', built.history, built.noisy).find(
      (p) => p.id === '0001',
    );
    expect(proposal?.commits).toEqual([built.sha.c4, built.sha.c2]);
    expect(proposal?.files).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('reads issue fixes only from commits after the cutover, and takes the last number as the pull request', () => {
    const fixes = issueFixes(built.history, built.noisy);
    expect(fixes.map((f) => f.issue)).toEqual([12]);
    expect(fixes[0]?.commits).toEqual([built.sha.c8]);
  });

  it('counts co-change over non-noisy commits only, with the default minimum of three', () => {
    const partners = coChange(built.history, built.noisy, 'src/a.ts');
    expect(partners.map((p) => p.file)).toEqual(['src/c.ts']);
    expect(partners[0]?.together).toBe(4);
    expect(partners[0]?.confidence).toBeCloseTo(4 / 7, 10);
  });

  it('keeps a partner with two shared commits when the minimum is two, sorted by confidence', () => {
    const partners = coChange(built.history, built.noisy, 'src/a.ts', 2);
    expect(partners.map((p) => p.file)).toEqual(['src/c.ts', 'src/b.ts']);
    expect(partners[1]?.together).toBe(2);
    expect(partners[1]?.confidence).toBeCloseTo(2 / 7, 10);
  });

  it('never lists a file of the noisy commit as a partner', () => {
    const partners = coChange(built.history, built.noisy, 'src/a.ts', 1);
    expect(partners.some((p) => p.file.startsWith('src/bulk/'))).toBe(false);
  });
});

describe('the pure readers', () => {
  it('tokenizes camelCase and drops English stopwords and short words', () => {
    // 'type' is a STOPWORDS entry (spec section 4), so it is dropped too.
    expect(tokenize('typeArrayElement for fill')).toEqual(['array', 'element', 'fill']);
  });

  it('ranks the matching document first and drops a document with a zero score', () => {
    const similarity = new Similarity([
      { id: 'typed', text: 'typeArrayElement lowering for fill arrays' },
      { id: 'colour', text: 'colour palette for charts' },
      { id: 'fill', text: 'fill the buffer' },
    ]);
    const ranked = similarity.rank(tokenize('typeArrayElement for fill'), 10);
    expect(ranked.map((r) => r.id)).toEqual(['typed', 'fill']);
    expect(ranked.every((r) => r.score > 0)).toBe(true);
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? Number.POSITIVE_INFINITY);
    expect(similarity.rank(['zzzz'], 10)).toEqual([]);
  });

  it('places the cutover at 2026-09-14T00:00:00+09:00', () => {
    expect(OWN_NUMBERING_SINCE).toBe(Date.parse('2026-09-14T00:00:00+09:00') / 1000);
  });
});

describe('issueFixes reads every closing keyword in a body', () => {
  let dir = '';

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'scope-closes-'));
    scratch.push(dir);
    gitIn(dir, ['init', '-q', '-b', 'main']);
    put(dir, 'src/a.ts', 'export const one = 1;\n');
    gitIn(dir, ['add', '-A']);
    gitIn(dir, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'chore: root'], {
      GIT_AUTHOR_DATE: '2026-10-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-10-01T00:00:00Z',
    });
    put(dir, 'src/a.ts', 'export const one = 2;\n');
    gitIn(dir, ['add', '-A']);
    gitIn(
      dir,
      [
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-q',
        '-m',
        'fix: parser',
        '-m',
        'Closes #345. Closes #348.',
      ],
      { GIT_AUTHOR_DATE: '2026-10-02T00:00:00Z', GIT_COMMITTER_DATE: '2026-10-02T00:00:00Z' },
    );
  });

  it('gives issues 345 and 348 from one body line', () => {
    const history = readHistory(dir, 'HEAD');
    const noisy = noisyCommits(dir, 'HEAD', history);
    expect(history.length).toBe(2);
    const fixes = issueFixes(history, noisy);
    expect(fixes.map((f) => f.issue)).toEqual([345, 348]);
  });
});
