import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  bannedCommentLines,
  countComments,
  publicDefinitions,
  readBaseline,
} from '../scripts/comment-policy.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('a file of src/ gains no comment (CLAUDE.md, Comments)', () => {
  const found = countComments(ROOT);
  const known = readBaseline(ROOT);

  it('no file has more comment lines than scripts/comment-baseline.json records', () => {
    const grown = Object.entries(found)
      .filter(([path, lines]) => lines > (known[path] ?? 0))
      .map(([path, lines]) => `${path}: ${lines} lines, the baseline records ${known[path] ?? 0}`);
    expect(
      grown,
      'Each file gained comment lines. Write no comment: name the thing so the code says it, ' +
        'hold an invariant with a test or an assert, and put the reason for a change in the ' +
        'commit message. A doc comment stays only on a definition of src/__api__/surface.md. ' +
        'Do not raise a number in the baseline.',
    ).toEqual([]);
  });

  it('the baseline records no more comment lines than a file has', () => {
    const stale = Object.entries(known)
      .filter(([path, lines]) => lines > (found[path] ?? 0))
      .map(
        ([path, lines]) =>
          `${path}: the baseline records ${lines}, the file has ${found[path] ?? 0}`,
      );
    expect(stale, 'Run `bun run bake:comment-baseline`: the baseline only goes down.').toEqual([]);
  });

  it('counts a comment, and spares a marker and the doc comment of a public definition', () => {
    const keys = publicDefinitions('src/a.ts#shown — function\n');
    const text = [
      '/** Shown to a consumer. */',
      'export function shown(): number {',
      '  // why',
      '  return 1;',
      '}',
      '/** Internal. */',
      'function hidden(): number {',
      '  return 2; // trailing',
      '}',
      '// LINT.IfChange(label)',
      'export const other = hidden();',
    ].join('\n');
    expect(bannedCommentLines('src/a.ts', text, keys)).toBe(3);
    expect(bannedCommentLines('src/a.ts', 'const s = "// not a comment";', keys)).toBe(0);
  });
});
