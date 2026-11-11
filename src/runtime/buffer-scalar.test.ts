// Verifies: Rule 8.21 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.22 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 11.8 (docs/language-design.md; traced in reqs/).
// One `Buffer` (change 0138, Amendment A10, Q-I and Q-C; Amendment A11, Q1 to Q7). `array(xs)` of a
// typed array is a `Buffer` of its scalars with the members of every `Buffer`: `length`, `read()`,
// `set(data)`, `resize(n)`, `at(i)` with `get` and `set`, `needsUpdate` and `dispose()`. A kernel
// called on a resource that returns a value returns `Buffer`s at once: one element for a number or
// a vector, `N` for an `array<T, N>`, and for a struct an object of them by the struct's own fields,
// nested structs included (A11, Q6). A call on a resource that writes a plain array waits and gives
// plain data (A11, Q7). Both readers of the shader source are read (`compile()` and the language
// service), the generated module runs on the CPU tier, and `tsc` reads a host program over the view.

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
import { residentState } from '../core/resident.js';
import type { Buffer } from './resource.js';
import type { f32, u32, vec3 } from './host-types.js';

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

interface Pv {
  p: vec3;
  v: vec3;
}

interface Motion {
  energy: f32;
  pos: Pv;
}

interface Stats {
  hist: array<u32, 4>;
  count: u32;
}

/** The sum of xs. */
export function sum(xs: array<f32>): f32 {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return s;
}

/** Each element of xs times k. */
export function scale(xs: array<f32>, k: f32, out: array<f32>): void {
  for (let i: u32 = 0; i < xs.length; i++) {
    out[i] = xs[i] * k;
  }
}

/** The sum of the vectors. */
export function centre(vs: array<vec3>): vec3 {
  let c = vec3(0.);
  for (let i: u32 = 0; i < vs.length; i++) {
    c += vs[i];
  }
  return c;
}

/** The energy of xs and two vectors of it. */
export function motion(xs: array<f32>): Motion {
  let e = 0.;
  for (const x of xs) {
    e += x * x;
  }
  return { energy: e, pos: { p: vec3(e, 0., 0.), v: vec3(0., e, 0.) } };
}

/** How many of xs fall in each quarter of 0 to 4, and how many there are. */
export function stats(xs: array<f32>): Stats {
  let h: array<u32, 4> = [0, 0, 0, 0];
  let n: u32 = 0;
  for (let i: u32 = 0; i < xs.length; i++) {
    const b = u32(clamp(xs[i], 0., 3.));
    h[b] = h[b] + 1;
    n = n + 1;
  }
  return { hist: h, count: n };
}

/** Whether the sum of xs is positive: a bool, a Buffer<bool> on a resource (Amendment A12, Q1). */
export function positive(xs: array<f32>): bool {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return s > 0.;
}

/** A matrix of the first element of xs, a Buffer<mat2x2> on a resource (Amendment A12, Q2). */
export function basis(xs: array<f32>): mat2x2 {
  return mat2x2(xs[0], 0., 0., xs[0]);
}

/** Copies xs into out, and gives the sum. */
export function copySum(xs: array<f32>, out: array<f32>): f32 {
  let s = 0.;
  for (let i: u32 = 0; i < xs.length; i++) {
    out[i] = xs[i];
    s += xs[i];
  }
  return s;
}
`;

interface Module {
  sum: (xs: unknown) => unknown;
  scale: (xs: unknown, k: unknown, out: unknown) => unknown;
  centre: (vs: unknown) => unknown;
  motion: (xs: unknown) => unknown;
  stats: (xs: unknown) => unknown;
  copySum: (xs: unknown, out: unknown) => unknown;
  positive: (xs: unknown) => unknown;
}

function face() {
  const f = hostFace(SOURCE, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f as Required<typeof f>;
}

let loaded: Module | undefined;
async function load(): Promise<Module> {
  if (loaded !== undefined) return loaded;
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-buffer-scalar-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, face().code);
  loaded = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Module;
  return loaded;
}

describe('the shader source is read by both halves', () => {
  it('compiles, and the language service reports nothing', () => {
    const r = compile(SOURCE, { fileName: 'm.shade.ts' });
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const ls = createTypeshadeLanguageService();
    ls.openDocument('m.shade.ts', SOURCE);
    expect(ls.getDiagnostics('m.shade.ts')).toEqual([]);
  });

  it('types each call on a resource in the view: Buffers for the result, plain data for a call that waits', () => {
    const f = face();
    expect(f.view).toContain('export declare function sum(xs: Float32Array): Promise<f32>;');
    expect(f.view).toContain(
      'export declare function sum(xs: Float32Array | Buffer<f32>): Buffer<f32>;',
    );
    expect(f.view).toContain(
      'export declare function centre(vs: Float32Array | Buffer<vec3> | Buffer<f32>): Buffer<vec3>;',
    );
    expect(f.view).toContain(
      'export declare function motion(xs: Float32Array | Buffer<f32>): { readonly energy: Buffer<f32>; readonly pos: { readonly p: Buffer<vec3>; readonly v: Buffer<vec3> } };',
    );
    expect(f.view).toContain(
      'export declare function stats(xs: Float32Array | Buffer<f32>): { readonly hist: Buffer<u32>; readonly count: Buffer<u32> };',
    );
    expect(f.view).toContain(
      'export declare function copySum(xs: Float32Array | Buffer<f32>, out: Buffer<f32>): Buffer<f32>;',
    );
    expect(f.view).toContain(
      'export declare function copySum(xs: Float32Array | Buffer<f32>, out: Float32Array | Buffer<f32>): Promise<f32>;',
    );
  });
});

describe('a Buffer of scalars has the members of every Buffer (Amendment A11, Q1, Q2 and Q5)', () => {
  it('gives its length, its elements and a typed array, and sets, resizes and disposes', async () => {
    const xs = array(new Float32Array([1, 2, 3]));
    expect(xs.length).toBe(3);
    expect(xs.at(1).get()).toBe(2);
    xs.at(1).set(5);
    expect([...(await xs.read())]).toEqual([1, 5, 3]);
    expect(await xs.read()).toBeInstanceOf(Float32Array);
    expect(await array(new Int32Array([1])).read()).toBeInstanceOf(Int32Array);
    expect(await array(new Uint32Array([1])).read()).toBeInstanceOf(Uint32Array);
    expect(await array(new Float64Array([1])).read()).toBeInstanceOf(Float64Array);
    xs.set([7, 8]);
    expect(xs.length).toBe(2);
    expect([...(await xs.read())]).toEqual([7, 8]);
    xs.resize(4);
    expect([...(await xs.read())]).toEqual([7, 8, 0, 0]);
    expect(() => xs.at(4)).toThrow(RangeError);
    // An element view of an element that a resize took away throws.
    const last = xs.at(3);
    xs.resize(2);
    expect(() => last.get()).toThrow(
      'at(3).get(): element 3 is gone; the Buffer holds 2 elements since resize() or set().',
    );
    expect(() => last.set(1)).toThrow('at(3).set(): element 3 is gone');
    xs.resize(4);
    expect(() => array(new Uint32Array(1)).at(0).set(-1)).toThrow(
      'at(0).set(): got -1, which is not a whole number in the u32 range.',
    );
    xs.dispose();
    await expect(xs.read()).rejects.toThrow(
      'This Buffer was disposed; make a new one with array().',
    );
  });

  it("refuses the host's accessors from a call that writes it until read() (Amendment A11, Q1)", async () => {
    const m = await load();
    const xs = array(new Float32Array([1, 2]));
    const out = array(new Float32Array(2));
    m.scale(xs, 2, out);
    const WINDOW =
      'a call wrote this Buffer, and its values are on the device until `await read()` brings them back; await it first.';
    expect(() => out.at(0).get()).toThrow(`at(0).get(): ${WINDOW}`);
    expect(() => out.at(0).set(1)).toThrow(`at(0).set(): ${WINDOW}`);
    expect(() => out.set([1, 1])).toThrow(`set(): ${WINDOW}`);
    expect(() => out.resize(1)).toThrow(`resize(): ${WINDOW}`);
    // The array it only read stays the host's.
    expect(xs.at(0).get()).toBe(1);
    expect([...(await out.read())]).toEqual([2, 4]);
    expect(out.at(1).get()).toBe(4);
  });

  it('each call sees the values of its own call, though the host sets them after (A5, default 3)', async () => {
    const m = await load();
    const xs = array(new Float32Array([1, 2]));
    const a = array(new Float32Array(2));
    const b = array(new Float32Array(2));
    m.scale(xs, 1, a);
    xs.set([10, 20]);
    xs.at(0).set(30);
    m.scale(xs, 1, b);
    expect([...(await a.read())]).toEqual([1, 2]);
    expect([...(await b.read())]).toEqual([30, 20]);
  });

  it('takes an array of numbers as a Buffer whose element its first use fixes (Amendment A12, decision 3)', async () => {
    const xs = array([1, 2, 3]);
    expect(xs.length).toBe(3);
    const values = await xs.read();
    expect(values).toBeInstanceOf(Float32Array);
    expect([...values]).toEqual([1, 2, 3]);
    expect([...(await array([]).read())]).toEqual([]);
    const m = await load();
    const out = array(new Float32Array(3));
    m.scale(xs, 2, out);
    expect([...(await out.read())]).toEqual([2, 4, 6]);
    const d = await createDevice({ prefer: ['cpu'] });
    try {
      const ys = d.array([0.5, 1.5]);
      expect(await ys.read()).toBeInstanceOf(Float32Array);
      expect([...(await ys.read())]).toEqual([0.5, 1.5]);
      // Released, it is pooled by its 4-byte words, as a Float32Array is.
      d.release(ys);
      expect([...(await d.array(new Float32Array([7, 8])).read())]).toEqual([7, 8]);
      expect(d.statistics.reuses).toBe(1);
    } finally {
      await d.dispose();
    }
    expect(() => array([1, 'a'] as never)).toThrow("array(): element 1 is 'a', not a number.");
  });

  it('refuses what is no array of numbers, and names the amendment that refuses it', () => {
    expect(() => array(5 as never)).toThrow(
      'array(): takes an array; got a number. A value the host keeps on the device is uniform(Class, init); pass any other value to the call as it is (change 0138, Amendment A11, Q3).',
    );
    expect(() => array([{ x: 1 }] as never)).toThrow(
      'array(): takes an array of numbers, a Float32Array, an Int32Array, a Uint32Array or a Float64Array; got an array. Write array(Class, data) for an array of structs of an exported class, or pass the array to the call as it is (change 0138, Amendment A11, Q4).',
    );
  });

  it('a Buffer bound to a number gives the call the value it holds at the call (A5, default 3)', async () => {
    const m = await load();
    const xs = array(new Float32Array([1, 2]));
    const k = array(new Float32Array([2]));
    const out = array(new Float32Array(2));
    m.scale(xs, k, out);
    k.set([3]);
    expect([...(await out.read())]).toEqual([2, 4]);
    // A set before the call and one after it, while calls made before still wait: the call sees
    // the first.
    const a = array(new Float32Array(2));
    const b = array(new Float32Array(2));
    m.scale(xs, 1, a);
    k.set([5]);
    m.scale(xs, k, b);
    k.at(0).set(7);
    expect([...(await b.read())]).toEqual([5, 10]);
    expect([...(await k.read())]).toEqual([7]);
  });

  it('a call reads a Buffer bound to a number though the host disposes it after the call', async () => {
    const m = await load();
    const xs = array(new Float32Array([1, 2]));
    const k = array(new Float32Array([2]));
    const out = array(new Float32Array(2));
    m.scale(xs, k, out);
    k.dispose();
    expect([...(await out.read())]).toEqual([2, 4]);
    // Disposed before the call, it is refused at the call.
    expect(() => m.scale(xs, k, out)).toThrow(
      'This Buffer was disposed; make a new one with array().',
    );
  });

  it("a pooled Buffer that device.array() gives again is out of the released one's window", async () => {
    const m = await load();
    const d = await createDevice({ prefer: ['cpu'] });
    try {
      const xs = d.array(new Float32Array([1, 2]));
      const out = d.array(new Float32Array(2));
      m.scale(xs, 2, out);
      d.release(out);
      const again = d.array(new Float32Array([5, 6]));
      expect(d.statistics.reuses).toBe(1);
      expect(again.at(0).get()).toBe(5);
      expect([...(await again.read())]).toEqual([5, 6]);
      m.scale(xs, 3, again);
      d.release(again);
      const zeroed = d.array(2, 'f32');
      expect(zeroed.at(1).get()).toBe(0);
      expect([...(await zeroed.read())]).toEqual([0, 0]);
    } finally {
      await d.dispose();
    }
  });

  it('set() and resize() recover a Buffer a failed call left newer on the device (A7, decision b)', async () => {
    // A failure on WebGPU after the call bound the Buffer it writes: the device copy is the newer,
    // and the call's error is kept.
    const failed = () => {
      const xs = array(new Float32Array([1, 2]));
      const state = residentState(xs)!;
      state.fresh = 'device';
      state.error = new TypeError('the call failed');
      return xs;
    };
    const a = failed();
    expect(a.at(0).get()).toBe(1);
    await expect(a.read()).rejects.toThrow('the call failed');
    a.set([3, 4]);
    expect(a.at(0).get()).toBe(3);
    expect([...(await a.read())]).toEqual([3, 4]);
    const b = failed();
    b.resize(3);
    expect([...(await b.read())]).toEqual([1, 2, 0]);
  });
});

describe('a kernel called on a resource returns Buffers (Amendment A10, Q-C; Amendment A11, Q6)', () => {
  it('a number is a Buffer of one element, which another call takes as its argument', async () => {
    const m = await load();
    const xs = array(new Float32Array([1, 2, 3]));
    const s = m.sum(xs) as Buffer<f32>;
    expect(s.length).toBe(1);
    const out = array(new Float32Array(3));
    m.scale(xs, s, out);
    expect([...(await s.read())]).toEqual([6]);
    expect([...(await out.read())]).toEqual([6, 12, 18]);
  });

  it('a vector is a Buffer of one vector, its components one after another', async () => {
    const m = await load();
    const vs = array(new Float32Array([1, 2, 3, 4, 5, 6]));
    const c = m.centre(vs) as Buffer<vec3>;
    expect(c.length).toBe(1);
    expect([...(await c.read())]).toEqual([5, 7, 9]);
    expect([...(c.at(0).get() as Float32Array)]).toEqual([5, 7, 9]);
    // A Buffer<f32> for an array<vec3> holds a whole number of vectors (Amendment A11, Q5).
    expect(() => m.centre(array(new Float32Array(4)))).toThrow(
      /not a whole number of 3-component elements/,
    );
  });

  it('a struct is an object of Buffers by its own fields, a nested struct an object of them', async () => {
    const m = await load();
    const r = m.motion(array(new Float32Array([1, 2]))) as {
      energy: Buffer<f32>;
      pos: { p: Buffer<vec3>; v: Buffer<vec3> };
    };
    expect([...(await r.energy.read())]).toEqual([5]);
    expect([...(await r.pos.p.read())]).toEqual([5, 0, 0]);
    expect([...(await r.pos.v.read())]).toEqual([0, 5, 0]);
  });

  it('an array<T, N> field is a Buffer of N elements', async () => {
    const m = await load();
    const r = m.stats(array(new Float32Array([0.5, 1.5, 1.2, 3.5]))) as {
      hist: Buffer<u32>;
      count: Buffer<u32>;
    };
    expect(r.hist.length).toBe(4);
    expect([...(await r.hist.read())]).toEqual([1, 2, 0, 1]);
    expect([...(await r.count.read())]).toEqual([4]);
  });

  it('a call that writes a plain array waits, fills it and gives plain data (Amendment A11, Q7)', async () => {
    const m = await load();
    const out = new Float32Array(2);
    const done = m.copySum(array(new Float32Array([2, 3])), out);
    expect(done).toBeInstanceOf(Promise);
    expect(await done).toBe(5);
    expect([...out]).toEqual([2, 3]);
    // Called with plain data only, as before.
    expect(await m.sum(new Float32Array([1, 2]))).toBe(3);
  });

  it('refuses a Buffer for a number of another element, or of more than one element', async () => {
    const m = await load();
    const xs = array(new Float32Array([1]));
    expect(() => m.scale(xs, array(new Uint32Array([1])), array(new Float32Array(1)))).toThrow(
      'scale(): parameter "k" (f32) takes a Buffer of one f32; got a Buffer of 1 u32 numbers.',
    );
    expect(() => m.scale(xs, array(new Float32Array(2)), array(new Float32Array(1)))).toThrow(
      'scale(): parameter "k" (f32) takes a Buffer of one f32; got a Buffer of 2 f32 numbers.',
    );
  });
});

describe('a host program over the view (tsc)', () => {
  it('accepts the Buffer forms and refuses a Buffer where a number is written', async () => {
    const f = face();
    const dir = mkdtempSync(join(tmpdir(), 'typeshade-buffer-scalar-view-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'm.shade.ts'), SOURCE);
    writeFileSync(join(dir, 'm.shade.typeshade.ts'), f.view);
    const head = `import { array, type Buffer, type f32, type u32, type vec3 } from ${JSON.stringify(PUBLIC.replace(/\.ts$/, '.js'))};\nimport { sum, scale, centre, motion, stats, copySum, positive, basis } from './m.shade.ts';\nconst xs = array(new Float32Array(4));\n`;
    const lines = [
      'const s: Buffer<f32> = sum(xs);',
      'const [first] = await s.read();',
      'scale(xs, s, array(new Float32Array(4)));',
      'const c: Buffer<vec3> = centre(xs);',
      'const e: Buffer<f32> = motion(xs).pos.p.length > 0 ? motion(xs).energy : s;',
      'const h: Buffer<u32> = stats(xs).hist;',
      'const w: number = await copySum(xs, new Float32Array(4));',
      'const p: number = await sum(new Float32Array(4));',
      'const bad: number = sum(xs);',
      'xs.at(0).set(1);',
      'const v: Float32Array = await xs.read();',
      'const n: Buffer<number> = array([1, 2, 3]);',
      'array(5);',
      'array({ x: 1 });',
      'array([{ x: 1 }]);',
      "array([1, 'a']);",
      'positive(xs);',
      'basis(xs);',
      'const q: boolean = await positive(new Float32Array(4));',
    ];
    const app = join(dir, 'app.ts');
    writeFileSync(
      app,
      `${head}${lines.join('\n')}\nexport { first, c, e, h, w, p, bad, v, n, q };\n`,
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
      (line, i) =>
        `${line}: ${found
          .filter((d) => d.fileName === app && d.line === first + i)
          .map((d) => `TS${d.code}`)
          .join(' ')}`,
    );
    expect(found.filter((d) => d.fileName !== app).map((d) => `${d.fileName} TS${d.code}`)).toEqual(
      [],
    );
    expect(byLine).toEqual([
      'const s: Buffer<f32> = sum(xs);: ',
      'const [first] = await s.read();: ',
      'scale(xs, s, array(new Float32Array(4)));: ',
      'const c: Buffer<vec3> = centre(xs);: ',
      'const e: Buffer<f32> = motion(xs).pos.p.length > 0 ? motion(xs).energy : s;: ',
      'const h: Buffer<u32> = stats(xs).hist;: ',
      'const w: number = await copySum(xs, new Float32Array(4));: ',
      'const p: number = await sum(new Float32Array(4));: ',
      'const bad: number = sum(xs);: TS2322',
      'xs.at(0).set(1);: ',
      'const v: Float32Array = await xs.read();: ',
      'const n: Buffer<number> = array([1, 2, 3]);: ',
      'array(5);: TS2769',
      'array({ x: 1 });: TS2769',
      'array([{ x: 1 }]);: TS2769',
      "array([1, 'a']);: TS2769",
      'positive(xs);: ',
      'basis(xs);: ',
      'const q: boolean = await positive(new Float32Array(4));: ',
    ]);
  });
});
