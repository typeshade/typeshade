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
  readInto,
  storageBuffer,
  uploadTo,
  type GpuBuffer,
  type GpuDevice,
  type Layout,
} from './host-entry.js';

declare const residentBrand: unique symbol;

/** The arrays {@link resident} wraps: a typed array, or an array of objects for a struct array. */
type ResidentArray =
  Float32Array | Int32Array | Uint32Array | Float64Array | readonly Record<string, unknown>[];

/**
 * An array that stays on the device across kernel calls (Rule 11.8, surface §65), made by
 * {@link resident}. Pass it where a kernel function takes an array, or as an entry's storage
 * array with no size (surface §67): the first call on WebGPU
 * uploads it, the calls after bind it as it is, and nothing is read back until
 * {@link Resident.read}. A call whose written arrays are all resident, and that returns
 * nothing, only queues.
 *
 * Exported from `typeshade`.
 */
export interface Resident<T extends ResidentArray = ResidentArray> {
  /**
   * Wait for every kernel call made before this one, and return a new array holding what the
   * handle holds.
   *
   * @throws the error of a queued call that wrote this handle and failed.
   */
  read(): Promise<T>;
  readonly [residentBrand]: T;
}

/** The handle's state, which only the runtime reads. */
export class ResidentArrayState {
  /** What the handle holds on the host; stale while `fresh` is `'device'`. */
  host: unknown;
  /** Where the newest contents are. */
  fresh: 'host' | 'device' = 'host';
  /** The device buffer, once a call on WebGPU has made it, with its size and layout. */
  gpu: { d: GpuDevice; buffer: GpuBuffer; size: number; layout: Layout } | undefined;
  /** The error of a queued call that wrote the handle, which `read()` throws. */
  error: unknown;

  constructor(host: unknown) {
    this.host = host;
  }

  /** Bring the host copy up to date, reading the device buffer when it is newer. */
  async sync(): Promise<void> {
    if (this.fresh !== 'device' || this.gpu === undefined) return;
    const dv = await download(this.gpu.d, this.gpu.buffer, this.gpu.size);
    readInto(dv, 0, this.gpu.layout, this.host);
    this.fresh = 'host';
  }

  /** The device buffer for `layout`, made or refreshed from the host copy as needed; a call
   *  that `writes` it leaves the device copy the newer. */
  bufferFor(d: GpuDevice, layout: Layout, bytes: () => ArrayBuffer, writes: boolean): GpuBuffer {
    if (this.gpu === undefined || this.gpu.d !== d) {
      const b = bytes();
      this.gpu = { d, buffer: storageBuffer(d, b), size: b.byteLength, layout };
    } else if (this.fresh === 'host') uploadTo(d, this.gpu.buffer, bytes());
    // Both copies agree now, until a call writes the device's.
    if (writes) this.fresh = 'device';
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

/**
 * Wrap an array once so that it stays on the device across kernel calls (Rule 11.8, surface
 * §65): `const dev = resident(new Float32Array(512 * 512)); render(k, 512, dev); const img =
 * await dev.read();`. The handle holds its own copy of `array`.
 *
 * Exported from `typeshade`.
 *
 * @param array - a `Float32Array`, `Int32Array`, `Uint32Array` or `Float64Array`, or an array
 *   of objects for an array of structs.
 * @returns the handle, which a kernel function takes where it takes the array.
 * @throws `TypeError` for anything else.
 */
export function resident<T extends ResidentArray>(array: T): Resident<T> {
  const typed =
    array instanceof Float32Array ||
    array instanceof Int32Array ||
    array instanceof Uint32Array ||
    array instanceof Float64Array;
  if (!typed && !Array.isArray(array))
    throw new TypeError(
      'resident(): takes a Float32Array, an Int32Array, a Uint32Array, a Float64Array or an array of objects.',
    );
  const state = new ResidentArrayState(copyOf(array));
  const handle = {
    async read(): Promise<T> {
      await kernelQueue.idle();
      if (state.error !== undefined) throw state.error;
      await state.sync();
      return copyOf(state.host as T);
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
  /** Run `f` after every call made before it. */
  run<T>(f: () => Promise<T>): Promise<T> {
    const p = this.last.then(f);
    this.last = p.catch(() => undefined);
    return p;
  },
  /** Settle once every call made so far has. */
  idle(): Promise<unknown> {
    return this.last;
  },
};

// ─── the tiers ───────────────────────────────────────────────────────────────────────────────

/** A tier a kernel call or an entry call may run on (Rule 11.8). */
type Tier = 'webgpu' | 'webgl2' | 'cpu';

const TIERS: readonly Tier[] = ['webgpu', 'webgl2', 'cpu'];

let preferred: readonly Tier[] = TIERS;

/** The tiers a kernel call or an entry call tries, in order. */
export function preferredTiers(): readonly Tier[] {
  return preferred;
}

/**
 * Set the order of the tiers a kernel call or a `@compute` entry's call tries (Rule 11.8):
 * WebGPU, WebGL2 and the CPU tier, the default being all three in that order. A one-entry list makes that tier required, and a
 * call that cannot run on it throws, naming why: `configure({ prefer: ['webgpu'] })`.
 *
 * Exported from `typeshade`.
 *
 * @param options - `prefer`, a non-empty list of `'webgpu'`, `'webgl2'` and `'cpu'`; left out,
 *   the default order.
 * @throws `TypeError` for an empty list, a repeated entry or an unknown tier.
 */
export function configure(options: { readonly prefer?: readonly Tier[] }): void {
  const prefer = options.prefer ?? TIERS;
  if (!Array.isArray(prefer) || prefer.length === 0)
    throw new TypeError('configure(): prefer takes a non-empty list of tiers.');
  for (const t of prefer)
    if (!TIERS.includes(t))
      throw new TypeError(
        `configure(): "${String(t)}" is not a tier; the tiers are webgpu, webgl2 and cpu.`,
      );
  if (new Set(prefer).size !== prefer.length)
    throw new TypeError('configure(): prefer names a tier twice.');
  preferred = [...prefer];
}
