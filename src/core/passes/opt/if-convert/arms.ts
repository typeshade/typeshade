import type { Expr, ShaderType, Stmt } from '../../../ir/index.js';
import { mapExpr } from '../ir-transform.js';
import { isCheapAndPure, isSelectable } from './pure.js';

const MAX_STMTS = 6;
const MAX_LOCALS = 4;

export interface LocalVar {
  readonly type: ShaderType;
  readonly hasInit: boolean;
}

export type Values = Map<string, Expr>;

export function armValues(
  body: readonly Stmt[],
  locals: ReadonlyMap<string, LocalVar>,
): Values | undefined {
  if (body.length > MAX_STMTS) return undefined;
  const env: Values = new Map();
  const read = (e: Expr): Expr =>
    mapExpr(e, (x) => (x.op === 'varref' ? (env.get(x.name) ?? x) : x));
  for (const s of body) {
    if ((s.s !== 'assign' && s.s !== 'assignOp') || s.target.op !== 'varref') return undefined;
    const target = s.target;
    const local = locals.get(target.name);
    if (local === undefined || !isSelectable(local.type)) return undefined;
    const rhs = read(s.expr);
    const value: Expr =
      s.s === 'assign'
        ? rhs
        : { op: 'binop', type: local.type, bop: s.bop, a: read(target), b: rhs };
    if (!isCheapAndPure(value)) return undefined;
    env.set(target.name, value);
  }
  return env.size <= MAX_LOCALS ? env : undefined;
}
