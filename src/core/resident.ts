// ═══ The handle of a Buffer of scalars or vectors, and the tiers a call may use ═══
// ═══ (Rule 11.8, surface §65, change 0013; change 0138, Amendments A10 and A11)  ═══
//
// `array(xs)` of a typed array, and `array(length, element)`, make a `Buffer` of scalars (change
// 0138, Amendment A10, Q-I). Its handle is one buffer of both layers (change 0025): a kernel
// function called with it (`core/host-kernel.ts`), or an entry given it for a storage array with
// no size (`core/host-compute.ts`, `core/host-draw.ts`), uploads it on the first call that runs on
// WebGPU and then binds the same buffer at every call after, reading nothing back: a chain of
// calls costs one upload and, at `await b.read()`, one read. On the CPU tier it is the typed array
// the handle holds. It takes no range of the region of R17: its host copy is a typed array of its
// own (Amendment A11, Q1). Its members are the members of `Buffer<T>` (`runtime/resource.ts`, A11
// Q1): `length`, `read()`, `set(data)`, `resize(n)`, `at(i)`, `needsUpdate` and `dispose()`.
//
// A call that takes a `Buffer` is a call on a resource (change 0138, R2; A10 Q-I): it is recorded
// and does not block. Every kernel call, entry call and draw that reads a handle runs in the order
// it was made, one after another; `read()` waits for the calls made before it. A call that fails
// keeps its error on each handle it writes, and `read()` throws it. From a call that writes the
// handle until `read()` brings its values back, `set`, `resize`, `needsUpdate` and the element
// view's `get` and `set` throw a `TypeError`, as they do for a `Buffer` of structs (A11 Q1).
//
// Inside the body of today's `fuse()` (`typeshade/fuse`, change 0058) the kernel calls are recorded
// and run together as one item in this order, taken when the body returns. So nothing else may
// reach the order while the body runs: `read()`, `set()` and `dispose()` of a handle, and every
// other use of `kernelQueue`, ask the slot of `core/fuse-scope.ts` first and are refused with a
// `TypeError`.
//
// `configure({ prefer })` is the tier order a default-owner kernel call or entry call tries:
// WebGPU, WebGL2, the CPU. A one-entry list makes that tier required.
//
// Like the rest of `typeshade/runtime` it imports no compiler.

import {
  configuredRuntime,
  deviceFixed,
  download,
  forgetBuffer,
  keepBuffer,
  madeReport,
  pendingClears,
  requestedDevice,
  setRequestedDevice,
  useRuntime,
  flatWidth,
  readInto,
  storageBuffer,
  uploadTo,
  zeroedBuffer,
  type GpuBuffer,
  type GpuDevice,
  type Layout,
} from './host-entry.js';
import type { CallOwner } from './owner.js';
import { checkLimitValues } from './device-limits.js';
import { automaticFp64Flavor } from './device-info.js';
import { fuseSlot } from './fuse-scope.js';
import { afterCheckpoint, flushSubmission, throwFailure } from './submission.js';
import { readFence } from './gl-fence.js';
import { warnDeprecated } from './deprecation.js';
import { TIERS, tierNames, type Tier } from './tiers.js';
import type { Fp64Flavor } from './passes/fp64-lower.js';

declare const residentBrand: unique symbol;

/** The element view of a `Buffer` of scalars or vectors (Amendment A11, Q1): `get` reads one
 *  element and `set` writes it. Not API: `runtime/resource.ts` types it for the author. */
export interface ElementView {
  get(): unknown;
  set(...value: unknown[]): void;
}

/**
 * The handle of a `Buffer` of scalars or vectors (change 0138, Amendments A10 Q-I and A11): what
 * `array(xs)`, `array(length, element)`, `device.array()`, a scratch array of today's `fuse` and
 * the result of a kernel called on a resource make. Its members are the members of `Buffer<T>`
 * (A11, Q1). Not API: the author's type is `Buffer<T>` of `runtime/resource.ts`. `T` is what
 * `read()` gives: the typed array of the element's scalar.
 */
export interface Resident<T = unknown> {
  /** How many elements it holds; a vector is one element (Amendment A11, Q5). */
  readonly length: number;
  /** Wait for every call made before this one, and give a new typed array of what it holds. */
  read(): Promise<T>;
  /** Replace what it holds with the numbers of `data`, after every call made before this one;
   *  its length becomes that of `data`. */
  set(data: unknown): void;
  /** Give it `length` elements: the ones that fit keep their values, a new one is zero. */
  resize(length: number): void;
  /** Element `index`'s view. */
  at(index: number): ElementView;
  /** Whether it holds a change not yet uploaded. */
  needsUpdate: boolean;
  /** Release the device buffer, after every call made before this one. */
  dispose(): void;
  readonly [residentBrand]?: T;
}

/** The handle's state, which only the runtime reads. */
export class ResidentArrayState {
  /** What the handle holds on the host; stale while `fresh` is `'device'`. */
  host: unknown;
  /** How many scalars one element holds: 1 for a `Buffer` of scalars, `N` for a `Buffer<vecN>`
   *  (Amendment A11, Q5), whose `length` counts vectors. */
  components = 1;
  /** Whether a call that writes the handle was made, and `read()` has not brought its values back
   *  since (Amendment A11, Q1): the host copy may be stale, so the host's accessors throw. */
  ahead = false;
  /** Counts each call made that writes the handle: a `read()` leaves the window of {@link ahead}
   *  only when no call wrote the handle while it waited. */
  writes = 0;
  /** The host values a `set`, `resize` or element `set` gave while calls made before it had not
   *  run: they take the host copy's place once those calls have run, so each call sees the values
   *  of its own call (change 0138, Amendment A5, default 3). */
  next: ArrayBufferView | undefined;

  /** A call that writes the handle was made (change 0138, R2): the host copy is stale until a
   *  `read()`. */
  markWritten(): void {
    this.ahead = true;
    this.writes++;
  }
  #fresh: 'host' | 'device' | 'both' = 'host';
  /** Counts every change of {@link fresh}: a `sync` that downloads checks it, to know that no write
   *  set the state while the download ran. */
  #epoch = 0;
  /** How many times the host copy may have changed: a WebGL2 draw that uploaded it keeps the
   *  number, and uploads again once it moves (change 0054). */
  version = 0;
  /** Where the newest contents are: the host copy, the device buffer, or both alike. Marking the
   *  host copy the newer moves {@link version}. */
  get fresh(): 'host' | 'device' | 'both' {
    return this.#fresh;
  }
  set fresh(v: 'host' | 'device' | 'both') {
    if (v === 'host') this.version++;
    this.#epoch++;
    this.#fresh = v;
  }
  /** The device buffer, once a call on WebGPU has made it, with its size and layout. */
  gpu: { d: GpuDevice; buffer: GpuBuffer; size: number; layout: Layout } | undefined;
  /** The error of a queued call that wrote the handle, which `read()` throws. */
  error: unknown;
  /** The WebGL2 context a call that wrote the handle ran on, whose fence its next `read()` waits
   *  on (change 0138, Amendment A5, default 6); undefined otherwise. */
  fence: WebGL2RenderingContext | undefined;
  /** Wait on the fence of the WebGL2 context that last wrote the handle, once. A lost context ends
   *  the wait: the WebGL2 tier read the values back inside the call (`readFence`). */
  async fenced(): Promise<void> {
    const gl = this.fence;
    if (gl === undefined) return;
    this.fence = undefined;
    await readFence(gl);
  }
  /** Set by `destroy()`: a use after it throws. */
  destroyed = false;
  /** Whether the device buffer holds stale contents that are zeros by contract, which the next
   *  flush that binds it clears (`pendingClears` in `core/host-entry.ts`, change 0071). The host
   *  copy holds the zeros meanwhile. */
  #clearPending = false;
  #clearBound = false;
  get clearPending(): boolean {
    return this.#clearPending;
  }
  set clearPending(value: boolean) {
    this.#clearPending = value;
    this.#clearBound = false;
  }
  /** The device that made the handle (`device.array()`, change 0071), which a call of another
   *  owner may not take; undefined for a handle of the default owner (`resident()`). */
  ownedBy: CallOwner | undefined;

  constructor(host: unknown) {
    this.host = host;
  }

  /**
   * A handle that holds no elements until a call needs them says how many it holds, after it has
   * checked that `param` takes them: a scratch array of a `fuse` scope (change 0058). A call
   * checks such a handle by this, and not by a host copy that it would have to make. It is
   * undefined for every other handle, whose host copy a call checks.
   */
  measure?(
    call: string,
    param: {
      readonly name: string;
      readonly layout: Layout & { readonly k: 'a' };
      readonly s: string;
    },
  ): number;

  /**
   * Why `subject` may not use this handle, when only the kernel calls in the body of one `fuse`
   * scope may: a scratch array (change 0058). `subject` is what uses it, as a sentence starts.
   * An entry call (`core/host-compute.ts`) and a draw (`core/host-draw.ts`) ask it of each handle
   * they are given, since a scratch array holds no host array for the call to check. It is
   * undefined for every other handle.
   */
  outside?(subject: string): TypeError;

  /** Bring the host copy up to date, reading the device buffer when it is newer. The caller
   *  goes on to use the host copy, which a CPU or WebGL2 tier may write in place, so the host
   *  copy is the newer one after it. Resolves to whether it read the device buffer, which is
   *  one submission.
   *
   *  With `keep`, the caller only reads the host copy. A copy the device has just given back is
   *  equal to the device's, so the state becomes `'both'` and the next use that only reads binds
   *  the buffer without an upload. Without a download `keep` changes nothing. A change that lands
   *  during the download takes the path without `keep`, as it did before `keep` existed. */
  async sync(keep = false): Promise<boolean> {
    // A clear that waits for a flush: the host copy holds the zeros, and is the newer.
    if (this.clearPending) this.dropClear();
    let read = false;
    if (this.fresh === 'device' && this.gpu !== undefined) {
      const epoch = this.#epoch;
      const dv = await download(this.gpu.d, this.gpu.buffer, this.gpu.size);
      readInto(dv, 0, this.gpu.layout, this.host);
      read = true;
      // Set without the setter: a copy equal to the device's moves no version (change 0054).
      if (keep && this.#epoch === epoch) {
        this.#fresh = 'both';
        return read;
      }
    } else if (keep) return read;
    this.fresh = 'host';
    return read;
  }

  /** Replace the host copy with `v`, which is the newer: the caller's `write()` (surface §65). */
  assign(v: unknown): void {
    if (this.clearPending) this.dropClear();
    this.host = v;
    this.fresh = 'host';
  }

  /** Take a waiting clear out: the host copy of zeros is the newer, and the next use uploads it. */
  dropClear(): void {
    this.clearPending = false;
    if (this.gpu !== undefined) pendingClears.delete(this.gpu.buffer);
    this.fresh = 'host';
  }

  /** What `read()` returns: a new copy of the host copy, once the device has been read back. The
   *  caller gets a copy, so the host copy stays equal to the device's (`sync(true)`). */
  async snapshot(): Promise<unknown> {
    await this.sync(true);
    return copyOf(this.host, 'read()');
  }

  /** The host copy as a check of a call sees it. A handle with none yet says what it would hold. */
  view(): unknown {
    return this.host;
  }

  /** The device buffer for `layout`, made or refreshed from the host copy as needed; a call
   *  that `writes` it leaves the device copy the newer, and one that only reads leaves both
   *  alike, so the next use binds it without an upload. */
  bufferFor(d: GpuDevice, layout: Layout, bytes: () => ArrayBuffer, writes: boolean): GpuBuffer {
    if (this.destroyed)
      throw new TypeError('This Buffer was disposed; make a new one with array().');
    if (this.clearPending && !this.#clearBound && this.gpu?.d === d) {
      // A pooled zeroed array has 32-bit host elements. Its next binding can need different
      // padding: twelve scalar scratch words occupy 48 bytes, four vec3 values occupy 64.
      // Count that layout without packing a potentially large array of zeros.
      const flat = layout.k === 'a' ? flatWidth(layout.e) : undefined;
      const size =
        layout.k === 'a' && flat !== undefined && ArrayBuffer.isView(this.host)
          ? (this.host.byteLength / 4 / flat.n) * layout.st
          : bytes().byteLength;
      if (size !== this.gpu.size) {
        const buffer = keepBuffer(zeroedBuffer(d, size));
        this.dropClear();
        forgetBuffer(d, this.gpu.buffer);
        this.gpu.buffer.destroy();
        this.gpu = { d, buffer, size, layout };
        this.fresh = 'both';
      }
    }
    if (this.gpu === undefined || this.gpu.d !== d) {
      const b = bytes();
      if (this.gpu !== undefined) forgetBuffer(this.gpu.d, this.gpu.buffer);
      this.gpu = { d, buffer: keepBuffer(storageBuffer(d, b)), size: b.byteLength, layout };
    } else if (this.fresh === 'host') {
      const b = bytes();
      if (b.byteLength === this.gpu.size) uploadTo(d, this.gpu.buffer, b);
      else {
        // A write changed its length: a new buffer of the new size.
        forgetBuffer(d, this.gpu.buffer);
        this.gpu.buffer.destroy();
        this.gpu = { d, buffer: keepBuffer(storageBuffer(d, b)), size: b.byteLength, layout };
      }
    }
    // A call that writes leaves the device's copy the newer. One that only reads leaves the
    // newer copy where it was: the device's when a call wrote it, both alike after an upload.
    if (writes) this.fresh = 'device';
    else if (this.fresh === 'host') this.fresh = 'both';
    // A later binding in this batch must keep the earlier binding's buffer and pending clear.
    // Only a new zeroed lease may prepare the layout again; a failed allocation never gets here.
    this.#clearBound = this.clearPending;
    return this.gpu.buffer;
  }
}

/** The element types of a zeroed array, each with the zeroed typed array of its host copy. */
export const ZEROED_ELEMENTS = {
  f32: (n: number) => new Float32Array(n),
  i32: (n: number) => new Int32Array(n),
  u32: (n: number) => new Uint32Array(n),
} as const;
export type ZeroedElement = keyof typeof ZEROED_ELEMENTS;

/**
 * The state of an array that holds zeros until a call or the host needs them (Rule 11.8,
 * surface §65): `resident(length, element)`, and a scratch array of a `fuse` scope (change 0058),
 * which extends it. It holds no host copy until the host reads it or a CPU or WebGL2 call takes
 * it, and no device buffer until a call on WebGPU takes it. The first call on WebGPU makes a zeroed
 * buffer, which a new buffer is, and writes no byte to it.
 */
export class ZeroedState extends ResidentArrayState {
  readonly length: number;
  readonly element: ZeroedElement;

  constructor(length: number, element: ZeroedElement) {
    super(undefined);
    this.length = length;
    this.element = element;
  }

  /** The host copy as a check of a call sees it: the zeros it would hold, when none is kept. */
  override view(): unknown {
    return this.host ?? ZEROED_ELEMENTS[this.element](this.length);
  }

  /** The element and the length a call checks: a zeroed array holds no host copy to check. */
  override measure(
    call: string,
    param: {
      readonly name: string;
      readonly layout: Layout & { readonly k: 'a' };
      readonly s: string;
    },
  ): number {
    const at = `${call}(): parameter "${param.name}"`;
    const { e, n } = param.layout;
    // A runtime-sized array takes a zeroed array as it takes the typed array of the same element:
    // of scalars, or of vectors of `element` whose length is a whole number of them.
    const flat = n === null ? flatWidth(e) : e.k === 's' ? { n: 1, t: e.t } : undefined;
    if (flat === undefined || flat.t !== this.element)
      throw new TypeError(
        `${at} (${param.s}): got a zeroed array of ${this.element} numbers, which only an array of ${this.element} scalars or vectors takes.`,
      );
    if (this.length % flat.n !== 0)
      throw new TypeError(
        `${at} (${param.s}): got a zeroed array of ${this.length} numbers, which is not a whole number of ${flat.n}-component elements.`,
      );
    const count = this.length / flat.n;
    if (n !== null && n !== count)
      throw new TypeError(
        `${at} (${param.s}): got a zeroed array of ${this.length} numbers, which takes ${n}.`,
      );
    return count;
  }

  /** A call on the host, or a read, needs the elements: zeros, or what the device holds. */
  override async sync(keep = false): Promise<boolean> {
    this.host ??= ZEROED_ELEMENTS[this.element](this.length);
    return super.sync(keep);
  }

  /** `read()` of a handle that no call wrote and no `write()` replaced returns zeros, and keeps no
   *  host copy. */
  override async snapshot(): Promise<unknown> {
    if (this.host === undefined && this.fresh === 'host')
      return ZEROED_ELEMENTS[this.element](this.length);
    return super.snapshot();
  }

  /** A `write()` replaces the contents, so the host copy decides a call's check from now on. */
  override assign(v: unknown): void {
    (this as { measure?: unknown }).measure = undefined;
    super.assign(v);
  }

  /** The device buffer: zeroed when no host copy has been made, as WebGPU makes every new buffer,
   *  so nothing is uploaded; otherwise the array as any `Resident`. */
  override bufferFor(
    d: GpuDevice,
    layout: Layout,
    bytes: () => ArrayBuffer,
    writes: boolean,
  ): GpuBuffer {
    if (this.host !== undefined) return super.bufferFor(d, layout, bytes, writes);
    if (this.destroyed)
      throw new TypeError('This Buffer was disposed; make a new one with array().');
    if (this.gpu === undefined || this.gpu.d !== d) {
      // The buffer is the size of the layout's elements: a number is 4 bytes, and a vector of 3
      // is padded to 16.
      const flat = layout.k === 'a' && layout.n === null ? flatWidth(layout.e) : undefined;
      const size =
        flat === undefined
          ? this.length * 4
          : (this.length / flat.n) * (layout as Layout & { k: 'a' }).st;
      if (this.gpu !== undefined) forgetBuffer(this.gpu.d, this.gpu.buffer);
      this.gpu = { d, buffer: keepBuffer(zeroedBuffer(d, size)), size, layout };
    }
    if (writes) this.fresh = 'device';
    return this.gpu.buffer;
  }
}

const states = new WeakMap<object, ResidentArrayState>();

/** The runtime's state of a {@link Resident}, or undefined for any other value. */
export function residentState(v: unknown): ResidentArrayState | undefined {
  return typeof v === 'object' && v !== null ? states.get(v) : undefined;
}

/** Make `handle` stand for `state`, as {@link resident} does for the handle it returns. The other
 *  handles are the scratch arrays of a `fuse` scope (change 0058), which `typeshade/fuse` makes. */
export function adopt(handle: object, state: ResidentArrayState): void {
  states.set(handle, state);
}

/** Where a value sits in the value being copied: its key in the object above it, up to the root. */
interface Place {
  readonly up: Place | undefined;
  readonly key: string | number;
}

/** A place as the author writes it, `particles[2].born`, and `the value` for the root. The entries
 *  of a `Map` are named as `Array.from(map)` holds them, `scores[0][1]` for the value of the first. */
function placeName(at: Place | undefined): string {
  if (at === undefined) return 'the value';
  const keys: (string | number)[] = [];
  for (let p: Place | undefined = at; p !== undefined; p = p.up) keys.push(p.key);
  return keys
    .reverse()
    .map((k, i) =>
      typeof k === 'number'
        ? `[${k}]`
        : /^[A-Za-z_$][\w$]*$/u.test(k)
          ? `${i === 0 ? '' : '.'}${k}`
          : `[${JSON.stringify(k)}]`,
    )
    .join('');
}

/** What `x` is, when it keeps its data in internal slots, so that no prototype and no own property
 *  makes a copy of it: a `Date`, an `ArrayBuffer`, a `DataView`, a `RegExp`, an `Error`, a `Promise`
 *  and the rest of the built-ins that are none of the kinds `copyOf` copies. `undefined` for an
 *  array, a typed array, a `Map`, a `Set` and an ordinary object, an instance of a class among them. */
function slotKind(x: object): string | undefined {
  if (Array.isArray(x) || x instanceof Map || x instanceof Set) return undefined;
  if (ArrayBuffer.isView(x)) return x instanceof DataView ? 'a DataView' : undefined;
  const proto: unknown = Object.getPrototypeOf(x);
  if (proto === Object.prototype || proto === null) return undefined;
  const tag = Object.prototype.toString.call(x).slice(8, -1);
  return tag === 'Object' ? undefined : `${/^[AEIOU]/u.test(tag) ? 'an' : 'a'} ${tag}`;
}

/** What the first walk of {@link copyOf} throws when a level needs the second: the walk that keeps
 *  the places. */
const LOOK_AGAIN = Symbol('lookAgain');

/** The depth at which the first walk of {@link copyOf} doubts that the value ends. */
const MOST_DEPTH = 100;

/**
 * A copy of `v`, so that the handle and the caller never share an array or an object (Rule
 * 11.8). A typed array is sliced. An array, a `Map` and a `Set` are copied entry by entry. Any
 * other object is made from its own prototype, with its own enumerable properties copied, so an
 * instance of a class stays an instance of that class and its constructor does not run (change
 * 0109, Amendment 1, decision D5). Each level is a new value. The copy calls no
 * `structuredClone`, which an `AudioWorkletGlobalScope` does not have.
 *
 * A level it cannot copy is refused with a `TypeError` that names its place, `particles[2].born`,
 * and what it is (Rule 11.8, issue #1002): a `Date`, an `ArrayBuffer`, a `DataView` or another
 * object with internal slots, which the prototype and the own properties do not make again; and an
 * object that holds itself, which has no end to copy. A value two places hold is no cycle, and each
 * place copies it. An own property named `__proto__` is copied as the data property it is, and
 * does not set the prototype of the copy. `caller` is the call that refuses, as its sentence starts.
 *
 * The first walk keeps no place and no list of the objects it is in, since a value that a host
 * gives is shallow and has nothing to refuse. It stops at a level it must look at again, a kind it
 * cannot copy or a depth at which a cycle is possible, and a second walk of the value keeps both.
 */
export function copyOf<T>(v: T, caller: string): T {
  if (typeof v !== 'object' || v === null) return v;
  try {
    return walkCopy(v, caller, false) as T;
  } catch (e) {
    if (e !== LOOK_AGAIN) throw e;
  }
  return walkCopy(v, caller, true) as T;
}

/** One walk of {@link copyOf}. With `places` it keeps each level's place and the objects it is
 *  in, and refuses; without, it throws {@link LOOK_AGAIN} where it would refuse. */
function walkCopy(root: object, caller: string, places: boolean): object {
  // The objects being copied, from the root to the one in hand, each with its place.
  const open = new Map<object, Place | undefined>();
  const refuse = (at: Place | undefined, what: string): never => {
    if (!places) throw LOOK_AGAIN;
    throw new TypeError(
      `${caller}: takes a host value, and ${placeName(at)} ${what}, which no binding holds.`,
    );
  };
  const child = (
    c: unknown,
    at: Place | undefined,
    key: string | number,
    depth: number,
  ): unknown =>
    typeof c === 'object' && c !== null
      ? copy(c, places ? { up: at, key } : undefined, depth + 1)
      : c;
  const copy = (x: object, at: Place | undefined, depth: number): object => {
    if (places ? open.has(x) : depth > MOST_DEPTH)
      return refuse(at, `refers back to ${placeName(open.get(x))}, a cycle`);
    if (places) open.set(x, at);
    let out: object;
    if (Array.isArray(x)) {
      const items: unknown[] = [];
      for (let i = 0; i < x.length; i++) items.push(child(x[i], at, i, depth));
      out = items;
    } else if (Object.getPrototypeOf(x) === Object.prototype) {
      out = copyFields(x, {});
    } else {
      const kind = slotKind(x);
      if (kind !== undefined) return refuse(at, `is ${kind}`);
      if (ArrayBuffer.isView(x)) {
        out = (x as unknown as Float32Array).slice();
      } else if (x instanceof Map) {
        // An entry is a pair of its key and its value, each a place of its own.
        const entries = new Map<unknown, unknown>();
        let i = 0;
        for (const [k, val] of x) {
          const entry: Place | undefined = places ? { up: at, key: i } : undefined;
          i++;
          entries.set(child(k, entry, 0, depth), child(val, entry, 1, depth));
        }
        out = entries;
      } else if (x instanceof Set) {
        const members = new Set<unknown>();
        let i = 0;
        for (const val of x) members.add(child(val, at, i++, depth));
        out = members;
      } else {
        out = copyFields(x, Object.create(Object.getPrototypeOf(x) as object | null) as object);
      }
    }
    if (places) open.delete(x);
    return out;

    /** The own enumerable properties of `x`, each copied into `into`. */
    function copyFields(from: object, into: object): object {
      const target = into as Record<string, unknown>;
      for (const k of Object.keys(from)) {
        const val = child((from as Record<string, unknown>)[k], at, k, depth);
        // Assigning `__proto__` would set the prototype of the copy, as `JSON.parse` can give it.
        if (k === '__proto__')
          Object.defineProperty(target, k, {
            value: val,
            writable: true,
            enumerable: true,
            configurable: true,
          });
        else target[k] = val;
      }
      return target;
    }
  };
  return copy(root, undefined, 0);
}

/** The array a zeroed `Buffer` of `element` holds. */
export type ZeroedArray<E extends ZeroedElement> = E extends 'f32'
  ? Float32Array
  : E extends 'i32'
    ? Int32Array
    : Uint32Array;

/** The typed arrays a `Buffer` of scalars holds (Rule 8.21; Amendment A11, Q2). */
const TYPED = [Float32Array, Int32Array, Uint32Array, Float64Array] as const;
type TypedCtor = (typeof TYPED)[number];

/** Whether `v` is one of the typed arrays a `Buffer` of scalars holds. */
function isTyped(v: unknown): v is Float32Array | Int32Array | Uint32Array | Float64Array {
  return TYPED.some((C) => v instanceof C);
}

/**
 * A `Buffer` of scalars, as `array(value)` or `array(length, element)` makes one.
 *
 * Exported from `typeshade` and `typeshade/runtime`.
 *
 * @deprecated Write `array(value)` or `array(length, element)` from `typeshade/runtime` (change
 *   0138, Amendment A1). Change 0138 removes it with slice 1 of milestone 4 (Amendment A10, Q-I).
 *   The first call prints one warning.
 */
export function resident(...args: unknown[]): Resident<unknown> {
  warnDeprecated('array()', 'Write array(value) or array(length, element) instead.');
  return makeResident('array()', args);
}

/** What `array()` and `device.array()` make from their arguments, with `at` naming the function in
 *  each refusal: a `Buffer` of scalars from a typed array, or a zeroed one from a length and an
 *  element (change 0138, Amendments A1, A10 Q-I and A11 Q3 and Q4). Not API: `array()` of
 *  `typeshade/runtime` calls it. */
export function makeResident(at: string, args: readonly unknown[]): Resident<unknown> {
  if (args.length < 2) return handleOf(hostState(args[0], at));
  return handleOf(zeroedState(args[0], args[1], at));
}

/** The state of an `array(xs)` handle: a typed array, copied (Amendment A11, Q3 and Q4).
 *  @throws `TypeError` for a value that is not an array, and for an array that is no typed array:
 *    an array of structs is `array(Class, data)`, and any other value is passed to the call. */
function hostState(value: unknown, at = 'array()'): ResidentArrayState {
  if (isTyped(value)) return new ResidentArrayState(value.slice());
  if (Array.isArray(value) || ArrayBuffer.isView(value))
    throw new TypeError(
      `${at}: takes a Float32Array, an Int32Array, a Uint32Array or a Float64Array; got ${argumentKind(value)}. Write array(Class, data) for an array of structs of an exported class, array(new Float32Array(xs)) for numbers, or pass the array to the call as it is (change 0138, Amendment A11, Q4).`,
    );
  throw new TypeError(
    `${at}: takes an array; got ${argumentKind(value)}. A value the host keeps on the device is uniform(Class, init); pass any other value to the call as it is (change 0138, Amendment A11, Q3).`,
  );
}

/** How a refused argument of `array()` reads in its message. */
function argumentKind(v: unknown): string {
  if (Array.isArray(v)) return 'an array';
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (ArrayBuffer.isView(v)) return `a ${v.constructor.name}`;
  if (typeof v === 'object') return 'an object';
  return typeof v === 'string' ? `'${v}'` : `a ${typeof v}`;
}

/** The state of an `array(length, element)` handle, after the three refusals R1 to R3. */
function zeroedState(length: unknown, element: unknown, at = 'array()'): ZeroedState {
  if (typeof length !== 'number')
    throw new TypeError(
      `${at}: with an element, the first argument is the length, a whole number; got ${argumentKind(length)}.`,
    );
  if (!Number.isInteger(length) || length < 1 || length > MOST_ZEROED)
    throw new TypeError(
      `${at}: a zeroed Buffer takes a length that is a whole number from 1 to ${MOST_ZEROED}; got ${length}.`,
    );
  if (element !== 'f32' && element !== 'i32' && element !== 'u32')
    throw new TypeError(
      `${at}: a zeroed Buffer takes the element 'f32', 'i32' or 'u32'; got ${typeof element === 'string' ? `'${element}'` : String(element)}.`,
    );
  return new ZeroedState(length, element);
}

/** The most elements a zeroed array holds: a kernel indexes an array with a `u32`. */
const MOST_ZEROED = 0xffffffff;

/** The typed array kind a handle holds: its host copy's, or a zeroed handle's element. */
export function typedKind(state: ResidentArrayState): TypedCtor {
  const v = state.next ?? state.host;
  for (const C of TYPED) if (v instanceof C) return C;
  if (state instanceof ZeroedState) return ZEROED_CTOR[state.element];
  return Float32Array;
}

const ZEROED_CTOR = { f32: Float32Array, i32: Int32Array, u32: Uint32Array } as const;

/** The element of a typed array kind, as an error names it. */
const KIND_NAME = new Map<TypedCtor, string>([
  [Float32Array, 'f32'],
  [Int32Array, 'i32'],
  [Uint32Array, 'u32'],
  [Float64Array, 'f64'],
]);

/** The scalar a handle holds, as a parameter's type names it: `f32`, `i32`, `u32` or `f64`. */
export function kindName(state: ResidentArrayState): string {
  return KIND_NAME.get(typedKind(state))!;
}

/** How many scalars the handle holds: a zeroed handle that keeps no host copy says so without
 *  making one. */
function scalarsOf(state: ResidentArrayState): number {
  const v = state.next ?? state.host;
  if (ArrayBuffer.isView(v)) return (v as unknown as ArrayLike<number>).length;
  if (state instanceof ZeroedState) return state.length;
  return Array.isArray(v) ? v.length : 0;
}

/** How many elements a handle holds: its scalars, counted by element (Amendment A11, Q5). */
export function lengthOf(state: ResidentArrayState): number {
  return Math.floor(scalarsOf(state) / state.components);
}

/** The numbers of `data` as the typed array `C` holds them, for `set()` of a handle.
 *  @throws `TypeError` for `data` that is no typed array and no array of numbers, for a number
 *    that `C` does not hold, and for a length that is no whole number of elements. */
function numbersOf(
  C: TypedCtor,
  data: unknown,
  components: number,
  at: string,
): Float32Array | Int32Array | Uint32Array | Float64Array {
  const xs = data as ArrayLike<unknown>;
  if (!isTyped(data) && !Array.isArray(data))
    throw new TypeError(
      `${at}: takes a typed array or an array of numbers; got ${argumentKind(data)}.`,
    );
  const kind = KIND_NAME.get(C)!;
  for (let i = 0; i < xs.length; i++) {
    const n = xs[i];
    if (typeof n !== 'number')
      throw new TypeError(`${at}: element ${i} is ${argumentKind(n)}, not a number.`);
    if ((kind === 'i32' || kind === 'u32') && !fitsInteger(kind, n))
      throw new TypeError(
        `${at}: element ${i} is ${n}, which is not a whole number in the ${kind} range.`,
      );
  }
  if (xs.length % components !== 0)
    throw new TypeError(
      `${at}: takes a whole number of ${components}-component elements; got ${xs.length} numbers.`,
    );
  return new C(xs as ArrayLike<number>);
}

/** Whether `n` is a whole number in the range of `kind`. */
function fitsInteger(kind: 'i32' | 'u32', n: number): boolean {
  if (!Number.isInteger(n)) return false;
  return kind === 'i32' ? n >= -0x80000000 && n <= 0x7fffffff : n >= 0 && n <= 0xffffffff;
}

/** What a device does when a handle it made is read, set or disposed: it counts the bytes and
 *  keeps its books (change 0071). */
export interface HandleHooks {
  readonly read?: (value: unknown) => void;
  readonly set?: (value: ArrayBufferView) => void;
  readonly dispose?: () => void;
}

/** The host values of `state` as the host's accessors see them: the values a `set` gave, or the
 *  host copy, made of zeros for a zeroed handle that keeps none. */
function hostValues(state: ResidentArrayState): ArrayLike<number> & { [i: number]: number } {
  if (state.next !== undefined) return state.next as never;
  if (state.host === undefined && state instanceof ZeroedState)
    state.host = ZEROED_ELEMENTS[state.element](state.length);
  return state.host as never;
}

/** Give `state` the host values `v` once the calls made before have run (A5, default 3). */
function setLater(state: ResidentArrayState, v: ArrayBufferView): void {
  state.next = v;
  kernelQueue.whenIdle(() => {
    if (state.next !== v) return;
    state.next = undefined;
    state.assign(v);
  });
}

/** The handle of `state`: the members of a `Buffer` (Amendment A11, Q1), over the state's queue and
 *  buffer. `hooks` are a device's books (change 0071). */
export function handleOf(state: ResidentArrayState, hooks: HandleHooks = {}): Resident<unknown> {
  const live = (): void => {
    if (state.destroyed)
      throw new TypeError('This Buffer was disposed; make a new one with array().');
  };
  // The host's accessors read and write the host copy, which a call that wrote the handle left
  // stale until `read()` (Amendment A11, Q1). A call that failed leaves the window (A7, decision b).
  const current = (at: string): void => {
    live();
    if (state.ahead || state.fresh === 'device')
      throw new TypeError(
        `${at}: a call wrote this Buffer, and its values are on the device until \`await read()\` brings them back; await it first.`,
      );
  };
  // Write the host values: in place when no call waits to read them, else in a copy that takes
  // their place once the calls made before have run.
  const write = (f: (values: { [i: number]: number }) => void): void => {
    if (state.next === undefined && kernelQueue.pending === 0 && kernelQueue.held.length === 0) {
      if (state.clearPending) state.dropClear();
      f(hostValues(state));
      (state as { measure?: unknown }).measure = undefined;
      state.fresh = 'host';
      return;
    }
    const base = hostValues(state) as unknown as Float32Array;
    const copy = base.slice();
    f(copy);
    setLater(state, copy);
  };
  const handle = {
    get length(): number {
      return lengthOf(state);
    },
    read(): Promise<unknown> {
      fuseSlot.active?.refuse('read()', 'a read of a Buffer');
      return (async () => {
        live();
        const writes = state.writes;
        await kernelQueue.idle();
        // A recorded call that failed is thrown at the next read() (change 0138, R2).
        throwFailure();
        if (state.error !== undefined) throw state.error;
        // On WebGL2 the read waits on a fence (Amendment A5, default 6).
        await state.fenced();
        const v = await state.snapshot();
        if (state.writes === writes) state.ahead = false;
        hooks.read?.(v);
        return v;
      })();
    },
    set(data: unknown): void {
      fuseSlot.active?.refuse('set()', 'a set of a Buffer');
      current('set()');
      const v = numbersOf(typedKind(state), data, state.components, 'set()');
      hooks.set?.(v);
      // New values in all of it: the failure of an earlier call is gone (the owner's decision of
      // 2026-11-11, "set(data)나 resize()로 복구").
      state.error = undefined;
      setLater(state, v);
    },
    resize(length: unknown): void {
      fuseSlot.active?.refuse('resize()', 'a resize of a Buffer');
      current('resize()');
      if (
        typeof length !== 'number' ||
        !Number.isInteger(length) ||
        length < 0 ||
        length > 0xffffffff
      )
        throw new TypeError(
          `resize(): takes a length that is a whole number from 0 to 4294967295, got ${argumentKind(length)}.`,
        );
      const C = typedKind(state);
      const v = new C(length * state.components);
      const base = hostValues(state) as unknown as Float32Array;
      v.set(base.subarray(0, Math.min(base.length, v.length)) as never);
      state.error = undefined;
      setLater(state, v);
    },
    at(index: unknown): ElementView {
      live();
      const n = lengthOf(state);
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= n)
        throw new RangeError(
          `at(): takes a whole number from 0 to ${n - 1}, got ${argumentKind(index)}.`,
        );
      const c = state.components;
      const first = index * c;
      const kind = KIND_NAME.get(typedKind(state))!;
      const check = (x: unknown, at: string): number => {
        if (typeof x !== 'number')
          throw new TypeError(`${at}: takes a number; got ${argumentKind(x)}.`);
        if ((kind === 'i32' || kind === 'u32') && !fitsInteger(kind, x))
          throw new TypeError(`${at}: got ${x}, which is not a whole number in the ${kind} range.`);
        return x;
      };
      return {
        get(): unknown {
          current(`at(${index}).get()`);
          if (state.next === undefined && state.host === undefined && state instanceof ZeroedState)
            return c === 1 ? 0 : new (typedKind(state))(c);
          const values = hostValues(state) as unknown as Float32Array;
          return c === 1 ? values[first] : values.slice(first, first + c);
        },
        set(...value: unknown[]): void {
          fuseSlot.active?.refuse('set()', 'a set of a Buffer');
          const at = `at(${index}).set()`;
          current(at);
          const xs =
            c > 1 && value.length === 1 && typeof value[0] === 'object' && value[0] !== null
              ? Array.from(value[0] as ArrayLike<unknown>)
              : value;
          if (xs.length !== c)
            throw new TypeError(
              `${at}: takes ${c === 1 ? 'one number' : `${c} numbers`}; got ${xs.length}.`,
            );
          const nums = xs.map((x) => check(x, at));
          write((values) => {
            for (let j = 0; j < c; j++) values[first + j] = nums[j]!;
          });
        },
      };
    },
    get needsUpdate(): boolean {
      live();
      return state.next !== undefined || state.fresh === 'host';
    },
    set needsUpdate(v: boolean) {
      current('needsUpdate');
      if (v) write(() => {});
      else
        kernelQueue.whenIdle(() => {
          if (state.gpu !== undefined && state.fresh === 'host' && state.next === undefined)
            state.fresh = 'both';
        });
    },
    dispose(): void {
      fuseSlot.active?.refuse('dispose()', 'the dispose of a Buffer');
      if (state.destroyed) return;
      hooks.dispose?.();
      disposeState(state);
    },
  } as unknown as Resident<unknown>;
  const key = (Symbol as { readonly dispose?: symbol }).dispose;
  if (typeof key === 'symbol')
    Object.defineProperty(handle, key, {
      value(): void {
        handle.dispose();
      },
    });
  states.set(handle, state);
  return handle;
}

/** Mark `state` disposed and release its device buffer after the calls made before. */
export function disposeState(state: ResidentArrayState): void {
  if (state.destroyed) return;
  state.destroyed = true;
  kernelQueue.whenIdle(() => {
    if (state.gpu !== undefined) forgetBuffer(state.gpu.d, state.gpu.buffer);
    state.gpu?.buffer.destroy();
    state.gpu = undefined;
  });
}

/** Replace the host values of `state` with `v` once the calls made before have run: a device
 *  refills a pooled handle with it (change 0071). Not API. */
export function refill(state: ResidentArrayState, v: unknown): void {
  const copy = isTyped(v) ? v.slice() : v;
  state.error = undefined;
  kernelQueue.whenIdle(() => state.assign(copy));
}

// ─── the order of calls ──────────────────────────────────────────────────────────────────────

/** The kernel calls and entry calls in the order they were made: each runs when the one before
 *  has settled.
 *
 *  A call on a resource (change 0138, R2) is recorded with {@link kernelQueue.record}: it is held
 *  apart, and joins the order when the current microtask checkpoint ends, or sooner when anything
 *  else uses the order (a call with plain data only, a `read()`, a draw), which submits every
 *  call recorded before it first (Amendment A5, Q4 and defaults 2, 4 and 9). */
export const kernelQueue = {
  last: Promise.resolve() as Promise<unknown>,
  /** How many calls are queued and not yet settled. */
  pending: 0,
  /** The calls recorded and not yet submitted, in the order they were made. */
  held: [] as (() => void)[],
  /** Whether a submission at the end of the checkpoint is waiting. */
  scheduled: false,
  /** Run `f` after every call made before it. */
  run<T>(f: () => Promise<T>): Promise<T> {
    fuseSlot.active?.refuse('the kernel queue', 'a call that joins it');
    this.submit();
    return this.enqueue(f);
  },
  /** Put `f` at the end of the order. */
  enqueue<T>(f: () => Promise<T>): Promise<T> {
    this.pending++;
    const p = this.last.then(f);
    this.last = p
      .catch(() => undefined)
      .finally(() => {
        this.pending--;
      });
    return p;
  },
  /**
   * Record `f`, a call on a resource (change 0138, R2): it runs after every call made before it,
   * once the calls recorded are submitted. The submission comes when the current microtask
   * checkpoint ends, or at the next use of the order, whichever is first.
   */
  record<T>(f: () => Promise<T>): Promise<T> {
    fuseSlot.active?.refuse('the kernel queue', 'a call that joins it');
    return new Promise<T>((resolve, reject) => {
      this.held.push(() => {
        this.enqueue(f).then(resolve, reject);
      });
      if (!this.scheduled) {
        this.scheduled = true;
        afterCheckpoint(() => {
          this.scheduled = false;
          this.submit();
        });
      }
    });
  },
  /** Submit every call recorded and not yet submitted, in order. The end of the submission
   *  flushes each WebGL2 context its calls used (Amendment A5, default 6). */
  submit(): void {
    if (this.held.length === 0) return;
    for (const join of this.held.splice(0)) join();
    void this.enqueue(async () => flushSubmission());
  },
  /** Run `f` now when no call is queued, and after the calls queued before it otherwise. */
  whenIdle(f: () => void): void {
    fuseSlot.active?.refuse('the kernel queue', 'a call that waits on it');
    this.submit();
    if (this.pending === 0) f();
    else void this.enqueue(async () => f());
  },
  /** Settle once every call made so far has. */
  idle(): Promise<unknown> {
    fuseSlot.active?.refuse('the kernel queue', 'a call that waits on it');
    this.submit();
    return this.last;
  },
};

// ─── the tiers ───────────────────────────────────────────────────────────────────────────────

let preferred: readonly Tier[] = TIERS;

/** The tiers a kernel call or an entry call tries, in order. */
export function preferredTiers(): readonly Tier[] {
  return preferred;
}

/** The two flavors of the emulated double a call may run (`Fp64Flavor`, change 0073). */
export const FP64_FLAVORS: readonly Fp64Flavor[] = ['float', 'integer'];

let fp64Flavor: 'auto' | Fp64Flavor = 'auto';

/** Resolve the default owner's setting against the GPU executing this call (change 0085).
 * Without an executing GPU or a configured runtime, automatic selection is the CPU's float. */
export function configuredFp64Flavor(native?: object): Fp64Flavor {
  const device = native ?? configuredRuntime()?.device;
  return fp64Flavor === 'auto'
    ? device === undefined
      ? 'float'
      : automaticFp64Flavor('webgpu', device)
    : fp64Flavor;
}

/** `v` as a flavor of the emulated double, or the refusal `at` makes of a word that is not one.
 *  @throws `TypeError` naming the call and the three settings. */
export function checkFp64Flavor(at: string, v: unknown): 'auto' | Fp64Flavor {
  if (v !== 'auto' && !FP64_FLAVORS.includes(v as Fp64Flavor))
    throw new TypeError(
      `${at}: "${String(v)}" is not a flavor setting of the emulated double; the choices are 'auto', 'float' and 'integer'.`,
    );
  return v as 'auto' | Fp64Flavor;
}

/**
 * Set how a default-owner kernel call or `@compute` entry's call runs (Rule 11.8).
 *
 * `prefer` is the order of the tiers it tries: WebGPU, WebGL2 and the CPU tier, the default being
 * all three in that order. A one-entry list makes that tier required, and a call that cannot run
 * on it throws, naming why: `configure({ prefer: ['webgpu'] })`.
 *
 * `runtime` is a program runtime (`createRuntime()`, change 0025) whose device every call uses,
 * so a texture or a `Resident` the host made on it reaches a call; `null` returns to the default
 * device. Left out, each option keeps its value.
 *
 * `fp64Flavor` is the flavor of the emulated double the calls made after it run (change 0073):
 * `'auto'`, the default, resolves from the actual GPU: `'integer'` on Apple or Metal signals,
 * otherwise `'float'`. The CPU selects `'float'`. Explicit `'float'` and `'integer'` override it.
 * A kernel call, an entry call and a draw of a module that emulates `f64` dispatch the WGSL of
 * that flavor, the `_fp64` guard bound under `'float'` and absent under `'integer'`, and a
 * `fuse()` plan builds its fused entries under it. A module that emulates no `f64` is unchanged.
 * A device of `createDevice({ fp64Flavor })` has a flavor of its own.
 *
 * `limits` names the WebGPU limits the call layer's device must have, by their names in
 * `GPUSupportedLimits`, and `features` the WebGPU features it must have (change 0051). The
 * device is requested by the first call that needs it, so a limit is set before that call. A
 * limit or a feature the adapter cannot give fails that call. After the device exists, a
 * different value throws. With `runtime`, the host's device is used, and `limits` and `features`
 * throw.
 *
 * Exported from `typeshade` and `typeshade/runtime`.
 *
 * @deprecated Open a device with `createDevice()`, which takes the same options (change 0138,
 *   Amendment A1). The first call prints one warning.
 *
 * @param options - `prefer`, a non-empty list of `'webgpu'`, `'webgl2'` and `'cpu'`; `runtime`,
 *   a runtime or `null`; `limits`, WebGPU limits by name; `features`, WebGPU feature names;
 *   `fp64Flavor`, `'auto'`, `'float'` or `'integer'`. `configure({})` restores the default order
 *   and automatic flavor selection. Missing GPU signals retain the selector's float fallback;
 *   they do not establish hardware precision.
 * @throws `TypeError` for an empty list, a repeated entry or an unknown tier, for a runtime
 *   with no device or on WebGL2, for a wrong limit value, for a word that is not a flavor, and
 *   for a change after the device exists or with a runtime configured.
 */
export function configure(options: {
  readonly prefer?: readonly Tier[];
  readonly runtime?: { readonly device: object } | null;
  readonly limits?: Readonly<Record<string, number>>;
  readonly features?: readonly string[];
  readonly fp64Flavor?: 'auto' | Fp64Flavor;
}): void {
  warnDeprecated('configure()', 'Open a device with createDevice() and pass its options there.');
  // Every check comes before the first change, so a refused call changes nothing.
  if (options.fp64Flavor !== undefined)
    checkFp64Flavor('configure({ fp64Flavor })', options.fp64Flavor);
  if (options.runtime !== undefined) {
    const rt = options.runtime;
    if (
      rt !== null &&
      (typeof rt !== 'object' || typeof rt.device !== 'object' || rt.device === null)
    )
      throw new TypeError('configure(): runtime takes a runtime from createRuntime(), or null.');
    if (rt !== null && (rt as { tier?: unknown }).tier === 'webgl2')
      throw new TypeError(
        'configure(): runtime takes a WebGPU runtime; on WebGL2 the calls use a context of their own.',
      );
  }
  const runtimeAfter = options.runtime !== undefined ? options.runtime : configuredRuntime();
  if (
    (options.limits !== undefined || options.features !== undefined) &&
    runtimeAfter !== undefined &&
    runtimeAfter !== null
  ) {
    const which = options.limits !== undefined ? 'limits' : 'features';
    throw new TypeError(
      `configure({ ${which} }): a runtime is configured, and its device is the host's. ${
        which === 'limits'
          ? 'Pass limits to createRuntime({ limits }).'
          : 'Its features come from createRuntime({ programs }).'
      }`,
    );
  }
  if (options.limits !== undefined) {
    if (
      typeof options.limits !== 'object' ||
      options.limits === null ||
      Array.isArray(options.limits)
    )
      throw new TypeError('configure({ limits }): limits takes an object of limit values.');
    checkLimitValues(options.limits, 'configure({ limits })');
  }
  if (options.features !== undefined) {
    if (!Array.isArray(options.features) || options.features.some((f) => typeof f !== 'string'))
      throw new TypeError('configure({ features }): features takes a list of feature names.');
  }
  const prefer = options.prefer ?? TIERS;
  if (options.prefer !== undefined || restoresDefaults(options)) {
    if (!Array.isArray(prefer) || prefer.length === 0)
      throw new TypeError('configure(): prefer takes a non-empty list of tiers.');
    for (const t of prefer)
      if (!TIERS.includes(t))
        throw new TypeError(
          `configure(): "${String(t)}" is not a tier; the tiers are ${tierNames()}.`,
        );
    if (new Set(prefer).size !== prefer.length)
      throw new TypeError('configure(): prefer names a tier twice.');
  }
  const request = requestedDevice();
  if (deviceFixed()) {
    if (options.limits !== undefined) {
      const name = firstChanged(request.limits, options.limits);
      if (name !== undefined) {
        const have = madeReport()?.limits[name] ?? request.limits[name] ?? 'its default';
        throw new TypeError(
          `configure({ limits }): the call layer's device exists with ${name} ${have}, and its limits cannot change. Set limits before the first call, or pass createRuntime({ limits }) to configure({ runtime }).`,
        );
      }
    }
    if (options.features !== undefined && !sameNames(request.features, options.features))
      throw new TypeError(
        `configure({ features }): the call layer's device exists with features [${[...(madeReport()?.features ?? request.features)].join(', ')}], and its features cannot change. Set features before the first call, or pass createRuntime({ programs }) to configure({ runtime }).`,
      );
  }

  // Apply.
  if (options.runtime !== undefined) useRuntime(options.runtime ?? undefined);
  if (options.limits !== undefined || options.features !== undefined)
    setRequestedDevice({
      limits: Object.freeze({ ...(options.limits ?? request.limits) }),
      features: Object.freeze([...(options.features ?? request.features)]),
    });
  if (options.prefer !== undefined || restoresDefaults(options)) preferred = [...prefer];
  if (options.fp64Flavor !== undefined || restoresDefaults(options))
    fp64Flavor = options.fp64Flavor ?? 'auto';
}

/** Whether `options` names none of the options, which restores the default tier order and the
 *  default flavor of the emulated double. */
function restoresDefaults(options: {
  readonly prefer?: unknown;
  readonly runtime?: unknown;
  readonly limits?: unknown;
  readonly features?: unknown;
  readonly fp64Flavor?: unknown;
}): boolean {
  return (
    options.prefer === undefined &&
    options.runtime === undefined &&
    options.limits === undefined &&
    options.features === undefined &&
    options.fp64Flavor === undefined
  );
}

/** The first name in either record whose value differs, or undefined when none does. */
function firstChanged(
  was: Readonly<Record<string, number>>,
  now: Readonly<Record<string, number>>,
): string | undefined {
  for (const name of [...new Set([...Object.keys(was), ...Object.keys(now)])])
    if (was[name] !== now[name]) return name;
  return undefined;
}

/** Whether two lists of feature names hold the same names. */
function sameNames(a: readonly string[], b: readonly string[]): boolean {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((n, i) => n === y[i]);
}
