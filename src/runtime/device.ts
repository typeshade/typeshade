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
// A device has a time budget (change 0074): the time one chunk of a long kernel may take. A plan
// that names a chunk (`device.fuse(body, { chunk })`) runs alone, fenced and timed around the
// planner's entry, and the device learns the rate of the chunk's key; `device.chunkSize()` sizes
// the next chunk of that key from it (`runtime/chunk.ts`).
//
// Like the rest of `typeshade/runtime` it imports no compiler.

import type { FuseScope } from '../core/fuse-plan.js';
import type { FuseReport } from '../core/fuse-report.js';
import { fuseSlot } from '../core/fuse-scope.js';
import { glContext } from '../core/gl-context.js';
import { automaticFp64Flavor, deviceInfo, type DeviceInfo } from '../core/device-info.js';
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
import { CpuTexture, cpuFormatGap } from '../core/cpu-texture.js';
import { textureOwners } from '../core/owner.js';
import { TIERS, tierNames, type Tier } from '../core/tiers.js';
import { TextureImpl, type Texture } from './resources.js';
import { fitChunk, learnRate, type ChunkRate } from './chunk.js';

export type { ChunkRate } from './chunk.js';

/** How `createDevice()` opens a device. `prefer`, `device` and `runtime` are exclusive in
 * TypeScript and at runtime (change 0085). Compose extra options with an intersection,
 * `DeviceOptions & { label?: string }`; an interface cannot extend this union. */
export type DeviceOptions = {
  /** The most bytes of released arrays the device keeps for a later `array()` of the same
   *  element and length. 64 MiB by default. `0` keeps none. */
  readonly poolBytes?: number;
  /** The flavor setting of the emulated double (change 0085). Omission or `'auto'` selects
   *  `'integer'` from Apple or Metal signals on the actual device, otherwise `'float'`; CPU
   *  selects `'float'`. Explicit `'float'` and `'integer'` override selection. Unknown GPU
   *  signals retain the selector's float fallback, without establishing hardware precision. A kernel
   *  call, an entry call and a `fuse()` plan of the device dispatch the WGSL of that flavor for a
   *  module that emulates `f64`, the `_fp64` guard bound under `'float'` and absent under
   *  `'integer'`. A module that emulates no `f64` is unchanged. */
  readonly fp64Flavor?: 'auto' | Fp64Flavor;
  /** The time one chunk of a long kernel may take, in milliseconds (change 0074): 250 by default.
   *  `device.chunkSize()` sizes each chunk of a key to fit eight tenths of it. A value that is not
   *  a finite number from 1 to 60000 is a `RangeError`. */
  readonly timeBudgetMs?: number;
} & (
  | {
      /** The tiers to try, in order, `['webgpu', 'webgl2', 'cpu']` by default. One tier makes it
       * required. Tiers after the one that opens stay a call's fallback (Rule 11.8). */
      readonly prefer?: readonly Tier[];
      readonly device?: never;
      readonly runtime?: never;
    }
  | {
      /** A `GPUDevice` the host already has. The device uses it and never destroys it. */
      readonly device: object;
      readonly prefer?: never;
      readonly runtime?: never;
    }
  | {
      /** A program runtime of `createRuntime()` whose device the owner never destroys.
       * A WebGL2 runtime is refused: calls use a context of their own there (Rule 11.11). */
      readonly runtime: { readonly device: object; readonly tier?: string };
      readonly prefer?: never;
      readonly device?: never;
    }
);

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
 * Ordinary kernel, compute-entry and draw calls infer this owner from its arrays and textures.
 * Mixing owners is refused before execution. Calls without owned resources use the default owner.
 *
 * Exported from `typeshade` and `typeshade/runtime`.
 */
export interface Device {
  /** Frozen historical metadata of the opened device (change 0083), readable after loss or
   * disposal. It does not identify the effective tier of each call. */
  readonly info: DeviceInfo;
  /** The tier that opened: `'webgpu'`, `'webgl2'` or `'cpu'`. */
  readonly tier: Tier;
  /** The resolved flavor of the emulated double. Automatic selection is resolved when this
   * device opens; this property is always `'float'` or `'integer'` (change 0085). */
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
  /** A 2D texture of `size` and `format`, owned by this device (change 0077): a sampled texture,
   *  a copy source and destination and a render target, as a program runtime's texture is, and a
   *  storage texture a kernel function writes when `storage` is true. A call takes it as a
   *  texture parameter, and a call of another owner refuses it. `dispose()` destroys it. On a
   *  device with no WebGPU device it is a texture of the CPU tier's memory, of a format that
   *  tier holds.
   *  @throws `TypeError` for options that do not fit, and for a format the CPU tier does not hold
   *    there. */
  texture(options: {
    readonly size: readonly [number, number];
    readonly format: string;
    readonly storage?: boolean;
  }): Texture;
  /** Give an array back. The device keeps it for a later `array()` of the same element and
   *  length while the pool has room, and frees it otherwise. The handle is not used after.
   *  @throws `TypeError` for an array another owner made. */
  release(array: Resident<unknown>): void;
  /** What the device counts of its arrays. */
  readonly statistics: DeviceStatistics;
  /** Record the kernel calls and entry calls `body` makes and run them as one plan on this device
   *  (Rule 11.13). A call inside the body that takes a `Resident` of another owner is refused with
   *  a `TypeError` naming both owners. Rejects when `typeshade/fuse` has not been imported, since
   *  the runtime ships none of the planner.
   *
   *  With `{ chunk: { key, units } }` the plan is one chunk of a long kernel (change 0074): `key`
   *  names the kernel loop and `units` is the work the chunk holds. The plan runs alone, at the
   *  place `fuse` was called. The device first waits for the work submitted before, as `wait()`
   *  does, and starts a wall clock (`performance.now()`). It runs the plan, fences it as `wait()`
   *  does and stops the clock. It learns the rate of `key` (`chunkRates`), and the report carries
   *  the `chunk` row. The promise resolves after the fence. A plan with no `chunk` runs as before
   *  and does not wait for the fence.
   *  @throws `TypeError`, as a rejection, for a `chunk` whose `key` is not a non-empty string or
   *    whose `units` is not a whole number of 1 or more; and for a chunked plan inside the body
   *    of another `fuse()`, since it runs alone. */
  fuse(
    body: (scope: FuseScope) => void,
    options?: { readonly chunk?: { readonly key: string; readonly units: number } },
  ): Promise<FuseReport>;
  /** The time one chunk of a long kernel may take, in milliseconds: `createDevice({
   *  timeBudgetMs })`'s value, 250 when none was given (change 0074). */
  readonly timeBudgetMs: number;
  /** The units of the next chunk of `key` (change 0074). With no chunk of `key` measured yet, it is
   *  `min`, capped at `max`: the first chunk teaches the rate. After that, it is the units that fit
   *  eight tenths of `timeBudgetMs` at the learned rate, at most four times the last chunk's
   *  units, at least `min` and at least 1. It is never more than `max`. On the CPU tier, which has
   *  no watchdog, it is `max`, so the whole work runs as one chunk.
   *  @throws `TypeError` for a `key` that is not a non-empty string; `RangeError` for a `max` or a
   *    `min` that is not a whole number of 1 or more. */
  chunkSize(key: string, max: number, min?: number): number;
  /** What the device measured of each chunk key a chunked `fuse()` named, by key (change 0074). A
   *  frozen copy, empty before the first chunk. */
  readonly chunkRates: Readonly<Record<string, ChunkRate>>;
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
const DEFAULT_TIME_BUDGET_MS = 250;
const MOST_TIME_BUDGET_MS = 60000;

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
  readonly info: DeviceInfo;
  readonly tier: Tier;
  readonly fp64Flavor: Fp64Flavor;
  readonly timeBudgetMs: number;
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
  /** What the device learned of each chunk key (change 0074). */
  readonly #rates = new Map<string, ChunkRate>();
  #disposing: Promise<void> | undefined;
  /** The textures the device made (change 0077), destroyed by `dispose()`. */
  readonly #textures = new Set<TextureImpl>();

  constructor(
    tier: Tier,
    tiers: readonly Tier[],
    skipped: readonly SkippedTier[],
    gpu: GpuDevice | null,
    own: boolean,
    poolBytes: number,
    fp64Flavor: 'auto' | Fp64Flavor,
    timeBudgetMs: number,
  ) {
    this.tier = tier;
    const native = gpu ?? (tier === 'webgl2' ? glContext() : null);
    this.info = deviceInfo(tier, native);
    this.fp64Flavor =
      fp64Flavor === 'auto' ? automaticFp64Flavor(tier, native, this.info) : fp64Flavor;
    this.timeBudgetMs = timeBudgetMs;
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
      fp64Flavor: () => this.fp64Flavor,
      assertCall: () => this.#usable('call()'),
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

  texture(options: {
    readonly size: readonly [number, number];
    readonly format: string;
    readonly storage?: boolean;
  }): Texture {
    this.#usable('texture()');
    const at = `${this.label}.texture()`;
    if (typeof options !== 'object' || options === null)
      throw new TypeError(`${at}: takes an options object, { size: [width, height], format }.`);
    const { size, format, storage } = options;
    if (
      !Array.isArray(size) ||
      size.length !== 2 ||
      !size.every((n) => Number.isSafeInteger(n) && n >= 1)
    )
      throw new TypeError(`${at}: size takes [width, height], two whole numbers of 1 or more.`);
    if (typeof format !== 'string' || format === '')
      throw new TypeError(`${at}: format takes a WebGPU texture format, such as "rgba8unorm".`);
    if (storage !== undefined && typeof storage !== 'boolean')
      throw new TypeError(`${at}: storage takes true or false.`);
    // A device with no WebGPU device holds the texture in the CPU tier's memory (change 0077).
    if (this.#gpu === null) {
      const gap = cpuFormatGap(format);
      if (gap !== undefined) throw new TypeError(`${at}: ${gap}.`);
      const memory = new CpuTexture(size[0]!, size[1]!, format);
      textureOwners.set(memory, this.owner);
      return memory as unknown as Texture;
    }
    const texture = new TextureImpl(this.#gpu as never, {
      size: [size[0]!, size[1]!],
      format,
      ...(storage === true ? { storage: true } : {}),
    });
    textureOwners.set(texture, this.owner);
    this.#textures.add(texture);
    return texture;
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

  get chunkRates(): Readonly<Record<string, ChunkRate>> {
    return Object.freeze(Object.fromEntries(this.#rates));
  }

  chunkSize(key: string, max: number, min = 1): number {
    this.#usable('chunkSize()');
    checkKey(`${this.label}.chunkSize()`, 'key', key);
    for (const [name, v] of [
      ['max', max],
      ['min', min],
    ] as const)
      if (!Number.isSafeInteger(v) || v < 1)
        throw new RangeError(
          `${this.label}.chunkSize(): ${name} takes a whole number of 1 or more.`,
        );
    // The CPU tier has no watchdog: the whole work runs as one chunk, and its results are those of
    // the state machine run once.
    if (this.tier === 'cpu') return max;
    return fitChunk(this.#rates.get(key), this.timeBudgetMs, max, min);
  }

  fuse(
    body: (scope: FuseScope) => void,
    options?: { readonly chunk?: { readonly key: string; readonly units: number } },
  ): Promise<FuseReport> {
    let chunk: { readonly key: string; readonly units: number } | undefined;
    try {
      this.#usable('fuse()');
      chunk = chunkOf(`${this.label}.fuse()`, options);
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
    if (chunk === undefined) return open(body, this.owner) as Promise<FuseReport>;
    return this.#chunk(open, body, chunk);
  }

  /** Run `body` as one chunk of `chunk.key` (change 0074): alone, fenced before and after, timed
   *  by the wall clock around the planner's entry. The fences are items of the kernel queue on
   *  either side of the plan, so the plan keeps the place where `fuse` was called (Rule 11.8), and
   *  a call queued after it is in neither the plan nor its time. The rate the device learns is the
   *  measured time over the chunk's units. */
  #chunk(
    open: (body: unknown, owner: unknown) => Promise<unknown>,
    body: (scope: FuseScope) => void,
    chunk: { readonly key: string; readonly units: number },
  ): Promise<FuseReport> {
    let started: Promise<number>;
    try {
      // After the work submitted before, so the measured time is the chunk's alone (D5). Inside
      // the body of another fuse() the queue refuses it: a chunked plan runs alone.
      started = kernelQueue.run(() => this.#fence());
    } catch (error) {
      return Promise.reject(error);
    }
    const plan = open(body, this.owner) as Promise<FuseReport>;
    const stopped = kernelQueue.run(() => this.#fence());
    return Promise.all([started, plan, stopped]).then(([from, report, to]) => {
      const elapsedMs = to - from;
      this.#rates.set(chunk.key, learnRate(this.#rates.get(chunk.key), chunk.units, elapsedMs));
      return { ...report, chunk: Object.freeze({ key: chunk.key, units: chunk.units, elapsedMs }) };
    });
  }

  /** The time, by the wall clock, once the device has completed what was submitted to it: on
   *  WebGPU after `queue.onSubmittedWorkDone()`, and at once on the other tiers. */
  async #fence(): Promise<number> {
    const queue = this.#gpu?.queue as { onSubmittedWorkDone?: () => Promise<void> } | undefined;
    if (typeof queue?.onSubmittedWorkDone === 'function') await queue.onSubmittedWorkDone();
    return performance.now();
  }

  async wait(): Promise<void> {
    this.#usable('wait()');
    await kernelQueue.idle();
    await this.#fence();
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
      // After the calls queued before, which may still bind them.
      for (const t of this.#textures) t.destroy();
      this.#textures.clear();
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

/** Refuse a chunk key that is not a non-empty string. */
function checkKey(at: string, field: string, key: unknown): void {
  if (typeof key !== 'string' || key === '')
    throw new TypeError(`${at}: ${field} takes a non-empty string that names the kernel loop.`);
}

/** The chunk of `device.fuse(body, options)`, checked, or undefined for a plan that names none. */
function chunkOf(
  at: string,
  options: unknown,
): { readonly key: string; readonly units: number } | undefined {
  if (options === undefined) return undefined;
  if (typeof options !== 'object' || options === null)
    throw new TypeError(`${at}: the second argument takes an object, { chunk: { key, units } }.`);
  const chunk = (options as { chunk?: unknown }).chunk;
  if (chunk === undefined) return undefined;
  if (typeof chunk !== 'object' || chunk === null)
    throw new TypeError(`${at}: chunk takes an object, { key, units }.`);
  const { key, units } = chunk as { key?: unknown; units?: unknown };
  checkKey(at, 'chunk.key', key);
  if (typeof units !== 'number' || !Number.isSafeInteger(units) || units < 1)
    throw new TypeError(`${at}: chunk.units takes a whole number of 1 or more.`);
  return { key: key as string, units };
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
 * @param options - `prefer`, `device` or `runtime`, one of them, `poolBytes`, `fp64Flavor` and
 *   `timeBudgetMs`, the time one chunk of a long kernel may take (change 0074). Omitted
 *   `fp64Flavor` means `'auto'`, resolved from this device without requesting an unrelated adapter.
 * @returns the device.
 * @throws `TypeError` for options that do not fit, a word that is not a flavor among them;
 *   `RangeError` for a `timeBudgetMs` that is not a finite number from 1 to 60000; `Error` naming
 *   each tier's reason when no tier of `prefer` opens.
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
  const timeBudgetMs = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  if (
    typeof timeBudgetMs !== 'number' ||
    !Number.isFinite(timeBudgetMs) ||
    timeBudgetMs < 1 ||
    timeBudgetMs > MOST_TIME_BUDGET_MS
  )
    throw new RangeError(
      `createDevice(): timeBudgetMs takes a finite number of milliseconds from 1 to ${MOST_TIME_BUDGET_MS}.`,
    );
  const fp64Flavor =
    options.fp64Flavor === undefined
      ? 'auto'
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
      timeBudgetMs,
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
      timeBudgetMs,
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
      if (d !== null)
        return new DeviceImpl(tier, tiers, skipped, d, true, poolBytes, fp64Flavor, timeBudgetMs);
      skipped.push({ tier, reason: 'there is no WebGPU device' });
    } else if (tier === 'webgl2') {
      if (glContext() !== null)
        return new DeviceImpl(
          tier,
          tiers,
          skipped,
          null,
          false,
          poolBytes,
          fp64Flavor,
          timeBudgetMs,
        );
      skipped.push({ tier, reason: 'there is no WebGL2 context' });
    } else
      return new DeviceImpl(tier, tiers, skipped, null, false, poolBytes, fp64Flavor, timeBudgetMs);
  }
  throw new Error(
    `createDevice(): no tier of prefer opened (${skipped.map((s) => `${s.tier}: ${s.reason}`).join('; ')}).`,
  );
}
