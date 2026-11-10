"use typeshade";

// ═══ The libm: sin and cos, for f32 and for f64 (change 0042, milestone 1a) ═══
//
// One source for both code generators (decision N14). `scripts/bake-libm.ts` writes the
// JavaScript form, `trig.generated.ts`, from this file. The interpreter and the generated
// JavaScript of the CPU tier call that form in place of the engine's `Math.sin` and `Math.cos`.
//
// The promise is an error under 1 ULP for each routine (decision N9). No routine claims a
// correctly rounded result.
//
// A routine uses `f64` `+ - * /` and `floor`, comparisons, `i32` and `u32` arithmetic, constant
// tables, and the compiler-internal operations of `src/compiler/ts/internal-ops.ts`: the two
// words of an `f64` and the exact conversions. It uses no 64-bit integer and no `fma`.
//
// The methods are the published ones. The kernels on [-pi/4, pi/4] and their coefficients are
// those of fdlibm (`k_sin.c`, `k_cos.c`) for `f64` and of FreeBSD (`k_sinf.c`, `k_cosf.c`) for
// `f32`. The reduction below 2^20 * pi/2 is Cody and Waite's, with pi/2 in three pieces of 33
// bits. The reduction above it is Payne and Hanek's, with 2/pi in pieces of 24 bits. Every
// constant derived from pi is held to a BigInt computation by `libm.test.ts`.

// The kernel of sin on [-pi/4, pi/4] (fdlibm).
const S1: f64 = -0.16666666666666632;
const S2: f64 = 0.00833333333332249;
const S3: f64 = -0.0001984126982985795;
const S4: f64 = 0.0000027557313707070068;
const S5: f64 = -2.5050760253406863e-8;
const S6: f64 = 1.58969099521155e-10;
// The kernel of cos on [-pi/4, pi/4] (fdlibm).
const C1: f64 = 0.0416666666666666;
const C2: f64 = -0.001388888888887411;
const C3: f64 = 0.00002480158728947673;
const C4: f64 = -2.7557314351390663e-7;
const C5: f64 = 2.087572321298175e-9;
const C6: f64 = -1.1359647557788195e-11;
// The kernels of an f32 result, computed in f64 (FreeBSD).
const FS1: f64 = -0.16666666641626524;
const FS2: f64 = 0.008333329385889463;
const FS3: f64 = -0.00019839334836096632;
const FS4: f64 = 0.000002718311493989822;
const FC0: f64 = -0.499999997251031;
const FC1: f64 = 0.04166662332373906;
const FC2: f64 = -0.001388676377460993;
const FC3: f64 = 0.00002439044879627741;
// 2/pi rounded, and 1.5 * 2^52: adding and subtracting it rounds an f64 to an integer.
const INVPIO2: f64 = 0.6366197723675814;
const TOINT: f64 = 6755399441055744;
// pi/2 in three pieces of 33 bits, and the rest rounded.
const P1: f64 = 1.5707963267341256;
const P2: f64 = 6.077100506303966e-11;
const P3: f64 = 2.0222662487111665e-21;
const P3T: f64 = 8.4784276603689e-32;
// pi/2 in one piece of 30 bits, and the rest rounded.
const F1: f64 = 1.570796325802803;
const F1T: f64 = 9.920935796805404e-10;
// pi/2 rounded, and the rest rounded.
const PIO2H: f64 = 1.5707963267948966;
const PIO2L: f64 = 6.123233995736766e-17;
// Powers of two.
const TWO24: f64 = 16777216;
const TWO48: f64 = 281474976710656;
const TWO72: f64 = 4.722366482869645e21;
const TWOM22: f64 = 2.384185791015625e-7;
const TWOM24: f64 = 5.960464477539063e-8;
const TWOM46: f64 = 1.4210854715202004e-14;
const TWOM48: f64 = 3.552713678800501e-15;
const TWOM70: f64 = 8.470329472543003e-22;
const TWOM72: f64 = 2.117582368135751e-22;
const TWOM94: f64 = 5.048709793414476e-29;
const TWOM118: f64 = 3.009265538105056e-36;
const TWOM142: f64 = 1.793662034335766e-43;
// Veltkamp's splitter, 2^27 + 1.
const SPLIT: f64 = 134217729;

// 2/pi in pieces of 24 bits. Piece i (i >= 1) is at index i + 1 and has the weight 2^(-24 i).
// The two leading zeros stand for the pieces 0 and -1, which 2/pi < 1 does not have.
const TWO_OVER_PI: array<f64, 52> = [
  0, 0, 10680707, 7228996, 1387004, 2578385, 16069853, 12639074,
  9804092, 4427841, 16666979, 11263675, 12935607, 2387514, 4345298, 14681673,
  3074569, 13734428, 16653803, 1880361, 10960616, 8533493, 3062596, 8710556,
  7349940, 6258241, 3772886, 3769171, 3798172, 8675211, 12450088, 3874808,
  9961438, 366607, 15675153, 9132554, 7151469, 3571407, 2607881, 12013382,
  4155038, 6285869, 7677882, 13102053, 15825725, 473591, 9065106, 15363067,
  6271263, 9264392, 5636912, 4652155,
];

/** sin(x + y) for |x| <= pi/4, where y is the tail of x. `iy` is 0 when y is 0. */
function ksin(x: f64, y: f64, iy: i32): f64 {
  const z = x * x;
  const w = z * z;
  const r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6);
  const v = z * x;
  if (iy == 0) {
    return x + v * (S1 + z * r);
  }
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

/** cos(x + y) for |x| <= pi/4, where y is the tail of x. */
function kcos(x: f64, y: f64): f64 {
  const z = x * x;
  const w = z * z;
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
  const hz = 0.5 * z;
  const w1 = 1.0 - hz;
  return w1 + (((1.0 - w1) - hz) + (z * r - x * y));
}

/** sin(x) for |x| <= pi/4, to the accuracy an f32 result needs. */
function sindf(x: f64): f64 {
  const z = x * x;
  const w = z * z;
  const r = FS3 + z * FS4;
  const s = z * x;
  return (x + s * (FS1 + z * FS2)) + s * w * r;
}

/** cos(x) for |x| <= pi/4, to the accuracy an f32 result needs. */
function cosdf(x: f64): f64 {
  const z = x * x;
  const w = z * z;
  const r = FC2 + z * FC3;
  return ((1.0 + z * FC0) + w * FC1) + (w * z) * r;
}

/** sin(n * pi/2 + y0 + y1) for |y0| <= pi/4. `single` selects the kernels of an f32 result. */
function quadrant(n: i32, y0: f64, y1: f64, single: bool): f64 {
  const q = n & 3;
  if (single) {
    if (q == 0) {
      return sindf(y0);
    }
    if (q == 1) {
      return cosdf(y0);
    }
    if (q == 2) {
      return -sindf(y0);
    }
    return -cosdf(y0);
  }
  if (q == 0) {
    return ksin(y0, y1, 1);
  }
  if (q == 1) {
    return kcos(y0, y1);
  }
  if (q == 2) {
    return -ksin(y0, y1, 1);
  }
  return -kcos(y0, y1);
}

/** sin(x + k * pi/2) for an f64 with pi/4 < |x| < 2^20 * pi/2. Cody and Waite: x - fn * pi/2
 *  with pi/2 in three pieces of 33 bits, so each product by a piece is exact. */
function reduceMedium(x: f64, k: i32): f64 {
  const fn = (x * INVPIO2 + TOINT) - TOINT;
  const r1 = x - fn * P1;
  const w2 = fn * P2;
  const r2 = r1 - w2;
  const e2 = (r1 - r2) - w2;
  const w3 = fn * P3;
  const r3 = r2 - w3;
  const e3 = (r2 - r3) - w3;
  const w = fn * P3T - (e2 + e3);
  const y0 = r3 - w;
  const y1 = (r3 - y0) - w;
  return quadrant(__f64ToI32(fn) + k, y0, y1, false);
}

/** sin(|x| + k * pi/2) for a finite f64 with |x| >= 2^20, whose words are `hi` and `lo`. Payne
 *  and Hanek: the product of |x| and 2/pi, modulo 4, in digits of 24 bits.
 *
 *  |x| is M * 2^E with M an integer below 2^53. A piece of 2/pi whose product with M is a
 *  multiple of 4 is left out, so the first piece used has the index i0 = floor((E + 22) / 24).
 *  X = M * 2^((E + 22) mod 24) is an integer below 2^76 with the digits a3, a2, a1 and a0. The
 *  ten pieces c0 to c9 from i0 give seven columns of the product X * (c0 + c1 * 2^-24 + ...),
 *  from the weight 1 down to the weight 2^-144. A column of a higher weight is a multiple of
 *  2^24, which is a multiple of 4 once the product is scaled by 2^-22. The columns left out
 *  are below 2^-140 of a quarter turn. The nearest that a finite f64 comes to a multiple of
 *  pi/2 is above 2^-62 of a quarter turn, so the result keeps over 70 bits. */
function reduceLarge(hi: u32, lo: u32, k: i32, single: bool): f64 {
  const be = (hi >> 20) & 0x7ff;
  const t = (be - 1005) / 24 - 1;
  const sh = (be - 1005) % 24;
  const X = __f64FromWords((hi & 0x000fffff) | ((1075 + sh) << 20), lo);
  const a3 = floor(X * TWOM72);
  const x2 = X - a3 * TWO72;
  const a2 = floor(x2 * TWOM48);
  const x1 = x2 - a2 * TWO48;
  const a1 = floor(x1 * TWOM24);
  const a0 = x1 - a1 * TWO24;
  const c0 = TWO_OVER_PI[t];
  const c1 = TWO_OVER_PI[t + 1];
  const c2 = TWO_OVER_PI[t + 2];
  const c3 = TWO_OVER_PI[t + 3];
  const c4 = TWO_OVER_PI[t + 4];
  const c5 = TWO_OVER_PI[t + 5];
  const c6 = TWO_OVER_PI[t + 6];
  const c7 = TWO_OVER_PI[t + 7];
  const c8 = TWO_OVER_PI[t + 8];
  const c9 = TWO_OVER_PI[t + 9];
  // Each product is below 2^48 and each column below 2^50, so every sum is exact.
  const d6 = a0 * c6 + a1 * c7 + a2 * c8 + a3 * c9;
  const k6 = floor(d6 * TWOM24);
  const d5 = a0 * c5 + a1 * c6 + a2 * c7 + a3 * c8 + k6;
  const k5 = floor(d5 * TWOM24);
  let e5 = d5 - k5 * TWO24;
  const d4 = a0 * c4 + a1 * c5 + a2 * c6 + a3 * c7 + k5;
  const k4 = floor(d4 * TWOM24);
  let e4 = d4 - k4 * TWO24;
  const d3 = a0 * c3 + a1 * c4 + a2 * c5 + a3 * c6 + k4;
  const k3 = floor(d3 * TWOM24);
  let e3 = d3 - k3 * TWO24;
  const d2 = a0 * c2 + a1 * c3 + a2 * c4 + a3 * c5 + k3;
  const k2 = floor(d2 * TWOM24);
  let e2 = d2 - k2 * TWO24;
  const d1 = a0 * c1 + a1 * c2 + a2 * c3 + a3 * c4 + k2;
  const k1 = floor(d1 * TWOM24);
  let e1 = d1 - k1 * TWO24;
  const d0 = a0 * c0 + a1 * c1 + a2 * c2 + a3 * c3 + k1;
  const e0 = d0 - floor(d0 * TWOM24) * TWO24;
  // The top two bits of e0 are the quadrant, and the 22 bits below start the fraction.
  const q = floor(e0 * TWOM22);
  let f0 = e0 - q * 4194304.0;
  let n = __f64ToI32(q);
  // A fraction of a half or more is the next quadrant less its complement.
  const up = f0 >= 2097152.0;
  if (up) {
    n = n + 1;
    f0 = 4194303.0 - f0;
    e1 = 16777215.0 - e1;
    e2 = 16777215.0 - e2;
    e3 = 16777215.0 - e3;
    e4 = 16777215.0 - e4;
    e5 = 16777216.0 - e5;
  }
  // The fraction as three exact sums, then as a head and a tail.
  const z0 = f0 * TWOM22 + e1 * TWOM46;
  const z1 = e2 * TWOM70 + e3 * TWOM94;
  const z2 = e4 * TWOM118 + e5 * TWOM142;
  const s0 = z0 + z1;
  const s1 = ((z0 - s0) + z1) + z2;
  const fh = s0 + s1;
  const fl = (s0 - fh) + s1;
  // The fraction times pi/2, by Dekker's exact product of the two heads.
  const ca = SPLIT * fh;
  const ah = ca - (ca - fh);
  const al = fh - ah;
  const cb = SPLIT * PIO2H;
  const bh = cb - (cb - PIO2H);
  const bl = PIO2H - bh;
  const p = fh * PIO2H;
  const pe = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
  const tail = pe + (fh * PIO2L + fl * PIO2H);
  let y0 = p + tail;
  let y1 = (p - y0) + tail;
  if (up) {
    y0 = -y0;
    y1 = -y1;
  }
  return quadrant(n + k, y0, y1, single);
}

/** sin(x) for an f64. The error is under 1 ULP. */
export function sinF64(x: f64): f64 {
  const hi = __f64Hi(x);
  const ix = hi & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    // |x| < 2^-26: sin(x) rounds to x, and this keeps the sign of a zero.
    if (ix < 0x3e500000) {
      return x;
    }
    return ksin(x, 0.0, 0);
  }
  if (ix >= 0x7ff00000) {
    return x - x;
  }
  if (ix < 0x413921fb) {
    return reduceMedium(x, 0);
  }
  const r = reduceLarge(hi, __f64Lo(x), 0, false);
  if (hi >= 0x80000000) {
    return -r;
  }
  return r;
}

/** cos(x) for an f64. The error is under 1 ULP. */
export function cosF64(x: f64): f64 {
  const hi = __f64Hi(x);
  const ix = hi & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    // |x| < 2^-27 * sqrt(2): cos(x) rounds to 1.
    if (ix < 0x3e46a09e) {
      return 1.0;
    }
    return kcos(x, 0.0);
  }
  if (ix >= 0x7ff00000) {
    return x - x;
  }
  if (ix < 0x413921fb) {
    return reduceMedium(x, 1);
  }
  return reduceLarge(hi, __f64Lo(x), 1, false);
}

/** sin(|d| + k * pi/2) for an f32 past pi/4, as an f64 to round once. `d` is the f32 as an f64
 *  and `ix` its bits without the sign. */
function reduceSingle(d: f64, ix: u32, k: i32): f64 {
  const ad = abs(d);
  if (ix < 0x4a800000) {
    // |x| < 2^22: pi/2 as a piece of 30 bits and a tail, so fn * F1 is exact.
    const fn = (ad * INVPIO2 + TOINT) - TOINT;
    const y = (ad - fn * F1) - fn * F1T;
    return quadrant(__f64ToI32(fn) + k, y, 0.0, true);
  }
  return reduceLarge(__f64Hi(ad), __f64Lo(ad), k, true);
}

/** sin(x) for an f32. The error is under 1 ULP. */
export function sinF32(x: f32): f32 {
  const u = bitcast<u32>(x);
  const ix = u & 0x7fffffff;
  if (ix <= 0x3f490fda) {
    // |x| < 2^-12: sin(x) rounds to x, and this keeps the sign of a zero.
    if (ix < 0x39800000) {
      return x;
    }
    return f32(sindf(f64(x)));
  }
  if (ix >= 0x7f800000) {
    return x - x;
  }
  const r = reduceSingle(f64(x), ix, 0);
  if (u >= 0x80000000) {
    return f32(-r);
  }
  return f32(r);
}

/** cos(x) for an f32. The error is under 1 ULP. */
export function cosF32(x: f32): f32 {
  const ix = bitcast<u32>(x) & 0x7fffffff;
  if (ix <= 0x3f490fda) {
    // |x| < 2^-12: cos(x) rounds to 1.
    if (ix < 0x39800000) {
      return 1.0;
    }
    return f32(cosdf(f64(x)));
  }
  if (ix >= 0x7f800000) {
    return x - x;
  }
  return f32(reduceSingle(f64(x), ix, 1));
}
