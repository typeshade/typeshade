// ═══ The common modules, typeshade/algorithms and typeshade/random (change 0072, Rule 11.20) ═══
//
// Three things are held here. The baked host faces are the bake of the shader sources on disk, so
// an edit to a `.shade.ts` without `bun scripts/bake-common-modules.ts` fails. Each function gives,
// on the CPU tier, the value its contract states, against plain JavaScript written here and, for
// `fillUniform`, against `generator(seed)` on the host (decision D5). And the facts each kernel
// function's face carries let the planner fuse it with its neighbours (Rule 11.13): the planner
// is given the faces and the arrays of a chain and groups them as §72 says. The GPU tiers are the
// differential gate's (`scripts/gpu-differential.ts`, the common-module arm).

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configure, resident } from 'typeshade/runtime';
import * as algorithms from 'typeshade/algorithms';
import * as random from 'typeshade/random';
import { COMMON_MODULES, bakeCommonModule, bakedFiles } from '../scripts/bake-common-modules.js';
import { hostFace } from './compiler/ts/host-face.js';
import { groupCalls, type GroupCall } from './core/fuse-group.js';
import type { KernelFace } from './core/host-kernel.js';

const ROOT = resolve(import.meta.dirname, '..');
const read = (file: string): string | undefined =>
  existsSync(file) ? readFileSync(file, 'utf8') : undefined;

describe('the baked host faces', () => {
  for (const module of COMMON_MODULES) {
    it(`${module.dir} is the bake of its shader sources`, async () => {
      const baked = await bakeCommonModule(module, read);
      const files = bakedFiles(module);
      for (const key of ['face', 'view', 'index'] as const)
        expect(
          read(files[key]),
          `${files[key]} is stale; run bun scripts/bake-common-modules.ts`,
        ).toBe(baked[key]);
    });
  }
});

describe('on the CPU tier', () => {
  beforeAll(() => configure({ prefer: ['cpu'] }));
  afterAll(() => configure({}));

  const f32 = (...xs: number[]): Float32Array => Float32Array.from(xs);
  const u32 = (...xs: number[]): Uint32Array => Uint32Array.from(xs);

  describe('typeshade/random', () => {
    it('fillUniform gives generator(seed) on the host, element for element, in [0, 1)', async () => {
      const out = new Float32Array(4096);
      await random.fillUniform(out, 12345);
      const next = random.generator(12345);
      for (let i = 0; i < out.length; i++) expect(out[i]).toBe(next());
      expect(out.every((v) => v >= 0 && v < 1)).toBe(true);
      // The words behind the numbers, and their mapping, are the two exported helpers.
      const words = new Uint32Array(16);
      await random.fillWords(words, 12345);
      for (let i = 0; i < 16; i++) {
        expect(words[i]).toBe(random.hash32((12345 ^ i) >>> 0));
        expect(out[i]).toBe(random.uniform(words[i]!));
      }
    });

    it('xorshift32, hash32 and uniform are the stated bit operations', () => {
      const step = (x: number): number => {
        x = (x ^ (x << 13)) >>> 0;
        x = (x ^ (x >>> 17)) >>> 0;
        return (x ^ (x << 5)) >>> 0;
      };
      let s = 2463534242;
      let t = 2463534242;
      for (let i = 0; i < 1000; i++) {
        s = random.xorshift32(s);
        t = step(t);
        expect(s).toBe(t);
      }
      expect(random.xorshift32(0)).toBe(0);
      const lowbias32 = (x: number): number => {
        x = (x ^ (x >>> 16)) >>> 0;
        x = Math.imul(x, 0x7feb352d) >>> 0;
        x = (x ^ (x >>> 15)) >>> 0;
        x = Math.imul(x, 0x846ca68b) >>> 0;
        return (x ^ (x >>> 16)) >>> 0;
      };
      for (const x of [0, 1, 2, 7, 0xdeadbeef, 0xffffffff])
        expect(random.hash32(x)).toBe(lowbias32(x));
      expect(random.uniform(0)).toBe(0);
      expect(random.uniform(0xffffffff)).toBe(Math.fround(0xffffff / 16777216));
      expect(random.uniform(0x80000000)).toBe(0.5);
    });

    it('generator takes a 32-bit seed', () => {
      expect(() => random.generator(-1)).toThrow(/whole number from 0 to 4294967295/);
      expect(() => random.generator(2 ** 32)).toThrow(/whole number/);
      expect(() => random.generator(1.5)).toThrow(/whole number/);
    });
  });

  describe('typeshade/algorithms', () => {
    const x = f32(1, -2, 3, -4, 5, 6);

    it('copies, fills and counts', async () => {
      const out = new Float32Array(6);
      await algorithms.copy(out, x);
      expect(out).toEqual(x);
      await algorithms.fill(out, 2.5);
      expect(out).toEqual(f32(2.5, 2.5, 2.5, 2.5, 2.5, 2.5));
      await algorithms.sequence(out, 1, 0.5);
      expect(out).toEqual(f32(1, 1.5, 2, 2.5, 3, 3.5));
    });

    it('maps each element, the builtin under its own name', async () => {
      const out = new Float32Array(6);
      const y = f32(2, 2, 2, 2, 2, 2);
      await algorithms.add(out, x, y);
      expect(out).toEqual(f32(3, 0, 5, -2, 7, 8));
      await algorithms.sub(out, x, y);
      expect(out).toEqual(f32(-1, -4, 1, -6, 3, 4));
      await algorithms.mul(out, x, y);
      expect(out).toEqual(f32(2, -4, 6, -8, 10, 12));
      await algorithms.div(out, x, y);
      expect(out).toEqual(f32(0.5, -1, 1.5, -2, 2.5, 3));
      await algorithms.scale(out, x, 3);
      expect(out).toEqual(f32(3, -6, 9, -12, 15, 18));
      await algorithms.abs(out, x);
      expect(out).toEqual(f32(1, 2, 3, 4, 5, 6));
      await algorithms.neg(out, x);
      expect(out).toEqual(f32(-1, 2, -3, 4, -5, -6));
      await algorithms.relu(out, x);
      expect(out).toEqual(f32(1, 0, 3, 0, 5, 6));
      await algorithms.sign(out, x);
      expect(out).toEqual(f32(1, -1, 1, -1, 1, 1));
      await algorithms.clip(out, x, -2.5, 4.5);
      expect(out).toEqual(f32(1, -2, 3, -2.5, 4.5, 4.5));
      const p = f32(0.25, 1, 4, 9, 16, 2);
      await algorithms.sqrt(out, p);
      expect(out).toEqual(f32(0.5, 1, 2, 3, 4, Math.fround(Math.sqrt(2))));
      await algorithms.rsqrt(out, p);
      expect(out[0]).toBe(2);
      expect(out[2]).toBe(0.5);
      await algorithms.exp(out, f32(0, 1, -1, 2, 0.5, 10));
      expect(out[0]).toBe(1);
      expect(Math.abs(out[1]! - Math.E)).toBeLessThan(1e-6);
      await algorithms.log(out, f32(1, Math.E, 2, 10, 0.5, 100));
      expect(out[0]).toBe(0);
      expect(Math.abs(out[1]! - 1)).toBeLessThan(1e-6);
      const r = f32(0.5, 1.5, 2.5, -0.5, -1.5, 2.4);
      await algorithms.floor(out, r);
      expect(out).toEqual(f32(0, 1, 2, -1, -2, 2));
      await algorithms.ceil(out, r);
      expect(out).toEqual(f32(1, 2, 3, -0, -1, 3));
      await algorithms.round(out, r);
      expect(out).toEqual(f32(0, 2, 2, 0, -2, 2));
      const a = f32(0, 0.5, 1, -1, 2, Math.PI / 2);
      await algorithms.sin(out, a);
      expect(out[0]).toBe(0);
      expect(Math.abs(out[5]! - 1)).toBeLessThan(1e-6);
      await algorithms.cos(out, a);
      expect(out[0]).toBe(1);
      await algorithms.tan(out, a);
      expect(out[0]).toBe(0);
      await algorithms.tanh(out, a);
      expect(out[0]).toBe(0);
      expect(Math.abs(out[4]! - Math.tanh(2))).toBeLessThan(1e-6);
      await algorithms.sigmoid(out, f32(0, 100, -100, 1, -1, 0.5));
      expect(out[0]).toBe(0.5);
      expect(out[1]).toBe(1);
      // exp(-100) is a subnormal f32, so the quotient is tiny, not zero.
      expect(out[2]).toBeLessThan(1e-40);
      expect(Math.abs(out[3]! - 1 / (1 + Math.exp(-1)))).toBeLessThan(1e-6);
      // Near zero the series keeps the digits `exp(x) - 1` and `log(1 + x)` would lose.
      await algorithms.expm1(out, f32(1e-4, -1e-4, 1, 0, 0.005, -0.005));
      expect(Math.abs(out[0]! - Math.expm1(1e-4))).toBeLessThan(1e-10);
      expect(Math.abs(out[2]! - Math.expm1(1))).toBeLessThan(1e-6);
      await algorithms.log1p(out, f32(1e-4, -1e-4, 1, 0, 0.005, -0.005));
      expect(Math.abs(out[0]! - Math.log1p(1e-4))).toBeLessThan(1e-10);
      expect(Math.abs(out[2]! - Math.log1p(1))).toBeLessThan(1e-6);
    });

    it('reduces the whole array, and along an axis', async () => {
      expect(await algorithms.sum(x)).toBe(9);
      expect(await algorithms.max(x)).toBe(6);
      expect(await algorithms.min(x)).toBe(-4);
      // x read as [2, 3, 1] and as [1, 2, 3]: the axis in the middle, inner last.
      const m = f32(1, 2, 3, 4, 5, 6);
      const o2 = new Float32Array(2);
      const o3 = new Float32Array(3);
      await algorithms.sumAxis(o2, m, 3, 1);
      expect(o2).toEqual(f32(6, 15));
      await algorithms.sumAxis(o3, m, 2, 3);
      expect(o3).toEqual(f32(5, 7, 9));
      await algorithms.meanAxis(o2, m, 3, 1);
      expect(o2).toEqual(f32(2, 5));
      await algorithms.prodAxis(o2, m, 3, 1);
      expect(o2).toEqual(f32(6, 120));
      await algorithms.maxAxis(o3, m, 2, 3);
      expect(o3).toEqual(f32(4, 5, 6));
      await algorithms.minAxis(o3, m, 2, 3);
      expect(o3).toEqual(f32(1, 2, 3));
      // The first largest and the first smallest win a tie.
      const t = f32(1, 5, 5, 2, 9, 9, 3, 3, 3);
      const o = new Float32Array(3);
      await algorithms.argMaxAxis(o, t, 3, 1);
      expect(o).toEqual(f32(1, 1, 0));
      await algorithms.argMinAxis(o, t, 3, 1);
      expect(o).toEqual(f32(0, 0, 0));
    });

    it('scans, with a block of ceil(n / sums.length), and compacts in order', async () => {
      const n = 37;
      const v = Uint32Array.from({ length: n }, (_, i) => (i * 7) % 5);
      for (const blocks of [1, 6, 37, 50]) {
        const sums = new Uint32Array(blocks);
        const ex = new Uint32Array(n);
        const inc = new Uint32Array(n);
        await algorithms.exclusiveScan(ex, v, sums);
        await algorithms.inclusiveScan(inc, v, sums);
        let acc = 0;
        for (let i = 0; i < n; i++) {
          expect(ex[i], `exclusive at ${i}, ${blocks} blocks`).toBe(acc);
          acc += v[i]!;
          expect(inc[i], `inclusive at ${i}, ${blocks} blocks`).toBe(acc);
        }
      }
      const values = Float32Array.from({ length: n }, (_, i) => i + 0.5);
      const flags = Uint32Array.from({ length: n }, (_, i) => (i % 3 === 0 || i === n - 1 ? 1 : 0));
      const offsets = new Uint32Array(n);
      await algorithms.exclusiveScan(offsets, flags, new Uint32Array(4));
      const total = offsets[n - 1]! + flags[n - 1]!;
      const kept = new Float32Array(total + 3);
      await algorithms.compact(kept, values, flags, offsets);
      const expected = Array.from(values).filter((_, i) => flags[i] === 1);
      expect(Array.from(kept.subarray(0, total))).toEqual(expected);
      expect(Array.from(kept.subarray(total))).toEqual([0, 0, 0]);
      // A tail that is not kept: the last flagged element still lands at its offset.
      const tail = u32(1, 0, 1, 0, 0);
      const tailOffsets = new Uint32Array(5);
      await algorithms.exclusiveScan(tailOffsets, tail, new Uint32Array(2));
      const two = new Float32Array(2);
      await algorithms.compact(two, f32(10, 20, 30, 40, 50), tail, tailOffsets);
      expect(two).toEqual(f32(10, 30));
    });

    it('counts a histogram into the bins it is given, clamping to the edges', async () => {
      const bins = new Uint32Array(4);
      await algorithms.histogram(bins, f32(-1, 0, 0.1, 0.3, 0.5, 0.74, 0.75, 0.99, 1, 7), 0, 1);
      expect(bins).toEqual(u32(3, 1, 2, 4));
      await algorithms.histogram(bins, f32(0.1), 0, 1);
      expect(bins).toEqual(u32(4, 1, 2, 4));
    });

    it('takes Resident arrays, as a host that keeps its data on the device calls it', async () => {
      const a = resident(x);
      const b = resident(f32(1, 1, 1, 1, 1, 1));
      const out = resident(new Float32Array(6));
      await algorithms.add(out, a, b);
      expect(await out.read()).toEqual(f32(2, -1, 4, -3, 6, 7));
      a.destroy();
      b.destroy();
      out.destroy();
    });
  });
});

describe('the facts of the faces (Rule 11.13)', () => {
  const entry = join(ROOT, 'src/algorithms/index.shade.ts');
  const generated = hostFace(read(entry)!, { fileName: entry, fuse: true, readDocument: read });
  const face = (name: string): KernelFace => {
    const e = generated.exports!.find((x) => x.name === name);
    if (e?.kind !== 'kernel') throw new Error(`${name} is ${e?.kind}`);
    return e.face;
  };
  const call = (name: string, arrays: readonly (object | undefined)[], n: number): GroupCall => ({
    k: face(name),
    arrays,
    range: { start: 0, n },
    tier: 'webgpu',
  });
  const [t, u, v, w, b] = [{}, {}, {}, {}, {}];

  it('fill → add → relu is one dispatch, and the axis reduction after it a group of its own (F3)', () => {
    const groups = groupCalls(
      [
        call('fill', [t, undefined], 12),
        call('add', [u, t, b], 12),
        call('reluMap', [v, u], 12),
        call('sumAxis', [w, v, undefined, undefined], 4),
      ],
      8,
    );
    expect(groups.map((g) => g.calls)).toEqual([[0, 1, 2], [3]]);
    expect(groups[0]!.fused).toBe(true);
    expect(groups[1]!.why).toMatch(/sumAxis/);
  });

  it('a whole reduction joins a chain as its last call (F6)', () => {
    const groups = groupCalls(
      [call('copy', [t, b], 8), call('absMap', [u, t], 8), call('sum', [u], 8)],
      8,
    );
    expect(groups.map((g) => g.calls)).toEqual([[0, 1, 2]]);
    const after = groupCalls([call('sum', [u], 8), call('negMap', [v, u], 8)], 8);
    expect(after.map((g) => g.calls)).toEqual([[0], [1]]);
  });

  it('every map and axis reduction reads and writes at i, so it fuses with a map before it', () => {
    const maps = generated
      .exports!.filter((e) => e.kind === 'kernel')
      .map((e) => e.name)
      .filter(
        (n) =>
          ![
            'sum',
            'maxAll',
            'minAll',
            'inclusiveScan',
            'exclusiveScan',
            'compact',
            'histogram',
          ].includes(n),
      );
    for (const name of maps) {
      const k = face(name);
      const arrays = k.params.map((p, i) => (p.k === 'array' ? (i === 0 ? u : t) : undefined));
      const n = k.params.filter((p) => p.k === 'array').length;
      const groups = groupCalls([call('copy', [t, b], 8), call(name, arrays, 8)], 8);
      // An axis reduction reads its input at another index than i, so it stands apart (F3); a
      // map joins.
      const axis = /Axis$/.test(name);
      expect(groups.length, `${name} with ${n} arrays`).toBe(axis ? 2 : 1);
    }
  });
});
