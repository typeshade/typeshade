// Fuse aggregate producer/consumer call trees into new helpers, then outline
// repeated pure expression regions. Authored function boundaries are not an ABI.
import { stageOf } from '../ir/index.js';
import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/index.js';
import { eachExpr, eachStmtExpr, mapChildren, mapStmtExpr } from '../ir/visit.js';
import { typeKey } from '../ir/types.js';
import { collectFnRefs } from '../ir/collect-refs.js';
import {
  bodyHasEffectfulCall,
  exprHasEffect,
  fnReads,
  fnWrites,
  inheritEffects,
} from './effects.js';
import { bodyHasRaw, collectLocals, keyOf } from './opt/expr-utils.js';
import { mapExpr } from './opt/ir-transform.js';
import { fixpoint, LEVEL_PASSES } from './opt/optimize.js';
import { memberFold } from './opt/member-fold.js';
import { scalarizeLocals } from './scalarize-locals.js';
import { outlineRegions } from './outline-regions.js';
import { connectLocalCalls } from './connect-local-calls.js';

function count(f: FuncDecl): number {
  let n = 0;
  for (const s of f.body) eachStmtExpr(s, (e) => eachExpr(e, () => n++));
  return n;
}

export function restructureCalls(m: ModuleDecl): ModuleDecl {
  if (!m.funcs.some((f) => stageOf(f) !== undefined) || m.funcs.some((f) => bodyHasRaw(f.body)))
    return m;
  const names = new Set<string>();
  for (const x of [
    ...m.funcs,
    ...m.structs,
    ...m.bindings,
    ...m.consts,
    ...(m.vars ?? []),
    ...(m.externs ?? []),
    ...(m.overrides ?? []),
  ])
    names.add(x.name);
  for (const f of m.funcs) {
    collectLocals(f.body, names);
    for (const p of f.params) names.add(p.name);
    for (const s of f.body)
      eachStmtExpr(s, (e) =>
        eachExpr(e, (x) => {
          if ('name' in x) names.add(x.name);
        }),
      );
  }
  let next = 0;
  const fresh = (label: string): string => {
    let name: string;
    do {
      name = `_flow${next++}_${label}`;
    } while (names.has(name));
    names.add(name);
    return name;
  };
  const writes = fnWrites(m);
  const reads = fnReads(m);
  const byName = new Map(m.funcs.map((f) => [f.name, f]));
  const eligible = new Map<string, boolean>();
  for (const f of m.funcs)
    eligible.set(
      f.name,
      stageOf(f) === undefined &&
        !f.kernel &&
        !f.opaque &&
        f.ret.kind !== 'void' &&
        !f.params.some((p) => p.mode === 'inout') &&
        count(f) <= 800 &&
        !bodyHasEffectfulCall(f.body, writes) &&
        (writes.get(f.name)?.size ?? 0) === 0,
    );
  const singleExit = (f: FuncDecl): boolean => {
    if (f.body.at(-1)?.s !== 'return') return false;
    let returns = 0,
      invalid = false;
    const scan = (s: Stmt): void => {
      if (s.s === 'return') returns++;
      if (s.s === 'discard' || s.s === 'raw' || s.s === 'placeholder') invalid = true;
      eachStmtExpr(s, () => {}, scan);
    };
    for (const s of f.body) scan(s);
    return returns === 1 && !invalid;
  };
  const containsAggregate = (e: Expr): boolean => {
    let yes = false;
    eachExpr(e, (x) => {
      if (
        x.op === 'call' &&
        eligible.get(x.fn) &&
        (x.type.kind === 'struct' || x.type.kind === 'array')
      )
        yes = true;
    });
    return yes;
  };
  const created: FuncDecl[] = [];
  const shared = new Map<string, FuncDecl>();
  const replaced = new Set<string>();
  let copied = 0;
  const fuse = (call: Extract<Expr, { op: 'call' }>): Expr => {
    const root = byName.get(call.fn);
    if (
      !root ||
      !eligible.get(root.name) ||
      !call.args.some(containsAggregate) ||
      exprHasEffect(call, writes)
    )
      return call;
    const params: FuncDecl['params'][number][] = [],
      args: Expr[] = [];
    const leaves = new Map<string, number>();
    const body: Stmt[] = [];
    let nodes = 0,
      producers = 0;
    const snapshot = (f: FuncDecl, actual: Expr[]): { body: Stmt[]; ret?: Expr } => {
      const rename = new Map<string, string>();
      const locals = new Set<string>();
      collectLocals(f.body, locals);
      for (const n of locals) rename.set(n, fresh('local'));
      f.params.forEach((p, i) => {
        const name = fresh('arg');
        rename.set(p.name, name);
        body.push({ s: 'let', name, expr: actual[i]! });
      });
      const rw = (e: Expr): Expr =>
        mapExpr(e, (x) =>
          (x.op === 'param' || x.op === 'varref') && rename.has(x.name)
            ? { op: 'varref', type: x.type, name: rename.get(x.name)! }
            : x,
        );
      const stmt = (s: Stmt): Stmt => {
        const mapped = mapStmtExpr(s, rw, stmt);
        return mapped.s === 'let' || mapped.s === 'var'
          ? { ...mapped, name: rename.get(mapped.name)! }
          : mapped;
      };
      const renamed = f.body.map(stmt);
      const last = renamed.at(-1);
      return { body: renamed, ret: last?.s === 'return' ? last.expr : undefined };
    };
    const value = (e: Expr, depth: number): { expr: Expr; key: string } => {
      const f = e.op === 'call' ? byName.get(e.fn) : undefined;
      if (
        e.op === 'call' &&
        f &&
        eligible.get(f.name) &&
        singleExit(f) &&
        depth < 4 &&
        (e.type.kind === 'struct' || e.type.kind === 'array' || e.args.some(containsAggregate)) &&
        e.args.length === f.params.length
      ) {
        const children = e.args.map((a) => value(a, depth + 1));
        const inlined = snapshot(
          f,
          children.map((c) => c.expr),
        );
        body.push(...inlined.body.slice(0, -1));
        nodes += count(f);
        producers++;
        return { expr: inlined.ret!, key: `${f.name}(${children.map((c) => c.key).join(',')})` };
      }
      const k = keyOf(e);
      let i = leaves.get(k);
      if (i === undefined) {
        i = args.length;
        leaves.set(k, i);
        args.push(e);
        params.push({ name: fresh('input'), type: e.type });
      }
      return {
        expr: { op: 'param', name: params[i]!.name, type: e.type },
        key: `p${i}:${typeKey(e.type)}`,
      };
    };
    if (call.args.length !== root.params.length) return call;
    const children = call.args.map((a) => value(a, 0));
    if (producers === 0 || params.length > 12) return call;
    const key = `${root.name}(${children.map((c) => c.key).join(',')})`;
    const old = shared.get(key);
    if (old) return { ...call, fn: old.name, declRef: old, args };
    nodes += count(root);
    if (nodes > 1600 || copied + nodes > 6400 || created.length >= 8) return call;
    body.push(
      ...snapshot(
        root,
        children.map((c) => c.expr),
      ).body,
    );
    const draft: FuncDecl = { name: fresh('fused'), params, ret: root.ret, body };
    const scope = { ...m, funcs: [...m.funcs, ...created, draft] };
    const scalar = scalarizeLocals(draft, scope, fresh);
    const full = { ...scope, funcs: [...scope.funcs.slice(0, -1), scalar] };
    const view = { ...full, funcs: [scalar] };
    inheritEffects(full, view);
    const fn = fixpoint(view, [...LEVEL_PASSES.O1, memberFold]).funcs[0]!;
    if (count(fn) > 2400) return call;
    shared.set(key, fn);
    created.push(fn);
    copied += nodes;
    replaced.add(root.name);
    return { ...call, fn: fn.name, declRef: fn, args };
  };
  // Outer-first: preserve the whole producer/consumer tree as one candidate.
  const rw = (e: Expr): Expr => {
    if (e.op === 'call') {
      const out = fuse(e);
      if (out !== e) return out;
    }
    return mapChildren(e, rw);
  };
  const stmt = (s: Stmt): Stmt => mapStmtExpr(s, rw, stmt);
  let out = {
    ...m,
    funcs: [
      ...m.funcs.map((f) => {
        if (f.opaque) return f;
        const connected = connectLocalCalls(f, eligible, writes, reads, fuse);
        return { ...connected, body: connected.body.map(stmt) };
      }),
      ...created,
    ],
  };
  // Replaced roots disappear only if no retained function can still call them.
  const retained = new Map(out.funcs.map((f) => [f.name, f]));
  const live = new Set<string>();
  const visit = (name: string): void => {
    if (live.has(name)) return;
    live.add(name);
    const f = retained.get(name);
    if (f) for (const n of collectFnRefs(f).calls) visit(n);
  };
  for (const f of out.funcs) if (!replaced.has(f.name)) visit(f.name);
  out = { ...out, funcs: out.funcs.filter((f) => live.has(f.name)) };
  return outlineRegions(out, fresh);
}
