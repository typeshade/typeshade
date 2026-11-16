// Data decides the device (change 0138, milestone 3, R3). A resource belongs to one device: the
// device in use (`using _ = device.use()`) when it was made, or the default owner when none is in
// use. A call runs on the device of its resources, and with none (plain values, an exported binding)
// on the device in use. A call that mixes devices is a `TypeError`. An exported binding belongs to
// no one device: each device that runs a call that reads it uploads the same dirty range.
//
// The default owner is set to WebGPU alone, which Node has not, so a call that runs on it fails at
// its `read()`; each device here opens on the CPU tier, where it runs. Which of the two ran a call
// is what the test reads. Both readers of the shader source are read (`compile()` and the language
// service), and `tsc` reads a host program over the view.
//
// Verifies: Rule 11.8 (docs/language-design.md; traced in reqs/).

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
import { array, configure, createDevice, uniform, zeros, type Device } from '../runtime.js';
import { kernelQueue } from '../core/resident.js';
import { deviceCopies, type Buffer, type Uniform } from './resource.js';
import type { f32, vec3 } from './host-types.js';

const RUNTIME = resolve(__dirname, '../core/host-runtime.ts');
const PUBLIC = resolve(__dirname, '../runtime.ts');
const dirs: string[] = [];
const devices: Device[] = [];
beforeAll(() => {
  // The default owner runs nothing in Node: a call that runs on it fails.
  configure({ prefer: ['webgpu'] });
});
afterAll(async () => {
  await kernelQueue.idle().catch(() => undefined);
  for (const d of devices) await d.dispose();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  configure({ prefer: ['webgpu', 'webgl2', 'cpu'] });
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

export declare const camera: uniform<Params>;
export declare const ps: storage<array<Particle>, "read_write">;

/** Ages every particle by dt. */
export function age(xs: array<Particle>, dt: f32): void {
  for (let i = 0; i < xs.length; i++) {
    xs[i].life = xs[i].life + dt;
  }
}

/** Ages every particle by the parameters' step. */
export function move(xs: array<Particle>, p: Params): void {
  for (let i = 0; i < xs.length; i++) {
    xs[i].life = xs[i].life + p.dt;
  }
}

/** Copies the lives of xs into out. */
export function lives(xs: array<Particle>, out: array<f32>): void {
  for (let i = 0; i < xs.length; i++) {
    out[i] = xs[i].life;
  }
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
  camera: Omit<Uniform<{ dt: f32; drag: f32 }>, 'dispose'>;
  ps: Omit<Buffer<{ pos: vec3; life: f32 }>, 'dispose'>;
  age: (xs: unknown, dt: number) => unknown;
  move: (xs: unknown, p: unknown) => unknown;
  lives: (xs: unknown, out: unknown) => unknown;
  step: (bindings: unknown, workgroups: unknown) => unknown;
}

let loaded: Scene | undefined;
async function load(): Promise<Scene> {
  if (loaded !== undefined) return loaded;
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-resource-device-'));
  dirs.push(dir);
  const file = join(dir, 'scene.shade.mjs');
  writeFileSync(file, face().code);
  loaded = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Scene;
  return loaded;
}

async function cpuDevice(): Promise<Device> {
  const d = await createDevice({ prefer: ['cpu'] });
  devices.push(d);
  return d;
}

const lifeOf = async (b: { read(): Promise<{ life: number }[]> }): Promise<number[]> =>
  (await b.read()).map((p) => p.life);

const data = (n: number, life = 0): { pos: [number, number, number]; life: number }[] =>
  Array.from({ length: n }, () => ({ pos: [0, 0, 0], life }));

describe('the shader source of the calls is read by both halves', () => {
  it('compiles, and the language service reports nothing', () => {
    const r = compile(SOURCE, { fileName: 'scene.shade.ts' });
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const ls = createTypeshadeLanguageService();
    ls.openDocument('scene.shade.ts', SOURCE);
    expect(ls.getDiagnostics('scene.shade.ts')).toEqual([]);
  });
});

describe('a call follows the device in use (R3)', () => {
  it('runs a call whose only resources are exported bindings on the device in use', async () => {
    const m = await load();
    const dev = await cpuDevice();
    m.ps.set(data(4, 1));
    m.camera.set({ dt: 0.5 });
    {
      using _ = dev.use();
      expect(m.step({ camera: m.camera, ps: m.ps }, [1])).toBeUndefined();
    }
    expect(await lifeOf(m.ps)).toEqual([1.5, 1.5, 1.5, 1.5]);
  });

  it('runs a call with an exported binding and no device in use on the default owner', async () => {
    const m = await load();
    m.ps.set(data(4, 1));
    m.step({ camera: m.camera, ps: m.ps }, [1]);
    await expect(m.ps.read()).rejects.toThrow(/no tier it may use can run it/);
    m.ps.set(data(4, 1));
  });

  it('runs a call with plain data only on the device in use', async () => {
    const m = await load();
    const dev = await cpuDevice();
    const xs = data(2, 1);
    {
      using _ = dev.use();
      await m.age(xs, 2);
    }
    expect(xs.map((x) => x.life)).toEqual([3, 3]);
    await expect(m.age(data(1), 1)).rejects.toThrow(/no tier it may use can run it/);
  });
});

describe('a resource belongs to the device in use when it is made (R3)', () => {
  it('a Buffer and array(xs) made in a block belong to its device after the block, and a Uniform made there joins a call on the device in use', async () => {
    const m = await load();
    const dev = await cpuDevice();
    let xs: Buffer<{ pos: vec3; life: f32 }>;
    let p: Uniform<{ dt: f32; drag: f32 }>;
    let out: { read(): Promise<Float32Array> };
    {
      using _ = dev.use();
      xs = zeros(m.Particle, 3);
      p = uniform(m.Params, { dt: 2 });
      out = array(new Float32Array(3)) as never;
    }
    m.age(xs, 1);
    expect(await lifeOf(xs)).toEqual([1, 1, 1]);
    // A Uniform takes no part in the choice of the device (the owner's decision of 2026-11-11 on
    // Q-a): a call on an exported binding and a Uniform runs on the device in use.
    m.ps.set(data(2));
    {
      using _ = dev.use();
      m.move(m.ps, p);
    }
    expect(await lifeOf(m.ps)).toEqual([2, 2]);
    m.lives(xs, out);
    expect(Array.from(await out.read())).toEqual([1, 1, 1]);
  });

  it('a Uniform made with no device in use joins a call beside a Buffer made in a block (Q-a)', async () => {
    const m = await load();
    // The shape of a host module: the uniform at the top, the device opened later.
    const p = uniform(m.Params, { dt: 3 });
    const dev = await cpuDevice();
    let xs: Buffer<{ pos: vec3; life: f32 }>;
    {
      using _ = dev.use();
      xs = zeros(m.Particle, 2);
      expect(m.move(xs, p)).toBeUndefined();
    }
    // Outside the block too: the call runs on the device of xs.
    m.move(xs, p);
    expect(await lifeOf(xs)).toEqual([6, 6]);
  });

  it('array(n, el) and array(xs) in a block name array() in their errors (S1)', async () => {
    const dev = await cpuDevice();
    using _ = dev.use();
    const make = array as (...a: unknown[]) => unknown;
    expect(() => make(0, 'f32')).toThrow(/^array\(\): a zeroed Buffer takes a length/);
    expect(() => make(Symbol('x'))).toThrow(/^array\(\): /);
  });

  it('a Buffer made with no device in use belongs to the default owner, in a block too', async () => {
    const m = await load();
    const dev = await cpuDevice();
    const xs = zeros(m.Particle, 2);
    {
      using _ = dev.use();
      m.age(xs, 1);
    }
    await expect(xs.read()).rejects.toThrow(/no tier it may use can run it/);
  });
});

describe('a call that mixes devices is a TypeError (R3)', () => {
  it('refuses resources of two devices at the call, and changes no Buffer', async () => {
    const m = await load();
    const a = await cpuDevice();
    const b = await cpuDevice();
    const mine = (d: Device, f: () => unknown): unknown => {
      using _ = d.use();
      return f();
    };
    const xs = mine(a, () => array(m.Particle, data(2, 1))) as Buffer<{ pos: vec3; life: f32 }>;
    const out = mine(b, () => array(new Float32Array(2)));
    expect(() => m.lives(xs, out)).toThrow(TypeError);
    expect(() => m.lives(xs, out)).toThrow(
      /parameter "out" belongs to Device #\d+, while parameter "xs" belongs to Device #\d+/,
    );
    // A Buffer of the default owner beside a device's Resident is a mix too.
    expect(() => m.lives(zeros(m.Particle, 2), out)).toThrow(
      /A call takes resources from one owner/,
    );
    expect(kernelQueue.held.length).toBe(0);
    // The refused calls changed nothing: the Buffer reads its own values.
    expect(xs.at(0).life.get()).toBe(1);
  });
});

describe('an exported binding belongs to no one device (R3, R10)', () => {
  it('each device that runs a call that reads it uploads the same dirty ranges', async () => {
    const m = await load();
    const a = await cpuDevice();
    const b = await cpuDevice();
    const outOf = (d: Device) => d.array(new Float32Array(3));
    m.ps.set(data(3, 1));
    const a1 = outOf(a);
    const b1 = outOf(b);
    m.lives(m.ps, a1);
    m.lives(m.ps, b1);
    m.ps.at(1).life.set(5);
    const a2 = outOf(a);
    m.lives(m.ps, a2);
    m.ps.at(2).life.set(7);
    const b2 = outOf(b);
    const a3 = outOf(a);
    m.lives(m.ps, b2);
    m.lives(m.ps, a3);
    const read = async (r: { read(): Promise<Float32Array> }) => Array.from(await r.read());
    expect(await read(a1)).toEqual([1, 1, 1]);
    expect(await read(b1)).toEqual([1, 1, 1]);
    expect(await read(a2)).toEqual([1, 5, 1]);
    // Device b took the range of element 1 that device a uploaded before, with its own.
    expect(await read(b2)).toEqual([1, 5, 7]);
    expect(await read(a3)).toEqual([1, 5, 7]);
  });

  it('refuses a call on another device between a call that wrote it and read(), and uploads what read() landed', async () => {
    const m = await load();
    const a = await cpuDevice();
    const b = await cpuDevice();
    m.ps.set(data(2, 1));
    m.camera.set({ dt: 1 });
    const before = b.array(new Float32Array(2));
    m.lives(m.ps, before);
    {
      using _ = a.use();
      m.step({ camera: m.camera, ps: m.ps }, [1]);
    }
    const out = b.array(new Float32Array(2));
    expect(() => m.lives(m.ps, out)).toThrow(
      /ps: a call on Device #\d+ wrote ps, and its values are on that device until `await ps.read\(\)` brings them back; await it first/,
    );
    // The same device takes it.
    {
      using _ = a.use();
      m.step({ camera: m.camera, ps: m.ps }, [1]);
    }
    expect(await lifeOf(m.ps)).toEqual([3, 3]);
    m.lives(m.ps, out);
    expect(Array.from(await out.read())).toEqual([3, 3]);
    expect(Array.from(await before.read())).toEqual([1, 1]);
  });
});

describe('a device disposed while an exported binding holds its copy (S2)', () => {
  it('lands what its call wrote, drops its copy, and leaves the binding usable', async () => {
    const m = await load();
    const a = await createDevice({ prefer: ['cpu'] });
    const b = await cpuDevice();
    m.ps.set(data(2, 1));
    m.camera.set({ dt: 1 });
    // The devices of the tests before hold copies too, until they are disposed.
    const before = deviceCopies(m.ps);
    {
      using _ = a.use();
      m.step({ camera: m.camera, ps: m.ps }, [1]);
    }
    expect(deviceCopies(m.ps)).toBe(before + 1);
    await a.dispose();
    // The copy of the disposed device is gone, and what its call wrote is in the region.
    expect(deviceCopies(m.ps)).toBe(before);
    expect(m.ps.at(0).life.get()).toBe(2);
    const out = b.array(new Float32Array(2));
    m.lives(m.ps, out);
    expect(Array.from(await out.read())).toEqual([2, 2]);
    expect(await lifeOf(m.ps)).toEqual([2, 2]);
  });

  it('keeps no copy of a disposed device that only read it', async () => {
    const m = await load();
    m.ps.set(data(2, 1));
    const before = deviceCopies(m.ps);
    for (let i = 0; i < 3; i++) {
      const d = await createDevice({ prefer: ['cpu'] });
      m.lives(m.ps, d.array(new Float32Array(2)));
      await kernelQueue.idle();
      await d.dispose();
    }
    expect(deviceCopies(m.ps)).toBe(before);
    m.ps.at(0).life.set(9);
    const d = await cpuDevice();
    const out = d.array(new Float32Array(2));
    m.lives(m.ps, out);
    expect(Array.from(await out.read())).toEqual([9, 1]);
  });
});

describe('a host program over the view types a block of a device', () => {
  it('accepts using _ = (await createDevice(…)).use() around the calls', async () => {
    const f = face();
    const dir = mkdtempSync(join(tmpdir(), 'typeshade-resource-device-view-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'scene.shade.ts'), SOURCE);
    writeFileSync(join(dir, 'scene.shade.typeshade.ts'), f.view);
    const app = join(dir, 'app.ts');
    writeFileSync(
      app,
      `import { createDevice, zeros } from ${JSON.stringify(PUBLIC.replace(/\.ts$/, '.js'))};
import { age, step, camera, ps, Particle } from './scene.shade.ts';
using _ = (await createDevice({ prefer: ['cpu'] })).use();
const xs = zeros(Particle, 4);
age(xs, 1);
camera.set({ dt: 1 });
step({ camera, ps }, [1]);
const out: { life: number }[] = await xs.read();
export { out };
`,
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
    expect(found.map((d) => `${d.fileName}:${d.line} TS${d.code}`)).toEqual([]);
  });
});
