// A call on a resource does not block (change 0138, milestone 3, R2; Amendment A5, Q4 and its
// defaults). A kernel function or a `@compute` entry called with a `Buffer` or a `Uniform` (an
// exported binding among them) is recorded and returns nothing; the runtime submits the recorded
// calls when the microtask checkpoint ends, or at `read()` or at the next call with plain data
// only; each call sees the values of its own call; a failure is thrown at the next `read()` or
// call with the line of the failed call. Both readers of the shader source are read (`compile()`
// and the language service), the generated module is imported and run on the CPU tier, and `tsc`
// reads a host program over the view.
//
// It carries no `Verifies:` tag yet: Rule 8.21 still says that no call takes a resource. The tags
// (Rules 8.21 and 8.24) come with that rule's new text, whose Doorstop review the owner approves.

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
import { array, configure, uniform, zeros } from '../runtime.js';
import { kernelQueue } from '../core/resident.js';
import { failurePending } from '../core/submission.js';
import { dirtyRanges, type Buffer, type Uniform } from './resource.js';
import type { f32, vec3 } from './host-types.js';

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

export class Particle {
  pos: vec3 = vec3(0.);
  life: f32 = 0.;
}

export class Params {
  dt: f32 = 0.;
  drag: f32 = 0.;
}

export class Other {
  a: f32 = 0.;
  b: f32 = 0.;
}

export declare const camera: uniform<Params>;
export declare const ps: storage<array<Particle>, "read_write">;

/** Ages every particle by dt. */
export function age(xs: array<Particle>, dt: f32): void {
  for (let i = 0; i < xs.length; i++) {
    xs[i].life = xs[i].life + dt;
  }
}

/** Ages every particle by the parameters' step, and moves it. */
export function move(xs: array<Particle>, p: Params): void {
  for (let i = 0; i < xs.length; i++) {
    xs[i].life = xs[i].life + p.dt;
    xs[i].pos.x = xs[i].pos.x - p.drag;
  }
}

/** Copies the lives of xs into out. */
export function lives(xs: array<Particle>, out: array<f32>): void {
  for (let i = 0; i < xs.length; i++) {
    out[i] = xs[i].life;
  }
}

/** The sum of the lives. */
export function total(xs: array<Particle>): f32 {
  let s = 0.;
  for (const x of xs) {
    s += x.life;
  }
  return s;
}

/** Ages each particle of the binding by the uniform's step. */
@compute([4])
export function step(id: builtin<"global_invocation_id">) {
  if (id.x < ps.length) {
    ps[id.x].life = ps[id.x].life + camera.dt;
  }
}
`;

function face() {
  const f = hostFace(SOURCE, { fileName: '/app/scene.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f as Required<typeof f>;
}

interface Scene {
  Particle: abstract new () => { pos: vec3; life: f32 };
  Params: abstract new () => { dt: f32; drag: f32 };
  Other: abstract new () => { a: f32; b: f32 };
  camera: Omit<Uniform<{ dt: f32; drag: f32 }>, 'dispose'>;
  ps: Omit<Buffer<{ pos: vec3; life: f32 }>, 'dispose'>;
  age: (xs: unknown, dt: number) => unknown;
  move: (xs: unknown, p: unknown) => unknown;
  lives: (xs: unknown, out: unknown) => unknown;
  total: (xs: unknown) => unknown;
  step: (bindings: unknown, workgroups: unknown) => unknown;
}

let loaded: Scene | undefined;
async function load(): Promise<Scene> {
  if (loaded !== undefined) return loaded;
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-resource-call-'));
  dirs.push(dir);
  const file = join(dir, 'scene.shade.mjs');
  writeFileSync(file, face().code);
  loaded = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Scene;
  return loaded;
}

/** The next task: after the microtask checkpoint, when the recorded calls are submitted. */
const nextTask = (): Promise<void> => new Promise((r) => setImmediate(r));

const lifeOf = async (b: { read(): Promise<{ life: number }[]> }): Promise<number[]> =>
  (await b.read()).map((p) => p.life);

describe('the shader source of the calls is read by both halves', () => {
  it('compiles, and the language service reports nothing', () => {
    const r = compile(SOURCE, { fileName: 'scene.shade.ts' });
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const ls = createTypeshadeLanguageService();
    ls.openDocument('scene.shade.ts', SOURCE);
    expect(ls.getDiagnostics('scene.shade.ts')).toEqual([]);
  });
});

describe('a kernel call on a Buffer is recorded and does not block (R2)', () => {
  it('returns nothing, and read() gives what the call wrote', async () => {
    const m = await load();
    const ps = zeros(m.Particle, 4);
    ps.at(1).life.set(1);
    expect(m.age(ps, 0.5)).toBeUndefined();
    m.age(ps, 0.25);
    expect(await lifeOf(ps)).toEqual([0.75, 1.75, 0.75, 0.75]);
    // What the call wrote has landed in the region: get reads it.
    expect(ps.at(1).life.get()).toBe(1.75);
  });

  it('runs nothing until the microtask checkpoint ends', async () => {
    const m = await load();
    const ps = zeros(m.Particle, 2);
    m.age(ps, 1);
    expect(kernelQueue.held.length).toBe(1);
    await Promise.resolve();
    await Promise.resolve();
    // An await of a settled promise does not end the task: the call is still held (default 4).
    expect(kernelQueue.held.length).toBe(1);
    await nextTask();
    expect(kernelQueue.held.length).toBe(0);
    expect(await lifeOf(ps)).toEqual([1, 1]);
  });

  it('read() submits every call recorded before it (default 2)', async () => {
    const m = await load();
    const a = zeros(m.Particle, 1);
    const b = zeros(m.Particle, 1);
    m.age(a, 1);
    m.age(b, 2);
    const read = a.read();
    // Both were submitted, not only the call a depends on.
    expect(kernelQueue.held.length).toBe(0);
    expect((await read)[0]!.life).toBe(1);
    expect((await b.read())[0]!.life).toBe(2);
  });

  it('each call sees the values of its own call (A5, default 3)', async () => {
    const m = await load();
    const ps = zeros(m.Particle, 3);
    m.age(ps, 1);
    // A set between two calls of one submission: the second call sees it, the first does not.
    ps.at(2).life.set(10);
    m.age(ps, 1);
    expect(await lifeOf(ps)).toEqual([2, 2, 11]);
  });

  it('get throws between a call that wrote the array and read(); set still reaches the device', async () => {
    const m = await load();
    const ps = zeros(m.Particle, 2);
    m.age(ps, 1);
    expect(() => ps.at(0).life.get()).toThrow(
      new TypeError(
        "Buffer<Particle>[0].life.get(): a call wrote Buffer<Particle>, and its values are on the device until `await Buffer<Particle>.read()` brings them back; get() reads the host's copy, which does not hold them yet.",
      ),
    );
    // The region holds 0, the device 1 after the call: a set of 0 is still written.
    ps.at(1).life.set(0);
    expect(dirtyRanges(ps)).toEqual([[16, 32]]);
    expect(await lifeOf(ps)).toEqual([1, 0]);
    expect(ps.at(0).life.get()).toBe(1);
  });

  it('takes a Uniform and an exported binding by the value at the call', async () => {
    const m = await load();
    const ps = zeros(m.Particle, 2);
    const p = uniform(m.Params, { dt: 2, drag: 1 });
    m.move(ps, p);
    p.dt.set(100);
    m.camera.set({ dt: 0.5, drag: 0 });
    m.move(ps, m.camera);
    m.camera.dt.set(7);
    const out = await ps.read();
    expect(out.map((x) => x.life)).toEqual([2.5, 2.5]);
    expect(out.map((x) => x.pos[0])).toEqual([-1, -1]);
  });

  it('takes a Resident beside a Buffer, and refuses a written array that is no resource', async () => {
    const m = await load();
    const ps = array(m.Particle, [{ life: 3 }, { life: 4 }]);
    const out = array(new Float32Array(2));
    expect(m.lives(ps, out)).toBeUndefined();
    expect([...(await out.read())]).toEqual([3, 4]);
    expect(() => m.lives(ps, new Float32Array(2))).toThrow(
      new TypeError(
        'lives(): parameter "out" is written by the call, which takes a resource, so it does not block and nothing waits to read it back: pass a Buffer, or array(xs), and await its read() (change 0138, R2).',
      ),
    );
  });

  it('refuses a kernel that returns a value, and a Buffer of another class', async () => {
    const m = await load();
    expect(() => m.total(zeros(m.Particle, 1))).toThrow(TypeError);
    expect(() => m.age(zeros(m.Other, 1), 1)).toThrow(
      new TypeError(
        'age(): parameter "xs" takes an array whose elements are laid out otherwise than Buffer<Other>\'s; pass a Buffer of the class the parameter names.',
      ),
    );
  });

  it('a call with plain data only first submits the recorded calls (default 9), and works as before', async () => {
    const m = await load();
    const ps = zeros(m.Particle, 1);
    m.age(ps, 1);
    const plain = [{ pos: [0, 0, 0] as const, life: 5 }];
    const done = m.age(plain, 1) as Promise<void>;
    expect(kernelQueue.held.length).toBe(0);
    await done;
    expect(plain[0]!.life).toBe(6);
    expect(await m.total([{ pos: [0, 0, 0], life: 2 }])).toBe(2);
    expect(await lifeOf(ps)).toEqual([1]);
  });
});

describe('a @compute entry call on resources (R2, R10)', () => {
  it('takes the exported bindings in its bindings object, and returns nothing', async () => {
    const m = await load();
    m.ps.resize(4);
    m.ps.at(2).life.set(1);
    m.camera.set({ dt: 0.5 });
    expect(m.step({ camera: m.camera, ps: m.ps }, [1])).toBeUndefined();
    m.camera.dt.set(1);
    m.step({ camera: m.camera, ps: m.ps }, [1]);
    expect(await lifeOf(m.ps)).toEqual([1.5, 1.5, 2.5, 1.5]);
  });
});

describe('a recorded call that fails (A5, default 7)', () => {
  it('throws at the next call with the line of the call', async () => {
    const m = await load();
    const ps = zeros(m.Particle, 2);
    // No tier the order allows can run it here: the call fails only when it is submitted.
    configure({ prefer: ['webgpu'] });
    m.age(ps, 1);
    await nextTask();
    await kernelQueue.idle();
    configure({ prefer: ['cpu'] });
    expect(failurePending()).toBe(true);
    let thrown: unknown;
    try {
      m.age(ps, 1);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(
      /age\(\) was called at .*resource-call\.test\.ts:\d+:\d+/,
    );
    expect(failurePending()).toBe(false);
    // The array the failed call wrote keeps its error for read().
    await expect(ps.read()).rejects.toThrow(/age\(\) was called at/);
  });
});

describe('a host program over the view types the calls on resources', () => {
  it('accepts a Buffer, a Uniform and an exported binding where a call takes them', async () => {
    const f = face();
    const dir = mkdtempSync(join(tmpdir(), 'typeshade-resource-call-view-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'scene.shade.ts'), SOURCE);
    writeFileSync(join(dir, 'scene.shade.typeshade.ts'), f.view);
    const head = `import { array, uniform, zeros } from ${JSON.stringify(PUBLIC.replace(/\.ts$/, '.js'))};\nimport { age, move, lives, total, step, camera, ps, Particle, Params, Other } from './scene.shade.ts';\nconst xs = zeros(Particle, 4);\nconst p = uniform(Params, { dt: 1 });\n`;
    const lines = [
      'const a: void = age(xs, 1);',
      'age(ps, 1);',
      'move(xs, p);',
      'move(ps, camera);',
      'lives(xs, array(new Float32Array(4)));',
      'lives(xs, new Float32Array(4));',
      'total(xs);',
      'age(zeros(Other, 1), 1);',
      'const b: void = step({ camera, ps }, [1]);',
      'step({ camera: p, ps: xs }, 1);',
      'await age([{ pos: [0, 0, 0], life: 1 }], 1);',
      'await total([{ pos: [0, 0, 0], life: 1 }]);',
    ];
    const app = join(dir, 'app.ts');
    writeFileSync(app, `${head}${lines.join('\n')}\nexport { a, b };\n`);
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
      'const a: void = age(xs, 1);: ',
      'age(ps, 1);: ',
      'move(xs, p);: ',
      'move(ps, camera);: ',
      'lives(xs, array(new Float32Array(4)));: ',
      'lives(xs, new Float32Array(4));: TS2769',
      'total(xs);: TS2345',
      'age(zeros(Other, 1), 1);: TS2769',
      'const b: void = step({ camera, ps }, [1]);: ',
      'step({ camera: p, ps: xs }, 1);: ',
      'await age([{ pos: [0, 0, 0], life: 1 }], 1);: ',
      'await total([{ pos: [0, 0, 0], life: 1 }]);: ',
    ]);
  });
});
