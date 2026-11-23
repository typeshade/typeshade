// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import type { Expr, FuncDecl, Stmt } from '../ir/nodes.js';
import { u32T, voidT } from '../ir/types.js';
import { countable, WRITE_COUNTABLE } from './countable.js';
import type { LoopVerdict, LoopWrite } from './parallel-loop.js';

const arrayT = { kind: 'array', elem: u32T } as const;
const out: Expr = { op: 'param', type: arrayT, name: 'out' };
const lit = (value: number): Expr => ({ op: 'lit', type: u32T, value });
const push: Stmt = {
  s: 'call',
  expr: { op: 'call', type: u32T, fn: 'push', args: [out, lit(1)] },
};
const loop = (body: Stmt[]): Stmt & { s: 'for' } => ({
  s: 'for',
  init: { s: 'var', name: 'i', type: u32T, init: lit(0) },
  cond: {
    op: 'compare',
    type: u32T,
    cop: '<',
    a: { op: 'varref', type: u32T, name: 'i' },
    b: lit(2),
  },
  update: { s: 'assign', target: { op: 'varref', type: u32T, name: 'i' }, expr: lit(1) },
  body,
});
const fn = (body: Stmt[]): FuncDecl => ({
  name: 'f',
  params: [{ name: 'out', type: arrayT }],
  ret: voidT,
  body,
  kernel: true,
});
const verdict = (loopStmt: Stmt & { s: 'for' }, writes: LoopWrite[]): LoopVerdict => ({
  ok: true,
  loop: loopStmt,
  writes,
  reductions: [],
  reads: [],
  stores: [],
});
const append: LoopWrite = { kind: 'append', name: 'out' };

describe('countable, the allow-list of a function that Route 2 may run twice (change 0114, A12)', () => {
  const l = loop([push]);
  const f = fn([l, { s: 'return' }]);

  it('accepts a function whose every write is an append to one array', () => {
    expect(countable([verdict(l, [append])], f)).toBe(true);
  });

  it('refuses every kind of write but the append, and a kind it does not know', () => {
    const kinds = Object.keys(WRITE_COUNTABLE) as LoopWrite['kind'][];
    expect(kinds.sort()).toEqual(['affine', 'append', 'row-major', 'scaled', 'scatter', 'texel']);
    for (const kind of kinds) {
      const write = { kind, name: 'out' } as unknown as LoopWrite;
      expect(countable([verdict(l, [append, write])], f)).toBe(kind === 'append');
    }
    const future = { kind: 'future', name: 'out' } as unknown as LoopWrite;
    expect(countable([verdict(l, [append, future])], f)).toBe(false);
  });

  it('refuses a loop the proof refused, a second target, and a function with no loop', () => {
    const refused: LoopVerdict = {
      ok: false,
      loop: l,
      refusal: { rule: 'R1', why: 'while' },
    };
    expect(countable([refused], f)).toBe(false);
    expect(countable([verdict(l, [append, { kind: 'append', name: 'other' }])], f)).toBe(false);
    expect(countable([], f)).toBe(false);
  });

  it('refuses a reduction, a read back, and a statement after the loops', () => {
    const reduced = {
      ...verdict(l, [append]),
      reductions: [{ name: 't', op: '+', type: u32T }],
    } as LoopVerdict;
    expect(countable([reduced], f)).toBe(false);
    const readBack = {
      ...verdict(l, [append]),
      stores: [{ name: 'out', atI: false, readBack: true }],
    } as LoopVerdict;
    expect(countable([readBack], f)).toBe(false);
    const after = fn([l, push, { s: 'return' }]);
    expect(countable([verdict(l, [append])], after)).toBe(false);
  });

  it('refuses a push that is no statement and a read of the length inside a loop', () => {
    const asValue = loop([
      {
        s: 'let',
        name: 'k',
        expr: { op: 'call', type: u32T, fn: 'push', args: [out, lit(1)] },
      },
    ]);
    expect(countable([verdict(asValue, [append])], fn([asValue, { s: 'return' }]))).toBe(false);
    const length = loop([
      push,
      {
        s: 'let',
        name: 'k',
        expr: { op: 'call', type: u32T, fn: 'pushCount', args: [out] },
      },
    ]);
    expect(countable([verdict(length, [append])], fn([length, { s: 'return' }]))).toBe(false);
  });
});
