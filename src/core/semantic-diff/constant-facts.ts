import type { ConstDecl, Expr, ModuleDecl } from '../ir/nodes.js';
import { eachStmtExpr } from '../ir/visit.js';
import { typeSig, type Canon } from './canon.js';
import { subExprs, exprSig } from './skeleton.js';

function literalFacts(m: ModuleDecl, c: Canon): string[] {
  const out: string[] = [];
  const walkE = (e: Expr): void => {
    if (e.op === 'lit') out.push(`lit ${typeSig(e.type, c)}=${String(e.value)}`);
    for (const sub of subExprs(e)) walkE(sub);
  };
  for (const f of m.funcs) for (const s of f.body) eachStmtExpr(s, walkE);
  return out;
}

export function constantFacts(m: ModuleDecl, c: Canon): string[] {
  const out: string[] = [];
  for (const o of m.overrides ?? [])
    out.push(`override ${o.name} ${typeSig(o.type, c)} = ${String(o.default)}`);
  for (const k of m.consts) out.push(constFact(k, c));
  out.push(...literalFacts(m, c));
  return out;
}

const constFact = (k: ConstDecl, c: Canon): string =>
  `const ${c.consts.get(k.name) ?? k.name} ${typeSig(k.type, c)} ` +
  `wgsl=${k.wgslValue} cpu=${k.cpuValue}` +
  (k.valueExpr === undefined ? '' : ` expr=${exprSig(k.valueExpr, c, new Map())}`);
