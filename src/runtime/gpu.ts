// The slice of WebGPU the program runtime calls, spelled here so the package needs no
// `@webgpu/types` (tsconfig.json's `types: []`, which keeps the published declarations free of
// any ambient dependency). A real `GPUDevice` is cast to `Device` once, where the runtime takes
// it; the public API names a device and an encoder as `object`.

export interface Buffer {
  readonly size: number;
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

export interface TextureView {
  readonly __brand?: 'GPUTextureView';
}

export interface Texture {
  readonly width: number;
  readonly height: number;
  readonly format: string;
  readonly sampleCount?: number;
  createView(d?: object): TextureView;
  destroy(): void;
}

export interface Sampler {
  readonly __brand?: 'GPUSampler';
}

export interface BindGroupLayout {
  readonly __brand?: 'GPUBindGroupLayout';
}

export interface ShaderModule {
  getCompilationInfo?(): Promise<{
    readonly messages: readonly { readonly type: string; readonly message: string }[];
  }>;
}

export interface ComputePassEncoder {
  setPipeline(p: object): void;
  setBindGroup(i: number, g: object): void;
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
  end(): void;
}

export interface RenderPassEncoder {
  setPipeline(p: object): void;
  setBindGroup(i: number, g: object): void;
  setVertexBuffer(slot: number, b: Buffer, offset?: number, size?: number): void;
  setIndexBuffer(b: Buffer, format: string, offset?: number, size?: number): void;
  draw(
    vertexCount: number,
    instanceCount?: number,
    firstVertex?: number,
    firstInstance?: number,
  ): void;
  drawIndexed(indexCount: number, instanceCount?: number): void;
  end(): void;
}

export interface CommandEncoder {
  beginComputePass(d?: object): ComputePassEncoder;
  beginRenderPass(d: object): RenderPassEncoder;
  copyBufferToBuffer(s: Buffer, so: number, d: Buffer, dO: number, n: number): void;
  copyTextureToBuffer(s: object, d: object, size: readonly number[]): void;
  finish(): object;
}

export interface Queue {
  submit(buffers: readonly object[]): void;
  writeBuffer(b: Buffer, offset: number, data: ArrayBuffer | ArrayBufferView): void;
  onSubmittedWorkDone(): Promise<void>;
}

export interface Device {
  readonly queue: Queue;
  readonly features: { has(name: string): boolean };
  readonly lost?: Promise<unknown>;
  createBuffer(d: { size: number; usage: number; mappedAtCreation?: boolean }): Buffer;
  createTexture(d: object): Texture;
  createSampler(d?: object): Sampler;
  createShaderModule(d: { code: string }): ShaderModule;
  createBindGroupLayout(d: { entries: readonly object[] }): BindGroupLayout;
  createPipelineLayout(d: { bindGroupLayouts: readonly BindGroupLayout[] }): object;
  createBindGroup(d: { layout: BindGroupLayout; entries: readonly object[] }): object;
  createComputePipelineAsync(d: object): Promise<object>;
  createRenderPipelineAsync(d: object): Promise<object>;
  createCommandEncoder(): CommandEncoder;
  pushErrorScope(filter: 'validation' | 'out-of-memory' | 'internal'): void;
  popErrorScope(): Promise<{ message: string } | null>;
}

export interface Adapter {
  readonly features: { has(name: string): boolean };
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

/** `GPUShaderStage`. */
export const STAGE = { vertex: 0x1, fragment: 0x2, compute: 0x4 } as const;

/** `GPUMapMode.READ`. */
export const MAP_READ = 0x0001;

/** `navigator.gpu`, where there is one. */
export function gpuOf(): { requestAdapter(o?: object): Promise<Adapter | null> } | undefined {
  return (
    globalThis as { navigator?: { gpu?: { requestAdapter(o?: object): Promise<Adapter | null> } } }
  ).navigator?.gpu;
}
