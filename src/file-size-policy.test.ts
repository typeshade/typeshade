import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LINE_LIMIT,
  lineCount,
  oversizeFiles,
  readSizeBaseline,
} from '../scripts/file-size-policy.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe(`a file of src/ has at most ${LINE_LIMIT} lines (CLAUDE.md, File size)`, () => {
  const found = oversizeFiles(ROOT);
  const known = readSizeBaseline(ROOT);

  it('no file passes the limit, and no file of the baseline grows', () => {
    const grown = Object.entries(found)
      .filter(([path, lines]) => lines > (known[path] ?? LINE_LIMIT))
      .map(([path, lines]) => `${path}: ${lines} lines, at most ${known[path] ?? LINE_LIMIT}`);
    expect(
      grown,
      `A file has at most ${LINE_LIMIT} lines, comments included. Each file here is new and ` +
        'longer, or is in scripts/file-size-baseline.json and grew. Move one responsibility ' +
        'into a file of its own, in a directory named for the module. Do not raise a number ' +
        'in the baseline.',
    ).toEqual([]);
  });

  it('the baseline records no more lines than a file has', () => {
    const stale = Object.entries(known)
      .filter(([path, lines]) => lines > (found[path] ?? 0))
      .map(
        ([path, lines]) =>
          `${path}: the baseline records ${lines}, the file has ${found[path] ?? `at most ${LINE_LIMIT}`}`,
      );
    expect(stale, 'Run `bun run bake:file-size-baseline`: the baseline only goes down.').toEqual(
      [],
    );
  });

  it('counts the lines of a file as an editor numbers them', () => {
    expect(lineCount('')).toBe(0);
    expect(lineCount('a\nb\n')).toBe(2);
    expect(lineCount('a\nb')).toBe(2);
  });
});
