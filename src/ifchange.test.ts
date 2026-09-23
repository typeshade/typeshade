// ═══ Every LINT.IfChange block in the tree is well formed and names targets that exist ═══
//
// The static half of `scripts/ifchange.ts` (its header has the convention). The diff half runs
// in the commit hook and on every pull request; a block whose target was renamed away would make
// that check vacuous for it, so the targets are held here, on every run of `bun run test`.
//
// SANITY FIRST (AGENTS.md#gate-discipline): the reader must find the blocks the tree is known to
// carry, so a marker pattern that stopped matching cannot pass `toEqual([])` below.

import { describe, expect, it } from 'vitest';
import {
  allBlocks,
  parseBlocks,
  parseTarget,
  staticProblems,
  waiver,
} from '../scripts/ifchange.js';

describe('sanity: the reader finds the blocks', () => {
  it('finds the pairs this tree declares', () => {
    const labels = allBlocks().blocks.map((b) => `${b.file}:${b.label}`);
    for (const known of [
      'src/core/spec-conformance/surface-names.test.ts:extensions',
      'docs/language-design.md:extensions',
      '.github/workflows/ci.yml:jobs',
      'AGENTS.md:tests',
      'scripts/doc-impact.ts:hook',
      'AGENTS.md:docs-follow-the-code',
    ]) {
      expect(labels).toContain(known);
    }
  });

  it('parses the markers in code, YAML and Markdown, and not a mention in a sentence', () => {
    const text = [
      '// LINT.IfChange(a)',
      'x',
      '// LINT.ThenChange(docs/x.md:b, :c)',
      '# LINT.IfChange',
      'y',
      '# LINT.ThenChange(//typeshade.github.io/src/pages/index.astro)',
      '<!-- LINT.IfChange(d) -->',
      'Mark a pair with `LINT.IfChange(label)` and `LINT.ThenChange(path)`.',
      '# LINT.ThenChange(//typeshade.github.io/...) target this branch did not change; then the',
      '<!-- LINT.ThenChange() -->',
    ].join('\n');
    const { blocks, problems } = parseBlocks('f.ts', text);
    expect(problems).toEqual([]);
    expect(blocks.map((b) => [b.label, b.start, b.end, b.targets])).toEqual([
      [
        'a',
        1,
        3,
        [
          { repo: null, path: 'docs/x.md', label: 'b' },
          { repo: null, path: 'f.ts', label: 'c' },
        ],
      ],
      [null, 4, 6, [{ repo: 'typeshade.github.io', path: 'src/pages/index.astro', label: null }]],
      ['d', 7, 10, []],
    ]);
  });

  it('reports a block that never closes, a nested one and a stray ThenChange', () => {
    const { problems } = parseBlocks(
      'f.ts',
      ['// LINT.ThenChange(a.md)', '// LINT.IfChange', '// LINT.IfChange', 'x'].join('\n'),
    );
    expect(problems.map((p) => p.line)).toEqual([1, 3, 3]);
  });

  it('reads a path with a label and a label alone', () => {
    expect(parseTarget('AGENTS.md:tests', 'x.ts')).toEqual({
      repo: null,
      path: 'AGENTS.md',
      label: 'tests',
    });
    expect(parseTarget(':local', 'x.ts')).toEqual({ repo: null, path: 'x.ts', label: 'local' });
  });

  it('takes a waiver only with a reason', () => {
    expect(waiver('fix: x\n\nNO_IFTTT=the table is regenerated in the next commit')).toBe(
      'the table is regenerated in the next commit',
    );
    expect(waiver('fix: x\n\nNO_IFTTT=')).toBeNull();
    expect(waiver('fix: x')).toBeNull();
    expect(waiver('fix: x, the convention (with NO_IFTTT=reason) is documented')).toBeNull();
  });
});

describe('every block in the tree', () => {
  it('closes, does not nest, and names targets that exist', () => {
    expect(staticProblems().map((p) => `${p.file}:${p.line}  ${p.message}`)).toEqual([]);
  });
});
