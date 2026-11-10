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
import { createDevice, texture } from '../runtime.js';
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
    expect(f.view).toContain('export declare const camera: Uniform<Camera>;');
    expect(f.view).toContain('export declare const ps: Buffer<Particle>;');
    // No length to make, and no class to lay out by: each stays a binding with its reason.
    expect(f.view).toContain(
      'it is a resource binding, and a storage array with no fixed size has no length a host resource takes, so it is no host resource yet',
    );
    expect(f.view).toContain('export declare const all: never;');
    expect(f.view).toContain('export declare const scale: never;');
    // The calls do not change at milestone 1: the entry takes the binding's value as before.
    expect(f.view).toContain('readonly camera: Camera;');
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
    expect(() => (m.all as () => void)()).toThrow(TypeError);
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
    const head = `import { createDevice, texture, type Buffer, type Uniform } from ${JSON.stringify(PUBLIC.replace(/\.ts$/, '.js'))};\nimport { camera, ps, all, Camera, Particle } from './scene.shade.ts';\n`;
    const lines = [
      'camera.pos.set(0, 2, 5);',
      'camera.set({ time: 1 });',
      'camera.time.set("x");',
      'const c: Uniform<Camera> = camera;',
      'const p: Buffer<Particle> = ps;',
      'ps.at(0).life.set(1);',
      'camera = c;',
      'all.length;',
      'const device = await createDevice();',
      '{ using _ = device.use(); texture({ size: [1, 1], format: "rgba8unorm" }); }',
      'device.use().dispose();',
    ];
    const app = join(dir, 'app.ts');
    writeFileSync(app, `${head}${lines.join('\n')}\nexport { c, p };\n`);
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
      'const c: Uniform<Camera> = camera;: ',
      'const p: Buffer<Particle> = ps;: ',
      'ps.at(0).life.set(1);: ',
      'camera = c;: TS2632',
      'all.length;: TS2339',
      'const device = await createDevice();: ',
      '{ using _ = device.use(); texture({ size: [1, 1], format: "rgba8unorm" }); }: ',
      'device.use().dispose();: ',
    ]);
  });
});
