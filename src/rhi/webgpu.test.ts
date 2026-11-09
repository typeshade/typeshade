// The WebGPU backend of the render hardware interface (change 0120, M1) against a recording
// `GPUDevice`: the native call and descriptor each RHI call becomes, the handles it gives (the
// native objects, but the encoder), and the host objects `fromNative` takes. The program runtime's
// tests (`src/runtime/*.test.ts`) hold the runtime on this backend to the native calls it made
// before the RHI; on a real device the journeys and the render gate hold its frames.

import { describe, expect, it } from 'vitest';
import type { RhiBindGroupLayout, RhiCommandEncoder, RhiDevice, RhiShaderModule } from './rhi.js';
import { webgpuDevice } from './webgpu.js';

/** A `GPUDevice` that records each native call as its name and its descriptor. */
function recording(options: { error?: string } = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  const record =
    (name: string, result: (...args: unknown[]) => unknown = () => ({ made: name })) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
      return result(...args);
    };
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const buffer = (d: unknown) => {
    const size = (d as { size: number }).size;
    const mapped = new Uint8Array(size);
    mapped.set(bytes.subarray(0, Math.min(size, bytes.length)));
    return {
      size,
      mapAsync: record('mapAsync', async () => {}),
      getMappedRange: record('getMappedRange', () => mapped.buffer),
      unmap: record('unmap'),
      destroy: record('buffer.destroy'),
    };
  };
  const pass = { setPipeline() {}, draw() {}, dispatchWorkgroups() {}, end() {} };
  const encoder = {
    beginRenderPass: record('beginRenderPass', () => pass),
    beginComputePass: record('beginComputePass', () => pass),
    copyBufferToBuffer: record('copyBufferToBuffer'),
    copyTextureToBuffer: record('copyTextureToBuffer'),
    finish: record('finish', () => ({ finished: true })),
  };
  const native = {
    features: new Set(['shader-f16']),
    limits: { maxTextureDimension2D: 8192, maxBindGroups: 4 },
    queue: {
      submit: record('submit'),
      writeBuffer: record('writeBuffer'),
      writeTexture: record('writeTexture'),
      onSubmittedWorkDone: record('onSubmittedWorkDone', async () => {}),
    },
    createBuffer: record('createBuffer', buffer),
    createTexture: record('createTexture', (d) => ({
      width: (d as { size: number[] }).size[0],
      height: (d as { size: number[] }).size[1],
      format: (d as { format: string }).format,
      createView: record('createView', () => ({ view: true })),
      destroy: record('texture.destroy'),
    })),
    createSampler: record('createSampler'),
    createShaderModule: record('createShaderModule'),
    createBindGroupLayout: record('createBindGroupLayout'),
    createPipelineLayout: record('createPipelineLayout', () => ({ pipelineLayout: true })),
    createBindGroup: record('createBindGroup'),
    createComputePipelineAsync: record('createComputePipelineAsync', async () => ({})),
    createRenderPipelineAsync: record('createRenderPipelineAsync', async () => ({})),
    createCommandEncoder: record('createCommandEncoder', () => encoder),
    pushErrorScope: record('pushErrorScope'),
    popErrorScope: record('popErrorScope', async () =>
      options.error === undefined ? null : { message: options.error },
    ),
    destroy: record('destroy'),
  };
  /** The arguments of the calls named `name`, in order. */
  const args = (name: string) => calls.filter((c) => c.name === name).map((c) => c.args);
  return { native, calls, args, encoder, pass };
}

describe('the WebGPU backend of the RHI', () => {
  it('reports its capabilities from the device', () => {
    const { native } = recording();
    const rhi: RhiDevice = webgpuDevice(native);
    expect(rhi.backend).toBe('webgpu');
    expect(rhi.native).toBe(native);
    expect(rhi.caps.compute).toBe('native');
    expect(rhi.caps.shaderLanguage).toBe('wgsl');
    expect(rhi.caps.limits).toEqual({ maxTextureDimension2D: 8192, maxBindGroups: 4 });
    expect(Object.isFrozen(rhi.caps.limits)).toBe(true);
    expect(rhi.caps.hasFeature('shader-f16')).toBe(true);
    expect(rhi.caps.hasFeature('timestamp-query')).toBe(false);
  });

  it('makes a buffer with the usage flags of its usage names, and gives the native buffer', () => {
    const { native, args } = recording();
    const rhi = webgpuDevice(native);
    const b = rhi.createBuffer({ size: 64, usage: ['storage', 'copy-src', 'copy-dst'] });
    expect(args('createBuffer')).toEqual([[{ size: 64, usage: 0x80 | 0x4 | 0x8 }]]);
    expect(b.size).toBe(64);
    expect(rhi.toNative(b)).toBe(b);
    rhi.createBuffer({ size: 16, usage: ['map-read', 'copy-dst'] });
    rhi.createBuffer({ size: 16, usage: ['uniform', 'vertex', 'index'] });
    expect(args('createBuffer').map(([d]) => (d as { usage: number }).usage)).toEqual([
      0x8c,
      0x1 | 0x8,
      0x40 | 0x20 | 0x10,
    ]);
    const data = new Uint32Array(2);
    rhi.writeBuffer(b, 4, data);
    expect(args('writeBuffer')).toEqual([[b, 4, data]]);
    rhi.destroyBuffer(b);
    expect(args('buffer.destroy')).toHaveLength(1);
  });

  it('reads a mapped buffer back as a copy, and unmaps it', async () => {
    const { native, calls } = recording();
    const rhi = webgpuDevice(native);
    const b = rhi.createBuffer({ size: 8, usage: ['map-read', 'copy-dst'] });
    const bytes = await rhi.readBuffer(b);
    expect([...new Uint8Array(bytes)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(calls.map((c) => c.name).slice(1)).toEqual(['mapAsync', 'getMappedRange', 'unmap']);
    expect(calls[1]!.args).toEqual([1]);
  });

  it('makes a texture with the flags of its usage names, and names only the fields it is given', () => {
    const { native, args } = recording();
    const rhi = webgpuDevice(native);
    const t = rhi.createTexture({
      size: [4, 2, 1],
      format: 'rgba16float',
      dimension: '2d',
      sampleCount: 1,
      usage: ['render', 'sampled', 'copy-src', 'copy-dst', 'storage'],
    });
    rhi.createTexture({ size: [1, 1, 1], format: 'rgba8unorm', usage: ['sampled', 'copy-dst'] });
    expect(args('createTexture')).toEqual([
      [
        {
          size: [4, 2, 1],
          format: 'rgba16float',
          dimension: '2d',
          sampleCount: 1,
          usage: 0x10 | 0x04 | 0x01 | 0x02 | 0x08,
        },
      ],
      [{ size: [1, 1, 1], format: 'rgba8unorm', usage: 0x04 | 0x02 }],
    ]);
    expect([t.width, t.height, t.format]).toEqual([4, 2, 'rgba16float']);
    const pixel = new Uint8Array([255, 255, 255, 255]);
    rhi.writeTexture(t, pixel, 4, 1, 1);
    expect(args('writeTexture')).toEqual([[{ texture: t }, pixel, { bytesPerRow: 4 }, [1, 1, 1]]]);
    expect(rhi.createView(t)).toEqual({ view: true });
    rhi.destroyTexture(t);
    expect(args('texture.destroy')).toHaveLength(1);
  });

  it('reads a texture back through rows of 256 bytes, submitted before it awaits', async () => {
    const { native, args, calls } = recording();
    const rhi = webgpuDevice(native);
    const t = rhi.createTexture({ size: [3, 2, 1], format: 'depth32float', usage: ['copy-src'] });
    const read = rhi.readTexture(t, 4);
    // The copy and its submit are recorded before the read awaits anything.
    expect(calls.map((c) => c.name)).toContain('submit');
    const out = await read;
    expect(args('createBuffer')).toEqual([[{ size: 512, usage: 0x1 | 0x8 }]]);
    expect(args('copyTextureToBuffer')).toEqual([
      [
        { texture: t, aspect: 'depth-only' },
        { buffer: expect.anything(), bytesPerRow: 256 },
        [3, 2, 1],
      ],
    ]);
    expect(out).toHaveLength(3 * 4 * 2);
    expect([...out.subarray(0, 8)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(args('buffer.destroy')).toHaveLength(1);
  });

  it('turns a render pipeline into the descriptor WebGPU takes', async () => {
    const { native, args } = recording();
    const rhi = webgpuDevice(native);
    const module = rhi.createShaderModule('@vertex fn vs() {}');
    expect(args('createShaderModule')).toEqual([[{ code: '@vertex fn vs() {}' }]]);
    const layout = rhi.createBindGroupLayout([
      { binding: 0, visibility: 0x1 | 0x2, buffer: { type: 'uniform' } },
    ]);
    expect(args('createBindGroupLayout')).toEqual([
      [{ entries: [{ binding: 0, visibility: 3, buffer: { type: 'uniform' } }] }],
    ]);
    await rhi.createRenderPipeline({
      layouts: [layout],
      module,
      vertex: { entryPoint: 'vs', buffers: [] },
      fragment: { entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
      constants: { '0': 2 },
      primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
      depthStencil: {
        format: 'depth24plus-stencil8',
        compare: 'less',
        write: true,
        bias: { constant: 2, slopeScale: 0, clamp: 0 },
        stencil: {
          front: { compare: 'always', failOp: 'keep', depthFailOp: 'keep', passOp: 'replace' },
          back: { compare: 'always', failOp: 'keep', depthFailOp: 'keep', passOp: 'keep' },
          readMask: 0xff,
          writeMask: 0x0f,
        },
      },
      multisample: { count: 4, mask: 0xffffffff },
    });
    expect(args('createPipelineLayout')).toEqual([[{ bindGroupLayouts: [layout] }]]);
    expect(args('createRenderPipelineAsync')).toEqual([
      [
        {
          layout: { pipelineLayout: true },
          vertex: { module, entryPoint: 'vs', buffers: [], constants: { '0': 2 } },
          fragment: {
            module,
            entryPoint: 'fs',
            targets: [{ format: 'rgba8unorm' }],
            constants: { '0': 2 },
          },
          primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
          depthStencil: {
            format: 'depth24plus-stencil8',
            depthCompare: 'less',
            depthWriteEnabled: true,
            depthBias: 2,
            stencilFront: {
              compare: 'always',
              failOp: 'keep',
              depthFailOp: 'keep',
              passOp: 'replace',
            },
            stencilBack: { compare: 'always', failOp: 'keep', depthFailOp: 'keep', passOp: 'keep' },
            stencilReadMask: 0xff,
            stencilWriteMask: 0x0f,
          },
          multisample: { count: 4 },
        },
      ],
    ]);
  });

  it('leaves out of a pipeline what the description does not have', async () => {
    const { native, args } = recording();
    const rhi = webgpuDevice(native);
    const module = {} as RhiShaderModule;
    await rhi.createRenderPipeline({
      layouts: [],
      module,
      vertex: { entryPoint: 'vs', buffers: [] },
      primitive: { topology: 'point-list', cullMode: 'back', frontFace: 'cw' },
      multisample: { count: 1, mask: 0xffffffff },
    });
    await rhi.createComputePipeline({ layouts: [], module, entryPoint: 'main' });
    expect(args('createRenderPipelineAsync')).toStrictEqual([
      [
        {
          layout: { pipelineLayout: true },
          vertex: { module, entryPoint: 'vs', buffers: [] },
          primitive: { topology: 'point-list', cullMode: 'back', frontFace: 'cw' },
        },
      ],
    ]);
    expect(args('createComputePipelineAsync')).toStrictEqual([
      [{ layout: { pipelineLayout: true }, compute: { module, entryPoint: 'main' } }],
    ]);
  });

  it('rejects with the native error when a pipeline cannot be made', async () => {
    const { native } = recording();
    native.createComputePipelineAsync = async () => {
      throw new Error('bad entry point');
    };
    const rhi = webgpuDevice(native);
    await expect(
      rhi.createComputePipeline({ layouts: [], module: {} as RhiShaderModule, entryPoint: 'x' }),
    ).rejects.toThrow('bad entry point');
  });

  it('binds each kind of resource as WebGPU takes it', () => {
    const { native, args } = recording();
    const rhi = webgpuDevice(native);
    const buffer = rhi.createBuffer({ size: 32, usage: ['storage'] });
    const view = rhi.createView(
      rhi.createTexture({ size: [1, 1, 1], format: 'r8unorm', usage: [] }),
    );
    const sampler = rhi.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'nearest',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      addressModeW: 'clamp-to-edge',
      compare: 'less',
    });
    expect(args('createSampler')).toEqual([
      [
        {
          magFilter: 'linear',
          minFilter: 'linear',
          mipmapFilter: 'nearest',
          addressModeU: 'repeat',
          addressModeV: 'repeat',
          addressModeW: 'clamp-to-edge',
          compare: 'less',
        },
      ],
    ]);
    const external = { external: true };
    const layout = {} as RhiBindGroupLayout;
    rhi.createBindGroup(layout, [
      { binding: 0, resource: { buffer } },
      { binding: 1, resource: { buffer, size: 20 } },
      { binding: 2, resource: { view } },
      { binding: 3, resource: { sampler } },
      { binding: 4, resource: { native: external } },
    ]);
    expect(args('createBindGroup')).toStrictEqual([
      [
        {
          layout,
          entries: [
            { binding: 0, resource: { buffer } },
            { binding: 1, resource: { buffer, size: 20 } },
            { binding: 2, resource: view },
            { binding: 3, resource: sampler },
            { binding: 4, resource: external },
          ],
        },
      ],
    ]);
  });

  it('records a render pass with its attachments, and finishes the encoder at the submit', async () => {
    const { native, args, calls, pass } = recording();
    const rhi = webgpuDevice(native);
    const encoder = rhi.createCommandEncoder();
    const color = { color: true } as never;
    const depth = { depth: true } as never;
    const p = encoder.beginRenderPass({
      colorAttachments: [
        { view: color, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
      ],
      depthStencilAttachment: { view: depth, depthReadOnly: true },
    });
    // A pass is the native pass: a host's `raw` draws are recorded into the same encoder.
    expect(p).toBe(pass);
    expect(rhi.toNative(p)).toBe(pass);
    expect(args('beginRenderPass')).toStrictEqual([
      [
        {
          colorAttachments: [
            { view: color, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
          ],
          depthStencilAttachment: { view: depth, depthReadOnly: true },
        },
      ],
    ]);
    const a = rhi.createBuffer({ size: 4, usage: ['copy-src'] });
    const b = rhi.createBuffer({ size: 4, usage: ['copy-dst'] });
    encoder.copyBufferToBuffer(a, 0, b, 0, 4);
    expect(args('copyBufferToBuffer')).toEqual([[a, 0, b, 0, 4]]);
    expect(args('finish')).toEqual([]);
    const done = rhi.submit([encoder]);
    expect(args('finish')).toHaveLength(1);
    expect(args('submit')).toEqual([[[{ finished: true }]]]);
    await done;
    expect(calls.map((c) => c.name)).toContain('onSubmittedWorkDone');
  });

  it('gives the native encoder for the escape hatch, and takes a host encoder back', () => {
    const { native, encoder } = recording();
    const rhi = webgpuDevice(native);
    const made = rhi.createCommandEncoder();
    expect(rhi.toNative(made)).toBe(encoder);
    // The RHI's own encoder is taken as it is; a native one is wrapped.
    expect(rhi.fromNative('encoder', made)).toBe(made);
    const host = rhi.fromNative('encoder', encoder) as RhiCommandEncoder;
    expect(host).not.toBe(encoder);
    expect(rhi.toNative(host)).toBe(encoder);
    host.beginComputePass();
  });

  it('takes a host object only as the kind it is', () => {
    const { native, pass } = recording();
    const rhi = webgpuDevice(native);
    const gpuBuffer = { size: 4, mapAsync() {}, getMappedRange() {} };
    const gpuTexture = { width: 1, height: 1, format: 'r8unorm', createView() {} };
    const context = { getCurrentTexture: () => gpuTexture };
    expect(rhi.fromNative('buffer', gpuBuffer)).toBe(gpuBuffer);
    expect(rhi.fromNative('buffer', { size: 4 })).toBeUndefined();
    expect(rhi.fromNative('texture', gpuTexture)).toBe(gpuTexture);
    expect(rhi.fromNative('texture', context)).toBeUndefined();
    const canvas = rhi.fromNative('canvas', context)!;
    expect(canvas).toBe(context);
    expect(rhi.currentTexture(canvas)).toBe(gpuTexture);
    expect(rhi.fromNative('canvas', gpuTexture)).toBeUndefined();
    expect(rhi.fromNative('compute-pass', pass)).toBe(pass);
    expect(rhi.fromNative('compute-pass', {})).toBeUndefined();
    expect(rhi.fromNative('render-pass', pass)).toBe(pass);
    expect(rhi.fromNative('render-pass', { setPipeline: 1, draw: 2 })).toBeUndefined();
    expect(rhi.fromNative('encoder', {})).toBeUndefined();
    const anything = {};
    expect(rhi.fromNative('view', anything)).toBe(anything);
    expect(rhi.fromNative('sampler', anything)).toBe(anything);
  });

  it('reports a validation error by its message', async () => {
    const clean = recording();
    const rhi = webgpuDevice(clean.native);
    rhi.pushValidationScope();
    expect(clean.args('pushErrorScope')).toEqual([['validation']]);
    expect(await rhi.popValidationScope()).toBeNull();
    const failing = webgpuDevice(recording({ error: 'binding 0 is too small' }).native);
    failing.pushValidationScope();
    expect(await failing.popValidationScope()).toBe('binding 0 is too small');
  });

  it('destroys the native device, and a device with no destroy is left as it is', () => {
    const { native, args } = recording();
    webgpuDevice(native).destroy();
    expect(args('destroy')).toHaveLength(1);
    const bare = recording().native as { destroy?: unknown };
    delete bare.destroy;
    expect(() => webgpuDevice(bare).destroy()).not.toThrow();
  });
});
