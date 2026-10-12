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
import {
  buildPack,
  formatPackMarkdown,
  NEIGHBOUR_CAP,
  NEIGHBOUR_DAMP,
  type Pack,
} from '../scripts/scope/pack.js';
import {
  parseQueryGraph,
  parseSearchGraph,
  parseTracePath,
  type Neighbour,
  type Resolver,
  type SymbolHit,
} from '../scripts/scope/resolve.js';

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

// Neighbour damping (V1) acts on neighbour rows. Only the graph resolver writes them, so each case
// hands buildPack a scripted graph through `openGraph` over a clean HEAD. The three cases share one
// throwaway repository and name different identifiers, so no case reads another's rows.
describe('neighbour damping (V1) on a scripted graph resolver', () => {
  let dir = '';
  let restorePath: () => void = () => {};
  const calls: string[] = [];
  let crowdPack: Pack;
  let crowdNeighbourCalls: string[] = [];
  let sharedPack: Pack;
  let twinPack: Pack;

  const CROWD = Array.from({ length: 9 }, (_, i) => `src/core/crowd/c${i + 1}.ts`);
  const DEFS = ['zorn', 'quill', 'vexa', 'kelp'];
  const TWINS = ['src/core/twin/t1.ts', 'src/core/twin/t2.ts'];
  const CALLEE = 'src/core/shared/callee.ts';
  const CALLER = 'src/core/far/caller.ts';
  const PING = 'src/core/far/ping.ts';

  const hit = (name: string, file: string): SymbolHit => ({
    name,
    label: 'Function',
    file,
    startLine: 1,
    endLine: 3,
  });
  const hits: Record<string, SymbolHit[]> = {
    crowded: CROWD.map((file) => hit('crowded', file)),
    ...Object.fromEntries(DEFS.map((name) => [name, [hit(name, `src/core/defs/${name}.ts`)]])),
    twin: TWINS.map((file) => hit('twin', file)),
  };

  const scripted: Resolver = {
    kind: 'graph',
    note: 'fake graph',
    async find(name: string) {
      return hits[name] ?? [];
    },
    async neighbours(h: SymbolHit) {
      calls.push(h.name);
      const callee: Neighbour = { name: 'callee', file: CALLEE, hop: 1, direction: 'callee' };
      const caller: Neighbour = { name: 'caller', file: CALLER, hop: 1, direction: 'caller' };
      const ping: Neighbour = { name: 'ping', file: PING, hop: 1, direction: 'caller' };
      if (CROWD.includes(h.file)) return { callers: [ping], callees: [] };
      if (h.name === 'twin') return { callers: [caller], callees: [] };
      return { callers: [], callees: [callee] };
    },
    async testsOf() {
      return [];
    },
    async close() {},
  };
  const openGraph = async () => ({ resolver: scripted, why: '' });

  beforeAll(async () => {
    restorePath = hideGraphBinary();
    dir = throwawayRepo();

    for (const file of CROWD) {
      writeIn(dir, file, ['export function crowded(): number {', '  return 1;', '}']);
    }
    for (const name of DEFS) {
      writeIn(dir, `src/core/defs/${name}.ts`, [
        `export function ${name}(n: number): number {`,
        '  return n;',
        '}',
      ]);
    }
    writeIn(dir, CALLEE, ['export const callee = 1;']);
    for (const file of TWINS) {
      writeIn(dir, file, ['export function twin(): number {', '  return 2;', '}']);
    }
    writeIn(dir, CALLER, ['export const caller = 3;']);
    writeIn(dir, PING, ['export const ping = 4;']);
    commitIn(dir, 'feat: add the scripted fixtures', stamp(0));

    calls.length = 0;
    crowdPack = await buildPack(
      dir,
      'crowded returns the wrong number',
      '`crowded(0)` returns the wrong number.\n',
      null,
      { at: 'HEAD', openGraph },
    );
    crowdNeighbourCalls = calls.filter((name) => name === 'crowded');

    calls.length = 0;
    sharedPack = await buildPack(
      dir,
      'four helpers disagree',
      '`zorn(0)`, `quill(0)`, `vexa(0)` and `kelp(0)` disagree.\n',
      null,
      { at: 'HEAD', openGraph },
    );

    twinPack = await buildPack(dir, 'twin disagrees', '`twin(0)` disagrees.\n', null, {
      at: 'HEAD',
      openGraph,
    });
  });

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
    restorePath();
  });

  it('defines crowded through the scripted graph, so the case is not vacuous', () => {
    expect(crowdPack.resolver.kind).toBe('graph');
    expect(crowdPack.files.some((f) => f.reasons.includes('defines crowded (graph)'))).toBe(true);
  });

  it('never asks for the neighbours of an identifier with 9 definitions', () => {
    expect(crowdNeighbourCalls).toHaveLength(0);
  });

  it('gives no calls or called-by reason that names the 9-definition identifier', () => {
    const named = crowdPack.files
      .flatMap((f) => f.reasons)
      .filter((r) => /^(calls|called by) /.test(r) && r.includes('crowded'));
    expect(named).toEqual([]);
  });

  it('adds at most NEIGHBOUR_CAP neighbour points to a file reached by four single-definition identifiers', () => {
    const row = sharedPack.files.find((f) => f.file === CALLEE);
    expect(row).toBeDefined();
    expect(row?.score ?? Number.NaN).toBeLessThanOrEqual(NEIGHBOUR_CAP);
    const neighbourReasons = (row?.reasons ?? []).filter((r) => r.startsWith('called by '));
    expect(neighbourReasons.length).toBeLessThanOrEqual(NEIGHBOUR_CAP);
  });

  it('adds min(1, NEIGHBOUR_DAMP / 2) for each neighbour row of an identifier with two definitions', () => {
    const row = twinPack.files.find((f) => f.file === CALLER);
    expect(row).toBeDefined();
    expect(row?.score).toBe(2 * Math.min(1, NEIGHBOUR_DAMP / 2));
  });
});

// A graph answered from tables: `defs` gives the definition files of each identifier, `callees`
// the callee files of a definition file, and `tests` the testsOf answer of a source file.
interface GraphTables {
  readonly defs: Record<string, readonly string[]>;
  readonly callees?: Record<string, readonly string[]>;
  readonly tests?: Record<string, readonly string[]>;
}

function tabledGraph(tables: GraphTables): Resolver {
  return {
    kind: 'graph',
    note: 'tabled graph',
    async find(name) {
      return (tables.defs[name] ?? []).map((file): SymbolHit => ({
        name,
        label: 'Function',
        file,
        startLine: 1,
        endLine: 3,
      }));
    },
    async neighbours(hit) {
      const callees = (tables.callees?.[hit.file] ?? []).map((file): Neighbour => ({
        name: 'callee',
        file,
        hop: 1,
        direction: 'callee',
      }));
      return { callers: [], callees };
    },
    async testsOf(file) {
      return [...(tables.tests?.[file] ?? [])];
    },
    async close() {},
  };
}

function openTabled(tables: GraphTables): () => Promise<{ resolver: Resolver; why: string }> {
  const resolver = tabledGraph(tables);
  return async () => ({ resolver, why: '' });
}

function writeAll(dir: string, files: readonly string[], lines: readonly string[]): void {
  for (const file of files) writeIn(dir, file, lines);
}

describe('neighbour rows are damped by the definition count (T1)', () => {
  let dir = '';
  let pack: Pack;
  let restorePath: () => void = () => {};
  const ONLY = 'src/core/reach/only.ts';

  beforeAll(async () => {
    restorePath = hideGraphBinary();
    dir = throwawayRepo();
    const sixDefs = Array.from({ length: 6 }, (_, i) => `src/core/cluster/s${i + 1}.ts`);
    writeAll(dir, sixDefs, ['export function sixer(n: number): number {', '  return n;', '}']);
    writeIn(dir, ONLY, ['export const only = 1;']);
    commitIn(dir, 'feat: add the sixer definitions', stamp(0));

    pack = await buildPack(
      dir,
      'sixer returns the wrong number',
      '`sixer(0)` returns the wrong number.\n',
      null,
      {
        at: 'HEAD',
        openGraph: openTabled({
          defs: { sixer: sixDefs },
          callees: { [sixDefs[0] ?? '']: [ONLY] },
        }),
      },
    );
  });

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
    restorePath();
  });

  it('gives the file reached by one row of a six-definition identifier min(1, NEIGHBOUR_DAMP / 6)', () => {
    const row = pack.files.find((f) => f.file === ONLY);
    expect(row).toBeDefined();
    expect(row?.score ?? Number.NaN).toBe(Math.min(1, NEIGHBOUR_DAMP / 6));
  });
});

describe('neighbour rows are never direct reasons (T2)', () => {
  let dir = '';
  let pack: Pack;
  let restorePath: () => void = () => {};
  const WGSL = 'src/core/backends/wgsl.ts';

  beforeAll(async () => {
    restorePath = hideGraphBinary();
    dir = throwawayRepo();
    writeIn(dir, 'src/compiler/ts/lower/named.ts', ['export const named = 1;']);
    writeIn(dir, 'src/compiler/ts/lower/anchor.ts', [
      'export function spindle(n: number): number {',
      '  return n;',
      '}',
    ]);
    writeIn(dir, WGSL, ['export const wgsl = 1;']);
    commitIn(dir, 'feat: add the named, anchor and wgsl files', stamp(0));

    pack = await buildPack(
      dir,
      'spindle is wrong',
      '`spindle(0)` is wrong. The file `src/compiler/ts/lower/named.ts` shows it.\n',
      null,
      {
        at: 'HEAD',
        openGraph: openTabled({
          defs: { spindle: ['src/compiler/ts/lower/anchor.ts'] },
          callees: { 'src/compiler/ts/lower/anchor.ts': [WGSL] },
        }),
      },
    );
  });

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
    restorePath();
  });

  it('ranks the callee, reached by a neighbour row only, among the files', () => {
    const row = pack.files.find((f) => f.file === WGSL);
    expect(row?.reasons).toContain('called by spindle (graph)');
  });

  it('takes deepest from the direct files (front-end), not from the deeper neighbour-only callee', () => {
    expect(pack.deepestFrom).toBe('direct');
    expect(pack.deepest).toBe('front-end');
  });
});

describe('an identifier with more than SPECIFIC_MAX definitions is not direct (T3)', () => {
  let dir = '';
  let pack: Pack;
  let restorePath: () => void = () => {};
  const DEEP = 'src/core/host-kernel.ts';

  beforeAll(async () => {
    restorePath = hideGraphBinary();
    dir = throwawayRepo();
    writeIn(dir, 'src/compiler/ts/lower/named.ts', ['export const named = 1;']);
    writeAll(
      dir,
      ['src/compiler/ts/lower/q1.ts', 'src/compiler/ts/lower/q2.ts', 'src/compiler/ts/lower/q3.ts'],
      ['export function quad(n: number): number {', '  return n;', '}'],
    );
    writeIn(dir, DEEP, ['export function quad(n: number): number {', '  return n;', '}']);
    commitIn(dir, 'feat: add the quad definitions', stamp(0));

    pack = await buildPack(
      dir,
      'quad is wrong',
      '`quad(0)` is wrong. The file `src/compiler/ts/lower/named.ts` shows it.\n',
      null,
      {
        at: 'HEAD',
        openGraph: openTabled({
          defs: {
            quad: [
              'src/compiler/ts/lower/q1.ts',
              'src/compiler/ts/lower/q2.ts',
              'src/compiler/ts/lower/q3.ts',
              DEEP,
            ],
          },
        }),
      },
    );
  });

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
    restorePath();
  });

  it('ranks the deep definition, so the case is not vacuous', () => {
    expect(pack.files.some((f) => f.file === DEEP)).toBe(true);
  });

  it('takes deepest from the named front-end file, not from the deep definition', () => {
    expect(pack.deepestFrom).toBe('direct');
    expect(pack.deepest).toBe('front-end');
  });
});

describe('bucket (0) takes a defining test file only for a specific identifier (T4, I1)', () => {
  let dir = '';
  let single: Pack;
  let crowd: Pack;
  let restorePath: () => void = () => {};
  const SIBLING = 'src/core/widget.test.ts';
  const TALLY = 'src/core/tally.test.ts';
  const QUAD = Array.from({ length: 4 }, (_, i) => `src/core/fourfold/f${i + 1}.test.ts`);

  beforeAll(async () => {
    restorePath = hideGraphBinary();
    dir = throwawayRepo();
    writeIn(dir, 'src/core/widget.ts', [
      'export function widget(n: number): number {',
      '  return n;',
      '}',
    ]);
    writeIn(dir, SIBLING, ['// covers widget', 'export {};']);
    writeIn(dir, TALLY, ['// covers tally', 'export {};']);
    writeAll(dir, QUAD, ['// covers quad', 'export {};']);
    commitIn(dir, 'feat: add widget, tally and the quad tests', stamp(0));

    const issue = (name: string) =>
      `\`${name}(0)\` is wrong. The file \`src/core/widget.ts\` shows it.\n`;
    single = await buildPack(dir, 'tally is wrong', issue('tally'), null, {
      at: 'HEAD',
      openGraph: openTabled({ defs: { tally: [TALLY] } }),
    });
    crowd = await buildPack(dir, 'quad is wrong', issue('quad'), null, {
      at: 'HEAD',
      openGraph: openTabled({ defs: { quad: [...QUAD] } }),
    });
  });

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
    restorePath();
  });

  it('puts the one defining test file first, ahead of the sibling test of the top file', () => {
    expect(single.tests[0]).toBe(TALLY);
    expect(single.tests.indexOf(SIBLING)).toBeGreaterThan(0);
  });

  it('puts none of four defining test files in bucket (0), ahead of the sibling test', () => {
    expect(crowd.tests[0]).toBe(SIBLING);
    const before = crowd.tests.slice(0, crowd.tests.indexOf(SIBLING));
    expect(before).toEqual([]);
  });
});

describe('bucket (d) takes at most three other tests per top file (T5)', () => {
  let dir = '';
  let pack: Pack;
  let restorePath: () => void = () => {};
  const TOP = ['alpha', 'beta', 'gamma', 'delta'].map((name) => `src/core/${name}/${name}.ts`);
  const siblingOf = (file: string) => file.replace(/\.ts$/, '.test.ts');
  const extrasOf = (name: string) =>
    Array.from({ length: 5 }, (_, i) => `src/checks/${name}-${i + 1}.test.ts`);
  const NAMES = ['alpha', 'beta', 'gamma', 'delta'];

  beforeAll(async () => {
    restorePath = hideGraphBinary();
    dir = throwawayRepo();
    for (const file of TOP) {
      writeIn(dir, file, ['export const value = 1;']);
      writeIn(dir, siblingOf(file), ['// covers the file', 'export {};']);
    }
    for (const name of NAMES) writeAll(dir, extrasOf(name), ['// covers the file', 'export {};']);
    commitIn(dir, 'feat: add the four top files and their tests', stamp(0));

    const tests: Record<string, string[]> = {};
    TOP.forEach((file, i) => {
      tests[file] = [siblingOf(file), ...extrasOf(NAMES[i] ?? '')];
    });
    pack = await buildPack(
      dir,
      'the four files list the wrong checks',
      `The files \`${TOP.join('`, `')}\` list the wrong checks.\n`,
      null,
      { at: 'HEAD', openGraph: openTabled({ defs: {}, tests }) },
    );
  });

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
    restorePath();
  });

  it('counts more candidate tests than the cap, so the list is cut at 20', () => {
    expect(pack.testsTotal).toBe(24);
    expect(pack.tests).toHaveLength(20);
  });

  it('lists exactly three of the first top file extra tests before any bucket (e) entry', () => {
    expect(pack.files[0]?.file).toBe(TOP[0]);
    const extras = extrasOf('alpha');
    // Bucket (d): the first three extra tests of each top file. Bucket (e): the rest of them.
    const bucketD = NAMES.flatMap((name) => extrasOf(name).slice(0, 3));
    const bucketE = NAMES.flatMap((name) => extrasOf(name).slice(3));
    const dAt = bucketD.map((t) => pack.tests.indexOf(t));
    expect(dAt.every((i) => i >= 0)).toBe(true);
    const eAt = bucketE.map((t) => pack.tests.indexOf(t)).filter((i) => i >= 0);
    expect(eAt.length).toBeGreaterThan(0);
    const firstE = Math.min(...eAt);
    expect(Math.max(...dAt)).toBeLessThan(firstE);
    const before = pack.tests.slice(0, firstE).filter((t) => extras.includes(t));
    expect(before).toEqual(extras.slice(0, 3));
  });
});

// The deepest layer comes from the best-ranked files with a direct reason (DEEPEST_DIRECT_TOP). A
// direct file far down the list must not set the layer for the whole pack.
describe('the deepest layer comes from the best-ranked direct files (DEEPEST_DIRECT_TOP)', () => {
  describe('three best-ranked direct files in front-end, a direct runtime file below them (a)', () => {
    let dir = '';
    let pack: Pack;
    let markdown = '';
    let restorePath: () => void = () => {};

    beforeAll(async () => {
      restorePath = hideGraphBinary();
      dir = throwawayRepo();
      writeAll(
        dir,
        [
          'src/compiler/ts/lower/f1.ts',
          'src/compiler/ts/lower/f2.ts',
          'src/compiler/ts/lower/f3.ts',
        ],
        ['export const v = 1;'],
      );
      writeIn(dir, 'src/runtime/r1.ts', [
        'export function gadget(n: number): number {',
        '  return n;',
        '}',
      ]);
      commitIn(dir, 'feat: add the four files', stamp(0));

      pack = await buildPack(
        dir,
        'gadget is wrong',
        [
          '`gadget(0)` is wrong. The files `src/compiler/ts/lower/f1.ts`,',
          '`src/compiler/ts/lower/f2.ts` and `src/compiler/ts/lower/f3.ts` show it.',
          '',
        ].join('\n'),
        null,
        { at: 'HEAD' },
      );
      markdown = formatPackMarkdown(pack);
    });

    afterAll(() => {
      if (dir !== '') rmSync(dir, { recursive: true, force: true });
      restorePath();
    });

    it('ranks the runtime definition fourth, so the case is not vacuous', () => {
      const files = pack.files.map((f) => f.file);
      expect(files.indexOf('src/runtime/r1.ts')).toBe(3);
      expect(files.slice(0, 3).every((f) => f.startsWith('src/compiler/'))).toBe(true);
    });

    it('takes deepest from the three best-ranked direct files (front-end), not the runtime file', () => {
      expect(pack.deepestFrom).toBe('direct');
      expect(pack.deepest).toBe('front-end');
    });

    it('says in the Markdown that the layer comes from the three best-ranked direct files', () => {
      expect(markdown).toContain('(from the 3 best-ranked files with a direct reason)');
    });

    it('sets directFiles to the size of the pool the layer came from (3)', () => {
      expect(pack.directFiles).toBe(3);
    });
  });

  describe('the best-ranked direct files are all language-service, the fourth direct file is emit (b)', () => {
    let dir = '';
    let pack: Pack;
    let restorePath: () => void = () => {};

    beforeAll(async () => {
      restorePath = hideGraphBinary();
      dir = throwawayRepo();
      writeAll(
        dir,
        ['src/language-service/l1.ts', 'src/language-service/l2.ts', 'src/language-service/l3.ts'],
        ['export const v = 1;'],
      );
      writeIn(dir, 'src/core/emit-main.ts', [
        'export function gadget(n: number): number {',
        '  return n;',
        '}',
      ]);
      commitIn(dir, 'feat: add the language-service files and the emit definition', stamp(0));

      pack = await buildPack(
        dir,
        'gadget is wrong',
        [
          '`gadget(0)` is wrong. The files `src/language-service/l1.ts`,',
          '`src/language-service/l2.ts` and `src/language-service/l3.ts` show it.',
          '',
        ].join('\n'),
        null,
        { at: 'HEAD' },
      );
    });

    afterAll(() => {
      if (dir !== '') rmSync(dir, { recursive: true, force: true });
      restorePath();
    });

    it('ranks the emit definition fourth among the direct files, so the case is not vacuous', () => {
      const files = pack.files.map((f) => f.file);
      expect(files.slice(0, 3).every((f) => f.startsWith('src/language-service/'))).toBe(true);
      expect(files[3]).toBe('src/core/emit-main.ts');
    });

    it('widens the pool to the top five direct files and takes deepest from emit', () => {
      expect(pack.deepestFrom).toBe('direct');
      expect(pack.deepest).toBe('emit');
    });

    it('sets directFiles to the widened pool (4 direct files exist)', () => {
      expect(pack.directFiles).toBe(4);
    });
  });
});
