import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from '../compiler/ts/host-face.js';
import { Region } from './region.js';
import {
  dirtyRange,
  dirtyRanges,
  LAYOUT_KEY,
  makeBuffer,
  makeUniform,
  markClean,
  rangeOf,
  uniform,
  zeros,
} from './resource.js';

const RUNTIME = resolve(__dirname, '../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SOURCE = `"use typeshade";

export class Cell {
  a: f32 = 0.;
}

export class Wide {
  pos: vec3 = vec3(0.);
  lanes: array<vec3, 2> = [vec3(0.), vec3(0.)];
  scalars: array<f32, 3> = [0., 0., 0.];
  mats: array<mat4x4, 2> = [mat4x4(), mat4x4()];
  cells: array<Cell, 2> = [new Cell(), new Cell()];
}

export class Precise {
  d: f64 = f64(0.);
  dv: vec3<f64> = vec3<f64>(f64(0.), f64(0.), f64(0.));
}

export class Pt {
  pos: vec3 = vec3(0.);
}

export class Disposer {
  dispose: f32 = 0.;
}

export class Stale {
  needsUpdate: f32 = 0.;
}

export class Keeper {
  dispose: f32 = 0.;
  needsUpdate: f32 = 0.;
}

export class Low {
  set: f32 = 0.;
}

export class Mid {
  low: Low = new Low();
}

export class Top {
  mid: Mid = new Mid();
}
`;

type Scene = Record<string, new () => object>;
let loaded: Scene | undefined;
async function load(): Promise<Scene> {
  if (loaded !== undefined) return loaded;
  const f = hostFace(SOURCE, { fileName: '/app/scene.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-resource-invariants-'));
  dirs.push(dir);
  const file = join(dir, 'scene.shade.mjs');
  writeFileSync(file, f.code!);
  loaded = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Scene;
  return loaded;
}

interface Field {
  set(...args: unknown[]): void;
  get(): unknown;
  at(index: number): Field;
  readonly length: number;
  readonly dispose: Field;
  readonly needsUpdate: Field;
  readonly mid: Field;
  readonly low: Field;
}
type Any = Record<string, Field> & {
  at(index: number): Field;
  dispose(): void;
  read(): Promise<unknown[]>;
};
type Disposable = { [Symbol.dispose](): void };

describe('an accessor makes its typed view once', () => {
  it('returns the same view until the region moves a range, then a view of the new place', async () => {
    const m = await load();
    const region = new Region(128, false);
    const spacer = makeBuffer(region, m.Cell, 16, undefined, 'zeros()') as Any;
    const wide = makeUniform(region, m.Pt, undefined) as Any;
    wide.pos.set(1, 2, 3);
    const first = wide.pos.get() as Float32Array;
    expect(wide.pos.get()).toBe(first);
    const at = rangeOf(wide).range.offset;
    spacer.dispose();
    makeBuffer(region, m.Cell, 24, undefined, 'zeros()');
    expect(rangeOf(wide).range.offset).not.toBe(at);
    const second = wide.pos.get() as Float32Array;
    expect(second).not.toBe(first);
    expect([...second]).toEqual([1, 2, 3]);
    expect(wide.pos.get()).toBe(second);
  });
});

describe('the accessor of an array field', () => {
  it('reads an array of scalars or vectors through one view, at each stride', async () => {
    const m = await load();
    const wide = makeUniform(new Region(), m.Wide, undefined) as Any;
    wide.scalars.set([1, 2, 3]);
    expect([...(wide.scalars.get() as Float32Array)].filter((_, i) => i % 4 === 0)).toEqual([
      1, 2, 3,
    ]);
    wide.lanes.at(1).set(4, 5, 6);
    const view = wide.lanes.get() as Float32Array;
    expect(view).toBeInstanceOf(Float32Array);
    expect([...view.subarray(4, 7)]).toEqual([4, 5, 6]);
  });

  it.each(['mats', 'cells'])('refuses one view of the array of %s', async (field) => {
    const m = await load();
    const wide = makeUniform(new Region(), m.Wide, undefined) as Any;
    expect(() => wide[field].get()).toThrow(
      new TypeError(
        `Uniform<Wide>.${field}.get(): this array has no one view; read each element with at(i).get().`,
      ),
    );
  });

  it('refuses an index outside the array with a RangeError, and a value of another length', async () => {
    const m = await load();
    const wide = makeUniform(new Region(), m.Wide, undefined) as Any;
    expect(() => wide.lanes.at(2)).toThrow(RangeError);
    expect(() => wide.lanes.at(-1)).toThrow(RangeError);
    expect(() => wide.scalars.set([1, 2])).toThrow(TypeError);
    expect(wide.lanes.length).toBe(2);
  });
});

describe('the names a field cannot take at runtime', () => {
  const uniformMake = uniform as (cls: unknown) => unknown;
  const storageMake = zeros as (cls: unknown, n: number) => unknown;

  it('refuses dispose and needsUpdate on a uniform, and neither on a storage struct', async () => {
    const m = await load();
    expect(() => uniformMake(m.Disposer)).toThrow(TypeError);
    expect(() => uniformMake(m.Stale)).toThrow(TypeError);
    const keepers = storageMake(m.Keeper, 1) as Any;
    keepers.at(0).dispose.set(2);
    keepers.at(0).needsUpdate.set(3);
    expect(keepers.at(0).dispose.get()).toBe(2);
    expect(keepers.at(0).needsUpdate.get()).toBe(3);
  });

  it('refuses set on a struct nested at any depth, where the field is first reached', async () => {
    const m = await load();
    const top = uniformMake(m.Top) as Any;
    expect(() => top.mid.low).toThrow(TypeError);
    expect(() => top.mid.low.set).toThrow(TypeError);
  });

  it('refuses a field named constructor', () => {
    class Synthetic {}
    const scalar = { k: 's', t: 'f32' };
    const struct = { k: 'o', sz: 4, f: [['constructor', 0, scalar]] };
    (Synthetic as unknown as Record<symbol, unknown>)[LAYOUT_KEY] = {
      u: struct,
      s: { k: 'a', st: 4, n: null, e: struct },
    };
    expect(() => uniformMake(Synthetic)).toThrow(/accessor's own property/);
    expect(() => storageMake(Synthetic, 1)).toThrow(/accessor's own property/);
  });
});

describe('a value that is no class of a shader module', () => {
  const make = uniform as (cls: unknown) => unknown;

  it('refuses a value, an anonymous function and an unmarked class, with the reason', async () => {
    expect(() => make(3)).toThrow(/takes a class a shader module exports/);
    expect(() => make(() => 1)).toThrow(/the function \(anonymous\), which no shader module made/);
    class Plain {}
    expect(() => make(Plain)).toThrow(/the function Plain, which no shader module made/);
  });

  it('refuses an abstract class, and says which class to pass', () => {
    class Base {}
    (Base as unknown as Record<symbol, unknown>)[LAYOUT_KEY] = { a: 1 };
    expect(() => make(Base)).toThrow(
      'uniform(): Base is abstract, so it has no layout of its own; pass a class that extends it.',
    );
    expect(() => zeros(Base as never, 1)).toThrow(/Base is abstract/);
  });

  it('names the class when it has no layout the host can write', async () => {
    class Synthetic {}
    (Synthetic as unknown as Record<symbol, unknown>)[LAYOUT_KEY] = {
      un: 'a reason',
      sn: 'another reason',
    };
    expect(() => make(Synthetic)).toThrow(
      'uniform(): Synthetic has no uniform layout a host can write: a reason.',
    );
    expect(() => zeros(Synthetic as never, 1)).toThrow(
      'zeros(): Synthetic has no storage layout a host can write: another reason.',
    );
  });
});

describe('the dirty-range reads of a value that is no resource', () => {
  it('throw a TypeError, and for a disposed resource too', async () => {
    const m = await load();
    expect(() => dirtyRange({})).toThrow('dirtyRange(): takes a Uniform or a Buffer.');
    expect(() => dirtyRanges({})).toThrow('dirtyRanges(): takes a Uniform or a Buffer.');
    expect(() => rangeOf({})).toThrow('rangeOf(): takes a Uniform or a Buffer.');
    expect(() => markClean({})).not.toThrow();
    const buffer = makeBuffer(new Region(), m.Cell, 1, undefined, 'zeros()') as Any;
    expect(dirtyRanges(buffer)).toEqual([[0, 16]]);
    markClean(buffer);
    expect(dirtyRanges(buffer)).toEqual([]);
    buffer.dispose();
    expect(() => dirtyRange(buffer)).toThrow(TypeError);
    expect(() => dirtyRanges(buffer)).toThrow(TypeError);
  });
});

describe('an f64 field', () => {
  it('joins its two f32 halves into one number, and a vector of them into a Float64Array', async () => {
    const m = await load();
    const region = new Region();
    const precise = makeUniform(region, m.Precise, undefined) as Any;
    const x = 1 + 2 ** -40;
    precise.d.set(x);
    expect(Math.fround(x)).not.toBe(x);
    expect(precise.d.get()).toBe(x);
    precise.dv.set(x, 2, 3);
    const joined = precise.dv.get() as Float64Array;
    expect(joined).toBeInstanceOf(Float64Array);
    expect([...joined]).toEqual([x, 2, 3]);
  });

  it('marks its bytes dirty only when a half changed', async () => {
    const m = await load();
    const precise = makeUniform(new Region(), m.Precise, undefined) as Any;
    precise.d.set(0.1);
    markClean(precise);
    precise.d.set(0.1);
    expect(dirtyRange(precise)).toBeUndefined();
    precise.d.set(0.1 + 2 ** -40);
    expect(dirtyRange(precise)).toBeDefined();
  });
});

describe('a resource under using', () => {
  it('frees its range through Symbol.dispose, as dispose() does', async () => {
    const m = await load();
    const region = new Region();
    const wide = makeUniform(region, m.Cell, undefined) as Any;
    const buffer = makeBuffer(region, m.Cell, 1, undefined, 'zeros()') as Any;
    expect(typeof (wide as unknown as Disposable)[Symbol.dispose]).toBe('function');
    (wide as unknown as Disposable)[Symbol.dispose]();
    (buffer as unknown as Disposable)[Symbol.dispose]();
    expect(() => wide.a.get()).toThrow(TypeError);
    expect(() => buffer.at(0)).toThrow(TypeError);
  });
});
