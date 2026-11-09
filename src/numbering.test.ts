// ═══ Rules 3.7 and 12.2: surface section numbers and diagnostic codes are claimed in order ═══
//
// `scripts/numbering.ts` holds the numbering of docs/use-typeshade-surface.md and
// src/compiler/ts/codes.ts. This file runs it over the tree, so the unit suite fails on a
// duplicate, an out-of-order number, an unrecorded gap or a reused one. It also runs the judge on
// hand-built sequences, so each kind of problem is shown to be seen.
//
// SANITY FIRST (AGENTS.md#gate-discipline): the readers must find the numbers the tree is known to
// carry, so an empty read cannot pass vacuously.
//
// No `Verifies:` tag yet: Rules 3.7 and 12.2 say "Enforced by: review", and a tag would turn their
// Doorstop items to `verification: test` ahead of the rule text. The proposal that updates their
// "Enforced by" lines adds the tag (reqs/README.md).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../scripts/doc-refs.js';
import {
  CATCH_ALL,
  CODE_GAPS,
  SURFACE_DOC,
  SURFACE_GAPS,
  SURFACE_ORDER_EXCEPTIONS,
  TS_CODES_FILE,
  codeProblems,
  codesIn,
  nextFree,
  numberingProblems,
  sectionsIn,
  surfaceProblems,
} from '../scripts/numbering.js';
import { TS_CODES } from './compiler/ts/codes.js';

const codesText = readFileSync(join(ROOT, TS_CODES_FILE), 'utf8');
const surfaceText = readFileSync(join(ROOT, SURFACE_DOC), 'utf8');

describe('the numbers on the tree', () => {
  it('sanity: reads every code TS_CODES declares, and the sections the document is known to carry', () => {
    const read = codesIn(codesText);
    expect(Object.fromEntries(read.map((c) => [c.name, `TS${c.number}`]))).toEqual(TS_CODES);
    expect(read.find((c) => c.name === 'MISSING_DIRECTIVE')?.number).toBe(8001);
    const sections = sectionsIn(surfaceText);
    expect(sections).toContain(1);
    expect(sections).toContain(62);
    expect(sections.length).toBeGreaterThan(60);
  });

  it('the codes of codes.ts hold Rules 3.7 and 12.2', () => {
    expect(codeProblems(codesText)).toEqual([]);
  });

  it('the sections of the surface document hold Rule 3.7', () => {
    expect(surfaceProblems(surfaceText)).toEqual([]);
  });

  it('records each gap with a reason, and no two recorded gaps overlap', () => {
    for (const gaps of [CODE_GAPS, SURFACE_GAPS]) {
      const sorted = [...gaps].sort((a, b) => a.from - b.from);
      sorted.forEach((g, i) => {
        expect(g.from).toBeLessThanOrEqual(g.to);
        expect(g.why.length).toBeGreaterThan(0);
        if (i > 0) expect(g.from).toBeGreaterThan(sorted[i - 1]!.to);
      });
    }
    for (const e of SURFACE_ORDER_EXCEPTIONS) expect(e.why.length).toBeGreaterThan(0);
  });

  it('names the next free numbers', () => {
    const next = nextFree(codesText, surfaceText);
    expect(next.code).toBeLessThan(CATCH_ALL.number);
    expect(codesIn(codesText).some((c) => c.number === next.code)).toBe(false);
    expect(sectionsIn(surfaceText)).not.toContain(next.section);
  });
});

describe('the judge on a hand-built sequence', () => {
  const gaps = [{ from: 4, to: 5, why: 'a retired pair' }];

  it('passes a sequence with its gaps recorded', () => {
    expect(numberingProblems([1, 2, 3, 6, 7], gaps, '§')).toEqual([]);
  });

  it('fails a duplicate', () => {
    expect(numberingProblems([1, 2, 2, 3], [], '§')).toEqual(['duplicate: §2 is declared twice.']);
  });

  it('fails a number declared after a larger one, unless it is a recorded exception', () => {
    expect(numberingProblems([1, 3, 2, 4], [], '§')).toEqual([
      'order: §2 is declared after §3; numbers go in order.',
    ]);
    expect(numberingProblems([1, 2, 4, 3, 5], [], '§', [4])).toEqual([]);
  });

  it('fails an exception the order no longer needs', () => {
    expect(numberingProblems([1, 2, 3], [], '§', [3])).toEqual([
      'stale: §3 is recorded as out of order and no longer is; remove it.',
    ]);
  });

  it('fails an unrecorded gap, and names its span', () => {
    const p = numberingProblems([1, 2, 6], [], 'TS');
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/^gap: TS3 to TS5 is skipped and recorded nowhere/);
  });

  it('fails a number reused from a recorded gap', () => {
    const p = numberingProblems([1, 2, 3, 4, 6], gaps, 'TS');
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/^reuse: TS4 is declared inside the recorded gap TS4 to TS5/);
  });

  const codes = (...entries: [string, number][]): string =>
    `export const TS_CODES = {\n${entries.map(([n, c]) => `  ${n}: 'TS${c}',`).join('\n')}\n};\n`;

  it('holds the catch-all apart: once, as UNSUPPORTED, last', () => {
    expect(codeProblems(codes(['A', 8001], ['B', 8002], ['UNSUPPORTED', 8099]), [])).toEqual([]);
    expect(codeProblems(codes(['A', 8001], ['B', 8002]), [])[0]).toMatch(/must be declared once/);
    expect(codeProblems(codes(['A', 8001], ['UNSUPPORTED', 8099], ['B', 8002]), [])[0]).toMatch(
      /declare it last/,
    );
  });

  it('fails a new code that skips the next free number', () => {
    const p = codeProblems(codes(['A', 8001], ['B', 8002], ['C', 8005], ['UNSUPPORTED', 8099]), []);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/^gap: TS8003 to TS8004/);
  });

  it('fails a section added past the next free number on the tree', () => {
    const next = nextFree(codesText, surfaceText).section;
    const p = surfaceProblems(`${surfaceText}\n## ${next + 1}. A section that skipped one\n`);
    expect(p).toEqual([expect.stringMatching(new RegExp(`^gap: §${next} is skipped`))]);
  });
});
