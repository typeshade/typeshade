import { describe, expect, it } from 'vitest';
import { cpuProgramOf } from '../core/testing/cpu-program.js';
import { cpuDevice } from './cpu.js';
import type { RhiDevice } from './rhi.js';
import { STAGE } from './rhi.js';
import { webgl2Device } from './webgl2.js';

const VERTEX = `@vertex export function vs(i: builtin<"vertex_index">): builtin<"position"> {
  const p = vec2(f32((i << u32(1)) & u32(2)), f32(i & u32(2)));
  return vec4(p * 2. - vec2(1., 1.), 0., 1.);
}`;
const FRAGMENT = `@fragment export function fs(): vec4 {
  return vec4(1., 0., 0., 1.);
}`;

const VERTEX_ONLY = cpuProgramOf(`"use typeshade";\n${VERTEX}\n`);
const FRAGMENT_ONLY = cpuProgramOf(`"use typeshade";\n${FRAGMENT}\n`);
const BOTH = cpuProgramOf(`"use typeshade";\n${VERTEX}\n${FRAGMENT}\n`);

const COUNTED = cpuProgramOf(`"use typeshade";
declare const d: storage<array<u32>, "read_write">;
@compute([1, 1, 1]) export function main(g: builtin<"global_invocation_id">): void {
  d[g.x] = d[g.x] + u32(1);
}
`);

type Size = [number, number, number];
const TEXTURE = {
  size: [2, 2, 1] as Size,
  format: 'rgba8unorm' as const,
  usage: ['sampled' as const],
};

function renderDesc(device: RhiDevice, module: typeof BOTH, fragmentModule?: typeof BOTH) {
  return {
    label: 'the pipeline of the test',
    layouts: [device.createBindGroupLayout([])],
    module: device.createShaderModule(module),
    vertex: { entryPoint: 'vs', buffers: [] },
    fragment: {
      entryPoint: 'fs',
      targets: [{ format: 'rgba8unorm' as const }],
      ...(fragmentModule === undefined
        ? {}
        : { module: device.createShaderModule(fragmentModule) }),
    },
    primitive: {
      topology: 'triangle-list' as const,
      cullMode: 'none' as const,
      frontFace: 'ccw' as const,
    },
    multisample: { count: 1, mask: 0xffffffff },
  };
}

async function dispatched(counts: number[]): Promise<number[]> {
  const device = cpuDevice();
  const layout = device.createBindGroupLayout([
    { binding: 0, visibility: STAGE.compute, buffer: { type: 'storage' } },
  ]);
  const pipeline = await device.createComputePipeline({
    layouts: [layout],
    module: device.createShaderModule(COUNTED),
    entryPoint: 'main',
  });
  const data = device.createBuffer({ size: 16, usage: ['storage', 'copy-src', 'copy-dst'] });
  const indirect = device.createBuffer({ size: 12, usage: ['indirect', 'copy-dst'] });
  device.writeBuffer(indirect, 0, new Uint32Array(counts));
  const read = device.createBuffer({ size: 16, usage: ['map-read', 'copy-dst'] });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(
    0,
    device.createBindGroup(layout, [{ binding: 0, resource: { buffer: data } }]),
  );
  pass.dispatchWorkgroupsIndirect(indirect, 0);
  pass.end();
  encoder.copyBufferToBuffer(data, 0, read, 0, 16);
  await device.submit([encoder]);
  return [...new Uint32Array(await device.readBuffer(read))];
}

describe('RhiComputePass.dispatchWorkgroupsIndirect', () => {
  it('runs the workgroups its counts name', async () => {
    expect(await dispatched([3, 1, 1])).toEqual([1, 1, 1, 0]);
  });

  it('runs nothing when a count is 0', async () => {
    expect(await dispatched([3, 0, 1])).toEqual([0, 0, 0, 0]);
    expect(await dispatched([0, 1, 1])).toEqual([0, 0, 0, 0]);
  });
});

describe('RhiDevice.submit and readBuffer', () => {
  it('runs the encoders in order, and reads what ran before the read', async () => {
    const device = cpuDevice();
    const a = device.createBuffer({ size: 4, usage: ['copy-src', 'copy-dst'] });
    const b = device.createBuffer({ size: 4, usage: ['copy-src', 'copy-dst'] });
    const read = device.createBuffer({ size: 4, usage: ['map-read', 'copy-dst'] });
    const words = async () => [...new Uint32Array(await device.readBuffer(read))];
    device.writeBuffer(a, 0, new Uint32Array([1]));
    device.writeBuffer(b, 0, new Uint32Array([2]));
    const first = device.createCommandEncoder();
    first.copyBufferToBuffer(a, 0, read, 0, 4);
    const second = device.createCommandEncoder();
    second.copyBufferToBuffer(b, 0, read, 0, 4);
    await device.submit([first, second]);
    expect(await words()).toEqual([2]);
    const third = device.createCommandEncoder();
    third.copyBufferToBuffer(a, 0, read, 0, 4);
    expect(await words()).toEqual([2]);
    await device.submit([third]);
    expect(await words()).toEqual([1]);
  });
});

describe('RhiDevice.createRenderPipeline', () => {
  it('takes the fragment stage from the module of the pipeline unless the stage names its own', async () => {
    const device = cpuDevice();
    await expect(device.createRenderPipeline(renderDesc(device, BOTH))).resolves.toBeDefined();
    await expect(
      device.createRenderPipeline(renderDesc(device, VERTEX_ONLY, FRAGMENT_ONLY)),
    ).resolves.toBeDefined();
    await expect(device.createRenderPipeline(renderDesc(device, VERTEX_ONLY))).rejects.toThrow(
      'The CPU program has no fragment entry "fs".',
    );
  });

  it('rejects with the error of the backend when a pipeline cannot be made', async () => {
    const device = cpuDevice();
    await expect(
      device.createComputePipeline({
        layouts: [],
        module: device.createShaderModule(VERTEX_ONLY),
        entryPoint: 'main',
      }),
    ).rejects.toThrow('The CPU program has no compute entry "main".');
  });
});

describe('RhiDevice.writeTexture and readTexture', () => {
  it('reads the rows tightly packed, from a write with a wider row', async () => {
    const device = cpuDevice();
    const t = device.createTexture(TEXTURE);
    const padded = new Uint8Array(24);
    padded.set([1, 2, 3, 4, 5, 6, 7, 8], 0);
    padded.set([9, 10, 11, 12, 13, 14, 15, 16], 12);
    device.writeTexture(t, padded, 12, 2, 2);
    expect([...(await device.readTexture(t, 4))]).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
  });

  it('rejects when bytesPerTexel is not the size of a texel', async () => {
    const device = cpuDevice();
    await expect(device.readTexture(device.createTexture(TEXTURE), 2)).rejects.toThrow(
      'readTexture: a "rgba8unorm" texel is 4 bytes, not 2.',
    );
  });
});

describe('RhiDevice validation scopes', () => {
  it('gives the first error since the push, then null', async () => {
    const device = cpuDevice();
    device.pushValidationScope();
    expect(() => device.createBuffer({ size: -1, usage: ['uniform'] })).toThrow();
    expect(() => device.createBuffer({ size: 1.5, usage: ['uniform'] })).toThrow();
    expect(await device.popValidationScope()).toBe(
      'createBuffer: the size -1 is not a whole number of bytes.',
    );
    device.pushValidationScope();
    expect(await device.popValidationScope()).toBeNull();
  });
});

describe('RhiDevice.fromNative', () => {
  it('gives undefined for an object that is not of the kind', () => {
    const device = cpuDevice();
    const buffer = device.createBuffer({ size: 4, usage: ['uniform'] });
    expect(device.fromNative('buffer', buffer)).toBe(buffer);
    expect(device.fromNative('texture', buffer)).toBeUndefined();
    expect(device.fromNative('buffer', {})).toBeUndefined();
    expect(device.fromNative('canvas', {})).toBeUndefined();
  });
});

function plainGl(): WebGL2RenderingContext {
  return new Proxy(
    {},
    {
      get: (_t, key) => {
        if (typeof key !== 'string') return undefined;
        if (/^[A-Z][A-Z0-9_]*$/.test(key)) return 0x4000 + key.length;
        if (key === 'getParameter') return () => 4;
        if (key === 'getExtension') return () => null;
        return () => ({});
      },
    },
  ) as unknown as WebGL2RenderingContext;
}

describe('descriptor defaults', () => {
  it("makes a storage buffer of 'f32' elements on WebGL2 when elem is omitted", () => {
    const device = webgl2Device(plainGl());
    const elemOf = (elem?: 'u32' | 'i32') =>
      (
        device.createBuffer({
          size: 4,
          usage: ['storage'],
          ...(elem === undefined ? {} : { elem }),
        }) as unknown as { elem: string }
      ).elem;
    expect(elemOf()).toBe('f32');
    expect(elemOf('u32')).toBe('u32');
    expect(elemOf('i32')).toBe('i32');
  });

  it("makes a texture '2d' of sample count 1 on WebGL2 when they are omitted", () => {
    const device = webgl2Device(plainGl());
    expect(() => device.createTexture(TEXTURE)).not.toThrow();
    expect(() =>
      device.createTexture({ ...TEXTURE, dimension: '2d', sampleCount: 1 }),
    ).not.toThrow();
    expect(() => device.createTexture({ ...TEXTURE, dimension: '3d' })).toThrow('3D or layered');
    expect(() => device.createTexture({ ...TEXTURE, sampleCount: 4 })).toThrow('multisampled');
  });

  it('makes a texture of sample count 1 on the CPU backend when it is omitted', () => {
    const device = cpuDevice();
    expect(() => device.createTexture(TEXTURE)).not.toThrow();
    expect(() => device.createTexture({ ...TEXTURE, sampleCount: 4 })).toThrow('multisampled');
  });
});
