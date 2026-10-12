// ═══ Backtest: the context pack measured against the fixes that closed real issues ═══
//
// `bun run scope:backtest` builds the context pack (`bun run scope`) for each closed issue of the
// corpus at the parent of its fix, so the pack sees only what an implementer would have seen. It
// then compares the ranked files with the code files the fix really changed, and with the test
// files it touched. This file holds the library: the corpus reader, the truth of each case (the
// fix's files), the scores, the two resolvers (git, and the code graph on a fresh worktree), the
// summaries, the proposal of new cases, and the Markdown report.
//
// A report, not a gate. CI does not run it. The command is in scripts/scope-backtest.ts.
//
// Exit codes: none. The library throws on a git failure only where the case cannot be scored; a
// case that fails is recorded with status `error` and the run goes on.
//
// A graph case makes a worktree under os.tmpdir() and a graph project for it, and removes both in
// a finally. A signal (Ctrl-C, a kill) can interrupt a case between its worktree and its cleanup,
// so the cleanup never runs. The next graph run sweeps such a worktree (sweepStale).

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { PIPELINE, layerOf, type Layer } from './layers.js';
import { git, issueFixes, noisyCommits, readHistory, type HistoryCommit } from './history.js';
import { buildPack, type Pack, type Weights } from './pack.js';
import { parseListProjects } from './resolve.js';
import { isSourcePath } from '../szz.js';

export interface Case {
  readonly issue: number;
  readonly set: 'tuning' | 'held-out';
  readonly fixes: readonly string[];
  readonly title: string;
  readonly body: string;
}

export interface Corpus {
  readonly captured: string;
  readonly cases: readonly Case[];
}

const SETS: readonly ('tuning' | 'held-out')[] = ['tuning', 'held-out'];
const RESOLVERS: readonly ('git' | 'graph')[] = ['git', 'graph'];
const TOP5 = 5;
const TOP15 = 15;
const DEFAULT_CASE_LIMIT = 50;
// The base name of every scratch worktree a graph case makes; sweepStale looks for it.
const STALE_PREFIX = 'scope-bt-';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCase(raw: unknown, index: number, path: string): Case {
  const where = `case ${index} in ${path}`;
  if (!isRecord(raw)) throw new Error(`scope:backtest: ${where} is not an object`);
  const issue = raw.issue;
  const label = `case ${index} (issue ${String(issue)}) in ${path}`;
  if (typeof issue !== 'number' || !Number.isInteger(issue) || issue < 1) {
    throw new Error(`scope:backtest: ${where} has no whole issue number`);
  }
  if (raw.set !== 'tuning' && raw.set !== 'held-out') {
    throw new Error(`scope:backtest: ${label} has set ${String(raw.set)}, not tuning or held-out`);
  }
  const fixes = raw.fixes;
  if (
    !Array.isArray(fixes) ||
    fixes.length === 0 ||
    !fixes.every((fix) => typeof fix === 'string' && fix !== '')
  ) {
    throw new Error(`scope:backtest: ${label} needs fixes, a non-empty list of commit names`);
  }
  if (typeof raw.title !== 'string') throw new Error(`scope:backtest: ${label} has no title`);
  if (typeof raw.body !== 'string') throw new Error(`scope:backtest: ${label} has no body`);
  return {
    issue,
    set: raw.set,
    fixes: [...fixes] as string[],
    title: raw.title,
    body: raw.body,
  };
}

/** Reads and validates the corpus file. Throws, naming the bad case, when its shape is wrong. */
export function loadCorpus(path: string): Corpus {
  const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(data)) throw new Error(`scope:backtest: ${path} is not a JSON object`);
  if (typeof data.captured !== 'string') {
    throw new Error(`scope:backtest: ${path} has no captured date`);
  }
  if (!Array.isArray(data.cases)) throw new Error(`scope:backtest: ${path} has no cases list`);
  const cases = data.cases.map((raw, index) => parseCase(raw, index, path));
  return { captured: data.captured, cases };
}

export interface Truth {
  readonly at: string;
  readonly files: readonly string[];
  readonly tests: readonly string[];
}

const EMPTY_TRUTH: Truth = { at: '', files: [], tests: [] };

// True when `a` is an ancestor of `b`. Exit 1 means no; any other failure throws.
function isAncestor(cwd: string, a: string, b: string): boolean {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', a, b], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  const first = (result.stderr ?? '').split('\n')[0] ?? '';
  throw new Error(`scope:backtest: git merge-base failed for ${a} ${b}: ${first}`);
}

function committerTime(cwd: string, sha: string): number {
  return Number(git(cwd, 'show', '-s', '--format=%ct', sha).trim());
}

// The fix that is an ancestor of every other, else the one with the earliest committer time.
function oldestOf(cwd: string, shas: readonly string[]): string {
  const ancestor = shas.find((a) => shas.every((b) => a === b || isAncestor(cwd, a, b)));
  if (ancestor !== undefined) return ancestor;
  let best = shas[0] ?? '';
  for (const sha of shas) {
    if (committerTime(cwd, sha) < committerTime(cwd, best)) best = sha;
  }
  return best;
}

// The fix that every other is an ancestor of, else the one with the latest committer time.
function newestOf(cwd: string, shas: readonly string[]): string {
  const descendant = shas.find((a) => shas.every((b) => a === b || isAncestor(cwd, b, a)));
  if (descendant !== undefined) return descendant;
  let best = shas[0] ?? '';
  for (const sha of shas) {
    if (committerTime(cwd, sha) > committerTime(cwd, best)) best = sha;
  }
  return best;
}

/**
 * The truth of one case: the code files and the test files the fixes changed, and the revision
 * the pack is built at (the parent of the oldest fix). A fix is a commit name, short or full.
 */
export function truthOf(cwd: string, fixes: readonly string[]): Truth {
  if (fixes.length === 0) throw new Error('scope:backtest: a case has no fix');
  const shas = [
    ...new Set(fixes.map((fix) => git(cwd, 'rev-parse', '--verify', `${fix}^{commit}`).trim())),
  ];
  const oldest = oldestOf(cwd, shas);
  const newest = newestOf(cwd, shas);
  const at = git(cwd, 'rev-parse', '--verify', `${oldest}^1^{commit}`).trim();

  const changed = new Set<string>();
  for (const sha of shas) {
    git(cwd, 'show', '--no-renames', '--name-only', '--format=', sha)
      .split('\n')
      .filter((line) => line !== '')
      .forEach((file) => changed.add(file));
  }
  const files = [...changed]
    .filter((file) => isSourcePath(file) && !file.startsWith('journeys/'))
    .sort();

  const tracked = new Set(
    git(cwd, 'ls-tree', '-r', '--name-only', newest)
      .split('\n')
      .filter((line) => line !== ''),
  );
  const tests = [...changed]
    .filter((file) => /\.test\./.test(file.split('/').pop() ?? '') && tracked.has(file))
    .sort();
  return { at, files, tests };
}

export interface CaseResult {
  readonly issue: number;
  readonly set: 'tuning' | 'held-out';
  readonly resolver: 'git' | 'graph';
  readonly status: 'ok' | 'no-code-truth' | 'graph-unavailable' | 'error';
  readonly note: string; // why, for a status other than ok; else ''
  readonly at: string;
  readonly truth: readonly string[];
  readonly truthTests: readonly string[];
  readonly ranked: readonly string[]; // pack.files, in order (limit 50)
  readonly recall5: number;
  readonly recall15: number;
  readonly precision5: number;
  readonly firstRank: number | null; // 1-based rank of the first truth file in ranked, else null
  readonly reciprocalRank: number; // 1 / firstRank, or 0
  readonly deepestTruth: Layer | null;
  readonly deepestPack: Layer | null;
  readonly deepestMatch: boolean | null; // null when deepestTruth is null
  readonly testRecall: number | null; // null when truthTests is empty
  readonly seconds: number;
}

// The deepest PIPELINE layer among the files, by layerOf. Null when no file is in the pipeline.
function deepestOf(files: readonly string[]): Layer | null {
  let best: Layer | null = null;
  let bestIndex = -1;
  for (const file of files) {
    const layer = layerOf(file);
    const index = PIPELINE.indexOf(layer);
    if (index > bestIndex) {
      bestIndex = index;
      best = layer;
    }
  }
  return best;
}

/** The scores of one pack against one truth. A truth with no file gives recall 0. */
export function scoreCase(
  truth: Truth,
  pack: Pick<Pack, 'files' | 'deepest' | 'tests'>,
): Omit<CaseResult, 'issue' | 'set' | 'resolver' | 'status' | 'note' | 'seconds'> {
  const ranked = pack.files.map((ranked) => ranked.file);
  const truthFiles = new Set(truth.files);
  const top5 = new Set(ranked.slice(0, TOP5));
  const top15 = new Set(ranked.slice(0, TOP15));
  const in5 = truth.files.filter((file) => top5.has(file)).length;
  const in15 = truth.files.filter((file) => top15.has(file)).length;
  const firstIndex = ranked.findIndex((file) => truthFiles.has(file));
  const firstRank = firstIndex === -1 ? null : firstIndex + 1;
  const deepestTruth = deepestOf(truth.files);
  const deepestPack = pack.deepest;
  const packTests = new Set(pack.tests);
  const testsIn = truth.tests.filter((test) => packTests.has(test)).length;
  return {
    at: truth.at,
    truth: truth.files,
    truthTests: truth.tests,
    ranked,
    recall5: truth.files.length === 0 ? 0 : in5 / truth.files.length,
    recall15: truth.files.length === 0 ? 0 : in15 / truth.files.length,
    precision5: in5 / TOP5,
    firstRank,
    reciprocalRank: firstRank === null ? 0 : 1 / firstRank,
    deepestTruth,
    deepestPack,
    deepestMatch: deepestTruth === null ? null : deepestTruth === deepestPack,
    testRecall: truth.tests.length === 0 ? null : testsIn / truth.tests.length,
  };
}

export interface SetSummary {
  readonly set: 'tuning' | 'held-out';
  readonly resolver: 'git' | 'graph';
  readonly cases: number; // status ok
  readonly skipped: number; // other statuses
  readonly recall5: number;
  readonly recall15: number;
  readonly precision5: number;
  readonly mrr: number;
  readonly deepest: { readonly right: number; readonly of: number }; // cases with deepestMatch not null
  readonly testRecall: number | null; // mean over cases with testRecall not null
  readonly seconds: number; // mean
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * One summary per (set, resolver) present in the results, in the order tuning then held-out,
 * git then graph. Only the cases with status ok enter the means; the others are counted as skipped.
 */
export function summarize(results: readonly CaseResult[]): SetSummary[] {
  const out: SetSummary[] = [];
  for (const set of SETS) {
    for (const resolver of RESOLVERS) {
      const group = results.filter((r) => r.set === set && r.resolver === resolver);
      if (group.length === 0) continue;
      const ok = group.filter((r) => r.status === 'ok');
      const deepestCases = ok.filter((r) => r.deepestMatch !== null);
      const tests = ok.flatMap((r) => (r.testRecall === null ? [] : [r.testRecall]));
      out.push({
        set,
        resolver,
        cases: ok.length,
        skipped: group.length - ok.length,
        recall5: mean(ok.map((r) => r.recall5)),
        recall15: mean(ok.map((r) => r.recall15)),
        precision5: mean(ok.map((r) => r.precision5)),
        mrr: mean(ok.map((r) => r.reciprocalRank)),
        deepest: {
          right: deepestCases.filter((r) => r.deepestMatch === true).length,
          of: deepestCases.length,
        },
        testRecall: tests.length === 0 ? null : mean(tests),
        seconds: mean(ok.map((r) => r.seconds)),
      });
    }
  }
  return out;
}

export interface RunOptions {
  readonly weights?: Partial<Weights>;
  readonly limit?: number;
}

function elapsed(started: number): number {
  return (performance.now() - started) / 1000;
}

const EMPTY_PACK: Pick<Pack, 'files' | 'deepest' | 'tests'> = {
  files: [],
  deepest: null,
  tests: [],
};

// A result with no scored pack: every score is zero, and the truth is still listed.
function unscored(
  c: Case,
  resolver: 'git' | 'graph',
  status: CaseResult['status'],
  note: string,
  truth: Truth,
  started: number,
): CaseResult {
  return {
    issue: c.issue,
    set: c.set,
    resolver,
    status,
    note,
    seconds: elapsed(started),
    ...scoreCase(truth, EMPTY_PACK),
  };
}

function scored(
  c: Case,
  resolver: 'git' | 'graph',
  truth: Truth,
  pack: Pick<Pack, 'files' | 'deepest' | 'tests'>,
  started: number,
): CaseResult {
  return {
    issue: c.issue,
    set: c.set,
    resolver,
    status: 'ok',
    note: '',
    seconds: elapsed(started),
    ...scoreCase(truth, pack),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Builds the pack of one case with the git resolver, at the parent of its fix. */
export async function runGitCase(
  cwd: string,
  c: Case,
  options: RunOptions = {},
  build: typeof buildPack = buildPack,
): Promise<CaseResult> {
  const started = performance.now();
  let truth: Truth = EMPTY_TRUTH;
  try {
    truth = truthOf(cwd, c.fixes);
    if (truth.files.length === 0) {
      return unscored(c, 'git', 'no-code-truth', 'the fixes change no code file', truth, started);
    }
    const pack = await build(cwd, c.title, c.body, c.issue, {
      at: truth.at,
      limit: options.limit ?? DEFAULT_CASE_LIMIT,
      ...(options.weights !== undefined ? { weights: options.weights } : {}),
    });
    if (pack.resolver.kind !== 'git') {
      return unscored(
        c,
        'git',
        'error',
        `expected the git resolver at ${truth.at}, got ${pack.resolver.kind}`,
        truth,
        started,
      );
    }
    return scored(c, 'git', truth, pack, started);
  } catch (error) {
    return unscored(c, 'git', 'error', messageOf(error), truth, started);
  }
}

export interface GraphDeps {
  addWorktree(cwd: string, at: string, issue: number): string; // returns the path
  index(path: string): void;
  build(path: string, c: Case, options: RunOptions): Promise<Pack>;
  deleteProject(path: string): void;
  removeWorktree(cwd: string, path: string): void;
}

// The code graph's command line. A non-zero exit throws.
function graphCli(args: readonly string[]): string {
  return execFileSync('codebase-memory-mcp', ['cli', '--quiet', ...args], {
    encoding: 'utf8',
    maxBuffer: 256 << 20,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export const realGraphDeps: GraphDeps & SweepDeps = {
  addWorktree(cwd, at, issue) {
    const short = git(cwd, 'rev-parse', '--verify', '--short', `${at}^{commit}`).trim();
    const path = mkdtempSync(join(tmpdir(), `${STALE_PREFIX}${issue}-${short}-`));
    if (!isAbsolute(path) || path.split(sep).some((part) => part.startsWith('-'))) {
      rmSync(path, { recursive: true, force: true });
      throw new Error(`scope:backtest: refusing worktree path ${path}`);
    }
    try {
      execFileSync('git', ['worktree', 'add', '--detach', path, at], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      rmSync(path, { recursive: true, force: true });
      throw error;
    }
    return path;
  },
  index(path) {
    graphCli(['index_repository', '--repo-path', path]);
  },
  build(path, c, options) {
    return buildPack(path, c.title, c.body, c.issue, {
      limit: options.limit ?? DEFAULT_CASE_LIMIT,
      ...(options.weights !== undefined ? { weights: options.weights } : {}),
    });
  },
  deleteProject(path) {
    const real = realpathSync(path);
    const project = parseListProjects(graphCli(['list_projects'])).find(
      (p) => p.rootPath === path || p.rootPath === real,
    );
    if (project === undefined) return; // not indexed: nothing to delete
    graphCli(['delete_project', '--project', project.name]);
  },
  removeWorktree(cwd, path) {
    execFileSync('git', ['worktree', 'remove', '--force', path], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSync('git', ['worktree', 'prune'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  },
  listWorktrees(cwd) {
    return git(cwd, 'worktree', 'list', '--porcelain')
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.slice('worktree '.length));
  },
};

export interface SweepDeps {
  listWorktrees(cwd: string): string[];
  removeWorktree(cwd: string, path: string): void;
  deleteProject(path: string): void;
}

/**
 * Removes the scratch worktrees an interrupted graph run left: each worktree directly under
 * os.tmpdir() whose base name starts with `scope-bt-`. The graph project of a worktree is deleted
 * first, while its directory still exists. A failure to delete the project (for example, none was
 * indexed) does not stop the removal. Returns the number of worktrees removed.
 */
export function sweepStale(cwd: string, deps: SweepDeps): number {
  const tmp = resolve(tmpdir());
  let removed = 0;
  for (const path of deps.listWorktrees(cwd)) {
    if (dirname(resolve(path)) !== tmp || !basename(path).startsWith(STALE_PREFIX)) continue;
    try {
      deps.deleteProject(path);
    } catch {
      // No project to delete, or its directory is already gone: the worktree is still removed.
    }
    deps.removeWorktree(cwd, path);
    removed++;
  }
  return removed;
}

/**
 * Builds the pack of one case with the code graph, on a fresh detached worktree of its parent
 * revision. The project and the worktree are removed in a finally, also when the build fails.
 */
export async function runGraphCase(
  cwd: string,
  c: Case,
  options: RunOptions = {},
  deps: GraphDeps = realGraphDeps,
): Promise<CaseResult> {
  const started = performance.now();
  let truth: Truth;
  try {
    truth = truthOf(cwd, c.fixes);
  } catch (error) {
    return unscored(c, 'graph', 'error', messageOf(error), EMPTY_TRUTH, started);
  }
  if (truth.files.length === 0) {
    return unscored(c, 'graph', 'no-code-truth', 'the fixes change no code file', truth, started);
  }

  let worktree: string | undefined;
  let pack: Pack | undefined;
  let failure: string | undefined;
  const cleanup: string[] = [];
  try {
    worktree = deps.addWorktree(cwd, truth.at, c.issue);
    deps.index(worktree);
    pack = await deps.build(worktree, c, options);
  } catch (error) {
    failure = messageOf(error);
  } finally {
    if (worktree !== undefined) {
      try {
        deps.deleteProject(worktree);
      } catch (error) {
        cleanup.push(`deleteProject: ${messageOf(error)}`);
      }
      try {
        deps.removeWorktree(cwd, worktree);
      } catch (error) {
        cleanup.push(`removeWorktree: ${messageOf(error)}`);
      }
    }
  }

  const cleanupNote = cleanup.length === 0 ? '' : `; cleanup failed: ${cleanup.join('; ')}`;
  if (failure !== undefined)
    return unscored(c, 'graph', 'error', failure + cleanupNote, truth, started);
  if (pack === undefined || pack.resolver.kind !== 'graph') {
    const why = pack === undefined ? 'no pack was built' : pack.resolver.note;
    return unscored(c, 'graph', 'graph-unavailable', why + cleanupNote, truth, started);
  }
  if (cleanup.length > 0) {
    return unscored(c, 'graph', 'error', cleanup.join('; '), truth, started);
  }
  return scored(c, 'graph', truth, pack, started);
}

/**
 * The cases a closed issue can become: an issue not in `known` that `issueFixes` finds a fix for,
 * whose fix changed a code file. The caller passes `history` without the noisy commits (see
 * proposeFromHistory). The set is `tuning` for an even issue number and `held-out` for an odd one.
 */
export function proposeCases(
  issues: ReadonlyArray<{ readonly number: number; readonly title: string; readonly body: string }>,
  history: readonly HistoryCommit[],
  known: ReadonlySet<number>,
): Case[] {
  const fixes = new Map(issueFixes(history, new Set()).map((fix) => [fix.issue, fix]));
  const time = new Map(history.map((commit) => [commit.sha, commit.time]));
  const out: Case[] = [];
  for (const issue of issues) {
    if (known.has(issue.number)) continue;
    const fix = fixes.get(issue.number);
    if (fix === undefined) continue;
    const code = fix.files.filter((file) => isSourcePath(file) && !file.startsWith('journeys/'));
    if (code.length === 0) continue;
    const oldestFirst = [...fix.commits].sort((a, b) => (time.get(a) ?? 0) - (time.get(b) ?? 0));
    out.push({
      issue: issue.number,
      set: issue.number % 2 === 0 ? 'tuning' : 'held-out',
      fixes: oldestFirst.map((sha) => sha.slice(0, 7)),
      title: issue.title,
      body: issue.body,
    });
  }
  return out;
}

/**
 * The cases `collect` proposes: the history at HEAD of `root` with its noisy commits removed (a
 * commit over MAX_FILES files, an ignored reformat or a changelog regeneration), then proposeCases.
 */
export function proposeFromHistory(
  root: string,
  issues: ReadonlyArray<{ readonly number: number; readonly title: string; readonly body: string }>,
  known: ReadonlySet<number>,
): Case[] {
  const history = readHistory(root, 'HEAD');
  const noisy = noisyCommits(root, 'HEAD', history);
  return proposeCases(
    issues,
    history.filter((commit) => !noisy.has(commit.sha)),
    known,
  );
}

function shortFile(file: string): string {
  return file.replace(/^src\//, '');
}

function num(value: number): string {
  return value.toFixed(3);
}

export interface ReportHeader {
  readonly head: string; // the short HEAD the report was made at
  readonly weights: string; // 'default', or the name of the override file
}

/** The Markdown report: a table per resolver, every case, and the cases not scored. */
export function formatReport(
  results: readonly CaseResult[],
  header: ReportHeader = { head: 'unknown', weights: 'default' },
): string {
  const lines: string[] = [];
  lines.push('# Scope backtest', '');
  const issues = new Set(results.map((r) => r.issue)).size;
  const extra = issues === results.length ? '' : ` · ${results.length} results`;
  lines.push(`at ${header.head} · ${issues} cases${extra} · weights: ${header.weights}`, '');

  const summaries = summarize(results);
  for (const resolver of RESOLVERS) {
    const rows = summaries.filter((s) => s.resolver === resolver);
    if (rows.length === 0) continue;
    lines.push(`## Scores: ${resolver} resolver`, '');
    lines.push('| Set | Cases | recall@5 | recall@15 | MRR | P@5 | deepest | tests | s/case |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const s of rows) {
      const cases = s.skipped > 0 ? `${s.cases} (+${s.skipped} skipped)` : `${s.cases}`;
      lines.push(
        `| ${s.set} | ${cases} | ${num(s.recall5)} | ${num(s.recall15)} | ${num(s.mrr)} | ${num(s.precision5)} | ${s.deepest.right}/${s.deepest.of} | ${s.testRecall === null ? '-' : num(s.testRecall)} | ${num(s.seconds)} |`,
      );
    }
    lines.push('');
  }

  lines.push('## Cases', '');
  lines.push(
    '| Issue | Set | Resolver | Status | recall@5 | recall@15 | First | Deepest truth/pack | Truth | Top 5 |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of results) {
    const ok = r.status === 'ok';
    const truth = new Set(r.truth);
    const top = r.ranked
      .slice(0, TOP5)
      .map((file) => `${truth.has(file) ? '*' : ''}${shortFile(file)}`)
      .join(', ');
    lines.push(
      `| #${r.issue} | ${r.set} | ${r.resolver} | ${r.status} | ${ok ? num(r.recall5) : '-'} | ${ok ? num(r.recall15) : '-'} | ${ok && r.firstRank !== null ? r.firstRank : '-'} | ${r.deepestTruth ?? '-'}/${r.deepestPack ?? '-'} | ${r.truth.map(shortFile).join(', ') || '-'} | ${ok ? top || '-' : '-'} |`,
    );
  }
  lines.push('');

  lines.push('## Not scored', '');
  const skipped = results.filter((r) => r.status !== 'ok');
  if (skipped.length === 0) {
    lines.push('None.', '');
  } else {
    for (const r of skipped) lines.push(`- #${r.issue} (${r.resolver}, ${r.status}): ${r.note}`);
    lines.push('');
  }
  return lines.join('\n');
}
