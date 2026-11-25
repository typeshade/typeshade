import { describe, expect, it, vi } from 'vitest';
import { array, createDevice } from '../runtime.js';
import type { FuseScope } from './fuse-plan.js';
import { buildPlan, kernelOf, nameOf, runScope, ScratchState } from './fuse-record.js';
import type { RecordedCall } from './fuse-record.js';
import { fuseSlot, type FuseRecorder } from './fuse-scope.js';
import { callKernel, type KernelFace } from './host-kernel.js';
import type { ComputeEntry, EntryBinding, GeneratedCpu } from './host-entry.js';
import { decide, residentState } from './resident.js';

const stop = new Error('stop');

const inBody = async <T>(body: (scope: FuseScope, recorder: FuseRecorder) => T): Promise<T> => {
  let result!: T;
  await runScope((scope) => {
    result = body(scope, fuseSlot.active!);
    throw stop;
  }).catch((error: unknown) => {
    if (error !== stop) throw error;
  });
  return result;
};

const refusal = (f: () => unknown): unknown => {
  try {
    f();
  } catch (error) {
    return error;
  }
  return undefined;
};

const arrayParam = (name: string, writes: boolean, scalar: 'f32' | 'u32' = 'f32') => ({
  name,
  k: 'array' as const,
  writes,
  s: `array<${scalar}>`,
  layout: { k: 'a' as const, n: null, st: 4, e: { k: 's' as const, t: scalar } },
});

const face = (
  name: string,
  params: ReturnType<typeof arrayParam>[],
  gpu?: KernelFace['gpu'],
): KernelFace => ({
  name,
  fn: name,
  result: { k: 'void', s: 'void' },
  params,
  ...(gpu === undefined ? {} : { gpu }),
});

const copy = face('copy', [arrayParam('out', true), arrayParam('input', false)]);
const pair = face('pair', [arrayParam('a', true), arrayParam('b', true)]);
const pushing = face('pushing', [arrayParam('list', true, 'u32')]);

const cpuOf = (...names: string[]): GeneratedCpu => ({
  F: Object.fromEntries(names.map((n) => [n, () => 0])),
  $: { bindings: {}, vars: {} },
});

const binding = (name: string, writes: boolean, n: number | null): EntryBinding =>
  ({
    name,
    space: 'storage',
    writes,
    s: 'storage',
    layout: { k: 'a', n, st: 4, e: { k: 's', t: 'f32' } },
  }) as unknown as EntryBinding;

const entryOf = (name: string, fn: string, bindings: EntryBinding[]): ComputeEntry =>
  ({ name, fn, bindings }) as unknown as ComputeEntry;

const lent = (states: Map<EntryBinding, never>, indirect?: unknown): unknown => ({
  residentsOf: () => states,
  indirectOf: () => indirect,
});

describe('the plan record of a call that has no WebGPU loop, and of an entry call', () => {
  it('lists no loop for a function that runs on the CPU', () => {
    const plan = buildPlan([
      { k: copy, args: [array(Float32Array.of(0)), array(Float32Array.of(0))] },
    ]);
    expect(plan.calls[0]!.loops).toEqual([]);
  });

  it('names an entry call by its name and its loop by its function', () => {
    const e = entryOf('shown', 'inner', []);
    const plan = buildPlan([{ e, states: new Map() }]);
    expect(plan.calls).toEqual([{ name: 'shown', loops: ['inner'], reads: [], writes: [] }]);
  });

  it('names a recorded call by its kind, and refuses an entry call where a kernel call is due', () => {
    const kernel = { kind: 'kernel', k: copy } as unknown as RecordedCall;
    const entry = { kind: 'entry', e: entryOf('shown', 'inner', []) } as unknown as RecordedCall;
    expect(nameOf(kernel)).toBe('copy');
    expect(nameOf(entry)).toBe('shown');
    expect(kernelOf(kernel)).toBe(kernel);
    expect(() => kernelOf(entry)).toThrow('fuse(): an entry call forms a group of its own (F8).');
  });
});

describe('the handle of a scratch array', () => {
  it('holds its length, and refuses every member that reads or writes the host', async () => {
    const seen = await inBody((scope) => {
      const handle = scope.scratch(5) as unknown as Record<string | symbol, unknown> & {
        needsUpdate: boolean;
      };
      return {
        length: handle.length,
        resize: refusal(() => (handle.resize as (n: number) => void)(1)),
        at: refusal(() => (handle.at as (i: number) => void)(0)),
        read: refusal(() => handle.needsUpdate),
        write: refusal(() => {
          handle.needsUpdate = true;
        }),
        dispose: (handle.dispose as () => unknown)(),
        symbol: (handle[Symbol.dispose] as () => unknown)(),
      };
    });
    const why = ' this is a scratch array, which the host never reads or writes.';
    expect(seen.length).toBe(5);
    expect(seen.resize).toEqual(
      new TypeError(`resize():${why} Make it with array() to use it after the scope.`),
    );
    expect(seen.at).toEqual(
      new TypeError(`at():${why} Make it with array() to use it after the scope.`),
    );
    expect(seen.read).toEqual(
      new TypeError(`needsUpdate:${why} Make it with array() to use it after the scope.`),
    );
    expect(seen.write).toEqual(
      new TypeError(`needsUpdate:${why} Make it with array() to use it after the scope.`),
    );
    expect(seen.dispose).toBeUndefined();
    expect(seen.symbol).toBeUndefined();
  });

  it('counts a vec4f scratch array in vectors and holds four f32 numbers for each', async () => {
    const seen = await inBody((scope) => {
      const vectors = residentState(scope.scratch(2, 'vec4f')) as ScratchState;
      const numbers = residentState(scope.scratch(2, 'u32')) as ScratchState;
      return [vectors, numbers].map((s) => ({
        components: s.components,
        element: s.element,
        length: s.length,
        spelled: s.spelled,
      }));
    });
    expect(seen).toEqual([
      { components: 4, element: 'f32', length: 8, spelled: 'vec4f' },
      { components: 1, element: 'u32', length: 2, spelled: 'u32' },
    ]);
  });
});

describe('the use of a scratch array before its plan runs', () => {
  it('refuses sync() and bufferFor() while the plan has not started', async () => {
    let state!: ScratchState;
    const done = runScope((scope) => {
      state = residentState(scope.scratch(2)) as ScratchState;
    });
    expect(state.phase).toBe('open');
    const outside =
      'This array is a scratch array. Only the kernel calls in the body of the fuse() scope that made it may take it.';
    await expect(state.sync()).rejects.toThrow(new TypeError(outside));
    expect(() =>
      state.bufferFor({} as never, {} as never, () => new ArrayBuffer(0), false),
    ).toThrow(new TypeError(outside));
    await done;
    expect(state.phase).toBe('done');
  });

  it('frees a scratch array once, and the pool of its owner sees one release', () => {
    const state = new ScratchState(2, 'f32', {} as never);
    const releaseScratch = vi.fn(() => true);
    state.ownedBy = { releaseScratch } as never;
    state.release();
    state.release();
    expect(releaseScratch).toHaveBeenCalledTimes(1);
    expect(state.phase).toBe('done');
  });
});

describe('the recorder of a scope', () => {
  const buffers = () => [array(Float32Array.of(0, 0)), array(Float32Array.of(0, 0))] as const;

  it('refuses a kernel call with the wrong number of arguments at the recorder', async () => {
    const [out] = buffers();
    const seen = await inBody((_, recorder) =>
      refusal(() => recorder.kernel(cpuOf('copy'), copy, 1, [out])),
    );
    expect(seen).toEqual(new TypeError('copy() takes 2 arguments; got 1.'));
  });

  it('fixes no open element for a kernel call that it refuses', async () => {
    const open = array([1, 2]);
    const seen = await inBody((_, recorder) =>
      refusal(() => recorder.kernel(cpuOf('pair'), pair, 2, [open, Float32Array.of(1, 2)])),
    );
    expect(String(seen)).toContain('a call inside fuse() writes only a Buffer');
    expect(residentState(open)!.fixed).toBeUndefined();
    expect(residentState(open)!.open).toEqual([1, 2]);
  });

  it('fixes the open element of a call that it takes, and u32 for a held length', async () => {
    const [list, length, out] = [array([1, 2]), array([0]), array([3])];
    await inBody((_, recorder) => {
      void recorder.kernel(cpuOf('pushing'), pushing, 1, [{ array: list, length }]);
      void recorder.kernel(cpuOf('copy'), copy, 2, [out, array(Float32Array.of(1))]);
    });
    expect(residentState(list)!.fixed!.kind).toBe('u32');
    expect(residentState(length)!.fixed!.kind).toBe('u32');
    expect(residentState(out)!.fixed!.kind).toBe('f32');
  });

  it('refuses a held length of another owner, naming the length', async () => {
    const owner = await createDevice({ prefer: ['cpu'] });
    try {
      const [list, length] = [array(new Uint32Array(2)), owner.array(new Uint32Array(1))];
      const seen = await inBody((_, recorder) =>
        refusal(() => recorder.kernel(cpuOf('pushing'), pushing, 1, [{ array: list, length }])),
      );
      expect(String(seen)).toContain('pushing(): "list.length" is a Buffer of');
    } finally {
      await owner.dispose();
    }
  });

  it('marks what a recorded call writes as the device’s as soon as the body returns', async () => {
    const [out, input] = buffers();
    const window =
      'a call wrote this Buffer, and its values are on the device until `await read()` brings them back; await it first.';
    const done = runScope(() => {
      void callKernel(cpuOf('copy'), copy, 2, [out, input]);
    });
    expect(() => out.at(0).get()).toThrow(`at(0).get(): ${window}`);
    expect(input.at(0).get()).toBe(0);
    await done;
  });
});

describe('the recorder of an entry call in a scope', () => {
  const cpu = cpuOf();

  it('refuses a host value that a sized storage binding writes', async () => {
    const out = binding('out', true, 4);
    const e = entryOf('fill', 'fill', [out]);
    const seen = await inBody((_, recorder) =>
      refusal(() =>
        recorder.entry(
          cpu,
          e,
          1,
          { out: Float32Array.of(1) },
          1,
          lent(new Map<EntryBinding, never>()),
        ),
      ),
    );
    expect(String(seen)).toContain(
      'fill(): binding "out" is a Float32Array, and a call inside fuse() writes only a Buffer.',
    );
  });

  it('fixes the open elements of a call that it takes: each binding, and u32 for the count', async () => {
    const [xs, counts] = [array([1, 2]), array([1, 1, 1])];
    const bound = binding('xs', true, null);
    const e = entryOf('fill', 'fill', [bound]);
    await inBody((_, recorder) => {
      const states = new Map([[bound, residentState(xs)!]]) as unknown as Map<EntryBinding, never>;
      void recorder.entry(
        cpu,
        e,
        2,
        { xs },
        { indirect: counts },
        lent(states, residentState(counts)),
      );
    });
    expect(residentState(xs)!.fixed!.kind).toBe('f32');
    expect(residentState(counts)!.fixed!.kind).toBe('u32');
  });

  it('fixes no open element for an entry call whose later binding is refused', async () => {
    const [open, fixed] = [array([1, 2]), array([1, 2])];
    decide(residentState(fixed), 'f32', 'the first use');
    const [first, second] = [binding('open', false, null), binding('keys', false, null)];
    (second.layout as { e: unknown }).e = { k: 's', t: 'u32' };
    const e = entryOf('mix', 'mix', [first, second]);
    const states = new Map([
      [first, residentState(open)!],
      [second, residentState(fixed)!],
    ]) as unknown as Map<EntryBinding, never>;
    const seen = await inBody((_, recorder) =>
      refusal(() => recorder.entry(cpu, e, 1, { open, keys: fixed }, 1, lent(states))),
    );
    expect(String(seen)).toContain('mix(): binding "keys" takes a Buffer of u32');
    expect(residentState(open)!.fixed).toBeUndefined();
    expect(residentState(open)!.open).toEqual([1, 2]);
  });
});

describe('a fuse body nested in the body of a scope', () => {
  it('refuses a body that is no function, in the words of fuse()', async () => {
    const seen = await inBody(() => refusal(() => runScope(5 as never)));
    expect(seen).toEqual(
      new TypeError('fuse(): takes the body of the scope as a function; got number 5.'),
    );
  });

  it('refuses a body that returns a promise of its own, and handles that promise', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const seen = await inBody(() =>
        refusal(() => runScope((() => Promise.reject(new Error('late'))) as never)),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(String(seen)).toContain('fuse(): the body is synchronous, and this one is not.');
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('takes a body that returns the promise of the scope, or a value that is no promise', async () => {
    const report = await runScope((() => runScope(() => undefined)) as never);
    expect(report.groups).toEqual([]);
    await expect(runScope((() => 5) as never)).resolves.toMatchObject({ groups: [] });
  });
});
