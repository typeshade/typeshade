// ═══ The host-value boundary's quick paths (#410) ═══
//
// `toShader` converts a scalar that fits without descending the type, a vector or a matrix with
// one loop per element kind, and `fromShader` copies an array with a loop instead of
// `Array.from`. Each must give exactly what the path it skips gives, and must read the host's
// value exactly as that path reads it: the value, the text of a refusal and, for a value that
// reports what is read from it (an accessor, a `Proxy`), the reads in order. A host may hand
// over one that changes as it is read; an array the quick path read and then declined would be
// read a second time.
//
// A scalar is compared with the same scalar in a one-element `array<T, 1>`, which takes the
// descent (the quick path is only tried at the top). A vector and a matrix reach one conversion
// wherever they are, so they are compared with `reference`, the conversion as it was written
// before #410, kept here as it was.

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

/** A candidate value with the reads made of it, in order: a fresh one for each call, so a value
 *  that changes as it is read starts over. */
type Make = () => { readonly value: unknown; readonly log: string[] };
const plain =
  (v: unknown): Make =>
  () => ({ value: v, log: [] });

/** Candidate values for `t`: ones that fit, ones that almost do, and ones that do not. */
function candidates(t: HostType, pick: () => number): Make[] {
  const scalar = (): unknown => {
    const r = pick();
    return r < 0.8
      ? NUMBERS[Math.floor(pick() * NUMBERS.length)]
      : r < 0.9
        ? pick() < 0.5
        : OTHERS[Math.floor(pick() * OTHERS.length)];
  };
  if (t.k !== 'vec' && t.k !== 'mat') return Array.from({ length: 40 }, scalar).map(plain);
  const n = t.k === 'vec' ? t.n : t.c * t.r;
  const ordinary = Array.from({ length: 40 }, (_, i) => {
    const len = i % 10 === 0 ? n + 1 : i % 10 === 1 ? n - 1 : n;
    return Array.from({ length: len }, () =>
      t.e === 'bool' ? (pick() < 0.9 ? pick() < 0.5 : scalar()) : scalar(),
    );
  }).map(plain);
  return [...ordinary, ...exotic(t, n)];
}

/** Values of a vector or a matrix a host could hand over that are not plain arrays of the
 *  right length: holes, a subclass, an array-like, and an array that reports its reads or
 *  changes as they are made. */
function exotic(t: HostType & { k: 'vec' | 'mat' }, n: number): Make[] {
  const good: unknown = t.e === 'bool' ? true : 3;
  const bad: unknown = t.e === 'bool' ? 1 : 'x';
  const fits = (): unknown[] => Array.from({ length: n }, () => good);
  /** `xs`, with `at` defined as an accessor that runs `on` and answers `get(read)`. */
  const accessor = (
    at: number,
    on: (a: unknown[], log: string[]) => void,
    get: (read: number) => unknown,
  ): Make => {
    return () => {
      const log: string[] = [];
      const a = fits();
      let reads = 0;
      Object.defineProperty(a, at, {
        configurable: true,
        enumerable: true,
        get() {
          log.push(`get${at}#${++reads}`);
          on(a, log);
          return get(reads);
        },
      });
      return { value: a, log };
    };
  };
  /** A `Proxy` of `target` that logs every key it is asked for; `answer` may change one. */
  const spy =
    (target: () => unknown[], answer?: (key: string, seen: number) => unknown): Make =>
    () => {
      const log: string[] = [];
      const seen = new Map<string, number>();
      const value = new Proxy(target(), {
        get(tg, key, receiver) {
          const k = String(key);
          log.push(k);
          const count = (seen.get(k) ?? 0) + 1;
          seen.set(k, count);
          const answered = answer?.(k, count);
          return answered !== undefined ? answered : Reflect.get(tg, key, receiver);
        },
      });
      return { value, log };
    };
  class Sub extends Array<unknown> {}
  const holey = fits();
  delete holey[n - 1];
  const withBad = (): unknown[] => fits().map((x, i) => (i === n - 1 ? bad : x));
  return [
    plain(holey),
    plain(new Array(n)),
    plain(Sub.from(fits())),
    plain(Object.assign(fits(), { extra: 1 })),
    plain({ length: n, ...Object.fromEntries(fits().map((x, i) => [i, x])) }),
    plain(t.e === 'f32' || t.e === 'f64' ? new Float32Array(n) : Object.freeze(fits())),
    // An accessor that shortens the array as it is read, that grows it, and one that is wrong
    // the first time it is read and right after.
    accessor(
      0,
      (a) => (a.length = 1),
      () => good,
    ),
    accessor(
      0,
      (a) => a.push(good, good),
      () => good,
    ),
    accessor(
      n - 1,
      () => undefined,
      (read) => (read === 1 ? bad : good),
    ),
    accessor(
      n - 1,
      () => undefined,
      (read) => (read === 1 ? good : bad),
    ),
    // A `Proxy` that says what it is asked for, over a right array and a wrong one; and one whose
    // `length` is right the first time it is asked and wrong after.
    spy(fits),
    spy(withBad),
    spy(fits, (k, seen) => (k === 'length' && seen > 1 ? n + 2 : undefined)),
    spy(
      () => [...fits(), good],
      (k, seen) => (k === 'length' && seen === 1 ? n : undefined),
    ),
    spy(withBad, (k, seen) => (k === String(n - 1) && seen === 1 ? good : undefined)),
  ];
}

/** `f()`'s value, or the message of what it threw. */
function outcome(f: () => unknown): { value: unknown } | { threw: string } {
  try {
    return { value: f() };
  } catch (e) {
    return { threw: e instanceof TypeError ? e.message : String(e) };
  }
}

/** A refusal of `T` wrapped in `array<T, 1>`, put as the refusal of `T` alone: the type named
 *  is `T`, and where it went wrong is the path inside the one element. */
const unwrapped = (message: string, t: HostType): string =>
  message
    .replace(`(array<${t.s}, 1>)`, `(${t.s})`)
    .replace(/at \[0\](.*?), /, (_, inner: string) => (inner === '' ? '' : `at ${inner}, `));

/** How a value that did not fit is named in a refusal, as `host-values.ts` names it. */
function describeValue(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `an array of length ${v.length}`;
  if (ArrayBuffer.isView(v)) return `a ${v.constructor.name}`;
  if (typeof v === 'object') return 'an object';
  if (typeof v === 'string') return `the string ${JSON.stringify(v)}`;
  return `${typeof v} ${String(v)}`;
}

/** The conversion of a vector or a matrix as `convertIn` wrote it before #410, in what it reads
 *  of the host's value and in what it says when the value does not fit: `length` twice, then
 *  each element once, in order, with one loop for every element kind. `toShader` writes one loop
 *  for each kind, and is held to this. */
function reference(t: HostType & { k: 'vec' | 'mat' }, v: unknown): CpuValue {
  const n = t.k === 'vec' ? t.n : t.c * t.r;
  const refuse = (at: string, problem: string): never => {
    throw new TypeError(`f(): parameter "p" (${t.s}): ${at === '' ? '' : `at ${at}, `}${problem}.`);
  };
  if (typeof v !== 'object' || v === null || typeof (v as { length?: unknown }).length !== 'number')
    return refuse('', `got ${describeValue(v)}`);
  const xs = v as ArrayLike<unknown>;
  if (xs.length !== n)
    return refuse(
      '',
      Array.isArray(v)
        ? `got ${describeValue(v)}`
        : `got ${describeValue(v)} of length ${xs.length}`,
    );
  const out: (number | boolean)[] = [];
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    if (t.e === 'bool') {
      if (typeof x !== 'boolean') refuse(`[${i}]`, `got ${describeValue(x)}`);
      out.push(x as boolean);
      continue;
    }
    if (typeof x !== 'number') refuse(`[${i}]`, `got ${describeValue(x)}`);
    if (t.e === 'i32' || t.e === 'u32') {
      const [lo, hi] = t.e === 'i32' ? [-0x80000000, 0x7fffffff] : [0, 0xffffffff];
      if (!Number.isInteger(x) || (x as number) < lo! || (x as number) > hi!)
        refuse(`[${i}]`, `got ${x}, which is not a whole number in the ${t.e} range`);
    }
    out.push(t.e === 'f32' ? Math.fround(x as number) : (x as number));
  }
  return out as CpuValue;
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
  it('every argument converts, or is refused, and is read, as its descent would', () => {
    const pick = mulberry32(410);
    let converted = 0;
    let refused = 0;
    let reported = 0;
    for (const t of TYPES) {
      const wrapped: HostType = { k: 'arr', n: 1, e: t, s: `array<${t.s}, 1>` };
      const list = t.k === 'vec' || t.k === 'mat';
      for (const [k, make] of candidates(t, pick).entries()) {
        const direct = make();
        const skipped = make();
        const got = outcome(() => toShader('f', 'p', t, direct.value));
        const want = outcome(() =>
          list
            ? reference(t, skipped.value)
            : (toShader('f', 'p', wrapped, [skipped.value]) as unknown as CpuValue[])[0],
        );
        // (Named without reading the value: it may report what is read.)
        const what = `${t.s}, candidate ${k}`;
        if ('value' in got) converted++;
        else refused++;
        expect('value' in got, what).toBe('value' in want);
        if ('value' in got && 'value' in want) {
          expect(same(got.value, want.value), `${what}: ${JSON.stringify(got.value)}`).toBe(true);
          // A fresh array, never the host's own (Rule 8.21). (Not `expect(...).not.toBe(host)`:
          // the matcher reads the value it is given, and this one counts what is read.)
          if (Array.isArray(direct.value))
            expect(Object.is(got.value, direct.value), what).toBe(false);
          // And a whole one: no hole, and as long as the type says.
          if (Array.isArray(got.value))
            expect(Object.keys(got.value).length, what).toBe(got.value.length);
        } else if ('threw' in got && 'threw' in want) {
          // The text of the refusal, not only that there was one.
          expect(got.threw, what).toBe(list ? want.threw : unwrapped(want.threw, t));
        }
        // What was read of the host's value, and in what order.
        expect(direct.log, what).toEqual(skipped.log);
        if (direct.log.length > 0) reported++;
      }
    }
    // Both halves were reached: values that fit, values refused, and values that told us what
    // was read of them.
    expect(converted).toBeGreaterThan(150);
    expect(refused).toBeGreaterThan(150);
    expect(reported).toBeGreaterThan(80);
  });

  it('reads a host array once, however the host changes it as it is read (#410)', () => {
    // The instrument: what an accessor that shortens the array does to a conversion that reads
    // `length` again, and to one that reads an element twice. Each case is one the first cut of
    // the quick path answered differently from the descent (an array of holes, a vector of
    // five, a value refused on the first read and accepted on the second).
    const t = vec(3, 'f32');
    const shortened = [1, 2, 3];
    Object.defineProperty(shortened, 0, {
      configurable: true,
      get() {
        shortened.length = 1;
        return 1;
      },
    });
    expect(() => toShader('f', 'p', t, shortened)).toThrow(
      new TypeError('f(): parameter "p" (vec3): at [1], got undefined undefined.'),
    );
    const grown = [1, 2, 3];
    Object.defineProperty(grown, 0, {
      configurable: true,
      get() {
        grown.push(4, 5);
        return 1;
      },
    });
    expect(toShader('f', 'p', t, grown)).toEqual([1, 2, 3]);
    let reads = 0;
    const late = [1, 2, 3];
    Object.defineProperty(late, 2, {
      configurable: true,
      get: () => (++reads === 1 ? 'x' : 2),
    });
    expect(() => toShader('f', 'p', t, late)).toThrow(
      new TypeError('f(): parameter "p" (vec3): at [2], got the string "x".'),
    );
    expect(reads).toBe(1);
    const log: string[] = [];
    const spied = new Proxy([1, 2, 'x'], {
      get(target, key, receiver) {
        log.push(String(key));
        return Reflect.get(target, key, receiver);
      },
    });
    expect(() => toShader('f', 'p', t, spied)).toThrow('at [2], got the string "x"');
    expect(log).toEqual(['length', 'length', '0', '1', '2']);
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
