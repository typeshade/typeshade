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
interface P {
  a: number;
  c: number;
}

const SOURCE = `"use typeshade";
export interface P { a: f32; c: u32; }
export function reset(xs: P[], p: P): void {
  xs.fill(p);
}
`;

async function load(source: string): Promise<Record<string, Call>> {
  const f = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-fill-shared-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, f.code!);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, Call>;
}

const REFUSED = `"xs.fill" of a P would make every element of "xs" one object, as ECMAScript's "fill" does, and the host's array holds that sharing: this is not supported yet (change 0114, A8 item 4). Write a loop that stores a new object in each element, "for (let i = 0; i < xs.length; i++) { xs[i] = { … }; }".`;

const LOOP = `"use typeshade";
export interface P { a: f32; c: u32; }
export function reset(xs: P[], p: P): void {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = { a: p.a, c: p.c };
  }
}
`;

const VECTORS = `"use typeshade";
export function reset(xs: vec2f[], p: vec2f): void {
  xs.fill(p);
}
`;

describe('xs.fill(p) of a struct on a kernel function array', () => {
  it('both halves refuse it as not supported yet, as the host cannot share one object', () => {
    bothRefuse(SOURCE, 'TS8099', REFUSED);
  });

  it('both halves take a loop that stores a new object in each element, and a vector fill', () => {
    bothTake(LOOP);
    bothTake(VECTORS);
  });

  it('the loop gives the host one object for each element, as JavaScript does for new objects', async () => {
    const m = await load(LOOP);
    const p: P = { a: 2, c: 5 };
    const xs: P[] = [
      { a: 0, c: 0 },
      { a: 1, c: 1 },
    ];
    const js = xs.map((x) => ({ ...x }));
    for (let i = 0; i < js.length; i++) js[i] = { a: p.a, c: p.c };
    await m.reset!(xs, p);
    expect(xs).toEqual(js);
    expect(xs[0] === xs[1]).toBe(js[0] === js[1]);
    expect(xs[0] === p).toBe(js[0] === p);
  });
});
