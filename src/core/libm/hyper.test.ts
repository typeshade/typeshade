// The libm's test for sinh, cosh, tanh, asinh, acosh and atanh (change 0042, milestone 1a,
// slice 2).
//
// The six routines are in `explog.shade.ts`, beside the scaling and the constants they use.
// This file holds, for them, what `explog.test.ts` holds for the rest of that source: the
// series coefficients are the rationals a BigInt computation gives; every special value that
// ECMA-262 and IEEE 754 fix; the interpreter on the source's IR and the baked form give the
// same bits; this engine gives the results whose hashes `hyper.gate.json` holds; each
// routine's error is under 1 ULP on samples of each region, against an exact BigInt
// reference; each threshold; the operands of the largest measured errors; and the CPU tier
// calls the routines, with the engine's `Math` refused.

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
  hyperCases,
  type HyperRoutines,
  type LibmCaseFile,
} from '../testing/libm-cases.js';
import {
  F32_FORMAT,
  F64_FORMAT,
  exactHyperbolic,
  exactInverseHyperbolic,
  exactValue,
  f64OfWords,
  ulpError,
  wordsOf,
  type Exact,
} from '../testing/libm-reference.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const source = readFileSync(join(ROOT, libmSource('explog')), 'utf8');
const compiled = compileLibmSource(source, libmSource('explog'));
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const CASES = hyperCases(LIBM);
const INF = Infinity;
type Name = 'sinh' | 'cosh' | 'tanh' | 'asinh' | 'acosh' | 'atanh';
const NAMES: readonly Name[] = ['sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh'];
const routine = (name: Name): ((x: number) => number) => LIBM[`${name}F64`];
const exact = (name: Name, x: number): Exact =>
  name === 'sinh' || name === 'cosh' || name === 'tanh'
    ? exactHyperbolic(name, x)
    : exactInverseHyperbolic(name, x);
const error = (name: Name, x: number): number =>
  Math.abs(ulpError(routine(name)(x), exact(name, x), F64_FORMAT)!);
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

describe('the series of the two kernels', () => {
  /** Whether `x` is the f64 nearest the rational n / d. */
  const nearest = (x: number, n: bigint, d: bigint): boolean => {
    const v = exactValue(x);
    // |x - n / d| <= ulp(x) / 2, as |v.num * d - n * 2^scale| * 2 <= ulp * d * 2^scale.
    const [hi] = wordsOf(x);
    const ulpExponent = BigInt(((hi >>> 20) & 0x7ff) - 1075);
    const left = v.num * d - (n << v.scale);
    const magnitude = left < 0n ? -left : left;
    const ulp = ulpExponent >= -v.scale ? 1n << (ulpExponent + v.scale) : 1n;
    return 2n * magnitude <= ulp * d;
  };

  it('E3 to E16 are 1 / n!, each rounded to the nearest f64', () => {
    let factorial = 2n;
    for (let n = 3n; n <= 16n; n++) {
      factorial *= n;
      expect([String(n), nearest(value(`E${String(n)}`), 1n, factorial)]).toEqual([
        String(n),
        true,
      ]);
    }
  });

  it('LS3 to LS25 are 2 / (2 n + 1), each rounded to the nearest f64', () => {
    for (let n = 1n; n <= 12n; n++) {
      const k = 2n * n + 1n;
      expect([String(k), nearest(value(`LS${String(k)}`), 2n, k)]).toEqual([String(k), true]);
    }
  });
});

describe('the special values that ECMA-262 and IEEE 754 fix', () => {
  it('sinh: odd, with the zeros, the infinities and a NaN', () => {
    same(LIBM.sinhF64(0), 0);
    same(LIBM.sinhF64(-0), -0);
    same(LIBM.sinhF64(INF), INF);
    same(LIBM.sinhF64(-INF), -INF);
    same(LIBM.sinhF64(NaN), NaN);
    for (const x of [5e-324, -5e-324, 2 ** -29, -(2 ** -29)]) same(LIBM.sinhF64(x), x);
    for (const x of [1e-5, 0.3, 1, 21.9, 22, 300, 710]) same(LIBM.sinhF64(-x), -LIBM.sinhF64(x));
    // The overflow: the last operand with a finite result, and the next one.
    const last = f64OfWords(0x408633ce, 0x8fb9f87d);
    expect(Number.isFinite(LIBM.sinhF64(last))).toBe(true);
    same(LIBM.sinhF64(after(last, 1)), INF);
    same(LIBM.sinhF64(-after(last, 1)), -INF);
    same(LIBM.sinhF64(1e300), INF);
  });

  it('cosh: even, 1 at the zeros, +Infinity at both infinities', () => {
    same(LIBM.coshF64(0), 1);
    same(LIBM.coshF64(-0), 1);
    same(LIBM.coshF64(INF), INF);
    same(LIBM.coshF64(-INF), INF);
    same(LIBM.coshF64(NaN), NaN);
    for (const x of [5e-324, 2 ** -29]) same(LIBM.coshF64(x), 1);
    for (const x of [1e-5, 0.3, 1, 21.9, 22, 300, 710]) same(LIBM.coshF64(-x), LIBM.coshF64(x));
    const last = f64OfWords(0x408633ce, 0x8fb9f87d);
    expect(Number.isFinite(LIBM.coshF64(last))).toBe(true);
    same(LIBM.coshF64(after(last, 1)), INF);
    same(LIBM.coshF64(-1e300), INF);
  });

  it('tanh: odd, ±1 at the infinities and from 22', () => {
    same(LIBM.tanhF64(0), 0);
    same(LIBM.tanhF64(-0), -0);
    same(LIBM.tanhF64(INF), 1);
    same(LIBM.tanhF64(-INF), -1);
    same(LIBM.tanhF64(NaN), NaN);
    for (const x of [5e-324, -5e-324, 2 ** -29]) same(LIBM.tanhF64(x), x);
    for (const x of [22, 30, 1e300]) {
      same(LIBM.tanhF64(x), 1);
      same(LIBM.tanhF64(-x), -1);
    }
    for (const x of [1e-5, 0.3, 0.55, 1, 5, 19, 21.9]) {
      same(LIBM.tanhF64(-x), -LIBM.tanhF64(x));
      expect(Math.abs(LIBM.tanhF64(x))).toBeLessThanOrEqual(1);
    }
  });

  it('asinh: odd, with the zeros, the infinities and a NaN', () => {
    same(LIBM.asinhF64(0), 0);
    same(LIBM.asinhF64(-0), -0);
    same(LIBM.asinhF64(INF), INF);
    same(LIBM.asinhF64(-INF), -INF);
    same(LIBM.asinhF64(NaN), NaN);
    for (const x of [5e-324, -5e-324, 2 ** -29]) same(LIBM.asinhF64(x), x);
    for (const x of [1e-5, 0.3, 1, 2, 3e8, 1e300, Number.MAX_VALUE]) {
      same(LIBM.asinhF64(-x), -LIBM.asinhF64(x));
    }
    expect(Number.isFinite(LIBM.asinhF64(Number.MAX_VALUE))).toBe(true);
  });

  it('acosh: NaN below 1, 0 at 1, +Infinity at +Infinity', () => {
    same(LIBM.acoshF64(1), 0);
    same(LIBM.acoshF64(INF), INF);
    for (const x of [NaN, -INF, -1, 0, -0, 0.5, 0.9999999999999999, -Number.MAX_VALUE]) {
      same(LIBM.acoshF64(x), NaN, `acosh(${String(x)})`);
    }
    expect(LIBM.acoshF64(1.0000000000000002)).toBeGreaterThan(0);
    expect(Number.isFinite(LIBM.acoshF64(Number.MAX_VALUE))).toBe(true);
  });

  it('atanh: odd, ±Infinity at ±1, NaN past 1', () => {
    same(LIBM.atanhF64(0), 0);
    same(LIBM.atanhF64(-0), -0);
    same(LIBM.atanhF64(1), INF);
    same(LIBM.atanhF64(-1), -INF);
    for (const x of [NaN, INF, -INF, 1.0000000000000002, -1.0000000000000002, 2, -1e300]) {
      same(LIBM.atanhF64(x), NaN, `atanh(${String(x)})`);
    }
    for (const x of [5e-324, -5e-324, 2 ** -29]) same(LIBM.atanhF64(x), x);
    for (const x of [1e-5, 0.3, 0.5, 0.9, 0.9999999999999999]) {
      same(LIBM.atanhF64(-x), -LIBM.atanhF64(x));
    }
    expect(Number.isFinite(LIBM.atanhF64(0.9999999999999999))).toBe(true);
  });
});

describe('form against form: the interpreter on the IR and the baked JavaScript', () => {
  const interpreter = hyperCases(
    compileModule(compiled.module, { precision: 'f32' }).fns as unknown as HyperRoutines,
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
    const fresh = hyperCases(
      compileModuleJs(compiled.module, { precision: 'f32' }).fns as unknown as HyperRoutines,
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

describe('engine against engine: hyper.gate.json', () => {
  const file = JSON.parse(
    readFileSync(join(ROOT, 'src/core/libm/hyper.gate.json'), 'utf8'),
  ) as LibmCaseFile;

  it('holds a row for each set of each case', () => {
    expect(file.rows.map((r) => `${r.routine} ${r.set}`)).toEqual(
      CASES.flatMap((c) => c.sets(1).map((s) => `${c.routine} ${s.name}`)),
    );
  });

  it('this engine makes the inputs and the results that the file hashes', () => {
    expect(caseRows(CASES, sha256)).toEqual(file.rows);
  });

  it('no set but the edge values holds a NaN result past 1 in 200', () => {
    for (const r of file.rows) {
      if (r.set !== 'edges')
        expect([r.routine, r.set, r.nanResults < r.count / 200]).toEqual([r.routine, r.set, true]);
    }
  });

  it('sees a wrong routine: one result of acosh with its last bit changed is reported', () => {
    const wrong = 1.6281260318251352;
    const off = (x: number): number =>
      x === wrong ? LIBM.acoshF64(x) * (1 + 2 ** -52) : LIBM.acoshF64(x);
    expect(off(wrong)).not.toBe(LIBM.acoshF64(wrong));
    const withOperand = (cs: ReturnType<typeof hyperCases>): ReturnType<typeof hyperCases> =>
      cs
        .filter((c) => c.routine === 'acoshF64')
        .map((c) => ({
          ...c,
          sets: (count?: number) =>
            c
              .sets(count)
              .map((s) =>
                s.name === 'edges' ? { ...s, values: Float64Array.from([...s.values, wrong]) } : s,
              ),
        }));
    const a = caseRows(withOperand(CASES), sha256);
    const b = caseRows(withOperand(hyperCases({ ...LIBM, acoshF64: off })), sha256);
    expect(a.map((r) => r.inputsSha256)).toEqual(b.map((r) => r.inputsSha256));
    expect(a.filter((r, i) => r.resultsSha256 !== b[i]!.resultsSha256).map((r) => r.set)).toEqual([
      'edges',
    ]);
  });
});

describe('the error is under 1 ULP (decision N9)', () => {
  const next = mulberry32(0x5eed0a1c);
  const N = 2500;
  const unit = (): number => (next() | 0) / 2147483648 + ((next() | 0) / 2147483648) * 2 ** -31;
  const sign = (): number => (next() & 1 ? -1 : 1);
  const between = (a: number, b: number): number => a + Math.abs(unit()) * (b - a);
  /** 2^k for k from `low` to `high`. */
  const power = (low: number, high: number): number => 2 ** (low + (next() % (high - low + 1)));
  const tiny = (): number => sign() * (1 + Math.abs(unit())) * power(-28, -2);

  const samples: Record<Name, readonly (() => number)[]> = {
    sinh: [
      tiny,
      () => unit() * 0.35,
      () => sign() * between(0.3, 1),
      () => sign() * between(1, 22),
      () => sign() * between(22, 710),
    ],
    cosh: [
      tiny,
      () => unit() * 0.35,
      () => sign() * between(0.3, 1),
      () => sign() * between(1, 22),
      () => sign() * between(22, 710),
    ],
    tanh: [
      tiny,
      () => unit() * 0.55,
      () => sign() * between(0.5, 2),
      () => sign() * between(2, 22),
    ],
    asinh: [
      tiny,
      () => sign() * between(0.2, 0.5),
      () => sign() * between(0.5, 2),
      () => sign() * between(2, 1000),
      () => sign() * (1 + Math.abs(unit())) * power(27, 1000),
    ],
    acosh: [
      () => 1 + (1 + Math.abs(unit())) * power(-52, -2),
      () => between(1.2, 2),
      () => between(2, 1000),
      () => (1 + Math.abs(unit())) * power(27, 1000),
    ],
    atanh: [
      tiny,
      () => sign() * between(0.2, 0.5),
      () => sign() * between(0.5, 0.99),
      () => sign() * (1 - (1 + Math.abs(unit())) * power(-53, -8)),
    ],
  };

  for (const name of NAMES) {
    it(`${name}F64 on a sample of each region`, () => {
      let max = 0;
      let at = 0;
      let measured = 0;
      for (const draw of samples[name]) {
        for (let i = 0; i < N; i++) {
          const x = draw();
          if (!Number.isFinite(x) || (name === 'atanh' && !(Math.abs(x) < 1))) continue;
          const e = error(name, x);
          measured++;
          if (e > max) {
            max = e;
            at = x;
          }
        }
      }
      expect(measured).toBeGreaterThan(3 * N);
      expect([at, max < 1]).toEqual([at, true]);
      expect(max).toBeGreaterThan(0.25);
    });

    it(`${name}F32 on a sample: the f64 routine rounded once`, () => {
      const c = CASES.find((k) => k.routine === `${name}F32`)!;
      let max = 0;
      let measured = 0;
      for (const set of c.sets(2000)) {
        for (const x of set.values) {
          // The reference takes the domain, and sinh and cosh up to their overflow.
          const outside =
            (name === 'acosh' && !(x >= 1)) ||
            (name === 'atanh' && !(Math.abs(x) < 1)) ||
            ((name === 'sinh' || name === 'cosh') && !(Math.abs(x) <= 710));
          if (!Number.isFinite(x) || outside) continue;
          const want = exact(name, x);
          const e = ulpError(c.f(x, 0), want, F32_FORMAT);
          if (e === undefined || !Number.isFinite(c.f(x, 0))) continue;
          measured++;
          max = Math.max(max, Math.abs(e));
        }
      }
      expect(measured).toBeGreaterThan(4000);
      expect(max).toBeLessThan(1);
    });
  }

  it('the reference agrees with the engine on values it rounds correctly, and reports one unit', () => {
    expect(Math.abs(ulpError(1, exactHyperbolic('cosh', 0), F64_FORMAT)!)).toBe(0);
    expect(error('sinh', 1)).toBeLessThan(0.5);
    // sinh(x) + cosh(x) is e^x, to the reference's precision.
    const s = exactHyperbolic('sinh', 0.7);
    const c = exactHyperbolic('cosh', 0.7);
    expect(s.scale).toBe(c.scale);
    expect(
      Math.abs(ulpError(Math.E ** 0.7, { num: s.num + c.num, scale: s.scale }, F64_FORMAT)!),
    ).toBeLessThan(2);
    // A value one unit off measures past half a unit.
    expect(
      Math.abs(ulpError(after(LIBM.asinhF64(0.3), 1), exact('asinh', 0.3), F64_FORMAT)!),
    ).toBeGreaterThan(0.5);
  });
});

describe('each threshold of each routine', () => {
  /** The error is under 1 ULP on 257 values around `t`. */
  const around = (name: Name, t: number): void => {
    for (let k = -128; k <= 128; k++) {
      const x = after(t, k);
      if (name === 'acosh' && x < 1) continue;
      expect([name, x, error(name, x) < 1]).toEqual([name, x, true]);
    }
  };

  it('sinh, cosh and tanh: 2^-28, ln 2 / 2, 1 and 22, and tanh where e^(2x) passes 2^50', () => {
    for (const name of ['sinh', 'cosh', 'tanh'] as const) {
      for (const t of [2 ** -28, 0.34657359027997264, 1, 22]) around(name, t);
    }
    around('tanh', 50 * 0.34657359027997264);
  });

  it('asinh, acosh and atanh: 2^-28, 0.4142 of the logarithm, 0.5, 2 and 2^28', () => {
    for (const t of [2 ** -28, 0.41421356237309503, 0.5, 2, 2 ** 28]) around('asinh', t);
    for (const t of [1.0000000000001, 1.41421356237309503, 2, 2 ** 28]) around('acosh', t);
    for (const t of [2 ** -28, 0.17157287525380996, 0.5, 0.9]) around('atanh', t);
  });
});

describe('the CPU tier calls the libm for the six hyperbolic functions', () => {
  const X = 0.5251128077507019;
  const program = compile(`"use typeshade";
const X: f32 = ${String(X)};
const S: f32 = sinh(X);
const C: f32 = cosh(X);
const T: f32 = tanh(X);
const A: f32 = asinh(X);
const H: f32 = acosh(X + 1.0);
const N: f32 = atanh(X);
export function moduleConstants(): array<f32, 6> { return array<f32, 6>(S, C, T, A, H, N); }
export function bare(x: f32): array<f32, 6> { return array<f32, 6>(sinh(x), cosh(x), tanh(x), asinh(x), acosh(x + 1.0), atanh(x)); }
export function spelled(x: f32): array<f32, 6> { return array<f32, 6>(Math.sinh(x), Math.cosh(x), Math.tanh(x), Math.asinh(x), Math.acosh(x + 1.0), Math.atanh(x)); }
export function lanes(v: vec2): vec2 { return sinh(v) + atanh(v); }
export function lanes3(v: vec3): vec3 { return cosh(v) + tanh(v.zyx) + asinh(v) + acosh(v + 1.0); }
`);
  const fr = Math.fround;
  const ENGINE = ['sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh'] as const;

  it('the operand is an f32, and the program compiles', () => {
    expect(fr(X)).toBe(X);
    expect(program.diagnostics).toEqual([]);
  });

  for (const [engine, build] of [
    ['the interpreter', compileModule],
    ['the generated JavaScript', compileModuleJs],
  ] as const) {
    for (const precision of ['f32', 'f64', undefined] as const) {
      const mode = precision === undefined ? 'the default precision' : `'${precision}' precision`;
      it(`${engine}, ${mode}: every path takes the routine, with the engine's Math refused`, () => {
        const r = precision === 'f32' ? fr : (v: number): number => v;
        const {
          sinhF64: sinh,
          coshF64: cosh,
          tanhF64: tanh,
          asinhF64: asinh,
          acoshF64: acosh,
          atanhF64: atanh,
        } = LIBM;
        withEngineMathRefused(ENGINE, () => {
          const fns = (
            precision === undefined ? build(program.module) : build(program.module, { precision })
          ).fns as Record<string, (...a: unknown[]) => unknown>;
          const x1 = r(X + 1);
          const want = [r(sinh(X)), r(cosh(X)), r(tanh(X)), r(asinh(X)), r(acosh(x1)), r(atanh(X))];
          // A module constant, folded at compile time; the bare names; the Math spellings.
          expect(fns['moduleConstants']!()).toEqual(want);
          expect(fns['bare']!(X)).toEqual(want);
          expect(fns['spelled']!(X)).toEqual(want);
          // A vector call: one routine call for each component.
          expect(fns['lanes']!([X, -0.25])).toEqual([
            r(r(sinh(X)) + r(atanh(X))),
            r(r(sinh(-0.25)) + r(atanh(-0.25))),
          ]);
          const v = [X, 0.25, 0.75];
          expect(fns['lanes3']!(v)).toEqual(
            v.map((c, i) =>
              r(r(r(r(cosh(c)) + r(tanh(v[2 - i]!))) + r(asinh(c))) + r(acosh(r(c + 1)))),
            ),
          );
        });
      });
    }
  }

  it('the tables hold the routines, not the engine Math', () => {
    withEngineMathRefused(ENGINE, () => {
      for (const name of ENGINE) {
        const f = routine(name);
        const x = name === 'acosh' ? 1.37 : 0.37;
        expect(BUILTINS[name]!(x)).toBe(f(x));
        expect(BUILTINS[name]!([x, x + 0.1])).toEqual([f(x), f(x + 0.1)]);
        expect(COMPONENTWISE[name].lane(x)).toBe(f(x));
      }
    });
  });
});
