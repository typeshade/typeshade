import { describe, expect, it } from 'vitest';
import { compileModule } from '../../oracle.js';
import type { Expr, ModuleDecl, ShaderType, Stmt } from '../../ir/index.js';
import { boolT, f32T, i32T, vec3fT } from '../../ir/types.js';
import { ifConvert } from './if-convert.js';
import { fixpoint } from './optimize.js';

const v = (name: string, type: ShaderType = f32T): Expr => ({ op: 'varref', type, name });
const p = (name: string, type: ShaderType = f32T): Expr => ({ op: 'param', type, name });
const lit = (value: number, type: ShaderType = f32T): Expr => ({ op: 'lit', type, value });
const bin = (bop: '+' | '-' | '*' | '/', a: Expr, b: Expr, type: ShaderType = f32T): Expr => ({
  op: 'binop',
  type,
  bop,
  a,
  b,
});
const gt = (a: Expr, b: Expr): Expr => ({ op: 'compare', type: boolT, cop: '>', a, b });
const call = (fn: string, args: Expr[], type: ShaderType = f32T): Expr => ({
  op: 'call',
  type,
  fn,
  args,
});
const set = (name: string, expr: Expr, type: ShaderType = f32T): Stmt => ({
  s: 'assign',
  target: v(name, type),
  expr,
});
const decl = (name: string, init?: Expr, type: ShaderType = f32T): Stmt => ({
  s: 'var',
  name,
  type,
  init,
});
const when = (then: Stmt[], otherwise?: Stmt[], cond: Expr = gt(p('a'), p('b'))): Stmt => ({
  s: 'if',
  arms: [{ cond, body: then }],
  elseBody: otherwise,
});

const moduleOf = (body: Stmt[], ret: ShaderType = f32T): ModuleDecl => ({
  consts: [],
  structs: [],
  bindings: [],
  funcs: [
    {
      name: 'f',
      params: [
        { name: 'a', type: f32T },
        { name: 'b', type: f32T },
        { name: 'c', type: f32T },
      ],
      ret,
      body,
    },
  ],
});

const withVars = (...rest: Stmt[]): Stmt[] => [
  decl('x', p('a')),
  decl('y', p('b')),
  ...rest,
  { s: 'return', expr: bin('+', bin('*', v('x'), lit(10)), v('y')) },
];

const bodyOf = (m: ModuleDecl): readonly Stmt[] => m.funcs[0]!.body;
const count = (m: ModuleDecl, needle: string): number =>
  JSON.stringify(bodyOf(m)).split(needle).length - 1;
const ifs = (m: ModuleDecl): number => count(m, '"s":"if"');
const selects = (m: ModuleDecl): number => count(m, '"op":"select"');

const INPUTS: number[][] = [
  [1, 2, 3],
  [2, 1, 3],
  [-4.5, 0.25, 9],
  [5, 5, 0],
  [0, -1, 2],
];
const sameValues = (m: ModuleDecl, out: ModuleDecl): void => {
  const run = (x: ModuleDecl) => compileModule(x).fns.f! as (...a: number[]) => number;
  for (const args of INPUTS) expect(run(out)(...args)).toEqual(run(m)(...args));
};

const converts = (m: ModuleDecl): ModuleDecl => {
  const out = ifConvert(m);
  expect(ifs(out)).toBe(0);
  sameValues(m, out);
  return out;
};

const stays = (m: ModuleDecl): void => {
  expect(ifConvert(m)).toEqual(m);
};

describe('ifConvert', () => {
  it('turns the swap of two locals into selects over one condition', () => {
    const m = moduleOf(
      withVars(when([set('x', p('b')), set('y', p('a'))], [set('x', p('a')), set('y', p('b'))])),
    );
    const out = converts(m);
    expect(selects(out)).toBe(2);
    expect(count(out, '"cop"')).toBe(1);
  });

  it('turns an if with no else into a select that keeps the old value', () => {
    const m = moduleOf(withVars(when([set('x', bin('+', v('x'), lit(1)))])));
    const out = converts(m);
    expect(selects(out)).toBe(1);
  });

  it('reads the value an earlier assignment of the same arm gave', () => {
    const m = moduleOf(withVars(when([set('x', v('y')), set('y', v('x'))])));
    const out = converts(m);
    expect(selects(out)).toBe(1);
    expect(compileModule(out).fns.f!(2, 1, 0)).toEqual(compileModule(m).fns.f!(2, 1, 0));
  });

  it('binds a value to a let when two assignments read each other', () => {
    const m = moduleOf(
      [decl('t', lit(0))].concat(
        withVars(when([set('t', v('x')), set('x', v('y')), set('y', v('t'))])),
      ),
    );
    const out = converts(m);
    expect(count(out, '"s":"let"')).toBeGreaterThanOrEqual(2);
  });

  it('applies a compound assignment to the value of its arm', () => {
    const m = moduleOf(
      withVars(
        when([
          { s: 'assignOp', target: v('x'), bop: '+', expr: v('y') },
          { s: 'assignOp', target: v('x'), bop: '*', expr: lit(2) },
        ]),
      ),
    );
    converts(m);
  });

  it('converts vector locals', () => {
    const m = moduleOf([
      decl('w', { op: 'construct', type: vec3fT, args: [p('a'), p('b'), p('c')] }, vec3fT),
      decl('u', { op: 'construct', type: vec3fT, args: [p('c'), p('b'), p('a')] }, vec3fT),
      when(
        [set('w', bin('+', v('w', vec3fT), v('u', vec3fT), vec3fT), vec3fT)],
        [set('u', bin('*', v('u', vec3fT), lit(2), vec3fT), vec3fT)],
      ),
      {
        s: 'return',
        expr: bin(
          '+',
          { op: 'member', type: f32T, base: v('w', vec3fT), field: 'x' },
          { op: 'member', type: f32T, base: v('u', vec3fT), field: 'y' },
        ),
      },
    ]);
    const out = converts(m);
    expect(selects(out)).toBe(2);
  });

  it('keeps the value of a pure builtin and of an integer division by a nonzero constant', () => {
    const m = moduleOf([
      decl('n', call('i32', [p('a')], i32T), i32T),
      decl('x', p('a')),
      when([
        set('x', call('max', [p('b'), p('c')])),
        set('n', bin('/', v('n', i32T), lit(3, i32T), i32T), i32T),
      ]),
      { s: 'return', expr: bin('+', v('x'), call('f32', [v('n', i32T)])) },
    ]);
    converts(m);
  });

  it('computes the same values after the whole pipeline', () => {
    const m = moduleOf(
      withVars(when([set('x', p('b')), set('y', p('a'))], [set('x', p('a')), set('y', p('b'))])),
    );
    const out = fixpoint(m);
    expect(ifs(out)).toBe(0);
    sameValues(m, out);
  });

  const cases: [string, Stmt[]][] = [
    ['a call of a function with an effect', [set('x', call('side', [p('a')]))]],
    ['a derivative', [set('x', call('dpdx', [p('a')]))]],
    ['an atomic', [set('x', call('atomicAdd', [p('a'), p('b')]))]],
    [
      'a store to a binding',
      [
        {
          s: 'assign',
          target: {
            op: 'index',
            type: f32T,
            base: v('buf', { kind: 'array', elem: f32T }),
            idx: lit(0, i32T),
          },
          expr: p('a'),
        },
      ],
    ],
    [
      'a component of a vector',
      [
        {
          s: 'assign',
          target: { op: 'member', type: f32T, base: v('w', vec3fT), field: 'x' },
          expr: p('a'),
        },
      ],
    ],
    ['a parameter', [{ s: 'assign', target: p('c'), expr: p('a') }]],
    [
      'a loop',
      [
        {
          s: 'for',
          init: decl('i', lit(0, i32T), i32T),
          cond: { op: 'lit', type: boolT, value: false },
          update: set('i', lit(0, i32T), i32T),
          body: [],
        },
      ],
    ],
    ['a discard', [{ s: 'discard' }]],
    ['a return', [{ s: 'return', expr: p('a') }]],
    [
      'an integer division by a variable',
      [set('n', bin('/', v('n', i32T), v('n', i32T), i32T), i32T)],
    ],
    ['an integer division by zero', [set('n', bin('/', v('n', i32T), lit(0, i32T), i32T), i32T)]],
    ['seven statements', Array.from({ length: 7 }, () => set('x', bin('+', v('x'), lit(1))))],
    [
      'a costly value',
      [set('x', call('sqrt', [call('sin', [call('cos', [call('exp', [p('a')])])])]))],
    ],
  ];
  it.each(cases)('leaves an if that holds %s', (_name, arm) => {
    const m = moduleOf([
      decl('n', lit(1, i32T), i32T),
      decl('w', { op: 'construct', type: vec3fT, args: [p('a'), p('b'), p('c')] }, vec3fT),
      ...withVars(when(arm)),
    ]);
    stays(m);
  });

  it('converts an inner if and leaves the outer if that holds it', () => {
    const m = moduleOf(withVars(when([when([set('x', p('c'))]), set('y', p('c'))])));
    const out = ifConvert(m);
    expect(ifs(out)).toBe(1);
    sameValues(m, out);
  });

  it('leaves an if on a struct, a matrix and an array local', () => {
    const types: ShaderType[] = [
      { kind: 'struct', name: 'S' },
      { kind: 'mat', cols: 2, rows: 2, elem: 'f32' },
      { kind: 'array', elem: f32T, size: 2 },
    ];
    for (const type of types) {
      const m = moduleOf(
        withVars(
          decl('s', undefined, type),
          when([set('s', v('s', type), type)], [set('s', v('s', type), type)]),
        ),
      );
      stays(m);
    }
  });

  it('leaves an else-if chain', () => {
    const m = moduleOf(
      withVars({
        s: 'if',
        arms: [
          { cond: gt(p('a'), p('b')), body: [set('x', p('c'))] },
          { cond: gt(p('b'), p('c')), body: [set('x', p('b'))] },
        ],
      }),
    );
    stays(m);
  });

  it('leaves an if that leaves a local without an initializer in one arm', () => {
    const m = moduleOf([
      decl('t'),
      decl('x', p('a')),
      decl('y', p('b')),
      when([set('t', p('a'))]),
      { s: 'return', expr: bin('+', v('x'), v('t')) },
    ]);
    stays(m);
  });

  it('is idempotent', () => {
    const m = moduleOf(withVars(when([set('x', p('b')), set('y', p('a'))])));
    const once = ifConvert(m);
    expect(ifConvert(once)).toEqual(once);
  });
});
