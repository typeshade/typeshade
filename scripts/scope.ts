// ═══ Scope: an issue's context pack, built mechanically at one revision ═══
//
// `bun run scope` reads an issue and prints its context pack: the names, paths, codes, rules and
// proposals the issue mentions; where the names are defined and who calls them (the code graph,
// or `git grep` when the graph does not describe that revision); the files ranked by named paths,
// definitions, the footprints of similar proposals and past issue fixes, and co-change; the
// compiler layers they reach and what each layer owes; the tests and gates to run.
//
// The issue comes from GitHub (`--issue`, through `gh api`, the REST API) or from a text file
// (`--text-file`, or standard input with `-`). `gh issue view --json` is GraphQL, which the proxy
// of a Claude Code cloud session refuses with a 403. The pack reads the repository at `--at`
// (default HEAD).
//
// A report, not a gate. CI does not run it. The steps are in scripts/scope/, and the pipeline is
// in the header of scripts/scope/seeds.ts.
//
// Usage, from the repository root:
//   bun run scope -- --issue <n> [--repo <owner/name>]
//   bun scripts/scope.ts (--issue <n> | --text-file <path> | --text-file -) [--at <rev>]
//                        [--limit <n>] [--szz] [--json | --markdown] [--repo <owner/name>]
//
// Exit codes: 0 after a pack; 2 for a usage error, when gh cannot read the issue, when `--at` is not
// a commit, or when the issue has no text. A git failure throws.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { git } from './scope/history.js';
import { buildPack, formatPackMarkdown } from './scope/pack.js';

const DEFAULT_REPO = 'typeshade/typeshade';

const USAGE = `Usage:
  bun scripts/scope.ts (--issue <n> | --text-file <path> | --text-file -) [--at <rev>]
                       [--limit <n>] [--szz] [--json | --markdown] [--repo <owner/name>]
`;

type Source =
  | { readonly kind: 'issue'; readonly number: number }
  | { readonly kind: 'text'; readonly path: string };

export type ParsedArgs =
  | { readonly kind: 'help' }
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'run';
      readonly source: Source;
      readonly at?: string;
      readonly limit?: number;
      readonly szz: boolean;
      readonly format: 'markdown' | 'json';
      readonly repo: string;
    };

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let issue: string | undefined;
  let textFile: string | undefined;
  let at: string | undefined;
  let limit: number | undefined;
  let szz = false;
  let json = false;
  let markdown = false;
  let repo = DEFAULT_REPO;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    switch (arg) {
      case '--help':
        return { kind: 'help' };
      case '--szz':
        szz = true;
        break;
      case '--json':
        json = true;
        break;
      case '--markdown':
        markdown = true;
        break;
      case '--issue':
      case '--text-file':
      case '--at':
      case '--limit':
      case '--repo': {
        const value = argv[i + 1];
        if (value === undefined) return { kind: 'error', message: `${arg} needs a value` };
        i++;
        if (arg === '--issue') {
          if (!/^\d+$/.test(value)) {
            return { kind: 'error', message: `--issue needs a whole number, got ${value}` };
          }
          issue = value;
        } else if (arg === '--text-file') textFile = value;
        else if (arg === '--at') at = value;
        else if (arg === '--repo') repo = value;
        else {
          if (!/^\d+$/.test(value) || Number(value) < 1) {
            return {
              kind: 'error',
              message: `--limit needs a whole number of at least 1, got ${value}`,
            };
          }
          limit = Number(value);
        }
        break;
      }
      default:
        return { kind: 'error', message: `unknown option ${arg}` };
    }
  }

  if (issue !== undefined && textFile !== undefined) {
    return { kind: 'error', message: 'use one of --issue and --text-file, not both' };
  }
  if (issue === undefined && textFile === undefined) {
    return { kind: 'error', message: 'one of --issue and --text-file is needed' };
  }
  if (json && markdown) {
    return { kind: 'error', message: '--json and --markdown do not go together' };
  }

  const source: Source =
    issue !== undefined
      ? { kind: 'issue', number: Number(issue) }
      : { kind: 'text', path: textFile ?? '' };
  return {
    kind: 'run',
    source,
    at,
    limit,
    szz,
    format: json ? 'json' : 'markdown',
    repo,
  };
}

function firstLine(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  const message = error instanceof Error ? error.message : String(error);
  const text = typeof stderr === 'string' && stderr.trim() !== '' ? stderr : message;
  return text.trim().split('\n')[0] ?? '';
}

export interface LoadedIssue {
  readonly title: string;
  readonly body: string;
  readonly number: number | null;
}

// The title, the body and every comment body, joined with blank lines. The two replies are the
// REST API's issue object and its comment pages. The comments argument is a JSON array of pages,
// as readIssue builds it.
export function issueFromReplies(
  number: number,
  issueJson: string,
  commentsJson: string,
): LoadedIssue {
  const issue: unknown = JSON.parse(issueJson);
  if (typeof issue !== 'object' || issue === null || Array.isArray(issue)) {
    throw new Error(`gh could not read issue ${number}: no issue object in the reply`);
  }
  const { title, body } = issue as { title?: unknown; body?: unknown };
  if (typeof title !== 'string' || (body !== null && typeof body !== 'string')) {
    throw new Error(`gh could not read issue ${number}: the reply has no title or body`);
  }

  const pages: unknown = JSON.parse(commentsJson);
  if (!Array.isArray(pages) || !pages.every((page: unknown) => Array.isArray(page))) {
    throw new Error(`gh could not read issue ${number}: the comments reply is not a list of pages`);
  }
  const commentBodies = (pages as unknown[][]).flat().map((comment: unknown) => {
    if (typeof comment !== 'object' || comment === null) {
      throw new Error(`gh could not read issue ${number}: a comment has no body`);
    }
    const text = (comment as { body?: unknown }).body;
    if (text !== null && typeof text !== 'string') {
      throw new Error(`gh could not read issue ${number}: a comment has no body`);
    }
    return typeof text === 'string' ? text : '';
  });
  const parts = [typeof body === 'string' ? body : '', ...commentBodies];
  return {
    title,
    body: parts.filter((part) => part.trim() !== '').join('\n\n'),
    number,
  };
}

// Reads the issue and its comments through the REST API. GraphQL (`gh issue view --json`) is
// refused by the proxy of some Claude Code cloud sessions with a 403, so this path never uses it.
function readIssue(number: number, repo: string): LoadedIssue {
  const gh = (path: string): string => {
    try {
      return execFileSync('gh', ['api', path], {
        encoding: 'utf8',
        maxBuffer: 64 << 20,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      throw new Error(`gh could not read issue ${number}: ${firstLine(error)}`);
    }
  };
  const issueJson = gh(`repos/${repo}/issues/${number}`);
  // One call per page. `gh api --paginate` follows the Link header, which names the repository by
  // its numeric id. The proxy of a Claude Code cloud session refuses that path with a 403.
  // A short page ends the list.
  const pages: unknown[] = [];
  for (let page = 1; ; page++) {
    const items: unknown = JSON.parse(
      gh(`repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`),
    );
    pages.push(items);
    if (!Array.isArray(items) || items.length < 100) break;
  }
  return issueFromReplies(number, issueJson, JSON.stringify(pages));
}

// The first line that starts with `# ` is the title; else the first non-empty line is.
function readTextFile(path: string): LoadedIssue {
  const raw = readFileSync(path === '-' ? 0 : path, 'utf8');
  const lines = raw.split('\n');
  const heading = lines.findIndex((line) => line.startsWith('# '));
  if (heading >= 0) {
    return {
      title: (lines[heading] ?? '').slice(2).trim(),
      body: lines.slice(heading + 1).join('\n'),
      number: null,
    };
  }
  const first = lines.findIndex((line) => line.trim() !== '');
  return {
    title: (lines[first] ?? '').trim(),
    body: first < 0 ? '' : lines.slice(first + 1).join('\n'),
    number: null,
  };
}

// `git rev-parse --verify --quiet` exits 1 for a name that is not a commit; any other failure throws.
function revisionExists(cwd: string, at: string): boolean {
  try {
    git(cwd, 'rev-parse', '--verify', '--quiet', `${at}^{commit}`);
    return true;
  } catch (error) {
    if ((error as { status?: unknown }).status === 1) return false;
    throw error;
  }
}

// The exit-2 message for an input the pack cannot use, or null when the input is good.
export function inputError(cwd: string, at: string, title: string, body: string): string | null {
  if (at !== '' && !revisionExists(cwd, at)) return `scope: unknown revision ${at}`;
  if (title.trim() === '' && body.trim() === '') return 'scope: the issue has no text';
  return null;
}

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.kind === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (parsed.kind === 'error') {
    process.stderr.write(`scope: ${parsed.message}\n${USAGE}`);
    return 2;
  }

  let issue: LoadedIssue;
  try {
    issue =
      parsed.source.kind === 'issue'
        ? readIssue(parsed.source.number, parsed.repo)
        : readTextFile(parsed.source.path);
  } catch (error) {
    process.stderr.write(`scope: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  const failure = inputError(process.cwd(), parsed.at ?? '', issue.title, issue.body);
  if (failure !== null) {
    process.stderr.write(`${failure}\n`);
    return 2;
  }

  const pack = await buildPack(process.cwd(), issue.title, issue.body, issue.number, {
    ...(parsed.at !== undefined ? { at: parsed.at } : {}),
    ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
    szz: parsed.szz,
  });
  process.stdout.write(
    parsed.format === 'json' ? `${JSON.stringify(pack, null, 2)}\n` : formatPackMarkdown(pack),
  );
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
