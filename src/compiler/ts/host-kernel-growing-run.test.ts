// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bothHalves } from '../../core/testing/both-halves.js';
import { callGrowing } from '../../core/host-kernel-made/growing.js';
import { load, type Loaded } from './growing-load.js';
import {
  ELEMENT_PROGRAMS,
  FOR_PROGRAMS,
  HEADER,
  NEST_PROGRAMS,
  WHILE_PROGRAMS,
  type Program,
} from './growing-programs/index.js';

const EXTRA = `
export function early(n: u32, stop: u32): u32[] {
  const out: u32[] = [];
  let k: u32 = 0;
  while (k < n) {
    if (k === stop) {
      return out;
    }
    out.push(k);
    k++;
  }
  return out;
}
export function peek(n: u32): u32[] {
  const out: u32[] = [];
  for (let s: u32 = 0; s < 2; s++) {
    out.push(1);
  }
  let k: u32 = 0;
  while (k < n) {
    out.push(out[k + 5]);
    k++;
  }
  return out;
}
export function poke(n: u32): u32[] {
  const out: u32[] = [];
  let k: u32 = 0;
  while (k < n) {
    out.push(k);
    out[k + 3] = k;
    k++;
  }
  return out;
}
export function vectors(n: u32): vec2f[] {
  const out: vec2f[] = [];
  let k: u32 = 0;
  while (k < n) {
    let v = vec2f(f32(k), 1.);
    out.push(v);
    v.x = 99.;
    k++;
  }
  return out;
}
export function whole(n: u32): vec2f[] {
  const out: vec2f[] = [];
  let k: u32 = 0;
  let v = vec2f(0., 1.);
  while (k < n) {
    v = vec2f(f32(k), 1.);
    out.push(v);
    v += vec2f(10., 0.);
    k++;
  }
  return out;
}
export function onParameter(xs: array<f32>, out: array<vec2f>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    let v = vec2f(xs[i], 1.);
    out.push(v);
    v.x = 99.;
  }
  return out.length;
}
export function vectorsCounted(n: u32): vec2f[] {
  const out: vec2f[] = [];
  for (let k: u32 = 0; k < n; k++) {
    let v = vec2f(f32(k), 1.);
    out.push(v);
    v.x = 99.;
  }
  return out;
}
export function mixed(n: u32): u32[] {
  const out: u32[] = [];
  for (let i: u32 = 0; i < n; i++) {
    out.push(i);
  }
  let k: u32 = 0;
  while (k < n) {
    out.push(k * 10);
    k++;
  }
  return out;
}
`;

const ALL: readonly Program[] = [
  ...WHILE_PROGRAMS,
  ...FOR_PROGRAMS,
  ...NEST_PROGRAMS,
  ...ELEMENT_PROGRAMS,
];

let m: Loaded;
beforeAll(async () => {
  m = await load(HEADER + ALL.map((p) => p.source).join('\n') + EXTRA);
});
afterAll(() => m.dispose());

const run = async (name: string, ...args: unknown[]): Promise<number[]> => [
  ...((await m.call[name]!(...args)) as Iterable<number>),
];

describe('a function that takes Route 3 gives the result of a JavaScript run (change 0114, A12, OD-5)', () => {
  for (const p of ALL)
    it(`gives the elements and the order of a JavaScript run of ${p.name}`, async () => {
      for (const [args, expected] of p.runs) expect(await run(p.name, ...args)).toEqual(expected);
    });

  it('takes both halves for the source it runs', () => {
    expect(bothHalves(HEADER + ALL.map((p) => p.source).join('\n')).compiler).toEqual([]);
  });

  it('leaves the arrays of the caller as they were', async () => {
    const xs = new Float32Array([1, 2.5]);
    await m.call['doubling']!(xs, 3);
    await m.call['doubled']!(xs);
    expect([...xs]).toEqual([1, 2.5]);
  });

  it('stops a while at a return in its body', async () => {
    expect(await run('early', 5, 3)).toEqual([0, 1, 2]);
    expect(await run('early', 2, 9)).toEqual([0, 1]);
    expect(await run('early', 5, 0)).toEqual([]);
  });

  it('gives the same result as the counted twin where both run', async () => {
    for (const n of [0, 1, 5])
      expect(await run('appended', n)).toEqual(await run('countedAppended', n));
    expect(await run('vectors', 3)).toEqual(await run('vectorsCounted', 3));
  });

  it('stores a copy of a vector that push takes, as a storage buffer does (Rule 8.28)', async () => {
    const expected = [0, 1, 1, 1, 2, 1];
    expect(await run('vectors', 3)).toEqual(expected);
    expect(await run('vectorsCounted', 3)).toEqual(expected);
    expect(await run('whole', 3)).toEqual(expected);
    const out = new Float32Array(6);
    expect(await m.call['onParameter']!(new Float32Array([0, 1, 2]), out)).toBe(3);
    expect([...out]).toEqual(expected);
  });

  it('takes the whole function to Route 3 where one loop is counted and another is not', async () => {
    expect(m.made('mixed')).toMatchObject({ growing: true });
    expect(m.made('mixed').capacity).toBeUndefined();
    expect(await run('mixed', 3)).toEqual([0, 1, 2, 0, 10, 20]);
  });

  it('grows past many doublings with the elements of a JavaScript loop', async () => {
    const got = await run('many', 300000);
    expect(got).toHaveLength(300000);
    expect(got[299999]).toBe(299999);
    expect(got.every((v, i) => v === i)).toBe(true);
  });
});

describe('the element reads and writes of a grown array in a function of Route 3 (Rule 8.23, Q1 (C))', () => {
  it('checks a read at the call and words the access', async () => {
    await expect(m.call['peek']!(1)).rejects.toThrow(
      new RangeError(
        'peek(): "out[k + 5]" reads index 5 of "out", whose length is 2 there. A read past the ' +
          'length is not supported yet.',
      ),
    );
    expect(await run('peek', 0)).toEqual([1, 1]);
  });

  it('checks a write at the call, and appends at the length', async () => {
    await expect(m.call['poke']!(1)).rejects.toThrow(
      new RangeError(
        'poke(): "out[k + 3]" writes index 3 of "out", whose length is 1 there. A ' +
          'write past the length is not supported yet.',
      ),
    );
    expect(await run('poke', 0)).toEqual([]);
  });

  it('names the access in the reason and keeps the call on the CPU tier', () => {
    expect(m.face['fib']!.gpu).toBeUndefined();
    expect(m.made('fib').checks).toEqual([
      { text: 'out[k - 1]', write: false },
      { text: 'out[k - 2]', write: false },
    ]);
  });

  it('is a program both halves take', () => {
    const halves = bothHalves(HEADER + ELEMENT_PROGRAMS[1]!.source);
    expect(halves.compiler).toEqual([]);
    expect(halves.hover('out[j] =')).toBeDefined();
  });
});

describe('the limit of a growing store (change 0114, A12, Route 3)', () => {
  it('throws the RangeError of the limit with the length it reached, and one below it passes', async () => {
    const run3 = (limit: number): Promise<unknown> =>
      callGrowing(m.cpu, m.face['many']!, m.made('many'), [5000], undefined, limit);
    await expect(run3(1000)).rejects.toThrow(
      new RangeError(
        'many(): the array it grows with push, "out", needs room for 1000 or more elements, the ' +
          'number its loops push, and a length past 999 is not supported yet.',
      ),
    );
    expect(((await run3(5002)) as Uint32Array).length).toBe(5000);
    await expect(run3(5000)).rejects.toThrow(/needs room for 5000 or more elements/);
  });
});
