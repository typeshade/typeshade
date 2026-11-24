import { describe, expect, it } from 'vitest';
import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/nodes.js';
import { u32T, voidT } from '../ir/types.js';
import {
  declaredNames,
  entryRewrite,
  spellArrayBindings,
  type LoopCtx,
} from './kernel-lower-ir.js';
import {
  ctx,
  emptyModule,
  lit,
  loopOver,
  param,
  ref,
  u32Array,
} from './kernel-lower-ir-fixtures.js';

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
