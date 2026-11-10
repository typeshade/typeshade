// The libm's test (change 0042, milestone 1a): sin, cos and tan, for an f32 and an f64 operand.
//
// It holds five things. The baked JavaScript form is the one the source gives. Every constant
// derived from pi is the one a BigInt computation gives. The interpreter that walks the libm's
// IR and the baked JavaScript form give the same bits (form against form). The JavaScript form
// gives, in this engine, the results whose hashes `trig.gate.json` holds (engine against
// engine: `scripts/libm-arm.ts` holds the same file under Bun). Each routine's error is under
// 1 ULP on a sample, against an exact BigInt reference (decision N9). An f32 operand has one
// answer on every CPU path: the f64 routine's result rounded once (the owner's decision of
// 2026-11-10).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bakeLibm, libmGenerated, libmSource } from '../../../scripts/bake-libm.js';
import { compileLibmSource } from '../../compiler/ts/libm-source.js';
import { compile } from '../../compiler/ts/compile.js';
import { compileModuleJs } from '../cpu-codegen.js';
import { BUILTINS, COMPONENTWISE, LIBM } from '../cpu-runtime.js';
import { compileModule } from '../oracle.js';
import type { ConstDecl, Expr } from '../ir/nodes.js';
import {
  LIBM_GATE_COUNT,
  LIBM_ROUTINES,
  libmFunctions,
  libmGateRows,
  libmInputs,
  littleEndianBytes,
  libmResults,
  mulberry32,
  type LibmGateFile,
  type LibmRoutine,
} from '../testing/libm-gate.js';
import {
  F32_FORMAT,
  F64_FORMAT,
  exactTan,
  exactTrig,
  exactValue,
  f32OfBits,
  f64OfWords,
  piFixed,
  ulpError,
  wordsOf,
  type Exact,
} from '../testing/libm-reference.js';
import { withEngineMathRefused } from '../testing/engine-math.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const LIBM_SOURCE = libmSource('trig');
const LIBM_GENERATED = libmGenerated('trig');
const source = readFileSync(join(ROOT, LIBM_SOURCE), 'utf8');
const compiled = compileLibmSource(source, LIBM_SOURCE);
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
/** sin, cos and tan as the gates measure them: for an f64 operand, and for an f32 operand. */
const TRIG = libmFunctions(LIBM);
type Trig = Parameters<typeof libmFunctions>[0];

describe('the libm source and its baked JavaScript form', () => {
  it('compiles with no diagnostic', () => {
    expect(compiled.diagnostics).toEqual([]);
  });

  it('is baked: trig.generated.ts is what scripts/bake-libm.ts writes from the source', () => {
    expect(readFileSync(join(ROOT, LIBM_GENERATED), 'utf8')).toBe(bakeLibm(source, 'trig'));
  });

  it('builds no code at run time: the baked form has no Function constructor and no eval', () => {
    const text = readFileSync(join(ROOT, LIBM_GENERATED), 'utf8');
    expect(text).not.toMatch(/\bFunction\b|\beval\b/);
    // The scan can see one: the same pattern finds the constructor in a line that has it.
    expect('new Function("x", "return x")').toMatch(/\bFunction\b|\beval\b/);
  });
});

describe('the constants derived from pi', () => {
  const BITS = 1400n;
  const pi = piFixed(BITS);
  const halfPi = pi >> 1n;
  /** `n * 2^-shift` as an f64, exact when `n` is below 2^53. */
  const scaled = (n: bigint, shift: bigint): number => {
    let v = Number(n);
    for (let s = Number(shift); s > 0; s -= Math.min(s, 500)) v /= 2 ** Math.min(s, 500);
    return v;
  };
  const length = (v: bigint): bigint => BigInt(v.toString(2).length);
  /** A positive fixed-point value rounded to the nearest f64. */
  const rounded = (x: bigint): number => {
    const drop = length(x) - 53n;
    const n = (x >> drop) + ((x >> (drop - 1n)) & 1n);
    return scaled(n, BITS - drop);
  };
  /** The top `bits` bits of a positive fixed-point value, and what is left. */
  const head = (x: bigint, bits: bigint): [number, bigint] => {
    const drop = length(x) - bits;
    return [scaled(x >> drop, BITS - drop), x - ((x >> drop) << drop)];
  };
  const constant = (name: string): ConstDecl => {
    const c = compiled.module.consts.find((d) => d.name === name);
    if (c === undefined) throw new Error(`the libm declares no constant ${name}`);
    return c;
  };
  const value = (name: string): number => constant(name).cpuValue as number;

  it('pi/2 in three pieces of 33 bits and the rest (P1, P2, P3, P3T)', () => {
    const [p1, r1] = head(halfPi, 33n);
    const [p2, r2] = head(r1, 33n);
    const [p3, r3] = head(r2, 33n);
    expect([value('P1'), value('P2'), value('P3'), value('P3T')]).toEqual([
      p1,
      p2,
      p3,
      rounded(r3),
    ]);
  });

  it('2/pi and pi/2 rounded, and the rest of pi/2 (INVPIO2, PIO2H, PIO2L)', () => {
    const one = 1n << BITS;
    expect(value('INVPIO2')).toBe(rounded((one * one) / halfPi));
    expect(value('PIO2H')).toBe(rounded(halfPi));
    expect(value('PIO2H')).toBe(Math.PI / 2);
    // PIO2H is below pi/2, so the rest is positive.
    const drop = length(halfPi) - 53n;
    const headBits = ((halfPi >> drop) + ((halfPi >> (drop - 1n)) & 1n)) << drop;
    expect(headBits < halfPi).toBe(true);
    expect(value('PIO2L')).toBe(rounded(halfPi - headBits));
  });

  it('2/pi in pieces of 24 bits, behind two zeros (TWO_OVER_PI)', () => {
    const one = 1n << BITS;
    const twoOverPi = (one * one * 2n) / pi;
    const expected = [0, 0];
    for (let i = 1n; i <= 50n; i++)
      expected.push(Number((twoOverPi >> (BITS - 24n * i)) & 0xffffffn));
    const table = constant('TWO_OVER_PI').valueExpr as Extract<Expr, { op: 'construct' }>;
    const pieces = table.args.map((a) => (a as Extract<Expr, { op: 'lit' }>).value);
    expect(pieces).toEqual(expected);
    // The first piece is fdlibm's: 0xA2F983.
    expect(expected[2]).toBe(0xa2f983);
  });

  it('the powers of two and the splitter', () => {
    const powers: Record<string, number> = {
      TWO24: 24,
      TWO48: 48,
      TWO72: 72,
      TWOM22: -22,
      TWOM24: -24,
      TWOM46: -46,
      TWOM48: -48,
      TWOM70: -70,
      TWOM72: -72,
      TWOM94: -94,
      TWOM118: -118,
      TWOM142: -142,
    };
    for (const [name, exponent] of Object.entries(powers)) {
      // A power of two has the fraction bits 0 and the exponent field 1023 + exponent.
      expect([name, value(name)]).toEqual([name, f64OfWords((1023 + exponent) << 20, 0)]);
    }
    expect(value('SPLIT')).toBe(134217729);
    expect(value('TOINT')).toBe(1.5 * 4503599627370496);
  });
});

describe('form against form: the interpreter on the libm IR and the baked JavaScript', () => {
  const interpreter = libmFunctions(
    compileModule(compiled.module, { precision: 'f32' }).fns as unknown as Trig,
  );
  // 40 000 seeded inputs of each set: the interpreter takes microseconds for one call.
  const COUNT = 40_000;

  for (const routine of LIBM_ROUTINES) {
    it(`${routine}: the same bits on every edge value and on ${String(COUNT)} inputs of each seeded set`, () => {
      let compared = 0;
      for (const set of libmInputs(routine, COUNT)) {
        const a = littleEndianBytes(libmResults(interpreter[routine], set.values));
        const b = littleEndianBytes(libmResults(TRIG[routine], set.values));
        expect([set.name, sha256(a.bytes), a.nans]).toEqual([set.name, sha256(b.bytes), b.nans]);
        compared += set.values.length;
      }
      expect(compared).toBeGreaterThan(2 * COUNT);
    });
  }

  it('sees a difference: one result with its last bit changed gives another hash', () => {
    const set = libmInputs('sinF64', 1000)[1]!;
    const good = libmResults(LIBM.sinF64, set.values);
    const bad = Float64Array.from(good);
    bad[500] = bad[500]! * (1 + 2 ** -52);
    expect(bad[500]).not.toBe(good[500]);
    expect(sha256(littleEndianBytes(bad).bytes)).not.toBe(sha256(littleEndianBytes(good).bytes));
  });

  it('the generated JavaScript of the libm module is the baked form, call for call', () => {
    // `compileModuleJs` builds the same factory with `new Function`; the baked one is its text.
    const fresh = libmFunctions(
      compileModuleJs(compiled.module, { precision: 'f32' }).fns as unknown as Trig,
    );
    for (const routine of LIBM_ROUTINES) {
      for (const set of libmInputs(routine, 2000)) {
        for (const x of set.values) expect(fresh[routine](x)).toBe(TRIG[routine](x));
      }
    }
  });
});

describe('engine against engine: trig.gate.json', () => {
  const file = JSON.parse(
    readFileSync(join(ROOT, 'src/core/libm/trig.gate.json'), 'utf8'),
  ) as LibmGateFile;

  it('holds a row for each set of each routine', () => {
    expect(file.rows.map((r) => `${r.routine} ${r.set} ${String(r.count)}`)).toEqual(
      LIBM_ROUTINES.flatMap((routine) =>
        libmInputs(routine, 1).map(
          (s) =>
            `${routine} ${s.name} ${String(s.name === 'edges' ? s.values.length : LIBM_GATE_COUNT)}`,
        ),
      ),
    );
  });

  it('this engine makes the inputs and the results that the file hashes', () => {
    expect(libmGateRows(TRIG, sha256)).toEqual(file.rows);
  });

  it('only a NaN or an infinite operand gives a NaN result', () => {
    const wrong: string[] = [];
    let finite = 0;
    for (const routine of LIBM_ROUTINES) {
      for (const set of libmInputs(routine, 20_000)) {
        for (const x of set.values) {
          if (Number.isFinite(x)) finite++;
          if (Number.isNaN(TRIG[routine](x)) === Number.isFinite(x))
            wrong.push(`${routine}(${String(x)})`);
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(finite).toBeGreaterThan(190_000);
  });
});

describe('the error is under 1 ULP (decision N9)', () => {
  // A sample of each kind of input, apart from the gate's sets: every bit pattern, the range
  // an application uses, the range of the first reduction, and every exponent of the second.
  const next = mulberry32(0x1a2b3c4d);
  const N = 4000;
  const uniform = (scale: number): number => ((next() | 0) / 2147483648) * scale;
  const f32Sample = [
    ...Array.from({ length: N }, () => f32OfBits(next())),
    ...Array.from({ length: N }, () => Math.fround(uniform(100))),
    ...Array.from({ length: N }, () => Math.fround(uniform(1e7))),
    // Near multiples of pi/2, and the edge of each reduction.
    ...[0x3fc90fdb, 0x40490fdb, 0x4016cbe4, 0x4b7f1e57, 0x5922aa80, 0x6a1976f1, 0x4a7fffff].map(
      f32OfBits,
    ),
    ...[0x4a800000, 0x7e7fffff, 0x7f7fffff, 0x3f490fda, 0x3f490fdb, 0x39800000, 1].map(f32OfBits),
  ];
  const f64Sample = [
    ...Array.from({ length: N }, () => f64OfWords(next(), next())),
    ...Array.from({ length: N }, () => uniform(100) + uniform(1e-7)),
    ...Array.from({ length: N }, () => uniform(1.7e6) + uniform(1e-3)),
    // Every exponent from 2^20 up, where the second reduction runs.
    ...Array.from({ length: N }, () =>
      f64OfWords((((1043 + (next() % 1004)) << 20) | (next() & 0x800fffff)) >>> 0, next()),
    ),
    // The f64 nearest a multiple of pi/2, and the edge of each reduction.
    ...[6381956970095103 * 2 ** 797, -6381956970095103 * 2 ** 797, 6381956970095103 / 2 ** 32],
    ...[1647099, 1647099.3, 1647100, 2 ** 52, 2 ** 53, 2 ** 54, 1e22, 1e300, Number.MAX_VALUE],
    ...[Math.PI, Math.PI / 2, Math.PI / 4, 0.7853981633974484, 2 ** -26, 2 ** -27, 5e-324],
  ];

  const worst = (routine: LibmRoutine, sample: readonly number[]): [number, number, number] => {
    const exact = (x: number): Exact =>
      routine.startsWith('tan')
        ? exactTan(x)
        : exactTrig(routine.startsWith('sin') ? 'sin' : 'cos', x);
    const format = routine.endsWith('F32') ? F32_FORMAT : F64_FORMAT;
    let max = 0;
    let at = 0;
    let measured = 0;
    for (const x of sample) {
      if (!Number.isFinite(x)) continue;
      const error = ulpError(TRIG[routine](x), exact(x), format);
      if (error === undefined) continue;
      measured++;
      if (Math.abs(error) > max) {
        max = Math.abs(error);
        at = x;
      }
    }
    return [max, at, measured];
  };

  for (const routine of LIBM_ROUTINES) {
    it(`${routine} on a sample`, () => {
      const [max, at, measured] = worst(routine, routine.endsWith('F32') ? f32Sample : f64Sample);
      expect(measured).toBeGreaterThan(2 * N);
      expect([at, max < 1]).toEqual([at, true]);
      // A measure that reads nothing reports 0. A sample of this size holds a result whose
      // rounding error is past a quarter of a unit.
      expect(max).toBeGreaterThan(0.25);
    });
  }

  it('the reference agrees with the engine on values it rounds correctly', () => {
    // sin(1) and cos(1) are 0.5 ULP or less from the engine's value in V8 and JavaScriptCore.
    expect(Math.abs(ulpError(Math.sin(1), exactTrig('sin', 1), F64_FORMAT)!)).toBeLessThan(1);
    expect(Math.abs(ulpError(Math.cos(1), exactTrig('cos', 1), F64_FORMAT)!)).toBeLessThan(1);
    // And it reports a value that is one unit off as one unit off.
    const off = f64OfWords(0x3feaed54, 0x8f090cee + 1);
    expect(Math.abs(ulpError(off, exactTrig('sin', 1), F64_FORMAT)!)).toBeGreaterThan(0.5);
  });
});

describe('tan: the special values, the thresholds and the hard operands', () => {
  const same = (got: number, want: number): void => {
    expect(Object.is(got, want), `${String(got)} is not ${String(want)}`).toBe(true);
  };
  const error = (x: number): number => Math.abs(ulpError(LIBM.tanF64(x), exactTan(x), F64_FORMAT)!);
  /** The f64 that is `k` values after `x`, for a positive `x`. */
  const after = (x: number, k: number): number => {
    const [hi, lo] = wordsOf(x);
    const v = BigInt(hi) * 4294967296n + BigInt(lo) + BigInt(k);
    return f64OfWords(Number(v >> 32n), Number(v & 0xffffffffn));
  };

  it('the values ECMA-262 and IEEE 754 fix', () => {
    same(LIBM.tanF64(0), 0);
    same(LIBM.tanF64(-0), -0);
    same(LIBM.tanF64(NaN), NaN);
    same(LIBM.tanF64(Infinity), NaN);
    same(LIBM.tanF64(-Infinity), NaN);
    // tan(x) is x below 2^-27, down to the smallest subnormal, with its sign.
    for (const x of [5e-324, -5e-324, 2.2250738585072014e-308, 2 ** -28, -(2 ** -28)]) {
      same(LIBM.tanF64(x), x);
    }
    // tan is odd, bit for bit.
    for (const x of [0.3, 0.7, 1, 1.5707963267948966, 100, 1e10, 1e22, 1e300]) {
      same(LIBM.tanF64(-x), -LIBM.tanF64(x));
    }
  });

  it('the coefficients of the kernel are those of fdlibm, word for word', () => {
    const words: readonly (readonly [number, number])[] = [
      [0x3fd55555, 0x55555563],
      [0x3fc11111, 0x1110fe7a],
      [0x3faba1ba, 0x1bb341fe],
      [0x3f9664f4, 0x8406d637],
      [0x3f8226e3, 0xe96e8493],
      [0x3f6d6d22, 0xc9560328],
      [0x3f57dbc8, 0xfee08315],
      [0x3f4344d8, 0xf2f26501],
      [0x3f3026f7, 0x1a8d1068],
      [0x3f147e88, 0xa03792a6],
      [0x3f12b80f, 0x32f0a7e9],
      [0xbef375cb, 0xdb605373],
      [0x3efb2a70, 0x74bf7ad4],
    ];
    for (const [i, [hi, lo]] of words.entries()) {
      const c = compiled.module.consts.find((d) => d.name === `T${String(i)}`)!;
      expect([i, wordsOf(c.cpuValue as number)]).toEqual([i, [hi, lo]]);
    }
  });

  it('near an odd multiple of pi/2, where the result is large, the error is under 1 ULP', () => {
    // pi/2 rounded, its neighbours, and the f64 nearest a multiple of pi/2, which is odd.
    const hard = 6381956970095103 * 2 ** 797;
    for (const x of [
      1.5707963267948966, 1.5707963267948968, 1.5707963267948963, 4.71238898038469,
    ]) {
      expect([x, error(x) < 1]).toEqual([x, true]);
    }
    expect(Math.abs(LIBM.tanF64(1.5707963267948966))).toBeGreaterThan(1e16);
    expect(error(hard)).toBeLessThan(1);
    expect(error(-hard)).toBeLessThan(1);
    expect(Math.abs(LIBM.tanF64(hard))).toBeGreaterThan(2 ** 60);
    // The odd multiples up to 2^20 * pi/2, each rounded, and four neighbours of each.
    let max = 0;
    for (let k = 1; k < 2_000_000; k += 4001) {
      for (const d of [-2, -1, 0, 1, 2])
        max = Math.max(max, error(after(k * 1.5707963267948966, d)));
    }
    expect(max).toBeLessThan(1);
    expect(max).toBeGreaterThan(0.25);
  });

  it('a huge operand: every exponent from 2^20 to the largest', () => {
    const next = mulberry32(0x7a17a17a);
    let max = 0;
    for (let e = 1043; e < 2047; e++) {
      for (let i = 0; i < 3; i++) {
        max = Math.max(max, error(f64OfWords(((e << 20) | (next() & 0x800fffff)) >>> 0, next())));
      }
    }
    expect(max).toBeLessThan(1);
    expect(error(Number.MAX_VALUE)).toBeLessThan(1);
  });

  it('at each threshold of the routine the error is under 1 ULP on both sides, and tan does not decrease', () => {
    // 2^-27 (tan(x) is x below it), 0.6744 (the kernel runs on pi/4 - |x| from it), pi/4 (the
    // first reduction starts past it) and 2^20 * pi/2 (the second reduction starts at it).
    const thresholds = [
      f64OfWords(0x3e400000, 0),
      f64OfWords(0x3fe59428, 0),
      f64OfWords(0x3fe921fc, 0),
      f64OfWords(0x413921fb, 0),
    ];
    for (const t of thresholds) {
      let previous = LIBM.tanF64(after(t, -513));
      for (let k = -512; k <= 512; k++) {
        const x = after(t, k);
        const r = LIBM.tanF64(x);
        expect([x, error(x) < 1]).toEqual([x, true]);
        // The last threshold is far from a pole only by chance; tan increases between poles.
        if (t < 1e6) expect([x, r >= previous]).toEqual([x, true]);
        previous = r;
      }
    }
  });
});

describe('tan: the operands of the largest errors that a sample has measured', () => {
  const error = (x: number): number => Math.abs(ulpError(LIBM.tanF64(x), exactTan(x), F64_FORMAT)!);

  it('0.9023 ULP for a huge operand, and 0.8839 for one of the first reduction', () => {
    // The first is from the independent review of #1207 (96,000,000 operands), the second from
    // this pull request's sweep (21,000,000 operands). Each bound is just above the measure.
    for (const [x, bound] of [
      [2.926865656139087e106, 0.91],
      [-11.896597503998837, 0.89],
    ] as const) {
      expect([x, error(x) < bound, error(x) > bound - 0.02]).toEqual([x, true, true]);
    }
    expect(LIBM.tanF64(2.926865656139087e106)).toBe(0.7873026738547275);
  });

  it('the kernel just below its switch at 0.6744: 0.9277 ULP for one reduced argument', () => {
    // The review measured the kernel on 96,000,000 pairs of a head and a tail. This pair is its
    // largest error. The kernel is no export: the interpreter of the source's module gives it.
    const ktan = (
      compileModule(compiled.module, { precision: 'f32' }).fns as unknown as Record<
        string,
        (x: number, y: number, odd: boolean) => number
      >
    )['ktan']!;
    const x = 0.6707954031500757;
    const y = -3.906014701318836e-17;
    // tan(x + y) is tan(x) + y (1 + tan(x)^2), to far below a unit: y^2 is below 2^-108.
    const t = exactTan(x);
    const tail = exactValue(y);
    const one = 1n << t.scale;
    const slope = one + ((t.num * t.num) >> t.scale);
    const exact = {
      num: t.num + (((tail.num << (t.scale - tail.scale)) * slope) >> t.scale),
      scale: t.scale,
    };
    const measured = Math.abs(ulpError(ktan(x, y, false), exact, F64_FORMAT)!);
    expect(measured).toBeLessThan(0.93);
    expect(measured).toBeGreaterThan(0.92);
  });
});

describe('the CPU tier calls the libm for sin, cos and tan', () => {
  /** The functions of the engine's `Math` that no CPU path of this family may call. */
  const ENGINE = ['sin', 'cos', 'tan'] as const;
  const program = compile(`"use typeshade";
export function single(x: f32): f32 { return sin(x) - cos(x); }
export function double(x: f64): f64 { return Math.sin(x) - Math.cos(x); }
export function lanes(v: vec3): vec3 { return sin(v) + cos(v.zyx); }
export function tangent(x: f32): f32 { return tan(x); }
`);
  const x = 1e10;
  const fr = Math.fround;

  it('compiles', () => {
    expect(program.diagnostics).toEqual([]);
  });

  it("in 'f32' precision an f32 operand takes the f64 routine, rounded once", () => {
    for (const build of [compileModule, compileModuleJs])
      withEngineMathRefused(ENGINE, () => {
        const fns = build(program.module, { precision: 'f32' }).fns as Record<
          string,
          (...a: unknown[]) => unknown
        >;
        expect(fns['single']!(x)).toBe(fr(TRIG.sinF32(x) - TRIG.cosF32(x)));
        expect(fns['double']!(x)).toBe(LIBM.sinF64(x) - LIBM.cosF64(x));
        expect(fns['lanes']!([1, 2, 3])).toEqual(
          [1, 2, 3].map((c, i) => fr(TRIG.sinF32(c) + TRIG.cosF32(3 - i))),
        );
        expect(fns['tangent']!(x)).toBe(TRIG.tanF32(x));
      });
  });

  it("in 'f64' precision every operand takes the f64 routine", () => {
    for (const build of [compileModule, compileModuleJs])
      withEngineMathRefused(ENGINE, () => {
        const fns = build(program.module, { precision: 'f64' }).fns as Record<
          string,
          (...a: unknown[]) => unknown
        >;
        expect(fns['single']!(x)).toBe(LIBM.sinF64(x) - LIBM.cosF64(x));
        expect(fns['double']!(x)).toBe(LIBM.sinF64(x) - LIBM.cosF64(x));
        expect(fns['tangent']!(x)).toBe(LIBM.tanF64(x));
      });
  });

  it('the tables hold the routines, not the engine Math', () => {
    expect(COMPONENTWISE.sin.lane).not.toBe(Math.sin);
    expect(COMPONENTWISE.cos.lane).not.toBe(Math.cos);
    expect(COMPONENTWISE.tan.lane).not.toBe(Math.tan);
    expect(BUILTINS['tan']!([1, 2])).toEqual([LIBM.tanF64(1), LIBM.tanF64(2)]);
    // The f64 nearest a multiple of pi/2. The libm is under 1 ULP from the exact value there.
    // An engine's `Math.cos` need not be: on Bun 1.4.4 it is 7.95 ULP off. The table's entry is
    // the libm's routine, on a scalar and on a vector.
    const hard = 6381956970095103 * 2 ** 797;
    expect(BUILTINS['cos']!(hard)).toBe(LIBM.cosF64(hard));
    expect(BUILTINS['sin']!([1, hard])).toEqual([LIBM.sinF64(1), LIBM.sinF64(hard)]);
    expect(Math.abs(ulpError(LIBM.cosF64(hard), exactTrig('cos', hard), F64_FORMAT)!)).toBeLessThan(
      1,
    );
    // No id of an f32 routine exists.
    expect(Object.keys(BUILTINS).filter((k) => /F32$/.test(k) && k.startsWith('__'))).toEqual([]);
  });
});

describe('an f32 operand has one answer on every CPU path', () => {
  // 0.5251128077507019 is an f32. A routine of its own for an f32 operand gave another last
  // bit for it than the f64 routine rounded once, so a module constant and a call differed.
  const X = 0.5251128077507019;
  const program = compile(`"use typeshade";
const X: f32 = ${String(X)};
const S: f32 = sin(X);
const C: f32 = cos(X);
export function moduleConstant(): vec2 { return vec2(S, C); }
export function localConstant(): vec2 {
  const s: f32 = sin(X);
  const c: f32 = cos(X);
  return vec2(s, c);
}
export function literal(): vec2 { return vec2(sin(${String(X)}), cos(${String(X)})); }
export function call(x: f32): vec2 { return vec2(sin(x), cos(x)); }
export function lanes(v: vec2): vec2 { return sin(v); }
export function bound(): u32 {
  let n: u32 = 0;
  for (let i: u32 = 0; i < u32(sin(X) * 16.0); i++) { n++; }
  return n;
}
`);
  const want = [TRIG.sinF32(X), TRIG.cosF32(X)];

  it('the operand is an f32, and the program compiles', () => {
    expect(Math.fround(X)).toBe(X);
    expect(program.diagnostics).toEqual([]);
  });

  for (const [engine, build] of [
    ['the interpreter', compileModule],
    ['the generated JavaScript', compileModuleJs],
  ] as const) {
    it(`${engine}: a module constant, a local constant, a literal operand and a call agree`, () => {
      const fns = build(program.module, { precision: 'f32' }).fns as Record<
        string,
        (...a: unknown[]) => unknown
      >;
      expect(fns['moduleConstant']!()).toEqual(want);
      expect(fns['localConstant']!()).toEqual(want);
      expect(fns['literal']!()).toEqual(want);
      expect(fns['call']!(X)).toEqual(want);
      expect(fns['lanes']!([X, X])).toEqual([want[0], want[0]]);
      // The loop's bound, which the front end folds with the same table (`loop-bound.ts`).
      expect(fns['bound']!()).toBe(Math.trunc(Math.fround(want[0]! * 16)));
    });
  }

  it('the compile-time fold reads the routine the run-time call reads', () => {
    // `foldConstNumber` of `loop-bound.ts` and the f64 constant fold call `BUILTINS`.
    expect(Math.fround(BUILTINS['sin']!(X) as number)).toBe(want[0]);
    expect(Math.fround(BUILTINS['cos']!(X) as number)).toBe(want[1]);
  });
});
