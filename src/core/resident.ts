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
// `configure({ prefer })` is the order of the tiers a kernel call or an entry call tries:
// WebGPU, WebGL2, the CPU. A one-entry list makes that tier required.
//
// Like the rest of `typeshade/runtime` it imports no compiler.

import {
  download,
  useRuntime,
  readInto,
  storageBuffer,
  uploadTo,
  type GpuBuffer,
  type GpuDevice,
  type Layout,
} from './host-entry.js';
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
   * @throws the error of a queued call that wrote this handle and failed.
   */
  read(): Promise<T>;
  /**
   * Replace what the handle holds with `value`, after every call made before this one; with
   * none waiting, at once. The next use uploads it.
   */
  write(value: T): void;
  /** Release the device buffer, after every call made before this one. A use after it throws. */
  destroy(): void;
  readonly [residentBrand]: T;
}

/** The handle's state, which only the runtime reads. */
export class ResidentArrayState {
  /** What the handle holds on the host; stale while `fresh` is `'device'`. */
  host: unknown;
  /** Where the newest contents are: the host copy, the device buffer, or both alike. */
  fresh: 'host' | 'device' | 'both' = 'host';
  /** The device buffer, once a call on WebGPU has made it, with its size and layout. */
  gpu: { d: GpuDevice; buffer: GpuBuffer; size: number; layout: Layout } | undefined;
  /** The error of a queued call that wrote the handle, which `read()` throws. */
  error: unknown;
  /** Set by `destroy()`: a use after it throws. */
  destroyed = false;

  constructor(host: unknown) {
    this.host = host;
  }

  /** Bring the host copy up to date, reading the device buffer when it is newer. The caller
   *  goes on to use the host copy, which a CPU or WebGL2 tier may write in place, so the host
   *  copy is the newer one after it. */
  async sync(): Promise<void> {
    if (this.fresh === 'device' && this.gpu !== undefined) {
      const dv = await download(this.gpu.d, this.gpu.buffer, this.gpu.size);
      readInto(dv, 0, this.gpu.layout, this.host);
    }
    this.fresh = 'host';
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

const states = new WeakMap<object, ResidentArrayState>();

/** The runtime's state of a {@link Resident}, or undefined for any other value. */
export function residentState(v: unknown): ResidentArrayState | undefined {
  return typeof v === 'object' && v !== null ? states.get(v) : undefined;
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

/**
 * Wrap a host value once so that it stays on the device across calls (Rule 11.8, surface §65):
 * `const dev = resident(new Float32Array(512 * 512)); render(k, 512, dev); const img = await
 * dev.read();`. A kernel or entry call takes the handle where it takes the value, and a program
 * of `typeshade/runtime` takes it as a binding. The handle holds its own copy of `value`.
 *
 * Exported from `typeshade` and `typeshade/runtime`.
 *
 * @param value - a number, a tuple, a `Float32Array`, `Int32Array`, `Uint32Array` or
 *   `Float64Array`, an array, or an object for a struct.
 * @returns the handle, whose `write` replaces its contents and `destroy` frees its buffer.
 * @throws `TypeError` for any other value.
 */
export function resident<T>(value: T): Resident<T> {
  const not = notHostValue(value);
  if (not !== undefined)
    throw new TypeError(
      `resident(): takes a host value (a number, a tuple, a typed array, an array or an object), not ${not}.`,
    );
  const state = new ResidentArrayState(copyOf(value));
  const live = (): void => {
    if (state.destroyed)
      throw new TypeError('This Resident was destroyed; make a new one with resident().');
  };
  const handle = {
    async read(): Promise<T> {
      live();
      await kernelQueue.idle();
      if (state.error !== undefined) throw state.error;
      await state.sync();
      return copyOf(state.host as T);
    },
    write(v: T): void {
      live();
      const bad = notHostValue(v);
      if (bad !== undefined) throw new TypeError(`write(): takes a host value, not ${bad}.`);
      const copy = copyOf(v);
      kernelQueue.whenIdle(() => {
        state.host = copy;
        state.fresh = 'host';
      });
    },
    destroy(): void {
      if (state.destroyed) return;
      state.destroyed = true;
      kernelQueue.whenIdle(() => {
        state.gpu?.buffer.destroy();
        state.gpu = undefined;
      });
    },
  } as unknown as Resident<T>;
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
    if (this.pending === 0) f();
    else void this.run(async () => f());
  },
  /** Settle once every call made so far has. */
  idle(): Promise<unknown> {
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
