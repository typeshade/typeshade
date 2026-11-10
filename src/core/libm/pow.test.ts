// The libm's test for pow (change 0042, milestone 1a).
//
// The routine is in `explog.shade.ts`, beside the scaling and the kernel of exp it uses. This
// file holds, for it: every special pair of ECMA-262's Number::exponentiate gives the engine's
// `Math.pow` result (the owner's decision of 2026-11-10, Rule 1.3); an integer power that is
// representable is exact; the interpreter on the source's IR and the baked form give the same
// bits; this engine gives the results whose hashes `pow.gate.json` holds; the error is under
// 1 ULP on samples of each region, against an exact BigInt reference; the operands of the
// largest measured errors; and the CPU tier calls the routine for `**` and `Math.pow`, with the
// engine's `Math.pow` refused.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { libmSource } from '../../../scripts/bake-libm.js';
import { compileLibmSource } from '../../compiler/ts/libm-source.js';
import { compile } from '../../compiler/ts/compile.js';
import { compileModuleJs } from '../cpu-codegen.js';
import { BUILTINS, COMPONENTWISE, LIBM } from '../cpu-runtime.js';
import { compileModule } from '../oracle.js';
import { withEngineMathRefused } from '../testing/engine-math.js';
import { littleEndianBytes, mulberry32 } from '../testing/libm-gate.js';
import {
  caseResults,
  caseRows,
  powCases,
  type LibmCaseFile,
  type PowRoutines,
} from '../testing/libm-cases.js';
import {
  F32_FORMAT,
  F64_FORMAT,
  exactPow,
  f64OfWords,
  ulpError,
  wordsOf,
  type Exact,
} from '../testing/libm-reference.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const source = readFileSync(join(ROOT, libmSource('explog')), 'utf8');
const compiled = compileLibmSource(source, libmSource('explog'));
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const CASES = powCases(LIBM);
const INF = Infinity;
const pow = LIBM.powF64;
/** The engine's `Math.pow`, read once, before any test refuses it. */
const enginePow = Math.pow;
/** x^y exactly, with the sign of a negative x and an odd integer y. */
const exact = (x: number, y: number): Exact => {
  const e = exactPow(x, y);
  return x < 0 && Math.abs(y % 2) === 1 ? { num: -e.num, scale: e.scale } : e;
};
const error = (x: number, y: number): number =>
  Math.abs(ulpError(pow(x, y), exact(x, y), F64_FORMAT)!);
const same = (got: number, want: number, what = ''): void => {
  expect(Object.is(got, want), `${what} ${String(got)} is not ${String(want)}`).toBe(true);
};
/** The f64 that is `k` values after `x` in magnitude. */
const after = (x: number, k: number): number => {
  const [hi, lo] = wordsOf(x);
  const v = BigInt(hi) * 4294967296n + BigInt(lo) + BigInt(k);
  return f64OfWords(Number(v >> 32n), Number(v & 0xffffffffn));
};

describe("the special pairs of ECMA-262's Number::exponentiate", () => {
  it("the owner's examples of 2026-11-10", () => {
    same(pow(-2, 2), 4);
    same(pow(-2, 3), -8);
    same(pow(1, INF), NaN);
    same(pow(NaN, 0), 1);
    same(pow(-0, 3), -0);
    same(pow(-0, -1), -INF);
  });

  it('each step of the table, in its order', () => {
    // 1. A NaN exponent gives a NaN, for a base of 1 too.
    for (const x of [NaN, 1, -1, 0, -0, 2, INF, -INF])
      same(pow(x, NaN), NaN, `${String(x)} ** NaN`);
    // 2. A zero exponent gives 1, for a NaN base too.
    for (const x of [NaN, 1, -1, 0, -0, 2, -2, INF, -INF, 5e-324]) {
      same(pow(x, 0), 1, `${String(x)} ** 0`);
      same(pow(x, -0), 1, `${String(x)} ** -0`);
    }
    // 3. A NaN base gives a NaN.
    for (const y of [1, -1, 2, 0.5, INF, -INF]) same(pow(NaN, y), NaN, `NaN ** ${String(y)}`);
    // 4. +Infinity: +Infinity for y > 0, +0 for y < 0.
    for (const y of [1, 2, 3, 0.5, 5e-324, INF]) same(pow(INF, y), INF);
    for (const y of [-1, -2, -3, -0.5, -5e-324, -INF]) same(pow(INF, y), 0);
    // 5. -Infinity: the sign of an odd integer y.
    for (const y of [1, 3, 2147483649, 9007199254740991]) same(pow(-INF, y), -INF);
    for (const y of [2, 0.5, 2147483648, 9007199254740994, 1e300, INF]) same(pow(-INF, y), INF);
    for (const y of [-1, -3, -2147483649]) same(pow(-INF, y), -0);
    for (const y of [-2, -0.5, -1e300, -INF]) same(pow(-INF, y), 0);
    // 6. +0: +0 for y > 0, +Infinity for y < 0.
    for (const y of [1, 2, 3, 0.5, INF]) same(pow(0, y), 0);
    for (const y of [-1, -2, -3, -0.5, -INF]) same(pow(0, y), INF);
    // 7. -0: the sign of an odd integer y.
    for (const y of [1, 3, 9007199254740991]) same(pow(-0, y), -0);
    for (const y of [2, 0.5, 1e300, INF]) same(pow(-0, y), 0);
    for (const y of [-1, -3, -9007199254740991]) same(pow(-0, y), -INF);
    for (const y of [-2, -0.5, -1e300, -INF]) same(pow(-0, y), INF);
    // 9. y = +Infinity: +Infinity past |x| = 1, a NaN at it, +0 inside it.
    for (const x of [2, -2, 1.0000000000000002, -1.0000000000000002, 1e300]) same(pow(x, INF), INF);
    for (const x of [1, -1]) {
      same(pow(x, INF), NaN);
      same(pow(x, -INF), NaN);
    }
    for (const x of [0.5, -0.5, 0.9999999999999999, 5e-324]) same(pow(x, INF), 0);
    // 10. y = -Infinity: the reverse.
    for (const x of [2, -2, 1.0000000000000002, 1e300]) same(pow(x, -INF), 0);
    for (const x of [0.5, -0.5, 0.9999999999999999, -5e-324]) same(pow(x, -INF), INF);
    // 11. A negative x with a y that is no integer gives a NaN.
    for (const [x, y] of [
      [-2, 0.5],
      [-1, 0.5],
      [-8, 1 / 3],
      [-1e-300, 2.5],
      [-1.5, 4503599627370495.5],
    ] as const) {
      same(pow(x, y), NaN, `${String(x)} ** ${String(y)}`);
    }
    // A negative x with an integer y: the sign of an odd one, past 2^31 and up to 2^53.
    same(pow(-1, 3), -1);
    same(pow(-1, 2147483649), -1);
    same(pow(-1, 9007199254740991), -1);
    same(pow(-1, 9007199254740994), 1);
    same(pow(-1, 1e300), 1);
    same(pow(-3, -1), -1 / 3);
    same(pow(-0.5, 2147483649), -0);
    same(pow(-2, 2147483649), -INF);
    same(pow(-2, 2147483648), INF);
  });

  it('every pair of the edge set gives the engine Math.pow result, in f64 and in f32', () => {
    let compared = 0;
    for (const c of CASES) {
      const fr = c.format === 'f32' ? Math.fround : (v: number): number => v;
      const set = c.sets(1).find((s) => s.name === 'edges')!;
      for (const [i, x] of set.values.entries()) {
        const y = set.second![i]!;
        const want = fr(enginePow(x, y));
        const got = c.f(x, y);
        // A finite result that is neither 0, 1 nor an exact power is the routine's, so it is
        // held to within 1 ULP of the engine's below; here the bits of every other result.
        const special =
          !Number.isFinite(want) || want === 0 || Math.abs(want) === 1 || Number.isNaN(want);
        if (special) same(got, want, `${c.routine}(${String(x)}, ${String(y)})`);
        else expect(Math.abs(got - want) <= Math.abs(want) * 2 ** -51).toBe(true);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(1700);
  });

  it('x^1 is x, x^-1 is 1 / x, x^2 is x * x and x^0.5 is the square root, as one rounding', () => {
    for (const x of [3, -3, 0.1, 1e-310, 1.7976931348623157e308, -5e-324]) {
      same(pow(x, 1), x);
      same(pow(x, -1), 1 / x);
      same(pow(x, 2), x * x);
      if (x > 0) same(pow(x, 0.5), Math.sqrt(x));
    }
    same(pow(-0, 0.5), 0);
    same(pow(-INF, 0.5), INF);
  });

  it('huge |y|: past 2^64 every result overflows or underflows, near 1 included', () => {
    for (const y of [2 ** 65, 1e300]) {
      same(pow(1.0000000000000002, y), INF);
      same(pow(1.0000000000000002, -y), 0);
      same(pow(0.9999999999999999, y), 0);
      same(pow(0.9999999999999999, -y), INF);
      same(pow(-1.0000000000000002, y), INF);
      same(pow(2, y), INF);
      same(pow(0.5, y), 0);
    }
    // Past 2^31, a base 2^-20 or more from 1 overflows or underflows, with the sign of y's parity.
    same(pow(1.5, 2147483649), INF);
    same(pow(-1.5, 2147483649), -INF);
    same(pow(-1.5, -2147483649), -0);
    same(pow(0.75, 2147483648), 0);
  });

  it('the bounds of the result: overflow past the largest value, and the subnormal range', () => {
    same(pow(2, 1023), 8.98846567431158e307);
    same(pow(2, 1024), INF);
    same(pow(2, -1074), 5e-324);
    same(pow(2, -1075), 0);
    same(pow(-2, -1075), -0);
    same(pow(-2, 1025), -INF);
    same(pow(10, 308), 1e308);
    same(pow(10, 309), INF);
    expect(Number.isFinite(pow(1.7976931348623157e308, 1))).toBe(true);
    same(pow(1.7976931348623157e308, 1.0000000000000002), INF);
  });
});

describe('an integer power that is representable is exact', () => {
  it('x^n for integers x of 2 to 40 and n of 1 to 52, of either sign of x, below 2^53', () => {
    let checked = 0;
    for (let x = 2n; x <= 40n; x++) {
      for (let n = 1n; n <= 52n; n++) {
        const p = x ** n;
        if (p >= 2n ** 53n) break;
        expect([String(x), String(n), pow(Number(x), Number(n))]).toEqual([
          String(x),
          String(n),
          Number(p),
        ]);
        expect(pow(-Number(x), Number(n))).toBe(n % 2n === 1n ? -Number(p) : Number(p));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('powers of two and their reciprocals, to the ends of the format', () => {
    for (let n = -1074; n <= 1023; n++) {
      expect([n, pow(2, n)]).toEqual([n, 2 ** n]);
      if (n >= -1022 && n <= 1022) expect([n, pow(0.5, -n)]).toEqual([n, 2 ** n]);
    }
  });
});

describe('form against form: the interpreter on the IR and the baked JavaScript', () => {
  const interpreter = powCases(
    compileModule(compiled.module, { precision: 'f32' }).fns as unknown as PowRoutines,
  );
  // 20 000 seeded inputs of each set: the interpreter takes microseconds for one call.
  const COUNT = 20_000;

  for (const [i, c] of CASES.entries()) {
    it(`${c.routine}: the same bits on every edge pair and on ${String(COUNT)} pairs of each seeded set`, () => {
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
    const fresh = powCases(
      compileModuleJs(compiled.module, { precision: 'f32' }).fns as unknown as PowRoutines,
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

describe('engine against engine: pow.gate.json', () => {
  const file = JSON.parse(
    readFileSync(join(ROOT, 'src/core/libm/pow.gate.json'), 'utf8'),
  ) as LibmCaseFile;

  it('holds a row for each set of each case', () => {
    expect(file.rows.map((r) => `${r.routine} ${r.set}`)).toEqual(
      CASES.flatMap((c) => c.sets(1).map((s) => `${c.routine} ${s.name}`)),
    );
  });

  it('this engine makes the inputs and the results that the file hashes', () => {
    expect(caseRows(CASES, sha256)).toEqual(file.rows);
  });

  it('no set but the edge pairs holds a NaN result past 1 in 100', () => {
    for (const r of file.rows) {
      if (r.set !== 'edges')
        expect([r.routine, r.set, r.nanResults < r.count / 100]).toEqual([r.routine, r.set, true]);
    }
  });

  it('sees a wrong routine: one result of pow with its last bit changed is reported', () => {
    const wrong = [1.6281260318251352, 7.25] as const;
    const off = (x: number, y: number): number =>
      x === wrong[0] && y === wrong[1] ? pow(x, y) * (1 + 2 ** -52) : pow(x, y);
    expect(off(...wrong)).not.toBe(pow(...wrong));
    const withPair = (cs: ReturnType<typeof powCases>): ReturnType<typeof powCases> =>
      cs
        .filter((c) => c.routine === 'powF64')
        .map((c) => ({
          ...c,
          sets: (count?: number) =>
            c.sets(count).map((s) =>
              s.name === 'edges'
                ? {
                    ...s,
                    values: Float64Array.from([...s.values, wrong[0]]),
                    second: Float64Array.from([...(s.second as Float64Array), wrong[1]]),
                  }
                : s,
            ),
        }));
    const a = caseRows(withPair(CASES), sha256);
    const b = caseRows(withPair(powCases({ powF64: off })), sha256);
    expect(a.map((r) => r.inputsSha256)).toEqual(b.map((r) => r.inputsSha256));
    expect(a.filter((r, i) => r.resultsSha256 !== b[i]!.resultsSha256).map((r) => r.set)).toEqual([
      'edges',
    ]);
  });
});

describe('the error is under 1 ULP (decision N9)', () => {
  const next = mulberry32(0x5eed0a1d);
  const N = 2000;
  const unit = (): number => (next() | 0) / 2147483648 + ((next() | 0) / 2147483648) * 2 ** -31;
  const sign = (): number => (next() & 1 ? -1 : 1);
  /** 2^k for k from `low` to `high`. */
  const power = (low: number, high: number): number => 2 ** (low + (next() % (high - low + 1)));
  /** y with y log2 |x| near `z`, so that the result is near 2^z. */
  const towards = (x: number, z: number): number => z / Math.log2(Math.abs(x));

  const regions: Readonly<Record<string, () => readonly [number, number]>> = {
    'x in (0, 100), y in (-300, 300)': () => [Math.abs(unit()) * 100, unit() * 300],
    'x near 1, |y| large': () => {
      const x = 1 + unit() * power(-52, -1);
      return [x, towards(x, unit() * 1000)];
    },
    'results near the overflow': () => {
      const x = (1 + Math.abs(unit())) * power(-1000, 1000);
      return [x, towards(x, 1000 + Math.abs(unit()) * 23.9)];
    },
    'results near the underflow and subnormal': () => {
      const x = (1 + Math.abs(unit())) * power(-1000, 1000);
      return [x, towards(x, -1074 + Math.abs(unit()) * 70)];
    },
    'a negative x with an integer y': () => {
      const x = -(1 + Math.abs(unit())) * power(-4, 4);
      return [x, Math.trunc(unit() * 120) || 1];
    },
    '|y| past 2^31, x near 1': () => {
      const y = sign() * 2 ** (31 + Math.abs(unit()) * 20);
      return [1 + unit() * 2 ** -Math.ceil(Math.log2(Math.abs(y)) - 8), y];
    },
    'x of every binade, y in (-1, 1)': () => [(1 + Math.abs(unit())) * power(-1074, 1023), unit()],
  };

  for (const [name, draw] of Object.entries(regions)) {
    it(`powF64, ${name}`, () => {
      let max = 0;
      let at: readonly [number, number] = [0, 0];
      let measured = 0;
      for (let i = 0; i < N; i++) {
        const [x, y] = draw();
        if (!Number.isFinite(x) || !Number.isFinite(y) || x === 0 || Math.abs(x) === 1 || y === 0)
          continue;
        const r = pow(x, y);
        if (r === 0 || !Number.isFinite(r)) continue;
        const e = error(x, y);
        measured++;
        if (e > max) {
          max = e;
          at = [x, y];
        }
      }
      expect(measured).toBeGreaterThan(N / 2);
      expect([at, max < 1]).toEqual([at, true]);
      expect(max).toBeGreaterThan(0.25);
    });
  }

  it('powF32 on a sample: the f64 routine rounded once', () => {
    const c = CASES.find((k) => k.routine === 'powF32')!;
    let max = 0;
    let measured = 0;
    for (const set of c.sets(2000)) {
      if (set.name === 'edges') continue;
      for (const [i, x] of set.values.entries()) {
        const y = set.second![i]!;
        const r = c.f(x, y);
        if (!Number.isFinite(r) || r === 0 || x === 0 || Math.abs(x) === 1 || y === 0) continue;
        const e = ulpError(r, exact(x, y), F32_FORMAT);
        if (e === undefined) continue;
        measured++;
        max = Math.max(max, Math.abs(e));
      }
    }
    expect(measured).toBeGreaterThan(4000);
    expect(max).toBeLessThan(1);
  });

  it('the reference agrees with exact values, and reports one unit', () => {
    expect(Math.abs(ulpError(243, exactPow(3, 5), F64_FORMAT)!)).toBeLessThan(1e-6);
    expect(Math.abs(ulpError(Math.SQRT2, exactPow(2, 0.5), F64_FORMAT)!)).toBeLessThan(0.5);
    expect(Math.abs(ulpError(5e-324, exactPow(2, -1074), F64_FORMAT)!)).toBeLessThan(1e-6);
    // A value one unit off measures past half a unit.
    expect(
      Math.abs(ulpError(after(pow(10, 0.3), 1), exactPow(10, 0.3), F64_FORMAT)!),
    ).toBeGreaterThan(0.5);
  });
});

describe('the operands of the largest errors that the sweep of this pull request measured', () => {
  // The sweep measured the routine on 54,739,721 pairs against MPFR. Each pair here is the
  // largest error of one region: x near 1 with a large y, a result near the overflow, and x
  // within 2^-20 of 1 with |y| past 2^31. It is held under a bound just above the measure, so that a
  // change of the routine that makes it worse shows here.
  const largest: readonly (readonly [number, number, number])[] = [
    [1.00015201392358, -3714199.0000836751, 0.8599],
    [1.344450899083326e-265, -1.13935695716323, 0.8503],
    [0.9999999999956527, 140867749553232.69, 0.85],
  ];
  for (const [x, y, measured] of largest) {
    it(`${String(x)} ** ${String(y)}: ${String(measured)} ULP`, () => {
      const e = error(x, y);
      expect(e).toBeLessThan(measured + 0.01);
      expect(e).toBeGreaterThan(measured - 0.02);
    });
  }
});

describe('the CPU tier calls the libm for ** and Math.pow', () => {
  const X = 1.3125;
  const Y = 2.7265625;
  const program = compile(`"use typeshade";
const X: f32 = ${String(X)};
const Y: f32 = ${String(Y)};
const P: f32 = X ** Y;
const Q: f32 = Math.pow(X, -Y);
export function moduleConstants(): array<f32, 2> { return array<f32, 2>(P, Q); }
export function operator(x: f32, y: f32): f32 { return x ** y; }
export function spelled(x: f32, y: f32): f32 { return Math.pow(x, y); }
export function lanes(v: vec2, w: vec2): vec2 { return v ** w; }
export function lanes3(v: vec3, w: vec3): vec3 { return v ** w + v.zyx ** w; }
`);
  const fr = Math.fround;

  it('the operands are f32, and the program compiles', () => {
    expect([fr(X), fr(Y)]).toEqual([X, Y]);
    expect(program.diagnostics).toEqual([]);
  });

  for (const [engine, build] of [
    ['the interpreter', compileModule],
    ['the generated JavaScript', compileModuleJs],
  ] as const) {
    for (const precision of ['f32', 'f64', undefined] as const) {
      const mode = precision === undefined ? 'the default precision' : `'${precision}' precision`;
      it(`${engine}, ${mode}: every path takes the routine, with the engine's Math.pow refused`, () => {
        const r = precision === 'f32' ? fr : (v: number): number => v;
        withEngineMathRefused(['pow'], () => {
          const fns = (
            precision === undefined ? build(program.module) : build(program.module, { precision })
          ).fns as Record<string, (...a: unknown[]) => unknown>;
          // A module constant, folded at compile time; the operator; the Math spelling.
          expect(fns['moduleConstants']!()).toEqual([r(pow(X, Y)), r(pow(X, -Y))]);
          expect(fns['operator']!(X, Y)).toBe(r(pow(X, Y)));
          expect(fns['spelled']!(X, Y)).toBe(r(pow(X, Y)));
          // A negative base with an integer exponent keeps its sign; a zero exponent gives 1.
          expect(fns['operator']!(-2, 3)).toBe(-8);
          expect(fns['spelled']!(NaN, 0)).toBe(1);
          expect(Object.is(fns['operator']!(-0, 3), -0)).toBe(true);
          // A vector call: one routine call for each component (`Math.pow` takes a number only).
          expect(fns['lanes']!([X, 0.75], [Y, -3.5])).toEqual([r(pow(X, Y)), r(pow(0.75, -3.5))]);
          const v = [X, 0.25, 7.5];
          const w = [Y, 1.5, -0.375];
          expect(fns['lanes3']!(v, w)).toEqual(
            v.map((c, i) => r(r(pow(c, w[i]!)) + r(pow(v[2 - i]!, w[i]!)))),
          );
        });
      });
    }
  }

  it('the tables hold the routine, not the engine Math.pow', () => {
    withEngineMathRefused(['pow'], () => {
      expect(BUILTINS['pow']!(X, Y)).toBe(pow(X, Y));
      expect(BUILTINS['pow']!([X, 0.5], [Y, 3])).toEqual([pow(X, Y), pow(0.5, 3)]);
      expect(COMPONENTWISE.pow.lane(X, Y)).toBe(pow(X, Y));
    });
  });
});
