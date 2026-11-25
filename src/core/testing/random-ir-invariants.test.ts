import { describe, expect, it } from 'vitest';
import type { Expr, FuncDecl, Stmt } from '../ir/index.js';
import { eachExpr, eachStmtExpr } from '../ir/visit.js';
import { typeKey } from '../ir/types.js';
import { validate } from '../passes/validate.js';
import {
  describeCorpus,
  generateChain,
  generateKernelModule,
  generateModule,
  mulberry32,
} from './random-ir.js';

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

const exprsOf = (fn: FuncDecl): Expr[] => {
  const out: Expr[] = [];
  const walk = (st: Stmt): void => eachStmtExpr(st, (e) => eachExpr(e, (x) => out.push(x)), walk);
  fn.body.forEach(walk);
  return out;
};

const stmtsOf = (fn: FuncDecl): { st: Stmt; loops: number }[] => {
  const out: { st: Stmt; loops: number }[] = [];
  const walk = (st: Stmt, loops: number): void => {
    out.push({ st, loops });
    const inner = st.s === 'for' ? loops + 1 : loops;
    eachStmtExpr(
      st,
      () => undefined,
      (b) => walk(b, inner),
    );
  };
  fn.body.forEach((b) => walk(b, 0));
  return out;
};

describe('the random-IR generator keeps what its comments state', () => {
  it('a seed gives one module, and the PRNG gives one stream', () => {
    const draws = (seed: number): number[] => {
      const r = mulberry32(seed);
      return [r(), r(), r()];
    };
    expect(draws(1)).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
    expect(draws(5)).toEqual(draws(5));
    expect(draws(5)).not.toEqual(draws(6));
    for (const v of draws(5)) expect(v >= 0 && v < 1).toBe(true);
    expect(JSON.stringify(generateModule(3))).toBe(JSON.stringify(generateModule(3)));
    expect(JSON.stringify(generateModule(3))).not.toBe(JSON.stringify(generateModule(4)));
    expect(JSON.stringify(generateKernelModule(3))).toBe(JSON.stringify(generateKernelModule(3)));
    expect(JSON.stringify(generateKernelModule(3))).not.toBe(
      JSON.stringify(generateKernelModule(4)),
    );
  });

  it('the options keep their documented defaults and limits', () => {
    expect(generateModule(1).module.funcs).toHaveLength(6);
    expect(generateModule(1, { funcs: 2 }).module.funcs).toHaveLength(2);
    const types = [generateModule(1).module.funcs[0]!.ret];
    const narrow = generateModule(2, { types, funcs: 4 }).module.funcs;
    for (const f of narrow) {
      expect(typeKey(f.ret)).toBe(typeKey(types[0]!));
      for (const p of f.params) expect(typeKey(p.type)).toBe(typeKey(types[0]!));
    }
    expect(generateKernelModule(1).module.funcs).toHaveLength(4);
    expect(generateKernelModule(1, { helpers: 1 }).module.funcs).toHaveLength(2);
    expect(generateChain(1).module.funcs.length).toBeGreaterThanOrEqual(3 + 2);
    for (const n of [2, 3, 6]) expect(generateChain(1, { calls: n }).calls).toHaveLength(n);
  });

  it('a shift count is a u32 literal, a float clamp orders its exact bounds, and exact mode has no length', () => {
    let shifts = 0;
    let clamps = 0;
    let lengths = 0;
    for (const seed of SEEDS) {
      for (const exact of [false, true]) {
        const { module } = generateModule(seed, { exact });
        for (const f of module.funcs)
          for (const e of exprsOf(f)) {
            if (e.op === 'binop' && (e.bop === '<<' || e.bop === '>>')) {
              shifts++;
              expect(typeKey(e.b.type)).toBe('u32');
              expect(e.b.op).toBe('lit');
            }
            if (e.op === 'call' && e.fn === 'length' && exact) lengths++;
            if (e.op === 'call' && e.fn === 'clamp' && exact) {
              clamps++;
              const [, lo, hi] = e.args;
              expect(lo).toMatchObject({ op: 'call', fn: 'min' });
              expect(hi).toMatchObject({ op: 'call', fn: 'max' });
              if (lo?.op === 'call' && hi?.op === 'call')
                expect(JSON.stringify(lo.args)).toBe(JSON.stringify(hi.args));
            }
          }
      }
    }
    expect(shifts).toBeGreaterThan(5);
    expect(clamps).toBeGreaterThan(0);
    expect(lengths).toBe(0);
  });

  it('break and continue stay inside loops, names are unique, and a call names an earlier function', () => {
    for (const seed of SEEDS) {
      for (const { module } of [generateModule(seed), generateKernelModule(seed)]) {
        validate(module);
        module.funcs.forEach((f, at) => {
          const names = new Set<string>();
          for (const { st, loops } of stmtsOf(f)) {
            if (st.s === 'break' || st.s === 'continue')
              expect(loops, `seed ${String(seed)} ${f.name}`).toBeGreaterThan(0);
            if (st.s === 'let' || st.s === 'var') {
              expect(names.has(st.name), `seed ${String(seed)} reuses ${st.name}`).toBe(false);
              names.add(st.name);
            }
          }
          const moduleNames = new Set(module.funcs.map((g) => g.name));
          const earlier = new Set(module.funcs.slice(0, at).map((g) => g.name));
          for (const e of exprsOf(f))
            if (e.op === 'call' && moduleNames.has(e.fn))
              expect(earlier.has(e.fn), `${f.name} calls ${e.fn}`).toBe(true);
        });
      }
    }
  });

  it('a kernel that pushes takes the inputs and a push array, and nothing else', () => {
    for (const seed of SEEDS) {
      const { arrays } = generateKernelModule(seed, { pushes: true });
      expect(arrays.filter((a) => a.role === 'push')).toHaveLength(1);
      expect(arrays[arrays.length - 1]!.role).toBe('push');
      expect(arrays.some((a) => a.role === 'out' || a.role === 'scatter')).toBe(false);
      expect(arrays.some((a) => a.role === 'in')).toBe(true);
      const off = generateKernelModule(seed, { pushes: false });
      expect(off.arrays.some((a) => a.role === 'push')).toBe(false);
    }
  });

  it('the decisions of a push and of stores come from streams of their own', () => {
    const many = Array.from({ length: 300 }, (_, i) => i + 1);
    let pushing = 0;
    let storing = 0;
    for (const seed of many) {
      const own = generateKernelModule(seed);
      const hasPush = own.arrays.some((a) => a.role === 'push');
      if (hasPush) pushing++;
      expect(JSON.stringify(generateKernelModule(seed, { pushes: hasPush }))).toBe(
        JSON.stringify(own),
      );
      const stream = mulberry32(seed ^ 0x0078c0de);
      stream();
      const forced = generateKernelModule(seed, { pushes: true });
      expect(typeKey(forced.arrays[forced.arrays.length - 1]!.elem)).toBe(
        ['f32', 'i32', 'u32'][Math.floor(stream() * 3)],
      );
      if ((own.features['storeAfterLoops'] ?? 0) > 0) storing++;
    }
    expect(pushing / many.length).toBeGreaterThan(0.1);
    expect(pushing / many.length).toBeLessThan(0.3);
    expect(storing / many.length).toBeGreaterThan(0.2);
    expect(storing / many.length).toBeLessThan(0.5);
  });

  it('a kernel with no loop stores after its loops, and an option of its own does not move the others', () => {
    for (const seed of SEEDS) {
      const none = generateKernelModule(seed, { loops: 0 });
      const k = none.module.funcs[none.module.funcs.length - 1]!;
      expect(stmtsOf(k).some(({ st }) => st.s === 'for')).toBe(false);
      expect(none.features['noLoop']).toBe(1);
      expect(none.features['storeAfterLoops'] ?? 0).toBeGreaterThan(0);
      const a = generateKernelModule(seed, { stores: 0 });
      const b = generateKernelModule(seed, { stores: 0, storeLength: false });
      expect(a.arrays).toEqual(b.arrays);
      expect(a.module.structs).toEqual(b.module.structs);
      expect(a.module.funcs.slice(0, -1)).toEqual(b.module.funcs.slice(0, -1));
    }
  });

  it('a range the device holds adds the count array last, to a kernel with a loop that does not push', () => {
    let held = 0;
    for (const seed of SEEDS) {
      const base = generateKernelModule(seed, { pushes: false });
      const dev = generateKernelModule(seed, { pushes: false, deviceRange: true });
      const last = dev.arrays[dev.arrays.length - 1]!;
      expect(last).toEqual({ name: 'c0', elem: expect.anything(), role: 'in' });
      expect(typeKey(last.elem)).toBe('u32');
      expect(dev.arrays.slice(0, -1)).toEqual(base.arrays);
      expect(dev.features['deviceRange']).toBe(1);
      const k = dev.module.funcs[dev.module.funcs.length - 1]!;
      expect(typeKey(k.ret)).toBe('void');
      expect(stmtsOf(k).some(({ st }) => st.s === 'return' && st.expr !== undefined)).toBe(false);
      if (stmtsOf(k).some(({ st }) => st.s === 'for')) held++;
      const pushing = generateKernelModule(seed, { pushes: true, deviceRange: true });
      expect(pushing.arrays.some((a) => a.name === 'c0')).toBe(false);
      expect(pushing.features['deviceRange'] ?? 0).toBe(0);
      const flat = generateKernelModule(seed, { pushes: false, loops: 0, deviceRange: true });
      expect(flat.arrays.some((a) => a.name === 'c0')).toBe(false);
    }
    expect(held).toBeGreaterThan(0);
    expect(held).toBe(SEEDS.length);
  });

  it('a chain has one loop for each call, and a length read is one let of arrayLength on a scratch array', () => {
    let measured = 0;
    for (const seed of SEEDS) {
      const c = generateChain(seed);
      const scratch = new Set(c.arrays.filter((a) => a.scratch).map((a) => a.id));
      for (const call of c.calls) {
        const fn = c.module.funcs.find((f) => f.name === call.fn)!;
        expect(stmtsOf(fn).filter(({ st, loops }) => st.s === 'for' && loops === 0)).toHaveLength(
          1,
        );
        for (const a of call.access) {
          const lets = stmtsOf(fn).filter(
            ({ st }) => st.s === 'let' && st.name === `len_${a.param}`,
          );
          expect(lets.length, `seed ${String(seed)} ${call.fn} ${a.param}`).toBeLessThanOrEqual(1);
          if (lets.length === 1) {
            measured++;
            expect(a.measures).toBe(true);
            expect(scratch.has(a.array)).toBe(true);
            expect(lets[0]!.st).toMatchObject({
              expr: { op: 'call', fn: 'arrayLength', args: [{ op: 'param', name: a.param }] },
            });
          }
        }
      }
      for (const a of c.arrays.filter((x) => x.scratch))
        expect(['f32', 'i32', 'u32']).toContain(typeKey(a.elem));
    }
    expect(measured).toBeGreaterThan(0);
  });

  it('a corpus report adds the counts of its modules', () => {
    const parts = [generateModule(1), generateModule(2), generateModule(3)];
    const total = describeCorpus(parts);
    for (const k of Object.keys(total))
      expect(total[k]).toBe(parts.reduce((n, p) => n + (p.features[k] ?? 0), 0));
    expect(Object.keys(total).length).toBeGreaterThan(3);
    expect(describeCorpus([])).toEqual({});
  });
});
