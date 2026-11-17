import { describe, expect, it } from 'vitest';
import {
  constExpr,
  f32,
  f32T,
  fn,
  i32,
  i32T,
  module,
  toF32,
  type ConstDecl,
  type FuncDecl,
  type ModuleDecl,
  type Stmt,
} from '../../../ir/index.js';
import { compileModule } from '../../../oracle.js';
import { unrollLoops } from '../unroll.js';

function forCount(m: ModuleDecl): number {
  let n = 0;
  const walk = (body: readonly Stmt[]): void => {
    for (const s of body) {
      if (s.s === 'for') {
        n++;
        walk(s.body);
      } else if (s.s === 'if') {
        for (const a of s.arms) walk(a.body);
        if (s.elseBody) walk(s.elseBody);
      } else if (s.s === 'switch') {
        for (const c of s.cases) walk(c.body);
        if (s.defaultBody) walk(s.defaultBody);
      }
    }
  };
  for (const f of m.funcs) walk(f.body);
  return n;
}

const sameValues = (m: ModuleDecl): void => {
  const before = compileModule(m).fns.f!;
  const after = compileModule(unrollLoops(m)).fns.f!;
  for (const x of [0.5, -2, 3]) expect(after(x), `x=${x}`).toEqual(before(x));
};

describe('unroll guards', () => {
  it('reads a bound written on the left of the counter, as in 3 > i', () => {
    const m = module({
      funcs: [
        fn('f', { x: f32T }, f32T, ({ x }, b) => {
          const acc = b.var('acc', f32T, f32(0));
          b.forRange(
            'i',
            i32(0),
            (i) => i32(3).gt(i),
            (cb, i) => cb.addAssign(acc, x.mul(toF32(i))),
          );
          b.ret(acc);
        }),
      ],
    });
    expect(forCount(unrollLoops(m))).toBe(0);
    expect(compileModule(unrollLoops(m)).fns.f!(2)).toBe(6);
    sameValues(m);
  });

  it('keeps a loop bounded by a constant the shader and the CPU read differently', () => {
    const sameOnBoth = constExpr('N', i32T, i32(3));
    const loop: FuncDecl = fn('f', { x: f32T }, f32T, ({ x }, b) => {
      const acc = b.var('acc', f32T, f32(0));
      b.forRange(
        'i',
        i32(0),
        (i) => i.lt(sameOnBoth.node),
        (cb, i) => cb.addAssign(acc, x.mul(toF32(i))),
      );
      b.ret(acc);
    });
    const agreed = module({ consts: [sameOnBoth], funcs: [loop] });
    expect(forCount(unrollLoops(agreed))).toBe(0);
    const differs: ConstDecl = { name: 'N', type: i32T, wgslValue: 3, cpuValue: 4 };
    const m: ModuleDecl = { ...agreed, consts: [differs] };
    expect(forCount(unrollLoops(m))).toBe(1);
  });

  it('unrolls a loop whose inner loop keeps a break of its own', () => {
    const m = module({
      funcs: [
        fn('f', { x: f32T, n: i32T }, f32T, ({ x, n }, b) => {
          const acc = b.var('acc', f32T, f32(0));
          b.forRange(
            'i',
            i32(0),
            (i) => i.lt(i32(3)),
            (outer, i) => {
              outer.forRange(
                'j',
                i32(0),
                (j) => j.lt(n),
                (inner, j) => {
                  inner.if(j.gt(i), (then) => then.break());
                  inner.addAssign(acc, x);
                },
              );
            },
          );
          b.ret(acc);
        }),
      ],
    });
    expect(forCount(m)).toBe(2);
    expect(forCount(unrollLoops(m))).toBe(3);
  });
});
