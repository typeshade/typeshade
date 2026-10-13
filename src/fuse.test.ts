// The fuse scope (change 0058, steps 2 to 5): a body that makes kernel calls over `Resident`
// arrays, a plan that runs them as one unit in the kernel queue, and a report of what the plan
// did. Node has no WebGPU, so the calls run on the CPU tier, where `dispatches` and `submissions`
// are zero, and the WebGPU half runs on a recording fake device: one `queue.submit` for the whole
// scope, the dispatches in the order the calls were made, and a submission of its own for each
// step that must see what the batch wrote: a call on the CPU tier. A module built with
// `typeshade({ fuse: true })` has the facts the planner fuses a chain by: the groups it makes, the
// reason of each call that stands apart, the entry built for a group and cached for its shape, and
// the limit of the device are read here on the recording device, the planner alone is
// `src/core/fuse-group.test.ts`, and the fused module against the calls run apart is
// `src/core/fuse-entry.test.ts`. The scratch arrays of step 4 are read here on the same device:
// which buffers the device was asked for and which of them it was asked to destroy, what the
// arrays held when the dispatch was submitted, and the refusals. A reduction as the last call of a
// group (step 5) is read on the same device: the dispatches of its loop and of each fold level,
// the module they share, the one submission they share with the rest of the plan, the device
// buffer of partials the levels share, the uniform of each level, and the copy of the folded slot
// that the submission carries (the follow-up of D7). The fake device reads back zeros unless a
// test gives it bytes to map, so a sum is held to its shape and its counts here, to the bytes it
// is given in a test that gives some, and to its value on the CPU tier. A real device,
// SwiftShader, is `journeys/loop-fuse` and `journeys/mnist/bench-submissions.mjs`.
//
// Verifies: Rule 11.8, Rule 11.13 (docs/language-design.md; traced in reqs/).

import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './compiler/ts/host-face.js';
import * as root from './index.js';
import * as runtime from './runtime.js';
import { fuse, type FuseReport, type FuseScope } from './fuse.js';
import { buildPlan, ScratchState } from './core/fuse-plan.js';
import { configure, kernelQueue, resident, residentState } from './core/resident.js';
import type { Resident } from './core/resident.js';
import { bindCacheStats, DispatchBatch, gpuDevice, type GpuDevice } from './core/host-entry.js';
import type { KernelFace } from './core/host-kernel.js';

const RUNTIME = resolve(__dirname, 'core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
afterEach(() => configure({ runtime: null }));

const OPS = `"use typeshade";
export function add(out: array<f32>, a: array<f32>, b: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i] + b[i];
  }
}
export function mul(out: array<f32>, a: array<f32>, b: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i] * b[i];
  }
}
export function relu(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = max(x[i], 0.);
  }
}
export function bump(xs: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = xs[i] + 1.;
  }
}
export function twice(xs: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = xs[i] * 2.;
  }
}
export function fillTo(out: array<f32>, n: u32) {
  for (let i: u32 = 0; i < n; i++) {
    out[i] = 1.;
  }
}
export function total(xs: array<f32>): f32 {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return s;
}
export function spread(xs: array<f32>): vec2 {
  let sum = 0.;
  let top = -1e30;
  for (let i: u32 = 0; i < xs.length; i++) {
    sum += xs[i];
    top = max(top, xs[i]);
  }
  return vec2(sum, top);
}
export function prefix(out: array<f32>) {
  for (let i: u32 = 1; i < out.length; i++) {
    out[i] = out[i] + out[i - 1];
  }
}
export function pairsum(out: array<f32>, t: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = t[i] + t[i ^ 1];
  }
}
export function sized(out: array<f32>, x: array<f32>): u32 {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = x[i] * 2.;
  }
  return out.length;
}
export function lenscale(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = x[i] * f32(x.length);
  }
}
export function iadd(out: array<i32>, a: array<i32>, b: array<i32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i] + b[i];
  }
}
export function uadd(out: array<u32>, a: array<u32>, b: array<u32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i] + b[i];
  }
}
declare const sink: storage<array<f32>, "read_write">;
@compute([64])
export function fill(@builtin("global_invocation_id") gid: vec3u) {
  if (gid.x >= sink.length) {
    return;
  }
  sink[gid.x] = 1.;
}
class Color {
  @location(0) color: vec4;
}
@fragment
export function shade(@builtin("position") p: vec4): Color {
  return { color: vec4(p.x, p.y, 0., 1.) };
}
declare const data: storage<array<f32>>;
@fragment
export function show(@builtin("position") p: vec4): vec4 {
  return vec4(data[u32(p.x)], 0., 0., 1.);
}
`;

type Call = (...a: unknown[]) => Promise<unknown>;
type Ops = Record<
  | 'add'
  | 'mul'
  | 'relu'
  | 'bump'
  | 'twice'
  | 'fillTo'
  | 'total'
  | 'spread'
  | 'prefix'
  | 'pairsum'
  | 'sized'
  | 'lenscale'
  | 'iadd'
  | 'uadd'
  | 'fill'
  | 'shade'
  | 'show',
  Call
>;

const generated = hostFace(OPS, { fileName: '/app/ops.shade.ts', runtime: RUNTIME });
expect(generated.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
/** The same module built with `typeshade({ fuse: true })`: each kernel function's face carries the
 *  facts of its loop and its loop IR, which the planner fuses a chain of calls from. */
const generatedForFusion = hostFace(OPS, {
  fileName: '/app/ops.shade.ts',
  runtime: RUNTIME,
  fuse: true,
});
expect(generatedForFusion.diagnostics.filter((d) => d.category === 'error')).toEqual([]);

/** A generated module, loaded: its calls go through `core/host-runtime.ts`. */
async function loadCode(code: string, name = 'ops'): Promise<Ops> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-fuse-'));
  dirs.push(dir);
  const file = join(dir, `${name}.shade.mjs`);
  writeFileSync(file, code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Ops;
}

/** The generated module of `OPS`, loaded. */
const load = (): Promise<Ops> => loadCode(generated.code!);

/** The generated module of `OPS` built for fusion, loaded. */
const loadFused = (): Promise<Ops> => loadCode(generatedForFusion.code!);

/** The kernel face of a function of `OPS`, as the generated module carries it. */
function faceOf(name: string): KernelFace {
  const e = generated.exports!.find((x) => x.name === name);
  if (e?.kind !== 'kernel') throw new Error(`${name} is ${e?.kind}`);
  return e.face;
}

const floats = (...xs: number[]): Float32Array => Float32Array.of(...xs);
const live = (...xs: number[]): Resident<Float32Array> => resident(floats(...xs));
const zeros = (n: number): Resident<Float32Array> => resident(new Float32Array(n));

describe('the plan record', () => {
  it('names each call, its loops and the residents it reads and writes, and what depends on what', () => {
    const [t, u, out, a, c] = [zeros(3), zeros(3), zeros(3), live(1, 2, 3), live(4, 5, 6)];
    const host = floats(1, 1, 1);
    const plan = buildPlan([
      { k: faceOf('add'), args: [t, a, host] },
      { k: faceOf('mul'), args: [u, t, c] },
      { k: faceOf('relu'), args: [out, u] },
      { k: faceOf('add'), args: [t, out, a] },
    ]);
    // The residents, in the order the calls first reach them; a host array is none of them.
    expect(plan.residents).toEqual([t, a, u, c, out].map((r) => residentState(r)));
    expect(plan.calls).toEqual([
      { name: 'add', loops: ['add_loop0'], reads: [1], writes: [0] },
      { name: 'mul', loops: ['mul_loop0'], reads: [0, 3], writes: [2] },
      { name: 'relu', loops: ['relu_loop0'], reads: [2], writes: [4] },
      { name: 'add', loops: ['add_loop0'], reads: [4, 1], writes: [0] },
    ]);
    expect(plan.dependencies).toEqual([
      { from: 0, to: 1, resident: 0, kind: 'read-after-write' },
      { from: 1, to: 2, resident: 2, kind: 'read-after-write' },
      { from: 2, to: 3, resident: 4, kind: 'read-after-write' },
      // `t` was written by call 0, and call 3 writes it again.
      { from: 0, to: 3, resident: 0, kind: 'write-after-write' },
    ]);
  });

  it('puts every call in a group of its own, with a barrier before each call after the first', () => {
    const [x, y] = [zeros(2), zeros(2)];
    const plan = buildPlan([
      { k: faceOf('bump'), args: [x] },
      { k: faceOf('twice'), args: [y] },
      { k: faceOf('bump'), args: [x] },
    ]);
    expect(plan.groups).toEqual([
      { calls: [0], fused: false },
      { calls: [1], fused: false },
      { calls: [2], fused: false },
    ]);
    expect(plan.barriers).toEqual([1, 2]);
    // No call reads or writes what another wrote, but call 2 writes what call 0 did.
    expect(plan.dependencies).toEqual([{ from: 0, to: 2, resident: 0, kind: 'write-after-write' }]);
  });

  it('takes the last writer as the one a call depends on, and has nothing for a read of a read', () => {
    const [x, y, z] = [zeros(2), live(1, 2), zeros(2)];
    const plan = buildPlan([
      { k: faceOf('relu'), args: [x, y] },
      { k: faceOf('relu'), args: [z, y] },
      { k: faceOf('bump'), args: [x] },
      { k: faceOf('bump'), args: [x] },
      { k: faceOf('relu'), args: [z, x] },
    ]);
    expect(plan.dependencies).toEqual([
      { from: 0, to: 2, resident: 0, kind: 'write-after-write' },
      { from: 2, to: 3, resident: 0, kind: 'write-after-write' },
      { from: 3, to: 4, resident: 0, kind: 'read-after-write' },
      { from: 1, to: 4, resident: 2, kind: 'write-after-write' },
    ]);
  });

  it('is empty for no calls', () => {
    expect(buildPlan([])).toEqual({
      calls: [],
      residents: [],
      dependencies: [],
      groups: [],
      barriers: [],
    });
  });
});

describe('a fuse scope on the CPU tier (Node has no WebGPU)', () => {
  it('runs a chain and reports it: one group a call, nothing dispatched or submitted', async () => {
    const m = await load();
    const [t, u, out] = [zeros(4), zeros(4), zeros(4)];
    const [a, b, c] = [live(1, -2, 3, -4), live(1, 1, 1, 1), live(2, 2, 2, 2)];
    const report = await fuse(() => {
      void m.add(t, a, b);
      void m.mul(u, t, c);
      void m.relu(out, u);
    });
    expect(await out.read()).toEqual(floats(4, 0, 8, 0));
    expect(report).toEqual({
      tier: 'cpu',
      dispatches: 0,
      submissions: 0,
      groups: [
        { calls: ['add'], fused: false },
        { calls: ['mul'], fused: false },
        { calls: ['relu'], fused: false },
      ],
    } satisfies FuseReport);
  });

  it('records a call and does not run it: it reads its arguments when the plan runs', async () => {
    const m = await load();
    const out = zeros(3);
    const host = floats(1, 2, 3);
    let recorded = -1;
    const done = fuse((scope) => {
      void m.add(out, host, live(10, 10, 10));
      recorded = scope.recorded;
    });
    // The body has returned, and the plan has not run: a host array still changes the sum.
    host[0] = 100;
    await done;
    expect(recorded).toBe(1);
    expect(await out.read()).toEqual(floats(110, 12, 13));
  });

  it('counts the calls the body has recorded', async () => {
    const m = await load();
    const x = live(1);
    const counts: number[] = [];
    await fuse((scope) => {
      counts.push(scope.recorded);
      void m.bump(x);
      counts.push(scope.recorded);
      void m.bump(x);
      counts.push(scope.recorded);
    });
    expect(counts).toEqual([0, 1, 2]);
  });

  it('runs at the place the scope holds: after the calls made before it, before the calls made after', async () => {
    const m = await load();
    const x = live(1, 2);
    // ((x + 1) * 2) + 1, and in no other order.
    void m.bump(x);
    const scoped = fuse(() => {
      void m.twice(x);
    });
    void m.bump(x);
    await scoped;
    expect(await x.read()).toEqual(floats(5, 7));
  });

  it.each([
    ['read()', 'a read of a Resident', (x: Resident<Float32Array>) => void x.read()],
    ['write()', 'a write to a Resident', (x: Resident<Float32Array>) => x.write(floats(9, 9))],
    ['destroy()', 'the destroy of a Resident', (x: Resident<Float32Array>) => x.destroy()],
  ])(
    'refuses %s of a Resident inside the body, which would run before the calls recorded earlier',
    async (call, what, use) => {
      const m = await load();
      const x = live(1, 2);
      await expect(
        fuse(() => {
          void m.bump(x);
          use(x);
        }),
      ).rejects.toThrow(
        new TypeError(
          `${call}: ${what} cannot run inside fuse(), which records kernel calls only. Call it outside fuse().`,
        ),
      );
      // The call recorded before it did not run, the queue is free, and the handle is whole.
      expect(kernelQueue.pending).toBe(0);
      expect(await x.read()).toEqual(floats(1, 2));
      // Outside a scope the same use is what it was.
      x.write(floats(3, 4));
      expect(await x.read()).toEqual(floats(3, 4));
    },
  );

  it('refuses any other use of the kernel queue inside the body', async () => {
    const m = await load();
    const x = live(1, 2);
    const refusal = (what: string) =>
      new TypeError(
        `the kernel queue: ${what} cannot run inside fuse(), which records kernel calls only. Call it outside fuse().`,
      );
    await expect(
      fuse(() => {
        void m.bump(x);
        void kernelQueue.run(async () => undefined);
      }),
    ).rejects.toThrow(refusal('a call that joins it'));
    await expect(fuse(() => void kernelQueue.idle())).rejects.toThrow(
      refusal('a call that waits on it'),
    );
    await expect(fuse(() => kernelQueue.whenIdle(() => undefined))).rejects.toThrow(
      refusal('a call that waits on it'),
    );
    expect(kernelQueue.pending).toBe(0);
    expect(await x.read()).toEqual(floats(1, 2));
  });

  it('takes the scope as one item in the queue, at the place fuse was called', async () => {
    const m = await load();
    const x = live(1, 2);
    // ((x + 1) * 2) + 1: a call made before, the scope, and a call made after, in that order,
    // however the promises are awaited.
    void m.bump(x);
    const scoped = fuse(() => {
      void m.twice(x);
    });
    const read = x.read();
    void m.bump(x);
    await scoped;
    // The read was made after the scope and before the last call.
    expect(await read).toEqual(floats(4, 6));
    expect(await x.read()).toEqual(floats(5, 7));
  });

  it('resolves each recorded call to what the call resolves to, once the plan has run', async () => {
    const m = await load();
    const x = live(1, 2, 3);
    let sum: Promise<unknown> | undefined;
    let bumped: Promise<unknown> | undefined;
    await fuse(() => {
      bumped = m.bump(x);
      sum = m.total(x);
    });
    await expect(bumped).resolves.toBeUndefined();
    await expect(sum).resolves.toBe(9);
  });

  it('runs a function that runs on the CPU, and a reduction, in the plan', async () => {
    const m = await load();
    const x = live(1, 1, 1, 1);
    const report = await fuse(() => {
      void m.prefix(x);
      void m.total(x);
    });
    expect(await x.read()).toEqual(floats(1, 2, 3, 4));
    expect(report.groups.map((g) => g.calls)).toEqual([['prefix'], ['total']]);
  });

  it('takes a body that returns the promise of a call, as an expression body does', async () => {
    const m = await load();
    const x = live(1, 2);
    await expect(fuse(() => m.bump(x))).resolves.toMatchObject({ groups: [{ calls: ['bump'] }] });
    expect(await x.read()).toEqual(floats(2, 3));
  });

  it('reports an empty scope as the CPU tier with nothing in it', async () => {
    await expect(fuse(() => {})).resolves.toEqual({
      tier: 'cpu',
      dispatches: 0,
      submissions: 0,
      groups: [],
    });
  });

  it('runs one plan for a nested fuse, and returns the scope around it its report', async () => {
    const m = await load();
    const x = live(1, 2);
    let inner: Promise<FuseReport> | undefined;
    const outer = fuse(() => {
      void m.bump(x);
      inner = fuse((scope) => {
        void m.twice(x);
        expect(scope.recorded).toBe(2);
      });
      void m.bump(x);
    });
    const report = await outer;
    expect(await inner).toBe(report);
    expect(report.groups.map((g) => g.calls)).toEqual([['bump'], ['twice'], ['bump']]);
    expect(await x.read()).toEqual(floats(5, 7));
  });

  it('fails the scope that holds a nested body which throws', async () => {
    const m = await load();
    const x = live(1, 2);
    await expect(
      fuse(() => {
        void m.bump(x);
        fuse(() => {
          throw new Error('inner');
        });
      }),
    ).rejects.toThrow('inner');
    expect(await x.read()).toEqual(floats(1, 2));
  });

  it('refuses an async body, as a TypeError and before it runs', async () => {
    let ran = false;
    await expect(
      fuse(async () => {
        ran = true;
      }),
    ).rejects.toThrow(
      new TypeError(
        'fuse(): the body is synchronous, and this one is not. A call made after an await runs outside the scope. Remove async, and await the promise that fuse() returns.',
      ),
    );
    expect(ran).toBe(false);
    // A body that is async in effect: a promise that is none of the scope's.
    await expect(fuse(() => Promise.resolve() as never)).rejects.toThrow(/the body is synchronous/);
    await expect(fuse(1 as never)).rejects.toThrow(
      new TypeError('fuse(): takes the body of the scope as a function; got number 1.'),
    );
  });

  it('refuses an async body nested in a scope, and leaves the slot free', async () => {
    const m = await load();
    const x = live(1);
    await expect(
      fuse(() => {
        void m.bump(x);
        void fuse(async () => {});
      }),
    ).rejects.toThrow(/the body is synchronous/);
    // Nothing recorded ran, and a call outside any scope runs.
    expect(await x.read()).toEqual(floats(1));
    await m.bump(x);
    expect(await x.read()).toEqual(floats(2));
  });

  it('refuses a call that writes a host array, naming the call and the parameter', async () => {
    const m = await load();
    const x = live(1, 2);
    await expect(
      fuse(() => {
        void m.bump(x);
        void m.twice(floats(1, 2));
      }),
    ).rejects.toThrow(
      new TypeError(
        'twice(): parameter "xs" is a Float32Array, and a call inside fuse() writes only a Resident. fuse() reads nothing back. Pass resident(...), or call twice() outside fuse().',
      ),
    );
    // The call recorded before it did not run.
    expect(await x.read()).toEqual(floats(1, 2));
  });

  it('refuses a call with the wrong number of arguments', async () => {
    const m = await load();
    await expect(
      fuse(() => {
        void m.relu(live(1));
      }),
    ).rejects.toThrow(new TypeError('relu() takes 2 arguments; got 1.'));
  });

  it('records a call that reads a host array', async () => {
    const m = await load();
    const out = zeros(2);
    await fuse(() => {
      void m.relu(out, floats(-1, 5));
    });
    expect(await out.read()).toEqual(floats(0, 5));
  });

  it('refuses an entry call and a draw, naming the call', async () => {
    const m = await load();
    const sink = zeros(4);
    await expect(
      fuse(() => {
        void m.fill({ sink }, 1);
      }),
    ).rejects.toThrow(
      new TypeError(
        'fill(): an entry call cannot run inside fuse(), which records kernel calls only. Call it outside fuse().',
      ),
    );
    await expect(
      fuse(() => {
        void m.shade({}, {});
      }),
    ).rejects.toThrow(
      new TypeError(
        'shade(): a draw cannot run inside fuse(), which records kernel calls only. Call it outside fuse().',
      ),
    );
    // Outside a scope the entry call is what it was.
    await m.fill({ sink }, 1);
    expect(await sink.read()).toEqual(floats(1, 1, 1, 1));
  });

  it('leaves nothing to run when the body throws, and frees its place in the queue', async () => {
    const m = await load();
    const x = live(1, 2);
    let call: Promise<unknown> | undefined;
    await expect(
      fuse(() => {
        call = m.bump(x);
        throw new Error('the body failed');
      }),
    ).rejects.toThrow('the body failed');
    await expect(call).rejects.toThrow('the body failed');
    expect(kernelQueue.pending).toBe(0);
    // A read and a call after it neither wait for nor see the scope.
    expect(await x.read()).toEqual(floats(1, 2));
    await m.twice(x);
    expect(await x.read()).toEqual(floats(2, 4));
  });

  it('checks every call before any runs, and keeps the error on what the calls write', async () => {
    const m = await load();
    const [a, short, out] = [live(1, 2, 3, 4), zeros(2), zeros(4)];
    // `fillTo` writes 4 elements of `short`, which holds 2.
    const failed = fuse(() => {
      void m.relu(out, a);
      void m.fillTo(short, 4);
    });
    const refusal =
      'fillTo(): parameter "out" holds 2 elements, and loop 1 writes it at indices 0 to 3.';
    await expect(failed).rejects.toThrow(new TypeError(refusal));
    // `relu` did not run either, and the arrays both of them write carry the error.
    expect(residentState(out)!.host).toEqual(new Float32Array(4));
    await expect(out.read()).rejects.toThrow(refusal);
    await expect(short.read()).rejects.toThrow(refusal);
    // A call that succeeds clears what it writes.
    await m.relu(out, a);
    expect(await out.read()).toEqual(floats(1, 2, 3, 4));
  });

  it('refuses one resident passed as two parameters, and runs none of the plan', async () => {
    const m = await load();
    const [x, out] = [live(1, 2), zeros(2)];
    await expect(
      fuse(() => {
        void m.bump(x);
        void m.add(out, x, x);
        void m.add(x, x, out);
      }),
    ).rejects.toThrow(
      new TypeError('add(): parameter "b" is the same resident array as parameter "a".'),
    );
    expect(residentState(x)!.error).toBeDefined();
  });

  it('keeps the error of a scope nobody awaits on what it writes, for read() to throw', async () => {
    const m = await load();
    const short = zeros(2);
    // No `.catch`, no `await`: a failed scope nobody awaits is no unhandled rejection.
    void fuse(() => {
      void m.fillTo(short, 4);
    });
    await expect(short.read()).rejects.toThrow(
      'fillTo(): parameter "out" holds 2 elements, and loop 1 writes it at indices 0 to 3.',
    );
  });

  it('leaves a call outside a scope as it was', async () => {
    const m = await load();
    const x = live(1, 2);
    await m.bump(x);
    await m.twice(x);
    expect(await x.read()).toEqual(floats(4, 6));
    await expect(m.bump(floats(1))).resolves.toBeUndefined();
  });

  it('does not export fuse from the package root or from typeshade/runtime', () => {
    expect('fuse' in root).toBe(false);
    expect('fuse' in runtime).toBe(false);
  });
});

// ─── WebGPU, on a device that records what it is given ─────────────────────────────────────────

interface FakeOptions {
  /** What `popErrorScope` resolves to: a validation error's message. */
  readonly validation?: string;
  /** With `validation`, the one pop (counting from 1) that resolves to it; every pop otherwise. */
  readonly validationAt?: number;
  /** What a shader module's compilation info reports as an error. */
  readonly compile?: string;
  /** The message of the error that making a bind group throws. */
  readonly bindGroup?: string;
  /** What the device reports as `maxStorageBuffersPerShaderStage`; none when left out. */
  readonly storageBuffers?: number;
  /** Called with each `queue.submit`, before it is recorded. */
  readonly onSubmit?: () => void;
  /** What a staging buffer of `size` bytes holds when it is mapped; zeros when left out. */
  readonly mapped?: (size: number) => ArrayBuffer;
}

/** A buffer the fake device was asked to make. */
interface MadeBuffer {
  readonly size: number;
  readonly usage: number;
  /** Whether `queue.writeBuffer` gave it contents. */
  written: boolean;
  /** What `queue.writeBuffer` last put in it. */
  contents?: ArrayBuffer;
  /** Whether the device was asked to destroy it. */
  destroyed: boolean;
  /** Every `queue.writeBuffer` the device was given for it, in order, with its offset. */
  writes: { at: number; bytes: ArrayBuffer }[];
}

/** `GPUBufferUsage` of the uniform buffer a batch keeps for its uniforms (`UNIFORM | COPY_DST`). */
const UNIFORM_RING = 64 | 8;
/** `GPUBufferUsage` of a Resident's buffer (`RESIDENT_USAGE` in `core/host-entry.ts`). */
const RESIDENT_BUFFER = 128 | 64 | 32 | 16 | 8 | 4;

/** The buffers a batch made for one flush: neither a Resident's nor the uniform buffer. */
function batchMade(gpu: { readonly made: readonly MadeBuffer[] }): MadeBuffer[] {
  return gpu.made.filter((b) => b.usage !== RESIDENT_BUFFER && b.usage !== UNIFORM_RING);
}

/** `GPUBufferUsage.STORAGE`, which the specification fixes. */
const STORAGE = 128;

/** A device that makes nothing and records the commands it gets, in order. A buffer reads back
 *  as zeros. */
function fakeGpu(options: FakeOptions = {}) {
  const commands: string[] = [];
  /** The WGSL of every shader module the device was asked to make. */
  const shaders: string[] = [];
  /** How many resources each bind group the device was asked to make binds. */
  const binds: number[] = [];
  /** Every buffer the device was asked to make, in order. */
  const made: MadeBuffer[] = [];
  let pops = 0;
  /** The dynamic offsets of each bind of a group that has them, in the order the device was bound. */
  const dynamic: number[][] = [];
  /** How many `queue.writeBuffer` calls the device was given. */
  let writeCount = 0;
  const buffer = (size: number, usage = 0) => {
    const record: MadeBuffer = { size, usage, written: false, destroyed: false, writes: [] };
    made.push(record);
    return {
      record,
      mapAsync: async () => {},
      getMappedRange: () => options.mapped?.(size) ?? new ArrayBuffer(size),
      unmap: () => {},
      destroy: () => {
        record.destroyed = true;
      },
    };
  };
  const pass = {
    setPipeline: () => {},
    setBindGroup: (_i: number, _g: unknown, offsets: readonly number[] = []) => {
      if (offsets.length > 0) dynamic.push([...offsets]);
    },
    dispatchWorkgroups: (x: number, y: number, z: number) =>
      commands.push(`dispatch ${x} ${y} ${z}`),
    end: () => {},
  };
  const encoder = {
    beginComputePass: () => pass,
    copyBufferToBuffer: (_s: unknown, offset: number, _d: unknown, _do: number, n: number) =>
      commands.push(`copy ${n} at ${offset}`),
    finish: () => ({}),
  };
  const device = {
    createShaderModule: (d: { code: string }) => {
      shaders.push(d.code);
      return {
        getCompilationInfo: async () => ({
          messages:
            options.compile === undefined
              ? []
              : [{ type: 'error', message: options.compile, lineNum: 1, linePos: 2 }],
        }),
      };
    },
    createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createBuffer: (d: { size: number; usage: number }) => buffer(d.size, d.usage),
    createBindGroup: (d: { entries: readonly unknown[] }) => {
      if (options.bindGroup !== undefined) throw new Error(options.bindGroup);
      binds.push(d.entries.length);
      return {};
    },
    createCommandEncoder: () => encoder,
    pushErrorScope: () => commands.push('push'),
    popErrorScope: async () => {
      commands.push('pop');
      pops++;
      const fails =
        options.validation !== undefined &&
        (options.validationAt === undefined || options.validationAt === pops);
      return fails ? { message: options.validation! } : null;
    },
    queue: {
      writeBuffer: (b: { record?: MadeBuffer }, at: number, data: ArrayBuffer) => {
        writeCount++;
        if (b.record === undefined) return;
        b.record.written = true;
        b.record.contents = data.slice(0);
        b.record.writes.push({ at, bytes: data.slice(0) });
      },
      submit: () => {
        options.onSubmit?.();
        commands.push('submit');
      },
    },
    lost: new Promise<never>(() => {}),
    ...(options.storageBuffers !== undefined
      ? { limits: { maxStorageBuffersPerShaderStage: options.storageBuffers } }
      : {}),
  };
  configure({ runtime: { device } });
  return {
    commands,
    shaders,
    binds,
    dynamic,
    made,
    /** The device the calls ran on, the key of its bind-group cache. */
    device: device as unknown as GpuDevice,
    /** How many `queue.writeBuffer` calls the device was given so far. */
    get writes(): number {
      return writeCount;
    },
    /** The storage buffers the device was asked to make and was given nothing to put in: the
     *  zeroed buffer of a scratch array that stays a buffer. A Resident's is written when made. */
    get zeroed(): MadeBuffer[] {
      return made.filter((b) => (b.usage & STORAGE) !== 0 && !b.written);
    },
    /** The commands of the dispatches and submissions alone, in order. */
    get flow(): string[] {
      return commands.filter((c) => c.startsWith('dispatch') || c === 'submit');
    },
    get submits(): number {
      return commands.filter((c) => c === 'submit').length;
    },
  };
}

describe('a fuse scope on WebGPU, on a recording device', () => {
  const dispatch = 'dispatch 1 1 1';

  it('puts the dispatches of all its calls in one submission, in the order of the calls', async () => {
    const gpu = fakeGpu();
    const m = await load();
    const [t, u, out] = [zeros(4), zeros(4), zeros(4)];
    const [a, b, c] = [live(1, 2, 3, 4), live(1, 1, 1, 1), live(2, 2, 2, 2)];
    const report = await fuse(() => {
      void m.add(t, a, b);
      void m.mul(u, t, c);
      void m.relu(out, u);
    });
    expect(gpu.flow).toEqual([dispatch, dispatch, dispatch, 'submit']);
    // A module built without `typeshade({ fuse: true })` has no facts to fuse by: each call is a
    // group of its own, and the report says why from the second group on.
    expect(report).toEqual({
      tier: 'webgpu',
      dispatches: 3,
      submissions: 1,
      groups: [
        { calls: ['add'], fused: false },
        {
          calls: ['mul'],
          fused: false,
          why: 'add and mul run as two dispatches because mul was built without typeshade({ fuse: true })',
        },
        {
          calls: ['relu'],
          fused: false,
          why: 'mul and relu run as two dispatches because relu was built without typeshade({ fuse: true })',
        },
      ],
    });
    // The report counts what the device was given: the scope made the one submission.
    expect(report.submissions).toBe(gpu.submits);
    // The error scope opened and closed once around the batch.
    expect(gpu.commands.filter((c) => c === 'push' || c === 'pop')).toEqual(['push', 'pop']);
  });

  it('makes a submission for each call outside a scope, as it always did', async () => {
    const gpu = fakeGpu();
    const m = await load();
    const [t, out] = [zeros(4), zeros(4)];
    const [a, b] = [live(1, 2, 3, 4), live(1, 1, 1, 1)];
    await m.add(t, a, b);
    await m.relu(out, t);
    expect(gpu.flow).toEqual([dispatch, 'submit', dispatch, 'submit']);
  });

  it('counts the dispatches that were made: a loop with no iteration makes none', async () => {
    const gpu = fakeGpu();
    const m = await load();
    const [x, y] = [live(1, 2, 3, 4), zeros(2)];
    // `fillTo` stops at 0: its loop has no iteration, and nothing is dispatched for it.
    const report = await fuse(() => {
      void m.bump(x);
      void m.fillTo(y, 0);
    });
    expect(report).toMatchObject({ dispatches: 1, submissions: 1 });
    expect(gpu.flow).toEqual([dispatch, 'submit']);
  });

  it('puts a reduction between two calls in the one submission, and copies its folded value there', async () => {
    const gpu = fakeGpu();
    const m = await load();
    const [x, y, out] = [live(1, 2, 3, 4), live(1, 1, 1, 1), zeros(4)];
    const report = await fuse(() => {
      void m.add(out, x, y);
      void m.total(out);
      void m.bump(out);
    });
    expect(gpu.flow).toEqual([dispatch, dispatch, dispatch, 'submit']);
    expect(report).toMatchObject({ tier: 'webgpu', dispatches: 3, submissions: 1 });
    // The copy of the one partial the reduction made follows the last dispatch, in the same
    // submission, and nothing is read back before it.
    expect(gpu.commands.filter((c) => /^(dispatch|copy|submit)/.test(c))).toEqual([
      dispatch,
      dispatch,
      dispatch,
      'copy 4 at 0',
      'submit',
    ]);
  });

  it('submits what it holds before a call that runs on the CPU, and counts the read it needs', async () => {
    const gpu = fakeGpu();
    const m = await load();
    const [t, out] = [live(1, 2, 3, 4), zeros(4)];
    const report = await fuse(() => {
      void m.bump(t);
      void m.prefix(t);
      void m.relu(out, t);
    });
    // The batch, then the read of `t` that `prefix` needs, then the batch of `relu`.
    expect(gpu.flow).toEqual([dispatch, 'submit', 'submit', dispatch, 'submit']);
    expect(report).toMatchObject({ tier: 'webgpu', dispatches: 2, submissions: 3 });
  });

  it('rejects with the validation error, naming the calls, and keeps it on what they write', async () => {
    const gpu = fakeGpu({ validation: 'boom' });
    const m = await load();
    const [x, y] = [live(1, 2), zeros(2)];
    await expect(
      fuse(() => {
        void m.bump(x);
        void m.relu(y, x);
      }),
    ).rejects.toThrow(new Error('bump(), relu(): WebGPU refused the calls: boom'));
    expect(gpu.submits).toBe(1);
    expect(kernelQueue.pending).toBe(0);
    await expect(x.read()).rejects.toThrow('WebGPU refused the calls: boom');
    await expect(y.read()).rejects.toThrow('WebGPU refused the calls: boom');
  });

  it('puts the error of a plan that fails part-way on every Resident its calls write', async () => {
    // The batch with `bump` is submitted before `prefix`, which runs on the CPU, and passes; the
    // batch of `relu` fails. `bump` ran, `relu` did not, and neither array can be trusted.
    const gpu = fakeGpu({ validation: 'boom', validationAt: 2 });
    const m = await load();
    const [x, y] = [live(1, 2), zeros(2)];
    let calls: Promise<unknown>[] = [];
    await expect(
      fuse(() => {
        calls = [m.bump(x), m.prefix(x), m.relu(y, x)];
      }),
    ).rejects.toThrow(new Error('relu(): WebGPU refused the call: boom'));
    // The batch of `bump`, the read `prefix` needs, and the batch of `relu`.
    expect(gpu.submits).toBe(3);
    await expect(x.read()).rejects.toThrow('relu(): WebGPU refused the call: boom');
    await expect(y.read()).rejects.toThrow('relu(): WebGPU refused the call: boom');
    // Every call of the plan rejects, the one that ran before the failure included.
    for (const call of calls) await expect(call).rejects.toThrow('boom');
    expect(kernelQueue.pending).toBe(0);
  });

  it('names one call as a call outside a scope does', async () => {
    fakeGpu({ validation: 'boom' });
    const m = await load();
    await expect(m.bump(live(1))).rejects.toThrow(
      new Error('bump(): WebGPU refused the call: boom'),
    );
  });

  describe('destroys every buffer a failed batch made (issue 603)', () => {
    it('after a plan the device refuses', async () => {
      const gpu = fakeGpu({ validation: 'boom' });
      const m = await load();
      const [x, y] = [live(1, 2), zeros(2)];
      await expect(
        fuse(() => {
          void m.bump(x);
          void m.relu(y, x);
        }),
      ).rejects.toThrow('WebGPU refused the calls: boom');
      // The staging copies are made and destroyed. The uniform buffer is the device's own, kept for
      // the flushes after this one, so it is made once and not destroyed with the batch.
      expect(gpu.made.some((b) => b.usage === UNIFORM_RING)).toBe(true);
      expect(gpu.made.filter((b) => b.usage === UNIFORM_RING && b.destroyed)).toEqual([]);
      expect(batchMade(gpu).filter((b) => !b.destroyed)).toEqual([]);
    });

    it('after a call outside a scope the device refuses', async () => {
      const gpu = fakeGpu({ validation: 'boom' });
      const m = await load();
      await expect(m.bump(live(1))).rejects.toThrow('WebGPU refused the call: boom');
      expect(batchMade(gpu).filter((b) => !b.destroyed)).toEqual([]);
    });

    it('after a throw while the batch encodes', async () => {
      const gpu = fakeGpu({ bindGroup: 'no bind group' });
      const m = await load();
      await expect(m.bump(live(1))).rejects.toThrow('no bind group');
      expect(batchMade(gpu).filter((b) => !b.destroyed)).toEqual([]);
    });
  });

  it('submits nothing when a pipeline does not build, and frees the queue', async () => {
    const gpu = fakeGpu({ compile: 'nope' });
    const m = await load();
    const [x, y] = [live(1, 2), zeros(2)];
    await expect(
      fuse(() => {
        void m.bump(x);
        void m.relu(y, x);
      }),
    ).rejects.toThrow(/WebGPU refused the module's WGSL: line 1:2 nope/);
    expect(gpu.submits).toBe(0);
    expect(gpu.commands).not.toContain('push');
    expect(kernelQueue.pending).toBe(0);
    await expect(y.read()).rejects.toThrow(/WebGPU refused the module's WGSL/);
  });

  it('closes the error scope when the commands cannot be recorded, and submits nothing', async () => {
    const gpu = fakeGpu({ bindGroup: 'no bind group' });
    const m = await load();
    const [x, y] = [live(1, 2), zeros(2)];
    await expect(
      fuse(() => {
        void m.bump(x);
        void m.relu(y, x);
      }),
    ).rejects.toThrow('no bind group');
    expect(gpu.commands.filter((c) => c === 'push' || c === 'pop')).toEqual(['push', 'pop']);
    expect(gpu.submits).toBe(0);
    // A call outside a scope closes its scope the same way.
    await expect(m.bump(x)).rejects.toThrow('no bind group');
    expect(gpu.commands.filter((c) => c === 'push' || c === 'pop')).toEqual([
      'push',
      'pop',
      'push',
      'pop',
    ]);
  });

  it('submits nothing for a resident that was destroyed, and says so', async () => {
    const gpu = fakeGpu();
    const m = await load();
    const [x, y] = [live(1, 2), zeros(2)];
    await m.bump(x);
    const submitted = gpu.submits;
    y.destroy();
    await expect(
      fuse(() => {
        void m.bump(x);
        void m.relu(y, x);
      }),
    ).rejects.toThrow('This Resident was destroyed; make a new one with resident().');
    expect(gpu.submits).toBe(submitted);
  });

  it('keeps two scopes and a read between them in the order they were made', async () => {
    const gpu = fakeGpu();
    const m = await load();
    const x = live(1, 2);
    const first = fuse(() => {
      void m.bump(x);
    });
    const between = x.read();
    const second = fuse(() => {
      void m.twice(x);
    });
    await Promise.all([first, between, second]);
    // One submission for each scope, and the read of the device, a submission too, between them.
    expect(gpu.flow).toEqual([dispatch, 'submit', 'submit', dispatch, 'submit']);
  });
});

// ─── WebGPU, a chain that fuses ────────────────────────────────────────────────────────────────

describe('a fuse scope that fuses, on a recording device', () => {
  const dispatch = 'dispatch 1 1 1';
  /** The line of `OPS` that `pairsum` reads `t[i ^ 1]` on, as the report words it. */
  const pairsumLine = OPS.split('\n').findIndex((l) => l.includes('t[i ^ 1]')) + 1;
  const read = `pairsum reads \`t[i ^ 1]\` (line ${pairsumLine})`;

  it('runs add, mul and relu as one dispatch in one submission', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [t, u, out] = [zeros(4), zeros(4), zeros(4)];
    const [a, b, c] = [live(1, 2, 3, 4), live(1, 1, 1, 1), live(2, 2, 2, 2)];
    const report = await fuse(() => {
      void m.add(t, a, b);
      void m.mul(u, t, c);
      void m.relu(out, u);
    });
    expect(gpu.flow).toEqual([dispatch, 'submit']);
    expect(report).toEqual({
      tier: 'webgpu',
      dispatches: 1,
      submissions: 1,
      groups: [{ calls: ['add', 'mul', 'relu'], fused: true }],
    });
    // The report counts what the device was given, and the group was one entry on it.
    expect(report.dispatches).toBe(gpu.flow.filter((c) => c.startsWith('dispatch')).length);
    expect(report.submissions).toBe(gpu.submits);
    expect(gpu.shaders).toHaveLength(1);
    expect(gpu.shaders[0]).toContain('fn fused_add_mul_relu(');
    expect(gpu.shaders[0]!.match(/@compute/g)).toHaveLength(1);
    // The merged uniform, and t, a, b, u, c and out: one bind group of seven resources.
    expect(gpu.binds).toEqual([7]);
    expect(gpu.commands.filter((c) => c === 'push' || c === 'pop')).toEqual(['push', 'pop']);
  });

  it('keeps the error scope and the submission of a scope, whatever the group', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [t, out] = [zeros(4), zeros(4)];
    const [a, b] = [live(1, 2, 3, 4), live(1, 1, 1, 1)];
    // One read of the device after the scope is the host's, and a submission the report does not count.
    const report = await fuse(() => {
      void m.add(t, a, b);
      void m.relu(out, t);
    });
    await out.read();
    expect(report).toMatchObject({ dispatches: 1, submissions: 1 });
    expect(gpu.flow).toEqual([dispatch, 'submit', 'submit']);
  });

  it('counts the dispatches of the plan: a refused pair is two, in one submission, with the reason', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [t, out] = [zeros(4), zeros(4)];
    const [a, b] = [live(1, 2, 3, 4), live(1, 1, 1, 1)];
    const report = await fuse(() => {
      void m.add(t, a, b);
      void m.pairsum(out, t);
    });
    expect(gpu.flow).toEqual([dispatch, dispatch, 'submit']);
    expect(report).toEqual({
      tier: 'webgpu',
      dispatches: 2,
      submissions: 1,
      groups: [
        { calls: ['add'], fused: false },
        {
          calls: ['pairsum'],
          fused: false,
          why: `add and pairsum run as two dispatches because ${read}`,
        },
      ],
    });
    // Two entries, one for each call, as outside a scope.
    expect(gpu.shaders).toHaveLength(2);
  });

  it('fuses the calls on either side of a refusal into groups of their own', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [t, u, v, w, out] = [zeros(4), zeros(4), zeros(4), zeros(4), zeros(4)];
    const [a, b, c] = [live(1, 2, 3, 4), live(1, 1, 1, 1), live(2, 2, 2, 2)];
    const report = await fuse(() => {
      void m.add(t, a, b);
      void m.mul(u, t, c);
      void m.pairsum(v, u);
      void m.relu(w, v);
      void m.relu(out, w);
    });
    expect(report.groups).toEqual([
      { calls: ['add', 'mul'], fused: true },
      {
        calls: ['pairsum', 'relu', 'relu'],
        fused: true,
        why: `mul and pairsum run as two dispatches because ${read}`,
      },
    ]);
    expect(report).toMatchObject({ dispatches: 2, submissions: 1 });
    expect(gpu.flow).toEqual([dispatch, dispatch, 'submit']);
  });

  it('splits a group at the storage buffers the device allows, and says what it counted', async () => {
    const gpu = fakeGpu({ storageBuffers: 5 });
    const m = await loadFused();
    const [t, u, out] = [zeros(4), zeros(4), zeros(4)];
    const [a, b, c] = [live(1, 2, 3, 4), live(1, 1, 1, 1), live(2, 2, 2, 2)];
    const report = await fuse(() => {
      void m.add(t, a, b);
      void m.mul(u, t, c);
      void m.relu(out, u);
    });
    expect(report.groups).toEqual([
      { calls: ['add', 'mul'], fused: true },
      {
        calls: ['relu'],
        fused: false,
        why: 'mul and relu run as two dispatches because one dispatch would bind 6 storage buffers, and the device allows 5',
      },
    ]);
    expect(report).toMatchObject({ dispatches: 2, submissions: 1 });
    expect(gpu.flow).toEqual([dispatch, dispatch, 'submit']);
  });

  it('takes 8 storage buffers for a device that reports no limit', async () => {
    fakeGpu();
    const m = await loadFused();
    // add: t1 a b (3). Each add after it binds two arrays more: 5, 7, and 9 for the fourth.
    const [t1, t2, t3, t4] = [zeros(4), zeros(4), zeros(4), zeros(4)];
    const [a, b, c, d, e] = [
      live(1, 2, 3, 4),
      live(1, 1, 1, 1),
      live(2, 2, 2, 2),
      live(3, 3, 3, 3),
      live(4, 4, 4, 4),
    ];
    const report = await fuse(() => {
      void m.add(t1, a, b);
      void m.add(t2, t1, c);
      void m.add(t3, t2, d);
      void m.add(t4, t3, e);
    });
    expect(report.groups).toEqual([
      { calls: ['add', 'add', 'add'], fused: true },
      {
        calls: ['add'],
        fused: false,
        why: 'add and add run as two dispatches because one dispatch would bind 9 storage buffers, and the device allows 8',
      },
    ]);
  });

  it('binds a host array a call reads, and an array two calls share once', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [t, u] = [zeros(4), zeros(4)];
    const a = live(1, 2, 3, 4);
    // t, a, the host array and u: four arrays and the uniform. `a` is a parameter of both calls.
    const report = await fuse(() => {
      void m.add(t, a, floats(1, 1, 1, 1));
      void m.mul(u, t, a);
    });
    expect(report.groups).toEqual([{ calls: ['add', 'mul'], fused: true }]);
    expect(gpu.binds).toEqual([5]);
  });

  it('gives each call of a group the result it gives, from its tail', async () => {
    fakeGpu();
    const m = await loadFused();
    const [t, out] = [zeros(4), zeros(4)];
    const [a, b] = [live(1, 2, 3, 4), live(1, 1, 1, 1)];
    let added: Promise<unknown> | undefined;
    let sized: Promise<unknown> | undefined;
    const report = await fuse(() => {
      added = m.add(t, a, b);
      sized = m.sized(out, t);
    });
    expect(report.groups).toEqual([{ calls: ['add', 'sized'], fused: true }]);
    await expect(added).resolves.toBeUndefined();
    await expect(sized).resolves.toBe(4);
  });

  it('builds the entry of a shape once: a second scope makes no second shader module', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const chain = async (n: number): Promise<void> => {
      const [t, out] = [zeros(n), zeros(n)];
      const [a, b] = [live(...new Array<number>(n).fill(1)), live(...new Array<number>(n).fill(2))];
      await fuse(() => {
        void m.add(t, a, b);
        void m.relu(out, t);
      });
    };
    await chain(4);
    // Other arrays of another length: the same shape, so the same entry and the same pipeline.
    await chain(300);
    expect(gpu.shaders).toHaveLength(1);
    expect(gpu.flow).toEqual([dispatch, 'submit', 'dispatch 5 1 1', 'submit']);
  });

  it('rejects when WebGPU refuses the fused module, and keeps the error on what the group writes', async () => {
    const gpu = fakeGpu({ compile: 'nope' });
    const m = await loadFused();
    const [t, out] = [zeros(4), zeros(4)];
    const [a, b] = [live(1, 2, 3, 4), live(1, 1, 1, 1)];
    await expect(
      fuse(() => {
        void m.add(t, a, b);
        void m.relu(out, t);
      }),
    ).rejects.toThrow(/^add\+relu: WebGPU refused the module's WGSL: line 1:2 nope$/);
    expect(gpu.submits).toBe(0);
    expect(kernelQueue.pending).toBe(0);
    await expect(out.read()).rejects.toThrow(/add\+relu: WebGPU refused/);
    await expect(t.read()).rejects.toThrow(/add\+relu: WebGPU refused/);
  });

  it('names the group in the error the device reports', async () => {
    fakeGpu({ validation: 'boom' });
    const m = await loadFused();
    const [t, out] = [zeros(4), zeros(4)];
    const [a, b] = [live(1, 2, 3, 4), live(1, 1, 1, 1)];
    await expect(
      fuse(() => {
        void m.add(t, a, b);
        void m.relu(out, t);
      }),
    ).rejects.toThrow(new Error('add+relu(): WebGPU refused the call: boom'));
  });

  it('says a Resident was destroyed, and submits nothing', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [t, out] = [zeros(4), zeros(4)];
    const [a, b] = [live(1, 2, 3, 4), live(1, 1, 1, 1)];
    out.destroy();
    await expect(
      fuse(() => {
        void m.add(t, a, b);
        void m.relu(out, t);
      }),
    ).rejects.toThrow('This Resident was destroyed; make a new one with resident().');
    expect(gpu.submits).toBe(0);
  });

  it('runs the calls of the scope apart when the fused entry cannot be built, and says why', async () => {
    const gpu = fakeGpu();
    const source = (name: string, scale: number): string =>
      `"use typeshade";\nconst SCALE: f32 = ${scale}.;\nexport function ${name}(out: array<f32>, x: array<f32>): void {\n  for (let i: u32 = 0; i < out.length; i++) {\n    out[i] = x[i] * SCALE;\n  }\n}\n`;
    const [left, right] = await Promise.all(
      [
        ['scaled', 2, 'left'],
        ['scaledAgain', 3, 'right'],
      ].map(async ([name, scale, file]) => {
        const g = hostFace(source(name as string, scale as number), {
          fileName: `/app/${file as string}.shade.ts`,
          runtime: RUNTIME,
          fuse: true,
        });
        expect(g.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
        return (await loadCode(g.code!, file as string)) as unknown as Record<string, Call>;
      }),
    );
    const [t, out] = [zeros(4), zeros(4)];
    const x = live(1, 2, 3, 4);
    const report = await fuse(() => {
      void left!.scaled!(t, x);
      void right!.scaledAgain!(out, t);
    });
    // Both files declare SCALE, and differently: the group cannot be one entry.
    expect(report.groups).toEqual([
      { calls: ['scaled'], fused: false },
      {
        calls: ['scaledAgain'],
        fused: false,
        why: 'scaled and scaledAgain run as two dispatches because the fused entry could not be built: const "SCALE" is declared differently in /app/left.shade.ts and in /app/right.shade.ts',
      },
    ]);
    expect(report).toMatchObject({ dispatches: 2, submissions: 1 });
    expect(gpu.flow).toEqual([dispatch, dispatch, 'submit']);
  });

  it('fuses the calls before a reduction into it, and starts a group after it', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [t, out, v] = [zeros(4), zeros(4), zeros(4)];
    const [a, b] = [live(1, 2, 3, 4), live(1, 1, 1, 1)];
    const report = await fuse(() => {
      void m.add(t, a, b);
      void m.relu(out, t);
      void m.total(out);
      void m.bump(v);
    });
    // `total` reduces, so it is the last call of its group, and `bump` starts another.
    expect(report.groups).toEqual([
      { calls: ['add', 'relu', 'total'], fused: true },
      {
        calls: ['bump'],
        fused: false,
        why: 'total and bump run as two dispatches because total reduces',
      },
    ]);
    // The reduction's dispatch and `bump` are in the one batch the plan submits.
    expect(gpu.flow).toEqual([dispatch, dispatch, 'submit']);
    expect(report).toMatchObject({ tier: 'webgpu', dispatches: 2, submissions: 1 });
  });
});

describe('a fuse scope that fuses a reduction, on a recording device', () => {
  const dispatch = 'dispatch 1 1 1';
  /** Resident arrays of `n` ones. */
  const ones = (n: number): Resident<Float32Array> => resident(new Float32Array(n).fill(1));
  /** The dispatches, the copies and the submissions of a run, in order. */
  const steps = (gpu: { commands: string[] }): string[] =>
    gpu.commands.filter((c) => /^(dispatch|copy|submit)/.test(c));
  /** The bytes of one `f32`, which a staging buffer of 4 bytes holds when it is mapped. */
  const bytesOf = (x: number): ArrayBuffer => Float32Array.of(x).buffer;
  /** What the device maps: 1, 2, 3 ... in the staging buffers of 4 bytes, which are the copies of
   *  folded slots here, and zeros in any other. */
  const counting = (): ((size: number) => ArrayBuffer) => {
    let next = 0;
    return (size) => (size === 4 ? bytesOf(++next) : new ArrayBuffer(size));
  };

  /** `add(t, a, b); mul(u, t, c); total(u)` over `n` elements, `t` and `u` scratch arrays. */
  async function chain(m: Ops, n: number) {
    const [a, b, c] = [ones(n), ones(n), ones(n)];
    let sum: Promise<unknown> | undefined;
    const report = await fuse((scope) => {
      const [t, u] = [scope.scratch(n), scope.scratch(n)];
      void m.add(t, a, b);
      void m.mul(u, t, c);
      sum = m.total(u);
    });
    return { report, sum: sum! };
  }

  it('runs add, mul and total as one group: the loop, then a fold entry for the one level', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    // 1000 elements are 4 workgroups of 256, and 4 partials are folded by one more dispatch.
    const { report, sum } = await chain(m, 1000);
    expect(report).toEqual({
      tier: 'webgpu',
      dispatches: 2,
      submissions: 1,
      groups: [{ calls: ['add', 'mul', 'total'], fused: true }],
    });
    // The partials are not read back between the levels: both dispatches are in the one
    // submission, and the copy of the folded slot follows them in it. The loop made 4 partials
    // and the fold the fifth, so the folded slot is at byte 16.
    expect(gpu.flow).toEqual(['dispatch 4 1 1', dispatch, 'submit']);
    expect(steps(gpu)).toEqual(['dispatch 4 1 1', dispatch, 'copy 4 at 16', 'submit']);
    // The report counts what the device was given.
    expect(report.dispatches).toBe(gpu.flow.filter((c) => c.startsWith('dispatch')).length);
    expect(report.submissions).toBe(gpu.submits);
    // One module for the group, which the loop entry and the fold entry share.
    expect(gpu.shaders).toHaveLength(1);
    const wgsl = gpu.shaders[0]!;
    expect(wgsl).toContain('fn fused_add_mul_total(');
    expect(wgsl).toContain('fn fused_add_mul_total_fold(');
    expect(wgsl).toContain('fn fused_add_mul_total_iteration(_k: u32) -> total_loop0_Sums {');
    expect(wgsl.match(/@compute @workgroup_size\(256\)/g)).toHaveLength(2);
    // The loop's bind group: the uniform, a, b and c, and the partials. The fold's: the uniform
    // and the partials. No binding is for t or u: both are locals of the helper.
    expect(gpu.binds).toEqual([5, 2]);
    expect(wgsl.match(/var<storage/g)).toHaveLength(4);
    expect(wgsl.match(/var _fs\d+: f32;/g)).toHaveLength(2);
    // The only buffer the device was given nothing to put in is the partials of the reduction,
    // 5 slots of 4 bytes, and the plan freed it.
    expect(gpu.zeroed).toHaveLength(1);
    expect(gpu.zeroed[0]).toMatchObject({ size: 20, destroyed: true });
    // The fake device reads zeros back; the result is what the tail makes of them.
    await expect(sum).resolves.toBe(0);
  });

  it('makes the partials once for the plan, shares them between the levels, and frees them after the read', async () => {
    let atSubmit: boolean[] = [];
    const gpu = fakeGpu({
      mapped: () => bytesOf(1.5),
      onSubmit: () => (atSubmit = gpu.zeroed.map((b) => b.destroyed)),
    });
    const m = await loadFused();
    const { report, sum } = await chain(m, 70000);
    // 274 partials of the loop, then 2 of the first level and 1 of the second: 277 slots, one
    // buffer for the three dispatches, and no host array of them.
    expect(gpu.zeroed).toHaveLength(1);
    expect(gpu.zeroed[0]).toMatchObject({ size: 277 * 4, written: false, destroyed: true });
    expect(gpu.binds).toEqual([5, 2, 2]);
    // The buffer was alive when the dispatches were submitted, and is freed after the read.
    expect(atSubmit).toEqual([false]);
    expect(report).toMatchObject({ dispatches: 3, submissions: 1 });
    // The folded slot is the first of the last level: after the 274 and the 2 slots before it.
    expect(steps(gpu)).toEqual([
      'dispatch 274 1 1',
      'dispatch 2 1 1',
      dispatch,
      `copy 4 at ${(274 + 2) * 4}`,
      'submit',
    ]);
    // What the copy holds is the result: the tail of `total` adds it to the sum's start.
    await expect(sum).resolves.toBe(1.5);
  });

  it('gives each level a uniform of its own: the count it folds, where they start, where it writes', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const x = ones(70000);
    let sum: Promise<unknown> | undefined;
    await fuse(() => {
      sum = m.total(x);
    });
    await sum;
    // The uniform of the unfused loop is `{ _start, _n, _in, _out }`, four `u32`s.
    const args = faceOf('total').gpu!.args.layout;
    expect(args.k === 'o' && args.f.map(([name]) => name)).toEqual(['_start', '_n', '_in', '_out']);
    // The three dispatches write three uniforms into the device's uniform buffer, each as it was
    // when the dispatch was taken in: a batch reads its values when it is flushed, so one object
    // changed between the levels would give all three the last level's.
    const writes = gpu.made.filter((b) => b.usage === UNIFORM_RING).flatMap((b) => b.writes);
    expect(writes.map((w) => [...new Uint32Array(w.bytes)])).toEqual([
      [0, 70000, 0, 0],
      [0, 274, 0, 274],
      [0, 2, 274, 276],
    ]);
    // Each dispatch binds the offset its uniform was written at, and no two share one.
    expect(gpu.dynamic).toEqual(writes.map((w) => [w.at]));
    expect(new Set(writes.map((w) => w.at)).size).toBe(3);
  });

  it('copies the folded slot of each variable in the one submission, and frees every partials buffer', async () => {
    const gpu = fakeGpu({ mapped: counting() });
    const m = await loadFused();
    const x = ones(1000);
    let both: Promise<unknown> | undefined;
    const report = await fuse(() => {
      both = m.spread(x);
    });
    expect(report).toMatchObject({ dispatches: 2, submissions: 1 });
    // The sum and the top are two bindings, so two buffers of 5 slots, and two copies.
    expect(steps(gpu)).toEqual([
      'dispatch 4 1 1',
      dispatch,
      'copy 4 at 16',
      'copy 4 at 16',
      'submit',
    ]);
    expect(gpu.zeroed.map((b) => [b.size, b.destroyed])).toEqual([
      [20, true],
      [20, true],
    ]);
    // The first copy is the sum's and the second the top's, in the order the function folds them.
    await expect(both).resolves.toEqual([1, 2]);
  });

  it('folds by as many levels as the length gives, each one dispatch, all in one submission', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    // 4 elements and 256 are one workgroup: the loop alone, with no partials to fold.
    expect((await chain(m, 4)).report).toMatchObject({ dispatches: 1, submissions: 1 });
    expect((await chain(m, 256)).report).toMatchObject({ dispatches: 1, submissions: 1 });
    expect(gpu.flow.slice(0, 4)).toEqual([dispatch, 'submit', dispatch, 'submit']);
    // 257 are two workgroups and one fold.
    const before = gpu.flow.length;
    expect((await chain(m, 257)).report).toMatchObject({ dispatches: 2, submissions: 1 });
    expect(gpu.flow.slice(before)).toEqual(['dispatch 2 1 1', dispatch, 'submit']);
    // 70,000 are 274 workgroups, then 2, then 1: the loop and two folds.
    const at = gpu.flow.length;
    const big = await chain(m, 70000);
    expect(big.report).toMatchObject({ dispatches: 3, submissions: 1 });
    expect(gpu.flow.slice(at)).toEqual(['dispatch 274 1 1', 'dispatch 2 1 1', dispatch, 'submit']);
    // Every scope's report is what the device was given, and one module served all of them.
    expect(gpu.shaders).toHaveLength(1);
  });

  it('makes the entry of a shape once: a scope of another length builds no second module', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    await chain(m, 300);
    await chain(m, 3000);
    expect(gpu.shaders).toHaveLength(1);
    expect(gpu.flow).toEqual([
      'dispatch 2 1 1',
      dispatch,
      'submit',
      'dispatch 12 1 1',
      dispatch,
      'submit',
    ]);
  });

  it('keeps a scratch array that the reduction and a later call share a buffer', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [a, b, out] = [live(1, 2, 3, 4), live(1, 1, 1, 1), zeros(4)];
    const report = await fuse((scope) => {
      const t = scope.scratch(4);
      void m.add(t, a, b);
      void m.total(t);
      void m.relu(out, t);
    });
    // `relu` names `t` in the group after the reduction, so `t` is a zeroed buffer, bound by both.
    expect(report.groups).toEqual([
      { calls: ['add', 'total'], fused: true },
      {
        calls: ['relu'],
        fused: false,
        why: 'total and relu run as two dispatches because total reduces',
      },
    ]);
    // `t` of 4 elements, and the partials of the reduction, one slot.
    expect(gpu.zeroed.map((b) => [b.size, b.destroyed])).toEqual([
      [16, true],
      [4, true],
    ]);
    expect(gpu.shaders[0]!.match(/var _fs/g)).toBeNull();
  });

  it('puts the reduction in the batch with the calls before it, which a later group shares', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [t, v, w, x] = [zeros(4), zeros(4), zeros(4), zeros(4)];
    const [a, b] = [live(1, 2, 3, 4), live(1, 1, 1, 1)];
    const report = await fuse(() => {
      void m.add(t, a, b);
      void m.pairsum(v, t);
      void m.relu(w, v);
      void m.mul(x, w, a);
      void m.total(x);
    });
    // `add` is a group of its own; `pairsum` starts the group that the reduction ends.
    expect(report.groups.map((g) => g.calls)).toEqual([
      ['add'],
      ['pairsum', 'relu', 'mul', 'total'],
    ]);
    // The batch holds `add` and the reduction's loop, and the plan submits it once.
    expect(gpu.flow).toEqual([dispatch, dispatch, 'submit']);
    expect(report).toMatchObject({ dispatches: 2, submissions: 1 });
  });

  it('folds by the levels a reduction outside a scope folds by', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const n = 70000;
    // The reduction alone, outside a scope: the loop and two fold levels, one submission.
    await m.total(ones(n));
    const apart = [...gpu.flow];
    expect(apart).toEqual(['dispatch 274 1 1', 'dispatch 2 1 1', dispatch, 'submit']);
    // The same reduction as the last call of a fused group: the same dispatches.
    const before = gpu.flow.length;
    await chain(m, n);
    expect(gpu.flow.slice(before)).toEqual(apart);
  });

  it('keeps a call outside a scope a submission of its own, and the levels of a reduction one', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const n = 70000;
    const out = zeros(n);
    await m.add(out, ones(n), ones(n));
    await m.total(out);
    // `add` is 1,094 workgroups of 64. The reduction after it is its loop, two levels and the
    // copy of its folded slot in a submission, as it is inside a scope.
    expect(gpu.flow).toEqual([
      'dispatch 1094 1 1',
      'submit',
      'dispatch 274 1 1',
      'dispatch 2 1 1',
      dispatch,
      'submit',
    ]);
  });

  it('runs a reduction apart from the calls before it when the entry cannot be built, and says why', async () => {
    const gpu = fakeGpu();
    const source = (name: string, scale: number, loop: string): string =>
      `"use typeshade";\nconst SCALE: f32 = ${scale}.;\nexport function ${name}${loop}\n`;
    const files = [
      [
        'left',
        source(
          'scaled',
          2,
          '(out: array<f32>, x: array<f32>): void {\n  for (let i: u32 = 0; i < out.length; i++) {\n    out[i] = x[i] * SCALE;\n  }\n}',
        ),
      ],
      [
        'right',
        source(
          'sumscaled',
          3,
          '(xs: array<f32>): f32 {\n  let s = 0.;\n  for (let i: u32 = 0; i < xs.length; i++) {\n    s += xs[i] * SCALE;\n  }\n  return s;\n}',
        ),
      ],
    ] as const;
    const [left, right] = await Promise.all(
      files.map(async ([file, code]) => {
        const g = hostFace(code, {
          fileName: `/app/${file}.shade.ts`,
          runtime: RUNTIME,
          fuse: true,
        });
        expect(g.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
        return (await loadCode(g.code!, file)) as unknown as Record<string, Call>;
      }),
    );
    const [t, x] = [zeros(4), live(1, 2, 3, 4)];
    let sum: Promise<unknown> | undefined;
    const report = await fuse(() => {
      void left!.scaled!(t, x);
      sum = right!.sumscaled!(t);
    });
    // Both files declare SCALE, and differently: the group cannot be one entry.
    expect(report.groups).toEqual([
      { calls: ['scaled'], fused: false },
      {
        calls: ['sumscaled'],
        fused: false,
        why: 'scaled and sumscaled run as two dispatches because the fused entry could not be built: const "SCALE" is declared differently in /app/left.shade.ts and in /app/right.shade.ts',
      },
    ]);
    // The batch holds `scaled` and the reduction, which runs as it does apart.
    expect(report).toMatchObject({ dispatches: 2, submissions: 1 });
    expect(gpu.flow).toEqual([dispatch, dispatch, 'submit']);
    await expect(sum).resolves.toBe(0);
  });

  it('binds a host array a call before the reduction reads, uploaded for the loop alone', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const n = 600;
    const [a, c] = [ones(n), ones(n)];
    const host = new Float32Array(n).fill(2);
    const report = await fuse((scope) => {
      const [t, u] = [scope.scratch(n), scope.scratch(n)];
      void m.add(t, a, host);
      void m.mul(u, t, c);
      void m.total(u);
    });
    expect(report.groups).toEqual([{ calls: ['add', 'mul', 'total'], fused: true }]);
    expect(report).toMatchObject({ dispatches: 2, submissions: 1 });
    // The loop binds the uniform, a, the host array, c and the partials; the fold, two.
    expect(gpu.binds).toEqual([5, 2]);
  });

  it('does not fuse a reduction alone', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const x = live(1, 2, 3, 4);
    let sum: Promise<unknown> | undefined;
    const report = await fuse(() => {
      sum = m.total(x);
    });
    expect(report).toEqual({
      tier: 'webgpu',
      dispatches: 1,
      submissions: 1,
      groups: [{ calls: ['total'], fused: false }],
    });
    expect(gpu.flow).toEqual([dispatch, 'submit']);
    // Its own module: the loop's, as outside a scope.
    expect(gpu.shaders).toHaveLength(1);
    expect(gpu.shaders[0]).toContain('fn total_loop0(');
    await expect(sum).resolves.toBe(0);
  });

  it('splits a reduction from the calls before it where its partials make one binding too many', async () => {
    const gpu = fakeGpu({ storageBuffers: 3 });
    const m = await loadFused();
    const [t, a, b] = [zeros(4), live(1, 2, 3, 4), live(1, 1, 1, 1)];
    const report = await fuse(() => {
      void m.add(t, a, b);
      void m.total(t);
    });
    // t, a and b, and the partials: four bindings, and the device allows three.
    expect(report.groups).toEqual([
      { calls: ['add'], fused: false },
      {
        calls: ['total'],
        fused: false,
        why: 'add and total run as two dispatches because one dispatch would bind 4 storage buffers, and the device allows 3',
      },
    ]);
    expect(gpu.flow).toEqual([dispatch, dispatch, 'submit']);
  });

  it('counts a scratch array as a local when the reduction joins: three bindings fit three', async () => {
    const gpu = fakeGpu({ storageBuffers: 3 });
    const m = await loadFused();
    const [a, b] = [live(1, 2, 3, 4), live(1, 1, 1, 1)];
    const report = await fuse((scope) => {
      const t = scope.scratch(4);
      void m.add(t, a, b);
      void m.total(t);
    });
    expect(report.groups).toEqual([{ calls: ['add', 'total'], fused: true }]);
    // a, b and the partials, and the uniform.
    expect(gpu.binds).toEqual([4]);
  });

  it('reads the folded value after a call that ran on the CPU tier, which saw what the plan held', async () => {
    const gpu = fakeGpu({ mapped: counting() });
    const m = await loadFused();
    const [t, a, b] = [zeros(4), live(1, 2, 3, 4), live(1, 1, 1, 1)];
    let sum: Promise<unknown> | undefined;
    const report = await fuse(() => {
      void m.add(t, a, b);
      void m.prefix(t);
      sum = m.total(t);
    });
    expect(report.groups.map((g) => g.calls)).toEqual([['add'], ['prefix'], ['total']]);
    // `add` is submitted, and `t` is read for `prefix`, which runs on the host; `total` then
    // takes the host copy to the device again, and its dispatch is the last submission, with
    // the copy of its folded slot.
    expect(steps(gpu)).toEqual([
      dispatch,
      'submit',
      'copy 16 at 0',
      'submit',
      dispatch,
      'copy 4 at 0',
      'submit',
    ]);
    expect(report).toMatchObject({ tier: 'webgpu', dispatches: 2, submissions: 3 });
    await expect(sum).resolves.toBe(1);
  });

  it('submits a reduction before a call on the CPU tier that follows it, and reads what the group wrote', async () => {
    const gpu = fakeGpu({ mapped: counting() });
    const m = await loadFused();
    const [t, a, b] = [zeros(4), live(1, 2, 3, 4), live(1, 1, 1, 1)];
    let sum: Promise<unknown> | undefined;
    const report = await fuse(() => {
      void m.add(t, a, b);
      sum = m.total(t);
      void m.prefix(t);
    });
    // `add` and `total` are one group over the Resident `t`, which the loop writes. `prefix`
    // runs on the host: the plan submits the group first, with the copy of the folded slot in it,
    // and then reads `t`, so `prefix` sees what `add` wrote.
    expect(report.groups.map((g) => g.calls)).toEqual([['add', 'total'], ['prefix']]);
    expect(steps(gpu)).toEqual([dispatch, 'copy 4 at 0', 'submit', 'copy 16 at 0', 'submit']);
    expect(report).toMatchObject({ tier: 'webgpu', dispatches: 1, submissions: 2 });
    await expect(sum).resolves.toBe(1);
  });

  it('rejects when WebGPU refuses the module, names the group, and keeps the error on what it writes', async () => {
    const gpu = fakeGpu({ compile: 'nope' });
    const m = await loadFused();
    const [t, a, b] = [zeros(4), live(1, 2, 3, 4), live(1, 1, 1, 1)];
    await expect(
      fuse(() => {
        void m.add(t, a, b);
        void m.total(t);
      }),
    ).rejects.toThrow(/^add\+total: WebGPU refused the module's WGSL: line 1:2 nope$/);
    expect(gpu.submits).toBe(0);
    expect(kernelQueue.pending).toBe(0);
    await expect(t.read()).rejects.toThrow(/add\+total: WebGPU refused/);
    // The partials were made before the pipeline failed, and are freed.
    expect(gpu.zeroed).toHaveLength(1);
    expect(gpu.zeroed[0]!.destroyed).toBe(true);
  });

  it('names the group in the error the device reports for the submission, and frees the partials', async () => {
    const gpu = fakeGpu({ validation: 'boom' });
    const m = await loadFused();
    const n = 1000;
    const [a, b, c] = [ones(n), ones(n), ones(n)];
    let sum: Promise<unknown> | undefined;
    await expect(
      fuse((scope) => {
        const t = scope.scratch(n);
        const u = scope.scratch(n);
        void m.add(t, a, b);
        void m.mul(u, t, c);
        sum = m.total(u);
      }),
    ).rejects.toThrow(new Error('add+mul+total(): WebGPU refused the calls: boom'));
    // The call that reduces rejects with it, and the copy of its folded slot is dropped.
    await expect(sum).rejects.toThrow('boom');
    expect(gpu.submits).toBe(1);
    expect(kernelQueue.pending).toBe(0);
    await new Promise((done) => setTimeout(done, 0));
    expect(gpu.zeroed).toHaveLength(1);
    expect(gpu.zeroed[0]!.destroyed).toBe(true);
  });
});

describe('the uniforms and bind groups a device keeps across scopes, on a recording device', () => {
  const dispatch = 'dispatch 1 1 1';

  it('makes no buffer and no bind group in a second scope over the same Residents, and writes its uniform again', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [t, u, out] = [zeros(4), zeros(4), zeros(4)];
    const [a, b, c] = [live(1, 2, 3, 4), live(1, 1, 1, 1), live(2, 2, 2, 2)];
    const run = () =>
      fuse(() => {
        void m.add(t, a, b);
        void m.mul(u, t, c);
        void m.relu(out, u);
      });
    const first = await run();
    const before = { made: gpu.made.length, binds: gpu.binds.length, writes: gpu.writes };
    const cacheBefore = bindCacheStats(gpu.device);
    const second = await run();
    // Every group of the second scope is a cache hit, and the cache did not clear.
    const cacheAfter = bindCacheStats(gpu.device);
    expect(cacheAfter.misses - cacheBefore.misses).toBe(0);
    expect(cacheAfter.hits - cacheBefore.hits).toBeGreaterThan(0);
    expect(cacheAfter.clears).toBe(cacheBefore.clears);
    // The second scope made nothing: the uniform buffer, the bind group and the Residents' buffers
    // are the first scope's, and the uniform is written into the same offset of the same buffer.
    expect(gpu.made.length - before.made).toBe(0);
    expect(gpu.binds.length - before.binds).toBe(0);
    expect(gpu.writes - before.writes).toBe(1);
    expect(gpu.dynamic.at(-1)).toEqual(gpu.dynamic[0]);
    expect(gpu.flow.slice(-2)).toEqual([dispatch, 'submit']);
    // The same dispatches and the same report: the cache changes what the host makes, not the run.
    expect(second).toEqual(first);
  });

  it('makes a bind group for a Resident that is another buffer, and reuses each one after', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [t, u, out] = [zeros(4), zeros(4), zeros(4)];
    const [a, a2, b, c] = [live(1, 2, 3, 4), live(1, 2, 3, 4), live(1, 1, 1, 1), live(2, 2, 2, 2)];
    const run = (x: Resident<Float32Array>) =>
      fuse(() => {
        void m.add(t, x, b);
        void m.mul(u, t, c);
        void m.relu(out, u);
      });
    await run(a);
    const binds = gpu.binds.length;
    await run(a2);
    // The other Resident is another buffer, so the group over it is made once.
    expect(gpu.binds.length - binds).toBe(1);
    const again = gpu.binds.length;
    await run(a);
    await run(a2);
    expect(gpu.binds.length - again).toBe(0);
  });

  it('drops the bind groups over a destroyed Resident: a use after the destroy is refused, and a new Resident is a new buffer', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [t, u, out] = [zeros(4), zeros(4), zeros(4)];
    const [a, b, c] = [live(1, 2, 3, 4), live(1, 1, 1, 1), live(2, 2, 2, 2)];
    const run = (x: Resident<Float32Array>) =>
      fuse(() => {
        void m.add(t, x, b);
        void m.mul(u, t, c);
        void m.relu(out, u);
      });
    await run(a);
    const destroyed = gpu.made.filter((x) => x.usage === RESIDENT_BUFFER && x.destroyed).length;
    a.destroy();
    // The Resident's device buffer is destroyed with it, and nothing of it is bound again.
    expect(gpu.made.filter((x) => x.usage === RESIDENT_BUFFER && x.destroyed).length).toBe(
      destroyed + 1,
    );
    await expect(run(a)).rejects.toThrow(/destroyed/);
    const same = live(1, 2, 3, 4);
    const binds = gpu.binds.length;
    await run(same);
    expect(gpu.binds.length - binds).toBe(1);
  });

  it('grows the uniform buffer inside one flush: every dispatch of it binds the new buffer, and the groups over the old one are dropped', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [x, y, out] = [live(1, 2, 3, 4), live(1, 1, 1, 1), zeros(4)];
    const small = () =>
      fuse(() => {
        void m.add(out, x, y);
      });
    // Twenty calls that each read the one before at another index: no two fuse, 20 uniforms.
    const big = () =>
      fuse(() => {
        for (let i = 0; i < 10; i++) {
          void m.pairsum(x, y);
          void m.pairsum(y, x);
        }
      });
    await small();
    const rings = () => gpu.made.filter((b) => b.usage === UNIFORM_RING);
    expect(rings()).toHaveLength(1);
    const old = rings()[0]!;
    const report = await big();
    expect(report.dispatches).toBe(20);
    expect(rings()).toHaveLength(2);
    const grown = rings()[1]!;
    // The first buffer is destroyed once, after its own single write; the 20 uniforms of the flush
    // are all in the second one, at distinct offsets that are multiples of 256, inside its size.
    expect(old.destroyed).toBe(true);
    expect(old.writes).toHaveLength(1);
    expect(grown.destroyed).toBe(false);
    expect(grown.writes).toHaveLength(20);
    const offsets = grown.writes.map((w) => w.at);
    expect(new Set(offsets).size).toBe(20);
    expect(offsets.every((at) => at % 256 === 0 && at + 16 <= grown.size)).toBe(true);
    expect(gpu.dynamic.slice(-20)).toEqual(offsets.map((at) => [at]));
    // The groups over the old buffer are gone: the small scope makes its group again.
    const misses = bindCacheStats(gpu.device).misses;
    await small();
    expect(bindCacheStats(gpu.device).misses - misses).toBe(1);
    expect(rings()).toHaveLength(2);
  });

  it('keeps the bind group of a zeroed Resident, and drops it when the Resident is destroyed or a write changes its length', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [a, b, c, out] = [live(1, 2, 3, 4), live(1, 1, 1, 1), live(2, 2, 2, 2), zeros(4)];
    const z = resident(4, 'f32');
    const run = () =>
      fuse((scope) => {
        const t = scope.scratch(4);
        void m.add(t, a, b);
        void m.mul(z, t, c);
        void m.relu(out, z);
      });
    await run();
    const first = bindCacheStats(gpu.device);
    await run();
    // The zeroed Resident is kept like any other: the second scope hits the cache.
    const second = bindCacheStats(gpu.device);
    expect(second.misses).toBe(first.misses);
    expect(second.hits).toBeGreaterThan(first.hits);
    // A write that changes the length is another buffer: the group over the first is dropped and
    // the next scope makes one over the second.
    z.write(floats(1, 2, 3, 4, 5, 6));
    out.write(floats(1, 2, 3, 4, 5, 6));
    const before = bindCacheStats(gpu.device);
    await fuse(() => {
      void m.relu(out, z);
    });
    const after = bindCacheStats(gpu.device);
    expect(after.misses - before.misses).toBe(1);
    expect(after.groups).toBeLessThan(second.groups + 1);
    z.destroy();
    await kernelQueue.whenIdle(() => undefined);
    expect(bindCacheStats(gpu.device).groups).toBeLessThan(after.groups);
  });

  it('keeps no group or key for a scratch array once its scope ran: many scopes leave the cache as small as one', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [a, b, c, out] = [live(1, 2, 3, 4), live(1, 1, 1, 1), live(2, 2, 2, 2), zeros(4)];
    const u2 = zeros(4);
    // pairsum reads t at another index, so the scratch array stays a buffer.
    const run = () =>
      fuse((scope) => {
        const t = scope.scratch(4);
        void m.add(t, a, b);
        void m.pairsum(out, t);
        void m.mul(u2, out, c);
      });
    await run();
    const one = bindCacheStats(gpu.device);
    for (let i = 0; i < 40; i++) await run();
    const many = bindCacheStats(gpu.device);
    expect(many.groups).toBe(one.groups);
    expect(many.keys).toBe(one.keys);
    expect(many.clears).toBe(0);
  });

  it('uploads a write of the same length into the Resident buffer it has, and makes nothing', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [t, u, out] = [zeros(4), zeros(4), zeros(4)];
    const [a, b, c] = [live(1, 2, 3, 4), live(1, 1, 1, 1), live(2, 2, 2, 2)];
    const run = () =>
      fuse(() => {
        void m.add(t, a, b);
        void m.mul(u, t, c);
        void m.relu(out, u);
      });
    await run();
    // Replacing a Resident's contents with the same length uploads them into the same buffer.
    a.write(floats(4, 3, 2, 1));
    const made = gpu.made.length;
    await run();
    expect(gpu.made.length - made).toBe(0);
  });
});

describe('a dispatch batch that is asked to read', () => {
  /** `GPUBufferUsage.COPY_SRC`, which the specification fixes. */
  const COPY_SRC = 4;

  it('copies the bytes after its dispatches, in its one submission, and resolves to them', async () => {
    const gpu = fakeGpu({ mapped: () => Float32Array.of(2.5).buffer });
    const d = (await gpuDevice())!;
    const batch = new DispatchBatch(d);
    const read = batch.read(d.createBuffer({ size: 16, usage: STORAGE | COPY_SRC }), 8, 4);
    await batch.flush();
    // A read alone is still one submission, with the copy in it.
    expect(gpu.commands.filter((c) => c.startsWith('copy') || c === 'submit')).toEqual([
      'copy 4 at 8',
      'submit',
    ]);
    expect((await read).getFloat32(0, true)).toBe(2.5);
    // The staging buffer is freed once it is read.
    expect(gpu.made.filter((b) => b.size === 4).every((b) => b.destroyed)).toBe(true);
    // The batch can be filled again: the read is not made twice.
    await batch.flush();
    expect(gpu.submits).toBe(1);
  });

  it('fails the read of a batch that is discarded, and submits nothing', async () => {
    const gpu = fakeGpu();
    const d = (await gpuDevice())!;
    const batch = new DispatchBatch(d);
    const read = batch.read(d.createBuffer({ size: 16, usage: STORAGE | COPY_SRC }), 0, 4);
    batch.discard();
    await expect(read).rejects.toThrow('The batch was discarded.');
    await batch.flush();
    expect(gpu.submits).toBe(0);
  });

  it('fails the read of a submission the device refuses', async () => {
    const gpu = fakeGpu({ validation: 'boom' });
    const d = (await gpuDevice())!;
    const batch = new DispatchBatch(d);
    const read = batch.read(d.createBuffer({ size: 16, usage: STORAGE | COPY_SRC }), 0, 4);
    await expect(batch.flush()).rejects.toThrow('WebGPU refused');
    await expect(read).rejects.toThrow('boom');
    expect(gpu.submits).toBe(1);
  });
});

describe('a fuse scope that could fuse, with no WebGPU', () => {
  it('runs a reduction after the calls it could fuse with, and gives their sum', async () => {
    const m = await loadFused();
    const [a, b, c] = [live(1, 2, 3, 4), live(1, 1, 1, 1), live(2, 2, 2, 2)];
    let sum: Promise<unknown> | undefined;
    const report = await fuse((scope) => {
      const [t, u] = [scope.scratch(4), scope.scratch(4)];
      void m.add(t, a, b);
      void m.mul(u, t, c);
      sum = m.total(u);
    });
    // ((1 + 1) + (2 + 1) + (3 + 1) + (4 + 1)) * 2 = 28, summed in the tree order.
    await expect(sum).resolves.toBe(28);
    expect(report).toEqual({
      tier: 'cpu',
      dispatches: 0,
      submissions: 0,
      groups: [
        { calls: ['add'], fused: false },
        { calls: ['mul'], fused: false },
        { calls: ['total'], fused: false },
      ],
    });
  });

  it('runs the calls one after another on the CPU tier and says nothing of it', async () => {
    const m = await loadFused();
    const [t, u, out] = [zeros(4), zeros(4), zeros(4)];
    const [a, b, c] = [live(1, -2, 3, -4), live(1, 1, 1, 1), live(2, 2, 2, 2)];
    const report = await fuse(() => {
      void m.add(t, a, b);
      void m.mul(u, t, c);
      void m.relu(out, u);
    });
    expect(await out.read()).toEqual(floats(4, 0, 8, 0));
    expect(report).toEqual({
      tier: 'cpu',
      dispatches: 0,
      submissions: 0,
      groups: [
        { calls: ['add'], fused: false },
        { calls: ['mul'], fused: false },
        { calls: ['relu'], fused: false },
      ],
    });
  });
});

// ─── scratch arrays ────────────────────────────────────────────────────────────────────────────

const ints = (...xs: number[]): Resident<Int32Array> => resident(Int32Array.of(...xs));

describe('a scratch array on the CPU tier', () => {
  it('runs a chain over scratch arrays and gives the values of the same chain over residents', async () => {
    const m = await load();
    const [a, b, c, out] = [live(1, -2, 3, -4), live(1, 1, 1, 1), live(2, 2, 2, 2), zeros(4)];
    let t: Resident<Float32Array> | undefined;
    let u: Resident<Float32Array> | undefined;
    const report = await fuse((scope) => {
      t = scope.scratch(4);
      u = scope.scratch(4);
      void m.add(t, a, b);
      void m.mul(u, t, c);
      void m.relu(out, u);
    });
    expect(await out.read()).toEqual(floats(4, 0, 8, 0));
    // Nothing is dispatched, and the three calls are three groups, as with residents.
    expect(report).toEqual({
      tier: 'cpu',
      dispatches: 0,
      submissions: 0,
      groups: [
        { calls: ['add'], fused: false },
        { calls: ['mul'], fused: false },
        { calls: ['relu'], fused: false },
      ],
    } satisfies FuseReport);
    // The plan has run: the arrays and their elements are gone.
    for (const x of [t, u]) {
      const state = residentState(x!) as ScratchState;
      expect(state).toBeInstanceOf(ScratchState);
      expect([state.phase, state.host, state.gpu]).toEqual(['done', undefined, undefined]);
    }
  });

  it('holds zeros when the plan starts, as a new buffer does', async () => {
    const m = await load();
    const [a, out, again] = [live(3, -1, 2, -5), zeros(4), zeros(4)];
    await fuse((scope) => {
      const t = scope.scratch(4);
      // a + 0, and then `bump` makes the zeros ones.
      void m.add(out, a, t);
      void m.bump(t);
      void m.relu(again, t);
    });
    expect(await out.read()).toEqual(floats(3, -1, 2, -5));
    expect(await again.read()).toEqual(floats(1, 1, 1, 1));
  });

  it('makes the elements of an array when the first call that runs on the host needs them', async () => {
    const m = await load();
    const out = zeros(3);
    let seen: unknown;
    await fuse((scope) => {
      const t = scope.scratch(3);
      void m.bump(t);
      void m.relu(out, t);
      seen = residentState(t) as ScratchState;
      // The body has recorded the calls and run none: the array holds nothing yet.
      expect((seen as ScratchState).host).toBeUndefined();
    });
    expect(await out.read()).toEqual(floats(1, 1, 1));
    expect((seen as ScratchState).host).toBeUndefined();
  });

  it('takes i32 and u32 scratch arrays through arrays of their type', async () => {
    const m = await load();
    const [ia, ib, iout] = [ints(1, -2, 3), ints(10, 10, 10), ints(0, 0, 0)];
    const [ua, ub] = [resident(Uint32Array.of(1, 2, 3)), resident(Uint32Array.of(4, 5, 6))];
    const uout = resident(new Uint32Array(3));
    await fuse((scope) => {
      const t = scope.scratch(3, 'i32');
      void m.iadd(t, ia, ib);
      void m.iadd(iout, t, ib);
      const w = scope.scratch(3, 'u32');
      void m.uadd(w, ua, ub);
      void m.uadd(uout, w, ub);
    });
    expect(await iout.read()).toEqual(Int32Array.of(21, 18, 23));
    expect(await uout.read()).toEqual(Uint32Array.of(9, 12, 15));
  });
});

/** A canvas for Node, as `src/compiler/ts/host-draw.test.ts` has it: one `2d` context, whose
 *  pixels a test reads. A draw that is refused paints nothing. */
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

/** Run `f` while `OffscreenCanvas` is the fake, which a draw looks for, and take it away after. */
async function withCanvas<T>(f: () => Promise<T>): Promise<T> {
  const g = globalThis as Record<string, unknown>;
  g['OffscreenCanvas'] = FakeCanvas;
  g['ImageData'] = FakeImageData;
  try {
    return await f();
  } finally {
    delete g['OffscreenCanvas'];
    delete g['ImageData'];
  }
}

/** The red channel of each pixel of a canvas that was painted. */
const reds = (c: FakeCanvas): number[] => [...c.pixels!].filter((_, i) => i % 4 === 0);

describe('what a scratch array refuses', () => {
  const noRead =
    'read(): this is a scratch array, which the host never reads. Make it with resident() to read it after the scope.';
  const noWrite =
    'write(): this is a scratch array, which the host never writes. Make it with resident() to write it.';

  it('rejects read() at any time, inside the body, after it and after the plan', async () => {
    const m = await load();
    const out = zeros(2);
    let t: Resident<Float32Array> | undefined;
    let inside: Promise<unknown> | undefined;
    const done = fuse((scope) => {
      t = scope.scratch(2);
      void m.bump(t);
      void m.relu(out, t);
      inside = t.read();
    });
    // The body returned: the plan has not run yet.
    await expect(t!.read()).rejects.toThrow(new TypeError(noRead));
    await expect(inside).rejects.toThrow(new TypeError(noRead));
    await done;
    await expect(t!.read()).rejects.toThrow(new TypeError(noRead));
    expect(await out.read()).toEqual(floats(1, 1));
  });

  it('throws on write(), and does nothing on destroy()', async () => {
    const m = await load();
    let t: Resident<Float32Array> | undefined;
    await fuse((scope) => {
      t = scope.scratch(2);
      expect(() => t!.write(floats(1, 2))).toThrow(new TypeError(noWrite));
      // The plan owns the array: destroying the handle is allowed, and changes nothing.
      expect(() => t!.destroy()).not.toThrow();
      void m.bump(t);
    });
    expect(() => t!.write(floats(1, 2))).toThrow(new TypeError(noWrite));
    expect(() => t!.destroy()).not.toThrow();
    expect(kernelQueue.pending).toBe(0);
  });

  it('refuses a call that takes it after the plan has run', async () => {
    const m = await load();
    const out = zeros(2);
    let t: Resident<Float32Array> | undefined;
    await fuse((scope) => {
      t = scope.scratch(2);
      void m.bump(t);
    });
    const after =
      'relu(): parameter "x" is a scratch array of a fuse() scope whose plan has run. A scratch array lives only until its plan has run.';
    // Outside a scope: the call is rejected, and keeps its error on what it writes.
    await expect(m.relu(out, t!)).rejects.toThrow(new TypeError(after));
    await expect(out.read()).rejects.toThrow(after);
    // Inside another scope the call is refused as it is made.
    await expect(
      fuse(() => {
        void m.relu(zeros(2), t!);
      }),
    ).rejects.toThrow(new TypeError(after));
    // Writing it is refused the same way.
    await expect(m.bump(t!)).rejects.toThrow(
      'bump(): parameter "xs" is a scratch array of a fuse() scope whose plan has run.',
    );
  });

  it('refuses a call that takes it outside the scope that made it', async () => {
    const m = await load();
    const [out, other] = [zeros(2), zeros(2)];
    let t: Resident<Float32Array> | undefined;
    // A second scope's body runs while the first scope's plan has not: the array is still its own.
    const first = fuse((scope) => {
      t = scope.scratch(2);
      void m.bump(t);
    });
    await expect(
      fuse(() => {
        void m.relu(other, t!);
      }),
    ).rejects.toThrow(
      new TypeError(
        'relu(): parameter "x" is a scratch array. Only the kernel calls in the body of the fuse() scope that made it may take it.',
      ),
    );
    await first;
    // And a call outside any scope, before the plan ran, queues after it, and finds it done.
    await expect(m.relu(out, t!)).rejects.toThrow(/whose plan has run/);
  });

  it('refuses a scope view used after the body returned', async () => {
    let view: FuseScope | undefined;
    await fuse((scope) => {
      view = scope;
    });
    expect(() => view!.scratch(2)).toThrow(
      new TypeError(
        'scratch(): the body of this fuse() scope has returned. Make a scratch array while the body runs, and use it there.',
      ),
    );
  });

  it('refuses a length that is not a whole number from 0 to 4294967295', async () => {
    const message = (got: string) =>
      new TypeError(
        `scratch(): takes a length that is a whole number from 0 to 4294967295; got ${got}.`,
      );
    await fuse((scope) => {
      expect(() => scope.scratch(1.5)).toThrow(message('number 1.5'));
      expect(() => scope.scratch(-1)).toThrow(message('number -1'));
      expect(() => scope.scratch(Number.NaN)).toThrow(message('number NaN'));
      expect(() => scope.scratch(Infinity)).toThrow(message('number Infinity'));
      expect(() => scope.scratch(2 ** 32)).toThrow(message('number 4294967296'));
      expect(() => scope.scratch('3' as never)).toThrow(message('the string "3"'));
      expect(() => scope.scratch(undefined as never)).toThrow(message('undefined undefined'));
      // The limits are in.
      expect(() => scope.scratch(0)).not.toThrow();
      expect(() => scope.scratch(2 ** 32 - 1)).not.toThrow();
    });
  });

  it('refuses an element that is not f32, i32 or u32', async () => {
    await fuse((scope) => {
      for (const bad of ['f64', 'vec2', '', 'toString'])
        expect(() => scope.scratch(2, bad as never)).toThrow(
          new TypeError(
            `scratch(): the element is 'f32', 'i32' or 'u32'; got the string "${bad}".`,
          ),
        );
      expect(() => scope.scratch(2, 7 as never)).toThrow(/got number 7/);
      // Left out is f32.
      expect(() => scope.scratch(2, undefined)).not.toThrow();
    });
  });

  it('refuses an empty scratch array where a call takes it, as an empty resident is refused', async () => {
    const m = await load();
    const out = zeros(2);
    await expect(
      fuse((scope) => {
        void m.relu(out, scope.scratch(0));
      }),
    ).rejects.toThrow(
      new TypeError(
        'relu(): parameter "x" (array<f32>): got an empty array, which WebGPU cannot bind.',
      ),
    );
    await expect(m.relu(out, resident(new Float32Array(0)))).rejects.toThrow(
      new TypeError(
        'relu(): parameter "x" (array<f32>): got an empty array, which WebGPU cannot bind.',
      ),
    );
  });

  it('refuses a scratch array of one element type where a parameter takes another', async () => {
    const m = await load();
    await expect(
      fuse((scope) => {
        void m.iadd(ints(0, 0), scope.scratch(2), ints(1, 1));
      }),
    ).rejects.toThrow(
      new TypeError(
        'iadd(): parameter "a" (array<i32>): got a scratch array of f32 numbers, which only an array<f32> takes.',
      ),
    );
    await expect(
      fuse((scope) => {
        void m.relu(zeros(2), scope.scratch(2, 'u32') as never);
      }),
    ).rejects.toThrow(/got a scratch array of u32 numbers, which only an array<u32> takes/);
  });

  it('leaves the arrays of a body that threw freed, and refuses them after', async () => {
    const m = await load();
    let t: Resident<Float32Array> | undefined;
    await expect(
      fuse((scope) => {
        t = scope.scratch(2);
        throw new Error('the body failed');
      }),
    ).rejects.toThrow('the body failed');
    expect((residentState(t!) as ScratchState).phase).toBe('done');
    await expect(m.bump(t!)).rejects.toThrow(/whose plan has run/);
  });

  it('refuses one scratch array as two parameters of one call, as it refuses a resident', async () => {
    const m = await load();
    await expect(
      fuse((scope) => {
        const t = scope.scratch(2);
        void m.add(zeros(2), t, t);
      }),
    ).rejects.toThrow(
      new TypeError('add(): parameter "b" is the same resident array as parameter "a".'),
    );
  });

  it('is refused by an entry call, which cannot run inside the body, and by a draw', async () => {
    const m = await load();
    await expect(
      fuse((scope) => {
        void m.fill({ sink: scope.scratch(2) }, 1);
      }),
    ).rejects.toThrow(/an entry call cannot run inside fuse\(\)/);
  });

  it('gives an entry call in the body the refusal of the body, before it looks at a scratch array', async () => {
    const m = await load();
    const inBody =
      'fill(): an entry call cannot run inside fuse(), which records kernel calls only. Call it outside fuse().';
    await expect(
      fuse((scope) => {
        void m.fill({ sink: scope.scratch(2) }, 1);
      }),
    ).rejects.toThrow(new TypeError(inBody));
    // The array of a scope that has run, taken in the body of another: the same refusal.
    let t: Resident<Float32Array> | undefined;
    await fuse((scope) => {
      t = scope.scratch(2);
      void m.bump(t);
    });
    await expect(
      fuse(() => {
        void m.fill({ sink: t! }, 1);
      }),
    ).rejects.toThrow(new TypeError(inBody));
  });

  it('refuses an entry call that takes it after the plan has run, with the words of a kernel call', async () => {
    const m = await load();
    let t: Resident<Float32Array> | undefined;
    await fuse((scope) => {
      t = scope.scratch(2);
      void m.bump(t);
    });
    const after =
      ' is a scratch array of a fuse() scope whose plan has run. A scratch array lives only until its plan has run.';
    // The words after the name of what takes the array are one sentence for both calls.
    await expect(m.bump(t!)).rejects.toThrow(new TypeError(`bump(): parameter "xs"${after}`));
    await expect(m.fill({ sink: t! }, 1)).rejects.toThrow(
      new TypeError(`fill(): binding "sink"${after}`),
    );
    // The refused call leaves the entry callable: a `resident()` binding still runs.
    const sink = zeros(2);
    await m.fill({ sink }, 1);
    expect(await sink.read()).toEqual(floats(1, 1));
  });

  it('refuses an entry call made outside any scope before the plan ran, which queues after the plan', async () => {
    const m = await load();
    let t: Resident<Float32Array> | undefined;
    const first = fuse((scope) => {
      t = scope.scratch(2);
      void m.bump(t);
    });
    // The body returned and the plan has not run. The call waits for it, and finds the array done.
    await expect(m.fill({ sink: t! }, 1)).rejects.toThrow(
      new TypeError(
        'fill(): binding "sink" is a scratch array of a fuse() scope whose plan has run. A scratch array lives only until its plan has run.',
      ),
    );
    await first;
  });

  it('refuses an entry call that takes it before the device is asked for anything', async () => {
    const gpu = fakeGpu();
    const m = await load();
    let t: Resident<Float32Array> | undefined;
    await fuse((scope) => {
      t = scope.scratch(2);
      void m.bump(t);
    });
    const [made, commands] = [gpu.made.length, gpu.commands.length];
    await expect(m.fill({ sink: t! }, 1)).rejects.toThrow(
      new TypeError(
        'fill(): binding "sink" is a scratch array of a fuse() scope whose plan has run. A scratch array lives only until its plan has run.',
      ),
    );
    expect([gpu.made.length, gpu.commands.length]).toEqual([made, commands]);
    // A call that is not refused reaches the device, so the counts above show the refusal first.
    await m.fill({ sink: zeros(2) }, 1);
    expect(gpu.commands.length).toBeGreaterThan(commands);
  });

  it('gives a draw in the body the refusal of the body, before it looks at a scratch array', async () => {
    const m = await load();
    const inBody =
      'show(): a draw cannot run inside fuse(), which records kernel calls only. Call it outside fuse().';
    await withCanvas(async () => {
      await expect(
        fuse((scope) => {
          void m.show(new FakeCanvas(4, 1), { data: scope.scratch(4) });
        }),
      ).rejects.toThrow(new TypeError(inBody));
      // The array of a scope that has run, taken in the body of another: the same refusal.
      let t: Resident<Float32Array> | undefined;
      await fuse((scope) => {
        t = scope.scratch(4);
        void m.bump(t);
      });
      await expect(
        fuse(() => {
          void m.show(new FakeCanvas(4, 1), { data: t! });
        }),
      ).rejects.toThrow(new TypeError(inBody));
    });
  });

  it('refuses a draw that takes it after the plan has run, with the words of a kernel call', async () => {
    const m = await load();
    let t: Resident<Float32Array> | undefined;
    await fuse((scope) => {
      t = scope.scratch(4);
      void m.bump(t);
    });
    const after =
      ' is a scratch array of a fuse() scope whose plan has run. A scratch array lives only until its plan has run.';
    await withCanvas(async () => {
      const canvas = new FakeCanvas(4, 1);
      // The words after the name of what takes the array are the kernel call's, as the entry's are.
      await expect(m.bump(t!)).rejects.toThrow(new TypeError(`bump(): parameter "xs"${after}`));
      await expect(m.show(canvas, { data: t! })).rejects.toThrow(
        new TypeError(`show(): binding "data"${after}`),
      );
      // The refused draw painted nothing, and a draw is still a draw: a `resident()` paints.
      expect(canvas.pixels).toBeUndefined();
      await m.show(canvas, { data: live(0.25, 0.5, 0.75, 1) });
      expect(reds(canvas)).toEqual([64, 128, 191, 255]);
    });
  });

  it('refuses a draw made before the plan ran, which checks its bindings as it is called', async () => {
    const m = await load();
    let t: Resident<Float32Array> | undefined;
    const first = fuse((scope) => {
      t = scope.scratch(4);
      void m.bump(t);
    });
    await withCanvas(async () => {
      // The body returned and the plan has not run: the array is still its scope's, and a draw
      // does not wait for the queue to check what it is given, as an entry call does.
      await expect(m.show(new FakeCanvas(4, 1), { data: t! })).rejects.toThrow(
        new TypeError(
          'show(): binding "data" is a scratch array. Only the kernel calls in the body of the fuse() scope that made it may take it.',
        ),
      );
    });
    await first;
  });
});

describe('a scratch array on a recording device', () => {
  const dispatch = 'dispatch 1 1 1';
  /** The line of `OPS` that `pairsum` reads `t[i ^ 1]` on, as the report words it. */
  const pairsumLine = OPS.split('\n').findIndex((l) => l.includes('t[i ^ 1]')) + 1;
  const read = `pairsum reads \`t[i ^ 1]\` (line ${pairsumLine})`;

  it('holds two scratch arrays as locals: one dispatch, no binding, no buffer and no host array', async () => {
    let t: Resident<Float32Array> | undefined;
    let u: Resident<Float32Array> | undefined;
    /** What each scratch array held when the dispatch was submitted. */
    let held: { host: unknown; gpu: unknown }[] = [];
    const gpu = fakeGpu({
      onSubmit: () => {
        held = [t, u].map((x) => {
          const s = residentState(x!)!;
          return { host: s.host, gpu: s.gpu };
        });
      },
    });
    const m = await loadFused();
    const [a, b, c, out] = [live(1, 2, 3, 4), live(1, 1, 1, 1), live(2, 2, 2, 2), zeros(4)];
    const report = await fuse((scope) => {
      t = scope.scratch(4);
      u = scope.scratch(4);
      void m.add(t, a, b);
      void m.mul(u, t, c);
      void m.relu(out, u);
    });
    expect(report).toEqual({
      tier: 'webgpu',
      dispatches: 1,
      submissions: 1,
      groups: [{ calls: ['add', 'mul', 'relu'], fused: true }],
    });
    expect(gpu.flow).toEqual([dispatch, 'submit']);
    // One shader module. The uniform and a, b, c and out: five resources in one bind group.
    expect(gpu.shaders).toHaveLength(1);
    expect(gpu.binds).toEqual([5]);
    // The WGSL declares four storage bindings, none for t or u, and a var local for each of them.
    const wgsl = gpu.shaders[0]!;
    expect(wgsl.match(/var<storage/g)).toHaveLength(4);
    expect(wgsl.match(/var _fs\d+: f32;/g)).toHaveLength(2);
    // Nothing was made for them: no host array, no device buffer, and no zeroed buffer at all.
    expect(held).toEqual([
      { host: undefined, gpu: undefined },
      { host: undefined, gpu: undefined },
    ]);
    expect(gpu.zeroed).toEqual([]);
    // The four residents are the only buffers of the size of an array, and the uniform's is
    // the other: no buffer is made for t or u.
    expect(gpu.made.filter((x) => x.size === 16).length).toBe(4);
    expect(batchMade(gpu).map((x) => x.size)).toEqual([]);
    // The uniform is 32 bytes, written at the start of the device's uniform buffer.
    expect(
      gpu.made
        .filter((x) => x.usage === UNIFORM_RING)
        .flatMap((x) => x.writes.map((w) => [w.at, w.bytes.byteLength])),
    ).toEqual([[0, 32]]);
  });

  it('makes the same entry for the same chain over residents: only the buffers and the locals differ', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [a, b, c, out, t, u] = [
      live(1, 2, 3, 4),
      live(1, 1, 1, 1),
      live(2, 2, 2, 2),
      zeros(4),
      zeros(4),
      zeros(4),
    ];
    await fuse(() => {
      void m.add(t, a, b);
      void m.mul(u, t, c);
      void m.relu(out, u);
    });
    // t and u are residents: bound, and written.
    expect(gpu.binds).toEqual([7]);
    expect(gpu.shaders[0]!.match(/var<storage/g)).toHaveLength(6);
    expect(gpu.shaders[0]).not.toMatch(/var _fs/);
  });

  it('keeps a scratch array a later group uses a buffer: a zeroed buffer, destroyed after the plan', async () => {
    let t: Resident<Float32Array> | undefined;
    /** What the buffers looked like at the one submission. */
    let atSubmit: boolean[] = [];
    const gpu = fakeGpu();
    const m = await loadFused();
    const [a, b, out, v] = [live(1, 2, 3, 4), live(1, 1, 1, 1), zeros(4), zeros(4)];
    const report = await fuse((scope) => {
      t = scope.scratch(4);
      void m.add(t, a, b);
      void m.relu(out, t);
      void m.pairsum(v, t);
    });
    expect(report.groups).toEqual([
      { calls: ['add', 'relu'], fused: true },
      {
        calls: ['pairsum'],
        fused: false,
        why: `add and pairsum run as two dispatches because ${read}`,
      },
    ]);
    expect(report).toMatchObject({ dispatches: 2, submissions: 1 });
    // The first group binds t, a, b and out and the uniform; pairsum binds v, t and its uniform.
    expect(gpu.binds).toEqual([5, 3]);
    expect(gpu.shaders[0]!.match(/var<storage/g)).toHaveLength(4);
    expect(gpu.shaders[0]).not.toMatch(/var _fs/);
    // One zeroed buffer of the array's size was made for the scope, and destroyed when the plan
    // had run. The same buffer is bound by both groups: one scratch array, one buffer.
    expect(gpu.zeroed).toHaveLength(1);
    expect(gpu.zeroed[0]).toMatchObject({ size: 16, written: false, destroyed: true });
    atSubmit = gpu.made.map((x) => x.destroyed);
    expect(atSubmit.filter(Boolean)).toContain(true);
    // The handle holds nothing after the plan.
    const state = residentState(t!) as ScratchState;
    expect([state.phase, state.host, state.gpu]).toEqual(['done', undefined, undefined]);
  });

  it('destroys the buffer after the dispatch is submitted, and not before', async () => {
    let alive: boolean | undefined;
    const gpu = fakeGpu({ onSubmit: () => (alive = gpu.zeroed.every((x) => !x.destroyed)) });
    const m = await loadFused();
    const [a, b, out] = [live(1, 2, 3, 4), live(1, 1, 1, 1), zeros(4)];
    await fuse((scope) => {
      const t = scope.scratch(4);
      void m.add(t, a, b);
      void m.pairsum(out, t);
    });
    expect(gpu.zeroed).toHaveLength(1);
    expect(alive).toBe(true);
    expect(gpu.zeroed[0]!.destroyed).toBe(true);
  });

  it('keeps a scratch array a call measures a buffer, and still fuses the calls', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [a, b, out] = [live(1, 2, 3, 4), live(1, 1, 1, 1), zeros(4)];
    const report = await fuse((scope) => {
      const t = scope.scratch(4);
      void m.add(t, a, b);
      void m.lenscale(out, t);
    });
    expect(report.groups).toEqual([{ calls: ['add', 'lenscale'], fused: true }]);
    expect(report).toMatchObject({ dispatches: 1, submissions: 1 });
    // t is bound: the uniform, t, a, b and out. The entry measures it with arrayLength.
    expect(gpu.binds).toEqual([5]);
    expect(gpu.shaders[0]).toMatch(/arrayLength\(&_fr0\)/);
    expect(gpu.shaders[0]).not.toMatch(/var _fs/);
    expect(gpu.zeroed).toHaveLength(1);
    expect(gpu.zeroed[0]).toMatchObject({ size: 16, destroyed: true });
  });

  it('shows a scratch array that stays a buffer at a refusal: two dispatches, and it binds', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [a, b, out] = [live(1, 2, 3, 4), live(1, 1, 1, 1), zeros(4)];
    const report = await fuse((scope) => {
      const t = scope.scratch(4);
      void m.add(t, a, b);
      void m.pairsum(out, t);
    });
    expect(report.groups).toEqual([
      { calls: ['add'], fused: false },
      {
        calls: ['pairsum'],
        fused: false,
        why: `add and pairsum run as two dispatches because ${read}`,
      },
    ]);
    expect(report).toMatchObject({ dispatches: 2, submissions: 1 });
    // add: the uniform, t, a and b. pairsum: the uniform, out and t.
    expect(gpu.binds).toEqual([4, 3]);
    expect(gpu.shaders).toHaveLength(2);
    expect(gpu.zeroed).toHaveLength(1);
    expect(gpu.zeroed[0]).toMatchObject({ size: 16, destroyed: true });
  });

  it('fuses the calls on either side of the refusal and holds the private scratch array as a local', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [a, b, c, out] = [live(1, 2, 3, 4), live(1, 1, 1, 1), live(2, 2, 2, 2), zeros(4)];
    const report = await fuse((scope) => {
      const [t, u, v] = [scope.scratch(4), scope.scratch(4), scope.scratch(4)];
      void m.add(t, a, b);
      void m.mul(u, t, c);
      void m.pairsum(v, u);
      void m.relu(out, v);
    });
    // t is private to the first group and v to the second: locals. u is used by both: a buffer.
    expect(report.groups).toEqual([
      { calls: ['add', 'mul'], fused: true },
      {
        calls: ['pairsum', 'relu'],
        fused: true,
        why: `mul and pairsum run as two dispatches because pairsum reads \`t[i ^ 1]\` (line ${pairsumLine})`,
      },
    ]);
    expect(report).toMatchObject({ dispatches: 2, submissions: 1 });
    // add+mul: the uniform, a, b, u and c. pairsum+relu: the uniform, out and u.
    expect(gpu.binds).toEqual([5, 3]);
    expect(gpu.shaders.map((w) => w.match(/var _fs\d+: f32;/g)?.length)).toEqual([1, 1]);
    expect(gpu.zeroed).toHaveLength(1);
    expect(gpu.zeroed[0]).toMatchObject({ destroyed: true });
  });

  it('counts the buffers a dispatch binds and not the locals: the limit holds six arrays in four', async () => {
    fakeGpu({ storageBuffers: 4 });
    const m = await loadFused();
    const [a, b, c, out] = [live(1, 2, 3, 4), live(1, 1, 1, 1), live(2, 2, 2, 2), zeros(4)];
    const report = await fuse((scope) => {
      const [t, u] = [scope.scratch(4), scope.scratch(4)];
      void m.add(t, a, b);
      void m.mul(u, t, c);
      void m.relu(out, u);
    });
    expect(report.groups).toEqual([{ calls: ['add', 'mul', 'relu'], fused: true }]);
    // The same chain over residents does not fit the limit of 4.
    const [t2, u2, out2] = [zeros(4), zeros(4), zeros(4)];
    const apart = await fuse(() => {
      void m.add(t2, a, b);
      void m.mul(u2, t2, c);
      void m.relu(out2, u2);
    });
    expect(apart.groups.length).toBeGreaterThan(1);
    expect(apart.groups[1]!.why).toMatch(/would bind \d storage buffers, and the device allows 4/);
  });

  it('frees the buffers of a plan that fails, and keeps the error on what the plan writes', async () => {
    const gpu = fakeGpu({ validation: 'boom' });
    const m = await loadFused();
    const [a, b, out] = [live(1, 2, 3, 4), live(1, 1, 1, 1), zeros(4)];
    let t: Resident<Float32Array> | undefined;
    await expect(
      fuse((scope) => {
        t = scope.scratch(4);
        void m.add(t, a, b);
        void m.pairsum(out, t);
      }),
    ).rejects.toThrow(/WebGPU refused the calls: boom/);
    expect(gpu.zeroed).toHaveLength(1);
    expect(gpu.zeroed[0]).toMatchObject({ size: 16, destroyed: true });
    await expect(out.read()).rejects.toThrow(/boom/);
    const state = residentState(t!) as ScratchState;
    expect([state.phase, state.gpu]).toEqual(['done', undefined]);
    expect(kernelQueue.pending).toBe(0);
  });

  it('frees the buffers when a call fails its check before anything runs', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [a, b, short] = [live(1, 2, 3, 4), live(1, 1, 1, 1), zeros(2)];
    let t: Resident<Float32Array> | undefined;
    await expect(
      fuse((scope) => {
        t = scope.scratch(4);
        void m.add(t, a, b);
        // `fillTo` writes 4 elements of `short`, which holds 2.
        void m.fillTo(short, 4);
      }),
    ).rejects.toThrow(/fillTo\(\): parameter "out" holds 2 elements/);
    expect(gpu.made.filter((x) => (x.usage & STORAGE) !== 0 && !x.written)).toEqual([]);
    expect((residentState(t!) as ScratchState).phase).toBe('done');
    expect(gpu.submits).toBe(0);
  });

  it('frees the buffers when WebGPU refuses the module, and when the entry cannot be built', async () => {
    const gpu = fakeGpu({ compile: 'nope' });
    const m = await loadFused();
    const [a, b, out] = [live(1, 2, 3, 4), live(1, 1, 1, 1), zeros(4)];
    await expect(
      fuse((scope) => {
        const t = scope.scratch(4);
        void m.add(t, a, b);
        void m.pairsum(out, t);
      }),
    ).rejects.toThrow(/WebGPU refused the module's WGSL/);
    expect(gpu.zeroed.every((x) => x.destroyed)).toBe(true);
    expect(kernelQueue.pending).toBe(0);
  });

  it('runs a call that must run on the CPU between calls on the device, and gives it the elements', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [a, b, out] = [live(1, 2, 3, 4), live(1, 1, 1, 1), zeros(4)];
    let t: Resident<Float32Array> | undefined;
    const report = await fuse((scope) => {
      t = scope.scratch(4);
      void m.add(t, a, b);
      // `prefix` runs on the CPU tier: it reads what the device wrote, so the array gets elements.
      void m.prefix(t);
      void m.relu(out, t);
    });
    expect(report.groups.map((g) => g.calls)).toEqual([['add'], ['prefix'], ['relu']]);
    // add, the read of t that prefix needs, and relu.
    expect(report).toMatchObject({ dispatches: 2, submissions: 3 });
    // The device made one buffer for t, which `add` bound: a new one. `relu` uploaded the elements
    // `prefix` left in it. The plan destroyed it, and the residents' buffers live on.
    const freed = gpu.made.filter((x) => x.destroyed && (x.usage & STORAGE) !== 0);
    expect(freed).toHaveLength(1);
    expect(freed[0]).toMatchObject({ size: 16 });
    const state = residentState(t!) as ScratchState;
    expect([state.phase, state.host, state.gpu]).toEqual(['done', undefined, undefined]);
  });

  it('shares the scratch array across two scopes only as separate arrays: each scope frees its own', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [a, b, out] = [live(1, 2, 3, 4), live(1, 1, 1, 1), zeros(4)];
    const scope = () =>
      fuse((s) => {
        const t = s.scratch(4);
        void m.add(t, a, b);
        void m.pairsum(out, t);
      });
    await Promise.all([scope(), scope()]);
    expect(gpu.zeroed).toHaveLength(2);
    expect(gpu.zeroed.every((x) => x.destroyed)).toBe(true);
  });

  it('keeps a Resident from resident() a buffer with its write, whatever the group', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [a, b, t, out] = [live(1, 2, 3, 4), live(1, 1, 1, 1), zeros(4), zeros(4)];
    const report = await fuse(() => {
      void m.add(t, a, b);
      void m.relu(out, t);
    });
    expect(report.groups).toEqual([{ calls: ['add', 'relu'], fused: true }]);
    expect(gpu.binds).toEqual([5]);
    expect(gpu.zeroed).toEqual([]);
    expect(gpu.shaders[0]).not.toMatch(/var _fs/);
    // t is still on the device after the scope, and the host may read it.
    expect(residentState(t)!.gpu).toBeDefined();
    expect(await t.read()).toEqual(floats(0, 0, 0, 0));
  });
});

describe('a zeroed Resident on WebGPU, on a recording device (Rule 11.8, surface §65)', () => {
  it('makes no buffer and no host copy at creation, and a call writes no byte to a zeroed array', async () => {
    const gpu = fakeGpu();
    const m = await load();
    const out = resident(1_000_000, 'f32');
    expect(gpu.made).toEqual([]);
    expect(residentState(out)!.host).toBeUndefined();
    void m.add(out, resident(1_000_000, 'f32'), resident(1_000_000, 'f32'));
    // read() waits for the call; the call wrote no byte, and the device copy is read back once.
    expect((await out.read()).every((v) => v === 0)).toBe(true);
    expect(gpu.made.filter((b) => (b.usage & STORAGE) !== 0 && b.written)).toEqual([]);
  });

  it('reads zeros, with no device copy, when no call has written it; a call after the read writes no byte', async () => {
    const gpu = fakeGpu();
    const m = await load();
    const z = resident(8, 'i32');
    expect(await z.read()).toEqual(new Int32Array(8));
    expect(gpu.made).toEqual([]);
    expect(residentState(z)!.host).toBeUndefined();
    const [out, a] = [resident(4, 'f32'), resident(4, 'f32')];
    await a.read();
    void m.add(out, a, resident(4, 'f32'));
    expect(await out.read()).toEqual(floats(0, 0, 0, 0));
    expect(gpu.made.filter((b) => (b.usage & STORAGE) !== 0 && b.written)).toEqual([]);
  });

  it('uploads what a write put in it, once a call takes it', async () => {
    const gpu = fakeGpu();
    const m = await load();
    const x = resident(4, 'f32');
    x.write(floats(1, 2, 3, 4));
    const out = resident(4, 'f32');
    void m.add(out, x, resident(4, 'f32'));
    await out.read();
    // The kernel's own uniform is written too; the array is the storage buffer of 16 bytes.
    const uploaded = gpu.made.filter((b) => (b.usage & STORAGE) !== 0 && b.written);
    expect(uploaded).toHaveLength(1);
    expect(new Float32Array(uploaded[0]!.contents!)).toEqual(floats(1, 2, 3, 4));
  });

  it('replaces the zeroed buffer when write() changes the length, and frees it on destroy()', async () => {
    const gpu = fakeGpu();
    const m = await load();
    const [out, a, b] = [resident(4, 'f32'), resident(4, 'f32'), resident(4, 'f32')];
    void m.add(out, a, b);
    await out.read();
    const first = gpu.made.filter((x) => (x.usage & STORAGE) !== 0 && x.size === 16);
    expect(first.length).toBeGreaterThan(0);
    // A write of 8 numbers: the next call checks the new host copy, and binds a buffer of 32 bytes.
    out.write(floats(1, 2, 3, 4, 5, 6, 7, 8));
    a.write(floats(1, 2, 3, 4, 5, 6, 7, 8));
    b.write(floats(1, 2, 3, 4, 5, 6, 7, 8));
    void m.add(out, a, b);
    expect((await out.read()).length).toBe(8);
    expect(first.some((x) => x.destroyed)).toBe(true);
    // A use after destroy() is a TypeError, and the device buffer is freed.
    const freed = () => gpu.made.filter((x) => (x.usage & STORAGE) !== 0 && x.destroyed).length;
    const before = freed();
    out.destroy();
    await kernelQueue.idle();
    expect(freed()).toBe(before + 1);
    await expect(out.read()).rejects.toThrow('This Resident was destroyed');
    expect(() => out.write(floats(1))).toThrow('This Resident was destroyed');
  });

  it('makes the zeroed buffer the size of the layout, as the buffer of the same typed array is', async () => {
    const gpu = fakeGpu();
    const g = hostFace(
      `"use typeshade";
export function lift3(out: array<vec3>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = vec3(f32(i), 1., 2.);
  }
}
`,
      { fileName: '/app/vec.shade.ts', runtime: RUNTIME },
    );
    expect(g.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const m = (await loadCode(g.code!, 'vec')) as unknown as Record<'lift3', Call>;
    // Two vec3 elements: 6 numbers, and 32 bytes with each element padded to 16.
    const z = resident(6, 'f32');
    void m.lift3(z);
    await z.read();
    const sizes = gpu.made
      .filter((b) => (b.usage & STORAGE) !== 0 && !b.written)
      .map((b) => b.size);
    expect(sizes).toContain(32);
    expect(sizes).not.toContain(24);
  });
});
