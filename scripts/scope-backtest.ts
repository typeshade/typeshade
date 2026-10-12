// ═══ Scope backtest: the context pack measured against real fixes ═══
//
// `bun run scope:backtest` measures `bun run scope` (#587). For each closed issue in
// scripts/scope/backtest/cases.json, the pack is built at the parent of the issue's fix, so it sees
// only what an implementer would have seen. Its ranked files are compared with the code files the
// fix really changed: recall@5 and @15, MRR, precision@5, the deepest compiler layer, and the tests.
//
// Two resolvers answer the same case. `git` reads the revision with git grep. `graph` indexes a
// fresh worktree of that revision with codebase-memory-mcp and reads the graph. The library is
// scripts/scope/backtest.ts; the ranking it measures is scripts/scope/pack.ts.
//
// Rules are chosen on the `tuning` cases and judged on the `held-out` ones. `--weights` tries a
// variant of the ranking weights. `--collect` proposes new cases from the closed issues on GitHub.
//
// A report, not a gate. CI does not run it.
//
// Usage, from the repository root:
//   bun run scope:backtest -- [--set tuning|held-out|all] [--cases <n,n,…>]
//                             [--resolver git|graph|both] [--weights <file.json>] [--limit <n>] [--json]
//   bun scripts/scope-backtest.ts --collect [--repo <owner/name>] [--write]
//
// Exit codes: 0 after a report, even when some cases have status `error`; 2 for a usage error, an
// unknown weight, or when gh cannot list the issues (read through `gh api`, REST, not GraphQL). A
// git failure outside a case throws.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatReport,
  loadCorpus,
  proposeFromHistory,
  realGraphDeps,
  runGitCase,
  runGraphCase,
  summarize,
  sweepStale,
  type Case,
  type CaseResult,
  type RunOptions,
} from './scope/backtest.js';
import { git } from './scope/history.js';
import { DEFAULT_WEIGHTS, type Weights } from './scope/pack.js';

const DEFAULT_REPO = 'typeshade/typeshade';
const CORPUS = join(dirname(fileURLToPath(import.meta.url)), 'scope', 'backtest', 'cases.json');

const USAGE = `Usage:
  bun scripts/scope-backtest.ts [--set tuning|held-out|all] [--cases <n,n,…>]
                                [--resolver git|graph|both] [--weights <file.json>] [--limit <n>] [--json]
  bun scripts/scope-backtest.ts --collect [--repo <owner/name>] [--write]
`;

type SetName = 'tuning' | 'held-out' | 'all';
type ResolverName = 'git' | 'graph' | 'both';

export type ParsedArgs =
  | { readonly kind: 'help' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'collect'; readonly repo: string; readonly write: boolean }
  | {
      readonly kind: 'run';
      readonly set: SetName;
      readonly cases: readonly number[] | null;
      readonly resolver: ResolverName;
      readonly weights: string | null;
      readonly limit: number;
      readonly json: boolean;
    };

const SETS: readonly SetName[] = ['tuning', 'held-out', 'all'];
const RESOLVERS: readonly ResolverName[] = ['git', 'graph', 'both'];

function wholeNumber(value: string): number | null {
  return /^\d+$/.test(value) && Number(value) >= 1 ? Number(value) : null;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let set: SetName | undefined;
  let cases: number[] | null | undefined;
  let resolver: ResolverName | undefined;
  let weights: string | undefined;
  let limit: number | undefined;
  let json = false;
  let collect = false;
  let repo: string | undefined;
  let write = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    switch (arg) {
      case '--help':
        return { kind: 'help' };
      case '--json':
        json = true;
        break;
      case '--collect':
        collect = true;
        break;
      case '--write':
        write = true;
        break;
      case '--set':
      case '--cases':
      case '--resolver':
      case '--weights':
      case '--limit':
      case '--repo': {
        const value = argv[i + 1];
        if (value === undefined) return { kind: 'error', message: `${arg} needs a value` };
        i++;
        if (arg === '--set') {
          if (!(SETS as readonly string[]).includes(value)) {
            return { kind: 'error', message: `--set needs tuning, held-out or all, got ${value}` };
          }
          set = value as SetName;
        } else if (arg === '--resolver') {
          if (!(RESOLVERS as readonly string[]).includes(value)) {
            return {
              kind: 'error',
              message: `--resolver needs git, graph or both, got ${value}`,
            };
          }
          resolver = value as ResolverName;
        } else if (arg === '--cases') {
          const numbers = value.split(',').map((part) => wholeNumber(part));
          if (numbers.some((n) => n === null)) {
            return {
              kind: 'error',
              message: `--cases needs a comma list of issue numbers, got ${value}`,
            };
          }
          cases = numbers as number[];
        } else if (arg === '--weights') {
          weights = value;
        } else if (arg === '--repo') {
          repo = value;
        } else {
          const n = wholeNumber(value);
          if (n === null) {
            return {
              kind: 'error',
              message: `--limit needs a whole number of at least 1, got ${value}`,
            };
          }
          limit = n;
        }
        break;
      }
      default:
        return { kind: 'error', message: `unknown option ${arg}` };
    }
  }

  if (collect) {
    const runOnly =
      set !== undefined ||
      cases !== undefined ||
      resolver !== undefined ||
      weights !== undefined ||
      limit !== undefined ||
      json;
    if (runOnly) {
      return { kind: 'error', message: '--collect takes only --repo and --write' };
    }
    return { kind: 'collect', repo: repo ?? DEFAULT_REPO, write };
  }
  if (repo !== undefined || write) {
    return { kind: 'error', message: '--repo and --write need --collect' };
  }

  return {
    kind: 'run',
    set: set ?? 'all',
    cases: cases ?? null,
    resolver: resolver ?? 'git',
    weights: weights ?? null,
    limit: limit ?? 50,
    json,
  };
}

function firstLine(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  const message = error instanceof Error ? error.message : String(error);
  const text = typeof stderr === 'string' && stderr.trim() !== '' ? stderr : message;
  return text.trim().split('\n')[0] ?? '';
}

export interface ProposedIssue {
  readonly number: number;
  readonly title: string;
  readonly body: string;
}

// The REST list marks a pull request with a `pull_request` key.
function isPullRequest(item: unknown): boolean {
  return typeof item === 'object' && item !== null && 'pull_request' in item;
}

// The first 500 closed issues of a REST reply, in the order the API returns them. The pages hold
// pull requests too, which carry a `pull_request` key and are dropped. A reply of the wrong shape
// throws.
export function closedIssuesFromReply(json: string): ProposedIssue[] {
  const data: unknown = JSON.parse(json);
  if (!Array.isArray(data) || !data.every((page: unknown) => Array.isArray(page))) {
    throw new Error('gh could not list issues: the reply is not a list of pages');
  }
  const items = (data as unknown[][]).flat().filter((item: unknown) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error('gh could not list issues: an issue has no number, title or body');
    }
    return !isPullRequest(item);
  });
  return items.slice(0, 500).map((item: unknown) => {
    const { number, title, body } = item as Record<string, unknown>;
    if (typeof number !== 'number' || typeof title !== 'string') {
      throw new Error('gh could not list issues: an issue has no number, title or body');
    }
    if (body !== null && typeof body !== 'string') {
      throw new Error('gh could not list issues: an issue has no number, title or body');
    }
    return { number, title, body: typeof body === 'string' ? body : '' };
  });
}

// The closed issues, read through the REST API. `gh issue list --json` is GraphQL, which the proxy
// of a Claude Code cloud session refuses with a 403. One call per page: `gh api --paginate` follows
// a Link header that names the repository by its numeric id. The proxy refuses that path too (403).
// Pages are read until a short page or 500 issues (pull requests not counted); the cap is applied
// by closedIssuesFromReply. The path is one argv item; no shell runs.
function listClosedIssues(repo: string): ProposedIssue[] {
  const pages: unknown[] = [];
  let issues = 0;
  for (let page = 1; ; page++) {
    let items: unknown;
    try {
      const stdout = execFileSync(
        'gh',
        ['api', `repos/${repo}/issues?state=closed&per_page=100&page=${page}`],
        { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      items = JSON.parse(stdout);
    } catch (error) {
      throw new Error(`gh could not list issues: ${firstLine(error)}`);
    }
    pages.push(items);
    if (!Array.isArray(items) || items.length < 100) break;
    issues += items.filter((item: unknown) => !isPullRequest(item)).length;
    if (issues >= 500) break;
  }
  return closedIssuesFromReply(JSON.stringify(pages));
}

// Read the weights override. An unknown key or a non-number value throws, naming it.
function readWeights(path: string): Partial<Weights> {
  const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`--weights needs a JSON object in ${path}`);
  }
  const known = new Set<string>(Object.keys(DEFAULT_WEIGHTS));
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!known.has(key)) throw new Error(`unknown weight ${key}`);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`weight ${key} needs a finite number`);
    }
    out[key] = value;
  }
  return out as Partial<Weights>;
}

async function collect(repo: string, write: boolean, root: string): Promise<number> {
  let issues: ProposedIssue[];
  try {
    issues = listClosedIssues(repo);
  } catch (error) {
    process.stderr.write(
      `scope:backtest: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }
  const known = new Set(loadCorpus(CORPUS).cases.map((c) => c.issue));
  const proposed = proposeFromHistory(root, issues, known);
  process.stdout.write(`${JSON.stringify(proposed, null, 2)}\n`);
  if (write) {
    const raw = JSON.parse(readFileSync(CORPUS, 'utf8')) as { cases: unknown[] };
    raw.cases = [...raw.cases, ...proposed];
    writeFileSync(CORPUS, `${JSON.stringify(raw, null, 2)}\n`);
    process.stderr.write(`scope:backtest: appended ${proposed.length} cases to ${CORPUS}\n`);
  }
  return 0;
}

/** The run options a parsed run asks for: the limit, and the weights file read and checked. */
export function runOptionsFrom(parsed: ParsedArgs): RunOptions {
  if (parsed.kind !== 'run') throw new Error('runOptionsFrom needs a parsed run');
  if (parsed.weights === null) return { limit: parsed.limit };
  return { limit: parsed.limit, weights: readWeights(parsed.weights) };
}

async function run(args: Extract<ParsedArgs, { kind: 'run' }>, root: string): Promise<number> {
  const corpus = loadCorpus(CORPUS);
  if (args.cases !== null) {
    for (const n of args.cases) {
      if (!corpus.cases.some((c) => c.issue === n)) {
        process.stderr.write(`scope:backtest: issue ${n} is not in the corpus\n${USAGE}`);
        return 2;
      }
    }
  }
  const selected: Case[] = corpus.cases.filter(
    (c) =>
      (args.set === 'all' || c.set === args.set) &&
      (args.cases === null || args.cases.includes(c.issue)),
  );

  let options: RunOptions;
  try {
    options = runOptionsFrom(args);
  } catch (error) {
    process.stderr.write(
      `scope:backtest: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }

  if (args.resolver !== 'git') {
    const removed = sweepStale(root, realGraphDeps);
    if (removed > 0) {
      process.stderr.write(
        `scope:backtest: removed ${removed} worktrees an interrupted run left\n`,
      );
    }
  }

  const results: CaseResult[] = [];
  for (const c of selected) {
    if (args.resolver !== 'graph') results.push(await runGitCase(root, c, options));
    if (args.resolver !== 'git') results.push(await runGraphCase(root, c, options));
  }

  const head = git(root, 'rev-parse', '--verify', 'HEAD^{commit}').trim();
  const effective: Weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  if (args.json) {
    process.stdout.write(
      `${JSON.stringify({ head, weights: effective, results, summary: summarize(results) }, null, 2)}\n`,
    );
    return 0;
  }
  const label = args.weights === null ? 'default' : basename(args.weights);
  process.stdout.write(formatReport(results, { head: head.slice(0, 7), weights: label }));
  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.kind === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (parsed.kind === 'error') {
    process.stderr.write(`scope:backtest: ${parsed.message}\n${USAGE}`);
    return 2;
  }
  const root = git(process.cwd(), 'rev-parse', '--show-toplevel').trim();
  return parsed.kind === 'collect' ? collect(parsed.repo, parsed.write, root) : run(parsed, root);
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
