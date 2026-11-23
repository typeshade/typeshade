// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CpuValue } from './cpu-runtime.js';
import type { GeneratedCpu } from './host-entry.js';
import type { KernelFace } from './host-kernel.js';
import type { KernelMade } from './kernel-made-face.js';
import { nextPushCount, withSaturatingPushes } from './push-count.js';

const calls: { k: KernelFace; array: unknown; n: unknown }[] = [];
let totals: number[] = [];

vi.mock('./host-kernel.js', () => ({
  callKernel: (_cpu: unknown, k: KernelFace, _argc: number, args: unknown[]) => {
    calls.push({ k, array: args[0], n: args[1] });
    return Promise.resolve(totals.shift());
  },
}));

const { callMadeKernel } = await import('./host-kernel-made.js');

function face(gpu: boolean): { k: KernelFace; made: KernelMade; cpu: GeneratedCpu } {
  const made: KernelMade = {
    param: 'out',
    count: 'out_n',
    shown: 'out',
    array: 'u32',
    grown: true,
    counted: true,
    capacity: [{ low: 'f__low', high: 'f__high', inclusive: false, step: 1, pushes: 1 }],
  };
  const k = {
    name: 'f',
    fn: 'f',
    params: [
      { name: 'out', k: 'array' },
      { name: 'out_n', k: 'value' },
    ],
    made,
    ...(gpu ? { gpu: {} } : {}),
  } as unknown as KernelFace;
  const F: Record<string, (...a: CpuValue[]) => CpuValue> = {
    f: () => 0 as CpuValue,
    f__low: () => 0 as CpuValue,
    f__high: () => 5_000_000_000 as CpuValue,
  };
  return { k, made, cpu: { F, $: { bindings: {}, vars: {} } } };
}

beforeEach(() => {
  calls.length = 0;
  totals = [];
});

describe('Route 2, a count pass, in the call of a made array (change 0114, A12 form 2)', () => {
  it('takes Route 2 when the capacity of Route 1 passes the limit, with the exact count', async () => {
    const { k, cpu } = face(false);
    totals = [3, 3];
    const out = (await callMadeKernel(cpu, k, 0, [])) as Uint32Array;
    expect(out).toHaveLength(3);
    expect(calls).toHaveLength(2);
    expect((calls[0]!.array as Uint32Array).length).toBe(1);
    expect(calls[0]!.n).toBe(0);
    expect((calls[1]!.array as Uint32Array).length).toBe(3);
    expect(calls[1]!.n).toBe(3);
  });

  it('takes Route 2 for a function that has a GPU plan, and counts with the count-only face', async () => {
    const { k, cpu } = face(true);
    totals = [3, 3];
    const out = (await callMadeKernel(cpu, k, 0, [])) as Uint32Array;
    expect(out).toHaveLength(3);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.k.gpu?.countOnly).toBe(true);
    expect(calls[1]!.k.gpu?.countOnly).toBeUndefined();
    expect(k.gpu?.countOnly).toBeUndefined();
  });

  it('builds the count-only face once for a face', async () => {
    const { k } = face(true);
    const { counting } = await import('./host-kernel-made/counted.js');
    expect(counting(k)).toBe(counting(k));
    expect(counting(k).gpu?.countOnly).toBe(true);
    const cpuOnly = face(false).k;
    expect(counting(cpuOnly)).toBe(cpuOnly);
  });

  it('stays on Route 1, with one run, when the capacity is within the limit', async () => {
    const { k, cpu } = face(false);
    cpu.F['f__high'] = () => 4 as CpuValue;
    totals = [2];
    const out = (await callMadeKernel(cpu, k, 0, [])) as Uint32Array;
    expect(out).toHaveLength(2);
    expect(calls).toHaveLength(1);
    expect((calls[0]!.array as Uint32Array).length).toBe(4);
  });

  it('throws before the store pass for a total of 4294967295', async () => {
    const { k, cpu } = face(false);
    totals = [4294967295];
    await expect(callMadeKernel(cpu, k, 0, [])).rejects.toThrow(
      /needs room for 4294967295 or more elements, the number its loops push/,
    );
    expect(calls).toHaveLength(1);
  });

  it('throws when the store pass pushes another count than the counting pass', async () => {
    const { k, cpu } = face(false);
    totals = [3, 2];
    await expect(callMadeKernel(cpu, k, 0, [])).rejects.toThrow(
      /the counting pass counted 3 elements/,
    );
    totals = [3, 4];
    await expect(callMadeKernel(cpu, k, 0, [])).rejects.toThrow(
      /the counting pass counted 3 elements/,
    );
  });
});

describe('the push count of a counted function saturates (change 0114, A12 form 2)', () => {
  it('wraps at 2^32 outside the scope and stops at 4294967295 inside it', () => {
    expect(nextPushCount(0xffffffff)).toBe(0);
    expect(withSaturatingPushes(() => nextPushCount(0xffffffff))).toBe(0xffffffff);
    expect(withSaturatingPushes(() => nextPushCount(0xfffffffe))).toBe(0xffffffff);
    expect(nextPushCount(5)).toBe(6);
    expect(() =>
      withSaturatingPushes(() => {
        throw new Error('x');
      }),
    ).toThrow('x');
    expect(nextPushCount(0xffffffff)).toBe(0);
  });
});
