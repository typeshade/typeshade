// Implements: Rule 11.8 (docs/language-design.md; traced in reqs/).
// Private incoming-content facts for generated host calls (0129). No shader or public IR changes.
import type { Expr, ModuleDecl, Stmt } from '../../core/ir/nodes.js';
import { eachStmtExpr } from '../../core/ir/visit.js';
import { eachOperand } from '../../core/passes/access.js';

interface ContentReads {
  readonly params: Set<string>;
  readonly bindings: Set<string>;
}

/** Whole-function content reads, including callees. A write's address reads its indices, not its
 *  stored value. Fixed capacity is not content. By-value helper arguments still evaluate fully;
 *  an inout argument is a place, whose contents are read when the callee reads its parameter.
 *  The monotone summaries include every branch and later statement, without overwrite proofs. */
export function hostContentReads(m: ModuleDecl): ReadonlyMap<string, ContentReads> {
  const functions = new Map(m.funcs.map((f) => [f.name, f]));
  const declarations = new Set(m.funcs);
  const bindings = new Set(m.bindings.map((b) => b.name));
  const result = new Map(
    m.funcs.map((f) => [
      f.name,
      {
        params: new Set<string>(),
        bindings: new Set<string>(),
      },
    ]),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of m.funcs) {
      const out = result.get(f.name)!;
      const before = out.params.size + out.bindings.size;
      const params = new Set(f.params.map((p) => p.name));
      const read = (e: Expr, place = false): void => {
        if (e.op === 'param') {
          if (!place && params.has(e.name)) out.params.add(e.name);
          return;
        }
        if (e.op === 'varref' || e.op === 'externref') {
          if (!place) {
            // Writable parameters lower as varrefs, including scalar inout helpers.
            if (e.op === 'varref' && params.has(e.name)) out.params.add(e.name);
            else if (bindings.has(e.name)) out.bindings.add(e.name);
          }
          return;
        }
        if (e.op === 'index') {
          read(e.base, place);
          read(e.idx);
          return;
        }
        if (e.op === 'member') {
          read(e.base, place);
          return;
        }
        if (e.op === 'call') {
          // A real declaration wins over its displayed spelling. A reference outside this
          // module is unknown, rather than the summary of a different function of that name.
          const callee =
            e.declRef === undefined
              ? functions.get(e.fn)
              : declarations.has(e.declRef)
                ? e.declRef
                : undefined;
          if (callee !== undefined) {
            const summary = result.get(callee.name)!;
            for (const name of summary.bindings) out.bindings.add(name);
            e.args.forEach((a, i) => {
              const p = callee.params[i];
              read(a, p?.mode === 'inout' && !summary.params.has(p.name));
            });
            return;
          }
          // An unresolved declaration is opaque. Keep every binding it might reach.
          if (e.declRef !== undefined) for (const name of bindings) out.bindings.add(name);
        }
        eachOperand(e, (operand, access) =>
          read(
            operand,
            access === 'length' ||
              access === 'atomic-store' ||
              access === 'texel-write' ||
              access === 'append',
          ),
        );
      };
      const statement = (s: Stmt): void => {
        if (s.s === 'assign' || s.s === 'assignOp') {
          read(s.target, s.s === 'assign');
          read(s.expr);
        } else if (s.s === 'raw' || s.s === 'placeholder') {
          // Opaque code cannot prove that a destination is write-only.
          for (const name of params) out.params.add(name);
          for (const name of bindings) out.bindings.add(name);
        } else eachStmtExpr(s, (e) => read(e), statement);
      };
      f.body.forEach(statement);
      changed ||= before !== out.params.size + out.bindings.size;
    }
  }
  return result;
}
