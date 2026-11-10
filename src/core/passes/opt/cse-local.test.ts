import { describe, expect, it } from 'vitest';
import {
  module,
  fn,
  f32,
  f32T,
  i32,
  u32,
  u32T,
  vec3fT,
  vec3,
  arrayLit,
  normalize,
  Var,
} from '../../ir/index.js';
import { emitModule } from '../../backends/wgsl.js';
import { emitGlslModule } from '../../backends/glsl.js';
import { compileModule } from '../../oracle.js';
import { structDecl, storageBuffer } from '../../sot.js';
import { cseLocal } from './cse-local.js';
import { compile } from '../../../compiler/ts/compile.js';

// cse-local hoists a subexpr that repeats WITHIN ONE statement and touches a local/var —
// the redundancy the fn-top `cse` (input-only, fn-top placement) cannot reach.

// A var read 3× through normalize() inside a single `return`: `v` is mutated, so fn-top
// cse skips it; without cse-local the normalize (a sqrt + 3 divides) emits 3×.
const repeatModule = () =>
  module({
    funcs: [
      fn('f', { x: f32T }, vec3fT, ({ x }, b) => {
        const v = Var(vec3(x, x.mul(2), x.mul(3)));
        v.assign(v.add(vec3(1, 1, 1))); // mutate → v is a var, not hoistable by fn-top cse
        const n = normalize(v);
        b.ret(vec3(n.x, n.y, n.z)); // 3× normalize(v) in one statement
      }),
    ],
  });

describe('cse-local — statement-local CSE', () => {
  it('collapses a var-touching repeat within one statement to a single temp', () => {
    const wgsl = emitModule(repeatModule());
    const body = wgsl.slice(wgsl.indexOf('fn f('));
    const calls = (body.match(/normalize\(/g) ?? []).length;
    expect(calls, `normalize should emit once, got ${calls}:\n${body}`).toBe(1);
    expect(body).toContain('_lc0'); // the hoisted statement-local temp
  });

  it('preserves oracle values (bit-equal before/after the pass)', () => {
    const m = repeatModule();
    const before = compileModule(m).fns.f;
    const after = compileModule(cseLocal(m)).fns.f;
    for (const x of [1, 2, 3.5, -4, 0.25]) {
      expect(after(x), `x=${x}`).toEqual(before(x));
    }
  });

  it('does NOT lift a repeat out of a short-circuit (||/&&) RHS', () => {
    // normalize(v) repeats only inside the short-circuited RHS of `||` — hoisting it
    // before the statement would evaluate it even when the LHS already decided the OR.
    const m = module({
      funcs: [
        fn('g', { x: f32T }, f32T, ({ x }, b) => {
          const v = Var(vec3(x, x, x));
          v.assign(v.add(vec3(1, 1, 1)));
          const cond = x.gt(0).or(normalize(v).x.gt(0.5).and(normalize(v).x.lt(0.9)));
          b.ret(cond.select(f32(1), f32(0)));
        }),
      ],
    });
    expect(emitModule(m)).not.toMatch(/_lc\d+ = normalize/);
  });
});

// ═══ A repeat inside a short-circuit operand (#868) ═══
//
// typecv's directionCompatible wrote `ok && length(r.pixel - b) <= e`; the fp64 lowering spells
// the difference once per lane, four times, in the RHS, and `r` is a var, so neither the fn-top
// cse nor this pass bound it. The pass now gives the operand a statement of its own.
describe('cse-local — a repeat inside a short-circuit operand (#868)', () => {
  /** `return <lhs> OP (n.x + n.y > 0.25)` with n = normalize(v), v a var: the repeat is
   *  unconditional inside the operand, as typecv's lane-wise `length` is. A repeat split
   *  across an inner `&&` (the test above) is not this case and stays as it is. */
  const guarded = (op: 'and' | 'or', repeat = true) =>
    module({
      funcs: [
        fn('h', { x: f32T }, f32T, ({ x }, b) => {
          const v = Var(vec3(x, x.mul(2), x.mul(3)));
          v.assign(v.add(vec3(1, 1, 1)));
          const rhs = repeat
            ? normalize(v).x.add(normalize(v).y).gt(0.25)
            : normalize(v).x.gt(0.25);
          const lhs = x.gt(0);
          b.ret((op === 'and' ? lhs.and(rhs) : lhs.or(rhs)).select(f32(1), f32(0)));
        }),
      ],
    });
  const body = (m: ReturnType<typeof guarded>): string => {
    const w = emitModule(m);
    return w.slice(w.indexOf('fn h('));
  };

  it('binds an `&&` operand repeat once, inside `if (_sc)`', () => {
    const b = body(guarded('and'));
    expect((b.match(/normalize\(/g) ?? []).length, b).toBe(1);
    expect(b).toMatch(/var _sc\d+: bool = \(x > 0\.0\);/);
    expect(b).toMatch(/if \(_sc\d+\) \{\n\s+let _lc\d+ = normalize\(\w+\);/);
  });

  it('binds an `||` operand repeat once, inside `if (_sc == false)`', () => {
    const b = body(guarded('or'));
    expect((b.match(/normalize\(/g) ?? []).length, b).toBe(1);
    expect(b).toMatch(/if \(\(_sc\d+ == false\)\) \{\n\s+let _lc\d+ = normalize\(\w+\);/);
  });

  it('leaves a short circuit with no repeat in its operand an expression', () => {
    expect(body(guarded('and', false))).not.toContain('_sc');
  });

  it('preserves oracle values on both sides of the guard', () => {
    for (const op of ['and', 'or'] as const) {
      const m = guarded(op);
      const before = compileModule(m).fns.h;
      const after = compileModule(cseLocal(m)).fns.h;
      for (const x of [-2, -0.1, 0, 0.05, 0.3, 1, 4]) {
        expect(after(x), `${op} x=${x}`).toEqual(before(x));
      }
    }
  });

  it("computes the f64 difference of typecv's directionCompatible once", () => {
    const r = compile(
      `"use typeshade";
interface R { pixel: vec2f64; ok: u32 }
function project(a: vec2f64): R {
  if (a.x > f64(0)) return { pixel: a * f64(2), ok: 1 };
  return { pixel: a, ok: 0 };
}
export function f(a: vec2f64, b: vec2f64): bool {
  const r = project(a);
  return r.ok !== 0 && length(r.pixel - b) <= f64(1);
}
`,
      { fileName: 'direction.shade.ts' },
    );
    expect(r.diagnostics).toEqual([]);
    const w = r.wgsl ?? '';
    const f = w.slice(w.indexOf('fn f('), w.indexOf('\n}\n', w.indexOf('fn f(')));
    // Before #868 the lane-wise length spelled `df64_v2_sub(...)` four times in the return.
    expect((f.match(/df64_v2_sub\(/g) ?? []).length, f).toBe(1);
    expect(f).toMatch(/var _sc\d+: bool = \(r\.ok != 0u\);/);
  });

  it('emits GLSL too', () => {
    expect(() => emitGlslModule(guarded('or'), 'fragment')).not.toThrow();
  });
});

// ═══ Control-flow CONDITIONS (X-GIS #1886) ═══
//
// The same blind spot gvn had: `valueExprs` returned [] for control flow, so a repeat
// INSIDE an `if` condition was never hoisted. Measured on the 87-source baked corpus
// after gvn's fix, the contrast is the whole argument — 119 within-statement repeats
// remain inside control-flow headers against 4 inside plain statements, i.e. this pass
// works wherever it can see and the leftovers are almost entirely where it cannot.
// `glsl-boot-4cc70deab1.glsl:365` is the witness: an `if` condition evaluating
// `-sign(_v11)` twice, whose own body already holds `float _gv16 = (-sign(_v11));`.
//
// HOW THE TWO EXCLUSION ARMS BELOW WERE VERIFIED, because the obvious cut is INERT:
// widening `valueExprs` alone changes nothing observable — the temp is minted, nothing
// references it because `mapStmtValue` still rewrites arm 0 only, and `dce` deletes it
// again. Both arms passed under that cut and would have shipped proving nothing. The
// cut that distinguishes is the mistake a person would actually make: widen `valueExprs`
// AND `mapStmtValue` together. Then the `else if` arm and the `for` arm each red.
describe('cse-local — control-flow conditions (X-GIS #1886)', () => {
  it('collapses a repeat inside an `if` condition', () => {
    const m = module({
      funcs: [
        fn('c', { x: f32T }, f32T, ({ x }, b) => {
          const v = Var(vec3(x, x, x));
          v.assign(v.add(vec3(1, 1, 1))); // a var → fn-top cse cannot reach it
          const r = Var(f32(0));
          // normalize(v) twice in ONE condition, both unconditionally evaluated.
          b.if(normalize(v).x.gt(normalize(v).y), () => {
            r.assign(f32(1));
          });
          b.ret(r);
        }),
      ],
    });
    const wgsl = emitModule(cseLocal(m));
    const fbody = wgsl.slice(wgsl.indexOf('fn c('));
    const calls = (fbody.match(/normalize\(/g) ?? []).length;
    expect(calls, `normalize should emit once, got ${calls}:\n${fbody}`).toBe(1);
    const before = compileModule(m).fns.c!;
    const after = compileModule(cseLocal(m)).fns.c!;
    for (const x of [1, 2, -3, 0.25]) expect(after(x), `x=${x}`).toEqual(before(x));
  });

  it('does NOT hoist out of an `else if` condition', () => {
    // Guarded by the arm before it — a temp placed before the `if` would run on the
    // x > 0 path, where the authored code never evaluates it.
    const m = module({
      funcs: [
        fn('e', { x: f32T }, f32T, ({ x }, b) => {
          const v = Var(vec3(x, x, x));
          v.assign(v.add(vec3(1, 1, 1)));
          const r = Var(f32(0));
          b.if(x.gt(0), () => {
            r.assign(f32(1));
          }).elif(normalize(v).x.gt(normalize(v).y), () => {
            r.assign(f32(2));
          });
          b.ret(r);
        }),
      ],
    });
    expect(emitModule(cseLocal(m))).not.toMatch(/_lc\d+ = normalize/);
  });

  it('does NOT hoist out of a `for` condition', () => {
    // Re-evaluated per iteration; lifting it is loop invariance, which is licm's job.
    // The repeat is on the LEFT of the `&&` on purpose — on the right the short-circuit
    // guard would exclude it whatever `valueExprs` returns, and this arm would pass
    // with `for` conditions tallied, proving nothing.
    const m = module({
      funcs: [
        fn('l', { x: f32T }, f32T, ({ x }, b) => {
          const v = Var(vec3(x, x, x));
          v.assign(v.add(vec3(1, 1, 1)));
          const acc = b.var('acc', f32T, f32(0));
          b.forRange(
            'i',
            i32(0),
            (i) =>
              normalize(v)
                .x.gt(normalize(v).y.sub(9))
                .and(i.lt(i32(2))),
            (cb) => {
              cb.addAssign(acc, f32(1));
            },
          );
          b.ret(acc);
        }),
      ],
    });
    expect(emitModule(cseLocal(m))).not.toMatch(/_lc\d+ = normalize/);
  });
});

// ═══ Indexing a BINDING is a memory load (X-GIS #1886) ═══
//
// Same widening as gvn's: `isWorthHoisting` refuses a bare `buf.at(i).field` because it
// calculates nothing, which is right for a local struct and wrong for a storage buffer,
// where the index IS the load. Here the two reads share ONE statement, which is this
// pass's half of the family.
//
// The write hazard gvn's sibling block pins has NO analogue here and deliberately gets no
// test: this pass hoists only within a single statement, and nothing mutates during one
// statement's expression evaluation (assignments ARE statements) — the header paragraph
// this file opens with. A read_write arm written here would pass whatever the predicate
// says, because the two reads would sit in different statements and never be tallied
// together at all. That is the vacuous shape, not a guard.
describe('cse-local — indexing a binding (X-GIS #1886)', () => {
  const Slot = structDecl('LcSlot', { id: u32T, size: f32T });

  it('collapses two `buf.at(i).field` reads inside one statement', () => {
    const buf = storageBuffer('lc_buf', Slot, { group: 0, binding: 0, access: 'read' });
    const m = module({
      uses: [buf],
      funcs: [
        fn('lbi', { x: f32T }, f32T, ({ x }, b) => {
          const i = b.let('i', u32(2));
          b.ret(buf.at(i).size.mul(x).add(buf.at(i).size));
        }),
      ],
    });
    const wgsl = emitModule(cseLocal(m));
    const fbody = wgsl.slice(wgsl.indexOf('fn lbi('));
    const loads = (fbody.match(/lc_buf\[/g) ?? []).length;
    expect(loads, `the buffer should be indexed once, got ${loads}:\n${fbody}`).toBe(1);
  });

  it('does NOT collapse the same shape on a LOCAL array — only a binding is a load', () => {
    // The discriminating arm: identical statement, identical `index` op, identical
    // `refsLocal` outcome — the ONLY difference is that `arr` is not a module binding.
    // Indexing a function-local array is addressing, not a load; binding it to a temp
    // would trade one address chain for another and claim a memory win that is not there.
    const m = module({
      funcs: [
        fn('lla', { x: f32T }, f32T, ({ x }, b) => {
          const i = b.let('i', u32(1));
          const arr = b.let('arr', arrayLit(f32T, f32(1), f32(2), f32(3)));
          b.ret(arr.at(i, f32T).mul(x).add(arr.at(i, f32T)));
        }),
      ],
    });
    expect(emitModule(cseLocal(m))).not.toMatch(/_lc\d+ = arr\[/);
  });
});

// ═══ A writing call elsewhere in the function ═══
//
// The guard of issue #47 (a call that writes is never deduped or moved) used to turn the pass
// off for a whole function as soon as one statement anywhere in it called something that
// writes. So `b.bump(1.); return vec4f(b.sum());`, a splat the front end then spelled with the
// one argument four times, emitted `Big_sum` four times on both targets. The guard now applies
// to the statement that holds such a call, which is where it protects anything: every other
// statement still evaluates with nothing changing under it. A splat is now one constructor of
// its scalar, so the case below repeats the call by hand.
describe('cse-local — a writing call in another statement', () => {
  const SRC = `"use typeshade";
class Big {
  a: vec4f;
  sum(): f32 { return this.a.x + this.a.w; }
  bump(k: f32): void { this.a = this.a + vec4f(k); }
}
interface Color { color: location<0, vec4f>; }
function run(k: f32): vec4f {
  let b = new Big();
  b.bump(k);
  return vec4f(b.sum(), b.sum(), 0., 1.);
}
@fragment export function fs(p: builtin<"position">): Color {
  return { color: run(p.x) };
}`;

  it('binds the repeat of the statement that writes nothing, on both targets', () => {
    const r = compile(SRC);
    expect(r.diagnostics).toEqual([]);
    const run = (text: string, from: string): string => text.slice(text.indexOf(from));
    expect(run(r.wgsl!, 'fn run(').match(/Big_sum\(/g)).toHaveLength(1);
    expect(run(r.glsl!.fragment, 'vec4 run(').match(/Big_sum\(/g)).toHaveLength(1);
    expect(r.wgsl).toContain('return vec4<f32>(_lc0, _lc0, 0.0, 1.0);');
    // The statement that writes is left as it was.
    expect(r.wgsl).toContain('Big_bump(&b, k);');
  });

  it('preserves oracle values', () => {
    const m = compile(SRC).module;
    const before = compileModule(m).fns.run!;
    const after = compileModule(cseLocal(m)).fns.run!;
    for (const k of [0, 1, 2.5, -3]) expect(after(k), `k=${k}`).toEqual(before(k));
  });
});
