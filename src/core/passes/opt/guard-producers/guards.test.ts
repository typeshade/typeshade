import { describe, expect, it } from 'vitest';
import {
  boolT,
  f32T,
  type Expr,
  type FuncDecl,
  type ModuleDecl,
  type Stmt,
} from '../../../ir/index.js';
import { guardProducers } from '../guard-producers.js';

const lit = (value: number): Expr => ({ op: 'lit', type: f32T, value });
const ref = (name: string): Expr => ({ op: 'varref', type: f32T, name });
const param = (name: string): Expr => ({ op: 'param', type: f32T, name });
const call = (fn: string, ...args: Expr[]): Expr => ({ op: 'call', type: f32T, fn, args });
const lt = (a: Expr, b: Expr): Expr => ({ op: 'compare', type: boolT, cop: '<', a, b });
const setR = (expr: Expr): Stmt => ({ s: 'assign', target: ref('r'), expr });
const ret = (expr: Expr): Stmt => ({ s: 'return', expr });

const heavy = (body: Stmt[], inout = false): FuncDecl => ({
  name: 'heavy',
  params: [{ name: 'y', type: f32T, ...(inout ? { mode: 'inout' as const } : {}) }],
  ret: f32T,
  body,
});

const mainWith = (
  before: Stmt[],
  arms: { cond: Expr; body: Stmt[] }[],
  elseBody?: Stmt[],
): FuncDecl => ({
  name: 'main',
  params: [
    { name: 'id', type: f32T },
    { name: 'x', type: f32T },
  ],
  ret: f32T,
  body: [
    ...before,
    { s: 'let', name: 'a', expr: call('heavy', param('x')) },
    { s: 'var', name: 'r', type: f32T, init: lit(0) },
    { s: 'if', arms, ...(elseBody ? { elseBody } : {}) },
    ret(ref('r')),
  ],
});

const threeWay = (heavyFn: FuncDecl, before: Stmt[] = []): ModuleDecl => ({
  consts: [],
  structs: [],
  bindings: [],
  funcs: [
    heavyFn,
    mainWith(
      before,
      [
        { cond: lt(param('id'), lit(1)), body: [setR(ref('a'))] },
        { cond: lt(param('id'), lit(2)), body: [setR(lit(5))] },
      ],
      [setR(ref('a'))],
    ),
  ],
});

const plainHeavy = (): FuncDecl => heavy([ret(call('sin', param('y')))]);
const callStmt = (expr: Expr): Stmt => ({ s: 'call', expr }) as Stmt;
const guarded = (m: ModuleDecl): boolean =>
  m.funcs
    .find((f) => f.name === 'main')!
    .body.some((s) => s.s === 'let' && s.name.startsWith('_guard'));

describe('guardProducers guards', () => {
  it('guards the fixture, so each case below has something to refuse', () => {
    expect(guarded(guardProducers(threeWay(plainHeavy())))).toBe(true);
  });

  const refused: [string, () => ModuleDecl][] = [
    [
      'a callee calls a barrier',
      () => threeWay(heavy([callStmt(call('workgroupBarrier')), ret(param('y'))])),
    ],
    [
      'a callee calls an atomic',
      () => threeWay(heavy([ret(call('atomicAdd', param('y'), lit(1)))])),
    ],
    [
      'a callee calls a subgroup operation',
      () => threeWay(heavy([ret(call('subgroupAdd', param('y')))])),
    ],
    [
      'a callee calls a quad operation',
      () => threeWay(heavy([ret(call('quadSwapX', param('y')))])),
    ],
    [
      'a callee logs',
      () => threeWay(heavy([callStmt(call('console.log', param('y'))), ret(param('y'))])),
    ],
    [
      'a callee calls a name nothing defines',
      () => threeWay(heavy([ret(call('mystery', param('y')))])),
    ],
    [
      'a callee holds raw text',
      () => threeWay(heavy([{ s: 'raw', wgsl: 'let z = 1.0;' }, ret(param('y'))])),
    ],
    ['a callee takes an inout parameter', () => threeWay(heavy([ret(param('y'))], true))],
    [
      'a callee writes a name outside itself',
      () => threeWay(heavy([{ s: 'assign', target: ref('g'), expr: param('y') }, ret(param('y'))])),
    ],
    [
      'the function holds raw text',
      () => threeWay(plainHeavy(), [{ s: 'raw', wgsl: 'let z = 1.0;' }]),
    ],
  ];
  for (const [what, build] of refused)
    it(`leaves the producers alone when ${what}`, () => {
      const m = build();
      expect(guardProducers(m)).toBe(m);
    });

  it('leaves a guard of more than 24 terms unwritten', () => {
    const arms = (count: number): { cond: Expr; body: Stmt[] }[] =>
      Array.from({ length: count }, (_, k) => ({
        cond: lt(param('id'), lit(k)),
        body: [setR(lit(k))],
      }));
    const chain = (count: number): ModuleDecl => ({
      consts: [],
      structs: [],
      bindings: [],
      funcs: [plainHeavy(), mainWith([], arms(count), [setR(ref('a'))])],
    });
    expect(guarded(guardProducers(chain(3)))).toBe(true);
    const long = chain(8);
    expect(guardProducers(long)).toBe(long);
  });
});
