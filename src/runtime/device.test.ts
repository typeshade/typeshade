// ═══ The device owner: tiers, arrays and their pool, plans, limits, lost, dispose (change 0071) ═══
//
// What is pinned here: `createDevice()` opens on the first tier of `prefer` that opens and says
// why the earlier ones did not; two devices in one context are independent, each running its plans
// on its own device; a call takes the arrays of its own owner only, and the refusal names both; a
// released array of the same element and length comes back from the pool, zeroed on the device for
// `array(length, element)`; an array past `poolBytes` is freed; `dispose()` destroys every array
// once and never a device the host handed in; `wait()` fences the queue; `limits` and `lost` are
// the device's. The fake device records the commands it is given and computes nothing; the values
// come from the CPU tier, where the arrays are real.
//
// Verifies: Rule 11.8, Rule 11.11, Rule 11.13 (docs/language-design.md; traced in reqs/).

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from '../compiler/ts/host-face.js';
import * as root from '../index.js';
import * as runtime from '../runtime.js';
import { fuse } from '../fuse.js';
import { fuseSlot } from '../core/fuse-scope.js';
import { configure, configuredFp64Flavor, resident, residentState } from '../core/resident.js';
import type { Resident } from '../core/resident.js';
import type { GpuDevice } from '../core/host-entry.js';
import { createDevice } from './device.js';

const RUNTIME = resolve(__dirname, '../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
afterEach(() => {
  configure({ runtime: null });
  configure({});
  vi.unstubAllGlobals();
});

const OPS = `"use typeshade";
export function add(out: array<f32>, a: array<f32>, b: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i] + b[i];
  }
}
export function relu(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = max(x[i], 0.);
  }
}
export function total(xs: array<f32>): f32 {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return s;
}
`;

type Call = (...a: unknown[]) => Promise<unknown>;
type Ops = Record<'add' | 'relu' | 'total', Call>;

const generated = hostFace(OPS, { fileName: '/app/ops.shade.ts', runtime: RUNTIME, fuse: true });
expect(generated.diagnostics.filter((d) => d.category === 'error')).toEqual([]);

async function load(): Promise<Ops> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-device-'));
  dirs.push(dir);
  const file = join(dir, 'ops.shade.mjs');
  writeFileSync(file, generated.code!);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Ops;
}

const floats = (...xs: number[]): Float32Array => Float32Array.of(...xs);

/** A module that emulates `f64`, whose face carries the WGSL of both flavors (change 0073). */
const DOUBLES = `"use typeshade";
export function scale(xs: array<f64>, k: f64) {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = xs[i] * k;
  }
}
export function add(out: array<f64>, a: array<f64>, b: array<f64>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i] + b[i];
  }
}
`;

const doubles = hostFace(DOUBLES, {
  fileName: '/app/doubles.shade.ts',
  runtime: RUNTIME,
  fuse: true,
});
expect(doubles.diagnostics.filter((d) => d.category === 'error')).toEqual([]);

async function loadDoubles(): Promise<Record<'scale' | 'add', Call>> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-device-'));
  dirs.push(dir);
  const file = join(dir, 'doubles.shade.mjs');
  writeFileSync(file, doubles.code!);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<
    'scale' | 'add',
    Call
  >;
}

interface FakeBuffer {
  size: number;
  usage: number;
  bytes: ArrayBuffer;
  destroys: number;
  /** How many `writeBuffer` calls the buffer took. */
  writes: number;
}

/** A WebGPU device that makes nothing and records what it is given. Its buffers hold real bytes:
 *  `writeBuffer` and `copyBufferToBuffer` copy them, `clearBuffer` zeroes them, and a map reads
 *  them, so a value that no dispatch computed reads back as it was written or cleared. */
function fakeGpu(limits: Record<string, number> = {}) {
  const commands: string[] = [];
  const made: FakeBuffer[] = [];
  /** The buffer and the byte offset of each indirect dispatch, in order (change 0075). */
  const indirect: { record: FakeBuffer; offset: number }[] = [];
  /** The WGSL of each shader module the device made, in order. */
  const codes: string[] = [];
  /** The textures the device made: the `_fp64` guard is the only one the call layer makes. */
  let textures = 0;
  let lose!: (info: unknown) => void;
  const lost = new Promise<unknown>((r) => {
    lose = r;
  });
  const fences = { count: 0 };
  const device = {
    destroyed: false,
    features: new Set<string>(),
    limits,
    createShaderModule: (d: { code: string }) => {
      codes.push(d.code);
      return { getCompilationInfo: async () => ({ messages: [] }) };
    },
    createTexture: () => {
      textures++;
      return { createView: () => ({}), destroy: () => undefined };
    },
    createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createBindGroup: () => ({}),
    createQuerySet: () => {
      throw new Error('no query set');
    },
    createBuffer: (d: { size: number; usage: number }) => {
      const record: FakeBuffer = {
        size: d.size,
        usage: d.usage,
        bytes: new ArrayBuffer(d.size),
        destroys: 0,
        writes: 0,
      };
      made.push(record);
      return {
        record,
        mapAsync: async () => undefined,
        getMappedRange: () => record.bytes,
        unmap: () => undefined,
        destroy: () => {
          record.destroys++;
        },
      };
    },
    createCommandEncoder: () => ({
      beginComputePass: () => ({
        setPipeline: () => undefined,
        setBindGroup: () => undefined,
        dispatchWorkgroups: (x: number) => commands.push(`dispatch ${x}`),
        dispatchWorkgroupsIndirect: (b: { record: FakeBuffer }, offset: number) => {
          indirect.push({ record: b.record, offset });
          commands.push(`dispatchIndirect at ${offset}`);
        },
        end: () => undefined,
      }),
      copyBufferToBuffer: (
        s: { record: FakeBuffer },
        so: number,
        d: { record: FakeBuffer },
        dO: number,
        n: number,
      ) => {
        new Uint8Array(d.record.bytes, dO, n).set(new Uint8Array(s.record.bytes, so, n));
        commands.push('copy');
      },
      clearBuffer: (b: { record: FakeBuffer }) => {
        new Uint8Array(b.record.bytes).fill(0);
        commands.push('clear');
      },
      resolveQuerySet: () => undefined,
      finish: () => ({}),
    }),
    pushErrorScope: () => undefined,
    popErrorScope: async () => null,
    queue: {
      writeTexture: () => undefined,
      writeBuffer: (b: { record: FakeBuffer }, at: number, data: ArrayBuffer | ArrayBufferView) => {
        const src = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data);
        new Uint8Array(b.record.bytes, at, src.byteLength).set(src);
        b.record.writes++;
        commands.push('write');
      },
      submit: () => {
        commands.push('submit');
      },
      onSubmittedWorkDone: async () => {
        fences.count++;
      },
    },
    lost,
    destroy() {
      this.destroyed = true;
    },
  };
  return {
    device: device as unknown as GpuDevice,
    raw: device,
    commands,
    made,
    indirect,
    codes,
    fences,
    lose,
    get textures(): number {
      return textures;
    },
    get dispatches(): number {
      return commands.filter((c) => c.startsWith('dispatch')).length;
    },
  };
}

describe('the exports', () => {
  it('are on typeshade/runtime and on the root', () => {
    expect(runtime.createDevice).toBe(createDevice);
    expect(root.createDevice).toBe(createDevice);
    // The flavor helpers reach a host that ships the runtime alone (change 0073).
    expect(runtime.recommendFp64Flavor).toBe(root.recommendFp64Flavor);
    expect(runtime.isAppleGpu).toBe(root.isAppleGpu);
  });
});

describe('the flavor of the emulated double (change 0073)', () => {
  const refused = (at: string): TypeError =>
    new TypeError(
      `${at}: "fast" is not a flavor of the emulated double; the flavors are 'float' and 'integer'.`,
    );

  it('is float by default, is the word createDevice({ fp64Flavor }) takes, and refuses another', async () => {
    const plain = await createDevice({ prefer: ['cpu'] });
    expect(plain.fp64Flavor).toBe('float');
    const integer = await createDevice({ prefer: ['cpu'], fp64Flavor: 'integer' });
    expect(integer.fp64Flavor).toBe('integer');
    await expect(createDevice({ fp64Flavor: 'fast' as never })).rejects.toThrow(
      refused('createDevice({ fp64Flavor })'),
    );
    await plain.dispose();
    await integer.dispose();
  });

  it('dispatches each owner’s flavor: the integer WGSL with no guard, the float WGSL with it', async () => {
    const m = await loadDoubles();
    const [gf, gi] = [fakeGpu(), fakeGpu()];
    const a = await createDevice({ device: gf.device });
    const b = await createDevice({ device: gi.device, fp64Flavor: 'integer' });
    const x = a.array(Float64Array.of(1, 2, 3));
    const y = b.array(Float64Array.of(1, 2, 3));
    // A call that runs alone takes the kernel function's own entries.
    await a.fuse(() => {
      void m.scale(x, 2);
    });
    await b.fuse(() => {
      void m.scale(y, 2);
    });
    expect(gf.dispatches).toBe(1);
    expect(gi.dispatches).toBe(1);
    expect(gf.codes).toHaveLength(1);
    expect(gf.codes[0]).toContain('var _fp64: texture_2d<f32>');
    expect(gf.textures).toBe(1);
    expect(gi.codes).toHaveLength(1);
    expect(gi.codes[0]).not.toContain('_fp64');
    expect(gi.codes[0]).toContain('fn df64_ipack');
    expect(gi.textures).toBe(0);
    // A fused group's entry is emitted under the owner's flavor too (Rule 11.13).
    const zeros = (): Float64Array => new Float64Array(3);
    const [ta, ua, oa] = [a.array(zeros()), a.array(Float64Array.of(4, 5, 6)), a.array(zeros())];
    const [tb, ub, ob] = [b.array(zeros()), b.array(Float64Array.of(4, 5, 6)), b.array(zeros())];
    const ra = await a.fuse(() => {
      void m.scale(ta, 2);
      void m.add(oa, ta, ua);
    });
    const rb = await b.fuse(() => {
      void m.scale(tb, 2);
      void m.add(ob, tb, ub);
    });
    expect(ra.groups.map((g) => g.fused)).toEqual([true]);
    expect(rb.groups.map((g) => g.fused)).toEqual([true]);
    expect(gf.codes).toHaveLength(2);
    expect(gf.codes[1]).toContain('var _fp64: texture_2d<f32>');
    expect(gf.textures).toBe(2);
    expect(gi.codes).toHaveLength(2);
    expect(gi.codes[1]).not.toContain('_fp64');
    expect(gi.codes[1]).toContain('fn df64_ipack');
    expect(gi.textures).toBe(0);
    await a.dispose();
    await b.dispose();
  });

  it('is configure({ fp64Flavor }) for the default owner, read at each call, and configure({}) restores float', async () => {
    const m = await loadDoubles();
    const gpu = fakeGpu();
    configure({ runtime: { device: gpu.device } as never });
    expect(configuredFp64Flavor()).toBe('float');
    configure({ fp64Flavor: 'integer' });
    expect(configuredFp64Flavor()).toBe('integer');
    const xs = Float64Array.of(1, 2, 3);
    await m.scale(xs, 2);
    expect(gpu.codes).toHaveLength(1);
    expect(gpu.codes[0]).not.toContain('_fp64');
    expect(gpu.textures).toBe(0);
    configure({ fp64Flavor: 'float' });
    await m.scale(xs, 2);
    expect(gpu.codes).toHaveLength(2);
    expect(gpu.codes[1]).toContain('var _fp64: texture_2d<f32>');
    expect(gpu.textures).toBe(1);
    expect(() => configure({ fp64Flavor: 'fast' as never })).toThrow(
      refused('configure({ fp64Flavor })'),
    );
    configure({ fp64Flavor: 'integer' });
    // An option left out keeps its value; no option at all restores the defaults.
    configure({ prefer: ['cpu'] });
    expect(configuredFp64Flavor()).toBe('integer');
    configure({});
    expect(configuredFp64Flavor()).toBe('float');
  });
});

describe('opening', () => {
  it('opens on the first tier of prefer that opens, and says why the earlier ones did not', async () => {
    // Node has no WebGPU and makes no WebGL2 context.
    const dev = await createDevice({ prefer: ['webgpu', 'webgl2', 'cpu'] });
    expect(dev.tier).toBe('cpu');
    expect(dev.skipped).toEqual([
      { tier: 'webgpu', reason: 'there is no WebGPU device' },
      { tier: 'webgl2', reason: 'there is no WebGL2 context' },
    ]);
    expect(dev.limits).toEqual({});
    await dev.dispose();
  });

  it('rejects when no tier of prefer opens, naming each reason', async () => {
    await expect(createDevice({ prefer: ['webgpu'] })).rejects.toThrow(
      'createDevice(): no tier of prefer opened (webgpu: there is no WebGPU device).',
    );
  });

  it('refuses options that do not fit', async () => {
    await expect(createDevice({ prefer: [] })).rejects.toThrow(TypeError);
    await expect(createDevice({ prefer: ['cpu', 'cpu'] })).rejects.toThrow('names a tier twice');
    await expect(createDevice({ prefer: ['gpu' as never] })).rejects.toThrow('is not a tier');
    await expect(createDevice({ poolBytes: -1 })).rejects.toThrow('poolBytes');
    await expect(createDevice({ prefer: ['cpu'], device: {} })).rejects.toThrow('exclusive');
    await expect(createDevice({ runtime: { device: {}, tier: 'webgl2' } })).rejects.toThrow(
      'WebGPU runtime',
    );
  });

  it('takes a GPUDevice the host has, and reports its limits', async () => {
    const gpu = fakeGpu({ maxStorageBufferBindingSize: 1 << 28 });
    const dev = await createDevice({ device: gpu.device });
    expect(dev.tier).toBe('webgpu');
    expect(dev.skipped).toEqual([]);
    expect(dev.limits).toEqual({ maxStorageBufferBindingSize: 1 << 28 });
    expect(Object.isFrozen(dev.limits)).toBe(true);
    await dev.dispose();
    expect(gpu.raw.destroyed).toBe(false);
  });

  it('takes a program runtime, and uses its device', async () => {
    const gpu = fakeGpu();
    const dev = await createDevice({ runtime: { device: gpu.device, tier: 'webgpu' } });
    const m = await load();
    const a = dev.array(floats(1, 2));
    const out = dev.array(2, 'f32');
    await dev.fuse(() => {
      void m.relu(out, a);
    });
    expect(gpu.dispatches).toBe(1);
    await dev.dispose();
    expect(gpu.raw.destroyed).toBe(false);
  });

  it('requests its own WebGPU device for prefer, and destroys it on dispose', async () => {
    const gpu = fakeGpu();
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: async () => ({
          features: { has: () => false },
          limits: {},
          requestDevice: async () => gpu.device,
        }),
      },
    });
    const dev = await createDevice({ prefer: ['webgpu', 'cpu'] });
    expect(dev.tier).toBe('webgpu');
    expect(dev.skipped).toEqual([]);
    await dev.dispose();
    expect(gpu.raw.destroyed).toBe(true);
  });
});

describe('two owners', () => {
  it('coexist in one context, each running its plans on its own device', async () => {
    const m = await load();
    const [ga, gb] = [fakeGpu(), fakeGpu()];
    const a = await createDevice({ device: ga.device });
    const b = await createDevice({ device: gb.device });
    const x = a.array(floats(1, -2, 3));
    const y = a.array(3, 'f32');
    const p = b.array(floats(4, 5, 6));
    const q = b.array(3, 'f32');
    const r = b.array(3, 'f32');
    const ra = await a.fuse(() => {
      void m.relu(y, x);
    });
    const rb = await b.fuse(() => {
      void m.relu(q, p);
      void m.add(r, q, p);
    });
    expect(ra.tier).toBe('webgpu');
    expect(rb.tier).toBe('webgpu');
    expect(ga.dispatches).toBe(1);
    expect(gb.dispatches).toBe(1);
    expect(rb.groups.map((g) => g.fused)).toEqual([true]);
    // Disposing one changes nothing of the other.
    await a.dispose();
    expect(b.statistics.live).toBe(3);
    await b.fuse(() => {
      void m.relu(q, p);
    });
    expect(gb.dispatches).toBe(2);
    await b.dispose();
  });

  it('refuse a Resident of another owner, naming both', async () => {
    const m = await load();
    const [ga, gb] = [fakeGpu(), fakeGpu()];
    const a = await createDevice({ device: ga.device });
    const b = await createDevice({ device: gb.device });
    const x = a.array(floats(1, 2));
    const y = b.array(2, 'f32');
    const z = resident(floats(3, 4));
    await expect(
      a.fuse(() => {
        void m.relu(y, x);
      }),
    ).rejects.toThrow(
      new TypeError(
        `relu(): parameter "out" is a Resident of ${(b as { label?: string }).label ?? 'Device #'}`,
      ).message.replace(/Device #\d*$/, ''),
    );
    await expect(
      a.fuse(() => {
        void m.relu(x, z);
      }),
    ).rejects.toThrow(
      'relu(): parameter "x" is a Resident of the default owner (configure(), resident()), and a call of Device #',
    );
    // A bare call is the default owner's.
    await expect(m.relu(x, z)).rejects.toThrow('relu(): parameter "out" is a Resident of Device #');
    await expect(m.relu(x, z)).rejects.toThrow('Make the call inside that device’s fuse()');
    // A default-owner scope refuses a device's array too.
    await expect(
      fuse(() => {
        void m.relu(x, z);
      }),
    ).rejects.toThrow('and a call of the default owner (configure(), resident()) takes the arrays');
    await a.dispose();
    await b.dispose();
  });
});

/** An entry whose workgroup count a `Resident` may hold (change 0075). */
const COUNTED = `"use typeshade";
declare const marks: storage<array<u32>, "read_write">;
@compute([2])
export function mark(
  @builtin("global_invocation_id") gid: vec3u,
  @builtin("num_workgroups") nw: vec3u,
) {
  if (gid.x < marks.length) {
    marks[gid.x] = nw.x;
  }
}
`;
const counted = hostFace(COUNTED, { fileName: '/app/counted.shade.ts', runtime: RUNTIME });
expect(counted.diagnostics.filter((d) => d.category === 'error')).toEqual([]);

async function loadCounted(): Promise<Record<'mark', Call>> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-device-'));
  dirs.push(dir);
  const file = join(dir, 'counted.shade.mjs');
  writeFileSync(file, counted.code!);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<'mark', Call>;
}

describe('an indirect workgroup count and its owner (change 0075)', () => {
  it('refuses a counts array of another owner, naming workgroups.indirect and both owners', async () => {
    const c = await loadCounted();
    const dev = await createDevice({ prefer: ['cpu'] });
    const label = (dev as unknown as { label: string }).label;
    const theirs = dev.array(Uint32Array.of(1, 1, 1));
    // A bare call is the default owner's.
    await expect(
      c.mark({ marks: resident(new Uint32Array(2)) }, { indirect: theirs }),
    ).rejects.toThrow(
      `mark(): "workgroups.indirect" is a Resident of ${label}, and a call of the default owner (configure(), resident()) takes the arrays of the default owner (configure(), resident()) only.`,
    );
    // A device's scope takes its own arrays only.
    await expect(
      dev.fuse(() => {
        void c.mark(
          { marks: dev.array(2, 'u32') },
          { indirect: resident(Uint32Array.of(1, 1, 1)) },
        );
      }),
    ).rejects.toThrow(
      `mark(): "workgroups.indirect" is a Resident of the default owner (configure(), resident()), and a call of ${label} takes the arrays of ${label} only.`,
    );
    // Its own array runs, on its tier.
    const marks = dev.array(4, 'u32');
    const report = await dev.fuse(() => {
      void c.mark({ marks }, { indirect: theirs });
    });
    expect(report.groups[0]).toMatchObject({ calls: ['mark'], indirect: true });
    expect(await marks.read()).toEqual(Uint32Array.of(1, 1, 0, 0));
    await dev.dispose();
  });

  it('dispatches a pooled array of counts once it is cleared, in the plan’s one submission', async () => {
    const gpu = fakeGpu();
    const dev = await createDevice({ device: gpu.device });
    const c = await loadCounted();
    const first = dev.array(3, 'u32');
    const marks = dev.array(4, 'u32');
    await dev.fuse(() => {
      void c.mark({ marks }, { indirect: first });
    });
    dev.release(first);
    const counts = dev.array(3, 'u32');
    expect(residentState(counts)).toBe(residentState(first));
    gpu.commands.length = 0;
    const report = await dev.fuse(() => {
      void c.mark({ marks }, { indirect: counts, offset: 0 });
    });
    expect(
      gpu.commands.filter((x) => x === 'clear' || x.startsWith('dispatch') || x === 'submit'),
    ).toEqual(['clear', 'dispatchIndirect at 0', 'submit']);
    const buffer = (residentState(counts)!.gpu!.buffer as unknown as { record: FakeBuffer }).record;
    expect(gpu.indirect.at(-1)).toEqual({ record: buffer, offset: 0 });
    expect(buffer.usage & 0x0100).toBe(0x0100);
    expect(report).toMatchObject({ tier: 'webgpu', dispatches: 1, submissions: 1 });
    await dev.dispose();
  });
});

describe('the pool', () => {
  it('gives a released array back for the same element and length, and counts the reuse', async () => {
    const dev = await createDevice({ prefer: ['cpu'] });
    const first = dev.array(floats(1, 2, 3));
    const firstState = residentState(first);
    dev.release(first);
    expect(dev.statistics.pooledBytes).toBe(12);
    const again = dev.array(floats(7, 8, 9));
    expect(residentState(again)).toBe(firstState);
    expect(dev.statistics).toMatchObject({ allocations: 1, reuses: 1, pooledBytes: 0, live: 1 });
    expect(await again.read()).toEqual(floats(7, 8, 9));
    // Another length is a new array.
    const other = dev.array(floats(1, 2));
    expect(residentState(other)).not.toBe(firstState);
    expect(dev.statistics.allocations).toBe(2);
    await dev.dispose();
  });

  it('zeroes a reused array for array(length, element) in the next plan, with no upload and no submission of its own', async () => {
    const gpu = fakeGpu();
    const dev = await createDevice({ device: gpu.device });
    const m = await load();
    const a = dev.array(floats(5, 6));
    const out = dev.array(2, 'f32');
    await dev.fuse(() => {
      void m.relu(out, a);
    });
    const state = residentState(out)!;
    expect(state.gpu).toBeDefined();
    const writes = gpu.commands.filter((c) => c === 'write').length;
    const submits = gpu.commands.filter((c) => c === 'submit').length;
    dev.release(out);
    const again = dev.array(2, 'f32');
    expect(residentState(again)).toBe(state);
    // Nothing reaches the queue until a plan binds the array.
    expect(gpu.commands.filter((c) => c === 'clear')).toEqual([]);
    const sink = dev.array(2, 'f32');
    gpu.commands.length = 0;
    await dev.fuse(() => {
      void m.relu(sink, again);
    });
    // The clear comes before the dispatch, in the plan's one submission, with no upload.
    expect(
      gpu.commands.filter((c) => c === 'clear' || c.startsWith('dispatch') || c === 'submit'),
    ).toEqual(['clear', 'dispatch 1', 'submit']);
    // The array's buffer took no upload: the writes of the plan are its uniform's.
    expect((state.gpu!.buffer as unknown as { record: FakeBuffer }).record.writes).toBe(0);
    expect(writes).toBeGreaterThan(0);
    expect(submits).toBeGreaterThan(0);
    expect(await again.read()).toEqual(floats(0, 0));
    await dev.dispose();
  });

  it('gives a reused zeroed array back as zeros to a read before any plan, with no clear', async () => {
    const gpu = fakeGpu();
    const dev = await createDevice({ device: gpu.device });
    const m = await load();
    const a = dev.array(floats(5, 6));
    const out = dev.array(2, 'f32');
    await dev.fuse(() => {
      void m.relu(out, a);
    });
    dev.release(out);
    const again = dev.array(2, 'f32');
    gpu.commands.length = 0;
    expect(await again.read()).toEqual(floats(0, 0));
    expect(gpu.commands.filter((c) => c === 'clear')).toEqual([]);
    // A write after that is the host copy's, as for any array.
    again.write(floats(7, 8));
    expect(await again.read()).toEqual(floats(7, 8));
    await dev.dispose();
  });

  it('zeroes a reused array that has no buffer yet as a host copy of zeros', async () => {
    const dev = await createDevice({ prefer: ['cpu'] });
    const a = dev.array(floats(5, 6));
    dev.release(a);
    const z = dev.array(2, 'f32');
    expect(await z.read()).toEqual(floats(0, 0));
    await dev.dispose();
  });

  it('frees an array past poolBytes, and evicts the oldest released array first', async () => {
    const gpu = fakeGpu();
    const dev = await createDevice({ device: gpu.device, poolBytes: 16 });
    const big = dev.array(new Float32Array(8));
    dev.release(big);
    expect(dev.statistics.pooledBytes).toBe(0);
    expect(dev.statistics.live).toBe(0);
    const one = dev.array(floats(1, 2));
    const two = dev.array(floats(3, 4));
    const three = dev.array(floats(5, 6));
    dev.release(one);
    dev.release(two);
    expect(dev.statistics.pooledBytes).toBe(16);
    dev.release(three);
    // The oldest, `one`, left to make room.
    expect(dev.statistics.pooledBytes).toBe(16);
    expect(dev.statistics.live).toBe(2);
    expect(() => dev.release(one)).toThrow('this Resident was destroyed');
    await dev.dispose();
  });

  it('keeps nothing with poolBytes 0', async () => {
    const dev = await createDevice({ prefer: ['cpu'], poolBytes: 0 });
    const a = dev.array(floats(1));
    dev.release(a);
    expect(dev.statistics).toMatchObject({ live: 0, pooledBytes: 0 });
    await dev.dispose();
  });

  it('refuses to release an array another owner made', async () => {
    const dev = await createDevice({ prefer: ['cpu'] });
    const other = await createDevice({ prefer: ['cpu'] });
    const theirs = other.array(floats(1));
    expect(() => dev.release(theirs)).toThrow(
      `release(): this Resident belongs to ${(other as { label?: string }).label ?? 'Device #'}`.replace(
        /Device #\d*$/,
        '',
      ),
    );
    expect(() => dev.release(resident(floats(1)))).toThrow(
      'belongs to the default owner (configure(), resident())',
    );
    expect(() => dev.release({} as Resident<unknown>)).toThrow('takes a Resident this device made');
    await dev.dispose();
    await other.dispose();
  });

  it('counts uploads and reads', async () => {
    const dev = await createDevice({ prefer: ['cpu'] });
    const a = dev.array(floats(1, 2, 3));
    expect(dev.statistics.uploadBytes).toBe(12);
    a.write(floats(4, 5, 6));
    expect(dev.statistics.uploadBytes).toBe(24);
    await a.read();
    expect(dev.statistics.readBytes).toBe(12);
    const s = dev.array(2.5);
    expect(dev.statistics.uploadBytes).toBe(24);
    dev.release(s);
    expect(dev.statistics.live).toBe(1);
    await dev.dispose();
  });
});

describe('plans', () => {
  it('run on the CPU tier with the values the same calls give apart', async () => {
    const m = await load();
    const dev = await createDevice({ prefer: ['cpu'] });
    const a = dev.array(floats(1, -2, 3));
    const b = dev.array(floats(4, 5, -6));
    const sum = dev.array(3, 'f32');
    const out = dev.array(3, 'f32');
    let total: Promise<unknown> | undefined;
    const report = await dev.fuse(() => {
      void m.add(sum, a, b);
      void m.relu(out, sum);
      total = m.total(out);
    });
    expect(report.tier).toBe('cpu');
    expect(await out.read()).toEqual(floats(5, 3, 0));
    expect(await total).toBe(8);
    await dev.dispose();
  });

  it('refuse to run without the planner, naming the import', async () => {
    const dev = await createDevice({ prefer: ['cpu'] });
    const open = fuseSlot.open;
    fuseSlot.open = undefined;
    try {
      await expect(dev.fuse(() => undefined)).rejects.toThrow(
        "fuse(): the planner is not loaded. Import 'typeshade/fuse' once in the application; typeshade/runtime ships none of it.",
      );
    } finally {
      fuseSlot.open = open;
    }
    await dev.dispose();
  });

  it('take a scratch array of the scope as the device’s own', async () => {
    // TypeNN copies a repeated input through `scope.scratch()` (`a.add(a)`); the copy belongs to
    // the device's scope, not to the default owner.
    const m = await load();
    const dev = await createDevice({ prefer: ['cpu'] });
    const a = dev.array(floats(1, -2, 3));
    const out = dev.array(3, 'f32');
    const report = await dev.fuse((scope) => {
      const twin = scope.scratch(3);
      void m.relu(twin, a);
      void m.add(out, a, twin);
    });
    expect(report.groups.length).toBeGreaterThan(0);
    expect(await out.read()).toEqual(floats(2, -2, 6));
    await dev.dispose();
  });

  it('let fuse() inside the body join the device’s scope', async () => {
    const m = await load();
    const dev = await createDevice({ prefer: ['cpu'] });
    const a = dev.array(floats(1, -2));
    const out = dev.array(2, 'f32');
    const report = await dev.fuse(() => {
      void fuse(() => {
        void m.relu(out, a);
      });
    });
    expect(report.groups.length).toBe(1);
    expect(await out.read()).toEqual(floats(1, 0));
    await dev.dispose();
  });
});

describe('the time budget and chunked plans (change 0074)', () => {
  it('is 250 ms by default, reports the value given, and refuses one out of range', async () => {
    const dev = await createDevice({ prefer: ['cpu'] });
    expect(dev.timeBudgetMs).toBe(250);
    await dev.dispose();
    const tight = await createDevice({ prefer: ['cpu'], timeBudgetMs: 100 });
    expect(tight.timeBudgetMs).toBe(100);
    await tight.dispose();
    for (const timeBudgetMs of [0, -1, 60001, Number.NaN, Number.POSITIVE_INFINITY, '250']) {
      const refused = createDevice({ prefer: ['cpu'], timeBudgetMs: timeBudgetMs as number });
      await expect(refused).rejects.toBeInstanceOf(RangeError);
      await expect(refused).rejects.toThrow(
        'createDevice(): timeBudgetMs takes a finite number of milliseconds from 1 to 60000.',
      );
    }
    // The bounds themselves are budgets.
    for (const timeBudgetMs of [1, 60000]) {
      const edge = await createDevice({ prefer: ['cpu'], timeBudgetMs });
      expect(edge.timeBudgetMs).toBe(timeBudgetMs);
      await edge.dispose();
    }
  });

  it('fences a chunked plan before and after, times it, reports the chunk and learns its rate', async () => {
    const m = await load();
    const gpu = fakeGpu();
    // The fence and the submission are recorded in order; the wall clock moves 12.5 ms at the
    // plan's submission, so the time measured is the plan's.
    let clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const submit = gpu.raw.queue.submit;
    gpu.raw.queue.submit = () => {
      clock += 12.5;
      submit();
    };
    gpu.raw.queue.onSubmittedWorkDone = async () => {
      gpu.fences.count++;
      gpu.commands.push('fence');
    };
    const dev = await createDevice({ device: gpu.device, timeBudgetMs: 100 });
    const a = dev.array(floats(1, -2, 3, -4));
    const out = dev.array(4, 'f32');
    expect(dev.chunkRates).toEqual({});
    expect(dev.chunkSize('sweep', 160)).toBe(1);
    try {
      const report = await dev.fuse(
        () => {
          void m.relu(out, a);
        },
        { chunk: { key: 'sweep', units: 4 } },
      );
      expect(gpu.commands[0]).toBe('fence');
      expect(gpu.commands.at(-1)).toBe('fence');
      expect(gpu.commands.filter((c) => c === 'fence')).toHaveLength(2);
      expect(gpu.dispatches).toBe(1);
      expect(report.tier).toBe('webgpu');
      expect(report.chunk).toEqual({ key: 'sweep', units: 4, elapsedMs: 12.5 });
      expect(dev.chunkRates).toEqual({
        sweep: { msPerUnit: 3.125, chunks: 1, longestMs: 12.5, lastUnits: 4 },
      });
      expect(Object.isFrozen(dev.chunkRates)).toBe(true);
      // 80 ms of the budget fit 25 units at 3.125 ms, and the chunk grows at most fourfold.
      expect(dev.chunkSize('sweep', 160)).toBe(16);
      expect(dev.chunkSize('sweep', 10)).toBe(10);
      // A second chunk: the rate is the mean of the two. A plan queued after it, not awaited, is
      // neither in the chunk nor in its time: the fences are on either side of the chunk's plan.
      const pending = dev.fuse(
        () => {
          void m.relu(out, a);
        },
        { chunk: { key: 'sweep', units: 1 } },
      );
      const after = dev.fuse(() => {
        void m.relu(out, a);
      });
      const second = await pending;
      await after;
      expect(second.chunk).toEqual({ key: 'sweep', units: 1, elapsedMs: 12.5 });
      expect(second.dispatches).toBe(1);
      expect(dev.chunkRates.sweep).toEqual({
        msPerUnit: 7.8125,
        chunks: 2,
        longestMs: 12.5,
        lastUnits: 1,
      });
      // A plan with no chunk does not fence and carries no chunk row.
      const fences = gpu.fences.count;
      const plain = await dev.fuse(() => {
        void m.relu(out, a);
      });
      expect(gpu.fences.count).toBe(fences);
      expect('chunk' in plain).toBe(false);
      const empty = await dev.fuse(() => {
        void m.relu(out, a);
      }, {});
      expect(gpu.fences.count).toBe(fences);
      expect('chunk' in empty).toBe(false);
      expect(Object.keys(dev.chunkRates)).toEqual(['sweep']);
    } finally {
      vi.restoreAllMocks();
      await dev.dispose();
    }
  });

  it('measures a chunked plan on the CPU tier, whose chunkSize is max', async () => {
    const m = await load();
    const dev = await createDevice({ prefer: ['cpu'] });
    const a = dev.array(floats(1, -2));
    const out = dev.array(2, 'f32');
    expect(dev.chunkSize('sweep', 160)).toBe(160);
    expect(dev.chunkSize('unknown', 32, 4)).toBe(32);
    const report = await dev.fuse(
      () => {
        void m.relu(out, a);
      },
      { chunk: { key: 'sweep', units: 3 } },
    );
    expect(report.tier).toBe('cpu');
    expect(report.chunk?.key).toBe('sweep');
    expect(report.chunk?.units).toBe(3);
    expect(report.chunk?.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(await out.read()).toEqual(floats(1, 0));
    expect(dev.chunkRates.sweep?.chunks).toBe(1);
    expect(dev.chunkRates.sweep?.lastUnits).toBe(3);
    // The plan keeps the place where fuse was called: a read made before the promise resolves
    // sees what it wrote.
    const b = dev.array(floats(-3, 4));
    void dev.fuse(
      () => {
        void m.relu(out, b);
      },
      { chunk: { key: 'sweep', units: 1 } },
    );
    expect(await out.read()).toEqual(floats(0, 4));
    // The CPU tier has no watchdog: the whole work is one chunk, whatever was learned.
    expect(dev.chunkSize('sweep', 160, 2)).toBe(160);
    await dev.dispose();
  });

  it('refuses a chunk that does not fit, naming the field', async () => {
    const dev = await createDevice({ prefer: ['cpu'] });
    const run = (options: unknown) => dev.fuse(() => undefined, options as never);
    for (const key of ['', 3, undefined])
      await expect(run({ chunk: { key, units: 1 } })).rejects.toThrow(
        /\.fuse\(\): chunk\.key takes a non-empty string that names the kernel loop\.$/,
      );
    for (const units of [0, -1, 1.5, Number.NaN, '4', undefined])
      await expect(run({ chunk: { key: 'k', units } })).rejects.toThrow(
        /\.fuse\(\): chunk\.units takes a whole number of 1 or more\.$/,
      );
    await expect(run({ chunk: null })).rejects.toThrow(TypeError);
    await expect(run(5)).rejects.toThrow(TypeError);
    expect(dev.chunkRates).toEqual({});
    expect(() => dev.chunkSize('', 4)).toThrow(TypeError);
    for (const [max, min] of [
      [0, 1],
      [1.5, 1],
      [4, 0],
      [4, Number.NaN],
    ])
      expect(() => dev.chunkSize('k', max!, min)).toThrow(RangeError);
    await dev.dispose();
    expect(() => dev.chunkSize('k', 4)).toThrow('this Device was disposed');
  });

  it('refuses a chunked plan inside the body of another fuse(), since it runs alone', async () => {
    const dev = await createDevice({ prefer: ['cpu'] });
    let inner: Promise<unknown> | undefined;
    await dev.fuse(() => {
      inner = dev.fuse(() => undefined, { chunk: { key: 'k', units: 1 } });
    });
    await expect(inner).rejects.toThrow(
      new TypeError(
        'the kernel queue: a call that joins it cannot run inside fuse(), which records kernel calls only. Call it outside fuse().',
      ),
    );
    await expect(inner).rejects.toBeInstanceOf(TypeError);
    expect(dev.chunkRates).toEqual({});
    await dev.dispose();
  });

  it('leaves the default owner as it was: fuse() of typeshade/fuse reports no chunk', async () => {
    const m = await load();
    const a = resident(floats(1, -2));
    const out = resident(2, 'f32');
    const report = await fuse(() => {
      void m.relu(out, a);
    });
    expect('chunk' in report).toBe(false);
    expect(await out.read()).toEqual(floats(1, 0));
  });
});

describe('wait, lost and dispose', () => {
  it('wait() settles the queue and fences the WebGPU queue', async () => {
    const gpu = fakeGpu();
    const dev = await createDevice({ device: gpu.device });
    await dev.wait();
    expect(gpu.fences.count).toBe(1);
    await dev.dispose();
    await expect(dev.wait()).rejects.toThrow('this Device was disposed');
  });

  it('lost resolves with the reason and the message', async () => {
    const gpu = fakeGpu();
    const dev = await createDevice({ device: gpu.device });
    gpu.lose({ reason: 'destroyed', message: 'gone' });
    expect(await dev.lost).toEqual({ reason: 'destroyed', message: 'gone' });
    await dev.dispose();
  });

  it('dispose destroys each array once, pooled or not, and refuses a use after', async () => {
    const gpu = fakeGpu();
    const dev = await createDevice({ device: gpu.device });
    const m = await load();
    const a = dev.array(floats(1, 2));
    const b = dev.array(2, 'f32');
    const c = dev.array(floats(3, 4));
    await dev.fuse(() => {
      void m.relu(b, a);
    });
    dev.release(c);
    // `c` was uploaded by nothing: it has no buffer. `a` and `b` have one each.
    await dev.dispose();
    await dev.dispose();
    const buffers = gpu.made.filter((x) => x.destroys > 0);
    expect(buffers.length).toBe(2);
    expect(buffers.every((x) => x.destroys === 1)).toBe(true);
    expect(() => dev.array(floats(1))).toThrow(
      'this Device was disposed. Make a new one with createDevice().',
    );
    expect(() => dev.release(a)).toThrow('this Device was disposed');
    await expect(dev.fuse(() => undefined)).rejects.toThrow('this Device was disposed');
    await expect(a.read()).rejects.toThrow('This Resident was destroyed');
  });

  it('a handle the host destroys leaves the books', async () => {
    const dev = await createDevice({ prefer: ['cpu'] });
    const a = dev.array(floats(1, 2));
    a.destroy();
    expect(dev.statistics.live).toBe(0);
    expect(() => dev.release(a)).toThrow('this Resident was destroyed');
    await dev.dispose();
  });
});
