import { describe, expect, it } from 'vitest';
import { compileModule } from './oracle.js';
import { boolT, f32T, i32T } from './ir/index.js';
import type { Expr, FuncDecl, ModuleDecl, ShaderType, Stmt } from './ir/index.js';

const i32 = (value: number): Expr => ({ op: 'lit', type: i32T, value });
const ref = (name: string, type: ShaderType = i32T): Expr => ({ op: 'varref', type, name });
const plus = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: i32T, bop: '+', a, b });
const less = (a: Expr, b: Expr): Expr => ({
  op: 'compare',
  type: boolT,
  cop: '<',
  a,
  b,
});
const set = (name: string, expr: Expr): Stmt => ({ s: 'assign', target: ref(name), expr });
const sum = (name: string, by: number): Stmt => set(name, plus(ref(name), i32(by)));
const give = (name: string): Stmt => ({ s: 'return', expr: ref(name) });

const moduleOf = (body: Stmt[], params: FuncDecl['params'] = []): ModuleDecl => ({
  consts: [],
  structs: [],
  bindings: [],
  funcs: [{ name: 'run', params, ret: i32T, body }],
});

const run = (body: Stmt[], ...args: number[]): unknown =>
  compileModule(moduleOf(body, args.length === 0 ? [] : [{ name: 'v', type: i32T }])).fns['run']!(
    ...args,
  );

const loopOver = (inside: Stmt[]): Stmt[] => [
  { s: 'var', name: 'acc', type: i32T, init: i32(0) },
  {
    s: 'for',
    init: { s: 'var', name: 'i', type: i32T, init: i32(0) },
    cond: less(ref('i'), i32(3)),
    update: sum('i', 1),
    body: inside,
  },
  give('acc'),
];

describe('oracle: a switch clause matches any of its selectors', () => {
  const pick: Stmt[] = [
    {
      s: 'switch',
      scrut: ref('v'),
      cases: [
        { values: [0, 1], body: [{ s: 'return', expr: i32(10) }] },
        { values: [2, 3], body: [{ s: 'return', expr: i32(20) }] },
      ],
      defaultBody: [{ s: 'return', expr: i32(30) }],
    },
  ];

  it.each([
    [0, 10],
    [1, 10],
    [2, 20],
    [3, 20],
    [4, 30],
  ])('the scrutinee %i selects the body that returns %i', (v, expected) => {
    expect(run(pick, v)).toBe(expected);
  });
});

describe('oracle: a break in a case body exits the switch only', () => {
  const breakCase = (): Stmt => ({
    s: 'switch',
    scrut: i32(1),
    cases: [{ values: [1], body: [sum('acc', 1), { s: 'break' }, sum('acc', 100)] }],
  });

  it('the statements after the switch still run', () => {
    expect(
      run([
        { s: 'var', name: 'acc', type: i32T, init: i32(0) },
        breakCase(),
        sum('acc', 10),
        give('acc'),
      ]),
    ).toBe(11);
  });

  it('an enclosing loop is not left', () => {
    expect(run(loopOver([breakCase()]))).toBe(3);
  });
});

describe('oracle: a continue in a case body reaches the loop that owns it', () => {
  it('the rest of that iteration is skipped', () => {
    const skipOne: Stmt = {
      s: 'switch',
      scrut: ref('i'),
      cases: [{ values: [1], body: [{ s: 'continue' }] }],
    };
    expect(run(loopOver([skipOne, sum('acc', 1)]))).toBe(2);
  });
});

describe('oracle: a return in a case body leaves the function', () => {
  it('the value of the return is the result', () => {
    const early: Stmt = {
      s: 'switch',
      scrut: i32(1),
      cases: [{ values: [1], body: [{ s: 'return', expr: i32(7) }] }],
    };
    expect(run([early, { s: 'return', expr: i32(8) }])).toBe(7);
  });
});

describe('oracle: a statement with no CPU meaning throws', () => {
  it('a placeholder names its tag', () => {
    const cpu = compileModule(moduleOf([{ s: 'placeholder', tag: 'fill-return' }]));
    expect(() => cpu.fns['run']!()).toThrow(
      'typeshade/cpu: placeholder Stmt reached CPU backend — composer forgot to splice tag=fill-return',
    );
  });

  it('a raw statement says raw passthrough is GPU-only', () => {
    const cpu = compileModule(moduleOf([{ s: 'raw', wgsl: 'let a = 1;' }]));
    expect(() => cpu.fns['run']!()).toThrow(
      'typeshade/cpu: raw Stmt reached CPU backend — raw passthrough is GPU-only',
    );
  });
});

describe('oracle: an inout argument that is an array element', () => {
  const f32Ref = (name: string): Expr => ({ op: 'varref', type: f32T, name });
  const xs: ShaderType = { kind: 'array', elem: f32T, size: 2 };
  const element = (index: Expr): Expr => ({
    op: 'index',
    type: f32T,
    base: { op: 'varref', type: xs, name: 'xs' },
    idx: index,
  });
  const lit = (value: number): Expr => ({ op: 'lit', type: f32T, value });
  const withCallee = (argument: Expr, extra: Stmt[]): ModuleDecl => ({
    consts: [],
    structs: [],
    bindings: [],
    funcs: [
      {
        name: 'bump',
        params: [{ name: 'p', type: f32T, mode: 'inout' }],
        ret: { kind: 'void' },
        body: [
          ...extra,
          {
            s: 'assign',
            target: { op: 'param', type: f32T, name: 'p' },
            expr: { op: 'binop', type: f32T, bop: '+', a: f32Ref('p'), b: lit(5) },
          },
        ],
      },
      {
        name: 'run',
        params: [],
        ret: xs,
        body: [
          {
            s: 'var',
            name: 'xs',
            type: xs,
            init: { op: 'construct', type: xs, args: [lit(1), lit(2)] },
          },
          { s: 'call', expr: { op: 'call', type: { kind: 'void' }, fn: 'bump', args: [argument] } },
          { s: 'return', expr: { op: 'varref', type: xs, name: 'xs' } },
        ],
      },
    ],
  });

  it('a scalar element holds what the callee left in its parameter', () => {
    const cpu = compileModule(withCallee(element({ op: 'lit', type: i32T, value: 1 }), []));
    expect(cpu.fns['run']!()).toEqual([1, 7]);
  });
});
