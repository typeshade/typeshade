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
import { createTypeshadeLanguageService } from '../../language-service/service.js';
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

  it('sqrt(2) rounded and the rest (SQRT2, SQRT2TAIL)', () => {
    // The integer square root of 2 * 2^(2 BITS) is sqrt(2) * 2^BITS, truncated.
    const two = 2n << (2n * BITS);
    let root = 1n << (BITS + 1n);
    for (;;) {
      const next = (root + two / root) >> 1n;
      if (next >= root) break;
      root = next;
    }
    expect(root * root <= two && (root + 1n) * (root + 1n) > two).toBe(true);
    expect(value('SQRT2')).toBe(rounded(root));
    expect(value('SQRT2')).toBe(Math.SQRT2);
    const head = exactValue(value('SQRT2'));
    const rest = root - (head.num << (BITS - head.scale));
    // SQRT2 is above sqrt(2), so the rest is negative.
    expect(rest < 0n).toBe(true);
    expect(value('SQRT2TAIL')).toBe(-rounded(-rest));
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
    // A half-integer gives sqrt(2) rounded, times the exact power: the correctly rounded result.
    expect(LIBM.exp2F64(0.5)).toBe(Math.SQRT2);
    expect(LIBM.exp2F64(-0.5)).toBe(Math.SQRT2 / 2);
    for (let k = -1022; k <= 1022; k++) {
      const got = LIBM.exp2F64(k + 0.5);
      expect([k, got]).toEqual([k, Math.SQRT2 * f64OfWords((1023 + k) << 20, 0)]);
      expect(Math.abs(ulpError(got, exactExp2(k + 0.5), F64_FORMAT)!)).toBeLessThanOrEqual(0.5);
    }
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

  it('sees a wrong routine: one result of log with its last bit changed is reported', () => {
    // The gate's own proof (AGENTS.md#gate-discipline): the same rows, computed over a libm
    // whose `log` is one unit off for one operand, differ from the file in that case's set.
    const wrong = 0.6281260318251352;
    const cases = explogCases({
      ...LIBM,
      logF64: (x) => (x === wrong ? LIBM.logF64(x) * (1 + 2 ** -52) : LIBM.logF64(x)),
    }).filter((c) => c.routine === 'logF64');
    expect(LIBM.logF64(wrong) * (1 + 2 ** -52)).not.toBe(LIBM.logF64(wrong));
    // The operand is put into the case's edge set, so the changed routine is called with it.
    const good = CASES.filter((c) => c.routine === 'logF64');
    const withOperand = (cs: typeof cases): typeof cases =>
      cs.map((c) => ({
        ...c,
        sets: (count?: number) =>
          c
            .sets(count)
            .map((s) =>
              s.name === 'edges' ? { ...s, values: Float64Array.from([...s.values, wrong]) } : s,
            ),
      }));
    const a = caseRows(withOperand(good), sha256);
    const b = caseRows(withOperand(cases), sha256);
    expect(a.map((r) => r.inputsSha256)).toEqual(b.map((r) => r.inputsSha256));
    expect(a.filter((r, i) => r.resultsSha256 !== b[i]!.resultsSha256).map((r) => r.set)).toEqual([
      'edges',
    ]);
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
          // Half a unit or less. A tie measures half a unit whichever way it goes, and the
          // next test holds the ties.
          expect([x, n, Math.abs(error!) <= 0.5]).toEqual([x, n, true]);
        }
      }
      expect(measured).toBeGreaterThan(3000);
    }
  });
});

describe('exp2 near a half-integer, where the reduction by the nearest integer was weakest', () => {
  // The independent review of #1181 measured 0.9282 ULP at the first operand, and a result
  // below its lower neighbour's near the two others. The reduction by the nearest half-integer
  // puts these operands at the centre of the kernel's range.
  const hard = [1.5002300426153399, -0.49732986104567456, -0.4976949315592164];
  const view = new DataView(new ArrayBuffer(8));
  /** The f64 `steps` units above `x`, for a negative `x` toward zero. */
  const above = (x: number, steps: number): number => {
    view.setFloat64(0, x);
    view.setBigInt64(0, view.getBigInt64(0) + BigInt(x > 0 ? steps : -steps));
    return view.getFloat64(0);
  };

  it('the error at each operand is under half of the old one', () => {
    for (const x of hard) {
      const error = Math.abs(ulpError(LIBM.exp2F64(x), exactExp2(x), F64_FORMAT)!);
      expect([x, error < 0.4]).toEqual([x, true]);
    }
  });

  it('exp2 does not decrease over 2,048 neighbours around each operand', () => {
    for (const x of hard) {
      let previous = LIBM.exp2F64(above(x, -1024));
      let inversions = 0;
      for (let d = -1023; d <= 1024; d++) {
        const y = LIBM.exp2F64(above(x, d));
        if (y < previous) inversions++;
        previous = y;
      }
      expect([x, inversions]).toEqual([x, 0]);
    }
  });

  it('the product by sqrt(2) leaves out no term: the operands the review of #1199 measured', () => {
    // Without SQRT2TAIL * t in the small term these measured 0.8122, 0.8084, 0.8036 and 0.8340
    // ULP (the last has a subnormal result). With it they measure 0.1878, 0.1916, 0.1964 and
    // 0.1660 ULP.
    const worst = [
      269.73395407326745, -0.27863143773179777, -0.26563800208571564, -1022.2663863890546,
    ];
    for (const x of worst) {
      const error = Math.abs(ulpError(LIBM.exp2F64(x), exactExp2(x), F64_FORMAT)!);
      expect([x, error < 0.25]).toEqual([x, true]);
    }
  });

  it('an operand a quarter from an integer, the new edge of the kernel, is under 1 ULP', () => {
    for (const x of [0.25, -0.25, 0.75, 6.749972967765296, -9.274719568356135, 0.2499999999999]) {
      const error = Math.abs(ulpError(LIBM.exp2F64(x), exactExp2(x), F64_FORMAT)!);
      expect([x, error < 1]).toEqual([x, true]);
    }
  });
});

describe('ldexp rounds a tie to even, for an f64 and for an f32 result', () => {
  const f64 = CASES.find((k) => k.routine === 'ldexpF64')!;
  const f32 = CASES.find((k) => k.routine === 'ldexpF32')!;
  // The smallest subnormal of each format.
  const U64 = 5e-324;
  const U32 = 1.401298464324817e-45;

  it('f64: half a unit goes to the even neighbour', () => {
    // 0.5, 1.5 and 2.5 units are ties; 1.25 and 1.75 are not.
    expect(f64.f(1, -1075)).toBe(0);
    expect(f64.f(3, -1075)).toBe(2 * U64);
    expect(f64.f(5, -1075)).toBe(2 * U64);
    expect(f64.f(7, -1075)).toBe(4 * U64);
    expect(f64.f(5, -1076)).toBe(U64);
    expect(f64.f(7, -1076)).toBe(2 * U64);
    expect(Object.is(f64.f(-1, -1075), -0)).toBe(true);
    expect(f64.f(-3, -1075)).toBe(-2 * U64);
  });

  it('f32: half a unit goes to the even neighbour', () => {
    expect(f32.f(1, -150)).toBe(0);
    expect(f32.f(3, -150)).toBe(2 * U32);
    expect(f32.f(5, -150)).toBe(2 * U32);
    expect(f32.f(7, -150)).toBe(4 * U32);
    expect(f32.f(5, -151)).toBe(U32);
    expect(f32.f(7, -151)).toBe(2 * U32);
    expect(Object.is(f32.f(-1, -150), -0)).toBe(true);
    expect(f32.f(-3, -150)).toBe(-2 * U32);
    // The largest f32 scaled down to just under one unit rounds to one unit, and 2^128 is an
    // overflow.
    expect(f32.f(3.4028234663852886e38, -277)).toBe(U32);
    expect(f32.f(1, 128)).toBe(Infinity);
    expect(f32.f(1, 127)).toBe(1.7014118346046923e38);
  });
});

describe('the exponent of ldexp is an i32 for an author', () => {
  // `ldexpF64` takes any number from JavaScript and checks nothing: (1, 0.5) and (1, NaN) give
  // no meaningful value. No author reaches that, because both halves refuse an exponent that
  // is not an `i32`.
  const editor = (source: string): string[] => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', source);
    return service.getDiagnostics('a.ts').map((d) => `${String(d.code)} ${String(d.message)}`);
  };
  const program = (exponent: string, declare = ''): string =>
    `"use typeshade";\nexport function f(x: f32${declare}): f32 {\n  return ldexp(x, ${exponent});\n}\n`;

  it('an i32 exponent compiles on both halves', () => {
    for (const source of [program('3'), program('n', ', n: i32')]) {
      expect(compile(source).diagnostics).toEqual([]);
      expect(editor(source)).toEqual([]);
    }
  });

  it('an f32 exponent and a u32 exponent are refused on both halves, in the same words', () => {
    for (const source of [program('0.5'), program('y', ', y: f32'), program('u', ', u: u32')]) {
      const fromCompiler = compile(source).diagnostics.map((d) => `${d.code} ${d.message}`);
      expect([source, fromCompiler.length]).toEqual([source, 1]);
      expect(editor(source)).toEqual(fromCompiler);
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
