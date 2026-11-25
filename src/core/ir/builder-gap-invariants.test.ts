import { describe, expect, it } from 'vitest';
import { Switch, Var, externVar, f32, f32T, fn, module, typeKey, type Node } from './index.js';

describe('Switch', () => {
  it('takes an integer scrutinee and refuses an f32 one at tsc', () => {
    fn('s', {}, () => {
      const n = Var('n', f32(1));
      // @ts-expect-error switch is over i32 or u32 only
      Switch(n);
    });
    const f = fn('t', {}, () => {
      const n = Var('n', f32(1)) as unknown as Node<'u32'>;
      Switch(n).default(() => undefined);
    });
    expect(f.body.map((s) => s.s)).toEqual(['var', 'switch']);
  });
});

describe('Var with a name and a node', () => {
  it('declares a var of the node type, seeded by the node', () => {
    const f = fn('v', {}, () => {
      const n = Var('n', f32(1));
      expect(typeKey(n.type)).toBe('f32');
    });
    expect(f.body).toEqual([
      { s: 'var', name: 'n', type: f32T, init: expect.objectContaining({ op: 'lit', value: 1 }) },
    ]);
  });
});

describe('module externs', () => {
  it('carry a host global through externs, and leave the constants empty', () => {
    const e = externVar('hostTime', f32T);
    expect(module({ externs: [e.decl] })).toMatchObject({ consts: [], externs: [e.decl] });
    expect('externs' in module({})).toBe(false);
  });
});
