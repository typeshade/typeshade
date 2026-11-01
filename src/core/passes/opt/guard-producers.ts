// === Skip producers on the paths that do not use them (#848) ===
//
// A function often computes values before an `if` / `else if` chain and reads them in only some
// of its arms. The class-based Namek example computes common lighting, a shadow march included,
// before a material chain whose leaves arm reads none of it: every leaves fragment marched a
// shadow nothing read. CSE and DCE cannot help, because the values ARE used, on other paths.
//
// This pass keeps the producers where they are and runs them only on the paths that reach an arm
// using them:
//
//   let a = f(x);                        var a: T;
//   var b = a * 2.0;                     var b: T;
//   if (c0) { …a… }              ->      let _guard0 = !((!c0) && c1);
//   else if (c1) { …none… }              if (_guard0) { a = f(x); b = a * 2.0; }
//   else { …b… }                         if (c0) { …a… } else if (c1) { … } else { …b… }
//
// The guard is true exactly when the chain will take an arm that reads a produced name, so on
// those paths the producers run as before, in the same order, and on the others no one reads what
// they would have computed. That is only true under conditions this pass checks, and it bails on
// each it cannot prove:
//
//   • A produced name is read in no condition of the chain, in no statement after the chain, in
//     no arm the guard skips, and in no other statement before the chain.
//   • A producer has no effect and cannot end the invocation: no write outside the produced
//     names, no effectful intrinsic, no `discard`, no `raw` text, no call this module does not
//     define, transitively through every function it calls.
//   • A producer needs no uniform control flow: no derivative, no implicitly-levelled sample, no
//     barrier, no `workgroupUniformLoad`, no subgroup or quad operation, transitively. Moving one
//     under a branch would change what it computes or make it a compile error.
//   • The chain's conditions call nothing, and nothing between the guard and the chain writes a
//     name they read, so evaluating them early gives the values the chain will see.
//   • The producers call a function this module defines. Skipping arithmetic is not worth a branch.
//
// Only a statement-level `if` chain is a candidate; a `switch` is left alone.
//
// A `@compute` entry is left alone. A kernel entry runs an idle lane through its iteration with
// the index clamped and the writes masked, so that every lane of the workgroup takes the same
// control flow (change 0096, `docs/hardware-notes.md` A1: idle lanes that skip heavy loops hung a
// device). Guarding that iteration by the lane's `_live` flag would be the skip A1 forbids.

import { stageOf, type Expr, type FuncDecl, type ModuleDecl, type Stmt } from '../../ir/index.js';
import type { ShaderType } from '../../ir/types.js';
import { eachExpr, eachStmtExpr } from '../../ir/visit.js';
import { BARRIER_INTRINSICS, DERIVATIVE_INTRINSICS, isKnownIntrinsic } from '../../intrinsics.js';
import { EFFECTFUL_INTRINSICS, fnWrites, type FnWrites } from '../effects.js';
import { bodyHasRaw } from './dce.js';
import { keyOf } from './expr-utils.js';

const GUARD_PREFIX = '_guard';
const boolT: ShaderType = { kind: 'scalar', scalar: 'bool' };
/** The most comparison terms a guard may hold; beyond it the guard costs more than it saves. */
const MAX_GUARD_TERMS = 24;

/** Whether calling builtin `name` needs uniform control flow or has an effect. */
const builtinBlocks = (name: string): boolean =>
  DERIVATIVE_INTRINSICS.has(name) ||
  BARRIER_INTRINSICS.has(name) ||
  EFFECTFUL_INTRINSICS.has(name) ||
  name === 'workgroupUniformLoad' ||
  name.startsWith('subgroup') ||
  name.startsWith('quad');

/** The functions a producer may call: no effect, no `discard`, no `raw`, no uniformity need,
 *  transitively. A cycle or an undefined callee is not safe. */
function safeFunctions(m: ModuleDecl, writes: FnWrites): ReadonlySet<string> {
  const byName = new Map(m.funcs.map((f) => [f.name, f]));
  const memo = new Map<string, boolean>();
  const safe = (name: string, stack: Set<string>): boolean => {
    const known = memo.get(name);
    if (known !== undefined) return known;
    const f = byName.get(name);
    if (f === undefined || stack.has(name)) return false;
    if ((writes.get(name)?.size ?? 0) > 0 || f.params.some((p) => p.mode === 'inout')) {
      memo.set(name, false);
      return false;
    }
    if (bodyHasRaw(f.body)) {
      memo.set(name, false);
      return false;
    }
    stack.add(name);
    let ok = true;
    const visitStmt = (s: Stmt): void => {
      if (s.s === 'discard') ok = false;
      eachStmtExpr(
        s,
        (e) => {
          if (ok && !exprSafe(e, (n) => safe(n, stack))) ok = false;
        },
        visitStmt,
      );
    };
    for (const s of f.body) visitStmt(s);
    stack.delete(name);
    memo.set(name, ok);
    return ok;
  };
  const out = new Set<string>();
  for (const f of m.funcs) if (safe(f.name, new Set())) out.add(f.name);
  return out;
}

/** Whether every call in `e` is safe: a defined function `defined` accepts, or a known builtin
 *  that neither has an effect nor needs uniform control flow. */
function exprSafe(e: Expr, defined: (name: string) => boolean): boolean {
  let ok = true;
  eachExpr(e, (x) => {
    if (!ok || x.op !== 'call') return;
    if (x.fn.startsWith('console.')) ok = false;
    else if (defined(x.fn)) return;
    else if (x.declRef !== undefined || !isKnownIntrinsic(x.fn) || builtinBlocks(x.fn)) ok = false;
  });
  return ok;
}

/** Every local name `e` mentions. */
function namesOf(e: Expr, out: Set<string>): void {
  eachExpr(e, (x) => {
    if (x.op === 'varref') out.add(x.name);
  });
}

/** Every local name a statement reads or writes, nested blocks included. */
function stmtNames(s: Stmt): Set<string> {
  const out = new Set<string>();
  const walk = (st: Stmt): void => {
    if (st.s === 'let' || st.s === 'var') out.add(st.name);
    eachStmtExpr(st, (e) => namesOf(e, out), walk);
  };
  walk(s);
  return out;
}

/** The root local a write target reaches through members and indices. */
function targetRoot(e: Expr): string | undefined {
  let at = e;
  while (at.op === 'member' || at.op === 'index') at = at.base;
  return at.op === 'varref' ? at.name : undefined;
}

/** Whether a statement can be a producer: it writes only `produced` names and names it declares
 *  itself, holds only safe calls, and holds no jump, `discard`, call statement, loop or switch. */
function producerShaped(
  s: Stmt,
  produced: ReadonlySet<string>,
  safe: (e: Expr) => boolean,
): boolean {
  const local = new Set<string>();
  const ok = (st: Stmt): boolean => {
    switch (st.s) {
      case 'let':
        local.add(st.name);
        return safe(st.expr);
      case 'var':
        local.add(st.name);
        return st.init === undefined || safe(st.init);
      case 'assign':
      case 'assignOp': {
        const root = targetRoot(st.target);
        return (
          root !== undefined &&
          (produced.has(root) || local.has(root)) &&
          safe(st.target) &&
          safe(st.expr)
        );
      }
      case 'if':
        return (
          st.arms.every((a) => safe(a.cond) && a.body.every(ok)) && (st.elseBody ?? []).every(ok)
        );
      default:
        return false;
    }
  };
  if (s.s === 'let' || s.s === 'var') return produced.has(s.name) && ok(s);
  return ok(s);
}

/** Whether the statement calls one of `defined` (the module's safe functions), anywhere inside it. */
function callsDefined(s: Stmt, defined: ReadonlySet<string>): boolean {
  let found = false;
  const walk = (st: Stmt): void =>
    eachStmtExpr(
      st,
      (e) =>
        eachExpr(e, (x) => {
          if (x.op === 'call' && defined.has(x.fn)) found = true;
        }),
      walk,
    );
  walk(s);
  return found;
}

/** A comparison-only condition: no call, so evaluating it early changes nothing. */
function plainCondition(e: Expr): boolean {
  let ok = true;
  eachExpr(e, (x) => {
    if (x.op === 'call' || x.op === 'matchExpr') ok = false;
  });
  return ok;
}

/** `e == false`, and `x` for `(x == false) == false`, so a guard never spells a double negation. */
const not = (e: Expr): Expr =>
  e.op === 'compare' && e.cop === '==' && e.b.op === 'lit' && e.b.value === false
    ? e.a
    : { op: 'compare', type: boolT, cop: '==', a: e, b: { op: 'lit', type: boolT, value: false } };
const and = (a: Expr, b: Expr): Expr => ({ op: 'logical', type: boolT, lop: '&&', a, b });
const or = (a: Expr, b: Expr): Expr => ({ op: 'logical', type: boolT, lop: '||', a, b });
const termsOf = (e: Expr): number => {
  let n = 0;
  eachExpr(e, (x) => {
    if (x.op === 'compare' || x.op === 'varref') n++;
  });
  return n;
};

/** The condition under which the chain `s` takes branch `k` (the arms, then the else or the
 *  fall-through past the last arm). */
function pathCondition(s: Extract<Stmt, { s: 'if' }>, k: number): Expr {
  const conds = s.arms.map((a) => a.cond);
  let acc: Expr | undefined;
  for (let i = 0; i < Math.min(k, conds.length); i++) {
    const term = not(conds[i]!);
    acc = acc === undefined ? term : and(acc, term);
  }
  if (k < conds.length) acc = acc === undefined ? conds[k]! : and(acc, conds[k]!);
  return acc ?? { op: 'lit', type: boolT, value: true };
}

interface Context {
  readonly safeFns: ReadonlySet<string>;
  readonly counter: { n: number };
}

/** Guard the producers of one chain in `body`, or return `body` unchanged. */
function guardOne(body: readonly Stmt[], cx: Context): readonly Stmt[] | undefined {
  const safe = (e: Expr): boolean => exprSafe(e, (n) => cx.safeFns.has(n));
  for (let c = body.length - 1; c > 0; c--) {
    const chain = body[c]!;
    if (chain.s !== 'if' || !chain.arms.every((a) => plainCondition(a.cond))) continue;
    const branches = [...chain.arms.map((a) => a.body), chain.elseBody ?? []];

    // Names read by the chain's conditions and by every statement after it.
    const condNames = new Set<string>();
    for (const a of chain.arms) namesOf(a.cond, condNames);
    const after = new Set<string>();
    for (const s of body.slice(c + 1)) for (const n of stmtNames(s)) after.add(n);

    // Producers: start from the statements that call a function of the module, the work worth
    // skipping, and close over every statement before the chain that writes or reads what they
    // write: its declaration, a later update, a value computed from it. Each must be producer
    // shaped, and every name they write must be declared among them, so nothing outside reads a
    // value only the guarded path computes.
    const writesOf = (st: Stmt): Set<string> => {
      const out = new Set<string>();
      const local = new Set<string>();
      const walk = (x: Stmt): void => {
        if (x.s === 'let' || x.s === 'var') {
          if (x === st) out.add(x.name);
          else local.add(x.name);
        } else if (x.s === 'assign' || x.s === 'assignOp') {
          const root = targetRoot(x.target);
          if (root !== undefined && !local.has(root)) out.add(root);
        }
        eachStmtExpr(x, () => {}, walk);
      };
      walk(st);
      return out;
    };
    const shaped = (i: number): boolean => {
      const st = body[i]!;
      if (
        st.s === 'if' &&
        st.arms.some((a) => a.cond.op === 'varref' && a.cond.name.startsWith(GUARD_PREFIX))
      )
        return false;
      return producerShaped(st, writesOf(st), safe);
    };
    const memberSet = new Set<number>();
    for (let i = 0; i < c; i++)
      if (callsDefined(body[i]!, cx.safeFns) && shaped(i)) memberSet.add(i);
    if (memberSet.size === 0) continue;
    const produced = new Set<string>();
    for (const i of memberSet) for (const n of writesOf(body[i]!)) produced.add(n);
    let closed = true;
    for (let grew = true; grew && closed;) {
      grew = false;
      for (let i = 0; i < c && closed; i++) {
        if (memberSet.has(i)) continue;
        const touches = [...stmtNames(body[i]!)].some((n) => produced.has(n));
        if (!touches) continue;
        if (!shaped(i)) closed = false;
        else {
          memberSet.add(i);
          for (const n of writesOf(body[i]!)) produced.add(n);
          grew = true;
        }
      }
    }
    if (!closed) continue;
    const declaredHere = new Set<string>();
    for (const i of memberSet) {
      const st = body[i]!;
      if (st.s === 'let' || st.s === 'var') declaredHere.add(st.name);
    }
    if (
      [...produced].some(
        (n) =>
          !declaredHere.has(n) || n.startsWith(GUARD_PREFIX) || condNames.has(n) || after.has(n),
      )
    )
      continue;
    const members = [...memberSet].sort((a, b) => a - b);

    // Branches that read a produced name, and the ones the guard skips.
    const uses = branches.map((b) => b.some((s) => [...stmtNames(s)].some((n) => produced.has(n))));
    const skipped = uses.map((u, k) => (u ? -1 : k)).filter((k) => k >= 0);
    if (skipped.length === 0 || skipped.length === branches.length) continue;

    // The guard: not any skipped branch's path condition.
    let skip: Expr | undefined;
    for (const k of skipped) {
      const p = pathCondition(chain, k);
      skip = skip === undefined ? p : or(skip, p);
    }
    const guardExpr = not(skip!);
    if (termsOf(guardExpr) > MAX_GUARD_TERMS) continue;

    // Already guarded: every producer is a declaration with no value or a one-armed `if` on this
    // guard, spelled as a guard name or, after copy propagation, as the guard expression itself.
    // Without this the fixpoint would wrap the region again on every sweep.
    const guardKey = keyOf(guardExpr);
    const alreadyGuarded = members.every((i) => {
      const st = body[i]!;
      if (st.s === 'var') return st.init === undefined;
      if (st.s !== 'if' || st.elseBody !== undefined || st.arms.length !== 1) return false;
      const cond = st.arms[0]!.cond;
      return (
        (cond.op === 'varref' && cond.name.startsWith(GUARD_PREFIX)) || keyOf(cond) === guardKey
      );
    });
    if (alreadyGuarded) continue;

    // The guard is evaluated before the first producer: nothing from there to the chain may
    // write a name the conditions read, and every such name must already be declared.
    const first = members[0]!;
    const writtenFromFirst = new Set<string>();
    for (let i = first; i < c; i++) {
      const walk = (st: Stmt): void => {
        if (st.s === 'let' || st.s === 'var') writtenFromFirst.add(st.name);
        if (st.s === 'assign' || st.s === 'assignOp') {
          const root = targetRoot(st.target);
          if (root !== undefined) writtenFromFirst.add(root);
        }
        eachStmtExpr(st, () => {}, walk);
      };
      walk(body[i]!);
    }
    if ([...condNames].some((n) => writtenFromFirst.has(n))) continue;

    const guardName = `${GUARD_PREFIX}${String(cx.counter.n++)}`;
    const guardRef: Expr = { op: 'varref', type: boolT, name: guardName };
    const out: Stmt[] = [];
    let run: Stmt[] = [];
    const flush = (): void => {
      if (run.length === 0) return;
      out.push({ s: 'if', arms: [{ cond: guardRef, body: run }] });
      run = [];
    };
    for (let i = 0; i < body.length; i++) {
      const s = body[i]!;
      if (i === first) out.push({ s: 'let', name: guardName, expr: guardExpr });
      if (!memberSet.has(i)) {
        flush();
        out.push(s);
        continue;
      }
      if (s.s === 'let') {
        flush();
        out.push({ s: 'var', name: s.name, type: s.expr.type });
        run.push({
          s: 'assign',
          target: { op: 'varref', type: s.expr.type, name: s.name },
          expr: s.expr,
        });
      } else if (s.s === 'var') {
        flush();
        out.push({ s: 'var', name: s.name, type: s.type });
        if (s.init !== undefined)
          run.push({
            s: 'assign',
            target: { op: 'varref', type: s.type, name: s.name },
            expr: s.init,
          });
      } else run.push(s);
    }
    flush();
    return out;
  }
  return undefined;
}

/** Apply {@link guardOne} to every block of a body until none changes. */
function guardBlock(body: readonly Stmt[], cx: Context): readonly Stmt[] {
  let changed = false;
  const nested = body.map((s): Stmt => {
    switch (s.s) {
      case 'if': {
        const arms = s.arms.map((a) => {
          const b = guardBlock(a.body, cx);
          if (b !== a.body) changed = true;
          return b === a.body ? a : { ...a, body: b };
        });
        const elseBody = s.elseBody && guardBlock(s.elseBody, cx);
        if (elseBody !== s.elseBody) changed = true;
        return { ...s, arms, elseBody };
      }
      case 'for': {
        const b = guardBlock(s.body, cx);
        if (b !== s.body) changed = true;
        return b === s.body ? s : { ...s, body: b };
      }
      case 'switch': {
        const cases = s.cases.map((k) => {
          const b = guardBlock(k.body, cx);
          if (b !== k.body) changed = true;
          return b === k.body ? k : { ...k, body: b };
        });
        const defaultBody = s.defaultBody && guardBlock(s.defaultBody, cx);
        if (defaultBody !== s.defaultBody) changed = true;
        return { ...s, cases, defaultBody };
      }
      default:
        return s;
    }
  });
  let current: readonly Stmt[] = changed ? nested : body;
  for (;;) {
    const next = guardOne(current, cx);
    if (next === undefined) return current;
    current = next;
  }
}

// The fixpoint optimizes each function in a module that holds it alone, so the callees a
// producer reaches are not in the module this pass sees. As DCE does (`prepareDce`), the safe
// set is computed once from the whole module and keyed by its effect table, which every view
// inherits (`inheritEffects`).
const safeByTable = new WeakMap<FnWrites, ReadonlySet<string>>();

/** Compute the safe-function set from the whole module before the per-function views. @internal */
export function prepareGuardProducers(m: ModuleDecl): void {
  const writes = fnWrites(m);
  if (!safeByTable.has(writes)) safeByTable.set(writes, safeFunctions(m, writes));
}

/** Guard the producers of each function's `if` chains so that a path to an arm using none of
 *  them skips them (see the header). Identity for a module with no such chain. */
export function guardProducers(m: ModuleDecl): ModuleDecl {
  prepareGuardProducers(m);
  const safeFns = safeByTable.get(fnWrites(m))!;
  let changed = false;
  const funcs = m.funcs.map((f): FuncDecl => {
    if (bodyHasRaw(f.body) || stageOf(f) === 'compute') return f;
    const taken = new Set<string>();
    const scan = (s: Stmt): void => {
      if ((s.s === 'let' || s.s === 'var') && s.name.startsWith(GUARD_PREFIX)) taken.add(s.name);
      eachStmtExpr(s, () => {}, scan);
    };
    for (const s of f.body) scan(s);
    let n = 0;
    while (taken.has(`${GUARD_PREFIX}${String(n)}`)) n++;
    const body = guardBlock(f.body, { safeFns, counter: { n } });
    if (body === f.body) return f;
    changed = true;
    return { ...f, body };
  });
  return changed ? { ...m, funcs } : m;
}
