import { describe, expect, it } from 'vitest';
import { ALPHA, BETA, exported, tree } from './core/testing/move-purity-fixtures.js';
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
    it('lets no document change freely, the plan and the structure document included', () => {
      for (const path of ['docs/structure-refactoring-plan.md', 'docs/project-structure.md']) {
        const report = checkMove(tree({ [path]: 'a' }), tree({ [path]: 'new text' }));
        expect(report.outside.map((o) => o.path)).toEqual([path]);
      }
    });

    it('refuses a path swapped for another path that exists', () => {
      const files = { 'src/a.ts': BETA, 'src/b.ts': BETA };
      const base = tree({ ...files, [GUIDE]: 'See src/a.ts for details.\n' });
      const head = tree({ ...files, [GUIDE]: 'See src/b.ts for details.\n' });
      expect(checkMove(base, head).outside.map((o) => o.path)).toEqual([GUIDE]);
    });

    it('lets a document follow a renamed file by its path or its directory-relative name', () => {
      const base = tree({
        'src/core/a.ts': exported(ALPHA),
        'src/AGENTS.md': 'See core/a.ts and src/core/a.ts.\n',
      });
      const head = tree({
        'src/core/diag/a.ts': exported(ALPHA),
        'src/AGENTS.md': 'See core/diag/a.ts and src/core/diag/a.ts.\n',
      });
      expect(checkMove(base, head).outside).toEqual([]);
    });

    it('does not follow a directory', () => {
      const base = tree({
        'src/old/a.ts': exported(ALPHA),
        [GUIDE]: 'See src/old/a.ts and src/old/ for details.\n',
      });
      const head = tree({
        'src/new/a.ts': exported(ALPHA),
        [GUIDE]: 'See src/new/a.ts and src/new/ for details.\n',
      });
      expect(checkMove(base, head).outside.map((o) => o.path)).toEqual([GUIDE]);
    });

    it('refuses a prose edit and a path that no rename explains', () => {
      const base = tree({ [GUIDE]: 'See src/a.ts for details.\n' });
      expect(
        checkMove(base, tree({ [GUIDE]: 'Read src/a.ts for details.\n' })).outside,
      ).toHaveLength(1);
      expect(
        checkMove(base, tree({ [GUIDE]: 'See src/zzz.ts for details.\n' })).outside,
      ).toHaveLength(1);
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

  describe('the comment baseline', () => {
    const path = 'scripts/comment-baseline.json';
    const run = (before: object, after: object) =>
      checkMove(tree({ [path]: JSON.stringify(before) }), tree({ [path]: JSON.stringify(after) }));

    it('accepts a new entry when the sum does not grow', () => {
      expect(run({ 'src/a.ts': 5 }, { 'src/a.ts': 2, 'src/b.ts': 3 }).pure).toBe(true);
    });

    it('refuses an entry that grew and a sum that grew', () => {
      expect(run({ 'src/a.ts': 5, 'src/b.ts': 5 }, { 'src/a.ts': 6, 'src/b.ts': 1 }).pure).toBe(
        false,
      );
      expect(run({ 'src/a.ts': 5 }, { 'src/a.ts': 5, 'src/b.ts': 1 }).pure).toBe(false);
    });
  });

  describe('references to a removed file in any tracked text (S7)', () => {
    const hidden = ['.prettier', 'ignore'].join('');
    const base = (text: string) =>
      tree({ 'src/core/deprecation.ts': exported(ALPHA), [hidden]: text });
    const head = (text: string) =>
      tree({ 'src/core/diagnostics/deprecation.ts': exported(ALPHA), [hidden]: text });
    const kinds = (text: string, after: string) =>
      checkMove(base(text), head(after)).findings.map((f) => f.kind);

    it('refuses a file that still names the old path', () => {
      const same = 'src/core/deprecation.ts\n';
      expect(kinds(same, same)).toContain('path reference to a removed file');
    });

    it('does not take the new path of a kept base name for a reference', () => {
      const text = 'src/core/diagnostics/deprecation.ts\n';
      expect(kinds(text, text)).toEqual([]);
    });

    it('refuses a base name behind a slash or a quote when the name changed', () => {
      const moved = tree({
        'src/core/renamed.ts': exported(ALPHA),
        [hidden]: 'x/deprecation.ts\n',
      });
      const found = checkMove(base('x/deprecation.ts\n'), moved).findings.map((f) => f.kind);
      expect(found).toContain('path reference to a removed file');
    });
  });
});
