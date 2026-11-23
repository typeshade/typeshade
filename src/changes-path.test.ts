import { afterEach, describe, expect, it, vi } from 'vitest';
import * as impact from '../scripts/doc-impact.js';
import { judge, parseProposal, touchedBy } from '../scripts/changes.js';
import { pathExamples } from '../examples/path/index.js';

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

const accepted = parseProposal(
  '(a proposal built in memory)',
  [
    '---',
    "id: '0012'",
    'title: A change',
    'status: accepted',
    'rules: []',
    'surface: []',
    'exports: []',
    'exports-removed: []',
    'codes: []',
    'examples: []',
    'names: []',
    'downstream:',
    '- repo: typeshade.github.io',
    '  what: the examples page',
    '---',
    '',
    'Body.',
  ].join('\n'),
);

describe('proposal scope from a diff: the learning path (change 0145)', () => {
  afterEach(() => vi.restoreAllMocks());

  const withoutTexts = (): void => {
    vi.spyOn(impact, 'atBase').mockReturnValue('');
    vi.spyOn(impact, 'atHead').mockReturnValue('');
  };

  it('requires a declared step for an addition and a deletion', () => {
    withoutTexts();
    for (const kind of ['added', 'deleted'] as const) {
      const touched = touchedBy(diff({ [kind]: ['examples/path/new-step/new-step.shade.ts'] }));
      expect([...touched.examples]).toEqual(['new-step']);
      expect(judge(touched, 'Change: 0012', [accepted]).problems).toContainEqual(
        expect.stringContaining('example `new-step` is changed here but not declared'),
      );
      expect(
        judge(touched, 'Change: 0012', [{ ...accepted, examples: ['new-step'] }]).problems,
      ).toEqual([]);
    }
  });

  it('counts a step by its module, not by its host file or a helper shader', () => {
    withoutTexts();
    const added = ['examples/path/step/host.ts', 'examples/path/step/other.shade.ts'];
    expect([...touchedBy(diff({ added })).examples]).toEqual([]);
  });

  it('counts both ids on a rename between steps, and none on a move that keeps the id', () => {
    withoutTexts();
    const renamed = (from: string, to: string) => touchedBy(diff({ renamed: [[from, to]] }));
    expect([
      ...renamed('examples/path/old/old.shade.ts', 'examples/path/new/new.shade.ts').examples,
    ]).toEqual(['old', 'new']);
    expect([
      ...renamed('examples/hosts/kept/kept.shade.ts', 'examples/path/kept/kept.shade.ts').examples,
    ]).toEqual([]);
  });

  it('the steps on disk are found (the instrument is not blind)', () => {
    expect(pathExamples.map((s) => s.id)).toContain('first-color');
  });
});
