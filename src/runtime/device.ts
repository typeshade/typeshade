// ═══ The device owner: the tier, the arrays and their pool, the limits, the lost signal and ═══
// ═══ the plans of a host's kernel calls (Rule 11.8, Rule 11.11, Rule 11.13, change 0071)   ═══
//
// Before this change a host that ran kernel functions owned nothing: `configure()` set a
// process-global tier order and runtime, `resident()` made a handle no object owned, and `fuse()`
// recorded into a process-global slot. Two libraries built on the call layer (TypeNN, TypeCV)
// each wrote the same owner over that state, and could not share a page: each `configure()`
// overwrote the other's. `createDevice()` is that owner, once, here.
//
// A `Device` holds what the two libraries each held: the tier it opened and why the earlier tiers
// of `prefer` did not open, the `Resident` arrays it made and a pool of the released ones, the
// device's limits and its lost signal, `fuse()` over its own device, a completion fence, and a
// `dispose()` that frees what it made and never what the host handed in. Two devices in one
// context are independent. The process-global `configure()`, `resident()` and `fuse()` stay, and
// describe the default owner (`core/owner.ts`).
//
// `device.fuse()` runs through the slot `typeshade/fuse` fills when it is imported
// (`core/fuse-scope.ts`), so this file imports none of the planner and the runtime's bundle stays
// within its budget (Rule 11.11).
//
// Like the rest of `typeshade/runtime` it imports no compiler.

import type { FuseReport, FuseScope } from '../core/fuse-plan.js';
import { fuseSlot } from '../core/fuse-scope.js';
import { glContext } from '../core/gl-context.js';
import {
  pendingClears,
  reportOf,
  requestCallDevice,
  requestedDevice,
  type GpuDevice,
} from '../core/host-entry.js';
import type { CallOwner } from '../core/owner.js';
import type { Fp64Flavor } from '../core/passes/fp64-lower.js';
import {
  adopt,
  checkFp64Flavor,
  kernelQueue,
  resident,
  residentState,
  ZEROED_ELEMENTS,
  type Resident,
  type ResidentArrayState,
  type ZeroedArray,
  type ZeroedElement,
} from '../core/resident.js';
import { TIERS, tierNames, type Tier } from '../core/tiers.js';

/** How `createDevice()` opens a device. `prefer`, `device` and `runtime` are exclusive. */
export interface DeviceOptions {
  /** The tiers to try, in order, the first that opens being the device's: `['webgpu', 'webgl2',
   *  'cpu']` by default. A list of one tier makes it required. The tiers after the one that
   *  opened stay the fallback of a call that tier cannot run (Rule 11.8). */
  readonly prefer?: readonly Tier[];
  /** A `GPUDevice` the host already has. The device uses it and never destroys it. */
  readonly device?: object;
  /** A program runtime of `createRuntime()` (Rule 11.11), whose device the owner uses and never
   *  destroys. A WebGL2 runtime is refused: the calls use a context of their own there. */
  readonly runtime?: { readonly device: object; readonly tier?: string };
  /** The most bytes of released arrays the device keeps for a later `array()` of the same
   *  element and length. 64 MiB by default. `0` keeps none. */
  readonly poolBytes?: number;
  /** The flavor of the emulated double the device's calls run (change 0073): `'float'`, the
   *  default, or `'integer'`, which `recommendFp64Flavor()` names for an Apple GPU. A kernel
   *  call, an entry call and a `fuse()` plan of the device dispatch the WGSL of that flavor for a
   *  module that emulates `f64`, the `_fp64` guard bound under `'float'` and absent under
   *  `'integer'`. A module that emulates no `f64` is unchanged. */
  readonly fp64Flavor?: Fp64Flavor;
}

/** What a device counts of the arrays it made. The bytes are those of typed arrays. */
export interface DeviceStatistics {
  /** The arrays the device made and has not freed, the pooled ones among them. */
  readonly live: number;
  readonly liveBytes: number;
  /** The bytes of the released arrays kept for reuse. */
  readonly pooledBytes: number;
  /** How many arrays `array()` made new. */
  readonly allocations: number;
  /** How many arrays `array()` took from the pool instead. */
  readonly reuses: number;
  /** The bytes of the values `array(value)` was given. */
  readonly uploadBytes: number;
  /** The bytes `read()` of the device's arrays returned. */
  readonly readBytes: number;
}

/** A tier `createDevice()` tried before the one that opened, with the reason it did not. Not an
 *  export of its own: proposal 0071 declares `Device`, whose `skipped` rows it types. */
interface SkippedTier {
  readonly tier: Tier;
  readonly reason: string;
}

/**
 * The owner of a host's kernel calls (change 0071): the tier they run on, the `Resident` arrays
 * they take and the pool those arrays return to, the device's limits and lost signal, the plans
 * of `fuse()`, and `dispose()`. Made by {@link createDevice}. Two devices in one context are
 * independent: each has its tier, its arrays, its pool and its plans.
 *
 * Exported from `typeshade` and `typeshade/runtime`.
 */
export interface Device {
  /** The tier that opened: `'webgpu'`, `'webgl2'` or `'cpu'`. */
  readonly tier: Tier;
  /** The flavor of the emulated double the device's calls run: `createDevice({ fp64Flavor })`'s
   *  word, `'float'` when none was given (change 0073). */
  readonly fp64Flavor: Fp64Flavor;
  /** Each tier of `prefer` before the one that opened, with the reason it did not open. */
  readonly skipped: readonly { readonly tier: Tier; readonly reason: string }[];
  /** The device's WebGPU limits, by their names in `GPUSupportedLimits`, frozen (change 0051).
   *  Empty on a tier that has none. */
  readonly limits: Readonly<Record<string, number>>;
  /** Resolves when the browser invalidates the WebGPU device. On another tier it never resolves. */
  readonly lost: Promise<{ readonly reason: string; readonly message: string }>;
  /** A `Resident` that holds a copy of `value`, as `resident(value)` makes one (Rule 11.8), owned
   *  by this device: taken from the pool when a released array of the same element and length is
   *  there, and made new otherwise. */
  array<T>(value: T): Resident<T>;
  /** A zeroed `Resident` of `length` numbers of `element`, as `resident(length, element)` makes
   *  one (change 0065), owned by this device: taken from the pool and zeroed on the device when a
   *  released array of the same element and length is there, and made new otherwise. */
  array<E extends ZeroedElement>(length: number, element: E): Resident<ZeroedArray<E>>;
  /** Give an array back. The device keeps it for a later `array()` of the same element and
   *  length while the pool has room, and frees it otherwise. The handle is not used after.
   *  @throws `TypeError` for an array another owner made. */
  release(array: Resident<unknown>): void;
  /** What the device counts of its arrays. */
  readonly statistics: DeviceStatistics;
  /** Record the kernel calls and entry calls `body` makes and run them as one plan on this device
   *  (Rule 11.13). A call inside the body that takes a `Resident` of another owner is refused with
   *  a `TypeError` naming both owners. Rejects when `typeshade/fuse` has not been imported, since
   *  the runtime ships none of the planner. */
  fuse(body: (scope: FuseScope) => void): Promise<FuseReport>;
  /** Resolves when the device has completed every plan submitted so far: on WebGPU
   *  `queue.onSubmittedWorkDone()`, after the kernel queue has settled; on the other tiers when
   *  the calls have settled. */
  wait(): Promise<void>;
  /** Wait for the plans in flight, destroy every array the device holds, pooled or not, each once,
   *  and destroy the WebGPU device the owner requested. A `GPUDevice` or a runtime the host handed
   *  in is left as it is. A use after `dispose()` is a `TypeError`. */
  dispose(): Promise<void>;
}

/** A pooled element: the zeroed ones, and `f64`, which `resident(Float64Array)` holds. */
type PooledElement = ZeroedElement | 'f64';

/** What the device keeps of each array it made. */
interface Slot {
  readonly state: ResidentArrayState;
  /** The handle `resident()` made, whose methods the device's handle delegates to. */
  readonly inner: Resident<unknown>;
  /** The pool key, `element:length`, for a typed array; undefined for a value the pool does not
   *  keep (a number, a tuple, an array of structs). */
  readonly key: string | undefined;
  readonly element: PooledElement | undefined;
  readonly length: number;
  readonly bytes: number;
  pooled: boolean;
}

const DEFAULT_POOL_BYTES = 64 * 1024 * 1024;

/** The element of a typed array the pool keeps, or undefined for any other value. */
function elementOf(v: unknown): PooledElement | undefined {
  if (v instanceof Float32Array) return 'f32';
  if (v instanceof Int32Array) return 'i32';
  if (v instanceof Uint32Array) return 'u32';
  if (v instanceof Float64Array) return 'f64';
  return undefined;
}

const BYTES: Record<PooledElement, number> = { f32: 4, i32: 4, u32: 4, f64: 8 };

let count = 0;

class DeviceImpl implements Device {
  readonly tier: Tier;
  readonly fp64Flavor: Fp64Flavor;
  readonly skipped: readonly SkippedTier[];
  readonly limits: Readonly<Record<string, number>>;
  readonly lost: Promise<{ readonly reason: string; readonly message: string }>;
  /** How a refusal names this device. */
  readonly label: string;
  readonly owner: CallOwner;
  readonly #gpu: GpuDevice | null;
  /** Whether `createDevice()` requested the device, so that `dispose()` destroys it. */
  readonly #own: boolean;
  readonly #poolBytes: number;
  readonly #live = new Map<ResidentArrayState, Slot>();
  /** The released arrays, by key, each list oldest first. */
  readonly #free = new Map<string, Slot[]>();
  /** The released arrays, oldest first, for eviction. */
  readonly #order = new Set<Slot>();
  #pooledBytes = 0;
  #liveBytes = 0;
  #allocations = 0;
  #reuses = 0;
  #uploadBytes = 0;
  #readBytes = 0;
  #disposing: Promise<void> | undefined;

  constructor(
    tier: Tier,
    tiers: readonly Tier[],
    skipped: readonly SkippedTier[],
    gpu: GpuDevice | null,
    own: boolean,
    poolBytes: number,
    fp64Flavor: Fp64Flavor,
  ) {
    this.tier = tier;
    this.fp64Flavor = fp64Flavor;
    this.skipped = Object.freeze(skipped.map((s) => Object.freeze({ ...s })));
    this.#gpu = gpu;
    this.#own = own;
    this.#poolBytes = poolBytes;
    this.label = `Device #${++count}`;
    this.limits = gpu === null ? Object.freeze({}) : reportOf(gpu).limits;
    this.lost =
      gpu === null
        ? new Promise(() => undefined)
        : gpu.lost.then((info) => {
            const i = (info ?? {}) as { reason?: unknown; message?: unknown };
            return Object.freeze({
              reason: typeof i.reason === 'string' ? i.reason : 'unknown',
              message: typeof i.message === 'string' ? i.message : 'the WebGPU device was lost',
            });
          });
    this.owner = Object.freeze({
      label: this.label,
      tiers: () => tiers,
      device: () => Promise.resolve(gpu),
      fp64Flavor: () => fp64Flavor,
    });
  }

  get statistics(): DeviceStatistics {
    return Object.freeze({
      live: this.#live.size,
      liveBytes: this.#liveBytes,
      pooledBytes: this.#pooledBytes,
      allocations: this.#allocations,
      reuses: this.#reuses,
      uploadBytes: this.#uploadBytes,
      readBytes: this.#readBytes,
    });
  }

  array<T>(value: T): Resident<T>;
  array<E extends ZeroedElement>(length: number, element: E): Resident<ZeroedArray<E>>;
  array(...args: unknown[]): Resident<unknown> {
    this.#usable('array()');
    const zeroed = args.length >= 2;
    const [value, element] = args as [unknown, unknown];
    // The refusals of `resident()` come first, so a wrong value makes no slot.
    const probe = zeroed ? resident(value as number, element as ZeroedElement) : resident(value);
    const probeState = residentState(probe)!;
    const el: PooledElement | undefined = zeroed ? (element as ZeroedElement) : elementOf(value);
    const length = zeroed
      ? (value as number)
      : el !== undefined
        ? (value as ArrayLike<number>).length
        : 0;
    const key = el === undefined ? undefined : `${el}:${length}`;
    const bytes = el === undefined ? 0 : length * BYTES[el];
    if (!zeroed && el !== undefined) this.#uploadBytes += bytes;
    const pooled = key === undefined ? undefined : this.#take(key);
    if (pooled !== undefined) {
      // The probe's handle is dropped: it made no buffer and queued nothing.
      probe.destroy();
      this.#reuses++;
      if (zeroed) this.#rezero(pooled, el as ZeroedElement, length);
      else pooled.inner.write(value);
      return this.#handleOf(pooled);
    }
    const slot: Slot = {
      state: probeState,
      inner: probe,
      key,
      element: el,
      length,
      bytes,
      pooled: false,
    };
    probeState.ownedBy = this.owner;
    this.#live.set(probeState, slot);
    this.#liveBytes += bytes;
    this.#allocations++;
    return this.#handleOf(slot);
  }

  release(array: Resident<unknown>): void {
    this.#usable('release()');
    const slot = this.#slotOf(array, 'release()');
    if (slot.pooled) return;
    if (slot.key === undefined || slot.bytes > this.#poolBytes || slot.bytes === 0) {
      this.#drop(slot);
      return;
    }
    slot.pooled = true;
    const list = this.#free.get(slot.key);
    if (list === undefined) this.#free.set(slot.key, [slot]);
    else list.push(slot);
    this.#order.add(slot);
    this.#pooledBytes += slot.bytes;
    // The oldest released array leaves first, until the pool fits (change 0071, D3).
    for (const oldest of this.#order) {
      if (this.#pooledBytes <= this.#poolBytes) break;
      this.#drop(oldest);
    }
  }

  fuse(body: (scope: FuseScope) => void): Promise<FuseReport> {
    try {
      this.#usable('fuse()');
    } catch (error) {
      return Promise.reject(error);
    }
    const open = fuseSlot.open;
    if (open === undefined)
      return Promise.reject(
        new TypeError(
          `${this.label}.fuse(): the planner is not loaded. Import 'typeshade/fuse' once in the application; typeshade/runtime ships none of it.`,
        ),
      );
    return open(body, this.owner) as Promise<FuseReport>;
  }

  async wait(): Promise<void> {
    this.#usable('wait()');
    await kernelQueue.idle();
    const queue = this.#gpu?.queue as { onSubmittedWorkDone?: () => Promise<void> } | undefined;
    if (typeof queue?.onSubmittedWorkDone === 'function') await queue.onSubmittedWorkDone();
  }

  dispose(): Promise<void> {
    if (this.#disposing !== undefined) return this.#disposing;
    this.#disposing = (async () => {
      await kernelQueue.idle();
      // The pooled arrays are in `live` too, so each is destroyed once.
      for (const slot of this.#live.values()) slot.inner.destroy();
      this.#live.clear();
      this.#free.clear();
      this.#order.clear();
      this.#pooledBytes = 0;
      this.#liveBytes = 0;
      if (this.#own && this.#gpu !== null) {
        const d = this.#gpu as GpuDevice & { destroy?: () => void };
        // After the destroys of the arrays, which the queue holds in order.
        kernelQueue.whenIdle(() => d.destroy?.());
      }
    })();
    return this.#disposing;
  }

  /** The handle the host gets: the inner handle's methods, with the reads counted and a destroy
   *  that leaves the device's books. */
  #handleOf(slot: Slot): Resident<unknown> {
    const handle = {
      read: (): Promise<unknown> =>
        slot.inner.read().then((v) => {
          if (ArrayBuffer.isView(v)) this.#readBytes += v.byteLength;
          return v;
        }),
      write: (v: unknown): void => {
        slot.inner.write(v);
        const el = elementOf(v);
        if (el !== undefined) this.#uploadBytes += (v as ArrayBufferView).byteLength;
      },
      destroy: (): void => {
        // A handle the host destroys itself leaves the pool and the books; `dispose()` then has
        // nothing of it to destroy.
        if (this.#live.has(slot.state)) this.#forget(slot);
        slot.inner.destroy();
      },
    } as unknown as Resident<unknown>;
    adopt(handle, slot.state);
    return handle;
  }

  /** A released array of `key`, taken from the pool, or undefined. */
  #take(key: string): Slot | undefined {
    const list = this.#free.get(key);
    const slot = list?.shift();
    if (slot === undefined) return undefined;
    if (list!.length === 0) this.#free.delete(key);
    this.#order.delete(slot);
    this.#pooledBytes -= slot.bytes;
    slot.pooled = false;
    return slot;
  }

  /** Zero a pooled array for `array(length, element)`: where its buffer exists, the next plan
   *  that binds it clears it in its own submission (`pendingClears`), and until then the host copy
   *  holds the zeros; otherwise the host copy of zeros is the array, uploaded on first use. After
   *  the calls queued before, which may still read it. */
  #rezero(slot: Slot, element: ZeroedElement, length: number): void {
    const state = slot.state;
    kernelQueue.whenIdle(() => {
      const zeros = ZEROED_ELEMENTS[element](length);
      const d = this.#gpu;
      if (state.gpu !== undefined && d !== null && state.gpu.d === d) {
        state.host = zeros;
        state.fresh = 'device';
        state.clearPending = true;
        pendingClears.set(state.gpu.buffer, state);
        return;
      }
      state.assign(zeros);
    });
  }

  /** Free an array now: out of the pool and the books, its buffer destroyed. */
  #drop(slot: Slot): void {
    this.#forget(slot);
    slot.inner.destroy();
  }

  #forget(slot: Slot): void {
    if (slot.pooled) {
      slot.pooled = false;
      this.#order.delete(slot);
      this.#pooledBytes -= slot.bytes;
      const list = this.#free.get(slot.key!);
      if (list !== undefined) {
        const at = list.indexOf(slot);
        if (at >= 0) list.splice(at, 1);
        if (list.length === 0) this.#free.delete(slot.key!);
      }
    }
    this.#live.delete(slot.state);
    this.#liveBytes -= slot.bytes;
  }

  #slotOf(array: unknown, at: string): Slot {
    const state = residentState(array);
    if (state === undefined)
      throw new TypeError(`${this.label}.${at}: takes a Resident this device made with array().`);
    const slot = this.#live.get(state);
    if (slot === undefined)
      throw new TypeError(
        state.ownedBy === this.owner
          ? `${this.label}.${at}: this Resident was destroyed.`
          : `${this.label}.${at}: this Resident belongs to ${state.ownedBy?.label ?? 'the default owner (configure(), resident())'}, not to ${this.label}.`,
      );
    return slot;
  }

  #usable(at: string): void {
    if (this.#disposing !== undefined)
      throw new TypeError(
        `${this.label}.${at}: this Device was disposed. Make a new one with createDevice().`,
      );
  }
}

/** Whether `d` is a WebGL2 context: a `GPUDevice` has neither method. */
function isWebGl2(d: object): boolean {
  const c = d as { getParameter?: unknown; createTransformFeedback?: unknown };
  return typeof c.getParameter === 'function' && typeof c.createTransformFeedback === 'function';
}

/**
 * Open the owner of a host's kernel calls (change 0071): on the first tier of `prefer` that opens,
 * on a `GPUDevice` the host already has, or on the device of a program runtime. The device's
 * `array()` makes the `Resident` arrays its calls take, `fuse()` runs a body's calls as one plan
 * on it, and `dispose()` frees what it made. Two devices in one context are independent, and the
 * process-global `configure()`, `resident()` and `fuse()` describe the default owner as before.
 *
 * Exported from `typeshade` and `typeshade/runtime`.
 *
 * @param options - `prefer`, `device` or `runtime`, one of them, `poolBytes` and `fp64Flavor`.
 * @returns the device.
 * @throws `TypeError` for options that do not fit, a word that is not a flavor among them;
 *   `Error` naming each tier's reason when no tier of `prefer` opens.
 */
export async function createDevice(options: DeviceOptions = {}): Promise<Device> {
  if (typeof options !== 'object' || options === null)
    throw new TypeError('createDevice(): takes an options object.');
  const given = (['prefer', 'device', 'runtime'] as const).filter((o) => options[o] !== undefined);
  if (given.length > 1)
    throw new TypeError(
      `createDevice(): ${given.map((o) => `"${o}"`).join(' and ')} are exclusive; pass one of prefer, device and runtime.`,
    );
  const poolBytes = options.poolBytes ?? DEFAULT_POOL_BYTES;
  if (!Number.isSafeInteger(poolBytes) || poolBytes < 0)
    throw new TypeError('createDevice(): poolBytes takes a whole number of bytes, 0 or more.');
  const fp64Flavor =
    options.fp64Flavor === undefined
      ? 'float'
      : checkFp64Flavor('createDevice({ fp64Flavor })', options.fp64Flavor);
  if (options.device !== undefined) {
    if (typeof options.device !== 'object' || options.device === null || isWebGl2(options.device))
      throw new TypeError('createDevice({ device }): device takes a GPUDevice.');
    return new DeviceImpl(
      'webgpu',
      TIERS,
      [],
      options.device as GpuDevice,
      false,
      poolBytes,
      fp64Flavor,
    );
  }
  if (options.runtime !== undefined) {
    const rt = options.runtime;
    if (
      typeof rt !== 'object' ||
      rt === null ||
      typeof rt.device !== 'object' ||
      rt.device === null
    )
      throw new TypeError(
        'createDevice({ runtime }): runtime takes a runtime from createRuntime().',
      );
    if (rt.tier === 'webgl2' || isWebGl2(rt.device))
      throw new TypeError(
        'createDevice({ runtime }): runtime takes a WebGPU runtime; on WebGL2 the calls use a context of their own.',
      );
    return new DeviceImpl(
      'webgpu',
      TIERS,
      [],
      rt.device as GpuDevice,
      false,
      poolBytes,
      fp64Flavor,
    );
  }
  const prefer = options.prefer ?? TIERS;
  if (!Array.isArray(prefer) || prefer.length === 0)
    throw new TypeError('createDevice(): prefer takes a non-empty list of tiers.');
  for (const t of prefer)
    if (!TIERS.includes(t))
      throw new TypeError(
        `createDevice(): "${String(t)}" is not a tier; the tiers are ${tierNames()}.`,
      );
  if (new Set(prefer).size !== prefer.length)
    throw new TypeError('createDevice(): prefer names a tier twice.');
  const skipped: SkippedTier[] = [];
  for (const [i, tier] of prefer.entries()) {
    const tiers = prefer.slice(i);
    if (tier === 'webgpu') {
      const d = await requestCallDevice(requestedDevice());
      if (d !== null) return new DeviceImpl(tier, tiers, skipped, d, true, poolBytes, fp64Flavor);
      skipped.push({ tier, reason: 'there is no WebGPU device' });
    } else if (tier === 'webgl2') {
      if (glContext() !== null)
        return new DeviceImpl(tier, tiers, skipped, null, false, poolBytes, fp64Flavor);
      skipped.push({ tier, reason: 'there is no WebGL2 context' });
    } else return new DeviceImpl(tier, tiers, skipped, null, false, poolBytes, fp64Flavor);
  }
  throw new Error(
    `createDevice(): no tier of prefer opened (${skipped.map((s) => `${s.tier}: ${s.reason}`).join('; ')}).`,
  );
}
