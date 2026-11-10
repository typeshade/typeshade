"use typeshade";

// ═══ The libm: asin, acos, atan and atan2 (change 0042, milestone 1a) ═══
//
// A NOTE FOR A READER IN AN EDITOR. The language service reports `TS8004 Unknown function` on
// `__f64Hi`, `__f64Lo` and `__f64FromWords` in this file. That is correct for an author's file:
// the names are compiler-internal operations, and no author can write them
// (`src/compiler/ts/internal-ops.ts`). Only `compileLibmSource` lowers them, and
// `src/core/libm/invtrig.test.ts` holds that this file compiles there with no diagnostic.
//
// One source for both code generators (decision N14). `scripts/bake-libm.ts` writes the
// JavaScript form, `invtrig.generated.ts`, from this file. The interpreter and the generated
// JavaScript of the CPU tier call that form in place of the engine's `Math.asin`, `Math.acos`,
// `Math.atan` and `Math.atan2`. `tan` is in `trig.shade.ts`, with the reductions it shares.
//
// The routines take and return an `f64`. The result for an `f32` operand is the same routine's
// result rounded once to `f32` (the owner's decision of 2026-11-10); there is no `f32` routine.
//
// The promise is an error under 1 ULP for each routine (decision N9). No routine claims a
// correctly rounded result.
//
// A routine uses `f64` `+ - * /` and `sqrt`, comparisons, `i32` and `u32` arithmetic, and the
// compiler-internal operations of `src/compiler/ts/internal-ops.ts`: the two words of an `f64`.
// It uses no 64-bit integer and no `fma`.
//
// The methods are the published ones: fdlibm's `e_asin.c`, `e_acos.c`, `s_atan.c` and
// `e_atan2.c`, as FreeBSD and musl carry them, with their coefficients. `asin` and `acos` each
// differ from fdlibm in one step, which gives the result one rounding less. `atan2` differs from
// fdlibm in two steps, which `atan2F64` describes: the error of the quotient y / x is put back,
// and a result past pi/2 is one sum, not the difference of pi and a rounded arctangent. Every
// constant derived from pi is held to a BigInt computation by `invtrig.test.ts`. The notice of
// fdlibm, whose methods and coefficients these are:
//
//   Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
//   Developed at SunSoft, a Sun Microsystems, Inc. business.
//   Permission to use, copy, modify, and distribute this software is freely granted,
//   provided that this notice is preserved.

// pi/2 rounded and the rest rounded; pi/4 rounded; pi rounded and the rest rounded.
const PIO2H: f64 = 1.57079632679489655800e+00;
const PIO2L: f64 = 6.12323399573676603587e-17;
const PIO4H: f64 = 7.85398163397448278999e-01;
const PIH: f64 = 3.14159265358979311600e+00;
const PIL: f64 = 1.2246467991473531772e-16;
// 3 pi/4 rounded.
const PI3O4: f64 = 2.356194490192345;

// The rational approximation of (asin(x) - x) / x^3 on [0, 0.5] (fdlibm): P(t) / Q(t), t = x^2.
const PS0: f64 = 1.66666666666666657415e-01;
const PS1: f64 = -3.25565818622400915405e-01;
const PS2: f64 = 2.01212532134862925881e-01;
const PS3: f64 = -4.00555345006794114027e-02;
const PS4: f64 = 7.91534994289814532176e-04;
const PS5: f64 = 3.47933107596021167570e-05;
const QS1: f64 = -2.40339491173441421878e+00;
const QS2: f64 = 2.02094576023350569471e+00;
const QS3: f64 = -6.88283971605453293030e-01;
const QS4: f64 = 7.70381505559019352791e-02;

// atan(0.5), atan(1), atan(1.5) and atan(infinity), each rounded, and the rest of each rounded.
const ATANHI0: f64 = 4.63647609000806093515e-01;
const ATANHI1: f64 = 7.85398163397448278999e-01;
const ATANHI2: f64 = 9.82793723247329054082e-01;
const ATANHI3: f64 = 1.57079632679489655800e+00;
const ATANLO0: f64 = 2.26987774529616870924e-17;
const ATANLO1: f64 = 3.06161699786838301793e-17;
const ATANLO2: f64 = 1.39033110312309984516e-17;
const ATANLO3: f64 = 6.12323399573676603587e-17;
// pi less each of ATANHI0 to ATANHI3, rounded, and the rest of each rounded.
const FARHI0: f64 = 2.677945044588987;
const FARHI1: f64 = 2.356194490192345;
const FARHI2: f64 = 2.1587989303424644;
const FARHI3: f64 = 1.5707963267948968;
const FARLO0: f64 = 1.7797583114599315e-16;
const FARLO1: f64 = 1.2246467991473532e-16;
const FARLO2: f64 = -2.1060222747281164e-16;
const FARLO3: f64 = -9.957992501029599e-17;
// The polynomial of (x - atan(x)) / x on [0, 7/16] (fdlibm), in x^2.
const AT0: f64 = 3.33333333333329318027e-01;
const AT1: f64 = -1.99999999998764832476e-01;
const AT2: f64 = 1.42857142725034663711e-01;
const AT3: f64 = -1.11111104054623557880e-01;
const AT4: f64 = 9.09088713343650656196e-02;
const AT5: f64 = -7.69187620504482999495e-02;
const AT6: f64 = 6.66107313738753120669e-02;
const AT7: f64 = -5.83357013379057348645e-02;
const AT8: f64 = 4.97687799461593236017e-02;
const AT9: f64 = -3.65315727442169155270e-02;
const AT10: f64 = 1.62858201153657823623e-02;

// Veltkamp's splitter, 2^27 + 1.
const SPLIT: f64 = 134217729;

/** P(t) / Q(t): (asin(x) - x) / x^3 for t = x^2 <= 0.25. */
function asinRatio(t: f64): f64 {
  const p = t * (PS0 + t * (PS1 + t * (PS2 + t * (PS3 + t * (PS4 + t * PS5)))));
  const q = 1.0 + t * (QS1 + t * (QS2 + t * (QS3 + t * QS4)));
  return p / q;
}

/** asin(x) for an f64. The error is under 1 ULP.
 *
 *  Below 0.5 it is x + x^3 R(x^2). From 0.5 it is pi/2 - 2 asin(sqrt((1 - |x|) / 2)): the square
 *  root s is taken as a head w of 21 bits and the rest, so pi/2 - 2 w is exact and the rest joins
 *  a small term. From 0.975 the plain form is close enough. This differs from fdlibm in one
 *  step, which the body names. */
export function asinF64(x: f64): f64 {
  const hx = __f64Hi(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    if (ix == 0x3ff00000 && __f64Lo(x) == 0) {
      // asin(1) and asin(-1): pi/2 rounded, with the sign.
      return x * PIO2H + x * PIO2L;
    }
    // |x| > 1, an infinity or a NaN.
    return (x - x) / (x - x);
  }
  if (ix < 0x3fe00000) {
    // |x| < 2^-26: asin(x) rounds to x, and this keeps the sign of a zero.
    if (ix < 0x3e500000) {
      return x;
    }
    return x + x * asinRatio(x * x);
  }
  let ax = x;
  if (hx >= 0x80000000) {
    ax = -x;
  }
  const t = (1.0 - ax) * 0.5;
  const r = asinRatio(t);
  const s = sqrt(t);
  let res: f64 = 0.0;
  if (ix >= 0x3fef3333) {
    res = PIO2H - (2.0 * (s + s * r) - PIO2L);
  } else {
    const w = __f64FromWords(__f64Hi(s), u32(0));
    const c = (t - w * w) / (s + w);
    const p = 2.0 * s * r - (PIO2L - 2.0 * c);
    // pi/2 - 2 w is exact: w has 21 bits. fdlibm takes pi/4 - (p - (pi/4 - 2 w)), whose inner
    // difference rounds by a quarter of a unit of the result.
    res = (PIO2H - 2.0 * w) - p;
  }
  if (hx >= 0x80000000) {
    return -res;
  }
  return res;
}

/** acos(x) for an f64. The error is under 1 ULP.
 *
 *  Below 0.5 it is pi/2 - (x + x^3 R(x^2)). For x >= 0.5 it is 2 asin(sqrt((1 - x) / 2)), with
 *  the square root as a head of 21 bits and the rest. For x <= -0.5 it is
 *  pi - 2 asin(sqrt((1 + x) / 2)), with the same head and rest; this differs from fdlibm in one
 *  step, which the body names. */
export function acosF64(x: f64): f64 {
  const hx = __f64Hi(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    if (ix == 0x3ff00000 && __f64Lo(x) == 0) {
      // acos(1) is +0, and acos(-1) is pi rounded.
      if (hx >= 0x80000000) {
        return PIH + 2.0 * PIO2L;
      }
      return 0.0;
    }
    // |x| > 1, an infinity or a NaN.
    return (x - x) / (x - x);
  }
  if (ix < 0x3fe00000) {
    // |x| <= 2^-57: acos(x) rounds to pi/2.
    if (ix <= 0x3c600000) {
      return PIO2H + PIO2L;
    }
    const r = asinRatio(x * x);
    return PIO2H - (x - (PIO2L - x * r));
  }
  if (hx >= 0x80000000) {
    const z = (1.0 + x) * 0.5;
    const s = sqrt(z);
    const df = __f64FromWords(__f64Hi(s), u32(0));
    const c = (z - df * df) / (s + df);
    const w = asinRatio(z) * s + c;
    // pi - 2 df is exact: df has 21 bits. fdlibm takes pi - 2 (s + w) with the rounded root,
    // whose sum and whose root each round by a part of a unit of the result.
    return (PIH - 2.0 * df) - (2.0 * w - PIL);
  }
  const z = (1.0 - x) * 0.5;
  const s = sqrt(z);
  const df = __f64FromWords(__f64Hi(s), u32(0));
  const c = (z - df * df) / (s + df);
  const w = asinRatio(z) * s + c;
  return 2.0 * (df + w);
}

/** atan(x + e) for x >= 2^-27, or pi less that when `far`. `c` is e / (1 + x^2), the part of
 *  the result that the rest `e` of the operand gives; it is 0 for an operand with no rest.
 *
 *  fdlibm's method: below 7/16 the polynomial; above, atan(x) = atan(b) + atan((x - b) / (1 + b x))
 *  for b of 0.5, 1, 1.5 or infinity, whose arctangent is a head and a rest. `c` joins the rest
 *  before the last sum, so it costs no rounding. For `far` the head is pi less the head of
 *  atan(b), as a head and a rest of its own, so the result is one sum. */
function katan(x: f64, c: f64, far: bool): f64 {
  const ix = __f64Hi(x);
  if (ix < 0x3fdc0000) {
    const z = x * x;
    const w = z * z;
    const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
    const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));
    const r = x * (s1 + s2) - c;
    if (far) {
      return PIH - ((x - r) - PIL);
    }
    return x - r;
  }
  let t: f64 = 0.0;
  let hi = ATANHI3;
  let lo = ATANLO3;
  let farHi = FARHI3;
  let farLo = FARLO3;
  if (ix < 0x3ff30000) {
    if (ix < 0x3fe60000) {
      // 7/16 <= x < 11/16.
      t = (2.0 * x - 1.0) / (2.0 + x);
      hi = ATANHI0;
      lo = ATANLO0;
      farHi = FARHI0;
      farLo = FARLO0;
    } else {
      // 11/16 <= x < 19/16.
      t = (x - 1.0) / (x + 1.0);
      hi = ATANHI1;
      lo = ATANLO1;
      farHi = FARHI1;
      farLo = FARLO1;
    }
  } else {
    if (ix < 0x40038000) {
      // 19/16 <= x < 39/16.
      t = (x - 1.5) / (1.0 + 1.5 * x);
      hi = ATANHI2;
      lo = ATANLO2;
      farHi = FARHI2;
      farLo = FARLO2;
    } else {
      t = -1.0 / x;
    }
  }
  const z = t * t;
  const w = z * z;
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));
  // atan(x + e) is hi - r.
  const r = (t * (s1 + s2) - (lo + c)) - t;
  if (far) {
    return farHi + (r + farLo);
  }
  return hi - r;
}

/** atan(x) for an f64. The error is under 1 ULP. */
export function atanF64(x: f64): f64 {
  const hx = __f64Hi(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x44100000) {
    // |x| >= 2^66, an infinity or a NaN.
    if (x != x) {
      return x + x;
    }
    if (hx >= 0x80000000) {
      return -PIO2H;
    }
    return PIO2H;
  }
  // |x| < 2^-27: atan(x) rounds to x, and this keeps the sign of a zero.
  if (ix < 0x3e400000) {
    return x;
  }
  if (hx >= 0x80000000) {
    return -katan(-x, 0.0, false);
  }
  return katan(x, 0.0, false);
}

/** atan2(y, x) for two f64: the angle of the point (x, y), in (-pi, pi]. The error is under
 *  1 ULP.
 *
 *  The special pairs are those of ECMA-262 and IEEE 754. For two finite, non-zero operands the
 *  result is the arctangent of q = |y| / |x| in the first quadrant, or pi less it for a
 *  negative x, with the sign of y. Two steps differ from fdlibm, whose error passes 1 ULP:
 *
 *  - The quotient rounds, and the arctangent of the rounded quotient is not the arctangent of
 *    the quotient. The rest of the division is exact: |y| - q |x|, by Dekker's exact product.
 *    The kernel takes its share of the result, rest / |x| / (1 + q^2).
 *  - For a negative x the kernel gives pi less the arctangent as one sum (`katan`).
 *
 *  The operands are scaled by one power of two when both are tiny or one is huge, so no product
 *  overflows and none loses a bit to a subnormal. The scaling is exact. */
export function atan2F64(y: f64, x: f64): f64 {
  if (x != x || y != y) {
    return x + y;
  }
  const hx = __f64Hi(x);
  const hy = __f64Hi(y);
  const lx = __f64Lo(x);
  const ly = __f64Lo(y);
  const ix = hx & 0x7fffffff;
  const iy = hy & 0x7fffffff;
  const far = hx >= 0x80000000;
  const neg = hy >= 0x80000000;
  let r: f64 = 0.0;
  if ((iy | ly) == 0) {
    // y is a zero: the zero itself for a positive x or +0, and pi with its sign otherwise.
    if (!far) {
      return y;
    }
    r = PIH;
  } else if ((ix | lx) == 0) {
    r = PIO2H;
  } else if (ix == 0x7ff00000) {
    if (iy == 0x7ff00000) {
      r = PIO4H;
      if (far) {
        r = PI3O4;
      }
    } else if (far) {
      r = PIH;
    }
  } else if (iy == 0x7ff00000) {
    r = PIO2H;
  } else {
    let ax = __f64FromWords(ix, lx);
    let ay = __f64FromWords(iy, ly);
    // The difference of the exponents, rounded down.
    const k = (i32(iy) - i32(ix)) >> 20;
    if (k > 60) {
      // |y / x| > 2^60: pi/2, whose distance from the result is below 2^-60.
      r = PIO2H;
    } else if (k < -60) {
      // |y / x| < 2^-60: the quotient, or pi.
      if (far) {
        r = PIH;
      } else {
        r = ay / ax;
      }
    } else {
      if (ix > 0x5f300000 || iy > 0x5f300000) {
        // By 2^-600, written by its words: a module constant holds no value past an f32's range.
        const down = __f64FromWords(u32(0x1a700000), u32(0));
        ax = ax * down;
        ay = ay * down;
      } else if (ix < 0x26f00000 && iy < 0x26f00000) {
        // By 2^600.
        const up = __f64FromWords(u32(0x65700000), u32(0));
        ax = ax * up;
        ay = ay * up;
      }
      const q = ay / ax;
      // The rest of the division, ay - q * ax, exactly.
      const ca = SPLIT * q;
      const qh = ca - (ca - q);
      const ql = q - qh;
      const cb = SPLIT * ax;
      const xh = cb - (cb - ax);
      const xl = ax - xh;
      const p = q * ax;
      const pe = ((qh * xh - p) + qh * xl + ql * xh) + ql * xl;
      const rest = (ay - p) - pe;
      if (q < 7.450580596923828e-9) {
        // q < 2^-27: the arctangent rounds to q, or pi less it to one sum.
        r = q;
        if (far) {
          r = PIH - (q - PIL);
        }
      } else {
        r = katan(q, rest / ax / (1.0 + q * q), far);
      }
    }
  }
  if (neg) {
    return -r;
  }
  return r;
}
