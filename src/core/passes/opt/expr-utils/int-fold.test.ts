import { describe, expect, it } from 'vitest';
import { i32T, type Expr } from '../../../ir/index.js';
import { foldIntLit } from './int-fold.js';
import { keyOf } from './key.js';

describe('foldIntLit folds as the GPU computes', () => {
  it('multiplies with a wrapping 32-bit product past 2^53', () => {
    expect(foldIntLit('*', 0x7fffffff, 0x7fffffff, 'i32')).toBe(1);
    expect(foldIntLit('*', 0xffffffff, 0xffffffff, 'u32')).toBe(1);
  });

  it('folds no remainder by zero', () => {
    expect(foldIntLit('%', 7, 0, 'i32')).toBeUndefined();
    expect(foldIntLit('%', 7, 0, 'u32')).toBeUndefined();
    expect(foldIntLit('%', -7, 2, 'i32')).toBe(-1);
  });

  it('folds no shift by a count outside 0 to 31', () => {
    expect(foldIntLit('<<', 1, 32, 'i32')).toBeUndefined();
    expect(foldIntLit('>>', 1, -1, 'i32')).toBeUndefined();
    expect(foldIntLit('<<', 1, 31, 'i32')).toBe(-0x80000000);
  });

  it('shifts a u32 right with zeros, and an i32 with its sign', () => {
    expect(foldIntLit('>>', 0x80000000, 31, 'u32')).toBe(1);
    expect(foldIntLit('>>', -0x80000000, 31, 'i32')).toBe(-1);
  });
});

describe('keyOf', () => {
  it('keys an override and a constant of one name apart', () => {
    const override: Expr = { op: 'overrideref', type: i32T, name: 'N' };
    const constant: Expr = { op: 'constref', type: i32T, name: 'N' };
    expect(keyOf(override)).not.toBe(keyOf(constant));
  });
});
