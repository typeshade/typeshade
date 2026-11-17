import { describe, expect, it } from 'vitest';
import { boolT, f32T, i32T, type Expr, type Stmt } from '../../../ir/index.js';
import { bodyHasRaw, mapStmtValue } from './statements.js';

const flag = (name: string): Expr => ({ op: 'varref', type: boolT, name });
const raw: Stmt = { s: 'raw', wgsl: 'let z = 1.0;' };

describe('mapStmtValue', () => {
  it('rewrites the first condition of an if and leaves every else-if condition alone', () => {
    const chain: Stmt = {
      s: 'if',
      arms: [
        { cond: flag('a'), body: [] },
        { cond: flag('b'), body: [] },
      ],
    };
    const seen: string[] = [];
    mapStmtValue(chain, (e) => {
      if (e.op === 'varref') seen.push(e.name);
      return e;
    });
    expect(seen).toEqual(['a']);
  });
});

describe('bodyHasRaw', () => {
  it('finds a raw statement inside a for', () => {
    const loop: Stmt = {
      s: 'for',
      init: { s: 'var', name: 'i', type: i32T, init: { op: 'lit', type: i32T, value: 0 } },
      cond: flag('go'),
      update: {
        s: 'assign',
        target: { op: 'varref', type: i32T, name: 'i' },
        expr: { op: 'lit', type: i32T, value: 1 },
      },
      body: [raw],
    };
    expect(bodyHasRaw([loop])).toBe(true);
  });

  it('finds a raw statement inside a case of a switch', () => {
    const sw: Stmt = {
      s: 'switch',
      scrut: { op: 'lit', type: i32T, value: 0 },
      cases: [{ values: [0], body: [raw] }],
    };
    expect(bodyHasRaw([sw])).toBe(true);
    expect(bodyHasRaw([{ s: 'return', expr: { op: 'lit', type: f32T, value: 0 } }])).toBe(false);
  });
});
