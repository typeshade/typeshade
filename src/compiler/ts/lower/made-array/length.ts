// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import type { Expr, FuncDecl, Stmt } from '../../../../core/ir/nodes.js';
import type { ShaderType } from '../../../../core/ir/types.js';
import { eachExpr, eachStmtExpr, mapStmtExpr } from '../../../../core/ir/visit.js';
import { mapExpr } from '../../../../core/passes/opt/ir-transform.js';
import { storeAfterLoops } from '../../../../core/passes/kernel-stores.js';

function arrayOf(stub: FuncDecl, param: string): ShaderType {
  return stub.params.find((p) => p.name === param)!.type;
}

const U32: ShaderType = { kind: 'scalar', scalar: 'u32' };

function namesIn(body: readonly Stmt[]): Set<string> {
  const names = new Set<string>();
  const visit = (st: Stmt): void => {
    if (st.s === 'let' || st.s === 'var') names.add(st.name);
    eachStmtExpr(
      st,
      (e) =>
        eachExpr(e, (x) => {
          if (x.op === 'varref' || x.op === 'param') names.add(x.name);
        }),
      visit,
    );
  };
  body.forEach(visit);
  return names;
}

export function freeParamName(stub: FuncDecl, wanted: string): string {
  const taken = namesIn(stub.body);
  for (const p of stub.params) taken.add(p.name);
  let name = wanted;
  while (taken.has(name)) name = `${name}_`;
  return name;
}

export function lengthFromHost(stub: FuncDecl, param: string, grown: boolean): string {
  const name = freeParamName(stub, `${param}_length`);
  const arrays = new Set([param]);
  const count: Expr = grown
    ? {
        op: 'call',
        type: U32,
        fn: 'pushCount',
        args: [{ op: 'param', type: arrayOf(stub, param), name: param }],
      }
    : { op: 'param', type: U32, name };
  const swap = (e: Expr): Expr =>
    mapExpr(e, (x) =>
      x.op === 'call' &&
      x.fn === 'arrayLength' &&
      x.args.length === 1 &&
      x.args[0]!.op === 'param' &&
      x.args[0]!.name === param
        ? count
        : x,
    );
  const visit = (st: Stmt): Stmt =>
    storeAfterLoops(st, arrays) !== undefined ? st : mapStmtExpr(st, swap, visit);
  (stub as { body: readonly Stmt[] }).body = stub.body.map(visit);
  (stub.params as FuncDecl['params'][number][]).push({ name, type: U32 });
  return name;
}
