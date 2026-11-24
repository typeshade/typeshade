import { f32OfBits, f64OfWords } from './libm-reference.js';
import { LIBM_GATE_COUNT, LIBM_GATE_SEED, littleEndianBytes, mulberry32 } from './libm-gate.js';
import type { LibmCaseSet, LibmCase } from './libm-cases/types.js';
export { powCases } from './libm-cases/pow.js';
export type { PowRoutines } from './libm-cases/pow.js';
export { invtrigCases } from './libm-cases/invtrig.js';
export type { InvtrigRoutines } from './libm-cases/invtrig.js';
export { explogCases } from './libm-cases/explog.js';
export type { ExplogRoutines } from './libm-cases/explog.js';
export type { LibmCaseSet, LibmCase } from './libm-cases/types.js';

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
