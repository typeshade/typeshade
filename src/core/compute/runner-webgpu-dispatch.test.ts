import { describe, it, expect } from 'vitest';
import type { ModuleDecl } from '../ir/index.js';
import {
  fn,
  module,
  If,
  Return,
  storageBuffer,
  resource,
  builtin,
  bitcastU32,
  f32T,
  u32T,
  vec3uT,
  vec4uT,
  voidT,
} from '../ir/index.js';
import { createComputeRunner, type GpuDeviceLike } from '../../compute.js';

interface KernelOptions {
  readonly workgroupSize?: number;
  readonly stripWorkgroup?: boolean;
  readonly bindings?: readonly [number, number, number];
}

function kernelOf(opts: KernelOptions = {}): ModuleDecl {
  const [inBinding, outBinding, countBinding] = opts.bindings ?? [0, 1, 2];
  const input = storageBuffer('feat_data', f32T, { group: 0, binding: inBinding, access: 'read' });
  const out = storageBuffer('out_value', u32T, {
    group: 0,
    binding: outBinding,
    access: 'read_write',
  });
  const dispatch = resource('u_dispatch', vec4uT, { group: 0, binding: countBinding });
  const kernel = fn(
    'scale_features',
    { gid: builtin('global_invocation_id', vec3uT) },
    voidT,
    ({ gid }) => {
      const i = gid.x;
      If(i.ge(dispatch.node.x), () => {
        Return();
      });
      out.at(i).assign(bitcastU32(input.at(i)));
    },
    { stage: 'compute', portable: true, workgroupSize: opts.workgroupSize },
  );
  const declared = opts.stripWorkgroup
    ? {
        ...kernel,
        workgroupSize: undefined,
        workgroupShape: undefined,
        attrs: kernel.attrs?.filter((a) => !a.startsWith('@workgroup_size')),
      }
    : kernel;
  return module({
    bindings: [input.binding, out.binding, dispatch.binding],
    funcs: [declared],
  });
}

interface FakeBuffer {
  readonly size: number;
  readonly usage: number;
  destroyed: boolean;
  mapMode?: number;
  mapped?: ArrayBuffer;
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

interface DeviceOptions {
  readonly mapFails?: boolean;
}

function deviceStub(opts: DeviceOptions = {}) {
  const buffers: FakeBuffer[] = [];
  const writes: { buffer: FakeBuffer; offset: number; data: ArrayBufferView }[] = [];
  const dispatches: number[] = [];
  const copies: unknown[][] = [];
  const groups: { index: number; group: unknown }[] = [];
  const bindGroups: { layout: unknown; entries: { binding: number; resource: unknown }[] }[] = [];
  const layout = { kind: 'layout' };
  const counts = { shaderModules: 0, pipelines: 0 };
  const device = {
    createShaderModule: () => {
      counts.shaderModules += 1;
      return {};
    },
    createComputePipeline: () => {
      counts.pipelines += 1;
      return { getBindGroupLayout: (i: number) => (i === 0 ? layout : null) };
    },
    createBuffer: (d: { size: number; usage: number }) => {
      const b: FakeBuffer = {
        size: d.size,
        usage: d.usage,
        destroyed: false,
        mapAsync(mode: number) {
          b.mapMode = mode;
          return opts.mapFails ? Promise.reject(new Error('map failed')) : Promise.resolve();
        },
        getMappedRange() {
          const raw = new Uint32Array(d.size / 4).map((_, i) => i + 1);
          b.mapped = raw.buffer;
          return raw.buffer;
        },
        unmap() {
          structuredClone(b.mapped, { transfer: [b.mapped!] });
        },
        destroy() {
          b.destroyed = true;
        },
      };
      buffers.push(b);
      return b;
    },
    createBindGroup: (d: {
      layout: unknown;
      entries: { binding: number; resource: unknown }[];
    }) => {
      bindGroups.push(d);
      return { kind: 'bind-group' };
    },
    createCommandEncoder: () => ({
      beginComputePass: () => ({
        setPipeline: () => undefined,
        setBindGroup: (index: number, group: unknown) => groups.push({ index, group }),
        dispatchWorkgroups: (x: number) => dispatches.push(x),
        end: () => undefined,
      }),
      copyBufferToBuffer: (...a: unknown[]) => copies.push(a),
      finish: () => ({}),
    }),
    queue: {
      writeBuffer: (buffer: FakeBuffer, offset: number, data: ArrayBufferView) =>
        writes.push({ buffer, offset, data }),
      submit: () => undefined,
    },
  };
  return {
    device: device as unknown as GpuDeviceLike,
    buffers,
    writes,
    dispatches,
    copies,
    groups,
    bindGroups,
    layout,
    counts,
  };
}

async function runnerOn(s: ReturnType<typeof deviceStub>, m: ModuleDecl = kernelOf()) {
  return createComputeRunner(m, { prefer: ['webgpu'], device: s.device });
}

const STORAGE = 0x80;
const UNIFORM = 0x40;
const MAP_READ = 0x1;
const COPY_SRC = 0x4;
const COPY_DST = 0x8;

describe('createComputeRunner webgpu tier: buffers', () => {
  it('creates the four buffers with their WebGPU usage flags', async () => {
    const s = deviceStub();
    const r = await runnerOn(s);
    await r.run(new Float32Array([1, 2, 3]));
    expect(s.buffers.map((b) => [b.size, b.usage])).toEqual([
      [12, STORAGE | COPY_DST],
      [12, STORAGE | COPY_SRC],
      [16, UNIFORM | COPY_DST],
      [12, MAP_READ | COPY_DST],
    ]);
    expect(s.buffers[3]!.mapMode).toBe(MAP_READ);
  });

  it('clamps every zero-size buffer to the four-byte floor for an empty dispatch', async () => {
    const s = deviceStub();
    const r = await runnerOn(s);
    const got = await r.run(new Float32Array(0));
    expect(s.buffers.map((b) => b.size)).toEqual([4, 4, 16, 4]);
    expect(s.copies[0]!.slice(1)).toEqual([0, s.buffers[3], 0, 4]);
    expect(got).toEqual(new Uint32Array(0));
  });

  it('sizes the output by invocations, not by the input length', async () => {
    const s = deviceStub();
    const r = await runnerOn(s);
    const got = await r.run(new Float32Array(10), 3);
    expect(s.buffers[1]!.size).toBe(12);
    expect(s.buffers[0]!.size).toBe(40);
    expect(got.length).toBe(3);
  });

  it('copies the mapped range before unmap detaches it', async () => {
    const s = deviceStub();
    const r = await runnerOn(s);
    const got = await r.run(new Float32Array(5));
    expect(Array.from(got)).toEqual([1, 2, 3, 4, 5]);
    expect(got.buffer.byteLength).toBe(20);
  });

  it('destroys every buffer after a run', async () => {
    const s = deviceStub();
    const r = await runnerOn(s);
    await r.run(new Float32Array([1, 2]));
    expect(s.buffers.every((b) => b.destroyed)).toBe(true);
  });

  it('destroys every buffer when the readback fails', async () => {
    const s = deviceStub({ mapFails: true });
    const r = await runnerOn(s);
    await expect(r.run(new Float32Array([1, 2]))).rejects.toThrow(/map failed/);
    expect(s.buffers.length).toBe(4);
    expect(s.buffers.every((b) => b.destroyed)).toBe(true);
  });
});

describe('createComputeRunner webgpu tier: upload and bind', () => {
  it('uploads the caller view itself, so a subarray keeps its own window', async () => {
    const s = deviceStub();
    const r = await runnerOn(s);
    const backing = new Float32Array(12);
    const view = backing.subarray(4, 9);
    await r.run(view);
    expect(s.writes[0]!.buffer).toBe(s.buffers[0]);
    expect(s.writes[0]!.data).toBe(view);
    expect(s.buffers[0]!.size).toBe(20);
  });

  it('writes the invocation count into the first lane of the uniform', async () => {
    const s = deviceStub();
    const r = await runnerOn(s);
    await r.run(new Float32Array(10), 7);
    expect(s.writes[1]!.buffer).toBe(s.buffers[2]);
    expect(Array.from(s.writes[1]!.data as Uint32Array)).toEqual([7, 0, 0, 0]);
  });

  it('binds each resource at the number the module declares', async () => {
    const s = deviceStub();
    const r = await runnerOn(s, kernelOf({ bindings: [5, 3, 7] }));
    await r.run(new Float32Array([1]));
    expect(s.bindGroups[0]!.entries).toEqual([
      { binding: 5, resource: { buffer: s.buffers[0] } },
      { binding: 3, resource: { buffer: s.buffers[1] } },
      { binding: 7, resource: { buffer: s.buffers[2] } },
    ]);
  });

  it('builds the bind group from the pipeline layout of group 0 and sets it at index 0', async () => {
    const s = deviceStub();
    const r = await runnerOn(s);
    await r.run(new Float32Array([1]));
    expect(s.bindGroups[0]!.layout).toBe(s.layout);
    expect(s.groups.map((g) => g.index)).toEqual([0]);
  });
});

describe('createComputeRunner webgpu tier: dispatch size', () => {
  it('rounds the workgroup count up from the declared workgroup size', async () => {
    const s = deviceStub();
    const r = await runnerOn(s, kernelOf({ workgroupSize: 32 }));
    await r.run(new Float32Array(65));
    await r.run(new Float32Array(64));
    expect(s.dispatches).toEqual([3, 2]);
  });

  it('uses 64 as the workgroup size when the kernel declares none', async () => {
    const s = deviceStub();
    const r = await runnerOn(s, kernelOf({ stripWorkgroup: true }));
    await r.run(new Float32Array(65));
    await r.run(new Float32Array(64));
    expect(s.dispatches).toEqual([2, 1]);
  });

  it('dispatches no workgroup for an empty dispatch', async () => {
    const s = deviceStub();
    const r = await runnerOn(s);
    await r.run(new Float32Array(0));
    expect(s.dispatches).toEqual([0]);
  });
});

describe('createComputeRunner webgpu tier: lifetime and order', () => {
  it('builds the shader module and the pipeline once, not per run', async () => {
    const s = deviceStub();
    const r = await runnerOn(s);
    await r.run(new Float32Array([1]));
    await r.run(new Float32Array([1, 2]));
    expect(s.counts).toEqual({ shaderModules: 1, pipelines: 1 });
  });

  it('refuses to run after dispose, and dispose may repeat', async () => {
    const s = deviceStub();
    const r = await runnerOn(s);
    r.dispose();
    expect(() => {
      r.dispose();
    }).not.toThrow();
    await expect(r.run(new Float32Array([1]))).rejects.toThrow(/runner has been disposed/);
    expect(s.buffers.length).toBe(0);
  });

  it('resolves webgpu first by default when a device and a context are both present', async () => {
    const s = deviceStub();
    const gl = {} as WebGL2RenderingContext;
    const r = await createComputeRunner(kernelOf(), { device: s.device, gl });
    expect(r.backend).toBe('webgpu');
    expect(r.rejected).toEqual([]);
  });
});
