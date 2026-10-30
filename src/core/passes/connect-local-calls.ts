// Expose single-use producer/consumer edges hidden by local value snapshots.
// Speculative expansion is committed only when it forms an accepted fused helper.
import type { Expr, FuncDecl, Stmt } from '../ir/index.js';
import { eachExpr, eachStmtExpr, mapChildren } from '../ir/visit.js';
import { bodyHasEffectfulCall, type FnReads, type FnWrites } from './effects.js';
import { collectLocals, collectMutatedRoots, mapStmtValue, refsLocal } from './opt/expr-utils.js';

type Call = Extract<Expr, { op: 'call' }>;
type Producer = { expr: Call; sites: ReadonlySet<number> };

export function connectLocalCalls(
  f: FuncDecl,
  eligible: ReadonlyMap<string, boolean>,
  writes: FnWrites,
  reads: FnReads,
  fuse: (call: Call) => Expr,
): FuncDecl {
  const uses = new Map<string, number>();
  const owned = new Set(f.params.filter((p) => p.mode !== 'inout').map((p) => p.name));
  collectLocals(f.body, owned);
  const mutated = new Set<string>();
  collectMutatedRoots(f.body, mutated, writes);
  for (const s of f.body)
    eachStmtExpr(s, (e) =>
      eachExpr(e, (x) => {
        if (x.op === 'varref') uses.set(x.name, (uses.get(x.name) ?? 0) + 1);
      }),
    );
  const block = (body: readonly Stmt[]): Stmt[] => {
    const available = new Map<string, Producer>();
    const removed = new Set<number>();
    const out: Stmt[] = [];
    const expand = (e: Expr, sites: Set<number>, depth = 0): Expr => {
      if (depth >= 4) return e;
      if (e.op === 'varref') {
        const producer = available.get(e.name);
        if (producer) {
          for (const i of producer.sites) sites.add(i);
          return producer.expr;
        }
      }
      // Never move an unconditional snapshot into a conditional operand.
      if (e.op === 'logical') return { ...e, a: expand(e.a, sites, depth + 1) };
      if (e.op === 'select') return { ...e, cond: expand(e.cond, sites, depth + 1) };
      if (e.op === 'matchExpr') return { ...e, scrutinee: expand(e.scrutinee, sites, depth + 1) };
      return mapChildren(e, (x) => expand(x, sites, depth + 1));
    };
    const rewrite = (e: Expr): Expr => {
      if (e.op === 'varref') {
        const producer = available.get(e.name);
        if (producer) {
          const result = fuse(producer.expr);
          if (result !== producer.expr) {
            for (const i of producer.sites) removed.add(i);
            return result;
          }
        }
      }
      if (e.op === 'call') {
        const sites = new Set<number>();
        const candidate = expand(e, sites) as Call;
        if (sites.size > 0) {
          const result = fuse(candidate);
          if (result !== candidate) {
            for (const i of sites) removed.add(i);
            return result;
          }
        }
      }
      if (e.op === 'logical') return { ...e, a: rewrite(e.a) };
      if (e.op === 'select') return { ...e, cond: rewrite(e.cond) };
      if (e.op === 'matchExpr') return { ...e, scrutinee: rewrite(e.scrutinee) };
      return mapChildren(e, rewrite);
    };
    body.forEach((s, i) => {
      // Do not move snapshots across control flow, writes to any non-local place,
      // synchronisation or an effectful call (including inout and atomic reads).
      if (s.s === 'if' || s.s === 'for' || s.s === 'switch') {
        available.clear();
        if (s.s === 'if')
          out.push({
            ...s,
            arms: s.arms.map((a) => ({ ...a, body: block(a.body) })),
            elseBody: s.elseBody && block(s.elseBody),
          });
        else if (s.s === 'for') out.push({ ...s, body: block(s.body) });
        else
          out.push({
            ...s,
            cases: s.cases.map((c) => ({ ...c, body: block(c.body) })),
            defaultBody: s.defaultBody && block(s.defaultBody),
          });
        return;
      }
      for (const [name, p] of available)
        if ([...p.sites].some((at) => i - at > 32)) available.delete(name);
      const changed = new Set<string>();
      collectMutatedRoots([s], changed, writes);
      const effect = bodyHasEffectfulCall([s], writes);
      const external =
        s.s === 'assign' || s.s === 'assignOp'
          ? s.target.op !== 'varref' || !owned.has(s.target.name)
          : false;
      if (effect || s.s === 'placeholder' || s.s === 'raw') {
        available.clear();
        out.push(s);
        return;
      }
      const init = s.s === 'let' ? s.expr : s.s === 'var' ? s.init : undefined;
      if (
        (s.s === 'let' || s.s === 'var') &&
        init?.op === 'call' &&
        eligible.get(init.fn) &&
        uses.get(s.name) === 1 &&
        !mutated.has(s.name)
      ) {
        const sites = new Set([i]);
        const expr = expand(init, sites) as Call;
        available.set(s.name, { expr, sites });
        out.push(s);
      } else out.push(mapStmtValue(s, rewrite));
      // Snapshots may depend on hidden callee reads as well as explicit arguments.
      for (const [name, p] of available)
        if (changed.has(name) || refsLocal(p.expr, changed, reads)) available.delete(name);
      if (external) available.clear();
      if (s.s === 'return' || s.s === 'break' || s.s === 'continue' || s.s === 'discard')
        available.clear();
    });
    return out.filter((_, i) => !removed.has(i));
  };
  return { ...f, body: block(f.body) };
}
