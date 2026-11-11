// Verifies: Rule 8.21 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 11.8 (docs/language-design.md; traced in reqs/).
// Change 0138, Amendment A12. Decision 3 (OD-7): `array(number[])` makes a `Buffer<number>` whose
// element its first use fixes, `f32` where nothing decides (Q8 to Q11, D2, D3 and D5). Decision 4:
// a call on a resource holds a `bool`, a matrix, a key, a `Record`, an `array<S, N>` and a struct of
// them in `Buffer`s (Q1 to Q7, B2-1 and B2-2). Each behaviour is read on both halves of the same
// source: the generated module runs on the CPU tier, and `tsc` reads a host program over the view
// (Rule 12.7).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { hostFace } from '../compiler/ts/host-face.js';
import { compile } from '../compiler/ts/compile.js';
import { createTypeshadeLanguageService } from '../language-service/service.js';
import { tscDiagnostics } from '../core/testing/tsc-diagnostics.js';
import { array, configure, createDevice } from '../runtime.js';

const RUNTIME = resolve(__dirname, '../core/host-runtime.ts');
const PUBLIC = resolve(__dirname, '../runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  configure({ prefer: ['webgpu', 'webgl2', 'cpu'] });
});
beforeAll(() => {
  configure({ prefer: ['cpu'] });
});

const SOURCE = `"use typeshade";

type Channel = "r" | "g" | "b";

export interface Particle {
  pos: vec3;
  mass: f32;
}

export class Body {
  pos: vec3 = vec3(0.);
  mass: f32 = 0.;
}

export interface Flagged {
  on: bool;
  w: f32;
}

export interface Keyed {
  c: Channel;
  w: f32;
}

export interface Mix {
  ok: bool;
  m: mat2x2;
  c: Channel;
  ps: array<Particle, 2>;
  g: Record<Channel, f32>;
}

/** The sum of xs, as u32. */
export function scan(xs: array<u32>): u32 {
  let s: u32 = 0;
  for (const x of xs) {
    s += x;
  }
  return s;
}

/** The sum of xs, as i32. */
export function sumi(xs: array<i32>): i32 {
  let s: i32 = 0;
  for (const x of xs) {
    s += x;
  }
  return s;
}

/** The sum of xs. */
export function sumf(xs: array<f32>): f32 {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return s;
}

/** The sum of xs, as f64. */
export function sum64(xs: array<f64>): f64 {
  let s = f64(0.);
  for (const x of xs) {
    s += x;
  }
  return s;
}

/** The first of xs, as f64. */
export function first64(xs: array<f64>): f64 {
  return xs[0];
}

/** The sum of the vectors. */
export function cen(vs: array<vec3u>): vec3u {
  let c = vec3u(0);
  for (let i: u32 = 0; i < vs.length; i++) {
    c += vs[i];
  }
  return c;
}

/** Each xs times k into out. */
export function times(xs: array<f32>, k: u32, out: array<f32>): void {
  for (let i: u32 = 0; i < xs.length; i++) {
    out[i] = xs[i] * f32(k);
  }
}

/** Whether the sum is positive. */
export function positive(xs: array<f32>): bool {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return s > 0.;
}

/** The signs of the first two. */
export function signs(xs: array<f32>): vec2b {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return vec2b(xs[0] > 0., xs[1] > 0.);
}

/** 1 where b, else 0, into out. */
export function gate(b: bool, xs: array<f32>, out: array<f32>): void {
  for (let i: u32 = 0; i < xs.length; i++) {
    out[i] = select(0., xs[i], b);
  }
}

/** A mat3x3 of the first nine. */
export function pose(xs: array<f32>): mat3x3 {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return mat3x3(xs[0], xs[1], xs[2], xs[3], xs[4], xs[5], xs[6], xs[7], xs[8]);
}

/** Two mat3x3s. */
export function poses(xs: array<f32>): array<mat3x3, 2> {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return [mat3x3(xs[0], 0., 0., 0., xs[0], 0., 0., 0., xs[0]), mat3x3(s, 0., 0., 0., s, 0., 0., 0., s)];
}

/** The trace of m times each xs. */
export function trace(m: mat3x3, xs: array<f32>, out: array<f32>): void {
  for (let i: u32 = 0; i < xs.length; i++) {
    out[i] = (m[0][0] + m[1][1] + m[2][2]) * xs[i];
  }
}

/** The trace of each matrix. */
export function traces(ms: array<mat3x3>, out: array<f32>): void {
  for (let i: u32 = 0; i < ms.length; i++) {
    out[i] = ms[i][0][0] + ms[i][1][1] + ms[i][2][2];
  }
}

/** A channel of the sign of the sum. */
export function pick(xs: array<f32>): Channel {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return s > 0. ? "g" : "b";
}

/** Two channels. */
export function picks(xs: array<f32>): array<Channel, 2> {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return ["r", s > 0. ? "b" : "g"];
}

/** 2 for g, else 1, times each xs. */
export function weigh(c: Channel, xs: array<f32>, out: array<f32>): void {
  for (let i: u32 = 0; i < xs.length; i++) {
    out[i] = select(1., 2., c == "g") * xs[i];
  }
}

/** 1 where the channel is b. */
export function blues(cs: array<Channel>, out: array<u32>): void {
  for (let i: u32 = 0; i < cs.length; i++) {
    out[i] = select(u32(0), u32(1), cs[i] == "b");
  }
}

/** A gain for each channel. */
export function gains(xs: array<f32>): Record<Channel, f32> {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return { r: s, g: 1., b: 2. };
}

/** Two particles. */
export function top(xs: array<f32>): array<Particle, 2> {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return [{ pos: vec3(s, 0., 0.), mass: 1. }, { pos: vec3(0., s, 0.), mass: 2. }];
}

/** The mass of each particle. */
export function masses(ps: array<Particle>, out: array<f32>): void {
  for (let i: u32 = 0; i < ps.length; i++) {
    out[i] = ps[i].mass;
  }
}

/** Two bodies. */
export function bodies(xs: array<f32>): array<Body, 2> {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return [{ pos: vec3(s), mass: 3. }, { pos: vec3(0.), mass: 4. }];
}

/** Two flagged weights. */
export function flags(xs: array<f32>): array<Flagged, 2> {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return [{ on: s > 0., w: s }, { on: false, w: 1. }];
}

/** Two keyed weights. */
export function keyed(xs: array<f32>): array<Keyed, 2> {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return [{ c: "g", w: s }, { c: "b", w: 1. }];
}

/** The weight of each keyed where its channel is b. */
export function blueWeights(ks: array<Keyed>, out: array<f32>): void {
  for (let i: u32 = 0; i < ks.length; i++) {
    out[i] = select(0., ks[i].w, ks[i].c == "b");
  }
}

/** A struct of every kind. */
export function mix(xs: array<f32>): Mix {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return {
    ok: s > 0.,
    m: mat2x2(s, 0., 0., s),
    c: "r",
    ps: [{ pos: vec3(s), mass: 1. }, { pos: vec3(0.), mass: 2. }],
    g: { r: 1., g: 2., b: s },
  };
}

/** The index of each positive xs, pushed onto list. */
export function keep(xs: array<f32>, list: array<u32>): void {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] > 0.) {
      list.push(i);
    }
  }
}

declare const marks: storage<array<u32>, "read_write">;

/** Each mark is the workgroup count. */
@compute([1])
export function mark(gid: builtin<"global_invocation_id">, nw: builtin<"num_workgroups">) {
  if (gid.x < marks.length) {
    marks[gid.x] = nw.x;
  }
}
`;

type Call = (...args: unknown[]) => unknown;
type Module = Record<string, Call> & { Body: new () => object };

function face() {
  const f = hostFace(SOURCE, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f as Required<typeof f>;
}

let loaded: Module | undefined;
async function load(): Promise<Module> {
  if (loaded !== undefined) return loaded;
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-buffer-kinds-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, face().code);
  loaded = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Module;
  return loaded;
}

/** The values of a `Buffer`, as an array. */
const values = async (b: unknown): Promise<unknown[]> => [
  ...((await (b as { read(): Promise<ArrayLike<unknown>> }).read()) as ArrayLike<unknown> &
    Iterable<unknown>),
];
/** What a `Buffer` reads, as it reads it. */
const read = (b: unknown): Promise<unknown> => (b as { read(): Promise<unknown> }).read();

const XS = (): Float32Array => new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);

describe('the shader source is read by both halves', () => {
  it('compiles, and the language service reports nothing', () => {
    const r = compile(SOURCE, { fileName: 'm.shade.ts' });
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const ls = createTypeshadeLanguageService();
    ls.openDocument('m.shade.ts', SOURCE);
    expect(ls.getDiagnostics('m.shade.ts')).toEqual([]);
  });
});

describe('array(number[]): the first use fixes the element (Amendment A12, decision 3, OD-7)', () => {
  it('a use fixes it as the parameter needs, and f32 is the element where nothing decides', async () => {
    const m = await load();
    const xs = array([1, 2, 3]);
    expect(await values(m.scan!(xs))).toEqual([6]);
    expect(await read(xs)).toBeInstanceOf(Uint32Array);
    const is = array([-1, 2]);
    expect(await values(m.sumi!(is))).toEqual([1]);
    expect(await read(is)).toBeInstanceOf(Int32Array);
    // Nothing decides: its element is f32 (OD-7).
    const ys = array([0.5, 2]);
    expect(await read(ys)).toBeInstanceOf(Float32Array);
    expect(await values(ys)).toEqual([0.5, 2]);
    // An array of vectors: the scalar decides.
    const vs = array([1, 2, 3, 4, 5, 6]);
    expect(await values(m.cen!(vs))).toEqual([5, 7, 9]);
    expect(await read(vs)).toBeInstanceOf(Uint32Array);
    expect(vs.length).toBe(6);
  });

  it('a number, a matrix and an array<matCxR> parameter fix it (A10 Q-C; A12 Q3 and B2-1)', async () => {
    const m = await load();
    const k = array([3]);
    const out = array(new Float32Array(2));
    m.times!(array(new Float32Array([1, 2])), k, out);
    expect(await values(out)).toEqual([3, 6]);
    expect(await read(k)).toBeInstanceOf(Uint32Array);
    const mat = array([1, 0, 0, 0, 2, 0, 0, 0, 3]);
    const t = array(new Float32Array(1));
    m.trace!(mat, array(new Float32Array([2])), t);
    expect(await values(t)).toEqual([12]);
    expect(await read(mat)).toBeInstanceOf(Float32Array);
    const ms = array([1, 0, 0, 0, 1, 0, 0, 0, 1, 2, 0, 0, 0, 2, 0, 0, 0, 2]);
    const tr = array(new Float32Array(2));
    m.traces!(ms, tr);
    expect(await values(tr)).toEqual([3, 6]);
  });

  it('a held length and an indirect count fix it as u32, and so does a storage array (A12, D3)', async () => {
    const m = await load();
    const list = array(new Uint32Array(4));
    const length = array([1]);
    m.keep!(array(new Float32Array([1, -1, 2])), { array: list, length });
    expect(await read(length)).toBeInstanceOf(Uint32Array);
    expect(await values(length)).toEqual([3]);
    const counts = array([2, 1, 1]);
    const marks = array([0, 0, 0, 0]);
    m.mark!({ marks }, { indirect: counts });
    expect(await read(counts)).toBeInstanceOf(Uint32Array);
    expect(await read(marks)).toBeInstanceOf(Uint32Array);
    expect(await values(marks)).toEqual([2, 2, 0, 0]);
  });

  it('a read before the first use gives f32 values and leaves the element open (Q9)', async () => {
    const m = await load();
    const xs = array([1.1, 2]);
    const before = (await read(xs)) as Float32Array;
    expect(before).toBeInstanceOf(Float32Array);
    expect(before[0]).toBe(Math.fround(1.1));
    expect(xs.at(0).get()).toBe(Math.fround(1.1));
    // Still open: a u32 use checks the numbers as given, and refuses 1.1.
    expect(() => m.scan!(xs)).toThrow(
      'scan(): parameter "xs" (u32): element 0 is 1.1, which is not a whole number in the u32 range.',
    );
    // The refused use fixed nothing (D2): an f32 use takes it.
    expect(await values(m.sumf!(xs))).toEqual([Math.fround(Math.fround(1.1) + 2)]);
  });

  it('a refused first use does not fix it (D2)', async () => {
    const m = await load();
    const xs = array([-1, 2]);
    expect(() => m.scan!(xs)).toThrow(
      'element 0 is -1, which is not a whole number in the u32 range.',
    );
    expect(await values(m.sumi!(xs))).toEqual([1]);
    expect(await read(xs)).toBeInstanceOf(Int32Array);
  });

  it('a later use of another element is a TypeError that names the element and the first use (Q10)', async () => {
    const m = await load();
    const xs = array([1, 2]);
    m.scan!(xs);
    let error: unknown;
    try {
      m.sumf!(xs);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toMatch(
      /^sumf\(\): parameter "xs" takes a Buffer of f32; this Buffer's element is u32, which its first use fixed at .*buffer-kinds\.test\.ts:\d+:\d+.* \(change 0138, Amendment A12, Q10\)\./,
    );
    // The call changed nothing.
    expect(await values(xs)).toEqual([1, 2]);
  });

  it('set(), resize() and at(i).set() keep it open (Q11)', async () => {
    const m = await load();
    const xs = array([1, 2]);
    xs.set([3, 4, 5.5]);
    expect(xs.at(2).get()).toBe(5.5);
    xs.resize(4);
    xs.at(2).set(5);
    xs.at(3).set(7);
    expect(await values(m.scan!(xs))).toEqual([19]);
    expect([...((await read(xs)) as Uint32Array)]).toEqual([3, 4, 5, 7]);
    // Once fixed, each checks against u32 (A11, Q1).
    expect(() => xs.at(0).set(1.5)).toThrow(
      'at(0).set(): got 1.5, which is not a whole number in the u32 range.',
    );
  });

  it("an f64 place fixes f64, from the numbers as given (the owner's decision of 2026-11-11, A13)", async () => {
    const m = await load();
    const xs = array([0.1, 0.2]);
    // Before the first use, read() gives f32 values (Q9).
    expect(((await read(xs)) as Float32Array)[0]).toBe(Math.fround(0.1));
    const first = m.first64!(xs);
    expect(await values(first)).toEqual([0.1]);
    expect(await values(m.sum64!(xs))).toEqual([0.1 + 0.2]);
    const after = (await read(xs)) as Float64Array;
    expect(after).toBeInstanceOf(Float64Array);
    expect([...after]).toEqual([0.1, 0.2]);
    // Fixed: a use of another element is refused (Q10), and changes nothing.
    expect(() => m.sumf!(xs)).toThrow(
      /^sumf\(\): parameter "xs" takes a Buffer of f32; this Buffer's element is f64, which its first use fixed at .*buffer-kinds\.test\.ts:\d+:\d+.* \(change 0138, Amendment A12, Q10\)\./,
    );
    expect(await values(xs)).toEqual([0.1, 0.2]);
    // A Buffer an f32 use fixed is refused at an f64 place.
    const ys = array([1, 2]);
    m.sumf!(ys);
    expect(() => m.sum64!(ys)).toThrow("this Buffer's element is f32, which its first use fixed");
  });

  it("a Buffer that device.array()'s pool hands out again is open again (D5)", async () => {
    const m = await load();
    const d = await createDevice({ prefer: ['cpu'] });
    try {
      const xs = d.array([1, 2]);
      expect(await values(m.scan!(xs))).toEqual([3]);
      d.release(xs);
      const again = d.array([0.5, 1.5]);
      expect(d.statistics.reuses).toBe(1);
      expect(await values(m.sumf!(again))).toEqual([2]);
      expect(await read(again)).toBeInstanceOf(Float32Array);
    } finally {
      await d.dispose();
    }
  });
});

describe('the result kinds of a call on a resource (Amendment A12, decision 4)', () => {
  it('a bool is a Buffer<bool>: read() gives booleans, and a bool parameter takes it (Q1)', async () => {
    const m = await load();
    const b = m.positive!(array(XS())) as {
      length: number;
      at(i: number): { get(): unknown; set(x: unknown): void };
      set(d: unknown): void;
    };
    expect(await read(b)).toEqual([true]);
    expect(b.length).toBe(1);
    expect(b.at(0).get()).toBe(true);
    const out = array(new Float32Array(2));
    m.gate!(b, array(new Float32Array([4, 5])), out);
    expect(await values(out)).toEqual([4, 5]);
    b.set([false]);
    expect(await read(b)).toEqual([false]);
    expect(() => b.at(0).set(1)).toThrow('at(0).set(): takes a boolean; got a number.');
    // A vecN<bool> reads its components one after another; length counts vectors.
    const v = m.signs!(array(new Float32Array([1, -1]))) as {
      length: number;
      at(i: number): { get(): unknown };
    };
    expect(await read(v)).toEqual([true, false]);
    expect(v.length).toBe(1);
    expect(v.at(0).get()).toEqual([true, false]);
    // No array<bool> exists, since a bool has no storage layout.
    expect(() => m.sumf!(b)).toThrow(
      'sumf(): parameter "xs" (array<f32>) takes no Buffer of 1 bools: no array<bool> exists, since a bool has no storage layout (change 0138, Amendment A12, decision 4).',
    );
  });

  it('a matrix reads unpadded, column-major; a matrix and an array<matCxR> take it, padded at the call (Q2, Q3, B2-1, B2-2)', async () => {
    const m = await load();
    const p = m.pose!(array(XS())) as { length: number; at(i: number): { get(): unknown } };
    const read9 = (await read(p)) as Float32Array;
    expect(read9).toBeInstanceOf(Float32Array);
    expect([...read9]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(p.length).toBe(1);
    expect([...(p.at(0).get() as Float32Array)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const t = array(new Float32Array(1));
    m.trace!(p, array(new Float32Array([1])), t);
    expect(await values(t)).toEqual([15]);
    // A Buffer<f32> of exactly C * R, and no other length.
    m.trace!(array(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1])), array(new Float32Array([1])), t);
    expect(await values(t)).toEqual([3]);
    expect(() => m.trace!(array(new Float32Array(8)), array(new Float32Array([1])), t)).toThrow(
      'trace(): parameter "m" (mat3x3) takes a Buffer of one mat3x3, or of 9 f32 numbers; got a Buffer of 8 f32 numbers.',
    );
    // N matrices: length counts matrices, and an array<mat3x3> takes them.
    const ps = m.poses!(array(new Float32Array([2]))) as { length: number };
    expect(ps.length).toBe(2);
    expect((await read(ps)) as Float32Array).toHaveLength(18);
    const tr = array(new Float32Array(2));
    m.traces!(ps, tr);
    expect(await values(tr)).toEqual([6, 6]);
    m.traces!(array(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1])), tr);
    expect(await values(tr)).toEqual([3, 1]);
    expect(() => m.traces!(array(new Float32Array(10)), tr)).toThrow(
      'traces(): parameter "ms" (array<mat3x3>): got 10 numbers, which is not a whole number of 9-component elements.',
    );
    // A plain array<mat3x3> is an array of matrices.
    await expect(m.traces!(new Float32Array(9), new Float32Array(1))).rejects.toThrow(
      'traces(): parameter "ms" (array<mat3x3>): got a Float32Array, not an array.',
    );
  });

  it('a key is a Buffer<K> of ids that reads its members; K and array<K> take it (Q4, B2-2)', async () => {
    const m = await load();
    const k = m.pick!(array(new Float32Array([1]))) as {
      at(i: number): { get(): unknown; set(x: unknown): void };
      set(d: unknown): void;
    };
    expect(await read(k)).toEqual(['g']);
    expect(k.at(0).get()).toBe('g');
    const out = array(new Float32Array(1));
    m.weigh!(k, array(new Float32Array([3])), out);
    expect(await values(out)).toEqual([6]);
    k.set(['r']);
    expect(await read(k)).toEqual(['r']);
    // The members in id order (change 0081).
    expect(() => k.set(['x'])).toThrow("set(): element 0: takes one of 'b', 'g', 'r'; got 'x'.");
    const ks = m.picks!(array(new Float32Array([1])));
    expect(await read(ks)).toEqual(['r', 'b']);
    const blue = array(new Uint32Array(2));
    m.blues!(ks, blue);
    expect(await values(blue)).toEqual([0, 1]);
    // An array<u32> takes no Buffer<K>.
    expect(() => m.scan!(ks)).toThrow(
      "scan(): parameter \"xs\" (array<u32>) takes no Buffer of 2 keys of 'b' | 'g' | 'r' (change 0138, Amendment A12, decision 4).",
    );
  });

  it('a Record is an object of Buffers, one for each member (Q5)', async () => {
    const m = await load();
    const g = m.gains!(array(new Float32Array([1, 2]))) as Record<string, unknown>;
    expect(Object.keys(g)).toEqual(['b', 'g', 'r']);
    expect(await values(g.r)).toEqual([3]);
    expect(await values(g.b)).toEqual([2]);
  });

  it('an array<S, N> is one Buffer<S>: S[] of plain objects or of the class, the struct accessor, and an argument of array<S> (Q6)', async () => {
    const m = await load();
    const ps = m.top!(array(new Float32Array([2]))) as {
      length: number;
      at(i: number): { mass: { get(): unknown } };
    };
    expect(ps.length).toBe(2);
    expect(await read(ps)).toEqual([
      { pos: [2, 0, 0], mass: 1 },
      { pos: [0, 2, 0], mass: 2 },
    ]);
    expect(ps.at(1).mass.get()).toBe(2);
    const out = array(new Float32Array(2));
    m.masses!(ps, out);
    expect(await values(out)).toEqual([1, 2]);
    // An exported class: instances of it.
    const bs = (await read(m.bodies!(array(new Float32Array([1]))))) as object[];
    expect(bs[0]).toBeInstanceOf(m.Body);
    expect(bs[1]).toMatchObject({ mass: 4 });
  });

  it('an S that holds a key reads its members, and an array<S> takes its ids (Q4, Q6)', async () => {
    const m = await load();
    const ks = m.keyed!(array(new Float32Array([3]))) as {
      at(i: number): { c: { get(): unknown } };
    };
    expect(await read(ks)).toEqual([
      { c: 'g', w: 3 },
      { c: 'b', w: 1 },
    ]);
    expect(ks.at(1).c.get()).toBe('b');
    const out = array(new Float32Array(2));
    m.blueWeights!(ks, out);
    expect(await values(out)).toEqual([0, 1]);
  });

  it('an S that holds a bool has a host-only layout: read() and at(i) work, and no parameter takes it (Q7)', async () => {
    const m = await load();
    const fs = m.flags!(array(new Float32Array([2]))) as {
      at(i: number): { on: { get(): unknown; set(x: unknown): void } };
    };
    expect(await read(fs)).toEqual([
      { on: true, w: 2 },
      { on: false, w: 1 },
    ]);
    expect(fs.at(0).on.get()).toBe(true);
    fs.at(1).on.set(true);
    expect(await read(fs)).toEqual([
      { on: true, w: 2 },
      { on: true, w: 1 },
    ]);
    expect(() => m.masses!(fs, array(new Float32Array(2)))).toThrow(
      'masses(): parameter "ps" takes an array whose elements are laid out otherwise than Buffer<Flagged>\'s; pass a Buffer of the class the parameter names.',
    );
  });

  it('a struct of every kind is an object of Buffers by field path', async () => {
    const m = await load();
    const r = m.mix!(array(new Float32Array([2]))) as Record<string, unknown>;
    expect(await read(r.ok)).toEqual([true]);
    expect([...((await read(r.m)) as Float32Array)]).toEqual([2, 0, 0, 2]);
    expect(await read(r.c)).toEqual(['r']);
    expect(await read(r.ps)).toEqual([
      { pos: [2, 2, 2], mass: 1 },
      { pos: [0, 0, 0], mass: 2 },
    ]);
    expect(await values((r.g as Record<string, unknown>).b)).toEqual([2]);
  });
});

describe('a host program over the view (tsc)', () => {
  it('types Buffer<number> and each result kind as the runtime takes them, and refuses what it refuses', async () => {
    const f = face();
    const dir = mkdtempSync(join(tmpdir(), 'typeshade-buffer-kinds-view-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'm.shade.ts'), SOURCE);
    writeFileSync(join(dir, 'm.shade.typeshade.ts'), f.view);
    const head = `import { array, createDevice, type Buffer, type bool, type vec2b, type mat3x3, type mat2x2, type f32, type u32, type Geometry } from ${JSON.stringify(PUBLIC.replace(/\.ts$/, '.js'))};\nimport * as m from './m.shade.ts';\nconst xs = array(new Float32Array(9));\nconst o = array([1, 2, 3]);\n`;
    const lines: [string, string][] = [
      // Decision 3: Buffer<number> (Q8).
      ['const n: Buffer<number> = array([1, 2]);', ''],
      ['const nd: Buffer<number> = (await createDevice()).array([1, 2]);', ''],
      ['const r: Float32Array | Int32Array | Uint32Array | Float64Array = await o.read();', ''],
      ['const r3: Float32Array | Int32Array | Uint32Array = await o.read();', 'TS2322'],
      ['m.sum64(o); m.first64(o);', ''],
      ['const r2: Float32Array = await o.read();', 'TS2322'],
      ['m.scan(o); m.sumi(o); m.sumf(o); m.cen(o);', ''],
      ['m.times(o, o, o); m.trace(o, o, o); m.traces(o, o);', ''],
      ['m.keep(o, { array: o, length: o });', ''],
      ['m.mark({ marks: o }, { indirect: o });', ''],
      ['o.set([1, 2]); o.resize(3); o.at(0).set(1.5);', ''],
      ['m.scan(array(new Int32Array(2)));', 'TS2769'],
      ['const geo: Geometry = { vertices: o, indices: o, count: 3 };', ''],
      // Decision 4.
      ['const b: Buffer<bool> = m.positive(xs);', ''],
      ['const bs: boolean[] = await b.read();', ''],
      ['const b0: boolean = b.at(0).get();', ''],
      ['m.gate(b, xs, xs);', ''],
      ['const v: Buffer<vec2b> = m.signs(xs);', ''],
      ['const vs: boolean[] = await v.read();', ''],
      ['m.sumf(b);', 'TS2769'],
      ['const p: Buffer<mat3x3> = m.pose(xs);', ''],
      ['const pr: Float32Array = await p.read();', ''],
      ['m.trace(p, xs, xs); m.trace(xs, xs, xs);', ''],
      ['m.traces(m.poses(xs), xs); m.traces(xs, xs);', ''],
      ['m.sumf(p);', 'TS2769'],
      ["const k: Buffer<'r' | 'g' | 'b'> = m.pick(xs);", ''],
      ["const kr: ('r' | 'g' | 'b')[] = await k.read();", ''],
      ["k.set(['r']); k.at(0).set('g');", ''],
      ["k.set(['x']);", 'TS2322'],
      ['m.weigh(k, xs, xs); m.blues(m.picks(xs), array(new Uint32Array(2)));', ''],
      ['m.scan(k);', 'TS2769'],
      ['const g: Buffer<f32> = m.gains(xs).g;', ''],
      ['const ps = m.top(xs);', ''],
      ['const pp: { pos: readonly number[]; mass: number }[] = await ps.read();', ''],
      ['const pm: number = ps.at(0).mass.get();', ''],
      ['m.masses(ps, xs);', ''],
      ['const bodies: m.Body[] = await m.bodies(xs).read();', ''],
      ['m.blueWeights(m.keyed(xs), xs);', ''],
      ['const on: boolean = m.flags(xs).at(0).on.get();', ''],
      ['m.masses(m.flags(xs), xs);', 'TS2769'],
      ['const mm: Buffer<mat2x2> = m.mix(xs).m;', ''],
      ['const mo: Buffer<bool> = m.mix(xs).ok;', ''],
    ];
    const app = join(dir, 'app.ts');
    writeFileSync(
      app,
      `${head}${lines.map(([l]) => l).join('\n')}\nexport { geo, n, nd, r, r2, r3, b, bs, b0, v, vs, p, pr, k, kr, g, pp, pm, bodies, on, mm, mo };\n`,
    );
    const found = await tscDiagnostics([app], {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
      moduleSuffixes: ['.typeshade', ''],
      lib: ['lib.es2022.d.ts', 'lib.esnext.disposable.d.ts', 'lib.dom.d.ts'],
      types: [],
    });
    const first = head.split('\n').length;
    const byLine = lines.map(
      ([line], i) =>
        `${line}: ${found
          .filter((d) => d.fileName === app && d.line === first + i)
          .map((d) => `TS${d.code}`)
          .join(' ')}`,
    );
    expect(found.filter((d) => d.fileName !== app).map((d) => `${d.fileName} TS${d.code}`)).toEqual(
      [],
    );
    expect(byLine).toEqual(lines.map(([line, code]) => `${line}: ${code}`));
  }, 180_000);
});
