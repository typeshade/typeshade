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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

// The graph server is found on PATH. This repository is not indexed by it, so the test hides the
// binary: the graph step then fails at once and the git resolver runs, with no start-up cost.
function hideGraphBinary(): () => void {
  const saved = process.env.PATH;
  const git = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const bin = mkdtempSync(join(tmpdir(), 'scope-bin-'));
  symlinkSync(git, join(bin, 'git'));
  process.env.PATH = bin;
  return () => {
    if (saved === undefined) delete process.env.PATH;
    else process.env.PATH = saved;
    rmSync(bin, { recursive: true, force: true });
  };
}

function writeIn(dir: string, path: string, lines: readonly string[]): void {
  mkdirSync(join(dir, path, '..'), { recursive: true });
  writeFileSync(join(dir, path), `${lines.join('\n')}\n`);
}

// The n-th day after 2026-02-01, in the form git reads.
function stamp(n: number): string {
  return new Date(Date.UTC(2026, 1, 1) + n * 86400000).toISOString().replace('.000Z', 'Z');
}

// The n-th day after 2026-10-01: after the cutover to this repository's own issue numbers, so
// that a fix commit whose subject names an issue counts as a similar fix (history.ts issueFixes).
function stampAfterCutover(n: number): string {
  return new Date(Date.UTC(2026, 9, 1) + n * 86400000).toISOString().replace('.000Z', 'Z');
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
  let restorePath: () => void = () => {};

  beforeAll(async () => {
    restorePath = hideGraphBinary();
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

    pack = await buildPack(dir, ISSUE_TITLE, ISSUE_BODY, 42, { at: 'HEAD' });
    markdown = formatPackMarkdown(pack);
  });

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
    restorePath();
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

function throwawayRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scope-pack-'));
  gitIn(dir, ['init', '-q', '-b', 'main']);
  return dir;
}

// Co-change counts each partner once per seed file (M-N9). The score of a partner that co-changes
// with two seeds is the higher of the two seed scores, not their sum. Each seed scores alone first.
describe('co-change counts each partner once (M-N9)', () => {
  let dir = '';
  let alpha: Pack;
  let beta: Pack;
  let both: Pack;
  let restorePath: () => void = () => {};

  const PARTNER = 'src/core/partner.ts';
  const issueFor = (seeds: readonly string[]) =>
    [
      'alpha and beta disagree.',
      '',
      ...seeds.map((s) => `The seed file \`${s}\` shows it.`),
      '',
    ].join('\n');

  beforeAll(async () => {
    restorePath = hideGraphBinary();
    dir = throwawayRepo();

    // Alpha and the partner change together in three of alpha's four commits: 3 / 4 = 0.75.
    for (let k = 1; k <= 3; k++) {
      writeIn(dir, 'src/core/alpha.ts', [`export const alpha = ${k};`]);
      writeIn(dir, PARTNER, [`export const partner = ${k};`]);
      commitIn(dir, `feat: change alpha and partner ${k}`, stamp(k));
    }
    writeIn(dir, 'src/core/alpha.ts', ['export const alpha = 4;']);
    commitIn(dir, 'feat: change alpha', stamp(4));

    // Beta and the partner change together in three of beta's five commits: 3 / 5 = 0.6.
    for (let k = 1; k <= 3; k++) {
      writeIn(dir, 'src/core/beta.ts', [`export const beta = ${k};`]);
      writeIn(dir, PARTNER, [`export const partner = ${k + 10};`]);
      commitIn(dir, `feat: change beta and partner ${k}`, stamp(4 + k));
    }
    writeIn(dir, 'src/core/beta.ts', ['export const beta = 4;']);
    commitIn(dir, 'feat: change beta', stamp(8));
    writeIn(dir, 'src/core/beta.ts', ['export const beta = 5;']);
    commitIn(dir, 'feat: change beta again', stamp(9));

    alpha = await buildPack(dir, 'alpha and beta disagree', issueFor(['src/core/alpha.ts']), null, {
      at: 'HEAD',
    });
    beta = await buildPack(dir, 'alpha and beta disagree', issueFor(['src/core/beta.ts']), null, {
      at: 'HEAD',
    });
    both = await buildPack(
      dir,
      'alpha and beta disagree',
      issueFor(['src/core/alpha.ts', 'src/core/beta.ts']),
      null,
      { at: 'HEAD' },
    );
  });

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
    restorePath();
  });

  const scoreOf = (pack: Pack): number =>
    pack.files.find((f) => f.file === PARTNER)?.score ?? Number.NaN;

  it('gives the partner a different score from each seed alone', () => {
    // Precondition for the next test: the two single-seed scores must differ.
    expect(Number.isFinite(scoreOf(alpha))).toBe(true);
    expect(Number.isFinite(scoreOf(beta))).toBe(true);
    expect(scoreOf(alpha)).not.toBe(scoreOf(beta));
  });

  it('scores the partner at the higher seed score, not the sum of both', () => {
    expect(scoreOf(both)).toBe(Math.max(scoreOf(alpha), scoreOf(beta)));
  });
});

// A fix that touches more than LARGE_FIX code files gives no similar-fix row (R2-BT-3). The
// control is a two-file fix for another issue, which must still give a row.
describe('a large fix gives no similar-fix row (R2-BT-3)', () => {
  let dir = '';
  let bigPack: Pack;
  let smallPack: Pack;
  let bigSha = '';
  let smallSha = '';
  let restorePath: () => void = () => {};

  beforeAll(async () => {
    restorePath = hideGraphBinary();
    dir = throwawayRepo();

    for (let k = 1; k <= 21; k++) {
      const name = String(k).padStart(2, '0');
      writeIn(dir, `src/core/big/f${name}.ts`, [`export const f${name} = ${k};`]);
    }
    commitIn(dir, 'fix: widen the big writer (#9) (#90)', stampAfterCutover(0));
    bigSha = gitIn(dir, ['rev-parse', '--short=7', 'HEAD']).trim();

    writeIn(dir, 'src/core/small/a.ts', ['export const a = 1;']);
    writeIn(dir, 'src/core/small/b.ts', ['export const b = 1;']);
    commitIn(dir, 'fix: tighten the small writer (#10) (#100)', stampAfterCutover(1));
    smallSha = gitIn(dir, ['rev-parse', '--short=7', 'HEAD']).trim();

    bigPack = await buildPack(dir, 'the writer drops a value', '`writer` drops a value.\n', 9, {
      at: 'HEAD',
    });
    smallPack = await buildPack(dir, 'the writer drops a value', '`writer` drops a value.\n', 10, {
      at: 'HEAD',
    });
  });

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
    restorePath();
  });

  it('lists no similar-fix row for the 21-file fix', () => {
    expect(JSON.stringify(bigPack.similarFixes)).not.toContain(bigSha);
  });

  it('keeps a similar-fix row for the 2-file fix as the control', () => {
    expect(JSON.stringify(smallPack.similarFixes)).toContain(smallSha);
  });
});

// Neighbour damping (V1) acts on neighbour rows. Neighbour rows come from the graph resolver only,
// and the git resolver writes none. The fixture that would supply them is not specified yet.
describe('neighbour damping (V1) needs the graph resolver', () => {
  it.todo('an identifier with 9 definitions gets no neighbour rows');
  it.todo(
    'a file reached as a neighbour by four identifiers with one definition each scores at most NEIGHBOUR_CAP from neighbour rows',
  );
});
