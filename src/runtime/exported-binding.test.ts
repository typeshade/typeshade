// Exported bindings and the default device (change 0138, milestone 1b: R10, Amendment A2).
// `export declare const camera: uniform<Camera>` in a shader module is a host resource that the
// host imports and sets with `set`, and `device.use()` makes a device the default of a block, on
// which the public `texture()` makes its texture. Both readers of the shader source are read
// (`compile()` and the language service), the generated module is imported and run, and `tsc`
// reads a host program over the view.

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
import { createDevice, texture, uniform, zeros } from '../runtime.js';
import { defaultDevice } from './default-device.js';
import { dirtyRange, markClean, type Buffer, type Uniform } from './resource.js';
import type { f32, vec3 } from './host-types.js';

const RUNTIME = resolve(__dirname, '../core/host-runtime.ts');
const PUBLIC = resolve(__dirname, '../runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SOURCE = `"use typeshade";

export class Camera {
  pos: vec3 = vec3(0.);
  time: f32 = 0.;
}

export class Particle {
  pos: vec3 = vec3(0.);
  life: f32 = 0.;
}

/** Named like the accessor's own members, and no exported binding's class (TS8079). */
export class Loose {
  set: f32 = 0.;
}
export class Owned {
  needsUpdate: f32 = 0.;
}

/** What every frame's shaders read. */
export declare const camera: uniform<Camera>;
export declare const ps: storage<array<Particle, 4>, "read_write">;
export declare const all: storage<array<Particle>, "read_write">;
export declare const scale: uniform<f32>;

@compute([4])
export function step(id: builtin<"global_invocation_id">) {
  ps[id.x].life = ps[id.x].life + camera.time * scale + all[0].life;
}
`;

function face() {
  const f = hostFace(SOURCE, { fileName: '/app/scene.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f as Required<typeof f>;
}

let loaded: Record<string, unknown> | undefined;
async function load(): Promise<Record<string, unknown>> {
  if (loaded !== undefined) return loaded;
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-exported-binding-'));
  dirs.push(dir);
  const file = join(dir, 'scene.shade.mjs');
  writeFileSync(file, face().code);
  loaded = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
  return loaded;
}

// Verifies: Rule 6.1
describe('an exported binding is read by both halves (Rule 6.1)', () => {
  it('compiles to the same binding, and the language service reports nothing on it', () => {
    const r = compile(SOURCE, { fileName: 'scene.shade.ts' });
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.wgsl).toMatch(/@group\(0\) @binding\(0\) var<uniform> camera: Camera;/);
    expect(r.wgsl).toMatch(/var<storage, read_write> ps: array<Particle, 4>;/);
    const ls = createTypeshadeLanguageService();
    ls.openDocument('scene.shade.ts', SOURCE);
    expect(ls.getDiagnostics('scene.shade.ts')).toEqual([]);
    const at = SOURCE.indexOf('camera: uniform');
    const hover = ls.getHover('scene.shade.ts', ls.positionAt('scene.shade.ts', at))?.contents;
    // Inside the shader the binding reads as its value, a uniform resource (Rule 6.1).
    expect(hover).toContain('const camera: Camera');
    expect(hover).toContain('uniform resource at @group(0) @binding(0)');
  });

  it('the view declares a uniform and a sized storage array of a class as resources', () => {
    const f = face();
    expect(f.view).toContain(
      "export declare const camera: Omit<Uniform<Camera>, 'dispose' | keyof Disposable>;",
    );
    expect(f.view).toContain(
      "export declare const ps: Omit<Buffer<Particle>, 'dispose' | keyof Disposable>;",
    );
    // A storage array with no size is a resource whose length the host sets (Amendment A3,
    // `unsized-storage.test.ts`). No class to lay out by: a scalar stays a binding with its reason.
    expect(f.view).toContain(
      "export declare const all: Omit<Buffer<Particle>, 'dispose' | keyof Disposable>;",
    );
    expect(f.view).toContain(
      'it is a resource binding, and only a uniform of a class and a storage array of a class are host resources at milestone 1 of change 0138, so it is no host resource yet',
    );
    expect(f.view).toContain('export declare const scale: never;');
    // The calls do not change at milestone 1: the entry takes the binding's value as before.
    expect(f.view).toContain('readonly camera: Camera;');
  });

  it('HostFace.exports reports each resource as the view declares it (Amendment A5, D6)', () => {
    const f = face();
    const of = (name: string) => f.exports.find((e) => e.name === name);
    expect(of('camera')).toEqual({ kind: 'resource', name: 'camera', cls: 'Camera' });
    expect(of('ps')).toEqual({ kind: 'resource', name: 'ps', cls: 'Particle', length: 4 });
    expect(of('all')).toEqual({ kind: 'resource', name: 'all', cls: 'Particle', length: null });
    expect(of('scale')).toMatchObject({ kind: 'never' });
  });
});

const RESERVED = `"use typeshade";

export class Inner {
  set: f32 = 0.;
}

export class Camera {
  pos: vec3 = vec3(0.);
  needsUpdate: f32 = 0.;
  dispose: u32 = 0;
  inner: Inner = new Inner();
}

export class Particle {
  set: f32 = 0.;
  dispose: f32 = 0.;
}

export declare const camera: uniform<Camera>;
declare const ps: storage<array<Particle>, "read_write">;
export { ps };
declare const quiet: uniform<Camera>;

@compute([1])
export function step(id: builtin<"global_invocation_id">) {
  ps[0].dispose = camera.pos.x + quiet.pos.x;
}
`;

/** TS8079's text for field `field` of the binding `binding`, a `host` in the host. */
const reserved = (field: string, kind: string, binding: string, host: string): string =>
  `"${field}" is named like the host accessor's own ${kind} "${field.split('.')[1]!}": "${binding}" is a binding the module exports, a ${host} in the host, whose fields are properties of that accessor. Rename the field (Rule 6.1).`;

// Verifies: Rule 6.1
describe('a field named like a member of the host accessor (TS8079, Amendment A5, D3)', () => {
  const expected = [
    reserved('Camera.needsUpdate', 'property', 'camera', 'Uniform<Camera>'),
    reserved('Camera.dispose', 'method', 'camera', 'Uniform<Camera>'),
    reserved('Inner.set', 'method', 'camera', 'Uniform<Camera>'),
    reserved('Particle.set', 'method', 'ps', 'Buffer<Particle>'),
  ].map((m) => ['TS8079', m]);

  it('is refused on the exported binding, with the same code and text in both halves', () => {
    const r = compile(RESERVED, { fileName: 'scene.shade.ts' });
    // A binding the module does not export (`quiet`) and a storage element's `dispose` are no
    // host accessor's members, so neither is refused.
    expect(r.diagnostics.map((d) => [d.code, d.message])).toEqual(expected);
    expect(r.diagnostics.map((d) => d.line)).toEqual([19, 19, 19, 20]);
    const ls = createTypeshadeLanguageService();
    ls.openDocument('scene.shade.ts', RESERVED);
    expect(ls.getDiagnostics('scene.shade.ts').map((d) => [d.code, d.message])).toEqual(expected);
  });

  it('is accepted with the fields renamed, and on a class no exported binding holds', () => {
    const renamed = RESERVED.replace(/\bset: f32/g, 'value: f32')
      .replace('needsUpdate: f32', 'stale: f32')
      .replace('dispose: u32', 'freed: u32');
    expect(compile(renamed, { fileName: 'scene.shade.ts' }).diagnostics).toEqual([]);
    const ls = createTypeshadeLanguageService();
    ls.openDocument('scene.shade.ts', renamed);
    expect(ls.getDiagnostics('scene.shade.ts')).toEqual([]);
    // SOURCE's `Loose` and `Owned` hold the names, and no exported binding holds either class.
    const ls2 = createTypeshadeLanguageService();
    ls2.openDocument('scene.shade.ts', SOURCE);
    expect(ls2.getDiagnostics('scene.shade.ts')).toEqual([]);
  });

  it('the runtime keeps its TypeError for a class the host passes', async () => {
    const m = await load();
    const make = uniform as (cls: unknown) => unknown;
    const many = zeros as (cls: unknown, n: number) => { readonly length: number };
    expect(() => make(m.Loose)).toThrow(TypeError);
    expect(() => make(m.Owned)).toThrow(TypeError);
    expect(() => many(m.Loose, 1)).toThrow(TypeError);
    expect(many(m.Owned, 1).length).toBe(1);
  });
});

// Verifies: Rule 6.1, Rule 8.21
describe('the generated module makes each exported binding once (R10)', () => {
  it('is a Uniform whose fields are set and read, with a dirty range', async () => {
    const m = await load();
    const camera = m.camera as Uniform<{ pos: vec3; time: f32 }>;
    camera.pos.set(0, 2, 5);
    expect([...camera.pos.get()]).toEqual([0, 2, 5]);
    markClean(camera);
    expect(dirtyRange(camera)).toBeUndefined();
    camera.time.set(1.5);
    expect(dirtyRange(camera)).toMatchObject({ from: 12, to: 16 });
    camera.set({ time: 1.5 });
    expect(camera.time.get()).toBe(1.5);
    // An import is the same binding wherever it is read.
    const again = (await load()).camera;
    expect(again).toBe(camera);
  });

  it('is a Buffer of the array’s length, and refuses dispose()', async () => {
    const m = await load();
    const ps = m.ps as Buffer<{ pos: vec3; life: f32 }>;
    expect(ps.length).toBe(4);
    ps.at(3).life.set(2);
    expect((await ps.read())[3]!.life).toBe(2);
    expect(() => (m.camera as Uniform<object>).dispose()).toThrow(
      new TypeError(
        'camera.dispose(): camera is a binding that scene.shade.ts exports, which lives as long as its module; it is not disposed.',
      ),
    );
    expect(() => ps.dispose()).toThrow(TypeError);
    expect(ps.at(3).life.get()).toBe(2);
  });

  it('names the binding in a refusal', async () => {
    const m = await load();
    expect(() =>
      (m.camera as unknown as { time: { set(v: unknown): void } }).time.set('x'),
    ).toThrow(new TypeError('camera.time: takes a number (f32), got the string "x".'));
    expect(() => (m.scale as () => void)()).toThrow(TypeError);
  });
});

// Verifies: Rule 11.8
describe('device.use() and texture() (Amendment A2)', () => {
  it('makes the device the default of a block, nesting, and texture() uses it', async () => {
    expect(() => texture({ size: [2, 2], format: 'rgba8unorm' })).toThrow(TypeError);
    const outer = await createDevice({ prefer: ['cpu'] });
    const inner = await createDevice({ prefer: ['cpu'] });
    const a = outer.use();
    expect(defaultDevice()).toBe(outer);
    const b = inner.use();
    expect(defaultDevice()).toBe(inner);
    expect(texture({ size: [2, 2], format: 'rgba8unorm' }).width).toBe(2);
    b.dispose();
    b.dispose();
    expect(defaultDevice()).toBe(outer);
    const key = (Symbol as { readonly dispose?: symbol }).dispose;
    if (typeof key === 'symbol') (a as unknown as Record<symbol, () => void>)[key]!();
    else a.dispose();
    expect(defaultDevice()).toBeUndefined();
    await outer.dispose();
    await inner.dispose();
    expect(() => outer.use()).toThrow(TypeError);
  });
});

describe('a host program over the view types the exported bindings', () => {
  it('sets a binding’s fields, refuses an assignment, and types texture() and use()', async () => {
    const f = face();
    const dir = mkdtempSync(join(tmpdir(), 'typeshade-exported-binding-view-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'scene.shade.ts'), SOURCE);
    writeFileSync(join(dir, 'scene.shade.typeshade.ts'), f.view);
    const head = `import { array, createDevice, texture, uniform, zeros, type Buffer, type Uniform } from ${JSON.stringify(PUBLIC.replace(/\.ts$/, '.js'))};\nimport { camera, ps, scale, Camera, Particle, Loose, Owned } from './scene.shade.ts';\n`;
    const lines = [
      'camera.pos.set(0, 2, 5);',
      'camera.set({ time: 1 });',
      'camera.time.set("x");',
      'const c: Omit<Uniform<Camera>, "dispose" | keyof Disposable> = camera;',
      'const p: Omit<Buffer<Particle>, "dispose" | keyof Disposable> = ps;',
      'ps.at(0).life.set(1);',
      'camera = c;',
      // An exported binding lives as long as its module (Amendment A5, D7); a uniform the host
      // makes is disposable, by `dispose()` and by `using` (D4).
      'const u: Uniform<Camera> = camera;',
      'camera.dispose();',
      '{ using own = uniform(Camera); own.time.set(1); }',
      '{ using own = camera; }',
      // A class whose field is named like a member of the accessor (D3).
      'uniform(Loose);',
      'uniform(Owned);',
      'zeros(Loose, 1);',
      'zeros(Owned, 1);',
      'array(Loose, []);',
      'scale.length;',
      'const device = await createDevice();',
      '{ using _ = device.use(); texture({ size: [1, 1], format: "rgba8unorm" }); }',
      'device.use().dispose();',
    ];
    const app = join(dir, 'app.ts');
    writeFileSync(app, `${head}${lines.join('\n')}\nexport { c, p, u };\n`);
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
      'camera.pos.set(0, 2, 5);: ',
      'camera.set({ time: 1 });: ',
      'camera.time.set("x");: TS2345',
      'const c: Omit<Uniform<Camera>, "dispose" | keyof Disposable> = camera;: ',
      'const p: Omit<Buffer<Particle>, "dispose" | keyof Disposable> = ps;: ',
      'ps.at(0).life.set(1);: ',
      'camera = c;: TS2632',
      'const u: Uniform<Camera> = camera;: TS2322',
      'camera.dispose();: TS2339',
      '{ using own = uniform(Camera); own.time.set(1); }: ',
      '{ using own = camera; }: TS2850',
      'uniform(Loose);: TS2345',
      'uniform(Owned);: TS2345',
      'zeros(Loose, 1);: TS2345',
      'zeros(Owned, 1);: ',
      'array(Loose, []);: TS2769',
      'scale.length;: TS2339',
      'const device = await createDevice();: ',
      '{ using _ = device.use(); texture({ size: [1, 1], format: "rgba8unorm" }); }: ',
      'device.use().dispose();: ',
    ]);
  });
});
