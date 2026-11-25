import { f32OfBits, f64OfWords } from '../libm-reference.js';
import { LIBM_GATE_COUNT, LIBM_GATE_SEED, mulberry32 } from '../libm-gate.js';
import type { LibmCaseSet, LibmCase } from './types.js';

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
