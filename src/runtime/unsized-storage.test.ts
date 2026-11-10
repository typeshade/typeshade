// Verifies: Rule 6.1, Rule 8.21
// An exported storage array with no size is sized by the host (change 0138, Amendment A3).
// `export declare const ps: storage<array<Particle>>` states no size, so the host view declares a
// `Buffer<Particle>` whose length the host sets with `resize(n)` or `set(data)`. Both readers of
// the shader source are read (`compile()` and the language service), the generated module is
// imported and run, and `tsc` reads a host program over the view.

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { hostFace } from '../compiler/ts/host-face.js';
import { compile } from '../compiler/ts/compile.js';
import { createTypeshadeLanguageService } from '../language-service/service.js';
import { tscDiagnostics } from '../core/testing/tsc-diagnostics.js';
import { Region } from './region.js';
import {
  dirtyRange,
  exportedBinding,
  makeBuffer,
  markClean,
  rangeOf,
  type Buffer,
} from './resource.js';
import type { f32, vec3 } from './host-types.js';

const RUNTIME = resolve(__dirname, '../core/host-runtime.ts');
const PUBLIC = resolve(__dirname, '../runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SOURCE = `"use typeshade";

export class Particle {
  pos: vec3 = vec3(0.);
  life: f32 = 0.;
}

class Hidden {
  w: f32 = 0.;
}

/** The particles, as many as the host gives. */
export declare const ps: storage<array<Particle>, "read_write">;
export declare const ro: storage<array<Particle>>;
export declare const four: storage<array<Particle, 4>, "read_write">;
export declare const scale: uniform<f32>;
export declare const tint: uniform<vec3>;
export declare const hidden: uniform<Hidden>;
export declare const one: storage<Particle>;
export declare const weights: storage<array<f32>>;
export declare const image: texture_2d<f32>;
export declare const smp: sampler;

export const step = compute([4], function step(id: builtin<"global_invocation_id", vec3u>) {
  const i = id.x;
  ps[i].life = ps[i].life + ro[i].life + four[0].life + scale + tint.x + hidden.w + one.life + weights[0] + textureSampleLevel(image, smp, vec2(0.), 0.).x;
});
`;

type Particle = { pos: vec3; life: f32 };
/** A buffer as a caller that `tsc` did not read sees it. */
type Loose = { resize(n: unknown): void; set(data: unknown): void };

function face() {
  const f = hostFace(SOURCE, { fileName: '/app/scene.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f as Required<typeof f>;
}

/** A fresh evaluation of the generated module, so each test starts with no length set. */
let copies = 0;
async function load(): Promise<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-unsized-storage-'));
  dirs.push(dir);
  const file = join(dir, `scene${copies++}.shade.mjs`);
  writeFileSync(file, face().code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
}

const UNSET = (name: string, at: string): TypeError =>
  new TypeError(
    `${name}.${at}: ${name} is a storage array with no size that scene.shade.ts exports, and its length is not set. Call ${name}.resize(n) or ${name}.set(data) first.`,
  );

describe('an exported storage array with no size is read by both halves (Rule 6.1)', () => {
  it('compiles to a runtime-sized binding, and the language service reports nothing on it', () => {
    const r = compile(SOURCE, { fileName: 'scene.shade.ts' });
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('@group(0) @binding(0) var<storage, read_write> ps: array<Particle>;');
    expect(r.wgsl).toContain('@group(0) @binding(1) var<storage, read> ro: array<Particle>;');
    const ls = createTypeshadeLanguageService();
    ls.openDocument('scene.shade.ts', SOURCE);
    expect(ls.getDiagnostics('scene.shade.ts')).toEqual([]);
    const hover = (at: string): string | undefined =>
      ls.getHover('scene.shade.ts', ls.positionAt('scene.shade.ts', SOURCE.indexOf(at)))?.contents;
    // Inside the shader the binding reads as its value, an array with no size (Rule 6.1).
    expect(hover('ps: storage')).toContain('const ps: array<Particle>');
    expect(hover('ps: storage')).toContain('read_write storage resource at @group(0) @binding(0)');
    expect(hover('ro: storage')).toContain('const ro: array<Particle>');
    expect(hover('ro: storage')).toContain('read storage resource at @group(0) @binding(1)');
  });

  it('the view declares it a Buffer, and every other binding as before', () => {
    const view = face().view;
    expect(view).toContain('export declare const ps: Buffer<Particle>;');
    expect(view).toContain('export declare const ro: Buffer<Particle>;');
    expect(view).toContain('export declare const four: Buffer<Particle>;');
    expect(view).toContain(
      'The shader states no size for this storage array, so the host sets its length: call `resize(n)` or `set(data)` before `at` or `read`, which throw a `TypeError` until then.',
    );
    // A scalar, a vector, a struct no exported class declares, one `storage<T>`, an array of
    // scalars, a texture and a sampler stay bindings with their reason.
    for (const name of ['scale', 'tint', 'hidden', 'one', 'weights', 'image', 'smp'])
      expect(view).toContain(`export declare const ${name}: never;`);
    expect(view).toContain('its type Hidden is no class the module exports');
  });
});

describe('the host sets the length (Amendment A3)', () => {
  it('has no length until resize or set, and at and read throw a TypeError naming it', async () => {
    const { ps, ro } = (await load()) as { ps: Buffer<Particle>; ro: Buffer<Particle> };
    expect(ps.length).toBe(0);
    expect(() => ps.at(0)).toThrow(UNSET('ps', 'at()'));
    expect(() => ps.read()).toThrow(UNSET('ps', 'read()'));
    expect(() => ro.at(0)).toThrow(UNSET('ro', 'at()'));
    // A length of 0 that the host set is a length: the array is empty, and it is read.
    ps.resize(0);
    expect(await ps.read()).toEqual([]);
    expect(() => ps.at(0)).toThrow(RangeError);
  });

  it('resize gives zeroed elements, keeps the ones that fit, and marks the whole range dirty', async () => {
    const { ps } = (await load()) as { ps: Buffer<Particle> };
    ps.resize(3);
    expect(ps.length).toBe(3);
    expect((await ps.read()).map((p) => [p.pos, p.life])).toEqual(
      Array.from({ length: 3 }, () => [[0, 0, 0], 0]),
    );
    ps.at(0).pos.set(1, 2, 3);
    ps.at(2).life.set(7);
    markClean(ps);
    expect(dirtyRange(ps)).toBeUndefined();
    ps.resize(5);
    expect(ps.length).toBe(5);
    // Particle is 16 bytes in a storage array (Rule 6.8), so 5 elements are 80 bytes.
    expect(dirtyRange(ps)).toMatchObject({ from: 0, to: 80 });
    expect((await ps.read()).map((p) => p.life)).toEqual([0, 0, 7, 0, 0]);
    expect((await ps.read())[0]!.pos).toEqual([1, 2, 3]);
    markClean(ps);
    ps.resize(1);
    expect(dirtyRange(ps)).toMatchObject({ from: 0, to: 16 });
    expect((await ps.read()).map((p) => p.pos)).toEqual([[1, 2, 3]]);
    // The element that a shrink dropped is zero when the array grows again.
    ps.resize(3);
    expect((await ps.read()).map((p) => p.life)).toEqual([0, 0, 0]);
    expect(() => (ps as unknown as Loose).resize(1.5)).toThrow(
      new TypeError(
        'ps.resize(): takes a length that is a whole number from 0 to 4294967295, got number 1.5.',
      ),
    );
    expect(() => (ps as unknown as Loose).resize('3')).toThrow(TypeError);
    expect(ps.length).toBe(3);
  });

  it('set gives the length of the data and its values, and changes nothing when one does not fit', async () => {
    const { ps } = (await load()) as { ps: Buffer<Particle> };
    ps.set([{ life: 1 }, { pos: [4, 5, 6], life: 2 }]);
    expect(ps.length).toBe(2);
    expect((await ps.read()).map((p) => [p.pos, p.life])).toEqual([
      [[0, 0, 0], 1],
      [[4, 5, 6], 2],
    ]);
    expect(dirtyRange(ps)).toMatchObject({ from: 0, to: 32 });
    // A field the data does not name is zero, as array(Class, data) reads it.
    ps.set([{ pos: [9, 9, 9] }]);
    expect((await ps.read()).map((p) => [p.pos, p.life])).toEqual([[[9, 9, 9], 0]]);
    expect(() => (ps as unknown as Loose).set([{ life: 3 }, { life: 'x' }])).toThrow(
      new TypeError('ps[1].life: takes a number (f32), got the string "x".'),
    );
    expect(() => (ps as unknown as Loose).set(4)).toThrow(
      new TypeError("ps.set(): takes an array of the elements' values, got number 4."),
    );
    expect(ps.length).toBe(1);
    expect((await ps.read())[0]!.pos).toEqual([9, 9, 9]);
    ps.set([]);
    expect(ps.length).toBe(0);
    expect(await ps.read()).toEqual([]);
  });

  it('an accessor taken before a resize reads the new range, and refuses an element that is gone', async () => {
    const { ps } = (await load()) as { ps: Buffer<Particle> };
    ps.resize(2);
    const first = ps.at(0);
    const last = ps.at(1);
    first.life.set(1);
    last.life.set(2);
    const before = rangeOf(ps).range;
    ps.resize(1);
    expect(rangeOf(ps).range).not.toBe(before);
    expect(before.freed).toBe(true);
    first.life.set(5);
    expect((await ps.read())[0]!.life).toBe(5);
    expect(() => last.life.set(9)).toThrow(
      new TypeError(
        'ps[1].life: ps was resized, and this element is no longer in it. Take the accessor again with at().',
      ),
    );
    expect(() => last.life.get()).toThrow(TypeError);
  });

  it('a storage array that states its size keeps it, and refuses dispose()', async () => {
    const { four, ps } = (await load()) as { four: Buffer<Particle>; ps: Buffer<Particle> };
    expect(four.length).toBe(4);
    four.at(3).life.set(2);
    expect(() => four.resize(8)).toThrow(
      new TypeError(
        'four.resize(): four is a storage array of 4 elements in scene.shade.ts, which states its size, so it cannot hold 8. Declare it storage<array<T>>, with no size, for a length the host sets.',
      ),
    );
    expect(() => four.set([{ life: 1 }])).toThrow(TypeError);
    expect(four.length).toBe(4);
    expect((await four.read())[3]!.life).toBe(2);
    // Its own length is no other length: the elements stay, and the whole range is dirty.
    markClean(four);
    four.resize(4);
    expect((await four.read())[3]!.life).toBe(2);
    expect(dirtyRange(four)).toMatchObject({ from: 0, to: 64 });
    four.set([{ life: 1 }, {}, {}, {}]);
    expect((await four.read()).map((p) => p.life)).toEqual([1, 0, 0, 0]);
    ps.resize(1);
    expect(() => ps.dispose()).toThrow(TypeError);
    expect(ps.length).toBe(1);
  });
});

// Verifies: Rule 8.21
describe('a resize moves the range in the region (R17)', () => {
  it.each([
    ['a region that replaces its buffer', false],
    ['a region that grows its buffer in place', true],
  ])('grows past the capacity of %s, and an accessor reads the new range', async (_, resizable) => {
    const { Particle } = (await load()) as { Particle: new () => object };
    const region = new Region(64, resizable);
    const ps = exportedBinding('ps', 'scene.shade.ts', Particle, null, region) as Buffer<Particle>;
    const other = makeBuffer(region, Particle, 2, undefined, 'zeros()') as Buffer<Particle>;
    other.at(1).life.set(11);
    ps.resize(2);
    const first = ps.at(0);
    first.pos.set(1, 2, 3);
    ps.at(1).life.set(4);
    const buffer = region.buffer;
    const generation = region.generation;
    const bytes = region.buffer.byteLength;
    // 64 elements of 16 bytes are 1024 bytes, past the 64 the region began with.
    ps.resize(64);
    expect(region.buffer.byteLength).toBeGreaterThan(bytes);
    if (!resizable) {
      expect(region.buffer).not.toBe(buffer);
      expect(region.generation).toBeGreaterThan(generation);
    }
    expect(ps.length).toBe(64);
    // The accessor made before the growth writes the range the array has now.
    expect([...first.pos.get()]).toEqual([1, 2, 3]);
    first.life.set(8);
    const all = await ps.read();
    expect([all[0]!.pos, all[0]!.life, all[1]!.life, all[63]!.life]).toEqual([[1, 2, 3], 8, 4, 0]);
    ps.at(63).life.set(6);
    // The array beside it holds what it held, and the freed range is given out again.
    expect((await other.read())[1]!.life).toBe(11);
    expect(region.count).toBe(2);
    expect(region.used).toBe(32 + 1024);
    const next = makeBuffer(region, Particle, 2, undefined, 'zeros()') as Buffer<Particle>;
    expect(rangeOf(next).range.offset).toBe(32);
    expect((await next.read()).map((p) => p.life)).toEqual([0, 0]);
    expect((await ps.read())[63]!.life).toBe(6);
  });

  it('resizes a Buffer that zeros() made, to any length', async () => {
    const { Particle } = (await load()) as { Particle: new () => object };
    const region = new Region();
    const ps = makeBuffer(region, Particle, 2, undefined, 'zeros()') as Buffer<Particle>;
    ps.at(1).life.set(3);
    ps.resize(4);
    expect((await ps.read()).map((p) => p.life)).toEqual([0, 3, 0, 0]);
    ps.set([{ life: 1 }]);
    expect(ps.length).toBe(1);
    ps.dispose();
    expect(() => ps.resize(2)).toThrow(TypeError);
    expect(() => ps.set([])).toThrow(TypeError);
    expect(region.count).toBe(0);
  });
});

describe('a host program over the view types the buffer', () => {
  it('types resize and set, and refuses a wrong length, wrong data and a binding with no resource', async () => {
    const f = face();
    const dir = mkdtempSync(join(tmpdir(), 'typeshade-unsized-storage-view-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'scene.shade.ts'), SOURCE);
    writeFileSync(join(dir, 'scene.shade.typeshade.ts'), f.view);
    const head = `import { zeros, type Buffer } from ${JSON.stringify(PUBLIC.replace(/\.ts$/, '.js'))};\nimport { ps, ro, four, weights, Particle } from './scene.shade.ts';\n`;
    const lines = [
      'ps.resize(1024);',
      'ps.set([{ pos: [0, 1, 2], life: 1 }, { life: 2 }]);',
      'ps.at(0).life.set(1);',
      'const n: number = ps.length;',
      'const b: Buffer<Particle> = ps;',
      'const r: Buffer<Particle> = ro;',
      'ps.resize("8");',
      'ps.set([{ nope: 1 }]);',
      'ps.set({ life: 1 });',
      'four.resize(4);',
      'zeros(Particle, 2).resize(8);',
      'weights.resize(4);',
      'ps = b;',
    ];
    const app = join(dir, 'app.ts');
    writeFileSync(app, `${head}${lines.join('\n')}\nexport { n, r };\n`);
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
      'ps.resize(1024);: ',
      'ps.set([{ pos: [0, 1, 2], life: 1 }, { life: 2 }]);: ',
      'ps.at(0).life.set(1);: ',
      'const n: number = ps.length;: ',
      'const b: Buffer<Particle> = ps;: ',
      'const r: Buffer<Particle> = ro;: ',
      'ps.resize("8");: TS2345',
      'ps.set([{ nope: 1 }]);: TS2353',
      'ps.set({ life: 1 });: TS2353',
      'four.resize(4);: ',
      'zeros(Particle, 2).resize(8);: ',
      'weights.resize(4);: TS2339',
      'ps = b;: TS2632',
    ]);
  });
});
