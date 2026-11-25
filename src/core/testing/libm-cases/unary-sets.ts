import { f32OfBits, f64OfWords } from '../libm-reference.js';
import { LIBM_GATE_SEED, mulberry32 } from '../libm-gate.js';
import type { LibmCaseSet } from './types.js';

const EDGES_F64: readonly (readonly [number, number])[] = [
  [0x00000000, 0x00000000],
  [0x80000000, 0x00000000],
  [0x00000000, 0x00000001],
  [0x80000000, 0x00000001],
  [0x000fffff, 0xffffffff],
  [0x00100000, 0x00000000],
  [0x3fefffff, 0xffffffff],
  [0x3ff00000, 0x00000000],
  [0x3ff00000, 0x00000001],
  [0xbff00000, 0x00000000],
  [0x40000000, 0x00000000],
  [0x3fe00000, 0x00000000],
  [0x4005bf0a, 0x8b145769],
  [0x40240000, 0x00000000],
  [0x3e300000, 0x00000000],
  [0x3fd62e42, 0xfefa39ef],
  [0x3ff0a2b2, 0x3f3bab73],
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
  [0x3fe00000, 0x00000000],
  [0xc08ff000, 0x00000000],
  [0x40590000, 0x00000000],
  [0x3fe6a09e, 0x667f3bcd],
  [0x3ff6a09e, 0x667f3bcd],
  [0x7fefffff, 0xffffffff],
  [0xffefffff, 0xffffffff],
  [0x7ff00000, 0x00000000],
  [0xfff00000, 0x00000000],
  [0x7ff80000, 0x00000000],
  [0xfff80000, 0x00000000],
];

const EDGES_F32: readonly number[] = [
  0x00000000, 0x80000000, 0x00000001, 0x80000001, 0x007fffff, 0x00800000, 0x3f7fffff, 0x3f800000,
  0x3f800001, 0xbf800000, 0x40000000, 0x3f000000, 0x402df854, 0x41200000, 0x42b17217, 0x42b17218,
  0xc2cff1b4, 0xc2cff1b5, 0x42ffffff, 0x43000000, 0xc3150000, 0xc3160000, 0x3f3504f3, 0x3fb504f3,
  0x7f7fffff, 0xff7fffff, 0x7f800000, 0xff800000, 0x7fc00000, 0xffc00000,
];

export interface Shape {
  readonly span: number;
  readonly positive: boolean;
  readonly unit?: boolean;
  readonly upper?: boolean;
  readonly edges?: {
    readonly f32: readonly number[];
    readonly f64: readonly (readonly [number, number])[];
  };
}

export function unarySets(format: 'f32' | 'f64', shape: Shape, count: number): LibmCaseSet[] {
  const next = mulberry32(LIBM_GATE_SEED);
  const mask = shape.positive ? 0x7fffffff : 0xffffffff;
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
