// ═══ An array that stays on the device across kernel calls, and the tiers a call may use ═══
// ═══ (Rule 11.8, surface §65, change 0013)                                               ═══
//
// `resident(array)` wraps a typed array or an array of objects once. A kernel function called
// with it (`core/host-kernel.ts`), or an entry given it for a storage array with no size
// (`core/host-compute.ts`, `core/host-draw.ts`), uploads it on the first call that runs on WebGPU and then
// binds the same buffer at every call after, reading nothing back: a chain of calls costs one
// upload and, at `await r.read()`, one read. On the CPU tier it is an array the handle holds.
//
// Every kernel call, entry call and draw that reads a handle runs in the order it was made, one after another, whether or
// not the caller awaits it; `read()` waits for the calls made before it. A call that fails while
// nobody awaits it keeps its error on each handle it writes, and `read()` throws it.
//
// Inside the body of `fuse()` (`typeshade/fuse`, change 0058) the kernel calls are recorded and run
// together as one item in this order, taken when the body returns. So nothing else may reach the
// order while the body runs: `read()`, `write()` and `destroy()` of a handle, and every other use
// of `kernelQueue`, ask the slot of `core/fuse-scope.ts` first and are refused with a `TypeError`.
//
// `configure({ prefer })` is the order of the tiers a kernel call or an entry call tries:
// WebGPU, WebGL2, the CPU. A one-entry list makes that tier required.
//
// Like the rest of `typeshade/runtime` it imports no compiler.

import {
  download,
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
import { fuseSlot } from './fuse-scope.js';
import { TIERS, tierNames, type Tier } from './tiers.js';

declare const residentBrand: unique symbol;

/** What {@link resident} wraps: a host value (Rule 8.21), a typed array for an array with no
 *  size among them. */
type ResidentValue = unknown;

/**
 * A value that stays on the device across calls (Rule 11.8, surface §65), made by
 * {@link resident}: one buffer of both layers (change 0025). Pass it where a kernel function
 * takes an array, as an entry's storage array with no size (surface §67), or as any buffer
 * binding of a program runtime's draw or dispatch (surface §69): the first use on WebGPU uploads
 * it, the uses after bind it as it is, and nothing is read back until {@link Resident.read}. A
 * call whose written arrays are all resident, and that returns nothing, only queues.
 *
 * Exported from `typeshade` and `typeshade/runtime`.
 */
export interface Resident<T = ResidentValue> {
  /**
   * Wait for every kernel call made before this one, and return a new array holding what the
   * handle holds.
   *
   * @throws the error of a queued call that wrote this handle and failed; `TypeError` inside the
   *   body of `fuse()`, which records kernel calls only (change 0058).
   */
  read(): Promise<T>;
  /**
   * Replace what the handle holds with `value`, after every call made before this one; with
   * none waiting, at once. The next use uploads it.
   *
   * @throws `TypeError` inside the body of `fuse()`, as `read()` does.
   */
  write(value: T): void;
  /** Release the device buffer, after every call made before this one. A use after it throws,
   *  and `TypeError` inside the body of `fuse()`, as for `read()`. */
  destroy(): void;
  readonly [residentBrand]: T;
}

/** The handle's state, which only the runtime reads. */
export class ResidentArrayState {
  /** What the handle holds on the host; stale while `fresh` is `'device'`. */
  host: unknown;
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
  /** Set by `destroy()`: a use after it throws. */
  destroyed = false;

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
    this.host = v;
    this.fresh = 'host';
  }

  /** What `read()` returns: a new copy of the host copy, once the device has been read back. The
   *  caller gets a copy, so the host copy stays equal to the device's (`sync(true)`). */
  async snapshot(): Promise<unknown> {
    await this.sync(true);
    return copyOf(this.host);
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
      throw new TypeError('This Resident was destroyed; make a new one with resident().');
    if (this.gpu === undefined || this.gpu.d !== d) {
      const b = bytes();
      this.gpu = { d, buffer: storageBuffer(d, b), size: b.byteLength, layout };
    } else if (this.fresh === 'host') {
      const b = bytes();
      if (b.byteLength === this.gpu.size) uploadTo(d, this.gpu.buffer, b);
      else {
        // A write changed its length: a new buffer of the new size.
        this.gpu.buffer.destroy();
        this.gpu = { d, buffer: storageBuffer(d, b), size: b.byteLength, layout };
      }
    }
    // A call that writes leaves the device's copy the newer. One that only reads leaves the
    // newer copy where it was: the device's when a call wrote it, both alike after an upload.
    if (writes) this.fresh = 'device';
    else if (this.fresh === 'host') this.fresh = 'both';
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
      throw new TypeError('This Resident was destroyed; make a new one with resident().');
    if (this.gpu === undefined || this.gpu.d !== d) {
      // The buffer is the size of the layout's elements: a number is 4 bytes, and a vector of 3
      // is padded to 16.
      const flat = layout.k === 'a' && layout.n === null ? flatWidth(layout.e) : undefined;
      const size =
        flat === undefined
          ? this.length * 4
          : (this.length / flat.n) * (layout as Layout & { k: 'a' }).st;
      this.gpu = { d, buffer: zeroedBuffer(d, size), size, layout };
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

/** A copy of `a`, so that the handle and the caller never share an array. */
function copyOf<T>(a: T): T {
  return ArrayBuffer.isView(a)
    ? ((a as unknown as Float32Array).slice() as unknown as T)
    : structuredClone(a);
}

/** Why `v` is not a host value a Resident can hold, or undefined when it is. */
function notHostValue(v: unknown): string | undefined {
  if (typeof v === 'number' || typeof v === 'boolean') return undefined;
  if (ArrayBuffer.isView(v))
    return v instanceof Float32Array ||
      v instanceof Int32Array ||
      v instanceof Uint32Array ||
      v instanceof Float64Array
      ? undefined
      : `a ${v.constructor.name}, which no binding holds`;
  if (Array.isArray(v)) return undefined;
  if (typeof v === 'object' && v !== null) return undefined;
  return v === null ? 'null' : `a ${typeof v}`;
}

/** The array a zeroed `Resident` of `element` holds. */
export type ZeroedArray<E extends ZeroedElement> = E extends 'f32'
  ? Float32Array
  : E extends 'i32'
    ? Int32Array
    : Uint32Array;

/**
 * Wrap a host value once so that it stays on the device across calls (Rule 11.8, surface §65):
 * `const dev = resident(new Float32Array(512 * 512)); render(k, 512, dev); const img = await
 * dev.read();`. A kernel or entry call takes the handle where it takes the value, and a program
 * of `typeshade/runtime` takes it as a binding. The handle holds its own copy of `value`.
 *
 * With a length and an element, `resident(length, element)` makes a zeroed handle that holds no
 * host copy and writes no byte until a call writes it or the host reads it (surface §65). The
 * element is `'f32'`, `'i32'` or `'u32'`, and it has no default.
 *
 * Exported from `typeshade` and `typeshade/runtime`.
 *
 * @param value - a number, a tuple, a `Float32Array`, `Int32Array`, `Uint32Array` or
 *   `Float64Array`, an array, or an object for a struct.
 * @param element - with a length: `'f32'`, `'i32'` or `'u32'`, the element of the zeros.
 * @returns the handle, whose `write` replaces its contents and `destroy` frees its buffer.
 * @throws `TypeError` for any other value, and for a length or an element a zeroed handle refuses.
 */
export function resident<T>(value: T): Resident<T>;
export function resident<E extends ZeroedElement>(
  length: number,
  element: E,
): Resident<ZeroedArray<E>>;
export function resident(...args: unknown[]): Resident<unknown> {
  if (args.length < 2) return handleOf(hostState(args[0]));
  return handleOf(zeroedState(args[0], args[1]));
}

/** The state of a `resident(value)` handle: a host value, copied. */
function hostState(value: unknown): ResidentArrayState {
  const not = notHostValue(value);
  if (not !== undefined)
    throw new TypeError(
      `resident(): takes a host value (a number, a tuple, a typed array, an array or an object), not ${not}.`,
    );
  return new ResidentArrayState(copyOf(value));
}

/** How a refused argument of `resident()` reads in its message. */
function argumentKind(v: unknown): string {
  if (Array.isArray(v)) return 'an array';
  if (v === null) return 'null';
  if (ArrayBuffer.isView(v)) return `a ${v.constructor.name}`;
  if (typeof v === 'object') return 'an object';
  return typeof v === 'string' ? `'${v}'` : `a ${typeof v}`;
}

/** The state of a `resident(length, element)` handle, after the three refusals R1 to R3. */
function zeroedState(length: unknown, element: unknown): ZeroedState {
  if (typeof length !== 'number')
    throw new TypeError(
      `resident(): with an element, the first argument is the length, a whole number; got ${argumentKind(length)}.`,
    );
  if (!Number.isInteger(length) || length < 1 || length > MOST_ZEROED)
    throw new TypeError(
      `resident(): a zeroed Resident takes a length that is a whole number from 1 to ${MOST_ZEROED}; got ${length}.`,
    );
  if (element !== 'f32' && element !== 'i32' && element !== 'u32')
    throw new TypeError(
      `resident(): a zeroed Resident takes the element 'f32', 'i32' or 'u32'; got ${typeof element === 'string' ? `'${element}'` : String(element)}.`,
    );
  return new ZeroedState(length, element);
}

/** The most elements a zeroed array holds: a kernel indexes an array with a `u32`. */
const MOST_ZEROED = 0xffffffff;

/** The handle of `state`: the methods of a `Resident`, over the state's queue and buffer. */
function handleOf(state: ResidentArrayState): Resident<unknown> {
  const live = (): void => {
    if (state.destroyed)
      throw new TypeError('This Resident was destroyed; make a new one with resident().');
  };
  const handle = {
    read(): Promise<unknown> {
      fuseSlot.active?.refuse('read()', 'a read of a Resident');
      return (async () => {
        live();
        await kernelQueue.idle();
        if (state.error !== undefined) throw state.error;
        return state.snapshot();
      })();
    },
    write(v: unknown): void {
      fuseSlot.active?.refuse('write()', 'a write to a Resident');
      live();
      const bad = notHostValue(v);
      if (bad !== undefined) throw new TypeError(`write(): takes a host value, not ${bad}.`);
      const copy = copyOf(v);
      kernelQueue.whenIdle(() => {
        state.assign(copy);
      });
    },
    destroy(): void {
      fuseSlot.active?.refuse('destroy()', 'the destroy of a Resident');
      if (state.destroyed) return;
      state.destroyed = true;
      kernelQueue.whenIdle(() => {
        state.gpu?.buffer.destroy();
        state.gpu = undefined;
      });
    },
  } as unknown as Resident<unknown>;
  states.set(handle, state);
  return handle;
}

// ─── the order of calls ──────────────────────────────────────────────────────────────────────

/** The kernel calls and entry calls in the order they were made: each runs when the one before
 *  has settled. */
export const kernelQueue = {
  last: Promise.resolve() as Promise<unknown>,
  /** How many calls are queued and not yet settled. */
  pending: 0,
  /** Run `f` after every call made before it. */
  run<T>(f: () => Promise<T>): Promise<T> {
    fuseSlot.active?.refuse('the kernel queue', 'a call that joins it');
    this.pending++;
    const p = this.last.then(f);
    this.last = p
      .catch(() => undefined)
      .finally(() => {
        this.pending--;
      });
    return p;
  },
  /** Run `f` now when no call is queued, and after the calls queued before it otherwise. */
  whenIdle(f: () => void): void {
    fuseSlot.active?.refuse('the kernel queue', 'a call that waits on it');
    if (this.pending === 0) f();
    else void this.run(async () => f());
  },
  /** Settle once every call made so far has. */
  idle(): Promise<unknown> {
    fuseSlot.active?.refuse('the kernel queue', 'a call that waits on it');
    return this.last;
  },
};

// ─── the tiers ───────────────────────────────────────────────────────────────────────────────

let preferred: readonly Tier[] = TIERS;

/** The tiers a kernel call or an entry call tries, in order. */
export function preferredTiers(): readonly Tier[] {
  return preferred;
}

/**
 * Set how a kernel call or a `@compute` entry's call runs (Rule 11.8).
 *
 * `prefer` is the order of the tiers it tries: WebGPU, WebGL2 and the CPU tier, the default being
 * all three in that order. A one-entry list makes that tier required, and a call that cannot run
 * on it throws, naming why: `configure({ prefer: ['webgpu'] })`.
 *
 * `runtime` is a program runtime (`createRuntime()`, change 0025) whose device every call uses,
 * so a texture or a `Resident` the host made on it reaches a call; `null` returns to the default
 * device. Left out, each option keeps its value.
 *
 * Exported from `typeshade` and `typeshade/runtime`.
 *
 * @param options - `prefer`, a non-empty list of `'webgpu'`, `'webgl2'` and `'cpu'`; `runtime`,
 *   a runtime or `null`. `configure({})` restores the default order.
 * @throws `TypeError` for an empty list, a repeated entry or an unknown tier, and for a runtime
 *   with no device or on WebGL2.
 */
export function configure(options: {
  readonly prefer?: readonly Tier[];
  readonly runtime?: { readonly device: object } | null;
}): void {
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
    useRuntime(rt ?? undefined);
    if (options.prefer === undefined) return;
  }
  const prefer = options.prefer ?? TIERS;
  if (!Array.isArray(prefer) || prefer.length === 0)
    throw new TypeError('configure(): prefer takes a non-empty list of tiers.');
  for (const t of prefer)
    if (!TIERS.includes(t))
      throw new TypeError(
        `configure(): "${String(t)}" is not a tier; the tiers are ${tierNames()}.`,
      );
  if (new Set(prefer).size !== prefer.length)
    throw new TypeError('configure(): prefer names a tier twice.');
  preferred = [...prefer];
}
