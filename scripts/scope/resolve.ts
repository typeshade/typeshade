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
//           One GraphSession (one MCP server process, JSON-RPC over stdio) serves a whole pack.
//   git     `git grep` reads the tree AT THE REVISION and finds definitions by a pattern. It has
//           no call graph. Its tests are the sibling `<name>.test.ts` and every test under `src/`
//           that names the base name of the file.
//
// chooseResolver picks the graph when it describes the revision, else the git resolver, and the
// note of the resolver says why. Every git call runs through execFileSync with an argument array.
// A non-zero exit throws. The one exception is the exit that means "no match": git exits 1 with
// no output for grep, rev-parse --quiet and merge-base --is-ancestor.
//
// The JSON parsers (parseSearchGraph, parseTracePath, parseQueryGraph) are pure. They reject an
// unexpected shape by throwing, so a change in the binary's output fails loudly.
//
// Freshness limit: the graph is indexed from the working tree, and the check here compares only
// the index time with HEAD's committer time. A time test cannot tell an index of a different,
// newer tree. The clean-tree check and the root-path match narrow that gap. Running
// `index_repository` after each commit removes it.
//
// Imported by scripts/scope/pack.ts. Nothing here runs at import time.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { realpathSync } from 'node:fs';
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
  readonly note: string; // one sentence for the pack: what it is, its limits, and why it ran
  find(name: string): Promise<SymbolHit[]>;
  neighbours(hit: SymbolHit): Promise<{ callers: Neighbour[]; callees: Neighbour[] }>; // the git resolver returns none
  testsOf(file: string): Promise<string[]>; // test files that test this file
  close(): Promise<void>;
}

export interface ToolAnswer {
  readonly isError: boolean;
  readonly text: string;
}

export interface GraphOpening {
  readonly resolver: Resolver | null;
  readonly why: string; // why the graph did not open, when it did not
}

export type OpenSession = (
  command?: string,
  args?: readonly string[],
  timeoutMs?: number,
) => Promise<GraphSession>;

export interface TraceAnswer {
  readonly status: 'ok' | 'ambiguous';
  readonly callers: Neighbour[];
  readonly callees: Neighbour[];
  readonly suggestions: Array<{ qualifiedName: string; file: string }>;
}

const CODE_GRAPH = 'codebase-memory-mcp';
const DEFAULT_TIMEOUT_MS = 30000;
const CLOSE_WAIT_MS = 3000;
const REAP_WAIT_MS = 1000; // after a kill: the most wait for the server's exit to be seen
const REAP_POLL_MS = 20;
const PROTOCOL_VERSION = '2024-11-05';
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

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
}

function execFailure(err: unknown): ExecFailure {
  const e = (typeof err === 'object' && err !== null ? err : {}) as {
    status?: unknown;
    stdout?: unknown;
  };
  return {
    status: typeof e.status === 'number' ? e.status : null,
    stdout: typeof e.stdout === 'string' ? e.stdout : '',
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

// ─── the graph session ─────────────────────────────────────────────────────────

interface Waiter {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: NodeJS.Timeout;
}

// One codebase-memory-mcp server process, spoken to as MCP over newline-delimited JSON-RPC 2.0.
// Starting the process costs seconds, so a pack opens one session and makes every call through it.
export class GraphSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly command: string;
  private readonly timeoutMs: number;
  private readonly pending = new Map<number, Waiter>();
  private nextId = 1; // id 1 is `initialize`
  private buffered = '';
  private stderrTail = '';
  private exited = false;
  private ended: string | null = null; // why no further answer can come, once it cannot
  private closing = false;

  private constructor(child: ChildProcessWithoutNullStreams, command: string, timeoutMs: number) {
    this.child = child;
    this.command = command;
    this.timeoutMs = timeoutMs;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-4096);
    });
    // A write to a process that has died is reported by its exit, not by this stream.
    child.stdin.on('error', () => undefined);
    child.on('error', (err) => {
      if (child.pid === undefined) this.exited = true;
      this.die(`could not start ${command}: ${err.message}`);
    });
    child.on('exit', (code, signal) => {
      this.exited = true;
      const how = signal ?? `code ${String(code)}`;
      this.die(`${command} exited (${how}) before it answered${this.lastStderrLine()}`);
    });
  }

  // Spawns the server and runs the MCP handshake. A failure kills the process and rejects.
  // The server leads its own process group (`detached`), so a kill reaches its children too.
  static async open(
    command: string = CODE_GRAPH,
    args: readonly string[] = [],
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<GraphSession> {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    const session = new GraphSession(child, command, timeoutMs);
    try {
      await session.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'typeshade-scope', version: '1' },
      });
      session.notify('notifications/initialized');
      return session;
    } catch (err) {
      session.forceKill();
      await session.close();
      throw err;
    }
  }

  // One tool call. An `isError` answer is returned, not thrown: the caller decides.
  async call(tool: string, args: Readonly<Record<string, unknown>>): Promise<ToolAnswer> {
    const reply = asObject(
      await this.request('tools/call', { name: tool, arguments: args }),
      `${tool} answer`,
    );
    const content = asArray(reply.content, `${tool} content`);
    const first = asObject(content[0], `${tool} content[0]`);
    return {
      isError: reply.isError === true,
      text: asText(first.text, `${tool} content[0].text`),
    };
  }

  // Ends stdin, waits up to CLOSE_WAIT_MS for the exit, then kills the process. Never throws.
  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    try {
      this.die('the graph session was closed');
      if (this.exited) return;
      const exited = new Promise<void>((resolve) => this.child.once('exit', () => resolve()));
      this.child.stdin.end();
      let timer: NodeJS.Timeout | undefined;
      const timedOut = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, CLOSE_WAIT_MS);
      });
      await Promise.race([exited, timedOut]);
      clearTimeout(timer);
      if (!this.exited) this.forceKill();
      await this.reap();
    } catch {
      // close never throws: the process is gone or going.
    }
  }

  // Waits, up to REAP_WAIT_MS, until the server's exit is seen. Node reaps the server only when
  // it delivers the 'exit' event, so a close that returned earlier could leave a zombie server
  // visible to `kill(pid, 0)`. The group's children are not waited for: they are not this
  // process's children, and their parent is the init process that reaps them.
  private async reap(): Promise<void> {
    const deadline = Date.now() + REAP_WAIT_MS;
    while (!this.exited && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, REAP_POLL_MS));
    }
  }

  // SIGKILL to the process group, then to the pid. The group reaches children the server spawned;
  // the pid covers a server that is not a group leader. Each send is allowed to fail.
  private forceKill(): void {
    const pid = this.child.pid;
    if (pid !== undefined) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // the group is already gone
      }
    }
    try {
      this.child.kill('SIGKILL');
    } catch {
      // the pid is already gone
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (this.ended !== null) return Promise.reject(new Error(this.ended));
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.command}: no answer to ${method} within ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  private notify(method: string): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  }

  private die(reason: string): void {
    if (this.ended !== null) return;
    this.ended = reason;
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private lastStderrLine(): string {
    const last = this.stderrTail.trim().split('\n').pop() ?? '';
    return last === '' ? '' : `: ${last}`;
  }

  private onStdout(chunk: string): void {
    this.buffered += chunk;
    const lines = this.buffered.split('\n');
    this.buffered = lines.pop() ?? '';
    for (const line of lines) this.onLine(line);
  }

  // A line that does not parse, or carries no id (a notification), is ignored.
  private onLine(line: string): void {
    const text = line.trim();
    if (text === '') return;
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null || !('id' in message)) return;
    const id = message.id;
    if (typeof id !== 'number') return;
    const waiter = this.pending.get(id);
    if (waiter === undefined) return;
    this.pending.delete(id);
    clearTimeout(waiter.timer);
    if ('error' in message && message.error !== undefined) {
      const error = message.error;
      const detail =
        typeof error === 'object' && error !== null && 'message' in error
          ? String(error.message)
          : JSON.stringify(error);
      waiter.reject(new Error(detail));
      return;
    }
    waiter.resolve('result' in message ? message.result : undefined);
  }
}

// ─── graph resolver ────────────────────────────────────────────────────────────

// The project name the string rule gives: the top level, `/` replaced by `-`, the leading `-`
// dropped. codebase-memory-mcp also replaces a space by `-` and collapses `/-`, so this rule can
// miss a project; the root path is the check that decides.
function stringRuleName(top: string): string {
  return top.replace(/\//g, '-').replace(/^-/, '');
}

// Two paths name one directory when their real paths are equal. When one cannot be resolved, the
// raw strings are compared.
function samePath(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
}

// The project of this repository: the one whose root path is the top level. Without one, the
// string rule's name, when the graph lists it. Otherwise null.
function chooseProject(
  projects: readonly { name: string; rootPath: string }[],
  top: string,
): string | null {
  const byPath = projects.find((p) => samePath(p.rootPath, top));
  if (byPath !== undefined) return byPath.name;
  const named = stringRuleName(top);
  return projects.some((p) => p.name === named) ? named : null;
}

// The regex `^<escaped name>$` is built by the caller. This pattern matches a definition.
function definitionPattern(name: string): string {
  const n = escapeRegex(name);
  return String.raw`(function\*?|class|interface|type|const|let|var|enum)\s+${n}\b|^\s*(export\s+)?(async\s+)?${n}\s*\(`;
}

// A call that answers `isError` throws with its text: a failure in the middle of a pack is not hidden.
async function callText(
  session: GraphSession,
  tool: string,
  args: Readonly<Record<string, unknown>>,
): Promise<string> {
  const answer = await session.call(tool, args);
  if (answer.isError) throw new Error(`scope: ${tool} failed: ${answer.text}`);
  return answer.text;
}

// list_projects has no JSON mode: one indented line per project, its name first and its root path
// second. A root path with a space is printed in double quotes, and the quotes are stripped.
export function parseListProjects(text: string): Array<{ name: string; rootPath: string }> {
  const out: Array<{ name: string; rootPath: string }> = [];
  for (const line of text.split('\n')) {
    const match = /^\s+(\S+)\s+(?:"([^"]*)"|(\S+))/u.exec(line);
    if (match === null) continue;
    out.push({ name: match[1] ?? '', rootPath: match[2] ?? match[3] ?? '' });
  }
  return out;
}

// index_status answers `key: value` lines.
function parseStatus(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = /^([a-z_]+): (.*)$/u.exec(line.trim());
    if (match !== null) out.set(match[1] ?? '', match[2] ?? '');
  }
  return out;
}

// The graph resolver over one open session. The note names both times: the index and HEAD.
function graphResolverOver(
  cwd: string,
  session: GraphSession,
  project: string,
  indexedAt: string,
  headTime: string,
): Resolver {
  let known: string[] | undefined;
  const tracked = (): string[] => {
    if (known === undefined) known = trackedFiles(cwd, 'HEAD');
    return known;
  };
  const trace = async (name: string): Promise<TraceAnswer> =>
    parseTracePath(
      await callText(session, 'trace_path', {
        project,
        function_name: name,
        direction: 'both',
        depth: 1,
        format: 'json',
      }),
      project,
      tracked(),
    );

  return {
    kind: 'graph',
    note: `code graph: codebase-memory-mcp, project ${project}, indexed at ${indexedAt}; HEAD committed at ${headTime}; one session`,
    async find(name) {
      return parseSearchGraph(
        await callText(session, 'search_graph', {
          project,
          name_pattern: `^${escapeRegex(name)}$`,
          format: 'json',
          limit: SEARCH_LIMIT,
        }),
      );
    },
    async neighbours(hit) {
      let answer = await trace(hit.name);
      if (answer.status === 'ambiguous') {
        const pick = answer.suggestions.find((s) => s.file === hit.file);
        if (pick === undefined) return { callers: [], callees: [] };
        answer = await trace(pick.qualifiedName);
        if (answer.status !== 'ok') return { callers: [], callees: [] };
      }
      return {
        callers: answer.callers.slice(0, NEIGHBOUR_CAP),
        callees: answer.callees.slice(0, NEIGHBOUR_CAP),
      };
    },
    async testsOf(file) {
      const escaped = file.replace(/'/g, "\\'");
      const query = `MATCH (t:File)-[:TESTS_FILE]->(f:File) WHERE f.file_path = '${escaped}' RETURN t.file_path AS p`;
      const found = parseQueryGraph(
        await callText(session, 'query_graph', { project, query, format: 'json' }),
      );
      return unique([...found, ...siblingTest(file, tracked())]);
    },
    async close() {
      await session.close();
    },
  };
}

// Opens the graph for the working tree of `cwd`. It answers only when the graph lists this
// repository's project and is indexed at or after HEAD's committer time. Otherwise it closes the
// session and says why. A failure of the handshake or of the first three calls is a `why` too.
export async function openGraphResolver(
  cwd: string,
  open: OpenSession = GraphSession.open,
): Promise<GraphOpening> {
  const top = git(cwd, 'rev-parse', '--show-toplevel').trim();
  const headTime = git(cwd, 'log', '-1', '--format=%cI', 'HEAD').trim();
  let session: GraphSession;
  try {
    session = await open();
  } catch (err) {
    return { resolver: null, why: `the code graph is not available (${messageOf(err)})` };
  }
  try {
    const projects = parseListProjects(await callText(session, 'list_projects', {}));
    const project = chooseProject(projects, top);
    if (project === null) {
      await session.close();
      return { resolver: null, why: `the code graph has no project for ${top}` };
    }
    const status = parseStatus(await callText(session, 'index_status', { project }));
    const indexedAt = status.get('indexed_at');
    const indexedMs = indexedAt === undefined ? NaN : Date.parse(indexedAt);
    if (!Number.isFinite(indexedMs) || indexedMs < Date.parse(headTime)) {
      await session.close();
      return {
        resolver: null,
        why: `the code graph of ${project} was indexed at ${indexedAt ?? 'an unknown time'}, before HEAD (${headTime}); run index_repository`,
      };
    }
    return {
      resolver: graphResolverOver(cwd, session, project, indexedAt ?? '', headTime),
      why: '',
    };
  } catch (err) {
    await session.close();
    return { resolver: null, why: `the code graph is not available (${messageOf(err)})` };
  }
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
    async find(name) {
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
    async neighbours() {
      return { callers: [], callees: [] };
    },
    async testsOf(file) {
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
    async close() {
      // The git resolver holds no process.
    },
  };
}

// ─── choosing ──────────────────────────────────────────────────────────────────

export type OpenGraph = (cwd: string) => Promise<GraphOpening>;

function shortSha(cwd: string, rev: string): string {
  return git(cwd, 'rev-parse', '--verify', '--short', `${rev}^{commit}`).trim();
}

function withNoteSuffix(resolver: Resolver, suffix: string): Resolver {
  return { ...resolver, note: `${resolver.note}${suffix}` };
}

// The one place that picks a resolver. The graph describes the working tree, so it answers only
// for a clean HEAD. The opener runs only when `at` is HEAD and the tree is clean. Every other case
// gives the git resolver, and the note says why the graph did not run.
export async function chooseResolver(
  cwd: string,
  at: string,
  openGraph: OpenGraph = openGraphResolver,
): Promise<Resolver> {
  const head = git(cwd, 'rev-parse', '--verify', 'HEAD^{commit}').trim();
  const atSha = git(cwd, 'rev-parse', '--verify', `${at}^{commit}`).trim();
  if (atSha !== head) {
    return withNoteSuffix(
      gitResolver(cwd, at),
      `; the graph did not run: ${shortSha(cwd, at)} is not HEAD (${shortSha(cwd, 'HEAD')})`,
    );
  }
  if (git(cwd, 'status', '--porcelain').trim() !== '') {
    return withNoteSuffix(
      gitResolver(cwd, at),
      '; the graph did not run: the working tree has changes',
    );
  }
  const opened = await openGraph(cwd);
  if (opened.resolver !== null) return opened.resolver;
  return withNoteSuffix(gitResolver(cwd, at), `; the graph did not run: ${opened.why}`);
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
