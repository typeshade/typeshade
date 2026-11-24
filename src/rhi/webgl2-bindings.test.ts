import { describe, expect, it } from 'vitest';
import type { RhiBindLayoutEntry, RhiDevice, RhiRenderPipeline } from './rhi.js';
import { DATA_WIDTH, glReadBindings, webgl2Device } from './webgl2.js';
import { colourPass, fakeGl, pipelineOf, type FakeGlOptions } from './webgl2-fake-gl.js';

const block = (binding: number, name: string, label?: string): RhiBindLayoutEntry => ({
  binding,
  visibility: 1,
  name,
  ...(label === undefined ? {} : { label }),
  buffer: { type: 'uniform' },
});

const storage = (binding: number, name: string): RhiBindLayoutEntry => ({
  binding,
  visibility: 2,
  name,
  buffer: { type: 'read-only-storage' },
});

const texture = (binding: number, name: string, samplerBinding?: number): RhiBindLayoutEntry => ({
  binding,
  visibility: 2,
  name,
  ...(samplerBinding === undefined ? {} : { samplerBinding }),
  texture: { sampleType: 'float', viewDimension: '2d', multisampled: false },
});

const sampler = (binding: number): RhiBindLayoutEntry => ({
  binding,
  visibility: 2,
  sampler: { type: 'filtering' },
});

function setup(options?: FakeGlOptions) {
  const fake = fakeGl(options);
  return { ...fake, device: webgl2Device(fake.gl) };
}

const nearestOf = (calls: readonly string[]): string =>
  /samplerParameteri\((sampler\d+),TEXTURE_MIN_FILTER,NEAREST\)/.exec(calls.join('\n'))![1]!;

describe('the bindings a WebGL2 pipeline reads', () => {
  it('gives uniform blocks binding points and sampled bindings units, in the order of the layouts', async () => {
    const { device, calls } = setup({
      returns: {
        getUniformBlockIndex: (_p, name) => (name === 'a' ? 3 : name === 'b' ? 5 : 7),
      },
    });
    const pipeline = await pipelineOf(device, {
      layouts: [
        [texture(1, 'tex'), block(0, 'a'), storage(3, 'data')],
        [block(0, 'b'), texture(1, 'other')],
      ],
    });
    expect(glReadBindings(pipeline)).toEqual([
      [0, 1, 3],
      [0, 1],
    ]);
    expect(calls.filter((c) => c.startsWith('uniformBlockBinding('))).toEqual([
      expect.stringMatching(/^uniformBlockBinding\(program\d+,3,0\)$/),
      expect.stringMatching(/^uniformBlockBinding\(program\d+,5,1\)$/),
    ]);
    expect(calls.filter((c) => c.startsWith('uniform1i('))).toEqual([
      'uniform1i(location:tex,0)',
      'uniform1i(location:data,1)',
      'uniform1i(location:other,2)',
    ]);
  });

  it('sets the bindings once, when the program is linked, and not at a draw', async () => {
    const { device, calls } = setup();
    const pipeline = await pipelineOf(device, { layouts: [[block(0, 'a'), texture(1, 'tex')]] });
    const group = device.createBindGroup(device.createBindGroupLayout([]), [
      { binding: 0, resource: { buffer: device.createBuffer({ size: 16, usage: ['uniform'] }) } },
      {
        binding: 1,
        resource: {
          view: device.createView(
            device.createTexture({ size: [2, 2, 1], format: 'rgba8unorm', usage: [] }),
          ),
        },
      },
    ]);
    const before = calls.filter((c) => /^(uniform1i|uniformBlockBinding)\(/.test(c)).length;
    expect(before).toBe(2);
    colourPass(device, {}, (p) => {
      p.setPipeline(pipeline);
      p.setBindGroup(0, group);
      p.draw(3);
      p.draw(3);
    });
    expect(calls.filter((c) => /^(uniform1i|uniformBlockBinding)\(/.test(c))).toHaveLength(before);
  });

  it('leaves a uniform block that the driver found inactive out of the bindings', async () => {
    const { device, calls, constant } = setup({
      returns: {
        getUniformBlockIndex: (_p, name) => (name === 'gone' ? constant('INVALID_INDEX') : 0),
      },
    });
    const pipeline = await pipelineOf(device, {
      layouts: [[block(0, 'gone'), block(1, 'kept')]],
    });
    expect(glReadBindings(pipeline)).toEqual([[1]]);
    expect(calls.filter((c) => c.startsWith('uniformBlockBinding('))).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith('uniformBlockBinding('))[0]).toMatch(/,0,0\)$/);
    expect(calls.filter((c) => c.startsWith('getActiveUniformBlockParameter('))).toHaveLength(1);
  });

  it.each([[0], [-4], [1.5], [Number.NaN], ['64'], [undefined]])(
    'rejects a pipeline when the block size is %s',
    async (size) => {
      const { device } = setup({ returns: { getActiveUniformBlockParameter: () => size } });
      await expect(pipelineOf(device, { layouts: [[block(0, 'a', 'the block')]] })).rejects.toThrow(
        'WebGL2 reports an invalid uniform block size for "the block".',
      );
    },
  );

  it('names a block in the error by its name when it has no label', async () => {
    const { device } = setup({ returns: { getActiveUniformBlockParameter: () => 0 } });
    await expect(pipelineOf(device, { layouts: [[block(0, 'only_name')]] })).rejects.toThrow(
      'for "only_name".',
    );
  });
});

function bound(device: RhiDevice, pipeline: RhiRenderPipeline, entries: Record<number, object>) {
  const group = device.createBindGroup(
    device.createBindGroupLayout([]),
    Object.entries(entries).map(([binding, resource]) => ({
      binding: Number(binding),
      resource: resource as never,
    })),
  );
  return (draws: number, between: () => void = () => undefined) =>
    colourPass(device, {}, (p) => {
      p.setPipeline(pipeline);
      p.setBindGroup(0, group);
      for (let i = 0; i < draws; i++) {
        if (i > 0) between();
        p.draw(3);
      }
    });
}

describe('a draw binds what the pass holds to the units of the pipeline', () => {
  it('pads a uniform buffer to the block size, uploads it once, and again after a write', async () => {
    const { device, calls, uploads } = setup({
      returns: { getActiveUniformBlockParameter: () => 48 },
    });
    const pipeline = await pipelineOf(device, { layouts: [[block(0, 'a')]] });
    const buffer = device.createBuffer({ size: 8, usage: ['uniform', 'copy-dst'] });
    device.writeBuffer(buffer, 0, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    const run = bound(device, pipeline, { 0: { buffer } });
    run(2);
    const padded = uploads.filter((u) => u.length === 48);
    expect(padded).toHaveLength(1);
    expect(Array.from(padded[0]!.slice(0, 10))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 0, 0]);
    expect(calls.filter((c) => c.startsWith('bindBufferBase(UNIFORM_BUFFER,0,'))).toHaveLength(2);
    device.writeBuffer(buffer, 0, new Uint8Array([9]));
    run(1);
    const again = uploads.filter((u) => u.length === 48);
    expect(again).toHaveLength(2);
    expect(again[1]![0]).toBe(9);
  });

  it('pads again when another pipeline gives the block a larger size', async () => {
    let size = 32;
    const { device, uploads } = setup({
      returns: { getActiveUniformBlockParameter: () => size },
    });
    const small = await pipelineOf(device, { layouts: [[block(0, 'a')]] });
    size = 96;
    const large = await pipelineOf(device, { layouts: [[block(0, 'b')]], vertex: 'x' });
    const buffer = device.createBuffer({ size: 8, usage: ['uniform'] });
    bound(device, small, { 0: { buffer } })(1);
    bound(device, large, { 0: { buffer } })(1);
    expect(uploads.map((u) => u.length)).toEqual([32, 96]);
  });

  it("binds a host's own uniform buffer as it is, with no upload", async () => {
    class WebGLBuffer {
      readonly __name = 'host-buffer';
    }
    const holder = globalThis as unknown as Record<string, unknown>;
    const before = holder.WebGLBuffer;
    holder.WebGLBuffer = WebGLBuffer;
    try {
      const { device, calls, uploads } = setup();
      const pipeline = await pipelineOf(device, { layouts: [[block(0, 'a')]] });
      const buffer = device.fromNative('buffer', new WebGLBuffer())!;
      bound(device, pipeline, { 0: { buffer } })(1);
      expect(calls).toContain('bindBufferBase(UNIFORM_BUFFER,0,host-buffer)');
      expect(uploads).toEqual([]);
    } finally {
      holder.WebGLBuffer = before;
    }
  });

  it('binds a texture with the sampler of its pair, and one with none with the nearest sampler', async () => {
    const { device, calls } = setup();
    const pipeline = await pipelineOf(device, {
      layouts: [[texture(0, 'paired', 1), sampler(1), texture(2, 'alone')]],
    });
    const make = () =>
      device.createView(device.createTexture({ size: [2, 2, 1], format: 'rgba8unorm', usage: [] }));
    const chosen = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'nearest',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      addressModeW: 'repeat',
    });
    bound(device, pipeline, {
      0: { view: make() },
      1: { sampler: chosen },
      2: { view: make() },
    })(1);
    const nearest = nearestOf(calls);
    const sampled = calls.filter((c) => c.startsWith('bindSampler('));
    expect(sampled).toHaveLength(2);
    expect(sampled[0]).toMatch(/^bindSampler\(0,sampler\d+\)$/);
    expect(sampled[0]).not.toContain(nearest);
    expect(sampled[1]).toBe(`bindSampler(1,${nearest})`);
    expect(calls.filter((c) => c.startsWith('activeTexture('))).toEqual([
      'activeTexture(TEXTURE0)',
      'activeTexture(TEXTURE1)',
    ]);
  });

  it('reads a texture with no sampler nearest and clamped', () => {
    const { device, calls } = setup();
    device.createTexture({ size: [2, 2, 1], format: 'rgba8unorm', usage: [] });
    const nearest = nearestOf(calls);
    const set = calls.filter((c) => c.startsWith(`samplerParameteri(${nearest},`));
    expect(set).toEqual([
      `samplerParameteri(${nearest},TEXTURE_MIN_FILTER,NEAREST)`,
      `samplerParameteri(${nearest},TEXTURE_MAG_FILTER,NEAREST)`,
      `samplerParameteri(${nearest},TEXTURE_WRAP_S,CLAMP_TO_EDGE)`,
      `samplerParameteri(${nearest},TEXTURE_WRAP_T,CLAMP_TO_EDGE)`,
    ]);
  });

  it('refuses a draw with a binding that the group lacks', async () => {
    const { device } = setup();
    const pipeline = await pipelineOf(device, { layouts: [[block(5, 'a')]] });
    expect(() => bound(device, pipeline, {})(1)).toThrow('webgl2: binding 5 is not bound');
  });

  it('refuses a draw before a pipeline, and an indexed draw with no index buffer', async () => {
    const { device } = setup();
    const pipeline = await pipelineOf(device);
    expect(() => colourPass(device, {}, (p) => p.draw(3))).toThrow(
      'webgl2: a draw before setPipeline()',
    );
    expect(() =>
      colourPass(device, {}, (p) => {
        p.setPipeline(pipeline);
        p.drawIndexed(3);
      }),
    ).toThrow('webgl2: drawIndexed() with no index buffer');
  });
});

function dataRun(elem: 'f32' | 'i32' | 'u32', bytes: ArrayBuffer | ArrayBufferView, size?: number) {
  const fake = setup();
  const { device } = fake;
  const length = size ?? bytes.byteLength;
  const buffer = device.createBuffer({ size: length, usage: ['storage', 'copy-dst'], elem });
  device.writeBuffer(buffer, 0, bytes);
  return { ...fake, buffer, run: pipelineOf(device, { layouts: [[storage(0, 'data')]] }) };
}

describe('a storage buffer as a data texture', () => {
  it('has rows of 2048 words', () => {
    expect(DATA_WIDTH).toBe(2048);
  });

  it.each([
    ['f32', 'R32F', 'RED', 'FLOAT', new Float32Array([1.5, -2, 3]), '[1.5,-2,3]'],
    [
      'u32',
      'R32UI',
      'RED_INTEGER',
      'UNSIGNED_INT',
      new Uint32Array([7, 4294967295]),
      '[7,4294967295]',
    ],
    ['i32', 'R32I', 'RED_INTEGER', 'INT', new Int32Array([-7, 8]), '[-7,8]'],
  ] as const)(
    'makes one texel of the %s element type: %s, %s, %s',
    async (elem, internal, format, type, words, shown) => {
      const { device, calls, buffer, run } = dataRun(elem, words);
      const pipeline = await run;
      bound(device, pipeline, { 0: { buffer } })(1);
      expect(calls).toContain(`texStorage2D(TEXTURE_2D,1,${internal},${words.length},1)`);
      expect(calls).toContain(
        `texSubImage2D(TEXTURE_2D,0,0,0,${words.length},1,${format},${type},${shown})`,
      );
      expect(calls).toContain('pixelStorei(UNPACK_ALIGNMENT,1)');
    },
  );

  it.each([
    [4, 1, 1],
    [6, 2, 1],
    [0, 1, 1],
    [2048 * 4, 2048, 1],
    [2049 * 4, 2048, 2],
    [5000 * 4, 2048, 3],
  ])('lays %i bytes in %i words of %i rows', async (size, width, rows) => {
    const { device, calls, buffer, run } = dataRun('u32', new Uint8Array(size), size);
    const pipeline = await run;
    bound(device, pipeline, { 0: { buffer } })(1);
    expect(calls).toContain(`texStorage2D(TEXTURE_2D,1,R32UI,${width},${rows})`);
  });

  it('makes the texture again when the bytes have changed, and not before', async () => {
    const { device, calls, buffer, run } = dataRun('u32', new Uint32Array([1, 2]));
    const pipeline = await run;
    const drawn = bound(device, pipeline, { 0: { buffer } });
    const stores = () =>
      calls.filter((c) => c.startsWith('texStorage2D(TEXTURE_2D,1,R32UI')).length;
    drawn(3);
    expect(stores()).toBe(1);
    expect(calls.filter((c) => c.startsWith('deleteTexture('))).toEqual([]);
    device.writeBuffer(buffer, 0, new Uint32Array([5, 6]));
    drawn(1);
    expect(stores()).toBe(2);
    expect(calls.filter((c) => c.startsWith('deleteTexture('))).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith('texSubImage2D(')).pop()).toContain('[5,6])');
  });

  it('is made again after a copy into the buffer', async () => {
    const { device, calls, buffer, run } = dataRun('u32', new Uint32Array([1, 2]));
    const pipeline = await run;
    const source = device.createBuffer({ size: 8, usage: ['copy-src'] });
    device.writeBuffer(source, 0, new Uint32Array([8, 9]));
    const drawn = bound(device, pipeline, { 0: { buffer } });
    drawn(1);
    device.createCommandEncoder().copyBufferToBuffer(source, 0, buffer, 0, 8);
    drawn(1);
    expect(calls.filter((c) => c.startsWith('texSubImage2D(')).pop()).toContain('[8,9])');
  });

  it('refuses a storage binding of a buffer the host made', async () => {
    class WebGLBuffer {}
    const holder = globalThis as unknown as Record<string, unknown>;
    const before = holder.WebGLBuffer;
    holder.WebGLBuffer = WebGLBuffer;
    try {
      const { device } = setup();
      const pipeline = await pipelineOf(device, { layouts: [[storage(0, 'data')]] });
      const buffer = device.fromNative('buffer', new WebGLBuffer())!;
      expect(() => bound(device, pipeline, { 0: { buffer } })(1)).toThrow(
        'A storage binding on WebGL2 takes a buffer the device made',
      );
    } finally {
      holder.WebGLBuffer = before;
    }
  });
});
