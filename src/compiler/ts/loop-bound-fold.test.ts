import { describe, expect, it } from 'vitest';
import type { Expr } from '../../core/ir/nodes.js';
import { f32T, i32T, u32T, vec2fT, vec3fT, type ShaderType } from '../../core/ir/types.js';
import type { Binding, LoweringScope } from './context.js';
import {
  constCallOutsideDomain,
  constF32OutOfRange,
  constShiftAmountOutOfRange,
  crossedClampBounds,
  foldConstComponents,
  foldConstNumber,
} from './loop-bound.js';

const lit = (value: number | boolean, type: ShaderType = i32T): Expr => ({
  op: 'lit',
  type,
  value,
});
const bin = (
  bop: Expr extends infer E ? (E extends { bop: infer B } ? B : never) : never,
  a: Expr,
  b: Expr,
  type: ShaderType = i32T,
): Expr => ({ op: 'binop', type, bop, a, b }) as Expr;
const neg = (a: Expr, type: ShaderType = i32T): Expr => ({ op: 'unop', type, a });
const call = (fn: string, args: Expr[], type: ShaderType = f32T): Expr => ({
  op: 'call',
  type,
  fn,
  args,
});
const ref = (op: 'varref' | 'param' | 'constref', name: string, type: ShaderType = i32T): Expr =>
  ({ op, type, name }) as Expr;
const vec2 = (...args: Expr[]): Expr => ({ op: 'construct', type: vec2fT, args });
const f = (v: number): Expr => lit(v, f32T);

const scopeOf = (table: Record<string, Partial<Binding>>): LoweringScope =>
  ({
    resolveIr: (name: string) => table[name],
    resolve: () => ({ constValue: 99 }),
  }) as unknown as LoweringScope;
const none = scopeOf({});

describe('foldConstNumber folds as the targets compute', () => {
  it('wraps a negated integer into its type, and leaves a float alone', () => {
    expect(foldConstNumber(neg(lit(-2147483648)), none)).toBe(-2147483648);
    expect(foldConstNumber(neg(f(1.5), f32T), none)).toBe(-1.5);
  });

  it('reads a name by its IR name, never by the source name another declaration holds', () => {
    const scope = scopeOf({ K_1: { constValue: 3 }, P: { constValue: 5, mutable: false } });
    expect(foldConstNumber(ref('constref', 'K_1'), scope)).toBe(3);
    expect(foldConstNumber(ref('varref', 'P'), scope)).toBe(5);
  });

  it('takes a captured constant through a param, and never a mutable name', () => {
    const scope = scopeOf({
      C: { constValue: 4, mutable: false },
      M: { constValue: 4, mutable: true },
    });
    expect(foldConstNumber(ref('param', 'C'), scope)).toBe(4);
    expect(foldConstNumber(ref('param', 'M'), scope)).toBeUndefined();
    expect(foldConstNumber(ref('varref', 'M'), scope)).toBeUndefined();
  });

  it('computes an integer operation the way the hardware does', () => {
    expect(foldConstNumber(bin('*', lit(100000), lit(100000)), none)).toBe(1410065408);
    expect(foldConstNumber(bin('-', lit(0, u32T), lit(1, u32T), u32T), none)).toBe(4294967295);
    expect(foldConstNumber(bin('/', lit(1), lit(2)), none)).toBe(0);
  });

  it('folds the bit operators on whole numbers and leaves the rest alone', () => {
    expect(foldConstNumber(bin('<<', f(1), f(2), f32T), none)).toBe(4);
    expect(foldConstNumber(bin('>>', f(8), f(2), f32T), none)).toBe(2);
    expect(foldConstNumber(bin('&', f(6), f(3), f32T), none)).toBe(2);
    expect(foldConstNumber(bin('|', f(6), f(3), f32T), none)).toBe(7);
    expect(foldConstNumber(bin('^', f(6), f(3), f32T), none)).toBe(5);
    expect(foldConstNumber(bin('<<', f(1.5), f(1), f32T), none)).toBeUndefined();
    expect(foldConstNumber(bin('<<', f(1), f(1.5), f32T), none)).toBeUndefined();
    expect(foldConstNumber(bin('<<', f(1), f(32), f32T), none)).toBeUndefined();
    expect(foldConstNumber(bin('>>', f(1), f(-1), f32T), none)).toBeUndefined();
  });

  it('wraps ~x into its type, and conversions into their target', () => {
    expect(foldConstNumber(call('~', [lit(0, u32T)], u32T), none)).toBe(4294967295);
    expect(foldConstNumber(call('u32', [lit(-1)], u32T), none)).toBe(4294967295);
    expect(foldConstNumber(call('i32', [f(-2.7)], i32T), none)).toBe(-2);
    expect(foldConstNumber(call('f32', [f(2.5)], f32T), none)).toBe(2.5);
    expect(foldConstNumber(call('~', [f(1.5)], i32T), none)).toBeUndefined();
  });

  it('folds a math builtin only when it is the builtin and its value is finite', () => {
    expect(foldConstNumber(call('sin', [f(0)]), none)).toBe(0);
    const declared = { ...call('sin', [f(0)]), declRef: {} } as Expr;
    expect(foldConstNumber(declared, none)).toBeUndefined();
    expect(foldConstNumber(call('sqrt', [f(-1)]), none)).toBeUndefined();
    expect(foldConstNumber(call('exp', [f(1000)]), none)).toBeUndefined();
  });
});

describe('foldConstComponents folds componentwise', () => {
  const fold = (e: Expr, calls = true): number[] | undefined =>
    foldConstComponents(e, none, undefined, undefined, undefined, calls);

  it('evaluates each builtin of the const-call table', () => {
    const at = (fn: string, ...xs: number[]): number[] | undefined => fold(call(fn, xs.map(f)));
    expect(at('pow', 2, 3)).toEqual([8]);
    expect(at('sqrt', 9)).toEqual([3]);
    expect(at('inverseSqrt', 4)).toEqual([0.5]);
    expect(at('log', Math.E)).toEqual([1]);
    expect(at('log2', 8)).toEqual([3]);
    expect(at('exp', 0)).toEqual([1]);
    expect(at('exp2', 3)).toEqual([8]);
    expect(at('sinh', 0)).toEqual([0]);
    expect(at('cosh', 0)).toEqual([1]);
    expect(at('degrees', Math.PI)).toEqual([180]);
    expect(at('ldexp', 1.5, 3)).toEqual([12]);
    expect(at('fma', 2, 3, 4)).toEqual([10]);
  });

  it('does not fold a call outside the domain, a declared function or a call unasked for', () => {
    expect(fold(call('log', [f(-1)]))).toBeUndefined();
    expect(fold({ ...call('sqrt', [f(4)]), declRef: {} } as Expr)).toBeUndefined();
    expect(fold(call('sqrt', [f(4)]), false)).toBeUndefined();
    expect(fold(call('sqrt', [lit(4)], i32T))).toBeUndefined();
  });

  it('broadcasts a scalar against a vector and refuses vectors of different widths', () => {
    const v3 = { op: 'construct', type: vec3fT, args: [f(1), f(2), f(3)] } as Expr;
    expect(fold(bin('*', vec2(f(1), f(2)), f(3), vec2fT))).toEqual([3, 6]);
    expect(fold(bin('+', vec2(f(1), f(2)), v3, vec2fT))).toBeUndefined();
    expect(fold(call('pow', [vec2(f(2), f(3)), v3]))).toBeUndefined();
    expect(fold(call('pow', [vec2(f(2), f(3)), f(2)], vec2fT))).toEqual([4, 9]);
  });

  it('leaves a division by zero unfolded and splats one scalar into a vector', () => {
    expect(fold(bin('/', f(1), f(0), f32T))).toBeUndefined();
    expect(fold(vec2(f(7)))).toEqual([7, 7]);
  });

  it('folds in f32 steps when asked, and in doubles otherwise', () => {
    const sum = bin('+', f(0.1), f(0.2), f32T);
    expect(foldConstComponents(sum, none)).toEqual([0.1 + 0.2]);
    expect(foldConstComponents(sum, none, undefined, undefined, Math.fround)).toEqual([
      Math.fround(Math.fround(0.1) + Math.fround(0.2)),
    ]);
  });

  it('rounds every constant it reads and every result it computes', () => {
    const scope = scopeOf({ K: { constValue: 0.1, mutable: false } });
    const round = (e: Expr): number[] | undefined =>
      foldConstComponents(e, scope, undefined, undefined, Math.fround, true);
    expect(round(ref('constref', 'K', f32T))).toEqual([Math.fround(0.1)]);
    expect(round(ref('varref', 'K', f32T))).toEqual([Math.fround(0.1)]);
    const f32 = (v: number): number => Math.fround(v);
    expect(round(bin('-', f(0.3), f(0.1), f32T))).toEqual([f32(f32(0.3) - f32(0.1))]);
    expect(round(bin('/', f(0.3), f(0.7), f32T))).toEqual([f32(f32(0.3) / f32(0.7))]);
    expect(round(bin('*', f(0.1), f(0.1), f32T))).toEqual([f32(f32(0.1) * f32(0.1))]);
    expect(round(call('exp', [f(0.3)]))).toEqual([f32(Math.exp(f32(0.3)))]);
  });

  it('reads a constant vector through the table of module constants', () => {
    const table = new Map([['SIZE', vec2(f(2), f(4))]]);
    const e = bin('*', ref('constref', 'SIZE', vec2fT), f(0.5), vec2fT);
    expect(foldConstComponents(e, none, table)).toEqual([1, 2]);
    const scope = scopeOf({ SIZE: { valueExpr: vec2(f(6), f(8)) } });
    expect(foldConstComponents(e, scope)).toEqual([3, 4]);
  });
});

describe('the const range and domain proofs refuse only what both readings refuse', () => {
  it('refuses a call outside its domain, naming the first component', () => {
    expect(constCallOutsideDomain('sqrt', [f(-1)], none)).toEqual({
      index: -1,
      values: [-1],
      why: '-1 is below 0',
    });
    expect(constCallOutsideDomain('inverseSqrt', [f(0)], none)?.why).toBe('0 is not above 0');
    const v = vec2(f(4), f(-9));
    expect(constCallOutsideDomain('sqrt', [v], none)?.index).toBe(1);
  });

  it('refuses pow only for a negative base, or a base of 0 with an exponent not above 0', () => {
    expect(constCallOutsideDomain('pow', [f(0), f(0)], none)?.why).toBe(
      'the base is 0 and the exponent 0 is not above 0',
    );
    expect(constCallOutsideDomain('pow', [f(0), f(2)], none)).toBeUndefined();
    expect(constCallOutsideDomain('pow', [f(-2), f(2)], none)?.why).toBe('the base -2 is below 0');
  });

  it('leaves an argument one f32 rounding from the bound to Tint', () => {
    expect(constCallOutsideDomain('sqrt', [f(-1e-46)], none)).toBeUndefined();
  });

  it('checks only f32 arguments, and the smoothstep edges whatever x is', () => {
    expect(constCallOutsideDomain('sqrt', [lit(-1)], none)).toBeUndefined();
    const x = ref('varref', 'x', f32T);
    expect(constCallOutsideDomain('smoothstep', [f(1), f(1), x], none)?.why).toBe(
      'the low and the high edge are both 1',
    );
    expect(constCallOutsideDomain('pow', [f(-2), x], none)).toBeUndefined();
  });

  it('refuses a zero vector for normalize once, without a component index', () => {
    const zero = constCallOutsideDomain('normalize', [vec2(f(0), f(0))], none);
    expect(zero?.index).toBe(-1);
    expect(constCallOutsideDomain('normalize', [vec2(f(0), f(1))], none)).toBeUndefined();
  });

  it('leaves a value no double holds to the writer', () => {
    expect(constF32OutOfRange(f(Infinity), none)).toBeUndefined();
    expect(constF32OutOfRange(bin('*', f(1e30), f(1e30), f32T), none)).toBeCloseTo(1e60, -50);
    expect(constF32OutOfRange(call('exp', [f(89)]), none)).toBeGreaterThan(3.4e38);
    expect(constF32OutOfRange(call('exp', [f(1000)]), none)).toBeUndefined();
  });

  it('refuses a clamp whose bounds cross, in the integer the GPU computes', () => {
    expect(crossedClampBounds(lit(2147483648), lit(0), none)).toBeUndefined();
    expect(crossedClampBounds(lit(4294967295, u32T), lit(0, u32T), none)).toEqual({
      index: 0,
      low: 4294967295,
      high: 0,
    });
    expect(crossedClampBounds(lit(2.5), lit(1), none)).toBeUndefined();
    expect(crossedClampBounds(vec2(f(1), f(1)), f(0), none)).toBeUndefined();
  });

  it('refuses a float pair only when it crosses exactly and in f32 steps', () => {
    expect(crossedClampBounds(f(2), f(1), none)).toEqual({ index: 0, low: 2, high: 1 });
    const product = (a: number, b: number): Expr => bin('*', f(a), f(b), f32T);
    expect(crossedClampBounds(product(0.1, 0.1), f(0.01), none)).toBeUndefined();
    expect(crossedClampBounds(product(8.782, 1.056), f(9.273791313171387), none)).toBeUndefined();
  });

  it('wraps a vector shift amount into its integer type, and leaves a fraction to Tint', () => {
    const u2 = {
      op: 'construct',
      type: { kind: 'vec', n: 2, elem: 'u32' },
      args: [lit(-1, u32T), lit(1, u32T)],
    } as Expr;
    expect(constShiftAmountOutOfRange(u2, none)).toBe(4294967295);
    const frac = { ...u2, args: [lit(2.5, u32T), lit(40, u32T)] } as Expr;
    expect(constShiftAmountOutOfRange(frac, none)).toBeUndefined();
    expect(constShiftAmountOutOfRange(lit(32), none)).toBe(32);
  });
});
