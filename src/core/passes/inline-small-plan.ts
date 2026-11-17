import { stageOf } from '../ir/index.js';
import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/index.js';
import { eachBlockStmt as eachBodyStmt, eachBodyExpr } from './opt/sroa/blocks.js';
import { BARRIER_INTRINSICS, DERIVATIVE_INTRINSICS, SUBGROUP_INTRINSICS } from '../intrinsics.js';
import { bodyHasEffectfulCall, type FnWrites } from './effects.js';
import { bodyHasRaw, collectLocals } from './opt/expr-utils.js';

export const SMALL_BODY_COST = 8;

export const isEntry = (f: FuncDecl): boolean => stageOf(f) !== undefined;

export const isLeaf = (e: Expr): boolean =>
  e.op === 'lit' ||
  e.op === 'constref' ||
  e.op === 'overrideref' ||
  e.op === 'externref' ||
  e.op === 'param' ||
  e.op === 'varref';

const targetRoot = (e: Expr): Expr =>
  e.op === 'index' || e.op === 'member' ? targetRoot(e.base) : e;

const SENSITIVE_INTRINSICS: ReadonlySet<string> = new Set([
  ...DERIVATIVE_INTRINSICS,
  ...BARRIER_INTRINSICS,
  ...SUBGROUP_INTRINSICS,
]);

export function sensitiveFns(m: ModuleDecl): ReadonlySet<string> {
  const declared = new Set(m.funcs.map((f) => f.name));
  const direct = new Set<string>();
  const callees = new Map<string, Set<string>>();
  for (const f of m.funcs) {
    const out = new Set<string>();
    eachBodyExpr(f.body, (e) => {
      if (e.op !== 'call') return;
      if (declared.has(e.fn)) out.add(e.fn);
      else if (SENSITIVE_INTRINSICS.has(e.fn)) direct.add(f.name);
    });
    callees.set(f.name, out);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of m.funcs)
      if (!direct.has(f.name) && [...callees.get(f.name)!].some((c) => direct.has(c))) {
        direct.add(f.name);
        changed = true;
      }
  }
  return direct;
}

function bodyCost(body: readonly Stmt[]): number {
  let n = 0;
  eachBodyStmt(body, () => n++);
  eachBodyExpr(body, () => n++);
  return n;
}

export function countSites(funcs: readonly FuncDecl[], name: string): number {
  let n = 0;
  for (const f of funcs)
    eachBodyExpr(f.body, (e) => {
      if (e.op === 'call' && e.fn === name) n++;
    });
  return n;
}

export interface Plan {
  readonly fn: FuncDecl;
  readonly ret: Expr | undefined;
  readonly uses: ReadonlyMap<string, number>;
  readonly assigned: ReadonlySet<string>;
  readonly free: ReadonlySet<string>;
}

const STRAIGHT_LINE: ReadonlySet<string> = new Set([
  'let',
  'var',
  'assign',
  'assignOp',
  'if',
  'switch',
  'return',
]);

export function planOf(
  f: FuncDecl,
  funcs: readonly FuncDecl[],
  writes: FnWrites,
  sensitive: ReadonlySet<string>,
): Plan | undefined {
  if (isEntry(f) || f.opaque === true || f.kernel === true || f.ret.kind === 'void')
    return undefined;
  if (f.params.some((p) => p.mode === 'inout')) return undefined;
  if ((writes.get(f.name)?.size ?? 0) > 0 || sensitive.has(f.name)) return undefined;
  if (bodyHasEffectfulCall(f.body, writes) || bodyHasRaw(f.body)) return undefined;
  let plain = true;
  eachBodyStmt(f.body, (s) => {
    if (!STRAIGHT_LINE.has(s.s)) plain = false;
  });
  if (!plain || countSites(funcs, f.name) === 0 || countSites([f], f.name) > 0) return undefined;
  const names = new Set(f.params.map((p) => p.name));
  const uses = new Map<string, number>();
  eachBodyExpr(f.body, (e) => {
    if ((e.op === 'param' || e.op === 'varref') && names.has(e.name))
      uses.set(e.name, (uses.get(e.name) ?? 0) + 1);
  });
  const assigned = new Set<string>();
  eachBodyStmt(f.body, (s) => {
    if (s.s !== 'assign' && s.s !== 'assignOp') return;
    const root = targetRoot(s.target);
    if ((root.op === 'param' || root.op === 'varref') && names.has(root.name))
      assigned.add(root.name);
  });
  const only = f.body.length === 1 ? f.body[0] : undefined;
  const ret = only?.s === 'return' ? only.expr : undefined;
  const own = new Set(names);
  collectLocals(f.body, own);
  const free = new Set<string>();
  eachBodyExpr(f.body, (e) => {
    if (e.op === 'call') free.add(e.fn);
    else if ('name' in e && !own.has(e.name)) free.add(e.name);
  });
  return { fn: f, ret, uses, assigned, free };
}

export function chosen(plan: Plan, funcs: readonly FuncDecl[]): boolean {
  return countSites(funcs, plan.fn.name) === 1 || bodyCost(plan.fn.body) <= SMALL_BODY_COST;
}

export function shadows(plan: Plan, f: FuncDecl): boolean {
  const declared = new Set(f.params.map((p) => p.name));
  collectLocals(f.body, declared);
  return [...plan.free].some((n) => declared.has(n));
}
