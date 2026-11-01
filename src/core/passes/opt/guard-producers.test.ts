// #848: producers before an `if` chain run only on the paths to an arm that reads them. Each
// case is generic IR; the values are held to the CPU oracle before and after the pass.

import { describe, it, expect } from 'vitest';
import { guardProducers } from './guard-producers.js';
import { fixpoint } from './optimize.js';
import { compileModule } from '../../oracle.js';
import {
  boolT,
  f32T,
  type Expr,
  type FuncDecl,
  type ModuleDecl,
  type Stmt,
} from '../../ir/index.js';

const lit = (value: number): Expr => ({ op: 'lit', type: f32T, value });
const ref = (name: string): Expr => ({ op: 'varref', type: f32T, name });
const param = (name: string): Expr => ({ op: 'param', type: f32T, name });
const call = (fn: string, ...args: Expr[]): Expr => ({ op: 'call', type: f32T, fn, args });
const add = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: f32T, bop: '+', a, b });
const lt = (a: Expr, b: Expr): Expr => ({ op: 'compare', type: boolT, cop: '<', a, b });
const set = (expr: Expr): Stmt => ({ s: 'assign', target: ref('r'), expr });
const fn = (name: string, params: string[], body: Stmt[]): FuncDecl => ({
  name,
  params: params.map((p) => ({ name: p, type: f32T })),
  ret: f32T,
  body,
});
const heavy = (body?: Stmt[]): FuncDecl =>
  fn('heavy', ['y'], body ?? [{ s: 'return', expr: add(call('sin', param('y')), lit(2)) }]);
const ID = param('id');
const X = param('x');

/** `main(id, x)`: `a = heavy(x)` before a three-way chain whose middle arm reads nothing. */
const chainModule = (opts: {
  heavyBody?: Stmt[];
  arms?: Stmt[][];
  elseBody?: Stmt[] | null;
  cond0?: Expr;
  tail?: Expr;
}): ModuleDecl => ({
  consts: [],
  structs: [],
  bindings: [],
  funcs: [
    heavy(opts.heavyBody),
    fn(
      'main',
      ['id', 'x'],
      [
        { s: 'let', name: 'a', expr: call('heavy', X) },
        { s: 'var', name: 'r', type: f32T, init: lit(0) },
        {
          s: 'if',
          arms: [
            { cond: opts.cond0 ?? lt(ID, lit(1)), body: opts.arms?.[0] ?? [set(ref('a'))] },
            { cond: lt(ID, lit(2)), body: opts.arms?.[1] ?? [set(lit(5))] },
          ],
          ...(opts.elseBody === null
            ? {}
            : { elseBody: opts.elseBody ?? [set(add(ref('a'), lit(1)))] }),
        },
        { s: 'return', expr: opts.tail ?? ref('r') },
      ],
    ),
  ],
});

const mainOf = (m: ModuleDecl): readonly Stmt[] => m.funcs.find((f) => f.name === 'main')!.body;
const guarded = (m: ModuleDecl): boolean =>
  mainOf(m).some((s) => s.s === 'let' && s.name.startsWith('_guard'));
const sameValues = (before: ModuleDecl, after: ModuleDecl): void => {
  const a = compileModule(before).fns.main!;
  const b = compileModule(after).fns.main!;
  for (const id of [0, 1, 1.5, 2, 3, Number.NaN])
    for (const x of [-1, 0, 0.75]) expect(b(id, x)).toBe(a(id, x));
};

describe('guardProducers', () => {
  it('skips a producer on the arm that reads nothing, and keeps every value', () => {
    const m = chainModule({});
    const out = guardProducers(m);
    expect(guarded(out)).toBe(true);
    // `a` is declared without a value, and computed only under the guard.
    expect(mainOf(out).find((s) => s.s === 'var' && s.name === 'a')).toEqual({
      s: 'var',
      name: 'a',
      type: f32T,
    });
    sameValues(m, out);
    sameValues(m, fixpoint(m));
  });

  it('treats a missing else as a branch that reads nothing', () => {
    const m = chainModule({
      arms: [[set(ref('a'))], [set(add(ref('a'), lit(3)))]],
      elseBody: null,
    });
    const out = guardProducers(m);
    expect(guarded(out)).toBe(true);
    sameValues(m, out);
  });

  it('runs once: a second run changes nothing', () => {
    const once = guardProducers(chainModule({}));
    expect(guardProducers(once)).toEqual(once);
  });

  const unchanged: [string, () => ModuleDecl][] = [
    ['a condition reads the produced value', () => chainModule({ cond0: lt(ref('a'), lit(1)) })],
    ['the value is read after the chain', () => chainModule({ tail: add(ref('r'), ref('a')) })],
    [
      'a callee takes a derivative',
      () => chainModule({ heavyBody: [{ s: 'return', expr: call('dpdx', param('y')) }] }),
    ],
    [
      'a callee can discard',
      () => chainModule({ heavyBody: [{ s: 'discard' }, { s: 'return', expr: param('y') }] }),
    ],
    [
      'every branch reads the value',
      () => chainModule({ arms: [[set(ref('a'))], [set(ref('a'))]] }),
    ],
    ['a condition calls a function', () => chainModule({ cond0: lt(call('sin', ID), lit(1)) })],
  ];
  for (const [what, build] of unchanged)
    it(`leaves the producers alone when ${what}`, () => {
      const m = build();
      expect(guardProducers(m)).toBe(m);
    });

  it('leaves producers that call no function of the module alone', () => {
    const m = chainModule({});
    const cheap: ModuleDecl = {
      ...m,
      funcs: m.funcs.map((f) =>
        f.name !== 'main'
          ? f
          : { ...f, body: f.body.map((s) => (s.s === 'let' ? { ...s, expr: call('sin', X) } : s)) },
      ),
    };
    expect(guardProducers(cheap)).toBe(cheap);
  });
});
