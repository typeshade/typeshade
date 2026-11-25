import { describe, expect, it } from 'vitest';
import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/index.js';
import { eachExpr, eachStmtExpr } from '../ir/visit.js';
import { accuracyOf } from '../passes/determinism.js';
import { generateChain, generateKernelModule, generateModule } from './random-ir.js';

const SEEDS = Array.from({ length: 80 }, (_, i) => i + 1);

const modulesOf = (exact: boolean): ModuleDecl[] =>
  SEEDS.flatMap((seed) => [
    generateModule(seed, { exact }).module,
    generateKernelModule(seed, { exact }).module,
    generateChain(seed, { exact }).module,
  ]);

const exprsOf = (fn: FuncDecl): Expr[] => {
  const out: Expr[] = [];
  const walk = (st: Stmt): void => eachStmtExpr(st, (e) => eachExpr(e, (x) => out.push(x)), walk);
  fn.body.forEach(walk);
  return out;
};

const FORBIDDEN = [
  '"s":"raw"',
  '"s":"placeholder"',
  'hostBlock',
  'externVar',
  'extern',
  '"kind":"texture',
  '"kind":"sampler',
  '"scalar":"f64"',
  '"elem":"f64"',
];

describe('what the random-IR generator never makes', () => {
  it.each([false, true])(
    'has no raw or placeholder statement, host block, extern, texture, sampler or f64 (exact %s)',
    (exact) => {
      const modules = modulesOf(exact);
      expect(modules.length).toBe(SEEDS.length * 3);
      for (const m of modules) {
        const text = JSON.stringify(m);
        for (const word of FORBIDDEN) expect(text, word).not.toContain(word);
        expect(m.externs ?? []).toEqual([]);
      }
    },
  );

  it('calls only what the determinism report calls exact when exact is set', () => {
    const calls = new Set<string>();
    for (const m of modulesOf(true))
      for (const f of m.funcs)
        for (const e of exprsOf(f)) if (e.op === 'call' && e.fn !== undefined) calls.add(e.fn);
    expect(calls.size).toBeGreaterThan(0);
    const userFunctions = new Set(modulesOf(true).flatMap((m) => m.funcs.map((f) => f.name)));
    for (const name of [...calls].filter((n) => !userFunctions.has(n)))
      expect(accuracyOf(name)?.kind, name).toBe('exact');
  });

  it('calls a function the report does not call exact when exact is not set', () => {
    const calls = new Set<string>();
    for (const m of modulesOf(false))
      for (const f of m.funcs)
        for (const e of exprsOf(f)) if (e.op === 'call' && e.fn !== undefined) calls.add(e.fn);
    expect([...calls].some((name) => accuracyOf(name)?.kind !== 'exact')).toBe(true);
  });
});
