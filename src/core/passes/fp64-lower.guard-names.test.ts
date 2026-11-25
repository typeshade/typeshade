import { describe, it, expect } from 'vitest';
import {
  fn,
  module,
  f64T,
  f32T,
  type Expr,
  type FuncDecl,
  type ModuleDecl,
  toF32,
} from '../ir/index.js';
import { eachExpr, eachStmtExpr } from '../ir/visit.js';
import { fp64Lower, foldGuardChain, hoistGuardFetch } from './fp64-lower.js';

const TAKEN = '_fp64_g';

const lowerAndHoist = (m: ModuleDecl): FuncDecl =>
  hoistGuardFetch(fp64Lower(m)).funcs.find((f) => f.name === 'k')!;

const sum = (): FuncDecl => fn('k', { a: f64T, b: f64T }, (p) => toF32(p.a.add(p.b))).decl;

const guardFetches = (f: FuncDecl): number => {
  let n = 0;
  for (const s of f.body)
    eachStmtExpr(s, (e) =>
      eachExpr(e, (x) => {
        if (x.op === 'call' && x.fn === 'f64Guard') n++;
      }),
    );
  return n;
};

describe('the hoisted guard name avoids every name in reach', () => {
  const taken = (extra: Partial<ModuleDecl>): void => {
    const m: ModuleDecl = { ...module({ funcs: [sum()] }), ...extra };
    expect(lowerAndHoist(m).body[0]).toMatchObject({ s: 'let', name: `${TAKEN}1` });
  };

  it('avoids a binding, a constant, a variable, an extern, an override and a function', () => {
    taken({ bindings: [{ group: 1, binding: 0, name: TAKEN, space: 'uniform', type: f32T }] });
    taken({ consts: [{ name: TAKEN, type: f32T, wgslValue: 0, cpuValue: 0 }] });
    taken({ vars: [{ name: TAKEN, space: 'private', type: f32T }] });
    taken({ externs: [{ name: TAKEN, type: f32T }] });
    taken({ overrides: [{ name: TAKEN, type: f32T, default: 0 }] });
    const other: FuncDecl = { name: TAKEN, params: [], ret: f32T, body: [] };
    const m: ModuleDecl = module({ funcs: [sum(), other] });
    expect(lowerAndHoist(m).body[0]).toMatchObject({ name: `${TAKEN}1` });
  });

  it('avoids a parameter of the function', () => {
    const k = fn('k', { [TAKEN]: f64T, b: f64T }, (p) => toF32(p[TAKEN].add(p.b))).decl;
    expect(lowerAndHoist(module({ funcs: [k] })).body[0]).toMatchObject({ name: `${TAKEN}1` });
  });
});

describe('a function that already reads the guard once is left alone, and only then', () => {
  const lowered = (): FuncDecl => fp64Lower(module({ funcs: [sum()] })).funcs[0]!;
  const fetch: Expr = { op: 'call', type: f32T, fn: 'f64Guard', args: [] };

  it('hoists when the first statement is some other binding', () => {
    const k = lowered();
    const prefixed: FuncDecl = {
      ...k,
      body: [{ s: 'let', name: 'early', expr: { op: 'lit', type: f32T, value: 1 } }, ...k.body],
    };
    const out = hoistGuardFetch({ ...module({ funcs: [] }), funcs: [prefixed] });
    expect(out.funcs[0]!.body[0]).toMatchObject({ s: 'let', name: TAKEN });
  });

  it('hoists again when the first binding is not the only fetch', () => {
    const k = lowered();
    const twice: FuncDecl = {
      ...k,
      body: [
        { s: 'let', name: TAKEN, expr: fetch },
        { s: 'let', name: 'again', expr: fetch },
        ...k.body,
      ],
    };
    const out = hoistGuardFetch({ ...module({ funcs: [] }), funcs: [twice] });
    expect(guardFetches(out.funcs[0]!)).toBe(1);
  });
});

describe('guard folding and threading', () => {
  const G: Expr = { op: 'call', type: f32T, fn: 'f64Guard', args: [] };
  const x: Expr = { op: 'param', type: f32T, name: 'x' };

  it('does not fold a product whose type differs from the guarded factor', () => {
    const vec3 = { kind: 'vec', n: 3, elem: 'f32' } as const;
    const guarded: Expr = { op: 'binop', type: f32T, bop: '*', a: x, b: G };
    const widened: Expr = { op: 'binop', type: vec3, bop: '*', a: G, b: guarded };
    expect(foldGuardChain(widened)).toEqual(widened);
  });

  it('drops the declaration a threaded call no longer matches', () => {
    const helpers = fp64Lower(module({ funcs: [sum()] })).funcs.filter((f) =>
      f.name.startsWith('df64_'),
    );
    const threaded = new Set(
      helpers.filter((h) => h.params.at(-1)?.name === TAKEN).map((h) => h.name),
    );
    const stale: string[] = [];
    for (const h of helpers)
      for (const s of h.body)
        eachStmtExpr(s, (e) =>
          eachExpr(e, (c) => {
            if (c.op === 'call' && threaded.has(c.fn) && c.declRef !== undefined) stale.push(c.fn);
          }),
        );
    expect(threaded.size).toBeGreaterThan(0);
    expect(stale).toEqual([]);
  });
});
