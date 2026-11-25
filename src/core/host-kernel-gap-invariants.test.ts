import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from '../compiler/ts/host-face.js';
import { array, configure } from '../runtime.js';
import { TRIP_WORDS } from './passes/kernel-lower/range-entries.js';
import { reduceOnGpu, type Reduction } from './host-kernel.js';
import type { DispatchBatch, GpuBuffer, GpuDevice } from './host-entry.js';

const RUNTIME = resolve(__dirname, 'host-runtime.ts');
const dirs: string[] = [];
beforeAll(() => {
  configure({ prefer: ['cpu'] });
});
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  configure({ prefer: ['webgpu', 'webgl2', 'cpu'] });
});
type Exports = Record<string, (...a: unknown[]) => unknown>;

async function load(source: string): Promise<Exports> {
  const f = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-gap-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, f.code!);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Exports;
}

describe('the levels of a reduction on the device', () => {
  function recorded(): { d: GpuDevice; batch: DispatchBatch; levels: unknown[][] } {
    const levels: unknown[][] = [];
    const buffer = { destroy: () => undefined } as unknown as GpuBuffer;
    const d = { createBuffer: () => buffer } as unknown as GpuDevice;
    const batch = {
      add: (_e: unknown, args: { values: Record<string, Record<string, unknown>> }) => {
        levels.push(Object.entries(args.values).map(([, v]) => v));
        return Promise.resolve();
      },
      read: () => Promise.resolve(new DataView(new ArrayBuffer(4))),
    } as unknown as DispatchBatch;
    return { d, batch, levels };
  }

  async function dispatches(n: number): Promise<number> {
    const { d, batch, levels } = recorded();
    const r = {
      loop: {},
      fold: {},
      args: 'args',
      wg: 256,
      vars: [
        { binding: { name: 'p', layout: { k: 'a', n: null, st: 4, e: { k: 's', t: 'f32' } } } },
      ],
      fields: { n: '_n', in: '_in', out: '_out' },
    } as unknown as Reduction;
    await reduceOnGpu(d, r, n, {}, {}, new Map(), batch);
    return levels.length;
  }

  it('dispatches the loop and three levels for 2^32 iterations, and the loop alone for 256', async () => {
    expect(await dispatches(2 ** 32)).toBe(4);
    expect(await dispatches(2 ** 24)).toBe(3);
    expect(await dispatches(256)).toBe(1);
    expect(await dispatches(257)).toBe(2);
    expect(await dispatches(65536 * 256 + 1)).toBe(4);
  });
});

describe('the trip words of a range the device holds', () => {
  it('are the words the lowering reserves for each loop', () => {
    const text = readFileSync(resolve(__dirname, 'host-kernel.ts'), 'utf8');
    const own = /^const TRIP_WORDS = (\d+);$/mu.exec(text);
    expect(own).not.toBeNull();
    expect(Number(own![1])).toBe(TRIP_WORDS);
  });
});

const HELD = `"use typeshade";
export function two(xs: array<f32>, a: array<u32>): void {
  for (let i: u32 = 0; i < xs.length; i++) {
    a.push(i);
  }
}
`;

describe('the offset of a held length', () => {
  const held = (offset: number, words: number) => ({
    array: new Uint32Array(4),
    length: array(new Uint32Array(words)),
    offset,
  });

  it('is refused when the length Buffer has no word at it, and taken at the last word', async () => {
    const m = await load(HELD);
    const call = (offset: number, words: number): Promise<unknown> =>
      Promise.resolve().then(() => m.two!(Float32Array.of(1, 2), held(offset, words)));
    await expect(call(2, 2)).rejects.toThrow(
      new TypeError(
        'two(): "a.offset" is 2, and the length at it needs 3 elements; "a.length" holds 2.',
      ),
    );
    await expect(call(5, 1)).rejects.toThrow(
      new TypeError(
        'two(): "a.offset" is 5, and the length at it needs 6 elements; "a.length" holds 1.',
      ),
    );
    await expect(call(1, 2)).resolves.toBeUndefined();
  });
});
