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
import { residentState, type Resident } from '../core/resident.js';
import { VERSION } from '../core/version.js';
import {
  PACK_SCHEMA,
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

/** A draw or dispatch binds values by the names the source declares. Each is a `Texture`, a
 *  `Sampler`, a `Resident`, a plain host value (Rule 8.21), or a host GPU object (below).
 *
 *  A plain value is packed by the binding's layout into its own buffer at each draw and dispatch.
 *  Draws of one pass that bind different values of one binding each read their own. The buffers
 *  return to the runtime once the frame has run. A `Resident` is one buffer every draw shares. A
 *  draw names only the bindings its entries reach. A name they do not reach is refused.
 *
 *  Escape hatch (Rule 11.17): on WebGPU, a host `GPUBuffer`, `GPUSampler` or `GPUTextureView` is
 *  bound as it is, and a host `GPUTexture` through its default view. On WebGL2, a host
 *  `WebGLTexture` or `WebGLSampler` is bound as it is. A sampled `WebGLTexture` takes the sampler
 *  its binding names. A draw takes a `WebGLBuffer` as a uniform block. */
export type Bindings = Readonly<Record<string, unknown>>;

/** A colour target of a render pipeline: its format, and its blending when it blends. `blend`
 *  and `writeMask` are WebGPU's `GPUBlendState` and `GPUColorWrite` flags; omitted, the target
 *  does not blend and every channel is written. A `constant` factor reads the pipeline's
 *  `blendConstant` when it declares one. Otherwise it reads `pass.setBlendConstant`, which sets
 *  `[0, 0, 0, 0]` at each pass start. */
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
export type Constants = Readonly<Record<string, number | boolean>>;

/** The members of `CompareFunction`, once: the checker, the sentences and the GL table read it. */
export const COMPARE_FUNCTIONS = [
  'never',
  'less',
  'equal',
  'less-equal',
  'greater',
  'not-equal',
  'greater-equal',
  'always',
] as const;

/** WebGPU `GPUCompareFunction`: how a depth test compares a fragment with the stored value. */
export type CompareFunction = (typeof COMPARE_FUNCTIONS)[number];

/** The keys each object of a render state takes, in the order of the interface. A sentence lists
 *  them in this order, and the checker and the parity matrix read this table. */
export const STATE_KEYS = {
  state: [
    'vertex',
    'fragment',
    'targets',
    'blendConstant',
    'depth',
    'primitive',
    'multisample',
    'constants',
  ],
  depth: ['format', 'compare', 'write'],
  primitive: ['topology', 'cullMode', 'frontFace'],
  multisample: ['count'],
  target: ['format', 'blend', 'writeMask'],
} as const;

// Every key of a table is a key of its interface, and every key of an interface is in its table.
const _stateKeys: readonly (keyof RenderState)[] = STATE_KEYS.state;
type _StateKeysMissing = Exclude<keyof RenderState, (typeof STATE_KEYS.state)[number]>;
const _stateKeysComplete: [_StateKeysMissing] extends [never] ? true : never = true;
const _depthKeys: readonly (keyof NonNullable<RenderState['depth']>)[] = STATE_KEYS.depth;
type _DepthKeysMissing = Exclude<
  keyof NonNullable<RenderState['depth']>,
  (typeof STATE_KEYS.depth)[number]
>;
const _depthKeysComplete: [_DepthKeysMissing] extends [never] ? true : never = true;
const _primitiveKeys: readonly (keyof NonNullable<RenderState['primitive']>)[] =
  STATE_KEYS.primitive;
type _PrimitiveKeysMissing = Exclude<
  keyof NonNullable<RenderState['primitive']>,
  (typeof STATE_KEYS.primitive)[number]
>;
const _primitiveKeysComplete: [_PrimitiveKeysMissing] extends [never] ? true : never = true;
const _multisampleKeys: readonly (keyof NonNullable<RenderState['multisample']>)[] =
  STATE_KEYS.multisample;
type _MultisampleKeysMissing = Exclude<
  keyof NonNullable<RenderState['multisample']>,
  (typeof STATE_KEYS.multisample)[number]
>;
const _multisampleKeysComplete: [_MultisampleKeysMissing] extends [never] ? true : never = true;
// The checks are read here, so that the compiler's unused-local rule keeps them.
void [
  _stateKeys,
  _stateKeysComplete,
  _depthKeys,
  _depthKeysComplete,
  _primitiveKeys,
  _primitiveKeysComplete,
  _multisampleKeys,
  _multisampleKeysComplete,
];

/** The fixed-function state of a render pipeline, which the host writes (change 0025): the
 *  compiler knows its entries' inputs and outputs, and the runtime fills and checks those. */
export interface RenderState {
  /** The vertex entry; the program's only one when omitted. */
  readonly vertex?: string;
  /** The fragment entry; the program's only one when omitted, none for a depth-only pass. */
  readonly fragment?: string | null;
  /** One per colour output, by location. Omitted: `rgba8unorm` for each. */
  readonly targets?: readonly TargetState[];
  /** setBlendConstant. The pipeline field is a TypeShade addition: WebGPU sets the constant on the
   *  pass only. Four numbers, each from 0 to 1. Unset, a draw uses the pass value. */
  readonly blendConstant?: ArrayLike<number>;
  /** The depth attachment's format, and how the pipeline tests and writes it: `compare`
   *  defaults to `'less'` and `write` to `true`. A reversed projection compares `'greater'`,
   *  and a pass drawn behind everything else (a sky) compares `'always'` and does not write.
   *  Omitted: no depth test, for a pass with no depth attachment. */
  readonly depth?: {
    readonly format: string;
    /** depthCompare. How the depth test compares a fragment with the stored depth. Default `'less'`. A reversed projection compares `'greater'`, and a sky compares `'always'`. */
    readonly compare?: CompareFunction;
    /** depthWriteEnabled. Whether a passing fragment writes its depth. Default `true`. */
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
 *  the manifest lays out. A typed array is uploaded at the draw; a `Resident` is uploaded on its
 *  first use and bound as it is after (change 0053); a `GPUBuffer` is bound as is. */
export interface Geometry {
  /** How many vertices, or indices when `indices` is given. */
  readonly count: number;
  /** How many instances: 1 when omitted. */
  readonly instances?: number;
  /** The vertex buffer, laid out as the manifest's vertex entry reads it (its `@location`
   *  inputs, tightly packed): a typed array, uploaded at each draw; a `Resident` of a
   *  `Float32Array`, `Int32Array` or `Uint32Array`, uploaded once; or the host's `GPUBuffer`.
   *  Omitted for a vertex entry with no `@location` input, such as a full-screen triangle drawn
   *  from `vertex_index`.
   *  Escape hatch (Rule 11.17): a host `GPUBuffer`, or on WebGL2 a `WebGLBuffer`, bound
   *  as it is. */
  readonly vertices?:
    | ArrayBufferView
    | Resident<Float32Array>
    | Resident<Int32Array>
    | Resident<Uint32Array>
    | object;
  /** The index buffer: a `Uint16Array` or `Uint32Array`, uploaded at each draw; a `Resident` of a
   *  `Uint32Array`, uploaded once, its format `uint32`; or `{ buffer, format }`, the host's
   *  `GPUBuffer` bound as it is.
   *  Escape hatch (Rule 11.17): a host `GPUBuffer`, or on WebGL2 a `WebGLBuffer`, as the
   *  `buffer` of `{ buffer, format }`. */
  readonly indices?:
    | Uint16Array
    | Uint32Array
    | Resident<Uint32Array>
    | { readonly buffer: object; readonly format: 'uint16' | 'uint32' };
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
   *  its default. The pipeline's draws take the bindings its two entries reach. A draw sets the
   *  pipeline's `blendConstant` when it declares one. Before a draw whose pipeline declares none,
   *  and that follows a draw that did, the runtime sets the pass value again. Two states that
   *  differ only in `blendConstant` give two pipelines over one GPU pipeline. */
  render<const S extends RenderState & EntryNames<E> = Record<never, never>>(
    state?: S,
  ): Promise<RenderPipeline<RenderBindings<E, S>>>;
}

/** A compute pipeline: one entry, dispatched with bindings by name. `B` is the bindings the
 *  entry reaches (change 0030). `workgroupShape` is the resolved `[x, y, z]` shape for the
 *  constants used to create this pipeline, including any workgroup-size overrides. */
export interface ComputePipeline<B = Bindings> {
  readonly entry: string;
  /** The resolved `[x, y, z]` workgroup size this pipeline was created with. */
  readonly workgroupShape: readonly [number, number, number];
  /** Record a dispatch into the host's encoder or compute pass, or a frame's.
   *  Escape hatch (Rule 11.17): the host's `GPUCommandEncoder` or `GPUComputePassEncoder`, which
   *  the dispatch records into; WebGL2 takes a frame only. */
  dispatch(target: object, bindings: B, workgroups: number | readonly number[]): void;
}

/** A render pipeline: a vertex entry, a fragment entry and the state, drawn with bindings by
 *  name. `B` is the bindings the two entries reach (change 0030). */
export interface RenderPipeline<B = Bindings> {
  readonly vertex: string;
  readonly fragment: string | null;
  /** Record a draw into the host's render pass, or a frame's.
   *  Escape hatch (Rule 11.17): the host's `GPURenderPassEncoder`, which the draw records into;
   *  WebGL2 takes a frame's pass only. */
  draw(pass: object, bindings: B, geometry: Geometry): void;
}

const RESOURCE_KINDS = new Set(['uniform-buffer', 'storage-buffer']);

/** The line an entry or a binding is declared on, for a refusal: ` (brick.shade.ts:12)`. */
export const at = (e: PackEntry | undefined): string =>
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

/** `program` as a manifest this runtime reads, or a `TypeError` that says why it is not one. */
export function checkManifest(program: unknown): asserts program is Pack {
  if (typeof program !== 'object' || program === null || !('wgsl' in program))
    throw new TypeError(
      'load() takes a manifest: packModule()’s result, or a module’s default export.',
    );
  const m = program as Pack;
  if (m.schema !== PACK_SCHEMA)
    throw new TypeError(
      `This manifest is schema ${String(m.schema)} (written by typeshade ${m.compiler ?? 'unknown'}); this runtime (typeshade ${VERSION}) reads schema ${PACK_SCHEMA}.`,
    );
}

/** Entry `name` of `stage` in `manifest`: its only one of the stage when `name` is omitted. */
export function entryOf(manifest: Pack, name: string | undefined, stage: string): PackEntry {
  const of = manifest.entries.filter((e) => e.stage === stage);
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

/** The override values a pipeline is created with, checked against the manifest's `overrides`:
 *  what WebGPU's `constants` takes, in the order the program declares its overrides, and the
 *  cache's key, so the same values give one pipeline whatever order or spelling the host used.
 *  `undefined` when the host gives none. A name the program does not declare, and a value its
 *  type cannot hold, are a `TypeError` (WebGPU's own error names nothing of the source). */
export function constantsOf(
  manifest: Pack,
  given: Constants | undefined,
): { readonly values: Record<string, number>; readonly key: string } | undefined {
  if (given === undefined) return undefined;
  if (typeof given !== 'object' || given === null || Array.isArray(given))
    throw new TypeError(
      `The constants are ${describe(given)}, not an object of override names and values.`,
    );
  const declared = manifest.overrides;
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

/** Resolve an entry's workgroup dimensions with the values supplied to pipeline creation. */
export function specializedWorkgroupShape(
  e: PackEntry,
  values: Readonly<Record<string, number>> = {},
): readonly [number, number, number] {
  const defaults = e.workgroupSize ?? [64, 1, 1];
  const names = e.workgroupSizeOverrides;
  return [0, 1, 2].map((axis) => {
    const name = names?.[axis];
    return name == null ? defaults[axis]! : (values[name] ?? defaults[axis]!);
  }) as [number, number, number];
}

function checkWorkgroupShape(
  device: Device,
  e: PackEntry,
  shape: readonly [number, number, number],
): void {
  const limits = device.limits;
  const maxima = [
    limits?.maxComputeWorkgroupSizeX ?? 256,
    limits?.maxComputeWorkgroupSizeY ?? 256,
    limits?.maxComputeWorkgroupSizeZ ?? 64,
  ];
  for (let axis = 0; axis < 3; axis++) {
    const value = shape[axis]!;
    if (!Number.isInteger(value) || value <= 0 || value > maxima[axis]!)
      throw new TypeError(
        `"${e.name}"${at(e)}: workgroup shape [${shape.join(', ')}] has an invalid ${'xyz'[axis]} dimension; this device allows 1 to ${maxima[axis]}.`,
      );
  }
  const invocations = shape[0] * shape[1] * shape[2];
  const maxInvocations = limits?.maxComputeInvocationsPerWorkgroup ?? 256;
  if (invocations > maxInvocations)
    throw new TypeError(
      `"${e.name}"${at(e)}: workgroup shape [${shape.join(', ')}] has ${invocations} invocations; this device allows ${maxInvocations}.`,
    );
}

/** `workgroups` as three counts, or a `TypeError` naming entry `e`. */
export function workgroupsOf(
  e: PackEntry,
  workgroups: number | readonly number[],
): readonly [number, number, number] {
  const wg = typeof workgroups === 'number' ? [workgroups] : workgroups;
  if (
    !Array.isArray(wg) ||
    wg.length < 1 ||
    wg.length > 3 ||
    !wg.every((n) => Number.isInteger(n) && n >= 0)
  )
    throw new TypeError(
      `"${e.name}"${at(e)}: workgroups is ${describe(workgroups)}; give n or [x, y?, z?], whole numbers.`,
    );
  return [wg[0]!, wg[1] ?? 1, wg[2] ?? 1];
}

/** Each colour output's target, by location, its format checked against the output's type. */
export function targetsOf(
  fs: PackEntry,
  given: readonly TargetState[] | undefined,
): { readonly format: string; readonly blend?: object; readonly writeMask?: number }[] {
  const outputs = (fs.outputs ?? []).filter((o) => o.location !== undefined);
  const count = Math.max(0, ...outputs.map((o) => o.location! + 1));
  const out: { format: string; blend?: object; writeMask?: number }[] = [];
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

/** A value for a sentence: a number as itself, anything else as `describe` says it. */
const shown = (v: unknown): string => (typeof v === 'number' ? String(v) : describe(v));

/** `a, b and c`; `a`; `a and b`. */
const and = (xs: readonly string[]): string =>
  xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/** `a, b or c`. */
const or = (xs: readonly string[]): string =>
  xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;

/** Whether `v` is a plain object: what a state's nested objects must be. */
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The sentence for a key an object does not take: `owner` is the object's name in the sentence. */
const keyRefusal = (
  prefix: string,
  name: string,
  owner: string,
  takes: readonly string[],
): string =>
  `${prefix} sets ${name}, which ${owner} does not take; ${owner} takes the ${takes.length === 1 ? 'key' : 'keys'} ${and(takes)}.`;

/** The normalised state of one render pipeline: every field filled, the blend constant as four
 *  numbers, each target resolved, and the two keys of the caches (WebGPU's pipeline and WebGL2's
 *  program share `gpuKey`; a `RenderPipeline` is one `key`). */
export interface RenderPlan {
  readonly depth?: {
    readonly format: string;
    readonly compare: CompareFunction;
    readonly write: boolean;
  };
  readonly primitive: {
    readonly topology: string;
    readonly cullMode: 'none' | 'front' | 'back';
    readonly frontFace: 'ccw' | 'cw';
  };
  readonly multisample: { readonly count: number };
  readonly blendConstant?: readonly [number, number, number, number];
  /** The override values the stages are created with, when the state gives some. */
  readonly constants?: Readonly<Record<string, number>>;
  /** One per colour output, resolved by `targetsOf`. */
  readonly targets: readonly {
    readonly format: string;
    readonly blend?: object;
    readonly writeMask?: number;
  }[];
  /** The key of the `RenderPipeline`: the whole normalised state. */
  readonly key: string;
  /** The key of the GPU pipeline: `key` without `blendConstant`. */
  readonly gpuKey: string;
}

/** The four numbers of a blend constant, each from 0 to 1, or undefined when `v` is not one. */
const fourNumbers = (v: unknown): readonly [number, number, number, number] | undefined => {
  if (typeof v !== 'object' || v === null || !('length' in v)) return undefined;
  const xs = Array.from(v as ArrayLike<unknown>);
  if (xs.length !== 4) return undefined;
  if (!xs.every((x) => typeof x === 'number' && x >= 0 && x <= 1)) return undefined;
  return xs as unknown as [number, number, number, number];
};

/** Check `state` for the entries `vs` and `fs`, and return its normal form. A `TypeError` names the
 *  entry. The keys of each object are checked first, then the values, in the order the sentences
 *  name them (RenderState, depth, primitive, multisample, blendConstant, targets). */
export function planOf(
  manifest: Pack,
  vs: PackEntry,
  fs: PackEntry | undefined,
  state: RenderState,
): RenderPlan {
  const prefix = `The render pipeline of "${(fs ?? vs).name}"${at(fs ?? vs)}`;
  const top = Object.keys(state).find((k) => !(STATE_KEYS.state as readonly string[]).includes(k));
  // The row of changes/0064-render-state.md for an unknown key on RenderState: no key list.
  if (top !== undefined)
    throw new TypeError(`${prefix} sets ${top}, which RenderState does not take.`);
  const constants = constantsOf(manifest, state.constants);

  let depth: RenderPlan['depth'];
  if (state.depth !== undefined) {
    const d: unknown = state.depth;
    if (!isObject(d))
      throw new TypeError(`${prefix} sets depth to ${shown(d)}; it takes an object.`);
    const key = Object.keys(d).find((k) => !(STATE_KEYS.depth as readonly string[]).includes(k));
    if (key !== undefined)
      throw new TypeError(keyRefusal(prefix, `depth.${key}`, 'depth', STATE_KEYS.depth));
    const compare = d.compare ?? 'less';
    if (!(COMPARE_FUNCTIONS as readonly unknown[]).includes(compare))
      throw new TypeError(
        `${prefix} sets depth.compare to ${JSON.stringify(compare)}; it takes ${or(COMPARE_FUNCTIONS)}.`,
      );
    depth = {
      format: d.format as string,
      compare: compare as CompareFunction,
      write: (d.write as boolean | undefined) ?? true,
    };
  }

  let primitive: RenderPlan['primitive'];
  {
    const p: unknown = state.primitive ?? {};
    if (!isObject(p))
      throw new TypeError(`${prefix} sets primitive to ${shown(p)}; it takes an object.`);
    const key = Object.keys(p).find(
      (k) => !(STATE_KEYS.primitive as readonly string[]).includes(k),
    );
    if (key !== undefined)
      throw new TypeError(
        keyRefusal(prefix, `primitive.${key}`, 'primitive', STATE_KEYS.primitive),
      );
    primitive = {
      topology: (p.topology as string | undefined) ?? 'triangle-list',
      cullMode: (p.cullMode as RenderPlan['primitive']['cullMode'] | undefined) ?? 'none',
      frontFace: (p.frontFace as RenderPlan['primitive']['frontFace'] | undefined) ?? 'ccw',
    };
  }

  let multisample: RenderPlan['multisample'];
  {
    const m: unknown = state.multisample ?? {};
    if (!isObject(m))
      throw new TypeError(`${prefix} sets multisample to ${shown(m)}; it takes an object.`);
    const key = Object.keys(m).find(
      (k) => !(STATE_KEYS.multisample as readonly string[]).includes(k),
    );
    if (key !== undefined)
      throw new TypeError(
        keyRefusal(prefix, `multisample.${key}`, 'multisample', STATE_KEYS.multisample),
      );
    multisample = { count: (m.count as number | undefined) ?? 1 };
  }

  let blendConstant: RenderPlan['blendConstant'];
  if (state.blendConstant !== undefined) {
    const c = fourNumbers(state.blendConstant);
    if (c === undefined) {
      const v: unknown = state.blendConstant;
      const shownC =
        typeof v === 'object' && v !== null && 'length' in v
          ? `[${Array.from(v as ArrayLike<unknown>).join(', ')}]`
          : describe(v);
      throw new TypeError(
        `${prefix} sets blendConstant to ${shownC}; it takes four numbers from 0 to 1.`,
      );
    }
    blendConstant = c;
  }

  // Each object target's keys, then the targets themselves (their formats are checked against the
  // output by `targetsOf`).
  const given = state.targets ?? [];
  given.forEach((t, i) => {
    if (typeof t === 'string') return;
    if (!isObject(t)) return;
    const key = Object.keys(t).find((k) => !(STATE_KEYS.target as readonly string[]).includes(k));
    if (key !== undefined)
      throw new TypeError(
        keyRefusal(prefix, `targets[${i}].${key}`, 'a target', STATE_KEYS.target),
      );
  });
  const targets = fs === undefined ? [] : targetsOf(fs, state.targets);

  const shape = {
    vertex: vs.name,
    fragment: fs?.name ?? null,
    targets: targets.map((t) => ({
      format: t.format,
      blend: t.blend ?? null,
      writeMask: t.writeMask ?? 15,
    })),
    depth,
    primitive,
    multisample,
    constants: constants?.key,
  };
  const gpuKey = JSON.stringify(shape);
  const key = JSON.stringify({ ...shape, blendConstant });
  return {
    ...(depth !== undefined ? { depth } : {}),
    primitive,
    multisample,
    ...(blendConstant !== undefined ? { blendConstant } : {}),
    ...(constants !== undefined ? { constants: constants.values } : {}),
    targets,
    key,
    gpuKey,
  };
}

/** The viewport of `setViewport`, checked against the tier's viewport limit `limit` (L). A `TypeError`
 *  names the first argument out of its range. Depths default to 0 and 1. */
export function viewportOf(
  x: unknown,
  y: unknown,
  width: unknown,
  height: unknown,
  minDepth: unknown,
  maxDepth: unknown,
  limit: number,
): {
  readonly rect: readonly [number, number, number, number];
  readonly minDepth: number;
  readonly maxDepth: number;
} {
  const whole: [string, unknown][] = [
    ['x', x],
    ['y', y],
    ['width', width],
    ['height', height],
  ];
  for (const [name, v] of whole)
    if (!Number.isInteger(v))
      throw new TypeError(`pass.setViewport takes whole numbers; ${name} is ${shown(v)}.`);
  const [xn, yn, wn, hn] = [x, y, width, height] as number[];
  for (const [name, v] of [
    ['width', wn],
    ['height', hn],
  ] as const)
    if (v! < 0 || v! > limit)
      throw new TypeError(
        `pass.setViewport takes a width and a height from 0 to ${limit}, the viewport limit here; got ${name} ${v}.`,
      );
  const edges: [string, number][] = [
    ['x', xn!],
    ['y', yn!],
    ['x + width', xn! + wn!],
    ['y + height', yn! + hn!],
  ];
  for (const [name, v] of edges) {
    const out = name === 'x' || name === 'y' ? v < -2 * limit : v > 2 * limit - 1;
    if (out)
      throw new TypeError(
        `pass.setViewport takes x and y from ${-2 * limit}, and x + width and y + height up to ${2 * limit - 1}, the viewport bounds here; got ${name} ${v}.`,
      );
  }
  const near = minDepth === undefined ? 0 : minDepth;
  const far = maxDepth === undefined ? 1 : maxDepth;
  if (!(
    typeof near === 'number' &&
    typeof far === 'number' &&
    near >= 0 &&
    near <= far &&
    far <= 1
  ))
    throw new TypeError(
      `pass.setViewport takes depths with 0 <= minDepth <= maxDepth <= 1; got minDepth ${shown(near)} and maxDepth ${shown(far)}.`,
    );
  return { rect: [xn!, yn!, wn!, hn!], minDepth: near, maxDepth: far };
}

/** The scissor rectangle of `setScissorRect`: whole numbers from 0 up, clipped to the attachment
 *  `size` when the runtime knows it (R19). A rectangle wholly outside keeps a zero size. */
export function scissorOf(
  x: unknown,
  y: unknown,
  width: unknown,
  height: unknown,
  size: { readonly width: number; readonly height: number } | undefined,
): readonly [number, number, number, number] {
  const whole: [string, unknown][] = [
    ['x', x],
    ['y', y],
    ['width', width],
    ['height', height],
  ];
  for (const [name, v] of whole)
    if (!Number.isInteger(v))
      throw new TypeError(`pass.setScissorRect takes whole numbers; ${name} is ${shown(v)}.`);
  for (const [name, v] of whole)
    if ((v as number) < 0)
      throw new TypeError(`pass.setScissorRect takes whole numbers from 0 up; got ${name} ${v}.`);
  const [x0, y0, w0, h0] = [x, y, width, height] as number[] as [number, number, number, number];
  if (size === undefined) return [x0, y0, w0, h0];
  const x1 = Math.min(x0, size.width);
  const y1 = Math.min(y0, size.height);
  return [
    x1,
    y1,
    Math.max(0, Math.min(x0 + w0, size.width) - x1),
    Math.max(0, Math.min(y0 + h0, size.height) - y1),
  ];
}

/** The blend constant of `setBlendConstant`: four numbers, each from 0 to 1. */
export function blendConstantOf(color: unknown): readonly [number, number, number, number] {
  if (typeof color !== 'object' || color === null || !('length' in color))
    throw new TypeError(`pass.setBlendConstant takes four numbers; color is ${describe(color)}.`);
  const xs = Array.from(color as ArrayLike<unknown>);
  if (xs.length !== 4)
    throw new TypeError(
      `pass.setBlendConstant takes four numbers; color has ${xs.length} numbers.`,
    );
  const i = xs.findIndex((x) => !(typeof x === 'number' && x >= 0 && x <= 1));
  if (i >= 0)
    throw new TypeError(
      `pass.setBlendConstant takes components from 0 to 1; got ${shown(xs[i])} in component ${i}.`,
    );
  return xs as unknown as [number, number, number, number];
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
  /** The GPU render pipelines, by the `gpuKey` of their state, with the layout each is made with. */
  readonly #gpuPipelines = new Map<string, Promise<{ gpu: object; shape: PipelineShape }>>();
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

  compute(entry?: string, options?: { readonly constants?: Constants }): Promise<ComputePipeline> {
    try {
      return this.#compute(entry, options?.constants);
    } catch (err) {
      return Promise.reject(err as Error);
    }
  }

  #compute(entry: string | undefined, given: Constants | undefined): Promise<ComputePipeline> {
    const e = entryOf(this.manifest, entry, 'compute');
    const constants = constantsOf(this.manifest, given);
    const workgroupShape = specializedWorkgroupShape(e, constants?.values);
    checkWorkgroupShape(this.device, e, workgroupShape);
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
          (gpu) => new ComputePipelineImpl(this, e, shape, gpu, workgroupShape),
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
    const vs = entryOf(this.manifest, state.vertex, 'vertex');
    const fs =
      state.fragment === null
        ? undefined
        : entryOf(this.manifest, state.fragment ?? undefined, 'fragment');
    const plan = planOf(this.manifest, vs, fs, state);
    // Two levels (proposal 0064, F1): the pipeline of the whole state, and the GPU pipeline under
    // it, which a state that differs only in `blendConstant` shares.
    let p = this.#pipelines.get(`render:${plan.key}`);
    if (p === undefined) {
      let g = this.#gpuPipelines.get(plan.gpuKey);
      if (g === undefined) {
        g = this.#gpuRender(vs, fs, plan);
        this.#gpuPipelines.set(plan.gpuKey, g);
      }
      const blend = plan.blendConstant;
      p = g.then(
        ({ gpu, shape }) =>
          new RenderPipelineImpl(this, vs, fs, shape, gpu, vs.vertex !== undefined, blend),
      );
      this.#pipelines.set(`render:${plan.key}`, p);
    }
    return p as Promise<RenderPipeline>;
  }

  /** The GPU pipeline of a normalised state (its `gpuKey`), with the layout it is made with. */
  #gpuRender(
    vs: PackEntry,
    fs: PackEntry | undefined,
    plan: RenderPlan,
  ): Promise<{ readonly gpu: object; readonly shape: PipelineShape }> {
    const shape = this.#shape(fs === undefined ? [vs] : [vs, fs]);
    const vertex = vs.vertex;
    // Every stage is created with the same values: WebGPU takes a name any stage's module
    // declares, whether or not that stage's entry reads it.
    const stage = plan.constants === undefined ? {} : { constants: plan.constants };
    return this.device
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
          ? {
              fragment: {
                module: this.#shaderModule(),
                entryPoint: fs.name,
                targets: plan.targets,
                ...stage,
              },
            }
          : {}),
        primitive: {
          topology: plan.primitive.topology,
          cullMode: plan.primitive.cullMode,
          frontFace: plan.primitive.frontFace,
        },
        ...(plan.depth !== undefined
          ? {
              depthStencil: {
                format: plan.depth.format,
                depthCompare: plan.depth.compare,
                depthWriteEnabled: plan.depth.write,
              },
            }
          : {}),
        // WebGPU's default is 1, so a count of 1 gives the same pipeline as none (proposal 0064, D4).
        ...(plan.multisample.count !== 1 ? { multisample: { count: plan.multisample.count } } : {}),
      })
      .then(
        (gpu) => ({ gpu, shape }),
        (err: unknown) => {
          throw new Error(
            `The render pipeline of "${vs.name}"${fs !== undefined ? ` and "${fs.name}"` : ''}${at(fs ?? vs)} could not be created: ${messageOf(err)}`,
          );
        },
      );
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
    readonly workgroupShape: readonly [number, number, number],
  ) {}

  get entry(): string {
    return this.e.name;
  }

  dispatch(target: object, bindings: Bindings, workgroups: number | readonly number[]): void {
    const wg = workgroupsOf(this.e, workgroups);
    const rt = this.program.rt;
    const recorder = this.shape.console;
    const consoleBuffer =
      recorder !== undefined ? rt.consoleBuffer(recorder.log, recorder.entry) : undefined;
    const groups = this.program.bindGroups(this.shape, this.e, bindings, consoleBuffer);
    const { pass, end } = computePass(target);
    pass.setPipeline(this.gpu);
    groups.forEach((g, i) => pass.setBindGroup(i, g));
    pass.dispatchWorkgroups(...wg);
    if (end) pass.end();
  }
}

/** What a frame's pass on WebGPU keeps for the draws recorded into it. */
export interface PassState {
  /** The pass value: the last `setBlendConstant`, `[0, 0, 0, 0]` at the pass start. */
  blend: readonly [number, number, number, number];
  /** True while the encoder holds a pipeline's declared constant and not `blend`. */
  blendDeclared: boolean;
}

export class RenderPipelineImpl implements RenderPipeline {
  constructor(
    private readonly program: ProgramImpl,
    private readonly vs: PackEntry,
    private readonly fs: PackEntry | undefined,
    private readonly shape: PipelineShape,
    private readonly gpu: object,
    private readonly takesVertices: boolean,
    private readonly blendConstant?: readonly [number, number, number, number],
  ) {}

  get vertex(): string {
    return this.vs.name;
  }
  get fragment(): string | null {
    return this.fs?.name ?? null;
  }

  draw(target: object, bindings: Bindings, geometry: Geometry): void {
    const pass = ('raw' in target ? (target as { raw: object }).raw : target) as RenderPassEncoder;
    // A frame's pass keeps its blend constant; a host's own pass has none, so it keeps none.
    const state = (target as { passState?: PassState }).passState;
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
    // A declared constant is set for this draw; a draw that declares none gets the pass value
    // again when the draw before it set a declared one (proposal 0064, R32).
    if (this.blendConstant !== undefined) {
      pass.setBlendConstant(this.blendConstant);
      if (state !== undefined) state.blendDeclared = true;
    } else if (state?.blendDeclared === true) {
      pass.setBlendConstant(state.blend);
      state.blendDeclared = false;
    }
    if (this.takesVertices) {
      const v = geometry.vertices;
      if (v === undefined)
        throw new TypeError(
          `"${this.vs.name}"${at(this.vs)} reads vertex attributes; the geometry gives no vertices.`,
        );
      pass.setVertexBuffer(
        0,
        this.#resident(v, 'vertices', this.vs) ?? this.#upload(v, BUFFER.VERTEX),
      );
    }
    const instances = geometry.instances ?? 1;
    const idx = geometry.indices;
    if (idx === undefined) {
      pass.draw(geometry.count, instances);
      return;
    }
    const resident = this.#resident(idx, 'indices', entry);
    if (resident !== undefined) pass.setIndexBuffer(resident, 'uint32');
    else if (ArrayBuffer.isView(idx)) {
      pass.setIndexBuffer(
        this.#upload(idx, BUFFER.INDEX),
        idx instanceof Uint16Array ? 'uint16' : 'uint32',
      );
    } else {
      const host = idx as { readonly buffer: object; readonly format: 'uint16' | 'uint32' };
      pass.setIndexBuffer(host.buffer as Buffer, host.format);
    }
    pass.drawIndexed(geometry.count, instances);
  }

  /** The device buffer of a `Resident` the geometry gives as its `field` (change 0053): the one
   *  every binding of the handle shares, uploaded on its first use and when `write()` changed
   *  it, and bound as it is otherwise. Undefined for a value that is no `Resident`. A `Resident`
   *  of anything but the typed arrays the field takes is a `TypeError` naming the field. */
  #resident(v: unknown, field: 'indices' | 'vertices', entry: PackEntry): Buffer | undefined {
    const state = residentState(v);
    if (state === undefined) return undefined;
    const host = state.view();
    const takes =
      field === 'indices'
        ? host instanceof Uint32Array
        : host instanceof Float32Array || host instanceof Int32Array || host instanceof Uint32Array;
    if (!takes)
      throw new TypeError(
        `"${entry.name}"${at(entry)}: the geometry's ${field} is a Resident of ${describe(host)}; ${
          field === 'indices'
            ? 'indices take a Resident of a Uint32Array'
            : 'vertices take a Resident of a Float32Array, an Int32Array or a Uint32Array'
        }.`,
      );
    const t = host instanceof Float32Array ? 'f32' : host instanceof Int32Array ? 'i32' : 'u32';
    const layout: Layout = { k: 'a', n: null, st: 4, e: { k: 's', t } };
    const bytes = (): ArrayBuffer => {
      const a = state.host as Uint32Array;
      return a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength) as ArrayBuffer;
    };
    return state.bufferFor(
      this.program.device as unknown as GpuDevice,
      layout,
      bytes,
      false,
    ) as unknown as Buffer;
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
