import { describe, expect, it } from 'vitest';
import type { BinOp, ConstDecl, Expr, ModuleDecl, ShaderType, Stmt } from '../ir/index.js';
import { arrayT, boolT, f32T, i32T, u32T, vec2fT, vec2iT, vec2uT, vec3uT } from '../ir/index.js';
import { settleConstExprs } from './const-expr.js';

const lit = (type: ShaderType, value: number): Expr => ({ op: 'lit', type, value });
const u = (v: number): Expr => lit(u32T, v);
const i = (v: number): Expr => lit(i32T, v);
const f = (v: number): Expr => lit(f32T, v);
const bin = (bop: BinOp, a: Expr, b: Expr): Expr => ({ op: 'binop', type: a.type, bop, a, b });
const call = (fn: string, type: ShaderType, ...args: Expr[]): Expr => ({
  op: 'call',
  type,
  fn,
  args,
});
const param = (name: string, type: ShaderType): Expr => ({ op: 'param', type, name });
const constref = (c: ConstDecl): Expr => ({ op: 'constref', type: c.type, name: c.name });
const konst = (name: string, type: ShaderType, value: number): ConstDecl => ({
  name,
  type,
  wgslValue: value,
  cpuValue: value,
});
const vec2u = (a: number, b: number): Expr => ({
  op: 'construct',
  type: vec2uT,
  args: [u(a), u(b)],
});
const toU = (e: Expr): Expr => call('u32', u32T, e);
const toI = (e: Expr): Expr => call('i32', i32T, e);
const complement = (e: Expr): Expr => call('~', e.type, e);

const X = param('x', u32T);
const XI = param('x', i32T);
const XF = param('x', f32T);

function settleBody(
  ret: ShaderType,
  body: Stmt[],
  consts: ConstDecl[] = [],
  x: ShaderType = u32T,
): readonly Stmt[] {
  const m: ModuleDecl = {
    consts,
    structs: [],
    bindings: [],
    funcs: [{ name: 'k', params: [{ name: 'x', type: x }], ret, body }],
  };
  return settleConstExprs(m).funcs[0]!.body;
}

function settle(e: Expr, consts: ConstDecl[] = []): Expr {
  const x = e.type.kind === 'scalar' && e.type.scalar === 'f32' ? f32T : u32T;
  const body = settleBody(e.type, [{ s: 'return', expr: e }], consts, x);
  return (body[0] as { expr: Expr }).expr;
}

const settleSigned = (e: Expr, consts: ConstDecl[] = []): Expr =>
  (settleBody(e.type, [{ s: 'return', expr: e }], consts, i32T)[0] as { expr: Expr }).expr;

describe('a float operand that is no const-expression the pass evaluates is left as it is', () => {
  it('a float operation over constants keeps its rounding to the target', () => {
    const e = bin('/', X, toU(bin('-', f(0), f(1))));
    expect(settle(e)).toEqual(e);
  });

  it('a float division by a zero literal on a value the shader computes stays', () => {
    const e = bin('/', XF, f(0));
    expect(settle(e)).toEqual(e);
  });

  it('a float literal that is not finite converts to nothing: u32(-Infinity) stays', () => {
    const e = bin('/', X, toU(f(-Infinity)));
    expect(settle(e)).toEqual(e);
  });

  it('a named f32 constant that truncates to a non-zero value stays as a divisor', () => {
    const K = konst('K', f32T, 1.5);
    const e = bin('/', X, toU(constref(K)));
    expect(settle(e, [K])).toEqual(e);
  });

  it('an element of a constant array is not evaluated', () => {
    const arrayType = arrayT(f32T, 2);
    const A: ConstDecl = {
      ...konst('A', arrayType, 0),
      valueExpr: { op: 'construct', type: arrayType, args: [f(-1), f(2)] },
    };
    const element: Expr = { op: 'index', type: f32T, base: constref(A), idx: u(0) };
    const e = bin('/', X, toU(element));
    expect(settle(e, [A])).toEqual(e);
  });

  it('a let is no const-expression, whatever it holds', () => {
    const w: Expr = { op: 'varref', type: u32T, name: 'w' };
    const body: Stmt[] = [
      { s: 'let', name: 'w', expr: u(0) },
      { s: 'return', expr: bin('/', X, w) },
    ];
    expect(settleBody(u32T, body)[1]).toEqual({ s: 'return', expr: bin('/', X, w) });
  });

  it('an integer builtin the pass does not evaluate is no const-expression', () => {
    const e = bin('/', X, call('countOneBits', u32T, u(0)));
    expect(settle(e)).toEqual(e);
  });

  it('a constructor over another element type is not evaluated', () => {
    const convert: Expr = { op: 'construct', type: vec2uT, args: [f(0), f(1)] };
    const e = bin('/', param('x', vec2uT), convert);
    const out = settleBody(vec2uT, [{ s: 'return', expr: e }], [], vec2uT)[0] as { expr: Expr };
    expect(out.expr).toEqual(e);
  });
});

describe('an integer builtin over constants is a constant the pass evaluates', () => {
  it('min, max and clamp over constants give a zero divisor', () => {
    expect(settle(bin('/', X, call('min', u32T, u(0), u(5))))).toEqual(X);
    expect(settle(bin('/', X, call('max', u32T, u(0), u(0))))).toEqual(X);
    expect(settle(bin('%', X, call('clamp', u32T, u(7), u(0), u(0))))).toEqual(u(0));
  });

  it('abs and sign over constants give a zero divisor', () => {
    expect(settleSigned(bin('/', XI, call('abs', i32T, i(0))))).toEqual(XI);
    expect(settleSigned(bin('/', XI, call('sign', i32T, i(0))))).toEqual(XI);
  });

  it('a builtin with the wrong count of arguments is no constant', () => {
    const e = bin('/', X, call('min', u32T, u(0)));
    expect(settle(e)).toEqual(e);
  });

  it('the complement of an abstract integer is its bits as a u32', () => {
    expect(settle(toU(complement(i(5))))).toEqual(u(4294967290));
    expect(settle(bin('/', X, toU(complement(i(-1)))))).toEqual(X);
  });

  it('a conversion between integer types keeps the bits', () => {
    expect(settleSigned(bin('/', XI, toI(u(0))))).toEqual(XI);
    expect(settleSigned(bin('/', XI, toI(u(4294967295))))).toEqual(
      bin('/', XI, toI(u(4294967295))),
    );
  });

  it('a remainder of the most negative i32 by -1 is refused over a converted operand', () => {
    expect(settleSigned(bin('%', toI(u(2147483648)), i(-1)))).toEqual(i(0));
  });

  it('a select on a literal is a constant only when every argument is one', () => {
    const select = (cond: Expr, t: Expr, e: Expr): Expr => ({
      op: 'select',
      type: u32T,
      cond,
      ifTrue: t,
      ifFalse: e,
    });
    expect(
      settle(bin('/', X, select({ op: 'lit', type: boolT, value: true }, u(0), u(5)))),
    ).toEqual(X);
    const dropped = bin('/', X, select({ op: 'lit', type: boolT, value: true }, u(0), X));
    expect(settle(dropped)).toEqual(dropped);
    const open = bin('/', X, select(param('c', boolT), u(0), u(0)));
    expect(settle(open)).toEqual(open);
  });
});

describe('a float conversion saturates where Tint saturates it', () => {
  const BIG = konst('BIG', f32T, 4294967296);

  it('a literal past the u32 range as a shift amount keeps the low bits of 4294967295', () => {
    expect(settle(bin('<<', X, toU(f(4294967296))))).toEqual(bin('<<', X, u(31)));
  });

  it('a named f32 past the i32 range converts to the largest f32 inside it', () => {
    const amount = toU(toI(constref(BIG)));
    expect(settle(bin('<<', X, amount), [BIG])).toEqual(bin('<<', X, u(0)));
  });

  it('an i32 conversion of a literal past the range saturates at the end of the range', () => {
    const amount = toU(toI(f(4294967296)));
    expect(settle(bin('>>', X, amount))).toEqual(bin('>>', X, u(31)));
  });
});

describe('an abstract integer operation is refused past the i32 it meets', () => {
  const MIN = i(-2147483648);

  it('an abstract difference and product past the type wrap', () => {
    expect(settleSigned(bin('+', XI, bin('-', MIN, i(1))))).toEqual(bin('+', XI, i(2147483647)));
    expect(settleSigned(bin('+', XI, bin('*', i(65536), i(65536))))).toEqual(bin('+', XI, i(0)));
  });

  it('an abstract operation that fits is kept', () => {
    const e = bin('+', XI, bin('-', i(5), i(1)));
    expect(settleSigned(e)).toEqual(e);
  });

  it('a u32 sum past the type is no abstract integer and is kept', () => {
    const e = bin('+', X, bin('+', u(4294967295), u(1)));
    expect(settle(e)).toEqual(e);
  });

  it('a shift of a vector constant past the type wraps in each component', () => {
    const lanes: Expr = { op: 'construct', type: vec2iT, args: [i(3), i(-1)] };
    const e: Expr = { op: 'binop', type: vec2iT, bop: '<<', a: lanes, b: u(31) };
    const out = settleBody(vec2iT, [{ s: 'return', expr: e }], [], vec2uT)[0] as { expr: Expr };
    expect(out.expr).toEqual({
      op: 'construct',
      type: vec2iT,
      args: [i(-2147483648), i(-2147483648)],
    });
  });

  it('operands whose component counts do not meet are kept', () => {
    const lanes: Expr = { op: 'construct', type: vec2iT, args: [i(3), i(-1)] };
    const amounts: Expr = { op: 'construct', type: vec3uT, args: [u(31), u(31), u(31)] };
    const e: Expr = { op: 'binop', type: vec2iT, bop: '<<', a: lanes, b: amounts };
    expect(settleBody(vec2iT, [{ s: 'return', expr: e }], [], vec2uT)[0]).toEqual({
      s: 'return',
      expr: e,
    });
  });
});

describe('the settled divisor drops its division only where the types agree', () => {
  it('a scalar dividend over a vector divisor of ones keeps the division', () => {
    const e: Expr = { op: 'binop', type: vec2uT, bop: '/', a: u(7), b: vec2u(0, 0) };
    const out = settleBody(vec2uT, [{ s: 'return', expr: e }], [], vec2uT)[0] as { expr: Expr };
    expect(out.expr).toEqual({ ...e, b: vec2u(1, 1) });
  });
});

describe('a module with nothing to settle is returned with equal contents', () => {
  it('constants, functions and statements come back as they went in', () => {
    const K = konst('K', u32T, 4);
    const body: Stmt[] = [
      { s: 'let', name: 'w', expr: bin('/', X, u(3)) },
      { s: 'return', expr: bin('+', X, constref(K)) },
    ];
    const m: ModuleDecl = {
      consts: [K],
      structs: [],
      bindings: [],
      funcs: [{ name: 'k', params: [{ name: 'x', type: u32T }], ret: u32T, body }],
    };
    expect(settleConstExprs(m)).toEqual(m);
  });
});

describe('the operands of an integer operation are read as the target computes them', () => {
  const MIN = i(-2147483648);
  const vecOf = (type: ShaderType, ...args: Expr[]): Expr => ({ op: 'construct', type, args });
  const settleVec = (e: Expr): Expr =>
    (settleBody(vec2uT, [{ s: 'return', expr: e }], [], vec2uT)[0] as { expr: Expr }).expr;

  it('an abstract sum of abstract shifts past the type wraps', () => {
    const shifted = bin('<<', i(1), u(30));
    expect(settleSigned(bin('+', XI, bin('+', shifted, shifted)))).toEqual(
      bin('+', XI, i(-2147483648)),
    );
  });

  it('a clamp whose bounds cross in one component only becomes min of max', () => {
    const low = vec2u(5, 1);
    const high = vec2u(3, 9);
    const x = param('x', vec2uT);
    const e = call('clamp', vec2uT, x, low, high);
    expect(settleVec(e)).toEqual(call('min', vec2uT, call('max', vec2uT, x, low), high));
  });

  it('a clamp whose bounds cross in no component is kept', () => {
    const e = call('clamp', vec2uT, param('x', vec2uT), vec2u(1, 1), vec2u(3, 9));
    expect(settleVec(e)).toEqual(e);
  });

  it('an element of a vector constant is a constant divisor', () => {
    const element: Expr = { op: 'index', type: u32T, base: vec2u(0, 2), idx: u(0) };
    expect(settle(bin('/', X, element))).toEqual(X);
  });

  it('an integer difference is a constant divisor of a division and a remainder', () => {
    expect(settle(bin('/', X, bin('-', u(3), u(3))))).toEqual(X);
    expect(settle(bin('%', X, bin('-', u(3), u(3))))).toEqual(u(0));
  });

  it('sign of a negative constant is -1, which refuses the most negative i32 as dividend', () => {
    expect(settleSigned(bin('/', MIN, call('sign', i32T, i(-5))))).toEqual(MIN);
  });

  it('abs of the most negative i32 wraps to itself, and its sign is -1', () => {
    const divisor = call('sign', i32T, call('abs', i32T, MIN));
    expect(settleSigned(bin('/', MIN, divisor))).toEqual(MIN);
  });

  it('a negated float literal converts as written', () => {
    const negated: Expr = { op: 'unop', type: f32T, a: f(0.9999999999) };
    const divisor = call('sign', i32T, toI(negated));
    expect(settleSigned(bin('/', XI, divisor))).toEqual(XI);
  });

  it('a lane of an f32 vector constant at 2^32 converts to the largest f32 inside the range', () => {
    const lanes = vecOf(vec2fT, f(4294967296), f(0));
    const amounts = vecOf(vec2uT, lanes);
    const x = param('x', vec2uT);
    const e: Expr = { op: 'binop', type: vec2uT, bop: '<<', a: x, b: amounts };
    expect(settleVec(e)).toEqual({ ...e, b: vec2u(0, 0) });
  });

  it('a remainder by a scalar zero settles to a zero in every component', () => {
    expect(settleVec(bin('%', param('x', vec2uT), u(0)))).toEqual(vec2u(0, 0));
  });

  it('a vector constructor of one scalar broadcasts it as a divisor', () => {
    const x = param('x', vec2uT);
    expect(settleVec(bin('/', x, vecOf(vec2uT, u(0))))).toEqual(x);
  });
});
