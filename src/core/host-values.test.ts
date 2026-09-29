// ═══ The host-value boundary's quick paths (#410) ═══
//
// `toShader` converts a scalar and a plain array of scalars, the values a host passes most,
// without descending the type, and `fromShader` copies an array with a loop instead of
// `Array.from`. Each must give exactly what the path it skips gives. An argument of type `T`
// wrapped in a one-element `array<T, 1>` takes the descent (the quick path is only tried at the
// top), so the two answers are compared here value for value, a refusal included.

import { describe, it, expect } from 'vitest';
import { fromShader, toShader, type HostNumber, type HostType } from './host-values.js';
import type { CpuValue } from './cpu-runtime.js';

const num = (t: HostNumber): HostType => ({ k: 'num', t, s: t });
const vec = (n: number, e: HostNumber | 'bool'): HostType => ({ k: 'vec', n, e, s: `vec${n}` });
const mat = (c: number, r: number, e: 'f32' | 'f64'): HostType => ({
  k: 'mat',
  c,
  r,
  e,
  s: `mat${c}x${r}`,
});
const TYPES: readonly HostType[] = [
  num('f32'),
  num('f64'),
  num('i32'),
  num('u32'),
  { k: 'bool', s: 'bool' },
  vec(2, 'f32'),
  vec(3, 'f32'),
  vec(4, 'f32'),
  vec(3, 'f64'),
  vec(2, 'i32'),
  vec(4, 'u32'),
  vec(3, 'bool'),
  mat(2, 2, 'f32'),
  mat(3, 2, 'f64'),
];

const NUMBERS = [
  0,
  -0,
  1,
  -1,
  0.5,
  0.1,
  1.5,
  2 ** 31 - 1,
  2 ** 31,
  -(2 ** 31),
  -(2 ** 31) - 1,
  2 ** 32 - 1,
  2 ** 32,
  NaN,
  Infinity,
  -Infinity,
  1e-45,
  3.5e38,
];
const OTHERS: readonly unknown[] = ['1', true, false, null, undefined, {}, [1]];

/** Candidate values for `t`: ones that fit, ones that almost do, and ones that do not. */
function candidates(t: HostType, pick: () => number): unknown[] {
  const scalar = (): unknown => {
    const r = pick();
    return r < 0.8
      ? NUMBERS[Math.floor(pick() * NUMBERS.length)]
      : r < 0.9
        ? pick() < 0.5
        : OTHERS[Math.floor(pick() * OTHERS.length)];
  };
  if (t.k !== 'vec' && t.k !== 'mat') return Array.from({ length: 40 }, scalar);
  const n = t.k === 'vec' ? t.n : t.c * t.r;
  return Array.from({ length: 40 }, (_, i) => {
    const len = i % 10 === 0 ? n + 1 : i % 10 === 1 ? n - 1 : n;
    return Array.from({ length: len }, () =>
      t.e === 'bool' ? (pick() < 0.9 ? pick() < 0.5 : scalar()) : scalar(),
    );
  });
}

/** `f()`'s value, or the message of what it threw. */
function outcome(f: () => unknown): { value: unknown } | { threw: string } {
  try {
    return { value: f() };
  } catch (e) {
    return { threw: e instanceof TypeError ? 'TypeError' : String(e) };
  }
}

/** Equal value for value, `Object.is` at every scalar, so -0 and NaN count. */
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => same(x, b[i]));
  return Object.is(a, b);
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('toShader and fromShader: the quick paths give what the descent gives (#410)', () => {
  it('every argument converts, or is refused, as its descent would', () => {
    const pick = mulberry32(410);
    let quick = 0;
    let refused = 0;
    for (const t of TYPES) {
      const wrapped: HostType = { k: 'arr', n: 1, e: t, s: `array<${t.s}, 1>` };
      for (const v of candidates(t, pick)) {
        const got = outcome(() => toShader('f', 'p', t, v));
        const want = outcome(() => (toShader('f', 'p', wrapped, [v]) as unknown as CpuValue[])[0]);
        if ('value' in got) quick++;
        else refused++;
        expect('value' in got, `${t.s} of ${String(v)}`).toBe('value' in want);
        if ('value' in got && 'value' in want) {
          expect(same(got.value, want.value), `${t.s} of ${JSON.stringify(v)}`).toBe(true);
          // A fresh array, never the host's own (Rule 8.21).
          if (Array.isArray(v)) expect(got.value).not.toBe(v);
        }
      }
    }
    // Both halves were reached: values that fit, and values refused.
    expect(quick).toBeGreaterThan(150);
    expect(refused).toBeGreaterThan(150);
  });

  it('a refusal names the function, the parameter and its type, as before', () => {
    expect(() => toShader('f', 'v', vec(2, 'f32'), [1, '2'])).toThrow(
      new TypeError('f(): parameter "v" (vec2): at [1], got the string "2".'),
    );
    expect(() => toShader('f', 'u', num('u32'), -1)).toThrow(
      new TypeError(
        'f(): parameter "u" (u32): got -1, which is not a whole number in the u32 range.',
      ),
    );
    expect(() => toShader('f', 'x', num('f32'), '1')).toThrow(
      new TypeError('f(): parameter "x" (f32): got the string "1".'),
    );
  });

  it('an array-like that is not an array still converts through the descent', () => {
    expect(toShader('f', 'v', vec(3, 'f32'), new Float32Array([0.1, 2, -0]))).toEqual([
      Math.fround(0.1),
      2,
      -0,
    ]);
  });

  it('a vector or matrix result is a new array of the same elements', () => {
    const results: readonly (readonly (number | boolean)[])[] = [
      [1, -0, NaN],
      [true, false],
      [0.5, 2, 3, 4],
    ];
    for (const v of results) {
      const out = fromShader(vec(v.length, 'f32'), v as CpuValue);
      expect(out).not.toBe(v);
      expect(same(out, Array.from(v))).toBe(true);
    }
    const typed = new Float32Array([1, 2]) as unknown as CpuValue;
    expect(fromShader(vec(2, 'f32'), typed)).toEqual([1, 2]);
  });
});
