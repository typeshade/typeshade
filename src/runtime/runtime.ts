// The program runtime (change 0025 section 2, Rule 11.11): the device, a program's pipelines,
// binding by name, the resources, frames or the host's own encoders, and the console. It
// imports nothing of the compiler: it reads a manifest (Rule 11.10).

import { decodeConsole, type ConsoleLog, type ConsoleSink } from '../core/console.js';
import { printConsole, printDropped } from '../core/console-print.js';
import type { Pack, PackBindings } from '../core/manifest-types.js';
import { glContext, makeGlContext } from '../core/gl-context.js';
import { configuredRuntime, gpuDevice } from '../core/host-entry.js';
import {
  BUFFER,
  MAP_READ,
  TEXTURE,
  gpuOf,
  type BindGroupLayout,
  type Buffer,
  type CommandEncoder,
  type Device,
  type RenderPassEncoder,
  type TextureView,
} from './gpu.js';
import {
  BufferPool,
  blendConstantOf,
  checkManifest,
  passOf,
  ProgramImpl,
  scissorOf,
  stencilReferenceOf,
  viewportOf,
  type ComputePipeline,
  type Geometry,
  type PassFit,
  type PassHost,
  type PassPlan,
  type PassState,
  type Program,
  type RenderPipeline,
} from './program.js';
import {
  SamplerImpl,
  TextureImpl,
  type Sampler,
  type SamplerOptions,
  type Texture,
  type TextureOptions,
} from './resources.js';
import { checkLimitValues, copyLimits, deriveLimits, isMinimumLimit } from './limits.js';

/** How `createRuntime()` makes a runtime. */
export interface RuntimeOptions<D extends object = object> {
  /** The host's `GPUDevice` or `WebGL2RenderingContext`, which the runtime uses and never
   *  destroys; the runtime's tier is the one it belongs to (change 0054). Omitted: the runtime
   *  tries the tiers of `prefer` in order, requesting a device with the features `programs`
   *  need, or making a WebGL2 context of its own.
   *  Escape hatch (Rule 11.17): the host's own device or context, which it keeps and calls
   *  beside the runtime. */
  readonly device?: D;
  /** The tiers `createRuntime` tries when it is given no device, in order: `['webgpu',
   *  'webgl2']` by default. A list of one tier makes it required. On WebGL2 the runtime runs
   *  compute entries and draws from the GLSL programs the manifest carries (change 0054). */
  readonly prefer?: readonly RuntimeTier[];
  /** The programs the requested device must be able to run. */
  readonly programs?: readonly Pack[];
  /** WebGPU limits the device must have, by their names in `GPUSupportedLimits` (change 0051):
   *  `{ maxStorageBufferBindingSize: 1 << 30 }`. Without `device`, the runtime requests each, with
   *  the limits `programs` need, and the larger of the two where both name one. A binding size
   *  named here raises `maxBufferSize` with it, up to the adapter's. With `device`, the runtime
   *  checks the device against each. A WebGL2 `device` has no WebGPU limits, so it refuses this
   *  option. Omitted: none. */
  readonly limits?: Readonly<Record<string, number>>;
  /** Where the events of an entry's `console.*` calls go: printed to the host's console, with a
   *  warning for the calls that did not fit the buffer (`'print'`, the default), or handed to a
   *  sink, which takes the lines and the count and prints nothing. The count of each buffer's
   *  lines and dropped calls is what `submit()` resolves to, either way. */
  readonly console?: 'print' | ConsoleSink;
  /** The console buffer's size for each dispatch and draw that records, in bytes. 1 MiB. A call
   *  the buffer has no room for is dropped whole, and counted in the `dropped` of `submit()`'s
   *  row for that dispatch or draw. */
  readonly consoleBytes?: number;
  /** The load-time emitter, `repack` from `typeshade/emit`, which emits a manifest again from
   *  the portable IR it carries when a load asks for a variant the build did not write
   *  (`load(m, { console: true })`), under the options the manifest was packed under
   *  (`packModule(m, { emit })`). The runtime never imports it itself, so a host that does
   *  not pass it ships no emitter. */
  readonly emit?: (manifest: Pack, options: { readonly console?: boolean }) => Pack;
}

/** The tier a program runtime runs on (change 0054). */
type RuntimeTier = 'webgpu' | 'webgl2';

/** How `rt.load()` loads a program. */
export interface LoadOptions {
  /** Record the entries' `console.*` calls. Default: when the manifest carries the recorded
   *  variant, which a build that records puts there (`vite dev`). A manifest without it is
   *  emitted again with it by the runtime's `emit`, when it carries its IR. */
  readonly console?: boolean;
}

/** A render pass's attachments: textures, or a canvas context the host configured. A colour target
 *  is a `Texture`, a context, or `{ target, clear, load, store }`. `load` defaults to `'clear'`,
 *  `clear` to transparent black, `[0, 0, 0, 0]`, and `store` to `'store'`. The depth target is a
 *  `Texture` or a `DepthAttachment`. Its `clear` defaults to 1, which a reversed projection sets to
 *  0, its `load` to `'clear'` and its `store` to `'store'`. */
export interface PassTargets {
  /** Escape hatch (Rule 11.17): a host `GPUTexture` or `GPUTextureView`. A canvas context is also a target (WebGPU; on WebGL2 only the runtime's own context or canvas). */
  readonly color?: readonly (
    | Texture
    | (object & { readonly target?: never })
    | {
        readonly target: Texture | object;
        /** clearValue. The colour a `'clear'` load writes. Default `[0, 0, 0, 0]`. */
        readonly clear?: readonly [number, number, number, number];
        /** loadOp. Default `'clear'`. */
        readonly load?: 'clear' | 'load';
        /** storeOp. Default `'store'`. `'discard'` reads as zero afterwards on both tiers. On WebGL2 it costs one clear of the attachment at pass end. That clear may cost the bandwidth that `'discard'` saves on a tile-based or integrated GPU. The cost is not measured on a device yet. A canvas target refuses `'discard'`. */
        readonly store?: 'store' | 'discard';
      }
  )[];
  readonly depth?: Texture | DepthAttachment;
}

/** A depth attachment: the depth aspect of one texture, and its `stencil` object when the format has a
 *  stencil aspect. A depth format with no stencil aspect takes no `stencil`. The `stencil` object
 *  follows the depth aspect for each field it omits. A read-only depth makes the stencil object
 *  read-only with load `'load'`. `stencil: { readOnly: false }` differs from `stencil: {}`. */
export type DepthAttachment = { readonly target: Texture } & DepthAspect & {
    readonly stencil?: StencilAspect;
  };

/** Not exported by name. The depth aspect of a depth attachment. A read-only aspect takes no `clear`,
 *  `load` or `store`. */
type DepthAspect =
  | {
      readonly readOnly?: false;
      /** depthClearValue, a number from 0 to 1, checked whatever the load. Default 1. */
      readonly clear?: number;
      /** depthLoadOp. Default `'clear'`. */
      readonly load?: 'clear' | 'load';
      /** depthStoreOp. Default `'store'`. `'discard'` reads as zero afterwards on both tiers. The WebGL2 cost is that of the colour `store`. */
      readonly store?: 'store' | 'discard';
    }
  | {
      /** depthReadOnly. A read-only aspect takes no clear, load or store. */
      readonly readOnly: true;
      readonly clear?: never;
      readonly load?: never;
      readonly store?: never;
    };

/** Not exported by name. The stencil object of a depth attachment. Each field it omits follows the
 *  depth aspect. */
type StencilAspect =
  | {
      readonly readOnly?: false;
      /** stencilClearValue, a whole number from 0 to 255. Default 0. A clear needs a `load` of `'clear'`. */
      readonly clear?: number;
      /** stencilLoadOp. Follows the depth `load`. */
      readonly load?: 'clear' | 'load';
      /** stencilStoreOp. Follows the depth `store`. */
      readonly store?: 'store' | 'discard';
    }
  | {
      /** stencilReadOnly. Follows the depth `readOnly`. A read-only stencil object takes no clear, load or store. */
      readonly readOnly: true;
      readonly clear?: never;
      readonly load?: never;
      readonly store?: never;
    };

/** A render pass of a frame: draws recorded into it. `raw` is the `GPURenderPassEncoder`. */
export interface RenderPass {
  /** Escape hatch (Rule 11.17): the pass's `GPURenderPassEncoder`, for the host's own draws (WebGL2 throws). */
  readonly raw: object;
  /** Record a draw: `bindings` are the ones the pipeline's entries reach (change 0030). */
  draw<B>(pipeline: RenderPipeline<B>, bindings: NoInfer<B>, geometry: Geometry): void;
  /** WebGPU setViewport. x and y are whole numbers within the viewport bounds. width and height are whole numbers from 0 to the viewport limit. 0 <= minDepth <= maxDepth <= 1. An omitted `minDepth` is 0, and an omitted `maxDepth` is 1. Default: the whole attachment. A WebGL2 runtime refuses a depth range other than 0 to 1 for a fragment that writes `frag_depth`. To learn that on WebGPU, run the host a second time with `createRuntime({ prefer: ['webgl2'] })`. */
  setViewport(
    x: number,
    y: number,
    width: number,
    height: number,
    minDepth?: number,
    maxDepth?: number,
  ): void;
  /** WebGPU setScissorRect. Whole numbers from 0 up. A fraction is refused. The rectangle is clipped to a Texture or canvas target. A host `GPUTextureView` target has no size the runtime knows, so its rectangle passes through and WebGPU validates it. Default: the whole attachment. */
  setScissorRect(x: number, y: number, width: number, height: number): void;
  /** WebGPU setBlendConstant. Four numbers, each from 0 to 1. Default [0, 0, 0, 0] at each pass start. The length is checked. A draw whose pipeline declares `blendConstant` uses that value instead. */
  setBlendConstant(color: ArrayLike<number>): void;
  /** WebGPU setStencilReference. A whole number from 0 to 255. A fraction is refused. Default 0 at each pass start. A draw of a pipeline that declares `depth.stencil.reference` uses that value instead. */
  setStencilReference(reference: number): void;
}

/** One command encoder's work: dispatches and render passes, submitted together. */
export interface Frame {
  /** The `GPUCommandEncoder`, for the host's own commands between the frame's.
   *  Escape hatch (Rule 11.17): the encoder itself, for the host's WebGPU calls (WebGL2 throws). */
  readonly encoder: object;
  /** Record a dispatch: `bindings` are the ones the pipeline's entry reaches (change 0030). */
  dispatch<B>(
    pipeline: ComputePipeline<B>,
    bindings: NoInfer<B>,
    workgroups: number | readonly number[],
  ): void;
  pass(targets: PassTargets, record: (pass: RenderPass) => void): void;
  /** Submit the frame. The queue is given its commands before `submit()` returns its promise, so
   *  a texture read started right after it, while the promise is pending, reads the frame
   *  (`Texture.read`). It resolves once the queue has run the frame and the console lines of its
   *  entries are delivered, printed or handed to the runtime's sink, to what their buffers held:
   *  `{ console: [{ entry, lines, dropped }, …] }`, a row for each dispatch and draw of the frame
   *  that recorded, in the order they were recorded, and none when nothing did. `entry` names what
   *  the buffer recorded for (the compute entry, or the fragment entry of a draw), `lines` the
   *  `console.*` calls it kept, each printed or handed to the sink, and `dropped` the calls that
   *  had no room in `consoleBytes`. A runtime that prints warns of the dropped calls; one given a
   *  sink prints nothing, so its host reads the count here. It rejects with the validation error
   *  the frame raised, if any. */
  submit(): Promise<{
    readonly console: readonly {
      readonly entry: string;
      readonly lines: number;
      readonly dropped: number;
    }[];
  }>;
}

/** What `Frame.submit()` resolves to, which `Runtime.submit()` does too. */
type SubmitResult = Awaited<ReturnType<Frame['submit']>>;

/** The program runtime: a device, and everything a program needs on it. */
export interface Runtime<D extends object = object> {
  /** The `GPUDevice` or the `WebGL2RenderingContext`: the host's, or the one the runtime
   *  requested or made.
   *  Escape hatch (Rule 11.17): the device itself, for the host's own calls on it. */
  readonly device: D;
  /** The tier the runtime runs on: `'webgpu'`, or `'webgl2'`, where a dispatch runs as the pass
   *  program the manifest carries (`Pack.gl.computes`, change 0054). */
  readonly tier: RuntimeTier;
  /** The device's WebGPU limits, by their names in `GPUSupportedLimits`, copied when the runtime
   *  was made (change 0051). Frozen. Empty on the WebGL2 tier, which has no WebGPU limits. */
  readonly limits: Readonly<Record<string, number>>;
  /** Load a program from its manifest. A typed manifest, a module's default export, types the
   *  program's draws and dispatches with the bindings each entry reaches (change 0030). */
  load<E extends PackBindings>(program: Pack<E>, options?: LoadOptions): Program<E>;
  texture(options: TextureOptions | object): Texture;
  sampler(options?: SamplerOptions | object): Sampler;
  frame(): Frame;
  /** Submit the host's own encoders, after copying back the console buffers of the dispatches
   *  and draws recorded since the last submit; resolves once the lines are delivered, to what
   *  those buffers held, as `Frame.submit()` does: the queue is given the encoders before the
   *  promise is returned.
   *  Escape hatch (Rule 11.17): the host's own `GPUCommandEncoder`s, which this submits; a WebGL2
   *  runtime rejects. */
  submit(...encoders: readonly object[]): ReturnType<Frame['submit']>;
  /** Release what the runtime made. The host's device is left as it is. */
  destroy(): void;
}

const CONSOLE_BYTES = 1 << 20;

interface PendingConsole {
  readonly buffer: Buffer;
  readonly log: ConsoleLog;
  readonly entry: string;
  readonly size: number;
}

export class RuntimeImpl implements Runtime {
  readonly tier = 'webgpu';
  readonly limits: Readonly<Record<string, number>>;
  readonly pool: BufferPool;
  readonly #sink: ConsoleSink | undefined;
  readonly #consoleBytes: number;
  #pending: PendingConsole[] = [];
  readonly #groups = new Map<BindGroupLayout, Map<string, object>>();
  #guard: TextureView | undefined;
  readonly #owned: boolean;
  readonly #emit: RuntimeOptions['emit'];
  /** The adapter's limits when the runtime requested the device: R4 names them (change 0051). */
  readonly #adapter: Readonly<Record<string, number>>;

  constructor(
    readonly gpu: Device,
    options: RuntimeOptions,
    owned: boolean,
    adapter: Readonly<Record<string, number>> = {},
  ) {
    this.pool = new BufferPool(gpu);
    this.limits = copyLimits(gpu.limits);
    this.#sink = typeof options.console === 'function' ? options.console : undefined;
    this.#consoleBytes = options.consoleBytes ?? CONSOLE_BYTES;
    this.#owned = owned;
    this.#emit = options.emit;
    this.#adapter = adapter;
  }

  /** The last sentence of R4 for a limit this device has `have` of (change 0051). */
  limitRemedy(name: string, have: number): string {
    if (!this.#owned)
      return 'Request the limit in requestDevice({ requiredLimits }) for the device the runtime was given.';
    if (this.#adapter[name] === have) return 'This adapter supports no more.';
    return 'Pass the program in createRuntime({ programs }), or raise the limit with createRuntime({ limits }).';
  }

  get device(): object {
    return this.gpu;
  }

  load<E extends PackBindings>(program: Pack<E>, options: LoadOptions = {}): Program<E> {
    checkManifest(program);
    for (const f of program.features)
      if (!this.gpu.features.has(f))
        throw new TypeError(
          `The program needs the "${f}" feature, which this device lacks; request it, or pass the program in createRuntime({ programs }).`,
        );
    const record = options.console ?? program.console !== undefined;
    if (record && program.console === undefined) {
      if (this.#emit === undefined || program.ir === undefined)
        throw new TypeError(
          this.#emit === undefined
            ? 'load({ console: true }): this manifest carries no recorded variant; build it with packModule(m, { console: true }) or in vite dev, or pass the load-time emitter, createRuntime({ emit: repack }), with a manifest that carries its IR.'
            : 'load({ console: true }): this manifest carries no recorded variant and no IR to emit one from; build it with packModule(m, { ir: true }) or typeshade({ ir: true }).',
        );
      // Emitted again with the variant; `repack` refuses an IR another version wrote.
      program = this.#emit(program, { console: true }) as Pack<E>;
    }
    // The bindings' types are the checker's alone: one ProgramImpl serves every manifest.
    return new ProgramImpl(this, program, record) as unknown as Program<E>;
  }

  texture(options: TextureOptions | object): Texture {
    return new TextureImpl(this.gpu, options);
  }

  sampler(options?: SamplerOptions | object): Sampler {
    return new SamplerImpl(this.gpu, options);
  }

  frame(): Frame {
    return new FrameImpl(this);
  }

  /** A bind group, cached by its layout and the identity of what it holds. */
  bindGroup(layout: BindGroupLayout, key: string, entries: readonly object[]): object {
    let byKey = this.#groups.get(layout);
    if (byKey === undefined) this.#groups.set(layout, (byKey = new Map()));
    let g = byKey.get(key);
    if (g === undefined) {
      // A cache that keeps every group ever made would hold every transient buffer too.
      if (byKey.size > 4096) byKey.clear();
      byKey.set(key, (g = this.gpu.createBindGroup({ layout, entries })));
    }
    return g;
  }

  /** The `_fp64` guard's view: a 1 × 1 texture that holds 1.0. */
  guardView(): TextureView {
    if (this.#guard === undefined) {
      const t = this.gpu.createTexture({
        size: [1, 1, 1],
        format: 'rgba8unorm',
        usage: TEXTURE.TEXTURE_BINDING | TEXTURE.COPY_DST,
      });
      (
        this.gpu.queue as unknown as {
          writeTexture(d: object, data: Uint8Array, l: object, s: readonly number[]): void;
        }
      ).writeTexture(
        { texture: t },
        new Uint8Array([255, 255, 255, 255]),
        { bytesPerRow: 4 },
        [1, 1, 1],
      );
      this.#guard = t.createView();
    }
    return this.#guard;
  }

  /** A zeroed console buffer for one dispatch or draw of `entry`, read back at the next submit. */
  consoleBuffer(log: ConsoleLog, entry: string): Buffer {
    const size = this.#consoleBytes;
    const buffer = this.pool.take(size, BUFFER.STORAGE | BUFFER.COPY_SRC | BUFFER.COPY_DST);
    // The cursor and the dropped count start at 0; what lies past the cursor is never read.
    this.gpu.queue.writeBuffer(buffer, 0, new Uint32Array(2));
    this.#pending.push({ buffer, log, entry, size });
    return buffer;
  }

  /** Record the copies of the console buffers pending into `encoder`, and return what reads
   *  them back once it is submitted: it delivers each buffer's lines, and resolves to the count of
   *  each. */
  takeConsole(encoder: CommandEncoder): (() => Promise<SubmitResult['console']>) | undefined {
    const pending = this.#pending;
    this.#pending = [];
    if (pending.length === 0) return undefined;
    const copies = pending.map((p) => {
      const staging = this.pool.take(p.size, BUFFER.MAP_READ | BUFFER.COPY_DST);
      encoder.copyBufferToBuffer(p.buffer, 0, staging, 0, p.size);
      return { ...p, staging };
    });
    return async () => {
      const rows: { entry: string; lines: number; dropped: number }[] = [];
      for (const c of copies) {
        await c.staging.mapAsync(MAP_READ);
        const words = new Uint32Array(c.staging.getMappedRange().slice(0));
        c.staging.unmap();
        const { events, dropped } = decodeConsole(words, c.log);
        // A sink takes the lines and the count, so the runtime prints neither.
        if (this.#sink !== undefined) for (const e of events) this.#sink(e);
        else {
          for (const e of events) printConsole(e, 'GPU');
          printDropped(c.entry, dropped);
        }
        rows.push({ entry: c.entry, lines: events.length, dropped });
      }
      return rows;
    };
  }

  async submit(...encoders: readonly object[]): Promise<SubmitResult> {
    if (encoders.length === 0)
      throw new TypeError('submit() takes the GPUCommandEncoders to submit.');
    const last = encoders[encoders.length - 1] as CommandEncoder;
    const read = this.takeConsole(last);
    // The queue is given the commands before anything is awaited: a texture read started after
    // this call reads what it submitted (surface section 69).
    this.gpu.queue.submit(encoders.map((e) => (e as CommandEncoder).finish()));
    const done = this.gpu.queue.onSubmittedWorkDone();
    this.pool.release(done);
    const rows = read === undefined ? [] : await read();
    await done;
    return { console: rows };
  }

  destroy(): void {
    this.pool.destroy();
    this.#groups.clear();
    if (this.#owned) (this.gpu as unknown as { destroy?(): void }).destroy?.();
  }
}

class FrameImpl implements Frame {
  readonly #enc: CommandEncoder;
  #submitted = false;

  constructor(private readonly rt: RuntimeImpl) {
    rt.gpu.pushErrorScope('validation');
    this.#enc = rt.gpu.createCommandEncoder();
  }

  get encoder(): object {
    return this.#enc;
  }

  dispatch<B>(
    pipeline: ComputePipeline<B>,
    bindings: NoInfer<B>,
    workgroups: number | readonly number[],
  ): void {
    pipeline.dispatch(this.#enc, bindings, workgroups);
  }

  pass(targets: PassTargets, record: (pass: RenderPass) => void): void {
    // Check the targets first: a refused pass begins nothing on the encoder.
    const plan = passOf(targets, WEBGPU_PASS);
    // The size of the first attachment that has one: WebGPU requires one size for all of them.
    let size: { width: number; height: number } | undefined;
    const colorAttachments = plan.color.map((c) => {
      const v = viewOf(c.target);
      size ??= v.size;
      return { view: v.view, loadOp: c.load, storeOp: c.store, clearValue: c.clear };
    });
    const d = plan.depth;
    const depthView = d === undefined ? undefined : viewOf(d.target);
    size ??= depthView?.size;
    const raw = this.#enc.beginRenderPass({
      colorAttachments,
      ...(d !== undefined && depthView !== undefined
        ? { depthStencilAttachment: depthStencilAttachmentOf(depthView.view, d) }
        : {}),
    });
    const limit = this.rt.limits.maxTextureDimension2D ?? 8192;
    const pass = new FramePass(raw, limit, size, {
      depthFormat: d?.format,
      depthReadOnly: d?.depth.readOnly ?? false,
      stencilReadOnly: d?.stencil?.readOnly ?? false,
    });
    try {
      record(pass);
    } finally {
      (raw as RenderPassEncoder).end();
    }
  }
  async submit(): Promise<SubmitResult> {
    if (this.#submitted)
      throw new TypeError('This frame was submitted already; make a new one with rt.frame().');
    this.#submitted = true;
    const read = this.rt.takeConsole(this.#enc);
    // The queue is given the commands before anything is awaited: a texture read started after
    // this call reads the frame (surface section 69).
    this.rt.gpu.queue.submit([this.#enc.finish()]);
    const error = this.rt.gpu.popErrorScope();
    const done = this.rt.gpu.queue.onSubmittedWorkDone();
    this.rt.pool.release(done);
    const e = await error;
    if (e !== null) throw new Error(`The frame did not validate: ${e.message}`);
    const rows = read === undefined ? [] : await read();
    await done;
    return { console: rows };
  }
}

/** The view a pass attaches, and its size when the runtime knows one: a runtime texture's, a canvas
 *  context's current texture's (the drawing buffer's size), or the host's view, which has none. */
function viewOf(t: object): { view: object; size?: { width: number; height: number } } {
  if (t instanceof TextureImpl)
    return { view: t.view(), size: { width: t.width, height: t.height } };
  if ('getCurrentTexture' in t) {
    const tex = (
      t as { getCurrentTexture(): { createView(): object; width: number; height: number } }
    ).getCurrentTexture();
    return { view: tex.createView(), size: { width: tex.width, height: tex.height } };
  }
  if ('createView' in t) return { view: (t as { createView(): object }).createView() };
  return { view: t };
}

/** The WebGPU host of `passOf`: a runtime texture, a canvas context, and a texture's format. */
const WEBGPU_PASS: PassHost = {
  isTexture: (t) => t instanceof TextureImpl,
  isCanvas: (t) => 'getCurrentTexture' in t,
  formatOf: (t) => (t as { format?: string }).format,
};

/** The `depthStencilAttachment` of a plan. A read-only aspect names only its read-only flag, since
 *  WebGPU refuses a load, a store or a clear on it. An aspect that is not read-only names its load,
 *  its store and its clear. WebGPU requires the stencil operations of a stencil format, and it
 *  refuses them on a depth-only one. */
function depthStencilAttachmentOf(view: object, d: NonNullable<PassPlan['depth']>): object {
  const a = d.depth;
  const s = d.stencil;
  return {
    view,
    ...(a.readOnly
      ? { depthReadOnly: true }
      : { depthLoadOp: a.load, depthStoreOp: a.store, depthClearValue: a.clear }),
    ...(s === undefined
      ? {}
      : s.readOnly
        ? { stencilReadOnly: true }
        : { stencilLoadOp: s.load, stencilStoreOp: a.store, stencilClearValue: s.clear }),
  };
}

/** The pass a frame records into on WebGPU: its encoder's pass, with the calls that check their
 *  arguments (proposal 0064) and the state a draw needs to restore the pass value. */
class FramePass implements RenderPass {
  readonly passState: PassState;
  constructor(
    readonly raw: RenderPassEncoder,
    private readonly limit: number,
    private readonly size: { readonly width: number; readonly height: number } | undefined,
    fit: PassFit,
  ) {
    this.passState = { ...fit, blend: [0, 0, 0, 0], blendDeclared: false, stencilReference: 0 };
  }

  draw<B>(pipeline: RenderPipeline<B>, bindings: NoInfer<B>, geometry: Geometry): void {
    pipeline.draw(this, bindings, geometry);
  }
  setViewport(
    x: number,
    y: number,
    width: number,
    height: number,
    minDepth?: number,
    maxDepth?: number,
  ): void {
    const v = viewportOf(x, y, width, height, minDepth, maxDepth, this.limit);
    this.raw.setViewport(...v.rect, v.minDepth, v.maxDepth);
  }
  setScissorRect(x: number, y: number, width: number, height: number): void {
    this.raw.setScissorRect(...scissorOf(x, y, width, height, this.size));
  }
  setBlendConstant(color: ArrayLike<number>): void {
    const c = blendConstantOf(color);
    this.raw.setBlendConstant(c);
    this.passState.blend = c;
    this.passState.blendDeclared = false;
  }
  setStencilReference(reference: number): void {
    const r = stencilReferenceOf(reference);
    this.raw.setStencilReference(r);
    this.passState.stencilReference = r;
  }
}

/** Whether `d` is a WebGL2 context: a `GPUDevice` has neither method. */
function isWebGl2(d: object): d is WebGL2RenderingContext {
  const c = d as { getParameter?: unknown; createTransformFeedback?: unknown };
  return typeof c.getParameter === 'function' && typeof c.createTransformFeedback === 'function';
}

/** A runtime of the WebGL2 tier on `gl`. The tier and its executor load on first use, so a host
 *  that runs on WebGPU and splits its bundle never fetches them. */
async function onGl(gl: WebGL2RenderingContext, owned: boolean): Promise<Runtime> {
  const { GlRuntimeImpl } = await import('./gl.js');
  return new GlRuntimeImpl(gl, owned);
}

/** Make a runtime: on the host's device or WebGL2 context, or on the first tier of `prefer` the
 *  environment has, a WebGPU device with the features and limits the programs and `limits` need,
 *  or a WebGL2 context of its own. Rejects where it has none of them, naming why for each tier. */
export async function createRuntime<D extends object = object>(
  options: RuntimeOptions<D> = {},
): Promise<Runtime<D>> {
  const limits = options.limits;
  if (limits !== undefined) checkLimitValues(limits);
  if (options.device !== undefined) {
    if (isWebGl2(options.device)) {
      if (limits !== undefined)
        throw new TypeError(
          'createRuntime({ limits }): the device is a WebGL2 context, which has no WebGPU limits. Omit limits, or pass a GPUDevice.',
        );
      return (await onGl(options.device, false)) as unknown as Runtime<D>;
    }
    const device = options.device as unknown as Device;
    if (limits !== undefined) checkDeviceLimits(limits, device.limits);
    return new RuntimeImpl(device, options, false) as unknown as Runtime<D>;
  }
  const prefer = options.prefer ?? (['webgpu', 'webgl2'] as const);
  if (!Array.isArray(prefer) || prefer.length === 0)
    throw new TypeError('createRuntime(): prefer takes a non-empty list of tiers.');
  for (const t of prefer)
    if (t !== 'webgpu' && t !== 'webgl2')
      throw new TypeError(
        `createRuntime(): "${String(t)}" is not a tier of the program runtime; its tiers are webgpu and webgl2.`,
      );
  if (new Set(prefer).size !== prefer.length)
    throw new TypeError('createRuntime(): prefer names a tier twice.');
  const why: string[] = [];
  for (const tier of prefer) {
    if (tier === 'webgl2') {
      const gl = makeGlContext();
      if (gl !== null) return (await onGl(gl, true)) as unknown as Runtime<D>;
      why.push('webgl2: the environment makes no WebGL2 context');
      continue;
    }
    const gpu = gpuOf();
    if (gpu === undefined) {
      why.push('webgpu: navigator.gpu is undefined');
      continue;
    }
    const adapter = await gpu.requestAdapter();
    if (adapter === null) {
      why.push('webgpu: WebGPU gave no adapter');
      continue;
    }
    const wanted = new Set((options.programs ?? []).flatMap((p) => p.features));
    const lacks = [...wanted].find((f) => !adapter.features.has(f));
    if (lacks !== undefined) {
      why.push(`webgpu: the adapter lacks the "${lacks}" feature a program needs`);
      continue;
    }
    const supported = copyLimits(adapter.limits);
    const named = limits === undefined ? undefined : requestLimits(limits, supported, why);
    if (named === 'refused') continue;
    const requiredLimits = namedAndDerived(options, supported, named);
    const device = await adapter.requestDevice({
      requiredFeatures: [...wanted],
      ...(Object.keys(requiredLimits).length > 0 ? { requiredLimits } : {}),
    });
    return new RuntimeImpl(device, options, true, supported) as unknown as Runtime<D>;
  }
  throw new Error(`createRuntime(): no tier it may use is here (${why.join('; ')}).`);
}

/** Check each named limit against the adapter (R1, R2; change 0051, requesting steps 2 and 3).
 *  Pushes R2's reason and returns `'refused'` when the adapter cannot give one; throws R1 for a
 *  name the adapter does not report. An adapter with no limits checks nothing. */
function requestLimits(
  limits: Readonly<Record<string, number>>,
  supported: Readonly<Record<string, number>>,
  why: string[],
): Readonly<Record<string, number>> | 'refused' {
  if (Object.keys(supported).length === 0) return limits;
  for (const name of Object.keys(limits)) {
    if (!Object.hasOwn(supported, name))
      throw new TypeError(
        `createRuntime({ limits }): "${name}" is not a limit this adapter reports.`,
      );
    const asked = limits[name]!;
    const have = supported[name]!;
    if (isMinimumLimit(name) ? asked < have : asked > have) {
      why.push(
        `webgpu: the adapter supports ${name} ${isMinimumLimit(name) ? 'down to' : 'up to'} ${have}, and createRuntime({ limits }) asks for ${asked}`,
      );
      return 'refused';
    }
  }
  return limits;
}

/** The limits to request: the derived need of `programs`, capped at the adapter's value, merged
 *  with the named limits (requesting steps 4 to 7; change 0051). Empty when the adapter reports
 *  none. */
function namedAndDerived(
  options: RuntimeOptions<object>,
  supported: Readonly<Record<string, number>>,
  named: Readonly<Record<string, number>> | undefined,
): Record<string, number> {
  const merged: Record<string, number> = {};
  if (Object.keys(supported).length === 0) return merged;
  for (const [name, need] of Object.entries(
    deriveLimits(options.programs ?? [], options.emit !== undefined),
  )) {
    if (!Object.hasOwn(supported, name)) continue;
    merged[name] = Math.min(need, supported[name]!);
  }
  for (const [name, value] of Object.entries(named ?? {}))
    merged[name] = isMinimumLimit(name) ? value : Math.max(merged[name] ?? 0, value);
  for (const name of ['maxStorageBufferBindingSize', 'maxUniformBufferBindingSize']) {
    const size = named?.[name];
    if (size === undefined || !Object.hasOwn(supported, 'maxBufferSize')) continue;
    merged.maxBufferSize = Math.max(
      merged.maxBufferSize ?? 0,
      Math.min(size, supported.maxBufferSize!),
    );
  }
  return merged;
}

/** Check each named limit against the host's device (R1, R3; change 0051). A device with no
 *  limits checks nothing. */
function checkDeviceLimits(
  limits: Readonly<Record<string, number>>,
  deviceLimits: object | undefined,
): void {
  const have = copyLimits(deviceLimits);
  if (Object.keys(have).length === 0) return;
  for (const name of Object.keys(limits)) {
    if (!Object.hasOwn(have, name))
      throw new TypeError(
        `createRuntime({ limits }): "${name}" is not a limit this device reports.`,
      );
    const asked = limits[name]!;
    const value = have[name]!;
    if (isMinimumLimit(name) ? asked < value : asked > value)
      throw new TypeError(
        `The device has ${name} ${value}; createRuntime({ limits }) asks for ${asked}. Request the limit in requestDevice({ requiredLimits }) for this device, or omit device so the runtime requests it.`,
      );
  }
}

let fallback: Promise<Runtime> | undefined;
let fallbackDevice: object | undefined;

/** The default runtime: the one `configure({ runtime })` named, or one on the device the call
 *  layer uses (change 0025), so a resource made on either layer is used on the other. Where
 *  there is no WebGPU, one on the call layer's WebGL2 context (change 0054); rejects where
 *  there is neither. */
export function runtime(): Promise<Runtime> {
  const configured = configuredRuntime();
  if (configured !== undefined) return Promise.resolve(configured as Runtime);
  return gpuDevice().then((device) => {
    if (device === null) {
      const gl = glContext();
      if (gl === null)
        throw new Error(
          'This environment has no WebGPU (navigator.gpu is undefined, or gave no adapter) and no WebGL2 context.',
        );
      if (fallbackDevice !== gl) {
        fallbackDevice = gl;
        fallback = onGl(gl, false);
      }
      return fallback!;
    }
    // The call layer asks for a new device once one is lost; so does the default runtime.
    if (fallback === undefined || fallbackDevice !== device) {
      fallbackDevice = device;
      fallback = Promise.resolve(
        new RuntimeImpl(device as unknown as Device, {}, false) as Runtime,
      );
    }
    return fallback;
  });
}
