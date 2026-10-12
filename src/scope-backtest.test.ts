// ═══ The backtest of the context pack reads a git history the way the report does ═══
//
// `scripts/scope-backtest.ts` is a report, not a gate: CI does not run it. Its readers and its
// scoring are pinned here on hand-written input and on a throwaway repository whose commits each
// carry one case: a fix that changes three files, a second fix after it, a fix that changes only
// documentation. The instrument must find a known answer (a named symbol) and must show a known
// miss (a body that names nothing) before its numbers count as a finding. No network, no `gh`,
// no real `codebase-memory-mcp`: the graph mode is tested through fake dependencies.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  formatReport,
  loadCorpus,
  proposeCases,
  proposeFromHistory,
  runGitCase,
  runGraphCase,
  scoreCase,
  summarize,
  sweepStale,
  truthOf,
  type Case,
  type CaseResult,
  type GraphDeps,
} from '../scripts/scope/backtest.js';
import {
  buildPack,
  DEFAULT_LIMIT,
  DEFAULT_WEIGHTS,
  type Pack,
  type RankedFile,
} from '../scripts/scope/pack.js';
import { OWN_NUMBERING_SINCE, type HistoryCommit } from '../scripts/scope/history.js';
import type { Layer } from '../scripts/scope/layers.js';
import { closedIssuesFromReply, parseArgs, runOptionsFrom } from '../scripts/scope-backtest.js';

const BASE_ENV = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_NOSYSTEM: '1',
};

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

// One commit with its committer date. Returns the full sha.
function commitIn(dir: string, subject: string, committer: string): string {
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', subject], {
    GIT_AUTHOR_DATE: committer,
    GIT_COMMITTER_DATE: committer,
  });
  return gitIn(dir, ['rev-parse', 'HEAD']).trim();
}

// The n-th day after 2026-10-01, in the form git reads. Every date is after OWN_NUMBERING_SINCE,
// so an issue number in a subject counts.
function stamp(n: number): string {
  return new Date(Date.UTC(2026, 9, 1) + n * 86400000).toISOString().replace('.000Z', 'Z');
}

// The fixture: c1 is the root; c2 is a fix that changes src/a.ts, src/a.test.ts and docs/x.txt;
// c3 is a fix after c2 that changes src/b.ts; c4 is a fix that changes only docs/x.txt.
interface Fixture {
  readonly dir: string;
  readonly c1: string;
  readonly c2: string;
  readonly c3: string;
  readonly c4: string;
}

function buildFixture(): Fixture {
  const dir = scratchDir('scope-bt-');
  initIn(dir);
  writeIn(dir, 'README.md', ['root']);
  writeIn(dir, 'src/a.ts', [
    'export function alphaThing(value: number): number {',
    '  return value + 1;',
    '}',
  ]);
  writeIn(dir, 'src/a.test.ts', ["import { alphaThing } from './a';", 'void alphaThing;']);
  writeIn(dir, 'src/b.ts', ['export const beta = 2;']);
  writeIn(dir, 'docs/x.txt', ['first draft']);
  const c1 = commitIn(dir, 'chore: root', stamp(0));

  writeIn(dir, 'src/a.ts', [
    'export function alphaThing(value: number): number {',
    '  return value + 2;',
    '}',
  ]);
  writeIn(dir, 'src/a.test.ts', [
    "import { alphaThing } from './a';",
    'void alphaThing;',
    '// fix',
  ]);
  writeIn(dir, 'docs/x.txt', ['second draft']);
  const c2 = commitIn(dir, 'fix: alpha is off by one (#41)', stamp(1));

  writeIn(dir, 'src/b.ts', ['export const beta = 3;']);
  const c3 = commitIn(dir, 'fix: beta value (#42)', stamp(2));

  writeIn(dir, 'docs/x.txt', ['third draft']);
  const c4 = commitIn(dir, 'fix: docs only (#43)', stamp(3));

  return { dir, c1, c2, c3, c4 };
}

function caseOf(over: Partial<Case> & Pick<Case, 'issue' | 'fixes' | 'title' | 'body'>): Case {
  return { set: 'tuning', ...over };
}

function rankedOf(file: string, layer: Layer): RankedFile {
  return { file, layer, score: 1, reasons: [] };
}

// A hand-made case result, with the fields a test does not read set to neutral values.
function resultOf(
  over: Partial<CaseResult> & Pick<CaseResult, 'issue' | 'set' | 'resolver' | 'status'>,
): CaseResult {
  return {
    note: '',
    at: '',
    truth: [],
    truthTests: [],
    ranked: [],
    recall5: 0,
    recall15: 0,
    precision5: 0,
    firstRank: null,
    reciprocalRank: 0,
    deepestTruth: null,
    deepestPack: null,
    deepestMatch: null,
    testRecall: null,
    seconds: 0,
    ...over,
  };
}

let fx: Fixture;

beforeAll(() => {
  fx = buildFixture();
});

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe('1. truth: the changed code files of the fixes, and the parent of the oldest fix', () => {
  it('takes the code and test files of one fix, and its parent as the revision', () => {
    const truth = truthOf(fx.dir, [fx.c2]);
    expect(truth.files).toEqual(['src/a.ts']);
    expect(truth.tests).toEqual(['src/a.test.ts']);
    expect(truth.at).toBe(fx.c1);
  });

  it('takes the parent of the first of two fixes when the second follows the first', () => {
    const truth = truthOf(fx.dir, [fx.c2, fx.c3]);
    expect(truth.at).toBe(fx.c1);
    expect(truth.files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(truthOf(fx.dir, [fx.c3, fx.c2]).at).toBe(fx.c1);
  });
});

describe('2 and 3. the instrument finds a known answer and shows a known miss', () => {
  it('ranks the file that defines a named symbol first, with recall 1', async () => {
    const result = await runGitCase(
      fx.dir,
      caseOf({
        issue: 41,
        fixes: [fx.c2],
        title: 'alphaThing is off by one',
        body: 'The `alphaThing` function returns one too few.',
      }),
    );
    expect(result.status).toBe('ok');
    expect(result.recall5).toBe(1);
    expect(result.firstRank).toBe(1);
    expect(result.reciprocalRank).toBe(1);
  });

  it('gives recall 0 and no early rank when the body names nothing in the repository', async () => {
    const result = await runGitCase(
      fx.dir,
      caseOf({
        issue: 49,
        fixes: [fx.c2],
        title: 'Report',
        body: 'Nothing here names a symbol.',
      }),
    );
    expect(result.status).toBe('ok');
    expect(result.recall5).toBe(0);
    expect(result.firstRank === null || result.firstRank > 5).toBe(true);
    expect(result.reciprocalRank).toBeLessThan(1);
  });
});

describe('4. a fix with no code truth is skipped, not scored', () => {
  it('gives status no-code-truth and builds no pack', async () => {
    const result = await runGitCase(
      fx.dir,
      caseOf({ issue: 43, fixes: [fx.c4], title: 'docs', body: 'Only a document.' }),
    );
    expect(result.status).toBe('no-code-truth');
    expect(result.truth).toEqual([]);
  });

  it('counts that case as skipped, outside the means', () => {
    const ok = resultOf({ issue: 41, set: 'tuning', resolver: 'git', status: 'ok', recall5: 1 });
    const skipped = resultOf({
      issue: 43,
      set: 'tuning',
      resolver: 'git',
      status: 'no-code-truth',
    });
    const [row] = summarize([skipped, ok]);
    expect(row).toMatchObject({ set: 'tuning', resolver: 'git', cases: 1, skipped: 1, recall5: 1 });
  });
});

describe('5. scores on a hand-made truth and pack', () => {
  const truth = {
    at: 'f'.repeat(40),
    files: ['src/core/ir/a.ts', 'src/compiler/b.ts', 'src/c.ts'],
    tests: ['src/core/ir/a.test.ts'],
  };
  const files = [
    rankedOf('src/x.ts', 'other'),
    rankedOf('src/core/ir/a.ts', 'ir'),
    rankedOf('src/y.ts', 'other'),
    rankedOf('src/compiler/b.ts', 'front-end'),
    rankedOf('src/z.ts', 'other'),
    rankedOf('src/w.ts', 'other'),
  ];

  it('computes recall, precision, first rank and reciprocal rank', () => {
    const score = scoreCase(truth, { files, deepest: 'passes', tests: ['src/core/ir/a.test.ts'] });
    expect(score.recall5).toBeCloseTo(2 / 3, 10);
    expect(score.recall15).toBeCloseTo(2 / 3, 10);
    expect(score.precision5).toBeCloseTo(2 / 5, 10);
    expect(score.firstRank).toBe(2);
    expect(score.reciprocalRank).toBe(0.5);
  });

  it('takes the deepest PIPELINE layer of the truth, and compares it with the pack', () => {
    const pipeline = { ...truth, files: ['src/core/ir/a.ts', 'src/compiler/b.ts'] };
    const miss = scoreCase(pipeline, { files, deepest: 'passes', tests: [] });
    expect(miss.deepestTruth).toBe('ir');
    expect(miss.deepestPack).toBe('passes');
    expect(miss.deepestMatch).toBe(false);
    const hit = scoreCase(pipeline, { files, deepest: 'ir', tests: [] });
    expect(hit.deepestMatch).toBe(true);
  });

  it('gives a null deepest match when the truth has no PIPELINE layer', () => {
    const plain = { at: 'f'.repeat(40), files: ['scripts/x.ts'], tests: [] };
    const score = scoreCase(plain, {
      files: [rankedOf('scripts/x.ts', 'other')],
      deepest: 'ir',
      tests: [],
    });
    expect(score.deepestTruth).toBeNull();
    expect(score.deepestMatch).toBeNull();
  });

  it('computes the test recall, and a null one when the truth has no tests', () => {
    const score = scoreCase(truth, { files, deepest: 'ir', tests: ['src/core/ir/a.test.ts'] });
    expect(score.testRecall).toBe(1);
    const none = scoreCase({ ...truth, tests: [] }, { files, deepest: 'ir', tests: [] });
    expect(none.testRecall).toBeNull();
  });
});

describe('6. summaries of both sets and both resolvers', () => {
  const results: CaseResult[] = [
    resultOf({
      issue: 49,
      set: 'held-out',
      resolver: 'graph',
      status: 'ok',
      recall5: 0.6,
      recall15: 0.8,
      precision5: 0.6,
      reciprocalRank: 0.25,
      deepestMatch: null,
      testRecall: 0.5,
      seconds: 1,
    }),
    resultOf({ issue: 43, set: 'tuning', resolver: 'git', status: 'no-code-truth' }),
    resultOf({
      issue: 42,
      set: 'tuning',
      resolver: 'git',
      status: 'ok',
      recall5: 0.25,
      recall15: 0.5,
      precision5: 0.4,
      reciprocalRank: 0.5,
      deepestMatch: false,
      testRecall: null,
      seconds: 4,
    }),
    resultOf({
      issue: 41,
      set: 'tuning',
      resolver: 'git',
      status: 'ok',
      recall5: 0.5,
      recall15: 1,
      precision5: 0.2,
      reciprocalRank: 1,
      deepestMatch: true,
      testRecall: 1,
      seconds: 2,
    }),
  ];

  it('gives one row per set and resolver present, in the fixed order', () => {
    const rows = summarize(results);
    expect(rows.map((row) => `${row.set}/${row.resolver}`)).toEqual([
      'tuning/git',
      'held-out/graph',
    ]);
  });

  it('takes the means over the cases with status ok, and counts deepest as right/of', () => {
    const [tuning, heldOut] = summarize(results);
    expect(tuning).toBeDefined();
    expect(tuning).toMatchObject({ cases: 2, skipped: 1, deepest: { right: 1, of: 2 } });
    expect(tuning?.recall5).toBeCloseTo(0.375, 10);
    expect(tuning?.recall15).toBeCloseTo(0.75, 10);
    expect(tuning?.precision5).toBeCloseTo(0.3, 10);
    expect(tuning?.mrr).toBeCloseTo(0.75, 10);
    expect(tuning?.testRecall).toBe(1);
    expect(tuning?.seconds).toBeCloseTo(3, 10);
    expect(heldOut).toMatchObject({ cases: 1, skipped: 0, deepest: { right: 0, of: 0 } });
    expect(heldOut?.testRecall).toBe(0.5);
  });
});

describe('7. graph mode cleans up whatever happens', () => {
  function fakeDeps(build: GraphDeps['build']): {
    deps: GraphDeps;
    calls: { deleted: number; removed: number };
  } {
    const calls = { deleted: 0, removed: 0 };
    const deps: GraphDeps = {
      addWorktree: (_cwd, _at) => join(scratchDir('scope-bt-wt-'), 'worktree'),
      index: (_path) => undefined,
      build,
      deleteProject: (_path) => {
        calls.deleted += 1;
      },
      removeWorktree: (_cwd, _path) => {
        calls.removed += 1;
      },
    };
    return { deps, calls };
  }

  const graphCase = (): Case =>
    caseOf({ issue: 41, fixes: [fx.c2], title: 'alphaThing', body: 'alphaThing' });

  it('still deletes the project and removes the worktree when the build throws', async () => {
    const { deps, calls } = fakeDeps(async () => {
      throw new Error('build failed on purpose');
    });
    const result = await runGraphCase(fx.dir, graphCase(), {}, deps);
    expect(result.status).toBe('error');
    expect(result.note).toContain('build failed on purpose');
    expect(calls).toEqual({ deleted: 1, removed: 1 });
  });

  it('reports graph-unavailable when the pack answers with the git resolver', async () => {
    const gitPack = {
      at: fx.c1,
      resolver: { kind: 'git', note: 'the graph did not run' },
      files: [],
      deepest: null,
      tests: [],
    } as unknown as Pack;
    const { deps, calls } = fakeDeps(async () => gitPack);
    const result = await runGraphCase(fx.dir, graphCase(), {}, deps);
    expect(result.status).toBe('graph-unavailable');
    expect(result.note).toContain('the graph did not run');
    expect(calls).toEqual({ deleted: 1, removed: 1 });
  });
});

describe('8. weights override the constants without changing the default', () => {
  it('scores a named path lower when the namedPath weight is 0, and leaves the default as it was', async () => {
    const body = 'The change is in src/a.ts only.';
    const scoreOf = (pack: Pack): number =>
      pack.files.find((ranked) => ranked.file === 'src/a.ts')?.score ?? 0;

    const defaults = await buildPack(fx.dir, 'Title', body, null, { at: fx.c1 });
    const zeroed = await buildPack(fx.dir, 'Title', body, null, {
      at: fx.c1,
      weights: { namedPath: 0 },
    });
    expect(scoreOf(defaults)).toBeGreaterThan(scoreOf(zeroed));

    const explicit = await buildPack(fx.dir, 'Title', body, null, {
      at: fx.c1,
      weights: {},
    });
    expect(explicit.files.map((ranked) => ranked.file)).toEqual(
      defaults.files.map((ranked) => ranked.file),
    );
    expect(DEFAULT_WEIGHTS.namedPath).toBe(5);
  });
});

describe('9. proposeCases keeps the new issues with a code fix, and splits them by parity', () => {
  const history: HistoryCommit[] = [
    {
      sha: 'a'.repeat(40),
      time: OWN_NUMBERING_SINCE + 86400,
      subject: 'fix: one (#12) (#112)',
      body: '',
      files: ['src/a.ts'],
    },
    {
      sha: 'b'.repeat(40),
      time: OWN_NUMBERING_SINCE + 2 * 86400,
      subject: 'fix: two (#13) (#113)',
      body: '',
      files: ['src/b.ts'],
    },
  ];
  const issues = [
    { number: 12, title: 'one', body: '' },
    { number: 13, title: 'two', body: '' },
    { number: 14, title: 'fourteen, no fix', body: '' },
  ];

  it('proposes the issues with a fix, as tuning when even and held-out when odd', () => {
    const proposed = proposeCases(issues, history, new Set<number>());
    expect(proposed.map((c) => [c.issue, c.set])).toEqual([
      [12, 'tuning'],
      [13, 'held-out'],
    ]);
    expect(proposed[0]?.fixes).toEqual(['a'.repeat(7)]);
  });

  it('skips an issue that the corpus already knows', () => {
    const proposed = proposeCases(issues, history, new Set<number>([12]));
    expect(proposed.map((c) => c.issue)).toEqual([13]);
  });
});

describe('10. the real corpus is well formed and every fix resolves', () => {
  const repoRoot = join(__dirname, '..');
  const corpusPath = join(repoRoot, 'scripts', 'scope', 'backtest', 'cases.json');

  it('has 21 cases, 11 tuning and 10 held-out, with no duplicate issue', () => {
    const corpus = loadCorpus(corpusPath);
    expect(corpus.cases).toHaveLength(21);
    expect(corpus.cases.filter((c) => c.set === 'tuning')).toHaveLength(11);
    expect(corpus.cases.filter((c) => c.set === 'held-out')).toHaveLength(10);
    expect(new Set(corpus.cases.map((c) => c.issue)).size).toBe(21);
  });

  it('resolves every fix commit in this repository', () => {
    const corpus = loadCorpus(corpusPath);
    for (const c of corpus.cases) {
      for (const sha of c.fixes) {
        const resolved = execFileSync('git', ['rev-parse', '--verify', `${sha}^{commit}`], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
        expect(resolved, `issue ${c.issue}, fix ${sha}`).toMatch(/^[0-9a-f]{40}$/);
      }
    }
  });
});

describe('11. parseArgs answers help, a usage error and a good run', () => {
  it('answers help for --help', () => {
    expect(parseArgs(['--help'])).toMatchObject({ kind: 'help' });
  });

  it('refuses an unknown option, and names it', () => {
    const parsed = parseArgs(['--bogus']);
    expect(parsed).toMatchObject({ kind: 'error' });
    expect(JSON.stringify(parsed)).toContain('--bogus');
  });

  it('refuses a --set value that is not tuning, held-out or all', () => {
    expect(parseArgs(['--set', 'nope'])).toMatchObject({ kind: 'error' });
  });

  it('accepts a good run', () => {
    expect(parseArgs(['--set', 'held-out', '--resolver', 'git'])).toMatchObject({ kind: 'run' });
  });
});

describe('12. the report has the table header and one row per case', () => {
  it('prints the table header, both case rows and the not-scored section', () => {
    const results: CaseResult[] = [
      resultOf({
        issue: 498,
        set: 'tuning',
        resolver: 'git',
        status: 'ok',
        at: fx.c1,
        truth: ['src/a.ts'],
        ranked: ['src/a.ts'],
        recall5: 1,
        recall15: 1,
        firstRank: 1,
        reciprocalRank: 1,
        precision5: 0.2,
        seconds: 1,
      }),
      resultOf({
        issue: 607,
        set: 'held-out',
        resolver: 'git',
        status: 'error',
        note: 'git failed',
      }),
    ];
    const text = formatReport(results);
    expect(text).toContain(
      '| Set | Cases | recall@5 | recall@15 | MRR | P@5 | deepest | tests | s/case |',
    );
    expect(text).toMatch(/\|\s*#?498\s*\|/);
    expect(text).toMatch(/\|\s*#?607\s*\|/);
    expect(text).toContain('## Cases');
    expect(text).toContain('## Not scored');
    expect(text).toContain('git failed');
  });
});

describe('13. the proposal drops the noisy commits before it reads the issues (T1)', () => {
  it('does not propose an issue whose only fix is a 41-file commit', () => {
    const dir = scratchDir('scope-test-hist-');
    initIn(dir);
    writeIn(dir, 'README.md', ['root']);
    commitIn(dir, 'chore: root', stamp(0));

    for (let i = 0; i < 41; i++) {
      writeIn(dir, `src/bulk/f${String(i).padStart(2, '0')}.ts`, [`export const v${i} = ${i};`]);
    }
    commitIn(dir, 'chore: bulk (#21) (#22)', stamp(1));

    writeIn(dir, 'src/real.ts', ['export const real = 1;']);
    commitIn(dir, 'fix: real (#23) (#24)', stamp(2));

    const issues = [
      { number: 21, title: 'bulk', body: '' },
      { number: 23, title: 'real', body: '' },
    ];
    const proposed = proposeFromHistory(dir, issues, new Set<number>());
    expect(proposed.map((c) => c.issue)).toEqual([23]);
  });
});

describe('14. the weights reach the git resolver (T2)', () => {
  it('builds the pack with the weights it was given, and scores the named file lower', async () => {
    const c = caseOf({
      issue: 41,
      fixes: [fx.c2],
      title: 'alphaThing is off by one',
      body: 'The change is in src/a.ts only.',
    });
    const built: Pack[] = [];
    const recording: typeof buildPack = async (...args) => {
      const pack = await buildPack(...args);
      built.push(pack);
      return pack;
    };
    const scoreOf = (pack: Pack): number =>
      pack.files.find((ranked) => ranked.file === 'src/a.ts')?.score ?? 0;

    await runGitCase(fx.dir, c, { weights: { namedPath: 0 } }, recording);
    await runGitCase(fx.dir, c, {}, recording);
    const [zeroed, defaults] = built;
    expect(zeroed).toBeDefined();
    expect(defaults).toBeDefined();
    expect(scoreOf(zeroed as Pack)).toBeLessThan(scoreOf(defaults as Pack));
  });
});

describe('15. the weights reach the graph build (T3)', () => {
  it('hands the weights to the build it runs on the worktree', async () => {
    let received: { weights?: unknown } | undefined;
    const deps: GraphDeps = {
      addWorktree: (_cwd, _at) => scratchDir('scope-test-graph-'),
      index: (_path) => undefined,
      build: async (_path, _c, options) => {
        received = options;
        return {
          at: fx.c1,
          resolver: { kind: 'graph', note: '' },
          files: [],
          deepest: null,
          tests: [],
        } as unknown as Pack;
      },
      deleteProject: (_path) => undefined,
      removeWorktree: (_cwd, _path) => undefined,
    };
    const c = caseOf({ issue: 41, fixes: [fx.c2], title: 'alphaThing', body: 'alphaThing' });
    await runGraphCase(fx.dir, c, { weights: { namedPath: 0 } }, deps);
    expect(received?.weights).toEqual({ namedPath: 0 });
  });
});

describe('16. the CLI passes the weights and the limit on (T4)', () => {
  it('reads the weights file and carries the limit into the run options', () => {
    const dir = scratchDir('scope-test-weights-');
    const file = join(dir, 'w.json');
    writeFileSync(file, '{"namedPath": 0}\n');
    const parsed = parseArgs(['--weights', file, '--limit', '15']);
    expect(parsed.kind).toBe('run');
    if (parsed.kind !== 'run') return;
    expect(runOptionsFrom(parsed)).toEqual({ limit: 15, weights: { namedPath: 0 } });
  });
});

describe('20. the limit is the CLI default, and at least 15 (LIMIT)', () => {
  it('parses a run without --limit to DEFAULT_LIMIT, the CLI default', () => {
    const parsed = parseArgs(['--set', 'held-out']);
    expect(parsed).toMatchObject({ kind: 'run', limit: DEFAULT_LIMIT });
    expect(DEFAULT_LIMIT).toBe(15);
  });

  it('refuses --limit 14 and names 15', () => {
    const parsed = parseArgs(['--limit', '14']);
    expect(parsed).toMatchObject({ kind: 'error' });
    expect(JSON.stringify(parsed)).toContain('at least 15, got 14');
  });

  it('accepts --limit 15 and --limit 50', () => {
    expect(parseArgs(['--limit', '15'])).toMatchObject({ kind: 'run', limit: 15 });
    expect(parseArgs(['--limit', '50'])).toMatchObject({ kind: 'run', limit: 50 });
  });

  it('hands DEFAULT_LIMIT to the build when a git case gives no limit', async () => {
    const c = caseOf({
      issue: 41,
      fixes: [fx.c2],
      title: 'alphaThing is off by one',
      body: 'The change is in src/a.ts only.',
    });
    const seen: Array<{ limit?: number } | undefined> = [];
    const recording: typeof buildPack = (...args) => {
      seen.push(args[4]);
      return buildPack(...args);
    };
    await runGitCase(fx.dir, c, {}, recording);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.limit).toBe(DEFAULT_LIMIT);
  });
});

describe('17. a fix with no code truth builds nothing (T5, T6)', () => {
  it('the graph resolver skips a docs-only fix before any worktree, index or build (T5)', async () => {
    const calls = { addWorktree: 0, index: 0, build: 0 };
    const deps: GraphDeps = {
      addWorktree: (_cwd, _at) => {
        calls.addWorktree += 1;
        return '/unused';
      },
      index: (_path) => {
        calls.index += 1;
      },
      build: async () => {
        calls.build += 1;
        return {} as Pack;
      },
      deleteProject: (_path) => undefined,
      removeWorktree: (_cwd, _path) => undefined,
    };
    const result = await runGraphCase(
      fx.dir,
      caseOf({ issue: 43, fixes: [fx.c4], title: 'docs', body: 'Only a document.' }),
      {},
      deps,
    );
    expect(result.status).toBe('no-code-truth');
    expect(calls).toEqual({ addWorktree: 0, index: 0, build: 0 });
  });

  it('the git resolver skips a docs-only fix before any pack is built (T6)', async () => {
    let builds = 0;
    const countingBuild: typeof buildPack = async (...args) => {
      builds += 1;
      return buildPack(...args);
    };
    const result = await runGitCase(
      fx.dir,
      caseOf({ issue: 43, fixes: [fx.c4], title: 'docs', body: 'Only a document.' }),
      {},
      countingBuild,
    );
    expect(result.status).toBe('no-code-truth');
    expect(builds).toBe(0);
    expect(result.ranked).toEqual([]);
    expect(result.recall5).toBe(0);
    expect(result.recall15).toBe(0);
    expect(result.precision5).toBe(0);
    expect(result.reciprocalRank).toBe(0);
  });
});

describe('18. the sweep removes only the worktrees an interrupted run left (T7)', () => {
  it('removes and deletes the scope-bt worktree under tmpdir, and no other', () => {
    const swept = join(tmpdir(), 'scope-bt-498-e56b886-x');
    const removed: string[] = [];
    const deleted: string[] = [];
    const deps: Parameters<typeof sweepStale>[1] = {
      listWorktrees: (_cwd) => ['/home/user/typeshade-backtest', swept, join(tmpdir(), 'other')],
      removeWorktree: (_cwd, path) => {
        removed.push(path);
      },
      deleteProject: (path) => {
        deleted.push(path);
      },
    };
    sweepStale('/home/user/typeshade-backtest', deps);
    expect(removed).toEqual([swept]);
    expect(deleted).toEqual([swept]);
  });

  it('leaves a scope-bt worktree that is not directly under tmpdir', () => {
    const outside = join('/home/user/elsewhere', 'scope-bt-498-e56b886-x');
    const removed: string[] = [];
    const deps: Parameters<typeof sweepStale>[1] = {
      listWorktrees: (_cwd) => [outside],
      removeWorktree: (_cwd, path) => {
        removed.push(path);
      },
      deleteProject: () => {},
    };
    expect(sweepStale('/home/user/typeshade-backtest', deps)).toBe(0);
    expect(removed).toEqual([]);
  });
});

describe('19. the report header counts the issues and the results (T8)', () => {
  it('says the results when two results share one issue', () => {
    const results: CaseResult[] = [
      resultOf({ issue: 41, set: 'tuning', resolver: 'git', status: 'ok', recall5: 1 }),
      resultOf({ issue: 41, set: 'tuning', resolver: 'graph', status: 'ok', recall5: 1 }),
    ];
    expect(formatReport(results)).toContain('1 cases · 2 results');
  });

  it('gives no results part when each issue has one result', () => {
    const results: CaseResult[] = [
      resultOf({ issue: 41, set: 'tuning', resolver: 'git', status: 'ok', recall5: 1 }),
    ];
    const header = formatReport(results)
      .split('\n')
      .find((line) => line.startsWith('at '));
    expect(header).toContain('1 cases');
    expect(header).not.toContain('results');
  });
});

// `--collect` reads the closed issues through the REST API, one `gh api` call per page. The reply
// holds pull requests too, which are dropped. The cap is 500 issues.
describe('closedIssuesFromReply reads the REST pages of closed issues', () => {
  it('drops an item with a pull_request key and keeps the others in the API order', () => {
    const json = JSON.stringify([
      [
        { number: 9, title: 'A pull request', body: 'x', pull_request: { url: 'x' } },
        { number: 8, title: 'First issue', body: 'Body eight.' },
      ],
      [{ number: 7, title: 'Second issue', body: 'Body seven.' }],
    ]);
    expect(closedIssuesFromReply(json)).toEqual([
      { number: 8, title: 'First issue', body: 'Body eight.' },
      { number: 7, title: 'Second issue', body: 'Body seven.' },
    ]);
  });

  it('reads a null body as an empty string', () => {
    const json = JSON.stringify([[{ number: 6, title: 'No body', body: null }]]);
    expect(closedIssuesFromReply(json)).toEqual([{ number: 6, title: 'No body', body: '' }]);
  });

  it('caps the list at 500 issues across three pages, keeping the first 500 in order', () => {
    // Three pages of 200 issues each, newest first: 600 down to 1.
    const pages: unknown[][] = [];
    let next = 600;
    for (let p = 0; p < 3; p++) {
      const page: unknown[] = [];
      for (let i = 0; i < 200; i++) page.push({ number: next--, title: `t${next}`, body: '' });
      pages.push(page);
    }
    const out = closedIssuesFromReply(JSON.stringify(pages));
    expect(out).toHaveLength(500);
    expect(out[0]?.number).toBe(600);
    expect(out[499]?.number).toBe(101);
  });

  it('throws the gh could not list issues message for a reply that is not a list', () => {
    expect(() => closedIssuesFromReply('{"message":"nope"}')).toThrow(/^gh could not list issues:/);
  });

  it('throws for an item with no number', () => {
    expect(() => closedIssuesFromReply('[[{"title":"x","body":"y"}]]')).toThrow(
      /^gh could not list issues:/,
    );
  });
});

// The command form: `--collect` reaches `gh` only through `gh api`, one page per call.
describe('scope:backtest --collect reads through gh api, one REST page per call', () => {
  const ROOT = join(__dirname, '..');
  const BACKTEST = join(ROOT, 'scripts', 'scope-backtest.ts');
  const FAKE_GH = join(ROOT, 'scripts', 'scope', '__fixtures__', 'fake-gh.mjs');
  let dir: string;
  let log: string;

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'backtest-fake-gh-')));
    writeFileSync(join(dir, 'gh'), `#!/bin/sh\nexec node ${FAKE_GH} "$@"\n`);
    chmodSync(join(dir, 'gh'), 0o755);
    log = join(dir, 'calls.log');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Runs `--collect` through the fake gh. `full` sets FAKE_GH_FULL, which makes each page full.
  function runCollect(logFile: string, full = '') {
    return spawnSync('bun', [BACKTEST, '--collect'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH ?? ''}`,
        FAKE_GH_LOG: logFile,
        FAKE_GH_FULL: full,
      },
    });
  }

  // The page numbers of the closed-issue calls, in the order they were made.
  function closedPages(logFile: string): number[] {
    return readFileSync(logFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[])
      .flat()
      .filter((arg) => arg.includes('state=closed'))
      .map((arg) => Number(new URL(`https://fake.invalid/${arg}`).searchParams.get('page')));
  }

  it('prints a JSON array of proposed cases and calls only gh api, page by page', () => {
    const result = runCollect(log);
    expect(result.status).toBe(0);
    expect(Array.isArray(JSON.parse(result.stdout))).toBe(true);

    const calls = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.[0]).toBe('api');
    expect(call?.some((arg) => arg.includes('state=closed&per_page=100&page=1'))).toBe(true);
    expect(call).not.toContain('--paginate');
    expect(call).not.toContain('--json');
  }, 60_000);

  it('stops at 500 issues: pages 1 to 5 are read, page 6 is not', () => {
    const fullLog = join(dir, 'issues.log');
    const result = runCollect(fullLog, 'issues');
    expect(result.status).toBe(0);
    expect(Array.isArray(JSON.parse(result.stdout))).toBe(true);
    expect(closedPages(fullLog)).toEqual([1, 2, 3, 4, 5]);
  }, 60_000);

  it('counts issues, not pull requests: pages 1 to 10 are read, page 11 is not', () => {
    const mixedLog = join(dir, 'mixed.log');
    const result = runCollect(mixedLog, 'mixed');
    expect(result.status).toBe(0);
    expect(Array.isArray(JSON.parse(result.stdout))).toBe(true);
    expect(closedPages(mixedLog)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  }, 60_000);
});
