// ═══ An entry point called from host code (Rule 8.24, surface §67) ═══
//
// `entry(bindings, workgroups)` on a `@compute` entry a host file imported (change 0016). The
// Vite plugin writes everything the call needs into the generated module at build time, as a
// `ComputeEntry` literal: the module's WGSL, the entry's workgroup shape and builtins, and for
// each binding the entry reaches its group, binding, address space, whether the entry writes
// it, and its byte layout. So the runtime packs, dispatches and reads back from data alone, and
// the application ships no compiler (Rule 11.7).
//
// Two tiers:
//
//   1. WebGPU. The module is created and the pipeline built on the first call, and both are
//      kept per device. Each binding is packed into a buffer by its layout, the entry is
//      dispatched over the workgroup count as written, and every storage binding it writes is
//      copied back and read into the caller's value in place.
//   2. The CPU tier: the generated code (Rule 11.7), each invocation of each workgroup in turn
//      (z, then y, then x), with the builtins filled in and the workgroup memory zeroed per
//      workgroup. An entry that reaches a barrier has no CPU tier: lockstep needs the
//      interpreter's generators, which the runtime does not ship.
//
// Like the rest of `typeshade/runtime` it imports no compiler, and it names no WebGPU type:
// the library build has no host types (`types: []`), so the few WebGPU calls it makes go
// through the small structural interfaces below, as `core/compute/runner.ts` does.

import type { CpuValue } from './cpu-runtime.js';

// ─── what the generated module carries ───────────────────────────────────────────────────────

/** A 4-byte number a binding holds. */
export type LayoutNumber = 'f32' | 'i32' | 'u32';

/** The byte layout of a binding's type, computed at build time from `reflect()`'s rules (std430
 *  for storage, the uniform rules for uniform), so the runtime computes no layout itself. */
export type Layout =
  | { readonly k: 's'; readonly t: LayoutNumber }
  | { readonly k: 'v'; readonly n: number; readonly t: LayoutNumber }
  /** `cs` is the column stride in bytes; a matrix is f32. */
  | { readonly k: 'm'; readonly c: number; readonly r: number; readonly cs: number }
  /** `n` is null for a runtime-sized array; `st` is the element stride in bytes. */
  | { readonly k: 'a'; readonly n: number | null; readonly st: number; readonly e: Layout }
  /** A struct: each field's name, byte offset and layout, and the struct's size. */
  | {
      readonly k: 'o';
      readonly f: readonly (readonly [string, number, Layout])[];
      readonly sz: number;
    };

/** One binding an entry reaches. `s` is its TypeShade type, which a refusal names. */
export interface EntryBinding {
  readonly name: string;
  readonly group: number;
  readonly binding: number;
  readonly space: 'uniform' | 'storage';
  /** Whether the entry writes it, so the call reads it back. */
  readonly writes: boolean;
  readonly layout: Layout;
  readonly s: string;
}

/** A `texture_2d<f32>` or `sampler` binding an entry reaches. */
export interface HandleBinding {
  readonly name: string;
  readonly group: number;
  readonly binding: number;
  readonly space: 'texture' | 'sampler';
  readonly s: string;
}

/** A binding an entry reaches: a buffer (read only: a draw reads nothing back) or a
 *  handle. */
export type DrawBinding = EntryBinding | HandleBinding;

export const isBuffer = (b: DrawBinding): b is EntryBinding =>
  b.space === 'uniform' || b.space === 'storage';

/** A `@compute` entry a host can call, as the generated module writes it. */
export interface ComputeEntry {
  /** The name the host imports. */
  readonly name: string;
  /** The entry's name in the WGSL and in the generated CPU code. */
  readonly fn: string;
  readonly wgsl: string;
  /** `@workgroup_size(x, y, z)`. */
  readonly wg: readonly [number, number, number];
  /** Each parameter's builtin, in order. */
  readonly params: readonly string[];
  readonly bindings: readonly DrawBinding[];
  /** The module's workgroup variables and their zero values, for the CPU tier. */
  readonly workgroupZero: Readonly<Record<string, CpuValue>>;
  /** Where the entry reaches a barrier, when it does: then it has no CPU tier. */
  readonly barrier?: string;
  /** Why the CPU tier cannot run the entry otherwise, when it cannot (a texture, a call only a
   *  GPU computes). */
  readonly noCpu?: string;
}

/** What the generated module hands the call: the CPU tier's functions and the runtime they
 *  close over. */
export interface GeneratedCpu {
  readonly F: Record<string, (...a: CpuValue[]) => CpuValue>;
  readonly $: { bindings: Record<string, CpuValue>; vars: Record<string, CpuValue> };
}

// ─── checking and packing host values ────────────────────────────────────────────────────────

/** A refusal inside a value, unwound to the call, which names the entry and the binding. */
export class Misfit {
  constructor(
    readonly path: string,
    readonly problem: string,
  ) {}
}

const RANGE: Record<'i32' | 'u32', readonly [number, number]> = {
  i32: [-0x80000000, 0x7fffffff],
  u32: [0, 0xffffffff],
};

export function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `an array of length ${v.length}`;
  if (ArrayBuffer.isView(v)) return `a ${v.constructor.name}`;
  if (typeof v === 'object') return 'an object';
  if (typeof v === 'string') return `the string ${JSON.stringify(v)}`;
  return `${typeof v} ${String(v)}`;
}

function checkNumber(t: LayoutNumber, v: unknown, path: string): number {
  if (typeof v !== 'number') throw new Misfit(path, `got ${describe(v)}`);
  if (t !== 'f32') {
    const [lo, hi] = RANGE[t];
    if (!Number.isInteger(v) || v < lo || v > hi)
      throw new Misfit(path, `got ${v}, which is not a whole number in the ${t} range`);
  }
  return v;
}

function listOf(v: unknown, n: number, path: string): ArrayLike<unknown> {
  if (typeof v !== 'object' || v === null || typeof (v as { length?: unknown }).length !== 'number')
    throw new Misfit(path, `got ${describe(v)}`);
  const xs = v as ArrayLike<unknown>;
  if (xs.length !== n)
    throw new Misfit(
      path,
      Array.isArray(v) ? `got ${describe(v)}` : `got ${describe(v)} of length ${xs.length}`,
    );
  return xs;
}

/** The typed array a runtime-sized array of scalars or vectors of `t` takes. */
const TYPED = {
  f32: Float32Array,
  i32: Int32Array,
  u32: Uint32Array,
} as const;

/** How many numbers one element of a runtime-sized array is, for an array whose host value is a
 *  typed array; undefined for an array of structs or of arrays, which takes an array. */
function flatWidth(e: Layout): { n: number; t: LayoutNumber } | undefined {
  if (e.k === 's') return { n: 1, t: e.t };
  if (e.k === 'v') return { n: e.n, t: e.t };
  return undefined;
}

/** How many elements a runtime-sized array's host value holds. */
function runtimeCount(l: Layout & { k: 'a' }, v: unknown, path: string): number {
  const flat = flatWidth(l.e);
  if (flat !== undefined) {
    const Want = TYPED[flat.t];
    if (!(v instanceof Want)) throw new Misfit(path, `got ${describe(v)}, not a ${Want.name}`);
    if (v.length % flat.n !== 0)
      throw new Misfit(
        path,
        `got ${v.length} numbers, which is not a whole number of ${flat.n}-component elements`,
      );
    return v.length / flat.n;
  }
  if (!Array.isArray(v)) throw new Misfit(path, `got ${describe(v)}, not an array`);
  return v.length;
}

/** The byte size of `v` packed by `l`, checking the shape as it goes. */
export function byteSize(l: Layout, v: unknown, path: string): number {
  if (l.k === 'a' && l.n === null) {
    const count = runtimeCount(l, v, path);
    if (count === 0) throw new Misfit(path, 'got an empty array, which WebGPU cannot bind');
    return count * l.st;
  }
  return fixedSize(l);
}

function fixedSize(l: Layout): number {
  switch (l.k) {
    case 's':
      return 4;
    case 'v':
      return l.n * 4;
    case 'm':
      return l.c * l.cs;
    case 'a':
      return (l.n ?? 0) * l.st;
    case 'o':
      return l.sz;
  }
}

function writeNumber(dv: DataView, at: number, t: LayoutNumber, x: number): void {
  if (t === 'f32') dv.setFloat32(at, x, true);
  else if (t === 'i32') dv.setInt32(at, x, true);
  else dv.setUint32(at, x, true);
}

function readNumber(dv: DataView, at: number, t: LayoutNumber): number {
  return t === 'f32'
    ? dv.getFloat32(at, true)
    : t === 'i32'
      ? dv.getInt32(at, true)
      : dv.getUint32(at, true);
}

/** Write host value `v` into `dv` at `at` by layout `l`, checking it. A written scalar binding's
 *  host value is a one-element typed array (`box`), since a number cannot be written in place. */
export function pack(
  dv: DataView,
  at: number,
  l: Layout,
  v: unknown,
  path: string,
  box = false,
): void {
  switch (l.k) {
    case 's': {
      const x = box ? unbox(l.t, v, path) : checkNumber(l.t, v, path);
      writeNumber(dv, at, l.t, x);
      return;
    }
    case 'v': {
      const xs = listOf(v, l.n, path);
      for (let i = 0; i < l.n; i++)
        writeNumber(dv, at + 4 * i, l.t, checkNumber(l.t, xs[i], `${path}[${i}]`));
      return;
    }
    case 'm': {
      const xs = listOf(v, l.c * l.r, path);
      for (let c = 0; c < l.c; c++)
        for (let r = 0; r < l.r; r++) {
          const i = c * l.r + r;
          dv.setFloat32(at + c * l.cs + 4 * r, checkNumber('f32', xs[i], `${path}[${i}]`), true);
        }
      return;
    }
    case 'a': {
      const flat = l.n === null ? flatWidth(l.e) : undefined;
      if (flat !== undefined) {
        const xs = v as ArrayLike<number>;
        const count = xs.length / flat.n;
        for (let i = 0; i < count; i++)
          for (let j = 0; j < flat.n; j++)
            writeNumber(dv, at + i * l.st + 4 * j, flat.t, xs[i * flat.n + j]!);
        return;
      }
      const xs = l.n === null ? (v as unknown[]) : listOf(v, l.n, path);
      for (let i = 0; i < xs.length; i++) pack(dv, at + i * l.st, l.e, xs[i], `${path}[${i}]`);
      return;
    }
    case 'o': {
      if (typeof v !== 'object' || v === null || Array.isArray(v))
        throw new Misfit(path, `got ${describe(v)}`);
      const o = v as Record<string, unknown>;
      for (const [name, off, fl] of l.f) {
        if (!(name in o)) throw new Misfit(`${path}.${name}`, 'the field is missing');
        pack(dv, at + off, fl, o[name], `${path}.${name}`);
      }
      return;
    }
  }
}

function unbox(t: LayoutNumber, v: unknown, path: string): number {
  const Want = TYPED[t];
  if (!(v instanceof Want) || v.length !== 1)
    throw new Misfit(
      path,
      `got ${describe(v)}; a scalar the entry writes is passed as a ${Want.name} of length 1, which the call writes back`,
    );
  return v[0]!;
}

/** Read `l` at `at` into the caller's value `target` in place, and return what to store where
 *  it came from when `target` cannot be updated in place (a number). */
function readInto(dv: DataView, at: number, l: Layout, target: unknown): unknown {
  switch (l.k) {
    case 's':
      return readNumber(dv, at, l.t);
    case 'v':
    case 'm': {
      const n = l.k === 'v' ? l.n : l.c * l.r;
      const out = writableList(target, n) ?? new Array<number>(n);
      if (l.k === 'v') for (let i = 0; i < n; i++) out[i] = readNumber(dv, at + 4 * i, l.t);
      else
        for (let c = 0; c < l.c; c++)
          for (let r = 0; r < l.r; r++)
            out[c * l.r + r] = dv.getFloat32(at + c * l.cs + 4 * r, true);
      return out;
    }
    case 'a': {
      const flat = l.n === null ? flatWidth(l.e) : undefined;
      if (flat !== undefined) {
        const xs = target as { length: number; [i: number]: number };
        const count = xs.length / flat.n;
        for (let i = 0; i < count; i++)
          for (let j = 0; j < flat.n; j++)
            xs[i * flat.n + j] = readNumber(dv, at + i * l.st + 4 * j, flat.t);
        return xs;
      }
      const xs = target as unknown[];
      for (let i = 0; i < xs.length; i++) xs[i] = readInto(dv, at + i * l.st, l.e, xs[i]);
      return xs;
    }
    case 'o': {
      const o = target as Record<string, unknown>;
      for (const [name, off, fl] of l.f) o[name] = readInto(dv, at + off, fl, o[name]);
      return o;
    }
  }
}

// ─── textures and samplers ───────────────────────────────────────────────────────────────────

/** An image source a `texture_2d<f32>` takes, with its size. */
export interface Image {
  readonly source: object;
  readonly width: number;
  readonly height: number;
  /** An `ImageData`'s pixels, which WebGPU uploads with `writeTexture`. */
  readonly data?: Uint8ClampedArray;
}

const IMAGE_KINDS = [
  'ImageBitmap',
  'ImageData',
  'HTMLImageElement',
  'HTMLCanvasElement',
  'HTMLVideoElement',
  'OffscreenCanvas',
] as const;

export function imageOf(v: unknown): Image | string {
  const g = globalThis as unknown as Record<string, (abstract new () => unknown) | undefined>;
  const kind = IMAGE_KINDS.find((k) => g[k] !== undefined && v instanceof g[k]);
  if (kind === undefined) return `got ${describe(v)}, not an image source`;
  const o = v as Record<string, unknown>;
  const [width, height] =
    kind === 'HTMLImageElement'
      ? [o.naturalWidth, o.naturalHeight]
      : kind === 'HTMLVideoElement'
        ? [o.videoWidth, o.videoHeight]
        : [o.width, o.height];
  if (typeof width !== 'number' || typeof height !== 'number' || width === 0 || height === 0)
    return `got a ${kind} of no pixels (${String(width)}x${String(height)}); an image draws once it has loaded`;
  return {
    source: v as object,
    width,
    height,
    ...(kind === 'ImageData' ? { data: o.data as Uint8ClampedArray } : {}),
  };
}

/** A `sampler`'s host value, with its defaults. */
export interface Sampling {
  readonly filter: 'nearest' | 'linear';
  readonly address: 'clamp' | 'repeat' | 'mirror';
}

export function samplingOf(v: unknown): Sampling | string {
  if (v === undefined) return { filter: 'linear', address: 'clamp' };
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    return `got ${describe(v)}; a sampler is { filter?, address? }`;
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o))
    if (k !== 'filter' && k !== 'address')
      return `got a property "${k}"; a sampler is { filter?, address? }`;
  const filter = o.filter ?? 'linear';
  const address = o.address ?? 'clamp';
  if (filter !== 'nearest' && filter !== 'linear')
    return `got filter ${describe(filter)}; it is 'nearest' or 'linear'`;
  if (address !== 'clamp' && address !== 'repeat' && address !== 'mirror')
    return `got address ${describe(address)}; it is 'clamp', 'repeat' or 'mirror'`;
  return { filter, address };
}

/** A sampler's address mode, as WebGPU spells it. */
export const ADDRESS = {
  clamp: 'clamp-to-edge',
  repeat: 'repeat',
  mirror: 'mirror-repeat',
} as const;

// ─── the CPU tier's values ───────────────────────────────────────────────────────────────────

/** The CPU tier's value of a host value: the representation the generated code runs on. */
export function toCpu(l: Layout, v: unknown, box: boolean): CpuValue {
  switch (l.k) {
    case 's': {
      const x = box ? (v as ArrayLike<number>)[0]! : (v as number);
      return (l.t === 'f32' ? Math.fround(x) : x) as CpuValue;
    }
    case 'v':
    case 'm': {
      const xs = Array.from(v as ArrayLike<number>);
      return (l.k === 'm' || l.t === 'f32' ? xs.map(Math.fround) : xs) as CpuValue;
    }
    case 'a': {
      const flat = l.n === null ? flatWidth(l.e) : undefined;
      if (flat !== undefined) {
        const xs = v as ArrayLike<number>;
        const count = xs.length / flat.n;
        const out: CpuValue[] = [];
        for (let i = 0; i < count; i++) {
          if (flat.n === 1) out.push(xs[i]! as CpuValue);
          else out.push(Array.from({ length: flat.n }, (_, j) => xs[i * flat.n + j]!) as CpuValue);
        }
        return out as unknown as CpuValue;
      }
      return Array.from(v as ArrayLike<unknown>, (x) =>
        toCpu(l.e, x, false),
      ) as unknown as CpuValue;
    }
    case 'o': {
      const o = v as Record<string, unknown>;
      const out: Record<string, CpuValue> = {};
      for (const [name, , fl] of l.f) out[name] = toCpu(fl, o[name], false);
      return out as unknown as CpuValue;
    }
  }
}

/** Write the CPU tier's value `c` back into the caller's value `target` in place. */
function fromCpu(l: Layout, c: CpuValue, target: unknown, box: boolean): unknown {
  switch (l.k) {
    case 's':
      if (box) {
        (target as { [i: number]: number })[0] = c as number;
        return target;
      }
      return c;
    case 'v':
    case 'm': {
      const xs = c as unknown as number[];
      const out = writableList(target, xs.length);
      if (out === undefined) return [...xs];
      for (let i = 0; i < xs.length; i++) out[i] = xs[i]!;
      return out;
    }
    case 'a': {
      const flat = l.n === null ? flatWidth(l.e) : undefined;
      const els = c as unknown as CpuValue[];
      if (flat !== undefined) {
        const xs = target as { length: number; [i: number]: number };
        const count = xs.length / flat.n;
        for (let i = 0; i < count; i++) {
          if (flat.n === 1) xs[i] = els[i] as number;
          else for (let j = 0; j < flat.n; j++) xs[i * flat.n + j] = (els[i] as number[])[j]!;
        }
        return xs;
      }
      const xs = target as unknown[];
      for (let i = 0; i < xs.length; i++) xs[i] = fromCpu(l.e, els[i]!, xs[i], false);
      return xs;
    }
    case 'o': {
      const o = target as Record<string, unknown>;
      const src = c as unknown as Record<string, CpuValue>;
      for (const [name, , fl] of l.f) o[name] = fromCpu(fl, src[name]!, o[name], false);
      return o;
    }
  }
}

/** `target` as a list of `n` numbers to write into, when it is one (an array or a typed array);
 *  undefined when it is not, and the caller stores a new array where it came from. */
function writableList(target: unknown, n: number): { [i: number]: number } | undefined {
  if (typeof target !== 'object' || target === null) return undefined;
  const len = (target as { length?: unknown }).length;
  return len === n && !Object.isFrozen(target) ? (target as { [i: number]: number }) : undefined;
}

/** A deep copy, for the workgroup memory each workgroup starts from. */
const copy = (v: CpuValue): CpuValue => JSON.parse(JSON.stringify(v)) as CpuValue;

// ─── WebGPU, structurally ────────────────────────────────────────────────────────────────────

interface GpuBuffer {
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}
interface GpuPipeline {
  getBindGroupLayout(index: number): unknown;
}
interface GpuShaderModule {
  getCompilationInfo(): Promise<{
    messages: readonly { type: string; message: string; lineNum: number; linePos: number }[];
  }>;
}
export interface GpuDevice {
  createShaderModule(d: { code: string }): GpuShaderModule;
  createComputePipeline(d: {
    layout: 'auto';
    compute: { module: GpuShaderModule; entryPoint: string };
  }): GpuPipeline;
  createBuffer(d: { size: number; usage: number }): GpuBuffer;
  createBindGroup(d: {
    layout: unknown;
    entries: readonly { binding: number; resource: unknown }[];
  }): unknown;
  createCommandEncoder(): {
    beginComputePass(): {
      setPipeline(p: GpuPipeline): void;
      setBindGroup(i: number, g: unknown): void;
      dispatchWorkgroups(x: number, y: number, z: number): void;
      end(): void;
    };
    copyBufferToBuffer(s: GpuBuffer, so: number, d: GpuBuffer, dO: number, n: number): void;
    finish(): unknown;
  };
  pushErrorScope(filter: 'validation'): void;
  popErrorScope(): Promise<{ message: string } | null>;
  readonly queue: {
    writeBuffer(b: GpuBuffer, offset: number, data: ArrayBuffer): void;
    submit(cmds: readonly unknown[]): void;
  };
  readonly lost: Promise<unknown>;
}

/** `GPUBufferUsage` and `GPUMapMode`, whose values the WebGPU specification fixes. */
const USAGE = { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 } as const;
const MAP_READ = 1;

let device: Promise<GpuDevice | null> | undefined;

/** The device every call shares, requested on the first call; null where WebGPU is absent. */
export function gpuDevice(): Promise<GpuDevice | null> {
  return (device ??= (async () => {
    const gpu = (
      globalThis as {
        navigator?: {
          gpu?: { requestAdapter(): Promise<{ requestDevice(): Promise<GpuDevice> } | null> };
        };
      }
    ).navigator?.gpu;
    if (gpu === undefined) return null;
    const adapter = await gpu.requestAdapter();
    if (adapter === null) return null;
    const d = await adapter.requestDevice();
    // A lost device is requested again by the next call.
    void d.lost.then(() => {
      device = undefined;
    });
    return d;
  })());
}

const pipelines = new WeakMap<GpuDevice, Map<ComputeEntry, Promise<GpuPipeline>>>();

async function pipelineFor(d: GpuDevice, e: ComputeEntry): Promise<GpuPipeline> {
  let per = pipelines.get(d);
  if (per === undefined) pipelines.set(d, (per = new Map()));
  let p = per.get(e);
  if (p === undefined) {
    p = (async () => {
      const module = d.createShaderModule({ code: e.wgsl });
      const errors = (await module.getCompilationInfo()).messages.filter((m) => m.type === 'error');
      if (errors.length > 0)
        throw new Error(
          `${e.name}: WebGPU refused the module's WGSL: ${errors.map((m) => `line ${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`,
        );
      return d.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: e.fn } });
    })();
    per.set(e, p);
  }
  return p;
}

// ─── the call ────────────────────────────────────────────────────────────────────────────────

/** The workgroup count, checked: `n` or `[x, y?, z?]`, whole numbers. */
function workgroupsOf(e: ComputeEntry, w: unknown): [number, number, number] {
  const xs = typeof w === 'number' ? [w] : Array.isArray(w) ? w : undefined;
  if (xs === undefined || xs.length < 1 || xs.length > 3)
    throw new TypeError(
      `${e.name}(): "workgroups" is a number or [x, y?, z?] of workgroups; got ${describe(w)}.`,
    );
  const out: [number, number, number] = [1, 1, 1];
  xs.forEach((x, i) => {
    if (typeof x !== 'number' || !Number.isInteger(x) || x < 0)
      throw new TypeError(
        `${e.name}(): "workgroups" counts workgroups, so each is a whole number; got ${describe(x)}.`,
      );
    out[i] = x;
  });
  return out;
}

/** A call's bindings, checked: the host's object, and each handle's image or sampling. */
export interface Checked {
  readonly values: Record<string, unknown>;
  readonly images: Map<string, Image>;
  readonly samplers: Map<string, Sampling>;
}

/** Check the bindings object: exactly the entry's bindings, each fitting its type. A sampler
 *  may be left out, for linear filtering and clamping. */
export function checkBindings(
  e: { readonly name: string; readonly bindings: readonly DrawBinding[] },
  v: unknown,
): Checked {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    throw new TypeError(
      `${e.name}(): "bindings" is an object of the entry's bindings; got ${describe(v)}.`,
    );
  const o = v as Record<string, unknown>;
  const names = new Set(e.bindings.map((b) => b.name));
  for (const k of Object.keys(o))
    if (!names.has(k))
      throw new TypeError(
        `${e.name}(): the entry reaches no binding "${k}"; it takes ${[...names].map((n) => `"${n}"`).join(', ') || 'none'}.`,
      );
  const checked: Checked = { values: o, images: new Map(), samplers: new Map() };
  for (const b of e.bindings) {
    if (!(b.name in o) && b.space !== 'sampler')
      throw new TypeError(`${e.name}(): binding "${b.name}" (${b.s}) is missing.`);
    if (!isBuffer(b)) {
      const got = b.space === 'texture' ? imageOf(o[b.name]) : samplingOf(o[b.name]);
      if (typeof got === 'string')
        throw new TypeError(`${e.name}(): binding "${b.name}" (${b.s}): ${got}.`);
      if (b.space === 'texture') checked.images.set(b.name, got as Image);
      else checked.samplers.set(b.name, got as Sampling);
      continue;
    }
    try {
      // A dry pack into scratch memory runs every check before anything is uploaded.
      const size = byteSize(b.layout, o[b.name], '');
      pack(new DataView(new ArrayBuffer(Math.max(4, size))), 0, b.layout, o[b.name], '', boxed(b));
    } catch (err) {
      if (!(err instanceof Misfit)) throw err;
      const at = err.path === '' ? '' : `at ${err.path}, `;
      throw new TypeError(`${e.name}(): binding "${b.name}" (${b.s}): ${at}${err.problem}.`);
    }
  }
  return checked;
}

/** A written storage binding whose type is one scalar is passed boxed. */
export const boxed = (b: EntryBinding): boolean => b.writes && b.layout.k === 's';

/** A buffer binding's bytes, packed by its layout and padded to a multiple of 16. */
export function packed(b: EntryBinding, v: unknown): ArrayBuffer {
  const size = byteSize(b.layout, v, '');
  const bytes = new ArrayBuffer(Math.max(16, Math.ceil(size / 16) * 16));
  pack(new DataView(bytes), 0, b.layout, v, '', boxed(b));
  return bytes;
}

/** `GPUTextureUsage`, whose values the WebGPU specification fixes. */
const TEXTURE_USAGE = { COPY_DST: 2, TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16 } as const;

/** The part of a WebGPU device a texture or sampler binding needs. */
interface HandleDevice {
  createTexture(d: object): { createView(): unknown; destroy(): void };
  createSampler(d: object): unknown;
  readonly queue: {
    writeTexture(dst: object, data: ArrayBufferView, layout: object, size: object): void;
    copyExternalImageToTexture(src: object, dst: object, size: object): void;
  };
}

/** A texture binding's image, uploaded to a new `rgba8unorm` texture, or a sampler binding's
 *  sampler. The texture is pushed onto `owned`, to destroy once the work is submitted. */
export function gpuHandle(
  d: HandleDevice,
  b: DrawBinding,
  c: Checked,
  owned: { destroy(): void }[],
): unknown {
  if (b.space === 'texture') {
    const img = c.images.get(b.name)!;
    const texture = d.createTexture({
      size: [img.width, img.height],
      format: 'rgba8unorm',
      usage:
        TEXTURE_USAGE.TEXTURE_BINDING | TEXTURE_USAGE.COPY_DST | TEXTURE_USAGE.RENDER_ATTACHMENT,
    });
    if (img.data !== undefined)
      d.queue.writeTexture(
        { texture },
        img.data,
        { bytesPerRow: 4 * img.width, rowsPerImage: img.height },
        [img.width, img.height],
      );
    else
      d.queue.copyExternalImageToTexture({ source: img.source }, { texture }, [
        img.width,
        img.height,
      ]);
    owned.push(texture);
    return texture.createView();
  }
  const s = c.samplers.get(b.name)!;
  return d.createSampler({
    magFilter: s.filter,
    minFilter: s.filter,
    addressModeU: ADDRESS[s.address],
    addressModeV: ADDRESS[s.address],
  });
}

/**
 * Call a `@compute` entry from host code (Rule 8.24): dispatch `workgroups` workgroups of it
 * with `bindings`, on WebGPU when there is one and on the CPU tier otherwise, and read every
 * storage binding it writes back into the caller's value in place.
 *
 * @throws `TypeError` naming the entry and the binding for a value that does not fit, and for
 *   an entry the CPU tier cannot run (a barrier, a texture) where there is no WebGPU.
 */
export async function callCompute(
  cpu: GeneratedCpu,
  e: ComputeEntry,
  argc: number,
  bindings: unknown,
  workgroups: unknown,
): Promise<void> {
  if (argc !== 2)
    throw new TypeError(`${e.name}() takes 2 arguments, (bindings, workgroups); got ${argc}.`);
  const checked = checkBindings(e, bindings);
  const wg = workgroupsOf(e, workgroups);
  const d = await gpuDevice();
  if (d !== null) return onGpu(d, e, checked, wg);
  if (e.barrier !== undefined)
    throw new TypeError(
      `${e.name}() needs WebGPU: it reaches ${e.barrier}, and a barrier has no CPU tier.`,
    );
  if (e.noCpu !== undefined)
    throw new TypeError(`${e.name}() needs WebGPU: ${e.noCpu}, and the CPU tier cannot.`);
  onCpu(cpu, e, checked.values, wg);
}

async function onGpu(
  d: GpuDevice,
  e: ComputeEntry,
  checked: Checked,
  wg: readonly [number, number, number],
): Promise<void> {
  const { values } = checked;
  const pipeline = await pipelineFor(d, e);
  d.pushErrorScope('validation');
  const buffers = new Map<EntryBinding, { buffer: GpuBuffer; size: number }>();
  const resources = new Map<DrawBinding, unknown>();
  const owned: { destroy(): void }[] = [];
  for (const b of e.bindings) {
    if (!isBuffer(b)) {
      resources.set(b, gpuHandle(d as unknown as HandleDevice, b, checked, owned));
      continue;
    }
    const bytes = packed(b, values[b.name]);
    const buffer = d.createBuffer({
      size: bytes.byteLength,
      usage:
        (b.space === 'uniform' ? USAGE.UNIFORM : USAGE.STORAGE) | USAGE.COPY_DST | USAGE.COPY_SRC,
    });
    d.queue.writeBuffer(buffer, 0, bytes);
    buffers.set(b, { buffer, size: bytes.byteLength });
    resources.set(b, { buffer });
    owned.push(buffer);
  }
  const groups = [...new Set(e.bindings.map((b) => b.group))].sort((a, b) => a - b);
  const encoder = d.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  for (const g of groups)
    pass.setBindGroup(
      g,
      d.createBindGroup({
        layout: pipeline.getBindGroupLayout(g),
        entries: e.bindings
          .filter((b) => b.group === g)
          .map((b) => ({ binding: b.binding, resource: resources.get(b) })),
      }),
    );
  pass.dispatchWorkgroups(wg[0], wg[1], wg[2]);
  pass.end();
  const reads: { b: EntryBinding; staging: GpuBuffer }[] = [];
  for (const [b, { buffer, size }] of buffers) {
    if (!b.writes) continue;
    const staging = d.createBuffer({ size, usage: USAGE.MAP_READ | USAGE.COPY_DST });
    encoder.copyBufferToBuffer(buffer, 0, staging, 0, size);
    reads.push({ b, staging });
  }
  d.queue.submit([encoder.finish()]);
  const error = await d.popErrorScope();
  if (error !== null) throw new Error(`${e.name}(): WebGPU refused the call: ${error.message}`);
  for (const { b, staging } of reads) {
    await staging.mapAsync(MAP_READ);
    const dv = new DataView(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    if (b.layout.k === 's')
      (values[b.name] as { [i: number]: number })[0] = readNumber(dv, 0, b.layout.t);
    else readInto(dv, 0, b.layout, values[b.name]);
  }
  for (const o of owned) o.destroy();
}

function onCpu(
  cpu: GeneratedCpu,
  e: ComputeEntry,
  values: Record<string, unknown>,
  wg: readonly [number, number, number],
): void {
  for (const b of e.bindings)
    if (isBuffer(b)) cpu.$.bindings[b.name] = toCpu(b.layout, values[b.name], boxed(b));
  const fn = cpu.F[e.fn]!;
  const init = cpu.F['$initPrivates'];
  const [sx, sy, sz] = e.wg;
  for (let wz = 0; wz < wg[2]; wz++)
    for (let wy = 0; wy < wg[1]; wy++)
      for (let wx = 0; wx < wg[0]; wx++) {
        for (const [name, zero] of Object.entries(e.workgroupZero)) cpu.$.vars[name] = copy(zero);
        for (let lz = 0; lz < sz; lz++)
          for (let ly = 0; ly < sy; ly++)
            for (let lx = 0; lx < sx; lx++) {
              const lid = [lx, ly, lz];
              const wid = [wx, wy, wz];
              const gid = [wx * sx + lx, wy * sy + ly, wz * sz + lz];
              const args = e.params.map((p): CpuValue => {
                switch (p) {
                  case 'global_invocation_id':
                    return [...gid] as CpuValue;
                  case 'local_invocation_id':
                    return [...lid] as CpuValue;
                  case 'local_invocation_index':
                    return (lz * sy * sx + ly * sx + lx) as CpuValue;
                  case 'workgroup_id':
                    return [...wid] as CpuValue;
                  case 'num_workgroups':
                    return [...wg] as CpuValue;
                  default:
                    return 0 as CpuValue;
                }
              });
              init?.();
              fn(...args);
            }
      }
  // What the entry wrote goes back into the caller's values; a written binding is always one
  // that can be updated in place (a boxed scalar, an array, a typed array or an object).
  for (const b of e.bindings)
    if (isBuffer(b) && b.writes)
      fromCpu(b.layout, cpu.$.bindings[b.name]!, values[b.name], boxed(b));
}
