import { GPU_STUBS } from '../../../core/cpu-runtime.js';
import { isAtomicIntrinsic, isBarrierIntrinsic } from '../../../core/intrinsics.js';
import type { Expr, FuncDecl, Stmt } from '../../../core/ir/nodes.js';
import { sourceSpanOf } from '../../../core/ir/span.js';
import { eachExpr, eachStmtExpr } from '../../../core/ir/visit.js';

export function gpuOnlyCall(f: FuncDecl, declared: ReadonlySet<string>): string | undefined {
  let found: string | undefined;
  const visit = (x: Expr): void => {
    if (found !== undefined || x.op !== 'call' || declared.has(x.fn)) return;
    if (isBarrierIntrinsic(x.fn) || isAtomicIntrinsic(x.fn) || GPU_STUBS[x.fn] !== undefined)
      found = x.fn;
  };
  for (const s of f.body) eachStmtExpr(s, (e) => eachExpr(e, visit));
  return found;
}

export function barrierIn(
  closure: ReadonlySet<string>,
  byName: ReadonlyMap<string, FuncDecl>,
  declared: ReadonlySet<string>,
): string | undefined {
  for (const g of closure) {
    let found: string | undefined;
    const visitStmt = (st: Stmt): void => {
      if (found !== undefined) return;
      eachStmtExpr(
        st,
        (e) =>
          eachExpr(e, (x) => {
            if (found !== undefined || x.op !== 'call' || declared.has(x.fn)) return;
            if (!isBarrierIntrinsic(x.fn)) return;
            const span = sourceSpanOf(st) ?? sourceSpanOf(x);
            const file = span?.file.replace(/\\/g, '/').split('/').pop();
            found = span ? `${x.fn}() at ${file}:${span.line + 1}` : `${x.fn}() in ${g}`;
          }),
        visitStmt,
      );
    };
    for (const st of byName.get(g)!.body) visitStmt(st);
    if (found !== undefined) return found;
  }
  return undefined;
}
