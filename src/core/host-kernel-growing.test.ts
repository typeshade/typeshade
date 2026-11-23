import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CpuValue } from './cpu-runtime.js';
import { fuseSlot } from './fuse-scope.js';
import type { GeneratedCpu } from './host-entry.js';
import type { KernelFace } from './host-kernel.js';
import type { KernelMade } from './kernel-made-face.js';
import { markGrowing, MOST_PUSHED, pushedLength, startPushesAt } from './push-count.js';
import { PastGrowth, PUSHED_BUILTINS, pushOnto } from './pushed-index.js';
import { handleOf, ResidentArrayState } from './resident.js';

vi.mock('./host-kernel.js', () => ({
  callKernel: (cpu: GeneratedCpu, k: KernelFace, _argc: number, args: unknown[]) => {
    try {
      const copies = args.map((a) =>
        ArrayBuffer.isView(a) ? Array.from(a as unknown as ArrayLike<number>) : a,
      );
      const result = cpu.F[k.fn]!(...(copies as CpuValue[]));
      k.params.forEach((p, i) => {
        if (p.k !== 'array' || !p.writes) return;
        if (ArrayBuffer.isView(args[i])) (args[i] as Float32Array).set(copies[i] as number[]);
        else (args[i] as unknown[]).splice(0, Infinity, ...(copies[i] as unknown[]));
      });
      return Promise.resolve(result);
    } catch (e) {
      return Promise.reject(e);
    }
  },
}));

const { callMadeKernel } = await import('./host-kernel-made.js');
const { callGrowing, growingRun, materialized } = await import('./host-kernel-made/growing.js');

type Body = (out: CpuValue[], n: CpuValue, xs: CpuValue[], ys: CpuValue[]) => CpuValue;

function face(
  body: Body,
  over: Partial<KernelMade> = {},
): { k: KernelFace; made: KernelMade; cpu: GeneratedCpu } {
  const made: KernelMade = {
    param: 'out',
    count: 'out_n',
    shown: 'out',
    array: 'f32',
    grown: true,
    growing: true,
    ...over,
  };
  const k = {
    name: 'f',
    fn: 'f',
    made,
    params: [
      { name: 'out', k: 'array', writes: true },
      { name: 'out_n', k: 'value' },
      { name: 'xs', k: 'array', writes: false },
      { name: 'ys', k: 'array', writes: true },
    ],
  } as unknown as KernelFace;
  const F = { f: body as unknown as (...a: CpuValue[]) => CpuValue };
  return { k, made, cpu: { F, $: { bindings: {}, vars: {} } } };
}

const doubled: Body = (out, _n, xs) => {
  for (let i = 0; i < xs.length; i++) pushOnto(out, ((xs[i] as number) * 2) as CpuValue);
  return pushedLength(out) as CpuValue;
};

const xs = (...v: number[]): Float32Array => new Float32Array(v);
const call = (f: ReturnType<typeof face>, ...args: unknown[]): Promise<unknown> =>
  callMadeKernel(f.cpu, f.k, args.length, args) as Promise<unknown>;

afterEach(() => {
  fuseSlot.active = undefined;
});

describe('Route 3, the growing store on the CPU tier (change 0114, A12)', () => {
  it('gives the result of Route 1 for a scalar element, across many doublings', async () => {
    const growing = face(doubled);
    const sized = face(doubled, {
      growing: undefined,
      capacity: [{ low: 'a', high: 'b', inclusive: false, step: 1, pushes: 1 }],
    });
    sized.cpu.F['a'] = () => 0 as CpuValue;
    sized.cpu.F['b'] = () => 5000 as CpuValue;
    const input = xs(...Array.from({ length: 5000 }, (_, i) => i));
    const grown = (await call(growing, input, new Float32Array(1))) as Float32Array;
    const bound = (await call(sized, input, new Float32Array(1))) as Float32Array;
    expect(grown).toBeInstanceOf(Float32Array);
    expect(grown).toHaveLength(5000);
    expect(Array.from(grown)).toEqual(Array.from(bound));
  });

  it('pushes in the order of a sequential run, and gives an empty array for no push', async () => {
    const two = face((out, _n, list) => {
      for (let i = 0; i < list.length; i++) {
        pushOnto(out, list[i]!);
        pushOnto(out, ((list[i] as number) + 100) as CpuValue);
      }
      for (let i = 0; i < list.length; i++) pushOnto(out, -(list[i] as number) as CpuValue);
      return pushedLength(out) as CpuValue;
    });
    const out = (await call(two, xs(1, 2), xs(0))) as Float32Array;
    expect(Array.from(out)).toEqual([1, 101, 2, 102, -1, -2]);
    const none = (await call(face(doubled), xs(), xs(0))) as Float32Array;
    expect(none).toHaveLength(0);
    expect(none).toBeInstanceOf(Float32Array);
  });

  it('flattens a vector element, builds struct elements and shares one pushed object', async () => {
    const vec = face(
      (out, _n, list) => {
        list.forEach((v) => pushOnto(out, [v, v, v, 1] as unknown as CpuValue));
        return pushedLength(out) as CpuValue;
      },
      { width: 4 },
    );
    expect(Array.from((await call(vec, xs(2, 3), xs(0))) as Float32Array)).toEqual([
      2, 2, 2, 1, 3, 3, 3, 1,
    ]);
    const struct = { k: 'struct', s: 'P', f: [['a', { k: 'num', t: 'f32', s: 'f32' }]] } as const;
    const made = face(
      (out, _n, list) => {
        list.forEach((v) => pushOnto(out, { a: v } as unknown as CpuValue));
        return pushedLength(out) as CpuValue;
      },
      { struct, zero: { a: 0 } as unknown as CpuValue, array: undefined },
    );
    expect(await call(made, xs(4, 5), xs(0))).toEqual([{ a: 4 }, { a: 5 }]);
    const every = face(
      (out, _n, list) => {
        const one = { a: 9 } as unknown as CpuValue;
        list.forEach(() => pushOnto(out, one));
        return pushedLength(out) as CpuValue;
      },
      { struct, zero: { a: 0 } as unknown as CpuValue, array: undefined, share: 'every' },
    );
    const shared = (await call(every, xs(1, 2, 3), xs(0))) as object[];
    expect(shared).toHaveLength(3);
    expect(shared[1]).toBe(shared[0]);
    expect(shared[2]).toBe(shared[0]);
  });

  it('throws the RangeError at the injected limit, and one element below it passes', async () => {
    const f = face((out, _n, list, ys) => {
      ys[0] = 99 as CpuValue;
      return doubled(out, 0 as CpuValue, list, ys);
    });
    const ys = xs(1, 2, 3);
    const below = await callGrowing(f.cpu, f.k, f.made, [xs(1, 2, 3, 4), ys], undefined, 5);
    expect(Array.from(below as Float32Array)).toEqual([2, 4, 6, 8]);
    expect(Array.from(ys)).toEqual([99, 2, 3]);
    const kept = xs(1, 2, 3);
    const e = await callGrowing(f.cpu, f.k, f.made, [xs(1, 2, 3, 4, 5), kept], undefined, 5).catch(
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(RangeError);
    expect((e as Error).message).toBe(
      'f(): the array it grows with push, "out", needs room for 5 or more elements, the number its ' +
        'loops push, and a length past 4 is not supported yet.',
    );
    expect(Array.from(kept)).toEqual([1, 2, 3]);
  });

  it('turns the marked failure of push and of pushedStoreAt into that sentence', async () => {
    const stored = face((out) => {
      pushOnto(out, 1 as CpuValue);
      pushOnto(out, 2 as CpuValue);
      const at = PUSHED_BUILTINS['pushedStoreAt']!(
        out as unknown as CpuValue,
        2 as CpuValue,
        0 as CpuValue,
      );
      out[Number(at)] = 3 as CpuValue;
      return pushedLength(out) as CpuValue;
    });
    const e = await callGrowing(
      stored.cpu,
      stored.k,
      stored.made,
      [xs(0), xs(0)],
      undefined,
      3,
    ).catch((x: unknown) => x);
    expect((e as Error).message).toMatch(/needs room for 3 or more elements.*past 2 is not/);
  });

  it('passes a RangeError of the program itself on unchanged', async () => {
    const own = face((out) => {
      pushOnto(out, 1 as CpuValue);
      throw new RangeError('mine');
    });
    const e = await call(own, xs(0), xs(0)).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RangeError);
    expect(e).not.toBeInstanceOf(PastGrowth);
    expect((e as Error).message).toBe('mine');
  });

  it('appends at the length with pushedStoreAt, and refuses a read past it with the Q1 (C) sentence', async () => {
    const f = face(
      (out) => {
        pushOnto(out, 1 as CpuValue);
        pushOnto(out, 2 as CpuValue);
        const at = PUSHED_BUILTINS['pushedStoreAt']!(
          out as unknown as CpuValue,
          2 as CpuValue,
          0 as CpuValue,
        );
        out[Number(at)] = 7 as CpuValue;
        return pushedLength(out) as CpuValue;
      },
      { checks: [{ text: 'out[2] = 7', write: true }] },
    );
    expect(Array.from((await call(f, xs(0), xs(0))) as Float32Array)).toEqual([1, 2, 7]);
    const read = face(
      (out) => {
        pushOnto(out, 1 as CpuValue);
        PUSHED_BUILTINS['pushedReadAt']!(out as unknown as CpuValue, 5 as CpuValue, 0 as CpuValue);
        return 1 as CpuValue;
      },
      { checks: [{ text: 'out[5]', write: false }] },
    );
    const e = await call(read, xs(0), xs(0)).catch((x: unknown) => x);
    expect((e as Error).message).toBe(
      'f(): "out[5]" reads index 5 of "out", whose length is 1 there. A read past the length is not supported yet.',
    );
  });

  it('keeps the store as long as its count, also for an early return, and rejects a wrong count', async () => {
    const early = face((out, _n, list) => {
      for (let i = 0; i < list.length; i++) {
        pushOnto(out, list[i]!);
        if (i === 1) return pushedLength(out) as CpuValue;
      }
      return pushedLength(out) as CpuValue;
    });
    expect(Array.from((await call(early, xs(5, 6, 7), xs(0))) as Float32Array)).toEqual([5, 6]);
    const wrong = face((out) => {
      pushOnto(out, 1 as CpuValue);
      return 7 as CpuValue;
    });
    await expect(call(wrong, xs(0), xs(0))).rejects.toThrow(
      /reports 7 elements pushed and holds 1/,
    );
    const run = growingRun(early.cpu, early.k, early.made);
    expect(run.store).toHaveLength(0);
    expect(pushedLength(run.store)).toBe(0);
  });

  it('never stores at index 4294967295', () => {
    const writes: string[] = [];
    const stub = new Proxy([] as CpuValue[], {
      set: (_t, key) => {
        writes.push(String(key));
        return true;
      },
    });
    markGrowing(stub);
    startPushesAt(stub, MOST_PUSHED - 2);
    pushOnto(stub, 1 as CpuValue);
    expect(writes).toEqual(['4294967293']);
    expect(pushedLength(stub)).toBe(MOST_PUSHED - 1);
    expect(() => pushOnto(stub, 1 as CpuValue)).toThrow(PastGrowth);
    expect(writes).toEqual(['4294967293']);
    expect(pushedLength(stub)).toBe(MOST_PUSHED - 1);
  });

  it('takes the fuse() refusal and the resource refusal of a made array', async () => {
    const f = face(doubled);
    fuseSlot.active = {} as never;
    expect(() => call(f, xs(1), xs(0))).toThrow(/inside fuse\(\)/);
    fuseSlot.active = undefined;
    const resident = handleOf(new ResidentArrayState(new Float32Array(3)));
    expect(() => callMadeKernel(f.cpu, f.k, 2, [resident, resident])).toThrow(
      /whose length is the number of elements it pushes, known after the run, and a call of it on a resource/,
    );
  });

  it('keeps one store for each call when two calls are in flight', async () => {
    const f = face(doubled);
    const [a, b] = (await Promise.all([
      call(f, xs(1, 2, 3), xs(0)),
      call(f, xs(10), xs(0)),
    ])) as Float32Array[];
    expect(Array.from(a!)).toEqual([2, 4, 6]);
    expect(Array.from(b!)).toEqual([20]);
  });

  it('writes a second plain array back on success and leaves it on a throw', async () => {
    const f = face((out, _n, list, ys) => {
      ys[1] = 42 as CpuValue;
      return doubled(out, 0 as CpuValue, list, ys);
    });
    const ok = xs(1, 2);
    await call(f, xs(3), ok);
    expect(Array.from(ok)).toEqual([1, 42]);
    const bad = xs(1, 2);
    await expect(callGrowing(f.cpu, f.k, f.made, [xs(1, 2), bad], undefined, 2)).rejects.toThrow(
      RangeError,
    );
    expect(Array.from(bad)).toEqual([1, 2]);
  });

  it('turns a failed allocation of the result into the same sentence', () => {
    const f = face(doubled, { width: 2 ** 40 });
    const store = [[0]] as unknown as CpuValue[];
    startPushesAt(store, 1);
    expect(() => materialized(f.k, f.made, store, 1)).toThrow(
      'f(): the array it grows with push, "out", needs room for 1 elements, the number its loops ' +
        'push, and a length past what one Float32Array holds on this host is not supported yet.',
    );
  });
});
