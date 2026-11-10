// An exact reference for the libm's tests (change 0042, milestone 1a). Test code only.
//
// It computes sin and cos of a finite f64 with BigInt fixed-point arithmetic, and the distance
// of a result from that value in units in the last place. It is the measurement behind the
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

/** The format of a result: its precision in bits and the exponent of its smallest unit. */
export interface FloatFormat {
  readonly precision: bigint;
  readonly minUlpExponent: bigint;
}
export const F32_FORMAT: FloatFormat = { precision: 24n, minUlpExponent: -149n };
export const F64_FORMAT: FloatFormat = { precision: 53n, minUlpExponent: -1074n };

/** The signed distance of the finite result `got` from the exact value, in units in the last
 *  place of the format at the exact value. The unit is that of the exact value's binade, and
 *  never below the format's smallest unit. Undefined when the exact value is zero. */
export function ulpError(got: number, exact: Exact, format: FloatFormat): number | undefined {
  if (!Number.isFinite(got)) return Infinity;
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
