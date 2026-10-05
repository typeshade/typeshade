// Backend identifier spelling only: the authored IR, reflection and CPU names stay intact.
// Implements: Rule 3.2, Rule 3.3, Rule 3.4 (docs/language-design.md; traced in reqs/).
import type { Expr, ModuleDecl, Stmt } from '../ir/nodes.js';
import { mapChildren, mapStmtExpr } from '../ir/visit.js';

export function sanitizeVariableNames(
  module: ModuleDecl,
  reserved: (name: string) => boolean,
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
  ]);
  for (const func of module.funcs) {
    func.params.forEach((p) => taken.add(p.name));
    collect(func.body, taken);
  }
  const variableNames = new Set([
    ...module.consts.map((c) => c.name),
    ...(module.vars ?? []).map((v) => v.name),
  ]);
  for (const func of module.funcs) {
    func.params.forEach((p) => variableNames.add(p.name));
    collect(func.body, variableNames);
  }
  if (![...variableNames].some(reserved)) return module;
  const fresh = (name: string, used = taken): string => {
    let base = name
      .replace(/\$/g, '_')
      .replace(/[^\x00-\x7F]/gu, (character) => `u${character.codePointAt(0)!.toString(16)}`)
      .replace(/_+/g, '_');
    if (base.startsWith('gl_')) base = `ts_${base}`;
    if (base === '_') base = 'value';
    const stem = base.endsWith('_') ? base.slice(0, -1) : base;
    for (let i = 0; ; i++) {
      const candidate = i === 0 ? `${stem}_` : `${stem}_${i}`;
      if (!reserved(candidate) && !used.has(candidate)) {
        used.add(candidate);
        return candidate;
      }
    }
  };
  const globals = new Map<string, string>();
  for (const name of [...module.consts, ...(module.vars ?? [])].map((d) => d.name))
    if (reserved(name)) globals.set(name, fresh(name));
  const expression = (locals: ReadonlyMap<string, string>, expr: Expr): Expr => {
    let name: string | undefined;
    if (expr.op === 'constref') name = globals.get(expr.name);
    if (expr.op === 'param') name = locals.get(expr.name);
    if (expr.op === 'varref') name = locals.get(expr.name) ?? globals.get(expr.name);
    return mapChildren(name === undefined ? expr : ({ ...expr, name } as Expr), (child) =>
      expression(locals, child),
    );
  };
  const funcs = module.funcs.map((func) => {
    const names = new Set(func.params.map((p) => p.name));
    collect(func.body, names);
    const locals = new Map<string, string>();
    const used = new Set(taken);
    for (const name of names) if (reserved(name)) locals.set(name, fresh(name, used));
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
  return {
    ...module,
    funcs,
    consts: module.consts.map((c) => ({
      ...c,
      name: globals.get(c.name) ?? c.name,
      ...(c.valueExpr === undefined ? {} : { valueExpr: expression(new Map(), c.valueExpr) }),
    })),
    ...(module.vars === undefined
      ? {}
      : {
          vars: module.vars.map((v) => ({
            ...v,
            name: globals.get(v.name) ?? v.name,
            ...(v.init === undefined ? {} : { init: expression(new Map(), v.init) }),
          })),
        }),
  };
}
