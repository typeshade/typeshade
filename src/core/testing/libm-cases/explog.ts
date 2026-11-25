import { f32OfBits, f64OfWords } from '../libm-reference.js';
import { LIBM_GATE_COUNT, LIBM_GATE_SEED, mulberry32 } from '../libm-gate.js';
import type { LibmCaseSet, LibmCase } from './types.js';
import { unarySets, type Shape } from './unary-sets.js';

export interface ExplogRoutines {
  readonly expF64: (x: number) => number;
  readonly exp2F64: (x: number) => number;
  readonly logF64: (x: number) => number;
  readonly log2F64: (x: number) => number;
  readonly ldexpF64: (x: number, n: number) => number;
}

function ldexpSets(format: 'f32' | 'f64', count: number): LibmCaseSet[] {
  const next = mulberry32(LIBM_GATE_SEED);
  const width = format === 'f32' ? 600 : 4400;
  const values = format === 'f32' ? new Float32Array(count) : new Float64Array(count);
  const second = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    values[i] = format === 'f32' ? f32OfBits(next()) : f64OfWords(next(), next());
    second[i] = (next() % width) - width / 2;
  }
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

export function explogCases(libm: ExplogRoutines): LibmCase[] {
  const fr = Math.fround;
  const unary: readonly (readonly [string, (x: number) => number, Shape, Shape])[] = [
    ['exp', libm.expF64, { span: 110, positive: false }, { span: 750, positive: false }],
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
