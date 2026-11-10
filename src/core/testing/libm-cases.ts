// The seeded inputs of the libm's gates for the families after `sin` and `cos` (change 0042,
// milestone 1a). Test code only.
//
// `libm-gate.ts` holds the inputs of `trig.gate.json` and says how an input is made and why a
// NaN is hashed as the canonical NaN. This file holds the same for each later family, one gate
// file for each: `src/core/libm/<family>.gate.json`. A case is one function for one operand
// format. The `f32` case rounds the operand and the result to `f32`, as the CPU engines do in
// `'f32'` precision (Amendment A2 of change 0042).

import { f32OfBits, f64OfWords } from './libm-reference.js';
import {
  LIBM_GATE_COUNT,
  LIBM_GATE_SEED,
  littleEndianBytes,
  mulberry32,
  type LibmInputSet,
} from './libm-gate.js';

/** A set of inputs of a case: the operands, and the second operands of a function of two. */
export interface LibmCaseSet extends LibmInputSet {
  readonly second?: Float32Array | Float64Array | Int32Array;
}

/** One function of the libm for one operand format. */
export interface LibmCase {
  /** The function and the format, as `expF32` or `expF64`. */
  readonly routine: string;
  readonly format: 'f32' | 'f64';
  /** The function on one operand, or on two. An `f32` case rounds as the engines do. */
  readonly f: (x: number, y: number) => number;
  /** The input sets; `count` is the size of each seeded set. */
  readonly sets: (count?: number) => LibmCaseSet[];
}

/** The routines of the family `explog`, as `LIBM` of `src/core/cpu-runtime.ts` holds them. */
export interface ExplogRoutines {
  readonly expF64: (x: number) => number;
  readonly exp2F64: (x: number) => number;
  readonly logF64: (x: number) => number;
  readonly log2F64: (x: number) => number;
  readonly ldexpF64: (x: number, n: number) => number;
}

/** Edge operands every function of one operand takes, as `f64` word pairs, high word first. */
const EDGES_F64: readonly (readonly [number, number])[] = [
  // Zeros, the smallest and largest subnormal, the smallest normal.
  [0x00000000, 0x00000000],
  [0x80000000, 0x00000000],
  [0x00000000, 0x00000001],
  [0x80000000, 0x00000001],
  [0x000fffff, 0xffffffff],
  [0x00100000, 0x00000000],
  // 1 and its neighbours, -1, 2, 0.5, e, 10.
  [0x3fefffff, 0xffffffff],
  [0x3ff00000, 0x00000000],
  [0x3ff00000, 0x00000001],
  [0xbff00000, 0x00000000],
  [0x40000000, 0x00000000],
  [0x3fe00000, 0x00000000],
  [0x4005bf0a, 0x8b145769],
  [0x40240000, 0x00000000],
  // 2^-28, ln 2 / 2 and 1.5 ln 2, where exp changes its path.
  [0x3e300000, 0x00000000],
  [0x3fd62e42, 0xfefa39ef],
  [0x3ff0a2b2, 0x3f3bab73],
  // The bounds of exp: 709.78..., -708.39..., -745.13..., and of exp2: 1024, -1023, -1075.
  [0x40862e42, 0xfefa39ef],
  [0x40862e42, 0xfefa39f0],
  [0xc086232b, 0xdd7abcd2],
  [0xc0874910, 0xd52d3051],
  [0xc0874910, 0xd52d3052],
  [0x408fffff, 0xffffffff],
  [0x40900000, 0x00000000],
  [0xc08ff800, 0x00000000],
  [0xc090cbff, 0xffffffff],
  [0xc090cc00, 0x00000000],
  // Half-integers and an integer, for exp2.
  [0x3fe00000, 0x00000000],
  [0xc08ff000, 0x00000000],
  [0x40590000, 0x00000000],
  // sqrt(2) / 2 and sqrt(2), where log changes its exponent.
  [0x3fe6a09e, 0x667f3bcd],
  [0x3ff6a09e, 0x667f3bcd],
  // The largest finite value, the infinities and NaNs.
  [0x7fefffff, 0xffffffff],
  [0xffefffff, 0xffffffff],
  [0x7ff00000, 0x00000000],
  [0xfff00000, 0x00000000],
  [0x7ff80000, 0x00000000],
  [0xfff80000, 0x00000000],
];

/** The same for an `f32` operand, as bit patterns. */
const EDGES_F32: readonly number[] = [
  0x00000000, 0x80000000, 0x00000001, 0x80000001, 0x007fffff, 0x00800000,
  // 1 and its neighbours, -1, 2, 0.5, e, 10.
  0x3f7fffff, 0x3f800000, 0x3f800001, 0xbf800000, 0x40000000, 0x3f000000, 0x402df854, 0x41200000,
  // The bounds of exp for an f32 result: 88.72..., -103.97...; of exp2: 128, -149, -150.
  0x42b17217, 0x42b17218, 0xc2cff1b4, 0xc2cff1b5, 0x42ffffff, 0x43000000, 0xc3150000, 0xc3160000,
  // sqrt(2) / 2 and sqrt(2).
  0x3f3504f3, 0x3fb504f3,
  // The largest finite value, the infinities and NaNs.
  0x7f7fffff, 0xff7fffff, 0x7f800000, 0xff800000, 0x7fc00000, 0xffc00000,
];

/** What a case's seeded sets are made of, past the edge values and every bit pattern. */
interface Shape {
  /** The half-width of a uniform sample around zero. */
  readonly span: number;
  /** Whether the function takes positive operands only, so the sign bit is cleared. */
  readonly positive: boolean;
}

function unarySets(format: 'f32' | 'f64', shape: Shape, count: number): LibmCaseSet[] {
  const next = mulberry32(LIBM_GATE_SEED);
  const mask = shape.positive ? 0x7fffffff : 0xffffffff;
  // A signed integer of 31 bits over 2^31: a value in [-1, 1), exact in every engine.
  const unit = (): number => (next() | 0) / 2147483648;
  if (format === 'f32') {
    const bits = new Float32Array(count);
    for (let i = 0; i < count; i++) bits[i] = f32OfBits(next() & mask);
    const span = new Float32Array(count);
    for (let i = 0; i < count; i++)
      span[i] = (shape.positive ? Math.abs(unit()) : unit()) * shape.span;
    // Around 1, where log is near zero: 1 + u / 2 for u in [-1, 1).
    const one = new Float32Array(count);
    for (let i = 0; i < count; i++) one[i] = 1 + unit() * 0.5;
    return [
      { name: 'edges', values: Float32Array.from(EDGES_F32, f32OfBits) },
      { name: 'bits', values: bits },
      { name: 'span', values: span },
      { name: 'one', values: one },
    ];
  }
  const bits = new Float64Array(count);
  for (let i = 0; i < count; i++) bits[i] = f64OfWords(next() & mask, next());
  // A signed integer of 53 bits over 2^52: a value in [-1, 1), exact in every engine.
  const unit53 = (): number => ((next() | 0) * 2097152 + (next() >>> 11)) / 4503599627370496;
  const span = new Float64Array(count);
  for (let i = 0; i < count; i++)
    span[i] = (shape.positive ? Math.abs(unit53()) : unit53()) * shape.span;
  const one = new Float64Array(count);
  for (let i = 0; i < count; i++) one[i] = 1 + unit53() * 0.5;
  return [
    { name: 'edges', values: Float64Array.from(EDGES_F64, ([hi, lo]) => f64OfWords(hi, lo)) },
    { name: 'bits', values: bits },
    { name: 'span', values: span },
    { name: 'one', values: one },
  ];
}

/** The sets of `ldexp`: every bit pattern, with an exponent that spans the format twice. */
function ldexpSets(format: 'f32' | 'f64', count: number): LibmCaseSet[] {
  const next = mulberry32(LIBM_GATE_SEED);
  const width = format === 'f32' ? 600 : 4400;
  const values = format === 'f32' ? new Float32Array(count) : new Float64Array(count);
  const second = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    values[i] = format === 'f32' ? f32OfBits(next()) : f64OfWords(next(), next());
    second[i] = (next() % width) - width / 2;
  }
  // Each edge exponent with a value that reaches a subnormal, a normal and an overflow.
  const edgeN = [0, 1, -1, 52, -52, 1023, 1024, -1022, -1074, -1075, 2046, 2047, -2098, -2099];
  const edgeX = [1, -1, 0.5, 1.5, 4.9e-324, 1.7976931348623157e308, 0, Infinity, NaN, 3];
  const ex = format === 'f32' ? new Float32Array(140) : new Float64Array(140);
  const en = new Int32Array(140);
  for (let i = 0; i < 140; i++) {
    ex[i] = edgeX[i % 10]!;
    en[i] = edgeN[Math.floor(i / 10)]!;
  }
  return [
    { name: 'edges', values: ex, second: en },
    { name: 'bits', values, second },
  ];
}

/** The cases of the family `explog` over the routines `libm`. */
export function explogCases(libm: ExplogRoutines): LibmCase[] {
  const fr = Math.fround;
  const unary: readonly (readonly [string, (x: number) => number, Shape, Shape])[] = [
    // exp: an f32 result is finite on about [-104, 89], an f64 result on about [-745, 710].
    ['exp', libm.expF64, { span: 110, positive: false }, { span: 750, positive: false }],
    // exp2: an f32 result is finite on [-150, 128), an f64 result on [-1075, 1024).
    ['exp2', libm.exp2F64, { span: 160, positive: false }, { span: 1100, positive: false }],
    ['log', libm.logF64, { span: 100, positive: true }, { span: 100, positive: true }],
    ['log2', libm.log2F64, { span: 100, positive: true }, { span: 100, positive: true }],
  ];
  const cases: LibmCase[] = [];
  for (const [name, f, s32, s64] of unary) {
    cases.push({
      routine: `${name}F32`,
      format: 'f32',
      f: (x) => fr(f(fr(x))),
      sets: (count = LIBM_GATE_COUNT) => unarySets('f32', s32, count),
    });
    cases.push({
      routine: `${name}F64`,
      format: 'f64',
      f: (x) => f(x),
      sets: (count = LIBM_GATE_COUNT) => unarySets('f64', s64, count),
    });
  }
  cases.push({
    routine: 'ldexpF32',
    format: 'f32',
    f: (x, n) => fr(libm.ldexpF64(fr(x), n)),
    sets: (count = LIBM_GATE_COUNT) => ldexpSets('f32', count),
  });
  cases.push({
    routine: 'ldexpF64',
    format: 'f64',
    f: (x, n) => libm.ldexpF64(x, n),
    sets: (count = LIBM_GATE_COUNT) => ldexpSets('f64', count),
  });
  return cases;
}

/** The results of a case on a set, in an array of the operands' format. */
export function caseResults(c: LibmCase, set: LibmCaseSet): Float32Array | Float64Array {
  const n = set.values.length;
  const out = c.format === 'f32' ? new Float32Array(n) : new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = c.f(set.values[i]!, set.second?.[i] ?? 0);
  return out;
}

/** The bytes a set's operands hash as: the first operands, then the second ones. */
export function caseInputBytes(set: LibmCaseSet): Uint8Array {
  const first = littleEndianBytes(set.values).bytes;
  if (set.second === undefined) return first;
  let second: Uint8Array;
  if (set.second instanceof Int32Array) {
    second = new Uint8Array(set.second.length * 4);
    const view = new DataView(second.buffer);
    for (let i = 0; i < set.second.length; i++) view.setInt32(i * 4, set.second[i]!, true);
  } else {
    second = littleEndianBytes(set.second).bytes;
  }
  const out = new Uint8Array(first.length + second.length);
  out.set(first, 0);
  out.set(second, first.length);
  return out;
}

/** One row of a family's gate file. */
export interface LibmCaseRow {
  readonly routine: string;
  readonly set: string;
  readonly count: number;
  /** How many results are a NaN, each hashed as the canonical NaN. */
  readonly nanResults: number;
  readonly inputsSha256: string;
  readonly resultsSha256: string;
}

/** A family's gate file: `src/core/libm/<family>.gate.json`. */
export interface LibmCaseFile {
  readonly seed: string;
  readonly generator: string;
  readonly nan: string;
  readonly rows: readonly LibmCaseRow[];
}

/** The rows the cases give, hashed by `sha256`. */
export function caseRows(
  cases: readonly LibmCase[],
  sha256: (bytes: Uint8Array) => string,
): LibmCaseRow[] {
  const rows: LibmCaseRow[] = [];
  for (const c of cases) {
    for (const set of c.sets()) {
      const { bytes, nans } = littleEndianBytes(caseResults(c, set));
      rows.push({
        routine: c.routine,
        set: set.name,
        count: set.values.length,
        nanResults: nans,
        inputsSha256: sha256(caseInputBytes(set)),
        resultsSha256: sha256(bytes),
      });
    }
  }
  return rows;
}
