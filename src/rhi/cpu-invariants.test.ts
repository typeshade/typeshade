import { describe, expect, it } from 'vitest';
import { cpuProgramOf } from '../core/testing/cpu-program.js';
import { cpuDevice } from './cpu.js';
import type { CpuProgram } from './cpu-program.js';
import { STAGE, type RhiBindLayoutEntry, type RhiDevice } from './rhi.js';

const storage = (binding: number): RhiBindLayoutEntry => ({
  binding,
  visibility: STAGE.compute,
  buffer: { type: 'storage' },
});

async function dispatched(
  program: CpuProgram,
  entryPoint: string,
  sizes: readonly number[],
  workgroups: readonly [number, number, number],
  twice = false,
): Promise<{ device: RhiDevice; bytes: Uint8Array[] }> {
  const device = cpuDevice();
  const layout = device.createBindGroupLayout(sizes.map((_, i) => storage(i)));
  const buffers = sizes.map((size) =>
    device.createBuffer({ size, usage: ['storage', 'copy-src', 'copy-dst'] }),
  );
  const pipeline = await device.createComputePipeline({
    layouts: [layout],
    module: device.createShaderModule(program),
    entryPoint,
  });
  const encoder = device.createCommandEncoder();
  for (let k = 0; k < (twice ? 2 : 1); k++) {
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(
      0,
      device.createBindGroup(
        layout,
        buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
      ),
    );
    pass.dispatchWorkgroups(...workgroups);
    pass.end();
  }
  const read = (): Promise<Uint8Array[]> =>
    Promise.all(buffers.map(async (b) => new Uint8Array(await device.readBuffer(b))));
  const before = await read();
  expect(before.every((b) => b.every((v) => v === 0))).toBe(true);
  await device.submit([encoder]);
  return { device, bytes: await read() };
}

const ORDER = `"use typeshade";
declare const next: storage<array<u32>, "read_write">;
declare const log: storage<array<vec4u>, "read_write">;
@compute([2, 2, 1]) export function visit(
  wid: builtin<"workgroup_id">,
  li: builtin<"local_invocation_index">,
): void {
  const k = next[0];
  next[0] = k + u32(1);
  log[k] = vec4u(wid.x, wid.y, wid.z, li);
}
`;

const ZEROED = `"use typeshade";
declare const out: storage<array<u32>, "read_write">;
let tile: workgroup<array<u32, 1>>;
@compute([1, 1, 1]) export function bump(wid: builtin<"workgroup_id">): void {
  tile[0] = tile[0] + u32(1);
  out[wid.x] = tile[0];
}
`;

describe('a dispatch on the CPU backend, its order and its workgroup memory', () => {
  it('runs workgroups in z, then y, then x order and local invocations in the same order', async () => {
    const { bytes } = await dispatched(cpuProgramOf(ORDER), 'visit', [4, 16 * 32], [2, 2, 2]);
    const words = new Uint32Array(bytes[1]!.buffer);
    const got = Array.from({ length: 32 }, (_, k) => [...words.slice(4 * k, 4 * k + 4)]);
    const want: number[][] = [];
    for (let z = 0; z < 2; z++)
      for (let y = 0; y < 2; y++)
        for (let x = 0; x < 2; x++) for (let li = 0; li < 4; li++) want.push([x, y, z, li]);
    expect(new Uint32Array(bytes[0]!.buffer)[0]).toBe(32);
    expect(got).toEqual(want);
  });

  it('zeroes the workgroup variables for each workgroup', async () => {
    const { bytes } = await dispatched(cpuProgramOf(ZEROED), 'bump', [16], [4, 1, 1]);
    expect([...new Uint32Array(bytes[0]!.buffer)]).toEqual([1, 1, 1, 1]);
  });

  it('runs the commands in order, and only when the submit runs them', async () => {
    const device = cpuDevice();
    expect(device.caps.immediate).toBe(false);
    const { bytes } = await dispatched(cpuProgramOf(ZEROED), 'bump', [16], [1, 1, 1], true);
    expect([...new Uint32Array(bytes[0]!.buffer)]).toEqual([1, 0, 0, 0]);
  });
});

const TINT = `"use typeshade";
class Tint {
  c: vec4;
}
declare const tint: uniform<Tint>;
@vertex export function vs(i: builtin<"vertex_index">): builtin<"position"> {
  const p = vec2(f32((i << u32(1)) & u32(2)), f32(i & u32(2)));
  return vec4(p * 2. - vec2(1., 1.), 0., 1.);
}
@fragment export function fs(p: builtin<"position">): vec4 {
  if (p.x > 1.) {
    discard;
  }
  return tint.c;
}
`;

async function drawn(colour: readonly number[], width = 1): Promise<number[]> {
  const device = cpuDevice();
  const program = cpuProgramOf(TINT);
  const layout = device.createBindGroupLayout([
    { binding: 0, visibility: STAGE.fragment, buffer: { type: 'uniform' } },
  ]);
  const tint = device.createBuffer({ size: 16, usage: ['uniform', 'copy-dst'] });
  device.writeBuffer(tint, 0, new Float32Array(colour));
  const texture = device.createTexture({
    size: [width, 1, 1],
    format: 'rgba8unorm',
    usage: ['render', 'copy-src', 'copy-dst'],
  });
  const pipeline = await device.createRenderPipeline({
    layouts: [layout],
    module: device.createShaderModule(program),
    vertex: { entryPoint: 'vs', buffers: [] },
    fragment: { entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
    multisample: { count: 1, mask: 0xffffffff },
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: device.createView(texture),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: [0, 0, 0, 0],
      },
    ],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(
    0,
    device.createBindGroup(layout, [{ binding: 0, resource: { buffer: tint } }]),
  );
  pass.draw(3);
  pass.end();
  await device.submit([encoder]);
  return [...(await device.readTexture(texture, 4))];
}

describe('a render pass on the CPU backend', () => {
  it('converts a colour to an 8-bit unorm target clamped, times 255, rounded', async () => {
    expect(await drawn([0.5, 1.5, -0.2, 0.998])).toEqual([128, 255, 0, 254]);
    expect(await drawn([0.4999, 0.0019, 1, 0.002])).toEqual([127, 0, 255, 1]);
  });

  it('writes nothing for a discard', async () => {
    expect(await drawn([1, 1, 1, 1], 3)).toEqual([255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('an rgba16float texture on the CPU backend', () => {
  it('is stored and read as bytes, and is never drawn into or cleared as colour', async () => {
    const device = cpuDevice();
    const texture = device.createTexture({
      size: [2, 1, 1],
      format: 'rgba16float',
      usage: ['render', 'copy-src', 'copy-dst'],
    });
    const bytes = Uint8Array.from({ length: 16 }, (_, i) => 200 - 7 * i);
    device.writeTexture(texture, bytes, 16, 2, 1);
    expect([...(await device.readTexture(texture, 8))]).toEqual([...bytes]);
    const encoder = device.createCommandEncoder();
    expect(() =>
      encoder
        .beginRenderPass({
          colorAttachments: [
            {
              view: device.createView(texture),
              loadOp: 'clear',
              storeOp: 'store',
              clearValue: [1, 0, 0, 1],
            },
          ],
        })
        .end(),
    ).not.toThrow();
    await expect(device.submit([encoder])).rejects.toThrow(
      'A "rgba16float" target clear is not supported yet on the CPU tier.',
    );
    await expect(
      device.createRenderPipeline({
        layouts: [device.createBindGroupLayout([])],
        module: device.createShaderModule(cpuProgramOf(TINT)),
        vertex: { entryPoint: 'vs', buffers: [] },
        fragment: { entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
        primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
        multisample: { count: 1, mask: 0xffffffff },
      }),
    ).rejects.toThrow('a "rgba16float" colour target');
  });
});

describe('what the CPU backend refuses besides a texture and a derivative', () => {
  it('refuses an entry that reaches a barrier, and a sampler binding', async () => {
    const device = cpuDevice();
    const barrier = cpuProgramOf(`"use typeshade";
declare const out: storage<array<u32>, "read_write">;
@compute([4, 1, 1]) export function sync(gid: builtin<"global_invocation_id">): void {
  workgroupBarrier();
  out[gid.x] = gid.x;
}
`);
    await expect(
      device.createComputePipeline({
        layouts: [device.createBindGroupLayout([storage(0)])],
        module: device.createShaderModule(barrier),
        entryPoint: 'sync',
      }),
    ).rejects.toThrow(
      'it reaches workgroupBarrier(), and the CPU backend runs one invocation at a time',
    );
    expect(() =>
      device.createBindGroupLayout([
        { binding: 1, visibility: STAGE.fragment, label: 'smp', sampler: { type: 'filtering' } },
      ]),
    ).toThrow('is a texture or a sampler, which the CPU tier does not support yet');
  });
});
