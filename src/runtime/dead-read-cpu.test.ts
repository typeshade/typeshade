import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from '../compiler/ts/host-face.js';
import { packModule } from '../compiler/ts/pack.js';
import type { Pack } from '../core/manifest-types.js';
import { bothHalves } from '../core/testing/both-halves.js';
import { cpuProgramOf } from '../core/testing/cpu-program.js';
import { CPU_PROGRAM } from '../rhi/cpu-program.js';
import type { RhiBuffer } from '../rhi/rhi.js';
import { cpuRuntime } from './cpu.js';
import type { RuntimeImpl } from './runtime.js';

const RUNTIME = resolve(__dirname, '../core/host-runtime.ts');
const LEVELS = ['O0', 'O1', 'O2'] as const;

const COMPUTE = `"use typeshade";
class Params { scale: f32; }
declare const params: uniform<Params>;
declare const xs: storage<array<f32>>;
declare const vs4: storage<array<vec4>>;
declare const out: storage<array<f32>, "read_write">;
function picked(i: u32, fromXs: bool): f32 { return fromXs ? xs[i] + vs4[i].y : f32(i); }
@compute([4, 1, 1]) export function a(g: builtin<"global_invocation_id">): void {
  let probe = xs[g.x] * params.scale + vs4[g.x].x;
  out[g.x] = f32(g.x) * 2.0;
}
@compute([4, 1, 1]) export function b(g: builtin<"global_invocation_id">): void {
  out[g.x] = picked(g.x, false) + 1.0;
}
`;

const FRAGMENT = `"use typeshade";
class Tint { c: vec4; }
declare const tint: uniform<Tint>;
declare const data: storage<array<vec4>>;
function shade(p: vec2, cached: bool): vec4 { return cached ? data[u32(p.x)] * tint.c : vec4(1., 0.2, 0.6, 1.); }
@vertex export function quad(q: location<0, vec2>): builtin<"position"> { return vec4(q, 0., 1.); }
@fragment export function fs(p: builtin<"position">): vec4 {
  let probe = data[0] + tint.c;
  return shade(p.xy, false);
}
`;

const TEXTURE = `"use typeshade";
declare const tex: texture_2d<f32>;
function shade(p: vec2, cached: bool): vec4 { return cached ? textureLoad(tex, vec2i(p), 0) : vec4(1., 0.2, 0.6, 1.); }
@fragment export function fs(p: builtin<"position">): vec4 { return shade(p.xy, false); }
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

class FakeImageData {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(4 * width * height);
  }
}

class FakeCanvas {
  pixels: Uint8ClampedArray | undefined;
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext(kind: string): unknown {
    if (kind !== '2d') return null;
    return {
      createImageData: (w: number, h: number) => new FakeImageData(w, h),
      putImageData: (img: FakeImageData) => {
        this.pixels = img.data;
      },
    };
  }
}

const g = globalThis as Record<string, unknown>;
beforeEach(() => {
  g['OffscreenCanvas'] = FakeCanvas;
  g['ImageData'] = FakeImageData;
});
afterEach(() => {
  delete g['OffscreenCanvas'];
  delete g['ImageData'];
});

function accepted(source: string): void {
  const halves = bothHalves(source);
  expect(halves.compiler).toEqual([]);
  expect(halves.editor).toEqual([]);
}

async function load(source: string): Promise<Record<string, unknown>> {
  accepted(source);
  const f = hostFace(source, { fileName: '/app/dead.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-dead-read-'));
  dirs.push(dir);
  const file = join(dir, 'dead.shade.mjs');
  writeFileSync(file, f.code!);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
}

function packed(source: string, level: (typeof LEVELS)[number]): Pack {
  accepted(source);
  const pack = packModule(bothHalves(source).result.module, { emit: { level } });
  Object.defineProperty(pack, CPU_PROGRAM, { value: cpuProgramOf(source) });
  return pack;
}

const bound = (pack: Pack, entry: string): string[] =>
  (pack.entries.find((e) => e.name === entry)!.bindings ?? []).map((b) => b.name).sort();

const VALUES: Record<string, unknown> = {
  params: { scale: 3 },
  xs: Float32Array.from([1, 2, 3, 4]),
  vs4: new Float32Array(16).fill(7),
  tint: { c: [0, 0, 0, 0] },
  data: new Float32Array(16).fill(9),
};

describe('the CPU tier runs an entry whose emitted program drops a read (#1337)', () => {
  it('runs a compute entry with a dead storage and uniform read through the host face', async () => {
    const m = await load(COMPUTE);
    const a = m.a as (b: unknown, n: number) => Promise<void>;
    const b = m.b as (b: unknown, n: number) => Promise<void>;
    const out = new Float32Array(4);
    await a({ out }, 1);
    expect([...out]).toEqual([0, 2, 4, 6]);
    await b({ out }, 1);
    expect([...out]).toEqual([1, 2, 3, 4]);
  });

  it('draws a fragment entry with a dead storage and uniform read through the host face', async () => {
    const m = await load(FRAGMENT.replace(/@vertex.*\n/, ''));
    const c = new FakeCanvas(2, 1);
    await (m.fs as (c: unknown, b: unknown) => Promise<void>)(c, {});
    expect([...c.pixels!]).toEqual([255, 51, 153, 255, 255, 51, 153, 255]);
  });

  it('keeps an entry whose authored calls reach a texture off the CPU tier', () => {
    accepted(TEXTURE);
    const f = hostFace(TEXTURE, { fileName: '/app/tex.shade.ts', runtime: RUNTIME });
    const fs = f.exports?.find((e) => e.name === 'fs');
    expect(fs?.kind).toBe('fragment');
    if (fs?.kind !== 'fragment') return;
    expect(fs.entry.bindings.map((b) => b.name)).toEqual([]);
    expect(fs.entry.noCpu).toBe(
      'it reaches the texture_2d<f32> "tex", which the CPU tier cannot read',
    );
  });

  for (const level of LEVELS) {
    it(`dispatches compute entries with exactly their listed bindings at ${level}`, async () => {
      const pack = packed(COMPUTE, level);
      const rt = cpuRuntime() as unknown as RuntimeImpl;
      const program = rt.load(pack);
      const want: Record<string, number[]> = { a: [0, 2, 4, 6], b: [1, 2, 3, 4] };
      for (const entry of ['a', 'b']) {
        const pipeline = await program.compute(entry);
        const out = rt.rhi.createBuffer({ size: 16, usage: ['storage', 'copy-src'] });
        const values: Record<string, unknown> = { out };
        for (const name of bound(pack, entry)) if (name !== 'out') values[name] = VALUES[name];
        const f = rt.frame();
        f.dispatch(pipeline, values as never, 1);
        await f.submit();
        const read = rt.rhi.createBuffer({ size: 16, usage: ['map-read', 'copy-dst'] });
        const encoder = rt.rhi.createCommandEncoder();
        encoder.copyBufferToBuffer(out as RhiBuffer, 0, read, 0, 16);
        await rt.rhi.submit([encoder]);
        expect([...new Float32Array(await rt.rhi.readBuffer(read))]).toEqual(want[entry]);
      }
      if (level === 'O2') {
        expect(bound(pack, 'a')).toEqual(['out']);
        expect(bound(pack, 'b')).toEqual(['out']);
      }
      rt.destroy();
    });

    it(`draws a fragment entry with exactly its listed bindings at ${level}`, async () => {
      const pack = packed(FRAGMENT, level);
      const rt = cpuRuntime();
      const pipeline = await rt.load(pack).render({ targets: [{ format: 'rgba8unorm' }] });
      const target = rt.texture({ size: [2, 2], format: 'rgba8unorm' });
      const values: Record<string, unknown> = {};
      for (const name of [...bound(pack, 'quad'), ...bound(pack, 'fs')])
        values[name] = VALUES[name];
      const vertices = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
      const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
      const f = rt.frame();
      f.pass({ color: [{ target, clear: [0, 0, 0, 1] }] }, (p) =>
        p.draw(pipeline, values as never, { vertices, indices, count: 6 }),
      );
      await f.submit();
      expect([...(await target.read())]).toEqual(
        Array.from({ length: 4 }, () => [255, 51, 153, 255]).flat(),
      );
      if (level === 'O2') expect(bound(pack, 'fs')).toEqual([]);
      rt.destroy();
    });
  }
});
