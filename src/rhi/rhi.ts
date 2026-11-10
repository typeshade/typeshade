// The render hardware interface (change 0120, D1): the GPU surface the program runtime records
// through, backend-agnostic. A backend implements `RhiDevice` over one native device: WebGPU
// (`webgpu.ts`, milestone M1), WebGL2 (`webgl2.ts`, M2), and a CPU device (`cpu.ts`, M3). The runtime calls
// no native function itself; it asks the device for each object and each command.
//
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

/** A buffer. `size` is its size in bytes. */
export interface RhiBuffer {
  readonly __rhi: 'buffer';
  readonly size: number;
}

/** A texture: its size and its format, as the device made it. */
export interface RhiTexture {
  readonly __rhi: 'texture';
  readonly width: number;
  readonly height: number;
  /** A WebGPU texture format name: `'rgba8unorm'`, `'depth24plus'`. */
  readonly format: string;
}

export interface RhiTextureView {
  readonly __rhi: 'view';
}

export interface RhiSampler {
  readonly __rhi: 'sampler';
}

/** The program of a manifest, made once and used by each of its pipelines. */
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

/** A canvas context of the host, which a render pass can draw into. */
export interface RhiCanvas {
  readonly __rhi: 'canvas';
}

/** What a buffer is used for. `'map-read'` makes a buffer that `readBuffer` reads; such a buffer
 *  takes only `'copy-dst'` beside it. */
export type RhiBufferUsage =
  'map-read' | 'copy-src' | 'copy-dst' | 'index' | 'vertex' | 'uniform' | 'storage' | 'indirect';

export interface RhiBufferDesc {
  readonly size: number;
  readonly usage: readonly RhiBufferUsage[];
  /** The element type of a `'storage'` buffer: `'f32'` when omitted. WebGL2 has no storage buffer;
   *  it gives a program the buffer as a data texture of 32-bit words of this type (change 0046),
   *  as X-GIS's `elem` does. WebGPU does not read it. */
  readonly elem?: 'f32' | 'i32' | 'u32';
}

/** What a texture is used for: `'sampled'` binds it as a texture, `'storage'` as a storage
 *  texture, and `'render'` attaches it to a render pass. */
export type RhiTextureUsage = 'copy-src' | 'copy-dst' | 'sampled' | 'storage' | 'render';

export interface RhiTextureDesc {
  /** `[width, height, depth or layers]`. */
  readonly size: readonly [number, number, number];
  readonly format: string;
  /** `'2d'` when omitted. */
  readonly dimension?: '2d' | '3d';
  /** 1 when omitted. */
  readonly sampleCount?: number;
  readonly usage: readonly RhiTextureUsage[];
}

export type RhiFilter = 'nearest' | 'linear';
export type RhiAddressMode = 'clamp-to-edge' | 'repeat' | 'mirror-repeat';

/** A WebGPU `GPUCompareFunction` name. */
export type RhiCompareFunction =
  'never' | 'less' | 'equal' | 'less-equal' | 'greater' | 'not-equal' | 'greater-equal' | 'always';

/** A WebGPU `GPUStencilOperation` name. */
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
  /** A comparison sampler's comparison. */
  readonly compare?: RhiCompareFunction;
}

/** The bits of a binding's visibility, one for each stage that reaches it. */
export const STAGE = { vertex: 0x1, fragment: 0x2, compute: 0x4 } as const;

/** One binding of a bind group layout: its number, the stages that reach it (`STAGE` bits) and
 *  the kind of resource it binds. A backend whose programs bind by name (WebGL2) reads `name`: a
 *  uniform buffer's block name, or the name of the sampler uniform of a texture or a storage
 *  buffer's data texture. `label` names the binding in an error. `samplerBinding` is the binding
 *  of the sampler a WebGL2 program reads a texture with: GLSL ES 3.00 fuses the two, and a texture with
 *  none is read nearest and clamped. WebGPU reads none of the three. */
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

/** What one binding of a bind group holds. `native` is a host's own object of the backend
 *  (Rule 11.17), bound as it is: a view, a sampler or an external texture the runtime does not
 *  make. */
export type RhiBindResource =
  | { readonly buffer: RhiBuffer; readonly size?: number }
  | { readonly view: RhiTextureView }
  | { readonly sampler: RhiSampler }
  | { readonly native: object };

export interface RhiBindEntry {
  readonly binding: number;
  readonly resource: RhiBindResource;
}

/** One vertex buffer a render pipeline reads: its stride and its attributes. `format` is a WebGPU
 *  `GPUVertexFormat` name. */
export interface RhiVertexBufferLayout {
  readonly arrayStride: number;
  readonly attributes: readonly {
    readonly shaderLocation: number;
    readonly offset: number;
    readonly format: string;
  }[];
}

/** A colour target of a render pipeline. `blend` and `writeMask` are WebGPU's `GPUBlendState`
 *  and `GPUColorWrite` flags, as the host gives them (`TargetState`). */
export interface RhiColorTarget {
  readonly format: string;
  readonly blend?: object;
  readonly writeMask?: number;
}

/** One face of a stencil test. */
export interface RhiStencilFace {
  readonly compare: RhiCompareFunction;
  readonly failOp: RhiStencilOperation;
  readonly depthFailOp: RhiStencilOperation;
  readonly passOp: RhiStencilOperation;
}

/** The depth and stencil state of a render pipeline, every field filled. A bias field of 0 is no
 *  bias. */
export interface RhiDepthStencilState {
  readonly format: string;
  readonly compare: RhiCompareFunction;
  readonly write: boolean;
  readonly bias: {
    readonly constant: number;
    readonly slopeScale: number;
    readonly clamp: number;
  };
  /** The stencil test, when the pipeline has one. Its masks are the low 8 bits. */
  readonly stencil?: {
    readonly front: RhiStencilFace;
    readonly back: RhiStencilFace;
    readonly readMask: number;
    readonly writeMask: number;
  };
}

export interface RhiComputePipelineDesc {
  /** The bind group layouts, by group index. */
  readonly layouts: readonly RhiBindGroupLayout[];
  readonly module: RhiShaderModule;
  readonly entryPoint: string;
  /** The override values, by the names (or ids) the program declares. */
  readonly constants?: Readonly<Record<string, number>>;
}

export interface RhiRenderPipelineDesc {
  /** What the pipeline is, for an error: `the render pipeline of "vs" and "fs"`. */
  readonly label?: string;
  /** The bind group layouts, by group index. */
  readonly layouts: readonly RhiBindGroupLayout[];
  /** The vertex stage's module, and the fragment stage's unless it names its own. */
  readonly module: RhiShaderModule;
  readonly vertex: {
    readonly entryPoint: string;
    readonly buffers: readonly RhiVertexBufferLayout[];
  };
  /** None for a pipeline with no fragment stage (a depth-only pass). */
  readonly fragment?: {
    readonly entryPoint: string;
    readonly targets: readonly RhiColorTarget[];
    /** The fragment stage's own module: WebGL2 links a program from a vertex and a fragment
     *  shader, each its own source. */
    readonly module?: RhiShaderModule;
  };
  /** The override values each stage is made with, by the names (or ids) the program declares. */
  readonly constants?: Readonly<Record<string, number>>;
  readonly primitive: {
    /** A WebGPU `GPUPrimitiveTopology` name. */
    readonly topology: string;
    readonly cullMode: 'none' | 'front' | 'back';
    readonly frontFace: 'ccw' | 'cw';
  };
  readonly depthStencil?: RhiDepthStencilState;
  /** `{ count: 1, mask: 0xffffffff }` for no multisampling. */
  readonly multisample: { readonly count: number; readonly mask: number };
}

/** A colour attachment of a render pass. */
export interface RhiColorAttachment {
  readonly view: RhiTextureView;
  readonly loadOp: 'clear' | 'load';
  readonly storeOp: 'store' | 'discard';
  readonly clearValue: readonly number[];
}

/** The depth and stencil attachment of a render pass. A read-only aspect has its read-only flag
 *  and no load, store or clear; an aspect that is not read-only has its load, store and clear. The
 *  stencil fields are present only for a format with a stencil aspect. */
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

/** A render pass being recorded. On an immediate backend each call runs when it is made. */
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

/** A compute pass being recorded. */
export interface RhiComputePass {
  setPipeline(pipeline: RhiComputePipeline): void;
  setBindGroup(index: number, group: RhiBindGroup): void;
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
  /** Dispatch the workgroup counts three `u32`s of `buffer` hold from `byteOffset`, as the
   *  dispatch runs (WebGPU's `dispatchWorkgroupsIndirect`). The buffer has the `'indirect'` usage.
   *  A count with a 0 in it runs nothing. */
  dispatchWorkgroupsIndirect(buffer: RhiBuffer, byteOffset: number): void;
  end(): void;
}

/** The commands of one submit, recorded in order. */
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

/** What a device can do. */
export interface RhiCaps {
  /** How a compute dispatch runs: as a compute shader, or as a fragment pass (WebGL2). */
  readonly compute: 'native' | 'fragment-emulated';
  /** The language of the programs the device runs: shader text, or on the CPU backend a module's
   *  CPU program (`cpu-program.ts`, change 0120, O2). */
  readonly shaderLanguage: 'wgsl' | 'glsl-es300' | 'cpu';
  /** Whether the encoder runs each command when it is recorded (WebGL2, which has no command
   *  buffer), rather than at the submit. */
  readonly immediate: boolean;
  /** The device's limits by their names in WebGPU's `GPUSupportedLimits`, copied at the read. A
   *  WebGL2 device has none of them; it gives `maxViewportDimension`, the smaller of its
   *  `MAX_VIEWPORT_DIMS`, read once. */
  readonly limits: Readonly<Record<string, number>>;
  /** Whether the device has the WebGPU feature `name`; on WebGL2, the extension `name` (one the
   *  backend asks for, such as `EXT_polygon_offset_clamp`). */
  hasFeature(name: string): boolean;
}

/** The kinds of a host's native object that a device takes as a handle (Rule 11.17), with the
 *  handle of each. */
export interface RhiNativeKinds {
  readonly buffer: RhiBuffer;
  readonly texture: RhiTexture;
  /** A view, or any other object a binding or an attachment takes as it is. */
  readonly view: RhiTextureView;
  readonly sampler: RhiSampler;
  readonly canvas: RhiCanvas;
  readonly encoder: RhiCommandEncoder;
  readonly 'compute-pass': RhiComputePass;
  readonly 'render-pass': RhiRenderPass;
}

/** A device: the objects it makes, the commands it runs, and its capabilities. */
export interface RhiDevice {
  /** The RHI's backend. This list is not `TIERS` (`../core/tiers.ts`), the tiers a call may run
   *  on, and it is written here on purpose: a tier that is a code form of the software backend
   *  runs on the backend `'cpu'` and adds no backend (change 0042). */
  readonly backend: 'webgpu' | 'webgl2' | 'cpu';
  readonly caps: RhiCaps;
  /** The native device: a `GPUDevice` on WebGPU, a `WebGL2RenderingContext` on WebGL2, and none
   *  on the CPU backend. Escape hatch (Rule 11.17). */
  readonly native: object | null;

  createBuffer(desc: RhiBufferDesc): RhiBuffer;
  writeBuffer(buffer: RhiBuffer, byteOffset: number, data: ArrayBuffer | ArrayBufferView): void;
  /** The bytes of a `'map-read'` buffer, once the commands submitted before the call have run. */
  readBuffer(buffer: RhiBuffer): Promise<ArrayBuffer>;
  destroyBuffer(buffer: RhiBuffer): void;

  createTexture(desc: RhiTextureDesc): RhiTexture;
  /** Write the first `width` × `height` texels of the texture's first layer. */
  writeTexture(
    texture: RhiTexture,
    data: ArrayBufferView,
    bytesPerRow: number,
    width: number,
    height: number,
  ): void;
  /** The texels of the texture's first layer as bytes, rows tightly packed, `bytesPerTexel` to a
   *  texel; a `depth32float` texture gives its depth. The copy is recorded and submitted before
   *  this awaits anything, so it reads what was submitted before the call. */
  readTexture(texture: RhiTexture, bytesPerTexel: number): Promise<Uint8Array>;
  destroyTexture(texture: RhiTexture): void;
  createView(texture: RhiTexture): RhiTextureView;
  /** The texture a host's canvas context draws into now. */
  currentTexture(canvas: RhiCanvas): RhiTexture;

  createSampler(desc: RhiSamplerDesc): RhiSampler;
  /** A program: WGSL text on WebGPU, one GLSL ES 3.00 stage on WebGL2, a module's CPU program on
   *  the CPU backend. A backend refuses the other kinds. */
  createShaderModule(code: string | CpuProgram): RhiShaderModule;
  createBindGroupLayout(entries: readonly RhiBindLayoutEntry[]): RhiBindGroupLayout;
  createBindGroup(layout: RhiBindGroupLayout, entries: readonly RhiBindEntry[]): RhiBindGroup;
  /** Rejects with the backend's error when the pipeline cannot be made. */
  createComputePipeline(desc: RhiComputePipelineDesc): Promise<RhiComputePipeline>;
  /** Rejects with the backend's error when the pipeline cannot be made. */
  createRenderPipeline(desc: RhiRenderPipelineDesc): Promise<RhiRenderPipeline>;

  createCommandEncoder(): RhiCommandEncoder;
  /** Hand the encoders' commands to the device, in order, before this returns. The promise
   *  resolves once the device has run them; on an immediate backend they ran as they were
   *  recorded, and a read waits for the device itself. */
  submit(encoders: readonly RhiCommandEncoder[]): Promise<void>;
  /** Collect the validation errors of what follows, up to `popValidationScope()`. */
  pushValidationScope(): void;
  /** The first validation error since the matching push, or `null`. */
  popValidationScope(): Promise<string | null>;

  /** A host's native object of this backend as a handle of `kind`, or `undefined` when it is not
   *  of that kind. Escape hatch (Rule 11.17): a host binds, attaches and records into its own
   *  objects beside the runtime's. */
  fromNative<K extends keyof RhiNativeKinds>(
    kind: K,
    native: object,
  ): RhiNativeKinds[K] | undefined;
  /** The native object of a handle. Escape hatch (Rule 11.17). */
  toNative(handle: object): object;
  /** Destroy the native device. The runtime calls it only for a device it made itself. */
  destroy(): void;
}
