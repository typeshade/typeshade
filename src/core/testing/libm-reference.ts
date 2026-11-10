// An exact reference for the libm's tests (change 0042, milestone 1a). Test code only.
//
// It computes each function of the libm of a finite f64 with BigInt fixed-point arithmetic, and
// the distance of a result from that value in units in the last place. It is the measurement behind the
// libm's promise of an error under 1 ULP (decision N9). It is not the sweep's reference: that
// one is CORE-MATH, built by a script outside the gates.
//
// The method. pi comes from Machin's formula at `PI_BITS` bits. The argument is reduced by the
// nearest multiple of pi/2 at that precision. The reduced argument keeps `WORK_BITS`
// significant bits, and a Taylor series gives its sine or cosine.

const PI_BITS = 1400n;
const WORK_BITS = 260n;

function atanInverse(n: bigint, bits: bigint): bigint {
  const one = 1n << bits;
  const n2 = n * n;
  let sum = 0n;
  let term = one / n;
  for (let k = 0n; term !== 0n; k++) {
    sum += (k % 2n === 0n ? term : -term) / (2n * k + 1n);
    term /= n2;
  }
  return sum;
}

/** pi * 2^bits, truncated, with an error far below one unit of `bits - 16`. */
export function piFixed(bits: bigint): bigint {
  const guard = 32n;
  const b = bits + guard;
  return (16n * atanInverse(5n, b) - 4n * atanInverse(239n, b)) >> guard;
}

const PI = piFixed(PI_BITS);
const HALF_PI = PI >> 1n;

const view = new DataView(new ArrayBuffer(8));

/** The two words of an f64, high word first. */
export function wordsOf(x: number): [number, number] {
  view.setFloat64(0, x, false);
  return [view.getUint32(0, false), view.getUint32(4, false)];
}

/** The f64 with the high word `hi` and the low word `lo`. */
export function f64OfWords(hi: number, lo: number): number {
  view.setUint32(0, hi >>> 0, false);
  view.setUint32(4, lo >>> 0, false);
  return view.getFloat64(0, false);
}

/** The f32 with the bits `bits`. */
export function f32OfBits(bits: number): number {
  view.setUint32(0, bits >>> 0, false);
  return view.getFloat32(0, false);
}

/** A finite f64 as an exact fraction `m * 2^e` with `m` an integer. */
function exactOf(x: number): { m: bigint; e: bigint } {
  const [hi, lo] = wordsOf(x);
  const be = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  const m = be === 0 ? frac : frac | (1n << 52n);
  const e = BigInt((be === 0 ? 1 : be) - 1075);
  return { m: hi >>> 31 ? -m : m, e };
}

const abs = (v: bigint): bigint => (v < 0n ? -v : v);
const bitLength = (v: bigint): bigint => BigInt(abs(v).toString(2).length);
/** `v * 2^s` for a shift of either sign, truncated toward minus infinity. */
const shift = (v: bigint, s: bigint): bigint => (s >= 0n ? v << s : v >> -s);

/** An exact value `num / 2^scale`, good to about `WORK_BITS` significant bits. */
export interface Exact {
  readonly num: bigint;
  readonly scale: bigint;
}

/** sin(x) or cos(x) of a finite f64 `x`. */
export function exactTrig(fn: 'sin' | 'cos', x: number): Exact {
  if (!Number.isFinite(x)) throw new Error('exactTrig takes a finite number');
  const { m, e } = exactOf(x);
  // x * 2^PI_BITS, exact when e >= -PI_BITS; a smaller x keeps its bits in a larger scale.
  const baseScale = e < -PI_BITS ? -e : PI_BITS;
  const X = shift(m, e + baseScale);
  const halfPi = shift(HALF_PI, baseScale - PI_BITS);
  // The nearest multiple of pi/2.
  const k = halfPi === 0n ? 0n : (2n * X + (X >= 0n ? halfPi : -halfPi)) / (2n * halfPi);
  const R = X - k * halfPi;
  const quadrant = Number((((k + (fn === 'cos' ? 1n : 0n)) % 4n) + 4n) % 4n);
  // The reduced argument with WORK_BITS significant bits, in the scale Q.
  const length = R === 0n ? 0n : bitLength(R);
  const Q = baseScale - length + WORK_BITS;
  const r = shift(R, Q - baseScale);
  const one = 1n << (Q > 0n ? Q : 0n);
  const r2 = shift(r * r, -Q);
  // The series of sin for an even quadrant, of cos for an odd one.
  let term = quadrant % 2 === 0 ? r : one;
  let n = quadrant % 2 === 0 ? 1n : 0n;
  let sum = 0n;
  while (term !== 0n) {
    sum += term;
    term = -shift(term * r2, -Q) / ((n + 1n) * (n + 2n));
    n += 2n;
  }
  return { num: quadrant >= 2 ? -sum : sum, scale: Q > 0n ? Q : 0n };
}

const LN2_BITS = 2400n;
/** ln 2 * 2^bits, by 2 * atanh(1/3). */
export function ln2Fixed(bits: bigint): bigint {
  const guard = 32n;
  const one = 1n << (bits + guard);
  let power = one / 3n;
  let sum = 0n;
  for (let n = 1n; power !== 0n; n += 2n) {
    sum += power / n;
    power /= 9n;
  }
  return (2n * sum) >> guard;
}
const LN2 = ln2Fixed(LN2_BITS);
/** ln 2 in the scale `q`, for `q` up to `LN2_BITS`. */
const ln2At = (q: bigint): bigint => {
  if (q > LN2_BITS) throw new Error('the reference needs more bits of ln 2');
  return LN2 >> (LN2_BITS - q);
};

/** e^(r / 2^q) * 2^q for |r / 2^q| <= 1, by the Taylor series. */
function expSeries(r: bigint, q: bigint): bigint {
  let term = 1n << q;
  let sum = 0n;
  for (let n = 1n; term !== 0n; n++) {
    sum += term;
    term = shift(term * r, -q) / n;
  }
  return sum;
}

/** e^x of a finite f64 `x`, or 2^x when `base2`. */
function exactPower(x: number, base2: boolean): Exact {
  if (!Number.isFinite(x)) throw new Error('the reference takes a finite number');
  const { m, e } = exactOf(x);
  const q = WORK_BITS + 80n;
  if (base2) {
    // x = k + r with k the nearest integer, exactly; 2^x = 2^k * e^(r ln 2).
    const X = shift(m, e + 1100n);
    const half = 1n << 1099n;
    const k = (X + half) >> 1100n;
    const R = X - (k << 1100n);
    const r = shift(R * ln2At(q), -1100n);
    return { num: expSeries(r, q), scale: q - k };
  }
  // x = k ln 2 + r, in a scale that holds x exactly or to WORK_BITS bits past a tiny x.
  const base = 1200n;
  const X = shift(m, e + base);
  const ln2 = ln2At(base);
  const k =
    (2n * X + ln2) / (2n * ln2) -
    (2n * X + ln2 < 0n && (2n * X + ln2) % (2n * ln2) !== 0n ? 1n : 0n);
  const R = X - k * ln2;
  return { num: expSeries(shift(R, q - base), q), scale: q - k };
}

/** e^x of a finite f64 `x`. */
export const exactExp = (x: number): Exact => exactPower(x, false);
/** 2^x of a finite f64 `x`. */
export const exactExp2 = (x: number): Exact => exactPower(x, true);

/** ln of the positive rational `num / 2^scale`, with about WORK_BITS significant bits. */
export function exactLogOf(v: Exact): Exact {
  if (v.num <= 0n) throw new Error('the reference takes a positive number');
  // v = 2^k * y with y in [3/4, 3/2).
  let k = bitLength(v.num) - 1n - v.scale;
  let den = 1n << (bitLength(v.num) - 1n);
  if (4n * v.num >= 6n * den) {
    den <<= 1n;
    k += 1n;
  }
  // ln y = 2 atanh(s), s = (y - 1) / (y + 1) = (num - den) / (num + den).
  const top = v.num - den;
  if (top === 0n) {
    const q = WORK_BITS + 80n;
    return { num: k * ln2At(q), scale: q };
  }
  // The scale gives s WORK_BITS significant bits.
  const q = WORK_BITS + 80n + (bitLength(v.num + den) - bitLength(top));
  const s = (top << q) / (v.num + den);
  const s2 = shift(s * s, -q);
  let power = s;
  let sum = 0n;
  for (let n = 1n; power !== 0n; n += 2n) {
    sum += power / n;
    // Toward zero, so a negative power reaches zero.
    power = (power * s2) / (1n << q);
  }
  return { num: 2n * sum + k * ln2At(q), scale: q };
}

/** A finite f64 as an exact value. */
export function exactValue(x: number): Exact {
  const { m, e } = exactOf(x);
  return e >= 0n ? { num: m << e, scale: 0n } : { num: m, scale: -e };
}

/** ln(x) of a positive finite f64 `x`. */
export const exactLog = (x: number): Exact => exactLogOf(exactValue(x));

/** log2(x) of a positive finite f64 `x`. */
export function exactLog2(x: number): Exact {
  const l = exactLog(x);
  if (l.num === 0n) return l;
  // The quotient by ln 2 keeps the significant bits of ln x.
  const q = WORK_BITS + 80n;
  return { num: (l.num << q) / ln2At(q), scale: l.scale };
}

/** The integer part of the square root of a non-negative integer. */
export function integerSqrt(v: bigint): bigint {
  if (v < 2n) return v;
  let x = 1n << ((bitLength(v) + 1n) >> 1n);
  for (;;) {
    const y = (x + v / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

/** atan(n / d) for 0 < n <= d, with about `bits` significant bits. The argument is halved by
 *  atan(v) = 2 atan(v / (1 + sqrt(1 + v^2))) until it is below 2^-10, and a Taylor series gives
 *  the rest. */
function atanOfSmallRatio(n: bigint, d: bigint, bits: bigint): Exact {
  const q = bits + (bitLength(d) - bitLength(n));
  const one = 1n << q;
  let v = (n << q) / d;
  let doublings = 0n;
  while (v > one >> 10n) {
    v = (v << q) / (one + integerSqrt(one * one + v * v));
    doublings++;
  }
  const v2 = (v * v) >> q;
  let power = v;
  let sum = 0n;
  for (let k = 0n; power !== 0n; k++) {
    sum += (k % 2n === 0n ? power : -power) / (2n * k + 1n);
    power = (power * v2) >> q;
  }
  return { num: sum << doublings, scale: q };
}

/** The scale of a value near pi/2 or pi: enough for any result that is not tiny. */
const ANGLE_SCALE = 1300n;
/** `a` in the scale `scale`, which is not above its own. */
const inScale = (a: Exact, scale: bigint): bigint => a.num >> (a.scale - scale);

/** atan(n / d) for n >= 0 and d > 0, in [0, pi/2). `bits` is the working precision. */
export function exactAtanOfRatio(n: bigint, d: bigint, bits = WORK_BITS + 80n): Exact {
  if (n === 0n) return { num: 0n, scale: 0n };
  if (n <= d) return atanOfSmallRatio(n, d, bits);
  // atan(v) = pi/2 - atan(1 / v).
  const t = atanOfSmallRatio(d, n, bits);
  const scale = t.scale > ANGLE_SCALE ? ANGLE_SCALE : t.scale;
  return { num: (PI >> (PI_BITS - scale + 1n)) - inScale(t, scale), scale };
}

/** pi less `a`, for `a` in [0, pi/2]. */
function piLess(a: Exact): Exact {
  const scale = a.scale > ANGLE_SCALE ? ANGLE_SCALE : a.scale < 400n ? 400n : a.scale;
  const value = a.scale >= scale ? inScale(a, scale) : a.num << (scale - a.scale);
  return { num: (PI >> (PI_BITS - scale)) - value, scale };
}

const negated = (a: Exact, negative: boolean): Exact =>
  negative ? { num: -a.num, scale: a.scale } : a;

/** atan(x) of a finite f64 `x`. */
export function exactAtan(x: number, bits?: bigint): Exact {
  if (!Number.isFinite(x)) throw new Error('the reference takes a finite number');
  const { m, e } = exactOf(x);
  const n = e >= 0n ? abs(m) << e : abs(m);
  const d = e >= 0n ? 1n : 1n << -e;
  return negated(exactAtanOfRatio(n, d, bits), m < 0n);
}

/** atan2(y, x) of two finite f64 that are not both zero: the angle of the point (x, y). */
export function exactAtan2(y: number, x: number, bits?: bigint): Exact {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('the reference takes finite numbers');
  }
  const a = exactOf(y);
  const b = exactOf(x);
  if (a.m === 0n && b.m === 0n) throw new Error('the reference takes a point that is not zero');
  const low = a.e < b.e ? a.e : b.e;
  const n = abs(a.m) << (a.e - low);
  const d = abs(b.m) << (b.e - low);
  // The angle of (|x|, |y|): pi/2 on the axis of y.
  const first =
    d === 0n
      ? { num: PI >> (PI_BITS - ANGLE_SCALE + 1n), scale: ANGLE_SCALE }
      : exactAtanOfRatio(n, d, bits);
  const negative = y < 0 || Object.is(y, -0);
  return negated(x < 0 || Object.is(x, -0) ? piLess(first) : first, negative);
}

/** tan(x) of a finite f64 `x`: the quotient of its sine and cosine. */
export function exactTan(x: number): Exact {
  const s = exactTrig('sin', x);
  const c = exactTrig('cos', x);
  if (s.num === 0n) return s;
  // The quotient keeps WORK_BITS + 80 bits, whatever the sizes of the two.
  const guard = WORK_BITS + 80n + bitLength(c.num) - bitLength(s.num);
  return { num: (s.num << guard) / c.num, scale: guard + s.scale - c.scale };
}

/** asin(x) of an f64 `x` with |x| < 1: atan(x / sqrt(1 - x^2)). */
export function exactAsin(x: number, bits?: bigint): Exact {
  if (!(Math.abs(x) < 1)) throw new Error('the reference takes |x| < 1');
  const { m, e } = exactOf(x);
  // x = m / D, so x / sqrt(1 - x^2) = m / sqrt(D^2 - m^2).
  const D = 1n << -e;
  // The square root keeps `root` bits past the point.
  const root = bits ?? WORK_BITS + 80n;
  const n = abs(m) << root;
  const d = integerSqrt((D * D - m * m) << (2n * root));
  return negated(exactAtanOfRatio(n, d, bits), m < 0n);
}

/** acos(x) of an f64 `x` with |x| < 1: 2 atan(sqrt((1 - x) / (1 + x))). */
export function exactAcos(x: number, bits?: bigint): Exact {
  if (!(Math.abs(x) < 1)) throw new Error('the reference takes |x| < 1');
  const { m, e } = exactOf(x);
  // x = m / D, so (1 - x) / (1 + x) = (D - m) / (D + m), and its root is sqrt(A B) / B.
  const D = 1n << -e;
  const A = D - m;
  const B = D + m;
  const root = bits ?? WORK_BITS + 80n;
  const half = exactAtanOfRatio(integerSqrt((A * B) << (2n * root)), B << root, bits);
  return { num: 2n * half.num, scale: half.scale };
}

/** `n / d` for positive integers, with about `bits` significant bits. */
function ratio(n: bigint, d: bigint, bits: bigint): Exact {
  const q = bits + bitLength(d) - bitLength(n);
  return q >= 0n ? { num: (n << q) / d, scale: q } : { num: n / (d << -q), scale: q };
}

/** `a + sign * b` of two positive exact values, in the finer of their scales. */
function combine(a: Exact, b: Exact, sign: 1n | -1n): Exact {
  const scale = a.scale > b.scale ? a.scale : b.scale;
  return { num: shift(a.num, scale - a.scale) + sign * shift(b.num, scale - b.scale), scale };
}

/** sinh(x), cosh(x) or tanh(x) of a finite f64 `x` with |x| <= 710.5 (tanh: any x, as 1 past
 *  |x| = 40, where the reference does not need more). */
export function exactHyperbolic(fn: 'sinh' | 'cosh' | 'tanh', x: number): Exact {
  if (!Number.isFinite(x)) throw new Error('the reference takes a finite number');
  const negative = x < 0 || Object.is(x, -0);
  const a = Math.abs(x);
  if (fn === 'tanh') {
    if (a > 40) return { num: negative ? -1n : 1n, scale: 0n };
    // (e^(2a) - 1) / (e^(2a) + 1); 2a is exact.
    const e = exactExp(2 * a);
    const one = shift(1n, e.scale);
    const t = ratio(e.num - one, e.num + one, WORK_BITS + 80n);
    return negative ? { num: -t.num, scale: t.scale } : t;
  }
  const r = combine(exactExp(a), exactExp(-a), fn === 'sinh' ? -1n : 1n);
  const half = { num: r.num, scale: r.scale + 1n };
  return negative && fn === 'sinh' ? { num: -half.num, scale: half.scale } : half;
}

/** asinh(x), acosh(x) or atanh(x) of a finite f64 `x` in its domain, as a logarithm:
 *  ln(|x| + sqrt(x^2 + 1)), ln(x + sqrt(x^2 - 1)) and ln((1 + |x|) / (1 - |x|)) / 2. */
export function exactInverseHyperbolic(fn: 'asinh' | 'acosh' | 'atanh', x: number): Exact {
  if (!Number.isFinite(x)) throw new Error('the reference takes a finite number');
  const negative = x < 0 || Object.is(x, -0);
  const v = exactValue(Math.abs(x));
  // The argument of the logarithm keeps this many bits past the point.
  const P = 1200n;
  const X = shift(v.num, P - v.scale);
  const unit = 1n << P;
  let y: Exact;
  if (fn === 'atanh') {
    if (!(Math.abs(x) < 1)) throw new Error('the reference takes |x| < 1');
    y = ratio(unit + X, unit - X, P);
  } else {
    if (fn === 'acosh' && x < 1) throw new Error('the reference takes x >= 1');
    const square = X * X + (fn === 'asinh' ? 1n : -1n) * (unit * unit);
    y = { num: X + integerSqrt(square), scale: P };
  }
  const l = exactLogOf(y);
  const r = fn === 'atanh' ? { num: l.num, scale: l.scale + 1n } : l;
  return negative && fn !== 'acosh' ? { num: -r.num, scale: r.scale } : r;
}

/** |x|^y of finite f64 `x` and `y`, x not zero: e^(y ln |x|). ln |x| keeps about WORK_BITS
 *  significant bits past those it has in its scale, the product by y is exact, and the
 *  exponential reduces by the nearest multiple of ln 2 in the product's scale. The sign is the
 *  caller's. */
export function exactPow(x: number, y: number): Exact {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x === 0) {
    throw new Error('the reference takes finite numbers and an x that is not zero');
  }
  const l = exactLog(Math.abs(x));
  const { m, e } = exactOf(y);
  // y ln |x| = l.num * m / 2^(l.scale - e), in a scale no finer than ln 2 is held.
  let num = l.num * m;
  let scale = l.scale - e;
  const most = LN2_BITS - 64n;
  if (scale > most) {
    num = shift(num, most - scale);
    scale = most;
  }
  if (scale < 0n) {
    num = num << -scale;
    scale = 0n;
  }
  const ln2 = ln2At(scale);
  // The nearest multiple k of ln 2, by a floor division of num + ln2 / 2.
  const top = 2n * num + ln2;
  const den = 2n * ln2;
  const k = top / den - (top < 0n && top % den !== 0n ? 1n : 0n);
  const q = WORK_BITS + 80n;
  return { num: expSeries(shift(num - k * ln2, q - scale), q), scale: q - k };
}

/** The format of a result: its precision in bits and the exponent of its smallest unit. */
export interface FloatFormat {
  readonly precision: bigint;
  readonly minUlpExponent: bigint;
  /** The exponent of the first power of two past the largest finite value. */
  readonly overflowExponent: bigint;
}
export const F32_FORMAT: FloatFormat = {
  precision: 24n,
  minUlpExponent: -149n,
  overflowExponent: 128n,
};
export const F64_FORMAT: FloatFormat = {
  precision: 53n,
  minUlpExponent: -1074n,
  overflowExponent: 1024n,
};

/** The signed distance of the finite result `got` from the exact value, in units in the last
 *  place of the format at the exact value. The unit is that of the exact value's binade, and
 *  never below the format's smallest unit. Undefined when the exact value is zero. An infinite
 *  result measures 0 where an infinity is the correctly rounded result, and infinity elsewhere. */
export function ulpError(got: number, exact: Exact, format: FloatFormat): number | undefined {
  if (Number.isNaN(got)) return Infinity;
  if (!Number.isFinite(got)) {
    // An infinity is the correctly rounded result when the exact value is at or past the
    // largest finite value plus half a unit, with the infinity's sign.
    const p = format.precision;
    const bound = ((1n << (p + 1n)) - 1n) << (format.overflowExponent - p - 1n);
    const magnitude = abs(exact.num);
    const past =
      exact.scale >= 0n ? magnitude >= bound << exact.scale : magnitude << -exact.scale >= bound;
    return past && got > 0 === exact.num > 0n ? 0 : Infinity;
  }
  if (exact.num === 0n) return got === 0 ? 0 : undefined;
  const { m, e } = exactOf(got);
  // The exponent of the unit: 2^(floor(log2 |exact|) - precision + 1).
  let unit = bitLength(exact.num) - 1n - exact.scale - format.precision + 1n;
  if (unit < format.minUlpExponent) unit = format.minUlpExponent;
  // (got - exact) / 2^unit, with 30 fractional bits.
  const fraction = 30n;
  const s = exact.scale > -e ? exact.scale : -e;
  const difference = shift(m, e + s) - shift(exact.num, s - exact.scale);
  return Number(shift(difference, fraction - s - unit)) / 2 ** Number(fraction);
}
