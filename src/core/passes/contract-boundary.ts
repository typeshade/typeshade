// Implements: Rule 11.22 (docs/language-design.md; traced in reqs/).
//
// ═══ The inlining boundary of a numerical contract (change 0107, item 6) ═══
//
// A function under a numerical contract (`FuncDecl.numerics`) is never inlined into another
// function and receives no other function's body, so a rewrite its author accepted never leaves
// it, and an exact caller's own expressions are never rewritten. The IR records no function of
// origin on an expression, so the boundary is kept at the function: every pass that moves one
// function's body into another runs through `outsideContracts`, which takes the opted-in
// functions out of the module, runs the pass on the rest, and puts them back unchanged. A call to
// a function the pass cannot see is a call it cannot inline, and a body it cannot see is one it
// cannot inline into.
//
// A function the pass dropped because no remaining caller called it, while an opted-in function
// still does, is put back as it was before the pass.

import type { Expr, FuncDecl, ModuleDecl } from '../ir/index.js';
import { mapStmt } from './opt/ir-transform.js';

/** Whether `f` opted into a numerical contract. */
export const underContract = (f: FuncDecl): boolean => (f.numerics?.length ?? 0) > 0;

/** The names `f`'s body calls. */
function callees(f: FuncDecl): Set<string> {
  const out = new Set<string>();
  const probe = (e: Expr): Expr => {
    if (e.op === 'call') out.add(e.fn);
    return e;
  };
  for (const s of f.body) mapStmt(s, probe);
  return out;
}

/** Runs `pass` on `m` with every function under a numerical contract held out of it, then puts
 *  each one back as it was. Identity wrapping for a module with no such function, which is every
 *  module whose author wrote no `numerics`. */
export function outsideContracts(m: ModuleDecl, pass: (m: ModuleDecl) => ModuleDecl): ModuleDecl {
  const held = m.funcs.filter(underContract);
  if (held.length === 0) return pass(m);
  const heldNames = new Set(held.map((f) => f.name));
  const out = pass({ ...m, funcs: m.funcs.filter((f) => !heldNames.has(f.name)) });
  const funcs = [...out.funcs];
  const present = new Set(funcs.map((f) => f.name));
  const original = new Map(m.funcs.map((f, i) => [f.name, { f, i }]));
  /** Puts `f` back before the first function that followed it in `m`, or at the end. */
  const restore = (f: FuncDecl): void => {
    const at = original.get(f.name)!.i;
    const next = funcs.findIndex((g) => (original.get(g.name)?.i ?? -1) > at);
    funcs.splice(next < 0 ? funcs.length : next, 0, f);
    present.add(f.name);
  };
  const work = [...held];
  for (const f of held) restore(f);
  while (work.length > 0) {
    for (const name of callees(work.pop()!)) {
      if (present.has(name)) continue;
      const was = original.get(name);
      if (was === undefined) continue;
      restore(was.f);
      work.push(was.f);
    }
  }
  return { ...out, funcs };
}
