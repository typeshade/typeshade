// How `typeshade check` prints a report: the `tsc --pretty` layout, one line per diagnostic,
// or versioned JSON (`src/cli/format.ts`).

import { describe, it, expect } from 'vitest';
import { checkDocuments, type CheckDocument } from '../language-service/check.js';
import { formatCheckReport } from './format.js';

const doc = (path: string, text: string): CheckDocument => ({ path, uri: `/p/${path}`, text });

/** A valid shader written in the arithmetic `"use typeshade"` is authored in. */
const VALID = `"use typeshade";
export function shade(n: vec3, l: vec3, albedo: vec3): vec3 {
  const d = max(dot(n, l), 0.);
  const lit = albedo * d + albedo * 0.1;
  return normalize(n + l) * 0.5 + lit;
}
`;

describe('typeshade check output', () => {
  const text = `"use typeshade";
export function f(x: f32): f32 {
  const y = x;
  y = 2.;
  return y;
}
`;
  const report = checkDocuments([doc('c.shade.ts', text)]);
  const sources = new Map([['c.shade.ts', text]]);

  it('text: the tsc --pretty layout, without colour', () => {
    expect(formatCheckReport(report, 'text', sources)).toBe(
      [
        'c.shade.ts:4:3 - error TS8005: Cannot assign to "y" — it is declared with const.',
        '',
        '4   y = 2.;',
        '    ~',
        '',
        'Found 1 error in 1 file (1 file checked).',
        '',
      ].join('\n'),
    );
  });

  it('short: one line per diagnostic', () => {
    expect(formatCheckReport(report, 'short', sources).split('\n')).toEqual([
      'c.shade.ts:4:3 - error TS8005: Cannot assign to "y" — it is declared with const.',
      'Found 1 error in 1 file (1 file checked).',
      '',
    ]);
  });

  it('json: the report as data, versioned', () => {
    const parsed = JSON.parse(formatCheckReport(report, 'json', sources)) as Record<
      string,
      unknown
    >;
    expect(parsed['version']).toBe(1);
    expect(parsed['summary']).toEqual({ errors: 1, warnings: 0, files: 1 });
    expect(parsed['diagnostics']).toEqual([
      {
        file: 'c.shade.ts',
        line: 4,
        column: 3,
        endLine: 4,
        endColumn: 4,
        offset: 67,
        length: 1,
        severity: 'error',
        code: 'TS8005',
        source: 'typeshade',
        message: 'Cannot assign to "y" — it is declared with const.',
      },
    ]);
  });

  it('a clean check says so', () => {
    const clean = checkDocuments([doc('valid.shade.ts', VALID)]);
    expect(formatCheckReport(clean, 'text')).toBe('No problems found in 1 file.\n');
  });
});
