import { describe, expect, it } from 'vitest';
import { BETA, tree } from './core/testing/move-purity-fixtures.js';
import { checkMove } from '../scripts/move-purity.js';

const GUIDE = ['docs', 'guide' + '.md'].join('/');

describe('the files outside the declarations (P7)', () => {
  it('refuses a changed file that is not a document or a baseline', () => {
    const report = checkMove(tree({ 'package.json': '{}' }), tree({ 'package.json': '{"a":1}' }));
    expect(report.outside.map((o) => o.path)).toEqual(['package.json']);
    const data = checkMove(tree({ 'src/data.json': '{}' }), tree({ 'src/data.json': '[]' }));
    expect(data.pure).toBe(false);
  });

  it('refuses a mode change, a symbolic link and a document that is never free', () => {
    const entries = [
      { path: 'scripts/run.sh', oldMode: '100644', newMode: '100755' },
      { path: 'src/link', oldMode: '000000', newMode: '120000' },
      { path: 'src/new.ts', oldMode: '000000', newMode: '100644' },
    ];
    const report = checkMove(tree({}), tree({}), { paths: [], entries });
    expect(report.outside.map((o) => o.path)).toEqual(['scripts/run.sh', 'src/link']);
    for (const path of ['docs/owner-decisions.md', 'CLAUDE.md']) {
      expect(checkMove(tree({ [path]: 'a' }), tree({ [path]: 'b' })).outside).toHaveLength(1);
    }
  });

  describe('documents', () => {
    it('lets the plan and the structure document change freely', () => {
      for (const path of ['docs/structure-refactoring-plan.md', 'docs/project-structure.md']) {
        expect(checkMove(tree({ [path]: 'a' }), tree({ [path]: 'new text' })).pure).toBe(true);
      }
    });

    it('lets another document change repository paths only', () => {
      const base = tree({
        [GUIDE]: 'See src/a.ts and src/old/ for details.\nPlain line.\n',
        'src/a.ts': BETA,
        'src/old/x.ts': BETA,
      });
      const moved = tree({
        [GUIDE]: 'See src/b.ts and src/new/ for details.\nPlain line.\n',
        'src/b.ts': BETA,
        'src/new/x.ts': BETA,
      });
      const report = checkMove(base, moved);
      expect(report.outside).toEqual([]);
    });

    it('refuses prose edits and paths that no tracked file has', () => {
      const files = { 'src/a.ts': BETA, 'src/b.ts': BETA };
      const base = tree({ ...files, [GUIDE]: 'See src/a.ts for details.\n' });
      const prose = tree({ ...files, [GUIDE]: 'Read src/b.ts for details.\n' });
      expect(checkMove(base, prose).outside.map((o) => o.path)).toEqual([GUIDE]);
      const unknown = tree({ ...files, [GUIDE]: 'See src/zzz.ts for details.\n' });
      expect(checkMove(base, unknown).outside).toHaveLength(1);
    });
  });

  describe('the KNOWN list of src/layer-policy.test.ts', () => {
    const list = (edges: string[], other: string[] = []): string =>
      `const OTHER: readonly string[] = [${other.map((e) => `'${e}'`).join(', ')}];\n` +
      `const KNOWN: readonly string[] = [\n${edges.map((e) => `  '${e}',\n`).join('')}];\n`;
    const path = 'src/layer-policy.test.ts';

    it('accepts a removed element and reports it', () => {
      const base = tree({ [path]: list(['a.ts -> b.ts', 'c.ts -> d.ts']) });
      const report = checkMove(base, tree({ [path]: list(['c.ts -> d.ts']) }));
      expect(report.pure).toBe(true);
      expect(report.knownEdgesRemoved).toEqual(['a.ts -> b.ts']);
    });

    it('accepts the last element removed', () => {
      const report = checkMove(
        tree({ [path]: list(['a.ts -> b.ts']) }),
        tree({ [path]: list([]) }),
      );
      expect(report.pure).toBe(true);
    });

    it('refuses an added element', () => {
      const base = tree({ [path]: list(['a.ts -> b.ts']) });
      const head = tree({ [path]: list(['a.ts -> b.ts', 'c.ts -> d.ts']) });
      const report = checkMove(base, head);
      expect(report.outside).toEqual([{ path, reason: 'KNOWN edge added: c.ts -> d.ts' }]);
    });

    it('refuses an edit of the rest of the file, an edge-like string in another array included', () => {
      const base = tree({ [path]: list(['a.ts -> b.ts'], ['x.ts -> y.ts']) });
      const other = tree({ [path]: list(['a.ts -> b.ts'], []) });
      expect(checkMove(base, other).pure).toBe(false);
      const rest = tree({ [path]: list(['a.ts -> b.ts']).replace('OTHER', 'OTHERS') });
      expect(checkMove(tree({ [path]: list(['a.ts -> b.ts']) }), rest).pure).toBe(false);
    });
  });

  describe('src/__api__/surface.md', () => {
    const path = 'src/__api__/surface.md';
    const surface = (file: string): string =>
      `# surface\n\n${file}#abs  const  { (x: number): number; }\nsrc/b.ts#add  const  { (a: number): number; }\n`;

    it('accepts a change of the path of a definition and counts it', () => {
      const report = checkMove(
        tree({ [path]: surface('src/a.ts') }),
        tree({ [path]: surface('src/a/part.ts') }),
      );
      expect(report.pure).toBe(true);
      expect(report.surfacePathChanges).toBe(1);
    });

    it('refuses a change of the shape of a definition', () => {
      const head = surface('src/a.ts').replace('number; }\nsrc/b', 'string; }\nsrc/b');
      expect(checkMove(tree({ [path]: surface('src/a.ts') }), tree({ [path]: head })).pure).toBe(
        false,
      );
    });
  });
});
