// ═══ Every change proposal is well formed, and the check holds a diff to the one it names ═══
//
// `scripts/changes.ts` is the process in changes/README.md: which diffs need a proposal, and
// whether a diff stays inside what its proposal declared. This file holds both halves without
// git: the proposals on disk (their shape), and the judge on hand-built diffs (its verdicts).
//
// SANITY FIRST (AGENTS.md#gate-discipline): the reader must find the proposal the tree is known
// to carry, so an empty directory listing cannot pass the shape checks vacuously.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as impact from '../scripts/doc-impact.js';
import { hostExamples } from '../examples/hosts/index.js';
import { ROOT } from '../scripts/doc-refs.js';
import { definedRules } from '../scripts/doc-refs.js';
import {
  DOWNSTREAM_REPOS,
  STATUSES,
  changeLines,
  codeTable,
  handledIds,
  judge,
  owedDownstream,
  parseProposal,
  proposals,
  sectionsAt,
  touchedBy,
  type Proposal,
  type Touched,
} from '../scripts/changes.js';

const surfaceDoc = readFileSync(join(ROOT, 'docs/use-typeshade-surface.md'), 'utf8');
const sections = new Set([...surfaceDoc.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1])));

/** Whether an example id a proposal declares names an example that exists: a module,
 *  `examples/<id>.shade.ts`, or a host example (change 0061), which the registry of
 *  `examples/hosts/` lists. */
const hostIds = new Set(hostExamples.map((h) => h.id));
const exampleExists = (id: string): boolean =>
  existsSync(join(ROOT, 'examples', `${id}.shade.ts`)) || hostIds.has(id);

describe('the proposals on disk', () => {
  const all = proposals();

  it('sanity: finds the proposal the tree carries', () => {
    expect(all.map((p) => p.id)).toContain('0001');
  });

  it('each has a unique id that matches its file name, a title and a known status', () => {
    const ids = all.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of all) {
      expect(p.file, p.file).toMatch(new RegExp(`^changes/${p.id}-`));
      expect(p.title.length, `${p.file} title`).toBeGreaterThan(0);
      expect(STATUSES).toContain(p.status);
    }
  });

  it('names only known downstream repositories, each with the work it owes', () => {
    for (const p of all) {
      for (const d of p.downstream) {
        expect(DOWNSTREAM_REPOS as readonly string[], `${p.file}`).toContain(d.repo);
        expect(d.what.length, `${p.file} ${d.repo}`).toBeGreaterThan(0);
      }
    }
  });

  it('once implemented, cites rules, surface sections and examples that exist', () => {
    const rules = definedRules();
    for (const p of all.filter((x) => x.status === 'implemented' || x.status === 'archived')) {
      for (const r of p.rules) expect(rules.has(r), `${p.file}: Rule ${r}`).toBe(true);
      for (const s of p.surface) expect(sections.has(s), `${p.file}: surface §${s}`).toBe(true);
      for (const e of p.examples) expect(exampleExists(e), `${p.file}: example ${e}`).toBe(true);
    }
  });

  it('finds an example as a module and as a host example, and not one that is neither', () => {
    // The instrument: a scan that found nothing would agree with every proposal.
    expect(hostIds.size).toBeGreaterThanOrEqual(6);
    expect(exampleExists('loop-kernel')).toBe(true);
    expect(exampleExists('loop-fuse')).toBe(true);
    expect(exampleExists('no-such-example')).toBe(false);
  });
});

const none: Touched = {
  rules: new Set(),
  surface: new Set(),
  exports: new Set(),
  exportsRemoved: new Set(),
  codes: new Set(),
  examples: new Set(),
};

const accepted = parseProposal(
  '(a proposal built in memory)',
  [
    '---',
    "id: '0012'",
    'title: A change',
    'status: accepted',
    'rules:',
    "- '7.5'",
    'surface:',
    '- 17',
    'exports: []',
    'exports-removed:',
    '- oldName',
    'codes: []',
    'examples: []',
    'downstream:',
    '- repo: typeshade.github.io',
    '  what: the constructs page',
    '---',
    '',
    'Body.',
  ].join('\n'),
);

describe('the judge', () => {
  it('reads a proposal front matter', () => {
    expect(accepted).toMatchObject({
      id: '0012',
      status: 'accepted',
      rules: ['7.5'],
      surface: [17],
      exportsRemoved: ['oldName'],
      downstream: [{ repo: 'typeshade.github.io', what: 'the constructs page' }],
    });
  });

  it('reads the lists of a front matter written indented, as Prettier writes YAML', () => {
    // Accepted 0019 carried `rules:\n  - '11.9'`, and a reader that took only unindented entries
    // read it as declaring nothing, which failed its implementing pull request.
    const indented = parseProposal(
      '(an indented proposal)',
      [
        '---',
        "id: '0019'",
        'title: A change',
        'status: accepted',
        'rules:',
        "  - '11.9'",
        'surface:',
        '  - 66',
        'exports:',
        '  - ConsoleMethod',
        'exports-removed: []',
        'codes: []',
        'examples: []',
        'downstream:',
        '  - repo: vscode-typeshade',
        '    what: the skill',
        '---',
        '',
      ].join('\n'),
    );
    expect(indented.rules).toEqual(['11.9']);
    expect(indented.surface).toEqual([66]);
    expect(indented.exports).toEqual(['ConsoleMethod']);
    expect(indented.downstream).toEqual([{ repo: 'vscode-typeshade', what: 'the skill' }]);
  });

  it('asks nothing of a change the criteria do not catch', () => {
    expect(judge(none, '', []).problems).toEqual([]);
  });

  it('requires a proposal, or a stated reason, for a change that touches a rule', () => {
    const t = { ...none, rules: new Set(['7.5']) };
    expect(judge(t, 'fix: loops', []).problems[0]).toMatch(/needs a proposal/);
    expect(judge(t, 'fix: typo\n\nChange: none, a typo inside the rule', []).problems).toEqual([]);
  });

  it('accepts a change inside what its accepted proposal declared, and lists the rest as pending', () => {
    const t = { ...none, rules: new Set(['7.5']) };
    const v = judge(t, 'feat: loops\n\nChange: 0012', [accepted]);
    expect(v.problems).toEqual([]);
    expect(v.pending).toEqual(['surface section surface §17', 'removed export `oldName`']);
  });

  it('stops a change that reaches past its proposal', () => {
    const t = { ...none, rules: new Set(['7.5', '8.1']), codes: new Set(['TS8006']) };
    const v = judge(t, 'Change: 0012', [accepted]);
    expect(v.problems).toHaveLength(2);
    expect(v.problems[0]).toMatch(/Rule 8\.1 is changed here but not declared/);
    expect(v.problems[1]).toMatch(/`TS8006`/);
  });

  it('stops a change whose proposal is missing or not yet accepted', () => {
    const t = { ...none, rules: new Set(['7.5']) };
    expect(judge(t, 'Change: 0099', [accepted]).problems[0]).toMatch(/names no proposal/);
    const draft = { ...accepted, status: 'draft' } as Proposal;
    expect(judge(t, 'Change: 0012', [draft]).problems[0]).toMatch(/is draft/);
  });

  it('reads Change lines only on a line of their own', () => {
    expect(changeLines('x\n\nChange: 12\nChange: 0012')).toEqual({ ids: ['0012'], none: null });
    expect(changeLines('the Change: 12 trailer').ids).toEqual([]);
  });

  it('maps touched lines to numbered sections, and reads both code registries', () => {
    const doc = ['## 1. One', 'a', '## 2. Two', 'b', '```', '## 3. Not a heading', '```'].join(
      '\n',
    );
    expect([...sectionsAt(doc, new Set([2, 4, 6]))]).toEqual([1, 2]);
    // The blank line a new section's heading needs before it is no change to the section above.
    const appended = ['## 1. One', 'a', '', '## 2. Two', 'b'].join('\n');
    expect([...sectionsAt(appended, new Set([3, 4, 5]))]).toEqual([2]);
    const table = codeTable("  LOOP_BOUND: 'TS8006',", '  SD0013: {');
    expect([...table]).toEqual([
      ['LOOP_BOUND', 'TS8006'],
      ['SD0013', 'SD0013'],
    ]);
  });
});

describe('what a pin owes downstream', () => {
  const implemented = { ...accepted, status: 'implemented' } as Proposal;

  it('reads the ids a compiler-changes.md records, only at the start of a list item', () => {
    const text = ['# Compiler changes', '', '- 0001 — #60', '* 0012: done', 'see 0013'].join('\n');
    expect([...handledIds(text)]).toEqual(['0001', '0012']);
  });

  it('owes an implemented proposal that names the repository, until it is recorded', () => {
    expect(owedDownstream([implemented], 'typeshade.github.io', new Set())).toEqual([implemented]);
    expect(owedDownstream([implemented], 'typeshade.github.io', new Set(['0012']))).toEqual([]);
    expect(owedDownstream([implemented], 'vscode-typeshade', new Set())).toEqual([]);
  });

  it('owes nothing for a proposal the pinned compiler has not implemented yet', () => {
    expect(owedDownstream([accepted], 'typeshade.github.io', new Set())).toEqual([]);
  });
});

describe('proposal scope from a diff (#584)', () => {
  afterEach(() => vi.restoreAllMocks());

  const diff = (changes: Partial<impact.Diff> = {}): impact.Diff => ({
    base: 'fixture',
    staged: false,
    added: [],
    deleted: [],
    renamed: [],
    modified: [],
    touched: new Map(),
    removedLines: new Map(),
    removedAt: new Map(),
    ...changes,
  });
  function texts(before = '', after = '') {
    vi.spyOn(impact, 'atBase').mockImplementation((_diff, file) =>
      file === 'src/__api__/surface.md' ? before : '',
    );
    vi.spyOn(impact, 'atHead').mockImplementation((_diff, file) =>
      file === 'src/__api__/surface.md' ? after : '',
    );
  }
  const bake = (root: string[], ir: string[]) =>
    [
      '## `.` — exports',
      '```',
      ...root,
      '```',
      '## `./core/ir` — exports',
      '```',
      ...ir,
      '```',
    ].join('\n');

  it('requires a declared host example for both an addition and a deletion', () => {
    texts();
    for (const kind of ['added', 'deleted'] as const) {
      const touched = touchedBy(diff({ [kind]: ['examples/hosts/new-host/new-host.shade.ts'] }));
      expect([...touched.examples]).toEqual(['new-host']);
      expect(judge(touched, 'Change: 0012', [accepted]).problems).toContainEqual(
        expect.stringContaining('example `new-host` is changed here but not declared'),
      );
      expect(
        judge(touched, 'Change: 0012', [{ ...accepted, examples: ['new-host'] }]).problems,
      ).toEqual([]);
    }
  });

  it('counts both ids on a host rename, but not a move preserving the id', () => {
    texts();
    expect([
      ...touchedBy(
        diff({ renamed: [['examples/hosts/old/old.shade.ts', 'examples/hosts/new/new.shade.ts']] }),
      ).examples,
    ]).toEqual(['old', 'new']);
    expect([
      ...touchedBy(
        diff({ renamed: [['examples/kept.shade.ts', 'examples/hosts/kept/kept.shade.ts']] }),
      ).examples,
    ]).toEqual([]);
  });

  it('does not count helper shaders or host TypeScript files as new examples', () => {
    texts();
    expect([
      ...touchedBy(
        diff({ added: ['examples/hosts/kept/helper.shade.ts', 'examples/hosts/kept/main.ts'] }),
      ).examples,
    ]).toEqual([]);
  });

  it('sees an export moved between subpaths as a removal and an addition', () => {
    texts(bake(['oldName'], []), bake([], ['oldName']));
    const touched = touchedBy(diff());
    expect([...touched.exportsRemoved]).toEqual(['oldName']);
    expect([...touched.exports]).toEqual(['oldName']);
    expect(
      judge(touched, 'Change: 0012', [{ ...accepted, exportsRemoved: [] }]).problems,
    ).toContainEqual(expect.stringContaining('removed export `oldName`'));
    const verdict = judge(touched, 'Change: 0012', [accepted]);
    expect(verdict.problems).toEqual([]);
    expect(verdict.pending).not.toContain('removed export `oldName`');
  });

  it('sees removal from one subpath even when another already exports the name', () => {
    texts(bake(['oldName'], ['oldName']), bake([], ['oldName']));
    expect([...touchedBy(diff()).exportsRemoved]).toEqual(['oldName']);
    expect([...touchedBy(diff()).exports]).toEqual([]);
  });
});
