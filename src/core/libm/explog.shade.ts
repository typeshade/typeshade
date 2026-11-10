"use typeshade";

// ═══ The libm: exp, exp2, log, log2 and ldexp (change 0042, milestone 1a) ═══
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
// The promise is an error under 1 ULP for `exp`, `exp2`, `log` and `log2` (decision N9).
// `ldexp` is exact scaling with one rounding, so it is correctly rounded.
//
// The methods are those of fdlibm, as FreeBSD and musl carry them: `e_exp.c`, `e_log.c` and
// `e_log2.c` with their coefficients, and musl's `scalbn.c` for the scaling. `exp2` is this
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
