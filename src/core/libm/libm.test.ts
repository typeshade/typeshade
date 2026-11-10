// The libm's test (change 0042, milestone 1a): sin and cos, for f32 and for f64.
//
// It holds five things. The baked JavaScript form is the one the source gives. Every constant
// derived from pi is the one a BigInt computation gives. The interpreter that walks the libm's
// IR and the baked JavaScript form give the same bits (form against form). The JavaScript form
// gives, in this engine, the results whose hashes `trig.gate.json` holds (engine against
// engine: `scripts/libm-arm.ts` holds the same file under Bun). Each routine's error is under
// 1 ULP on a sample, against an exact BigInt reference (decision N9).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LIBM_GENERATED, LIBM_SOURCE, bakeLibm } from '../../../scripts/bake-libm.js';
import { compileLibmSource } from '../../compiler/ts/libm-source.js';
import { compile } from '../../compiler/ts/compile.js';
import { compileModuleJs } from '../cpu-codegen.js';
import { BUILTINS, COMPONENTWISE, LIBM_TRIG } from '../cpu-runtime.js';
import { compileModule } from '../oracle.js';
import type { ConstDecl, Expr } from '../ir/nodes.js';
import {
  LIBM_GATE_COUNT,
  LIBM_ROUTINES,
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
  exactTrig,
  f32OfBits,
  f64OfWords,
  piFixed,
  ulpError,
} from '../testing/libm-reference.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const source = readFileSync(join(ROOT, LIBM_SOURCE), 'utf8');
const compiled = compileLibmSource(source, LIBM_SOURCE);
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

describe('the libm source and its baked JavaScript form', () => {
  it('compiles with no diagnostic', () => {
    expect(compiled.diagnostics).toEqual([]);
  });

  it('is baked: trig.generated.ts is what scripts/bake-libm.ts writes from the source', () => {
    expect(readFileSync(join(ROOT, LIBM_GENERATED), 'utf8')).toBe(bakeLibm(source));
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

  it('pi/2 in a piece of 30 bits and the rest (F1, F1T)', () => {
    const [f1, r1] = head(halfPi, 30n);
    expect([value('F1'), value('F1T')]).toEqual([f1, rounded(r1)]);
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
  const interpreter = compileModule(compiled.module, { precision: 'f32' }).fns as unknown as Record<
    LibmRoutine,
    (x: number) => number
  >;
  // 40 000 seeded inputs of each set: the interpreter takes microseconds for one call.
  const COUNT = 40_000;

  for (const routine of LIBM_ROUTINES) {
    it(`${routine}: the same bits on every edge value and on ${String(COUNT)} inputs of each seeded set`, () => {
      let compared = 0;
      for (const set of libmInputs(routine, COUNT)) {
        const a = littleEndianBytes(libmResults(interpreter[routine], set.values));
        const b = littleEndianBytes(libmResults(LIBM_TRIG[routine], set.values));
        expect([set.name, sha256(a.bytes), a.nans]).toEqual([set.name, sha256(b.bytes), b.nans]);
        compared += set.values.length;
      }
      expect(compared).toBeGreaterThan(2 * COUNT);
    });
  }

  it('sees a difference: one result with its last bit changed gives another hash', () => {
    const set = libmInputs('sinF64', 1000)[1]!;
    const good = libmResults(LIBM_TRIG.sinF64, set.values);
    const bad = Float64Array.from(good);
    bad[500] = bad[500]! * (1 + 2 ** -52);
    expect(bad[500]).not.toBe(good[500]);
    expect(sha256(littleEndianBytes(bad).bytes)).not.toBe(sha256(littleEndianBytes(good).bytes));
  });

  it('the generated JavaScript of the libm module is the baked form, call for call', () => {
    // `compileModuleJs` builds the same factory with `new Function`; the baked one is its text.
    const fresh = compileModuleJs(compiled.module, { precision: 'f32' }).fns as unknown as Record<
      LibmRoutine,
      (x: number) => number
    >;
    for (const routine of LIBM_ROUTINES) {
      for (const set of libmInputs(routine, 2000)) {
        for (const x of set.values) expect(fresh[routine](x)).toBe(LIBM_TRIG[routine](x));
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
    expect(libmGateRows(LIBM_TRIG, sha256)).toEqual(file.rows);
  });

  it('only a NaN or an infinite operand gives a NaN result', () => {
    const wrong: string[] = [];
    let finite = 0;
    for (const routine of LIBM_ROUTINES) {
      for (const set of libmInputs(routine, 20_000)) {
        for (const x of set.values) {
          if (Number.isFinite(x)) finite++;
          if (Number.isNaN(LIBM_TRIG[routine](x)) === Number.isFinite(x))
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
    const fn = routine.startsWith('sin') ? 'sin' : 'cos';
    const format = routine.endsWith('F32') ? F32_FORMAT : F64_FORMAT;
    let max = 0;
    let at = 0;
    let measured = 0;
    for (const x of sample) {
      if (!Number.isFinite(x)) continue;
      const error = ulpError(LIBM_TRIG[routine](x), exactTrig(fn, x), format);
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

describe('the CPU tier calls the libm for sin and cos', () => {
  const program = compile(`"use typeshade";
export function single(x: f32): f32 { return sin(x) - cos(x); }
export function double(x: f64): f64 { return Math.sin(x) - Math.cos(x); }
export function lanes(v: vec3): vec3 { return sin(v) + cos(v.zyx); }
`);
  const x = 1e10;
  const fr = Math.fround;

  it('compiles', () => {
    expect(program.diagnostics).toEqual([]);
  });

  it("in 'f32' precision an f32 operand takes the f32 routine and an f64 operand the f64 one", () => {
    for (const build of [compileModule, compileModuleJs]) {
      const fns = build(program.module, { precision: 'f32' }).fns as Record<
        string,
        (...a: unknown[]) => unknown
      >;
      expect(fns['single']!(x)).toBe(fr(LIBM_TRIG.sinF32(fr(x)) - LIBM_TRIG.cosF32(fr(x))));
      expect(fns['double']!(x)).toBe(LIBM_TRIG.sinF64(x) - LIBM_TRIG.cosF64(x));
      expect(fns['lanes']!([1, 2, 3])).toEqual(
        [1, 2, 3].map((c, i) => fr(LIBM_TRIG.sinF32(c) + LIBM_TRIG.cosF32(3 - i))),
      );
    }
  });

  it("in 'f64' precision every operand takes the f64 routine", () => {
    for (const build of [compileModule, compileModuleJs]) {
      const fns = build(program.module, { precision: 'f64' }).fns as Record<
        string,
        (...a: unknown[]) => unknown
      >;
      expect(fns['single']!(x)).toBe(LIBM_TRIG.sinF64(x) - LIBM_TRIG.cosF64(x));
      expect(fns['double']!(x)).toBe(LIBM_TRIG.sinF64(x) - LIBM_TRIG.cosF64(x));
    }
  });

  it('the tables hold the routines, not the engine Math', () => {
    expect(COMPONENTWISE.sin.lane).not.toBe(Math.sin);
    expect(COMPONENTWISE.cos.lane).not.toBe(Math.cos);
    // The f64 nearest a multiple of pi/2: an engine's fdlibm and the libm round it alike, and
    // the table's entry is the libm's routine on a vector too.
    const hard = 6381956970095103 * 2 ** 797;
    expect(BUILTINS['cos']!(hard)).toBe(LIBM_TRIG.cosF64(hard));
    expect(BUILTINS['sin']!([1, hard])).toEqual([LIBM_TRIG.sinF64(1), LIBM_TRIG.sinF64(hard)]);
    expect(BUILTINS['__sinF32']!(1)).toBe(LIBM_TRIG.sinF32(1));
    expect(BUILTINS['__cosF32']!(1)).toBe(LIBM_TRIG.cosF32(1));
  });
});
