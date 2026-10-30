// Cache scalar/vector storage reads inside proven write-free regions. Storage
// bindings are never assumed disjoint, even when their names or indices differ.
import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/index.js';
import { eachExpr, eachStmtExpr, mapChildren, mapStmtExpr } from '../ir/visit.js';
import { bodyHasEffectfulCall, fnWrites } from './effects.js';
import {
  bodyHasRaw,
  collectLocals,
  collectMutatedRoots,
  keyOf,
  mapStmtValue,
  refsLocal,
  rootName,
} from './opt/expr-utils.js';
import { mapExpr } from './opt/ir-transform.js';
import { analyzeLoop } from './opt/unroll.js';

const placeRoot = (e: Expr): string | undefined =>
  e.op === 'member' || e.op === 'index' ? placeRoot(e.base) : rootName(e);

// Conditional operands are not visited: a new cache may only replace a load
// which the original statement was already guaranteed to evaluate.
function mapUnconditional(e: Expr, visit: (e: Expr) => Expr | undefined): Expr {
  const hit = visit(e);
  if (hit) return hit;
  if (e.op === 'logical') return { ...e, a: mapUnconditional(e.a, visit) };
  if (e.op === 'select') return { ...e, cond: mapUnconditional(e.cond, visit) };
  if (e.op === 'matchExpr') return { ...e, scrutinee: mapUnconditional(e.scrutinee, visit) };
  return mapChildren(e, (x) => mapUnconditional(x, visit));
}

export function storageLoadReuse(m: ModuleDecl): ModuleDecl {
  if (m.funcs.some((f) => bodyHasRaw(f.body))) return m;
  const storage = new Set(m.bindings.filter((b) => b.space === 'storage').map((b) => b.name));
  if (storage.size === 0) return m;
  const writes = fnWrites(m);
  const taken = new Set(
    [
      ...m.funcs,
      ...m.bindings,
      ...m.consts,
      ...m.structs,
      ...(m.vars ?? []),
      ...(m.externs ?? []),
      ...(m.overrides ?? []),
    ].map((x) => x.name),
  );
  for (const f of m.funcs) {
    collectLocals(f.body, taken);
    for (const p of f.params) taken.add(p.name);
    for (const s of f.body)
      eachStmtExpr(s, (e) =>
        eachExpr(e, (x) => {
          const name = rootName(x);
          if (name !== undefined) taken.add(name);
        }),
      );
  }
  let next = 0;
  const fresh = (): string => {
    let name: string;
    do {
      name = `_storage${next++}`;
    } while (taken.has(name));
    taken.add(name);
    return name;
  };
  const isLoad = (e: Expr): boolean => {
    if (
      (e.op !== 'index' && e.op !== 'member') ||
      !storage.has(placeRoot(e) ?? '') ||
      !['scalar', 'vec', 'f64', 'vec64'].includes(e.type.kind)
    )
      return false;
    let call = false;
    eachExpr(e, (x) => {
      if (x.op === 'call') call = true;
    });
    return !call;
  };
  const process = (f: FuncDecl): FuncDecl => {
    if (f.opaque) return f;
    const owned = new Set(f.params.filter((p) => p.mode !== 'inout').map((p) => p.name));
    collectLocals(f.body, owned);
    let budget = 32;
    const hoistLoop = (loop: Extract<Stmt, { s: 'for' }>): Stmt[] => {
      const proof = analyzeLoop(loop, 64);
      if (!proof || proof.seq.length < 2 || bodyHasEffectfulCall([loop], writes)) return [loop];
      const changed = new Set<string>();
      collectMutatedRoots([loop], changed, writes);
      if ([...changed].some((n) => !owned.has(n))) return [loop];
      collectLocals([loop], changed);
      const cached = new Map<string, Expr>();
      const preheader: Stmt[] = [];
      let prefix = true;
      const body = loop.body.map((s) => {
        if (!['let', 'var', 'assign', 'assignOp'].includes(s.s)) prefix = false;
        if (!prefix) return s;
        return mapStmtValue(s, (e) =>
          mapUnconditional(e, (x) => {
            if (!isLoad(x) || refsLocal(x, changed)) return undefined;
            const key = keyOf(x),
              old = cached.get(key);
            if (old) return old;
            if (cached.size >= 8 || budget <= 0) return undefined;
            budget--;
            const name = fresh(),
              ref: Expr = { op: 'varref', type: x.type, name };
            cached.set(key, ref);
            preheader.push({ s: 'let', name, expr: x });
            return ref;
          }),
        );
      });
      return [...preheader, { ...loop, body }];
    };
    type Cache = { name: string; expr: Expr; at: number; uses: number };
    const block = (body: readonly Stmt[]): Stmt[] => {
      const live = new Map<string, Cache>();
      const minted: Cache[] = [];
      const out: Stmt[] = [];
      for (let s of body) {
        if (s.s === 'if' || s.s === 'for' || s.s === 'switch') {
          live.clear();
          if (s.s === 'if')
            out.push({
              ...s,
              arms: s.arms.map((a) => ({ ...a, body: block(a.body) })),
              elseBody: s.elseBody && block(s.elseBody),
            });
          else if (s.s === 'for') out.push(...hoistLoop({ ...s, body: block(s.body) }));
          else
            out.push({
              ...s,
              cases: s.cases.map((c) => ({ ...c, body: block(c.body) })),
              defaultBody: s.defaultBody && block(s.defaultBody),
            });
          continue;
        }
        if (bodyHasEffectfulCall([s], writes) || s.s === 'placeholder') {
          live.clear();
          out.push(s);
          continue;
        }
        const changed = new Set<string>();
        collectMutatedRoots([s], changed, writes);
        const at = out.length;
        s = mapStmtValue(s, (e) =>
          mapUnconditional(e, (x) => {
            if (!isLoad(x)) return undefined;
            const key = keyOf(x);
            let cache = live.get(key);
            if (!cache) {
              if (budget <= 0) return undefined;
              budget--;
              cache = { name: fresh(), expr: x, at, uses: 0 };
              live.set(key, cache);
              minted.push(cache);
            }
            cache.uses++;
            return { op: 'varref', type: x.type, name: cache.name };
          }),
        );
        out.push(s);
        if ([...changed].some((n) => !owned.has(n))) live.clear();
        else for (const [key, cache] of live) if (refsLocal(cache.expr, changed)) live.delete(key);
        if (s.s === 'return' || s.s === 'break' || s.s === 'continue' || s.s === 'discard')
          live.clear();
      }
      const restore = new Map(minted.filter((c) => c.uses < 2).map((c) => [c.name, c.expr]));
      budget += restore.size;
      const insert = new Map<number, Stmt[]>();
      for (const c of minted)
        if (c.uses >= 2) {
          const list = insert.get(c.at) ?? [];
          list.push({ s: 'let', name: c.name, expr: c.expr });
          insert.set(c.at, list);
        }
      const rewrite = (e: Expr): Expr =>
        mapExpr(e, (x) => (x.op === 'varref' ? (restore.get(x.name) ?? x) : x));
      return out.flatMap((s, i) => [...(insert.get(i) ?? []), mapStmtExpr(s, rewrite)]);
    };
    return { ...f, body: block(f.body) };
  };
  return { ...m, funcs: m.funcs.map(process) };
}
