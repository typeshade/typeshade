import type { Expr, Stmt } from '../../../ir/index.js';
import { eachExpr } from '../../../ir/visit.js';
import { callReadsAny, calleeWritesOf, type FnReads, type FnWrites } from '../../effects.js';

export function rootName(e: Expr): string | undefined {
  if (e.op === 'varref' || e.op === 'constref' || e.op === 'externref' || e.op === 'param') {
    return e.name;
  }
  return undefined;
}

export function refsLocal(e: Expr, locals: ReadonlySet<string>, reads?: FnReads): boolean {
  let yes = false;
  eachExpr(e, (x) => {
    if (yes) return;
    const name = rootName(x);
    if (name !== undefined && locals.has(name)) yes = true;
    else if (callReadsAny(x, locals, reads)) yes = true;
  });
  return yes;
}

export function targetRoot(e: Expr): string | undefined {
  if (e.op === 'member') return targetRoot(e.base);
  if (e.op === 'index') return targetRoot(e.base);
  return rootName(e);
}

export function collectMutatedRoots(
  body: readonly Stmt[],
  out: Set<string>,
  writes?: FnWrites,
): void {
  for (const s of body) {
    if (writes !== undefined) calleeWritesOf(s, writes, out);
    if (s.s === 'assign' || s.s === 'assignOp') {
      const r = targetRoot(s.target);
      if (r !== undefined) out.add(r);
    } else if (s.s === 'if') {
      for (const a of s.arms) collectMutatedRoots(a.body, out, writes);
      if (s.elseBody) collectMutatedRoots(s.elseBody, out, writes);
    } else if (s.s === 'for') {
      collectMutatedRoots([s.init], out, writes);
      collectMutatedRoots([s.update], out, writes);
      collectMutatedRoots(s.body, out, writes);
    } else if (s.s === 'switch') {
      for (const c of s.cases) collectMutatedRoots(c.body, out, writes);
      if (s.defaultBody) collectMutatedRoots(s.defaultBody, out, writes);
    }
  }
}
