// ═══ The pack's tests, rule tags, proposals and history rows, each pinned on a throwaway repository ═══
//
// `scripts/scope/pack.ts` ranks source files and lists tests, `scripts/reqs-sync.ts` reads rule tags,
// and `scripts/scope/history.ts` reads proposals at one revision. Each case below builds the smallest
// repository that shows one rule: a test file is never a ranked source file; a proposal is read at the
// revision asked for, not from the working tree; a rule tag names the rules its file verifies; the test
// list is capped in tiers; a history row that names a document ranks nothing; the path words rank a file.
//
// The source text of this file spells the rule-tag word in parts. `reqs-sync` reads every tag in the
// tree, so a literal tag here would add a requirement link this file does not own.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers';
import {
  buildPack as buildPackWithGraph,
  formatPackMarkdown,
  type Pack,
} from '../scripts/scope/pack.js';
import { noisyCommits, readHistory, readProposals } from '../scripts/scope/history.js';
import { ruleTags } from '../scripts/reqs-sync.js';

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

function throwawayRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scope-rules-'));
  gitIn(dir, ['init', '-q', '-b', 'main']);
  return dir;
}

// Exercise the real Git fallback through its existing graph-opening seam. These fixtures
// have no graph; neither a POSIX shell nor a temporary process-wide PATH is needed.
const buildPack: typeof buildPackWithGraph = async (cwd, title, body, issue, options) => {
  // Give the worker's reporter/IPC a turn between synchronous Git batches.
  await new Promise<void>((done) => setImmediate(done));
  const pack = await buildPackWithGraph(cwd, title, body, issue, {
    ...options,
    openGraph:
      options?.openGraph ??
      (async () => ({ resolver: null, why: 'The test fixture has no code graph.' })),
  });
  await new Promise<void>((done) => setImmediate(done));
  return pack;
};

// Document names are built here so that no literal path ending in the document extension appears in
// this source: every such path must exist in the tree.
const EXT = 'md';
const CHANGELOG = `CHANGELOG.${EXT}`;
const PROPOSAL_1 = `changes/0001-tiny.${EXT}`;
const PROPOSAL_2 = `changes/0002-later.${EXT}`;
const PROPOSAL_DETERMINISM = `changes/0001-determinism.${EXT}`;

// A rule tag, spelled in parts (see the header).
const VERIFIES = `Verif${'ies'}`;
const tag = (rules: string): string => `// ${VERIFIES}: ${rules}`;

// A rule number that the rules document does not define. Built from parts so the literal does not
// reach the reference check, which reads every `Rule N.M` in this file.
const UNDEFINED_RULE = `1.${'10'}`;

function proposalLines(id: string, title: string): string[] {
  return [
    '---',
    `id: '${id}'`,
    `title: ${title}`,
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
    `${title} changes the emitted text.`,
    '',
  ];
}

describe('a test file is never a ranked source file (S3)', () => {
  let dir = '';
  let pack: Pack;

  beforeAll(async () => {
    dir = throwawayRepo();

    writeIn(dir, 'src/compiler/ts/lower/gizmo.ts', [
      'export function gizmoLower(n: number): number {',
      '  return n + 1;',
      '}',
    ]);
    commitIn(dir, 'feat: add gizmoLower', stamp(0));

    writeIn(dir, 'src/compiler/ts/lower/gizmo.test.ts', [
      'export function fixtureGizmo(): number {',
      '  return 1;',
      '}',
    ]);
    commitIn(dir, 'test: cover gizmoLower', stamp(1));

    pack = await buildPack(
      dir,
      'gizmoLower returns the wrong number',
      [
        '## What happens',
        '',
        '`gizmoLower(0)` is wrong. The test `src/compiler/ts/lower/gizmo.test.ts` shows it,',
        'and `fixtureGizmo` builds the input.',
        '',
      ].join('\n'),
      null,
      { at: 'HEAD' },
    );
  });

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
  });

  it('ranks the defining source file', () => {
    expect(pack.files.map((f) => f.file)).toContain('src/compiler/ts/lower/gizmo.ts');
  });

  it('keeps every test file out of files', () => {
    expect(pack.files.some((f) => f.file.includes('.test.'))).toBe(false);
  });

  it('lists the named test file and the sibling test in tests', () => {
    expect(pack.tests).toContain('src/compiler/ts/lower/gizmo.test.ts');
  });
});

describe('readProposals reads the revision it is asked for (S4)', () => {
  let dir = '';
  let shaA = '';
  let shaB = '';

  const proposalsAt = (at: string) => {
    const history = readHistory(dir, at);
    return readProposals(dir, at, history, noisyCommits(dir, at, history));
  };

  beforeAll(() => {
    dir = throwawayRepo();

    writeIn(dir, 'src/core/note.ts', ['export const note = 1;']);
    commitIn(dir, 'feat: add note', stamp(0));
    shaA = gitIn(dir, ['rev-parse', 'HEAD']).trim();

    writeIn(dir, PROPOSAL_1, proposalLines('0001', 'Tiny writer'));
    commitIn(dir, 'docs: propose the tiny writer', stamp(1));
    shaB = gitIn(dir, ['rev-parse', 'HEAD']).trim();

    writeIn(dir, PROPOSAL_2, proposalLines('0002', 'Later writer'));
    commitIn(dir, 'docs: propose the later writer', stamp(2));

    // An edit that is never committed: the working tree holds it, the revision does not.
    writeIn(dir, PROPOSAL_1, proposalLines('0001', 'Edited on disk'));
  });

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
  });

  it('finds no proposal at the revision before the first one was added', () => {
    expect(proposalsAt(shaA)).toEqual([]);
  });

  it('does not find a proposal added in a later commit', () => {
    const ids = proposalsAt(shaB).map((p) => p.id);
    expect(ids).toEqual(['0001']);
  });

  it('reads the committed front matter at HEAD, not the uncommitted edit', () => {
    const proposals = proposalsAt('HEAD');
    expect(proposals.map((p) => p.id).sort()).toEqual(['0001', '0002']);
    expect(proposals.find((p) => p.id === '0001')?.title).toBe('Tiny writer');
  });
});

describe('rule tags (F1)', () => {
  it('reads every rule a tag names, in order of appearance', () => {
    const found = ruleTags(tag('Rule 1.1, Rule 9.5')).map((t) => [t.kind, t.rule]);
    expect(found).toEqual([
      ['Verifies', '1.1'],
      ['Verifies', '9.5'],
    ]);
  });

  describe('verifiedBy on a throwaway repository', () => {
    let dir = '';
    let pack: Pack;

    beforeAll(async () => {
      dir = throwawayRepo();

      writeIn(dir, 'src/core/widget.ts', ['export const widget = 1;']);
      writeIn(dir, 'a.test.ts', [tag('Rule 1.1, Rule 9.5'), 'export {};']);
      writeIn(dir, 'b.test.ts', [tag(`Rule ${UNDEFINED_RULE}`), 'export {};']);
      commitIn(dir, 'feat: add widget and its tests', stamp(0));

      pack = await buildPack(
        dir,
        'Rules 1.1 and 9.5 do not hold',
        'The check fails under Rules 1.1 and 9.5.\n',
        null,
        { at: 'HEAD' },
      );
    });

    afterAll(() => {
      if (dir !== '') rmSync(dir, { recursive: true, force: true });
    });

    it('lists a.test.ts as the verifying file of Rule 1.1', () => {
      expect(pack.rules.find((r) => r.rule === '1.1')?.verifiedBy).toEqual(['a.test.ts']);
    });

    it('lists a.test.ts as the verifying file of Rule 9.5', () => {
      expect(pack.rules.find((r) => r.rule === '9.5')?.verifiedBy).toEqual(['a.test.ts']);
    });

    it('does not list b.test.ts for a rule the issue names', () => {
      expect(pack.rules.flatMap((r) => r.verifiedBy)).not.toContain('b.test.ts');
    });
  });
});

describe('the tests list is capped in tiers (F2)', () => {
  let dir = '';
  let pack: Pack;
  let markdown = '';

  beforeAll(async () => {
    dir = throwawayRepo();

    // Tier 1: the sibling test of the top file.
    writeIn(dir, 'src/compiler/ts/lower/widget.ts', [
      'export function widget(n: number): number {',
      '  return n;',
      '}',
    ]);
    writeIn(dir, 'src/compiler/ts/lower/widget.test.ts', ['export {};']);

    // Tier 2: 25 files that verify the rule the issue names; none of them is a sibling of the top file.
    for (let k = 1; k <= 25; k++) {
      const name = String(k).padStart(2, '0');
      writeIn(dir, `src/core/checks/rule-check-${name}.test.ts`, [tag('Rule 1.1'), 'export {};']);
    }
    commitIn(dir, 'feat: add widget and its checks', stamp(0));

    pack = await buildPack(
      dir,
      'widget returns the wrong number',
      '`widget(1)` returns the wrong number under Rules 1.1.\n',
      null,
      { at: 'HEAD' },
    );
    markdown = formatPackMarkdown(pack);
  });

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
  });

  it('counts every candidate test in testsTotal', () => {
    expect(pack.testsTotal).toBe(26);
  });

  it('keeps 20 tests', () => {
    expect(pack.tests).toHaveLength(20);
  });

  it('keeps the tier 1 test before the tier 2 tests', () => {
    expect(pack.tests[0]).toBe('src/compiler/ts/lower/widget.test.ts');
    expect(pack.tests.slice(1).every((t) => t.startsWith('src/core/checks/rule-check-'))).toBe(
      true,
    );
  });

  it('states how many tests the cut left out', () => {
    expect(markdown).toContain('… and 6 more');
  });
});

describe('history rows rank code only, path words and the deepest layer (backtest F1, F4, F6)', () => {
  let dir = '';
  let pack: Pack;

  // Real Git setup and pack reads exceeded the default 10s hook budget under Windows
  // worker contention. Match the suite's existing 90s test budget for this setup only.
  beforeAll(async () => {
    dir = throwawayRepo();

    writeIn(dir, PROPOSAL_DETERMINISM, proposalLines('0001', 'Determinism pass'));
    writeIn(dir, 'src/core/passes/determinism.ts', [
      'export function determinismCheck(text: string): boolean {',
      '  return text.length > 0;',
      '}',
    ]);
    commitIn(dir, 'docs: propose the determinism pass', stamp(0));

    writeIn(dir, 'src/core/passes/determinism.ts', [
      'export function determinismCheck(text: string): boolean {',
      '  return text.length > 1;',
      '}',
    ]);
    writeIn(dir, CHANGELOG, ['# Changelog', '', '- The determinism pass is tighter.']);
    commitIn(dir, 'feat: tighten the determinism pass', stamp(1), 'Change: 0001');

    pack = await buildPack(
      dir,
      'determinism reports a false positive',
      '## What happens\n\nThe determinism check reports a false positive on the same text.\n',
      null,
      { at: 'HEAD' },
    );
  }, 90_000);

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
  });

  it('ranks no document through the proposal footprint', () => {
    const documents = pack.files.map((f) => f.file).filter((f) => f.endsWith(`.${EXT}`));
    expect(documents).toEqual([]);
  });

  it('ranks the determinism pass file with its path-word reason', () => {
    const row = pack.files.find((f) => f.file === 'src/core/passes/determinism.ts');
    expect(row?.reasons).toContain('its path has the words determinism');
  });

  it('takes the deepest layer from a file with a direct reason', () => {
    expect(pack.deepestFrom).toBe('direct');
    expect(pack.deepest).toBe('passes');
  });
});

// A tag in a document is not a verification (M-N5): only a source or test file counts.
describe('a tag in a document does not verify a rule (M-N5)', () => {
  let dir = '';
  let pack: Pack;
  const NOTES = `notes.${EXT}`;

  beforeAll(async () => {
    dir = throwawayRepo();

    writeIn(dir, 'src/core/rule-check.ts', ['export const ruleCheck = 1;']);
    writeIn(dir, NOTES, [tag('Rule 1.1')]);
    writeIn(dir, 'c.test.ts', [tag('Rule 1.1'), 'export {};']);
    commitIn(dir, 'feat: add the rule check and its notes', stamp(0));

    pack = await buildPack(
      dir,
      'Rule 1.1 does not hold',
      'The check fails under Rule 1.1.\n',
      null,
      {
        at: 'HEAD',
      },
    );
  });

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
  });

  it('lists the test file with the same tag as the verifying file of Rule 1.1', () => {
    expect(pack.rules.find((r) => r.rule === '1.1')?.verifiedBy).toEqual(['c.test.ts']);
  });

  it('does not list the tracked document with the same tag', () => {
    expect(pack.rules.flatMap((r) => r.verifiedBy)).not.toContain(NOTES);
  });
});

// The tests list fills its 20 slots in tiers (N3, M-N6): the sibling test of the top file first,
// then the test of a history row, then at most three testsOf results per file, then the rest.
describe('the tests list fills its slots in tier order (N3, M-N6)', () => {
  let dir = '';
  let pack: Pack;

  beforeAll(async () => {
    dir = throwawayRepo();

    writeIn(dir, 'src/core/widget.ts', [
      'export function widget(n: number): number {',
      '  return n;',
      '}',
    ]);
    writeIn(dir, 'src/core/widget.test.ts', ['// covers widget', 'export {};']);
    commitIn(dir, 'feat: add widget', stamp(0));

    // A past fix of widget.ts whose commit also touches a test file: that test is a tier (c) test.
    writeIn(dir, 'src/core/widget.ts', [
      'export function widget(n: number): number {',
      '  return n + 1;',
      '}',
    ]);
    writeIn(dir, 'src/core/zeta.test.ts', ['// covers widget', 'export {};']);
    commitIn(dir, 'fix: widget returns the wrong number (#4) (#40)', stampAfterCutover(1));

    // Twenty-five tests whose names contain the base name of widget.ts: testsOf results.
    for (let k = 1; k <= 25; k++) {
      const name = String(k).padStart(2, '0');
      writeIn(dir, `src/core/widget-${name}.test.ts`, ['// covers widget', 'export {};']);
    }
    commitIn(dir, 'test: add widget cases', stamp(2));

    pack = await buildPack(
      dir,
      'widget returns the wrong number',
      '`widget(1)` is wrong.\n',
      null,
      {
        at: 'HEAD',
      },
    );
  });

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
  });

  it('counts more than 20 candidate tests', () => {
    expect(pack.testsTotal).toBeGreaterThan(20);
  });

  it('puts the sibling test of the first top file first', () => {
    expect(pack.tests[0]).toBe('src/core/widget.test.ts');
  });

  it('places the tier (c) history test before the fourth testsOf result', () => {
    const zetaAt = pack.tests.indexOf('src/core/zeta.test.ts');
    const widgetAt = pack.tests.map((t, i) => (/widget-\d/.test(t) ? i : -1)).filter((i) => i >= 0);
    expect(zetaAt).toBeGreaterThan(0);
    expect(widgetAt.length).toBeGreaterThanOrEqual(4);
    expect(zetaAt).toBeLessThan(widgetAt[3] ?? -1);
  });
});

// Path words are capped (M-N10): a file whose path matches more than three issue words lists three.
describe('a path reason lists at most three words (M-N10)', () => {
  let dir = '';
  let pack: Pack;
  const WORDS = ['quartz', 'lantern', 'meridian', 'obsidian'];

  beforeAll(async () => {
    dir = throwawayRepo();

    writeIn(dir, 'src/core/quartz/lantern/meridian/obsidian.ts', ['export const glow = 1;']);
    commitIn(dir, 'feat: add the glow file', stamp(0));

    pack = await buildPack(
      dir,
      'quartz lantern meridian obsidian output is wrong',
      'The output is wrong.\n',
      null,
      { at: 'HEAD' },
    );
  });

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
  });

  it('lists exactly three of the four matching words in the path reason', () => {
    const row = pack.files.find((f) => f.file === 'src/core/quartz/lantern/meridian/obsidian.ts');
    const reason = row?.reasons.find((r) => r.startsWith('its path has the words')) ?? '';
    const listed = reason
      .slice('its path has the words'.length)
      .split(/[\s,]+/)
      .filter((w) => w !== '');
    expect(listed).toHaveLength(3);
    expect(listed.every((w) => WORDS.includes(w))).toBe(true);
  });
});

// deepest comes from a direct file (M-N11): a history-only top 5 does not decide the layer. The
// five front-end files are in five fixes whose subjects repeat the issue's words, so each scores
// the most a history row gives (2 × similarity, twice over the same words); the named file scores
// only its named-path row and the path words it shares with the issue.
describe('deepest is taken from a direct file (M-N11)', () => {
  let dir = '';
  let pack: Pack;

  // Seven real Git commits plus pack reads need the same setup budget as the history
  // fixture above when Windows workers contend; the test assertions keep their budget.
  beforeAll(async () => {
    dir = throwawayRepo();

    for (let k = 1; k <= 5; k++) {
      writeIn(dir, `src/compiler/ts/lower/h${k}.ts`, [`export const h${k} = ${k};`]);
    }
    commitIn(dir, 'feat: add the h files', stamp(0));

    // Five fixes after the cutover, each touching all five h files and naming the issue's words.
    for (let f = 1; f <= 5; f++) {
      for (let k = 1; k <= 5; k++) {
        writeIn(dir, `src/compiler/ts/lower/h${k}.ts`, [`export const h${k} = ${k + f * 10};`]);
      }
      commitIn(
        dir,
        `fix: pass drops value file src core passes named shows (#${3 + f}) (#${30 + f})`,
        stampAfterCutover(f),
      );
    }

    // The named file lives in the passes layer and is named in the issue.
    writeIn(dir, 'src/core/passes/named.ts', [
      'export function run(n: number): number {',
      '  return n;',
      '}',
    ]);
    commitIn(dir, 'feat: add the named pass', stamp(1));

    pack = await buildPack(
      dir,
      'the pass drops a value',
      'The file `src/core/passes/named.ts` shows it.\n',
      null,
      { at: 'HEAD' },
    );
  }, 90_000);

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
  });

  it('places the named file sixth, after five history-only files', () => {
    // Precondition: the test below is meaningful only when the named file is the sixth file.
    expect(pack.files.findIndex((f) => f.file === 'src/core/passes/named.ts')).toBe(5);
  });

  it('takes deepest from the named file layer, with deepestFrom direct', () => {
    expect(pack.deepestFrom).toBe('direct');
    expect(pack.deepest).toBe('passes');
  });
});

// A test file the issue names as a path comes first in the tests list (bucket 0), ahead of the
// sibling test of the top file (bucket a).
describe('a test the issue names comes first (bucket 0)', () => {
  let dir = '';
  let pack: Pack;
  const NAMED = 'src/core/named/other.test.ts';

  beforeAll(async () => {
    dir = throwawayRepo();

    writeIn(dir, 'src/core/widget.ts', [
      'export function widget(n: number): number {',
      '  return n;',
      '}',
    ]);
    writeIn(dir, 'src/core/widget.test.ts', ['// covers widget', 'export {};']);
    writeIn(dir, NAMED, ['// covers widget', 'export {};']);
    commitIn(dir, 'feat: add widget and its tests', stamp(0));

    pack = await buildPack(
      dir,
      'widget returns the wrong number',
      `\`widget(1)\` is wrong. The test \`${NAMED}\` shows it.\n`,
      null,
      { at: 'HEAD' },
    );
  });

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
  });

  it('lists the test the issue names first', () => {
    expect(pack.tests[0]).toBe(NAMED);
  });

  it('lists the sibling test of the top file after it', () => {
    const sibling = pack.tests.indexOf('src/core/widget.test.ts');
    expect(sibling).toBeGreaterThan(0);
  });
});

// A tag in a tracked script is read only when isTagSource accepts it (T6): scripts/reqs-sync.ts is
// the sync tool itself and is excluded, while a test file with the same tag verifies the rule. The
// pathspec of git grep admits both, so only isTagSource tells them apart.
describe('isTagSource keeps the sync script out of verifiedBy (T6)', () => {
  let dir = '';
  let pack: Pack;

  beforeAll(async () => {
    dir = throwawayRepo();

    writeIn(dir, 'scripts/reqs-sync.ts', [tag('Rule 1.1'), 'export {};']);
    writeIn(dir, 'c.test.ts', [tag('Rule 1.1'), 'export {};']);
    commitIn(dir, 'feat: add the sync script and a test', stamp(0));

    pack = await buildPack(
      dir,
      'Rule 1.1 does not hold',
      'The check fails under Rule 1.1.\n',
      null,
      {
        at: 'HEAD',
      },
    );
  });

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
  });

  it('lists the test file with the tag, and not the sync script with the same tag', () => {
    expect(pack.rules.find((r) => r.rule === '1.1')?.verifiedBy).toEqual(['c.test.ts']);
  });
});
