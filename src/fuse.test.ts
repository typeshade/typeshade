// The fuse scope (change 0058, steps 2 and 3): a body that makes kernel calls over `Resident`
// arrays, a plan that runs them as one unit in the kernel queue, and a report of what the plan
// did. Node has no WebGPU, so the calls run on the CPU tier, where `dispatches` and `submissions`
// are zero, and the WebGPU half runs on a recording fake device: one `queue.submit` for the whole
// scope, the dispatches in the order the calls were made, and a submission of its own for each
// step that must see what the batch wrote. A module built with `typeshade({ fuse: true })` has the
// facts the planner fuses a chain by: the groups it makes, the reason of each call that stands
// apart, the entry built for a group and cached for its shape, and the limit of the device are
// read here on the recording device, the planner alone is `src/core/fuse-group.test.ts`, and the
// fused module against the calls run apart is `src/core/fuse-entry.test.ts`. A real device,
// SwiftShader, is `journeys/loop-fuse` and `journeys/mnist/bench-submissions.mjs`.
//
// It carries no rule tag yet: the rule it verifies is written by a later step of the change,
// which tags this file then (`reqs/README.md`).

import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './compiler/ts/host-face.js';
import * as root from './index.js';
import * as runtime from './runtime.js';
import { fuse, type FuseReport } from './fuse.js';
import { buildPlan } from './core/fuse-plan.js';
import { configure, kernelQueue, resident, residentState } from './core/resident.js';
import type { Resident } from './core/resident.js';
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
  | 'prefix'
  | 'pairsum'
  | 'sized'
  | 'fill'
  | 'shade',
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
}

/** A device that makes nothing and records the commands it gets, in order. A buffer reads back
 *  as zeros. */
function fakeGpu(options: FakeOptions = {}) {
  const commands: string[] = [];
  /** The WGSL of every shader module the device was asked to make. */
  const shaders: string[] = [];
  /** How many resources each bind group the device was asked to make binds. */
  const binds: number[] = [];
  let pops = 0;
  const buffer = (size: number) => ({
    mapAsync: async () => {},
    getMappedRange: () => new ArrayBuffer(size),
    unmap: () => {},
    destroy: () => {},
  });
  const pass = {
    setPipeline: () => {},
    setBindGroup: () => {},
    dispatchWorkgroups: (x: number, y: number, z: number) =>
      commands.push(`dispatch ${x} ${y} ${z}`),
    end: () => {},
  };
  const encoder = {
    beginComputePass: () => pass,
    copyBufferToBuffer: (_s: unknown, _so: number, _d: unknown, _do: number, n: number) =>
      commands.push(`copy ${n}`),
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
    createBuffer: (d: { size: number }) => buffer(d.size),
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
    queue: { writeBuffer: () => {}, submit: () => commands.push('submit') },
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

  it('submits what it holds before a reduction, which reads its partials back, and after', async () => {
    const gpu = fakeGpu();
    const m = await load();
    const [x, y, out] = [live(1, 2, 3, 4), live(1, 1, 1, 1), zeros(4)];
    const report = await fuse(() => {
      void m.add(out, x, y);
      void m.total(out);
      void m.bump(out);
    });
    expect(gpu.flow).toEqual([dispatch, 'submit', dispatch, 'submit', dispatch, 'submit']);
    expect(report).toMatchObject({ tier: 'webgpu', dispatches: 3, submissions: 3 });
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
    // The batch with `bump` is submitted before the reduction, and passes; the reduction's own
    // submission fails. `bump` ran, `relu` did not, and neither array can be trusted.
    const gpu = fakeGpu({ validation: 'boom', validationAt: 2 });
    const m = await load();
    const [x, y] = [live(1, 2), zeros(2)];
    let calls: Promise<unknown>[] = [];
    await expect(
      fuse(() => {
        calls = [m.bump(x), m.total(x), m.relu(y, x)];
      }),
    ).rejects.toThrow(new Error('total(): WebGPU refused the call: boom'));
    expect(gpu.submits).toBe(2);
    await expect(x.read()).rejects.toThrow('total(): WebGPU refused the call: boom');
    await expect(y.read()).rejects.toThrow('total(): WebGPU refused the call: boom');
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

  it('submits what it holds before a reduction and fuses the calls before it', async () => {
    const gpu = fakeGpu();
    const m = await loadFused();
    const [t, out] = [zeros(4), zeros(4)];
    const [a, b] = [live(1, 2, 3, 4), live(1, 1, 1, 1)];
    const report = await fuse(() => {
      void m.add(t, a, b);
      void m.relu(out, t);
      void m.total(out);
    });
    expect(report.groups).toEqual([
      { calls: ['add', 'relu'], fused: true },
      {
        calls: ['total'],
        fused: false,
        why: 'relu and total run as two dispatches because total reduces',
      },
    ]);
    expect(gpu.flow).toEqual([dispatch, 'submit', dispatch, 'submit']);
    expect(report).toMatchObject({ dispatches: 2, submissions: 2 });
  });
});

describe('a fuse scope that could fuse, with no WebGPU', () => {
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
