// Verifies: Rule 8.20 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.21 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 11.8 (docs/language-design.md; traced in reqs/).
//
// An exported class of a shader module is a value of its host face (change 0109). The view
// declares it as a class, and the generated module exports a JavaScript class of its name, whose
// constructor, methods, accessors and static functions run on the CPU tier. Each part is read by
// both of its readers: `tsc` reads the view in a host program resolved the way the documented
// `tsconfig` resolves it, and the program imports the generated module and runs it. The shader
// source itself is read by both halves, `compile()` and the language service. A `Resident` made
// from instances reads back as instances (Amendment 1, decision D5): its copy keeps the class of
// each object, through a kernel call that writes it.

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { hostFace, type HostExport } from './host-face.js';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { tscDiagnostics } from '../../core/testing/tsc-diagnostics.js';
import type { KernelFace } from '../../core/host-kernel.js';
import { residentState } from '../../core/resident.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** The face of `source` as `name.shade.ts`, which must compile. */
function face(source: string, name = 'm') {
  const f = hostFace(source, { fileName: `/app/${name}.shade.ts`, runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f as Required<typeof f>;
}

/** Write the generated module to disk and import it, as the bundler would. */
async function load(source: string): Promise<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-class-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, face(source).code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
}

/** The TypeScript codes `tsc` gives each line of `lines`, a host program over the view of
 *  `source`, resolved through `moduleSuffixes` under a strict host `tsconfig`; any diagnostic in
 *  another file than the program, the view among them, is returned under that file's name. */
async function hostCodes(source: string, head: string, lines: readonly string[]) {
  const f = face(source, 'filters');
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-class-view-'));
  dirs.push(dir);
  // The source beside its view, so the check proves the view wins over it.
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

const kindOf = (exports: readonly HostExport[], name: string): string | undefined => {
  const e = exports.find((x) => x.name === name);
  return e === undefined ? undefined : e.kind === 'never' ? `never: ${e.reason}` : e.kind;
};

const f = Math.fround;

/** The proposal's listing (surface §64): a filter as a class, and a kernel function over a bank
 *  of them; with an accessor, a static function, a field that holds a function, a method that
 *  only reads its object and one that returns it. */
const FILTERS = `"use typeshade";

/** A one-pole lowpass with its state. */
export class OnePole {
  z: f32 = 0.;
  k: f32;
  constructor(k: f32) {
    this.k = k;
  }
  /** One sample through the filter. */
  tick(x: f32): f32 {
    this.z = this.z + this.k * (x - this.z);
    return this.z;
  }
  peek(x: f32): f32 {
    return this.z + this.k * (x - this.z);
  }
  setK(k: f32): OnePole {
    this.k = k;
    return this;
  }
  get gain(): f32 {
    return this.k * 2.;
  }
  set gain(g: f32) {
    this.k = g / 2.;
  }
  static unit(): OnePole {
    return new OnePole(1.);
  }
  onHit = (d: f32): f32 => d * this.k;
}

/** Runs every filter of the bank over its block, one lane per filter. */
export function run(out: array<f32>, xs: array<f32>, filters: array<OnePole>, block: u32) {
  for (let i: u32 = 0; i < filters.length; i++) {
    for (let n: u32 = 0; n < block; n++) {
      out[i * block + n] = filters[i].tick(xs[i * block + n]);
    }
  }
}

export function level(p: OnePole): f32 {
  return p.z + p.k;
}

export function pair(k: f32): array<OnePole, 2> {
  return array(new OnePole(k), new OnePole(k * 2.));
}
`;

/** What `tick` computes in f32, as the GPU rounds each operation. */
const tick = (s: { z: number; k: number }, x: number): number =>
  (s.z = f(s.z + f(s.k * f(x - s.z))));

describe('the class in the view (Rule 8.20)', () => {
  it('compiles with no diagnostic, and the editor gives none', () => {
    for (const [name, source] of Object.entries({ FILTERS, PROBE, BANK, SHAPES, VOICES })) {
      expect([name, compile(source, { fileName: 'm.shade.ts' }).diagnostics]).toEqual([name, []]);
      const service = createTypeshadeLanguageService();
      service.openDocument('m.shade.ts', source);
      expect([name, service.getDiagnostics('m.shade.ts')]).toEqual([name, []]);
    }
  });

  it('declares an exported class as a class, each member in its host type', () => {
    const v = face(FILTERS).view;
    expect(v).toContain(
      [
        'export declare class OnePole {',
        '  constructor(k: f32);',
        '  z: f32;',
        '  k: f32;',
        // The comment of a method stands on its line (change 0108, item 4).
        '  /** One sample through the filter. */',
        '  tick(x: f32): f32;',
        '  peek(x: f32): f32;',
        '  setK(k: f32): OnePole;',
        '  get gain(): f32;',
        '  set gain(g: f32);',
        '  static unit(): OnePole;',
        '  onHit(d: f32): f32;',
        '}',
      ].join('\n'),
    );
    // A struct goes by the class's name as a result and as a parameter (change 0116, decision D7),
    // each in the host type family's names; the call still takes a plain object of the fields
    // (Rule 8.21), which the host program below type-checks as a refusal.
    expect(v).toContain('export declare function pair(k: f32): array<OnePole, 2>;');
    expect(v).toContain('export declare function level(p: OnePole): f32;');
    expect(v).toContain(
      'export declare function run(out: array<f32>, xs: array<f32>, filters: array<OnePole>, block: u32): Promise<void>;',
    );
    expect(v).toContain(
      'export declare function run(out: Resident<Float32Array>, xs: array<f32>, filters: Resident<OnePole[]>, block: u32): void;',
    );
    expect(v).toContain('import type { f32, u32, array } from');
    // `exports` reports the class as the struct it is: `hostFace` keeps the shape of its result.
    expect(kindOf(face(FILTERS).exports, 'OnePole')).toBe('struct');
  });

  it("records that the kernel's loop over the instances lowers (§65), with no TS8070", () => {
    const g = face(FILTERS);
    const run = g.exports.find((e) => e.name === 'run');
    expect(run?.kind).toBe('kernel');
    expect((run as { face: KernelFace }).face.gpu?.loops.length).toBe(1);
    expect(g.diagnostics.map((d) => d.code)).not.toContain('TS8070');
  });
});

describe('new, on the CPU tier (Rule 8.21)', () => {
  it('runs the constructor, the field initializers included, and the fields are the own properties', async () => {
    const m = await load(FILTERS);
    const OnePole = m.OnePole as new (k: number) => Record<string, unknown>;
    const p = new OnePole(0.1);
    expect(p).toBeInstanceOf(OnePole);
    expect(OnePole.name).toBe('OnePole');
    expect(Object.keys(p)).toEqual(['z', 'k']);
    expect({ ...p }).toEqual({ z: 0, k: f(0.1) });
    expect(JSON.stringify(p)).toBe(JSON.stringify({ z: 0, k: f(0.1) }));
    // The constructor is the oracle's own function at f32 (Rule 11.7).
    const oracle = compileModule(compile(FILTERS).module, { precision: 'f32' });
    expect({ ...p }).toEqual(oracle.fns.OnePole_new!(f(0.1) as never));
  });

  it('builds a class with no constructor from its initializers, and a field with neither at its zero', async () => {
    const m = await load(`"use typeshade";
export class Init { a: f32 = 1.5; b: vec2 = vec2(2., 3.); c: u32; flag: bool; }
export class Bare { a: f32; b: vec3; c: i32; d: bool; e: mat2x2; }
`);
    const Init = m.Init as new () => object;
    const Bare = m.Bare as new () => object;
    expect({ ...new Init() }).toEqual({ a: 1.5, b: [2, 3], c: 0, flag: false });
    expect({ ...new Bare() }).toEqual({ a: 0, b: [0, 0, 0], c: 0, d: false, e: [0, 0, 0, 0] });
    // Two instances share no field.
    const [x, y] = [new Bare(), new Bare()] as { b: number[] }[];
    x!.b[0] = 9;
    expect(y!.b).toEqual([0, 0, 0]);
    expect(() => new (Bare as new (n: number) => object)(1)).toThrow(
      new TypeError('new Bare() takes 0 arguments; got 1.'),
    );
  });

  it('refuses an argument that does not fit with a TypeError naming the constructor', async () => {
    const m = await load(FILTERS);
    const OnePole = m.OnePole as new (...a: unknown[]) => object;
    expect(() => new OnePole('a')).toThrow(
      new TypeError('new OnePole(): parameter "k" (f32): got the string "a".'),
    );
    expect(() => new OnePole()).toThrow(new TypeError('new OnePole() takes 1 argument; got 0.'));
  });
});

type Filter = {
  z: number;
  k: number;
  gain: number;
  tick(x: number): number;
  peek(x: number): number;
  setK(k: number): Filter;
  onHit(d: number): number;
};

describe('members, on the CPU tier (Rule 8.21)', () => {
  it('a method that changes its object writes the instance back in place', async () => {
    const m = await load(FILTERS);
    const p = new (m.OnePole as new (k: number) => Filter)(0.1);
    const want = { z: 0, k: f(0.1) };
    expect(p.tick(1)).toBe(tick(want, 1));
    expect(p.z).toBe(want.z);
    expect(p.tick(0.25)).toBe(tick(want, 0.25));
    expect({ ...p }).toEqual(want);
    // A wrong field is refused as the method's object, by name.
    (p as { k: unknown }).k = 'bad';
    expect(() => p.tick(1)).toThrow(
      new TypeError('OnePole.tick(): parameter "this" (OnePole): at .k, got the string "bad".'),
    );
  });

  it('a method that only reads its object leaves the instance as it was', async () => {
    const m = await load(FILTERS);
    const p = new (m.OnePole as new (k: number) => Filter)(0.5);
    p.k = 0.1; // not an f32: the call rounds its copy, and writes nothing back
    expect(p.peek(1)).toBe(f(0 + f(f(0.1) * f(1 - 0))));
    expect(p.k).toBe(0.1);
  });

  it('a method that returns this returns the instance itself', async () => {
    const m = await load(FILTERS);
    const p = new (m.OnePole as new (k: number) => Filter)(0.1);
    expect(p.setK(0.5)).toBe(p);
    expect(p.k).toBe(0.5);
    expect(p.setK(0.25).tick(1)).toBe(0.25);
    expect(p.z).toBe(0.25);
  });

  it('a getter and a setter are an accessor property of the class', async () => {
    const m = await load(FILTERS);
    const OnePole = m.OnePole as new (k: number) => Filter;
    const p = new OnePole(0.1);
    expect(p.gain).toBe(f(f(0.1) * 2));
    p.gain = 0.5;
    expect(p.k).toBe(0.25);
    expect(p.gain).toBe(0.5);
    const d = Object.getOwnPropertyDescriptor(OnePole.prototype, 'gain');
    expect(typeof d?.get).toBe('function');
    expect(typeof d?.set).toBe('function');
    expect(Object.keys(p)).toEqual(['z', 'k']);
  });

  it('a static function is a static method, and the struct it returns an instance (D1)', async () => {
    const m = await load(FILTERS);
    const OnePole = m.OnePole as (new (k: number) => Filter) & { unit(): Filter };
    const u = OnePole.unit();
    expect(u).toBeInstanceOf(OnePole);
    expect({ ...u }).toEqual({ z: 0, k: 1 });
    expect(u.tick(2)).toBe(2);
  });

  it("a field that holds a function is a method under the field's name", async () => {
    const m = await load(FILTERS);
    const OnePole = m.OnePole as new (k: number) => Filter;
    const p = new OnePole(0.1);
    expect(p.onHit(4)).toBe(f(4 * f(0.1)));
    expect(typeof Object.getOwnPropertyDescriptor(OnePole.prototype, 'onHit')?.value).toBe(
      'function',
    );
    expect(Object.keys(p)).not.toContain('onHit');
  });
});

/** A class with members a host cannot call (decision D3), a constructor among them. */
const PROBE = `"use typeshade";
class Frame {
  light!: vec4;
}
declare const frame: uniform<Frame>;

export class Probe {
  k: f32 = 1.;
  scaled(x: f32): f32 {
    return x * this.k;
  }
  lit(x: f32): f32 {
    return x * frame.light.x;
  }
  apply(g: (x: f32) => f32): f32 {
    return g(this.k);
  }
  static bright(): f32 {
    return frame.light.y;
  }
}

export class Lit {
  k!: f32;
  constructor() {
    this.k = frame.light.x;
  }
}

export function twice(): f32 {
  const p = new Probe();
  return p.apply((x) => x * 2.);
}

export function lit(k: f32): Lit {
  return { k: k };
}

export const fs = fragment(function fs(pos: builtin<"position", vec4>): vec4 {
  const l = new Lit();
  return vec4(l.k, Probe.bright(), 0., 1.);
});
`;

describe('a member a host cannot call (Rule 8.20, D3)', () => {
  it('declares it never with the reason, and the class stays a value', async () => {
    const v = face(PROBE).view;
    const binding =
      'it reaches a resource binding, which a helper call passes none of; call the entry that uses it (Rule 8.24)';
    expect(v).toContain(
      [
        'export declare class Probe {',
        '  constructor();',
        '  k: f32;',
        '  scaled(x: f32): f32;',
        `  /** Not callable from host code (Rule 8.20): ${binding}. */`,
        '  lit: never;',
        '  /** Not callable from host code (Rule 8.20): it takes a function, and such a function exists only as the copies the module uses; no proposal adds it yet. */',
        '  apply: never;',
        `  /** Not callable from host code (Rule 8.20): ${binding}. */`,
        '  static bright: never;',
        '}',
      ].join('\n'),
    );
    // A constructor a host cannot call: `new` is a type error, and the class is still a value.
    expect(v).toContain(
      [
        'export declare class Lit {',
        `  /** Not callable from host code (Rule 8.20): ${binding}. */`,
        '  protected constructor();',
        '  k: f32;',
        '}',
      ].join('\n'),
    );
    const m = await load(PROBE);
    const Probe = m.Probe as (new () => Record<string, (x?: unknown) => unknown>) & {
      bright(): unknown;
    };
    const p = new Probe();
    expect(p.scaled!(2)).toBe(2);
    expect(() => p.lit!(1)).toThrow(
      new TypeError(`Probe.lit cannot be called from host code: ${binding}`),
    );
    expect(() => p.apply!(1)).toThrow(
      /^Probe\.apply cannot be called from host code: it takes a function/,
    );
    expect(() => Probe.bright()).toThrow(
      `Probe.bright cannot be called from host code: ${binding}`,
    );
    const Lit = m.Lit as new () => object;
    expect(() => new Lit()).toThrow(`new Lit cannot be called from host code: ${binding}`);
    // A result is an instance all the same, built without the constructor (D1).
    const l = (m.lit as (k: number) => object)(2);
    expect(l).toBeInstanceOf(Lit);
    expect({ ...l }).toEqual({ k: 2 });
  });

  it('keeps a generic class never, with the reason it had', async () => {
    const source = `"use typeshade";
export class Pair<T> { a: T; b: T; }
export function sum(x: f32): f32 { const p = new Pair<f32>(); p.a = x; p.b = x; return p.a + p.b; }
`;
    const g = face(source);
    expect(kindOf(g.exports, 'Pair')).toBe(
      'never: it is generic, and its struct exists only as the instances the module uses',
    );
    expect(g.view).toContain(
      '/** Not callable from host code (Rule 8.20): it is generic, and its struct exists only as the instances the module uses. */\nexport declare const Pair: never;',
    );
    const m = await load(source);
    expect(() => (m.Pair as () => unknown)()).toThrow('Pair cannot be called from host code');
  });

  it('keeps a class with a field that has no host value a type, with the reason (D4)', async () => {
    const source = `"use typeshade";
export class Reading { a: f32 = 0.; w: f32 | undefined = undefined; }
export function first(x: f32): f32 { const r = new Reading(); r.w = x; return r.w ?? r.a; }
`;
    const g = face(source);
    const why =
      'field Reading.w: an optional value, f32 | undefined, has no host value yet (Rule 8.21)';
    expect(g.exports.find((e) => e.name === 'Reading')).toEqual({
      kind: 'never',
      name: 'Reading',
      reason: why,
      typeOnly: true,
    });
    expect(g.view).toContain(
      `/** A type with no host value (Rule 8.21): ${why}. */\nexport interface Reading { a: f32; w: never }`,
    );
    // A type and no value: the module binds nothing under its name.
    expect(g.code).not.toMatch(/ as Reading\b/);
    const m = await load(source);
    expect(m.Reading).toBeUndefined();
    expect((m.first as (x: number) => number)(2)).toBe(2);
  });
});

/** An entry that reaches a bank of filters, and a uniform one. */
const BANK = `"use typeshade";
export class OnePole {
  z: f32 = 0.;
  k!: f32;
  constructor(k: f32) {
    this.k = k;
  }
  tick(x: f32): f32 {
    this.z = this.z + this.k * (x - this.z);
    return this.z;
  }
}

declare const cfg: uniform<OnePole>;
declare const bank: storage<array<OnePole>, "read_write">;
declare const outs: storage<array<f32>, "read_write">;

export const tickAll = compute([64], function tickAll(gid: builtin<"global_invocation_id", vec3u>) {
  if (gid.x >= bank.length) {
    return;
  }
  outs[gid.x] = bank[gid.x].tick(cfg.k);
});
`;

describe("an instance is the struct's host value (Rule 8.21)", () => {
  it('a helper takes an instance, and a plain object of the fields as before', async () => {
    const m = await load(FILTERS);
    const p = new (m.OnePole as new (k: number) => Filter)(0.1);
    p.tick(1);
    const level = m.level as (p: object) => number;
    expect(level(p)).toBe(f(p.z + p.k));
    expect(level({ z: p.z, k: p.k })).toBe(level(p));
    expect(() => level({ z: 1 })).toThrow(
      'level(): parameter "p" (OnePole): at .k, the field is missing.',
    );
  });

  it('a kernel function takes instances in its array, and writes them back in place', async () => {
    const m = await load(FILTERS);
    const OnePole = m.OnePole as new (k: number) => Filter;
    const run = m.run as (...a: unknown[]) => Promise<void>;
    const block = 4;
    const filters = [0.1, 0.2, 0.3].map((k) => new OnePole(k));
    const kept = [...filters];
    const xs = Float32Array.from({ length: filters.length * block }, (_, i) => Math.sin(i));
    const out = new Float32Array(xs.length);
    await run(out, xs, filters, block);
    const states = [0.1, 0.2, 0.3].map((k) => ({ z: 0, k: f(k) }));
    const want = states.flatMap((s, i) =>
      Array.from({ length: block }, (_, n) => tick(s, xs[i * block + n]!)),
    );
    expect([...out]).toEqual(want);
    // The same objects, instances still, each holding what its lane left.
    filters.forEach((p, i) => {
      expect(p).toBe(kept[i]);
      expect(p).toBeInstanceOf(OnePole);
      expect({ ...p }).toEqual(states[i]);
    });
    // A plain object of the fields is taken as before.
    const plain = [{ z: 0, k: 0.1 }];
    const out2 = new Float32Array(block);
    await run(out2, xs.subarray(0, block), plain, block);
    expect([...out2]).toEqual(want.slice(0, block));
    expect(plain[0]).toEqual(states[0]);
  });

  it('an entry takes instances in its bindings, and writes a storage one back in place', async () => {
    const m = await load(BANK);
    const OnePole = m.OnePole as new (k: number) => Filter;
    const tickAll = m.tickAll as (b: unknown, w: unknown) => Promise<void>;
    const bank = [new OnePole(0.5), new OnePole(0.25)];
    const kept = [...bank];
    const outs = new Float32Array(2);
    // Each element ticks once, its sample the uniform's `k`.
    await tickAll({ cfg: new OnePole(1), bank, outs }, 1);
    expect([...outs]).toEqual([0.5, 0.25]);
    expect(bank.map((p) => ({ ...p }))).toEqual([
      { z: 0.5, k: 0.5 },
      { z: 0.25, k: 0.25 },
    ]);
    bank.forEach((p, i) => expect(p).toBe(kept[i]));
    expect(bank[0]).toBeInstanceOf(OnePole);
    // A plain object, as before.
    const plain = [{ z: 0, k: 0.5 }];
    await tickAll({ cfg: { z: 0, k: 1 }, bank: plain, outs }, 1);
    expect(outs[0]).toBe(0.5);
    expect(plain[0]).toEqual({ z: 0.5, k: 0.5 });
  });

  it('a result is an instance of its exported class at every level, built without its constructor (D1)', async () => {
    const m = await load(`"use typeshade";
export class Cell {
  n: f32 = 7.;
  constructor() {
    this.n = this.n + 1.;
  }
  twice(): f32 {
    return this.n * 2.;
  }
}
export class Grid {
  a: Cell;
  b: array<Cell, 2>;
}
class Hidden { n: f32; }
export function cell(n: f32): Cell {
  return { n: n };
}
export function grid(n: f32): Grid {
  return { a: { n: n }, b: array<Cell, 2>({ n: n + 1. }, { n: n + 2. }) };
}
export function hidden(n: f32): Hidden {
  return { n: n };
}
`);
    const Cell = m.Cell as new () => { n: number; twice(): number };
    const Grid = m.Grid as new () => object;
    expect(new Cell().n).toBe(8);
    const c = (m.cell as (n: number) => { n: number; twice(): number })(1);
    expect(c).toBeInstanceOf(Cell);
    expect(c.n).toBe(1); // the constructor would have made it 8
    expect(c.twice()).toBe(2);
    const g = (m.grid as (n: number) => { a: unknown; b: unknown[] })(1);
    expect(g).toBeInstanceOf(Grid);
    expect(g.a).toBeInstanceOf(Cell);
    for (const x of g.b) expect(x).toBeInstanceOf(Cell);
    expect(JSON.parse(JSON.stringify(g))).toEqual({ a: { n: 1 }, b: [{ n: 2 }, { n: 3 }] });
    // A struct no class of the module exports stays a plain object.
    expect(Object.getPrototypeOf((m.hidden as (n: number) => object)(1))).toBe(Object.prototype);
    // So does an instance's own field of an exported class.
    expect(new Grid()).toEqual({ a: { n: 0 }, b: [{ n: 0 }, { n: 0 }] });
    expect((new Grid() as { a: unknown }).a).toBeInstanceOf(Cell);
  });
});

/** A chain of classes: a base, a class that overrides a method its base's body calls, an
 *  abstract class and a class that implements it. */
const SHAPES = `"use typeshade";
export class Base {
  x: f32 = 1.;
  area(): f32 {
    return this.x;
  }
  perim(): f32 {
    return this.area() * 2.;
  }
  static unit(): f32 {
    return 1.;
  }
}
export class Circle extends Base {
  r: f32 = 2.;
  area(): f32 {
    return this.r * this.x;
  }
}
export abstract class Shape {
  w: f32 = 3.;
  abstract sdf(p: f32): f32;
  scaled(p: f32): f32 {
    return this.sdf(p) * this.w;
  }
}
export class Ball extends Shape {
  sdf(p: f32): f32 {
    return p - 1.;
  }
}
export function asShape(w: f32): Shape {
  return { w: w };
}
`;

describe('extends and instanceof (D2)', () => {
  it('declares extends and abstract, and a class below declares what it adds or changes', () => {
    const v = face(SHAPES).view;
    expect(v).toContain(
      'export declare class Circle extends Base {\n  constructor();\n  r: f32;\n}',
    );
    expect(v).toContain(
      'export declare abstract class Shape {\n  w: f32;\n  abstract sdf(p: f32): f32;\n  scaled(p: f32): f32;\n}',
    );
    expect(v).toContain(
      'export declare class Ball extends Shape {\n  constructor();\n  sdf(p: f32): f32;\n}',
    );
    // An abstract class has no instance: its struct in a result is an object of its fields.
    expect(v).toContain('export declare function asShape(w: f32): { w: f32 };');
  });

  it('holds instanceof along the chain, and a call dispatches as in TypeScript', async () => {
    const m = await load(SHAPES);
    type B = { x: number; r?: number; area(): number; perim(): number };
    const Base = m.Base as (new () => B) & { unit(): number };
    const Circle = m.Circle as (new () => B) & { unit(): number };
    const c = new Circle();
    expect(c).toBeInstanceOf(Circle);
    expect(c).toBeInstanceOf(Base);
    expect(Object.getPrototypeOf(Circle)).toBe(Base);
    expect({ ...c }).toEqual({ x: 1, r: 2 });
    // `perim` is Base's body, and it calls Circle's `area` on a Circle.
    expect(c.perim()).toBe(4);
    expect(new Base().perim()).toBe(2);
    expect(Circle.unit()).toBe(1);
    const Shape = m.Shape as new () => object;
    const Ball = m.Ball as new () => { w: number; scaled(p: number): number };
    const b = new Ball();
    expect(b).toBeInstanceOf(Shape);
    expect(b.scaled(5)).toBe(12);
    const s = (m.asShape as (w: number) => object)(2);
    expect(Object.getPrototypeOf(s)).toBe(Object.prototype);
    expect(s).toEqual({ w: 2 });
    expect(() => new Shape()).toThrow(
      new TypeError(
        'new Shape cannot be called from host code: it is abstract, so there is no instance of it to build; construct a class that extends it',
      ),
    );
  });
});

describe('a host program type-checked against the view (Rule 8.20)', () => {
  it('takes what the class offers, and refuses what it does not at the host line', async () => {
    const source = `${FILTERS}${SHAPES.replace('"use typeshade";\n', '')}${PROBE.replace('"use typeshade";\n', '').replace('export const fs = fragment(function fs(', 'export const fs2 = fragment(function fs2(')}`;
    const head = [
      "import { OnePole, run, pair, level, Base, Circle, Shape, Ball, Probe, Lit } from './filters.shade.ts';",
      'const p: OnePole = new OnePole(0.1);',
      'const xs = new Float32Array(8);',
      'const out = new Float32Array(8);',
      '',
    ].join('\n');
    const { elsewhere, byLine } = await hostCodes(source, head, [
      'const y: number = p.tick(1) + p.peek(2) + p.gain + p.onHit(3);',
      'p.gain = 0.5;',
      'const same: OnePole = p.setK(0.2);',
      'const u: OnePole = OnePole.unit();',
      'const bank: OnePole[] = Array.from({ length: 4 }, () => new OnePole(0.1));',
      'await run(out, xs, bank, 2);',
      'await run(out, xs, [new OnePole(0.1)], 2);',
      'const z: number = pair(1)[0]!.tick(1) + level(p) + level(new OnePole(1));',
      // A plain object of the fields where the class goes is refused at the host line (change
      // 0116, decisions D7 and D10); the call takes one at run time (Rule 8.21), as the cases of
      // the kernel function and the helper above check.
      'level({ z: 0, k: 1 });',
      'await run(out, xs, [{ z: 0, k: 0.1 }], 2);',
      'const b: Base = new Circle();',
      'const s: Shape = new Ball();',
      'const t: number = s.scaled(1) + b.perim() + new Probe().scaled(1);',
      'const ok: boolean = p instanceof OnePole && b instanceof Circle;',
      'new Probe().lit(1);',
      'Probe.bright();',
      'new Shape();',
      'new Lit();',
      'new OnePole();',
      "new OnePole('a');",
      'p.z = [1];',
      'console.log(y, same, u, z, t, ok);',
    ]);
    // The view itself type-checks.
    expect(elsewhere).toEqual([]);
    expect(byLine).toEqual([
      'const y: number = p.tick(1) + p.peek(2) + p.gain + p.onHit(3);: ',
      'p.gain = 0.5;: ',
      'const same: OnePole = p.setK(0.2);: ',
      'const u: OnePole = OnePole.unit();: ',
      'const bank: OnePole[] = Array.from({ length: 4 }, () => new OnePole(0.1));: ',
      'await run(out, xs, bank, 2);: ',
      'await run(out, xs, [new OnePole(0.1)], 2);: ',
      'const z: number = pair(1)[0]!.tick(1) + level(p) + level(new OnePole(1));: ',
      'level({ z: 0, k: 1 });: TS2345',
      'await run(out, xs, [{ z: 0, k: 0.1 }], 2);: TS2769',
      'const b: Base = new Circle();: ',
      'const s: Shape = new Ball();: ',
      'const t: number = s.scaled(1) + b.perim() + new Probe().scaled(1);: ',
      'const ok: boolean = p instanceof OnePole && b instanceof Circle;: ',
      'new Probe().lit(1);: TS2349',
      'Probe.bright();: TS2349',
      'new Shape();: TS2511',
      'new Lit();: TS2674',
      'new OnePole();: TS2554',
      "new OnePole('a');: TS2345",
      'p.z = [1];: TS2322',
      'console.log(y, same, u, z, t, ok);: ',
    ]);
  });
});

/** A bank of voices (Amendment 1): a class a kernel function runs over, an array of its instances
 *  in a `Resident`, and a struct whose field holds an instance of another class. */
const VOICES = `"use typeshade";

/** One oscillator's phase, which moves by its step each frame. */
export class Voice {
  phase: f32 = 0.;
  step: f32;
  constructor(step: f32) {
    this.step = step;
  }
  /** One frame: the phase moves by the step and wraps at 1. */
  tick(): f32 {
    this.phase = fract(this.phase + this.step);
    return this.phase;
  }
}

/** Runs every voice of the bank for its frames, one lane per voice. */
export function render(out: array<f32>, voices: array<Voice>, frames: u32) {
  for (let i: u32 = 0; i < voices.length; i++) {
    for (let n: u32 = 0; n < frames; n++) {
      out[i * frames + n] = voices[i].tick();
    }
  }
}

export class Cell {
  n: f32 = 7.;
  constructor() {
    this.n = this.n + 1.;
  }
  twice(): f32 {
    return this.n * 2.;
  }
}

export interface Slot {
  cell: Cell;
  w: f32;
}

/** Grows the cell of each slot by the slot's weight. */
export function grow(slots: array<Slot>) {
  for (let i: u32 = 0; i < slots.length; i++) {
    slots[i].cell.n = slots[i].cell.n + slots[i].w;
  }
}
`;

/** A voice as the host sees it. */
type Osc = { phase: number; step: number; tick(): number };

/** What `Voice.tick` computes in f32. The steps of these tests are exact, so nothing rounds. */
const tickVoice = (v: { phase: number; step: number }): number => {
  const x = f(v.phase + v.step);
  return (v.phase = f(x - Math.floor(x)));
};

/** The generated module of `VOICES`, and the runtime it imports, whose `resident` is the one the
 *  module's calls read. */
async function voices() {
  const m = await load(VOICES);
  const rt = (await import(
    /* @vite-ignore */ pathToFileURL(RUNTIME).href
  )) as typeof import('../../core/host-runtime.js');
  return {
    m,
    rt,
    Voice: m.Voice as new (step: number) => Osc,
    render: m.render as (out: unknown, voices: unknown, frames: number) => Promise<void>,
  };
}

/** Run a host program over the generated module of `source`, as a bundler runs it: its import of
 *  `./filters.shade.ts` reaches the generated module. Resolves to the program's exports. */
async function runHost(source: string, program: string): Promise<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-class-run-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'filters.shade.mjs'), face(source, 'filters').code);
  const js = ts.transpileModule(program.replace("'./filters.shade.ts'", "'./filters.shade.mjs'"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const file = join(dir, 'app.mjs');
  writeFileSync(file, js);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
}

describe('a Resident of instances reads back as instances (Rule 11.8, Amendment 1, D5)', () => {
  it('reads back what a kernel call wrote on the CPU tier, each element an instance of its class', async () => {
    const { rt, Voice, render } = await voices();
    const steps = [0.25, 0.5, 0.375];
    const given = steps.map((s) => new Voice(s));
    const bank = rt.resident(given);
    // The host copy the CPU tier runs on holds instances, and the call writes their fields.
    const held = [...(residentState(bank)!.host as object[])];
    for (const o of held) expect(o).toBeInstanceOf(Voice);
    const frames = 3;
    const out = new Float32Array(steps.length * frames);
    await render(out, bank, frames);
    const want = steps.map((step) => ({ phase: 0, step }));
    expect([...out]).toEqual(
      want.flatMap((v) => Array.from({ length: frames }, () => tickVoice(v))),
    );
    (residentState(bank)!.host as object[]).forEach((o, i) => expect(o).toBe(held[i]));
    const back = await bank.read();
    expect(back).toHaveLength(steps.length);
    back.forEach((v, i) => {
      expect(v).toBeInstanceOf(Voice);
      expect(Object.keys(v)).toEqual(['phase', 'step']);
      expect({ ...v }).toEqual(want[i]);
      // A new copy: neither the host copy's object nor the caller's.
      expect(v).not.toBe(held[i]);
      expect(v).not.toBe(given[i]);
    });
    // The caller's instances hold what they held: the Resident holds its own copy.
    expect(given.map((v) => ({ ...v }))).toEqual(steps.map((step) => ({ phase: 0, step })));
    // A method runs on what read() returned, on the CPU tier, and changes that copy alone.
    const next = { ...want[1]! };
    expect(back[1]!.tick()).toBe(tickVoice(next));
    expect({ ...back[1]! }).toEqual(next);
    expect({ ...(await bank.read())[1]! }).toEqual(want[1]);
  });

  it('keeps the class of each instance write() gives it, before a call and after one', async () => {
    const { rt, Voice, render } = await voices();
    const bank = rt.resident([new Voice(0.25)]);
    const given = [new Voice(0.5), new Voice(0.125)];
    bank.write(given);
    const written = await bank.read();
    written.forEach((v, i) => {
      expect(v).toBeInstanceOf(Voice);
      expect(v).not.toBe(given[i]);
    });
    expect(written.map((v) => ({ ...v }))).toEqual([
      { phase: 0, step: 0.5 },
      { phase: 0, step: 0.125 },
    ]);
    await render(new Float32Array(4), bank, 2);
    const want = [0.5, 0.125].map((step) => ({ phase: 0, step }));
    for (const v of want) for (let n = 0; n < 2; n++) tickVoice(v);
    const back = await bank.read();
    for (const v of back) expect(v).toBeInstanceOf(Voice);
    expect(back.map((v) => ({ ...v }))).toEqual(want);
    expect(back[0]!.tick()).toBe(tickVoice({ ...want[0]! }));
  });

  it('keeps the classes in a Resident that a device makes with array(), as resident() does', async () => {
    const { createDevice } = await import('../../runtime/device.js');
    const { Voice, render } = await voices();
    const dev = await createDevice({ prefer: ['cpu'] });
    try {
      const bank = dev.array([new Voice(0.25), new Voice(0.375)]);
      await render(new Float32Array(2), bank, 1);
      const back = await bank.read();
      for (const v of back) expect(v).toBeInstanceOf(Voice);
      expect(back.map((v) => ({ ...v }))).toEqual([
        { phase: 0.25, step: 0.25 },
        { phase: 0.375, step: 0.375 },
      ]);
      expect(back[1]!.tick()).toBe(0.75);
    } finally {
      await dev.dispose();
    }
  });

  it('reads back a plain object as a plain object, and an instance that a field holds as that instance', async () => {
    const { m, rt, Voice, render } = await voices();
    const Cell = m.Cell as new () => { n: number; twice(): number };
    const grow = m.grow as (slots: unknown) => Promise<void>;
    const weights = [0.5, 1.5];
    const slots = rt.resident(weights.map((w) => ({ cell: new Cell(), w })));
    await grow(slots);
    const back = await slots.read();
    back.forEach((s, i) => {
      expect(Object.getPrototypeOf(s)).toBe(Object.prototype);
      expect(s.cell).toBeInstanceOf(Cell);
      // `new Cell()` makes n 8. read() runs no constructor, so the cell holds what the call left.
      expect(s.cell.n).toBe(8 + weights[i]!);
      expect(s.cell.twice()).toBe(2 * (8 + weights[i]!));
    });
    // A Resident of plain objects reads back as plain objects, as before.
    const plain = rt.resident([{ phase: 0, step: 0.25 }]);
    await render(new Float32Array(2), plain, 2);
    const p = await plain.read();
    expect(Object.getPrototypeOf(p[0])).toBe(Object.prototype);
    expect(p).toEqual([{ phase: 0.5, step: 0.25 }]);
    // One Resident may hold both: each object reads back as it was given.
    const mixed = rt.resident<object[]>([new Voice(0.25), { phase: 0, step: 0.5 }]);
    await render(new Float32Array(2), mixed, 1);
    const [a, b] = await mixed.read();
    expect(a).toBeInstanceOf(Voice);
    expect(Object.getPrototypeOf(b)).toBe(Object.prototype);
    expect([{ ...a }, b]).toEqual([
      { phase: 0.25, step: 0.25 },
      { phase: 0.5, step: 0.5 },
    ]);
  });

  it('types await bank.read() as Voice[] in a host program, and tick() runs on what it returns (Rule 12.7)', async () => {
    const head = [
      "import { Voice, render } from './filters.shade.ts';",
      `import { resident, type Resident } from ${JSON.stringify(RUNTIME)};`,
      '',
    ].join('\n');
    const lines = [
      'const bank: Resident<Voice[]> = resident([new Voice(0.25), new Voice(0.5)]);',
      'await render(new Float32Array(4), bank, 2);',
      'bank.write([...(await bank.read()), new Voice(0.375)]);',
      'const voices: Voice[] = await bank.read();',
      'export const kept: boolean = voices.every((v) => v instanceof Voice);',
      'export const ticked: number[] = voices.map((v) => v.tick());',
    ];
    // `tsc` reads the program against the view: no diagnostic, in the program or in the view.
    const { elsewhere, byLine } = await hostCodes(VOICES, head, lines);
    expect(elsewhere).toEqual([]);
    expect(byLine).toEqual(lines.map((l) => `${l}: `));
    // The same program runs over the generated module, and gets the values `tsc` typed.
    const app = await runHost(VOICES, `${head}${lines.join('\n')}\n`);
    expect(app.kept).toBe(true);
    expect(app.ticked).toEqual([0.75, 0.5, 0.375]);
  });
});

// ═══ A private name is the key "#n" of an instance (Rule 8.21, change 0109, Amendment 2, D6) ═══
//
// The program of issue #971: a class whose field `#n` stands beside the accessor `get n()`. The
// generated class made the field the own property `n`, which the accessor on the prototype
// answers for: `new Counter()` threw "Attempted to assign to readonly property", and with a setter
// it would have called the setter. The instance holds the field under the string key "#n" now, so
// `c.n` is the accessor, and every place a struct's object is taken reads and writes that key.

/** A counter whose count is a private name beside the accessor of its name, a helper that takes
 *  one and one that builds one, a kernel function and an entry over a bank of them. */
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

export const tickAll = compute([64], function tickAll(gid: builtin<"global_invocation_id", vec3u>) {
  if (gid.x >= bank.length) {
    return;
  }
  outs[gid.x] = bank[gid.x].tick();
});
`;

/** A counter as the host sees it: the accessor `n` on the prototype, and the field under "#n". */
type Count = { n: number; step: number; tick(): number; '#n': number };

/** The sentence a check gives for a plain object of a struct with a private field: the object
 *  lacks the key, and an instance built with `new` has it. */
const NO_KEY =
  'the field is missing. "#n" is a private name, which an instance holds and a plain object does not. Build the value with new';

describe('a private name is the key "#n" of an instance (Rule 8.21, Amendment 2, D6, #971)', () => {
  it('is taken by both halves of the shader, the compiler and the editor (Rule 12.7)', () => {
    expect(compile(COUNTERS, { fileName: 'm.shade.ts' }).diagnostics).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', COUNTERS);
    expect(service.getDiagnostics('m.shade.ts')).toEqual([]);
    // The kernel's loop lowers, so the instances are taken by the GPU tier's layout as well (§65).
    const run = face(COUNTERS).exports.find((e) => e.name === 'run');
    expect(run?.kind).toBe('kernel');
    if (run?.kind === 'kernel') expect(run.face.noGpu).toBeUndefined();
  });

  it('builds an instance with the field under the key "#n", and c.n is the accessor on the prototype', async () => {
    const m = await load(COUNTERS);
    const Counter = m.Counter as new (start: number) => Count;
    // Before the change this threw: the own property `n` met the getter alone on the prototype.
    const c = new Counter(5);
    expect(c).toBeInstanceOf(Counter);
    expect(Object.keys(c)).toEqual(['#n', 'step']);
    expect(c['#n']).toBe(5);
    // The accessor answers for `n`, and no own property shadows it.
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
    // The accessor is read from the prototype each time, and answers for the field's new value.
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
    // Built without its constructor, the instance still ticks on the CPU tier.
    expect(made.tick()).toBe(8);
    expect(level(made)).toBe(8);
  });

  it('refuses a plain object of the struct with the reason, in a helper', async () => {
    const m = await load(COUNTERS);
    const level = m.level as (c: object) => number;
    // The fields by their emitted names, as a host builds a struct, lack the key (Rule 8.12).
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
    // A second call goes on from what the first left.
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
    const rt = (await import(
      /* @vite-ignore */ pathToFileURL(RUNTIME).href
    )) as typeof import('../../core/host-runtime.js');
    const Counter = m.Counter as new (start: number) => Count;
    const run = m.run as (out: Uint32Array, counters: unknown) => Promise<void>;
    const given = [1, 2].map((s) => new Counter(s));
    const bank = rt.resident(given);
    await run(new Uint32Array(2), bank);
    const back = await bank.read();
    back.forEach((c, i) => {
      expect(c).toBeInstanceOf(Counter);
      expect(c).not.toBe(given[i]);
      expect(Object.keys(c)).toEqual(['#n', 'step']);
      expect(c['#n']).toBe(2 + i);
      // The accessor answers for the copy's field, and a method runs on the copy.
      expect(c.n).toBe(2 + i);
    });
    expect(back[0]!.tick()).toBe(3);
    // The caller's instances hold what they held: the Resident holds its own copy.
    expect(given.map((c) => c['#n'])).toEqual([1, 2]);
    // write() keeps the key of the instances it is given.
    bank.write([new Counter(40)]);
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
    // The view itself type-checks: before the change it was TS2300, twice.
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
});
