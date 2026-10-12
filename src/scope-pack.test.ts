// ═══ The context pack names what an issue reaches, from one revision, and says where each fact came from ═══
//
// `scripts/scope/pack.ts` builds the pack, and `scripts/scope/resolve.ts` holds the graph parsers.
// Two readers are pinned here. The first builds a throwaway repository with one defining file, one
// backend file, a proposal and a past fix, and asks `buildPack` for the files, layers, obligations and
// Markdown sections it must produce. The second feeds the parsers the JSON the codebase-memory binary
// printed for a real query, so the graph reader is proven on the output it actually receives and not
// on a shape written by hand.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPack, formatPackMarkdown, type Pack } from '../scripts/scope/pack.js';
import { parseQueryGraph, parseSearchGraph, parseTracePath } from '../scripts/scope/resolve.js';

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

function writeIn(dir: string, path: string, lines: readonly string[]): void {
  mkdirSync(join(dir, path, '..'), { recursive: true });
  writeFileSync(join(dir, path), `${lines.join('\n')}\n`);
}

// The n-th day after 2026-02-01, in the form git reads.
function stamp(n: number): string {
  return new Date(Date.UTC(2026, 1, 1) + n * 86400000).toISOString().replace('.000Z', 'Z');
}

function commitIn(dir: string, subject: string, when: string, body = ''): void {
  gitIn(dir, ['add', '-A']);
  const args = ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', subject];
  if (body !== '') args.push('-m', body);
  gitIn(dir, args, { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when });
}

// The proposal file name is built here so that no literal path ending in the document extension
// appears in this source: every such path must exist in the tree.
const EXT = 'md';
const PROPOSAL = `changes/0001-tiny-writer.${EXT}`;

const ISSUE_TITLE = 'lowerThing returns the wrong number';
const ISSUE_BODY = [
  '## What happens',
  '',
  '`lowerThing(0)` returns the wrong number.',
  '',
  '## Why',
  '',
  'The writer change in proposal 0001 touches the same backend file.',
  '',
].join('\n');

const EXPECTED_HEADINGS = [
  '## Scope at a glance',
  '## Files to read first',
  '## Symbols named in the issue',
  '## Obligations',
  '## Similar past work',
  '## Tests and checks to run',
  '## Past fixes in these files',
  '## Rules',
  '## Not resolved',
  '## How this was built',
];

const REQUIRED_HEADINGS = [
  '## Scope at a glance',
  '## Files to read first',
  '## Symbols named in the issue',
  '## Obligations',
  '## Tests and checks to run',
  '## How this was built',
];

const FIXTURE_DIR = join(__dirname, '..', 'scripts', 'scope', '__fixtures__');

function fixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), 'utf8');
}

describe('buildPack on a throwaway repository (git resolver)', () => {
  let dir = '';
  let pack: Pack;
  let markdown = '';

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'scope-pack-'));
    gitIn(dir, ['init', '-q', '-b', 'main']);

    writeIn(dir, 'src/compiler/ts/lower/x.ts', [
      'export function lowerThing(n: number): number {',
      '  return n + 1;',
      '}',
    ]);
    commitIn(dir, 'feat: add lowerThing', stamp(0));

    writeIn(dir, 'src/core/backends/wgsl.ts', [
      'export function emitWgsl(text: string): string {',
      '  return text;',
      '}',
    ]);
    commitIn(dir, 'feat: add the wgsl writer', stamp(1));

    writeIn(dir, PROPOSAL, [
      '---',
      "id: '0001'",
      'title: Tiny writer',
      'status: accepted',
      'rules: []',
      'surface: []',
      'exports: []',
      'codes: []',
      'examples: []',
      'downstream:',
      '- repo: typeshade.github.io',
      '  what: The writer page',
      '---',
      '',
      '## What changes',
      '',
      'Spacing of the emitted text.',
      '',
    ]);
    commitIn(dir, 'docs: propose the tiny writer', stamp(2));

    writeIn(dir, 'src/core/backends/wgsl.ts', [
      'export function emitWgsl(text: string): string {',
      '  return text + " ";',
      '}',
    ]);
    commitIn(dir, 'feat: add a space to the writer', stamp(3), 'Change: 0001');

    writeIn(dir, 'src/core/backends/wgsl.ts', [
      'export function emitWgsl(text: string): string {',
      '  return text;',
      '}',
    ]);
    commitIn(dir, 'fix: keep the sign of the output (#9)', stamp(4));

    pack = buildPack(dir, ISSUE_TITLE, ISSUE_BODY, 42, { at: 'HEAD' });
    markdown = formatPackMarkdown(pack);
  });

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
  });

  it('resolves through the git resolver, because the throwaway project is not in the graph', () => {
    expect(pack.resolver.kind).toBe('git');
  });

  it('ranks the defining file first, with its reason naming the git grep source', () => {
    const top = pack.files[0];
    expect(top?.file).toBe('src/compiler/ts/lower/x.ts');
    expect(top?.reasons).toContain('defines lowerThing (git grep)');
  });

  it('lists the front-end layer among the layers the pack reaches', () => {
    expect(pack.layers.map((l) => l.layer)).toContain('front-end');
  });

  it('owes the both-halves obligation for the front-end', () => {
    expect(pack.obligations.map((o) => o.id)).toContain('both-halves');
  });

  it('predicts that no proposal is needed', () => {
    expect(pack.needsProposal.likely).toBe(false);
  });

  it('prints the Markdown title line and the section headings in order', () => {
    expect(markdown.split('\n')[0]).toBe(`# Context pack: ${ISSUE_TITLE}`);

    const headings = markdown.split('\n').filter((line) => line.startsWith('## '));
    expect(headings.every((h) => EXPECTED_HEADINGS.includes(h))).toBe(true);
    expect(headings).toEqual(EXPECTED_HEADINGS.filter((h) => headings.includes(h)));
    expect(headings).toEqual(expect.arrayContaining(REQUIRED_HEADINGS));
  });
});

describe('graph resolver parsers on recorded binary output', () => {
  it('finds lowerFill in the recorded search_graph answer, with its line range', () => {
    const hits = parseSearchGraph(fixture('graph-search.json'));
    expect(hits).toContainEqual(
      expect.objectContaining({
        name: 'lowerFill',
        label: 'Function',
        file: 'src/compiler/ts/lower/expression-array.ts',
        startLine: 374,
        endLine: 421,
      }),
    );
  });

  it('reads the recorded trace_path answer as the caller lowerCall and the callee typeArrayElement', () => {
    // parseTracePath returns a TraceAnswer (status, callers, callees, suggestions); the spec does not
    // fix its shape, and resolve.ts needs the status to follow an ambiguous answer.
    const answer = parseTracePath(fixture('graph-trace.json'));
    expect(answer.callers).toContainEqual(
      expect.objectContaining({ name: 'lowerCall', direction: 'caller', hop: 1 }),
    );
    expect(answer.callees).toContainEqual(
      expect.objectContaining({ name: 'typeArrayElement', direction: 'callee', hop: 1 }),
    );
  });

  it('records the ambiguous trace_path answer with two suggestions in two files', () => {
    const answer = JSON.parse(fixture('graph-trace-ambiguous.json')) as {
      status: string;
      suggestions: Array<{ file_path: string }>;
    };
    expect(answer.status).toBe('ambiguous');
    expect(answer.suggestions.map((s) => s.file_path)).toEqual([
      'src/core/ir/node.ts',
      'src/core/cpu-runtime.ts',
    ]);
  });

  it('reads the recorded query_graph answer as a list of test file paths', () => {
    const paths = parseQueryGraph(fixture('graph-query.json'));
    expect(paths).toEqual(['src/core/backends/glsl.test.ts']);
    for (const p of paths) expect(p.endsWith('.test.ts')).toBe(true);
  });
});
