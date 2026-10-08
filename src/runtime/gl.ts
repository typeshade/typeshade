// The program runtime's WebGL2 tier (change 0054 decision 2, Rule 11.11): a runtime on a
// WebGL2 context that runs a program's `@compute` entries as the pass programs the manifest
// carries (`Pack.gl.computes`). It builds no program itself, so like the rest of the runtime it
// imports no compiler.
//
// A dispatch is recorded into a frame and runs at `submit()`, after every kernel call, entry
// call and frame submitted before it (`core/resident.ts`). A plain value is packed into the
// dispatch's memory when the dispatch is recorded, and nothing is read back into it, as on
// WebGPU. A `Resident` is the array it holds: the dispatch reads it, and writes back into it
// what the dispatch wrote.
//
// It draws too (`gl-draw.ts`): textures, samplers, render pipelines from the vertex and fragment
// programs the manifest carries, and passes recorded into a frame. A frame has no
// `GPUCommandEncoder`, a pass no `GPURenderPassEncoder`, and `submit(encoders)` takes none; each
// is a `TypeError` that says so.

import { describe, byteSize, Misfit, pack, readInto, type Layout } from '../core/host-entry.js';
import { runGlCompute } from '../core/gl-compute.js';
import {
  layoutFromPack,
  type Pack,
  type PackBinding,
  type PackBindings,
  type PackEntry,
  type PackGlCompute,
} from '../core/manifest-types.js';
import { kernelQueue, residentState, type ResidentArrayState } from '../core/resident.js';
import {
  at,
  checkManifest,
  constantsOf,
  entryOf,
  workgroupsOf,
  type Bindings,
  type ComputePipeline,
  type Constants,
  type Program,
  type RenderPipeline,
  type RenderState,
} from './program.js';
import type { Sampler, SamplerOptions, Texture, TextureOptions } from './resources.js';
import type { Frame, LoadOptions, PassTargets, RenderPass, Runtime } from './runtime.js';
import {
  GlDrawing,
  GlRenderPrograms,
  GlSamplerImpl,
  GlTextureImpl,
  pinOverrides,
  recordPass,
  samplerOf,
  textureOf,
} from './gl-draw.js';

/** The program runtime on a WebGL2 context. */
export class GlRuntimeImpl implements Runtime<WebGL2RenderingContext> {
  readonly tier = 'webgl2';

  #drawing: GlDrawing | undefined;

  constructor(
    readonly gl: WebGL2RenderingContext,
    private readonly owned: boolean,
  ) {}

  /** What the runtime's textures, pipelines and passes share on its context. */
  get drawing(): GlDrawing {
    return (this.#drawing ??= new GlDrawing(this.gl));
  }

  get device(): WebGL2RenderingContext {
    return this.gl;
  }

  load<E extends PackBindings>(program: Pack<E>, options: LoadOptions = {}): Program<E> {
    checkManifest(program);
    if (options.console === true)
      throw new TypeError(
        'load({ console: true }): the WebGL2 tier of the program runtime does not record console calls.',
      );
    return new GlProgramImpl(this, program) as unknown as Program<E>;
  }

  texture(options: TextureOptions | object): Texture {
    return new GlTextureImpl(this.drawing, options);
  }

  sampler(options?: SamplerOptions | object): Sampler {
    return new GlSamplerImpl(this.gl, options);
  }

  frame(): Frame {
    return new GlFrameImpl(this);
  }

  submit(): ReturnType<Frame['submit']> {
    return Promise.reject(
      new TypeError(
        'submit(...encoders): a WebGL2 runtime has no command encoders; submit a frame, rt.frame().submit().',
      ),
    );
  }

  destroy(): void {
    if (this.owned)
      (this.gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
  }
}

/** A loaded program on WebGL2: its compute entries' pass programs, by entry and overrides. */
class GlProgramImpl implements Program {
  readonly recording = false;
  readonly #pipelines = new Map<string, GlComputePipelineImpl>();
  #render: GlRenderPrograms | undefined;

  constructor(
    readonly rt: GlRuntimeImpl,
    readonly manifest: Pack,
  ) {}

  compute(entry?: string, options?: { readonly constants?: Constants }): Promise<ComputePipeline> {
    try {
      return Promise.resolve(this.#compute(entry, options?.constants));
    } catch (err) {
      return Promise.reject(err as Error);
    }
  }

  #compute(entry: string | undefined, given: Constants | undefined): ComputePipeline {
    const e = entryOf(this.manifest, entry, 'compute');
    const constants = constantsOf(this.manifest, given);
    const key = `${e.name}:${constants?.key ?? ''}`;
    let p = this.#pipelines.get(key);
    if (p === undefined) {
      const program = this.manifest.gl?.computes?.[e.name];
      if (program === undefined)
        throw new TypeError(
          `The manifest carries no WebGL2 program for "${e.name}"${at(e)}; pack it again with this version of typeshade.`,
        );
      if ('none' in program)
        throw new TypeError(`"${e.name}"${at(e)} has no WebGL2 program: ${program.none}.`);
      p = new GlComputePipelineImpl(
        this,
        e,
        constants === undefined
          ? program
          : { ...program, vertex: pinOverrides(program.vertex, constants.values) },
      );
      this.#pipelines.set(key, p);
    }
    return p;
  }

  render(state: RenderState = {}): Promise<RenderPipeline> {
    try {
      return Promise.resolve(
        (this.#render ??= new GlRenderPrograms(this.rt.drawing, this.manifest)).render(state),
      );
    } catch (err) {
      return Promise.reject(err as Error);
    }
  }
}

/** A binding as a dispatch gives it: words packed for this dispatch, or a `Resident`. */
type Given =
  | { readonly kind: 'words'; readonly words: Uint32Array }
  | { readonly kind: 'uniform'; readonly value: unknown }
  | { readonly kind: 'texture'; readonly texture: WebGLTexture }
  | { readonly kind: 'sampler'; readonly sampler: WebGLSampler }
  | {
      readonly kind: 'resident';
      readonly state: ResidentArrayState;
      readonly layout: Layout;
      readonly writes: boolean;
    };

/** A compute entry on WebGL2: its pass program, dispatched with bindings by name into a frame. */
class GlComputePipelineImpl implements ComputePipeline {
  constructor(
    private readonly program: GlProgramImpl,
    private readonly e: PackEntry,
    private readonly gl: PackGlCompute,
  ) {}

  get entry(): string {
    return this.e.name;
  }

  dispatch(target: object, bindings: Bindings, workgroups: number | readonly number[]): void {
    if (!(target instanceof GlFrameImpl))
      throw new TypeError(
        `dispatch() on WebGL2 records into a frame of the runtime, rt.frame(); got ${describe(target)}.`,
      );
    const wg = workgroupsOf(this.e, workgroups);
    const given = this.#bind(bindings);
    const run = async (): Promise<void> => {
      const memory: Record<string, Uint32Array> = {};
      const uniforms: Record<string, unknown> = {};
      for (const [name, g] of given) {
        if (g.kind === 'words') memory[name] = g.words.slice();
        else if (g.kind === 'uniform') uniforms[name] = g.value;
        else if (g.kind === 'texture' || g.kind === 'sampler') continue;
        else {
          await g.state.sync();
          if (this.#space(name) === 'uniform') uniforms[name] = g.state.host;
          else memory[name] = packWords(g.layout, g.state.host, name);
        }
      }
      // A texture takes the sampler its calls pass it; one only loaded or measured is read
      // nearest and clamped, which a texture of integers needs to be complete at all.
      const textures: Record<string, { texture: WebGLTexture; sampler: WebGLSampler }> = {};
      for (const t of this.gl.textures ?? []) {
        const tex = given.get(t.name);
        const smp = t.sampler === null ? undefined : given.get(t.sampler);
        if (tex?.kind !== 'texture') continue;
        textures[t.name] = {
          texture: tex.texture,
          sampler: smp?.kind === 'sampler' ? smp.sampler : this.program.rt.drawing.nearest,
        };
      }
      await runGlCompute(this.program.rt.gl, this.gl, {
        workgroups: wg,
        memory,
        uniforms,
        textures,
      });
      for (const [name, g] of given) {
        if (g.kind !== 'resident' || !g.writes) continue;
        const out = readInto(new DataView(memory[name]!.buffer), 0, g.layout, g.state.host);
        if (g.layout.k === 's') g.state.host = out;
        g.state.fresh = 'host';
      }
    };
    target.record(
      run,
      [...given.values()].flatMap((g) => (g.kind === 'resident' && g.writes ? [g.state] : [])),
    );
  }

  #space(name: string): string | undefined {
    return this.program.manifest.bindings.find((b) => b.name === name)?.space;
  }

  /** Each binding the entry reaches, checked and packed now: a plain value as it is when the
   *  dispatch is recorded, as WebGPU's `writeBuffer` takes it. */
  #bind(values: Bindings): Map<string, Given> {
    const e = this.e;
    if (typeof values !== 'object' || values === null)
      throw new TypeError(
        `"${e.name}"${at(e)}: the bindings are ${describe(values)}, not an object.`,
      );
    const reached = (e.bindings ?? [])
      .map((x) => ({
        b: this.program.manifest.bindings.find((b) => b.name === x.name),
        writes: x.writes,
      }))
      .filter((x): x is { b: PackBinding; writes: boolean } => x.b !== undefined);
    const known = new Set(reached.map((x) => x.b.name));
    for (const name of Object.keys(values))
      if (!known.has(name))
        throw new TypeError(
          `"${e.name}"${at(e)} reaches no binding "${name}"; it binds ${
            [...known]
              .filter((n) => !n.startsWith('_'))
              .map((n) => `"${n}"`)
              .join(', ') || 'nothing'
          }.`,
        );
    const out = new Map<string, Given>();
    const states = new Map<ResidentArrayState, string>();
    for (const { b, writes } of reached) {
      const v = values[b.name];
      const where = `"${e.name}"${at(e)}, binding "${b.name}" (${b.type})`;
      if (v === undefined) throw new TypeError(`${where} is not given.`);
      if (b.resource.resourceKind === 'texture') {
        // A texture of the runtime is 2D; one of another dimension is the host's own, made for
        // the target the pass program binds it to.
        const dim = b.resource.textureDim ?? '2d';
        if (dim !== '2d' && v instanceof GlTextureImpl)
          throw new TypeError(
            `${where} takes a WebGLTexture made for ${GL_TARGET[dim] ?? dim}: a Texture of the WebGL2 runtime is 2D.`,
          );
        out.set(b.name, { kind: 'texture', texture: textureOf(v, where) });
        continue;
      }
      if (b.resource.resourceKind === 'sampler') {
        out.set(b.name, { kind: 'sampler', sampler: samplerOf(v, where) });
        continue;
      }
      if (b.layout === undefined)
        throw new TypeError(
          `${where} has no host value${b.noLayout !== undefined ? `: ${b.noLayout}` : ''}.`,
        );
      const layout = layoutFromPack(b.layout);
      const state = residentState(v);
      if (state !== undefined) {
        if (state.destroyed)
          throw new TypeError('This Resident was destroyed; make a new one with resident().');
        const twin = states.get(state);
        if (twin !== undefined)
          throw new TypeError(`${where} is the same resident array as binding "${twin}".`);
        states.set(state, b.name);
        out.set(b.name, { kind: 'resident', state, layout, writes });
        continue;
      }
      try {
        const words = packWords(layout, v, b.name);
        out.set(
          b.name,
          b.space === 'uniform'
            ? { kind: 'uniform', value: structuredClone(v) }
            : { kind: 'words', words },
        );
      } catch (err) {
        if (err instanceof Misfit) throw new TypeError(`${where}: ${err.path} ${err.problem}.`);
        throw err;
      }
    }
    return out;
  }
}

/** The WebGL2 target a texture of each dimension other than 2D is made for. */
const GL_TARGET: Readonly<Record<string, string>> = {
  '2d-array': 'TEXTURE_2D_ARRAY',
  '3d': 'TEXTURE_3D',
  cube: 'TEXTURE_CUBE_MAP',
};

/** `v` packed by `layout` into words. */
function packWords(layout: Layout, v: unknown, name: string): Uint32Array {
  const bytes = new ArrayBuffer(Math.ceil(byteSize(layout, v, name) / 4) * 4);
  pack(new DataView(bytes), 0, layout, v, name);
  return new Uint32Array(bytes);
}

/** A frame on WebGL2: the dispatches recorded into it, run in order at `submit()`. */
class GlFrameImpl implements Frame {
  readonly #runs: (() => Promise<void> | void)[] = [];
  readonly #written = new Set<ResidentArrayState>();
  #submitted = false;

  constructor(private readonly rt: GlRuntimeImpl) {}

  get encoder(): object {
    throw new TypeError('A frame on WebGL2 has no GPUCommandEncoder.');
  }

  record(run: () => Promise<void> | void, written: readonly ResidentArrayState[]): void {
    if (this.#submitted)
      throw new TypeError('This frame was submitted already; make a new one with rt.frame().');
    this.#runs.push(run);
    for (const s of written) this.#written.add(s);
  }

  dispatch<B>(
    pipeline: ComputePipeline<B>,
    bindings: NoInfer<B>,
    workgroups: number | readonly number[],
  ): void {
    pipeline.dispatch(this, bindings, workgroups);
  }

  pass(targets: PassTargets, record: (pass: RenderPass) => void): void {
    this.record(recordPass(this.rt.drawing, targets, record), []);
  }

  submit(): ReturnType<Frame['submit']> {
    if (this.#submitted)
      return Promise.reject(
        new TypeError('This frame was submitted already; make a new one with rt.frame().'),
      );
    this.#submitted = true;
    const runs = this.#runs;
    const written = [...this.#written];
    // In the order of every call and frame before it, so a `Resident.read()` made after this
    // call reads what the frame wrote.
    const done = kernelQueue.run(async () => {
      for (const run of runs) await run();
      return { console: [] };
    });
    // A frame nobody awaits keeps its error on what it writes, for `read()` to throw.
    done.then(
      () => written.forEach((s) => (s.error = undefined)),
      (err: unknown) => written.forEach((s) => (s.error = err)),
    );
    return done;
  }
}
