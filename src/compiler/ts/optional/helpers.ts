import type { Expr, FuncDecl } from '../../../core/ir/nodes.js';
import { eachExpr, eachStmtExpr } from '../../../core/ir/visit.js';
import { logicalTypeKey } from '../optional.js';

// Why: a helper keeps an effectful argument in its expression position. Hoisting the argument
// before the enclosing statement would reorder the earlier arguments or operands.
const OPTIONAL_HELPERS = new Map<string, FuncDecl>();
export function optionalHelper(
  operation: string,
  inputs: readonly Expr[],
  build: (params: Expr[]) => Expr,
): Expr {
  const name = `__opt_${operation}_${inputs.map((v) => logicalTypeKey(v.type)).join('_')}`.replace(
    /[^A-Za-z0-9_]/g,
    '_',
  );
  let decl = OPTIONAL_HELPERS.get(name);
  if (decl === undefined) {
    const params = inputs.map((v, i) => ({ name: `v${i}`, type: v.type }));
    const result = build(params.map((p) => ({ op: 'param', ...p })));
    decl = { name, params, ret: result.type, body: [{ s: 'return', expr: result }] };
    OPTIONAL_HELPERS.set(name, decl);
  }
  return { op: 'call', type: decl.ret, fn: name, args: [...inputs], declRef: decl };
}

export function optionalHelpersOf(funcs: readonly FuncDecl[]): FuncDecl[] {
  const taken = new Set(funcs.map((f) => f.name));
  const used = new Map<FuncDecl, FuncDecl>();
  const emitted = (helper: FuncDecl): FuncDecl => {
    let decl = used.get(helper);
    if (decl === undefined) {
      let name = helper.name;
      for (let i = 1; taken.has(name); i++) name = `${helper.name}_${String(i)}`;
      taken.add(name);
      decl = name === helper.name ? helper : { ...helper, name };
      used.set(helper, decl);
    }
    return decl;
  };
  for (const f of funcs)
    for (const stmt of f.body)
      eachStmtExpr(stmt, (expr) => {
        eachExpr(expr, (e) => {
          if (e.op !== 'call' || e.declRef === undefined) return;
          if (OPTIONAL_HELPERS.get(e.fn) !== e.declRef) return;
          const decl = emitted(e.declRef);
          if (decl === e.declRef) return;
          const call = e as { fn: string; declRef: FuncDecl };
          call.fn = decl.name;
          call.declRef = decl;
        });
      });
  return [...used.values()];
}
