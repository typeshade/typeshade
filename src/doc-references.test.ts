// ═══ Every reference the prose makes resolves, and the impact reader sees what a change removes ═══
//
// The gate half of "docs follow the code" (AGENTS.md#docs-follow-the-code). The reader is
// `scripts/doc-refs.ts`; its header says what a reference is and why only those kinds are read.
// `scripts/doc-impact.ts` is the diff half, run before a commit and on every pull request; its
// pure parts are pinned here so the hook and the CI step cannot go blind without a red test.
//
// THE SANITY ARMS LEAD (AGENTS.md#gate-discipline). An empty scan passes `toEqual([])`, and a
// reader that stopped matching `Rule N.M` would report no dead rule forever. So the first arms
// assert how much the reader SAW, per kind, against floors under what the tree measured on
// 2026-09-23 (693 files; path 582, rule 351, code 283, section 65, script 42, anchor 26), and
// feed it a document with one dead reference of every kind, which it must report.

import { describe, expect, it } from 'vitest';
import {
  deadRefs,
  extractRefs,
  formatRef,
  reasonlessMarkers,
  resolve,
  scannedFiles,
  slug,
} from '../scripts/doc-refs.js';
import {
  changedRules,
  declaredDependencies,
  declaredNames,
  globMatch,
  surface,
} from '../scripts/doc-impact.js';

const FLOORS = { path: 400, rule: 250, code: 200, section: 40, script: 25, anchor: 15 } as const;

describe('sanity: the reader sees the tree', () => {
  it('scans the Markdown and the TypeScript', () => {
    const files = scannedFiles();
    expect(files.filter((f) => f.endsWith('.md')).length).toBeGreaterThanOrEqual(12);
    expect(files.filter((f) => f.endsWith('.ts')).length).toBeGreaterThanOrEqual(400);
    expect(files).toContain('AUTHORING.md');
    expect(files).not.toContain('CHANGELOG.md');
  });

  it('extracts every kind of reference above its floor', () => {
    const counts: Record<string, number> = {};
    for (const file of scannedFiles()) {
      for (const ref of extractRefs(file)) counts[ref.kind] = (counts[ref.kind] ?? 0) + 1;
    }
    for (const [kind, floor] of Object.entries(FLOORS)) {
      expect(counts[kind] ?? 0, `${kind} references read`).toBeGreaterThanOrEqual(floor);
    }
  });

  it('reports a dead reference of every kind, and passes a live one', () => {
    const doc = [
      '# Title',
      '## 2. A numbered section',
      'See `src/index.ts`, `scripts/no-such-script-here.ts` and [the guide](../AUTHORING.md).',
      'A [link](../AUTHORING.md#fp64) and a [broken one](../AUTHORING.md#no-such-heading-anywhere).',
      'A [link from the wrong directory](AUTHORING.md).',
      'docs/language-design.md §2.1 is real; docs/language-design.md §99.1 is not.',
      'Rule 2.2 holds; Rule 99.9 does not. TS8010 exists; TS8999 does not.',
      'Run `bun run test`, not `bun run no-such-script`.',
      '```ts',
      'const inAFence = `scripts/fenced-is-code.ts`; // Rule 77.7',
      '```',
      '<!-- doc-refs: skip — this sentence names a file on purpose -->',
      'The skipped `scripts/skipped-on-purpose.ts`.',
      'A quoted marker `<!-- doc-refs: skip — quoted -->` skips nothing: `scripts/after-quote.ts`.',
    ].join('\n');
    const dead = extractRefs('docs/synthetic.md', doc)
      .filter((r) => resolve(r) !== null)
      .map((r) => `${r.kind} ${r.text}`);
    expect(dead.sort()).toEqual(
      [
        'anchor ../AUTHORING.md#no-such-heading-anywhere',
        'path AUTHORING.md',
        'code TS8999',
        'path scripts/after-quote.ts',
        'path scripts/no-such-script-here.ts',
        'rule Rule 99.9',
        'script no-such-script',
        'section docs/language-design.md §99.1',
      ].sort(),
    );
  });

  it('refuses a numbered citation of a document whose headings carry no numbers', () => {
    const [ref] = extractRefs('src/x.ts', '// see AUTHORING.md §10 for the table');
    expect(ref?.kind).toBe('section');
    expect(resolve(ref!)).toMatch(/does not number its headings/);
  });

  it('leaves a citation of the X-GIS monorepo alone', () => {
    expect(extractRefs('src/x.ts', '// recorded in X-GIS CLAUDE.md §5, since corrected')).toEqual(
      [],
    );
  });

  it('slugs a heading the way GitHub does', () => {
    expect(slug('Capabilities & extensions')).toBe('capabilities--extensions');
    expect(slug('The identity of a specialized program')).toBe(
      'the-identity-of-a-specialized-program',
    );
    expect(slug('`new` is how a class is built')).toBe('new-is-how-a-class-is-built');
  });
});

describe('every reference resolves', () => {
  it('no path, anchor, section, rule, code or script the prose names is missing', () => {
    const dead = deadRefs();
    expect(
      dead.map(formatRef),
      'Fix each sentence to name what the tree has now, or delete it. A sentence that must ' +
        'name something absent carries `<!-- doc-refs: skip — reason -->` (AGENTS.md#docs-follow-the-code).',
    ).toEqual([]);
  });

  it('every skip marker says why', () => {
    expect(reasonlessMarkers().map((r) => `${r.file}:${r.line}`)).toEqual([]);
  });
});

describe('the impact reader', () => {
  it('reads the names a removed line declared', () => {
    expect(
      [
        ...declaredNames([
          'export function constExpr(name: string) {',
          'export const PI = 3.14;',
          'export declare class Foo {}',
          'export type Bar<T> = T;',
          'declare function f64FromParts(hi: f32, lo: f32): f64;',
          'const local = 1;',
          '  return x;',
        ]),
      ].sort(),
    ).toEqual(['Bar', 'Foo', 'PI', 'constExpr', 'f64FromParts']);
  });

  it('reads the surface bake: names from the fences, shapes by definition key', () => {
    const text = [
      '## `.` — 2 exports',
      '```',
      'abs',
      'constExpr',
      '```',
      '```',
      'src/core/ir/builder.ts#constExpr  function  (name: string) => ConstHandle',
      '```',
    ].join('\n');
    const { names, shapes } = surface(text);
    expect([...names]).toEqual(['abs', 'constExpr']);
    expect(shapes.get('src/core/ir/builder.ts#constExpr')).toBe(
      'constExpr\u0000function  (name: string) => ConstHandle',
    );
  });

  it('maps a touched line to the rule paragraph it sits in', () => {
    const text = [
      '## 2. Sources',
      '**Rule 2.1.** Every name has a source.',
      'More of Rule 2.1.',
      '**Rule 2.2.** An internal name is not authorable.',
      '### 2.3. Next',
      'Not a rule.',
    ].join('\n');
    expect([...changedRules(text, new Set([3]))]).toEqual(['2.1']);
    expect([...changedRules(text, new Set([4, 6]))]).toEqual(['2.2']);
  });

  it('reads a doc-depends line under its heading, and not one quoted in a sentence', () => {
    const text = [
      '## fp64',
      '<!-- doc-depends: src/core/fp64/**, src/core/passes/fp64-lower.ts -->',
      'Write `<!-- doc-depends: src/x.ts -->` under a heading.',
    ].join('\n');
    expect(declaredDependencies('AUTHORING.md', text)).toEqual([
      { line: 2, heading: 'fp64', globs: ['src/core/fp64/**', 'src/core/passes/fp64-lower.ts'] },
    ]);
  });

  it('matches globs by segment', () => {
    expect(globMatch('src/core/fp64/**', 'src/core/fp64/df64-lib.ts')).toBe(true);
    expect(globMatch('src/core/*.ts', 'src/core/emit.ts')).toBe(true);
    expect(globMatch('src/core/*.ts', 'src/core/ir/node.ts')).toBe(false);
    expect(globMatch('src/core/passes/fp64-lower.ts', 'src/core/passes/fp64-lower.ts')).toBe(true);
  });
});
