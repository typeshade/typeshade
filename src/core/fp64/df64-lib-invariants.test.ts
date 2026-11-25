import { describe, it, expect } from 'vitest';
import {
  fn,
  module,
  f32T,
  vec2fT,
  f64T,
  sqrt,
  sin,
  cos,
  type Expr,
  type FuncDecl,
} from '../ir/index.js';
import { callFn } from '../ir/call-fn.js';
import { compileModule, type CpuValue } from '../oracle.js';
import { fp64Lower } from '../passes/fp64-lower.js';
import { eachExpr, eachStmtExpr } from '../ir/visit.js';
import { DF64_CALLS, DF64_FNS, DF64_ORDER, DF64_TRIG_CONSTANTS, splitF64 } from './df64-lib.js';

const decl = (name: string): FuncDecl => DF64_FNS.get(name)!;

const exprsOf = (d: FuncDecl): Expr[] => {
  const out: Expr[] = [];
  for (const s of d.body) eachStmtExpr(s, (e) => eachExpr(e, (x) => void out.push(x)));
  return out;
};

const callsOf = (name: string, prefix = ''): string[] =>
  exprsOf(decl(name))
    .filter((x) => x.op === 'call' && x.fn.startsWith(prefix))
    .map((x) => (x as Extract<Expr, { op: 'call' }>).fn);

const isGuard = (e: Expr): boolean => e.op === 'call' && e.fn === 'f64Guard';
const guardCount = (name: string): number => exprsOf(decl(name)).filter(isGuard).length;

const helperKernels = module({
  funcs: [
    fn('k_twoSum', { a: f32T, b: f32T }, (p) => callFn('df64_twoSum', vec2fT, p.a, p.b)),
    fn('k_quickTwoSum', { a: f32T, b: f32T }, (p) => callFn('df64_quickTwoSum', vec2fT, p.a, p.b)),
    fn('k_split', { a: f32T }, (p) => callFn('df64_split', vec2fT, p.a)),
    fn('k_twoProd', { a: f32T, b: f32T }, (p) => callFn('df64_twoProd', vec2fT, p.a, p.b)),
    fn('k_twoSqr', { a: f32T }, (p) => callFn('df64_twoSqr', vec2fT, p.a)),
    fn('k_add', { a: vec2fT, b: vec2fT }, (p) => callFn('df64_add', vec2fT, p.a, p.b)),
    fn('k_sub', { a: vec2fT, b: vec2fT }, (p) => callFn('df64_sub', vec2fT, p.a, p.b)),
    fn('k_sqrt', { a: vec2fT }, (p) => callFn('df64_sqrt', vec2fT, p.a)),
    fn('k_nint', { a: vec2fT }, (p) => callFn('df64_nint', vec2fT, p.a)),
    fn('k_mix', { a: vec2fT, b: vec2fT, t: f32T }, (p) =>
      callFn('df64_mix', vec2fT, p.a, p.b, p.t),
    ),
  ],
});
const helpers = compileModule(
  { ...helperKernels, funcs: [...DF64_ORDER, ...helperKernels.funcs] },
  { precision: 'f32' },
).fns;
const run = (name: string, ...args: CpuValue[]): number[] => helpers[name]!(...args) as number[];
const sum = (r: number[]): number => r[0]! + r[1]!;

const authored = module({
  funcs: [
    fn('a_add', { a: f64T, b: f64T }, (p) => p.a.add(p.b)),
    fn('a_mul', { a: f64T, b: f64T }, (p) => p.a.mul(p.b)),
    fn('a_sqr', { a: f64T }, (p) => p.a.mul(p.a)),
    fn('a_div', { a: f64T, b: f64T }, (p) => p.a.div(p.b)),
    fn('a_sqrt', { a: f64T }, (p) => sqrt(p.a)),
    fn('a_sin', { a: f64T }, (p) => sin(p.a)),
    fn('a_cos', { a: f64T }, (p) => cos(p.a)),
  ],
});
const lowered = compileModule(fp64Lower(authored), { precision: 'f32' }).fns;
const call64 = (name: string, ...xs: number[]): number[] =>
  lowered[name]!(...xs.map(splitF64)) as number[];

const bitsOf = (x: number): number => {
  if (x === 0) return 0;
  let m = Math.abs(x);
  const e = Math.floor(Math.log2(m));
  m = m / 2 ** (e - 23);
  let bits = 24;
  while (bits > 0 && m % 2 === 0) {
    m /= 2;
    bits--;
  }
  return bits;
};

const ulp = (x: number): number => 2 ** (Math.floor(Math.log2(Math.abs(x))) - 23);

const PAIRS: readonly (readonly [number, number])[] = [
  [1e8, 0.5],
  [0.5, 1e8],
  [1, 2 ** -30],
  [2 ** -30, 1],
  [3.1415927, -2.7182817],
  [-1e-3, 123456.78],
  [2 ** 20, -(2 ** 20) + 0.25],
  [0.1, 0.2],
].map(([a, b]) => [Math.fround(a!), Math.fround(b!)] as const);

describe('error-free transformations stay exact', () => {
  it('twoSum is exact in either magnitude order', () => {
    for (const [a, b] of PAIRS) {
      const r = run('k_twoSum', a, b);
      expect(sum(r), `${a} + ${b}`).toBe(a + b);
      expect(r[0]).toBe(Math.fround(a + b));
    }
  });

  it('quickTwoSum is exact when |a| >= |b| and is not twoSum when it is not', () => {
    for (const [a, b] of PAIRS) {
      if (Math.abs(a) < Math.abs(b)) continue;
      expect(sum(run('k_quickTwoSum', a, b)), `${a} + ${b}`).toBe(a + b);
    }
    const violated = run('k_quickTwoSum', 0.5, 1e8);
    expect(sum(violated)).not.toBe(0.5 + 1e8);
  });

  it('split reconstructs a, with at most 12 bits in hi and 11 in lo', () => {
    for (const a of [1e8 + 8, 0.1, 3.1415927, -2.7182817, 16777215, 2 ** -20 * 1.0000001]) {
      const x = Math.fround(a);
      const [hi, lo] = run('k_split', x);
      expect(hi! + lo!, `${x}`).toBe(x);
      expect(bitsOf(hi!), `hi of ${x}`).toBeLessThanOrEqual(12);
      expect(bitsOf(lo!), `lo of ${x}`).toBeLessThanOrEqual(11);
    }
  });

  it('split overflows above about 2^115 and is exact below it', () => {
    const [hiOk, loOk] = run('k_split', 2 ** 114);
    expect(hiOk! + loOk!).toBe(2 ** 114);
    const [hiBad, loBad] = run('k_split', 2 ** 116);
    expect(hiBad! + loBad!).not.toBe(2 ** 116);
  });

  it('split multiplies by 4097 times the guard, so the constant cannot fold', () => {
    const guarded = exprsOf(decl('df64_split')).filter(
      (x) =>
        x.op === 'binop' &&
        x.bop === '*' &&
        [x.a, x.b].some(isGuard) &&
        [x.a, x.b].some((y) => y.op === 'lit' && y.value === 4097),
    );
    expect(guarded).toHaveLength(1);
  });

  it('twoProd and twoSqr are exact products', () => {
    for (const [a, b] of PAIRS) {
      expect(sum(run('k_twoProd', a, b)), `${a} * ${b}`).toBe(a * b);
      expect(sum(run('k_twoSqr', a)), `${a}^2`).toBe(a * a);
    }
  });

  it('no helper uses fma', () => {
    for (const d of DF64_ORDER) {
      const fmas = exprsOf(d).filter((x) => x.op === 'call' && x.fn === 'fma');
      expect(fmas, d.name).toEqual([]);
    }
  });
});

describe('guard placement', () => {
  it('twoSum carries four guard multiplies and quickTwoSum two', () => {
    expect(guardCount('df64_twoSum')).toBe(4);
    expect(guardCount('df64_quickTwoSum')).toBe(2);
  });

  it('a constant df64 literal pair is never multiplied by the guard', () => {
    for (const d of DF64_ORDER) {
      const guardedLiterals = exprsOf(d).filter(
        (x) =>
          x.op === 'binop' &&
          x.bop === '*' &&
          [x.a, x.b].some(isGuard) &&
          [x.a, x.b].some((y) => y.op === 'construct' && y.args.every((z) => z.op === 'lit')),
      );
      expect(guardedLiterals, d.name).toEqual([]);
    }
  });

  it('comparators read no guard', () => {
    for (const d of DF64_ORDER)
      if (/^df64_(v\d_)?(lt|gt|le|ge|eq|ne)$/.test(d.name))
        expect(exprsOf(d).filter(isGuard), d.name).toEqual([]);
  });
});

describe('composition of the arithmetic', () => {
  it('sub is add of the componentwise negation, bit for bit', () => {
    for (const [a, b] of PAIRS) {
      const x = [a, Math.fround(a * 2 ** -25)];
      const y = [b, Math.fround(b * 2 ** -26)];
      const negY = y.map((v) => -v);
      expect(run('k_sub', x, y)).toEqual(run('k_add', x, negY));
    }
  });

  it('mul renormalizes after each cross term and sqr once, from one split', () => {
    expect(callsOf('df64_mul', 'df64_').sort()).toEqual([
      'df64_quickTwoSum',
      'df64_quickTwoSum',
      'df64_twoProd',
    ]);
    expect(callsOf('df64_sqr', 'df64_').sort()).toEqual(['df64_quickTwoSum', 'df64_twoSqr']);
    expect(callsOf('df64_twoSqr', 'df64_')).toEqual(['df64_split']);
    expect(callsOf('df64_twoProd', 'df64_')).toEqual(['df64_split', 'df64_split']);
  });

  it('add is two twoSums and two renormalizations', () => {
    expect(callsOf('df64_add', 'df64_').sort()).toEqual([
      'df64_quickTwoSum',
      'df64_quickTwoSum',
      'df64_twoSum',
      'df64_twoSum',
    ]);
  });

  it('the vector mul renormalizes after each cross term, add and the lanes stay whole-plane', () => {
    for (const n of [2, 3, 4]) {
      expect(callsOf(`df64_v${n}_mul`, 'df64_').sort()).toEqual([
        `df64_v${n}_quickTwoSum`,
        `df64_v${n}_quickTwoSum`,
        `df64_v${n}_twoProd`,
      ]);
      expect(callsOf(`df64_v${n}_add`, 'df64_').sort()).toEqual([
        `df64_v${n}_quickTwoSum`,
        `df64_v${n}_quickTwoSum`,
        `df64_v${n}_twoSum`,
        `df64_v${n}_twoSum`,
      ]);
    }
  });

  it('the per-lane builtins call the scalar helper once per lane', () => {
    for (const n of [2, 3, 4])
      for (const name of ['abs', 'min', 'max', 'mix', 'floor', 'fract', 'round', 'sin', 'cos'])
        expect(callsOf(`df64_v${n}_${name}`, 'df64_'), `${n} ${name}`).toEqual(
          Array(n).fill(`df64_${name}`),
        );
  });

  it('sin and cos each carry their own reduction inline, with no shared reduction fn', () => {
    expect(callsOf('df64_sin', 'df64_').filter((c) => c === 'df64_nint')).toHaveLength(1);
    expect(callsOf('df64_cos', 'df64_').filter((c) => c === 'df64_nint')).toHaveLength(1);
    expect(DF64_ORDER.map((d) => d.name).filter((n) => /reduc/.test(n))).toEqual([]);
  });
});

describe('results stay normalized', () => {
  it('lo stays within half an ulp of hi after add, mul, sqr, div and sqrt', () => {
    const xs = [1e8 + 0.5, 3.14159265358979, -2.718281828459045, 1 / 3, 123456.789, 2 ** -20 / 7];
    for (const a of xs)
      for (const b of xs) {
        const results = [
          call64('a_add', a, b),
          call64('a_mul', a, b),
          call64('a_div', a, b),
          call64('a_sqr', a),
          call64('a_sqrt', Math.abs(a)),
        ];
        for (const [hi, lo] of results.map((r) => r as [number, number]))
          if (hi !== 0) expect(Math.abs(lo), `${a} ${b}`).toBeLessThanOrEqual(ulp(hi) / 2);
      }
  });
});

describe('sqrt, nint, mix', () => {
  it('sqrt of a negative is NaN, not a number', () => {
    expect(run('k_sqrt', [-4, 0])[0]).toBeNaN();
  });

  it('nint breaks ties toward +infinity, with the lo word correcting a hi tie', () => {
    const tiny = 2 ** -30;
    const cases: [number[], number][] = [
      [[0.5, 0], 1],
      [[-0.5, 0], 0],
      [[-1.5, 0], -1],
      [[2.5, 0], 3],
      [[0.5, -tiny], 0],
      [[0.5, tiny], 1],
      [[-0.5, -tiny], -1],
      [[-0.5, tiny], 0],
      [[2 ** 24, 1], 2 ** 24 + 1],
      [[2 ** 24, -1], 2 ** 24 - 1],
      [[2 ** 24, 0.5], 2 ** 24 + 1],
    ];
    for (const [x, want] of cases) expect(sum(run('k_nint', x)), JSON.stringify(x)).toBe(want);
  });

  it('mix widens the f32 interpolant exactly', () => {
    for (const t of [Math.fround(1 / 3), Math.fround(0.1), Math.fround(0.7777777)])
      expect(sum(run('k_mix', [0, 0], [1, 0], t))).toBe(t);
  });
});

describe('sin and cos constants and accuracy', () => {
  it('the constants carry their mathematical values', () => {
    const c = DF64_TRIG_CONSTANTS;
    expect([c.TWO_PI, c.PI_2, c.PI_16]).toEqual([2 * Math.PI, Math.PI / 2, Math.PI / 16]);
    expect([c.INV_FACT_3, c.INV_FACT_4, c.INV_FACT_5, c.INV_FACT_6]).toEqual([
      1 / 6,
      1 / 24,
      1 / 120,
      1 / 720,
    ]);
    expect(c.COS_TABLE).toEqual([1, 2, 3, 4].map((k) => Math.cos((k * Math.PI) / 16)));
    expect(c.SIN_TABLE).toEqual([1, 2, 3, 4].map((k) => Math.sin((k * Math.PI) / 16)));
  });

  it('sin and cos hold 2^-34 across the reduced and the full range', () => {
    for (let i = -40; i <= 40; i++) {
      const x = i * 0.37 + 0.011;
      expect(Math.abs(sum(call64('a_sin', x)) - Math.sin(x)), `sin ${x}`).toBeLessThan(2 ** -34);
      expect(Math.abs(sum(call64('a_cos', x)) - Math.cos(x)), `cos ${x}`).toBeLessThan(2 ** -34);
    }
  });
});

describe('the registry', () => {
  it('lists each helper once, after every helper it calls', () => {
    const names = DF64_ORDER.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...DF64_FNS.keys()]).toEqual(names);
    DF64_ORDER.forEach((d, i) => {
      for (const callee of exprsOf(d).flatMap((x) =>
        x.op === 'call' && x.fn.startsWith('df64_') ? [x.fn] : [],
      ))
        expect(names.indexOf(callee), `${d.name} calls ${callee}`).toBeLessThan(i);
    });
  });

  it('the call handles are the registered helpers', () => {
    for (const [key, handle] of Object.entries(DF64_CALLS))
      expect(handle.decl, key).toBe(decl(`df64_${key}`));
  });
});
