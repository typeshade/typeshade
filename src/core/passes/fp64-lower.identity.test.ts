import { describe, it, expect } from 'vitest';
import {
  module,
  f64T,
  f32T,
  u32T,
  boolT,
  type Expr,
  type ModuleDecl,
  type ShaderType,
  type Stmt,
} from '../ir/index.js';
import { fp64Lower } from './fp64-lower.js';

const lit = (type: ShaderType, value: number): Expr => ({ op: 'lit', type, value });
const f32Of = (e: Expr): Expr => ({ op: 'call', type: f32T, fn: 'f32', args: [e] });
const hidden = (): Expr => f32Of(lit(f64T, 1));
const zero = (): Expr => lit(f32T, 0);
const lessThanHidden = (): Expr => ({
  op: 'compare',
  type: boolT,
  cop: '<',
  a: lit(f32T, 0),
  b: hidden(),
});
const yes = (): Expr => lit(boolT, 1);
const ret = (expr: Expr): Stmt => ({ s: 'return', expr });

const withBody = (...body: Stmt[]): ModuleDecl =>
  module({ funcs: [{ name: 'k', params: [], ret: f32T, body: [...body, ret(zero())] }] });

const lowersWhen = (...body: Stmt[]): void => {
  const m = withBody(...body);
  expect(fp64Lower(m)).not.toBe(m);
};

describe('an f64 hidden under an f32 expression is found in every position', () => {
  const inExpr = (e: Expr): Stmt => ({ s: 'let', name: 'x', expr: e });

  it('finds it in an operand of a binary, a comparison and a logical operation', () => {
    lowersWhen(inExpr({ op: 'binop', type: f32T, bop: '+', a: zero(), b: hidden() }));
    lowersWhen(inExpr({ op: 'binop', type: f32T, bop: '+', a: hidden(), b: zero() }));
    lowersWhen(inExpr({ op: 'compare', type: boolT, cop: '<', a: zero(), b: hidden() }));
    lowersWhen(inExpr({ op: 'logical', type: boolT, lop: '&&', a: yes(), b: lessThanHidden() }));
  });

  it('finds it under a negation, a member and a constructor', () => {
    lowersWhen(inExpr({ op: 'unop', type: f32T, a: hidden() }));
    lowersWhen(inExpr({ op: 'member', type: f32T, base: hidden(), field: 'x' }));
    lowersWhen(inExpr({ op: 'construct', type: f32T, args: [hidden()] }));
  });

  it('finds it in each part of a select', () => {
    const sel = (cond: Expr, ifTrue: Expr, ifFalse: Expr): Stmt =>
      inExpr({ op: 'select', type: f32T, cond, ifTrue, ifFalse });
    lowersWhen(sel(yes(), hidden(), zero()));
    lowersWhen(sel(yes(), zero(), hidden()));
    lowersWhen(
      sel({ op: 'compare', type: boolT, cop: '<', a: zero(), b: hidden() }, zero(), zero()),
    );
  });

  it('finds it in an index and in each part of a match', () => {
    const array: ShaderType = { kind: 'array', elem: f32T, size: 4 };
    const base: Expr = { op: 'call', type: array, fn: 'table', args: [] };
    const toIndex: Expr = { op: 'call', type: u32T, fn: 'hostIndex', args: [hidden()] };
    lowersWhen(inExpr({ op: 'index', type: f32T, base, idx: toIndex }));
    lowersWhen(
      inExpr({ op: 'index', type: f32T, base: { ...base, args: [hidden()] }, idx: lit(u32T, 0) }),
    );
    const match = (scrutinee: Expr, v: Expr, d: Expr): Stmt =>
      inExpr({ op: 'matchExpr', type: f32T, scrutinee, cases: [[0, v]], default: d });
    lowersWhen(match(toIndex, zero(), zero()));
    lowersWhen(match(lit(u32T, 0), hidden(), zero()));
    lowersWhen(match(lit(u32T, 0), zero(), hidden()));
  });
});

describe('an f64 hidden in a statement is found in every position', () => {
  it('finds it in a local, a variable, an assignment and a call statement', () => {
    lowersWhen({ s: 'let', name: 'x', expr: hidden() });
    lowersWhen({ s: 'var', name: 'x', type: f32T, init: hidden() });
    lowersWhen({ s: 'var', name: 'x', type: f64T });
    const target: Expr = { op: 'varref', type: f32T, name: 'x' };
    lowersWhen({ s: 'var', name: 'x', type: f32T }, { s: 'assign', target, expr: hidden() });
    lowersWhen(
      { s: 'var', name: 'x', type: f32T },
      { s: 'assignOp', target, bop: '+', expr: hidden() },
    );
    lowersWhen({ s: 'call', expr: hidden() });
  });

  it('finds it in a conditional, a loop and a switch', () => {
    const body = (e: Expr): Stmt[] => [{ s: 'let', name: 'x', expr: e }];
    lowersWhen({ s: 'if', arms: [{ cond: yes(), body: body(hidden()) }] });
    lowersWhen({
      s: 'if',
      arms: [{ cond: { op: 'compare', type: boolT, cop: '<', a: zero(), b: hidden() }, body: [] }],
    });
    lowersWhen({ s: 'if', arms: [{ cond: yes(), body: [] }], elseBody: body(hidden()) });
    const init: Stmt = { s: 'var', name: 'i', type: f32T, init: zero() };
    const update: Stmt = { s: 'let', name: 'u', expr: zero() };
    lowersWhen({ s: 'for', init: { ...init, init: hidden() }, cond: yes(), update, body: [] });
    lowersWhen({
      s: 'for',
      init,
      cond: { op: 'compare', type: boolT, cop: '<', a: zero(), b: hidden() },
      update,
      body: [],
    });
    lowersWhen({ s: 'for', init, cond: yes(), update: { ...update, expr: hidden() }, body: [] });
    lowersWhen({ s: 'for', init, cond: yes(), update, body: body(hidden()) });
    lowersWhen({ s: 'switch', scrut: toU32(hidden()), cases: [], defaultBody: [] });
    lowersWhen({
      s: 'switch',
      scrut: lit(u32T, 0),
      cases: [{ values: [0], body: body(hidden()) }],
    });
    lowersWhen({ s: 'switch', scrut: lit(u32T, 0), cases: [], defaultBody: body(hidden()) });
  });
});

const toU32 = (e: Expr): Expr => ({ op: 'call', type: u32T, fn: 'hostIndex', args: [e] });

describe('an f64 declaration alone makes the module an f64 module', () => {
  const f32Func = {
    name: 'k',
    params: [],
    ret: f32T,
    body: [ret(zero())] as Stmt[],
  };
  const f64Module = (extra: Partial<ModuleDecl>): ModuleDecl => ({
    ...module({ funcs: [f32Func] }),
    ...extra,
  });

  it('finds an f64 const, struct field, binding, parameter and return type', () => {
    const alone: Partial<ModuleDecl>[] = [
      { consts: [{ name: 'C', type: f64T, wgslValue: 0, cpuValue: 1 }] },
      { structs: [{ name: 'S', fields: [{ name: 'f', type: f64T }] }] },
      { bindings: [{ group: 0, binding: 0, name: 'g', space: 'uniform', type: f64T }] },
      { funcs: [{ ...f32Func, params: [{ name: 'p', type: f64T }] }] },
      { funcs: [{ ...f32Func, ret: f64T }] },
    ];
    for (const extra of alone) {
      const m = f64Module(extra);
      expect(fp64Lower(m)).not.toBe(m);
    }
  });
});
