// Why: the names follow X-GIS's `RhiDevice` (`@xgis/rhi`) so that X-GIS can later move to this interface.
// The names follow X-GIS's `RhiDevice` (`@xgis/rhi`) where the meaning is the same, so that
// X-GIS can later move to this interface. The interface is internal (change 0120, O1 (a)): no
// `package.json` subpath exports it. It has what the program runtime needs and nothing more;
// it grows as a later consumer needs.
//
// Handles are opaque. A backend makes them, and only that backend reads them. The descriptors
// use WebGPU's vocabulary (`'uint32'`, `'clear'`, `'less-equal'`), as X-GIS's do; a backend that
// is not WebGPU maps each name.
//
// WebGL2 differs from WebGPU in three ways the interface names. Its programs bind by name, so a
// bind group layout entry can carry the name a program declares (`name`) and the sampler GLSL ES
// 3.00 fuses with a texture (`samplerBinding`). It links a program from one module for each stage, so a
// render pipeline's fragment can name its own module. It has no command buffer, so its encoder
// runs each command when it is recorded (`caps.immediate`); the runtime records a pass and submits
// it in one go, so the order of the commands is the same on every backend.

import type { CpuProgram } from './cpu-program.js';

export interface RhiBuffer {
  readonly __rhi: 'buffer';
  readonly size: number;
}

export interface RhiTexture {
  readonly __rhi: 'texture';
  readonly width: number;
  readonly height: number;
  readonly format: string;
}

export interface RhiTextureView {
  readonly __rhi: 'view';
}

export interface RhiSampler {
  readonly __rhi: 'sampler';
}

export interface RhiShaderModule {
  readonly __rhi: 'module';
}

export interface RhiBindGroupLayout {
  readonly __rhi: 'bindlayout';
}

export interface RhiBindGroup {
  readonly __rhi: 'bindgroup';
}

export interface RhiRenderPipeline {
  readonly __rhi: 'pipeline';
}

export interface RhiComputePipeline {
  readonly __rhi: 'computepipeline';
}

export interface RhiCanvas {
  readonly __rhi: 'canvas';
}

// Why: WebGPU forces a `'map-read'` buffer to take only `'copy-dst'` beside it; no backend checks it.
export type RhiBufferUsage =
  'map-read' | 'copy-src' | 'copy-dst' | 'index' | 'vertex' | 'uniform' | 'storage' | 'indirect';

export interface RhiBufferDesc {
  readonly size: number;
  readonly usage: readonly RhiBufferUsage[];
  readonly elem?: 'f32' | 'i32' | 'u32';
}

export type RhiTextureUsage = 'copy-src' | 'copy-dst' | 'sampled' | 'storage' | 'render';

export interface RhiTextureDesc {
  readonly size: readonly [number, number, number];
  readonly format: string;
  readonly dimension?: '2d' | '3d';
  readonly sampleCount?: number;
  readonly usage: readonly RhiTextureUsage[];
}

export type RhiFilter = 'nearest' | 'linear';
export type RhiAddressMode = 'clamp-to-edge' | 'repeat' | 'mirror-repeat';

export type RhiCompareFunction =
  'never' | 'less' | 'equal' | 'less-equal' | 'greater' | 'not-equal' | 'greater-equal' | 'always';

export type RhiStencilOperation =
  | 'keep'
  | 'zero'
  | 'replace'
  | 'invert'
  | 'increment-clamp'
  | 'decrement-clamp'
  | 'increment-wrap'
  | 'decrement-wrap';

export interface RhiSamplerDesc {
  readonly magFilter: RhiFilter;
  readonly minFilter: RhiFilter;
  readonly mipmapFilter: RhiFilter;
  readonly addressModeU: RhiAddressMode;
  readonly addressModeV: RhiAddressMode;
  readonly addressModeW: RhiAddressMode;
  readonly compare?: RhiCompareFunction;
}

export const STAGE = { vertex: 0x1, fragment: 0x2, compute: 0x4 } as const;

export type RhiBindLayoutEntry = {
  readonly binding: number;
  readonly visibility: number;
  readonly name?: string;
  readonly label?: string;
  readonly samplerBinding?: number;
} & (
  | { readonly buffer: { readonly type: 'uniform' | 'storage' | 'read-only-storage' } }
  | { readonly sampler: { readonly type: 'filtering' | 'comparison' } }
  | {
      readonly texture: {
        readonly sampleType: string;
        readonly viewDimension: string;
        readonly multisampled: boolean;
      };
    }
  | {
      readonly storageTexture: {
        readonly access: string;
        readonly format: string | undefined;
        readonly viewDimension: string;
      };
    }
);

export type RhiBindResource =
  | { readonly buffer: RhiBuffer; readonly size?: number }
  | { readonly view: RhiTextureView }
  | { readonly sampler: RhiSampler }
  | { readonly native: object };

export interface RhiBindEntry {
  readonly binding: number;
  readonly resource: RhiBindResource;
}

export interface RhiVertexBufferLayout {
  readonly arrayStride: number;
  readonly attributes: readonly {
    readonly shaderLocation: number;
    readonly offset: number;
    readonly format: string;
  }[];
}

export interface RhiColorTarget {
  readonly format: string;
  readonly blend?: object;
  readonly writeMask?: number;
}

export interface RhiStencilFace {
  readonly compare: RhiCompareFunction;
  readonly failOp: RhiStencilOperation;
  readonly depthFailOp: RhiStencilOperation;
  readonly passOp: RhiStencilOperation;
}

export interface RhiDepthStencilState {
  readonly format: string;
  readonly compare: RhiCompareFunction;
  readonly write: boolean;
  readonly bias: {
    readonly constant: number;
    readonly slopeScale: number;
    readonly clamp: number;
  };
  readonly stencil?: {
    readonly front: RhiStencilFace;
    readonly back: RhiStencilFace;
    readonly readMask: number;
    readonly writeMask: number;
  };
}

export interface RhiComputePipelineDesc {
  readonly layouts: readonly RhiBindGroupLayout[];
  readonly module: RhiShaderModule;
  readonly entryPoint: string;
  readonly constants?: Readonly<Record<string, number>>;
}

export interface RhiRenderPipelineDesc {
  readonly label?: string;
  readonly layouts: readonly RhiBindGroupLayout[];
  readonly module: RhiShaderModule;
  readonly vertex: {
    readonly entryPoint: string;
    readonly buffers: readonly RhiVertexBufferLayout[];
  };
  readonly fragment?: {
    readonly entryPoint: string;
    readonly targets: readonly RhiColorTarget[];
    readonly module?: RhiShaderModule;
  };
  readonly constants?: Readonly<Record<string, number>>;
  readonly primitive: {
    readonly topology: string;
    readonly cullMode: 'none' | 'front' | 'back';
    readonly frontFace: 'ccw' | 'cw';
  };
  readonly depthStencil?: RhiDepthStencilState;
  readonly multisample: { readonly count: number; readonly mask: number };
}

export interface RhiColorAttachment {
  readonly view: RhiTextureView;
  readonly loadOp: 'clear' | 'load';
  readonly storeOp: 'store' | 'discard';
  readonly clearValue: readonly number[];
}

export interface RhiDepthStencilAttachment {
  readonly view: RhiTextureView;
  readonly depthReadOnly?: boolean;
  readonly depthLoadOp?: 'clear' | 'load';
  readonly depthStoreOp?: 'store' | 'discard';
  readonly depthClearValue?: number;
  readonly stencilReadOnly?: boolean;
  readonly stencilLoadOp?: 'clear' | 'load';
  readonly stencilStoreOp?: 'store' | 'discard';
  readonly stencilClearValue?: number;
}

export interface RhiRenderPassDesc {
  readonly colorAttachments: readonly RhiColorAttachment[];
  readonly depthStencilAttachment?: RhiDepthStencilAttachment;
}

export interface RhiRenderPass {
  setPipeline(pipeline: RhiRenderPipeline): void;
  setBindGroup(index: number, group: RhiBindGroup): void;
  setVertexBuffer(slot: number, buffer: RhiBuffer): void;
  setIndexBuffer(buffer: RhiBuffer, format: 'uint16' | 'uint32'): void;
  draw(vertexCount: number, instanceCount?: number): void;
  drawIndexed(indexCount: number, instanceCount?: number): void;
  setViewport(
    x: number,
    y: number,
    width: number,
    height: number,
    minDepth: number,
    maxDepth: number,
  ): void;
  setScissorRect(x: number, y: number, width: number, height: number): void;
  setBlendConstant(color: readonly [number, number, number, number]): void;
  setStencilReference(reference: number): void;
  end(): void;
}

export interface RhiComputePass {
  setPipeline(pipeline: RhiComputePipeline): void;
  setBindGroup(index: number, group: RhiBindGroup): void;
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
  dispatchWorkgroupsIndirect(buffer: RhiBuffer, byteOffset: number): void;
  end(): void;
}

export interface RhiCommandEncoder {
  beginRenderPass(desc: RhiRenderPassDesc): RhiRenderPass;
  beginComputePass(): RhiComputePass;
  copyBufferToBuffer(
    src: RhiBuffer,
    srcOffset: number,
    dst: RhiBuffer,
    dstOffset: number,
    size: number,
  ): void;
}

export interface RhiCaps {
  readonly compute: 'native' | 'fragment-emulated';
  readonly shaderLanguage: 'wgsl' | 'glsl-es300' | 'cpu';
  readonly immediate: boolean;
  // Why: WebGL2 has no `GPUSupportedLimits`; `maxViewportDimension` is the smaller of `MAX_VIEWPORT_DIMS`, read once.
  readonly limits: Readonly<Record<string, number>>;
  hasFeature(name: string): boolean;
}

export interface RhiNativeKinds {
  readonly buffer: RhiBuffer;
  readonly texture: RhiTexture;
  readonly view: RhiTextureView;
  readonly sampler: RhiSampler;
  readonly canvas: RhiCanvas;
  readonly encoder: RhiCommandEncoder;
  readonly 'compute-pass': RhiComputePass;
  readonly 'render-pass': RhiRenderPass;
}

export interface RhiDevice {
  // Why: this list is not `TIERS` (`../core/tiers.ts`) on purpose; a tier that is a code form of the software backend adds no backend (change 0042).
  readonly backend: 'webgpu' | 'webgl2' | 'cpu';
  readonly caps: RhiCaps;
  readonly native: object | null;

  createBuffer(desc: RhiBufferDesc): RhiBuffer;
  writeBuffer(buffer: RhiBuffer, byteOffset: number, data: ArrayBuffer | ArrayBufferView): void;
  readBuffer(buffer: RhiBuffer): Promise<ArrayBuffer>;
  destroyBuffer(buffer: RhiBuffer): void;

  createTexture(desc: RhiTextureDesc): RhiTexture;
  writeTexture(
    texture: RhiTexture,
    data: ArrayBufferView,
    bytesPerRow: number,
    width: number,
    height: number,
  ): void;
  readTexture(texture: RhiTexture, bytesPerTexel: number): Promise<Uint8Array>;
  destroyTexture(texture: RhiTexture): void;
  createView(texture: RhiTexture): RhiTextureView;
  currentTexture(canvas: RhiCanvas): RhiTexture;

  createSampler(desc: RhiSamplerDesc): RhiSampler;
  createShaderModule(code: string | CpuProgram): RhiShaderModule;
  createBindGroupLayout(entries: readonly RhiBindLayoutEntry[]): RhiBindGroupLayout;
  createBindGroup(layout: RhiBindGroupLayout, entries: readonly RhiBindEntry[]): RhiBindGroup;
  createComputePipeline(desc: RhiComputePipelineDesc): Promise<RhiComputePipeline>;
  createRenderPipeline(desc: RhiRenderPipelineDesc): Promise<RhiRenderPipeline>;

  createCommandEncoder(): RhiCommandEncoder;
  submit(encoders: readonly RhiCommandEncoder[]): Promise<void>;
  pushValidationScope(): void;
  popValidationScope(): Promise<string | null>;

  fromNative<K extends keyof RhiNativeKinds>(
    kind: K,
    native: object,
  ): RhiNativeKinds[K] | undefined;
  toNative(handle: object): object;
  destroy(): void;
}
