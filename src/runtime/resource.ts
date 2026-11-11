// ═══ Host resources: uniforms and storage arrays in typed views of one region (change 0138) ═══
//
// Milestone 1 of proposal 0138 (R7 to R9, R17): data typed by a shader `class` is a resource.
//
//   - `uniform(Camera, { … })` is one struct laid out by Rule 6.8's uniform rules (std140).
//   - `zeros(Particle, n)` and `array(Particle, data)` are `n` structs laid out as a storage array
//     with no size (std430), a `Buffer<Particle>`.
//
// Each uniform and storage resource is a byte range of the one region of `runtime/region.ts`.
// A field is reached through its accessor: `camera.pos.set(0, 2, 5)`, `ps.at(i).vel.set(v)`,
// `camera.set({ view, proj })`. `set` checks each number, compares it with what the view holds,
// writes only a changed one, and then marks its bytes dirty: a uniform widens its one dirty range
// (R8), and a storage array keeps a dirty range for each element written, joined into one past
// `DIRTY_RANGE_LIMIT` (R9; Amendment A5, D2). It allocates nothing. `get` returns a scalar field's
// number (an `f64` its joined number), and the typed view of a vector, a matrix or an array field,
// `Readonly` (R8; Amendment A5, D1); a host that writes through a view sets `needsUpdate = true`.
// Each accessor makes its typed view once, and again only when the region's generation moved (a
// compaction or a replaced buffer, Amendment A1).
//
// The layout is the compiler's: the generated module puts each exported class's layouts on the
// class under `Symbol.for('typeshade.layout')` (`classModule` in `compiler/ts/host-face.ts`), so
// the runtime computes no layout itself.
//
// A call of a kernel function or a `@compute` entry takes a resource (milestone 3, R2): a uniform
// as the value it holds at the call, and a storage array through a device copy of its own, a
// `RegionState` behind a hidden `Resident` handle. At the call, the array's dirty ranges are
// copied out of the region and the resource is marked clean; when the call runs, the copy is
// written to the device copy: on WebGPU each range is one `writeBuffer`, and on the CPU tier each
// element is read into the tier's value (Amendment A5, default 3: each call sees the values of its
// own call). A call that writes the array leaves its values on the device until `read()`, which
// lands them in the array's range of the region (R17). Until then `get` throws, and `set` writes
// with no comparison, since the region does not hold what the device holds.
//
// Like the rest of `typeshade/runtime` it imports no compiler.

import type { Layout, LayoutNumber } from '../core/host-entry.js';
import { describe, pack } from '../core/host-entry.js';
import {
  handleOf,
  kernelQueue,
  makeResident,
  ResidentArrayState,
  type Resident,
  type ZeroedArray,
  type ZeroedElement,
} from '../core/resident.js';
import type { array as HostArray, f32, f64, i32, u32 } from './host-types.js';
import type { Texture } from './resources.js';
import { globalRegion, type Range, type Region } from './region.js';
import { defaultDevice } from './default-device.js';
import { throwFailure } from '../core/submission.js';

// ─── the layouts a generated class carries ───────────────────────────────────────────────────

/** The key the generated module puts a class's layouts under. A registered symbol, so a second
 *  copy of the runtime in one page reads the same key. */
export const LAYOUT_KEY: unique symbol = Symbol.for('typeshade.layout') as never;

/** The layouts of an exported class, as the generated module writes them: `u` the struct under
 *  the uniform rules, `s` an array with no size of it under the storage rules, and for each the
 *  reason it has none (`un`, `sn`). `a` marks an abstract class. */
export interface ClassLayouts {
  readonly u?: Layout;
  readonly un?: string;
  readonly s?: Layout & { readonly k: 'a' };
  readonly sn?: string;
  readonly a?: 1;
}

/** A class of a shader module a host imports: a constructor of `T`. */
type ShaderClass<T> = abstract new (...args: never) => T;

/** The layouts of `cls`, or a `TypeError` that says why `at` cannot take it. */
function layoutsOf(cls: unknown, at: string): ClassLayouts & { readonly name: string } {
  const name =
    typeof cls === 'function' && typeof cls.name === 'string' && cls.name !== ''
      ? cls.name
      : undefined;
  const l =
    typeof cls === 'function' ? (cls as unknown as Record<symbol, unknown>)[LAYOUT_KEY] : undefined;
  if (name === undefined || typeof l !== 'object' || l === null)
    throw new TypeError(
      `${at}: takes a class a shader module exports (an import of a .shade.ts), got ${typeof cls === 'function' ? `the function ${name ?? '(anonymous)'}, which no shader module made` : describe(cls)}.`,
    );
  const layouts = l as ClassLayouts;
  if (layouts.a === 1)
    throw new TypeError(
      `${at}: ${name} is abstract, so it has no layout of its own; pass a class that extends it.`,
    );
  return { ...layouts, name };
}

// ─── the resource ────────────────────────────────────────────────────────────────────────────

/** What the garbage collector's registry holds of a resource: its region and the range it has
 *  now, which a resize replaces. */
interface Slot {
  readonly region: Region;
  range: Range;
}

/**
 * How many dirty ranges a storage array keeps before it joins them into one (change 0138,
 * Amendment A5, D2). Each range is one upload call at a submission (`writeBuffer` on WebGPU,
 * `bufferSubData` on WebGL2), and each call costs about as much as the bytes of a few elements.
 * Past 16 calls, a host that wrote scattered elements uploads one range from the first written
 * byte to the last instead: fewer calls for more bytes. Not API: a test reads it.
 */
export const DIRTY_RANGE_LIMIT = 16;

/** What every accessor of one resource shares: its range, its dirty ranges and its name. */
class Core {
  readonly region: Region;
  readonly slot: Slot;
  /** `Uniform<Camera>`, `Buffer<Particle>`: what an error names. */
  readonly name: string;
  /** How to make it again, for an error after `dispose()`. */
  readonly remedy: string;
  /** The bytes of one element of a storage array, whose dirty ranges are kept for each element
   *  written (R9); 0 for a uniform, whose one dirty range is widened (R8). */
  readonly stride: number;
  /** The dirty byte ranges, relative to the resource's start: `[from, to)` pairs, sorted, with no
   *  two that overlap or touch. Made once, so that `set` allocates nothing (R7). */
  readonly #r: Float64Array;
  /** How many pairs of {@link #r} are dirty ranges. */
  #n = 0;
  /** The bytes the resource's value takes of its range, which is rounded up. */
  bytes: number;
  /** Whether a call wrote the resource and the host has not read it back since (change 0138,
   *  R2): the region does not hold what the device holds. */
  ahead = false;
  /** The device copy a call of a storage array uses (milestone 3), made at its first call. */
  state: RegionState | undefined;

  constructor(region: Region, bytes: number, name: string, remedy: string, stride = 0) {
    this.region = region;
    this.slot = { region, range: region.allocate(bytes) };
    this.name = name;
    this.remedy = remedy;
    this.bytes = bytes;
    this.stride = stride;
    this.#r = new Float64Array(stride > 0 ? 2 * (DIRTY_RANGE_LIMIT + 1) : 2);
    // A new resource has never been uploaded: all of it is dirty.
    this.markAll();
  }

  /** The resource's range now. A resize gives the resource another one (Amendment A3). */
  get range(): Range {
    return this.slot.range;
  }

  /** Whether the resource holds a change not yet uploaded. */
  get dirty(): boolean {
    return this.#n > 0;
  }

  /** The dirty ranges, as `[from, to)` pairs relative to the resource's start. */
  ranges(): (readonly [number, number])[] {
    const out: (readonly [number, number])[] = [];
    for (let i = 0; i < this.#n; i++) out.push([this.#r[2 * i]!, this.#r[2 * i + 1]!]);
    return out;
  }

  /** The bytes from the first dirty byte to the last, or undefined when it is clean. */
  span(): { readonly from: number; readonly to: number } | undefined {
    return this.#n === 0 ? undefined : { from: this.#r[0]!, to: this.#r[2 * this.#n - 1]! };
  }

  /** Mark the whole range dirty, as one range. */
  markAll(): void {
    this.#r[0] = 0;
    this.#r[1] = this.range.size;
    this.#n = 1;
  }

  /** Mark the resource clean, after its dirty ranges were uploaded. */
  clean(): void {
    this.#n = 0;
  }

  /** Give the resource a zeroed range of `bytes` that keeps the first `keep` bytes of the one it
   *  has, free that one, and mark the whole new range dirty. Every accessor reads the range at
   *  each use, so a view of the freed range is never used again (R17). */
  resize(bytes: number, keep: number): void {
    const old = this.slot.range;
    // The allocation may compact the region or replace its buffer, so the old range's offset is
    // read after it.
    const next = this.region.allocate(bytes);
    if (keep > 0)
      new Uint8Array(this.region.buffer).copyWithin(next.offset, old.offset, old.offset + keep);
    this.region.free(old);
    this.slot.range = next;
    this.bytes = bytes;
    this.markAll();
  }

  /** Throw when a call wrote the resource and the host has not read it back: `at` is what reads
   *  it, `camera.pos.get()` (change 0138, R2). */
  current(at: string): void {
    if (this.ahead)
      throw new TypeError(
        `${at}: a call wrote ${this.name}, and its values are on the device until \`await ${this.name}.read()\` brings them back; get() reads the host's copy, which does not hold them yet.`,
      );
  }

  /** Throw when the resource was freed: a freed range may be another resource's now. */
  live(): void {
    if (this.range.freed)
      throw new TypeError(
        `${this.name} was disposed; its fields cannot be read or set. Make a new one with ${this.remedy}.`,
      );
  }

  /** Mark bytes `[from, to)` of the resource dirty. A uniform widens its one range (R8). A storage
   *  array marks each element the bytes reach, and joins ranges that overlap or touch; when it
   *  holds more than {@link DIRTY_RANGE_LIMIT}, it joins them all into one (R9, D2). */
  mark(from: number, to: number): void {
    const r = this.#r;
    const st = this.stride;
    if (st > 0) {
      from = Math.floor(from / st) * st;
      to = Math.ceil(to / st) * st;
    }
    let n = this.#n;
    if (n === 0) {
      r[0] = from;
      r[1] = to;
      this.#n = 1;
      return;
    }
    if (st === 0) {
      if (from < r[0]!) r[0] = from;
      if (to > r[1]!) r[1] = to;
      return;
    }
    // The first range that ends at or after `from`: every range before it lies wholly before.
    let i = 0;
    while (i < n && r[2 * i + 1]! < from) i++;
    if (i === n || r[2 * i]! > to) {
      // No range overlaps or touches `[from, to)`: insert it at `i`.
      r.copyWithin(2 * i + 2, 2 * i, 2 * n);
      r[2 * i] = from;
      r[2 * i + 1] = to;
      n++;
    } else {
      // Join range `i` and every later one that `[from, to)` reaches.
      let j = i;
      while (j + 1 < n && r[2 * (j + 1)]! <= to) j++;
      if (from < r[2 * i]!) r[2 * i] = from;
      r[2 * i + 1] = Math.max(r[2 * j + 1]!, to);
      if (j > i) {
        r.copyWithin(2 * i + 2, 2 * j + 2, 2 * n);
        n -= j - i;
      }
    }
    if (n > DIRTY_RANGE_LIMIT) {
      r[1] = r[2 * n - 1]!;
      n = 1;
    }
    this.#n = n;
  }
}

const cores = new WeakMap<object, Core>();

/** Frees the range of a resource the garbage collector reclaimed (R17). */
const registry =
  typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry<Slot>(({ region, range }) => region.free(range))
    : undefined;

/** The core of `resource`, which `owner` holds. */
function adopt(owner: object, core: Core): void {
  cores.set(owner, core);
  registry?.register(owner, core.slot, core);
}

function dispose(core: Core): void {
  if (core.range.freed) return;
  core.region.free(core.range);
  registry?.unregister(core);
}

/** The bytes of a resource from its first dirty byte to its last, relative to its own start, and
 *  the resource's offset into the region's buffer, or undefined when it is clean. Not API.
 *  @throws `TypeError` for a value that is no resource, and for a disposed one. */
export function dirtyRange(
  resource: object,
): { readonly from: number; readonly to: number; readonly offset: number } | undefined {
  const core = cores.get(resource);
  if (core === undefined) throw new TypeError('dirtyRange(): takes a Uniform or a Buffer.');
  core.live();
  const span = core.span();
  return span === undefined ? undefined : { ...span, offset: core.range.offset };
}

/** The dirty byte ranges of a resource, each `[from, to)` relative to its own start, sorted and
 *  apart (D2): one for a uniform, and for a storage array one for each run of elements written,
 *  joined into one past {@link DIRTY_RANGE_LIMIT}. Empty when it is clean. Not API: the upload of
 *  milestone 3 reads it.
 *  @throws `TypeError` for a value that is no resource, and for a disposed one. */
export function dirtyRanges(resource: object): (readonly [number, number])[] {
  const core = cores.get(resource);
  if (core === undefined) throw new TypeError('dirtyRanges(): takes a Uniform or a Buffer.');
  core.live();
  return core.ranges();
}

/** Mark a resource clean, after its dirty ranges were uploaded. Not API. */
export function markClean(resource: object): void {
  cores.get(resource)?.clean();
}

/** The region a resource is a range of, and its range. Not API. */
export function rangeOf(resource: object): { readonly region: Region; readonly range: Range } {
  const core = cores.get(resource);
  if (core === undefined) throw new TypeError('rangeOf(): takes a Uniform or a Buffer.');
  return { region: core.region, range: core.range };
}

// ─── the accessors ───────────────────────────────────────────────────────────────────────────

type Typed = Float32Array | Int32Array | Uint32Array;

const VIEW = { f32: Float32Array, f64: Float32Array, i32: Int32Array, u32: Uint32Array } as const;

/** The number `v` as lane type `t`, or a `TypeError` naming `path` and lane `i` (-1: none). */
function numberOf(t: LayoutNumber, v: unknown, path: string, i: number): number {
  if (typeof v === 'number') {
    if (t === 'f32') return Math.fround(v);
    if (t === 'f64') return v;
    if (
      Number.isInteger(v) &&
      (t === 'i32' ? v >= -0x80000000 && v <= 0x7fffffff : v >= 0 && v <= 0xffffffff)
    )
      return v;
  }
  const at = i < 0 ? path : `${path}[${i}]`;
  throw new TypeError(
    typeof v === 'number'
      ? `${at}: got ${v}, which is not a whole number in the ${t} range.`
      : `${at}: takes a number (${t}), got ${describe(v)}.`,
  );
}

/** A scalar, a vector or a matrix field: one typed view over its lanes. */
class Leaf {
  readonly #core: Core;
  readonly #at: number;
  readonly #l: Layout & { k: 's' | 'v' | 'm' };
  readonly #path: string;
  /** The lanes a value has: 1, a vector's `n`, a matrix's `c * r`. */
  readonly #count: number;
  readonly #t: LayoutNumber;
  #view: Typed | undefined;
  #buffer: ArrayBuffer | undefined;
  #range: Range | undefined;
  #gen = -1;

  constructor(core: Core, at: number, l: Layout & { k: 's' | 'v' | 'm' }, path: string) {
    this.#core = core;
    this.#at = at;
    this.#l = l;
    this.#path = path;
    this.#count = l.k === 's' ? 1 : l.k === 'v' ? l.n : l.c * l.r;
    this.#t = l.k === 'm' ? 'f32' : l.t;
  }

  /** The view, made again after the region moved (Amendment A1) and after a resize gave the
   *  resource another range (Amendment A3). */
  #lanes(): Typed {
    const core = this.#core;
    core.live();
    const region = core.region;
    if (
      this.#view === undefined ||
      this.#gen !== region.generation ||
      this.#buffer !== region.buffer ||
      this.#range !== core.range
    ) {
      const l = this.#l;
      const n =
        l.k === 's'
          ? l.t === 'f64'
            ? 2
            : 1
          : l.k === 'v'
            ? l.t === 'f64'
              ? (l.lo ?? 0) / 4 + l.n
              : l.n
            : (l.c * l.cs) / 4 - (l.cs / 4 - l.r);
      // An accessor of an element that a resize removed lies past the range the resource has now.
      if (this.#at + 4 * n > core.bytes) {
        this.#view = undefined;
        throw new TypeError(
          `${this.#path}: ${core.name} was resized, and this element is no longer in it. Take the accessor again with at().`,
        );
      }
      this.#view = new VIEW[this.#t](region.buffer, core.range.offset + this.#at, n);
      this.#buffer = region.buffer;
      this.#range = core.range;
      this.#gen = region.generation;
    }
    return this.#view;
  }

  /** The index in the view of lane `i` (for an `f64`, its `hi` half). */
  #index(i: number): number {
    const l = this.#l;
    return l.k === 'm' ? Math.floor(i / l.r) * (l.cs / 4) + (i % l.r) : i;
  }

  /** Write `x` to lane `i` of `view`; whether a number changed. */
  #put(view: Typed, i: number, x: number): boolean {
    if (this.#t === 'f64') {
      const hi = Math.fround(x);
      const lo = Math.fround(x - hi);
      const j = this.#l.k === 'v' ? i : 2 * i;
      const k = this.#l.k === 'v' ? ((this.#l as { lo?: number }).lo ?? 0) / 4 + i : j + 1;
      if (!this.#core.ahead && Object.is(view[j], hi) && Object.is(view[k], lo)) return false;
      view[j] = hi;
      view[k] = lo;
      return true;
    }
    const j = this.#index(i);
    // The region does not hold what a call wrote on the device, so a value equal to it may still
    // differ from the device's: it is written and marked (change 0138, R2).
    if (!this.#core.ahead && Object.is(view[j], x)) return false;
    view[j] = x;
    return true;
  }

  /** The byte span of the field in the resource. */
  #span(view: Typed): void {
    this.#core.mark(this.#at, this.#at + view.byteLength);
  }

  /** Set the field: a scalar from a number, a vector from its components or from one array of
   *  them, a matrix from one array of its components, column-major. Allocates nothing. */
  set(): void {
    // `arguments`, not a rest parameter: a rest parameter makes an array at every call, and `set`
    // allocates nothing (R7).
    /* eslint-disable prefer-rest-params */
    const view = this.#lanes();
    const count = this.#count;
    const n = arguments.length;
    let changed = false;
    if (n === 1 && typeof arguments[0] === 'object' && arguments[0] !== null && count > 1) {
      const src = arguments[0] as ArrayLike<unknown>;
      if (src.length !== count)
        throw new TypeError(
          `${this.#path}.set(): takes ${count} numbers, got ${describe(src)}${Array.isArray(src) ? '' : ` of length ${String(src.length)}`}.`,
        );
      for (let i = 0; i < count; i++)
        if (this.#put(view, i, numberOf(this.#t, src[i], this.#path, i))) changed = true;
    } else if (n === count) {
      for (let i = 0; i < count; i++)
        if (this.#put(view, i, numberOf(this.#t, arguments[i], this.#path, count > 1 ? i : -1)))
          changed = true;
    } else
      throw new TypeError(
        count === 1
          ? `${this.#path}.set(): takes one number, got ${n} arguments.`
          : `${this.#path}.set(): takes ${count} numbers or one array of ${count}, got ${n} arguments.`,
      );
    /* eslint-enable prefer-rest-params */
    if (changed) this.#span(view);
  }

  /** The field's value: a scalar's number, and the typed view of a vector or a matrix, read-only
   *  (a matrix's view holds each column at its stride). An `f64` field is two `f32` halves in the
   *  region (Rule 4.4), so its `get` joins them: a number, or a new `Float64Array`. */
  get(): unknown {
    const view = this.#lanes();
    this.#core.current(`${this.#path}.get()`);
    if (this.#t === 'f64') {
      if (this.#l.k === 's') return view[0]! + view[1]!;
      const out = new Float64Array(this.#count);
      const lo = ((this.#l as { lo?: number }).lo ?? 0) / 4;
      for (let i = 0; i < out.length; i++) out[i] = view[i]! + view[lo + i]!;
      return out;
    }
    return this.#l.k === 's' ? view[0] : view;
  }
}

/** An array with a size: `at(i)` reaches element `i`. */
class ArrayField {
  readonly #core: Core;
  readonly #at: number;
  readonly #l: Layout & { k: 'a' };
  readonly #path: string;
  readonly #items: Field[] = [];
  /** How many elements it holds. */
  readonly length: number;

  constructor(core: Core, at: number, l: Layout & { k: 'a' }, path: string) {
    this.#core = core;
    this.#at = at;
    this.#l = l;
    this.#path = path;
    this.length = l.n ?? 0;
  }

  /** Element `index`. @throws `RangeError` for an index outside the array. */
  at(index: number): Field {
    this.#core.live();
    if (!Number.isInteger(index) || index < 0 || index >= this.length)
      throw new RangeError(
        `${this.#path}.at(): takes a whole number from 0 to ${this.length - 1}, got ${String(index)}.`,
      );
    return (this.#items[index] ??= fieldOf(
      this.#core,
      this.#at + index * this.#l.st,
      this.#l.e,
      `${this.#path}[${index}]`,
    ));
  }

  /** Set every element, from an array of their values. */
  set(values: unknown): void {
    this.#core.live();
    const xs = values as ArrayLike<unknown>;
    if (typeof values !== 'object' || values === null || xs.length !== this.length)
      throw new TypeError(
        `${this.#path}.set(): takes an array of ${this.length} values, got ${describe(values)}.`,
      );
    for (let i = 0; i < this.length; i++) (this.at(i).set as (v: unknown) => void)(xs[i]);
  }

  /** The typed view of an array of scalars or vectors, read-only, each element at its stride.
   *  @throws `TypeError` for an array of structs, matrices or `f64`, which has no one view. */
  get(): Typed {
    const core = this.#core;
    core.live();
    core.current(`${this.#path}.get()`);
    const e = this.#l.e;
    if ((e.k !== 's' && e.k !== 'v') || e.t === 'f64')
      throw new TypeError(
        `${this.#path}.get(): this array has no one view; read each element with at(i).get().`,
      );
    return new VIEW[e.t](
      core.region.buffer,
      core.range.offset + this.#at,
      (this.length * this.#l.st) / 4,
    );
  }
}

/** The key of a struct accessor's own lookup, which no field name can hide. */
const FIELD = Symbol('field');

/** The names a struct field cannot take, since they are the accessor's own. */
const STRUCT_OWN = ['set', 'constructor'];
/** The names a field of a uniform's struct cannot take besides. */
const ROOT_OWN = [...STRUCT_OWN, 'needsUpdate', 'dispose'];

/** A struct: a getter for each field, and `set` from an object of some of its fields. */
class StructField {
  readonly #core: Core;
  readonly #at: number;
  readonly #l: Layout & { k: 'o' };
  readonly #path: string;
  readonly #kids = new Map<string, Field>();

  constructor(core: Core, at: number, l: Layout & { k: 'o' }, path: string) {
    this.#core = core;
    this.#at = at;
    this.#l = l;
    this.#path = path;
  }

  /** The accessor of field `name`, made on first use. */
  [FIELD](name: string): Field {
    this.#core.live();
    let kid = this.#kids.get(name);
    if (kid === undefined) {
      const f = this.#l.f.find(([n]) => n === name)!;
      kid = fieldOf(this.#core, this.#at + f[1], f[2], `${this.#path}.${name}`);
      this.#kids.set(name, kid);
    }
    return kid;
  }

  /** Set the fields `value` names; the others keep what they hold. */
  set(value: unknown): void {
    this.#core.live();
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      ArrayBuffer.isView(value)
    )
      throw new TypeError(
        `${this.#path}.set(): takes an object of its fields, got ${describe(value)}.`,
      );
    const o = value as Record<string, unknown>;
    for (const name in o) {
      if (!this.#l.f.some(([n]) => n === name))
        throw new TypeError(
          `${this.#path}.set(): ${JSON.stringify(name)} is not a field; the fields are ${this.#l.f.map(([n]) => n).join(', ')}.`,
        );
      (this[FIELD](name).set as (v: unknown) => void)(o[name]);
    }
  }
}

type Field = Leaf | ArrayField | StructField;

/** A subclass of `Base` for each struct layout, with a getter for each field. */
const subclasses = new Map<typeof StructField, WeakMap<object, typeof StructField>>();

function structClass(
  Base: typeof StructField,
  l: Layout & { k: 'o' },
  own: readonly string[],
  path: string,
): typeof StructField {
  let byLayout = subclasses.get(Base);
  if (byLayout === undefined) subclasses.set(Base, (byLayout = new WeakMap()));
  let Sub = byLayout.get(l);
  if (Sub === undefined) {
    Sub = class extends Base {};
    for (const [name] of l.f) {
      if (own.includes(name))
        throw new TypeError(
          `${path}: the field ${JSON.stringify(name)} has the name of the accessor's own ${name === 'constructor' ? 'property' : 'method'}, so a host cannot reach it; rename the field in the shader.`,
        );
      Object.defineProperty(Sub.prototype, name, {
        get(this: StructField) {
          return this[FIELD](name);
        },
        enumerable: true,
      });
    }
    byLayout.set(l, Sub);
  }
  return Sub;
}

/** The accessor of the value laid out by `l` at byte `at` of the resource. */
function fieldOf(core: Core, at: number, l: Layout, path: string): Field {
  switch (l.k) {
    case 'a':
      if (l.n === null)
        throw new TypeError(`${path}: an array with no size has no field accessor.`);
      return new ArrayField(core, at, l, path);
    case 'o':
      return new (structClass(StructField, l, STRUCT_OWN, path))(core, at, l, path);
    default:
      return new Leaf(core, at, l, path);
  }
}

// ─── reading a value back ────────────────────────────────────────────────────────────────────

function readNumber(dv: DataView, at: number, t: LayoutNumber): number {
  if (t === 'f64') return dv.getFloat32(at, true) + dv.getFloat32(at + 4, true);
  return t === 'f32'
    ? dv.getFloat32(at, true)
    : t === 'i32'
      ? dv.getInt32(at, true)
      : dv.getUint32(at, true);
}

/** The host value (Rule 8.21) laid out by `l` at `at`: a number, a tuple, an array or an object. */
function readValue(dv: DataView, at: number, l: Layout, proto?: object): unknown {
  switch (l.k) {
    case 's':
      return readNumber(dv, at, l.t);
    case 'v': {
      const out: number[] = [];
      for (let i = 0; i < l.n; i++)
        out.push(
          l.t === 'f64'
            ? dv.getFloat32(at + 4 * i, true) + dv.getFloat32(at + (l.lo ?? 0) + 4 * i, true)
            : readNumber(dv, at + 4 * i, l.t),
        );
      return out;
    }
    case 'm': {
      const out: number[] = [];
      for (let c = 0; c < l.c; c++)
        for (let r = 0; r < l.r; r++) out.push(dv.getFloat32(at + c * l.cs + 4 * r, true));
      return out;
    }
    case 'a': {
      const out: unknown[] = [];
      for (let i = 0; i < (l.n ?? 0); i++) out.push(readValue(dv, at + i * l.st, l.e));
      return out;
    }
    case 'o': {
      const o = (proto === undefined ? {} : Object.create(proto)) as Record<string, unknown>;
      for (const [name, off, fl] of l.f) o[name] = readValue(dv, at + off, fl);
      return o;
    }
  }
}

// ─── the types ───────────────────────────────────────────────────────────────────────────────

type AnyFunction = (...args: never) => unknown;
/** The keys of `T` that hold data, not methods. */
type DataKeys<T> = { [K in keyof T]-?: T[K] extends AnyFunction ? never : K }[keyof T];
/** The value `set` takes for a struct: some of its fields. */
type Some<T> = { readonly [K in DataKeys<T>]?: T[K] };

/** `Path` and field `K`, as a host reads them: `inner.set`. */
type Join<Path extends string, K> = Path extends '' ? K & string : `${Path}.${K & string}`;

/** A field of `T`, through nested structs, named one of `Own` on `T` itself or `set` on a struct
 *  it holds, as `"set"` or `"inner.set"`; `never` when it has none (change 0138, Amendment A5,
 *  D3). `D` counts the structs walked: a struct nests at most {@link ReservedDepth} deep here,
 *  which keeps the type finite for a `T` the checker has not resolved yet. The host's editor
 *  shows `TS8079` with it, from {@link Refuse}. */
type Reserved<
  T,
  Own extends string,
  Path extends string = '',
  D extends 0[] = [],
> = D['length'] extends ReservedDepth
  ? never
  : {
      [K in DataKeys<T>]-?: K extends Own
        ? Join<Path, K>
        : ReservedWithin<T[K], Join<Path, K>, [...D, 0]>;
    }[DataKeys<T>];

/** How deep {@link Reserved} reads nested structs. The runtime refuses a deeper one all the same. */
type ReservedDepth = 4;

/** {@link Reserved} of a field's type: a struct's `set`, also through an array of structs. */
type ReservedWithin<F, Path extends string, D extends 0[]> = F extends number | boolean
  ? never
  : F extends readonly (infer E)[]
    ? ReservedWithin<E, Path, D>
    : F extends object
      ? Reserved<F, 'set', Path, D>
      : never;

/** Nothing where `Name` is `never`; else a property no class has, so a call that passes the class
 *  is refused by the host's editor with the code and the field (change 0138, Amendment A5, D3).
 *  The runtime refuses the same class with a `TypeError`. */
type Refuse<Name> = [Name] extends [never]
  ? unknown
  : {
      readonly TS8079: `the field "${Name & string}" has the name of a member of the host accessor, so a host cannot reach it; rename the field in the shader`;
    };

/** The class a host resource takes: a class of a shader module, whose fields are not named like
 *  the accessor's own members (`set`, and on a uniform's struct `needsUpdate` and `dispose`). */
type ResourceClass<T, Own extends string> = ShaderClass<T> & Refuse<Reserved<T, Own>>;

/** The typed array a lane of `E` is viewed through. */
type ViewOf<E> = [E] extends [f32]
  ? Float32Array
  : [E] extends [f64]
    ? Float64Array
    : [E] extends [i32]
      ? Int32Array
      : [E] extends [u32]
        ? Uint32Array
        : Float32Array;

/** A scalar field. */
interface ScalarField<T> {
  /** Write `value` if it differs from what the field holds. Allocates nothing. */
  set(value: T): void;
  /** The number the field holds: a number, not a view (R8; Amendment A5, D1). An `f64` field's
   *  two `f32` halves are joined into one number. */
  get(): T;
}

/** A vector or a matrix field. */
interface TupleField<T extends readonly number[]> {
  /** Write the components that differ from what the field holds. Allocates nothing. */
  set(...components: T): void;
  /** Write the components of one array, column-major for a matrix. Allocates nothing. */
  set(components: ArrayLike<number>): void;
  /** The field's typed view of the region, read-only. A host that writes through it sets the
   *  resource's `needsUpdate`. */
  get(): Readonly<ViewOf<T[number]>>;
}

/** A field of an array with a size. */
interface ArrayFieldOf<E> {
  /** How many elements it holds. */
  readonly length: number;
  /** Element `index`'s accessor. */
  at(index: number): FieldOf<E>;
  /** Set every element. */
  set(values: readonly E[]): void;
  /** The typed view of an array of scalars or vectors, each element at its stride. */
  get(): E extends number
    ? Readonly<ViewOf<E>>
    : E extends readonly number[]
      ? Readonly<ViewOf<E[number]>>
      : never;
}

/** The accessor of a field of type `T`. */
type FieldOf<T> = T extends boolean
  ? never
  : T extends number
    ? ScalarField<T>
    : T extends readonly number[]
      ? number extends T['length']
        ? ArrayFieldOf<T[number]>
        : TupleField<T>
      : T extends readonly (infer E)[]
        ? ArrayFieldOf<E>
        : T extends object
          ? StructOf<T>
          : never;

/** The accessor of a struct: one accessor for each field, and `set` from some of them. */
type StructOf<T> = { readonly [K in DataKeys<T>]: FieldOf<T[K]> } & {
  /** Write the fields `value` names, each only where it differs. */
  set(value: Some<T>): void;
};

/**
 * A uniform of the struct `T` (change 0138, R7, R8): one range of the region laid out by the
 * uniform rules of Rule 6.8, with an accessor for each field. `camera.pos.set(0, 2, 5)` writes a
 * vector, `camera.view.set(m)` a matrix from an array, `camera.set({ view, proj })` several
 * fields; `camera.pos.get()` is the field's typed view. Each `set` writes only what changed and
 * widens the dirty range. Made by {@link uniform}; freed by `dispose()` or when the garbage
 * collector reclaims it. Where the runtime has `Symbol.dispose`, it has `[Symbol.dispose]()` too,
 * which `using` calls; the type declares it as `Disposable` where the host's `lib` declares
 * `Symbol.dispose` (Amendment A5, D4). The view types an exported binding without `dispose()` and
 * `[Symbol.dispose]()`, since it lives as long as its module (D7).
 *
 * Exported from `typeshade/runtime`.
 */
export type Uniform<T> = StructOf<T> &
  Disposable & {
    /** Whether the uniform holds a change not yet uploaded. Set it to `true` after writing through
     *  a view that `get` returned, as in three.js. A new uniform is dirty. */
    needsUpdate: boolean;
    /** Free the uniform's range. A use of an accessor after it throws a `TypeError`. */
    dispose(): void;
  };

/**
 * A storage array of `length` structs `T` (change 0138, R9): one range of the region laid out as
 * a storage array with no size (Rule 6.8). `ps.at(i).pos.set(x, y, z)` writes one field of element
 * `i`; `await ps.read()` gives every element, each an instance of the class. Made by
 * {@link zeros} or {@link array}; freed by `dispose()` or when the garbage collector reclaims
 * it, and by `[Symbol.dispose]()` as a uniform is, which the type declares as `Disposable` where
 * the host's `lib` declares `Symbol.dispose` (Amendment A5, D4). The host sets its length again with
 * `resize(n)` or `set(data)`. A binding a shader module exports is one too (Rule 6.1): a
 * `storage<array<T, N>>` keeps its `N` elements, and a `storage<array<T>>`, which states no
 * size, has no length until the host calls `resize` or `set`; until then `length` is 0, and
 * `at` and `read` throw a `TypeError` that names the binding. The view types an exported binding
 * without `dispose()` and `[Symbol.dispose]()` (D7).
 *
 * Exported from `typeshade/runtime`.
 */
export interface Buffer<T> extends Disposable {
  /** How many elements it holds. An exported storage array with no size holds 0 until the host
   *  sets its length with `resize` or `set`. */
  readonly length: number;
  /** Give the array `length` elements (Amendment A3): the elements that fit keep their values, a
   *  new element is zero, and the whole array is dirty. An accessor that `at` returned before
   *  reads the array's new range, and throws a `TypeError` for an element that is gone.
   *  @throws `TypeError` for a length that is not a whole number, and for another length than the
   *  one a shader file states (`storage<array<T, N>>`). */
  resize(length: number): void;
  /** Give the array the length of `data` and its values (Amendment A3): each element gives some
   *  of its fields, and the others are zero, as `array(Class, data)` reads them. The whole array
   *  is dirty. A `data` that does not fit changes nothing.
   *  @throws `TypeError` for `data` that is no array, for an element that does not fit, and for
   *  another length than the one a shader file states. */
  set(data: readonly Some<T>[]): void;
  /** Element `index`'s accessor. @throws `RangeError` for an index outside the array. */
  at(index: number): StructOf<T>;
  /** Every element, each an instance of the class, built without its constructor. */
  read(): Promise<T[]>;
  /** Whether the array holds a change not yet uploaded. Set it to `true` after writing through a
   *  view that `get` returned. A new array is dirty. */
  needsUpdate: boolean;
  /** Free the array's range. A use of an accessor after it throws a `TypeError`. */
  dispose(): void;
}

/**
 * A host value of an array with no size, or the function that makes a storage array (change
 * 0138). As a type it is the host type family's `array<T>` (change 0116, Rule 8.21): the typed
 * array of `T`'s scalar, or an array of structs, each also as its `Resident`.
 *
 * Exported from `typeshade/runtime`.
 */
export type array<T, N extends number = number> = HostArray<T, N>;

// ─── the resource classes ────────────────────────────────────────────────────────────────────

/** What a uniform root adds to its struct accessor. */
class UniformRoot extends StructField {
  get needsUpdate(): boolean {
    const core = cores.get(this)!;
    core.live();
    return core.dirty;
  }
  set needsUpdate(v: boolean) {
    const core = cores.get(this)!;
    core.live();
    if (v) core.markAll();
    else core.clean();
  }
  dispose(): void {
    dispose(cores.get(this)!);
  }
}

/** How a storage array's length is decided (Amendment A3). */
interface Sizing {
  /** The length a shader file states (`storage<array<T, N>>`), which the host cannot change. */
  readonly fixed?: { readonly length: number; readonly module: string };
  /** The module of an exported storage array with no size, whose length the host has not set
   *  yet. */
  readonly unset?: string;
}

/** A storage array of structs. */
class BufferRoot {
  readonly #core: Core;
  readonly #l: Layout & { k: 'a' };
  readonly #Element: typeof StructField;
  readonly #proto: object;
  readonly #fixed: Sizing['fixed'];
  /** The module of a binding whose length the host has not set yet (Amendment A3). */
  #unset: string | undefined;
  #length: number;

  constructor(core: Core, l: Layout & { k: 'a' }, length: number, proto: object, sizing: Sizing) {
    this.#core = core;
    this.#l = l;
    this.#length = length;
    this.#proto = proto;
    this.#fixed = sizing.fixed;
    this.#unset = sizing.unset;
    this.#Element = structClass(StructField, l.e as Layout & { k: 'o' }, STRUCT_OWN, core.name);
    adopt(this, core);
  }

  /** How many elements it holds; 0 while the host has not set the length. */
  get length(): number {
    return this.#length;
  }

  /** Throw when the host has not set the length of a storage array with no size. */
  #sized(at: string): void {
    this.#core.live();
    if (this.#unset !== undefined) {
      const name = this.#core.name;
      throw new TypeError(
        `${name}.${at}: ${name} is a storage array with no size that ${this.#unset} exports, and its length is not set. Call ${name}.resize(n) or ${name}.set(data) first.`,
      );
    }
  }

  /** Throw when `length` is not the one the shader file states. */
  #fits(at: string, length: number): void {
    const fixed = this.#fixed;
    if (fixed !== undefined && length !== fixed.length) {
      const name = this.#core.name;
      throw new TypeError(
        `${name}.${at}: ${name} is a storage array of ${fixed.length} elements in ${fixed.module}, which states its size, so it cannot hold ${length}. Declare it storage<array<T>>, with no size, for a length the host sets.`,
      );
    }
  }

  /** Element `index`'s accessor. */
  at(index: number): StructField {
    this.#sized('at()');
    if (!Number.isInteger(index) || index < 0 || index >= this.#length)
      throw new RangeError(
        `${this.#core.name}.at(): takes a whole number from 0 to ${this.#length - 1}, got ${String(index)}.`,
      );
    return new this.#Element(
      this.#core,
      index * this.#l.st,
      this.#l.e as Layout & { k: 'o' },
      `${this.#core.name}[${index}]`,
    );
  }

  /** Every element, each an instance of the class. A read submits every call recorded before it
   *  (change 0138, Amendment A5, Q4 and default 2), and waits for the calls that took the array;
   *  what they wrote lands in the array's range of the region (R17). */
  read(): Promise<unknown[]> {
    const core = this.#core;
    this.#sized('read()');
    try {
      throwFailure();
    } catch (e) {
      return Promise.reject(e);
    }
    kernelQueue.submit();
    const state = core.state;
    if (state === undefined)
      return Promise.resolve(this.#decode(core.region.buffer, core.range.offset));
    return (async () => {
      // What the host set since the last call is the newest write: the device copy takes it first.
      const last = captureOf(core, state, this.#length);
      if (last !== undefined) await kernelQueue.run(async () => state.apply(last));
      await kernelQueue.idle();
      throwFailure();
      if (state.error !== undefined) throw state.error;
      await state.sync(true);
      core.live();
      const st = this.#l.st;
      const bytes = state.length * st;
      const back = new ArrayBuffer(Math.max(4, bytes));
      pack(new DataView(back), 0, { ...this.#l, n: state.length }, state.host, '');
      // A `set` made while the read waited is newer than the device's value: then the read lands
      // nothing, and the array stays ahead of the region until a later read.
      if (!core.dirty && state.length === this.#length) {
        new Uint8Array(core.region.buffer, core.range.offset, bytes).set(
          new Uint8Array(back, 0, bytes),
        );
        core.ahead = false;
      }
      return this.#decode(back, 0, state.length);
    })();
  }

  /** Every element laid out at `offset` of `buffer`, each an instance of the class. */
  #decode(buffer: ArrayBuffer, offset: number, length = this.#length): unknown[] {
    const dv = new DataView(buffer, offset, length * this.#l.st);
    const out: unknown[] = [];
    for (let i = 0; i < length; i++)
      out.push(readValue(dv, i * this.#l.st, this.#l.e, this.#proto));
    return out;
  }

  /** What a call takes for the array (change 0138, R2): the hidden handle of its device copy, the
   *  values the call sees, copied now, and the element layout. `writes`: the call writes it. */
  record(writes: boolean): RecordedBuffer {
    const core = this.#core;
    this.#sized('a call');
    const state = (core.state ??= new RegionState(this.#l, this.#proto));
    state.handle ??= handleOf(state);
    const snapshot = captureOf(core, state, this.#length);
    if (writes) core.ahead = true;
    return {
      handle: state.handle,
      layout: this.#l,
      name: core.name,
      upload: snapshot === undefined ? undefined : () => state.apply(snapshot),
    };
  }

  /** Give the array `length` elements: the ones that fit keep their values. */
  resize(length: unknown): void {
    const core = this.#core;
    core.live();
    const name = core.name;
    if (
      typeof length !== 'number' ||
      !Number.isInteger(length) ||
      length < 0 ||
      length > 0xffffffff
    )
      throw new TypeError(
        `${name}.resize(): takes a length that is a whole number from 0 to 4294967295, got ${describe(length)}.`,
      );
    this.#fits('resize()', length);
    core.resize(length * this.#l.st, Math.min(length, this.#length) * this.#l.st);
    this.#length = length;
    this.#unset = undefined;
  }

  /** Give the array the length of `data` and its values. */
  set(data: unknown): void {
    const core = this.#core;
    core.live();
    const name = core.name;
    const xs = data as ArrayLike<unknown>;
    if (
      typeof data !== 'object' ||
      data === null ||
      typeof xs.length !== 'number' ||
      !Number.isInteger(xs.length) ||
      xs.length < 0
    )
      throw new TypeError(
        `${name}.set(): takes an array of the elements' values, got ${describe(data)}.`,
      );
    const length = xs.length;
    this.#fits('set()', length);
    // The values are written into a new range, and the array takes it only when every one fits.
    const old = core.slot.range;
    const bytes = core.bytes;
    const next = core.region.allocate(length * this.#l.st);
    core.slot.range = next;
    core.bytes = length * this.#l.st;
    try {
      const e = this.#l.e as Layout & { k: 'o' };
      for (let i = 0; i < length; i++)
        new this.#Element(core, i * this.#l.st, e, `${name}[${i}]`).set(xs[i]);
    } catch (e) {
      core.slot.range = old;
      core.bytes = bytes;
      core.region.free(next);
      throw e;
    }
    core.region.free(old);
    core.markAll();
    this.#length = length;
    this.#unset = undefined;
  }

  get needsUpdate(): boolean {
    this.#core.live();
    return this.#core.dirty;
  }
  set needsUpdate(v: boolean) {
    this.#core.live();
    if (v) this.#core.markAll();
    else this.#core.clean();
  }
  dispose(): void {
    dispose(this.#core);
    // The device copy goes after the calls recorded before (`Resident.destroy()`).
    this.#core.state?.handle?.destroy();
  }
}

declare global {
  /** The `lib`'s `Disposable` (`[Symbol.dispose](): void`) where it declares one, and nothing
   *  where it does not, as `runtime/device.ts` declares it (change 0138, Amendment A5, D4). */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Disposable {}
}

const disposeKey = (Symbol as { readonly dispose?: symbol }).dispose;
if (typeof disposeKey === 'symbol')
  for (const C of [UniformRoot, BufferRoot])
    Object.defineProperty(C.prototype, disposeKey, {
      value(this: { dispose(): void }) {
        this.dispose();
      },
    });

// ─── the functions ───────────────────────────────────────────────────────────────────────────

/** A uniform of `cls` in `region`. Not API: {@link uniform} uses the global region. */
export function makeUniform(
  region: Region,
  cls: unknown,
  init: unknown,
  at = 'uniform()',
  label?: string,
): unknown {
  const l = layoutsOf(cls, at);
  if (l.u === undefined || l.u.k !== 'o')
    throw new TypeError(
      `${at}: ${l.name} has no uniform layout a host can write: ${l.un ?? 'it is no struct'}.`,
    );
  const name = label ?? `Uniform<${l.name}>`;
  const Root = structClass(UniformRoot, l.u, ROOT_OWN, name);
  const core = new Core(region, l.u.sz, name, `uniform(${l.name})`);
  const root = new Root(core, 0, l.u, name);
  adopt(root, core);
  uniformLayouts.set(root, l.u);
  if (init !== undefined) root.set(init);
  core.markAll();
  return root;
}

/** A storage array of `length` elements of `cls` in `region`, from `data` when given. `sizing`
 *  says whether a shader file states the length or the host has yet to set it. Not API. */
export function makeBuffer(
  region: Region,
  cls: unknown,
  length: unknown,
  data: unknown,
  at: string,
  label?: string,
  sizing: Sizing = {},
): unknown {
  const l = layoutsOf(cls, at);
  if (l.s === undefined || l.s.e.k !== 'o')
    throw new TypeError(
      `${at}: ${l.name} has no storage layout a host can write: ${l.sn ?? 'it is no struct'}.`,
    );
  if (typeof length !== 'number' || !Number.isInteger(length) || length < 0 || length > 0xffffffff)
    throw new TypeError(
      `${at}: takes a length that is a whole number from 0 to 4294967295, got ${describe(length)}.`,
    );
  const name = label ?? `Buffer<${l.name}>`;
  const core = new Core(region, length * l.s.st, name, `zeros(${l.name}, ${length})`, l.s.st);
  const buffer = new BufferRoot(
    core,
    l.s,
    length,
    (cls as { prototype: object }).prototype,
    sizing,
  );
  if (data !== undefined) {
    const xs = data as ArrayLike<unknown>;
    for (let i = 0; i < length; i++) buffer.at(i).set(xs[i]);
  }
  core.markAll();
  return buffer;
}

/**
 * A uniform of the struct of `cls`, a class a shader module exports (change 0138, R7): one range
 * of the region, zeroed, then given the fields `init` names. `uniform<T>` in a shader file and
 * `uniform(T)` in host code name the same thing, a uniform of `T` (Amendment A1).
 *
 * Exported from `typeshade/runtime`.
 *
 * @param cls - an exported class of a `.shade.ts` the host imports.
 * @param init - some of its fields, each a host value (Rule 8.21).
 * @returns the uniform, whose fields are set with `set` and read with `get`.
 * @throws `TypeError` for a value that is no class of a shader module, for an abstract class,
 *   for a struct with no uniform layout (a `bool`, a two-row matrix), for a field whose name is
 *   the accessor's own (`set`, `needsUpdate`, `dispose`), and for an `init` that does not fit. The
 *   host's editor refuses a class with such a field already, with `TS8079` (Amendment A5, D3).
 */
export function uniform<T extends object>(
  cls: ResourceClass<T, 'set' | 'needsUpdate' | 'dispose'>,
  init?: Some<T>,
): Uniform<T> {
  return makeUniform(globalRegion(), cls, init) as Uniform<T>;
}

/**
 * A storage array of `length` zeroed structs of `cls`, a class a shader module exports (change
 * 0138, R9): one range of the region.
 *
 * Exported from `typeshade/runtime`.
 *
 * @param cls - an exported class of a `.shade.ts` the host imports.
 * @param length - how many elements, a whole number.
 * @returns the array, whose element `i` is set as `ps.at(i).pos.set(…)`.
 * @throws `TypeError` for a value that is no class of a shader module, for an abstract class, for
 *   a struct with no storage layout, for a field named `set`, which the host's editor refuses
 *   already with `TS8079` (Amendment A5, D3), and for a length that is not a whole number.
 */
export function zeros<T extends object>(cls: ResourceClass<T, 'set'>, length: number): Buffer<T> {
  return makeBuffer(globalRegion(), cls, length, undefined, 'zeros()') as Buffer<T>;
}

/**
 * A storage array of the structs of `cls` that `data` holds (change 0138, R9), or, with one value,
 * a `Resident` that keeps it on the device across calls, as `resident()` made one (Amendment A1:
 * `array(xs)` replaces `resident(xs)`), and with a length and an element, a zeroed `Resident`.
 *
 * Exported from `typeshade/runtime`.
 *
 * @param cls - an exported class of a `.shade.ts`, whose elements `data` holds; each element
 *   gives some of its fields, and the others are zero.
 * @returns a `Buffer<T>` for a class; a `Resident` otherwise.
 * @throws `TypeError` as {@link zeros} does, for `data` that is no array, and as `resident()`
 *   throws for its forms.
 */
export function array<T extends object>(
  cls: ResourceClass<T, 'set'>,
  data: readonly Some<T>[],
): Buffer<T>;
export function array<T>(value: T): Resident<T>;
export function array<E extends ZeroedElement>(
  length: number,
  element: E,
): Resident<ZeroedArray<E>>;
export function array(...args: unknown[]): unknown {
  const [first, second] = args;
  if (typeof first === 'function' && args.length === 2) {
    if (
      typeof second !== 'object' ||
      second === null ||
      typeof (second as ArrayLike<unknown>).length !== 'number'
    )
      throw new TypeError(
        `array(): takes an array of the elements' values, got ${describe(second)}.`,
      );
    return makeBuffer(
      globalRegion(),
      first,
      (second as ArrayLike<unknown>).length,
      second,
      'array()',
    );
  }
  return makeResident('array()', args);
}

/**
 * The resource of a binding a shader module exports (change 0138, R10; Rule 6.1):
 * `export declare const camera: uniform<Camera>` is a `Uniform<Camera>` of the global region, and
 * `export declare const ps: storage<array<Particle, 64>>` a `Buffer<Particle>` of 64 elements,
 * which `length` gives, and `export declare const all: storage<array<Particle>>` a
 * `Buffer<Particle>` whose length the host sets with `resize` or `set` (Amendment A3), for which
 * `length` is `null`.
 * The generated module makes it once, when the module is evaluated, under the name the module
 * exports it as, which its errors name. It lives as long as its module: an import is a read-only
 * binding, and a host that freed it could make no other, so `dispose()` is refused with a
 * `TypeError`. Not API: what a generated module calls (`typeshade/runtime/internal`).
 */
export function exportedBinding(
  name: string,
  module: string,
  cls: unknown,
  length?: number | null,
  region: Region = globalRegion(),
): unknown {
  const at = `${name} of ${module}`;
  const resource =
    length === undefined
      ? makeUniform(region, cls, undefined, at, name)
      : length === null
        ? makeBuffer(region, cls, 0, undefined, at, name, { unset: module })
        : makeBuffer(region, cls, length, undefined, at, name, { fixed: { length, module } });
  const refuse = (): never => {
    throw new TypeError(
      `${name}.dispose(): ${name} is a binding that ${module} exports, which lives as long as its module; it is not disposed.`,
    );
  };
  Object.defineProperty(resource, 'dispose', { value: refuse });
  if (typeof disposeKey === 'symbol')
    Object.defineProperty(resource, disposeKey, { value: refuse });
  return resource;
}

/**
 * A texture of the block's default device (change 0138, Amendment A1; Rule 11.8): `using _ = device.use()`
 * names the device, and the texture is the one `device.texture(options)` makes. A texture lives
 * on its device only, so it takes no range of the region (R17).
 *
 * Exported from `typeshade/runtime`.
 *
 * @param options - `size` and `format`, as `device.texture()` takes them.
 * @returns the device's texture.
 * @throws `TypeError` when no device is in use, and as `device.texture()` throws.
 */
export function texture(options: {
  readonly size: readonly [number, number];
  readonly format: string;
  readonly storage?: boolean;
}): Texture {
  const device = defaultDevice() as { texture(o: typeof options): Texture } | undefined;
  if (device === undefined)
    throw new TypeError(
      'texture(): no device is in use. Open one with createDevice() and write `using _ = device.use()` before this call.',
    );
  return device.texture(options);
}

// ─── a call on a resource (change 0138, milestone 3) ─────────────────────────────────────────

/** The values a call sees of a storage array (Amendment A5, default 3): every byte, when the device
 *  copy has none of its own yet or another length, or only the dirty ranges. */
type Snapshot =
  | { readonly full: ArrayBuffer; readonly length: number }
  | { readonly ranges: readonly (readonly [number, Uint8Array])[] };

/** What a call takes for a storage array: the hidden handle of its device copy, which the call
 *  layer runs as it runs a `Resident`, and the write of the values the call sees, run when the call
 *  runs. Not API. */
export interface RecordedBuffer {
  readonly handle: object;
  readonly layout: Layout & { readonly k: 'a' };
  readonly name: string;
  readonly upload: (() => void) | undefined;
}

/**
 * The device copy of a storage array (change 0138, R2, R8): the state of a `Resident` whose host
 * value is the CPU tier's array of elements and whose device buffer is WebGPU's, apart from the
 * region, which is the host's. A call writes the values it sees into it ({@link apply}); a read
 * brings it back into the region.
 */
class RegionState extends ResidentArrayState {
  readonly layout: Layout & { readonly k: 'a' };
  readonly proto: object;
  /** How many elements the device copy holds. */
  length = 0;
  /** How many elements the last values copied out of the region for a call held, or -1 before
   *  the first: what the device copy will hold once the calls recorded so far have run. */
  captured = -1;
  /** The hidden `Resident` handle the call layer takes. */
  handle: ReturnType<typeof handleOf> | undefined;

  constructor(layout: Layout & { readonly k: 'a' }, proto: object) {
    super(undefined);
    this.layout = layout;
    this.proto = proto;
  }

  /** Write the values a call sees into the device copy: each dirty range of the region, as it
   *  was at the call. On WebGPU, where the device's copy is the newer, each range is one
   *  `writeBuffer` (R8); elsewhere each element the range holds is read into the CPU tier's
   *  array, and a device buffer equal to it takes the same range. */
  apply(s: Snapshot): void {
    const st = this.layout.st;
    const e = this.layout.e;
    if ('full' in s) {
      const dv = new DataView(s.full);
      const host: unknown[] = [];
      for (let i = 0; i < s.length; i++) host.push(readValue(dv, i * st, e, this.proto));
      this.host = host;
      this.length = s.length;
      // The host copy is the newer; an upload of the whole array follows at the next WebGPU use.
      this.fresh = 'host';
      return;
    }
    const gpu = this.gpu;
    const device = gpu !== undefined && this.fresh !== 'host';
    if (device)
      for (const [from, bytes] of s.ranges)
        gpu.d.queue.writeBuffer(gpu.buffer, from, bytes.slice().buffer as ArrayBuffer);
    if (this.fresh === 'device' && gpu !== undefined) return;
    // The CPU tier's array takes each element the ranges hold.
    const host = this.host as unknown[];
    for (const [from, bytes] of s.ranges) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let at = 0; at + st <= bytes.byteLength; at += st)
        host[(from + at) / st] = readValue(dv, at, e, this.proto);
    }
    const both = this.fresh === 'both' && device;
    this.fresh = 'host';
    // Set without moving the version back: the device buffer took the same ranges.
    if (both) this.fresh = 'both';
  }
}

/** The values a call of `core`'s storage array of `length` elements sees, copied out of the region
 *  now, and the array marked clean; undefined when the device copy holds them already. */
function captureOf(core: Core, state: RegionState, length: number): Snapshot | undefined {
  core.live();
  const region = core.region;
  const offset = core.range.offset;
  const bytes = length * state.layout.st;
  if (state.captured !== length) {
    state.captured = length;
    const full = new Uint8Array(region.buffer, offset, bytes).slice().buffer as ArrayBuffer;
    core.clean();
    return { full, length };
  }
  if (!core.dirty) return undefined;
  const ranges = core
    .ranges()
    .map(
      ([from, to]) =>
        [
          from,
          new Uint8Array(region.buffer, offset + from, Math.min(to, bytes) - from).slice(),
        ] as const,
    )
    .filter(([, b]) => b.byteLength > 0);
  core.clean();
  return { ranges };
}

/** What a call takes for `v` when it is a resource (change 0138, R2): a uniform's value as it is
 *  now, or a storage array recorded for the call; undefined for any other value. Not API: the call
 *  layer reads it. */
export function resourceOf(
  v: unknown,
):
  | { readonly kind: 'uniform'; readonly name: string; value(): unknown }
  | { readonly kind: 'buffer'; readonly name: string; record(writes: boolean): RecordedBuffer }
  | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const core = cores.get(v);
  if (core === undefined) return undefined;
  if (v instanceof BufferRoot)
    return { kind: 'buffer', name: core.name, record: (w) => v.record(w) };
  const layout = uniformLayouts.get(v);
  if (layout === undefined) return undefined;
  return {
    kind: 'uniform',
    name: core.name,
    value: () => {
      core.live();
      return readValue(new DataView(core.region.buffer, core.range.offset, layout.sz), 0, layout);
    },
  };
}

/** The struct layout of each uniform, which a call reads its value by. */
const uniformLayouts = new WeakMap<object, Layout & { k: 'o' }>();
