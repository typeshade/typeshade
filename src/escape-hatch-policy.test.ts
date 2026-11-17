// A source file gains no new way around a check.
//
// A comment can switch a check off (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`,
// `@ts-nocheck`) or put a repair off (`TODO`, `FIXME`, `HACK`, `XXX`). Each one is a place where
// the check no longer holds, and the next change copies it. This test counts those comments in
// every source file of `src/` that is not a test. `KNOWN` holds the count of each file when the
// check landed. A count that grows fails here, and so does a count that shrank and was not
// lowered, so the numbers only go down.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('.', import.meta.url));

/** The comments that switch a check off or put a repair off. */
const MARKER =
  /eslint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck|\b(?:TODO|FIXME|HACK|XXX)\b/g;

/** The count of markers in each file when this check landed. Lower a number when a marker goes,
 *  and remove the line at zero. Never raise a number and never add a line: repair what the
 *  check reports, or change the rule it enforces in the lint or compiler configuration. */
const KNOWN: Readonly<Record<string, number>> = {
  // Generated files, checked through the source they are baked from.
  'algorithms/face.ts': 1,
  'core/libm/explog.generated.ts': 1,
  'core/libm/invtrig.generated.ts': 1,
  'core/libm/trig.generated.ts': 1,
  'random/face.ts': 1,
  // Written by hand.
  'compiler/ts/enables.ts': 1,
  'core/backends/glsl.ts': 4,
  'core/ir/node.ts': 3,
  'core/oracle.ts': 1,
  'runtime/device.ts': 1,
  'runtime/resource.ts': 3,
};

/** The number of markers in the text of a file. */
export function markersIn(text: string): number {
  return text.match(MARKER)?.length ?? 0;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('a source file gains no new way around a check', () => {
  const found: Record<string, number> = {};
  for (const path of sourceFiles(SRC)) {
    const count = markersIn(readFileSync(path, 'utf8'));
    if (count > 0) found[relative(SRC, path).split(sep).join('/')] = count;
  }

  it('no file has more markers than KNOWN records', () => {
    const grown = Object.entries(found)
      .filter(([path, count]) => count > (KNOWN[path] ?? 0))
      .map(([path, count]) => `${path}: ${count}, KNOWN records ${KNOWN[path] ?? 0}`);
    expect(
      grown,
      'Each file has a new eslint-disable, @ts-ignore, @ts-expect-error, @ts-nocheck, TODO, ' +
        'FIXME, HACK or XXX. Repair what the check reports, or finish the work now. Do not ' +
        'raise the number in KNOWN.',
    ).toEqual([]);
  });

  it('KNOWN records no more markers than a file has', () => {
    const stale = Object.entries(KNOWN)
      .filter(([path, count]) => count > (found[path] ?? 0))
      .map(([path, count]) => `${path}: KNOWN records ${count}, the file has ${found[path] ?? 0}`);
    expect(stale, 'Lower each of these numbers in KNOWN: they only go down.').toEqual([]);
  });

  it('counts each marker, and no ordinary comment', () => {
    const disable = '// eslint-' + 'disable-next-line no-fallthrough';
    const later = '// TO' + 'DO: handle the other case';
    expect(markersIn(`${disable}\nconst a = 1;\n${later}`)).toBe(2);
    expect(markersIn('// Refused for now: GLSL ES 3.00 has no such form.\nconst todo = 1;')).toBe(
      0,
    );
  });
});
