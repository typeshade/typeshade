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
  checkManifest,
  ProgramImpl,
  type ComputePipeline,
  type Geometry,
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

/** How `createRuntime()` makes a runtime. */
export interface RuntimeOptions<D extends object = object> {
  /** The host's `GPUDevice` or `WebGL2RenderingContext`, which the runtime uses and never
   *  destroys; the runtime's tier is the one it belongs to (change 0054). Omitted: the runtime
   *  tries the tiers of `prefer` in order, requesting a device with the features `programs`
   *  need, or making a WebGL2 context of its own. */
  readonly device?: D;
  /** The tiers `createRuntime` tries when it is given no device, in order: `['webgpu',
   *  'webgl2']` by default. A list of one tier makes it required. On WebGL2 the runtime runs
   *  compute entries; a draw there is a later step of change 0054, and until then `render()`,
   *  `texture()`, `sampler()` and a frame's `pass()` throw a `TypeError` that says so. */
  readonly prefer?: readonly RuntimeTier[];
  /** The programs the requested device must be able to run. */
  readonly programs?: readonly Pack[];
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

/** A render pass's attachments: textures, or a canvas context the host configured, each with
 *  what it is cleared to. A colour target is a `Texture`, a context, or `{ target, clear, load }`:
 *  `load` defaults to `'clear'` and `clear` to transparent black, `[0, 0, 0, 0]`. The depth
 *  target is a `Texture` or `{ target, clear, load }`: `clear` defaults to 1, which a reversed
 *  projection sets to 0, and `load` to `'clear'`. Every attachment is stored. */
export interface PassTargets {
  readonly color?: readonly (
    | Texture
    | object
    | {
        readonly target: Texture | object;
        readonly clear?: readonly [number, number, number, number];
        readonly load?: 'clear' | 'load';
      }
  )[];
  readonly depth?:
    | Texture
    | { readonly target: Texture; readonly clear?: number; readonly load?: 'clear' | 'load' };
}

/** A render pass of a frame: draws recorded into it. `raw` is the `GPURenderPassEncoder`. */
export interface RenderPass {
  readonly raw: object;
  /** Record a draw: `bindings` are the ones the pipeline's entries reach (change 0030). */
  draw<B>(pipeline: RenderPipeline<B>, bindings: NoInfer<B>, geometry: Geometry): void;
}

/** One command encoder's work: dispatches and render passes, submitted together. */
export interface Frame {
  /** The `GPUCommandEncoder`, for the host's own commands between the frame's. */
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
   *  requested or made. */
  readonly device: D;
  /** The tier the runtime runs on: `'webgpu'`, or `'webgl2'`, where a dispatch runs as the pass
   *  program the manifest carries (`Pack.gl.computes`, change 0054). */
  readonly tier: RuntimeTier;
  /** Load a program from its manifest. A typed manifest, a module's default export, types the
   *  program's draws and dispatches with the bindings each entry reaches (change 0030). */
  load<E extends PackBindings>(program: Pack<E>, options?: LoadOptions): Program<E>;
  texture(options: TextureOptions | object): Texture;
  sampler(options?: SamplerOptions | object): Sampler;
  frame(): Frame;
  /** Submit the host's own encoders, after copying back the console buffers of the dispatches
   *  and draws recorded since the last submit; resolves once the lines are delivered, to what
   *  those buffers held, as `Frame.submit()` does: the queue is given the encoders before the
   *  promise is returned. */
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
  readonly pool: BufferPool;
  readonly #sink: ConsoleSink | undefined;
  readonly #consoleBytes: number;
  #pending: PendingConsole[] = [];
  readonly #groups = new Map<BindGroupLayout, Map<string, object>>();
  #guard: TextureView | undefined;
  readonly #owned: boolean;
  readonly #emit: RuntimeOptions['emit'];

  constructor(
    readonly gpu: Device,
    options: RuntimeOptions,
    owned: boolean,
  ) {
    this.pool = new BufferPool(gpu);
    this.#sink = typeof options.console === 'function' ? options.console : undefined;
    this.#consoleBytes = options.consoleBytes ?? CONSOLE_BYTES;
    this.#owned = owned;
    this.#emit = options.emit;
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
    const colorAttachments = (targets.color ?? []).map((c) => {
      const spec = typeof c === 'object' && c !== null && 'target' in c ? c : { target: c };
      const s = spec as { target: object; clear?: readonly number[]; load?: 'clear' | 'load' };
      return {
        view: viewOf(s.target),
        loadOp: s.load ?? 'clear',
        storeOp: 'store',
        clearValue: s.clear ?? [0, 0, 0, 0],
      };
    });
    const d = targets.depth;
    const depthSpec =
      d === undefined
        ? undefined
        : d instanceof TextureImpl
          ? { target: d }
          : (d as { target: Texture; clear?: number; load?: 'clear' | 'load' });
    const raw = this.#enc.beginRenderPass({
      colorAttachments,
      ...(depthSpec !== undefined
        ? {
            depthStencilAttachment: {
              view: viewOf(depthSpec.target),
              depthLoadOp: depthSpec.load ?? 'clear',
              depthStoreOp: 'store',
              depthClearValue: depthSpec.clear ?? 1,
            },
          }
        : {}),
    });
    const pass: RenderPass = {
      raw,
      draw: (pipeline, bindings, geometry) => pipeline.draw(raw, bindings, geometry),
    };
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

/** The view a pass attaches: a runtime texture's, a canvas context's current texture's, a
 *  host texture's, or the host's view. */
function viewOf(t: object): object {
  if (t instanceof TextureImpl) return t.view();
  if ('getCurrentTexture' in t)
    return (t as { getCurrentTexture(): { createView(): object } })
      .getCurrentTexture()
      .createView();
  if ('createView' in t) return (t as { createView(): object }).createView();
  return t;
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
 *  environment has, a WebGPU device with the features the programs need or a WebGL2 context of
 *  its own. Rejects where it has none of them, naming why for each tier. */
export async function createRuntime<D extends object = object>(
  options: RuntimeOptions<D> = {},
): Promise<Runtime<D>> {
  if (options.device !== undefined)
    return (isWebGl2(options.device)
      ? await onGl(options.device, false)
      : new RuntimeImpl(
          options.device as unknown as Device,
          options,
          false,
        )) as unknown as Runtime<D>;
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
    const device = await adapter.requestDevice({ requiredFeatures: [...wanted] });
    return new RuntimeImpl(device, options, true) as unknown as Runtime<D>;
  }
  throw new Error(`createRuntime(): no tier it may use is here (${why.join('; ')}).`);
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
