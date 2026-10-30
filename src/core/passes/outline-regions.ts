// Rebuild function boundaries around repeated pure arithmetic regions. Canonical
// parameters capture differing caller names; operation order and literals stay exact.
import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/index.js';
import { eachStmtExpr, mapChildren, mapStmtExpr } from '../ir/visit.js';
import { typeKey } from '../ir/types.js';
import { exprHasEffect, fnWrites } from './effects.js';
import { bodyHasRaw, keyOf } from './opt/expr-utils.js';

type Region = { key: string; expr: Expr; args: Expr[]; params: FuncDecl['params']; cost: number };

export function outlineRegions(m: ModuleDecl, fresh: (label: string) => string): ModuleDecl {
  if (m.funcs.some((f) => bodyHasRaw(f.body))) return m;
  const writes = fnWrites(m),
    declared = new Set(m.funcs.map((f) => f.name));
  const region = (e: Expr): Region | undefined => {
    if (!['scalar', 'vec', 'f64', 'vec64'].includes(e.type.kind) || exprHasEffect(e, writes))
      return undefined;
    const args: Expr[] = [],
      params: FuncDecl['params'][number][] = [];
    const leaves = new Map<string, number>();
    let cost = 0,
      invalid = false;
    const rw = (x: Expr): Expr => {
      cost++;
      if (x.op === 'lit' || x.op === 'constref' || x.op === 'overrideref') return x;
      if (
        x.op === 'binop' ||
        x.op === 'unop' ||
        x.op === 'compare' ||
        x.op === 'construct' ||
        (x.op === 'call' && !declared.has(x.fn))
      )
        return mapChildren(x, rw);
      // Loads, field accesses, helper calls and conditional expressions remain
      // intact as arguments. In particular, never lift a short-circuited operand.
      if (!['scalar', 'vec', 'f64', 'vec64'].includes(x.type.kind)) invalid = true;
      const k = keyOf(x);
      let i = leaves.get(k);
      if (i === undefined) {
        i = args.length;
        leaves.set(k, i);
        args.push(x);
        params.push({ name: `_regionArg${i}`, type: x.type });
      }
      return { op: 'param', type: x.type, name: params[i]!.name };
    };
    const expr = rw(e);
    if (invalid || cost < 12 || args.length === 0 || args.length > 8 || cost > 128)
      return undefined;
    return {
      key: `${typeKey(e.type)}:${params.map((p) => typeKey(p.type)).join(',')}:${keyOf(expr)}`,
      expr,
      args,
      params,
      cost,
    };
  };
  const groups = new Map<string, { r: Region; uses: number; functions: Set<string> }>();
  for (const f of m.funcs) {
    if (f.opaque || bodyHasRaw(f.body)) continue;
    const gather = (e: Expr): Expr => {
      const r = region(e);
      if (r) {
        const g = groups.get(r.key) ?? { r, uses: 0, functions: new Set<string>() };
        g.uses++;
        g.functions.add(f.name);
        groups.set(r.key, g);
      }
      return mapChildren(e, gather);
    };
    for (const s of f.body) eachStmtExpr(s, gather);
  }
  const candidates = new Set(
    [...groups]
      .filter(
        ([, g]) =>
          g.functions.size >= 2 &&
          (g.r.cost - g.r.args.length - 1) * g.uses > g.r.cost + g.r.params.length,
      )
      .sort((a, b) => b[1].r.cost - a[1].r.cost)
      .slice(0, 8)
      .map(([k]) => k),
  );
  const helpers = new Map<string, FuncDecl>();
  const uses = new Map<string, number>();
  const rw = (e: Expr): Expr => {
    const r = region(e);
    if (r && candidates.has(r.key)) {
      let fn = helpers.get(r.key);
      if (!fn) {
        const params = r.params.map((p) => ({ ...p, name: fresh('input') }));
        const names = new Map(r.params.map((p, i) => [p.name, params[i]!.name]));
        const rename = (x: Expr): Expr =>
          x.op === 'param' && names.has(x.name)
            ? { ...x, name: names.get(x.name)! }
            : mapChildren(x, rename);
        fn = {
          name: fresh('shared'),
          params,
          ret: e.type,
          body: [{ s: 'return', expr: rename(r.expr) }],
        };
        helpers.set(r.key, fn);
      }
      uses.set(r.key, (uses.get(r.key) ?? 0) + 1);
      return { op: 'call', fn: fn.name, declRef: fn, type: e.type, args: r.args };
    }
    return mapChildren(e, rw);
  };
  const stmt = (s: Stmt): Stmt => mapStmtExpr(s, rw, stmt);
  const funcs = m.funcs.map((f) => (f.opaque ? f : { ...f, body: f.body.map(stmt) }));
  // Overlapping larger regions can consume every but one use of a smaller one.
  // Inline such a singleton back; it provides no interprocedural sharing.
  const undo = new Map(
    [...helpers].filter(([k]) => (uses.get(k) ?? 0) < 2).map(([, f]) => [f.name, f]),
  );
  const restore = (e: Expr): Expr => {
    if (e.op === 'call' && undo.has(e.fn)) {
      const fn = undo.get(e.fn)!,
        ret = fn.body[0]!;
      const subst = new Map(fn.params.map((p, i) => [p.name, e.args[i]!]));
      const replace = (x: Expr): Expr =>
        x.op === 'param' && subst.has(x.name) ? subst.get(x.name)! : mapChildren(x, replace);
      if (ret.s === 'return' && ret.expr) return replace(ret.expr);
    }
    return mapChildren(e, restore);
  };
  const restored = (s: Stmt): Stmt => mapStmtExpr(s, restore, restored);
  return {
    ...m,
    funcs: [
      ...funcs.map((f) => ({ ...f, body: f.body.map(restored) })),
      ...[...helpers.values()].filter((f) => !undo.has(f.name)),
    ],
  };
}
