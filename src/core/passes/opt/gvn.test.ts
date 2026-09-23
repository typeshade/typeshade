import { describe, expect, it } from 'vitest';
import {
  module,
  fn,
  f32,
  f32T,
  f64T,
  i32,
  u32,
  u32T,
  i32T,
  boolT,
  vec3,
  vec3fT,
  arrayLit,
  normalize,
  Var,
  Let,
  If,
  Loop,
  Switch,
  type Expr,
  type ModuleDecl,
  type Stmt,
} from '../../ir/index.js';
import { eachExpr, eachStmtExpr } from '../../ir/visit.js';
import { emitModule, emitModuleAt } from '../../backends/wgsl.js';
import { compileModule } from '../../oracle.js';
import type { CpuValue } from '../../cpu-runtime.js';
import { structDecl, storageBuffer } from '../../sot.js';
import { fp64Lower } from '../fp64-lower.js';
import { compile } from '../../../compiler/ts/compile.js';
import { gvn } from './gvn.js';
import { optimizeAt } from './optimize.js';

// gvn numbers a compound, local-touching subexpr that repeats ACROSS statements in a
// straight-line block — the redundancy cse (input-only) and cse-local (within one
// statement) both miss. Conservative: aborts if a referenced root is reassigned in
// the span. Bit-exact -> pinned by oracle value-equality.

/** Count `_gvN` temps gvn introduced (its observable effect — robust to the FnHandle
 *  wrapper, unlike whole-module JSON equality). */
function gvTempCount(m: ModuleDecl): number {
  let n = 0;
  const walk = (body: readonly Stmt[]): void => {
    for (const s of body) {
      if ((s.s === 'let' || s.s === 'var') && /^_gv\d+$/.test(s.name)) n++;
      if (s.s === 'if') {
        for (const a of s.arms) walk(a.body);
        if (s.elseBody) walk(s.elseBody);
      } else if (s.s === 'for') walk(s.body);
      else if (s.s === 'switch') {
        for (const c of s.cases) walk(c.body);
        if (s.defaultBody) walk(s.defaultBody);
      }
    }
  };
  for (const f of m.funcs) walk(f.body);
  return n;
}

const oracleStable = (m: ModuleDecl, name: string, xs: number[]): void => {
  const before = compileModule(m).fns[name]!;
  const after = compileModule(gvn(m)).fns[name]!;
  for (const x of xs) expect(after(x), `x=${x}`).toEqual(before(x));
};

describe('gvn — cross-statement value numbering', () => {
  it('hoists a local-touching repeat that spans two statements to one temp', () => {
    // normalize(v) (touches the local v) appears in two separate `let`s. cse skips it
    // (not input-only), cse-local skips it (not within one statement) -> gvn collapses it.
    const m = module({
      funcs: [
        fn('f', { x: f32T }, f32T, ({ x }, b) => {
          const v = b.let('v', vec3(x, x.mul(2), x.mul(3)));
          const p = b.let('p', normalize(v).x);
          const q = b.let('q', normalize(v).y);
          b.ret(p.add(q));
        }),
      ],
    });
    const out = gvn(m);
    expect(gvTempCount(out)).toBeGreaterThanOrEqual(1);
    const body = emitModule(out);
    const fbody = body.slice(body.indexOf('fn f('));
    const calls = (fbody.match(/normalize\(/g) ?? []).length;
    expect(calls, `normalize should emit once after gvn, got ${calls}:\n${fbody}`).toBe(1);
    oracleStable(m, 'f', [1, 2, 3.5, -4, 0.25]);
  });

  it('does NOT number across a reassignment of a referenced root', () => {
    // v is mutated BETWEEN the two normalize(v) uses, so the two values differ — the
    // span reassignment check must abort.
    const m = module({
      funcs: [
        fn('g', { x: f32T }, f32T, ({ x }, b) => {
          const v = Var(vec3(x, x, x));
          const p = b.let('p', normalize(v).x);
          v.assign(v.add(vec3(1, 1, 1))); // mutate v in the span
          const q = b.let('q', normalize(v).y);
          b.ret(p.add(q));
        }),
      ],
    });
    expect(gvTempCount(gvn(m))).toBe(0); // nothing hoisted
    oracleStable(m, 'g', [1, 2, 3.5, -4, 0.25]);
  });

  it('leaves input-only repeats alone (that is cse’s job, not gvn’s)', () => {
    // x*x is input-only (x is a param) — gvn targets only local-touching repeats.
    const m = module({
      funcs: [
        fn('h', { x: f32T }, f32T, ({ x }, b) => {
          const p = b.let('p', x.mul(x).add(1));
          const q = b.let('q', x.mul(x).mul(2));
          b.ret(p.add(q));
        }),
      ],
    });
    expect(gvTempCount(gvn(m))).toBe(0);
  });

  it('does NOT lift a repeat that only occurs under a short-circuit (||) RHS', () => {
    const m = module({
      funcs: [
        fn('k', { x: f32T }, f32T, ({ x }, b) => {
          const v = b.let('v', vec3(x, x, x));
          // normalize(v) appears only inside the guarded RHS of two ORs (different stmts).
          const p = b.let('p', x.gt(0).or(normalize(v).x.gt(0.5)).select(f32(1), f32(0)));
          const q = b.let('q', x.gt(0).or(normalize(v).y.gt(0.5)).select(f32(2), f32(0)));
          b.ret(p.add(q));
        }),
      ],
    });
    expect(gvTempCount(gvn(m))).toBe(0); // guarded -> excluded
    oracleStable(m, 'k', [1, -2, 0.5]);
  });

  it('bails out on a fn containing a raw Stmt', () => {
    const base = module({
      funcs: [
        fn('f', { x: f32T }, f32T, ({ x }, b) => {
          b.ret(x.mul(2));
        }),
      ],
    });
    const withRaw: ModuleDecl = {
      ...base,
      funcs: [{ ...base.funcs[0]!, body: [{ s: 'raw', wgsl: 'return x * 2.0;' }] }],
    };
    expect(gvTempCount(gvn(withRaw))).toBe(0); // untouched
  });
});

// ═══ Control-flow CONDITIONS (X-GIS #1886) ═══
//
// `valueExprs` used to return [] for every control-flow statement, so an `if`
// condition was never tallied and never rewritten — "handled by recursion" was true
// of the BODIES and false of the CONDITIONS.
//
// Measured effect on the 87-source baked corpus, before vs after a real build + bake:
// raw call sites 12239 -> 12233, i.e. SIX. This pass earns its place as the
// prerequisite for cross-block dominance, not on that number.
//
// Only the FIRST arm's condition is unconditionally evaluated, which is what makes
// binding it to a `let` before the statement free. The two exclusions below are not
// hypothetical caution — they are the cases that would make this unsound, and each
// has its own arm here.
describe('gvn — control-flow conditions (X-GIS #1886)', () => {
  it('numbers a repeat shared between an `if` condition and a later statement', () => {
    // normalize(v) is evaluated by the `if` condition on every path, then again by
    // `q` in the same block. Before X-GIS #1886 gvn saw only ONE occurrence (the `q` one)
    // and did nothing.
    const m = module({
      funcs: [
        fn('c', { x: f32T }, f32T, ({ x }, b) => {
          const v = b.let('v', vec3(x, x, x));
          const r = Var(f32(0));
          b.if(normalize(v).x.gt(0.5), () => {
            r.assign(f32(1));
          });
          const q = b.let('q', normalize(v).y);
          b.ret(r.add(q));
        }),
      ],
    });
    const out = gvn(m);
    expect(gvTempCount(out)).toBeGreaterThanOrEqual(1);
    const wgsl = emitModule(out);
    const fbody = wgsl.slice(wgsl.indexOf('fn c('));
    const calls = (fbody.match(/normalize\(/g) ?? []).length;
    expect(calls, `normalize should emit once after gvn, got ${calls}:\n${fbody}`).toBe(1);
    oracleStable(m, 'c', [1, 2, -3, 0.25]);
  });

  it('does NOT number from an `else if` condition — the arm before it guards it', () => {
    // Hoisting normalize(v) to before the `if` would evaluate it on the x > 0 path,
    // where the authored code never does. Same rule that already excludes a `&&`/`||`
    // RHS and a `select` branch.
    const m = module({
      funcs: [
        fn('e', { x: f32T }, f32T, ({ x }, b) => {
          const v = b.let('v', vec3(x, x, x));
          const r = Var(f32(0));
          b.if(x.gt(0), () => {
            r.assign(f32(1));
          }).elif(normalize(v).x.gt(0.5), () => {
            r.assign(f32(2));
          });
          const q = b.let('q', normalize(v).y);
          b.ret(r.add(q));
        }),
      ],
    });
    expect(gvTempCount(gvn(m))).toBe(0);
    oracleStable(m, 'e', [1, -2, 0.5]);
  });

  it('does NOT number from a `for` condition — it is re-evaluated per iteration', () => {
    // A loop condition runs once per iteration; lifting one out is loop-invariance,
    // which is licm's job and needs an invariance proof gvn does not have.
    //
    // The repeat sits on the LEFT of the `&&`, deliberately. On the RIGHT it would be
    // excluded by the short-circuit guard whatever `valueExprs` returns, and this arm
    // would then pass with `for` conditions tallied — i.e. prove nothing. It is the
    // left operand that `tally` treats as unconditional, so the only thing keeping
    // this green is `for` being absent from `valueExprs`. (`normalize(vec3(x,x,x)).x`
    // is ±0.577, so the left operand is always true and `i < 2` still terminates.)
    const m = module({
      funcs: [
        fn('l', { x: f32T }, f32T, ({ x }, b) => {
          const v = b.let('v', vec3(x, x, x));
          const acc = b.var('acc', f32T, f32(0));
          b.forRange(
            'i',
            i32(0),
            (i) =>
              normalize(v)
                .x.gt(-2)
                .and(i.lt(i32(2))),
            (cb) => {
              cb.addAssign(acc, f32(1));
            },
          );
          const q = b.let('q', normalize(v).y);
          b.ret(acc.add(q));
        }),
      ],
    });
    expect(gvTempCount(gvn(m))).toBe(0);
    oracleStable(m, 'l', [1, -2, 0.5]);
  });
});

// ═══ Cross-block reuse: an inner block may read an enclosing block's temp (X-GIS #1886) ═══
//
// gvn numbered each block in isolation, so a value the OUTER block had already bound
// to a temp was recomputed from scratch inside a nested block. That costs nothing to
// remove — the outer binding is evaluated on every path that reaches the inner block,
// so replacing the inner recompute with the temp adds no work anywhere.
//
// Measured on the 87-source baked corpus: 144 of the 241 remaining repeats are this
// shape, and 84 of those need nothing but the env being passed down (the outer block
// already mints a temp). No group in the corpus has an occurrence inside a loop body,
// so the back-edge guard below is free here — it is in the code for correctness, not
// for a measured case.
describe('gvn — cross-block reuse (X-GIS #1886)', () => {
  it('reuses an enclosing block’s temp inside a nested `if` body', () => {
    const m = module({
      funcs: [
        fn('d', { x: f32T }, f32T, ({ x }, b) => {
          const v = b.let('v', vec3(x, x, x));
          const p = b.let('p', normalize(v).x); // outer occurrence 1
          const q = b.let('q', normalize(v).y); // outer occurrence 2 -> mints the temp
          const r = Var(f32(0));
          b.if(x.gt(0), () => {
            r.assign(normalize(v).z); // inner: must read the temp, not recompute
          });
          b.ret(p.add(q).add(r));
        }),
      ],
    });
    const out = gvn(m);
    const wgsl = emitModule(out);
    const fbody = wgsl.slice(wgsl.indexOf('fn d('));
    const calls = (fbody.match(/normalize\(/g) ?? []).length;
    expect(calls, `normalize should emit once after gvn, got ${calls}:\n${fbody}`).toBe(1);
    oracleStable(m, 'd', [1, 2, -3, 0.25]);
  });

  it('does NOT reuse it past a statement that mutates a root the expr reads', () => {
    // The temp is bound from the pre-mutation `v`; inside the `if`, `normalize(v)` is a
    // DIFFERENT value. Reusing the temp there would be wrong, not merely wasteful — so
    // this arm is the one that fails if the invalidation filter is severed.
    const m = module({
      funcs: [
        fn('dm', { x: f32T }, f32T, ({ x }, b) => {
          const v = Var(vec3(x, x, x));
          const p = b.let('p', normalize(v).x);
          const q = b.let('q', normalize(v).y); // mints on the pre-mutation v
          v.assign(v.add(vec3(1, 1, 1))); // …then v changes
          const r = Var(f32(0));
          b.if(x.gt(0), () => {
            r.assign(normalize(v).z); // post-mutation value — must recompute
          });
          b.ret(p.add(q).add(r));
        }),
      ],
    });
    const out = gvn(m);
    const wgsl = emitModule(out);
    const fbody = wgsl.slice(wgsl.indexOf('fn dm('));
    const calls = (fbody.match(/normalize\(/g) ?? []).length;
    expect(calls, `the post-mutation normalize must survive, got ${calls}:\n${fbody}`).toBe(2);
    oracleStable(m, 'dm', [1, 2, -3, 0.25]);
  });

  it('does NOT reuse it inside a loop whose body mutates a root the expr reads', () => {
    // The back edge is what makes this different from the `if` above: iteration 2 sees
    // the mutated `v`, so a temp bound before the loop is stale from the second pass on.
    const m = module({
      funcs: [
        fn('dl', { x: f32T }, f32T, ({ x }, b) => {
          const v = Var(vec3(x, x, x));
          const p = b.let('p', normalize(v).x);
          const q = b.let('q', normalize(v).y); // mints before the loop
          const acc = b.var('acc', f32T, f32(0));
          b.forRange(
            'i',
            i32(0),
            (i) => i.lt(i32(2)),
            (cb) => {
              cb.addAssign(acc, normalize(v).z); // stale after the mutation below
              v.assign(v.add(vec3(1, 1, 1)));
            },
          );
          b.ret(p.add(q).add(acc));
        }),
      ],
    });
    const out = gvn(m);
    const wgsl = emitModule(out);
    const fbody = wgsl.slice(wgsl.indexOf('fn dl('));
    const calls = (fbody.match(/normalize\(/g) ?? []).length;
    expect(calls, `the in-loop normalize must survive, got ${calls}:\n${fbody}`).toBe(2);
    oracleStable(m, 'dl', [1, 2, -3, 0.25]);
  });
});

// ═══ Indexing a BINDING is a memory load, not free navigation (X-GIS #1886) ═══
//
// `isWorthHoisting` counts an expr as worth a temp only if it CALCULATES something
// (binop / call / construct / …). A bare `buf.at(i).field` calculates nothing, so no
// pass in the family will ever collapse it however often it repeats — which is right
// for a local struct and wrong for a storage/uniform buffer, where the index is a
// LOAD. 142 such repeats were counted in the shader corpus this pass was written against,
// and unlike the peephole candidates this one is corpus-independent: any consumer feeding a
// shader through a
// storage buffer hits it, and a driver cannot reliably CSE a load through a dynamic
// index it must assume may alias.
describe('gvn — indexing a binding (X-GIS #1886)', () => {
  const Slot = structDecl('GvnSlot', { id: u32T, size: f32T });

  it('collapses a repeated `buf.at(i).field` across two statements', () => {
    const buf = storageBuffer('gvn_buf', Slot, { group: 0, binding: 0, access: 'read' });
    const m = module({
      uses: [buf],
      funcs: [
        fn('bi', { x: f32T }, f32T, ({ x }, b) => {
          const i = b.let('i', u32(3));
          const p = b.let('p', buf.at(i).size.mul(x));
          const q = b.let('q', buf.at(i).size.add(1));
          b.ret(p.add(q));
        }),
      ],
    });
    const wgsl = emitModule(gvn(m));
    const fbody = wgsl.slice(wgsl.indexOf('fn bi('));
    const loads = (fbody.match(/gvn_buf\[/g) ?? []).length;
    expect(loads, `the buffer should be indexed once, got ${loads}:\n${fbody}`).toBe(1);
  });

  it('does NOT collapse the same shape on a LOCAL array — only a binding is a load', () => {
    // The binding restriction is what does the work, and this is the arm that proves it:
    // the ONLY difference from the case above is that `arr` is not in the module's
    // binding set. Indexing a function-local array is addressing, not a load, so hoisting
    // it would trade one address chain for another and claim a memory win that is not
    // there. Both arms clear `refsLocal` and both index — `loadRoots` is the single
    // discriminator between them.
    const m = module({
      funcs: [
        fn('bl', { x: f32T }, f32T, ({ x }, b) => {
          const i = b.let('i', u32(1));
          const arr = b.let('arr', arrayLit(f32T, f32(1), f32(2), f32(3)));
          const p = b.let('p', arr.at(i, f32T).mul(x));
          const q = b.let('q', arr.at(i, f32T).add(1));
          b.ret(p.add(q));
        }),
      ],
    });
    expect(gvTempCount(gvn(m))).toBe(0);
  });

  it('does NOT collapse across a WRITE to the same read_write binding', () => {
    // The safety arm. Widening the predicate makes the load a CANDIDATE; every guard
    // downstream still has to refuse it when the value is not invariant. Nothing new
    // was written for this — `collectMutatedRoots` already walks an assign target
    // through its index/member chain, so a written `read_write` binding lands in the
    // mutated set and the span check rejects the pair. This arm is what fails if the
    // new path ever reaches the hoist without passing that check.
    const rw = storageBuffer('gvn_rw', f32T, { group: 0, binding: 1, access: 'read_write' });
    const m = module({
      uses: [rw],
      funcs: [
        fn('brw', { x: f32T }, f32T, ({ x }, b) => {
          const i = b.let('i', u32(1));
          const p = b.let('p', rw.at(i).mul(x));
          rw.at(i).assign(f32(7));
          const q = b.let('q', rw.at(i).add(1));
          b.ret(p.add(q));
        }),
      ],
    });
    expect(emitModule(gvn(m))).not.toMatch(/_gv\d+ = gvn_rw\[/);
  });
});

// ═══ Cross-block dominance: an `if` condition and the arms it dominates ═══
//
// The fp64 escape loops (fp64-julia, fp64-mandelbrot, fp64-burning-ship, fp64-mandelbrot-de and
// their twins) test |z|² in the `if` condition and recompute zx², zy² in the arm:
//
//   if (df64_le(df64_add(df64_mul(zx, zx, G), df64_mul(zy, zy, G), G), R)) {
//     let n = df64_add(df64_sub(df64_mul(zx, zx, G), df64_mul(zy, zy, G), G), c, G);
//
// The condition runs on every path into the arm and the arm reads zx*zx before it writes zx,
// so both products can be bound once, before the `if`. The pass used to miss it twice over: it
// minted a temp only for a key in >= 2 statements of ONE block, and it dropped every enclosing
// temp from an arm that wrote one of its roots anywhere. Measured on the baked corpus: 14 of
// 287 WGSL/GLSL goldens move, each by exactly two products per escape loop (df64_mul call
// sites 362 -> 334, f32 binops 7772 -> 7744), and nothing else in the corpus moves.

/** Reads of each `_gvN` temp in the module. A temp read once is a `let` moved for nothing. */
function gvReads(m: ModuleDecl): Map<string, number> {
  const out = new Map<string, number>();
  const decl = (body: readonly Stmt[]): void => {
    for (const s of body) {
      if ((s.s === 'let' || s.s === 'var') && /^_gv\d+$/.test(s.name)) out.set(s.name, 0);
      eachStmtExpr(
        s,
        () => {},
        (b) => decl([b]),
      );
    }
  };
  for (const f of m.funcs) decl(f.body);
  const visit = (e: Expr): void =>
    eachExpr(e, (x) => {
      if (x.op === 'varref' && out.has(x.name)) out.set(x.name, out.get(x.name)! + 1);
    });
  for (const f of m.funcs) for (const s of f.body) eachStmtExpr(s, visit);
  return out;
}

function expectEveryTempReadTwice(m: ModuleDecl): void {
  for (const [name, n] of gvReads(m))
    expect(n, `${name} is read ${n} time(s)`).toBeGreaterThanOrEqual(2);
}

/** Call sites of `callee` inside function `name`. */
function callsTo(m: ModuleDecl, name: string, callee: string): number {
  let n = 0;
  const f = m.funcs.find((g) => g.name === name)!;
  for (const s of f.body)
    eachStmtExpr(s, (e) =>
      eachExpr(e, (x) => {
        if (x.op === 'call' && x.fn === callee) n++;
      }),
    );
  return n;
}

/** `(a * a)` products in a function's WGSL, emitted at O0 so the text is gvn's output alone. */
function squares(m: ModuleDecl, name: string): number {
  const wgsl = emitModuleAt(m, 'O0');
  const body = wgsl.slice(wgsl.indexOf(`fn ${name}(`)).split('\nfn ')[0]!;
  return (body.match(/\((\w+) \* \1\)/g) ?? []).length;
}

const oracleStableN = (m: ModuleDecl, name: string, argSets: readonly CpuValue[][]): void => {
  const before = compileModule(m).fns[name]!;
  const after = compileModule(gvn(m)).fns[name]!;
  for (const args of argSets) expect(after(...args), JSON.stringify(args)).toEqual(before(...args));
};

describe('gvn — cross-block dominance (the fp64 escape loop)', () => {
  // The escape loop of fp64-julia.ts, f32 half, verbatim in shape.
  const juliaF32 = (): ModuleDecl =>
    module({
      funcs: [
        fn('jf', { cx: f32T, cy: f32T }, f32T, ({ cx, cy }, b) => {
          const zx = Var(cx);
          const zy = Var(cy);
          const it = Var(f32(0));
          Loop(16, () => {
            If(zx.mul(zx).add(zy.mul(zy)).le(16.0), () => {
              const nzx = Let(zx.mul(zx).sub(zy.mul(zy)).add(-0.8));
              zy.assign(zx.mul(zy).mul(2.0).add(0.156));
              zx.assign(nzx);
              it.assign(it.add(1.0));
            });
          });
          b.ret(it);
        }),
      ],
    });

  it('binds zx*zx and zy*zy once, before the `if`, and the arm reads them (f32)', () => {
    const m = juliaF32();
    expect(squares(m, 'jf'), 'the shape under test: two squares in the test, two in the arm').toBe(
      4,
    );
    const out = gvn(m);
    expect(squares(out, 'jf')).toBe(2);
    expect(gvTempCount(out)).toBe(2);
    expectEveryTempReadTwice(out);
    // Points that escape at once, after a few iterations, and never (the interior).
    oracleStableN(m, 'jf', [
      [0.1, 0.2],
      [1.2, 0.3],
      [-0.4, 0.6],
      [2.5, -2.5],
      [0, 0],
    ]);
  });

  it('binds the two df64 squares once, through the lowered df64_sqr calls (fp64)', () => {
    // The same loop over f64, lowered as every emit lowers it. The squares are
    // `df64_sqr(zx, f64Guard())` here; the guard fetch is a leaf to the key, so the two
    // occurrences are one value.
    const jd = fn('jd', { cx: f64T, cy: f64T }, f32T, ({ cx, cy }, b) => {
      const zx = Var(cx);
      const zy = Var(cy);
      const it = Var(f32(0));
      Loop(16, () => {
        If(zx.mul(zx).add(zy.mul(zy)).le(16.0), () => {
          const nzx = Let(zx.mul(zx).sub(zy.mul(zy)).add(-0.8));
          zy.assign(zx.mul(zy).mul(2.0).add(0.156));
          zx.assign(nzx);
          it.assign(it.add(1.0));
        });
      });
      b.ret(it);
    });
    const m = fp64Lower(module({ funcs: [jd] }));
    // zx², zy² in the test and again in the arm; zx*zy once in the arm, its doubling an
    // exact scale rather than a second multiply.
    expect(callsTo(m, 'jd', 'df64_sqr')).toBe(4);
    expect(callsTo(m, 'jd', 'df64_mul')).toBe(1);
    const out = gvn(m);
    expect(callsTo(out, 'jd', 'df64_sqr')).toBe(2);
    expect(callsTo(out, 'jd', 'df64_mul')).toBe(1);
    expect(gvTempCount(out)).toBe(2);
    expectEveryTempReadTwice(out);
    const df = (x: number): number[] => [x, 0];
    oracleStableN(m, 'jd', [
      [df(0.1), df(0.2)],
      [df(1.2), df(0.3)],
      [df(-0.4), df(0.6)],
      [df(1.5255044073468653), df(-0.07591217756271362)],
    ]);
  });

  it('the `else if` conditions and the `else` arm read the temp as well', () => {
    // Every condition runs before any arm and after nothing else, so a temp bound before
    // the `if` holds at each of them. normalize(v) is first seen unconditionally in arm 0's
    // condition; the `else if` condition and the `else` body reuse it.
    const m = module({
      funcs: [
        fn('ei', { x: f32T }, f32T, ({ x }, b) => {
          const v = b.let('v', vec3(x, x.mul(2), 1));
          const r = Var(f32(0));
          b.if(normalize(v).x.gt(0.5), () => {
            r.assign(f32(1));
          })
            .elif(normalize(v).y.gt(0.5), () => {
              r.assign(f32(2));
            })
            .else(() => {
              r.assign(normalize(v).z);
            });
          b.ret(r);
        }),
      ],
    });
    const out = gvn(m);
    const wgsl = emitModuleAt(out, 'O0');
    const fbody = wgsl.slice(wgsl.indexOf('fn ei('));
    expect((fbody.match(/normalize\(/g) ?? []).length, fbody).toBe(1);
    expectEveryTempReadTwice(out);
    oracleStable(m, 'ei', [1, -2, 0.25, 3, -0.1]);
  });

  it('a `switch` case reads a temp bound before the `switch`', () => {
    // No `switch` in the corpus has this shape; it is here because a case body has the same
    // guarantee as an `if` arm — one runs, top-down, once, after a pure scrutinee.
    const m = module({
      funcs: [
        fn('sw', { x: f32T, sel: u32T }, f32T, ({ x, sel }, b) => {
          const v = b.let('v', vec3(x, x.mul(2), 1));
          const p = b.let('p', normalize(v).x);
          const r = Var(f32(0));
          Switch(sel)
            .case(0, () => {
              r.assign(normalize(v).y);
            })
            .default(() => {
              r.assign(f32(3));
            });
          b.ret(p.add(r));
        }),
      ],
    });
    const out = gvn(m);
    expect(gvTempCount(out)).toBe(1);
    expectEveryTempReadTwice(out);
    oracleStableN(m, 'sw', [
      [1, 0],
      [1, 1],
      [-2, 0],
    ]);
  });

  it('a loop body that leaves the roots alone reads a temp bound before the loop', () => {
    const m = module({
      funcs: [
        fn('lr', { x: f32T }, f32T, ({ x }, b) => {
          const v = b.let('v', vec3(x, x.mul(2), 1));
          const p = b.let('p', normalize(v).x);
          const acc = b.var('acc', f32T, f32(0));
          b.forRange(
            'i',
            i32(0),
            (i) => i.lt(i32(3)),
            (cb) => {
              cb.addAssign(acc, normalize(v).y);
            },
          );
          b.ret(p.add(acc));
        }),
      ],
    });
    const out = gvn(m);
    expect(gvTempCount(out)).toBe(1);
    expectEveryTempReadTwice(out);
    oracleStable(m, 'lr', [1, -2, 0.25]);
  });

  it('does not mint a second temp for a value an enclosing temp still holds', () => {
    // normalize(v) repeats in the outer block (a temp) AND in two statements of the arm. The
    // arm reads the outer temp; it used to mint its own, recomputing normalize(v), and leave
    // the duplicate for the next fixpoint round's copy-prop and DCE.
    const m = module({
      funcs: [
        fn('ih', { x: f32T }, f32T, ({ x }, b) => {
          const v = b.let('v', vec3(x, x.mul(2), 1));
          const p = b.let('p', normalize(v).x);
          const q = b.let('q', normalize(v).y);
          const r = Var(f32(0));
          b.if(x.gt(0), () => {
            const a = Let(normalize(v).mul(2));
            r.assign(a.z.add(normalize(v).z));
          });
          b.ret(p.add(q).add(r));
        }),
      ],
    });
    const out = gvn(m);
    expect(gvTempCount(out)).toBe(1);
    expect(callsTo(out, 'ih', 'normalize')).toBe(1);
    expectEveryTempReadTwice(out);
    oracleStable(m, 'ih', [1, -2, 0.25]);
  });

  it('a dominance temp does not split a same-block repeat', () => {
    // normalize(v) repeats in `p` and `q`; normalize(v).x is also read by the arm. Binding the
    // larger normalize(v).x for the arm would take `p`'s occurrence away from the repeat and
    // leave normalize(v) computed twice — so the repeat wins, and the arm reads `_gv0.x`.
    const m = module({
      funcs: [
        fn('sp', { x: f32T }, f32T, ({ x }, b) => {
          const v = b.let('v', vec3(x, x.mul(2), 1));
          const p = b.let('p', normalize(v).x);
          const q = b.let('q', normalize(v).y);
          const r = Var(f32(0));
          b.if(x.gt(0), () => {
            r.assign(normalize(v).x.mul(2));
          });
          b.ret(p.add(q).add(r));
        }),
      ],
    });
    const out = gvn(m);
    expect(gvTempCount(out)).toBe(1);
    expect(callsTo(out, 'sp', 'normalize')).toBe(1);
    expectEveryTempReadTwice(out);
    oracleStable(m, 'sp', [1, -2, 0.25]);
  });

  it('a temp minted in an arm reads the enclosing temp in its own initialiser', () => {
    // normalize(v) is bound in the outer block (`p` and `q`); the arm repeats
    // normalize(v).z * x in two statements and mints a temp for it. Its initialiser is built
    // from the ORIGINAL expression, so without rewriting it against the temps in scope it
    // recomputed normalize(v) the outer temp already holds.
    const m = module({
      funcs: [
        fn('ai', { x: f32T }, f32T, ({ x }, b) => {
          const v = b.let('v', vec3(x, x.mul(2), 1));
          const p = b.let('p', normalize(v).x);
          const q = b.let('q', normalize(v).y);
          const r = Var(f32(0));
          b.if(x.gt(0), () => {
            const a = Let(normalize(v).z.mul(x));
            r.assign(a.add(normalize(v).z.mul(x).mul(2)));
          });
          b.ret(p.add(q).add(r));
        }),
      ],
    });
    const out = gvn(m);
    expect(gvTempCount(out)).toBe(2);
    expect(callsTo(out, 'ai', 'normalize')).toBe(1);
    const wgsl = emitModuleAt(out, 'O0');
    expect(wgsl).toContain('let _gv1 = (_gv0.z * x);');
    expectEveryTempReadTwice(out);
    oracleStable(m, 'ai', [1, -2, 0.25]);
  });

  it('binds a value, not a part of it too: the path that skips the arm pays what it did', () => {
    // The condition computes normalize(v).x, and the arm reads both normalize(v).x and
    // normalize(v) (for .y and .z), so both are dominance candidates. Binding both before the
    // `if` puts `let _gv0 = normalize(v).x` first (tally order) with its own normalize, then
    // `let _gv1 = normalize(v)`: two normalizes on the path that never enters the arm, where
    // the authored code runs one. Only the larger is bound; the arm numbers its own repeat.
    const m = module({
      funcs: [
        fn('mx', { x: f32T }, f32T, ({ x }, b) => {
          const v = b.let('v', vec3(x, x.mul(2), 1));
          const r = Var(f32(0));
          b.if(normalize(v).x.gt(0.5), () => {
            r.assign(normalize(v).x.add(normalize(v).y));
            r.assign(r.add(normalize(v).z));
          });
          b.ret(r);
        }),
      ],
    });
    const out = gvn(m);
    const f = out.funcs[0]!;
    const outside = f.body.filter((s) => s.s !== 'if');
    const cond = f.body.find((s) => s.s === 'if')!;
    let before = 0;
    for (const s of outside)
      eachStmtExpr(s, (e) =>
        eachExpr(e, (x) => {
          if (x.op === 'call' && x.fn === 'normalize') before++;
        }),
      );
    if (cond.s === 'if')
      eachExpr(cond.arms[0]!.cond, (x) => {
        if (x.op === 'call' && x.fn === 'normalize') before++;
      });
    expect(before, emitModuleAt(out, 'O0')).toBe(1);
    expectEveryTempReadTwice(out);
    oracleStable(m, 'mx', [1, -2, 0.25, 0.01]);
  });

  it('a `for` counter that shadows a root is a write to it, even when the update is not', () => {
    // The loop's own counter is spelled `i`, like the outer local the key reads. The update
    // here writes `k`, not the counter, so only the counter's declared name tells the loop
    // filter that `i` inside the body is another value. The validator and the oracle refuse a
    // duplicated local (SD0112), so the check is structural; `gvn` is callable on its own.
    const m = module({
      funcs: [
        fn('fc', { x: f32T }, f32T, ({ x }, b) => {
          const i = b.let('i', i32(2));
          const p = b.let('p', normalize(vec3(i.f32(), x, 1)).x);
          const k = b.var('k', i32T, i32(0));
          const acc = b.var('acc', f32T, f32(0));
          b.forRange(
            'i',
            i32(0),
            (j) => j.lt(i32(3)),
            (cb, j) => {
              cb.addAssign(acc, normalize(vec3(j.f32(), x, 1)).x);
            },
          );
          b.ret(p.add(acc).add(k.f32()));
        }),
      ],
    });
    // Point the loop's update at `k`, leaving the counter unwritten.
    const f = m.funcs[0]!;
    const body = f.body.map((s): Stmt => {
      if (s.s !== 'for') return s;
      const kref: Expr = { op: 'varref', type: i32T, name: 'k' };
      return {
        ...s,
        update: {
          s: 'assign',
          target: kref,
          expr: { op: 'binop', type: i32T, bop: '+', a: kref, b: i32(1).expr },
        },
      };
    });
    const shadowed: ModuleDecl = { ...m, funcs: [{ ...f, body }] };
    const loop = body.find((s) => s.s === 'for')!;
    expect(loop.s === 'for' && loop.init.s === 'var' && loop.init.name).toBe('i');
    const out = gvn(shadowed);
    expect(gvTempCount(out)).toBe(0);
    expect(callsTo(out, 'fc', 'normalize')).toBe(2);
  });

  it('a write to a `constref` or `externref` root retires a temp, as it does a local', () => {
    // `collectMutatedRoots` counts both ops as assignable roots (expr-utils `rootName`), so
    // `refsLocal` tallies a key that reads a written one, and the temp's roots must name it
    // too, or the arm's write never retires it. Neither front end assigns to either today (a
    // module constant and a host global are read-only on both surfaces), so the module is
    // built by hand, and the check is structural: the oracle refuses the assignment too
    // ("bad assignment target constref").
    for (const op of ['constref', 'externref'] as const) {
      const g: Expr = { op, type: f32T, name: 'G' };
      const x: Expr = { op: 'param', type: f32T, name: 'x' };
      const r: Expr = { op: 'varref', type: f32T, name: 'r' };
      const key: Expr = {
        op: 'member',
        type: f32T,
        field: 'x',
        base: {
          op: 'call',
          type: vec3fT,
          fn: 'normalize',
          args: [{ op: 'construct', type: vec3fT, args: [g, x, f32(1).expr] }],
        },
      };
      const m: ModuleDecl = {
        consts: [],
        structs: [],
        bindings: [],
        funcs: [
          {
            name: 'cr',
            params: [{ name: 'x', type: f32T }],
            ret: f32T,
            body: [
              { s: 'var', name: 'r', type: f32T, init: f32(0).expr },
              {
                s: 'if',
                arms: [
                  {
                    cond: { op: 'compare', type: boolT, cop: '>', a: key, b: f32(0.1).expr },
                    body: [
                      { s: 'assign', target: g, expr: f32(5).expr },
                      { s: 'assign', target: r, expr: key },
                    ],
                  },
                ],
              },
              { s: 'return', expr: r },
            ],
          },
        ],
      };
      const out = gvn(m);
      expect(gvTempCount(out), op).toBe(0);
      expect(callsTo(out, 'cr', 'normalize'), op).toBe(2);
    }
  });

  it('every temp is read at least twice — a reuse the rewrite masks is denied, not left behind', () => {
    // The reach check sees normalize(v).x inside the nested `if` and proposes a temp for it in
    // the arm. But that occurrence sits inside normalize(v).x + 1, which the OUTER block has
    // already bound, and the rewrite takes the larger temp first: the proposed temp would be
    // read once, by `c`. gvnFn counts the reads of the real output, denies it for that block
    // and numbers the function again.
    const m = module({
      funcs: [
        fn('mk', { x: f32T }, f32T, ({ x }, b) => {
          const v = b.let('v', vec3(x, x.mul(2), 1));
          const a = b.let('a', normalize(v).x.add(1));
          const a2 = b.let('a2', normalize(v).x.add(1).mul(3));
          const r = Var(f32(0));
          b.if(x.gt(0), () => {
            const c = Let(normalize(v).x.mul(3));
            If(x.gt(1), () => {
              r.assign(normalize(v).x.add(1));
            });
            r.assign(r.add(c));
          });
          b.ret(a.add(a2).add(r));
        }),
      ],
    });
    const out = gvn(m);
    expect(gvTempCount(out)).toBe(1); // the outer `normalize(v).x + 1`, nothing in the arm
    expectEveryTempReadTwice(out);
    // …and the numbering stays dense: the denied attempt's `_gv1` is not skipped over.
    expect([...gvReads(out).keys()]).toEqual(['_gv0']);
    oracleStable(m, 'mk', [2, 0.5, -1]);
  });

  it('does NOT reuse in an arm past the statement that writes the root', () => {
    // The arm's own walk retires the temp at the write: a read before it shares, a read after
    // it recomputes. With only the post-write read there is nothing to share, and no temp.
    const escape = (before: boolean): ModuleDecl =>
      module({
        funcs: [
          fn('wb', { x: f32T }, f32T, ({ x }, b) => {
            const zx = Var(x);
            const r = Var(f32(0));
            If(zx.mul(zx).gt(1.0), () => {
              if (before) r.assign(zx.mul(zx)); // the pre-write value: the temp
              zx.assign(zx.add(1.0));
              r.assign(r.add(zx.mul(zx))); // the post-write value: recomputed
            });
            b.ret(r);
          }),
        ],
      });
    const shared = gvn(escape(true));
    expect(gvTempCount(shared)).toBe(1);
    expect(squares(shared, 'wb')).toBe(2); // the temp's own, and the post-write one
    expectEveryTempReadTwice(shared);
    oracleStable(escape(true), 'wb', [2, 0.5, -3]);

    const alone = gvn(escape(false));
    expect(gvTempCount(alone)).toBe(0);
    expect(squares(alone, 'wb')).toBe(2);
    oracleStable(escape(false), 'wb', [2, 0.5, -3]);
  });

  it('does NOT reuse from outside a loop whose body writes the root, even after the use', () => {
    // The use comes first in the body, which is exactly what makes an `if` arm safe — and a
    // loop not: iteration 2 reads the `v` iteration 1 wrote.
    const m = module({
      funcs: [
        fn('lw', { x: f32T }, f32T, ({ x }, b) => {
          const v = Var(vec3(x, x.mul(2), 1));
          const p = b.let('p', normalize(v).x);
          const acc = b.var('acc', f32T, f32(0));
          b.forRange(
            'i',
            i32(0),
            (i) => i.lt(i32(3)),
            (cb) => {
              cb.addAssign(acc, normalize(v).y);
              v.assign(v.add(vec3(1, 0, 0)));
            },
          );
          b.ret(p.add(acc));
        }),
      ],
    });
    expect(gvTempCount(gvn(m))).toBe(0);
    oracleStable(m, 'lw', [1, -2, 0.25]);
  });

  it('does NOT mint from an `else if` condition, even for its own arm', () => {
    // A temp before the `if` would evaluate normalize(v) on the x > 0 path, where the
    // authored code never does. The arm cannot hold the `let` either: its condition is
    // evaluated before the arm opens.
    const m = module({
      funcs: [
        fn('ee', { x: f32T }, f32T, ({ x }, b) => {
          const v = b.let('v', vec3(x, x.mul(2), 1));
          const r = Var(f32(0));
          b.if(x.gt(0), () => {
            r.assign(f32(1));
          }).elif(normalize(v).x.lt(0.5), () => {
            r.assign(normalize(v).y);
          });
          b.ret(r);
        }),
      ],
    });
    expect(gvTempCount(gvn(m))).toBe(0);
    oracleStable(m, 'ee', [1, -2, 0]);
  });

  it('does NOT mint from a key the condition evaluates only under `||`', () => {
    const m = module({
      funcs: [
        fn('oc', { x: f32T }, f32T, ({ x }, b) => {
          const v = b.let('v', vec3(x, x.mul(2), 1));
          const r = Var(f32(0));
          b.if(x.gt(0).or(normalize(v).x.lt(0.5)), () => {
            r.assign(normalize(v).y);
          });
          b.ret(r);
        }),
      ],
    });
    expect(gvTempCount(gvn(m))).toBe(0);
    oracleStable(m, 'oc', [1, -2, 0]);
  });

  it('does NOT reuse across a write to a read_write binding in the arm', () => {
    // `rw[i] * x + 1` is bound before the `if`; the arm reads it once before storing to `rw`
    // (the store's right-hand side runs first) and once after, where it is a different value.
    const rw = storageBuffer('gvn_arm', f32T, { group: 0, binding: 2, access: 'read_write' });
    const m = module({
      uses: [rw],
      funcs: [
        fn('sa', { x: f32T }, f32T, ({ x }, b) => {
          const i = b.let('i', u32(1));
          const s = b.let('s', rw.at(i).mul(x).add(1));
          b.if(s.gt(2), () => {
            rw.at(u32(2)).assign(rw.at(i).mul(x).add(1)); // before any store lands: the temp
            rw.at(i).assign(f32(5));
            rw.at(u32(3)).assign(rw.at(i).mul(x).add(1)); // reads the 5 just stored
          });
          b.ret(s);
        }),
      ],
    });
    const out = gvn(m);
    expect(gvTempCount(out)).toBe(1);
    const wgsl = emitModuleAt(out, 'O0');
    const fbody = wgsl.slice(wgsl.indexOf('fn sa('));
    expect((fbody.match(/\(gvn_arm\[i\] \* x\)/g) ?? []).length, fbody).toBe(2);
    // The values, return and buffer both, from the same starting buffer: x = 2 and x = 3 take
    // the arm (s = 3, 4), x = 0.5 does not (s = 1.5).
    const run = (mod: ModuleDecl, x: number): [CpuValue, number[]] => {
      const buf = [1, 1, 1, 1];
      const cm = compileModule(mod);
      cm.setBinding('gvn_arm', buf);
      return [cm.fns['sa']!(x), buf];
    };
    expect(run(m, 3)).toEqual([4, [1, 5, 4, 16]]);
    for (const x of [2, 0.5, 3]) expect(run(out, x), `x=${x}`).toEqual(run(m, x));
  });

  it('does NOT reuse past a `let` in the arm that shadows a root', () => {
    // The validator refuses a shadowed local at emit (SD0112), and so does the oracle, so no
    // emitted module reaches the pass with one; `gvn` is also callable on its own. The arm's
    // second `v` points another way, so `normalize` of it is a different value.
    const m = module({
      funcs: [
        fn('sl', { x: f32T }, f32T, ({ x }, b) => {
          const v = b.let('v', vec3(x, x.mul(2), 1));
          const r = Var(f32(0));
          b.if(normalize(v).x.gt(0.1), () => {
            r.assign(normalize(v).y); // the outer `v`: the temp
            const w = Let('v', vec3(x, x.neg(), 3));
            r.assign(r.add(normalize(w).z)); // the inner `v`: recomputed
          });
          b.ret(r);
        }),
      ],
    });
    expect(callsTo(m, 'sl', 'normalize')).toBe(3);
    const out = gvn(m);
    expect(gvTempCount(out)).toBe(1);
    expect(callsTo(out, 'sl', 'normalize')).toBe(2); // the temp's own, and the shadowed one
    expectEveryTempReadTwice(out);
  });

  it('an `inout` argument: the call is an effect, so the function is left alone', () => {
    // `p.bump(1.)` writes `p` through an `inout` parameter. `collectMutatedRoots` does NOT
    // count that as a write to `p`: the callee's write set names its own parameter (`self_`),
    // and `calleeWritesOf` adds that name, not the root of the argument passed there. What
    // keeps a stale `p.v * p.v` temp out of the arm is `bodyHasEffectfulCall` — the callee
    // writes something, so gvn does not touch the function. This arm fails if that bail-out
    // is ever narrowed without the argument root being counted.
    const r = compile(`"use typeshade";
class P {
  v: f32;
  bump(d: f32): void {
    this.v = this.v + d;
  }
}
export function f(x: f32): f32 {
  let p = new P();
  p.v = x;
  let r = 0.;
  if (p.v * p.v > 0.5) {
    p.bump(1.);
    r = p.v * p.v;
  }
  return r;
}
@fragment
export function fs(): vec4 {
  return vec4(f(1.), 0., 0., 1.);
}
`);
    expect(r.diagnostics).toEqual([]);
    const m = r.module;
    const f = m.funcs.find((g) => g.name === 'f')!;
    expect(f.params.length).toBe(1);
    expect(m.funcs.find((g) => g.name === 'P_bump')!.params[0]!.mode).toBe('inout');
    const out = gvn(m);
    expect(out.funcs.find((g) => g.name === 'f')).toBe(f);
    const before = compileModule(m).fns['f']!;
    const after = compileModule(out).fns['f']!;
    expect(before(1)).toBe(4); // (1 + 1)², read after the write
    for (const x of [1, 0.25, -3]) expect(after(x)).toEqual(before(x));
  });
});

// ═══ A call reads what its callee reads ═══
//
// `h(b)` has the roots {b} to a walk of the expression, but `h` also reads `gp`, and a write to
// `gp` between two `h(b)` makes them two values. The same-block form was already wrong at the
// base of the dominance change; that change also handed a temp into an `if` arm that writes,
// and minted one for the purpose, so the condition-plus-arm shape it exists for reached the
// hole: `let _gv0 = h(b); if (_gv0 > 0.) { gp = 5.; r = _gv0; }`, 4 where O0 returns 20.
describe('gvn — a call reads the module names its callee reads', () => {
  const PRIV = `"use typeshade";
let gp: f32 = 1.;
function h(q: f32): f32 {
  return q * gp;
}
`;
  const FS = `
@fragment
export function fs(): vec4 {
  return vec4(f(3.), 0., 0., 1.)
}
`;
  const privModule = (body: string): ModuleDecl => {
    const r = compile(PRIV + body + FS);
    expect(r.diagnostics).toEqual([]);
    return r.module;
  };

  /** gvn alone, and the O1 and O2 pipelines (one function per view, with the module's read
   *  table handed to each), return what O0 returns. */
  const agrees = (m: ModuleDecl, xs: number[]): void => {
    const o0 = compileModule(m).fns['f']!;
    // A fresh module object for each: the read table is cached per object, and the pipelines
    // must compute it for the whole module themselves, not find one `gvn(m)` left behind.
    for (const [name, out] of [
      ['gvn', gvn({ ...m })],
      ['O1', optimizeAt({ ...m }, 'O1')],
      ['O2', optimizeAt({ ...m }, 'O2')],
    ] as const) {
      const g = compileModule(out).fns['f']!;
      for (const x of xs) expect(g(x), `${name} x=${x}`).toEqual(o0(x));
    }
  };

  it('an arm that writes a `var<private>` the helper reads calls the helper again', () => {
    const m = privModule(`export function f(x: f32): f32 {
  let b = x + 1.
  let r = 0.
  if (h(b) > 0.) {
    gp = 5.
    r = h(b)
  }
  return r
}`);
    expect(compileModule(m).fns['f']!(3)).toBe(20); // (3 + 1) * 5, read after the write
    const out = gvn(m);
    expect(gvTempCount(out)).toBe(0);
    expect(callsTo(out, 'f', 'h')).toBe(2);
    agrees(m, [3, -3, 0.5]);
  });

  it('a statement that writes it keeps a later arm from reading the value from before', () => {
    const m = privModule(`export function f(x: f32): f32 {
  let b = x + 1.
  let r = 0.
  gp = h(b)
  if (x > 0.) {
    r = h(b)
  }
  return r
}`);
    expect(compileModule(m).fns['f']!(3)).toBe(16); // gp = 4, then 4 * 4
    expect(gvTempCount(gvn(m))).toBe(0);
    agrees(m, [3, -3, 0.5]);
  });

  it('the same-block repeat across the write is two values', () => {
    const m = privModule(`export function f(x: f32): f32 {
  let b = x + 1.
  let y = h(b)
  gp = 5.
  let z = h(b)
  return y + z
}`);
    expect(compileModule(m).fns['f']!(3)).toBe(24); // 4 + 20
    expect(gvTempCount(gvn(m))).toBe(0);
    agrees(m, [3, -3, 0.5]);
  });

  it('a read_write binding the helper reads, written in the arm, through the oracle', () => {
    const r = compile(`"use typeshade";
declare let buf: storage<array<f32>>;
function load(i: u32): f32 {
  return buf[i] * 2.;
}
export function f(i: u32): f32 {
  let j = i * u32(1);
  let r = load(j);
  if (r > 0.) {
    buf[j] = 10.;
    r = r + load(j);
  }
  return r;
}
@compute([1, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  buf[gid.x + 1] = f(gid.x);
}
`);
    expect(r.diagnostics).toEqual([]);
    const m = r.module;
    const run = (mod: ModuleDecl, i: number): [CpuValue, number[]] => {
      const buf = [1, 2, -3, 4];
      const cm = compileModule(mod);
      cm.setBinding('buf', buf);
      return [cm.fns['f']!(i), buf];
    };
    expect(run(m, 0)).toEqual([22, [10, 2, -3, 4]]); // 1 * 2, then 10 * 2 after the store
    expect(callsTo(gvn(m), 'f', 'load')).toBe(2);
    for (const out of [gvn({ ...m }), optimizeAt({ ...m }, 'O1'), optimizeAt({ ...m }, 'O2')])
      for (const i of [0, 2]) expect(run(out, i), `i=${i}`).toEqual(run(m, i));
  });
});
