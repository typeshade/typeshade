// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './host-face.js';
import { bothHalves, bothTake } from '../../core/testing/both-halves.js';
import type { CpuValue } from '../../core/cpu-runtime.js';
import type { GeneratedCpu } from '../../core/host-entry.js';
import type { KernelFace } from '../../core/host-kernel.js';
import { madeOf, type KernelMade } from '../../core/kernel-made-face.js';
import {
  checkedCapacity,
  exactCapacity,
  MOST_PUSHED,
} from '../../core/host-kernel-made/capacity.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Call = (...a: unknown[]) => Promise<unknown>;

const NESTS = `"use typeshade";
export function square(n: u32, m: u32): u32[] {
  const out: u32[] = [];
  for (let i: u32 = 0; i < n; i++) {
    out.push(i);
    for (let j: u32 = 0; j < m; j++) {
      out.push(i * 100 + j);
    }
  }
  return out;
}
export function inner(n: u32, m: u32): u32[] {
  const out: u32[] = [];
  for (let i: u32 = 0; i < n; i++) {
    for (let j: u32 = 0; j < m; j++) {
      out.push(j);
    }
  }
  return out;
}
export function deep(n: u32, m: u32, k: u32): u32[] {
  const out: u32[] = [];
  for (let i: u32 = 0; i < n; i++) {
    for (let j: u32 = 0; j < m; j++) {
      out.push(j);
      for (let q: u32 = 0; q < k; q++) {
        out.push(q);
      }
    }
  }
  return out;
}
export function pairs(xs: f32[], ys: f32[]): f32[] {
  const out: f32[] = [];
  for (const x of xs) {
    for (const y of ys) {
      if (x < y) {
        out.push(x + y);
      }
    }
  }
  return out;
}
export function downward(n: i32, lo: i32): i32[] {
  const out: i32[] = [];
  for (let i: i32 = n; i >= lo; i -= 2) {
    for (let j: i32 = n; j > lo; j -= 3) {
      out.push(j);
    }
  }
  return out;
}
`;

const BRANCHES = `"use typeshade";
export function chosen(h: i32, n: u32): u32[] {
  const out: u32[] = [];
  if (h > 0) {
    for (let i: u32 = 0; i < n; i++) {
      out.push(i);
    }
  } else if (h < 0) {
    for (let i: u32 = 0; i < n; i++) {
      out.push(i + 1);
      out.push(i);
    }
  } else {
    for (let i: u32 = 0; i < 2; i++) {
      out.push(7);
    }
  }
  return out;
}
export function guarded(n: u32, m: u32): u32[] {
  const out: u32[] = [];
  const small = n < 100;
  if (small && m > 0) {
    for (let i: u32 = 0; i < n; i++) {
      for (let j: u32 = 0; j < m; j++) {
        out.push(i);
      }
    }
  }
  return out;
}
`;

const SOURCE = NESTS + BRANCHES.replace('"use typeshade";\n', '');

function kernels(): Map<string, KernelFace> {
  const f = hostFace(SOURCE, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const all = new Map<string, KernelFace>();
  for (const e of f.exports ?? []) if ('face' in e) all.set(e.name, e.face as KernelFace);
  return all;
}

async function load(): Promise<Record<string, Call>> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-grown-nest-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, hostFace(SOURCE, { fileName: '/app/m.shade.ts', runtime: RUNTIME }).code!);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, Call>;
}

type Header = (...a: number[]) => number | boolean;

function headers(made: KernelMade, fns: Record<string, Header>): GeneratedCpu {
  const prefix = made.capacity![0]!.low.split('__')[0]!;
  const F: Record<string, (...a: CpuValue[]) => CpuValue> = {};
  for (const [key, fn] of Object.entries(fns))
    F[`${prefix}__${key}`] = (...a) => fn(...(a as number[])) as CpuValue;
  return { F, $: { bindings: {}, vars: {} } };
}

const pastLimit = (fn: string, capacity: number | bigint): RangeError =>
  new RangeError(
    `${fn}(): the array it grows with push, "out", needs room for ${String(capacity)} ` +
      `elements, the most its loops can push, and a length past 4294967295 is not supported yet.`,
  );

const u32s = async (call: Promise<unknown>): Promise<number[]> => [
  ...((await call) as Uint32Array),
];

describe('a push in a nested loop or under a top-level branch (change 0114, A12 form 2, Route 1)', () => {
  it('is a program both halves take, a nest with no diagnostic', () => {
    bothTake(NESTS);
  });

  it('gives a loop under a branch the TS8070 warning of its parameter form, in both halves', () => {
    const halves = bothHalves(BRANCHES);
    expect(halves.compiler).toEqual([]);
    const warning = (line: number): string =>
      `typeshade TS8070: This function runs on the CPU because line ${String(line)} is neither a ` +
      `loop nor a statement that computes a value. A kernel function's body is scalar ` +
      `statements, then its loops, then stores into its arrays and a return: move that line ` +
      `into a loop, after the last loop, or into the code that calls the function.`;
    const warned = halves.result.diagnostics.map((d) => `typeshade ${d.code}: ${d.message}`);
    expect(warned).toEqual([warning(4), warning(23)]);
    expect(halves.editor).toEqual(warned);
  });

  it('runs a counted nest on the GPU, as its array parameter form does, and a branch on the CPU', () => {
    const k = kernels();
    for (const name of ['square', 'inner', 'deep', 'pairs', 'downward']) {
      expect(k.get(name)).toHaveProperty('gpu');
      expect(k.get(name)).not.toHaveProperty('noGpu');
    }
    for (const name of ['chosen', 'guarded']) expect(k.get(name)).toHaveProperty('noGpu');
  });

  it('records one term for each push depth, with the loops around it and the branch guard', () => {
    const k = kernels();
    const loop = (name: string, tag: string): object => ({
      low: `${name}__low${tag}`,
      high: `${name}__high${tag}`,
      inclusive: false,
      step: 1,
    });
    expect(madeOf(k.get('square')!)!.capacity).toEqual([
      { ...loop('square', '0'), pushes: 1 },
      { ...loop('square', '1'), pushes: 1, inner: [loop('square', '1_0')] },
    ]);
    expect(madeOf(k.get('deep')!)!.capacity).toEqual([
      { ...loop('deep', '0'), pushes: 1, inner: [loop('deep', '0_0')] },
      { ...loop('deep', '1'), pushes: 1, inner: [loop('deep', '1_0'), loop('deep', '1_1')] },
    ]);
    expect(madeOf(k.get('chosen')!)!.capacity?.map((t) => [t.pushes, t.when])).toEqual([
      [1, 'chosen__when0'],
      [2, 'chosen__when1'],
      [1, 'chosen__when2'],
    ]);
  });

  it('sums every push at every depth, exactly, with no u32 wrap', () => {
    const k = kernels();
    const square = madeOf(k.get('square')!)!;
    const sq = headers(square, {
      low0: () => 0,
      high0: (n) => n,
      low1: () => 0,
      high1: (n) => n,
      low1_0: () => 0,
      high1_0: (_n, m) => m,
    });
    expect(exactCapacity(sq, square, [3, 4] as CpuValue[])).toBe(3 + 3 * 4);
    expect(exactCapacity(sq, square, [0, 4] as CpuValue[])).toBe(0);
    expect(exactCapacity(sq, square, [3, 0] as CpuValue[])).toBe(3);
    const inner = madeOf(k.get('inner')!)!;
    const nest = headers(inner, {
      low0: () => 0,
      high0: (n) => n,
      low0_0: () => 0,
      high0_0: (_n, m) => m,
    });
    const at = exactCapacity(nest, inner, [65537, 65535] as CpuValue[]);
    expect(at).toBe(MOST_PUSHED);
    expect(checkedCapacity(k.get('inner')!, inner, at)).toBe(MOST_PUSHED);
    const past = exactCapacity(nest, inner, [65536, 65536] as CpuValue[]);
    expect(past).toBe(MOST_PUSHED + 1);
    expect(() => checkedCapacity(k.get('inner')!, inner, past)).toThrow(pastLimit('inner', past));
    const huge = exactCapacity(nest, inner, [2 ** 32 - 1, 2 ** 32 - 1] as CpuValue[]);
    expect(huge).toBe((2n ** 32n - 1n) ** 2n);
    expect(() => checkedCapacity(k.get('inner')!, inner, huge)).toThrow(
      `needs room for ${String(huge)} elements`,
    );
  });

  it('counts a loop under a branch only when the host finds the branch taken', () => {
    const k = kernels();
    const made = madeOf(k.get('chosen')!)!;
    const cpu = headers(made, {
      low0: () => 0,
      high0: (_h, n) => n,
      when0: (h) => h > 0,
      low1: () => 0,
      high1: (_h, n) => n,
      when1: (h) => !(h > 0) && h < 0,
      low2: () => 0,
      high2: () => 2,
      when2: (h) => !(h > 0) && !(h < 0),
    });
    expect(exactCapacity(cpu, made, [1, 5] as CpuValue[])).toBe(5);
    expect(exactCapacity(cpu, made, [-1, 5] as CpuValue[])).toBe(10);
    expect(exactCapacity(cpu, made, [0, 5] as CpuValue[])).toBe(2);
  });

  it('refuses a capacity of a nest past 4294967295 at the limit of Route 1', () => {
    const k = kernels();
    const refused = (name: string, highs: number[][], capacity: number, counted?: true): void => {
      const face = k.get(name)!;
      const made = madeOf(face)!;
      const F: Record<string, (...a: CpuValue[]) => CpuValue> = {};
      made.capacity!.forEach((term, t) => {
        F[term.low] = () => 0 as CpuValue;
        F[term.high] = () => highs[t]![0]! as CpuValue;
        (term.inner ?? []).forEach((l, n) => {
          F[l.low] = () => 0 as CpuValue;
          F[l.high] = () => highs[t]![n + 1]! as CpuValue;
        });
        if (term.when !== undefined) F[term.when] = () => true as CpuValue;
      });
      const cpu: GeneratedCpu = { F, $: { bindings: {}, vars: {} } };
      const room = exactCapacity(cpu, made, []);
      expect(room).toBe(capacity);
      expect(() => checkedCapacity(face, made, room)).toThrow(pastLimit(name, capacity));
      expect(made.counted).toBe(counted);
    };
    refused('inner', [[65536, 65536]], 2 ** 32, true);
    refused(
      'deep',
      [
        [2048, 2048],
        [2048, 2048, 2048],
      ],
      2048 * 2048 * 2048 + 2048 * 2048,
      true,
    );
    refused('square', [[65536], [65536, 65535]], 65536 + 65536 * 65535, true);
    refused('guarded', [[3, 2 ** 31]], 3 * 2 ** 31);
  });

  it('throws the RangeError of Route 1 at the call for a nest that is not counted', async () => {
    const m = await load();
    await expect(m['guarded']!(3, 2 ** 31)).rejects.toThrow(pastLimit('guarded', 3 * 2 ** 31));
  });

  it('does not run a header the program never runs: a branch not taken throws nothing', async () => {
    const m = await load();
    expect(await u32s(m['guarded']!(200, 2 ** 31))).toEqual([]);
    expect(await u32s(m['guarded']!(3, 0))).toEqual([]);
  });

  it('keeps every element in the order of a sequential run on the CPU tier', async () => {
    const m = await load();
    const square: number[] = [];
    for (let i = 0; i < 3; i++) {
      square.push(i);
      for (let j = 0; j < 2; j++) square.push(i * 100 + j);
    }
    expect(await u32s(m['square']!(3, 2))).toEqual(square);
    expect(await u32s(m['square']!(0, 2))).toEqual([]);
    expect(await u32s(m['square']!(2, 0))).toEqual([0, 1]);
    expect(await u32s(m['inner']!(2, 3))).toEqual([0, 1, 2, 0, 1, 2]);
    const deep: number[] = [];
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 3; j++) {
        deep.push(j);
        for (let q = 0; q < 2; q++) deep.push(q);
      }
    expect(await u32s(m['deep']!(2, 3, 2))).toEqual(deep);
    const xs = new Float32Array([1, 5, 2]);
    const ys = new Float32Array([2, 4]);
    const pairs: number[] = [];
    for (const x of xs) for (const y of ys) if (x < y) pairs.push(Math.fround(x + y));
    expect([...((await m['pairs']!(xs, ys)) as Float32Array)]).toEqual(pairs);
    const down: number[] = [];
    for (let i = 7; i >= -2; i -= 2) for (let j = 7; j > -2; j -= 3) down.push(j);
    expect([...((await m['downward']!(7, -2)) as Int32Array)]).toEqual(down);
    expect(await u32s(m['chosen']!(1, 3))).toEqual([0, 1, 2]);
    expect(await u32s(m['chosen']!(-1, 2))).toEqual([1, 0, 2, 1]);
    expect(await u32s(m['chosen']!(0, 9))).toEqual([7, 7]);
    expect(await u32s(m['guarded']!(2, 2))).toEqual([0, 0, 1, 1]);
  });
});
