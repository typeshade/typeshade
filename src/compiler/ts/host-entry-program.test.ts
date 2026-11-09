// The call layer's entry call runs as a program-runtime pipeline and pass (change 0120, D2,
// milestone M4): outside a `fuse` scope, an entry call loads a `Program` of a manifest made from
// the entry's record and records one compute pass through the program runtime of its tier. A
// call that repeats its shapes takes its buffers from the runtime's pool and its bind groups from
// the runtime's cache, so after the first call it creates no object on the device (Rule 11.11,
// "a frame that repeats its shapes creates no GPU object"). Node has no WebGPU and no WebGL2, so
// this holds the CPU tier, which runs the same `RuntimeImpl` over the CPU backend; the WebGPU
// tier shares that runtime, its pool and its cache.

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './host-face.js';
import { cpuDevice } from '../../rhi/cpu.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function load(source: string): Promise<Record<string, unknown>> {
  const f = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-entry-program-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, f.code!);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
}

// A uniform, a storage array it reads, and two it writes, one of vectors.
const SCALE = `"use typeshade";
declare const k: uniform<f32>;
declare const xs: storage<array<f32>>;
declare const ys: storage<array<f32>, "read_write">;
declare const pts: storage<array<vec2>, "read_write">;

export const scale = compute([8], function scale(gid: builtin<"global_invocation_id", vec3u>) {
  if (gid.x >= xs.length) {
    return;
  }
  ys[gid.x] = xs[gid.x] * k;
  pts[gid.x] = vec2(f32(gid.x), xs[gid.x]);
});
`;

/** The methods of the CPU backend that make an object on the device. */
const MAKERS = [
  'createBuffer',
  'createTexture',
  'createSampler',
  'createShaderModule',
  'createBindGroupLayout',
  'createBindGroup',
  'createComputePipeline',
  'createRenderPipeline',
] as const;

type Proto = Record<(typeof MAKERS)[number], (...a: unknown[]) => unknown>;

describe('the entry call as a program-runtime pipeline and pass (change 0120, M4)', () => {
  it('creates no object on the device for a call that repeats its shapes, after the first makes its pipeline', async () => {
    const m = await load(SCALE);
    const scale = m.scale as (b: unknown, w: unknown) => Promise<void>;
    const xs = Float32Array.from({ length: 10 }, (_, i) => i + 0.5);
    const proto = Object.getPrototypeOf(cpuDevice()) as Proto;
    const spies = MAKERS.map((k) => vi.spyOn(proto, k));
    const counts = (): Record<string, number> =>
      Object.fromEntries(MAKERS.map((k, i) => [k, spies[i]!.mock.calls.length]));
    const ys = new Float32Array(10);
    const pts = new Float32Array(20);
    await scale({ k: 3, xs, ys, pts }, 2);
    // The positive control: the spies see what the first call of a new module makes. The pool's
    // buffers (4 at most) may be ones an earlier file in this worker left in the pool.
    const first = counts();
    expect(first.createShaderModule).toBe(1);
    expect(first.createComputePipeline).toBe(1);
    expect(first.createBindGroup).toBe(1);
    expect(first.createBuffer).toBeLessThanOrEqual(4);
    expect([...ys]).toEqual([...xs].map((x) => Math.fround(x * 3)));
    for (const s of spies) s.mockClear();
    for (let i = 0; i < 4; i++) {
      const again = { ys: new Float32Array(10), pts: new Float32Array(20) };
      await scale({ k: 3, xs, ...again }, 2);
      // The same answer each time.
      expect([...again.ys]).toEqual([...ys]);
      expect([...again.pts]).toEqual([...xs].flatMap((x, i) => [i, x]));
    }
    expect(counts()).toEqual(Object.fromEntries(MAKERS.map((k) => [k, 0])));
  });

  it('computes an f64 on the host doubles it was given, with no bytes between', async () => {
    const m = await load(`"use typeshade";
declare const xs: storage<array<f64>>;
declare const ys: storage<array<f64>, "read_write">;

export const twice = compute([4], function twice(gid: builtin<"global_invocation_id", vec3u>) {
  if (gid.x >= xs.length) {
    return;
  }
  ys[gid.x] = xs[gid.x] * f64(2);
});
`);
    const xs = Float64Array.of(0.1, 1 / 3, Math.PI, 1e-300);
    const ys = new Float64Array(4);
    await (m.twice as (b: unknown, w: unknown) => Promise<void>)({ xs, ys }, 1);
    // A double, as the CPU tier computes an f64: no pair of f32s lies between, which would hold
    // 1e-300 as 0 and the others to about 48 bits.
    expect([...ys]).toEqual([...xs].map((x) => x * 2));
  });
});
