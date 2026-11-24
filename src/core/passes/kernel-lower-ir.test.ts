import { describe, expect, it } from 'vitest';
import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/nodes.js';
import type { ShaderType } from '../ir/types.js';
import { f32T, i32T, u32T, voidT } from '../ir/types.js';
import {
  atomicArray,
  declaredNames,
  entryRewrite,
  iterationOf,
  mapBlock,
  mapStmt,
  placeRoot,
  rangeOf,
  spellArrayBindings,
  SUBGROUP_FOLD_OF,
  writesThroughCall,
  type ForStmt,
  type LoopCtx,
} from './kernel-lower-ir.js';

const u32Array: ShaderType = { kind: 'array', elem: u32T };
const lit = (value: number, type: ShaderType = u32T): Expr => ({ op: 'lit', type, value });
const ref = (name: string, type: ShaderType = u32T): Expr => ({ op: 'varref', type, name });
const param = (name: string, type: ShaderType = u32T): Expr => ({ op: 'param', type, name });
const idx = (base: Expr, i: Expr): Expr => ({ op: 'index', type: u32T, base, idx: i });
const emptyModule: ModuleDecl = { consts: [], structs: [], bindings: [], funcs: [] };

const loopOver = (body: Stmt[], cond?: Expr, step = 1): ForStmt => ({
  s: 'for',
  init: { s: 'var', name: 'i', type: u32T, init: lit(0) },
  cond: cond ?? { op: 'compare', type: u32T, cop: '<', a: ref('i'), b: param('n') },
  update: { s: 'assign', target: ref('i'), expr: lit(1) },
  counted: { name: 'i', op: step > 0 ? 'add' : 'sub', step },
  body,
});

const ctx = (over: Partial<LoopCtx> & { loop: ForStmt }): LoopCtx => ({
  f: { name: 'f', params: [], ret: voidT, body: [], kernel: true },
  wg: 64,
  j: 0,
  counter: 'i',
  counterType: u32T,
  step: 1,
  prelude: [],
  scalars: ['n'],
  arrays: ['out'],
  argsBinding: '_args',
  argsStruct: 'Args',
  scatter: new Set(),
  bindingNames: new Map(),
  skip: false,
  ...over,
});

describe('spellArrayBindings', () => {
  const reserved = (n: string): boolean => n === 'a' || n === 'a_' || n === 'b';

  it('leaves a name the target does not reserve out of the map', () => {
    expect(spellArrayBindings(['free'], new Set(), reserved).size).toBe(0);
  });

  it('spells a reserved name with a trailing underscore', () => {
    const out = spellArrayBindings(['b'], new Set(), reserved);
    expect(out.get('b')).toBe('b_');
  });

  it('numbers the spelling when the underscore form is reserved too', () => {
    const out = spellArrayBindings(['a'], new Set(), reserved);
    expect(out.get('a')).toBe('a_1');
  });

  it('skips a spelling the module declares', () => {
    const out = spellArrayBindings(['b'], new Set(['b_', 'b_1']), reserved);
    expect(out.get('b')).toBe('b_2');
  });

  it('gives two parameters spellings that differ from each other', () => {
    const both = (n: string): boolean => n === 'x' || n === 'x_';
    const out = spellArrayBindings(['x', 'x_'], new Set(), both);
    expect(out.get('x')).toBe('x_1');
    expect(out.get('x_')).toBe('x__');
    expect(new Set(out.values()).size).toBe(2);
  });
});

describe('declaredNames', () => {
  it('lists every declared function, struct, field, value, parameter and local', () => {
    const nested: Stmt = {
      s: 'if',
      arms: [
        {
          cond: lit(1, { kind: 'scalar', scalar: 'bool' }),
          body: [{ s: 'let', name: 'deep', expr: lit(1) }],
        },
      ],
    };
    const fn: FuncDecl = {
      name: 'fn0',
      params: [{ name: 'p0', type: u32T }],
      ret: voidT,
      body: [{ s: 'var', name: 'local0', type: u32T, init: lit(0) }, nested],
    };
    const m: ModuleDecl = {
      consts: [{ name: 'c0', type: u32T, init: lit(1) }],
      structs: [{ name: 'S0', fields: [{ name: 'fld0', type: u32T }] }],
      bindings: [{ name: 'bind0' }],
      funcs: [fn],
      vars: [{ name: 'v0' }],
      overrides: [{ name: 'o0' }],
    } as unknown as ModuleDecl;
    const names = declaredNames(m);
    for (const n of ['c0', 'S0', 'fld0', 'bind0', 'fn0', 'p0', 'local0', 'deep', 'v0', 'o0'])
      expect(names.has(n), n).toBe(true);
    expect(names.size).toBe(10);
  });

  it('is empty for an empty module', () => {
    expect(declaredNames(emptyModule).size).toBe(0);
  });
});

describe('entryRewrite', () => {
  const loop = loopOver([]);
  const base = ctx({ loop, bindingNames: new Map([['out', 'out_']]) });

  it('reads a scalar parameter as a field of the uniform', () => {
    expect(entryRewrite(base)(param('n'))).toEqual({
      op: 'member',
      type: u32T,
      base: { op: 'varref', type: { kind: 'struct', name: 'Args' }, name: '_args' },
      field: 'n',
    });
  });

  it('reads an array parameter as the binding of its emitted name', () => {
    expect(entryRewrite(base)(param('out', u32Array))).toEqual(ref('out_', u32Array));
  });

  it('keeps the authored name when no binding name is recorded', () => {
    const plain = ctx({ loop });
    expect(entryRewrite(plain)(param('out', u32Array))).toEqual(ref('out', u32Array));
  });

  it('leaves other parameters alone and rewrites inside expressions', () => {
    const other = param('other');
    expect(entryRewrite(base)(other)).toEqual(other);
    const e: Expr = { op: 'binop', type: u32T, bop: '+', a: param('n'), b: other };
    const out = entryRewrite(base)(e) as Expr & { op: 'binop' };
    expect(out.a.op).toBe('member');
    expect(out.b).toEqual(other);
  });

  it('reads the length of a pushed array from its length word', () => {
    const words = new Map([['out', { array: 'out', binding: 'lenBuf', field: '_w0', loops: [0] }]]);
    const pushCount: Expr = {
      op: 'call',
      type: u32T,
      fn: 'pushCount',
      args: [param('out', u32Array)],
    };
    const out = entryRewrite(ctx({ loop, words: words as LoopCtx['words'] }))(pushCount);
    expect(out).toEqual({
      op: 'index',
      type: u32T,
      base: ref('lenBuf', u32Array),
      idx: {
        op: 'member',
        type: u32T,
        base: ref('_args', { kind: 'struct', name: 'Args' }),
        field: '_w0',
      },
    });
  });

  it('keeps the length call of an array without a word', () => {
    const pushCount: Expr = {
      op: 'call',
      type: u32T,
      fn: 'pushCount',
      args: [param('out', u32Array)],
    };
    const out = entryRewrite(base)(pushCount) as Expr & { op: 'call' };
    expect(out.fn).toBe('pushCount');
    expect(out.args[0]).toEqual(ref('out_', u32Array));
  });
});

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
