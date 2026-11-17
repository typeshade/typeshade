import { describe, expect, it } from 'vitest';
import { f32T, i32T, type Expr, type ShaderType } from '../../../ir/index.js';
import { isWorthHoisting } from './hoisting.js';

const pair: ShaderType = { kind: 'struct', name: 'Pair' };
const items: Expr = {
  op: 'varref',
  type: { kind: 'array', elem: pair, size: 4 },
  name: 'items',
};
const i: Expr = { op: 'varref', type: i32T, name: 'i' };
const plusOne: Expr = {
  op: 'binop',
  type: i32T,
  bop: '+',
  a: i,
  b: { op: 'lit', type: i32T, value: 1 },
};

describe('isWorthHoisting', () => {
  it('binds no temporary for a struct read from its place, even at a computed index', () => {
    expect(isWorthHoisting({ op: 'index', type: pair, base: items, idx: plusOne })).toBe(false);
  });

  it('binds a computed scalar', () => {
    expect(
      isWorthHoisting({
        op: 'binop',
        type: f32T,
        bop: '*',
        a: { op: 'param', type: f32T, name: 'x' },
        b: { op: 'param', type: f32T, name: 'x' },
      }),
    ).toBe(true);
  });

  it('binds an index into a binding, a memory load, and not one into a local', () => {
    const at = (name: string): Expr => ({
      op: 'index',
      type: f32T,
      base: { op: 'varref', type: { kind: 'array', elem: f32T, size: 4 }, name },
      idx: i,
    });
    expect(isWorthHoisting(at('buf'), new Set(['buf']))).toBe(true);
    expect(isWorthHoisting(at('local'), new Set(['buf']))).toBe(false);
  });
});
