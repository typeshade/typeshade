import type { ModuleDecl, Stmt } from '../../ir/nodes.js';
import { mapStmtExpr } from '../../ir/visit.js';

export function declaredNames(m: ModuleDecl): Set<string> {
  const names = new Set<string>([
    ...m.consts.map((c) => c.name),
    ...m.bindings.map((b) => b.name),
    ...(m.overrides ?? []).map((o) => o.name),
    ...(m.vars ?? []).map((v) => v.name),
    ...m.structs.flatMap((s) => [s.name, ...s.fields.map((x) => x.name)]),
    ...m.funcs.map((x) => x.name),
  ]);
  const collect = (body: readonly Stmt[]): void => {
    for (const st of body) {
      if (st.s === 'let' || st.s === 'var') names.add(st.name);
      mapStmtExpr(
        st,
        (e) => e,
        (child) => {
          collect([child]);
          return child;
        },
      );
    }
  };
  for (const fn of m.funcs) {
    fn.params.forEach((p) => names.add(p.name));
    collect(fn.body);
  }
  return names;
}

export function spellArrayBindings(
  params: readonly string[],
  declared: ReadonlySet<string>,
  reserved: (name: string) => boolean,
): ReadonlyMap<string, string> {
  const used = new Set(declared);
  const out = new Map<string, string>();
  for (const name of params) {
    if (!reserved(name)) continue;
    for (let i = 0; ; i++) {
      const candidate = i === 0 ? `${name}_` : `${name}_${i}`;
      if (!reserved(candidate) && !used.has(candidate)) {
        used.add(candidate);
        out.set(name, candidate);
        break;
      }
    }
  }
  return out;
}
