// The program runtime (change 0025 section 2, Rule 11.11): the device, a program's pipelines,
// binding by name, the resources, frames or the host's own encoders, and the console. It
// imports nothing of the compiler: it reads a manifest (Rule 11.10).

import { decodeConsole, type ConsoleLog, type ConsoleSink } from '../core/console.js';
import { printConsole, printDropped } from '../core/console-print.js';
import { PACK_SCHEMA, type Pack } from '../core/manifest-types.js';
import { VERSION } from '../core/version.js';
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
  ProgramImpl,
  type Bindings,
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
  /** The host's `GPUDevice`, which the runtime uses and never destroys. Omitted: the runtime
   *  requests one, with the features `programs` need. */
  readonly device?: D;
  /** The programs the requested device must be able to run. */
  readonly programs?: readonly Pack[];
  /** Where the events of an entry's `console.*` calls go: printed to the host's console (the
   *  default), or handed to a sink. */
  readonly console?: 'print' | ConsoleSink;
  /** The console buffer's size for each dispatch and draw that records, in bytes. 1 MiB. */
  readonly consoleBytes?: number;
  /** The load-time emitter, `repack` from `typeshade/emit`, which emits a manifest again from
   *  the portable IR it carries when a load asks for a variant the build did not write
   *  (`load(m, { console: true })`). The runtime never imports it itself, so a host that does
   *  not pass it ships no emitter. */
  readonly emit?: (manifest: Pack, options: { readonly console?: boolean }) => Pack;
}

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
  draw(pipeline: RenderPipeline, bindings: Bindings, geometry: Geometry): void;
}

/** One command encoder's work: dispatches and render passes, submitted together. */
export interface Frame {
  /** The `GPUCommandEncoder`, for the host's own commands between the frame's. */
  readonly encoder: object;
  dispatch(
    pipeline: ComputePipeline,
    bindings: Bindings,
    workgroups: number | readonly number[],
  ): void;
  pass(targets: PassTargets, record: (pass: RenderPass) => void): void;
  /** Submit the frame. It resolves once the queue has run it and the console lines of its
   *  entries are printed; it rejects with the validation error the frame raised, if any. */
  submit(): Promise<void>;
}

/** The program runtime: a device, and everything a program needs on it. */
export interface Runtime<D extends object = object> {
  /** The `GPUDevice`: the host's, or the one the runtime requested. */
  readonly device: D;
  load(program: Pack, options?: LoadOptions): Program;
  texture(options: TextureOptions | object): Texture;
  sampler(options?: SamplerOptions | object): Sampler;
  frame(): Frame;
  /** Submit the host's own encoders, after copying back the console buffers of the dispatches
   *  and draws recorded since the last submit; resolves once the lines are printed. */
  submit(...encoders: readonly object[]): Promise<void>;
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

  load(program: Pack, options: LoadOptions = {}): Program {
    if (typeof program !== 'object' || program === null || !('wgsl' in program))
      throw new TypeError(
        'load() takes a manifest: packModule()’s result, or a module’s default export.',
      );
    if (program.schema !== PACK_SCHEMA)
      throw new TypeError(
        `This manifest is schema ${String(program.schema)} (written by typeshade ${program.compiler ?? 'unknown'}); this runtime (typeshade ${VERSION}) reads schema ${PACK_SCHEMA}.`,
      );
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
      program = this.#emit(program, { console: true });
    }
    return new ProgramImpl(this, program, record);
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
   *  them back once it is submitted. */
  takeConsole(encoder: CommandEncoder): (() => Promise<void>) | undefined {
    const pending = this.#pending;
    this.#pending = [];
    if (pending.length === 0) return undefined;
    const copies = pending.map((p) => {
      const staging = this.pool.take(p.size, BUFFER.MAP_READ | BUFFER.COPY_DST);
      encoder.copyBufferToBuffer(p.buffer, 0, staging, 0, p.size);
      return { ...p, staging };
    });
    return async () => {
      for (const c of copies) {
        await c.staging.mapAsync(MAP_READ);
        const words = new Uint32Array(c.staging.getMappedRange().slice(0));
        c.staging.unmap();
        const { events, dropped } = decodeConsole(words, c.log);
        for (const e of events) {
          if (this.#sink !== undefined) this.#sink(e);
          else printConsole(e, 'GPU');
        }
        printDropped(c.entry, dropped);
      }
    };
  }

  async submit(...encoders: readonly object[]): Promise<void> {
    if (encoders.length === 0)
      throw new TypeError('submit() takes the GPUCommandEncoders to submit.');
    const last = encoders[encoders.length - 1] as CommandEncoder;
    const read = this.takeConsole(last);
    this.gpu.queue.submit(encoders.map((e) => (e as CommandEncoder).finish()));
    const done = this.gpu.queue.onSubmittedWorkDone();
    this.pool.release(done);
    if (read !== undefined) await read();
    await done;
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

  dispatch(
    pipeline: ComputePipeline,
    bindings: Bindings,
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

  async submit(): Promise<void> {
    if (this.#submitted)
      throw new TypeError('This frame was submitted already; make a new one with rt.frame().');
    this.#submitted = true;
    const read = this.rt.takeConsole(this.#enc);
    this.rt.gpu.queue.submit([this.#enc.finish()]);
    const error = this.rt.gpu.popErrorScope();
    const done = this.rt.gpu.queue.onSubmittedWorkDone();
    this.rt.pool.release(done);
    const e = await error;
    if (e !== null) throw new Error(`The frame did not validate: ${e.message}`);
    if (read !== undefined) await read();
    await done;
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

/** Make a runtime: on the host's device, or on one it requests with the features the programs
 *  need. Rejects where there is no WebGPU. */
export async function createRuntime<D extends object = object>(
  options: RuntimeOptions<D> = {},
): Promise<Runtime<D>> {
  if (options.device !== undefined)
    return new RuntimeImpl(
      options.device as unknown as Device,
      options,
      false,
    ) as unknown as Runtime<D>;
  const gpu = gpuOf();
  if (gpu === undefined)
    throw new Error('This environment has no WebGPU (navigator.gpu is undefined).');
  const adapter = await gpu.requestAdapter();
  if (adapter === null) throw new Error('WebGPU gave no adapter.');
  const wanted = new Set((options.programs ?? []).flatMap((p) => p.features));
  for (const f of wanted)
    if (!adapter.features.has(f))
      throw new Error(`The adapter lacks the "${f}" feature a program needs.`);
  const device = await adapter.requestDevice({ requiredFeatures: [...wanted] });
  return new RuntimeImpl(device, options, true) as unknown as Runtime<D>;
}

let fallback: Promise<Runtime> | undefined;
let fallbackDevice: object | undefined;

/** The default runtime: the one `configure({ runtime })` named, or one on the device the call
 *  layer uses (change 0025), so a resource made on either layer is used on the other. Rejects
 *  where there is no WebGPU. */
export function runtime(): Promise<Runtime> {
  const configured = configuredRuntime();
  if (configured !== undefined) return Promise.resolve(configured as Runtime);
  return gpuDevice().then((device) => {
    if (device === null)
      throw new Error(
        'This environment has no WebGPU (navigator.gpu is undefined, or gave no adapter).',
      );
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
