// The libm's test for exp, exp2, log, log2 and ldexp (change 0042, milestone 1a, slice 2).
//
// It holds, for this family, what `libm.test.ts` holds for sin and cos: the baked JavaScript
// form is the one the source gives; the constants derived from ln 2 are the ones a BigInt
// computation gives; the interpreter on the family's IR and the baked form give the same bits;
// this engine gives the results whose hashes `explog.gate.json` holds; each routine's error is
// under 1 ULP on a sample, against an exact BigInt reference, and `ldexp` is correctly rounded.
// It also holds every special value that ECMA-262 and IEEE 754 fix.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bakeLibm, libmGenerated, libmSource } from '../../../scripts/bake-libm.js';
import { compileLibmSource } from '../../compiler/ts/libm-source.js';
import { compile } from '../../compiler/ts/compile.js';
import { compileModuleJs } from '../cpu-codegen.js';
import { BUILTINS, LIBM } from '../cpu-runtime.js';
import { compileModule } from '../oracle.js';
import { littleEndianBytes, mulberry32 } from '../testing/libm-gate.js';
import {
  caseInputBytes,
  caseResults,
  caseRows,
  explogCases,
  type ExplogRoutines,
  type LibmCaseFile,
} from '../testing/libm-cases.js';
import {
  F32_FORMAT,
  F64_FORMAT,
  exactExp,
  exactExp2,
  exactLog,
  exactLog2,
  exactValue,
  f32OfBits,
  f64OfWords,
  ln2Fixed,
  ulpError,
  type Exact,
} from '../testing/libm-reference.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const source = readFileSync(join(ROOT, libmSource('explog')), 'utf8');
const compiled = compileLibmSource(source, libmSource('explog'));
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const CASES = explogCases(LIBM);
const INF = Infinity;

describe('the source of exp, exp2, log, log2 and ldexp and its baked form', () => {
  it('compiles with no diagnostic', () => {
    expect(compiled.diagnostics).toEqual([]);
  });

  it('is baked: explog.generated.ts is what scripts/bake-libm.ts writes from the source', () => {
    expect(readFileSync(join(ROOT, libmGenerated('explog')), 'utf8')).toBe(
      bakeLibm(source, 'explog'),
    );
  });

  it('builds no code at run time: the baked form has no Function constructor and no eval', () => {
    expect(readFileSync(join(ROOT, libmGenerated('explog')), 'utf8')).not.toMatch(
      /\bFunction\b|\beval\b/,
    );
  });

  it('calls no engine function whose result ECMAScript leaves to the engine', () => {
    // The generated code reads the op library through `$`; `Math.fround` is exact.
    const text = readFileSync(join(ROOT, libmGenerated('explog')), 'utf8');
    expect([...text.matchAll(/Math\.(\w+)/g)].map((m) => m[1])).toEqual(['fround']);
    expect(text).not.toMatch(/\*\*/);
  });
});

describe('the constants derived from ln 2', () => {
  const BITS = 400n;
  const ln2 = ln2Fixed(BITS);
  const value = (name: string): number => {
    const c = compiled.module.consts.find((d) => d.name === name);
    if (c === undefined) throw new Error(`the family declares no constant ${name}`);
    return c.cpuValue as number;
  };
  const length = (v: bigint): bigint => BigInt(v.toString(2).length);
  /** `n * 2^-shift` as an f64, exact when `n` is below 2^53. */
  const scaled = (n: bigint, shift: bigint): number => {
    let v = Number(n);
    for (let s = Number(shift); s > 0; s -= Math.min(s, 500)) v /= 2 ** Math.min(s, 500);
    return v;
  };
  const rounded = (x: bigint): number => {
    const drop = length(x) - 53n;
    return scaled((x >> drop) + ((x >> (drop - 1n)) & 1n), BITS - drop);
  };

  it('ln 2 rounded and the rest (LN2, LN2TAIL)', () => {
    expect(value('LN2')).toBe(rounded(ln2));
    expect(value('LN2')).toBe(Math.LN2);
    const drop = length(ln2) - 53n;
    const head = ((ln2 >> drop) + ((ln2 >> (drop - 1n)) & 1n)) << drop;
    // LN2 is above ln 2, so the rest is negative... or below; the sign is the constant's.
    const rest = ln2 - head;
    expect(value('LN2TAIL')).toBe(rest >= 0n ? rounded(rest) : -rounded(-rest));
  });

  it('ln 2 in a head of 32 bits and the rest (LN2HI, LN2LO)', () => {
    // fdlibm's head keeps the top 32 bits of ln 2 below the leading one's place.
    const hi = value('LN2HI');
    const [, lowWord] = [0, new DataView(new Float64Array([hi]).buffer).getUint32(0, true)];
    expect(lowWord & 0x000fffff).toBe(0);
    const exact = exactValue(hi);
    const rest = ln2 - (exact.num << (BITS - exact.scale));
    expect(rest > 0n).toBe(true);
    expect(value('LN2LO')).toBe(rounded(rest));
  });

  it('1 / ln 2 rounded, and in a head and a tail (INVLN2, IVLN2HI, IVLN2LO)', () => {
    const one = 1n << BITS;
    const inverse = (one * one) / ln2;
    expect(value('INVLN2')).toBe(rounded(inverse));
    expect(value('INVLN2')).toBe(Math.LOG2E);
    const exact = exactValue(value('IVLN2HI'));
    const rest = inverse - (exact.num << (BITS - exact.scale));
    expect(rest > 0n).toBe(true);
    expect(value('IVLN2LO')).toBe(rounded(rest));
  });

  it('the powers of two and the splitter', () => {
    expect(value('TWO54')).toBe(f64OfWords((1023 + 54) << 20, 0));
    expect(value('TOINT')).toBe(1.5 * 4503599627370496);
    expect(value('SPLIT')).toBe(134217729);
  });
});

describe('the special values that ECMA-262 and IEEE 754 fix', () => {
  const same = (got: number, want: number): void => {
    expect(Object.is(got, want), `${String(got)} is not ${String(want)}`).toBe(true);
  };

  it('exp', () => {
    same(LIBM.expF64(NaN), NaN);
    same(LIBM.expF64(0), 1);
    same(LIBM.expF64(-0), 1);
    same(LIBM.expF64(INF), INF);
    same(LIBM.expF64(-INF), 0);
    // The first operand that overflows, and the last that does not.
    const last = f64OfWords(0x40862e42, 0xfefa39ef);
    const first = f64OfWords(0x40862e42, 0xfefa39f0);
    same(LIBM.expF64(first), INF);
    expect(ulpError(INF, exactExp(first), F64_FORMAT)).toBe(0);
    expect(Number.isFinite(LIBM.expF64(last))).toBe(true);
    expect(Math.abs(ulpError(LIBM.expF64(last), exactExp(last), F64_FORMAT)!)).toBeLessThan(1);
    // A result below half the smallest subnormal is +0.
    same(LIBM.expF64(-745.2), 0);
    expect(LIBM.expF64(-745.1)).toBe(5e-324);
    // exp(x) is 1 + x for a tiny x, and never below 1 for a positive one.
    expect(LIBM.expF64(1e-300)).toBe(1);
    expect(LIBM.expF64(5e-324)).toBe(1);
  });

  it('exp2: an integer operand gives the exact power of two', () => {
    same(LIBM.exp2F64(NaN), NaN);
    same(LIBM.exp2F64(0), 1);
    same(LIBM.exp2F64(-0), 1);
    same(LIBM.exp2F64(INF), INF);
    same(LIBM.exp2F64(-INF), 0);
    for (let k = -1074; k <= 1023; k++) {
      const want = k >= -1022 ? f64OfWords((1023 + k) << 20, 0) : wordsOfSubnormal(k);
      expect([k, LIBM.exp2F64(k)]).toEqual([k, want]);
    }
    same(LIBM.exp2F64(1024), INF);
    same(LIBM.exp2F64(-1075), 0);
    // 2^-1074.5 rounds up to the smallest subnormal; 2^-1075 is a tie and rounds to even.
    expect(LIBM.exp2F64(-1074.5)).toBe(5e-324);
    expect(LIBM.exp2F64(0.5)).toBeCloseTo(Math.SQRT2, 15);
  });

  it('log', () => {
    same(LIBM.logF64(NaN), NaN);
    same(LIBM.logF64(1), 0);
    same(LIBM.logF64(0), -INF);
    same(LIBM.logF64(-0), -INF);
    same(LIBM.logF64(INF), INF);
    same(LIBM.logF64(-1), NaN);
    same(LIBM.logF64(-INF), NaN);
    same(LIBM.logF64(-5e-324), NaN);
    expect(LIBM.logF64(5e-324)).toBeLessThan(-744);
  });

  it('log2: a power of two gives its exact exponent', () => {
    same(LIBM.log2F64(NaN), NaN);
    same(LIBM.log2F64(1), 0);
    same(LIBM.log2F64(0), -INF);
    same(LIBM.log2F64(-0), -INF);
    same(LIBM.log2F64(INF), INF);
    same(LIBM.log2F64(-1), NaN);
    for (let k = -1074; k <= 1023; k++) {
      const x = k >= -1022 ? f64OfWords((1023 + k) << 20, 0) : wordsOfSubnormal(k);
      expect([k, LIBM.log2F64(x)]).toEqual([k, k]);
    }
  });

  it('ldexp', () => {
    same(LIBM.ldexpF64(NaN, 3), NaN);
    same(LIBM.ldexpF64(INF, -3000), INF);
    same(LIBM.ldexpF64(-INF, 3000), -INF);
    same(LIBM.ldexpF64(0, 3000), 0);
    same(LIBM.ldexpF64(-0, 3000), -0);
    same(LIBM.ldexpF64(1, 0), 1);
    same(LIBM.ldexpF64(1, 1023), f64OfWords(0x7fe00000, 0));
    same(LIBM.ldexpF64(1, 1024), INF);
    same(LIBM.ldexpF64(-1, 5000), -INF);
    same(LIBM.ldexpF64(1, -1074), 5e-324);
    // A tie rounds to even, and one rounding is made: 3 * 2^-1075 is 1.5 units, which is 2.
    same(LIBM.ldexpF64(1, -1075), 0);
    same(LIBM.ldexpF64(3, -1075), 1e-323);
    same(LIBM.ldexpF64(-1, -5000), -0);
    same(LIBM.ldexpF64(5e-324, 1074), 1);
    same(LIBM.ldexpF64(5e-324, 2097), f64OfWords(0x7fe00000, 0));
    // The largest value scaled to just under one unit rounds to one unit.
    same(LIBM.ldexpF64(Number.MAX_VALUE, -2098), 5e-324);
  });

  /** 2^k for a subnormal k, from -1074 to -1023. */
  function wordsOfSubnormal(k: number): number {
    const bit = k + 1074;
    return bit >= 32 ? f64OfWords(2 ** (bit - 32), 0) : f64OfWords(0, 2 ** bit);
  }
});

describe('form against form: the interpreter on the IR and the baked JavaScript', () => {
  const interpreter = explogCases(
    compileModule(compiled.module, { precision: 'f32' }).fns as unknown as ExplogRoutines,
  );
  // 20 000 seeded inputs of each set: the interpreter takes microseconds for one call.
  const COUNT = 20_000;

  for (const [i, c] of CASES.entries()) {
    it(`${c.routine}: the same bits on every edge value and on ${String(COUNT)} inputs of each seeded set`, () => {
      let compared = 0;
      for (const set of c.sets(COUNT)) {
        const a = littleEndianBytes(caseResults(interpreter[i]!, set));
        const b = littleEndianBytes(caseResults(c, set));
        expect([set.name, sha256(a.bytes), a.nans]).toEqual([set.name, sha256(b.bytes), b.nans]);
        compared += set.values.length;
      }
      expect(compared).toBeGreaterThan(COUNT);
    });
  }

  it('the generated JavaScript of the module is the baked form, call for call', () => {
    const fresh = explogCases(
      compileModuleJs(compiled.module, { precision: 'f32' }).fns as unknown as ExplogRoutines,
    );
    for (const [i, c] of CASES.entries()) {
      for (const set of c.sets(1000)) {
        expect(sha256(littleEndianBytes(caseResults(fresh[i]!, set)).bytes)).toBe(
          sha256(littleEndianBytes(caseResults(c, set)).bytes),
        );
      }
    }
  });

  it('sees a difference: one result with its last bit changed gives another hash', () => {
    const set = CASES.find((c) => c.routine === 'expF64')!.sets(1000)[2]!;
    const good = caseResults(
      CASES.find((c) => c.routine === 'expF64')!,
      set,
    );
    const bad = Float64Array.from(good);
    const at = bad.findIndex((v) => Number.isFinite(v) && v > 1e-300);
    bad[at] = bad[at]! * (1 + 2 ** -52);
    expect(sha256(littleEndianBytes(bad).bytes)).not.toBe(sha256(littleEndianBytes(good).bytes));
  });
});

describe('engine against engine: explog.gate.json', () => {
  const file = JSON.parse(
    readFileSync(join(ROOT, 'src/core/libm/explog.gate.json'), 'utf8'),
  ) as LibmCaseFile;

  it('holds a row for each set of each case', () => {
    expect(file.rows.map((r) => `${r.routine} ${r.set}`)).toEqual(
      CASES.flatMap((c) => c.sets(1).map((s) => `${c.routine} ${s.name}`)),
    );
  });

  it('this engine makes the inputs and the results that the file hashes', () => {
    expect(caseRows(CASES, sha256)).toEqual(file.rows);
  });

  it('the input bytes of a function of two operands hold both', () => {
    const set = CASES.find((c) => c.routine === 'ldexpF64')!.sets(10)[1]!;
    expect(caseInputBytes(set).length).toBe(10 * 8 + 10 * 4);
  });
});

describe('the error is under 1 ULP (decision N9), and ldexp is correctly rounded', () => {
  const next = mulberry32(0x5eed0042);
  const N = 3000;
  const unit = (): number => (next() | 0) / 2147483648 + ((next() | 0) / 2147483648) * 2 ** -31;
  const positive = (): number => f64OfWords(next() & 0x7fffffff, next());
  const nearOne = (): number => 1 + unit() * 0.5 * 2 ** -(next() % 50);

  const samples: Record<string, { f64: number[]; f32: number[]; exact: (x: number) => Exact }> = {
    exp: {
      exact: exactExp,
      f64: [
        ...Array.from({ length: N }, () => unit() * 750),
        ...Array.from({ length: N }, () => unit()),
        ...Array.from({ length: N }, () => unit() * 2 ** -(next() % 60)),
        // Results in the subnormal range, which the scaling rounds once.
        ...Array.from({ length: N }, () => -708 - Math.abs(unit() * 38)),
        ...[709.782712893384, -708.3964185322641, -745.1332191019411, 1, -1, 0.5, 1e-300],
      ],
      f32: [
        ...Array.from({ length: N }, () => Math.fround(unit() * 110)),
        ...Array.from({ length: N }, () => Math.fround(unit())),
        ...[88.72283935546875, 88.7228317260742, -103.97207641601562, -104, 1, -1].map(Math.fround),
      ],
    },
    exp2: {
      exact: exactExp2,
      f64: [
        ...Array.from({ length: N }, () => unit() * 1100),
        ...Array.from({ length: N }, () => unit()),
        ...Array.from({ length: N }, () => -1022 - Math.abs(unit() * 53)),
        ...[0.5, -0.5, 1023.5, -1074.5, 1e-300, 1023.9999999999999, -1074.9999999999998],
      ],
      f32: [
        ...Array.from({ length: N }, () => Math.fround(unit() * 160)),
        ...Array.from({ length: N }, () => Math.fround(unit())),
        ...[127.99999237060547, -149.5, -126.5, 0.5].map(Math.fround),
      ],
    },
    log: {
      exact: exactLog,
      f64: [
        ...Array.from({ length: N }, positive),
        ...Array.from({ length: N }, nearOne),
        ...Array.from({ length: N }, () => Math.abs(unit() * 10) + 1e-300),
        ...[5e-324, 2.2250738585072014e-308, Number.MAX_VALUE, Math.SQRT2, Math.SQRT1_2, 2, 10],
      ],
      f32: [
        ...Array.from({ length: N }, () => f32OfBits(next() & 0x7fffffff)),
        ...Array.from({ length: N }, () => Math.fround(nearOne())),
        ...[1.401298464324817e-45, 3.4028234663852886e38, 2, 10].map(Math.fround),
      ],
    },
    log2: {
      exact: exactLog2,
      f64: [
        ...Array.from({ length: N }, positive),
        ...Array.from({ length: N }, nearOne),
        ...Array.from({ length: N }, () => Math.abs(unit() * 10) + 1e-300),
        ...[5e-324, 2.2250738585072014e-308, Number.MAX_VALUE, Math.SQRT2, Math.SQRT1_2, 3, 10],
      ],
      f32: [
        ...Array.from({ length: N }, () => f32OfBits(next() & 0x7fffffff)),
        ...Array.from({ length: N }, () => Math.fround(nearOne())),
        ...[1.401298464324817e-45, 3.4028234663852886e38, 3, 10].map(Math.fround),
      ],
    },
  };

  for (const [name, sample] of Object.entries(samples)) {
    for (const format of ['f32', 'f64'] as const) {
      const c = CASES.find((k) => k.routine === `${name}${format === 'f32' ? 'F32' : 'F64'}`)!;
      it(`${c.routine} on a sample`, () => {
        let max = 0;
        let at = 0;
        let measured = 0;
        for (const x of sample[format]) {
          if (!Number.isFinite(x) || ((name === 'log' || name === 'log2') && !(x > 0))) continue;
          const error = ulpError(
            c.f(x, 0),
            sample.exact(x),
            format === 'f32' ? F32_FORMAT : F64_FORMAT,
          );
          if (error === undefined) continue;
          measured++;
          if (Math.abs(error) > max) {
            max = Math.abs(error);
            at = x;
          }
        }
        expect(measured).toBeGreaterThan(N);
        expect([at, max < 1]).toEqual([at, true]);
        // A measure that reads nothing reports 0.
        expect(max).toBeGreaterThan(0.25);
      });
    }
  }

  it('the measure reports a result that is one unit off, and an overflow that is too early', () => {
    const e = LIBM.expF64(1);
    expect(Math.abs(ulpError(e * (1 + 2 ** -51), exactExp(1), F64_FORMAT)!)).toBeGreaterThan(1);
    expect(ulpError(Infinity, exactExp(709), F64_FORMAT)).toBe(Infinity);
    expect(ulpError(Infinity, exactExp(710), F64_FORMAT)).toBe(0);
    expect(ulpError(-Infinity, exactExp(710), F64_FORMAT)).toBe(Infinity);
  });

  it('ldexp is correctly rounded: it is the exact product rounded once', () => {
    const format = [F64_FORMAT, F32_FORMAT] as const;
    for (const [i, routine] of (['ldexpF64', 'ldexpF32'] as const).entries()) {
      const c = CASES.find((k) => k.routine === routine)!;
      let measured = 0;
      for (const set of c.sets(4000)) {
        for (let j = 0; j < set.values.length; j++) {
          const x = set.values[j]!;
          const n = set.second![j]!;
          if (!Number.isFinite(x) || x === 0) continue;
          const v = exactValue(x);
          const error = ulpError(c.f(x, n), { num: v.num, scale: v.scale - BigInt(n) }, format[i]!);
          measured++;
          // Half a unit or less; a tie may go either way in this measure, and the next test
          // holds the ties.
          expect([x, n, Math.abs(error!) <= 0.5]).toEqual([x, n, true]);
        }
      }
      expect(measured).toBeGreaterThan(3000);
    }
  });
});

describe('the CPU tier calls the libm for exp, exp2, log, log2 and ldexp', () => {
  const X = 0.5251128077507019;
  const program = compile(`"use typeshade";
const X: f32 = ${String(X)};
const E: f32 = exp(X);
const L: f32 = log(X);
export function moduleConstant(): vec2 { return vec2(E, L); }
export function call(x: f32): vec4 { return vec4(exp(x), exp2(x), log(x), log2(x)); }
export function scaled(x: f32, n: i32): f32 { return ldexp(x, n); }
export function lanes(v: vec2): vec2 { return exp(v) + log(v); }
`);
  const fr = Math.fround;
  const f32 = (f: (x: number) => number): number => fr(f(X));

  it('the operand is an f32, and the program compiles', () => {
    expect(fr(X)).toBe(X);
    expect(program.diagnostics).toEqual([]);
  });

  for (const [engine, build] of [
    ['the interpreter', compileModule],
    ['the generated JavaScript', compileModuleJs],
  ] as const) {
    it(`${engine}: an f32 operand takes the routine's result rounded once, on every path`, () => {
      const fns = build(program.module, { precision: 'f32' }).fns as Record<
        string,
        (...a: unknown[]) => unknown
      >;
      expect(fns['moduleConstant']!()).toEqual([f32(LIBM.expF64), f32(LIBM.logF64)]);
      expect(fns['call']!(X)).toEqual([
        f32(LIBM.expF64),
        f32(LIBM.exp2F64),
        f32(LIBM.logF64),
        f32(LIBM.log2F64),
      ]);
      expect(fns['scaled']!(X, -140)).toBe(fr(LIBM.ldexpF64(X, -140)));
      expect(fns['lanes']!([X, 2])).toEqual([
        fr(f32(LIBM.expF64) + f32(LIBM.logF64)),
        fr(fr(LIBM.expF64(2)) + fr(LIBM.logF64(2))),
      ]);
    });
  }

  it('the tables hold the routines, not the engine Math', () => {
    for (const name of ['exp', 'exp2', 'log', 'log2'] as const) {
      const routine = LIBM[`${name}F64`];
      expect(BUILTINS[name]!(3.7)).toBe(routine(3.7));
      expect(BUILTINS[name]!([3.7, 0.2])).toEqual([routine(3.7), routine(0.2)]);
    }
    expect(BUILTINS['ldexp']!(3, -1075)).toBe(1e-323);
  });
});
