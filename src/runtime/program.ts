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
  type BindGroupLayout,
  type Buffer,
  type ComputePassEncoder,
  type Device,
  type RenderPassEncoder,
  type ShaderModule,
} from './gpu.js';
import { needOfEntry, PIPELINE_LIMITS, selectBindings } from './limits.js';
import { SamplerImpl, TextureImpl } from './resources.js';
import type { DepthAttachment, PassTargets, RuntimeImpl } from './runtime.js';

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

/** The members of `StencilOperation`, once: the checker, the sentences and the GL table read it. */
export const STENCIL_OPERATIONS = [
  'keep',
  'zero',
  'replace',
  'invert',
  'increment-clamp',
  'decrement-clamp',
  'increment-wrap',
  'decrement-wrap',
] as const;

/** WebGPU `GPUStencilOperation`: what a stencil test does to the value a pixel stores. */
export type StencilOperation = (typeof STENCIL_OPERATIONS)[number];

/** WebGPU `GPUStencilFaceState`: the stencil test and its three operations for one face. Each field
 *  it omits takes its default. */
export interface StencilFaceState {
  /** compare. How the test compares the reference with the stored value, each masked by `readMask`. Default `'always'`. */
  readonly compare?: CompareFunction;
  /** failOp. What a fragment that fails the stencil test does to the stored value. Default `'keep'`. */
  readonly failOp?: StencilOperation;
  /** depthFailOp. What a fragment that passes the stencil test and fails the depth test does. Default `'keep'`. */
  readonly depthFailOp?: StencilOperation;
  /** passOp. What a fragment that passes both tests does. Default `'keep'`. */
  readonly passOp?: StencilOperation;
}

/** The stencil test of a pipeline. The four face fields apply to both faces. */
export interface StencilState extends StencilFaceState {
  /** stencilFront. Overrides for the front face. Each field replaces the shared field for that face. */
  readonly front?: StencilFaceState;
  /** stencilBack. Overrides for the back face. Each field replaces the shared field for that face. */
  readonly back?: StencilFaceState;
  /** stencilReadMask: 0 to 0xFFFFFFFF, default 0xFFFFFFFF. Both tiers keep the low 8 bits. */
  readonly readMask?: number;
  /** stencilWriteMask: 0 to 0xFFFFFFFF, default 0xFFFFFFFF. Both tiers keep the low 8 bits. */
  readonly writeMask?: number;
  /** setStencilReference: the reference of each draw of this pipeline, which has `depth.stencil`. A whole number from 0 to 255. A fraction is refused. Unset, the draw sets the pass value. A declared reference overrides `pass.setStencilReference` for its draws. */
  readonly reference?: number;
}

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
  depth: ['format', 'compare', 'write', 'bias', 'stencil'],
  bias: ['constant', 'slopeScale', 'clamp'],
  stencil: [
    'compare',
    'failOp',
    'depthFailOp',
    'passOp',
    'front',
    'back',
    'readMask',
    'writeMask',
    'reference',
  ],
  face: ['compare', 'failOp', 'depthFailOp', 'passOp'],
  primitive: ['topology', 'cullMode', 'frontFace'],
  multisample: ['count', 'mask'],
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
const _biasKeys: readonly (keyof NonNullable<NonNullable<RenderState['depth']>['bias']>)[] =
  STATE_KEYS.bias;
type _BiasKeysMissing = Exclude<
  keyof NonNullable<NonNullable<RenderState['depth']>['bias']>,
  (typeof STATE_KEYS.bias)[number]
>;
const _biasKeysComplete: [_BiasKeysMissing] extends [never] ? true : never = true;
const _stencilKeys: readonly (keyof StencilState)[] = STATE_KEYS.stencil;
type _StencilKeysMissing = Exclude<keyof StencilState, (typeof STATE_KEYS.stencil)[number]>;
const _stencilKeysComplete: [_StencilKeysMissing] extends [never] ? true : never = true;
const _faceKeys: readonly (keyof StencilFaceState)[] = STATE_KEYS.face;
type _FaceKeysMissing = Exclude<keyof StencilFaceState, (typeof STATE_KEYS.face)[number]>;
const _faceKeysComplete: [_FaceKeysMissing] extends [never] ? true : never = true;
/** The keys each object of a pass's targets takes, in the order of the types. A sentence lists
 *  them in this order, and the checker and the parity matrix read this table. */
export const PASS_KEYS = {
  targets: ['color', 'depth'],
  color: ['target', 'clear', 'load', 'store'],
  depth: ['target', 'clear', 'load', 'store', 'readOnly', 'stencil'],
  stencil: ['clear', 'load', 'store', 'readOnly'],
} as const;

// Every key of a table is a key of its type, and every key of a type is in its table.
type _ColourEntry = Extract<NonNullable<PassTargets['color']>[number], { readonly target: unknown }>;
type _StencilObject = NonNullable<DepthAttachment['stencil']>;
const _passKeys: readonly (keyof PassTargets)[] = PASS_KEYS.targets;
type _PassKeysMissing = Exclude<keyof PassTargets, (typeof PASS_KEYS.targets)[number]>;
const _passKeysComplete: [_PassKeysMissing] extends [never] ? true : never = true;
const _colourKeys: readonly (keyof _ColourEntry)[] = PASS_KEYS.color;
type _ColourKeysMissing = Exclude<keyof _ColourEntry, (typeof PASS_KEYS.color)[number]>;
const _colourKeysComplete: [_ColourKeysMissing] extends [never] ? true : never = true;
const _depthAttachmentKeys: readonly (keyof DepthAttachment)[] = PASS_KEYS.depth;
type _DepthAttachmentKeysMissing = Exclude<keyof DepthAttachment, (typeof PASS_KEYS.depth)[number]>;
const _depthAttachmentKeysComplete: [_DepthAttachmentKeysMissing] extends [never] ? true : never = true;
const _stencilObjectKeys: readonly (keyof _StencilObject)[] = PASS_KEYS.stencil;
type _StencilObjectKeysMissing = Exclude<keyof _StencilObject, (typeof PASS_KEYS.stencil)[number]>;
const _stencilObjectKeysComplete: [_StencilObjectKeysMissing] extends [never] ? true : never = true;
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
  _biasKeys,
  _biasKeysComplete,
  _stencilKeys,
  _stencilKeysComplete,
  _faceKeys,
  _faceKeysComplete,
  _passKeys,
  _passKeysComplete,
  _colourKeys,
  _colourKeysComplete,
  _depthAttachmentKeys,
  _depthAttachmentKeysComplete,
  _stencilObjectKeys,
  _stencilObjectKeysComplete,
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
   *  `bias` offsets the depth of each triangle. `stencil` adds the stencil test.
   *  Omitted: no depth test, for a pass with no depth attachment. */
  readonly depth?: {
    readonly format: string;
    /** depthCompare. How the depth test compares a fragment with the stored depth. Default `'less'`. A reversed projection compares `'greater'`, and a sky compares `'always'`. */
    readonly compare?: CompareFunction;
    /** depthWriteEnabled. Whether a passing fragment writes its depth. Default `true`. */
    readonly write?: boolean;
    /** depthBias, depthBiasSlopeScale and depthBiasClamp. Each defaults to 0. A negative `constant` or `slopeScale` lowers the depth of a fragment, so a coplanar draw wins a `less` test. A positive one raises it. The unit of `constant` is the smallest depth step of the format, so it depends on the format. A non-zero bias on a line or point topology is refused. */
    readonly bias?: {
      /** depthBias. A whole number in the int32 range. The WebGL2 tier takes it on depth24plus, depth32float and depth24plus-stencil8, and refuses other formats. Measured on SwiftShader at 0.25, 0.5 and 0.75, from window depth 0.25 up its offset is at least the WebGPU offset and at most twice it. Measured on SwiftShader below 0.25: 8 times at 0.0625 and 4 times at 0.125. Below window depth 0.0625 the ratio is not measured. It is expected to grow as the depth falls (inference: it doubles each time the depth halves). To learn a refusal on WebGPU, run the host a second time with `createRuntime({ prefer: ['webgl2'] })`. */
      readonly constant?: number;
      /** depthBiasSlopeScale. A finite number. The WebGL2 tier gives the same offset as WebGPU, on the formats that take a constant bias. */
      readonly slopeScale?: number;
      /** depthBiasClamp. A finite number. The WebGL2 tier takes a non-zero value through `EXT_polygon_offset_clamp`, and refuses it when the context lacks that extension. */
      readonly clamp?: number;
    };
    /** stencilFront, stencilBack, stencilReadMask and stencilWriteMask of depthStencil. Needs a format with a stencil aspect. The reference comes from pass.setStencilReference, which is 0 at each pass start, or from this pipeline's reference. Lines and points use the front face. */
    readonly stencil?: StencilState;
  };
  /** What the vertices make: `topology` defaults to `'triangle-list'`, `cullMode` to `'none'`
   *  and `frontFace` to `'ccw'`. */
  readonly primitive?: {
    readonly topology?: string;
    readonly cullMode?: 'none' | 'front' | 'back';
    readonly frontFace?: 'ccw' | 'cw';
  };
  /** The sample count of the targets it draws into: 1 when omitted, 4 for a multisampled
   *  target. The WebGL2 tier refuses a count of 4. To learn that on WebGPU, run the host a second
   *  time with `createRuntime({ prefer: ['webgl2'] })`. */
  readonly multisample?: {
    readonly count?: number;
    /** mask. A whole number from 0 to 0xFFFFFFFF, default 0xFFFFFFFF. A mask other than the default with a count other than 1 is refused. At count 1, bit 0 keeps or drops the draw. */
    readonly mask?: number;
  };
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
   *  and that follows a draw that did, the runtime sets the pass value again. A draw of a pipeline
   *  with `depth.stencil` sets its `depth.stencil.reference` when it declares one, and the pass
   *  value of `setStencilReference` otherwise. A draw of a pipeline without `depth.stencil` sets
   *  no reference. Two states that differ only in `blendConstant` or in `depth.stencil.reference`
   *  give two pipelines over one GPU pipeline. */
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

/** The override values as WebGPU takes them: each authored name keyed by the name the WGSL
 *  declares (`emitted`, Proposal 0070). The values keep the authored names; only the key moves. */
export function wgslConstants(
  manifest: Pack,
  values: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(values)) {
    const o = manifest.overrides.find((x) => x.name === name);
    out[o?.emitted ?? name] = value;
  }
  return out;
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
  limits: Readonly<Record<string, number>>,
  e: PackEntry,
  shape: readonly [number, number, number],
): void {
  const maxima = [
    limits.maxComputeWorkgroupSizeX ?? 256,
    limits.maxComputeWorkgroupSizeY ?? 256,
    limits.maxComputeWorkgroupSizeZ ?? 64,
  ];
  for (let axis = 0; axis < 3; axis++) {
    const value = shape[axis]!;
    if (!Number.isInteger(value) || value <= 0 || value > maxima[axis]!)
      throw new TypeError(
        `"${e.name}"${at(e)}: workgroup shape [${shape.join(', ')}] has an invalid ${'xyz'[axis]} dimension; this device allows 1 to ${maxima[axis]}.`,
      );
  }
  const invocations = shape[0] * shape[1] * shape[2];
  const maxInvocations = limits.maxComputeInvocationsPerWorkgroup ?? 256;
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
    readonly bias: PlanBias;
    /** Present when the state has `depth.stencil`, even an empty one. */
    readonly stencil?: PlanStencil;
  };
  readonly primitive: {
    readonly topology: string;
    readonly cullMode: 'none' | 'front' | 'back';
    readonly frontFace: 'ccw' | 'cw';
  };
  readonly multisample: { readonly count: number; readonly mask: number };
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
  /** The key of the GPU pipeline: `key` without `blendConstant` and `depth.stencil.reference`. */
  readonly gpuKey: string;
  /** What a draw of this pipeline writes. The depth when `depth.write` is true, even with a compare of
   *  `'never'`. The stencil when the write mask is not 0 and a face that is not culled has an operation
   *  other than `keep`. Not part of either key: it follows from the state. */
  readonly writes: { readonly depth: boolean; readonly stencil: boolean };
}

/** The depth bias of a plan: each field a number, 0 when the state omits it. */
export interface PlanBias {
  readonly constant: number;
  readonly slopeScale: number;
  readonly clamp: number;
}

/** One face of a plan: each operation resolved, with its default where the state omits it. */
export interface PlanFace {
  readonly compare: CompareFunction;
  readonly failOp: StencilOperation;
  readonly depthFailOp: StencilOperation;
  readonly passOp: StencilOperation;
}

/** The stencil test of a plan. The masks are the low 8 bits. */
export interface PlanStencil {
  readonly front: PlanFace;
  readonly back: PlanFace;
  /** 0 to 255. */
  readonly readMask: number;
  /** 0 to 255. */
  readonly writeMask: number;
  /** The reference the pipeline declares, or undefined. It is part of the pipeline's key and not of the GPU pipeline's. */
  readonly reference?: number;
}

/** The four numbers of a blend constant, each from 0 to 1, or undefined when `v` is not one. */
const fourNumbers = (v: unknown): readonly [number, number, number, number] | undefined => {
  if (typeof v !== 'object' || v === null || !('length' in v)) return undefined;
  const xs = Array.from(v as ArrayLike<unknown>);
  if (xs.length !== 4) return undefined;
  if (!xs.every((x) => typeof x === 'number' && x >= 0 && x <= 1)) return undefined;
  return xs as unknown as [number, number, number, number];
};

/** The keys of `o` that `table` does not take: the first one, or undefined. */
const unknownKey = (o: object, table: readonly string[]): string | undefined =>
  Object.keys(o).find((k) => !table.includes(k));

/** WebGPU's names for the depth fields a state takes under another name. */
const WEBGPU_NAMES: ReadonlyMap<string, string> = new Map([
  ['depthBias', 'depth.bias.constant'],
  ['depthBiasSlopeScale', 'depth.bias.slopeScale'],
  ['depthBiasClamp', 'depth.bias.clamp'],
  ['stencilFront', 'depth.stencil.front'],
  ['stencilBack', 'depth.stencil.back'],
  ['stencilReadMask', 'depth.stencil.readMask'],
  ['stencilWriteMask', 'depth.stencil.writeMask'],
]);

/** The topologies a bias does not apply to: a bias offsets triangles only. */
const LINE_OR_POINT: ReadonlySet<string> = new Set(['line-list', 'line-strip', 'point-list']);

/** Whether `v` is a whole number from `lo` to `hi`. */
const isWhole = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** Whether a depth format has a stencil aspect: the test `recordPass` and `FrameImpl.pass` use. */
export const hasStencilAspect = (format: string): boolean => /stencil/.test(format);

/** The value of a stencil field: its own when set, else the shared one, else the default. Only
 *  `undefined` is unset. */
const pick = <T>(own: T | undefined, shared: T | undefined, dflt: T): T =>
  own !== undefined ? own : shared !== undefined ? shared : dflt;

/** A choice field, checked: `v` is one of `list`, or the sentence names its path. */
const choiceOf = (prefix: string, path: string, v: unknown, list: readonly string[]): void => {
  if (v !== undefined && !list.includes(v as string))
    throw new TypeError(`${prefix} sets ${path} to ${shown(v)}; it takes ${or(list)}.`);
};

/** A whole-number field, checked: `v` is a whole number from `lo` to `hi`, or undefined. */
const wholeOf = (prefix: string, path: string, v: unknown, lo: number, hi: number): void => {
  if (v !== undefined && !isWhole(v, lo, hi))
    throw new TypeError(
      `${prefix} sets ${path} to ${shown(v)}; it takes a whole number from ${lo} to ${hi}.`,
    );
};

/** The four operations of a face, checked in their order. `path` is the object's path. */
const faceChecks = (prefix: string, path: string, f: Record<string, unknown>): void => {
  choiceOf(prefix, `${path}.compare`, f.compare, COMPARE_FUNCTIONS);
  choiceOf(prefix, `${path}.failOp`, f.failOp, STENCIL_OPERATIONS);
  choiceOf(prefix, `${path}.depthFailOp`, f.depthFailOp, STENCIL_OPERATIONS);
  choiceOf(prefix, `${path}.passOp`, f.passOp, STENCIL_OPERATIONS);
};

/** The depth bias of a depth object, checked and normalised: `v + 0` turns -0 into 0. */
function biasOf(prefix: string, b: unknown): PlanBias {
  if (!isObject(b))
    throw new TypeError(`${prefix} sets depth.bias to ${shown(b)}; it takes an object.`);
  const key = unknownKey(b, STATE_KEYS.bias);
  if (key !== undefined)
    throw new TypeError(keyRefusal(prefix, `depth.bias.${key}`, 'depth.bias', STATE_KEYS.bias));
  if (b.constant !== undefined && !isWhole(b.constant, -2147483648, 2147483647))
    throw new TypeError(
      `${prefix} sets depth.bias.constant to ${shown(b.constant)}; it takes a whole number in the int32 range.`,
    );
  for (const f of ['slopeScale', 'clamp'] as const) {
    const v = b[f];
    if (v !== undefined && !(typeof v === 'number' && Number.isFinite(v)))
      throw new TypeError(
        `${prefix} sets depth.bias.${f} to ${shown(v)}; it takes a finite number.`,
      );
  }
  return {
    constant: ((b.constant as number | undefined) ?? 0) + 0,
    slopeScale: ((b.slopeScale as number | undefined) ?? 0) + 0,
    clamp: ((b.clamp as number | undefined) ?? 0) + 0,
  };
}

/** The stencil test of a depth object, checked in the order of the table of section 69, and
 *  resolved: each face field takes its override, else the shared field, else its default. */
function stencilOf(prefix: string, format: string, s: unknown): PlanStencil {
  if (!isObject(s))
    throw new TypeError(`${prefix} sets depth.stencil to ${shown(s)}; it takes an object.`);
  const key = unknownKey(s, STATE_KEYS.stencil);
  if (key !== undefined)
    throw new TypeError(
      keyRefusal(prefix, `depth.stencil.${key}`, 'depth.stencil', STATE_KEYS.stencil),
    );
  if (!hasStencilAspect(format))
    throw new TypeError(
      `${prefix} sets depth.stencil, which needs a format with a stencil aspect; got ${format}; use depth24plus-stencil8.`,
    );
  faceChecks(prefix, 'depth.stencil', s);
  for (const side of ['front', 'back'] as const) {
    const f = s[side];
    if (f === undefined) continue;
    if (!isObject(f))
      throw new TypeError(
        `${prefix} sets depth.stencil.${side} to ${shown(f)}; it takes an object.`,
      );
    const k = unknownKey(f, STATE_KEYS.face);
    if (k !== undefined)
      throw new TypeError(
        keyRefusal(prefix, `depth.stencil.${side}.${k}`, `depth.stencil.${side}`, STATE_KEYS.face),
      );
    faceChecks(prefix, `depth.stencil.${side}`, f);
  }
  wholeOf(prefix, 'depth.stencil.readMask', s.readMask, 0, 0xffffffff);
  wholeOf(prefix, 'depth.stencil.writeMask', s.writeMask, 0, 0xffffffff);
  wholeOf(prefix, 'depth.stencil.reference', s.reference, 0, 255);
  const face = (own: unknown): PlanFace => {
    const o = (own ?? {}) as Record<string, unknown>;
    return {
      compare: pick(o.compare, s.compare, 'always') as CompareFunction,
      failOp: pick(o.failOp, s.failOp, 'keep') as StencilOperation,
      depthFailOp: pick(o.depthFailOp, s.depthFailOp, 'keep') as StencilOperation,
      passOp: pick(o.passOp, s.passOp, 'keep') as StencilOperation,
    };
  };
  return {
    front: face(s.front),
    back: face(s.back),
    readMask: (((s.readMask as number | undefined) ?? 0xffffffff) & 0xff) + 0,
    writeMask: (((s.writeMask as number | undefined) ?? 0xffffffff) & 0xff) + 0,
    ...(s.reference !== undefined ? { reference: (s.reference as number) + 0 } : {}),
  };
}

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
  if (top === 'stencil' || top === 'bias')
    throw new TypeError(
      `${prefix} sets ${top}, which RenderState does not take; the TypeShade name is depth.${top}.`,
    );
  if (top !== undefined)
    throw new TypeError(`${prefix} sets ${top}, which RenderState does not take.`);
  const constants = constantsOf(manifest, state.constants);

  let depth: RenderPlan['depth'];
  if (state.depth !== undefined) {
    const d: unknown = state.depth;
    if (!isObject(d))
      throw new TypeError(`${prefix} sets depth to ${shown(d)}; it takes an object.`);
    const key = unknownKey(d, STATE_KEYS.depth);
    if (key !== undefined) {
      const webgpu = WEBGPU_NAMES.get(key);
      if (webgpu !== undefined)
        throw new TypeError(
          `${prefix} sets depth.${key}, a WebGPU name; the TypeShade name is ${webgpu}.`,
        );
      throw new TypeError(keyRefusal(prefix, `depth.${key}`, 'depth', STATE_KEYS.depth));
    }
    if (d.format === 'stencil8')
      throw new TypeError(
        `${prefix} sets depth.format stencil8, which the runtime does not take on either tier; use depth24plus-stencil8.`,
      );
    const compare = d.compare ?? 'less';
    if (!(COMPARE_FUNCTIONS as readonly unknown[]).includes(compare))
      throw new TypeError(
        `${prefix} sets depth.compare to ${JSON.stringify(compare)}; it takes ${or(COMPARE_FUNCTIONS)}.`,
      );
    const bias = d.bias === undefined ? biasOf(prefix, {}) : biasOf(prefix, d.bias);
    depth = {
      format: d.format as string,
      compare: compare as CompareFunction,
      write: (d.write as boolean | undefined) ?? true,
      bias,
      ...(d.stencil !== undefined
        ? { stencil: stencilOf(prefix, d.format as string, d.stencil) }
        : {}),
    };
  }

  let primitive: RenderPlan['primitive'];
  {
    const p: unknown = state.primitive ?? {};
    if (!isObject(p))
      throw new TypeError(`${prefix} sets primitive to ${shown(p)}; it takes an object.`);
    const key = unknownKey(p, STATE_KEYS.primitive);
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
  // A bias offsets triangles only: the first field that is not 0 names the refusal.
  if (depth !== undefined && LINE_OR_POINT.has(primitive.topology)) {
    const b = depth.bias;
    const field =
      b.constant !== 0
        ? 'constant'
        : b.slopeScale !== 0
          ? 'slopeScale'
          : b.clamp !== 0
            ? 'clamp'
            : undefined;
    if (field !== undefined)
      throw new TypeError(
        `${prefix} sets depth.bias.${field} ${shown(b[field])} on a ${primitive.topology} topology; a bias applies to triangles only; give 0.`,
      );
  }

  let multisample: RenderPlan['multisample'];
  {
    const m: unknown = state.multisample ?? {};
    if (!isObject(m))
      throw new TypeError(`${prefix} sets multisample to ${shown(m)}; it takes an object.`);
    const key = unknownKey(m, STATE_KEYS.multisample);
    if (key !== undefined)
      throw new TypeError(
        keyRefusal(prefix, `multisample.${key}`, 'multisample', STATE_KEYS.multisample),
      );
    const count = (m.count as number | undefined) ?? 1;
    wholeOf(prefix, 'multisample.mask', m.mask, 0, 0xffffffff);
    if (m.mask !== undefined && m.mask !== 0xffffffff && count !== 1)
      throw new TypeError(
        `${prefix} sets multisample.mask with count ${count}; the mask takes count 1 only; remove the mask or set count 1.`,
      );
    multisample = { count, mask: ((m.mask as number | undefined) ?? 0xffffffff) + 0 };
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
    const key = unknownKey(t, STATE_KEYS.target);
    if (key !== undefined)
      throw new TypeError(
        keyRefusal(prefix, `targets[${i}].${key}`, 'a target', STATE_KEYS.target),
      );
  });
  const targets = fs === undefined ? [] : targetsOf(fs, state.targets);

  // The GPU pipeline keeps the depth state the GPU takes: no `blendConstant`, no declared reference.
  const gpuDepth = depth && {
    format: depth.format,
    compare: depth.compare,
    write: depth.write,
    bias: depth.bias,
    stencil: depth.stencil && {
      front: depth.stencil.front,
      back: depth.stencil.back,
      readMask: depth.stencil.readMask,
      writeMask: depth.stencil.writeMask,
    },
  };
  const shape = {
    vertex: vs.name,
    fragment: fs?.name ?? null,
    targets: targets.map((t) => ({
      format: t.format,
      blend: t.blend ?? null,
      writeMask: t.writeMask ?? 15,
    })),
    depth: gpuDepth,
    primitive,
    multisample,
    constants: constants?.key,
  };
  const gpuKey = JSON.stringify(shape);
  const key = JSON.stringify({
    ...shape,
    blendConstant,
    stencilReference: depth?.stencil?.reference,
  });
  return {
    ...(depth !== undefined ? { depth } : {}),
    primitive,
    multisample,
    ...(blendConstant !== undefined ? { blendConstant } : {}),
    ...(constants !== undefined ? { constants: constants.values } : {}),
    targets,
    key,
    gpuKey,
    writes: {
      depth: depth !== undefined && depth.write,
      stencil: writesStencil(depth?.stencil, primitive.cullMode),
    },
  };
}

/** `reference` of `pass.setStencilReference`, checked: a whole number from 0 to 255. A `TypeError`
 *  names the argument. Returns the value with -0 as 0. */
export function stencilReferenceOf(reference: unknown): number {
  if (!Number.isInteger(reference))
    throw new TypeError(
      `pass.setStencilReference takes a whole number; reference is ${shown(reference)}.`,
    );
  const r = reference as number;
  if (r < 0 || r > 255)
    throw new TypeError(
      `pass.setStencilReference takes a whole number from 0 to 255; reference is ${shown(r)}.`,
    );
  return r + 0;
}

/** What the pass-fit check reads of a pass: its depth format, and which of its aspects are read-only. */
export interface PassFit {
  /** The format of the pass's depth attachment, or undefined when it has none. */
  readonly depthFormat: string | undefined;
  /** Whether the depth aspect is read-only. False when the pass has no depth attachment. */
  readonly depthReadOnly: boolean;
  /** Whether the stencil aspect is read-only. False when the pass has no stencil aspect. */
  readonly stencilReadOnly: boolean;
}

/** Check a draw against the pass it records into (proposal 0064). A pipeline that sets `depth.stencil`
 *  needs a depth attachment with a stencil aspect of the same format. A pipeline that writes depth or
 *  stencil needs that aspect to be writable. A `TypeError` names the first rule that fails. */
export function checkPassFit(
  name: string,
  depth: RenderPlan['depth'],
  writes: RenderPlan['writes'],
  pass: PassFit,
): void {
  const head = `pass.draw: the pipeline of "${name}"`;
  if (depth?.stencil !== undefined) {
    if (pass.depthFormat === undefined)
      throw new TypeError(
        `${head} sets depth.stencil, and the pass has no depth attachment; give the pass a depth attachment of depth24plus-stencil8.`,
      );
    if (!hasStencilAspect(pass.depthFormat))
      throw new TypeError(
        `${head} sets depth.stencil, and the pass depth format ${pass.depthFormat} has no stencil aspect; use ${depth.format}.`,
      );
    if (pass.depthFormat !== depth.format)
      throw new TypeError(
        `${head} has depth format ${depth.format}; the pass depth format is ${pass.depthFormat}, and the two must match; give the pipeline the pass depth format.`,
      );
  }
  if (writes.depth && pass.depthReadOnly)
    throw new TypeError(
      `${head} writes depth, and the pass depth attachment is read-only; set depth.write to false.`,
    );
  if (writes.stencil && pass.stencilReadOnly)
    throw new TypeError(
      `${head} writes stencil, and the pass stencil aspect is read-only; set stencil: { readOnly: false } on the depth attachment, or set the stencil write mask to 0.`,
    );
}

/** WebGPU's names for the attachment keys a pass takes under another name, by the object checked.
 *  The sentence names the TypeShade key. */
const ATTACHMENT_NAMES = {
  color: new Map([['storeOp', 'store']]),
  depth: new Map([
    ['depthStoreOp', 'store'],
    ['depthReadOnly', 'readOnly'],
    ['stencilLoadOp', 'stencil.load'],
    ['stencilStoreOp', 'stencil.store'],
    ['stencilClearValue', 'stencil.clear'],
    ['stencilReadOnly', 'stencil.readOnly'],
  ]),
} as const;

/** One aspect of a depth attachment as the pass runs it: every field filled. A read-only aspect
 *  loads and stores, and its `clear` is its default, which no call reads. */
export interface PassAspect {
  readonly readOnly: boolean;
  readonly load: 'clear' | 'load';
  readonly store: 'store' | 'discard';
  readonly clear: number;
}

/** One colour attachment as the pass runs it. */
export interface PassColour {
  readonly target: object;
  readonly clear: readonly number[];
  readonly load: 'clear' | 'load';
  readonly store: 'store' | 'discard';
}

/** The normal form of a pass's targets: every field filled, each aspect resolved. */
export interface PassPlan {
  readonly color: readonly PassColour[];
  readonly depth?: {
    readonly target: object;
    /** The format of the depth target, or 'unknown' for an object that names none. */
    readonly format: string;
    readonly depth: PassAspect;
    /** Present when the format has a stencil aspect. */
    readonly stencil?: PassAspect;
  };
}

/** What `passOf` asks of a tier: whether an object is its texture, its canvas, and its format. */
export interface PassHost {
  /** Whether `t` is a `Texture` of this tier's runtime. */
  isTexture(t: unknown): boolean;
  /** Whether a colour target is the canvas: its context, or the canvas the context draws to. */
  isCanvas(t: object): boolean;
  /** The format of a depth target, or undefined when it names none. */
  formatOf(t: object): string | undefined;
}

const LOADS = ['clear', 'load'] as const;
const STORES = ['store', 'discard'] as const;

/** Refuse the WebGPU name of a key, with the TypeShade name that replaces it. */
const wireNameOf = (prefix: string, names: ReadonlyMap<string, string>, o: object): void => {
  for (const k of Object.keys(o)) {
    const ours = names.get(k);
    if (ours !== undefined)
      throw new TypeError(`${prefix} sets ${k}, a WebGPU name; the TypeShade name is ${ours}.`);
  }
};

/** A boolean field, checked: `v` is true, false or undefined. */
const booleanOf = (prefix: string, path: string, v: unknown): void => {
  if (v !== undefined && typeof v !== 'boolean')
    throw new TypeError(`${prefix} sets ${path} to ${shown(v)}; it takes true or false.`);
};

/** The first of `clear`, `load` and `store` that `o` sets, with its value, for a sentence. */
const setFieldOf = (o: Record<string, unknown>): readonly [string, unknown] | undefined => {
  for (const f of ['clear', 'load', 'store'] as const) if (o[f] !== undefined) return [f, o[f]];
  return undefined;
};

/** Check the targets of a pass and return their normal form. A `TypeError` names the field. It runs
 *  before a tier touches an encoder or a context, so a refused pass changes nothing. */
export function passOf(targets: unknown, host: PassHost): PassPlan {
  const t = targets as Record<string, unknown>;
  const top = unknownKey(t, PASS_KEYS.targets);
  if (top !== undefined)
    throw new TypeError(keyRefusal('pass()', top, 'PassTargets', PASS_KEYS.targets));
  const color = ((t.color ?? []) as readonly unknown[]).map((c, i): PassColour => {
    const prefix = `The colour target ${i}`;
    if (!isObject(c) || host.isTexture(c) || !('target' in c))
      return { target: c as object, clear: [0, 0, 0, 0], load: 'clear', store: 'store' };
    wireNameOf(prefix, ATTACHMENT_NAMES.color, c);
    const key = unknownKey(c, PASS_KEYS.color);
    if (key !== undefined)
      throw new TypeError(keyRefusal(prefix, key, 'a colour target', PASS_KEYS.color));
    choiceOf(prefix, 'load', c.load, LOADS);
    choiceOf(prefix, 'store', c.store, STORES);
    const store = (c.store as PassColour['store'] | undefined) ?? 'store';
    if (store === 'discard' && host.isCanvas(c.target as object))
      throw new TypeError(`${prefix} is the canvas: store 'discard' is refused; give store 'store'.`);
    return {
      target: c.target as object,
      clear: (c.clear as readonly number[] | undefined) ?? [0, 0, 0, 0],
      load: (c.load as PassColour['load'] | undefined) ?? 'clear',
      store,
    };
  });
  const d = t.depth;
  if (d === undefined) return { color };
  const prefix = 'The depth attachment';
  let target: object;
  let spec: Record<string, unknown> = {};
  if (isObject(d) && host.isTexture(d)) target = d;
  else {
    if (!isObject(d))
      throw new TypeError(`pass() sets depth to ${shown(d)}; it takes a Texture or an object.`);
    wireNameOf(prefix, ATTACHMENT_NAMES.depth, d);
    const key = unknownKey(d, PASS_KEYS.depth);
    if (key !== undefined)
      throw new TypeError(keyRefusal(prefix, key, 'a depth attachment', PASS_KEYS.depth));
    target = d.target as object;
    spec = d;
  }
  const format = host.formatOf(target) ?? 'unknown';
  if (format === 'stencil8')
    throw new TypeError(
      `${prefix} has stencil8, which the runtime does not take on either tier; use depth24plus-stencil8.`,
    );
  if (spec.stencil !== undefined && !hasStencilAspect(format))
    throw new TypeError(
      `${prefix} has ${format}, which has no stencil aspect; stencil takes a stencil format; use depth24plus-stencil8.`,
    );
  booleanOf(prefix, 'readOnly', spec.readOnly);
  const readOnly = spec.readOnly === true;
  const given = readOnly ? setFieldOf(spec) : undefined;
  if (given !== undefined)
    throw new TypeError(
      `${prefix} is readOnly: it takes no clear, load or store; got ${given[0]} ${shown(given[1])}.`,
    );
  choiceOf(prefix, 'load', spec.load, LOADS);
  choiceOf(prefix, 'store', spec.store, STORES);
  if (spec.clear !== undefined && !(typeof spec.clear === 'number' && spec.clear >= 0 && spec.clear <= 1))
    throw new TypeError(
      `${prefix} sets clear to ${shown(spec.clear)}; a depth clear takes a number from 0 to 1.`,
    );
  const depth: PassAspect = {
    readOnly,
    load: readOnly ? 'load' : ((spec.load as PassAspect['load'] | undefined) ?? 'clear'),
    store: readOnly ? 'store' : ((spec.store as PassAspect['store'] | undefined) ?? 'store'),
    clear: readOnly ? 1 : ((spec.clear as number | undefined) ?? 1) + 0,
  };
  if (!hasStencilAspect(format)) return { color, depth: { target, format, depth } };
  // The stencil object follows the depth aspect for each field it omits.
  let s: Record<string, unknown> = {};
  if (spec.stencil !== undefined) {
    if (!isObject(spec.stencil))
      throw new TypeError(`${prefix} sets stencil to ${shown(spec.stencil)}; it takes an object.`);
    const k = unknownKey(spec.stencil, PASS_KEYS.stencil);
    if (k !== undefined)
      throw new TypeError(keyRefusal(prefix, `stencil.${k}`, 'stencil', PASS_KEYS.stencil));
    s = spec.stencil;
  }
  booleanOf(prefix, 'stencil.readOnly', s.readOnly);
  const stencilReadOnly = (s.readOnly as boolean | undefined) ?? depth.readOnly;
  const set = stencilReadOnly ? setFieldOf(s) : undefined;
  if (set !== undefined)
    throw new TypeError(
      s.readOnly === true
        ? `${prefix} sets stencil.readOnly to true; the stencil object takes no clear, load or store; got stencil.${set[0]} ${shown(set[1])}.`
        : `${prefix} is readOnly, so stencil.load is inherited as load because the depth aspect is read-only, and the stencil object takes no ${set[0]}; got stencil.${set[0]} ${shown(set[1])}.`,
    );
  choiceOf(prefix, 'stencil.load', s.load, LOADS);
  choiceOf(prefix, 'stencil.store', s.store, STORES);
  wholeOf(prefix, 'stencil.clear', s.clear, 0, 255);
  if (!stencilReadOnly && s.clear !== undefined && s.load === undefined && depth.load === 'load')
    throw new TypeError(
      "The stencil clear needs stencil.load 'clear'; stencil.load follows the depth load, which is 'load' here; give stencil.load 'clear'.",
    );
  const stencil: PassAspect = {
    readOnly: stencilReadOnly,
    load: stencilReadOnly ? 'load' : ((s.load as PassAspect['load'] | undefined) ?? depth.load),
    store: stencilReadOnly ? 'store' : ((s.store as PassAspect['store'] | undefined) ?? depth.store),
    clear: stencilReadOnly ? 0 : ((s.clear as number | undefined) ?? 0) + 0,
  };
  return { color, depth: { target, format, depth, stencil } };
}

/** Whether a face has an operation other than `keep`. */
const changesStencil = (f: PlanFace): boolean =>
  f.failOp !== 'keep' || f.depthFailOp !== 'keep' || f.passOp !== 'keep';

/** Whether a pipeline writes stencil: its write mask is not 0, and a face that its cull mode does not
 *  cull has an operation other than `keep`. The cull mode applies whatever the topology. */
const writesStencil = (s: PlanStencil | undefined, cull: 'none' | 'front' | 'back'): boolean =>
  s !== undefined &&
  s.writeMask !== 0 &&
  ((cull !== 'front' && changesStencil(s.front)) || (cull !== 'back' && changesStencil(s.back)));

/** The WebGPU `depthStencil` of a plan. A bias key appears only when its value is not 0, and the four
 *  stencil fields whenever `depth.stencil` is present (proposal 0064). */
function depthStencilOf(d: NonNullable<RenderPlan['depth']>): object {
  const b = d.bias;
  const s = d.stencil;
  return {
    format: d.format,
    depthCompare: d.compare,
    depthWriteEnabled: d.write,
    ...(b.constant !== 0 ? { depthBias: b.constant } : {}),
    ...(b.slopeScale !== 0 ? { depthBiasSlopeScale: b.slopeScale } : {}),
    ...(b.clamp !== 0 ? { depthBiasClamp: b.clamp } : {}),
    ...(s !== undefined
      ? {
          stencilFront: { ...s.front },
          stencilBack: { ...s.back },
          stencilReadMask: s.readMask,
          stencilWriteMask: s.writeMask,
        }
      : {}),
  };
}

/** The WebGPU `multisample` entries of a plan: none for the default count 1 and mask, and each
 *  field only when it differs from its default (proposal 0064). */
const multisampleOf = (m: RenderPlan['multisample']): object =>
  m.count === 1 && m.mask === 0xffffffff
    ? {}
    : {
        multisample: {
          ...(m.count !== 1 ? { count: m.count } : {}),
          ...(m.mask !== 0xffffffff ? { mask: m.mask } : {}),
        },
      };

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

  /** Refuse a pipeline whose entries need more of a limit than the device has (change 0051, R4).
   *  Each entry's need comes from the bindings `#shape` lays out, so the check and the layout
   *  agree. The workgroup limits are `checkWorkgroupShape`'s. Rejects with a `TypeError`. */
  #checkPipelineLimits(entries: readonly PackEntry[]): void {
    const records = this.#log !== undefined;
    const needs = entries.map((entry) => ({
      entry,
      ...needOfEntry(this.#bindings, entry, records),
    }));
    for (const limit of PIPELINE_LIMITS) {
      const have = this.rt.limits[limit];
      if (have === undefined) continue;
      let worst: ((typeof needs)[number] & { value: number }) | undefined;
      for (const n of needs) {
        const value = n.need[limit] ?? 0;
        if (worst === undefined || value > worst.value) worst = { ...n, value };
      }
      if (worst === undefined || worst.value <= have) continue;
      const console =
        worst.console && limit === 'maxStorageBuffersPerShaderStage'
          ? ', the console buffer among them'
          : '';
      throw new TypeError(
        `The entry "${worst.entry.name}"${at(worst.entry)} needs ${limit} ${worst.value}${console}; this device has ${have}. ${this.rt.limitRemedy(limit, have)}`,
      );
    }
  }

  /** The layout a pipeline of `entries` binds: each binding they reach, visible to the stages
   *  that reach it, the console buffer too when the program records. */
  #shape(entries: readonly PackEntry[]): PipelineShape {
    // The selection is `selectBindings` (change 0051), which the limits derivation also calls.
    const { visibility, recorder } = selectBindings(
      entries,
      this.#bindings,
      this.#log !== undefined,
    );
    let console: PipelineShape['console'];
    if (this.#log !== undefined && recorder !== undefined) {
      const slot = this.#bindings.get('_console');
      if (slot !== undefined) console = { slot, log: this.#log, entry: recorder.name };
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
    checkWorkgroupShape(this.rt.limits, e, workgroupShape);
    const key = `compute:${e.name}:${constants?.key ?? ''}`;
    let p = this.#pipelines.get(key);
    if (p === undefined) {
      this.#checkPipelineLimits([e]);
      const shape = this.#shape([e]);
      p = this.device
        .createComputePipelineAsync({
          layout: shape.pipelineLayout,
          compute: {
            module: this.#shaderModule(),
            entryPoint: e.emitted,
            ...(constants !== undefined
              ? { constants: wgslConstants(this.manifest, constants.values) }
              : {}),
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
          new RenderPipelineImpl(
            this,
            vs,
            fs,
            shape,
            gpu,
            vs.vertex !== undefined,
            blend,
            plan.depth,
            plan.writes,
          ),
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
    this.#checkPipelineLimits(fs === undefined ? [vs] : [vs, fs]);
    const shape = this.#shape(fs === undefined ? [vs] : [vs, fs]);
    const vertex = vs.vertex;
    // Every stage is created with the same values: WebGPU takes a name any stage's module
    // declares, whether or not that stage's entry reads it.
    const stage =
      plan.constants === undefined
        ? {}
        : { constants: wgslConstants(this.manifest, plan.constants) };
    return this.device
      .createRenderPipelineAsync({
        layout: shape.pipelineLayout,
        vertex: {
          module: this.#shaderModule(),
          entryPoint: vs.emitted,
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
                entryPoint: fs.emitted,
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
        ...(plan.depth !== undefined ? { depthStencil: depthStencilOf(plan.depth) } : {}),
        ...multisampleOf(plan.multisample),
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

  /** Refuse a binding whose buffer the device cannot bind or cannot make (change 0051, R5). The
   *  sizes are those `#resource` binds, read without making a buffer, so a refused call takes no
   *  console buffer. A value whose size cannot be read is left to `#resource`, which refuses it as
   *  before. Throws a `RangeError`. */
  checkBindingSizes(shape: PipelineShape, entry: PackEntry, values: Bindings): void {
    if (typeof values !== 'object' || values === null) return;
    const limits = this.rt.limits;
    for (const g of shape.groups)
      for (const s of g.slots) {
        const b = s.binding;
        if (
          b.name === '_console' ||
          b.name === '_fp64' ||
          !RESOURCE_KINDS.has(b.resource.resourceKind)
        )
          continue;
        const v = values[b.name];
        if (v === undefined) continue;
        const sizes = this.#sizesOf(s, v);
        if (sizes === undefined) continue;
        const uniform = b.resource.resourceKind === 'uniform-buffer';
        const bind = uniform ? 'maxUniformBufferBindingSize' : 'maxStorageBufferBindingSize';
        const where = `"${entry.name}"${at(entry)}, binding "${b.name}" (${b.type})`;
        const bound = limits[bind];
        if (bound !== undefined && sizes.bound > bound)
          throw new RangeError(
            `${where} is ${sizes.bound} bytes; this device binds at most ${bound} bytes in one ${uniform ? 'uniform' : 'storage'} binding (${bind}).`,
          );
        const max = limits.maxBufferSize;
        if (sizes.made !== undefined && max !== undefined && sizes.made > max)
          throw new RangeError(
            `${where} is ${sizes.made} bytes; this device makes at most ${max} bytes in one buffer (maxBufferSize).`,
          );
      }
  }

  /** The size a binding names and the size of the buffer the runtime makes for it, as `#resource`
   *  binds `v`: a host buffer has no buffer of the runtime's, a `Resident` has its host bytes, and a
   *  plain value has its packed bytes (a uniform binding the whole pooled buffer, rounded to 16). */
  #sizesOf(s: Slot, v: unknown): { bound: number; made?: number } | undefined {
    const b = s.binding;
    const uniform = b.resource.resourceKind === 'uniform-buffer';
    try {
      if (isGpuBuffer(v)) return { bound: (v as unknown as { size: number }).size };
      const state = residentState(v);
      if (state !== undefined) {
        if (s.layout === undefined) return undefined;
        const size = byteSize(s.layout, state.host, b.name);
        return { bound: size, made: size };
      }
      if (s.layout === undefined) return undefined;
      const size = byteSize(s.layout, v, b.name);
      const pooled = Math.max(16, Math.ceil(size / 16) * 16);
      return { bound: uniform ? pooled : size, made: pooled };
    } catch {
      return undefined;
    }
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

/** Refuse a dispatch with more workgroups in one dimension than the device dispatches (change
 *  0051, R6). Throws a `RangeError`. */
function checkDispatchSize(
  limits: Readonly<Record<string, number>>,
  e: PackEntry,
  wg: readonly [number, number, number],
): void {
  const max = limits.maxComputeWorkgroupsPerDimension;
  if (max === undefined) return;
  for (let axis = 0; axis < 3; axis++)
    if (wg[axis]! > max)
      throw new RangeError(
        `"${e.name}"${at(e)}: ${wg[axis]} workgroups in ${'xyz'[axis]}; this device dispatches at most ${max} in one dimension (maxComputeWorkgroupsPerDimension).`,
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
    // The checks run before the console buffer is taken, so a refused call leaves no row (R5, R6).
    this.program.checkBindingSizes(this.shape, this.e, bindings);
    checkDispatchSize(rt.limits, this.e, wg);
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
export interface PassState extends PassFit {
  /** The pass value: the last `setBlendConstant`, `[0, 0, 0, 0]` at the pass start. */
  blend: readonly [number, number, number, number];
  /** True while the encoder holds a pipeline's declared constant and not `blend`. */
  blendDeclared: boolean;
  /** The pass value of the stencil reference: the last `setStencilReference`, 0 at the pass start. */
  stencilReference: number;
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
    private readonly depth?: RenderPlan['depth'],
    private readonly writes: RenderPlan['writes'] = { depth: false, stencil: false },
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
    // The pass must fit the pipeline's stencil (F6(a)). A host's own encoder has no pass state: no check.
    if (state !== undefined) checkPassFit(entry.name, this.depth, this.writes, state);
    const rt = this.program.rt;
    this.program.checkBindingSizes(this.shape, entry, bindings);
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
    // A pipeline with `depth.stencil` sets its declared reference, or else the pass value. A frame's
    // pass sets the pass value before every such draw: a `raw` call may have changed it unseen.
    const stencil = this.depth?.stencil;
    if (stencil !== undefined) {
      if (stencil.reference !== undefined) pass.setStencilReference(stencil.reference);
      else if (state !== undefined) pass.setStencilReference(state.stencilReference);
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
