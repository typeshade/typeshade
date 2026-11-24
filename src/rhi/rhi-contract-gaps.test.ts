import { describe, expect, it } from 'vitest';
import { cpuProgramOf } from '../core/testing/cpu-program.js';
import { cpuDevice } from './cpu.js';
import { STAGE } from './rhi.js';
import { webgl2Device } from './webgl2.js';
import { fakeGl } from './webgl2-fake-gl.js';
import { webgpuDevice } from './webgpu.js';

const COUNTED = cpuProgramOf(`"use typeshade";
declare const d: storage<array<u32>, "read_write">;
@compute([1, 1, 1]) export function main(g: builtin<"global_invocation_id">): void {
  d[g.x] = d[g.x] + u32(1);
}
`);

async function dispatchedFrom(byteOffset: number, counts: number[]): Promise<number[]> {
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
  const indirect = device.createBuffer({ size: 32, usage: ['indirect', 'copy-dst'] });
  const words = new Uint32Array(8).fill(9);
  if (byteOffset + counts.length * 4 <= words.byteLength) words.set(counts, byteOffset / 4);
  device.writeBuffer(indirect, 0, words);
  const read = device.createBuffer({ size: 16, usage: ['map-read', 'copy-dst'] });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(
    0,
    device.createBindGroup(layout, [{ binding: 0, resource: { buffer: data } }]),
  );
  pass.dispatchWorkgroupsIndirect(indirect, byteOffset);
  pass.end();
  encoder.copyBufferToBuffer(data, 0, read, 0, 16);
  await device.submit([encoder]);
  return [...new Uint32Array(await device.readBuffer(read))];
}

describe('the WebGPU backend and a CPU program', () => {
  it('refuses a module CPU program, and says the backend runs WGSL text', () => {
    const native = {
      features: new Set<string>(),
      limits: { maxTextureDimension2D: 8192, maxBindGroups: 4 },
      createShaderModule: () => {
        throw new Error('The native device must not be reached.');
      },
    };
    const device = webgpuDevice(native);
    expect(() => device.createShaderModule(COUNTED)).toThrow(TypeError);
    expect(() => device.createShaderModule(COUNTED)).toThrow(
      "The WebGPU backend runs WGSL text; it got a module's CPU program.",
    );
  });
});

describe('RhiComputePass.dispatchWorkgroupsIndirect with a byte offset', () => {
  it('reads the three counts from the offset, not from byte 0', async () => {
    expect(await dispatchedFrom(16, [3, 1, 1])).toEqual([1, 1, 1, 0]);
  });

  it('runs nothing when a count at the offset is 0, whatever the words before it say', async () => {
    expect(await dispatchedFrom(16, [3, 0, 1])).toEqual([0, 0, 0, 0]);
  });

  it('refuses counts that do not fit the buffer from the offset', async () => {
    await expect(dispatchedFrom(24, [1, 1, 1])).rejects.toThrow(
      'dispatchWorkgroupsIndirect: three counts from byte 24 do not fit a buffer of 32.',
    );
  });
});

describe('RhiDevice.writeTexture of a region', () => {
  it('writes only the width and height asked, in the first layer, on the CPU device', async () => {
    const device = cpuDevice();
    const texture = device.createTexture({
      size: [4, 4, 2],
      format: 'r8unorm',
      usage: ['copy-dst', 'copy-src'],
    });
    const data = new Uint8Array(32).fill(7);
    device.writeTexture(texture, data, 4, 2, 2);
    const bytes = await device.readTexture(texture, 1);
    expect(Array.from(bytes)).toEqual([7, 7, 0, 0, 7, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('hands the width and height asked to texSubImage2D on the WebGL2 device', () => {
    const fake = fakeGl();
    const device = webgl2Device(fake.gl);
    const texture = device.createTexture({ size: [4, 4, 1], format: 'rgba8unorm', usage: [] });
    device.writeTexture(texture, new Uint8Array(4 * 2 * 3), 8, 2, 3);
    const upload = fake.calls.find((c) => c.startsWith('texSubImage2D('));
    expect(upload).toContain('texSubImage2D(TEXTURE_2D,0,0,0,2,3,RGBA,UNSIGNED_BYTE');
  });
});

describe('RhiDevice.readTexture of a depth32float texture', () => {
  it('gives the depth of each texel on the CPU device', async () => {
    const device = cpuDevice();
    const texture = device.createTexture({
      size: [2, 1, 1],
      format: 'depth32float',
      usage: ['copy-dst', 'copy-src'],
    });
    const depth = new Float32Array([0.25, 0.75]);
    device.writeTexture(texture, depth, depth.byteLength, 2, 1);
    const bytes = await device.readTexture(texture, 4);
    expect(bytes).toHaveLength(8);
    expect([...new Float32Array(bytes.buffer, bytes.byteOffset, 2)]).toEqual([0.25, 0.75]);
  });

  it('refuses a texel size that is not 4 bytes', async () => {
    const device = cpuDevice();
    const texture = device.createTexture({ size: [1, 1, 1], format: 'depth32float', usage: [] });
    await expect(device.readTexture(texture, 8)).rejects.toThrow(
      'readTexture: a "depth32float" texel is 4 bytes, not 8.',
    );
  });
});
