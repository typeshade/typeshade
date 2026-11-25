import { describe, it, expect } from 'vitest';
import {
  module,
  f64T,
  f32T,
  vec2fT,
  vec3f64T,
  mat2f64T,
  type Expr,
  type FuncDecl,
  type ModuleDecl,
  type ShaderType,
  type Stmt,
} from '../ir/index.js';
import { FP64_GUARD_NAME } from '../fp64/df64-lib.js';
import { fp64Lower } from './fp64-lower.js';

const param = (name: string, type: ShaderType): Expr => ({ op: 'param', type, name });
const varref = (name: string, type: ShaderType): Expr => ({ op: 'varref', type, name });
const lit = (type: ShaderType, value: number): Expr => ({ op: 'lit', type, value });
const call = (fn: string, type: ShaderType, ...args: Expr[]): Expr => ({
  op: 'call',
  type,
  fn,
  args,
});

const kOf = (
  params: readonly [string, ShaderType][],
  ret: ShaderType,
  body: readonly Stmt[],
): ModuleDecl =>
  module({
    funcs: [{ name: 'k', params: params.map(([name, type]) => ({ name, type })), ret, body }],
  });

const lowered = (m: ModuleDecl): FuncDecl => fp64Lower(m).funcs.find((f) => f.name === 'k')!;
const names = (m: ModuleDecl): string[] => fp64Lower(m).funcs.map((f) => f.name);

const returned = (m: ModuleDecl): Expr => {
  const last = lowered(m).body.at(-1)!;
  if (last.s !== 'return' || last.expr === undefined) throw new Error('k does not return');
  return last.expr;
};

describe('assignment to an f64 lvalue', () => {
  const declared = (rest: readonly Stmt[]): ModuleDecl =>
    kOf([['p', f64T]], f64T, [
      { s: 'var', name: 'v', type: f64T },
      ...rest,
      { s: 'return', expr: varref('v', f64T) },
    ]);

  it('widens an f32 value assigned to an f64 target', () => {
    const m = declared([{ s: 'assign', target: varref('v', f64T), expr: lit(f32T, 3) }]);
    expect(lowered(m).body[1]).toMatchObject({
      s: 'assign',
      expr: { op: 'construct', type: vec2fT, args: [lit(f32T, 3), lit(f32T, 0)] },
    });
  });

  it('widens an f32 right-hand side of a compound assignment', () => {
    const m = declared([
      { s: 'assignOp', target: varref('v', f64T), bop: '+', expr: lit(f32T, 3) },
    ]);
    const stmt = lowered(m).body[1]!;
    if (stmt.s !== 'assign' || stmt.expr.op !== 'call') throw new Error('not a call assignment');
    expect(stmt.expr.fn).toBe('df64_add');
    expect(stmt.expr.args[1]).toMatchObject({
      op: 'construct',
      args: [lit(f32T, 3), lit(f32T, 0)],
    });
  });

  it('carries the helper of a compound assignment into the module with its guard', () => {
    for (const bop of ['+', '-'] as const) {
      const m = declared([
        { s: 'assignOp', target: varref('v', f64T), bop, expr: param('p', f64T) },
      ]);
      const out = fp64Lower(m);
      expect(out.funcs.map((f) => f.name)).toContain(bop === '+' ? 'df64_add' : 'df64_sub');
      expect(out.bindings.map((b) => b.name)).toContain(FP64_GUARD_NAME);
    }
  });

  it('carries the helper of a vec64 compound assignment into the module', () => {
    const m = kOf([['p', vec3f64T]], vec3f64T, [
      { s: 'var', name: 'v', type: vec3f64T },
      { s: 'assignOp', target: varref('v', vec3f64T), bop: '+', expr: param('p', vec3f64T) },
      { s: 'return', expr: varref('v', vec3f64T) },
    ]);
    expect(names(m)).toContain('df64_v3_add');
    expect(lowered(m).body[1]).toMatchObject({
      s: 'assign',
      expr: { op: 'call', fn: 'df64_v3_add' },
    });
  });
});

describe('the conversion builtins', () => {
  it('f64FromParts builds the pair and f64Parts is the pair itself', () => {
    const pair = call('f64FromParts', f64T, lit(f32T, 1), lit(f32T, 2));
    expect(returned(kOf([], f64T, [{ s: 'return', expr: pair }]))).toMatchObject({
      op: 'construct',
      type: vec2fT,
      args: [lit(f32T, 1), lit(f32T, 2)],
    });
    const parts = call('f64Parts', vec2fT, param('a', f64T));
    expect(returned(kOf([['a', f64T]], vec2fT, [{ s: 'return', expr: parts }]))).toEqual({
      op: 'param',
      type: vec2fT,
      name: 'a',
    });
  });

  it('f64() widens an f32 and leaves an f64 alone; f32() of an f64 narrows', () => {
    const widened = returned(
      kOf([['x', f32T]], f64T, [{ s: 'return', expr: call('f64', f64T, param('x', f32T)) }]),
    );
    expect(widened).toMatchObject({ op: 'construct', args: [{ op: 'param' }, lit(f32T, 0)] });
    const same = returned(
      kOf([['a', f64T]], f64T, [{ s: 'return', expr: call('f64', f64T, param('a', f64T)) }]),
    );
    expect(same).toEqual({ op: 'param', type: vec2fT, name: 'a' });
    const narrowed = returned(
      kOf([['a', f64T]], f32T, [{ s: 'return', expr: call('f32', f32T, param('a', f64T)) }]),
    );
    expect(narrowed).toMatchObject({ op: 'call', fn: 'df64_narrow' });
  });
});

describe('matrices', () => {
  const M = mat2f64T;
  const modOf = (expr: Expr): ModuleDecl =>
    kOf(
      [
        ['a', M],
        ['v', { kind: 'vec64', n: 2 }],
      ],
      expr.type,
      [{ s: 'return', expr }],
    );

  it('lowers matrix products and transpose to the per-dimension helpers', () => {
    const v: ShaderType = { kind: 'vec64', n: 2 };
    const mm = modOf({ op: 'binop', type: M, bop: '*', a: param('a', M), b: param('a', M) });
    const mv = modOf({ op: 'binop', type: v, bop: '*', a: param('a', M), b: param('v', v) });
    const tr = modOf(call('transpose', M, param('a', M)));
    expect(returned(mm)).toMatchObject({ op: 'call', fn: 'df64_m2_matmul' });
    expect(returned(mv)).toMatchObject({ op: 'call', fn: 'df64_m2_matvec' });
    expect(returned(tr)).toMatchObject({ op: 'call', fn: 'df64_m2_transpose' });
  });

  it('declares each DF64Vec struct before the DF64Mat struct that nests it', () => {
    const out = fp64Lower(modOf(param('a', M)));
    const order = out.structs.map((s) => s.name);
    expect(order).toEqual(['DF64Vec2', 'DF64Mat2']);
  });

  it('forces the vector struct of a matrix width and records widths through arrays', () => {
    const arr: ShaderType = { kind: 'array', elem: M, size: 2 };
    const out = fp64Lower(kOf([['a', arr]], f32T, [{ s: 'return', expr: lit(f32T, 0) }]));
    expect(out.structs.map((s) => s.name)).toEqual(['DF64Vec2', 'DF64Mat2']);
  });
});

describe('module variables and constants', () => {
  it('lowers the type and the initializer of an f64 module variable', () => {
    const m: ModuleDecl = {
      ...kOf([['a', f64T]], f64T, [{ s: 'return', expr: param('a', f64T) }]),
      vars: [{ name: 'g', space: 'private', type: f64T, init: lit(f64T, 1.5) }],
    };
    const g = fp64Lower(m).vars!.find((v) => v.name === 'g')!;
    expect(g.type).toEqual(vec2fT);
    expect(g.init).toMatchObject({
      op: 'construct',
      type: vec2fT,
      args: [lit(f32T, 1.5), lit(f32T, 0)],
    });
  });
});

describe('reserved names and stage boundaries', () => {
  const withF64 = (extra: Partial<Parameters<typeof module>[0]>): ModuleDecl =>
    module({
      funcs: [
        {
          name: 'k',
          params: [{ name: 'a', type: f64T }],
          ret: f64T,
          body: [{ s: 'return', expr: param('a', f64T) }],
        },
      ],
      ...extra,
    });

  it('reserves the DF64Vec and DF64Mat struct name prefixes', () => {
    for (const name of ['DF64Vec9', 'DF64Mat9'])
      expect(() => fp64Lower(withF64({ structs: [{ name, fields: [] }] }))).toThrow(/SD0043/);
  });

  it('refuses an f64 fragment input and an f64 stage return', () => {
    const fragment = module({
      funcs: [
        {
          name: 'fs',
          params: [{ name: 'a', type: f64T, location: 0 }],
          ret: f32T,
          body: [{ s: 'return', expr: lit(f32T, 0) }],
          stage: 'fragment',
        },
      ],
    });
    expect(() => fp64Lower(fragment)).toThrow(/SD0044.*fragment input 'a'/);
    const entry = module({
      funcs: [
        {
          name: 'vs',
          params: [{ name: 'a', type: f64T }],
          ret: f64T,
          body: [{ s: 'return', expr: param('a', f64T) }],
          stage: 'vertex',
        },
      ],
    });
    expect(() => fp64Lower(entry)).toThrow(/SD0044.*vertex entry 'vs' return/);
  });
});
