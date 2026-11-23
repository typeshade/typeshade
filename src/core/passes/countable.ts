// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import type { Expr, FuncDecl, Stmt } from '../ir/nodes.js';
import { eachExpr, eachStmtExpr } from '../ir/visit.js';
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

function readsInRange(fn: FuncDecl): boolean {
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
    if (k.op !== 'varref' || !loops.some((l) => countsUpToLength(l, k.name, array))) proven = false;
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

export function countable(verdicts: readonly LoopVerdict[], fn: FuncDecl): boolean {
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
    plainTopLevel(fn.body) &&
    onlyReturnAfterLoops(fn.body) &&
    grownOnlyPushed(fn, name!) &&
    readsInRange(fn)
  );
}
