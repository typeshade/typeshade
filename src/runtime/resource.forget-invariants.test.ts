import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from '../compiler/ts/host-face.js';
import { configure, zeros } from '../runtime.js';
import { kernelQueue, residentState } from '../core/resident.js';
import { defaultOwner, type CallOwner } from '../core/owner.js';
import { throwFailure } from '../core/submission.js';
import { Region } from './region.js';
import { makeBuffer } from './resource.js';

const RUNTIME = resolve(__dirname, '../core/host-runtime.ts');
const dirs: string[] = [];
beforeAll(() => {
  configure({ prefer: ['cpu'] });
});
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  configure({ prefer: ['webgpu', 'webgl2', 'cpu'] });
});

const SOURCE = `"use typeshade";

export class Particle {
  life: f32 = 0.;
}

export function age(xs: array<Particle>, dt: f32): void {
  for (let i = 0; i < xs.length; i++) {
    xs[i].life = xs[i].life + dt;
  }
}
`;

interface Scene {
  Particle: new () => { life: number };
  age: (xs: unknown, dt: number) => unknown;
}
interface Root {
  read(): Promise<{ life: number }[]>;
  set(data: unknown): void;
  resize(length: number): void;
  dispose(): void;
  forget(owner: CallOwner): Promise<void>;
  prepare(writes: boolean, owner: CallOwner): { readonly handle: object; readonly layout: unknown };
}

let loaded: Scene | undefined;
async function load(): Promise<Scene> {
  if (loaded !== undefined) return loaded;
  const f = hostFace(SOURCE, { fileName: '/app/scene.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-resource-forget-'));
  dirs.push(dir);
  const file = join(dir, 'scene.shade.mjs');
  writeFileSync(file, f.code!);
  loaded = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Scene;
  return loaded;
}

const nextTask = (): Promise<void> => new Promise((r) => setImmediate(r));

async function failedWrite(): Promise<Root> {
  const m = await load();
  const ps = zeros(m.Particle, 2) as unknown as Root;
  configure({ prefer: ['webgpu'] });
  m.age(ps, 1);
  await nextTask();
  await kernelQueue.idle();
  configure({ prefer: ['cpu'] });
  expect(() => throwFailure()).toThrow();
  return ps;
}

describe('a device that is forgotten after a failed call', () => {
  it('keeps the error of the call on the array, until set(data)', async () => {
    const m = await load();
    const ps = await failedWrite();
    await ps.forget(defaultOwner);
    expect(() => m.age(ps, 1)).toThrow(/age\(\) was called at/);
    expect(() => m.age(ps, 1)).toThrow(/age\(\) was called at/);
    ps.set([{ life: 5 }, { life: 6 }]);
    m.age(ps, 1);
    expect((await ps.read()).map((p) => p.life)).toEqual([6, 7]);
  });

  it('keeps the error of the call on the array, until resize()', async () => {
    const m = await load();
    const ps = await failedWrite();
    await ps.forget(defaultOwner);
    expect(() => m.age(ps, 1)).toThrow(/age\(\) was called at/);
    ps.resize(3);
    m.age(ps, 1);
    expect((await ps.read()).length).toBe(3);
  });
});

describe('dispose() of a Buffer', () => {
  it('frees the device copy after the calls recorded before it', async () => {
    const m = await load();
    const buffer = makeBuffer(new Region(), m.Particle, 2, undefined, 'zeros()') as unknown as Root;
    const recorded = buffer.prepare(false, defaultOwner);
    const state = residentState(recorded.handle)!;
    const order: string[] = [];
    state.gpu = {
      d: {},
      buffer: { destroy: () => order.push('destroy') },
      size: 0,
      layout: recorded.layout,
    } as never;
    const call = kernelQueue.record(async () => {
      await nextTask();
      order.push('call');
    });
    buffer.dispose();
    expect(state.destroyed).toBe(true);
    await call;
    await kernelQueue.idle();
    expect(order).toEqual(['call', 'destroy']);
  });
});
