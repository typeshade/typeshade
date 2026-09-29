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
// WHICH FUNCTIONS. Every one that is not an entry point. An entry keeps its name, because the
// host creates the pipeline by it (`reflect`, the manifest and the host module name it).
//
// WHICH CALLS. A call is renamed when it carries a `declRef`. A call by name with none is a call
// of the builtin, which is what it was before this pass, and what a call made through `externFn`
// is: the extern is found by its name, and a name of a builtin is the builtin.

import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/index.js';
import { stageOf } from '../ir/index.js';
import { mapChildren, mapStmtExpr } from '../ir/visit.js';
import { collectLocals } from './opt/expr-utils.js';
import { BUILTIN_IDS } from '../builtin-ids.js';
import { GLSL_ES300_BUILTIN_FUNCTIONS, WGSL_PREDECLARED } from '../reserved-words.js';

/** The two writers this pass renames for. */
export type RenameTarget = 'wgsl' | 'glsl';

/** The target a backend's `id` names, or undefined for a backend this pass has no list for, such
 *  as one a test defines: it renames nothing. */
export function renameTargetOf(backendId: string): RenameTarget | undefined {
  return backendId === 'wgsl' ? 'wgsl' : backendId === 'glsl-es300' ? 'glsl' : undefined;
}

const namesOf = new Map<RenameTarget, ReadonlySet<string>>();

/** Every name a module function may not have on `target`: what the target predeclares and the
 *  id of each builtin the IR carries. */
export function predeclaredFunctionNames(target: RenameTarget): ReadonlySet<string> {
  let names = namesOf.get(target);
  if (names === undefined) {
    names = new Set([
      ...BUILTIN_IDS,
      ...(target === 'wgsl' ? WGSL_PREDECLARED : GLSL_ES300_BUILTIN_FUNCTIONS),
    ]);
    namesOf.set(target, names);
  }
  return names;
}

/** Every name the module declares anywhere a renamed function could collide with it or be hidden
 *  by it: at module scope, and as a parameter or a local of any function. */
function declaredNames(m: ModuleDecl): Set<string> {
  const out = new Set<string>();
  for (const c of m.consts) out.add(c.name);
  for (const b of m.bindings) out.add(b.name);
  for (const o of m.overrides ?? []) out.add(o.name);
  for (const v of m.vars ?? []) out.add(v.name);
  for (const s of m.structs) out.add(s.name);
  for (const x of m.externs ?? []) out.add(x.name);
  for (const f of m.funcs) {
    out.add(f.name);
    for (const p of f.params) out.add(p.name);
    collectLocals(f.body, out);
  }
  return out;
}

/** `fract` as `fract_`, and `fract_1`, `fract_2`, … while that name is taken. The suffix is a
 *  number and not a second underscore: GLSL ES 3.00 reserves a name with two in a row. */
function freshName(base: string, taken: (candidate: string) => boolean): string {
  if (!taken(`${base}_`)) return `${base}_`;
  for (let i = 1; ; i++) {
    const candidate = `${base}_${String(i)}`;
    if (!taken(candidate)) return candidate;
  }
}

/** `m` with every function whose name `target` predeclares emitted under another name, and every
 *  call through one, by `declRef`, renamed with it. The same object, for a module with no such
 *  function, which is nearly every module. */
export function renamePredeclaredFunctions(m: ModuleDecl, target: RenameTarget): ModuleDecl {
  const reserved = predeclaredFunctionNames(target);
  const clashing = new Set(
    m.funcs.filter((f) => reserved.has(f.name) && stageOf(f) === undefined).map((f) => f.name),
  );
  if (clashing.size === 0) return m;
  const taken = declaredNames(m);
  const renames = new Map<string, string>();
  for (const name of clashing) {
    const fresh = freshName(name, (c) => taken.has(c) || reserved.has(c));
    taken.add(fresh);
    renames.set(name, fresh);
  }
  const rE = (e: Expr): Expr =>
    mapChildren(
      e.op === 'call' && e.declRef !== undefined && renames.has(e.fn)
        ? { ...e, fn: renames.get(e.fn)! }
        : e,
      rE,
    );
  const rS = (s: Stmt): Stmt => mapStmtExpr(s, rE);
  const rewrite = (f: FuncDecl): FuncDecl => ({
    ...f,
    name: clashing.has(f.name) && stageOf(f) === undefined ? renames.get(f.name)! : f.name,
    body: f.body.map(rS),
  });
  return { ...m, funcs: m.funcs.map(rewrite) };
}
