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
  /** Whether the function takes operands up to 1 in magnitude only. The set of bit patterns
   *  then holds every pattern below 1: each exponent below that of 1 with equal chance. */
  readonly unit?: boolean;
  /** Whether the case has the set `upper`: a uniform sample of 0.5 to 1 in magnitude, where
   *  asin and acos take the square root. The set `one` spans 0.5 to 1.5, so half of it is past
   *  the functions' range; it holds the bound at 1. */
  readonly upper?: boolean;
  /** Edge operands of this function's family, past the ones every function takes. */
  readonly edges?: {
    readonly f32: readonly number[];
    readonly f64: readonly (readonly [number, number])[];
  };
}

function unarySets(format: 'f32' | 'f64', shape: Shape, count: number): LibmCaseSet[] {
  const next = mulberry32(LIBM_GATE_SEED);
  const mask = shape.positive ? 0x7fffffff : 0xffffffff;
  // A signed integer of 31 bits over 2^31: a value in [-1, 1), exact in every engine.
  const unit = (): number => (next() | 0) / 2147483648;
  if (format === 'f32') {
    const bits = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const pattern = next() & mask;
      bits[i] = f32OfBits(
        shape.unit === true ? ((pattern & 0x807fffff) | ((next() % 127) << 23)) >>> 0 : pattern,
      );
    }
    const span = new Float32Array(count);
    for (let i = 0; i < count; i++)
      span[i] = (shape.positive ? Math.abs(unit()) : unit()) * shape.span;
    // Around 1, where log is near zero: 1 + u / 2 for u in [-1, 1).
    const one = new Float32Array(count);
    for (let i = 0; i < count; i++) one[i] = 1 + unit() * 0.5;
    const sets: LibmCaseSet[] = [
      {
        name: 'edges',
        values: Float32Array.from([...EDGES_F32, ...(shape.edges?.f32 ?? [])], f32OfBits),
      },
      { name: 'bits', values: bits },
      { name: 'span', values: span },
      { name: 'one', values: one },
    ];
    if (shape.upper === true) {
      // Made after the other sets, so their values do not change. 0.5 + |u| / 2, with a sign.
      const upper = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const u = unit();
        upper[i] = u < 0 ? u * 0.5 - 0.5 : u * 0.5 + 0.5;
      }
      sets.push({ name: 'upper', values: upper });
    }
    return sets;
  }
  const bits = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const hi = next() & mask;
    bits[i] = f64OfWords(
      shape.unit === true ? ((hi & 0x800fffff) | ((next() % 1023) << 20)) >>> 0 : hi,
      next(),
    );
  }
  // A signed integer of 53 bits over 2^52: a value in [-1, 1), exact in every engine.
  const unit53 = (): number => ((next() | 0) * 2097152 + (next() >>> 11)) / 4503599627370496;
  const span = new Float64Array(count);
  for (let i = 0; i < count; i++)
    span[i] = (shape.positive ? Math.abs(unit53()) : unit53()) * shape.span;
  const one = new Float64Array(count);
  for (let i = 0; i < count; i++) one[i] = 1 + unit53() * 0.5;
  const sets: LibmCaseSet[] = [
    {
      name: 'edges',
      values: Float64Array.from([...EDGES_F64, ...(shape.edges?.f64 ?? [])], ([hi, lo]) =>
        f64OfWords(hi, lo),
      ),
    },
    { name: 'bits', values: bits },
    { name: 'span', values: span },
    { name: 'one', values: one },
  ];
  if (shape.upper === true) {
    const upper = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const u = unit53();
      upper[i] = u < 0 ? u * 0.5 - 0.5 : u * 0.5 + 0.5;
    }
    sets.push({ name: 'upper', values: upper });
  }
  return sets;
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
  // Each edge exponent with a value that reaches a subnormal, a normal and an overflow of the
  // format: its smallest subnormal and its largest finite value among them.
  const edgeN =
    format === 'f32'
      ? [0, 1, -1, 23, -23, 127, 128, -126, -149, -150, 276, 277, -277, -278]
      : [0, 1, -1, 52, -52, 1023, 1024, -1022, -1074, -1075, 2046, 2047, -2098, -2099];
  const edgeX =
    format === 'f32'
      ? [1, -1, 0.5, 1.5, 1.401298464324817e-45, 3.4028234663852886e38, 0, Infinity, NaN, 3]
      : [1, -1, 0.5, 1.5, 4.9e-324, 1.7976931348623157e308, 0, Infinity, NaN, 3];
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

/** The routines of the family `invtrig`, as `LIBM` of `src/core/cpu-runtime.ts` holds them. */
export interface InvtrigRoutines {
  readonly asinF64: (x: number) => number;
  readonly acosF64: (x: number) => number;
  readonly atanF64: (x: number) => number;
  readonly atan2F64: (y: number, x: number) => number;
}

/** The edge operands of `asin`, `acos` and `atan`, past the ones every function takes: each
 *  threshold of a routine, with its neighbour below and its negative. */
const INVTRIG_EDGES = {
  f32: [
    // 0.5 and 0.975, where asin and acos change their path; 2^-26 and 2^-57.
    0x3effffff, 0x3f000000, 0xbf000000, 0x3f799999, 0x3f79999a, 0x327fffff, 0x32800000, 0x23000000,
    0x23000001,
    // 7/16, 11/16, 19/16 and 39/16, where atan changes its interval; 2^-27 and 2^66.
    0x3edfffff, 0x3ee00000, 0x3f2fffff, 0x3f300000, 0x3f97ffff, 0x3f980000, 0x401bffff, 0x401c0000,
    0xc01c0000, 0x31ffffff, 0x32000000, 0x607fffff, 0x60800000,
  ],
  f64: [
    [0x3fdfffff, 0xffffffff],
    [0x3fe00000, 0x00000000],
    [0xbfe00000, 0x00000000],
    [0x3fef3332, 0xffffffff],
    [0x3fef3333, 0x00000000],
    [0xbfef3333, 0x00000000],
    [0x3e4fffff, 0xffffffff],
    [0x3e500000, 0x00000000],
    [0x3c600000, 0x00000000],
    [0x3c600000, 0x00000001],
    [0xbfefffff, 0xffffffff],
    [0x3fdbffff, 0xffffffff],
    [0x3fdc0000, 0x00000000],
    [0x3fe5ffff, 0xffffffff],
    [0x3fe60000, 0x00000000],
    [0x3ff2ffff, 0xffffffff],
    [0x3ff30000, 0x00000000],
    [0x40037fff, 0xffffffff],
    [0x40038000, 0x00000000],
    [0xc0038000, 0x00000000],
    [0x3e3fffff, 0xffffffff],
    [0x3e400000, 0x00000000],
    [0x440fffff, 0xffffffff],
    [0x44100000, 0x00000000],
    [0xc4100000, 0x00000000],
  ],
} as const;

/** The operands of a special pair of `atan2`: the zeros, the infinities, a NaN, 1, the smallest
 *  subnormal, the largest finite value, and values whose quotients meet 2^60 and 2^-60. */
const ATAN2_SPECIAL_F64: readonly number[] = [
  0,
  -0,
  1,
  -1,
  Infinity,
  -Infinity,
  NaN,
  5e-324,
  -5e-324,
  1.7976931348623157e308,
  -1.7976931348623157e308,
  2.2250738585072014e-308,
  0.5,
  3,
  1152921504606846976,
  2305843009213693952,
  4611686018427387904,
  8.673617379884035e-19,
  4.336808689942018e-19,
  1e-200,
  1e200,
];
const ATAN2_SPECIAL_F32: readonly number[] = [
  0,
  -0,
  1,
  -1,
  Infinity,
  -Infinity,
  NaN,
  1.401298464324817e-45,
  -1.401298464324817e-45,
  3.4028234663852886e38,
  -3.4028234663852886e38,
  1.1754943508222875e-38,
  0.5,
  3,
  1152921504606846976,
  2305843009213693952,
  8.673617379884035e-19,
  1e-20,
  1e20,
];

/** The sets of `atan2`. The first operand is y and the second is x. The sets are: every pair
 *  of the special operands; every bit pattern; the unit square, which holds each quadrant; a
 *  quotient of each size, from 2^-70 to 2^70, which spans the two thresholds of the routine;
 *  and tiny operands, subnormal ones among them. */
function atan2Sets(format: 'f32' | 'f64', count: number): LibmCaseSet[] {
  const next = mulberry32(LIBM_GATE_SEED);
  const make = (n: number): Float32Array | Float64Array =>
    format === 'f32' ? new Float32Array(n) : new Float64Array(n);
  const special = format === 'f32' ? ATAN2_SPECIAL_F32 : ATAN2_SPECIAL_F64;
  const ey = make(special.length * special.length);
  const ex = make(special.length * special.length);
  for (const [i, y] of special.entries()) {
    for (const [j, x] of special.entries()) {
      ey[i * special.length + j] = y;
      ex[i * special.length + j] = x;
    }
  }
  const pattern = (): number => (format === 'f32' ? f32OfBits(next()) : f64OfWords(next(), next()));
  // A value in [-1, 1) with the bits of the format, exact in every engine.
  const unit = (): number =>
    format === 'f32'
      ? (next() | 0) / 2147483648
      : ((next() | 0) * 2097152 + (next() >>> 11)) / 4503599627370496;
  const by = make(count);
  const bx = make(count);
  const sy = make(count);
  const sx = make(count);
  const ry = make(count);
  const rx = make(count);
  const ty = make(count);
  const tx = make(count);
  // The words of a tiny operand: an exponent field of 0 to 3 for an f64, and the same for an
  // f32, so half of them are subnormal.
  const tiny = (): number =>
    format === 'f32' ? f32OfBits(next() & 0x81ffffff) : f64OfWords(next() & 0x803fffff, next());
  for (let i = 0; i < count; i++) {
    by[i] = pattern();
    bx[i] = pattern();
    sy[i] = unit();
    sx[i] = unit();
    // x in [-2, 2) less (-1, 1), and y = x * u * 2^k. The power of two is made by its words. A
    // multiplication by it is exact, and the product by u rounds once, the same way in every
    // engine.
    const x = unit() + (next() & 1 ? 1 : -1);
    const k = (next() % 141) - 70;
    rx[i] = x;
    ry[i] = x * unit() * f64OfWords((1023 + k) << 20, 0);
    ty[i] = tiny();
    tx[i] = tiny();
  }
  return [
    { name: 'edges', values: ey, second: ex },
    { name: 'bits', values: by, second: bx },
    { name: 'square', values: sy, second: sx },
    { name: 'ratio', values: ry, second: rx },
    { name: 'tiny', values: ty, second: tx },
  ];
}

/** The cases of the family `invtrig` over the routines `libm`. */
export function invtrigCases(libm: InvtrigRoutines): LibmCase[] {
  const fr = Math.fround;
  // asin and acos take [-1, 1]; atan takes every value, and its intervals end at 39/16.
  const unary: readonly (readonly [string, (x: number) => number, Shape])[] = [
    [
      'asin',
      libm.asinF64,
      { span: 1, positive: false, unit: true, upper: true, edges: INVTRIG_EDGES },
    ],
    [
      'acos',
      libm.acosF64,
      { span: 1, positive: false, unit: true, upper: true, edges: INVTRIG_EDGES },
    ],
    ['atan', libm.atanF64, { span: 40, positive: false, edges: INVTRIG_EDGES }],
  ];
  const cases: LibmCase[] = [];
  for (const [name, f, shape] of unary) {
    cases.push({
      routine: `${name}F32`,
      format: 'f32',
      f: (x) => fr(f(fr(x))),
      sets: (count = LIBM_GATE_COUNT) => unarySets('f32', shape, count),
    });
    cases.push({
      routine: `${name}F64`,
      format: 'f64',
      f: (x) => f(x),
      sets: (count = LIBM_GATE_COUNT) => unarySets('f64', shape, count),
    });
  }
  cases.push({
    routine: 'atan2F32',
    format: 'f32',
    f: (y, x) => fr(libm.atan2F64(fr(y), fr(x))),
    sets: (count = LIBM_GATE_COUNT) => atan2Sets('f32', count),
  });
  cases.push({
    routine: 'atan2F64',
    format: 'f64',
    f: (y, x) => libm.atan2F64(y, x),
    sets: (count = LIBM_GATE_COUNT) => atan2Sets('f64', count),
  });
  return cases;
}

/** The routines of the hyperbolic functions, as `LIBM` of `src/core/cpu-runtime.ts` holds
 *  them. */
export interface HyperRoutines {
  readonly sinhF64: (x: number) => number;
  readonly coshF64: (x: number) => number;
  readonly tanhF64: (x: number) => number;
  readonly asinhF64: (x: number) => number;
  readonly acoshF64: (x: number) => number;
  readonly atanhF64: (x: number) => number;
}

/** Where a hyperbolic function's operands are: every value, at least 1 (`acosh`) or below 1
 *  in magnitude (`atanh`). A set of every bit pattern is drawn from that domain, so that no
 *  set is half NaN. */
type HyperDomain = 'all' | 'atLeastOne' | 'belowOne';

/** The edge operands of the hyperbolic functions, as `f64` word pairs: each threshold of a
 *  routine with its neighbour below. */
const HYPER_EDGES_F64: readonly (readonly [number, number])[] = [
  // 2^-28, below which the odd functions return x and cosh 1.
  [0x3e2fffff, 0xffffffff],
  [0x3e300000, 0x00000000],
  [0xbe300000, 0x00000000],
  // ln 2 / 2, where the kernel of sinh, cosh and tanh starts to reduce.
  [0x3fd62e42, 0xfefa39ef],
  [0x3fd62e42, 0xfefa39f0],
  // 0.4142, where the logarithm's kernel starts to reduce; 0.5; 1; 2.
  [0x3fda8279, 0x99fcef31],
  [0x3fda8279, 0x99fcef32],
  [0x3fe00000, 0x00000000],
  [0x3fefffff, 0xffffffff],
  [0x3ff00000, 0x00000000],
  [0x3ff00000, 0x00000001],
  [0x40000000, 0x00000000],
  // 22, from which sinh and cosh are e^x / 2 and tanh is 1; 2^28, from which asinh and acosh
  // are ln(2 x).
  [0x4035ffff, 0xffffffff],
  [0x40360000, 0x00000000],
  [0xc0360000, 0x00000000],
  [0x41afffff, 0xffffffff],
  [0x41b00000, 0x00000000],
  // The last operand of sinh and cosh with a finite result, and the next one.
  [0x408633ce, 0x8fb9f87d],
  [0x408633ce, 0x8fb9f87e],
  [0xc08633ce, 0x8fb9f87e],
  // The largest finite value, the infinities and NaNs.
  [0x7fefffff, 0xffffffff],
  [0xffefffff, 0xffffffff],
  [0x7ff00000, 0x00000000],
  [0xfff00000, 0x00000000],
  [0x7ff80000, 0x00000000],
];

/** The same for an `f32` operand, as bit patterns. */
const HYPER_EDGES_F32: readonly number[] = [
  0x317fffff, 0x31800000, 0xb1800000, 0x3eb17217, 0x3eb17218, 0x3ed413cc, 0x3ed413cd, 0x3f000000,
  0x3f7fffff, 0x3f800000, 0x3f800001, 0x40000000, 0x41afffff, 0x41b00000, 0xc1b00000, 0x4d7fffff,
  0x4d800000,
  // The last operand of sinh and cosh with a finite f32 result (89.415985), and the next one.
  0x42b2d4fc, 0x42b2d4fd, 0xc2b2d4fd, 0x7f7fffff, 0xff7fffff, 0x7f800000, 0xff800000, 0x7fc00000,
];

/** The sets of a hyperbolic function: the edge values, every bit pattern of its domain, a
 *  uniform sample of [-span, span) folded into the domain, and a sample of each binade from
 *  2^-31 to 2 (added to 1 for `acosh`, and less than 1 for `atanh`). */
function hyperSets(
  format: 'f32' | 'f64',
  domain: HyperDomain,
  span: number,
  count: number,
): LibmCaseSet[] {
  const next = mulberry32(LIBM_GATE_SEED);
  const f32 = format === 'f32';
  const make = (n: number): Float32Array | Float64Array =>
    f32 ? new Float32Array(n) : new Float64Array(n);
  // A value in [-1, 1) with the bits of the format, exact in every engine.
  const unit = (): number =>
    f32 ? (next() | 0) / 2147483648 : ((next() | 0) * 2097152 + (next() >>> 11)) / 4503599627370496;
  // 2^e by its words, for e from -1022 to 1023.
  const power = (e: number): number => f64OfWords(((1023 + e) << 20) >>> 0, 0);
  const pattern = (): number => {
    if (f32) {
      const r = next();
      if (domain === 'atLeastOne')
        return f32OfBits((r & 0x007fffff) | ((127 + (next() % 128)) << 23));
      if (domain === 'belowOne')
        return f32OfBits(((r & 0x807fffff) | ((next() % 127) << 23)) >>> 0);
      return f32OfBits(r);
    }
    const hi = next();
    const lo = next();
    if (domain === 'atLeastOne')
      return f64OfWords((hi & 0x000fffff) | ((1023 + (next() % 1024)) << 20), lo);
    if (domain === 'belowOne')
      return f64OfWords(((hi & 0x800fffff) | ((next() % 1023) << 20)) >>> 0, lo);
    return f64OfWords(hi, lo);
  };
  const bits = make(count);
  const uniform = make(count);
  const binades = make(count);
  for (let i = 0; i < count; i++) {
    bits[i] = pattern();
    const u = unit();
    // |u| scaled into the domain: [1, 1 + span) for acosh, (-1, 1) for atanh.
    uniform[i] = domain === 'atLeastOne' ? 1 + Math.abs(u) * span : u * span;
    const m = unit() * power(-(next() % 32));
    binades[i] =
      domain === 'atLeastOne'
        ? 1 + Math.abs(m)
        : domain === 'belowOne'
          ? (m < 0 ? -1 - m : 1 - m) * 0.9990234375
          : m * 2;
  }
  const edges = f32
    ? Float32Array.from(HYPER_EDGES_F32, f32OfBits)
    : Float64Array.from(HYPER_EDGES_F64, ([hi, lo]) => f64OfWords(hi, lo));
  return [
    { name: 'edges', values: edges },
    { name: 'bits', values: bits },
    { name: 'span', values: uniform },
    { name: 'binades', values: binades },
  ];
}

/** The cases of the hyperbolic functions over the routines `libm`. */
export function hyperCases(libm: HyperRoutines): LibmCase[] {
  const fr = Math.fround;
  // The span of each uniform sample, for an f32 and for an f64 operand: past the overflow of
  // sinh and cosh, past the point where tanh is 1, and wide for the inverse functions.
  const unary: readonly (readonly [string, (x: number) => number, HyperDomain, number, number])[] =
    [
      ['sinh', libm.sinhF64, 'all', 96, 720],
      ['cosh', libm.coshF64, 'all', 96, 720],
      ['tanh', libm.tanhF64, 'all', 12, 24],
      ['asinh', libm.asinhF64, 'all', 1000, 1000],
      ['acosh', libm.acoshF64, 'atLeastOne', 1000, 1000],
      ['atanh', libm.atanhF64, 'belowOne', 1, 1],
    ];
  const cases: LibmCase[] = [];
  for (const [name, f, domain, s32, s64] of unary) {
    cases.push({
      routine: `${name}F32`,
      format: 'f32',
      f: (x) => fr(f(fr(x))),
      sets: (count = LIBM_GATE_COUNT) => hyperSets('f32', domain, s32, count),
    });
    cases.push({
      routine: `${name}F64`,
      format: 'f64',
      f: (x) => f(x),
      sets: (count = LIBM_GATE_COUNT) => hyperSets('f64', domain, s64, count),
    });
  }
  return cases;
}

/** The routine of `pow`, as `LIBM` of `src/core/cpu-runtime.ts` holds it. */
export interface PowRoutines {
  readonly powF64: (x: number, y: number) => number;
}

/** The operands of a special pair of `pow`, each paired with each: the zeros, ±1, the
 *  infinities, a NaN, small odd and even integers and halves, the smallest subnormal and the
 *  largest finite value, integers past 2^31 and 2^53, the neighbours of 1, and 1/3. */
const POW_SPECIAL_F64: readonly number[] = [
  0,
  -0,
  1,
  -1,
  2,
  -2,
  3,
  -3,
  0.5,
  -0.5,
  1.5,
  -1.5,
  Infinity,
  -Infinity,
  NaN,
  5e-324,
  -5e-324,
  1.7976931348623157e308,
  -1.7976931348623157e308,
  2147483649,
  -2147483649,
  9007199254740991,
  -9007199254740991,
  9007199254740994,
  18446744073709552000,
  36893488147419103000,
  1.0000000000000002,
  0.9999999999999999,
  0.3333333333333333,
  10,
  -10,
];
const POW_SPECIAL_F32: readonly number[] = [
  0,
  -0,
  1,
  -1,
  2,
  -2,
  3,
  -3,
  0.5,
  -0.5,
  1.5,
  -1.5,
  Infinity,
  -Infinity,
  NaN,
  1.401298464324817e-45,
  -1.401298464324817e-45,
  3.4028234663852886e38,
  -3.4028234663852886e38,
  16777215,
  -16777215,
  16777218,
  2147483648,
  18446744073709552000,
  1.0000001192092896,
  0.9999999403953552,
  0.3333333432674408,
  10,
  -10,
];

/** The sets of `pow`. The first operand is x and the second is y. The sets are: every pair of
 *  the special operands; every bit pattern of a positive x and of y; x in (0, 100) with y in (-300, 300); x near 1
 *  with a large y; a negative x with an integer y; and x of every binade with y about
 *  1024 / its exponent, so that the results span the format, past its overflow and into its
 *  subnormal range. Each operand is made by operations that round once, the same way in every
 *  engine. */
function powSets(format: 'f32' | 'f64', count: number): LibmCaseSet[] {
  const next = mulberry32(LIBM_GATE_SEED);
  const f32 = format === 'f32';
  const make = (n: number): Float32Array | Float64Array =>
    f32 ? new Float32Array(n) : new Float64Array(n);
  const special = f32 ? POW_SPECIAL_F32 : POW_SPECIAL_F64;
  const ex = make(special.length * special.length);
  const ey = make(special.length * special.length);
  for (const [i, x] of special.entries()) {
    for (const [j, y] of special.entries()) {
      ex[i * special.length + j] = x;
      ey[i * special.length + j] = y;
    }
  }
  // A bit pattern; `mask` clears the sign bit of x, since a negative x with a y that is no
  // integer gives a NaN, and the set `negint` holds a negative x.
  const pattern = (mask: number): number =>
    f32 ? f32OfBits(next() & mask) : f64OfWords(next() & mask, next());
  // A value in [-1, 1) with the bits of the format, exact in every engine.
  const unit = (): number =>
    f32 ? (next() | 0) / 2147483648 : ((next() | 0) * 2097152 + (next() >>> 11)) / 4503599627370496;
  // 2^e by its words, for e from -1022 to 1023.
  const power = (e: number): number => f64OfWords(((1023 + e) << 20) >>> 0, 0);
  // The binades of the format, the subnormal ones taken as the smallest normal one.
  const [emin, emax] = f32 ? [-149, 127] : [-1074, 1023];
  const bx = make(count);
  const by = make(count);
  const ux = make(count);
  const uy = make(count);
  const nx = make(count);
  const ny = make(count);
  const ix = make(count);
  const iy = make(count);
  const sx = make(count);
  const sy = make(count);
  for (let i = 0; i < count; i++) {
    bx[i] = pattern(0x7fffffff);
    by[i] = pattern(0xffffffff);
    ux[i] = Math.abs(unit()) * 100;
    uy[i] = unit() * 300;
    // x = 1 + u 2^-k for k from 1 to 52 (23 for an f32), and y = v 2^(k + 9).
    const k = 1 + (next() % (f32 ? 23 : 52));
    nx[i] = 1 + unit() * power(-k);
    ny[i] = unit() * power(k + 9);
    // A negative x of 2^-8 to 2^8 with an integer y of -100 to 100.
    ix[i] = -(1 + Math.abs(unit())) * power((next() % 17) - 8);
    iy[i] = (next() % 201) - 100;
    // x = (1 + |u|) 2^e and y = v 1024 / e for an f64 (128 / e for an f32).
    const e = emin + (next() % (emax - emin + 1)) || 1;
    sx[i] = (1 + Math.abs(unit())) * power(Math.max(e, -1022)) * (e < -1022 ? power(e + 1022) : 1);
    sy[i] = (unit() * (f32 ? 128 : 1024)) / e;
  }
  return [
    { name: 'edges', values: ex, second: ey },
    { name: 'bits', values: bx, second: by },
    { name: 'unit', values: ux, second: uy },
    { name: 'near1', values: nx, second: ny },
    { name: 'negint', values: ix, second: iy },
    { name: 'scale', values: sx, second: sy },
  ];
}

/** The cases of `pow` over the routine `libm`. */
export function powCases(libm: PowRoutines): LibmCase[] {
  const fr = Math.fround;
  return [
    {
      routine: 'powF32',
      format: 'f32',
      f: (x, y) => fr(libm.powF64(fr(x), fr(y))),
      sets: (count = LIBM_GATE_COUNT) => powSets('f32', count),
    },
    {
      routine: 'powF64',
      format: 'f64',
      f: (x, y) => libm.powF64(x, y),
      sets: (count = LIBM_GATE_COUNT) => powSets('f64', count),
    },
  ];
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
