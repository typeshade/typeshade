import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkMove } from '../scripts/move-purity.js';
import { cleanReport } from '../scripts/move-purity/clean-report.js';
import { checkCommentRemoval } from '../scripts/move-purity/check-comments.js';
import { lineCitedPaths } from '../scripts/move-purity/line-citations.js';
import { runCli } from '../scripts/remove-comments.js';
import { ALPHA, exported, tree } from './core/testing/move-purity-fixtures.js';

const dir = ['src', 'core', 'coverage'].join('/');
const rowsPath = `${dir}/rows.ts`;
const citedPath = ['src', 'a.ts'].join('/');
const newPath = ['src', 'a', 'part.ts'].join('/');
const otherPath = ['src', 'b.ts'].join('/');

const rows = (evidence: string): string =>
  `export const ROWS = [\n  {\n    evidence: '${evidence}',\n  },\n];\n`;

const split = (source: string, coverage: string) =>
  checkMove(
    tree({ [citedPath]: source + exported(ALPHA), [rowsPath]: coverage }),
    tree({
      [citedPath]: `export { addOne } from './a/part.js';\n${source}`,
      [newPath]: exported(ALPHA),
      [rowsPath]: coverage,
    }),
  );

describe('a move of a file that evidence cites by line', () => {
  it('refuses a pure move on a cited file and names the file, the count and a row', () => {
    const report = split('', rows(`${citedPath}:3; ${citedPath}:5-6; ${otherPath}:2`));
    expect(report.pure).toBe(false);
    const found = report.findings.filter((f) => f.kind === 'cited by line path');
    expect(found).toHaveLength(1);
    expect(found[0]!.path).toBe(citedPath);
    expect(found[0]!.detail).toContain('2 citing segments');
    expect(found[0]!.detail).toContain(`${rowsPath}:3`);
  });

  it('keeps a pure move pure on an uncited file, and on a file cited as a whole', () => {
    expect(split('', rows(`${otherPath}:2`)).pure).toBe(true);
    expect(split('', rows(`${citedPath} (the whole file)`)).pure).toBe(true);
  });

  it('accepts a new file that no row cites', () => {
    const report = split('', rows(`${otherPath}:2`));
    expect(report.findings).toEqual([]);
  });

  it('reads evidence that is split over a concatenation', () => {
    const text = `export const R = [{ evidence: '${citedPath}:1' + '; ${otherPath}:4' }];\n`;
    const cited = lineCitedPaths(tree({ [rowsPath]: text }));
    expect([...cited.keys()].sort()).toEqual([citedPath, otherPath].sort());
  });
});

describe('a comments removal on a file that evidence cites by line', () => {
  const commented = '// A plain header.\nexport const a = 1;\n';
  const bare = 'export const a = 1;\n';
  const remove = (coverage: string, path: string) =>
    checkCommentRemoval(
      tree({ [path]: commented, [rowsPath]: coverage }),
      tree({ [path]: bare, [rowsPath]: coverage }),
      { paths: [path], entries: [{ path, oldMode: '100644', newMode: '100644' }] },
    );

  it('is refused', () => {
    const report = remove(rows(`${citedPath}:1`), citedPath);
    expect(report.pure).toBe(false);
    expect(report.findings.map((f) => f.kind)).toContain('cited by line path');
  });

  it('stays pure on an uncited file', () => {
    expect(remove(rows(`${otherPath}:1`), citedPath).pure).toBe(true);
  });
});

describe('the clean report', () => {
  it('shows per file whether it is cited by line', () => {
    const report = cleanReport(
      '/move-purity-fixture',
      tree({
        [citedPath]: 'export const a = 1;\n',
        [otherPath]: 'export const b = 1;\n',
        [rowsPath]: rows(`${citedPath}:1; ${citedPath}:2`),
      }),
    );
    const row = (path: string) => report.files.find((file) => file.path === path)!;
    expect(row(citedPath)).toMatchObject({ citedByLine: true, citingSegments: 2 });
    expect(row(otherPath)).toMatchObject({ citedByLine: false, citingSegments: 0 });
  });
});

describe('remove-comments on a cited file', () => {
  let root = '';
  const output: string[] = [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'line-citations-'));
    for (const [path, text] of [
      [citedPath, '// A plain header.\nexport const a = 1;\n'],
      [rowsPath, rows(`${citedPath}:2`)],
    ] as const) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    output.length = 0;
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      output.push(String(line));
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('refuses early with the finding text', async () => {
    expect(await runCli([citedPath, '--repo', root], '/')).toBe(1);
    expect(output.join('\n')).toContain(`cited by line path ${citedPath} 1 citing segment`);
  });
});
