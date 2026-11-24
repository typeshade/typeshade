// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bothHalves } from '../../core/testing/both-halves.js';
import { load, type Loaded } from './growing-load.js';

const HEADER = `"use typeshade";\n`;

interface Case {
  readonly name: string;
  readonly body: string;
  readonly js: (n: number) => number[];
}

const CASES: readonly Case[] = [
  {
    name: 'writeInFor',
    body: `for (let k: u32 = 0; k < n; k++) {
    out[out.length] = k * 2;
  }`,
    js: (n) => Array.from({ length: n }, (_, k) => k * 2),
  },
  {
    name: 'writeInWhile',
    body: `let k: u32 = 0;
  while (k < n) {
    out[out.length] = k + 1;
    k++;
  }`,
    js: (n) => Array.from({ length: n }, (_, k) => k + 1),
  },
  {
    name: 'writeTwice',
    body: `for (let k: u32 = 0; k < n; k++) {
    out[out.length] = k;
    out[out.length] = k + 100;
  }`,
    js: (n) => Array.from({ length: n }, (_, k) => [k, k + 100]).flat(),
  },
  {
    name: 'lengthAfterWrite',
    body: `for (let k: u32 = 0; k < n; k++) {
    out[out.length] = k;
    out[out.length] = out.length;
  }`,
    js: (n) => Array.from({ length: n }, (_, k) => [k, 2 * k + 1]).flat(),
  },
  {
    name: 'writeThenReadBack',
    body: `let k: u32 = 0;
  while (k < n) {
    out[out.length] = k + 7;
    out[out.length] = out[out.length - 1] * 2;
    k++;
  }`,
    js: (n) => Array.from({ length: n }, (_, k) => [k + 7, (k + 7) * 2]).flat(),
  },
];

const SOURCE =
  HEADER +
  CASES.map(
    (c) => `export function ${c.name}(n: u32): u32[] {
  const out: u32[] = [];
  ${c.body}
  return out;
}`,
  ).join('\n');

let m: Loaded;
beforeAll(async () => {
  m = await load(SOURCE);
});
afterAll(() => m.dispose());

const run = async (name: string, ...args: unknown[]): Promise<number[]> => [
  ...((await m.call[name]!(...args)) as Iterable<number>),
];

describe('a write at the length of a made array with no push appends, as in JavaScript (Rule 8.23)', () => {
  for (const c of CASES)
    it(`gives the elements of a JavaScript run of ${c.name}`, async () => {
      for (const n of [0, 1, 4]) expect(await run(c.name, n)).toEqual(c.js(n));
    });

  it('takes both halves for the source it runs', () => {
    expect(bothHalves(SOURCE).compiler).toEqual([]);
  });

  it('keeps the whole function on the CPU tier, where the loop is no GPU loop', () => {
    for (const c of CASES) expect(m.face[c.name]!.gpu).toBeUndefined();
  });

  it('covers a counted loop (Route 1) and an open loop (Route 3)', () => {
    expect(m.made('writeInFor')).not.toMatchObject({ growing: true });
    expect(m.made('writeInWhile')).toMatchObject({ growing: true });
  });
});
