import { describe, expect, it } from 'vitest';
import { compileModule } from './oracle.js';
import { f32T, matT, structT } from './ir/index.js';
import type { Expr, ModuleDecl, ShaderType, Stmt } from './ir/index.js';

const vec2T: ShaderType = { kind: 'vec', n: 2, elem: 'f32' };
const mat2T = matT(2, 2);
const lit = (value: number): Expr => ({ op: 'lit', type: f32T, value });
const ref = (name: string, type: ShaderType): Expr => ({ op: 'varref', type, name });
const pair = (a: number, b: number): Expr => ({
  op: 'construct',
  type: vec2T,
  args: [lit(a), lit(b)],
});

const columnInoutModule = (column: number): ModuleDecl => ({
  consts: [],
  structs: [],
  bindings: [],
  funcs: [
    {
      name: 'overwrite',
      params: [{ name: 'p', type: vec2T, mode: 'inout' }],
      ret: { kind: 'void' },
      body: [{ s: 'assign', target: { op: 'param', type: vec2T, name: 'p' }, expr: pair(9, 8) }],
    },
    {
      name: 'run',
      params: [],
      ret: mat2T,
      body: [
        {
          s: 'var',
          name: 'm',
          type: mat2T,
          init: {
            op: 'construct',
            type: mat2T,
            args: [pair(1, 2), pair(3, 4)],
          },
        },
        {
          s: 'call',
          expr: {
            op: 'call',
            type: { kind: 'void' },
            fn: 'overwrite',
            args: [
              {
                op: 'index',
                type: vec2T,
                base: ref('m', mat2T),
                idx: { op: 'lit', type: { kind: 'scalar', scalar: 'i32' }, value: column },
              },
            ],
          },
        },
        { s: 'return', expr: ref('m', mat2T) },
      ] as Stmt[],
    },
  ],
});

describe('oracle: a matrix column passed as an inout argument is written back into the matrix', () => {
  it('the second column holds what the callee left and the first column is unchanged', () => {
    const cpu = compileModule(columnInoutModule(1));
    expect(cpu.fns['run']!()).toEqual([1, 2, 9, 8]);
  });

  it('the first column holds what the callee left and the second column is unchanged', () => {
    const cpu = compileModule(columnInoutModule(0));
    expect(cpu.fns['run']!()).toEqual([9, 8, 3, 4]);
  });
});

const orderModule = (): ModuleDecl => ({
  consts: [],
  structs: [
    {
      name: 'Triple',
      fields: [
        { name: 'zeta', type: f32T },
        { name: 'alpha', type: f32T },
        { name: 'mid', type: f32T },
      ],
    },
  ],
  bindings: [],
  funcs: [
    {
      name: 'build',
      params: [],
      ret: structT('Triple'),
      body: [
        {
          s: 'return',
          expr: {
            op: 'construct',
            type: structT('Triple'),
            args: [lit(1), lit(2), lit(3)],
          },
        },
      ],
    },
  ],
});

describe('oracle: a struct constructor builds its object in declaration order', () => {
  it('the keys of the built object follow the declared fields, not the alphabet', () => {
    const value = compileModule(orderModule()).fns['build']!() as Record<string, number>;
    expect(Object.keys(value)).toEqual(['zeta', 'alpha', 'mid']);
    expect(Object.values(value)).toEqual([1, 2, 3]);
  });
});
