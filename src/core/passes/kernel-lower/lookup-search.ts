import type { Expr, FuncDecl } from '../../ir/nodes.js';
import type { ShaderType } from '../../ir/types.js';
import { u32T } from '../../ir/types.js';

export const NOT_FOUND = 0xffffffff;

function orderWordOf(k: Expr, key: 'u32' | 'i32' | 'f32'): Expr {
  if (key === 'u32') return k;
  if (key === 'i32') return { op: 'call', type: u32T, fn: 'u32', args: [k] };
  const boolT: ShaderType = { kind: 'scalar', scalar: 'bool' };
  const f32: ShaderType = { kind: 'scalar', scalar: 'f32' };
  const bits: Expr = { op: 'call', type: u32T, fn: 'bitcastU32', args: [k] };
  const zero: Expr = {
    op: 'compare',
    type: boolT,
    cop: '==',
    a: k,
    b: { op: 'lit', type: f32, value: 0 },
  };
  const nan: Expr = { op: 'compare', type: boolT, cop: '!=', a: k, b: k };
  const lit = (n: number): Expr => ({ op: 'lit', type: u32T, value: n });
  return {
    op: 'select',
    type: u32T,
    cond: nan,
    ifTrue: lit(0x7fc00000),
    ifFalse: { op: 'select', type: u32T, cond: zero, ifTrue: lit(0), ifFalse: bits },
  };
}

export function findFunction(name: string, keys: string, key: 'u32' | 'i32' | 'f32'): FuncDecl {
  const keyT: ShaderType = { kind: 'scalar', scalar: key };
  const boolT: ShaderType = { kind: 'scalar', scalar: 'bool' };
  const lit = (n: number): Expr => ({ op: 'lit', type: u32T, value: n });
  const ref = (n: string): Expr => ({ op: 'varref', type: u32T, name: n });
  const word = (at: Expr): Expr => ({
    op: 'index',
    type: u32T,
    base: { op: 'varref', type: { kind: 'array', elem: u32T }, name: keys },
    idx: at,
  });
  const add = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: u32T, bop: '+', a, b });
  const cmp = (cop: '<' | '>=' | '==', a: Expr, b: Expr): Expr => ({
    op: 'compare',
    type: boolT,
    cop,
    a,
    b,
  });
  return {
    name,
    params: [{ name: 'k', type: keyT }],
    ret: u32T,
    body: [
      { s: 'let', name: '_w', expr: orderWordOf({ op: 'param', type: keyT, name: 'k' }, key) },
      { s: 'let', name: '_n', expr: word(lit(0)) },
      { s: 'var', name: '_lo', type: u32T, init: lit(0) },
      { s: 'var', name: '_hi', type: u32T, init: ref('_n') },
      {
        s: 'for',
        init: { s: 'var', name: '_s', type: u32T, init: lit(0) },
        cond: cmp('<', ref('_s'), lit(32)),
        update: { s: 'assign', target: ref('_s'), expr: add(ref('_s'), lit(1)) },
        body: [
          { s: 'if', arms: [{ cond: cmp('>=', ref('_lo'), ref('_hi')), body: [{ s: 'break' }] }] },
          {
            s: 'let',
            name: '_mid',
            expr: add(ref('_lo'), {
              op: 'binop',
              type: u32T,
              bop: '/',
              a: { op: 'binop', type: u32T, bop: '-', a: ref('_hi'), b: ref('_lo') },
              b: lit(2),
            }),
          },
          {
            s: 'if',
            arms: [
              {
                cond: cmp('<', word(add(ref('_mid'), lit(1))), ref('_w')),
                body: [{ s: 'assign', target: ref('_lo'), expr: add(ref('_mid'), lit(1)) }],
              },
            ],
            elseBody: [{ s: 'assign', target: ref('_hi'), expr: ref('_mid') }],
          },
        ],
      },
      {
        s: 'if',
        arms: [
          {
            cond: {
              op: 'logical',
              type: boolT,
              lop: '&&',
              a: cmp('<', ref('_lo'), ref('_n')),
              b: cmp('==', word(add(ref('_lo'), lit(1))), ref('_w')),
            },
            body: [{ s: 'return', expr: ref('_lo') }],
          },
        ],
      },
      { s: 'return', expr: lit(NOT_FOUND) },
    ],
  };
}
