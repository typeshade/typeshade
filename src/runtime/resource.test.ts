// Verifies: Rule 8.21, Rule 11.8
// Host resources (change 0138, milestone 1: R7 to R9 and R17). A class a shader module exports
// carries its layouts in the generated module, and `uniform()`, `zeros()` and `array()` make
// ranges of one region with a typed view for each field. Both readers of a host program are read:
// the generated module is imported and run, and `tsc` reads a host program over the view.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  array,
  dirtyRange,
  makeBuffer,
  makeUniform,
  markClean,
  rangeOf,
  texture,
  uniform,
  zeros,
  LAYOUT_KEY,
  type Buffer,
  type Uniform,
} from './resource.js';
import { configure, resident, residentState } from '../core/resident.js';
import { hasWarned } from '../core/deprecation.js';
import { createDevice } from './device.js';
import { endUse, pushUse } from './default-device.js';

const RUNTIME = resolve(__dirname, '../core/host-runtime.ts');
const PUBLIC = resolve(__dirname, '../runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SOURCE = `"use typeshade";

/** What a frame's shaders read once. */
export class Camera {
  pos: vec3 = vec3(0.);
  time: f32 = 0.;
  view: mat4x4 = mat4x4();
  count: u32 = 0;
  weights: array<f32, 4> = [0., 0., 0., 0.];
}

export class Particle {
  pos: vec3 = vec3(0.);
  vel: vec3 = vec3(0.);
  life: f32 = 0.;
  /** How far it moves in \`dt\`. */
  step(dt: f32): vec3 {
    return this.vel * dt;
  }
}

export class Flag {
  on: bool = false;
}

export class Shadowed {
  set: f32 = 0.;
}
`;

function face(source = SOURCE) {
  const f = hostFace(source, { fileName: '/app/scene.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f as Required<typeof f>;
}

let loaded: Record<string, unknown> | undefined;
async function load(): Promise<Record<string, unknown>> {
  if (loaded !== undefined) return loaded;
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-resource-'));
  dirs.push(dir);
  const file = join(dir, 'scene.shade.mjs');
  writeFileSync(file, face().code);
  loaded = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
  return loaded;
}

describe('the shader source of the resources is read by both halves', () => {
  it('compiles clean, and the language service reports nothing on it', () => {
    const r = compile(SOURCE, { fileName: 'scene.shade.ts' });
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const ls = createTypeshadeLanguageService();
    ls.openDocument('scene.shade.ts', SOURCE);
    expect(ls.getDiagnostics('scene.shade.ts')).toEqual([]);
  });
});

describe('the generated class carries its layouts (change 0138)', () => {
  it('writes the uniform and the storage layout of each concrete class', async () => {
    const m = await load();
    const camera = (m.Camera as unknown as Record<symbol, unknown>)[LAYOUT_KEY] as {
      u: { k: 'o'; sz: number; f: [string, number, unknown][] };
      s: { k: 'a'; st: number };
    };
    // Rule 6.8, uniform rules: the matrix at 16, the array of f32 at a stride of 16.
    expect(camera.u.f.map(([n, at]) => [n, at])).toEqual([
      ['pos', 0],
      ['time', 12],
      ['view', 16],
      ['count', 80],
      ['weights', 96],
    ]);
    expect(camera.u.sz).toBe(160);
    const particle = (m.Particle as unknown as Record<symbol, unknown>)[LAYOUT_KEY] as {
      s: { st: number };
    };
    // Rule 6.8, storage rules: vel at 16, life at 28, and a stride of 32.
    expect(particle.s.st).toBe(32);
    const flag = (m.Flag as unknown as Record<symbol, unknown>)[LAYOUT_KEY] as { un: string };
    expect(flag.un).toBe('field Flag.on: a bool is not host-shareable');
  });
});

describe('a uniform (R7, R8)', () => {
  it('sets each kind of field through its view and reads it back with get', async () => {
    const { Camera } = (await load()) as { Camera: new () => object };
    const region = new Region();
    const cam = makeUniform(region, Camera, { time: 2 }) as Uniform<Record<string, never>> &
      Record<string, { set(...a: unknown[]): void; get(): unknown; at(i: number): never }>;
    cam.pos.set(0, 2, 5);
    expect([...(cam.pos.get() as Float32Array)]).toEqual([0, 2, 5]);
    expect(cam.time.get()).toBe(2);
    const m = Array.from({ length: 16 }, (_, i) => i);
    cam.view.set(m);
    expect([...(cam.view.get() as Float32Array)]).toEqual(m);
    cam.count.set(7);
    expect(cam.count.get()).toBe(7);
    cam.weights.set([1, 2, 3, 4]);
    // Each element of an array of f32 in a uniform sits at a stride of 16 bytes.
    expect([...(cam.weights.get() as Float32Array)].filter((_, i) => i % 4 === 0)).toEqual([
      1, 2, 3, 4,
    ]);
    (cam.weights.at(2) as unknown as { set(v: number): void }).set(9);
    expect((cam.weights.at(2) as unknown as { get(): number }).get()).toBe(9);
    // The bytes are the region's own.
    const { range } = rangeOf(cam);
    expect(new Float32Array(region.buffer, range.offset + 16, 1)[0]).toBe(0);
    expect(new Float32Array(region.buffer, range.offset + 4, 1)[0]).toBe(2);
  });

  it('writes only what changed and widens the dirty byte range', async () => {
    const { Camera } = (await load()) as { Camera: new () => object };
    const cam = makeUniform(new Region(), Camera, undefined) as Uniform<object> &
      Record<string, { set(...a: unknown[]): void }>;
    // A new uniform has never been uploaded.
    expect(cam.needsUpdate).toBe(true);
    expect(dirtyRange(cam)).toMatchObject({ from: 0, to: 160 });
    markClean(cam);
    expect(cam.needsUpdate).toBe(false);
    cam.time.set(0);
    expect(dirtyRange(cam)).toBeUndefined();
    cam.time.set(1.5);
    expect(dirtyRange(cam)).toMatchObject({ from: 12, to: 16 });
    cam.count.set(3);
    expect(dirtyRange(cam)).toMatchObject({ from: 12, to: 84 });
    markClean(cam);
    cam.set({ time: 1.5, count: 3 });
    expect(dirtyRange(cam)).toBeUndefined();
    cam.needsUpdate = true;
    expect(dirtyRange(cam)).toMatchObject({ from: 0, to: 160 });
  });

  it('refuses a value that does not fit, naming the field', async () => {
    const { Camera, Flag, Shadowed } = (await load()) as Record<string, new () => object>;
    const cam = makeUniform(new Region(), Camera, undefined) as Record<
      string,
      { set(...a: unknown[]): void }
    > & { set(v: unknown): void };
    expect(() => cam.count.set(-1)).toThrow(
      'Uniform<Camera>.count: got -1, which is not a whole number in the u32 range.',
    );
    expect(() => cam.pos.set(1, 2)).toThrow(
      'Uniform<Camera>.pos.set(): takes 3 numbers or one array of 3, got 2 arguments.',
    );
    expect(() => cam.pos.set([1, 'x', 3])).toThrow(
      'Uniform<Camera>.pos[1]: takes a number (f32), got the string "x".',
    );
    expect(() => cam.set({ speed: 1 })).toThrow(
      'Uniform<Camera>.set(): "speed" is not a field; the fields are pos, time, view, count, weights.',
    );
    expect(() => makeUniform(new Region(), Flag, undefined)).toThrow(
      'uniform(): Flag has no uniform layout a host can write: field Flag.on: a bool is not host-shareable.',
    );
    expect(() => makeUniform(new Region(), Shadowed, undefined)).toThrow(
      'Uniform<Shadowed>: the field "set" has the name of the accessor\'s own method',
    );
    expect(() => uniform(class Plain {} as never)).toThrow(
      'uniform(): takes a class a shader module exports (an import of a .shade.ts), got the function Plain, which no shader module made.',
    );
  });

  it('throws a TypeError naming it after dispose(), and frees its range', async () => {
    const { Camera } = (await load()) as { Camera: new () => object };
    const region = new Region();
    const cam = makeUniform(region, Camera, undefined) as Uniform<object> &
      Record<string, { set(...a: unknown[]): void }>;
    const time = cam.time;
    expect(region.count).toBe(1);
    cam.dispose();
    expect(region.count).toBe(0);
    expect(() => time.set(1)).toThrow(
      'Uniform<Camera> was disposed; its fields cannot be read or set. Make a new one with uniform(Camera).',
    );
    expect(() => cam.needsUpdate).toThrow(TypeError);
    cam.dispose();
    const key = (Symbol as { dispose?: symbol }).dispose;
    if (typeof key === 'symbol') {
      const other = makeUniform(region, Camera, undefined) as Record<symbol, () => void>;
      other[key]!();
      expect(region.count).toBe(0);
    }
  });
});

describe('a storage array (R9)', () => {
  it('zeros() and array() make a Buffer whose elements are set with at(i)', async () => {
    const { Particle } = (await load()) as { Particle: new () => { step(dt: number): number[] } };
    const region = new Region();
    const ps = makeBuffer(region, Particle, 3, undefined, 'zeros()') as Buffer<{
      pos: readonly [number, number, number];
      vel: readonly [number, number, number];
      life: number;
    }>;
    expect(ps.length).toBe(3);
    markClean(ps);
    ps.at(1).vel.set(1, 2, 3);
    // Element 1's vel: its stride is 32 bytes and vel is at 16.
    expect(dirtyRange(ps)).toMatchObject({ from: 48, to: 60 });
    ps.at(2).set({ life: 4 });
    expect(dirtyRange(ps)).toMatchObject({ from: 48, to: 96 });
    const read = await ps.read();
    expect(read).toHaveLength(3);
    expect(read[1]).toBeInstanceOf(Particle);
    expect(read[1]).toMatchObject({ pos: [0, 0, 0], vel: [1, 2, 3], life: 0 });
    expect((read[1] as unknown as { step(dt: number): number[] }).step(2)).toEqual([2, 4, 6]);
    expect(read[2]!.life).toBe(4);
    expect(() => ps.at(3)).toThrow(
      'Buffer<Particle>.at(): takes a whole number from 0 to 2, got 3.',
    );
    const data = makeBuffer(region, Particle, 2, [{ life: 1 }, { pos: [1, 1, 1] }], 'array()');
    expect(await (data as Buffer<{ life: number }>).read()).toMatchObject([
      { life: 1, pos: [0, 0, 0] },
      { life: 0, pos: [1, 1, 1] },
    ]);
  });

  it('the public functions use the one global region', async () => {
    const { Particle, Camera } = (await load()) as Record<string, new () => object>;
    const ps = zeros(Particle, 4);
    const cam = uniform(Camera);
    const given = array(Particle, [{}]);
    expect(rangeOf(ps).region).toBe(rangeOf(cam).region);
    expect(rangeOf(given).region).toBe(rangeOf(ps).region);
    for (const r of [ps, cam, given]) r.dispose();
  });
});

describe('the region (R17, Amendment A1)', () => {
  for (const resizable of [true, false])
    it(`keeps every accessor working across a growth${resizable ? '' : ' with no resizable buffer'}`, async () => {
      const { Particle } = (await load()) as { Particle: new () => object };
      const region = new Region(64, resizable);
      const a = makeBuffer(region, Particle, 1, undefined, 'zeros()') as Buffer<{
        life: number;
      }>;
      const life = a.at(0).life;
      life.set(3);
      const before = region.buffer;
      const big = makeBuffer(region, Particle, 1000, undefined, 'zeros()') as Buffer<{
        life: number;
      }>;
      expect(region.buffer.byteLength).toBeGreaterThanOrEqual(32 * 1001);
      if (!resizable) expect(region.buffer).not.toBe(before);
      expect(life.get()).toBe(3);
      life.set(5);
      expect((await a.read())[0]!.life).toBe(5);
      big.at(999).life.set(1);
      expect((await big.read())[999]!.life).toBe(1);
    });

  it('compacts freed ranges and remakes the views of the ranges it moved', async () => {
    const { Particle } = (await load()) as { Particle: new () => object };
    const region = new Region(128, false);
    const one = makeBuffer(region, Particle, 2, undefined, 'zeros()') as Buffer<{ life: number }>;
    const two = makeBuffer(region, Particle, 1, undefined, 'zeros()') as Buffer<{ life: number }>;
    const life = two.at(0).life;
    life.set(8);
    const at = rangeOf(two).range.offset;
    one.dispose();
    // 64 free bytes below, 32 free above: a range of 96 fits only after a compaction.
    makeBuffer(region, Particle, 3, undefined, 'zeros()');
    expect(rangeOf(two).range.offset).toBeLessThan(at);
    expect(life.get()).toBe(8);
    expect(region.buffer.byteLength).toBe(128);
  });

  it('gives a freed range to the next resource zeroed', () => {
    const region = new Region(64);
    const a = region.allocate(32);
    new Uint8Array(region.buffer, a.offset, 32).fill(7);
    region.free(a);
    const b = region.allocate(32);
    expect(b.offset).toBe(a.offset);
    expect([...new Uint8Array(region.buffer, b.offset, 32)].every((x) => x === 0)).toBe(true);
  });
});

describe('the deprecated forms (Amendment A1)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('array(value) is the Resident resident(value) was, and resident() warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = array(new Float32Array([1, 2]));
    expect(residentState(r)).toBeDefined();
    expect(residentState(array(4, 'u32'))).toBeDefined();
    expect(() => array('x' as never)).toThrow(/^array\(\): takes a host value/);
    resident(new Float32Array(1));
    resident(new Float32Array(1));
    expect(hasWarned('resident()')).toBe(true);
    const calls = warn.mock.calls.filter((c) => String(c[0]).includes('resident()'));
    expect(calls.length).toBeLessThanOrEqual(1);
  });

  it('configure() warns once and still configures', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    configure({});
    expect(hasWarned('configure()')).toBe(true);
  });
});

describe('texture() (Amendment A1; not exported until the proposal declares Device)', () => {
  it('makes its texture on the device in use, and refuses with none', async () => {
    expect(() => texture({ size: [2, 2], format: 'rgba8unorm' })).toThrow(
      'texture(): no device is in use. Open one with createDevice() and write `using _ = device.use()` before this call.',
    );
    const device = await createDevice({ prefer: ['cpu'] });
    const use = pushUse(device);
    const t = texture({ size: [2, 2], format: 'rgba8unorm' });
    expect(t.width).toBe(2);
    endUse(use);
    expect(() => texture({ size: [2, 2], format: 'rgba8unorm' })).toThrow(TypeError);
    await device.dispose();
  });
});

describe('a host program over the view types the resources', () => {
  it('infers Buffer<Particle> and Uniform<Camera> and checks each set', async () => {
    const f = face();
    const dir = mkdtempSync(join(tmpdir(), 'typeshade-resource-view-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'scene.shade.ts'), SOURCE);
    writeFileSync(join(dir, 'scene.shade.typeshade.ts'), f.view);
    const head = `import { zeros, uniform, array, type Buffer, type Uniform } from ${JSON.stringify(PUBLIC.replace(/\.ts$/, '.js'))};\nimport { Camera, Particle } from './scene.shade.ts';\n`;
    const lines = [
      'const ps: Buffer<Particle> = zeros(Particle, 8);',
      'ps.at(0).pos.set(0, 1, 2);',
      'ps.at(0).pos.set([0, 1, 2]);',
      'ps.at(0).pos.set(0, 1);',
      'const cam: Uniform<Camera> = uniform(Camera, { time: 1 });',
      'cam.view.set(new Float32Array(16));',
      'cam.set({ time: 2, count: 1 });',
      'cam.set({ speed: 2 });',
      'const v: Readonly<Float32Array> = cam.pos.get();',
      'const n: number = cam.time.get();',
      'const w: Readonly<Float32Array> = cam.weights.get();',
      'const all: Promise<Particle[]> = ps.read();',
      'const given: Buffer<Particle> = array(Particle, [{ life: 1 }]);',
      'cam.needsUpdate = true;',
    ];
    const app = join(dir, 'app.ts');
    writeFileSync(app, `${head}${lines.join('\n')}\nexport { v, n, w, all, given };\n`);
    const found = await tscDiagnostics([app], {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
      moduleSuffixes: ['.typeshade', ''],
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
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
      'const ps: Buffer<Particle> = zeros(Particle, 8);: ',
      'ps.at(0).pos.set(0, 1, 2);: ',
      'ps.at(0).pos.set([0, 1, 2]);: ',
      'ps.at(0).pos.set(0, 1);: TS2575',
      'const cam: Uniform<Camera> = uniform(Camera, { time: 1 });: ',
      'cam.view.set(new Float32Array(16));: ',
      'cam.set({ time: 2, count: 1 });: ',
      'cam.set({ speed: 2 });: TS2353',
      'const v: Readonly<Float32Array> = cam.pos.get();: ',
      'const n: number = cam.time.get();: ',
      'const w: Readonly<Float32Array> = cam.weights.get();: ',
      'const all: Promise<Particle[]> = ps.read();: ',
      'const given: Buffer<Particle> = array(Particle, [{ life: 1 }]);: ',
      'cam.needsUpdate = true;: ',
    ]);
  });
});
