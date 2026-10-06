// A loaded program (change 0025 section 2, Rule 11.11): the manifest on one runtime, its pipelines cached
// by entry and state, and the binding of a draw's or a dispatch's values by name, packed by the
// manifest's layouts. It automates what the compiler knows and nothing else: fixed-function
// state is the host's, written in `RenderState`.

import type { ConsoleLog } from '../core/console.js';
import {
  byteSize,
  describe,
  Misfit,
  pack,
  type GpuDevice,
  type Layout,
} from '../core/host-entry.js';
import { residentState } from '../core/resident.js';
import {
  layoutFromPack,
  type Pack,
  type PackBindings,
  type PackBinding,
  type PackEntry,
  type PackOverride,
} from '../core/manifest-types.js';
import {
  BUFFER,
  STAGE,
  type BindGroupLayout,
  type Buffer,
  type ComputePassEncoder,
  type Device,
  type RenderPassEncoder,
  type ShaderModule,
} from './gpu.js';
import { SamplerImpl, TextureImpl } from './resources.js';
import type { RuntimeImpl } from './runtime.js';

/** The values a draw or a dispatch binds, by the names the source declares: a `Texture`, a
 *  `Sampler`, a plain host value (Rule 8.21) the runtime packs by the binding's layout, a
 *  `Resident`, or the host's own `GPUBuffer`, `GPUTexture`, `GPUTextureView` or `GPUSampler`.
 *
 *  A plain value is packed into a buffer of its own at each draw and each dispatch, so the draws
 *  of one pass that bind different values of one binding each read their own. The buffers come
 *  back to the runtime once the frame has run. A `Resident` is one buffer every draw shares. The
 *  bindings a draw names are the ones its entries reach: a name they do not reach is refused. */
export type Bindings = Readonly<Record<string, unknown>>;

/** A colour target of a render pipeline: its format, and its blending when it blends. `blend`
 *  and `writeMask` are WebGPU's `GPUBlendState` and `GPUColorWrite` flags; omitted, the target
 *  does not blend and every channel is written. */
export type TargetState =
  | string
  | {
      readonly format: string;
      readonly blend?: object;
      readonly writeMask?: number;
    };

/** The values of a program's overrides, by the names the source declares (surface §15): a
 *  `number`, or a `boolean` for a `bool`. `RenderState.constants` and the `constants` of
 *  `Program.compute` take it. */
type Constants = Readonly<Record<string, number | boolean>>;

/** The fixed-function state of a render pipeline, which the host writes (change 0025): the
 *  compiler knows its entries' inputs and outputs, and the runtime fills and checks those. */
export interface RenderState {
  /** The vertex entry; the program's only one when omitted. */
  readonly vertex?: string;
  /** The fragment entry; the program's only one when omitted, none for a depth-only pass. */
  readonly fragment?: string | null;
  /** One per colour output, by location. Omitted: `rgba8unorm` for each. */
  readonly targets?: readonly TargetState[];
  /** The depth attachment's format, and how the pipeline tests and writes it: `compare`
   *  defaults to `'less'` and `write` to `true`. A reversed projection compares `'greater'`,
   *  and a pass drawn behind everything else (a sky) compares `'always'` and does not write.
   *  Omitted: no depth test, for a pass with no depth attachment. */
  readonly depth?: {
    readonly format: string;
    readonly compare?: string;
    readonly write?: boolean;
  };
  /** What the vertices make: `topology` defaults to `'triangle-list'`, `cullMode` to `'none'`
   *  and `frontFace` to `'ccw'`. */
  readonly primitive?: {
    readonly topology?: string;
    readonly cullMode?: 'none' | 'front' | 'back';
    readonly frontFace?: 'ccw' | 'cw';
  };
  /** The sample count of the targets it draws into: 1 when omitted, 4 for a multisampled
   *  target. */
  readonly multisample?: { readonly count?: number };
  /** The values of the program's overrides (surface §15), by the names the source declares:
   *  `{ quality: 3 }`. The vertex and the fragment stage are each created with them, as WebGPU's
   *  `constants`. An override the record leaves out takes the default its declaration states,
   *  so omitted, every override does. An `f32` takes a finite number no larger than
   *  3.4028234663852886e38 in magnitude, an `i32` or a `u32` a whole number in its range, and a
   *  `bool` a boolean or a number, where 0 is false. A name the program does not declare is a
   *  `TypeError` that names the program's overrides, and a value its type cannot hold one that
   *  says what the type takes. Two states that differ in an override are two pipelines, and the
   *  same values give the same pipeline back. */
  readonly constants?: Constants;
}

/** What a draw draws: `count` vertices (or indices), `instances` times, from the vertex buffer
 *  the manifest lays out. A typed array is uploaded at the draw; a `GPUBuffer` is bound as is. */
export interface Geometry {
  /** How many vertices, or indices when `indices` is given. */
  readonly count: number;
  /** How many instances: 1 when omitted. */
  readonly instances?: number;
  /** The vertex buffer, laid out as the manifest's vertex entry reads it (its `@location`
   *  inputs, tightly packed): a typed array, uploaded at each draw, or the host's `GPUBuffer`.
   *  Omitted for a vertex entry with no `@location` input, such as a full-screen triangle drawn
   *  from `vertex_index`. */
  readonly vertices?: ArrayBufferView | object;
  /** The index buffer: a `Uint16Array` or `Uint32Array`, uploaded at each draw, or
   *  `{ buffer, format }`, the host's `GPUBuffer` bound as it is. */
  readonly indices?:
    Uint16Array | Uint32Array | { readonly buffer: object; readonly format: 'uint16' | 'uint32' };
}

/** The entry names a `RenderState` may give for the program whose entries are `E`. */
type EntryNames<E extends PackBindings> = {
  readonly vertex?: keyof E & string;
  readonly fragment?: (keyof E & string) | null;
};

/** The bindings of entry `X` of `E`, or of any one entry when `X` names none: the program's only
 *  entry of the stage, which the types do not know. */
type EntrySide<E extends PackBindings, X> = [X] extends [keyof E] ? E[X] : E[keyof E];

/** `A` and `B` as one record, a name both have taking `A`'s type: the two entries of a render
 *  pipeline give a binding they share one type, so a refusal names it once. */
type Merged<A, B> = {
  readonly [K in keyof A | keyof B]: K extends keyof A ? A[K] : K extends keyof B ? B[K] : never;
};

/** The bindings a render pipeline of `E` under `S` reaches: its vertex entry's and its fragment
 *  entry's (change 0030). */
type RenderBindings<E extends PackBindings, S> = Merged<
  EntrySide<E, S extends { readonly vertex: infer V } ? V : undefined>,
  S extends { readonly fragment: null }
    ? Record<never, never>
    : EntrySide<E, S extends { readonly fragment: infer F } ? F : undefined>
>;

/** The bindings entry `K` of the manifest `P` reaches, as a draw or a dispatch passes them
 *  (change 0030): `BindingsOf<typeof mesh, 'vs'>`. An untyped manifest gives {@link Bindings}.
 *
 *  Exported from `typeshade/runtime`. */
export type BindingsOf<P extends Pack, K extends string> =
  P extends Pack<infer E> ? (K extends keyof E ? E[K] : never) : never;

/** A program loaded on a runtime: its manifest and its pipelines. `E` is the bindings each entry
 *  reaches, from the manifest's type (change 0030); an untyped manifest takes any. */
export interface Program<E extends PackBindings = PackBindings> {
  readonly manifest: Pack<E>;
  /** Whether its entries record their `console.*` calls. */
  readonly recording: boolean;
  /** The pipeline of a `@compute` entry, cached: the program's only one when `entry` is
   *  omitted. `options.constants` sets the program's overrides for this pipeline, as
   *  `RenderState.constants` does for a render pipeline (an override it leaves out takes its
   *  declared default), and two sets of values are two pipelines. The pipeline's dispatches take
   *  the bindings the entry reaches. */
  compute<K extends keyof E & string = keyof E & string>(
    entry?: K,
    options?: { readonly constants?: Constants },
  ): Promise<ComputePipeline<E[K]>>;
  /** The pipeline of a vertex entry and a fragment entry under `state`, cached. `state`
   *  defaults to `{}`: the program's only vertex and fragment entry, and every other field at
   *  its default. The pipeline's draws take the bindings its two entries reach. */
  render<const S extends RenderState & EntryNames<E> = Record<never, never>>(
    state?: S,
  ): Promise<RenderPipeline<RenderBindings<E, S>>>;
}

/** A compute pipeline: one entry, dispatched with bindings by name. `B` is the bindings the
 *  entry reaches (change 0030). */
export interface ComputePipeline<B = Bindings> {
  readonly entry: string;
  /** Record a dispatch into the host's encoder or compute pass, or a frame's. */
  dispatch(target: object, bindings: B, workgroups: number | readonly number[]): void;
}

/** A render pipeline: a vertex entry, a fragment entry and the state, drawn with bindings by
 *  name. `B` is the bindings the two entries reach (change 0030). */
export interface RenderPipeline<B = Bindings> {
  readonly vertex: string;
  readonly fragment: string | null;
  /** Record a draw into the host's render pass, or a frame's. */
  draw(pass: object, bindings: B, geometry: Geometry): void;
}

const RESOURCE_KINDS = new Set(['uniform-buffer', 'storage-buffer']);

/** The line an entry or a binding is declared on, for a refusal: ` (brick.shade.ts:12)`. */
const at = (e: PackEntry | undefined): string =>
  e?.line === undefined ? '' : ` (${e.line.file.split(/[\\/]/).pop()}:${e.line.line})`;

/** The largest magnitude an `f32` holds; WebGPU refuses an override value past it. */
const F32_MAX = 3.4028234663852886e38;

/** What WebGPU's `constants` takes for `v`, the value given for the override `o`: a number, 0 or 1
 *  for a `bool`. A value the override's type cannot hold is a `TypeError` that says what the type
 *  takes. WebGPU would report a validation error that names nothing of the source, or convert the
 *  value silently: a fraction to an `i32`, a string, `true`. */
function constantOf(o: PackOverride, v: unknown): number {
  const int = o.type === 'i32' || o.type === 'u32';
  const lo = o.type === 'u32' ? 0 : int ? -0x80000000 : -F32_MAX;
  const hi = o.type === 'u32' ? 0xffffffff : int ? 0x7fffffff : F32_MAX;
  if (o.type === 'bool') {
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number' && Number.isFinite(v)) return v === 0 ? 0 : 1;
  } else if (typeof v === 'number' && v >= lo && v <= hi && (!int || Number.isInteger(v)))
    // An integer has no -0. An f32 keeps it, which the cache's key tells from 0.
    return int ? v || 0 : v;
  const takes =
    o.type === 'bool'
      ? 'a boolean or a finite number, where 0 is false'
      : int
        ? `a whole number from ${lo} to ${hi}`
        : `a finite number no larger than ${F32_MAX} in magnitude`;
  throw new TypeError(
    `The override "${o.name}" (${o.type}) takes ${takes}; got ${v === undefined ? 'undefined' : describe(v)}.`,
  );
}

/** `GPUBindGroupLayoutEntry` for a manifest binding, visible to `visibility`. */
function layoutEntry(b: PackBinding, visibility: number): object {
  const r = b.resource;
  const base = { binding: b.binding, visibility };
  switch (r.resourceKind) {
    case 'uniform-buffer':
      return { ...base, buffer: { type: 'uniform' } };
    case 'storage-buffer':
      return {
        ...base,
        buffer: { type: b.access === 'read_write' ? 'storage' : 'read-only-storage' },
      };
    case 'sampler':
      return {
        ...base,
        sampler: { type: r.samplerComparison === true ? 'comparison' : 'filtering' },
      };
    case 'storage-texture':
      return {
        ...base,
        storageTexture: {
          access: r.storageAccess ?? 'write-only',
          format: r.storageFormat,
          viewDimension: r.textureDim === '2d-ms' ? '2d' : (r.textureDim ?? '2d'),
        },
      };
    case 'texture': {
      // The sample type the manifest gives, from the calls that read the texture (Rule 11.10): an
      // `f32` texture no call pairs with a sampler is 'unfilterable-float', which takes every
      // format 'float' takes and the 32-bit float ones it refuses. A manifest written before it
      // gave one lays a texture out from its element, and a multisampled one 'unfilterable-float',
      // which WebGPU requires since no sampler filters one (#414).
      const sampleType =
        r.sampleType ??
        (r.textureDepth === true
          ? 'depth'
          : r.textureElem === 'u32'
            ? 'uint'
            : r.textureElem === 'i32'
              ? 'sint'
              : r.textureDim === '2d-ms'
                ? 'unfilterable-float'
                : 'float');
      return {
        ...base,
        texture: {
          sampleType,
          viewDimension: r.textureDim === '2d-ms' ? '2d' : (r.textureDim ?? '2d'),
          multisampled: r.textureDim === '2d-ms',
        },
      };
    }
  }
}

/** A pool of buffers the runtime reuses: a buffer taken during a frame comes back once the
 *  queue has run the frame, so a frame whose shapes repeat allocates nothing. */
export class BufferPool {
  readonly #free = new Map<string, Buffer[]>();
  #taken: [string, Buffer][] = [];
  constructor(private readonly device: Device) {}

  take(size: number, usage: number): Buffer {
    const rounded = Math.max(16, Math.ceil(size / 16) * 16);
    const key = `${usage}:${rounded}`;
    const b = this.#free.get(key)?.pop() ?? this.device.createBuffer({ size: rounded, usage });
    this.#taken.push([key, b]);
    return b;
  }

  /** Hand back, once the queue is done with them, what was taken since the last release. */
  release(done: Promise<unknown>): void {
    const taken = this.#taken;
    this.#taken = [];
    void done.then(() => {
      for (const [key, b] of taken) {
        let list = this.#free.get(key);
        if (list === undefined) this.#free.set(key, (list = []));
        list.push(b);
      }
    });
  }

  destroy(): void {
    for (const list of this.#free.values()) for (const b of list) b.destroy();
    for (const [, b] of this.#taken) b.destroy();
    this.#free.clear();
    this.#taken = [];
  }
}

/** A stable id per resource object, for the bind group cache's key. */
const ids = new WeakMap<object, number>();
let nextId = 1;
const idOf = (o: object): number => {
  let id = ids.get(o);
  if (id === undefined) ids.set(o, (id = nextId++));
  return id;
};

interface Slot {
  readonly binding: PackBinding;
  readonly layout?: Layout;
}

interface PipelineShape {
  /** Per group index, its layout and its slots in binding order. */
  readonly groups: readonly {
    readonly index: number;
    readonly layout: BindGroupLayout;
    readonly slots: readonly Slot[];
  }[];
  readonly pipelineLayout: object;
  /** The entries whose calls the console buffer records, when the program records. */
  readonly console?: {
    readonly slot: PackBinding;
    readonly log: ConsoleLog;
    readonly entry: string;
  };
}

export class ProgramImpl implements Program {
  readonly #wgsl: string;
  readonly #bindings: ReadonlyMap<string, PackBinding>;
  readonly #log: ConsoleLog | undefined;
  #module: ShaderModule | undefined;
  readonly #pipelines = new Map<string, Promise<ComputePipelineImpl | RenderPipelineImpl>>();
  readonly #layouts = new Map<string, BindGroupLayout>();

  constructor(
    readonly rt: RuntimeImpl,
    readonly manifest: Pack,
    readonly recording: boolean,
  ) {
    const recorded = recording ? manifest.console : undefined;
    this.#wgsl = recorded?.wgsl ?? manifest.wgsl;
    this.#bindings = new Map((recorded?.bindings ?? manifest.bindings).map((b) => [b.name, b]));
    this.#log = recorded?.log;
  }

  get device(): Device {
    return this.rt.gpu;
  }

  #shaderModule(): ShaderModule {
    return (this.#module ??= this.device.createShaderModule({ code: this.#wgsl }));
  }

  #entry(name: string | undefined, stage: string): PackEntry {
    const of = this.manifest.entries.filter((e) => e.stage === stage);
    if (name === undefined) {
      if (of.length === 1) return of[0]!;
      throw new TypeError(
        of.length === 0
          ? `The program has no @${stage} entry.`
          : `The program has ${of.length} @${stage} entries (${of.map((e) => e.name).join(', ')}); name the one to use.`,
      );
    }
    const e = of.find((x) => x.name === name);
    if (e === undefined)
      throw new TypeError(
        `The program has no @${stage} entry "${name}"; its @${stage} entries are ${of.map((x) => `"${x.name}"`).join(', ') || 'none'}.`,
      );
    return e;
  }

  /** The layout a pipeline of `entries` binds: each binding they reach, visible to the stages
   *  that reach it, the console buffer too when the program records. */
  #shape(entries: readonly PackEntry[]): PipelineShape {
    const visibility = new Map<string, number>();
    for (const e of entries)
      for (const b of e.bindings ?? [])
        visibility.set(
          b.name,
          (visibility.get(b.name) ?? 0) | STAGE[e.stage as keyof typeof STAGE],
        );
    let console: PipelineShape['console'];
    if (this.#log !== undefined) {
      const slot = this.#bindings.get('_console');
      const recorder = entries.find((e) => e.stage === 'compute' || e.stage === 'fragment');
      if (slot !== undefined && recorder !== undefined) {
        visibility.set('_console', STAGE[recorder.stage as keyof typeof STAGE]);
        console = { slot, log: this.#log, entry: recorder.name };
      }
    }
    const byGroup = new Map<number, Slot[]>();
    for (const [name, vis] of visibility) {
      const b = this.#bindings.get(name);
      if (b === undefined) continue;
      let slots = byGroup.get(b.group);
      if (slots === undefined) byGroup.set(b.group, (slots = []));
      slots.push({
        binding: b,
        ...(b.layout !== undefined ? { layout: layoutFromPack(b.layout) } : {}),
      });
      void vis;
    }
    const maxGroup = Math.max(-1, ...byGroup.keys());
    const groups: { index: number; layout: BindGroupLayout; slots: Slot[] }[] = [];
    const layouts: BindGroupLayout[] = [];
    for (let g = 0; g <= maxGroup; g++) {
      const slots = (byGroup.get(g) ?? []).sort((a, b) => a.binding.binding - b.binding.binding);
      const entriesOf = slots.map((s) => layoutEntry(s.binding, visibility.get(s.binding.name)!));
      const key = JSON.stringify(entriesOf);
      let layout = this.#layouts.get(key);
      if (layout === undefined)
        this.#layouts.set(
          key,
          (layout = this.device.createBindGroupLayout({ entries: entriesOf })),
        );
      layouts.push(layout);
      groups.push({ index: g, layout, slots });
    }
    return {
      groups,
      pipelineLayout: this.device.createPipelineLayout({ bindGroupLayouts: layouts }),
      ...(console !== undefined ? { console } : {}),
    };
  }

  /** The override values a pipeline is created with, checked against the manifest's `overrides`:
   *  what WebGPU's `constants` takes, in the order the program declares its overrides, and the
   *  cache's key, so the same values give one pipeline whatever order or spelling the host used.
   *  `undefined` when the host gives none. A name the program does not declare, and a value its
   *  type cannot hold, are a `TypeError` (WebGPU's own error names nothing of the source). */
  #constants(
    given: Constants | undefined,
  ): { readonly values: Record<string, number>; readonly key: string } | undefined {
    if (given === undefined) return undefined;
    if (typeof given !== 'object' || given === null || Array.isArray(given))
      throw new TypeError(
        `The constants are ${describe(given)}, not an object of override names and values.`,
      );
    const declared = this.manifest.overrides;
    const undeclared = Object.keys(given).find((n) => !declared.some((o) => o.name === n));
    if (undeclared !== undefined)
      throw new TypeError(
        `The program has no override "${undeclared}"; its overrides are ${declared.map((o) => `"${o.name}" (${o.type})`).join(', ') || 'none'}.`,
      );
    const values: Record<string, number> = {};
    let key = '';
    for (const o of declared) {
      if (!Object.hasOwn(given, o.name)) continue;
      const v = (values[o.name] = constantOf(o, given[o.name]));
      key += `${o.name}=${Object.is(v, -0) ? '-0' : v};`;
    }
    return key === '' ? undefined : { values, key };
  }

  compute(entry?: string, options?: { readonly constants?: Constants }): Promise<ComputePipeline> {
    try {
      return this.#compute(entry, options?.constants);
    } catch (err) {
      return Promise.reject(err as Error);
    }
  }

  #compute(entry: string | undefined, given: Constants | undefined): Promise<ComputePipeline> {
    const e = this.#entry(entry, 'compute');
    const constants = this.#constants(given);
    const key = `compute:${e.name}:${constants?.key ?? ''}`;
    let p = this.#pipelines.get(key);
    if (p === undefined) {
      const shape = this.#shape([e]);
      p = this.device
        .createComputePipelineAsync({
          layout: shape.pipelineLayout,
          compute: {
            module: this.#shaderModule(),
            entryPoint: e.name,
            ...(constants !== undefined ? { constants: constants.values } : {}),
          },
        })
        .then(
          (gpu) => new ComputePipelineImpl(this, e, shape, gpu),
          (err: unknown) => {
            throw new Error(
              `The compute pipeline of "${e.name}"${at(e)} could not be created: ${messageOf(err)}`,
            );
          },
        );
      this.#pipelines.set(key, p);
    }
    return p as Promise<ComputePipeline>;
  }

  render(state: RenderState = {}): Promise<RenderPipeline> {
    try {
      return this.#render(state);
    } catch (err) {
      return Promise.reject(err as Error);
    }
  }

  #render(state: RenderState): Promise<RenderPipeline> {
    const vs = this.#entry(state.vertex, 'vertex');
    const fs =
      state.fragment === null ? undefined : this.#entry(state.fragment ?? undefined, 'fragment');
    const constants = this.#constants(state.constants);
    const key = `render:${JSON.stringify({ ...state, vertex: vs.name, fragment: fs?.name ?? null, constants: constants?.key })}`;
    let p = this.#pipelines.get(key);
    if (p === undefined) {
      const shape = this.#shape(fs === undefined ? [vs] : [vs, fs]);
      const targets = fs === undefined ? [] : this.#targets(fs, state.targets);
      const vertex = vs.vertex;
      // Every stage is created with the same values: WebGPU takes a name any stage's module
      // declares, whether or not that stage's entry reads it.
      const stage = constants === undefined ? {} : { constants: constants.values };
      p = this.device
        .createRenderPipelineAsync({
          layout: shape.pipelineLayout,
          vertex: {
            module: this.#shaderModule(),
            entryPoint: vs.name,
            buffers:
              vertex === undefined
                ? []
                : [
                    {
                      arrayStride: vertex.arrayStride,
                      attributes: vertex.attributes.map((a) => ({
                        shaderLocation: a.location,
                        offset: a.offset,
                        format: a.format,
                      })),
                    },
                  ],
            ...stage,
          },
          ...(fs !== undefined
            ? { fragment: { module: this.#shaderModule(), entryPoint: fs.name, targets, ...stage } }
            : {}),
          primitive: {
            topology: state.primitive?.topology ?? 'triangle-list',
            cullMode: state.primitive?.cullMode ?? 'none',
            frontFace: state.primitive?.frontFace ?? 'ccw',
          },
          ...(state.depth !== undefined
            ? {
                depthStencil: {
                  format: state.depth.format,
                  depthCompare: state.depth.compare ?? 'less',
                  depthWriteEnabled: state.depth.write ?? true,
                },
              }
            : {}),
          ...(state.multisample?.count !== undefined
            ? { multisample: { count: state.multisample.count } }
            : {}),
        })
        .then(
          (gpu) => new RenderPipelineImpl(this, vs, fs, shape, gpu, vertex !== undefined),
          (err: unknown) => {
            throw new Error(
              `The render pipeline of "${vs.name}"${fs !== undefined ? ` and "${fs.name}"` : ''}${at(fs ?? vs)} could not be created: ${messageOf(err)}`,
            );
          },
        );
      this.#pipelines.set(key, p);
    }
    return p as Promise<RenderPipeline>;
  }

  /** Each colour output's target, by location, its format checked against the output's type. */
  #targets(fs: PackEntry, given: readonly TargetState[] | undefined): object[] {
    const outputs = (fs.outputs ?? []).filter((o) => o.location !== undefined);
    const count = Math.max(0, ...outputs.map((o) => o.location! + 1));
    const out: object[] = [];
    for (let loc = 0; loc < count; loc++) {
      const t = given?.[loc] ?? 'rgba8unorm';
      const target = typeof t === 'string' ? { format: t } : t;
      const o = outputs.find((x) => x.location === loc);
      if (o !== undefined) {
        const wantsInt = /(^|<)(u32|i32)\b/.test(o.type);
        const isInt = /(uint|sint)$/.test(target.format);
        if (wantsInt !== isInt)
          throw new TypeError(
            `"${fs.name}"${at(fs)} writes ${o.type} at @location(${loc}), which a ${target.format} target cannot hold; use ${wantsInt ? 'an integer format such as rgba32uint' : 'a float or normalized format such as rgba8unorm'}.`,
          );
      }
      out.push(target);
    }
    return out;
  }

  /** The bind groups for `values` under `shape`, the console buffer bound where it records. */
  bindGroups(
    shape: PipelineShape,
    entry: PackEntry,
    values: Bindings,
    consoleBuffer: Buffer | undefined,
  ): object[] {
    if (typeof values !== 'object' || values === null)
      throw new TypeError(
        `"${entry.name}"${at(entry)}: the bindings are ${describe(values)}, not an object.`,
      );
    const known = new Set<string>();
    for (const g of shape.groups) for (const s of g.slots) known.add(s.binding.name);
    for (const name of Object.keys(values))
      if (!known.has(name))
        throw new TypeError(
          `"${entry.name}"${at(entry)} reaches no binding "${name}"; it binds ${
            [...known]
              .filter((n) => !n.startsWith('_'))
              .map((n) => `"${n}"`)
              .join(', ') || 'nothing'
          }.`,
        );
    return shape.groups.map((g) => {
      const resources: object[] = [];
      const key: number[] = [];
      for (const s of g.slots) {
        const r = this.#resource(s, entry, values, consoleBuffer);
        resources.push({ binding: s.binding.binding, resource: r });
        key.push(idOf('buffer' in r ? (r as { buffer: object }).buffer : r));
      }
      return this.rt.bindGroup(g.layout, key.join(','), resources);
    });
  }

  #resource(
    s: Slot,
    entry: PackEntry,
    values: Bindings,
    consoleBuffer: Buffer | undefined,
  ): object {
    const b = s.binding;
    if (b.name === '_console') return { buffer: consoleBuffer! };
    if (b.name === '_fp64') return this.rt.guardView();
    const v = values[b.name];
    const where = `"${entry.name}"${at(entry)}, binding "${b.name}" (${b.type})`;
    if (v === undefined) throw new TypeError(`${where} is not given.`);
    if (RESOURCE_KINDS.has(b.resource.resourceKind)) {
      if (isGpuBuffer(v)) return { buffer: v };
      const state = residentState(v);
      if (state !== undefined) {
        // One buffer of both layers (change 0025): the Resident's, uploaded on its first use.
        if (s.layout === undefined)
          throw new TypeError(
            `${where} has no host value${b.noLayout !== undefined ? `: ${b.noLayout}` : ''}.`,
          );
        const layout = s.layout;
        const writes = entry.bindings?.find((x) => x.name === b.name)?.writes ?? false;
        try {
          return {
            buffer: state.bufferFor(
              this.device as unknown as GpuDevice,
              layout,
              () => {
                const bytes = new ArrayBuffer(byteSize(layout, state.host, b.name));
                pack(new DataView(bytes), 0, layout, state.host, b.name);
                return bytes;
              },
              writes,
            ),
          };
        } catch (err) {
          if (err instanceof Misfit) throw new TypeError(`${where}: ${err.path} ${err.problem}.`);
          throw err;
        }
      }
      if (s.layout === undefined)
        throw new TypeError(
          `${where} has no host value${b.noLayout !== undefined ? `: ${b.noLayout}` : ''}; pass a GPUBuffer.`,
        );
      return this.#packed(s.layout, v, b, where);
    }
    if (v instanceof TextureImpl) return v.view();
    if (v instanceof SamplerImpl) return v.sampler;
    if (typeof v === 'object' && v !== null) {
      if ('createView' in v) return (v as { createView(): object }).createView();
      return v;
    }
    throw new TypeError(
      `${where} takes a Texture, a Sampler or the host's GPU object; got ${describe(v)}.`,
    );
  }

  /** The binding of `v` packed into a buffer the pool hands out. The pool rounds a buffer up
   *  to reuse it, so a storage binding names its size: WGSL's `arrayLength` is the bound size
   *  over the stride, and the whole buffer held an array of 8 where the host passed 5 (#367). */
  #packed(
    l: Layout,
    v: unknown,
    b: PackBinding,
    where: string,
  ): { readonly buffer: Buffer; readonly size?: number } {
    let bytes: ArrayBuffer;
    try {
      const size = byteSize(l, v, b.name);
      bytes = new ArrayBuffer(size);
      pack(new DataView(bytes), 0, l, v, b.name);
    } catch (err) {
      if (err instanceof Misfit) throw new TypeError(`${where}: ${err.path} ${err.problem}.`);
      throw err;
    }
    const usage =
      (b.resource.resourceKind === 'uniform-buffer' ? BUFFER.UNIFORM : BUFFER.STORAGE) |
      BUFFER.COPY_DST;
    const buffer = this.rt.pool.take(bytes.byteLength, usage);
    this.device.queue.writeBuffer(buffer, 0, bytes);
    return b.resource.resourceKind === 'uniform-buffer'
      ? { buffer }
      : { buffer, size: bytes.byteLength };
  }
}

const isGpuBuffer = (v: unknown): v is Buffer =>
  typeof v === 'object' && v !== null && 'mapAsync' in v && 'getMappedRange' in v;

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** A compute pass the dispatch records into: the host's, or one it begins in the host's
 *  encoder. */
function computePass(target: object): { pass: ComputePassEncoder; end: boolean } {
  if ('dispatchWorkgroups' in target) return { pass: target as ComputePassEncoder, end: false };
  if ('encoder' in target && 'pass' in target)
    return {
      pass: (
        target as { encoder: { beginComputePass(): ComputePassEncoder } }
      ).encoder.beginComputePass(),
      end: true,
    };
  if ('beginComputePass' in target)
    return {
      pass: (target as { beginComputePass(): ComputePassEncoder }).beginComputePass(),
      end: true,
    };
  throw new TypeError(
    `dispatch() records into a GPUCommandEncoder, a GPUComputePassEncoder or a Frame; got ${describe(target)}.`,
  );
}

export class ComputePipelineImpl implements ComputePipeline {
  constructor(
    private readonly program: ProgramImpl,
    private readonly e: PackEntry,
    private readonly shape: PipelineShape,
    private readonly gpu: object,
  ) {}

  get entry(): string {
    return this.e.name;
  }

  dispatch(target: object, bindings: Bindings, workgroups: number | readonly number[]): void {
    const wg = typeof workgroups === 'number' ? [workgroups] : workgroups;
    if (wg.length < 1 || wg.length > 3 || !wg.every((n) => Number.isInteger(n) && n >= 0))
      throw new TypeError(
        `"${this.e.name}"${at(this.e)}: workgroups is ${describe(workgroups)}; give n or [x, y?, z?], whole numbers.`,
      );
    const rt = this.program.rt;
    const recorder = this.shape.console;
    const consoleBuffer =
      recorder !== undefined ? rt.consoleBuffer(recorder.log, recorder.entry) : undefined;
    const groups = this.program.bindGroups(this.shape, this.e, bindings, consoleBuffer);
    const { pass, end } = computePass(target);
    pass.setPipeline(this.gpu);
    groups.forEach((g, i) => pass.setBindGroup(i, g));
    pass.dispatchWorkgroups(wg[0]!, wg[1] ?? 1, wg[2] ?? 1);
    if (end) pass.end();
  }
}

export class RenderPipelineImpl implements RenderPipeline {
  constructor(
    private readonly program: ProgramImpl,
    private readonly vs: PackEntry,
    private readonly fs: PackEntry | undefined,
    private readonly shape: PipelineShape,
    private readonly gpu: object,
    private readonly takesVertices: boolean,
  ) {}

  get vertex(): string {
    return this.vs.name;
  }
  get fragment(): string | null {
    return this.fs?.name ?? null;
  }

  draw(target: object, bindings: Bindings, geometry: Geometry): void {
    const pass = ('raw' in target ? (target as { raw: object }).raw : target) as RenderPassEncoder;
    if (typeof pass.setPipeline !== 'function' || typeof pass.draw !== 'function')
      throw new TypeError(
        `draw() records into a GPURenderPassEncoder or a frame's pass; got ${describe(target)}.`,
      );
    const entry = this.fs ?? this.vs;
    if (
      typeof geometry !== 'object' ||
      geometry === null ||
      !Number.isInteger(geometry.count) ||
      geometry.count < 0
    )
      throw new TypeError(
        `"${entry.name}"${at(entry)}: the geometry needs a whole-number count; got ${describe(geometry)}.`,
      );
    const rt = this.program.rt;
    const recorder = this.shape.console;
    const consoleBuffer =
      recorder !== undefined ? rt.consoleBuffer(recorder.log, recorder.entry) : undefined;
    const groups = this.program.bindGroups(this.shape, entry, bindings, consoleBuffer);
    pass.setPipeline(this.gpu);
    groups.forEach((g, i) => pass.setBindGroup(i, g));
    if (this.takesVertices) {
      const v = geometry.vertices;
      if (v === undefined)
        throw new TypeError(
          `"${this.vs.name}"${at(this.vs)} reads vertex attributes; the geometry gives no vertices.`,
        );
      pass.setVertexBuffer(0, this.#upload(v, BUFFER.VERTEX));
    }
    const instances = geometry.instances ?? 1;
    const idx = geometry.indices;
    if (idx === undefined) {
      pass.draw(geometry.count, instances);
      return;
    }
    if (ArrayBuffer.isView(idx)) {
      pass.setIndexBuffer(
        this.#upload(idx, BUFFER.INDEX),
        idx instanceof Uint16Array ? 'uint16' : 'uint32',
      );
    } else pass.setIndexBuffer(idx.buffer as Buffer, idx.format);
    pass.drawIndexed(geometry.count, instances);
  }

  #upload(v: ArrayBufferView | object, usage: number): Buffer {
    if (!ArrayBuffer.isView(v)) return v as Buffer;
    const rt = this.program.rt;
    // Index data is padded to 4 bytes, which writeBuffer needs.
    const size = Math.ceil(v.byteLength / 4) * 4;
    const buffer = rt.pool.take(size, usage | BUFFER.COPY_DST);
    const bytes = new Uint8Array(size);
    bytes.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    rt.gpu.queue.writeBuffer(buffer, 0, bytes);
    return buffer;
  }
}
