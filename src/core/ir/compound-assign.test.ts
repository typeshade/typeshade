import { describe, it, expect } from 'vitest';
import { fn, module, Var, Loop, f32, f32T, u32T, vec3, vec3fT } from './index.js';
import { emitModule } from '../backends/wgsl.js';
import { emitGlslModule } from '../backends/glsl.js';
import { compileModule } from '../oracle.js';

// ═══ #8 S2 — compound assignment ═══
//
// `acc.assign(acc.add(x))` and the `"use typeshade"` surface's `acc += x` mean the same thing
// and made two different IRs and two different texts: an `assign` holding a binop against an
// `assignOp`. That is a hole under the claim that `fn()` is the IR equivalence oracle for the
// source compiler — the two surfaces could not meet on the one statement every shader writes.
//
// The four methods build the `assignOp` statement, which both writers and the CPU oracle have
// always handled (it is what the source compiler already emits). The long spelling keeps its
// own emit: this is a second statement, not a rewrite of the first.

const emitOf = (build: () => void): string =>
  emitModule(module({ funcs: [fn('f', { x: f32T }, f32T, () => (build(), f32(0)))] }));

describe('#8 S2 — addAssign / subAssign / mulAssign / divAssign', () => {
  it('emit the compound statement, not an assign holding a binop', () => {
    const f = fn('f', { x: f32T }, f32T, ({ x }) => {
      const acc = Var('acc', f32(0));
      acc.addAssign(x);
      return acc;
    });
    expect(f.decl.body[1]).toMatchObject({ s: 'assignOp', bop: '+' });
    expect(emitModule(module({ funcs: [f] }))).toContain('acc += x;');
  });

  it('cover all four operators on both writers', () => {
    const f = fn('f', { x: f32T }, f32T, ({ x }) => {
      const acc = Var('acc', f32(1));
      acc.addAssign(x);
      acc.subAssign(x);
      acc.mulAssign(x);
      acc.divAssign(x);
      return acc;
    });
    const wgsl = emitModule(module({ funcs: [f] }));
    for (const op of ['+=', '-=', '*=', '/=']) expect(wgsl).toContain(`acc ${op} x;`);
    const glsl = emitGlslModule(module({ funcs: [f] }));
    for (const op of ['+=', '-=', '*=', '/=']) expect(glsl).toContain(`acc ${op} x;`);
  });

  it('mean what they say on the CPU oracle', () => {
    const m = module({
      funcs: [
        fn('f', { x: f32T }, f32T, ({ x }) => {
          const acc = Var('acc', f32(10));
          acc.addAssign(x); // 12
          acc.mulAssign(3); // 36
          acc.subAssign(6); // 30
          acc.divAssign(x); // 15
          return acc;
        }),
      ],
    });
    expect(compileModule(m).fns.f!(2)).toBe(15);
  });

  it('take the receiver typed lift, so a u32 accumulator gets a u32 literal', () => {
    const f = fn('f', { n: u32T }, u32T, ({ n }) => {
      const acc = Var('acc', n);
      acc.addAssign(1);
      return acc;
    });
    expect(emitModule(module({ funcs: [f] }))).toContain('acc += 1u;');
  });

  it('broadcast a scalar over a vector receiver, as .add does', () => {
    const f = fn('f', { x: f32T }, vec3fT, ({ x }) => {
      const c = Var('c', vec3(0, 0, 0));
      c.mulAssign(x);
      return c;
    });
    expect(emitModule(module({ funcs: [f] }))).toContain('c *= x;');
  });

  it('leave the assign(add(...)) spelling exactly as it was', () => {
    // The long form is what every golden in the tree is written in; it must keep its own text.
    const long = emitOf(() => {
      const acc = Var('acc', f32(0));
      acc.assign(acc.add(1));
    });
    expect(long).toContain('acc = (acc + 1.0);');
    expect(long).not.toContain('+=');
  });

  it('read as the loop accumulator they exist for', () => {
    const f = fn('f', {}, f32T, () => {
      const acc = Var('acc', f32(0));
      Loop(8, (i) => {
        acc.addAssign(i.f32());
      });
      return acc;
    });
    expect(emitModule(module({ funcs: [f] }))).toContain('acc += f32(_v0);');
    expect(compileModule(module({ funcs: [f] })).fns.f!()).toBe(28);
  });
});
