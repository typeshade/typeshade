import type { Expr, ModuleDecl, Stmt } from '../ir/index.js';
import { mapChildren } from '../ir/visit.js';
import { eachBlockStmt as eachBodyStmt } from './opt/sroa/blocks.js';
import { adoptTemp } from './inline-small-rename.js';
import { exprHasEffect, fnWrites, type FnWrites } from './effects.js';
import { bodyHasRaw } from './opt/expr-utils.js';
import {
  chosen,
  isEntry,
  isLeaf,
  planOf,
  shadows,
  sensitiveFns,
  countSites,
  type Plan,
} from './inline-small-plan.js';
import { mapExpr } from './opt/ir-transform.js';
import { renameLocals } from './inline-small-rename.js';
import { tailify } from './inline-small-returns.js';

type Call = Extract<Expr, { op: 'call' }>;

class Instance {
  readonly lifted: Stmt[] = [];
  constructor(
    private readonly plan: Plan,
    private readonly prefix: string,
  ) {}

  bind(call: Call): ReadonlyMap<string, Expr> {
    const subst = new Map<string, Expr>();
    this.plan.fn.params.forEach((p, i) => {
      const arg = call.args[i]!;
      const used = this.plan.uses.get(p.name) ?? 0;
      const assigned = this.plan.assigned.has(p.name);
      if (used === 0 && !assigned) {
        if (!isLeaf(arg)) this.lifted.push({ s: 'let', name: `${this.prefix}d${i}`, expr: arg });
        return;
      }
      if (!assigned && isLeaf(arg)) {
        subst.set(p.name, arg);
        return;
      }
      const name = `${this.prefix}a${i}`;
      this.lifted.push(
        assigned ? { s: 'var', name, type: p.type, init: arg } : { s: 'let', name, expr: arg },
      );
      subst.set(p.name, { op: 'varref', type: p.type, name });
    });
    return subst;
  }
}

function substitute(e: Expr, subst: ReadonlyMap<string, Expr>): Expr {
  return mapExpr(e, (x) =>
    (x.op === 'param' || x.op === 'varref') && subst.has(x.name) ? subst.get(x.name)! : x,
  );
}

function liftCall(plan: Plan, call: Call, prefix: string): { lifted: Stmt[]; result: Expr } {
  const inst = new Instance(plan, prefix);
  const subst = inst.bind(call);
  if (plan.ret !== undefined) return { lifted: inst.lifted, result: substitute(plan.ret, subst) };
  const retName = `${prefix}ret`;
  const retVar: Expr = { op: 'varref', type: plan.fn.ret, name: retName };
  const renamed = renameLocals(plan.fn.body, prefix, (e) => substitute(e, subst));
  const last = renamed.at(-1);
  const trailing = last?.s === 'return' && last.expr !== undefined ? last.expr : undefined;
  const lead = renamed.slice(0, -1);
  if (trailing !== undefined && !returnsIn(lead)) {
    const own =
      trailing.op === 'varref' && lead.some((d) => d.s === 'var' && d.name === trailing.name);
    return own
      ? { lifted: [...inst.lifted, ...lead], result: trailing }
      : {
          lifted: [...inst.lifted, ...lead, { s: 'let', name: retName, expr: trailing }],
          result: retVar,
        };
  }
  const tail = tailify(renamed, (e) =>
    e === undefined ? [] : [{ s: 'assign', target: retVar, expr: e }],
  );
  if (tail === undefined) return { lifted: [], result: retVar };
  return {
    lifted: [...inst.lifted, { s: 'var', name: retName, type: plan.fn.ret }, ...tail.body],
    result: retVar,
  };
}

function returnsIn(body: readonly Stmt[]): boolean {
  let found = false;
  eachBodyStmt(body, (s) => {
    if (s.s === 'return') found = true;
  });
  return found;
}

function liftable(plan: Plan): boolean {
  if (plan.ret !== undefined) return true;
  const probe = tailify(plan.fn.body, () => []);
  return probe !== undefined;
}

function substitutable(plan: Plan, call: Call, writes: FnWrites): boolean {
  return plan.fn.params.every((p, i) => {
    const arg = call.args[i]!;
    const used = plan.uses.get(p.name) ?? 0;
    if (plan.assigned.has(p.name) || exprHasEffect(arg, writes)) return false;
    return used <= 1 || isLeaf(arg);
  });
}

function ownExprsHaveEffect(s: Stmt, writes: FnWrites): boolean {
  let effect = false;
  const probe = (e: Expr): void => {
    if (exprHasEffect(e, writes)) effect = true;
  };
  switch (s.s) {
    case 'let':
      probe(s.expr);
      break;
    case 'var':
      if (s.init !== undefined) probe(s.init);
      break;
    case 'assign':
    case 'assignOp':
      probe(s.target);
      probe(s.expr);
      break;
    case 'call':
      probe(s.expr);
      break;
    case 'return':
      if (s.expr !== undefined) probe(s.expr);
      break;
    case 'if':
      for (const a of s.arms) probe(a.cond);
      break;
    case 'switch':
      probe(s.scrut);
      break;
    default:
      break;
  }
  return effect;
}

interface Rewriter {
  readonly plan: Plan;
  readonly writes: FnWrites;
  readonly counter: { n: number };
  changed: boolean;
}

function rewriteExpr(r: Rewriter, e: Expr, cond: boolean, lifted: Stmt[] | undefined): Expr {
  const go = (x: Expr, c: boolean): Expr => rewriteExpr(r, x, c, lifted);
  let out: Expr;
  switch (e.op) {
    case 'select':
      out = {
        ...e,
        cond: go(e.cond, cond),
        ifTrue: go(e.ifTrue, true),
        ifFalse: go(e.ifFalse, true),
      };
      break;
    case 'logical':
      out = { ...e, a: go(e.a, cond), b: go(e.b, true) };
      break;
    case 'matchExpr':
      out = {
        ...e,
        scrutinee: go(e.scrutinee, cond),
        cases: e.cases.map(([n, v]) => [n, go(v, true)] as const),
        default: go(e.default, true),
      };
      break;
    default:
      out = mapChildren(e, (c) => go(c, cond));
  }
  if (out.op !== 'call' || out.fn !== r.plan.fn.name) return out;
  const { plan } = r;
  if (plan.ret !== undefined && substitutable(plan, out, r.writes)) {
    r.changed = true;
    const subst = new Map<string, Expr>();
    plan.fn.params.forEach((p, i) => subst.set(p.name, out.args[i]!));
    return substitute(plan.ret, subst);
  }
  if (cond || lifted === undefined || !liftable(plan)) return out;
  const res = liftCall(plan, out, `_sm${r.counter.n++}_`);
  if (res.lifted.length === 0 && plan.ret === undefined) return out;
  lifted.push(...res.lifted);
  r.changed = true;
  return res.result;
}

function rewriteBlock(r: Rewriter, body: readonly Stmt[]): Stmt[] {
  const out: Stmt[] = [];
  for (const s of body) {
    const lifted: Stmt[] = [];
    const ok = !ownExprsHaveEffect(s, r.writes);
    const R = (e: Expr, cond = false): Expr => rewriteExpr(r, e, cond, ok ? lifted : undefined);
    let s2: Stmt;
    switch (s.s) {
      case 'let':
        s2 = { ...s, expr: R(s.expr) };
        break;
      case 'var':
        s2 = s.init !== undefined ? { ...s, init: R(s.init) } : s;
        break;
      case 'assign':
      case 'assignOp':
        s2 = { ...s, target: R(s.target), expr: R(s.expr) };
        break;
      case 'return':
        s2 = s.expr !== undefined ? { ...s, expr: R(s.expr) } : s;
        break;
      case 'call':
        s2 = { ...s, expr: R(s.expr) };
        break;
      case 'if':
        s2 = {
          ...s,
          arms: s.arms.map((a, k) => ({ cond: R(a.cond, k > 0), body: rewriteBlock(r, a.body) })),
          elseBody: s.elseBody && rewriteBlock(r, s.elseBody),
        };
        break;
      case 'for':
        s2 = { ...s, body: rewriteBlock(r, s.body) };
        break;
      case 'switch':
        s2 = {
          ...s,
          scrut: R(s.scrut),
          cases: s.cases.map((c) => ({ ...c, body: rewriteBlock(r, c.body) })),
          defaultBody: s.defaultBody && rewriteBlock(r, s.defaultBody),
        };
        break;
      default:
        s2 = s;
    }
    out.push(...adoptTemp(lifted, s2));
  }
  return out;
}

function inlineOne(
  m: ModuleDecl,
  plan: Plan,
  writes: FnWrites,
  counter: { n: number },
): ModuleDecl {
  const r: Rewriter = { plan, writes, counter, changed: false };
  const funcs = m.funcs.map((f) =>
    f === plan.fn || shadows(plan, f) ? f : { ...f, body: rewriteBlock(r, f.body) },
  );
  if (!r.changed) return m;
  const stillCalled = countSites(
    funcs.filter((f) => f.name !== plan.fn.name),
    plan.fn.name,
  );
  return { ...m, funcs: stillCalled > 0 ? funcs : funcs.filter((f) => f.name !== plan.fn.name) };
}

function nextTempIndex(m: ModuleDecl): number {
  let next = 0;
  const note = (name: string): void => {
    const hit = /^_sm(\d+)_/.exec(name);
    if (hit !== null) next = Math.max(next, Number(hit[1]) + 1);
  };
  for (const f of m.funcs)
    eachBodyStmt(f.body, (s) => {
      if (s.s === 'let' || s.s === 'var') note(s.name);
    });
  return next;
}

export function inlineSmall(m: ModuleDecl): ModuleDecl {
  if (!m.funcs.some(isEntry) || m.funcs.some((f) => bodyHasRaw(f.body))) return m;
  let cur = m;
  const tried = new Set<string>();
  const counter = { n: nextTempIndex(m) };
  for (let i = 0; i < m.funcs.length; i++) {
    const writes = fnWrites(cur);
    const sensitive = sensitiveFns(cur);
    let plan: Plan | undefined;
    for (const f of cur.funcs) {
      if (tried.has(f.name)) continue;
      const p = planOf(f, cur.funcs, writes, sensitive);
      if (p !== undefined && chosen(p, cur.funcs)) {
        plan = p;
        break;
      }
    }
    if (plan === undefined) break;
    tried.add(plan.fn.name);
    cur = inlineOne(cur, plan, writes, counter);
  }
  return cur;
}
