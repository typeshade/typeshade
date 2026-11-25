import { describe, expect, it } from 'vitest';
import type { RhiBindLayoutEntry } from './rhi.js';
import { webgl2Device } from './webgl2.js';
import { VERTEX, colourPass, fakeGl, pipelineOf } from './webgl2-fake-gl.js';

function setup() {
  const fake = fakeGl();
  return { ...fake, device: webgl2Device(fake.gl) };
}

const layout = {
  arrayStride: 4,
  attributes: [{ shaderLocation: 0, offset: 0, format: 'float32' }],
} as never;

const storage: RhiBindLayoutEntry = {
  binding: 0,
  visibility: 2,
  name: 'data',
  buffer: { type: 'read-only-storage' },
};

const countOf = (calls: readonly string[], name: string): number =>
  calls.filter((c) => c.startsWith(`${name}(`)).length;

describe('what a render pass takes of its device', () => {
  it('uploads each vertex buffer and the index buffer at draw time, to their own targets', async () => {
    const { device, calls, uploads } = setup();
    const pipeline = await pipelineOf(device, { buffers: [layout, layout] });
    const first = device.createBuffer({ size: 4, usage: ['vertex'] });
    const second = device.createBuffer({ size: 4, usage: ['vertex'] });
    const indices = device.createBuffer({ size: 4, usage: ['index'] });
    device.writeBuffer(first, 0, new Uint8Array([1, 1, 1, 1]));
    device.writeBuffer(second, 0, new Uint8Array([2, 2, 2, 2]));
    device.writeBuffer(indices, 0, new Uint8Array([3, 3, 3, 3]));
    colourPass(device, {}, (p) => {
      p.setPipeline(pipeline);
      p.setVertexBuffer(0, first);
      p.setVertexBuffer(1, second);
      p.setIndexBuffer(indices, 'uint16');
      expect(uploads).toHaveLength(0);
      p.drawIndexed(2);
    });
    expect(uploads.map((u) => u[0])).toEqual([1, 2, 3]);
    const targets = calls.filter((c) => c.startsWith('bufferData(')).map((c) => c.split(',')[0]);
    expect(targets).toEqual([
      'bufferData(ARRAY_BUFFER',
      'bufferData(ARRAY_BUFFER',
      'bufferData(ELEMENT_ARRAY_BUFFER',
    ]);
  });

  it('uploads an index buffer again only after a write', async () => {
    const { device, uploads } = setup();
    const pipeline = await pipelineOf(device);
    const indices = device.createBuffer({ size: 4, usage: ['index'] });
    device.writeBuffer(indices, 0, new Uint8Array([3, 3, 3, 3]));
    const draw = (): void =>
      colourPass(device, {}, (p) => {
        p.setPipeline(pipeline);
        p.setIndexBuffer(indices, 'uint16');
        p.drawIndexed(2);
      });
    draw();
    draw();
    expect(uploads).toHaveLength(1);
    device.writeBuffer(indices, 0, new Uint8Array([4]));
    draw();
    expect(uploads).toHaveLength(2);
  });

  it('draws a flat pipeline without the extension with the indices that its device made', async () => {
    const { device, calls, uploads } = setup();
    const pipeline = await pipelineOf(device, { vertex: VERTEX('flat out float v;') });
    const draw = (): void =>
      colourPass(device, {}, (p) => {
        p.setPipeline(pipeline);
        p.draw(6);
      });
    draw();
    draw();
    expect(uploads.map((u) => Array.from(u))).toEqual([[1, 2, 0, 4, 5, 3]]);
    expect(countOf(calls, 'createBuffer')).toBe(1);
    const buffer = calls.find((c) => c.startsWith('bindBuffer(ELEMENT_ARRAY_BUFFER,buffer'))!;
    expect(calls.filter((c) => c === buffer).length).toBeGreaterThanOrEqual(2);
    expect(calls.filter((c) => c.startsWith('drawElementsInstanced('))).toEqual([
      'drawElementsInstanced(TRIANGLES,6,UNSIGNED_INT,0,1)',
      'drawElementsInstanced(TRIANGLES,6,UNSIGNED_INT,0,1)',
    ]);
  });

  it('binds the data texture that its device made for a storage binding, one for each buffer', async () => {
    const { device, calls } = setup();
    const pipeline = await pipelineOf(device, { layouts: [[storage]] });
    const buffer = device.createBuffer({
      size: 8,
      usage: ['storage', 'copy-dst'],
      elem: 'u32',
    });
    device.writeBuffer(buffer, 0, new Uint32Array([1, 2]));
    const group = device.createBindGroup(device.createBindGroupLayout([storage]), [
      { binding: 0, resource: { buffer } },
    ]);
    const draw = (): void =>
      colourPass(device, {}, (p) => {
        p.setPipeline(pipeline);
        p.setBindGroup(0, group);
        p.draw(3);
      });
    const stores = (): number =>
      calls.filter((c) => c.startsWith('texStorage2D(TEXTURE_2D,1,R32UI')).length;
    draw();
    expect(stores()).toBe(1);
    draw();
    expect(stores()).toBe(1);
    const stored = calls.findIndex((c) => c.startsWith('texStorage2D(TEXTURE_2D,1,R32UI'));
    const name = /^bindTexture\(TEXTURE_2D,(texture\d+)\)$/.exec(calls[stored - 1]!)![1]!;
    const unit = calls.filter((c, k) => c === `bindTexture(TEXTURE_2D,${name})` && k > stored);
    expect(unit).toHaveLength(2);
  });
});

describe('what an encoder takes of its device', () => {
  it('begins a pass on the state of its device, made once for the device', () => {
    const { device, calls } = setup();
    colourPass(device);
    const before = countOf(calls, 'createFramebuffer');
    expect(before).toBeGreaterThan(0);
    colourPass(device);
    device.createCommandEncoder().beginRenderPass({
      colorAttachments: [
        {
          view: device.createView(
            device.createTexture({ size: [8, 8, 1], format: 'rgba8unorm', usage: ['render'] }),
          ),
          loadOp: 'load',
          storeOp: 'store',
          clearValue: [0, 0, 0, 0],
        },
      ],
    });
    expect(countOf(calls, 'createFramebuffer')).toBe(before);
    expect(countOf(calls, 'createSampler')).toBe(1);
  });

  it('makes a new encoder for each call, whose pass draws on the context of the device', async () => {
    const a = setup();
    const b = setup();
    const pipeline = await pipelineOf(a.device);
    expect(a.device.createCommandEncoder()).not.toBe(a.device.createCommandEncoder());
    const quiet = b.calls.length;
    colourPass(a.device, {}, (p) => {
      p.setPipeline(pipeline);
      p.draw(3);
    });
    expect(countOf(a.calls, 'drawArraysInstanced')).toBe(1);
    expect(b.calls.length).toBe(quiet);
  });
});
