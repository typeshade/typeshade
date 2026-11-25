import { describe, it, expect } from 'vitest';
import {
  module,
  f64T,
  f32T,
  i32T,
  u32T,
  boolT,
  vec3f64T,
  type Expr,
  type ModuleDecl,
  type ShaderType,
} from '../ir/index.js';
import { fp64Lower } from './fp64-lower.js';

const param = (name: string, type: ShaderType): Expr => ({ op: 'param', type, name });
const lit = (type: ShaderType, value: number): Expr => ({ op: 'lit', type, value });
const call = (name: string, type: ShaderType, ...args: Expr[]): Expr => ({
  op: 'call',
  type,
  fn: name,
  args,
});
const times = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: a.type, bop: '*', a, b });
const plus = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: a.type, bop: '+', a, b });
const f64Param = (name: string): Expr => param(name, f64T);

const rawModule = (
  params: readonly [string, ShaderType][],
  expr: Expr,
  extra: Partial<ModuleDecl> = {},
): ModuleDecl => ({
  ...module({
    consts: [{ name: 'KD', type: f64T, wgslValue: 0, cpuValue: 1e38 }],
    funcs: [
      {
        name: 'k',
        params: params.map(([name, type]) => ({ name, type })),
        ret: expr.type,
        body: [{ s: 'return', expr }],
      },
      {
        name: 'inner',
        params: [{ name: 'x', type: f64T }],
        ret: f64T,
        body: [{ s: 'return', expr: f64Param('x') }],
      },
      {
        name: 'ifn',
        params: [],
        ret: i32T,
        body: [{ s: 'return', expr: lit(i32T, 1) }],
      },
    ],
  }),
  ...extra,
});

const returned = (m: ModuleDecl): Expr => {
  const k = fp64Lower(m).funcs.find((f) => f.name === 'k')!;
  const last = k.body.at(-1)!;
  if (last.s !== 'return' || last.expr === undefined) throw new Error('k does not return');
  return last.expr;
};

const isScaled = (e: Expr): boolean => e.op === 'binop' && e.bop === '*' && e.b.op === 'lit';
const isProduct = (e: Expr): boolean => e.op === 'call' && /^df64_(v\d_)?mul$/.test(e.fn);

const scaledBy = (operand: Expr, s: number, params: readonly [string, ShaderType][] = []) =>
  returned(rawModule([['a', f64T], ['b', f64T], ...params], times(operand, lit(f64T, s))));

const sum = (): Expr => plus(f64Param('a'), f64Param('b'));

describe('what counts as a run-time operand of a growing scale', () => {
  it('a helper output, a module function call and a call with a run-time argument do', () => {
    expect(isScaled(scaledBy(sum(), 4))).toBe(true);
    expect(isScaled(scaledBy(call('inner', f64T, f64Param('a')), 4))).toBe(true);
    expect(isScaled(scaledBy(call('hostFn', f64T, sum()), 4))).toBe(true);
    expect(isProduct(scaledBy(call('hostFn', f64T, f64Param('a')), 4))).toBe(true);
  });

  it('a negation or a scaling of a run-time operand does', () => {
    expect(isScaled(scaledBy({ op: 'unop', type: f64T, a: sum() }, 4))).toBe(true);
    expect(isScaled(scaledBy(times(sum(), lit(f64T, 2)), 4))).toBe(true);
    expect(isProduct(scaledBy({ op: 'unop', type: f64T, a: f64Param('a') }, 4))).toBe(true);
  });

  it('a constructor does when one of its words is run-time', () => {
    const word = call('inner', f64T, f64Param('a'));
    const runtime = call('f64FromParts', f64T, call('hostWord', f32T, word), lit(f32T, 0));
    const constant = call('f64FromParts', f64T, lit(f32T, 1), lit(f32T, 0));
    expect(isScaled(scaledBy(runtime, 4))).toBe(true);
    expect(isProduct(scaledBy(constant, 4))).toBe(true);
  });

  it('an integer product does not, because i * 0 drops its operand', () => {
    const integer = times(call('ifn', i32T), lit(i32T, 0));
    const pair = call('f64FromParts', f64T, integer, lit(f32T, 0));
    expect(isProduct(scaledBy(pair, 4))).toBe(true);
  });

  it('a select does only when both arms do', () => {
    const arms = (ifFalse: Expr): Expr => ({
      op: 'select',
      type: f64T,
      cond: lit(boolT, 1),
      ifTrue: sum(),
      ifFalse,
    });
    expect(isScaled(scaledBy(arms(call('inner', f64T, f64Param('a'))), 4))).toBe(true);
    expect(isProduct(scaledBy(arms(f64Param('a')), 4))).toBe(true);
  });

  it('a scalar parameter or local is not proven, since a local bound to a literal becomes the literal', () => {
    const pair = (w: Expr): Expr => call('f64FromParts', f64T, w, lit(f32T, 0));
    expect(isProduct(scaledBy(pair(param('w', f32T)), 4, [['w', f32T]]))).toBe(true);
    const local: ModuleDecl = {
      ...rawModule([], lit(f64T, 0)),
      funcs: [
        {
          name: 'k',
          params: [],
          ret: f64T,
          body: [
            { s: 'let', name: 'w', expr: lit(f32T, 1e38) },
            {
              s: 'return',
              expr: times(pair({ op: 'varref', type: f32T, name: 'w' }), lit(f64T, 4)),
            },
          ],
        },
      ],
    };
    expect(isProduct(returned(local))).toBe(true);
  });

  it('a binding of a scalar type does', () => {
    const binding = { group: 0, binding: 0, name: 'g', space: 'uniform' as const, type: f64T };
    const operand: Expr = { op: 'varref', type: f64T, name: 'g' };
    const m = rawModule([], times(operand, lit(f64T, 4)), { bindings: [binding] });
    expect(isScaled(returned(m))).toBe(true);
  });
});

describe('the range and the identities of a power-of-two scale', () => {
  it('scales by 2^127 and refuses 2^128, over a run-time operand', () => {
    expect(isScaled(scaledBy(sum(), 2 ** 127))).toBe(true);
    expect(isProduct(scaledBy(sum(), 2 ** 128))).toBe(true);
  });

  it('scales by 2^-126 and refuses 2^-127', () => {
    expect(isScaled(scaledBy(f64Param('a'), 2 ** -126))).toBe(true);
    expect(isProduct(scaledBy(f64Param('a'), 2 ** -127))).toBe(true);
  });

  it('a scale of 1 is the operand and a scale of -1 is its negation, even over a constant', () => {
    const constant = call('f64FromParts', f64T, lit(f32T, 1e38), lit(f32T, 0));
    expect(scaledBy(f64Param('a'), 1)).toEqual({ op: 'param', type: expect.anything(), name: 'a' });
    expect(scaledBy(constant, -1)).toMatchObject({ op: 'unop' });
    expect(scaledBy(constant, 0.5)).toMatchObject({ op: 'binop', bop: '*' });
  });

  it('a vec64 scale of -1 negates both planes', () => {
    const v = param('v', vec3f64T);
    const out = returned(rawModule([['v', vec3f64T]], times(v, lit(f64T, -1))));
    expect(out).toMatchObject({
      op: 'construct',
      args: [
        { op: 'unop', a: { op: 'member', field: 'hi' } },
        { op: 'unop', a: { op: 'member', field: 'lo' } },
      ],
    });
  });
});

describe('the vec64 planes that are named without computing', () => {
  const array: ShaderType = { kind: 'array', elem: vec3f64T, size: 4 };
  const scaledElement = (idx: Expr): Expr =>
    returned(
      rawModule(
        [
          ['xs', array],
          ['i', u32T],
        ],
        times({ op: 'index', type: vec3f64T, base: param('xs', array), idx }, lit(f64T, 2)),
      ),
    );

  it('names an element at a literal or a named index twice', () => {
    expect(scaledElement(lit(u32T, 2)).op).toBe('construct');
    expect(scaledElement(param('i', u32T)).op).toBe('construct');
  });

  it('keeps df64_vN_mul for an element at a computed index', () => {
    expect(isProduct(scaledElement(plus(param('i', u32T), lit(u32T, 1))))).toBe(true);
  });
});

describe('the planes of a vec64 scale', () => {
  const half = (operand: Expr, params: readonly [string, ShaderType][] = [], extra = {}): Expr =>
    returned(rawModule(params, times(operand, lit(f64T, 0.5)), extra));
  const planesScaled = (e: Expr): boolean =>
    e.op === 'construct' && e.args.length === 2 && e.args.every((a) => a.op === 'binop');

  it('scales the two arguments of a constructor where they stand', () => {
    const ctor: Expr = {
      op: 'construct',
      type: vec3f64T,
      args: [f64Param('a'), f64Param('b'), f64Param('a')],
    };
    expect(
      planesScaled(
        half(ctor, [
          ['a', f64T],
          ['b', f64T],
        ]),
      ),
    ).toBe(true);
  });

  it('scales a constant and a member of a named struct', () => {
    const constant: Expr = { op: 'constref', type: vec3f64T, name: 'KV' };
    const consts = [{ name: 'KV', type: vec3f64T, wgslValue: 0, cpuValue: 0 }];
    expect(planesScaled(half(constant, [], { consts }))).toBe(true);
    const S: ShaderType = { kind: 'struct', name: 'S' };
    const member: Expr = { op: 'member', type: vec3f64T, base: param('s', S), field: 'v' };
    expect(planesScaled(half(member, [['s', S]]))).toBe(true);
  });

  it('leaves a vector times one alone and keeps the helper for a growing scale over a constant', () => {
    const constant: Expr = { op: 'constref', type: vec3f64T, name: 'KV' };
    const consts = [{ name: 'KV', type: vec3f64T, wgslValue: 0, cpuValue: 0 }];
    const by = (s: number): Expr =>
      returned(rawModule([], times(constant, lit(f64T, s)), { consts }));
    expect(by(1)).toMatchObject({ op: 'constref', name: 'KV' });
    expect(isProduct(by(4))).toBe(true);
  });

  it('keeps the helper for a vector that a call computes', () => {
    const computed = call('inner3', vec3f64T, param('v', vec3f64T));
    expect(isProduct(half(computed, [['v', vec3f64T]]))).toBe(true);
  });

  it('does not scale the vector over which a literal is divided', () => {
    const quotient: Expr = {
      op: 'binop',
      type: vec3f64T,
      bop: '/',
      a: lit(f64T, 2),
      b: param('v', vec3f64T),
    };
    const out = returned(rawModule([['v', vec3f64T]], quotient));
    expect(out).toMatchObject({ op: 'call', fn: 'df64_v3_div' });
  });
});

describe('the square of an operand', () => {
  const bumpWritingModule = (): ModuleDecl => {
    const dst = {
      group: 0,
      binding: 0,
      name: 'dst',
      space: 'storage' as const,
      access: 'read_write' as const,
      type: { kind: 'array', elem: f32T } as ShaderType,
    };
    const store: Expr = {
      op: 'index',
      type: f32T,
      base: { op: 'varref', type: dst.type, name: 'dst' },
      idx: lit(u32T, 0),
    };
    const base = rawModule([['a', f64T]], lit(f32T, 0));
    return {
      ...base,
      bindings: [dst],
      funcs: [
        ...base.funcs,
        {
          name: 'bump',
          params: [{ name: 'x', type: f64T }],
          ret: f64T,
          body: [
            { s: 'assign', target: store, expr: lit(f32T, 1) },
            { s: 'return', expr: f64Param('x') },
          ],
        },
      ],
    };
  };
  const squareOf = (operand: Expr, m: ModuleDecl): Expr =>
    returned({
      ...m,
      funcs: [
        {
          name: 'k',
          params: [{ name: 'a', type: f64T }],
          ret: f64T,
          body: [{ s: 'return', expr: times(operand, operand) }],
        },
        ...m.funcs.filter((f) => f.name !== 'k'),
      ],
    });

  it('squares an operand that has no effect and multiplies one that writes', () => {
    const m = bumpWritingModule();
    expect(squareOf(call('inner', f64T, f64Param('a')), m)).toMatchObject({ fn: 'df64_sqr' });
    expect(squareOf(call('bump', f64T, f64Param('a')), m)).toMatchObject({ fn: 'df64_mul' });
  });

  it('multiplies two f32 operands that the pass widens, and refuses an integer literal scale', () => {
    const x = param('x', f32T);
    const widened = returned(rawModule([['x', f32T]], { ...times(x, x), type: f64T }));
    expect(widened).toMatchObject({ op: 'call', fn: 'df64_mul' });
    const integerScale = times(f64Param('a'), lit(i32T, 0.5));
    expect(() => returned(rawModule([['a', f64T]], integerScale))).toThrow(/SD0041/);
  });

  it('multiplies a pair by an operand that merely has the same key and another type', () => {
    const wide = call('hostFn', f64T);
    const narrow = call('hostFn', f32T);
    expect(returned(rawModule([], times(wide, narrow)))).toMatchObject({ fn: 'df64_mul' });
  });
});
