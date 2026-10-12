// ═══ Step 2: resolve the names, paths and commits of a seed at one revision ═══
//
// The pack needs four answers for the seeds of an issue: where a name is defined, who calls it,
// which tracked files a seed path names, and which seed hexes are commits of the revision.
//
// Two resolvers answer the first two questions. Each describes a different thing:
//
//   graph   codebase-memory-mcp indexes the WORKING TREE. It gives definitions with their line
//           ranges, callers and callees at one hop, and the test files that cover a file
//           (TESTS_FILE edges). It runs only when the revision is HEAD and the tree is clean.
//   git     `git grep` reads the tree AT THE REVISION and finds definitions by a pattern. It has
//           no call graph. Its tests are the sibling `<name>.test.ts` and every test under `src/`
//           that names the base name of the file.
//
// chooseResolver picks the graph when it describes the revision, else the git resolver, and it
// returns the reason for its choice. Every tool runs through execFileSync with an argument array.
// A non-zero exit throws. The one exception is the exit that means "no match": git exits 1 with
// no output for grep, rev-parse --quiet and merge-base --is-ancestor.
//
// The JSON parsers (parseSearchGraph, parseTracePath, parseQueryGraph) are pure. They reject an
// unexpected shape by throwing, so a change in the binary's output fails loudly.
//
// Imported by scripts/scope/pack.ts. Nothing here runs at import time.

import { execFileSync } from 'node:child_process';
import { git } from './history.js';

export interface SymbolHit {
  readonly name: string;
  readonly label: string; // 'Function', 'Class', 'Variable', 'Interface', 'Method', … or 'match' for git grep
  readonly file: string;
  readonly startLine: number;
  readonly endLine: number;
}

export interface Neighbour {
  readonly name: string;
  readonly file: string;
  readonly hop: number;
  readonly direction: 'caller' | 'callee';
}

export interface Resolver {
  readonly kind: 'graph' | 'git';
  readonly note: string; // one sentence for the pack: what it is and its limits
  find(name: string): SymbolHit[];
  neighbours(hit: SymbolHit): Neighbour[]; // the git resolver returns []
  testsOf(file: string): string[]; // test files that test this file
}

export interface Choice {
  readonly resolver: Resolver;
  readonly why: string; // why this resolver ran, and why the graph did not when it did not
}

export interface TraceAnswer {
  readonly status: 'ok' | 'ambiguous';
  readonly callers: Neighbour[];
  readonly callees: Neighbour[];
  readonly suggestions: Array<{ qualifiedName: string; file: string }>;
}

const CODE_GRAPH = 'codebase-memory-mcp';
const MAX_BUFFER = 256 << 20;
const SEARCH_LIMIT = 20;
const NEIGHBOUR_CAP = 15; // per direction
const MAX_NAME_MATCHES = 5; // a bare file name that matches more tracked files is too common
const NON_SYMBOL_LABELS = new Set(['File', 'Module', 'Folder']);

type Json = Record<string, unknown>;

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function baseName(file: string): string {
  const slash = file.lastIndexOf('/');
  return file.slice(slash + 1).replace(/\.[^.]+$/u, '');
}

// The sibling test of a file, when the revision tracks it: `<dir>/<name>.test.ts`.
function siblingTest(file: string, tracked: readonly string[]): string[] {
  const slash = file.lastIndexOf('/');
  const dir = slash < 0 ? '' : file.slice(0, slash + 1);
  const sibling = `${dir}${baseName(file)}.test.ts`;
  return tracked.includes(sibling) ? [sibling] : [];
}

// ─── process runners ───────────────────────────────────────────────────────────

interface ExecFailure {
  readonly status: number | null;
  readonly stdout: string;
  readonly code: string | undefined;
}

function execFailure(err: unknown): ExecFailure {
  const e = (typeof err === 'object' && err !== null ? err : {}) as {
    status?: unknown;
    stdout?: unknown;
    code?: unknown;
  };
  return {
    status: typeof e.status === 'number' ? e.status : null,
    stdout: typeof e.stdout === 'string' ? e.stdout : '',
    code: typeof e.code === 'string' ? e.code : undefined,
  };
}

// Exit 1 with no output is "no match". Every other failure throws.
function gitOrNull(cwd: string, ...args: string[]): string | null {
  try {
    return git(cwd, ...args);
  } catch (err) {
    const failure = execFailure(err);
    if (failure.status === 1 && failure.stdout === '') return null;
    throw err;
  }
}

function cbm(cwd: string, args: readonly string[]): string {
  return execFileSync(CODE_GRAPH, ['cli', '--quiet', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// The git grep line is `<at>:<rest>`. Any other prefix is an error.
function stripRev(line: string, at: string): string {
  const prefix = `${at}:`;
  if (!line.startsWith(prefix)) {
    throw new Error(`scope: git output line does not start with ${prefix}: ${line}`);
  }
  return line.slice(prefix.length);
}

// ─── JSON shape checks ─────────────────────────────────────────────────────────

function parseJson(json: string, what: string): Json {
  const parsed: unknown = JSON.parse(json);
  return asObject(parsed, what);
}

function asObject(value: unknown, what: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`scope: ${what} is not a JSON object`);
  }
  return value as Json;
}

function asArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`scope: ${what} is not a JSON array`);
  return value;
}

function asText(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`scope: ${what} is not a string`);
  return value;
}

function asInt(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`scope: ${what} is not an integer`);
  }
  return value;
}

// ─── graph resolver ────────────────────────────────────────────────────────────

// The project name of the graph: the absolute top level, `/` replaced by `-`, the leading `-` dropped.
function projectName(cwd: string): string {
  const top = git(cwd, 'rev-parse', '--show-toplevel').trim();
  return top.replace(/\//g, '-').replace(/^-/, '');
}

// The regex `^<escaped name>$` is built by the caller. This pattern matches a definition.
function definitionPattern(name: string): string {
  const n = escapeRegex(name);
  return String.raw`(function\*?|class|interface|type|const|let|var|enum)\s+${n}\b|^\s*(export\s+)?(async\s+)?${n}\s*\(`;
}

// Returns null when the binary is not on PATH or does not list the project.
export function graphResolver(cwd: string): Resolver | null {
  const project = projectName(cwd);
  let listing: string;
  try {
    listing = cbm(cwd, ['list_projects']);
  } catch (err) {
    if (execFailure(err).code === 'ENOENT') return null;
    throw err;
  }
  const listed = listing.split('\n').some((line) => line.trim().split(/\s+/u)[0] === project);
  if (!listed) return null;

  let known: string[] | undefined;
  const tracked = (): string[] => {
    if (known === undefined) known = trackedFiles(cwd, 'HEAD');
    return known;
  };
  const trace = (name: string): string =>
    cbm(cwd, [
      'trace_path',
      '--project',
      project,
      '--function-name',
      name,
      '--direction',
      'both',
      '--depth',
      '1',
      '--format',
      'json',
    ]);

  return {
    kind: 'graph',
    note: `code graph: codebase-memory-mcp, project ${project}, the working tree`,
    find(name) {
      const out = cbm(cwd, [
        'search_graph',
        '--project',
        project,
        '--name-pattern',
        `^${escapeRegex(name)}$`,
        '--format',
        'json',
        '--limit',
        String(SEARCH_LIMIT),
      ]);
      return parseSearchGraph(out);
    },
    neighbours(hit) {
      let answer = parseTracePath(trace(hit.name), project, tracked());
      if (answer.status === 'ambiguous') {
        const pick = answer.suggestions.find((s) => s.file === hit.file);
        if (pick === undefined) return [];
        answer = parseTracePath(trace(pick.qualifiedName), project, tracked());
        if (answer.status !== 'ok') return [];
      }
      return [...answer.callers.slice(0, NEIGHBOUR_CAP), ...answer.callees.slice(0, NEIGHBOUR_CAP)];
    },
    testsOf(file) {
      const escaped = file.replace(/'/g, "\\'");
      const query = `MATCH (t:File)-[:TESTS_FILE]->(f:File) WHERE f.file_path = '${escaped}' RETURN t.file_path AS p`;
      const found = parseQueryGraph(
        cbm(cwd, ['query_graph', '--project', project, '--query', query, '--format', 'json']),
      );
      return unique([...found, ...siblingTest(file, tracked())]);
    },
  };
}

// The graph's search_graph answer: one SymbolHit per row, File, Module and Folder rows dropped.
export function parseSearchGraph(json: string): SymbolHit[] {
  const root = parseJson(json, 'search_graph answer');
  const hits: SymbolHit[] = [];
  for (const groupValue of asArray(root.groups, 'groups')) {
    const group = asObject(groupValue, 'search_graph group');
    const file = asText(group.file, 'search_graph group file');
    for (const rowValue of asArray(group.rows, 'search_graph rows')) {
      const row = asArray(rowValue, 'search_graph row');
      const name = asText(row[0], 'search_graph name');
      const label = asText(row[1], 'search_graph label');
      const lines = asText(row[2], 'search_graph lines');
      if (NON_SYMBOL_LABELS.has(label)) continue;
      const range = /^(\d+)-(\d+)$/u.exec(lines);
      if (range === null) throw new Error(`scope: search_graph lines is not start-end: ${lines}`);
      hits.push({
        name,
        label,
        file,
        startLine: Number(range[1]),
        endLine: Number(range[2]),
      });
    }
  }
  return hits;
}

// The module path of a qualified prefix, without the project. The first dotted segment is the
// project when `project` is not given. Returns null for a prefix that names no module (the project
// itself, or an empty prefix): a symbol there has no file path to report.
function modulePath(qnPrefix: string, project: string | undefined): string | null {
  if (qnPrefix === '') return null;
  if (project === undefined) {
    const dot = qnPrefix.indexOf('.');
    return dot < 0 ? null : qnPrefix.slice(dot + 1);
  }
  if (qnPrefix === project) return null;
  if (!qnPrefix.startsWith(`${project}.`)) {
    throw new Error(`scope: qualified name ${qnPrefix} is not in project ${project}`);
  }
  return qnPrefix.slice(project.length + 1);
}

// The file of a module path: `<base>.ts`, else `<base>.tsx`. Without a tracked list, `<base>.ts`
// is the guess. With one, a module that matches no tracked file yields null.
function fileOf(base: string, tracked: readonly string[] | undefined): string | null {
  if (tracked === undefined) return `${base}.ts`;
  for (const extension of ['.ts', '.tsx']) {
    if (tracked.includes(`${base}${extension}`)) return `${base}${extension}`;
  }
  return null;
}

function neighboursOf(
  value: unknown,
  direction: Neighbour['direction'],
  project: string | undefined,
  tracked: readonly string[] | undefined,
): Neighbour[] {
  // An answer with no such key names no neighbour. The binary's empty shape is not sampled yet.
  if (value === undefined) return [];
  const block = asObject(value, `trace_path ${direction} block`);
  const out: Neighbour[] = [];
  for (const groupValue of asArray(block.groups, `trace_path ${direction} groups`)) {
    const group = asObject(groupValue, 'trace_path group');
    const module = modulePath(asText(group.qn_prefix, 'trace_path qn_prefix'), project);
    const file = module === null ? null : fileOf(module.replace(/\./g, '/'), tracked);
    for (const rowValue of asArray(group.rows, 'trace_path rows')) {
      const row = asArray(rowValue, 'trace_path row');
      const name = asText(row[0], 'trace_path name');
      const hop = asInt(row[1], 'trace_path hop');
      if (file !== null) out.push({ name, file, hop, direction });
    }
  }
  return out;
}

// The graph's trace_path answer. An ambiguous answer carries suggestions and no neighbours.
// `project` strips the project prefix; `tracked` keeps a neighbour only when its file is tracked.
export function parseTracePath(
  json: string,
  project?: string,
  tracked?: readonly string[],
): TraceAnswer {
  const root = parseJson(json, 'trace_path answer');
  if (root.status === 'ambiguous') {
    const suggestions = asArray(root.suggestions, 'trace_path suggestions').map((value) => {
      const suggestion = asObject(value, 'trace_path suggestion');
      return {
        qualifiedName: asText(suggestion.qualified_name, 'qualified_name'),
        file: asText(suggestion.file_path, 'file_path'),
      };
    });
    return { status: 'ambiguous', callers: [], callees: [], suggestions };
  }
  if (root.status !== undefined) {
    throw new Error(`scope: trace_path status is not ambiguous: ${String(root.status)}`);
  }
  return {
    status: 'ok',
    callers: neighboursOf(root.callers, 'caller', project, tracked),
    callees: neighboursOf(root.callees, 'callee', project, tracked),
    suggestions: [],
  };
}

// The graph's query_graph answer: the first column of each row.
export function parseQueryGraph(json: string): string[] {
  const root = parseJson(json, 'query_graph answer');
  return asArray(root.rows, 'query_graph rows').map((value) =>
    asText(asArray(value, 'query_graph row')[0], 'query_graph first column'),
  );
}

// ─── git resolver ──────────────────────────────────────────────────────────────

// The tracked files of a revision: `git ls-tree -r --name-only <at>`.
export function trackedFiles(cwd: string, at: string): string[] {
  return git(cwd, 'ls-tree', '-r', '--name-only', at)
    .split('\n')
    .filter((line) => line !== '');
}

function parseGrepHit(line: string, at: string, name: string): SymbolHit {
  const match = /^(.+?):(\d+):/u.exec(stripRev(line, at));
  if (match === null) throw new Error(`scope: unexpected git grep line: ${line}`);
  const file = match[1] ?? '';
  const lineNumber = Number(match[2]);
  return { name, label: 'match', file, startLine: lineNumber, endLine: lineNumber };
}

// `git grep` over the tree at one revision. Definitions only; no call graph.
export function gitResolver(cwd: string, at: string): Resolver {
  const short = git(cwd, 'rev-parse', '--verify', '--short', `${at}^{commit}`).trim();
  let known: string[] | undefined;
  const tracked = (): string[] => {
    if (known === undefined) known = trackedFiles(cwd, at);
    return known;
  };

  return {
    kind: 'git',
    note: `git grep at ${short}: definitions by pattern; no call graph`,
    find(name) {
      const out = gitOrNull(
        cwd,
        'grep',
        '-n',
        '-E',
        '-e',
        definitionPattern(name),
        at,
        '--',
        '*.ts',
        ':!*.test.ts',
      );
      if (out === null) return [];
      return out
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => parseGrepHit(line, at, name));
    },
    neighbours: () => [],
    testsOf(file) {
      const listed = gitOrNull(
        cwd,
        'grep',
        '-l',
        '-F',
        '-e',
        baseName(file),
        at,
        '--',
        'src/*.test.ts',
      );
      const byText =
        listed === null
          ? []
          : listed
              .split('\n')
              .filter((line) => line !== '')
              .map((line) => stripRev(line, at));
      return unique([...siblingTest(file, tracked()), ...byText]);
    },
  };
}

// The graph describes the working tree, so it answers only for a clean HEAD. Else git runs.
export function chooseResolver(cwd: string, at: string): Choice {
  const head = git(cwd, 'rev-parse', '--verify', 'HEAD^{commit}').trim();
  const atSha = git(cwd, 'rev-parse', '--verify', `${at}^{commit}`).trim();
  if (atSha !== head) {
    return {
      resolver: gitResolver(cwd, at),
      why: `${at} is not HEAD, and the graph describes the working tree only`,
    };
  }
  if (git(cwd, 'status', '--porcelain').trim() !== '') {
    return {
      resolver: gitResolver(cwd, at),
      why: 'the working tree is not clean, and the graph describes the working tree',
    };
  }
  const graph = graphResolver(cwd);
  if (graph === null) {
    return {
      resolver: gitResolver(cwd, at),
      why: `the graph does not list project ${projectName(cwd)}, or the binary is not on PATH`,
    };
  }
  return { resolver: graph, why: 'at is HEAD and the working tree is clean' };
}

// ─── paths and commits ─────────────────────────────────────────────────────────

// A seed path is kept when it is tracked. A bare file name keeps every tracked file that ends in
// `/<name>` when there are at most MAX_NAME_MATCHES of them. Other paths are dropped.
export function resolvePaths(paths: readonly string[], tracked: readonly string[]): string[] {
  const set = new Set(tracked);
  const out: string[] = [];
  for (const path of paths) {
    if (set.has(path)) {
      out.push(path);
      continue;
    }
    if (path.includes('/')) continue;
    const matches = tracked.filter((file) => file === path || file.endsWith(`/${path}`));
    if (matches.length > 0 && matches.length <= MAX_NAME_MATCHES) out.push(...matches);
  }
  return unique(out);
}

// Full shas of the hexes that name commits which are ancestors of `at` (or `at` itself).
export function resolveCommits(cwd: string, at: string, hexes: readonly string[]): string[] {
  const out: string[] = [];
  for (const hex of hexes) {
    const sha = gitOrNull(cwd, 'rev-parse', '--verify', '--quiet', `${hex}^{commit}`);
    if (sha === null) continue;
    const full = sha.trim();
    if (gitOrNull(cwd, 'merge-base', '--is-ancestor', full, at) === null) continue;
    out.push(full);
  }
  return unique(out);
}
