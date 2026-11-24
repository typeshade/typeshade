// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import type { Expr, FuncDecl, Stmt } from '../ir/nodes.js';
import { eachExpr, eachStmtExpr } from '../ir/visit.js';
import { rangeOf } from './kernel-lower-ir.js';
import { deviceRangeLoops } from './kernel-stores.js';
import type { LoopVerdict, LoopWrite } from './parallel-loop.js';

type ForStmt = Stmt & { s: 'for' };

export const WRITE_COUNTABLE: Readonly<Record<LoopWrite['kind'], boolean>> = {
  append: true,
  affine: false,
  scaled: false,
  'row-major': false,
  texel: false,
  scatter: false,
};

export function plainCount(loop: ForStmt): boolean {
  const range = rangeOf(loop);
  if (range === undefined || loop.counted?.op !== 'add') return false;
  const t = range.type;
  return (
    t.kind === 'scalar' &&
    (t.scalar === 'u32' || t.scalar === 'i32') &&
    !assigns(loop.body, loop.counted.name)
  );
}

const isCall = (x: Expr, fn: string): x is Expr & { op: 'call' } => x.op === 'call' && x.fn === fn;

const isParam = (x: Expr | undefined, name: string): boolean =>
  x?.op === 'param' && x.name === name;

function inEachStmt(
  body: readonly Stmt[],
  on: (e: Expr, loops: readonly ForStmt[]) => void,
  loops: readonly ForStmt[] = [],
): void {
  const visit = (st: Stmt, around: readonly ForStmt[]): void => {
    const inner = st.s === 'for' ? [...around, st] : around;
    eachStmtExpr(
      st,
      (e) => eachExpr(e, (x) => on(x, inner)),
      (b) => visit(b, inner),
    );
  };
  body.forEach((st) => visit(st, loops));
}

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

function countsUpToLength(loop: ForStmt, name: string, array: string): boolean {
  const c = loop.counted;
  if (c?.name !== name || c.op !== 'add' || c.step !== 1) return false;
  const cond = loop.cond;
  if (cond.op !== 'compare' || cond.cop !== '<') return false;
  if (cond.a.op !== 'varref' || cond.a.name !== name) return false;
  if (!isCall(cond.b, 'arrayLength') || !isParam(cond.b.args[0], array)) return false;
  const init = loop.init;
  const unsigned = init.s === 'var' && init.type.kind === 'scalar' && init.type.scalar === 'u32';
  return (unsigned || (c.start !== undefined && c.start >= 0)) && !assigns(loop.body, name);
}

function readsAtOwnCounter(fn: FuncDecl, loops: readonly ForStmt[], name: string): boolean {
  const own = [...loops].reverse().find((l) => l.counted?.name === name);
  if (own === undefined || own !== loops[0] || !plainCount(own)) return false;
  const top = fn.body.filter((st) => st.s === 'for');
  return !deviceRangeLoops(fn).has(top.indexOf(own));
}

function readsInRange(fn: FuncDecl, widen: boolean): boolean {
  const arrays = new Set(
    fn.params
      .filter((p) => p.type.kind === 'array' && p.type.size === undefined)
      .map((p) => p.name),
  );
  let proven = true;
  inEachStmt(fn.body, (x, loops) => {
    if (x.op !== 'index' || x.base.op !== 'param' || !arrays.has(x.base.name)) return;
    const array = x.base.name;
    const k = x.idx;
    if (k.op !== 'varref') proven = false;
    else if (loops.some((l) => countsUpToLength(l, k.name, array))) return;
    else if (!widen || !readsAtOwnCounter(fn, loops, k.name)) proven = false;
  });
  return proven;
}

function grownOnlyPushed(fn: FuncDecl, name: string): boolean {
  let uses = 0;
  let allowed = 0;
  let pushes = 0;
  let pushStatements = 0;
  let lengthsBeforeEnd = 0;
  const last = fn.body.length - 1;
  fn.body.forEach((st, i) => {
    inEachStmt([st], (x) => {
      if (isParam(x, name)) uses++;
      if (isCall(x, 'push') && isParam(x.args[0], name)) {
        pushes++;
        allowed++;
      }
      if (isCall(x, 'pushCount') && isParam(x.args[0], name)) {
        allowed++;
        if (i !== last) lengthsBeforeEnd++;
      }
    });
  });
  const visit = (st: Stmt): void => {
    if (st.s === 'call' && isCall(st.expr, 'push') && isParam(st.expr.args[0], name))
      pushStatements++;
    eachStmtExpr(st, () => undefined, visit);
  };
  fn.body.forEach(visit);
  return uses === allowed && pushes === pushStatements && lengthsBeforeEnd === 0;
}

function reachesArray(st: Stmt, name: string): boolean {
  let found = false;
  const visit = (s: Stmt): void => {
    if ((s.s === 'assign' || s.s === 'assignOp') && s.target.op === 'index')
      found ||= isParam(s.target.base, name);
    eachStmtExpr(
      s,
      (e) =>
        eachExpr(e, (x) => {
          if (isCall(x, 'push') && isParam(x.args[0], name)) found = true;
        }),
      visit,
    );
  };
  visit(st);
  return found;
}

function everyGrowerCounted(body: readonly Stmt[], name: string): boolean {
  return body.every((st) => {
    if (st.s === 'for' && reachesArray(st, name) && !plainCount(st)) return false;
    let ok = true;
    eachStmtExpr(
      st,
      () => undefined,
      (inner) => {
        ok &&= everyGrowerCounted([inner], name);
      },
    );
    return ok;
  });
}

function onlyReturnAfterLoops(body: readonly Stmt[]): boolean {
  const lastLoop = body.map((st) => st.s).lastIndexOf('for');
  if (lastLoop < 0) return false;
  const tail = body.slice(lastLoop + 1);
  return tail.every((st) => st.s === 'return');
}

function plainTopLevel(body: readonly Stmt[]): boolean {
  return body.every(
    (st) =>
      st.s === 'let' ||
      st.s === 'var' ||
      st.s === 'for' ||
      st.s === 'return' ||
      ((st.s === 'assign' || st.s === 'assignOp') && st.target.op === 'varref'),
  );
}

export function countable(
  verdicts: readonly LoopVerdict[],
  fn: FuncDecl,
  widen: () => boolean = () => false,
): boolean {
  if (verdicts.length === 0) return false;
  const grown = new Set<string>();
  for (const v of verdicts) {
    if (!v.ok || v.reductions.length > 0 || v.stores.some((s) => s.readBack)) return false;
    for (const w of v.writes) {
      if (WRITE_COUNTABLE[w.kind] !== true) return false;
      grown.add(w.name);
    }
  }
  if (grown.size !== 1) return false;
  const [name] = [...grown];
  const handles = fn.params.some((p) =>
    ['collection', 'texture', 'storage-texture'].includes(p.type.kind),
  );
  return (
    !handles &&
    everyGrowerCounted(fn.body, name!) &&
    plainTopLevel(fn.body) &&
    onlyReturnAfterLoops(fn.body) &&
    grownOnlyPushed(fn, name!) &&
    (readsInRange(fn, false) || (readsInRange(fn, true) && widen()))
  );
}
