// Implements: Rule 11.22 (docs/language-design.md; traced in reqs/).
//
// ═══ Constant arguments into a function under a numerical contract (#850 N5) ═══
//
// A call that hands a scalar literal to a function under a numerical contract
// (`FuncDecl.numerics`) gets a copy of that function with the literal in place of the parameter,
// so the contract's rewrites see it: `mix(base, x, curl)` called with `curl = 0` becomes
// `mix(base, x, 0.0)`, which `finite-math` folds to `base`. The substitution itself is exact: a
// parameter that the body never assigns has the argument's value everywhere, and the argument is a
// literal, so evaluating it once or at each use is the same. Calls with the same callee and the
// same literals share one copy. A copy keeps its callee's contract and every other field, so the
// inlining boundary holds it too.
//
// Only functions under a contract are copied: an exact function gains nothing that the default
// optimizer can fold from a literal parameter, and leaving it alone keeps the default output
// byte for byte (the maintainer's decision on #850, 2026-11-02). A scalar literal only: a vector
// literal argument becomes a constant no target can spell (`SD0017`, measured on #850).
//
// It runs at `-O2` after `specializeCalls` and before `finiteMath`. An original that no call
// reaches any more is dropped; a module with no entry is left alone, since its helpers may be
// called by name from outside.

import { stageOf } from '../ir/index.js';
import type { Expr, FuncDecl, ModuleDecl } from '../ir/index.js';
import { collectFnRefs } from '../ir/collect-refs.js';
import { mapChildren, mapStmtExpr } from '../ir/visit.js';
import { fnWrites } from './effects.js';
import { bodyHasRaw, collectMutatedRoots } from './opt/expr-utils.js';
import { underContract } from './contract-boundary.js';

type Call = Extract<Expr, { op: 'call' }>;
type Lit = Extract<Expr, { op: 'lit' }>;

/** The most copies one function gets; calls past the bound keep calling the original. */
const MAX_COPIES = 16;

/** Whether `e` is a scalar numeric literal, the only argument this pass substitutes. */
const isScalarLit = (e: Expr): e is Lit =>
  e.op === 'lit' && typeof e.value === 'number' && e.type.kind === 'scalar';

/** A key that tells `-0` from `0`, which a copy must not share. */
const litKey = (e: Lit): string =>
  `${e.type.kind === 'scalar' ? e.type.scalar : ''}:${Object.is(e.value, -0) ? '-0' : String(e.value)}`;

/** Gives every call that passes a scalar literal to a function under a numerical contract a
 *  copy of that function with the literal substituted. Identity for a module where no function
 *  opted into a contract, where no call passes such a literal, or where no function is an entry. */
export function specializeContractConstants(m: ModuleDecl): ModuleDecl {
  if (
    !m.funcs.some(underContract) ||
    !m.funcs.some((f) => stageOf(f) !== undefined) ||
    m.funcs.some((f) => bodyHasRaw(f.body))
  )
    return m;
  const byName = new Map(m.funcs.map((f) => [f.name, f]));
  const taken = new Set<string>([
    ...m.funcs.map((f) => f.name),
    ...m.structs.map((s) => s.name),
    ...m.bindings.map((b) => b.name),
    ...m.consts.map((c) => c.name),
    ...(m.vars ?? []).map((v) => v.name),
    ...(m.externs ?? []).map((v) => v.name),
    ...(m.overrides ?? []).map((v) => v.name),
  ]);
  const writes = fnWrites(m);
  /** The parameters each contract function never assigns, by name. */
  const constantParams = new Map<string, ReadonlySet<string>>();
  for (const f of m.funcs) {
    if (!underContract(f) || stageOf(f) !== undefined || f.kernel || f.opaque) continue;
    const mutated = new Set<string>();
    collectMutatedRoots(f.body, mutated, writes);
    constantParams.set(
      f.name,
      new Set(
        f.params.filter((p) => p.mode !== 'inout' && !mutated.has(p.name)).map((p) => p.name),
      ),
    );
  }
  const copies = new Map<string, FuncDecl>();
  const copiesOf = new Map<string, number>();
  const made: FuncDecl[] = [];
  const replaced = new Set<string>();
  /** The callee each copy was made from, by the copy's name. */
  const origin = new Map<string, string>();
  let serial = 0;
  const fresh = (base: string): string => {
    let name: string;
    do name = `${base}_k${serial++}`;
    while (taken.has(name));
    taken.add(name);
    return name;
  };

  /** The copy of `callee` with the literals at `at` substituted, made once per key. */
  const copyOf = (
    callee: FuncDecl,
    at: ReadonlyMap<number, Lit>,
    key: string,
  ): FuncDecl | undefined => {
    const known = copies.get(key);
    if (known !== undefined) return known;
    const n = copiesOf.get(callee.name) ?? 0;
    if (n >= MAX_COPIES) return undefined;
    copiesOf.set(callee.name, n + 1);
    const values = new Map<string, Lit>();
    for (const [i, lit] of at)
      values.set(callee.params[i]!.name, { ...lit, type: callee.params[i]!.type });
    const subst = (e: Expr): Expr =>
      (e.op === 'param' || e.op === 'varref') && values.has(e.name)
        ? values.get(e.name)!
        : mapChildren(e, subst);
    const stmt = (s: Parameters<typeof mapStmtExpr>[0]): ReturnType<typeof mapStmtExpr> =>
      mapStmtExpr(s, subst, stmt);
    const copy: FuncDecl = {
      ...callee,
      name: fresh(callee.name),
      params: callee.params.filter((_, i) => !at.has(i)),
      body: callee.body.map(stmt),
    };
    copies.set(key, copy);
    made.push(copy);
    origin.set(copy.name, callee.name);
    replaced.add(callee.name);
    return copy;
  };

  const rewriteCall = (e: Expr): Expr => {
    const x = mapChildren(e, rewriteCall);
    if (x.op !== 'call') return x;
    const callee = byName.get(x.fn);
    const free = callee === undefined ? undefined : constantParams.get(callee.name);
    if (callee === undefined || free === undefined) return x;
    const at = new Map<number, Lit>();
    x.args.forEach((a, i) => {
      const p = callee.params[i];
      if (p !== undefined && free.has(p.name) && isScalarLit(a)) at.set(i, a);
    });
    if (at.size === 0) return x;
    const key = `${callee.name}(${[...at].map(([i, a]) => `${i}=${litKey(a)}`).join(',')})`;
    const copy = copyOf(callee, at, key);
    if (copy === undefined) return x;
    const call: Call = { ...(x as Call), fn: copy.name, args: x.args.filter((_, i) => !at.has(i)) };
    delete (call as { declRef?: FuncDecl }).declRef;
    return call;
  };
  const rewriteFn = (f: FuncDecl): FuncDecl => {
    const stmt = (s: Parameters<typeof mapStmtExpr>[0]): ReturnType<typeof mapStmtExpr> =>
      mapStmtExpr(s, rewriteCall, stmt);
    return { ...f, body: f.body.map(stmt) };
  };

  const funcs = m.funcs.map(rewriteFn);
  // A copy can itself pass a literal on to another contract function; a copy made here is
  // rewritten in its turn.
  for (let i = 0; i < made.length; i++) made[i] = rewriteFn(made[i]!);
  if (made.length === 0) return m;
  // Each copy goes right after its callee, in the order made.
  const placed: FuncDecl[] = [];
  for (const f of funcs) {
    placed.push(f);
    for (const c of made) if (origin.get(c.name) === f.name) placed.push(c);
  }
  const madeNames = new Set(made.map((c) => c.name));
  // Drop an original no call reaches any more.
  const all = new Map(placed.map((f) => [f.name, f]));
  const reached = new Set<string>();
  const visit = (name: string): void => {
    if (reached.has(name)) return;
    reached.add(name);
    const f = all.get(name);
    if (f) for (const n of collectFnRefs(f).calls) visit(n);
  };
  for (const f of placed) if (stageOf(f) !== undefined) visit(f.name);
  // A function this pass did not touch stays, with what it calls.
  for (const f of placed) if (!replaced.has(f.name) && !madeNames.has(f.name)) visit(f.name);
  return { ...m, funcs: placed.filter((f) => reached.has(f.name)) };
}
