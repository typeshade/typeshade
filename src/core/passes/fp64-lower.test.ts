// ═══ fp64Lower pass tests — rewrite shape, fail-loud gates, identity ═══

import { describe, it, expect } from 'vitest';
import {
  fn,
  module,
  f64,
  f64T,
  f32T,
  i32,
  vec4fT,
  vec3f64T,
  mat3f64T,
  toF32,
  toF64,
  sqrt,
  sin,
  cos,
  exp,
  abs,
  min,
  max,
  mix,
  floor,
  fract,
  dot,
  length,
  distance,
  normalize,
  mulMat64,
  transformMat64,
  transpose64,
  type Expr,
  type FuncDecl,
  type ModuleDecl,
} from '../ir/index.js';
import { eachExpr, eachStmtExpr } from '../ir/visit.js';
import { fp64Guard, FP64_GUARD_NAME, DF64_ORDER } from '../fp64/df64-lib.js';
import { ioStruct, location, builtin, uniformStruct, resource } from '../sot.js';
import { fp64Lower, foldGuardChain, hoistGuardFetch } from './fp64-lower.js';
import { emitModule, emitModuleAt } from '../backends/wgsl.js';
import { emitGlslModule } from '../backends/glsl.js';

describe('identity for non-f64 modules', () => {
  it('returns the SAME module object when no f64 appears anywhere', () => {
    const plain = fn('plain', { x: f32T }, (p) => p.x.mul(2.0).add(1.0));
    const m = module({ funcs: [plain] });
    expect(fp64Lower(m)).toBe(m);
  });
});

describe('rewrite shapes', () => {
  it('binops become df64_* calls; helpers + their transitive deps are injected', () => {
    const k = fn('k', { a: f64T, b: f64T }, (p) => p.a.add(p.b).mul(p.a));
    const lowered = fp64Lower(module({ funcs: [k] }));
    const names = lowered.funcs.map((f) => f.name);
    expect(names[0]).toBe('k');
    // Direct helpers…
    expect(names).toContain('df64_add');
    expect(names).toContain('df64_mul');
    // …and their transitive EFT primitives, in fixed dependency-first order.
    expect(names.indexOf('df64_twoSum')).toBeLessThan(names.indexOf('df64_add'));
    expect(names.indexOf('df64_split')).toBeLessThan(names.indexOf('df64_twoProd'));
    expect(names.indexOf('df64_twoProd')).toBeLessThan(names.indexOf('df64_mul'));
    // Unused helpers stay out (right-sized injection).
    expect(names).not.toContain('df64_sqrt');
    expect(names).not.toContain('df64_div');
  });

  it('an f64 literal lowers to a vec2<f32>(hi, lo) split at BUILD time', () => {
    const k = fn('k', { a: f64T }, (p) => p.a.add(1e8 + 0.5));
    const wgsl = emitModule(module({ funcs: [k] }));
    // splitF64(1e8 + 0.5) = [1e8, 0.5] — both halves exactly representable.
    expect(wgsl).toContain('vec2<f32>(100000000.0, 0.5)');
  });

  it('a mixed f64∘f32 operand widens as vec2<f32>(x, 0.0) — the pass is the widen authority', () => {
    const k = fn('k', { a: f64T, s: f32T }, (p) => p.a.mul(p.s));
    const wgsl = emitModule(module({ funcs: [k] }));
    expect(wgsl).toContain('df64_mul(a, vec2<f32>(s, 0.0), _fp64_g)');
  });

  it('comparisons lower to the lexicographic df64 comparators', () => {
    const k = fn('k', { a: f64T, b: f64T }, (p) => p.a.lt(p.b).select(1.0, 0.0));
    const wgsl = emitModule(module({ funcs: [k] }));
    expect(wgsl).toContain('df64_lt(a, b)');
  });

  it('sqrt on f64 lowers to df64_sqrt; toF64/toF32 lower to widen/narrow', () => {
    const k = fn('k', { a: f64T, s: f32T }, (p) => toF32(sqrt(p.a.add(toF64(p.s)))));
    const wgsl = emitModule(module({ funcs: [k] }));
    expect(wgsl).toContain(
      'df64_narrow(df64_sqrt(df64_add(a, vec2<f32>(s, 0.0), _fp64_g), _fp64_g))',
    );
  });

  it('sin / cos on f64 lower to df64_sin / df64_cos with the transcendental helpers injected', () => {
    const k = fn('k', { a: f64T }, (p) => toF32(sin(p.a).add(cos(p.a))));
    const lowered = fp64Lower(module({ funcs: [k] }));
    const names = lowered.funcs.map((f) => f.name);
    // The reduction helpers and their Taylor + nint deps are injected, in
    // dependency-first order (define-before-use holds for GLSL).
    for (const n of ['df64_sin', 'df64_cos', 'df64_sin_taylor', 'df64_cos_taylor', 'df64_nint'])
      expect(names).toContain(n);
    expect(names.indexOf('df64_sin_taylor')).toBeLessThan(names.indexOf('df64_sin'));
    expect(names.indexOf('df64_nint')).toBeLessThan(names.indexOf('df64_sin'));
    // A raw loaded operand feeding sin/cos is renormed first (the reduction's
    // df64_div/df64_sub cancel on it — the X-GIS #915 loaded-lo defense, as for fract):
    // `a` is laundered through df64_add(a, 0) before it reaches sin/cos (the CSE
    // shares the one renorm between the two calls).
    //
    // The zero is spelled through the optBarrier bitcast round-trip, not as a bare
    // `0.0` — a literal there is foldable, and `opt/member-fold.ts` resolving it back
    // out of the vec2 is what deletes the twoSum this renorm exists to run. Both
    // components CSE to one binding.
    const wgsl = emitModule(module({ funcs: [k] }));
    expect(wgsl).toMatch(/let (\w+) = bitcast<f32>\(bitcast<u32>\(0\.0\)\);/);
    const zero = /let (\w+) = bitcast<f32>\(bitcast<u32>\(0\.0\)\);/.exec(wgsl)![1]!;
    expect(wgsl).toContain(`df64_add(a, vec2<f32>(${zero}, ${zero}), _fp64_g)`);
    expect(wgsl).toMatch(/\bdf64_sin\(/);
    expect(wgsl).toMatch(/\bdf64_cos\(/);
  });

  it('sin / cos on vec64 lower to the per-lane df64_vN_sin / df64_vN_cos twins', () => {
    const k = fn('k', { a: vec3f64T }, (p) => toF32(sin(p.a).x));
    const lowered = fp64Lower(module({ funcs: [k] }));
    const names = lowered.funcs.map((f) => f.name);
    expect(names).toContain('df64_v3_sin');
    // The vec twin composes the SCALAR df64_sin per lane, so that is pulled in too.
    expect(names).toContain('df64_sin');
  });

  it('f64 params/returns become vec2<f32>; no f64 token survives lowering', () => {
    const k = fn('k', { a: f64T }, (p) => p.a.add(p.a));
    const wgsl = emitModule(module({ funcs: [k] }));
    expect(wgsl).toContain('fn k(a: vec2<f32>) -> vec2<f32>');
    expect(wgsl).not.toMatch(/\bf64\b/);
  });

  it('an f64 uniform field lowers to a vec2<f32> field', () => {
    const U = uniformStruct(
      'KParams',
      { group: 0, binding: 1, as: 'params' },
      {
        origin: f64T,
        scale: f32T,
      },
    );
    const k = fn('k', { x: f32T }, (p) => toF32(U.field.origin.add(toF64(p.x))));
    const wgsl = emitModule(module({ funcs: [k], uses: [U] }));
    expect(wgsl).toContain('origin: vec2<f32>,');
    expect(wgsl).toContain('params.origin');
  });
});

describe('guard auto-injection', () => {
  it('injects the _fp64 guard TEXTURE at (0, 0) when the module declares no bindings', () => {
    const k = fn('k', { a: f64T, b: f64T }, (p) => p.a.add(p.b));
    const lowered = fp64Lower(module({ funcs: [k] }));
    expect(lowered.bindings).toEqual([
      {
        group: 0,
        binding: 0,
        name: FP64_GUARD_NAME,
        space: 'uniform',
        type: { kind: 'texture', dim: '2d', elem: 'f32' },
        precision: 'highp',
      },
    ]);
    // The guard value is a texel fetch — opaque to every downstream compiler
    // (a UBO-sourced guard is defeated by uniform-value pipeline
    // specialization; observed on Windows/NVIDIA).
    const wgsl = emitModule(module({ funcs: [k] }));
    expect(wgsl).toContain(`var ${FP64_GUARD_NAME}: texture_2d<f32>;`);
    expect(wgsl).toContain(`textureLoad(${FP64_GUARD_NAME}, vec2<i32>(0, 0), 0).x`);
  });

  it('injects past the module’s own group-0 bindings (deterministic, collision-free)', () => {
    const U = uniformStruct('P', { group: 0, binding: 3, as: 'p' }, { origin: f64T });
    const k = fn('k', { x: f32T }, (p) => toF32(U.field.origin.add(toF64(p.x))));
    const lowered = fp64Lower(module({ funcs: [k], uses: [U] }));
    const g = lowered.bindings.find((b) => b.name === FP64_GUARD_NAME)!;
    expect([g.group, g.binding]).toEqual([0, 4]);
  });

  it('honours an explicit fp64Guard pin (engine bind-group layouts)', () => {
    const k = fn('k', { a: f64T, b: f64T }, (p) => p.a.add(p.b));
    const lowered = fp64Lower(module({ funcs: [k], uses: [fp64Guard({ group: 2, binding: 5 })] }));
    const g = lowered.bindings.find((b) => b.name === FP64_GUARD_NAME)!;
    expect([g.group, g.binding]).toEqual([2, 5]);
    // No duplicate injection alongside the pin.
    expect(lowered.bindings.filter((b) => b.name === FP64_GUARD_NAME)).toHaveLength(1);
  });

  it('no guard is injected when f64 is carried but never computed (no helpers used)', () => {
    // Pure pass-through: an f64 param forwarded to a user fn — type mapping
    // only, no emulation, so no guard requirement lands on the host.
    const inner = fn('inner', { v: f64T }, (p) => p.v);
    const outer = fn('outer', { v: f64T }, (p) => inner({ v: p.v }));
    const lowered = fp64Lower(module({ funcs: [outer] }));
    expect(lowered.bindings).toEqual([]);
  });

  it('a comparison-ONLY module injects the comparator but NO guard binding', () => {
    // df64_lt/le/gt/ge/eq/ne carry no error term, so they never fetch f64Guard.
    // A declared-but-unused `_fp64` binding is what WebGPU `layout:'auto'` (Tint/
    // Dawn) strips from the derived bind-group layout → a bind-group mismatch →
    // a no-op draw on D3D12/NVIDIA (WebKit keeps it; GLSL has no such layout).
    const k = fn('k', { a: f64T, b: f64T }, (p) => p.a.lt(p.b).select(1.0, 0.0));
    const lowered = fp64Lower(module({ funcs: [k] }));
    expect(lowered.funcs.map((f) => f.name)).toContain('df64_lt');
    expect(lowered.bindings).toEqual([]);
    expect(emitModule(module({ funcs: [k] }))).not.toContain(FP64_GUARD_NAME);
  });

  it('an arithmetic op alongside a comparison still injects the guard', () => {
    const k = fn('k', { a: f64T, b: f64T }, (p) => p.a.add(p.b).lt(p.b).select(1.0, 0.0));
    const lowered = fp64Lower(module({ funcs: [k] }));
    expect(lowered.bindings.some((b) => b.name === FP64_GUARD_NAME)).toBe(true);
  });
});

// ── Integer flavor (df64-int.ts): the Apple/Metal lowering, selected per-device
// by recommendFp64Flavor. Its numerics are covered exhaustively by the fround
// oracle (df64-int-property.test.ts); these lock the PASS/EMIT contract that the
// per-device routing rides on — untested until now, and the invariant a future
// D3D11 compile-cost slim of the bodies (X-GIS #934) must not silently break:
//   1. the leaves actually swap to the integer registry, and
//   2. the module is host-guard-free — the integer bodies never fetch f64Guard,
//      so NO `_fp64` binding is injected. A stray guard reference would re-inject
//      it, and an unused `_fp64` under WebGPU layout:'auto' is exactly the
//      D3D12/NVIDIA bind-group-mismatch no-op-draw the guard machinery fights.
describe('integer flavor — fast-math-immune registry, host-guard-free (X-GIS #934)', () => {
  const arithModule = () =>
    module({ funcs: [fn('k', { a: f64T, b: f64T }, (p) => p.a.add(p.b).mul(p.a))] });

  it('swaps in the integer EFT leaves (df64_ipack/df64_iround) the float flavor never emits', () => {
    const m = arithModule();
    const flo = emitModule(m);
    const int = emitModule(m, { fp64Flavor: 'integer' });
    // The compositions bind by the SAME names in both flavors (drop-in leaves)…
    expect(int).toContain('df64_add');
    expect(int).toContain('df64_mul');
    // …only the integer registry carries its exact-rounding integer leaves.
    expect(int).toContain('df64_ipack');
    expect(int).toContain('df64_iround');
    expect(flo).not.toContain('df64_ipack');
    expect(flo).not.toContain('df64_iround');
  });

  it('injects NO _fp64 guard — the integer bodies never fetch it, so the host binds nothing', () => {
    const m = arithModule();
    // The float flavor guards this exact arithmetic module (see guard auto-injection)…
    expect(fp64Lower(m).bindings.some((b) => b.name === FP64_GUARD_NAME)).toBe(true);
    // …the integer flavor lowers it guard-free: empty bindings, no `_fp64` in emit.
    expect(fp64Lower(m, { flavor: 'integer' }).bindings).toEqual([]);
    expect(emitModule(m, { fp64Flavor: 'integer' })).not.toContain(FP64_GUARD_NAME);
  });
});

describe('fail-loud gates', () => {
  it('SD0042 — a conflicting _fp64 binding (reserved name, wrong shape)', () => {
    const squatter = resource('_fp64', f32T, { group: 0, binding: 0 });
    const k = fn('k', { a: f64T, b: f64T }, (p) => p.a.add(p.b));
    expect(() => fp64Lower(module({ funcs: [k], uses: [squatter] }))).toThrow(/SD0042/);
  });

  it('SD0041 — a non-whitelisted builtin on f64 operands', () => {
    // exp is NOT emulated (sin/cos ARE — see the transcendentals block below).
    // The key-domain bound now rejects this at tsc too; the runtime SD0041 stays
    // the backstop for raw-IR authoring that bypasses the typed surface.
    // @ts-expect-error — exp's key domain is FloatKey (no f64)
    const k = fn('k', { a: f64T }, (p) => exp(p.a));
    expect(() => fp64Lower(module({ funcs: [k] }))).toThrow(/SD0041/);
  });

  it("SD0043 — authored fn names must not squat the reserved 'df64_' prefix", () => {
    const bad = fn('df64_mine', { a: f64T }, (p) => p.a.add(p.a));
    expect(() => fp64Lower(module({ funcs: [bad] }))).toThrow(/SD0043/);
  });

  it('SD0044 — an interpolated @location IO field of f64 is rejected', () => {
    const Out = ioStruct('VOut', {
      pos: builtin('position', vec4fT),
      depth: location(0, f64T),
    });
    const vs = fn(
      'vs',
      { a: f64T },
      (p) => {
        const o = Out.var();
        o.depth.assign(p.a);
        return o;
      },
      { stage: 'vertex' },
    );
    expect(() => fp64Lower(module({ funcs: [vs], structs: [Out.decl] }))).toThrow(/SD0044/);
  });
});

describe('optimizer invariants (the guard survives O2)', () => {
  it('df64_* calls stay opaque and every injected helper still threads the guard after the fixpoint', () => {
    const k = fn('k', { a: f64T, b: f64T }, (p) => sqrt(p.a.add(p.b).mul(p.a).div(p.b)));
    const wgsl = emitModule(module({ funcs: [k] }));
    // The entry still CALLS the helpers (nothing inlined the EFT bodies).
    expect(wgsl).toMatch(/df64_sqrt\(/);
    expect(wgsl).toMatch(/df64_div\(/);
    // Every EFT-bearing helper body still multiplies through the opaque one —
    // the algebraic pass must never treat the guard as `* 1.0`. The helpers take it
    // as the `_fp64_g` parameter; the caller reads the texel.
    for (const name of ['df64_twoSum', 'df64_quickTwoSum', 'df64_split']) {
      const body = wgsl.split(`fn ${name}(`)[1]!.split('\nfn ')[0]!;
      expect(body).toMatch(/\* _fp64_g\b/);
    }
    expect(wgsl).toContain('let _fp64_g = textureLoad(_fp64, vec2<i32>(0, 0), 0).x;');
  });

  it('df64_sin / df64_cos stay opaque (not inlined / algebraically folded) after O2', () => {
    const k = fn('k', { a: f64T }, (p) => toF32(sin(p.a).add(cos(p.a))));
    const wgsl = emitModule(module({ funcs: [k] }));
    // The transcendental helpers survive as CALLS — the optimizer must never
    // inline an EFT-bearing body (algebraic/const-fold could then cancel the
    // error terms) nor const-fold a df64_sin over a constant argument.
    expect(wgsl).toMatch(/fn df64_sin\(/);
    expect(wgsl).toMatch(/fn df64_cos\(/);
    expect(wgsl).toMatch(/\bdf64_sin\(/);
    expect(wgsl).toMatch(/\bdf64_cos\(/);
    // The reduction's own guard threads survive: the Taylor bodies multiply
    // through df64_mul, whose split/twoProd still fetch the opaque one.
    for (const name of ['df64_sin_taylor', 'df64_cos_taylor']) {
      const body = wgsl.split(`fn ${name}(`)[1]!.split('\nfn ')[0]!;
      expect(body).toMatch(/df64_mul\(/);
    }
  });
});

// ── The guard: chains folded, threaded as a parameter, read once per function ──
//
// fp64-lower's "The guard" section. The helpers used to fetch the guard texel themselves, so
// every helper CALL fetched it: eight fetches per `acc * k + c`, all inside the loop that
// called it, and twoSum's error term multiplied by the guard three times in a row.
describe('the guard: folded, threaded, read once per function', () => {
  const G: Expr = { op: 'call', type: f32T, fn: 'f64Guard', args: [] };
  const x: Expr = { op: 'param', type: f32T, name: 'x' };
  const y: Expr = { op: 'param', type: f32T, name: 'y' };
  const mul = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: f32T, bop: '*', a, b });
  const div = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: f32T, bop: '/', a, b });

  it('guard(guard(x)) folds to guard(x), and only a chain folds', () => {
    expect(foldGuardChain(mul(mul(x, G), G))).toEqual(mul(x, G));
    // luma.gl's twoSum tail, `(…) * ONE * ONE * ONE`, is ONE guard.
    expect(foldGuardChain(mul(mul(mul(x, G), G), G))).toEqual(mul(x, G));
    expect(foldGuardChain(mul(G, mul(x, G)))).toEqual(mul(x, G));
    expect(foldGuardChain(mul(G, G))).toEqual(G);
    // Not chains: two guarded values, a guarded value times an unguarded one, a quotient.
    for (const e of [mul(mul(x, G), mul(y, G)), mul(mul(x, G), y), mul(div(x, G), G), mul(x, G)])
      expect(foldGuardChain(e)).toEqual(e);
  });

  /** Every product with the guard `isG` recognises whose other factor ALREADY rides it. */
  const doubledGuards = (decls: readonly FuncDecl[], isG: (e: Expr) => boolean): string[] => {
    const rides = (e: Expr): boolean =>
      isG(e) || (e.op === 'binop' && e.bop === '*' && (isG(e.a) || isG(e.b)));
    const out: string[] = [];
    for (const d of decls)
      for (const s of d.body)
        eachStmtExpr(s, (e) =>
          eachExpr(e, (n) => {
            if (n.op !== 'binop' || n.bop !== '*') return;
            const other = isG(n.b) ? n.a : isG(n.a) ? n.b : undefined;
            if (other !== undefined && rides(other)) out.push(d.name);
          }),
        );
    return out;
  };

  // Pulls in the scalar, vec3 and mat3 helpers: every EFT leaf and most compositions.
  const wide = (): ModuleDecl =>
    module({
      funcs: [
        fn('k', { a: f64T, b: f64T, u: vec3f64T, w: vec3f64T, m: mat3f64T }, f32T, (p, bb) => {
          const s = bb.let(
            sqrt(abs(p.a.sub(p.b).div(p.a.mul(p.b))))
              .add(sin(p.a))
              .add(cos(p.b))
              .add(floor(p.a))
              .add(fract(p.b))
              .add(min(p.a, max(p.a, p.b)))
              .add(mix(p.a, p.b, 0.5)),
          );
          const v = bb.let(normalize(p.u.add(p.w).mul(p.u).div(p.w)));
          const t = bb.let(transformMat64(transpose64(mulMat64(p.m, p.m)), v));
          bb.ret(toF32(s.add(dot(t, p.u)).add(length(v)).add(distance(p.u, p.w))));
        }),
      ],
    });

  it('no helper multiplies by the guard twice in a row — in the registry or in a lowered module', () => {
    // The registry as written: the chain luma.gl's twoSum and twoSqr carried is gone at the source…
    expect(doubledGuards(DF64_ORDER, (e) => e.op === 'call' && e.fn === 'f64Guard')).toEqual([]);
    // …and the lowered helpers, where the guard is the `_fp64_g` parameter.
    const helpers = fp64Lower(wide()).funcs.filter((f) => f.name.startsWith('df64_'));
    expect(helpers.length).toBeGreaterThan(30);
    expect(doubledGuards(helpers, (e) => e.op === 'param' && e.name === '_fp64_g')).toEqual([]);
  });

  it('a helper that needs the guard takes it as its last parameter and never fetches it', () => {
    const lowered = fp64Lower(wide());
    const fetches = (f: FuncDecl): number => {
      let n = 0;
      for (const s of f.body)
        eachStmtExpr(s, (e) =>
          eachExpr(e, (x) => {
            if (x.op === 'call' && x.fn === 'f64Guard') n++;
          }),
        );
      return n;
    };
    const helpers = lowered.funcs.filter((f) => f.name.startsWith('df64_'));
    for (const h of helpers) expect(fetches(h), h.name).toBe(0);
    const guarded = helpers.filter((h) => h.params.at(-1)?.name === '_fp64_g');
    for (const h of guarded) expect(h.params.at(-1)!.type).toEqual(f32T);
    // The EFT leaves and the compositions over them take it; the comparisons and the narrow
    // carry no error term and do not.
    for (const name of ['df64_twoSum', 'df64_quickTwoSum', 'df64_split', 'df64_add', 'df64_mul'])
      expect(guarded.map((h) => h.name)).toContain(name);
    for (const h of helpers.filter((h) => /^df64_(lt|le|gt|ge|eq|ne|narrow)$/.test(h.name)))
      expect(
        h.params.some((q) => q.name === '_fp64_g'),
        h.name,
      ).toBe(false);
  });

  // `acc = acc * k + c`, eight times: the loop the complaint was measured on.
  const loop = (): ModuleDecl =>
    module({
      funcs: [
        fn('k', { k: f64T, c: f64T }, f32T, (p, bb) => {
          const acc = bb.var('acc', f64T, f64(0));
          bb.forRange(
            'i',
            i32(0),
            (i) => i.lt(i32(8)),
            (cb) => {
              cb.assign(acc, acc.mul(p.k).add(p.c));
            },
          );
          bb.ret(toF32(acc));
        }),
      ],
    });

  it('each function reads the texel once, at its top, before any loop — WGSL and GLSL', () => {
    const wgsl = emitModule(loop());
    expect(wgsl.match(/textureLoad\(_fp64/g)).toHaveLength(1);
    const k = wgsl.slice(wgsl.indexOf('fn k('), wgsl.indexOf('\n}\n', wgsl.indexOf('fn k(')));
    expect(k.indexOf('let _fp64_g = textureLoad(_fp64, vec2<i32>(0, 0), 0).x;')).toBeGreaterThan(0);
    expect(k.indexOf('let _fp64_g')).toBeLessThan(k.indexOf('for ('));
    expect(k).toContain('df64_add(df64_mul(acc, k, _fp64_g), c, _fp64_g)');
    // Every helper declares the parameter rather than reading the texture.
    for (const f of wgsl
      .split('\nfn ')
      .filter((f) => f.startsWith('df64_twoSum') || f.startsWith('df64_add')))
      expect(f.slice(0, f.indexOf('{'))).toContain('_fp64_g: f32');

    const glsl = emitGlslModule(loop(), 'fragment');
    expect(glsl.match(/texelFetch\(_fp64/g)).toHaveLength(1);
    expect(glsl.indexOf('float _fp64_g = texelFetch(_fp64, ivec2(0, 0), 0).x;')).toBeLessThan(
      glsl.indexOf('for ('),
    );
  });

  it('the single read does not depend on the optimizer: O0 reads once per function too', () => {
    const wgsl = emitModuleAt(loop(), 'O0');
    expect(wgsl.match(/textureLoad\(_fp64/g)).toHaveLength(1);
  });

  it('the guard value stays a runtime read — never a constant a compiler could infer', () => {
    const wgsl = emitModule(loop());
    expect(wgsl).toContain('let _fp64_g = textureLoad(');
    expect(wgsl).not.toMatch(/\b(const|override)\s+_fp64_g\b/);
    // Inside a helper it is the parameter, multiplied through as written: no `* 1.0` stands
    // in for it, and nothing folded the multiply away.
    const twoSum = wgsl.split('fn df64_twoSum(')[1]!.split('\nfn ')[0]!;
    expect(twoSum.match(/\* _fp64_g\b/g)).toHaveLength(4);
    expect(twoSum).not.toMatch(/\* 1\.0\b/);
    const glsl = emitGlslModule(loop(), 'fragment');
    expect(glsl).not.toMatch(/const\s+float\s+_fp64_g\b/);
    // GLSL ES 3.00 defaults sampler2D to lowp in both stages; the guard declares highp.
    expect(glsl).toContain('uniform highp sampler2D _fp64;');
  });

  it('a loop-invariant df64 call is still hoisted out of its loop', () => {
    // Were the guard bound to a local BEFORE the optimizer, every df64 call would reference
    // a local and LICM, which hoists only what references none, would leave this one inside.
    const m = module({
      funcs: [
        fn('k', { a: f64T, b: f64T }, f32T, (p, bb) => {
          const acc = bb.var('acc', f64T, f64(0));
          bb.forRange(
            'i',
            i32(0),
            (i) => i.lt(i32(8)),
            (cb) => {
              cb.assign(acc, acc.add(p.a.mul(p.b)));
            },
          );
          bb.ret(toF32(acc));
        }),
      ],
    });
    const wgsl = emitModule(m);
    const hoisted = /let (_\w+) = df64_mul\(a, b, _fp64_g\);/.exec(wgsl);
    expect(hoisted).not.toBeNull();
    expect(wgsl.indexOf(hoisted![0])).toBeLessThan(wgsl.indexOf('for ('));
    expect(wgsl).toContain(`acc = df64_add(acc, ${hoisted![1]}, _fp64_g);`);
  });

  it('hoistGuardFetch picks a fresh name when _fp64_g is taken, and is the identity without a fetch', () => {
    const m = module({
      funcs: [
        fn('k', { a: f64T, b: f64T }, f32T, (p, bb) => {
          const taken = bb.let('_fp64_g', p.a.mul(p.b));
          bb.ret(toF32(taken.add(p.b)));
        }),
      ],
    });
    const out = hoistGuardFetch(fp64Lower(m));
    const k = out.funcs.find((f) => f.name === 'k')!;
    expect(k.body[0]).toMatchObject({ s: 'let', name: '_fp64_g1' });
    const plain = module({ funcs: [fn('p', { x: f32T }, (q) => q.x.add(1))] });
    expect(hoistGuardFetch(plain)).toBe(plain);
    // Idempotent: a second run finds each function already reading the guard once.
    expect(hoistGuardFetch(out)).toBe(out);
  });
});
