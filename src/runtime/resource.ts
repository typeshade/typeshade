import type { Layout, LayoutNumber } from '../core/host-entry.js';
import { describe, pack } from '../core/host-entry.js';
import { handleOf, kernelQueue, makeResident, type ZeroedElement } from '../core/resident.js';
import { resourceProbes } from '../core/resource-probe.js';
import { defaultDevice } from './default-device.js';
import type { f32, f64, array as HostArray, i32, u32, vec4f } from './host-types.js';
import { globalRegion, type Range, type Region } from './region.js';
import {
  adopt,
  captureOf,
  Core,
  cores,
  dispose,
  readValue,
  RegionState,
} from './resource-state.js';
import type { Texture } from './resources.js';
export { DIRTY_RANGE_LIMIT } from './resource-state.js';
// Why: the `declare module` below augments `ScratchBuffers`, and TypeScript resolves an augmentation only for a module this file imports.
import type {} from '../core/fuse-plan.js';
import { resources, type RecordedBuffer as Recorded } from '../core/host-record.js';
import { type CallOwner } from '../core/owner.js';
import { noteFailure, throwFailure } from '../core/submission.js';

export const LAYOUT_KEY: unique symbol = Symbol.for('typeshade.layout') as never;

export interface ClassLayouts {
  readonly u?: Layout;
  readonly un?: string;
  readonly s?: Layout & { readonly k: 'a' };
  readonly sn?: string;
  readonly a?: 1;
}

type ShaderClass<T> = abstract new (...args: never) => T;

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

export function dirtyRange(
  resource: object,
): { readonly from: number; readonly to: number; readonly offset: number } | undefined {
  const core = cores.get(resource);
  if (core === undefined) throw new TypeError('dirtyRange(): takes a Uniform or a Buffer.');
  core.live();
  const span = core.span();
  return span === undefined ? undefined : { ...span, offset: core.range.offset };
}

export function dirtyRanges(resource: object): (readonly [number, number])[] {
  const core = cores.get(resource);
  if (core === undefined) throw new TypeError('dirtyRanges(): takes a Uniform or a Buffer.');
  core.live();
  return core.ranges();
}

export function markClean(resource: object): void {
  cores.get(resource)?.clean();
}

export function rangeOf(resource: object): { readonly region: Region; readonly range: Range } {
  const core = cores.get(resource);
  if (core === undefined) throw new TypeError('rangeOf(): takes a Uniform or a Buffer.');
  return { region: core.region, range: core.range };
}

type Typed = Float32Array | Int32Array | Uint32Array;

const VIEW = { f32: Float32Array, f64: Float32Array, i32: Int32Array, u32: Uint32Array } as const;

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

class Leaf {
  readonly #core: Core;
  readonly #at: number;
  readonly #l: Layout & { k: 's' | 'v' | 'm' };
  readonly #path: string;
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

  #index(i: number): number {
    const l = this.#l;
    return l.k === 'm' ? Math.floor(i / l.r) * (l.cs / 4) + (i % l.r) : i;
  }

  #word(v: unknown, i: number): number {
    const l = this.#l;
    const at = i < 0 ? this.#path : `${this.#path}[${i}]`;
    if (l.k !== 'm' && l.b === 1) {
      if (typeof v !== 'boolean')
        throw new TypeError(`${at}: takes a boolean, got ${describe(v)}.`);
      return v ? 1 : 0;
    }
    if (l.k === 's' && l.m !== undefined) {
      const id = typeof v === 'string' ? l.m.indexOf(v) : -1;
      if (id < 0)
        throw new TypeError(
          `${at}: takes one of ${l.m.map((m) => `'${m}'`).join(', ')}, got ${describe(v)}.`,
        );
      return id;
    }
    return numberOf(this.#t, v, this.#path, i);
  }

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

  #span(view: Typed): void {
    this.#core.mark(this.#at, this.#at + view.byteLength);
  }

  set(): void {
    // Why: `arguments`, not a rest parameter, because an engine makes an array of a rest parameter at every call, and `set` allocates nothing (R7).
    /* eslint-disable prefer-rest-params */
    const view = this.#lanes();
    this.#core.current(`${this.#path}.set()`);
    const count = this.#count;
    const n = arguments.length;
    let changed = false;
    if (n === 1 && typeof arguments[0] === 'object' && arguments[0] !== null && count > 1) {
      const src = arguments[0] as ArrayLike<unknown>;
      if (src.length !== count)
        throw new TypeError(
          `${this.#path}.set(): takes ${count} numbers, got ${describe(src)}${Array.isArray(src) ? '' : ` of length ${String(src.length)}`}.`,
        );
      for (let i = 0; i < count; i++) if (this.#put(view, i, this.#word(src[i], i))) changed = true;
    } else if (n === count) {
      for (let i = 0; i < count; i++)
        if (this.#put(view, i, this.#word(arguments[i], count > 1 ? i : -1))) changed = true;
    } else
      throw new TypeError(
        count === 1
          ? `${this.#path}.set(): takes one number, got ${n} arguments.`
          : `${this.#path}.set(): takes ${count} numbers or one array of ${count}, got ${n} arguments.`,
      );
    if (changed) this.#span(view);
  }

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
    const l = this.#l;
    if (l.k !== 'm' && l.b === 1)
      return l.k === 's' ? view[0] !== 0 : Array.from(view, (w) => w !== 0);
    if (l.k === 's' && l.m !== undefined) return l.m[view[0]!];
    return l.k === 's' ? view[0] : view;
  }
}

class ArrayField {
  readonly #core: Core;
  readonly #at: number;
  readonly #l: Layout & { k: 'a' };
  readonly #path: string;
  readonly #items: Field[] = [];
  readonly length: number;

  constructor(core: Core, at: number, l: Layout & { k: 'a' }, path: string) {
    this.#core = core;
    this.#at = at;
    this.#l = l;
    this.#path = path;
    this.length = l.n ?? 0;
  }

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

  set(values: unknown): void {
    this.#core.live();
    this.#core.current(`${this.#path}.set()`);
    const xs = values as ArrayLike<unknown>;
    if (typeof values !== 'object' || values === null || xs.length !== this.length)
      throw new TypeError(
        `${this.#path}.set(): takes an array of ${this.length} values, got ${describe(values)}.`,
      );
    for (let i = 0; i < this.length; i++) (this.at(i).set as (v: unknown) => void)(xs[i]);
  }

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

const FIELD = Symbol('field');

const STRUCT_OWN = ['set', 'constructor'];
const ROOT_OWN = [...STRUCT_OWN, 'needsUpdate', 'dispose'];

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

  set(value: unknown): void {
    this.#core.live();
    this.#core.current(`${this.#path}.set()`);
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

type AnyFunction = (...args: never) => unknown;
type DataKeys<T> = { [K in keyof T]-?: T[K] extends AnyFunction ? never : K }[keyof T];
type Some<T> = { readonly [K in DataKeys<T>]?: T[K] };

type Join<Path extends string, K> = Path extends '' ? K & string : `${Path}.${K & string}`;

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

type ReservedDepth = 4;

type ReservedWithin<F, Path extends string, D extends 0[]> = F extends number | boolean
  ? never
  : F extends readonly (infer E)[]
    ? ReservedWithin<E, Path, D>
    : F extends object
      ? Reserved<F, 'set', Path, D>
      : never;

type Refuse<Name> = [Name] extends [never]
  ? unknown
  : {
      readonly TS8079: `the field "${Name & string}" has the name of a member of the host accessor, so a host cannot reach it; rename the field in the shader`;
    };

type ResourceClass<T, Own extends string> = ShaderClass<T> & Refuse<Reserved<T, Own>>;

type ViewOf<E> = [E] extends [f32]
  ? Float32Array
  : [E] extends [f64]
    ? Float64Array
    : [E] extends [i32]
      ? Int32Array
      : [E] extends [u32]
        ? Uint32Array
        : Float32Array;

interface ScalarField<T> {
  set(value: T): void;
  get(): T;
}

interface TupleField<T extends readonly number[]> {
  set(...components: T): void;
  set(components: ArrayLike<number>): void;
  get(): Readonly<ViewOf<T[number]>>;
}

interface ArrayFieldOf<E> {
  readonly length: number;
  at(index: number): FieldOf<E>;
  set(values: readonly E[]): void;
  get(): E extends number
    ? Readonly<ViewOf<E>>
    : E extends readonly number[]
      ? Readonly<ViewOf<E[number]>>
      : never;
}

type FieldOf<T> = T extends boolean
  ? ScalarField<boolean>
  : T extends readonly boolean[]
    ? number extends T['length']
      ? never
      : BoolTupleField<T>
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

type StructOf<T> = { readonly [K in DataKeys<T>]: FieldOf<T[K]> } & {
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

export type ScalarArray = Float32Array | Int32Array | Uint32Array | Float64Array;

export type ElementOfTyped<T> = T extends Float32Array
  ? f32
  : T extends Int32Array
    ? i32
    : T extends Uint32Array
      ? u32
      : T extends Float64Array
        ? f64
        : never;

export type ZeroedBufferElement<E> = E extends 'f32' ? f32 : E extends 'i32' ? i32 : u32;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyBuffer = Buffer<any>;

// Why: `typeshade/fuse` may import no type of the program runtime, so the type of what `scope.scratch()` returns is added to `ScratchBuffers` of `core/fuse-plan.ts` from here.
declare module '../core/fuse-plan.js' {
  interface ScratchBuffers {
    readonly f32: Buffer<f32>;
    readonly i32: Buffer<i32>;
    readonly u32: Buffer<u32>;
    readonly vec4f: Buffer<vec4f>;
  }
}

type IsOpen<T> = [T] extends [f32]
  ? [T] extends [u32]
    ? [T] extends [i32]
      ? true
      : false
    : false
  : false;

type BufferRead<T> =
  IsOpen<T> extends true
    ? Float32Array | Int32Array | Uint32Array | Float64Array
    : [T] extends [boolean]
      ? boolean[]
      : [T] extends [readonly boolean[]]
        ? boolean[]
        : [T] extends [string]
          ? T[]
          : NumberRead<T>;

type NumberRead<T> = T extends number
  ? ViewOf<T>
  : T extends readonly number[]
    ? ViewOf<T[number]>
    : T[];

type BufferData<T> = [T] extends [boolean]
  ? readonly boolean[]
  : [T] extends [readonly boolean[]]
    ? readonly boolean[]
    : [T] extends [string]
      ? readonly T[]
      : T extends number | readonly number[]
        ? ScalarArray | readonly number[]
        : readonly Some<T>[];

interface BoolTupleField<T extends readonly boolean[]> {
  set(...components: T): void;
  set(components: readonly boolean[]): void;
  get(): boolean[];
}

type BufferElement<T> = [T] extends [boolean]
  ? ScalarField<boolean>
  : [T] extends [readonly boolean[]]
    ? BoolTupleField<T & readonly boolean[]>
    : [T] extends [string]
      ? ScalarField<T>
      : NumberElement<T>;

type NumberElement<T> = T extends number
  ? ScalarField<T>
  : T extends readonly number[]
    ? TupleField<T>
    : StructOf<T>;

/**
 * An array on the device of `length` elements `T` (change 0138, R9; Amendments A10, Q-I, and A11):
 * a `Buffer` of structs, one range of the region laid out as a storage array with no size (Rule
 * 6.8), made by {@link zeros} or {@link array} with a class; or a `Buffer` of scalars or vectors,
 * made by `array(xs)` of a typed array, `array(length, element)` or a kernel called on a resource.
 * Every `Buffer` has the same members (A11, Q1). `ps.at(i).pos.set(x, y, z)` writes one field of a
 * struct element, and `xs.at(i).set(1.5)` one scalar; `await b.read()` gives every element: each
 * an instance of the class for a struct, and one typed array of the scalar for a scalar or a
 * vector, the components one after another (A11, Q2 and Q5). From a call that writes it until
 * `read()` brings its values back, `set`, `resize`, `needsUpdate` and the accessors' `get` and `set`
 * throw a `TypeError`. Freed by `dispose()` or when the garbage collector reclaims it, and by
 * `[Symbol.dispose]()`, which the type declares as `Disposable` where the host's `lib` declares
 * `Symbol.dispose` (Amendment A5, D4). A binding a shader module exports is a `Buffer` of structs
 * too (Rule 6.1): a `storage<array<T, N>>` keeps its `N` elements, and a `storage<array<T>>`, which
 * states no size, has no length until the host calls `resize` or `set`; until then `length` is 0,
 * and `at` and `read` throw a `TypeError` that names the binding. The view types an exported
 * binding without `dispose()` and `[Symbol.dispose]()` (D7).
 *
 * Exported from `typeshade/runtime`.
 */
export interface Buffer<T> extends Disposable {
  /** How many elements it holds; a vector is one element (Amendment A11, Q5). An exported storage
   *  array with no size holds 0 until the host sets its length with `resize` or `set`. */
  readonly length: number;
  /** Give the array `length` elements (Amendment A3): the elements that fit keep their values, a
   *  new element is zero. An accessor that `at` returned before reads the array's new range, and
   *  throws a `TypeError` for an element that is gone.
   *  @throws `TypeError` for a length that is not a whole number, for another length than the one
   *  a shader file states (`storage<array<T, N>>`), and while a call's values are on the device. */
  resize(length: number): void;
  /** Give the array the length of `data` and its values (Amendment A3): for a struct, each element
   *  gives some of its fields, and the others are zero, as `array(Class, data)` reads them; for a
   *  scalar or a vector, the numbers, the components one after another. A `data` that does not fit
   *  changes nothing.
   *  @throws `TypeError` for `data` that is no array, for an element that does not fit, for
   *  another length than the one a shader file states, and while a call's values are on the
   *  device. */
  set(data: BufferData<T>): void;
  /** Element `index`'s accessor: a struct's fields, or a scalar's or a vector's element view with
   *  `get` and `set` (Amendment A11, Q1). @throws `RangeError` for an index outside the array. */
  at(index: number): BufferElement<T>;
  /** Every element: each an instance of the class, built without its constructor, for a struct;
   *  one typed array of the scalar for a scalar or a vector (Amendment A11, Q2 and Q5). */
  read(): Promise<BufferRead<T>>;
  /** Whether the array holds a change not yet uploaded. Set it to `true` after writing through a
   *  view that `get` returned. A new array is dirty. */
  needsUpdate: boolean;
  /** Free the array. A use of an accessor after it throws a `TypeError`. */
  dispose(): void;
}

/**
 * A host value of an array with no size, or the function that makes a storage array (change
 * 0138). As a type it is the host type family's `array<T>` (change 0116, Rule 8.21): the typed
 * array of `T`'s scalar, or an array of structs, and a `Buffer` of the scalars (Amendment A10,
 * Q-I).
 *
 * Exported from `typeshade/runtime`.
 */
export type array<T, N extends number = number> = HostArray<T, N>;

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

interface Sizing {
  readonly fixed?: { readonly length: number; readonly module: string };
  readonly unset?: string;
}

class BufferRoot {
  readonly #core: Core;
  readonly #l: Layout & { k: 'a' };
  readonly #Element: typeof StructField;
  readonly #proto: object;
  readonly #fixed: Sizing['fixed'];
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

  get length(): number {
    return this.#length;
  }

  #sized(at: string): void {
    this.#core.live();
    if (this.#unset !== undefined) {
      const name = this.#core.name;
      throw new TypeError(
        `${name}.${at}: ${name} is a storage array with no size that ${this.#unset} exports, and its length is not set. Call ${name}.resize(n) or ${name}.set(data) first.`,
      );
    }
  }

  #fits(at: string, length: number): void {
    const fixed = this.#fixed;
    if (fixed !== undefined && length !== fixed.length) {
      const name = this.#core.name;
      throw new TypeError(
        `${name}.${at}: ${name} is a storage array of ${fixed.length} elements in ${fixed.module}, which states its size, so it cannot hold ${length}. Declare it storage<array<T>>, with no size, for a length the host sets.`,
      );
    }
  }

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

  read(): Promise<unknown[]> {
    const core = this.#core;
    this.#sized('read()');
    try {
      throwFailure();
    } catch (e) {
      return Promise.reject(e);
    }
    kernelQueue.submit();
    if (core.states.size === 0)
      return Promise.resolve(this.#decode(core.region.buffer, core.range.offset));
    return (async () => {
      await kernelQueue.idle();
      throwFailure();
      const error = core.error();
      if (error !== undefined) throw error;
      const state = core.ahead;
      if (state === undefined) return this.#decode(core.region.buffer, core.range.offset);
      const back = await this.#land(state);
      return this.#decode(back, 0, state.length);
    })();
  }

  async #land(state: RegionState): Promise<ArrayBuffer> {
    const core = this.#core;
    await state.fenced();
    await state.sync(true);
    core.live();
    const st = this.#l.st;
    const bytes = state.length * st;
    const back = new ArrayBuffer(Math.max(4, bytes));
    pack(new DataView(back), 0, { ...this.#l, n: state.length }, state.host, '');
    // Why: a `set` made while the read waited is newer than the device's value, so the read then lands nothing and the array stays ahead of the region until a later read; no call of the API reaches this guard.
    if (!core.dirty && state.length === this.#length && core.ahead === state) {
      new Uint8Array(core.region.buffer, core.range.offset, bytes).set(
        new Uint8Array(back, 0, bytes),
      );
      core.ahead = undefined;
      for (const other of core.states.values()) if (other !== state) other.captured = -1;
    }
    return back;
  }

  async forget(owner: CallOwner): Promise<void> {
    const core = this.#core;
    const state = core.states.get(owner);
    if (state === undefined) return;
    if (core.ahead === state && state.error === undefined && !core.range.freed) {
      try {
        await this.#land(state);
      } catch (e) {
        core.kept = e;
        noteFailure(e);
      }
    }
    if (core.ahead === state) core.ahead = undefined;
    if (state.error !== undefined) core.kept ??= state.error;
    core.states.delete(owner);
    state.handle?.dispose();
  }

  #decode(buffer: ArrayBuffer, offset: number, length = this.#length): unknown[] {
    const dv = new DataView(buffer, offset, length * this.#l.st);
    const out: unknown[] = [];
    for (let i = 0; i < length; i++)
      out.push(readValue(dv, i * this.#l.st, this.#l.e, this.#proto, true));
    return out;
  }

  prepare(writes: boolean, owner: CallOwner): RecordedBuffer {
    const core = this.#core;
    this.#sized('a call');
    let state = core.states.get(owner);
    if (state === undefined) {
      state = new RegionState(this.#l, this.#proto, core);
      state.ownedBy = owner;
      core.states.set(owner, state);
    }
    state.handle ??= handleOf(state);
    const error = core.error();
    if (error !== undefined) throw error;
    if (core.ahead !== undefined && core.ahead !== state) {
      const name = core.name;
      throw new TypeError(
        `${name}: a call on ${core.ahead.ownedBy?.label ?? 'another device'} wrote ${name}, and its values are on that device until \`await ${name}.read()\` brings them back; await it first. A call on ${owner.label} takes it after that read.`,
      );
    }
    const length = this.#length;
    state.checking = length;
    return {
      handle: state.handle,
      layout: this.#l,
      name: core.name,
      done: () => {
        state.checking = undefined;
      },
      commit: () => {
        const snapshot = captureOf(core, state, length);
        if (writes) core.ahead = state;
        return snapshot === undefined ? undefined : () => state.apply(snapshot);
      },
    };
  }

  resize(length: unknown): void {
    const core = this.#core;
    core.live();
    core.current(`${core.name}.resize()`);
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
    this.#rewritten();
  }

  #rewritten(): void {
    this.#core.kept = undefined;
    for (const state of this.#core.states.values()) {
      state.error = undefined;
      state.captured = -1;
    }
  }

  set(data: unknown): void {
    const core = this.#core;
    core.live();
    core.current(`${core.name}.set()`);
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
    this.#rewritten();
  }

  get needsUpdate(): boolean {
    this.#core.live();
    return this.#core.dirty;
  }
  set needsUpdate(v: boolean) {
    this.#core.live();
    this.#core.current(`${this.#core.name}.needsUpdate`);
    if (v) this.#core.markAll();
    else this.#core.clean();
  }
  dispose(): void {
    dispose(this.#core);
    for (const state of this.#core.states.values()) state.handle?.dispose();
  }
}

declare global {
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
 * A storage array of the structs of `cls` that `data` holds (change 0138, R9), a `Buffer`; or,
 * with a typed array, a `Buffer` of its scalars that keeps it on the device across calls
 * (Amendment A1: `array(xs)` replaces `resident(xs)`; Amendment A10, Q-I): a `Buffer<f32>` for a
 * `Float32Array` or a `number[]`, and so on; or, with a length and an element, a zeroed `Buffer` of scalars. What
 * it makes belongs to the device in use (`using _ = device.use()`), or to the default owner when
 * none is in use (R3): a `Buffer` of scalars is the one `device.array()` makes.
 *
 * Exported from `typeshade/runtime`.
 *
 * @param cls - an exported class of a `.shade.ts`, whose elements `data` holds; each element
 *   gives some of its fields, and the others are zero.
 * @returns a `Buffer<T>`.
 * @throws `TypeError` as {@link zeros} does, for `data` that is no array, for a value that is not
 *   an array (Amendment A11, Q3: write `uniform(Class, init)`, or pass the value to the call), and
 *   for an array that holds anything but numbers (A11, Q4: write `array(Class, data)` for
 *   structs).
 */
export function array<T extends object>(
  cls: ResourceClass<T, 'set'>,
  data: readonly Some<T>[],
): Buffer<T>;
export function array<T extends ScalarArray>(value: T): Buffer<ElementOfTyped<T>>;
export function array(value: readonly number[]): Buffer<number>;
export function array<E extends ZeroedElement>(
  length: number,
  element: E,
): Buffer<ZeroedBufferElement<E>>;
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
  const device = defaultDevice() as
    { arrayAs(at: string, a: readonly unknown[]): unknown } | undefined;
  if (device !== undefined) return device.arrayAs('array()', args);
  return makeResident('array()', args);
}

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
  cores.get(resource as object)!.owner = undefined;
  if (resource instanceof BufferRoot) exported.add(resource);
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

export interface RecordedBuffer extends Recorded {
  readonly layout: Layout & { readonly k: 'a' };
}

export function resourceOf(v: unknown):
  | {
      readonly kind: 'uniform';
      readonly name: string;
      readonly owner: CallOwner | undefined;
      value(): unknown;
    }
  | {
      readonly kind: 'buffer';
      readonly name: string;
      readonly owner: CallOwner | undefined;
      prepare(writes: boolean, owner: CallOwner): RecordedBuffer;
    }
  | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const core = cores.get(v);
  if (core === undefined) return undefined;
  if (v instanceof BufferRoot)
    return {
      kind: 'buffer',
      name: core.name,
      owner: core.owner,
      prepare: (w, owner) => v.prepare(w, owner),
    };
  const layout = uniformLayouts.get(v);
  if (layout === undefined) return undefined;
  return {
    kind: 'uniform',
    name: core.name,
    owner: undefined,
    value: () => {
      core.live();
      return readValue(new DataView(core.region.buffer, core.range.offset, layout.sz), 0, layout);
    },
  };
}

resourceProbes.push((v) => {
  const r = resourceOf(v);
  return r === undefined ? undefined : r.kind === 'uniform' ? 'Uniform' : 'Buffer';
});

const uniformLayouts = new WeakMap<object, Layout & { k: 'o' }>();

resources.of = resourceOf;

function rawOf(l: Layout, v: unknown): unknown {
  switch (l.k) {
    case 's':
      return l.b === 1 ? (v === true ? 1 : 0) : l.m !== undefined ? l.m.indexOf(v as string) : v;
    case 'v':
      return Array.from(v as ArrayLike<unknown>, (x) => (l.b === 1 ? (x === true ? 1 : 0) : x));
    case 'm':
      return Array.from(v as ArrayLike<number>);
    case 'a':
      return Array.from(v as ArrayLike<unknown>, (x) => rawOf(l.e, x));
    case 'o': {
      const o: Record<string, unknown> = {};
      for (const [name, , fl] of l.f) o[name] = rawOf(fl, (v as Record<string, unknown>)[name]);
      return o;
    }
  }
}

resources.structs = (layout, proto, name, length, owner) => {
  const core = new Core(globalRegion(), length * layout.st, name, `array(Class, data)`, layout.st);
  const buffer = new BufferRoot(core, layout, length, proto, {});
  const recorded = buffer.prepare(true, owner);
  recorded.done();
  const upload = recorded.commit();
  const state = core.states.get(owner)!;
  return {
    value: buffer,
    state,
    upload,
    fill: (values) => {
      state.host = values.map((v) => rawOf(layout.e, v));
      state.length = length;
      state.fresh = 'host';
    },
  };
};

const exported = new Set<BufferRoot>();

export async function forgetOwner(owner: CallOwner): Promise<void> {
  for (const b of exported) await b.forget(owner);
}

export function deviceCopies(resource: object): number {
  return cores.get(resource)?.states.size ?? 0;
}
