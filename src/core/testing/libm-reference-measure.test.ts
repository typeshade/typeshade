import { describe, expect, it } from 'vitest';
import {
  F32_FORMAT,
  F64_FORMAT,
  exactAcos,
  exactAsin,
  exactAtan,
  exactAtan2,
  f32OfBits,
  f64OfWords,
  piFixed,
  ulpError,
  wordsOf,
  type Exact,
} from './libm-reference.js';

const magnitude = (e: Exact): bigint => (e.num < 0n ? -e.num : e.num);
const significantBits = (e: Exact): number => magnitude(e).toString(2).length;
const withScale = (e: Exact, scale: bigint): bigint => e.num << (scale - e.scale);
const withinScale = (a: Exact, b: Exact, bits: bigint): boolean => {
  const scale = a.scale > b.scale ? a.scale : b.scale;
  const gap = withScale(a, scale) - withScale(b, scale);
  return (gap < 0n ? -gap : gap) * (1n << bits) <= 1n << scale;
};
const multiple = (n: bigint, d: bigint): Exact => ({ num: (n * piFixed(1300n)) / d, scale: 1300n });
const ulps64 = (got: number, e: Exact): number => Math.abs(ulpError(got, e, F64_FORMAT)!);
const integer = (n: bigint): Exact => ({ num: n, scale: 0n });

describe('libm reference: words', () => {
  it('give the high word first', () => {
    expect(wordsOf(1)).toEqual([0x3ff00000, 0]);
    expect(wordsOf(-2)).toEqual([0xc0000000, 0]);
    expect(f64OfWords(0x3ff00000, 1)).toBe(1 + 2 ** -52);
    expect(Object.is(f64OfWords(0x80000000, 0), -0)).toBe(true);
  });

  it('give an f32 of its bits', () => {
    expect(f32OfBits(0x3f800000)).toBe(1);
    expect(f32OfBits(0x7f7fffff)).toBe(3.4028234663852886e38);
    expect(Object.is(f32OfBits(0x80000000), -0)).toBe(true);
    expect(f32OfBits(0x00000001)).toBe(2 ** -149);
  });
});

describe('libm reference: inverse trigonometric functions', () => {
  it('refuse a number that is not finite', () => {
    expect(() => exactAtan(Infinity)).toThrow('the reference takes a finite number');
    expect(() => exactAtan2(NaN, 1)).toThrow('the reference takes finite numbers');
    expect(() => exactAtan2(1, -Infinity)).toThrow('the reference takes finite numbers');
  });

  it('refuse a point at zero', () => {
    expect(() => exactAtan2(0, 0)).toThrow('the reference takes a point that is not zero');
    expect(() => exactAtan2(-0, -0)).toThrow('the reference takes a point that is not zero');
  });

  it('refuse asin and acos outside the open interval', () => {
    for (const x of [1, -1, 2, NaN]) {
      expect(() => exactAsin(x)).toThrow('the reference takes |x| < 1');
      expect(() => exactAcos(x)).toThrow('the reference takes |x| < 1');
    }
  });

  it('give atan of zero as zero and keep the sign of the argument', () => {
    expect(exactAtan(0).num).toBe(0n);
    expect(exactAtan(-0).num).toBe(0n);
    expect(withinScale(exactAtan(1), multiple(1n, 4n), 250n)).toBe(true);
    expect(withinScale(exactAtan(-1), multiple(-1n, 4n), 250n)).toBe(true);
    expect(exactAtan(-0.25).num).toBeLessThan(0n);
    expect(exactAsin(-0.25).num).toBeLessThan(0n);
  });

  it('give atan above one as pi/2 less atan of the inverse, even for a huge argument', () => {
    for (const x of [1.0000000000000002, 3, 1e10, 1e300, 2 ** 1000, 2 ** 1023]) {
      expect([x, ulps64(Math.atan(x), exactAtan(x)) < 1]).toEqual([x, true]);
    }
    expect(withinScale(exactAtan(2 ** 1023), multiple(1n, 2n), 250n)).toBe(true);
  });

  it('hold atan of a huge argument to 1000 bits of pi/2 less the inverse', () => {
    const expected: Exact = { num: piFixed(1300n) / 2n - (1n << 277n), scale: 1300n };
    expect(withinScale(exactAtan(2 ** 1023), expected, 1000n)).toBe(true);
  });

  it('keep the significant bits of atan for a tiny argument', () => {
    expect(significantBits(exactAtan(2 ** -1000))).toBeGreaterThanOrEqual(330);
    expect(significantBits(exactAtan(5e-324))).toBeGreaterThanOrEqual(330);
    expect(ulps64(2 ** -1000, exactAtan(2 ** -1000))).toBeLessThanOrEqual(0.5);
  });

  it('take the working precision from the argument bits', () => {
    for (const exact of [exactAtan(0.3, 100n), exactAsin(0.3, 100n), exactAcos(0.3, 100n)]) {
      expect(significantBits(exact)).toBeGreaterThanOrEqual(90);
      expect(significantBits(exact)).toBeLessThan(200);
    }
    expect(significantBits(exactAtan(0.3))).toBeGreaterThanOrEqual(330);
    expect(significantBits(exactAsin(0.3))).toBeGreaterThanOrEqual(330);
    expect(significantBits(exactAcos(0.3))).toBeGreaterThanOrEqual(330);
  });

  it('give atan2 on the axes and in each quadrant, with the signs of zero', () => {
    const cases: [number, number, bigint, bigint][] = [
      [1, 0, 1n, 2n],
      [-1, 0, -1n, 2n],
      [1, -0, 1n, 2n],
      [1, 1, 1n, 4n],
      [1, -1, 3n, 4n],
      [-1, -1, -3n, 4n],
      [-1, 1, -1n, 4n],
      [0, -1, 1n, 1n],
      [-0, -1, -1n, 1n],
    ];
    for (const [y, x, n, d] of cases) {
      expect([y, x, withinScale(exactAtan2(y, x), multiple(n, d), 250n)]).toEqual([y, x, true]);
    }
    expect(exactAtan2(0, 1).num).toBe(0n);
    expect(exactAtan2(-0, 1).num).toBe(0n);
  });

  it('give atan2 for operands of very different sizes', () => {
    for (const [y, x] of [
      [3e-5, 7e10],
      [1e300, 1e-300],
      [5e-324, 1],
      [1, 5e-324],
      [-5e-324, -1e300],
      [2 ** -1000, -1],
    ] as const) {
      expect([y, x, ulps64(Math.atan2(y, x), exactAtan2(y, x)) < 1]).toEqual([y, x, true]);
    }
  });

  it('give pi at 400 bits or more when the angle is pi', () => {
    const pi = exactAtan2(0, -1);
    expect(pi.scale).toBeGreaterThanOrEqual(400n);
    expect(withinScale(pi, multiple(1n, 1n), 390n)).toBe(true);
    expect(withinScale(exactAtan2(2 ** -1000, -1), multiple(1n, 1n), 390n)).toBe(true);
  });

  it('give asin and acos from atan', () => {
    expect(withinScale(exactAsin(0.5), multiple(1n, 6n), 250n)).toBe(true);
    expect(withinScale(exactAcos(0.5), multiple(1n, 3n), 250n)).toBe(true);
    expect(withinScale(exactAcos(-0.5), multiple(2n, 3n), 250n)).toBe(true);
    expect(withinScale(exactAcos(0), multiple(1n, 2n), 250n)).toBe(true);
    expect(exactAsin(0).num).toBe(0n);
    for (const x of [0.3, 1 - 2 ** -53, 2 ** -60]) {
      expect([x, ulps64(Math.asin(x), exactAsin(x)) < 1]).toEqual([x, true]);
      expect([x, ulps64(Math.acos(x), exactAcos(x)) < 1]).toEqual([x, true]);
    }
  });
});

describe('libm reference: ulpError', () => {
  it('knows the two formats', () => {
    expect(F32_FORMAT).toEqual({ precision: 24n, minUlpExponent: -149n, overflowExponent: 128n });
    expect(F64_FORMAT).toEqual({ precision: 53n, minUlpExponent: -1074n, overflowExponent: 1024n });
  });

  it('is signed', () => {
    const one = integer(1n);
    expect(ulpError(1, one, F64_FORMAT)).toBe(0);
    expect(ulpError(1 + 2 ** -52, one, F64_FORMAT)).toBe(1);
    expect(ulpError(1 - 2 ** -53, one, F64_FORMAT)).toBe(-0.5);
    expect(ulpError(1 + 2 ** -23, one, F32_FORMAT)).toBe(1);
  });

  it('counts in units of the binade of the exact value', () => {
    const justBelowTwo: Exact = { num: (1n << 60n) * 2n - 1n, scale: 60n };
    expect(ulpError(2, justBelowTwo, F64_FORMAT)).toBe(2 ** -8);
    const justAboveTwo: Exact = { num: (1n << 61n) + 1n, scale: 60n };
    expect(ulpError(2, justAboveTwo, F64_FORMAT)).toBe(-(2 ** -9));
  });

  it('never counts in a unit below the smallest of the format', () => {
    const tiny: Exact = { num: 1n, scale: 1080n };
    expect(ulpError(5e-324, tiny, F64_FORMAT)).toBe(1 - 2 ** -6);
    const tinyF32: Exact = { num: 1n, scale: 155n };
    expect(ulpError(2 ** -149, tinyF32, F32_FORMAT)).toBe(1 - 2 ** -6);
  });

  it('is undefined for a finite result of an exact zero, and zero for a zero result', () => {
    expect(ulpError(1e-300, integer(0n), F64_FORMAT)).toBeUndefined();
    expect(ulpError(0, integer(0n), F64_FORMAT)).toBe(0);
    expect(ulpError(-0, integer(0n), F64_FORMAT)).toBe(0);
  });

  it('is infinite for a NaN', () => {
    expect(ulpError(NaN, integer(1n), F64_FORMAT)).toBe(Infinity);
    expect(ulpError(NaN, integer(1n), F32_FORMAT)).toBe(Infinity);
  });

  it('measures an infinity as 0 only at or past the largest finite value plus half a unit', () => {
    for (const [format, bound] of [
      [F32_FORMAT, ((1n << 25n) - 1n) << 103n],
      [F64_FORMAT, ((1n << 54n) - 1n) << 970n],
    ] as const) {
      for (const at of [
        { num: bound, scale: 0n },
        { num: bound << 7n, scale: 7n },
        { num: bound >> 3n, scale: -3n },
      ] as Exact[]) {
        const scale = at.scale;
        const below: Exact = { num: at.num - 1n, scale };
        expect([scale, ulpError(Infinity, at, format)]).toEqual([scale, 0]);
        expect([scale, ulpError(Infinity, below, format)]).toEqual([scale, Infinity]);
        expect([scale, ulpError(-Infinity, { num: -at.num, scale }, format)]).toEqual([scale, 0]);
        expect([scale, ulpError(-Infinity, at, format)]).toEqual([scale, Infinity]);
        expect([scale, ulpError(Infinity, { num: -at.num, scale }, format)]).toEqual([
          scale,
          Infinity,
        ]);
      }
    }
  });
});
