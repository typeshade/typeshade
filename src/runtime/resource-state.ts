import type { Layout, LayoutNumber } from '../core/host-entry.js';
import { callDefault, type CallOwner } from '../core/owner.js';
import { handleOf, ResidentArrayState } from '../core/resident.js';
import { type Range, type Region } from './region.js';

interface Slot {
  readonly region: Region;
  range: Range;
}

export const DIRTY_RANGE_LIMIT = 16;

export class Core {
  readonly region: Region;
  readonly slot: Slot;
  readonly name: string;
  readonly remedy: string;
  readonly stride: number;
  readonly #r: Float64Array;
  #n = 0;
  bytes: number;
  ahead: RegionState | undefined;
  readonly states = new Map<CallOwner, RegionState>();
  owner: CallOwner | undefined = callDefault();

  constructor(region: Region, bytes: number, name: string, remedy: string, stride = 0) {
    this.region = region;
    this.slot = { region, range: region.allocate(bytes) };
    this.name = name;
    this.remedy = remedy;
    this.bytes = bytes;
    this.stride = stride;
    this.#r = new Float64Array(stride > 0 ? 2 * (DIRTY_RANGE_LIMIT + 1) : 2);
    this.markAll();
  }

  get range(): Range {
    return this.slot.range;
  }

  get dirty(): boolean {
    return this.#n > 0;
  }

  ranges(): (readonly [number, number])[] {
    const out: (readonly [number, number])[] = [];
    for (let i = 0; i < this.#n; i++) out.push([this.#r[2 * i]!, this.#r[2 * i + 1]!]);
    return out;
  }

  span(): { readonly from: number; readonly to: number } | undefined {
    return this.#n === 0 ? undefined : { from: this.#r[0]!, to: this.#r[2 * this.#n - 1]! };
  }

  markAll(): void {
    this.#r[0] = 0;
    this.#r[1] = this.range.size;
    this.#n = 1;
  }

  clean(): void {
    this.#n = 0;
  }

  resize(bytes: number, keep: number): void {
    const old = this.slot.range;
    const next = this.region.allocate(bytes);
    if (keep > 0)
      new Uint8Array(this.region.buffer).copyWithin(next.offset, old.offset, old.offset + keep);
    this.region.free(old);
    this.slot.range = next;
    this.bytes = bytes;
    this.markAll();
  }

  current(at: string): void {
    if (this.ahead !== undefined)
      throw new TypeError(
        `${at}: a call wrote ${this.name}, and its values are on the device until \`await ${this.name}.read()\` brings them back; await it first.`,
      );
  }

  error(): unknown {
    for (const s of this.states.values()) if (s.error !== undefined) return s.error;
    return this.kept;
  }

  kept: unknown;

  live(): void {
    if (this.range.freed)
      throw new TypeError(
        `${this.name} was disposed; its fields cannot be read or set. Make a new one with ${this.remedy}.`,
      );
  }

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
    let i = 0;
    while (i < n && r[2 * i + 1]! < from) i++;
    if (i === n || r[2 * i]! > to) {
      r.copyWithin(2 * i + 2, 2 * i, 2 * n);
      r[2 * i] = from;
      r[2 * i + 1] = to;
      n++;
    } else {
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

const registry =
  typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry<Slot>(({ region, range }) => region.free(range))
    : undefined;

export function adopt(owner: object, core: Core): void {
  cores.set(owner, core);
  registry?.register(owner, core.slot, core);
}

export function dispose(core: Core): void {
  if (core.range.freed) return;
  core.region.free(core.range);
  registry?.unregister(core);
}

function readNumber(dv: DataView, at: number, t: LayoutNumber): number {
  if (t === 'f64') return dv.getFloat32(at, true) + dv.getFloat32(at + 4, true);
  return t === 'f32'
    ? dv.getFloat32(at, true)
    : t === 'i32'
      ? dv.getInt32(at, true)
      : dv.getUint32(at, true);
}

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

type Snapshot =
  | { readonly full: ArrayBuffer; readonly length: number }
  | { readonly ranges: readonly (readonly [number, Uint8Array])[] };

export class RegionState extends ResidentArrayState {
  readonly layout: Layout & { readonly k: 'a' };
  readonly proto: object;
  length = 0;
  captured = -1;
  handle: ReturnType<typeof handleOf> | undefined;
  checking: number | undefined;
  pending: (readonly [number, number])[] = [];
  readonly #core: Core;

  constructor(layout: Layout & { readonly k: 'a' }, proto: object, core: Core) {
    super(undefined);
    this.layout = layout;
    this.proto = proto;
    this.#core = core;
  }

  override measure(): number {
    return this.checking ?? this.length;
  }

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

  failed(): void {
    if (this.#core.ahead === this) this.#core.ahead = undefined;
  }

  apply(s: Snapshot): void {
    const st = this.layout.st;
    const e = this.layout.e;
    if ('full' in s) {
      const dv = new DataView(s.full);
      const host: unknown[] = [];
      for (let i = 0; i < s.length; i++) host.push(readValue(dv, i * st, e, this.proto));
      this.host = host;
      this.length = s.length;
      this.fresh = 'host';
      return;
    }
    const gpu = this.gpu;
    const device = gpu !== undefined && this.fresh !== 'host';
    if (device)
      for (const [from, bytes] of s.ranges)
        gpu.d.queue.writeBuffer(gpu.buffer, from, bytes.slice().buffer as ArrayBuffer);
    if (this.fresh === 'device' && gpu !== undefined) return;
    const host = this.host as unknown[];
    for (const [from, bytes] of s.ranges) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let at = 0; at + st <= bytes.byteLength; at += st)
        host[(from + at) / st] = readValue(dv, at, e, this.proto);
    }
    const both = this.fresh === 'both' && device;
    this.fresh = 'host';
    if (both) this.fresh = 'both';
  }
}

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
