// Verifies: Rule 8.21 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './host-face.js';
import { bothTake } from '../../core/testing/both-halves.js';
import type { KernelFace } from '../../core/host-kernel.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Call = (...a: unknown[]) => Promise<unknown>;

function face(source: string) {
  const f = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f as Required<typeof f>;
}

async function load(source: string): Promise<Record<string, Call>> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-made-elements-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, face(source).code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, Call>;
}

const VECTORS = `"use typeshade";
export function ramp(k: vec4f, n: u32): vec4f[] {
  const out = new Array(n).fill(vec4f());
  for (let i: u32 = 0; i < n; i++) {
    out[i] = k * f32(i);
  }
  return out;
}
export function rampInto(k: vec4f, n: u32, out: vec4f[]) {
  for (let i: u32 = 0; i < n; i++) {
    out[i] = k * f32(i);
  }
}
export function spread(n: u32, s: f32): vec3f[] {
  const out = new Array(n).fill(vec3f(1., 2., s));
  for (let i: u32 = 1; i < n; i++) {
    out[i] = vec3f(f32(i), s, 0.);
  }
  return out;
}
export function counts(n: u32, k: vec2u): vec2u[] {
  const out = new Array(n).fill(vec2u(k.y, 7));
  return out;
}
export function signs(n: i32): vec2i[] {
  const out = new Array(n).fill(vec2i(-1, n));
  return out;
}
export function short(n: u32): vec2f[] {
  const out = new Array(n).fill(vec2f());
  for (let i: u32 = 0; i < n * 2; i++) {
    out[i] = vec2f(1., 1.);
  }
  return out;
}
export function kept(n: u32): vec2f[] {
  const out: vec2f[] = [];
  for (let i: u32 = 0; i < n; i++) {
    if (i % 2 == 0) {
      out.push(vec2f(f32(i), 1.));
    }
  }
  return out;
}
`;

const STRUCTS = `"use typeshade";
export interface Q { a: f32; v: vec2f; c: u32; }
export class P { a: f32; b: vec3f; }
export function quads(n: u32, s: f32): Q[] {
  const out = new Array(n).fill({ a: s, v: vec2f(0., 1.), c: 3 });
  for (let i: u32 = 1; i < n; i++) {
    out[i] = { a: f32(i), v: vec2f(s, f32(i)), c: i };
  }
  return out;
}
export function quadsInto(n: u32, s: f32, out: Q[]) {
  for (let i: u32 = 1; i < n; i++) {
    out[i] = { a: f32(i), v: vec2f(s, f32(i)), c: i };
  }
}
export function points(n: u32): P[] {
  const out: P[] = [];
  for (let i: u32 = 0; i < n; i++) {
    const p = new P();
    p.a = f32(i);
    p.b = vec3f(f32(i), 2., 3.);
    out.push(p);
  }
  return out;
}
`;

const typeAfterName = (hover: string | undefined): string | undefined =>
  /\bout: ([^\n`]+)/.exec(hover ?? '')?.[1];

describe('a kernel function that makes an array of vectors (change 0114, S5, slice 2)', () => {
  it('is taken by both halves, and out hovers as the parameter form does', () => {
    const halves = bothTake(VECTORS);
    expect(typeAfterName(halves.hover('out = new'))).toBe('array<vec4<f32>>');
    expect(typeAfterName(halves.hover('out = new'))).toBe(
      typeAfterName(halves.hover('out: vec4f[]')),
    );
  });

  it('names the components of each element in the face, and writes no WebGL2 program', () => {
    const ramp = face(VECTORS).exports.find((e) => e.name === 'ramp') as { face: KernelFace };
    expect(ramp.face.gl).toBeUndefined();
    expect(ramp.face.gpu?.loops.length).toBe(1);
    expect((ramp.face as unknown as { made: unknown }).made).toEqual({
      param: 'out',
      count: 'out_length',
      shown: 'out',
      array: 'f32',
      width: 4,
      length: 'ramp__length',
      reads: ['n'],
      fill: 'ramp__fill',
    });
  });

  it('returns the typed array of the scalar, its components one after another', async () => {
    const m = await load(VECTORS);
    const k = [1, 2, 3, 4];
    const made = await m['ramp']!(k, 3);
    expect(made).toBeInstanceOf(Float32Array);
    const want = new Float32Array(12);
    await m['rampInto']!(k, 3, want);
    expect([...(made as Float32Array)]).toEqual([...want]);
    expect([...(made as Float32Array)]).toEqual([0, 0, 0, 0, 1, 2, 3, 4, 2, 4, 6, 8]);
    expect([...((await m['spread']!(2, 5)) as Float32Array)]).toEqual([1, 2, 5, 1, 5, 0]);
    const counts = await m['counts']!(2, [4, 9]);
    expect(counts).toBeInstanceOf(Uint32Array);
    expect([...(counts as Uint32Array)]).toEqual([9, 7, 9, 7]);
    const signs = await m['signs']!(2);
    expect(signs).toBeInstanceOf(Int32Array);
    expect([...(signs as Int32Array)]).toEqual([-1, 2, -1, 2]);
  });

  it('gives an empty typed array for a length of 0', async () => {
    const m = await load(VECTORS);
    const empty = await m['ramp']!([1, 1, 1, 1], 0);
    expect(empty).toBeInstanceOf(Float32Array);
    expect((empty as Float32Array).length).toBe(0);
  });

  it('counts elements, not components, when it checks a write', async () => {
    const m = await load(VECTORS);
    await expect(m['short']!(3)).rejects.toThrow(
      new TypeError(
        'short(): the array it returns, "out", holds 3 elements, and loop 1 writes it at indices 0 to 5.',
      ),
    );
  });

  it('returns the vectors it pushes, their components one after another', async () => {
    const m = await load(VECTORS);
    const kept = await m['kept']!(5);
    expect(kept).toBeInstanceOf(Float32Array);
    expect([...(kept as Float32Array)]).toEqual([0, 1, 2, 1, 4, 1]);
  });

  it('declares the typed array of the scalar in the host view', () => {
    const f = face(VECTORS);
    expect(f.view).toContain(
      'export declare function ramp(k: vec4, n: u32): Promise<Float32Array>;',
    );
    expect(f.view).toContain(
      'export declare function counts(n: u32, k: vec2u): Promise<Uint32Array>;',
    );
    expect(f.view).toContain('a new Float32Array of the 4 components of each element');
  });
});

describe('a kernel function that makes an array of structs (change 0114, S5, slice 2)', () => {
  it('is taken by both halves, and out hovers as the parameter form does', () => {
    const halves = bothTake(STRUCTS);
    expect(typeAfterName(halves.hover('out = new'))).toBe(typeAfterName(halves.hover('out: Q[]')));
  });

  it('returns an array of objects, laid out as a parameter takes them', async () => {
    const m = await load(STRUCTS);
    const made = (await m['quads']!(3, 0.5)) as unknown[];
    expect(Array.isArray(made)).toBe(true);
    const want = [0, 0, 0].map(() => ({ a: 0.5, v: [0, 1], c: 3 }));
    await m['quadsInto']!(3, 0.5, want);
    expect(made).toEqual(want);
    expect(made).toEqual([
      { a: 0.5, v: [0, 1], c: 3 },
      { a: 1, v: [0.5, 1], c: 1 },
      { a: 2, v: [0.5, 2], c: 2 },
    ]);
    expect(made[0]).not.toBe(made[1]);
    expect(await m['quads']!(0, 1)).toEqual([]);
  });

  it('returns instances of an exported class for the structs it pushes', async () => {
    const m = (await load(STRUCTS)) as Record<string, unknown>;
    const points = (await (m['points'] as Call)(2)) as unknown[];
    expect(points).toHaveLength(2);
    expect(points[1]).toBeInstanceOf(m['P'] as new () => object);
    expect(points[1]).toEqual(expect.objectContaining({ a: 1, b: [1, 2, 3] }));
  });

  it('declares an array of the struct by its name in the host view', () => {
    const f = face(STRUCTS);
    expect(f.view).toContain('export declare function quads(n: u32, s: f32): Promise<Q[]>;');
    expect(f.view).toContain('export declare function points(n: u32): Promise<P[]>;');
  });
});
