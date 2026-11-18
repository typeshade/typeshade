import type { Expr, ShaderType, Stmt } from '../../../ir/index.js';
import { eachExpr } from '../../../ir/visit.js';
import { keyOf } from '../expr-utils.js';
import type { Values } from './arms.js';

const ref = (name: string, type: ShaderType): Expr => ({ op: 'varref', type, name });

const readsOf = (e: Expr): Set<string> => {
  const out = new Set<string>();
  eachExpr(e, (x) => {
    if (x.op === 'varref') out.add(x.name);
  });
  return out;
};

export function parallelAssign(
  pending: Map<string, Expr>,
  types: ReadonlyMap<string, ShaderType>,
  fresh: () => string,
  span: Stmt['span'],
): Stmt[] {
  const out: Stmt[] = [];
  const reads = new Map<string, Set<string>>();
  for (const [name, value] of pending) reads.set(name, readsOf(value));
  const free = (x: string): boolean =>
    ![...pending.keys()].some((y) => y !== x && reads.get(y)!.has(x));
  while (pending.size > 0) {
    const next = [...pending.keys()].find(free);
    if (next !== undefined) {
      out.push({
        s: 'assign',
        target: ref(next, types.get(next)!),
        expr: pending.get(next)!,
        span,
      });
      pending.delete(next);
      continue;
    }
    const [cut] = pending.keys();
    const temp = fresh();
    const value = pending.get(cut!)!;
    out.push({ s: 'let', name: temp, expr: value, span });
    pending.set(cut!, ref(temp, value.type));
    reads.set(cut!, new Set([temp]));
  }
  return out;
}

export function selectValues(
  cond: Expr,
  thenValues: Values,
  elseValues: Values,
  types: ReadonlyMap<string, ShaderType>,
  declaredWithInit: (name: string) => boolean,
): Map<string, Expr> | undefined {
  const names = new Set([...thenValues.keys(), ...elseValues.keys()]);
  const out = new Map<string, Expr>();
  for (const name of names) {
    const type = types.get(name)!;
    const t = thenValues.get(name);
    const f = elseValues.get(name);
    if ((t === undefined || f === undefined) && !declaredWithInit(name)) return undefined;
    const ifTrue = t ?? ref(name, type);
    const ifFalse = f ?? ref(name, type);
    if (keyOf(ifTrue) === keyOf(ifFalse)) {
      if (!(ifTrue.op === 'varref' && ifTrue.name === name)) out.set(name, ifTrue);
      continue;
    }
    out.set(name, { op: 'select', type, cond, ifTrue, ifFalse });
  }
  return out;
}
