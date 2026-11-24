import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './host-face.js';
import { array } from '../../runtime.js';
import { configure, kernelQueue, residentState } from '../../core/resident.js';

const webgl = vi.hoisted(() => ({ context: null as unknown }));
vi.mock('../../core/gl-context.js', async (original) => ({
  ...(await original<typeof import('../../core/gl-context.js')>()),
  glContext: () => webgl.context,
}));

const glCompute = vi.hoisted(() => ({ runs: [] as unknown[][] }));
vi.mock('../../core/gl-compute.js', async (original) => ({
  ...(await original<typeof import('../../core/gl-compute.js')>()),
  runGlCompute: async (...a: unknown[]) => {
    glCompute.runs.push(a);
    return { passes: 1 };
  },
}));

const uploads = vi.hoisted(() => ({ samplers: [] as unknown[] }));
vi.mock('../../core/gl-image.js', async (original) => ({
  ...(await original<typeof import('../../core/gl-image.js')>()),
  uploadImage: (_gl: unknown, _source: unknown, sampler: unknown) => {
    uploads.samplers.push(sampler);
  },
}));

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const SOURCE = `"use typeshade";
declare const xs: storage<array<f32>, "read_write">;
declare const us: storage<array<u32>, "read_write">;
declare const tex: texture_2d<f32>;
declare const _fp64: storage<array<f32>, "read_write">;
@compute([1]) export function bump(gid: builtin<"global_invocation_id">) {
  xs[gid.x] = xs[gid.x] + 1.0;
}
@compute([1]) export function bumpBoth(gid: builtin<"global_invocation_id">) {
  us[gid.x] = us[gid.x] + 1;
  xs[gid.x] = xs[gid.x] + 1.0;
}
@compute([1]) export function paint(gid: builtin<"global_invocation_id">) {
  _fp64[gid.x] = textureLoad(tex, vec2u(0, 0), 0).x;
}
`;

type Call = (bindings: Record<string, unknown>, workgroups: unknown) => unknown;
interface Entries {
  bump: Call;
  bumpBoth: Call;
  paint: Call;
}

const dirs: string[] = [];
let entries: Entries;
let previousImageData: unknown;

class FakeImageData {
  readonly width = 1;
  readonly height = 1;
  readonly data = new Uint8ClampedArray(4);
}

beforeAll(async () => {
  const face = hostFace(SOURCE, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(face.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-entry-tiers-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, face.code!);
  entries = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Entries;
  previousImageData = (globalThis as Record<string, unknown>).ImageData;
  (globalThis as Record<string, unknown>).ImageData = FakeImageData;
});

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  (globalThis as Record<string, unknown>).ImageData = previousImageData;
});

afterEach(() => {
  webgl.context = null;
  glCompute.runs.length = 0;
  uploads.samplers.length = 0;
  configure({ prefer: ['webgpu', 'webgl2', 'cpu'] });
});

const nextTask = (): Promise<void> => new Promise((r) => setImmediate(r));

const stubGl = (): WebGL2RenderingContext =>
  new Proxy({} as object, {
    get: (_, name: string) => (/^[A-Z0-9_]+$/.test(name) ? 1 : () => ({})),
  }) as WebGL2RenderingContext;

describe('an entry called with plain data after a recorded call failed', () => {
  it('throws the failure at the next call, once, and then runs', async () => {
    configure({ prefer: ['webgpu'] });
    entries.bump({ xs: array(new Float32Array(1)) }, 1);
    await nextTask();
    await kernelQueue.idle();
    configure({ prefer: ['cpu'] });
    const plain = new Float32Array(1);
    await expect(Promise.resolve().then(() => entries.bump({ xs: plain }, 1))).rejects.toThrow(
      /bump\(\) was called at/,
    );
    expect([...plain]).toEqual([0]);
    await entries.bump({ xs: plain }, 1);
    expect([...plain]).toEqual([1]);
  });
});

describe('a refused entry call on a Buffer whose element is open', () => {
  it('fixes no element, so a call that takes another element still takes it', async () => {
    configure({ prefer: ['cpu'] });
    const open = array([1, 2]);
    expect(() => entries.bumpBoth({ us: open, xs: 'not an array' }, 1)).toThrow();
    entries.bump({ xs: open }, 1);
    await kernelQueue.idle();
    expect(await open.read()).toEqual(Float32Array.of(2, 2));
  });
});

describe('an entry call on WebGL2 that binds a name of the program runtime', () => {
  const image = (): unknown => new FakeImageData();

  it('runs its own pass program, and loads an unpaired texture with a nearest, clamped sampler', async () => {
    webgl.context = stubGl();
    configure({ prefer: ['webgl2', 'cpu'] });
    await entries.paint({ _fp64: new Float32Array(2), tex: image() }, 1);
    expect(glCompute.runs.length).toBe(1);
    expect((glCompute.runs[0]![2] as { workgroups: unknown }).workgroups).toEqual([1, 1, 1]);
    expect(uploads.samplers).toEqual([{ filter: 'nearest', address: 'clamp' }]);
  });

  it('marks what a recorded call wrote with the context to wait on', async () => {
    const gl = stubGl();
    webgl.context = gl;
    configure({ prefer: ['webgl2', 'cpu'] });
    const recorded = array(new Float32Array(2));
    entries.paint({ _fp64: recorded, tex: image() }, 1);
    await kernelQueue.idle();
    expect(glCompute.runs.length).toBe(1);
    expect(residentState(recorded)!.fence).toBe(gl);
  });
});
