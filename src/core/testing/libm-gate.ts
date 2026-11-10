// The seeded inputs of the libm's gates (change 0042, milestone 1a). Test code only.
//
// The libm promises the same bits on every engine that a gate runs. The gate is a file,
// `src/core/libm/trig.gate.json`, that holds for each routine and each set of inputs the hash
// of the inputs and the hash of the libm's results. `src/core/libm/libm.test.ts` holds the
// JavaScript form to it in Node (V8), and `scripts/libm-arm.ts` in Bun (JavaScriptCore).
//
// The inputs are made with 32-bit integer arithmetic and a `DataView` only, so every engine
// makes the same bits. This file hashes nothing: a caller hashes the bytes it returns.
//
// A NaN is hashed as the canonical NaN of its format, as an input and as a result. Reason:
// milestone 1b of change 0042 owes the canonical NaN at a store. Until it lands, the bits of a
// NaN are the engine's choice: the bits of a NaN that a routine computes from a NaN operand,
// and the payload of a NaN that a typed array holds (JavaScriptCore gave two payloads for one
// input in one process). The inputs that give a NaN result are the NaN and the infinite
// operands. Every other input and result is hashed bit for bit.

import { f32OfBits, f64OfWords } from './libm-reference.js';

/** What the gates measure: each function of the libm for an `f64` operand, and for an `f32`
 *  operand, whose result is the `f64` routine's result rounded once to `f32`. */
export type LibmRoutine = 'sinF32' | 'cosF32' | 'sinF64' | 'cosF64';
export const LIBM_ROUTINES: readonly LibmRoutine[] = ['sinF32', 'cosF32', 'sinF64', 'cosF64'];

/** The four measured functions over the two `f64` routines `trig`. The `f32` ones round the
 *  operand and the result to `f32`, as the CPU engines do in `'f32'` precision. */
export function libmFunctions(trig: {
  readonly sinF64: (x: number) => number;
  readonly cosF64: (x: number) => number;
}): Record<LibmRoutine, (x: number) => number> {
  return {
    sinF32: (x) => Math.fround(trig.sinF64(Math.fround(x))),
    cosF32: (x) => Math.fround(trig.cosF64(Math.fround(x))),
    sinF64: trig.sinF64,
    cosF64: trig.cosF64,
  };
}

/** The generator of the seeded inputs: mulberry32, 32-bit integer arithmetic only. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** The seed of every set, and the number of inputs in each seeded set. */
export const LIBM_GATE_SEED = 0x00425eed;
export const LIBM_GATE_COUNT = 250_000;

/** The edge values of an `f32` routine, as bit patterns. */
const EDGES_F32: readonly number[] = [
  // Zeros, the smallest and largest subnormal, the smallest normal.
  0x00000000, 0x80000000, 0x00000001, 0x80000001, 0x007fffff, 0x00800000,
  // Small values, pi/4 and 2^22, where a reduction starts for an f32 operand's size.
  0x397fffff, 0x39800000, 0x39800001, 0x3f490fda, 0x3f490fdb, 0xbf490fdb, 0x4a7fffff, 0x4a800000,
  0x4a800001, 0xca800000,
  // 1, pi/2, pi, 3pi/4 and values near multiples of pi/2.
  0x3f800000, 0x3fc90fdb, 0x40490fdb, 0xc0490fdb, 0x4016cbe4, 0x4b7f1e57, 0x5922aa80, 0x6a1976f1,
  // Large values, the largest finite value, the infinities and NaNs.
  0x501502f9, 0x7e7fffff, 0x7f7fffff, 0xff7fffff, 0x7f800000, 0xff800000, 0x7fc00000, 0xffc00000,
  0x7fc00001, 0x7f800001,
];

/** The edge values of an `f64` routine, as word pairs, high word first. */
const EDGES_F64: readonly (readonly [number, number])[] = [
  // Zeros, the smallest and largest subnormal, the smallest normal.
  [0x00000000, 0x00000000],
  [0x80000000, 0x00000000],
  [0x00000000, 0x00000001],
  [0x80000000, 0x00000001],
  [0x000fffff, 0xffffffff],
  [0x00100000, 0x00000000],
  // Around the thresholds of the routines: 2^-27 * sqrt(2), 2^-26, pi/4, 2^20 * pi/2.
  [0x3e46a09d, 0xffffffff],
  [0x3e46a09e, 0x00000000],
  [0x3e4fffff, 0xffffffff],
  [0x3e500000, 0x00000000],
  [0x3fe921fb, 0x54442d18],
  [0x3fe921fb, 0xffffffff],
  [0x3fe921fc, 0x00000000],
  [0xbfe921fc, 0x00000000],
  [0x413921fa, 0xffffffff],
  [0x413921fb, 0x00000000],
  [0xc13921fb, 0x00000000],
  [0x413921fb, 0x54442d18],
  // 1, pi/2, pi, and the f64 nearest a multiple of pi/2: 6381956970095103 * 2^797.
  [0x3ff00000, 0x00000000],
  [0x3ff921fb, 0x54442d18],
  [0x400921fb, 0x54442d18],
  [0xc00921fb, 0x54442d18],
  [0x7506ac5b, 0x262ca1ff],
  [0xf506ac5b, 0x262ca1ff],
  // 2^52 to 2^54, 1e22, large values, the largest finite value, the infinities and NaNs.
  [0x43300000, 0x00000000],
  [0x43400000, 0x00000000],
  [0x43500000, 0x00000000],
  [0x4480f0cf, 0x064dd592],
  [0x7fe00000, 0x00000000],
  [0x7fefffff, 0xffffffff],
  [0xffefffff, 0xffffffff],
  [0x7ff00000, 0x00000000],
  [0xfff00000, 0x00000000],
  [0x7ff80000, 0x00000000],
  [0xfff80000, 0x00000000],
  [0x7ff80000, 0x00000001],
  [0x7ff00000, 0x00000001],
];

/** A set of inputs: its name, and its values. */
export interface LibmInputSet {
  readonly name: string;
  readonly values: Float32Array | Float64Array;
}

/** The input sets of a routine. For `f32`: the edge values, every bit pattern with equal
 *  chance, and a uniform sample of [-100, 100). For `f64`: the edge values, every bit pattern
 *  with equal chance, a uniform sample of [-100, 100) and of [-2^21, 2^21), which spans the
 *  bound between the two reductions. `count` is the size of each seeded set. */
export function libmInputs(routine: LibmRoutine, count = LIBM_GATE_COUNT): LibmInputSet[] {
  const next = mulberry32(LIBM_GATE_SEED);
  if (routine.endsWith('F32')) {
    const bits = new Float32Array(count);
    for (let i = 0; i < count; i++) bits[i] = f32OfBits(next());
    const near = new Float32Array(count);
    // A multiple of 2^-24 in [-128, 128), which an f32 holds exactly.
    for (let i = 0; i < count; i++) near[i] = ((next() | 0) / 16777216) * 0.78125;
    return [
      { name: 'edges', values: Float32Array.from(EDGES_F32, f32OfBits) },
      { name: 'bits', values: bits },
      { name: 'near', values: near },
    ];
  }
  const bits = new Float64Array(count);
  for (let i = 0; i < count; i++) bits[i] = f64OfWords(next(), next());
  // A signed integer of 53 bits, scaled by a power of two: exact in every engine.
  const signed53 = (): number => (next() | 0) * 2097152 + (next() >>> 11);
  const near = new Float64Array(count);
  // 35184372088832 is 2^45 and 2147483648 is 2^31: a division by a power of two is exact.
  for (let i = 0; i < count; i++) near[i] = (signed53() / 35184372088832) * 0.78125;
  const medium = new Float64Array(count);
  for (let i = 0; i < count; i++) medium[i] = signed53() / 2147483648;
  return [
    { name: 'edges', values: Float64Array.from(EDGES_F64, ([hi, lo]) => f64OfWords(hi, lo)) },
    { name: 'bits', values: bits },
    { name: 'near', values: near },
    { name: 'medium', values: medium },
  ];
}

/** The bytes of `values` in little-endian order, whatever the host's order, a NaN as the
 *  canonical NaN of the format (the header of this file says why). Also the number of NaNs. */
export function littleEndianBytes(values: Float32Array | Float64Array): {
  bytes: Uint8Array;
  nans: number;
} {
  const size = values.BYTES_PER_ELEMENT;
  const out = new Uint8Array(values.length * size);
  const view = new DataView(out.buffer);
  let nans = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (v !== v) {
      nans++;
      if (size === 4) view.setUint32(i * 4, 0x7fc00000, true);
      else {
        view.setUint32(i * 8, 0, true);
        view.setUint32(i * 8 + 4, 0x7ff80000, true);
      }
    } else if (size === 4) view.setFloat32(i * 4, v, true);
    else view.setFloat64(i * 8, v, true);
  }
  return { bytes: out, nans };
}

/** The results of `f` on `inputs`, in an array of the inputs' format. */
export function libmResults(
  f: (x: number) => number,
  inputs: Float32Array | Float64Array,
): Float32Array | Float64Array {
  const out =
    inputs instanceof Float32Array
      ? new Float32Array(inputs.length)
      : new Float64Array(inputs.length);
  for (let i = 0; i < inputs.length; i++) out[i] = f(inputs[i]!);
  return out;
}

/** One row of the gate file: a routine, a set, and the two hashes. */
export interface LibmGateRow {
  readonly routine: LibmRoutine;
  readonly set: string;
  readonly count: number;
  /** How many results are a NaN, each hashed as the canonical NaN. */
  readonly nanResults: number;
  readonly inputsSha256: string;
  readonly resultsSha256: string;
}

/** The gate file: `src/core/libm/trig.gate.json`. */
export interface LibmGateFile {
  readonly seed: string;
  readonly generator: string;
  readonly nan: string;
  readonly rows: readonly LibmGateRow[];
}

/** The rows the routines `fns` give, hashed by `sha256`. */
export function libmGateRows(
  fns: Readonly<Record<LibmRoutine, (x: number) => number>>,
  sha256: (bytes: Uint8Array) => string,
): LibmGateRow[] {
  const rows: LibmGateRow[] = [];
  for (const routine of LIBM_ROUTINES) {
    for (const set of libmInputs(routine)) {
      const { bytes, nans } = littleEndianBytes(libmResults(fns[routine], set.values));
      rows.push({
        routine,
        set: set.name,
        count: set.values.length,
        nanResults: nans,
        inputsSha256: sha256(littleEndianBytes(set.values).bytes),
        resultsSha256: sha256(bytes),
      });
    }
  }
  return rows;
}
