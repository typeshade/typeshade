import { f32OfBits, f64OfWords } from '../libm-reference.js';
import { LIBM_GATE_COUNT, LIBM_GATE_SEED, mulberry32 } from '../libm-gate.js';
import type { LibmCaseSet, LibmCase } from './types.js';
import { unarySets, type Shape } from './unary-sets.js';

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
