// Verifies: Rule 8.22 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).
//
// A kernel function's Map and Set (change 0080, part 1): the face of the function, its call on
// the CPU tier, which is the oracle and gives what JavaScript's own Map and Set give, and the
// refusals, read by the compiler and by the editor on the same source (Rule 12.7). The WebGPU
// lowering is a later part of the change.

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './host-face.js';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import type { KernelFace } from '../../core/host-kernel.js';
// A device's fuse() runs through the planner `typeshade/fuse` loads (change 0071).
import '../../fuse.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function face(source: string) {
  const f = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f as Required<typeof f>;
}

type Fn = (...a: unknown[]) => Promise<unknown>;

async function load(source: string): Promise<Record<string, Fn>> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-kernel-collections-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, face(source).code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, Fn>;
}

const kernelOf = (f: ReturnType<typeof face>, name: string): KernelFace => {
  const e = f.exports.find((x) => x.name === name);
  expect(e?.kind).toBe('kernel');
  return (e as { face: KernelFace }).face;
};

const SOURCE = `"use typeshade";
export function labels(pixels: array<u32>, seen: Set<u32>): u32 {
  for (let i: u32 = 0; i < pixels.length; i++) {
    if (pixels[i] !== 0) {
      seen.add(pixels[i]);
    }
  }
  return seen.size;
}
export function latest(keys: array<u32>, values: array<f32>, last: Map<u32, f32>) {
  for (let i: u32 = 0; i < keys.length; i++) {
    last.set(keys[i], values[i]);
  }
}
export function lookup(keys: array<u32>, m: Map<u32, f32>, out: array<f32>) {
  for (let i: u32 = 0; i < keys.length; i++) {
    out[i] = m.has(keys[i]) ? m.get(keys[i])! : -1.;
  }
}
export function floats(xs: array<f32>, seen: Set<f32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    seen.add(xs[i]);
  }
  return seen.size;
}
export function cells(ps: array<vec2f>, last: Map<i32, vec2f>) {
  for (let i: u32 = 0; i < ps.length; i++) {
    last.set(i32(floor(ps[i].x)), ps[i]);
  }
}
`;

/** The editor's diagnostics on `source`, each as `code message`. */
function editor(source: string): string[] {
  const s = createTypeshadeLanguageService();
  s.openDocument('a.ts', source);
  return s.getDiagnostics('a.ts').map((d) => `${String(d.code)} ${d.message}`);
}

/** The compiler's errors on `source`, each as `code message`. */
function compiler(source: string): string[] {
  const r = compile(source, { fileName: '/app/m.shade.ts' } as never) as {
    diagnostics: readonly { code: string; message: string; category: string }[];
  };
  return r.diagnostics.filter((d) => d.category === 'error').map((d) => `${d.code} ${d.message}`);
}

describe('the face of a kernel function that takes a Map or a Set (change 0080)', () => {
  it('takes each by reference, and says why it runs on the CPU tier for now', () => {
    const f = face(SOURCE);
    const labels = kernelOf(f, 'labels');
    expect(labels.params.find((p) => p.name === 'seen')).toEqual({
      name: 'seen',
      k: 'collection',
      key: 'u32',
      writes: true,
      s: 'Set<u32>',
    });
    // WebGPU pushes a record for each add, in the order of the iterations, and the call applies
    // them to the caller's Set (part 2). WebGL2 runs none.
    expect(labels.noGpu).toBeUndefined();
    expect(labels.gpu!.collections).toMatchObject([
      {
        param: 'seen',
        records: { name: '_seen_records', s: 'array<u32>' },
        loop: 0,
        perIteration: 1,
      },
    ]);
    expect(labels.gpu!.arrays.map((b) => b.name)).toEqual(['pixels']);
    expect(labels.noWebgl2).toBe(
      'it takes the Map or Set "seen", which the WebGL2 tier does not run (change 0080)',
    );
    // A Map's record is its key and its value.
    const latest = kernelOf(f, 'latest');
    expect(latest.gpu!.wgsl).toContain(
      '_last_records[_p] = latest_last_Entry(keys[i], values[i]);',
    );
    // A loop that reads a Map runs on the CPU tier in this version.
    expect(kernelOf(f, 'lookup').noGpu).toBe(
      'loop 1 reads the Map "m", which the WebGPU tier reads in a later part of change 0080',
    );
    const lookup = kernelOf(f, 'lookup');
    expect(lookup.params.find((p) => p.name === 'm')).toMatchObject({
      k: 'collection',
      key: 'u32',
      writes: false,
      s: 'Map<u32, f32>',
    });
    // The host view types each as JavaScript's own.
    expect(f.view).toContain('seen: Set<number>');
    expect(f.view).toContain('last: Map<number, number>');
  });
});

describe('what runs on the CPU tier in this version (change 0080, part 2)', () => {
  const gap = (body: string): string | undefined =>
    kernelOf(face(`"use typeshade";\n${body}\n`), 'f').noGpu;
  it('says why for two loops that add to one Set, and an add inside a nested loop', () => {
    expect(
      gap(`export function f(xs: array<u32>, s: Set<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) { s.add(xs[i]); }
  for (let i: u32 = 0; i < xs.length; i++) { s.add(i); }
}`),
    ).toBe('loops 1 and 2 both add to the Set "s", and the second adds after the first');
    expect(
      gap(`export function f(xs: array<u32>, s: Set<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    for (let j: u32 = 0; j < 3; j++) { s.add(xs[i] + j); }
  }
}`),
    ).toBe('loop 1 adds to the Set "s" inside a nested loop, whose trips the call does not count');
    // Two adds in one iteration, in two branches, make room for two records an iteration.
    const k = kernelOf(
      face(`"use typeshade";
export function f(xs: array<u32>, s: Set<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] > 3) { s.add(xs[i]); } else { s.add(i); }
  }
}
`),
      'f',
    );
    expect(k.noGpu).toBeUndefined();
    expect(k.gpu!.collections![0]!.perIteration).toBe(2);
  });
});

describe('a kernel function that takes a Map or a Set, on the CPU tier (Rule 8.23)', () => {
  it('adds each key once, in the order first added, after the keys the host passed', async () => {
    const { labels } = await load(SOURCE);
    const pixels = Uint32Array.of(0, 3, 7, 3, 5, 0, 9);
    const seen = new Set<number>([7]);
    const want = new Set<number>([7]);
    for (const p of pixels) if (p !== 0) want.add(p);
    expect(await labels!(pixels, seen)).toBe(want.size);
    expect([...seen]).toEqual([...want]);
  });

  it('keeps the value set last for a key, in the place of its first set', async () => {
    const { latest } = await load(SOURCE);
    const keys = Uint32Array.of(1, 5, 1, 2, 5);
    const values = Float32Array.of(10, 20, 30, 40, 50);
    const last = new Map<number, number>([
      [5, 1],
      [8, 2],
    ]);
    const want = new Map(last);
    keys.forEach((k, i) => want.set(k, values[i]!));
    await latest!(keys, values, last);
    expect([...last]).toEqual([...want]);
  });

  it('reads a key where has guards it, in a loop that does not add', async () => {
    const { lookup } = await load(SOURCE);
    const m = new Map<number, number>([
      [1, 30],
      [2, 40.5],
    ]);
    const out = new Float32Array(3);
    await lookup!(Uint32Array.of(1, 9, 2), m, out);
    expect([...out]).toEqual([30, -1, 40.5]);
  });

  it('compares f32 keys by SameValueZero: one NaN, and -0 equal to 0', async () => {
    const { floats } = await load(SOURCE);
    const xs = Float32Array.of(-0, 1.5, NaN, 0, NaN, 1.5);
    const seen = new Set<number>();
    const want = new Set<number>(xs);
    expect(await floats!(xs, seen)).toBe(want.size);
    expect([...seen]).toEqual([...want]);
    expect(Object.is([...seen][0], 0)).toBe(true);
  });

  it('keeps a vector value, an i32 key and a negative key', async () => {
    const { cells } = await load(SOURCE);
    const ps = Float32Array.of(1.5, 2, -0.5, 3, 1.25, 4);
    const last = new Map<number, number[]>();
    await cells!(ps, last);
    expect([...last.keys()]).toEqual([1, -1]);
    expect([...last.values()].map((v) => [...v])).toEqual([
      [1.25, 4],
      [-0.5, 3],
    ]);
  });

  it('refuses a host value that is not the parameter, naming the first key that does not fit', async () => {
    const { labels, latest } = await load(SOURCE);
    await expect(labels!(Uint32Array.of(1), new Map())).rejects.toThrow(
      'labels(): parameter "seen" (Set<u32>): takes a Set; got a Map.',
    );
    await expect(labels!(Uint32Array.of(1), new Set([2, -1]))).rejects.toThrow(
      'labels(): parameter "seen" (Set<u32>): the key -1 is not a u32.',
    );
    await expect(
      latest!(Uint32Array.of(1), Float32Array.of(1), new Map([[1.5, 2]])),
    ).rejects.toThrow('latest(): parameter "last" (Map<u32, f32>): the key 1.5 is not a u32.');
  });
});

describe('a call that takes a Map or a Set in a fuse scope (change 0080, Rule 11.13)', () => {
  it('runs in a group of its own, as it runs apart', async () => {
    const { createDevice } = await import('../../runtime/device.js');
    const m = await load(`"use typeshade";
export function scale(xs: array<u32>, ys: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    ys[i] = xs[i] * 2;
  }
}
export function labels(pixels: array<u32>, seen: Set<u32>): u32 {
  for (let i: u32 = 0; i < pixels.length; i++) {
    seen.add(pixels[i]);
  }
  return seen.size;
}
`);
    const dev = await createDevice({ prefer: ['cpu'] });
    const xs = dev.array(Uint32Array.of(3, 1, 3, 2));
    const ys = dev.array(4, 'u32');
    const seen = new Set<number>();
    let n: unknown;
    const report = await dev.fuse(() => {
      void m.scale!(xs, ys);
      void m.labels!(Uint32Array.of(3, 1, 3, 2), seen).then((x) => (n = x));
    });
    expect(report.groups.map((g) => g.calls)).toEqual([['scale'], ['labels']]);
    expect(n).toBe(3);
    expect([...seen]).toEqual([3, 1, 2]);
    expect([...(await ys.read())]).toEqual([6, 2, 6, 4]);
    await dev.dispose();
  });
});

describe('the spelling of a Map and a Set, in both halves (change 0080, Rule 12.7)', () => {
  const program = (body: string): string => `"use typeshade";\n${body}\n`;

  it('accepts the members this change takes', () => {
    const p = program(SOURCE.slice('"use typeshade";\n'.length));
    expect(compiler(p)).toEqual([]);
    expect(editor(p)).toEqual([]);
  });

  it('types has as a bool, get as the value and size as a u32 in the editor', () => {
    const p = program(`export function f(xs: array<u32>, m: Map<u32, f32>): u32 {
  return m.size;
}`);
    const s = createTypeshadeLanguageService();
    s.openDocument('a.ts', p);
    const lines = p.split('\n');
    const line = lines.findIndex((l) => l.includes('m.size'));
    const hover = s.getHover('a.ts', { line, character: lines[line]!.indexOf('size') + 1 });
    expect(hover?.contents).toContain('Map<u32, f32>.size: u32');
  });

  const refusals: readonly (readonly [string, string, string])[] = [
    [
      'a get no has guards',
      `export function f(xs: array<u32>, m: Map<u32, f32>, out: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out[i] = m.get(xs[i])!; }
}`,
      'TS8099 "m.get" gives no value for a key the map does not hold, and a shader value has no undefined (change 0080). Read it where "m.has(xs[i])" is true: inside if (...) or before ? in a conditional.',
    ],
    [
      'an add outside a loop',
      `export function f(xs: array<u32>, s: Set<u32>) {
  s.add(1);
}`,
      'TS8099 "s.add" is a statement in a loop of the kernel function (change 0080). Write it on a line of its own inside a for loop.',
    ],
    [
      'a local that holds one',
      `export function f(xs: array<u32>, s: Set<u32>) {
  const t = s;
}`,
      'TS8099 "t" would hold the Set<u32> "s", and a Map or a Set is a kernel function\'s parameter only (change 0080). Read it by its name instead.',
    ],
    [
      'a key of the wrong type',
      `export function f(xs: array<f32>, s: Set<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) { s.add(xs[i]); }
}`,
      'TS8003 "s.add" takes a key of u32; got a f32.',
    ],
  ];
  for (const [name, body, message] of refusals)
    it(`refuses ${name}, in the compiler and in the editor`, () => {
      const p = program(body);
      expect(compiler(p)).toEqual([message]);
      expect(editor(p)).toContain(message);
    });

  // The editor's own library says these first, where ECMAScript's has them and this change does not.
  const both: readonly (readonly [string, string, string])[] = [
    [
      'a member this change does not take',
      `export function f(xs: array<u32>, s: Set<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) { s.delete(xs[i]); }
}`,
      'TS8099 A Set<u32> in a kernel function has add, has, size (change 0080); "delete" is not one of them.',
    ],
    [
      'a Set anywhere but a kernel function',
      `function g(s: Set<u32>): u32 { return s.size; }
export function f(xs: array<u32>) { }`,
      "TS8002 A Set<K> is a kernel function's parameter only: an exported function that takes an array with no size (Rule 8.22). Take it as a parameter of that function.",
    ],
    [
      'a vector key',
      `export function f(xs: array<u32>, s: Set<vec2f>) { }`,
      'TS8002 The key K of a Set<K> is u32, i32 or f32: a shader value has no identity for ECMAScript to compare another key by.',
    ],
  ];
  for (const [name, body, message] of both)
    it(`refuses ${name}, in the compiler and in the editor`, () => {
      const p = program(body);
      expect(compiler(p)).toEqual([message]);
      expect(editor(p)).toContain(message);
    });
});

describe('the example kernel-set-unique (change 0080)', () => {
  it('compiles in both halves, and gives on the CPU tier what JavaScript gives', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      resolve(__dirname, '../../../examples/kernel-set-unique.shade.ts'),
      'utf8',
    );
    expect(compiler(source)).toEqual([]);
    expect(editor(source)).toEqual([]);
    const { labels, latest, lookup } = await load(source);
    const pixels = Uint32Array.of(0, 4, 2, 4, 0, 9, 2);
    const seen = new Set<number>();
    expect(await labels!(pixels, seen)).toBe(3);
    expect([...seen]).toEqual([4, 2, 9]);
    const last = new Map<number, number>();
    await latest!(Uint32Array.of(3, 1, 3), Float32Array.of(0.5, 1.5, 2.5), last);
    expect([...last]).toEqual([
      [3, 2.5],
      [1, 1.5],
    ]);
    const out = new Float32Array(3);
    await lookup!(Uint32Array.of(1, 7, 3), last, out);
    expect([...out]).toEqual([1.5, -1, 2.5]);
  });
});
