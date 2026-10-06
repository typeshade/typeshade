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
// A draw on WebGL2 is a later step of change 0054: `render()`, `texture()`, `sampler()`, a
// frame's `pass()` and `encoder`, and `submit(encoders)` each throw a `TypeError` that says so.

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
} from './program.js';
import type { Texture, Sampler } from './resources.js';
import type { Frame, LoadOptions, Runtime } from './runtime.js';

/** What the WebGL2 tier cannot do until the step of change 0054 that draws. */
const noDraw = (what: string): TypeError =>
  new TypeError(
    `${what}: the WebGL2 tier of the program runtime runs compute entries only; it does not draw yet.`,
  );

/** The program runtime on a WebGL2 context. */
export class GlRuntimeImpl implements Runtime<WebGL2RenderingContext> {
  readonly tier = 'webgl2';

  constructor(
    readonly gl: WebGL2RenderingContext,
    private readonly owned: boolean,
  ) {}

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

  texture(): Texture {
    throw noDraw('texture()');
  }

  sampler(): Sampler {
    throw noDraw('sampler()');
  }

  frame(): Frame {
    return new GlFrameImpl();
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
        constants === undefined ? program : specialized(program, constants.values),
      );
      this.#pipelines.set(key, p);
    }
    return p;
  }

  render(): Promise<RenderPipeline> {
    return Promise.reject(noDraw('render()'));
  }
}

/** `p` with each override named in `values` pinned: GLSL ES 3.00 has no specialization
 *  constants, so the pass program declares each override as a `#define` under `#ifndef`, and a
 *  `#define` before it pins the value, as the GLSL writer's `overrideValues` does. */
function specialized(p: PackGlCompute, values: Readonly<Record<string, number>>): PackGlCompute {
  const defines = Object.entries(values)
    .map(([name, v]) => `#define ${name} ${glslLiteral(p.vertex, name, v)}\n`)
    .join('');
  const nl = p.vertex.indexOf('\n') + 1;
  return { ...p, vertex: p.vertex.slice(0, nl) + defines + p.vertex.slice(nl) };
}

/** `v` as the GLSL literal of the override `name`, typed as the pass program's default is. */
function glslLiteral(src: string, name: string, v: number): string {
  const d = new RegExp(`#define ${name} (\\S+)`).exec(src)?.[1] ?? '';
  if (d.endsWith('u')) return `${v >>> 0}u`;
  if (d === 'true' || d === 'false') return v === 0 ? 'false' : 'true';
  if (/[.eE]/.test(d)) {
    const s = Object.is(v, -0) ? '-0' : String(v);
    return /[.eE]/.test(s) ? s : `${s}.0`;
  }
  return String(v | 0);
}

/** A binding as a dispatch gives it: words packed for this dispatch, or a `Resident`. */
type Given =
  | { readonly kind: 'words'; readonly words: Uint32Array }
  | { readonly kind: 'uniform'; readonly value: unknown }
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
        else {
          await g.state.sync();
          if (this.#space(name) === 'uniform') uniforms[name] = g.state.host;
          else memory[name] = packWords(g.layout, g.state.host, name);
        }
      }
      await runGlCompute(this.program.rt.gl, this.gl, { workgroups: wg, memory, uniforms });
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

/** `v` packed by `layout` into words. */
function packWords(layout: Layout, v: unknown, name: string): Uint32Array {
  const bytes = new ArrayBuffer(Math.ceil(byteSize(layout, v, name) / 4) * 4);
  pack(new DataView(bytes), 0, layout, v, name);
  return new Uint32Array(bytes);
}

/** A frame on WebGL2: the dispatches recorded into it, run in order at `submit()`. */
class GlFrameImpl implements Frame {
  readonly #runs: (() => Promise<void>)[] = [];
  readonly #written = new Set<ResidentArrayState>();
  #submitted = false;

  get encoder(): object {
    throw new TypeError('A frame on WebGL2 has no GPUCommandEncoder.');
  }

  record(run: () => Promise<void>, written: readonly ResidentArrayState[]): void {
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

  pass(): void {
    throw noDraw('pass()');
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
