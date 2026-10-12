// ═══ History: what the repository's past says about a change ═══
//
// The context pack (`bun run scope`) asks the history four questions: which proposals touched a
// file, which past issues were fixed in the same files, which files change together, and which
// past fixes changed a file. This module reads the history once, at one revision, and answers
// all four from that one read.
//
// Every function reads git only, and only at the revision the caller names (`at`). Nothing here
// reads the working tree. A git failure throws; no function turns one into an empty result.
//
// Noisy commits are left out of the statistics. A commit is noisy when it touches more than
// MAX_FILES files (a mechanical rename or a reformat), when `.git-blame-ignore-revs` lists it at
// `at`, or when its subject starts with `chore(changelog)`. Co-change and the footprints of the
// proposals and the issues ignore noisy commits. Past fixes in a file do not, because a fix in
// a file is a fact about that file.
//
// Issue numbers. The root commit (`b47ab15`) imported the code from the X-GIS monorepo, and the
// commits before the repository's own numbering (OWN_NUMBERING_SINCE) carry that monorepo's
// issue and pull request numbers. The issue numbers of those commits are not used, so issueFixes
// returns nothing for them.
//
// Usage: imported by scripts/scope/pack.ts and scripts/scope.ts. It has no command line.

import { execFileSync } from 'node:child_process';
import { ENGLISH_STOPWORDS, STOPWORDS } from './seeds.js';
import { isFixSubject, unquotePath } from '../szz.js';

export interface HistoryCommit {
  readonly sha: string;
  readonly time: number; // author time, Unix seconds
  readonly subject: string;
  readonly body: string;
  readonly files: readonly string[];
}

export interface Proposal {
  readonly id: string; // '0044'
  readonly path: string; // changes/0044-bitcast-vector-forms.md
  readonly title: string;
  readonly status: string;
  readonly rules: readonly string[];
  readonly surface: readonly number[];
  readonly exports: readonly string[];
  readonly codes: readonly string[];
  readonly examples: readonly string[];
  readonly downstream: ReadonlyArray<{ readonly repo: string; readonly what: string }>;
  readonly text: string; // the body after the front matter
  readonly commits: readonly string[]; // implementing commits, newest first
  readonly files: readonly string[]; // union of their files, sorted, the proposal file itself excluded
}

export interface IssueFix {
  readonly issue: number;
  readonly commits: readonly string[];
  readonly text: string;
  readonly files: readonly string[];
}

export interface Partner {
  readonly file: string;
  readonly together: number;
  readonly confidence: number;
}

// A commit that touches more files than this is a mechanical change, not a change to its files.
export const MAX_FILES = 40;

// Unix seconds of 2026-09-14T00:00:00+09:00: the first commit that uses this repository's own
// issue numbering.
export const OWN_NUMBERING_SINCE = 1789311600;

const RECORD = '\x1e';
const FIELD = '\x1f';
const IGNORE_REVS_FILE = '.git-blame-ignore-revs';

/** Run git in a directory with the output captured. A non-zero exit throws. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 << 20,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Every non-merge commit reachable from `at`, newest first, with the files it changed. The
 * format puts a record separator before each commit and a field separator after each field;
 * the file names follow the last field, one per line.
 */
export function readHistory(cwd: string, at: string): HistoryCommit[] {
  const out = git(
    cwd,
    'log',
    '--no-merges',
    `--format=${RECORD}%H${FIELD}%at${FIELD}%s${FIELD}%b${FIELD}`,
    '--name-only',
    at,
    '--',
  );
  const commits: HistoryCommit[] = [];
  for (const record of out.split(RECORD)) {
    if (record.trim() === '') continue;
    const fields = record.split(FIELD);
    if (fields.length < 5)
      throw new Error(`git log: malformed record ${JSON.stringify(record.slice(0, 80))}`);
    const [sha, timeText, subject, body] = fields as [string, string, string, string];
    const time = Number(timeText);
    if (!/^[0-9a-f]{40,64}$/.test(sha) || !Number.isFinite(time)) {
      throw new Error(`git log: malformed commit header ${JSON.stringify(sha)}`);
    }
    const files = fields
      .slice(4)
      .join(FIELD)
      .split('\n')
      .map((line) => unquotePath(line.trim()))
      .filter((line) => line !== '');
    commits.push({ sha, time, subject, body: body.trim(), files });
  }
  return commits;
}

/**
 * The commits to leave out of the statistics: a commit that touches more than MAX_FILES files,
 * a commit that `.git-blame-ignore-revs` lists at `at`, and a `chore(changelog)` commit. The set
 * holds the shas of the history given, not of every name in the ignore file.
 */
export function noisyCommits(
  cwd: string,
  at: string,
  history: readonly HistoryCommit[],
): Set<string> {
  const ignored = readIgnoreRevs(cwd, at);
  const noisy = new Set<string>();
  for (const commit of history) {
    if (
      commit.files.length > MAX_FILES ||
      commit.subject.startsWith('chore(changelog)') ||
      ignored.some((rev) => commit.sha.startsWith(rev))
    ) {
      noisy.add(commit.sha);
    }
  }
  return noisy;
}

// The ignore file is read with `ls-tree`, not `cat-file -e`: `ls-tree` exits 0 for an absent
// path and prints nothing, so an absent file is no error, and a bad `at` still throws.
function readIgnoreRevs(cwd: string, at: string): string[] {
  const listed = git(cwd, 'ls-tree', '--name-only', at, '--', IGNORE_REVS_FILE).trim();
  if (listed === '') return [];
  return git(cwd, 'show', `${at}:${IGNORE_REVS_FILE}`)
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((rev) => /^[0-9a-f]{7,64}$/.test(rev));
}

/**
 * The proposals at `at` (`changes/NNNN-*.md`), with the implementing commits found in the
 * history: a commit whose body has a `Change: NNNN` line, or whose subject has `(NNNN)` or
 * `NNNN step`. The front matter is parsed with the small reader below, which covers the shape
 * `changes/README.md` shows. A proposal with no front matter throws.
 */
export function readProposals(
  cwd: string,
  at: string,
  history: readonly HistoryCommit[],
  noisy: ReadonlySet<string>,
): Proposal[] {
  const listing = git(cwd, 'ls-tree', '--name-only', at, 'changes/');
  const paths = listing
    .split('\n')
    .filter((path) => /^changes\/\d{4}-[^/]*\.md$/.test(path))
    .sort();
  return paths.map((path) => {
    const id = /^changes\/(\d{4})-/.exec(path)?.[1] ?? '';
    const text = git(cwd, 'show', `${at}:${path}`);
    const { fields, body } = frontMatter(path, text);
    const commits = history
      .filter((commit) => !noisy.has(commit.sha) && namesProposal(commit, id))
      .map((commit) => commit.sha);
    const files = [
      ...new Set(
        history
          .filter((commit) => commits.includes(commit.sha))
          .flatMap((commit) => commit.files)
          .filter((file) => file !== path),
      ),
    ].sort();
    return {
      id,
      path,
      title: scalarField(path, fields, 'title'),
      status: scalarField(path, fields, 'status'),
      rules: listField(path, fields, 'rules').map(String),
      surface: listField(path, fields, 'surface').map((value) => {
        const number = Number(value);
        if (!Number.isInteger(number)) throw new Error(`${path}: surface ${value} is not a number`);
        return number;
      }),
      exports: [
        ...listField(path, fields, 'exports'),
        ...listField(path, fields, 'exports-removed'),
      ].map(String),
      codes: listField(path, fields, 'codes').map(String),
      examples: listField(path, fields, 'examples').map(String),
      downstream: recordField(path, fields, 'downstream').map((entry) => ({
        repo: entry.repo ?? '',
        what: entry.what ?? '',
      })),
      text: body,
      commits,
      files,
    };
  });
}

// True when a commit names proposal `id`: a `Change: <id>` line in the body (a list of ids also
// counts), or `(<id>)` or `<id> step` in the subject.
function namesProposal(commit: HistoryCommit, id: string): boolean {
  if (commit.subject.includes(`(${id})`) || new RegExp(`\\b${id} step\\b`).test(commit.subject)) {
    return true;
  }
  return commit.body.split('\n').some((line) => {
    const match = /^Change:\s*(.+)$/.exec(line);
    if (match === null) return false;
    return (match[1] ?? '')
      .split(',')
      .some((segment) => new RegExp(`^${id}\\b`).test(segment.trim()));
  });
}

/**
 * The issues each commit fixes, from its subject and its body. Only commits after
 * OWN_NUMBERING_SINCE count. In a subject, every `#N` but the last one is an issue; the last
 * is the pull request. A subject with one `#N` gives no issue. A body line `Fixes #N`,
 * `Closes #N` or `Resolves #N` adds an issue.
 */
function issueNumbers(commit: HistoryCommit): number[] {
  const numbers = new Set<number>();
  const refs = [...commit.subject.matchAll(/\(([^()]*)\)/g)].flatMap((group) =>
    [...(group[1] ?? '').matchAll(/#(\d+)/g)].map((m) => Number(m[1])),
  );
  refs.slice(0, -1).forEach((n) => numbers.add(n));
  for (const line of commit.body.split('\n')) {
    const match = /^\s*(?:fixes|closes|resolves)\s+#(\d+)\b/i.exec(line);
    if (match !== null) numbers.add(Number(match[1]));
  }
  return [...numbers];
}

/**
 * The issues the history fixed, from the commits after OWN_NUMBERING_SINCE that are not noisy.
 * The result is in the order the history gives: the first issue to appear, newest first.
 * `text` joins the subjects and bodies of the commits; `files` is the sorted union of their files.
 */
export function issueFixes(
  history: readonly HistoryCommit[],
  noisy: ReadonlySet<string>,
): IssueFix[] {
  const byIssue = new Map<number, { commits: string[]; texts: string[]; files: Set<string> }>();
  for (const commit of history) {
    if (noisy.has(commit.sha) || commit.time < OWN_NUMBERING_SINCE) continue;
    for (const issue of issueNumbers(commit)) {
      const entry = byIssue.get(issue) ?? { commits: [], texts: [], files: new Set<string>() };
      entry.commits.push(commit.sha);
      entry.texts.push(`${commit.subject}\n${commit.body}`.trim());
      commit.files.forEach((file) => entry.files.add(file));
      byIssue.set(issue, entry);
    }
  }
  return [...byIssue].map(([issue, entry]) => ({
    issue,
    commits: entry.commits,
    text: entry.texts.join('\n\n'),
    files: [...entry.files].sort(),
  }));
}

/**
 * The bag of words of a text: lower-cased tokens of 3 or more letters, split on every non-letter
 * and on the humps of a camelCase or PascalCase word. Stopwords of the code and of English are
 * left out. The rules are those of the seeds' word bag.
 */
export function tokenize(text: string): string[] {
  return text
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z]+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token) && !ENGLISH_STOPWORDS.has(token));
}

interface Indexed {
  readonly id: string;
  readonly weights: ReadonlyMap<string, number>; // raw count times IDF
  readonly norm: number;
}

/**
 * Cosine similarity over TF-IDF vectors. TF is the raw count of a token; IDF is
 * `ln((1 + N) / (1 + df)) + 1`, with N the number of documents and df the number of documents
 * that hold the token. A token no document holds still counts in the query's norm.
 */
export class Similarity {
  private readonly documentCount: number;
  private readonly documentFrequency = new Map<string, number>();
  private readonly indexed: Indexed[];

  constructor(documents: ReadonlyArray<{ readonly id: string; readonly text: string }>) {
    this.documentCount = documents.length;
    const counts = documents.map((document) => countTokens(tokenize(document.text)));
    for (const count of counts) {
      for (const term of count.keys()) {
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      }
    }
    this.indexed = documents.map((document, i) => {
      const weights = this.weigh(counts[i] ?? new Map<string, number>());
      return { id: document.id, weights, norm: norm(weights) };
    });
  }

  /** The documents most similar to the query tokens, score above 0, best first, ties by id. */
  rank(query: readonly string[], limit: number): Array<{ id: string; score: number }> {
    const weights = this.weigh(countTokens(query));
    const queryNorm = norm(weights);
    if (queryNorm === 0) return [];
    const scored: Array<{ id: string; score: number }> = [];
    for (const document of this.indexed) {
      if (document.norm === 0) continue;
      let dot = 0;
      for (const [term, weight] of weights) {
        dot += weight * (document.weights.get(term) ?? 0);
      }
      const score = dot / (queryNorm * document.norm);
      if (score > 0) scored.push({ id: document.id, score });
    }
    scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return scored.slice(0, Math.max(0, limit));
  }

  private weigh(count: ReadonlyMap<string, number>): Map<string, number> {
    const weights = new Map<string, number>();
    for (const [term, n] of count) {
      const df = this.documentFrequency.get(term) ?? 0;
      const idf = Math.log((1 + this.documentCount) / (1 + df)) + 1;
      weights.set(term, n * idf);
    }
    return weights;
  }
}

function countTokens(tokens: readonly string[]): Map<string, number> {
  const count = new Map<string, number>();
  for (const token of tokens) count.set(token, (count.get(token) ?? 0) + 1);
  return count;
}

function norm(weights: ReadonlyMap<string, number>): number {
  let sum = 0;
  for (const weight of weights.values()) sum += weight * weight;
  return Math.sqrt(sum);
}

/**
 * The files that change together with `file`, over the non-noisy commits. `together` counts the
 * commits that touch both; `confidence` is `together` over the commits that touch `file`. A
 * partner needs `together >= minTogether` (default 3) and `confidence >= 0.2`. The result is
 * sorted by confidence, then by `together`, then by path, and holds at most 10 partners.
 */
export function coChange(
  history: readonly HistoryCommit[],
  noisy: ReadonlySet<string>,
  file: string,
  minTogether = 3,
): Partner[] {
  let touching = 0;
  const together = new Map<string, number>();
  for (const commit of history) {
    if (noisy.has(commit.sha) || !commit.files.includes(file)) continue;
    touching += 1;
    for (const other of new Set(commit.files)) {
      if (other !== file) together.set(other, (together.get(other) ?? 0) + 1);
    }
  }
  if (touching === 0) return [];
  return [...together]
    .map(([partner, count]) => ({
      file: partner,
      together: count,
      confidence: count / touching,
    }))
    .filter((partner) => partner.together >= minTogether && partner.confidence >= 0.2)
    .sort(
      (a, b) =>
        b.confidence - a.confidence ||
        b.together - a.together ||
        (a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
    )
    .slice(0, 10);
}

/**
 * The commits that touch `file` and whose subject is a fix (`isFixSubject`), newest first, at
 * most `limit` (default 5). Noisy commits are not left out here.
 */
export function pastFixes(
  history: readonly HistoryCommit[],
  file: string,
  limit = 5,
): HistoryCommit[] {
  return history
    .filter((commit) => commit.files.includes(file) && isFixSubject(commit.subject))
    .slice(0, Math.max(0, limit));
}

// ─── The front matter reader: the YAML shape of changes/README.md, no library ───

type Item = string | Readonly<Record<string, string>>;
type FieldValue = string | ReadonlyArray<Item>;

function frontMatter(
  path: string,
  text: string,
): { fields: ReadonlyMap<string, FieldValue>; body: string } {
  const lines = text.split('\n');
  if (lines[0]?.trimEnd() !== '---') throw new Error(`${path}: no front matter`);
  const end = lines.findIndex((line, i) => i > 0 && line.trimEnd() === '---');
  if (end < 0) throw new Error(`${path}: front matter is not closed`);
  const fields = new Map<string, FieldValue>();
  let i = 1;
  while (i < end) {
    const line = lines[i] ?? '';
    i += 1;
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const match = /^([a-z][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (match === null) throw new Error(`${path}: front matter line ${i} is not a key`);
    const key = match[1] ?? '';
    const inline = (match[2] ?? '').trim();
    const block: string[] = [];
    while (i < end && (lines[i] === '' || /^[\s-]/.test(lines[i] ?? ''))) {
      if ((lines[i] ?? '').trim() !== '') block.push(lines[i] ?? '');
      i += 1;
    }
    if (inline !== '') {
      fields.set(key, inline === '[]' ? [] : scalarOf(inline));
    } else {
      fields.set(key, listOf(path, block));
    }
  }
  return {
    fields,
    body: lines
      .slice(end + 1)
      .join('\n')
      .trim(),
  };
}

function listOf(path: string, block: readonly string[]): ReadonlyArray<Item> {
  const items: Item[] = [];
  let current: Record<string, string> | null = null;
  for (const raw of block) {
    const line = raw.trim();
    if (line === '-' || line.startsWith('- ')) {
      const content = line.slice(1).trim();
      const pair = /^([a-z][\w-]*):\s*(.*)$/.exec(content);
      if (pair !== null) {
        current = { [pair[1] ?? '']: scalarOf(pair[2] ?? '') };
        items.push(current);
      } else {
        current = null;
        items.push(scalarOf(content));
      }
      continue;
    }
    const pair = /^([a-z][\w-]*):\s*(.*)$/.exec(line);
    if (current === null || pair === null) {
      throw new Error(`${path}: front matter line "${line}" is not a list entry`);
    }
    current[pair[1] ?? ''] = scalarOf(pair[2] ?? '');
  }
  return items;
}

// A single-quoted scalar doubles its quote; a double-quoted one escapes it with a backslash.
// A plain scalar may end with a comment.
function scalarOf(value: string): string {
  if (value.startsWith("'")) {
    const quoted = /^'((?:[^']|'')*)'/.exec(value);
    if (quoted !== null) return (quoted[1] ?? '').replace(/''/g, "'");
  }
  if (value.startsWith('"')) {
    const quoted = /^"((?:[^"\\]|\\.)*)"/.exec(value);
    if (quoted !== null) return (quoted[1] ?? '').replace(/\\(.)/g, '$1');
  }
  return value.replace(/\s+#.*$/, '').trim();
}

function scalarField(path: string, fields: ReadonlyMap<string, FieldValue>, key: string): string {
  const value = fields.get(key);
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new Error(`${path}: ${key} must be a scalar`);
  return value;
}

function listField(path: string, fields: ReadonlyMap<string, FieldValue>, key: string): string[] {
  const value = fields.get(key);
  if (value === undefined) return [];
  if (typeof value === 'string') throw new Error(`${path}: ${key} must be a list`);
  return value.map((item) => {
    if (typeof item !== 'string') throw new Error(`${path}: ${key} holds a map, not a scalar`);
    return item;
  });
}

function recordField(
  path: string,
  fields: ReadonlyMap<string, FieldValue>,
  key: string,
): Array<Readonly<Record<string, string>>> {
  const value = fields.get(key);
  if (value === undefined) return [];
  if (typeof value === 'string') throw new Error(`${path}: ${key} must be a list`);
  return value.map((item) => {
    if (typeof item === 'string') throw new Error(`${path}: ${key} holds a scalar, not a map`);
    return item;
  });
}
