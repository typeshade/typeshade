// Verifies: Rule 8.21 (docs/language-design.md; traced in reqs/).

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { hostFace } from './host-face.js';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { array } from '../../runtime.js';
import { tscDiagnostics } from '../../core/testing/tsc-diagnostics.js';
import { pack, packed, projectInputLayout } from '../../core/host-entry.js';
import { toShader } from '../../core/host-values.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function face(source: string, name = 'm') {
  const f = hostFace(source, { fileName: `/app/${name}.shade.ts`, runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f as Required<typeof f>;
}

async function load(source: string): Promise<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-class-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, face(source).code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
}

async function hostCodes(source: string, head: string, lines: readonly string[]) {
  const f = face(source, 'filters');
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-class-view-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'filters.shade.ts'), source);
  writeFileSync(join(dir, 'filters.shade.typeshade.ts'), f.view);
  const app = join(dir, 'app.ts');
  writeFileSync(app, `${head}${lines.join('\n')}\nexport {};\n`);
  const first = head.split('\n').length;
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
  return {
    elsewhere: found
      .filter((d) => d.fileName !== app)
      .map((d) => `${d.fileName?.slice(dir.length + 1)} TS${d.code}`),
    byLine: lines.map(
      (line, i) =>
        `${line}: ${found
          .filter((d) => d.fileName === app && d.line === first + i)
          .map((d) => `TS${d.code}`)
          .join(' ')}`,
    ),
  };
}

const COUNTERS = `"use typeshade";

/** Counts up from a start. */
export class Counter {
  /** The count so far. */
  #n: u32;
  /** The step of each tick. */
  step: u32 = 1;
  constructor(start: u32) {
    this.#n = start;
  }
  /** The count, read through the accessor. */
  get n(): u32 {
    return this.#n;
  }
  /** Counts once and returns the count. */
  tick(): u32 {
    this.#n = this.#n + this.step;
    return this.#n;
  }
}

/** The count of a counter, through its accessor. */
export function level(c: Counter): u32 {
  return c.n;
}

/** A counter that starts at \`start\`, built in the module. */
export function make(start: u32): Counter {
  return new Counter(start);
}

/** Ticks every counter of the bank once. */
export function run(out: array<u32>, counters: array<Counter>) {
  for (let i: u32 = 0; i < counters.length; i++) {
    out[i] = counters[i].tick();
  }
}

declare const bank: storage<array<Counter>, "read_write">;
declare const outs: storage<array<u32>, "read_write">;

@compute([64]) export function tickAll(gid: builtin<"global_invocation_id">) {
  if (gid.x >= bank.length) {
    return;
  }
  outs[gid.x] = bank[gid.x].tick();
}
`;

type Count = { n: number; step: number; tick(): number; '#n': number };

const NO_KEY =
  'the field is missing. "#n" is a private name, which an instance holds and a plain object does not. Build the value with new';

describe('a private name is the key "#n" of an instance (Rule 8.21, Amendment 2, D6, #971)', () => {
  it('is taken by both halves of the shader, the compiler and the editor (Rule 12.7)', () => {
    expect(compile(COUNTERS, { fileName: 'm.shade.ts' }).diagnostics).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', COUNTERS);
    expect(service.getDiagnostics('m.shade.ts')).toEqual([]);
    const run = face(COUNTERS).exports.find((e) => e.name === 'run');
    expect(run?.kind).toBe('kernel');
    if (run?.kind === 'kernel') expect(run.face.noGpu).toBeUndefined();
  });

  it('builds an instance with the field under the key "#n", and c.n is the accessor on the prototype', async () => {
    const m = await load(COUNTERS);
    const Counter = m.Counter as new (start: number) => Count;
    const c = new Counter(5);
    expect(c).toBeInstanceOf(Counter);
    expect(Object.keys(c)).toEqual(['#n', 'step']);
    expect(c['#n']).toBe(5);
    expect(Object.getOwnPropertyNames(c)).not.toContain('n');
    expect(Object.getOwnPropertyDescriptor(Counter.prototype, 'n')?.get).toBeTypeOf('function');
    expect(c.n).toBe(5);
    expect({ ...c }).toEqual({ '#n': 5, step: 1 });
    expect(JSON.stringify(c)).toBe('{"#n":5,"step":1}');
  });

  it('a method that changes the field writes the key back in place, and the accessor follows', async () => {
    const m = await load(COUNTERS);
    const Counter = m.Counter as new (start: number) => Count;
    const c = new Counter(5);
    expect(c.tick()).toBe(6);
    expect(c['#n']).toBe(6);
    expect(c.n).toBe(6);
    expect(Object.keys(c)).toEqual(['#n', 'step']);
    c.step = 3;
    expect(c.tick()).toBe(9);
    expect(c.n).toBe(9);
  });

  it('a helper reads the field from the key, and a result is an instance that holds it under the key (D1)', async () => {
    const m = await load(COUNTERS);
    const Counter = m.Counter as new (start: number) => Count;
    const level = m.level as (c: object) => number;
    const make = m.make as (start: number) => Count;
    expect(level(new Counter(5))).toBe(5);
    const made = make(7);
    expect(made).toBeInstanceOf(Counter);
    expect(Object.keys(made)).toEqual(['#n', 'step']);
    expect(made['#n']).toBe(7);
    expect(made.n).toBe(7);
    expect(made.tick()).toBe(8);
    expect(level(made)).toBe(8);
  });

  it('refuses a plain object of the struct with the reason, in a helper', async () => {
    const m = await load(COUNTERS);
    const level = m.level as (c: object) => number;
    expect(() => level({ n: 5, step: 1 })).toThrow(
      new TypeError(`level(): parameter "c" (Counter): at .#n, ${NO_KEY}.`),
    );
    expect(() => level({ step: 1 })).toThrow(
      new TypeError(`level(): parameter "c" (Counter): at .#n, ${NO_KEY}.`),
    );
  });

  it('a kernel function takes instances in its array and writes the key back in place', async () => {
    const m = await load(COUNTERS);
    const Counter = m.Counter as new (start: number) => Count;
    const run = m.run as (out: Uint32Array, counters: unknown) => Promise<void>;
    const counters = [10, 20, 30].map((s) => new Counter(s));
    const kept = [...counters];
    const out = new Uint32Array(3);
    await run(out, counters);
    expect([...out]).toEqual([11, 21, 31]);
    counters.forEach((c, i) => {
      expect(c).toBe(kept[i]);
      expect(c).toBeInstanceOf(Counter);
      expect(Object.keys(c)).toEqual(['#n', 'step']);
      expect(c['#n']).toBe(11 + 10 * i);
      expect(c.n).toBe(11 + 10 * i);
    });
    await run(out, counters);
    expect([...out]).toEqual([12, 22, 32]);
  });

  it('a kernel function refuses a plain object in its array with the reason', async () => {
    const m = await load(COUNTERS);
    const run = m.run as (out: Uint32Array, counters: unknown) => Promise<void>;
    await expect(run(new Uint32Array(1), [{ n: 1, step: 1 }])).rejects.toThrow(
      new TypeError(`run(): parameter "counters" (array<Counter>): at [0].#n, ${NO_KEY}.`),
    );
  });

  it('an entry takes instances in its bindings and writes the key back in place', async () => {
    const m = await load(COUNTERS);
    const Counter = m.Counter as new (start: number) => Count;
    const tickAll = m.tickAll as (b: unknown, w: unknown) => Promise<void>;
    const bank = [new Counter(1), new Counter(2)];
    const kept = [...bank];
    const outs = new Uint32Array(2);
    await tickAll({ bank, outs }, 1);
    expect([...outs]).toEqual([2, 3]);
    bank.forEach((c, i) => {
      expect(c).toBe(kept[i]);
      expect(c).toBeInstanceOf(Counter);
      expect(Object.keys(c)).toEqual(['#n', 'step']);
      expect(c['#n']).toBe(2 + i);
      expect(c.n).toBe(2 + i);
    });
  });

  it('an entry refuses a plain object in its binding with the reason', async () => {
    const m = await load(COUNTERS);
    const tickAll = m.tickAll as (b: unknown, w: unknown) => Promise<void>;
    await expect(
      tickAll({ bank: [{ n: 1, step: 1 }], outs: new Uint32Array(1) }, 1),
    ).rejects.toThrow(
      new TypeError(`tickAll(): binding "bank" (array<Counter>): at [0].#n, ${NO_KEY}.`),
    );
  });

  it('a Resident of instances keeps the key through a kernel call and read()', async () => {
    const m = await load(COUNTERS);
    const Counter = m.Counter as new (start: number) => Count;
    const run = m.run as (out: Uint32Array, counters: unknown) => Promise<void>;
    const given = [1, 2].map((s) => new Counter(s));
    const bank = array(Counter, given);
    await run(new Uint32Array(2), bank);
    const back = await bank.read();
    back.forEach((c, i) => {
      expect(c).toBeInstanceOf(Counter);
      expect(c).not.toBe(given[i]);
      expect(Object.keys(c)).toEqual(['#n', 'step']);
      expect(c['#n']).toBe(2 + i);
      expect(c.n).toBe(2 + i);
    });
    expect(back[0]!.tick()).toBe(3);
    expect(given.map((c) => c['#n'])).toEqual([1, 2]);
    bank.set([new Counter(40)]);
    const again = await bank.read();
    expect(again[0]).toBeInstanceOf(Counter);
    expect(again[0]!['#n']).toBe(40);
    expect(again[0]!.n).toBe(40);
  });

  it('is type-checked by tsc: the accessor reads, the field has no name, a plain object is no Counter', async () => {
    const head = [
      "import { Counter, level, make, run } from './filters.shade.ts';",
      'const c: Counter = new Counter(1);',
      'const out = new Uint32Array(2);',
      '',
    ].join('\n');
    const { elsewhere, byLine } = await hostCodes(COUNTERS, head, [
      'const a: number = c.n + c.tick() + level(c) + make(2).n;',
      'await run(out, [c, new Counter(2)]);',
      'const hidden = c.#n;',
      'level({ n: 1, step: 1 });',
      'await run(out, [{ n: 1, step: 1 }]);',
      'console.log(a, hidden);',
    ]);
    expect(elsewhere).toEqual([]);
    expect(byLine).toEqual([
      'const a: number = c.n + c.tick() + level(c) + make(2).n;: ',
      'await run(out, [c, new Counter(2)]);: ',
      'const hidden = c.#n;: TS18013',
      'level({ n: 1, step: 1 });: TS2345',
      'await run(out, [{ n: 1, step: 1 }]);: TS2769',
      'console.log(a, hidden);: ',
    ]);
  });

  const CELLS = `"use typeshade";

export class Cell {
  #hp: u32;
  armor: u32 = 3;
  unused: u32 = 9;
  constructor(hp: u32) {
    this.#hp = hp;
  }
  get hp(): u32 {
    return this.#hp;
  }
}

export function hits(out: array<u32>, cells: array<Cell>) {
  for (let i: u32 = 0; i < cells.length; i++) {
    out[i] = cells[i].hp + cells[i].armor;
  }
}
`;

  it('uploads a private field a kernel function reads with the live fields, by the projection of change 0082', async () => {
    const kernel = face(CELLS).exports.find((e) => e.name === 'hits');
    expect(kernel?.kind).toBe('kernel');
    if (kernel?.kind !== 'kernel') return;
    const param = kernel.face.params.find((p) => p.name === 'cells');
    const projected = kernel.face.gpu?.projected?.arrays.find((a) => a.name === 'cells');
    expect(projected).toBeDefined();
    if (param?.k !== 'array' || projected === undefined) return;
    expect(JSON.stringify(param.layout)).toContain('"#hp"');
    projectInputLayout(param.layout, projected.layout);
    const m = await load(CELLS);
    const Cell = m.Cell as new (hp: number) => object;
    const words = new Uint32Array(packed(projected, [new Cell(7), new Cell(8)]));
    expect([...words]).toEqual([7, 3, 8, 3]);
  });

  it('packs a struct a kernel function takes by value from the CPU tier value, which names the field as the module does', async () => {
    const source = `"use typeshade";

export class Gain {
  #g: f32 = 1.;
  get g(): f32 {
    return this.#g;
  }
  k: f32 = 2.;
}

export function scale(out: array<f32>, xs: array<f32>, gain: Gain) {
  for (let i: u32 = 0; i < xs.length; i++) {
    out[i] = xs[i] * gain.g * gain.k;
  }
}
`;
    const kernel = face(source).exports.find((e) => e.name === 'scale');
    expect(kernel?.kind).toBe('kernel');
    if (kernel?.kind !== 'kernel') return;
    const param = kernel.face.params.find((p) => p.name === 'gain');
    const args = kernel.face.gpu?.args.layout;
    expect(args).toBeDefined();
    if (param?.k !== 'value' || args === undefined) return;
    const m = await load(source);
    const Gain = m.Gain as new () => object;
    const converted = toShader('scale', 'gain', param.type, new Gain());
    expect(converted).toEqual({ g: 1, k: 2 });
    const dv = new DataView(new ArrayBuffer(args.k === 'o' ? args.sz : 0));
    pack(dv, 0, args, { gain: converted, _start: 0, _n: 3, _in: 0, _out: 0 }, '');
    expect([dv.getFloat32(0, true), dv.getFloat32(4, true), dv.getUint32(20, true)]).toEqual([
      1, 2, 3,
    ]);
  });
});
