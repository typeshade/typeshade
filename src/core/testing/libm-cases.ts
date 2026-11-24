import { f32OfBits, f64OfWords } from './libm-reference.js';
import { LIBM_GATE_COUNT, LIBM_GATE_SEED, littleEndianBytes, mulberry32 } from './libm-gate.js';
import type { LibmCaseSet, LibmCase } from './libm-cases/types.js';
import { unarySets, type Shape } from './libm-cases/unary-sets.js';
export { explogCases } from './libm-cases/explog.js';
export type { ExplogRoutines } from './libm-cases/explog.js';
export type { LibmCaseSet, LibmCase } from './libm-cases/types.js';

export interface InvtrigRoutines {
  readonly asinF64: (x: number) => number;
  readonly acosF64: (x: number) => number;
  readonly atanF64: (x: number) => number;
  readonly atan2F64: (y: number, x: number) => number;
}

const INVTRIG_EDGES = {
  f32: [
    0x3effffff, 0x3f000000, 0xbf000000, 0x3f799999, 0x3f79999a, 0x327fffff, 0x32800000, 0x23000000,
    0x23000001, 0x3edfffff, 0x3ee00000, 0x3f2fffff, 0x3f300000, 0x3f97ffff, 0x3f980000, 0x401bffff,
    0x401c0000, 0xc01c0000, 0x31ffffff, 0x32000000, 0x607fffff, 0x60800000,
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
  const tiny = (): number =>
    format === 'f32' ? f32OfBits(next() & 0x81ffffff) : f64OfWords(next() & 0x803fffff, next());
  for (let i = 0; i < count; i++) {
    by[i] = pattern();
    bx[i] = pattern();
    sy[i] = unit();
    sx[i] = unit();
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

export function invtrigCases(libm: InvtrigRoutines): LibmCase[] {
  const fr = Math.fround;
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

export interface HyperRoutines {
  readonly sinhF64: (x: number) => number;
  readonly coshF64: (x: number) => number;
  readonly tanhF64: (x: number) => number;
  readonly asinhF64: (x: number) => number;
  readonly acoshF64: (x: number) => number;
  readonly atanhF64: (x: number) => number;
}

type HyperDomain = 'all' | 'atLeastOne' | 'belowOne';

const HYPER_EDGES_F64: readonly (readonly [number, number])[] = [
  [0x3e2fffff, 0xffffffff],
  [0x3e300000, 0x00000000],
  [0xbe300000, 0x00000000],
  [0x3fd62e42, 0xfefa39ef],
  [0x3fd62e42, 0xfefa39f0],
  [0x3fda8279, 0x99fcef31],
  [0x3fda8279, 0x99fcef32],
  [0x3fe00000, 0x00000000],
  [0x3fefffff, 0xffffffff],
  [0x3ff00000, 0x00000000],
  [0x3ff00000, 0x00000001],
  [0x40000000, 0x00000000],
  [0x4035ffff, 0xffffffff],
  [0x40360000, 0x00000000],
  [0xc0360000, 0x00000000],
  [0x41afffff, 0xffffffff],
  [0x41b00000, 0x00000000],
  [0x408633ce, 0x8fb9f87d],
  [0x408633ce, 0x8fb9f87e],
  [0xc08633ce, 0x8fb9f87e],
  [0x7fefffff, 0xffffffff],
  [0xffefffff, 0xffffffff],
  [0x7ff00000, 0x00000000],
  [0xfff00000, 0x00000000],
  [0x7ff80000, 0x00000000],
];

const HYPER_EDGES_F32: readonly number[] = [
  0x317fffff, 0x31800000, 0xb1800000, 0x3eb17217, 0x3eb17218, 0x3ed413cc, 0x3ed413cd, 0x3f000000,
  0x3f7fffff, 0x3f800000, 0x3f800001, 0x40000000, 0x41afffff, 0x41b00000, 0xc1b00000, 0x4d7fffff,
  0x4d800000, 0x42b2d4fc, 0x42b2d4fd, 0xc2b2d4fd, 0x7f7fffff, 0xff7fffff, 0x7f800000, 0xff800000,
  0x7fc00000,
];

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
  const unit = (): number =>
    f32 ? (next() | 0) / 2147483648 : ((next() | 0) * 2097152 + (next() >>> 11)) / 4503599627370496;
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

export function hyperCases(libm: HyperRoutines): LibmCase[] {
  const fr = Math.fround;
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

export interface PowRoutines {
  readonly powF64: (x: number, y: number) => number;
}

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
  const pattern = (mask: number): number =>
    f32 ? f32OfBits(next() & mask) : f64OfWords(next() & mask, next());
  const unit = (): number =>
    f32 ? (next() | 0) / 2147483648 : ((next() | 0) * 2097152 + (next() >>> 11)) / 4503599627370496;
  const power = (e: number): number => f64OfWords(((1023 + e) << 20) >>> 0, 0);
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
    const k = 1 + (next() % (f32 ? 23 : 52));
    nx[i] = 1 + unit() * power(-k);
    ny[i] = unit() * power(k + 9);
    ix[i] = -(1 + Math.abs(unit())) * power((next() % 17) - 8);
    iy[i] = (next() % 201) - 100;
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

export function caseResults(c: LibmCase, set: LibmCaseSet): Float32Array | Float64Array {
  const n = set.values.length;
  const out = c.format === 'f32' ? new Float32Array(n) : new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = c.f(set.values[i]!, set.second?.[i] ?? 0);
  return out;
}

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

export interface LibmCaseRow {
  readonly routine: string;
  readonly set: string;
  readonly count: number;
  readonly nanResults: number;
  readonly inputsSha256: string;
  readonly resultsSha256: string;
}

export interface LibmCaseFile {
  readonly seed: string;
  readonly generator: string;
  readonly nan: string;
  readonly rows: readonly LibmCaseRow[];
}

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
