import { describe, expect, it } from 'vitest';
import { f32T, type Expr, type Stmt } from '../../../ir/index.js';
import { collectMutatedRoots } from './roots.js';

const write = (target: Expr): Stmt => ({
  s: 'assign',
  target,
  expr: { op: 'lit', type: f32T, value: 1 },
});

describe('collectMutatedRoots', () => {
  it('counts a write through a constref, as the front end spells a binding read', () => {
    const out = new Set<string>();
    collectMutatedRoots(
      [
        write({
          op: 'member',
          type: f32T,
          field: 'b',
          base: { op: 'constref', type: f32T, name: 'ps' },
        }),
      ],
      out,
    );
    expect([...out]).toEqual(['ps']);
  });
});
