import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adopt, kernelQueue, ResidentArrayState, residentState } from '../core/resident.js';
import { CallWords } from './program.js';
import { array } from '../runtime.js';
import { bits, dispatched, lastArgs, setup } from './gl-compute-host-harness.js';
import type { Frame } from './runtime.js';
import { compile } from '../compiler/ts/compile.js';
import { packModule } from '../compiler/ts/pack.js';

const compiled = (source: string) => {
  const r = compile(source);
  if (r.diagnostics.some((d) => d.category === 'error')) throw new Error('does not compile');
  return packModule(r.module!, { console: false });
};

const SCALE = compiled(`"use typeshade";
class Cfg { k: f32; }
declare const cfg: uniform<Cfg>;
declare const xs: storage<array<f32>, "read">;
declare const out: storage<array<f32>, "read_write">;
@compute([4]) export function main(gid: builtin<"global_invocation_id">) {
  out[gid.x] = xs[gid.x] * cfg.k;
}
`);
const TOTAL = compiled(`"use typeshade";
declare const total: storage<f32, "read_write">;
@compute([1]) export function main(gid: builtin<"global_invocation_id">) {
  total = 1.;
}
`);
const ODD_STRIDE = {
  ...SCALE,
  bindings: SCALE.bindings.map((b) =>
    b.name === 'xs' && b.layout?.kind === 'array'
      ? { ...b, layout: { ...b.layout, stride: 3 } }
      : b,
  ),
};

vi.mock('../core/gl-compute.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/gl-compute.js')>()),
  runGlCompute: vi.fn(async () => undefined),
}));

type Recording = Frame & {
  record(run: () => Promise<void> | void, written: readonly ResidentArrayState[]): void;
};
const recording = (f: Frame) => f as Recording;
const report = { passes: 1, barrierPhases: 0 };

beforeEach(() => dispatched.mockClear());

describe('a compute dispatch on the WebGL2 tier hands the executor what it was given', () => {
  it('runs the executor on the runtime context with the entry pass program and the workgroups', async () => {
    const { gl, rt, pipeline } = await setup(SCALE);
    const f = rt.frame();
    f.dispatch(pipeline, { cfg: { k: 2 }, xs: new Float32Array(4), out: new Float32Array(4) }, 3);
    expect(dispatched).not.toHaveBeenCalled();
    await f.submit();
    expect(dispatched).toHaveBeenCalledTimes(1);
    expect(dispatched.mock.calls[0]![0]).toBe(gl);
    expect(dispatched.mock.calls[0]![1].entry).toBe('main');
    expect(lastArgs().workgroups).toEqual([3, 1, 1]);
  });

  it('packs a plain value when the dispatch is recorded, and a uniform as a copy', async () => {
    const { rt, pipeline } = await setup(SCALE);
    const xs = new Float32Array([1, 2]);
    const cfg = { k: 2 };
    const f = rt.frame();
    f.dispatch(pipeline, { cfg, xs, out: new Float32Array(2) }, 1);
    xs[0] = 9;
    cfg.k = 7;
    await f.submit();
    expect(lastArgs().memory['xs']).toEqual(bits([1, 2]));
    expect(lastArgs().uniforms?.['cfg']).toEqual({ k: 2 });
  });

  it('runs on a copy of a packed value and on the very words of the call layer', async () => {
    const { rt, pipeline } = await setup(SCALE);
    const words = new Uint32Array(2);
    const f = rt.frame();
    f.dispatch(
      pipeline,
      { cfg: { k: 1 }, xs: new CallWords(words) as never, out: new Float32Array(2) },
      1,
    );
    await f.submit();
    expect(lastArgs().memory['xs']).toBe(words);
    expect(lastArgs().memory['out']).toEqual(new Uint32Array(2));
    expect(lastArgs().memory['out']).not.toBe(words);
  });

  it('reads nothing back into a plain value, and writes back into a Buffer only what the dispatch wrote', async () => {
    const { rt, pipeline } = await setup(SCALE);
    dispatched.mockImplementationOnce(async (_gl, _program, args) => {
      args.memory['out']!.set(bits([5, 6]));
      args.memory['xs']!.set(bits([7, 8]));
      return report;
    });
    const plain = new Float32Array(2);
    const xs = array(new Float32Array([1, 2]));
    const out = array(new Float32Array(2));
    const before = residentState(out)!.version;
    const f = rt.frame();
    f.dispatch(pipeline, { cfg: { k: 1 }, xs, out }, 1);
    await f.submit();
    expect(residentState(out)!.version).toBe(before + 2);
    expect(await out.read()).toEqual(new Float32Array([5, 6]));
    expect(await xs.read()).toEqual(new Float32Array([1, 2]));
    dispatched.mockImplementationOnce(async (_gl, _program, args) => {
      args.memory['out']!.set(bits([5, 6]));
      return report;
    });
    const g = rt.frame();
    g.dispatch(pipeline, { cfg: { k: 1 }, xs: new Float32Array(2), out: plain }, 1);
    await g.submit();
    expect(plain).toEqual(new Float32Array(2));
  });
});

describe('a scalar and an odd-sized array on the WebGL2 tier', () => {
  it('writes back into a scalar Buffer the word the dispatch wrote', async () => {
    const { rt, pipeline } = await setup(TOTAL);
    dispatched.mockImplementationOnce(async (_gl, _program, args) => {
      args.memory['total']!.set(bits([6]));
      return report;
    });
    const total = {};
    adopt(total, new ResidentArrayState(0));
    const f = rt.frame();
    f.dispatch(pipeline, { total } as never, 1);
    await f.submit();
    expect(residentState(total)!.host).toBe(6);
  });

  it('rounds the packed size of an odd byte count up to whole words', async () => {
    const { rt, pipeline } = await setup(ODD_STRIDE);
    const f = rt.frame();
    f.dispatch(
      pipeline,
      { cfg: { k: 1 }, xs: new Float32Array([1.5]), out: new Float32Array(1) },
      1,
    );
    await f.submit();
    expect(lastArgs().memory['xs']).toEqual(bits([1.5]));
  });
});

describe('a frame on the WebGL2 tier runs in the order of the queue', () => {
  const held = () => {
    let release!: () => void;
    const open = new Promise<void>((resolve) => (release = resolve));
    void kernelQueue.run(() => open);
    return release;
  };
  const settles = (p: Promise<unknown>) =>
    Promise.race([p.then(() => 'settled'), new Promise((r) => setTimeout(() => r('waiting'), 20))]);

  it('submits behind every call made before it, and runs frames in order', async () => {
    const { rt } = await setup(SCALE);
    const order: number[] = [];
    const release = held();
    const first = recording(rt.frame());
    first.record(() => void order.push(1), []);
    const second = recording(rt.frame());
    second.record(() => void order.push(2), []);
    const done = [first.submit(), second.submit()];
    expect(await settles(Promise.all(done))).toBe('waiting');
    expect(order).toEqual([]);
    release();
    await Promise.all(done);
    expect(order).toEqual([1, 2]);
  });

  it('runs the records of a frame one after the other, in the order they were recorded', async () => {
    const { rt } = await setup(SCALE);
    const slow = (n: number, order: number[]) => async () => {
      await new Promise((r) => setTimeout(r, 10 - n * 4));
      order.push(n);
    };
    const queued: number[] = [];
    const f = recording(rt.frame());
    f.record(slow(1, queued), []);
    f.record(slow(2, queued), []);
    await f.submit();
    const now: number[] = [];
    await rt.runFrame((frame) => {
      const g = recording(frame);
      g.record(slow(1, now), []);
      g.record(slow(2, now), []);
    });
    expect([queued, now]).toEqual([
      [1, 2],
      [1, 2],
    ]);
  });

  it('runs runFrame and runPass now, outside the queue', async () => {
    const { rt, calls } = await setup(SCALE);
    const release = held();
    const ran = vi.fn();
    expect(await settles(rt.runFrame((f) => recording(f).record(ran, [])))).toBe('settled');
    expect(ran).toHaveBeenCalledTimes(1);
    const target = rt.texture({ size: [2, 2], format: 'rgba8unorm' });
    calls.length = 0;
    const pass = rt.runPass({ color: [target] }, () => {});
    expect(calls.some((c) => c.startsWith('bindFramebuffer('))).toBe(true);
    expect(await settles(pass)).toBe('settled');
    release();
  });

  it('leaves the error of a failed frame on what it wrote, for read() to throw, and clears it after a good one', async () => {
    const { rt, pipeline } = await setup(SCALE);
    const out = array(new Float32Array(2));
    const xs = array(new Float32Array([3, 4]));
    dispatched.mockImplementationOnce(async () => {
      throw new Error('lost');
    });
    const f = rt.frame();
    f.dispatch(pipeline, { cfg: { k: 1 }, xs, out }, 1);
    void f.submit().catch(() => undefined);
    await expect(out.read()).rejects.toThrow('lost');
    expect(await xs.read()).toEqual(new Float32Array([3, 4]));
    const g = rt.frame();
    g.dispatch(pipeline, { cfg: { k: 1 }, xs: new Float32Array(2), out }, 1);
    await g.submit();
    expect(await out.read()).toEqual(new Float32Array(2));
  });
});

describe('a refused dispatch on the WebGL2 tier fixes no element of a Buffer', () => {
  it('leaves an open Buffer open when a later binding is refused, and fixes its scalar when taken', async () => {
    const { rt, pipeline } = await setup(SCALE);
    const xs = array([1, 2, 3, 4]);
    const out = array(4, 'f32');
    out.dispose();
    expect(() => rt.frame().dispatch(pipeline, { cfg: { k: 1 }, xs, out }, 1)).toThrow(
      'This Buffer was disposed',
    );
    expect(residentState(xs)!.open).toEqual([1, 2, 3, 4]);
    expect(residentState(xs)!.fixed).toBeUndefined();
    rt.frame().dispatch(pipeline, { cfg: { k: 1 }, xs, out: array(4, 'f32') }, 1);
    expect(residentState(xs)!.fixed?.kind).toBe('f32');
  });
});
