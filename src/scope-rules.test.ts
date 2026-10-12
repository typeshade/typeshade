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
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPack, formatPackMarkdown, type Pack } from '../scripts/scope/pack.js';
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

// The graph server is found on PATH. These repositories are not indexed by it, so the test hides the
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
  let restorePath: () => void = () => {};

  beforeAll(async () => {
    restorePath = hideGraphBinary();
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
    restorePath();
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
  let restorePath: () => void = () => {};

  const proposalsAt = (at: string) => {
    const history = readHistory(dir, at);
    return readProposals(dir, at, history, noisyCommits(dir, at, history));
  };

  beforeAll(() => {
    restorePath = hideGraphBinary();
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
    restorePath();
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
    let restorePath: () => void = () => {};

    beforeAll(async () => {
      restorePath = hideGraphBinary();
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
      restorePath();
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
  let restorePath: () => void = () => {};

  beforeAll(async () => {
    restorePath = hideGraphBinary();
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
    restorePath();
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
  let restorePath: () => void = () => {};

  beforeAll(async () => {
    restorePath = hideGraphBinary();
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
  });

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
    restorePath();
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
