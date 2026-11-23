// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './host-face.js';
import { bothTake } from '../../core/testing/both-halves.js';
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

const SOURCE = `"use typeshade";
const K = 2;
export function twice(n: u32): u32[] {
  const out: u32[] = [];
  for (let i: u32 = 0; i < n; i++) {
    out.push(i);
    out.push(i + 100);
  }
  return out;
}
export function spread(m: i32, lo: i32): i32[] {
  const out: i32[] = [];
  for (let j: i32 = m; j > lo; j -= 3) {
    out.push(j);
    if (j % 2 == 0) {
      out.push(-j);
    }
    out.push(j + 1);
    out.push(j + 2);
  }
  return out;
}
export function twoLoops(n: u32, m: i32): f32[] {
  const out: f32[] = [];
  for (let i: u32 = 0; i < n + K; i++) {
    out.push(f32(i));
  }
  for (let j: i32 = 0; j <= m; j++) {
    out.push(f32(j));
  }
  return out;
}
`;

function kernels(): Map<string, KernelFace> {
  const f = hostFace(SOURCE, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const all = new Map<string, KernelFace>();
  for (const e of f.exports ?? []) if ('face' in e) all.set(e.name, e.face as KernelFace);
  return all;
}

async function load(): Promise<Record<string, Call>> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-grown-capacity-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, hostFace(SOURCE, { fileName: '/app/m.shade.ts', runtime: RUNTIME }).code!);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, Call>;
}

function bounds(made: KernelMade, read: ((...a: number[]) => number)[][]): GeneratedCpu {
  const F: Record<string, (...a: CpuValue[]) => CpuValue> = {};
  made.capacity!.forEach((term, i) => {
    F[term.low] = (...a) => read[i]![0]!(...(a as number[])) as CpuValue;
    F[term.high] = (...a) => read[i]![1]!(...(a as number[])) as CpuValue;
  });
  return { F, $: { bindings: {}, vars: {} } };
}

const pastLimit = (fn: string, capacity: number | bigint): RangeError =>
  new RangeError(
    `${fn}(): the array it grows with push, "out", needs room for ${String(capacity)} ` +
      `elements, the most its loops can push, and a length past 4294967295 is not supported yet.`,
  );

describe('the capacity of an array a kernel function grows with push (change 0114, A6 item 2)', () => {
  it('is a program both halves take', () => {
    bothTake(SOURCE);
  });

  it('is exact past 2^32, with no u32 wrap, from the trip counts the compiler records', () => {
    const k = kernels();
    const twice = madeOf(k.get('twice')!)!;
    expect(twice.capacity).toEqual([
      { low: 'twice__low0', high: 'twice__high0', inclusive: false, step: 1, pushes: 2 },
    ]);
    const n = (n: number): CpuValue[] => [n as CpuValue];
    const cpu = bounds(twice, [[() => 0, (x) => x]]);
    expect(exactCapacity(cpu, twice, n(2 ** 31))).toBe(2 ** 32);
    expect(exactCapacity(cpu, twice, n(2 ** 31 - 1))).toBe(2 ** 32 - 2);
    expect(exactCapacity(cpu, twice, n(2 ** 32 - 1))).toBe(2 ** 33 - 2);
    const spread = madeOf(k.get('spread')!)!;
    expect(spread.capacity).toEqual([
      { low: 'spread__low0', high: 'spread__high0', inclusive: false, step: 3, pushes: 4 },
    ]);
    const signed = bounds(spread, [[(_m, lo) => lo, (m) => m]]);
    expect(exactCapacity(signed, spread, [2 ** 31 - 1, -(2 ** 31)] as CpuValue[])).toBe(
      4 * Math.ceil((2 ** 32 - 1) / 3),
    );
    expect(exactCapacity(signed, spread, [5, 7] as CpuValue[])).toBe(0);
  });

  it('passes a capacity at the limit and refuses one past it', () => {
    const k = kernels();
    const face = k.get('twoLoops')!;
    const made = madeOf(face)!;
    expect(made.capacity?.map((t) => [t.inclusive, t.pushes])).toEqual([
      [false, 1],
      [true, 1],
    ]);
    const cpu = bounds(made, [
      [() => 0, (n) => n],
      [() => 0, (_n, m) => m],
    ]);
    const at = exactCapacity(cpu, made, [MOST_PUSHED - 1, 0] as CpuValue[]);
    expect(at).toBe(MOST_PUSHED);
    expect(checkedCapacity(face, made, at)).toBe(MOST_PUSHED);
    const past = exactCapacity(cpu, made, [MOST_PUSHED - 1, 1] as CpuValue[]);
    expect(past).toBe(MOST_PUSHED + 1);
    expect(() => checkedCapacity(face, made, past)).toThrow(pastLimit('twoLoops', past));
    expect(made.counted).toBe(true);
  });

  it('refuses a capacity past 4294967295 at the limit of Route 1', () => {
    const k = kernels();
    const twice = madeOf(k.get('twice')!)!;
    const cpu = bounds(twice, [[() => 0, (x) => x]]);
    for (const [n, capacity] of [
      [2 ** 31, 2 ** 32],
      [2 ** 32 - 1, 2 ** 33 - 2],
    ] as const) {
      const room = exactCapacity(cpu, twice, [n as CpuValue]);
      expect(room).toBe(capacity);
      expect(twice.counted).toBe(true);
      expect(() => checkedCapacity(k.get('twice')!, twice, room)).toThrow(
        pastLimit('twice', capacity),
      );
    }
    const spread = madeOf(k.get('spread')!)!;
    const signed = bounds(spread, [[(_m, lo) => lo, (m) => m]]);
    const room = exactCapacity(signed, spread, [2 ** 31 - 1, -(2 ** 31)] as CpuValue[]);
    expect(() => checkedCapacity(k.get('spread')!, spread, room)).toThrow(
      pastLimit('spread', 4 * Math.ceil((2 ** 32 - 1) / 3)),
    );
  });

  it('still keeps every element a small run pushes, in order', async () => {
    const m = await load();
    expect([...((await m['twice']!(3)) as Uint32Array)]).toEqual([0, 100, 1, 101, 2, 102]);
    const want: number[] = [];
    for (let j = 10; j > -3; j -= 3) {
      want.push(j);
      if (j % 2 === 0) want.push(-j);
      want.push(j + 1, j + 2);
    }
    expect([...((await m['spread']!(10, -3)) as Int32Array)]).toEqual(want);
    expect([...((await m['twoLoops']!(1, 2)) as Float32Array)]).toEqual([0, 1, 2, 0, 1, 2]);
  });
});
