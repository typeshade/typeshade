// Region ownership, dirty ranges and per-device copies shared by resource views and recorded calls.
import type { Layout, LayoutNumber } from '../core/host-entry.js';
import { callDefault, type CallOwner } from '../core/owner.js';
import { handleOf, ResidentArrayState } from '../core/resident.js';
import { type Range, type Region } from './region.js';

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
export class Core {
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
  /** The device copy a call wrote, when the host has not read it back since (change 0138, R2):
   *  the region does not hold what that device holds. Undefined otherwise. */
  ahead: RegionState | undefined;
  /** The device copies of a storage array (milestone 3), one for each owner whose calls took it,
   *  each made at the first such call. A resource of one device has one; an exported binding,
   *  which belongs to no one device, has one for each device that ran a call that read it (R3). */
  readonly states = new Map<CallOwner, RegionState>();
  /** The device the resource belongs to (change 0138, R3): the device in use when it was made, or
   *  the default owner when none was. Undefined for an exported binding, which belongs to no one
   *  device. A Uniform's takes no part in the choice of a call's device (`resourceOf`; the owner's
   *  decision of 2026-11-11 on Q-a). */
  owner: CallOwner | undefined = callDefault();

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
   *  or writes it, `ps.at(0).pos.get()` (change 0138, R2; the owner's decision of 2026-11-11). */
  current(at: string): void {
    if (this.ahead !== undefined)
      throw new TypeError(
        `${at}: a call wrote ${this.name}, and its values are on the device until \`await ${this.name}.read()\` brings them back; await it first.`,
      );
  }

  /** The error of a call that wrote the resource and failed, which each later call that takes it
   *  and its `read()` throw (the owner's decision of 2026-11-11), or undefined. */
  error(): unknown {
    for (const s of this.states.values()) if (s.error !== undefined) return s.error;
    return this.kept;
  }

  /** The error of a device copy that was dropped with its device (`BufferRoot.forget`), kept as a
   *  failed call's until `set(data)` or `resize()`. */
  kept: unknown;

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

export const cores = new WeakMap<object, Core>();

/** Frees the range of a resource the garbage collector reclaimed (R17). */
const registry =
  typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry<Slot>(({ region, range }) => region.free(range))
    : undefined;

/** The core of `resource`, which `owner` holds. */
export function adopt(owner: object, core: Core): void {
  cores.set(owner, core);
  registry?.register(owner, core.slot, core);
}

export function dispose(core: Core): void {
  if (core.range.freed) return;
  core.region.free(core.range);
  registry?.unregister(core);
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

/** The host value (Rule 8.21) laid out by `l` at `at`: a number, a tuple, an array or an object.
 *  With `decode`, a `bool` word is a `boolean` and a key's id its member (Amendment A12, Q4 and
 *  Q7), as the host reads them; without, each stays the word a call takes. */
export function readValue(
  dv: DataView,
  at: number,
  l: Layout,
  proto?: object,
  decode = false,
): unknown {
  switch (l.k) {
    case 's': {
      const x = readNumber(dv, at, l.t);
      if (!decode) return x;
      return l.b === 1 ? x !== 0 : l.m !== undefined ? l.m[x] : x;
    }
    case 'v': {
      const out: (number | boolean)[] = [];
      for (let i = 0; i < l.n; i++) {
        const x =
          l.t === 'f64'
            ? dv.getFloat32(at + 4 * i, true) + dv.getFloat32(at + (l.lo ?? 0) + 4 * i, true)
            : readNumber(dv, at + 4 * i, l.t);
        out.push(decode && l.b === 1 ? x !== 0 : x);
      }
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
      for (let i = 0; i < (l.n ?? 0); i++)
        out.push(readValue(dv, at + i * l.st, l.e, undefined, decode));
      return out;
    }
    case 'o': {
      const o = (proto === undefined ? {} : Object.create(proto)) as Record<string, unknown>;
      for (const [name, off, fl] of l.f) o[name] = readValue(dv, at + off, fl, undefined, decode);
      return o;
    }
  }
}

// ─── a call on a resource (change 0138, milestone 3) ─────────────────────────────────────────

/** The values a call sees of a storage array (Amendment A5, default 3): every byte, when the device
 *  copy has none of its own yet or another length, or only the dirty ranges. */
type Snapshot =
  | { readonly full: ArrayBuffer; readonly length: number }
  | { readonly ranges: readonly (readonly [number, Uint8Array])[] };

/**
 * The device copy of a storage array (change 0138, R2, R8): the state of a `Resident` whose host
 * value is the CPU tier's array of elements and whose device buffer is WebGPU's, apart from the
 * region, which is the host's. A call writes the values it sees into it ({@link apply}); a read
 * brings it back into the region.
 */
export class RegionState extends ResidentArrayState {
  readonly layout: Layout & { readonly k: 'a' };
  readonly proto: object;
  /** How many elements the device copy holds. */
  length = 0;
  /** How many elements the last values copied out of the region for a call held, or -1 before
   *  the first: what the device copy will hold once the calls recorded so far have run. */
  captured = -1;
  /** The hidden `Resident` handle the call layer takes. */
  handle: ReturnType<typeof handleOf> | undefined;
  /** The array's length while a call is checked at the call, before its values are copied out. */
  checking: number | undefined;
  /** The dirty ranges another device's call took from the region since this copy's last call,
   *  which this copy takes at its next call (an exported binding on two devices, R3). */
  pending: (readonly [number, number])[] = [];
  readonly #core: Core;

  constructor(layout: Layout & { readonly k: 'a' }, proto: object, core: Core) {
    super(undefined);
    this.layout = layout;
    this.proto = proto;
    this.#core = core;
  }

  /** How many elements a call's check counts: the array's own while the call is checked at the
   *  call, and the device copy's when the call runs. `recordArgument` checked the layout. */
  override measure(): number {
    return this.checking ?? this.length;
  }

  /** What an entry call's check reads: while the call is checked at the call, as many zeroed
   *  elements as the array holds, whose shape is the array's, since its values are not copied
   *  out yet; the CPU tier's elements when it runs. */
  override view(): unknown {
    if (this.checking === undefined) return this.host;
    const zero = readValue(
      new DataView(new ArrayBuffer(this.layout.st)),
      0,
      this.layout.e,
      this.proto,
    );
    return new Array<unknown>(this.checking).fill(zero);
  }

  /** A call that wrote the array failed: the device copy holds nothing to read back, so the array
   *  leaves the window; its error stays until `set(data)` or `resize()`. */
  failed(): void {
    if (this.#core.ahead === this) this.#core.ahead = undefined;
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

/** `ranges` sorted, with ranges that overlap or touch joined, and all joined into one past
 *  {@link DIRTY_RANGE_LIMIT} (Amendment A5, D2). */
function joinRanges(ranges: readonly (readonly [number, number])[]): (readonly [number, number])[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [from, to] of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && from <= last[1]) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out.length > DIRTY_RANGE_LIMIT ? [[out[0]![0], out[out.length - 1]![1]]] : out;
}

/** The values a call of `core`'s storage array of `length` elements sees on the device copy
 *  `state`, copied out of the region now, and the array marked clean; undefined when the device
 *  copy holds them already. The ranges it takes stay pending for each other device copy, which
 *  takes them at its own next call (an exported binding, R3). */
export function captureOf(core: Core, state: RegionState, length: number): Snapshot | undefined {
  core.live();
  const region = core.region;
  const offset = core.range.offset;
  const bytes = length * state.layout.st;
  const taken = core.ranges();
  const hand = (): void => {
    if (taken.length > 0)
      for (const other of core.states.values())
        if (other !== state) other.pending = joinRanges([...other.pending, ...taken]);
    state.pending = [];
    core.clean();
  };
  if (state.captured !== length) {
    state.captured = length;
    const full = new Uint8Array(region.buffer, offset, bytes).slice().buffer as ArrayBuffer;
    hand();
    return { full, length };
  }
  if (taken.length === 0 && state.pending.length === 0) return undefined;
  const ranges = joinRanges([...state.pending, ...taken])
    .map(
      ([from, to]) =>
        [
          from,
          new Uint8Array(
            region.buffer,
            offset + from,
            Math.max(0, Math.min(to, bytes) - from),
          ).slice(),
        ] as const,
    )
    .filter(([, b]) => b.byteLength > 0);
  hand();
  return { ranges };
}
