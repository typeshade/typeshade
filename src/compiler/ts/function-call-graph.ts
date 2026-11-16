// Read emitted call names without resolving declaration identity. The caller decides
// which names belong to its graph; stage checks and inherited-body diagnostics share this walk.
import type { Stmt } from '../../core/ir/nodes.js';
import { eachExpr, eachStmtExpr } from '../../core/ir/visit.js';

/** The functions a function's body calls, by name. */
export function calleeNamesOf(body: readonly Stmt[]): Set<string> {
  const names = new Set<string>();
  const walkStmt = (s: Stmt): void => {
    eachStmtExpr(
      s,
      (e) => {
        eachExpr(e, (x) => {
          if (x.op === 'call') names.add(x.fn);
        });
      },
      walkStmt,
    );
  };
  for (const s of body) walkStmt(s);
  return names;
}
