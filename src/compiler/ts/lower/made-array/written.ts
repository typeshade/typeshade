// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import type { Expr, FuncDecl, Stmt } from '../../../../core/ir/nodes.js';
import { u32T, type ShaderType } from '../../../../core/ir/types.js';
import { eachExpr, eachStmtExpr } from '../../../../core/ir/visit.js';
import {
  mapBlock,
  placeRoot,
  rangeOf,
  type ForStmt,
} from '../../../../core/passes/kernel-lower-ir.js';
import { freeParamName } from './length.js';
import type { MadeSource } from './registry.js';

type WholeWrite = Stmt & { s: 'assign'; target: Expr & { op: 'index' } };

const MARKS: ShaderType = { kind: 'array', elem: u32T };

function isWholeWrite(st: Stmt, param: string): st is WholeWrite {
  return (
    st.s === 'assign' &&
    st.target.op === 'index' &&
    (st.target.base.op === 'param' || st.target.base.op === 'varref') &&
    st.target.base.name === param
  );
}

function eachStmt(body: readonly Stmt[], f: (st: Stmt) => void): void {
  const visit = (st: Stmt): void => {
    f(st);
    eachStmtExpr(st, () => undefined, visit);
  };
  body.forEach(visit);
}

function namesOf(e: Expr): Set<string> {
  const names = new Set<string>();
  eachExpr(e, (x) => {
    if (x.op === 'varref' || x.op === 'param') names.add(x.name);
  });
  return names;
}

function assignedIn(body: readonly Stmt[]): Set<string> {
  const names = new Set<string>();
  eachStmt(body, (st) => {
    if (st.s !== 'assign' && st.s !== 'assignOp') return;
    const root = placeRoot(st.target);
    if (root.op === 'varref' || root.op === 'param') names.add(root.name);
  });
  return names;
}

const withoutSpans = (e: Expr): string =>
  JSON.stringify(e, (key, v: unknown) => (key === 'span' ? undefined : v));

function leavesEarly(body: readonly Stmt[], nested: boolean): boolean {
  return body.some((st) => {
    if (st.s === 'return' || st.s === 'discard') return true;
    if (!nested && (st.s === 'break' || st.s === 'continue')) return true;
    const inner: Stmt[] = [];
    eachStmtExpr(
      st,
      () => undefined,
      (b) => inner.push(b),
    );
    return leavesEarly(inner, nested || st.s === 'for' || st.s === 'switch');
  });
}

function writesEvery(
  loop: ForStmt,
  param: string,
  lengths: readonly Expr[],
  assigned: Set<string>,
): boolean {
  const range = rangeOf(loop);
  const c = loop.counted;
  if (range === undefined || c === undefined || range.cop !== '<') return false;
  if (c.op !== 'add' || c.step !== 1 || c.start !== 0) return false;
  const length = lengths.find((l) => withoutSpans(l) === withoutSpans(range.bound));
  if (length === undefined || [...namesOf(length)].some((n) => assigned.has(n))) return false;
  if (assignedIn(loop.body).has(c.name) || leavesEarly(loop.body, false)) return false;
  return loop.body.some(
    (st) =>
      isWholeWrite(st, param) &&
      (st.target.idx.op === 'varref' || st.target.idx.op === 'param') &&
      st.target.idx.name === c.name,
  );
}

export type Written = 'none' | 'every' | 'some';

export function writtenOf(stub: FuncDecl, param: string, lengths: readonly Expr[]): Written {
  let any = false;
  eachStmt(stub.body, (st) => (any ||= isWholeWrite(st, param)));
  if (!any) return 'none';
  const assigned = assignedIn(stub.body);
  return stub.body.some((st) => st.s === 'for' && writesEvery(st, param, lengths, assigned))
    ? 'every'
    : 'some';
}

export function markWrites(stub: FuncDecl, param: string): string {
  const name = freeParamName(stub, `${param}_written`);
  const one: Expr = { op: 'lit', type: u32T, value: 1 };
  (stub as { body: readonly Stmt[] }).body = mapBlock(stub.body, (st) =>
    isWholeWrite(st, param)
      ? [
          st,
          {
            s: 'assign',
            target: {
              op: 'index',
              type: u32T,
              base: { op: st.target.base.op as 'param', type: MARKS, name },
              idx: st.target.idx,
            },
            expr: one,
            ...(st.span !== undefined ? { span: st.span } : {}),
          },
        ]
      : undefined,
  );
  (stub.params as FuncDecl['params'][number][]).push({ name, type: MARKS, mode: 'inout' });
  return name;
}

export function sourceOf(e: Expr, lets: ReadonlyMap<string, Expr>): MadeSource | undefined {
  if (e.op === 'param') return { param: e.name, path: [] };
  if (e.op === 'varref') {
    const init = lets.get(e.name);
    return init === undefined ? undefined : sourceOf(init, lets);
  }
  if (e.op !== 'member') return undefined;
  const base = sourceOf(e.base, lets);
  return base === undefined ? undefined : { param: base.param, path: [...base.path, e.field] };
}
