// The WebGPU backend of the render hardware interface (change 0120, M1): `RhiDevice` over a
// `GPUDevice`. Each handle but the command encoder is the native object itself, so an escape
// hatch (Rule 11.17) gives the host the object the runtime binds, and a host's own object is a
// handle with no copy. The slice of WebGPU it calls is spelled here, so the package needs no
// `@webgpu/types` (tsconfig.json's `types: []`, which keeps the published declarations free of
// any ambient dependency).

import { copyLimits } from '../core/device-limits.js';
import type {
  RhiBindEntry,
  RhiBindGroup,
  RhiBindGroupLayout,
  RhiBindLayoutEntry,
  RhiBuffer,
  RhiBufferDesc,
  RhiBufferUsage,
  RhiCanvas,
  RhiCaps,
  RhiCommandEncoder,
  RhiComputePass,
  RhiComputePipeline,
  RhiComputePipelineDesc,
  RhiDepthStencilState,
  RhiDevice,
  RhiNativeKinds,
  RhiRenderPass,
  RhiRenderPassDesc,
  RhiRenderPipeline,
  RhiRenderPipelineDesc,
  RhiSampler,
  RhiSamplerDesc,
  RhiShaderModule,
  RhiTexture,
  RhiTextureDesc,
  RhiTextureUsage,
  RhiTextureView,
} from './rhi.js';

export interface Buffer {
  readonly size: number;
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

export interface Texture {
  readonly width: number;
  readonly height: number;
  readonly format: string;
  createView(d?: object): object;
  destroy(): void;
}

export interface ComputePassEncoder {
  setPipeline(p: object): void;
  setBindGroup(i: number, g: object): void;
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
  end(): void;
}

export interface CommandEncoder {
  beginComputePass(d?: object): ComputePassEncoder;
  beginRenderPass(d: object): object;
  copyBufferToBuffer(s: Buffer, so: number, d: Buffer, dO: number, n: number): void;
  copyTextureToBuffer(s: object, d: object, size: readonly number[]): void;
  finish(): object;
}

export interface Queue {
  submit(buffers: readonly object[]): void;
  writeBuffer(b: Buffer, offset: number, data: ArrayBuffer | ArrayBufferView): void;
  writeTexture(d: object, data: ArrayBufferView, l: object, s: readonly number[]): void;
  onSubmittedWorkDone(): Promise<void>;
}

export interface Device {
  readonly queue: Queue;
  readonly features: { has(name: string): boolean };
  /** The device's limits, by WebGPU's names; its attributes are accessors (change 0051). */
  readonly limits?: object;
  createBuffer(d: { size: number; usage: number; mappedAtCreation?: boolean }): Buffer;
  createTexture(d: object): Texture;
  createSampler(d?: object): object;
  createShaderModule(d: { code: string }): object;
  createBindGroupLayout(d: { entries: readonly object[] }): object;
  createPipelineLayout(d: { bindGroupLayouts: readonly object[] }): object;
  createBindGroup(d: { layout: object; entries: readonly object[] }): object;
  createComputePipelineAsync(d: object): Promise<object>;
  createRenderPipelineAsync(d: object): Promise<object>;
  createCommandEncoder(): CommandEncoder;
  pushErrorScope(filter: 'validation' | 'out-of-memory' | 'internal'): void;
  popErrorScope(): Promise<{ message: string } | null>;
  destroy?(): void;
}

export interface Adapter {
  readonly features: { has(name: string): boolean };
  /** The adapter's limits, by WebGPU's names: accessors on the prototype (change 0051). */
  readonly limits?: object;
  requestDevice(d?: object): Promise<Device>;
}

/** `GPUBufferUsage`. */
export const BUFFER = {
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
} as const;

/** `GPUTextureUsage`. */
export const TEXTURE = {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
} as const;

/** `GPUMapMode.READ`. */
export const MAP_READ = 0x0001;

/** The `GPUBufferUsage` flag of each of the RHI's buffer usage names. */
const BUFFER_USAGE: Readonly<Record<RhiBufferUsage, number>> = {
  'map-read': BUFFER.MAP_READ,
  'copy-src': BUFFER.COPY_SRC,
  'copy-dst': BUFFER.COPY_DST,
  index: BUFFER.INDEX,
  vertex: BUFFER.VERTEX,
  uniform: BUFFER.UNIFORM,
  storage: BUFFER.STORAGE,
};

/** The `GPUTextureUsage` flag of each of the RHI's texture usage names. */
const TEXTURE_USAGE: Readonly<Record<RhiTextureUsage, number>> = {
  'copy-src': TEXTURE.COPY_SRC,
  'copy-dst': TEXTURE.COPY_DST,
  sampled: TEXTURE.TEXTURE_BINDING,
  storage: TEXTURE.STORAGE_BINDING,
  render: TEXTURE.RENDER_ATTACHMENT,
};

const flags = <K extends string>(table: Readonly<Record<K, number>>, names: readonly K[]): number =>
  names.reduce((bits, n) => bits | table[n], 0);

/** `navigator.gpu`, where there is one. */
export function gpuOf(): { requestAdapter(o?: object): Promise<Adapter | null> } | undefined {
  return (
    globalThis as { navigator?: { gpu?: { requestAdapter(o?: object): Promise<Adapter | null> } } }
  ).navigator?.gpu;
}

/** The handle of a native object: the WebGPU backend's handles are the native objects. */
const handle = <H>(native: object): H => native as unknown as H;
/** The native object of a handle. */
const native = <N>(h: object): N => h as unknown as N;

/** The one handle that wraps its native object: the encoder, whose commands the device finishes
 *  at the submit. */
class WebGpuEncoder implements RhiCommandEncoder {
  constructor(readonly native: CommandEncoder) {}

  beginRenderPass(desc: RhiRenderPassDesc): RhiRenderPass {
    const d = desc.depthStencilAttachment;
    return handle(
      this.native.beginRenderPass({
        colorAttachments: desc.colorAttachments.map((c) => ({
          view: native(c.view),
          loadOp: c.loadOp,
          storeOp: c.storeOp,
          clearValue: c.clearValue,
        })),
        ...(d !== undefined ? { depthStencilAttachment: { ...d, view: native(d.view) } } : {}),
      }),
    );
  }

  beginComputePass(): RhiComputePass {
    return handle(this.native.beginComputePass());
  }

  copyBufferToBuffer(
    src: RhiBuffer,
    srcOffset: number,
    dst: RhiBuffer,
    dstOffset: number,
    size: number,
  ): void {
    this.native.copyBufferToBuffer(native(src), srcOffset, native(dst), dstOffset, size);
  }
}

/** The WebGPU `depthStencil` of a pipeline. A bias key appears only when its value is not 0, and
 *  the four stencil fields whenever the state has a stencil test (proposal 0064). */
function depthStencilOf(d: RhiDepthStencilState): object {
  const b = d.bias;
  const s = d.stencil;
  return {
    format: d.format,
    depthCompare: d.compare,
    depthWriteEnabled: d.write,
    ...(b.constant !== 0 ? { depthBias: b.constant } : {}),
    ...(b.slopeScale !== 0 ? { depthBiasSlopeScale: b.slopeScale } : {}),
    ...(b.clamp !== 0 ? { depthBiasClamp: b.clamp } : {}),
    ...(s !== undefined
      ? {
          stencilFront: { ...s.front },
          stencilBack: { ...s.back },
          stencilReadMask: s.readMask,
          stencilWriteMask: s.writeMask,
        }
      : {}),
  };
}

/** The WebGPU `multisample` entries of a pipeline: none for the default count 1 and mask, and
 *  each field only when it differs from its default (proposal 0064). */
const multisampleOf = (m: RhiRenderPipelineDesc['multisample']): object =>
  m.count === 1 && m.mask === 0xffffffff
    ? {}
    : {
        multisample: {
          ...(m.count !== 1 ? { count: m.count } : {}),
          ...(m.mask !== 0xffffffff ? { mask: m.mask } : {}),
        },
      };

/** Whether `o` has a function named `name`. */
const has = (o: object, name: string): boolean =>
  typeof (o as Record<string, unknown>)[name] === 'function';

/** What makes a native object each kind `fromNative` takes. */
const IS: { readonly [K in keyof RhiNativeKinds]: (o: object) => boolean } = {
  buffer: (o) => 'mapAsync' in o && 'getMappedRange' in o,
  texture: (o) => 'createView' in o,
  view: () => true,
  sampler: () => true,
  canvas: (o) => 'getCurrentTexture' in o,
  encoder: (o) => o instanceof WebGpuEncoder || has(o, 'finish'),
  'compute-pass': (o) => 'dispatchWorkgroups' in o,
  'render-pass': (o) => has(o, 'setPipeline') && has(o, 'draw'),
};

class WebGpuDevice implements RhiDevice {
  readonly backend = 'webgpu';
  readonly caps: RhiCaps;

  constructor(readonly native: Device) {
    const gpu = native;
    this.caps = {
      compute: 'native',
      shaderLanguage: 'wgsl',
      immediate: false,
      get limits() {
        return copyLimits(gpu.limits);
      },
      hasFeature: (name) => gpu.features.has(name),
    };
  }

  createBuffer(desc: RhiBufferDesc): RhiBuffer {
    return handle(
      this.native.createBuffer({ size: desc.size, usage: flags(BUFFER_USAGE, desc.usage) }),
    );
  }

  writeBuffer(buffer: RhiBuffer, byteOffset: number, data: ArrayBuffer | ArrayBufferView): void {
    this.native.queue.writeBuffer(native(buffer), byteOffset, data);
  }

  async readBuffer(buffer: RhiBuffer): Promise<ArrayBuffer> {
    const b = native<Buffer>(buffer);
    await b.mapAsync(MAP_READ);
    const bytes = b.getMappedRange().slice(0);
    b.unmap();
    return bytes;
  }

  destroyBuffer(buffer: RhiBuffer): void {
    native<Buffer>(buffer).destroy();
  }

  createTexture(desc: RhiTextureDesc): RhiTexture {
    return handle(
      this.native.createTexture({
        size: desc.size,
        format: desc.format,
        ...(desc.dimension !== undefined ? { dimension: desc.dimension } : {}),
        ...(desc.sampleCount !== undefined ? { sampleCount: desc.sampleCount } : {}),
        usage: flags(TEXTURE_USAGE, desc.usage),
      }),
    );
  }

  writeTexture(
    texture: RhiTexture,
    data: ArrayBufferView,
    bytesPerRow: number,
    width: number,
    height: number,
  ): void {
    this.native.queue.writeTexture({ texture: native(texture) }, data, { bytesPerRow }, [
      width,
      height,
      1,
    ]);
  }

  async readTexture(texture: RhiTexture, bytesPerTexel: number): Promise<Uint8Array> {
    const { width, height, format } = texture;
    const row = width * bytesPerTexel;
    // WebGPU copies rows to a multiple of 256 bytes.
    const stride = Math.ceil(row / 256) * 256;
    const staging = this.native.createBuffer({
      size: stride * height,
      usage: BUFFER_USAGE['map-read'] | BUFFER_USAGE['copy-dst'],
    });
    const encoder = this.native.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: native(texture), ...(format === 'depth32float' ? { aspect: 'depth-only' } : {}) },
      { buffer: staging, bytesPerRow: stride },
      [width, height, 1],
    );
    this.native.queue.submit([encoder.finish()]);
    await staging.mapAsync(MAP_READ);
    const mapped = new Uint8Array(staging.getMappedRange());
    const out = new Uint8Array(row * height);
    for (let y = 0; y < height; y++)
      out.set(mapped.subarray(y * stride, y * stride + row), y * row);
    staging.unmap();
    staging.destroy();
    return out;
  }

  destroyTexture(texture: RhiTexture): void {
    native<Texture>(texture).destroy();
  }

  createView(texture: RhiTexture): RhiTextureView {
    return handle(native<Texture>(texture).createView());
  }

  currentTexture(canvas: RhiCanvas): RhiTexture {
    return handle(native<{ getCurrentTexture(): object }>(canvas).getCurrentTexture());
  }

  createSampler(desc: RhiSamplerDesc): RhiSampler {
    return handle(this.native.createSampler({ ...desc }));
  }

  createShaderModule(code: string | object): RhiShaderModule {
    if (typeof code !== 'string')
      throw new TypeError("The WebGPU backend runs WGSL text; it got a module's CPU program.");
    return handle(this.native.createShaderModule({ code }));
  }

  createBindGroupLayout(entries: readonly RhiBindLayoutEntry[]): RhiBindGroupLayout {
    // The names a backend that binds by name reads are no WebGPU members.
    return handle(
      this.native.createBindGroupLayout({
        entries: entries.map(({ name: _n, label: _l, samplerBinding: _s, ...entry }) => entry),
      }),
    );
  }

  createBindGroup(layout: RhiBindGroupLayout, entries: readonly RhiBindEntry[]): RhiBindGroup {
    return handle(
      this.native.createBindGroup({
        layout: native(layout),
        entries: entries.map(({ binding, resource: r }) => ({
          binding,
          resource:
            'buffer' in r
              ? { buffer: native(r.buffer), ...(r.size !== undefined ? { size: r.size } : {}) }
              : 'view' in r
                ? native(r.view)
                : 'sampler' in r
                  ? native(r.sampler)
                  : r.native,
        })),
      }),
    );
  }

  #layout(layouts: readonly RhiBindGroupLayout[]): object {
    return this.native.createPipelineLayout({ bindGroupLayouts: layouts.map((l) => native(l)) });
  }

  async createComputePipeline(desc: RhiComputePipelineDesc): Promise<RhiComputePipeline> {
    return handle(
      await this.native.createComputePipelineAsync({
        layout: this.#layout(desc.layouts),
        compute: {
          module: native(desc.module),
          entryPoint: desc.entryPoint,
          ...(desc.constants !== undefined ? { constants: desc.constants } : {}),
        },
      }),
    );
  }

  async createRenderPipeline(desc: RhiRenderPipelineDesc): Promise<RhiRenderPipeline> {
    const module = native(desc.module);
    // Every stage is made with the same values: WebGPU takes a name any stage's module declares,
    // whether or not that stage's entry reads it.
    const stage = desc.constants === undefined ? {} : { constants: desc.constants };
    const { vertex, fragment, primitive, depthStencil } = desc;
    return handle(
      await this.native.createRenderPipelineAsync({
        layout: this.#layout(desc.layouts),
        vertex: { module, entryPoint: vertex.entryPoint, buffers: vertex.buffers, ...stage },
        ...(fragment !== undefined
          ? {
              fragment: {
                module: fragment.module === undefined ? module : native(fragment.module),
                entryPoint: fragment.entryPoint,
                targets: fragment.targets,
                ...stage,
              },
            }
          : {}),
        primitive: {
          topology: primitive.topology,
          cullMode: primitive.cullMode,
          frontFace: primitive.frontFace,
        },
        ...(depthStencil !== undefined ? { depthStencil: depthStencilOf(depthStencil) } : {}),
        ...multisampleOf(desc.multisample),
      }),
    );
  }

  createCommandEncoder(): RhiCommandEncoder {
    return new WebGpuEncoder(this.native.createCommandEncoder());
  }

  submit(encoders: readonly RhiCommandEncoder[]): Promise<void> {
    this.native.queue.submit(encoders.map((e) => (e as WebGpuEncoder).native.finish()));
    return this.native.queue.onSubmittedWorkDone();
  }

  pushValidationScope(): void {
    this.native.pushErrorScope('validation');
  }

  async popValidationScope(): Promise<string | null> {
    const e = await this.native.popErrorScope();
    return e === null ? null : e.message;
  }

  fromNative<K extends keyof RhiNativeKinds>(
    kind: K,
    object: object,
  ): RhiNativeKinds[K] | undefined {
    if (!IS[kind](object)) return undefined;
    if (kind === 'encoder' && !(object instanceof WebGpuEncoder))
      return new WebGpuEncoder(object as CommandEncoder) as unknown as RhiNativeKinds[K];
    return handle(object);
  }

  toNative(h: object): object {
    return h instanceof WebGpuEncoder ? h.native : h;
  }

  destroy(): void {
    this.native.destroy?.();
  }
}

/** The RHI device over a `GPUDevice`. It holds nothing but the device, so two of one device are
 *  interchangeable: their handles are the same native objects. */
export function webgpuDevice(device: object): RhiDevice {
  return new WebGpuDevice(device as Device);
}
