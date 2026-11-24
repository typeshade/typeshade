import { describe, expect, it } from 'vitest';
import { webgl2Device } from './webgl2.js';
import { VERTEX, colourPass, fakeGl, pipelineOf, type FakeGlOptions } from './webgl2-fake-gl.js';

function setup(options?: FakeGlOptions) {
  const fake = fakeGl(options);
  return { ...fake, device: webgl2Device(fake.gl) };
}

const withHostClasses = async (names: string[], body: () => Promise<void> | void) => {
  const holder = globalThis as unknown as Record<string, unknown>;
  const before = names.map((n) => holder[n]);
  names.forEach((n) => (holder[n] = class {}));
  try {
    await body();
  } finally {
    names.forEach((n, i) => (holder[n] = before[i]));
  }
};

describe('the buffers of the WebGL2 backend', () => {
  it('makes a GL buffer for a vertex, an index and a uniform buffer, and for no other', () => {
    const { device, calls } = setup();
    for (const usage of ['vertex', 'index', 'uniform'] as const)
      device.createBuffer({ size: 4, usage: [usage] });
    expect(calls.filter((c) => c === 'createBuffer()')).toHaveLength(3);
    device.createBuffer({ size: 4, usage: ['storage', 'copy-dst', 'copy-src'] });
    expect(calls.filter((c) => c === 'createBuffer()')).toHaveLength(3);
  });

  it('keeps the bytes on the host and reads them back from there', async () => {
    const { device } = setup();
    const buffer = device.createBuffer({ size: 4, usage: ['storage'] });
    device.writeBuffer(buffer, 0, new Uint8Array([1, 2, 3, 4]));
    const read = new Uint8Array(await device.readBuffer(buffer));
    expect(Array.from(read)).toEqual([1, 2, 3, 4]);
    device.writeBuffer(buffer, 1, new Uint8Array([9]));
    expect(Array.from(new Uint8Array(await device.readBuffer(buffer)))).toEqual([1, 9, 3, 4]);
    read[0] = 77;
    expect(new Uint8Array(await device.readBuffer(buffer))[0]).toBe(1);
  });

  it('writes the bytes of a view at its own offset', async () => {
    const { device } = setup();
    const buffer = device.createBuffer({ size: 8, usage: ['storage'] });
    const words = new Uint8Array([0, 0, 5, 6, 0, 0]);
    device.writeBuffer(buffer, 2, words.subarray(2, 4));
    expect(Array.from(new Uint8Array(await device.readBuffer(buffer)))).toEqual([
      0, 0, 5, 6, 0, 0, 0, 0,
    ]);
  });

  it('copies between buffers the device made, on the host', async () => {
    const { device } = setup();
    const from = device.createBuffer({ size: 4, usage: ['copy-src'] });
    const to = device.createBuffer({ size: 4, usage: ['copy-dst'] });
    device.writeBuffer(from, 0, new Uint8Array([1, 2, 3, 4]));
    device.createCommandEncoder().copyBufferToBuffer(from, 1, to, 2, 2);
    expect(Array.from(new Uint8Array(await device.readBuffer(to)))).toEqual([0, 0, 2, 3]);
  });

  it("refuses to copy, read or bind the bytes of a host's own buffer, and writes it where it is", async () => {
    await withHostClasses(['WebGLBuffer'], async () => {
      const { device, calls } = setup();
      const holder = globalThis as unknown as { WebGLBuffer: new () => object };
      const host = device.fromNative('buffer', new holder.WebGLBuffer())!;
      const own = device.createBuffer({ size: 4, usage: ['copy-dst'] });
      const encoder = device.createCommandEncoder();
      expect(() => encoder.copyBufferToBuffer(host, 0, own, 0, 4)).toThrow(
        'copyBufferToBuffer on WebGL2 copies between buffers the device made',
      );
      expect(() => encoder.copyBufferToBuffer(own, 0, host, 0, 4)).toThrow(TypeError);
      await expect(device.readBuffer(host)).rejects.toThrow(
        'readBuffer on WebGL2 reads a buffer the device made.',
      );
      device.writeBuffer(host, 4, new Uint8Array([1, 2]));
      expect(calls).toContain('bufferSubData(COPY_WRITE_BUFFER,4,[1,2])');
      expect(calls.filter((c) => c.startsWith('bindBuffer(COPY_WRITE_BUFFER'))).toHaveLength(2);
    });
  });

  it('deletes the GL buffers of the device with the buffer, and a host buffer not at all', async () => {
    await withHostClasses(['WebGLBuffer'], () => {
      const { device, calls } = setup();
      const holder = globalThis as unknown as { WebGLBuffer: new () => object };
      const host = device.fromNative('buffer', new holder.WebGLBuffer())!;
      device.destroyBuffer(host);
      expect(calls.filter((c) => c.startsWith('deleteBuffer('))).toEqual([]);
      const own = device.createBuffer({ size: 4, usage: ['vertex'] });
      device.destroyBuffer(own);
      expect(calls.filter((c) => c.startsWith('deleteBuffer('))).toHaveLength(1);
      const storage = device.createBuffer({ size: 4, usage: ['storage'] });
      device.destroyBuffer(storage);
      expect(calls.filter((c) => c.startsWith('deleteBuffer('))).toHaveLength(1);
    });
  });
});

describe('a draw with vertex and index buffers', () => {
  const layout = {
    arrayStride: 20,
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'uint32x2' },
      { shaderLocation: 2, offset: 8, format: 'sint32' },
      { shaderLocation: 3, offset: 4, format: 'float32' },
    ],
  };

  it('points each attribute at its place with the call of its type', async () => {
    const { device, calls } = setup();
    const pipeline = await pipelineOf(device, { buffers: [layout] });
    const vertices = device.createBuffer({ size: 60, usage: ['vertex'] });
    colourPass(device, {}, (p) => {
      p.setPipeline(pipeline);
      p.setVertexBuffer(0, vertices);
      p.draw(3);
    });
    const pointers = calls.filter((c) => /^(enableVertex|vertexAttrib)/.test(c));
    expect(pointers).toEqual([
      'enableVertexAttribArray(0)',
      'vertexAttribPointer(0,3,FLOAT,false,20,0)',
      'enableVertexAttribArray(1)',
      'vertexAttribIPointer(1,2,UNSIGNED_INT,20,12)',
      'enableVertexAttribArray(2)',
      'vertexAttribIPointer(2,1,INT,20,8)',
      'enableVertexAttribArray(3)',
      'vertexAttribPointer(3,1,FLOAT,false,20,4)',
    ]);
  });

  it('uploads a vertex buffer when it is first drawn, and again only after a write', async () => {
    const { device, uploads } = setup();
    const pipeline = await pipelineOf(device, { buffers: [layout] });
    const vertices = device.createBuffer({ size: 8, usage: ['vertex'] });
    device.writeBuffer(vertices, 0, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    const draw = (): void =>
      colourPass(device, {}, (p) => {
        p.setPipeline(pipeline);
        p.setVertexBuffer(0, vertices);
        p.draw(1);
        p.draw(1);
      });
    draw();
    draw();
    expect(uploads).toHaveLength(1);
    device.writeBuffer(vertices, 0, new Uint8Array([9]));
    draw();
    expect(uploads).toHaveLength(2);
    expect(uploads[1]![0]).toBe(9);
  });

  it('draws an index buffer with the type of its format, for the instances asked', async () => {
    const { device, calls } = setup();
    const pipeline = await pipelineOf(device);
    const indices = device.createBuffer({ size: 12, usage: ['index'] });
    colourPass(device, {}, (p) => {
      p.setPipeline(pipeline);
      p.setIndexBuffer(indices, 'uint16');
      p.drawIndexed(3, 2);
      p.setIndexBuffer(indices, 'uint32');
      p.drawIndexed(3);
    });
    expect(calls.filter((c) => c.startsWith('drawElementsInstanced('))).toEqual([
      'drawElementsInstanced(TRIANGLES,3,UNSIGNED_SHORT,0,2)',
      'drawElementsInstanced(TRIANGLES,3,UNSIGNED_INT,0,1)',
    ]);
  });
});

describe('the first-vertex-last indices of a draw with no index buffer', () => {
  const flat = (topology = 'triangle-list') =>
    ({ vertex: VERTEX('flat out float v;'), topology }) as const;

  it('shares one buffer for the draws of a topology, and grows it for a longer draw', async () => {
    const { device, calls, uploads } = setup();
    const pipeline = await pipelineOf(device, flat());
    colourPass(device, {}, (p) => {
      p.setPipeline(pipeline);
      p.draw(3);
      p.draw(3);
      p.draw(6);
      p.draw(6);
      p.draw(3);
    });
    expect(calls.filter((c) => c === 'createBuffer()')).toHaveLength(1);
    expect(uploads.map((u) => Array.from(u))).toEqual([
      [1, 2, 0],
      [1, 2, 0, 4, 5, 3],
    ]);
    const counts = calls
      .filter((c) => c.startsWith('drawElementsInstanced('))
      .map((c) => c.split(',')[1]);
    expect(counts).toEqual(['3', '3', '6', '6', '3']);
  });

  it('keeps a buffer for the list and another for the strip', async () => {
    const { device, calls, uploads } = setup();
    const list = await pipelineOf(device, flat());
    const strip = await pipelineOf(device, flat('triangle-strip'));
    colourPass(device, {}, (p) => {
      p.setPipeline(list);
      p.draw(3);
      p.setPipeline(strip);
      p.draw(3);
      p.setPipeline(list);
      p.draw(3);
      p.setPipeline(strip);
      p.draw(3);
    });
    expect(calls.filter((c) => c === 'createBuffer()')).toHaveLength(2);
    expect(uploads.map((u) => Array.from(u))).toEqual([
      [1, 2, 0],
      [1, 2, 0],
    ]);
  });

  it('counts the indices of a draw whose vertices make no whole triangle', async () => {
    const { device, calls } = setup();
    const list = await pipelineOf(device, flat());
    const strip = await pipelineOf(device, flat('triangle-strip'));
    colourPass(device, {}, (p) => {
      p.setPipeline(list);
      p.draw(7);
      p.setPipeline(strip);
      p.draw(2);
    });
    const draws = calls.filter((c) => c.startsWith('drawElementsInstanced('));
    expect(draws).toEqual([
      'drawElementsInstanced(TRIANGLES,6,UNSIGNED_INT,0,1)',
      'drawElementsInstanced(TRIANGLES,0,UNSIGNED_INT,0,1)',
    ]);
  });
});
