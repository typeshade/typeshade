// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { bothHalves } from '../../core/testing/both-halves.js';
import { load } from './growing-load.js';
import { HEADER } from './growing-programs/index.js';

const grows = (body: string): string =>
  `export function f(n: u32): f32[] { const out: f32[] = []; ${body} return out; }`;

const ones = (count: number): number[] => Array.from({ length: count }, () => 1);

const cases: readonly (readonly [string, string, (n: number) => number[]])[] = [
  [
    'a push in a while loop',
    grows('let i: u32 = 0; while (i < n) { out.push(1.); i++; }'),
    (n) => ones(n),
  ],
  [
    'a push in a loop that is not counted',
    grows('for (let i: u32 = 1; i < n; i *= 2) { out.push(1.); }'),
    (n) => ones(Math.ceil(Math.log2(Math.max(n, 1)))),
  ],
  [
    'an element write that can append, in a while loop',
    grows(
      'for (let i: u32 = 0; i < n; i++) { out.push(1.); } let j: u32 = 0; while (j < n) { out[j] = 2.; j++; }',
    ),
    (n) => Array.from({ length: n }, () => 2),
  ],
  [
    'a loop under a branch inside a loop',
    grows(
      'for (let i: u32 = 0; i < n; i++) { if (i > 2) { for (let j: u32 = 0; j < n; j++) { out.push(1.); } } }',
    ),
    (n) => ones(Math.max(n - 3, 0) * n),
  ],
  [
    'a while loop inside a counted loop',
    grows(
      'for (let i: u32 = 0; i < n; i++) { let j: u32 = 0; while (j < i) { out.push(1.); j++; } }',
    ),
    (n) => ones((n * (n - 1)) / 2),
  ],
  [
    'a for loop inside a while loop',
    grows(
      'let i: u32 = 0; while (i < n) { for (let j: u32 = 0; j < n; j++) { out.push(1.); } i++; }',
    ),
    (n) => ones(n * n),
  ],
  [
    'a nested loop that is not counted',
    grows(
      'for (let i: u32 = 0; i < n; i++) { for (let j: u32 = 1; j < n; j *= 2) { out.push(1.); } }',
    ),
    (n) => ones(n * Math.ceil(Math.log2(Math.max(n, 1)))),
  ],
  [
    'a nest under a switch',
    grows(
      'switch (n) { case 1: for (let i: u32 = 0; i < n; i++) { out.push(1.); } break; default: break; }',
    ),
    (n) => (n === 1 ? ones(1) : []),
  ],
];

describe('the programs that change 0114 refused before Route 3, and now run (S2)', () => {
  for (const [what, source, oracle] of cases)
    it(`takes ${what} in both halves, and runs it as JavaScript does`, async () => {
      const halves = bothHalves(HEADER + source);
      expect(halves.compiler).toEqual([]);
      expect(halves.editor).toEqual(
        halves.result.diagnostics
          .filter((d) => d.category === 'warning')
          .map((d) => `typeshade ${d.code}: ${d.message}`),
      );
      const m = await load(HEADER + source);
      try {
        for (const n of [0, 1, 5]) {
          expect([...((await m.call['f']!(n)) as Float32Array)]).toEqual(oracle(n));
        }
      } finally {
        m.dispose();
      }
    });
});
