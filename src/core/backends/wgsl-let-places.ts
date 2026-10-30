// === WGSL: a struct or array local is a place (Rule 8.28, change 0105 item 1) ===
//
// `const ship = new Ship()` is a WGSL `let`, and a `let` has no address: every method called on
// it takes its object by value, and so does every method that one calls on `self_`, down the
// whole chain. A struct or fixed-size array `let` becomes a `var` with the same type and value.
// Nothing writes it (a `let` of the IR is never assigned), so it holds one value for its whole
// scope, as the `let` did, and the calls on it take pointers (`pointerSpaces`), and a call that
// returns into it writes there (`returnInto`).
//
// The `let`s change 0104 left (a copy of a place something writes) are taken too: the copy stays,
// and the calls on it take pointers. The fp64 lowering's `vec64` and `mat64` structs are a vector
// and a matrix in the source and are left as they are (change 0103's exclusion). So is a struct
// the module does not declare: a builtin's result (`__atomic_compare_exchange_result_u32`,
// `__frexp_result_f32`), which WGSL gives no spelling a declaration can name.
//
// WGSL only (Decision D1 of change 0105): a GLSL ES 3.00 local is a copy whatever its
// declaration. Run in `postLower`, after `readLocalsInPlace` and before `returnInto`.

import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/nodes.js';
import { mapStmtExpr } from '../ir/visit.js';
import { bodyHasRaw } from '../passes/opt/dce.js';

/** Whether `e` is a struct the module declares, or a fixed-size array. */
const aggregate = (e: Expr, declared: ReadonlySet<string>): boolean =>
  (e.type.kind === 'struct' &&
    declared.has(e.type.name) &&
    !e.type.name.startsWith('DF64Vec') &&
    !e.type.name.startsWith('DF64Mat')) ||
  (e.type.kind === 'array' && e.type.size !== undefined);

/** `s` with each struct or array `let` it is or holds declared as a `var`. */
function stmt(s0: Stmt, declared: ReadonlySet<string>, changed: { any: boolean }): Stmt {
  const s = mapStmtExpr(
    s0,
    (e) => e,
    (inner) => stmt(inner, declared, changed),
  );
  if (s.s !== 'let' || !aggregate(s.expr, declared)) return s;
  changed.any = true;
  const decl: Stmt = { s: 'var', name: s.name, type: s.expr.type, init: s.expr };
  return s.span === undefined ? decl : { ...decl, span: s.span };
}

/** Declare each struct or fixed-size array `let` as a `var`. See the header. Identity for a module
 *  with no such `let`. */
export function aggregateLetsAsVars(m: ModuleDecl): ModuleDecl {
  const declared = new Set(m.structs.map((d) => d.name));
  const changed = { any: false };
  const funcs = m.funcs.map((f): FuncDecl => {
    if (bodyHasRaw(f.body)) return f;
    const before = changed.any;
    changed.any = false;
    const body = f.body.map((s) => stmt(s, declared, changed));
    const mine = changed.any;
    changed.any = before || mine;
    return mine ? { ...f, body } : f;
  });
  return changed.any ? { ...m, funcs } : m;
}
