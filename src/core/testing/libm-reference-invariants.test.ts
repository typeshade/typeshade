import { describe, expect, it } from 'vitest';
import {
  F64_FORMAT,
  exactExp,
  exactExp2,
  exactHyperbolic,
  exactInverseHyperbolic,
  exactLog,
  exactLog2,
  exactLogOf,
  exactPow,
  exactTan,
  exactTrig,
  exactValue,
  integerSqrt,
  ln2Fixed,
  piFixed,
  ulpError,
  type Exact,
} from './libm-reference.js';

const magnitude = (e: Exact): bigint => (e.num < 0n ? -e.num : e.num);
const significantBits = (e: Exact): number => magnitude(e).toString(2).length;
const withScale = (e: Exact, scale: bigint): bigint => e.num << (scale - e.scale);
const agree = (a: Exact, b: Exact, bits: bigint): boolean => {
  const scale = a.scale > b.scale ? a.scale : b.scale;
  const gap = withScale(a, scale) - withScale(b, scale);
  return (gap < 0n ? -gap : gap) * (1n << bits) <= magnitude({ num: withScale(b, scale), scale });
};
const sum = (a: Exact, b: Exact): Exact => {
  const scale = a.scale > b.scale ? a.scale : b.scale;
  return { num: withScale(a, scale) + withScale(b, scale), scale };
};
const product = (a: Exact, b: Exact): Exact => ({ num: a.num * b.num, scale: a.scale + b.scale });
const ulps = (got: number, e: Exact): number => Math.abs(ulpError(got, e, F64_FORMAT)!);
const integer = (n: bigint): Exact => ({ num: n, scale: 0n });

describe('libm reference: constants', () => {
  it('piFixed is pi truncated, with an error far below 2^16 units', () => {
    const pi192 = 0x3243f6a8885a308d313198a2e03707344a4093822299f31d0n;
    const gap = pi192 - piFixed(192n);
    expect(gap >= 0n && gap < 1n << 16n).toBe(true);
  });

  it('ln2Fixed is ln 2 to the last bits asked', () => {
    const ln2At192 = 0xb17217f7d1cf79abc9e3b39803f2f6af40f343267298b62dn;
    const gap = ln2At192 - ln2Fixed(192n);
    expect(gap >= 0n && gap < 1n << 16n).toBe(true);
  });

  it('integerSqrt is the floor of the square root', () => {
    for (const v of [0n, 1n, 2n, 3n, 4n, 15n, 16n, 17n, 10n ** 60n, (1n << 200n) - 1n]) {
      const r = integerSqrt(v);
      expect([v, r * r <= v && v < (r + 1n) * (r + 1n)]).toEqual([v, true]);
    }
  });
});

describe('libm reference: exactValue', () => {
  it('is the exact fraction of a finite f64, subnormals and signs included', () => {
    expect(exactValue(5e-324).num * 2n ** 1074n).toBe(1n << exactValue(5e-324).scale);
    expect(exactValue(-0.75).num * 4n).toBe(-3n << exactValue(-0.75).scale);
    expect(exactValue(2 ** 1000)).toEqual(integer(1n << 1000n));
    expect(exactValue(Number.MAX_VALUE)).toEqual(integer(((1n << 53n) - 1n) << 971n));
    expect(exactValue(0).num).toBe(0n);
  });
});

describe('libm reference: sine and cosine', () => {
  it('refuse a number that is not finite', () => {
    for (const x of [Infinity, -Infinity, NaN]) {
      expect(() => exactTrig('sin', x)).toThrow('exactTrig takes a finite number');
    }
  });

  it('follow the quadrants of the nearest multiple of pi/2', () => {
    for (const x of [0.5, 2, 3.5, 5, -0.5, -2, -3.5, -5, 1.5707963267948966, 3.141592653589793]) {
      expect([x, ulps(Math.sin(x), exactTrig('sin', x)) < 1]).toEqual([x, true]);
      expect([x, ulps(Math.cos(x), exactTrig('cos', x)) < 1]).toEqual([x, true]);
    }
  });

  it('reduce a huge argument with enough bits of pi', () => {
    for (const x of [1e22, 2 ** 1023, Number.MAX_VALUE]) {
      expect([x, ulps(Math.sin(x), exactTrig('sin', x)) < 1]).toEqual([x, true]);
      expect([x, ulps(Math.cos(x), exactTrig('cos', x)) < 1]).toEqual([x, true]);
    }
  });

  it('keep about 260 significant bits, even where the result is tiny', () => {
    for (const x of [0.5, 1.5707963267948966, 3.141592653589793, 1e-300, 5e-324]) {
      for (const fn of ['sin', 'cos'] as const) {
        const bits = significantBits(exactTrig(fn, x));
        expect([x, fn, bits >= 255]).toEqual([x, fn, true]);
      }
    }
  });

  it('give sin and cos of an argument at zero', () => {
    expect(exactTrig('sin', 0).num).toBe(0n);
    expect(agree(exactTrig('cos', 0), integer(1n), 250n)).toBe(true);
  });

  it('give tan with about 340 significant bits whatever the sizes of sin and cos', () => {
    for (const x of [1e-300, 5e-324, 1, 1.5707963267948966]) {
      const bits = significantBits(exactTan(x));
      expect([x, bits >= 330 && bits <= 350]).toEqual([x, true]);
      expect([x, ulps(Math.tan(x), exactTan(x)) < 1]).toEqual([x, true]);
    }
    expect(exactTan(0).num).toBe(0n);
  });
});

describe('libm reference: exponentials and logarithms', () => {
  it('refuse a number that is not finite, and a log of a number that is not positive', () => {
    expect(() => exactExp(Infinity)).toThrow('the reference takes a finite number');
    expect(() => exactExp2(NaN)).toThrow('the reference takes a finite number');
    expect(() => exactLogOf(integer(0n))).toThrow('the reference takes a positive number');
    expect(() => exactLogOf(integer(-3n))).toThrow('the reference takes a positive number');
  });

  it('refuse a logarithm that needs more bits of ln 2 than the table holds', () => {
    const huge: Exact = { num: (1n << 3000n) + 1n, scale: 3000n };
    expect(() => exactLogOf(huge)).toThrow('the reference needs more bits of ln 2');
  });

  it('exp and log invert each other to 250 bits', () => {
    for (const x of [0.7, -0.7, 1.5, -1.5, 3.25, -40.5, 100.125]) {
      const back = exactLogOf(exactExp(x));
      expect([x, agree(back, exactValue(x), 250n)]).toEqual([x, true]);
    }
  });

  it('exp2 splits at the nearest integer, and the sum of exponents multiplies', () => {
    expect(agree(exactExp2(5), integer(32n), 250n)).toBe(true);
    expect(agree(exactExp2(-3), { num: 1n, scale: 3n }, 250n)).toBe(true);
    for (const x of [0.5, -0.5, 0.75, -0.75, 1.25, 0.4999999999999999]) {
      const twice = product(exactExp2(x), exactExp2(x));
      expect([x, agree(twice, exactExp2(2 * x), 250n)]).toEqual([x, true]);
      expect([x, ulps(Math.pow(2, x), exactExp2(x)) < 1]).toEqual([x, true]);
    }
    const root = exactExp2(0.5);
    expect(agree(product(root, root), integer(2n), 250n)).toBe(true);
  });

  it('exp of a sum is the product of the exps, for a negative argument too', () => {
    for (const [a, b] of [
      [0.5, 0.25],
      [-0.5, -0.25],
      [-1.5, 0.25],
      [-700, -5],
    ] as const) {
      const both = product(exactExp(a), exactExp(b));
      expect([a, b, agree(both, exactExp(a + b), 250n)]).toEqual([a, b, true]);
    }
  });

  it('keep the significant bits of a log near one and of log2', () => {
    const nearOne: Exact = { num: (1n << 1000n) + 1n, scale: 1000n };
    expect(significantBits(exactLogOf(nearOne))).toBeGreaterThanOrEqual(330);
    expect(significantBits(exactLog(1 + 2 ** -52))).toBeGreaterThanOrEqual(330);
    expect(significantBits(exactLog2(1 + 2 ** -52))).toBeGreaterThanOrEqual(330);
    expect(significantBits(exactLog2(5e-324))).toBeGreaterThanOrEqual(330);
  });

  it('give the exact multiple of ln 2 for a power of two, and zero at one', () => {
    const ln2 = { num: ln2Fixed(300n), scale: 300n };
    expect(agree(exactLog(1024), { num: 10n * ln2.num, scale: 300n }, 250n)).toBe(true);
    expect(agree(exactLog(0.125), { num: -3n * ln2.num, scale: 300n }, 250n)).toBe(true);
    expect(exactLog(1).num).toBe(0n);
    expect(exactLog2(1).num).toBe(0n);
    expect(agree(exactLog2(2 ** -1074), integer(-1074n), 250n)).toBe(true);
  });

  it('terminate for a value below one, where the series is negative', () => {
    for (const x of [0.9, 0.76, 0.5, 1e-10, 5e-324]) {
      expect([x, ulps(Math.log(x), exactLog(x)) < 1]).toEqual([x, true]);
    }
    for (const x of [1.4, 1.5, 1.6, 0.75, 3]) {
      expect([x, ulps(Math.log(x), exactLog(x)) < 1]).toEqual([x, true]);
    }
  });
});

describe('libm reference: hyperbolic functions', () => {
  it('refuse a number that is not finite', () => {
    expect(() => exactHyperbolic('sinh', Infinity)).toThrow('the reference takes a finite number');
    expect(() => exactInverseHyperbolic('asinh', NaN)).toThrow(
      'the reference takes a finite number',
    );
  });

  it('give sinh and tanh the sign of the argument, and cosh none', () => {
    for (const x of [1, 0.25, 40.5, 700]) {
      const kinds = ['sinh', 'cosh', 'tanh'] as const;
      const [s, c, t] = kinds.map((k) => exactHyperbolic(k, x)) as [Exact, Exact, Exact];
      const [ns, nc, nt] = kinds.map((k) => exactHyperbolic(k, -x)) as [Exact, Exact, Exact];
      expect([x, sum(s, ns).num === 0n]).toEqual([x, true]);
      expect([x, nc.num > 0n && agree(nc, c, 250n), nt.num < 0n && sum(t, nt).num === 0n]).toEqual([
        x,
        true,
        true,
      ]);
    }
    expect(exactHyperbolic('sinh', -0).num).toBe(0n);
  });

  it('reaches 710.5 for sinh and cosh and is 1 past 40 for tanh', () => {
    for (const x of [710, 710.4]) {
      const e = exactExp(x);
      const half = { num: e.num, scale: e.scale + 1n };
      expect([x, agree(exactHyperbolic('sinh', x), half, 200n)]).toEqual([x, true]);
      expect([x, agree(exactHyperbolic('cosh', x), half, 200n)]).toEqual([x, true]);
    }
    expect(exactHyperbolic('tanh', 41)).toEqual(integer(1n));
    expect(exactHyperbolic('tanh', -1e300)).toEqual(integer(-1n));
    expect(ulps(Math.tanh(2), exactHyperbolic('tanh', 2))).toBeLessThan(1);
    expect(ulps(Math.tanh(39.9), exactHyperbolic('tanh', 39.9))).toBeLessThan(1);
    expect(exactHyperbolic('tanh', 0.5).num).toBeGreaterThan(0n);
  });

  it('computes tanh by series between 30 and 40, where it is below 1 by about 2 exp(-2x)', () => {
    for (const x of [35, 39.9]) {
      const t = exactHyperbolic('tanh', x);
      const gapToOne = sum(integer(1n), { num: -t.num, scale: t.scale });
      const two = exactExp(-2 * x);
      expect([
        x,
        t.num < 1n << t.scale,
        agree(gapToOne, { num: two.num, scale: two.scale - 1n }, 100n),
      ]).toEqual([x, true, true]);
    }
  });

  it('give inverse hyperbolic functions as logarithms, with the odd symmetry', () => {
    expect(ulps(0.881373587019543, exactInverseHyperbolic('asinh', 1))).toBeLessThan(1);
    expect(ulps(-0.881373587019543, exactInverseHyperbolic('asinh', -1))).toBeLessThan(1);
    expect(ulps(1.3169578969248166, exactInverseHyperbolic('acosh', 2))).toBeLessThan(1);
    expect(ulps(0.5493061443340548, exactInverseHyperbolic('atanh', 0.5))).toBeLessThan(1);
    expect(ulps(-0.5493061443340548, exactInverseHyperbolic('atanh', -0.5))).toBeLessThan(1);
    expect(exactInverseHyperbolic('acosh', 1).num).toBe(0n);
    expect(
      ulps(Math.atanh(1 - 2 ** -53), exactInverseHyperbolic('atanh', 1 - 2 ** -53)),
    ).toBeLessThan(1);
  });

  it('refuse an argument outside the domain', () => {
    expect(() => exactInverseHyperbolic('atanh', 1)).toThrow('the reference takes |x| < 1');
    expect(() => exactInverseHyperbolic('atanh', -1)).toThrow('the reference takes |x| < 1');
    expect(() => exactInverseHyperbolic('acosh', 0.5)).toThrow('the reference takes x >= 1');
  });
});

describe('libm reference: power', () => {
  it('refuse a number that is not finite and a base of zero', () => {
    for (const [x, y] of [
      [0, 1],
      [Infinity, 1],
      [2, NaN],
      [2, -Infinity],
    ] as const) {
      expect(() => exactPow(x, y)).toThrow(
        'the reference takes finite numbers and an x that is not zero',
      );
    }
  });

  it('give the power of the magnitude, and leave the sign to the caller', () => {
    expect(exactPow(-2, 3)).toEqual(exactPow(2, 3));
    expect(exactPow(-2, 3).num).toBeGreaterThan(0n);
    expect(agree(exactPow(0.5, -3), integer(8n), 250n)).toBe(true);
    expect(ulps(1e300, exactPow(10, 300))).toBeLessThanOrEqual(0.5);
    expect(ulps(2 ** 1000, exactPow(2, 1000))).toBeLessThanOrEqual(0.5);
    expect(ulps(5e-324, exactPow(2, -1074))).toBeLessThanOrEqual(0.5);
    expect(ulps(Math.sqrt(3), exactPow(3, 0.5))).toBeLessThanOrEqual(0.5);
  });
});
