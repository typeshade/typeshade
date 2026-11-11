"use typeshade";

// ═══ The libm: exp, exp2, log, log2, ldexp, the hyperbolic functions and pow (change 0042, 1a) ═══
//
// A NOTE FOR A READER IN AN EDITOR. The language service reports `TS8004 Unknown function` on
// `__f64Hi`, `__f64Lo` and `__f64FromWords` in this file. That is correct for an author's file:
// the names are compiler-internal operations, and no author can write them
// (`src/compiler/ts/internal-ops.ts`). Only `compileLibmSource` lowers them, and
// `src/core/libm/libm.test.ts` holds that this file compiles there with no diagnostic.
//
// One routine for each function, on `f64` (Amendment A2 of change 0042). The result for an
// `f32` operand is the routine's result rounded once to `f32`. `scripts/bake-libm.ts` writes
// the JavaScript form, `explog.generated.ts`.
//
// The promise is an error under 1 ULP for `exp`, `exp2`, `log`, `log2`, the six hyperbolic
// functions and `pow` (decision N9).
// `ldexp` is exact scaling with one rounding, so it is correctly rounded.
//
// The hyperbolic functions and `pow` are in this file because they need its scaling and its
// constants; a source cannot call a function of another source. Their sections say how they
// differ from fdlibm. The methods are those of fdlibm, as FreeBSD and musl carry them: `e_exp.c`, `e_log.c`
// and `e_log2.c` with their coefficients, and musl's `scalbn.c` for the scaling. `exp2` is this
// file's own: the nearest half-integer taken out, the kernel of `exp` on the rest times ln 2,
// held as a head and a tail, and a product by sqrt(2) for an odd half-step. The notice of fdlibm:
//
//   Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
//   Developed at SunSoft, a Sun Microsystems, Inc. business.
//   Permission to use, copy, modify, and distribute this software is freely granted,
//   provided that this notice is preserved.
//
// `libm.test.ts` holds every constant derived from ln 2 to a BigInt computation.

// ln 2 in a head of 32 bits and a tail, and 1 / ln 2.
const LN2HI: f64 = 6.93147180369123816490e-01;
const LN2LO: f64 = 1.90821492927058770002e-10;
const INVLN2: f64 = 1.44269504088896338700e+00;
// ln 2 rounded, and the rest rounded.
const LN2: f64 = 0.6931471805599453;
const LN2TAIL: f64 = 2.319046813846299616e-17;
// sqrt(2) rounded, and the rest rounded.
const SQRT2: f64 = 1.4142135623730951;
const SQRT2TAIL: f64 = -9.667293313452913e-17;
// 1 / ln 2 in a head of 32 bits and a tail.
const IVLN2HI: f64 = 1.44269504072144627571e+00;
const IVLN2LO: f64 = 1.67517131648865118353e-10;
// The kernel of exp on [-ln 2 / 2, ln 2 / 2] (fdlibm).
const P1: f64 = 1.66666666666666019037e-01;
const P2: f64 = -2.77777777770155933842e-03;
const P3: f64 = 6.61375632143793436117e-05;
const P4: f64 = -1.65339022054652515390e-06;
const P5: f64 = 4.13813679705723846039e-08;
// The kernel of log on [sqrt(2) / 2, sqrt(2)] (fdlibm).
const LG1: f64 = 6.666666666666735130e-01;
const LG2: f64 = 3.999999999940941908e-01;
const LG3: f64 = 2.857142874366239149e-01;
const LG4: f64 = 2.222219843214978396e-01;
const LG5: f64 = 1.818357216161805012e-01;
const LG6: f64 = 1.531383769920937332e-01;
const LG7: f64 = 1.479819860511658591e-01;
// 2^54.
const TWO54: f64 = 18014398509481984;
// 1.5 * 2^52: adding and subtracting it rounds an f64 to an integer.
const TOINT: f64 = 6755399441055744;
// Veltkamp's splitter, 2^27 + 1.
const SPLIT: f64 = 134217729;

/** 2^1023. A literal past the range of an f32 is not written, so the words make it. */
function two1023(): f64 {
  return __f64FromWords(u32(0x7fe00000), u32(0));
}

/** y * 2^n with one rounding. A scale past the range of an exponent is applied in steps that
 *  are exact, so a subnormal result is rounded once (musl `scalbn`). */
function scale(y0: f64, n0: i32): f64 {
  let y = y0;
  let n = n0;
  if (n > 1023) {
    y = y * two1023();
    n = n - 1023;
    if (n > 1023) {
      y = y * two1023();
      n = n - 1023;
      if (n > 1023) {
        n = 1023;
      }
    }
  } else if (n < -1022) {
    // 2^-969 is 2^-1022 * 2^53. Each step leaves 53 bits of room, so no step rounds a value
    // that the last one rounds.
    const twom969 = __f64FromWords(u32(0x03600000), u32(0));
    y = y * twom969;
    n = n + 969;
    if (n < -1022) {
      y = y * twom969;
      n = n + 969;
      if (n < -1022) {
        n = -1022;
      }
    }
  }
  return y * __f64FromWords(u32(0x3ff + n) << 20, u32(0));
}

/** exp(hi - lo) for |hi - lo| <= ln 2 / 2, where `lo` is the tail of the reduced argument. */
function kexp(hi: f64, lo: f64): f64 {
  const x = hi - lo;
  const xx = x * x;
  const c = x - xx * (P1 + xx * (P2 + xx * (P3 + xx * (P4 + xx * P5))));
  return 1.0 + (x * c / (2.0 - c) - lo + hi);
}

/** e^x for an f64. The error is under 1 ULP. */
export function expF64(x: f64): f64 {
  const hw = __f64Hi(x);
  const hx = hw & 0x7fffffff;
  if (hx >= 0x4086232b) {
    // |x| >= 708.39, an infinity or a NaN.
    if (x != x) {
      return x;
    }
    if (x > 709.782712893383973096) {
      return x * two1023();
    }
    if (x < -745.13321910194110842) {
      return 0.0;
    }
  }
  if (hx > 0x3fd62e42) {
    // |x| > ln 2 / 2: x = k ln 2 + r.
    let k: i32 = 1;
    if (hx >= 0x3ff0a2b2) {
      if (hw >= 0x80000000) {
        k = __f64ToI32(INVLN2 * x - 0.5);
      } else {
        k = __f64ToI32(INVLN2 * x + 0.5);
      }
    } else if (hw >= 0x80000000) {
      k = -1;
    }
    const kf: f64 = f64(f32(k));
    const y = kexp(x - kf * LN2HI, kf * LN2LO);
    return scale(y, k);
  }
  if (hx > 0x3e300000) {
    return kexp(x, 0.0);
  }
  // |x| < 2^-28: exp(x) rounds to 1 + x.
  return 1.0 + x;
}

/** 2^x for an f64. The error is under 1 ULP, and an integer x gives the exact power.
 *
 *  x = h / 2 + r with h the nearest integer to 2x, so |r| <= 1/4 and the kernel of exp runs on
 *  |r ln 2| <= ln 2 / 4, half the range of `exp`. h = 2k + j with j 0 or 1. For j = 0 the result
 *  is 2^k (1 + t). For j = 1 it is 2^k sqrt(2) (1 + t), and sqrt(2) is the head SQRT2 plus the
 *  tail SQRT2TAIL. The product is the head plus a small term that holds the three other terms:
 *  SQRT2 * t + (SQRT2TAIL + SQRT2TAIL * t). Five steps round. The product SQRT2TAIL * t and the
 *  sum of the two tail terms round far below a unit of the result. The product SQRT2 * t and the
 *  sum of the small term each round by 1/8 ULP of the result at most. The last sum, with the
 *  head, rounds by 1/2 ULP at most. */
export function exp2F64(x: f64): f64 {
  if (x != x) {
    return x;
  }
  if (x >= 1024.0) {
    return x * two1023();
  }
  if (x <= -1075.0) {
    return 0.0;
  }
  const hf = (2.0 * x + TOINT) - TOINT;
  const r = x - hf * 0.5;
  // h = 2k + j: an arithmetic shift is the floor of h / 2, for a negative h too.
  const h = __f64ToI32(hf);
  const k = h >> 1;
  const odd = (h & 1) == 1;
  if (r == 0.0) {
    // An integer gives the exact power, and a half-integer sqrt(2) rounded, times the power.
    if (odd) {
      return scale(SQRT2, k);
    }
    return scale(1.0, k);
  }
  // r * ln 2 as a head and a tail: Dekker's exact product by the head of ln 2, and the product
  // by its tail.
  const ca = SPLIT * r;
  const ah = ca - (ca - r);
  const al = r - ah;
  const cb = SPLIT * LN2;
  const bh = cb - (cb - LN2);
  const bl = LN2 - bh;
  const hi = r * LN2;
  const lo = -((((ah * bh - hi) + ah * bl + al * bh) + al * bl) + r * LN2TAIL);
  // t = exp(hi - lo) - 1, the kernel of exp without its last sum.
  const v = hi - lo;
  const vv = v * v;
  const c = v - vv * (P1 + vv * (P2 + vv * (P3 + vv * (P4 + vv * P5))));
  const t = v * c / (2.0 - c) - lo + hi;
  if (odd) {
    return scale(SQRT2 + (SQRT2 * t + (SQRT2TAIL + SQRT2TAIL * t)), k);
  }
  return scale(1.0 + t, k);
}

/** x * 2^n for an f64, correctly rounded. `n` is an `i32`: the builtin's exponent has that type,
 *  so no author's program hands this routine anything else. The JavaScript form checks nothing
 *  at run time; a caller that hands it a number that is no `i32` gets no promise. */
export function ldexpF64(x: f64, n: i32): f64 {
  return scale(x, n);
}

/** ln(x) for an f64. The error is under 1 ULP. */
export function logF64(x0: f64): f64 {
  let x = x0;
  let hx = __f64Hi(x);
  let k: i32 = 0;
  if (hx < 0x00100000 || hx >= 0x80000000) {
    if (x == 0.0) {
      // log(+-0) is -infinity.
      return -1.0 / (x * x);
    }
    if (hx >= 0x80000000) {
      // log of a negative number is a NaN.
      return (x - x) / (x - x);
    }
    // A subnormal number: scale it up.
    k = -54;
    x = x * TWO54;
    hx = __f64Hi(x);
  } else if (hx >= 0x7ff00000) {
    return x;
  } else if (hx == 0x3ff00000 && __f64Lo(x) == 0) {
    return 0.0;
  }
  // x = 2^k * m with m in [sqrt(2) / 2, sqrt(2)).
  hx = hx + 0x00095f62;
  k = k + i32(hx >> 20) - 0x3ff;
  hx = (hx & 0x000fffff) + 0x3fe6a09e;
  const m = __f64FromWords(hx, __f64Lo(x));
  const f = m - 1.0;
  const hfsq = 0.5 * f * f;
  const s = f / (2.0 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const r = t2 + t1;
  const dk: f64 = f64(f32(k));
  return s * (hfsq + r) + dk * LN2LO - hfsq + f + dk * LN2HI;
}

/** log2(x) for an f64. The error is under 1 ULP, and a power of two gives its exact exponent. */
export function log2F64(x0: f64): f64 {
  let x = x0;
  let hx = __f64Hi(x);
  let k: i32 = 0;
  if (hx < 0x00100000 || hx >= 0x80000000) {
    if (x == 0.0) {
      return -1.0 / (x * x);
    }
    if (hx >= 0x80000000) {
      return (x - x) / (x - x);
    }
    k = -54;
    x = x * TWO54;
    hx = __f64Hi(x);
  } else if (hx >= 0x7ff00000) {
    return x;
  } else if (hx == 0x3ff00000 && __f64Lo(x) == 0) {
    return 0.0;
  }
  hx = hx + 0x00095f62;
  k = k + i32(hx >> 20) - 0x3ff;
  hx = (hx & 0x000fffff) + 0x3fe6a09e;
  const m = __f64FromWords(hx, __f64Lo(x));
  const f = m - 1.0;
  const hfsq = 0.5 * f * f;
  const s = f / (2.0 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const r = t2 + t1;
  // f - hfsq as a head of 21 bits and a tail, so the product by 1 / ln 2 keeps its low bits.
  const hi = __f64FromWords(__f64Hi(f - hfsq), u32(0));
  const lo = (f - hi) - hfsq + s * (hfsq + r);
  let valHi = hi * IVLN2HI;
  let valLo = (lo + hi) * IVLN2LO + lo * IVLN2HI;
  // The sum with k, which is exact in a head and a tail.
  const y: f64 = f64(f32(k));
  const sum = y + valHi;
  valLo = valLo + ((y - sum) + valHi);
  valHi = sum;
  return valLo + valHi;
}

// ═══ The hyperbolic functions ═══
//
// fdlibm's `e_sinh.c`, `e_cosh.c`, `s_tanh.c`, `s_asinh.c`, `e_acosh.c` and `e_atanh.c` round
// several times after a routine whose own error is near half a unit. Measured against MPFR on
// 200,000 operands each, they reach 1.6 to 2.2 ULP. So the six routines here keep fdlibm's
// formulas and special cases, and carry every step before the last as a head and a rest (two
// doubles whose sum holds about 100 bits), with Dekker's exact product and Knuth's exact sum.
// Each result is rounded once, at the end. The two kernels of this section take the place of
// fdlibm's `expm1` and `log1p`. Change 0112 removed their bare names; `Math.expm1` and
// `Math.log1p` still expand to `exp(x) - 1` and `log(x + 1)` and do not call them. `hyperbolic` gives e^a - 1 and e^a as a head and a rest, and `lnOnePlus` takes
// ln(1 + v) of a head and a rest. Neither is a builtin: no table of the op library binds them.

// 1 / n! for n from 3 to 16: the series of (e^r - 1 - r - r^2 / 2) / r^3.
const E3: f64 = 0.16666666666666666;
const E4: f64 = 0.041666666666666664;
const E5: f64 = 0.008333333333333333;
const E6: f64 = 0.001388888888888889;
const E7: f64 = 0.0001984126984126984;
const E8: f64 = 2.48015873015873e-05;
const E9: f64 = 2.7557319223985893e-06;
const E10: f64 = 2.755731922398589e-07;
const E11: f64 = 2.505210838544172e-08;
const E12: f64 = 2.08767569878681e-09;
const E13: f64 = 1.6059043836821613e-10;
const E14: f64 = 1.1470745597729725e-11;
const E15: f64 = 7.647163731819816e-13;
const E16: f64 = 4.779477332387385e-14;
// 2 / (2 n + 1) for n from 1 to 12: the series of (ln((1 + s) / (1 - s)) - 2 s) / s.
const LS3: f64 = 0.6666666666666666;
const LS5: f64 = 0.4;
const LS7: f64 = 0.2857142857142857;
const LS9: f64 = 0.2222222222222222;
const LS11: f64 = 0.18181818181818182;
const LS13: f64 = 0.15384615384615385;
const LS15: f64 = 0.13333333333333333;
const LS17: f64 = 0.11764705882352941;
const LS19: f64 = 0.10526315789473684;
const LS21: f64 = 0.09523809523809523;
const LS23: f64 = 0.08695652173913043;
const LS25: f64 = 0.08;

/** The rest of a + b: (a + b) - fl(a + b), exactly (Knuth). */
function sumErr(a: f64, b: f64): f64 {
  const s = a + b;
  const bb = s - a;
  return (a - (s - bb)) + (b - bb);
}

/** The rest of a * b: a * b - fl(a * b), exactly (Dekker), for a product that does not
 *  overflow and whose parts do not fall below the smallest normal value. */
function prodErr(a: f64, b: f64): f64 {
  const p = a * b;
  const ca = SPLIT * a;
  const ah = ca - (ca - a);
  const al = a - ah;
  const cb = SPLIT * b;
  const bh = cb - (cb - b);
  const bl = b - bh;
  return ((ah * bh - p) + ah * bl + al * bh) + al * bl;
}

/** sinh(a) for mode 0, cosh(a) for mode 1, and tanh(a / 2) for mode 2, for 2^-28 <= a < 711.
 *
 *  a = k ln 2 + r with |r| <= ln 2 / 2, where k ln 2 is exact in its head and r is a head r1
 *  and a rest rl. p = e^r - 1 = r + r^2 / 2 + r^3 S(r) is a head and a rest: r^2 is an exact
 *  product, and the series S rounds far below the result's unit. Then e^a = 2^k (1 + p) and
 *  e^a - 1 = (2^k - 1) + 2^k p, each a head and a rest, and
 *
 *    sinh(a) = (M + M / (1 + M)) / 2 with M = e^a - 1, for a < 22;
 *    cosh(a) = (E + 1 / E) / 2 with E = e^a, for a < 22;
 *    tanh(a / 2) = M / (M + 2);
 *    sinh(a) and cosh(a) = E / 2 from 22, where e^-a is below 2^-63 of the result.
 *
 *  Each quotient is a head and a rest: the rest of the division is exact by Dekker's product. */
function hyperbolic(a: f64, mode: i32): f64 {
  let k: i32 = 0;
  let r1 = a;
  let rl: f64 = 0.0;
  if (a > 0.34657359027997264) {
    k = __f64ToI32(INVLN2 * a + 0.5);
    const kf: f64 = f64(f32(k));
    // kf * LN2HI is exact: LN2HI has 32 bits and k at most 11. The difference is exact.
    const rh = a - kf * LN2HI;
    const t = kf * LN2LO;
    r1 = rh - t;
    rl = sumErr(rh, -t);
  }
  // p = e^r - 1 as p1 + p2.
  const q = r1 * r1;
  const qe = prodErr(r1, r1);
  const ser = E3 + r1 * (E4 + r1 * (E5 + r1 * (E6 + r1 * (E7 + r1 * (E8 + r1 * (E9 + r1 * (E10 + r1 * (E11 + r1 * (E12 + r1 * (E13 + r1 * (E14 + r1 * (E15 + r1 * E16))))))))))));
  const h = 0.5 * q;
  const c1 = r1 + h;
  const c2 = sumErr(r1, h) + (rl + (0.5 * qe + (r1 * rl + q * r1 * ser)));
  // c2 holds r^3 S, which is not small beside c1: the sum is normalized into a head and a rest.
  const p1 = c1 + c2;
  const p2 = sumErr(c1, c2);
  if ((mode != 2 && a >= 22.0) || (mode == 2 && k > 50)) {
    // e^a as one rounding of 1 + p, then scaled exactly.
    const e1 = 1.0 + p1;
    const ev = e1 + (sumErr(1.0, p1) + p2);
    if (mode == 2) {
      // tanh(a / 2) = 1 - 2 / (e^a + 1), and 2 / (e^a + 1) is below 2^-50.
      return 1.0 - 2.0 / (scale(ev, k) + 1.0);
    }
    return scale(ev, k - 1);
  }
  // 2^k, exactly; k is at most 50 here.
  const u = __f64FromWords(u32(0x3ff + k) << 20, u32(0));
  if (mode == 1) {
    // E = 2^k (1 + p), and 1 / E.
    const e1 = (1.0 + p1) * u;
    const e2 = (sumErr(1.0, p1) + p2) * u;
    const i1 = 1.0 / e1;
    const i2 = (((1.0 - i1 * e1) - prodErr(i1, e1)) - i1 * e2) * i1;
    const e3 = e1 + i1;
    return 0.5 * (e3 + (sumErr(e1, i1) + (e2 + i2)));
  }
  // M = e^a - 1 = (2^k - 1) + 2^k p. 2^k - 1 is exact for k up to 53.
  let m1 = p1;
  let m2 = p2;
  if (k != 0) {
    const um = u - 1.0;
    const b = u * p1;
    m1 = um + b;
    m2 = sumErr(um, b) + u * p2;
  }
  if (mode == 2) {
    // M / (M + 2).
    const d1 = 2.0 + m1;
    const d2 = sumErr(2.0, m1) + m2;
    const g1 = m1 / d1;
    const g2 = ((((m1 - g1 * d1) - prodErr(g1, d1)) + m2) - g1 * d2) / d1;
    return g1 + g2;
  }
  // (M + M / (1 + M)) / 2.
  const d1 = 1.0 + m1;
  const d2 = sumErr(1.0, m1) + m2;
  const g1 = m1 / d1;
  const g2 = ((((m1 - g1 * d1) - prodErr(g1, d1)) + m2) - g1 * d2) / d1;
  const s1 = m1 + g1;
  return 0.5 * (s1 + (sumErr(m1, g1) + (m2 + g2)));
}

/** ln(1 + v1 + v2) + j ln 2 for v1 + v2 >= 2^-29, rounded once, where v2 is the rest of v1.
 *
 *  Below 0.4142 the series runs on v itself. From there 1 + v = 2^k m with m in
 *  [sqrt(2) / 2, sqrt(2)), and the series runs on f = m - 1, which is exact. The series is
 *  ln(1 + f) = 2 s + s R(s^2) with s = f / (2 + f), |s| <= 0.1716, as a head and a rest. The
 *  sum with k ln 2 is a head and a rest too. */
function lnOnePlus(v1: f64, v2: f64, j: i32): f64 {
  let f1 = v1;
  let f2 = v2;
  let k: i32 = 0;
  if (v1 >= 0.41421356237309503) {
    // 1 + v as w1 + w2, normalized.
    const a1 = 1.0 + v1;
    const a2 = sumErr(1.0, v1) + v2;
    const w1 = a1 + a2;
    const w2 = sumErr(a1, a2);
    // The exponent of w1, with the bias that puts m in [sqrt(2) / 2, sqrt(2)).
    k = i32((__f64Hi(w1) + 0x00095f62) >> 20) - 0x3ff;
    const m1 = scale(w1, -k);
    f1 = m1 - 1.0;
    f2 = scale(w2, -k);
  }
  // s = f / (2 + f) as s1 + s2.
  const d1 = 2.0 + f1;
  const d2 = sumErr(2.0, f1) + f2;
  const s1 = f1 / d1;
  const s2 = ((((f1 - s1 * d1) - prodErr(s1, d1)) + f2) - s1 * d2) / d1;
  const z = s1 * s1;
  const t = s1 * (z * (LS3 + z * (LS5 + z * (LS7 + z * (LS9 + z * (LS11 + z * (LS13 + z * (LS15 + z * (LS17 + z * (LS19 + z * (LS21 + z * (LS23 + z * LS25))))))))))));
  const l1 = 2.0 * s1;
  const l2 = 2.0 * s2 + t;
  const kj = k + j;
  if (kj == 0) {
    return l1 + l2;
  }
  // + (k + j) ln 2, whose head kf * LN2HI is exact.
  const kf: f64 = f64(f32(kj));
  const a1 = kf * LN2HI;
  const h = a1 + l1;
  return h + (sumErr(a1, l1) + (kf * LN2LO + l2));
}

/** The rest of the square root of q1 + q2, given its head s1. */
function sqrtRest(q1: f64, q2: f64, s1: f64): f64 {
  return (((q1 - s1 * s1) - prodErr(s1, s1)) + q2) / (2.0 * s1);
}

/** sinh(x) for an f64. The error is under 1 ULP. */
export function sinhF64(x: f64): f64 {
  const hw = __f64Hi(x);
  const ix = hw & 0x7fffffff;
  if (ix >= 0x7ff00000) {
    return x + x;
  }
  if (ix < 0x3e300000) {
    // |x| < 2^-28: sinh(x) rounds to x.
    return x;
  }
  let ax = x;
  if (hw >= 0x80000000) {
    ax = -x;
  }
  let r: f64 = 0.0;
  if (ax > 711.0) {
    r = ax * two1023();
  } else {
    r = hyperbolic(ax, 0);
  }
  if (hw >= 0x80000000) {
    return -r;
  }
  return r;
}

/** cosh(x) for an f64. The error is under 1 ULP. */
export function coshF64(x: f64): f64 {
  const ix = __f64Hi(x) & 0x7fffffff;
  if (ix >= 0x7ff00000) {
    return x * x;
  }
  if (ix < 0x3e300000) {
    // |x| < 2^-28: cosh(x) rounds to 1.
    return 1.0;
  }
  let ax = x;
  if (x < 0.0) {
    ax = -x;
  }
  if (ax > 711.0) {
    return ax * two1023();
  }
  return hyperbolic(ax, 1);
}

/** tanh(x) for an f64. The error is under 1 ULP. */
export function tanhF64(x: f64): f64 {
  const hw = __f64Hi(x);
  const ix = hw & 0x7fffffff;
  const neg = hw >= 0x80000000;
  if (ix >= 0x7ff00000) {
    if (x != x) {
      return x;
    }
    if (neg) {
      return -1.0;
    }
    return 1.0;
  }
  if (ix < 0x3e300000) {
    // |x| < 2^-28: tanh(x) rounds to x.
    return x;
  }
  let ax = x;
  if (neg) {
    ax = -x;
  }
  let z: f64 = 1.0;
  if (ax < 22.0) {
    z = hyperbolic(2.0 * ax, 2);
  }
  if (neg) {
    return -z;
  }
  return z;
}

/** asinh(x) for an f64. The error is under 1 ULP. ln(|x| + sqrt(x^2 + 1)) = ln(1 + v) with
 *  v = |x| + x^2 / (1 + sqrt(1 + x^2)), as a head and a rest; from 2^28, ln(2 |x|). */
export function asinhF64(x: f64): f64 {
  const hw = __f64Hi(x);
  const ix = hw & 0x7fffffff;
  if (ix >= 0x7ff00000) {
    return x + x;
  }
  if (ix < 0x3e300000) {
    // |x| < 2^-28: asinh(x) rounds to x.
    return x;
  }
  let ax = x;
  if (hw >= 0x80000000) {
    ax = -x;
  }
  let w: f64 = 0.0;
  if (ix >= 0x41b00000) {
    // |x| >= 2^28: ln(|x|) + ln 2; the next term, 1 / (4 x^2), is below 2^-62 of it.
    w = lnOnePlus(ax, -1.0, 1);
  } else {
    const t1 = ax * ax;
    const t2 = prodErr(ax, ax);
    const q1 = 1.0 + t1;
    const q2 = sumErr(1.0, t1) + t2;
    const s1 = sqrt(q1);
    const s2 = sqrtRest(q1, q2, s1);
    const d1 = 1.0 + s1;
    const d2 = sumErr(1.0, s1) + s2;
    const g1 = t1 / d1;
    const g2 = ((((t1 - g1 * d1) - prodErr(g1, d1)) + t2) - g1 * d2) / d1;
    w = lnOnePlus(ax + g1, sumErr(ax, g1) + g2, 0);
  }
  if (hw >= 0x80000000) {
    return -w;
  }
  return w;
}

/** acosh(x) for an f64. The error is under 1 ULP. ln(x + sqrt(x^2 - 1)) = ln(1 + v) with
 *  t = x - 1, which is exact, and v = t + sqrt(t^2 + 2 t), as a head and a rest; from 2^28,
 *  ln(2 x). */
export function acoshF64(x: f64): f64 {
  const hw = __f64Hi(x);
  if (hw < 0x3ff00000 || hw >= 0x80000000) {
    // x < 1, a negative x, or a NaN with its sign bit set.
    return (x - x) / (x - x);
  }
  if (hw >= 0x7ff00000) {
    return x + x;
  }
  if (hw == 0x3ff00000 && __f64Lo(x) == 0) {
    return 0.0;
  }
  if (hw >= 0x41b00000) {
    // x >= 2^28: ln(x) + ln 2; the next term, -1 / (4 x^2), is below 2^-62 of it.
    return lnOnePlus(x, -1.0, 1);
  }
  const t = x - 1.0;
  const q1 = t * t;
  const qe = prodErr(t, t);
  const u = 2.0 * t;
  const w1 = q1 + u;
  const w2 = sumErr(q1, u) + qe;
  const s1 = sqrt(w1);
  const s2 = sqrtRest(w1, w2, s1);
  return lnOnePlus(t + s1, sumErr(t, s1) + s2, 0);
}

/** atanh(x) for an f64. The error is under 1 ULP. ln((1 + |x|) / (1 - |x|)) / 2 = ln(1 + v) / 2
 *  with v = 2 |x| / (1 - |x|), as a head and a rest. */
export function atanhF64(x: f64): f64 {
  const hw = __f64Hi(x);
  const ix = hw & 0x7fffffff;
  let ax = x;
  if (hw >= 0x80000000) {
    ax = -x;
  }
  if (ax > 1.0 || x != x) {
    // |x| > 1 or a NaN.
    return (x - x) / (x - x);
  }
  if (ax == 1.0) {
    return x / (ax - 1.0);
  }
  if (ix < 0x3e300000) {
    // |x| < 2^-28: atanh(x) rounds to x.
    return x;
  }
  const d1 = 1.0 - ax;
  const d2 = sumErr(1.0, -ax);
  const n = 2.0 * ax;
  const g1 = n / d1;
  const g2 = (((n - g1 * d1) - prodErr(g1, d1)) - g1 * d2) / d1;
  const r = 0.5 * lnOnePlus(g1, g2, 0);
  if (hw >= 0x80000000) {
    return -r;
  }
  return r;
}

// ═══ pow ═══
//
// fdlibm's `e_pow.c` (version 5.3, which gives Java's special values, and so ECMA-262's), with
// its coefficients. log2(|x|) is a head t1 of 32 bits and a tail t2; y is a head y1 of 32 bits
// and a tail; the product y * log2(|x|) is a head and a tail too, and 2 to that power is the
// kernel of `exp` on the rest times ln 2, scaled by `scale`. The special values are those of
// ECMA-262's Number::exponentiate, which is what the engine's `Math.pow` gives (Rule 1.3):
// x^0 is 1 for a NaN x, (+-1)^(+-Infinity) is a NaN, and a negative x with an odd integer y
// keeps the sign. One difference from fdlibm: for |y| > 2^31 and x within 2^-20 of 1, fdlibm
// takes log2(x) from the series t - t^2 / 2 + t^3 / 3 - t^4 / 4 of t = x - 1, and the product of
// t by the 24 bits of 1 / ln 2 is not exact when t has more than 29 bits. Measured against MPFR,
// it gave 670 ULP for 1.0000001684596314^4204925455.0672526. Here every x takes the general
// reduction. Every result is scaled by `scale` (musl's `scalbn`): exact for a normal result, and
// one rounding for a subnormal one, as fdlibm's `scalbn` gives; no result changes.

// 1.5, and log2(1.5) as a head of 32 bits and a tail.
const BP1: f64 = 1.5;
const DPH1: f64 = 5.84962487220764160156e-01;
const DPL1: f64 = 1.35003920212974897128e-08;
// The kernel of (3 / 2) (log(x) - 2 s - (2 / 3) s^3) / s^5 (fdlibm).
const PL1: f64 = 5.99999999999994648725e-01;
const PL2: f64 = 4.28571428578550184252e-01;
const PL3: f64 = 3.33333329818377432918e-01;
const PL4: f64 = 2.72728123808534006489e-01;
const PL5: f64 = 2.30660745775561754067e-01;
const PL6: f64 = 2.06975017800338417784e-01;
// ln 2 as a head of 32 bits and a tail.
const LG2H: f64 = 6.93147182464599609375e-01;
const LG2L: f64 = -1.90465429995776804525e-09;
// -(1024 - log2(the largest finite value + 1/2 ULP)).
const OVT: f64 = 8.0085662595372944372e-17;
// 2 / (3 ln 2), rounded, and as a head of 32 bits and a tail.
const CP: f64 = 9.61796693925975554329e-01;
const CPH: f64 = 9.61796700954437255859e-01;
const CPL: f64 = -7.02846165095275826516e-09;
// 2^53.
const TWO53: f64 = 9007199254740992;

/** The f64 with the high word of `v` and a low word of 0: a head of 21 bits past the point. */
function head(v: f64): f64 {
  return __f64FromWords(__f64Hi(v), u32(0));
}

/** x^y for an f64. The error is under 1 ULP; an integer power that is representable is exact.
 *  The special values are ECMA-262's (Number::exponentiate). */
export function powF64(x: f64, y: f64): f64 {
  const hx = __f64Hi(x);
  const lx = __f64Lo(x);
  const hy = __f64Hi(y);
  const ly = __f64Lo(y);
  const ix = hx & 0x7fffffff;
  const iy = hy & 0x7fffffff;
  const xneg = hx >= 0x80000000;
  const yneg = hy >= 0x80000000;
  // x^(+-0) is 1, for a NaN x too.
  if ((iy | ly) == 0) {
    return 1.0;
  }
  // A NaN operand gives a NaN.
  if (ix > 0x7ff00000 || (ix == 0x7ff00000 && lx != 0) || iy > 0x7ff00000 || (iy == 0x7ff00000 && ly != 0)) {
    return x + y;
  }
  // For a negative x: yint is 0 when y is no integer, 1 when it is an odd one, 2 when even.
  let yint: i32 = 0;
  if (xneg) {
    if (iy >= 0x43400000) {
      yint = 2;
    } else if (iy >= 0x3ff00000) {
      const e = (iy >> 20) - 0x3ff;
      if (e > 20) {
        const jl = ly >> (52 - e);
        if ((jl << (52 - e)) == ly) {
          yint = 2 - i32(jl & 1);
        }
      } else if (ly == 0) {
        const jh = iy >> (20 - e);
        if ((jh << (20 - e)) == iy) {
          yint = 2 - i32(jh & 1);
        }
      }
    }
  }
  // y is +-Infinity, +-1, 2 or 1/2.
  if (ly == 0) {
    if (iy == 0x7ff00000) {
      if (((ix - 0x3ff00000) | lx) == 0) {
        // (+-1)^(+-Infinity) is a NaN.
        return y - y;
      }
      if (ix >= 0x3ff00000) {
        // |x| > 1: +Infinity, or +0 for -Infinity.
        if (yneg) {
          return 0.0;
        }
        return y;
      }
      // |x| < 1: +0, or +Infinity for -Infinity.
      if (yneg) {
        return -y;
      }
      return 0.0;
    }
    if (iy == 0x3ff00000) {
      if (yneg) {
        return 1.0 / x;
      }
      return x;
    }
    if (hy == 0x40000000) {
      return x * x;
    }
    if (hy == 0x3fe00000 && !xneg) {
      return sqrt(x);
    }
  }
  let ax = x;
  if (xneg) {
    ax = -x;
  }
  // x is +-0, +-Infinity or +-1.
  if (lx == 0 && (ix == 0x7ff00000 || ix == 0 || ix == 0x3ff00000)) {
    let z = ax;
    if (yneg) {
      z = 1.0 / z;
    }
    if (xneg) {
      if (ix == 0x3ff00000 && yint == 0) {
        // (-1)^y for a y that is no integer is a NaN.
        return (z - z) / (z - z);
      }
      if (yint == 1) {
        z = -z;
      }
    }
    return z;
  }
  // A negative x with a y that is no integer gives a NaN.
  if (xneg && yint == 0) {
    return (x - x) / (x - x);
  }
  // The sign of the result: negative for a negative x and an odd y.
  let s: f64 = 1.0;
  if (xneg && yint == 1) {
    s = -1.0;
  }
  if (iy > 0x41e00000) {
    // |y| > 2^31.
    if (iy > 0x43f00000) {
      // |y| > 2^64: the result overflows or underflows.
      if (ix <= 0x3fefffff) {
        if (yneg) {
          return two1023() * 2.0;
        }
        return 0.0;
      }
      if (yneg) {
        return 0.0;
      }
      return two1023() * 2.0;
    }
    // It overflows or underflows unless x is near 1.
    if (ix < 0x3fefffff) {
      if (yneg) {
        return s * two1023() * 2.0;
      }
      return s * 0.0;
    }
    if (ix > 0x3ff00000) {
      if (yneg) {
        return s * 0.0;
      }
      return s * two1023() * 2.0;
    }
  }
  let e: i32 = 0;
  let jx = ix;
  let m = ax;
  if (jx < 0x00100000) {
    // A subnormal x: scale it up.
    m = m * TWO53;
    e = -53;
    jx = __f64Hi(m);
  }
  e = e + i32(jx >> 20) - 0x3ff;
  const jm = jx & 0x000fffff;
  // m in [1, 2), then k = 1 for m in [sqrt(3/2), sqrt(3)), and m / 2 from sqrt(3).
  jx = jm | 0x3ff00000;
  let k: u32 = u32(0);
  if (jm > 0x3988e) {
    if (jm < 0xbb67a) {
      k = u32(1);
    } else {
      e = e + 1;
      jx = jx - 0x00100000;
    }
  }
  m = __f64FromWords(jx, __f64Lo(m));
  let bp: f64 = 1.0;
  let dph: f64 = 0.0;
  let dpl: f64 = 0.0;
  if (k == 1) {
    bp = BP1;
    dph = DPH1;
    dpl = DPL1;
  }
  // ss = (m - bp) / (m + bp) as sh + sl.
  const lu = m - bp;
  const lv = 1.0 / (m + bp);
  const ss = lu * lv;
  const sh = head(ss);
  // m + bp: its head, made from the words of m, and its tail.
  const th = __f64FromWords(((jx >> 1) | 0x20000000) + 0x00080000 + (k << 18), u32(0));
  const tl = m - (th - bp);
  const sl = lv * ((lu - sh * th) - sh * tl);
  // log(m / bp).
  let s2 = ss * ss;
  let lr = s2 * s2 * (PL1 + s2 * (PL2 + s2 * (PL3 + s2 * (PL4 + s2 * (PL5 + s2 * PL6)))));
  lr = lr + sl * (sh + ss);
  s2 = sh * sh;
  const th2 = head(3.0 + s2 + lr);
  const tl2 = lr - ((th2 - 3.0) - s2);
  // ss (1 + ...) as u2 + v2, and 2 / (3 ln 2) times it.
  const u2 = sh * th2;
  const v2 = sl * th2 + tl2 * ss;
  const lph = head(u2 + v2);
  const lpl = v2 - (lph - u2);
  const zh = CPH * lph;
  const zl = CPL * lph + lpl * CP + dpl;
  // log2(|x|) = e + dph + zh + zl.
  const tn: f64 = f64(f32(e));
  // log2(|x|) as t1 + t2, with t1 of 32 bits.
  const t1 = head(((zh + zl) + dph) + tn);
  const t2 = zl - (((t1 - tn) - dph) - zh);
  // y = y1 + y2 with y1 of 32 bits, and (y1 + y2) (t1 + t2) as ph + pl.
  const y1 = __f64FromWords(hy, u32(0));
  const pl = (y - y1) * t1 + y * t2;
  let ph = y1 * t1;
  const z = pl + ph;
  const j = __f64Hi(z);
  const i = __f64Lo(z);
  if (j >= 0x40900000 && j < 0x80000000) {
    // z >= 1024.
    if (((j - 0x40900000) | i) != 0) {
      return s * two1023() * 2.0;
    }
    if (pl + OVT > z - ph) {
      return s * two1023() * 2.0;
    }
  } else if ((j & 0x7fffffff) >= 0x4090cc00) {
    // z <= -1075.
    if (((j - 0xc090cc00) | i) != 0) {
      return s * 0.0;
    }
    if (pl <= z - ph) {
      return s * 0.0;
    }
  }
  // 2^z: n is the nearest integer to z for |z| > 1/2, and 2^(z - n) by the kernel of exp.
  const iz = j & 0x7fffffff;
  let n: i32 = 0;
  if (iz > 0x3fe00000) {
    const k = i32(iz >> 20) - 0x3ff;
    const nw = j + (u32(0x00100000) >> u32(k + 1));
    const kn = i32((nw & 0x7fffffff) >> 20) - 0x3ff;
    const t = __f64FromWords(nw & ((u32(0x000fffff) >> u32(kn)) ^ 0xffffffff), u32(0));
    n = i32(((nw & 0x000fffff) | 0x00100000) >> u32(20 - kn));
    if (j >= 0x80000000) {
      n = -n;
    }
    ph = ph - t;
  }
  const t = head(pl + ph);
  const u = t * LG2H;
  const v = (pl - (t - ph)) * LN2 + t * LG2L;
  const zr = u + v;
  const w = v - (zr - u);
  const tt = zr * zr;
  const c = zr - tt * (P1 + tt * (P2 + tt * (P3 + tt * (P4 + tt * P5))));
  const r = (zr * c) / (c - 2.0) - (w + zr * w);
  return s * scale(1.0 - (r - zr), n);
}
