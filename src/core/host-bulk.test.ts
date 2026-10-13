// ═══ The bulk copy of a flat typed array (host-entry's `bulkOf`) ═══
//
// A runtime-sized array of `f32`, `i32` or `u32`, or of a vector of them with no padding, whose
// host value is the matching typed array, is packed and read back as one copy of bytes. Each
// result must be the bytes the element-by-element path gives. That path is reached with a plain
// `Array` of the same numbers, which `bulkOf` does not take, so the reference here is the general
// path itself, not a copy of it. Every refusal, and every layout the bulk copy does not take
// (padded vectors, `f64`), keeps its diagnostic and its element-by-element path.
//
// Values are random 32-bit patterns, so denormals, infinities, both zeros and every NaN payload
// (quiet and signalling) are drawn, and a seeded generator makes each run the same run.

import { describe, it, expect } from 'vitest';
import {
  bulkOf,
  byteSize,
  Misfit,
  pack,
  packed,
  readInto,
  type EntryBinding,
  type Layout,
} from './host-entry.js';

const F32: Layout = { k: 'a', n: null, st: 4, e: { k: 's', t: 'f32' } };
const I32: Layout = { k: 'a', n: null, st: 4, e: { k: 's', t: 'i32' } };
const U32: Layout = { k: 'a', n: null, st: 4, e: { k: 's', t: 'u32' } };
const VEC2F32: Layout = { k: 'a', n: null, st: 8, e: { k: 'v', n: 2, t: 'f32' } };
const VEC4U32: Layout = { k: 'a', n: null, st: 16, e: { k: 'v', n: 4, t: 'u32' } };
const VEC3F32: Layout = { k: 'a', n: null, st: 16, e: { k: 'v', n: 3, t: 'f32' } };
const F64: Layout = { k: 'a', n: null, st: 8, e: { k: 's', t: 'f64' } };

type Ctor = Float32ArrayConstructor | Int32ArrayConstructor | Uint32ArrayConstructor;
type Typed = Float32Array | Int32Array | Uint32Array;

/** Each bulk-eligible layout, the typed array its elements take, and the lanes per element. */
const CASES: readonly [string, Layout, Ctor, number][] = [
  ['array<f32>', F32, Float32Array, 1],
  ['array<i32>', I32, Int32Array, 1],
  ['array<u32>', U32, Uint32Array, 1],
  ['array<vec2<f32>>', VEC2F32, Float32Array, 2],
  ['array<vec4<u32>>', VEC4U32, Uint32Array, 4],
];

const LENGTHS = [1, 2, 3, 5, 8, 31, 64, 257, 1000];
const SEEDS = [1, 2, 3];

/** A seeded generator (mulberry32), so every run draws the same values. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A typed array of `count` elements of `lanes` lanes, filled with random 32-bit patterns. One
 *  word in four of an `f32` array has all exponent bits set, so NaNs and infinities are common. */
function filled(Ctor: Ctor, count: number, lanes: number, seed: number): Typed {
  const next = rng(seed);
  const words = new Uint32Array(count * lanes);
  for (let i = 0; i < words.length; i++) {
    const w = Math.floor(next() * 0x100000000);
    words[i] = Ctor === Float32Array && next() < 0.25 ? (w & 0x807fffff) | 0x7f800000 : w;
  }
  return new Ctor(words.buffer) as Typed;
}

/** Whether `a` and `b` hold the same numbers in every word. An `f32` NaN is the same as any
 *  other NaN here: the element path rewrites a NaN's payload as the engine's float conversion
 *  chooses, which is not a value (see the test of NaN bits below). */
function sameNumbers(a: Typed, b: Typed): void {
  expect(a.byteLength).toBe(b.byteLength);
  const wa = new Uint32Array(a.buffer.slice(0));
  const wb = new Uint32Array(b.buffer.slice(0));
  for (let i = 0; i < wa.length; i++) {
    if (wa[i] === wb[i]) continue;
    if (a instanceof Float32Array && Number.isNaN(a[i]) && Number.isNaN(b[i])) continue;
    throw new Error(`word ${i}: ${wa[i]!.toString(16)} is not ${wb[i]!.toString(16)}`);
  }
}

function binding(layout: Layout): EntryBinding {
  return {
    name: 'xs',
    group: 0,
    binding: 0,
    space: 'storage',
    writes: true,
    layout,
    s: 'array<T>',
  };
}

/** A copy of the bytes of a buffer or of a view. */
function bytesOf(v: ArrayBuffer | ArrayBufferView): Uint8Array {
  return v instanceof ArrayBuffer
    ? new Uint8Array(v).slice()
    : new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice();
}

/** The message and the problem a refusal carries, or undefined when the call does not refuse. */
function refusal(f: () => unknown): { path: string; problem: string } | undefined {
  try {
    f();
    return undefined;
  } catch (err) {
    if (!(err instanceof Misfit)) throw err;
    return { path: err.path, problem: err.problem };
  }
}

describe('a flat typed array is packed by one copy, as the element-by-element path packs it', () => {
  for (const [label, layout, Ctor, lanes] of CASES)
    for (const count of LENGTHS)
      for (const seed of SEEDS)
        it(`${label}, ${count} elements, seed ${seed}: the bytes match`, () => {
          const host = filled(Ctor, count, lanes, seed);
          const size = count * (layout as { st: number }).st;

          // The general path: a plain Array takes the element loop, which `bulkOf` does not take.
          const general = new DataView(new ArrayBuffer(size));
          pack(general, 0, layout, Array.from(host as ArrayLike<number>), '');

          const fast = new DataView(new ArrayBuffer(size));
          pack(fast, 0, layout, host, '');

          // The bulk copy keeps the bits of the typed array exactly.
          expect(bytesOf(fast.buffer as ArrayBuffer)).toEqual(bytesOf(host));
          sameNumbers(
            new Ctor(fast.buffer as ArrayBuffer) as Typed,
            new Ctor(general.buffer as ArrayBuffer) as Typed,
          );

          // The call's upload is `packed`, which sizes the buffer and packs it the same way.
          const uploaded = packed(binding(layout), host);
          expect(bytesOf(uploaded)).toEqual(bytesOf(host));
        });

  for (const [label, layout, Ctor, lanes] of CASES)
    for (const count of LENGTHS)
      it(`${label}, ${count} elements: the readback fills the typed array as the element loop does`, () => {
        const host = filled(Ctor, count, lanes, 7);
        const dv = new DataView(new ArrayBuffer(host.byteLength));
        pack(dv, 0, layout, host, '');

        const target = new Ctor(host.length);
        const returned = readInto(dv, 0, layout, target);
        expect(returned).toBe(target);

        // The element loop reads into a plain Array of the same length.
        const general: number[] = new Array<number>(host.length).fill(0);
        readInto(dv, 0, layout, general);
        expect(bytesOf(target)).toEqual(bytesOf(host));
        sameNumbers(target, new Ctor(general) as Typed);
      });
});

describe('a typed array at an offset, and a write at an offset of a larger buffer', () => {
  it('packs the view it is given, not its whole buffer, and writes at the offset', () => {
    const backing = new Float32Array(16);
    for (let i = 0; i < backing.length; i++) backing[i] = i + 0.5;
    const view = new Float32Array(backing.buffer, 8, 5);
    const dv = new DataView(new ArrayBuffer(4 + 5 * 4));
    pack(dv, 4, F32, view, '');
    expect(bytesOf(dv.buffer as ArrayBuffer).subarray(4)).toEqual(bytesOf(view));
    expect(new Uint8Array(dv.buffer, 0, 4)).toEqual(new Uint8Array(4));
  });

  it('reads back into a view of a larger buffer and leaves the bytes around it alone', () => {
    const src = filled(Float32Array, 6, 1, 9);
    const dv = new DataView(new ArrayBuffer(4 + 24));
    pack(dv, 4, F32, src, '');
    const backing = new Float32Array(10).fill(-1);
    const target = backing.subarray(2, 8);
    readInto(dv, 4, F32, target);
    expect(bytesOf(target)).toEqual(bytesOf(src));
    expect(backing[0]).toBe(-1);
    expect(backing[1]).toBe(-1);
    expect(backing[8]).toBe(-1);
    expect(backing[9]).toBe(-1);
  });
});

describe('the special values the bulk copy must keep', () => {
  it('keeps both zeros, the infinities, a denormal and the extremes', () => {
    const special = new Float32Array([
      -0,
      0,
      Infinity,
      -Infinity,
      1.401298464324817e-45, // the smallest denormal
      -1.1754942e-38, // the largest negative denormal boundary
      3.4028234663852886e38,
      1.5,
    ]);
    const dv = new DataView(new ArrayBuffer(special.byteLength));
    pack(dv, 0, F32, special, '');
    const back = new Float32Array(special.length);
    readInto(dv, 0, F32, back);
    expect(Object.is(back[0], -0)).toBe(true);
    expect(Object.is(back[1], 0)).toBe(true);
    expect(back[2]).toBe(Infinity);
    expect(back[3]).toBe(-Infinity);
    expect(bytesOf(back)).toEqual(bytesOf(special));
  });

  it('the bulk copy keeps every NaN bit for bit, quiet or signalling, in both directions', () => {
    const words = new Uint32Array([0x7fc00000, 0x7fc00001, 0xffc12345, 0x7fa00001, 0xff9cd5c3]);
    const host = new Float32Array(words.buffer.slice(0));
    const dv = new DataView(new ArrayBuffer(host.byteLength));
    pack(dv, 0, F32, host, '');
    expect(new Uint32Array(dv.buffer)).toEqual(words);
    const back = new Float32Array(host.length);
    readInto(dv, 0, F32, back);
    expect(new Uint32Array(back.buffer)).toEqual(words);
  });

  it('the element path still gives a NaN for a NaN, whatever payload the engine keeps', () => {
    const host = new Float32Array(new Uint32Array([0x7fa00001, 0xff9cd5c3]).buffer.slice(0));
    const dv = new DataView(new ArrayBuffer(8));
    pack(dv, 0, F32, Array.from(host), '');
    expect(Number.isNaN(dv.getFloat32(0, true))).toBe(true);
    expect(Number.isNaN(dv.getFloat32(4, true))).toBe(true);
  });
});

describe('refusals keep their diagnostics', () => {
  it('a typed array of the wrong type is refused as before', () => {
    expect(refusal(() => byteSize(F32, new Float64Array(2), ''))).toEqual({
      path: '',
      problem: 'got a Float64Array, not a Float32Array',
    });
    expect(refusal(() => byteSize(F32, new Int32Array(2), ''))).toEqual({
      path: '',
      problem: 'got a Int32Array, not a Float32Array',
    });
    expect(refusal(() => byteSize(I32, new Uint32Array(2), ''))).toEqual({
      path: '',
      problem: 'got a Uint32Array, not a Int32Array',
    });
  });

  it('a plain Array is refused as before, since the call takes a typed array', () => {
    expect(refusal(() => byteSize(F32, [1, 2, 3], ''))).toEqual({
      path: '',
      problem: 'got an array of length 3, not a Float32Array',
    });
  });

  it('a length that is not whole elements is refused as before', () => {
    expect(refusal(() => byteSize(VEC2F32, new Float32Array(3), ''))).toEqual({
      path: '',
      problem: 'got 3 numbers, which is not a whole number of 2-component elements',
    });
  });

  it('an empty array is refused as before, since WebGPU cannot bind it', () => {
    expect(refusal(() => byteSize(F32, new Float32Array(0), ''))).toEqual({
      path: '',
      problem: 'got an empty array, which WebGPU cannot bind',
    });
  });

  it('a write past the end of the destination throws a RangeError, as the element loop does', () => {
    const dv = new DataView(new ArrayBuffer(4));
    expect(() => pack(dv, 0, F32, new Float32Array(2), '')).toThrow(RangeError);
  });
});

describe('the layouts the bulk copy does not take keep the element path', () => {
  it('a vec3 array, padded to 16 bytes an element, packs each lane at its stride', () => {
    const host = new Float32Array([1, 2, 3, 4, 5, 6]);
    const dv = new DataView(new ArrayBuffer(32));
    pack(dv, 0, VEC3F32, host, '');
    // Element `e` starts at 16 * e; its lane `j` is 4 * j further on.
    const expected = new DataView(new ArrayBuffer(32));
    host.forEach((x, i) => expected.setFloat32(Math.floor(i / 3) * 16 + 4 * (i % 3), x, true));
    expect(bytesOf(dv.buffer as ArrayBuffer)).toEqual(bytesOf(expected.buffer as ArrayBuffer));
    const back = new Float32Array(6);
    readInto(dv, 0, VEC3F32, back);
    expect(Array.from(back)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('an f64 array splits each value into its two f32 planes', () => {
    const host = new Float64Array([0.1, -2.5, 1e300]);
    const dv = new DataView(new ArrayBuffer(host.length * 8));
    pack(dv, 0, F64, host, '');
    for (let i = 0; i < host.length; i++) {
      const hi = Math.fround(host[i]!);
      expect(dv.getFloat32(i * 8, true)).toBe(hi);
      expect(dv.getFloat32(i * 8 + 4, true)).toBe(Math.fround(host[i]! - hi));
    }
    const back = new Float64Array(host.length);
    readInto(dv, 0, F64, back);
    expect(Array.from(back)).toEqual(
      Array.from(host, (x) => Math.fround(x) + Math.fround(x - Math.fround(x))),
    );
  });
});

describe('what the bulk copy takes and what it leaves to the element path', () => {
  it('takes a runtime-sized array of an unpadded scalar or vector, and nothing else', () => {
    for (const [, layout, Ctor, lanes] of CASES)
      expect(bulkOf(layout, new Ctor(lanes * 2))).toBeDefined();
    // vec3 has size 12 and stride 16, so its bytes are not the typed array's.
    expect(bulkOf(VEC3F32, new Float32Array(6))).toBeUndefined();
    expect(bulkOf(F64, new Float64Array(2))).toBeUndefined();
    // A fixed-size array, a plain Array, the wrong typed array and a partial element.
    expect(bulkOf({ k: 'a', n: 4, st: 4, e: { k: 's', t: 'f32' } }, new Float32Array(4))).toBe(
      undefined,
    );
    expect(bulkOf(F32, [1, 2])).toBeUndefined();
    expect(bulkOf(F32, new Int32Array(2))).toBeUndefined();
    expect(bulkOf(VEC2F32, new Float32Array(3))).toBeUndefined();
    // An array of structs, and a scalar.
    expect(
      bulkOf({ k: 'a', n: null, st: 4, e: { k: 'o', f: [], sz: 4 } }, new Float32Array(1)),
    ).toBe(undefined);
    expect(bulkOf({ k: 's', t: 'f32' }, new Float32Array(1))).toBeUndefined();
  });

  it('packs a fixed-size array element by element, as before', () => {
    const fixed: Layout = { k: 'a', n: 3, st: 4, e: { k: 's', t: 'f32' } };
    const dv = new DataView(new ArrayBuffer(12));
    pack(dv, 0, fixed, new Float32Array([1, 2, 3]), '');
    expect(Array.from(new Float32Array(dv.buffer))).toEqual([1, 2, 3]);
    expect(refusal(() => pack(dv, 0, fixed, new Float32Array(2), ''))).toBeDefined();
  });

  it('a runtime-sized array that ends a struct packs and reads back at its offset', () => {
    const inStruct: Layout = {
      k: 'o',
      f: [
        ['n', 0, { k: 's', t: 'u32' }],
        ['xs', 4, F32],
      ],
      sz: 4,
    };
    const xs = new Float32Array([1.5, -2, 3]);
    const dv = new DataView(new ArrayBuffer(16));
    pack(dv, 0, inStruct, { n: 7, xs }, '');
    expect(dv.getUint32(0, true)).toBe(7);
    const back = { n: 0, xs: new Float32Array(3) };
    readInto(dv, 0, inStruct, back);
    expect(back.n).toBe(7);
    expect(Array.from(back.xs)).toEqual([1.5, -2, 3]);
  });

  it('a view over a SharedArrayBuffer is copied in both directions', () => {
    const shared = new Float32Array(new SharedArrayBuffer(16));
    shared.set([1, 2, 3, 4]);
    const dv = new DataView(new ArrayBuffer(16));
    pack(dv, 0, F32, shared, '');
    expect(Array.from(new Float32Array(dv.buffer))).toEqual([1, 2, 3, 4]);
    const out = new Float32Array(new SharedArrayBuffer(16));
    readInto(dv, 0, F32, out);
    expect(Array.from(out)).toEqual([1, 2, 3, 4]);
  });

  it('a view at a byte offset of the destination buffer reads and writes at that offset', () => {
    const backing = new ArrayBuffer(24);
    const dv = new DataView(backing, 8, 16);
    pack(dv, 4, F32, new Float32Array([5, 6, 7]), '');
    expect(Array.from(new Float32Array(backing, 12, 3))).toEqual([5, 6, 7]);
    expect(new Uint32Array(backing, 0, 3)).toEqual(new Uint32Array(3));
  });

  it('a source that shares the destination buffer is copied whole', () => {
    const backing = new ArrayBuffer(16);
    const src = new Float32Array(backing, 0, 3);
    src.set([1, 2, 3]);
    pack(new DataView(backing), 4, F32, src, '');
    expect(Array.from(new Float32Array(backing, 4, 3))).toEqual([1, 2, 3]);
  });

  it('a detached typed array is refused as empty, as before', () => {
    const host = new Float32Array(4);
    structuredClone(host.buffer, { transfer: [host.buffer] });
    expect(refusal(() => byteSize(F32, host, ''))).toEqual({
      path: '',
      problem: 'got an empty array, which WebGPU cannot bind',
    });
  });

  it('a readback past the end of the source throws a RangeError, as the element loop does', () => {
    const dv = new DataView(new ArrayBuffer(4));
    expect(() => readInto(dv, 0, F32, new Float32Array(2))).toThrow(RangeError);
    expect(() => readInto(dv, 4, F32, new Float32Array(1))).toThrow(RangeError);
  });
});
