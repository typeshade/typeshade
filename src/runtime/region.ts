// ═══ The one memory region every host resource is a range of (change 0138, R17) ═══
//
// Every uniform and storage array a host makes with `uniform()`, `zeros()` or `array(Class, data)`
// is a byte range of one global region, laid out by Rule 6.8. At milestone 1 the region is one
// `ArrayBuffer`, resizable where the runtime has one (Amendment A1, the answer to Q9); milestone 2
// makes it the linear memory of the WebAssembly CPU tier.
//
// The region places, frees and compacts ranges. A range never moves while the host holds a view
// of it, because the host holds none: each field's accessor (`runtime/resource.ts`) asks the
// region for its buffer and its generation, and makes its views again when the generation moved.
// The generation moves when the region replaces its buffer (a growth past a resizable buffer's
// most bytes, or a runtime with none) and when it compacts, which moves ranges. A growth of a
// resizable buffer keeps every view attached, so it moves nothing.
//
// A resource that lives only on a GPU device (a texture, an intermediate of a graph) takes no
// range. Like the rest of `typeshade/runtime` it imports no compiler.

/** The alignment of every range: the largest alignment Rule 6.8 gives a type (a `vec4`, a
 *  matrix column, a struct in a uniform), so a range laid out from offset 0 stays laid out at any
 *  offset the region places it. */
export const RANGE_ALIGN = 16;

/** The bytes a new region starts with. */
const FIRST_BYTES = 64 * 1024;

/** The most bytes a resizable region may grow to before it is replaced. */
const RESIZABLE_MOST = 256 * 1024 * 1024;

const roundUp = (x: number, a: number): number => Math.ceil(x / a) * a;

/** One resource's place in the region: its offset and its size in bytes, both multiples of
 *  {@link RANGE_ALIGN}. The region moves `offset` when it compacts. */
export interface Range {
  offset: number;
  readonly size: number;
  /** Set when the range is freed; the region never gives it out again. */
  freed: boolean;
}

/** `ArrayBuffer` with the resizable form of ES2024, which the library's `lib` does not declare. */
interface Resizable {
  readonly resizable?: boolean;
  readonly maxByteLength?: number;
  resize?(bytes: number): void;
}

/** A new buffer of `bytes`, resizable up to `most` where the runtime makes one. */
function newBuffer(bytes: number, most: number, resizable: boolean): ArrayBuffer {
  if (resizable) {
    try {
      const Ctor = ArrayBuffer as unknown as new (
        n: number,
        options: { maxByteLength: number },
      ) => ArrayBuffer;
      const b = new Ctor(bytes, { maxByteLength: Math.max(bytes, most) });
      if ((b as Resizable).resizable === true) return b;
    } catch {
      // A runtime that cannot reserve `most` bytes makes a fixed buffer instead.
    }
  }
  return new ArrayBuffer(bytes);
}

/**
 * The region: one buffer and the ranges it holds, in offset order.
 *
 * Not API: `typeshade/runtime` holds one, `globalRegion()`, and the tests make their own.
 */
export class Region {
  #buffer: ArrayBuffer;
  #generation = 0;
  readonly #live: Range[] = [];
  readonly #resizable: boolean;

  /** @param bytes - the first size; @param resizable - false to test a runtime with no
   *  resizable `ArrayBuffer`. */
  constructor(bytes = FIRST_BYTES, resizable = true) {
    this.#resizable = resizable;
    this.#buffer = newBuffer(
      roundUp(Math.max(bytes, RANGE_ALIGN), RANGE_ALIGN),
      RESIZABLE_MOST,
      resizable,
    );
  }

  /** The region's buffer now. A view made of an earlier buffer is stale once
   *  {@link generation} has moved. */
  get buffer(): ArrayBuffer {
    return this.#buffer;
  }

  /** Moves whenever a range may have moved or the buffer was replaced. */
  get generation(): number {
    return this.#generation;
  }

  /** The bytes the live ranges hold. */
  get used(): number {
    let n = 0;
    for (const r of this.#live) n += r.size;
    return n;
  }

  /** How many ranges are live. */
  get count(): number {
    return this.#live.length;
  }

  /** A zeroed range of at least `bytes`. A size of 0 takes no bytes and is never placed. */
  allocate(bytes: number): Range {
    const size = roundUp(bytes, RANGE_ALIGN);
    const range: Range = { offset: 0, size, freed: false };
    if (size === 0) return range;
    let at = this.#gap(size);
    if (at === undefined) {
      if (this.#buffer.byteLength - this.used >= size) this.#compact();
      at = this.#gap(size);
    }
    if (at === undefined) {
      const end = this.#end();
      this.#grow(end + size);
      at = { index: this.#live.length, offset: end };
    }
    range.offset = at.offset;
    this.#live.splice(at.index, 0, range);
    new Uint8Array(this.#buffer, range.offset, size).fill(0);
    return range;
  }

  /** Free `range`. A second free does nothing. */
  free(range: Range): void {
    if (range.freed) return;
    range.freed = true;
    if (range.size === 0) return;
    const i = this.#live.indexOf(range);
    if (i >= 0) this.#live.splice(i, 1);
  }

  /** The first place a range of `size` fits between the live ones, or undefined. */
  #gap(size: number): { index: number; offset: number } | undefined {
    let cursor = 0;
    for (let i = 0; i < this.#live.length; i++) {
      const r = this.#live[i]!;
      if (r.offset - cursor >= size) return { index: i, offset: cursor };
      cursor = r.offset + r.size;
    }
    if (this.#buffer.byteLength - cursor >= size)
      return { index: this.#live.length, offset: cursor };
    return undefined;
  }

  /** The end of the last live range. */
  #end(): number {
    const last = this.#live[this.#live.length - 1];
    return last === undefined ? 0 : last.offset + last.size;
  }

  /** Move every live range down to the lowest offset it can take, in order. */
  #compact(): void {
    const bytes = new Uint8Array(this.#buffer);
    let cursor = 0;
    for (const r of this.#live) {
      if (r.offset !== cursor) {
        bytes.copyWithin(cursor, r.offset, r.offset + r.size);
        r.offset = cursor;
      }
      cursor += r.size;
    }
    this.#generation++;
  }

  /** Make the buffer hold at least `bytes`: resize it in place where it can, so every view stays
   *  attached, or copy it into a new one and move the generation. */
  #grow(bytes: number): void {
    const want = roundUp(Math.max(bytes, this.#buffer.byteLength * 2), FIRST_BYTES);
    const b = this.#buffer as ArrayBuffer & Resizable;
    if (b.resizable === true && b.resize !== undefined && want <= (b.maxByteLength ?? 0)) {
      b.resize(want);
      return;
    }
    const next = newBuffer(want, Math.max(RESIZABLE_MOST, want * 2), this.#resizable);
    new Uint8Array(next).set(new Uint8Array(this.#buffer));
    this.#buffer = next;
    this.#generation++;
  }
}

let region: Region | undefined;

/** The region of `typeshade/runtime`, made on first use. */
export function globalRegion(): Region {
  return (region ??= new Region());
}
