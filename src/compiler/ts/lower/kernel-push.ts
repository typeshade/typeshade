// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
// ═══ A kernel function's pushed arrays (change 0078; Rules 8.22 and 8.23) ═══
//
// `out.push(v)` in a kernel function's loop lowers to the builtin `push(out, v)`
// (`expression-call.ts`). An array the function pushes onto starts empty inside the function, so
// its `.length`, which the front end lowers to `arrayLength(out)`, is the count the function has
// appended: here each such `arrayLength` becomes the builtin `pushCount(out)`. Every tier reads
// the two builtins: the CPU tier over its own count (`core/cpu-runtime.ts`), WebGPU over the
// count its lowering keeps.

import type { Expr, Stmt } from '../../../core/ir/nodes.js';
import { eachExpr, eachStmtExpr, mapChildren, mapStmtExpr } from '../../../core/ir/visit.js';

/** The names of the parameters `body` pushes onto. */
export function pushedParams(body: readonly Stmt[]): Set<string> {
  const out = new Set<string>();
  const visit = (e: Expr): void =>
    eachExpr(e, (x) => {
      if (x.op === 'call' && x.fn === 'push' && x.args[0]?.op === 'param') out.add(x.args[0].name);
    });
  const walk = (s: Stmt): void => eachStmtExpr(s, visit, walk);
  body.forEach(walk);
  return out;
}

/** `body` with the length of each array in `pushed` read as the count pushed onto it. */
export function countPushedLengths(body: readonly Stmt[], pushed: ReadonlySet<string>): Stmt[] {
  if (pushed.size === 0) return [...body];
  const rewrite = (e: Expr): Expr => {
    const x = mapChildren(e, rewrite);
    return x.op === 'call' &&
      x.fn === 'arrayLength' &&
      x.args[0]?.op === 'param' &&
      pushed.has(x.args[0].name)
      ? { ...x, fn: 'pushCount' }
      : x;
  };
  const stmt = (s: Stmt): Stmt => mapStmtExpr(s, rewrite, stmt);
  return body.map(stmt);
}
