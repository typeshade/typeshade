// ═══ SZZ: which commits introduced the lines a fix commit changed ═══
//
// SZZ (Śliwerski, Zimmermann and Zeller, "When do changes induce fixes?", MSR 2005) starts from a
// bug fix and asks which earlier commits put the buggy lines into the code. This script runs it
// over this repository's own history, so a fix that touched a line can name the commit that
// wrote that line.
//
// The algorithm:
//
//   1. Find the fix commits: the non-merge commits whose subject is a Conventional Commits `fix`.
//   2. For each fix F, take the source lines F deletes or modifies: the `-` lines of
//      `git diff -U0 F^ F`, with whitespace-only changes ignored (`-w`).
//   3. Blame those lines at F^ (`git blame --porcelain -w -M -C`). The commits blame names are the
//      candidates that introduced the lines the fix changed.
//
// Refinements from the follow-up literature:
//
//   AG-SZZ (Kim et al., ASE 2006)   whitespace changes are ignored on the fix side (`git diff -w`)
//                                   and the history side (`git blame -w`); blank lines and
//                                   comment-only lines are not blamed.
//   MA-SZZ (da Costa et al., TSE 2017)
//                                   a merge commit is no fix; `.git-blame-ignore-revs` and
//                                   `--ignore-rev` are honoured; a line that reaches the history
//                                   boundary (a root commit, or the edge of a shallow clone) is
//                                   reported apart from the candidates.
//   Move and copy detection         `git blame -M -C` traces code moved between files to its origin.
//   Source files only               a change to a test, a golden, a fixture or a document is no
//                                   bug fix in code (`--all-files` lifts this).
//
// Not done: the issue-date filter of the original paper (drop candidates committed after the bug
// was reported). That filter needs issue data from GitHub, and this script reads git only.
//
// Context: the root commit of this repository (`b47ab15`) imported the code extracted from the
// X-GIS monorepo. A line older than that extraction reaches the history boundary.
//
// This is a report, not a CI gate. CI does not run it.
//
// Usage, from the repository root:
//   bun run szz
//   bun scripts/szz.ts [--fix <rev>]... [--range <rev-range>] [--since <date>] [--limit <n>]
//                      [--ignore-rev <rev>]... [--all-files] [--json | --markdown]

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface Commit {
  readonly sha: string; // full hex sha
  readonly parents: readonly string[];
  readonly date: string; // author date, strict ISO 8601 (`%aI`)
  readonly subject: string;
  readonly pr: number | null; // the LAST `(#N)` in the subject, else null
}

export interface RemovedLine {
  readonly line: number; // 1-based line number in the OLD file (the fix's parent)
  readonly text: string; // the line without its leading '-'
}

export interface BlamedLine {
  readonly line: number; // the final line number blame reports
  readonly sha: string;
  readonly boundary: boolean; // the commit carries `boundary` in the porcelain stream
}

export interface Candidate {
  readonly commit: Commit;
  readonly lines: number; // how many blamed lines name this commit
  readonly files: readonly string[]; // old-side paths, sorted, unique
}

export type FixStatus = 'analyzed' | 'no-removed-lines' | 'merge' | 'root';

export interface FixResult {
  readonly fix: Commit;
  readonly status: FixStatus;
  readonly blamedLines: number; // lines handed to blame (after every filter)
  readonly boundaryLines: number; // of those, lines blame attributes to a boundary commit
  readonly candidates: readonly Candidate[];
}

export interface SzzOptions {
  readonly allFiles?: boolean; // skip the source-file filter
  readonly ignoreRevs?: readonly string[]; // revs blame skips, as `--ignore-rev`
}

export interface FindOptions {
  readonly range?: string; // default 'HEAD'
  readonly since?: string; // passed to git log as --since=<value>
}

export interface Summary {
  readonly fixes: number; // results.length
  readonly withCandidates: number; // status 'analyzed' and candidates.length > 0
  readonly boundaryOnly: number; // status 'analyzed', no candidates, boundaryLines > 0
  readonly noRemovedLines: number; // status 'no-removed-lines'
  readonly skipped: number; // status 'merge' or 'root'
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 << 20,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

// A commit is named by its sha, which is content-addressed: one sha is one commit in any clone.
const commitCache = new Map<string, Commit>();

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const BLAME_HEADER = /^([0-9a-f]{40,64}) (\d+) (\d+)(?: (\d+))?$/;
const SOURCE_EXTENSION = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const NON_SOURCE_SEGMENTS = new Set([
  '__emit-goldens__',
  '__render-goldens__',
  '__api__',
  'fixtures',
]);

/** True when the subject is a Conventional Commits `fix`. */
export function isFixSubject(subject: string): boolean {
  return /^fix(\([^)]*\))?!?:/i.test(subject);
}

/** True for a TypeScript or JavaScript source file that is not a test, a golden or a fixture. */
export function isSourcePath(path: string): boolean {
  if (!SOURCE_EXTENSION.test(path)) return false;
  const segments = path.split('/');
  if ((segments[segments.length - 1] ?? '').includes('.test.')) return false;
  return !segments.some((segment) => NON_SOURCE_SEGMENTS.has(segment));
}

/** False for a blank line and for a comment-only line. */
export function isMeaningfulLine(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return false;
  return !(trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*'));
}

/**
 * The removed lines of a `git diff -U0` output, keyed by the OLD-side path. A file with no removed
 * line has no key. A file added (`--- /dev/null`) has no old path, so its lines are not recorded.
 */
export function removedLines(diff: string): Map<string, RemovedLine[]> {
  const out = new Map<string, RemovedLine[]>();
  let inHunk = false;
  let oldPath: string | null = null;
  let counter = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      inHunk = false;
      oldPath = null;
      continue;
    }
    const hunk = HUNK.exec(raw);
    if (hunk) {
      inHunk = true;
      counter = Number(hunk[1]);
      continue;
    }
    if (!inHunk) {
      // File header: `--- a/<path>` names the old side; `+++` and the rest carry nothing needed.
      if (raw.startsWith('--- ')) {
        const named = raw.slice(4).replace(/\t$/, '');
        if (named === '/dev/null') oldPath = null;
        else oldPath = named.startsWith('a/') ? named.slice(2) : named;
      }
      continue;
    }
    // Inside a hunk: `-` removes an old line, ` ` keeps one, `+` and `\` move nothing on the old side.
    if (raw.startsWith('-')) {
      if (oldPath !== null) {
        const list = out.get(oldPath) ?? [];
        list.push({ line: counter, text: raw.slice(1) });
        out.set(oldPath, list);
      }
      counter++;
    } else if (raw.startsWith(' ')) {
      counter++;
    }
  }
  return out;
}

/** Merge sorted, de-duplicated line numbers into inclusive `[start, end]` ranges. */
export function toRanges(lines: readonly number[]): Array<[number, number]> {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const out: Array<[number, number]> = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && n === last[1] + 1) last[1] = n;
    else out.push([n, n]);
  }
  return out;
}

/** Parse `git blame --porcelain`: one entry per blamed line, in stream order. */
export function parseBlame(porcelain: string): BlamedLine[] {
  const entries: Array<{ line: number; sha: string }> = [];
  const boundaries = new Set<string>();
  let current: string | null = null;
  for (const raw of porcelain.split('\n')) {
    if (raw.startsWith('\t')) {
      // The content line ends the entry.
      current = null;
      continue;
    }
    const header = BLAME_HEADER.exec(raw);
    if (header) {
      current = header[1] ?? '';
      entries.push({ line: Number(header[3]), sha: current });
      continue;
    }
    if (raw === 'boundary' && current !== null) boundaries.add(current);
  }
  return entries.map((entry) => ({
    line: entry.line,
    sha: entry.sha,
    boundary: boundaries.has(entry.sha),
  }));
}

/** The number in the last `(#N)` of a subject, else null. */
export function prNumber(subject: string): number | null {
  const matches = [...subject.matchAll(/\(#(\d+)\)/g)];
  const last = matches[matches.length - 1];
  return last === undefined ? null : Number(last[1]);
}

/** Read one commit. A commit is read once per run. */
export function readCommit(cwd: string, rev: string): Commit {
  const fields = git(cwd, 'show', '-s', '--format=%H%x00%P%x00%aI%x00%s', rev).split('\0');
  const sha = fields[0] ?? '';
  const cached = commitCache.get(sha);
  if (cached !== undefined) return cached;
  const subject = (fields[3] ?? '').replace(/\n$/, '');
  const commit: Commit = {
    sha,
    parents: (fields[1] ?? '').split(' ').filter((parent) => parent !== ''),
    date: fields[2] ?? '',
    subject,
    pr: prNumber(subject),
  };
  commitCache.set(sha, commit);
  return commit;
}

/** The fix commits reachable from `range` (default HEAD), newest first, merges left out. */
export function findFixes(cwd: string, options: FindOptions = {}): string[] {
  const args = ['log', '--no-merges', '--format=%H%x00%s'];
  if (options.since !== undefined) args.push(`--since=${options.since}`);
  args.push(options.range ?? 'HEAD', '--');
  const fixes: string[] = [];
  for (const line of git(cwd, ...args).split('\n')) {
    if (line === '') continue;
    const separator = line.indexOf('\0');
    const sha = line.slice(0, separator);
    const subject = line.slice(separator + 1);
    if (isFixSubject(subject)) fixes.push(sha);
  }
  return fixes;
}

function bareResult(fix: Commit, status: FixStatus): FixResult {
  return { fix, status, blamedLines: 0, boundaryLines: 0, candidates: [] };
}

/** Compare by date, newest first. */
function newestFirst(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? 1 : -1;
}

/** Analyse one fix commit: the commits that introduced the lines it removes or modifies. */
export function analyzeFix(cwd: string, rev: string, options: SzzOptions = {}): FixResult {
  const fix = readCommit(cwd, rev);
  if (fix.parents.length > 1) return bareResult(fix, 'merge');
  const parent = fix.parents[0];
  if (parent === undefined) return bareResult(fix, 'root');

  const removed = removedLines(
    git(
      cwd,
      'diff',
      '-U0',
      '-w',
      '--no-color',
      '--no-ext-diff',
      '-M',
      '--diff-filter=MRD',
      parent,
      fix.sha,
      '--',
    ),
  );

  const targets: Array<{ path: string; lines: number[] }> = [];
  for (const path of [...removed.keys()].sort()) {
    if (!options.allFiles && !isSourcePath(path)) continue;
    const lines = (removed.get(path) ?? [])
      .filter((removedLine) => isMeaningfulLine(removedLine.text))
      .map((removedLine) => removedLine.line);
    if (lines.length > 0) targets.push({ path, lines });
  }
  if (targets.length === 0) return bareResult(fix, 'no-removed-lines');

  // An unknown rev throws here, which is correct.
  const ignoreRevArgs = (options.ignoreRevs ?? []).flatMap((rev) => [
    '--ignore-rev',
    git(cwd, 'rev-parse', '--verify', `${rev}^{commit}`).trim(),
  ]);
  const top = git(cwd, 'rev-parse', '--show-toplevel').trim();
  const ignoreFile = join(top, '.git-blame-ignore-revs');
  const ignoreFileArgs = existsSync(ignoreFile) ? ['--ignore-revs-file', ignoreFile] : [];

  let blamedLines = 0;
  let boundaryLines = 0;
  const byCommit = new Map<string, { lines: number; files: Set<string> }>();
  for (const { path, lines } of targets) {
    const rangeArgs = toRanges(lines).flatMap(([start, end]) => ['-L', `${start},${end}`]);
    const porcelain = git(
      cwd,
      'blame',
      '--porcelain',
      '-w',
      '-M',
      '-C',
      ...ignoreFileArgs,
      ...ignoreRevArgs,
      ...rangeArgs,
      parent,
      '--',
      path,
    );
    for (const entry of parseBlame(porcelain)) {
      blamedLines++;
      if (entry.boundary) {
        boundaryLines++;
        continue;
      }
      const acc = byCommit.get(entry.sha) ?? { lines: 0, files: new Set<string>() };
      acc.lines++;
      acc.files.add(path);
      byCommit.set(entry.sha, acc);
    }
  }

  const candidates: Candidate[] = [...byCommit].map(([sha, acc]) => ({
    commit: readCommit(cwd, sha),
    lines: acc.lines,
    files: [...acc.files].sort(),
  }));
  candidates.sort(
    (a, b) =>
      b.lines - a.lines ||
      newestFirst(a.commit.date, b.commit.date) ||
      (a.commit.sha < b.commit.sha ? -1 : a.commit.sha > b.commit.sha ? 1 : 0),
  );
  return { fix, status: 'analyzed', blamedLines, boundaryLines, candidates };
}

/** Analyse each rev in `fixes`, in the given order. */
export function szz(cwd: string, fixes: readonly string[], options: SzzOptions = {}): FixResult[] {
  return fixes.map((rev) => analyzeFix(cwd, rev, options));
}

/** Count the results by outcome. */
export function summarize(results: readonly FixResult[]): Summary {
  let withCandidates = 0;
  let boundaryOnly = 0;
  let noRemovedLines = 0;
  let skipped = 0;
  for (const result of results) {
    if (result.status === 'analyzed') {
      if (result.candidates.length > 0) withCandidates++;
      else if (result.boundaryLines > 0) boundaryOnly++;
    } else if (result.status === 'no-removed-lines') {
      noRemovedLines++;
    } else {
      skipped++;
    }
  }
  return {
    fixes: results.length,
    withCandidates,
    boundaryOnly,
    noRemovedLines,
    skipped,
  };
}

function summarySentence(results: readonly FixResult[]): string {
  const s = summarize(results);
  return (
    `SZZ over ${s.fixes} fix commits: ${s.withCandidates} traced to a candidate, ` +
    `${s.boundaryOnly} only to the history boundary, ${s.noRemovedLines} that remove no source ` +
    `line, ${s.skipped} skipped.`
  );
}

function plural(count: number, word: string): string {
  return count === 1 ? `${count} ${word}` : `${count} ${word}s`;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function textBlock(result: FixResult): string {
  const lines = [`fix ${shortSha(result.fix.sha)} ${result.fix.subject}`];
  if (result.status === 'no-removed-lines') lines.push('  removes no source line');
  else if (result.status === 'merge') lines.push('  skipped: a merge commit');
  else if (result.status === 'root') lines.push('  skipped: a root commit');
  for (const candidate of result.candidates) {
    lines.push(
      `  <- ${shortSha(candidate.commit.sha)} ${plural(candidate.lines, 'line')} ` +
        `${candidate.commit.date.slice(0, 10)} ${candidate.commit.subject}`,
    );
  }
  if (result.boundaryLines > 0) {
    const verb = result.boundaryLines === 1 ? 'reaches' : 'reach';
    lines.push(`  ${plural(result.boundaryLines, 'line')} ${verb} the history boundary`);
  }
  return lines.join('\n');
}

/** The plain-text report: the summary sentence, then one block per fix. */
export function formatText(results: readonly FixResult[]): string {
  return [summarySentence(results), ...results.map(textBlock)].join('\n\n') + '\n';
}

function cell(subject: string): string {
  return subject.replace(/\|/g, '\\|');
}

/** The Markdown report: the summary sentence, then one table row per candidate. */
export function formatMarkdown(results: readonly FixResult[]): string {
  const rows: string[] = [];
  for (const result of results) {
    const fixCell = `\`${shortSha(result.fix.sha)}\` ${cell(result.fix.subject)}`;
    if (result.candidates.length > 0) {
      for (const candidate of result.candidates) {
        rows.push(
          `| ${fixCell} | \`${shortSha(candidate.commit.sha)}\` ${cell(candidate.commit.subject)} ` +
            `| ${candidate.lines} | ${candidate.files.map((f) => `\`${f}\``).join(', ')} |`,
        );
      }
      continue;
    }
    let status: string;
    if (result.status === 'no-removed-lines') status = 'removes no source line';
    else if (result.status === 'merge') status = 'skipped: a merge commit';
    else if (result.status === 'root') status = 'skipped: a root commit';
    else if (result.boundaryLines > 0) status = 'history boundary';
    else status = 'no candidate';
    rows.push(`| ${fixCell} | ${status} | 0 |  |`);
  }
  return (
    [
      summarySentence(results),
      '',
      '| Fix | Introducing commit | Lines | Files |',
      '| --- | --- | ---: | --- |',
      ...rows,
    ].join('\n') + '\n'
  );
}

const USAGE = `usage: bun scripts/szz.ts [--fix <rev>]... [--range <rev-range>] [--since <date>]
                   [--limit <n>] [--ignore-rev <rev>]... [--all-files] [--json | --markdown]
`;

function usageError(message: string): number {
  process.stderr.write(`${message}\n${USAGE}`);
  return 2;
}

function main(argv: readonly string[]): number {
  const fixes: string[] = [];
  const ignoreRevs: string[] = [];
  let range: string | undefined;
  let since: string | undefined;
  let limit: number | undefined;
  let allFiles = false;
  let format: 'text' | 'json' | 'markdown' = 'text';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    switch (arg) {
      case '--help':
        process.stdout.write(USAGE);
        return 0;
      case '--all-files':
        allFiles = true;
        break;
      case '--json':
        format = 'json';
        break;
      case '--markdown':
        format = 'markdown';
        break;
      case '--fix':
      case '--range':
      case '--since':
      case '--limit':
      case '--ignore-rev': {
        const value = argv[i + 1];
        if (value === undefined) return usageError(`szz: ${arg} needs a value`);
        i++;
        if (arg === '--fix') fixes.push(value);
        else if (arg === '--range') range = value;
        else if (arg === '--since') since = value;
        else if (arg === '--ignore-rev') ignoreRevs.push(value);
        else {
          const parsed = Number(value);
          if (!Number.isInteger(parsed) || parsed < 0) {
            return usageError(`szz: --limit needs a whole number, got ${value}`);
          }
          limit = parsed;
        }
        break;
      }
      default:
        return usageError(`szz: unknown option ${arg}`);
    }
  }

  const top = git(process.cwd(), 'rev-parse', '--show-toplevel').trim();
  if (git(top, 'rev-parse', '--is-shallow-repository').trim() === 'true') {
    process.stderr.write(
      'szz: this clone is shallow, so lines older than its edge count as history boundary; ' +
        'run git fetch --unshallow for the full history.\n',
    );
  }

  let revs: string[];
  if (fixes.length > 0) {
    revs = fixes;
  } else {
    const found = findFixes(top, { range, since });
    revs = limit === undefined ? found : found.slice(0, limit);
  }
  const results = szz(top, revs, { allFiles, ignoreRevs });

  if (format === 'json') {
    process.stdout.write(JSON.stringify({ summary: summarize(results), results }, null, 2) + '\n');
  } else if (format === 'markdown') {
    process.stdout.write(formatMarkdown(results));
  } else {
    process.stdout.write(formatText(results));
  }
  return 0;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
