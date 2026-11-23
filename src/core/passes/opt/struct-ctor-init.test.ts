import { describe, expect, it } from 'vitest';
import { structCtor } from './index.js';
import { f32T, structT } from '../../ir/index.js';
import type { Expr, FuncDecl, ModuleDecl, ShaderType, Stmt } from '../../ir/index.js';
import { compileModule } from '../../oracle.js';

const PT = structT('P');
const QT = structT('Q');
const structs = [
  {
    name: 'P',
    fields: [
      { name: 'a', type: f32T },
      { name: 'b', type: f32T },
    ],
  },
  {
    name: 'Q',
    fields: [
      { name: 'p', type: PT },
      { name: 'k', type: f32T },
    ],
  },
];

const lit = (value: number): Expr => ({ op: 'lit', type: f32T, value });
const ref = (name: string, type: ShaderType = f32T): Expr => ({ op: 'varref', type, name });
const x = (): Expr => ({ op: 'param', type: f32T, name: 'x' });
const add = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: f32T, bop: '+', a, b });
const mul = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: f32T, bop: '*', a, b });
const ctor = (type: ShaderType, ...args: Expr[]): Expr => ({ op: 'construct', type, args });
const field = (name: string, type: ShaderType, fld: string, ft: ShaderType = f32T): Expr => ({
  op: 'member',
  type: ft,
  base: ref(name, type),
  field: fld,
});
const decl = (name: string, type: ShaderType, init?: Expr): Stmt => ({
  s: 'var',
  name,
  type,
  init,
});
const letOf = (name: string, expr: Expr): Stmt => ({ s: 'let', name, expr });
const set = (name: string, type: ShaderType, fld: string, expr: Expr, ft?: ShaderType): Stmt => ({
  s: 'assign',
  target: field(name, type, fld, ft),
  expr,
});
const ret = (expr: Expr): Stmt => ({ s: 'return', expr });
const effect = (): Expr => ({ op: 'call', type: f32T, fn: 'pushCount', args: [] });

const mod = (body: Stmt[], retType: ShaderType = f32T, extra: FuncDecl[] = []): ModuleDecl => ({
  consts: [],
  structs,
  bindings: [],
  funcs: [...extra, { name: 'f', params: [{ name: 'x', type: f32T }], ret: retType, body }],
});

const bodyOf = (m: ModuleDecl): readonly Stmt[] => m.funcs.find((f) => f.name === 'f')!.body;
const writesOf = (m: ModuleDecl): number => bodyOf(m).filter((s) => s.s === 'assign').length;
const sameValue = (m: ModuleDecl): void => {
  const out = structCtor(m);
  for (const v of [-1, 0, 0.5, 3, 1e6])
    expect(compileModule(out).fns.f!(v)).toEqual(compileModule(m).fns.f!(v));
};
const declOf = (m: ModuleDecl, name: string): Stmt | undefined =>
  bodyOf(m).find((s) => s.s === 'var' && s.name === name);

const readP = (name: string): Expr => add(field(name, PT, 'a'), mul(lit(2), field(name, PT, 'b')));

describe('structCtor: a var with a constructor initializer', () => {
  it('folds the field writes into the initializer and keeps the declaration', () => {
    const m = mod([
      decl('v', PT, ctor(PT, lit(0), lit(0))),
      set('v', PT, 'a', add(x(), lit(1))),
      set('v', PT, 'b', mul(x(), lit(3))),
      ret(readP('v')),
    ]);
    const out = structCtor(m);
    expect(writesOf(out)).toBe(0);
    expect(declOf(out, 'v')).toMatchObject({
      s: 'var',
      init: { op: 'construct', args: [{ bop: '+' }, { bop: '*' }] },
    });
    sameValue(m);
  });

  it('keeps the initializer argument of a field that is not written', () => {
    const m = mod([
      decl('v', PT, ctor(PT, x(), lit(7))),
      set('v', PT, 'b', add(x(), lit(1))),
      ret(readP('v')),
    ]);
    const out = structCtor(m);
    expect(declOf(out, 'v')).toMatchObject({
      init: { op: 'construct', args: [{ op: 'param' }, { op: 'binop' }] },
    });
    sameValue(m);
  });

  it('resolves an initializer that is a name bound to a constructor', () => {
    const zero = ctor(PT, lit(0), lit(0));
    for (const bind of [decl('z', PT, zero), letOf('z', zero)]) {
      const m = mod([bind, decl('v', PT, ref('z', PT)), set('v', PT, 'a', x()), ret(readP('v'))]);
      const out = structCtor(m);
      expect(writesOf(out)).toBe(0);
      expect(declOf(out, 'v')).toMatchObject({
        init: { op: 'construct', args: [{ op: 'param' }, { op: 'lit', value: 0 }] },
      });
      sameValue(m);
    }
  });

  it('folds a var without initializer when every field is written, and the later use stays', () => {
    const m = mod([
      decl('v', PT),
      set('v', PT, 'b', x()),
      set('v', PT, 'a', lit(2)),
      decl('w', PT, ref('v', PT)),
      ret(readP('w')),
    ]);
    const out = structCtor(m);
    expect(writesOf(out)).toBe(0);
    expect(declOf(out, 'v')).toMatchObject({
      init: { op: 'construct', args: [{ value: 2 }, { op: 'param' }] },
    });
    sameValue(m);
  });

  it('folds a nested struct and then the outer one that takes it by a field write', () => {
    const m = mod(
      [
        decl('q', QT, ctor(QT, ctor(PT, lit(0), lit(0)), lit(0))),
        decl('p', PT, ctor(PT, lit(0), lit(0))),
        set('p', PT, 'a', x()),
        set('p', PT, 'b', add(x(), lit(1))),
        set('q', QT, 'p', ref('p', PT), PT),
        set('q', QT, 'k', lit(5)),
        ret(add(field('q', QT, 'k'), readP('p'))),
      ],
      f32T,
    );
    const out = structCtor(m);
    expect(writesOf(out)).toBe(0);
    expect(bodyOf(out).filter((s) => s.s === 'var')).toHaveLength(2);
    expect(declOf(out, 'q')).toMatchObject({
      init: { op: 'construct', args: [{ op: 'varref', name: 'p' }, { value: 5 }] },
    });
    sameValue(m);
  });

  it('lets declarations sit between the writes', () => {
    const m = mod([
      decl('v', PT, ctor(PT, lit(0), lit(0))),
      set('v', PT, 'a', x()),
      letOf('t', add(x(), lit(2))),
      set('v', PT, 'b', ref('t')),
      ret(readP('v')),
    ]);
    const out = structCtor(m);
    expect(writesOf(out)).toBe(0);
    expect(bodyOf(out).map((s) => s.s)).toEqual(['let', 'var', 'return']);
    sameValue(m);
  });

  it('is idempotent', () => {
    const m = mod([
      decl('v', PT, ctor(PT, lit(0), lit(0))),
      set('v', PT, 'a', x()),
      set('v', PT, 'b', lit(1)),
      ret(readP('v')),
    ]);
    const once = structCtor(m);
    expect(structCtor(once)).toEqual(once);
  });

  it('turns var + return of a constructor into the returned constructor', () => {
    const m = mod([decl('v', PT, ctor(PT, x(), lit(1))), ret(ref('v', PT))], PT);
    const out = structCtor(m);
    expect(bodyOf(out)).toHaveLength(1);
    expect(bodyOf(out)[0]).toMatchObject({ s: 'return', expr: { op: 'construct' } });
  });
});

describe('structCtor: what the fold leaves as written', () => {
  const keeps = (body: Stmt[], extra: FuncDecl[] = []): void => {
    const m = mod(body, f32T, extra);
    expect(structCtor(m)).toEqual(m);
  };

  const stopsAfterFirst = (body: Stmt[]): void => {
    const m = mod(body);
    const out = structCtor(m);
    expect(writesOf(out)).toBe(1);
    expect(declOf(out, 'v')).toMatchObject({ init: { args: [{ op: 'param' }, { value: 0 }] } });
    sameValue(m);
  };

  it('stops the run at a read of the aggregate', () => {
    stopsAfterFirst([
      decl('v', PT, ctor(PT, lit(0), lit(0))),
      set('v', PT, 'a', x()),
      letOf('t', field('v', PT, 'a')),
      set('v', PT, 'b', ref('t')),
      ret(readP('v')),
    ]);
  });

  it('stops the run at a write whose value reads the aggregate', () => {
    stopsAfterFirst([
      decl('v', PT, ctor(PT, lit(0), lit(0))),
      set('v', PT, 'a', x()),
      set('v', PT, 'b', add(field('v', PT, 'a'), lit(1))),
      ret(readP('v')),
    ]);
  });

  it('keeps an aggregate whose address is taken by an inout argument', () => {
    const h: FuncDecl = {
      name: 'h',
      params: [{ name: 'p', type: PT, mode: 'inout' }],
      ret: { kind: 'void' } as ShaderType,
      body: [],
    };
    const callH = (arg: Expr): Stmt => ({
      s: 'call',
      expr: { op: 'call', type: { kind: 'void' } as ShaderType, fn: 'h', args: [arg] },
    });
    keeps(
      [
        decl('v', PT, ctor(PT, lit(0), lit(0))),
        callH(ref('v', PT)),
        set('v', PT, 'a', x()),
        ret(readP('v')),
      ],
      [h],
    );
    keeps(
      [
        decl('z', PT, ctor(PT, lit(0), lit(0))),
        decl('v', PT, ref('z', PT)),
        callH(ref('z', PT)),
        set('v', PT, 'a', x()),
        ret(readP('v')),
      ],
      [h],
    );
  });

  it('keeps a write inside a branch or a loop', () => {
    keeps([
      decl('v', PT, ctor(PT, lit(0), lit(0))),
      {
        s: 'if',
        arms: [
          {
            cond: {
              op: 'compare',
              type: { kind: 'scalar', scalar: 'bool' },
              cop: '>',
              a: x(),
              b: lit(0),
            },
            body: [set('v', PT, 'a', x())],
          },
        ],
      },
      ret(readP('v')),
    ]);
    keeps([
      decl('v', PT, ctor(PT, lit(0), lit(0))),
      {
        s: 'for',
        init: decl(
          'i',
          { kind: 'scalar', scalar: 'i32' },
          {
            op: 'lit',
            type: { kind: 'scalar', scalar: 'i32' },
            value: 0,
          },
        ),
        cond: {
          op: 'compare',
          type: { kind: 'scalar', scalar: 'bool' },
          cop: '<',
          a: ref('i', { kind: 'scalar', scalar: 'i32' }),
          b: { op: 'lit', type: { kind: 'scalar', scalar: 'i32' }, value: 3 },
        },
        update: {
          s: 'assign',
          target: ref('i', { kind: 'scalar', scalar: 'i32' }),
          expr: {
            op: 'binop',
            type: { kind: 'scalar', scalar: 'i32' },
            bop: '+',
            a: ref('i', { kind: 'scalar', scalar: 'i32' }),
            b: { op: 'lit', type: { kind: 'scalar', scalar: 'i32' }, value: 1 },
          },
        },
        body: [set('v', PT, 'a', x())],
      },
      ret(readP('v')),
    ]);
  });

  it('keeps a statement between the aggregate and its writes that is not a declaration', () => {
    keeps([
      decl('v', PT, ctor(PT, lit(0), lit(0))),
      decl('m', f32T, lit(0)),
      { s: 'assign', target: ref('m'), expr: x() },
      set('v', PT, 'a', ref('m')),
      ret(readP('v')),
    ]);
  });

  it('keeps writes with an effect, which a constructor would reorder', () => {
    keeps([
      decl('v', PT, ctor(PT, lit(0), lit(0))),
      set('v', PT, 'b', effect()),
      set('v', PT, 'a', effect()),
      ret(readP('v')),
    ]);
  });

  it('keeps an initializer argument with an effect', () => {
    keeps([decl('v', PT, ctor(PT, effect(), lit(0))), set('v', PT, 'a', x()), ret(readP('v'))]);
  });

  it('keeps a partial write of an uninitialised aggregate', () => {
    keeps([decl('v', PT), set('v', PT, 'a', x()), ret(field('v', PT, 'a'))]);
  });

  it('keeps a field written twice past the first write', () => {
    const m = mod([
      decl('v', PT, ctor(PT, lit(0), lit(0))),
      set('v', PT, 'a', x()),
      set('v', PT, 'a', lit(2)),
      ret(readP('v')),
    ]);
    const out = structCtor(m);
    expect(writesOf(out)).toBe(1);
    sameValue(m);
  });

  it('keeps a name bound to a constructor that is written later', () => {
    keeps([
      decl('z', PT, ctor(PT, lit(0), lit(0))),
      decl('v', PT, ref('z', PT)),
      set('z', PT, 'a', lit(9)),
      set('v', PT, 'a', x()),
      ret(readP('v')),
    ]);
  });
});
