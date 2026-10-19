// Backend identifier spelling only: the authored IR, reflection and CPU names stay intact.
// Implements: Rule 3.2, Rule 3.3, Rule 3.4 (docs/language-design.md; traced in reqs/).
import type { Expr, ModuleDecl, Stmt } from '../ir/nodes.js';
import { mapChildren, mapStmtExpr } from '../ir/visit.js';
import { stageOf } from '../ir/index.js';

/** The fresh emitted spelling of `name`: `$` becomes `_`, a non-ASCII character becomes `u<hex>`,
 *  runs of `_` collapse, a `gl_` prefix becomes `ts_gl_`, and a bare `_` becomes `value`. The
 *  first candidate is `<stem>_`, then `<stem>_1`, `<stem>_2`, … The first one neither `bad` nor
 *  `taken` accepts is the spelling. Pure: the caller records the result in its own set. */
export function freshSpelling(
  name: string,
  taken: (candidate: string) => boolean,
  bad: (candidate: string) => boolean,
): string {
  let base = name
    .replace(/\$/g, '_')
    .replace(/[^\x00-\x7F]/gu, (character) => `u${character.codePointAt(0)!.toString(16)}`)
    .replace(/_+/g, '_');
  if (base.startsWith('gl_')) base = `ts_${base}`;
  if (base === '_') base = 'value';
  const stem = base.endsWith('_') ? base.slice(0, -1) : base;
  for (let i = 0; ; i++) {
    const candidate = i === 0 ? `${stem}_` : `${stem}_${i}`;
    if (!bad(candidate) && !taken(candidate)) return candidate;
  }
}

/** Renames the locals and helper parameters `reserved` names, per function, and every reference.
 *
 *  `planned` (Proposal 0070): the emitted names of the spelling plan of the target. The plan owns
 *  the module-scope names (consts, module variables, bindings, structs, fields) and the
 *  entry-point parameters, so this pass never renames them. It avoids every planned name for its
 *  own spellings. Both writers pass it: WGSL in `preOptimize`, GLSL after the late pass
 *  `spellModule`, so the names it sees are already the emitted ones of the plan.
 *
 *  `predeclared` (WGSL, Proposal 0070 D-C10-1): a local or helper parameter named like one of
 *  these is renamed too, but only in a function that calls a builtin of that name, since the
 *  local then hides the builtin (Tint refuses `fn f(max: f32) -> f32 { return max(1.0, 3.0); }`).
 *  A function that does not call it keeps the authored name. */
export function sanitizeVariableNames(
  module: ModuleDecl,
  reserved: (name: string) => boolean,
  planned: ReadonlySet<string>,
  predeclared?: ReadonlySet<string>,
): ModuleDecl {
  const collect = (body: readonly Stmt[], names: Set<string>): void => {
    for (const stmt of body) {
      if (stmt.s === 'let' || stmt.s === 'var') names.add(stmt.name);
      // Use the shared statement traversal to cover loops, branches and switches.
      mapStmtExpr(
        stmt,
        (expr) => expr,
        (child) => {
          collect([child], names);
          return child;
        },
      );
    }
  };
  const taken = new Set([
    ...module.consts.map((c) => c.name),
    ...module.bindings.map((b) => b.name),
    ...(module.overrides ?? []).map((o) => o.name),
    ...(module.vars ?? []).map((v) => v.name),
    ...module.structs.flatMap((s) => [s.name, ...s.fields.map((f) => f.name)]),
    ...module.funcs.map((f) => f.name),
    ...(module.externs ?? []).map((e) => e.name),
    ...planned,
  ]);
  for (const func of module.funcs) {
    func.params.forEach((p) => taken.add(p.name));
    collect(func.body, taken);
  }
  // The names this pass renames: the locals, and the parameters of a helper. An entry's
  // parameters are the plan's (`members`), so they are not in this set.
  const variableNames = new Set<string>();
  for (const func of module.funcs) {
    if (stageOf(func) === undefined) func.params.forEach((p) => variableNames.add(p.name));
    collect(func.body, variableNames);
  }
  // The builtins each function calls: a call by name with no `declRef`, and `select`.
  const builtinsCalled = (body: readonly Stmt[]): Set<string> => {
    const out = new Set<string>();
    const visit = (e: Expr): Expr => {
      if (e.op === 'call' && e.declRef === undefined) out.add(e.fn);
      if (e.op === 'select') out.add('select');
      return mapChildren(e, visit);
    };
    const walk = (stmt: Stmt): Stmt => mapStmtExpr(stmt, visit, walk);
    body.forEach(walk);
    return out;
  };
  const called = new Map(
    module.funcs.map((f) => [
      f,
      predeclared === undefined ? new Set<string>() : builtinsCalled(f.body),
    ]),
  );
  const hides = (name: string, calls: ReadonlySet<string>): boolean =>
    reserved(name) || (predeclared?.has(name) === true && calls.has(name));
  if (
    ![...variableNames].some(
      (name) => reserved(name) || [...called.values()].some((c) => hides(name, c)),
    )
  )
    return module;
  const fresh = (name: string, used = taken): string => {
    const candidate = freshSpelling(name, (c) => used.has(c), reserved);
    used.add(candidate);
    return candidate;
  };
  const expression = (locals: ReadonlyMap<string, string>, expr: Expr): Expr => {
    let name: string | undefined;
    if (expr.op === 'param') name = locals.get(expr.name);
    if (expr.op === 'varref') name = locals.get(expr.name);
    return mapChildren(name === undefined ? expr : ({ ...expr, name } as Expr), (child) =>
      expression(locals, child),
    );
  };
  const funcs = module.funcs.map((func) => {
    const names = new Set(stageOf(func) === undefined ? func.params.map((p) => p.name) : []);
    collect(func.body, names);
    const locals = new Map<string, string>();
    const used = new Set(taken);
    const calls = called.get(func)!;
    for (const name of names) if (hides(name, calls)) locals.set(name, fresh(name, used));
    const rewrite = (stmt: Stmt): Stmt => {
      const renamed =
        (stmt.s === 'let' || stmt.s === 'var') && locals.has(stmt.name)
          ? { ...stmt, name: locals.get(stmt.name)! }
          : stmt;
      return mapStmtExpr(renamed, (expr) => expression(locals, expr), rewrite);
    };
    return {
      ...func,
      params: func.params.map((p) => ({ ...p, name: locals.get(p.name) ?? p.name })),
      body: func.body.map(rewrite),
    };
  });
  return { ...module, funcs };
}
