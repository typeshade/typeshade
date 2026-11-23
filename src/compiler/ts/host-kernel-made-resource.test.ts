// Verifies: Rule 8.21 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './host-face.js';
import { bothTake } from '../../core/testing/both-halves.js';
import { array, zeros, type Buffer } from '../../runtime.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Call = (...a: unknown[]) => unknown;

function face(source: string) {
  const f = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f as Required<typeof f>;
}

async function load(source: string): Promise<Record<string, Call>> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-made-resource-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, face(source).code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, Call>;
}

const SOURCE = `"use typeshade";
export class P { a: f32; b: vec3f; }
export interface Q { a: f32; c: u32; }
export function scaled(xs: f32[], s: f32): f32[] {
  const out = new Float32Array(xs.length);
  for (let i: u32 = 0; i < xs.length; i++) {
    out[i] = xs[i] * s;
  }
  return out;
}
export function ramp(n: u32, k: vec4f): vec4f[] {
  const out = new Array(n).fill(vec4f());
  for (let i: u32 = 0; i < n; i++) {
    out[i] = k * f32(i);
  }
  return out;
}
export function minus(xs: i32[]): i32[] {
  const out = new Array(xs.length).fill(-1);
  return out;
}
export function points(xs: f32[]): P[] {
  const out = new Array(xs.length).fill({ a: 0., b: vec3f() });
  for (let i: u32 = 0; i < xs.length; i++) {
    out[i] = { a: xs[i], b: vec3f(f32(i), 2., 3.) };
  }
  return out;
}
export function shared(xs: f32[]): P[] {
  const out = new Array(xs.length).fill({ a: 1., b: vec3f() });
  return out;
}
export function quads(xs: f32[]): Q[] {
  const out = new Array(xs.length).fill({ a: 0., c: 0 });
  for (let i: u32 = 0; i < xs.length; i++) {
    out[i] = { a: xs[i], c: i };
  }
  return out;
}
export function kept(xs: f32[]): f32[] {
  const out: f32[] = [];
  for (let i: u32 = 0; i < xs.length; i++) {
    out.push(xs[i]);
  }
  return out;
}
export function sized(xs: f32[], n: u32): f32[] {
  const out = new Float32Array(n);
  for (let i: u32 = 0; i < xs.length; i++) {
    out[i] = xs[i];
  }
  return out;
}
export function measure(ps: P[]): f32[] {
  const out = new Float32Array(ps.length);
  for (let i: u32 = 0; i < ps.length; i++) {
    out[i] = ps[i].a;
  }
  return out;
}
export function both(xs: f32[], ys: f32[]): f32[] {
  const out = new Float32Array(xs.length);
  for (let i: u32 = 0; i < xs.length; i++) {
    ys[i] = xs[i];
    out[i] = xs[i];
  }
  return out;
}
`;

const PLAIN_STRUCT = `"use typeshade";
export class P { a: f32; b: vec3f; }
export function pointsBoth(xs: f32[], ys: f32[]): P[] {
  const out = new Array(xs.length).fill({ a: 0., b: vec3f() });
  for (let i: u32 = 0; i < xs.length; i++) {
    ys[i] = xs[i];
    out[i] = { a: xs[i], b: vec3f(f32(i), 2., 3.) };
  }
  return out;
}
`;

const read = (b: unknown): Promise<unknown> => (b as Buffer<number>).read();

describe('a kernel function that makes its result, called on a resource (change 0114, S5)', () => {
  it('is taken by both halves', () => {
    bothTake(SOURCE);
  });

  it('returns a new Buffer of the scalar at once, which another call takes', async () => {
    const m = await load(SOURCE);
    const xs = array(new Float32Array([1, 2, 3]));
    const once = m['scaled']!(xs, 2) as Buffer<number>;
    expect(once).not.toBeInstanceOf(Promise);
    expect(once.length).toBe(3);
    const twice = m['scaled']!(once, 10) as Buffer<number>;
    expect([...((await read(twice)) as Float32Array)]).toEqual([20, 40, 60]);
    expect(await read(once)).toBeInstanceOf(Float32Array);
    expect([...((await read(once)) as Float32Array)]).toEqual([2, 4, 6]);
    once.dispose();
    twice.dispose();
    xs.dispose();
  });

  it('gives a vector element as the scalars, its components one after another', async () => {
    const m = await load(SOURCE);
    const lengths = array(new Uint32Array([2]));
    const plain = (await m['ramp']!(2, [1, 2, 3, 4])) as Float32Array;
    const xs = array(new Int32Array(2));
    const minus = m['minus']!(xs) as Buffer<number>;
    expect(minus.length).toBe(2);
    expect([...((await read(minus)) as Int32Array)]).toEqual([-1, -1]);
    expect([...plain]).toEqual([0, 0, 0, 0, 1, 2, 3, 4]);
    lengths.dispose();
    xs.dispose();
    minus.dispose();
  });

  it('gives a Buffer<C> for an element of an exported class', async () => {
    const m = (await load(SOURCE)) as Record<string, unknown>;
    const xs = array(new Float32Array([5, 6]));
    const ps = (m['points'] as Call)(xs) as Buffer<object>;
    expect(ps.length).toBe(2);
    const got = (await ps.read()) as unknown as object[];
    expect(got[1]).toBeInstanceOf(m['P'] as new () => object);
    expect(got).toEqual([
      expect.objectContaining({ a: 5, b: [0, 2, 3] }),
      expect.objectContaining({ a: 6, b: [1, 2, 3] }),
    ]);
    ps.dispose();
    xs.dispose();
  });

  it('checks every index against n at the call, and throws a RangeError for n = 0', async () => {
    const m = await load(SOURCE);
    const xs = array(new Float32Array(4));
    expect(() => m['sized']!(xs, 2)).toThrow(
      new TypeError(
        'sized(): the array it returns, "out", holds 2 elements, and loop 1 writes it at indices 0 to 3.',
      ),
    );
    expect(() => m['sized']!(xs, 0)).toThrow(
      new RangeError(
        'sized(): the array it returns, "out", would have length 0, and a call on a resource returns it as a Buffer, of which a length of 0 is not supported yet (Rule 11.8). Pass plain data for an empty result.',
      ),
    );
    xs.dispose();
  });

  it('refuses the forms it does not support yet, at the call', async () => {
    const m = await load(SOURCE);
    const xs = array(new Float32Array(2));
    expect(() => m['kept']!(xs)).toThrow(
      new TypeError(
        'kept(): returns the array it grows with push, "out", whose length is the number of elements it pushes, known after the run, and a call of it on a resource that does so is not supported yet. Pass plain data and await the call.',
      ),
    );
    expect(() => m['shared']!(xs)).toThrow(
      'whose elements the run does not write share one object, and a call of it on a resource that does so is not supported yet.',
    );
    expect(() => m['quads']!(xs)).toThrow(
      'of Q, which is no class the module exports, and a call of it on a resource that does so is not supported yet.',
    );
    const n = array(new Uint32Array([2]));
    expect(() => m['sized']!(xs, n)).toThrow(
      new TypeError(
        'sized(): parameter "n" is a resource, and the length or the fill value of the array it returns, "out", reads it; a call on a resource that reads them from a resource is not supported yet. Pass "n" as plain data.',
      ),
    );
    xs.dispose();
    n.dispose();
  });

  it('reads the length of a Buffer<C> argument as n', async () => {
    const m = (await load(SOURCE)) as Record<string, unknown>;
    const ps = zeros(m['P'] as never, 3);
    const out = (m['measure'] as Call)(ps) as Buffer<number>;
    expect(out.length).toBe(3);
    expect([...((await read(out)) as Float32Array)]).toEqual([0, 0, 0]);
    out.dispose();
    ps.dispose();
  });

  it('declares the Buffer it returns in the host view', () => {
    const f = face(SOURCE);
    expect(f.view).toContain(
      'export declare function scaled(xs: Float32Array, s: f32): Promise<Float32Array>;',
    );
    expect(f.view).toContain(
      'export declare function scaled(xs: Float32Array | Buffer<f32>, s: f32 | Buffer<f32>): Buffer<f32>;',
    );
    expect(f.view).toContain(
      'export declare function sized(xs: Float32Array | Buffer<f32>, n: u32): Buffer<f32>;',
    );
    expect(f.view).toContain('): Buffer<P>;');
    expect(f.view).not.toMatch(/function kept\([^)]*\): Buffer/);
    expect(f.view).not.toMatch(/function quads\([^)]*\): Buffer/);
  });

  it('waits and gives plain data when the call also writes a plain array (change 0114, A13)', async () => {
    const m = await load(SOURCE);
    const xs = array(new Float32Array([1, 2, 3]));
    const ys = new Float32Array(3);
    const call = m['both']!(xs, ys);
    expect(call).toBeInstanceOf(Promise);
    const got = await call;
    expect(got).toBeInstanceOf(Float32Array);
    expect([...(got as Float32Array)]).toEqual([1, 2, 3]);
    expect([...ys]).toEqual([1, 2, 3]);
    const again = (await m['both']!(
      new Float32Array([1, 2, 3]),
      new Float32Array(3),
    )) as Float32Array;
    expect([...again]).toEqual([...(got as Float32Array)]);
    xs.dispose();
  });

  it('gives plain objects of the class for a struct element of a waiting call', async () => {
    const m = await load(PLAIN_STRUCT);
    const xs = array(new Float32Array([5, 6]));
    const ys = new Float32Array(2);
    const got = (await m['pointsBoth']!(xs, ys)) as object[];
    expect(got[1]).toBeInstanceOf(m['P'] as unknown as new () => object);
    expect([...ys]).toEqual([5, 6]);
    xs.dispose();
  });

  it('still gives a Buffer when the written array is a resource', async () => {
    const m = await load(SOURCE);
    const xs = array(new Float32Array([1, 2]));
    const ys = array(new Float32Array(2));
    const out = m['both']!(xs, ys) as Buffer<number>;
    expect(out).not.toBeInstanceOf(Promise);
    expect([...((await read(out)) as Float32Array)]).toEqual([1, 2]);
    expect([...((await read(ys)) as Float32Array)]).toEqual([1, 2]);
    out.dispose();
    xs.dispose();
    ys.dispose();
  });

  it('declares the promise of plain data for the waiting call in the host view', () => {
    const f = face(SOURCE);
    expect(f.view).toContain(
      'export declare function both(xs: Float32Array | Buffer<f32>, ys: Float32Array | Buffer<f32>): Promise<Float32Array>;',
    );
    expect(f.view).toContain(
      'export declare function both(xs: Float32Array | Buffer<f32>, ys: Buffer<f32>): Buffer<f32>;',
    );
  });
});
