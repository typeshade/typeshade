// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import type { Expr, FuncDecl, Stmt } from '../../../../core/ir/nodes.js';
import type { SourceSpan } from '../../../../core/ir/span.js';
import { u32T } from '../../../../core/ir/types.js';
import { eachExpr, eachStmtExpr, mapChildren } from '../../../../core/ir/visit.js';
import { storeAfterLoops } from '../../../../core/passes/kernel-stores.js';
import { describeRead } from '../../kernel-loops.js';

type ForStmt = Stmt & { s: 'for' };

export type GrownMode = 'read' | 'write';

export interface GrownAccess {
  readonly place: Expr & { op: 'index' };
  readonly mode: GrownMode;
  readonly proven: boolean;
  readonly at?: SourceSpan;
  readonly loop?: ForStmt;
  readonly depth: number;
}

export interface GrownSite {
  readonly text: string;
  readonly write: boolean;
}

interface Walk {
  readonly param: string;
  readonly loops: readonly ForStmt[];
  readonly at?: SourceSpan;
  readonly visit: (a: GrownAccess) => Expr;
  readonly fresh?: () => string;
}

const isGrown = (e: Expr, param: string): boolean => e.op === 'param' && e.name === param;

function assigns(body: readonly Stmt[], name: string): boolean {
  let found = false;
  const walk = (s: Stmt): void => {
    if ((s.s === 'assign' || s.s === 'assignOp') && s.target.op === 'varref')
      found ||= s.target.name === name;
    eachStmtExpr(s, () => undefined, walk);
  };
  body.forEach(walk);
  return found;
}

function countsUpToLength(loop: ForStmt, name: string, param: string): boolean {
  const c = loop.counted;
  if (c?.name !== name || c.op !== 'add' || c.step !== 1) return false;
  const cond = loop.cond;
  if (cond.op !== 'compare' || cond.cop !== '<') return false;
  if (cond.a.op !== 'varref' || cond.a.name !== name) return false;
  const len = cond.b;
  if (len.op !== 'call' || len.fn !== 'pushCount' || !isGrown(len.args[0]!, param)) return false;
  const init = loop.init;
  const unsigned = init.s === 'var' && init.type.kind === 'scalar' && init.type.scalar === 'u32';
  return (unsigned || (c.start !== undefined && c.start >= 0)) && !assigns(loop.body, name);
}

function proven(place: Expr & { op: 'index' }, w: Walk): boolean {
  const k = place.idx;
  return k.op === 'varref' && w.loops.some((l) => countsUpToLength(l, k.name, w.param));
}

function access(place: Expr & { op: 'index' }, mode: GrownMode, w: Walk): GrownAccess {
  return {
    place,
    mode,
    proven: proven(place, w),
    ...(w.at !== undefined ? { at: w.at } : {}),
    ...(w.loops[0] !== undefined ? { loop: w.loops[0] } : {}),
    depth: w.loops.length,
  };
}

function reads(e: Expr, w: Walk): Expr {
  const x = mapChildren(e, (c) => reads(c, w));
  return x.op === 'index' && isGrown(x.base, w.param) ? w.visit(access(x, 'read', w)) : x;
}

function target(e: Expr, w: Walk): Expr {
  if (e.op === 'index' && isGrown(e.base, w.param))
    return w.visit(access({ ...e, idx: reads(e.idx, w) }, 'write', w));
  return reads(e, w);
}

const CHECKS = new Set(['pushedReadAt', 'pushedStoreAt']);

function checkedStore(st: Stmt, param: string): boolean {
  if (st.s !== 'assign' && st.s !== 'assignOp') return false;
  let found = false;
  eachExpr(st.target, (x) => {
    found ||=
      x.op === 'index' && isGrown(x.base, param) && x.idx.op === 'call' && CHECKS.has(x.idx.fn);
  });
  return found;
}

function assigned(st: Stmt & { s: 'assign' }, to: Expr, expr: Expr, w: Walk): Stmt[] {
  const idx = to.op === 'index' ? to.idx : undefined;
  if (
    w.fresh === undefined ||
    idx?.op !== 'call' ||
    idx.fn !== 'pushedStoreAt' ||
    to.op !== 'index'
  )
    return [{ ...st, target: to, expr }];
  const [k, v] = [w.fresh(), w.fresh()];
  const span = st.span !== undefined ? { span: st.span } : {};
  const at: Expr = { op: 'varref', type: idx.type, name: k };
  return [
    { s: 'let', name: k, expr: idx.args[1]!, ...span },
    { s: 'let', name: v, expr, ...span },
    {
      ...st,
      target: { ...to, idx: { ...idx, args: [idx.args[0]!, at, idx.args[2]!] } },
      expr: { op: 'varref', type: expr.type, name: v },
    },
  ];
}

function stmts(body: readonly Stmt[], w: Walk): Stmt[] {
  return body.flatMap((st) => stmt(st, w));
}

function stmt(st: Stmt, outer: Walk): Stmt[] {
  const w: Walk = { ...outer, ...(st.span !== undefined ? { at: st.span } : {}) };
  switch (st.s) {
    case 'let':
      return [{ ...st, expr: reads(st.expr, w) }];
    case 'var':
      return [st.init === undefined ? st : { ...st, init: reads(st.init, w) }];
    case 'assign':
      return assigned(st, target(st.target, w), reads(st.expr, w), w);
    case 'assignOp':
      return [{ ...st, target: reads(st.target, w), expr: reads(st.expr, w) }];
    case 'return':
      return [st.expr === undefined ? st : { ...st, expr: reads(st.expr, w) }];
    case 'call':
      return [{ ...st, expr: reads(st.expr, w) }];
    case 'if': {
      const own = storeAfterLoops(st, new Set([w.param]));
      const store = own === undefined ? undefined : stmt(own.store, w);
      if (store !== undefined && store.some((s) => checkedStore(s, w.param))) return store;
      return [
        {
          ...st,
          arms: st.arms.map((a) => ({
            cond: reads(a.cond, w),
            body: store ?? stmts(a.body, w),
          })),
          ...(st.elseBody !== undefined ? { elseBody: stmts(st.elseBody, w) } : {}),
        },
      ];
    }
    case 'switch':
      return [
        {
          ...st,
          scrut: reads(st.scrut, w),
          cases: st.cases.map((c) => ({ ...c, body: stmts(c.body, w) })),
          ...(st.defaultBody !== undefined ? { defaultBody: stmts(st.defaultBody, w) } : {}),
        },
      ];
    case 'for': {
      const inner: Walk = { ...w, loops: [...w.loops, st] };
      return [
        {
          ...st,
          init: stmt(st.init, w)[0]!,
          cond: reads(st.cond, inner),
          update: stmt(st.update, inner)[0]!,
          body: stmts(st.body, inner),
        },
      ];
    }
    default:
      return [st];
  }
}

export function grownAccesses(body: readonly Stmt[], param: string): GrownAccess[] {
  const found: GrownAccess[] = [];
  stmts(body, {
    param,
    loops: [],
    visit: (a) => {
      found.push(a);
      return a.place;
    },
  });
  return found;
}

function namesIn(f: FuncDecl): Set<string> {
  const names = new Set(f.params.map((p) => p.name));
  const walk = (s: Stmt): void => {
    if (s.s === 'let' || s.s === 'var') names.add(s.name);
    eachStmtExpr(
      s,
      (e) =>
        eachExpr(e, (x) => {
          if (x.op === 'varref') names.add(x.name);
        }),
      walk,
    );
  };
  f.body.forEach(walk);
  return names;
}

function checkedIndex(fn: string, a: GrownAccess, site: number, param: Expr): Expr {
  const args = [param, a.place.idx, { op: 'lit' as const, type: u32T, value: site }];
  return { ...a.place, idx: { op: 'call', type: a.place.idx.type, fn, args } };
}

export interface GrownChecks {
  readonly body: readonly Stmt[];
  readonly sites: readonly GrownSite[];
}

const checked = new WeakMap<readonly Stmt[], GrownChecks>();

export function grownChecks(f: FuncDecl, param: string): GrownChecks {
  const known = checked.get(f.body);
  if (known !== undefined) return known;
  const sites: GrownSite[] = [];
  const grown = f.params.find((p) => p.name === param)!;
  const ref: Expr = { op: 'param', type: grown.type, name: param };
  const names = namesIn(f);
  let n = 0;
  const fresh = (): string => {
    let name = `${param}_at${n++}`;
    while (names.has(name)) name = `${param}_at${n++}`;
    names.add(name);
    return name;
  };
  const body = stmts(f.body, {
    param,
    loops: [],
    fresh,
    visit: (a) => {
      if (a.proven) return a.place;
      const text = describeRead(f, { first: { place: a.place, ...(a.at ? { at: a.at } : {}) } });
      sites.push({ text: text?.text ?? param, write: a.mode === 'write' });
      const fn = a.mode === 'write' ? 'pushedStoreAt' : 'pushedReadAt';
      return checkedIndex(fn, a, sites.length - 1, ref);
    },
  });
  const result = { body: sites.length === 0 ? f.body : body, sites };
  checked.set(f.body, result);
  return result;
}
