import type { Backend } from '../backend.js';
import type { Expr, ModuleDecl } from '../ir/index.js';
import { mapExpr, mapStmt } from './opt/ir-transform.js';

export function spellExterns(m: ModuleDecl, be: Backend): ModuleDecl {
  const map = new Map<string, string>();
  for (const e of m.externs ?? []) {
    const to = be.id === 'wgsl' ? e.spelling?.wgsl : e.spelling?.glsl;
    if (to !== undefined && to !== e.name) map.set(e.name, to);
  }
  if (map.size === 0) return m;
  const rE = (e: Expr): Expr =>
    mapExpr(e, (x) =>
      x.op === 'externref' && map.has(x.name) ? { ...x, name: map.get(x.name)! } : x,
    );
  return { ...m, funcs: m.funcs.map((f) => ({ ...f, body: f.body.map((s) => mapStmt(s, rE)) })) };
}
