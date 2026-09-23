// ═══ The span stripper must terminate on the graph it actually walks ═══

import { describe, expect, it } from 'vitest';
import { f32T, type FuncDecl } from '../ir/index.js';
import { stripSpans } from './strip-spans.js';

describe('stripSpans', () => {
  it('terminates on a self-recursive function reached through declRef', () => {
    // `declRef` points at the callee's FuncDecl, so a function that calls itself closes a
    // cycle in the object graph. `no-recursion` is a lint rule, not a structural guarantee,
    // and a hand-built FuncDecl need not have been linted at all — so termination cannot rest
    // on the graph being a DAG, and this used to recurse until the stack ran out.
    const decl = {
      name: 'loop',
      params: [{ name: 'x', type: f32T }],
      ret: f32T,
      body: [] as unknown[],
    } as unknown as FuncDecl;
    (decl as unknown as { body: unknown[] }).body = [
      {
        s: 'return',
        span: {
          file: 'a.ts',
          start: 0,
          length: 1,
          line: 0,
          character: 0,
          endLine: 0,
          endCharacter: 1,
        },
        expr: { op: 'call', type: f32T, fn: 'loop', args: [], declRef: decl },
      },
    ];

    const out = stripSpans(decl);
    expect(out.name).toBe('loop');
    const ret = out.body[0] as { span?: unknown; expr: { declRef: unknown } };
    expect(ret.span).toBeUndefined();
    // The cycle is preserved as a cycle rather than unrolled, so the copy is the same shape.
    expect(ret.expr.declRef).toBe(out);
  });

  it('shares a subtree in the copy when it was shared in the input', () => {
    const shared = { op: 'lit', type: f32T, value: 1 };
    const pair = { a: shared, b: shared };
    const out = stripSpans(pair);
    expect(out.a).toBe(out.b);
  });
});
