// A constant expression the target refuses is given its value at run time (#368). Each case is
// IR the optimizer or an author's constants leave in front of the writer, with Tint's text for
// it recorded at the head of `const-expr.ts`. The pass may change no value, so every case also
// runs on the CPU oracle before and after it, and the two must agree on every input.

import { describe, expect, it } from 'vitest';
import type { BinOp, ConstDecl, Expr, ModuleDecl, ShaderType, Stmt } from '../ir/index.js';
import { f32T, i32T, u32T, vec2uT } from '../ir/index.js';
import { compileModule } from '../oracle.js';
import { emitModule } from '../backends/wgsl.js';
import { eachExpr } from '../ir/visit.js';
import { settleConstExprs } from './const-expr.js';

const lit = (type: ShaderType, value: number): Expr => ({ op: 'lit', type, value });
const u = (v: number): Expr => lit(u32T, v);
const i = (v: number): Expr => lit(i32T, v);
const vec2u = (a: number, b: number): Expr => ({
  op: 'construct',
  type: vec2uT,
  args: [u(a), u(b)],
});
const bin = (bop: BinOp, a: Expr, b: Expr): Expr => ({ op: 'binop', type: a.type, bop, a, b });
const call = (fn: string, type: ShaderType, ...args: Expr[]): Expr => ({
  op: 'call',
  type,
  fn,
  args,
});
const param = (type: ShaderType): Expr => ({ op: 'param', type, name: 'x' });
const constref = (c: ConstDecl): Expr => ({ op: 'constref', type: c.type, name: c.name });
const konst = (name: string, type: ShaderType, value: number): ConstDecl => ({
  name,
  type,
  wgslValue: value,
  cpuValue: value,
});

const X = param(u32T);
const XI = param(i32T);
const V = param(vec2uT);
const XF = param(f32T);

/** The inputs each case runs on, by the type of `x`. */
const INPUTS: Record<string, readonly unknown[]> = {
  u32: [0, 1, 7, 2147483648, 4294967295],
  i32: [0, 1, -7, -2147483648, 2147483647],
  f32: [0, 0.25, 0.75, 2, -3],
  'vec2<u32>': [
    [0, 1],
    [7, 9],
    [4294967295, 2147483648],
  ],
};

/** `k(x)` running `body`, with `consts`. */
const moduleOf = (
  ret: ShaderType,
  x: ShaderType,
  body: Stmt[],
  consts: ConstDecl[] = [],
): ModuleDecl => ({
  consts,
  structs: [],
  bindings: [],
  funcs: [{ name: 'k', params: [{ name: 'x', type: x }], ret, body }],
});

const typeName = (t: ShaderType): string =>
  t.kind === 'vec' ? `vec${t.n}<${t.elem}>` : t.kind === 'scalar' ? t.scalar : t.kind;

/** The module after the pass, having checked that the oracle computes it as it computed the
 *  module before, on every input of `x`'s type. */
function settled(m: ModuleDecl): ModuleDecl {
  const out = settleConstExprs(m);
  const before = compileModule(m, { precision: 'f32' }).fns.k!;
  const after = compileModule(out, { precision: 'f32' }).fns.k!;
  for (const v of INPUTS[typeName(m.funcs[0]!.params[0]!.type)]!)
    expect(after(structuredClone(v) as never), `k(${JSON.stringify(v)})`).toEqual(
      before(structuredClone(v) as never),
    );
  return out;
}

/** The type of the `x` a case reads. */
function paramType(e: Expr): ShaderType {
  let t: ShaderType = u32T;
  eachExpr(e, (n) => {
    if (n.op === 'param') t = n.type;
  });
  return t;
}

/** `e` returned from `k(x)`, settled. */
const settle = (e: Expr, consts: ConstDecl[] = []): Expr =>
  (
    settled(moduleOf(e.type, paramType(e), [{ s: 'return', expr: e }], consts)).funcs[0]!
      .body[0] as { expr: Expr }
  ).expr;

/** `e`'s return line, as WGSL writes it. */
const wgslOf = (e: Expr, x: ShaderType, consts: ConstDecl[] = []): string =>
  emitModule(moduleOf(e.type, x, [{ s: 'return', expr: e }], consts))
    .split('\n')
    .find((l) => l.includes('return'))!
    .trim();

describe('a constant expression the target refuses is given its value at run time (#368)', () => {
  it('an integer divisor the optimizer made zero: x / 0 is x, x % 0 is 0', () => {
    expect(settle(bin('/', X, u(0)))).toEqual(X);
    expect(settle(bin('%', X, u(0)))).toEqual(u(0));
    expect(settle(bin('/', XI, i(0)))).toEqual(XI);
    // The optimizer folds `x - x` to 0 on an integer, which left `(7u / 0u)` for Tint to refuse.
    expect(wgslOf(bin('/', u(7), bin('-', X, X)), u32T)).toBe('return 7u;');
    expect(wgslOf(bin('%', u(7), bin('^', X, X)), u32T)).toBe('return 0u;');
    expect(wgslOf(bin('%', X, u(0)), u32T)).toBe('return 0u;');
  });

  it('a vector divisor keeps its other components, and a scalar zero divides every one', () => {
    expect(settle(bin('/', V, vec2u(0, 2)))).toEqual(bin('/', V, vec2u(1, 2)));
    expect(settle(bin('%', V, vec2u(3, 0)))).toEqual(bin('%', V, vec2u(3, 1)));
    expect(settle({ op: 'binop', type: vec2uT, bop: '/', a: V, b: u(0) })).toEqual(V);
    expect(wgslOf(bin('%', V, vec2u(0, 0)), vec2uT)).toBe('return vec2<u32>(0u, 0u);');
  });

  it('a dividend with an effect is kept: atomicAdd(…) % 0 is atomicAdd(…) % 1', () => {
    const counter: Expr = { op: 'varref', type: u32T, name: 'counter' };
    const add = call('atomicAdd', u32T, counter, u(1));
    const m = moduleOf(u32T, u32T, [{ s: 'return', expr: bin('%', add, u(0)) }]);
    const out = settleConstExprs(m).funcs[0]!.body[0] as { expr: Expr };
    expect(out.expr).toEqual(bin('%', add, u(1)));
  });

  it('a shift amount past 31 keeps its low five bits, as the target takes it', () => {
    expect(settle(bin('<<', X, u(33)))).toEqual(bin('<<', X, u(1)));
    expect(settle(bin('>>', XI, u(40)))).toEqual({
      op: 'binop',
      type: i32T,
      bop: '>>',
      a: XI,
      b: u(8),
    });
    expect(settle(bin('<<', V, vec2u(1, 40)))).toEqual(bin('<<', V, vec2u(1, 8)));
    expect(settle(bin('<<', X, u(31)))).toEqual(bin('<<', X, u(31)));
  });

  it('a shift of constants whose value the type cannot hold is the wrapped value', () => {
    const S = konst('S', i32T, 3);
    const SU = konst('SU', u32T, 3);
    expect(settle(bin('+', XI, bin('<<', constref(S), u(31))), [S])).toEqual(
      bin('+', XI, i(-2147483648)),
    );
    expect(settle(bin('+', X, bin('<<', constref(SU), u(31))), [SU])).toEqual(
      bin('+', X, u(2147483648)),
    );
    expect(settle(bin('+', XI, bin('<<', i(3), u(31))))).toEqual(bin('+', XI, i(-2147483648)));
    // The neighbours Tint accepts keep their spelling: -1 << 31 and 1u << 31 lose no bit.
    const N = konst('N', i32T, -1);
    const ONE = konst('ONE', u32T, 1);
    const kept = [
      [bin('+', XI, bin('<<', constref(N), u(31))), N],
      [bin('+', X, bin('<<', constref(ONE), u(31))), ONE],
    ] as const;
    for (const [e, c] of kept) expect(settle(e, [c])).toEqual(e);
  });

  it('an abstract i32 operation past the type is its wrapped value; a concrete one is kept', () => {
    const M = konst('M', i32T, -2147483648);
    const S = konst('S', i32T, 2147483647);
    const T = konst('T', i32T, 3);
    const MIN = i(-2147483648);
    expect(settle(bin('+', XI, bin('+', i(2147483647), i(1))))).toEqual(bin('+', XI, MIN));
    expect(settle(bin('+', XI, bin('/', MIN, i(-1))))).toEqual(bin('+', XI, MIN));
    expect(settle(bin('+', XI, { op: 'unop', type: i32T, a: MIN }))).toEqual(bin('+', XI, MIN));
    expect(settle(bin('+', X, call('u32', u32T, i(-1))))).toEqual(bin('+', X, u(4294967295)));
    // Over a module constant, a division and a remainder are refused and a sum is not.
    expect(settle(bin('+', XI, bin('/', constref(M), i(-1))), [M])).toEqual(bin('+', XI, MIN));
    expect(settle(bin('+', XI, bin('%', constref(M), i(-1))), [M])).toEqual(bin('+', XI, i(0)));
    const kept = [
      [bin('+', XI, bin('+', constref(S), i(1))), S],
      [bin('+', XI, bin('*', constref(T), i(1000000000))), T],
      [bin('+', XI, { op: 'unop', type: i32T, a: constref(M) }), M],
      [bin('+', X, call('u32', u32T, constref(konst('N', i32T, -1)))), konst('N', i32T, -1)],
    ] as const;
    for (const [e, c] of kept) expect(settle(e, [c])).toEqual(e);
    expect(settle(bin('+', XI, bin('%', MIN, i(-1))))).toEqual(bin('+', XI, bin('%', MIN, i(-1))));
  });

  it("a float constant's conversion to an integer is evaluated: u32(-0.25) is a zero divisor", () => {
    // Truncated toward zero, as WGSL converts it: Tint refused `(1 % i32(-0.25))` and
    // `(u32(0.125) / u32(-0.25))` with "integer division by zero is invalid" (#349's seeds 82, 104).
    const f = (v: number): Expr => lit(f32T, v);
    expect(settle(bin('%', i(1), call('i32', i32T, f(-0.25))))).toEqual(i(0));
    expect(settle(bin('/', X, call('u32', u32T, f(0.125))))).toEqual(X);
    const K = konst('K', f32T, 0.5);
    expect(settle(bin('/', X, call('u32', u32T, constref(K))), [K])).toEqual(X);
    // Neighbours: a conversion that is not zero stays, and a named constant whose f32 value
    // truncates otherwise than its written value (2.99999999 is 3 as an f32) is not taken.
    const kept = [
      [bin('/', X, call('u32', u32T, f(1.5))), []],
      [
        bin('/', X, call('u32', u32T, constref(konst('N', f32T, 2.99999999)))),
        [konst('N', f32T, 2.99999999)],
      ],
    ] as const;
    for (const [e, consts] of kept) expect(settle(e, [...consts])).toEqual(e);
  });

  it('a clamp whose constant bounds cross is min(max(e, low), high)', () => {
    const minMax = (x: Expr, lo: Expr, hi: Expr): Expr =>
      call('min', x.type, call('max', x.type, x, lo), hi);
    expect(settle(call('clamp', u32T, X, u(5), u(2)))).toEqual(minMax(X, u(5), u(2)));
    const one = lit(f32T, 1);
    const half = lit(f32T, 0.5);
    expect(settle(call('clamp', f32T, XF, one, half))).toEqual(minMax(XF, one, half));
    expect(wgslOf(call('clamp', u32T, X, u(5), u(2)), u32T)).toBe('return min(max(x, 5u), 2u);');
    for (const e of [call('clamp', u32T, X, u(2), u(5)), call('clamp', u32T, X, X, u(2))])
      expect(settle(e)).toEqual(e);
  });

  it('a compound assignment: /= 0 is /= 1, %= 0 is %= 1, <<= 35 is <<= 3', () => {
    const w: Expr = { op: 'varref', type: u32T, name: 'w' };
    const body: Stmt[] = [
      { s: 'var', name: 'w', type: u32T, init: X },
      { s: 'assignOp', target: w, bop: '/', expr: u(0) },
      { s: 'assignOp', target: w, bop: '%', expr: u(0) },
      { s: 'assignOp', target: w, bop: '<<', expr: u(35) },
      { s: 'return', expr: w },
    ];
    const out = settled(moduleOf(u32T, u32T, body));
    expect(out.funcs[0]!.body.slice(1, 4).map((s) => (s as { expr: Expr }).expr)).toEqual([
      u(1),
      u(1),
      u(3),
    ]);
  });

  it('a module constant that reads a refused expression is settled too', () => {
    const V2: ConstDecl = {
      name: 'V2',
      type: vec2uT,
      wgslValue: 0,
      cpuValue: 0,
      valueExpr: vec2u(1, 2),
    };
    const W: ConstDecl = {
      name: 'W',
      type: u32T,
      wgslValue: 0,
      cpuValue: 0,
      valueExpr: bin('<<', { op: 'member', type: u32T, base: constref(V2), field: 'y' }, u(31)),
    };
    const m = settleConstExprs(moduleOf(u32T, u32T, [{ s: 'return', expr: X }], [V2, W]));
    expect(m.consts[1]!.valueExpr).toEqual(u(0));
  });
});
