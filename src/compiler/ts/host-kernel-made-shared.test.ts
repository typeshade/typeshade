// Verifies: Rule 8.21 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './host-face.js';
import { bothRefuse, bothTake } from '../../core/testing/both-halves.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Call = (...a: unknown[]) => Promise<unknown>;
interface Q {
  a: number;
  c: number;
}

function face(source: string) {
  const f = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f as Required<typeof f>;
}

async function load(source: string): Promise<Record<string, Call>> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-made-shared-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, face(source).code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, Call>;
}

const SHARED = `"use typeshade";
export interface Q { a: f32; c: u32; }
export function evens(n: u32, s: f32): Q[] {
  const out = new Array(n).fill({ a: s, c: 3 });
  for (let i: u32 = 0; i < n; i++) {
    if (i % 2 == 0) {
      out[i] = { a: f32(i), c: i };
    }
  }
  return out;
}
export function untouched(n: u32, q: Q): Q[] {
  const out = new Array(n).fill(q);
  return out;
}
export function every(n: u32): Q[] {
  const out = new Array(n).fill({ a: 0., c: 0 });
  for (let i: u32 = 0; i < out.length; i++) {
    const q = { a: f32(i), c: i };
    out[i] = q;
  }
  return out;
}
export function repeated(n: u32): Q[] {
  const out: Q[] = [];
  const s = { a: 2., c: 5 };
  for (let i: u32 = 0; i < n; i++) {
    out.push(s);
  }
  return out;
}
export function fresh(n: u32): Q[] {
  const out: Q[] = [];
  for (let i: u32 = 0; i < n; i++) {
    out.push({ a: f32(i), c: i });
  }
  return out;
}
`;

function evensJs(n: number, s: number): Q[] {
  const out = new Array<Q>(n).fill({ a: s, c: 3 });
  for (let i = 0; i < n; i++) if (i % 2 === 0) out[i] = { a: i, c: i };
  return out;
}

function repeatedJs(n: number): Q[] {
  const out: Q[] = [];
  const s = { a: 2, c: 5 };
  for (let i = 0; i < n; i++) out.push(s);
  return out;
}

const identities = (xs: readonly unknown[]): number[] => xs.map((x) => xs.indexOf(x));

describe('a struct fill shares one object, as JavaScript does (change 0114, A8 item 4)', () => {
  it('is taken by both halves', () => {
    bothTake(SHARED);
  });

  it('records a written mark only where the compiler cannot prove every element written', () => {
    const made = (name: string): Record<string, unknown> => {
      const e = face(SHARED).exports.find((x) => x.name === name) as unknown;
      return (e as { face: { made: Record<string, unknown> } }).face.made;
    };
    expect(made('evens')).toEqual(
      expect.objectContaining({ share: 'unwritten', written: 'out_written' }),
    );
    expect(made('untouched')).toEqual(
      expect.objectContaining({ share: 'every', fillFrom: { param: 'q', path: [] } }),
    );
    expect(made('untouched')['written']).toBeUndefined();
    expect(made('every')['share']).toBeUndefined();
    expect(made('every')['written']).toBeUndefined();
    expect(made('repeated')['share']).toBe('every');
    expect(made('fresh')['share']).toBeUndefined();
    expect(face(SHARED).view).toContain(
      'export declare function evens(n: u32, s: f32): Promise<Q[]>;',
    );
  });

  it('gives the elements the run did not write one object, on the CPU tier as in JavaScript', async () => {
    const m = await load(SHARED);
    const made = (await m['evens']!(5, 0.5)) as Q[];
    const js = evensJs(5, 0.5);
    expect(made).toEqual(js);
    expect(identities(made)).toEqual(identities(js));
    expect(identities(made)).toEqual([0, 1, 2, 1, 4]);
    expect(made[1]).toBe(made[3]);
    expect(made[0]).not.toBe(made[2]);
    made[1]!.a = 9;
    js[1]!.a = 9;
    expect(made[3]!.a).toBe(9);
    expect(made).toEqual(js);
  });

  it('gives every element the caller object a fill of a parameter names', async () => {
    const m = await load(SHARED);
    const q = { a: 1, c: 2 };
    const made = (await m['untouched']!(3, q)) as Q[];
    expect(made).toEqual(new Array<Q>(3).fill(q));
    expect(made[0]).toBe(q);
    expect(made[2]).toBe(q);
    expect(await m['untouched']!(0, q)).toEqual([]);
  });

  it('gives each element its own object when every element is written', async () => {
    const m = await load(SHARED);
    const made = (await m['every']!(3)) as Q[];
    expect(made).toEqual([
      { a: 0, c: 0 },
      { a: 1, c: 1 },
      { a: 2, c: 2 },
    ]);
    expect(identities(made)).toEqual([0, 1, 2]);
  });

  it('gives two pushes of one object two references to it, and fresh pushes their own', async () => {
    const m = await load(SHARED);
    const made = (await m['repeated']!(3)) as Q[];
    const js = repeatedJs(3);
    expect(made).toEqual(js);
    expect(identities(made)).toEqual(identities(js));
    made[0]!.a = 7;
    expect(made[2]!.a).toBe(7);
    const own = (await m['fresh']!(3)) as Q[];
    expect(identities(own)).toEqual([0, 1, 2]);
    expect(await m['repeated']!(0)).toEqual([]);
  });
});

const refusal = (body: string, params = 'n: u32'): string => `"use typeshade";
export interface Q { a: f32; c: u32; }
export function f(${params}): Q[] {
${body}
  return out;
}
`;

const STORED = (stored: string, fn = 'f'): string =>
  `"out[i] = ${stored}" stores "${stored}" into "out", the array "${fn}" makes and returns, and ` +
  `the compiler cannot tell whether another element holds the same object. An object in two ` +
  `elements of it is not supported yet: store an object literal, a new instance, or a const ` +
  `built in the same iteration.`;

const PUSHED = (pushed: string): string =>
  `"out.push(${pushed})" pushes "${pushed}" onto "out", the array "f" grows and returns, and ` +
  `the compiler cannot tell which of its pushes push one object. That is not supported yet: ` +
  `push a new object each time, or push only one const object declared before the loop and ` +
  `never changed.`;

describe('a store the compiler cannot tell is one object is refused (change 0114, A8 item 4)', () => {
  it('refuses a const declared before the loop stored into each element', () => {
    bothRefuse(
      refusal(`  const out = new Array(n).fill({ a: 1., c: 3 });
  const w = { a: 2., c: 1 };
  for (let i: u32 = 0; i < n; i++) {
    out[i] = w;
  }`),
      'TS8099',
      STORED('w'),
    );
  });

  it('refuses a parameter stored into each element', () => {
    bothRefuse(
      refusal(
        `  const out = new Array(n).fill({ a: 1., c: 3 });
  for (let i: u32 = 0; i < n; i++) {
    out[i] = q;
  }`,
        'n: u32, q: Q',
      ),
      'TS8099',
      STORED('q'),
    );
  });

  it('refuses another element stored into an element', () => {
    bothRefuse(
      refusal(`  const out = new Array(n).fill({ a: 1., c: 3 });
  for (let i: u32 = 1; i < n; i++) {
    out[i] = out[i - 1];
  }`),
      'TS8099',
      STORED('out[i - 1]'),
    );
  });

  it('leaves an object changed after it is stored to the refusal of change 0142', () => {
    bothRefuse(
      refusal(`  const out = new Array(n).fill({ a: 1., c: 3 });
  for (let i: u32 = 0; i < n; i++) {
    const p = { a: 1., c: i };
    out[i] = p;
    p.a = 2.;
  }`),
      'TS8099',
      [
        `"new Array(n).fill({ a: 1., c: 3 })" puts one object in every element, and the ` +
          `elements are then one object. One object under two names is not supported yet ` +
          `(change 0142, stage 3). Build each element in a loop.`,
        `"p" is stored in a second place here, and it is used after that. One object under two ` +
          `names is not supported yet (change 0142, stage 3). Store it where it is last used, ` +
          `or build a new object for the second place.`,
      ],
    );
  });

  it('refuses pushes of one object mixed with pushes of new ones', () => {
    bothRefuse(
      refusal(`  const out: Q[] = [];
  const s = { a: 2., c: 5 };
  for (let i: u32 = 0; i < n; i++) {
    out.push(s);
    out.push({ a: 1., c: i });
  }`),
      'TS8099',
      PUSHED('s'),
    );
  });

  it('refuses pushes of one object that the body changes', () => {
    bothRefuse(
      refusal(`  const out: Q[] = [];
  const s = { a: 2., c: 5 };
  for (let i: u32 = 0; i < n; i++) {
    s.c = i;
    out.push(s);
  }`),
      'TS8099',
      [
        PUSHED('s'),
        `"s" is stored in a second place here, and it is used after that. One object under two ` +
          `names is not supported yet (change 0142, stage 3). Store it where it is last used, ` +
          `or build a new object for the second place.`,
      ],
    );
  });
});
