// ═══ A module function named like something its target predeclares is emitted under another name ═══
//
// Change 0029, Rule 9.5. A function the file declares wins over every builtin function of its
// name, so a module can hold both: the author's `fract`, which every call the author wrote
// reaches, and the builtin `fract`, which a call the compiler wrote reaches (`random(p)` expands
// to `fract(sin(dot(…)) * …)`, and `Math.pow(a, b)` stays the builtin beside a declared `pow`).
// The IR tells them apart by `declRef`, which a call through the declaration carries and a call
// of the builtin does not. The targets do not. WGSL hides a predeclared name for the WHOLE module
// beside a module-scope declaration of it, so `fn fract` makes every `fract(…)` of the module call
// the declaration, the compiler's own included, and a declared `f32` hides the type, so the next
// `x: f32` fails. GLSL ES 3.00 does not let a program redeclare one of its built-in functions,
// which ANGLE reports as "Name of a built-in function cannot be redeclared as function".
//
// So a writer emits such a declaration under a name its target does not predeclare, and every
// call THROUGH the declaration with it, and a builtin call keeps the builtin's name. The name is
// the one `sanitizeReservedIdents` has always given a GLSL function named like a reserved word,
// `fract_` and then `fract_1`, so both targets spell it the same way.
//
// WHY BEFORE EVERY OTHER PASS. Once no function of the module is named like a builtin, the name
// says which call is which. Every pass after this one, the optimizer's folding and CSE, the
// double-precision lowering, the effects and reachability walks, the call-signature check and the
// emit walk itself, reads a call by its name, as it always did, and is right: the declaration is
// `fract_` and the builtin `fract`. Asking `declRef` of each of them instead would put the
// decision in a field that is documented as free for a pass to drop, and a rewrite that dropped
// it would flip a call from the declaration to the builtin with no error.
//
// WHICH NAMES. The target's own: for WGSL the built-in functions, the predeclared types, type
// generators and aliases, and the enumerants its text spells (`WGSL_PREDECLARED`); for GLSL ES
// 3.00 the built-in functions of its section 8 (`GLSL_ES300_BUILTIN_FUNCTIONS`). And, for both,
// the id of every builtin the IR carries, since the passes and the emit walk recognise a builtin
// by that id whatever a target spells it as: GLSL has no `atan2` and no `saturate`, and a call of
// either is still the builtin, written `atan(y, x)` and `clamp(x, 0.0, 1.0)`. Declared `atan2`
// and `Math.atan2` in one module must not become one function on WebGL2.
//
// WHICH FUNCTIONS. Every one that is not an entry point. An entry named like something WGSL
// predeclares takes a fresh emitted spelling from the spelling plan (Proposal 0070, D7), recorded
// beside the authored name, and the host calls it by the name written. GLSL ES 3.00 spells every
// entry `main`.
//
// Implements: Rule 3.2, Rule 9.5 (docs/language-design.md; traced in reqs/).
//
// WHICH CALLS. A call is renamed when it carries a `declRef`. A call by name with none is a call
// of the builtin, which is what it was before this pass, and what a call made through `externFn`
// is: the extern is found by its name, and a name of a builtin is the builtin.

import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/index.js';
import { stageOf } from '../ir/index.js';
import { mapChildren, mapStmtExpr } from '../ir/visit.js';
import { spellingsOf } from '../spelling-plan.js';
import {
  predeclaredFunctionNames,
  renameTargetOf,
  type RenameTarget,
} from './predeclared-names.js';

export { predeclaredFunctionNames, renameTargetOf, type RenameTarget };

/** `m` with every helper function `renames` names emitted under its planned name, and every call
 *  through one, by `declRef`, renamed with it. `renames` maps an authored helper name to its emitted
 *  name: `spellingsOf(m)[target].funcs` (Proposal 0070). The same object when nothing is renamed. */
export function renameFunctions(m: ModuleDecl, renames: ReadonlyMap<string, string>): ModuleDecl {
  const clashing = new Set(
    m.funcs.filter((f) => renames.has(f.name) && stageOf(f) === undefined).map((f) => f.name),
  );
  if (clashing.size === 0) return m;
  // An expression is rebuilt only when a renamed call is under it, and once: one object that
  // the module holds in two places (the `const` an `.assign()` targets, and the read of it in the
  // value) comes back as one object, rebuilt or not. `autoVars`, which runs after this pass,
  // pairs an assignment's target with the reads of it by that identity, so a pass before it
  // that copied an untouched expression, or copied a shared one twice, would split
  // `acc = f(acc, …)` into two values.
  const isRenamedCall = (e: Expr): e is Extract<Expr, { op: 'call' }> =>
    e.op === 'call' && e.declRef !== undefined && renames.has(e.fn);
  const reaches = new Map<Expr, boolean>();
  const reachesRename = (e: Expr): boolean => {
    let hit = reaches.get(e);
    if (hit === undefined) {
      hit = isRenamedCall(e);
      mapChildren(e, (c) => {
        if (reachesRename(c)) hit = true;
        return c;
      });
      reaches.set(e, hit);
    }
    return hit;
  };
  const done = new Map<Expr, Expr>();
  const rE = (e: Expr): Expr => {
    if (!reachesRename(e)) return e;
    const seen = done.get(e);
    if (seen !== undefined) return seen;
    const next = mapChildren(e, rE);
    const out: Expr = isRenamedCall(next) ? { ...next, fn: renames.get(next.fn)! } : next;
    done.set(e, out);
    return out;
  };
  const rewrite = (f: FuncDecl): FuncDecl => {
    const name = clashing.has(f.name) && stageOf(f) === undefined ? renames.get(f.name)! : f.name;
    const body = f.body.map((s) => (stmtReaches(s, reachesRename) ? mapStmtExpr(s, rE) : s));
    const same = body.every((s, k) => s === f.body[k]);
    return name === f.name && same ? f : { ...f, name, body };
  };
  return { ...m, funcs: m.funcs.map(rewrite) };
}

/** Whether `s`, or a statement nested in it, holds an expression a renamed call is under. */
function stmtReaches(s: Stmt, reaches: (e: Expr) => boolean): boolean {
  let hit = false;
  mapStmtExpr(s, (e) => {
    if (reaches(e)) hit = true;
    return e;
  });
  return hit;
}

/** `m` with every function whose name `target` predeclares emitted under another name, and every
 *  call through one, renamed with it. The names come from the module's spelling plan, so this and
 *  the late pass agree. The same object, for a module with no such function. */
export function renamePredeclaredFunctions(m: ModuleDecl, target: RenameTarget): ModuleDecl {
  return renameFunctions(m, spellingsOf(m)[target].funcs);
}
