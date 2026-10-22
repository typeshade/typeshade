// Verifies: Rule 8.24, Rule 11.8, Rule 11.11, Rule 11.13 (docs/language-design.md; traced in reqs/).
// Exercise generated host code, CPU invocation builtins and real device plans, not a copy of
// the specialization helper. Browser journeys hold the same path to WebGPU and WebGL2.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './host-face.js';
import { configure, resident } from '../../core/resident.js';
import { createDevice } from '../../runtime/device.js';
import '../../fuse.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
afterEach(() => configure({}));
const SOURCE = `"use typeshade";
const WORK: override<u32> = 4;
const HEIGHT: override<u32> = 1;
const SCRATCH: override<u32> = 4;
const GAIN: override<f32> = 2.;
const ENABLED: override<bool> = true;
let tile: workgroup<array<array<f32, 2>, SCRATCH>>;
let gain: f32 = 0.;
declare const src: storage<array<f32>>;
declare const dst: storage<array<f32>, "read_write">;
@compute([WORK, HEIGHT])
export function scale(@builtin("global_invocation_id") gid: vec3u, @builtin("local_invocation_id") lid: vec3u, @builtin("local_invocation_index") li: u32, @builtin("num_workgroups") nw: vec3u) {
  gain = GAIN;
  const i = gid.x + WORK * nw.x * gid.y;
  if (i >= src.length) return;
  tile[li][1] = src[i] * gain;
  dst[i] = ENABLED == true ? tile[li][0] + tile[li][1] + f32(li) : -1.;
}
`;
type Call = (...args: unknown[]) => Promise<void>;
async function load(source = SOURCE) {
  const f = hostFace(source, { fileName: '/app/overrides.shade.ts', runtime: RUNTIME, fuse: true });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-entry-overrides-'));
  dirs.push(dir);
  const file = join(dir, 'overrides.mjs');
  writeFileSync(file, f.code!);
  const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as { scale: Call };
  return { scale: mod.scale, face: f };
}

describe('entry-call constants on generated CPU closures (0084)', () => {
  it('specializes a 2D shape, nested workgroup zeros, privates, builtins and a tail; keeps defaults separate', async () => {
    configure({ prefer: ['cpu'] });
    const { scale, face } = await load();
    expect(scale.length).toBe(2);
    expect(face.view).toContain(
      'options?: { readonly constants?: Readonly<Record<string, number | boolean>> }',
    );
    const src = Float32Array.from({ length: 29 }, (_, i) => i - 10);
    const dst = new Float32Array(src.length);
    for (const [width, height, gain, enabled] of [
      [8, 2, 3, true],
      [2, 1, -2, 0],
      [4, 1, 2, 1],
    ] as const) {
      dst.fill(0);
      await scale({ src, dst }, [2, 2], {
        constants: {
          WORK: width,
          HEIGHT: height,
          SCRATCH: width * height,
          GAIN: gain,
          ENABLED: enabled,
        },
      });
      const expected = Array.from(src, (x, i) =>
        i < width * height * 4
          ? enabled
            ? x * gain + (i % width) + ((width * Math.floor(i / (width * 2))) % (width * height))
            : -1
          : 0,
      );
      expect([...dst]).toEqual(expected);
    }
    await scale({ src, dst }, Math.ceil(src.length / 4));
    expect([...dst]).toEqual([...src].map((v, i) => 2 * v + (i % 4)));
  });

  it('rounds a supplied f32 override before using it, as pipeline creation does', async () => {
    configure({ prefer: ['cpu'] });
    const { scale } = await load(SOURCE.replace('src[i] * gain', 'src[i] * GAIN'));
    const src = Float32Array.of(30),
      dst = new Float32Array(1);
    // Both this value and 1 are the same f32 constant. Multiplying first and rounding only
    // the result would instead give 30.000001907348633.
    await scale({ src, dst }, 1, { constants: { GAIN: 1 + 0.9 * 2 ** -24 } });
    expect([...dst]).toEqual([30]);
  });

  it('records constants by value, keeps indirect counts and executes two variants in one CPU plan', async () => {
    const { scale } = await load();
    const device = await createDevice({ prefer: ['cpu'] });
    try {
      const src = device.array(Float32Array.from({ length: 13 }, (_, i) => i));
      const tmp = device.array(13, 'f32'),
        dst = device.array(13, 'f32');
      const indirect = device.array(Uint32Array.of(0, 4, 1, 1));
      const constants = { WORK: 8, SCRATCH: 8, GAIN: 3 };
      const plan = await device.fuse(() => {
        void scale({ src, dst: tmp }, 2, { constants });
        constants.GAIN = 99;
        void scale({ src: tmp, dst }, { indirect, offset: 1 }, { constants: { WORK: 4, GAIN: 2 } });
      });
      expect(plan.groups.map((g) => g.calls)).toEqual([['scale'], ['scale']]);
      expect(plan.groups[1]?.indirect).toBe(true);
      expect([...(await dst.read())]).toEqual(
        Array.from({ length: 13 }, (_, i) => (i * 3 + (i % 8)) * 2 + (i % 4)),
      );
    } finally {
      await device.dispose();
    }
  });

  it('refuses names, types, ranges, zero extents and bounded CPU allocations before work runs', async () => {
    configure({ prefer: ['cpu'] });
    const { scale } = await load();
    const src = Float32Array.of(2),
      dst = Float32Array.of(123);
    for (const constants of [
      { UNKNOWN: 1 },
      { WORK: 1.5 },
      { WORK: -1 },
      { GAIN: Infinity },
      { ENABLED: 'yes' },
      { WORK: 0 },
      { SCRATCH: 0 },
      { WORK: 512 },
      { SCRATCH: 0xffffffff },
    ]) {
      await expect(scale({ src, dst }, 1, { constants })).rejects.toThrow(TypeError);
      expect([...dst]).toEqual([123]);
    }
    await expect(scale({ src, dst }, 1, { constant: { WORK: 8 } })).rejects.toThrow(
      'use "constants"',
    );
    await expect(scale({ src, dst }, 1, null)).rejects.toThrow('options takes');
    const fixed = await load(
      `"use typeshade"; declare const dst: storage<array<f32>, "read_write">; @compute([1]) export function scale() { dst[0] = 1.; }`,
    );
    await expect(fixed.scale({ dst }, 1, { constants: { WORK: 8 } })).rejects.toThrow(
      'its overrides are none',
    );
  });

  it('keeps a queued preparation failure on its written Resident until a successful call', async () => {
    configure({ prefer: ['cpu'] });
    const { scale } = await load();
    const src = resident(Float32Array.of(2)),
      dst = resident(Float32Array.of(123));
    await expect(scale({ src, dst }, 1, { constants: { WORK: 1.5 } })).rejects.toThrow(
      'whole number',
    );
    await expect(dst.read()).rejects.toThrow('whole number');
    await scale({ src, dst }, 1, { constants: { GAIN: 3 } });
    expect([...(await dst.read())]).toEqual([6]);
    src.destroy();
    dst.destroy();
  });

  it('drops a whole recorded scope on invalid constants and retains barrier refusal on CPU', async () => {
    const { scale } = await load();
    const device = await createDevice({ prefer: ['cpu'] });
    try {
      const src = device.array(Float32Array.of(2)),
        dst = device.array(Float32Array.of(123));
      await expect(
        device.fuse(() => {
          void scale({ src, dst }, 1);
          void scale({ src, dst }, 1, { constants: { WORK: 1.5 } });
        }),
      ).rejects.toThrow('whole number');
      expect([...(await dst.read())]).toEqual([123]);
      const barrier = await load(
        SOURCE.replace('  const i =', '  workgroupBarrier();\n  const i ='),
      );
      await expect(
        device.fuse(() => {
          void barrier.scale({ src, dst }, 1, { constants: { WORK: 8, SCRATCH: 8 } });
        }),
      ).rejects.toThrow('barrier has no CPU tier');
    } finally {
      await device.dispose();
    }
  });
});
