// ═══ The manifest's shape (Rule 11.10, change 0025) ═══
//
// The types of a compiled program's manifest and the two layout converters, apart from the
// builder in `manifest.ts`: the program runtime reads a manifest and imports this file alone, so
// its module closure reaches no emitter (Rule 11.11, `scripts/bundle-boundary.ts`). The emit
// options a manifest records are written here as the words themselves and not as the writers'
// types, which would put the optimizer and the writers in that closure; `manifest.ts`, which
// builds the record from those types, holds the two to each other.

import type { ConsoleLog } from './console.js';
import type { Layout } from './host-entry.js';
import type { GpuVertexLayout } from './vertex-layout.js';
import type { PortableIr } from './ir/portable.js';

/** A compute entry as the WebGL2 executor runs it (change 0054): its pass program, a vertex
 *  stage whose records transform feedback captures, and what the executor needs to run it.
 *  Plain data, built when the program is packed, so the runtime builds nothing. */
export interface PackGlCompute {
  readonly entry: string;
  /** The texture shape the program reads: a word `w` is texel `(w % width, (w / width) %
   *  layerRows)` of layer `w / (width × layerRows)`. */
  readonly layout: { readonly width: number; readonly layerRows: number };
  /** The pass program, GLSL ES 3.00: one vertex is one invocation, and transform feedback
   *  captures its record, `varyings` in order, interleaved. */
  readonly vertex: string;
  readonly varyings: readonly string[];
  readonly workgroupSize: readonly [number, number, number];
  /** Each memory root: a storage binding or a workgroup variable, as words. For a workgroup
   *  root `fixed` is one workgroup's words; for a storage root, the words before a runtime-sized
   *  array, which `stride` words follow per element. */
  readonly roots: readonly {
    readonly name: string;
    readonly space: 'storage' | 'workgroup';
    readonly fixed: number;
    readonly stride: number;
    readonly length?: string;
  }[];
  /** The record each invocation writes per pass, in texels of four words, and how a draw
   *  slices it: `slices` draws of `sliceTexels` texels. */
  readonly recordTexels: number;
  readonly sliceTexels: number;
  readonly slices: number;
  /** Record words: the resume point, the log's count, the request (three words), the first of
   *  the log's keys, and the first of its values. */
  readonly pcWord: number;
  readonly countWord: number;
  readonly requestAt: number;
  readonly keysAt: number;
  readonly valuesAt: number;
  /** Each private variable's first record word and its initial words. */
  readonly init: readonly (readonly [number, readonly number[]])[];
  /** Each length variable's record word. */
  readonly lengthWords: Readonly<Record<string, number>>;
  /** The resume point of a finished invocation, and the cut each other resume point ends. */
  readonly done: number;
  readonly cuts: Readonly<Record<number, 'barrier' | 'atomic' | 'log'>>;
  /** Each barrier cut's builtin and line, for the message a divergent workgroup gets. */
  readonly barriers: Readonly<Record<number, { readonly fn: string; readonly line: string }>>;
  /** Each atomic cut's request: the record word of the variable its value goes to, if any, and
   *  whether the value is `atomicCompareExchangeWeak`'s pair. */
  readonly requests: Readonly<
    Record<
      number,
      {
        readonly fn: string;
        readonly root: number;
        readonly elem: 'i32' | 'u32';
        readonly result?: number;
        readonly pair: boolean;
      }
    >
  >;
  /** The uniform bindings it reads: each one's name, the std140 block GLSL declares for it, and
   *  the layout its host value packs by. */
  readonly uniforms: readonly {
    readonly name: string;
    readonly block: string;
    readonly layout: PackLayout;
  }[];
  /** The 2D sampled textures it reads, each a `sampler2D` of its own name in the pass program:
   *  the sampler binding its calls pass it (`null` when it is only loaded or measured), and how
   *  its texels read. Absent when it reads none. */
  readonly textures?: readonly {
    readonly name: string;
    readonly sampler: string | null;
    readonly sample: 'float' | 'sint' | 'uint';
  }[];
}

/** The manifest's schema. A reader refuses one it does not know (Rule 11.10). */
export const PACK_SCHEMA = 1;

// ─── the shape ───────────────────────────────────────────────────────────────────────────────

/** A binding's byte layout, under the rule of its space: every offset, size and stride the
 *  emitted WGSL assumes (Rule 6.8). An emulated `f64` is two `f32`s, the high half first. */
export type PackLayout =
  | { readonly kind: 'scalar'; readonly type: 'f32' | 'i32' | 'u32' | 'f64' }
  /** An `f64` vector is two planes of `f32` lanes, `hi` at 0 and `lo` at `lo` bytes. */
  | {
      readonly kind: 'vector';
      readonly size: number;
      readonly type: 'f32' | 'i32' | 'u32' | 'f64';
      readonly lo?: number;
    }
  | {
      readonly kind: 'matrix';
      readonly columns: number;
      readonly rows: number;
      readonly columnStride: number;
    }
  /** `length` is null for an array with no size. */
  | {
      readonly kind: 'array';
      readonly length: number | null;
      readonly stride: number;
      readonly element: PackLayout;
    }
  | {
      readonly kind: 'struct';
      readonly size: number;
      readonly fields: readonly {
        readonly name: string;
        readonly offset: number;
        readonly layout: PackLayout;
      }[];
    };

/** What a binding holds, in `reflect()`'s own vocabulary (its `BindEntry` fields). */
export interface PackResource {
  readonly resourceKind:
    'uniform-buffer' | 'storage-buffer' | 'texture' | 'storage-texture' | 'sampler';
  readonly structName?: string;
  readonly textureDim?: string;
  readonly textureElem?: string;
  readonly storageFormat?: string;
  readonly storageAccess?: string;
  readonly textureDepth?: true;
  /** A sampled texture's `sampleType`, the word its bind group layout takes (change 0028): from
   *  its element and the calls that read it, as `reflect()` reports it. A manifest written
   *  before it carries none, and a reader lays such a texture out from its element. */
  readonly sampleType?: 'float' | 'unfilterable-float' | 'depth' | 'sint' | 'uint';
  readonly samplerComparison?: true;
}

/** A storage array's data texture on WebGL2: the texture of the binding's name a GLSL ES 3.00
 *  program reads element `i` of at `(i % width, i / width)`, `lanes` texels per element. The
 *  host gives the texture this internal format; any other makes every read return 0. */
export interface PackDataTexture {
  readonly format: 'r32float' | 'r32uint' | 'r32sint';
  readonly lanes: number;
}

/**
 * One resource slot. `name`, `space`, `group`, `binding`, `access` and `type` are the fields
 * `packModule()` has always given; the rest came with schema 1.
 */
export interface PackBinding {
  readonly name: string;
  readonly space: string;
  readonly group: number;
  readonly binding: number;
  readonly access?: 'read' | 'read_write';
  /** The `typeKey` spelling: `vec4<f32>`, `array<f32>`, `texture_2d<f32>`. */
  readonly type: string;
  readonly resource: PackResource;
  /** The stages whose entries reach it, which its bind group layout's visibility names. */
  readonly stages: readonly ('vertex' | 'fragment' | 'compute')[];
  /** A buffer's byte layout, under `rule`; absent on a handle. */
  readonly layout?: PackLayout;
  readonly rule?: 'std140' | 'std430';
  /** Why a buffer has no host layout: a `bool`, a two-row matrix in a uniform. */
  readonly noLayout?: string;
  /** A binding the emit adds, which the host binds as it binds any other: the `_fp64` guard, a
   *  1 × 1 texture that holds 1.0, and the recorded variant's `_console` buffer. */
  readonly injected?: true;
  /** A storage array's data texture on WebGL2, when the GLSL ES 3.00 program reads it as one. */
  readonly dataTexture?: PackDataTexture;
}

/** One field of an entry's stage interface, as `reflect()` reports it (its `EntryIoField`), with
 *  its interpolation. */
export interface PackIo {
  readonly name: string;
  readonly type: string;
  readonly location?: number;
  readonly builtin?: string;
  readonly interpolate?: string;
}

/** Where a declaration is: its file as the compiler was given it, and its line from 1. */
export interface PackLine {
  readonly file: string;
  readonly line: number;
}

/** A shader entry point. `name` and `stage` are the fields `packModule()` has always given. */
export interface PackEntry {
  readonly name: string;
  readonly stage: string;
  /** `@workgroup_size(x, y, z)`, for a compute entry. */
  readonly workgroupSize?: readonly [number, number, number];
  readonly inputs?: readonly PackIo[];
  readonly outputs?: readonly PackIo[];
  /** The bindings the entry reaches through its calls, and whether it writes each. */
  readonly bindings?: readonly { readonly name: string; readonly writes: boolean }[];
  /** A vertex entry's vertex buffer, tightly packed, with formats. */
  readonly vertex?: GpuVertexLayout;
  readonly line?: PackLine;
}

export interface PackOverride {
  readonly name: string;
  readonly type: string;
  readonly default: number | boolean;
}

/** The recorded variant: the WGSL that writes each `console.*` call an entry reaches into the
 *  console buffer (change 0014), the table the buffer decodes with, and the variant's bindings,
 *  where the `_console` buffer is added and the `_fp64` guard moves one slot past it. */
export interface PackConsole {
  readonly wgsl: string;
  readonly log: ConsoleLog;
  readonly bindings: readonly PackBinding[];
}

/** How the WebGL2 tier draws a fragment entry: its GLSL ES 3.00 fragment program, each uniform
 *  binding's block name, the one sampler each texture is sampled with, and the read-only storage
 *  arrays it reads as data textures (their `dataTexture`), when it reads any. */
export interface PackGlDraw {
  readonly fragment: string;
  readonly blocks: Readonly<Record<string, string>>;
  readonly samplers: Readonly<Record<string, string | null>>;
  readonly data?: readonly string[];
}

/** How the WebGL2 tier runs a vertex entry (change 0054): its GLSL ES 3.00 vertex program, and
 *  what it binds, as {@link PackGlDraw} gives a fragment entry's. */
export interface PackGlVertex {
  readonly vertex: string;
  readonly blocks: Readonly<Record<string, string>>;
  readonly samplers: Readonly<Record<string, string | null>>;
  readonly data?: readonly string[];
}

/** What a typed manifest says of its entries (change 0030): for each entry, by its name, the
 *  values a draw or a dispatch may bind, by the names the source declares. */
export type PackBindings = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

declare const entryBindings: unique symbol;

/** The serialisable result of {@link buildManifest}: see there.
 *
 *  `E` is the bindings each entry reaches (change 0030). The host view of a module types its
 *  default export with them, and the program runtime carries them to each draw and dispatch. A
 *  manifest read from JSON, or built at run time, is `Pack` with no argument, which takes any
 *  bindings. Nothing at run time holds `E`. */
export interface Pack<E extends PackBindings = PackBindings> {
  /** The manifest's schema, which a reader checks first (Rule 11.10). */
  readonly schema: typeof PACK_SCHEMA;
  /** The package version that wrote it. */
  readonly compiler: string;
  /** The options the program was emitted under, when the build gave any of the three a manifest
   *  can record (`packModule(m, { emit })`, its `plugins` apart, which it cannot): the optimization
   *  `level`, the `parens` and the `fp64Flavor`. One the build did not give is absent and stands
   *  for its default (`'O2'`, `'full'` and `'float'`), and a manifest built with none has no `emit`.
   *  The load-time emitter emits the program again under them (Rule 11.10). */
  readonly emit?: {
    readonly level?: 'O0' | 'O1' | 'O2';
    readonly parens?: 'full' | 'minimal';
    readonly fp64Flavor?: 'float' | 'integer';
  };
  readonly wgsl: string;
  readonly glsl?: { readonly vertex: string; readonly fragment: string };
  readonly bindings: readonly PackBinding[];
  /** The first vertex entry's vertex buffer, as `entries[].vertex` gives each. */
  readonly vertexLayout?: GpuVertexLayout;
  readonly entries: readonly PackEntry[];
  readonly structs: readonly {
    readonly name: string;
    readonly fields: readonly { name: string; type: string }[];
  }[];
  readonly overrides: readonly PackOverride[];
  /** The `GPUFeatureName`s a device must have to create the program's pipelines. */
  readonly features: readonly string[];
  readonly console?: PackConsole;
  /** The program as portable IR, when the build asked for it: what `repack()` emits again. Only
   *  the package version that wrote it reads it. */
  readonly ir?: PortableIr;
  /** What the WebGL2 tier uses: each full-screen fragment entry's draw, or why it has none. */
  readonly gl?: {
    /** Each vertex entry's vertex program on WebGL2 (change 0054), or why it has none. */
    readonly vertices?: Readonly<Record<string, PackGlVertex | { readonly none: string }>>;
    /** Each fragment entry's fragment program on WebGL2, or why it has none: a render
     *  pipeline links it with a vertex entry's, and a full-screen draw with the tier's own. */
    readonly draws?: Readonly<Record<string, PackGlDraw | { readonly none: string }>>;
    /** Each compute entry's pass program on WebGL2 (change 0054), or why it has none. */
    readonly computes?: Readonly<Record<string, PackGlCompute | { readonly none: string }>>;
  };
  /** The type of the bindings each entry reaches, which only the type checker reads. */
  readonly [entryBindings]?: E;
}

// ─── the call layer's layouts ────────────────────────────────────────────────────────────────

/** The call layer's compact layout, written out for the manifest. */
export function packLayout(l: Layout): PackLayout {
  switch (l.k) {
    case 's':
      return { kind: 'scalar', type: l.t };
    case 'v':
      return { kind: 'vector', size: l.n, type: l.t, ...(l.lo !== undefined ? { lo: l.lo } : {}) };
    case 'm':
      return { kind: 'matrix', columns: l.c, rows: l.r, columnStride: l.cs };
    case 'a':
      return { kind: 'array', length: l.n, stride: l.st, element: packLayout(l.e) };
    case 'o':
      return {
        kind: 'struct',
        size: l.sz,
        fields: l.f.map(([name, offset, fl]) => ({ name, offset, layout: packLayout(fl) })),
      };
  }
}

/** A manifest's layout as the call layer's compact one, which `pack()` and `readInto()` read. */
export function layoutFromPack(l: PackLayout): Layout {
  switch (l.kind) {
    case 'scalar':
      return { k: 's', t: l.type };
    case 'vector':
      return { k: 'v', n: l.size, t: l.type, ...(l.lo !== undefined ? { lo: l.lo } : {}) };
    case 'matrix':
      return { k: 'm', c: l.columns, r: l.rows, cs: l.columnStride };
    case 'array':
      return { k: 'a', n: l.length, st: l.stride, e: layoutFromPack(l.element) };
    case 'struct':
      return {
        k: 'o',
        sz: l.size,
        f: l.fields.map((f) => [f.name, f.offset, layoutFromPack(f.layout)] as const),
      };
  }
}
