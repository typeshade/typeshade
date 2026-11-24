import { describe, expect, it } from 'vitest';
import type { Expr, Stmt } from '../ir/nodes.js';
import type { ShaderType } from '../ir/types.js';
import { i32T, u32T } from '../ir/types.js';
import { iterationOf } from './kernel-lower-ir.js';
import { ctx, idx, lit, loopOver, param, ref, u32Array } from './kernel-lower-ir-fixtures.js';

describe('iterationOf', () => {
  const store = (target: Expr, expr: Expr): Stmt => ({ s: 'assign', target, expr });
  const counterOf = (sts: Stmt[]): Expr => (sts[0] as Stmt & { s: 'let' }).expr;

  it('opens with the counter as start plus k times the step', () => {
    const c = ctx({ loop: loopOver([]), step: 2 });
    const sts = iterationOf(c, undefined, []);
    expect(sts[0]).toMatchObject({ s: 'let', name: 'i' });
    const e = counterOf(sts) as Expr & { op: 'binop' };
    expect(e.bop).toBe('+');
    expect(e.a).toMatchObject({ op: 'member', field: '_start' });
    expect(e.b).toMatchObject({ op: 'binop', bop: '*', b: lit(2) });
  });

  it('steps down for a negative step with the absolute step', () => {
    const c = ctx({ loop: loopOver([]), step: -3 });
    const e = counterOf(iterationOf(c, undefined, [])) as Expr & { op: 'binop' };
    expect(e.bop).toBe('-');
    expect(e.b).toMatchObject({ bop: '*', b: lit(3) });
  });

  it('casts k to the counter type', () => {
    const c = ctx({ loop: loopOver([]), counterType: i32T });
    const e = counterOf(iterationOf(c, undefined, [])) as Expr & { op: 'binop' };
    expect(e.b).toMatchObject({ a: { op: 'call', fn: 'i32', args: [ref('_k')] } });
  });

  it('puts the prelude, then the reset, then the body after the counter', () => {
    const prelude = [{ s: 'let', name: 'pre', expr: lit(1) } as Stmt];
    const reset = [{ s: 'let', name: 'rst', expr: lit(2) } as Stmt];
    const body = [{ s: 'let', name: 'bod', expr: lit(3) } as Stmt];
    const sts = iterationOf(ctx({ loop: loopOver(body), prelude }), undefined, reset);
    expect(sts.map((s) => (s as { name?: string }).name)).toEqual(['i', 'pre', 'rst', 'bod']);
  });

  it('ends with a return of ret when ret is given', () => {
    const sts = iterationOf(ctx({ loop: loopOver([]) }), lit(7), []);
    expect(sts.at(-1)).toEqual({ s: 'return', expr: lit(7) });
    expect(iterationOf(ctx({ loop: loopOver([]) }), undefined, []).at(-1)?.s).toBe('let');
  });

  it('turns a continue of the loop into a return, also under if and switch', () => {
    const body: Stmt[] = [
      {
        s: 'if',
        arms: [{ cond: lit(1), body: [{ s: 'continue' }] }],
        elseBody: [{ s: 'continue' }],
      },
      {
        s: 'switch',
        scrut: lit(1),
        cases: [{ values: [lit(1)], body: [{ s: 'continue' }] }],
        defaultBody: [{ s: 'continue' }],
      } as unknown as Stmt,
    ];
    const text = JSON.stringify(iterationOf(ctx({ loop: loopOver(body) }), lit(9), []));
    expect(text).not.toContain('"continue"');
    expect(text.match(/"s":"return"/g)?.length).toBe(5);
  });

  it('keeps a continue inside a nested loop', () => {
    const inner = loopOver([{ s: 'continue' }]);
    const text = JSON.stringify(iterationOf(ctx({ loop: loopOver([inner]) }), undefined, []));
    expect(text).toContain('"continue"');
  });

  it('keeps the span of a continue on its return', () => {
    const body: Stmt[] = [{ s: 'continue', span: { start: 1, end: 2 } } as unknown as Stmt];
    const sts = iterationOf(ctx({ loop: loopOver(body) }), undefined, []);
    expect(sts[1]).toMatchObject({ s: 'return', span: { start: 1, end: 2 } });
  });

  it('rewrites a scatter write as an atomic call and leaves other writes plain', () => {
    const t: ShaderType = u32Array;
    const place = idx(param('hist', t), ref('i'));
    const body: Stmt[] = [
      { s: 'assignOp', target: place, bop: '+', expr: lit(1) },
      store(idx(param('out', t), ref('i')), lit(5)),
    ];
    const c = ctx({ loop: loopOver(body), arrays: ['hist', 'out'], scatter: new Set(['hist']) });
    const sts = iterationOf(c, undefined, []);
    expect(sts[1]).toMatchObject({ s: 'call', expr: { op: 'call', fn: 'atomicAdd' } });
    expect(sts[2]).toMatchObject({ s: 'assign' });
  });

  it('maps each combine operator to its atomic', () => {
    const t: ShaderType = u32Array;
    const place = idx(param('hist', t), ref('i'));
    const fns = (['+', '&', '|', '^'] as const).map((bop) => {
      const body: Stmt[] = [{ s: 'assignOp', target: place, bop, expr: lit(1) }];
      const c = ctx({ loop: loopOver(body), arrays: ['hist'], scatter: new Set(['hist']) });
      return (
        (iterationOf(c, undefined, [])[1] as Stmt & { s: 'call' }).expr as Expr & { op: 'call' }
      ).fn;
    });
    expect(fns).toEqual(['atomicAdd', 'atomicAnd', 'atomicOr', 'atomicXor']);
  });

  it('skips the iteration under the mask when the lane skips', () => {
    const body: Stmt[] = [{ s: 'let', name: 'bod', expr: lit(3) }];
    const mask = ref('_live');
    const sts = iterationOf(ctx({ loop: loopOver(body) }), undefined, [], {
      k: ref('_lane'),
      mask,
      skip: true,
    });
    expect(sts[0]).toMatchObject({ s: 'let', name: 'i' });
    expect(sts[1]).toMatchObject({ s: 'if', arms: [{ cond: mask }] });
    expect(JSON.stringify(sts[0])).toContain('_lane');
  });

  it('masks writes to an outer array, and keeps writes to a local', () => {
    const t: ShaderType = u32Array;
    const body: Stmt[] = [
      { s: 'var', name: 'tmp', type: u32T, init: lit(0) },
      store(ref('tmp'), lit(1)),
      store(idx(param('out', t), ref('i')), lit(2)),
    ];
    const mask = ref('_live');
    const sts = iterationOf(ctx({ loop: loopOver(body) }), undefined, [], {
      k: ref('_k'),
      mask,
      skip: false,
    });
    expect(sts[1]).toMatchObject({ s: 'var', name: 'tmp' });
    expect(sts[2]).toMatchObject({ s: 'assign', target: ref('tmp') });
    expect(sts[3]).toMatchObject({ s: 'if', arms: [{ cond: mask, body: [{ s: 'assign' }] }] });
  });

  it('masks an effectful builtin call and not a pure one', () => {
    const atomic: Stmt = {
      s: 'call',
      expr: { op: 'call', type: u32T, fn: 'atomicAdd', args: [ref('out'), lit(1)] },
    };
    const pure: Stmt = { s: 'call', expr: { op: 'call', type: u32T, fn: 'abs', args: [lit(1)] } };
    const mask = ref('_live');
    const sts = iterationOf(ctx({ loop: loopOver([atomic, pure]) }), undefined, [], {
      k: ref('_k'),
      mask,
      skip: false,
    });
    expect(sts[1]).toMatchObject({ s: 'if' });
    expect(sts[2]).toMatchObject({ s: 'call' });
  });

  it('masks a write inside a nested statement', () => {
    const t: ShaderType = u32Array;
    const inner = store(idx(param('out', t), ref('i')), lit(2));
    const body: Stmt[] = [{ s: 'if', arms: [{ cond: lit(1), body: [inner] }] }];
    const mask = ref('_live');
    const sts = iterationOf(ctx({ loop: loopOver(body) }), undefined, [], {
      k: ref('_k'),
      mask,
      skip: false,
    });
    const arm = (sts[1] as Stmt & { s: 'if' }).arms[0]!.body[0];
    expect(arm).toMatchObject({ s: 'if', arms: [{ cond: mask }] });
  });

  it('reads the start from the trip buffer, as the counter type', () => {
    const trips = { binding: 'trip', at: 4 };
    const u = iterationOf(ctx({ loop: loopOver([]), trips }), undefined, []);
    expect((counterOf(u) as Expr & { op: 'binop' }).a).toMatchObject({
      op: 'index',
      base: ref('trip', u32Array),
      idx: lit(4),
    });
    const s = iterationOf(ctx({ loop: loopOver([]), trips, counterType: i32T }), undefined, []);
    expect((counterOf(s) as Expr & { op: 'binop' }).a).toMatchObject({
      op: 'call',
      fn: 'i32',
      args: [{ op: 'index', idx: lit(4) }],
    });
  });

  it('defers a scatter write to slots and folds the slots after the iteration', () => {
    const t: ShaderType = u32Array;
    const place = idx(param('hist', t), ref('i'));
    const body: Stmt[] = [{ s: 'assignOp', target: place, bop: '+', expr: lit(1) }];
    const c = ctx({
      loop: loopOver(body),
      arrays: ['hist'],
      scatter: new Set(['hist']),
      subgroupScatter: true,
    });
    const sts = iterationOf(c, undefined, []);
    const text = JSON.stringify(sts);
    expect(sts.slice(1, 4).map((s) => (s as { name: string }).name)).toEqual([
      '_sgw0',
      '_sgk0',
      '_sgv0',
    ]);
    expect(sts[3]).toMatchObject({ init: lit(0) });
    expect(JSON.stringify(sts.slice(0, -1))).not.toContain('atomicAdd');
    expect(text).toContain('subgroupAdd');
    expect(text).toContain('subgroupElect');
    expect(text).toContain('atomicAdd');
    const fold = sts.at(-1) as Stmt & { s: 'for' };
    expect(fold.s).toBe('for');
    expect(fold.cond).toMatchObject({ cop: '<', b: lit(128) });
  });

  it('starts a deferred write as not written, so a lane without a write adds nothing', () => {
    const t: ShaderType = u32Array;
    const body: Stmt[] = [
      { s: 'assignOp', target: idx(param('hist', t), ref('i')), bop: '+', expr: lit(1) },
    ];
    const c = ctx({
      loop: loopOver(body),
      arrays: ['hist'],
      scatter: new Set(['hist']),
      subgroupScatter: true,
    });
    const sts = iterationOf(c, undefined, []);
    expect(sts[1]).toMatchObject({ init: { op: 'lit', value: false } });
    expect(sts[4]).toMatchObject({
      s: 'assign',
      target: ref('_sgw0', { kind: 'scalar', scalar: 'bool' }),
      expr: ref('_live', { kind: 'scalar', scalar: 'bool' }),
    });
  });

  it('keeps a u32 key and casts any other index type to u32', () => {
    const keyOf = (idxExpr: Expr): Expr => {
      const body: Stmt[] = [
        { s: 'assignOp', target: idx(param('hist', u32Array), idxExpr), bop: '+', expr: lit(1) },
      ];
      const c = ctx({
        loop: loopOver(body),
        arrays: ['hist'],
        scatter: new Set(['hist']),
        subgroupScatter: true,
      });
      return (iterationOf(c, undefined, [])[5] as Stmt & { s: 'assign' }).expr;
    };
    expect(keyOf(ref('i'))).toEqual(ref('i'));
    expect(keyOf(ref('s', i32T))).toMatchObject({ op: 'call', fn: 'u32', args: [ref('s', i32T)] });
  });

  it('keeps the span of a scatter write on its atomic call', () => {
    const place = idx(param('hist', u32Array), ref('i'));
    const body: Stmt[] = [
      { s: 'assignOp', target: place, bop: '+', expr: lit(1), span: { start: 3, end: 4 } } as Stmt,
    ];
    const c = ctx({ loop: loopOver(body), arrays: ['hist'], scatter: new Set(['hist']) });
    expect(iterationOf(c, undefined, [])[1]).toMatchObject({
      s: 'call',
      span: { start: 3, end: 4 },
    });
  });

  it('seeds the slot value with the identity of the operator', () => {
    const mk = (bop: '&' | 'min', elem: ShaderType): Stmt[] => {
      const t: ShaderType = { kind: 'array', elem };
      const place: Expr = { op: 'index', type: elem, base: param('h', t), idx: ref('i') };
      const body: Stmt[] = [
        { s: 'assignOp', target: place, bop: bop === 'min' ? '&' : bop, expr: lit(1, elem) },
      ];
      return iterationOf(
        ctx({
          loop: loopOver(body),
          arrays: ['h'],
          scatter: new Set(['h']),
          subgroupScatter: true,
        }),
        undefined,
        [],
      );
    };
    expect(mk('&', u32T)[3]).toMatchObject({ init: lit(0xffffffff) });
    expect(mk('&', i32T)[3]).toMatchObject({ init: { value: -1 } });
  });
});
