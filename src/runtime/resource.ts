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
// writes only a changed one, and then raises the resource's dirty flag and widens its dirty byte
// range (R8). It allocates nothing. `get` returns the field's typed view, `Readonly`; a host that
// writes through it sets `needsUpdate = true`. Each accessor makes its typed view once, and again
// only when the region's generation moved (a compaction or a replaced buffer, Amendment A1).
//
// The layout is the compiler's: the generated module puts each exported class's layouts on the
// class under `Symbol.for('typeshade.layout')` (`classModule` in `compiler/ts/host-face.ts`), so
// the runtime computes no layout itself. At milestone 1 no call takes a resource yet: the upload
// of a dirty range at submission is milestone 3 (R2), which reads `dirtyRange` below.
//
// Like the rest of `typeshade/runtime` it imports no compiler.

import type { Layout, LayoutNumber } from '../core/host-entry.js';
import { describe } from '../core/host-entry.js';
import {
  makeResident,
  type Resident,
  type ZeroedArray,
  type ZeroedElement,
} from '../core/resident.js';
import type { array as HostArray, f32, f64, i32, u32 } from './host-types.js';
import type { Texture } from './resources.js';
import { globalRegion, type Range, type Region } from './region.js';
import { defaultDevice } from './default-device.js';

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

/** What every accessor of one resource shares: its range, its dirty range and its name. */
class Core {
  readonly region: Region;
  readonly range: Range;
  /** `Uniform<Camera>`, `Buffer<Particle>`: what an error names. */
  readonly name: string;
  /** How to make it again, for an error after `dispose()`. */
  readonly remedy: string;
  dirty = true;
  lo = 0;
  hi: number;

  constructor(region: Region, bytes: number, name: string, remedy: string) {
    this.region = region;
    this.range = region.allocate(bytes);
    this.name = name;
    this.remedy = remedy;
    // A new resource has never been uploaded: all of it is dirty.
    this.hi = this.range.size;
  }

  /** Throw when the resource was freed: a freed range may be another resource's now. */
  live(): void {
    if (this.range.freed)
      throw new TypeError(
        `${this.name} was disposed; its fields cannot be read or set. Make a new one with ${this.remedy}.`,
      );
  }

  /** Raise the dirty flag and widen the dirty range to `[from, to)` bytes of the resource. */
  mark(from: number, to: number): void {
    if (!this.dirty) {
      this.dirty = true;
      this.lo = from;
      this.hi = to;
      return;
    }
    if (from < this.lo) this.lo = from;
    if (to > this.hi) this.hi = to;
  }
}

const cores = new WeakMap<object, Core>();

/** Frees the range of a resource the garbage collector reclaimed (R17). */
const registry =
  typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry<{ region: Region; range: Range }>(({ region, range }) =>
        region.free(range),
      )
    : undefined;

/** The core of `resource`, which `owner` holds. */
function adopt(owner: object, core: Core): void {
  cores.set(owner, core);
  registry?.register(owner, { region: core.region, range: core.range }, core);
}

function dispose(core: Core): void {
  if (core.range.freed) return;
  core.region.free(core.range);
  registry?.unregister(core);
}

/** The dirty byte range of a resource, relative to its own start and as an offset into the
 *  region's buffer, or undefined when it is clean. Not API: the upload of milestone 3 reads it.
 *  @throws `TypeError` for a value that is no resource, and for a disposed one. */
export function dirtyRange(
  resource: object,
): { readonly from: number; readonly to: number; readonly offset: number } | undefined {
  const core = cores.get(resource);
  if (core === undefined) throw new TypeError('dirtyRange(): takes a Uniform or a Buffer.');
  core.live();
  return core.dirty ? { from: core.lo, to: core.hi, offset: core.range.offset } : undefined;
}

/** Mark a resource clean, after its dirty range was uploaded. Not API. */
export function markClean(resource: object): void {
  const core = cores.get(resource);
  if (core !== undefined) core.dirty = false;
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
  #gen = -1;

  constructor(core: Core, at: number, l: Layout & { k: 's' | 'v' | 'm' }, path: string) {
    this.#core = core;
    this.#at = at;
    this.#l = l;
    this.#path = path;
    this.#count = l.k === 's' ? 1 : l.k === 'v' ? l.n : l.c * l.r;
    this.#t = l.k === 'm' ? 'f32' : l.t;
  }

  /** The view, made again after the region moved (Amendment A1). */
  #lanes(): Typed {
    const core = this.#core;
    core.live();
    const region = core.region;
    if (
      this.#view === undefined ||
      this.#gen !== region.generation ||
      this.#buffer !== region.buffer
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
      this.#view = new VIEW[this.#t](region.buffer, core.range.offset + this.#at, n);
      this.#buffer = region.buffer;
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
      if (Object.is(view[j], hi) && Object.is(view[k], lo)) return false;
      view[j] = hi;
      view[k] = lo;
      return true;
    }
    const j = this.#index(i);
    if (Object.is(view[j], x)) return false;
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
  /** The number the field holds. */
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
 * which `using` calls; the type does not declare it yet, since the library's `lib` has none.
 *
 * Exported from `typeshade/runtime`.
 */
export type Uniform<T> = StructOf<T> & {
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
 * it, and by `[Symbol.dispose]()` as a uniform is.
 *
 * Exported from `typeshade/runtime`.
 */
export interface Buffer<T> {
  /** How many elements it holds. */
  readonly length: number;
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
    if (v) core.mark(0, core.range.size);
    else core.dirty = false;
  }
  dispose(): void {
    dispose(cores.get(this)!);
  }
}

/** A storage array of structs. */
class BufferRoot {
  readonly #core: Core;
  readonly #l: Layout & { k: 'a' };
  readonly #Element: typeof StructField;
  readonly #proto: object;
  /** How many elements it holds. */
  readonly length: number;

  constructor(core: Core, l: Layout & { k: 'a' }, length: number, proto: object) {
    this.#core = core;
    this.#l = l;
    this.length = length;
    this.#proto = proto;
    this.#Element = structClass(StructField, l.e as Layout & { k: 'o' }, STRUCT_OWN, core.name);
    adopt(this, core);
  }

  /** Element `index`'s accessor. */
  at(index: number): StructField {
    this.#core.live();
    if (!Number.isInteger(index) || index < 0 || index >= this.length)
      throw new RangeError(
        `${this.#core.name}.at(): takes a whole number from 0 to ${this.length - 1}, got ${String(index)}.`,
      );
    return new this.#Element(
      this.#core,
      index * this.#l.st,
      this.#l.e as Layout & { k: 'o' },
      `${this.#core.name}[${index}]`,
    );
  }

  /** Every element, each an instance of the class. */
  read(): Promise<unknown[]> {
    const core = this.#core;
    core.live();
    const dv = new DataView(core.region.buffer, core.range.offset, core.range.size);
    const out: unknown[] = [];
    for (let i = 0; i < this.length; i++)
      out.push(readValue(dv, i * this.#l.st, this.#l.e, this.#proto));
    return Promise.resolve(out);
  }

  get needsUpdate(): boolean {
    this.#core.live();
    return this.#core.dirty;
  }
  set needsUpdate(v: boolean) {
    this.#core.live();
    if (v) this.#core.mark(0, this.#core.range.size);
    else this.#core.dirty = false;
  }
  dispose(): void {
    dispose(this.#core);
  }
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
): unknown {
  const l = layoutsOf(cls, at);
  if (l.u === undefined || l.u.k !== 'o')
    throw new TypeError(
      `${at}: ${l.name} has no uniform layout a host can write: ${l.un ?? 'it is no struct'}.`,
    );
  const name = `Uniform<${l.name}>`;
  const Root = structClass(UniformRoot, l.u, ROOT_OWN, name);
  const core = new Core(region, l.u.sz, name, `uniform(${l.name})`);
  const root = new Root(core, 0, l.u, name);
  adopt(root, core);
  if (init !== undefined) root.set(init);
  core.dirty = true;
  core.lo = 0;
  core.hi = core.range.size;
  return root;
}

/** A storage array of `length` elements of `cls` in `region`, from `data` when given. Not API. */
export function makeBuffer(
  region: Region,
  cls: unknown,
  length: unknown,
  data: unknown,
  at: string,
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
  const name = `Buffer<${l.name}>`;
  const core = new Core(region, length * l.s.st, name, `zeros(${l.name}, ${length})`);
  const buffer = new BufferRoot(core, l.s, length, (cls as { prototype: object }).prototype);
  if (data !== undefined) {
    const xs = data as ArrayLike<unknown>;
    for (let i = 0; i < length; i++) buffer.at(i).set(xs[i]);
  }
  core.dirty = true;
  core.lo = 0;
  core.hi = core.range.size;
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
 *   the accessor's own (`set`, `needsUpdate`, `dispose`), and for an `init` that does not fit.
 */
export function uniform<T extends object>(cls: ShaderClass<T>, init?: Some<T>): Uniform<T> {
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
 *   a struct with no storage layout, and for a length that is not a whole number.
 */
export function zeros<T extends object>(cls: ShaderClass<T>, length: number): Buffer<T> {
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
export function array<T extends object>(cls: ShaderClass<T>, data: readonly Some<T>[]): Buffer<T>;
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
 * A texture of the block's default device (change 0138, Amendment A1): `using _ = device.use()`
 * names the device, and the texture is the one `device.texture(options)` makes. A texture lives
 * on its device only, so it takes no range of the region (R17).
 *
 * Not exported yet: `device.use()` changes the `Device` export, which proposal 0138's front
 * matter does not declare, so `texture()` and `use()` join `typeshade/runtime` once it does.
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
