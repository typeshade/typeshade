import { describe, expect, it } from 'vitest';
import { ALPHA, BETA, USE_TYPESHADE, exported, tree } from './core/testing/move-purity-fixtures.js';
import { checkMove, formatReport } from '../scripts/move-purity.js';

describe('directive prologues', () => {
  const use = USE_TYPESHADE;

  it('accepts a split whose new file carries the directive', () => {
    const base = tree({ 'src/a.ts': use + ALPHA + BETA });
    const head = tree({ 'src/a.ts': use + BETA, 'src/b.ts': use + ALPHA });
    expect(checkMove(base, head).pure).toBe(true);
  });

  it('does not count a directive as a declaration', () => {
    const report = checkMove(tree({ 'src/a.ts': use + ALPHA }), tree({ 'src/a.ts': ALPHA }));
    expect(report.units.vanished).toEqual([]);
    expect(report.directives).toEqual([{ path: 'src/a.ts', expected: ['use typeshade'], got: [] }]);
  });

  it('refuses a new file without the directive of its source', () => {
    const base = tree({ 'src/a.ts': use + ALPHA + BETA });
    const head = tree({ 'src/a.ts': use + BETA, 'src/b.ts': ALPHA });
    const report = checkMove(base, head);
    expect(report.pure).toBe(false);
    expect(report.directives).toEqual([{ path: 'src/b.ts', expected: ['use typeshade'], got: [] }]);
    expect(formatReport(report)).toContain('directive src/b.ts: expected ["use typeshade"] got []');
  });

  it('refuses a new file with a directive its source lacks', () => {
    const base = tree({ 'src/a.ts': ALPHA + BETA });
    const head = tree({ 'src/a.ts': BETA, 'src/b.ts': use + ALPHA });
    expect(checkMove(base, head).pure).toBe(false);
  });

  it('refuses a directive removed from a file that stays', () => {
    const report = checkMove(tree({ 'src/a.ts': use + BETA }), tree({ 'src/a.ts': BETA }));
    expect(report.pure).toBe(false);
  });

  it('refuses units moved from a directive file into an existing file without it', () => {
    const x = 'const X = 1;\n';
    const base = tree({ 'src/a.ts': use + ALPHA + BETA, 'src/b.ts': x });
    const head = tree({ 'src/a.ts': use + BETA, 'src/b.ts': x + ALPHA });
    expect(checkMove(base, head).pure).toBe(false);
  });

  it('accepts a new facade only with a directive list that a changed file has', () => {
    const base = tree({ 'src/a.ts': use + exported(ALPHA) });
    const facade = `${use}export { addOne } from './a/part.js';\n`;
    const part = tree({ 'src/a.ts': facade, 'src/a/part.ts': use + exported(ALPHA) });
    expect(checkMove(base, part).pure).toBe(true);
    const bare = tree({ 'src/a.ts': facade, 'src/a/part.ts': exported(ALPHA) });
    expect(checkMove(base, bare).pure).toBe(false);
  });
});
