// The call layer's full-screen draw runs as a program-runtime pipeline and pass (change 0120, D2,
// milestone M4): the entry and the full-screen triangle are one `Program`, and a draw records one
// pass through the program runtime of its tier. A draw that repeats its shapes takes its buffers
// from the runtime's pool and its bind groups from the runtime's cache, so after the first draw it
// creates no object on the device (Rule 11.11, "a frame that repeats its shapes creates no GPU
// object"). Node has no WebGPU and no WebGL2, so this holds the CPU tier, which runs the same
// `RuntimeImpl` over the CPU backend; the WebGPU tier shares that runtime, its pool and its cache.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './host-face.js';
import { cpuDevice } from '../../rhi/cpu.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const ROOT = resolve(__dirname, '../../..');
const PLASMA = readFileSync(join(ROOT, 'journeys/plasma/plasma.shade.ts'), 'utf8');

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function load(source: string): Promise<Record<string, unknown>> {
  const f = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-draw-program-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, f.code!);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
}

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
  vi.restoreAllMocks();
});

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

describe('the draw as a program-runtime pipeline and pass (change 0120, M4)', () => {
  it('creates no object on the device for a draw that repeats its shapes', async () => {
    const m = await load(PLASMA);
    const fs = m.fs as (c: unknown, b: unknown) => Promise<void>;
    const canvas = new FakeCanvas(8, 4);
    // The first draw makes the program, the pipeline, its layouts and the pool's buffer.
    await fs(canvas, { frame: { time: 0, scale: 0.25 } });
    const first = [...canvas.pixels!];
    const proto = Object.getPrototypeOf(cpuDevice()) as Record<string, unknown>;
    const spies = MAKERS.map((k) => vi.spyOn(proto as never, k as never));
    for (let i = 0; i < 4; i++) await fs(canvas, { frame: { time: 0, scale: 0.25 } });
    expect(Object.fromEntries(MAKERS.map((k, i) => [k, spies[i]!.mock.calls.length]))).toEqual(
      Object.fromEntries(MAKERS.map((k) => [k, 0])),
    );
    // The same frame each time.
    expect([...canvas.pixels!]).toEqual(first);
  });
});
