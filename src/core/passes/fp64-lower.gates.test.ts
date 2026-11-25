import { describe, it, expect } from 'vitest';
import {
  module,
  f64T,
  f32T,
  i32T,
  u32T,
  vec3fT,
  vec3f64T,
  mat2f64T,
  type Expr,
  type ModuleDecl,
  type ShaderType,
  type Stmt,
} from '../ir/index.js';
import { fp64Lower } from './fp64-lower.js';

const param = (name: string, type: ShaderType): Expr => ({ op: 'param', type, name });
const varref = (name: string, type: ShaderType): Expr => ({ op: 'varref', type, name });
const lit = (type: ShaderType, value: number): Expr => ({ op: 'lit', type, value });

const single = (
  params: readonly [string, ShaderType][],
  ret: ShaderType,
  body: readonly Stmt[],
): ModuleDecl =>
  module({
    funcs: [{ name: 'k', params: params.map(([name, type]) => ({ name, type })), ret, body }],
  });

const returning = (params: readonly [string, ShaderType][], expr: Expr): ModuleDecl =>
  single(params, expr.type, [{ s: 'return', expr }]);

const refuses = (m: ModuleDecl, text: RegExp): void => {
  expect(() => fp64Lower(m)).toThrow(text);
  expect(() => fp64Lower(m)).toThrow(/SD0041/);
};

describe('SD0041 refusals of an expression', () => {
  const M = mat2f64T;

  it('refuses a matrix operator other than the product', () => {
    refuses(
      returning(
        [
          ['a', M],
          ['b', M],
        ],
        { op: 'binop', type: M, bop: '+', a: param('a', M), b: param('b', M) },
      ),
      /binary op '\+' on mat2x2<f64>/,
    );
  });

  it('refuses a matrix product with a scalar', () => {
    refuses(
      returning(
        [
          ['a', M],
          ['s', f64T],
        ],
        { op: 'binop', type: M, bop: '*', a: param('a', M), b: param('s', f64T) },
      ),
      /matNxN<f64> '\*' with a f64 operand/,
    );
  });

  it('refuses any builtin over a matrix other than transpose', () => {
    refuses(
      returning([['a', M]], { op: 'call', type: M, fn: 'abs', args: [param('a', M)] }),
      /abs\(\) on mat64 operands/,
    );
  });

  it('refuses a matrix whose columns and rows differ', () => {
    const wide: ShaderType = { kind: 'mat', cols: 3, rows: 2, elem: 'f64' };
    refuses(returning([['a', wide]], param('a', wide)), /the df64 matrices are square/);
  });

  it('refuses a vec64 operator that has no emulation', () => {
    refuses(
      returning(
        [
          ['a', vec3f64T],
          ['b', vec3f64T],
        ],
        { op: 'binop', type: vec3f64T, bop: '%', a: param('a', vec3f64T), b: param('b', vec3f64T) },
      ),
      /binary op '%' on vec3<f64>/,
    );
  });

  it('refuses an f64 operator that has no emulation', () => {
    refuses(
      returning(
        [
          ['a', f64T],
          ['b', f64T],
        ],
        { op: 'binop', type: f64T, bop: '%', a: param('a', f64T), b: param('b', f64T) },
      ),
      /binary op '%' on f64/,
    );
  });

  it('refuses an f64 operand next to an operand that is neither f64 nor f32', () => {
    refuses(
      returning(
        [
          ['a', f64T],
          ['i', i32T],
        ],
        { op: 'binop', type: f64T, bop: '+', a: param('a', f64T), b: param('i', i32T) },
      ),
      /f64 op with a i32 operand/,
    );
  });

  it('refuses an f64 interpolant of mix', () => {
    refuses(
      returning([['a', f64T]], {
        op: 'call',
        type: f64T,
        fn: 'mix',
        args: [param('a', f64T), param('a', f64T), param('a', f64T)],
      }),
      /interpolant t must be f32/,
    );
  });

  it('refuses a vec64 mix whose interpolant is not a scalar f32', () => {
    refuses(
      returning(
        [
          ['a', vec3f64T],
          ['t', vec3fT],
        ],
        {
          op: 'call',
          type: vec3f64T,
          fn: 'mix',
          args: [param('a', vec3f64T), param('a', vec3f64T), param('t', vec3fT)],
        },
      ),
      /mix\(\) on vec64 needs a scalar f32 interpolant, got vec3<f32>/,
    );
  });

  it('refuses a scalar conversion of an f64 other than f32()', () => {
    for (const [fn, type] of [
      ['i32', i32T],
      ['u32', u32T],
    ] as const)
      refuses(
        returning([['a', f64T]], { op: 'call', type, fn, args: [param('a', f64T)] }),
        new RegExp(`${fn}\\(\\) on f64 operands`),
      );
  });

  it('refuses a scalar conversion of a vec64', () => {
    for (const [fn, type] of [
      ['i32', i32T],
      ['u32', u32T],
      ['f32', f32T],
    ] as const)
      refuses(
        returning([['a', vec3f64T]], { op: 'call', type, fn, args: [param('a', vec3f64T)] }),
        new RegExp(`${fn}\\(\\) on vec64 operands`),
      );
  });

  it('refuses a vector constructor with an f64 component', () => {
    refuses(
      returning([['a', f64T]], {
        op: 'construct',
        type: vec3fT,
        args: [param('a', f64T), lit(f32T, 1), lit(f32T, 2)],
      }),
      /vec3<f32> constructor with an f64 component/,
    );
  });

  it('refuses an f64 match scrutinee', () => {
    refuses(
      returning([['a', f64T]], {
        op: 'matchExpr',
        type: f32T,
        scrutinee: param('a', f64T),
        cases: [[0, lit(f32T, 1)]],
        default: lit(f32T, 2),
      }),
      /matchExpr scrutinee must be an integer scalar, got f64/,
    );
  });
});

describe('SD0041 refusals of a statement', () => {
  const declared = (type: ShaderType, rest: readonly Stmt[]): ModuleDecl =>
    single([['p', f64T]], f64T, [
      { s: 'var', name: 'v', type },
      ...rest,
      { s: 'return', expr: param('p', f64T) },
    ]);

  it('refuses to assign a scalar to a vec64', () => {
    refuses(
      declared(vec3f64T, [{ s: 'assign', target: varref('v', vec3f64T), expr: param('p', f64T) }]),
      /assign of f64 to a vec3<f64> target/,
    );
  });

  it('refuses to assign a value that is neither f64 nor f32 to an f64', () => {
    refuses(
      declared(f64T, [{ s: 'assign', target: varref('v', f64T), expr: lit(i32T, 1) }]),
      /assign of i32 to an f64 target/,
    );
  });

  it('refuses a compound assignment that has no emulation', () => {
    refuses(
      declared(vec3f64T, [
        { s: 'assignOp', target: varref('v', vec3f64T), bop: '%', expr: varref('v', vec3f64T) },
      ]),
      /compound assign '%=' on vec3<f64>/,
    );
    refuses(
      declared(f64T, [
        { s: 'assignOp', target: varref('v', f64T), bop: '%', expr: param('p', f64T) },
      ]),
      /compound assign '%=' on f64/,
    );
  });

  it('refuses a compound assignment of a scalar to a vec64', () => {
    refuses(
      declared(vec3f64T, [
        { s: 'assignOp', target: varref('v', vec3f64T), bop: '+', expr: param('p', f64T) },
      ]),
      /'\+=' of f64 on vec64/,
    );
  });

  it('refuses a compound assignment of an integer to an f64', () => {
    refuses(
      declared(f64T, [{ s: 'assignOp', target: varref('v', f64T), bop: '+', expr: lit(i32T, 1) }]),
      /'\+=' of i32 on f64/,
    );
  });
});
