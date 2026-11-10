// The libm's test for asin, acos, atan and atan2 (change 0042, milestone 1a, slice 2).
//
// It holds, for this family, what `libm.test.ts` holds for sin, cos and tan: the baked
// JavaScript form is the one the source gives; the constants derived from pi are the ones a
// BigInt computation gives, and the coefficients are fdlibm's, word for word; the interpreter
// on the family's IR and the baked form give the same bits; this engine gives the results
// whose hashes `invtrig.gate.json` holds; each routine's error is under 1 ULP on a sample,
// against an exact BigInt reference. It also holds every special value that ECMA-262 and
// IEEE 754 fix, every special pair of `atan2`, and each threshold of each routine.

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
import { littleEndianBytes, mulberry32 } from '../testing/libm-gate.js';
import {
  caseInputBytes,
  caseResults,
  caseRows,
  invtrigCases,
  type InvtrigRoutines,
  type LibmCaseFile,
} from '../testing/libm-cases.js';
import {
  F32_FORMAT,
  F64_FORMAT,
  exactAcos,
  exactAsin,
  exactAtan,
  exactAtan2,
  exactValue,
  f32OfBits,
  f64OfWords,
  piFixed,
  ulpError,
  wordsOf,
  type Exact,
} from '../testing/libm-reference.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const source = readFileSync(join(ROOT, libmSource('invtrig')), 'utf8');
const compiled = compileLibmSource(source, libmSource('invtrig'));
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const CASES = invtrigCases(LIBM);
const INF = Infinity;
const PI = Math.PI;
const same = (got: number, want: number, what = ''): void => {
  expect(Object.is(got, want), `${what} ${String(got)} is not ${String(want)}`).toBe(true);
};
/** The f64 that is `k` values after `x` in magnitude. */
const after = (x: number, k: number): number => {
  const [hi, lo] = wordsOf(x);
  const v = BigInt(hi) * 4294967296n + BigInt(lo) + BigInt(k);
  return f64OfWords(Number(v >> 32n), Number(v & 0xffffffffn));
};
const value = (name: string): number => {
  const c = compiled.module.consts.find((d) => d.name === name);
  if (c === undefined) throw new Error(`the source declares no constant ${name}`);
  return c.cpuValue as number;
};
const err64 = (got: number, exact: Exact): number => Math.abs(ulpError(got, exact, F64_FORMAT)!);

describe('the source of asin, acos, atan and atan2 and its baked form', () => {
  it('compiles with no diagnostic', () => {
    expect(compiled.diagnostics).toEqual([]);
  });

  it('is baked: invtrig.generated.ts is what scripts/bake-libm.ts writes from the source', () => {
    expect(readFileSync(join(ROOT, libmGenerated('invtrig')), 'utf8')).toBe(
      bakeLibm(source, 'invtrig'),
    );
  });

  it('builds no code at run time: the baked form has no Function constructor and no eval', () => {
    expect(readFileSync(join(ROOT, libmGenerated('invtrig')), 'utf8')).not.toMatch(
      /\bFunction\b|\beval\b/,
    );
  });

  it('calls no engine function whose result ECMAScript leaves to the engine', () => {
    // The generated code reads the op library through `$`; `Math.fround` is exact. The square
    // root is the op library's, which ECMA-262 fixes: one rounding of the exact root.
    const text = readFileSync(join(ROOT, libmGenerated('invtrig')), 'utf8');
    expect([...text.matchAll(/Math\.(\w+)/g)].filter((m) => m[1] !== 'fround')).toEqual([]);
    expect(text).not.toMatch(/\*\*/);
    const read = [...text.matchAll(/\$\.[BL]\["(\w+)"\]/g)].map((m) => m[1]!);
    expect([...new Set(read)].sort()).toEqual(['__f64FromWords', '__f64Hi', '__f64Lo', 'i32', 'sqrt']);
  });
});

describe('the constants', () => {
  const BITS = 400n;
  const pi = piFixed(BITS);
  /** A finite f64 as a fixed-point value of `BITS` bits past the point. */
  const fixed = (x: number): bigint => {
    const v = exactValue(x);
    return v.scale <= BITS ? v.num << (BITS - v.scale) : v.num >> (v.scale - BITS);
  };
  const exactFixed = (e: Exact): bigint =>
    e.scale <= BITS ? e.num << (BITS - e.scale) : e.num >> (e.scale - BITS);
  const magnitude = (v: bigint): bigint => (v < 0n ? -v : v);
  /** Whether `hi` is the f64 nearest `exact`, and `hi + lo` is `exact` to 2^-104 of it. */
  const headAndRest = (exact: bigint, hi: number, lo?: number): void => {
    const unit = 1n << (BITS - 52n - (hi >= 2 ? -1n : hi >= 1 ? 0n : hi >= 0.5 ? 1n : 2n));
    expect(2n * magnitude(exact - fixed(hi)) <= unit, `${String(hi)} is not the nearest`).toBe(
      true,
    );
    if (lo === undefined) return;
    expect(magnitude(exact - fixed(hi) - fixed(lo)) <= unit >> 52n, `${String(lo)}`).toBe(true);
  };

  it('pi/2, pi/4, pi and 3 pi/4 (PIO2H, PIO2L, PIO4H, PIH, PIL, PI3O4)', () => {
    headAndRest(pi >> 1n, value('PIO2H'), value('PIO2L'));
    headAndRest(pi, value('PIH'), value('PIL'));
    headAndRest(pi >> 2n, value('PIO4H'), value('PIO2L') / 2);
    headAndRest((3n * pi) >> 2n, value('PI3O4'));
    expect(value('PIH')).toBe(PI);
    expect(value('PIO2H')).toBe(PI / 2);
  });

  it('atan(0.5), atan(1), atan(1.5) and pi/2, each a head and a rest (ATANHI, ATANLO)', () => {
    const exact = [exactFixed(exactAtan(0.5)), pi >> 2n, exactFixed(exactAtan(1.5)), pi >> 1n];
    for (const [i, e] of exact.entries()) {
      headAndRest(e, value(`ATANHI${String(i)}`), value(`ATANLO${String(i)}`));
    }
  });

  it('pi less each head, a head and a rest of its own (FARHI, FARLO)', () => {
    for (let i = 0; i < 4; i++) {
      headAndRest(
        pi - fixed(value(`ATANHI${String(i)}`)),
        value(`FARHI${String(i)}`),
        value(`FARLO${String(i)}`),
      );
    }
  });

  it('the coefficients are those of fdlibm, word for word', () => {
    const words: Readonly<Record<string, readonly [number, number]>> = {
      PS0: [0x3fc55555, 0x55555555],
      PS1: [0xbfd4d612, 0x03eb6f7d],
      PS2: [0x3fc9c155, 0x0e884455],
      PS3: [0xbfa48228, 0xb5688f3b],
      PS4: [0x3f49efe0, 0x7501b288],
      PS5: [0x3f023de1, 0x0dfdf709],
      QS1: [0xc0033a27, 0x1c8a2d4b],
      QS2: [0x40002ae5, 0x9c598ac8],
      QS3: [0xbfe6066c, 0x1b8d0159],
      QS4: [0x3fb3b8c5, 0xb12e9282],
      AT0: [0x3fd55555, 0x5555550d],
      AT1: [0xbfc99999, 0x9998ebc4],
      AT2: [0x3fc24924, 0x920083ff],
      AT3: [0xbfbc71c6, 0xfe231671],
      AT4: [0x3fb745cd, 0xc54c206e],
      AT5: [0xbfb3b0f2, 0xaf749a6d],
      AT6: [0x3fb10d66, 0xa0d03d51],
      AT7: [0xbfadde2d, 0x52defd9a],
      AT8: [0x3fa97b4b, 0x24760deb],
      AT9: [0xbfa2b444, 0x2c6a6c2f],
      AT10: [0x3f90ad3a, 0xe322da11],
      ATANHI0: [0x3fddac67, 0x0561bb4f],
      ATANHI2: [0x3fef730b, 0xd281f69b],
      ATANLO0: [0x3c7a2b7f, 0x222f65e2],
      ATANLO1: [0x3c81a626, 0x33145c07],
      ATANLO2: [0x3c700788, 0x7af0cbbd],
      ATANLO3: [0x3c91a626, 0x33145c07],
    };
    for (const [name, pair] of Object.entries(words)) {
      expect([name, wordsOf(value(name))]).toEqual([name, [...pair]]);
    }
    expect(value('SPLIT')).toBe(2 ** 27 + 1);
  });
});

describe('the special values that ECMA-262 and IEEE 754 fix', () => {
  it('asin', () => {
    same(LIBM.asinF64(0), 0);
    same(LIBM.asinF64(-0), -0);
    same(LIBM.asinF64(1), PI / 2);
    same(LIBM.asinF64(-1), -PI / 2);
    for (const x of [NaN, INF, -INF, 1.0000000000000002, -1.0000000000000002, 2, -1e300]) {
      same(LIBM.asinF64(x), NaN, `asin(${String(x)})`);
    }
    // asin(x) is x below 2^-26, down to the smallest subnormal, with its sign.
    for (const x of [5e-324, -5e-324, 2.2250738585072014e-308, 2 ** -27, -(2 ** -27)]) {
      same(LIBM.asinF64(x), x);
    }
    // The last value below 1 has a finite result below pi/2.
    expect(LIBM.asinF64(0.9999999999999999)).toBeLessThan(PI / 2);
    // asin is odd, bit for bit.
    for (const x of [0.1, 0.49, 0.5, 0.7, 0.975, 0.99, 0.9999999999999999]) {
      same(LIBM.asinF64(-x), -LIBM.asinF64(x));
    }
  });

  it('acos', () => {
    same(LIBM.acosF64(1), 0);
    same(LIBM.acosF64(-1), PI);
    same(LIBM.acosF64(0), PI / 2);
    same(LIBM.acosF64(-0), PI / 2);
    for (const x of [NaN, INF, -INF, 1.0000000000000002, -1.0000000000000002, 2, -1e300]) {
      same(LIBM.acosF64(x), NaN, `acos(${String(x)})`);
    }
    // A tiny operand gives pi/2 rounded.
    for (const x of [5e-324, -5e-324, 2 ** -58, -(2 ** -58)]) same(LIBM.acosF64(x), PI / 2);
    // The last value below 1 has a positive result, and the first above -1 one below pi.
    expect(LIBM.acosF64(0.9999999999999999)).toBeGreaterThan(0);
    expect(LIBM.acosF64(-0.9999999999999999)).toBeLessThan(PI);
  });

  it('atan', () => {
    same(LIBM.atanF64(0), 0);
    same(LIBM.atanF64(-0), -0);
    same(LIBM.atanF64(INF), PI / 2);
    same(LIBM.atanF64(-INF), -PI / 2);
    same(LIBM.atanF64(NaN), NaN);
    same(LIBM.atanF64(1), PI / 4);
    same(LIBM.atanF64(-1), -PI / 4);
    // atan(x) is x below 2^-27, with its sign, and pi/2 from 2^66.
    for (const x of [5e-324, -5e-324, 2.2250738585072014e-308, 2 ** -28, -(2 ** -28)]) {
      same(LIBM.atanF64(x), x);
    }
    for (const x of [2 ** 66, 1e300, Number.MAX_VALUE]) {
      same(LIBM.atanF64(x), PI / 2);
      same(LIBM.atanF64(-x), -PI / 2);
    }
    // atan is odd, bit for bit.
    for (const x of [0.1, 0.4375, 0.5, 0.6875, 1.1875, 2, 2.4375, 100, 1e20]) {
      same(LIBM.atanF64(-x), -LIBM.atanF64(x));
    }
  });

  it('atan2: every special pair', () => {
    const quarter = PI / 4;
    const threeQuarters = 2.356194490192345;
    expect(threeQuarters).toBe(3 * quarter);
    /** What ECMA-262 (Math.atan2) and IEEE 754 fix for a pair with a zero, an infinity or a
     *  NaN; `undefined` for any other pair. */
    const fixedResult = (y: number, x: number): number | undefined => {
      if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
      const negative = y < 0 || Object.is(y, -0);
      const left = x < 0 || Object.is(x, -0);
      const signed = (r: number): number => (negative ? -r : r);
      if (y === 0) return signed(left ? PI : 0);
      if (x === 0) return signed(PI / 2);
      if (!Number.isFinite(y)) {
        if (!Number.isFinite(x)) return signed(left ? threeQuarters : quarter);
        return signed(PI / 2);
      }
      if (!Number.isFinite(x)) return signed(left ? PI : 0);
      return undefined;
    };
    const operands = [0, -0, 1, -1, 3, -3, 5e-324, -5e-324, Number.MAX_VALUE, INF, -INF, NaN];
    let fixedPairs = 0;
    for (const y of operands) {
      for (const x of operands) {
        const want = fixedResult(y, x);
        if (want === undefined) continue;
        fixedPairs++;
        same(LIBM.atan2F64(y, x), want, `atan2(${String(y)}, ${String(x)})`);
      }
    }
    expect(fixedPairs).toBe(144 - 49);
    // The eight zero pairs and the four infinite pairs, written out.
    same(LIBM.atan2F64(0, 0), 0);
    same(LIBM.atan2F64(-0, 0), -0);
    same(LIBM.atan2F64(0, -0), PI);
    same(LIBM.atan2F64(-0, -0), -PI);
    same(LIBM.atan2F64(0, 1), 0);
    same(LIBM.atan2F64(-0, 1), -0);
    same(LIBM.atan2F64(0, -1), PI);
    same(LIBM.atan2F64(-0, -1), -PI);
    same(LIBM.atan2F64(INF, INF), quarter);
    same(LIBM.atan2F64(-INF, INF), -quarter);
    same(LIBM.atan2F64(INF, -INF), threeQuarters);
    same(LIBM.atan2F64(-INF, -INF), -threeQuarters);
  });

  it('atan2: each quadrant, the axes and the diagonals', () => {
    same(LIBM.atan2F64(1, 1), PI / 4);
    same(LIBM.atan2F64(1, -1), 2.356194490192345);
    same(LIBM.atan2F64(-1, -1), -2.356194490192345);
    same(LIBM.atan2F64(-1, 1), -PI / 4);
    same(LIBM.atan2F64(1, 0), PI / 2);
    same(LIBM.atan2F64(-1, 0), -PI / 2);
    same(LIBM.atan2F64(5e-324, 5e-324), PI / 4);
    same(LIBM.atan2F64(Number.MAX_VALUE, Number.MAX_VALUE), PI / 4);
    same(LIBM.atan2F64(-Number.MAX_VALUE, -Number.MAX_VALUE), -2.356194490192345);
    // The sign of y is the sign of the result, and a negative x gives a result past pi/2.
    const next = mulberry32(0x0a7a2000);
    for (let i = 0; i < 2000; i++) {
      const y = f64OfWords(next(), next());
      const x = f64OfWords(next(), next());
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const r = LIBM.atan2F64(y, x);
      expect([y, x, Math.sign(r) === Math.sign(y) || r === 0]).toEqual([y, x, true]);
      expect([y, x, Math.abs(r) > PI / 2 === x < 0 || Math.abs(r) === PI / 2]).toEqual([
        y,
        x,
        true,
      ]);
      expect(Math.abs(r)).toBeLessThanOrEqual(PI);
      same(LIBM.atan2F64(-y, x), -r);
    }
  });

  it('atan2(y, 1) is atan(y), bit for bit, and a common power of two changes nothing', () => {
    const next = mulberry32(0x0a7a2001);
    for (let i = 0; i < 4000; i++) {
      const y = f64OfWords(next(), next());
      if (!Number.isFinite(y)) continue;
      same(LIBM.atan2F64(y, 1), LIBM.atanF64(y), `atan2(${String(y)}, 1)`);
    }
    for (let i = 0; i < 4000; i++) {
      const y = ((next() | 0) / 2147483648) * 8;
      const x = ((next() | 0) / 2147483648) * 8;
      if (x === 0 || y === 0) continue;
      const r = LIBM.atan2F64(y, x);
      for (const p of [2 ** -1000, 2 ** -700, 2 ** -300, 2 ** 300, 2 ** 700, 2 ** 1000]) {
        same(LIBM.atan2F64(y * p, x * p), r, `atan2(${String(y)}, ${String(x)}) by ${String(p)}`);
      }
    }
  });
});

describe('form against form: the interpreter on the IR and the baked JavaScript', () => {
  const interpreter = invtrigCases(
    compileModule(compiled.module, { precision: 'f32' }).fns as unknown as InvtrigRoutines,
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
    const fresh = invtrigCases(
      compileModuleJs(compiled.module, { precision: 'f32' }).fns as unknown as InvtrigRoutines,
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

describe('engine against engine: invtrig.gate.json', () => {
  const file = JSON.parse(
    readFileSync(join(ROOT, 'src/core/libm/invtrig.gate.json'), 'utf8'),
  ) as LibmCaseFile;

  it('holds a row for each set of each case', () => {
    expect(file.rows.map((r) => `${r.routine} ${r.set}`)).toEqual(
      CASES.flatMap((c) => c.sets(1).map((s) => `${c.routine} ${s.name}`)),
    );
  });

  it('this engine makes the inputs and the results that the file hashes', () => {
    expect(caseRows(CASES, sha256)).toEqual(file.rows);
  });

  it('sees a wrong routine: one result of atan2 with its last bit changed is reported', () => {
    // The gate's own proof (AGENTS.md#gate-discipline): the same rows, computed over a libm
    // whose `atan2` is one unit off for one pair, differ from the file in that case's set.
    const wrongY = 0.6281260318251352;
    const wrongX = -0.3;
    const off = (y: number, x: number): number =>
      y === wrongY && x === wrongX ? LIBM.atan2F64(y, x) * (1 + 2 ** -52) : LIBM.atan2F64(y, x);
    expect(off(wrongY, wrongX)).not.toBe(LIBM.atan2F64(wrongY, wrongX));
    const withPair = (cs: ReturnType<typeof invtrigCases>): ReturnType<typeof invtrigCases> =>
      cs
        .filter((c) => c.routine === 'atan2F64')
        .map((c) => ({
          ...c,
          sets: (count?: number) =>
            c.sets(count).map((s) =>
              s.name === 'edges'
                ? {
                    ...s,
                    values: Float64Array.from([...s.values, wrongY]),
                    second: Float64Array.from([...(s.second as Float64Array), wrongX]),
                  }
                : s,
            ),
        }));
    const a = caseRows(withPair(CASES), sha256);
    const b = caseRows(withPair(invtrigCases({ ...LIBM, atan2F64: off })), sha256);
    expect(a.map((r) => r.inputsSha256)).toEqual(b.map((r) => r.inputsSha256));
    expect(a.filter((r, i) => r.resultsSha256 !== b[i]!.resultsSha256).map((r) => r.set)).toEqual([
      'edges',
    ]);
  });

  it('the input bytes of atan2 hold both operands', () => {
    const set = CASES.find((c) => c.routine === 'atan2F64')!.sets(10)[1]!;
    expect(caseInputBytes(set).length).toBe(10 * 8 + 10 * 8);
    const set32 = CASES.find((c) => c.routine === 'atan2F32')!.sets(10)[1]!;
    expect(caseInputBytes(set32).length).toBe(10 * 4 + 10 * 4);
  });

  it('asin and acos give a NaN only past 1 in magnitude or for a NaN, and atan only for a NaN', () => {
    const wrong: string[] = [];
    for (const c of CASES.filter((k) => !k.routine.startsWith('atan2'))) {
      for (const set of c.sets(5000)) {
        for (const x of set.values) {
          const nan = Number.isNaN(c.f(x, 0));
          const want = c.routine.startsWith('atan') ? Number.isNaN(x) : !(Math.abs(x) <= 1);
          if (nan !== want) wrong.push(`${c.routine}(${String(x)})`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('the error is under 1 ULP (decision N9)', () => {
  const next = mulberry32(0x5eed0a7a);
  const N = 3000;
  const unit = (): number => (next() | 0) / 2147483648 + ((next() | 0) / 2147483648) * 2 ** -31;
  const sign = (): number => (next() & 1 ? -1 : 1);
  const between = (a: number, b: number): number => a + Math.abs(unit()) * (b - a);
  /** 2^k for k from `low` to `high`. */
  const power = (low: number, high: number): number => 2 ** (low + (next() % (high - low + 1)));

  const samples: Record<string, { f64: number[]; f32: number[]; exact: (x: number) => Exact }> = {
    asin: {
      exact: exactAsin,
      f64: [
        ...Array.from({ length: N }, unit),
        // From 0.5 to 0.975, where the routine is weakest, and its two ends.
        ...Array.from({ length: N }, () => sign() * between(0.5, 0.975)),
        ...Array.from({ length: N }, () => sign() * between(0.5, 0.52)),
        ...Array.from({ length: N }, () => sign() * between(0.975, 1)),
        ...Array.from({ length: N }, () => sign() * (1 - (1 + Math.abs(unit())) * power(-53, -6))),
        ...Array.from({ length: N }, () => unit() * power(-40, -2)),
        ...[0.5, 0.975, 0.9999999999999999, 2 ** -26, 5e-324, 0.49999999999999994],
      ],
      f32: [
        ...Array.from({ length: N }, () => Math.fround(unit())),
        ...Array.from({ length: N }, () => Math.fround(sign() * between(0.5, 1))),
        ...[0.5, 0.975, 0.99999994, 1.401298464324817e-45].map(Math.fround),
      ],
    },
    acos: {
      exact: exactAcos,
      f64: [
        ...Array.from({ length: N }, unit),
        ...Array.from({ length: N }, () => sign() * between(0.5, 1)),
        ...Array.from({ length: N }, () => sign() * between(0.5, 0.52)),
        // Near 1, where the result is near 0, and near -1, where it is near pi.
        ...Array.from({ length: N }, () => sign() * (1 - (1 + Math.abs(unit())) * power(-53, -3))),
        ...Array.from({ length: N }, () => unit() * power(-60, -2)),
        ...[0.5, -0.5, 0.9999999999999999, -0.9999999999999999, 2 ** -57, 2 ** -56, 5e-324],
      ],
      f32: [
        ...Array.from({ length: N }, () => Math.fround(unit())),
        ...Array.from({ length: N }, () => Math.fround(sign() * between(0.5, 1))),
        ...[0.5, -0.5, 0.99999994, -0.99999994].map(Math.fround),
      ],
    },
    atan: {
      exact: exactAtan,
      f64: [
        // Each interval of the routine, and each bound.
        ...Array.from({ length: N }, () => sign() * between(0, 0.4375)),
        ...Array.from({ length: N }, () => sign() * between(0.4375, 0.6875)),
        ...Array.from({ length: N }, () => sign() * between(0.6875, 1.1875)),
        ...Array.from({ length: N }, () => sign() * between(1.1875, 2.4375)),
        ...Array.from({ length: N }, () => sign() * between(2.4375, 40)),
        ...Array.from({ length: N }, () => sign() * (1 + Math.abs(unit())) * power(-30, 66)),
        ...[0.4375, 0.6875, 1.1875, 2.4375, 2 ** -27, 2 ** 66, 2 ** 65, 1, 1.5, 0.5, 5e-324],
      ],
      f32: [
        ...Array.from({ length: N }, () => f32OfBits(next())),
        ...Array.from({ length: N }, () => Math.fround(unit() * 40)),
        ...[0.4375, 0.6875, 1.1875, 2.4375, 1, 3.4028234663852886e38].map(Math.fround),
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
          if (!Number.isFinite(x) || (name !== 'atan' && !(Math.abs(x) < 1))) continue;
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

  /** Pairs (y, x) of each hard region of atan2. */
  const mantissa = (): number => sign() * (1 + Math.abs(unit()));
  const pairs: Record<string, () => [number, number]> = {
    'the unit square, every quadrant': () => [unit(), unit()],
    'a quotient of each size up to 2^62': () => {
      const e = power(-900, 900);
      return [mantissa() * e * power(-62, 62), mantissa() * e];
    },
    'near the axes: a quotient around 2^60 and 2^-60': () => {
      const e = power(-300, 300);
      return [mantissa() * e * (next() & 1 ? power(55, 66) : power(-66, -55)), mantissa() * e];
    },
    'a tiny quotient': () => [mantissa() * power(-61, -20), mantissa()],
    'a huge quotient': () => [mantissa() * power(2, 61), mantissa()],
    'subnormal operands': () => {
      const a = sign() * f64OfWords(next() & 0x000fffff, next());
      const b =
        next() & 1
          ? sign() * f64OfWords(next() & 0x000fffff, next())
          : mantissa() * power(-1074, -1010);
      return next() & 1 ? [a, b] : [b, a];
    },
    'operands near the largest value': () => [
      mantissa() * power(960, 1023),
      mantissa() * power(960, 1023),
    ],
    'a quotient at a bound of an interval of the kernel': () => {
      const bound = [0.4375, 0.6875, 1.1875, 2.4375][next() & 3]!;
      const x = mantissa() * power(-10, 10);
      return [sign() * Math.abs(x) * bound * (1 + unit() * power(-50, -1)), x];
    },
  };

  for (const [region, pair] of Object.entries(pairs)) {
    it(`atan2F64: ${region}`, () => {
      let max = 0;
      let at: [number, number] = [0, 0];
      let measured = 0;
      for (let i = 0; i < N; i++) {
        const [y, x] = pair();
        if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) continue;
        const error = ulpError(LIBM.atan2F64(y, x), exactAtan2(y, x), F64_FORMAT);
        if (error === undefined) continue;
        measured++;
        if (Math.abs(error) > max) {
          max = Math.abs(error);
          at = [y, x];
        }
      }
      expect(measured).toBeGreaterThan(N / 2);
      expect([at, max < 1]).toEqual([at, true]);
      expect(max).toBeGreaterThan(0.25);
    });
  }

  it('atan2F32 on a sample: the f64 routine rounded once', () => {
    const c = CASES.find((k) => k.routine === 'atan2F32')!;
    let max = 0;
    let measured = 0;
    for (const set of c.sets(3000)) {
      for (let i = 0; i < set.values.length; i++) {
        const y = set.values[i]!;
        const x = set.second![i]!;
        if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) continue;
        const error = ulpError(c.f(y, x), exactAtan2(y, x), F32_FORMAT);
        if (error === undefined) continue;
        measured++;
        max = Math.max(max, Math.abs(error));
      }
    }
    expect(measured).toBeGreaterThan(6000);
    expect(max).toBeLessThan(1);
    expect(max).toBeGreaterThan(0.25);
  });

  it('the reference agrees with the engine on values it rounds correctly, and reports one unit', () => {
    expect(err64(PI / 4, exactAtan(1))).toBeLessThan(0.5);
    expect(err64(PI / 2, exactAtan2(1, 0))).toBeLessThan(0.5);
    expect(err64(PI, exactAtan2(0, -1))).toBeLessThan(0.5);
    expect(err64(-PI / 2, exactAtan2(-1, 0))).toBeLessThan(0.5);
    expect(err64(2.356194490192345, exactAtan2(1, -1))).toBeLessThan(0.5);
    expect(err64(Math.asin(0.3), exactAsin(0.3))).toBeLessThan(1);
    expect(err64(Math.acos(0.3), exactAcos(0.3))).toBeLessThan(1);
    // asin(x) + acos(x) is pi/2, to the working precision.
    const a = exactAsin(0.3);
    const c = exactAcos(0.3);
    const scale = a.scale > c.scale ? a.scale : c.scale;
    const sum = (a.num << (scale - a.scale)) + (c.num << (scale - c.scale));
    expect(err64(PI / 2, { num: sum, scale })).toBeLessThan(0.5);
    // A value that is one unit off measures past half a unit.
    expect(err64(after(PI / 4, 1), exactAtan(1))).toBeGreaterThan(0.5);
    expect(err64(after(LIBM.atan2F64(0.3, -0.7), 2), exactAtan2(0.3, -0.7))).toBeGreaterThan(1);
  });
});

describe('each threshold of each routine', () => {
  /** The error is under 1 ULP on 257 values around `t`, and `f` moves one way across them. */
  const around = (
    t: number,
    f: (x: number) => number,
    exact: (x: number) => Exact,
    direction: 1 | -1,
  ): void => {
    let previous = f(after(t, -129));
    for (let k = -128; k <= 128; k++) {
      const x = after(t, k);
      const r = f(x);
      expect([x, err64(r, exact(x)) < 1]).toEqual([x, true]);
      expect([x, direction === 1 ? r >= previous : r <= previous]).toEqual([x, true]);
      previous = r;
    }
  };

  it('asin: 2^-26, 0.5 and 0.975', () => {
    for (const t of [f64OfWords(0x3e500000, 0), 0.5, f64OfWords(0x3fef3333, 0)]) {
      around(t, LIBM.asinF64, exactAsin, 1);
    }
  });

  it('acos: 2^-57, 0.5 and -0.5', () => {
    around(f64OfWords(0x3c600000, 0), LIBM.acosF64, exactAcos, -1);
    around(0.5, LIBM.acosF64, exactAcos, -1);
    // After -0.5 in magnitude is toward -1, where acos is larger.
    around(-0.5, LIBM.acosF64, exactAcos, 1);
  });

  it('atan: 2^-27, 7/16, 11/16, 19/16, 39/16 and 2^66', () => {
    for (const t of [2 ** -27, 0.4375, 0.6875, 1.1875, 2.4375, 2 ** 66]) {
      around(t, LIBM.atanF64, exactAtan, 1);
    }
  });

  it('atan2: a quotient at each bound of the kernel, at 2^-27, and at 2^60 and 2^-60', () => {
    const quotients = [2 ** -27, 0.4375, 0.6875, 1.1875, 2.4375, 2 ** -61, 2 ** -60, 2 ** -59];
    for (const q of [...quotients, 2 ** 59, 2 ** 60, 2 ** 61, 2 ** 62]) {
      for (const x of [1, -1, 3, -3, 1e-310, -1e-310, 1e300, 5e-324]) {
        // The bound must be a normal value, so that 129 values before it exist.
        if (!(q * Math.abs(x) < 1e308 && q * Math.abs(x) > 1e-300)) continue;
        // y moves across the bound; a negative x gives a result that decreases with y.
        around(
          q * Math.abs(x),
          (y) => LIBM.atan2F64(y, x),
          (y) => exactAtan2(y, x),
          x > 0 ? 1 : -1,
        );
      }
    }
  });

  it('atan2: the operands at which the routine scales them', () => {
    // Past 2^500 the operands are scaled by 2^-600, and below 2^-400 by 2^600. The routine
    // reads the high word, so the first value past 2^500 that it scales is 2^500 (1 + 2^-20).
    for (const t of [f64OfWords(0x5f300001, 0), f64OfWords(0x26f00000, 0)]) {
      for (const x of [t, -t, t * 3, t / 3, t * 2 ** 50, t * 2 ** -50]) {
        around(
          t,
          (y) => LIBM.atan2F64(y, x),
          (y) => exactAtan2(y, x),
          x > 0 ? 1 : -1,
        );
      }
    }
  });
});

describe('the CPU tier calls the libm for asin, acos, atan and atan2', () => {
  const X = 0.5251128077507019;
  const program = compile(`"use typeshade";
const X: f32 = ${String(X)};
const A: f32 = asin(X);
const T: f32 = atan2(X, -2.0);
export function moduleConstant(): vec2 { return vec2(A, T); }
export function call(x: f32): vec3 { return vec3(asin(x), acos(x), atan(x)); }
export function angle(y: f32, x: f32): f32 { return atan2(y, x); }
export function twoForms(y: f32, x: f32): vec2 { return vec2(Math.atan2(y, x), atan(y, x)); }
export function lanes(v: vec2, w: vec2): vec2 { return atan2(v, w) + asin(v); }
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
      expect(fns['moduleConstant']!()).toEqual([f32(LIBM.asinF64), fr(LIBM.atan2F64(X, -2))]);
      expect(fns['call']!(X)).toEqual([f32(LIBM.asinF64), f32(LIBM.acosF64), f32(LIBM.atanF64)]);
      expect(fns['angle']!(X, -3)).toBe(fr(LIBM.atan2F64(X, -3)));
      expect(fns['twoForms']!(X, -3)).toEqual([fr(LIBM.atan2F64(X, -3)), fr(LIBM.atan2F64(X, -3))]);
      expect(fns['lanes']!([X, -0.25], [2, -1])).toEqual([
        fr(fr(LIBM.atan2F64(X, 2)) + f32(LIBM.asinF64)),
        fr(fr(LIBM.atan2F64(-0.25, -1)) + fr(LIBM.asinF64(-0.25))),
      ]);
    });
  }

  it('the tables hold the routines, not the engine Math', () => {
    for (const name of ['asin', 'acos', 'atan'] as const) {
      const routine = LIBM[`${name}F64`];
      expect(COMPONENTWISE[name].lane).not.toBe(Math[name]);
      expect(BUILTINS[name]!(0.37)).toBe(routine(0.37));
      expect(BUILTINS[name]!([0.37, -0.2])).toEqual([routine(0.37), routine(-0.2)]);
    }
    expect(COMPONENTWISE.atan2.lane).not.toBe(Math.atan2);
    expect(BUILTINS['atan2']!(0.37, -2)).toBe(LIBM.atan2F64(0.37, -2));
    expect(BUILTINS['atan2']!([0.37, 1], [-2, 0])).toEqual([LIBM.atan2F64(0.37, -2), PI / 2]);
  });
});
