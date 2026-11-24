import { describe, expect, it } from 'vitest';
import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/nodes.js';
import { f32T, i32T, u32T, voidT } from '../ir/types.js';
import {
  atomicArray,
  mapBlock,
  mapStmt,
  placeRoot,
  rangeOf,
  SUBGROUP_FOLD_OF,
  writesThroughCall,
  type ForStmt,
} from './kernel-lower-ir.js';
import {
  emptyModule,
  idx,
  lit,
  loopOver,
  param,
  ref,
  u32Array,
} from './kernel-lower-ir-fixtures.js';

describe('SUBGROUP_FOLD_OF', () => {
  it('names the subgroup function of each operator', () => {
    expect(SUBGROUP_FOLD_OF).toEqual({
      '+': 'subgroupAdd',
      '*': 'subgroupMul',
      '&': 'subgroupAnd',
      '|': 'subgroupOr',
      '^': 'subgroupXor',
      min: 'subgroupMin',
      max: 'subgroupMax',
    });
  });
});

describe('atomicArray', () => {
  it('turns array<T> into array<atomic<T>>', () => {
    expect(atomicArray({ kind: 'array', elem: i32T })).toEqual({
      kind: 'array',
      elem: { kind: 'atomic', elem: 'i32' },
    });
  });
});

describe('rangeOf', () => {
  const cmp = (cop: '<' | '<=' | '>' | '>=' | '==', a: Expr, b: Expr): Expr => ({
    op: 'compare',
    type: u32T,
    cop,
    a,
    b,
  });

  it('reads a counter on the left as written', () => {
    const r = rangeOf(loopOver([], cmp('<', ref('i'), param('n'))));
    expect(r).toMatchObject({ cop: '<', bound: param('n'), start: lit(0) });
  });

  it('flips the comparison when the counter is on the right', () => {
    const r = rangeOf(loopOver([], cmp('>', param('n'), ref('i'))));
    expect(r).toMatchObject({ cop: '<', bound: param('n') });
    const g = rangeOf(loopOver([], cmp('<=', param('n'), ref('i')), -1));
    expect(g).toMatchObject({ cop: '>=' });
  });

  it('flips each ordering of a counter on the right', () => {
    const down = rangeOf(loopOver([], cmp('<', param('n'), ref('i')), -1));
    expect(down).toMatchObject({ cop: '>', bound: param('n') });
    const up = rangeOf(loopOver([], cmp('>=', param('n'), ref('i')), 1));
    expect(up).toMatchObject({ cop: '<=', bound: param('n') });
  });

  it('refuses a step that moves away from the bound', () => {
    expect(rangeOf(loopOver([], cmp('<', ref('i'), param('n')), -1))).toBeUndefined();
    expect(rangeOf(loopOver([], cmp('>', ref('i'), param('n')), 1))).toBeUndefined();
  });

  it('accepts a down step under a greater-than comparison', () => {
    expect(rangeOf(loopOver([], cmp('>=', ref('i'), param('n')), -1))).toMatchObject({ cop: '>=' });
  });

  it('refuses a comparison that is not an ordering and a loop that is not counted', () => {
    expect(rangeOf(loopOver([], cmp('==', ref('i'), param('n'))))).toBeUndefined();
    const uncounted = { ...loopOver([]), counted: undefined } as ForStmt;
    expect(rangeOf(uncounted)).toBeUndefined();
  });

  it('refuses a condition that does not name the counter', () => {
    expect(rangeOf(loopOver([], cmp('<', ref('j'), param('n'))))).toBeUndefined();
  });
});

describe('mapBlock', () => {
  const mark = (name: string): Stmt => ({ s: 'let', name, expr: lit(1) });
  const expand = (st: Stmt): Stmt[] | undefined =>
    st.s === 'let' && st.name === 'x' ? [mark('x1'), mark('x2')] : undefined;

  it('replaces a statement with the statements the mapper gives', () => {
    expect(
      mapBlock([mark('x'), mark('y')], expand).map((s) => (s as { name: string }).name),
    ).toEqual(['x1', 'x2', 'y']);
  });

  it('reaches nested if, for and switch bodies', () => {
    const sts: Stmt[] = [
      { s: 'if', arms: [{ cond: lit(1), body: [mark('x')] }], elseBody: [mark('x')] },
      loopOver([mark('x')]),
      {
        s: 'switch',
        scrut: lit(1),
        cases: [{ values: [lit(1)], body: [mark('x')] }],
        defaultBody: [mark('x')],
      } as unknown as Stmt,
    ];
    const text = JSON.stringify(mapBlock(sts, expand));
    expect(text).not.toContain('"name":"x"');
    expect(text.match(/"name":"x1"/g)?.length).toBe(5);
  });
});

describe('placeRoot', () => {
  it('names the root of an index and member chain', () => {
    const root = ref('out');
    const place: Expr = {
      op: 'member',
      type: f32T,
      base: { op: 'index', type: u32T, base: root, idx: lit(0) },
      field: 'pos',
    };
    expect(placeRoot(place)).toBe(root);
    expect(placeRoot(root)).toBe(root);
  });
});

describe('mapStmt', () => {
  const bump = (e: Expr): Expr => (e.op === 'lit' ? { ...e, value: (e.value as number) + 1 } : e);

  it('applies the function to every expression of nested statements', () => {
    const st: Stmt = {
      s: 'if',
      arms: [{ cond: lit(1), body: [{ s: 'let', name: 'a', expr: lit(2) }] }],
      elseBody: [{ s: 'return', expr: lit(3) }],
    };
    const out = mapStmt(st, bump) as Stmt & { s: 'if' };
    expect(out.arms[0]!.cond).toEqual(lit(2));
    expect(out.arms[0]!.body[0]).toMatchObject({ expr: lit(3) });
    expect(out.elseBody![0]).toMatchObject({ expr: lit(4) });
  });

  it('maps the init, condition, update and body of a for loop', () => {
    const out = mapStmt(loopOver([{ s: 'let', name: 'a', expr: lit(5) }]), bump) as ForStmt;
    expect(out.init).toMatchObject({ init: lit(1) });
    expect(out.update).toMatchObject({ expr: lit(2) });
    expect(out.body[0]).toMatchObject({ expr: lit(6) });
  });

  it('maps the expressions of a switch, an assignment, a var and a call statement', () => {
    const sw = mapStmt(
      {
        s: 'switch',
        scrut: lit(1),
        cases: [{ values: [lit(1)], body: [{ s: 'let', name: 'a', expr: lit(2) }] }],
        defaultBody: [{ s: 'let', name: 'b', expr: lit(3) }],
      } as unknown as Stmt,
      bump,
    ) as unknown as {
      scrut: Expr;
      cases: { body: Stmt[] }[];
      defaultBody: Stmt[];
    };
    expect(sw.scrut).toEqual(lit(2));
    expect(sw.cases[0]!.body[0]).toMatchObject({ expr: lit(3) });
    expect(sw.defaultBody[0]).toMatchObject({ expr: lit(4) });
    const place = lit(7);
    expect(mapStmt({ s: 'assign', target: place, expr: lit(1) }, bump)).toMatchObject({
      target: lit(8),
      expr: lit(2),
    });
    expect(mapStmt({ s: 'assignOp', target: place, bop: '+', expr: lit(4) }, bump)).toMatchObject({
      target: lit(8),
      expr: lit(5),
    });
    expect(mapStmt({ s: 'var', name: 'v', type: u32T, init: lit(9) }, bump)).toMatchObject({
      init: lit(10),
    });
    const call: Stmt = {
      s: 'call',
      expr: { op: 'call', type: voidT, fn: 'f', args: [lit(1)] },
    };
    expect(mapStmt(call, bump)).toEqual(call);
  });

  it('keeps a bare return and a statement without expressions', () => {
    expect(mapStmt({ s: 'return' }, bump)).toEqual({ s: 'return' });
    expect(mapStmt({ s: 'break' }, bump)).toEqual({ s: 'break' });
  });
});

describe('writesThroughCall', () => {
  const callee = (mode: 'in' | 'inout'): FuncDecl => ({
    name: 'bump',
    params: [{ name: 'o', type: u32T, mode } as FuncDecl['params'][number]],
    ret: voidT,
    body: [],
  });
  const moduleOf = (mode: 'in' | 'inout'): ModuleDecl => ({
    ...emptyModule,
    funcs: [callee(mode)],
  });
  const call = (arg: Expr): Stmt => ({
    s: 'call',
    expr: { op: 'call', type: voidT, fn: 'bump', args: [arg] },
  });
  const element = idx(param('out', u32Array), ref('i'));

  it('is true when an element of the array goes to an inout parameter', () => {
    expect(writesThroughCall(loopOver([call(element)]), 'out', moduleOf('inout'))).toBe(true);
  });

  it('is false when the parameter is read only', () => {
    expect(writesThroughCall(loopOver([call(element)]), 'out', moduleOf('in'))).toBe(false);
  });

  it('is false for another array and for a call of an unknown function', () => {
    expect(writesThroughCall(loopOver([call(element)]), 'other', moduleOf('inout'))).toBe(false);
    expect(writesThroughCall(loopOver([call(element)]), 'out', emptyModule)).toBe(false);
  });
});
