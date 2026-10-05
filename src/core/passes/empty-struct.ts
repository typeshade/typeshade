// Verifies: Rule 8.9 (docs/language-design.md; traced in reqs/).
// Empty source objects stay empty on the CPU. GPU targets require a nonempty structure,
// so add their carrier only after source validation and before target layout lowering.
import type { Expr, ModuleDecl } from '../ir/nodes.js';
import { u32T } from '../ir/types.js';
import { mapExpr, mapModuleExprs } from './opt/ir-transform.js';

/** Give an empty struct a private GPU carrier, including every explicit construction. */
export function lowerEmptyStructs(m: ModuleDecl): ModuleDecl {
  const empty = new Set(m.structs.filter((s) => s.fields.length === 0).map((s) => s.name));
  if (empty.size === 0) return m;
  const rewrite = (e: Expr): Expr =>
    e.op === 'construct' &&
    e.type.kind === 'struct' &&
    empty.has(e.type.name) &&
    e.args.length === 0
      ? { ...e, args: [{ op: 'lit', type: u32T, value: 0 }] }
      : e;
  const out = mapModuleExprs(m, rewrite);
  return {
    ...out,
    structs: m.structs.map((s) =>
      empty.has(s.name) ? { ...s, fields: [{ name: '_empty', type: u32T }] } : s,
    ),
    consts: m.consts.map((c) =>
      c.valueExpr === undefined ? c : { ...c, valueExpr: mapExpr(c.valueExpr, rewrite) },
    ),
    ...(m.vars === undefined
      ? {}
      : {
          vars: m.vars.map((v) =>
            v.init === undefined ? v : { ...v, init: mapExpr(v.init, rewrite) },
          ),
        }),
  };
}
